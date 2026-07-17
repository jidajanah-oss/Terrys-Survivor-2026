import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { StatCard } from "./components/StatCard";
import { StatusPill } from "./components/StatusPill";
import { formatKickoff, gameStatusLabel, getGamesForWeek, getTeam, isGameLocked, nflTeams } from "./data/nfl";
import { initialState } from "./data/initialState";
import type { PickResult, Player, PlayerRole, SurvivorState } from "./types/survivor";
import { applyAutomaticResults, DemoNflResultProvider } from "./services/nflResultService";
import { cloudConfigured } from "./config/runtime";
import { CloudAuthGate } from "./features/auth/CloudAuthGate";
import { RosterReadinessPanel } from "./features/commissioner/RosterReadinessPanel";
import { assignCloudLeadership, type CloudMembership } from "./services/accountService";
import { CloudSnapshotRepository } from "./services/cloudSnapshotRepository";
import { LiveNflSyncService } from "./services/liveNflService";
import "./styles.css";

type Page = "home" | "pick" | "entry" | "board" | "commissioner";

const STORAGE_KEY = "nfl-survivor-foundation-v1";
const ROLE_MIGRATION_KEY = "terrys-survivor-role-migration-v7.3";

function currency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function normalizeState(value: SurvivorState): SurvivorState {
  const savedPlayers = Array.isArray(value.players) ? value.players : initialState.players;
  const normalizedPlayers = savedPlayers.map((player) => ({
    ...player,
    email: player.email ?? "",
    role: player.role ?? "player",
    picks: Array.isArray(player.picks) ? player.picks : [],
    buybacks: player.buybacks ?? 0,
  }));

  // Enforce the approved leadership assignments while preserving all other saved data.
  const terryIndex = normalizedPlayers.findIndex(
    (player) => player.name.trim().toLowerCase() === "terry",
  );
  const jimboIndex = normalizedPlayers.findIndex(
    (player) => player.name.trim().toLowerCase() === "jimbo",
  );

  if (terryIndex >= 0 || jimboIndex >= 0) {
    normalizedPlayers.forEach((player, index) => {
      if (player.role === "primary-commissioner" || player.role === "co-commissioner") {
        normalizedPlayers[index] = { ...player, role: "player" };
      }
    });

    if (terryIndex >= 0) {
      normalizedPlayers[terryIndex] = {
        ...normalizedPlayers[terryIndex],
        role: "primary-commissioner",
      };
    }

    if (jimboIndex >= 0) {
      normalizedPlayers[jimboIndex] = {
        ...normalizedPlayers[jimboIndex],
        role: "co-commissioner",
      };
    }
  } else {
    const existingPrimaryIndex = normalizedPlayers.findIndex(
      (player) => player.role === "primary-commissioner",
    );
    const existingCoIndex = normalizedPlayers.findIndex(
      (player) => player.role === "co-commissioner",
    );

    if (existingPrimaryIndex < 0 && normalizedPlayers.length > 0) {
      normalizedPlayers[0] = { ...normalizedPlayers[0], role: "primary-commissioner" };
    }
    if (existingCoIndex < 0 && normalizedPlayers.length > 1) {
      const fallbackIndex = normalizedPlayers.findIndex(
        (player) => player.role !== "primary-commissioner",
      );
      if (fallbackIndex >= 0) {
        normalizedPlayers[fallbackIndex] = {
          ...normalizedPlayers[fallbackIndex],
          role: "co-commissioner",
        };
      }
    }
  }

  const selectedPlayerId = normalizedPlayers.some((player) => player.id === value.selectedPlayerId)
    ? value.selectedPlayerId
    : normalizedPlayers[0]?.id ?? "";

  return {
    settings: { ...initialState.settings, ...value.settings },
    players: normalizedPlayers,
    payments: Array.isArray(value.payments) ? value.payments : [],
    selectedPlayerId,
    closedWeeks: Array.isArray(value.closedWeeks) ? value.closedWeeks : [],
    nflGames: Array.isArray(value.nflGames) ? value.nflGames : [],
    lastScheduleSyncAt: value.lastScheduleSyncAt,
    lastResultSyncAt: value.lastResultSyncAt,
    nflProvider: value.nflProvider,
  };
}


function applyCloudViewer(state: SurvivorState, identity?: CloudMembership | null): SurvivorState {
  if (!identity) return state;
  const match = state.players.find((player) =>
    (identity.email && player.email.toLowerCase() === identity.email.toLowerCase())
    || player.name.toLowerCase() === identity.displayName.toLowerCase()
  );
  return match ? { ...state, selectedPlayerId: match.id } : state;
}

function loadState(): SurvivorState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const baseState = saved ? normalizeState(JSON.parse(saved) as SurvivorState) : normalizeState(initialState);

    // One-time v7.3 migration: force the approved leadership swap while preserving
    // every other saved player field, pick, payment, buyback, and closed week.
    if (localStorage.getItem(ROLE_MIGRATION_KEY) !== "complete") {
      const migratedPlayers = baseState.players.map((player) => {
        const normalizedName = player.name.trim().toLowerCase();
        const isTerry = player.id === "player-terry" || normalizedName === "terry";
        const isJimbo = player.id === "player-jimbo" || normalizedName === "jimbo";

        if (isTerry) return { ...player, role: "primary-commissioner" as PlayerRole };
        if (isJimbo) return { ...player, role: "co-commissioner" as PlayerRole };
        if (player.role === "primary-commissioner" || player.role === "co-commissioner") {
          return { ...player, role: "player" as PlayerRole };
        }
        return player;
      });

      const migratedState = {
        ...baseState,
        players: migratedPlayers,
        selectedPlayerId:
          migratedPlayers.find((player) => player.id === "player-terry" || player.name.trim().toLowerCase() === "terry")?.id
          ?? baseState.selectedPlayerId,
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(migratedState));
      localStorage.setItem(ROLE_MIGRATION_KEY, "complete");
      return migratedState;
    }

    return baseState;
  } catch {
    return normalizeState(initialState);
  }
}

interface SurvivorAppProps {
  cloudIdentity?: CloudMembership | null;
  refreshCloudIdentity?: () => Promise<void>;
}

function SurvivorApp({ cloudIdentity, refreshCloudIdentity }: SurvivorAppProps) {
  const [page, setPage] = useState<Page>("home");
  const [state, setState] = useState<SurvivorState>(loadState);
  const [notice, setNotice] = useState("");
  const [cloudReady, setCloudReady] = useState(!cloudIdentity);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<"local" | "loading" | "saved" | "saving" | "error">(cloudIdentity ? "loading" : "local");
  const [nflSyncing, setNflSyncing] = useState(false);
  const applyingRemoteState = useRef(false);
  const stateRef = useRef(state);

  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    if (!cloudIdentity) {
      setCloudReady(true);
      setCloudSyncStatus("local");
      return;
    }

    let active = true;
    const repository = new CloudSnapshotRepository(cloudIdentity.leagueId);
    setCloudReady(false);
    setCloudSyncStatus("loading");

    repository.load()
      .then(async (cloudState) => {
        if (!active) return;
        const next = applyCloudViewer(
          cloudState ? normalizeState(cloudState) : normalizeState(loadState()),
          cloudIdentity,
        );
        setState(next);
        if (!cloudState && (cloudIdentity.role === "primary-commissioner" || cloudIdentity.role === "co-commissioner")) {
          await repository.save(next);
        }
        if (active) {
          setCloudReady(true);
          setCloudSyncStatus("saved");
        }
      })
      .catch((error: unknown) => {
        console.error(error);
        if (active) {
          setCloudReady(true);
          setCloudSyncStatus("error");
          showNotice("Cloud data could not be loaded. Local data remains available.");
        }
      });

    return () => { active = false; };
  }, [cloudIdentity?.leagueId, cloudIdentity?.memberId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (applyingRemoteState.current) {
      applyingRemoteState.current = false;
      return;
    }
    if (!cloudIdentity || !cloudReady) return;
    const timer = window.setTimeout(() => {
      setCloudSyncStatus("saving");
      new CloudSnapshotRepository(cloudIdentity.leagueId).save(state)
        .then(() => setCloudSyncStatus("saved"))
        .catch((error: unknown) => {
          console.error(error);
          setCloudSyncStatus("error");
          showNotice("Cloud save failed. Your local copy was preserved.");
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [state, cloudIdentity?.leagueId, cloudReady]);

  useEffect(() => {
    if (!cloudIdentity || !cloudReady) return;
    const repository = new CloudSnapshotRepository(cloudIdentity.leagueId);
    const refreshFromCloud = async () => {
      if (cloudSyncStatus === "saving") return;
      try {
        const remote = await repository.load();
        if (!remote) return;
        const normalized = applyCloudViewer(normalizeState(remote), cloudIdentity);
        if (JSON.stringify(normalized) === JSON.stringify(stateRef.current)) return;
        applyingRemoteState.current = true;
        setState(normalized);
        setCloudSyncStatus("saved");
      } catch (error) {
        console.error(error);
      }
    };
    const timer = window.setInterval(refreshFromCloud, 60_000);
    return () => window.clearInterval(timer);
  }, [cloudIdentity?.leagueId, cloudReady, cloudSyncStatus]);

  useEffect(() => {
    const viewer = state.players.find((player) => player.id === state.selectedPlayerId);
    const allowed = viewer?.role === "primary-commissioner" || viewer?.role === "co-commissioner";
    if (page === "commissioner" && !allowed) setPage("home");
  }, [page, state.players, state.selectedPlayerId]);

  const selectedPlayer = state.players.find((player) => player.id === state.selectedPlayerId) ?? state.players[0];
  const hasCommissionerAccess = selectedPlayer?.role === "primary-commissioner" || selectedPlayer?.role === "co-commissioner";
  const prizePool = state.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const activeCount = state.players.filter((player) => player.status === "active").length;
  const eliminatedCount = state.players.length - activeCount;

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  };

  const savePick = (teamId: string) => {
    if (!selectedPlayer || selectedPlayer.status !== "active") return;
    if (state.closedWeeks.includes(state.settings.currentWeek)) {
      showNotice(`Week ${state.settings.currentWeek} is closed and cannot be changed.`);
      return;
    }
    const game = getGamesForWeek(state.settings.currentWeek, state.nflGames, !cloudIdentity).find(
      (item) => item.awayTeamId === teamId || item.homeTeamId === teamId,
    );
    if (!game) return;
    const existingPick = selectedPlayer.picks.find((pick) => pick.week === state.settings.currentWeek);
    const existingGame = existingPick
      ? getGamesForWeek(state.settings.currentWeek, state.nflGames, !cloudIdentity).find(
          (item) => item.id === existingPick.gameId || item.awayTeamId === existingPick.teamId || item.homeTeamId === existingPick.teamId,
        )
      : undefined;
    if ((existingGame && isGameLocked(existingGame)) || isGameLocked(game)) {
      showNotice("This selection is locked because its NFL game has started.");
      return;
    }

    let saved = false;
    setState((current) => ({
      ...current,
      players: current.players.map((player) => {
        if (player.id !== selectedPlayer.id) return player;
        const otherWeekPicks = player.picks.filter((pick) => pick.week !== current.settings.currentWeek);
        const usedBeforeThisWeek = new Set(otherWeekPicks.map((pick) => pick.teamId));
        if (usedBeforeThisWeek.has(teamId)) return player;
        saved = true;
        return {
          ...player,
          picks: [
            ...otherWeekPicks,
            {
              week: current.settings.currentWeek,
              gameId: game.id,
              teamId,
              result: "pending" as const,
              submittedAt: new Date().toISOString(),
            },
          ].sort((a, b) => a.week - b.week),
        };
      }),
    }));

    if (saved) {
      const team = getTeam(teamId);
      showNotice(`${team.city} ${team.name} saved for Week ${state.settings.currentWeek}.`);
    }
  };

  const clearCurrentPick = () => {
    if (!selectedPlayer) return;
    if (state.closedWeeks.includes(state.settings.currentWeek)) {
      showNotice(`Week ${state.settings.currentWeek} is closed and cannot be changed.`);
      return;
    }
    const currentPick = selectedPlayer.picks.find((pick) => pick.week === state.settings.currentWeek);
    const currentGame = currentPick
      ? getGamesForWeek(state.settings.currentWeek, state.nflGames, !cloudIdentity).find(
          (game) => game.id === currentPick.gameId || game.awayTeamId === currentPick.teamId || game.homeTeamId === currentPick.teamId,
        )
      : undefined;
    if (currentGame && isGameLocked(currentGame)) {
      showNotice("This pick is locked because the NFL game has started.");
      return;
    }
    setState((current) => ({
      ...current,
      players: current.players.map((player) =>
        player.id === selectedPlayer.id
          ? { ...player, picks: player.picks.filter((pick) => pick.week !== current.settings.currentWeek) }
          : player,
      ),
    }));
    showNotice("Current-week pick cleared.");
  };

  const resolvePick = (playerId: string, result: PickResult) => {
    const player = state.players.find((item) => item.id === playerId);
    if (!player) return;

    setState((current) => ({
      ...current,
      players: current.players.map((item) => {
        if (item.id !== playerId) return item;

        const currentPick = item.picks.find(
          (pick) => pick.week === current.settings.currentWeek,
        );
        const hasCurrentPick = Boolean(currentPick);
        const resolvedAt = new Date().toISOString();
        const undoingCommissionerOverride =
          result === "pending" &&
          currentPick?.resolutionSource === "commissioner";
        const syntheticNoPick =
          undoingCommissionerOverride &&
          currentPick?.teamId === "NO-PICK" &&
          currentPick?.gameId ===
            `W${current.settings.currentWeek}-NO-PICK`;

        const picks = syntheticNoPick
          ? item.picks.filter(
              (pick) => pick.week !== current.settings.currentWeek,
            )
          : hasCurrentPick
            ? item.picks.map((pick) => {
                if (pick.week !== current.settings.currentWeek) return pick;

                if (undoingCommissionerOverride) {
                  return {
                    ...pick,
                    result: "pending" as const,
                    resolutionSource: undefined,
                    resolvedAt: undefined,
                  };
                }

                return {
                  ...pick,
                  result,
                  resolutionSource: "commissioner" as const,
                  resolvedAt,
                };
              })
            : result === "no-pick"
              ? [
                  ...item.picks,
                  {
                    week: current.settings.currentWeek,
                    gameId: `W${current.settings.currentWeek}-NO-PICK`,
                    teamId: "NO-PICK",
                    result: "no-pick" as const,
                    submittedAt: resolvedAt,
                    resolutionSource: "commissioner" as const,
                    resolvedAt,
                  },
                ].sort((a, b) => a.week - b.week)
              : item.picks;

        const eliminated =
          result === "loss" || result === "tie" || result === "no-pick";

        return {
          ...item,
          picks,
          status: eliminated ? "eliminated" : "active",
          eliminatedWeek: eliminated
            ? current.settings.currentWeek
            : undefined,
        };
      }),
    }));

    showNotice(
      result === "pending"
        ? `${player.name}'s Week ${state.settings.currentWeek} override was undone.`
        : `${player.name}'s Week ${state.settings.currentWeek} result is ${result}.`,
    );
  };
  const buyBack = (playerId: string) => {
    const player = state.players.find((item) => item.id === playerId);
    if (!player || player.status !== "eliminated") return;
    if (state.settings.currentWeek > state.settings.buybackThroughWeek) {
      showNotice(`Buybacks closed after Week ${state.settings.buybackThroughWeek}.`);
      return;
    }

    setState((current) => ({
      ...current,
      players: current.players.map((item) =>
        item.id === playerId
          ? { ...item, status: "active", buybacks: item.buybacks + 1, eliminatedWeek: undefined }
          : item,
      ),
      payments: [
        ...current.payments,
        {
          id: crypto.randomUUID(),
          playerId,
          amount: current.settings.buybackFee,
          type: "buyback",
          week: current.settings.currentWeek,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    showNotice(`${player.name} bought back in for ${currency(state.settings.buybackFee)}. Used teams stayed locked.`);
  };

  const addPlayer = (name: string, email: string, recordPayment: boolean) => {
    const playerId = crypto.randomUUID();
    setState((current) => ({
      ...current,
      players: [
        ...current.players,
        {
          id: playerId,
          name,
          email,
          role: "player",
          status: "active",
          picks: [],
          buybacks: 0,
          joinedAt: new Date().toISOString(),
        },
      ],
      payments: recordPayment
        ? [
            ...current.payments,
            {
              id: crypto.randomUUID(),
              playerId,
              amount: current.settings.entryFee,
              type: "initial-entry",
              week: current.settings.currentWeek,
              createdAt: new Date().toISOString(),
            },
          ]
        : current.payments,
      selectedPlayerId: current.selectedPlayerId || playerId,
    }));
    showNotice(
      recordPayment
        ? `${name} added and the ${currency(state.settings.entryFee)} entry was recorded.`
        : `${name} added with entry payment still due.`,
    );
  };

  const updatePlayer = (playerId: string, name: string, email: string) => {
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const player = state.players.find((item) => item.id === playerId);

    if (!player || !normalizedName) return;

    setState((current) => ({
      ...current,
      players: current.players.map((item) =>
        item.id === playerId
          ? {
              ...item,
              name: normalizedName,
              email: normalizedEmail,
            }
          : item,
      ),
    }));

    showNotice(`${normalizedName}'s account details were updated.`);
  };
  const recordEntryPayment = (playerId: string) => {
    const player = state.players.find((item) => item.id === playerId);
    if (!player) return;
    const alreadyPaid = state.payments.some(
      (payment) => payment.playerId === playerId && payment.type === "initial-entry",
    );
    if (alreadyPaid) return;

    setState((current) => ({
      ...current,
      payments: [
        ...current.payments,
        {
          id: crypto.randomUUID(),
          playerId,
          amount: current.settings.entryFee,
          type: "initial-entry",
          week: current.settings.currentWeek,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    showNotice(`${player.name}'s ${currency(state.settings.entryFee)} entry payment was recorded.`);
  };

  const removePlayer = (playerId: string) => {
    const player = state.players.find((item) => item.id === playerId);
    if (!player) return;
    if (player.role === "primary-commissioner" || player.role === "co-commissioner") {
      showNotice("Assign this commissioner role to another player before removal.");
      return;
    }
    setState((current) => {
      const players = current.players.filter((item) => item.id !== playerId);
      return {
        ...current,
        players,
        payments: current.payments.filter((payment) => payment.playerId !== playerId),
        selectedPlayerId:
          current.selectedPlayerId === playerId ? players[0]?.id ?? "" : current.selectedPlayerId,
      };
    });
    showNotice(`${player.name} and their payment records were removed.`);
  };


  const assignCommissionerRole = (playerId: string, role: PlayerRole) => {
    const player = state.players.find((item) => item.id === playerId);
    if (!player) return;
    if (role === "player" && (player.role === "primary-commissioner" || player.role === "co-commissioner")) {
      showNotice("Assign a replacement commissioner before changing this person to Player.");
      return;
    }

    setState((current) => ({
      ...current,
      players: current.players.map((item) => {
        if (role === "primary-commissioner" && item.role === "primary-commissioner") {
          return { ...item, role: "player" };
        }
        if (role === "co-commissioner" && item.role === "co-commissioner") {
          return { ...item, role: "player" };
        }
        return item.id === playerId ? { ...item, role } : item;
      }),
    }));
    const label = role === "primary-commissioner" ? "Primary Commissioner" : role === "co-commissioner" ? "Co-Commissioner" : "Player";
    showNotice(`${player.name} is now ${label}.`);
  };


  const syncAutomaticResults = async () => {
    if (nflSyncing) return;
    setNflSyncing(true);
    try {
      if (cloudIdentity) {
        const summary = await new LiveNflSyncService(cloudIdentity.leagueId).sync(
          state.settings.season,
          state.settings.currentWeek,
        );
        const refreshed = summary.state ?? await new CloudSnapshotRepository(cloudIdentity.leagueId).load();
        if (refreshed) {
          applyingRemoteState.current = true;
          setState(applyCloudViewer(normalizeState(refreshed), cloudIdentity));
        }
        showNotice(
          `NFL sync complete: ${summary.gamesFetched} games, ${summary.picksResolved} pick${summary.picksResolved === 1 ? "" : "s"} resolved.`,
        );
        return;
      }

      const provider = new DemoNflResultProvider();
      const finals = await provider.fetchFinalResults(state.settings.currentWeek);
      const pendingBefore = state.players.filter((player) => player.picks.some((pick) => pick.week === state.settings.currentWeek && pick.result === "pending")).length;
      setState((current) => applyAutomaticResults(current, finals));
      showNotice(pendingBefore ? `Local demo scoring processed ${pendingBefore} pending pick${pendingBefore === 1 ? "" : "s"}.` : "No pending picks required scoring.");
    } catch (error) {
      console.error(error);
      showNotice(error instanceof Error ? error.message : "NFL results could not be synchronized.");
    } finally {
      setNflSyncing(false);
    }
  };

  const closeCurrentWeek = () => {
    const week = state.settings.currentWeek;
    if (state.closedWeeks.includes(week)) {
      showNotice(`Week ${week} is already closed.`);
      return;
    }

    const unresolvedPicks = state.players.filter((player) => {
      if (player.status !== "active") return false;
      const pick = player.picks.find((item) => item.week === week);
      return Boolean(pick && pick.result === "pending");
    });

    if (unresolvedPicks.length > 0) {
      showNotice(`Resolve ${unresolvedPicks.length} pending pick${unresolvedPicks.length === 1 ? "" : "s"} before closing Week ${week}.`);
      return;
    }

    setState((current) => ({
      ...current,
      closedWeeks: [...new Set([...current.closedWeeks, week])].sort((a, b) => a - b),
      players: current.players.map((player) => {
        if (player.status !== "active") return player;
        const hasPick = player.picks.some((pick) => pick.week === week);
        if (hasPick) return player;
        return {
          ...player,
          status: "eliminated",
          eliminatedWeek: week,
          picks: [
            ...player.picks,
            {
              week,
              gameId: `W${week}-NO-PICK`,
              teamId: "NO-PICK",
              result: "no-pick" as const,
              submittedAt: new Date().toISOString(),
            },
          ].sort((a, b) => a.week - b.week),
        };
      }),
    }));
    showNotice(`Week ${week} closed. Missing picks were eliminated.`);
  };

  const advanceToNextWeek = () => {
    const week = state.settings.currentWeek;
    if (!state.closedWeeks.includes(week)) {
      showNotice(`Close Week ${week} before advancing.`);
      return;
    }
    if (week >= 18) {
      showNotice("Week 18 is the final week.");
      return;
    }
    setState((current) => ({
      ...current,
      settings: { ...current.settings, currentWeek: current.settings.currentWeek + 1 },
    }));
    setPage("home");
    showNotice(`Advanced to Week ${week + 1}.`);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setPage("home")}>
          <img className="brand__logo" src={`${import.meta.env.BASE_URL}terrys-survivor-2026-logo.png`} alt="Terry's Survivor 2026 logo" />
          <span>
            <strong>{state.settings.leagueName}</strong>
            <small>One team. One chance. Survive.</small>
          </span>
        </button>
        {cloudIdentity ? (
          <div className="cloud-identity">
            <small>Signed in as</small>
            <strong>{cloudIdentity.displayName} · {cloudIdentity.role === "primary-commissioner" ? "Primary" : cloudIdentity.role === "co-commissioner" ? "Co-Commish" : "Player"}</strong>
            <span className={`cloud-sync cloud-sync--${cloudSyncStatus}`}>{cloudSyncStatus === "loading" ? "Loading cloud data…" : cloudSyncStatus === "saving" ? "Saving…" : cloudSyncStatus === "saved" ? "Cloud saved" : cloudSyncStatus === "error" ? "Cloud sync error" : "Local mode"}</span>
          </div>
        ) : (
          <label className="player-switcher">
            Local testing as
            <select
              value={state.selectedPlayerId}
              onChange={(event) =>
                setState((current) => ({ ...current, selectedPlayerId: event.target.value }))
              }
            >
              {state.players.map((player) => (
                <option key={player.id} value={player.id}>{player.name} · {player.role === "primary-commissioner" ? "Primary" : player.role === "co-commissioner" ? "Co-Commish" : "Player"}</option>
              ))}
            </select>
          </label>
        )}
      </header>

      {notice ? <div className="notice">{notice}</div> : null}

      <main>
        {page === "home" ? (
          <HomePage
            state={state}
            prizePool={prizePool}
            activeCount={activeCount}
            eliminatedCount={eliminatedCount}
            selectedPlayer={selectedPlayer}
            onMakePick={() => setPage("pick")}
            allowDemoSchedule={!cloudIdentity}
          />
        ) : null}
        {page === "pick" ? (
          <PickPage state={state} player={selectedPlayer} onSave={savePick} onClear={clearCurrentPick} allowDemoSchedule={!cloudIdentity} />
        ) : null}
        {page === "entry" ? (
          <EntryPage
            state={state}
            player={selectedPlayer}
            onBuyBack={() => selectedPlayer && buyBack(selectedPlayer.id)}
          />
        ) : null}
        {page === "board" ? <BoardPage state={state} /> : null}
        {page === "commissioner" && hasCommissionerAccess ? (
          <>
            {cloudIdentity ? (
              <CloudLeadershipPanel identity={cloudIdentity} onRefresh={refreshCloudIdentity} />
            ) : null}
            <RosterReadinessPanel
              players={state.players}
              leagueId={cloudIdentity?.leagueId}
              onUpdatePlayer={updatePlayer}
            />
            <CommissionerPage
            state={state}
            prizePool={prizePool}
            onAddPlayer={addPlayer}
            onResolve={resolvePick}
            onBuyBack={buyBack}
            onRecordEntry={recordEntryPayment}
            onRemovePlayer={removePlayer}
            onSetWeek={(week) =>
              setState((current) => ({
                ...current,
                settings: { ...current.settings, currentWeek: week },
              }))
            }
            onCloseWeek={closeCurrentWeek}
            onAdvanceWeek={advanceToNextWeek}
            onAssignRole={assignCommissionerRole}
            onSyncAutomaticResults={syncAutomaticResults}
            nflSyncing={nflSyncing}
          />
          </>
        ) : null}
      </main>

      <footer>
        <span>Entry: {currency(state.settings.entryFee)}</span>
        <span>Buybacks: {currency(state.settings.buybackFee)} through Week {state.settings.buybackThroughWeek}</span>
        <span>Used teams never reset</span>
        <span>{state.nflProvider ? `NFL data: ${state.nflProvider}` : "NFL data not synced"}</span>
      </footer>

      <nav className="nav-tabs" aria-label="Primary navigation">
        {([
          ["home", "Home"],
          ["pick", "Make Pick"],
          ["entry", "My Entry"],
          ["board", "Survivor Board"],
          ...(hasCommissionerAccess ? [["commissioner", "Commissioner"] as [Page, string]] : []),
        ] as Array<[Page, string]>).map(([key, label]) => (
          <button key={key} className={page === key ? "active" : ""} onClick={() => setPage(key)}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function HomePage({ state, prizePool, activeCount, eliminatedCount, selectedPlayer, onMakePick, allowDemoSchedule }: {
  state: SurvivorState;
  prizePool: number;
  activeCount: number;
  eliminatedCount: number;
  selectedPlayer?: Player;
  onMakePick: () => void;
  allowDemoSchedule: boolean;
}) {
  const currentPick = selectedPlayer?.picks.find((pick) => pick.week === state.settings.currentWeek);
  const currentGame = currentPick
    ? getGamesForWeek(state.settings.currentWeek, state.nflGames, allowDemoSchedule).find(
        (game) => game.id === currentPick.gameId || game.awayTeamId === currentPick.teamId || game.homeTeamId === currentPick.teamId,
      )
    : undefined;
  const totalPaid = state.payments
    .filter((payment) => payment.playerId === selectedPlayer?.id)
    .reduce((sum, payment) => sum + payment.amount, 0);

  return (
    <section className="page-stack">
      <div className="hero-panel">
        <img className="hero-logo" src={`${import.meta.env.BASE_URL}terrys-survivor-2026-logo.png`} alt="Terry's Survivor 2026" />
        <div className="hero-copy">
          <span className="eyebrow">Week {state.settings.currentWeek}</span>
          <h1>Survive the week.</h1>
          <p>Choose one NFL team. Win and continue. Lose, tie, or miss the deadline and the player is eliminated.</p>
        </div>
        <button className="primary-button" onClick={onMakePick} disabled={selectedPlayer?.status !== "active"}>
          {currentPick ? "Change Week Pick" : "Make Week Pick"}
        </button>
      </div>

      <div className="stats-grid">
        <StatCard label="Prize Pool" value={currency(prizePool)} note="Paid entries plus buybacks" />
        <StatCard label="Active Players" value={activeCount} note="Still alive" />
        <StatCard label="Eliminated" value={eliminatedCount} note="Buyback may be available" />
        <StatCard label="Your Total Paid" value={currency(totalPaid)} note="Entry and buybacks" />
      </div>
      <div className="two-column">
        <article className="panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Your status</span><h2>{selectedPlayer?.name ?? "No player"}</h2></div>
            {selectedPlayer ? <StatusPill status={selectedPlayer.status} /> : null}
          </div>
          {currentPick ? (
            <div className="featured-pick">
              <span>Week {state.settings.currentWeek} selection</span>
              <strong>{currentPick.teamId === "NO-PICK" ? "No pick" : `${getTeam(currentPick.teamId).city} ${getTeam(currentPick.teamId).name}`}</strong>
              <small>{currentGame ? `${gameStatusLabel(currentGame.status, currentGame.statusDetail)} · ${formatKickoff(currentGame.kickoff)}` : `Result: ${currentPick.result}`}</small>
              {currentGame?.status === "final" ? <small>Final: {currentGame.awayTeamId} {currentGame.awayScore ?? 0} · {currentGame.homeTeamId} {currentGame.homeScore ?? 0}</small> : null}
            </div>
          ) : <p className="empty-state">No Week {state.settings.currentWeek} pick has been submitted.</p>}
        </article>
        <article className="panel rules-panel">
          <span className="eyebrow">League rules</span>
          <h2>Every selection matters</h2>
          <p>Each player pays $20. A team can be used only once by that player all season. Buybacks cost $20 through Week 5 and restore life—not the team list.</p>
        </article>
      </div>
    </section>
  );
}

function PickPage({ state, player, onSave, onClear, allowDemoSchedule }: {
  state: SurvivorState;
  player?: Player;
  onSave: (teamId: string) => void;
  onClear: () => void;
  allowDemoSchedule: boolean;
}) {
  const currentPick = player?.picks.find((pick) => pick.week === state.settings.currentWeek);
  const weekClosed = state.closedWeeks.includes(state.settings.currentWeek);
  const [pendingTeamId, setPendingTeamId] = useState(currentPick?.teamId ?? "");
  const usedBeforeThisWeek = useMemo(
    () => new Set(player?.picks.filter((pick) => pick.week !== state.settings.currentWeek).map((pick) => pick.teamId) ?? []),
    [player, state.settings.currentWeek],
  );

  useEffect(() => {
    setPendingTeamId(currentPick?.teamId ?? "");
  }, [currentPick?.teamId, player?.id, state.settings.currentWeek]);

  if (!player) return <section className="panel centered"><h1>No players yet</h1><p>Add a player in Commissioner HQ.</p></section>;
  if (weekClosed) {
    return <section className="panel centered"><h1>Week {state.settings.currentWeek} is closed</h1><p>Selections for this week are final and cannot be changed.</p></section>;
  }
  if (player.status === "eliminated") {
    return <section className="panel centered"><h1>Player eliminated</h1><p>A buyback is required before another selection can be made.</p></section>;
  }

  const pendingTeam = pendingTeamId ? getTeam(pendingTeamId) : undefined;
  const games = getGamesForWeek(state.settings.currentWeek, state.nflGames, allowDemoSchedule);
  const currentGame = currentPick
    ? games.find((game) => game.id === currentPick.gameId || game.awayTeamId === currentPick.teamId || game.homeTeamId === currentPick.teamId)
    : undefined;
  const currentPickLocked = Boolean(currentGame && isGameLocked(currentGame));
  const pickChanged = Boolean(pendingTeamId) && pendingTeamId !== currentPick?.teamId && !currentPickLocked;
  const submitPick = () => pendingTeamId && onSave(pendingTeamId);
  const clearPick = () => {
    setPendingTeamId("");
    onClear();
  };

  if (games.length === 0) {
    return (
      <section className="panel centered">
        <span className="eyebrow">Week {state.settings.currentWeek}</span>
        <h1>Live NFL schedule not loaded</h1>
        <p>A commissioner needs to open Commissioner HQ and run Check Live NFL Schedule & Results.</p>
      </section>
    );
  }

  return (
    <section className="page-stack pick-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Week {state.settings.currentWeek}</span>
          <h1>Choose one team</h1>
          <p>Select a team, then press Submit Pick. Any team used before an elimination remains locked after a buyback.</p>
        </div>
        {currentPick ? <button className="secondary-button" onClick={clearPick} disabled={currentPickLocked}>{currentPickLocked ? "Pick Locked" : "Clear Current Pick"}</button> : null}
      </div>
      <div className="used-team-strip">
        <strong>Used teams:</strong>
        {usedBeforeThisWeek.size === 0
          ? <span>None yet</span>
          : [...usedBeforeThisWeek].map((teamId) => <span key={teamId}>{teamId}</span>)}
      </div>
      <div className="pick-selection-summary" aria-live="polite">
        <div>
          <span className="eyebrow">Current selection</span>
          <strong>{pendingTeam ? `${pendingTeam.city} ${pendingTeam.name}` : "No team selected"}</strong>
          <small>{currentPick?.teamId === pendingTeamId && pendingTeamId ? "This pick is saved." : pendingTeamId ? "Not saved yet." : "Choose one team below."}</small>
        </div>
        <button className="primary-button" onClick={submitPick} disabled={!pickChanged}>
          {currentPick && !pickChanged ? "Pick Saved" : currentPick ? `Update Week ${state.settings.currentWeek} Pick` : `Submit Week ${state.settings.currentWeek} Pick`}
        </button>
      </div>
      <div className="games-grid">
        {games.map((game) => (
          <article className="game-card" key={game.id}>
            {[game.awayTeamId, game.homeTeamId].map((teamId, index) => {
              const team = getTeam(teamId);
              const used = usedBeforeThisWeek.has(teamId);
              const locked = isGameLocked(game);
              const selected = pendingTeamId === teamId;
              return (
                <button
                  key={teamId}
                  className={`team-choice ${selected ? "selected" : ""}`}
                  onClick={() => setPendingTeamId(teamId)}
                  disabled={used || locked}
                >
                  <span className="team-abbr">{team.abbreviation}</span>
                  <span><strong>{team.city}</strong><small>{team.name}</small></span>
                  <em>{used ? "Used" : locked ? "Locked" : selected ? "Selected" : index === 0 ? "Away" : "Home"}</em>
                </button>
              );
            })}
            <small className={`kickoff kickoff--${game.status}`}>{gameStatusLabel(game.status, game.statusDetail)} · {formatKickoff(game.kickoff)}{game.status === "final" ? ` · ${game.awayTeamId} ${game.awayScore ?? 0}–${game.homeScore ?? 0} ${game.homeTeamId}` : ""}</small>
          </article>
        ))}
      </div>
      <div className="pick-submit-dock" aria-live="polite">
        <div>
          <small>Week {state.settings.currentWeek} selection</small>
          <strong>{pendingTeam ? `${pendingTeam.abbreviation} · ${pendingTeam.city} ${pendingTeam.name}` : "Choose a team"}</strong>
        </div>
        <button className="primary-button" onClick={submitPick} disabled={!pickChanged}>
          {currentPick && !pickChanged ? "Pick Saved" : currentPick ? "Update Pick" : "Submit Pick"}
        </button>
      </div>
    </section>
  );
}

function EntryPage({ state, player, onBuyBack }: {
  state: SurvivorState;
  player?: Player;
  onBuyBack: () => void;
}) {
  if (!player) return <section className="panel centered"><h1>No players yet</h1></section>;
  const buybackAvailable = player.status === "eliminated" && state.settings.currentWeek <= state.settings.buybackThroughWeek;
  const payments = state.payments.filter((payment) => payment.playerId === player.id);
  const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const uniqueUsed = new Set(player.picks.map((pick) => pick.teamId));

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div><span className="eyebrow">Player profile</span><h1>{player.name}</h1><p>{player.email || "No email entered"}</p></div>
        <StatusPill status={player.status} />
      </div>
      <div className="stats-grid">
        <StatCard label="Total Paid" value={currency(totalPaid)} />
        <StatCard label="Buybacks" value={player.buybacks} />
        <StatCard label="Teams Used" value={uniqueUsed.size} />
        <StatCard label="Teams Remaining" value={nflTeams.length - uniqueUsed.size} />
      </div>
      {buybackAvailable ? (
        <article className="buyback-card">
          <div>
            <span className="eyebrow">Buyback available</span>
            <h2>Return for {currency(state.settings.buybackFee)}</h2>
            <p>All {uniqueUsed.size} previously used team{uniqueUsed.size === 1 ? "" : "s"} will remain unavailable.</p>
          </div>
          <button className="primary-button" onClick={onBuyBack}>Record Buyback</button>
        </article>
      ) : null}
      {player.status === "eliminated" && !buybackAvailable ? (
        <article className="closed-card">
          <strong>Buyback window closed</strong>
          <span>Buybacks ended after Week {state.settings.buybackThroughWeek}.</span>
        </article>
      ) : null}
      <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Season history</span><h2>Weekly selections</h2></div></div>
        {player.picks.length === 0 ? <p className="empty-state">No selections yet.</p> : (
          <div className="history-list">
            {player.picks.map((pick) => {
              const team = pick.teamId === "NO-PICK" ? undefined : getTeam(pick.teamId);
              return (
                <div key={pick.week}>
                  <span>Week {pick.week}</span>
                  <strong>{team ? `${team.city} ${team.name}` : "No pick"}</strong>
                  <em className={`result result--${pick.result}`}>{pick.result}</em>
                </div>
              );
            })}
          </div>
        )}
      </article>
      <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Payments</span><h2>Entry ledger</h2></div></div>
        <div className="payment-list compact-payment-list">
          {payments.length === 0 ? <p className="empty-state">No payments recorded.</p> : payments.map((payment) => (
            <div key={payment.id}>
              <span>{payment.type === "buyback" ? `Week ${payment.week} buyback` : "Initial entry"}</span>
              <strong>{currency(payment.amount)}</strong>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

function BoardPage({ state }: { state: SurvivorState }) {
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div><span className="eyebrow">League board</span><h1>Survivor standings</h1><p>Active players first. Used-team and buyback history always stays attached to the same player.</p></div>
      </div>
      <div className="board-table-wrap">
        <table className="board-table">
          <thead>
            <tr><th>Player</th><th>Entry</th><th>Status</th><th>Week {state.settings.currentWeek}</th><th>Used</th><th>Buybacks</th><th>Total Paid</th></tr>
          </thead>
          <tbody>
            {[...state.players].sort((a, b) => a.status.localeCompare(b.status)).map((player) => {
              const currentPick = player.picks.find((pick) => pick.week === state.settings.currentWeek);
              const payments = state.payments.filter((payment) => payment.playerId === player.id);
              const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
              const entryPaid = payments.some((payment) => payment.type === "initial-entry");
              return (
                <tr key={player.id}>
                  <td><strong>{player.name}</strong><small>{player.email || "No email"}</small></td>
                  <td><span className={`payment-status ${entryPaid ? "payment-status--paid" : "payment-status--due"}`}>{entryPaid ? "Paid" : "Due"}</span></td>
                  <td><StatusPill status={player.status} /></td>
                  <td>{currentPick ? `${currentPick.teamId === "NO-PICK" ? "—" : getTeam(currentPick.teamId).abbreviation} · ${currentPick.result}` : "No pick"}</td>
                  <td>{[...new Set(player.picks.map((pick) => pick.teamId))].join(", ") || "—"}</td>
                  <td>{player.buybacks}</td>
                  <td>{currency(paid)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CloudLeadershipPanel({ identity, onRefresh }: { identity: CloudMembership; onRefresh?: () => Promise<void> }) {
  const [terryEmail, setTerryEmail] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!terryEmail.trim()) return;
    setWorking(true);
    setMessage("");
    try {
      await assignCloudLeadership(terryEmail, "Terry");
      await onRefresh?.();
      setMessage("Leadership updated: Terry is Primary Commissioner and Jimbo is Co-Commissioner. Terry can claim the Primary account later with this email.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Leadership could not be updated.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="page-stack cloud-leadership-stack">
      <article className="panel leadership-panel cloud-leadership-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">Cloud leadership</span><h2>Terry Primary · Jimbo Co-Commissioner</h2></div>
          <span className={`payment-status ${identity.role === "primary-commissioner" ? "payment-status--paid" : "payment-status--due"}`}>
            Signed in as {identity.role === "primary-commissioner" ? "Primary" : "Co-Commissioner"}
          </span>
        </div>
        {identity.role === "primary-commissioner" ? (
          <form className="form-stack" onSubmit={submit}>
            <p>Enter Terry’s exact sign-in email. The cloud roster will immediately reserve Primary Commissioner for Terry and move this account to Co-Commissioner. Terry can sign in and claim the reserved account later.</p>
            <label>Terry’s email<input type="email" required value={terryEmail} onChange={(event) => setTerryEmail(event.target.value)} placeholder="terry@example.com" /></label>
            <button className="primary-button" type="submit" disabled={working}>{working ? "Updating leadership…" : "Make Terry Primary"}</button>
          </form>
        ) : (
          <p>Terry is reserved as Primary Commissioner. Jimbo remains Co-Commissioner with full Commissioner HQ access.</p>
        )}
        {message ? <div className="auth-message">{message}</div> : null}
      </article>
    </section>
  );
}

function CommissionerPage({
  state,
  prizePool,
  onAddPlayer,
  onResolve,
  onBuyBack,
  onRecordEntry,
  onRemovePlayer,
  onSetWeek,
  onCloseWeek,
  onAdvanceWeek,
  onAssignRole,
  onSyncAutomaticResults,
  nflSyncing,
}: {
  state: SurvivorState;
  prizePool: number;
  onAddPlayer: (name: string, email: string, recordPayment: boolean) => void;
  onResolve: (playerId: string, result: PickResult) => void;
  onBuyBack: (playerId: string) => void;
  onRecordEntry: (playerId: string) => void;
  onRemovePlayer: (playerId: string) => void;
  onSetWeek: (week: number) => void;
  onCloseWeek: () => void;
  onAdvanceWeek: () => void;
  onAssignRole: (playerId: string, role: PlayerRole) => void;
  onSyncAutomaticResults: () => void;
  nflSyncing: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [recordPayment, setRecordPayment] = useState(true);
  const activeCount = state.players.filter((player) => player.status === "active").length;
  const initialPaidCount = state.players.filter((player) =>
    state.payments.some((payment) => payment.playerId === player.id && payment.type === "initial-entry"),
  ).length;
  const buybacksClosed = state.settings.currentWeek > state.settings.buybackThroughWeek;
  const weekClosed = state.closedWeeks.includes(state.settings.currentWeek);
  const pendingCount = state.players.filter((player) => {
    if (player.status !== "active") return false;
    const pick = player.picks.find((item) => item.week === state.settings.currentWeek);
    return Boolean(pick && pick.result === "pending");
  }).length;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    onAddPlayer(name.trim(), email.trim(), recordPayment);
    setName("");
    setEmail("");
    setRecordPayment(true);
  };

  const requestRemove = (player: Player) => {
    const warning = player.picks.length || player.buybacks
      ? `${player.name} has pick or buyback history. Remove the player and all related payment records?`
      : `Remove ${player.name} and any payment records?`;
    if (window.confirm(warning)) onRemovePlayer(player.id);
  };

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div><span className="eyebrow">Commissioner HQ</span><h1>Roster and buybacks</h1><p>Manage one Primary Commissioner, one Co-Commissioner, players, payments, eliminations, and buybacks.</p></div>
        <strong className="pool-badge">Pool {currency(prizePool)}</strong>
      </div>

      <article className="panel leadership-panel">
        <div className="panel-heading"><div><span className="eyebrow">League leadership</span><h2>Commissioner assignments</h2></div></div>
        <p>Exactly one Primary Commissioner and one Co-Commissioner receive Commissioner HQ access.</p>
        <div className="leadership-grid">
          {state.players.map((player) => (
            <div className="leadership-row" key={player.id}>
              <div><strong>{player.name}</strong><small>{player.email || "No email"}</small></div>
              <select value={player.role} onChange={(event) => onAssignRole(player.id, event.target.value as PlayerRole)}>
                <option value="player">Player</option>
                <option value="primary-commissioner">Primary Commissioner</option>
                <option value="co-commissioner">Co-Commissioner</option>
              </select>
            </div>
          ))}
        </div>
      </article>

      <div className="stats-grid">
        <StatCard label="Roster" value={state.players.length} note={`${activeCount} active`} />
        <StatCard label="Entries Paid" value={`${initialPaidCount}/${state.players.length}`} note={`${state.players.length - initialPaidCount} still due`} />
        <StatCard label="Buybacks" value={state.payments.filter((payment) => payment.type === "buyback").length} note={`${currency(state.settings.buybackFee)} each`} />
        <StatCard label="Prize Pool" value={currency(prizePool)} note="Recorded payments" />
      </div>

      <div className="two-column">
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">New player</span><h2>Add to roster</h2></div></div>
          <form className="form-stack" onSubmit={submit}>
            <label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Player name" /></label>
            <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Optional email" /></label>
            <label className="checkbox-label">
              <input type="checkbox" checked={recordPayment} onChange={(event) => setRecordPayment(event.target.checked)} />
              Record the {currency(state.settings.entryFee)} entry as paid now
            </label>
            <button className="primary-button" type="submit">Add Player</button>
          </form>
        </article>
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">League week</span><h2>Current Week</h2></div></div>
          <div className="week-control">
            <button onClick={() => onSetWeek(Math.max(1, state.settings.currentWeek - 1))}>−</button>
            <strong>{state.settings.currentWeek}</strong>
            <button onClick={() => onSetWeek(Math.min(18, state.settings.currentWeek + 1))}>+</button>
          </div>
          <p className={buybacksClosed ? "warning-text" : ""}>
            {buybacksClosed
              ? `Buybacks are closed. The final buyback week was Week ${state.settings.buybackThroughWeek}.`
              : `Buybacks remain available through Week ${state.settings.buybackThroughWeek}.`}
          </p>
        </article>
      </div>

      <article className="panel cloud-readiness-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">Live NFL automation</span><h2>Schedule and final scoring</h2></div>
          <span className={`payment-status ${cloudConfigured ? "payment-status--paid" : "payment-status--due"}`}>{cloudConfigured ? "Supabase configured" : "Local development"}</span>
        </div>
        <p>Supabase now fetches the live NFL schedule and final scores through a server-side Edge Function. Final games automatically mark picks as wins, losses, or ties and eliminate losing entries.</p>
        <div className="row-actions">
          <button className="primary-button" onClick={onSyncAutomaticResults} disabled={nflSyncing}>{nflSyncing ? "Checking NFL…" : "Check Live NFL Schedule & Results"}</button>
          <span className="sync-stamp">{state.lastScheduleSyncAt ? `Last NFL sync: ${new Date(state.lastScheduleSyncAt).toLocaleString()}` : "No live NFL sync yet"}</span>
        </div>
        <small>{cloudConfigured ? `Provider: ${state.nflProvider ?? "waiting for first sync"}. A scheduled Supabase job can run this automatically even when no player has the app open.` : "Local mode continues to use a demonstration schedule and deterministic test results."}</small>
      </article>

      <article className="panel weekly-closeout-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">Weekly operations</span><h2>Close and advance Week {state.settings.currentWeek}</h2></div>
          <span className={`payment-status ${weekClosed ? "payment-status--paid" : "payment-status--due"}`}>{weekClosed ? "Closed" : "Open"}</span>
        </div>
        <p>{weekClosed
          ? `Week ${state.settings.currentWeek} is locked. You may advance to the next week.`
          : pendingCount > 0
            ? `${pendingCount} submitted pick${pendingCount === 1 ? " is" : "s are"} still pending a final result.`
            : "All submitted picks are resolved. Closing the week will eliminate active players who did not submit a pick."}</p>
        <div className="row-actions">
          <button className="primary-button" onClick={onCloseWeek} disabled={weekClosed || pendingCount > 0}>Close Week {state.settings.currentWeek}</button>
          <button className="buyback-button" onClick={onAdvanceWeek} disabled={!weekClosed || state.settings.currentWeek >= 18}>Advance to Week {Math.min(18, state.settings.currentWeek + 1)}</button>
        </div>
      </article>

      <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Roster manager</span><h2>Players and payments</h2></div></div>
        {state.players.length === 0 ? <p className="empty-state">No players have been added.</p> : (
          <div className="roster-manager">
            {state.players.map((player) => {
              const playerPayments = state.payments.filter((payment) => payment.playerId === player.id);
              const entryPaid = playerPayments.some((payment) => payment.type === "initial-entry");
              const totalPaid = playerPayments.reduce((sum, payment) => sum + payment.amount, 0);
              const canBuyBack = player.status === "eliminated" && !buybacksClosed;
              const usedTeams = [...new Set(player.picks.map((pick) => pick.teamId))];
              return (
                <div className="roster-card" key={player.id}>
                  <div className="roster-card__identity">
                    <div><strong>{player.name}</strong><small>{player.email || "No email"}</small><span className={`role-badge role-badge--${player.role}`}>{player.role === "primary-commissioner" ? "Primary Commissioner" : player.role === "co-commissioner" ? "Co-Commissioner" : "Player"}</span></div>
                    <StatusPill status={player.status} />
                  </div>
                  <div className="roster-card__metrics">
                    <span><small>Entry</small><strong className={entryPaid ? "paid-text" : "due-text"}>{entryPaid ? "Paid" : "Due"}</strong></span>
                    <span><small>Total paid</small><strong>{currency(totalPaid)}</strong></span>
                    <span><small>Buybacks</small><strong>{player.buybacks}</strong></span>
                    <span><small>Teams used</small><strong>{usedTeams.length}</strong></span>
                  </div>
                  <div className="used-team-line"><small>Locked teams:</small><span>{usedTeams.join(", ") || "None"}</span></div>
                  <div className="row-actions roster-actions">
                    {!entryPaid ? <button onClick={() => onRecordEntry(player.id)}>Record {currency(state.settings.entryFee)} Entry</button> : null}
                    {canBuyBack ? <button className="buyback-button" onClick={() => onBuyBack(player.id)}>Buy Back {currency(state.settings.buybackFee)}</button> : null}
                    <button className="remove-button" onClick={() => requestRemove(player)}>Remove</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </article>

      <article className="panel">
      <details className="panel override-panel">
        <summary className="override-summary">
          <div>
            <span className="eyebrow">Commissioner safety</span>
            <h2>Result Corrections &amp; Overrides</h2>
            <p>
              Automatic NFL scoring remains the normal process. Open these
              controls only for provider errors, postponed games, cancellations,
              or an approved correction.
            </p>
          </div>
          <span className="override-summary__action">Open controls</span>
        </summary>

        <div className="override-body">
          <p className="override-warning">
            Every override requires confirmation. Win, Loss, and Tie require an
            existing Week {state.settings.currentWeek} pick. No Pick can create
            the missing-pick record for the current week.
          </p>

          <div className="override-list">
            {state.players.map((player) => {
              const pick = player.picks.find(
                (item) => item.week === state.settings.currentWeek,
              );

              const requestOverride = (result: PickResult) => {
                const resultLabel =
                  result === "no-pick"
                    ? "No Pick"
                    : result.charAt(0).toUpperCase() + result.slice(1);
                const warning =
                  result === "pending"
                    ? `Undo ${player.name}'s Week ${state.settings.currentWeek} ` +
                      "commissioner override and restore the prior state?"
                    : `Override ${player.name}'s Week ` +
                      `${state.settings.currentWeek} result to ${resultLabel}?`;

                if (window.confirm(warning)) {
                  onResolve(player.id, result);
                }
              };

              return (
                <div className="override-player-row" key={player.id}>
                  <div>
                    <strong>{player.name}</strong>
                    <small>
                      {pick
                        ? `${
                            pick.teamId === "NO-PICK"
                              ? "No pick"
                              : `Picked ${getTeam(pick.teamId).abbreviation}`
                          } · ${pick.result}`
                        : "No weekly pick"}
                    </small>
                  </div>

                  <div className="override-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => requestOverride("win")}
                      disabled={!pick || pick.result === "win"}
                    >
                      Win
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => requestOverride("loss")}
                      disabled={!pick || pick.result === "loss"}
                    >
                      Loss
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => requestOverride("tie")}
                      disabled={!pick || pick.result === "tie"}
                    >
                      Tie
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => requestOverride("no-pick")}
                      disabled={pick?.result === "no-pick"}
                    >
                      No Pick
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => requestOverride("pending")}
                      disabled={pick?.resolutionSource !== "commissioner"}
                    >
                      Undo Override
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </details>
        <div className="panel-heading"><div><span className="eyebrow">Money trail</span><h2>Payment ledger</h2></div><strong>{currency(prizePool)}</strong></div>
        {state.payments.length === 0 ? <p className="empty-state">No payments recorded.</p> : (
          <div className="payment-list">
            {[...state.payments].reverse().map((payment) => {
              const player = state.players.find((item) => item.id === payment.playerId);
              return (
                <div key={payment.id}>
                  <span><strong>{player?.name ?? "Removed player"}</strong><small>{payment.type === "buyback" ? `Week ${payment.week} buyback` : "Initial entry"}</small></span>
                  <strong>{currency(payment.amount)}</strong>
                </div>
              );
            })}
          </div>
        )}
      </article>

    </section>
  );
}

function App() {
  return (
    <CloudAuthGate>
      {(identity, _session, refreshIdentity) => <SurvivorApp cloudIdentity={identity} refreshCloudIdentity={refreshIdentity} />}
    </CloudAuthGate>
  );
}

export default App;
