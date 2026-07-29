import type {
  AuthChangeEvent,
  Session,
} from "@supabase/supabase-js";

import { getSupabaseClient } from "../config/supabaseClient";

export async function getCurrentSession(): Promise<Session | null> {
  const client = getSupabaseClient();

  if (!client) {
    return null;
  }

  const { data, error } = await client.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session;
}

export async function sendEmailOtp(email: string): Promise<void> {
  const client = getSupabaseClient();

  if (!client) {
    throw new Error("Supabase is not configured.");
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    throw new Error("Enter your email address.");
  }

  const { error } = await client.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    throw error;
  }
}

export async function verifyEmailOtp(
  email: string,
  token: string,
): Promise<Session> {
  const client = getSupabaseClient();

  if (!client) {
    throw new Error("Supabase is not configured.");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedToken = token.replace(/\D/g, "");

  if (!normalizedEmail) {
    throw new Error("Enter your email address.");
  }

  if (normalizedToken.length < 6) {
    throw new Error("Enter the complete verification code.");
  }

  const { data, error } = await client.auth.verifyOtp({
    email: normalizedEmail,
    token: normalizedToken,
    type: "email",
  });

  if (error) {
    throw error;
  }

  if (!data.session) {
    throw new Error(
      "The code was accepted, but Supabase did not create a session.",
    );
  }

  return data.session;
}

/**
 * Compatibility wrapper for older imports.
 * The hosted email template now sends an OTP rather than a link.
 */
export async function sendMagicLink(
  email: string,
  _redirectTo?: string,
): Promise<void> {
  await sendEmailOtp(email);
}

export async function signOut(): Promise<void> {
  const client = getSupabaseClient();

  if (!client) {
    return;
  }

  const { error } = await client.auth.signOut();

  if (error) {
    throw error;
  }
}

export function subscribeToAuth(
  callback: (
    event: AuthChangeEvent,
    session: Session | null,
  ) => void,
): () => void {
  const client = getSupabaseClient();

  if (!client) {
    return () => undefined;
  }

  const { data } = client.auth.onAuthStateChange(callback);

  return () => data.subscription.unsubscribe();
}
