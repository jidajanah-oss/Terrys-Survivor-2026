import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "../config/supabaseClient";

export async function getCurrentSession(): Promise<Session | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function sendMagicLink(email: string, redirectTo: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase is not configured.");
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export function subscribeToAuth(
  callback: (event: AuthChangeEvent, session: Session | null) => void,
): () => void {
  const client = getSupabaseClient();
  if (!client) return () => undefined;
  const { data } = client.auth.onAuthStateChange(callback);
  return () => data.subscription.unsubscribe();
}
