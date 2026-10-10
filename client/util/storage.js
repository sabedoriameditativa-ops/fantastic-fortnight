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
