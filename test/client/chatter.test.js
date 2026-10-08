import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattleChatter, createChatterPreview, BATTLE_LINES, LOCALIZED_BATTLE_LINES,
  FACTION_VOICE_PROFILES, normalizeChatterSettings, localVoice, speechStatus } from '../../client/battle/chatter.js';

function rig(settings = {}, voices = [], options = {}) {
  let time = 0;
  const lines = [], spoken = [], ducking = [], statuses = [], timers = new Map(); let id = 0, cancelled = 0;
  const synth = { getVoices: () => voices, speak: (s) => spoken.push(s), cancel() { cancelled++; } };
  const state = { master: 0.8, chatter: settings };
  const config = { faction: 'ferrix', myPlayerId: 'p1', myTeam: 0,
    ships: [{ id: 1, owner: 'p1', team: 0 }, { id: 2, owner: 'p2', team: 1 }],
    getSettings: () => state, onLine: (s) => { if (s) lines.push(s); }, now: () => time,
    onSpeakingChange: active => ducking.push(active), onStatus: status => statuses.push(status),
    speechSynthesis: synth, Utterance: class { constructor(text) { this.text = text; } },
    schedule: (fn, delay) => { timers.set(++id, { fn, delay }); return id; }, cancel: (h) => timers.delete(h),
    ...options,
  };
  const chatter = createBattleChatter(config);
  return { chatter, config, lines, spoken, state, timers, ducking, statuses, synth,
    get cancelled() { return cancelled; }, advance: (ms) => { time += ms; } };
}

test('faction-specific lines respond to events with cooldown, deduplication and no immediate repetition', () => {
  const r = rig();
  r.chatter.onFrame({ k: 0, e: [] });
  assert.equal(r.lines[0].event, 'start');
  r.chatter.onFrame({ k: 1, e: [['die', 2, 1]] });
  assert.equal(r.lines.length, 1);
  r.advance(17000); r.chatter.onFrame({ k: 2, e: [['die', 2, 1]] });
  const first = r.lines.at(-1).text;
  assert.ok(BATTLE_LINES.ferrix.kill.includes(first));
  r.advance(17000); r.chatter.onFrame({ k: 2, e: [['die', 2, 1]] });
  assert.equal(r.lines.length, 2, 'duplicate network frames do not repeat lines');
  r.chatter.onFrame({ k: 3, e: [['die', 2, 1]] });
  assert.notEqual(r.lines.at(-1).text, first);
  r.advance(5000); r.chatter.onEnd({ winner: 0 }); r.chatter.onEnd({ winner: 0 });
  assert.equal(r.lines.filter((x) => x.event === 'victory').length, 1);
  r.chatter.dispose(); assert.equal(r.timers.size, 0);
});

test('speech uses only installed Portuguese voices and honors mute and volume', () => {
  const remote = rig({ speech: true }, [{ localService: false, lang: 'pt-BR' }, { localService: true, lang: 'en-US' }]);
  remote.chatter.onFrame({ k: 0, e: [] });
  assert.equal(remote.spoken.length, 0); assert.equal(remote.lines.length, 1);
  remote.chatter.dispose();
  const local = rig({ speech: true, volume: 0.5 }, [{ localService: true, lang: 'pt-BR' }]);
  local.chatter.onFrame({ k: 0, e: [] });
  assert.equal(local.spoken[0].volume, 0.4);
  local.state.muted = true; local.advance(17000); local.chatter.onFrame({ k: 1, e: [['cast', 1]] });
  assert.equal(local.spoken.length, 1); assert.equal(local.lines.length, 2);
  local.chatter.dispose();
});

test('off disables both speech and subtitles; frequency and subtitle choices persist independently', () => {
  const off = rig({ frequency: 'off', speech: true });
  off.chatter.onFrame({ k: 0, e: [] }); off.chatter.onEnd({ winner: -1 });
  assert.equal(off.lines.length + off.spoken.length, 0); off.chatter.dispose();
  const rare = rig({ frequency: 'rare', subtitles: false });
  rare.chatter.onFrame({ k: 0, e: [] }); assert.equal(rare.lines.length, 0); rare.chatter.dispose();
  assert.equal(normalizeChatterSettings({ volume: 5 }).volume, 1);
});

test('all five factions have complete original PT, EN and ES lines; saved volume is preserved', () => {
  const events = ['start', 'kill', 'loss', 'cast', 'sudden', 'victory', 'defeat', 'draw'];
  for (const [language, factions] of Object.entries(LOCALIZED_BATTLE_LINES)) {
    assert.deepEqual(Object.keys(factions).sort(), ['astral', 'ferrix', 'lumen', 'terran', 'vorrax']);
    for (const [faction, lines] of Object.entries(factions)) {
      assert.deepEqual(Object.keys(lines), events);
      for (const event of events) assert.ok(lines[event].length && lines[event].every(text => typeof text === 'string' && text.length > 10));
      if (language !== 'pt-BR') assert.notEqual(lines.start[0], BATTLE_LINES[faction].start[0]);
    }
  }
  assert.deepEqual(normalizeChatterSettings({ volume: 0.25, language: 'en-US' }), { frequency: 'normal', subtitles: true, volume: 0.25, speech: false, language: 'en-US' });
  assert.equal(normalizeChatterSettings().volume, 0.85);
  assert.equal(normalizeChatterSettings({ language: 'fr-FR' }).language, 'pt-BR');
});

test('voice selection prefers exact locale, accepts same-language dialect, and rejects remote or unrelated voices', () => {
  const pt = { name: 'PT', localService: true, lang: 'pt-PT' }, br = { name: 'BR', localService: true, lang: 'pt-BR' };
  const gb = { localService: true, lang: 'en-GB' }, remote = { localService: false, lang: 'en-US' };
  const synth = { getVoices: () => [pt, gb, remote, br], speak() {} };
  assert.equal(localVoice('pt-BR', synth), br);
  assert.equal(localVoice('en-US', synth), gb);
  assert.equal(localVoice('es-ES', synth), null);
  assert.equal(speechStatus('es-ES', synth, class {}).reason, 'missing-voice');
  assert.equal(speechStatus('en-US', synth, null).reason, 'unsupported');
  for (const language of ['pt-BR', 'en-US', 'es-ES']) {
    const voice = { localService: true, lang: language };
    const r = rig({ language, speech: true }, [voice]);
    r.chatter.onFrame({ k: 0, e: [] });
    assert.equal(r.lines[0].text, LOCALIZED_BATTLE_LINES[language].ferrix.start[0]);
    assert.equal(r.lines[0].language, language);
    assert.equal(r.spoken[0].text, r.lines[0].text);
    assert.equal(r.spoken[0].lang, language);
    assert.equal(r.spoken[0].voice, voice);
    r.chatter.dispose();
  }
});

test('missing selected-language voice leaves localized subtitles and reports status without speaking another language', () => {
  const r = rig({ speech: true, language: 'en-US' }, [{ localService: true, lang: 'pt-BR' }]);
  r.chatter.onFrame({ k: 0, e: [] });
  assert.equal(r.spoken.length, 0);
  assert.equal(r.lines[0].text, LOCALIZED_BATTLE_LINES['en-US'].ferrix.start[0]);
  assert.equal(r.lines[0].speechAvailable, false);
  assert.equal(r.statuses[0].reason, 'missing-voice');
  r.chatter.dispose();
});

test('rare frequency retains the 30-second cooldown even with speech enabled', () => {
  const r = rig({ frequency: 'rare', speech: true }, [{ localService: true, lang: 'pt-BR' }]);
  r.chatter.onFrame({ k: 0, e: [] });
  r.advance(17000); r.chatter.onFrame({ k: 1, e: [['cast', 1]] });
  assert.equal(r.spoken.length, 1);
  r.advance(14000); r.chatter.onFrame({ k: 2, e: [['cast', 1]] });
  assert.equal(r.spoken.length, 2);
  r.chatter.dispose();
});

test('speech ducks only while playing; replacement, mute, stale callbacks and teardown cannot leave audio ducked', () => {
  const r = rig({ speech: true }, [{ localService: true, lang: 'pt-BR' }]);
  r.chatter.onFrame({ k: 0, e: [] });
  assert.deepEqual(r.ducking, [], 'queued utterance is not yet playing');
  const first = r.spoken[0]; first.onstart();
  assert.deepEqual(r.ducking, [true]);
  r.advance(17000); r.chatter.onFrame({ k: 1, e: [['cast', 1]] });
  assert.equal(r.cancelled, 1);
  assert.deepEqual(r.ducking, [true, false]);
  const second = r.spoken[1]; second.onstart(); first.onend();
  assert.deepEqual(r.ducking, [true, false, true], 'old callbacks cannot unduck new speech');
  r.state.muted = true; r.chatter.updateSettings();
  assert.equal(r.cancelled, 2);
  assert.deepEqual(r.ducking, [true, false, true, false]);
  second.onstart(); second.onerror();
  assert.deepEqual(r.ducking, [true, false, true, false]);
  r.chatter.dispose(); assert.equal(r.timers.size, 0);
});

test('settings synchronize even on duplicate frames; speech disabled, zero master, and language changes cancel pending speech', () => {
  for (const change of [state => { state.chatter.speech = false; }, state => { state.master = 0; },
    state => { state.chatter.language = 'en-US'; }, state => { state.chatter.frequency = 'off'; }]) {
    const r = rig({ speech: true }, [{ localService: true, lang: 'pt-BR' }]);
    r.chatter.onFrame({ k: 0, e: [] });
    change(r.state);
    r.chatter.onFrame({ k: 0, e: [] });
    assert.equal(r.cancelled, 1);
    assert.equal(r.spoken.length, 1);
    r.chatter.dispose();
  }
});

test('voice profiles vary by faction and stalled speech releases ducking with a bounded watchdog', () => {
  const signatures = new Set();
  for (const faction of Object.keys(BATTLE_LINES)) {
    const r = rig({ speech: true, volume: 1 }, [{ localService: true, lang: 'pt-BR' }], { faction });
    r.chatter.onFrame({ k: 0, e: [] });
    const line = r.spoken[0];
    assert.equal(line.volume, 0.8);
    assert.equal(line.rate, FACTION_VOICE_PROFILES[faction].rate);
    assert.equal(line.pitch, FACTION_VOICE_PROFILES[faction].pitch);
    signatures.add(`${line.rate}:${line.pitch}`);
    line.onstart();
    const watchdog = [...r.timers.values()].find(timer => timer.delay === 20000);
    assert.ok(watchdog); watchdog.fn();
    assert.equal(r.cancelled, 1); assert.deepEqual(r.ducking, [true, false]);
    r.chatter.dispose();
  }
  assert.equal(signatures.size, 5);
});

test('explicit preview uses selected language, never changes opt-in, replaces pending speech and honors mute', () => {
  const r = rig({ speech: false, frequency: 'off', language: 'en-US' }, [{ localService: true, lang: 'en-US' }]);
  const preview = createChatterPreview(r.config);
  assert.equal(preview.play('vorrax').available, true);
  assert.equal(r.spoken[0].text, LOCALIZED_BATTLE_LINES['en-US'].vorrax.start[0]);
  assert.equal(r.state.chatter.speech, false);
  assert.equal(r.state.chatter.frequency, 'off');
  preview.play('lumen'); assert.equal(r.cancelled, 1);
  r.state.muted = true; preview.updateSettings(); assert.equal(r.cancelled, 2);
  preview.play('terran'); assert.equal(r.spoken.length, 2);
  preview.dispose(); assert.equal(r.timers.size, 0);
  preview.play('terran'); assert.equal(r.spoken.length, 2);
  r.chatter.dispose();
});
