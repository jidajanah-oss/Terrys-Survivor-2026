-- Terry's Survivor 2026 — Cloud data sync v12
-- Central snapshot sync with role-aware validation.

create or replace function public.save_survivor_snapshot(
  target_league uuid,
  next_state jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.league_members%rowtype;
  previous_state jsonb;
  old_player jsonb;
  new_player jsonb;
  actor_email text;
  actor_name text;
begin
  select * into actor
  from public.league_members
  where league_id = target_league and user_id = auth.uid();

  if actor.id is null then
    raise exception 'You are not a member of this survivor league.';
  end if;

  if jsonb_typeof(next_state) <> 'object' then
    raise exception 'Invalid survivor state.';
  end if;

  select state into previous_state
  from public.league_snapshots
  where league_id = target_league
  for update;

  if previous_state is null then
    if actor.role not in ('primary-commissioner', 'co-commissioner') then
      raise exception 'A commissioner must create the first cloud snapshot.';
    end if;
  elsif actor.role = 'player' then
    actor_email := lower(coalesce(actor.email, ''));
    actor_name := lower(actor.display_name);

    select item into old_player
    from jsonb_array_elements(previous_state->'players') item
    where (actor_email <> '' and lower(coalesce(item->>'email', '')) = actor_email)
       or lower(coalesce(item->>'name', '')) = actor_name
    limit 1;

    select item into new_player
    from jsonb_array_elements(next_state->'players') item
    where (actor_email <> '' and lower(coalesce(item->>'email', '')) = actor_email)
       or lower(coalesce(item->>'name', '')) = actor_name
    limit 1;

    if old_player is null or new_player is null then
      raise exception 'Your player record could not be matched.';
    end if;

    if (previous_state - 'players' - 'selectedPlayerId') <> (next_state - 'players' - 'selectedPlayerId') then
      raise exception 'Players may only update their own picks.';
    end if;

    if (old_player - 'picks') <> (new_player - 'picks') then
      raise exception 'Players may only update their own picks.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(previous_state->'players') p
      where p <> old_player
        and not exists (select 1 from jsonb_array_elements(next_state->'players') n where n = p)
    ) then
      raise exception 'Another player record was changed.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(new_player->'picks') p
      group by p->>'week'
      having count(*) > 1
    ) or exists (
      select 1
      from jsonb_array_elements(new_player->'picks') p
      where coalesce(p->>'teamId', '') <> 'NO-PICK'
      group by p->>'teamId'
      having count(*) > 1
    ) then
      raise exception 'A team or week cannot be used twice.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(old_player->'picks') old_pick
      where old_pick->>'result' <> 'pending'
        and not exists (
          select 1 from jsonb_array_elements(new_player->'picks') new_pick
          where new_pick = old_pick
        )
    ) then
      raise exception 'Resolved picks cannot be changed.';
    end if;
  end if;

  insert into public.league_snapshots (league_id, state, updated_at, updated_by)
  values (target_league, next_state, now(), auth.uid())
  on conflict (league_id) do update
    set state = excluded.state,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  insert into public.audit_log (league_id, actor_id, action, entity_type, entity_id, details)
  values (target_league, auth.uid(), 'save_cloud_state', 'league_snapshot', target_league::text,
          jsonb_build_object('role', actor.role, 'week', next_state#>>'{settings,currentWeek}'));
end;
$$;

grant execute on function public.save_survivor_snapshot(uuid, jsonb) to authenticated;
