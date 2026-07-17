import { getSupabaseClient } from "../config/supabaseClient";
import type { Player, PlayerRole, PlayerStatus } from "../types/survivor";

export interface CloudMembership {
  leagueId: string;
  memberId: string;
  displayName: string;
  email: string;
  role: PlayerRole;
  status: PlayerStatus;
}

export interface LeagueRosterMembership {
  id: string;
  leagueId: string;
  userId: string | null;
  displayName: string;
  email: string;
  role: PlayerRole;
  status: PlayerStatus;
  buybacks: number;
}

interface LeagueRosterRow {
  id: string;
  league_id: string;
  user_id: string | null;
  display_name: string;
  email: string | null;
  role: PlayerRole;
  status: PlayerStatus;
  buybacks: number;
}

function mapRosterRow(row: LeagueRosterRow): LeagueRosterMembership {
  return {
    id: row.id,
    leagueId: row.league_id,
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email ?? "",
    role: row.role,
    status: row.status,
    buybacks: row.buybacks ?? 0,
  };
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export function matchLeagueRosterMembership(
  player: Pick<Player, "name" | "email" | "role">,
  memberships: LeagueRosterMembership[],
) {
  const playerEmail = normalize(player.email);
  const playerName = normalize(player.name);

  return memberships.find((membership) => {
    const emailMatches =
      playerEmail !== "" && normalize(membership.email) === playerEmail;
    const nameMatches =
      playerName !== "" && normalize(membership.displayName) === playerName;
    const leadershipMatches =
      player.role !== "player" && membership.role === player.role;

    return emailMatches || nameMatches || leadershipMatches;
  });
}

export async function claimMembershipByEmail(): Promise<CloudMembership | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await (client as any).rpc(
    "claim_survivor_membership",
  );
  if (error) throw error;
  if (!data) return null;

  return data as unknown as CloudMembership;
}

export async function getMyMembership(): Promise<CloudMembership | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await (client as any).rpc(
    "get_my_survivor_membership",
  );
  if (error) throw error;

  return data ? (data as unknown as CloudMembership) : null;
}

export async function bootstrapLeague(
  displayName: string,
): Promise<CloudMembership> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase is not configured.");

  const { data, error } = await (client as any).rpc(
    "bootstrap_survivor_league",
    {
      requested_display_name: displayName,
    },
  );
  if (error) throw error;
  if (!data) throw new Error("The cloud league could not be created.");

  return data as unknown as CloudMembership;
}

export async function assignCloudLeadership(
  terryEmail: string,
  terryDisplayName = "Terry",
): Promise<CloudMembership> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase is not configured.");

  const { data, error } = await (client as any).rpc(
    "assign_survivor_leadership",
    {
      terry_email: terryEmail.trim().toLowerCase(),
      terry_display_name: terryDisplayName.trim() || "Terry",
    },
  );
  if (error) throw error;
  if (!data) throw new Error("League leadership could not be updated.");

  return data as unknown as CloudMembership;
}

export async function listLeagueRosterMemberships(
  leagueId: string,
): Promise<LeagueRosterMembership[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await (client as any)
    .from("league_members")
    .select(
      "id, league_id, user_id, display_name, email, role, status, buybacks",
    )
    .eq("league_id", leagueId)
    .order("joined_at", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as LeagueRosterRow[]).map(mapRosterRow);
}

export interface SaveLeagueRosterMembershipInput {
  leagueId: string;
  membershipId?: string;
  displayName: string;
  email: string;
  role: PlayerRole;
  status: PlayerStatus;
  buybacks: number;
}

export async function saveLeagueRosterMembership(
  input: SaveLeagueRosterMembershipInput,
): Promise<LeagueRosterMembership> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase is not configured.");

  const { data, error } = await (client as any).rpc(
    "upsert_survivor_roster_member",
    {
      target_league: input.leagueId,
      target_member: input.membershipId ?? null,
      requested_display_name: input.displayName.trim(),
      requested_email: input.email.trim().toLowerCase(),
      requested_role: input.role,
      requested_status: input.status,
      requested_buybacks: input.buybacks,
    },
  );

  if (error) throw error;
  if (!data) throw new Error("The cloud roster member could not be saved.");

  return data as unknown as LeagueRosterMembership;
}

export async function ensureLeagueRosterMemberships(
  leagueId: string,
  players: Player[],
): Promise<LeagueRosterMembership[]> {
  let memberships = await listLeagueRosterMemberships(leagueId);

  for (const player of players) {
    const match = matchLeagueRosterMembership(player, memberships);
    if (match) continue;

    const created = await saveLeagueRosterMembership({
      leagueId,
      displayName: player.name,
      email: player.email,
      role: player.role,
      status: player.status,
      buybacks: player.buybacks,
    });
    memberships = [...memberships, created];
  }

  return listLeagueRosterMemberships(leagueId);
}
