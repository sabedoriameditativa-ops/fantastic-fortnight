// Precomputed per-(ship class, weapon, target class) tables derived from the
// catalog: accuracy, effective damage fraction, dps. Built once per process,
// deterministic (no RNG), shared by all battles.

import { SHIP_LIST, SIZE_CLASS, DAMAGE_MULT, ACCURACY, COMBAT } from '../catalog.js';

export const CLASS_COUNT = SHIP_LIST.length;

/** cls id -> dense index (catalog order). */
export const CLASS_INDEX = Object.freeze(Object.fromEntries(SHIP_LIST.map((s, i) => [s.id, i])));

/** Size class name -> index. */
export const SIZE_INDEX = Object.freeze(Object.fromEntries(Object.entries(SIZE_CLASS).map(([k, v]) => [k, v.index])));

/**
 * Base accuracy of a weapon vs a target size including the attacker's faction
 * passive (Ferrix +0.10 vs tiny/small). No range/speed mods.
 * @param {string} faction attacker faction id
 * @param {object} weapon catalog weapon
 * @param {number} sizeIdx target size index
 */
export function baseAccuracy(faction, weapon, sizeIdx) {
  if (weapon.contact) return 1;
  let p = ACCURACY[weapon.type][sizeIdx];
  if (faction === 'ferrix' && sizeIdx <= 1) p += COMBAT.ferrixNeuralAccuracy;
  return p;
}

/**
 * Fraction of a single shot's raw damage that ends up as effective (shield+hull)
 * damage against a target class, weighting shield vs hull by the class ehp mix
 * and including flat DR (railgun ignores DR).
 */
function hitFraction(weapon, target) {
  const m = DAMAGE_MULT[weapon.type];
  const cap = target.shield.cap, hp = target.hp;
  const f = cap / (cap + hp);
  const hm = m[target.hullType];
  let hullFrac = hm;
  if (weapon.type !== 'railgun' && target.dr > 0) {
    const dmg = weapon.damage;
    hullFrac = Math.max(dmg * hm * COMBAT.armorFloor, dmg * hm - target.dr) / dmg;
  }
  return f * m.shield + (1 - f) * hullFrac;
}

function build() {
  const n = CLASS_COUNT;
  const acc = new Array(n);       // acc[c][w] = Float64Array(n) by target class
  const frac = new Array(n);      // frac[c][w] = Float64Array(n)
  const wdps = new Array(n);      // wdps[c][w] = Float64Array(n)
  const shipDps = new Array(n);   // shipDps[c] = Float64Array(n)
  const shipEff = new Array(n);   // shipDps / raw dps
  const maxRange = new Float64Array(n);
  const rawDps = new Float64Array(n);
  const alpha = new Float64Array(n);  // dps-weighted mean per-shot damage (overkill heuristic)
  const engageRange = new Float64Array(n); // dps-weighted mean weapon range (movement)
  const sizeIdx = new Int8Array(n);
  const minTargetIdx = new Array(n); // per weapon
  for (let c = 0; c < n; c++) {
    const s = SHIP_LIST[c];
    sizeIdx[c] = SIZE_INDEX[s.sizeClass];
    acc[c] = []; frac[c] = []; wdps[c] = []; minTargetIdx[c] = [];
    shipDps[c] = new Float64Array(n);
    shipEff[c] = new Float64Array(n);
    let raw = 0, alphaSum = 0, rangeSum = 0;
    for (let w = 0; w < s.weapons.length; w++) {
      const wp = s.weapons[w];
      const wdpsRaw = (wp.damage * wp.salvo) / wp.cooldown;
      raw += wdpsRaw;
      alphaSum += wp.damage * wdpsRaw;
      rangeSum += wp.range * wdpsRaw;
      if (wp.range > maxRange[c]) maxRange[c] = wp.range;
      const minIdx = SIZE_INDEX[wp.minTargetClass] ?? 0;
      minTargetIdx[c][w] = minIdx;
      const a = new Float64Array(n), fr = new Float64Array(n), d = new Float64Array(n);
      for (let t = 0; t < n; t++) {
        const ts = SHIP_LIST[t];
        const tsize = SIZE_INDEX[ts.sizeClass];
        a[t] = tsize < minIdx ? 0 : baseAccuracy(s.faction, wp, tsize);
        fr[t] = hitFraction(wp, ts);
        d[t] = tsize < minIdx ? 0 : ((wp.damage * wp.salvo) / wp.cooldown) * a[t] * fr[t];
        shipDps[c][t] += d[t];
      }
      acc[c][w] = a; frac[c][w] = fr; wdps[c][w] = d;
    }
    rawDps[c] = raw;
    alpha[c] = raw > 0 ? alphaSum / raw : 0;
    engageRange[c] = raw > 0 ? rangeSum / raw : maxRange[c];
    for (let t = 0; t < n; t++) shipEff[c][t] = raw > 0 ? shipDps[c][t] / raw : 0;
  }
  return { acc, frac, wdps, shipDps, shipEff, maxRange, engageRange, rawDps, alpha, sizeIdx, minTargetIdx };
}

let cache = null;
/** Lazily built tables (see build()). */
export function getTables() {
  if (!cache) cache = build();
  return cache;
}


