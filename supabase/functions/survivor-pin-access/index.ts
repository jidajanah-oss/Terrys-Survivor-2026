import { makeHandler } from "./handler.ts";

function key(dictionary: string, legacy: string): string {
  try {
    const values = JSON.parse(Deno.env.get(dictionary) ?? "{}");
    if (typeof values.default === "string") return values.default;
  } catch { /* Use legacy keys on older projects. */ }
  return Deno.env.get(legacy) ?? "";
}

Deno.serve(makeHandler({
  url: Deno.env.get("SUPABASE_URL") ?? "",
  anonKey: key("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"),
  serviceKey: key("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
  pepper: Deno.env.get("SURVIVOR_PIN_PEPPER") ?? "",
  leagueId: Deno.env.get("SURVIVOR_PIN_LEAGUE_ID") ?? "",
  allowedOrigins: (Deno.env.get("SURVIVOR_PIN_ALLOWED_ORIGINS") ?? "").split(",").map(s => s.trim()).filter(Boolean),
}));
