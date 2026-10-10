// Single-player battle configuration: the player's fleet (AI 'especialista'),
// ally bots (chosen difficulty, random factions) and enemy bots per level and
// difficulty (levels.js: enemyBudget, the level's builder/preset, boss
// mustInclude, enemy AI tier). The setup's budget preset (Escaramuça / Padrão /
// Guerra Total) is the player's budget and the base of the enemy's.
// Deterministic given the seed. Pure (no DOM).

import { DEFAULT_BUDGET, BUDGETS, TEAM_SIZES, DIFFICULTIES } from '/shared/constants.js';
import { FACTION_IDS, presetsOfFaction, PRESETS } from '/shared/catalog.js';
import { createRng } from '/shared/rng.js';
import { presetFleet, validateFleet, fleetCost } from '/shared/fleet.js';
import { buildBotFleet } from '/shared/botFleet.js';
import {
  levelInfo, enemyBudget, enemyBudgetInfo, levelBuilder, levelPreset, levelEnemyAi, levelEnemyFaction, levelMustInclude,
} from '/shared/levels.js';

export const BOT_NAMES = [
  'Almirante Kael', 'Capitã Ysolde', 'Comodoro Brax', 'Nyx-7', 'Tenente Orin', 'Vashti', 'Rook', 'Mestre Ilun',
  'Zéfiro', 'Dra. Mirren', 'Sargento Tolk', 'Oráculo-3', 'Capitão Deren', 'Selene', 'Krast', 'Comandante Vale',
];

/** Budget presets of the single-player setup (shared BUDGETS: Escaramuça 800 / Padrão 1500 / Guerra Total 2500). */
export const SP_BUDGET_IDS = Object.freeze(Object.keys(BUDGETS));
export const DEFAULT_SP_BUDGET = 'padrao';

export const DEFAULT_SP_SETUP = Object.freeze({ level: 1, difficulty: 'normal', teamSize: 1, allyDifficulty: 'normal', budget: DEFAULT_SP_BUDGET });

/** Clamp/normalize a single-player setup object. */
export function normalizeSpSetup(raw) {
  const s = { ...DEFAULT_SP_SETUP };
  if (raw && typeof raw === 'object') {
    const lv = Math.floor(Number(raw.level));
    if (Number.isFinite(lv) && lv >= 1 && lv <= 999) s.level = lv;
    if (DIFFICULTIES.includes(raw.difficulty)) s.difficulty = raw.difficulty;
    const ts = Math.floor(Number(raw.teamSize));
    if (TEAM_SIZES.includes(ts)) s.teamSize = ts;
    if (DIFFICULTIES.includes(raw.allyDifficulty)) s.allyDifficulty = raw.allyDifficulty;
    if (SP_BUDGET_IDS.includes(raw.budget)) s.budget = raw.budget;
  }
  return s;
}

/** Player budget (points) of a setup; the enemy budget scales with it (levels.js enemyBudget). */
export function spBudgetPoints(setup) {
  const id = setup && SP_BUDGET_IDS.includes(setup.budget) ? setup.budget : DEFAULT_SP_BUDGET;
  return BUDGETS[id].points;
}

/**
 * What the setup panel can show about the enemy before the fleet is built:
 * budget (formula), what it can really buy (`spendable`, 40-ship cap),
 * builder, preset, AI profile and bosses.
 * @param {{ level:number, difficulty:string }} setup
 * @param {number} [budget]
 */
export function spLevelInfo(setup, budget) {
  const s = normalizeSpSetup(setup);
  const level = levelInfo(s.level);
  const base = Number.isFinite(budget) && budget > 0 ? budget : spBudgetPoints(s);
  const info = enemyBudgetInfo(level, s.difficulty, base);
  return {
    level, difficulty: s.difficulty,
    enemyBudget: info.budget, enemySpendable: info.spendable, budgetCapped: info.capped, budgetMul: info.mul,
    builder: levelBuilder(level, s.difficulty),
    preset: level.preset && PRESETS[level.preset] ? PRESETS[level.preset] : null,
    enemyAi: levelEnemyAi(level, s.difficulty),
    bosses: info.factions.flatMap((f) => levelMustInclude(level, f)),
  };
}

/**
 * Build the BattleConfig for a single-player battle.
 * @param {Object} o
 * @param {{ level:number, difficulty:string, teamSize:number, allyDifficulty:string }} o.setup
 * @param {import('/shared/fleet.js').Fleet} o.playerFleet   validated
 * @param {string} o.playerName
 * @param {string|number} o.seed
 * @param {number} [o.budget]
 * @returns {{ config: object, meta: object }}
 */
export function buildSpConfig(o) {
  const setup = normalizeSpSetup(o.setup);
  const budget = Number.isFinite(o.budget) && o.budget > 0 ? o.budget : spBudgetPoints(setup);
  const v = validateFleet(o.playerFleet, budget);
  if (!v.ok) throw Object.assign(new Error(`invalid player fleet: ${v.code}`), { code: v.code, detail: v.detail });
  const playerFleet = v.fleet;
  const seed = o.seed === undefined || o.seed === null || o.seed === '' ? 1 : o.seed;
  const rng = createRng(`${seed}:setup`);
  const level = levelInfo(setup.level);
  const eBudget = enemyBudget(level, setup.difficulty, budget);
  const builder = levelBuilder(level, setup.difficulty);
  const enemyAi = levelEnemyAi(level, setup.difficulty);
  const names = rng.shuffle(BOT_NAMES.slice());
  let nameIdx = 0;
  const nextName = () => names[nameIdx++ % names.length];

  const players = [{ id: 'p1', name: o.playerName || 'Comandante', team: 0, isBot: false, fleet: playerFleet, ai: 'especialista' }];
  const allyFleets = [];
  for (let i = 1; i < setup.teamSize; i++) {
    const fleet = buildBotFleet({ budget, difficulty: setup.allyDifficulty, rng, faction: rng.pick(FACTION_IDS) });
    allyFleets.push(fleet);
    players.push({ id: `bot_a${i}`, name: nextName(), team: 0, isBot: true, fleet, ai: setup.allyDifficulty });
  }
  const ourFleets = [playerFleet, ...allyFleets];
  const fixedFaction = FACTION_IDS.includes(level.enemyFaction) ? level.enemyFaction : null;
  const enemyFactions = [];
  let enemySpent = 0;
  for (let i = 0; i < setup.teamSize; i++) {
    const faction = fixedFaction || levelEnemyFaction(level, rng);
    const mustInclude = i === 0 ? levelMustInclude(level, faction) : [];
    const fleet = buildBotFleet({
      budget: eBudget, difficulty: setup.difficulty, rng, faction, builder, presetId: levelPreset(level, faction),
      enemyFleets: ourFleets, mustInclude,
    });
    enemyFactions.push(faction);
    enemySpent += fleetCost(fleet);
    players.push({ id: `bot_e${i + 1}`, name: nextName(), team: 1, isBot: true, fleet, ai: enemyAi });
  }
  const config = { seed, players };
  const meta = {
    mode: 'sp', setup, level, enemyBudget: eBudget, enemySpent: Math.round(enemySpent / setup.teamSize), enemyAi, builder,
    budget, seed, enemyFactions, playerFleet,
  };
  return { config, meta };
}

/**
 * Resolve the autotest URL parameters into a setup + fleet.
 * @param {{ level?: number|null, difficulty?: string|null, faction?: string|null, preset?: string|null, team?: number|null, ally?: string|null }} p
 * @returns {{ setup: object, fleet: object, presetId: string }}
 */
export function autotestSetup(p, budget = DEFAULT_BUDGET) {
  const faction = FACTION_IDS.includes(p.faction) ? p.faction : 'terran';
  let presetId = p.preset && PRESETS[p.preset] && PRESETS[p.preset].faction === faction ? p.preset : null;
  if (!presetId) presetId = presetsOfFaction(faction)[0].id;
  const fleet = presetFleet(presetId, budget);
  const budgetId = SP_BUDGET_IDS.find((id) => BUDGETS[id].points === budget) || DEFAULT_SP_BUDGET;
  const setup = normalizeSpSetup({ level: p.level ?? 1, difficulty: p.difficulty ?? 'normal', teamSize: p.team ?? 1, allyDifficulty: p.ally ?? 'normal', budget: budgetId });
  return { setup, fleet, presetId };
}
