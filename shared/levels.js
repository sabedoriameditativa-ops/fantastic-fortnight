// Single-player level ladder + AI difficulty profiles (re-exported).
// Isomorphic, pure data. See docs/ARCHITECTURE.md §2.3 and docs/SPEC.md §4.
//
// The ladder ramps through composition (every authored level names its
// builder/preset so its description holds on every difficulty), bosses and AI
// quality (aiTier shifts the enemy AI profile one step around the chosen
// difficulty) rather than points: the effective enemy budget multiplier is
// level.enemyBudgetMul × profile.budgetMul, capped at profile.budgetCap.

import { DEFAULT_BUDGET, DIFFICULTIES } from './constants.js';
import { FACTION_IDS, SHIPS, PRESETS, shipsOfFaction } from './catalog.js';
import { AI_PROFILES, HUMAN_AI_PROFILE } from './aiProfiles.js';
import { maxFleetValue } from './fleet.js';

export { AI_PROFILES, HUMAN_AI_PROFILE };

export const LAST_AUTHORED_LEVEL = 15;
export const ENDLESS_BUDGET_BASE = 1.0;    // multiplier at level 15
export const ENDLESS_BUDGET_STEP = 0.05;   // added per wave beyond 15 (also lifts the profile cap)

/**
 * @typedef {Object} Level
 * @property {number} n
 * @property {string} name                 pt-BR
 * @property {string} desc                 pt-BR
 * @property {string} enemyFaction         faction id or 'random'
 * @property {number} enemyBudgetMul       level multiplier (before the difficulty's budgetMul/budgetCap)
 * @property {'random'|'preset'|'counter'} builder
 * @property {string} [preset]             preset id used by the 'preset' builder (must belong to enemyFaction)
 * @property {number} [aiTier]             enemy AI profile = difficulty shifted by this many steps (clamped); default 0
 * @property {string} [boss]               class id that must be in the enemy fleet
 * @property {'capital'|'mothership'} [bossSizeClass] guaranteed size class when the faction is random
 */

/** @type {Level[]} */
export const LEVELS = [
  { n: 1, name: 'Primeiro Contato', enemyFaction: 'terran', enemyBudgetMul: 0.65, builder: 'random',
    desc: 'Uma patrulha terrana desorganizada testa suas defesas. Aprenda o básico da batalha automática.' },
  { n: 2, name: 'Patrulha de Fronteira', enemyFaction: 'terran', enemyBudgetMul: 0.75, builder: 'preset', preset: 'ter_misseis',
    desc: 'Corvetas e cruzadores da Confederação patrulham a fronteira com mísseis e torpedos prontos.' },
  { n: 3, name: 'Bloqueio Orbital', enemyFaction: 'terran', enemyBudgetMul: 0.85, builder: 'preset', preset: 'ter_atlas', boss: 'ter_hercules',
    desc: 'Um bloqueio com encouraçados, porta-naves e cortinas de flak. Rompa a linha terrana.' },
  { n: 4, name: 'Ninho Vorrax', enemyFaction: 'vorrax', enemyBudgetMul: 0.85, builder: 'preset', preset: 'vor_mare',
    desc: 'Primeiro contato com o Enxame: larvas e zangões em número, cascos que se regeneram.' },
  { n: 5, name: 'Maré Viva', enemyFaction: 'vorrax', enemyBudgetMul: 0.9, builder: 'preset', preset: 'vor_chuva',
    desc: 'A maré orgânica avança: cuspidores cobrem o campo de ácido enquanto as matrizes geram prole.' },
  { n: 6, name: 'A Rainha Desperta', enemyFaction: 'vorrax', enemyBudgetMul: 0.95, builder: 'preset', preset: 'vor_garras', boss: 'vor_rainha',
    desc: 'A Rainha-Guerreira lidera o enxame pessoalmente. Derrube-a antes que o feromônio de guerra se espalhe.' },
  { n: 7, name: 'Luz Distante', enemyFaction: 'lumen', enemyBudgetMul: 0.95, builder: 'preset', preset: 'lum_dissonancia',
    desc: 'A Ascendência Lúmen chega: escudos de luz, pulsos dissonantes e lasers precisos.' },
  { n: 8, name: 'Coro de Cristal', enemyFaction: 'lumen', enemyBudgetMul: 1.0, builder: 'preset', preset: 'lum_coro',
    desc: 'Harmônicos e serafins cantam em uníssono sob a Luz Primordial. Quebre os escudos antes que se recuperem.' },
  { n: 9, name: 'Catedral Errante', enemyFaction: 'lumen', enemyBudgetMul: 1.0, builder: 'preset', preset: 'lum_catedral', boss: 'lum_catedral',
    desc: 'Uma Catedral de luz lidera a frota Lúmen. Seu coro radiante atinge vários alvos de uma vez.' },
  { n: 10, name: 'Sinal Ferrix', enemyFaction: 'ferrix', enemyBudgetMul: 1.0, builder: 'preset', preset: 'fer_fabrica',
    desc: 'Drones, fabricadores e sentinelas do Nexo Ferrix. Canhões magnéticos atravessam qualquer blindagem.' },
  { n: 11, name: 'Linha de Ferro', enemyFaction: 'ferrix', enemyBudgetMul: 1.0, builder: 'preset', preset: 'fer_ferro',
    desc: 'Aríetes e sentinelas formam uma linha que se reconstrói entre as salvas.' },
  { n: 12, name: 'Mente Primária', enemyFaction: 'ferrix', enemyBudgetMul: 1.0, builder: 'preset', preset: 'fer_apagao', boss: 'fer_mente',
    desc: 'O nó central do Nexo em pessoa. Prepare-se para a tempestade EMP.' },
  { n: 13, name: 'Aliança Rompida', enemyFaction: 'random', enemyBudgetMul: 1.0, builder: 'counter', aiTier: 1,
    desc: 'Uma frota mercenária estuda a sua composição e escolhe o que a derrota.' },
  { n: 14, name: 'Armada Negra', enemyFaction: 'random', enemyBudgetMul: 1.0, builder: 'counter', bossSizeClass: 'capital', aiTier: 1,
    desc: 'A armada mais temida da galáxia, montada contra você e liderada por uma nave-capital. Sem piedade.' },
  { n: 15, name: 'Fim dos Tempos', enemyFaction: 'random', enemyBudgetMul: 1.0, builder: 'counter', bossSizeClass: 'mothership', aiTier: 1,
    desc: 'Tudo ou nada: uma nave-mãe e sua frota de elite, escolhidas para esmagar a sua.' },
];

/**
 * Level info for any level number. Levels beyond 15 are endless: random
 * faction, counter builder, mothership guaranteed, aiTier +1, level multiplier
 * ENDLESS_BUDGET_BASE + ENDLESS_BUDGET_STEP·(n−15) (1.0 + 0.05·(n−15)).
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
    aiTier: 1,
  };
}

function resolveLevel(level) {
  return typeof level === 'object' && level ? level : levelInfo(level);
}

function profileOf(difficulty) {
  return AI_PROFILES[difficulty] || AI_PROFILES.normal;
}

/**
 * Effective enemy budget multiplier for a level at a difficulty:
 * min(level.enemyBudgetMul × profile.budgetMul, profile.budgetCap), where the
 * cap grows by ENDLESS_BUDGET_STEP per endless wave so endless keeps scaling.
 * @param {number|Level} level
 * @param {string} difficulty
 * @returns {number}
 */
export function effectiveBudgetMul(level, difficulty) {
  const lv = resolveLevel(level);
  const profile = profileOf(difficulty);
  const wave = Math.max(0, lv.n - LAST_AUTHORED_LEVEL);
  const cap = profile.budgetCap + ENDLESS_BUDGET_STEP * wave;
  return Math.round(Math.min(lv.enemyBudgetMul * profile.budgetMul, cap) * 1000) / 1000;
}

/**
 * Enemy budget for a level at a difficulty: round(base × effectiveBudgetMul).
 * @param {number|Level} level   level number or Level object
 * @param {string} difficulty
 * @param {number} [baseBudget]
 * @returns {number}
 */
export function enemyBudget(level, difficulty, baseBudget = DEFAULT_BUDGET) {
  const base = Number.isFinite(baseBudget) && baseBudget > 0 ? baseBudget : DEFAULT_BUDGET;
  return Math.round(base * effectiveBudgetMul(level, difficulty));
}

/**
 * What the enemy budget really buys: a fleet is at most 40 ships under the
 * size-class caps, so beyond `spendable` points the extra budget is unspent
 * (the setup panel should show `spendable`, not `budget`). For a random
 * faction the most valuable faction roster is used.
 * @param {number|Level} level
 * @param {string} difficulty
 * @param {number} [baseBudget]
 * @returns {{ budget: number, mul: number, spendable: number, capped: boolean, factions: string[] }}
 */
export function enemyBudgetInfo(level, difficulty, baseBudget = DEFAULT_BUDGET) {
  const lv = resolveLevel(level);
  const budget = enemyBudget(lv, difficulty, baseBudget);
  const factions = FACTION_IDS.includes(lv.enemyFaction) ? [lv.enemyFaction] : FACTION_IDS.slice();
  const maxValue = Math.max(...factions.map((f) => maxFleetValue(f)));
  const spendable = Math.min(budget, maxValue);
  return { budget, mul: effectiveBudgetMul(lv, difficulty), spendable, capped: budget > maxValue, factions };
}

/**
 * Bot fleet builder of a level (every level names one; a legacy 'auto' resolves
 * to the difficulty's builder).
 * @param {number|Level} level
 * @param {string} difficulty
 * @returns {'random'|'preset'|'counter'}
 */
export function levelBuilder(level, difficulty) {
  const lv = resolveLevel(level);
  if (lv.builder && lv.builder !== 'auto') return lv.builder;
  return profileOf(difficulty).builder;
}

/**
 * Preset the 'preset' builder uses for a level (null when the level has none
 * or it does not belong to the resolved faction: the builder then picks one).
 * @param {number|Level} level
 * @param {string} faction
 * @returns {string|null}
 */
export function levelPreset(level, faction) {
  const lv = resolveLevel(level);
  const p = lv.preset && PRESETS[lv.preset];
  return p && p.faction === faction ? p.id : null;
}

/**
 * AI profile the enemy bots of a level use: the chosen difficulty shifted by
 * level.aiTier steps along DIFFICULTIES (clamped to the ends).
 * @param {number|Level} level
 * @param {string} difficulty
 * @returns {string}
 */
export function levelEnemyAi(level, difficulty) {
  const lv = resolveLevel(level);
  const base = DIFFICULTIES.includes(difficulty) ? difficulty : 'normal';
  const i = DIFFICULTIES.indexOf(base) + (lv.aiTier | 0);
  return DIFFICULTIES[Math.max(0, Math.min(DIFFICULTIES.length - 1, i))];
}

/**
 * Resolve the enemy faction of a level ('random' → rng.pick(FACTION_IDS)).
 * @param {number|Level} level
 * @param {{ pick<T>(a: T[]): T }} rng
 * @returns {string}
 */
export function levelEnemyFaction(level, rng) {
  const lv = resolveLevel(level);
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
  const lv = resolveLevel(level);
  const out = [];
  if (lv.boss && SHIPS[lv.boss] && SHIPS[lv.boss].faction === faction) out.push(lv.boss);
  if (lv.bossSizeClass) {
    const ship = shipsOfFaction(faction).find((s) => s.sizeClass === lv.bossSizeClass);
    if (ship && !out.includes(ship.id)) out.push(ship.id);
  }
  return out;
}
