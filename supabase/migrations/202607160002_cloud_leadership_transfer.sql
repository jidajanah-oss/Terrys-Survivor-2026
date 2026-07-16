-- Terry's Survivor 2026 — Cloud leadership transfer v11

create or replace function public.assign_survivor_leadership(
  terry_email text,
  terry_display_name text default 'Terry'
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller public.league_members;
  terry_member public.league_members;
  normalized_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  normalized_email := lower(trim(terry_email));
  if normalized_email = '' or normalized_email !~ '^[^@]+@[^@]+\.[^@]+$' then
    raise exception 'Enter Terry''s valid email address';
  end if;

  select * into caller
  from public.league_members
  where user_id = auth.uid()
  order by joined_at
  limit 1;

  if caller.id is null then raise exception 'No linked survivor membership was found'; end if;
  if caller.role <> 'primary-commissioner' then raise exception 'Only the current Primary Commissioner can transfer leadership'; end if;

  -- Temporarily demote caller first to satisfy the one-primary index.
  update public.league_members
  set role = 'co-commissioner'
  where id = caller.id;

  -- Remove any previous co-commissioner assignment except the caller.
  update public.league_members
  set role = 'player'
  where league_id = caller.league_id
    and role = 'co-commissioner'
    and id <> caller.id;

  select * into terry_member
  from public.league_members
  where league_id = caller.league_id
    and lower(coalesce(email, '')) = normalized_email
  order by joined_at
  limit 1;

  if terry_member.id is null then
    insert into public.league_members (league_id, display_name, email, role, status)
    values (
      caller.league_id,
      coalesce(nullif(trim(terry_display_name), ''), 'Terry'),
      normalized_email,
      'primary-commissioner',
      'active'
    )
    returning * into terry_member;
  else
    update public.league_members
    set display_name = coalesce(nullif(trim(terry_display_name), ''), display_name),
        email = normalized_email,
        role = 'primary-commissioner'
    where id = terry_member.id
    returning * into terry_member;
  end if;

  insert into public.audit_log (league_id, actor_id, action, entity_type, entity_id, details)
  values (
    caller.league_id,
    auth.uid(),
    'assign_cloud_leadership',
    'league_member',
    terry_member.id::text,
    jsonb_build_object(
      'primary_email', normalized_email,
      'primary_member_id', terry_member.id,
      'co_commissioner_member_id', caller.id
    )
  );

  return jsonb_build_object(
    'leagueId', caller.league_id,
    'memberId', caller.id,
    'displayName', caller.display_name,
    'email', coalesce(caller.email, ''),
    'role', 'co-commissioner',
    'status', caller.status
  );
end;
$$;

grant execute on function public.assign_survivor_leadership(text, text) to authenticated;
