import { getDemoGamesForWeek } from "../data/nfl";
import type { PickResult, SurvivorState } from "../types/survivor";

export interface FinalGameResult {
  gameId: string;
  awayTeamId: string;
  homeTeamId: string;
  winnerTeamId?: string;
  tied: boolean;
  status: "final";
}

export interface NflResultProvider {
  fetchFinalResults(week: number): Promise<FinalGameResult[]>;
}

// Local-only provider used when Supabase is not configured.
export class DemoNflResultProvider implements NflResultProvider {
  async fetchFinalResults(week: number): Promise<FinalGameResult[]> {
    return getDemoGamesForWeek(week).map((game, index) => ({
      gameId: game.id,
      awayTeamId: game.awayTeamId,
      homeTeamId: game.homeTeamId,
      winnerTeamId: index % 2 === 0 ? game.homeTeamId : game.awayTeamId,
      tied: false,
      status: "final" as const,
    }));
  }
}

export function applyAutomaticResults(state: SurvivorState, finals: FinalGameResult[]): SurvivorState {
  const byGame = new Map(finals.map((game) => [game.gameId, game]));
  const week = state.settings.currentWeek;
  const resolvedAt = new Date().toISOString();
  return {
    ...state,
    lastResultSyncAt: resolvedAt,
    nflProvider: "demo",
    players: state.players.map((player) => {
      const pick = player.picks.find((item) => item.week === week);
      if (!pick || pick.result !== "pending") return player;
      const game = byGame.get(pick.gameId) ?? finals.find(
        (item) => item.awayTeamId === pick.teamId || item.homeTeamId === pick.teamId,
      );
      if (!game) return player;
      const result: PickResult = game.tied ? "tie" : game.winnerTeamId === pick.teamId ? "win" : "loss";
      const eliminated = result === "loss" || result === "tie";
      return {
        ...player,
        status: eliminated ? "eliminated" : player.status,
        eliminatedWeek: eliminated ? week : player.eliminatedWeek,
        picks: player.picks.map((item) => item.week === week ? {
          ...item,
          gameId: game.gameId,
          result,
          resolutionSource: "automatic",
          resolvedAt,
        } : item),
      };
    }),
  };
}
