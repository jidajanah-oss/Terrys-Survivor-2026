-- Terry's Survivor 2026
-- Final database permission and RLS repairs applied manually after v13.
--
-- This migration is deliberately narrow and idempotent.
-- It does not alter Supabase secrets, Vault, pg_cron, pg_net,
-- terrys-survivor-live-nfl-sync, or the sync-nfl-week Edge Function.
-- It also does not replace Head2Head Brawlin's generic
-- public.is_league_member(uuid) helper.

begin;

-- Survivor-only membership helper.
-- SECURITY DEFINER prevents recursive league_members RLS evaluation.
create or replace function public.is_survivor_member(target_league uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1
    from public.league_members
    where league_id = target_league
      and user_id = auth.uid()
  );
$function$;

grant execute on function public.is_survivor_member(uuid)
  to authenticated;

-- Replace only the three Survivor read policies that require membership
-- checks. Dedicated helper naming avoids changing Head2Head functions.
drop policy if exists "members read league roster"
  on public.league_members;

create policy "members read league roster"
  on public.league_members
  for select
  to authenticated
  using (public.is_survivor_member(league_id));

drop policy if exists "members read leagues"
  on public.leagues;

create policy "members read leagues"
  on public.leagues
  for select
  to authenticated
  using (public.is_survivor_member(id));

drop policy if exists "members read snapshots"
  on public.league_snapshots;

create policy "members read snapshots"
  on public.league_snapshots
  for select
  to authenticated
  using (public.is_survivor_member(league_id));

-- Explicit authenticated Data API permissions applied after v13.
-- RLS continues to control which rows are visible.
grant usage on schema public to authenticated;

grant select on table
  public.leagues,
  public.league_members,
  public.league_snapshots,
  public.nfl_games
to authenticated;

-- Explicit server-side permissions applied for sync-nfl-week.
-- service_role remains server-side and is never exposed to the browser.
grant usage on schema public to service_role;

grant select, insert, update, delete on table
  public.leagues,
  public.league_members,
  public.league_snapshots,
  public.nfl_games
to service_role;

grant usage, select on all sequences in schema public
  to service_role;

-- Refresh PostgREST after function, policy, and privilege changes.
notify pgrst, 'reload schema';

commit;
