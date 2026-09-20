begin;

-- Credentials are separate from the roster and never contain a PIN or Auth password.
create table public.survivor_pin_credentials (
  member_id uuid primary key references public.league_members(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  pin_hash text not null,
  enabled boolean not null default true,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  version uuid not null default gen_random_uuid(),
  last_success_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id)
);
create table public.survivor_pin_rate_limit (
  id boolean primary key default true check (id),
  window_start timestamptz not null,
  attempts integer not null
);
insert into public.survivor_pin_rate_limit values (true, now(), 0);
alter table public.survivor_pin_credentials enable row level security;
alter table public.survivor_pin_rate_limit enable row level security;
revoke all on public.survivor_pin_credentials, public.survivor_pin_rate_limit
  from public, anon, authenticated;
grant all on public.survivor_pin_credentials, public.survivor_pin_rate_limit to service_role;

-- Check the WHOLE account, including entries that email claiming would attach.
-- A normal entry sharing a commissioner's account must not become a back door.
create function public.survivor_pin_eligible(target_member uuid, target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.league_members m join auth.users u on u.id = target_user
    where m.id = target_member and m.role = 'player'
      and (m.user_id is null or m.user_id = u.id)
      and lower(btrim(m.email)) = lower(btrim(u.email))
      and coalesce(u.role, '') = 'authenticated'
      and (u.banned_until is null or u.banned_until <= now())
      and not exists (
        select 1 from public.league_members privileged
        where privileged.role <> 'player'
          and (privileged.user_id = u.id
            or lower(btrim(privileged.email)) = lower(btrim(u.email)))
      )
  );
$$;

-- One bounded row, shared across Edge instances; no client-supplied IP trust.
create function public.survivor_pin_take_attempt()
returns boolean language plpgsql security definer set search_path = '' as $$
declare bucket public.survivor_pin_rate_limit;
begin
  select * into bucket from public.survivor_pin_rate_limit where id for update;
  if bucket.window_start <= clock_timestamp() - interval '1 minute' then
    update public.survivor_pin_rate_limit set window_start = clock_timestamp(), attempts = 1 where id;
    return true;
  end if;
  if bucket.attempts >= 60 then return false; end if;
  update public.survivor_pin_rate_limit set attempts = attempts + 1 where id;
  return true;
end;
$$;

-- The Edge function verifies the bearer token; SQL independently checks its user ID.
create function public.survivor_pin_manage_context(actor uuid, target_league uuid, target_member uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.league_members; u uuid; c public.survivor_pin_credentials;
begin
  if not exists (select 1 from public.league_members where league_id = target_league
    and user_id = actor and role in ('primary-commissioner', 'co-commissioner')) then
    raise exception 'Commissioner access is required';
  end if;
  select * into m from public.league_members where id = target_member and league_id = target_league;
  if m.id is null then raise exception 'Survivor entry not found'; end if;
  if m.role <> 'player' or coalesce(btrim(m.email), '') = '' then
    raise exception 'Use email sign-in for commissioners. Players need an assigned email before PIN setup.';
  end if;
  select id into u from auth.users where lower(btrim(email)) = lower(btrim(m.email));
  if exists (select 1 from public.league_members where role <> 'player'
    and (user_id = coalesce(m.user_id, u) or lower(btrim(email)) = lower(btrim(m.email))))
    or (m.user_id is not null and m.user_id is distinct from u)
    or (u is not null and not public.survivor_pin_eligible(m.id, u)) then
    raise exception 'This account must use email sign-in. Check its account linkage and roles.';
  end if;
  select * into c from public.survivor_pin_credentials where member_id = m.id;
  return jsonb_build_object('email', lower(btrim(m.email)), 'authUserId', u,
    'configured', c.member_id is not null, 'enabled', coalesce(c.enabled, false),
    'locked', coalesce(c.failed_attempts >= 5, false), 'lastSuccessAt', c.last_success_at);
end;
$$;

create function public.survivor_pin_configure(actor uuid, target_league uuid, target_member uuid,
  target_user uuid, pin_material text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare context jsonb;
begin
  -- Lock the entry, then recheck after any concurrent claim/commissioner edit.
  perform 1 from public.league_members where id = target_member for update;
  context := public.survivor_pin_manage_context(actor, target_league, target_member);
  if pin_material is null or pin_material !~ '^[0-9a-f]{64}$'
    or not public.survivor_pin_eligible(target_member, target_user) then
    raise exception 'PIN setup could not be completed';
  end if;
  -- Only establish a missing link. Never replace an owner or insert a player.
  update public.league_members set user_id = target_user
    where id = target_member and user_id is null;
  insert into public.survivor_pin_credentials(member_id, auth_user_id, pin_hash, updated_by)
    values (target_member, target_user, crypt(pin_material, gen_salt('bf', 10)), actor)
  on conflict (member_id) do update set auth_user_id = excluded.auth_user_id,
    pin_hash = excluded.pin_hash, enabled = true, failed_attempts = 0,
    version = gen_random_uuid(), updated_at = now(), updated_by = actor;
  insert into public.audit_log(league_id, actor_id, action, entity_type, entity_id)
    values (target_league, actor, 'set_survivor_pin', 'league_member', target_member::text);
end;
$$;

create function public.survivor_pin_disable(actor uuid, target_league uuid, target_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Allow disabling even if the owner has since changed email or role.
  if not exists (select 1 from public.league_members where league_id = target_league
    and user_id = actor and role in ('primary-commissioner', 'co-commissioner'))
    or not exists (select 1 from public.league_members where id = target_member and league_id = target_league) then
    raise exception 'Commissioner access is required';
  end if;
  update public.survivor_pin_credentials set enabled = false, version = gen_random_uuid(),
    updated_at = now(), updated_by = actor where member_id = target_member;
  insert into public.audit_log(league_id, actor_id, action, entity_type, entity_id)
    values (target_league, actor, 'disable_survivor_pin', 'league_member', target_member::text);
end;
$$;

create function public.survivor_pin_verify(target_league uuid, entry_name text, pin_material text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare c public.survivor_pin_credentials; m public.league_members;
begin
  if not public.survivor_pin_take_attempt() then return jsonb_build_object('limited', true); end if;
  select * into m from public.league_members where league_id = target_league
    and lower(btrim(display_name)) = lower(btrim(entry_name));
  select * into c from public.survivor_pin_credentials where member_id = m.id for update;
  if c.member_id is null or not c.enabled or c.failed_attempts >= 5
    or m.user_id is distinct from c.auth_user_id
    or not public.survivor_pin_eligible(m.id, c.auth_user_id) then return null; end if;
  if pin_material is null or pin_material !~ '^[0-9a-f]{64}$'
    or crypt(pin_material, c.pin_hash) <> c.pin_hash then
    -- Returning (not raising) commits the failure. Row lock prevents lost increments.
    update public.survivor_pin_credentials set failed_attempts = failed_attempts + 1 where member_id = m.id;
    return null;
  end if;
  update public.survivor_pin_credentials set failed_attempts = 0 where member_id = m.id;
  return jsonb_build_object('memberId', m.id, 'authUserId', c.auth_user_id,
    'email', lower(btrim(m.email)), 'version', c.version);
end;
$$;

-- Recheck after Auth issues the session: reset, disable, relink or role changes fail closed.
create function public.survivor_pin_finish(target_member uuid, target_user uuid, credential_version uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.survivor_pin_credentials c set last_success_at = now()
  where c.member_id = target_member and c.auth_user_id = target_user and c.enabled
    and c.failed_attempts < 5 and c.version = credential_version
    and public.survivor_pin_eligible(target_member, target_user)
    and exists (select 1 from public.league_members where id = target_member and user_id = target_user);
  return found;
end;
$$;

revoke all on function public.survivor_pin_eligible(uuid, uuid), public.survivor_pin_take_attempt(),
  public.survivor_pin_manage_context(uuid, uuid, uuid),
  public.survivor_pin_configure(uuid, uuid, uuid, uuid, text),
  public.survivor_pin_disable(uuid, uuid, uuid), public.survivor_pin_verify(uuid, text, text),
  public.survivor_pin_finish(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.survivor_pin_eligible(uuid, uuid), public.survivor_pin_take_attempt(),
  public.survivor_pin_manage_context(uuid, uuid, uuid),
  public.survivor_pin_configure(uuid, uuid, uuid, uuid, text),
  public.survivor_pin_disable(uuid, uuid, uuid), public.survivor_pin_verify(uuid, text, text),
  public.survivor_pin_finish(uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
