import { getGamesForWeek } from "../data/nfl";
import type { PickResult, SurvivorState } from "../types/survivor";

export interface FinalGameResult {
  gameId: string;
  winnerTeamId?: string;
  tied: boolean;
  status: "final";
}

export interface NflResultProvider {
  fetchFinalResults(week: number): Promise<FinalGameResult[]>;
}

// Development provider: deterministic demo finals. Replace with an Edge Function/API provider.
export class DemoNflResultProvider implements NflResultProvider {
  async fetchFinalResults(week: number): Promise<FinalGameResult[]> {
    return getGamesForWeek(week).map((game, index) => ({
      gameId: game.id,
      winnerTeamId: index % 2 === 0 ? game.homeTeamId : game.awayTeamId,
      tied: false,
      status: "final" as const,
    }));
  }
}

export function applyAutomaticResults(state: SurvivorState, finals: FinalGameResult[]): SurvivorState {
  const byGame = new Map(finals.map((game) => [game.gameId, game]));
  const week = state.settings.currentWeek;
  return {
    ...state,
    lastResultSyncAt: new Date().toISOString(),
    players: state.players.map((player) => {
      const pick = player.picks.find((item) => item.week === week);
      if (!pick || pick.result !== "pending") return player;
      const game = byGame.get(pick.gameId);
      if (!game) return player;
      const result: PickResult = game.tied ? "tie" : game.winnerTeamId === pick.teamId ? "win" : "loss";
      const eliminated = result === "loss" || result === "tie";
      return {
        ...player,
        status: eliminated ? "eliminated" : player.status,
        eliminatedWeek: eliminated ? week : player.eliminatedWeek,
        picks: player.picks.map((item) => item.week === week ? {
          ...item,
          result,
          resolutionSource: "automatic",
          resolvedAt: new Date().toISOString(),
        } : item),
      };
    }),
  };
}
