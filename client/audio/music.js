// Generative soundtrack for Frota Estelar: a lookahead sequencer (Chris
// Wilson style) with hand-written D minor progressions and themes:
//   menu     72 BPM ambient pad + sparse arp + sub drone
//   builder  96 BPM pad, bass, soft kick/hat, deterministic arp, faction fills
//   battle  128 BPM six intensity layers L0..L5 (hysteresis), progression B at
//            high intensity, lead phrases and faction motifs
//   victory / defeat   stingers followed by a calm (major) / dark loop
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
});

const THEME_BPM = { menu: 72, builder: 96, battle: 128, victory: 84, defeat: 60 };
export const THEME_BPM_TABLE = Object.freeze({ ...THEME_BPM });

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

  // ---- note helpers -------------------------------------------------------

  function voice(t, dest) {
    return createVoiceContext(ctx, { t, out: dest, gain: 1, size: 0, faction: null, rnd: rngAsRnd(), noise: bank, reverbIn, kind: 'music' });
  }

  function rngAsRnd() {
    const r = (min = 0, max = 1) => min + rng.next() * (max - min);
    r.next = () => rng.next();
    r.chance = (p) => rng.next() < p;
    return r;
  }

  function done(v) { finalizeVoice(v); notesScheduled++; }

  /** Detuned saws through a lowpass; slow attack. Optional cutoff LFO. */
  function pad(t, midi, dur, dest, { cutoff = 900, gain = 0.16, lfoHz = 0, lfoDepth = 0, type = 'sawtooth', detune = 7, send = 0 } = {}) {
    const v = voice(t, dest);
    const g = env(v, t, { a: Math.min(1.5, dur * 0.35), d: dur * 0.2, s: 0.7, hold: Math.max(0, dur * 0.45), r: 1.5, peak: gain }, dest);
    const f = lp(v, cutoff, 0.8, g);
    if (lfoHz > 0) { const l = osc(v, 'sine', lfoHz, t, null); const lg = gainNode(v, lfoDepth, null); l.connect(lg); lg.connect(f.frequency); play(v, l, t, t + dur + 2); }
    for (const m of midi) {
      for (const c of [-detune, 0, detune]) {
        const x = osc(v, type, mtof(m), t, f); x.detune.value = c; play(v, x, t, t + dur + 2);
      }
    }
    if (send > 0 && reverbIn) { const sg = gainNode(v, send, reverbIn); g.connect(sg); }
    done(v);
  }

  function bass(t, midi, dur, dest, { gain = 0.35 } = {}) {
    const v = voice(t, dest);
    const g = env(v, t, { a: 0.005, d: dur * 0.5, s: 0.3, r: 0.08, peak: gain }, dest);
    const f = lp(v, 400, 1.2, g); pitchSweep(f.frequency, 900, 300, t, t + 0.15);
    play(v, osc(v, 'sine', mtof(midi), t, f), t, t + dur);
    const qg = gainNode(v, 0.25, f);
    play(v, osc(v, 'square', mtof(midi + 12), t, qg), t, t + dur);
    done(v);
  }

  function arp(t, midi, dest, { gain = 0.14, cutoff = 2500 } = {}) {
    const v = voice(t, dest);
    const g = env(v, t, { a: 0.003, d: 0.18, r: 0.12, peak: gain }, dest);
    const f = lp(v, cutoff, 2, g);
    play(v, osc(v, 'triangle', mtof(midi), t, f), t, t + 0.4);
    play(v, osc(v, 'sine', mtof(midi + 12), t, f), t, t + 0.4);
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

  function drone(t, hz, dest, { gain = 0.12, type = 'sine' } = {}) {
    // persistent sub drone, returned so the theme can stop it
    const v = voice(t, dest);
    const g = gainNode(v, 0, dest);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 3);
    const o = osc(v, type, hz, t, g);
    o.start(t);
    v.sources.push(o);
    return { v, o, g };
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
    const bpm = THEME_BPM[name] || 100;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(out);
    const th = {
      name, bpm, bus,
      stepDur: 60 / bpm / 4,
      step: 0,
      nextNoteTime: startAt,
      startAt,
      stopAt: null,
      nodes: [bus],
      drones: [],
      layers: null,
      prog: null,
      phrase: null,
      fillUntil: -1,
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
        for (const d of this.drones) { try { d.o.stop(ctx.currentTime); } catch { /* ignore */ } try { d.v.cleanup ? d.v.cleanup() : d.v.nodes.forEach((n) => n.disconnect()); } catch { /* ignore */ } }
        for (const n of this.nodes) { try { n.disconnect(); } catch { /* ignore */ } }
        this.nodes.length = 0;
      },
    };
    BUILDERS[name](th);
    return th;
  }

  const BUILDERS = {
    menu(th) {
      const d = makeDelay(th.bpm, th.bus); th.nodes.push(...d.nodes);
      th.drones.push(drone(th.startAt, mtof(38), th.bus, { gain: 0.12 }));
      th.onStep = (t, step, time) => {
        const prog = PROGRESSIONS.menu;
        if (step % 32 === 0) {
          const chord = prog[(step / 32) % prog.length].slice();
          if (rng.next() < 0.3) chord.push(chord[0] + 26);   // open 9th
          pad(time, chord, 32 * t.stepDur, t.bus, { cutoff: 700, gain: 0.15, lfoHz: 0.05, lfoDepth: 200, send: 0.25 });
        }
        if (rng.next() < 0.22) arp(time, PENTA[5 + Math.floor(rng.next() * 6)], d.input, { gain: 0.08, cutoff: 2200 });
      };
    },
    builder(th) {
      const d = makeDelay(th.bpm, th.bus); th.nodes.push(...d.nodes);
      const ARP = [0, 2, 4, 2, 7, 4, 2, 0];
      th.onStep = (t, step, time) => {
        const prog = PROGRESSIONS.builder;
        const bar = Math.floor(step / STEPS_PER_BAR);
        const chord = prog[bar % prog.length];
        const s16 = step % STEPS_PER_BAR;
        if (s16 === 0) pad(time, chord, STEPS_PER_BAR * t.stepDur, t.bus, { cutoff: 1400, gain: 0.14, send: 0.15 });
        if (step % 2 === 0) {
          const e8 = (step / 2) % 8;
          if ([0, 3, 6].includes(e8)) bass(time, chord[0] + (e8 === 6 ? 12 : 0), 2 * t.stepDur, t.bus, { gain: 0.3 });
          if (e8 % 2 === 1) hat(time, t.bus, false, { gain: 0.08 });
          if (s16 === 0 || s16 === 8) kick(time, t.bus, { gain: 0.4 });
        }
        if (motifPending && s16 === 0 && factionHint && MOTIFS[factionHint]) {
          const m = MOTIFS[factionHint];
          m.notes.forEach((n, i) => lead(time + i * 2 * t.stepDur, n + 12, 2 * t.stepDur * 0.9, t.bus, { gain: 0.16, timbre: m.timbre }));
          motifPending = false;
          t.fillUntil = step + STEPS_PER_BAR;
        }
        if (!(t.fillUntil > step)) arp(time, PENTA[(ARP[s16 % 8] % PENTA.length)] + (s16 >= 8 ? 12 : 0), d.input, { gain: 0.1, cutoff: 2000 });
      };
    },
    battle(th) {
      th.layers = [];
      for (let k = 0; k < 6; k++) {
        const g = ctx.createGain(); g.gain.value = k === 0 ? 1 : 0; g.connect(th.bus); th.layers.push(g); th.nodes.push(g);
      }
      const d = makeDelay(th.bpm, th.layers[3]); th.nodes.push(...d.nodes);
      th.prog = 'A';
      th.drones.push(drone(th.startAt, mtof(38), th.layers[0], { gain: 0.1 }));
      const L = th.layers;
      th.onStep = (t, step, time) => {
        const s16 = step % STEPS_PER_BAR;
        const bar = Math.floor(step / STEPS_PER_BAR);
        if (step % 64 === 0) t.prog = progB ? 'B' : 'A';
        const prog = t.prog === 'B' ? PROGRESSIONS.battleB : PROGRESSIONS.battleA;
        const chord = prog[bar % prog.length];
        const root = chord[0];
        const now = ctx.currentTime;
        const active = (k) => layerOn[k] || now - layerOffAt[k] < 3;
        // L0 pad
        if (s16 === 0) pad(time, chord, STEPS_PER_BAR * t.stepDur, L[0], { cutoff: 900 + 900 * intensity, gain: 0.14, send: 0.2 });
        // L1 bass
        if (active(1)) {
          if (step % 2 === 0 && [0, 2, 4, 6, 7].includes((step / 2) % 8)) bass(time, root, 2 * t.stepDur, L[1]);
          if (s16 === 15) bass(time, root - 2, t.stepDur, L[1], { gain: 0.25 });
        }
        // L2 kick + hat
        if (active(2)) {
          if (s16 === 0 || s16 === 8) kick(time, L[2]);
          else if (s16 === 6 && intensity >= 0.5) kick(time, L[2], { gain: 0.5 });
          hat(time, L[2], s16 === 14, { gain: 0.1 });
        }
        // L3 snare + arp
        if (active(3)) {
          if (s16 === 4 || s16 === 12) snare(time, L[3]);
          const pat = [0, 4, 7, 4, 0, 4, 9, 4];
          arp(time, root + 24 + pat[s16 % 8], d.input, { gain: 0.11, cutoff: 2500 });
        }
        // L4 lead phrases (2 bars, 8ths); faction motif every 8 bars
        if (active(4) && step % 2 === 0) {
          if (step % 32 === 0) {
            const useMotif = bar % 8 === 0 && factionHint && MOTIFS[factionHint];
            t.phrase = useMotif ? { notes: MOTIFS[factionHint].notes, timbre: MOTIFS[factionHint].timbre } : { notes: rng.pick(LEAD_PHRASES), timbre: 'default' };
          }
          if (t.phrase) {
            const idx = (step % 32) / 2;
            if (idx < t.phrase.notes.length) lead(time, t.phrase.notes[idx] + 12, 2 * t.stepDur * 0.85, L[4], { gain: 0.15, timbre: t.phrase.timbre });
          }
        }
        // L5 toms + double kick
        if (active(5)) {
          if (s16 === 10) tom(time, 50, L[5]); else if (s16 === 12) tom(time, 45, L[5]); else if (s16 === 14) tom(time, 43, L[5]);
          if (step % 2 === 0 && s16 !== 0 && s16 !== 8) kick(time, L[5], { gain: 0.55 });
        }
      };
    },
    victory(th) {
      const d = makeDelay(th.bpm, th.bus); th.nodes.push(...d.nodes);
      th.onStep = (t, step, time) => {
        if (step === 0) stingerVictory(time, t.bus);
        const bar = Math.floor(step / STEPS_PER_BAR);
        if (bar >= 2) {
          const prog = PROGRESSIONS.victory;
          if (step % 32 === 0) pad(time, prog[((bar - 2) / 2) % prog.length], 32 * t.stepDur, t.bus, { cutoff: 1200, gain: 0.12, send: 0.3 });
          if (rng.next() < 0.18) arp(time, [62, 66, 69, 74, 78, 81][Math.floor(rng.next() * 6)] + 12, d.input, { gain: 0.07 });
        }
      };
    },
    defeat(th) {
      th.drones.push(drone(th.startAt + 1.5, mtof(38), th.bus, { gain: 0.12 }));
      th.onStep = (t, step, time) => {
        if (step === 0) stingerDefeat(time, t.bus);
        const bar = Math.floor(step / STEPS_PER_BAR);
        if (bar >= 1 && step % 32 === 16) {
          const prog = PROGRESSIONS.defeat;
          pad(time, prog[Math.floor(bar / 2) % prog.length], 32 * t.stepDur, t.bus, { cutoff: 500, gain: 0.12, type: 'triangle', send: 0.35 });
        }
        if (bar >= 1 && step % STEPS_PER_BAR === 0) tom(time, 38, t.bus, { gain: 0.28 });
        if (bar >= 2 && step % 32 === 24 && rng.next() < 0.5) arp(time, [62, 65, 69, 70][Math.floor(rng.next() * 4)], t.bus, { gain: 0.05, cutoff: 900 });
      };
    },
  };

  /** Victory stinger: IV–V–I in D major, 3 saw voices through a lowpass, 2.2 s. */
  function stingerVictory(t, dest) {
    const v = voice(t, dest);
    const chords = [[Gmaj, 0, 0.55], [Amaj, 0.5, 0.55], [Dmaj, 1.0, 1.4]];
    for (const [ch, off, dur] of chords) {
      const g = env(v, t + off, { a: 0.02, d: dur * 0.4, s: 0.7, hold: dur * 0.4, r: 0.5, peak: 0.22 }, dest);
      const f = lp(v, 2000, 0.8, g);
      for (const m of ch) play(v, osc(v, 'sawtooth', mtof(m + 12), t + off, f), t + off, t + off + dur + 0.6);
    }
    const sg = env(v, t, { a: 0.3, d: 1.2, r: 0.6, peak: 0.12 }, dest);
    play(v, noise(v, 'pink', t, hp(v, 4000, 0.7, sg)), t, t + 2.2);
    if (reverbIn) { const s = gainNode(v, 0.5, reverbIn); dest.connect(s); }
    done(v);
  }

  /** Defeat stinger: two sines descending D4→A3 in semitones over 1.8 s + brown rumble. */
  function stingerDefeat(t, dest) {
    const v = voice(t, dest);
    const g = env(v, t, { a: 0.05, d: 0.4, s: 0.8, hold: 1.0, r: 0.6, peak: 0.25 }, dest);
    const a = osc(v, 'sine', mtof(62), t, g), b = osc(v, 'sine', mtof(65), t, g);
    for (let i = 1; i <= 5; i++) { a.frequency.setValueAtTime(mtof(62 - i), t + i * 0.36); b.frequency.setValueAtTime(mtof(65 - i), t + i * 0.36); }
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
      th.onStep(th, th.step, time);
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

  function retire(th, tSwitch, fade) {
    th.bus.gain.setValueAtTime(1, tSwitch);
    th.bus.gain.linearRampToValueAtTime(0, tSwitch + fade);
    th.stopAt = tSwitch + fade + 0.2;
    fading.push(th);
  }

  /**
   * Switch scene with a crossfade on the outgoing theme's bar boundary
   * (eighth-note boundary for stingers so the ending lands promptly).
   * @param {'none'|'menu'|'builder'|'battle'|'victory'|'defeat'} next
   */
  function setScene(next) {
    if (next === scene) return;
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
    if (kind === 'victory') stingerVictory(t, out); else stingerDefeat(t, out);
  }

  function dispose() {
    if (current) { current.dispose(); current = null; }
    for (const th of fading) th.dispose();
    fading.length = 0;
    scene = 'none';
  }

  return {
    scheduler, setScene, setIntensity, setBattleState, setFactionHint, pause, resume, stinger, dispose,
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
    stats() { return { scene, intensity, layers: layerOn.map((b) => (b ? 1 : 0)).join(''), progB, notes: notesScheduled, fading: fading.length }; },
  };
}

export { MIN_GAIN };
