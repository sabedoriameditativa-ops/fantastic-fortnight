import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startMatch } from '../../server/match.js';
import { presetFleet } from '../../shared/fleet.js';
import { createBattle, hashState } from '../../shared/sim/battle.js';

function config(maxTicks = 60) {
  return {
    seed: 7,
    maxTicks,
    players: [
      { id: 'a', name: 'A', team: 0, isBot: false, fleet: presetFleet('ter_linha', 800) },
      { id: 'b', name: 'B', team: 1, isBot: true, ai: 'normal', fleet: presetFleet('vor_mare', 800) },
    ],
  };
}

/** Fake interval timers driven by hand. */
function fakeTimers() {
  let now = 0;
  const intervals = new Map();
  let seq = 0;
  return {
    now: () => now,
    setInterval(fn, ms) { const id = ++seq; intervals.set(id, { fn, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
    /** Advance the clock and run each interval callback once (like one wakeup). */
    step(ms) { now += ms; for (const it of [...intervals.values()]) it.fn(); },
    active: () => intervals.size,
  };
}

describe('match runner', () => {
  test('real timers: frames every 2 ticks, serialized once, final frame carries end, onEnd fires once', async () => {
    const frames = [];
    const strs = [];
    let ends = 0;
    let result = null;
    await new Promise((resolve) => {
      startMatch({
        config: config(60), tickMs: 2,
        onFrame: (str, frame) => { strs.push(str); frames.push(frame); },
        onEnd: (r) => { ends++; result = r; resolve(); },
      });
    });
    assert.equal(ends, 1);
    assert.equal(result.ticks, 60);
    assert.ok(['timeout', 'draw'].includes(result.reason), result.reason);
    assert.equal(frames.length, 30);
    for (let i = 0; i < frames.length; i++) {
      assert.equal(frames[i].t, 'f');
      assert.equal(frames[i].k, (i + 1) * 2);
      assert.ok(Array.isArray(frames[i].s) && Array.isArray(frames[i].e));
      assert.deepEqual(JSON.parse(strs[i]), frames[i], 'string is the serialized frame');
    }
    const lastEv = frames[frames.length - 1].e;
    assert.deepEqual(lastEv[lastEv.length - 1].slice(0, 1), ['end']);
  });

  test('fake timers: drift correction runs catch-up ticks (max 8) and drops time when hopeless', () => {
    const timers = fakeTimers();
    const ks = [];
    const run = startMatch({ config: config(1000), tickMs: 50, timers, onFrame: (s, f) => ks.push(f.k), onEnd: () => {} });
    timers.step(10);
    assert.equal(run.state.tick, 0, 'first tick is due at 50 ms');
    timers.step(40);
    assert.equal(run.state.tick, 1);
    timers.step(10);
    assert.equal(run.state.tick, 1);
    timers.step(200); // 4 ticks overdue
    assert.equal(run.state.tick, 5, 'catch-up');
    timers.step(50 * 20); // 20 ticks overdue → only 8 run, rest dropped
    assert.equal(run.state.tick, 13);
    assert.equal(run.stats.drops, 1);
    timers.step(10);
    assert.equal(run.state.tick, 13, 'after dropping, the next tick is due in a full tickMs');
    timers.step(50);
    assert.equal(run.state.tick, 14);
    assert.deepEqual(ks, [2, 4, 6, 8, 10, 12, 14]);
    assert.equal(run.running(), true);
    run.stop();
    assert.equal(run.running(), false);
    assert.equal(timers.active(), 0);
    timers.step(1000);
    assert.equal(run.state.tick, 14, 'stopped loop does not tick');
    assert.equal(JSON.parse(run.lastFrame()).k, 14);
  });

  test('accepts a pre-created state and is deterministic vs a direct run', async () => {
    const st = createBattle(config(40));
    const direct = createBattle(config(40));
    await new Promise((resolve) => startMatch({ config: config(40), state: st, tickMs: 1, onFrame() {}, onEnd: resolve }));
    const { stepBattle } = await import('../../shared/sim/battle.js');
    while (!direct.ended) stepBattle(direct);
    assert.equal(hashState(st), hashState(direct));
  });
});

describe('match runner: robustness', () => {
  /** A state whose stepBattle throws exactly once, on the third tick (an "edge case" in the sim). */
  function throwingState() {
    const st = createBattle(config(1000));
    const ships = st.ships;
    let armed = false;
    // stepBattle reads state.ships on every tick; a proxy throws one time when armed.
    st.ships = new Proxy(ships, {
      get(target, prop, recv) {
        if (armed && prop === 'length') {
          armed = false;
          throw new Error('boom');
        }
        return Reflect.get(target, prop, recv);
      },
    });
    return { st, arm: () => { armed = true; } };
  }

  test('a simulation exception ends the match as a draw via onEnd and never escapes the timer callback', () => {
    const timers = fakeTimers();
    const warns = [];
    const frames = [];
    let result = null;
    let aborted = null;
    const { st, arm } = throwingState();
    const run = startMatch({
      config: config(1000), state: st, tickMs: 10, timers, log: { warn: (...a) => warns.push(a) },
      onFrame: (s, f) => frames.push(f), onEnd: (r) => { result = r; }, onAbort: (e) => { aborted = e; },
    });
    timers.step(20);
    assert.equal(run.state.tick, 2);
    arm();
    assert.doesNotThrow(() => timers.step(10));
    assert.ok(result, 'onEnd fired');
    assert.equal(result.reason, 'draw');
    assert.equal(result.winner, -1);
    assert.equal(typeof result.ticks, 'number');
    assert.ok(result.players && typeof result.players === 'object');
    assert.ok(Array.isArray(result.remainingValue));
    assert.equal(aborted, null);
    assert.equal(run.running(), false);
    assert.equal(timers.active(), 0, 'interval cleared');
    assert.equal(run.stats.errors, 1);
    assert.ok(warns.some((w) => String(w[0]).includes('simulation error')));
    const lastEv = frames[frames.length - 1].e;
    assert.deepEqual(lastEv[lastEv.length - 1], ['end', -1, 'draw'], 'final frame carries the end event');
    assert.equal(JSON.parse(run.lastFrame()).e.at(-1)[0], 'end');
    timers.step(100);
    assert.equal(run.stats.ticks, 2, 'stopped: no further ticks');
  });

  test('when no result can be built either, the loop stops and onAbort fires once', () => {
    const timers = fakeTimers();
    const st = createBattle(config(1000));
    // Corrupt the state so that both stepBattle and buildResult throw.
    st.ships = null;
    let ends = 0;
    const aborts = [];
    const run = startMatch({
      config: config(1000), state: st, tickMs: 10, timers, log: { warn() {} },
      onFrame() {}, onEnd: () => { ends++; }, onAbort: (e) => aborts.push(e),
    });
    assert.doesNotThrow(() => timers.step(20));
    assert.equal(ends, 0);
    assert.equal(aborts.length, 1);
    assert.ok(aborts[0] instanceof Error);
    assert.equal(run.running(), false);
    assert.equal(timers.active(), 0);
    timers.step(100);
    assert.equal(aborts.length, 1);
  });

  test('pause stops ticking without ending; resume continues from the same tick; no-ops after stop', () => {
    const timers = fakeTimers();
    const run = startMatch({ config: config(1000), tickMs: 10, timers, onFrame() {}, onEnd() {} });
    timers.step(50);
    assert.equal(run.state.tick, 5);
    run.pause();
    assert.equal(run.paused(), true);
    assert.equal(run.running(), true, 'paused is not stopped');
    assert.equal(timers.active(), 0, 'no interval while paused');
    timers.step(1000);
    assert.equal(run.state.tick, 5, 'no ticks while paused');
    run.resume();
    assert.equal(run.paused(), false);
    assert.equal(timers.active(), 1);
    timers.step(5);
    assert.equal(run.state.tick, 5, 'first tick after resume is a full tickMs away (no catch-up for the pause)');
    timers.step(5);
    assert.equal(run.state.tick, 6);
    assert.equal(run.stats.drops, 0);
    run.stop();
    run.resume();
    assert.equal(timers.active(), 0);
    assert.equal(run.paused(), false);
  });
});
