-- Terry's Survivor 2026 — Supabase foundation v9
create extension if not exists pgcrypto;

create type public.survivor_role as enum ('primary-commissioner', 'co-commissioner', 'player');
create type public.player_status as enum ('active', 'eliminated');
create type public.pick_result as enum ('pending', 'win', 'loss', 'tie', 'no-pick');
create type public.payment_type as enum ('initial-entry', 'buyback');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  season integer not null check (season >= 2026),
  current_week integer not null default 1 check (current_week between 1 and 18),
  entry_fee_cents integer not null default 2000 check (entry_fee_cents >= 0),
  buyback_fee_cents integer not null default 2000 check (buyback_fee_cents >= 0),
  buyback_through_week integer not null default 5 check (buyback_through_week between 1 and 18),
  created_at timestamptz not null default now()
);

create table public.league_members (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  email text,
  role public.survivor_role not null default 'player',
  status public.player_status not null default 'active',
  buybacks integer not null default 0 check (buybacks >= 0),
  eliminated_week integer check (eliminated_week between 1 and 18),
  joined_at timestamptz not null default now(),
  unique (league_id, user_id)
);

create unique index one_primary_commissioner_per_league
  on public.league_members (league_id) where role = 'primary-commissioner';
create unique index one_co_commissioner_per_league
  on public.league_members (league_id) where role = 'co-commissioner';

create table public.nfl_games (
  id text primary key,
  season integer not null,
  week integer not null check (week between 1 and 18),
  away_team_id text not null,
  home_team_id text not null,
  kickoff timestamptz not null,
  status text not null default 'scheduled',
  away_score integer,
  home_score integer,
  provider_updated_at timestamptz
);

create table public.survivor_picks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  member_id uuid not null references public.league_members(id) on delete cascade,
  week integer not null check (week between 1 and 18),
  game_id text not null references public.nfl_games(id),
  team_id text not null,
  result public.pick_result not null default 'pending',
  submitted_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_source text,
  unique (league_id, member_id, week),
  unique (league_id, member_id, team_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  member_id uuid not null references public.league_members(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  type public.payment_type not null,
  week integer not null check (week between 1 and 18),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table public.week_status (
  league_id uuid not null references public.leagues(id) on delete cascade,
  week integer not null check (week between 1 and 18),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  primary key (league_id, week)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  league_id uuid references public.leagues(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Temporary migration bridge. The normalized tables above remain the target model.
create table public.league_snapshots (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create or replace function public.is_commissioner(target_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.league_members
    where league_id = target_league
      and user_id = auth.uid()
      and role in ('primary-commissioner', 'co-commissioner')
  );
$$;

alter table public.profiles enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.nfl_games enable row level security;
alter table public.survivor_picks enable row level security;
alter table public.payments enable row level security;
alter table public.week_status enable row level security;
alter table public.audit_log enable row level security;
alter table public.league_snapshots enable row level security;

create policy "authenticated can read profiles" on public.profiles for select to authenticated using (true);
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "members read leagues" on public.leagues for select to authenticated using (
  exists (select 1 from public.league_members m where m.league_id = id and m.user_id = auth.uid())
);
create policy "members read league roster" on public.league_members for select to authenticated using (
  exists (select 1 from public.league_members me where me.league_id = league_id and me.user_id = auth.uid())
);
create policy "commissioners manage league roster" on public.league_members for all to authenticated
  using (public.is_commissioner(league_id)) with check (public.is_commissioner(league_id));
create policy "authenticated read nfl games" on public.nfl_games for select to authenticated using (true);
create policy "members read league picks" on public.survivor_picks for select to authenticated using (
  exists (select 1 from public.league_members me where me.league_id = league_id and me.user_id = auth.uid())
);
create policy "players submit own picks" on public.survivor_picks for insert to authenticated with check (
  exists (select 1 from public.league_members me where me.id = member_id and me.league_id = league_id and me.user_id = auth.uid())
);
create policy "players update own pending picks" on public.survivor_picks for update to authenticated using (
  result = 'pending' and exists (select 1 from public.league_members me where me.id = member_id and me.user_id = auth.uid())
) with check (
  exists (select 1 from public.league_members me where me.id = member_id and me.user_id = auth.uid())
);
create policy "commissioners manage picks" on public.survivor_picks for all to authenticated
  using (public.is_commissioner(league_id)) with check (public.is_commissioner(league_id));
create policy "members read payments" on public.payments for select to authenticated using (
  exists (select 1 from public.league_members me where me.league_id = league_id and me.user_id = auth.uid())
);
create policy "commissioners manage payments" on public.payments for all to authenticated
  using (public.is_commissioner(league_id)) with check (public.is_commissioner(league_id));
create policy "members read week status" on public.week_status for select to authenticated using (
  exists (select 1 from public.league_members me where me.league_id = league_id and me.user_id = auth.uid())
);
create policy "commissioners manage week status" on public.week_status for all to authenticated
  using (public.is_commissioner(league_id)) with check (public.is_commissioner(league_id));
create policy "commissioners read audit log" on public.audit_log for select to authenticated using (public.is_commissioner(league_id));
create policy "members read snapshots" on public.league_snapshots for select to authenticated using (
  exists (select 1 from public.league_members me where me.league_id = league_id and me.user_id = auth.uid())
);
create policy "commissioners manage snapshots" on public.league_snapshots for all to authenticated
  using (public.is_commissioner(league_id)) with check (public.is_commissioner(league_id));
