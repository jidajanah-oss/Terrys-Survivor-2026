-- Terry's Survivor 2026 — Live NFL schedule + automatic scoring v13

alter table public.nfl_games
  add column if not exists provider text not null default 'espn-scoreboard',
  add column if not exists status_detail text;

create table if not exists public.nfl_sync_runs (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  season integer not null,
  week integer not null check (week between 1 and 18),
  provider text not null,
  games_fetched integer not null default 0,
  final_games integer not null default 0,
  picks_resolved integer not null default 0,
  players_eliminated integer not null default 0,
  triggered_by uuid references auth.users(id),
  status text not null default 'success',
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists nfl_sync_runs_league_week_idx
  on public.nfl_sync_runs (league_id, season, week, started_at desc);

alter table public.nfl_sync_runs enable row level security;

drop policy if exists "commissioners read nfl sync runs" on public.nfl_sync_runs;
create policy "commissioners read nfl sync runs"
  on public.nfl_sync_runs
  for select
  to authenticated
  using (public.is_commissioner(league_id));

-- Let signed-in league members read the centrally maintained NFL schedule.
grant select on public.nfl_games to authenticated;
grant select on public.nfl_sync_runs to authenticated;

-- Make cloud snapshot changes available to future realtime subscriptions.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'league_snapshots'
  ) then
    alter publication supabase_realtime add table public.league_snapshots;
  end if;
exception
  when undefined_object then
    null;
end;
$$;
