// Original procedural soundtrack: three arrangements with written phrases,
// distinct harmony, instruments and grooves, and a 16-bar musical form.
// Scenes crossfade on bar boundaries of the outgoing theme. Everything is
// scheduled on the injected AudioContext; the only timer is the engine's
// 25 ms tick calling `scheduler()` (injected by index.js, mockable in tests).
// No Math.random: phrase choices come from an injected seeded rng.

import {
  createVoiceContext, finalizeVoice, osc, noise, env, lp, bp, hp, play, pitchSweep, gainNode, mtof, stepShaper, MIN_GAIN,
} from './recipes.js';

export const LOOKAHEAD = 0.12;
export const TICK_MS = 25;
export const STEPS_PER_BAR = 16;

/** Layer thresholds (intensity ≥ on; off when < on − HYSTERESIS). */
export const LAYER_ON = [0, 0.1, 0.25, 0.45, 0.65, 0.85];
export const HYSTERESIS = 0.15;
export const PROG_B_LAYER = 4;

/** Pure metadata: safe to import from settings/storage without starting audio. */
export const MUSIC_THEMES = Object.freeze({
  adventure: Object.freeze({ id: 'adventure', label: 'Aventura estelar', description: 'Melodias heroicas, baixo pulsante e bateria com viradas.' }),
  arcade: Object.freeze({ id: 'arcade', label: 'Órbita arcade', description: 'Sintetizadores de pulso, arpejos rápidos e ritmo sincopado.' }),
  ambient: Object.freeze({ id: 'ambient', label: 'Nebulosa', description: 'Acordes abertos, sinos espaciais e percussão espaçada.' }),
});
export const SOUND_PROFILES = Object.freeze({
  balanced: Object.freeze({ id: 'balanced', label: 'Equilibrado', description: 'Música e combate em equilíbrio.', music: 1, sfx: 1, reverb: 0.18, threshold: -18, ratio: 4 }),
  cinematic: Object.freeze({ id: 'cinematic', label: 'Cinemático', description: 'Trilha mais presente, espaço e contraste entre os impactos.', music: 1.06, sfx: 0.94, reverb: 0.22, threshold: -16, ratio: 3 }),
  tactical: Object.freeze({ id: 'tactical', label: 'Tático', description: 'Música discreta e efeitos mais secos para ler o combate.', music: 0.65, sfx: 1, reverb: 0.07, threshold: -20, ratio: 5 }),
});
export const DEFAULT_MUSIC_THEME = 'adventure';
export const DEFAULT_SOUND_PROFILE = 'balanced';
export const normalizeMusicTheme = value => Object.hasOwn(MUSIC_THEMES, value) ? value : DEFAULT_MUSIC_THEME;
export const normalizeSoundProfile = value => Object.hasOwn(SOUND_PROFILES, value) ? value : DEFAULT_SOUND_PROFILE;

// Chords (MIDI triads) — D natural minor unless noted.
const Dm = [50, 57, 62, 65], Bb = [46, 53, 58, 62], F = [41, 48, 53, 57], C = [48, 55, 60, 64];
const Eb = [51, 58, 63], A7 = [45, 52, 57, 61];
const Gmaj = [55, 59, 62], Amaj = [57, 61, 64], Dmaj = [50, 54, 57, 62];
const Ddim = [50, 53, 56];

export const PROGRESSIONS = Object.freeze({
  menu: [Dm, Bb, F, C],
  builder: [Dm, C, Bb, C],
  battleA: [Dm, Dm, Bb, C],
  battleB: [Dm, Eb, Dm, A7],
  victory: [Dmaj, Gmaj, Amaj, Dmaj],
  defeat: [Dm, Ddim],
});

/** D minor pentatonic over two octaves. */
export const PENTA = [62, 65, 67, 69, 72, 74, 77, 79, 81, 84, 86];

export const LEAD_PHRASES = [
  [62, 65, 67, 69, 72, 69, 67, 65],
  [69, 72, 74, 72, 69, 67, 65, 67],
  [74, 72, 69, 67, 65, 67, 69, 62],
  [62, 67, 69, 72, 77, 74, 72, 69],
];

/** Faction motifs (8ths) and lead timbre. */
export const MOTIFS = Object.freeze({
  terran: { notes: [62, 62, 69, 67, 65, 67, 69, 74], timbre: 'terran' },
  vorrax: { notes: [62, 63, 62, 65, 63, 62, 60, 62], timbre: 'vorrax' },
  lumen: { notes: [62, 69, 74, 81, 78, 74, 69, 62], timbre: 'lumen' },
  ferrix: { notes: [62, 62, 62, 65, 62, 62, 72, 62], timbre: 'ferrix' },
  astral: { notes: [62, 69, 76, 74, 65, 72, 69, 62], timbre: 'astral' },
});

const THEME_BPM = { menu: 72, builder: 96, battle: 128, victory: 84, defeat: 60 };
export const THEME_BPM_TABLE = Object.freeze({ ...THEME_BPM });

const ARRANGEMENTS = {
  adventure: { bpm: THEME_BPM, transpose: 0, swing: 0, arp: 'triangle', lead: 'terran', pad: 'sawtooth', cutoff: 1500,
    progression: [Dm, Bb, F, C], bridge: [[43, 50, 58, 62], Dm, A7, Dm],
    bass: [0, 3, 6, 8, 12, 14], kicks: [0, 8, 10], hats: [2, 6, 10, 14],
    melody: [0, 2, 1, 3, 2, 0, 1, 2], answer: [3, 2, 1, 2, 0, 1, 2, 0] },
  arcade: { bpm: { menu: 104, builder: 116, battle: 144, victory: 104, defeat: 72 }, transpose: 2, swing: 0.08, arp: 'square', lead: 'pulse', pad: 'triangle', cutoff: 2400,
    progression: [[52, 59, 64, 67], [48, 55, 60, 64], [55, 59, 62, 67], [50, 57, 62, 66]],
    bridge: [[45, 52, 61, 64], [48, 55, 60, 64], [47, 54, 59, 62], [52, 59, 64, 67]],
    bass: [0, 3, 6, 8, 11, 14], kicks: [0, 6, 8, 11], hats: [0, 2, 6, 8, 10, 14],
    melody: [0, 2, 3, 2, 1, 3, 2, 0], answer: [2, 3, 2, 0, 3, 1, 2, 0] },
  ambient: { bpm: { menu: 60, builder: 72, battle: 92, victory: 72, defeat: 50 }, transpose: 5, swing: 0, arp: 'sine', lead: 'astral', pad: 'triangle', cutoff: 950,
    progression: [[43, 50, 58, 69], [51, 58, 62, 65], [48, 55, 58, 62], [50, 57, 65, 69]],
    bridge: [[46, 53, 60, 65], [48, 55, 58, 62], [43, 50, 58, 69], [50, 57, 62, 69]],
    bass: [0, 7, 10], kicks: [0], hats: [6, 14],
    melody: [0, 2, 3, 1, 2, 0, 3, 2], answer: [3, 1, 2, 0, 2, 3, 1, 0] },
};

/** A quiet opening, groove, lift, two-bar breakdown and a returning answer. */
export function sectionAtBar(bar) {
  const position = Math.floor(Math.max(0, bar)) % 16;
  return position < 4 ? 'opening' : position < 8 ? 'groove' : position < 12 ? 'lift' : position < 14 ? 'break' : 'return';
}

/**
 * Battle intensity from the HUD battle state (docs/design/audio.md §3.4).
 * @param {{ aliveFrac:number[], destroyedFrac:number, elapsedSec:number }} s
 * @returns {number} 0..1
 */
export function computeIntensity(s) {
  if (!s) return 0;
  const a = Array.isArray(s.aliveFrac) ? s.aliveFrac : [1, 1];
  const minAlive = Math.min(a[0] ?? 1, a[1] ?? 1);
  const destroyed = Math.max(0, Math.min(1, Number(s.destroyedFrac) || 0));
  const elapsed = Math.max(0, Number(s.elapsedSec ?? s.elapsed) || 0);
  const x = 0.35 * destroyed + 0.25 * Math.min(1, elapsed / 90) + 0.4 * (1 - Math.max(0, Math.min(1, minAlive)));
  return Math.max(0, Math.min(1, x));
}

/**
 * Create the music engine.
 * @param {Object} o
 * @param {AudioContext} o.ctx
 * @param {AudioNode} o.out          music bus
 * @param {object} [o.noise]         noise bank { white, pink, brown, crackle }
 * @param {AudioNode} [o.reverbIn]   shared reverb input
 * @param {{ next():number, pick(a:any[]):any }} o.rng  seeded rng
 */
export function createMusicEngine(o) {
  const ctx = o.ctx;
  const out = o.out;
  const bank = o.noise || null;
  const reverbIn = o.reverbIn || null;
  const rng = o.rng || { next: () => 0.5, pick: (a) => a[0] };

  let scene = 'none';
  let current = null;
  const fading = [];
  let paused = false;
  let intensity = 0;
  const layerOn = [true, false, false, false, false, false];
  const layerOffAt = [0, 0, 0, 0, 0, 0];
  let progB = false;
  let factionHint = null;
  let motifPending = false;
  let stepHook = null;
  let notesScheduled = 0;
  let musicTheme = normalizeMusicTheme(o.musicTheme);
  let schedulingTheme = null;
  const activeVoices = new Set();
  let peakVoices = 0;

  // ---- note helpers -------------------------------------------------------

  function voice(t, dest) {
    const v = createVoiceContext(ctx, { t, out: dest, gain: 1, size: 0, faction: null, rnd: rngAsRnd(), noise: bank, reverbIn, kind: 'music' });
    v.theme = schedulingTheme;
    return v;
  }

  function rngAsRnd() {
    const r = (min = 0, max = 1) => min + rng.next() * (max - min);
    r.next = () => rng.next();
    r.chance = (p) => rng.next() < p;
    return r;
  }

  function done(v) {
    activeVoices.add(v);
    peakVoices = Math.max(peakVoices, activeVoices.size);
    finalizeVoice(v, () => activeVoices.delete(v));
    notesScheduled++;
  }

  /** Detuned saws through a lowpass; slow attack. Optional cutoff LFO. */
  function pad(t, midi, dur, dest, { cutoff = 900, gain = 0.16, lfoHz = 0, lfoDepth = 0, type = 'sawtooth', detune = 7, send = 0 } = {}) {
    const v = voice(t, dest);
    // Chord density changes the voicing, never its nominal loudness.
    const g = env(v, t, { a: Math.min(1.1, dur * 0.3), d: dur * 0.2, s: 0.7, hold: Math.max(0, dur * 0.45), r: 1.1, peak: gain / Math.sqrt(Math.max(1, midi.length)) }, dest);
    const f = lp(v, cutoff, 0.8, g);
    if (lfoHz > 0) { const l = osc(v, 'sine', lfoHz, t, null); const lg = gainNode(v, lfoDepth, null); l.connect(lg); lg.connect(f.frequency); play(v, l, t, t + dur + 2); }
    for (const m of midi) {
      for (const c of [-detune, detune]) {
        const x = osc(v, type, mtof(m), t, f); x.detune.value = c; play(v, x, t, t + dur + 2);
      }
    }
    if (send > 0 && reverbIn) { const sg = gainNode(v, send, reverbIn); g.connect(sg); }
    done(v);
  }

  function bass(t, midi, dur, dest, { gain = 0.28, type = 'sine' } = {}) {
    const v = voice(t, dest);
    const g = env(v, t, { a: 0.005, d: dur * 0.5, s: 0.3, r: 0.08, peak: gain }, dest);
    const f = lp(v, 400, 1.2, g); pitchSweep(f.frequency, 900, 300, t, t + 0.15);
    play(v, osc(v, type, mtof(midi), t, f), t, t + dur);
    const qg = gainNode(v, 0.16, f);
    play(v, osc(v, 'square', mtof(midi + 12), t, qg), t, t + dur);
    done(v);
  }

  function arp(t, midi, dest, { gain = 0.1, cutoff = 2500, type = 'triangle' } = {}) {
    const v = voice(t, dest);
    const g = env(v, t, { a: 0.003, d: 0.18, r: 0.12, peak: gain }, dest);
    const f = lp(v, cutoff, 2, g);
    play(v, osc(v, type, mtof(midi), t, f), t, t + 0.4);
    const overtone = gainNode(v, type === 'square' ? 0.12 : 0.35, f);
    play(v, osc(v, 'sine', mtof(midi + 12), t, overtone), t, t + 0.4);
    done(v);
  }

  function lead(t, midi, dur, dest, { gain = 0.2, timbre = 'default' } = {}) {
    const v = voice(t, dest);
    const g = env(v, t, { a: 0.01, d: dur * 0.4, s: 0.6, hold: dur * 0.4, r: 0.15, peak: gain }, dest);
    const f0 = mtof(midi);
    if (timbre === 'vorrax') {
      const f = bp(v, f0 * 2, 5, g);
      const o = osc(v, 'triangle', f0, t, f);
      const vib = osc(v, 'sine', 6, t, null); const vg = gainNode(v, 40, null); vib.connect(vg); vg.connect(o.detune);
      play(v, o, t, t + dur + 0.2); play(v, vib, t, t + dur + 0.2);
    } else if (timbre === 'lumen') {
      const o1 = osc(v, 'sine', f0, t, g); const g2 = gainNode(v, 0.4, g); const o2 = osc(v, 'sine', f0 * 1.5, t, g2);
      const g3 = gainNode(v, 0.25, g); const o3 = osc(v, 'sine', f0 * 2, t, g3);
      play(v, o1, t, t + dur + 0.2); play(v, o2, t, t + dur + 0.2); play(v, o3, t, t + dur + 0.2);
      if (reverbIn) { const sg = gainNode(v, 0.7, reverbIn); g.connect(sg); }
    } else if (timbre === 'astral') {
      // A rounded bell with a quiet, inharmonic upper partial: distinct from
      // Lúmen's harmonic stack, with no harsh ring-modulation aliasing.
      const body = osc(v, 'sine', f0, t, g);
      const shimmer = gainNode(v, 0.22, g);
      const overtone = osc(v, 'sine', f0 * 2.756, t, shimmer);
      overtone.detune.setValueAtTime(-5, t);
      overtone.detune.linearRampToValueAtTime(8, t + dur);
      play(v, body, t, t + dur + 0.2); play(v, overtone, t, t + dur + 0.2);
    } else if (timbre === 'pulse') {
      const f = lp(v, 2200, 0.65, g);
      play(v, osc(v, 'square', f0, t, f), t, t + dur + 0.15);
      const octave = gainNode(v, 0.16, f);
      play(v, osc(v, 'triangle', f0 * 2, t, octave), t, t + dur + 0.15);
    } else if (timbre === 'ferrix') {
      const sh = stepShaper(v, g, 12);
      const o = osc(v, 'square', f0, t, sh);
      const pwm = osc(v, 'square', 40, t, null); const pg = gainNode(v, 60, null); pwm.connect(pg); pg.connect(o.detune);
      play(v, o, t, t + dur + 0.1); play(v, pwm, t, t + dur + 0.1);
    } else {
      const f = lp(v, 1500, 1.5, g); pitchSweep(f.frequency, 2600, 1500, t, t + 0.2);
      const a = osc(v, 'sawtooth', f0, t, f); a.detune.value = -8; const b = osc(v, 'sawtooth', f0, t, f); b.detune.value = 8;
      const sg = gainNode(v, 0.4, f); const s = osc(v, 'sine', f0 / 2, t, sg);
      play(v, a, t, t + dur + 0.2); play(v, b, t, t + dur + 0.2); play(v, s, t, t + dur + 0.2);
    }
    done(v);
  }

  function kick(t, dest, { gain = 0.9 } = {}) {
    const v = voice(t, dest);
    const g = env(v, t, { a: 0.001, d: 0.25, r: 0.05, peak: gain }, dest);
    const o = osc(v, 'sine', 150, t, g); pitchSweep(o.frequency, 150, 45, t, t + 0.06);
    play(v, o, t, t + 0.35);
    const cg = env(v, t, { a: 0.001, d: 0.008, r: 0.005, peak: gain * 0.3 }, dest);
    play(v, noise(v, 'white', t, hp(v, 3000, 0.7, cg)), t, t + 0.02);
    done(v);
  }

  function snare(t, dest, { gain = 0.5 } = {}) {
    const v = voice(t, dest);
    const ng = env(v, t, { a: 0.001, d: 0.18, r: 0.05, peak: gain }, dest);
    play(v, noise(v, 'white', t, bp(v, 1800, 1, ng)), t, t + 0.25);
    const tg = env(v, t, { a: 0.001, d: 0.08, r: 0.03, peak: gain * 0.6 }, dest);
    const o = osc(v, 'triangle', 200, t, tg); pitchSweep(o.frequency, 200, 120, t, t + 0.08);
    play(v, o, t, t + 0.12);
    done(v);
  }

  function hat(t, dest, open = false, { gain = 0.18 } = {}) {
    const v = voice(t, dest);
    const g = env(v, t, { a: 0.001, d: open ? 0.25 : 0.04, r: open ? 0.08 : 0.02, peak: gain }, dest);
    play(v, noise(v, 'white', t, hp(v, 7000, 0.7, g)), t, t + (open ? 0.35 : 0.07));
    done(v);
  }

  function tom(t, midi, dest, { gain = 0.5 } = {}) {
    const v = voice(t, dest);
    const g = env(v, t, { a: 0.001, d: 0.3, r: 0.08, peak: gain }, dest);
    const o = osc(v, 'sine', mtof(midi) * 1.5, t, g); pitchSweep(o.frequency, mtof(midi) * 1.5, mtof(midi), t, t + 0.12);
    play(v, o, t, t + 0.4);
    done(v);
  }

  // ---- theme instances ----------------------------------------------------

  /** Feedback delay (dotted 8th) shared by a theme's arp. Returns { input, nodes }. */
  function makeDelay(bpm, dest) {
    const nodes = [];
    const input = ctx.createGain(); input.gain.value = 1; nodes.push(input);
    const delay = ctx.createDelay(2.0); delay.delayTime.value = Math.min(1.9, 0.375 * 60 / bpm); nodes.push(delay);
    const fb = ctx.createGain(); fb.gain.value = 0.35; nodes.push(fb);
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 3000; nodes.push(fl);
    const mix = ctx.createGain(); mix.gain.value = 0.4; nodes.push(mix);
    input.connect(dest);
    input.connect(delay); delay.connect(fl); fl.connect(fb); fb.connect(delay); fl.connect(mix); mix.connect(dest);
    return { input, nodes };
  }

  function makeTheme(name, startAt) {
    const arrangement = ARRANGEMENTS[musicTheme];
    const bpm = arrangement.bpm[name] || 100;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(out);
    const th = {
      name, bpm, bus, musicTheme, arrangement, section: 'opening',
      stepDur: 60 / bpm / 4,
      step: 0,
      nextNoteTime: startAt,
      startAt,
      stopAt: null,
      nodes: [bus],
      layers: null,
      prog: null,
      phrase: null,
      onStep: null,
      /** Time of the next bar boundary at or after the next unscheduled step. */
      nextBarTime() {
        const rem = (STEPS_PER_BAR - (this.step % STEPS_PER_BAR)) % STEPS_PER_BAR;
        return this.nextNoteTime + rem * this.stepDur;
      },
      nextEighthTime() {
        const rem = (2 - (this.step % 2)) % 2;
        return this.nextNoteTime + rem * this.stepDur;
      },
      dispose() {
        for (const v of [...activeVoices]) if (v.theme === this) {
          for (const source of v.sources) { try { source.stop(ctx.currentTime); } catch { /* already stopped */ } }
          v.cleanup();
        }
        for (const n of this.nodes) { try { n.disconnect(); } catch { /* ignore */ } }
        this.nodes.length = 0;
      },
    };
    BUILDERS[name](th);
    return th;
  }

  const upper = (note, octave = 60) => octave + ((note % 12 + 12) % 12);

  function phrase(th, chord, bar, isBattle) {
    const a = th.arrangement;
    const motif = factionHint && MOTIFS[factionHint];
    const useMotif = motif && (motifPending || bar % 4 === 0);
    if (useMotif) {
      motifPending = false;
      return { notes: motif.notes.map(n => n + a.transpose), timbre: motif.timbre };
    }
    const order = bar % 2 ? a.answer : a.melody;
    return { notes: order.map(index => upper(chord[index % chord.length], isBattle ? 72 : 60)),
      timbre: th.musicTheme === 'adventure' && motif ? motif.timbre : a.lead };
  }

  function prepareBar(th, step, battleScene = false) {
    const bar = Math.floor(step / STEPS_PER_BAR);
    th.section = sectionAtBar(bar);
    if (battleScene && step % 64 === 0) th.prog = progB ? 'B' : 'A';
    const alternate = th.section === 'lift' || (battleScene && th.prog === 'B');
    const progression = alternate ? th.arrangement.bridge : th.arrangement.progression;
    const chord = progression[bar % progression.length];
    if (step % 16 === 0) th.phrase = phrase(th, chord, bar, battleScene);
    return { bar, chord, s16: step % 16, breakBar: th.section === 'break', lift: th.section === 'lift' || th.section === 'return' };
  }

  function melodicNote(th, step, time, dest, gain, sparse = false) {
    const index = (step % 16) / 2;
    if (!Number.isInteger(index) || !th.phrase || index >= 7 || (sparse && index % 2)) return;
    // The final eighth is a rest: calls and answers breathe between bars.
    lead(time, th.phrase.notes[index], th.stepDur * (sparse ? 2.9 : 1.45), dest,
      { gain, timbre: th.phrase.timbre });
  }

  function factionFill(th, s16, time, dest) {
    if (s16 !== 14) return;
    if (factionHint === 'vorrax') tom(time, 45 + th.arrangement.transpose, dest, { gain: 0.18 });
    else if (factionHint === 'ferrix') arp(time, 74 + th.arrangement.transpose, dest, { type: 'square', gain: 0.07, cutoff: 1600 });
    else if (factionHint === 'lumen' || factionHint === 'astral') lead(time, 81 + th.arrangement.transpose, 3 * th.stepDur, dest, { timbre: factionHint, gain: 0.07 });
    else tom(time, 43 + th.arrangement.transpose, dest, { gain: 0.17 });
  }

  const BUILDERS = {
    menu(th) {
      const a = th.arrangement, airy = th.musicTheme === 'ambient';
      const delay = makeDelay(th.bpm, th.bus); th.nodes.push(...delay.nodes);
      th.onStep = (t, step, time) => {
        const { bar, chord, s16, breakBar, lift } = prepareBar(t, step);
        if (s16 === 0) {
          pad(time, chord, 16 * t.stepDur, t.bus, { cutoff: a.cutoff * 0.65, gain: 0.13, type: a.pad, detune: airy ? 4 : 7, send: 0.14 });
          bass(time, chord[0] - 12, 3 * t.stepDur, t.bus, { gain: 0.13, type: airy ? 'sine' : 'triangle' });
        }
        if (!breakBar && (airy ? s16 % 4 === 2 : s16 % 2 === 1)) {
          const note = upper(chord[(Math.floor(s16 / 2) + bar) % chord.length], 72);
          arp(time, note, delay.input, { type: a.arp, gain: lift ? 0.065 : 0.045, cutoff: a.cutoff });
        }
        if (bar % 2 === 0 || lift) melodicNote(t, step, time, t.bus, airy ? 0.07 : 0.085, airy);
        if (!airy && !breakBar && bar >= 2 && a.kicks.includes(s16)) kick(time, t.bus, { gain: 0.2 });
        if (!airy && !breakBar && bar >= 4 && a.hats.includes(s16)) hat(time, t.bus, false, { gain: 0.045 });
      };
    },
    builder(th) {
      const a = th.arrangement, airy = th.musicTheme === 'ambient';
      const delay = makeDelay(th.bpm, th.bus); th.nodes.push(...delay.nodes);
      th.onStep = (t, step, time) => {
        const { bar, chord, s16, breakBar, lift } = prepareBar(t, step);
        if (s16 === 0) pad(time, chord, 16 * t.stepDur, t.bus, { cutoff: a.cutoff, gain: 0.12, type: a.pad, send: 0.12 });
        if (a.bass.includes(s16) && (!breakBar || s16 === 0)) bass(time, chord[0] - (s16 >= 12 ? 0 : 12), 1.8 * t.stepDur, t.bus, { gain: 0.22, type: th.musicTheme === 'arcade' ? 'square' : 'sine' });
        if (!breakBar && a.kicks.includes(s16)) kick(time, t.bus, { gain: airy ? 0.25 : 0.38 });
        if (!breakBar && a.hats.includes(s16)) hat(time, t.bus, false, { gain: 0.06 });
        if (!airy && !breakBar && (s16 === 4 || s16 === 12) && bar % 4 !== 0) snare(time, t.bus, { gain: 0.17 });
        if (!breakBar && s16 % (airy ? 4 : 2) === 1) arp(time, upper(chord[(s16 + bar) % chord.length], 72), delay.input, { type: a.arp, gain: 0.055, cutoff: a.cutoff });
        if (bar % 2 === 0 || lift || breakBar) melodicNote(t, step, time, t.bus, 0.11, airy || breakBar);
        if (bar % 4 === 3 && !breakBar) factionFill(t, s16, time, t.bus);
      };
    },
    battle(th) {
      const a = th.arrangement, airy = th.musicTheme === 'ambient';
      th.layers = [];
      for (let k = 0; k < 6; k++) {
        const gain = ctx.createGain(); gain.gain.value = layerOn[k] ? 1 : 0; gain.connect(th.bus); th.layers.push(gain); th.nodes.push(gain);
      }
      const L = th.layers;
      const delay = makeDelay(th.bpm, L[3]); th.nodes.push(...delay.nodes);
      th.prog = 'A';
      th.onStep = (t, step, time) => {
        const { bar, chord, s16, breakBar, lift } = prepareBar(t, step, true);
        const root = chord[0];
        const active = k => layerOn[k] || (layerOffAt[k] > 0 && ctx.currentTime - layerOffAt[k] < 3);
        if (s16 === 0) pad(time, chord, 16 * t.stepDur, L[0], { cutoff: a.cutoff * (0.6 + intensity * 0.4), gain: 0.12, type: a.pad, send: 0.08 });
        // Early combat has a recognizable pulse and theme before casualty-driven
        // intensity rises; escalation adds counterpoint instead of just volume.
        if (s16 === 0 || (!airy && s16 === 8)) kick(time, L[0], { gain: 0.17 });
        if (!active(4) && (bar % 2 === 0 || breakBar)) melodicNote(t, step, time, L[0], 0.065, true);
        if (active(1) && a.bass.includes(s16) && (!breakBar || s16 === 0)) bass(time, root - 12 + (s16 === 14 ? 12 : 0), t.stepDur * 1.7, L[1], { gain: 0.25, type: th.musicTheme === 'arcade' ? 'square' : 'sine' });
        if (active(2) && !breakBar) {
          if (a.kicks.includes(s16)) kick(time, L[2], { gain: 0.43 });
          if (a.hats.includes(s16)) hat(time, L[2], lift && s16 === 14, { gain: 0.085 });
        }
        if (active(3) && !breakBar) {
          if (s16 === 4 || s16 === 12) snare(time, L[3], { gain: airy ? 0.19 : 0.28 });
          if (s16 % (airy ? 4 : 2) === 1) arp(time, upper(chord[(Math.floor(s16 / 2) + bar) % chord.length], 72), delay.input, { type: a.arp, gain: 0.075, cutoff: a.cutoff });
        }
        if (active(4)) melodicNote(t, step, time, L[4], 0.12, airy || breakBar);
        if (active(5) && !breakBar && bar % 4 === 3) {
          if ([10, 12, 14].includes(s16)) tom(time, 50 - (s16 - 10) * 2 + a.transpose, L[5], { gain: 0.27 });
          if (s16 === 15) kick(time, L[5], { gain: 0.3 });
        }
        if (bar % 4 === 3 && !breakBar) factionFill(t, s16, time, L[0]);
      };
    },
    victory(th) {
      const a = th.arrangement;
      const delay = makeDelay(th.bpm, th.bus); th.nodes.push(...delay.nodes);
      th.onStep = (t, step, time) => {
        if (step === 0) stingerVictory(time, t.bus, a.transpose, a.lead);
        const bar = Math.floor(step / 16), s16 = step % 16;
        t.section = sectionAtBar(bar);
        if (bar < 2) return;
        const chord = PROGRESSIONS.victory[(bar - 2) % 4].map(n => n + a.transpose);
        if (s16 === 0) { pad(time, chord, 16 * t.stepDur, t.bus, { cutoff: a.cutoff, gain: 0.11, type: a.pad, send: 0.15 }); t.phrase = phrase(t, chord, bar, false); }
        melodicNote(t, step, time, t.bus, 0.07, true);
        if (s16 % 4 === 2) arp(time, upper(chord[(s16 / 2) % chord.length], 72), delay.input, { type: a.arp, gain: 0.05, cutoff: a.cutoff });
      };
    },
    defeat(th) {
      const a = th.arrangement;
      th.onStep = (t, step, time) => {
        if (step === 0) stingerDefeat(time, t.bus, a.transpose);
        const bar = Math.floor(step / 16), s16 = step % 16;
        t.section = sectionAtBar(bar);
        if (bar < 1) return;
        const chord = PROGRESSIONS.defeat[bar % 2].map(n => n + a.transpose);
        if (s16 === 0) pad(time, chord, 16 * t.stepDur, t.bus, { cutoff: 650, gain: 0.105, type: 'triangle', send: 0.15 });
        if (s16 === 0) bass(time, chord[0] - 12, 3 * t.stepDur, t.bus, { gain: 0.14 });
        if (s16 === 4 || s16 === 12) lead(time, upper(chord[s16 === 4 ? 2 : 0]), 3 * t.stepDur, t.bus, { gain: 0.065, timbre: a.lead });
      };
    },
  };

  /** Victory stinger: IV–V–I in D major, 3 saw voices through a lowpass, 2.2 s. */
  function stingerVictory(t, dest, transpose = 0, timbre = 'terran') {
    const v = voice(t, dest);
    const chords = [[Gmaj, 0, 0.55], [Amaj, 0.5, 0.55], [Dmaj, 1.0, 1.4]];
    const sends = [];
    for (const [ch, off, dur] of chords) {
      const g = env(v, t + off, { a: 0.02, d: dur * 0.4, s: 0.7, hold: dur * 0.4, r: 0.5, peak: 0.16 / Math.sqrt(ch.length) }, dest);
      sends.push(g);
      const f = lp(v, 2000, 0.8, g);
      const type = timbre === 'pulse' ? 'square' : timbre === 'astral' ? 'sine' : 'sawtooth';
      for (const m of ch) play(v, osc(v, type, mtof(m + 12 + transpose), t + off, f), t + off, t + off + dur + 0.6);
    }
    const sg = env(v, t, { a: 0.3, d: 1.2, r: 0.6, peak: 0.12 }, dest);
    play(v, noise(v, 'pink', t, hp(v, 4000, 0.7, sg)), t, t + 2.2);
    // reverb send fed from the voice's own envelopes (never from `dest`: a
    // dest→send edge would outlive the voice's cleanup and leak one gain per stinger)
    if (reverbIn) { const s = gainNode(v, 0.5, reverbIn); for (const g of sends) g.connect(s); sg.connect(s); }
    done(v);
  }

  /** Defeat stinger: two sines descending D4→A3 in semitones over 1.8 s + brown rumble. */
  function stingerDefeat(t, dest, transpose = 0) {
    const v = voice(t, dest);
    const g = env(v, t, { a: 0.05, d: 0.4, s: 0.8, hold: 1.0, r: 0.6, peak: 0.25 }, dest);
    const a = osc(v, 'sine', mtof(62 + transpose), t, g), b = osc(v, 'sine', mtof(65 + transpose), t, g);
    for (let i = 1; i <= 5; i++) { a.frequency.setValueAtTime(mtof(62 - i + transpose), t + i * 0.36); b.frequency.setValueAtTime(mtof(65 - i + transpose), t + i * 0.36); }
    play(v, a, t, t + 2.4); play(v, b, t, t + 2.4);
    const ng = env(v, t, { a: 0.3, d: 1.5, r: 0.7, peak: 0.3 }, dest);
    play(v, noise(v, 'brown', t, lp(v, 200, 0.8, ng)), t, t + 2.6);
    done(v);
  }

  // ---- scheduling ---------------------------------------------------------

  function scheduleTheme(th, now) {
    // Fell behind (throttled timer / long stall): skip the missed steps on the
    // grid instead of scheduling a burst of catch-up notes in the past.
    if (th.nextNoteTime < now - 0.02) {
      const missed = Math.ceil((now - th.nextNoteTime) / th.stepDur);
      th.step += missed;
      th.nextNoteTime += missed * th.stepDur;
    }
    while (th.nextNoteTime < now + LOOKAHEAD) {
      if (th.stopAt !== null && th.nextNoteTime >= th.stopAt) break;
      const time = th.nextNoteTime;
      schedulingTheme = th;
      try { th.onStep(th, th.step, time + (th.step % 2 ? th.arrangement.swing * th.stepDur : 0)); }
      finally { schedulingTheme = null; }
      if (stepHook) stepHook(th.name, th.step, time);
      th.nextNoteTime += th.stepDur;
      th.step++;
    }
  }

  /** One scheduler pass (called every 25 ms by the engine tick). */
  function scheduler() {
    if (paused) return;
    const now = ctx.currentTime;
    if (current) scheduleTheme(current, now);
    for (let i = fading.length - 1; i >= 0; i--) {
      const th = fading[i];
      scheduleTheme(th, now);
      if (th.stopAt !== null && now > th.stopAt + 3.5) { th.dispose(); fading.splice(i, 1); }
    }
  }

  /** Gain the theme's fade-in ramp (0 at startAt → 1 at startAt + fadeIn) has reached at time t. */
  function fadeInValueAt(th, t) {
    const fi = th.fadeIn > 0 ? th.fadeIn : 0.001;
    return Math.max(0, Math.min(1, (t - th.startAt) / fi));
  }

  function retire(th, tSwitch, fade) {
    // The theme may still be fading in: continue that ramp from its current
    // value up to tSwitch, then fade out — never force the bus to 1 (pop).
    const g = th.bus.gain;
    const now = ctx.currentTime;
    const t0 = Math.min(now, tSwitch);
    g.cancelScheduledValues(t0);
    g.setValueAtTime(fadeInValueAt(th, t0), t0);
    g.linearRampToValueAtTime(fadeInValueAt(th, tSwitch), tSwitch);
    g.linearRampToValueAtTime(0, tSwitch + fade);
    th.stopAt = tSwitch + fade + 0.2;
    fading.push(th);
    // Repeated clicks while selecting a style must not accumulate whole bands.
    while (fading.length > 2) fading.shift().dispose();
  }

  /**
   * Switch scene with a crossfade on the outgoing theme's bar boundary
   * (eighth-note boundary for stingers so the ending lands promptly).
   * @param {'none'|'menu'|'builder'|'battle'|'victory'|'defeat'} next
   */
  function setScene(next, refresh = false) {
    if (next === scene && !refresh) return;
    const now = ctx.currentTime;
    const stinger = next === 'victory' || next === 'defeat';
    const old = current;
    scene = next;
    if (next === 'none' || !THEME_BPM[next]) {
      if (old) { retire(old, now, 0.8); current = null; }
      return;
    }
    let tSwitch = now + 0.05;
    if (old) tSwitch = Math.max(now + 0.02, stinger ? old.nextEighthTime() : old.nextBarTime());
    const th = makeTheme(next, tSwitch);
    const fadeIn = next === 'menu' ? 3.0 : stinger ? 0.3 : 2.0;
    th.fadeIn = fadeIn;
    th.bus.gain.setValueAtTime(0, tSwitch);
    th.bus.gain.linearRampToValueAtTime(1, tSwitch + fadeIn);
    if (old) retire(old, tSwitch, stinger ? 0.4 : 2.0);
    current = th;
    if (next !== 'battle') { progB = false; for (let k = 1; k < 6; k++) { layerOn[k] = false; } }
  }

  /** Raw battle intensity 0..1 → layer gains with hysteresis. */
  function setIntensity(x) {
    intensity = Math.max(0, Math.min(1, Number(x) || 0));
    const now = ctx.currentTime;
    for (let k = 1; k < 6; k++) {
      const on = layerOn[k];
      if (!on && intensity >= LAYER_ON[k]) layerOn[k] = true;
      else if (on && intensity < LAYER_ON[k] - HYSTERESIS) { layerOn[k] = false; layerOffAt[k] = now; }
      if (layerOn[k] !== on && current && current.layers) current.layers[k].gain.setTargetAtTime(layerOn[k] ? 1 : 0, now, 0.8);
    }
    progB = layerOn[PROG_B_LAYER];
  }

  function setBattleState(s) { setIntensity(computeIntensity(s)); }

  function setTheme(value) {
    const next = normalizeMusicTheme(value);
    if (next === musicTheme) return;
    musicTheme = next;
    if (scene !== 'none') setScene(scene, true);
  }

  function setFactionHint(f) {
    factionHint = f && MOTIFS[f] ? f : null;
    if (factionHint && scene === 'builder') motifPending = true;
  }

  function pause() { paused = true; }
  function resume() {
    if (!paused) return;
    paused = false;
    const now = ctx.currentTime + 0.05;
    if (current) current.nextNoteTime = Math.max(current.nextNoteTime, now);
    for (const th of fading) th.nextNoteTime = Math.max(th.nextNoteTime, now);
  }

  /** Play a stinger straight on the music bus (used by play('ui.victory'|'ui.defeat')). */
  function stinger(kind, t = ctx.currentTime + 0.02) {
    const a = ARRANGEMENTS[musicTheme];
    if (kind === 'victory') stingerVictory(t, out, a.transpose, a.lead); else stingerDefeat(t, out, a.transpose);
  }

  function dispose() {
    if (current) { current.dispose(); current = null; }
    for (const th of fading) th.dispose();
    fading.length = 0;
    for (const v of [...activeVoices]) {
      for (const source of v.sources) { try { source.stop(ctx.currentTime); } catch { /* already stopped */ } }
      v.cleanup();
    }
    scene = 'none';
  }

  return {
    scheduler, setScene, setTheme, setIntensity, setBattleState, setFactionHint, pause, resume, stinger, dispose,
    get scene() { return scene; },
    get intensity() { return intensity; },
    get layersOn() { return layerOn.slice(); },
    get progB() { return progB; },
    get current() { return current; },
    get fading() { return fading.slice(); },
    get paused() { return paused; },
    get factionHint() { return factionHint; },
    get motifPending() { return motifPending; },
    /** Test hook: (themeName, step, time) for every scheduled step. */
    set onStep(fn) { stepHook = typeof fn === 'function' ? fn : null; },
    stats() { return { scene, musicTheme, bpm: current?.bpm || 0, section: current?.section || 'none', intensity, layers: layerOn.map((b) => (b ? 1 : 0)).join(''), progB, notes: notesScheduled, fading: fading.length, voices: activeVoices.size, peakVoices }; },
  };
}

export { MIN_GAIN };
