// Per-socket sessions: hello handshake, token-based reconnection (60 s grace),
// per-socket rate limiting (token bucket 20 msg/s, burst 40), message parsing
// and dispatch to the lobby. See docs/ARCHITECTURE.md §4.2.

import { randomBytes } from 'node:crypto';
import { PROTOCOL_VERSION, RECONNECT_GRACE_MS } from '../shared/constants.js';
import {
  C2S, S2C, ERR, RATE_LIMIT, CHAT_RATE_LIMIT, MAX_MESSAGE_BYTES, MAX_TOKEN_LENGTH, validateName,
} from '../shared/protocol.js';

/** Close codes used by the server (4000–4999 are application codes). */
export const CLOSE = Object.freeze({
  VERSION_MISMATCH: 4000,
  REPLACED: 4001,
  /** No `hello` within HANDSHAKE_TIMEOUT_MS of connecting. */
  HANDSHAKE_TIMEOUT: 4002,
  /** Too many concurrent sockets from the same remote address. */
  TOO_MANY_CONNECTIONS: 4003,
  /** Client stopped reading: send buffer above MAX_BUFFERED. */
  BACKPRESSURE: 4004,
  RATE_LIMITED: 4008,
  SHUTDOWN: 1001,
});

/** Rate-limit violations tolerated within VIOLATION_WINDOW_MS before the socket is closed. */
export const MAX_VIOLATIONS = 3;
export const VIOLATION_WINDOW_MS = 10_000;
/** Outgoing bytes a stalled client may have queued before it is disconnected. */
export const MAX_BUFFERED = 8 * 1024 * 1024;
/** A socket that has not sent `hello` after this long is closed. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;
/** Concurrent sockets accepted per remote address (0 = unlimited). */
export const DEFAULT_MAX_SOCKETS_PER_ADDRESS = 16;

const defaultClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
};

/**
 * Token bucket limiter.
 * @param {number} perSecond refill rate
 * @param {number} burst     capacity
 * @param {() => number} [now] clock in ms
 * @returns {{ take(cost?: number): boolean, tokens(): number }}
 */
export function createTokenBucket(perSecond, burst, now = () => Date.now()) {
  let tokens = burst;
  let last = now();
  function refill() {
    const t = now();
    const dt = Math.max(0, t - last) / 1000;
    last = t;
    tokens = Math.min(burst, tokens + dt * perSecond);
  }
  return {
    take(cost = 1) {
      refill();
      if (tokens >= cost) {
        tokens -= cost;
        return true;
      }
      return false;
    },
    tokens() {
      refill();
      return tokens;
    },
  };
}

function makeToken() {
  return randomBytes(24).toString('base64url');
}

/**
 * Per-remote-address concurrency limiter for sockets. Addresses that are
 * unknown (`undefined`/empty) are never limited.
 * @param {{ maxSockets?: number }} [o]  0 disables the cap
 * @returns {{ acquire(addr?: string): boolean, release(addr?: string): void, count(addr?: string): number }}
 */
export function createAddressLimiter({ maxSockets = DEFAULT_MAX_SOCKETS_PER_ADDRESS } = {}) {
  const counts = new Map();
  return {
    acquire(addr) {
      if (!addr || !maxSockets) return true;
      const n = counts.get(addr) || 0;
      if (n >= maxSockets) return false;
      counts.set(addr, n + 1);
      return true;
    },
    release(addr) {
      if (!addr || !maxSockets) return;
      const n = counts.get(addr) || 0;
      if (n <= 1) counts.delete(addr);
      else counts.set(addr, n - 1);
    },
    count(addr) {
      return counts.get(addr) || 0;
    },
  };
}

/**
 * Session registry: creates sessions, resumes them by token and expires them
 * after the reconnection grace period.
 * @param {Object} [o]
 * @param {number} [o.graceMs]          reconnection grace (default RECONNECT_GRACE_MS)
 * @param {(session: object) => void} [o.onExpire]  called when a disconnected session expires
 * @param {{now():number, setTimeout:Function, clearTimeout:Function}} [o.clock]
 */
export function createSessionStore({ graceMs = RECONNECT_GRACE_MS, onExpire = () => {}, clock = defaultClock } = {}) {
  const byId = new Map();
  const byToken = new Map();
  let counter = 0;

  function makeSession(name, ws, profileId = null) {
    counter++;
    const session = {
      id: `p${counter}`,
      token: makeToken(),
      name,
      profileId,
      ws,
      connected: true,
      roomCode: null,
      createdAt: clock.now(),
      disconnectedAt: 0,
      expireTimer: null,
      /** Remote address of the current socket (undefined when unknown). */
      remoteAddress: undefined,
      chatBucket: createTokenBucket(CHAT_RATE_LIMIT.perSecond, CHAT_RATE_LIMIT.burst, clock.now),
      /**
       * Send a pre-serialized JSON string. Dropped when the socket is not
       * open. A client that stopped reading (send buffer above MAX_BUFFERED)
       * is disconnected with CLOSE.BACKPRESSURE so it goes through the normal
       * grace/reconnect path instead of desyncing silently.
       */
      sendRaw(str) {
        const sock = session.ws;
        if (!sock || sock.readyState !== 1 /* OPEN */) return false;
        if (sock.bufferedAmount > MAX_BUFFERED) {
          session.close(CLOSE.BACKPRESSURE, 'slow consumer');
          return false;
        }
        try {
          sock.send(str);
          return true;
        } catch {
          return false;
        }
      },
      /** Serialize and send an object. */
      send(obj) {
        return session.sendRaw(JSON.stringify(obj));
      },
      close(code, reason) {
        const sock = session.ws;
        if (!sock) return;
        try {
          sock.close(code, reason);
        } catch { /* ignore */ }
      },
    };
    byId.set(session.id, session);
    byToken.set(session.token, session);
    return session;
  }

  function cancelExpiry(session) {
    if (session.expireTimer) {
      clock.clearTimeout(session.expireTimer);
      session.expireTimer = null;
    }
  }

  const store = {
    /** @returns {object} a fresh session bound to `ws` */
    create(name, ws, profileId = null) {
      return makeSession(name, ws, profileId);
    },
    /**
     * Resume a session by token. The previous socket (if any) is replaced.
     * @returns {object|null}
     */
    resume(token, ws, profileId = null) {
      if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
      const session = byToken.get(token);
      if (!session) return null;
      // A WS bearer token cannot be moved between persistent profile cookies.
      if (session.profileId !== profileId) return null;
      const old = session.ws;
      // Consume the bearer token and bind its replacement before closing the
      // previous transport: close handlers may run synchronously.
      byToken.delete(token);
      session.token = makeToken();
      byToken.set(session.token, session);
      cancelExpiry(session);
      session.ws = ws;
      session.connected = true;
      session.disconnectedAt = 0;
      if (old && old !== ws) {
        try { old.close(CLOSE.REPLACED, 'replaced'); } catch { /* ignore */ }
      }
      return session;
    },
    get(id) {
      return byId.get(id) || null;
    },
    /**
     * The socket of `session` closed. Starts the grace timer; after it fires
     * the session is destroyed and `onExpire` is called.
     * @returns {boolean} false when the closed socket was not the session's current one (already replaced)
     */
    detach(session, ws) {
      if (session.ws !== ws) return false;
      session.ws = null;
      session.connected = false;
      session.disconnectedAt = clock.now();
      cancelExpiry(session);
      session.expireTimer = clock.setTimeout(() => {
        session.expireTimer = null;
        if (session.connected) return;
        store.destroy(session);
        onExpire(session);
      }, graceMs);
      return true;
    },
    destroy(session) {
      cancelExpiry(session);
      byId.delete(session.id);
      byToken.delete(session.token);
      session.ws = null;
      session.connected = false;
    },
    get size() {
      return byId.size;
    },
    /** Destroy everything (shutdown). */
    clear() {
      for (const s of [...byId.values()]) store.destroy(s);
    },
  };
  return store;
}

/**
 * Attach the protocol to a freshly accepted WebSocket: enforces the message
 * size limit, the per-socket token bucket, the `hello` handshake and routes
 * everything else to `lobby.handleMessage(session, msg)`.
 * @param {import('ws').WebSocket} ws
 * @param {Object} o
 * @param {ReturnType<typeof createSessionStore>} o.sessions
 * @param {{ handleMessage(session, msg): void, onDisconnect(session): void, onReconnect(session): void }} o.lobby
 * @param {{now():number, setTimeout:Function, clearTimeout:Function}} [o.clock]
 * @param {{ warn(...a:any[]):void }} [o.log]
 * @param {string} [o.remoteAddress]   client address (for the per-address limiter and `session.remoteAddress`)
 * @param {ReturnType<typeof createAddressLimiter>} [o.limiter]  per-address socket cap
 * @param {number} [o.handshakeMs]     close sockets that never send `hello` after this long (default 10 s)
 */
export function attachConnection(ws, {
  sessions, lobby, clock = defaultClock, log = console, remoteAddress, limiter, handshakeMs = HANDSHAKE_TIMEOUT_MS, profileId = null,
}) {
  let session = null;
  const bucket = createTokenBucket(RATE_LIMIT.perSecond, RATE_LIMIT.burst, clock.now);
  const violations = [];

  function sendError(code, detail, rid) {
    const msg = { t: S2C.ERROR, code };
    if (rid !== undefined) msg.rid = rid;
    if (detail !== undefined) msg.detail = detail;
    try {
      if (ws.readyState === 1) ws.send(JSON.stringify(msg));
    } catch { /* ignore */ }
  }

  ws.on('error', () => { /* 'close' follows */ });

  if (limiter && !limiter.acquire(remoteAddress)) {
    sendError(ERR.RATE_LIMITED, 'connections');
    try { ws.close(CLOSE.TOO_MANY_CONNECTIONS, 'too many connections'); } catch { /* ignore */ }
    return;
  }

  let handshakeTimer = handshakeMs > 0
    ? clock.setTimeout(() => {
      handshakeTimer = null;
      if (session) return;
      try { ws.close(CLOSE.HANDSHAKE_TIMEOUT, 'hello timeout'); } catch { /* ignore */ }
    }, handshakeMs)
    : null;

  function clearHandshakeTimer() {
    if (handshakeTimer !== null) {
      clock.clearTimeout(handshakeTimer);
      handshakeTimer = null;
    }
  }

  function welcome() {
    session.send({
      t: S2C.WELCOME, playerId: session.id, token: session.token, version: PROTOCOL_VERSION, serverTime: clock.now(),
    });
  }

  function handleHello(msg) {
    const name = validateName(msg.name);
    if (name === null) return sendError(ERR.BAD_NAME, 'name', msg.rid);
    if (msg.version !== PROTOCOL_VERSION) {
      sendError(ERR.VERSION_MISMATCH, { server: PROTOCOL_VERSION }, msg.rid);
      try { ws.close(CLOSE.VERSION_MISMATCH, 'version'); } catch { /* ignore */ }
      return;
    }
    const resumed = msg.token !== undefined ? sessions.resume(msg.token, ws, profileId) : null;
    clearHandshakeTimer();
    if (resumed) {
      session = resumed;
      session.remoteAddress = remoteAddress;
      welcome();
      try {
        lobby.onReconnect(session);
      } catch (err) {
        log.warn('[session] reconnect handler error', err);
      }
    } else {
      session = sessions.create(name, ws, profileId);
      session.remoteAddress = remoteAddress;
      welcome();
    }
  }

  ws.on('message', (data, isBinary) => {
    // A replaced socket can still have queued messages before its close
    // handshake finishes. It no longer has authority over this session.
    if (session && session.ws !== ws) return;
    const now = clock.now();
    if (!bucket.take()) {
      while (violations.length && now - violations[0] > VIOLATION_WINDOW_MS) violations.shift();
      violations.push(now);
      sendError(ERR.RATE_LIMITED);
      if (violations.length >= MAX_VIOLATIONS) {
        try { ws.close(CLOSE.RATE_LIMITED, 'rate limited'); } catch { /* ignore */ }
      }
      return;
    }
    if (isBinary) return sendError(ERR.BAD_MESSAGE, 'binary');
    const text = typeof data === 'string' ? data : data.toString('utf8');
    if (text.length > MAX_MESSAGE_BYTES) return sendError(ERR.BAD_MESSAGE, 'too_large');
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return sendError(ERR.BAD_MESSAGE, 'json');
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') {
      return sendError(ERR.BAD_MESSAGE, 't');
    }
    const rid = Number.isInteger(msg.rid) && msg.rid >= 0 ? msg.rid : undefined;
    if (!session) {
      if (msg.t !== C2S.HELLO) return sendError(ERR.BAD_MESSAGE, 'hello_first', rid);
      return handleHello(msg);
    }
    if (msg.t === C2S.HELLO) return sendError(ERR.BAD_MESSAGE, 'already_hello', rid);
    try {
      lobby.handleMessage(session, msg);
    } catch (err) {
      log.warn('[session] handler error', err);
      sendError(ERR.BAD_MESSAGE, 'internal', rid);
    }
  });

  ws.on('error', () => { /* 'close' follows */ });

  ws.on('close', () => {
    clearHandshakeTimer();
    if (limiter) limiter.release(remoteAddress);
    if (!session) return;
    if (!sessions.detach(session, ws)) return;
    try {
      lobby.onDisconnect(session);
    } catch (err) {
      log.warn('[session] disconnect handler error', err);
    }
  });
}
