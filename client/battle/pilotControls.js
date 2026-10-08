// Input is only intent. The shared simulation/server owns movement, shots and damage.
// No shared imports: preferences can load this module without starting the simulation.
export const DEFAULT_PILOT_BINDINGS = Object.freeze({
  moveUp: 'ArrowUp', moveDown: 'ArrowDown', moveLeft: 'ArrowLeft', moveRight: 'ArrowRight',
  fire: 'KeyF', ability: 'KeyE', toggle: 'KeyP',
});
export const PILOT_ACTIONS = Object.freeze({ moveUp: 'Mover para cima', moveDown: 'Mover para baixo', moveLeft: 'Mover para a esquerda', moveRight: 'Mover para a direita', fire: 'Disparar', ability: 'Habilidade', toggle: 'Piloto manual / automático' });
const RESERVED = new Set(['KeyN', 'KeyG', 'KeyC', 'Digit1', 'Digit2', 'Digit4']);
export function validPilotKey(code) {
  return typeof code === 'string' && /^(?:Key[A-Z]|Digit[0-9]|Arrow(?:Up|Down|Left|Right))$/.test(code) && !RESERVED.has(code);
}
export function normalizePilotBindings(raw) {
  const value = { ...DEFAULT_PILOT_BINDINGS };
  if (!raw || typeof raw !== 'object') return value;
  for (const action of Object.keys(value)) if (validPilotKey(raw[action])) value[action] = raw[action];
  return new Set(Object.values(value)).size === Object.keys(value).length ? value : { ...DEFAULT_PILOT_BINDINGS };
}
export function pilotKeyLabel(code) { return String(code).replace(/^Key|^Digit/, '').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→'); }
export function isPilotTextTarget(target) {
  return !!(target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName || '') || target.closest?.('[contenteditable="true"], [role="dialog"], dialog')));
}

export function createPilotControls(o) {
  const { canvas, feed, renderer } = o;
  const doc = o.doc || globalThis.document, win = o.win || globalThis.window;
  const schedule = o.setInterval || setInterval, cancel = o.clearInterval || clearInterval;
  const keys = new Set(), offs = [];
  let bindings = normalizePilotBindings(o.bindings), manual = false, suspended = false, connected = true;
  let shipId = null, alive = false, available = false, abilityReady = false, disposed = false, pointerFire = false;
  let aim = null, lastView = null, lastFrame = null, lastReport = '';
  const owner = o.myPlayerId;
  function report() {
    const state = { available, manual, alive, abilityReady, shipId };
    const key = JSON.stringify(state);
    if (key !== lastReport) { lastReport = key; o.onState?.(state); }
  }
  function send(input) { try { feed.controls?.pilot?.(input); } catch { /* a disconnected feed may reject an input */ } }
  function release() {
    const wasManual = manual;
    manual = false; keys.clear(); pointerFire = false;
    if (wasManual) send({ manual: false });
    report();
  }
  function blocked() {
    return disposed || suspended || !connected || !available || !alive || feed.controls?.paused || feed.controls?.speed === 0 || doc?.visibilityState === 'hidden' || isPilotTextTarget(doc?.activeElement);
  }
  function transmit() {
    if (!manual || disposed) return;
    if (blocked()) { release(); return; }
    const ship = lastView?.ships?.get(shipId);
    const moveX = Number(keys.has(bindings.moveRight)) - Number(keys.has(bindings.moveLeft));
    const moveY = Number(keys.has(bindings.moveDown)) - Number(keys.has(bindings.moveUp));
    const heading = ship?.a ?? (feed.lastStart?.players?.find((p) => p.id === owner)?.team === 1 ? Math.PI : 0);
    const fallback = ship ? { x: ship.x + Math.cos(heading) * 1000, y: ship.y + Math.sin(heading) * 1000 } : { x: 0, y: 0 };
    const world = feed.lastStart?.world || { w: 10000, h: 10000 };
    const target = aim || fallback;
    send({ manual: true, moveX, moveY,
      aimX: Math.max(0, Math.min(world.w, target.x)), aimY: Math.max(0, Math.min(world.h, target.y)),
      fire: pointerFire || keys.has(bindings.fire), ability: keys.has(bindings.ability) });
  }
  function setEnabled(value) {
    if (!value) { release(); return false; }
    // Explicit HUD takeover is allowed; remove its focus so subsequent arrows
    // belong to the arena instead of navigating the button. Dialogs still win.
    if (doc?.activeElement?.tagName === 'BUTTON' && !doc.activeElement.closest?.('[role="dialog"], dialog')) doc.activeElement.blur?.();
    if (blocked()) return false;
    manual = true;
    renderer?.camera?.follow(shipId);
    report(); transmit();
    return true;
  }
  function listen(target, name, fn, opts) {
    target?.addEventListener?.(name, fn, opts);
    offs.push(() => target?.removeEventListener?.(name, fn, opts));
  }
  function aimAt(e) {
    if (!canvas || !renderer?.camera?.raw?.screenToWorld) return;
    const rect = canvas.getBoundingClientRect();
    aim = renderer.camera.raw.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  }
  const onKeyDown = (e) => {
    if (isPilotTextTarget(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.code === bindings.toggle) {
      if (!available || !alive || suspended || e.repeat) return;
      e.preventDefault(); e.stopImmediatePropagation?.(); setEnabled(!manual); return;
    }
    if (!manual || blocked() || !Object.values(bindings).includes(e.code)) return;
    e.preventDefault(); e.stopImmediatePropagation?.();
    keys.add(e.code);
  };
  listen(doc, 'keydown', onKeyDown, true);
  listen(doc, 'keyup', (e) => {
    if (!keys.delete(e.code)) return;
    e.preventDefault(); e.stopImmediatePropagation?.();
  }, true);
  listen(canvas, 'pointermove', aimAt);
  listen(canvas, 'pointerdown', (e) => {
    if (!manual || blocked() || e.button !== 0) return;
    aimAt(e); pointerFire = true; e.preventDefault(); e.stopImmediatePropagation?.();
  }, true);
  listen(canvas, 'dblclick', (e) => {
    if (manual) { e.preventDefault(); e.stopImmediatePropagation?.(); }
  }, true);
  listen(win, 'pointerup', () => { pointerFire = false; });
  listen(win, 'pointercancel', () => { pointerFire = false; });
  listen(win, 'blur', release);
  listen(doc, 'visibilitychange', () => { if (doc.visibilityState === 'hidden') release(); });
  listen(doc, 'focusin', (e) => { if (isPilotTextTarget(e.target)) release(); });
  if (feed.onStart) offs.push(feed.onStart((start) => {
    release();
    const p = start.p?.find((x) => x.owner === owner);
    const s = (start.ships || []).find((x) => x.owner === owner && (x.pilot || /_ace$/.test(x.cls)));
    shipId = p?.shipId ?? s?.id ?? null;
    available = shipId !== null; alive = available && !(start.dead || []).includes(shipId);
    abilityReady = available; report();
  }));
  if (feed.onFrame) offs.push(feed.onFrame((frame) => {
    lastFrame = frame;
    const p = frame.p?.find((x) => x.owner === owner);
    if (p) { shipId = p.shipId; available = true; abilityReady = frame.k >= (p.abilityReadyAt || 0); }
    if (available && Array.isArray(frame.s)) {
      alive = frame.s.some((row) => row[0] === shipId && row[4] > 0);
      if (!alive) release();
    }
    report();
  }));
  if (feed.onStatus) offs.push(feed.onStatus((status) => { connected = status === 'ok'; if (!connected) release(); }));
  if (feed.onEnd) offs.push(feed.onEnd(() => { suspended = true; release(); }));
  const timer = schedule(transmit, 100);
  return {
    setEnabled,
    setSuspended(value) { suspended = !!value; if (suspended) release(); },
    setBindings(value) { release(); bindings = normalizePilotBindings(value); },
    update(view) { lastView = view; if (manual && blocked()) release(); report(); },
    get state() { return { available, manual, alive, abilityReady, shipId }; },
    get frame() { return lastFrame; },
    dispose() { if (disposed) return; release(); disposed = true; cancel(timer); for (const off of offs) off?.(); },
  };
}
