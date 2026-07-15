# Supabase setup checkpoint

This package does not require Supabase to run locally. Local browser storage remains active until cloud onboarding is performed.

1. Create a Supabase project.
2. Open SQL Editor and run `supabase/migrations/202607150001_survivor_foundation.sql`.
3. Copy `.env.example` to `.env.local`.
4. Add the project URL and anon/publishable key.
5. Add the local and GitHub Pages URLs to Supabase Auth redirect URLs.
6. Restart `npm run dev` after changing environment values.

Never place a service-role key in Vite environment variables or browser code.
