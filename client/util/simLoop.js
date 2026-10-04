// Wall-clock driven stepping loop for the deterministic simulation. Used by
// the Web Worker (simWorker.js) and by the main-thread fallback in
// localRunner.js. Pure: timers and the clock are injected (testable in Node).
//
// Frames are emitted every `snapshotEvery` ticks in the server's shape
// { k, s, e } where `e` holds every event since the previous frame, in order.

/**
 * @param {Object} o
 * @param {object} o.state                   BattleState from createBattle
 * @param {(state:object)=>any[]} o.step     stepBattle
 * @param {(state:object)=>{k:number,s:number[][]}} o.snapshot  makeSnapshot
 * @param {(state:object)=>object|null} o.result               getResult
 * @param {(frame:{k:number,s:number[][],e:any[]})=>void} o.onFrame
 * @param {(result:object)=>void} o.onEnd
 * @param {number} [o.tickMs=50]
 * @param {number} [o.snapshotEvery=2]
 * @param {number} [o.maxCatchUpTicks=8]     per wakeup at speed 1 (scaled by speed)
 * @param {number} [o.speed=1]
 * @param {() => number} [o.now]
 * @param {(fn:Function, ms:number)=>any} [o.schedule]
 * @param {(handle:any)=>void} [o.cancel]
 * @param {boolean} [o.emitInitialFrame=true] emit a k=0 frame on start so ships are visible before the first tick
 */
export function createSimLoop(o) {
  const state = o.state;
  const step = o.step, snapshot = o.snapshot, result = o.result;
  const tickMs = o.tickMs || 50;
  const snapshotEvery = Math.max(1, o.snapshotEvery || 2);
  const maxCatchUp = Math.max(1, o.maxCatchUpTicks || 8);
  const now = o.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const schedule = o.schedule || ((fn, ms) => setTimeout(fn, ms));
  const cancel = o.cancel || ((h) => clearTimeout(h));
  let speed = [0, 1, 2, 4].includes(o.speed) ? o.speed : 1;
  let paused = false;
  let running = false;
  let ended = !!state.ended;
  let timer = null;
  let acc = 0;
  let last = 0;
  let pending = [];
  let lastFrameTick = -1;

  function emitFrame() {
    const snap = snapshot(state);
    const e = pending;
    pending = [];
    lastFrameTick = snap.k;
    o.onFrame({ k: snap.k, s: snap.s, e });
  }

  function finish() {
    running = false;
    ended = true;
    if (timer !== null) { cancel(timer); timer = null; }
    const r = result(state);
    if (r) o.onEnd(r);
  }

  function effSpeed() { return paused ? 0 : speed; }

  function wake() {
    timer = null;
    if (!running || ended) return;
    const t = now();
    const eff = effSpeed();
    if (eff <= 0) { last = t; acc = 0; return; } // dormant until resumed
    acc += Math.max(0, t - last) * eff;
    last = t;
    const maxTicks = maxCatchUp * eff;
    let n = 0;
    while (acc >= tickMs && n < maxTicks) {
      const ev = step(state);
      for (let i = 0; i < ev.length; i++) pending.push(ev[i]);
      acc -= tickMs;
      n++;
      if (state.tick % snapshotEvery === 0 || state.ended) emitFrame();
      if (state.ended) { finish(); return; }
    }
    // Hit the catch-up limit (long stall or a machine that cannot keep up): drop the
    // remaining backlog instead of spiraling.
    if (n >= maxTicks) acc = 0;
    const wait = Math.max(0, (tickMs - acc) / eff);
    timer = schedule(wake, Math.min(wait, 50));
  }

  function resume() {
    if (!running || ended || timer !== null) return;
    if (effSpeed() <= 0) return;
    last = now();
    acc = 0;
    timer = schedule(wake, 0);
  }

  return {
    start() {
      if (running || ended) return;
      running = true;
      last = now();
      acc = 0;
      if (o.emitInitialFrame !== false && lastFrameTick < 0) emitFrame();
      if (state.ended) { finish(); return; }
      resume();
    },
    stop() {
      running = false;
      if (timer !== null) { cancel(timer); timer = null; }
    },
    /** @param {0|1|2|4} x */
    setSpeed(x) {
      const v = [0, 1, 2, 4].includes(x) ? x : speed;
      if (v === speed) return;
      speed = v;
      if (v === 0) { if (timer !== null) { cancel(timer); timer = null; } acc = 0; } else resume();
    },
    /** Pause independently of the chosen speed (tab hidden). */
    setPaused(b) {
      const v = !!b;
      if (v === paused) return;
      paused = v;
      if (v) { if (timer !== null) { cancel(timer); timer = null; } acc = 0; } else resume();
    },
    /** Step synchronously up to `tick` (used when taking over from a worker). */
    fastForward(tick) {
      while (!state.ended && state.tick < tick) {
        const ev = step(state);
        for (let i = 0; i < ev.length; i++) pending.push(ev[i]);
        if (state.tick % snapshotEvery === 0) { pending = []; lastFrameTick = state.tick; } // those frames were already shown
      }
    },
    get speed() { return speed; },
    get paused() { return paused; },
    get running() { return running && !ended; },
    get ended() { return ended; },
    get tick() { return state.tick; },
    get lastFrameTick() { return lastFrameTick; },
  };
}
