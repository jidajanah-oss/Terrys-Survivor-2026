import { reconcileEntry } from "../_shared/survivorStatus.ts";
﻿import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

interface SyncRequest {
  leagueId?: string;
  season?: number;
  week?: number;
}

interface ProviderGame {
  id: string;
  week: number;
  awayTeamId: string;
  homeTeamId: string;
  kickoff: string;
  status:
    | "scheduled"
    | "in-progress"
    | "final"
    | "postponed"
    | "canceled";
  awayScore?: number;
  homeScore?: number;
  statusDetail?: string;
  provider: "espn-scoreboard";
  providerUpdatedAt: string;
}

interface LeagueSyncResult {
  leagueId: string;
  provider: string;
  season: number;
  week: number;
  gamesFetched: number;
  finalGames: number;
  picksResolved: number;
  playersEliminated: number;
  syncedAt: string;
  state?: Record<string, unknown>;
}

function normalizeTeamId(value: string): string {
  const id = value.trim().toUpperCase();

  const aliases: Record<string, string> = {
    JAC: "JAX",
    WSH: "WAS",
  };

  return aliases[id] ?? id;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function mapStatus(status: any): ProviderGame["status"] {
  const type = status?.type ?? {};

  const text =
    `${type.name ?? ""} ${type.description ?? ""} ${type.detail ?? ""}`.toLowerCase();

  if (text.includes("cancel")) return "canceled";
  if (text.includes("postpon")) return "postponed";
  if (type.completed === true || type.state === "post") return "final";
  if (type.state === "in") return "in-progress";

  return "scheduled";
}

async function fetchEspnWeek(
  season: number,
  week: number,
): Promise<ProviderGame[]> {
  const baseUrl =
    Deno.env.get("NFL_SCOREBOARD_BASE_URL") ??
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

  const url = new URL(baseUrl);

  url.searchParams.set("dates", String(season));
  url.searchParams.set("seasontype", "2");
  url.searchParams.set("week", String(week));
  url.searchParams.set("limit", "100");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Terrys-Survivor-2026/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`NFL provider returned ${response.status}.`);
  }

  const payload = await response.json();
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const syncedAt = new Date().toISOString();

  return events.flatMap((event: any) => {
    const competition = event?.competitions?.[0];

    const competitors = Array.isArray(competition?.competitors)
      ? competition.competitors
      : [];

    const away = competitors.find(
      (item: any) => item?.homeAway === "away",
    );

    const home = competitors.find(
      (item: any) => item?.homeAway === "home",
    );

    const awayTeamId = normalizeTeamId(
      away?.team?.abbreviation ?? "",
    );

    const homeTeamId = normalizeTeamId(
      home?.team?.abbreviation ?? "",
    );

    if (!event?.id || !awayTeamId || !homeTeamId) {
      return [];
    }

    const status = mapStatus(
      event?.status ?? competition?.status,
    );

    const statusType =
      event?.status?.type ??
      competition?.status?.type ??
      {};

    return [
      {
        id: String(event.id),
        week,
        awayTeamId,
        homeTeamId,
        kickoff: String(
          event.date ??
            competition?.date ??
            new Date().toISOString(),
        ),
        status,
        awayScore: numberOrUndefined(away?.score),
        homeScore: numberOrUndefined(home?.score),
        statusDetail:
          String(
            statusType.shortDetail ??
              statusType.detail ??
              statusType.description ??
              "",
          ).trim() || undefined,
        provider: "espn-scoreboard" as const,
        providerUpdatedAt: syncedAt,
      },
    ];
  });
}

function resolveState(
  rawState: Record<string, any>,
  games: ProviderGame[],
  season: number,
  week: number,
): {
  state: Record<string, unknown>;
  picksResolved: number;
  playersEliminated: number;
} {
  const syncedAt = new Date().toISOString();

  let picksResolved = 0;
  let playersEliminated = 0;

  const previousGames = Array.isArray(rawState.nflGames)
    ? rawState.nflGames
    : [];

  const mergedGames = [
    ...previousGames.filter(
      (game: any) => Number(game?.week) !== week,
    ),
    ...games,
  ].sort(
    (a: any, b: any) =>
      new Date(a.kickoff).getTime() -
      new Date(b.kickoff).getTime(),
  );

  const players = (
    Array.isArray(rawState.players)
      ? rawState.players
      : []
  ).map((player: any) => {
    const picks = Array.isArray(player.picks)
      ? player.picks
      : [];

    const normalizedPicks = picks.map((pick: any) => {
      const pickWeek = Number(pick.week);
      const teamId = normalizeTeamId(String(pick.teamId ?? ""));
      const candidates = mergedGames.filter((game: any) => Number(game.week) === pickWeek
        && [game.awayTeamId, game.homeTeamId].includes(teamId));
      const game = candidates.find((game: any) => game.id === String(pick.gameId)) ?? candidates[0];
      if (!game || pick.result !== "pending" || game.status !== "final"
        || !Number.isFinite(game.awayScore) || !Number.isFinite(game.homeScore)) return pick;
      const result = game.awayScore === game.homeScore ? "tie"
        : (game.awayScore > game.homeScore ? game.awayTeamId : game.homeTeamId) === teamId ? "win" : "loss";
      picksResolved += 1;
      return { ...pick, gameId: game.id, result, resolutionSource: "automatic", resolvedAt: syncedAt };
    });
    const resolved = reconcileEntry({ ...player, picks: normalizedPicks }, rawState.payments ?? []);
    if (resolved.status === "eliminated" && player.status !== "eliminated") playersEliminated += 1;
    return resolved;
  });

  return {
    state: {
      ...rawState,
      settings: {
        ...(rawState.settings ?? {}),
        season,
      },
      players,
      nflGames: mergedGames,
      lastScheduleSyncAt: syncedAt,
      lastResultSyncAt: games.some(
        (game) => game.status === "final",
      )
        ? syncedAt
        : rawState.lastResultSyncAt,
      nflProvider: "espn-scoreboard",
    },
    picksResolved,
    playersEliminated,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "POST required.",
      }),
      {
        status: 405,
        headers: jsonHeaders,
      },
    );
  }

  try {
    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");

    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const cronSecret =
      Deno.env.get("NFL_SYNC_CRON_SECRET");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "Supabase function secrets are unavailable.",
      );
    }

    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
        },
      },
    );

    const body =
      (await request
        .json()
        .catch(() => ({}))) as SyncRequest;

    const authorization =
      request.headers.get("Authorization") ?? "";

    const suppliedCronSecret =
      request.headers.get("x-cron-secret") ?? "";

    const hasCronHeader =
      suppliedCronSecret.length > 0;

    const isScheduledCall =
      Boolean(cronSecret) &&
      suppliedCronSecret === cronSecret;

    let actorId: string | null = null;

    if (hasCronHeader && !isScheduledCall) {
      throw new Error(
        "Scheduled synchronization authentication failed.",
      );
    }

    if (!isScheduledCall) {
      const token = authorization.replace(
        /^Bearer\s+/i,
        "",
      );

      if (!token) {
        throw new Error(
          "Authentication required.",
        );
      }

      const {
        data: userData,
        error: userError,
      } = await admin.auth.getUser(token);

      if (userError || !userData.user) {
        throw new Error(
          "The signed-in account could not be verified.",
        );
      }

      actorId = userData.user.id;

      if (!body.leagueId) {
        throw new Error(
          "A league is required for manual NFL sync.",
        );
      }

      const {
        data: memberships,
        error: memberError,
      } = await admin
        .from("league_members")
        .select("role")
        .eq("league_id", body.leagueId)
        .eq("user_id", actorId);

      if (memberError) {
        throw memberError;
      }

      const hasCommissionerAccess =
        (memberships ?? []).some(
          (member) =>
            member.role === "primary-commissioner" ||
            member.role === "co-commissioner",
        );

      if (!hasCommissionerAccess) {
        throw new Error(
          "Commissioner access is required to run NFL sync manually.",
        );
      }
    }

    let leagueQuery = admin
      .from("leagues")
      .select("id, season, current_week");

    if (body.leagueId) {
      leagueQuery = leagueQuery.eq(
        "id",
        body.leagueId,
      );
    }

    const {
      data: leagues,
      error: leagueError,
    } = await leagueQuery;

    if (leagueError) throw leagueError;

    if (!leagues?.length) {
      throw new Error(
        "No survivor leagues were found.",
      );
    }

    const weekCache =
      new Map<string, ProviderGame[]>();

    const results: LeagueSyncResult[] = [];

    for (const league of leagues) {
      const season = Number(
        body.season ??
          league.season ??
          2026,
      );

      const week = Number(
        body.week ??
          league.current_week ??
          1,
      );

      const cacheKey = `${season}-${week}`;

      let games = weekCache.get(cacheKey);

      if (!games) {
        games = await fetchEspnWeek(
          season,
          week,
        );

        weekCache.set(
          cacheKey,
          games,
        );
      }

      if (games.length > 0) {
        const {
          error: gameError,
        } = await admin
          .from("nfl_games")
          .upsert(
            games.map((game) => ({
              id: game.id,
              season,
              week,
              away_team_id: game.awayTeamId,
              home_team_id: game.homeTeamId,
              kickoff: game.kickoff,
              status: game.status,
              away_score:
                game.awayScore ?? null,
              home_score:
                game.homeScore ?? null,
              status_detail:
                game.statusDetail ?? null,
              provider: game.provider,
              provider_updated_at:
                game.providerUpdatedAt,
            })),
            {
              onConflict:
                "id",
            },
          );

        if (gameError) throw gameError;
      }

      const {
        data: snapshot,
        error: snapshotError,
      } = await admin
        .from("league_snapshots")
        .select("state")
        .eq("league_id", league.id)
        .maybeSingle();

      if (snapshotError) {
        throw snapshotError;
      }

      if (!snapshot?.state) {
        results.push({
          leagueId: league.id,
          provider: "espn-scoreboard",
          season,
          week,
          gamesFetched: games.length,
          finalGames: games.filter(
            (game) =>
              game.status === "final",
          ).length,
          picksResolved: 0,
          playersEliminated: 0,
          syncedAt:
            new Date().toISOString(),
        });

        continue;
      }

      const resolved = resolveState(
        snapshot.state,
        games,
        season,
        week,
      );

      const {
        error: updateError,
      } = await admin
        .from("league_snapshots")
        .update({
          state: resolved.state,
          updated_at:
            new Date().toISOString(),
          updated_by: actorId,
        })
        .eq("league_id", league.id);

      if (updateError) {
        throw updateError;
      }

      results.push({
        leagueId: league.id,
        provider: "espn-scoreboard",
        season,
        week,
        gamesFetched: games.length,
        finalGames: games.filter(
          (game) =>
            game.status === "final",
        ).length,
        picksResolved:
          resolved.picksResolved,
        playersEliminated:
          resolved.playersEliminated,
        syncedAt:
          new Date().toISOString(),
        state: resolved.state,
      });
    }

    return new Response(
      JSON.stringify(
        results.length === 1
          ? results[0]
          : { results },
      ),
      {
        status: 200,
        headers: jsonHeaders,
      },
    );
  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "NFL synchronization failed.",
      }),
      {
        status: 500,
        headers: jsonHeaders,
      },
    );
  }
});

