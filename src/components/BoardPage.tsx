import { useEffect, useState } from "react";
import { StatusPill } from "./StatusPill";
import { getTeam } from "../data/nfl";
import type { SurvivorState } from "../types/survivor";
import { weekPicksAreVisible } from "../services/pickVisibility";

function currency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function BoardPage({
  state,
  showPayments,
}: {
  state: SurvivorState;
  showPayments: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 1000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const picksVisible = weekPicksAreVisible(state.settings.currentWeek, state.nflGames, now);

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">League board</span>
          <h1>Survivor standings</h1>
          <p>
            Weekly picks appear at the first game kickoff of that week.
            Until then, those teams are also hidden from Used.
          </p>
        </div>
      </div>

      <div className="board-table-wrap">
        <table className="board-table">
          <thead>
            <tr>
              <th>Player</th>
              {showPayments ? <th>Entry</th> : null}
              <th>Status</th>
              <th>Week {state.settings.currentWeek}</th>
              <th>Used</th>
              <th>Buybacks</th>
              {showPayments ? <th>Total Paid</th> : null}
            </tr>
          </thead>
          <tbody>
            {[...state.players]
              .sort((a, b) => a.status.localeCompare(b.status))
              .map((player) => {
                const currentPick = player.picks.find(
                  (pick) => pick.week === state.settings.currentWeek,
                );
                const payments = state.payments.filter(
                  (payment) => payment.playerId === player.id,
                );
                const paid = payments.reduce(
                  (sum, payment) => sum + payment.amount,
                  0,
                );
                const entryPaid = payments.some(
                  (payment) => payment.type === "initial-entry",
                );
                const usedTeams = [
                  ...new Set(player.picks
                    .filter((pick) => weekPicksAreVisible(pick.week, state.nflGames, now))
                    .map((pick) => pick.teamId)),
                ];

                return (
                  <tr key={player.id}>
                    <td>
                      <strong>{player.name}</strong>
                    </td>
                    {showPayments ? (
                      <td>
                        <span
                          className={`payment-status payment-status--${
                            entryPaid ? "paid" : "due"
                          }`}
                        >
                          {entryPaid ? "Paid" : "Due"}
                        </span>
                      </td>
                    ) : null}
                    <td>
                      <StatusPill status={player.status} />
                    </td>
                    <td>
                      {!picksVisible
                        ? "Hidden until kickoff"
                        : currentPick
                        ? `${
                            currentPick.teamId === "NO-PICK"
                              ? "â€”"
                              : getTeam(currentPick.teamId).abbreviation
                          } - ${currentPick.result}`
                        : "No pick"}
                    </td>
                    <td>{usedTeams.join(", ") || "None"}</td>
                    <td>{player.buybacks}</td>
                    {showPayments ? <td>{currency(paid)}</td> : null}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
