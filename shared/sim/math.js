// Small deterministic math helpers for the simulation (no allocation).

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a) {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Signed smallest difference a - b wrapped to (-PI, PI]. */
export function angleDiff(a, b) {
  return wrapAngle(a - b);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function dist(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

export function dist2(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Deterministic "gaussian-ish" noise: sigma * (u1+u2+u3-1.5) * 2 (SPEC 3.6). */
export function noise(rng, sigma) {
  if (sigma <= 0) return 0;
  return sigma * (rng.next() + rng.next() + rng.next() - 1.5) * 2;
}

/** Stable in-place insertion sort of arr[0..n) by key(x) ascending (used on nearly sorted queues). */
export function insertionSortBy(arr, n, key) {
  for (let i = 1; i < n; i++) {
    const v = arr[i];
    const k = key(v);
    let j = i - 1;
    while (j >= 0 && key(arr[j]) > k) {
      arr[j + 1] = arr[j];
      j--;
    }
    arr[j + 1] = v;
  }
}
