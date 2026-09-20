import { useEffect, useState, type FormEvent } from "react";
import { listLeagueRosterMemberships, type LeagueRosterMembership } from "../../services/accountService";
import { managePin, type PinAccessStatus } from "../../services/pinAccessService";

export function PinAccessPanel({ leagueId }: { leagueId: string }) {
  const [members, setMembers] = useState<LeagueRosterMembership[]>([]);
  const [memberId, setMemberId] = useState("");
  const [status, setStatus] = useState<PinAccessStatus | null>(null);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    listLeagueRosterMemberships(leagueId).then(rows => {
      if (active) { setMembers(rows); setLoading(false); }
    }).catch(() => { if (active) { setMessage("Unable to load cloud entries. Reopen Commissioner HQ to retry."); setLoading(false); } });
    return () => { active = false; };
  }, [leagueId]);

  useEffect(() => {
    let active = true;
    setStatus(null); setPin(""); setConfirmPin(""); setMessage("");
    if (!memberId) return;
    setLoading(true);
    managePin("status", leagueId, memberId).then(value => { if (active) setStatus(value); })
      .catch(error => { if (active) setMessage(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [leagueId, memberId]);

  const selected = members.find(member => member.id === memberId);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pin !== confirmPin) { setMessage("The two PINs do not match."); return; }
    setBusy(true); setMessage("");
    try {
      setStatus(await managePin("configure", leagueId, memberId, pin));
      setMessage(`PIN saved for ${selected?.displayName}. Share it with the player privately. Email sign-in is still available.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save PIN."); }
    finally { setPin(""); setConfirmPin(""); setBusy(false); }
  }
  async function disable() {
    setBusy(true); setMessage("");
    try {
      setStatus(await managePin("disable", leagueId, memberId));
      setMessage("PIN sign-in disabled. Email sign-in and existing account sessions are unchanged.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to disable PIN."); }
    finally { setPin(""); setConfirmPin(""); setBusy(false); }
  }

  return <article className="panel">
    <div className="panel-heading"><div><span className="eyebrow">Player sign-in</span><h2>4-digit PIN access</h2></div></div>
    <p>Set a PIN for an existing Survivor entry. Five incorrect guesses lock PIN access until you set a new PIN. Email sign-in remains available.</p>
    <form className="form-stack" onSubmit={save}>
      <label>Survivor entry
        <select value={memberId} disabled={busy || loading} onChange={event => setMemberId(event.target.value)}>
          <option value="">Choose an entry</option>
          {members.map(member => <option key={member.id} value={member.id}>{member.displayName}</option>)}
        </select>
      </label>
      {selected ? <p>Login name: <strong>{selected.displayName}</strong>. This PIN signs in to the owner's account, including its other linked entries. Accounts with a commissioner role must use email.</p> : null}
      {status ? <p role="status">PIN access: <strong>{status.enabled ? status.locked ? "Locked — set a new PIN" : "Enabled" : "Disabled"}</strong>
        {status.lastSuccessAt ? ` · Last sign-in: ${new Date(status.lastSuccessAt).toLocaleString()}` : ""}</p> : null}
      <label>New 4-digit PIN
        <input type="password" autoComplete="new-password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4}
          required disabled={!status || busy || loading} value={pin}
          onChange={event => setPin(event.target.value.replace(/[^0-9]/g, "").slice(0, 4))} />
      </label>
      <label>Confirm PIN
        <input type="password" autoComplete="new-password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4}
          required disabled={!status || busy || loading} value={confirmPin}
          onChange={event => setConfirmPin(event.target.value.replace(/[^0-9]/g, "").slice(0, 4))} />
      </label>
      <button className="primary-button" disabled={!status || busy || loading || pin.length !== 4 || confirmPin.length !== 4} type="submit">
        {busy ? "Saving…" : status?.configured ? "Set New PIN / Enable" : "Set PIN"}
      </button>
      <button className="secondary-button" type="button" disabled={!memberId || busy || loading}
        onClick={() => void disable()}>Disable PIN Access</button>
      {message ? <div className="auth-message" role="status">{message}</div> : null}
    </form>
  </article>;
}
