import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { cloudConfigured } from "../../config/runtime";
import { getCurrentSession, sendMagicLink, signOut, subscribeToAuth } from "../../services/authService";
import { bootstrapLeague, claimMembershipByEmail, getMyMembership, type CloudMembership } from "../../services/accountService";

interface CloudAuthGateProps {
  children: (identity: CloudMembership | null, session: Session | null, refreshIdentity: () => Promise<void>) => ReactNode;
}

function redirectUrl() {
  const path = window.location.pathname;
  const basePath = path.endsWith("/") ? path : path.slice(0, path.lastIndexOf("/") + 1);
  return `${window.location.origin}${basePath || "/"}`;
}

export function CloudAuthGate({ children }: CloudAuthGateProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<CloudMembership | null>(null);
  const [loading, setLoading] = useState(cloudConfigured);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [displayName, setDisplayName] = useState("Terry");

  const signedInEmail = useMemo(() => session?.user.email ?? "", [session]);

  async function refreshMembership() {
    let found = await getMyMembership();
    if (!found) found = await claimMembershipByEmail();
    setMembership(found);
  }

  useEffect(() => {
    if (!cloudConfigured) {
      setLoading(false);
      return;
    }

    let active = true;
    getCurrentSession()
      .then(async (current) => {
        if (!active) return;
        setSession(current);
        if (current) await refreshMembership();
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to read the sign-in session."))
      .finally(() => active && setLoading(false));

    const unsubscribe = subscribeToAuth((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) {
        refreshMembership().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to link the account."));
      } else {
        setMembership(null);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function requestLink(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      await sendMagicLink(email.trim(), redirectUrl());
      setMessage("Magic-link email sent. Open it on this device to finish signing in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The sign-in email could not be sent.");
    }
  }

  async function createLeague() {
    setMessage("");
    try {
      const linked = await bootstrapLeague(displayName.trim() || "Terry");
      setMembership(linked);
      setMessage("Cloud league created. This account is the Primary Commissioner.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The cloud league could not be created.");
    }
  }

  if (!cloudConfigured) return <>{children(null, null, async () => {})}</>;

  if (loading) {
    return <div className="auth-screen"><div className="auth-card"><h1>Connecting to Terry’s Survivor</h1><p>Checking your secure session…</p></div></div>;
  }

  if (!session) {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={requestLink}>
          <img src={`${import.meta.env.BASE_URL}terrys-survivor-2026-logo.png`} alt="Terry's Survivor 2026" />
          <span className="eyebrow">Secure cloud access</span>
          <h1>Sign in to Terry’s Survivor</h1>
          <p>Enter the email assigned to your survivor entry. Supabase will send a secure magic link.</p>
          <label>Email address<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
          <button type="submit">Send Magic Link</button>
          {message ? <div className="auth-message">{message}</div> : null}
        </form>
      </div>
    );
  }

  if (!membership) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src={`${import.meta.env.BASE_URL}terrys-survivor-2026-logo.png`} alt="Terry's Survivor 2026" />
          <span className="eyebrow">Signed in</span>
          <h1>Link your survivor entry</h1>
          <p><strong>{signedInEmail}</strong> is authenticated, but no matching player record is linked yet.</p>
          <button onClick={() => refreshMembership().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to claim membership."))}>Try Account Link Again</button>
          <div className="auth-bootstrap">
            <strong>First-time setup</strong>
            <p>Terry should use this once to create the cloud league and become Primary Commissioner.</p>
            <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
            <button className="secondary-button" onClick={createLeague}>Create Terry’s Cloud League</button>
          </div>
          <button className="text-button" onClick={() => signOut()}>Sign out</button>
          {message ? <div className="auth-message">{message}</div> : null}
        </div>
      </div>
    );
  }

  return <>{children(membership, session, refreshMembership)}</>;
}
