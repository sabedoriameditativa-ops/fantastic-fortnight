// Formatting helpers (pt-BR locale).

const NF = typeof Intl !== 'undefined' ? new Intl.NumberFormat('pt-BR') : null;

/** Integer with pt-BR thousands separators. */
export function num(n) {
  const v = Math.round(Number(n) || 0);
  return NF ? NF.format(v) : String(v);
}

/** Number with up to `d` decimals, pt-BR comma. */
export function dec(n, d = 1) {
  const v = Number(n) || 0;
  const s = v.toFixed(d);
  return s.replace('.', ',');
}

/** Percentage 0..1 → "42%". */
export function pct(frac) {
  return `${Math.round(Math.max(0, Math.min(1, Number(frac) || 0)) * 100)}%`;
}

/** Seconds → "mm:ss". */
export function mmss(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Ticks → "mm:ss" at a tick rate. */
export function ticksToClock(ticks, tickRate = 20) {
  return mmss((Number(ticks) || 0) / tickRate);
}

/** Clamp helper. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Pluralize: one(1) / many(n). */
export function plural(n, one, many) {
  return n === 1 ? one : many;
}

/** Seconds with unit ("3 s", "0,5 s"). */
export function secs(s) {
  const v = Number(s) || 0;
  return (Number.isInteger(v) ? String(v) : dec(v, 1)) + ' s';
}
