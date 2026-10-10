import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS, levelInfo, enemyBudget, effectiveBudgetMul, enemyBudgetInfo, levelBuilder, levelPreset, levelEnemyAi,
  levelEnemyFaction, levelMustInclude, AI_PROFILES, HUMAN_AI_PROFILE, LAST_AUTHORED_LEVEL, ENDLESS_BUDGET_BASE, ENDLESS_BUDGET_STEP,
} from '../../shared/levels.js';
import { AI_PROFILES as PROFILES_SRC } from '../../shared/aiProfiles.js';
import { DIFFICULTIES, DEFAULT_BUDGET, FLEET_LIMITS } from '../../shared/constants.js';
import { FACTION_IDS, SHIPS, PRESETS } from '../../shared/catalog.js';
import { maxFleetValue } from '../../shared/fleet.js';
import { createRng } from '../../shared/rng.js';

describe('LEVELS', () => {
  test('15 entries numbered 1..15 with pt-BR names and descriptions', () => {
    assert.equal(LEVELS.length, 15);
    LEVELS.forEach((l, i) => {
      assert.equal(l.n, i + 1);
      assert.ok(typeof l.name === 'string' && l.name.length >= 3);
      assert.ok(typeof l.desc === 'string' && l.desc.length >= 20);
      assert.ok(l.enemyFaction === 'random' || FACTION_IDS.includes(l.enemyFaction), `${l.n}: faction`);
      assert.ok(l.enemyBudgetMul > 0 && l.enemyBudgetMul <= 1.1, `${l.n}: level multiplier ${l.enemyBudgetMul} stays ≤ 1.1 (the ramp is AI, composition and bosses)`);
      assert.ok(['random', 'preset', 'counter'].includes(l.builder), `${l.n}: every authored level names its builder`);
      if (l.boss) assert.ok(SHIPS[l.boss] && SHIPS[l.boss].faction === l.enemyFaction, `${l.n}: boss ${l.boss}`);
      if (l.preset) assert.ok(PRESETS[l.preset] && PRESETS[l.preset].faction === l.enemyFaction, `${l.n}: preset ${l.preset} belongs to ${l.enemyFaction}`);
      if (l.builder === 'preset') assert.ok(l.preset, `${l.n}: a preset level says which preset (its description must hold on every difficulty)`);
      if (l.aiTier !== undefined) assert.ok(Number.isInteger(l.aiTier) && Math.abs(l.aiTier) <= 1, `${l.n}: aiTier`);
    });
  });

  test('matches SPEC §4 (factions, multipliers, builders, presets, bosses, AI tiers)', () => {
    const spec = [
      ['Primeiro Contato', 'terran', 0.65, 'random'],
      ['Patrulha de Fronteira', 'terran', 0.75, 'preset', 'ter_misseis'],
      ['Bloqueio Orbital', 'terran', 0.85, 'preset', 'ter_atlas', 'ter_hercules'],
      ['Ninho Vorrax', 'vorrax', 0.85, 'preset', 'vor_mare'],
      ['Maré Viva', 'vorrax', 0.9, 'preset', 'vor_chuva'],
      ['A Rainha Desperta', 'vorrax', 0.95, 'preset', 'vor_garras', 'vor_rainha'],
      ['Luz Distante', 'lumen', 0.95, 'preset', 'lum_dissonancia'],
      ['Coro de Cristal', 'lumen', 1.0, 'preset', 'lum_coro'],
      ['Catedral Errante', 'lumen', 1.0, 'preset', 'lum_catedral', 'lum_catedral'],
      ['Sinal Ferrix', 'ferrix', 1.0, 'preset', 'fer_fabrica'],
      ['Linha de Ferro', 'ferrix', 1.0, 'preset', 'fer_ferro'],
      ['Mente Primária', 'ferrix', 1.0, 'preset', 'fer_apagao', 'fer_mente'],
      ['Aliança Rompida', 'random', 1.0, 'counter', undefined, undefined, 1],
      ['Armada Negra', 'random', 1.0, 'counter', undefined, undefined, 1],
      ['Fim dos Tempos', 'random', 1.0, 'counter', undefined, undefined, 1],
    ];
    spec.forEach(([name, faction, mul, builder, preset, boss, aiTier], i) => {
      const l = LEVELS[i];
      assert.equal(l.name, name);
      assert.equal(l.enemyFaction, faction);
      assert.equal(l.enemyBudgetMul, mul);
      assert.equal(l.builder, builder);
      assert.equal(l.preset, preset);
      assert.equal(l.boss, boss);
      assert.equal(l.aiTier, aiTier);
    });
    assert.equal(LEVELS[13].bossSizeClass, 'capital');
    assert.equal(LEVELS[14].bossSizeClass, 'mothership');
    // the counter builder is reserved for the finale (L13+) and endless
    for (const l of LEVELS) assert.equal(l.builder === 'counter', l.n >= 13, `${l.n}: counter only from L13`);
  });

  test('budget multipliers are non-decreasing along the ladder and every faction block is visited in order', () => {
    for (let i = 1; i < LEVELS.length; i++) assert.ok(LEVELS[i].enemyBudgetMul >= LEVELS[i - 1].enemyBudgetMul, `${i}→${i + 1}`);
    assert.ok(LEVELS[14].enemyBudgetMul > LEVELS[0].enemyBudgetMul);
    assert.deepEqual(LEVELS.map((l) => l.enemyFaction), [
      'terran', 'terran', 'terran', 'vorrax', 'vorrax', 'vorrax', 'lumen', 'lumen', 'lumen', 'ferrix', 'ferrix', 'ferrix', 'random', 'random', 'random',
    ]);
  });
});

describe('levelInfo', () => {
  test('levels 1..20 are sane; endless scaling beyond 15', () => {
    for (let n = 1; n <= 20; n++) {
      const l = levelInfo(n);
      assert.equal(l.n, n);
      assert.ok(l.name.length > 0 && l.desc.length > 0);
      if (n <= LAST_AUTHORED_LEVEL) {
        assert.deepEqual(l, LEVELS[n - 1]);
        assert.notEqual(l, LEVELS[n - 1], 'returns a copy');
      } else {
        assert.equal(l.enemyFaction, 'random');
        assert.equal(l.builder, 'counter');
        assert.equal(l.bossSizeClass, 'mothership');
        assert.equal(l.aiTier, 1);
        assert.ok(Math.abs(l.enemyBudgetMul - (ENDLESS_BUDGET_BASE + ENDLESS_BUDGET_STEP * (n - 15))) < 1e-9, `${n}: ${l.enemyBudgetMul}`);
        assert.ok(l.name.includes(String(n - 15)));
      }
    }
    assert.equal(levelInfo(16).enemyBudgetMul, 1.05);
    assert.equal(levelInfo(25).enemyBudgetMul, 1.5);
    // endless continues from the finale: no jump at L16
    assert.ok(levelInfo(16).enemyBudgetMul - LEVELS[14].enemyBudgetMul <= ENDLESS_BUDGET_STEP + 1e-9);
  });

  test('clamps bad input to level 1', () => {
    assert.equal(levelInfo(0).n, 1);
    assert.equal(levelInfo(-3).n, 1);
    assert.equal(levelInfo(NaN).n, 1);
    assert.equal(levelInfo('7').n, 7);
    assert.equal(levelInfo(7.9).n, 7);
  });
});

describe('effectiveBudgetMul / enemyBudget', () => {
  test('min(level × profile.budgetMul, profile.budgetCap) rounded to 3 decimals', () => {
    for (const d of DIFFICULTIES) {
      const p = AI_PROFILES[d];
      for (let n = 1; n <= LAST_AUTHORED_LEVEL; n++) {
        const expected = Math.round(Math.min(levelInfo(n).enemyBudgetMul * p.budgetMul, p.budgetCap) * 1000) / 1000;
        assert.equal(effectiveBudgetMul(n, d), expected, `${n}/${d}`);
        assert.equal(enemyBudget(n, d), Math.round(DEFAULT_BUDGET * expected));
      }
    }
    assert.equal(enemyBudget(8, 'normal'), 1500);
    assert.equal(enemyBudget(levelInfo(8), 'normal'), 1500);
    assert.equal(enemyBudget(3, 'normal', 800), Math.round(800 * 0.85));
    assert.equal(enemyBudget(3, 'normal', 0), Math.round(DEFAULT_BUDGET * 0.85));
    // unknown difficulty → normal knobs
    assert.equal(enemyBudget(2, 'nope'), enemyBudget(2, 'normal'));
  });

  test('the effective enemy budget is capped per difficulty: ≤ 1.10× on Normal, 1.15× Difícil, 1.25× Especialista for every authored level', () => {
    const caps = { facil: 1.0, normal: 1.1, dificil: 1.15, especialista: 1.25 };
    for (const d of DIFFICULTIES) {
      assert.equal(AI_PROFILES[d].budgetCap, caps[d]);
      for (let n = 1; n <= LAST_AUTHORED_LEVEL; n++) assert.ok(effectiveBudgetMul(n, d) <= caps[d] + 1e-9, `${n}/${d}: ${effectiveBudgetMul(n, d)}`);
      // endless: the cap lifts by ENDLESS_BUDGET_STEP per wave, never more
      for (let n = 16; n <= 60; n++) assert.ok(effectiveBudgetMul(n, d) <= caps[d] + ENDLESS_BUDGET_STEP * (n - 15) + 1e-9, `${n}/${d}`);
    }
  });

  test('the curve is monotonic: non-decreasing along the ladder, non-decreasing in difficulty, strictly growing in endless', () => {
    for (const d of DIFFICULTIES) {
      for (let n = 2; n <= 40; n++) assert.ok(effectiveBudgetMul(n, d) >= effectiveBudgetMul(n - 1, d), `${d} ${n - 1}→${n}`);
      for (let n = 16; n <= 40; n++) assert.ok(enemyBudget(n, d) > enemyBudget(n - 1, d), `${d} endless ${n}`);
    }
    for (let n = 1; n <= 40; n++) {
      const b = DIFFICULTIES.map((d) => enemyBudget(n, d));
      for (let i = 1; i < b.length; i++) assert.ok(b[i] >= b[i - 1], `level ${n}: ${b}`);
      assert.ok(b[0] < b[b.length - 1], `level ${n}: facil < especialista`);
      assert.ok(b[0] >= 400, `level ${n} facil budget ${b[0]} buys a fleet`);
    }
    // the opening is a real fight on every difficulty: L1 is at least 65% of the player's budget on Normal
    assert.ok(enemyBudget(1, 'normal') >= DEFAULT_BUDGET * 0.65);
    // ...and the finale never outspends the player by more than the cap
    assert.ok(enemyBudget(15, 'normal') <= DEFAULT_BUDGET * 1.1);
    assert.ok(enemyBudget(15, 'especialista') <= DEFAULT_BUDGET * 1.25);
  });

  test('every boss is affordable at every difficulty of its level', () => {
    for (const l of LEVELS) {
      if (!l.boss) continue;
      for (const d of DIFFICULTIES) assert.ok(enemyBudget(l, d) >= SHIPS[l.boss].cost * 1.5, `${l.n}/${d}`);
    }
    for (const d of DIFFICULTIES) assert.ok(enemyBudget(15, d) >= 520 * 1.5);
  });

  test('enemyBudgetInfo reports what the budget can really buy (40-ship cap)', () => {
    const info = enemyBudgetInfo(8, 'normal');
    assert.deepEqual(info, { budget: 1500, mul: 1, spendable: 1500, capped: false, factions: ['lumen'] });
    const far = enemyBudgetInfo(60, 'especialista');
    assert.deepEqual(far.factions, FACTION_IDS);
    assert.ok(far.budget > far.spendable, 'deep endless outgrows the roster');
    assert.equal(far.capped, true);
    assert.equal(far.spendable, Math.max(...FACTION_IDS.map((f) => maxFleetValue(f))));
    assert.ok(far.spendable <= FLEET_LIMITS.maxShips * 520);
    const fixed = enemyBudgetInfo(12, 'facil', 800);
    assert.equal(fixed.budget, enemyBudget(12, 'facil', 800));
    assert.equal(fixed.spendable, fixed.budget);
    assert.equal(fixed.capped, false);
  });
});

describe('helpers', () => {
  test('levelBuilder is the level builder on every difficulty (legacy auto → the profile builder)', () => {
    for (const d of DIFFICULTIES) {
      assert.equal(levelBuilder(1, d), 'random');
      assert.equal(levelBuilder(2, d), 'preset');
      assert.equal(levelBuilder(12, d), 'preset');
      assert.equal(levelBuilder(13, d), 'counter');
      assert.equal(levelBuilder(99, d), 'counter');
    }
    assert.equal(levelBuilder({ n: 1, builder: 'auto' }, 'facil'), 'random');
    assert.equal(levelBuilder({ n: 1, builder: 'auto' }, 'especialista'), 'counter');
  });

  test('levelPreset returns the preset for the resolved faction only', () => {
    assert.equal(levelPreset(2, 'terran'), 'ter_misseis');
    assert.equal(levelPreset(8, 'lumen'), 'lum_coro');
    assert.equal(levelPreset(8, 'terran'), null);
    assert.equal(levelPreset(13, 'terran'), null);
    assert.equal(levelPreset(1, 'terran'), null);
  });

  test('levelEnemyAi shifts the difficulty by aiTier, clamped to the ends', () => {
    assert.equal(levelEnemyAi(1, 'normal'), 'normal');
    assert.equal(levelEnemyAi(12, 'dificil'), 'dificil');
    assert.equal(levelEnemyAi(13, 'normal'), 'dificil');
    assert.equal(levelEnemyAi(13, 'facil'), 'normal');
    assert.equal(levelEnemyAi(15, 'dificil'), 'especialista');
    assert.equal(levelEnemyAi(15, 'especialista'), 'especialista');
    assert.equal(levelEnemyAi(20, 'especialista'), 'especialista');
    assert.equal(levelEnemyAi({ n: 1, aiTier: -1 }, 'facil'), 'facil');
    assert.equal(levelEnemyAi({ n: 1, aiTier: -1 }, 'especialista'), 'dificil');
    assert.equal(levelEnemyAi(13, 'nope'), 'dificil');
  });

  test('levelEnemyFaction resolves random via the rng, fixed otherwise', () => {
    assert.equal(levelEnemyFaction(4, createRng(1)), 'vorrax');
    const seen = new Set();
    for (let s = 0; s < 40; s++) seen.add(levelEnemyFaction(13, createRng(s)));
    assert.equal(seen.size, 4);
    assert.equal(levelEnemyFaction(13, createRng('a')), levelEnemyFaction(13, createRng('a')));
  });

  test('levelMustInclude returns the boss / the faction capital or mothership', () => {
    assert.deepEqual(levelMustInclude(3, 'terran'), ['ter_hercules']);
    assert.deepEqual(levelMustInclude(6, 'vorrax'), ['vor_rainha']);
    assert.deepEqual(levelMustInclude(6, 'terran'), []);
    assert.deepEqual(levelMustInclude(9, 'lumen'), ['lum_catedral']);
    assert.deepEqual(levelMustInclude(12, 'ferrix'), ['fer_mente']);
    assert.deepEqual(levelMustInclude(14, 'vorrax'), ['vor_rainha']);
    assert.deepEqual(levelMustInclude(14, 'ferrix'), ['fer_nucleo']);
    assert.deepEqual(levelMustInclude(15, 'terran'), ['ter_prometeu']);
    assert.deepEqual(levelMustInclude(15, 'lumen'), ['lum_luz_primordial']);
    assert.deepEqual(levelMustInclude(17, 'vorrax'), ['vor_colmeia']);
    assert.deepEqual(levelMustInclude(1, 'terran'), []);
  });

  test('re-exports the AI profiles; difficulty ramps through AI knobs with small budget steps', () => {
    assert.equal(AI_PROFILES, PROFILES_SRC);
    assert.equal(HUMAN_AI_PROFILE, AI_PROFILES.especialista);
    for (const d of DIFFICULTIES) assert.ok(AI_PROFILES[d].budgetMul > 0 && AI_PROFILES[d].budgetCap >= AI_PROFILES[d].budgetMul);
    for (let i = 1; i < DIFFICULTIES.length; i++) {
      const a = AI_PROFILES[DIFFICULTIES[i - 1]], b = AI_PROFILES[DIFFICULTIES[i]];
      assert.ok(b.budgetMul >= a.budgetMul && b.budgetCap > a.budgetCap, `${a.id}→${b.id}`);
      assert.ok(b.thinkInterval <= a.thinkInterval && b.scoreNoise <= a.scoreNoise, `${a.id}→${b.id}: AI gets sharper`);
    }
    assert.ok(AI_PROFILES.especialista.budgetMul <= 1.05, 'budget is not what makes Especialista hard');
  });
});
