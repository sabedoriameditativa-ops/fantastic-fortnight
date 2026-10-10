// AI difficulty profiles (pure data). Bots use the profile of their difficulty;
// human fleets always get HUMAN_AI_PROFILE (the ships fight as well as they can).
// See docs/SPEC.md §3.6.
//
// budgetMul scales the enemy budget in single player (× the level multiplier);
// budgetCap bounds that product so the ladder ramps through AI quality,
// composition and bosses rather than points (SPEC §4).

export const AI_PROFILES = {
  facil: {
    id: 'facil', name: 'Fácil',
    thinkInterval: 16, scoreNoise: 0.6, randomTargetProb: 0.3,
    abilityDelayTicks: 20, abilityMiscastProb: 0.3, abilityNoise: 0.5,
    teamWeight: 0, overkillAvoid: false, retreat: false, formation: false, kiting: false,
    budgetMul: 0.85, budgetCap: 1.0, builder: 'random',
  },
  normal: {
    id: 'normal', name: 'Normal',
    thinkInterval: 8, scoreNoise: 0.25, randomTargetProb: 0.1,
    abilityDelayTicks: 8, abilityMiscastProb: 0.1, abilityNoise: 0.2,
    teamWeight: 0.5, overkillAvoid: false, retreat: true, formation: true, kiting: true,
    budgetMul: 1.0, budgetCap: 1.1, builder: 'preset',
  },
  dificil: {
    id: 'dificil', name: 'Difícil',
    thinkInterval: 5, scoreNoise: 0.12, randomTargetProb: 0.03,
    abilityDelayTicks: 2, abilityMiscastProb: 0.05, abilityNoise: 0.05,
    teamWeight: 1, overkillAvoid: true, retreat: true, formation: true, kiting: true,
    budgetMul: 1.0, budgetCap: 1.15, builder: 'counter',
  },
  especialista: {
    id: 'especialista', name: 'Especialista',
    thinkInterval: 4, scoreNoise: 0, randomTargetProb: 0,
    abilityDelayTicks: 0, abilityMiscastProb: 0, abilityNoise: 0,
    teamWeight: 1, overkillAvoid: true, retreat: true, formation: true, kiting: true,
    budgetMul: 1.05, budgetCap: 1.25, builder: 'counter',
  },
};

export const HUMAN_AI_PROFILE = AI_PROFILES.especialista;

export function getAiProfile(id) {
  return AI_PROFILES[id] || HUMAN_AI_PROFILE;
}
