export type PickResult = "pending" | "win" | "loss" | "tie" | "no-pick";
export type PlayerStatus = "active" | "eliminated";
export type PlayerRole = "primary-commissioner" | "co-commissioner" | "player";

export interface Team {
  id: string;
  name: string;
  city: string;
  abbreviation: string;
}

export interface Game {
  id: string;
  week: number;
  awayTeamId: string;
  homeTeamId: string;
  kickoff: string;
}

export interface SurvivorPick {
  week: number;
  gameId: string;
  teamId: string;
  result: PickResult;
  submittedAt: string;
  resolutionSource?: "automatic" | "commissioner";
  resolvedAt?: string;
}

export interface PaymentRecord {
  id: string;
  playerId: string;
  amount: number;
  type: "initial-entry" | "buyback";
  week: number;
  createdAt: string;
}

export interface Player {
  id: string;
  name: string;
  email: string;
  role: PlayerRole;
  status: PlayerStatus;
  picks: SurvivorPick[];
  buybacks: number;
  joinedAt: string;
  eliminatedWeek?: number;
}

export interface LeagueSettings {
  leagueName: string;
  currentWeek: number;
  entryFee: number;
  buybackFee: number;
  buybackThroughWeek: number;
}

export interface SurvivorState {
  settings: LeagueSettings;
  players: Player[];
  payments: PaymentRecord[];
  selectedPlayerId: string;
  closedWeeks: number[];
  lastResultSyncAt?: string;
}
