// Real 6v6: twelve WebSockets, 480 ships, normal 20 Hz clock, competing
// reconnects mid-battle. Metrics are observations, not CI speed guarantees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { startServer } from '../../server/index.js';
import { createTestClient } from './helpers.js';

test('6v6 with 12 commanders: identical authority, 480 ships, single-winner reconnect', { timeout: 75_000 }, async (t) => {
  const warnings = [];
  const server = await startServer({ port: 0, maxTicks: 600, countdownMs: 50, log: { warn: (...x) => warnings.push(x) } });
  const clients = [];
  const lag = monitorEventLoopDelay({ resolution: 10 });
  t.after(async () => {
    lag.disable();
    await Promise.all(clients.map((c) => c.close()));
    await server.close();
  });
  const url = `ws://127.0.0.1:${server.port}/`;
  async function connect(name, token) {
    const c = createTestClient(url, name);
    clients.push(c);
    await c.open;
    const hello = await c.hello(token ? { token } : {});
    assert.equal(hello.t, 'welcome');
    c.playerId = hello.playerId;
    c.token = hello.token;
    return c;
  }
  const commanders = await Promise.all(Array.from({ length: 12 }, (_, i) => connect(`Commander ${i + 1}`)));
  const host = commanders[0];
  const { room: created } = await host.request({ t: 'create_room', teamSize: 6, budget: 2500 });
  for (const c of commanders.slice(1)) await c.request({ t: 'join_room', code: created.code });
  const room = server.lobby.rooms.get(created.code);
  assert.deepEqual(room.toState(host.playerId).slots.map((row) => row.filter((s) => s.kind === 'human').length), [6, 6]);
  const fleet = { faction: 'terran', ships: [{ cls: 'ter_falcao', count: 24 }, { cls: 'ter_vespa', count: 16 }] };
  await Promise.all(commanders.map(async (c) => {
    await c.request({ t: 'set_fleet', fleet });
    await c.request({ t: 'ready', ready: true });
  }));
  const started = performance.now();
  const cpu = process.cpuUsage();
  lag.enable();
  await host.request({ t: 'start' });
  const starts = await Promise.all(commanders.map((c) => c.waitFor((m) => m.t === 'battle_start')));
  assert.equal(starts[0].players.length, 12);
  assert.equal(starts[0].players.filter((p) => p.isBot).length, 0);
  assert.equal(starts[0].ships.length, 480);
  for (const start of starts) assert.deepEqual(start, starts[0]);

  await host.waitFor((m) => m.t === 'f' && m.k >= 60);
  const victim = commanders[5];
  await victim.close();
  const attempts = await Promise.all([connect('Resume A', victim.token), connect('Resume B', victim.token)]);
  const resumed = attempts.filter((c) => c.playerId === victim.playerId);
  assert.equal(resumed.length, 1, 'old bearer token can resume the commander only once');
  assert.notEqual(resumed[0].token, victim.token);
  await attempts.find((c) => c !== resumed[0]).close();
  const sync = await resumed[0].waitFor((m) => m.t === 'battle_start');
  assert.ok(Array.isArray(sync.dead));
  const syncFrame = await resumed[0].waitFor((m) => m.t === 'f');
  assert.ok(syncFrame.k >= 60);
  commanders[5] = resumed[0];

  const results = await Promise.all(commanders.map((c) => c.waitFor((m) => m.t === 'battle_end', 65_000)));
  for (const end of results) assert.deepEqual(end.result, results[0].result);
  assert.equal(Object.keys(results[0].result.players).length, 12);
  const reference = host.all('f');
  for (const c of commanders) {
    const frames = c.all('f').filter((f) => f.k > syncFrame.k);
    assert.deepEqual(frames, reference.filter((f) => f.k > syncFrame.k), 'all active clients receive identical ordered snapshots');
  }
  const match = room._debug.getMatch();
  assert.equal(match.runner.stats.errors, 0);
  assert.equal(warnings.length, 0);
  assert.equal(reference.at(-1).k, results[0].result.ticks);
  const elapsedMs = Math.round(performance.now() - started);
  const usedCpu = process.cpuUsage(cpu);
  t.diagnostic(JSON.stringify({ clients: 12, ships: 480, tickMs: 50, elapsedMs,
    ticks: results[0].result.ticks, frames: reference.length,
    payloadBytesPerUninterruptedClient: reference.reduce((n, f) => n + Buffer.byteLength(JSON.stringify(f)), 0),
    cpuMs: Math.round((usedCpu.user + usedCpu.system) / 1000),
    eventLoopP99Ms: Math.round(lag.percentile(99) / 1e6),
    runner: match.runner.stats,
  }));
});
