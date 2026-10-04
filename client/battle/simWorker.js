// Web Worker entry: runs the deterministic simulation off the main thread and
// posts frames in the server's shape. Created by localRunner.js with
//   new Worker(new URL('./simWorker.js', import.meta.url), { type: 'module' })
//
// Messages in:  { t:'init', config, speed }  { t:'speed', x }  { t:'pause', on }  { t:'stop' }
// Messages out: { t:'start', info }  { t:'frame', k, s, e }  { t:'end', result }  { t:'error', message }

import { createBattle, stepBattle, makeSnapshot, getResult, getInitialShips, battleWorld } from '/shared/sim/battle.js';
import { TICK_MS, TICK_RATE, SNAPSHOT_EVERY } from '/shared/constants.js';
import { createSimLoop } from '../util/simLoop.js';

let loop = null;

/** BattleStartInfo for a config + fresh state (mirrors localRunner.buildStartInfo). */
function startInfo(config, state) {
  return {
    seed: config.seed,
    players: config.players.map((p) => ({
      id: p.id, name: p.name, team: p.team, isBot: !!p.isBot, faction: p.fleet.faction, fleet: p.fleet,
      ai: p.ai || (p.isBot ? 'normal' : 'especialista'),
    })),
    ships: getInitialShips(state),
    world: battleWorld(state),
    tickRate: TICK_RATE,
    snapshotEvery: SNAPSHOT_EVERY,
    isLocal: true,
  };
}

self.onmessage = (ev) => {
  const m = ev.data || {};
  try {
    if (m.t === 'init') {
      if (loop) loop.stop();
      const state = createBattle(m.config);
      loop = createSimLoop({
        state, step: stepBattle, snapshot: makeSnapshot, result: getResult,
        tickMs: TICK_MS, snapshotEvery: SNAPSHOT_EVERY, speed: m.speed ?? 1,
        onFrame: (f) => self.postMessage({ t: 'frame', k: f.k, s: f.s, e: f.e }),
        onEnd: (r) => self.postMessage({ t: 'end', result: r }),
      });
      self.postMessage({ t: 'start', info: startInfo(m.config, state) });
      if (m.paused) loop.setPaused(true);
      loop.start();
    } else if (m.t === 'speed') {
      if (loop) loop.setSpeed(m.x);
    } else if (m.t === 'pause') {
      if (loop) loop.setPaused(!!m.on);
    } else if (m.t === 'stop') {
      if (loop) loop.stop();
      loop = null;
      self.close();
    }
  } catch (e) {
    self.postMessage({ t: 'error', message: String(e && e.message || e) });
  }
};
