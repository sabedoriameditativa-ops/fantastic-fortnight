// Deterministic seeded pseudo-random number generator (xoshiro128**).
// Used by the simulation so that the same seed + same inputs always produce
// the same battle, on the server and in the browser.

/**
 * Hash a string or number into a 32-bit unsigned integer seed (FNV-1a).
 * @param {string|number} input
 * @returns {number}
 */
export function hashSeed(input) {
  const s = String(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Create a seeded RNG.
 * @param {string|number} seed
 * @returns {{
 *   next(): number,            // float in [0, 1)
 *   int(min: number, max: number): number, // integer in [min, max] inclusive
 *   range(min: number, max: number): number, // float in [min, max)
 *   chance(p: number): boolean, // true with probability p
 *   pick<T>(arr: T[]): T,       // uniform element (undefined if empty)
 *   shuffle<T>(arr: T[]): T[],  // in-place Fisher-Yates, returns arr
 *   state(): number[],          // serializable internal state
 *   seed: string|number
 * }}
 */
export function createRng(seed = 1) {
  // SplitMix32 to expand the seed into 4 non-zero state words.
  let x = hashSeed(seed) | 0;
  const splitmix = () => {
    x = (x + 0x9e3779b9) | 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = splitmix(), b = splitmix(), c = splitmix(), d = splitmix();
  if ((a | b | c | d) === 0) d = 1;

  function nextU32() {
    const result = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0;
    const t = b << 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = rotl(d, 11);
    return result;
  }

  const rng = {
    seed,
    next() {
      return nextU32() / 4294967296;
    },
    int(min, max) {
      if (max < min) [min, max] = [max, min];
      return min + Math.floor(rng.next() * (max - min + 1));
    },
    range(min, max) {
      return min + rng.next() * (max - min);
    },
    chance(p) {
      return rng.next() < p;
    },
    pick(arr) {
      if (!arr || arr.length === 0) return undefined;
      return arr[Math.floor(rng.next() * arr.length)];
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    },
    state() {
      return [a, b, c, d];
    },
  };
  return rng;
}

function rotl(v, k) {
  return ((v << k) | (v >>> (32 - k))) >>> 0;
}
