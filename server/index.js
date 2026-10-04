// Server bootstrap: HTTP static files + WebSocket lobby on one port.
// `PORT` env (default 3000), prints "listening <port>" when ready, graceful
// SIGTERM/SIGINT. Env overrides for tests: FE_MAX_TICKS (battle length),
// FE_TICK_MS (loop speed), FE_COUNTDOWN_MS (countdown length).

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { MAX_MESSAGE_BYTES } from '../shared/protocol.js';
import { createStaticHandler } from './static.js';
import { createSessionStore, attachConnection, CLOSE } from './session.js';
import { createLobby } from './lobby.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function envInt(name) {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Read the server configuration from the environment.
 * @returns {{ port:number, host:string|undefined, maxTicks?:number, tickMs?:number, countdownMs?:number, maxRooms?:number }}
 */
export function envConfig() {
  const port = process.env.PORT !== undefined && process.env.PORT !== '' ? Number(process.env.PORT) : 3000;
  return {
    port: Number.isInteger(port) && port >= 0 ? port : 3000,
    host: process.env.HOST || undefined,
    maxTicks: envInt('FE_MAX_TICKS'),
    tickMs: envInt('FE_TICK_MS'),
    countdownMs: envInt('FE_COUNTDOWN_MS'),
    maxRooms: envInt('MAX_ROOMS'),
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

  const lobby = createLobby({ maxRooms: o.maxRooms, roomOptions, log });
  const sessions = createSessionStore({
    graceMs: o.graceMs,
    onExpire: (session) => lobby.onSessionExpired(session),
  });

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
  wss.on('connection', (ws) => attachConnection(ws, { sessions, lobby, log }));
  wss.on('error', (err) => log.warn('[ws] server error', err));

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

async function main() {
  const cfg = envConfig();
  const server = await startServer(cfg);
  console.log(`listening ${server.port}`);
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal}: encerrando...`);
    server.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
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
