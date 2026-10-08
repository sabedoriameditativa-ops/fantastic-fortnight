// Single-player level ladder + AI difficulty profiles (re-exported).
// Isomorphic, pure data. See docs/ARCHITECTURE.md §2.3 and docs/SPEC.md §4.

import { DEFAULT_BUDGET, TICK_RATE } from './constants.js';
import { FACTION_IDS, SHIPS, shipsOfFaction } from './catalog.js';
import { AI_PROFILES, HUMAN_AI_PROFILE } from './aiProfiles.js';

export { AI_PROFILES, HUMAN_AI_PROFILE };

export const LAST_AUTHORED_LEVEL = 15;
export const ENDLESS_BUDGET_BASE = 1.5;   // multiplier at level 15
export const ENDLESS_BUDGET_STEP = 0.1;   // added per level beyond 15

/**
 * @typedef {Object} Level
 * @property {number} n
 * @property {string} name                 pt-BR
 * @property {string} desc                 pt-BR
 * @property {string} enemyFaction         faction id or 'random'
 * @property {number} enemyBudgetMul
 * @property {'random'|'preset'|'counter'|'auto'} builder   'auto' = the difficulty's builder
 * @property {string} [boss]               class id that must be in the enemy fleet
 * @property {'mothership'} [bossSizeClass] guaranteed size class when the faction is random
 */

/** @type {Level[]} */
export const LEVELS = [
  { n: 1, name: 'Primeiro Contato', enemyFaction: 'terran', enemyBudgetMul: 0.5, builder: 'random',
    desc: 'Uma patrulha terrana desorganizada testa suas defesas. Aprenda o básico da batalha automática.' },
  { n: 2, name: 'Patrulha de Fronteira', enemyFaction: 'terran', enemyBudgetMul: 0.6, builder: 'auto', objective: 'escort',
    desc: 'Escolte o transporte até a zona de saída. Se ele cair, a missão termina.' },
  { n: 3, name: 'Bloqueio Orbital', enemyFaction: 'terran', enemyBudgetMul: 0.7, builder: 'auto', objective: 'defense',
    desc: 'Proteja a estação por 75 segundos contra patrulhas e reforços terranos.' },
  { n: 4, name: 'Ninho Vorrax', enemyFaction: 'vorrax', enemyBudgetMul: 0.7, builder: 'auto',
    desc: 'Primeiro contato com o Enxame: larvas e zangões em número, cascos que se regeneram.' },
  { n: 5, name: 'Maré Viva', enemyFaction: 'vorrax', enemyBudgetMul: 0.8, builder: 'auto', objective: 'survival',
    desc: 'Mantenha ao menos uma nave da frota viva por 90 segundos. O enxame recebe reforços.' },
  { n: 6, name: 'A Rainha Desperta', enemyFaction: 'vorrax', enemyBudgetMul: 0.9, builder: 'auto', boss: 'vor_rainha',
    desc: 'A Rainha-Guerreira lidera o enxame pessoalmente. Derrube-a antes que o feromônio de guerra se espalhe.' },
  { n: 7, name: 'Luz Distante', enemyFaction: 'lumen', enemyBudgetMul: 0.85, builder: 'auto', objective: 'escort',
    desc: 'Abra passagem para o transporte através dos lasers e escudos Lúmen.' },
  { n: 8, name: 'Coro de Cristal', enemyFaction: 'lumen', enemyBudgetMul: 0.95, builder: 'auto', objective: 'defense',
    desc: 'Defenda a estação por 75 segundos; novas formações Lúmen chegam durante o cerco.' },
  { n: 9, name: 'Catedral Errante', enemyFaction: 'lumen', enemyBudgetMul: 1.0, builder: 'auto', boss: 'lum_catedral',
    desc: 'Uma Catedral de luz lidera a frota Lúmen. Seu coro radiante atinge vários alvos de uma vez.' },
  { n: 10, name: 'Sinal Ferrix', enemyFaction: 'ferrix', enemyBudgetMul: 0.95, builder: 'auto', objective: 'waves',
    desc: 'Derrote as três ondas do Nexo. Cada nova onda chega após 35 segundos ou ao limpar a anterior.' },
  { n: 11, name: 'Linha de Ferro', enemyFaction: 'ferrix', enemyBudgetMul: 1.05, builder: 'auto', objective: 'survival',
    desc: 'Sobreviva 90 segundos à linha Ferrix e seus reforços de canhões magnéticos.' },
  { n: 12, name: 'Mente Primária', enemyFaction: 'ferrix', enemyBudgetMul: 1.15, builder: 'auto', boss: 'fer_mente',
    desc: 'O nó central do Nexo em pessoa. Prepare-se para a tempestade EMP.' },
  { n: 13, name: 'Aliança Rompida', enemyFaction: 'random', enemyBudgetMul: 1.2, builder: 'counter',
    desc: 'Uma frota mercenária estuda a sua composição e escolhe o que a derrota.' },
  { n: 14, name: 'Armada Negra', enemyFaction: 'random', enemyBudgetMul: 1.3, builder: 'counter', objective: 'waves',
    desc: 'Três ondas mercenárias estudam a sua frota. Destrua todos os reforços.' },
  { n: 15, name: 'Fim dos Tempos', enemyFaction: 'random', enemyBudgetMul: 1.5, builder: 'counter', bossSizeClass: 'mothership',
    desc: 'Tudo ou nada: uma nave-mãe e sua frota de elite, escolhidas para esmagar a sua.' },
];

/**
 * Level info for any level number. Levels beyond 15 are endless: random
 * faction, counter builder, mothership guaranteed, budget ×(1.5 + 0.1·(n−15)).
 * Non-integer or < 1 input is clamped to level 1.
 * @param {number} n
 * @returns {Level}
 */
export function levelInfo(n) {
  let level = Math.floor(Number(n));
  if (!Number.isFinite(level) || level < 1) level = 1;
  if (level <= LAST_AUTHORED_LEVEL) return { ...LEVELS[level - 1] };
  const wave = level - LAST_AUTHORED_LEVEL;
  return {
    n: level,
    name: `Além do Fim — Onda ${wave}`,
    desc: 'O inimigo não para de crescer. Até onde a sua frota aguenta?',
    enemyFaction: 'random',
    enemyBudgetMul: Math.round((ENDLESS_BUDGET_BASE + ENDLESS_BUDGET_STEP * wave) * 1000) / 1000,
    builder: 'counter',
    bossSizeClass: 'mothership',
  };
}

/**
 * Enemy budget for a level at a difficulty:
 * round(base × level.enemyBudgetMul × resourceMul). Intelligence never grants resources.
 * @param {number|Level} level   level number or Level object
 * @param {string} difficulty
 * @param {number} [baseBudget]
 * @param {number} [resourceMul] explicit handicap, clamped to 0.5..2
 * @returns {number}
 */
export function enemyBudget(level, difficulty, baseBudget = DEFAULT_BUDGET, resourceMul = 1) {
  const lv = typeof level === 'object' && level ? level : levelInfo(level);
  const base = Number.isFinite(baseBudget) && baseBudget > 0 ? baseBudget : DEFAULT_BUDGET;
  const resources = Number.isFinite(resourceMul) ? Math.max(0.5, Math.min(2, resourceMul)) : 1;
  return Math.round(base * lv.enemyBudgetMul * resources);
}

export const CAMPAIGN_OBJECTIVES = Object.freeze({
  elimination: 'Eliminar a frota inimiga', escort: 'Escoltar o transporte',
  defense: 'Defender a estação', survival: 'Sobreviver', waves: 'Derrotar todas as ondas',
});

/** Serializable scenario rules. No hidden intelligence/resource multiplier. */
export function levelCampaign(level) {
  const lv = typeof level === 'object' && level ? level : levelInfo(level);
  const type = CAMPAIGN_OBJECTIVES[lv.objective] ? lv.objective : 'elimination';
  const seconds = type === 'defense' ? 75 : type === 'survival' ? 90 : 120;
  return {
    type, name: CAMPAIGN_OBJECTIVES[type], team: 0,
    durationTicks: seconds * TICK_RATE,
    waveCount: type === 'elimination' || type === 'escort' ? 1 : 3,
    waveIntervalTicks: (type === 'defense' ? 25 : 35) * TICK_RATE,
    reinforcementFraction: 0.45,
  };
}

/**
 * Effective bot fleet builder for a level at a difficulty ('auto' resolves to
 * the difficulty's builder).
 * @param {number|Level} level
 * @param {string} difficulty
 * @returns {'random'|'preset'|'counter'}
 */
export function levelBuilder(level, difficulty) {
  const lv = typeof level === 'object' && level ? level : levelInfo(level);
  if (lv.builder && lv.builder !== 'auto') return lv.builder;
  const profile = AI_PROFILES[difficulty] || AI_PROFILES.normal;
  return profile.builder;
}

/**
 * Resolve the enemy faction of a level ('random' → rng.pick(FACTION_IDS)).
 * @param {number|Level} level
 * @param {{ pick<T>(a: T[]): T }} rng
 * @returns {string}
 */
export function levelEnemyFaction(level, rng) {
  const lv = typeof level === 'object' && level ? level : levelInfo(level);
  if (FACTION_IDS.includes(lv.enemyFaction)) return lv.enemyFaction;
  return rng.pick(FACTION_IDS);
}

/**
 * Classes the enemy fleet must include for a level, given the resolved faction:
 * the explicit boss (when it belongs to the faction) and/or the faction's ship
 * of `bossSizeClass`. Pass the result as `mustInclude` to buildBotFleet.
 * @param {number|Level} level
 * @param {string} faction
 * @returns {string[]}
 */
export function levelMustInclude(level, faction) {
  const lv = typeof level === 'object' && level ? level : levelInfo(level);
  const out = [];
  if (lv.boss && SHIPS[lv.boss] && SHIPS[lv.boss].faction === faction) out.push(lv.boss);
  if (lv.bossSizeClass) {
    const ship = shipsOfFaction(faction).find((s) => s.sizeClass === lv.bossSizeClass);
    if (ship && !out.includes(ship.id)) out.push(ship.id);
  }
  return out;
}
