const { PGlite } = require(process.env.SURVIVOR_PGLITE_MODULE || '@electric-sql/pglite');
const fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const db = new PGlite();
  await db.exec('create table public.league_snapshots(id integer primary key, state jsonb);');
  await db.exec(fs.readFileSync('supabase/migrations/202610110001_buyback_elimination_week.sql', 'utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/202610130001_repeat_buybacks.sql', 'utf8'));
  async function attempt(week, buybacks = 0, clear = false, amount = 20, increment = 1, removePayment = false) {
    const old = {settings: {currentWeek: 6, buybackThroughWeek: 5, buybackFee: 20}, players: [{id: 'p', status: 'eliminated', eliminatedWeek: week, buybacks, picks: [{week, teamId: 'BUF', result: 'loss'}]}], payments: []};
    old.payments = [{id: 'entry', playerId: 'p', type: 'initial-entry', week: 1, amount: 20}, ...Array.from({length: buybacks}, (_, i) => ({id: 'b' + i, playerId: 'p', type: 'buyback', week: i + 2, amount: 20}))];
    await db.query('delete from league_snapshots where id=1');
    await db.query('insert into league_snapshots values(1,$1)', [old]);
    const next = structuredClone(old);
    Object.assign(next.players[0], {status: 'active', buybacks: buybacks + increment, restoredThroughWeek: week});
    delete next.players[0].eliminatedWeek;
    if (clear) next.players[0].picks = [];
    next.payments = [...(removePayment ? [] : old.payments), {id: 'new', playerId: 'p', type: 'buyback', week: 6, amount}];
    await db.query('update league_snapshots set state=$1 where id=1', [next]);
    assert.deepEqual((await db.query('select state from league_snapshots where id=1')).rows[0].state.players[0].picks, old.players[0].picks);
    assert.deepEqual(next.payments.slice(0, -1), old.payments);
  }
  for (let week = 1; week <= 5; week++) await attempt(week);
  await assert.rejects(attempt(6), /A buyback/);
  await attempt(5, 1);
  await attempt(5, 2);
  await attempt(5, 4);
  await assert.rejects(attempt(5, 2, false, 20, 1, true), /preserve existing payments/);
  await assert.rejects(attempt(5, 2, false, 20, 2), /A buyback/);
  await assert.rejects(attempt(5, 0, true), /preserve all picks/);
  await assert.rejects(attempt(5, 0, false, 0), /requires a payment/);
  console.log('PASS database buyback eligibility, repeat purchases, single increment, fee, and preserved history');
  await db.close();
})().catch(error => { console.error(error); process.exit(1); });
