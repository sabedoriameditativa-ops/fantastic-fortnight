// Local battle runner (single-player): runs shared/sim in a module Web Worker
// and falls back to the main thread when workers are unavailable or fail.
// Emits a BattleFeed whose frames have exactly the server's shape plus `at`.
// Speed 0/1/2/4; pauses automatically while the tab is hidden.

import { createBattle, stepBattle, makeSnapshot, getResult, makeStartInfo } from '/shared/sim/battle.js';
import { TICK_MS, TICK_RATE, SNAPSHOT_EVERY, MAX_TICKS } from '/shared/constants.js';
import { createFeedBase, nowMs, normalizeSpeed } from './feed.js';
import { createSimLoop } from '../util/simLoop.js';

const WORKER_START_TIMEOUT_MS = 4000;

/**
 * BattleStartInfo for a config and its freshly created state.
 * @param {object} config BattleConfig
 * @param {object} state  BattleState
 */
export function buildStartInfo(config, state) {
  return { ...makeStartInfo(config, state), isLocal: true };
}

/**
 * Create a local runner. Throws synchronously when the config is invalid.
 * @param {object} config BattleConfig
 * @param {{ useWorker?: boolean, speed?: 0|1|2|4, autoPause?: boolean, doc?: Document }} [opts]
 * @returns {import('./feed.js').BattleFeed & { controls: { setSpeed(x:number):void, isLocal: true, speed: number, paused: boolean, mode: 'worker'|'main' }, state: object|null }}
 */
export function createLocalRunner(config, opts = {}) {
  const useWorker = opts.useWorker !== false;
  const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  const base = createFeedBase({ isLocal: true });
  // Validate + compute the start info synchronously (deterministic: the worker
  // builds the exact same state from the same config).
  const state = createBattle(config);
  const info = buildStartInfo(config, state);
  let speed = normalizeSpeed(opts.speed ?? 1);
  let hidden = false;
  let disposed = false;
  let mode = 'main';
  let worker = null;
  let workerReady = false;
  let startTimer = null;
  let lastK = 0;
  /** @type {ReturnType<typeof createSimLoop>|null} */
  let loop = null;

  function emitFrame(f) {
    if (disposed) return;
    lastK = f.k;
    base.emitFrame({ k: f.k, s: f.s, e: f.e, at: nowMs() });
  }

  function startMainLoop(fastForwardTo = 0) {
    mode = 'main';
    loop = createSimLoop({
      state, step: stepBattle, snapshot: makeSnapshot, result: getResult,
      tickMs: TICK_MS, snapshotEvery: SNAPSHOT_EVERY, speed,
      onFrame: emitFrame, onEnd: (r) => { if (!disposed) base.emitEnd(r); },
      emitInitialFrame: fastForwardTo === 0,
    });
    if (fastForwardTo > 0) loop.fastForward(fastForwardTo);
    loop.setPaused(hidden);
    // Defer the first tick so subscribers registered synchronously after
    // createLocalRunner() receive the k=0 frame (same ordering as the worker path).
    const l = loop;
    setTimeout(() => { if (!disposed && loop === l) l.start(); }, 0);
  }

  function fallbackToMain(reason) {
    if (disposed || mode === 'main') return;
    if (typeof console !== 'undefined') console.warn('[localRunner] worker unavailable, running on the main thread:', reason);
    stopWorker();
    startMainLoop(lastK);
  }

  function stopWorker() {
    if (startTimer !== null) { clearTimeout(startTimer); startTimer = null; }
    if (worker) {
      try { worker.onmessage = null; worker.onerror = null; worker.terminate(); } catch { /* ignore */ }
      worker = null;
    }
    workerReady = false;
  }

  function startWorker() {
    let w;
    try {
      w = new Worker(new URL('./simWorker.js', import.meta.url), { type: 'module', name: 'frota-sim' });
    } catch (e) {
      startMainLoop(0);
      return;
    }
    mode = 'worker';
    worker = w;
    w.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.t === 'frame') emitFrame(m);
      else if (m.t === 'start') { workerReady = true; if (startTimer !== null) { clearTimeout(startTimer); startTimer = null; } }
      else if (m.t === 'end') { if (!disposed) base.emitEnd(m.result); }
      else if (m.t === 'error') fallbackToMain(m.message);
    };
    w.onerror = (e) => { fallbackToMain(e && e.message ? e.message : 'worker error'); };
    startTimer = setTimeout(() => { if (!workerReady) fallbackToMain('worker start timeout'); }, WORKER_START_TIMEOUT_MS);
    w.postMessage({ t: 'init', config, speed, paused: hidden });
  }

  // ---- visibility: pause while hidden, resume without catch-up ----
  const onVisibility = () => {
    hidden = !!(doc && doc.visibilityState === 'hidden');
    if (mode === 'worker' && worker) worker.postMessage({ t: 'pause', on: hidden });
    else if (loop) loop.setPaused(hidden);
  };
  if (doc && typeof doc.addEventListener === 'function') {
    hidden = doc.visibilityState === 'hidden';
    doc.addEventListener('visibilitychange', onVisibility);
  }

  const controls = {
    isLocal: true,
    /** @param {0|1|2|4} x */
    setSpeed(x) {
      const n = Number(x);
      if (![0, 1, 2, 4].includes(n) || n === speed) return;
      speed = n;
      if (mode === 'worker' && worker) worker.postMessage({ t: 'speed', x: speed });
      else if (loop) loop.setSpeed(speed);
    },
    get speed() { return speed; },
    get paused() { return hidden; },
    get mode() { return mode; },
  };

  const feed = {
    onStart: base.onStart, onFrame: base.onFrame, onEnd: base.onEnd, onStatus: base.onStatus,
    controls,
    get isLocal() { return true; },
    /** Main-thread state (null while the worker runs). */
    get state() { return mode === 'main' ? state : null; },
    get lastStart() { return base.lastStart; },
    get lastEnd() { return base.lastEnd; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVisibility);
      if (worker) { try { worker.postMessage({ t: 'stop' }); } catch { /* ignore */ } }
      stopWorker();
      if (loop) { loop.stop(); loop = null; }
      base.clear();
    },
  };

  base.emitStart(info);
  if (useWorker && typeof Worker === 'function') startWorker();
  else startMainLoop(0);
  return feed;
}
