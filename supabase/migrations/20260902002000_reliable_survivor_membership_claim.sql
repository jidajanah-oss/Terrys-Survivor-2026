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

  -- First return an existing link if this account already owns one.
  select *
  into claimed
  from public.league_members
  where user_id = account_user_id
  order by joined_at
  limit 1;

  if claimed.id is not null then
    return jsonb_build_object(
      'leagueId', claimed.league_id,
      'memberId', claimed.id,
      'displayName', claimed.display_name,
      'email', coalesce(claimed.email, ''),
      'role', claimed.role,
      'status', claimed.status
    );
  end if;

  -- Prefer the authenticated JWT email.
  account_email :=
    lower(trim(coalesce(auth.jwt() ->> 'email', '')));

  -- Fall back to auth.users if needed.
  if account_email = '' then
    select lower(trim(email))
    into account_email
    from auth.users
    where id = account_user_id;
  end if;

  if coalesce(account_email, '') = '' then
    return null;
  end if;

  -- Claim exactly one unlinked roster entry with the same email.
  update public.league_members
  set user_id = account_user_id
  where id = (
    select id
    from public.league_members
    where user_id is null
      and lower(trim(coalesce(email, ''))) = account_email
    order by joined_at
    limit 1
  )
  returning * into claimed;

  -- Protect against a concurrent claim finishing just before us.
  if claimed.id is null then
    select *
    into claimed
    from public.league_members
    where user_id = account_user_id
    order by joined_at
    limit 1;
  end if;

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

revoke execute
on function public.claim_survivor_membership()
from public;

grant execute
on function public.claim_survivor_membership()
to authenticated;
