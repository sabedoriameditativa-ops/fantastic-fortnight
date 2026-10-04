import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_sharedHook.mjs', import.meta.url);
const { createEventLog } = await import('../../client/util/eventLog.js');

const ships = {
  1: { cls: 'ter_prometeu', team: 0, owner: 'p1' },
  2: { cls: 'vor_zangao', team: 1, owner: 'bot_e1' },
  3: { cls: 'ter_vespa', team: 0, owner: 'p1', spawned: true },
  4: { cls: 'lum_catedral', team: 1, owner: 'bot_e1' },
  5: { cls: 'ter_vespa', team: 0, owner: 'p1' },
};
const names = { p1: 'Ana', bot_e1: 'Rex' };
const make = () => createEventLog({ lookup: (id) => ships[id], playerName: (id) => names[id], myPlayerId: 'p1', max: 6, ttlMs: 1000 });

describe('event log', () => {
  test('deaths, casts, shield breaks, phases and spawns in pt-BR', () => {
    const log = make();
    const added = log.push([
      ['phase', 'engage'],
      ['die', 2, 1, 0, 0],
      ['die', 3, 2, 0, 0],            // spawned unit: skipped
      ['die', 5, 0, 0, 0],            // no killer
      ['cast', 1, 'siege_protocol', 0, 0, 0],
      ['cast', 5, 'afterburner', 0, 0, 0], // tiny ship buff: skipped
      ['sbreak', 4],
      ['sbreak', 2],                  // small ship: skipped
      ['spawn', 10, 'ter_vespa', 0, 'p1', 0, 0, 0, 1], ['spawn', 11, 'ter_vespa', 0, 'p1', 0, 0, 0, 1],
      ['phase', 'suddenDeath'],
    ], 100);
    const texts = added.map((e) => e.text);
    // 7 lines were produced; the log keeps the last 6 (the 'engage' line fell off)
    assert.deepEqual(texts, [
      'Zangão de Rex destruída por Nave-Mãe Prometeu (você)',
      'Interceptador Vespa de você foi destruída',
      'Nave-Mãe Prometeu de você ativou Protocolo de Cerco',
      'Escudo de Catedral (Rex) rompido',
      'Morte súbita: regeneração desligada, dano crescente.',
      'você lançou 2× Interceptador Vespa',
    ]);
    assert.equal(added[0].team, 1);
    assert.equal(added[1].team, 0);
    assert.equal(added[4].team, -1);
    assert.equal(log.entries(100).length, 6, 'capped at max');
  });

  test('throttles repeated casts and expires entries', () => {
    const log = make();
    log.push([['cast', 1, 'siege_protocol', 0, 0, 0]], 0);
    log.push([['cast', 1, 'siege_protocol', 0, 0, 0]], 500);
    assert.equal(log.entries(500).length, 1, 'same cast within 8 s is not repeated');
    log.push([['cast', 1, 'siege_protocol', 0, 0, 0]], 9000);
    assert.equal(log.entries(9000).length, 1, 'older entry expired (ttl 1 s), new one present');
    log.clear();
    assert.equal(log.entries(9000).length, 0);
  });

  test('unknown ids are ignored', () => {
    const log = make();
    assert.deepEqual(log.push([['die', 99, 1, 0, 0], ['cast', 99, 'blink', 0, 0, 0], ['hit', 1, 5, 'laser', 0]], 0), []);
  });
});
