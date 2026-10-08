import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { register } from 'node:module';
register('./_sharedHook.mjs', import.meta.url);
const { createLocalRunner, buildStartInfo } = await import('../../client/battle/localRunner.js');
const { createBattle, stepBattle, makeSnapshot, hashState } = await import('../../shared/sim/battle.js');
const { applyPilotInput } = await import('../../shared/pilot.js');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function config(maxTicks = 40) {
  return {
    seed: 'runner-test',
    maxTicks,
    players: [
      { id: 'p1', name: 'Ana', team: 0, isBot: false, fleet: { faction: 'terran', ships: [{ cls: 'ter_falcao', count: 2 }] } },
      { id: 'bot_e1', name: 'Rex', team: 1, isBot: true, ai: 'normal', fleet: { faction: 'vorrax', ships: [{ cls: 'vor_zangao', count: 2 }] } },
    ],
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('buildStartInfo', () => {
  test('matches the BattleStartInfo contract', () => {
    const c = config();
    const info = buildStartInfo(c, createBattle(c));
    assert.equal(info.seed, 'runner-test');
    assert.equal(info.players.length, 2);
    assert.equal(info.players[0].faction, 'terran');
    assert.equal(info.players[0].ai, 'especialista', 'humans default to especialista');
    assert.equal(info.players[1].ai, 'normal');
    assert.equal(info.ships.length, 4);
    assert.ok(info.ships.every((s) => Number.isInteger(s.id) && typeof s.cls === 'string' && (s.team === 0 || s.team === 1)));
    assert.deepEqual(Object.keys(info.world), ['w', 'h']);
    assert.equal(info.tickRate, 20);
    assert.equal(info.snapshotEvery, 2);
    assert.equal(info.isLocal, true);
  });
});

describe('createLocalRunner (main-thread mode)', () => {
  test('throws synchronously on an invalid config', () => {
    assert.throws(() => createLocalRunner({ seed: 1, players: [] }, { useWorker: false, doc: null }));
  });

  test('emits start immediately, server-shaped frames with `at`, and the result', async () => {
    const feed = createLocalRunner(config(40), { useWorker: false, speed: 4, doc: null });
    try {
      assert.equal(feed.isLocal, true);
      assert.equal(feed.controls.isLocal, true);
      assert.equal(feed.controls.mode, 'main');
      assert.equal(feed.controls.speed, 4);
      let start = null;
      feed.onStart((i) => { start = i; });
      assert.ok(start, 'start replayed to a subscriber registered after creation');
      const frames = [];
      feed.onFrame((f) => frames.push(f));
      const end = await new Promise((res, rej) => { feed.onEnd(res); setTimeout(() => rej(new Error('no end')), 8000); });
      assert.equal(end.reason, 'timeout');
      assert.equal(end.ticks, 40);
      assert.ok(frames.length >= 20, `got ${frames.length} frames`);
      assert.equal(frames[0].k, 0);
      for (const f of frames) {
        assert.deepEqual(Object.keys(f).sort(), ['at', 'e', 'k', 's']);
        assert.ok(Number.isFinite(f.at));
        assert.ok(Array.isArray(f.s) && Array.isArray(f.e));
        for (const row of f.s) assert.equal(row.length, 7);
      }
      for (let i = 1; i < frames.length; i++) assert.ok(frames[i].k > frames[i - 1].k, 'frames strictly increasing');
      assert.equal(frames[frames.length - 1].k, 40);
      assert.deepEqual(frames[frames.length - 1].e[frames[frames.length - 1].e.length - 1].slice(0, 1), ['end']);
    } finally { feed.dispose(); }
  });

  test('speed 0 pauses and setSpeed resumes; dispose stops everything', async () => {
    const feed = createLocalRunner(config(2000), { useWorker: false, speed: 0, doc: null });
    const frames = [];
    feed.onFrame((f) => frames.push(f));
    await wait(120);
    assert.equal(frames.length, 1, 'paused: only the k=0 frame (ships visible while the clock is stopped)');
    assert.equal(frames[0].k, 0);
    feed.controls.setSpeed(4);
    await wait(250);
    assert.ok(frames.length >= 3, `frames while running: ${frames.length}`);
    feed.controls.setSpeed(0);
    const n = frames.length;
    await wait(150);
    assert.ok(frames.length - n <= 1, 'no frames while paused');
    feed.controls.setSpeed(2);
    await wait(150);
    assert.ok(frames.length > n);
    feed.dispose();
    const m = frames.length;
    await wait(150);
    assert.equal(frames.length, m, 'no frames after dispose');
  });

  test('determinism: two runners with the same config produce identical frames', async () => {
    const run = () => new Promise((res) => {
      const feed = createLocalRunner(config(30), { useWorker: false, speed: 4, doc: null });
      const frames = [];
      feed.onFrame((f) => frames.push({ k: f.k, s: f.s, e: f.e }));
      feed.onEnd(() => { feed.dispose(); res(frames); });
    });
    const [a, b] = await Promise.all([run(), run()]);
    assert.deepEqual(a, b);
  });
});

describe('simWorker.js', () => {
  test('parses as an ES module (it cannot be imported in Node: it uses self)', () => {
    const r = spawnSync(process.execPath, ['--check', resolve(ROOT, 'client/battle/simWorker.js')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
});

test('worker failure reconstructs accepted pilot inputs instead of replacing manual play with AI', () => {
  const previous = globalThis.Worker;
  let worker;
  class FakeWorker {
    constructor() { worker = this; }
    postMessage(m) {
      if (m.t === 'init') {
        this.state = createBattle(m.config);
        this.onmessage?.({ data: { t: 'start' } });
      } else if (m.t === 'pilot') {
        const applied = applyPilotInput(this.state, m.ownerId, m.input);
        if (applied.ok) this.onmessage?.({ data: { t: 'pilot_applied', tick: this.state.tick, ownerId: m.ownerId, input: m.input } });
      }
    }
    advance(n) {
      for (let i = 0; i < n; i++) {
        const e = stepBattle(this.state);
        if (this.state.tick % 2 === 0) this.onmessage?.({ data: { t: 'frame', ...makeSnapshot(this.state), e } });
      }
    }
    terminate() {}
  }
  globalThis.Worker = FakeWorker;
  const c = config(2000); c.players[0].pilot = true;
  let feed;
  try {
    feed = createLocalRunner(c, { useWorker: true, speed: 1, doc: null });
    const a = { manual: true, moveX: 1, moveY: 0, aimX: 1800, aimY: 800, fire: true, ability: false };
    const b = { ...a, moveX: 0, moveY: -1, fire: false };
    feed.controls.pilot(a); worker.advance(10); feed.controls.pilot(b);
    const expected = hashState(worker.state);
    worker.onerror({ message: 'intentional regression-test crash' });
    assert.equal(feed.controls.mode, 'main');
    assert.equal(feed.state.tick, 10);
    assert.equal(hashState(feed.state), expected);
    assert.equal(feed.state.pilots.p1.manual, true);
    const journal = feed.controls.getPilotReplay();
    assert.deepEqual(journal.map((x) => [x.tick, x.ownerId, x.input.seq]), [[0, 'p1', 0], [10, 'p1', 1]]);
    journal[0].input.moveX = -1;
    assert.equal(feed.controls.getPilotReplay()[0].input.moveX, 1, 'callers cannot mutate replay history');
    feed.controls.setSpeed(0);
    assert.equal(feed.state.pilots.p1.manual, false, 'pausing releases manual input before resuming');
  } finally { feed?.dispose(); globalThis.Worker = previous; }
});
