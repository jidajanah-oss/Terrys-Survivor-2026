# Survivor standings kickoff display

Run `node verification/pick-visibility.cjs` for the boundary and rendering checks.
Run `npm run dev -- --config verification/vite.config.ts --configLoader runner --host 127.0.0.1` and open `/verification/index.html` for a synthetic board. Click **Kick off in 10 seconds**; the mounted board must reveal both teams and the empty entry without reloading. Reload to verify it starts hidden again. No cloud credentials or real player data are used by this fixture.

Production source changes: `src/App.tsx`, `src/components/BoardPage.tsx`, `src/services/pickVisibility.ts`.

Before the first eligible kickoff of each week, the board masks all entries, including the viewer and commissioners, and excludes that week's teams from Used. Missing or invalid schedule information keeps picks hidden. Canceled and postponed games do not trigger the reveal. A one-second timer plus focus/visibility refresh handles an open or resumed board. Own pick screens, saved picks, and individual game lock rules are unchanged.

This is a standings display rule. Existing full-snapshot cloud reads and commissioner tools are unchanged; this does not restrict access to raw data through developer tools. No database migration is included.
