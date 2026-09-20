import { getSupabaseClient } from "../config/supabaseClient";

export interface PinAccessStatus {
  configured: boolean;
  enabled: boolean;
  locked: boolean;
  lastSuccessAt: string | null;
}

async function request(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Cloud sign-in is not configured.");
  const { data, error } = await client.functions.invoke("survivor-pin-access", { body });
  if (error) {
    let message = "PIN access is unavailable. Please try email sign-in.";
    if (error.context instanceof Response) {
      try {
        const response = await error.context.json();
        if (typeof response.message === "string") message = response.message;
      } catch { /* Keep the safe fallback. */ }
    }
    throw new Error(message);
  }
  if (!data || data.ok !== true) throw new Error("PIN access returned an invalid response.");
  return data;
}

export async function signInWithPin(entryName: string, pin: string,
  beforeSession: (memberId: string) => void) {
  if (!/^[0-9]{4}$/.test(pin)) throw new Error("Enter exactly four digits.");
  const data = await request({ action: "login", entryName: entryName.trim(), pin });
  if (typeof data.accessToken !== "string" || typeof data.refreshToken !== "string" ||
    typeof data.memberId !== "string") throw new Error("PIN sign-in returned an invalid session.");
  const client = getSupabaseClient();
  if (!client) throw new Error("Cloud sign-in is not configured.");
  // Select the requested entry before Auth listeners load all account memberships.
  beforeSession(data.memberId);
  const { data: auth, error } = await client.auth.setSession({
    access_token: data.accessToken, refresh_token: data.refreshToken,
  });
  if (error) throw error;
  if (!auth.session) throw new Error("Unable to open the PIN sign-in session.");
  return auth.session;
}

export async function managePin(action: "status" | "configure" | "disable",
  leagueId: string, memberId: string, pin?: string): Promise<PinAccessStatus> {
  if (action === "configure" && !/^[0-9]{4}$/.test(pin ?? "")) throw new Error("Enter exactly four digits.");
  const data = await request({ action, leagueId, memberId, ...(pin === undefined ? {} : { pin }) });
  if (typeof data.configured !== "boolean" || typeof data.enabled !== "boolean" ||
    typeof data.locked !== "boolean" || !(data.lastSuccessAt === null || typeof data.lastSuccessAt === "string")) {
    throw new Error("PIN access returned an invalid status.");
  }
  return { configured: data.configured, enabled: data.enabled, locked: data.locked,
    lastSuccessAt: data.lastSuccessAt };
}
