# Terry's Survivor 2026 — Cloud League Data Sync v12

This package makes the shared Supabase league snapshot the active data source after sign-in.

## Added
- Loads shared league state from Supabase after authentication.
- Creates the first cloud snapshot from the commissioner's existing local league data.
- Debounced cloud saves with visible Loading / Saving / Cloud saved / Error status.
- Local fallback copy retained on every device.
- Commissioner changes sync across devices.
- Ordinary players may update only their own picks.
- Database validation prevents duplicate team use, duplicate weekly picks, resolved-pick edits, and changes to another player's record.
- Audit log entry for cloud saves.

## Required migration
Run `supabase/migrations/202607160003_cloud_data_sync.sql` in the Supabase SQL Editor before starting v12.

## Environment
Copy your working `.env.local` from v11 into this app folder. Never commit it.
