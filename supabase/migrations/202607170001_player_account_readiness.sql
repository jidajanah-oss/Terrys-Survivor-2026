-- Terry's Survivor 2026
-- v14 player account readiness: commissioner-safe roster preparation.
--
-- This migration does not alter Supabase secrets, Vault, pg_cron, pg_net,
-- terrys-survivor-live-nfl-sync, or the sync-nfl-week Edge Function.

begin;

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
    raise exception 'Player name is required';
  end if;

  if normalized_email <> ''
     and normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address';
  end if;

  if coalesce(requested_buybacks, 0) < 0 then
    raise exception 'Buybacks cannot be negative';
  end if;

  if normalized_email <> ''
     and exists (
       select 1
       from public.league_members member
       where member.league_id = target_league
         and lower(coalesce(member.email, '')) = normalized_email
         and (target_member is null or member.id <> target_member)
     ) then
    raise exception 'That email is already assigned to another survivor entry';
  end if;

  if exists (
    select 1
    from public.league_members member
    where member.league_id = target_league
      and lower(member.display_name) = lower(normalized_name)
      and (target_member is null or member.id <> target_member)
  ) then
    raise exception 'That player name is already in the cloud roster';
  end if;

  if target_member is not null then
    select *
    into existing_member
    from public.league_members
    where id = target_member
      and league_id = target_league;

    if existing_member.id is null then
      raise exception 'The survivor roster member was not found';
    end if;

    if existing_member.user_id is not null
       and normalized_email <> lower(coalesce(existing_member.email, '')) then
      raise exception 'Linked account emails are protected';
    end if;

    if existing_member.role in ('primary-commissioner', 'co-commissioner')
       and normalized_name <> existing_member.display_name then
      raise exception 'Commissioner names are protected';
    end if;

    -- This account-readiness RPC edits identity fields only for existing
    -- members. It deliberately preserves role, status, buybacks, picks,
    -- payments, and elimination history already stored in the cloud.
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
      when target_member is null then 'create_roster_account'
      else 'update_roster_account'
    end,
    'league_member',
    saved_member.id::text,
    jsonb_build_object(
      'display_name', saved_member.display_name,
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
