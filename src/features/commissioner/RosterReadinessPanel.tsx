import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  ensureLeagueRosterMemberships,
  listLeagueRosterMemberships,
  matchLeagueRosterMembership,
  recordLeagueRosterInviteSent,
  saveLeagueRosterMembership,
  type LeagueRosterMembership,
} from "../../services/accountService";
import { sendMagicLink } from "../../services/authService";
import type { Player } from "../../types/survivor";
import "./RosterReadinessPanel.css";

type ReadinessFilter = "all" | "email-needed" | "ready" | "linked";
type ReadinessStatus = Exclude<ReadinessFilter, "all">;

interface RosterReadinessPanelProps {
  players: Player[];
  leagueId?: string;
  onUpdatePlayer: (playerId: string, name: string, email: string) => void;
}

interface ReadinessEntry {
  player: Player;
  membership?: LeagueRosterMembership;
  email: string;
  status: ReadinessStatus;
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function roleLabel(player: Player) {
  if (player.role === "primary-commissioner") return "Primary Commissioner";
  if (player.role === "co-commissioner") return "Co-Commissioner";
  return "Player";
}

function readinessLabel(status: ReadinessStatus) {
  if (status === "linked") return "Linked";
  if (status === "ready") return "Ready to Sign In";
  return "Email Needed";
}

function readinessDescription(entry: ReadinessEntry) {
  if (entry.status === "linked") {
    return "This survivor entry is connected to a Supabase user account.";
  }

  if (entry.status === "ready") {
    return "The email is reserved. This player can request a magic sign-in link.";
  }

  return "Add an email before sending this player sign-in instructions.";
}

function validEmail(value: string) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function inviteRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

function formatInviteTime(value: string) {
  return new Date(value).toLocaleString();
}

export function RosterReadinessPanel({
  players,
  leagueId,
  onUpdatePlayer,
}: RosterReadinessPanelProps) {
  const [memberships, setMemberships] = useState<LeagueRosterMembership[]>([]);
  const [loading, setLoading] = useState(Boolean(leagueId));
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ReadinessFilter>("all");
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [savingPlayerId, setSavingPlayerId] = useState<string | null>(null);
  const [invitingPlayerId, setInvitingPlayerId] = useState<string | null>(null);

  async function loadRoster(ensureMissing: boolean) {
    if (!leagueId) {
      setMemberships([]);
      setLoading(false);
      return;
    }

    const rows = ensureMissing
      ? await ensureLeagueRosterMemberships(leagueId, players)
      : await listLeagueRosterMemberships(leagueId);

    setMemberships(rows);
  }

  useEffect(() => {
    let active = true;
    setLoading(Boolean(leagueId));
    setMessage("");

    const run = async () => {
      try {
        const rows = leagueId
          ? await ensureLeagueRosterMemberships(leagueId, players)
          : [];
        if (active) setMemberships(rows);
      } catch (error) {
        if (active) {
          setMessage(
            error instanceof Error
              ? error.message
              : "The cloud roster could not be loaded.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void run();

    return () => {
      active = false;
    };
  }, [leagueId, players.length]);

  const entries = useMemo<ReadinessEntry[]>(
    () =>
      players.map((player) => {
        const membership = matchLeagueRosterMembership(player, memberships);
        const email = (membership?.email || player.email || "").trim();
        const status: ReadinessStatus = membership?.userId
          ? "linked"
          : email
            ? "ready"
            : "email-needed";

        return { player, membership, email, status };
      }),
    [memberships, players],
  );

  const counts = useMemo(
    () => ({
      all: entries.length,
      "email-needed": entries.filter(
        (entry) => entry.status === "email-needed",
      ).length,
      ready: entries.filter((entry) => entry.status === "ready").length,
      linked: entries.filter((entry) => entry.status === "linked").length,
    }),
    [entries],
  );

  const visibleEntries = useMemo(() => {
    const query = normalize(search);

    return entries.filter((entry) => {
      const matchesFilter = filter === "all" || entry.status === filter;
      const matchesSearch =
        query === "" ||
        normalize(entry.player.name).includes(query) ||
        normalize(entry.email).includes(query) ||
        normalize(roleLabel(entry.player)).includes(query);

      return matchesFilter && matchesSearch;
    });
  }, [entries, filter, search]);

  function beginEdit(entry: ReadinessEntry) {
    setEditingPlayerId(entry.player.id);
    setDraftName(entry.player.name);
    setDraftEmail(entry.email);
    setMessage("");
  }

  function cancelEdit() {
    setEditingPlayerId(null);
    setDraftName("");
    setDraftEmail("");
    setMessage("");
  }

  function selectFilter(nextFilter: ReadinessFilter) {
    setFilter(nextFilter);
    setMessage("");
  }

  async function saveEdit(
    event: FormEvent,
    entry: ReadinessEntry,
  ) {
    event.preventDefault();

    const name = draftName.trim();
    const email = draftEmail.trim().toLowerCase();
    const linked = Boolean(entry.membership?.userId);
    const leadership = entry.player.role !== "player";
    const finalName = leadership ? entry.player.name : name;
    const finalEmail = linked ? entry.email : email;

    if (!finalName) {
      setMessage("Enter the player name.");
      return;
    }

    if (!validEmail(finalEmail)) {
      setMessage("Enter a valid email address.");
      return;
    }

    const duplicateEmail = entries.some(
      (other) =>
        other.player.id !== entry.player.id &&
        finalEmail !== "" &&
        normalize(other.email) === normalize(finalEmail),
    );
    if (duplicateEmail) {
      setMessage("That email is already assigned to another survivor entry.");
      return;
    }

    const duplicateName = entries.some(
      (other) =>
        other.player.id !== entry.player.id &&
        normalize(other.player.name) === normalize(finalName),
    );
    if (duplicateName) {
      setMessage("That player name is already in the roster.");
      return;
    }

    setSavingPlayerId(entry.player.id);
    setMessage("");

    try {
      if (leagueId) {
        await saveLeagueRosterMembership({
          leagueId,
          membershipId: entry.membership?.id,
          displayName: finalName,
          email: finalEmail,
          role: entry.player.role,
          status: entry.player.status,
          buybacks: entry.player.buybacks,
        });
      }

      onUpdatePlayer(entry.player.id, finalName, finalEmail);
      cancelEdit();

      if (leagueId) await loadRoster(false);

      setMessage(
        finalEmail
          ? `${finalName} is ready for secure sign-in.`
          : `${finalName} was updated. An email is still needed.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The player account details could not be saved.",
      );
    } finally {
      setSavingPlayerId(null);
    }
  }


  async function sendInvite(entry: ReadinessEntry) {
    if (!leagueId) {
      setMessage("Cloud sign-in is required before invitations can be sent.");
      return;
    }

    if (!entry.membership?.id) {
      setMessage("Refresh account readiness before sending this invitation.");
      return;
    }

    if (!entry.email) {
      setMessage("Add the player's email before sending an invitation.");
      return;
    }

    if (entry.status === "linked") {
      setMessage(`${entry.player.name} is already linked.`);
      return;
    }

    setInvitingPlayerId(entry.player.id);
    setMessage("");

    try {
      await sendMagicLink(entry.email, inviteRedirectUrl());

      try {
        const receipt = await recordLeagueRosterInviteSent(
          leagueId,
          entry.membership.id,
        );
        await loadRoster(false);
        setMessage(
          `Supabase accepted the invitation for ${entry.player.name}. ` +
            `Request #${receipt.inviteSendCount} was recorded at ` +
            `${formatInviteTime(receipt.lastInviteSentAt)}.`,
        );
      } catch (trackingError) {
        console.error(trackingError);
        setMessage(
          `Supabase accepted the invitation for ${entry.player.name}, ` +
            "but the send time could not be recorded. Check Auth or SMTP logs.",
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The magic-link invitation could not be requested.",
      );
    } finally {
      setInvitingPlayerId(null);
    }
  }

  async function refreshRoster() {
    setRefreshing(true);
    setMessage("");

    try {
      await loadRoster(true);
      setMessage("Account readiness refreshed.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Account readiness could not be refreshed.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="panel readiness-panel">
      <div className="readiness-heading">
        <div>
          <span className="eyebrow">Player accounts</span>
          <h2>Account readiness</h2>
          <p>
            Add player emails, send secure magic-link invitations, and confirm
            who has completed account linking.
          </p>
        </div>

        <button
          className="secondary-button"
          type="button"
          onClick={() => void refreshRoster()}
          disabled={refreshing || loading}
        >
          {refreshing ? "Refreshing…" : "Refresh Status"}
        </button>
      </div>

      <div className="readiness-summary" aria-label="Account readiness totals">
        <button
          type="button"
          className={filter === "all" ? "selected" : ""}
          onClick={() => selectFilter("all")}
        >
          <strong>{counts.all}</strong>
          <span>All Players</span>
        </button>
        <button
          type="button"
          className={filter === "email-needed" ? "selected" : ""}
          onClick={() => selectFilter("email-needed")}
        >
          <strong>{counts["email-needed"]}</strong>
          <span>Email Needed</span>
        </button>
        <button
          type="button"
          className={filter === "ready" ? "selected" : ""}
          onClick={() => selectFilter("ready")}
        >
          <strong>{counts.ready}</strong>
          <span>Ready to Sign In</span>
        </button>
        <button
          type="button"
          className={filter === "linked" ? "selected" : ""}
          onClick={() => selectFilter("linked")}
        >
          <strong>{counts.linked}</strong>
          <span>Linked</span>
        </button>
      </div>

      <label className="readiness-search">
        <span>Search roster</span>
        <input
          type="search"
          value={search}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setSearch(event.target.value);
            setMessage("");
          }}
          placeholder="Search by player, email, or role"
        />
      </label>

      {!leagueId ? (
        <p className="readiness-note">
          Local mode is active. Cloud linking status becomes available after
          Supabase sign-in.
        </p>
      ) : null}

      {message ? (
        <p className="readiness-message" role="status">
          {message}
        </p>
      ) : null}

      {loading ? (
        <div className="readiness-empty">Loading account readiness…</div>
      ) : visibleEntries.length === 0 ? (
        <div className="readiness-empty">
          No players match the current search and filter.
        </div>
      ) : (
        <div className="readiness-grid">
          {visibleEntries.map((entry) => {
            const editing = editingPlayerId === entry.player.id;
            const linked = entry.status === "linked";
            const leadership = entry.player.role !== "player";
            const saving = savingPlayerId === entry.player.id;
            const inviting = invitingPlayerId === entry.player.id;
            const inviteDisabled =
              !leagueId ||
              !entry.membership?.id ||
              entry.status !== "ready" ||
              Boolean(invitingPlayerId);

            return (
              <article className="readiness-card" key={entry.player.id}>
                <div className="readiness-card__top">
                  <div>
                    <strong>{entry.player.name}</strong>
                    <small>{entry.email || "No email assigned"}</small>
                  </div>
                  <span
                    className={`readiness-badge readiness-badge--${entry.status}`}
                  >
                    {readinessLabel(entry.status)}
                  </span>
                </div>

                <div className="readiness-card__meta">
                  <span className={`role-badge role-badge--${entry.player.role}`}>
                    {roleLabel(entry.player)}
                  </span>
                  <span>{entry.player.status}</span>
                </div>

                <p>{readinessDescription(entry)}</p>

                {editing ? (
                  <form
                    className="readiness-editor"
                    onSubmit={(event: FormEvent) => void saveEdit(event, entry)}
                  >
                    <label>
                      Name
                      <input
                        value={draftName}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setDraftName(event.target.value)
                        }
                        disabled={leadership}
                      />
                    </label>

                    <label>
                      Email
                      <input
                        type="email"
                        value={draftEmail}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setDraftEmail(event.target.value)
                        }
                        placeholder="player@example.com"
                        disabled={linked}
                      />
                    </label>

                    {leadership ? (
                      <small>
                        Commissioner names are protected to preserve leadership
                        assignments.
                      </small>
                    ) : null}
                    {linked ? (
                      <small>
                        Linked account emails are protected. Change the Supabase
                        authentication email before changing this record.
                      </small>
                    ) : null}

                    <div className="readiness-editor__actions">
                      <button
                        className="primary-button"
                        type="submit"
                        disabled={saving}
                      >
                        {saving ? "Saving…" : "Save Player"}
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={cancelEdit}
                        disabled={saving}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    {entry.membership?.lastInviteSentAt ? (
                      <p className="invite-receipt">
                        Last invite requested{" "}
                        <strong>
                          {formatInviteTime(entry.membership.lastInviteSentAt)}
                        </strong>
                        {entry.membership.inviteSendCount > 1
                          ? ` · ${entry.membership.inviteSendCount} requests`
                          : ""}
                      </p>
                    ) : null}

                    <div className="readiness-card__actions">
                      {entry.status === "ready" ? (
                        <button
                          className="primary-button"
                          type="button"
                          onClick={() => void sendInvite(entry)}
                          disabled={inviteDisabled}
                        >
                          {inviting
                            ? "Sending…"
                            : entry.membership?.lastInviteSentAt
                              ? "Resend Invite"
                              : "Send Invite"}
                        </button>
                      ) : null}

                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => beginEdit(entry)}
                        disabled={Boolean(invitingPlayerId)}
                      >
                        Edit Player
                      </button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
