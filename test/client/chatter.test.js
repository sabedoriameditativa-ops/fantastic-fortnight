import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattleChatter, BATTLE_LINES, normalizeChatterSettings } from '../../client/battle/chatter.js';

function rig(settings = {}, voices = []) {
  let time = 0;
  const lines = [], spoken = [], timers = new Map(); let id = 0;
  const synth = { getVoices: () => voices, speak: (s) => spoken.push(s), cancel() {} };
  const state = { master: 0.8, chatter: settings };
  const chatter = createBattleChatter({ faction: 'ferrix', myPlayerId: 'p1', myTeam: 0,
    ships: [{ id: 1, owner: 'p1', team: 0 }, { id: 2, owner: 'p2', team: 1 }],
    getSettings: () => state, onLine: (s) => { if (s) lines.push(s); }, now: () => time,
    speechSynthesis: synth, Utterance: class { constructor(text) { this.text = text; } },
    schedule: (fn) => { timers.set(++id, fn); return id; }, cancel: (h) => timers.delete(h),
  });
  return { chatter, lines, spoken, state, timers, advance: (ms) => { time += ms; } };
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
