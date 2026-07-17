# Terry's Survivor 2026 — Live NFL Schedule + Automatic Scoring v13

Version 0.13.0 adds the production path for real NFL schedules and automatic survivor results.

## What changed

- Supabase Edge Function: `sync-nfl-week`
- Server-side NFL schedule and final-score retrieval
- Current-week schedule stored in the shared cloud snapshot
- Live kickoff time, game status, and final scores in the app
- Automatic win/loss/tie resolution when a selected game is final
- Automatic elimination for losses and ties
- Commissioner manual correction controls remain available
- Picks lock when the selected NFL game starts
- Cloud clients refresh the shared snapshot every 60 seconds
- GitHub Pages magic-link redirect is calculated from the page currently being used
- PWA cache version advanced to v13
- Sync run and audit history in Supabase

## Data provider

The included Edge Function uses ESPN's public scoreboard JSON endpoint by default. It is an unofficial endpoint, so the function has a provider boundary and strong error handling. Set the optional Edge Function secret `NFL_SCOREBOARD_BASE_URL` later if the league moves to a contracted sports-data provider.

## Install locally

1. Extract this package.
2. Copy the working `.env.local` from the Git-connected project into this package. Never commit `.env.local`.
3. Run:

```powershell
npm install --registry=https://registry.npmjs.org/ --no-audit --no-fund
npm run dev
```

## Supabase migration

Run this file in Supabase SQL Editor:

```text
supabase/migrations/202607160004_live_nfl_auto_scoring.sql
```

## Deploy the Edge Function

### Supabase CLI method

From this project's root folder:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy sync-nfl-week --no-verify-jwt
```

The project reference is the first part of the Supabase project URL:

```text
https://YOUR_PROJECT_REF.supabase.co
```

### Dashboard method

Create an Edge Function named `sync-nfl-week` in the Supabase dashboard and paste the full contents of:

```text
supabase/functions/sync-nfl-week/index.ts
```

Disable automatic JWT verification for this function. The function performs its own authorization so signed-in commissioners can run it manually and a secure scheduled backend call can run it centrally.

## First live test

1. Sign in as Terry or Jimbo.
2. Open Commissioner HQ.
3. Press **Check Live NFL Schedule & Results**.
4. Confirm Week 1 games display real kickoff times.
5. The button may be run repeatedly; only pending picks tied to final games are resolved.

## Automatic background schedule

After the manual live test passes, schedule the Edge Function through Supabase Cron. A template is included at:

```text
supabase/cron/2026_nfl_sync_schedule.sql.example
```

Store the function URL and legacy service-role JWT in Supabase Vault. Never put the service-role value in GitHub, `.env.local`, or browser code.

## Important survivor behavior

- A buyback restores life only.
- Used teams never reset.
- Ties count as elimination.
- Postponed or canceled games remain unresolved for commissioner review.
- Automatic processing never overwrites a result already resolved by a commissioner.
