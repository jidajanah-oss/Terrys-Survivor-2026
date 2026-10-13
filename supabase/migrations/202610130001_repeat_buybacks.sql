begin;
-- Validate buyback transitions, including commissioner snapshot saves.
create or replace function public.validate_survivor_buyback()
returns trigger language plpgsql set search_path = '' as $$
declare
  prior jsonb;
  entry jsonb;
  cutoff integer;
  loss_week integer;
begin
  cutoff := (old.state #>> '{settings,buybackThroughWeek}')::integer;
  for entry in select value from jsonb_array_elements(new.state->'players') loop
    select value into prior from jsonb_array_elements(old.state->'players')
      where value->>'id' = entry->>'id';
    if prior is null then continue; end if;
    if coalesce((entry->>'buybacks')::integer, 0) > coalesce((prior->>'buybacks')::integer, 0) then
      loss_week := (prior->>'eliminatedWeek')::integer;
      if prior->>'status' is distinct from 'eliminated'
        or (entry->>'buybacks')::integer <> coalesce((prior->>'buybacks')::integer, 0) + 1
        or loss_week is null or loss_week < 1 or cutoff is null or loss_week > cutoff then
        raise exception 'A buyback is allowed only for an entry eliminated in Weeks 1 through %.', cutoff;
      end if;
      if entry->>'status' is distinct from 'active'
        or (entry->>'restoredThroughWeek')::integer is distinct from loss_week
        or entry->>'eliminatedWeek' is not null then
        raise exception 'A buyback must restore the eligible elimination.';
      end if;
      if entry->'picks' is distinct from prior->'picks' then
        raise exception 'Buyback must preserve all picks and used-team history.';
      end if;
      if exists (select 1 from jsonb_array_elements(old.state->'payments') previous
        where not exists (select 1 from jsonb_array_elements(new.state->'payments') payment where payment = previous)) then
        raise exception 'Buyback must preserve existing payments.';
      end if;
      if not exists (select 1 from jsonb_array_elements(new.state->'payments') payment
        where payment->>'playerId' = entry->>'id' and payment->>'type' = 'buyback'
          and (payment->>'amount')::numeric = (old.state#>>'{settings,buybackFee}')::numeric
          and (payment->>'week')::integer = (new.state#>>'{settings,currentWeek}')::integer
          and not exists (select 1 from jsonb_array_elements(old.state->'payments') previous where previous = payment)) then
        raise exception 'Buyback requires a payment at the configured fee.';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists validate_survivor_buyback on public.league_snapshots;
create trigger validate_survivor_buyback before update on public.league_snapshots
for each row execute function public.validate_survivor_buyback();
commit;
