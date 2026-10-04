// Color palettes, color math and deterministic hashing used by the renderer.
// Pure module (no DOM) so it can be unit-tested in Node.
//
// Rule from docs/design/visuals.md: the faction owns the hull material, the
// team owns everything that emits light (engines, cores, lights, stripes,
// shields). Team colors come from shared/constants.js TEAM_COLORS; they are
// duplicated here as a fallback so this module stays import-free.

export const TEAM_FALLBACK = [
  { main: '#3fb6ff', dim: '#1a5f8f', glow: '#bfe9ff' },
  { main: '#ff7a3d', dim: '#8f3a1a', glow: '#ffd2b8' },
];

/** Faction materials (hull tones + faction accent). */
export const FACTION_PALETTES = {
  terran: {
    hullDark: '#2a3240', hullMid: '#4b5665', hullLight: '#8a96a6', hullEdge: '#c9d3df',
    accent: '#d9a21b', panelLine: '#1a2029', canopyA: '#9fd8ff', canopyB: '#143a5a',
    debris: '#4b5665', spark: '#ffd27a', spark2: '#ff6a3d', smoke: '#9aa3ad',
  },
  vorrax: {
    hullDark: '#2e1a24', hullMid: '#5a2d3a', hullLight: '#9c4d4f', hullEdge: '#d98d6a',
    accent: '#7dd957', panelLine: '#1c0f14', membrane: 'rgba(220,150,170,0.35)', membraneVein: '#d98d6a',
    debris: '#9c4d4f', spark: '#d98d6a', spark2: '#7dd957', smoke: '#6a4a3a',
  },
  lumen: {
    hullDark: '#3b2a7a', hullMid: '#7c5cff', hullLight: '#d7ccff', hullEdge: '#ffffff',
    accent: '#b8f0ff', panelLine: '#2a1c5a', inner: '#b8f0ff', facet: 'rgba(255,255,255,0.18)',
    chromaA: '#ff5aa0', chromaB: '#5affd0',
    debris: '#d7ccff', spark: '#ffffff', spark2: '#7c5cff', smoke: '#5a4a9a',
  },
  ferrix: {
    hullDark: '#15201f', hullMid: '#2f4448', hullLight: '#5a7c80', hullEdge: '#8fc4b8',
    accent: '#9bffd6', panelLine: '#0c1213', cellOff: '#1a2426',
    debris: '#263538', spark: '#9bffd6', spark2: '#7fb3a8', smoke: '#3a4a4c',
  },
};

export const FACTION_IDS = Object.keys(FACTION_PALETTES);

/** Emissive colors per weapon type (mixed 30% with the team color at use). */
export const WEAPON_COLORS = {
  kinetic: '#ffe9a8', railgun: '#cfe8ff', flak: '#ffd27a', laser: '#d7ccff', plasma: '#9c7cff',
  missile: '#ffb347', torpedo: '#ff8a5c', bio: '#7dd957', ion: '#8fe3ff',
};

const paletteCache = new Map();

/**
 * Resolve the full palette for a (faction, team) pair. Cached.
 * @param {string} faction
 * @param {number} team 0|1
 * @param {{main:string,dim:string,glow:string}[]} [teamColors]
 */
export function palette(faction, team, teamColors = TEAM_FALLBACK) {
  const key = faction + '|' + team;
  let p = paletteCache.get(key);
  if (p) return p;
  const f = FACTION_PALETTES[faction] || FACTION_PALETTES.terran;
  const t = teamColors[team] || teamColors[0] || TEAM_FALLBACK[0];
  p = {
    ...f,
    faction,
    team: t.main, teamDim: t.dim, teamGlow: t.glow,
    teamA: rgba(t.main, 0.5), teamFaint: rgba(t.main, 0.25),
    white: '#ffffff', black: '#000000', dark: '#05070c',
  };
  paletteCache.set(key, p);
  return p;
}

// ---------------------------------------------------------------------------
// Color math
// ---------------------------------------------------------------------------

const rgbCache = new Map();

/**
 * Parse '#rgb', '#rrggbb', 'rgb()' / 'rgba()' into [r,g,b,a].
 * @param {string} c
 * @returns {number[]}
 */
export function parseColor(c) {
  let v = rgbCache.get(c);
  if (v) return v;
  if (c[0] === '#') {
    const h = c.slice(1);
    if (h.length === 3) v = [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 1];
    else v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  } else {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(',').map((s) => parseFloat(s));
      v = [parts[0] | 0, parts[1] | 0, parts[2] | 0, parts.length > 3 ? parts[3] : 1];
    } else v = [255, 255, 255, 1];
  }
  rgbCache.set(c, v);
  return v;
}

/** @returns {string} 'rgba(r,g,b,a)' */
export function rgba(c, a) {
  const v = parseColor(c);
  return `rgba(${v[0]},${v[1]},${v[2]},${a})`;
}

const mixCache = new Map();

/**
 * Mix two colors: t=0 → a, t=1 → b. Returns '#rrggbb'. Cached.
 */
export function mix(a, b, t) {
  const key = a + b + t;
  let r = mixCache.get(key);
  if (r) return r;
  const va = parseColor(a), vb = parseColor(b);
  const c = [0, 1, 2].map((i) => Math.round(va[i] + (vb[i] - va[i]) * t));
  r = '#' + c.map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
  mixCache.set(key, r);
  return r;
}

/** Lighten (t>0) or darken (t<0) a color. */
export function shade(c, t) {
  return t >= 0 ? mix(c, '#ffffff', t) : mix(c, '#000000', -t);
}

/** Weapon emissive color for a weapon type and team (70% weapon / 30% team). */
export function weaponColor(type, teamMain) {
  return mix(WEAPON_COLORS[type] || '#ffffff', teamMain, 0.3);
}

// ---------------------------------------------------------------------------
// Deterministic hashing (sprite decals, star fields, twinkles)
// ---------------------------------------------------------------------------

/** 32-bit FNV-1a of a string. */
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer hash mixing (xorshift-mul). */
export function hashInt(a, b = 0, c = 0) {
  let h = (a | 0) * 0x9e3779b1 + (b | 0) * 0x85ebca77 + (c | 0) * 0xc2b2ae3d;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Deterministic float in [0,1) from integer inputs. */
export function hash01(a, b = 0, c = 0) {
  return hashInt(a, b, c) / 4294967296;
}

/**
 * Small fast PRNG (mulberry32) for visual-only randomness.
 * @param {number} seed
 */
export function makeRand(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  return r;
}

/** 1D value noise in [-1,1], smooth, periodic-ish. */
export function noise1(t, seed = 0) {
  const i = Math.floor(t), f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hash01(i, seed) * 2 - 1, b = hash01(i + 1, seed) * 2 - 1;
  return a + (b - a) * u;
}

export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (u) => 1 - (1 - u) * (1 - u);
export const easeIn = (u) => u * u;
export const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));
