begin;

-- One authenticated account may own multiple Survivor entries.
alter table public.league_members
  drop constraint if exists league_members_league_id_user_id_key;

-- Entry names must remain unique within Terry's league.
create unique index if not exists league_members_unique_entry_name_per_league
  on public.league_members (
    league_id,
    lower(btrim(display_name))
  );

-- Return every Survivor entry owned by the signed-in account.
create or replace function public.get_my_survivor_memberships()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'leagueId', m.league_id,
        'memberId', m.id,
        'displayName', m.display_name,
        'email', coalesce(m.email, ''),
        'role', m.role,
        'status', m.status
      )
      order by m.joined_at, m.id
    ),
    '[]'::jsonb
  )
  from public.league_members m
  where m.user_id = auth.uid();
$$;

revoke all
on function public.get_my_survivor_memberships()
from public;

grant execute
on function public.get_my_survivor_memberships()
to authenticated;

-- Claim ALL unlinked entries using the signed-in email.
-- The legacy RPC still returns one membership so older clients remain compatible.
create or replace function public.claim_survivor_membership()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_user_id uuid := auth.uid();
  account_email text;
  claimed public.league_members;
begin
  if account_user_id is null then
    return null;
  end if;

  account_email :=
    lower(trim(coalesce(auth.jwt() ->> 'email', '')));

  if account_email = '' then
    select lower(trim(email))
    into account_email
    from auth.users
    where id = account_user_id;
  end if;

  if coalesce(account_email, '') <> '' then
    update public.league_members
    set user_id = account_user_id
    where user_id is null
      and lower(trim(coalesce(email, ''))) = account_email;
  end if;

  select *
  into claimed
  from public.league_members
  where user_id = account_user_id
  order by joined_at, id
  limit 1;

  if claimed.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'leagueId', claimed.league_id,
    'memberId', claimed.id,
    'displayName', claimed.display_name,
    'email', coalesce(claimed.email, ''),
    'role', claimed.role,
    'status', claimed.status
  );
end;
$$;

revoke all
on function public.claim_survivor_membership()
from public;

grant execute
on function public.claim_survivor_membership()
to authenticated;

-- Commissioner roster editing now permits the same owner email on
-- multiple uniquely named entries.
create or replace function public.upsert_survivor_roster_member(
  target_league uuid,
  target_member uuid,
  requested_display_name text,
  requested_email text,
  requested_role public.survivor_role,
  requested_status public.player_status,
  requested_buybacks integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  existing_member public.league_members%rowtype;
  saved_member public.league_members%rowtype;
  normalized_name text;
  normalized_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_commissioner(target_league) then
    raise exception 'Commissioner access is required';
  end if;

  normalized_name := trim(coalesce(requested_display_name, ''));
  normalized_email := lower(trim(coalesce(requested_email, '')));

  if normalized_name = '' then
    raise exception 'Entry name is required';
  end if;

  if normalized_email <> ''
     and normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address';
  end if;

  if coalesce(requested_buybacks, 0) < 0 then
    raise exception 'Buybacks cannot be negative';
  end if;

  if exists (
    select 1
    from public.league_members member
    where member.league_id = target_league
      and lower(trim(member.display_name)) = lower(normalized_name)
      and (target_member is null or member.id <> target_member)
  ) then
    raise exception 'That entry name is already in the Survivor league';
  end if;

  if target_member is not null then
    select *
    into existing_member
    from public.league_members
    where id = target_member
      and league_id = target_league;

    if existing_member.id is null then
      raise exception 'The Survivor entry was not found';
    end if;

    if existing_member.user_id is not null
       and normalized_email <> lower(coalesce(existing_member.email, '')) then
      raise exception 'Linked account emails are protected';
    end if;

    if existing_member.role in ('primary-commissioner', 'co-commissioner')
       and normalized_name <> existing_member.display_name then
      raise exception 'Commissioner names are protected';
    end if;

    update public.league_members
    set
      display_name = normalized_name,
      email = nullif(normalized_email, '')
    where id = target_member
      and league_id = target_league
    returning * into saved_member;
  else
    insert into public.league_members (
      league_id,
      display_name,
      email,
      role,
      status,
      buybacks
    )
    values (
      target_league,
      normalized_name,
      nullif(normalized_email, ''),
      requested_role,
      requested_status,
      coalesce(requested_buybacks, 0)
    )
    returning * into saved_member;
  end if;

  insert into public.audit_log (
    league_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    details
  )
  values (
    target_league,
    auth.uid(),
    case
      when target_member is null then 'create_roster_entry'
      else 'update_roster_entry'
    end,
    'league_member',
    saved_member.id::text,
    jsonb_build_object(
      'entry_name', saved_member.display_name,
      'email_present', saved_member.email is not null,
      'role', saved_member.role,
      'linked', saved_member.user_id is not null
    )
  );

  return jsonb_build_object(
    'id', saved_member.id,
    'leagueId', saved_member.league_id,
    'userId', saved_member.user_id,
    'displayName', saved_member.display_name,
    'email', coalesce(saved_member.email, ''),
    'role', saved_member.role,
    'status', saved_member.status,
    'buybacks', saved_member.buybacks
  );
end;
$function$;

revoke all on function public.upsert_survivor_roster_member(
  uuid,
  uuid,
  text,
  text,
  public.survivor_role,
  public.player_status,
  integer
) from public;

grant execute on function public.upsert_survivor_roster_member(
  uuid,
  uuid,
  text,
  text,
  public.survivor_role,
  public.player_status,
  integer
) to authenticated;

notify pgrst, 'reload schema';

commit;
