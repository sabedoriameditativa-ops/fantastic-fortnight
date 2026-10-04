// Procedural ship sprite definitions for all 32 catalog classes.
// Pure data (no DOM, no imports) so it can be validated in Node tests and
// drawn in the browser by client/battle/sprites.js.
//
// Design space: 100 x 100 units, origin at the ship center, nose pointing +x.
// `size` is the visual length of the ship in world units (design unit = size/100).
// Polygons with `mirror: true` are listed for y <= 0 only and mirrored on y = 0.
// Overhangs beyond +-50 are allowed up to +-62 (mandibles, spines, shards).
//
// Layer kinds (see sprites.js for rendering):
//   poly    { pts, mirror, fill, stroke, lw, alpha, smooth, z, panels, rivets, plates, specular,
//             veins, facets, cells, traces, hazard, live }
//   ellipse { x, y, rx, ry, mirror, fill, stroke, lw, alpha, rot }
//   ring    { x, y, r, lw, color, alpha, segments, gap, spin, from, to, mirror }   spin != 0 → drawn live
//   rects   { items: [[x,y,w,h]...], fill, alpha, mirror }
//   line    { pts, stroke, lw, alpha, mirror, dash }
//   light   { x, y, r, color, blink, strobe, mirror }                              live
//   spot    { x, y, r, color, mirror, pulse, phase }                               live (static dim copy cached)
//   core    { x, y, r, color, pulse: {amp,hz}, glow }                              live
//   orbit   { n, R, w, squash, len, fill, alpha, phase }                            live
//   trace   { pts, mirror }  circuit trace with running dot                         live (static copy cached)
// Fill names: 'grad:hull' | 'grad:canopy' | 'membrane' | 'crystal' | 'cells' | palette color name.
// Engines: { x, y, w, kind?: 'flame'|'spore'|'light'|'pixel' } (mirrored manually; kind defaults by faction).
// Turrets: { x, y, kind } muzzle positions for flashes/beams, mirrored manually.

const T = 'terran', V = 'vorrax', L = 'lumen', F = 'ferrix';

const poly = (pts, o = {}) => ({ kind: 'poly', pts, mirror: true, fill: 'grad:hull', stroke: 'hullEdge', lw: 1.2, ...o });
const line = (pts, o = {}) => ({ kind: 'line', pts, mirror: true, stroke: 'hullEdge', lw: 1.2, ...o });
const ellipse = (x, y, rx, ry, o = {}) => ({ kind: 'ellipse', x, y, rx, ry, mirror: true, fill: 'team', ...o });
const ring = (x, y, r, o = {}) => ({ kind: 'ring', x, y, r, lw: 1.5, color: 'team', mirror: false, ...o });
const light = (x, y, r, o = {}) => ({ kind: 'light', x, y, r, color: 'team', blink: 1, mirror: true, ...o });
const spot = (x, y, r, o = {}) => ({ kind: 'spot', x, y, r, color: 'team', mirror: true, pulse: 3, ...o });
const core = (x, y, r, o = {}) => ({ kind: 'core', x, y, r, color: 'team', pulse: { amp: 0.15, hz: 4 }, glow: 3, ...o });
const orbit = (n, R, w, o = {}) => ({ kind: 'orbit', n, R, w, squash: 0.45, len: 5, fill: 'team', alpha: 0.7, ...o });
const rects = (items, o = {}) => ({ kind: 'rects', items, mirror: true, fill: 'hullDark', ...o });
const trace = (pts, o = {}) => ({ kind: 'trace', pts, mirror: true, ...o });
const stripe = (pts, o = {}) => ({ kind: 'poly', pts, mirror: true, fill: 'team', alpha: 0.9, ...o });

/** Regular polygon points (hexagon by default) centered at (x,y). */
export function regularPts(x, y, r, n = 6, rot = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  return out;
}
const hex = (x, y, r, o = {}) => ({ kind: 'poly', pts: regularPts(x, y, r, 6, 0), mirror: false, fill: 'cells', stroke: 'hullEdge', lw: 1, ...o });

/** Rotate a point list by angle (radians) around the origin. */
function rot(pts, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

// ---------------------------------------------------------------------------
// Terran — angular steel wedges, panel lines, hazard stripes, rectangular nozzles
// ---------------------------------------------------------------------------

const TERRAN = {
  ter_vespa: {
    id: 'ter_vespa', faction: T, size: 18, style: { edge: 'sharp' },
    layers: [
      poly([[-18, -4], [-30, -22], [-20, -24], [-4, -8]], { z: -1 }),
      poly([[-40, 0], [-36, -7], [-10, -9], [20, -6], [48, 0]], { panels: 2 }),
      poly([[6, 0], [8, -3], [20, -3], [28, 0]], { fill: 'grad:canopy', lw: 0.8 }),
      stripe([[26, -5], [30, -2], [33, -5], [29, -7]]),
      light(-22, -24, 1.5),
    ],
    engines: [{ x: -40, y: -4, w: 4 }, { x: -40, y: 4, w: 4 }],
    turrets: [{ x: 30, y: -3, kind: 'light' }, { x: 30, y: 3, kind: 'light' }],
    anim: [],
    damage: { sparkPoints: [[-10, -4], [10, 3]] },
  },
  ter_falcao: {
    id: 'ter_falcao', faction: T, size: 32, style: { edge: 'sharp' },
    layers: [
      poly([[-32, -12], [-44, -30], [-34, -32], [-16, -14]], { z: -1 }),
      poly([[-44, 0], [-42, -8], [-30, -12], [-6, -13], [24, -9], [46, -3], [50, 0]], { panels: 3, rivets: true }),
      poly([[-20, -13], [-20, -21], [8, -21], [14, -13]], { fill: 'hullMid', lw: 1, hazard: true }),
      rects([[-16, -20, 4, 3], [-9, -20, 4, 3], [-2, -20, 4, 3]], { fill: 'hullDark' }),
      poly([[10, 0], [12, -4], [26, -4], [34, 0]], { fill: 'grad:canopy', lw: 0.8 }),
      stripe([[30, -6], [34, -2], [37, -4], [33, -8]]),
      stripe([[36, -4], [40, -1], [43, -3], [39, -6]]),
      light(-38, -32, 1.5),
    ],
    engines: [{ x: -44, y: -5, w: 5 }, { x: -44, y: 5, w: 5 }],
    turrets: [{ x: 6, y: -7, kind: 'light' }, { x: 6, y: 7, kind: 'light' }, { x: -4, y: -17, kind: 'missile' }, { x: -4, y: 17, kind: 'missile' }],
    anim: [],
    damage: { sparkPoints: [[-20, -8], [12, 6], [-30, 10]] },
  },
  ter_lanca: {
    id: 'ter_lanca', faction: T, size: 30, style: { edge: 'sharp' },
    layers: [
      poly([[-40, -6], [-48, -20], [-42, -22], [-30, -8]], { z: -1 }),
      poly([[-46, 0], [-44, -6], [-20, -8], [30, -6], [50, 0]], { panels: 2 }),
      poly([[-30, -8], [-30, -12], [20, -12], [26, -8]], { fill: 'hullDark', lw: 1 }),
      rects([[22, -11, 5, 2]], { fill: 'accent', alpha: 0.9 }),
      poly([[0, 0], [2, -3], [14, -3], [20, 0]], { fill: 'grad:canopy', lw: 0.8 }),
      stripe([[36, -4], [40, -1], [44, -3], [40, -5]]),
      light(-44, -22, 1.2),
    ],
    engines: [{ x: -46, y: -3, w: 3 }, { x: -46, y: 3, w: 3 }],
    turrets: [{ x: 28, y: -10, kind: 'torpedo' }, { x: 28, y: 10, kind: 'torpedo' }],
    anim: [],
    damage: { sparkPoints: [[-14, -5], [10, 4]] },
  },
  ter_artemis: {
    id: 'ter_artemis', faction: T, size: 50, style: { edge: 'sharp' },
    layers: [
      poly([[-36, -14], [-44, -30], [-34, -32], [-22, -16]], { z: -1 }),
      poly([[-48, 0], [-46, -9], [-34, -14], [-4, -16], [26, -12], [44, -5], [50, 0]], { panels: 4, rivets: true }),
      poly([[-6, -16], [-4, -22], [18, -22], [22, -16]], { fill: 'hullMid', lw: 1 }),
      poly([[-30, 0], [-30, -8], [-10, -10], [14, -9], [20, 0]], { fill: 'hullLight', lw: 1, z: 1, panels: 2 }),
      poly([[-18, 0], [-18, -4], [-6, -5], [-2, 0]], { fill: 'grad:canopy', lw: 0.8, z: 2 }),
      poly([[26, -10], [28, -12], [40, -6], [42, -4]], { fill: 'hullMid', lw: 1, hazard: true }),
      stripe([[-44, -8], [-40, -8], [-36, -13], [-40, -13]]),
      light(-40, -32, 1.5),
      light(46, -3, 1.2, { blink: 0.5 }),
    ],
    engines: [{ x: -48, y: -5, w: 6 }, { x: -48, y: 5, w: 6 }],
    turrets: [{ x: -20, y: -12, kind: 'flak' }, { x: -20, y: 12, kind: 'flak' }, { x: 8, y: -19, kind: 'flak' }, { x: 8, y: 19, kind: 'flak' }, { x: 30, y: 0, kind: 'light' }],
    anim: [],
    damage: { sparkPoints: [[-20, -10], [10, 8], [30, -4]] },
  },
  ter_orion: {
    id: 'ter_orion', faction: T, size: 54, style: { edge: 'sharp' },
    layers: [
      poly([[-50, 0], [-48, -10], [-36, -14], [-8, -15], [30, -11], [48, -4], [50, 0]], { panels: 4, rivets: true }),
      poly([[-28, -15], [-26, -23], [-2, -23], [0, -15]], { fill: 'hullMid', lw: 1 }),
      rects([[-24, -22, 4, 4], [-18, -22, 4, 4], [-12, -22, 4, 4], [-6, -22, 4, 4]], { fill: 'hullDark' }),
      poly([[-20, 0], [-20, -7], [0, -9], [16, -6], [22, 0]], { fill: 'hullLight', lw: 1, z: 1, panels: 2 }),
      poly([[-6, 0], [-6, -3], [6, -4], [10, 0]], { fill: 'grad:canopy', lw: 0.8, z: 2 }),
      poly([[30, -9], [32, -11], [44, -5], [46, -3]], { fill: 'hullMid', lw: 1, hazard: true }),
      stripe([[-46, -9], [-42, -9], [-38, -13], [-42, -13]]),
      stripe([[36, -7], [40, -3], [43, -5], [39, -9]]),
      light(-34, -14, 1.3),
    ],
    engines: [{ x: -50, y: -5, w: 6 }, { x: -50, y: 5, w: 6 }],
    turrets: [{ x: -12, y: -10, kind: 'medium' }, { x: -12, y: 10, kind: 'medium' }, { x: 26, y: 0, kind: 'medium' }, { x: -14, y: -20, kind: 'missile' }, { x: -14, y: 20, kind: 'missile' }],
    anim: [],
    damage: { sparkPoints: [[-30, -8], [14, 6], [34, -2]] },
  },
  ter_hercules: {
    id: 'ter_hercules', faction: T, size: 78, style: { edge: 'sharp' },
    layers: [
      poly([[-50, -8], [-50, -13], [-42, -15], [-38, -12]], { fill: 'hullDark', lw: 1, z: -1 }),
      poly([[-50, 0], [-48, -10], [-40, -15], [-20, -18], [14, -18], [36, -12], [48, -5], [50, 0]], { panels: 5, rivets: true }),
      poly([[14, -12], [16, -16], [36, -10], [40, -6]], { fill: 'hullMid', lw: 1, hazard: true }),
      rects([[36, -11, 6, 3], [30, -14, 6, 3]], { fill: 'hullDark' }),
      poly([[-28, 0], [-28, -9], [-14, -12], [6, -12], [12, -7], [16, 0]], { fill: 'hullLight', lw: 1, z: 1, panels: 3 }),
      poly([[-12, 0], [-12, -5], [-2, -6], [2, 0]], { fill: 'grad:canopy', lw: 0.8, z: 2 }),
      stripe([[-46, -10], [-42, -10], [-38, -15], [-42, -15]]),
      stripe([[40, -6], [44, -3], [46, -4], [42, -8]]),
      light(-24, -18, 1.4),
      light(46, -3, 1.2, { blink: 0.5 }),
    ],
    engines: [{ x: -50, y: -5, w: 6 }, { x: -50, y: 5, w: 6 }, { x: -50, y: -11, w: 3 }, { x: -50, y: 11, w: 3 }],
    turrets: [{ x: -22, y: -13, kind: 'heavy' }, { x: -22, y: 13, kind: 'heavy' }, { x: 6, y: -14, kind: 'heavy' }, { x: 6, y: 14, kind: 'heavy' }, { x: 38, y: -9, kind: 'torpedo' }, { x: 38, y: 9, kind: 'torpedo' }],
    anim: [],
    damage: { sparkPoints: [[-30, -10], [0, 12], [26, -6], [-10, -16]] },
    shieldR: 0.6,
  },
  ter_atlas: {
    id: 'ter_atlas', faction: T, size: 116, style: { edge: 'sharp' },
    layers: [
      poly([[-50, 0], [-50, -12], [-44, -18], [-30, -22], [20, -22], [40, -16], [50, -6], [50, 0]], { panels: 6, rivets: true }),
      poly([[-30, -14], [-30, -21], [14, -21], [18, -14]], { fill: 'hullDark', lw: 1 }),
      rects([[-28, -20, 44, 5]], { fill: 'teamDim', alpha: 0.6 }),
      rects([[-26, -19, 4, 3], [-18, -19, 4, 3], [-10, -19, 4, 3], [-2, -19, 4, 3], [6, -19, 4, 3]], { fill: 'team', alpha: 0.5 }),
      poly([[-40, 0], [-40, -6], [-24, -8], [-8, -6], [-4, 0]], { fill: 'hullLight', lw: 1, z: 1, panels: 2 }),
      poly([[-32, 0], [-32, -3], [-20, -4], [-16, 0]], { fill: 'grad:canopy', lw: 0.8, z: 2 }),
      poly([[22, -14], [24, -18], [40, -12], [44, -8]], { fill: 'hullMid', lw: 1, hazard: true }),
      line([[-46, -10], [44, -10]], { stroke: 'panelLine', lw: 0.8, alpha: 0.6 }),
      stripe([[-48, -12], [-44, -12], [-40, -17], [-44, -17]]),
      stripe([[42, -10], [46, -6], [48, -7], [44, -12]]),
      light(-46, -17, 1.6),
      light(48, -4, 1.4, { blink: 0.5 }),
      light(-10, -22, 1.2, { blink: 2 }),
    ],
    engines: [{ x: -50, y: -5, w: 7 }, { x: -50, y: 5, w: 7 }, { x: -50, y: -14, w: 3 }, { x: -50, y: 14, w: 3 }],
    turrets: [{ x: -36, y: -15, kind: 'pd' }, { x: -36, y: 15, kind: 'pd' }, { x: 30, y: -14, kind: 'pd' }, { x: 30, y: 14, kind: 'pd' }, { x: 36, y: 0, kind: 'pd' }],
    anim: [{ type: 'strobe', x: -20, y: 0, hz: 0.5 }],
    damage: { sparkPoints: [[-34, -12], [0, 16], [30, -10], [-10, -8]] },
    shieldR: 0.6,
    hangar: { x: -6, y: -18 },
  },
  ter_prometeu: {
    id: 'ter_prometeu', faction: T, size: 170, style: { edge: 'sharp' },
    layers: [
      poly([[-50, -8], [-50, -12], [-44, -14], [-40, -12]], { fill: 'hullDark', lw: 1, z: -1 }),
      poly([[-50, 0], [-48, -8], [-42, -12], [-30, -11], [-22, -17], [12, -17], [32, -12], [46, -6], [50, 0]], { panels: 7, rivets: true }),
      poly([[-6, -17], [-6, -21], [18, -21], [22, -17]], { fill: 'hullDark', lw: 1 }),
      rects([[-4, -20, 24, 3]], { fill: 'teamDim', alpha: 0.7 }),
      poly([[20, -11], [22, -14], [40, -8], [44, -5]], { fill: 'hullMid', lw: 1, hazard: true }),
      poly([[-26, 0], [-26, -7], [-18, -10], [4, -10], [10, -6], [14, 0]], { fill: 'hullLight', lw: 1, z: 1, panels: 3, rivets: true }),
      poly([[-12, 0], [-12, -4], [-4, -5], [0, 0]], { fill: 'grad:canopy', lw: 0.8, z: 2 }),
      poly([[30, -2], [30, -4], [50, -2], [52, 0]], { fill: 'hullMid', lw: 0.8, z: 1 }),
      line([[-20, -14], [26, -14]], { stroke: 'panelLine', lw: 0.8, alpha: 0.7 }),
      stripe([[30, -11], [34, -7], [36, -8], [32, -12]]),
      stripe([[36, -9], [40, -5], [42, -6], [38, -10]]),
      stripe([[42, -7], [45, -4], [47, -5], [44, -8]]),
      stripe([[-48, -7], [-44, -7], [-40, -11], [-44, -11]]),
      light(-30, -17, 1.6),
      light(48, 0, 1.4, { blink: 0.5, mirror: false }),
      light(-8, -21, 1.2, { blink: 2 }),
    ],
    engines: [{ x: -50, y: -4, w: 5 }, { x: -50, y: 4, w: 5 }, { x: -50, y: -10, w: 3 }, { x: -50, y: 10, w: 3 }, { x: -50, y: 0, w: 6 }],
    turrets: [{ x: -20, y: -12, kind: 'heavy' }, { x: -20, y: 12, kind: 'heavy' }, { x: 0, y: -14, kind: 'heavy' }, { x: 0, y: 14, kind: 'heavy' }, { x: 22, y: -9, kind: 'medium' }, { x: 22, y: 9, kind: 'medium' }, { x: 52, y: 0, kind: 'spinal' }, { x: -36, y: -10, kind: 'missile' }, { x: -36, y: 10, kind: 'missile' }],
    anim: [{ type: 'strobe', x: 48, y: 0, hz: 0.5 }],
    damage: { sparkPoints: [[-30, -8], [0, 14], [26, -8], [-10, -14], [36, 4]] },
    shieldR: 0.6,
    hangar: { x: 6, y: -19 },
  },
};

// ---------------------------------------------------------------------------
// Vorrax — smooth chitin segments, membranes, legs, bioluminescent spots
// ---------------------------------------------------------------------------

const vpoly = (pts, o = {}) => poly(pts, { fill: 'grad:hull', stroke: 'hullEdge', lw: 1.1, alpha: 1, plates: 4, specular: true, ...o });
const legs = (segs, o = {}) => ({ kind: 'line', pts: segs, mirror: true, stroke: 'hullEdge', lw: 1.3, multi: true, ...o });
const wing = (pts, o = {}) => poly(pts, { fill: 'membrane', stroke: 'membraneVein', lw: 0.8, veins: 4, z: -2, smooth: true, ...o });

const VORRAX = {
  vor_larva: {
    id: 'vor_larva', faction: V, size: 18, style: { edge: 'smooth' },
    layers: [
      vpoly([[30, 0], [26, -6], [14, -7], [8, -4]], { plates: 2 }),
      vpoly([[10, -6], [-4, -8], [-16, -6], [-12, -2]]),
      vpoly([[-12, -5], [-30, -7], [-44, -4], [-48, 0]], { plates: 3 }),
      poly([[28, -3], [38, -6], [40, -2], [32, -1]], { fill: 'hullEdge', stroke: null, smooth: false, alpha: 0.9 }),
      spot(-24, -3, 1.5),
      spot(-36, -2, 1.2, { phase: 1 }),
      spot(22, -3, 1.3, { pulse: 0, phase: 2 }),
    ],
    engines: [{ x: -48, y: 0, w: 3, kind: 'spore' }],
    turrets: [{ x: 32, y: 0, kind: 'acid' }],
    anim: [{ type: 'breathe', amp: 0.04, hz: 2.5 }],
    damage: { sparkPoints: [[-10, -3], [10, 2]] },
  },
  vor_zangao: {
    id: 'vor_zangao', faction: V, size: 32, style: { edge: 'smooth' },
    layers: [
      wing([[-6, -10], [-24, -30], [-2, -34], [14, -14]]),
      legs([[[-2, -10], [-10, -20], [-4, -26]], [[6, -9], [0, -20], [8, -24]]]),
      vpoly([[32, 0], [28, -7], [14, -9], [8, -5]], { plates: 2 }),
      vpoly([[10, -9], [-4, -13], [-18, -9], [-14, -2]]),
      vpoly([[-14, -7], [-30, -11], [-44, -6], [-48, 0]], { plates: 3 }),
      poly([[30, -5], [40, -9], [44, -3], [34, -2]], { fill: 'hullEdge', stroke: null, smooth: false, alpha: 0.9 }),
      spot(24, -4, 1.6, { pulse: 0 }),
      spot(-22, -6, 1.5),
      spot(-34, -4, 1.2, { phase: 1 }),
      spot(-42, -2, 1, { phase: 2 }),
    ],
    engines: [{ x: -48, y: 0, w: 4, kind: 'spore' }],
    turrets: [{ x: 34, y: 0, kind: 'plasma' }],
    anim: [{ type: 'breathe', amp: 0.03, hz: 2.5 }, { type: 'flex', hz: 8 }],
    damage: { sparkPoints: [[-20, -6], [8, 4]] },
  },
  vor_cuspidor: {
    id: 'vor_cuspidor', faction: V, size: 30, style: { edge: 'smooth' },
    layers: [
      legs([[[0, -8], [-6, -18], [2, -22]], [[-14, -12], [-24, -24], [-16, -28]], [[-26, -14], [-38, -22], [-34, -28]]]),
      vpoly([[36, 0], [32, -5], [20, -6], [14, -3]], { plates: 2 }),
      vpoly([[16, -4], [6, -8], [-8, -8], [-10, -3]]),
      vpoly([[-8, -10], [-26, -18], [-44, -12], [-50, 0]], { plates: 5 }),
      ellipse(-28, 0, 10, 7, { fill: 'accent', alpha: 0.5, mirror: false, stroke: 'accent', lw: 0.6 }),
      ellipse(-28, 0, 5, 3.5, { fill: 'white', alpha: 0.35, mirror: false, stroke: null }),
      spot(28, -3, 1.4, { pulse: 0 }),
      spot(-14, -7, 1.3),
      spot(-36, -9, 1.2, { phase: 2 }),
    ],
    engines: [{ x: -50, y: 0, w: 4, kind: 'spore' }],
    turrets: [{ x: 36, y: 0, kind: 'acid' }],
    anim: [{ type: 'breathe', amp: 0.05, hz: 1.8 }],
    damage: { sparkPoints: [[-20, -8], [10, 3]] },
  },
  vor_carrapato: {
    id: 'vor_carrapato', faction: V, size: 48, style: { edge: 'smooth' },
    layers: [
      legs([[[10, -14], [24, -30], [34, -34]], [[0, -20], [4, -36], [14, -42]], [[-12, -20], [-18, -36], [-12, -44]], [[-24, -16], [-38, -30], [-36, -40]]], { lw: 2 }),
      vpoly([[20, 0], [16, -16], [-6, -22], [-30, -18], [-40, 0]], { plates: 6 }),
      vpoly([[12, 0], [10, -10], [-6, -14], [-26, -11], [-32, 0]], { fill: 'hullLight', stroke: null, alpha: 0.35, plates: 0, specular: false }),
      vpoly([[36, 0], [32, -6], [20, -8], [14, -3]], { plates: 2 }),
      poly([[30, -6], [44, -14], [50, -8], [40, -3]], { fill: 'hullEdge', stroke: 'hullDark', lw: 0.6, smooth: false, alpha: 0.95 }),
      spot(28, -4, 1.8, { pulse: 0 }),
      spot(-6, -10, 1.6),
      spot(-20, -8, 1.4, { phase: 1 }),
      spot(-8, -18, 1.2, { phase: 2 }),
    ],
    engines: [{ x: -40, y: -4, w: 4, kind: 'spore' }, { x: -40, y: 4, w: 4, kind: 'spore' }],
    turrets: [{ x: 44, y: -8, kind: 'bite' }, { x: 44, y: 8, kind: 'bite' }, { x: 30, y: 0, kind: 'acid' }],
    anim: [{ type: 'breathe', amp: 0.03, hz: 1.5 }, { type: 'wiggle', deg: 4, hz: 6 }],
    damage: { sparkPoints: [[-16, -10], [6, 8], [-26, 6]] },
  },
  vor_matriz: {
    id: 'vor_matriz', faction: V, size: 54, style: { edge: 'smooth' },
    layers: [
      wing([[-2, -12], [-26, -40], [-40, -34], [-20, -16]], { veins: 5 }),
      legs([[[8, -8], [2, -20], [10, -26]], [[-4, -12], [-12, -24], [-6, -30]]]),
      vpoly([[30, 0], [26, -6], [14, -8], [8, -4]], { plates: 2 }),
      vpoly([[10, -8], [-4, -14], [-16, -10], [-12, -3]]),
      vpoly([[-10, -14], [-26, -22], [-44, -16], [-50, 0]], { plates: 6 }),
      ellipse(-18, -8, 4, 3.2, { alpha: 0.6, stroke: 'hullEdge', lw: 0.4 }),
      ellipse(-30, -10, 4.5, 3.6, { alpha: 0.6, stroke: 'hullEdge', lw: 0.4 }),
      ellipse(-40, -6, 3.5, 2.8, { alpha: 0.6, stroke: 'hullEdge', lw: 0.4 }),
      spot(22, -4, 1.6, { pulse: 0 }),
      spot(-18, -8, 2, { pulse: 2 }),
      spot(-30, -10, 2.2, { pulse: 2, phase: 1 }),
      spot(-40, -6, 1.8, { pulse: 2, phase: 2 }),
    ],
    engines: [{ x: -50, y: -3, w: 4, kind: 'spore' }, { x: -50, y: 3, w: 4, kind: 'spore' }],
    turrets: [{ x: 26, y: 0, kind: 'spore' }, { x: -6, y: -14, kind: 'spore' }, { x: -6, y: 14, kind: 'spore' }],
    anim: [{ type: 'breathe', amp: 0.04, hz: 1.2 }, { type: 'flex', hz: 1.5 }],
    damage: { sparkPoints: [[-20, -10], [6, 6], [-34, 8]] },
    hangar: { x: -28, y: 0 },
  },
  vor_mandibula: {
    id: 'vor_mandibula', faction: V, size: 78, style: { edge: 'smooth' },
    layers: [
      legs([[[6, -16], [16, -32], [28, -36]], [[-8, -22], [-6, -38], [4, -44]], [[-22, -20], [-30, -36], [-24, -44]], [[-34, -14], [-46, -26], [-46, -36]]], { lw: 2.2 }),
      line([[[-6, -22], [-12, -36]], [[-20, -22], [-26, -34]]], { lw: 2, multi: true, stroke: 'hullEdge' }),
      vpoly([[40, 0], [36, -12], [18, -16], [8, -8]], { plates: 3 }),
      poly([[36, -8], [52, -18], [60, -10], [46, -4]], { fill: 'hullEdge', stroke: 'hullDark', lw: 0.8, smooth: false, alpha: 0.95 }),
      vpoly([[10, -16], [-10, -24], [-30, -20], [-28, -6]], { plates: 6 }),
      vpoly([[6, -10], [-10, -16], [-26, -13], [-24, -4]], { fill: 'hullLight', stroke: null, alpha: 0.3, plates: 0, specular: false }),
      vpoly([[-26, -16], [-42, -16], [-50, -6], [-48, 0]], { plates: 4 }),
      spot(30, -6, 2.4, { pulse: 0 }),
      spot(-4, -14, 1.8),
      spot(-18, -14, 1.6, { phase: 1 }),
      spot(-36, -8, 1.4, { phase: 2 }),
      spot(-44, -4, 1.2, { phase: 3 }),
    ],
    engines: [{ x: -50, y: -4, w: 5, kind: 'spore' }, { x: -50, y: 4, w: 5, kind: 'spore' }],
    turrets: [{ x: 20, y: -10, kind: 'plasma' }, { x: 20, y: 10, kind: 'plasma' }, { x: -10, y: -16, kind: 'torpedo' }, { x: -10, y: 16, kind: 'torpedo' }],
    anim: [{ type: 'breathe', amp: 0.03, hz: 1.2 }, { type: 'wiggle', deg: 3, hz: 4 }],
    damage: { sparkPoints: [[-20, -12], [10, 10], [-36, 6], [24, -6]] },
  },
  vor_rainha: {
    id: 'vor_rainha', faction: V, size: 114, style: { edge: 'smooth' },
    layers: [
      wing([[-6, -22], [-32, -48], [-46, -40], [-26, -24]], { veins: 6 }),
      line([[[2, -24], [0, -40]], [[-10, -22], [-16, -36]], [[12, -20], [16, -32]]], { lw: 2.2, multi: true, stroke: 'hullEdge' }),
      legs([[[10, -14], [12, -30], [24, -38]], [[-26, -22], [-34, -38], [-30, -48]]], { lw: 2.4 }),
      vpoly([[46, 0], [42, -9], [28, -13], [18, -8]], { plates: 3 }),
      poly([[24, -10], [40, -28], [52, -26], [46, -16], [34, -14]], { fill: 'grad:hull', stroke: 'hullEdge', lw: 1, smooth: true, plates: 2 }),
      vpoly([[20, -13], [6, -24], [-14, -22], [-18, -8]], { plates: 6 }),
      vpoly([[14, -8], [4, -16], [-12, -15], [-14, -4]], { fill: 'hullLight', stroke: null, alpha: 0.3, plates: 0, specular: false }),
      vpoly([[-16, -20], [-30, -26], [-42, -20], [-46, -6]], { plates: 6 }),
      vpoly([[-40, -16], [-50, -14], [-54, -4], [-48, 0]], { plates: 3 }),
      ellipse(-26, -12, 4, 3.2, { alpha: 0.55, stroke: 'hullEdge', lw: 0.4 }),
      ellipse(-36, -10, 3.6, 3, { alpha: 0.55, stroke: 'hullEdge', lw: 0.4 }),
      spot(36, -5, 2.6, { pulse: 0 }),
      spot(2, -14, 2),
      spot(-26, -12, 2.2, { pulse: 2 }),
      spot(-36, -10, 2, { pulse: 2, phase: 1 }),
      spot(-46, -6, 1.6, { phase: 2 }),
    ],
    engines: [{ x: -50, y: -4, w: 6, kind: 'spore' }, { x: -50, y: 4, w: 6, kind: 'spore' }],
    turrets: [{ x: 30, y: -8, kind: 'plasma' }, { x: 30, y: 8, kind: 'plasma' }, { x: 44, y: -20, kind: 'plasma' }, { x: 44, y: 20, kind: 'plasma' }, { x: -20, y: -22, kind: 'acid' }, { x: -20, y: 22, kind: 'acid' }],
    anim: [{ type: 'breathe', amp: 0.035, hz: 1.2 }, { type: 'wiggle', deg: 3, hz: 3 }, { type: 'flex', hz: 1.5 }],
    damage: { sparkPoints: [[-24, -14], [8, 12], [-40, 8], [28, -6], [-10, -20]] },
  },
  vor_colmeia: {
    id: 'vor_colmeia', faction: V, size: 170, style: { edge: 'smooth' },
    layers: [
      wing([[0, -22], [-30, -50], [-48, -44], [-28, -26]], { veins: 7 }),
      line([[[-4, -24], [-10, -40]], [[-20, -28], [-24, -44]], [[12, -20], [14, -34]]], { lw: 2.4, multi: true, stroke: 'hullEdge' }),
      legs([[[18, -12], [26, -28], [40, -34]], [[8, -22], [6, -38], [18, -46]], [[-12, -22], [-16, -40], [-6, -50]]], { lw: 2.4 }),
      vpoly([[50, 0], [46, -8], [34, -14], [22, -10]], { plates: 3 }),
      poly([[44, -8], [58, -14], [62, -6], [50, -3]], { fill: 'hullEdge', stroke: 'hullDark', lw: 0.8, smooth: false, alpha: 0.95 }),
      vpoly([[24, -14], [8, -24], [-10, -22], [-14, -8]], { plates: 7 }),
      vpoly([[18, -9], [6, -16], [-8, -15], [-10, -4]], { fill: 'hullLight', stroke: null, alpha: 0.3, plates: 0, specular: false }),
      vpoly([[-10, -20], [-26, -28], [-40, -22], [-44, -6]], { plates: 7 }),
      vpoly([[-38, -18], [-48, -16], [-50, -4], [-46, 0]], { plates: 4 }),
      ellipse(-18, -14, 4, 3.4, { alpha: 0.55, stroke: 'hullEdge', lw: 0.4 }),
      ellipse(-30, -16, 4.5, 3.8, { alpha: 0.55, stroke: 'hullEdge', lw: 0.4 }),
      ellipse(-38, -10, 3.5, 3, { alpha: 0.55, stroke: 'hullEdge', lw: 0.4 }),
      ellipse(40, -5, 3, 2.6, { alpha: 0.9, stroke: 'hullDark', lw: 0.5 }),
      spot(40, -5, 2.2, { pulse: 0 }),
      spot(-18, -14, 2.4, { pulse: 2 }),
      spot(-30, -16, 2.6, { pulse: 2, phase: 1 }),
      spot(-38, -10, 2.2, { pulse: 2, phase: 2 }),
      spot(4, -16, 1.8, { phase: 3 }),
      spot(-8, -10, 1.6, { phase: 4 }),
    ],
    engines: [{ x: -50, y: -3, w: 7, kind: 'spore' }, { x: -50, y: 3, w: 7, kind: 'spore' }],
    turrets: [{ x: 30, y: -8, kind: 'acid' }, { x: 30, y: 8, kind: 'acid' }, { x: 0, y: -20, kind: 'spore' }, { x: 0, y: 20, kind: 'spore' }, { x: -20, y: -24, kind: 'acid' }, { x: -20, y: 24, kind: 'acid' }, { x: 56, y: 0, kind: 'plasma' }],
    anim: [{ type: 'breathe', amp: 0.04, hz: 1.2 }, { type: 'wiggle', deg: 3, hz: 2.5 }, { type: 'flex', hz: 1.2 }],
    damage: { sparkPoints: [[-24, -16], [8, 14], [-40, 10], [30, -8], [-10, -22], [20, 4]] },
    hangar: { x: -28, y: 0 },
  },
};

// ---------------------------------------------------------------------------
// Lúmen — translucent crystal prisms, facets, cores, rings, orbiting shards
// ---------------------------------------------------------------------------

const crystal = (pts, o = {}) => poly(pts, { fill: 'crystal', stroke: 'hullEdge', lw: 1, alpha: 0.8, facets: 4, ...o });
const shard = (pts, o = {}) => poly(pts, { fill: 'crystal', stroke: 'hullEdge', lw: 0.8, alpha: 0.65, facets: 2, ...o });
const lring = (r, o = {}) => ring(0, 0, r, { lw: 1.5, color: 'team', alpha: 0.8, from: 0, to: 270, spin: 30, ...o });

const LUMEN = {
  lum_centelha: {
    id: 'lum_centelha', faction: L, size: 18, style: { edge: 'sharp' },
    layers: [
      crystal([[46, 0], [6, -10], [-30, -7], [-46, 0]], { facets: 3 }),
      core(0, 0, 3.5, { glow: 3 }),
      orbit(3, 14, 90, { len: 5 }),
    ],
    engines: [{ x: -46, y: 0, w: 3, kind: 'light' }],
    turrets: [{ x: 44, y: 0, kind: 'lance' }],
    anim: [{ type: 'twinkle', every: [0.3, 0.8] }],
    damage: { sparkPoints: [[-10, -3], [14, 2]] },
    shieldR: 0.62,
  },
  lum_prisma: {
    id: 'lum_prisma', faction: L, size: 32, style: { edge: 'sharp' },
    layers: [
      { kind: 'poly', pts: [[0, -30], [9, 0], [0, 30], [-9, 0]], mirror: false, fill: 'crystal', stroke: 'hullEdge', lw: 0.8, alpha: 0.55, facets: 2, z: -1, live: 'spin', spin: 20 },
      crystal([[44, 0], [10, -12], [-36, -8], [-44, 0]], { facets: 4 }),
      core(0, 0, 5, { glow: 3 }),
      lring(12, { to: 270, spin: 40 }),
      lring(17, { color: 'hullLight', alpha: 0.5, to: 240, spin: -25, lw: 1 }),
    ],
    engines: [{ x: -44, y: 0, w: 4, kind: 'light' }],
    turrets: [{ x: 42, y: 0, kind: 'lance' }],
    anim: [{ type: 'twinkle', every: [0.4, 1.0] }],
    damage: { sparkPoints: [[-16, -4], [16, 3]] },
    shieldR: 0.62,
  },
  lum_veu: {
    id: 'lum_veu', faction: L, size: 30, style: { edge: 'sharp' },
    layers: [
      crystal([[30, 0], [16, -14], [-14, -22], [-40, -10], [-28, 0]], { facets: 4 }),
      shard([[-16, -24], [-26, -36], [-36, -34], [-30, -24]], { live: 'bob', hz: 0.6, amp: 2 }),
      core(-4, 0, 5, { glow: 3.5 }),
      lring(13, { to: 300, spin: -30 }),
      spot(16, -10, 1.4, { color: 'inner', pulse: 2 }),
    ],
    engines: [{ x: -34, y: -5, w: 3, kind: 'light' }, { x: -34, y: 5, w: 3, kind: 'light' }],
    turrets: [{ x: 28, y: 0, kind: 'ion' }],
    anim: [{ type: 'twinkle', every: [0.4, 1.0] }],
    damage: { sparkPoints: [[-14, -8], [10, 6]] },
    shieldR: 0.66,
  },
  lum_harmonico: {
    id: 'lum_harmonico', faction: L, size: 50, style: { edge: 'sharp' },
    layers: [
      shard([[-6, -10], [-20, -26], [-34, -22], [-24, -10]], { facets: 3 }),
      crystal([[50, 0], [20, -8], [-30, -9], [-48, 0]], { facets: 5 }),
      line([[14, -2], [46, -1]], { stroke: 'inner', lw: 1.2, alpha: 0.8 }),
      line([[14, 0], [46, 0]], { stroke: 'white', lw: 0.6, alpha: 0.9, mirror: false }),
      core(-2, 0, 6, { glow: 3 }),
      lring(14, { to: 270, spin: 35 }),
      lring(20, { color: 'hullLight', alpha: 0.5, to: 200, spin: -20, lw: 1 }),
      spot(-26, -16, 1.6, { color: 'inner', pulse: 1.5 }),
    ],
    engines: [{ x: -48, y: 0, w: 5, kind: 'light' }],
    turrets: [{ x: 50, y: 0, kind: 'lance' }, { x: 10, y: -8, kind: 'lance' }, { x: 10, y: 8, kind: 'lance' }],
    anim: [{ type: 'twinkle', every: [0.3, 0.8] }],
    damage: { sparkPoints: [[-20, -5], [20, 4], [-10, 8]] },
    shieldR: 0.6,
  },
  lum_ressonante: {
    id: 'lum_ressonante', faction: L, size: 48, style: { edge: 'sharp' },
    layers: [
      { kind: 'poly', pts: rot([[34, 0], [8, -12], [-20, -8], [-26, 0], [-20, 8], [8, 12]], (2 * Math.PI) / 3), mirror: false, fill: 'crystal', stroke: 'hullEdge', lw: 0.9, alpha: 0.6, facets: 3, z: -1 },
      { kind: 'poly', pts: rot([[34, 0], [8, -12], [-20, -8], [-26, 0], [-20, 8], [8, 12]], (-2 * Math.PI) / 3), mirror: false, fill: 'crystal', stroke: 'hullEdge', lw: 0.9, alpha: 0.6, facets: 3, z: -1 },
      crystal([[38, 0], [10, -13], [-20, -9], [-28, 0]], { facets: 4 }),
      core(0, 0, 8, { glow: 3, pulse: { amp: 0.2, hz: 3 } }),
      lring(16, { to: 270, spin: 45 }),
      lring(22, { color: 'inner', alpha: 0.6, to: 250, spin: -30, lw: 1.2 }),
      lring(28, { color: 'hullLight', alpha: 0.35, to: 300, spin: 12, lw: 0.8 }),
    ],
    engines: [{ x: -28, y: 0, w: 5, kind: 'light' }],
    turrets: [{ x: 36, y: 0, kind: 'ion' }],
    anim: [{ type: 'twinkle', every: [0.3, 0.7] }],
    damage: { sparkPoints: [[-14, -6], [16, 6], [-8, 12]] },
    shieldR: 0.7,
  },
  lum_serafim: {
    id: 'lum_serafim', faction: L, size: 78, style: { edge: 'sharp' },
    layers: [
      shard([[8, -20], [-10, -40], [-28, -34], [-14, -20]], { live: 'bob', hz: 0.6, amp: 2, facets: 3 }),
      shard([[-24, -16], [-44, -30], [-52, -20], [-38, -12]], { live: 'bob', hz: 0.45, amp: 3, facets: 3 }),
      shard([[-50, -3], [-58, -5], [-62, 0], [-58, 5], [-50, 3]], { mirror: false, alpha: 0.45, facets: 0 }),
      crystal([[50, 0], [26, -10], [-6, -18], [-36, -12], [-50, 0]], { facets: 6 }),
      crystal([[-4, -18], [0, -30], [6, -18]], { z: 1, facets: 0, alpha: 0.85 }),
      line([[26, -6], [48, -1]], { stroke: 'inner', lw: 1.2, alpha: 0.8 }),
      core(0, 0, 9, { glow: 3 }),
      lring(18, { to: 270, spin: 30, lw: 2 }),
      lring(25, { color: 'hullLight', alpha: 0.6, to: 240, spin: -18, lw: 1.5 }),
      spot(-20, -30, 1.8, { color: 'inner', pulse: 1.2 }),
    ],
    engines: [{ x: -50, y: -4, w: 4, kind: 'light' }, { x: -50, y: 4, w: 4, kind: 'light' }],
    turrets: [{ x: 48, y: -4, kind: 'lance' }, { x: 48, y: 4, kind: 'lance' }],
    anim: [{ type: 'twinkle', every: [0.3, 0.8] }],
    damage: { sparkPoints: [[-24, -8], [20, 6], [-6, 14], [30, -4]] },
    shieldR: 0.6,
  },
  lum_catedral: {
    id: 'lum_catedral', faction: L, size: 116, style: { edge: 'sharp' },
    layers: [
      shard([[8, -22], [-10, -40], [-28, -34], [-14, -22]], { live: 'bob', hz: 0.6, amp: 2, facets: 3 }),
      shard([[-26, -18], [-46, -30], [-54, -20], [-40, -12]], { live: 'bob', hz: 0.45, amp: 3, facets: 3 }),
      shard([[-52, -3], [-58, -4], [-60, 0], [-58, 4], [-52, 3]], { mirror: false, alpha: 0.5, facets: 0 }),
      shard([[-60, -2], [-66, -3], [-68, 0], [-66, 3], [-60, 2]], { mirror: false, alpha: 0.3, facets: 0 }),
      crystal([[50, 0], [22, -13], [-8, -18], [-38, -11], [-50, 0]], { facets: 8 }),
      crystal([[-4, -18], [0, -30], [6, -18]], { z: 1, facets: 0, alpha: 0.85 }),
      crystal([[-30, -10], [-26, -20], [-22, -10]], { z: 1, facets: 0, alpha: 0.8 }),
      line([[24, -10], [48, -2]], { stroke: 'inner', lw: 1.4, alpha: 0.8 }),
      core(0, 0, 12, { glow: 3.2, pulse: { amp: 0.12, hz: 4 } }),
      lring(20, { to: 270, spin: 30, lw: 2 }),
      lring(27, { color: 'hullLight', alpha: 0.6, to: 240, spin: -18, lw: 1.5 }),
      lring(34, { alpha: 0.4, to: 300, spin: 10, lw: 1 }),
      orbit(6, 42, 25, { squash: 0.35, len: 8, fill: 'hullMid', alpha: 0.7 }),
      spot(-20, -30, 2, { color: 'inner', pulse: 1.2 }),
      spot(-44, -22, 1.8, { color: 'inner', pulse: 1.2, phase: 2 }),
    ],
    engines: [{ x: -50, y: 0, w: 6, kind: 'light' }],
    turrets: [{ x: 50, y: 0, kind: 'lance' }, { x: 10, y: -14, kind: 'lance' }, { x: 10, y: 14, kind: 'lance' }, { x: -20, y: -10, kind: 'arc' }, { x: -20, y: 10, kind: 'arc' }],
    anim: [{ type: 'twinkle', every: [0.3, 0.8] }],
    damage: { sparkPoints: [[-24, -10], [24, 6], [-6, 14], [34, -6], [-40, 4]] },
    shieldR: 0.6,
  },
  lum_luz_primordial: {
    id: 'lum_luz_primordial', faction: L, size: 166, style: { edge: 'sharp' },
    layers: [
      // torus of 12 crystal segments behind the spine
      ...regularPts(0, 0, 36, 12, Math.PI / 12).map(([x, y], i) => {
        const a = Math.atan2(y, x), da = Math.PI / 12 - 0.06;
        const r0 = 30, r1 = 42;
        const p = [[Math.cos(a - da) * r0, Math.sin(a - da) * r0], [Math.cos(a - da) * r1, Math.sin(a - da) * r1], [Math.cos(a + da) * r1, Math.sin(a + da) * r1], [Math.cos(a + da) * r0, Math.sin(a + da) * r0]];
        return { kind: 'poly', pts: p, mirror: false, fill: 'crystal', stroke: 'hullEdge', lw: 0.9, alpha: 0.7, facets: i % 2 ? 2 : 0, z: -1 };
      }),
      shard([[-44, -22], [-56, -38], [-66, -30], [-52, -16]], { live: 'bob', hz: 0.4, amp: 3, facets: 3 }),
      shard([[0, -40], [-8, -58], [-20, -54], [-10, -40]], { live: 'bob', hz: 0.5, amp: 2.5, facets: 3 }),
      shard([[26, -30], [34, -46], [22, -50], [16, -34]], { live: 'bob', hz: 0.55, amp: 2.5, facets: 3 }),
      crystal([[56, 0], [40, -8], [10, -11], [-10, -8], [-20, 0]], { facets: 6, alpha: 0.85, z: 1 }),
      crystal([[-20, -8], [-34, -14], [-54, -8], [-62, 0]], { facets: 4, alpha: 0.75, z: 1 }),
      line([[14, -3], [52, -1]], { stroke: 'inner', lw: 1.6, alpha: 0.85 }),
      line([[14, 0], [54, 0]], { stroke: 'white', lw: 0.8, alpha: 0.9, mirror: false }),
      core(0, 0, 16, { glow: 3.5, pulse: { amp: 0.1, hz: 3 } }),
      lring(22, { to: 270, spin: 25, lw: 2.5 }),
      lring(27, { color: 'inner', alpha: 0.6, to: 240, spin: -15, lw: 1.5 }),
      lring(46, { alpha: 0.5, to: 320, spin: 8, lw: 1.2 }),
      orbit(8, 50, 18, { squash: 0.4, len: 9, fill: 'hullMid', alpha: 0.7 }),
      spot(-56, -30, 2.2, { color: 'inner', pulse: 1 }),
      spot(-10, -50, 2, { color: 'inner', pulse: 1, phase: 2 }),
    ],
    engines: [{ x: -60, y: 0, w: 8, kind: 'light' }],
    turrets: [{ x: 56, y: 0, kind: 'spinal' }, { x: 36, y: -8, kind: 'lance' }, { x: 36, y: 8, kind: 'lance' }, { x: 0, y: -42, kind: 'lance' }, { x: 0, y: 42, kind: 'lance' }],
    anim: [{ type: 'twinkle', every: [0.2, 0.6] }],
    damage: { sparkPoints: [[-30, -10], [26, 6], [-6, 30], [40, -4], [-48, 6], [10, -34]] },
    shieldR: 0.62,
  },
};

// ---------------------------------------------------------------------------
// Ferrix — flat nanite blocks, cell grids, circuit traces, segmented rings
// ---------------------------------------------------------------------------

const block = (pts, o = {}) => poly(pts, { fill: 'cells', stroke: 'hullEdge', lw: 1, alpha: 1, smooth: false, cells: 4, traces: 1, ...o });
const sring = (x, y, r, o = {}) => ring(x, y, r, { lw: 3, color: 'hullLight', alpha: 1, segments: 12, gap: 8, spin: 15, mirror: false, ...o });

const FERRIX = {
  fer_vetor: {
    id: 'fer_vetor', faction: F, size: 18, style: { edge: 'sharp' },
    layers: [
      block([[10, -2], [10, -5], [30, -5], [34, -2], [34, 0]], { cells: 0, traces: 0 }),
      block([[-2, -9], [-2, -12], [4, -24], [8, -24], [8, -9]], { cells: 0, traces: 0 }),
      hex(0, 0, 10, { cells: 3 }),
      rects([[-14, -8, 4, 4], [16, -9, 4, 4]], { fill: 'team', alpha: 0.85 }),
      trace([[-12, 0], [-6, 0], [-6, -4], [0, -4], [0, 0], [30, 0]], { mirror: false }),
      core(0, 0, 4, { glow: 2, pulse: { amp: 0.1, hz: 2 }, shape: 'hex' }),
    ],
    engines: [{ x: -14, y: -6, w: 3, kind: 'pixel' }, { x: -14, y: 6, w: 3, kind: 'pixel' }],
    turrets: [{ x: 34, y: 0, kind: 'light' }],
    anim: [{ type: 'automaton', n: 6, hz: 4 }],
    damage: { sparkPoints: [[-6, -4], [8, 3]] },
  },
  fer_sentinela: {
    id: 'fer_sentinela', faction: F, size: 32, style: { edge: 'sharp' },
    layers: [
      block([[-20, -10], [-30, -26], [-24, -28], [-10, -12]], { cells: 0, traces: 0, z: -1 }),
      block([[14, 0], [14, -10], [-20, -12], [-28, 0]], { cells: 4, traces: 2 }),
      block([[14, -2], [14, -5], [48, -5], [50, -2], [50, 0]], { cells: 0, traces: 0, fill: 'hullMid' }),
      line([[16, -3], [48, -3]], { stroke: 'accent', lw: 0.8, alpha: 0.7 }),
      line([[16, 0], [48, 0]], { stroke: 'accent', lw: 0.6, alpha: 0.9, mirror: false }),
      rects([[-12, -10, 4, 4], [2, -9, 4, 4]], { fill: 'team', alpha: 0.85 }),
      sring(-24, 0, 6, { lw: 2, segments: 8, gap: 10, spin: 20 }),
      core(-6, 0, 3.5, { glow: 2, pulse: { amp: 0.1, hz: 2 }, shape: 'hex' }),
    ],
    engines: [{ x: -28, y: -5, w: 3, kind: 'pixel' }, { x: -28, y: 5, w: 3, kind: 'pixel' }],
    turrets: [{ x: 50, y: 0, kind: 'rail' }],
    anim: [{ type: 'automaton', n: 8, hz: 4 }],
    damage: { sparkPoints: [[-10, -6], [20, 2]] },
  },
  fer_disruptor: {
    id: 'fer_disruptor', faction: F, size: 30, style: { edge: 'sharp' },
    layers: [
      block([[20, 0], [16, -8], [-16, -9], [-24, 0]], { cells: 4, traces: 2 }),
      block([[16, -1], [16, -3], [36, -3], [40, -1], [40, 0]], { cells: 0, traces: 0, fill: 'hullMid' }),
      block([[-4, -9], [-4, -12], [8, -12], [8, -9]], { cells: 0, traces: 0, fill: 'hullMid' }),
      sring(2, -17, 7, { lw: 2.5, segments: 6, gap: 14, spin: 40, mirror: true }),
      rects([[-14, -6, 4, 4], [6, -7, 3, 3]], { fill: 'team', alpha: 0.85 }),
      core(0, 0, 4, { glow: 2.5, pulse: { amp: 0.15, hz: 3 }, shape: 'hex', color: 'accent' }),
      spot(2, -17, 1.5, { color: 'accent', pulse: 3 }),
    ],
    engines: [{ x: -24, y: -4, w: 3, kind: 'pixel' }, { x: -24, y: 4, w: 3, kind: 'pixel' }],
    turrets: [{ x: 40, y: 0, kind: 'ion' }],
    anim: [{ type: 'automaton', n: 8, hz: 4 }],
    damage: { sparkPoints: [[-10, -5], [12, 4]] },
  },
  fer_fabricador: {
    id: 'fer_fabricador', faction: F, size: 52, style: { edge: 'sharp' },
    layers: [
      block([[-40, 0], [-40, -14], [36, -14], [44, -6], [44, 0]], { cells: 4, traces: 3 }),
      block([[-36, -14], [-36, -22], [-6, -22], [-6, -14]], { cells: 0, traces: 0, fill: 'hullDark' }),
      rects([[-34, -21, 26, 6]], { fill: 'teamDim', alpha: 0.6 }),
      rects([[-32, -20, 4, 4], [-24, -20, 4, 4], [-16, -20, 4, 4]], { fill: 'team', alpha: 0.5 }),
      hex(-20, 0, 8, { cells: 3, z: 1 }),
      hex(0, 0, 8, { cells: 3, z: 1 }),
      hex(20, 0, 8, { cells: 3, z: 1 }),
      line([[-28, 0], [28, 0]], { stroke: 'accent', lw: 1, alpha: 0.6, mirror: false }),
      rects([[-38, -12, 4, 4], [30, -12, 4, 4], [8, -12, 4, 4]], { fill: 'team', alpha: 0.85 }),
      core(0, 0, 4, { glow: 2.5, pulse: { amp: 0.1, hz: 2 }, shape: 'hex' }),
      core(-20, 0, 3, { glow: 1.8, pulse: { amp: 0.1, hz: 2, phase: 1 }, shape: 'hex' }),
      core(20, 0, 3, { glow: 1.8, pulse: { amp: 0.1, hz: 2, phase: 2 }, shape: 'hex' }),
    ],
    engines: [{ x: -40, y: -5, w: 4, kind: 'pixel' }, { x: -40, y: 5, w: 4, kind: 'pixel' }],
    turrets: [{ x: 44, y: 0, kind: 'light' }],
    anim: [{ type: 'automaton', n: 14, hz: 4 }],
    damage: { sparkPoints: [[-24, -8], [14, 6], [-10, 10]] },
    hangar: { x: -20, y: -18 },
  },
  fer_bastiao: {
    id: 'fer_bastiao', faction: F, size: 54, style: { edge: 'sharp' },
    layers: [
      block([[-36, 0], [-36, -18], [30, -18], [44, -8], [44, 0]], { cells: 4, traces: 3 }),
      block([[-26, -4], [-26, -12], [20, -12], [26, -4]], { cells: 0, traces: 0, fill: 'hullDark', stroke: 'hullEdge', lw: 0.8 }),
      block([[-30, -18], [-30, -26], [14, -26], [16, -18]], { cells: 4, traces: 1, fill: 'cells' }),
      sring(-38, 0, 8, { lw: 3, segments: 10, gap: 8, spin: 15 }),
      sring(38, 0, 7, { lw: 2.5, segments: 8, gap: 10, spin: -20 }),
      rects([[-22, -24, 4, 4], [-8, -24, 4, 4], [6, -24, 4, 4], [-32, -16, 4, 4]], { fill: 'team', alpha: 0.85 }),
      line([[-24, -8], [22, -8]], { stroke: 'accent', lw: 0.8, alpha: 0.6 }),
      core(0, 0, 5, { glow: 2.5, pulse: { amp: 0.1, hz: 2 }, shape: 'hex' }),
    ],
    engines: [{ x: -36, y: -8, w: 4, kind: 'pixel' }, { x: -36, y: 8, w: 4, kind: 'pixel' }],
    turrets: [{ x: 36, y: -14, kind: 'plasma' }, { x: 36, y: 14, kind: 'plasma' }],
    anim: [{ type: 'automaton', n: 16, hz: 4 }],
    damage: { sparkPoints: [[-20, -10], [16, 8], [-6, 14]] },
  },
  fer_ariete: {
    id: 'fer_ariete', faction: F, size: 78, style: { edge: 'sharp' },
    layers: [
      line([[[-10, -8], [-24, -20]], [[-30, -6], [-40, -16]], [[-4, -12], [-14, -24]]], { stroke: 'hullEdge', lw: 1, alpha: 0.5, multi: true }),
      block([[10, 0], [12, -16], [-20, -20], [-44, -16], [-48, 0]], { cells: 4, traces: 4 }),
      block([[10, -4], [10, -8], [50, -8], [56, -4], [56, 0]], { cells: 0, traces: 0, fill: 'hullMid' }),
      line([[12, -6], [52, -6]], { stroke: 'accent', lw: 1, alpha: 0.7 }),
      line([[12, 0], [54, 0]], { stroke: 'accent', lw: 0.8, alpha: 0.9, mirror: false }),
      block([[-30, -16], [-30, -24], [-10, -24], [-8, -16]], { cells: 4, traces: 0 }),
      sring(-24, -22, 8, { lw: 3, segments: 10, gap: 8, spin: 15, mirror: true }),
      hex(-16, 0, 11, { cells: 3, z: 1 }),
      rects([[-40, -12, 4, 4], [-2, -14, 4, 4], [-36, -4, 4, 4]], { fill: 'team', alpha: 0.85 }),
      core(-16, 0, 6, { glow: 2.5, pulse: { amp: 0.1, hz: 2 }, shape: 'hex' }),
    ],
    engines: [{ x: -48, y: -6, w: 5, kind: 'pixel' }, { x: -48, y: 6, w: 5, kind: 'pixel' }],
    turrets: [{ x: 56, y: 0, kind: 'rail' }, { x: -4, y: -18, kind: 'ion' }, { x: -4, y: 18, kind: 'ion' }],
    anim: [{ type: 'automaton', n: 22, hz: 4 }],
    damage: { sparkPoints: [[-30, -10], [20, 4], [-6, 14], [-40, 6]] },
  },
  fer_nucleo: {
    id: 'fer_nucleo', faction: F, size: 114, style: { edge: 'sharp' },
    layers: [
      line([[[16, 0], [40, 0]], [[-16, 0], [-40, 0]], [[0, -16], [0, -40]], [[0, 16], [0, 40]], [[11, -11], [28, -28]], [[11, 11], [28, 28]], [[-11, -11], [-28, -28]], [[-11, 11], [-28, 28]]], { stroke: 'hullEdge', lw: 1, alpha: 0.5, multi: true, mirror: false }),
      block([[-50, -3], [-50, -9], [-16, -9], [-16, -3]], { cells: 0, traces: 0 }),
      block([[-3, -16], [-9, -16], [-9, -50], [-3, -50]], { cells: 0, traces: 0 }),
      block([[16, -4], [16, -10], [46, -10], [52, -4], [52, 0]], { cells: 0, traces: 0, fill: 'hullMid' }),
      line([[18, -7], [48, -7]], { stroke: 'accent', lw: 1, alpha: 0.7 }),
      sring(0, 0, 40, { lw: 7, segments: 16, gap: 5, spin: 12 }),
      sring(0, 0, 28, { lw: 5, segments: 12, gap: 6, spin: -20, color: 'hullMid' }),
      hex(0, 0, 16, { cells: 4, z: 1 }),
      rects([[-7, -36, 4, 4], [-46, -8, 4, 4], [-30, -8, 4, 4], [-7, -22, 3, 3], [20, -9, 3, 3]], { fill: 'team', alpha: 0.85 }),
      core(0, 0, 8, { glow: 2.5, pulse: { amp: 0.1, hz: 2 }, shape: 'hex' }),
    ],
    engines: [{ x: -50, y: -6, w: 5, kind: 'pixel' }, { x: -50, y: 6, w: 5, kind: 'pixel' }],
    turrets: [{ x: 52, y: -4, kind: 'rail' }, { x: 52, y: 4, kind: 'rail' }, { x: 0, y: -40, kind: 'ion' }, { x: 0, y: 40, kind: 'ion' }, { x: -28, y: -28, kind: 'ion' }, { x: -28, y: 28, kind: 'ion' }],
    anim: [{ type: 'automaton', n: 30, hz: 4 }],
    damage: { sparkPoints: [[-30, -6], [26, 6], [-6, 30], [36, -4], [-6, -30]] },
    hangar: { x: 0, y: 0 },
  },
  fer_mente: {
    id: 'fer_mente', faction: F, size: 166, style: { edge: 'sharp' },
    layers: [
      line([[[16, 0], [30, 0]], [[-16, 0], [-30, 0]], [[0, -16], [0, -30]], [[0, 16], [0, 30]], [[11, -11], [22, -22]], [[11, 11], [22, 22]], [[-11, -11], [-22, -22]], [[-11, 11], [-22, 22]], [[15, -6], [28, -12]], [[15, 6], [28, 12]], [[-15, -6], [-28, -12]], [[-15, 6], [-28, 12]]], { stroke: 'hullEdge', lw: 1, alpha: 0.5, multi: true, mirror: false }),
      block([[-56, -3], [-56, -9], [-14, -9], [-14, -3]], { cells: 4, traces: 1 }),
      block([[-3, -14], [-9, -14], [-9, -56], [-3, -56]], { cells: 4, traces: 1 }),
      block([[14, -4], [14, -8], [50, -8], [58, -4], [58, 0]], { cells: 0, traces: 0, fill: 'hullMid' }),
      line([[16, -6], [56, -6]], { stroke: 'accent', lw: 1.2, alpha: 0.75 }),
      line([[16, 0], [58, 0]], { stroke: 'accent', lw: 0.8, alpha: 0.9, mirror: false }),
      sring(0, 0, 44, { lw: 12, segments: 24, gap: 3, spin: 10 }),
      sring(0, 0, 44, { lw: 2, segments: 24, gap: 3, spin: 10, color: 'hullEdge', alpha: 0.5 }),
      hex(0, 0, 15, { cells: 4, z: 1 }),
      rects([[-52, -8, 4, 4], [-36, -8, 4, 4], [-20, -8, 4, 4], [-7, -52, 4, 4], [-7, -36, 4, 4], [-7, -20, 4, 4], [20, -8, 3, 3], [40, -8, 3, 3]], { fill: 'team', alpha: 0.85 }),
      core(0, 0, 9, { glow: 3, pulse: { amp: 0.1, hz: 2 }, shape: 'hex' }),
    ],
    engines: [{ x: -56, y: -6, w: 5, kind: 'pixel' }, { x: -56, y: 6, w: 5, kind: 'pixel' }, { x: -6, y: -56, w: 4, kind: 'pixel' }, { x: -6, y: 56, w: 4, kind: 'pixel' }],
    turrets: [{ x: 58, y: 0, kind: 'rail' }, { x: 44, y: -14, kind: 'ion' }, { x: 44, y: 14, kind: 'ion' }, { x: 0, y: -44, kind: 'ion' }, { x: 0, y: 44, kind: 'ion' }, { x: -44, y: 0, kind: 'emp' }],
    anim: [{ type: 'automaton', n: 36, hz: 4 }],
    damage: { sparkPoints: [[-30, -6], [26, 6], [-6, 30], [40, -4], [-6, -40], [-44, 4]] },
  },
};

/** All ship sprite definitions keyed by catalog ship id. */
export const SHIP_DEFS = Object.freeze({ ...TERRAN, ...VORRAX, ...LUMEN, ...FERRIX });

/** Known animated detail types (validated by tests). */
export const ANIM_TYPES = ['breathe', 'flex', 'wiggle', 'twinkle', 'automaton', 'strobe'];
export const LAYER_KINDS = ['poly', 'ellipse', 'ring', 'rects', 'line', 'light', 'spot', 'core', 'orbit', 'trace'];
export const ENGINE_KINDS = ['flame', 'spore', 'light', 'pixel'];
export const DEFAULT_ENGINE_KIND = { terran: 'flame', vorrax: 'spore', lumen: 'light', ferrix: 'pixel' };
export const MAX_DESIGN_EXTENT = 70;

/**
 * Compute the design-space bounding box of a definition (including mirrored
 * halves, rings, orbits and overhangs).
 * @param {object} def
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function designBBox(def) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  };
  for (const L of def.layers) {
    const m = L.mirror !== false && L.mirror !== undefined ? L.mirror : false;
    switch (L.kind) {
      case 'poly': case 'trace':
        for (const [x, y] of L.pts) { add(x, y); if (m) add(x, -y); }
        break;
      case 'line':
        for (const seg of (L.multi ? L.pts : [L.pts])) for (const [x, y] of seg) { add(x, y); if (m) add(x, -y); }
        break;
      case 'ellipse':
        add(L.x - L.rx, L.y - L.ry); add(L.x + L.rx, L.y + L.ry); if (m) { add(L.x - L.rx, -L.y - L.ry); add(L.x + L.rx, -L.y + L.ry); }
        break;
      case 'ring': {
        const r = L.r + (L.lw || 1) / 2;
        add(L.x - r, L.y - r); add(L.x + r, L.y + r); if (m) { add(L.x - r, -L.y - r); add(L.x + r, -L.y + r); }
        break;
      }
      case 'rects':
        for (const [x, y, w, h] of L.items) { add(x, y); add(x + w, y + h); if (m) { add(x, -y); add(x + w, -y - h); } }
        break;
      case 'light': case 'spot': case 'core':
        add(L.x - L.r, L.y - L.r); add(L.x + L.r, L.y + L.r); if (m) { add(L.x - L.r, -L.y - L.r); add(L.x + L.r, -L.y + L.r); }
        break;
      case 'orbit':
        add(-L.R - L.len, -L.R * L.squash - L.len); add(L.R + L.len, L.R * L.squash + L.len);
        break;
      default: break;
    }
  }
  for (const e of def.engines || []) add(e.x, e.y);
  if (!Number.isFinite(x0)) return { x: -50, y: -50, w: 100, h: 100 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
