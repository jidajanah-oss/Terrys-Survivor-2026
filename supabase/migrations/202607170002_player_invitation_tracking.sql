-- Terry's Survivor 2026
-- v15 commissioner safety and player invitation tracking.
--
-- This migration does not alter Supabase secrets, Vault, pg_cron, pg_net,
-- terrys-survivor-live-nfl-sync, or the sync-nfl-week Edge Function.

begin;

alter table public.league_members
  add column if not exists last_invite_sent_at timestamptz;

alter table public.league_members
  add column if not exists last_invite_sent_by uuid
    references auth.users(id)
    on delete set null;

alter table public.league_members
  add column if not exists invite_send_count integer not null default 0;

do $block$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'league_members_invite_send_count_nonnegative'
      and conrelid = 'public.league_members'::regclass
  ) then
    alter table public.league_members
      add constraint league_members_invite_send_count_nonnegative
      check (invite_send_count >= 0);
  end if;
end;
$block$;

create or replace function public.record_survivor_invite_sent(
  target_league uuid,
  target_member uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  saved_member public.league_members%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_commissioner(target_league) then
    raise exception 'Commissioner access is required';
  end if;

  select *
  into saved_member
  from public.league_members
  where id = target_member
    and league_id = target_league;

  if saved_member.id is null then
    raise exception 'The survivor roster member was not found';
  end if;

  if saved_member.user_id is not null then
    raise exception 'This survivor account is already linked';
  end if;

  if nullif(trim(coalesce(saved_member.email, '')), '') is null then
    raise exception 'Add the player email before sending an invitation';
  end if;

  update public.league_members
  set
    last_invite_sent_at = now(),
    last_invite_sent_by = auth.uid(),
    invite_send_count = coalesce(invite_send_count, 0) + 1
  where id = target_member
    and league_id = target_league
  returning * into saved_member;

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
    'send_player_invite',
    'league_member',
    saved_member.id::text,
    jsonb_build_object(
      'invite_send_count', saved_member.invite_send_count,
      'last_invite_sent_at', saved_member.last_invite_sent_at,
      'role', saved_member.role
    )
  );

  return jsonb_build_object(
    'membershipId', saved_member.id,
    'lastInviteSentAt', saved_member.last_invite_sent_at,
    'inviteSendCount', saved_member.invite_send_count
  );
end;
$function$;

revoke all on function public.record_survivor_invite_sent(uuid, uuid)
  from public;

grant execute on function public.record_survivor_invite_sent(uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
