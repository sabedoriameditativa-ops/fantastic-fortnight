import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_sharedHook.mjs', import.meta.url);
const { buildSpConfig, autotestSetup, normalizeSpSetup, spLevelInfo, DEFAULT_SP_SETUP } = await import('../../client/util/spConfig.js');
const { presetFleet, validateFleet, fleetCost } = await import('../../shared/fleet.js');
const { enemyBudget, levelInfo, levelEnemyAi } = await import('../../shared/levels.js');
const { createBattle } = await import('../../shared/sim/battle.js');
const { PRESETS, SHIPS } = await import('../../shared/catalog.js');

const fleet = presetFleet('ter_linha', 1500);

describe('normalizeSpSetup', () => {
  test('clamps everything to valid values', () => {
    assert.deepEqual(normalizeSpSetup(null), { ...DEFAULT_SP_SETUP });
    assert.deepEqual(normalizeSpSetup({ level: 0, difficulty: 'x', teamSize: 9, allyDifficulty: 'facil' }), { level: 1, difficulty: 'normal', teamSize: 1, allyDifficulty: 'facil' });
    assert.equal(normalizeSpSetup({ level: 42.7 }).level, 42);
  });
});

describe('buildSpConfig', () => {
  test('1v1: player + one enemy of the level faction with the level budget, the level preset and the level AI tier', () => {
    const { config, meta } = buildSpConfig({ setup: { level: 2, difficulty: 'dificil', teamSize: 1 }, playerFleet: fleet, playerName: 'Ana', seed: 'abc' });
    assert.equal(config.seed, 'abc');
    assert.equal(config.players.length, 2);
    const [p, e] = config.players;
    assert.equal(p.id, 'p1'); assert.equal(p.team, 0); assert.equal(p.isBot, false); assert.equal(p.ai, 'especialista'); assert.equal(p.name, 'Ana');
    assert.equal(e.team, 1); assert.equal(e.isBot, true); assert.equal(e.ai, levelEnemyAi(2, 'dificil'));
    assert.equal(e.fleet.faction, 'terran');
    const budget = enemyBudget(2, 'dificil', 1500);
    assert.equal(meta.enemyBudget, budget);
    assert.ok(validateFleet(e.fleet, budget).ok);
    assert.ok(e.name.length > 0 && e.name !== 'Ana');
    assert.equal(meta.level.n, 2);
    assert.equal(meta.builder, 'preset', 'the level names its builder on every difficulty');
    assert.equal(meta.enemyAi, 'dificil');
    assert.ok(e.fleet.ships.some((s) => s.cls === 'ter_orion' && s.count >= 3), 'L2 is Enxame de Mísseis-shaped (ter_misseis) on Difícil too');
    assert.equal(meta.enemySpent, fleetCost(e.fleet));
    assert.ok(meta.enemySpent <= budget && meta.enemySpent >= budget * 0.9);
    assert.doesNotThrow(() => createBattle(config));
    // L13+ shifts the enemy AI one tier up and uses the counter builder
    const r13 = buildSpConfig({ setup: { level: 13, difficulty: 'normal', teamSize: 1 }, playerFleet: fleet, playerName: 'Ana', seed: 'abc' });
    assert.equal(r13.config.players[1].ai, 'dificil');
    assert.equal(r13.meta.builder, 'counter');
    assert.equal(r13.meta.enemyAi, 'dificil');
  });

  test('spLevelInfo: what the setup panel shows (budget, real spendable value, builder, preset, AI, bosses)', () => {
    const l8 = spLevelInfo({ level: 8, difficulty: 'normal' });
    assert.equal(l8.enemyBudget, 1500);
    assert.equal(l8.enemySpendable, 1500);
    assert.equal(l8.budgetCapped, false);
    assert.equal(l8.builder, 'preset');
    assert.equal(l8.preset.id, 'lum_coro');
    assert.equal(l8.enemyAi, 'normal');
    assert.deepEqual(l8.bosses, []);
    const l15 = spLevelInfo({ level: 15, difficulty: 'especialista' });
    assert.equal(l15.builder, 'counter');
    assert.equal(l15.preset, null);
    assert.equal(l15.enemyAi, 'especialista');
    assert.deepEqual(l15.bosses.sort(), ['fer_mente', 'lum_luz_primordial', 'ter_prometeu', 'vor_colmeia']);
    const deep = spLevelInfo({ level: 60, difficulty: 'especialista' });
    assert.ok(deep.enemyBudget > deep.enemySpendable, 'deep endless: the panel should show what is really bought');
    assert.equal(deep.budgetCapped, true);
    assert.equal(deep.level.n, 60);
    assert.deepEqual(spLevelInfo({ level: 0, difficulty: 'x' }).level.n, 1);
  });

  test('3v3: two ally bots (ally difficulty, random factions) and three enemies', () => {
    const { config } = buildSpConfig({ setup: { level: 1, difficulty: 'facil', teamSize: 3, allyDifficulty: 'normal' }, playerFleet: fleet, playerName: 'Ana', seed: 5 });
    assert.equal(config.players.length, 6);
    const allies = config.players.filter((p) => p.team === 0 && p.isBot);
    const enemies = config.players.filter((p) => p.team === 1);
    assert.equal(allies.length, 2); assert.equal(enemies.length, 3);
    for (const a of allies) { assert.equal(a.ai, 'normal'); assert.ok(validateFleet(a.fleet, 1500).ok); }
    const ids = new Set(config.players.map((p) => p.id));
    assert.equal(ids.size, 6);
    const names = new Set(config.players.map((p) => p.name));
    assert.equal(names.size, 6, 'bot names are distinct');
    for (const e of enemies) { assert.equal(e.ai, 'facil'); assert.ok(fleetCost(e.fleet) <= enemyBudget(1, 'facil', 1500)); }
  });

  test('deterministic for a seed, different across seeds', () => {
    const a = buildSpConfig({ setup: { level: 13, difficulty: 'normal', teamSize: 2 }, playerFleet: fleet, playerName: 'A', seed: 'same' });
    const b = buildSpConfig({ setup: { level: 13, difficulty: 'normal', teamSize: 2 }, playerFleet: fleet, playerName: 'A', seed: 'same' });
    const c = buildSpConfig({ setup: { level: 13, difficulty: 'normal', teamSize: 2 }, playerFleet: fleet, playerName: 'A', seed: 'other' });
    assert.deepEqual(a.config, b.config);
    assert.notDeepEqual(a.config.players.slice(1), c.config.players.slice(1));
  });

  test('bosses: level 6 includes the Rainha, level 15 a mothership, endless levels too', () => {
    const l6 = buildSpConfig({ setup: { level: 6, difficulty: 'normal', teamSize: 2 }, playerFleet: fleet, playerName: 'A', seed: 1 });
    const enemies6 = l6.config.players.filter((p) => p.team === 1);
    assert.ok(enemies6[0].fleet.ships.some((s) => s.cls === 'vor_rainha'), 'first enemy has the boss');
    assert.ok(enemies6.every((p) => p.fleet.faction === 'vorrax'));
    for (const level of [15, 18]) {
      const r = buildSpConfig({ setup: { level, difficulty: 'especialista', teamSize: 1 }, playerFleet: fleet, playerName: 'A', seed: 3 });
      const e = r.config.players[1];
      assert.ok(e.fleet.ships.some((s) => SHIPS[s.cls].sizeClass === 'mothership'), `level ${level}: mothership guaranteed`);
      assert.equal(r.meta.enemyBudget, enemyBudget(levelInfo(level), 'especialista', 1500));
    }
  });

  test('rejects an invalid player fleet', () => {
    assert.throws(() => buildSpConfig({ setup: { level: 1 }, playerFleet: { faction: 'terran', ships: [] }, playerName: 'A', seed: 1 }), (e) => e.code === 'FLEET_SHIP_COUNT');
  });
});

describe('autotestSetup', () => {
  test('defaults to level 1 normal, first preset of the faction', () => {
    const r = autotestSetup({});
    assert.equal(r.presetId, 'ter_linha');
    assert.deepEqual(r.setup, { level: 1, difficulty: 'normal', teamSize: 1, allyDifficulty: 'normal' });
    assert.ok(validateFleet(r.fleet, 1500).ok);
  });
  test('honors faction/preset/level/difficulty/team and ignores a preset of another faction', () => {
    const r = autotestSetup({ faction: 'vorrax', preset: 'vor_garras', level: 6, difficulty: 'facil', team: 2, ally: 'dificil' });
    assert.equal(r.presetId, 'vor_garras');
    assert.equal(r.fleet.faction, 'vorrax');
    assert.deepEqual(r.setup, { level: 6, difficulty: 'facil', teamSize: 2, allyDifficulty: 'dificil' });
    assert.equal(autotestSetup({ faction: 'lumen', preset: 'ter_linha' }).presetId, Object.values(PRESETS).find((p) => p.faction === 'lumen').id);
  });
});
