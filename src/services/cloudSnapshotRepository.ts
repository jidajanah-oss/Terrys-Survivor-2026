import type { SurvivorState } from "../types/survivor";
import { getSupabaseClient } from "../config/supabaseClient";
import type { StateRepository } from "./stateRepository";

export class CloudSnapshotRepository implements StateRepository {
  constructor(private readonly leagueId: string) {}

  async load(): Promise<SurvivorState | null> {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase is not configured.");
    const { data, error } = await client
      .from("league_snapshots")
      .select("state")
      .eq("league_id", this.leagueId)
      .maybeSingle();
    if (error) throw error;
    return data?.state ? data.state as unknown as SurvivorState : null;
  }

  async save(state: SurvivorState): Promise<void> {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase is not configured.");
    const { data: sessionData } = await client.auth.getSession();
    const { error } = await client.from("league_snapshots").upsert({
      league_id: this.leagueId,
      state: state as unknown as import("../types/database").Json,
      updated_by: sessionData.session?.user.id ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }
}
