import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseParams, roomLink, defaultWsUrl, randomSeed } from '../../client/util/url.js';

describe('url params', () => {
  test('parses the documented parameters', () => {
    const p = parseParams('?sala=ab3k&seed=42&debug=1&autotest=1&level=7&difficulty=dificil&faction=lumen&preset=lum_coro&speed=4&team=3');
    assert.equal(p.sala, 'AB3K');
    assert.equal(p.seed, '42');
    assert.equal(p.debug, true);
    assert.equal(p.autotest, true);
    assert.equal(p.level, 7);
    assert.equal(p.difficulty, 'dificil');
    assert.equal(p.faction, 'lumen');
    assert.equal(p.preset, 'lum_coro');
    assert.equal(p.speed, 4);
    assert.equal(p.team, 3);
  });

  test('defaults and bad values', () => {
    const p = parseParams('');
    assert.equal(p.sala, null); assert.equal(p.seed, null); assert.equal(p.debug, false); assert.equal(p.autotest, false);
    assert.equal(p.level, null); assert.equal(p.speed, null);
    assert.equal(parseParams('?debug=0&speed=3&level=abc').debug, false);
    assert.equal(parseParams('?speed=3').speed, null);
    assert.equal(parseParams('?level=abc').level, null);
    assert.equal(parseParams('?autotest=true').autotest, true);
  });

  test('room link and ws url', () => {
    assert.equal(roomLink('AB3K', { origin: 'https://x.io', pathname: '/' }), 'https://x.io/?sala=AB3K');
    assert.equal(roomLink('AB3K', { origin: 'http://h:3000', pathname: '/client/index.html' }), 'http://h:3000/client/index.html?sala=AB3K');
    assert.equal(defaultWsUrl({ protocol: 'https:', host: 'x.io' }), 'wss://x.io');
    assert.equal(defaultWsUrl({ protocol: 'http:', host: 'localhost:3000' }), 'ws://localhost:3000');
    assert.match(randomSeed(), /^\d+$/);
    assert.notEqual(randomSeed(), randomSeed());
  });
});
