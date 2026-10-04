// Match runner: drift-corrected tick loop over shared/sim/battle.js, frames
// serialized ONCE per room and handed to the caller as strings for broadcast.
// See docs/ARCHITECTURE.md §4.3.

import { TICK_MS, SNAPSHOT_EVERY } from '../shared/constants.js';
import { createBattle, stepBattle, makeSnapshot, getResult } from '../shared/sim/battle.js';
import { S2C } from '../shared/protocol.js';

const defaultTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h),
  now: () => performance.now(),
};

/**
 * Start a match loop.
 *
 * The loop polls every `pollMs` and compares the clock against `nextTickAt`,
 * running up to `maxCatchUp` ticks per wakeup. When the process falls further
 * behind than that, time is dropped (the battle slows down instead of the
 * loop spiralling). Every `snapshotEvery` ticks a frame `{t:'f',k,s,e}` is
 * serialized once and passed to `onFrame(str, frame)`; the final tick always
 * emits a frame (it carries the `end` event), then `onEnd(result)` fires once
 * and the loop stops.
 *
 * @param {Object} o
 * @param {object} o.config          BattleConfig (ignored when `state` is given)
 * @param {object} [o.state]         a battle state already created with createBattle
 * @param {(str: string, frame: {t:string,k:number,s:number[][],e:any[][]}) => void} o.onFrame
 * @param {(result: object) => void} o.onEnd
 * @param {number} [o.tickMs]        simulated ms per tick (default TICK_MS; FE_TICK_MS in tests)
 * @param {number} [o.snapshotEvery] ticks per frame (default SNAPSHOT_EVERY)
 * @param {number} [o.pollMs]        timer interval (default 10)
 * @param {number} [o.maxCatchUp]    max ticks per wakeup (default 8)
 * @param {{setInterval:Function, clearInterval:Function, now:() => number}} [o.timers]
 * @param {{warn(...a:any[]):void}} [o.log]
 * @returns {{ stop(): void, state: object, stats: {ticks:number, frames:number, drops:number, maxLagMs:number}, running(): boolean, lastFrame(): string|null }}
 */
export function startMatch({
  config, state, onFrame, onEnd, tickMs = TICK_MS, snapshotEvery = SNAPSHOT_EVERY,
  pollMs = 10, maxCatchUp = 8, timers = defaultTimers, log = console,
}) {
  const st = state || createBattle(config);
  const now = timers.now || defaultTimers.now;
  const stats = { ticks: 0, frames: 0, drops: 0, maxLagMs: 0 };
  let pending = [];
  let nextTickAt = now() + tickMs;
  let stopped = false;
  let ended = false;
  let last = null;
  let timer = null;

  function emitFrame() {
    const snap = makeSnapshot(st);
    const frame = { t: S2C.FRAME, k: snap.k, s: snap.s, e: pending };
    pending = [];
    const str = JSON.stringify(frame);
    last = str;
    stats.frames++;
    try {
      onFrame(str, frame);
    } catch (err) {
      log.warn('[match] onFrame error', err);
    }
  }

  function tick() {
    const ev = stepBattle(st);
    stats.ticks++;
    for (let i = 0; i < ev.length; i++) pending.push(ev[i]);
    if (st.tick % snapshotEvery === 0 || st.ended) emitFrame();
  }

  function finish() {
    if (ended) return;
    ended = true;
    stop();
    try {
      onEnd(getResult(st));
    } catch (err) {
      log.warn('[match] onEnd error', err);
    }
  }

  function wake() {
    if (stopped) return;
    const t = now();
    const lag = t - nextTickAt;
    if (lag > stats.maxLagMs) stats.maxLagMs = lag;
    let n = 0;
    while (!st.ended && n < maxCatchUp && now() >= nextTickAt) {
      tick();
      nextTickAt += tickMs;
      n++;
    }
    if (!st.ended && now() - nextTickAt > tickMs * maxCatchUp) {
      // Hopelessly behind: drop the backlog instead of spinning.
      stats.drops++;
      nextTickAt = now() + tickMs;
    }
    if (st.ended) finish();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      timers.clearInterval(timer);
      timer = null;
    }
  }

  if (st.ended) {
    // Degenerate: nothing to simulate (e.g. a config that ended at creation).
    emitFrame();
    queueMicrotask(finish);
  } else {
    timer = timers.setInterval(wake, pollMs);
  }

  return {
    stop,
    state: st,
    stats,
    running: () => !stopped,
    lastFrame: () => last,
  };
}
