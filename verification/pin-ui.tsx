import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CloudAuthGate } from "../src/features/auth/CloudAuthGate";
import { PinAccessPanel } from "../src/features/commissioner/PinAccessPanel";
import "../src/styles.css";
function Fixture() {
  const [manager, setManager] = useState(false);
  return <><div style={{ padding: 12 }}><strong>Test data only</strong> <button onClick={() => setManager(!manager)}>Switch test screen</button></div>
    {manager ? <main className="app-shell"><PinAccessPanel leagueId="fixture" /></main> :
      <CloudAuthGate>{(selected, entries, _session, _refresh, select) => <main className="app-shell">
        <h1>Signed in: {selected?.displayName}</h1>
        <label>My entries<select value={selected?.memberId} onChange={e => select(e.target.value)}>
          {entries.map(entry => <option value={entry.memberId} key={entry.memberId}>{entry.displayName}</option>)}
        </select></label></main>}</CloudAuthGate>}
  </>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
