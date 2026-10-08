import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS, levelInfo, enemyBudget, levelBuilder, levelEnemyFaction, levelMustInclude,
  AI_PROFILES, HUMAN_AI_PROFILE, LAST_AUTHORED_LEVEL,
} from '../../shared/levels.js';
import { AI_PROFILES as PROFILES_SRC } from '../../shared/aiProfiles.js';
import { DIFFICULTIES, DEFAULT_BUDGET } from '../../shared/constants.js';
import { FACTION_IDS, SHIPS } from '../../shared/catalog.js';
import { createRng } from '../../shared/rng.js';

describe('LEVELS', () => {
  test('15 entries numbered 1..15 with pt-BR names and descriptions', () => {
    assert.equal(LEVELS.length, 15);
    LEVELS.forEach((l, i) => {
      assert.equal(l.n, i + 1);
      assert.ok(typeof l.name === 'string' && l.name.length >= 3);
      assert.ok(typeof l.desc === 'string' && l.desc.length >= 20);
      assert.ok(l.enemyFaction === 'random' || FACTION_IDS.includes(l.enemyFaction), `${l.n}: faction`);
      assert.ok(l.enemyBudgetMul > 0 && l.enemyBudgetMul <= 1.5);
      assert.ok(['random', 'preset', 'counter', 'auto'].includes(l.builder));
      if (l.boss) assert.ok(SHIPS[l.boss] && SHIPS[l.boss].faction === l.enemyFaction, `${l.n}: boss ${l.boss}`);
    });
  });

  test('matches SPEC §4 (factions, multipliers, builders, bosses)', () => {
    const spec = [
      ['Primeiro Contato', 'terran', 0.5, 'random'], ['Patrulha de Fronteira', 'terran', 0.6], ['Bloqueio Orbital', 'terran', 0.7],
      ['Ninho Vorrax', 'vorrax', 0.7], ['Maré Viva', 'vorrax', 0.8], ['A Rainha Desperta', 'vorrax', 0.9, 'auto', 'vor_rainha'],
      ['Luz Distante', 'lumen', 0.85], ['Coro de Cristal', 'lumen', 0.95], ['Catedral Errante', 'lumen', 1.0, 'auto', 'lum_catedral'],
      ['Sinal Ferrix', 'ferrix', 0.95], ['Linha de Ferro', 'ferrix', 1.05], ['Mente Primária', 'ferrix', 1.15, 'auto', 'fer_mente'],
      ['Aliança Rompida', 'random', 1.2, 'counter'], ['Armada Negra', 'random', 1.3, 'counter'], ['Fim dos Tempos', 'random', 1.5, 'counter'],
    ];
    spec.forEach(([name, faction, mul, builder = 'auto', boss], i) => {
      const l = LEVELS[i];
      assert.equal(l.name, name);
      assert.equal(l.enemyFaction, faction);
      assert.equal(l.enemyBudgetMul, mul);
      assert.equal(l.builder, builder);
      assert.equal(l.boss, boss);
    });
    assert.equal(LEVELS[14].bossSizeClass, 'mothership');
  });

  test('budget multipliers are non-decreasing within each faction block and overall trend upward', () => {
    assert.ok(LEVELS[14].enemyBudgetMul > LEVELS[0].enemyBudgetMul);
    for (const [a, b] of [[0, 1], [1, 2], [3, 4], [4, 5], [6, 7], [7, 8], [9, 10], [10, 11], [12, 13], [13, 14]]) {
      assert.ok(LEVELS[b].enemyBudgetMul >= LEVELS[a].enemyBudgetMul, `${a + 1}→${b + 1}`);
    }
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
        assert.ok(Math.abs(l.enemyBudgetMul - (1.5 + 0.1 * (n - 15))) < 1e-9, `${n}: ${l.enemyBudgetMul}`);
        assert.ok(l.name.includes(String(n - 15)));
      }
    }
    assert.equal(levelInfo(16).enemyBudgetMul, 1.6);
    assert.equal(levelInfo(25).enemyBudgetMul, 2.5);
  });

  test('clamps bad input to level 1', () => {
    assert.equal(levelInfo(0).n, 1);
    assert.equal(levelInfo(-3).n, 1);
    assert.equal(levelInfo(NaN).n, 1);
    assert.equal(levelInfo('7').n, 7);
    assert.equal(levelInfo(7.9).n, 7);
  });
});

describe('enemyBudget', () => {
  test('round(base × levelMul × profile.budgetMul)', () => {
    // budgetMul per difficulty is a tuning knob (shared/aiProfiles.js); assert the formula, not the constants
    const mul = (d) => AI_PROFILES[d].budgetMul;
    assert.equal(enemyBudget(1, 'facil'), Math.round(1500 * 0.5 * mul('facil')));
    assert.equal(enemyBudget(1, 'normal'), Math.round(1500 * 0.5 * mul('normal')));
    assert.equal(enemyBudget(1, 'dificil'), Math.round(1500 * 0.5 * mul('dificil')));
    assert.equal(enemyBudget(1, 'especialista'), Math.round(1500 * 0.5 * mul('especialista')));
    assert.equal(enemyBudget(15, 'especialista'), Math.round(1500 * 1.5 * mul('especialista')));
    assert.equal(enemyBudget(9, 'normal'), 1500);
    assert.equal(enemyBudget(levelInfo(9), 'normal'), 1500);
    assert.equal(enemyBudget(3, 'normal', 800), Math.round(800 * 0.7));
    assert.equal(enemyBudget(3, 'normal', 0), Math.round(DEFAULT_BUDGET * 0.7));
    // unknown difficulty → normal knobs
    assert.equal(enemyBudget(2, 'nope'), 900);
  });

  test('difficulty changes intelligence, and only the explicit resource setting changes resources', () => {
    for (let n = 1; n <= 20; n++) {
      const b = DIFFICULTIES.map((d) => enemyBudget(n, d));
      for (let i = 1; i < b.length; i++) assert.equal(b[i], b[0], `level ${n}: ${b}`);
      assert.ok(b[0] >= 400, `level ${n} facil budget ${b[0]} buys a fleet`);
    }
    for (let n = 16; n <= 30; n++) assert.ok(enemyBudget(n, 'normal') > enemyBudget(n - 1, 'normal'));
    assert.equal(enemyBudget(9, 'facil', 1500, 1.5), 2250);
    assert.equal(enemyBudget(9, 'especialista', 1500, 0.5), 750);
    assert.equal(enemyBudget(9, 'normal', 1500, NaN), 1500);
    assert.equal(enemyBudget(9, 'normal', 1500, 100), 3000);
  });

  test('every boss is affordable at every difficulty of its level', () => {
    for (const l of LEVELS) {
      if (!l.boss) continue;
      for (const d of DIFFICULTIES) assert.ok(enemyBudget(l, d) >= SHIPS[l.boss].cost * 1.5, `${l.n}/${d}`);
    }
    for (const d of DIFFICULTIES) assert.ok(enemyBudget(15, d) >= 520 * 1.5);
  });
});

describe('helpers', () => {
  test('levelBuilder resolves auto to the difficulty builder', () => {
    assert.equal(levelBuilder(1, 'especialista'), 'random');
    assert.equal(levelBuilder(2, 'facil'), 'random');
    assert.equal(levelBuilder(2, 'normal'), 'preset');
    assert.equal(levelBuilder(2, 'dificil'), 'counter');
    assert.equal(levelBuilder(13, 'facil'), 'counter');
    assert.equal(levelBuilder(99, 'facil'), 'counter');
  });

  test('levelEnemyFaction resolves random via the rng, fixed otherwise', () => {
    assert.equal(levelEnemyFaction(4, createRng(1)), 'vorrax');
    const seen = new Set();
    for (let s = 0; s < 40; s++) seen.add(levelEnemyFaction(13, createRng(s)));
    assert.equal(seen.size, FACTION_IDS.length);
    assert.equal(levelEnemyFaction(13, createRng('a')), levelEnemyFaction(13, createRng('a')));
  });

  test('levelMustInclude returns the boss / the faction mothership', () => {
    assert.deepEqual(levelMustInclude(6, 'vorrax'), ['vor_rainha']);
    assert.deepEqual(levelMustInclude(6, 'terran'), []);
    assert.deepEqual(levelMustInclude(9, 'lumen'), ['lum_catedral']);
    assert.deepEqual(levelMustInclude(12, 'ferrix'), ['fer_mente']);
    assert.deepEqual(levelMustInclude(15, 'terran'), ['ter_prometeu']);
    assert.deepEqual(levelMustInclude(15, 'lumen'), ['lum_luz_primordial']);
    assert.deepEqual(levelMustInclude(17, 'vorrax'), ['vor_colmeia']);
    assert.deepEqual(levelMustInclude(1, 'terran'), []);
  });

  test('re-exports the AI profiles', () => {
    assert.equal(AI_PROFILES, PROFILES_SRC);
    assert.equal(HUMAN_AI_PROFILE, AI_PROFILES.especialista);
    for (const d of DIFFICULTIES) assert.ok(AI_PROFILES[d].budgetMul > 0);
  });
});
