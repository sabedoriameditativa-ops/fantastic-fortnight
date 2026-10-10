// Server bootstrap: HTTP static files + WebSocket lobby on one port.
// `PORT` env (default 3000), prints "listening <port>" when ready, graceful
// SIGTERM/SIGINT. Env overrides for tests: FE_MAX_TICKS (battle length),
// FE_TICK_MS (loop speed), FE_COUNTDOWN_MS (countdown length). Abuse caps:
// MAX_ROOMS (global), MAX_SOCKETS_PER_IP, MAX_ROOMS_PER_IP (0 = unlimited).

import http from 'node:http';
import { exec } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { MAX_MESSAGE_BYTES } from '../shared/protocol.js';
import { createStaticHandler } from './static.js';
import { createSessionStore, attachConnection, createAddressLimiter, CLOSE } from './session.js';
import { createLobby } from './lobby.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function envInt(name) {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Like envInt but 0 is a valid value (used to switch a cap off). */
function envCount(name) {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * Read the server configuration from the environment. An unusable `PORT`
 * value is reported through `log.warn` and replaced by the default.
 * @param {{warn:Function}} [log]
 * @returns {{ port:number, host:string|undefined, maxTicks?:number, tickMs?:number, countdownMs?:number, maxRooms?:number, maxSocketsPerAddress?:number, maxRoomsPerAddress?:number, trustProxy?:boolean }}
 */
export function envConfig(log = console) {
  const raw = process.env.PORT;
  let port = 3000;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n <= 65535) port = n;
    else log.warn(`PORT inválido ("${raw}"), usando ${port} / invalid PORT, falling back to ${port}`);
  }
  return {
    port,
    host: process.env.HOST || undefined,
    maxTicks: envInt('FE_MAX_TICKS'),
    tickMs: envInt('FE_TICK_MS'),
    countdownMs: envInt('FE_COUNTDOWN_MS'),
    maxRooms: envInt('MAX_ROOMS'),
    maxSocketsPerAddress: envCount('MAX_SOCKETS_PER_IP'),
    maxRoomsPerAddress: envCount('MAX_ROOMS_PER_IP'),
    trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true',
  };
}

/**
 * Start the server.
 * @param {Object} [o]
 * @param {number} [o.port]        0 = random free port
 * @param {string} [o.host]
 * @param {number} [o.maxTicks]
 * @param {number} [o.tickMs]
 * @param {number} [o.countdownMs]
 * @param {number} [o.graceMs]
 * @param {number} [o.maxRooms]
 * @param {number} [o.maxSocketsPerAddress]  concurrent sockets per remote address (default 16, 0 = unlimited)
 * @param {number} [o.maxRoomsPerAddress]    alive rooms per creator address (default 4, 0 = unlimited)
 * @param {number} [o.handshakeMs]           close sockets that never send `hello` (default 10 s)
 * @param {{log:Function, warn:Function}} [o.log]
 * @returns {Promise<{ port:number, httpServer: http.Server, wss: WebSocketServer, lobby: object, sessions: object, close(): Promise<void> }>}
 */
export async function startServer(o = {}) {
  const log = o.log || console;
  const roomOptions = {};
  if (o.maxTicks) roomOptions.maxTicks = o.maxTicks;
  if (o.tickMs) roomOptions.tickMs = o.tickMs;
  if (o.countdownMs) roomOptions.countdownMs = o.countdownMs;
  if (o.graceMs) roomOptions.graceMs = o.graceMs;

  const lobby = createLobby({ maxRooms: o.maxRooms, maxRoomsPerAddress: o.maxRoomsPerAddress, roomOptions, log });
  const sessions = createSessionStore({
    graceMs: o.graceMs,
    onExpire: (session) => {
      try {
        lobby.onSessionExpired(session);
      } catch (err) {
        log.warn('[session] expiry handler error', err);
      }
    },
  });
  const limiter = createAddressLimiter(o.maxSocketsPerAddress !== undefined ? { maxSockets: o.maxSocketsPerAddress } : {});

  const handler = createStaticHandler({
    clientDir: path.join(ROOT, 'client'),
    sharedDir: path.join(ROOT, 'shared'),
    health: () => ({ ...lobby.health(), sessions: sessions.size }),
  });
  const httpServer = http.createServer(handler);
  const wss = new WebSocketServer({
    server: httpServer,
    perMessageDeflate: { threshold: 512 },
    maxPayload: MAX_MESSAGE_BYTES,
  });
  wss.on('connection', (ws, req) => attachConnection(ws, {
    sessions, lobby, log, limiter, handshakeMs: o.handshakeMs,
    remoteAddress: clientAddress(req, o.trustProxy),
  }));
  // ws re-emits the http server's errors; the listen failure is already reported by startServer's rejection.
  wss.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') return;
    log.warn('[ws] server error', err);
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(o.port ?? 3000, o.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : o.port;

  let closing = null;
  function close() {
    if (closing) return closing;
    closing = new Promise((resolve) => {
      lobby.closeAll('room_closed');
      for (const client of wss.clients) {
        try { client.close(CLOSE.SHUTDOWN, 'shutdown'); } catch { /* ignore */ }
      }
      sessions.clear();
      const force = setTimeout(() => {
        for (const client of wss.clients) {
          try { client.terminate(); } catch { /* ignore */ }
        }
        resolve();
      }, 2000);
      force.unref();
      wss.close(() => {
        httpServer.close(() => {
          clearTimeout(force);
          resolve();
        });
        httpServer.closeAllConnections?.();
      });
    });
    return closing;
  }

  return { port, httpServer, wss, lobby, sessions, close };
}

/**
 * Client address for the per-address limits. Behind a reverse proxy (Render, Fly,
 * nginx...) every socket arrives from the proxy's address, so with `trustProxy`
 * the first entry of X-Forwarded-For (the original client) is used instead.
 * @param {import('node:http').IncomingMessage|undefined} req
 * @param {boolean} trustProxy
 * @returns {string|undefined}
 */
export function clientAddress(req, trustProxy) {
  const direct = req && req.socket ? req.socket.remoteAddress : undefined;
  if (!trustProxy || !req || !req.headers) return direct;
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff || '').split(',')[0].trim();
  return first || direct;
}

/** Best-effort: open the default browser on the given URL (used by the one-click launchers). */
function openBrowser(url) {
  try {
    const cmd = process.platform === 'win32' ? `start "" "${url}"`
      : process.platform === 'darwin' ? `open "${url}"`
        : `xdg-open "${url}"`;
    exec(cmd, () => {});
  } catch { /* ignore */ }
}

async function main() {
  const cfg = envConfig();
  let server;
  try {
    server = await startServer(cfg);
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`porta ${cfg.port} em uso — defina PORT=<outra> / port ${cfg.port} is in use — set PORT=<other>`);
      process.exit(1);
    }
    throw err;
  }
  console.log(`listening ${server.port}`);
  if (process.env.FE_OPEN_BROWSER === '1' || process.argv.includes('--open')) openBrowser(`http://localhost:${server.port}`);
  let shuttingDown = false;
  // Deploys send SIGTERM: instead of killing every battle instantly, refuse new rooms and wait
  // up to FE_DRAIN_MS (default 25 s, inside Render's shutdown window) for battles to end.
  const drainMs = Math.max(0, Number(process.env.FE_DRAIN_MS ?? 25_000) || 0);
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal}: encerrando...`);
    const finish = () => { server.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
    const battles = () => { try { return server.lobby.health().battles || 0; } catch { return 0; } };
    if (typeof server.lobby.drain === 'function') server.lobby.drain();
    if (drainMs > 0 && battles() > 0) {
      console.log(`aguardando ${battles()} batalha(s) terminarem (até ${Math.round(drainMs / 1000)} s)...`);
      const t0 = Date.now();
      const poll = setInterval(() => { if (battles() === 0 || Date.now() - t0 >= drainMs) { clearInterval(poll); finish(); } }, 500);
      poll.unref();
    } else finish();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
