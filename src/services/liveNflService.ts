import { getSupabaseClient } from "../config/supabaseClient";
import type { SurvivorState } from "../types/survivor";

export interface LiveNflSyncSummary {
  provider: string;
  season: number;
  week: number;
  gamesFetched: number;
  finalGames: number;
  picksResolved: number;
  playersEliminated: number;
  syncedAt: string;
  state?: SurvivorState;
}

export class LiveNflSyncService {
  constructor(private readonly leagueId: string) {}

  async sync(season: number, week: number): Promise<LiveNflSyncSummary> {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase is not configured.");

    const { data, error } = await client.functions.invoke("sync-nfl-week", {
      body: { leagueId: this.leagueId, season, week },
    });

    if (error) throw error;
    if (!data || typeof data !== "object") throw new Error("The NFL sync function returned no data.");
    if ((data as { error?: string }).error) throw new Error((data as { error: string }).error);
    return data as LiveNflSyncSummary;
  }
}
