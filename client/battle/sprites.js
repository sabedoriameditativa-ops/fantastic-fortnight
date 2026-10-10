// Procedural ship sprites: builds the data-driven definitions from
// render/shipDefs.js into cached offscreen canvases (one per class, team, zoom
// bucket and damage state) and blits them with a single setTransform +
// drawImage per ship. Animated details (engine flames, cores, rings, orbiting
// shards, automaton cells, blinking lights) are drawn live on top at LOD 2.
//
// Coordinates: design space 100x100 (nose = +x); design unit = def.size / 100
// world units. Screen math is done in device pixels (CSS px * dpr).

import { SHIP_DEFS, designBBox, DEFAULT_ENGINE_KIND } from './render/shipDefs.js';
import { palette, hash01, hashStr, hashInt, mix, rgba, parseColor, noise1, TAU, clamp } from './render/palette.js';
import { getGlow, makeCanvas } from './render/glow.js';

export { SHIP_DEFS };

/** Zoom buckets (sqrt(2) steps). The blit applies the residual scale. */
export const ZOOM_BUCKETS = [0.35, 0.5, 0.71, 1.0, 1.41, 2.0];
export const MAX_SPRITE_PX = 512;
/** On-screen ship length (px) thresholds for LOD 0/1/2. */
export const LOD_PX = [7, 24];

/** Nearest bucket in log space. */
export function pickBucket(zoom) {
  let best = ZOOM_BUCKETS[0], bd = Infinity;
  const lz = Math.log(zoom);
  for (const b of ZOOM_BUCKETS) {
    const d = Math.abs(Math.log(b) - lz);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** LOD for an on-screen length in CSS px: 0 = triangle, 1 = simple sprite, 2 = full. */
export function lodFor(screenLen) {
  return screenLen < LOD_PX[0] ? 0 : screenLen < LOD_PX[1] ? 1 : 2;
}

/** Damage state from hull permille: 0 intact, 1 < 60%, 2 < 30%. */
export function damageState(hpPermille) {
  return hpPermille < 300 ? 2 : hpPermille < 600 ? 1 : 0;
}

/** @returns {object} sprite definition for a catalog class (falls back to a generic). */
export function getDef(cls) {
  return SHIP_DEFS[cls] || SHIP_DEFS.ter_falcao;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Full point list for a layer (mirror applied). */
export function layerPoints(L) {
  if (!L.mirror) return L.pts;
  const out = L.pts.slice();
  for (let i = L.pts.length - 1; i >= 0; i--) {
    const [x, y] = L.pts[i];
    if (y !== 0) out.push([x, -y]); // points on the axis mirror onto themselves
  }
  return out;
}

function catmullRomPath(g, pts, tension = 0.5) {
  const n = pts.length;
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) * tension / 3, c1y = p1[1] + (p2[1] - p0[1]) * tension / 3;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension / 3, c2y = p2[1] - (p3[1] - p1[1]) * tension / 3;
    g.bezierCurveTo(c1x, c1y, c2x, c2y, p2[0], p2[1]);
  }
}

/** Trace a polygon layer path (mirror + optional smoothing). */
export function tracePoly(g, L, def, dx = 0, dy = 0) {
  const pts = layerPoints(L);
  const smooth = L.smooth !== undefined ? L.smooth : def.style.edge === 'smooth';
  g.beginPath();
  if (dx || dy) { g.translate(dx, dy); }
  if (smooth && pts.length >= 3) catmullRomPath(g, pts, 0.6);
  else {
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  }
  g.closePath();
  if (dx || dy) { g.translate(-dx, -dy); }
}

function ptsBBox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

function pointInPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

function resolveFill(g, L, def, pal, bb) {
  const f = L.fill;
  if (!f) return null;
  switch (f) {
    case 'grad:hull': {
      if (def.faction === 'vorrax') {
        const r = Math.max(bb.w, bb.h) * 0.75;
        const gr = g.createRadialGradient(bb.cx, bb.cy - bb.h * 0.3, 0, bb.cx, bb.cy, r);
        gr.addColorStop(0, pal.hullLight); gr.addColorStop(0.45, pal.hullMid); gr.addColorStop(1, pal.hullDark);
        return gr;
      }
      if (def.faction === 'lumen') return crystalFill(g, pal, bb);
      if (def.faction === 'ferrix') return pal.hullMid;
      const gr = g.createLinearGradient(0, bb.y, 0, bb.y + bb.h);
      gr.addColorStop(0, pal.hullLight); gr.addColorStop(0.3, pal.hullMid);
      gr.addColorStop(0.33, mix(pal.hullMid, '#ffffff', 0.12)); gr.addColorStop(0.37, pal.hullMid);
      gr.addColorStop(1, pal.hullDark);
      return gr;
    }
    case 'crystal': return crystalFill(g, pal, bb);
    case 'cells': return pal.hullMid;
    case 'membrane': return pal.membrane || 'rgba(220,150,170,0.35)';
    case 'grad:canopy': {
      const gr = g.createLinearGradient(0, bb.y, 0, bb.y + bb.h);
      gr.addColorStop(0, pal.canopyA || '#9fd8ff'); gr.addColorStop(1, pal.canopyB || '#143a5a');
      return gr;
    }
    default: return pal[f] || f;
  }
}

function crystalFill(g, pal, bb) {
  const gr = g.createLinearGradient(bb.x, 0, bb.x + bb.w, 0);
  gr.addColorStop(0, pal.hullDark); gr.addColorStop(0.5, pal.hullMid); gr.addColorStop(1, pal.hullLight);
  return gr;
}

/** Draw material details for a polygon layer (clipped to the layer path). */
function drawMaterialDetail(g, L, def, pal, bb, li, opts) {
  const { bucket, k } = opts;
  const pts = layerPoints(L);
  const seed = hashStr(def.id) + li * 977;
  g.save();
  tracePoly(g, L, def);
  g.clip();
  const px = 1 / k; // one device pixel in design units
  switch (def.faction) {
    case 'terran': {
      if (L.panels) {
        g.strokeStyle = pal.panelLine; g.lineWidth = Math.max(0.8, px); g.globalAlpha = 0.7;
        g.beginPath();
        for (let i = 0; i < L.panels; i++) {
          const x = bb.x + bb.w * ((i + 0.5 + hash01(seed, i) * 0.6) / L.panels);
          const jog = (hash01(seed, i, 1) - 0.5) * bb.w * 0.2, yj = bb.cy + (hash01(seed, i, 2) - 0.5) * bb.h * 0.5;
          g.moveTo(x, bb.y - 1); g.lineTo(x, yj); g.lineTo(x + jog, yj); g.lineTo(x + jog, bb.y + bb.h + 1);
        }
        // one longitudinal line
        g.moveTo(bb.x, bb.cy + bb.h * 0.18); g.lineTo(bb.x + bb.w, bb.cy + bb.h * 0.18);
        g.stroke();
      }
      if (L.hazard) {
        g.globalAlpha = 0.85;
        const step = 3;
        for (let x = bb.x - bb.h; x < bb.x + bb.w + bb.h; x += step * 2) {
          g.fillStyle = pal.accent;
          g.beginPath(); g.moveTo(x, bb.y + bb.h + 1); g.lineTo(x + step, bb.y + bb.h + 1); g.lineTo(x + step + bb.h + 2, bb.y - 1); g.lineTo(x + bb.h + 2, bb.y - 1); g.closePath(); g.fill();
        }
        g.fillStyle = pal.hullDark; g.globalAlpha = 0.35;
        g.fillRect(bb.x, bb.y, bb.w, bb.h * 0.5);
      }
      if (L.rivets && bucket >= 1) {
        g.fillStyle = pal.hullLight; g.globalAlpha = 0.7;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const n = Math.floor(len / 6);
          for (let j = 1; j < n; j++) {
            const t = j / n;
            const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
            // inset toward centroid
            const ix = x + (bb.cx - x) * 0.08, iy = y + (bb.cy - y) * 0.08;
            g.fillRect(ix - 0.4, iy - 0.4, 0.8, 0.8);
          }
        }
      }
      break;
    }
    case 'vorrax': {
      if (L.plates) {
        g.strokeStyle = pal.hullDark; g.lineWidth = Math.max(0.8, px); g.globalAlpha = 0.5;
        g.beginPath();
        for (let i = 1; i <= L.plates; i++) {
          const x = bb.x + bb.w * (i / (L.plates + 1));
          const bend = bb.w * 0.08 * (1 + hash01(seed, i));
          g.moveTo(x, bb.y - 1);
          g.quadraticCurveTo(x - bend, bb.cy, x, bb.y + bb.h + 1);
        }
        g.stroke();
      }
      if (L.specular !== false && L.fill === 'grad:hull') {
        g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(1, px); g.globalAlpha = 0.3;
        g.beginPath();
        g.ellipse(bb.cx, bb.y + bb.h * 0.28, bb.w * 0.28, bb.h * 0.12, 0, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
      }
      if (L.veins) {
        g.strokeStyle = pal.membraneVein || pal.hullEdge; g.lineWidth = Math.max(0.6, px); g.globalAlpha = 0.45;
        const root = pts[0], far = pts.slice(1, Math.ceil(pts.length / 2) + 1);
        g.beginPath();
        for (let i = 0; i < L.veins; i++) {
          const t = (i + 0.5) / L.veins;
          const fi = Math.min(far.length - 1, Math.floor(t * far.length));
          const fp = far[fi], fn = far[Math.min(far.length - 1, fi + 1)];
          const u = t * far.length - fi;
          g.moveTo(root[0], root[1]);
          g.quadraticCurveTo((root[0] + fp[0]) / 2 + 2, (root[1] + fp[1]) / 2 - 2, fp[0] + (fn[0] - fp[0]) * u, fp[1] + (fn[1] - fp[1]) * u);
        }
        g.stroke();
      }
      break;
    }
    case 'lumen': {
      if (L.facets) {
        const n = pts.length;
        for (let i = 0; i < n; i++) {
          const a = pts[i], b = pts[(i + 1) % n];
          g.fillStyle = (i + li) % 2 ? (pal.facet || 'rgba(255,255,255,0.18)') : rgba(pal.inner || '#b8f0ff', 0.2);
          g.globalAlpha = 1;
          g.beginPath(); g.moveTo(bb.cx, bb.cy); g.lineTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.closePath(); g.fill();
        }
        // inner edge (thickness)
        g.strokeStyle = pal.hullMid; g.lineWidth = Math.max(1, px); g.globalAlpha = 0.5;
        g.beginPath();
        for (let i = 0; i < n; i++) {
          const p = pts[i];
          const x = p[0] + (bb.cx - p[0]) * 0.12, y = p[1] + (bb.cy - p[1]) * 0.12;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath(); g.stroke();
      }
      break;
    }
    case 'ferrix': {
      if (L.cells) {
        const step = L.cells;
        g.strokeStyle = pal.hullDark; g.lineWidth = Math.max(0.7, px); g.globalAlpha = 0.9;
        g.beginPath();
        for (let x = Math.floor(bb.x / step) * step; x <= bb.x + bb.w; x += step) { g.moveTo(x, bb.y - 1); g.lineTo(x, bb.y + bb.h + 1); }
        for (let y = Math.floor(bb.y / step) * step; y <= bb.y + bb.h; y += step) { g.moveTo(bb.x - 1, y); g.lineTo(bb.x + bb.w + 1, y); }
        g.stroke();
        // static "on" cells
        const nOn = Math.max(2, Math.round((bb.w * bb.h) / 140));
        g.fillStyle = pal.team; g.globalAlpha = 0.55;
        for (let i = 0; i < nOn; i++) {
          const cx = Math.floor((bb.x + hash01(seed, i, 3) * bb.w) / step) * step + 0.5;
          const cy = Math.floor((bb.y + hash01(seed, i, 4) * bb.h) / step) * step + 0.5;
          if (pointInPoly(pts, cx + step / 2, cy + step / 2)) g.fillRect(cx, cy, step - 1, step - 1);
        }
        g.fillStyle = pal.cellOff || pal.hullDark; g.globalAlpha = 0.7;
        for (let i = 0; i < nOn; i++) {
          const cx = Math.floor((bb.x + hash01(seed, i, 5) * bb.w) / step) * step + 0.5;
          const cy = Math.floor((bb.y + hash01(seed, i, 6) * bb.h) / step) * step + 0.5;
          if (pointInPoly(pts, cx + step / 2, cy + step / 2)) g.fillRect(cx, cy, step - 1, step - 1);
        }
      }
      if (L.traces) {
        g.strokeStyle = pal.accent; g.lineWidth = Math.max(0.8, px); g.globalAlpha = 0.6;
        g.beginPath();
        for (let i = 0; i < L.traces; i++) {
          let x = bb.x + hash01(seed, i, 7) * bb.w, y = bb.y + hash01(seed, i, 8) * bb.h;
          g.moveTo(x, y);
          for (let s = 0; s < 4; s++) {
            if (s % 2 === 0) x = clamp(x + (hash01(seed, i, 9 + s) - 0.5) * bb.w * 0.6, bb.x, bb.x + bb.w);
            else y = clamp(y + (hash01(seed, i, 9 + s) - 0.5) * bb.h * 0.6, bb.y, bb.y + bb.h);
            g.lineTo(x, y);
          }
          if (L.mirror) {
            // mirrored copy
            x = bb.x + hash01(seed, i, 7) * bb.w; y = -(bb.y + hash01(seed, i, 8) * bb.h);
            g.moveTo(x, y);
            for (let s = 0; s < 4; s++) {
              if (s % 2 === 0) x = clamp(x + (hash01(seed, i, 9 + s) - 0.5) * bb.w * 0.6, bb.x, bb.x + bb.w);
              else y = clamp(y - (hash01(seed, i, 9 + s) - 0.5) * bb.h * 0.6, -(bb.y + bb.h), -bb.y);
              g.lineTo(x, y);
            }
          }
        }
        g.stroke();
      }
      break;
    }
    default: break;
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// Static layer drawing (cache build)
// ---------------------------------------------------------------------------

function drawRing(g, L, pal, y, lw) {
  const segs = L.segments || 0;
  const from = ((L.from ?? 0) * Math.PI) / 180, to = ((L.to ?? 360) * Math.PI) / 180;
  g.strokeStyle = pal[L.color] || L.color || pal.team;
  g.lineWidth = lw;
  g.globalAlpha = L.alpha ?? 1;
  g.beginPath();
  if (segs > 0) {
    const gap = ((L.gap || 6) * Math.PI) / 180;
    const span = (to - from) / segs;
    for (let i = 0; i < segs; i++) {
      const a0 = from + i * span + gap / 2, a1 = from + (i + 1) * span - gap / 2;
      g.moveTo(L.x + Math.cos(a0) * L.r, y + Math.sin(a0) * L.r);
      g.arc(L.x, y, L.r, a0, a1);
    }
  } else {
    g.arc(L.x, y, L.r, from, to);
  }
  g.stroke();
  g.globalAlpha = 1;
}

function drawStaticLayer(g, L, li, def, pal, opts) {
  const { detail, k, bucket } = opts;
  const px = 1 / k;
  switch (L.kind) {
    case 'poly': {
      const pts = layerPoints(L);
      const bb = ptsBBox(pts);
      tracePoly(g, L, def);
      const fill = resolveFill(g, L, def, pal, bb);
      g.globalAlpha = L.alpha ?? (def.faction === 'lumen' && (L.fill === 'crystal' || L.fill === 'grad:hull') ? 0.8 : 1);
      if (fill) { g.fillStyle = fill; g.fill(); }
      if (detail) drawMaterialDetail(g, L, def, pal, bb, li, opts);
      if (L.stroke) {
        g.globalAlpha = Math.min(1, (L.alpha ?? 1) + 0.15);
        tracePoly(g, L, def);
        g.lineWidth = Math.max(L.lw || 1, px);
        g.strokeStyle = pal[L.stroke] || L.stroke;
        g.stroke();
        if (def.faction === 'lumen' && detail && bucket >= 1 && (L.fill === 'crystal' || L.fill === 'grad:hull')) {
          g.globalAlpha = 0.25; g.lineWidth = Math.max(0.8, px);
          g.strokeStyle = pal.chromaA; tracePoly(g, L, def, 0.7, 0); g.stroke();
          g.strokeStyle = pal.chromaB; tracePoly(g, L, def, -0.7, 0); g.stroke();
        }
      }
      g.globalAlpha = 1;
      break;
    }
    case 'ellipse': {
      const ys = L.mirror ? [L.y, -L.y] : [L.y];
      for (const y of ys) {
        g.beginPath(); g.ellipse(L.x, y, L.rx, L.ry, L.rot || 0, 0, TAU);
        g.globalAlpha = L.alpha ?? 1;
        if (L.fill) { g.fillStyle = pal[L.fill] || L.fill; g.fill(); }
        if (L.stroke) { g.lineWidth = Math.max(L.lw || 0.8, px); g.strokeStyle = pal[L.stroke] || L.stroke; g.stroke(); }
        if (L.mirror && L.y === 0) break;
      }
      g.globalAlpha = 1;
      break;
    }
    case 'ring': {
      // spinning rings are drawn live at LOD 2; keep a static copy otherwise
      if (L.spin && detail) break;
      const ys = L.mirror ? [L.y, -L.y] : [L.y];
      for (const y of ys) {
        drawRing(g, L, pal, y, Math.max(L.lw || 1, px));
        if (L.mirror && L.y === 0) break;
      }
      break;
    }
    case 'rects': {
      g.fillStyle = pal[L.fill] || L.fill || pal.hullDark;
      g.globalAlpha = L.alpha ?? 1;
      for (const [x, y, w, h] of L.items) {
        g.fillRect(x, y, w, h);
        if (L.mirror && y !== 0) g.fillRect(x, -y - h, w, h);
      }
      g.globalAlpha = 1;
      break;
    }
    case 'line': {
      g.strokeStyle = pal[L.stroke] || L.stroke || pal.hullEdge;
      g.lineWidth = Math.max(L.lw || 1, px);
      g.globalAlpha = L.alpha ?? 1;
      g.lineCap = 'round';
      if (L.dash) g.setLineDash(L.dash);
      g.beginPath();
      const segs = L.multi ? L.pts : [L.pts];
      for (const seg of segs) {
        g.moveTo(seg[0][0], seg[0][1]);
        for (let i = 1; i < seg.length; i++) g.lineTo(seg[i][0], seg[i][1]);
        if (L.mirror) {
          g.moveTo(seg[0][0], -seg[0][1]);
          for (let i = 1; i < seg.length; i++) g.lineTo(seg[i][0], -seg[i][1]);
        }
      }
      g.stroke();
      if (L.dash) g.setLineDash([]);
      g.globalAlpha = 1;
      break;
    }
    case 'trace': {
      g.strokeStyle = pal.accent; g.lineWidth = Math.max(0.8, px); g.globalAlpha = 0.6;
      g.beginPath();
      g.moveTo(L.pts[0][0], L.pts[0][1]);
      for (let i = 1; i < L.pts.length; i++) g.lineTo(L.pts[i][0], L.pts[i][1]);
      if (L.mirror) {
        g.moveTo(L.pts[0][0], -L.pts[0][1]);
        for (let i = 1; i < L.pts.length; i++) g.lineTo(L.pts[i][0], -L.pts[i][1]);
      }
      g.stroke();
      g.globalAlpha = 1;
      break;
    }
    case 'light': {
      if (detail) break; // live at LOD 2
      g.fillStyle = pal[L.color] || L.color || pal.team; g.globalAlpha = 0.9;
      g.beginPath(); g.arc(L.x, L.y, L.r, 0, TAU); g.fill();
      if (L.mirror && L.y !== 0) { g.beginPath(); g.arc(L.x, -L.y, L.r, 0, TAU); g.fill(); }
      g.globalAlpha = 1;
      break;
    }
    case 'spot': {
      g.fillStyle = pal[L.color] || L.color || pal.team; g.globalAlpha = detail ? 0.6 : 0.9;
      g.beginPath(); g.arc(L.x, L.y, L.r, 0, TAU); g.fill();
      if (L.mirror && L.y !== 0) { g.beginPath(); g.arc(L.x, -L.y, L.r, 0, TAU); g.fill(); }
      g.globalAlpha = 1;
      break;
    }
    case 'core': {
      const col = pal[L.color] || L.color || pal.team;
      g.globalAlpha = 1;
      g.fillStyle = mix(col, '#ffffff', 0.35);
      g.beginPath();
      if (L.shape === 'hex') { const p = hexPts(L.x, L.y, L.r); g.moveTo(p[0][0], p[0][1]); for (let i = 1; i < 6; i++) g.lineTo(p[i][0], p[i][1]); g.closePath(); }
      else g.arc(L.x, L.y, L.r, 0, TAU);
      g.fill();
      g.strokeStyle = col; g.lineWidth = Math.max(0.8, px); g.stroke();
      if (!detail) {
        g.fillStyle = col; g.globalAlpha = 0.35;
        g.beginPath(); g.arc(L.x, L.y, L.r * 2, 0, TAU); g.fill();
        g.globalAlpha = 1;
      }
      break;
    }
    case 'orbit': {
      if (detail) break; // live at LOD 2
      g.fillStyle = pal[L.fill] || L.fill || pal.team; g.globalAlpha = (L.alpha ?? 0.7) * 0.8;
      for (let i = 0; i < L.n; i++) {
        const a = (i / L.n) * TAU;
        g.beginPath(); g.arc(Math.cos(a) * L.R, Math.sin(a) * L.R * L.squash, L.len * 0.35, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
      break;
    }
    default: break;
  }
}

function hexPts(x, y, r) {
  const out = [];
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
  return out;
}

/** Turret base marks (static). */
function drawTurrets(g, def, pal, opts) {
  const px = 1 / opts.k;
  for (const t of def.turrets || []) {
    const kind = t.kind;
    if (kind === 'bite' || kind === 'spinal' || kind === 'lance' || kind === 'arc') continue;
    const r = kind === 'heavy' ? 3.2 : kind === 'medium' ? 2.4 : kind === 'rail' ? 2 : 1.6;
    if (def.faction === 'vorrax') {
      g.fillStyle = pal.hullEdge; g.globalAlpha = 0.6;
      g.beginPath(); g.arc(t.x, t.y, r * 0.8, 0, TAU); g.fill();
    } else if (def.faction === 'lumen') {
      g.fillStyle = pal.inner || pal.accent; g.globalAlpha = 0.7;
      g.beginPath(); g.arc(t.x, t.y, r * 0.7, 0, TAU); g.fill();
    } else {
      g.fillStyle = pal.hullDark; g.globalAlpha = 0.9;
      g.beginPath(); g.arc(t.x, t.y, r, 0, TAU); g.fill();
      g.fillStyle = pal.hullLight; g.globalAlpha = 0.9;
      g.beginPath(); g.arc(t.x, t.y, r * 0.55, 0, TAU); g.fill();
      g.strokeStyle = pal.hullLight; g.lineWidth = Math.max(0.8, px);
      g.beginPath(); g.moveTo(t.x, t.y); g.lineTo(t.x + r * 1.8, t.y); g.stroke();
    }
  }
  g.globalAlpha = 1;
}

/** Engine nozzles (static part). */
function drawNozzles(g, def, pal, opts) {
  const kind = DEFAULT_ENGINE_KIND[def.faction];
  for (const e of def.engines || []) {
    const ek = e.kind || kind;
    if (ek === 'flame') {
      g.fillStyle = pal.hullDark; g.fillRect(e.x - 1, e.y - e.w / 2, 3, e.w);
      g.fillStyle = pal.teamDim; g.fillRect(e.x - 0.5, e.y - e.w / 2 + 0.8, 1.5, e.w - 1.6);
    } else if (ek === 'pixel') {
      g.fillStyle = pal.team; g.globalAlpha = 0.9; g.fillRect(e.x - 1.5, e.y - 1.5, 3, 3); g.globalAlpha = 1;
    } else if (ek === 'spore') {
      g.fillStyle = pal.accent; g.globalAlpha = 0.7; g.beginPath(); g.arc(e.x + 1, e.y, e.w * 0.35, 0, TAU); g.fill(); g.globalAlpha = 1;
    } else if (ek === 'light') {
      g.fillStyle = pal.team; g.globalAlpha = 0.8; g.beginPath(); g.arc(e.x + 1, e.y, e.w * 0.4, 0, TAU); g.fill(); g.globalAlpha = 1;
    }
  }
}

/** Damage decals: scorch (source-atop) and breaches (destination-out). */
function applyDamage(g, def, pal, dmgState, bb, opts) {
  const seed = hashStr(def.id) ^ 0x5bd1e995;
  const n = Math.round((2 + def.size / 18) * (dmgState === 2 ? 1.8 : 1));
  const pts = def.damage?.sparkPoints || [];
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < n; i++) {
    let x, y;
    if (i < pts.length) { x = pts[i][0] + (hash01(seed, i, 1) - 0.5) * 6; y = pts[i][1] + (hash01(seed, i, 2) - 0.5) * 6; }
    else { x = bb.x + hash01(seed, i, 3) * bb.w; y = bb.y + hash01(seed, i, 4) * bb.h; }
    const r = 3 + hash01(seed, i, 5) * 5 * (dmgState === 2 ? 1.4 : 1);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(0.6, 'rgba(10,8,6,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  if (dmgState >= 2) {
    // glowing cracks / exposed inner
    g.strokeStyle = def.faction === 'lumen' ? '#ffffff' : '#ff6a3d'; g.lineWidth = Math.max(0.7, 1 / opts.k); g.globalAlpha = 0.6;
    g.beginPath();
    for (let i = 0; i < 3 + (def.size > 60 ? 3 : 0); i++) {
      let x = bb.x + hash01(seed, i, 6) * bb.w, y = bb.y + hash01(seed, i, 7) * bb.h;
      g.moveTo(x, y);
      for (let s = 0; s < 3; s++) { x += (hash01(seed, i, 8 + s) - 0.5) * 8; y += (hash01(seed, i, 12 + s) - 0.5) * 8; g.lineTo(x, y); }
    }
    g.stroke();
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 3; i++) {
      // bite a triangle out of the outline
      const x = bb.x + hash01(seed, i, 20) * bb.w, y = bb.y + (hash01(seed, i, 21) < 0.5 ? 0 : bb.h) + (hash01(seed, i, 22) - 0.5) * 3;
      const s = 2 + hash01(seed, i, 23) * 3;
      g.beginPath(); g.moveTo(x - s, y); g.lineTo(x + s, y - s * 0.3); g.lineTo(x + s * 0.3, y + s); g.closePath(); g.fill();
    }
  }
  g.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------------------
// Sprite cache
// ---------------------------------------------------------------------------

/**
 * Create a sprite cache.
 * @param {{ dpr?: number, teamColors?: object[], maxEntries?: number }} o
 */
export function createSpriteCache(o = {}) {
  let dpr = o.dpr || 1;
  const teamColors = o.teamColors;
  const maxEntries = o.maxEntries || 400;
  const cache = new Map();
  let builds = 0;

  function build(def, team, bucket, dmgState) {
    const pal = palette(def.faction, team, teamColors);
    const bb = designBBox(def);
    const screenLen = def.size * bucket;
    const detail = screenLen >= LOD_PX[1];
    let k = (def.size / 100) * bucket * dpr;
    const padU = 3;
    let w = Math.ceil((bb.w + 2 * padU) * k) + 2, h = Math.ceil((bb.h + 2 * padU) * k) + 2;
    const m = Math.max(w, h);
    if (m > MAX_SPRITE_PX) { const f = MAX_SPRITE_PX / m; k *= f; w = Math.ceil(w * f); h = Math.ceil(h * f); }
    const cv = makeCanvas(w, h);
    const g = cv.getContext('2d');
    const ox = -bb.x * k + padU * k + 1, oy = -bb.y * k + padU * k + 1;
    g.setTransform(k, 0, 0, k, ox, oy);
    g.lineJoin = 'round';
    const opts = { detail, k, bucket, dpr };
    const layers = def.layers.map((L, i) => ({ L, i })).sort((a, b) => (a.L.z || 0) - (b.L.z || 0) || a.i - b.i);
    for (const { L, i } of layers) {
      if ((L.z || 0) > 0 && !opts.frontDone) { opts.frontDone = true; drawNozzles(g, def, pal, opts); drawTurrets(g, def, pal, opts); }
      drawStaticLayer(g, L, i, def, pal, opts);
    }
    if (!opts.frontDone) { drawNozzles(g, def, pal, opts); drawTurrets(g, def, pal, opts); }
    if (dmgState > 0) applyDamage(g, def, pal, dmgState, bb, opts);
    builds++;
    return { canvas: cv, w, h, ox, oy, k, bucket, detail, size: def.size, dpr };
  }

  return {
    /**
     * Get (or build) the sprite for a definition.
     * @param {object} def sprite definition
     * @param {number} team 0|1
     * @param {number} zoom current camera zoom
     * @param {number} dmgState 0..2
     */
    get(def, team, zoom, dmgState = 0) {
      const bucket = pickBucket(zoom);
      const key = def.id + '|' + team + '|' + bucket + '|' + dmgState;
      let s = cache.get(key);
      if (s) {
        // LRU touch
        cache.delete(key); cache.set(key, s);
        return s;
      }
      s = build(def, team, bucket, dmgState);
      cache.set(key, s);
      if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      return s;
    },
    /** Pre-build sprites for a list of classes at the given zooms (both teams, intact). */
    warm(classes, zooms = [0.5, 0.71, 1.0], teams = [0, 1]) {
      for (const cls of classes) for (const t of teams) for (const z of zooms) this.get(getDef(cls), t, z, 0);
    },
    setDpr(v) { if (v !== dpr) { dpr = v; cache.clear(); } },
    get dpr() { return dpr; },
    clear() { cache.clear(); },
    get size() { return cache.size; },
    get builds() { return builds; },
  };
}

// ---------------------------------------------------------------------------
// Blitting and live details
// ---------------------------------------------------------------------------

/**
 * Blit a cached sprite: one setTransform + one drawImage.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} s sprite from the cache
 * @param {number} sx screen x (CSS px)
 * @param {number} sy screen y (CSS px)
 * @param {number} cos cos(heading)
 * @param {number} sin sin(heading)
 * @param {number} zoom
 * @param {number} dpr
 * @param {number} [alpha]
 * @param {number} [scaleY] breathing wobble
 */
export function blitShip(ctx, s, sx, sy, cos, sin, zoom, dpr, alpha = 1, scaleY = 1) {
  const f = ((s.size / 100) * zoom * dpr) / s.k;
  const fy = f * scaleY;
  ctx.setTransform(cos * f, sin * f, -sin * fy, cos * fy, sx * dpr, sy * dpr);
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(s.canvas, -s.ox, -s.oy);
  if (alpha !== 1) ctx.globalAlpha = 1;
}

/** LOD 0: a tiny triangle in hull color with a team-colored dot. */
export function drawLod0(ctx, pal, sx, sy, cos, sin, len, dpr) {
  const l = Math.max(3, len) * dpr;
  ctx.setTransform(cos, sin, -sin, cos, sx * dpr, sy * dpr);
  // team colour owns the silhouette at this size; the faction shows as the lighter nose
  ctx.fillStyle = pal.team;
  ctx.beginPath(); ctx.moveTo(l * 0.6, 0); ctx.lineTo(-l * 0.4, -l * 0.35); ctx.lineTo(-l * 0.4, l * 0.35); ctx.closePath(); ctx.fill();
  ctx.fillStyle = pal.hullLight;
  ctx.beginPath(); ctx.moveTo(l * 0.6, 0); ctx.lineTo(l * 0.1, -l * 0.18); ctx.lineTo(l * 0.1, l * 0.18); ctx.closePath(); ctx.fill();
}

const cellPtsCache = new Map();
function automatonCells(def) {
  let c = cellPtsCache.get(def.id);
  if (c) return c;
  c = [];
  const hull = def.layers.filter((L) => L.kind === 'poly' && (L.fill === 'cells' || L.fill === 'grad:hull')).map(layerPoints);
  const step = 4;
  for (let x = -48; x <= 48; x += step) for (let y = -48; y <= 48; y += step) {
    for (const pts of hull) if (pointInPoly(pts, x + step / 2, y + step / 2)) { c.push([x, y]); break; }
  }
  cellPtsCache.set(def.id, c);
  return c;
}

/**
 * Draw the live animated details of a ship at LOD 2.
 * Transform contract: caller passes screen position (CSS px), heading cos/sin,
 * zoom and dpr; this function sets its own transform (design units).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} def
 * @param {object} pal
 * @param {object} st  { id, thrust (0..1), flags, firing (ms timestamp of last shot), disrupted, boosted }
 * @param {number} now ms
 * @param {object} q   quality { anims: boolean, glow: boolean }
 */
export function drawShipDetails(ctx, def, pal, sx, sy, cos, sin, zoom, dpr, st, now, q) {
  const kd = (def.size / 100) * zoom * dpr;
  ctx.setTransform(cos * kd, sin * kd, -sin * kd, cos * kd, sx * dpr, sy * dpr);
  const t = now / 1000;
  const id = st.id | 0;
  const phase = hash01(id, 11) * TAU;
  const disrupted = !!st.disrupted;
  const ek = DEFAULT_ENGINE_KIND[def.faction];
  const thrust = clamp(st.thrust ?? 0.5, 0, 1);
  const boost = st.boosted ? 1.6 : 1;

  // --- engines ---
  const engines = def.engines || [];
  if (engines.length && !disrupted) {
    if (ek === 'flame') {
      const n = noise1(t * 30 + phase, id) * 3;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = pal.team; ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (const e of engines) {
        const len = (6 + 12 * thrust + n) * boost;
        ctx.moveTo(e.x, e.y - e.w / 2); ctx.lineTo(e.x - len, e.y); ctx.lineTo(e.x, e.y + e.w / 2);
      }
      ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.85;
      ctx.beginPath();
      for (const e of engines) {
        const len = (3 + 6 * thrust + n * 0.5) * boost;
        ctx.moveTo(e.x, e.y - e.w / 4); ctx.lineTo(e.x - len, e.y); ctx.lineTo(e.x, e.y + e.w / 4);
      }
      ctx.fill();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    } else if (ek === 'light') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.strokeStyle = pal.team; ctx.globalAlpha = 0.35; ctx.lineWidth = 3;
      ctx.beginPath();
      for (const e of engines) { ctx.moveTo(e.x, e.y); ctx.lineTo(e.x - (10 + 18 * thrust) * boost, e.y); }
      ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const e of engines) { ctx.moveTo(e.x, e.y); ctx.lineTo(e.x - (6 + 10 * thrust) * boost, e.y); }
      ctx.stroke();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    } else if (ek === 'pixel') {
      ctx.fillStyle = pal.team; ctx.globalAlpha = 0.9;
      const sh = (t * 40) % 4;
      for (const e of engines) for (let i = 0; i < 3; i++) {
        const d = 3 + i * 4 + sh;
        ctx.fillRect(e.x - d, e.y - 0.6, 1.4, 1.2);
      }
      ctx.globalAlpha = 1;
    } else if (ek === 'spore') {
      ctx.globalCompositeOperation = 'lighter';
      const g = getGlow(pal.team);
      ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t * 6 + phase);
      for (const e of engines) { const r = e.w * (0.9 + thrust * 0.6); ctx.drawImage(g, e.x - r - 2, e.y - r, r * 2, r * 2); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }

  if (!q.anims) { return; }

  // --- emissive live layers ---
  let glowPass = false;
  const beginGlow = () => { if (!glowPass) { ctx.globalCompositeOperation = 'lighter'; glowPass = true; } };
  const endGlow = () => { if (glowPass) { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; glowPass = false; } };

  for (let i = 0; i < def.layers.length; i++) {
    const L = def.layers[i];
    switch (L.kind) {
      case 'core': {
        const col = pal[L.color] || L.color || pal.team;
        const p = L.pulse || { amp: 0, hz: 1 };
        const r = L.r * (1 + p.amp * Math.sin(t * p.hz * TAU + phase + (p.phase || 0)) * (disrupted ? 0.2 : 1));
        beginGlow();
        const gr = r * (L.glow || 3);
        ctx.globalAlpha = disrupted ? 0.35 : 0.85;
        ctx.drawImage(getGlow(col), L.x - gr, L.y - gr, gr * 2, gr * 2);
        ctx.fillStyle = '#ffffff'; ctx.globalAlpha = disrupted ? 0.3 : 0.75;
        ctx.beginPath(); ctx.arc(L.x, L.y, r * 0.55, 0, TAU); ctx.fill();
        break;
      }
      case 'ring': {
        if (!L.spin) break;
        endGlow();
        const ys = L.mirror ? [L.y, -L.y] : [L.y];
        const spin = ((L.spin * Math.PI) / 180) * t * (disrupted ? 0.15 : 1) + phase;
        for (const y of ys) {
          ctx.save();
          ctx.translate(L.x, y); ctx.rotate(spin); ctx.translate(-L.x, -y);
          drawRing(ctx, L, pal, y, L.lw || 1);
          ctx.restore();
          if (L.mirror && L.y === 0) break;
        }
        break;
      }
      case 'orbit': {
        endGlow();
        ctx.fillStyle = pal[L.fill] || L.fill || pal.team; ctx.globalAlpha = L.alpha ?? 0.7;
        const w = ((L.w * Math.PI) / 180) * t * (disrupted ? 0.2 : 1);
        ctx.beginPath();
        for (let j = 0; j < L.n; j++) {
          const a = w + (j / L.n) * TAU + phase;
          const x = Math.cos(a) * L.R, y = Math.sin(a) * L.R * L.squash + Math.sin(t * 2 + j) * 1.5;
          const l = L.len, h = l * 0.35;
          ctx.moveTo(x + l * 0.6, y); ctx.lineTo(x - l * 0.4, y - h); ctx.lineTo(x - l * 0.4, y + h); ctx.closePath();
        }
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'spot': {
        if (!L.pulse) break;
        beginGlow();
        const col = pal[L.color] || L.color || pal.team;
        const a = (0.5 + 0.5 * Math.sin(t * L.pulse * TAU + (L.phase || 0) * 1.7 + phase)) * (disrupted ? 0.3 : 1);
        ctx.globalAlpha = 0.25 + 0.6 * a;
        const g = getGlow(col), r = L.r * 2.6;
        ctx.drawImage(g, L.x - r, L.y - r, r * 2, r * 2);
        if (L.mirror && L.y !== 0) ctx.drawImage(g, L.x - r, -L.y - r, r * 2, r * 2);
        break;
      }
      case 'light': {
        const col = pal[L.color] || L.color || pal.team;
        const on = L.strobe ? ((t * 0.5) % 1) < 0.05 : ((t * (L.blink || 1) + phase) % 1) < 0.5;
        beginGlow();
        ctx.globalAlpha = on ? 1 : 0.25;
        const g = getGlow(on ? mix(col, '#ffffff', 0.4) : col), r = L.r * (on ? 3.2 : 1.6);
        ctx.drawImage(g, L.x - r, L.y - r, r * 2, r * 2);
        if (L.mirror && L.y !== 0) ctx.drawImage(g, L.x - r, -L.y - r, r * 2, r * 2);
        break;
      }
      case 'trace': {
        endGlow();
        // running dot along the trace
        const pts = L.pts;
        let total = 0; const segs = [];
        for (let j = 1; j < pts.length; j++) { const d = Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]); segs.push(d); total += d; }
        let d = ((t * 25 + phase * 5) % total);
        for (let j = 0; j < segs.length; j++) {
          if (d <= segs[j]) {
            const u = d / segs[j];
            const x = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * u, y = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u;
            ctx.fillStyle = pal.accent; ctx.globalAlpha = 0.95;
            ctx.fillRect(x - 1, y - 1, 2, 2);
            if (L.mirror) ctx.fillRect(x - 1, -y - 1, 2, 2);
            ctx.globalAlpha = 1;
            break;
          }
          d -= segs[j];
        }
        break;
      }
      default: break;
    }
  }
  endGlow();

  // --- faction anims ---
  for (const A of def.anim || []) {
    if (A.type === 'automaton') {
      if (disrupted) continue;
      const cells = automatonCells(def);
      if (!cells.length) continue;
      const frame = Math.floor(t * A.hz);
      ctx.fillStyle = pal.team; ctx.globalAlpha = 0.85;
      const n = Math.min(A.n, cells.length);
      for (let j = 0; j < n; j++) {
        const ci = hashInt(id, frame - (j % 3), j) % cells.length;
        if (hash01(id, frame, j + 100) < 0.5) { const c = cells[ci]; ctx.fillRect(c[0] + 0.5, c[1] + 0.5, 3, 3); }
      }
      ctx.globalAlpha = 1;
    } else if (A.type === 'twinkle') {
      const per = A.every ? (A.every[0] + A.every[1]) / 2 : 0.5;
      const slot = Math.floor((t + phase) / per);
      const age = (t + phase) - slot * per;
      if (age < 0.08) {
        const polys = def.layers.filter((L) => L.kind === 'poly' && L.fill === 'crystal');
        if (polys.length) {
          const L = polys[hashInt(id, slot) % polys.length];
          const pts = layerPoints(L);
          const p = pts[hashInt(id, slot, 1) % pts.length];
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.7 * (1 - age / 0.08);
          ctx.drawImage(getGlow('#ffffff'), p[0] - 5, p[1] - 5, 10, 10);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        }
      }
    } else if (A.type === 'strobe') {
      if (((t * A.hz + phase) % 1) < 0.05) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(getGlow('#ffffff'), A.x - 8, A.y - 8, 16, 16);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }
  ctx.globalAlpha = 1;
}

/** Breathing wobble (vorrax) for the whole-sprite blit. */
export function breatheScale(def, id, now) {
  const A = (def.anim || []).find((a) => a.type === 'breathe');
  if (!A) return 1;
  return 1 + A.amp * Math.sin((now / 1000) * A.hz * TAU + hash01(id | 0, 11) * TAU);
}

/** World-space shield radius for a definition. */
export function shieldRadius(def) {
  return def.size * (def.shieldR || 0.62);
}

/** Muzzle position (world units offset, unrotated) for a weapon kind, or the nose. */
export function muzzleOffset(def, kindHint, salvoIndex = 0) {
  const ts = def.turrets || [];
  let cands = ts;
  if (kindHint) {
    const f = ts.filter((t) => t.kind === kindHint);
    if (f.length) cands = f;
  }
  if (!cands.length) return { x: def.size * 0.45, y: 0 };
  const t = cands[salvoIndex % cands.length];
  return { x: (t.x * def.size) / 100, y: (t.y * def.size) / 100 };
}
