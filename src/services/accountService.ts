import { getSupabaseClient } from "../config/supabaseClient";
import type { PlayerRole } from "../types/survivor";

export interface CloudMembership {
  leagueId: string;
  memberId: string;
  displayName: string;
  email: string;
  role: PlayerRole;
  status: "active" | "eliminated";
}

export async function claimMembershipByEmail(): Promise<CloudMembership | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await (client as any).rpc("claim_survivor_membership");
  if (error) throw error;
  if (!data) return null;
  return data as unknown as CloudMembership;
}

export async function getMyMembership(): Promise<CloudMembership | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await (client as any).rpc("get_my_survivor_membership");
  if (error) throw error;
  return data ? data as unknown as CloudMembership : null;
}

export async function bootstrapLeague(displayName: string): Promise<CloudMembership> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase is not configured.");
  const { data, error } = await (client as any).rpc("bootstrap_survivor_league", {
    requested_display_name: displayName,
  });
  if (error) throw error;
  if (!data) throw new Error("The cloud league could not be created.");
  return data as unknown as CloudMembership;
}

export async function assignCloudLeadership(terryEmail: string, terryDisplayName = "Terry"): Promise<CloudMembership> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase is not configured.");
  const { data, error } = await (client as any).rpc("assign_survivor_leadership", {
    terry_email: terryEmail.trim().toLowerCase(),
    terry_display_name: terryDisplayName.trim() || "Terry",
  });
  if (error) throw error;
  if (!data) throw new Error("League leadership could not be updated.");
  return data as unknown as CloudMembership;
}
