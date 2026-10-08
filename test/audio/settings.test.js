import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_hook.mjs', import.meta.url);
const { makeEngine, memoryStorage } = await import('./mockAudioContext.js');
const { SETTINGS_KEY, DEFAULT_SETTINGS, normalizeAudioSettings } = await import('../../client/audio/index.js');

describe('audio settings persistence', () => {
  test('setVolume / setMuted persist to localStorage under frotaEstelar.audio.v1', async () => {
    const storage = memoryStorage();
    const { engine } = await makeEngine({ storage });
    engine.setVolume('music', 0.35);
    engine.setMuted(true);
    const saved = JSON.parse(storage.getItem(SETTINGS_KEY));
    assert.equal(saved.music, 0.35);
    assert.equal(saved.muted, true);
    assert.deepEqual(engine.getSettings(), { ...DEFAULT_SETTINGS, music: 0.35, muted: true });
  });

  test('a new engine reads the stored settings (even before init)', async () => {
    const storage = memoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ master: 0.1, sfx: 0.2, muted: true }));
    const { engine } = await makeEngine({ storage, init: false });
    const s = engine.getSettings();
    assert.equal(s.master, 0.1); assert.equal(s.sfx, 0.2); assert.equal(s.muted, true); assert.equal(s.music, DEFAULT_SETTINGS.music);
  });

  test('corrupt or out-of-range values fall back to defaults', async () => {
    const storage = memoryStorage();
    storage.setItem(SETTINGS_KEY, '{not json');
    const { engine } = await makeEngine({ storage });
    assert.deepEqual(engine.getSettings(), { ...DEFAULT_SETTINGS });
    assert.deepEqual(normalizeAudioSettings({ master: 7, music: -1, sfx: 'x', ui: null, muted: 'yes' }), { ...DEFAULT_SETTINGS, master: 1, music: 0, muted: true });
    assert.deepEqual(normalizeAudioSettings(42), { ...DEFAULT_SETTINGS });
    engine.setVolume('master', 5);
    assert.equal(engine.getSettings().master, 1);
    engine.setVolume('bogus', 0.5);
    assert.equal(engine.getSettings().bogus, undefined);
  });

  test('works without storage and with a throwing storage', async () => {
    const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const { engine } = await makeEngine({ storage: throwing });
    engine.setVolume('ui', 0.4);
    assert.equal(engine.getSettings().ui, 0.4);
    const { engine: e2 } = await makeEngine({ storage: null });
    e2.setMuted(true);
    assert.equal(e2.getSettings().muted, true);
  });

  test('theme and mix patches persist before a gesture without resetting volumes', async () => {
    const storage = memoryStorage();
    const { engine, ctx } = await makeEngine({ storage, init: false });
    engine.setVolume('music', 0.27);
    engine.setSettings({ musicTheme: 'arcade', soundProfile: 'tactical' });
    assert.equal(ctx.created.length, 0, 'settings do not create audio before a gesture');
    const { engine: restored } = await makeEngine({ storage });
    assert.deepEqual(restored.getSettings(), { ...DEFAULT_SETTINGS, music: 0.27, musicTheme: 'arcade', soundProfile: 'tactical' });
    restored.setScene('builder');
    assert.equal(restored.music.stats().musicTheme, 'arcade');
    restored.setSettings({ musicTheme: 'missing', soundProfile: 'missing' });
    assert.equal(restored.getSettings().music, 0.27);
    assert.equal(restored.getSettings().musicTheme, 'adventure');
    assert.equal(restored.getSettings().soundProfile, 'balanced');
  });
});
