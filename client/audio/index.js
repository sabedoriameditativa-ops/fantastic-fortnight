// AudioEngine for Frota Estelar — docs/ARCHITECTURE.md §5.4, docs/SPEC.md §7,
// docs/design/audio.md. Everything is synthesized at runtime (no asset files).
//
//   [SFX voices] → sfxBus → sfxComp ─┐
//   [UI voices]  → uiBus ────────────┼→ master → limiter → destination
//   [Music]      → musicBus → musicLP ┘      ↑
//   reverb (shared convolver, synthetic IR) → reverbReturn ┘
//
// The singleton `audio` is created with browser defaults; `createAudioEngine`
// takes injectable dependencies (AudioContext factory, storage, timers,
// document) so the whole engine runs under node:test with a mock context.

import { SHIPS, SIZE_CLASS, ABILITIES } from '/shared/catalog.js';
import { createRng } from '/shared/rng.js';
import {
  RECIPES, SFX_NAMES, RATE_LIMITS, priorityOf, makeRnd, createVoiceContext, applyFlavor, finalizeVoice, runRecipe, MIN_GAIN,
} from './recipes.js';
import { createMusicEngine, computeIntensity } from './music.js';

export const SETTINGS_KEY = 'frotaEstelar.audio.v1';
export const DEFAULT_SETTINGS = Object.freeze({ master: 0.8, music: 0.8, sfx: 0.75, ui: 0.8, muted: false });
export const MAX_VOICES = 24;
export const COALESCE_WINDOW = 0.03;
export const COALESCE_MAX_MUL = 2.2;
export const CULL_GAIN = 0.03;
/** Headroom trim on the music bus so a full-intensity battle at slider 100% never peaks above 0 dBFS. */
export const MUSIC_TRIM = 1.0;
export const TICK_MS = 25;
const BUS_NAMES = ['master', 'music', 'sfx', 'ui'];
const SCENES = ['none', 'menu', 'builder', 'battle', 'victory', 'defeat'];

/** Clamp helper. */
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/**
 * Normalize a settings object (unknown/corrupt → defaults).
 * @param {any} raw
 * @returns {{ master:number, music:number, sfx:number, ui:number, muted:boolean }}
 */
export function normalizeAudioSettings(raw) {
  const s = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;
  for (const k of BUS_NAMES) {
    if (typeof raw[k] !== 'number' && typeof raw[k] !== 'string') continue;
    const v = Number(raw[k]);
    if (Number.isFinite(v)) s[k] = clamp(v, 0, 1);
  }
  s.muted = !!raw.muted;
  return s;
}

/**
 * Spatialize a world position relative to the camera (docs/design/audio.md §1.4).
 * @param {number} x
 * @param {number} y
 * @param {{ cx:number, cy:number, hw:number, aspect:number }} cam
 * @returns {{ pan:number, gain:number, lpHz:number, dist:number }}
 */
export function spatialize(x, y, cam) {
  const hw = cam.hw > 1 ? cam.hw : 1;
  const hh = hw / (cam.aspect > 0.1 ? cam.aspect : 16 / 9);
  const dx = (x - cam.cx) / hw;
  const dy = (y - cam.cy) / hh;
  const pan = clamp(dx * 0.8, -0.8, 0.8);
  const dist = Math.hypot(dx, dy);
  const gain = dist <= 1 ? 1 : 1 / (1 + 1.5 * (dist - 1) * (dist - 1));
  const lpHz = dist <= 1 ? 20000 : Math.max(900, 20000 / (1 + 4 * (dist - 1)));
  return { pan, gain, lpHz, dist };
}

/**
 * Build the shared noise bank (2 s stereo-decorrelated buffers).
 * @param {AudioContext} ctx
 * @param {{ next():number }} rng
 */
export function buildNoiseBank(ctx, rng) {
  const sr = ctx.sampleRate || 48000;
  const len = Math.floor(sr * 2);
  const make = (fill) => {
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) fill(buf.getChannelData(ch));
    return buf;
  };
  const white = make((d) => { for (let i = 0; i < d.length; i++) d[i] = rng.next() * 2 - 1; });
  const pink = make((d) => {   // Paul Kellet 3-pole approximation
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = rng.next() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
    }
  });
  const brown = make((d) => {
    let acc = 0, peak = 1e-6;
    for (let i = 0; i < d.length; i++) { acc = acc * 0.98 + (rng.next() * 2 - 1) * 0.1; d[i] = acc; if (Math.abs(acc) > peak) peak = Math.abs(acc); }
    const k = 0.9 / peak;
    for (let i = 0; i < d.length; i++) d[i] *= k;
  });
  const crackle = make((d) => { for (let i = 0; i < d.length; i++) { const w = rng.next() * 2 - 1; d[i] = w * (rng.next() < 0.02 ? 1 : 0.05); } });
  return { white, pink, brown, crackle };
}

/**
 * Synthetic stereo impulse response: exponentially decaying noise, 1.4 s.
 * @param {AudioContext} ctx
 * @param {{ next():number }} rng
 */
export function buildReverbIR(ctx, rng, seconds = 1.4) {
  const sr = ctx.sampleRate || 48000;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (rng.next() * 2 - 1) * Math.pow(1 - t, 2.2) * (i < 40 ? i / 40 : 1);
    }
  }
  return buf;
}

function defaultCreateContext() {
  const AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
  if (!AC) return null;
  try { return new AC({ latencyHint: 'interactive' }); } catch { return new AC(); }
}

function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/**
 * Create an audio engine instance.
 * @param {Object} [deps]
 * @param {() => AudioContext|null} [deps.createContext]
 * @param {Storage|null} [deps.storage]
 * @param {(fn:Function, ms:number)=>any} [deps.setInterval]
 * @param {(h:any)=>void} [deps.clearInterval]
 * @param {Document|null} [deps.document]
 * @param {number|string} [deps.seed]   seed for the noise bank / music rng
 */
export function createAudioEngine(deps = {}) {
  const D = {
    createContext: deps.createContext || defaultCreateContext,
    storage: deps.storage !== undefined ? deps.storage : defaultStorage(),
    setInterval: deps.setInterval || ((fn, ms) => setInterval(fn, ms)),
    clearInterval: deps.clearInterval || ((h) => clearInterval(h)),
    document: deps.document !== undefined ? deps.document : (typeof document !== 'undefined' ? document : null),
    seed: deps.seed !== undefined ? deps.seed : (typeof Date !== 'undefined' ? Date.now() : 1),
  };

  /** @type {AudioContext|null} */
  let ctx = null;
  let ready = false;
  let timer = null;
  let buses = null;
  let noiseBank = null;
  let reverbIn = null;
  let music = null;
  let settings = loadSettings();
  let scene = 'none';
  let factionHint = null;
  let hidden = false;
  const cam = { cx: 0, cy: 0, hw: 1400, aspect: 16 / 9, set: false };
  const voices = [];                 // active SFX voices (pooled)
  const dying = [];                  // stolen voices fading out (cleaned up by gcVoices)
  const recent = new Map();          // coalescing slots by key
  const buckets = new Map();         // rate limit token buckets by name
  const deferred = [];               // { at, name, opts }
  const projectiles = new Map();     // projId → { type, size, faction } for missile/torpedo impacts
  const beds = [null, null];         // engine ambience per team
  const teamFaction = [null, null];
  const battle = { aliveFrac: [1, 1], destroyedFrac: 0, elapsedSec: 0, engaged: false, suddenDeath: false, density: 0 };
  const densitySample = { t: 0, n: 0 };
  let frameSerial = 0;
  const stats = { voices: 0, created: 0, coalesced: 0, dropped: 0, culled: 0, maxVoices: 0, ui: 0, nodesCreated: 0 };

  // ---- settings -----------------------------------------------------------

  function loadSettings() {
    try {
      const raw = D.storage ? D.storage.getItem(SETTINGS_KEY) : null;
      return normalizeAudioSettings(raw ? JSON.parse(raw) : null);
    } catch { return { ...DEFAULT_SETTINGS }; }
  }

  function saveSettings() {
    try { if (D.storage) D.storage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* quota / private mode */ }
  }

  function applySettings() {
    if (!ctx || !buses) return;
    const now = ctx.currentTime;
    const m = settings.muted;
    buses.master.gain.setTargetAtTime(m ? 0 : settings.master * settings.master, now, 0.02);
    buses.music.gain.setTargetAtTime(hidden ? 0 : settings.music * settings.music * MUSIC_TRIM, now, 0.02);
    buses.sfx.gain.setTargetAtTime(settings.sfx * settings.sfx, now, 0.02);
    buses.ui.gain.setTargetAtTime(settings.ui * settings.ui, now, 0.02);
  }

  // ---- graph --------------------------------------------------------------

  function buildBuses() {
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    master.connect(limiter); limiter.connect(ctx.destination);

    const sfx = ctx.createGain();
    const sfxComp = ctx.createDynamicsCompressor();
    sfxComp.threshold.value = -18; sfxComp.knee.value = 12; sfxComp.ratio.value = 4; sfxComp.attack.value = 0.005; sfxComp.release.value = 0.08;
    sfx.connect(sfxComp); sfxComp.connect(master);

    const ui = ctx.createGain();
    ui.connect(master);

    const musicBus = ctx.createGain();
    const musicLP = ctx.createBiquadFilter();
    musicLP.type = 'lowpass'; musicLP.frequency.value = 20000; musicLP.Q.value = 0.5;
    musicBus.connect(musicLP); musicLP.connect(master);

    const reverb = ctx.createConvolver();
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.18;
    reverb.connect(reverbReturn); reverbReturn.connect(master);

    buses = { master, limiter, sfx, sfxComp, ui, music: musicBus, musicLP, reverb, reverbReturn };
    reverbIn = reverb;
    for (const b of [master, sfx, ui, musicBus]) b.gain.value = 0;
  }

  /**
   * Create the AudioContext (synchronously, inside the gesture handler) and
   * resume it. Idempotent; later calls only resume a suspended context.
   * @returns {Promise<void>}
   */
  function init() {
    if (ctx) {
      if (ctx.state !== 'running' && typeof ctx.resume === 'function') return Promise.resolve(ctx.resume()).then(() => {}, () => {});
      return Promise.resolve();
    }
    let c = null;
    try { c = D.createContext(); } catch { c = null; }
    if (!c) return Promise.resolve();
    ctx = c;
    const rng = createRng(D.seed);
    buildBuses();
    noiseBank = buildNoiseBank(ctx, rng);
    try { buses.reverb.buffer = buildReverbIR(ctx, rng); } catch { /* some mocks have no buffer */ }
    music = createMusicEngine({ ctx, out: buses.music, noise: noiseBank, reverbIn, rng: createRng(String(D.seed) + ':music') });
    ready = true;
    applySettings();
    timer = D.setInterval(tick, TICK_MS);
    if (D.document && typeof D.document.addEventListener === 'function') D.document.addEventListener('visibilitychange', onVisibility);
    // flush state set before the gesture
    if (scene !== 'none') { music.setScene(scene); if (scene === 'battle') startBeds(); }
    if (factionHint) music.setFactionHint(factionHint);
    const p = typeof ctx.resume === 'function' ? ctx.resume() : null;
    return Promise.resolve(p).then(() => {}, () => {});
  }

  function onVisibility() {
    if (!ctx || !D.document) return;
    hidden = D.document.visibilityState === 'hidden';
    const now = ctx.currentTime;
    if (hidden) {
      buses.music.gain.cancelScheduledValues(now);
      buses.music.gain.setTargetAtTime(0, now, 0.1);
      music.pause();
      for (const b of beds) if (b) b.gain.gain.setTargetAtTime(0, now, 0.1);
    } else {
      music.resume();
      applySettings();
      if (ctx.state !== 'running' && typeof ctx.resume === 'function') { try { ctx.resume(); } catch { /* ignore */ } }
    }
  }

  // ---- voice pool ---------------------------------------------------------

  function gcVoices(now) {
    for (let i = voices.length - 1; i >= 0; i--) {
      const v = voices[i];
      if (v.dead || v.end + 0.5 < now) { v.cleanup(); voices.splice(i, 1); }
    }
    // stolen voices: their graph stays connected until the 10 ms fade + stop have played out
    for (let i = dying.length - 1; i >= 0; i--) {
      const v = dying[i];
      if (v.end + 0.1 < now) { v.cleanup(); dying.splice(i, 1); }
    }
  }

  function acquire(priority, now) {
    if (voices.length < MAX_VOICES) return true;
    gcVoices(now);
    if (voices.length < MAX_VOICES) return true;
    let victim = voices[0];
    for (const v of voices) if (v.priority < victim.priority || (v.priority === victim.priority && v.end < victim.end)) victim = v;
    if (victim.priority >= priority) return false;
    killVoice(victim, now);
    return true;
  }

  function killVoice(v, now) {
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, 0.01);
      for (const s of v.sources) { try { s.stop(now + 0.05); } catch { /* already stopped */ } }
    } catch { /* ignore */ }
    v.dead = true;
    const i = voices.indexOf(v);
    if (i >= 0) voices.splice(i, 1);
    // Do not disconnect now: that would cut the voice hard (click) before the
    // fade plays. The last source's onended runs cleanup; gcVoices is the backstop.
    v.end = now + 0.05;
    dying.push(v);
  }

  function rateLimited(name, now) {
    const lim = RATE_LIMITS[name];
    if (!lim) return false;
    const burst = Math.max(1, lim / 2);
    let b = buckets.get(name);
    if (!b) { b = { tokens: burst, last: now }; buckets.set(name, b); }
    b.tokens = Math.min(burst, b.tokens + (now - b.last) * lim);
    b.last = now;
    if (b.tokens < 1) return true;
    b.tokens -= 1;
    return false;
  }

  /**
   * Spawn a pooled, spatialized SFX voice.
   * @returns {object|null} voice
   */
  function spawnSfx(name, o, t) {
    const now = ctx.currentTime;
    const size = clamp(o.size | 0, 0, 4);
    let sp = { pan: 0, gain: 1, lpHz: 20000, dist: 0 };
    const hasPos = Number.isFinite(o.x) && Number.isFinite(o.y) && !(o.x === 0 && o.y === 0);
    if (hasPos && cam.set) sp = spatialize(o.x, o.y, cam);
    const base = (o.gain ?? 1) * sp.gain;
    if (base < CULL_GAIN) { stats.culled++; stats.dropped++; return null; }
    if ((name === 'hit.hull' || name === 'hit.shield') && size < 1 && sp.dist > 0.6) { stats.culled++; stats.dropped++; return null; }
    const key = `${name}|${o.faction || ''}|${size}`;
    const slot = recent.get(key);
    if (slot && t - slot.t < COALESCE_WINDOW && slot.voice && !slot.voice.dead) {
      slot.count++;
      const mul = Math.min(COALESCE_MAX_MUL, 1 + 0.35 * Math.log2(slot.count));
      slot.voice.gain.gain.setTargetAtTime(mul, now, 0.01);
      slot.voice.coalesceMul = mul;
      stats.coalesced++;
      return null;
    }
    if (rateLimited(name, now)) { stats.dropped++; return null; }
    const priority = priorityOf(name, size);
    if (!acquire(priority, now)) { stats.dropped++; return null; }

    // wrapper: voiceGain → (lp) → panner → sfxBus
    const vg = ctx.createGain();
    vg.gain.value = 1;
    const panner = ctx.createStereoPanner();
    panner.pan.value = sp.pan;
    panner.connect(buses.sfx);
    const nodes = [vg, panner];
    let post = panner;
    if (sp.lpHz < 19000) {
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass'; lpf.frequency.value = sp.lpHz; lpf.Q.value = 0.5;
      lpf.connect(panner); post = lpf; nodes.push(lpf);
    }
    vg.connect(post);

    const v = createVoiceContext(ctx, {
      t, out: vg, gain: base, size, faction: o.faction, rnd: makeRnd(o.seed ?? 1), count: o.count, dur: o.dur,
      noise: noiseBank, reverbIn, kind: name.split('.')[0],
    });
    v.shieldPct = o.shieldPct;
    v.nodes.push(...nodes);
    v.out = applyFlavor(v, vg, post);
    v.gainNode = vg;
    runRecipe(name, v);
    const voice = { name, priority, gain: vg, sources: v.sources, end: 0, dead: false, cleanup: null, coalesceMul: 1, v };
    voice.end = finalizeVoice(v, () => { voice.dead = true; const i = voices.indexOf(voice); if (i >= 0) voices.splice(i, 1); });
    voice.cleanup = v.cleanup;
    voices.push(voice);
    recent.set(key, { t, count: 1, voice });
    stats.created++;
    stats.nodesCreated += v.nodes.length;
    if (voices.length > stats.maxVoices) stats.maxVoices = voices.length;
    return voice;
  }

  /** UI voice: unpooled, unspatialized, on the UI bus. */
  function spawnUi(name, o, t) {
    const v = createVoiceContext(ctx, { t, out: buses.ui, gain: o.gain ?? 1, size: 0, faction: null, rnd: makeRnd(o.seed ?? (stats.ui + 7)), noise: noiseBank, reverbIn: null, kind: 'ui' });
    runRecipe(name, v);
    finalizeVoice(v);
    stats.ui++;
    stats.created++;
  }

  /**
   * Play a named sound.
   * @param {string} name   see recipes.js RECIPES (+ 'ui.victory' | 'ui.defeat' stingers)
   * @param {{ x?:number, y?:number, size?:number, faction?:string, seed?:number, gain?:number, dur?:number, count?:number, shieldPct?:number, delay?:number }} [opts]
   */
  function play(name, opts = {}) {
    if (!ready || !ctx) return;
    const t = ctx.currentTime + 0.02 + Math.max(0, opts.delay || 0);
    try {
      if (name === 'ui.victory' || name === 'ui.defeat') { music.stinger(name.slice(3), t); return; }
      if (!RECIPES[name]) { stats.dropped++; return; }
      if (name.startsWith('ui.')) spawnUi(name, opts, t);
      else spawnSfx(name, opts, t);
    } catch (e) {
      stats.dropped++;
      if (typeof console !== 'undefined' && console.warn) console.warn('[audio] play failed', name, e);
    }
  }

  // ---- ducking / deferred -------------------------------------------------

  let duckUntil = 0;               // end of the current duck's release ramp (ctx time)
  function duckMusic(t, dur) {
    const f = buses.musicLP.frequency;
    const active = t < duckUntil;
    // Re-entry inside an active duck (chain of capital deaths) must not snap the
    // filter back to 20 kHz: hold the current value and extend the hold instead.
    if (active && typeof f.cancelAndHoldAtTime === 'function') f.cancelAndHoldAtTime(t);
    else f.cancelScheduledValues(t);
    if (!active) f.setValueAtTime(20000, t);
    f.exponentialRampToValueAtTime(600, t + 0.05);
    f.setValueAtTime(600, t + 0.05 + dur);
    f.exponentialRampToValueAtTime(20000, t + 0.05 + dur + 0.35);
    duckUntil = t + 0.05 + dur + 0.35;
  }

  function defer(dt, name, opts) {
    deferred.push({ at: ctx.currentTime + dt, name, opts });
  }

  function flushDeferred(now) {
    if (!deferred.length) return;
    for (let i = deferred.length - 1; i >= 0; i--) {
      const d = deferred[i];
      if (d.at <= now + 0.05) { deferred.splice(i, 1); play(d.name, d.opts); }
    }
  }

  // ---- engine ambience beds (one per team) -------------------------------

  function bedOscFor(faction) {
    switch (faction) {
      case 'vorrax': return { type: 'sine', hz: 44 };
      case 'lumen': return { type: 'triangle', hz: 55 };
      case 'ferrix': return { type: 'square', hz: 30 };
      default: return { type: 'sawtooth', hz: 38 };
    }
  }

  function startBeds() {
    if (!ctx) return;
    for (let team = 0; team < 2; team++) {
      if (beds[team]) continue;
      const t = ctx.currentTime;
      const v = createVoiceContext(ctx, { t, out: buses.sfx, gain: 1, size: 0, faction: null, rnd: makeRnd(100 + team), noise: noiseBank, reverbIn: null, kind: 'bed' });
      const gain = ctx.createGain(); gain.gain.value = 0; v.nodes.push(gain);
      const panner = ctx.createStereoPanner(); panner.pan.value = team === 0 ? -0.3 : 0.3; v.nodes.push(panner);
      gain.connect(panner); panner.connect(buses.sfx);
      const n = ctx.createBufferSource(); n.buffer = noiseBank.brown; n.loop = true; v.nodes.push(n);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 120; f.Q.value = 0.7; v.nodes.push(f);
      n.connect(f); f.connect(gain);
      n.start(t, team * 0.7);
      const oscCfg = bedOscFor(teamFaction[team]);
      const o = ctx.createOscillator(); o.type = oscCfg.type; o.frequency.value = oscCfg.hz; v.nodes.push(o);
      const og = ctx.createGain(); og.gain.value = 0.35; v.nodes.push(og);
      const of = ctx.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 160; of.Q.value = 0.7; v.nodes.push(of);
      o.connect(og); og.connect(of); of.connect(gain);
      o.start(t);
      v.sources.push(n, o);
      gain.gain.setTargetAtTime(0.08, t, 1.5);
      beds[team] = { v, gain, osc: o, faction: teamFaction[team] };
    }
  }

  function updateBeds(now) {
    for (let team = 0; team < 2; team++) {
      const b = beds[team];
      if (!b) continue;
      if (b.faction !== teamFaction[team] && teamFaction[team]) {
        const cfg = bedOscFor(teamFaction[team]);
        b.osc.type = cfg.type; b.osc.frequency.setTargetAtTime(cfg.hz, now, 0.5); b.faction = teamFaction[team];
      }
      const alive = clamp(battle.aliveFrac[team] ?? 1, 0, 1);
      b.gain.gain.setTargetAtTime(hidden ? 0 : 0.08 * Math.sqrt(alive), now, 0.25);
    }
  }

  function stopBeds() {
    if (!ctx) return;
    const now = ctx.currentTime;
    for (let team = 0; team < 2; team++) {
      const b = beds[team];
      if (!b) continue;
      b.gain.gain.setTargetAtTime(0, now, 0.4);
      for (const s of b.v.sources) { try { s.stop(now + 2.0); } catch { /* ignore */ } }
      const v = b.v;
      const last = v.sources[v.sources.length - 1];
      last.onended = () => { for (const n of v.nodes) { try { n.disconnect(); } catch { /* ignore */ } } };
      beds[team] = null;
    }
  }

  // ---- tick (25 ms) -------------------------------------------------------

  let lastBedUpdate = -1;
  function tick() {
    if (!ctx) return;
    const now = ctx.currentTime;
    try { music.scheduler(); } catch (e) { if (typeof console !== 'undefined') console.warn('[audio] music', e); }
    flushDeferred(now);
    if (now - lastBedUpdate >= 0.25) { lastBedUpdate = now; updateBeds(now); gcVoices(now); }
    stats.voices = voices.length;
  }

  // ---- sim event mapping ---------------------------------------------------

  function sizeOf(info) {
    if (!info) return 0;
    const sc = info.sizeClass || (SHIPS[info.cls] && SHIPS[info.cls].sizeClass);
    const s = SIZE_CLASS[sc];
    return s ? s.audioSize : 0;
  }

  function weaponOf(info, idx) {
    const def = info && SHIPS[info.cls];
    return def && def.weapons ? def.weapons[idx] || null : null;
  }

  function shotName(w) {
    if (!w) return 'shot.kinetic';
    if (w.type === 'kinetic') return (w.id.includes('autocannon') || w.id.includes('_pd') || (w.salvo >= 2 && w.damage <= 8)) ? 'shot.autocannon' : 'shot.kinetic';
    return 'shot.' + w.type;
  }

  function eventSeed(a, b, c) {
    return ((frameSerial * 2654435761) ^ (a * 40503) ^ (b * 9973) ^ (c * 131)) >>> 0;
  }

  function learnTeam(info) {
    if (info && (info.team === 0 || info.team === 1) && !teamFaction[info.team] && info.faction) teamFaction[info.team] = info.faction;
  }

  /**
   * Map simulation events (ARCHITECTURE §3.1) of one rendered frame to sounds.
   * @param {any[][]} events
   * @param {(id:number)=>({ cls:string, faction:string, sizeClass:string, team:number, x:number, y:number }|null)} lookup
   */
  function consumeEvents(events, lookup) {
    if (!ready || !ctx || !events || !events.length) return;
    frameSerial++;
    const base = ctx.currentTime + 0.02;
    const n = events.length;
    const spread = n > 1 ? 0.04 / (n - 1) : 0;
    const safeLookup = typeof lookup === 'function' ? lookup : () => null;
    for (let i = 0; i < n; i++) {
      const e = events[i];
      if (!e) continue;
      const delay = i * spread;
      try {
        switch (e[0]) {
          case 'shot': {   // hitscan: laser, ion lance, contact bite
            const src = safeLookup(e[1]); if (!src) break;
            learnTeam(src);
            const w = weaponOf(src, e[3]);
            play(shotName(w), { x: src.x, y: src.y, size: sizeOf(src), faction: src.faction, seed: eventSeed(e[1], e[2], e[3]), delay });
            break;
          }
          case 'charge': {
            const src = safeLookup(e[1]); if (!src) break;
            play('charge', { x: src.x, y: src.y, size: sizeOf(src), faction: src.faction, seed: eventSeed(e[1], 0, e[2]), dur: e[3], delay });
            break;
          }
          case 'proj': {   // projectile launch (kinetic, flak, plasma, missile, torpedo, bio, railgun)
            const src = safeLookup(e[2]); if (!src) break;
            learnTeam(src);
            const w = weaponOf(src, e[4]);
            const size = sizeOf(src);
            if (w && (w.type === 'missile' || w.type === 'torpedo')) projectiles.set(e[1], { type: w.type, size, faction: src.faction });
            play(shotName(w), { x: e[5], y: e[6], size, faction: src.faction, seed: eventSeed(e[2], e[3], e[1]), delay });
            break;
          }
          case 'pend': {
            const p = projectiles.get(e[1]);
            if (!p) break;
            projectiles.delete(e[1]);
            if (e[2] === 1) play(p.type === 'torpedo' ? 'impact.torpedo' : 'impact.missile', { x: e[3], y: e[4], size: p.size, faction: p.faction, seed: eventSeed(e[1], e[2], 0), delay });
            else if (e[2] === 2) play('impact.intercept', { x: e[3], y: e[4], size: 0, faction: p.faction, seed: eventSeed(e[1], 2, 0), delay });
            break;
          }
          case 'hit': {
            const dst = safeLookup(e[1]); if (!dst) break;
            play(e[4] ? 'hit.shield' : 'hit.hull', { x: dst.x, y: dst.y, size: sizeOf(dst), faction: dst.faction, seed: eventSeed(e[1], e[2], e[4]), delay });
            break;
          }
          case 'sbreak': {
            const dst = safeLookup(e[1]); if (!dst) break;
            play('shield.break', { x: dst.x, y: dst.y, size: sizeOf(dst), faction: dst.faction, seed: eventSeed(e[1], 1, 1), delay });
            break;
          }
          case 'die': {
            const s = safeLookup(e[1]);
            const size = sizeOf(s);
            const faction = s ? s.faction : null;
            const seed = eventSeed(e[1], e[2], 9);
            const o = { x: e[3], y: e[4], size, faction, seed, delay };
            const voice = spawnSfx('death', o, base + delay);
            if (voice && size >= 3) duckMusic(base + delay, size === 4 ? 0.5 : 0.3);
            if (voice && size === 4) {
              const r = makeRnd(seed);
              for (let k = 0; k < 6; k++) defer(0.15 + k * 0.18 + r(0, 0.08), 'impact.missile', { x: e[3] + r(-40, 40), y: e[4] + r(-40, 40), size: 0, faction, seed: seed + k + 1, gain: 0.4 });
            }
            break;
          }
          case 'cast': {
            const src = safeLookup(e[1]);
            const ab = ABILITIES[e[2]];
            const kind = ab ? ab.kind : 'buff';
            if (kind === 'passive') break;
            const name = RECIPES['cast.' + kind] ? 'cast.' + kind : 'cast.buff';
            const x = Number.isFinite(e[4]) && e[4] !== 0 ? e[4] : (src ? src.x : 0);
            const y = Number.isFinite(e[5]) && e[5] !== 0 ? e[5] : (src ? src.y : 0);
            const o = { x, y, size: sizeOf(src), faction: src ? src.faction : null, seed: eventSeed(e[1], e[3], 5), delay, count: ab && ab.params ? (ab.params.count || 1) : 1, dur: ab ? ab.duration : 0 };
            play(name, o);
            if (kind === 'teleport') defer(0.4, 'cast.teleport_in', { ...o, delay: 0, seed: o.seed + 1 });
            break;
          }
          case 'heal': {
            if (e[3] < 20) break;   // regen ticks are silent; ability-level heals sparkle
            const dst = safeLookup(e[2]); if (!dst) break;
            play('heal', { x: dst.x, y: dst.y, size: sizeOf(dst), faction: dst.faction, seed: eventSeed(e[1], e[2], 3), delay });
            break;
          }
          case 'aoe': {
            if (e[4] === 'bile_burst') play('cast.passive', { x: e[1], y: e[2], size: 0, faction: 'vorrax', seed: eventSeed(e[1] | 0, e[2] | 0, 4), delay });
            break;
          }
          case 'phase': {
            if (e[1] === 'engage') battle.engaged = true;
            else if (e[1] === 'suddenDeath') { battle.suddenDeath = true; play('alarm', { gain: 0.8, seed: 77 }); }
            break;
          }
          case 'spawn': case 'area': case 'end': default:
            break;
        }
      } catch (err) {
        stats.dropped++;
        if (typeof console !== 'undefined' && console.warn) console.warn('[audio] event', e && e[0], err);
      }
    }
    if (projectiles.size > 4000) projectiles.clear();
  }

  // ---- public setters ------------------------------------------------------

  /**
   * Camera used for panning / distance attenuation (world units); once per frame.
   * @param {number} cx @param {number} cy @param {number} halfWidth @param {number} aspect
   */
  function setCamera(cx, cy, halfWidth, aspect) {
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    cam.cx = cx; cam.cy = cy;
    cam.hw = Number.isFinite(halfWidth) && halfWidth > 1 ? halfWidth : cam.hw;
    cam.aspect = Number.isFinite(aspect) && aspect > 0.1 ? aspect : cam.aspect;
    cam.set = true;
  }

  /**
   * Drive music intensity and engine beds from the HUD (~4–10 Hz).
   * @param {{ aliveFrac:number[], destroyedFrac:number, elapsedSec:number }} s
   */
  function setBattleState(s) {
    if (!s) return;
    if (Array.isArray(s.aliveFrac)) battle.aliveFrac = [clamp(Number(s.aliveFrac[0]) || 0, 0, 1), clamp(Number(s.aliveFrac[1]) || 0, 0, 1)];
    battle.destroyedFrac = clamp(Number(s.destroyedFrac) || 0, 0, 1);
    battle.elapsedSec = Math.max(0, Number(s.elapsedSec ?? s.elapsed) || 0);
    // action density: sound requests per second (played, coalesced or dropped), smoothed over ~3 s,
    // so a heavy exchange pushes the music up even in a short battle
    const nowMs = Date.now();
    const total = stats.created + stats.coalesced + stats.dropped;
    if (densitySample.t > 0) {
      const dt = Math.max(0.05, (nowMs - densitySample.t) / 1000);
      const rate = Math.max(0, total - densitySample.n) / dt;
      const target = clamp(rate / 40, 0, 0.9);
      const k = 1 - Math.exp(-dt / 3);
      battle.density = battle.density + (target - battle.density) * k;
    }
    densitySample.t = nowMs; densitySample.n = total;
    if (!music) return;
    let x = computeIntensity(battle);
    if (battle.engaged) x = Math.max(x, 0.12);
    if (battle.suddenDeath) x = 1;   // sudden death: every layer on
    music.setIntensity(x);
  }

  /**
   * Music scene; crossfades on a bar boundary. Queued until init when called early.
   * @param {'none'|'menu'|'builder'|'battle'|'victory'|'defeat'} s
   */
  function setScene(s) {
    const next = SCENES.includes(s) ? s : 'menu';
    if (next === scene) return;
    scene = next;
    if (next !== 'battle') { battle.engaged = false; battle.suddenDeath = false; battle.density = 0; densitySample.t = 0; }
    if (next === 'battle') { teamFaction[0] = null; teamFaction[1] = null; projectiles.clear(); }
    if (!ctx) return;
    music.setScene(next);
    if (next === 'battle') startBeds(); else stopBeds();
  }

  /** Faction motif for builder fills and battle leads. @param {string|null} f */
  function setFactionHint(f) {
    factionHint = typeof f === 'string' ? f : null;
    if (music) music.setFactionHint(factionHint);
  }

  /** @param {'master'|'music'|'sfx'|'ui'} bus @param {number} v 0..1 (perceptual: gain = v²) */
  function setVolume(bus, v) {
    if (!BUS_NAMES.includes(bus)) return;
    settings[bus] = clamp(Number(v) || 0, 0, 1);
    saveSettings();
    applySettings();
  }

  /** @param {boolean} b */
  function setMuted(b) {
    settings.muted = !!b;
    saveSettings();
    applySettings();
  }

  /** @returns {{ master:number, music:number, sfx:number, ui:number, muted:boolean }} */
  function getSettings() { return { ...settings }; }

  function suspend() { if (ctx && ctx.state === 'running' && typeof ctx.suspend === 'function') return Promise.resolve(ctx.suspend()).catch(() => {}); return Promise.resolve(); }
  function resume() { if (ctx && typeof ctx.resume === 'function') return Promise.resolve(ctx.resume()).catch(() => {}); return Promise.resolve(); }

  function dispose() {
    if (timer !== null) { D.clearInterval(timer); timer = null; }
    if (D.document && typeof D.document.removeEventListener === 'function') D.document.removeEventListener('visibilitychange', onVisibility);
    stopBeds();
    if (music) music.dispose();
    for (const v of voices.slice()) killVoice(v, ctx ? ctx.currentTime : 0);
    voices.length = 0; recent.clear(); deferred.length = 0; projectiles.clear();
    if (ctx && typeof ctx.close === 'function') { try { ctx.close(); } catch { /* ignore */ } }
    ctx = null; ready = false; music = null; buses = null;
  }

  return {
    init,
    isReady: () => ready,
    play,
    consumeEvents,
    setCamera,
    setBattleState,
    setScene,
    setFactionHint,
    setVolume,
    setMuted,
    getSettings,
    suspend,
    resume,
    dispose,
    tick,
    /** Debug counters. */
    stats() {
      return {
        ...stats, voices: voices.length, scene, ctxState: ctx ? ctx.state : 'none',
        music: music ? music.stats() : null, deferred: deferred.length, beds: beds.filter(Boolean).length,
      };
    },
    getScene: () => scene,
    getFactionHint: () => factionHint,
    /** Internals for tests / debug overlays. */
    get ctx() { return ctx; },
    get buses() { return buses; },
    get music() { return music; },
    get voices() { return voices; },
    get camera() { return { ...cam }; },
    get noise() { return noiseBank; },
    isStub: false,
  };
}

/** Browser singleton (ARCHITECTURE §5.4). */
export const audio = createAudioEngine();
export default audio;
export { SFX_NAMES, computeIntensity };
