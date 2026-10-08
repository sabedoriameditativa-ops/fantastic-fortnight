import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  memoryStore, readJson, writeJson, normalizeSettings, DEFAULT_SETTINGS, loadSettings, saveSettings,
  withLevelCleared, isLevelCleared, maxLevelCleared, bestProgress, loadProgress, saveProgress,
  loadName, saveName, loadLastFleet, saveLastFleet, KEYS,
} from '../../client/util/storage.js';

describe('storage helpers', () => {
  test('json read/write are guarded', () => {
    const s = memoryStore();
    assert.equal(readJson(s, 'x', 'fb'), 'fb');
    writeJson(s, 'x', { a: 1 });
    assert.deepEqual(readJson(s, 'x'), { a: 1 });
    s.setItem('x', '{broken');
    assert.equal(readJson(s, 'x', null), null);
    assert.equal(readJson(null, 'x', 7), 7);
    assert.equal(writeJson(null, 'x', 1), false);
    const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    assert.equal(readJson(throwing, 'x', 'fb'), 'fb');
    assert.equal(writeJson(throwing, 'x', 1), false);
  });

  test('settings normalize and round-trip', () => {
    assert.deepEqual(normalizeSettings(null), { ...DEFAULT_SETTINGS });
    const n = normalizeSettings({ master: 5, music: -1, sfx: '0.3', muted: 1, reducedMotion: 'weird', quality: 'low', speed: 3, showNames: 'yes' });
    assert.equal(n.master, 1); assert.equal(n.music, 0); assert.equal(n.sfx, 0.3); assert.equal(n.muted, true);
    assert.equal(n.reducedMotion, 'auto'); assert.equal(n.quality, 'low'); assert.equal(n.speed, 1); assert.equal(n.showNames, true);
    const s = memoryStore();
    saveSettings({ ...DEFAULT_SETTINGS, speed: 4, quality: 'high', reducedEffects: true, highContrast: true }, s);
    assert.equal(loadSettings(s).speed, 4);
    assert.equal(loadSettings(s).quality, 'high');
    assert.equal(loadSettings(s).reducedEffects, true);
    assert.equal(loadSettings(s).highContrast, true);
  });

  test('progress: cleared levels per difficulty, max and best', () => {
    let p = {};
    p = withLevelCleared(p, 'normal', 3);
    p = withLevelCleared(p, 'normal', 1);
    p = withLevelCleared(p, 'normal', 3);
    p = withLevelCleared(p, 'dificil', 2);
    p = withLevelCleared(p, 'normal', 'x');
    assert.deepEqual(p.normal, { max: 3, cleared: [1, 3] });
    assert.equal(isLevelCleared(p, 'normal', 3), true);
    assert.equal(isLevelCleared(p, 'normal', 2), false);
    assert.equal(maxLevelCleared(p, 'facil'), 0);
    assert.deepEqual(bestProgress(p), { difficulty: 'normal', max: 3 });
    assert.equal(bestProgress({}), null);
    const s = memoryStore();
    saveProgress(p, s);
    assert.deepEqual(loadProgress(s), p);
    s.setItem(KEYS.progress, '[1,2]');
    assert.deepEqual(loadProgress(s), {});
  });

  test('name and last fleet', () => {
    const s = memoryStore();
    assert.equal(loadName(s), '');
    saveName('Ana', s);
    assert.equal(loadName(s), 'Ana');
    assert.equal(loadLastFleet(s), null);
    saveLastFleet({ faction: 'terran', ships: [{ cls: 'ter_falcao', count: 1 }] }, s);
    assert.equal(loadLastFleet(s).faction, 'terran');
    s.setItem(KEYS.lastFleet, '"nope"');
    assert.equal(loadLastFleet(s), null);
  });
});
