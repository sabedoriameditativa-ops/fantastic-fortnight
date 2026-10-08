// Real HTTP profile cookies and authoritative pilot commands, including a
// reconnect and durable-service reward path (in-memory SQLite test database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../server/index.js';
import { createProfileService } from '../../server/profiles.js';
import { presetFleet } from '../../shared/fleet.js';
import { createTestClient } from './helpers.js';

test('real pilot transport validates ownership, unlocks, input replay and match; profile rewards only server end', { timeout: 15_000 }, async (t) => {
  const profiles = createProfileService({ filename: ':memory:', policy: { rewardIntervalMs: 0 } });
  const warnings = [];
  const server = await startServer({ port: 0, maxTicks: 300, tickMs: 10, countdownMs: 20, profileService: profiles,
    log: { warn: (...args) => warnings.push(args) } });
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await server.close();
    profiles.close();
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const url = `ws://127.0.0.1:${server.port}`;
  async function identity() {
    const res = await fetch(`${origin}/api/profile`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 200);
    return { cookie: res.headers.get('set-cookie').split(';')[0], profile: (await res.json()).profile };
  }
  async function connect(name, id, token) {
    const c = createTestClient(url, name, { headers: { Cookie: id.cookie } });
    clients.push(c);
    await c.open;
    const hello = await c.hello(token ? { token } : {});
    c.playerId = hello.playerId; c.token = hello.token;
    return c;
  }
  const idA = await identity();
  const idB = await identity();
  const a = await connect('Ana', idA);
  const b = await connect('Bia', idB);
  const { room } = await a.request({ t: 'create_room', teamSize: 1, budget: 800, pilotsEnabled: true });
  await b.request({ t: 'join_room', code: room.code });
  const fleet = presetFleet('ter_linha', 600);
  await assert.rejects(a.request({ t: 'set_fleet', fleet }), (e) => e.code === 'CONTENT_LOCKED');
  // Test-only fixture funding uses the internal trusted service, never a
  // client result endpoint. The battle below exercises the real end hook.
  for (const id of [idA, idB]) {
    for (let i = 0; i < 3; i++) profiles.recordMatch({
      matchId: `fixture-${id.profile.id}-${i}`, mode: 'multiplayer',
      participants: [{ profileId: id.profile.id, playerId: 'fixture', team: 0 }],
      result: { winner: 0, ticks: 200, players: { fixture: { damageDealt: 100, damageTaken: 10, shipsTotal: 1, shipsAlive: 1 } } },
    });
    const unlocked = await fetch(`${origin}/api/profile/unlock`, { method: 'POST', headers: { Cookie: id.cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'special:terran' }) });
    assert.equal(unlocked.status, 200, await unlocked.text());
  }
  await a.request({ t: 'set_fleet', fleet });
  await b.request({ t: 'set_fleet', fleet });
  await a.request({ t: 'set_role', role: 'support' });
  await Promise.all([a.request({ t: 'ready', ready: true }), b.request({ t: 'ready', ready: true })]);
  await a.request({ t: 'start' });
  const start = await a.waitFor((m) => m.t === 'battle_start');
  assert.equal(start.ships.filter((s) => s.pilot).length, 2);
  const input = { seq: 1, manual: true, moveX: 1, moveY: 0, aimX: start.world.w / 2, aimY: start.world.h / 2, fire: true, ability: true };
  await assert.rejects(a.request({ t: 'pilot_input', matchId: 'old', input }), (e) => e.code === 'STALE_MATCH');
  await assert.rejects(a.request({ t: 'pilot_input', matchId: start.matchId, input: { ...input, damage: 999999 } }), (e) => e.code === 'BAD_MESSAGE');
  await a.request({ t: 'pilot_input', matchId: start.matchId, input });
  await assert.rejects(a.request({ t: 'pilot_input', matchId: start.matchId, input }), (e) => e.code === 'PILOT_STALE_INPUT');
  const frame = await a.waitFor((m) => m.t === 'f' && m.p?.some((p) => p.owner === a.playerId && p.manual));
  assert.equal(frame.p.find((p) => p.owner === b.playerId).manual, false);
  const sim = server.lobby.rooms.get(room.code)._debug.getMatch().runner.state;
  assert.equal(sim.pilots[a.playerId].lastSeq, 1);
  await a.close();
  const neutral = await b.waitFor((m) => m.t === 'f' && m.k > frame.k && m.p?.find((p) => p.owner === a.playerId)?.manual === false);
  assert.ok(neutral.k > frame.k);
  const resumed = await connect('Ana', idA, a.token);
  assert.equal(resumed.playerId, a.playerId);
  assert.notEqual(resumed.token, a.token);
  await resumed.waitFor((m) => m.t === 'battle_start' && m.matchId === start.matchId);
  await resumed.request({ t: 'pilot_input', matchId: start.matchId, input: { seq: 2, manual: false } });
  const result = await resumed.waitFor((m) => m.t === 'battle_end');
  assert.deepEqual((await b.waitFor((m) => m.t === 'battle_end')).result, result.result);
  const history = profiles.getProfile(idA.profile.id).history.filter((h) => h.matchId === start.matchId);
  assert.equal(history.length, 1);
  assert.equal(history[0].mode, 'multiplayer');
  assert.equal(history[0].ticks, result.result.ticks);
  // A reconnect to results replays the report; it cannot issue another reward.
  await resumed.close();
  const again = await connect('Ana', idA, resumed.token);
  await again.waitFor((m) => m.t === 'battle_end');
  assert.equal(profiles.getProfile(idA.profile.id).history.filter((h) => h.matchId === start.matchId).length, 1);
  assert.equal(warnings.length, 0);
});
