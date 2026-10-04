// Frame buffer + interpolation for the battle renderer.
//
// Frames arrive as { k: tick, s: snapshot rows, e: events, at: arrival ms }
// every `snapshotEvery` ticks. The presentation clock runs `delayMs` behind
// the newest frame so there is always a pair of frames to interpolate between.
// Events of a frame are released when the presentation tick crosses frame.k,
// so VFX/SFX line up with the interpolated positions.
//
// Pure module (no DOM) — unit-tested in Node. Snapshot rows follow
// docs/ARCHITECTURE.md §3: [id, x*10, y*10, heading 0..255, hp‰, shield‰, flags].

const DEFAULTS = {
  tickMs: 50,
  snapshotEvery: 2,
  delayMs: 120,
  maxExtrapolateMs: 100,   // never present further than this past the newest frame
  snapTicks: 40,           // if the presentation clock lags/leads more than this → snap
  maxFrames: 64,
  posScale: 10,
  angleSteps: 256,
};

/**
 * @typedef {Object} ShipView
 * @property {number} id
 * @property {number} x
 * @property {number} y
 * @property {number} a     heading radians (0 = +x)
 * @property {number} hp    hull permille 0..1000
 * @property {number} sh    shield permille 0..1000
 * @property {number} flags FLAG bits
 * @property {number} vx    estimated velocity u/s (from the frame pair)
 * @property {number} vy
 */

/** Shortest-arc angle interpolation. */
export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  let r = a + d * t;
  if (r > Math.PI) r -= Math.PI * 2;
  else if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/** Decode a snapshot heading byte (0..255) into radians in (-π, π]. */
export function decodeAngle(h, steps = 256) {
  let a = (h / steps) * Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  return a;
}

/**
 * Create an interpolator.
 * @param {Partial<typeof DEFAULTS> & { newShip?: (id:number)=>object }} [opts]
 */
export function createInterpolator(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const nominalRate = 1 / o.tickMs; // ticks per ms at 1x
  /** @type {{k:number,s:number[][],e:any[],at:number,byId:Map<number,number[]>}[]} */
  let frames = [];
  let rate = nominalRate;
  let presTick = -1;          // presentation tick (float); -1 = not started
  let lastNow = -1;
  let presentedK = -Infinity; // highest frame.k whose events were released
  let lastFrameK = -Infinity;
  const ships = new Map();
  /** @type {any[]} */
  const pendingEvents = [];
  let extrapolating = false;

  function indexFrame(f) {
    const byId = new Map();
    for (const row of f.s) byId.set(row[0], row);
    return { k: f.k, s: f.s, e: f.e || [], at: f.at, byId };
  }

  function makeView(id) {
    const v = { id, x: 0, y: 0, a: 0, hp: 1000, sh: 0, flags: 0, vx: 0, vy: 0 };
    if (o.newShip) Object.assign(v, o.newShip(id) || {});
    return v;
  }

  /** Locate the frame pair around a presentation tick. */
  function locate(tick) {
    let ai = -1;
    for (let i = frames.length - 1; i >= 0; i--) { if (frames[i].k <= tick) { ai = i; break; } }
    return ai;
  }

  function reset() {
    frames = [];
    rate = nominalRate;
    presTick = -1;
    lastNow = -1;
    presentedK = -Infinity;
    lastFrameK = -Infinity;
    ships.clear();
    pendingEvents.length = 0;
    extrapolating = false;
  }

  return {
    /**
     * Push a frame. Frames with non-increasing ticks reset the buffer (new battle).
     * @param {{k:number,s:number[][],e?:any[],at?:number}} frame
     */
    push(frame) {
      const at = frame.at ?? lastNow;
      if (frames.length && frame.k <= lastFrameK) {
        if (frame.k < lastFrameK - o.snapTicks) reset(); // a new battle restarted the clock
        else return; // duplicate / out of order: ignore
      }
      const f = indexFrame({ ...frame, at });
      const prev = frames[frames.length - 1];
      if (prev && Number.isFinite(prev.at) && Number.isFinite(at)) {
        const dtMs = at - prev.at;
        if (dtMs > 0 && dtMs < 1000) {
          const inst = (f.k - prev.k) / dtMs;
          const clamped = Math.min(nominalRate * 6, Math.max(nominalRate * 0.25, inst));
          rate += (clamped - rate) * 0.15;
        }
      }
      frames.push(f);
      lastFrameK = f.k;
      if (frames.length > o.maxFrames) {
        // consumer stalled: keep the newest frames, release skipped events
        const drop = frames.length - o.maxFrames;
        for (let i = 0; i < drop; i++) if (frames[i].k > presentedK) { pendingEvents.push(...frames[i].e); presentedK = frames[i].k; }
        frames.splice(0, drop);
        presTick = -1; // force a snap on the next sample
      }
    },

    /**
     * Sample the presentation state at `now` (ms). Returns the ship map (owned by
     * the interpolator, updated in place), the presentation tick and the events
     * whose frames were crossed since the previous sample.
     * @param {number} now
     * @returns {{ tick:number, ships:Map<number,ShipView>, events:any[], extrapolating:boolean, buffered:number }}
     */
    sample(now) {
      const events = [];
      if (pendingEvents.length) { events.push(...pendingEvents); pendingEvents.length = 0; }
      if (!frames.length) { lastNow = now; return { tick: presTick, ships, events, extrapolating: false, buffered: 0 }; }
      const newest = frames[frames.length - 1];
      const newestAt = Number.isFinite(newest.at) ? newest.at : now;
      // Target: newest frame's tick advanced to `now`, minus the presentation delay.
      const target = newest.k + Math.max(0, now - newestAt) * rate - o.delayMs * rate;
      const dt = lastNow < 0 ? 0 : Math.max(0, Math.min(250, now - lastNow));
      lastNow = now;
      if (presTick < 0) {
        presTick = Math.max(frames[0].k, target);
      } else {
        presTick += dt * rate;                       // feed-forward
        const err = target - presTick;
        if (Math.abs(err) > o.snapTicks) presTick = target;
        else presTick += err * Math.min(1, dt / 300);  // proportional catch-up
      }
      // bounded extrapolation past the newest frame
      const maxTick = newest.k + o.maxExtrapolateMs * rate;
      if (presTick > maxTick) presTick = maxTick;
      if (presTick < frames[0].k) presTick = frames[0].k;

      // release events of crossed frames (in order)
      for (const f of frames) {
        if (f.k <= presTick && f.k > presentedK) { if (f.e.length) events.push(...f.e); presentedK = f.k; }
      }

      // locate pair
      const ai = locate(presTick);
      const a = frames[ai];
      const b = frames[ai + 1] || null;
      const prev = frames[ai - 1] || null;
      extrapolating = !b && presTick > a.k;
      const seen = new Set();
      const ps = o.posScale, steps = o.angleSteps;
      const tickSec = o.tickMs / 1000;

      if (b) {
        const u = b.k === a.k ? 0 : Math.max(0, Math.min(1, (presTick - a.k) / (b.k - a.k)));
        const span = (b.k - a.k) * tickSec;
        for (const ra of a.s) {
          const id = ra[0];
          const rb = b.byId.get(id);
          let v = ships.get(id);
          if (!v) { v = makeView(id); ships.set(id, v); }
          const ax = ra[1] / ps, ay = ra[2] / ps, aa = decodeAngle(ra[3], steps);
          if (rb) {
            const bx = rb[1] / ps, by = rb[2] / ps;
            v.x = ax + (bx - ax) * u; v.y = ay + (by - ay) * u;
            v.a = lerpAngle(aa, decodeAngle(rb[3], steps), u);
            v.hp = rb[4]; v.sh = rb[5]; v.flags = rb[6] | 0;
            v.vx = span > 0 ? (bx - ax) / span : 0; v.vy = span > 0 ? (by - ay) / span : 0;
          } else {
            // dying: hold the last state until the 'die' event is presented
            v.x = ax; v.y = ay; v.a = aa; v.hp = ra[4]; v.sh = ra[5]; v.flags = ra[6] | 0; v.vx = 0; v.vy = 0;
          }
          seen.add(id);
        }
      } else {
        const ahead = Math.min(o.maxExtrapolateMs / 1000, Math.max(0, (presTick - a.k) * tickSec));
        const span = prev ? (a.k - prev.k) * tickSec : 0;
        for (const ra of a.s) {
          const id = ra[0];
          let v = ships.get(id);
          if (!v) { v = makeView(id); ships.set(id, v); }
          const ax = ra[1] / ps, ay = ra[2] / ps;
          let vx = 0, vy = 0;
          const rp = prev ? prev.byId.get(id) : null;
          if (rp && span > 0) { vx = (ax - rp[1] / ps) / span; vy = (ay - rp[2] / ps) / span; }
          v.x = ax + vx * ahead; v.y = ay + vy * ahead; v.a = decodeAngle(ra[3], steps);
          v.hp = ra[4]; v.sh = ra[5]; v.flags = ra[6] | 0; v.vx = vx; v.vy = vy;
          seen.add(id);
        }
      }
      for (const id of ships.keys()) if (!seen.has(id)) ships.delete(id);

      // drop frames older than `prev` (keep one before `a` for velocity)
      if (ai > 1) frames.splice(0, ai - 1);

      return { tick: presTick, ships, events, extrapolating, buffered: frames.length - 1 - locate(presTick) };
    },

    /** Current presentation tick (float), -1 before the first sample. */
    get tick() { return presTick; },
    /** Estimated tick rate in ticks per second. */
    get ticksPerSec() { return rate * 1000; },
    /** Newest buffered tick, or -Infinity. */
    get newestTick() { return lastFrameK; },
    get frameCount() { return frames.length; },
    get ships() { return ships; },
    reset,
  };
}
