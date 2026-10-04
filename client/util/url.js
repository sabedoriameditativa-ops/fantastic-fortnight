// URL parameter parsing (?sala=CODE, ?seed=, ?debug=1, ?autotest=1...) and
// room link building. Pure: takes the search string / location-like object.

/**
 * Parse app parameters from a search string.
 * @param {string} search  e.g. location.search
 * @returns {{ sala: string|null, seed: string|null, debug: boolean, autotest: boolean,
 *            level: number|null, difficulty: string|null, faction: string|null, preset: string|null,
 *            speed: number|null, team: number|null, ws: string|null, ally: string|null }}
 */
export function parseParams(search) {
  let p;
  try { p = new URLSearchParams(search || ''); } catch { p = new URLSearchParams(); }
  const get = (k) => (p.has(k) ? p.get(k) : null);
  const flag = (k) => { const v = get(k); return v !== null && v !== '0' && v !== 'false' && v !== ''; };
  const int = (k) => { const v = get(k); if (v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : null; };
  const sala = get('sala');
  const speed = int('speed');
  return {
    sala: sala ? sala.trim().toUpperCase() : null,
    seed: get('seed'),
    debug: flag('debug'),
    autotest: flag('autotest'),
    level: int('level'),
    difficulty: get('difficulty'),
    faction: get('faction'),
    preset: get('preset'),
    speed: speed !== null && [0, 1, 2, 4].includes(speed) ? speed : null,
    team: int('team'),
    ws: get('ws'),
    ally: get('ally'),
  };
}

/**
 * Build the shareable room link.
 * @param {string} code
 * @param {{ origin: string, pathname: string }} loc
 */
export function roomLink(code, loc) {
  const origin = loc && loc.origin ? loc.origin : '';
  const path = loc && loc.pathname ? loc.pathname : '/';
  return `${origin}${path}?sala=${encodeURIComponent(code)}`;
}

/**
 * Default WebSocket URL derived from the page location.
 * @param {{ protocol: string, host: string }} loc
 */
export function defaultWsUrl(loc) {
  const secure = loc && loc.protocol === 'https:';
  const host = loc && loc.host ? loc.host : 'localhost:3000';
  return `${secure ? 'wss' : 'ws'}://${host}`;
}

/** Random seed string (not for the simulation itself: it hashes this). */
export function randomSeed() {
  const n = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 0xffffffff);
  return String(n >>> 0);
}
