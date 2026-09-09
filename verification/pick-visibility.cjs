// Run: node verification/pick-visibility.cjs (uses existing project dependencies).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
async function main() {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.resolve(__dirname, '..'), configLoader: 'runner', cacheDir: path.join(__dirname, '.vite-cache'), server: { middlewareMode: true } });
  try {
  const { weekPicksAreVisible } = await server.ssrLoadModule('/src/services/pickVisibility.ts');
  const { isGameLocked } = await server.ssrLoadModule('/src/data/nfl.ts');
  const { BoardPage } = await server.ssrLoadModule('/src/components/BoardPage.tsx');
const kickoff = Date.parse('2026-09-10T00:20:00Z');
const game = (week, time, extra = {}) => ({ id: `${week}-${time}`, week, awayTeamId: 'DAL', homeTeamId: 'PHI', kickoff: new Date(time).toISOString(), status: 'scheduled', ...extra });
const games = [game(2, kickoff + 3 * 86400000), game(2, kickoff), game(1, kickoff - 7 * 86400000), game(3, kickoff + 7 * 86400000)];
assert.equal(weekPicksAreVisible(2, games, kickoff - 1), false);
assert.equal(weekPicksAreVisible(2, games, kickoff), true);
assert.equal(weekPicksAreVisible(2, games, kickoff + 1), true);
assert.equal(weekPicksAreVisible(3, games, kickoff), false);
assert.equal(weekPicksAreVisible(2, [], kickoff), false);
assert.equal(weekPicksAreVisible(2, [game(2, kickoff, { kickoff: 'invalid' })], kickoff), false);
assert.equal(weekPicksAreVisible(2, games, NaN), false);
for (const status of ['canceled', 'postponed']) {
  assert.equal(weekPicksAreVisible(2, [game(2, kickoff - 86400000, { status }), game(2, kickoff + 86400000)], kickoff), false);
  assert.equal(weekPicksAreVisible(2, [game(2, kickoff - 86400000, { status })], kickoff), false);
}
// First kickoff reveals the whole week, without locking a later game's pick.
assert.equal(isGameLocked(games[0], kickoff), false);
assert.equal(isGameLocked(games[1], kickoff), true);
const pick = (week, teamId) => ({ week, teamId, gameId: String(week), result: 'pending', submittedAt: new Date(kickoff - 86400000).toISOString() });
const player = (id, picks, role = 'player') => ({ id, name: id, email: '', role, status: 'active', picks, buybacks: 0, joinedAt: '' });
const state = {
  settings: { leagueName: 'Fixture', season: 2026, currentWeek: 2, entryFee: 20, buybackFee: 20, buybackThroughWeek: 5 },
  players: [player('Commissioner', [pick(1, 'BUF'), pick(2, 'LAC'), pick(3, 'KC')], 'primary-commissioner'), player('Player', [pick(2, 'DET')]), player('Empty', [])],
  payments: [], selectedPlayerId: 'Commissioner', closedWeeks: [1], nflGames: games,
};
const before = JSON.stringify(state);
const originalNow = Date.now;
try {
  for (const showPayments of [false, true]) {
    Date.now = () => kickoff - 1;
    const hidden = renderToStaticMarkup(React.createElement(BoardPage, { state, showPayments }));
    assert.equal((hidden.match(/Hidden until kickoff/g) || []).length, 3);
    for (const team of ['LAC', 'DET', 'KC']) assert.ok(!hidden.includes(team));
    assert.ok(hidden.includes('BUF'));
    assert.ok(!hidden.includes('No pick'));
    Date.now = () => kickoff;
    const revealed = renderToStaticMarkup(React.createElement(BoardPage, { state, showPayments }));
    assert.ok(revealed.includes('LAC - pending'));
    assert.ok(revealed.includes('DET - pending'));
    assert.ok(revealed.includes('No pick'));
    assert.ok(!revealed.includes('KC'));
    assert.ok(!revealed.includes('Hidden until kickoff'));
  }
} finally { Date.now = originalNow; }
assert.equal(JSON.stringify(state), before, 'Rendering must never modify saved picks');
console.log('PASS: kickoff boundaries, schedule failures, canceled/postponed games, weekly isolation, commissioner/player displays, Used masking, no-pick masking, individual locks, and unchanged input picks.');

  } finally { await server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
