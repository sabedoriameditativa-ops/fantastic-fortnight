// Runs only trusted, server-built configs; isolated from the HTTP event loop.
import { parentPort, workerData } from 'node:worker_threads';
import { createBattle, stepBattle, getResult } from '../shared/sim/battle.js';
import { applyPilotInput } from '../shared/pilot.js';

try {
  const state = createBattle(workerData.config);
  const inputs = workerData.inputs || [];
  let next = 0;
  while (!state.ended) {
    while (inputs[next]?.tick === state.tick) {
      const event = inputs[next++];
      if (!applyPilotInput(state, event.ownerId, event.input).ok) throw new Error('BAD_REPLAY');
    }
    stepBattle(state);
  }
  if (next !== inputs.length) throw new Error('BAD_REPLAY');
  parentPort.postMessage({ result: getResult(state) });
} catch (error) {
  parentPort.postMessage({ error: error.message === 'BAD_REPLAY' ? 'BAD_REPLAY' : 'VERIFICATION_FAILED' });
}
