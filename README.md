# Terry’s Survivor 2026 — Supabase Auth + Database Foundation v9

This package preserves every v8 feature and adds the real cloud foundation:

- `@supabase/supabase-js` browser client
- persistent Supabase Auth session service and magic-link entry point
- typed client boundary
- normalized SQL schema for leagues, members, picks, payments, NFL games, week closeout, and audit history
- Row Level Security policies for players and commissioners
- database constraints preventing a player from using the same team twice in the season
- unique Primary Commissioner and Co-Commissioner assignments per league
- temporary cloud snapshot repository for safe local-to-cloud migration
- local development remains operational before credentials are configured

## Run

```powershell
npm install
npm run dev
```

## Build

```powershell
npm run build
```

See `docs/SUPABASE_SETUP.md` before connecting a Supabase project.
