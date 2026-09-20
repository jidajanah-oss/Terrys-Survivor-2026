# Survivor 4-digit PIN access

## Release status

Implemented and tested locally on the existing Survivor working tree (base Git commit `5147ced`, including the pre-existing, uncommitted survival-status fixes). Production Supabase, player PINs, and the published website have not been changed. The patch contains only this feature's changes; it does not replace the earlier uncommitted fixes.

## Player and commissioner behavior

- Players enter their exact Survivor **entry name** (case and surrounding spaces are ignored) and four numeric digits. Leading zeroes work. There is no public roster/email directory on the sign-in page.
- **Use Email Instead** retains the current OTP flow.
- Terry and Jimbo sign in by email, open Commissioner HQ → **4-digit PIN access**, select an existing cloud entry, and set/reset or disable its PIN. Two matching PIN inputs are required. Share the PIN privately; it is not recoverable from the database.
- Five wrong PIN guesses lock that entry's PIN until a commissioner sets a new one. This lock has no automatic expiry; email OTP remains available. A separate atomic server-wide limit allows 60 attempts per minute, including unknown names.
- A PIN opens the owner's **same Supabase Auth user/session permissions**, including all other linked entries. It is not an entry-restricted account. Each entry's PIN is configured/disabled separately.
- Any account with a Survivor commissioner role is ineligible for PIN access, including ordinary entries sharing a commissioner's user ID or email and unclaimed commissioner entries with that email. Both commissioners retain their usual email access.
- PIN setup requires an assigned roster email. Existing account links are never replaced. If the owner has never signed in, setup creates only the missing Auth account and links the selected existing member; the normal email-claim flow handles other entries. It does not insert a new `league_members` record or reset history.
- Disabling/resetting a PIN blocks new PIN logins and invalidates in-flight login completion. It does **not** sign out existing sessions, revoke email OTP, or disable another linked entry's PIN. To respond to account compromise, revoke the account's sessions through Supabase Auth as a separate account-management action.

## Security and identity design

Head2Head's migration, Edge Function, service, and manager panel were reviewed as requested. Its implementation replaces an email account link and uses a derived Auth password; that behavior was deliberately not copied into Survivor because email OTP and existing account linkage must remain available.

The Survivor Edge Function validates exactly four ASCII digits, HMACs the PIN using a dedicated server-only pepper and a league-specific domain string, and passes only the 64-character result to PostgreSQL. PostgreSQL applies bcrypt with a fresh random salt and cost 10. Neither the PIN, the reusable HMAC material, nor an Auth password is persisted. The credential table and all sensitive RPCs are inaccessible to `anon` and `authenticated`; only the service role can use them. Security-definer management RPCs independently verify the authenticated actor is a commissioner in the target league.

Verification and failed-attempt counting use a database row lock, not a read/modify/write sequence in the Edge Function. The global limiter uses one locked row, so it cannot grow without bound and does not trust spoofable client IP headers. Unknown, disabled, wrong, and locked credentials use the same public error. Database/Auth failures fail closed. No request bodies, PIN material, token payloads, or upstream error objects are logged by the function.

After PIN validation, the server generates and consumes an internal Supabase email token for the existing Auth user. It verifies both returned Auth user IDs, checks credential version/linkage/roles again, and returns the normal access and refresh tokens to `auth.setSession`. No custom JWT, browser-only identity, alternate player, or client-chosen role is introduced. Token generation does not send email. An outstanding email OTP may be superseded by this internal token generation; requesting a fresh email code remains available.

The second migration fixes an existing multi-entry snapshot permission bug discovered by a failing database regression test. It checks every changed entry against the authenticated owner's unique cloud entry name and preserves the other records. It blocks role/payment/history changes, new/removed players, duplicate IDs/teams/weeks, and player-written finalized results. This applies equally to normal OTP and PIN sessions. It retains the existing snapshot storage model and is not a rewrite of game-lock/scoring rules.

## Deploy backend first

1. Confirm the Supabase project used by the live Survivor site's `VITE_SUPABASE_URL`. Do not assume a previously linked CLI project or Head2Head's project is correct. Back up the current database and record the frontend release revision.
2. Confirm all prior Survivor migrations through `20260907122500_survivor_multi_entry_accounts.sql` are already applied. In Supabase SQL Editor run these **two new files in order**, or apply them through the project's normal reviewed migration process:

   - `supabase/migrations/20260920010000_survivor_pin_access.sql`
   - `supabase/migrations/20260920011000_survivor_multi_entry_pick_permissions.sql`

   Do not rerun historical foundation migrations against an existing league. `pgcrypto` must already be installed (the foundation migration installs it); both the usual `extensions` schema and the historical `public` placement are supported.
3. In Supabase Edge Function Secrets, set:

   | Secret | Value |
   |---|---|
   | `SURVIVOR_PIN_LEAGUE_ID` | The UUID of Terry's existing Survivor league |
   | `SURVIVOR_PIN_PEPPER` | A newly generated random secret with at least 32 bytes of entropy, encoded as 64 hex characters |
   | `SURVIVOR_PIN_ALLOWED_ORIGINS` | `https://survivor.poolplayhub.com` plus any other actual supported origins, comma-separated with no path or trailing slash |

   Store the pepper in a secure secret manager as well. Do not put it in `VITE_*`, source code, a migration, chat, or a committed environment file. Rotating/loss of this pepper requires resetting every enabled PIN; email OTP is unaffected. Supabase URL, publishable/anon key and secret/service-role key come from the standard Edge runtime variables.
4. Deploy both files in the function directory using the CLI, specifying the correct project explicitly:

   ```powershell
   npx supabase functions deploy survivor-pin-access --project-ref YOUR_SURVIVOR_PROJECT_REF --no-verify-jwt
   ```

   `supabase/config.toml` also marks this function `verify_jwt = false` because login is anonymous. The function verifies bearer tokens and commissioner permissions for all management operations. CORS is not used as authorization. Do not deploy this as only the `index.ts` file in a single-file editor; it imports `handler.ts`.
5. Build with the existing production frontend environment values and publish using the site's existing GitHub Pages workflow. No new frontend secrets are required. Preserve the existing `docs/CNAME` and production Supabase configuration. The package's local test build has no production credentials and should not be published as-is. The PWA cache name is bumped to `terrys-survivor-v17-pin-access`.

## Hosted acceptance checks before announcing availability

Use designated test accounts in a staging copy first. Local tests mock the hosted Auth API, so these checks are still required against the deployed Supabase configuration:

1. Sign in as Terry and Jimbo by email; verify both can manage an existing ordinary player's PIN. Confirm a regular player's authenticated request cannot configure or disable another PIN.
2. Assign a leading-zero test PIN, sign out, and log in by entry name. Confirm `auth.uid()`/Auth user ID and all member IDs match email login, and that normal cloud loading and saving work.
3. For a multi-entry owner, sign in using the second entry name, switch between entries, and save a valid unlocked pick for each. Verify the same data appears after email login, refresh, and a second device. Compare picks, used teams, payments, buybacks, status, role and member count before/after.
4. Try five wrong PINs, then the correct PIN. PIN login must remain blocked. Confirm OTP still works, then reset from Commissioner HQ and confirm only the new PIN works.
5. Disable the entry PIN and confirm new PIN login fails while email login remains available. Existing sessions intentionally remain signed in.
6. Verify direct commissioner entries and ordinary siblings of commissioner accounts cannot receive/use PIN access, including a reserved, unclaimed commissioner entry sharing the email.
7. Confirm a fresh, unlinked roster entry with an assigned email can be configured and still uses its original member ID after PIN and email login. A roster entry without an email must show the setup restriction.
8. Check the installed phone/PWA refreshes to the new screen. Confirm normal OTP resend/sign-out/session refresh still works.

## Validation performed locally

- Production TypeScript/Vite build passed with the repository's locked dependencies restored by `npm ci`.
- 16 Edge Function tests passed; function and test type-checks passed.
- 21 PostgreSQL checks passed with real PostgreSQL/pgcrypto in an isolated PGlite database, applying the migration chain. Tests cover hashing/salts, lockout, reset/disable, account-link/role changes, service-only permissions, global limits, preserved data and multi-entry writes. Queued parallel attempts are tested; PGlite is single-connection and does not replace a hosted multi-connection concurrency test.
- All 12 existing survival/scoring regressions and the existing hidden-pick visibility checks passed.
- Browser fixture checks passed for incorrect-PIN feedback, leading-zero success, selected second entry, switching entries, email-code flow, mismatched PIN confirmation, setup and disable. The sign-in screen was visually checked at 390px phone width. Fixtures have no connection to production.
- Dependency installation reported two existing dependency advisories (one moderate, one high); this feature does not upgrade the app's dependency tree.

Reproduce from the repository root (Node 24+ for the existing regression runner; Deno 2 for Edge tests):

```powershell
npm ci
npm run build
node test-survivor.cjs
node verification/pick-visibility.cjs
npm ci --prefix verification/pin-db
node verification/pin-db/test.mjs
deno check --node-modules-dir=auto supabase/functions/survivor-pin-access/index.ts
deno test --node-modules-dir=auto supabase/functions/survivor-pin-access/handler_test.ts
```

Run Deno checks in a disposable checkout: its auto node-module mode can resolve the app's existing `latest` dependency declarations. Restore `npm ci` before the final app build. The database test is self-contained and needs no Supabase keys.

Optional browser fixtures:

```powershell
npm run dev -- --config verification/pin-ui.config.ts
```

Open `http://127.0.0.1:5189/verification/pin-ui.html`. Fixture entry names are `Player One` / `Player Two` and the fixture-only sign-in PIN is `0042`. Use **Switch test screen** for the commissioner panel. These files are not included in the production Vite entry point.

## Rollback

Disable the `survivor-pin-access` Edge Function or temporarily clear its league ID secret to stop new PIN logins. Email OTP and existing links remain intact. If reverting the frontend, retain the new database tables rather than deleting identity/history data. Keep the multi-entry permission correction unless a reviewed replacement is available. No migration in this release rewrites picks, payments, buybacks or snapshot content.

## References

- [Supabase generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink)
- [Supabase verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp)
- [PostgreSQL pgcrypto password hashing](https://www.postgresql.org/docs/18/pgcrypto.html)
