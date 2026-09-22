interface Entry {
  id: string;
  status: string;
  eliminatedWeek?: number;
  restoredThroughWeek?: number;
  buybacks: number;
  picks: { week: number; result: string; submittedAt?: string; resolvedAt?: string }[];
}

interface Payment {
  playerId: string;
  type: string;
  week: number;
  createdAt?: string;
}

// Scoring can eliminate an entry, but only an explicit buyback/reset can restore it.
export function reconcileEntry<T extends Entry>(player: T, payments: Payment[] = []): T {
  const failures = [...new Set(player.picks
    .filter(pick => ["loss", "tie", "no-pick"].includes(pick.result))
    .map(pick => Number(pick.week)))].sort((a, b) => a - b);
  const restoredThroughWeek = player.restoredThroughWeek ?? 0;
  const uncovered = failures.filter(week => week > restoredThroughWeek);
  const buybacks = payments.filter(payment => payment.playerId === player.id && payment.type === "buyback")
    .sort((a, b) => a.week - b.week).slice(0, player.buybacks);
  const coveredByPayment = new Set<number>();
  for (const payment of buybacks) {
    const index = uncovered.findIndex(week => {
      if (week < payment.week) return true;
      if (week > payment.week) return false;
      const pick = player.picks.find(item => Number(item.week) === week && ["loss", "tie", "no-pick"].includes(item.result));
      const failureAt = pick?.resolvedAt ?? pick?.submittedAt;
      return !payment.createdAt || !failureAt || failureAt <= payment.createdAt;
    });
    if (index >= 0) coveredByPayment.add(uncovered.splice(index, 1)[0]);
  }
  const firstFailure = uncovered[0];
  const preservedWeek = player.status === "eliminated" ? player.eliminatedWeek : undefined;
  const unresolvedStoredElimination = preservedWeek !== undefined
    && preservedWeek > restoredThroughWeek
    && !coveredByPayment.has(preservedWeek);
  const eliminatedWeek = firstFailure === undefined
    ? (unresolvedStoredElimination ? preservedWeek : undefined)
    : unresolvedStoredElimination ? Math.min(firstFailure, preservedWeek!) : firstFailure;
  return firstFailure !== undefined || unresolvedStoredElimination || (player.status === "eliminated" && preservedWeek === undefined)
    ? { ...player, status: "eliminated", eliminatedWeek }
    : { ...player, status: "active", eliminatedWeek: undefined };
}
