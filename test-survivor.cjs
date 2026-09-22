const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const compile = source => stripTypeScriptTypes(source.replace('export function reconcileEntry', 'function reconcileEntry'));
const shared = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync('supabase/functions/_shared/survivorStatus.ts', 'utf8') + '\nexports.reconcileEntry = reconcileEntry;'), shared);
const { reconcileEntry } = shared.exports;
let source = fs.readFileSync('supabase/functions/sync-nfl-week/index.ts', 'utf8');
source = source.replace(/^[\uFEFF \t]*import .*;\r?\n/gm, '').split('Deno.serve(')[0];
const context = { reconcileEntry, exports: {} };
vm.runInNewContext(compile(source + '\nexports.resolveState = resolveState;'), context);
const entry = (picks, rest = {}) => ({ id: 'entry', status: 'active', buybacks: 0, picks, ...rest });
const pick = (week, result) => ({ week, result, teamId: 'BUF', gameId: 'g' + week });
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
check('Later win cannot erase earlier loss', () => assert.equal(reconcileEntry(entry([pick(1, 'loss'), pick(2, 'win')])).eliminatedWeek, 1));
check('Stored elimination survives without pick evidence', () => assert.equal(reconcileEntry(entry([pick(2, 'win')], { status: 'eliminated', eliminatedWeek: 1 })).status, 'eliminated'));
check('No-pick and ties eliminate', () => { for (const result of ['tie', 'no-pick']) assert.equal(reconcileEntry(entry([pick(1, result)])).status, 'eliminated'); });
check('Explicit buyback preserves history and covers old loss', () => { const p = entry([pick(1, 'loss'), pick(2, 'win')], { buybacks: 1, restoredThroughWeek: 1 }); assert.equal(reconcileEntry(p).status, 'active'); assert.equal(p.picks.length, 2); });
check('Loss after buyback eliminates again', () => assert.equal(reconcileEntry(entry([pick(1, 'loss'), pick(2, 'loss')], { buybacks: 1, restoredThroughWeek: 1 })).eliminatedWeek, 2));
check('Legacy payment covers one prior elimination', () => assert.equal(reconcileEntry(entry([pick(1, 'loss')], { buybacks: 1 }), [{ playerId: 'entry', type: 'buyback', week: 2 }]).status, 'active'));
check('Legacy buyback cannot cover a later failure', () => assert.equal(reconcileEntry(entry([pick(3, 'loss')], { buybacks: 1 }), [{ playerId: 'entry', type: 'buyback', week: 2 }]).status, 'eliminated'));
check('Recorded buyback restores a stored elimination', () => {
  const player = entry([pick(2, 'loss')], { status: 'eliminated', eliminatedWeek: 2, buybacks: 1, restoredThroughWeek: 1 });
  const payment = [{ playerId: 'entry', type: 'buyback', week: 2, createdAt: '2026-09-21T00:00:00Z' }];
  assert.equal(reconcileEntry(player, payment).status, 'active');
});
check('Buyback cannot excuse a later loss in the same week', () => {
  const lostPick = { ...pick(2, 'loss'), resolvedAt: '2026-09-22T00:00:00Z' };
  const player = entry([lostPick], { buybacks: 1, restoredThroughWeek: 1 });
  const payment = [{ playerId: 'entry', type: 'buyback', week: 2, createdAt: '2026-09-21T00:00:00Z' }];
  assert.equal(reconcileEntry(player, payment).status, 'eliminated');
});
const game = (week, rest = {}) => ({ id: 'g' + week, week, awayTeamId: 'BUF', homeTeamId: 'MIA', awayScore: 7, homeScore: 14, kickoff: '2026-09-10', status: 'final', ...rest });
const sync = (player, oldGames = [], games = [game(2)]) => context.exports.resolveState({ players: [player], nflGames: oldGames, payments: [] }, games, 2026, 2);
check('Sync resolves all stored finalized weeks', () => { const r = sync(entry([pick(1, 'pending'), pick(2, 'pending')]), [game(1)], [game(2, { awayScore: 21 })]); assert.equal(r.picksResolved, 2); assert.equal(r.state.players[0].eliminatedWeek, 1); });
check('Sync repairs earlier failure without current pick', () => assert.equal(sync(entry([pick(1, 'loss')])).state.players[0].status, 'eliminated'));
check('Missing scores do not become a tie', () => assert.equal(sync(entry([pick(2, 'pending')]), [], [game(2, { awayScore: undefined })]).picksResolved, 0));
check('Commissioner result is preserved', () => assert.equal(sync(entry([pick(2, 'win')])).state.players[0].picks[0].result, 'win'));
check('Repeated sync is idempotent', () => { const r = sync(entry([pick(2, 'pending')])); const repeated = context.exports.resolveState(r.state, [game(2)], 2026, 2); assert.equal(repeated.picksResolved, 0); assert.equal(repeated.playersEliminated, 0); });
console.log(`${checks} regression checks passed.`);


