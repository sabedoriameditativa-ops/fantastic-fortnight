// Movement actuator (SPEC §2.1): "car with lateral drag" steering, separation,
// arena bounds (soft push-back + hard clamp) and one pass of overlap correction.

import { DT } from '../constants.js';
import { SIZE_CLASS } from '../catalog.js';
import { angleDiff, clamp, wrapAngle } from './math.js';
import { queryBox } from './spatial.js';
import { maxSpeed } from './ship.js';
import { orderedShips } from './queries.js';

const LATERAL_DRAG = 4;        // per second
const SEP_GAIN = 1.4;
const SEP_MARGIN = 12;
const EDGE_SOFT = 100;
const MAX_RADIUS = SIZE_CLASS.mothership.radius;

const desired = { dx: 0, dy: 0, speed: 0 };
const idBuf = [];

/**
 * Add the separation push (SPEC §2.1) of nearby ships to the desired direction.
 * @returns {number} push magnitude before normalization
 */
export function separation(state, s, out) {
  const ships = state.ships;
  const r = s.radius + MAX_RADIUS + SEP_MARGIN;
  queryBox(state.grid, s.x, s.y, r, idBuf);
  let px = 0, py = 0;
  for (let i = 0; i < idBuf.length; i++) {
    const o = ships[idBuf[i] - 1];
    if (o === s || !o.alive || o.latch) continue;
    const dx = s.x - o.x, dy = s.y - o.y;
    const sep = s.radius + o.radius + SEP_MARGIN;
    const d2 = dx * dx + dy * dy;
    if (d2 >= sep * sep) continue;
    let d = Math.sqrt(d2);
    let nx, ny;
    if (d < 1e-6) { // exact overlap: deterministic direction (the higher id is pushed toward its own facing)
      d = 1e-6; nx = ((s.id > o.id) ? 1 : -1) * (s.team === 0 ? 1 : -1); ny = 0;
    } else { nx = dx / d; ny = dy / d; }
    const w = (1 - d / sep) * (1 - d / sep) * (o.mass / (s.mass + o.mass)) * SEP_GAIN;
    px += nx * w; py += ny * w;
  }
  out.px = px; out.py = py;
  return Math.sqrt(px * px + py * py);
}

const sepOut = { px: 0, py: 0 };

/**
 * Steer one ship toward (dx, dy) at `speed` and integrate one tick.
 * @param {object} s ship
 * @param {number} dx desired direction x (need not be normalized)
 * @param {number} dy
 * @param {number} speed desired forward speed (u/s)
 * @param {number} cap max speed (u/s)
 * @param {number} turnRate rad/s
 */
export function steer(s, dx, dy, speed, cap, turnRate) {
  const len = Math.sqrt(dx * dx + dy * dy);
  let dAng = 0;
  if (len > 1e-9) {
    const want = Math.atan2(dy, dx);
    dAng = angleDiff(want, s.heading);
    const maxTurn = turnRate * DT;
    s.heading = wrapAngle(s.heading + clamp(dAng, -maxTurn, maxTurn));
  }
  const fx = Math.cos(s.heading), fy = Math.sin(s.heading);
  const align = Math.cos(dAng);
  const targetSpeed = Math.min(cap, speed * (align > 0.3 ? align : 0));
  const fwd = s.vx * fx + s.vy * fy;
  const dv = clamp(targetSpeed - fwd, -s.accel * DT, s.accel * DT);
  s.vx += fx * dv; s.vy += fy * dv;
  // lateral drag
  const lat = s.vx * -fy + s.vy * fx;
  const k = Math.min(1, LATERAL_DRAG * DT);
  s.vx -= -fy * lat * k; s.vy -= fx * lat * k;
  // never exceed the cap
  const v2 = s.vx * s.vx + s.vy * s.vy;
  if (v2 > cap * cap) {
    const f = cap / Math.sqrt(v2);
    s.vx *= f; s.vy *= f;
  }
  s.x += s.vx * DT; s.y += s.vy * DT;
}

/** Hard clamp inside the arena, killing velocity into the wall. */
export function clampToArena(s, w, h) {
  const r = s.radius;
  if (s.x < r) { s.x = r; if (s.vx < 0) s.vx = 0; }
  else if (s.x > w - r) { s.x = w - r; if (s.vx > 0) s.vx = 0; }
  if (s.y < r) { s.y = r; if (s.vy < 0) s.vy = 0; }
  else if (s.y > h - r) { s.y = h - r; if (s.vy > 0) s.vy = 0; }
}

/**
 * Move every alive ship: desired intent (from `desiredFn`), separation, soft
 * bounds, steering, integration; then overlap correction and hard clamp.
 * @param {object} state
 * @param {(state: object, s: object, out: {dx:number,dy:number,speed:number}) => void} desiredFn
 */
export function moveShips(state, desiredFn) {
  const tick = state.tick;
  const w = state.world.w, h = state.world.h;
  const ord = orderedShips(state); // this tick's team order (alternates per tick)
  for (let i = 0; i < ord.length; i++) {
    const s = ord[i];
    if (!s.alive) continue;
    if (s.latch) continue; // positioned by the latch host
    const cap = maxSpeed(s, tick);
    if (s.stunUntil > tick) { s.vx *= 0.8; s.vy *= 0.8; s.x += s.vx * DT; s.y += s.vy * DT; clampToArena(s, w, h); continue; }
    if (s.pilotControl?.manual) {
      const c = s.pilotControl;
      // Independent thrust and aim: arrows strafe, mouse/keyboard aim rotates the gun.
      const ax = c.moveX * cap - s.vx, ay = c.moveY * cap - s.vy;
      const delta = Math.hypot(ax, ay), f = delta > 0 ? Math.min(1, s.accel * 3 * DT / delta) : 0;
      s.vx += ax * f; s.vy += ay * f;
      const v = Math.hypot(s.vx, s.vy); if (v > cap) { s.vx *= cap / v; s.vy *= cap / v; }
      const turn = s.turnRate * s.mod.turnMul * DT;
      s.heading = wrapAngle(s.heading + clamp(angleDiff(Math.atan2(c.aimY - s.y, c.aimX - s.x), s.heading), -turn, turn));
      s.x += s.vx * DT; s.y += s.vy * DT; clampToArena(s, w, h);
      continue;
    }
    desired.dx = 0; desired.dy = 0; desired.speed = 0;
    desiredFn(state, s, desired);
    let dx = desired.dx, dy = desired.dy, speed = desired.speed;
    const dl = Math.sqrt(dx * dx + dy * dy);
    if (dl > 1e-9) { dx /= dl; dy /= dl; }
    // separation
    const pm = separation(state, s, sepOut);
    if (pm > 0) {
      dx += sepOut.px; dy += sepOut.py;
      const wanted = Math.min(cap, pm * cap);
      if (wanted > speed) speed = wanted;
    }
    // soft push-back near the edges
    if (s.x < EDGE_SOFT) { dx += (1 - s.x / EDGE_SOFT) * 1.5; speed = Math.max(speed, cap * 0.5); }
    else if (s.x > w - EDGE_SOFT) { dx -= (1 - (w - s.x) / EDGE_SOFT) * 1.5; speed = Math.max(speed, cap * 0.5); }
    if (s.y < EDGE_SOFT) { dy += (1 - s.y / EDGE_SOFT) * 1.5; speed = Math.max(speed, cap * 0.5); }
    else if (s.y > h - EDGE_SOFT) { dy -= (1 - (h - s.y) / EDGE_SOFT) * 1.5; speed = Math.max(speed, cap * 0.5); }
    if (cap <= 0) speed = 0;
    steer(s, dx, dy, Math.min(speed, cap), cap, s.turnRate * s.mod.turnMul);
    clampToArena(s, w, h);
  }
  resolveOverlaps(state);
}

/** One pass of hard overlap correction (mass-weighted), pairs in id order. */
export function resolveOverlaps(state) {
  const ships = state.ships;
  const w = state.world.w, h = state.world.h;
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i];
    if (!s.alive || s.latch) continue;
    queryBox(state.grid, s.x, s.y, s.radius + MAX_RADIUS + 20, idBuf);
    for (let k = 0; k < idBuf.length; k++) {
      const oid = idBuf[k];
      if (oid <= s.id) continue;
      const o = ships[oid - 1];
      if (!o.alive || o.latch) continue;
      const dx = o.x - s.x, dy = o.y - s.y;
      const minD = s.radius + o.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) continue;
      let d = Math.sqrt(d2), nx, ny;
      if (d < 1e-6) { d = 1e-6; nx = s.team === 0 ? 1 : -1; ny = 0; } else { nx = dx / d; ny = dy / d; } // exact overlap: push along the lower id's facing
      const overlap = minD - d;
      const tot = s.mass + o.mass;
      const fs = o.mass / tot, fo = s.mass / tot;
      s.x -= nx * overlap * fs; s.y -= ny * overlap * fs;
      o.x += nx * overlap * fo; o.y += ny * overlap * fo;
      clampToArena(s, w, h); clampToArena(o, w, h);
    }
  }
}
