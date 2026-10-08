import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_hook.mjs', import.meta.url);
const { MockAudioContext, makeEngine } = await import('./mockAudioContext.js');
const { createMusicEngine, MUSIC_THEMES } = await import('../../client/audio/music.js');
const { createRng } = await import('../../shared/rng.js');

function advance(ctx, music, seconds) {
  for (let i = 0; i < Math.ceil(seconds / 0.025); i++) { ctx.advance(0.025); music.scheduler(); }
}

function score(theme, faction = 'terran', bars = 4) {
  const ctx = new MockAudioContext();
  const out = ctx.createGain(); out.connect(ctx.destination);
  const music = createMusicEngine({ ctx, out, musicTheme: theme, rng: createRng('arrangement') });
  music.setFactionHint(faction); music.setScene('builder');
  const counts = new Map();
  music.onStep = (_scene, step) => counts.set(Math.floor(step / 16), music.stats().notes);
  advance(ctx, music, bars * music.current.stepDur * 16 - 0.1);
  const oscillators = ctx.created.filter(node => node.kind === 'osc');
  return { ctx, music, counts, pitches: oscillators.map(node => node.frequency.events.filter(event => event.m === 'set').map(event => event.v)), types: oscillators.map(node => node.type), starts: oscillators.map(node => node.started) };
}

test('musical styles change audible pitches, oscillator timbres and rhythm, deterministically', () => {
  const scores = Object.keys(MUSIC_THEMES).map(theme => score(theme));
  for (let i = 0; i < scores.length; i++) for (let j = i + 1; j < scores.length; j++) {
    assert.notDeepEqual(scores[i].pitches, scores[j].pitches, 'different harmony/melody');
    assert.notDeepEqual(scores[i].types, scores[j].types, 'different instrument synthesis');
    assert.notDeepEqual(scores[i].starts, scores[j].starts, 'different tempo/groove');
  }
  const again = score('arcade');
  assert.deepEqual(scores[1].pitches, again.pitches);
  assert.deepEqual(scores[1].starts, again.starts);
  for (const entry of [...scores, again]) entry.music.dispose();
});

test('all five factions produce distinct lead phrases, including Astral', () => {
  const signatures = ['terran', 'vorrax', 'lumen', 'ferrix', 'astral'].map(faction => {
    const entry = score('adventure', faction, 1);
    const signature = JSON.stringify([entry.pitches, entry.types]);
    entry.music.dispose();
    return signature;
  });
  assert.equal(new Set(signatures).size, 5);
});

test('sixteen-bar arrangements leave a real breakdown and do not grow live voices indefinitely', () => {
  for (const theme of Object.keys(MUSIC_THEMES)) {
    const { ctx, music, counts } = score(theme, 'astral', 16);
    const notesIn = bar => counts.get(bar) - (counts.get(bar - 1) || 0);
    assert.ok(notesIn(12) + notesIn(13) < notesIn(10) + notesIn(11), `${theme}: audible space in the breakdown`);
    assert.ok(music.stats().peakVoices < 48, `${theme}: finite music voice population`);
    music.dispose();
    assert.equal(music.stats().voices, 0);
    assert.ok(ctx.created.filter(node => node.kind === 'osc' || node.kind === 'bufsrc').every(node => node.stopped !== null), 'all music sources stop');
  }
});

test('rapid style changes keep battle intensity and bound retiring arrangements', async () => {
  const { engine, ctx } = await makeEngine();
  engine.setScene('battle'); engine.music.setIntensity(0.95);
  advance(ctx, engine.music, 2);
  for (let i = 0; i < 12; i++) {
    engine.setSettings({ musicTheme: i % 2 ? 'ambient' : 'arcade' });
    assert.deepEqual(engine.music.layersOn, [true, true, true, true, true, true]);
    assert.ok(engine.music.fading.length <= 2);
  }
  advance(ctx, engine.music, 16);
  assert.equal(engine.music.fading.length, 0);
  assert.ok(engine.music.stats().peakVoices < 64);
  engine.dispose();
});

test('speech ducking composes with volume, mute, visibility and mix changes without resetting sliders', async () => {
  const { engine, doc } = await makeEngine({ init: false });
  engine.setSettings({ music: 0.5, sfx: 0.4, soundProfile: 'tactical' });
  engine.setSpeechDucking(true);
  await engine.init();
  const value = node => node.gain.events.at(-1).v;
  const saved = engine.getSettings();
  const ducked = value(engine.buses.music);
  assert.ok(ducked > 0);
  engine.setSpeechDucking(false);
  assert.ok(value(engine.buses.music) > ducked * 2);
  assert.deepEqual(engine.getSettings(), saved);
  engine.setSpeechDucking(true); engine.setVolume('music', 0);
  assert.equal(value(engine.buses.music), 0);
  assert.equal(value(engine.buses.musicSend), 0, 'muted music does not leak through reverb');
  engine.setVolume('sfx', 0);
  assert.equal(value(engine.buses.sfx), 0);
  assert.equal(value(engine.buses.sfxSend), 0, 'muted SFX do not leak through reverb');
  engine.setVolume('music', 0.5); doc.setHidden(true); engine.setSpeechDucking(false);
  assert.equal(value(engine.buses.music), 0);
  assert.equal(value(engine.buses.musicSend), 0);
  doc.setHidden(false); engine.setSettings({ soundProfile: 'cinematic' });
  assert.ok(value(engine.buses.music) > ducked);
  engine.setMuted(true); engine.setSpeechDucking(true); engine.setSpeechDucking(false);
  assert.equal(value(engine.buses.master), 0, 'speech completion cannot unmute the game');
  engine.dispose();
});
