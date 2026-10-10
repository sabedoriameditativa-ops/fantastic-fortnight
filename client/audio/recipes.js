// Procedural SFX recipes for Frota Estelar (Web Audio, no asset files).
//
// Every recipe is a pure function of a voice context `v` and only talks to the
// injected AudioContext through the helpers below: it never constructs a
// context, never uses timers and never draws on the global random source
// (jitter comes from `v.rnd`, a deterministic LCG seeded from the sim event). The engine (index.js) builds the voice
// wrapper (voice gain → optional muffling lowpass → stereo panner → bus), the
// faction flavor stage and tracks every node so it can be disconnected when
// the last source ends.
//
// Node budget: a full voice (wrapper + flavor + recipe) stays ≤ 16 nodes on
// screen (≤ 17 when muffled). See docs/design/audio.md §2.

export const MIN_GAIN = 1e-4;

/** Audio size classes (catalog SIZE_CLASS.audioSize): 0 fighter … 4 capital. */
export const SIZE_NAMES = ['fighter', 'corvette', 'frigate', 'cruiser', 'capital'];

/**
 * Deterministic jitter source (LCG). Same seed → same sequence.
 * @param {number} seed
 * @returns {(min?:number, max?:number)=>number} rnd(min,max) float in [min,max)
 */
export function makeRnd(seed) {
  let s = (Number(seed) >>> 0) || 0x9e3779b9;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const rnd = (min = 0, max = 1) => min + next() * (max - min);
  rnd.next = next;
  rnd.chance = (p) => next() < p;
  return rnd;
}

/** MIDI note → Hz. */
export function mtof(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// ---------------------------------------------------------------------------
// Primitives (all track created nodes in v.nodes; sources in v.sources)
// ---------------------------------------------------------------------------

function track(v, n) { v.nodes.push(n); return n; }

/** Oscillator type remapped by faction flavor. */
function oscType(faction, type) {
  if (faction === 'lumen' && (type === 'square' || type === 'sawtooth')) return 'triangle';
  if (faction === 'vorrax' && type === 'square') return 'sawtooth';
  return type;
}

function noiseKind(faction, kind) {
  if (faction === 'lumen' && kind === 'white') return 'pink';
  return kind;
}

/**
 * Create an oscillator connected to `dest` (not started).
 * @param {object} v voice context
 * @param {OscillatorType} type
 * @param {number} f0 Hz at time t
 * @param {number} t
 * @param {AudioNode} [dest]
 */
export function osc(v, type, f0, t, dest) {
  const o = track(v, v.ctx.createOscillator());
  o.type = oscType(v.faction, type);
  o.frequency.setValueAtTime(Math.max(1, f0), t);
  if (v.lfoSpec && !v.lfo && !v.inLfo) {   // lazy faction LFO (vibrato / PWM) shared by every oscillator of the voice
    v.inLfo = true;
    const spec = v.lfoSpec;
    const lfo = track(v, v.ctx.createOscillator());
    lfo.type = spec.type;
    lfo.frequency.setValueAtTime(spec.hz, v.t);
    const lg = gainNode(v, spec.depth, null);
    lfo.connect(lg);
    v.lfo = lg;
    v.late.push(lfo);
    v.inLfo = false;
  }
  if (v.lfo) v.lfo.connect(o.detune);
  if (dest) o.connect(dest);
  return o;
}

/**
 * Looping noise source from the shared bank (not started). Start offset is
 * taken from v.rnd so simultaneous voices decorrelate.
 * @param {object} v
 * @param {'white'|'pink'|'brown'|'crackle'} kind
 * @param {number} t
 * @param {AudioNode} [dest]
 */
export function noise(v, kind, t, dest) {
  const n = track(v, v.ctx.createBufferSource());
  const buf = v.noise ? v.noise[noiseKind(v.faction, kind)] || v.noise.white : null;
  if (buf) n.buffer = buf;
  n.loop = true;
  const dur = buf && buf.duration ? buf.duration : 2;
  n._offset = v.rnd ? v.rnd(0, Math.max(0, dur - 0.3)) : 0;
  n._isNoise = true;
  if (dest) n.connect(dest);
  return n;
}

/**
 * Start/stop a source and register it in the voice.
 * @param {object} v
 * @param {AudioScheduledSourceNode} src
 * @param {number} t0
 * @param {number} t1
 */
export function play(v, src, t0, t1) {
  const end = Math.max(t1, t0 + 0.005);
  if (src._isNoise) src.start(t0, src._offset || 0); else src.start(t0);
  src.stop(end);
  src._t0 = t0; src._t1 = end;
  v.sources.push(src);
  return src;
}

/**
 * ADSR gain envelope connected to `dest`. Never ramps to 0 (uses MIN_GAIN).
 * @param {object} v
 * @param {number} t
 * @param {{a:number,d:number,s?:number,hold?:number,r:number,peak:number}} p
 * @param {AudioNode} dest
 * @returns {GainNode} with `.end` = time the release is essentially over
 */
export function env(v, t, p, dest) {
  const g = track(v, v.ctx.createGain());
  const peak = Math.max(MIN_GAIN, p.peak || 0);
  const a = Math.max(0.001, p.a || 0.001), d = Math.max(0.001, p.d || 0.001);
  const sus = Math.max(MIN_GAIN, (p.s || 0) * peak);
  const hold = Math.max(0, p.hold || 0);
  const r = Math.max(0.01, p.r || 0.05);
  // a late envelope (t > voice start) must not leak the source at the default gain 1 first
  if (v.t !== undefined && t > v.t) g.gain.setValueAtTime(0, v.t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(sus, t + a + d);
  const tOff = t + a + d + hold;
  if (hold > 0) g.gain.setValueAtTime(sus, tOff);
  g.gain.setTargetAtTime(MIN_GAIN, tOff, r / 4);
  g.end = tOff + r;
  if (dest) g.connect(dest);
  return g;
}

/** Plain gain node. */
export function gainNode(v, value, dest) {
  const g = track(v, v.ctx.createGain());
  g.gain.value = value;
  if (dest) g.connect(dest);
  return g;
}

function filter(v, type, f, q, dest) {
  const b = track(v, v.ctx.createBiquadFilter());
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  if (dest) b.connect(dest);
  return b;
}
export function lp(v, f, q = 0.7, dest) { return filter(v, 'lowpass', f, q, dest); }
export function bp(v, f, q = 1, dest) { return filter(v, 'bandpass', f, q, dest); }
export function hp(v, f, q = 0.7, dest) { return filter(v, 'highpass', f, q, dest); }
export function peaking(v, f, q, gainDb, dest) {
  const b = filter(v, 'peaking', f, q, dest);
  if (b.gain && typeof b.gain === 'object') b.gain.value = gainDb;
  return b;
}

const CURVES = new Map();
/** tanh(amount·x) waveshaper curve (cached per amount). */
export function tanhCurve(amount) {
  const key = 't' + amount;
  let c = CURVES.get(key);
  if (!c) {
    c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 511.5) - 1; c[i] = Math.tanh(amount * x); }
    CURVES.set(key, c);
  }
  return c;
}
/** Staircase curve (fake bitcrush) with `levels` steps. */
export function stepCurve(levels) {
  const key = 's' + levels;
  let c = CURVES.get(key);
  if (!c) {
    c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 511.5) - 1; c[i] = Math.round(x * (levels / 2)) / (levels / 2); }
    CURVES.set(key, c);
  }
  return c;
}

/** Soft saturation stage. */
export function dist(v, amount, dest) {
  const w = track(v, v.ctx.createWaveShaper());
  w.curve = tanhCurve(amount);
  w.oversample = '2x';
  if (dest) w.connect(dest);
  return w;
}

/** Fake bitcrusher (16-level staircase). */
export function stepShaper(v, dest, levels = 16) {
  const w = track(v, v.ctx.createWaveShaper());
  w.curve = stepCurve(levels);
  if (dest) w.connect(dest);
  return w;
}

/** Exponential pitch/filter sweep (never ramps to ≤ 0). */
export function pitchSweep(param, f0, f1, t0, t1) {
  param.setValueAtTime(Math.max(1, f0), t0);
  param.exponentialRampToValueAtTime(Math.max(1, f1), Math.max(t1, t0 + 0.001));
}

/** Reverb send: a gain from `node` to the shared convolver input (no-op without reverb). */
export function send(v, node, amount) {
  if (!v.reverbIn || amount <= 0) return null;
  const g = track(v, v.ctx.createGain());
  g.gain.value = amount;
  node.connect(g);
  g.connect(v.reverbIn);
  return g;
}

// ---------------------------------------------------------------------------
// Voice context
// ---------------------------------------------------------------------------

/**
 * Create a bare voice context (used by the engine for SFX/UI and by the music
 * engine for notes). Recipes read: ctx, t, out, gain, size, faction, rnd,
 * count, dur, noise, reverbIn.
 * @param {AudioContext} ctx
 * @param {object} o { t, out, gain, size, faction, rnd, count, dur, noise, reverbIn, kind }
 */
export function createVoiceContext(ctx, o) {
  return {
    ctx,
    t: o.t,
    out: o.out,
    gain: o.gain ?? 0.5,
    size: Math.max(0, Math.min(4, o.size | 0)),
    faction: o.faction || null,
    rnd: o.rnd || makeRnd(1),
    count: Math.max(1, o.count | 0),
    dur: o.dur || 0,
    noise: o.noise || null,
    reverbIn: o.reverbIn || null,
    kind: o.kind || '',
    nodes: [],
    sources: [],
    late: [],       // sources started after the recipe ran (LFOs) spanning the whole voice
    lfo: null,
    lfoSpec: null,
    inLfo: false,
    end: o.t,
  };
}

/**
 * Faction flavor stage. Returns the node the recipe should use as `out`.
 * The wrapper's `voiceGain` is the final mono point before pan.
 *   terran  mechanical: soft tanh saturation (+ a tiny metallic clank on shots)
 *   vorrax  wet organic: shared vibrato LFO on every oscillator + resonant mid bump
 *   lumen   harmonic crystalline: triangles instead of square/saw, pink instead of
 *           white, parallel high-Q ring at 2.2 kHz
 *   ferrix  digital/glitch: staircase shaper (fake bitcrush) + 40 Hz PWM-ish detune
 *           LFO, 10% chance of a short gate glitch
 * @param {object} v
 * @param {GainNode} voiceGain
 * @param {AudioNode} postGainDest where the lumen ring joins (after voiceGain)
 * @returns {AudioNode}
 */
export function applyFlavor(v, voiceGain, postGainDest) {
  const { t, faction, rnd } = v;
  switch (faction) {
    case 'terran': {
      const d = dist(v, 2.5, voiceGain);
      if (v.kind === 'shot' && v.size >= 1) {
        const cg = env(v, t, { a: 0.001, d: 0.008, r: 0.01, peak: v.gain * 0.15 }, voiceGain);
        const c = osc(v, 'sine', 2400 * rnd(0.9, 1.1), t, cg);
        play(v, c, t, t + 0.03);
      }
      return d;
    }
    case 'vorrax': {
      const pk = peaking(v, 650, 1.5, 5, voiceGain);
      v.lfoSpec = { type: 'sine', hz: rnd(18, 30), depth: 45 };
      return pk;
    }
    case 'lumen': {
      const ring = bp(v, 2200, 12, null);
      const rg = gainNode(v, 0.3, postGainDest);
      voiceGain.connect(ring);
      ring.connect(rg);
      return voiceGain;
    }
    case 'ferrix': {
      let dest = voiceGain;
      if (rnd.chance(0.1)) {
        const gate = gainNode(v, 1, voiceGain);
        for (let i = 0; i < 3; i++) {
          const ti = t + 0.05 + i * 0.02;
          gate.gain.setValueAtTime(0, ti);
          gate.gain.setValueAtTime(1, ti + 0.005);
        }
        dest = gate;
      }
      const sh = stepShaper(v, dest, 16);
      v.lfoSpec = { type: 'square', hz: 40, depth: 120 };
      return sh;
    }
    default:
      return voiceGain;
  }
}

/**
 * Finish a voice after its recipe ran: start late sources (LFOs) for the
 * voice's whole life, compute `v.end` and hook cleanup on the last source.
 * @param {object} v
 * @param {() => void} [onDone] called once after every node was disconnected
 * @returns {number} end time
 */
export function finalizeVoice(v, onDone) {
  let end = v.t + 0.01;
  let last = null;
  for (const s of v.sources) if (s._t1 >= end) { end = s._t1; last = s; }
  for (const l of v.late) { l.start(v.t); l.stop(end + 0.02); v.sources.push(l); }
  end += 0.02;
  v.end = end;
  let done = false;
  v.cleanup = () => {
    if (done) return;
    done = true;
    for (const n of v.nodes) { try { n.disconnect(); } catch { /* already gone */ } }
    v.nodes.length = 0;
    if (onDone) onDone();
  };
  if (last) last.onended = v.cleanup;
  else v.cleanup();
  return end;
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

function cannon(v) {
  const { t, out, gain, size, rnd } = v;
  const big = size >= 2;
  const f0 = (big ? 140 : 190) * rnd(0.95, 1.05);
  const g = env(v, t, { a: 0.002, d: 0.14, r: 0.06, peak: gain * 0.9 }, out);
  const body = osc(v, 'sine', f0, t, g);
  pitchSweep(body.frequency, f0, 55, t, t + 0.12);
  play(v, body, t, t + 0.2);
  const ng = env(v, t, { a: 0.001, d: 0.03, r: 0.02, peak: gain * 0.5 }, out);
  const n = noise(v, 'white', t, hp(v, 2000, 0.7, ng));
  play(v, n, t, t + 0.08);
  if (big) {
    const sg = env(v, t, { a: 0.004, d: 0.25, r: 0.1, peak: gain * 0.6 }, out);
    play(v, osc(v, 'sine', 48, t, sg), t, t + 0.4);
  }
}

function autocannon(v) {
  const { t, out, gain, rnd } = v;
  const n = 3 + Math.floor(rnd(0, 2));
  for (let i = 0; i < n; i++) {
    const ti = t + i * 0.045 * rnd(0.95, 1.05);
    const g = env(v, ti, { a: 0.001, d: 0.02, r: 0.015, peak: gain * 0.55 }, out);
    const o = osc(v, 'square', 320 * rnd(0.9, 1.1), ti, g);
    pitchSweep(o.frequency, 320, 90, ti, ti + 0.03);
    play(v, o, ti, ti + 0.05);
  }
}

function laser(v) {
  const { t, out, gain, size, rnd } = v;
  const dur = (0.1 + size * 0.04) * rnd(0.92, 1.08);
  const base = 220 * [1.7, 1.35, 1, 0.8, 0.62][size] * rnd(0.97, 1.03);
  const g = env(v, t, { a: 0.006, d: dur * 0.5, s: 0.55, hold: dur * 0.35, r: 0.07, peak: gain * 0.4 }, out);
  const f = lp(v, 1800, 4, g);
  pitchSweep(f.frequency, 2800, 700, t, t + dur);
  play(v, osc(v, 'sawtooth', base, t, f), t, t + dur + 0.12);
  play(v, osc(v, 'sine', base * 2, t, f), t, t + dur + 0.12);
}

function plasma(v) {
  const { t, out, gain, rnd } = v;
  const g = env(v, t, { a: 0.004, d: 0.22, r: 0.08, peak: gain * 0.7 }, out);
  const f = bp(v, 1200, 2.5, g);
  pitchSweep(f.frequency, 1600, 300, t, t + 0.25);
  const f0 = 900 * rnd(0.95, 1.05);
  const o1 = osc(v, 'triangle', f0, t, f); pitchSweep(o1.frequency, f0, 180, t, t + 0.28);
  const o2 = osc(v, 'sawtooth', f0 + 5, t, f); o2.detune.value = 12; pitchSweep(o2.frequency, f0 + 5, 182, t, t + 0.28);
  play(v, o1, t, t + 0.32); play(v, o2, t, t + 0.32);
}

function missile(v) {
  const { t, out, gain, rnd } = v;
  const ck = env(v, t, { a: 0.001, d: 0.01, r: 0.01, peak: gain * 0.4 }, out);
  play(v, osc(v, 'square', 2200, t, ck), t, t + 0.03);
  const t1 = t + 0.05;
  const g = env(v, t1, { a: 0.08, d: 0.4, r: 0.3, peak: gain * 0.6 }, out);
  const f = bp(v, 400, 1.2, g);
  pitchSweep(f.frequency, 400, 2500 * rnd(0.9, 1.1), t1, t1 + 0.4);
  f.frequency.exponentialRampToValueAtTime(600, t1 + 0.8);
  play(v, noise(v, 'pink', t1, f), t1, t1 + 0.85);
  const eg = env(v, t1, { a: 0.05, d: 0.5, r: 0.2, peak: gain * 0.25 }, out);
  const e = osc(v, 'sawtooth', 90, t1, eg); pitchSweep(e.frequency, 90, 140, t1, t1 + 0.55);
  play(v, e, t1, t1 + 0.8);
}

function torpedo(v) {
  const { t, out, gain, rnd } = v;
  const g = env(v, t, { a: 0.05, d: 0.7, r: 0.3, peak: gain * 0.8 }, out);
  const f = lp(v, 150, 1.0, g);
  pitchSweep(f.frequency, 150, 500 * rnd(0.9, 1.1), t, t + 0.6);
  play(v, noise(v, 'brown', t, f), t, t + 1.1);
  const sg = env(v, t, { a: 0.02, d: 0.6, r: 0.3, peak: gain * 0.7 }, out);
  play(v, osc(v, 'sine', 55 * rnd(0.95, 1.05), t, sg), t, t + 1.0);
}

function railgun(v) {
  const { t, out, gain, rnd } = v;
  const zg = env(v, t, { a: 0.02, d: 0.2, r: 0.03, peak: gain * 0.3 }, out);
  const z = osc(v, 'sine', 200, t, zg); pitchSweep(z.frequency, 200, 3200 * rnd(0.95, 1.05), t, t + 0.25);
  play(v, z, t, t + 0.27);
  const tc = t + 0.25;
  const cg = env(v, tc, { a: 0.001, d: 0.05, r: 0.05, peak: gain }, out);
  play(v, noise(v, 'white', tc, dist(v, 6, cg)), tc, tc + 0.1);
  const sg = env(v, tc, { a: 0.002, d: 0.3, r: 0.15, peak: gain * 0.8 }, out);
  const s = osc(v, 'sine', 70, tc, sg); pitchSweep(s.frequency, 70, 38, tc, tc + 0.3);
  play(v, s, tc, tc + 0.5);
  send(v, cg, 0.5);
}

function flak(v) {
  const { t, out, gain, rnd } = v;
  const pops = Math.min(2, Math.max(1, v.count));
  for (let i = 0; i < pops; i++) {
    const ti = t + i * 0.04 + rnd(0, 0.03);
    const g = env(v, ti, { a: 0.001, d: 0.05, r: 0.03, peak: gain * 0.5 }, out);
    const f = lp(v, 1200 * rnd(0.7, 1.3), 0.8, g);
    play(v, noise(v, 'white', ti, f), ti, ti + 0.12);
  }
}

function acidSpit(v) {
  const { t, out, gain, rnd } = v;
  const g = env(v, t, { a: 0.01, d: 0.25, r: 0.1, peak: gain * 0.6 }, out);
  const f0 = 600 * rnd(0.9, 1.1);
  const o = osc(v, 'sine', f0, t, g); pitchSweep(o.frequency, f0, 140, t, t + 0.3);
  const vib = osc(v, 'sine', 25, t, null); const vg = gainNode(v, 40, null); vib.connect(vg); vg.connect(o.frequency);
  const ng = env(v, t, { a: 0.005, d: 0.15, r: 0.1, peak: gain * 0.35 }, out);
  play(v, noise(v, 'brown', t, bp(v, 700, 3, ng)), t, t + 0.3);
  play(v, o, t, t + 0.35); play(v, vib, t, t + 0.35);
}

function ion(v) {
  const { t, out, gain, size, rnd } = v;
  const dur = 0.22 + size * 0.03;
  const g = env(v, t, { a: 0.003, d: dur * 0.6, r: 0.1, peak: gain * 0.5 }, out);
  const f = bp(v, 1500, 3, g);
  pitchSweep(f.frequency, 3000, 500, t, t + dur);
  const f0 = 1800 * rnd(0.95, 1.05);
  const o = osc(v, 'sawtooth', f0, t, f); pitchSweep(o.frequency, f0, 300, t, t + dur);
  play(v, o, t, t + dur + 0.12);
  const ng = env(v, t, { a: 0.002, d: dur * 0.5, r: 0.08, peak: gain * 0.35 }, out);
  play(v, noise(v, 'crackle', t, hp(v, 2500, 0.7, ng)), t, t + dur);
}

function beamCharge(v) {
  const { t, out, gain } = v;
  const dur = Math.max(0.4, Math.min(2.0, v.dur || 1.0));
  const g = env(v, t, { a: dur * 0.9, d: 0.05, r: 0.08, peak: gain * 0.5 }, out);
  const a = osc(v, 'sine', 330, t, g), b = osc(v, 'sine', 495, t, g);
  pitchSweep(a.frequency, 330, 660, t, t + dur); pitchSweep(b.frequency, 495, 990, t, t + dur);
  const f = bp(v, 500, 6, g); pitchSweep(f.frequency, 500, 6000, t, t + dur);
  const n = noise(v, 'white', t, f);
  for (const x of [a, b, n]) play(v, x, t, t + dur + 0.12);
}

// ---------------------------------------------------------------------------
// Impacts, shields, explosions
// ---------------------------------------------------------------------------

function hitHull(v) {
  const { t, out, gain, size, rnd } = v;
  const f0 = [900, 650, 420, 300, 200][size] * rnd(0.9, 1.1);
  const g = env(v, t, { a: 0.001, d: 0.08, r: 0.04, peak: gain * 0.5 }, out);
  const o = osc(v, 'triangle', f0, t, g); pitchSweep(o.frequency, f0, f0 * 0.45, t, t + 0.08);
  play(v, o, t, t + 0.14);
  const ng = env(v, t, { a: 0.001, d: 0.04, r: 0.02, peak: gain * 0.35 }, out);
  play(v, noise(v, 'crackle', t, hp(v, 1500, 0.7, ng)), t, t + 0.07);
}

function hitShield(v) {
  const { t, out, gain, size, rnd } = v;
  const f0 = (1400 + (1 - (v.shieldPct ?? 0.5)) * 900) * [1.25, 1.1, 1, 0.9, 0.8][size] * rnd(0.97, 1.03);
  const g = env(v, t, { a: 0.002, d: 0.18, r: 0.1, peak: gain * 0.45 }, out);
  const f = bp(v, f0, 9, g);
  const o1 = osc(v, 'sine', f0, t, f), o2 = osc(v, 'sine', f0 * 1.5, t, f);
  o2.detune.value = rnd(-20, 20);
  play(v, o1, t, t + 0.3); play(v, o2, t, t + 0.3);
  send(v, g, 0.3);
}

function shieldBreak(v) {
  const { t, out, gain, size, rnd } = v;
  const g = env(v, t, { a: 0.002, d: 0.3, r: 0.25, peak: gain * 0.4 }, out);
  const partials = [2400, 1500, 900];
  partials.forEach((p, i) => {
    const ti = t + i * 0.03;
    const o = osc(v, 'sine', p * rnd(0.97, 1.03), ti, g);
    pitchSweep(o.frequency, p, p * 0.35, ti, ti + 0.45);
    play(v, o, ti, ti + 0.55);
  });
  const ng = env(v, t, { a: 0.001, d: 0.12, r: 0.15, peak: gain * 0.6 }, out);
  play(v, noise(v, 'white', t, hp(v, 3000, 0.7, ng)), t, t + 0.3);
  if (size >= 3) {
    const sg = env(v, t, { a: 0.01, d: 0.4, r: 0.2, peak: gain * 0.5 }, out);
    play(v, osc(v, 'sine', 60, t, sg), t, t + 0.6);
  }
  send(v, ng, 0.6);
}

export const EXPLO = [
  { dur: 0.35, noiseLP: [3000, 400], sub: null, crackle: false, send: 0.2, peak: 0.6 },
  { dur: 0.6, noiseLP: [2500, 250], sub: [70, 40], crackle: false, send: 0.3, peak: 0.8 },
  { dur: 1.0, noiseLP: [2000, 150], sub: [60, 35], crackle: true, send: 0.45, peak: 1.0 },
  { dur: 1.8, noiseLP: [1500, 100], sub: [50, 30], crackle: true, send: 0.6, peak: 1.2 },
  { dur: 3.5, noiseLP: [1200, 60], sub: [42, 24], crackle: true, send: 0.8, peak: 1.5 },
];

function explosionOf(size) {
  return (v) => {
    const { t, out, gain, rnd } = v;
    const sz = Math.max(0, Math.min(4, size === undefined ? v.size : size));
    const p = EXPLO[sz];
    const dur = p.dur * rnd(0.9, 1.1);
    const g = env(v, t, { a: 0.004, d: dur * 0.5, r: dur * 0.5, peak: gain * p.peak }, out);
    const d = sz >= 2 ? dist(v, 2.5, g) : g;
    const f = lp(v, p.noiseLP[0], 0.9, d);
    pitchSweep(f.frequency, p.noiseLP[0], p.noiseLP[1], t, t + dur);
    play(v, noise(v, sz >= 3 ? 'brown' : 'white', t, f), t, t + dur + 0.1);
    if (p.sub) {
      const sg = env(v, t, { a: 0.01, d: dur * 0.6, r: dur * 0.4, peak: gain * p.peak * 0.9 }, out);
      const s = osc(v, 'sine', p.sub[0], t, sg);
      pitchSweep(s.frequency, p.sub[0], p.sub[1], t, t + dur);
      play(v, s, t, t + dur + 0.2);
    }
    if (p.crackle) {
      const cg = env(v, t + 0.1, { a: 0.05, d: dur * 0.7, r: 0.2, peak: gain * 0.3 }, out);
      play(v, noise(v, 'crackle', t, bp(v, 2500, 1, cg)), t + 0.1, t + dur);
    }
    send(v, g, p.send);
  };
}

const death = explosionOf(undefined);
const impactMissile = explosionOf(0);
const impactTorpedo = explosionOf(1);

function intercept(v) {
  const { t, out, gain, rnd } = v;
  const g = env(v, t, { a: 0.001, d: 0.06, r: 0.04, peak: gain * 0.4 }, out);
  const f = bp(v, 1800 * rnd(0.8, 1.2), 2, g);
  play(v, noise(v, 'white', t, f), t, t + 0.12);
}

// ---------------------------------------------------------------------------
// Abilities (by catalog `kind`)
// ---------------------------------------------------------------------------

function castBuff(v) {
  const { t, out, gain, rnd } = v;
  const g = env(v, t, { a: 0.02, d: 0.25, r: 0.15, peak: gain * 0.4 }, out);
  const f0 = 330 * rnd(0.97, 1.03);
  const a = osc(v, 'triangle', f0, t, g); pitchSweep(a.frequency, f0, f0 * 2, t, t + 0.22);
  const b = osc(v, 'sine', f0 * 1.5, t, g); pitchSweep(b.frequency, f0 * 1.5, f0 * 3, t, t + 0.22);
  play(v, a, t, t + 0.45); play(v, b, t, t + 0.45);
}

function castArea(v) {   // EMP / dissonance / singularity: rising zap then electric discharge
  const { t, out, gain } = v;
  const g = env(v, t, { a: 0.15, d: 0.1, r: 0.5, peak: gain * 0.7 }, out);
  const o = osc(v, 'sawtooth', 120, t, g);
  pitchSweep(o.frequency, 120, 2400, t, t + 0.15);
  o.frequency.exponentialRampToValueAtTime(80, t + 0.6);
  const sq = osc(v, 'square', 2400, t, g);
  pitchSweep(sq.frequency, 2400, 300, t + 0.15, t + 0.7);
  const ng = env(v, t + 0.15, { a: 0.005, d: 0.3, r: 0.4, peak: gain * 0.4 }, out);
  const n = noise(v, 'crackle', t + 0.15, hp(v, 2000, 0.7, ng));
  play(v, o, t, t + 0.9); play(v, sq, t, t + 0.9); play(v, n, t + 0.15, t + 0.9);
  send(v, g, 0.5);
}

function castHeal(v) {   // ascending pentatonic plucks + soft hiss
  const { t, out, gain } = v;
  [523, 659, 784].forEach((f, i) => {
    const ti = t + i * 0.09;
    const g = env(v, ti, { a: 0.005, d: 0.2, r: 0.15, peak: gain * 0.4 }, out);
    play(v, osc(v, 'triangle', f, ti, g), ti, ti + 0.4);
  });
  const hg = env(v, t, { a: 0.1, d: 0.4, r: 0.3, peak: gain * 0.15 }, out);
  play(v, noise(v, 'pink', t, bp(v, 4000, 2, hg)), t, t + 0.8);
}

function teleportOut(v) {
  const { t, out, gain } = v;
  const g = env(v, t, { a: 0.02, d: 0.3, r: 0.1, peak: gain * 0.6 }, out);
  const car = osc(v, 'sine', 1200, t, null); const mod = osc(v, 'sine', 310, t, null);
  const rm = gainNode(v, 0, g);
  mod.connect(rm.gain); car.connect(rm);
  pitchSweep(car.frequency, 1200, 200, t, t + 0.35);
  play(v, car, t, t + 0.4); play(v, mod, t, t + 0.4);
}

function teleportIn(v) {
  const { t, out, gain } = v;
  const g = env(v, t, { a: 0.25, d: 0.05, r: 0.08, peak: gain * 0.5 }, out);
  const car = osc(v, 'sine', 200, t, null); const mod = osc(v, 'sine', 310, t, null);
  const rm = gainNode(v, 0, g);
  mod.connect(rm.gain); car.connect(rm);
  pitchSweep(car.frequency, 200, 1200, t, t + 0.3);
  play(v, car, t, t + 0.4); play(v, mod, t, t + 0.4);
}

function cloak(v) {
  const { t, out, gain } = v;
  const g = env(v, t, { a: 0.1, d: 0.5, r: 0.6, peak: gain * 0.35 }, out);
  const f = bp(v, 800, 5, g);
  const lfo = osc(v, 'sine', 1.5, t, null); const lg = gainNode(v, 600, null); lfo.connect(lg); lg.connect(f.frequency);
  const n = noise(v, 'pink', t, f);
  const o = osc(v, 'sine', 220, t, g); pitchSweep(o.frequency, 220, 110, t, t + 1.0);
  for (const x of [n, o, lfo]) play(v, x, t, t + 1.3);
}

function droneLaunch(v) {   // mechanical clack + rising whine per drone (max 2 voices, shared filters)
  const { t, out, gain } = v;
  const n = Math.min(2, Math.max(1, v.count));
  const hpf = hp(v, 2500, 1, out);
  const lpf = lp(v, 2000, 2, out);
  for (let i = 0; i < n; i++) {
    const ti = t + i * 0.07;
    const cg = env(v, ti, { a: 0.001, d: 0.03, r: 0.02, peak: gain * 0.3 }, hpf);
    play(v, noise(v, 'white', ti, cg), ti, ti + 0.05);
    const wg = env(v, ti + 0.03, { a: 0.05, d: 0.2, r: 0.1, peak: gain * 0.2 }, lpf);
    const w = osc(v, 'sawtooth', 500, ti, wg); pitchSweep(w.frequency, 500, 1400, ti + 0.03, ti + 0.3);
    play(v, w, ti + 0.03, ti + 0.4);
  }
}

function castAura(v) {   // bright swell: 3 sines (1 : 1.5 : 2) rising a fourth, long ring
  const { t, out, gain } = v;
  [440, 660, 880].forEach((f, i) => {
    const g = env(v, t, { a: 0.25, d: 0.6, r: 0.8, peak: gain * [0.5, 0.3, 0.2][i] }, out);
    const o = osc(v, 'sine', f * 0.75, t, g); pitchSweep(o.frequency, f * 0.75, f, t, t + 0.3);
    play(v, o, t, t + 1.8);
  });
  send(v, out, 0.6);
}

function castLatch(v) {   // wet bite: descending growl with vibrato + brown splash
  const { t, out, gain, rnd } = v;
  const g = env(v, t, { a: 0.01, d: 0.3, r: 0.2, peak: gain * 0.55 }, out);
  const f0 = 320 * rnd(0.95, 1.05);
  const o = osc(v, 'sawtooth', f0, t, g); pitchSweep(o.frequency, f0, 70, t, t + 0.4);
  const vib = osc(v, 'sine', 14, t, null); const vg = gainNode(v, 25, null); vib.connect(vg); vg.connect(o.frequency);
  const ng = env(v, t, { a: 0.003, d: 0.2, r: 0.15, peak: gain * 0.4 }, out);
  play(v, noise(v, 'brown', t, lp(v, 500, 1, ng)), t, t + 0.4);
  play(v, o, t, t + 0.5); play(v, vib, t, t + 0.5);
}

function bilePop(v) {   // bile burst: wet pop
  const { t, out, gain, rnd } = v;
  const g = env(v, t, { a: 0.003, d: 0.12, r: 0.08, peak: gain * 0.45 }, out);
  const f0 = 500 * rnd(0.9, 1.1);
  const o = osc(v, 'sine', f0, t, g); pitchSweep(o.frequency, f0, 90, t, t + 0.12);
  play(v, o, t, t + 0.2);
  const ng = env(v, t, { a: 0.002, d: 0.08, r: 0.06, peak: gain * 0.3 }, out);
  play(v, noise(v, 'brown', t, bp(v, 900, 2, ng)), t, t + 0.15);
}

function healTick(v) {   // small sparkle for large heals
  const { t, out, gain, rnd } = v;
  const f0 = 1046 * rnd(0.98, 1.02);
  const g = env(v, t, { a: 0.004, d: 0.15, r: 0.1, peak: gain * 0.25 }, out);
  const o = osc(v, 'triangle', f0, t, g); pitchSweep(o.frequency, f0, f0 * 1.5, t, t + 0.12);
  play(v, o, t, t + 0.3);
}

function alarm(v) {   // sudden death: two-tone klaxon
  const { t, out, gain } = v;
  for (let i = 0; i < 2; i++) {
    const ti = t + i * 0.35;
    const g = env(v, ti, { a: 0.01, d: 0.1, s: 0.8, hold: 0.15, r: 0.08, peak: gain * 0.35 }, out);
    const f = lp(v, 1500, 1, g);
    play(v, osc(v, 'square', i ? 440 : 587, ti, f), ti, ti + 0.4);
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function uiHover(v) {
  const g = env(v, v.t, { a: 0.002, d: 0.02, r: 0.01, peak: v.gain * 0.12 }, v.out);
  play(v, osc(v, 'sine', 1800, v.t, g), v.t, v.t + 0.04);
}
function uiClick(v) {
  const g = env(v, v.t, { a: 0.001, d: 0.03, r: 0.015, peak: v.gain * 0.25 }, v.out);
  const o = osc(v, 'square', 900, v.t, g); pitchSweep(o.frequency, 900, 450, v.t, v.t + 0.03);
  play(v, o, v.t, v.t + 0.06);
}
function uiTick(v) {
  const g = env(v, v.t, { a: 0.001, d: 0.015, r: 0.01, peak: v.gain * 0.12 }, v.out);
  play(v, osc(v, 'triangle', 1400, v.t, g), v.t, v.t + 0.03);
}
function uiConfirm(v) {
  [660, 990].forEach((f, i) => {
    const ti = v.t + i * 0.06;
    const g = env(v, ti, { a: 0.003, d: 0.05, r: 0.04, peak: v.gain * 0.3 }, v.out);
    play(v, osc(v, 'triangle', f, ti, g), ti, ti + 0.1);
  });
}
function uiError(v) {
  const g = env(v, v.t, { a: 0.005, d: 0.1, s: 0.7, hold: 0.07, r: 0.06, peak: v.gain * 0.3 }, v.out);
  const f = lp(v, 1200, 0.7, g);
  play(v, osc(v, 'square', 220, v.t, f), v.t, v.t + 0.2);
  play(v, osc(v, 'square', 233, v.t, f), v.t, v.t + 0.2);
}
function uiBuy(v) {
  const g = env(v, v.t, { a: 0.002, d: 0.15, r: 0.08, peak: v.gain * 0.3 }, v.out);
  const o = osc(v, 'triangle', 1046, v.t, g); o.detune.value = v.rnd(-15, 15);
  play(v, o, v.t, v.t + 0.25);
}
function uiCountdown(v) {
  const g = env(v, v.t, { a: 0.003, d: 0.08, r: 0.03, peak: v.gain * 0.3 }, v.out);
  play(v, osc(v, 'sine', 880, v.t, g), v.t, v.t + 0.12);
}
function uiGo(v) {
  const g = env(v, v.t, { a: 0.003, d: 0.25, r: 0.1, peak: v.gain * 0.35 }, v.out);
  play(v, osc(v, 'sine', 1320, v.t, g), v.t, v.t + 0.4);
  const sg = env(v, v.t, { a: 0.005, d: 0.3, r: 0.15, peak: v.gain * 0.4 }, v.out);
  play(v, osc(v, 'sine', 55, v.t, sg), v.t, v.t + 0.5);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** name → recipe(v). */
export const RECIPES = Object.freeze({
  'shot.kinetic': cannon,
  'shot.autocannon': autocannon,
  'shot.railgun': railgun,
  'shot.flak': flak,
  'shot.laser': laser,
  'shot.plasma': plasma,
  'shot.missile': missile,
  'shot.torpedo': torpedo,
  'shot.bio': acidSpit,
  'shot.ion': ion,
  'charge': beamCharge,
  'hit.hull': hitHull,
  'hit.shield': hitShield,
  'shield.break': shieldBreak,
  'death': death,
  'impact.missile': impactMissile,
  'impact.torpedo': impactTorpedo,
  'impact.intercept': intercept,
  'cast.buff': castBuff,
  'cast.buff_ally': castBuff,
  'cast.area': castArea,
  'cast.heal': castHeal,
  'cast.teleport': teleportOut,
  'cast.teleport_in': teleportIn,
  'cast.stealth': cloak,
  'cast.spawn': droneLaunch,
  'cast.aura': castAura,
  'cast.latch': castLatch,
  'cast.passive': bilePop,
  'heal': healTick,
  'alarm': alarm,
  'ui.hover': uiHover,
  'ui.click': uiClick,
  'ui.tick': uiTick,
  'ui.confirm': uiConfirm,
  'ui.error': uiError,
  'ui.buy': uiBuy,
  'ui.countdown': uiCountdown,
  'ui.go': uiGo,
});

/** Names that play on the SFX bus (spatialized, pooled, coalesced). */
export const SFX_NAMES = Object.freeze(Object.keys(RECIPES).filter((n) => !n.startsWith('ui.')));
/** Names that play on the UI bus. */
export const UI_NAMES = Object.freeze(Object.keys(RECIPES).filter((n) => n.startsWith('ui.')));

/** Voice-steal priorities (higher wins). */
export const PRIORITY = Object.freeze({
  'death': [35, 55, 55, 80, 100],       // by size
  'shield.break': 70,
  'cast.area': 65, 'cast.aura': 60, 'cast.spawn': 60, 'cast.teleport': 60, 'cast.teleport_in': 58,
  'cast.heal': 55, 'cast.stealth': 55, 'cast.latch': 55, 'cast.buff': 50, 'cast.buff_ally': 50, 'cast.passive': 30,
  'charge': 60, 'alarm': 90,
  'shot.torpedo': 50, 'shot.railgun': 50, 'shot.missile': 40, 'impact.torpedo': 45, 'impact.missile': 35, 'impact.intercept': 15,
  'hit.hull': 25, 'hit.shield': 25, 'heal': 20,
  'shot.laser': 20, 'shot.plasma': 20, 'shot.ion': 22, 'shot.bio': 18, 'shot.kinetic': 15, 'shot.autocannon': 10, 'shot.flak': 10,
});

/**
 * Priority for a sound name at a size class.
 * @param {string} name
 * @param {number} size
 */
export function priorityOf(name, size = 0) {
  const p = PRIORITY[name];
  if (Array.isArray(p)) return p[Math.max(0, Math.min(4, size | 0))];
  return p === undefined ? 20 : p;
}

/** Per-second rate limits by name (token bucket in the engine). */
export const RATE_LIMITS = Object.freeze({
  'hit.hull': 12, 'hit.shield': 12, 'shot.kinetic': 16, 'shot.autocannon': 16, 'shot.flak': 16,
  'shot.laser': 10, 'shot.plasma': 12, 'shot.bio': 10, 'shot.ion': 10, 'shot.missile': 8, 'shot.torpedo': 6,
  'impact.missile': 8, 'impact.intercept': 8, 'heal': 3, 'death': 20,
});

/**
 * Run a recipe on a prepared voice context.
 * @param {string} name
 * @param {object} v
 * @returns {boolean} false when the name is unknown
 */
export function runRecipe(name, v) {
  const r = RECIPES[name];
  if (!r) return false;
  r(v);
  return true;
}
