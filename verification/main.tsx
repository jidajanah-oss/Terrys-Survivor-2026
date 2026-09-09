import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BoardPage } from "../src/components/BoardPage";
import { initialState } from "../src/data/initialState";
import type { SurvivorState } from "../src/types/survivor";
import "../src/styles.css";

function Fixture() {
  const [kickoff, setKickoff] = useState(() => Date.now() + 86400000);
  const [showPayments, setShowPayments] = useState(true);
  const state: SurvivorState = {
    ...initialState,
    settings: { ...initialState.settings, currentWeek: 1 },
    players: initialState.players.slice(0, 3).map((player, index) => ({ ...player, name: ['Jimbo', 'Alexandra Montgomery', 'VeryLongUnbrokenPlayerName'][index], email: index === 2 ? '' : 'fixture@example.com', picks: index === 2 ? [] : [{ week: 1, gameId: 'later', teamId: index === 0 ? 'LAC' : 'DET', result: 'pending', submittedAt: new Date().toISOString() }] })),
    nflGames: [
      { id: 'first', week: 1, awayTeamId: 'DAL', homeTeamId: 'PHI', kickoff: new Date(kickoff).toISOString(), status: 'scheduled' },
      { id: 'later', week: 1, awayTeamId: 'LAC', homeTeamId: 'DET', kickoff: new Date(kickoff + 86400000).toISOString(), status: 'scheduled' },
    ],
  };
  return <main className="app-shell"><p>Test data only</p><button onClick={() => setKickoff(Date.now() + 10000)}>Kick off in 10 seconds</button><button onClick={() => setKickoff(Date.now() + 86400000)}>Before kickoff</button><label><input type="checkbox" checked={showPayments} onChange={event => setShowPayments(event.target.checked)}/>Show payments</label><BoardPage state={state} showPayments={showPayments}/></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
