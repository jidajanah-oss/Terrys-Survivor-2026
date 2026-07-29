import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";

import { cloudConfigured } from "../../config/runtime";
import {
  getCurrentSession,
  sendEmailOtp,
  signOut,
  subscribeToAuth,
  verifyEmailOtp,
} from "../../services/authService";
import {
  bootstrapLeague,
  claimMembershipByEmail,
  getMyMembership,
  type CloudMembership,
} from "../../services/accountService";

interface CloudAuthGateProps {
  children: (
    identity: CloudMembership | null,
    session: Session | null,
    refreshIdentity: () => Promise<void>,
  ) => ReactNode;
}

type SignInStep = "email" | "code";

function errorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof Error ? error.message : fallback;
}

export function CloudAuthGate({
  children,
}: CloudAuthGateProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] =
    useState<CloudMembership | null>(null);
  const [loading, setLoading] = useState(cloudConfigured);
  const [email, setEmail] = useState("");
  const [requestedEmail, setRequestedEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [signInStep, setSignInStep] =
    useState<SignInStep>("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [displayName, setDisplayName] = useState("Terry");

  const signedInEmail = useMemo(
    () => session?.user.email ?? "",
    [session],
  );

  async function refreshMembership() {
    let found = await getMyMembership();

    if (!found) {
      found = await claimMembershipByEmail();
    }

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
        if (!active) {
          return;
        }

        setSession(current);

        if (current) {
          await refreshMembership();
        }
      })
      .catch((error: unknown) => {
        setMessage(
          errorMessage(
            error,
            "Unable to read the sign-in session.",
          ),
        );
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    const unsubscribe = subscribeToAuth(
      (_event, nextSession) => {
        setSession(nextSession);

        if (nextSession) {
          refreshMembership().catch((error: unknown) => {
            setMessage(
              errorMessage(
                error,
                "Unable to link the account.",
              ),
            );
          });
        } else {
          setMembership(null);
        }
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function sendCode(
    nextEmail: string,
    successMessage: string,
  ) {
    const normalizedEmail = nextEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      setMessage("Enter your email address.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      await sendEmailOtp(normalizedEmail);
      setRequestedEmail(normalizedEmail);
      setEmail(normalizedEmail);
      setOtpCode("");
      setSignInStep("code");
      setMessage(successMessage);
    } catch (error: unknown) {
      setMessage(
        errorMessage(
          error,
          "The verification code could not be sent.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function requestCode(event: FormEvent) {
    event.preventDefault();

    await sendCode(
      email,
      "Verification code sent. Check your email, then enter the code here.",
    );
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();

    const normalizedCode = otpCode.replace(/\D/g, "");

    if (normalizedCode.length < 6) {
      setMessage("Enter the complete verification code.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const nextSession = await verifyEmailOtp(
        requestedEmail,
        normalizedCode,
      );

      setSession(nextSession);
      await refreshMembership();
      setMessage("Code verified. You are signed in.");
    } catch (error: unknown) {
      setMessage(
        errorMessage(
          error,
          "The code could not be verified. Request a new code and try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function useDifferentEmail() {
    setOtpCode("");
    setRequestedEmail("");
    setSignInStep("email");
    setMessage("");
  }

  async function createLeague() {
    setMessage("");

    try {
      const linked = await bootstrapLeague(
        displayName.trim() || "Terry",
      );

      setMembership(linked);
      setMessage(
        "Cloud league created. This account is the Primary Commissioner.",
      );
    } catch (error: unknown) {
      setMessage(
        errorMessage(
          error,
          "The cloud league could not be created.",
        ),
      );
    }
  }

  if (!cloudConfigured) {
    return <>{children(null, null, async () => {})}</>;
  }

  if (loading) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1>Connecting to Terry’s Survivor</h1>
          <p>Checking your secure session…</p>
        </div>
      </div>
    );
  }

  if (!session && signInStep === "email") {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={requestCode}>
          <img
            src={`${import.meta.env.BASE_URL}terrys-survivor-2026-logo.png`}
            alt="Terry's Survivor 2026"
          />

          <span className="eyebrow">
            Secure in-app sign-in
          </span>

          <h1>Sign in to Terry’s Survivor</h1>

          <p>
            Enter the email assigned to your survivor entry.
            We will send a verification code that you enter
            inside this app.
          </p>

          <label>
            Email address
            <input
              autoComplete="email"
              disabled={busy}
              inputMode="email"
              onChange={(event) =>
                setEmail(event.target.value)
              }
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
          </label>

          <button disabled={busy} type="submit">
            {busy
              ? "Sending Verification Code…"
              : "Send Verification Code"}
          </button>

          {message ? (
            <div className="auth-message" aria-live="polite">
              {message}
            </div>
          ) : null}
        </form>
      </div>
    );
  }

  if (!session && signInStep === "code") {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={verifyCode}>
          <img
            src={`${import.meta.env.BASE_URL}terrys-survivor-2026-logo.png`}
            alt="Terry's Survivor 2026"
          />

          <span className="eyebrow">
            Check your email
          </span>

          <h1>Enter your verification code</h1>

          <p>
            We sent a one-time code to{" "}
            <strong>{requestedEmail}</strong>. Enter it here
            without leaving the installed app.
          </p>

          <label>
            Verification code
            <input
              aria-label="Verification code"
              autoComplete="one-time-code"
              autoFocus
              disabled={busy}
              inputMode="numeric"
              maxLength={10}
              onChange={(event) =>
                setOtpCode(
                  event.target.value
                    .replace(/\D/g, "")
                    .slice(0, 10),
                )
              }
              pattern="[0-9]*"
              placeholder="Enter code"
              required
              type="text"
              value={otpCode}
            />
          </label>

          <button disabled={busy} type="submit">
            {busy ? "Verifying Code…" : "Verify and Sign In"}
          </button>

          <button
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              void sendCode(
                requestedEmail,
                "A new verification code was sent.",
              )
            }
            type="button"
          >
            Resend Code
          </button>

          <button
            className="text-button"
            disabled={busy}
            onClick={useDifferentEmail}
            type="button"
          >
            Use a Different Email
          </button>

          {message ? (
            <div className="auth-message" aria-live="polite">
              {message}
            </div>
          ) : null}
        </form>
      </div>
    );
  }

  if (!membership) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img
            src={`${import.meta.env.BASE_URL}terrys-survivor-2026-logo.png`}
            alt="Terry's Survivor 2026"
          />

          <span className="eyebrow">Signed in</span>

          <h1>Link your survivor entry</h1>

          <p>
            <strong>{signedInEmail}</strong> is authenticated,
            but no matching player record is linked yet.
          </p>

          <button
            onClick={() =>
              refreshMembership().catch((error: unknown) => {
                setMessage(
                  errorMessage(
                    error,
                    "Unable to claim membership.",
                  ),
                );
              })
            }
          >
            Try Account Link Again
          </button>

          <div className="auth-bootstrap">
            <strong>First-time setup</strong>

            <p>
              Terry should use this once to create the cloud
              league and become Primary Commissioner.
            </p>

            <label>
              Display name
              <input
                onChange={(event) =>
                  setDisplayName(event.target.value)
                }
                value={displayName}
              />
            </label>

            <button
              className="secondary-button"
              onClick={createLeague}
            >
              Create Terry’s Cloud League
            </button>
          </div>

          <button
            className="text-button"
            onClick={() => signOut()}
          >
            Sign out
          </button>

          {message ? (
            <div className="auth-message" aria-live="polite">
              {message}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      {children(
        membership,
        session,
        refreshMembership,
      )}
    </>
  );
}
