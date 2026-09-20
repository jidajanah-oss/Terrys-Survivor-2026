begin;

-- The previous snapshot writer chose one arbitrary membership and matched one
-- player by shared email. A second entry owned by that account could not save.
-- Match each changed snapshot entry to the existing, uniquely named cloud member.
create or replace function public.save_survivor_snapshot(target_league uuid, next_state jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  previous_state jsonb;
  old_player jsonb;
  new_player jsonb;
  commissioner boolean := public.is_commissioner(target_league);
begin
  if auth.uid() is null or not public.is_survivor_member(target_league) then
    raise exception 'You are not a member of this survivor league.';
  end if;
  if jsonb_typeof(next_state) is distinct from 'object'
    or jsonb_typeof(next_state->'players') is distinct from 'array' then
    raise exception 'Invalid survivor state.';
  end if;
  select state into previous_state from public.league_snapshots
    where league_id = target_league for update;
  if previous_state is null then
    if not commissioner then raise exception 'A commissioner must create the first cloud snapshot.'; end if;
  elsif not commissioner then
    if (previous_state - 'players' - 'selectedPlayerId') is distinct from (next_state - 'players' - 'selectedPlayerId')
      or jsonb_array_length(previous_state->'players') <> jsonb_array_length(next_state->'players') then
      raise exception 'Players may only update their own picks.';
    end if;
    if exists (select 1 from jsonb_array_elements(next_state->'players') p
      where jsonb_typeof(p->'id') is distinct from 'string')
      or exists (select 1 from jsonb_array_elements(next_state->'players') p
        group by p->>'id' having count(*) > 1) then
      raise exception 'Invalid player identities.';
    end if;
    for old_player in select value from jsonb_array_elements(previous_state->'players') loop
      select p into new_player from jsonb_array_elements(next_state->'players') p
        where p->>'id' = old_player->>'id';
      if new_player is null then raise exception 'Another player record was changed.'; end if;
      if new_player = old_player then continue; end if;
      if not exists (select 1 from public.league_members m where m.league_id = target_league
        and m.user_id = auth.uid()
        and lower(btrim(m.display_name)) = lower(btrim(old_player->>'name')))
        or (old_player - 'picks') is distinct from (new_player - 'picks') then
        raise exception 'Players may only update their own picks.';
      end if;
      if jsonb_typeof(new_player->'picks') is distinct from 'array' then
        raise exception 'Invalid picks.';
      end if;
      if exists (select 1 from jsonb_array_elements(new_player->'picks') p
        group by p->>'week' having count(*) > 1)
        or exists (select 1 from jsonb_array_elements(new_player->'picks') p
          where coalesce(p->>'teamId', '') <> 'NO-PICK'
          group by p->>'teamId' having count(*) > 1) then
        raise exception 'A team or week cannot be used twice.';
      end if;
      if exists (select 1 from jsonb_array_elements(old_player->'picks') old_pick
        where old_pick->>'result' <> 'pending' and not exists (
          select 1 from jsonb_array_elements(new_player->'picks') new_pick where new_pick = old_pick)) then
        raise exception 'Resolved picks cannot be changed.';
      end if;
      -- Players cannot manufacture finalized outcomes on new/changed picks.
      if exists (select 1 from jsonb_array_elements(new_player->'picks') new_pick
        where not exists (select 1 from jsonb_array_elements(old_player->'picks') old_pick where old_pick = new_pick)
          and new_pick->>'result' is distinct from 'pending') then
        raise exception 'Only commissioners may resolve picks.';
      end if;
    end loop;
  end if;

  insert into public.league_snapshots(league_id, state, updated_at, updated_by)
    values (target_league, next_state, now(), auth.uid())
  on conflict (league_id) do update set state = excluded.state,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  insert into public.audit_log(league_id, actor_id, action, entity_type, entity_id, details)
    values (target_league, auth.uid(), 'save_cloud_state', 'league_snapshot', target_league::text,
      jsonb_build_object('commissioner', commissioner, 'week', next_state#>>'{settings,currentWeek}'));
end;
$$;

revoke all on function public.save_survivor_snapshot(uuid, jsonb) from public, anon;
grant execute on function public.save_survivor_snapshot(uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
