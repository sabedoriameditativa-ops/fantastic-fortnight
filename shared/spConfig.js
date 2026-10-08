// Single-player battle configuration: the player's fleet (AI 'especialista'),
// ally bots (chosen difficulty, random factions) and enemy bots per level and
// difficulty (levels.js enemyBudget, builder from the profile, boss
// mustInclude). Deterministic given the seed. Pure (no DOM).

import { DEFAULT_BUDGET, TEAM_SIZES, DIFFICULTIES } from './constants.js';
import { FACTION_IDS, presetsOfFaction, PRESETS } from './catalog.js';
import { createRng } from './rng.js';
import { presetFleet, validateFleet } from './fleet.js';
import { buildBotFleet } from './botFleet.js';
import { BOT_PERSONALITY_IDS } from './aiProfiles.js';
import { PILOT_COST, SPECIAL_SHIPS } from './pilot.js';
import { levelInfo, enemyBudget, levelBuilder, levelEnemyFaction, levelMustInclude, levelCampaign } from './levels.js';

export const BOT_NAMES = [
  'Almirante Kael', 'Capitã Ysolde', 'Comodoro Brax', 'Nyx-7', 'Tenente Orin', 'Vashti', 'Rook', 'Mestre Ilun',
  'Zéfiro', 'Dra. Mirren', 'Sargento Tolk', 'Oráculo-3', 'Capitão Deren', 'Selene', 'Krast', 'Comandante Vale',
];

export const DEFAULT_SP_SETUP = Object.freeze({ level: 1, difficulty: 'normal', teamSize: 1, allyDifficulty: 'normal', resourceMul: 1, botPersonality: 'varied' });

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
    if (Number.isFinite(raw.resourceMul)) s.resourceMul = Math.max(0.5, Math.min(2, raw.resourceMul));
    if (BOT_PERSONALITY_IDS.includes(raw.botPersonality)) s.botPersonality = raw.botPersonality;
  }
  return s;
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
  const budget = Number.isFinite(o.budget) && o.budget > 0 ? o.budget : DEFAULT_BUDGET;
  const pilot = o.playerFleet?.pilot === true;
  if (pilot && !SPECIAL_SHIPS[o.playerFleet.faction]) throw new Error('Nave especial indisponível para esta facção');
  const fleetBudget = budget - (pilot ? PILOT_COST : 0);
  const v = validateFleet(o.playerFleet, fleetBudget);
  if (!v.ok) throw Object.assign(new Error(`invalid player fleet: ${v.code}`), { code: v.code, detail: v.detail });
  const playerFleet = v.fleet;
  const seed = o.seed === undefined || o.seed === null || o.seed === '' ? 1 : o.seed;
  const rng = createRng(`${seed}:setup`);
  const level = levelInfo(setup.level);
  const eBudget = enemyBudget(level, setup.difficulty, budget, setup.resourceMul);
  const campaign = levelCampaign(level);
  // The displayed mission budget includes every wave, not a hidden extra allowance.
  const initialBudget = Math.floor(eBudget / (1 + (campaign.waveCount - 1) * campaign.reinforcementFraction));
  const builder = levelBuilder(level, setup.difficulty);
  const names = rng.shuffle(BOT_NAMES.slice());
  let nameIdx = 0;
  const nextName = () => names[nameIdx++ % names.length];
  const personalities = rng.shuffle(BOT_PERSONALITY_IDS.slice());
  let personalityIdx = 0;
  const nextPersonality = () => setup.botPersonality === 'varied'
    ? personalities[personalityIdx++ % personalities.length] : setup.botPersonality;

  const players = [{ id: 'p1', name: o.playerName || 'Comandante', team: 0, isBot: false, fleet: playerFleet, ai: 'especialista', ...(pilot ? { pilot: true } : {}) }];
  const allyFleets = [];
  for (let i = 1; i < setup.teamSize; i++) {
    const personality = nextPersonality();
    const fleet = buildBotFleet({ budget, difficulty: setup.allyDifficulty, rng, faction: rng.pick(FACTION_IDS), personality });
    allyFleets.push(fleet);
    players.push({ id: `bot_a${i}`, name: nextName(), team: 0, isBot: true, fleet, ai: setup.allyDifficulty, personality });
  }
  const ourFleets = [playerFleet, ...allyFleets];
  const fixedFaction = FACTION_IDS.includes(level.enemyFaction) ? level.enemyFaction : null;
  const enemyFactions = [];
  for (let i = 0; i < setup.teamSize; i++) {
    const faction = fixedFaction || levelEnemyFaction(level, rng);
    const mustInclude = i === 0 ? levelMustInclude(level, faction) : [];
    const personality = nextPersonality();
    const fleet = buildBotFleet({ budget: initialBudget, difficulty: setup.difficulty, rng, faction, builder, enemyFleets: ourFleets, mustInclude, personality });
    enemyFactions.push(faction);
    players.push({ id: `bot_e${i + 1}`, name: nextName(), team: 1, isBot: true, fleet, ai: setup.difficulty, personality });
  }
  const config = { seed, players, campaign };
  const meta = { mode: 'sp', setup, level, enemyBudget: eBudget, enemyInitialBudget: initialBudget, builder, budget, fleetBudget, pilot, seed, enemyFactions, playerFleet };
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
  const setup = normalizeSpSetup({ level: p.level ?? 1, difficulty: p.difficulty ?? 'normal', teamSize: p.team ?? 1, allyDifficulty: p.ally ?? 'normal' });
  return { setup, fleet, presetId };
}
