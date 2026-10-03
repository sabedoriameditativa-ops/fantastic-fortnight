/*
 * Quinzena Fantástica — a top-down survival roguelite.
 * Plain ES2020, no modules, no dependencies. Works from file://.
 *
 * Sections:
 *   1. Config / tuning tables
 *   2. Utils
 *   3. Storage
 *   4. Audio (Web Audio, synthesized)
 *   5. Input (keyboard + floating virtual joystick)
 *   6. State & entities
 *   7. Upgrades & weapons
 *   8. Enemies, bosses & spawner
 *   9. Particles & floating text
 *  10. Simulation step / night flow
 *  11. Rendering
 *  12. UI (DOM overlays, HUD)
 *  13. State machine (screens)
 *  14. Main loop & boot
 *  15. Public test API / debug API
 */
(function () {
  'use strict';

  // =========================================================================
  // 1. CONFIG / TUNING TABLES
  // =========================================================================

  const STORAGE_KEY = 'quinzena-fantastica:v1';
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  // Mirrors the CSS custom properties in style.css
  const COLORS = {
    abyss: '#06121c',
    tide: '#0f2a3d',
    sand: '#3a3a2c',
    parchment: '#f1e4c6',
    fog: '#9db2c4',
    lantern: '#ffb547',
    ember: '#ff7a3d',
    biolume: '#5fe0cf',
    danger: '#ff5468',
    ink: '#b48cff',
    gold: '#ffd36b',
    grass: '#16241b',
    grassDark: '#101b15',
    rock: '#2b3338',
    wetSand: '#2b2c22',
    darkness: [4, 10, 18],
  };

  const SIM = { step: 1 / 60, maxFrame: 0.25, maxSteps: 5 };

  const WORLD = {
    islandR: 1100,
    lighthouseR: 46,
    sandWidth: 130,
    beamLength: 1300,
    beamPeriod: 7, // seconds per full turn
    beamHalfAngle: 9 * DEG,
    beamSlow: 0.35, // enemies inside the beam move 35 % slower
    bossBeamSlowFactor: 0.5, // bosses feel half of it
  };

  const PLAYER = {
    r: 16,
    maxHp: 100,
    speed: 210,
    invuln: 0.6,
    pickupR: 90,
    lightR: 270,
    accel: 18, // velocity smoothing (1/s)
    startX: 0,
    startY: 150,
  };

  const NIGHTS = {
    total: 14,
    baseDuration: 40,
    perNight: 3,
    bossNights: [7, 14],
    bossSpawnFactor: 0.5,
    bossDelay: 1.2,
    dawnHeal: 0.3,
    sunrise: 1.2,
    darkAlpha: 0.84,
    dawnAlpha: 0.2,
  };
  const nightDuration = n => NIGHTS.baseDuration + NIGHTS.perNight * (n - 1);
  const xpToNext = level => Math.round(6 + level * 5 + level * level * 0.6);

  const SCORE = { kill: 10, ember: 2, night: 500, boss: 2500 };

  const SPAWN = {
    base: 0.9,
    perNight: 0.28,
    rampStart: 1.0,
    rampEnd: 1.6,
    maxAlive: 260,
    ringMargin: 120,
    groupChance: 0.2,
    groupSize: 3,
    recycleExtra: 900,
  };

  const SCALING = {
    hpPerNight: 0.14,
    dmgPerNight: 0.06,
    eliteFromNight: 10,
    eliteChance: 0.08,
    eliteHp: 3,
    eliteSize: 1.3,
    eliteEmbers: 4,
  };

  const LIMITS = { particles: 450, texts: 60, embers: 350, smallLights: 170 };

  const ENEMIES = {
    crab: { name: 'Caranguejo', from: 1, hp: 18, speed: 72, dmg: 8, ember: 1, r: 14, glow: '#5fe0cf', body: '#a8503a', shell: '#7a3326' },
    jelly: { name: 'Água-viva', from: 2, hp: 12, speed: 95, dmg: 6, ember: 1, r: 13, glow: '#d68cff', body: '#5b3f86', shell: '#3a2860' },
    eel: { name: 'Moreia', from: 4, hp: 14, speed: 155, dmg: 10, ember: 2, r: 11, glow: '#8dffa4', body: '#3e5d3c', shell: '#283d27', turn: 2.3 },
    puffer: { name: 'Baiacu', from: 5, hp: 75, speed: 46, dmg: 14, ember: 4, r: 20, glow: '#ff9fd2', body: '#8a7444', shell: '#5e4d2a', inflateDist: 165, inflateScale: 1.4 },
    squid: { name: 'Lula-tinteira', from: 8, hp: 30, speed: 85, dmg: 6, ember: 3, r: 15, glow: '#82b4ff', body: '#3f4f86', shell: '#2a355e', keep: 300, shotEvery: 2.6, shotDmg: 8, shotSpeed: 240, shotRange: 560 },
  };

  // Spawn weights shift toward newer creatures as nights go by.
  function spawnWeights(n) {
    const w = [['crab', Math.max(0.3, 1.1 - 0.07 * (n - 1))]];
    if (n >= 2) w.push(['jelly', 0.75 * (n === 2 ? 1.5 : 1)]);
    if (n >= 4) w.push(['eel', (0.45 + 0.04 * (n - 4)) * (n === 4 ? 1.6 : 1)]);
    if (n >= 5) w.push(['puffer', (0.22 + 0.025 * (n - 5)) * (n === 5 ? 1.6 : 1)]);
    if (n >= 8) w.push(['squid', (0.28 + 0.03 * (n - 8)) * (n === 8 ? 1.6 : 1)]);
    return w;
  }

  const BOSSES = {
    crabKing: {
      name: 'Caranguejo-Rei', banner: 'O Caranguejo-Rei emerge!', bannerSub: 'Senhor das areias da Ilha Perdida',
      hp: 1500, r: 60, speed: 62, dmg: 22, glow: '#ff9b5c',
      dashEvery: 5, telegraph: 0.8, dashDist: 520, dashSpeed: 640, recover: 0.45,
      summonEvery: 8, summonCount: 4, emberTotal: 60,
    },
    leviathan: {
      name: 'Leviatã das Marés', banner: 'O Leviatã das Marés desperta!', bannerSub: 'A última maré da quinzena',
      hp: 5200, r: 80, speed: 48, dmg: 30, glow: '#7ff3ff', keep: 180,
      ringEvery: 3.2, ringCount: 16, ringCountEnraged: 24, orbDmg: 10, orbSpeed: 210, orbLife: 6,
      slamEvery: 6, slamWarn: 1, slamR: 120, slamDmg: 25,
      summonEvery: 7, summonCount: 3, emberTotal: 120,
    },
  };

  const WEAPONS = {
    spark: { range: 460, cooldown: 0.55, dmg: 12, speed: 560, life: 1.1, r: 5, spread: 0.14, knock: 45 },
    // the light burns hottest near the lens: full damage up to falloffStart, fading to falloffMin at falloffEnd
    beam: { dps: 18, dpsPerLevel: 12, halfPerLevel: 1.5 * DEG, rotPerLevel: 0.1, falloffStart: 380, falloffEnd: 1100, falloffMin: 0.45 },
    aura: { radiusFactor: 0.42, tick: 0.5, dmg: 6, dmgPerLevel: 4, radiusPerLevel: 0.08, knock: 25 },
    anchors: { orbit: 95, spin: 2.6, dmg: 14, dmgPerLevel: 3, hitCd: 0.4, r: 13, knock: 90 },
    harpoon: { cooldown: 2.4, dmg: 40, dmgL2: 15, cdL3: 0.9, dmgL5: 1.5, speed: 760, life: 1.5, r: 14, knock: 110 },
  };

  const PASSIVES = { boots: 0.1, hull: 20, hullHeal: 20, regen: 0.8, magnet: 0.35, wick: 0.15, powder: 0.12, hourglass: 0.08 };

  const MAX_LEVEL = 5;
  const MAX_WEAPONS = 4;

  // =========================================================================
  // 2. UTILS
  // =========================================================================

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };
  function angleDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    else if (d < -Math.PI) d += TAU;
    return d;
  }
  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(x, y) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // Brazilian thousands separator: 12.840
  const fmtInt = n => String(Math.max(0, Math.floor(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    const m = Math.floor(s / 60), r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = (hex, a) => {
    const c = hexToRgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  };
  function weightedPick(entries) {
    // entries: [[value, weight], ...]
    let total = 0;
    for (const e of entries) total += e[1];
    let r = Math.random() * total;
    for (const e of entries) {
      r -= e[1];
      if (r <= 0) return e[0];
    }
    return entries[entries.length - 1][0];
  }

  let reducedMotion = false;
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = mq.matches;
    const onChange = () => { reducedMotion = mq.matches; };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch (e) { /* ignore */ }

  // =========================================================================
  // 3. STORAGE (every access guarded — the game works without it)
  // =========================================================================

  const prefs = { bestScore: 0, bestNight: 0, muted: false };

  function loadPrefs() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return false;
      prefs.bestScore = Math.max(0, Number(d.bestScore) || 0);
      prefs.bestNight = clamp(Number(d.bestNight) || 0, 0, NIGHTS.total);
      prefs.muted = !!d.muted;
      return true;
    } catch (e) {
      return false;
    }
  }
  function savePrefs() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        bestScore: prefs.bestScore, bestNight: prefs.bestNight, muted: prefs.muted,
      }));
    } catch (e) { /* storage unavailable — ignore */ }
  }

  // =========================================================================
  // 4. AUDIO (synthesized; failures never break the game)
  // =========================================================================

  const Sound = (function () {
    let ctx = null, master = null, sfxBus = null, ambLevel = null, noiseBuf = null;
    let muted = false;
    let ambientWanted = 0;
    const recent = [];

    function init() {
      try {
        if (ctx) {
          if (ctx.state === 'suspended') {
            const p = ctx.resume();
            if (p && p.catch) p.catch(() => {});
          }
          return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.85;
        master.connect(comp);
        comp.connect(ctx.destination);
        sfxBus = ctx.createGain();
        sfxBus.gain.value = 0.9;
        sfxBus.connect(master);
        const len = Math.floor(ctx.sampleRate * 2);
        noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        startAmbient();
        if (ctx.state === 'suspended') {
          const p = ctx.resume();
          if (p && p.catch) p.catch(() => {});
        }
      } catch (e) {
        ctx = null;
      }
    }

    function startAmbient() {
      // Low filtered noise "waves" with a slow swell
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      lp.Q.value = 0.4;
      const swell = ctx.createGain();
      swell.gain.value = 0.55;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.11;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 0.42;
      lfo.connect(lfoAmt);
      lfoAmt.connect(swell.gain);
      const lfo2 = ctx.createOscillator();
      lfo2.frequency.value = 0.067;
      const lfo2Amt = ctx.createGain();
      lfo2Amt.gain.value = 160;
      lfo2.connect(lfo2Amt);
      lfo2Amt.connect(lp.frequency);
      ambLevel = ctx.createGain();
      ambLevel.gain.value = 0;
      ambLevel.gain.setTargetAtTime(0.11 * ambientWanted, ctx.currentTime, 0.8);
      src.connect(lp);
      lp.connect(swell);
      swell.connect(ambLevel);
      ambLevel.connect(master);
      src.start();
      lfo.start();
      lfo2.start();
    }

    function setAmbient(level) {
      ambientWanted = level;
      if (!ctx || !ambLevel) return;
      try { ambLevel.gain.setTargetAtTime(0.11 * level, ctx.currentTime, 0.5); } catch (e) { /* ignore */ }
    }

    function setMuted(m) {
      muted = !!m;
      if (!ctx || !master) return;
      try { master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.03); } catch (e) { /* ignore */ }
    }

    function canPlay(force) {
      if (!ctx || muted || ctx.state !== 'running') return false;
      if (force) return true;
      const now = performance.now();
      while (recent.length && now - recent[0] > 50) recent.shift();
      if (recent.length >= 6) return false;
      recent.push(now);
      return true;
    }

    function cleanup(nodes) {
      return function () {
        for (const n of nodes) {
          try { n.disconnect(); } catch (e) { /* ignore */ }
        }
      };
    }

    function tone(o) {
      const t = ctx.currentTime + (o.when || 0);
      const dur = o.dur;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f0, t);
      if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
      const peak = o.gain || 0.1;
      const atk = o.attack || 0.005;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(sfxBus);
      osc.onended = cleanup([osc, g]);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    }

    function noise(o) {
      const t = ctx.currentTime + (o.when || 0);
      const dur = o.dur;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = o.filter || 'bandpass';
      f.frequency.setValueAtTime(o.f0 || 1000, t);
      if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
      f.Q.value = o.q || 1;
      const g = ctx.createGain();
      const peak = o.gain || 0.1;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + (o.attack || 0.004));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(sfxBus);
      src.onended = cleanup([src, f, g]);
      src.start(t, Math.random() * 1.5);
      src.stop(t + dur + 0.03);
    }

    const sfx = {
      spark() { tone({ type: 'triangle', f0: 1300 + Math.random() * 260, f1: 640, dur: 0.06, gain: 0.03 }); },
      harpoon() {
        noise({ dur: 0.22, gain: 0.1, filter: 'bandpass', f0: 500, f1: 2600, q: 1.4 });
        tone({ type: 'sawtooth', f0: 180, f1: 90, dur: 0.12, gain: 0.025 });
      },
      hit() { noise({ dur: 0.045, gain: 0.045, filter: 'bandpass', f0: 1500 + Math.random() * 800, q: 2.2 }); },
      death() {
        const b = 220 + Math.random() * 120;
        tone({ type: 'sine', f0: b, f1: b * 3.6, dur: 0.09, gain: 0.07 });
        tone({ type: 'sine', f0: b * 2, f1: b * 5, dur: 0.07, gain: 0.04, when: 0.045 });
      },
      pickup(combo) {
        const f = 620 * Math.pow(2, Math.min(combo || 0, 16) / 12);
        tone({ type: 'sine', f0: f, f1: f * 1.04, dur: 0.07, gain: 0.04 });
      },
      levelup() {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.22, gain: 0.08, when: i * 0.075 }));
        tone({ type: 'sine', f0: 2093, dur: 0.4, gain: 0.03, when: 0.3 });
      },
      pick() {
        tone({ type: 'triangle', f0: 784, f1: 1175, dur: 0.12, gain: 0.07 });
        tone({ type: 'sine', f0: 1568, dur: 0.18, gain: 0.03, when: 0.06 });
      },
      hurt() {
        tone({ type: 'square', f0: 240, f1: 70, dur: 0.2, gain: 0.05 });
        noise({ dur: 0.14, gain: 0.09, filter: 'lowpass', f0: 1100, f1: 300 });
      },
      roar() {
        noise({ dur: 1.7, gain: 0.32, filter: 'lowpass', f0: 1000, f1: 80, q: 7, attack: 0.15 });
        tone({ type: 'sawtooth', f0: 72, f1: 36, dur: 1.6, gain: 0.1, attack: 0.12 });
        tone({ type: 'sawtooth', f0: 108, f1: 52, dur: 1.4, gain: 0.05, attack: 0.15 });
      },
      telegraph() { tone({ type: 'sawtooth', f0: 90, f1: 180, dur: 0.6, gain: 0.05, attack: 0.1 }); },
      slam() {
        tone({ type: 'sine', f0: 140, f1: 36, dur: 0.5, gain: 0.28 });
        noise({ dur: 0.35, gain: 0.18, filter: 'lowpass', f0: 700, f1: 90 });
      },
      ink() { tone({ type: 'sine', f0: 320, f1: 150, dur: 0.12, gain: 0.05 }); },
      ring() { noise({ dur: 0.5, gain: 0.12, filter: 'bandpass', f0: 300, f1: 1400, q: 3 }); tone({ type: 'triangle', f0: 220, f1: 330, dur: 0.4, gain: 0.05 }); },
      summon() { noise({ dur: 0.6, gain: 0.12, filter: 'bandpass', f0: 200, f1: 900, q: 2 }); },
      bossDie() {
        noise({ dur: 1.4, gain: 0.3, filter: 'lowpass', f0: 1800, f1: 60, q: 2 });
        tone({ type: 'sine', f0: 200, f1: 40, dur: 1.2, gain: 0.25 });
        [392, 523.25, 659.25].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.5, gain: 0.06, when: 0.5 + i * 0.12 }));
      },
      sunrise() { noise({ dur: 1.2, gain: 0.06, filter: 'bandpass', f0: 400, f1: 2400, q: 0.8, attack: 0.4 }); },
      dawn() {
        [[783.99, 0], [1174.66, 0.18], [1567.98, 0.36]].forEach(n => {
          tone({ type: 'sine', f0: n[0], dur: 1.6, gain: 0.07, when: n[1], attack: 0.01 });
          tone({ type: 'sine', f0: n[0] * 2.01, dur: 0.9, gain: 0.02, when: n[1] });
        });
      },
      gameover() {
        [392, 349.23, 311.13, 261.63].forEach((f, i) => tone({ type: 'triangle', f0: f, f1: f * 0.98, dur: 0.6, gain: 0.08, when: i * 0.3 }));
        tone({ type: 'sine', f0: 130.81, dur: 1.8, gain: 0.08, when: 1.0, attack: 0.1 });
      },
      victory() {
        [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.3, gain: 0.08, when: i * 0.11 }));
        [523.25, 659.25, 783.99, 1046.5].forEach(f => tone({ type: 'triangle', f0: f, dur: 1.8, gain: 0.05, when: 0.65, attack: 0.03 }));
      },
      click() { tone({ type: 'sine', f0: 880, f1: 700, dur: 0.05, gain: 0.03 }); },
    };

    function play(name, arg, force) {
      try {
        if (!canPlay(force)) return;
        const fn = sfx[name];
        if (fn) fn(arg);
      } catch (e) { /* audio must never break the game */ }
    }

    return { init, play, setMuted, setAmbient };
  })();

  // =========================================================================
  // 5. INPUT
  // =========================================================================

  const MOVE_KEYS = {
    KeyW: [0, -1], ArrowUp: [0, -1],
    KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0],
  };
  const KEY_FALLBACK = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', p: 'KeyP', m: 'KeyM', ' ': 'Space', enter: 'Enter', escape: 'Escape', esc: 'Escape', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', 1: 'Digit1', 2: 'Digit2', 3: 'Digit3' };
  const JOY = { max: 60, dead: 8, knob: 24 };

  const Input = {
    keys: new Set(),
    joy: { active: false, id: null, bx: 0, by: 0, kx: 0, ky: 0 },
    vec: { x: 0, y: 0 },
    clearKeys() { this.keys.clear(); },
    releasePointer() { this.joy.active = false; this.joy.id = null; },
    vector() {
      let x = 0, y = 0;
      for (const k of this.keys) {
        const m = MOVE_KEYS[k];
        if (m) { x += m[0]; y += m[1]; }
      }
      const kl = Math.hypot(x, y);
      if (kl > 0) { x /= kl; y /= kl; }
      const j = this.joy;
      if (j.active) {
        const dx = j.kx - j.bx, dy = j.ky - j.by;
        const d = Math.hypot(dx, dy);
        if (d > JOY.dead) {
          const mag = Math.min(1, (d - JOY.dead) / (JOY.max - JOY.dead));
          x += (dx / d) * mag;
          y += (dy / d) * mag;
        }
      }
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      this.vec.x = x;
      this.vec.y = y;
      return this.vec;
    },
  };

  function codeOf(e) {
    if (e.code) return e.code;
    const k = (e.key || '').toLowerCase();
    return KEY_FALLBACK[k] || '';
  }

  // =========================================================================
  // 6. STATE & ENTITIES
  // =========================================================================

  // Everything about the current run lives in `state`; a restart replaces it.
  function makeState() {
    return {
      screen: 'title', // title | howto | playing | levelup | paused | dawn | gameover | victory
      phase: 'night', // night | sunrise | dying (sub-phase while screen === 'playing')
      phaseT: 0,
      time: 0,
      runActive: false,
      runCommitted: false,
      night: 1,
      nightT: 0,
      nightDur: nightDuration(1),
      isBossNight: false,
      bossSpawnT: -1,
      bossDefeated: false,
      boss: null,
      bossKills: 0,
      player: {
        x: PLAYER.startX, y: PLAYER.startY, vx: 0, vy: 0, r: PLAYER.r,
        hp: PLAYER.maxHp, maxHp: PLAYER.maxHp, invuln: 0, hurtT: 0,
        facing: -Math.PI / 2, face: -Math.PI / 2, moving: false, step: 0,
      },
      level: 1,
      xp: 0,
      pendingLevelUps: 0,
      upgrades: { spark: 1 },
      stats: null,
      wpn: { sparkCd: 0.35, harpoonCd: 0.8, auraT: 0.3, auraPulse: 0, anchorAngle: 0, beamAngle: -0.6 },
      enemies: [],
      shots: [],
      inks: [],
      embers: [],
      particles: [],
      pIdx: 0,
      texts: [],
      slams: [],
      kills: 0,
      embersCollected: 0,
      nightsSurvived: 0,
      bonusScore: 0,
      nightKills: 0,
      nightEmbers: 0,
      spawnAcc: 0,
      light: 0, // 0 = deep night, 1 = dawn light
      lightTarget: 0,
      shake: 0,
      flare: 0,
      god: false,
      recordToastShown: false,
      offers: [],
      afterLevelUp: 'play',
      lastDawnHeal: 0,
      pickupCombo: 0,
      pickupComboT: 0,
      nextId: 1,
      deathNight: 0,
      damageTaken: {}, // by source, for balancing/tests
    };
  }
  let state = makeState();

  const view = { w: 1, h: 1, dpr: 1, zoom: 1, scale: 1 };
  const cam = { x: 0, y: 0 };
  let timeScale = 1;

  const lv = id => state.upgrades[id] || 0;

  function recomputeStats() {
    const s = {
      speed: PLAYER.speed * (1 + PASSIVES.boots * lv('boots')),
      maxHp: PLAYER.maxHp + PASSIVES.hull * lv('hull'),
      regen: PASSIVES.regen * lv('regen'),
      pickupR: PLAYER.pickupR * (1 + PASSIVES.magnet * lv('magnet')),
      lightR: PLAYER.lightR * (1 + PASSIVES.wick * lv('wick')),
      dmgMul: 1 + PASSIVES.powder * lv('powder'),
      cdMul: Math.max(0.3, 1 - PASSIVES.hourglass * lv('hourglass')),
    };
    state.stats = s;
    const p = state.player;
    p.maxHp = s.maxHp;
    if (p.hp > p.maxHp) p.hp = p.maxHp;
  }

  function currentScore() {
    return state.kills * SCORE.kill + state.embersCollected * SCORE.ember +
      state.nightsSurvived * SCORE.night + state.bossKills * SCORE.boss + state.bonusScore;
  }

  // Spatial hash for enemies (separation + hit queries)
  const GRID_CELL = 72;
  const grid = new Map();
  const tmpList = [];
  const gridKey = (cx, cy) => (cx + 4096) * 8192 + (cy + 4096);
  function rebuildGrid() {
    for (const arr of grid.values()) arr.length = 0;
    for (const e of state.enemies) {
      if (e.dead) continue;
      const k = gridKey(Math.floor(e.x / GRID_CELL), Math.floor(e.y / GRID_CELL));
      let a = grid.get(k);
      if (!a) { a = []; grid.set(k, a); }
      a.push(e);
    }
  }
  function queryEnemies(x, y, r, out) {
    out.length = 0;
    const x0 = Math.floor((x - r) / GRID_CELL), x1 = Math.floor((x + r) / GRID_CELL);
    const y0 = Math.floor((y - r) / GRID_CELL), y1 = Math.floor((y + r) / GRID_CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const a = grid.get(gridKey(cx, cy));
        if (a) for (let i = 0; i < a.length; i++) if (!a[i].dead) out.push(a[i]);
      }
    }
    return out;
  }

  function nearestTarget(x, y, range) {
    let best = null, bd = range * range;
    for (const e of state.enemies) {
      if (e.dead || e.emerge < 0.6) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    const b = state.boss;
    if (b && !b.dead && b.emerge >= 1) {
      const d = dist2(x, y, b.x, b.y) - b.r * b.r;
      if (d < bd) best = b;
    }
    return best;
  }

  // =========================================================================
  // 7. UPGRADES & WEAPONS
  // =========================================================================

  const UPGRADES = [
    {
      id: 'spark', kind: 'weapon', name: 'Faísca',
      desc: L => [
        'Dispara faíscas na criatura mais próxima.',
        'Mais uma faísca por disparo, em leque.',
        'Faíscas 30% mais fortes.',
        'Cada faísca atravessa mais uma criatura.',
        'Mais uma faísca e recarga 20% mais rápida.',
      ][L - 1],
    },
    {
      id: 'beam', kind: 'weapon', name: 'Lente de Fresnel',
      desc: L => L === 1
        ? 'O facho do farol passa a queimar: até 18 de dano por segundo, mais forte perto da torre.'
        : 'Facho mais largo e mais rápido: até ' + (WEAPONS.beam.dps + WEAPONS.beam.dpsPerLevel * (L - 1)) + ' de dano por segundo.',
    },
    {
      id: 'aura', kind: 'weapon', name: 'Lanterna Ardente',
      desc: L => L === 1
        ? 'Sua lanterna queima quem chega perto: 6 de dano a cada meio segundo.'
        : 'Chama mais forte: ' + (WEAPONS.aura.dmg + WEAPONS.aura.dmgPerLevel * (L - 1)) + ' de dano por pulso e 8% mais alcance.',
    },
    {
      id: 'anchors', kind: 'weapon', name: 'Âncoras Giratórias',
      desc: L => L === 1
        ? 'Uma âncora gira ao seu redor, ferindo e empurrando as criaturas.'
        : ['', '', 'Duas', 'Três', 'Quatro', 'Cinco'][L] + ' âncoras girando, cada uma com +3 de dano.',
    },
    {
      id: 'harpoon', kind: 'weapon', name: 'Arpão',
      desc: L => [
        'Lança um arpão pesado que atravessa todas as criaturas no caminho.',
        'Arpão mais pesado: +15 de dano.',
        'Recarga 10% mais rápida.',
        'Lança dois arpões: um para frente e outro para trás.',
        'Ponta de ferro forjado: +50% de dano.',
      ][L - 1],
    },
    { id: 'boots', kind: 'passive', name: 'Botas de Marinheiro', desc: () => 'Você corre 10% mais rápido.' },
    { id: 'hull', kind: 'passive', name: 'Casco Reforçado', desc: () => '+20 de vida máxima e cura 20 de vida.' },
    { id: 'regen', kind: 'passive', name: 'Pulmões de Faroleiro', desc: () => 'Recupera +0,8 de vida por segundo.' },
    { id: 'magnet', kind: 'passive', name: 'Ímã de Brasas', desc: () => 'Atrai brasas de 35% mais longe.' },
    { id: 'wick', kind: 'passive', name: 'Pavio Longo', desc: () => 'A lanterna ilumina 15% mais longe — e a Lanterna Ardente também.' },
    { id: 'powder', kind: 'passive', name: 'Pólvora Seca', desc: () => 'Todas as armas causam 12% mais dano.' },
    { id: 'hourglass', kind: 'passive', name: 'Ampulheta', desc: () => 'Todas as armas recarregam 8% mais rápido.' },
  ];
  const FALLBACKS = [
    { id: 'tea', kind: 'item', name: 'Chá quente', desc: () => 'Recupera 40 de vida.' },
    { id: 'coin', kind: 'item', name: 'Moeda antiga', desc: () => 'Vale 300 pontos.' },
  ];
  const UPGRADE_BY_ID = {};
  for (const u of UPGRADES.concat(FALLBACKS)) UPGRADE_BY_ID[u.id] = u;

  function weaponCount() {
    let n = 0;
    for (const u of UPGRADES) if (u.kind === 'weapon' && lv(u.id) > 0) n++;
    return n;
  }

  function rollOffers() {
    const owned = weaponCount();
    const pool = [];
    for (const u of UPGRADES) {
      const L = lv(u.id);
      if (L >= MAX_LEVEL) continue;
      if (u.kind === 'weapon' && L === 0 && owned >= MAX_WEAPONS) continue;
      let w = 1;
      if (u.kind === 'weapon') w = L > 0 ? 1.35 : owned < 2 ? 1.8 : 1.2;
      pool.push([u, w]);
    }
    const picks = [];
    while (picks.length < 3 && pool.length) {
      const u = weightedPick(pool);
      picks.push(u);
      const i = pool.findIndex(e => e[0] === u);
      pool.splice(i, 1);
    }
    // early on, always show at least one weapon so every run can grow an arsenal
    if (owned < 3 && picks.length === 3 && !picks.some(u => u.kind === 'weapon')) {
      const weapons = pool.filter(e => e[0].kind === 'weapon');
      if (weapons.length) picks[2] = weightedPick(weapons);
    }
    for (const f of FALLBACKS) if (picks.length < 3) picks.push(f);
    // shuffle so the card position carries no meaning
    for (let i = picks.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = picks[i]; picks[i] = picks[j]; picks[j] = t;
    }
    return picks;
  }

  function heal(n) {
    const p = state.player;
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + n);
    const got = Math.round(p.hp - before);
    if (got > 0) addText(p.x, p.y - 26, '+' + got, '#8ff0b4', 15);
    return got;
  }

  function applyUpgrade(id) {
    if (id === 'tea') { heal(40); return; }
    if (id === 'coin') { state.bonusScore += 300; addText(state.player.x, state.player.y - 26, '+300', COLORS.gold, 16); return; }
    if (!UPGRADE_BY_ID[id] || UPGRADE_BY_ID[id].kind === 'item') return;
    state.upgrades[id] = Math.min(MAX_LEVEL, lv(id) + 1);
    recomputeStats();
    if (id === 'hull') heal(PASSIVES.hullHeal);
  }

  // Derived weapon stats per level
  function sparkStats(L) {
    const W = WEAPONS.spark;
    return {
      count: 1 + (L >= 2 ? 1 : 0) + (L >= 5 ? 1 : 0),
      dmg: W.dmg * (L >= 3 ? 1.3 : 1),
      pierce: L >= 4 ? 1 : 0,
      cd: W.cooldown * (L >= 5 ? 0.8 : 1),
    };
  }
  function beamStats(L) {
    const W = WEAPONS.beam;
    return {
      dps: L > 0 ? W.dps + W.dpsPerLevel * (L - 1) : 0,
      half: WORLD.beamHalfAngle + W.halfPerLevel * L,
      speed: (TAU / WORLD.beamPeriod) * (1 + W.rotPerLevel * L),
    };
  }
  function auraStats(L) {
    const W = WEAPONS.aura;
    return {
      r: W.radiusFactor * state.stats.lightR * (1 + W.radiusPerLevel * (L - 1)),
      dmg: W.dmg + W.dmgPerLevel * (L - 1),
    };
  }
  function anchorStats(L) {
    const W = WEAPONS.anchors;
    return { count: Math.min(5, L), dmg: W.dmg + W.dmgPerLevel * (L - 1) };
  }
  function harpoonStats(L) {
    const W = WEAPONS.harpoon;
    return {
      dmg: (W.dmg + (L >= 2 ? W.dmgL2 : 0)) * (L >= 5 ? W.dmgL5 : 1),
      cd: W.cooldown * (L >= 3 ? W.cdL3 : 1),
      count: L >= 4 ? 2 : 1,
    };
  }

  function beamFalloff(x, y) {
    const W = WEAPONS.beam;
    const d = Math.hypot(x, y);
    if (d <= W.falloffStart) return 1;
    return lerp(1, W.falloffMin, clamp((d - W.falloffStart) / (W.falloffEnd - W.falloffStart), 0, 1));
  }

  function inBeam(x, y, r, a0, half) {
    const d2 = x * x + y * y;
    if (d2 > WORLD.beamLength * WORLD.beamLength) return false;
    if (d2 < 1) return true;
    const d = Math.sqrt(d2);
    const tol = half + Math.asin(Math.min(1, r / d));
    let diff = Math.abs(angleDiff(a0, Math.atan2(y, x)));
    if (diff > Math.PI / 2) diff = Math.PI - diff; // the opposite cone
    return diff <= tol;
  }

  function updateBeam(dt) {
    const L = lv('beam');
    const bs = beamStats(L);
    state.wpn.beamAngle = (state.wpn.beamAngle + bs.speed * dt) % TAU;
    const a0 = state.wpn.beamAngle;
    const hurting = L > 0 && state.phase === 'night';
    const dmg = bs.dps * state.stats.dmgMul * dt;
    for (const e of state.enemies) {
      if (e.dead) continue;
      e.inBeam = inBeam(e.x, e.y, e.r, a0, bs.half);
      if (e.inBeam && hurting) {
        e.burn = 0.12;
        e.hp -= dmg * beamFalloff(e.x, e.y);
        if (e.hp <= 0) killEnemy(e);
        else if (Math.random() < dt * 6) addParticle(e.x + rand(-e.r, e.r), e.y + rand(-e.r, e.r), rand(-20, 20), rand(-60, -20), 0.5, 3, COLORS.lantern);
      }
    }
    const b = state.boss;
    if (b && !b.dead) {
      b.inBeam = inBeam(b.x, b.y, b.r, a0, bs.half);
      if (b.inBeam && hurting && b.emerge >= 1) { b.burn = 0.12; hurtBoss(dmg * beamFalloff(b.x, b.y), true); }
    }
    // Lighthouse flare when the beam passes over the player
    const p = state.player;
    if (!reducedMotion && inBeam(p.x, p.y, 4, a0, bs.half * 0.6)) state.flare = Math.min(1, state.flare + dt * 6);
  }

  function updateSpark(dt) {
    const L = lv('spark');
    if (!L) return;
    const w = state.wpn;
    w.sparkCd -= dt;
    if (w.sparkCd > 0) return;
    const p = state.player;
    const W = WEAPONS.spark;
    const target = nearestTarget(p.x, p.y, W.range);
    if (!target) { w.sparkCd = 0; return; }
    const st = sparkStats(L);
    const base = Math.atan2(target.y - p.y, target.x - p.x);
    for (let i = 0; i < st.count; i++) {
      const a = base + (i - (st.count - 1) / 2) * W.spread;
      state.shots.push({
        kind: 'spark', x: p.x + Math.cos(a) * p.r * 0.6, y: p.y + Math.sin(a) * p.r * 0.6,
        vx: Math.cos(a) * W.speed, vy: Math.sin(a) * W.speed, a, r: W.r,
        dmg: st.dmg * state.stats.dmgMul, pierce: st.pierce, life: W.life, hit: null, knock: W.knock,
      });
    }
    w.sparkCd = st.cd * state.stats.cdMul;
    Sound.play('spark');
  }

  function updateHarpoon(dt) {
    const L = lv('harpoon');
    if (!L) return;
    const w = state.wpn;
    w.harpoonCd -= dt;
    if (w.harpoonCd > 0) return;
    const p = state.player;
    let a;
    if (p.moving) a = p.facing;
    else {
      const t = nearestTarget(p.x, p.y, 900);
      if (!t) { w.harpoonCd = 0.15; return; }
      a = Math.atan2(t.y - p.y, t.x - p.x);
    }
    const st = harpoonStats(L);
    const W = WEAPONS.harpoon;
    for (let k = 0; k < st.count; k++) {
      const ang = a + k * Math.PI;
      state.shots.push({
        kind: 'harpoon', x: p.x + Math.cos(ang) * p.r, y: p.y + Math.sin(ang) * p.r,
        vx: Math.cos(ang) * W.speed, vy: Math.sin(ang) * W.speed, a: ang, r: W.r,
        dmg: st.dmg * state.stats.dmgMul, pierce: Infinity, life: W.life, hit: new Set(), knock: W.knock,
      });
    }
    w.harpoonCd = st.cd * state.stats.cdMul;
    Sound.play('harpoon');
  }

  function updateAura(dt) {
    const L = lv('aura');
    const w = state.wpn;
    w.auraPulse = Math.max(0, w.auraPulse - dt * 3);
    if (!L) return;
    w.auraT -= dt;
    if (w.auraT > 0) return;
    w.auraT = Math.max(0.05, w.auraT + WEAPONS.aura.tick * state.stats.cdMul);
    const st = auraStats(L);
    const p = state.player;
    const dmg = st.dmg * state.stats.dmgMul;
    queryEnemies(p.x, p.y, st.r + 40, tmpList);
    for (const e of tmpList) {
      const rr = st.r + e.r * 0.5;
      const d2 = dist2(p.x, p.y, e.x, e.y);
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1;
        damageEnemy(e, dmg, ((e.x - p.x) / d) * WEAPONS.aura.knock, ((e.y - p.y) / d) * WEAPONS.aura.knock, false);
      }
    }
    const b = state.boss;
    if (b && !b.dead && b.emerge >= 1) {
      const rr = st.r + b.r * 0.6;
      if (dist2(p.x, p.y, b.x, b.y) < rr * rr) hurtBoss(dmg, false);
    }
    w.auraPulse = 1;
  }

  function anchorPositions(out) {
    const L = lv('anchors');
    out.length = 0;
    if (!L) return out;
    const st = anchorStats(L);
    const p = state.player;
    const W = WEAPONS.anchors;
    for (let k = 0; k < st.count; k++) {
      const a = state.wpn.anchorAngle + (k * TAU) / st.count;
      out.push({ x: p.x + Math.cos(a) * W.orbit, y: p.y + Math.sin(a) * W.orbit, a });
    }
    return out;
  }
  const anchorTmp = [];

  function updateAnchors(dt) {
    const L = lv('anchors');
    if (!L) return;
    const W = WEAPONS.anchors;
    state.wpn.anchorAngle = (state.wpn.anchorAngle + W.spin * dt) % TAU;
    const st = anchorStats(L);
    const dmg = st.dmg * state.stats.dmgMul;
    const p = state.player;
    for (const an of anchorPositions(anchorTmp)) {
      queryEnemies(an.x, an.y, W.r + 40, tmpList);
      for (const e of tmpList) {
        if (e.anchorCd > 0) continue;
        const rr = W.r + e.r;
        if (dist2(an.x, an.y, e.x, e.y) > rr * rr) continue;
        e.anchorCd = W.hitCd;
        const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
        damageEnemy(e, dmg, ((e.x - p.x) / d) * W.knock, ((e.y - p.y) / d) * W.knock, true);
      }
      const b = state.boss;
      if (b && !b.dead && b.emerge >= 1 && b.anchorCd <= 0) {
        const rr = W.r + b.r;
        if (dist2(an.x, an.y, b.x, b.y) < rr * rr) {
          b.anchorCd = W.hitCd;
          hurtBoss(dmg, false);
          addText(b.x + rand(-20, 20), b.y - b.r * 0.6, Math.round(dmg), COLORS.parchment, 14);
        }
      }
    }
  }

  function updateWeapons(dt) {
    updateSpark(dt);
    updateHarpoon(dt);
    updateAura(dt);
    updateAnchors(dt);
  }

  function updateShots(dt) {
    const list = state.shots;
    const cullR = WORLD.islandR + 700;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.life > 0 && s.x * s.x + s.y * s.y < cullR * cullR) {
        queryEnemies(s.x, s.y, s.r + 44, tmpList);
        for (const e of tmpList) {
          if (s.hit && s.hit.has(e.id)) continue;
          const rr = e.r + s.r;
          if (dist2(s.x, s.y, e.x, e.y) > rr * rr) continue;
          const sp = Math.hypot(s.vx, s.vy) || 1;
          damageEnemy(e, s.dmg, (s.vx / sp) * s.knock, (s.vy / sp) * s.knock, true);
          if (s.kind === 'spark') burst(s.x, s.y, 3, COLORS.lantern, 90, 0.25, 2.5);
          if (s.pierce > 0) {
            s.pierce--;
            if (!s.hit) s.hit = new Set();
            s.hit.add(e.id);
          } else {
            s.life = 0;
            break;
          }
        }
        const b = state.boss;
        if (s.life > 0 && b && !b.dead && b.emerge >= 1 && !(s.hit && s.hit.has('boss'))) {
          const rr = b.r * 0.9 + s.r;
          if (dist2(s.x, s.y, b.x, b.y) < rr * rr) {
            hurtBoss(s.dmg, false);
            addText(s.x, s.y - 10, Math.round(s.dmg), COLORS.parchment, s.kind === 'harpoon' ? 18 : 13);
            burst(s.x, s.y, 4, COLORS.lantern, 120, 0.3, 3);
            if (s.kind === 'harpoon') s.hit.add('boss');
            else s.life = 0;
          }
        }
      }
      if (s.life <= 0 || s.x * s.x + s.y * s.y >= cullR * cullR) {
        list[i] = list[list.length - 1];
        list.pop();
      }
    }
  }

  // =========================================================================
  // 8. ENEMIES, BOSSES & SPAWNER
  // =========================================================================

  function makeEnemy(type, x, y, elite) {
    const def = ENEMIES[type];
    const n = state.night;
    const hpMul = (1 + SCALING.hpPerNight * (n - 1)) * (elite ? SCALING.eliteHp : 1);
    const r = def.r * (elite ? SCALING.eliteSize : 1);
    const p = state.player;
    const face = Math.atan2(p.y - y, p.x - x);
    return {
      id: state.nextId++, type, def, x, y, vx: 0, vy: 0, kx: 0, ky: 0,
      r, baseR: r, hp: def.hp * hpMul, maxHp: def.hp * hpMul,
      speed: def.speed * rand(0.92, 1.08),
      dmg: def.dmg * (1 + SCALING.dmgPerNight * (n - 1)),
      ember: def.ember * (elite ? SCALING.eliteEmbers : 1),
      elite: !!elite, flash: 0, burn: 0, anchorCd: 0, inBeam: false, dead: false,
      t: Math.random() * 10, seed: Math.random() * TAU, face, heading: face,
      inflate: 0, orbitDir: Math.random() < 0.5 ? -1 : 1,
      shotT: def.shotEvery ? rand(1.2, def.shotEvery) : 0,
      emerge: 1, wx: x, wy: y,
    };
  }

  function spawnRingRadius() {
    const hw = view.w / view.zoom / 2, hh = view.h / view.zoom / 2;
    return Math.hypot(hw, hh) + SPAWN.ringMargin;
  }

  function spawnEnemy(type, x, y, elite, emerge) {
    if (state.enemies.length >= SPAWN.maxAlive) return null;
    const e = makeEnemy(type, x, y, elite);
    if (emerge) e.emerge = 0;
    state.enemies.push(e);
    return e;
  }

  function spawnAtRing(type, count) {
    const p = state.player;
    const R = spawnRingRadius();
    const a = Math.random() * TAU;
    for (let i = 0; i < count; i++) {
      const aa = a + (count > 1 ? rand(-0.12, 0.12) : 0);
      const rr = R + (count > 1 ? rand(0, 60) : 0);
      const elite = state.night >= SCALING.eliteFromNight && Math.random() < SCALING.eliteChance;
      spawnEnemy(type, p.x + Math.cos(aa) * rr, p.y + Math.sin(aa) * rr, elite, false);
    }
  }

  function updateSpawner(dt) {
    const n = state.night;
    const ramp = lerp(SPAWN.rampStart, SPAWN.rampEnd, clamp(state.nightT / state.nightDur, 0, 1));
    let rate = (SPAWN.base + SPAWN.perNight * (n - 1)) * ramp;
    if (state.isBossNight) rate *= NIGHTS.bossSpawnFactor;
    state.spawnAcc += rate * dt;
    let guard = 0;
    while (state.spawnAcc >= 1 && guard++ < 20) {
      if (state.enemies.length >= SPAWN.maxAlive) { state.spawnAcc = Math.min(state.spawnAcc, 1); break; }
      const type = weightedPick(spawnWeights(n));
      const group = (type === 'crab' || type === 'jelly') && Math.random() < SPAWN.groupChance ? SPAWN.groupSize : 1;
      spawnAtRing(type, group);
      state.spawnAcc -= group;
    }
  }

  function pushOutOfLighthouse(o, factor) {
    const min = WORLD.lighthouseR + o.r * (factor || 0.8);
    const d2 = o.x * o.x + o.y * o.y;
    if (d2 < min * min) {
      const d = Math.sqrt(d2);
      if (d < 0.01) { o.x = min; o.y = 0; return; }
      o.x *= min / d;
      o.y *= min / d;
    }
  }

  function updateEnemies(dt) {
    const p = state.player;
    const recycleR = spawnRingRadius() + SPAWN.recycleExtra;
    const night = state.phase === 'night';
    for (const e of state.enemies) {
      if (e.dead) continue;
      const def = e.def;
      e.t += dt;
      if (e.flash > 0) e.flash -= dt;
      if (e.burn > 0) e.burn -= dt;
      e.anchorCd -= dt;
      if (e.emerge < 1) {
        e.emerge = Math.min(1, e.emerge + dt / 0.45);
        continue;
      }
      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      let sp = e.speed * (e.inBeam ? 1 - WORLD.beamSlow : 1);
      let mx = ux, my = uy;
      switch (e.type) {
        case 'crab': {
          const j = Math.sin(e.t * 3.1 + e.seed) * 0.45;
          mx = ux - uy * j; my = uy + ux * j;
          break;
        }
        case 'jelly': {
          const j = Math.sin(e.t * 2.2 + e.seed) * 1.05;
          mx = ux - uy * j; my = uy + ux * j;
          sp *= 0.72 + 0.45 * Math.max(0, Math.sin(e.t * 4.4 + e.seed));
          break;
        }
        case 'eel': {
          const target = Math.atan2(dy, dx);
          const diff = angleDiff(e.heading, target);
          e.heading += clamp(diff, -def.turn * dt, def.turn * dt);
          mx = Math.cos(e.heading); my = Math.sin(e.heading);
          break;
        }
        case 'puffer': {
          const want = d < def.inflateDist ? 1 : 0;
          e.inflate += (want - e.inflate) * Math.min(1, dt * 4);
          e.r = e.baseR * (1 + (def.inflateScale - 1) * e.inflate);
          sp *= 1 - 0.35 * e.inflate;
          break;
        }
        case 'squid': {
          if (d > def.keep + 40) { mx = ux; my = uy; }
          else if (d < def.keep - 60) { mx = -ux; my = -uy; sp *= 0.85; }
          else { mx = -uy * e.orbitDir; my = ux * e.orbitDir; sp *= 0.55; }
          e.shotT -= dt;
          if (e.shotT <= 0) {
            e.shotT = def.shotEvery * rand(0.9, 1.1);
            if (night && d < def.shotRange) {
              const dmgMul = 1 + SCALING.dmgPerNight * (state.night - 1);
              fireInk(e.x + ux * e.r, e.y + uy * e.r, Math.atan2(dy, dx), def.shotSpeed, def.shotDmg * dmgMul, 3.2, 8, false);
              Sound.play('ink');
            }
          }
          break;
        }
        default: break;
      }
      const ml = Math.hypot(mx, my) || 1;
      e.vx = (mx / ml) * sp;
      e.vy = (my / ml) * sp;
      e.x += (e.vx + e.kx) * dt;
      e.y += (e.vy + e.ky) * dt;
      const kd = Math.exp(-dt * 7);
      e.kx *= kd;
      e.ky *= kd;
      pushOutOfLighthouse(e);
      if (e.type === 'squid') e.face += angleDiff(e.face, Math.atan2(dy, dx)) * Math.min(1, dt * 6);
      else if (e.type === 'eel') e.face = e.heading;
      else e.face += angleDiff(e.face, Math.atan2(e.vy, e.vx)) * Math.min(1, dt * 8);
      if (d > recycleR) {
        // creature lost the trail — bring it back from the dark at the edge of view
        const a = Math.random() * TAU, R = spawnRingRadius();
        e.x = p.x + Math.cos(a) * R;
        e.y = p.y + Math.sin(a) * R;
        e.kx = e.ky = 0;
      }
    }
  }

  function separateEnemies() {
    const list = state.enemies;
    for (const e of list) {
      if (e.dead) continue;
      queryEnemies(e.x, e.y, e.r + 30, tmpList);
      for (const o of tmpList) {
        if (o.id <= e.id) continue;
        const dx = o.x - e.x, dy = o.y - e.y;
        const rr = (e.r + o.r) * 0.85;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 0.0001) continue;
        const d = Math.sqrt(d2);
        const push = (rr - d) * 0.25;
        const nx = dx / d, ny = dy / d;
        e.x -= nx * push; e.y -= ny * push;
        o.x += nx * push; o.y += ny * push;
      }
    }
    // Boss shoves small creatures aside
    const b = state.boss;
    if (b && !b.dead) {
      queryEnemies(b.x, b.y, b.r + 40, tmpList);
      for (const o of tmpList) {
        const dx = o.x - b.x, dy = o.y - b.y;
        const rr = (b.r + o.r) * 0.85;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 0.0001) continue;
        const d = Math.sqrt(d2);
        o.x += (dx / d) * (rr - d) * 0.5;
        o.y += (dy / d) * (rr - d) * 0.5;
      }
    }
  }

  function damageEnemy(e, amount, kx, ky, showNumber) {
    if (e.dead) return;
    e.hp -= amount;
    e.flash = 0.08;
    const kb = e.type === 'puffer' ? 0.4 : 1;
    e.kx += kx * kb;
    e.ky += ky * kb;
    if (showNumber) addText(e.x + rand(-6, 6), e.y - e.r - 4, Math.round(amount), COLORS.parchment, 13);
    if (e.hp <= 0) killEnemy(e);
    else Sound.play('hit');
  }

  function killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    state.kills++;
    state.nightKills++;
    const c = e.elite ? COLORS.gold : e.def.glow;
    burst(e.x, e.y, e.elite ? 16 : 9, c, 150, 0.6, 3.2);
    addRing(e.x, e.y, e.r * 0.6, e.r * 2.6, 0.35, c);
    dropEmber(e.x, e.y, e.ember);
    Sound.play('death');
  }

  function fireInk(x, y, a, speed, dmg, life, r, boss) {
    state.inks.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, dmg, life, r, t: 0, boss: !!boss });
  }

  function updateInks(dt) {
    const p = state.player;
    const list = state.inks;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      s.t += dt;
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      let gone = s.life <= 0;
      if (!gone && state.phase === 'night') {
        const rr = s.r + p.r * 0.8;
        if (dist2(s.x, s.y, p.x, p.y) < rr * rr) {
          if (p.invuln <= 0) {
            hurtPlayer(s.dmg, s.boss ? 'orb' : 'ink');
            gone = true;
            burst(s.x, s.y, 8, COLORS.ink, 120, 0.4, 3);
          }
        }
      }
      if (gone) {
        list[i] = list[list.length - 1];
        list.pop();
      }
    }
  }

  // ---- Bosses ----

  function spawnBoss() {
    const type = state.night >= NIGHTS.total ? 'leviathan' : 'crabKing';
    const def = BOSSES[type];
    const p = state.player;
    // rise from the sea side of the player, near the edge of the view
    let a = Math.atan2(p.y, p.x);
    if (p.x * p.x + p.y * p.y < 150 * 150) a = Math.random() * TAU;
    a += rand(-0.5, 0.5);
    const R = clamp(Math.min(view.w, view.h) / view.zoom * 0.42, 260, 420);
    const b = {
      type, def, x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R, r: def.r,
      hp: def.hp, maxHp: def.hp, flash: 0, burn: 0, anchorCd: 0, inBeam: false, dead: false,
      t: 0, emerge: 0, face: a + Math.PI, mode: 'walk', modeT: 0,
      attackT: type === 'crabKing' ? 2.5 : 1.5,
      summonT: type === 'crabKing' ? def.summonEvery * 0.6 : def.summonEvery,
      ringT: 1.6, slamT: 3.2, dashDx: 0, dashDy: 0, dashLeft: 0,
      enraged: false, segs: [], wobble: 0,
    };
    if (type === 'leviathan') {
      for (let i = 0; i < 11; i++) b.segs.push({ x: b.x - Math.cos(b.face) * i * 40, y: b.y - Math.sin(b.face) * i * 40 });
    }
    state.boss = b;
    addRing(b.x, b.y, 20, b.r * 3, 1.2, def.glow);
    addRing(b.x, b.y, 10, b.r * 2, 0.9, COLORS.parchment);
    showBanner(def.banner, def.bannerSub, 2.8, true);
    Sound.play('roar', null, true);
    addShake(0.5);
  }

  function hurtBoss(amount, silent) {
    const b = state.boss;
    if (!b || b.dead) return;
    b.hp -= amount;
    if (!silent) { b.flash = 0.07; Sound.play('hit'); }
    if (b.type === 'leviathan' && !b.enraged && b.hp < b.maxHp * 0.5 && b.hp > 0) {
      b.enraged = true;
      b.summonT = 1.5;
      showToast('O Leviatã se enfurece!');
      Sound.play('roar', null, true);
      addShake(0.35);
    }
    if (b.hp <= 0) killBoss();
  }

  function killBoss() {
    const b = state.boss;
    if (!b || b.dead) return;
    b.dead = true;
    b.hp = 0;
    state.bossKills++;
    state.bossDefeated = true;
    const c = b.def.glow;
    burst(b.x, b.y, 60, c, 320, 1.4, 5);
    burst(b.x, b.y, 30, COLORS.gold, 220, 1.1, 4);
    addRing(b.x, b.y, b.r, b.r * 5, 1.0, c);
    addRing(b.x, b.y, b.r * 0.5, b.r * 3.5, 0.8, COLORS.parchment);
    const pieces = 16;
    for (let i = 0; i < pieces; i++) {
      const a = (i / pieces) * TAU;
      dropEmber(b.x + Math.cos(a) * b.r * 0.5, b.y + Math.sin(a) * b.r * 0.5, Math.round(b.def.emberTotal / pieces), 160);
    }
    Sound.play('bossDie', null, true);
    addShake(0.8);
    state.boss = null;
    endNight();
  }

  function updateBoss(dt) {
    const b = state.boss;
    if (!b || b.dead) return;
    const def = b.def;
    b.t += dt;
    if (b.flash > 0) b.flash -= dt;
    if (b.burn > 0) b.burn -= dt;
    b.anchorCd -= dt;
    if (b.emerge < 1) {
      b.emerge = Math.min(1, b.emerge + dt / 1.2);
      if (Math.random() < dt * 30) addParticle(b.x + rand(-b.r, b.r), b.y + rand(-b.r, b.r), rand(-30, 30), rand(-80, -30), 0.8, 4, def.glow);
      return;
    }
    if (state.phase !== 'night') return;
    const p = state.player;
    const dx = p.x - b.x, dy = p.y - b.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const slow = b.inBeam ? 1 - WORLD.beamSlow * WORLD.bossBeamSlowFactor : 1;

    if (b.type === 'crabKing') {
      b.attackT -= dt;
      b.summonT -= dt;
      if (b.summonT <= 0) {
        b.summonT = def.summonEvery;
        for (let i = 0; i < def.summonCount; i++) {
          const a = (i / def.summonCount) * TAU + rand(-0.3, 0.3);
          const e = spawnEnemy('crab', b.x + Math.cos(a) * (b.r + 30), b.y + Math.sin(a) * (b.r + 30), false, true);
          if (e) addRing(e.x, e.y, 4, 30, 0.5, ENEMIES.crab.glow);
        }
        Sound.play('summon');
      }
      if (b.mode === 'walk') {
        const sp = def.speed * slow;
        b.x += ux * sp * dt;
        b.y += uy * sp * dt;
        b.face += angleDiff(b.face, Math.atan2(dy, dx)) * Math.min(1, dt * 4);
        if (b.attackT <= 0) {
          b.attackT = def.dashEvery;
          b.mode = 'telegraph';
          b.modeT = 0;
          b.dashDx = ux; b.dashDy = uy;
          Sound.play('telegraph', null, true);
        }
      } else if (b.mode === 'telegraph') {
        b.modeT += dt;
        if (b.modeT < def.telegraph * 0.5) { // aims during the first half, then commits
          b.dashDx = ux; b.dashDy = uy;
          b.face = Math.atan2(uy, ux);
        }
        if (b.modeT >= def.telegraph) { b.mode = 'dash'; b.dashLeft = def.dashDist; }
      } else if (b.mode === 'dash') {
        const step = Math.min(b.dashLeft, def.dashSpeed * dt);
        b.x += b.dashDx * step;
        b.y += b.dashDy * step;
        b.dashLeft -= step;
        if (Math.random() < 0.6) addParticle(b.x - b.dashDx * b.r + rand(-20, 20), b.y - b.dashDy * b.r + rand(-20, 20), rand(-30, 30), rand(-30, 30), 0.5, 4, '#c9b48a');
        if (b.dashLeft <= 0.01) {
          b.mode = 'recover';
          b.modeT = 0;
          addShake(0.25);
          addRing(b.x, b.y, b.r * 0.6, b.r * 2, 0.4, '#c9b48a');
          Sound.play('slam');
        }
      } else if (b.mode === 'recover') {
        b.modeT += dt;
        if (b.modeT >= def.recover) b.mode = 'walk';
      }
    } else {
      // Leviathan: drifts toward the player but keeps its distance
      const sp = def.speed * slow;
      let mx, my, s = sp;
      if (d > def.keep + 40) { mx = ux; my = uy; }
      else if (d < def.keep - 40) { mx = -ux; my = -uy; s = sp * 0.8; }
      else { mx = -uy; my = ux; s = sp * 0.6; }
      b.x += mx * s * dt;
      b.y += my * s * dt;
      b.face += angleDiff(b.face, Math.atan2(dy, dx)) * Math.min(1, dt * 2);
      b.ringT -= dt;
      b.slamT -= dt;
      if (b.ringT <= 0) {
        b.ringT = def.ringEvery;
        const n = b.enraged ? def.ringCountEnraged : def.ringCount;
        const off = Math.random() * TAU;
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * TAU;
          fireInk(b.x + Math.cos(a) * b.r * 0.7, b.y + Math.sin(a) * b.r * 0.7, a, def.orbSpeed, def.orbDmg, def.orbLife, 9, true);
        }
        addRing(b.x, b.y, b.r * 0.5, b.r * 1.6, 0.5, COLORS.ink);
        Sound.play('ring', null, true);
      }
      if (b.slamT <= 0) {
        b.slamT = def.slamEvery;
        const lead = p.moving ? 0.9 : 0;
        const tx2 = p.x + p.vx * lead + (p.moving ? 0 : rand(-150, 150));
        const ty2 = p.y + p.vy * lead + (p.moving ? 0 : rand(-150, 150));
        addSlam(p.x, p.y, def.slamR, def.slamWarn, def.slamDmg);
        addSlam(tx2, ty2, def.slamR, def.slamWarn + 0.25, def.slamDmg);
        Sound.play('telegraph', null, true);
      }
      if (b.enraged) {
        b.summonT -= dt;
        if (b.summonT <= 0) {
          b.summonT = def.summonEvery;
          for (let i = 0; i < def.summonCount; i++) {
            const a = b.face + (i - 1) * 0.8;
            const e = spawnEnemy('eel', b.x + Math.cos(a) * (b.r + 30), b.y + Math.sin(a) * (b.r + 30), false, true);
            if (e) addRing(e.x, e.y, 4, 30, 0.5, ENEMIES.eel.glow);
          }
          Sound.play('summon');
        }
      }
      // body segments follow the head
      let px = b.x, py = b.y;
      for (const s of b.segs) {
        const sdx = s.x - px, sdy = s.y - py;
        const sd = Math.hypot(sdx, sdy) || 1;
        const gap = 38;
        if (sd > gap) { s.x = px + (sdx / sd) * gap; s.y = py + (sdy / sd) * gap; }
        px = s.x; py = s.y;
      }
    }
    pushOutOfLighthouse(b, 0.6);
  }

  function addSlam(x, y, r, warn, dmg) {
    state.slams.push({ x, y, r, warn, t: 0, dmg, hit: false, after: 0 });
  }

  function updateSlams(dt) {
    const p = state.player;
    const list = state.slams;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      s.t += dt;
      if (!s.hit && s.t >= s.warn) {
        s.hit = true;
        if (state.phase === 'night' && dist2(p.x, p.y, s.x, s.y) < (s.r + p.r * 0.5) * (s.r + p.r * 0.5)) {
          hurtPlayer(s.dmg, 'slam');
        }
        addShake(0.4);
        addRing(s.x, s.y, s.r * 0.3, s.r * 1.4, 0.5, BOSSES.leviathan.glow);
        burst(s.x, s.y, 18, BOSSES.leviathan.glow, 260, 0.7, 4);
        Sound.play('slam', null, true);
      }
      if (s.hit) s.after += dt;
      if (s.after > 0.45) {
        list[i] = list[list.length - 1];
        list.pop();
      }
    }
  }

  // ---- Embers (XP) ----

  function dropEmber(x, y, value, speed) {
    if (value <= 0) return;
    const list = state.embers;
    if (list.length >= LIMITS.embers) {
      const o = list[(Math.random() * list.length) | 0];
      o.value += value;
      return;
    }
    const a = Math.random() * TAU, s = rand(20, speed || 80);
    list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, value, t: 0, pull: 0, seed: Math.random() * TAU });
  }

  function collectEmber(m) {
    state.embersCollected += m.value;
    state.nightEmbers += m.value;
    gainXp(m.value);
    state.pickupCombo = state.pickupComboT > 0 ? state.pickupCombo + 1 : 0;
    state.pickupComboT = 0.4;
    Sound.play('pickup', state.pickupCombo);
    addParticle(m.x, m.y, 0, -30, 0.3, 4, COLORS.lantern);
  }

  function gainXp(v) {
    state.xp += v;
    let guard = 0;
    while (state.xp >= xpToNext(state.level) && guard++ < 500) {
      state.xp -= xpToNext(state.level);
      state.level++;
      state.pendingLevelUps++;
    }
  }

  function updateEmbers(dt) {
    const p = state.player;
    const R = state.stats.pickupR;
    const collectAll = state.phase === 'sunrise';
    const canCollect = state.phase !== 'dying';
    if (state.pickupComboT > 0) state.pickupComboT -= dt;
    const list = state.embers;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      m.t += dt;
      const dx = p.x - m.x, dy = p.y - m.y;
      const d = Math.hypot(dx, dy) || 1;
      if (canCollect && (collectAll || m.pull > 0 || d < R)) {
        m.pull += dt;
        const sp = collectAll ? 500 + m.pull * 1600 : Math.min(900, 160 + m.pull * 1400);
        const k = Math.min(1, dt * 12);
        m.vx += ((dx / d) * sp - m.vx) * k;
        m.vy += ((dy / d) * sp - m.vy) * k;
      } else {
        const f = Math.exp(-dt * 4);
        m.vx *= f;
        m.vy *= f;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (canCollect && d < p.r + 8 + Math.hypot(m.vx, m.vy) * dt) {
        collectEmber(m);
        list[i] = list[list.length - 1];
        list.pop();
      }
    }
  }

  // ---- Player ----

  function updatePlayer(dt) {
    const p = state.player;
    const s = state.stats;
    if (p.hurtT > 0) p.hurtT -= dt;
    if (state.phase === 'dying') {
      p.vx *= 0.9;
      p.vy *= 0.9;
      p.moving = false;
      return;
    }
    const v = Input.vector();
    const tx = v.x * s.speed, ty = v.y * s.speed;
    const k = Math.min(1, dt * PLAYER.accel);
    p.vx += (tx - p.vx) * k;
    p.vy += (ty - p.vy) * k;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const mag = Math.hypot(v.x, v.y);
    p.moving = mag > 0.05;
    if (p.moving) p.facing = Math.atan2(v.y, v.x);
    p.face += angleDiff(p.face, p.facing) * Math.min(1, dt * 14);
    p.step += Math.hypot(p.vx, p.vy) * dt;
    // stay on the island
    let d = Math.hypot(p.x, p.y);
    const maxD = WORLD.islandR - p.r;
    if (d > maxD) { p.x *= maxD / d; p.y *= maxD / d; d = maxD; }
    // and out of the lighthouse
    const minD = WORLD.lighthouseR + p.r;
    if (d < minD) {
      if (d < 0.01) { p.x = minD; p.y = 0; }
      else { p.x *= minD / d; p.y *= minD / d; }
    }
    if (p.invuln > 0) p.invuln -= dt;
    if (s.regen > 0 && p.hp > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + s.regen * dt);
  }

  function hurtPlayer(dmg, src) {
    const p = state.player;
    if (p.invuln > 0 || state.phase !== 'night') return;
    p.invuln = PLAYER.invuln;
    if (state.god) return;
    const key = src || 'contact';
    state.damageTaken[key] = (state.damageTaken[key] || 0) + dmg;
    p.hp -= dmg;
    p.hurtT = 0.25;
    addShake(Math.min(0.45, 0.12 + dmg / 80));
    burst(p.x, p.y, 8, COLORS.danger, 140, 0.4, 3);
    addText(p.x, p.y - 28, '-' + Math.round(dmg), COLORS.danger, 16);
    Sound.play('hurt', null, true);
    if (p.hp <= 0) {
      p.hp = 0;
      startDying();
    }
  }

  function checkPlayerContacts() {
    if (state.phase !== 'night') return;
    const p = state.player;
    if (p.invuln > 0) return;
    queryEnemies(p.x, p.y, p.r + 50, tmpList);
    for (const e of tmpList) {
      if (e.emerge < 1) continue;
      const rr = e.r * 0.85 + p.r * 0.85;
      if (dist2(p.x, p.y, e.x, e.y) < rr * rr) {
        hurtPlayer(e.dmg, e.type);
        const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
        e.kx += ((e.x - p.x) / d) * 120;
        e.ky += ((e.y - p.y) / d) * 120;
        return;
      }
    }
    const b = state.boss;
    if (b && !b.dead && b.emerge >= 1) {
      const rr = b.r * 0.8 + p.r * 0.85;
      if (dist2(p.x, p.y, b.x, b.y) < rr * rr) hurtPlayer(b.def.dmg, 'boss');
    }
  }

  function compactEnemies() {
    const a = state.enemies;
    let j = 0;
    for (let i = 0; i < a.length; i++) if (!a[i].dead) a[j++] = a[i];
    a.length = j;
  }

  // =========================================================================
  // 9. PARTICLES & FLOATING TEXT
  // =========================================================================

  function addParticle(x, y, vx, vy, life, size, color, kind, r1) {
    const p = { x, y, vx, vy, life, max: life, size, color, kind: kind || 'dot', r0: size, r1: r1 || 0 };
    const arr = state.particles;
    if (arr.length < LIMITS.particles) arr.push(p);
    else {
      state.pIdx = (state.pIdx + 1) % LIMITS.particles;
      arr[state.pIdx] = p;
    }
  }
  function burst(x, y, n, color, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = rand(0.25, 1) * speed;
      addParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, life * rand(0.6, 1.1), size * rand(0.6, 1.2), color);
    }
  }
  function addRing(x, y, r0, r1, life, color) {
    addParticle(x, y, 0, 0, life, r0, color, 'ring', r1);
  }
  function updateParticles(dt) {
    const arr = state.particles;
    const drag = Math.exp(-dt * 3);
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) {
        arr[i] = arr[arr.length - 1];
        arr.pop();
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
      if (p.kind === 'bubble') p.vy -= 40 * dt;
    }
    if (state.pIdx >= arr.length) state.pIdx = 0;
  }

  function addText(x, y, text, color, size) {
    const t = state.texts;
    if (t.length >= LIMITS.texts) t.shift();
    t.push({ x, y, text: String(text), color, size: size || 14, life: 0.8, max: 0.8, vy: -46 });
  }
  function updateTexts(dt) {
    const t = state.texts;
    for (let i = t.length - 1; i >= 0; i--) {
      const x = t[i];
      x.life -= dt;
      x.y += x.vy * dt;
      x.vy *= Math.exp(-dt * 3);
      if (x.life <= 0) t.splice(i, 1);
    }
  }

  function addShake(a) {
    if (reducedMotion) return;
    state.shake = Math.min(1, Math.max(state.shake, a));
  }

  // =========================================================================
  // 10. SIMULATION STEP / NIGHT FLOW
  // =========================================================================

  function update(dt) {
    state.time += dt;
    if (state.phase === 'night') state.nightT += dt;
    updateBeam(dt);
    updatePlayer(dt);
    if (state.phase === 'night') {
      updateSpawner(dt);
      if (state.isBossNight && !state.boss && !state.bossDefeated) {
        state.bossSpawnT -= dt;
        if (state.bossSpawnT <= 0) spawnBoss();
      }
    }
    updateEnemies(dt);
    updateBoss(dt);
    rebuildGrid();
    separateEnemies();
    if (state.phase === 'night') updateWeapons(dt);
    else {
      state.wpn.anchorAngle = (state.wpn.anchorAngle + WEAPONS.anchors.spin * dt) % TAU;
      state.wpn.auraPulse = Math.max(0, state.wpn.auraPulse - dt * 3);
    }
    updateShots(dt);
    updateInks(dt);
    updateSlams(dt);
    updateEmbers(dt);
    checkPlayerContacts();
    compactEnemies();
    updateParticles(dt);
    updateTexts(dt);
    state.shake = Math.max(0, state.shake - dt * 2.4);
    state.flare = Math.max(0, state.flare - dt * 1.6);

    if (!state.recordToastShown && prefs.bestScore > 0 && currentScore() > prefs.bestScore) {
      state.recordToastShown = true;
      showToast('Novo recorde!');
    }

    if (state.phase === 'night') {
      if (!state.isBossNight && state.nightT >= state.nightDur) endNight();
      else if (state.pendingLevelUps > 0) openLevelUp('play');
    } else if (state.phase === 'sunrise') {
      state.phaseT += dt;
      if ((state.phaseT >= NIGHTS.sunrise && state.embers.length === 0) || state.phaseT >= NIGHTS.sunrise + 1.5) {
        // any stragglers are banked directly
        for (const m of state.embers) collectEmber(m);
        state.embers.length = 0;
        finishSunrise();
      }
    } else if (state.phase === 'dying') {
      state.phaseT += dt;
      if (state.phaseT >= 1.3) gameOver();
    }
  }

  // Cosmetic-only animation for menus and end screens (no gameplay)
  function updateCosmetic(dt) {
    state.wpn.beamAngle = (state.wpn.beamAngle + (TAU / WORLD.beamPeriod) * dt) % TAU;
    updateParticles(dt);
    updateTexts(dt);
    state.shake = Math.max(0, state.shake - dt * 2.4);
  }

  function pickWander(e) {
    const a = Math.random() * TAU, R = rand(380, 1050);
    e.wx = Math.cos(a) * R;
    e.wy = Math.sin(a) * R;
  }

  // Title "attract mode": creatures drift around the island, nobody gets hurt.
  function updateAttract(dt) {
    state.time += dt;
    updateCosmetic(dt);
    const p = state.player;
    const bs = beamStats(0);
    for (const e of state.enemies) {
      e.t += dt;
      const dx = e.wx - e.x, dy = e.wy - e.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 24) { pickWander(e); continue; }
      let mx = dx / d, my = dy / d;
      const pd = Math.hypot(e.x - p.x, e.y - p.y) || 1;
      if (pd < 320) { mx += ((e.x - p.x) / pd) * 1.5; my += ((e.y - p.y) / pd) * 1.5; }
      if (e.type === 'jelly' || e.type === 'crab') {
        const j = Math.sin(e.t * 2.2 + e.seed) * 0.6;
        const ox = mx, oy = my;
        mx = ox - oy * j; my = oy + ox * j;
      }
      const ml = Math.hypot(mx, my) || 1;
      e.inBeam = inBeam(e.x, e.y, e.r, state.wpn.beamAngle, bs.half);
      const sp = e.speed * 0.42 * (e.inBeam ? 0.65 : 1);
      e.vx = (mx / ml) * sp;
      e.vy = (my / ml) * sp;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.face += angleDiff(e.face, Math.atan2(e.vy, e.vx)) * Math.min(1, dt * 4);
      e.heading = e.face;
      pushOutOfLighthouse(e);
    }
  }

  function setupAttract() {
    state = makeState();
    recomputeStats();
    const p = state.player;
    p.x = 0; p.y = 96; p.face = p.facing = Math.PI / 2;
    const types = ['crab', 'crab', 'crab', 'jelly', 'jelly', 'eel', 'puffer', 'squid'];
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * TAU, R = rand(420, 1000);
      const e = makeEnemy(pick(types), Math.cos(a) * R, Math.sin(a) * R, Math.random() < 0.1);
      pickWander(e);
      state.enemies.push(e);
    }
    grid.clear();
    cam.x = 0;
    cam.y = 60;
    setScreen('title');
  }

  function newRun() {
    state = makeState();
    state.runActive = true;
    recomputeStats();
    cam.x = state.player.x;
    cam.y = state.player.y;
    grid.clear();
    beginNight();
  }

  function beginNight() {
    const n = state.night;
    state.phase = 'night';
    state.phaseT = 0;
    state.nightT = 0;
    state.nightDur = nightDuration(n);
    state.isBossNight = NIGHTS.bossNights.indexOf(n) >= 0;
    state.boss = null;
    state.bossDefeated = false;
    state.bossSpawnT = state.isBossNight ? NIGHTS.bossDelay : -1;
    state.nightKills = 0;
    state.nightEmbers = 0;
    state.spawnAcc = 0.6;
    state.enemies.length = 0;
    state.shots.length = 0;
    state.inks.length = 0;
    state.slams.length = 0;
    state.lightTarget = 0;
    state.wpn.sparkCd = Math.min(state.wpn.sparkCd, 0.3);
    state.afterLevelUp = 'play';
    if (state.player.hp <= 0) state.player.hp = state.player.maxHp;
    grid.clear();
    setScreen('playing');
    showOverlay(null);
    const sub = n === NIGHTS.total ? 'A última noite da quinzena'
      : state.isBossNight ? 'Algo enorme se move sob as ondas…'
        : 'de ' + NIGHTS.total;
    showBanner('Noite ' + n, sub, state.isBossNight ? 1.15 : 2.0, false);
  }

  function endNight() {
    if (state.phase !== 'night') return;
    state.phase = 'sunrise';
    state.phaseT = 0;
    state.nightsSurvived++;
    state.bossDefeated = true;
    for (const e of state.enemies) {
      if (e.dead) continue;
      const c = e.elite ? COLORS.gold : e.def.glow;
      for (let i = 0; i < 3; i++) {
        addParticle(e.x + rand(-e.r, e.r), e.y + rand(-e.r, e.r), rand(-25, 25), rand(-50, -10), rand(0.7, 1.3), rand(2.5, 4.5), c, 'bubble');
      }
    }
    for (const s of state.inks) addParticle(s.x, s.y, 0, -20, 0.6, 3, COLORS.ink, 'bubble');
    state.enemies.length = 0;
    state.inks.length = 0;
    state.slams.length = 0;
    state.lightTarget = 1;
    Sound.play('sunrise', null, true);
  }

  function finishSunrise() {
    if (state.night >= NIGHTS.total) { showVictory(); return; }
    if (state.pendingLevelUps > 0) { openLevelUp('dawn'); return; }
    showDawn();
  }

  function startDying() {
    if (state.phase === 'dying') return;
    state.phase = 'dying';
    state.phaseT = 0;
    state.deathNight = state.night;
    Input.releasePointer();
    const p = state.player;
    burst(p.x, p.y, 24, COLORS.lantern, 160, 1.0, 4);
    addRing(p.x, p.y, 10, 120, 0.9, COLORS.lantern);
    Sound.play('gameover', null, true);
  }

  function commitRecord() {
    if (state.runCommitted || !state.runActive) return false;
    state.runCommitted = true;
    const score = currentScore();
    const isNew = score > 0 && score > prefs.bestScore;
    if (isNew) prefs.bestScore = score;
    if (state.night > prefs.bestNight) prefs.bestNight = state.night;
    savePrefs();
    return isNew;
  }

  // =========================================================================
  // 11. RENDERING
  // =========================================================================

  let canvas = null, ctx = null, dark = null, dctx = null;
  let renderTime = 0;
  let canvasFont = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  const sprites = new Map();
  let lightSprite = null;
  let grassNoise = null, sandNoise = null;
  let islandBake = null; // pre-rendered static ground (big path fills are the costliest thing we draw)
  const BAKE_PX_PER_UNIT = 1;
  let coastPath = null, coastOuterPath = null, grassPath = null;
  let decor = null;
  const darkGrad = {};
  const DOCK_ANGLE = 2.25;
  const DARK_RES = 0.6; // darkness buffer pixels per CSS pixel

  const coastRadius = a => WORLD.islandR + 30 + 14 * Math.sin(5 * a + 0.6) + 8 * Math.sin(13 * a + 2.1) + 5 * Math.sin(23 * a + 4);
  const grassRadius = a => WORLD.islandR - WORLD.sandWidth + 18 * Math.sin(4 * a + 1) + 10 * Math.sin(9 * a) + 6 * Math.sin(17 * a + 2);

  function radialPath(fn, extra) {
    const path = new Path2D();
    const N = 260;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * TAU;
      const r = fn(a) + (extra || 0);
      if (i === 0) path.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else path.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    path.closePath();
    return path;
  }

  function makeNoisePattern(size, base, specks, seed) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d');
    c.fillStyle = base;
    c.fillRect(0, 0, size, size);
    const rng = mulberry32(seed);
    for (const s of specks) {
      c.fillStyle = s.color;
      for (let i = 0; i < s.count; i++) {
        const x = rng() * size, y = rng() * size, r = s.min + rng() * (s.max - s.min);
        if (s.blade) {
          c.save();
          c.translate(x, y);
          c.rotate(rng() * TAU);
          c.fillRect(-r * 0.15, -r, r * 0.3, r * 2);
          c.restore();
        } else {
          c.beginPath();
          c.arc(x, y, r, 0, TAU);
          c.fill();
        }
      }
    }
    return cv;
  }

  function patternFor(c, noise, fallback) {
    try {
      const pat = c.createPattern(noise, 'repeat');
      if (!pat) return fallback;
      if (pat.setTransform && window.DOMMatrix) pat.setTransform(new DOMMatrix([0.5, 0, 0, 0.5, 0, 0]));
      return pat;
    } catch (e) {
      return fallback;
    }
  }

  // Static ground: wet sand, sand, grass, the dirt path. Drawn into `c` in world units.
  function drawGround(c) {
    c.fillStyle = 'rgba(160,200,215,0.08)';
    c.fill(coastOuterPath);
    c.fillStyle = COLORS.wetSand;
    c.fill(coastPath);
    c.save();
    c.scale(0.985, 0.985);
    c.fillStyle = patternFor(c, sandNoise, COLORS.sand);
    c.fill(coastPath);
    c.restore();
    c.fillStyle = patternFor(c, grassNoise, COLORS.grass);
    c.fill(grassPath);
    c.strokeStyle = 'rgba(10,16,12,0.55)';
    c.lineWidth = 7;
    c.stroke(grassPath);
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(58,50,36,0.85)';
    c.lineWidth = 34;
    c.stroke(decor.path);
    c.strokeStyle = 'rgba(80,70,50,0.5)';
    c.lineWidth = 22;
    c.stroke(decor.path);
  }

  function bakeIsland() {
    islandBake = null;
    try {
      const half = Math.ceil(WORLD.islandR + 90);
      const size = Math.ceil(half * 2 * BAKE_PX_PER_UNIT);
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const c = cv.getContext('2d');
      if (!c || cv.width !== size) return;
      c.setTransform(BAKE_PX_PER_UNIT, 0, 0, BAKE_PX_PER_UNIT, half * BAKE_PX_PER_UNIT, half * BAKE_PX_PER_UNIT);
      drawGround(c);
      islandBake = { canvas: cv, half };
    } catch (e) {
      islandBake = null; // fall back to drawing the ground live
    }
  }

  function initRenderAssets() {
    // soft white light hole for destination-out
    lightSprite = document.createElement('canvas');
    lightSprite.width = lightSprite.height = 64;
    const lc = lightSprite.getContext('2d');
    const lg = lc.createRadialGradient(32, 32, 0, 32, 32, 32);
    lg.addColorStop(0, 'rgba(0,0,0,1)');
    lg.addColorStop(0.4, 'rgba(0,0,0,0.6)');
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = lg;
    lc.fillRect(0, 0, 64, 64);

    grassNoise = makeNoisePattern(256, COLORS.grass, [
      { color: '#1c2e22', count: 260, min: 2, max: 7 },
      { color: '#0f1a13', count: 220, min: 1.5, max: 5 },
      { color: '#24392a', count: 160, min: 2, max: 5, blade: true },
      { color: '#2c4632', count: 60, min: 1.5, max: 3.5, blade: true },
    ], 7);
    sandNoise = makeNoisePattern(256, COLORS.sand, [
      { color: '#454533', count: 400, min: 0.8, max: 2.4 },
      { color: '#2f2f24', count: 300, min: 0.8, max: 2.2 },
      { color: '#51503b', count: 80, min: 1, max: 2 },
    ], 11);

    coastPath = radialPath(coastRadius);
    coastOuterPath = radialPath(coastRadius, 18);
    grassPath = radialPath(grassRadius);

    // deterministic decorations
    const rng = mulberry32(1414);
    decor = { rocks: [], tufts: [], shells: [], shrooms: [], logs: [], flowers: [] };
    const nearPath = (x, y) => {
      // keep the dirt path to the dock mostly clear
      const a = Math.atan2(y, x), r = Math.hypot(x, y);
      return Math.abs(angleDiff(a, DOCK_ANGLE)) * r < 50 && r > 60;
    };
    for (let i = 0; i < 60; i++) {
      const a = rng() * TAU, r = 150 + rng() * 960;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (nearPath(x, y)) continue;
      const size = 9 + rng() * (r > 900 ? 26 : 20);
      const pts = [];
      const n = 7 + ((rng() * 3) | 0);
      for (let k = 0; k < n; k++) pts.push(0.7 + rng() * 0.35);
      decor.rocks.push({ x, y, size, pts, rot: rng() * TAU, shade: rng(), wet: r > coastRadius(a) - 70 });
    }
    for (let i = 0; i < 200; i++) {
      const a = rng() * TAU, r = 90 + rng() * (grassRadius(a) - 110);
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (nearPath(x, y)) continue;
      decor.tufts.push({ x, y, size: 5 + rng() * 7, rot: rng() * TAU, shade: rng() });
    }
    for (let i = 0; i < 55; i++) {
      const a = rng() * TAU;
      const r0 = grassRadius(a) + 20, r1 = coastRadius(a) - 12;
      const r = r0 + rng() * Math.max(0, r1 - r0);
      decor.shells.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, size: 2.5 + rng() * 3, rot: rng() * TAU, kind: rng() < 0.5 ? 0 : 1 });
    }
    for (let i = 0; i < 26; i++) {
      const a = rng() * TAU, r = 220 + rng() * 700;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (nearPath(x, y)) continue;
      const caps = [];
      const n = 2 + ((rng() * 3) | 0);
      for (let k = 0; k < n; k++) caps.push({ dx: (rng() - 0.5) * 16, dy: (rng() - 0.5) * 16, r: 2 + rng() * 3 });
      decor.shrooms.push({ x, y, caps, phase: rng() * TAU });
    }
    for (let i = 0; i < 8; i++) {
      const a = rng() * TAU;
      if (Math.abs(angleDiff(a, DOCK_ANGLE)) < 0.15) continue;
      const r = grassRadius(a) + 40 + rng() * 40;
      decor.logs.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, len: 30 + rng() * 40, rot: a + Math.PI / 2 + (rng() - 0.5) * 0.8 });
    }
    for (let i = 0; i < 70; i++) {
      const a = rng() * TAU, r = 120 + rng() * 820;
      decor.flowers.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, c: rng() < 0.5 ? '#c9b8e8' : '#e8dcb0' });
    }
    // dirt path from the lighthouse door to the dock
    const da = DOCK_ANGLE;
    const end = coastRadius(da) - 10;
    const path = new Path2D();
    path.moveTo(Math.cos(da) * 60, Math.sin(da) * 60);
    const mx = Math.cos(da + 0.25) * end * 0.5, my = Math.sin(da + 0.25) * end * 0.5;
    path.quadraticCurveTo(mx, my, Math.cos(da) * end, Math.sin(da) * end);
    decor.path = path;
    bakeIsland();
  }

  function glowSprite(color) {
    let s = sprites.get(color);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = 64;
    const c = s.getContext('2d');
    const rgb = hexToRgb(color);
    const base = rgb[0] + ',' + rgb[1] + ',' + rgb[2];
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(' + base + ',1)');
    g.addColorStop(0.22, 'rgba(' + base + ',0.6)');
    g.addColorStop(0.55, 'rgba(' + base + ',0.16)');
    g.addColorStop(1, 'rgba(' + base + ',0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    sprites.set(color, s);
    return s;
  }

  function resize() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width || window.innerWidth));
    const cssH = Math.max(1, Math.round(rect.height || window.innerHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = cssW;
    view.h = cssH;
    view.dpr = dpr;
    view.zoom = clamp(Math.min(cssW, cssH) / 760, 0.55, 1.6);
    view.scale = view.zoom * dpr;
    const bw = Math.max(1, Math.round(cssW * dpr)), bh = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    // the darkness is all soft gradients: render it at reduced resolution and scale it up
    const dw = Math.max(1, Math.round(cssW * DARK_RES)), dh = Math.max(1, Math.round(cssH * DARK_RES));
    if (dark.width !== dw || dark.height !== dh) {
      dark.width = dw;
      dark.height = dh;
    }
  }

  function lanternPos() {
    const p = state.player;
    const f = p.face;
    return { x: p.x + Math.cos(f) * 6 - Math.sin(f) * 6, y: p.y + Math.sin(f) * 6 + Math.cos(f) * 6 };
  }

  function lanternRadius() {
    let lr = state.stats.lightR;
    const t = renderTime;
    const flick = reducedMotion ? 0.004 : 0.022;
    lr *= 1 + flick * Math.sin(t * 13.1) + flick * 0.8 * Math.sin(t * 7.3 + 1) + (reducedMotion ? 0 : (Math.random() - 0.5) * 0.012);
    if (state.phase === 'dying') lr *= Math.max(0, 1 - state.phaseT / 1.2);
    if (state.screen === 'gameover') lr = 0;
    return lr;
  }

  function darknessAlpha() {
    let a = lerp(NIGHTS.darkAlpha, NIGHTS.dawnAlpha, state.light);
    if (state.phase === 'dying' || state.screen === 'gameover') {
      const k = state.screen === 'gameover' ? 1 : Math.min(1, state.phaseT / 1.2);
      a = lerp(a, 0.9, k);
    }
    return a;
  }

  function render(rdt) {
    renderTime += rdt;
    const p = state.player;
    state.light += (state.lightTarget - state.light) * (1 - Math.exp(-rdt * 2.4));

    // camera
    let tx, ty;
    if (state.screen === 'title' || state.screen === 'howto') {
      tx = Math.sin(renderTime * 0.05) * 110;
      ty = 50 + Math.cos(renderTime * 0.037) * 60;
    } else {
      tx = p.x + p.vx * 0.12;
      ty = p.y + p.vy * 0.12;
    }
    const k = 1 - Math.exp(-rdt * 6);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;

    const W = canvas.width, H = canvas.height, S = view.scale;
    let sx = 0, sy = 0;
    if (state.shake > 0 && !reducedMotion) {
      const m = state.shake * state.shake * 16 * view.dpr;
      sx = rand(-m, m);
      sy = rand(-m, m);
    }
    const ox = W / 2 - cam.x * S + sx, oy = H / 2 - cam.y * S + sy;
    const vb = { x0: -ox / S, y0: -oy / S, x1: (W - ox) / S, y1: (H - oy) / S };
    const visible = (x, y, r) => x + r > vb.x0 && x - r < vb.x1 && y + r > vb.y0 && y - r < vb.y1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.setTransform(S, 0, 0, S, ox, oy);

    // ---- world pass ----
    drawSea(vb);
    drawIsland(vb, visible);
    drawEmbers(visible, false);
    drawSlamsGround();
    if (state.boss) drawBoss(state.boss, false);
    for (const e of state.enemies) if (visible(e.x, e.y, e.r * 3)) drawEnemy(e, false);
    drawShots(visible, false);
    drawAnchors(false);
    drawPlayer();
    drawLighthouse();
    // warm cast of the lantern
    if (state.screen !== 'gameover') {
      const lp = lanternPos();
      const lr = lanternRadius() * 0.8;
      if (lr > 4) {
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, lr);
        g.addColorStop(0, 'rgba(255,170,80,0.13)');
        g.addColorStop(1, 'rgba(255,170,80,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(lp.x, lp.y, lr, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // ---- darkness ----
    drawDarkness(ox, oy, S, visible);

    // ---- glow pass (always readable in the dark) ----
    ctx.setTransform(S, 0, 0, S, ox, oy);
    drawBeamHaze();
    drawShoreGlow(vb);
    drawShrooms(visible);
    drawAura();
    drawSlamsGlow();
    drawEmbers(visible, true);
    ctx.globalCompositeOperation = 'lighter';
    if (state.boss) drawBossGlow(state.boss);
    for (const e of state.enemies) if (visible(e.x, e.y, e.r * 3)) drawEnemy(e, true);
    ctx.globalCompositeOperation = 'source-over';
    drawInks(visible);
    drawShots(visible, true);
    drawAnchors(true);
    drawPlayerGlow();
    drawLampGlow();
    drawParticles(visible);

    // ---- screen space ----
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    drawTexts(ox, oy, S);
    drawBossIndicator(ox, oy, S);
    drawScreenFx();
    drawJoystick();
  }

  function drawSea(vb) {
    const w = vb.x1 - vb.x0, h = vb.y1 - vb.y0;
    let g = darkGrad.shallows;
    if (!g) {
      // one fill: shallows near the island fading into the abyss (the last stop extends outward)
      g = ctx.createRadialGradient(0, 0, WORLD.islandR - 40, 0, 0, WORLD.islandR + 560);
      g.addColorStop(0, '#174660');
      g.addColorStop(0.2, COLORS.tide);
      g.addColorStop(1, COLORS.abyss);
      darkGrad.shallows = g;
    }
    ctx.fillStyle = g;
    ctx.fillRect(vb.x0, vb.y0, w, h);
    // drifting wave glints
    const cell = 140;
    const cx0 = Math.floor(vb.x0 / cell) - 1, cx1 = Math.floor(vb.x1 / cell) + 1;
    const cy0 = Math.floor(vb.y0 / cell) - 1, cy1 = Math.floor(vb.y1 / cell) + 1;
    const t = renderTime;
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.2;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const h1 = hash2(cx, cy), h2 = hash2(cx + 91, cy - 37);
        const drift = (t * (6 + h1 * 6)) % cell;
        const wx = (cx + h1) * cell + drift, wy = (cy + h2) * cell;
        const dd = Math.hypot(wx, wy);
        if (dd < WORLD.islandR + 70) continue;
        const ph = t * 0.9 + h1 * 12;
        const a = 0.1 + 0.14 * (0.5 + 0.5 * Math.sin(ph));
        const len = 22 + h2 * 34;
        ctx.strokeStyle = 'rgba(157,190,210,' + a.toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(wx - len / 2, wy);
        ctx.quadraticCurveTo(wx, wy - 5 - 3 * Math.sin(ph), wx + len / 2, wy);
        ctx.stroke();
      }
    }
  }

  function drawIsland(vb, visible) {
    const t = renderTime;
    if (islandBake) {
      const h = islandBake.half;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(islandBake.canvas, -h, -h, h * 2, h * 2);
    } else {
      drawGround(ctx);
    }
    // surf breaking on the beach
    ctx.save();
    const s1 = 1.008 + 0.008 * Math.sin(t * 0.9);
    ctx.scale(s1, s1);
    ctx.strokeStyle = 'rgba(170,205,220,' + (0.08 + 0.05 * Math.sin(t * 0.9 + 1)).toFixed(3) + ')';
    ctx.lineWidth = 9;
    ctx.stroke(coastPath);
    ctx.restore();
    drawDock(visible);

    // logs
    for (const l of decor.logs) {
      if (!visible(l.x, l.y, l.len)) continue;
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.rot);
      ctx.fillStyle = '#4a3b2a';
      roundRect(ctx, -l.len / 2, -5, l.len, 10, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-l.len / 2 + 6, 0);
      ctx.lineTo(l.len / 2 - 6, 0);
      ctx.stroke();
      ctx.restore();
    }
    // shells
    for (const s of decor.shells) {
      if (!visible(s.x, s.y, 6)) continue;
      ctx.fillStyle = s.kind ? '#cdbfa2' : '#b8a3a8';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.size, s.size * 0.7, s.rot, 0, TAU);
      ctx.fill();
    }
    // flowers
    for (const f of decor.flowers) {
      if (!visible(f.x, f.y, 3)) continue;
      ctx.fillStyle = f.c;
      ctx.fillRect(f.x - 1.2, f.y - 1.2, 2.4, 2.4);
    }
    // grass tufts
    ctx.lineWidth = 1.6;
    for (const tf of decor.tufts) {
      if (!visible(tf.x, tf.y, tf.size)) continue;
      ctx.strokeStyle = tf.shade < 0.5 ? '#2a4631' : '#35563b';
      const sway = Math.sin(t * 1.3 + tf.rot) * 1.5;
      ctx.beginPath();
      for (let b = -2; b <= 2; b++) {
        ctx.moveTo(tf.x + b * 1.8, tf.y);
        ctx.lineTo(tf.x + b * 3 + sway, tf.y - tf.size);
      }
      ctx.stroke();
    }
    // rocks
    for (const r of decor.rocks) {
      if (!visible(r.x, r.y, r.size + 4)) continue;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.rot);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      polyPath(ctx, r.pts, r.size, 3, 4);
      ctx.fill();
      const base = r.wet ? 30 : 42 + r.shade * 14;
      ctx.fillStyle = 'rgb(' + base + ',' + (base + 6) + ',' + (base + 10) + ')';
      polyPath(ctx, r.pts, r.size, 0, 0);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      polyPath(ctx, r.pts, r.size * 0.55, -r.size * 0.2, -r.size * 0.2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawDock(visible) {
    const a = DOCK_ANGLE;
    const r0 = coastRadius(a) - 60, r1 = r0 + 250;
    const mx = Math.cos(a) * (r0 + r1) / 2, my = Math.sin(a) * (r0 + r1) / 2;
    if (!visible(mx, my, 200)) return;
    ctx.save();
    ctx.rotate(a);
    // posts
    ctx.fillStyle = '#2a2018';
    for (let r = r0 + 20; r <= r1; r += 60) {
      ctx.beginPath(); ctx.arc(r, -26, 5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(r, 26, 5, 0, TAU); ctx.fill();
    }
    // planks
    for (let r = r0; r < r1; r += 12) {
      ctx.fillStyle = ((r / 12) | 0) % 2 ? '#5b4630' : '#523f2b';
      ctx.fillRect(r, -24, 10.5, 48);
    }
    // little rowboat
    ctx.translate(r1 - 70, 52);
    ctx.rotate(0.15);
    ctx.fillStyle = '#3d2b1d';
    ctx.beginPath();
    ctx.ellipse(0, 0, 38, 15, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#6a4b31';
    ctx.beginPath();
    ctx.ellipse(0, 0, 33, 11, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#4a3423';
    ctx.fillRect(-4, -11, 8, 22);
    ctx.restore();
  }

  function polyPath(c, pts, size, ox, oy) {
    c.beginPath();
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const x = Math.cos(a) * size * pts[i] + ox, y = Math.sin(a) * size * pts[i] + oy;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  function drawLighthouse() {
    const R = WORLD.lighthouseR;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(10, 12, R + 12, R + 8, 0, 0, TAU);
    ctx.fill();
    // stone plinth
    ctx.fillStyle = '#4b4b46';
    ctx.beginPath();
    ctx.arc(0, 0, R + 8, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#2b2b28';
    ctx.lineWidth = 2;
    ctx.stroke();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
      ctx.lineTo(Math.cos(a) * (R + 8), Math.sin(a) * (R + 8));
      ctx.stroke();
    }
    // striped tower seen from above (bands narrowing toward the top)
    const bands = [[R, '#b13a34'], [R * 0.84, '#ece0c4'], [R * 0.69, '#b13a34'], [R * 0.56, '#ece0c4']];
    for (const b of bands) {
      ctx.fillStyle = b[1];
      ctx.beginPath();
      ctx.arc(0, 0, b[0], 0, TAU);
      ctx.fill();
    }
    // shading for roundness
    const sg = ctx.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R);
    sg.addColorStop(0, 'rgba(255,255,255,0.12)');
    sg.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();
    // gallery with railing
    ctx.fillStyle = '#1b2125';
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.46, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#5c666c';
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * R * 0.43, Math.sin(a) * R * 0.43, 1.6, 0, TAU);
      ctx.fill();
    }
    // lantern room
    ctx.fillStyle = '#ffe2a0';
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.31, 0, TAU);
    ctx.fill();
    // rotating lens hint
    const ba = state.wpn.beamAngle;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ba) * R * 0.28, Math.sin(ba) * R * 0.28);
    ctx.lineTo(-Math.cos(ba) * R * 0.28, -Math.sin(ba) * R * 0.28);
    ctx.stroke();
    // dome cap
    ctx.fillStyle = '#2c3236';
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.15, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#7a8388';
    ctx.beginPath();
    ctx.arc(-1.5, -1.5, R * 0.05, 0, TAU);
    ctx.fill();
    // door facing the path
    ctx.rotate(DOCK_ANGLE);
    ctx.fillStyle = '#3a2a1c';
    ctx.fillRect(R - 2, -7, 10, 14);
    ctx.restore();
  }

  function drawPlayer() {
    const p = state.player;
    ctx.save();
    ctx.translate(p.x, p.y);
    let alpha = 1;
    if (state.phase === 'dying' || state.screen === 'gameover') alpha = state.screen === 'gameover' ? 0.5 : Math.max(0.5, 1 - state.phaseT);
    else if (p.invuln > 0 && Math.floor(renderTime * 18) % 2 === 0) alpha = 0.55;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(3, 6, 16, 12, 0, 0, TAU);
    ctx.fill();
    ctx.rotate(p.face);
    const stride = p.moving ? Math.sin(p.step * 0.09) * 5 : 0;
    // boots
    ctx.fillStyle = '#1a232c';
    ctx.beginPath(); ctx.ellipse(stride, -6, 5.5, 3.6, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-stride, 6, 5.5, 3.6, 0, 0, TAU); ctx.fill();
    // oilskin coat
    ctx.fillStyle = '#2e5068';
    ctx.beginPath();
    ctx.ellipse(-1, 0, 12, 14, 0, 0, TAU);
    ctx.fill();
    // arms
    ctx.fillStyle = '#284660';
    ctx.beginPath(); ctx.ellipse(4, -12, 6, 4, 0.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(7, 11, 6, 4, -0.5, 0, TAU); ctx.fill();
    // lantern in hand
    ctx.fillStyle = '#2a2016';
    ctx.fillRect(9, 9, 8, 8);
    ctx.fillStyle = '#ffd27a';
    ctx.fillRect(10.5, 10.5, 5, 5);
    // sou'wester hat
    ctx.fillStyle = '#c98a1c';
    ctx.beginPath();
    ctx.ellipse(-2.5, 0, 12.5, 11.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f2b636';
    ctx.beginPath();
    ctx.arc(1, 0, 8, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,70,10,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(1, 0, 4.5, -1.2, 1.2);
    ctx.stroke();
    if (p.hurtT > 0) {
      ctx.globalAlpha = Math.min(1, p.hurtT * 4) * 0.6;
      ctx.fillStyle = COLORS.danger;
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPlayerGlow() {
    if (state.screen === 'gameover') return;
    const p = state.player;
    const f = p.face;
    const lx = p.x + Math.cos(f) * 13 - Math.sin(f) * 13, ly = p.y + Math.sin(f) * 13 + Math.cos(f) * 13;
    let a = 0.85 + (reducedMotion ? 0 : 0.15 * Math.sin(renderTime * 17));
    if (state.phase === 'dying') a *= Math.max(0, 1 - state.phaseT / 1.2);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.drawImage(glowSprite(COLORS.lantern), lx - 16, ly - 16, 32, 32);
    ctx.globalAlpha = a * 0.25;
    ctx.drawImage(glowSprite(COLORS.lantern), p.x - 34, p.y - 34, 68, 68);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawLampGlow() {
    const flare = reducedMotion ? 0 : 0.08 * Math.sin(renderTime * 3);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.65 + flare;
    ctx.drawImage(glowSprite(COLORS.lantern), -70, -70, 140, 140);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(glowSprite('#fff2d0'), -22, -22, 44, 44);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  const BEAM_LAYERS = [{ k: 1.9, a: 0.16 }, { k: 1.3, a: 0.28 }, { k: 0.75, a: 0.5 }];

  function beamGradient(c, alpha) {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, WORLD.beamLength);
    g.addColorStop(0, 'rgba(0,0,0,' + alpha + ')');
    g.addColorStop(0.55, 'rgba(0,0,0,' + alpha * 0.85 + ')');
    g.addColorStop(0.85, 'rgba(0,0,0,' + alpha * 0.45 + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    return g;
  }

  function drawDarkness(ox, oy, S, visible) {
    const d = dctx;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'source-over';
    d.globalAlpha = 1;
    d.clearRect(0, 0, dark.width, dark.height);
    const alpha = darknessAlpha();
    if (alpha <= 0.01) return;
    const dc = COLORS.darkness;
    d.fillStyle = 'rgba(' + dc[0] + ',' + dc[1] + ',' + dc[2] + ',' + alpha.toFixed(3) + ')';
    d.fillRect(0, 0, dark.width, dark.height);
    d.globalCompositeOperation = 'destination-out';
    const kx = dark.width / canvas.width, ky = dark.height / canvas.height;
    d.setTransform(S * kx, 0, 0, S * ky, ox * kx, oy * ky);

    // the keeper's lantern
    const lr = lanternRadius();
    if (lr > 2) {
      const lp = lanternPos();
      if (!darkGrad.lantern) {
        const g = d.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(0.45, 'rgba(0,0,0,0.93)');
        g.addColorStop(0.75, 'rgba(0,0,0,0.5)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        darkGrad.lantern = g;
      }
      d.save();
      d.translate(lp.x, lp.y);
      d.scale(lr, lr);
      d.fillStyle = darkGrad.lantern;
      d.beginPath();
      d.arc(0, 0, 1, 0, TAU);
      d.fill();
      d.restore();
    }
    // lighthouse lamp
    if (!darkGrad.lamp) {
      const g = d.createRadialGradient(0, 0, 0, 0, 0, 180);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.3, 'rgba(0,0,0,0.75)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      darkGrad.lamp = g;
    }
    d.fillStyle = darkGrad.lamp;
    d.beginPath();
    d.arc(0, 0, 180, 0, TAU);
    d.fill();
    // rotating beam: two opposite cones with soft layered edges
    if (!darkGrad.beam) darkGrad.beam = BEAM_LAYERS.map(l => beamGradient(d, l.a));
    const bs = beamStats(lv('beam'));
    const len = WORLD.beamLength;
    for (let c = 0; c < 2; c++) {
      const a = state.wpn.beamAngle + c * Math.PI;
      for (let i = 0; i < BEAM_LAYERS.length; i++) {
        const h = bs.half * BEAM_LAYERS[i].k;
        d.fillStyle = darkGrad.beam[i];
        d.beginPath();
        d.moveTo(0, 0);
        d.arc(0, 0, len, a - h, a + h);
        d.closePath();
        d.fill();
      }
    }
    // small lights: embers, projectiles
    let n = 0;
    const max = LIMITS.smallLights;
    d.globalAlpha = 0.55;
    for (const m of state.embers) {
      if (n >= max) break;
      if (!visible(m.x, m.y, 30)) continue;
      const r = 20 + Math.min(m.value, 10) * 2;
      d.drawImage(lightSprite, m.x - r, m.y - r, r * 2, r * 2);
      n++;
    }
    d.globalAlpha = 0.7;
    for (const s of state.shots) {
      if (n >= max) break;
      if (!visible(s.x, s.y, 40)) continue;
      const r = s.kind === 'harpoon' ? 48 : 28;
      d.drawImage(lightSprite, s.x - r, s.y - r, r * 2, r * 2);
      n++;
    }
    d.globalAlpha = 0.35;
    for (const s of state.inks) {
      if (n >= max) break;
      if (!visible(s.x, s.y, 30)) continue;
      d.drawImage(lightSprite, s.x - 22, s.y - 22, 44, 44);
      n++;
    }
    if (lv('anchors')) {
      d.globalAlpha = 0.4;
      for (const an of anchorPositions(anchorTmp)) d.drawImage(lightSprite, an.x - 30, an.y - 30, 60, 60);
    }
    d.globalAlpha = 1;
    d.globalCompositeOperation = 'source-over';

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(dark, 0, 0, canvas.width, canvas.height);
  }

  function drawBeamHaze() {
    const bs = beamStats(lv('beam'));
    const len = WORLD.beamLength;
    const strength = lv('beam') ? 0.075 : 0.05;
    if (!darkGrad.haze || darkGrad.hazeStrength !== strength) {
      const g = ctx.createRadialGradient(0, 0, 30, 0, 0, len);
      const warm = lv('beam') ? '255,190,110' : '255,226,170';
      g.addColorStop(0, 'rgba(' + warm + ',' + strength * 2 + ')');
      g.addColorStop(0.4, 'rgba(' + warm + ',' + strength + ')');
      g.addColorStop(1, 'rgba(' + warm + ',0)');
      darkGrad.haze = g;
      darkGrad.hazeStrength = strength;
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = darkGrad.haze;
    for (let c = 0; c < 2; c++) {
      const a = state.wpn.beamAngle + c * Math.PI;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, len, a - bs.half, a + bs.half);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawShoreGlow(vb) {
    // bioluminescent plankton where the surf breaks — marks the island edge at night
    const t = renderTime;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(95,224,207,' + (0.16 + 0.06 * Math.sin(t * 1.3)).toFixed(3) + ')';
    ctx.lineWidth = 3;
    ctx.setLineDash([18, 26]);
    ctx.lineDashOffset = -t * 14;
    ctx.stroke(coastPath);
    ctx.strokeStyle = 'rgba(95,224,207,0.07)';
    ctx.lineWidth = 10;
    ctx.setLineDash([]);
    const s = 1.012 + 0.006 * Math.sin(t * 0.9);
    ctx.scale(s, s);
    ctx.stroke(coastPath);
    ctx.restore();
  }

  function drawShrooms(visible) {
    ctx.globalCompositeOperation = 'lighter';
    for (const m of decor.shrooms) {
      if (!visible(m.x, m.y, 30)) continue;
      const pulse = 0.5 + 0.2 * Math.sin(renderTime * 1.1 + m.phase);
      ctx.globalAlpha = pulse * 0.18;
      ctx.drawImage(glowSprite('#7fd8c8'), m.x - 20, m.y - 20, 40, 40);
      ctx.globalAlpha = pulse * 0.32;
      ctx.fillStyle = '#9fe6da';
      for (const c of m.caps) {
        ctx.beginPath();
        ctx.arc(m.x + c.dx, m.y + c.dy, c.r, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawAura() {
    const L = lv('aura');
    if (!L || state.screen === 'gameover' || state.phase === 'dying') return;
    const p = state.player;
    const st = auraStats(L);
    const pulse = state.wpn.auraPulse;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(p.x, p.y, st.r * 0.3, p.x, p.y, st.r);
    g.addColorStop(0, 'rgba(255,120,50,0)');
    g.addColorStop(0.85, 'rgba(255,120,50,' + (0.05 + 0.1 * pulse).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,120,50,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, st.r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,150,70,' + (0.22 + 0.4 * pulse).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -renderTime * 30;
    ctx.beginPath();
    ctx.arc(p.x, p.y, st.r * (1 + 0.04 * pulse), 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function drawEmbers(visible, glow) {
    const t = renderTime;
    if (glow) ctx.globalCompositeOperation = 'lighter';
    for (const m of state.embers) {
      if (!visible(m.x, m.y, 20)) continue;
      const big = m.value >= 4;
      const s = big ? 6.5 : m.value >= 2 ? 5 : 4;
      const tw = 0.75 + 0.25 * Math.sin(t * 8 + m.seed);
      if (glow) {
        ctx.globalAlpha = 0.75 * tw;
        const gs = s * 4.5;
        ctx.drawImage(glowSprite(big ? COLORS.gold : COLORS.ember), m.x - gs, m.y - gs, gs * 2, gs * 2);
      } else {
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(t * 2 + m.seed);
        ctx.fillStyle = big ? '#ffe08a' : '#ffb15c';
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.7, 0);
        ctx.lineTo(0, s);
        ctx.lineTo(-s * 0.7, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    if (glow) ctx.globalCompositeOperation = 'source-over';
  }

  function drawSlamsGround() {
    for (const s of state.slams) {
      if (!s.hit) continue;
      const k = Math.min(1, s.after / 0.45);
      ctx.fillStyle = 'rgba(20,40,50,' + (0.5 * (1 - k)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * 0.9, 0, TAU);
      ctx.fill();
    }
  }

  function drawSlamsGlow() {
    for (const s of state.slams) {
      if (s.hit) continue;
      const k = Math.min(1, s.t / s.warn);
      const blink = reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(renderTime * 30);
      ctx.fillStyle = 'rgba(255,84,104,' + (0.08 + 0.16 * k).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,84,104,' + (0.55 * blink + 0.3 * k).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,200,205,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * k, 0, TAU);
      ctx.stroke();
    }
  }

  function drawInks(visible) {
    for (const s of state.inks) {
      if (!visible(s.x, s.y, 30)) continue;
      const wob = 1 + 0.12 * Math.sin(s.t * 14);
      const col = s.boss ? '#9ad8ff' : COLORS.ink;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.8;
      const gs = s.r * 3.6;
      ctx.drawImage(glowSprite(col), s.x - gs, s.y - gs, gs * 2, gs * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = s.boss ? '#0d2233' : '#1b0f30';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * wob, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawShots(visible, glow) {
    for (const s of state.shots) {
      if (!visible(s.x, s.y, 60)) continue;
      if (s.kind === 'spark') {
        if (!glow) continue;
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(255,181,71,0.55)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(s.x - s.vx * 0.045, s.y - s.vy * 0.045);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        ctx.drawImage(glowSprite(COLORS.lantern), s.x - 11, s.y - 11, 22, 22);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#fff6dc';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2.6, 0, TAU);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.a);
        if (glow) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.6;
          ctx.drawImage(glowSprite('#bfe8ff'), -14, -14, 28, 28);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = 'rgba(200,235,255,0.5)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(-46, 0);
          ctx.lineTo(8, 0);
          ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
        } else {
          // rope
          ctx.strokeStyle = 'rgba(200,180,140,0.5)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(-44, 0);
          ctx.quadraticCurveTo(-60, 6 * Math.sin(renderTime * 20), -76, 0);
          ctx.stroke();
          // shaft
          ctx.strokeStyle = '#7a5532';
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-44, 0);
          ctx.lineTo(0, 0);
          ctx.stroke();
          // head with barbs
          ctx.fillStyle = '#d8dfe3';
          ctx.beginPath();
          ctx.moveTo(14, 0);
          ctx.lineTo(-2, -6);
          ctx.lineTo(1, 0);
          ctx.lineTo(-2, 6);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  function anchorPath(c, s) {
    c.beginPath();
    c.moveTo(s * 0.2, -s * 0.78);
    c.arc(0, -s * 0.78, s * 0.2, 0, TAU);
    c.moveTo(0, -s * 0.58);
    c.lineTo(0, s * 0.86);
    c.moveTo(-s * 0.45, -s * 0.36);
    c.lineTo(s * 0.45, -s * 0.36);
    c.moveTo(-s * 0.78, s * 0.18);
    c.quadraticCurveTo(-s * 0.62, s * 0.86, 0, s * 0.9);
    c.quadraticCurveTo(s * 0.62, s * 0.86, s * 0.78, s * 0.18);
    c.moveTo(-s * 0.78, s * 0.18);
    c.lineTo(-s * 0.92, s * 0.44);
    c.moveTo(-s * 0.78, s * 0.18);
    c.lineTo(-s * 0.56, s * 0.34);
    c.moveTo(s * 0.78, s * 0.18);
    c.lineTo(s * 0.92, s * 0.44);
    c.moveTo(s * 0.78, s * 0.18);
    c.lineTo(s * 0.56, s * 0.34);
  }

  function drawAnchors(glow) {
    if (!lv('anchors') || state.screen === 'gameover') return;
    const p = state.player;
    const W = WEAPONS.anchors;
    for (const an of anchorPositions(anchorTmp)) {
      if (glow) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.5;
        ctx.drawImage(glowSprite('#cfe6ff'), an.x - 20, an.y - 20, 40, 40);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        continue;
      }
      // chain
      ctx.strokeStyle = 'rgba(160,170,180,0.35)';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(an.x, an.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.save();
      ctx.translate(an.x, an.y);
      ctx.rotate(an.a - Math.PI / 2);
      ctx.strokeStyle = '#2a3036';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      anchorPath(ctx, W.r);
      ctx.stroke();
      ctx.strokeStyle = '#b9c4cb';
      ctx.lineWidth = 2.8;
      anchorPath(ctx, W.r);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawParticles(visible) {
    ctx.globalCompositeOperation = 'lighter';
    for (const q of state.particles) {
      if (!visible(q.x, q.y, (q.r1 || q.size * 3) + 10)) continue;
      const k = q.life / q.max;
      if (q.kind === 'ring') {
        const r = lerp(q.r1, q.r0, k);
        ctx.globalAlpha = k * 0.8;
        ctx.strokeStyle = q.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, TAU);
        ctx.stroke();
      } else {
        ctx.globalAlpha = Math.min(1, k * 1.4);
        const s = q.size * (q.kind === 'bubble' ? 3.2 : 2.6) * (0.6 + 0.4 * k);
        ctx.drawImage(glowSprite(q.color), q.x - s, q.y - s, s * 2, s * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawTexts(ox, oy, S) {
    if (!state.texts.length) return;
    const dpr = view.dpr;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const t of state.texts) {
      const x = (t.x * S + ox) / dpr, y = (t.y * S + oy) / dpr;
      if (x < -40 || y < -40 || x > view.w + 40 || y > view.h + 40) continue;
      const k = t.life / t.max;
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.font = '700 ' + t.size + 'px ' + canvasFont;
      ctx.strokeStyle = 'rgba(4,10,18,0.85)';
      ctx.lineWidth = 3;
      ctx.strokeText(t.text, x, y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  function drawBossIndicator(ox, oy, S) {
    const b = state.boss;
    if (!b || b.dead || state.screen !== 'playing') return;
    const dpr = view.dpr;
    const x = (b.x * S + ox) / dpr, y = (b.y * S + oy) / dpr;
    const m = b.r * view.zoom;
    if (x > -m && x < view.w + m && y > -m && y < view.h + m) return;
    const cx = view.w / 2, cy = view.h / 2;
    const a = Math.atan2(y - cy, x - cx);
    const pad = 34;
    const ex = clamp(cx + Math.cos(a) * view.w, pad, view.w - pad);
    const ey = clamp(cy + Math.sin(a) * view.h, pad + 70, view.h - pad);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(a);
    const pulse = reducedMotion ? 1 : 0.8 + 0.2 * Math.sin(renderTime * 6);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = COLORS.danger;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, -10);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawScreenFx() {
    const w = view.w, h = view.h;
    // lighthouse flare washing over the keeper
    if (state.flare > 0.01 && !reducedMotion) {
      ctx.fillStyle = 'rgba(255,226,170,' + (0.07 * state.flare).toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
    }
    // sunrise / dawn warmth
    if (state.light > 0.02) {
      const g = ctx.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, 'rgba(255,140,90,' + (0.22 * state.light).toFixed(3) + ')');
      g.addColorStop(0.6, 'rgba(255,190,140,' + (0.06 * state.light).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,200,160,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // low health vignette
    const p = state.player;
    if (state.screen === 'playing' && state.phase === 'night' && p.hp / p.maxHp < 0.3) {
      const pulse = reducedMotion ? 0.7 : 0.55 + 0.45 * Math.sin(renderTime * 5);
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(255,40,60,0)');
      g.addColorStop(1, 'rgba(255,40,60,' + (0.3 * pulse).toFixed(3) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function drawJoystick() {
    const j = Input.joy;
    if (!j.active || state.screen !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const bx = j.bx - rect.left, by = j.by - rect.top;
    let dx = j.kx - j.bx, dy = j.ky - j.by;
    const d = Math.hypot(dx, dy);
    if (d > JOY.max) { dx *= JOY.max / d; dy *= JOY.max / d; }
    ctx.fillStyle = 'rgba(4,10,18,0.35)';
    ctx.strokeStyle = 'rgba(241,228,198,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, by, JOY.max, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(241,228,198,0.18)';
    ctx.beginPath();
    ctx.arc(bx, by, JOY.dead, 0, TAU);
    ctx.stroke();
    const g = ctx.createRadialGradient(bx + dx, by + dy, 2, bx + dx, by + dy, JOY.knob);
    g.addColorStop(0, 'rgba(255,214,140,0.95)');
    g.addColorStop(1, 'rgba(255,160,60,0.7)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx + dx, by + dy, JOY.knob, 0, TAU);
    ctx.fill();
  }

  // ---- Creatures (procedural; body pass + glow pass) ----

  const glowWidth = () => Math.max(1.5, 1.3 / view.zoom);

  function eyes(c, x, y, r, col, glow) {
    if (glow) {
      c.fillStyle = col;
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.arc(x, -y, r, 0, TAU); c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath(); c.arc(x, y, r * 0.45, 0, TAU); c.arc(x, -y, r * 0.45, 0, TAU); c.fill();
    } else {
      c.fillStyle = '#0b0f14';
      c.beginPath(); c.arc(x, y, r * 1.1, 0, TAU); c.arc(x, -y, r * 1.1, 0, TAU); c.fill();
    }
  }

  function drawCrab(c, r, t, def, glow, col, king) {
    const lw = glowWidth();
    const ph = t * (king ? 9 : 15);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    // legs
    c.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 3; i++) {
        const bx = r * (0.35 - i * 0.38), by = side * r * 0.8;
        const sw = Math.sin(ph + i * 1.9 + (side > 0 ? 0 : Math.PI)) * r * 0.16;
        c.moveTo(bx, by);
        c.lineTo(bx - r * 0.15 + sw, by + side * r * 0.5);
        c.lineTo(bx - r * 0.42 + sw, by + side * r * 0.72);
      }
      // claw arm
      c.moveTo(r * 0.5, side * r * 0.55);
      c.lineTo(r * 0.98, side * r * 0.8);
    }
    if (glow) { c.strokeStyle = col; c.lineWidth = lw; c.globalAlpha *= 0.45; c.stroke(); c.globalAlpha /= 0.45; }
    else { c.strokeStyle = def.shell; c.lineWidth = r * 0.17; c.stroke(); }
    // pincers: a palm with two opening fingers
    const open = r * (0.1 + 0.08 * (1 + Math.sin(ph * 0.45)));
    for (let side = -1; side <= 1; side += 2) {
      c.save();
      c.translate(r * 1.08, side * r * 0.82);
      c.rotate(side * 0.3);
      c.beginPath();
      c.ellipse(0, 0, r * 0.34, r * 0.26, 0, 0, TAU);
      c.moveTo(r * 0.12, -r * 0.2);
      c.quadraticCurveTo(r * 0.55, -r * 0.26 - open, r * 0.72, -open * 0.4);
      c.quadraticCurveTo(r * 0.45, -r * 0.08, r * 0.2, -r * 0.04);
      c.closePath();
      c.moveTo(r * 0.12, r * 0.2);
      c.quadraticCurveTo(r * 0.5, r * 0.22 + open, r * 0.64, open * 0.5);
      c.quadraticCurveTo(r * 0.42, r * 0.08, r * 0.2, r * 0.04);
      c.closePath();
      if (glow) { c.strokeStyle = col; c.lineWidth = lw; c.stroke(); }
      else { c.fillStyle = def.body; c.fill(); }
      c.restore();
    }
    // shell
    c.beginPath();
    c.ellipse(0, 0, r * 0.86, r * 1.06, 0, 0, TAU);
    if (glow) { c.strokeStyle = col; c.lineWidth = lw * (king ? 1.6 : 1); c.stroke(); }
    else {
      c.fillStyle = def.body;
      c.fill();
      c.fillStyle = def.shell;
      c.beginPath();
      c.ellipse(-r * 0.15, 0, r * 0.55, r * 0.78, 0, 0, TAU);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.08)';
      c.beginPath();
      c.ellipse(r * 0.2, -r * 0.3, r * 0.3, r * 0.22, 0.4, 0, TAU);
      c.fill();
    }
    if (king) {
      // a crown seen from above: a star-shaped gold ring with a gem
      c.beginPath();
      const n = 6;
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * TAU;
        const rr = i % 2 ? r * 0.22 : r * 0.4;
        const x = -r * 0.12 + Math.cos(a) * rr, y = Math.sin(a) * rr;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.closePath();
      if (glow) { c.strokeStyle = COLORS.gold; c.lineWidth = lw; c.stroke(); }
      else {
        c.fillStyle = '#e8b53c';
        c.fill();
        c.strokeStyle = '#7a5a12';
        c.lineWidth = 2;
        c.stroke();
        c.fillStyle = '#6c2416';
        c.beginPath();
        c.arc(-r * 0.12, 0, r * 0.14, 0, TAU);
        c.fill();
      }
      c.fillStyle = glow ? '#ff7a8a' : '#d8344a';
      c.beginPath();
      c.arc(-r * 0.12, 0, r * 0.08, 0, TAU);
      c.fill();
    }
    eyes(c, r * 0.78, r * 0.3, r * (king ? 0.1 : 0.13), col, glow);
  }

  function drawJelly(c, r, t, def, glow, col, seed) {
    const lw = glowWidth();
    const pulse = Math.sin(t * 4.4 + seed);
    const sx = 1 - 0.1 * pulse, sy = 1 + 0.06 * pulse;
    // tentacles trailing behind
    c.beginPath();
    for (let k = 0; k < 5; k++) {
      const y0 = (k - 2) * r * 0.32;
      c.moveTo(-r * 0.6, y0);
      for (let i = 1; i <= 6; i++) {
        const x = -r * 0.6 - i * r * 0.36;
        c.lineTo(x, y0 * (1 - i * 0.06) + Math.sin(t * 5 + k * 1.3 + i * 0.8) * r * 0.2);
      }
    }
    c.lineCap = 'round';
    if (glow) { c.strokeStyle = col; c.lineWidth = lw; c.globalAlpha *= 0.4; c.stroke(); c.globalAlpha /= 0.4; }
    else { c.strokeStyle = 'rgba(150,110,200,0.65)'; c.lineWidth = r * 0.12; c.stroke(); }
    c.save();
    c.scale(sx, sy);
    c.beginPath();
    c.arc(0, 0, r, 0, TAU);
    if (glow) {
      c.strokeStyle = col; c.lineWidth = lw; c.stroke();
      c.globalAlpha *= 0.7;
      c.fillStyle = col;
      for (let i = 0; i < 4; i++) {
        const a = i * (TAU / 4) + 0.6;
        c.beginPath();
        c.ellipse(Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38, r * 0.2, r * 0.12, a, 0, TAU);
        c.fill();
      }
      c.globalAlpha /= 0.7;
    } else {
      const g = c.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
      g.addColorStop(0, '#9b78d0');
      g.addColorStop(1, def.body);
      c.fillStyle = g;
      c.globalAlpha *= 0.92;
      c.fill();
      c.globalAlpha /= 0.92;
      c.fillStyle = 'rgba(255,255,255,0.12)';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        c.beginPath();
        c.arc(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92, r * 0.16, 0, TAU);
        c.fill();
      }
    }
    c.restore();
  }

  function drawEel(c, r, t, def, glow, col) {
    const lw = glowWidth();
    const n = 9, sp = r * 0.85;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const amp = r * 0.45 * Math.min(1, 0.25 + i / n);
      pts.push([-i * sp, Math.sin(t * 9 - i * 0.85) * amp]);
    }
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (!glow) {
      for (let i = 0; i < n - 1; i++) {
        c.strokeStyle = def.body;
        c.lineWidth = r * 1.25 * (1 - (i / n) * 0.75);
        c.beginPath();
        c.moveTo(pts[i][0], pts[i][1]);
        c.lineTo(pts[i + 1][0], pts[i + 1][1]);
        c.stroke();
      }
      c.strokeStyle = 'rgba(200,220,150,0.25)';
      c.lineWidth = r * 0.3;
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < n; i++) c.lineTo(pts[i][0], pts[i][1]);
      c.stroke();
      c.fillStyle = def.body;
      c.beginPath();
      c.ellipse(r * 0.35, 0, r * 0.85, r * 0.62, 0, 0, TAU);
      c.fill();
      c.fillStyle = def.shell;
      c.beginPath();
      c.ellipse(r * 0.95, 0, r * 0.32, r * 0.42, 0, 0, TAU);
      c.fill();
    } else {
      c.strokeStyle = col;
      c.lineWidth = lw;
      c.globalAlpha *= 0.6;
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < n; i++) c.lineTo(pts[i][0], pts[i][1]);
      c.stroke();
      c.globalAlpha /= 0.6;
      c.fillStyle = col;
      for (let i = 2; i < n; i += 2) {
        c.beginPath();
        c.arc(pts[i][0], pts[i][1] + r * 0.28, r * 0.12, 0, TAU);
        c.arc(pts[i][0], pts[i][1] - r * 0.28, r * 0.12, 0, TAU);
        c.fill();
      }
    }
    eyes(c, r * 0.6, r * 0.3, r * 0.15, col, glow);
  }

  function drawPuffer(c, r, t, def, glow, col, inflate) {
    const lw = glowWidth();
    const spikes = 16;
    const len = r * (0.12 + 0.3 * inflate);
    c.lineCap = 'round';
    // tail and fins
    if (!glow) {
      c.fillStyle = def.shell;
      c.beginPath();
      c.moveTo(-r * 0.85, 0);
      c.lineTo(-r * 1.45, -r * 0.45 + Math.sin(t * 10) * r * 0.1);
      c.lineTo(-r * 1.45, r * 0.45 + Math.sin(t * 10) * r * 0.1);
      c.closePath();
      c.fill();
      const flap = Math.sin(t * 12) * 0.4;
      c.beginPath();
      c.ellipse(0, -r * 0.95, r * 0.32, r * 0.16, -0.4 + flap, 0, TAU);
      c.ellipse(0, r * 0.95, r * 0.32, r * 0.16, 0.4 - flap, 0, TAU);
      c.fill();
    }
    // spikes
    c.beginPath();
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * TAU;
      c.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
      c.lineTo(Math.cos(a) * (r + len), Math.sin(a) * (r + len));
    }
    if (glow) {
      c.strokeStyle = col; c.lineWidth = lw; c.globalAlpha *= 0.55; c.stroke(); c.globalAlpha /= 0.55;
      c.fillStyle = col;
      c.beginPath();
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * TAU;
        c.moveTo(Math.cos(a) * (r + len) + 1.8, Math.sin(a) * (r + len));
        c.arc(Math.cos(a) * (r + len), Math.sin(a) * (r + len), 1.8, 0, TAU);
      }
      c.fill();
    } else { c.strokeStyle = def.shell; c.lineWidth = r * 0.1; c.stroke(); }
    // body
    c.beginPath();
    c.arc(0, 0, r, 0, TAU);
    if (glow) { c.strokeStyle = col; c.lineWidth = lw; c.stroke(); }
    else {
      const g = c.createRadialGradient(r * 0.2, -r * 0.2, r * 0.1, 0, 0, r);
      g.addColorStop(0, '#c9b07a');
      g.addColorStop(1, def.body);
      c.fillStyle = g;
      c.fill();
      c.fillStyle = 'rgba(40,30,10,0.35)';
      for (let i = 0; i < 6; i++) {
        const a = i * 1.1 + 0.5;
        c.beginPath();
        c.arc(Math.cos(a) * r * 0.55 - r * 0.15, Math.sin(a) * r * 0.55, r * 0.11, 0, TAU);
        c.fill();
      }
    }
    if (glow) eyes(c, r * 0.58, r * 0.36, r * 0.13, col, true);
    else {
      c.fillStyle = '#f2ead8';
      c.beginPath(); c.arc(r * 0.58, r * 0.36, r * 0.2, 0, TAU); c.arc(r * 0.58, -r * 0.36, r * 0.2, 0, TAU); c.fill();
      eyes(c, r * 0.64, r * 0.36, r * 0.1, col, false);
    }
  }

  function drawSquid(c, r, t, def, glow, col, charge) {
    const lw = glowWidth();
    c.lineCap = 'round';
    // arms reaching forward
    c.beginPath();
    for (let k = 0; k < 6; k++) {
      const y0 = (k - 2.5) * r * 0.16;
      c.moveTo(r * 0.55, y0);
      for (let i = 1; i <= 4; i++) {
        c.lineTo(r * 0.55 + i * r * 0.26, y0 * (1 + i * 0.25) + Math.sin(t * 6 + k + i * 0.9) * r * 0.12);
      }
    }
    if (glow) { c.strokeStyle = col; c.lineWidth = lw; c.globalAlpha *= 0.45; c.stroke(); c.globalAlpha /= 0.45; }
    else { c.strokeStyle = def.shell; c.lineWidth = r * 0.12; c.stroke(); }
    // mantle
    c.beginPath();
    c.moveTo(r * 0.45, -r * 0.5);
    c.quadraticCurveTo(-r * 0.6, -r * 0.72, -r * 1.95, 0);
    c.quadraticCurveTo(-r * 0.6, r * 0.72, r * 0.45, r * 0.5);
    c.quadraticCurveTo(r * 0.7, 0, r * 0.45, -r * 0.5);
    c.closePath();
    if (glow) { c.strokeStyle = col; c.lineWidth = lw; c.stroke(); }
    else {
      c.fillStyle = def.body;
      c.fill();
      // fins
      c.fillStyle = def.shell;
      c.beginPath();
      c.moveTo(-r * 1.95, 0);
      c.lineTo(-r * 1.3, -r * 0.75);
      c.lineTo(-r * 1.05, -r * 0.3);
      c.lineTo(-r * 1.05, r * 0.3);
      c.lineTo(-r * 1.3, r * 0.75);
      c.closePath();
      c.fill();
    }
    if (glow) {
      c.fillStyle = col;
      for (let i = 0; i < 4; i++) {
        c.beginPath();
        c.arc(-r * (0.2 + i * 0.38), (i % 2 ? 1 : -1) * r * 0.18, r * 0.08, 0, TAU);
        c.fill();
      }
      if (charge > 0) {
        c.globalAlpha *= charge;
        const s = r * 1.6;
        c.drawImage(glowSprite(COLORS.ink), -r * 0.6 - s, -s, s * 2, s * 2);
        c.globalAlpha /= charge || 1;
      }
      eyes(c, r * 0.35, r * 0.42, r * 0.16, col, true);
    } else {
      c.fillStyle = '#e6e8f2';
      c.beginPath(); c.arc(r * 0.35, r * 0.42, r * 0.22, 0, TAU); c.arc(r * 0.35, -r * 0.42, r * 0.22, 0, TAU); c.fill();
      eyes(c, r * 0.4, r * 0.42, r * 0.11, col, false);
    }
  }

  function drawEnemy(e, glow) {
    const def = e.def;
    const em = e.emerge;
    const col = e.elite ? COLORS.gold : def.glow;
    ctx.save();
    ctx.translate(e.x, e.y);
    let baseAlpha = 1;
    if (em < 1) {
      const s = 0.4 + 0.6 * em;
      ctx.scale(s, s);
      baseAlpha = em;
    }
    ctx.globalAlpha = baseAlpha;
    if (glow) {
      const hs = e.r * (e.elite ? 3.4 : 2.6);
      ctx.globalAlpha = baseAlpha * (e.elite ? 0.5 : 0.3);
      ctx.drawImage(glowSprite(col), -hs, -hs, hs * 2, hs * 2);
      if (e.burn > 0) {
        ctx.globalAlpha = baseAlpha * 0.6;
        const bs = e.r * 2;
        ctx.drawImage(glowSprite(COLORS.ember), -bs, -bs, bs * 2, bs * 2);
      }
      ctx.globalAlpha = baseAlpha;
    }
    ctx.rotate(e.face);
    const r = e.baseR;
    switch (e.type) {
      case 'crab': drawCrab(ctx, r, e.t, def, glow, col, false); break;
      case 'jelly': drawJelly(ctx, r, e.t, def, glow, col, e.seed); break;
      case 'eel': drawEel(ctx, r, e.t, def, glow, col); break;
      case 'puffer': drawPuffer(ctx, e.r, e.t, def, glow, col, e.inflate); break;
      case 'squid': drawSquid(ctx, r, e.t, def, glow, col, e.shotT < 0.6 ? 1 - e.shotT / 0.6 : 0); break;
      default: break;
    }
    if (!glow) {
      if (e.elite) {
        ctx.globalAlpha = baseAlpha * 0.28;
        ctx.fillStyle = COLORS.gold;
        ctx.beginPath();
        ctx.arc(0, 0, e.r * 0.95, 0, TAU);
        ctx.fill();
      }
      if (e.flash > 0) {
        ctx.globalAlpha = baseAlpha * 0.85 * Math.min(1, e.flash / 0.08);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, e.r * 0.95, 0, TAU);
        ctx.fill();
      }
    } else if (e.elite) {
      ctx.strokeStyle = COLORS.gold;
      ctx.lineWidth = glowWidth();
      ctx.globalAlpha = baseAlpha * (0.5 + 0.3 * Math.sin(renderTime * 4 + e.seed));
      ctx.beginPath();
      ctx.arc(0, 0, e.r * 1.45, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  const KING_DEF = { body: '#b4462c', shell: '#6c2416' };
  const LEVI_COLORS = { body: '#173847', belly: '#24566a', fin: '#0f2833' };

  function bossEmergeScale(b) {
    const em = b.emerge;
    return { s: 0.55 + 0.45 * em, a: Math.min(1, 0.2 + em) };
  }

  function drawBoss(b, glow) {
    const es = bossEmergeScale(b);
    if (b.type === 'leviathan') { drawLeviathan(b, glow, es); return; }
    ctx.save();
    let jx = 0, jy = 0;
    if (b.mode === 'telegraph' && !reducedMotion) { jx = rand(-2.5, 2.5); jy = rand(-2.5, 2.5); }
    ctx.translate(b.x + jx, b.y + jy);
    ctx.globalAlpha = es.a;
    if (!glow) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(8, 10, b.r * 1.25 * es.s, b.r * 1.05 * es.s, 0, 0, TAU);
      ctx.fill();
    }
    ctx.scale(es.s, es.s);
    ctx.rotate(b.face);
    drawCrab(ctx, b.r, b.t, KING_DEF, glow, b.def.glow, true);
    if (!glow && b.flash > 0) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(0, 0, b.r * 0.9, b.r * 1.1, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBossGlow(b) {
    const es = bossEmergeScale(b);
    const col = b.type === 'leviathan' && b.enraged ? '#ff7aa8' : b.def.glow;
    // halo
    ctx.globalAlpha = 0.35 * es.a;
    const hs = b.r * 3;
    ctx.drawImage(glowSprite(col), b.x - hs, b.y - hs, hs * 2, hs * 2);
    if (b.burn > 0) {
      ctx.globalAlpha = 0.4;
      ctx.drawImage(glowSprite(COLORS.ember), b.x - b.r * 1.6, b.y - b.r * 1.6, b.r * 3.2, b.r * 3.2);
    }
    ctx.globalAlpha = 1;
    // Crab King dash warning
    if (b.type === 'crabKing' && b.mode === 'telegraph') {
      const k = b.modeT / b.def.telegraph;
      const len = b.def.dashDist + b.r;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.atan2(b.dashDy, b.dashDx));
      ctx.globalCompositeOperation = 'source-over';
      const blink = reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(renderTime * 28);
      ctx.fillStyle = 'rgba(255,84,104,' + (0.08 + 0.17 * k).toFixed(3) + ')';
      ctx.fillRect(0, -b.r * 0.85, len, b.r * 1.7);
      ctx.strokeStyle = 'rgba(255,84,104,' + (0.5 * blink + 0.3 * k).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.setLineDash([16, 10]);
      ctx.beginPath();
      ctx.moveTo(0, -b.r * 0.85); ctx.lineTo(len, -b.r * 0.85);
      ctx.moveTo(0, b.r * 0.85); ctx.lineTo(len, b.r * 0.85);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,200,205,' + (0.4 + 0.4 * k).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(len, 0);
      ctx.lineTo(len - 26, -16);
      ctx.lineTo(len - 26, 16);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.globalCompositeOperation = 'lighter';
    }
    drawBoss(b, true);
  }

  function drawLeviathan(b, glow, es) {
    const r = b.r;
    const col = b.enraged ? '#ff7aa8' : b.def.glow;
    const lw = glowWidth();
    ctx.save();
    ctx.globalAlpha = es.a;
    if (glow && b.segs.length) {
      // faint glowing spine
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.globalAlpha = es.a * 0.28;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      for (const s of b.segs) ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.globalAlpha = es.a;
    }
    // body segments, tail first
    for (let i = b.segs.length - 1; i >= 0; i--) {
      const s = b.segs[i];
      const prev = i === 0 ? b : b.segs[i - 1];
      const sr = r * (0.78 - i * 0.055) * es.s;
      const ang = Math.atan2(prev.y - s.y, prev.x - s.x);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(ang);
      if (!glow) {
        // fins
        ctx.fillStyle = LEVI_COLORS.fin;
        const flap = Math.sin(b.t * 3 - i * 0.6) * 0.3;
        ctx.beginPath();
        ctx.moveTo(0, -sr * 0.6);
        ctx.lineTo(-sr * 0.9, -sr * (1.5 + flap));
        ctx.lineTo(-sr * 0.4, -sr * 0.5);
        ctx.moveTo(0, sr * 0.6);
        ctx.lineTo(-sr * 0.9, sr * (1.5 + flap));
        ctx.lineTo(-sr * 0.4, sr * 0.5);
        ctx.fill();
        const g = ctx.createRadialGradient(0, -sr * 0.2, sr * 0.1, 0, 0, sr);
        g.addColorStop(0, LEVI_COLORS.belly);
        g.addColorStop(1, LEVI_COLORS.body);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, 0, sr * 1.1, sr, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(-sr * 0.2, 0, sr * 0.3, sr * 0.8, 0, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillStyle = col;
        const pulse = 0.6 + 0.4 * Math.sin(b.t * 3 - i * 0.7);
        ctx.globalAlpha = es.a * pulse;
        ctx.beginPath();
        ctx.arc(0, -sr * 0.55, Math.max(2, sr * 0.1), 0, TAU);
        ctx.arc(0, sr * 0.55, Math.max(2, sr * 0.1), 0, TAU);
        ctx.fill();
        ctx.globalAlpha = es.a;
      }
      ctx.restore();
    }
    // head
    ctx.translate(b.x, b.y);
    ctx.scale(es.s, es.s);
    ctx.rotate(b.face);
    const jaw = 0.25 + 0.15 * Math.sin(b.t * 2.5);
    if (!glow) {
      // mandibles
      ctx.fillStyle = '#0e222c';
      for (let side = -1; side <= 1; side += 2) {
        ctx.save();
        ctx.rotate(side * jaw);
        ctx.beginPath();
        ctx.moveTo(r * 0.5, side * r * 0.3);
        ctx.quadraticCurveTo(r * 1.4, side * r * 0.5, r * 1.55, side * r * 0.05);
        ctx.quadraticCurveTo(r * 1.1, side * r * 0.2, r * 0.6, side * r * 0.05);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      const g = ctx.createRadialGradient(r * 0.2, -r * 0.2, r * 0.1, 0, 0, r * 1.1);
      g.addColorStop(0, '#2d6b80');
      g.addColorStop(1, LEVI_COLORS.body);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.05, r * 0.82, 0, 0, TAU);
      ctx.fill();
      // ridges
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        ctx.moveTo(-r * 0.6 + i * r * 0.25, -r * 0.55);
        ctx.quadraticCurveTo(-r * 0.5 + i * r * 0.25, 0, -r * 0.6 + i * r * 0.25, r * 0.55);
      }
      ctx.stroke();
      if (b.flash > 0) {
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.05, r * 0.82, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = es.a;
      }
      eyes(ctx, r * 0.55, r * 0.32, r * 0.09, col, false);
      eyes(ctx, r * 0.25, r * 0.5, r * 0.07, col, false);
    } else {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw * 1.2;
      ctx.globalAlpha = es.a * 0.7;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.05, r * 0.82, 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = es.a;
      // whiskers
      ctx.lineWidth = lw;
      ctx.globalAlpha = es.a * 0.6;
      ctx.beginPath();
      for (let side = -1; side <= 1; side += 2) {
        ctx.moveTo(r * 0.9, side * r * 0.4);
        ctx.quadraticCurveTo(r * 1.6, side * r * (0.9 + 0.2 * Math.sin(b.t * 2)), r * 1.3, side * r * 1.5);
      }
      ctx.stroke();
      ctx.globalAlpha = es.a;
      eyes(ctx, r * 0.55, r * 0.32, r * 0.09, col, true);
      eyes(ctx, r * 0.25, r * 0.5, r * 0.07, col, true);
    }
    ctx.restore();
  }

  // ---- Small canvas icons for upgrade cards ----

  function drawIcon(c, id, size) {
    c.save();
    c.scale(size / 48, size / 48);
    c.translate(24, 24);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const bg = c.createRadialGradient(0, 0, 2, 0, 0, 24);
    const kind = UPGRADE_BY_ID[id] ? UPGRADE_BY_ID[id].kind : 'item';
    const tint = kind === 'weapon' ? '255,181,71' : kind === 'passive' ? '95,224,207' : '255,211,107';
    bg.addColorStop(0, 'rgba(' + tint + ',0.28)');
    bg.addColorStop(1, 'rgba(' + tint + ',0)');
    c.fillStyle = bg;
    c.beginPath();
    c.arc(0, 0, 24, 0, TAU);
    c.fill();
    c.strokeStyle = 'rgba(' + tint + ',0.45)';
    c.lineWidth = 1.2;
    c.beginPath();
    c.arc(0, 0, 21, 0, TAU);
    c.stroke();
    switch (id) {
      case 'spark': {
        c.strokeStyle = 'rgba(255,181,71,0.7)';
        c.lineWidth = 3;
        c.beginPath(); c.moveTo(-14, 10); c.lineTo(-3, 2); c.stroke();
        c.fillStyle = '#ffd27a';
        c.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU - Math.PI / 2, rr = i % 2 ? 4 : 11;
          c.lineTo(4 + Math.cos(a) * rr, -4 + Math.sin(a) * rr);
        }
        c.closePath(); c.fill();
        c.fillStyle = '#fff6dc';
        c.beginPath(); c.arc(4, -4, 3, 0, TAU); c.fill();
        break;
      }
      case 'beam': {
        c.fillStyle = 'rgba(255,226,160,0.55)';
        c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 21, -0.95, -0.55); c.closePath(); c.fill();
        c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 21, Math.PI - 0.95, Math.PI - 0.55); c.closePath(); c.fill();
        c.fillStyle = '#b13a34'; c.beginPath(); c.arc(0, 0, 8, 0, TAU); c.fill();
        c.fillStyle = '#ece0c4'; c.beginPath(); c.arc(0, 0, 5.5, 0, TAU); c.fill();
        c.fillStyle = '#ffe2a0'; c.beginPath(); c.arc(0, 0, 3, 0, TAU); c.fill();
        break;
      }
      case 'aura': {
        c.strokeStyle = 'rgba(255,140,60,0.8)';
        c.lineWidth = 2;
        c.setLineDash([4, 3]);
        c.beginPath(); c.arc(0, 0, 16, 0, TAU); c.stroke();
        c.setLineDash([]);
        c.fillStyle = '#2a2016'; c.fillRect(-6, -8, 12, 16);
        c.fillStyle = '#ffd27a'; c.fillRect(-4, -5, 8, 10);
        c.fillStyle = '#ff9a3d'; c.beginPath(); c.ellipse(0, 0, 2.5, 4, 0, 0, TAU); c.fill();
        c.strokeStyle = '#2a2016'; c.lineWidth = 2; c.beginPath(); c.arc(0, -10, 4, Math.PI, 0); c.stroke();
        break;
      }
      case 'anchors': {
        c.strokeStyle = '#2a3036'; c.lineWidth = 5; anchorPath(c, 15); c.stroke();
        c.strokeStyle = '#d6e0e6'; c.lineWidth = 2.6; anchorPath(c, 15); c.stroke();
        break;
      }
      case 'harpoon': {
        c.rotate(-Math.PI / 4);
        c.strokeStyle = '#8a6038'; c.lineWidth = 3.5;
        c.beginPath(); c.moveTo(-17, 0); c.lineTo(8, 0); c.stroke();
        c.fillStyle = '#e1e7ea';
        c.beginPath(); c.moveTo(18, 0); c.lineTo(5, -6); c.lineTo(8, 0); c.lineTo(5, 6); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(220,200,160,0.7)'; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(-17, 0); c.quadraticCurveTo(-20, 7, -14, 12); c.stroke();
        break;
      }
      case 'boots': {
        c.fillStyle = '#e1a43a';
        c.beginPath();
        c.moveTo(-8, -14); c.lineTo(3, -14); c.lineTo(3, 3); c.lineTo(13, 6); c.quadraticCurveTo(15, 12, 10, 12);
        c.lineTo(-8, 12); c.closePath(); c.fill();
        c.fillStyle = '#8a5a14'; c.fillRect(-8, 9, 20, 3);
        c.strokeStyle = 'rgba(95,224,207,0.8)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(-17, -4); c.lineTo(-11, -4); c.moveTo(-18, 2); c.lineTo(-11, 2); c.stroke();
        break;
      }
      case 'hull': {
        c.fillStyle = '#7a5532';
        c.beginPath(); c.moveTo(-15, -6); c.lineTo(15, -6); c.quadraticCurveTo(13, 12, 0, 15); c.quadraticCurveTo(-13, 12, -15, -6); c.fill();
        c.strokeStyle = '#3d2a18'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(-14, 0); c.lineTo(14, 0); c.moveTo(-11, 6); c.lineTo(11, 6); c.stroke();
        c.fillStyle = '#c9d2d8'; c.fillRect(-16, -9, 32, 4);
        c.fillStyle = '#ff6a5c'; c.beginPath(); c.arc(0, -15, 4, 0, TAU); c.fill();
        break;
      }
      case 'regen': {
        c.fillStyle = '#e8838f';
        c.beginPath(); c.ellipse(-7, 3, 7, 11, 0.2, 0, TAU); c.fill();
        c.beginPath(); c.ellipse(7, 3, 7, 11, -0.2, 0, TAU); c.fill();
        c.strokeStyle = '#f4d6da'; c.lineWidth = 2.5;
        c.beginPath(); c.moveTo(0, -14); c.lineTo(0, -4); c.moveTo(0, -4); c.lineTo(-5, 0); c.moveTo(0, -4); c.lineTo(5, 0); c.stroke();
        c.strokeStyle = 'rgba(143,240,180,0.9)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(13, -14); c.lineTo(13, -6); c.moveTo(9, -10); c.lineTo(17, -10); c.stroke();
        break;
      }
      case 'magnet': {
        c.lineWidth = 7; c.strokeStyle = '#d64a4a';
        c.beginPath(); c.arc(0, -2, 10, Math.PI, 0); c.stroke();
        c.beginPath(); c.moveTo(-10, -2); c.lineTo(-10, 8); c.moveTo(10, -2); c.lineTo(10, 8); c.stroke();
        c.strokeStyle = '#d6dde2';
        c.beginPath(); c.moveTo(-10, 8); c.lineTo(-10, 13); c.moveTo(10, 8); c.lineTo(10, 13); c.stroke();
        c.fillStyle = '#ffb15c';
        c.beginPath(); c.moveTo(0, 6); c.lineTo(4, 11); c.lineTo(0, 16); c.lineTo(-4, 11); c.closePath(); c.fill();
        break;
      }
      case 'wick': {
        c.fillStyle = '#efe3c8'; c.fillRect(-6, -2, 12, 17);
        c.strokeStyle = '#3a2a1c'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(0, -2); c.quadraticCurveTo(3, -6, 0, -9); c.stroke();
        c.fillStyle = '#ffb547'; c.beginPath(); c.ellipse(0, -13, 4, 7, 0, 0, TAU); c.fill();
        c.fillStyle = '#fff3c4'; c.beginPath(); c.ellipse(0, -12, 1.8, 3.5, 0, 0, TAU); c.fill();
        break;
      }
      case 'powder': {
        c.fillStyle = '#6b4a2a';
        c.beginPath(); c.ellipse(0, 3, 11, 12, 0, 0, TAU); c.fill();
        c.fillStyle = '#3d2a18'; c.fillRect(-11, -3, 22, 3); c.fillRect(-11, 7, 22, 3);
        c.strokeStyle = '#d9c39a'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, -9); c.quadraticCurveTo(6, -14, 10, -12); c.stroke();
        c.fillStyle = '#ffd27a'; c.beginPath(); c.arc(11, -13, 3, 0, TAU); c.fill();
        break;
      }
      case 'hourglass': {
        c.strokeStyle = '#c99b55'; c.lineWidth = 3;
        c.beginPath(); c.moveTo(-10, -15); c.lineTo(10, -15); c.moveTo(-10, 15); c.lineTo(10, 15); c.stroke();
        c.fillStyle = 'rgba(200,225,240,0.35)';
        c.beginPath(); c.moveTo(-8, -13); c.lineTo(8, -13); c.lineTo(1.5, 0); c.lineTo(8, 13); c.lineTo(-8, 13); c.lineTo(-1.5, 0); c.closePath(); c.fill();
        c.fillStyle = '#ffcf7a';
        c.beginPath(); c.moveTo(-4, -6); c.lineTo(4, -6); c.lineTo(0.8, 0); c.lineTo(-0.8, 0); c.closePath(); c.fill();
        c.beginPath(); c.moveTo(-7, 13); c.lineTo(7, 13); c.lineTo(0, 6); c.closePath(); c.fill();
        break;
      }
      case 'tea': {
        c.fillStyle = '#e9e1cf';
        c.beginPath(); c.moveTo(-11, -3); c.lineTo(9, -3); c.quadraticCurveTo(8, 12, -1, 12); c.quadraticCurveTo(-10, 12, -11, -3); c.fill();
        c.strokeStyle = '#e9e1cf'; c.lineWidth = 2.5; c.beginPath(); c.arc(11, 3, 4, -1.4, 1.4); c.stroke();
        c.fillStyle = '#9a5a2a'; c.beginPath(); c.ellipse(-1, -3, 9.5, 2.2, 0, 0, TAU); c.fill();
        c.strokeStyle = 'rgba(241,228,198,0.6)'; c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(-4, -8); c.quadraticCurveTo(-7, -12, -4, -16); c.moveTo(2, -8); c.quadraticCurveTo(-1, -12, 2, -16); c.stroke();
        break;
      }
      case 'coin': {
        c.fillStyle = '#e8b53c'; c.beginPath(); c.arc(0, 0, 13, 0, TAU); c.fill();
        c.strokeStyle = '#8a6418'; c.lineWidth = 1.6; c.beginPath(); c.arc(0, 0, 10, 0, TAU); c.stroke();
        c.fillStyle = '#8a6418';
        c.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU - Math.PI / 2, rr = i % 2 ? 2.6 : 6;
          c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        c.closePath(); c.fill();
        break;
      }
      default: break;
    }
    c.restore();
  }

  // =========================================================================
  // 12. UI (DOM overlays, HUD)
  // =========================================================================

  const $ = id => document.getElementById(id);
  const el = {};
  const OVERLAYS = ['ov-title', 'ov-howto', 'ov-levelup', 'ov-dawn', 'ov-pause', 'ov-gameover', 'ov-victory'];
  const ui = { lockUntil: 0, bannerT: 0, toastT: 0, cache: {}, confirmKind: null };

  const DAWN_HINTS = {
    2: 'Águas-vivas começam a subir à praia esta noite.',
    3: 'O mar está agitado. Mais criaturas virão.',
    4: 'Moreias velozes rondam a costa. Fique de olho nelas.',
    5: 'Baiacus espinhosos se aproximam — eles incham quando chegam perto.',
    6: 'A lua está quase cheia. Algo grande se mexe no fundo.',
    7: 'O Caranguejo-Rei sai da toca esta noite. Cuidado com as investidas.',
    8: 'Lulas-tinteiras cospem tinta de longe. Não fique parado.',
    9: 'Metade da quinzena já passou. O farol continua aceso.',
    10: 'Criaturas douradas, bem mais resistentes, surgem na escuridão.',
    11: 'As noites estão mais longas. Cada ponto de vida conta.',
    12: 'Faltam só três noites. O mar não dá trégua.',
    13: 'A penúltima noite. Um canto grave ecoa sob as ondas.',
    14: 'A última noite: o Leviatã das Marés virá atrás do farol.',
  };

  function cacheDom() {
    const ids = {
      hud: 'hud', hpBar: 'hp-bar', hpFill: 'hp-fill', hpText: 'hp-text', xpBar: 'xp-bar', xpFill: 'xp-fill', xpText: 'xp-text',
      kills: 'kills', score: 'score', nightLabel: 'night-label', nightTimer: 'night-timer',
      btnPause: 'btn-pause', btnMute: 'btn-mute', bossBar: 'boss-bar', bossName: 'boss-name', bossFill: 'boss-fill', bossMeter: 'boss-meter',
      banner: 'banner', bannerTitle: 'banner-title', bannerSub: 'banner-sub', toast: 'toast',
      btnStart: 'btn-start', btnHowto: 'btn-howto', titleRecord: 'title-record', btnSoundTitle: 'btn-sound-title',
      btnHowtoBack: 'btn-howto-back',
      luH: 'lu-h', luSub: 'lu-sub', luCards: 'lu-cards',
      dawnSub: 'dawn-sub', dawnPips: 'dawn-pips', dawnStats: 'dawn-stats', dawnHint: 'dawn-hint', btnNextNight: 'btn-next-night',
      pauseSub: 'pause-sub', pauseActions: 'pause-actions', btnResume: 'btn-resume', btnRestart: 'btn-restart', btnSoundPause: 'btn-sound-pause', btnQuit: 'btn-quit',
      pauseConfirm: 'pause-confirm', confirmText: 'confirm-text', btnConfirmYes: 'btn-confirm-yes', btnConfirmNo: 'btn-confirm-no',
      goSub: 'go-sub', goRecord: 'go-record', goPips: 'go-pips', goStats: 'go-stats', btnRetry: 'btn-retry', btnGoMenu: 'btn-go-menu',
      winRecord: 'win-record', winPips: 'win-pips', winStats: 'win-stats', winBest: 'win-best', btnAgain: 'btn-again', btnWinMenu: 'btn-win-menu',
    };
    for (const k in ids) el[k] = $(ids[k]);
  }

  function showOverlay(id) {
    for (const o of OVERLAYS) {
      const node = $(o);
      const show = o === id;
      if (node.hidden === show) node.hidden = !show;
    }
    if (id) {
      const node = $(id);
      node.scrollTop = 0;
      focusFirst(node);
    }
  }

  function focusFirst(root) {
    const btns = root.querySelectorAll('button');
    for (const b of btns) {
      if (b.offsetParent !== null && !b.disabled) {
        try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); }
        return;
      }
    }
  }

  function make(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function setText(node, key, v) {
    if (ui.cache[key] !== v) {
      ui.cache[key] = v;
      node.textContent = v;
    }
  }
  function setFill(node, key, frac) {
    const v = 'scaleX(' + clamp(frac, 0, 1).toFixed(3) + ')';
    if (ui.cache[key] !== v) {
      ui.cache[key] = v;
      node.style.transform = v;
    }
  }
  function setAttr(node, key, attr, v) {
    if (ui.cache[key] !== v) {
      ui.cache[key] = v;
      node.setAttribute(attr, v);
    }
  }

  function updateHud() {
    if (el.hud.hidden) return;
    const p = state.player;
    const frac = p.maxHp > 0 ? p.hp / p.maxHp : 0;
    setText(el.hpText, 'hp', Math.ceil(p.hp) + '/' + Math.round(p.maxHp));
    setFill(el.hpFill, 'hpf', frac);
    setAttr(el.hpBar, 'hpa', 'aria-valuenow', String(Math.round(frac * 100)));
    const low = frac < 0.3;
    if (ui.cache.low !== low) {
      ui.cache.low = low;
      el.hpBar.classList.toggle('is-low', low);
    }
    const need = xpToNext(state.level);
    setText(el.xpText, 'lvl', 'Nív. ' + state.level);
    setFill(el.xpFill, 'xpf', state.xp / need);
    setAttr(el.xpBar, 'xpa', 'aria-valuenow', String(Math.round((state.xp / need) * 100)));
    setText(el.kills, 'kills', fmtInt(state.kills));
    setText(el.score, 'score', fmtInt(currentScore()));
    setText(el.nightLabel, 'night', 'Noite ' + state.night + '/' + NIGHTS.total);
    let mode;
    if (state.isBossNight) {
      mode = 'boss';
      setText(el.nightTimer, 'timer', 'Chefe');
      const b = state.boss;
      const showBar = !!b && !b.dead && state.phase === 'night';
      if (el.bossBar.hidden === showBar) el.bossBar.hidden = !showBar;
      if (showBar) {
        setText(el.bossName, 'bossName', b.def.name);
        setFill(el.bossFill, 'bossf', b.hp / b.maxHp);
        setAttr(el.bossMeter, 'bossa', 'aria-valuenow', String(Math.round((b.hp / b.maxHp) * 100)));
      }
    } else {
      const left = state.phase === 'night' ? state.nightDur - state.nightT : 0;
      mode = left <= 10 && state.phase === 'night' ? 'urgent' : 'normal';
      setText(el.nightTimer, 'timer', fmtTime(left));
      if (!el.bossBar.hidden) el.bossBar.hidden = true;
    }
    if (ui.cache.timerMode !== mode) {
      ui.cache.timerMode = mode;
      el.nightTimer.classList.toggle('is-boss', mode === 'boss');
      el.nightTimer.classList.toggle('is-urgent', mode === 'urgent');
    }
  }

  function showBanner(title, sub, dur, boss) {
    if (!el.banner) return;
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub || '';
    el.banner.classList.toggle('is-boss', !!boss);
    el.banner.classList.add('show');
    ui.bannerT = dur || 2;
  }
  function hideBanner() {
    ui.bannerT = 0;
    if (el.banner) el.banner.classList.remove('show');
  }
  function showToast(text, dur) {
    if (!el.toast) return;
    el.toast.textContent = text;
    el.toast.classList.add('show');
    ui.toastT = dur || 2.4;
  }
  function updateBannerToast(dt) {
    if (ui.bannerT > 0) {
      ui.bannerT -= dt;
      if (ui.bannerT <= 0) el.banner.classList.remove('show');
    }
    if (ui.toastT > 0) {
      ui.toastT -= dt;
      if (ui.toastT <= 0) el.toast.classList.remove('show');
    }
  }

  function renderPips(node, done, lost) {
    node.textContent = '';
    for (let n = 1; n <= NIGHTS.total; n++) {
      let cls = 'pip';
      if (NIGHTS.bossNights.indexOf(n) >= 0) cls += ' is-boss';
      if (n <= done) cls += ' is-done';
      if (n === lost) cls += ' is-lost';
      node.appendChild(make('span', cls));
    }
  }

  function renderStats(node, rows) {
    node.textContent = '';
    node.setAttribute('data-count', String(rows.length));
    for (const r of rows) {
      const wrap = make('div', 'stat' + (r[2] ? ' ' + r[2] : ''));
      wrap.appendChild(make('dt', null, r[0]));
      wrap.appendChild(make('dd', null, String(r[1])));
      node.appendChild(wrap);
    }
  }

  function updateRecordLine() {
    const n = el.titleRecord;
    n.textContent = '';
    if (prefs.bestScore > 0) {
      n.appendChild(document.createTextNode('Recorde: '));
      n.appendChild(make('strong', null, fmtInt(prefs.bestScore) + ' pontos'));
      n.appendChild(document.createTextNode(' · noite ' + Math.max(1, prefs.bestNight)));
    } else {
      n.textContent = 'Nenhum recorde ainda';
    }
  }

  function syncSoundUi() {
    const label = prefs.muted ? 'Som: desligado' : 'Som: ligado';
    el.btnSoundTitle.textContent = label;
    el.btnSoundPause.textContent = label;
    el.btnMute.classList.toggle('is-muted', prefs.muted);
    el.btnMute.setAttribute('aria-label', prefs.muted ? 'Ligar som' : 'Desligar som');
  }

  function renderLevelUp() {
    const shown = state.level - state.pendingLevelUps + 1;
    el.luH.textContent = 'Subiu para o nível ' + shown;
    const more = state.pendingLevelUps - 1;
    el.luSub.textContent = more > 0 ? 'Escolha uma melhoria · mais\u00a0' + more + '\u00a0a\u00a0seguir' : 'Escolha uma melhoria';
    const wrap = el.luCards;
    wrap.textContent = '';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.offers.forEach((o, i) => {
      const L = lv(o.id);
      const btn = make('button', 'card card-' + o.kind);
      btn.type = 'button';
      btn.appendChild(make('span', 'card-key', String(i + 1)));
      const cv = make('canvas', 'card-icon');
      cv.width = cv.height = Math.round(60 * dpr);
      cv.setAttribute('aria-hidden', 'true');
      try { drawIcon(cv.getContext('2d'), o.id, cv.width); } catch (e) { /* icon is decorative */ }
      btn.appendChild(cv);
      const body = make('span', 'card-body');
      const top = make('span', 'card-top');
      top.appendChild(make('span', 'card-name', o.name));
      if (o.kind !== 'item') {
        top.appendChild(make('span', 'card-level' + (L === 0 ? ' is-new' : ''), L === 0 ? 'Novo!' : 'Nív. ' + L + ' → ' + (L + 1)));
      }
      body.appendChild(top);
      body.appendChild(make('span', 'card-desc', o.desc(L + 1)));
      body.appendChild(make('span', 'card-kind', o.kind === 'weapon' ? 'Arma' : o.kind === 'passive' ? 'Passiva' : 'Item'));
      btn.appendChild(body);
      btn.addEventListener('click', ev => {
        if (ev.detail > 0 && performance.now() < ui.lockUntil) return; // avoid accidental taps
        pickOffer(i);
      });
      wrap.appendChild(btn);
    });
  }

  function moveCardFocus(dir) {
    const cards = Array.prototype.slice.call(el.luCards.querySelectorAll('.card'));
    if (!cards.length) return;
    let i = cards.indexOf(document.activeElement);
    i = i < 0 ? 0 : (i + dir + cards.length) % cards.length;
    cards[i].focus();
  }

  function openConfirm(kind) {
    ui.confirmKind = kind;
    el.confirmText.textContent = kind === 'quit'
      ? 'Sair para o menu encerra esta quinzena.'
      : 'Recomeçar perde o progresso desta quinzena.';
    el.btnConfirmYes.textContent = kind === 'quit' ? 'Sim, sair' : 'Sim, recomeçar';
    el.pauseActions.hidden = true;
    el.pauseConfirm.hidden = false;
    el.btnConfirmNo.focus();
  }
  function closeConfirm() {
    const wasOpen = !el.pauseConfirm.hidden;
    ui.confirmKind = null;
    el.pauseConfirm.hidden = true;
    el.pauseActions.hidden = false;
    if (wasOpen) el.btnResume.focus();
  }

  // =========================================================================
  // 13. STATE MACHINE (screens)
  // =========================================================================

  function setScreen(s) {
    state.screen = s;
    const hudOn = s === 'playing' || s === 'paused' || s === 'levelup';
    if (el.hud && el.hud.hidden === hudOn) el.hud.hidden = !hudOn;
    // keep keyboard focus inside the open overlay
    if (el.hud) el.hud.inert = s !== 'playing';
    if (s !== 'playing') Input.releasePointer();
    Sound.setAmbient(s === 'playing' ? 1 : s === 'paused' || s === 'levelup' ? 0.4 : 0.75);
    try { document.body.setAttribute('data-screen', s); } catch (e) { /* ignore */ }
  }

  function startGame() {
    Sound.init();
    Sound.play('click', null, true);
    newRun();
  }

  function openHowto() {
    if (state.screen !== 'title') return;
    setScreen('howto');
    showOverlay('ov-howto');
  }
  function closeHowto() {
    if (state.screen !== 'howto') return;
    setScreen('title');
    showOverlay('ov-title');
  }

  function pauseGame() {
    if (state.screen !== 'playing') return;
    setScreen('paused');
    el.pauseSub.textContent = 'Noite ' + state.night + '/' + NIGHTS.total + ' · Nív. ' + state.level + ' · ' + fmtInt(currentScore()) + ' pontos';
    ui.confirmKind = null;
    el.pauseConfirm.hidden = true;
    el.pauseActions.hidden = false;
    showOverlay('ov-pause');
  }
  function resumeGame() {
    if (state.screen !== 'paused') return;
    setScreen('playing');
    showOverlay(null);
  }

  function restartRun() {
    commitRecord();
    hideBanner();
    newRun();
  }
  function toMenu() {
    commitRecord();
    hideBanner();
    setupAttract();
    updateRecordLine();
    showOverlay('ov-title');
  }

  function openLevelUp(after) {
    if (state.pendingLevelUps <= 0) return;
    state.afterLevelUp = after || 'play';
    state.offers = rollOffers();
    setScreen('levelup');
    renderLevelUp();
    showOverlay('ov-levelup');
    ui.lockUntil = performance.now() + 300;
    Sound.play('levelup', null, true);
  }

  function pickOffer(i) {
    if (state.screen !== 'levelup') return;
    const o = state.offers[i];
    if (!o) return;
    applyUpgrade(o.id);
    state.pendingLevelUps = Math.max(0, state.pendingLevelUps - 1);
    Sound.play('pick', null, true);
    const p = state.player;
    addRing(p.x, p.y, 10, 80, 0.5, COLORS.lantern);
    burst(p.x, p.y, 14, COLORS.lantern, 160, 0.6, 3);
    if (state.pendingLevelUps > 0) {
      state.offers = rollOffers();
      renderLevelUp();
      focusFirst($('ov-levelup'));
      ui.lockUntil = performance.now() + 300;
      return;
    }
    if (state.afterLevelUp === 'dawn') {
      state.afterLevelUp = 'play';
      showDawn();
      return;
    }
    setScreen('playing');
    showOverlay(null);
  }

  function showDawn() {
    const p = state.player;
    const amount = Math.max(0, Math.min(p.maxHp - p.hp, Math.round(p.maxHp * NIGHTS.dawnHeal)));
    p.hp += amount;
    state.lastDawnHeal = Math.round(amount);
    setScreen('dawn');
    el.dawnSub.textContent = 'Dia ' + state.night + ' sobrevivido · faltam ' + (NIGHTS.total - state.night) + (NIGHTS.total - state.night === 1 ? ' noite' : ' noites');
    renderPips(el.dawnPips, state.night, 0);
    renderStats(el.dawnStats, [
      ['Criaturas derrotadas', fmtInt(state.nightKills)],
      ['Brasas recolhidas', fmtInt(state.nightEmbers)],
      [state.lastDawnHeal > 0 ? 'Vida recuperada' : 'Vida', state.lastDawnHeal > 0 ? '+' + state.lastDawnHeal : 'Cheia', 'is-heal'],
    ]);
    el.dawnHint.textContent = DAWN_HINTS[state.night + 1] || '';
    el.btnNextNight.textContent = 'Começar a noite ' + (state.night + 1);
    showOverlay('ov-dawn');
    ui.lockUntil = performance.now() + 300;
    Sound.play('dawn', null, true);
  }

  function startNextNight() {
    if (state.screen !== 'dawn') return;
    Sound.play('click', null, true);
    state.night = Math.min(NIGHTS.total, state.night + 1);
    beginNight();
  }

  function gameOver() {
    if (state.screen === 'gameover') return;
    setScreen('gameover');
    const isNew = commitRecord();
    el.goSub.textContent = 'As criaturas tomaram a ilha na noite\u00a0' + state.night + '.';
    el.goRecord.hidden = !isNew;
    renderPips(el.goPips, state.night - 1, state.night);
    renderStats(el.goStats, [
      ['Noite alcançada', state.night + '/' + NIGHTS.total],
      ['Nível', state.level],
      ['Criaturas derrotadas', fmtInt(state.kills)],
      ['Pontuação', fmtInt(currentScore())],
    ]);
    showOverlay('ov-gameover');
  }

  function showVictory() {
    state.pendingLevelUps = 0;
    setScreen('victory');
    const isNew = commitRecord();
    el.winRecord.hidden = !isNew;
    renderPips(el.winPips, NIGHTS.total, 0);
    renderStats(el.winStats, [
      ['Nível', state.level],
      ['Criaturas derrotadas', fmtInt(state.kills)],
      ['Chefes derrotados', state.bossKills],
      ['Pontuação', fmtInt(currentScore())],
    ]);
    el.winBest.textContent = 'Recorde: ' + fmtInt(prefs.bestScore) + ' pontos · noite ' + Math.max(1, prefs.bestNight);
    showOverlay('ov-victory');
    Sound.play('victory', null, true);
    const p = state.player;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      burst(p.x + Math.cos(a) * 120, p.y + Math.sin(a) * 120, 14, i % 2 ? COLORS.gold : COLORS.biolume, 180, 1.4, 4);
    }
  }

  function toggleMute() {
    prefs.muted = !prefs.muted;
    Sound.setMuted(prefs.muted);
    savePrefs();
    syncSoundUi();
    if (!prefs.muted) {
      Sound.init();
      Sound.play('click', null, true);
    }
  }

  function bindUi() {
    const on = (node, fn) => node.addEventListener('click', ev => {
      Sound.init();
      fn(ev);
    });
    on(el.btnStart, () => { if (state.screen === 'title') startGame(); });
    on(el.btnHowto, openHowto);
    on(el.btnHowtoBack, () => { Sound.play('click'); closeHowto(); });
    on(el.btnSoundTitle, toggleMute);
    on(el.btnSoundPause, toggleMute);
    on(el.btnMute, toggleMute);
    on(el.btnPause, () => pauseGame());
    on(el.btnResume, () => resumeGame());
    on(el.btnRestart, () => openConfirm('restart'));
    on(el.btnQuit, () => openConfirm('quit'));
    on(el.btnConfirmNo, () => closeConfirm());
    on(el.btnConfirmYes, () => {
      if (state.screen !== 'paused') return;
      const kind = ui.confirmKind;
      closeConfirm();
      if (kind === 'quit') toMenu();
      else restartRun();
    });
    on(el.btnNextNight, ev => {
      if (ev.detail > 0 && performance.now() < ui.lockUntil) return;
      startNextNight();
    });
    on(el.btnRetry, () => { if (state.screen === 'gameover') restartRun(); });
    on(el.btnGoMenu, () => { if (state.screen === 'gameover') toMenu(); });
    on(el.btnAgain, () => { if (state.screen === 'victory') restartRun(); });
    on(el.btnWinMenu, () => { if (state.screen === 'victory') toMenu(); });
  }

  // ---- Input wiring ----

  function onKeyDown(e) {
    const code = codeOf(e);
    const key = (e.key || '').toLowerCase();
    Sound.init();
    if (MOVE_KEYS[code]) {
      Input.keys.add(code);
      if (state.screen === 'playing') e.preventDefault();
      if (state.screen === 'levelup' && !e.repeat && code.indexOf('Arrow') === 0) {
        e.preventDefault();
        moveCardFocus(code === 'ArrowLeft' || code === 'ArrowUp' ? -1 : 1);
      }
      return;
    }
    if ((code === 'Enter' || code === 'NumpadEnter' || code === 'Space') && e.repeat) {
      e.preventDefault(); // never auto-repeat through menus
      return;
    }
    if (e.repeat) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (code === 'KeyM') { toggleMute(); return; }
    if (code === 'KeyP' || code === 'Escape' || key === 'escape') {
      const esc = code === 'Escape' || key === 'escape';
      if (state.screen === 'playing') { e.preventDefault(); pauseGame(); }
      else if (state.screen === 'paused') {
        e.preventDefault();
        if (esc && ui.confirmKind) closeConfirm();
        else resumeGame();
      } else if (state.screen === 'howto' && esc) { e.preventDefault(); closeHowto(); }
      return;
    }
    if (state.screen === 'levelup') {
      let n = 0;
      if (code === 'Digit1' || code === 'Numpad1' || key === '1') n = 1;
      else if (code === 'Digit2' || code === 'Numpad2' || key === '2') n = 2;
      else if (code === 'Digit3' || code === 'Numpad3' || key === '3') n = 3;
      if (n) { e.preventDefault(); pickOffer(n - 1); }
      return;
    }
    if (state.screen === 'dawn' && (code === 'Enter' || code === 'NumpadEnter' || code === 'Space')) {
      const t = e.target;
      if (!(t && t.tagName === 'BUTTON')) { e.preventDefault(); startNextNight(); }
      return;
    }
    if (state.screen === 'playing' && code === 'Space') e.preventDefault();
  }

  function onKeyUp(e) {
    const code = codeOf(e);
    Input.keys.delete(code);
  }

  function onPointerDown(e) {
    Sound.init();
    if (state.screen !== 'playing' || state.phase === 'dying') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const j = Input.joy;
    if (j.active) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    j.active = true;
    j.id = e.pointerId;
    j.bx = j.kx = e.clientX;
    j.by = j.ky = e.clientY;
  }
  function onPointerMove(e) {
    const j = Input.joy;
    if (!j.active || e.pointerId !== j.id) return;
    e.preventDefault();
    j.kx = e.clientX;
    j.ky = e.clientY;
    // the base trails the finger when dragged far past the rim
    const dx = j.kx - j.bx, dy = j.ky - j.by;
    const d = Math.hypot(dx, dy);
    const lim = JOY.max * 1.5;
    if (d > lim) {
      j.bx += (dx / d) * (d - lim);
      j.by += (dy / d) * (d - lim);
    }
  }
  function onPointerUp(e) {
    const j = Input.joy;
    if (j.active && e.pointerId === j.id) Input.releasePointer();
  }

  function bindInput() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => {
      Input.clearKeys();
      Input.releasePointer();
      if (state.screen === 'playing') pauseGame();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        Input.clearKeys();
        Input.releasePointer();
        if (state.screen === 'playing') pauseGame();
      }
    });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('lostpointercapture', onPointerUp);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('pointerdown', () => Sound.init(), true);
    document.addEventListener('touchmove', e => {
      if (state.screen === 'playing' && e.cancelable) e.preventDefault();
    }, { passive: false });
    document.addEventListener('gesturestart', e => e.preventDefault());
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    try {
      if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(canvas);
    } catch (e) { /* ignore */ }
  }

  // =========================================================================
  // 14. MAIN LOOP & BOOT
  // =========================================================================

  let lastT = 0;
  let acc = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    if (!lastT) lastT = now;
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (!(dt >= 0)) dt = 0;
    dt = Math.min(dt, SIM.maxFrame);
    if (state.screen === 'playing') {
      acc += dt * timeScale;
      const maxSteps = Math.ceil(SIM.maxSteps * Math.max(1, timeScale));
      let steps = 0;
      while (acc >= SIM.step && steps < maxSteps && state.screen === 'playing') {
        update(SIM.step);
        acc -= SIM.step;
        steps++;
      }
      if (steps >= maxSteps) acc = Math.min(acc, SIM.step);
      if (state.screen !== 'playing') acc = 0;
    } else {
      acc = 0;
      if (state.screen === 'title' || state.screen === 'howto') updateAttract(dt);
      else if (state.screen === 'dawn' || state.screen === 'victory' || state.screen === 'gameover') updateCosmetic(dt);
    }
    render(dt);
    updateHud();
    updateBannerToast(dt);
  }

  let started = false;
  function start(data) {
    if (started) return;
    started = true;
    data = data || {};
    if (!loadPrefs()) {
      const best = data.best;
      if (best && typeof best === 'object') {
        prefs.bestScore = Math.max(0, Number(best.score) || 0);
        prefs.bestNight = clamp(Number(best.night) || 0, 0, NIGHTS.total);
      } else if (typeof best === 'number') {
        prefs.bestScore = Math.max(0, best);
      }
      if (typeof data.muted === 'boolean') prefs.muted = data.muted;
    }
    Sound.setMuted(prefs.muted);

    canvas = $('game');
    ctx = canvas.getContext('2d');
    dark = document.createElement('canvas');
    dctx = dark.getContext('2d');
    cacheDom();
    bindUi();
    bindInput();
    resize();
    initRenderAssets();
    setupAttract();
    showOverlay('ov-title');
    updateRecordLine();
    syncSoundUi();

    try {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          canvasFont = '"Alegreya Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
        }, () => {});
      }
    } catch (e) { /* fonts are optional */ }

    try {
      window.claude?.hot?.snapshot?.(() => ({ best: { score: prefs.bestScore, night: prefs.bestNight }, muted: prefs.muted }));
    } catch (e) { /* not in the artifact viewer */ }

    requestAnimationFrame(frame);
  }

  function boot() {
    let hot = null;
    try { hot = window.claude?.hot ?? null; } catch (e) { hot = null; }
    if (hot && typeof hot.ready === 'function') {
      try { hot.ready(start); } catch (e) { start({}); }
      // never hang if the host does not call back
      setTimeout(() => { if (!started) start((hot && hot.data) || {}); }, 1500);
    } else {
      start((hot && hot.data) || {});
    }
  }

  // =========================================================================
  // 15. PUBLIC TEST API / DEBUG API
  // =========================================================================

  function getState() {
    const p = state.player;
    const b = state.boss;
    return {
      screen: state.screen,
      phase: state.phase,
      night: state.night,
      nightTimeLeft: state.isBossNight ? null : Math.max(0, state.nightDur - state.nightT),
      nightElapsed: state.nightT,
      isBossNight: state.isBossNight,
      bossAlive: !!(b && !b.dead),
      bossHp: b && !b.dead ? Math.max(0, b.hp) : 0,
      bossPos: b && !b.dead ? { x: b.x, y: b.y } : null,
      level: state.level,
      xp: state.xp,
      xpToNext: xpToNext(state.level),
      hp: p.hp,
      maxHp: p.maxHp,
      player: { x: p.x, y: p.y },
      enemies: state.enemies.length,
      projectiles: state.shots.length + state.inks.length,
      kills: state.kills,
      score: currentScore(),
      paused: state.screen === 'paused',
      pendingLevelUps: state.pendingLevelUps,
      upgrades: Object.assign({}, state.upgrades),
      damageTaken: Object.assign({}, state.damageTaken),
      muted: prefs.muted,
      timeScale,
    };
  }

  const QF = { getState };
  window.QF = QF;

  let debugEnabled = false;
  try { debugEnabled = String(window.location.hash || '').indexOf('debug') >= 0; } catch (e) { debugEnabled = false; }
  if (debugEnabled) {
    QF.debug = {
      setNight(n) {
        n = clamp(Math.round(Number(n) || 1), 1, NIGHTS.total);
        if (!state.runActive) newRun();
        state.night = n;
        state.embers.length = 0;
        state.particles.length = 0;
        state.texts.length = 0;
        state.pendingLevelUps = 0;
        beginNight();
      },
      skipNight() {
        if (state.phase !== 'night' || !state.runActive) return;
        if (state.isBossNight && !state.bossDefeated) {
          if (state.boss && !state.boss.dead) state.boss.dead = true;
          state.boss = null;
          state.bossKills++;
        }
        endNight();
      },
      godMode(on) { state.god = !!on; },
      addXp(n) { gainXp(Math.max(0, Number(n) || 0)); },
      setHp(n) {
        const p = state.player;
        p.hp = clamp(Number(n) || 0, 0, p.maxHp);
        if (p.hp <= 0) {
          if (state.god) p.hp = 1;
          else if (state.runActive && (state.phase === 'night' || state.phase === 'sunrise')) startDying();
        }
      },
      grantUpgrade(id) {
        if (UPGRADE_BY_ID[id]) applyUpgrade(id);
      },
      killAll() {
        for (const e of state.enemies) if (!e.dead) killEnemy(e);
        compactEnemies();
      },
      damageBoss(n) {
        const b = state.boss;
        if (!b || b.dead) return;
        b.emerge = 1;
        hurtBoss(Math.max(0, Number(n) || 0), false);
      },
      spawn(type, count) {
        if (!ENEMIES[type]) return;
        spawnAtRing(type, Math.max(1, Math.min(200, Math.round(Number(count) || 1))));
      },
      setTimeScale(x) { timeScale = clamp(Number(x) || 1, 0.1, 20); },
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
