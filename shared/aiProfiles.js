// AI difficulty profiles (pure data). Bots use the profile of their difficulty;
// human fleets always get HUMAN_AI_PROFILE (the ships fight as well as they can).
// See docs/SPEC.md §3.6.

export const AI_PROFILES = {
  facil: {
    id: 'facil', name: 'Fácil',
    thinkInterval: 16, scoreNoise: 0.6, randomTargetProb: 0.3,
    abilityDelayTicks: 20, abilityMiscastProb: 0.3, abilityNoise: 0.5,
    teamWeight: 0, overkillAvoid: false, retreat: false, formation: false, kiting: false,
    budgetMul: 1, builder: 'random',
  },
  normal: {
    id: 'normal', name: 'Normal',
    thinkInterval: 8, scoreNoise: 0.25, randomTargetProb: 0.1,
    abilityDelayTicks: 8, abilityMiscastProb: 0.1, abilityNoise: 0.2,
    teamWeight: 0.5, overkillAvoid: false, retreat: true, formation: true, kiting: true,
    budgetMul: 1.0, builder: 'preset',
  },
  dificil: {
    id: 'dificil', name: 'Difícil',
    thinkInterval: 5, scoreNoise: 0.12, randomTargetProb: 0.03,
    abilityDelayTicks: 2, abilityMiscastProb: 0.05, abilityNoise: 0.05,
    teamWeight: 1, overkillAvoid: true, retreat: true, formation: true, kiting: true,
    budgetMul: 1, builder: 'counter',
  },
  especialista: {
    id: 'especialista', name: 'Especialista',
    thinkInterval: 4, scoreNoise: 0, randomTargetProb: 0,
    abilityDelayTicks: 0, abilityMiscastProb: 0, abilityNoise: 0,
    teamWeight: 1, overkillAvoid: true, retreat: true, formation: true, kiting: true,
    budgetMul: 1, builder: 'counter',
  },
};

export const HUMAN_AI_PROFILE = AI_PROFILES.especialista;

// Personality changes doctrine and risk tolerance, never thinking speed,
// accuracy, resource allowance, or the ability to execute abilities.
export const BOT_PERSONALITIES = Object.freeze({
  balanced: { id: 'balanced', name: 'Equilibrado', styles: ['balanced'], desc: 'Linha versátil e coordenação.' },
  aggressive: { id: 'aggressive', name: 'Agressivo', styles: ['alpha', 'brawl', 'anti_shield', 'emp'], desc: 'Pressão direta, sem recuo.' },
  defensive: { id: 'defensive', name: 'Defensivo', styles: ['carrier', 'sustain', 'balanced'], desc: 'Escolta e sustentação da linha.' },
  swarm: { id: 'swarm', name: 'Enxame', styles: ['swarm', 'carrier', 'anti_shield'], desc: 'Saturação e ataques dispersos.' },
  artillery: { id: 'artillery', name: 'Artilheiro', styles: ['artillery', 'ranged', 'alpha', 'sustain'], desc: 'Fogo concentrado à distância.' },
});

export const BOT_PERSONALITY_IDS = Object.freeze(Object.keys(BOT_PERSONALITIES));

export function getAiProfile(id, personality) {
  const base = AI_PROFILES[id] || HUMAN_AI_PROFILE;
  if (!BOT_PERSONALITIES[personality] || personality === 'balanced') return base;
  const profile = { ...base, personality };
  if (personality === 'aggressive') {
    profile.retreat = false; profile.formation = false; profile.kiting = false;
    profile.teamWeight *= 0.7;
  } else if (personality === 'swarm') {
    profile.formation = false; profile.teamWeight *= 0.5;
  } else if (personality === 'defensive') {
    profile.teamWeight = Math.min(1, profile.teamWeight * 1.4);
    profile.holdRangeMul = 1.15;
  } else if (personality === 'artillery') {
    profile.teamWeight = Math.min(1, profile.teamWeight * 1.2);
    profile.holdRangeMul = 1.25;
  }
  return profile;
}
