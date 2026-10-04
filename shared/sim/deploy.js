// Initial deployment layout (SPEC §1): team 0 on the left facing +x, team 1
// mirrored on the right. Each player owns a horizontal lane; inside the lane
// ships sit in columns by size class from the rear (mothership … tiny).

import { SHIPS, SHIP_LIST, SIZE_CLASSES, SIZE_CLASS } from '../catalog.js';
import { SPAWN_X_FRACTION, LANE_HEIGHT_MIN } from '../constants.js';

const COLUMN_GAP = 70;
const CATALOG_ORDER = Object.fromEntries(SHIP_LIST.map((s, i) => [s.id, i]));

/**
 * Expand a fleet into class ids in deployment order: bigger size classes first,
 * catalog order within a size class, repeated `count` times.
 * @param {{ships: {cls: string, count: number}[]}} fleet
 * @returns {string[]}
 */
export function expandFleet(fleet) {
  const entries = (fleet.ships || []).filter((e) => e && SHIPS[e.cls] && e.count > 0);
  entries.sort((a, b) => {
    const sa = SIZE_CLASS[SHIPS[a.cls].sizeClass].index, sb = SIZE_CLASS[SHIPS[b.cls].sizeClass].index;
    if (sa !== sb) return sb - sa;
    return CATALOG_ORDER[a.cls] - CATALOG_ORDER[b.cls];
  });
  const out = [];
  for (const e of entries) for (let i = 0; i < e.count; i++) out.push(e.cls);
  return out;
}

/**
 * Lay out one player's fleet inside its lane. Returns positions in team-0
 * (left side) coordinates; the caller mirrors for team 1.
 * @param {string[]} classes expanded class ids (deployment order)
 * @param {number} laneTop
 * @param {number} laneH
 * @param {number} startX
 * @returns {{cls: string, x: number, y: number}[]}
 */
export function layoutLane(classes, laneTop, laneH, startX) {
  const out = [];
  const laneCenter = laneTop + laneH / 2;
  let x = startX;
  let prevRadius = 0;
  for (let si = SIZE_CLASSES.length - 1; si >= 0; si--) {
    const size = SIZE_CLASSES[si];
    const group = classes.filter((c) => SHIPS[c].sizeClass === size);
    if (group.length === 0) continue;
    const r = SIZE_CLASS[size].radius;
    if (prevRadius > 0) x += Math.max(COLUMN_GAP, prevRadius + r + 10);
    const minSpacing = r * 2.5;
    const cap = Math.max(minSpacing, 90);
    const available = Math.max(minSpacing, laneH - 2 * r);
    const n = group.length;
    let rows = 1;
    if (n * minSpacing > available) rows = Math.ceil((n * minSpacing) / available);
    const perRow = Math.ceil(n / rows);
    const spacing = Math.min(cap, available / perRow);
    const rowStep = minSpacing;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / perRow);
      const col = i - row * perRow;
      const countInRow = Math.min(perRow, n - row * perRow);
      const y = laneCenter + (col - (countInRow - 1) / 2) * spacing;
      out.push({ cls: group[i], x: x + row * rowStep, y });
    }
    x += (rows - 1) * rowStep;
    prevRadius = r;
  }
  return out;
}

/**
 * Plan the initial deployment of every player.
 * @param {import('../../docs/ARCHITECTURE.md').BattlePlayer[]} players
 * @param {{w: number, h: number}} world
 * @returns {{cls: string, owner: string, team: 0|1, x: number, y: number, a: number}[]}
 */
export function planDeployment(players, world) {
  const out = [];
  for (let team = 0; team < 2; team++) {
    const members = players.filter((p) => p.team === team);
    const k = members.length;
    if (k === 0) continue;
    const laneH = Math.max(LANE_HEIGHT_MIN, world.h / k);
    const totalH = laneH * k;
    const top0 = world.h / 2 - totalH / 2;
    const startX = SPAWN_X_FRACTION * world.w;
    for (let i = 0; i < k; i++) {
      const p = members[i];
      const classes = expandFleet(p.fleet);
      const placed = layoutLane(classes, top0 + i * laneH, laneH, startX);
      for (const s of placed) {
        const r = SHIPS[s.cls].radius;
        let x = s.x, y = Math.min(world.h - r, Math.max(r, s.y));
        let a = 0;
        if (team === 1) { x = world.w - x; a = Math.PI; }
        out.push({ cls: s.cls, owner: p.id, team, x, y, a });
      }
    }
  }
  return out;
}
