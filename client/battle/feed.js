// BattleFeed contract (docs/ARCHITECTURE.md §5.1) + emitter helpers shared by
// the local runner and the network client. Pure (no DOM), testable in Node.
//
// A feed emits:
//   onStart(info)   BattleStartInfo (replayed to late subscribers)
//   onFrame(frame)  { k, s, e, at }  at = performance.now() on arrival
//   onEnd(result)   BattleResult (replayed to late subscribers)
//   onStatus(s)     'ok' | 'reconnecting' | 'lost'
// and exposes controls { setSpeed(0|1|2|4), isLocal } and dispose().

/**
 * @typedef {Object} BattleFeed
 * @property {(cb:(info:object)=>void)=>(()=>void)} onStart
 * @property {(cb:(frame:{k:number,s:number[][],e:any[],at:number})=>void)=>(()=>void)} onFrame
 * @property {(cb:(result:object)=>void)=>(()=>void)} onEnd
 * @property {(cb:(status:'ok'|'reconnecting'|'lost')=>void)=>(()=>void)} onStatus
 * @property {{ setSpeed(x:0|1|2|4):void, isLocal:boolean }} controls
 * @property {() => void} dispose
 */

/**
 * Minimal synchronous event emitter. Listeners may unsubscribe during emit.
 * @template T
 */
export function createEmitter() {
  /** @type {Set<Function>} */
  const subs = new Set();
  return {
    /** @param {Function} cb @returns {() => void} unsubscribe */
    on(cb) {
      if (typeof cb !== 'function') return () => {};
      subs.add(cb);
      return () => { subs.delete(cb); };
    },
    emit(...args) {
      for (const cb of [...subs]) {
        try { cb(...args); } catch (e) { reportListenerError(e); }
      }
    },
    clear() { subs.clear(); },
    get size() { return subs.size; },
  };
}

function reportListenerError(e) {
  // Listener failures must never break the feed; surface them for debugging.
  if (typeof console !== 'undefined' && console.error) console.error('[feed] listener error', e);
  if (typeof globalThis !== 'undefined' && globalThis.__fe && Array.isArray(globalThis.__fe.errors)) globalThis.__fe.errors.push(String(e && e.stack || e));
}

/** Monotonic clock in ms (performance.now when available). */
export function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

/**
 * Shared feed state: subscriptions, replay of the last start/end/status and
 * the emit side used by concrete feeds.
 * @param {{ isLocal: boolean }} o
 */
export function createFeedBase(o) {
  const start = createEmitter(), frame = createEmitter(), end = createEmitter(), status = createEmitter();
  let lastStart = null, lastEnd = null, lastStatus = 'ok';
  let battleNo = 0;
  return {
    isLocal: !!o.isLocal,
    /** Subscribe; if a battle already started (and has not ended), the info is replayed. */
    onStart(cb) {
      const off = start.on(cb);
      if (lastStart && !lastEnd) { try { cb(lastStart); } catch (e) { reportListenerError(e); } }
      return off;
    },
    onFrame(cb) { return frame.on(cb); },
    onEnd(cb) {
      const off = end.on(cb);
      if (lastEnd) { try { cb(lastEnd); } catch (e) { reportListenerError(e); } }
      return off;
    },
    onStatus(cb) {
      const off = status.on(cb);
      try { cb(lastStatus); } catch (e) { reportListenerError(e); }
      return off;
    },
    emitStart(info) { lastStart = info; lastEnd = null; battleNo++; start.emit(info); },
    emitFrame(f) { frame.emit(f); },
    emitEnd(result) { lastEnd = result; end.emit(result); },
    emitStatus(s) { if (s !== lastStatus) { lastStatus = s; status.emit(s); } },
    /** Forget the current battle (no replay to late subscribers); used when leaving a room. */
    resetBattle() { lastStart = null; lastEnd = null; },
    get lastStart() { return lastStart; },
    get lastEnd() { return lastEnd; },
    get status() { return lastStatus; },
    get battleNo() { return battleNo; },
    clear() { start.clear(); frame.clear(); end.clear(); status.clear(); lastStart = null; lastEnd = null; },
  };
}

/** Valid speeds for local battles (0 = pause). */
export const SPEEDS = Object.freeze([0, 1, 2, 4]);

/** Coerce any input to a valid speed (default 1). */
export function normalizeSpeed(x) {
  const n = Number(x);
  return SPEEDS.includes(n) ? n : 1;
}
