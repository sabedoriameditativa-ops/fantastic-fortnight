// Local battle runner (single-player): runs shared/sim in a module Web Worker
// and falls back to the main thread when workers are unavailable or fail.
// Emits a BattleFeed whose frames have exactly the server's shape plus `at`.
// Speed 0/1/2/4; pauses automatically while the tab is hidden.

import { createBattle, stepBattle, makeSnapshot, getResult, getInitialShips, battleWorld } from '/shared/sim/battle.js';
import { TICK_MS, TICK_RATE, SNAPSHOT_EVERY, MAX_TICKS } from '/shared/constants.js';
import { createFeedBase, nowMs, normalizeSpeed } from './feed.js';
import { createSimLoop } from '../util/simLoop.js';
import { applyPilotInput, pilotSnapshot } from '/shared/pilot.js';

const WORKER_START_TIMEOUT_MS = 4000;

/**
 * BattleStartInfo for a config and its freshly created state.
 * @param {object} config BattleConfig
 * @param {object} state  BattleState
 */
export function buildStartInfo(config, state) {
  return {
    seed: config.seed,
    players: config.players.map((p) => ({
      id: p.id, name: p.name, team: p.team, isBot: !!p.isBot, faction: p.fleet.faction, fleet: p.fleet,
      ai: p.ai || (p.isBot ? 'normal' : 'especialista'), pilot: !!p.pilot,
    })),
    ships: getInitialShips(state),
    world: battleWorld(state),
    tickRate: TICK_RATE,
    snapshotEvery: SNAPSHOT_EVERY,
    maxTicks: config.maxTicks || MAX_TICKS,
    isLocal: true,
    p: pilotSnapshot(state),
    ...(config.campaign ? { campaign: config.campaign } : {}),
  };
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
  let nextPilotSeq = 0;
  const pilotOwner = opts.playerId || config.players.find((p) => !p.isBot)?.id;
  const pilotReplay = [];
  let replayCursor = 0;
  /** @type {ReturnType<typeof createSimLoop>|null} */
  let loop = null;

  function emitFrame(f) {
    if (disposed) return;
    lastK = f.k;
    base.emitFrame({ k: f.k, s: f.s, e: f.e, at: nowMs(),
      ...(f.p?.length ? { p: f.p } : {}),
      ...(f.campaign ? { campaign: f.campaign } : {}),
    });
  }

  function applyJournal(s) {
    while (replayCursor < pilotReplay.length && pilotReplay[replayCursor].tick <= s.tick) {
      const record = pilotReplay[replayCursor++];
      if (record.input.seq > (s.pilots?.[record.ownerId]?.lastSeq ?? -1)) applyPilotInput(s, record.ownerId, record.input);
    }
  }
  function stepWithPilot(s) { applyJournal(s); return stepBattle(s); }
  function rememberPilot(record) {
    pilotReplay.push({ tick: record.tick, ownerId: record.ownerId, input: { ...record.input } });
  }
  function sendPilotInput(raw) {
    if (disposed || !pilotOwner || !config.players.find((p) => p.id === pilotOwner)?.pilot) return { ok: false, code: 'PILOT_UNAVAILABLE' };
    if (raw?.manual && (hidden || speed === 0)) return { ok: false, code: 'PILOT_PAUSED' };
    // Keep replay size bounded; reserve the final entry for returning to autopilot.
    if (pilotReplay.length >= 4800 || (raw?.manual && pilotReplay.length >= 4799)) return { ok: false, code: 'PILOT_REPLAY_LIMIT' };
    const input = { ...raw, seq: nextPilotSeq++ };
    if (mode === 'worker' && worker) {
      worker.postMessage({ t: 'pilot', ownerId: pilotOwner, input });
      return { ok: true, queued: true };
    }
    const result = applyPilotInput(state, pilotOwner, input);
    if (result.ok) rememberPilot({ tick: state.tick, ownerId: pilotOwner, input });
    return result;
  }

  function startMainLoop(fastForwardTo = 0) {
    mode = 'main';
    loop = createSimLoop({
      state, step: stepWithPilot, snapshot: makeSnapshot, result: getResult,
      tickMs: TICK_MS, snapshotEvery: SNAPSHOT_EVERY, speed,
      onFrame: emitFrame, onEnd: (r) => { if (!disposed) base.emitEnd(r); },
      emitInitialFrame: fastForwardTo === 0,
    });
    if (fastForwardTo > 0) loop.fastForward(fastForwardTo);
    applyJournal(state);
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
    // Acknowledged inputs may be one tick ahead of the last published frame.
    // Reconstruct them before accepting fresh input; never replay a manual battle as AI-only.
    startMainLoop(Math.max(lastK, pilotReplay.at(-1)?.tick || 0));
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
      else if (m.t === 'pilot_applied') rememberPilot(m);
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
    if (hidden) sendPilotInput({ manual: false });
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
      if (speed === 0) sendPilotInput({ manual: false });
      if (mode === 'worker' && worker) worker.postMessage({ t: 'speed', x: speed });
      else if (loop) loop.setSpeed(speed);
    },
    get speed() { return speed; },
    get paused() { return hidden; },
    get mode() { return mode; },
    pilot: sendPilotInput,
    getPilotReplay() { return pilotReplay.map((x) => ({ tick: x.tick, ownerId: x.ownerId, input: { ...x.input } })); },
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
