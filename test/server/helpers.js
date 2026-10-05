// Test helpers for the server suite: fake clock, fake sessions, ws test client.
import WebSocket from 'ws';

/** Manual clock compatible with room.js / session.js `clock` injection. */
export function createFakeClock(start = 1_000_000) {
  let t = start;
  let seq = 0;
  const timers = new Map();
  const clock = {
    now: () => t,
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: t + Math.max(0, ms), fn, id });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    /** Advance time, firing due timers in order. */
    advance(ms) {
      const target = t + ms;
      for (;;) {
        let next = null;
        for (const tm of timers.values()) if (tm.at <= target && (!next || tm.at < next.at || (tm.at === next.at && tm.id < next.id))) next = tm;
        if (!next) break;
        timers.delete(next.id);
        t = next.at;
        next.fn();
      }
      t = target;
    },
    pending: () => timers.size,
  };
  return clock;
}

/** Fake session: records every message the room sends it. */
export function createFakeSession(id, name = id) {
  const s = {
    id,
    name,
    roomCode: null,
    out: [],
    sendRaw(str) {
      s.out.push(JSON.parse(str));
      return true;
    },
    send(obj) {
      return s.sendRaw(JSON.stringify(obj));
    },
    /** Last message of a type (or matching predicate). */
    last(t) {
      const pred = typeof t === 'function' ? t : (m) => m.t === t;
      for (let i = s.out.length - 1; i >= 0; i--) if (pred(s.out[i])) return s.out[i];
      return null;
    },
    count(t) {
      return s.out.filter((m) => m.t === t).length;
    },
    clear() {
      s.out.length = 0;
    },
  };
  return s;
}

/**
 * Promise-based ws test client. `request` sends a C2S message with a rid and
 * resolves on the matching ack (rejects on error). `next(pred)` waits for the
 * next incoming message after the current read cursor that matches.
 */
export function createTestClient(url, name) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  let rid = 0;
  let cursor = 0;
  let closed = null;
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString());
    inbox.push(m);
    for (const w of [...waiters]) {
      if (w.pred(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  ws.on('close', (code, reason) => {
    closed = { code, reason: reason.toString() };
    for (const w of [...waiters]) {
      if (w.rejectOnClose) {
        waiters.splice(waiters.indexOf(w), 1);
        w.reject(new Error(`${name}: socket closed (${code})`));
      }
    }
  });
  const open = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  /**
   * Wait for a matching message. `consume=true` scans from the read cursor
   * and advances it past the match (each message is returned once);
   * `consume=false` scans the whole inbox and leaves the cursor alone.
   */
  function wait(pred, ms, consume, rejectOnClose) {
    return new Promise((resolve, reject) => {
      for (let i = consume ? cursor : 0; i < inbox.length; i++) {
        if (pred(inbox[i])) {
          if (consume) cursor = i + 1;
          return resolve(inbox[i]);
        }
      }
      const timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(w), 1);
        reject(new Error(`${name}: timeout waiting for message`));
      }, ms);
      const w = {
        pred,
        rejectOnClose,
        resolve: (m) => {
          clearTimeout(timer);
          if (consume) cursor = inbox.indexOf(m) + 1;
          resolve(m);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      waiters.push(w);
    });
  }

  function next(pred, ms = 8000, { rejectOnClose = true } = {}) {
    return wait(pred, ms, true, rejectOnClose);
  }

  function waitFor(pred, ms = 8000) {
    return wait(pred, ms, false, true);
  }

  const client = {
    ws,
    name,
    inbox,
    open,
    get closed() {
      return closed;
    },
    send(obj) {
      ws.send(JSON.stringify(obj));
    },
    sendRaw(str) {
      ws.send(str);
    },
    async hello(extra = {}) {
      client.send({ t: 'hello', name, version: 1, ...extra });
      return next((m) => m.t === 'welcome' || (m.t === 'error' && m.rid === undefined));
    },
    async request(msg, ms = 8000) {
      const r = ++rid;
      client.send({ ...msg, rid: r });
      const m = await waitFor((x) => (x.t === 'ack' || x.t === 'error') && x.rid === r, ms);
      if (m.t === 'error') {
        const err = new Error(`${name}: ${msg.t} -> ${m.code} ${JSON.stringify(m.detail ?? '')}`);
        err.code = m.code;
        err.detail = m.detail;
        throw err;
      }
      return m;
    },
    next,
    waitFor,
    /** All messages of a type received so far. */
    all(t) {
      return inbox.filter((m) => m.t === t);
    },
    close(code) {
      return new Promise((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.once('close', () => resolve());
        ws.close(code);
      });
    },
    /**
     * Resolve with `{code, reason}` once the server (or anyone) closed the
     * socket; immediately when it already is. Rejects after `ms`.
     */
    waitClosed(ms = 5000) {
      return new Promise((resolve, reject) => {
        if (closed) return resolve(closed);
        const timer = setTimeout(() => reject(new Error(`${name}: timeout waiting for close`)), ms);
        ws.once('close', () => {
          clearTimeout(timer);
          resolve(closed);
        });
      });
    },
  };
  return client;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
