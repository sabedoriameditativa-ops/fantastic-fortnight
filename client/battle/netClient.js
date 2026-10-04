// WebSocket client: lobby API + BattleFeed (docs/ARCHITECTURE.md §4.2, §5.2).
// Requests carry an incrementing `rid`; `ack`/`error` (or the resulting `room`
// push) resolve/reject the returned Promise. Reconnects with backoff
// 0.5/1/2/4/4 s (5 tries) sending hello{token}; the token lives in
// sessionStorage so a reload resumes the session. Pure enough to be tested in
// Node 22 (global WebSocket) against a fake `ws` server.

import { C2S, S2C } from '/shared/protocol.js';
import { PROTOCOL_VERSION } from '/shared/constants.js';
import { createEmitter, createFeedBase, nowMs } from './feed.js';
import { sessionStore, readString, writeString, KEYS } from '../util/storage.js';

const BACKOFF_MS = [500, 1000, 2000, 4000, 4000];
const REQUEST_TIMEOUT_MS = 10000;
const PING_INTERVAL_MS = 5000;
/** Requests whose response is the next `room` push (the server may ack too). */
const ROOM_REQUESTS = new Set([C2S.CREATE_ROOM, C2S.JOIN_ROOM, C2S.SET_ROOM, C2S.PICK_SLOT, C2S.ADD_BOT, C2S.REMOVE_BOT, C2S.SET_FLEET, C2S.READY, C2S.START, C2S.REMATCH]);

/** Error with a protocol code. */
export function netError(code, detail, message) {
  const e = new Error(message || code);
  e.code = code;
  if (detail !== undefined) e.detail = detail;
  return e;
}

/**
 * @param {string} url  ws(s)://host[:port]
 * @param {{ WebSocket?: any, store?: Storage|null, backoff?: number[], requestTimeoutMs?: number, pingIntervalMs?: number, version?: number }} [opts]
 */
export function createNetClient(url, opts = {}) {
  const WS = opts.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  const store = opts.store !== undefined ? opts.store : sessionStore();
  const backoff = opts.backoff || BACKOFF_MS;
  const requestTimeoutMs = opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const pingIntervalMs = opts.pingIntervalMs ?? PING_INTERVAL_MS;
  const version = opts.version ?? PROTOCOL_VERSION;

  const base = createFeedBase({ isLocal: false });
  const ev = { room: createEmitter(), countdown: createEmitter(), error: createEmitter(), chat: createEmitter(), left: createEmitter(), status: createEmitter() };

  let ws = null;
  let name = '';
  let playerId = readString(store, KEYS.playerId, '') || null;
  let token = readString(store, KEYS.token, '') || null;
  let status = 'idle'; // idle | connecting | ok | reconnecting | lost | closed
  let room = null;
  let rid = 0;
  /** @type {Map<number, {resolve:Function, reject:Function, t:string}>} */
  const pending = new Map();
  let connectWaiters = [];
  let attempt = 0;
  let reconnectTimer = null;
  let pingTimer = null;
  let latencyMs = 0;
  let disposed = false;
  let everWelcomed = false;
  let intentionalClose = false;

  function setStatus(s) {
    if (s === status) return;
    status = s;
    ev.status.emit(s);
    if (s === 'ok') base.emitStatus('ok');
    else if (s === 'reconnecting') base.emitStatus('reconnecting');
    else if (s === 'lost' || s === 'closed') base.emitStatus('lost');
  }

  function send(obj) {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
  }

  function rejectAll(code) {
    const err = netError(code);
    for (const p of [...pending.values()]) p.reject(err);
    pending.clear();
  }

  function request(t, payload = {}) {
    return new Promise((resolve, reject) => {
      if (disposed) { reject(netError('DISCONNECTED')); return; }
      if (status !== 'ok' || !ws || ws.readyState !== 1) { reject(netError('NOT_CONNECTED')); return; }
      const id = ++rid;
      const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(netError('TIMEOUT')); } }, requestTimeoutMs);
      pending.set(id, {
        t,
        resolve: (v) => { clearTimeout(timer); pending.delete(id); resolve(v); },
        reject: (e) => { clearTimeout(timer); pending.delete(id); reject(e); },
      });
      if (!send({ t, rid: id, ...payload })) {
        clearTimeout(timer); pending.delete(id); reject(netError('NOT_CONNECTED'));
      }
    });
  }

  function resolveRoomRequests(r) {
    for (const [id, p] of [...pending]) if (ROOM_REQUESTS.has(p.t)) { pending.delete(id); p.resolve(r); }
  }

  function handle(msg) {
    switch (msg.t) {
      case S2C.WELCOME: {
        const prevId = playerId;
        playerId = msg.playerId;
        token = msg.token || token;
        writeString(store, KEYS.token, token);
        writeString(store, KEYS.playerId, playerId);
        attempt = 0;
        const wasReconnect = everWelcomed;
        everWelcomed = true;
        setStatus('ok');
        startPing();
        for (const w of connectWaiters) w.resolve({ playerId });
        connectWaiters = [];
        if (wasReconnect && prevId && prevId !== playerId && room) {
          // the server did not resume our session: the room is gone for us
          room = null;
          ev.left.emit('room_closed');
        }
        break;
      }
      case S2C.ACK: {
        const p = pending.get(msg.rid);
        if (p) p.resolve(room);
        break;
      }
      case S2C.ERROR: {
        const err = netError(msg.code || 'UNKNOWN', msg.detail);
        if (msg.rid !== undefined && pending.has(msg.rid)) pending.get(msg.rid).reject(err);
        if (msg.code === 'VERSION_MISMATCH' || msg.code === 'BAD_NAME') {
          for (const w of connectWaiters) w.reject(err);
          connectWaiters = [];
        }
        ev.error.emit({ code: msg.code || 'UNKNOWN', detail: msg.detail, rid: msg.rid });
        break;
      }
      case S2C.ROOM: {
        const { t, ...state } = msg;
        room = state;
        resolveRoomRequests(room);
        ev.room.emit(room);
        break;
      }
      case S2C.LEFT: {
        room = null;
        base.resetBattle();
        for (const [id, p] of [...pending]) if (p.t === C2S.LEAVE_ROOM) { pending.delete(id); p.resolve(); }
        ev.left.emit(msg.reason || 'left');
        break;
      }
      case S2C.COUNTDOWN:
        ev.countdown.emit({ seconds: msg.seconds, startAt: msg.startAt });
        break;
      case S2C.BATTLE_START: {
        const { t, ...info } = msg;
        info.isLocal = false;
        base.emitStart(info);
        break;
      }
      case S2C.FRAME:
        base.emitFrame({ k: msg.k, s: msg.s, e: msg.e || [], at: nowMs() });
        break;
      case S2C.BATTLE_END:
        base.emitEnd(msg.result);
        break;
      case S2C.CHAT:
        ev.chat.emit({ from: msg.from, name: msg.name, text: msg.text, ts: msg.ts });
        break;
      case S2C.PONG:
        if (Number.isFinite(msg.c)) latencyMs = Math.max(0, Math.round(Date.now() - msg.c));
        break;
      default:
        break;
    }
  }

  function startPing() {
    stopPing();
    if (pingIntervalMs > 0) pingTimer = setInterval(() => { send({ t: C2S.PING, c: Date.now() }); }, pingIntervalMs);
  }
  function stopPing() { if (pingTimer) { clearInterval(pingTimer); pingTimer = null; } }

  function open() {
    if (disposed || !WS) return;
    let sock;
    try { sock = new WS(url); } catch (e) { onClosed(); return; }
    ws = sock;
    sock.onopen = () => {
      if (sock !== ws) return;
      const hello = { t: C2S.HELLO, name, version };
      if (token) hello.token = token;
      send(hello);
    };
    sock.onmessage = (e) => {
      if (sock !== ws) return;
      let msg;
      try { msg = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data)); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      try { handle(msg); } catch (err) { if (typeof console !== 'undefined') console.error('[net] handler error', err); }
    };
    // A refused connection fires 'error' (and, in browsers, 'close'); Node's
    // WebSocket may fire only 'error'. Settle exactly once either way.
    let settled = false;
    const failed = () => { if (settled) return; settled = true; if (sock === ws) onClosed(); };
    sock.onerror = () => { if (sock.readyState !== 1) failed(); };
    sock.onclose = () => failed();
  }

  function onClosed() {
    ws = null;
    stopPing();
    rejectAll('DISCONNECTED');
    if (disposed || intentionalClose) { setStatus('closed'); return; }
    if (!everWelcomed) {
      // initial connection failed
      const err = netError('CONNECT_FAILED');
      for (const w of connectWaiters) w.reject(err);
      connectWaiters = [];
      setStatus('lost');
      return;
    }
    if (attempt >= backoff.length) { setStatus('lost'); return; }
    setStatus('reconnecting');
    const delay = backoff[Math.min(attempt, backoff.length - 1)];
    attempt++;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; open(); }, delay);
  }

  const feed = {
    onStart: base.onStart, onFrame: base.onFrame, onEnd: base.onEnd, onStatus: base.onStatus,
    controls: { isLocal: false, setSpeed() { /* the server owns the clock */ } },
    get isLocal() { return false; },
    get lastStart() { return base.lastStart; },
    get lastEnd() { return base.lastEnd; },
    dispose() { /* owned by the client; see client.dispose() */ },
  };

  const client = {
    /**
     * Open the socket and say hello. Resolves on `welcome`.
     * @param {string} playerName
     * @returns {Promise<{ playerId: string }>}
     */
    connect(playerName) {
      name = String(playerName || '').trim() || 'Comandante';
      if (disposed) return Promise.reject(netError('DISCONNECTED'));
      if (!WS) return Promise.reject(netError('CONNECT_FAILED', undefined, 'WebSocket unavailable'));
      if (status === 'ok' && ws && ws.readyState === 1) return Promise.resolve({ playerId });
      return new Promise((resolve, reject) => {
        connectWaiters.push({ resolve, reject });
        if (status === 'connecting' || status === 'reconnecting') return;
        intentionalClose = false;
        attempt = 0;
        setStatus('connecting');
        open();
      });
    },
    /** Force a reconnect attempt after status 'lost'. */
    reconnect() {
      if (disposed || status === 'ok' || status === 'connecting' || status === 'reconnecting') return;
      attempt = 0;
      setStatus(everWelcomed ? 'reconnecting' : 'connecting');
      open();
    },
    createRoom({ teamSize, budget }) { return request(C2S.CREATE_ROOM, { teamSize, budget }); },
    joinRoom(code) { return request(C2S.JOIN_ROOM, { code: String(code || '').trim().toUpperCase() }); },
    leaveRoom() {
      // optimistic: a battle we walked out of must not be replayed to the next screen
      base.resetBattle();
      return request(C2S.LEAVE_ROOM, {}).then(() => { room = null; });
    },
    setRoom(o) { const p = {}; if (o.teamSize !== undefined) p.teamSize = o.teamSize; if (o.budget !== undefined) p.budget = o.budget; if (o.botDifficulty !== undefined) p.botDifficulty = o.botDifficulty; return request(C2S.SET_ROOM, p); },
    pickSlot(team, slot) { return request(C2S.PICK_SLOT, { team, slot }); },
    addBot(team, slot, difficulty, faction) { const p = { team, slot, difficulty }; if (faction) p.faction = faction; return request(C2S.ADD_BOT, p); },
    removeBot(team, slot) { return request(C2S.REMOVE_BOT, { team, slot }); },
    setFleet(fleet) { return request(C2S.SET_FLEET, { fleet }); },
    setReady(ready) { return request(C2S.READY, { ready: !!ready }); },
    start({ fillBots = false } = {}) { return request(C2S.START, { fillBots: !!fillBots }); },
    rematch() { return request(C2S.REMATCH, {}); },
    chat(text) { return request(C2S.CHAT, { text: String(text || '').trim().slice(0, 200) }); },
    ping() { send({ t: C2S.PING, c: Date.now() }); },

    onRoom: (cb) => ev.room.on(cb),
    onCountdown: (cb) => ev.countdown.on(cb),
    onError: (cb) => ev.error.on(cb),
    onChat: (cb) => ev.chat.on(cb),
    onLeft: (cb) => ev.left.on(cb),
    /** Connection status: idle | connecting | ok | reconnecting | lost | closed. */
    onStatus: (cb) => { const off = ev.status.on(cb); try { cb(status); } catch { /* ignore */ } return off; },

    feed,
    get latencyMs() { return latencyMs; },
    get status() { return status; },
    get room() { return room; },
    get playerId() { return playerId; },
    get name() { return name; },
    get url() { return url; },
    get connected() { return status === 'ok'; },

    dispose() {
      if (disposed) return;
      disposed = true;
      intentionalClose = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      stopPing();
      rejectAll('DISCONNECTED');
      const s = ws; ws = null;
      if (s) { try { s.onclose = null; s.close(); } catch { /* ignore */ } }
      setStatus('closed');
      for (const e of Object.values(ev)) e.clear();
      base.clear();
    },
  };
  return client;
}
