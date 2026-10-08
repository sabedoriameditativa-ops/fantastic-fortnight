// Public, configurable progression rules. Only the server applies rewards.
// Unlocks are purchases of options, never bonuses to combat statistics.
export const DAY_MS = 86_400_000;
export const DEFAULT_PROGRESSION_POLICY = Object.freeze({
  participation: 8, victory: 14, draw: 4, defeatLoss: 10, minimumDefeatLoss: 2, poorPerformanceLoss: 2,
  performanceCap: 6, dailyGainCap: 180, dailyLossCap: 30,
  rewardIntervalMs: 60_000, minBattleTicks: 200,
  inactivityGraceDays: 14, inactivityDailyLoss: 2, inactivityLossCap: 40,
});

export const UNLOCKS = Object.freeze([
  ...['terran', 'vorrax', 'lumen', 'ferrix', 'astral'].map((faction) => Object.freeze({
    id: `special:${faction}`, kind: 'special', faction, cost: 80, ...(faction === 'astral' ? { requires: 'faction:astral' } : {}),
    name: `Licença de piloto · ${faction}`, description: 'Uma nave especial; o custo de combate continua sendo descontado do orçamento.',
  })),
  Object.freeze({ id: 'faction:astral', kind: 'faction', faction: 'astral', cost: 180, name: 'Concílio Astral', description: 'Navegadores gravitacionais e sua Lanceta. Mesmo orçamento de combate das outras facções.' }),
  ...[['ast_guardiao', 'Guardião', 120], ['ast_arconte', 'Arconte', 180]].map(([ship, name, cost]) => Object.freeze({
    id: `ship:${ship}`, kind: 'ship', ship, cost, name, requires: 'faction:astral',
    description: 'Uma nova opção de composição, sujeita ao mesmo orçamento e limites.',
  })),
]);

export const UNLOCK_CATALOG = UNLOCKS;

export function normalizeProgressionPolicy(raw = {}) {
  const policy = { ...DEFAULT_PROGRESSION_POLICY };
  for (const key of Object.keys(policy)) {
    if (Number.isSafeInteger(raw[key]) && raw[key] >= 0 && raw[key] <= 1e9) policy[key] = raw[key];
  }
  return policy;
}

export function requiredFleetUnlocks(fleet) {
  const required = new Set();
  if (fleet?.faction === 'astral') required.add('faction:astral');
  for (const entry of fleet?.ships || []) {
    const id = `ship:${entry.cls}`;
    if (entry.count > 0 && UNLOCKS.some((u) => u.id === id)) required.add(id);
  }
  return [...required];
}

/** Defensive bounds are in addition to server authority, not a replacement. */
export function matchReward(result, participant, policy = DEFAULT_PROGRESSION_POLICY, participants = []) {
  const stat = result?.players?.[participant.playerId];
  if (!stat || ![0, 1, -1].includes(result.winner) || !Number.isFinite(result.ticks) || result.ticks < policy.minBattleTicks) {
    return { eligible: false, outcome: 'unrated', delta: 0, performance: 0 };
  }
  const finite = (v) => Number.isFinite(v) ? Math.max(0, v) : 0;
  const contribution = finite(stat.damageDealt) + finite(stat.healing) * 0.5;
  const team = participants.filter((p) => p.team === participant.team);
  const total = team.reduce((n, p) => n + finite(result.players?.[p.playerId]?.damageDealt) + finite(result.players?.[p.playerId]?.healing) * 0.5, 0);
  // Contribution is relative to teammates, so 6v6 commanders are not graded
  // against an entire opposing army. A support ship also earns credit.
  const relativeContribution = total > 0 ? contribution * Math.max(1, team.length) / total : 0;
  const efficiency = contribution / Math.max(1, finite(stat.damageTaken));
  const performance = Math.min(1, relativeContribution, efficiency);
  const bonus = Math.floor(policy.performanceCap * performance);
  const outcome = result.winner === -1 ? 'draw' : result.winner === participant.team ? 'win' : 'loss';
  let delta = policy.participation + bonus;
  if (outcome === 'win') delta += policy.victory;
  else if (outcome === 'draw') delta += policy.draw;
  else delta = Math.min(-policy.minimumDefeatLoss, delta - policy.defeatLoss - (performance < 0.2 ? policy.poorPerformanceLoss : 0));
  return { eligible: true, outcome, delta, performance: Math.round(performance * 100) / 100 };
}

export function inactivityInfo(lastPlayedAt, now, charged = 0, policy = DEFAULT_PROGRESSION_POLICY) {
  const daysInactive = Math.max(0, Math.floor((now - lastPlayedAt) / DAY_MS));
  const daysChargeable = Math.max(0, daysInactive - policy.inactivityGraceDays);
  const target = Math.min(policy.inactivityLossCap, daysChargeable * policy.inactivityDailyLoss);
  return {
    graceDays: policy.inactivityGraceDays, daysInactive, charged, totalCap: policy.inactivityLossCap,
    due: Math.max(0, target - charged),
    nextChargeAt: target < policy.inactivityLossCap && policy.inactivityDailyLoss > 0
      ? lastPlayedAt + (Math.max(policy.inactivityGraceDays, daysInactive) + 1) * DAY_MS : null,
    warning: `Após ${policy.inactivityGraceDays} dias sem concluir uma partida: −${policy.inactivityDailyLoss} pontos por dia, até ${policy.inactivityLossCap} por ausência. Desbloqueios são permanentes.`,
  };
}
