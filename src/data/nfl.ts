import type { Game, Team } from "../types/survivor";

export const nflTeams: Team[] = [
  { id: "ARI", city: "Arizona", name: "Cardinals", abbreviation: "ARI" },
  { id: "ATL", city: "Atlanta", name: "Falcons", abbreviation: "ATL" },
  { id: "BAL", city: "Baltimore", name: "Ravens", abbreviation: "BAL" },
  { id: "BUF", city: "Buffalo", name: "Bills", abbreviation: "BUF" },
  { id: "CAR", city: "Carolina", name: "Panthers", abbreviation: "CAR" },
  { id: "CHI", city: "Chicago", name: "Bears", abbreviation: "CHI" },
  { id: "CIN", city: "Cincinnati", name: "Bengals", abbreviation: "CIN" },
  { id: "CLE", city: "Cleveland", name: "Browns", abbreviation: "CLE" },
  { id: "DAL", city: "Dallas", name: "Cowboys", abbreviation: "DAL" },
  { id: "DEN", city: "Denver", name: "Broncos", abbreviation: "DEN" },
  { id: "DET", city: "Detroit", name: "Lions", abbreviation: "DET" },
  { id: "GB", city: "Green Bay", name: "Packers", abbreviation: "GB" },
  { id: "HOU", city: "Houston", name: "Texans", abbreviation: "HOU" },
  { id: "IND", city: "Indianapolis", name: "Colts", abbreviation: "IND" },
  { id: "JAX", city: "Jacksonville", name: "Jaguars", abbreviation: "JAX" },
  { id: "KC", city: "Kansas City", name: "Chiefs", abbreviation: "KC" },
  { id: "LV", city: "Las Vegas", name: "Raiders", abbreviation: "LV" },
  { id: "LAC", city: "Los Angeles", name: "Chargers", abbreviation: "LAC" },
  { id: "LAR", city: "Los Angeles", name: "Rams", abbreviation: "LAR" },
  { id: "MIA", city: "Miami", name: "Dolphins", abbreviation: "MIA" },
  { id: "MIN", city: "Minnesota", name: "Vikings", abbreviation: "MIN" },
  { id: "NE", city: "New England", name: "Patriots", abbreviation: "NE" },
  { id: "NO", city: "New Orleans", name: "Saints", abbreviation: "NO" },
  { id: "NYG", city: "New York", name: "Giants", abbreviation: "NYG" },
  { id: "NYJ", city: "New York", name: "Jets", abbreviation: "NYJ" },
  { id: "PHI", city: "Philadelphia", name: "Eagles", abbreviation: "PHI" },
  { id: "PIT", city: "Pittsburgh", name: "Steelers", abbreviation: "PIT" },
  { id: "SF", city: "San Francisco", name: "49ers", abbreviation: "SF" },
  { id: "SEA", city: "Seattle", name: "Seahawks", abbreviation: "SEA" },
  { id: "TB", city: "Tampa Bay", name: "Buccaneers", abbreviation: "TB" },
  { id: "TEN", city: "Tennessee", name: "Titans", abbreviation: "TEN" },
  { id: "WAS", city: "Washington", name: "Commanders", abbreviation: "WAS" },
];

const pairings: Array<[string, string]> = [
  ["DAL", "PHI"], ["KC", "LAC"], ["TB", "ATL"], ["CIN", "CLE"],
  ["MIA", "IND"], ["CAR", "JAX"], ["LV", "NE"], ["ARI", "NO"],
  ["PIT", "NYJ"], ["NYG", "WAS"], ["TEN", "DEN"], ["SF", "SEA"],
  ["DET", "GB"], ["HOU", "LAR"], ["BAL", "BUF"], ["MIN", "CHI"],
];

export function getGamesForWeek(week: number): Game[] {
  return pairings.map(([awayTeamId, homeTeamId], index) => ({
    id: `W${week}-G${index + 1}`,
    week,
    awayTeamId,
    homeTeamId,
    kickoff: new Date(2026, 8, 10 + (week - 1) * 7 + Math.floor(index / 4), 13 + (index % 3) * 3).toISOString(),
  }));
}

export function getTeam(teamId: string): Team {
  const team = nflTeams.find((item) => item.id === teamId);
  if (!team) throw new Error(`Unknown NFL team: ${teamId}`);
  return team;
}
