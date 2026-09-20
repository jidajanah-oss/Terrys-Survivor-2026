import { strict as assert } from "node:assert";
import { isPin, makeHandler, pinMaterial, type PinConfig } from "./handler.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const league = "10000000-0000-4000-8000-000000000001";
const member = "20000000-0000-4000-8000-000000000001";
const user = "30000000-0000-4000-8000-000000000001";
const config: PinConfig = { url: "https://test.invalid", anonKey: "anon", serviceKey: "secret",
  pepper: "test-only-pepper-with-at-least-32-characters", leagueId: league, allowedOrigins: ["https://survivor.test"] };
type Options = { verified?: unknown; finish?: boolean; rpcError?: string; authUser?: string;
  linkUser?: string; sessionUser?: string; contextUser?: string | null; createError?: boolean };
function setup(options: Options = {}) {
  const calls: { name: string; args?: unknown }[] = [];
  const record = (name: string, args?: unknown) => { calls.push({ name, args }); };
  const context = { authUserId: options.contextUser === undefined ? user : options.contextUser,
    email: "player@example.test", configured: true, enabled: true, locked: false, lastSuccessAt: null };
  const admin = {
    rpc: (name: string, args: unknown) => {
      record(name, args);
      if (options.rpcError === name) return { data: null, error: { message: "database-secret-error" } };
      let data: unknown = true;
      if (name === "survivor_pin_verify") data = "verified" in options ? options.verified :
        { authUserId: user, memberId: member, version: member, email: context.email };
      if (name === "survivor_pin_finish") data = options.finish ?? true;
      if (name === "survivor_pin_manage_context") data = context;
      return { data, error: null };
    },
    auth: {
      getUser: (token: string) => {
        record("getUser", token);
        return { data: { user: options.authUser === "invalid" ? null : { id: options.authUser ?? user } }, error: null };
      },
      admin: {
        generateLink: (args: unknown) => { record("generateLink", args); return {
          data: { user: { id: options.linkUser ?? user }, properties: { hashed_token: "internal-token" } }, error: null }; },
        createUser: (args: unknown) => { record("createUser", args); return { data: { user: { id: user } }, error: options.createError ? {} : null }; },
        signOut: (token: string, scope: string) => { record("revoke", { token, scope }); return { error: null }; },
      },
    },
  };
  const auth = { auth: { verifyOtp: (args: unknown) => {
    record("verifyOtp", args);
    return { data: { session: { user: { id: options.sessionUser ?? user }, access_token: "access", refresh_token: "refresh" } }, error: null };
  } } };
  const handler = makeHandler(config, (_url, key) => (key === "secret" ? admin : auth) as unknown as SupabaseClient);
  const request = (body: unknown, authenticated = false, origin = "https://survivor.test") => handler(new Request("https://test.invalid", {
    method: "POST", headers: { Origin: origin, ...(authenticated ? { Authorization: "Bearer validated-token" } : {}) },
    body: JSON.stringify(body),
  }));
  return { calls, handler, request };
}
const login = { action: "login", entryName: "Player One", pin: "0042" };
const manage = { action: "configure", memberId: member, leagueId: league, pin: "0042" };

Deno.test("only four ASCII digits, including leading zeroes", () => {
  assert(isPin("0042"));
  for (const value of [42, "123", "12345", "12a34", " 1234", "１２３４", null]) assert(!isPin(value));
});
Deno.test("HMAC is deterministic, domain-separated and pepper-dependent", async () => {
  const a = await pinMaterial("0042", config.pepper, league);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, await pinMaterial("0042", config.pepper, league));
  assert.notEqual(a, await pinMaterial("0042", "different-secret", league));
  assert.notEqual(a, await pinMaterial("0042", config.pepper, member));
  assert.notEqual(a, await pinMaterial("0043", config.pepper, league));
});
Deno.test("valid PIN returns only the original user's normal session and selected entry", async () => {
  const { calls, request } = setup();
  const response = await request(login);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, memberId: member, accessToken: "access", refreshToken: "refresh" });
  assert.deepEqual(calls.find(c => c.name === "verifyOtp")?.args, { type: "email", token_hash: "internal-token" });
  assert(!JSON.stringify(calls).includes('"0042"'));
  assert(!calls.some(c => c.name === "createUser"));
});
Deno.test("wrong, missing, disabled and locked credentials never call Auth", async () => {
  const { calls, request } = setup({ verified: null });
  assert.equal((await request(login)).status, 401);
  assert.deepEqual(calls.map(c => c.name), ["survivor_pin_verify"]);
});
Deno.test("global attempt limit stops session creation", async () => {
  const { calls, request } = setup({ verified: { limited: true } });
  assert.equal((await request(login)).status, 429);
  assert(!calls.some(c => c.name === "generateLink"));
});
Deno.test("malformed PIN cannot be cleaned into a valid PIN", async () => {
  const { calls, request } = setup();
  assert.equal((await request({ ...login, pin: "00-42" })).status, 401);
  assert.deepEqual(calls.map(c => c.name), ["survivor_pin_take_attempt"]);
});
Deno.test("Auth identity mismatch fails before token verification", async () => {
  const { calls, request } = setup({ linkUser: "other-user" });
  assert.equal((await request(login)).status, 503);
  assert(!calls.some(c => c.name === "verifyOtp"));
});
Deno.test("reset/disable during Auth exchange revokes the undisclosed session", async () => {
  const { calls, request } = setup({ finish: false });
  const response = await request(login);
  assert.equal(response.status, 401);
  assert(!JSON.stringify(await response.json()).includes("refresh"));
  assert.deepEqual(calls.find(c => c.name === "revoke")?.args, { token: "access", scope: "local" });
});
Deno.test("finish database outage also revokes and fails closed", async () => {
  const { calls, request } = setup({ rpcError: "survivor_pin_finish" });
  const response = await request(login);
  assert.equal(response.status, 503);
  assert(calls.some(c => c.name === "revoke"));
  assert(!JSON.stringify(await response.json()).includes("database-secret-error"));
});
Deno.test("management needs a verified bearer token", async () => {
  const first = setup();
  assert.equal((await first.request(manage)).status, 401);
  assert.equal(first.calls.length, 0);
  const second = setup({ authUser: "invalid" });
  assert.equal((await second.request(manage, true)).status, 401);
  assert.deepEqual(second.calls.map(c => c.name), ["getUser"]);
});
Deno.test("SQL authorization rejects a normal player before any Auth mutation", async () => {
  const { calls, request } = setup({ rpcError: "survivor_pin_manage_context" });
  assert.equal((await request(manage, true)).status, 403);
  assert(!calls.some(c => c.name === "createUser" || c.name === "survivor_pin_configure"));
});
Deno.test("reset keeps existing Auth user and strips private status fields", async () => {
  const { calls, request } = setup();
  const response = await request(manage, true);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert(!("email" in body) && !("authUserId" in body));
  assert(!calls.some(c => c.name === "createUser" || c.name === "generateLink"));
  const args = calls.find(c => c.name === "survivor_pin_configure")!.args as Record<string, unknown>;
  assert.equal(args.target_user, user);
  assert.match(args.pin_material as string, /^[0-9a-f]{64}$/);
});
Deno.test("never-signed-in owner provisions only Auth before linking existing entry", async () => {
  const { calls, request } = setup({ contextUser: null });
  assert.equal((await request(manage, true)).status, 200);
  assert.deepEqual(calls.find(c => c.name === "createUser")?.args, { email: "player@example.test", email_confirm: false });
  assert(calls.some(c => c.name === "survivor_pin_configure"));
});
Deno.test("wrong league cannot configure another account", async () => {
  const { calls, request } = setup();
  assert.equal((await request({ ...manage, leagueId: member }, true)).status, 400);
  assert.equal(calls.length, 0);
});
Deno.test("disable remains possible for a now-ineligible account and checks server authorization", async () => {
  const { calls, request } = setup();
  assert.equal((await request({ ...manage, action: "disable" }, true)).status, 200);
  assert.deepEqual(calls.map(c => c.name), ["getUser", "survivor_pin_disable"]);
});
Deno.test("disallowed origin and oversized body rejected without database work", async () => {
  const { calls, request } = setup();
  assert.equal((await request(login, false, "https://evil.test")).status, 403);
  assert.equal((await request({ ...login, extra: "x".repeat(3000) })).status, 413);
  assert.equal(calls.length, 0);
});
