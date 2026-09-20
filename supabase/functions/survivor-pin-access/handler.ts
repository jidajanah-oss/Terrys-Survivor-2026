import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

export interface PinConfig {
  url: string;
  anonKey: string;
  serviceKey: string;
  pepper: string;
  leagueId: string;
  allowedOrigins: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID_LOGIN = "Entry name or PIN was not accepted. After five incorrect attempts, ask Terry or Jimbo to reset your PIN. You can also use email sign-in.";
export const isPin = (pin: unknown): pin is string => typeof pin === "string" && /^[0-9]{4}$/.test(pin);

// Domain-separated HMAC pepper stays in Edge secrets; only this 64-character
// material reaches PostgreSQL, where bcrypt adds a fresh random salt.
export async function pinMaterial(pin: string, pepper: string, leagueId: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key,
    encoder.encode(`survivor-pin-v1|${leagueId}|${pin}`));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

function safeStatus(context: Record<string, unknown>) {
  return { ok: true, configured: context.configured, enabled: context.enabled,
    locked: context.locked, lastSuccessAt: context.lastSuccessAt };
}

export function makeHandler(config: PinConfig,
  factory: (url: string, key: string) => SupabaseClient = (url, key) => createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin") ?? "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    if (config.allowedOrigins.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
    const respond = (body: Record<string, unknown>, status = 200) =>
      new Response(JSON.stringify(body), { status, headers });
    if (origin && !config.allowedOrigins.includes(origin)) return respond({ message: "Origin not allowed." }, 403);
    if (request.method === "OPTIONS") return respond({ ok: true });
    if (request.method !== "POST") return respond({ message: "Method not allowed." }, 405);
    if (!config.url || !config.anonKey || !config.serviceKey || config.pepper.length < 32 || !UUID.test(config.leagueId)) {
      return respond({ message: "PIN sign-in is not configured. Please use email sign-in." }, 503);
    }

    // Bound the body even when Content-Length is absent or false.
    let body: Record<string, unknown>;
    try {
      const reader = request.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2048) { await reader.cancel(); return respond({ message: "Request too large." }, 413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed;
    } catch { return respond({ message: "Invalid request." }, 400); }

    const admin = factory(config.url, config.serviceKey);
    const rpc = async (name: string, args: Record<string, unknown> = {}) => {
      const { data, error } = await admin.rpc(name, args);
      if (error) throw new Error("PIN service unavailable");
      return data;
    };
    try {
      if (body.action === "login") {
        const entryName = typeof body.entryName === "string" ? body.entryName.trim() : "";
        // Invalid PINs are never normalized into valid credentials.
        if (!entryName || entryName.length > 120 || !isPin(body.pin)) {
          const allowed = await rpc("survivor_pin_take_attempt");
          return respond({ message: allowed ? INVALID_LOGIN : "Too many sign-in attempts. Try again in a minute." }, allowed ? 401 : 429);
        }
        const verified = await rpc("survivor_pin_verify", {
          target_league: config.leagueId, entry_name: entryName,
          pin_material: await pinMaterial(body.pin, config.pepper, config.leagueId),
        });
        if (verified?.limited) return respond({ message: "Too many sign-in attempts. Try again in a minute." }, 429);
        if (!verified) return respond({ message: INVALID_LOGIN }, 401);

        // Generate, then consume, an internal token for the SAME existing Auth user.
        // No email is sent; no password, email, metadata, or account link is replaced.
        const { data: link, error: linkError } = await admin.auth.admin.generateLink({
          type: "magiclink", email: verified.email,
        });
        if (linkError || link.user?.id !== verified.authUserId || !link.properties?.hashed_token) {
          return respond({ message: "PIN sign-in is temporarily unavailable. Please use email sign-in." }, 503);
        }
        const auth = factory(config.url, config.anonKey);
        const { data, error } = await auth.auth.verifyOtp({
          type: "email", token_hash: link.properties.hashed_token,
        });
        if (error || !data.session) return respond({ message: "PIN sign-in is temporarily unavailable. Please use email sign-in." }, 503);
        let accepted = false;
        try {
          accepted = data.session.user.id === verified.authUserId && await rpc("survivor_pin_finish", {
            target_member: verified.memberId, target_user: data.session.user.id,
            credential_version: verified.version,
          }) === true;
        } finally {
          if (!accepted) await admin.auth.admin.signOut(data.session.access_token, "local");
        }
        if (!accepted) return respond({ message: INVALID_LOGIN }, 401);
        return respond({ ok: true, memberId: verified.memberId,
          accessToken: data.session.access_token, refreshToken: data.session.refresh_token });
      }

      if (!["status", "configure", "disable"].includes(String(body.action)) ||
        typeof body.memberId !== "string" || !UUID.test(body.memberId) || body.leagueId !== config.leagueId) {
        return respond({ message: "Invalid request." }, 400);
      }
      const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
      if (!token) return respond({ message: "Commissioner sign-in is required." }, 401);
      const { data: user, error: userError } = await admin.auth.getUser(token);
      if (userError || !user.user) return respond({ message: "Commissioner sign-in is required." }, 401);
      const args = { actor: user.user.id, target_league: config.leagueId, target_member: body.memberId };
      if (body.action === "disable") {
        const { error } = await admin.rpc("survivor_pin_disable", args);
        if (error) return respond({ message: "Unable to disable PIN access. Commissioner access is required." }, 403);
        return respond({ ok: true, configured: true, enabled: false, locked: false, lastSuccessAt: null });
      }
      const { data: context, error: contextError } = await admin.rpc("survivor_pin_manage_context", args);
      if (contextError || !context) return respond({ message: "PIN setup requires commissioner access and a player email account with no commissioner role. Check the selected account." }, 403);
      if (body.action === "status") return respond(safeStatus(context));
      if (!isPin(body.pin)) return respond({ message: "Enter exactly four digits." }, 400);

      let userId = context.authUserId;
      if (!userId) {
        // Provision Auth only for a never-signed-in owner, not a second league member.
        // Leave email unconfirmed; email OTP continues to work normally.
        const { data, error } = await admin.auth.admin.createUser({ email: context.email, email_confirm: false });
        if (error || !data.user) return respond({ message: "Unable to prepare the account. Refresh and try again." }, 409);
        userId = data.user.id;
      }
      await rpc("survivor_pin_configure", { ...args, target_user: userId,
        pin_material: await pinMaterial(body.pin, config.pepper, config.leagueId) });
      const updated = await rpc("survivor_pin_manage_context", args);
      return respond(safeStatus(updated));
    } catch {
      // Never log request bodies, PIN material, Auth tokens or upstream error payloads.
      return respond({ message: "PIN access is temporarily unavailable. Please use email sign-in." }, 503);
    }
  };
}
