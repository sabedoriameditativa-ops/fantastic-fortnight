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
    saveSettings({ ...DEFAULT_SETTINGS, speed: 4, quality: 'high' }, s);
    assert.equal(loadSettings(s).speed, 4);
    assert.equal(loadSettings(s).quality, 'high');
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

// ---------------------------------------------------------------------------
// Progress schema v2: migration, records, stars, skirmish, options
// ---------------------------------------------------------------------------
import {
  normalizeProgress, levelRecord, levelStars, withLevelRecord, starsSummary, starsOnLevels, bestStars,
  skirmishRecord, withSkirmishResult, hasAnyProgress, defaultProgressOpts, normalizeProgressOpts,
  loadProgressOpts, saveProgressOpts, PROGRESS_VERSION,
} from '../../client/util/storage.js';

describe('progress v2 (stars, score, records)', () => {
  test('migrates the v1 shape: cleared levels become 1-star records, v1 keys stay readable', () => {
    const v1 = { normal: { max: 3, cleared: [1, 3] }, dificil: { max: 1, cleared: [1] } };
    const p = normalizeProgress(v1);
    assert.equal(p.v, PROGRESS_VERSION);
    assert.deepEqual(p.normal, { max: 3, cleared: [1, 3] });
    assert.deepEqual(p.records.normal, { 1: { stars: 1, score: 0, ticks: 0, at: 0 }, 3: { stars: 1, score: 0, ticks: 0, at: 0 } });
    assert.deepEqual(p.records.dificil, { 1: { stars: 1, score: 0, ticks: 0, at: 0 } });
    assert.deepEqual(p.skirmish, {});
    assert.equal(isLevelCleared(p, 'normal', 3), true);
    assert.equal(maxLevelCleared(p, 'normal'), 3);
    assert.deepEqual(bestProgress(p), { difficulty: 'normal', max: 3 });
    // idempotent and tolerant of junk
    assert.deepEqual(normalizeProgress(p), p);
    assert.deepEqual(normalizeProgress(null).records, {});
    assert.deepEqual(normalizeProgress([1]).skirmish, {});
    const junk = normalizeProgress({ normal: { max: 'x', cleared: [2, 'a', 0] }, records: { normal: { 2: { stars: 9, score: -5 }, x: { stars: 2 }, 5: { stars: 0 } } }, skirmish: { '2v2': { best: 12.6, wins: 'z' }, nope: { best: 1 } } });
    assert.deepEqual(junk.normal, { max: 2, cleared: [2] });
    assert.deepEqual(junk.records.normal, { 2: { stars: 3, score: 0, ticks: 0, at: 0 } });
    assert.deepEqual(junk.skirmish, { '2v2': { best: 13, wins: 0, played: 0 } });
    // withLevelCleared (v1 helper) keeps the v2 keys because they live beside the difficulty entries
    const q = withLevelCleared(p, 'normal', 4);
    assert.deepEqual(q.records, p.records);
    assert.equal(q.v, 2);
  });

  test('withLevelRecord keeps the best stars and best score independently and reports what is new', () => {
    let p = normalizeProgress({});
    let r = withLevelRecord(p, 'normal', 2, { stars: 2, score: 1500, ticks: 900, at: 10 });
    assert.equal(r.newStars, true); assert.equal(r.newScore, true); assert.equal(r.prev, null);
    assert.equal(isLevelCleared(r.progress, 'normal', 2), true);
    assert.deepEqual(levelRecord(r.progress, 'normal', 2), { stars: 2, score: 1500, ticks: 900, at: 10 });
    p = r.progress;
    // more stars, lower score: stars update, score stays
    r = withLevelRecord(p, 'normal', 2, { stars: 3, score: 900, ticks: 500, at: 20 });
    assert.equal(r.newStars, true); assert.equal(r.newScore, false);
    assert.deepEqual(r.prev, { stars: 2, score: 1500, ticks: 900, at: 10 });
    assert.deepEqual(levelRecord(r.progress, 'normal', 2), { stars: 3, score: 1500, ticks: 500, at: 20 });
    p = r.progress;
    // worse on both: nothing changes
    r = withLevelRecord(p, 'normal', 2, { stars: 1, score: 100, ticks: 1, at: 30 });
    assert.equal(r.newStars, false); assert.equal(r.newScore, false);
    assert.deepEqual(levelRecord(r.progress, 'normal', 2), { stars: 3, score: 1500, ticks: 500, at: 20 });
    // invalid input is a no-op
    assert.equal(withLevelRecord(p, 'normal', 2, { stars: 0 }).progress, p);
    assert.equal(withLevelRecord(p, 'nope', 2, { stars: 1 }).progress, p);
    assert.equal(withLevelRecord(p, 'normal', 0, { stars: 1 }).progress, p);
    // a level cleared by the v1 helper (no record) reads as 1 star and is the 'prev' of a later record
    const c = withLevelCleared(normalizeProgress({}), 'facil', 5);
    assert.equal(levelStars(c, 'facil', 5), 1);
    assert.deepEqual(withLevelRecord(c, 'facil', 5, { stars: 2, score: 10, ticks: 1, at: 1 }).prev, { stars: 1, score: 0, ticks: 0, at: 0 });
    assert.equal(levelStars(c, 'facil', 6), 0);
    assert.equal(levelRecord(c, 'facil', 6), null);
  });

  test('stars summaries: per difficulty over 1..15, per level set over all difficulties, best difficulty', () => {
    let p = normalizeProgress({});
    for (const [d, n, stars] of [['normal', 1, 3], ['normal', 2, 2], ['normal', 16, 3], ['facil', 1, 1], ['dificil', 4, 2]]) p = withLevelRecord(p, d, n, { stars, score: 1, ticks: 1, at: 1 }).progress;
    assert.deepEqual(starsSummary(p, 'normal'), { stars: 5, total: 45, cleared: 2 }); // endless L16 is not part of the 45
    assert.deepEqual(starsSummary(p, 'facil'), { stars: 1, total: 45, cleared: 1 });
    assert.deepEqual(starsSummary(p, 'especialista'), { stars: 0, total: 45, cleared: 0 });
    assert.equal(starsOnLevels(p, [1, 2, 3]), 3 + 2 + 1);
    assert.equal(starsOnLevels(p, [4, 5, 6]), 2);
    assert.deepEqual(bestStars(p), { difficulty: 'normal', stars: 5, total: 45, cleared: 2 });
    assert.equal(bestStars(normalizeProgress({})), null);
    assert.equal(hasAnyProgress(p), true);
    assert.equal(hasAnyProgress(normalizeProgress({})), false);
  });

  test('skirmish records per team format: best score on wins, wins and played counters', () => {
    const p = normalizeProgress({ normal: { max: 2, cleared: [1, 2] } });
    let r = withSkirmishResult(p, '2v2', { won: false, score: 900 });
    assert.equal(r.newRecord, false);
    assert.deepEqual(skirmishRecord(r.progress, '2v2'), { best: 0, wins: 0, played: 1 });
    r = withSkirmishResult(r.progress, '2v2', { won: true, score: 900 });
    assert.equal(r.newRecord, true);
    assert.deepEqual(skirmishRecord(r.progress, '2v2'), { best: 900, wins: 1, played: 2 });
    r = withSkirmishResult(r.progress, '2v2', { won: true, score: 500 });
    assert.equal(r.newRecord, false);
    assert.deepEqual(skirmishRecord(r.progress, '2v2'), { best: 900, wins: 2, played: 3 });
    assert.deepEqual(r.progress.records, p.records, 'the campaign is untouched');
    assert.equal(skirmishRecord(r.progress, '3v3'), null);
    assert.equal(withSkirmishResult(p, '1v1', { won: true, score: 1 }).progress, p, '1v1 is the campaign, never a skirmish');
    const s = memoryStore();
    saveProgress(r.progress, s);
    assert.deepEqual(loadProgress(s), r.progress);
  });

  test('progress options: gating on by default, full arsenal only for profiles that already had progress', () => {
    assert.deepEqual(defaultProgressOpts(normalizeProgress({})), { gating: true, fullArsenal: false });
    assert.deepEqual(defaultProgressOpts(normalizeProgress({ facil: { max: 1, cleared: [1] } })), { gating: true, fullArsenal: true });
    assert.deepEqual(normalizeProgressOpts({ gating: false }, normalizeProgress({})), { gating: false, fullArsenal: false });
    assert.deepEqual(normalizeProgressOpts({ fullArsenal: 'yes' }, normalizeProgress({})), { gating: true, fullArsenal: false });
    const s = memoryStore();
    const veteran = normalizeProgress({ normal: { max: 7, cleared: [1, 2, 3, 4, 5, 6, 7] } });
    assert.deepEqual(loadProgressOpts(veteran, s), { gating: true, fullArsenal: true });
    saveProgressOpts({ gating: false, fullArsenal: false }, s);
    assert.deepEqual(loadProgressOpts(veteran, s), { gating: false, fullArsenal: false }, 'a stored choice wins over the defaults');
    assert.equal(KEYS.progressOpts, 'fe.progressOpts');
  });
});
