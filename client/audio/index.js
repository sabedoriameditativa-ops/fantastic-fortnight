// Minimal no-op AudioEngine stub implementing the API of docs/ARCHITECTURE.md
// §5.4 so the screens can call it. The audio engineer replaces this file with
// the real Web Audio implementation (same exported shape).

const settings = { master: 0.8, music: 0.6, sfx: 0.8, ui: 0.7, muted: false };
let ready = false;
let scene = 'none';
let factionHint = null;
const counters = { voices: 0, created: 0, coalesced: 0, dropped: 0 };

export const audio = {
  /** Call synchronously inside the first pointerdown/keydown handler; idempotent. */
  async init() { ready = true; },
  isReady() { return ready; },
  /** @param {string} name  'ui.click', 'shot.laser', ... @param {object} [opts] */
  play(name, opts) { void name; void opts; counters.dropped++; },
  /** @param {any[][]} events SimEvents @param {(id:number)=>object|null} lookup */
  consumeEvents(events, lookup) { void events; void lookup; },
  setCamera(cx, cy, halfWidth, aspect) { void cx; void cy; void halfWidth; void aspect; },
  setBattleState(s) { void s; },
  /** @param {'none'|'menu'|'builder'|'battle'|'victory'|'defeat'} s */
  setScene(s) { scene = s; },
  getScene() { return scene; },
  setFactionHint(factionId) { factionHint = factionId; },
  getFactionHint() { return factionHint; },
  /** @param {'master'|'music'|'sfx'|'ui'} bus @param {number} v 0..1 */
  setVolume(bus, v) { if (bus in settings && bus !== 'muted') settings[bus] = Math.max(0, Math.min(1, Number(v) || 0)); },
  setMuted(b) { settings.muted = !!b; },
  getSettings() { return { ...settings }; },
  stats() { return { ...counters }; },
  /** Marker so the app can tell the stub from the real engine. */
  isStub: true,
};

export default audio;
