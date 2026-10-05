// Shared helpers for the simulation tests.
import { scalePreset, oneOfEachFleet, fleetFromSpec } from '../../shared/sim/harness.js';

export { scalePreset, oneOfEachFleet, fleetFromSpec };

/** Standard 1v1 config: fleet a (team 0) vs fleet b (team 1), both bots with `ai`. */
export function config1v1(fleetA, fleetB, seed, ai = 'especialista', extra = {}) {
  return {
    seed,
    players: [
      { id: 'p1', name: 'Um', team: 0, isBot: true, ai, fleet: fleetA },
      { id: 'p2', name: 'Dois', team: 1, isBot: true, ai, fleet: fleetB },
    ],
    ...extra,
  };
}

/** Collect every event of a battle run with stepBattle. */
export function collectEvents(state, stepBattle, maxTicks = Infinity) {
  const all = [];
  let n = 0;
  while (!state.ended && n < maxTicks) {
    const ev = stepBattle(state);
    for (const e of ev) all.push(e);
    n++;
  }
  return all;
}
