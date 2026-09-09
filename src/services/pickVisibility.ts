import type { Game } from "../types/survivor";

/** Board display only; this does not change a pick's individual game lock. */
export function weekPicksAreVisible(week: number, games: Game[], now: number): boolean {
  const eligibleGames = games.filter(
    (game) => game.week === week && game.status !== "canceled" && game.status !== "postponed",
  );
  if (!eligibleGames.length) return false;
  const kickoffs = eligibleGames.map((game) => Date.parse(game.kickoff));
  // Missing/invalid schedule information must never reveal a pick early.
  if (kickoffs.some((kickoff) => !Number.isFinite(kickoff))) return false;
  return Number.isFinite(now) && now >= Math.min(...kickoffs);
}
