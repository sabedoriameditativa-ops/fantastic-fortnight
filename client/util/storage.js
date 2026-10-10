// Safe wrappers around localStorage / sessionStorage plus the app's persisted
// records: player name, settings, single-player progress and the last fleet.
// Every read/write is guarded (private mode, quota, disabled storage).
// Pure functions take an explicit `store` so they can be unit-tested in Node.

export const KEYS = Object.freeze({
  name: 'fe.name',
  settings: 'fe.settings',
  progress: 'fe.progress',
  lastFleet: 'fe.lastFleet',
  spSetup: 'fe.spSetup',
  token: 'fe.token',
  playerId: 'fe.playerId',
  room: 'fe.room',
  progressOpts: 'fe.progressOpts',
});

/** @returns {Storage|null} */
export function localStore() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/** @returns {Storage|null} */
export function sessionStore() {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
}

/** In-memory Storage-like fallback (also handy for tests). */
export function memoryStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
  };
}

export function readJson(store, key, fallback) {
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}

export function writeJson(store, key, value) {
  if (!store) return false;
  try { store.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function readString(store, key, fallback = '') {
  if (!store) return fallback;
  try { const v = store.getItem(key); return v === null || v === undefined ? fallback : String(v); } catch { return fallback; }
}

export function writeString(store, key, value) {
  if (!store) return false;
  try { if (value === null || value === undefined) store.removeItem(key); else store.setItem(key, String(value)); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS = Object.freeze({
  master: 0.8, music: 0.6, sfx: 0.8, ui: 0.7, muted: false,
  reducedMotion: 'auto',   // 'auto' | 'on' | 'off'
  quality: 'auto',         // 'auto' | 'low' | 'medium' | 'high'
  showNames: false,
  grid: false,
  speed: 1,                // last used single-player speed
});

/** Merge stored settings over defaults, clamping numbers. */
export function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;
  for (const k of ['master', 'music', 'sfx', 'ui']) {
    const v = Number(raw[k]);
    if (Number.isFinite(v)) s[k] = Math.max(0, Math.min(1, v));
  }
  s.muted = !!raw.muted;
  if (['auto', 'on', 'off'].includes(raw.reducedMotion)) s.reducedMotion = raw.reducedMotion;
  if (['auto', 'low', 'medium', 'high'].includes(raw.quality)) s.quality = raw.quality;
  s.showNames = !!raw.showNames;
  s.grid = !!raw.grid;
  if ([1, 2, 4].includes(raw.speed)) s.speed = raw.speed;
  return s;
}

export function loadSettings(store = localStore()) {
  return normalizeSettings(readJson(store, KEYS.settings, null));
}

export function saveSettings(settings, store = localStore()) {
  return writeJson(store, KEYS.settings, normalizeSettings(settings));
}

// ---------------------------------------------------------------------------
// Progress: { [difficulty]: { max: number, cleared: number[] } }
// ---------------------------------------------------------------------------

export function loadProgress(store = localStore()) {
  const p = readJson(store, KEYS.progress, {});
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
}

/** Pure: returns a new progress object with `level` marked as cleared at `difficulty`. */
export function withLevelCleared(progress, difficulty, level) {
  const lv = Math.floor(Number(level));
  if (!Number.isFinite(lv) || lv < 1 || typeof difficulty !== 'string') return progress;
  const cur = (progress && progress[difficulty]) || { max: 0, cleared: [] };
  const cleared = Array.isArray(cur.cleared) ? cur.cleared.filter((n) => Number.isInteger(n)) : [];
  if (!cleared.includes(lv)) cleared.push(lv);
  cleared.sort((a, b) => a - b);
  return { ...(progress || {}), [difficulty]: { max: Math.max(Number(cur.max) || 0, lv), cleared } };
}

export function isLevelCleared(progress, difficulty, level) {
  const cur = progress && progress[difficulty];
  return !!(cur && Array.isArray(cur.cleared) && cur.cleared.includes(level));
}

export function maxLevelCleared(progress, difficulty) {
  const cur = progress && progress[difficulty];
  return cur ? Number(cur.max) || 0 : 0;
}

/** Best progress across difficulties: { difficulty, max } or null. */
export function bestProgress(progress) {
  let best = null;
  const order = ['facil', 'normal', 'dificil', 'especialista'];
  for (const d of order) {
    const m = maxLevelCleared(progress, d);
    if (m > 0 && (!best || m >= best.max)) best = { difficulty: d, max: m };
  }
  return best;
}

export function saveProgress(progress, store = localStore()) {
  return writeJson(store, KEYS.progress, progress);
}

// ---------------------------------------------------------------------------
// Player name / last fleet / SP setup
// ---------------------------------------------------------------------------

export function loadName(store = localStore()) {
  return readString(store, KEYS.name, '');
}

export function saveName(name, store = localStore()) {
  return writeString(store, KEYS.name, name);
}

export function loadLastFleet(store = localStore()) {
  const f = readJson(store, KEYS.lastFleet, null);
  return f && typeof f === 'object' && typeof f.faction === 'string' && Array.isArray(f.ships) ? f : null;
}

export function saveLastFleet(fleet, store = localStore()) {
  return writeJson(store, KEYS.lastFleet, fleet);
}

export function loadSpSetup(store = localStore()) {
  const s = readJson(store, KEYS.spSetup, null);
  return s && typeof s === 'object' ? s : null;
}

export function saveSpSetup(setup, store = localStore()) {
  return writeJson(store, KEYS.spSetup, setup);
}

// ---------------------------------------------------------------------------
// Progress schema v2 (stars, score and records). The v1 shape above
// ({ [difficulty]: { max, cleared } }) is kept untouched, so isLevelCleared /
// maxLevelCleared / withLevelCleared keep working; v2 adds sibling keys that
// those helpers never touch:
//   v: 2
//   records:  { [difficulty]: { [level]: { stars, score, ticks, at } } }  best per (difficulty, level)
//   skirmish: { [format e.g. '2v2']: { best, wins, played } }             team formats (never campaign)
// Pure functions; app.js persists the object they return.
// ---------------------------------------------------------------------------

export const PROGRESS_VERSION = 2;
export const PROGRESS_DIFFICULTIES = ['facil', 'normal', 'dificil', 'especialista'];

/**
 * Normalize/migrate any stored progress (v1 or v2, partial or corrupt) into the v2 shape.
 * v1 → v2: every level in `cleared` without a record gets a 1-star record with score 0
 * (the old shape only knew that the level was won).
 */
export function normalizeProgress(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { v: PROGRESS_VERSION, records: {}, skirmish: {} };
  for (const d of PROGRESS_DIFFICULTIES) {
    const cur = src[d];
    if (!cur || typeof cur !== 'object') continue;
    const cleared = Array.isArray(cur.cleared) ? cur.cleared.filter((n) => Number.isInteger(n) && n >= 1) : [];
    cleared.sort((a, b) => a - b);
    const max = Math.max(Number(cur.max) || 0, ...cleared, 0);
    out[d] = { max, cleared };
  }
  const recs = src.records && typeof src.records === 'object' ? src.records : {};
  for (const d of PROGRESS_DIFFICULTIES) {
    const table = recs[d] && typeof recs[d] === 'object' ? recs[d] : {};
    const clean = {};
    for (const k of Object.keys(table)) {
      const n = Math.floor(Number(k));
      const r = normalizeRecord(table[k]);
      if (Number.isInteger(n) && n >= 1 && r) clean[n] = r;
    }
    for (const n of (out[d] ? out[d].cleared : [])) if (!clean[n]) clean[n] = { stars: 1, score: 0, ticks: 0, at: 0 };
    if (Object.keys(clean).length) out.records[d] = clean;
  }
  const sk = src.skirmish && typeof src.skirmish === 'object' ? src.skirmish : {};
  for (const f of Object.keys(sk)) {
    if (!/^[2-6]v[2-6]$/.test(f) || !sk[f] || typeof sk[f] !== 'object') continue;
    out.skirmish[f] = { best: Math.max(0, Math.round(Number(sk[f].best) || 0)), wins: Math.max(0, Math.floor(Number(sk[f].wins) || 0)), played: Math.max(0, Math.floor(Number(sk[f].played) || 0)) };
  }
  return out;
}

function normalizeRecord(r) {
  if (!r || typeof r !== 'object') return null;
  const stars = Math.max(0, Math.min(3, Math.floor(Number(r.stars) || 0)));
  if (stars < 1) return null;
  return { stars, score: Math.max(0, Math.round(Number(r.score) || 0)), ticks: Math.max(0, Math.floor(Number(r.ticks) || 0)), at: Math.max(0, Math.floor(Number(r.at) || 0)) };
}

/** Best record of a (difficulty, level): { stars, score, ticks, at } or null (a cleared level without a record counts as 1 star). */
export function levelRecord(progress, difficulty, level) {
  const t = progress && progress.records && progress.records[difficulty];
  const r = t && t[level] ? normalizeRecord(t[level]) : null;
  if (r) return r;
  return isLevelCleared(progress, difficulty, level) ? { stars: 1, score: 0, ticks: 0, at: 0 } : null;
}

/** Best stars of a (difficulty, level): 0..3. */
export function levelStars(progress, difficulty, level) {
  const r = levelRecord(progress, difficulty, level);
  return r ? r.stars : 0;
}

/**
 * Pure: a new progress with the (difficulty, level) record raised to `rec` where it is better
 * (stars and score are kept independently: the best of each). Also marks the level cleared.
 * @returns {{ progress: object, newStars: boolean, newScore: boolean, prev: object|null }}
 */
export function withLevelRecord(progress, difficulty, level, rec) {
  const lv = Math.floor(Number(level));
  const r = normalizeRecord(rec);
  if (!r || !Number.isInteger(lv) || lv < 1 || !PROGRESS_DIFFICULTIES.includes(difficulty)) return { progress, newStars: false, newScore: false, prev: null };
  const prev = levelRecord(normalizeProgress(progress), difficulty, lv); // before marking it cleared (a cleared level counts as 1 star)
  const base = normalizeProgress(withLevelCleared(progress, difficulty, lv));
  const prevStars = prev ? prev.stars : 0, prevScore = prev ? prev.score : 0;
  const newStars = r.stars > prevStars, newScore = r.score > prevScore;
  const merged = {
    stars: Math.max(prevStars, r.stars), score: Math.max(prevScore, r.score),
    ticks: newStars || newScore || !prev ? r.ticks : prev.ticks, at: newStars || newScore || !prev ? r.at : prev.at,
  };
  const records = { ...base.records, [difficulty]: { ...(base.records[difficulty] || {}), [lv]: merged } };
  return { progress: { ...base, records }, newStars, newScore, prev: prev && prev.stars > 0 ? prev : null };
}

/** Stars summary of a difficulty over levels 1..maxLevel: { stars, total, cleared }. */
export function starsSummary(progress, difficulty, maxLevel = 15) {
  let stars = 0, cleared = 0;
  for (let n = 1; n <= maxLevel; n++) { const s = levelStars(progress, difficulty, n); stars += s; if (s > 0) cleared++; }
  return { stars, total: maxLevel * 3, cleared };
}

/** Stars earned on a set of levels, summed over every difficulty (unlock ladder currency). */
export function starsOnLevels(progress, levels) {
  let stars = 0;
  for (const d of PROGRESS_DIFFICULTIES) for (const n of levels) stars += levelStars(progress, d, n);
  return stars;
}

/** The difficulty with the most stars (ties: the harder one), or null when nothing was earned. */
export function bestStars(progress, maxLevel = 15) {
  let best = null;
  for (const d of PROGRESS_DIFFICULTIES) {
    const s = starsSummary(progress, d, maxLevel);
    if (s.stars > 0 && (!best || s.stars >= best.stars)) best = { difficulty: d, ...s };
  }
  return best;
}

/** Skirmish (team format) record: { best, wins, played } or null. */
export function skirmishRecord(progress, format) {
  const r = progress && progress.skirmish && progress.skirmish[format];
  return r && typeof r === 'object' ? { best: Number(r.best) || 0, wins: Number(r.wins) || 0, played: Number(r.played) || 0 } : null;
}

/**
 * Pure: a new progress with a team-format battle counted (`score` only raises `best` on a win).
 * @returns {{ progress: object, newRecord: boolean, prev: object|null }}
 */
export function withSkirmishResult(progress, format, { won, score }) {
  if (!/^[2-6]v[2-6]$/.test(String(format))) return { progress, newRecord: false, prev: null };
  const base = normalizeProgress(progress);
  const prev = skirmishRecord(base, format);
  const sc = Math.max(0, Math.round(Number(score) || 0));
  const newRecord = !!won && sc > (prev ? prev.best : 0);
  const rec = { best: newRecord ? sc : (prev ? prev.best : 0), wins: (prev ? prev.wins : 0) + (won ? 1 : 0), played: (prev ? prev.played : 0) + 1 };
  return { progress: { ...base, skirmish: { ...base.skirmish, [format]: rec } }, newRecord, prev };
}

/** True when any level was ever cleared (used to pick defaults for a profile that predates the unlock ladder). */
export function hasAnyProgress(progress) {
  return PROGRESS_DIFFICULTIES.some((d) => maxLevelCleared(progress, d) > 0);
}

// ---------------------------------------------------------------------------
// Progress options: { gating: boolean, fullArsenal: boolean }
//   gating      level n+1 opens after clearing n on that difficulty ('Explorar livremente' = off)
//   fullArsenal every faction and ship available ('Arsenal completo'); default ON for profiles
//               that already had progress when the option first appeared, OFF for new profiles
// ---------------------------------------------------------------------------

export function defaultProgressOpts(progress) {
  return { gating: true, fullArsenal: hasAnyProgress(progress) };
}

export function normalizeProgressOpts(raw, progress) {
  const d = defaultProgressOpts(progress);
  if (!raw || typeof raw !== 'object') return d;
  return { gating: typeof raw.gating === 'boolean' ? raw.gating : d.gating, fullArsenal: typeof raw.fullArsenal === 'boolean' ? raw.fullArsenal : d.fullArsenal };
}

/** Load the options; when nothing is stored the defaults depend on the existing progress. */
export function loadProgressOpts(progress, store = localStore()) {
  return normalizeProgressOpts(readJson(store, KEYS.progressOpts, null), progress);
}

export function saveProgressOpts(opts, store = localStore()) {
  return writeJson(store, KEYS.progressOpts, { gating: !!opts.gating, fullArsenal: !!opts.fullArsenal });
}
