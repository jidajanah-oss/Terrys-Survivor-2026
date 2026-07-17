import type { SurvivorState } from "../types/survivor";

const createdAt = new Date().toISOString();

export const initialState: SurvivorState = {
  settings: {
    leagueName: "Terry's Survivor 2026",
    season: 2026,
    currentWeek: 1,
    entryFee: 20,
    buybackFee: 20,
    buybackThroughWeek: 5,
  },
  players: [
    {
      id: "player-jimbo",
      name: "Jimbo",
      email: "",
      role: "co-commissioner",
      status: "active",
      picks: [],
      buybacks: 0,
      joinedAt: createdAt,
    },
    {
      id: "player-terry",
      name: "Terry",
      email: "",
      role: "primary-commissioner",
      status: "active",
      picks: [],
      buybacks: 0,
      joinedAt: createdAt,
    },
    {
      id: "player-russ",
      name: "Russ",
      email: "",
      role: "player",
      status: "active",
      picks: [],
      buybacks: 0,
      joinedAt: createdAt,
    },
  ],
  payments: [
    { id: "pay-jimbo", playerId: "player-jimbo", amount: 20, type: "initial-entry", week: 1, createdAt },
    { id: "pay-terry", playerId: "player-terry", amount: 20, type: "initial-entry", week: 1, createdAt },
    { id: "pay-russ", playerId: "player-russ", amount: 20, type: "initial-entry", week: 1, createdAt },
  ],
  selectedPlayerId: "player-terry",
  closedWeeks: [],
  nflGames: [],
};
