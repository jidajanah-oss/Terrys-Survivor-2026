-- Terry's Survivor 2026 — Supabase login and account linking v10

create or replace function public.handle_new_survivor_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'Player'), '@', 1)),
    new.email
  )
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_survivor on auth.users;
create trigger on_auth_user_created_survivor
after insert or update of email on auth.users
for each row execute function public.handle_new_survivor_user();

create policy "users insert own profile" on public.profiles
for insert to authenticated
with check (id = auth.uid());

create or replace function public.get_my_survivor_membership()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'leagueId', m.league_id,
    'memberId', m.id,
    'displayName', m.display_name,
    'email', coalesce(m.email, ''),
    'role', m.role,
    'status', m.status
  )
  from public.league_members m
  where m.user_id = auth.uid()
  order by m.joined_at
  limit 1;
$$;

grant execute on function public.get_my_survivor_membership() to authenticated;

create or replace function public.claim_survivor_membership()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  account_email text;
  claimed public.league_members;
begin
  select lower(email) into account_email from auth.users where id = auth.uid();
  if account_email is null then return null; end if;

  update public.league_members
  set user_id = auth.uid()
  where id = (
    select id from public.league_members
    where user_id is null and lower(email) = account_email
    order by joined_at
    limit 1
  )
  returning * into claimed;

  if claimed.id is null then
    select * into claimed from public.league_members where user_id = auth.uid() order by joined_at limit 1;
  end if;

  if claimed.id is null then return null; end if;

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

grant execute on function public.claim_survivor_membership() to authenticated;

create or replace function public.bootstrap_survivor_league(requested_display_name text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  account_email text;
  created_league public.leagues;
  created_member public.league_members;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if exists (select 1 from public.leagues) then raise exception 'A survivor league already exists. Ask a commissioner to add your email.'; end if;

  select email into account_email from auth.users where id = auth.uid();

  insert into public.leagues (name, season, current_week, entry_fee_cents, buyback_fee_cents, buyback_through_week)
  values ('Terry''s Survivor 2026', 2026, 1, 2000, 2000, 5)
  returning * into created_league;

  insert into public.league_members (league_id, user_id, display_name, email, role, status)
  values (created_league.id, auth.uid(), coalesce(nullif(trim(requested_display_name), ''), 'Terry'), account_email, 'primary-commissioner', 'active')
  returning * into created_member;

  insert into public.profiles (id, display_name, email)
  values (auth.uid(), created_member.display_name, account_email)
  on conflict (id) do update set display_name = excluded.display_name, email = excluded.email, updated_at = now();

  return jsonb_build_object(
    'leagueId', created_member.league_id,
    'memberId', created_member.id,
    'displayName', created_member.display_name,
    'email', coalesce(created_member.email, ''),
    'role', created_member.role,
    'status', created_member.status
  );
end;
$$;

grant execute on function public.bootstrap_survivor_league(text) to authenticated;
