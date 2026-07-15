import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runtimeConfig } from "./runtime";
import type { Database } from "../types/database";

let client: SupabaseClient<Database> | null = null;

export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseAnonKey) return null;
  if (!client) {
    client = createClient<Database>(
      runtimeConfig.supabaseUrl,
      runtimeConfig.supabaseAnonKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );
  }
  return client;
}
