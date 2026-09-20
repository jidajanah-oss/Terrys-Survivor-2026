interface Entry {
  id: string;
  status: string;
  eliminatedWeek?: number;
  restoredThroughWeek?: number;
  buybacks: number;
  picks: { week: number; result: string }[];
}

interface Payment {
  playerId: string;
  type: string;
  week: number;
}

// Scoring can eliminate an entry, but only an explicit buyback/reset can restore it.
export function reconcileEntry<T extends Entry>(player: T, payments: Payment[] = []): T {
  const failures = [...new Set(player.picks
    .filter(pick => ["loss", "tie", "no-pick"].includes(pick.result))
    .map(pick => Number(pick.week)))].sort((a, b) => a - b);
  let uncovered = failures.filter(week => week > (player.restoredThroughWeek ?? 0));
  if (player.restoredThroughWeek === undefined) {
    // Legacy buybacks have payment records but no explicit restoration boundary.
    const buybacks = payments.filter(payment => payment.playerId === player.id && payment.type === "buyback")
      .sort((a, b) => a.week - b.week).slice(0, player.buybacks);
    for (const payment of buybacks) {
      const index = uncovered.findIndex(week => week <= payment.week);
      if (index >= 0) uncovered.splice(index, 1);
    }
  }
  const firstFailure = uncovered[0];
  const preservedWeek = player.status === "eliminated" ? player.eliminatedWeek : undefined;
  const eliminatedWeek = firstFailure === undefined ? preservedWeek
    : preservedWeek === undefined ? firstFailure : Math.min(firstFailure, preservedWeek);
  return firstFailure !== undefined || player.status === "eliminated"
    ? { ...player, status: "eliminated", eliminatedWeek }
    : player;
}
