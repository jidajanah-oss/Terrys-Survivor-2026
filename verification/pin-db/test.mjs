import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

process.on('uncaughtException', error => { console.error(error.message, error.where ?? ''); process.exit(1); });

// Real PostgreSQL/pgcrypto, isolated in memory; no production credentials/network.
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema extensions;
  create extension pgcrypto with schema extensions;
  create table auth.users(id uuid primary key, email text unique, role text default 'authenticated',
    banned_until timestamptz, raw_user_meta_data jsonb default '{}');
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
  grant usage on schema auth to authenticated, service_role;
`);
const migrations = new URL('../../supabase/migrations/', import.meta.url);
for (const file of (await readdir(migrations)).filter(f => f.endsWith('.sql')).sort()) {
  await db.exec((await readFile(new URL(file, migrations), 'utf8')).replace(/^\uFEFF/, ''));
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const league = id(1), otherLeague = id(2), terry = id(10), jimbo = id(11), player = id(12), other = id(13), fresh = id(14);
const member = id(22), sibling = id(23), unlinked = id(24), primary = id(20), co = id(21), outsider = id(25);
const material = pin => createHmac('sha256', 'test-only-pepper').update(`survivor-pin-v1|${league}|${pin}`).digest('hex');
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
const configure = (target = member, owner = player, actor = terry, pin = '0042') =>
  q('select public.survivor_pin_configure($1,$2,$3,$4,$5)', [actor, league, target, owner, material(pin)]);
const verify = (name = 'Player One', pin = '0042') => scalar('select public.survivor_pin_verify($1,$2,$3)', [league, name, material(pin)]);
const disable = (target = member, actor = terry) => q('select public.survivor_pin_disable($1,$2,$3)', [actor, league, target]);
const credential = () => scalar('select row_to_json(c) from public.survivor_pin_credentials c where member_id=$1', [member]);
const claims = async (uid, email = 'player@example.test') => q("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: uid, email, role: 'authenticated' })]);
let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS ${name}`); }

await db.query(`insert into auth.users(id,email) values ($1,'terry@example.test'),($2,'jimbo@example.test'),
  ($3,'player@example.test'),($4,'other@example.test'),($5,'fresh@example.test')`, [terry,jimbo,player,other,fresh]);
await db.query(`insert into public.leagues(id,name,season) values ($1,'Survivor',2026),($2,'Other',2026)`, [league,otherLeague]);
await db.query(`insert into public.league_members(id,league_id,user_id,display_name,email,role,status,buybacks) values
  ($1,$7,$8,'Terry','terry@example.test','primary-commissioner','active',0),
  ($2,$7,$9,'Jimbo','jimbo@example.test','co-commissioner','active',0),
  ($3,$7,$10,'Player One','player@example.test','player','eliminated',1),
  ($4,$7,$10,'Player Two','player@example.test','player','active',0),
  ($5,$7,null,'Fresh Entry','fresh@example.test','player','active',0),
  ($6,$7,$11,'Other Player','other@example.test','player','active',0)`,
  [primary,co,member,sibling,unlinked,outsider,league,terry,jimbo,player,other]);
const snapshot = { settings: { currentWeek: 2 }, players: [
  { id: 'p1', name: 'Player One', email: 'player@example.test', role: 'player', status: 'eliminated', buybacks: 1,
    picks: [{ week: 1, teamId: 'BUF', result: 'loss' }] },
  { id: 'p2', name: 'Player Two', email: 'player@example.test', role: 'player', status: 'active', buybacks: 0, picks: [] },
  { id: 'p3', name: 'Other Player', email: 'other@example.test', role: 'player', status: 'active', buybacks: 0, picks: [] },
], payments: [{ playerId: 'p1', type: 'buyback', week: 1, amount: 20 }], closedWeeks: [1] };
await db.query('insert into public.league_snapshots(league_id,state) values($1,$2)', [league,JSON.stringify(snapshot)]);
await db.query(`insert into public.nfl_games(id,season,week,away_team_id,home_team_id,kickoff) values ('g',2026,1,'BUF','MIA',now())`);
await db.query(`insert into public.survivor_picks(league_id,member_id,week,game_id,team_id,result) values ($1,$2,1,'g','BUF','loss')`, [league,member]);
await db.query(`insert into public.payments(league_id,member_id,amount_cents,type,week) values ($1,$2,2000,'buyback',1)`, [league,member]);
const preserved = async () => {
  const rows = {};
  for (const table of ['league_members','survivor_picks','payments','league_snapshots']) rows[table] = await q(`select * from public.${table} order by 1`);
  return rows;
};
const before = await preserved();

await check('migration applies with pgcrypto installed in Supabase extensions schema', async () => {
  assert.equal(await scalar("select count(*)::int from pg_proc where proname like 'survivor_pin_%'"), 7);
});
await check('Terry can configure eliminated entry without changing history or identity', async () => {
  await configure(); assert.deepEqual(await preserved(), before);
});
await check('salted bcrypt never stores plaintext or reusable HMAC material', async () => {
  const first = (await credential()).pin_hash;
  assert.match(first, /^\$2[abxy]\$10\$/); assert.notEqual(first, material('0042'));
  await configure(); assert.notEqual((await credential()).pin_hash, first);
});
await check('leading-zero PIN resolves the exact existing owner and member', async () => {
  const result = await verify('  PLAYER ONE ');
  assert.equal(result.memberId, member); assert.equal(result.authUserId, player);
});
await check('parallel queued wrong guesses commit exactly five failures and hard lock', async () => {
  await Promise.all(Array.from({ length: 10 }, () => verify('Player One', '9999')));
  assert.equal((await credential()).failed_attempts, 5);
  assert.equal(await verify(), null);
});
await check('Jimbo reset clears lock and invalidates old PIN', async () => {
  await configure(member,player,jimbo,'0088');
  assert.equal((await credential()).failed_attempts, 0);
  assert.equal(await verify(), null);
  assert.equal((await verify('Player One','0088')).authUserId, player);
});
await check('disable rejects login and in-flight session finalization; email linkage unchanged', async () => {
  const grant = await verify('Player One','0088'); await disable();
  assert.equal(await verify('Player One','0088'), null);
  assert.equal(await scalar('select public.survivor_pin_finish($1,$2,$3)', [member,player,grant.version]), false);
  assert.deepEqual(await preserved(), before);
});
await check('reset invalidates prior version even with the same PIN', async () => {
  await configure(); const grant = await verify(); await configure();
  assert.equal(await scalar('select public.survivor_pin_finish($1,$2,$3)', [member,player,grant.version]), false);
});
await check('ordinary player cannot configure or disable another PIN', async () => {
  await assert.rejects(configure(member,player,other), /Commissioner/);
  await assert.rejects(disable(member,other), /Commissioner/);
});
await check('commissioner direct account and normal sibling of commissioner are rejected', async () => {
  await assert.rejects(configure(primary,terry), /commissioner/i);
  const shared = id(30);
  await db.query(`insert into public.league_members(id,league_id,user_id,display_name,email) values ($1,$2,$3,'Terry Extra','terry@example.test')`, [shared,league,terry]);
  await assert.rejects(configure(shared,terry), /email sign-in/);
  await db.query('delete from public.league_members where id=$1', [shared]);
});
await check('unclaimed commissioner entry sharing email also blocks PIN', async () => {
  const reserved = id(31);
  await db.query(`insert into public.league_members(id,league_id,display_name,email,role) values ($1,$2,'Reserved Commissioner','player@example.test','primary-commissioner')`, [reserved,otherLeague]);
  assert.equal(await verify(), null);
  await assert.rejects(configure(), /email sign-in/);
  await db.query('delete from public.league_members where id=$1', [reserved]);
});
await check('role change after PIN validation blocks finalization', async () => {
  const grant = await verify();
  await db.query(`insert into public.league_members(id,league_id,user_id,display_name,email,role) values ($1,$2,$3,'Promoted','player@example.test','primary-commissioner')`, [id(32),otherLeague,player]);
  assert.equal(await scalar('select public.survivor_pin_finish($1,$2,$3)', [member,player,grant.version]), false);
  await db.query('delete from public.league_members where id=$1', [id(32)]);
});
await check('changed account owner or auth email cannot reuse PIN', async () => {
  await db.query('update public.league_members set user_id=$1 where id=$2', [other,member]);
  assert.equal(await verify(), null); await assert.rejects(configure(), /linkage/);
  await db.query('update public.league_members set user_id=$1 where id=$2', [player,member]);
  await db.query("update auth.users set email='changed@example.test' where id=$1", [player]);
  assert.equal(await verify(), null);
  await db.query("update auth.users set email='player@example.test' where id=$1", [player]);
});
await check('unlinked existing entry acquires only its missing Auth link', async () => {
  const prior = await scalar('select row_to_json(m) from public.league_members m where id=$1', [unlinked]);
  await configure(unlinked,fresh);
  assert.deepEqual(await scalar('select row_to_json(m) from public.league_members m where id=$1', [unlinked]), { ...prior, user_id: fresh });
  assert.equal(await scalar('select count(*)::int from public.league_members'), 6);
});
await check('multi-entry memberships and non-commissioner RLS identity preserved', async () => {
  await claims(player);
  await db.exec('set role authenticated');
  try {
    const memberships = await scalar('select public.get_my_survivor_memberships()');
    assert.deepEqual(memberships.map(m => m.memberId).sort(), [member,sibling].sort());
    assert.equal(await scalar('select public.is_commissioner($1)', [league]), false);
    assert.equal(await scalar('select count(*)::int from public.league_snapshots where league_id=$1', [league]), 1);
    await assert.rejects(q('select * from public.survivor_pin_credentials'), /permission denied/);
    await assert.rejects(q('select public.survivor_pin_verify($1,$2,$3)', [league,'Player One',material('0042')]), /permission denied/);
    await assert.rejects(q('select public.survivor_pin_configure($1,$2,$3,$4,$5)', [terry,league,member,player,material('0042')]), /permission denied/);
  } finally { await db.exec('reset role'); }
});
await check('anonymous clients cannot read credentials or invoke privileged RPCs', async () => {
  await db.exec('set role anon');
  try {
    await assert.rejects(q('select * from public.survivor_pin_credentials'), /permission denied/);
    await assert.rejects(q('select public.survivor_pin_take_attempt()'), /permission denied/);
  } finally { await db.exec('reset role'); }
});
await check('same account can save a pick for its second entry', async () => {
  await claims(player); await db.exec('set role authenticated');
  try {
    const next = structuredClone(snapshot);
    next.players[1].picks = [{ week: 2, teamId: 'SEA', result: 'pending' }];
    await q('select public.save_survivor_snapshot($1,$2)', [league, JSON.stringify(next)]);
    const saved = await scalar('select state from public.league_snapshots where league_id=$1', [league]);
    assert.deepEqual(saved, next);
  } finally { await db.exec('reset role'); }
});
await check('multi-entry writer rejects changes to another player, roles, payments, identities and settled history', async () => {
  const baseline = await scalar('select state from public.league_snapshots where league_id=$1', [league]);
  const mutations = [
    s => { s.players[2].picks = [{ week: 2, teamId: 'KC', result: 'pending' }]; },
    s => { s.players[1].role = 'primary-commissioner'; },
    s => { s.players[1].name = 'Other Player'; },
    s => { s.players[1].id = s.players[0].id; },
    s => { s.players.push({ ...s.players[1], id: 'extra' }); },
    s => { s.players.pop(); },
    s => { s.payments = []; },
    s => { s.players[0].picks = []; },
    s => { s.players[1].picks[0].result = 'win'; },
    s => { s.players[1].picks.push({ week: 3, teamId: 'SEA', result: 'pending' }); },
  ];
  await claims(player); await db.exec('set role authenticated');
  try {
    for (const mutate of mutations) {
      const next = structuredClone(baseline); mutate(next);
      await assert.rejects(q('select public.save_survivor_snapshot($1,$2)', [league,JSON.stringify(next)]));
    }
    assert.deepEqual(await scalar('select state from public.league_snapshots where league_id=$1', [league]), baseline);
  } finally { await db.exec('reset role'); }
});
await check('commissioner snapshot writes retain their normal permission', async () => {
  await claims(jimbo,'jimbo@example.test'); await db.exec('set role authenticated');
  try { await q('select public.save_survivor_snapshot($1,$2)', [league,JSON.stringify(snapshot)]); }
  finally { await db.exec('reset role'); }
});
await check('global limit covers unknown names and rolls over without growing tables', async () => {
  await db.exec('update public.survivor_pin_rate_limit set window_start=now(), attempts=0');
  for (let i=0;i<60;i++) assert.equal(await verify('Unknown Entry'), null);
  assert.deepEqual(await verify('Unknown Entry'), { limited: true });
  await db.exec("update public.survivor_pin_rate_limit set window_start=now()-interval '2 minutes'");
  assert.equal(await verify('Unknown Entry'), null);
  assert.equal(await scalar('select count(*)::int from public.survivor_pin_rate_limit'), 1);
});
await check('audit contains actions only, no PINs, hashes or tokens', async () => {
  const audit = await q("select * from public.audit_log where action like '%survivor_pin'");
  assert(audit.length > 0);
  for (const row of audit) assert.deepEqual(row.details, {});
  assert(!JSON.stringify(audit).includes(material('0042')));
});

console.log(`${checks} PostgreSQL security checks passed.`);
await db.close();
