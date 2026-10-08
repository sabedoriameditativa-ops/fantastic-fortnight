// Private launcher entry point. Stdout is a JSON-lines control channel; the
// launcher owns the browser, installation path and lifetime of this process.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { format } from 'node:util';
import { startServer } from './index.js';
import { createProfileService } from './profiles.js';

/** FE_DESKTOP_PORT exists for embedding/tests; packaged releases use 3000. */
export function desktopConfig(env = process.env) {
  const dataDir = env.FE_DESKTOP_DATA_DIR;
  if (typeof dataDir !== 'string' || !dataDir || !path.isAbsolute(dataDir) || dataDir.includes('\0')) {
    throw Object.assign(new Error('O launcher não informou uma pasta de dados válida. Feche o jogo e abra novamente pelo aplicativo Frota Estelar.'), { desktopMessage: true });
  }
  const rawPort = env.FE_DESKTOP_PORT === undefined ? '3000' : env.FE_DESKTOP_PORT;
  if (typeof rawPort !== 'string' || !/^\d{1,5}$/.test(rawPort) || Number(rawPort) > 65535) {
    throw Object.assign(new Error('A porta configurada para o Frota Estelar é inválida. Abra o jogo novamente pelo launcher.'), { desktopMessage: true });
  }
  return { dataDir, port: Number(rawPort) };
}

function startupMessage(error, port) {
  if (error.desktopMessage) return error.message;
  if (error.code === 'EADDRINUSE') return `A porta ${port} já está em uso. Feche a outra instância do Frota Estelar ou o programa que usa essa porta e tente novamente.`;
  if (['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'EEXIST', 'ERR_SQLITE_ERROR'].includes(error.code)) {
    return 'Não foi possível abrir os dados do Frota Estelar. Verifique o acesso à pasta de dados do aplicativo e tente novamente.';
  }
  return 'Não foi possível iniciar o Frota Estelar. Feche o aplicativo e tente novamente. O registro do launcher contém o código do erro.';
}

/** Waits until shutdown/EOF/signal, then closes the owned server and database. */
export async function runDesktop({ env = process.env, input = process.stdin, output = process.stdout, errorOutput = process.stderr, signals = process } = {}) {
  let server = null, profiles = null, config = null;
  let stopping = false, requestStop;
  const stopped = new Promise((resolve) => { requestStop = resolve; });
  const stop = () => { stopping = true; requestStop(); };
  const lines = createInterface({ input, terminal: false });
  lines.on('line', (line) => { if (line.trim() === 'shutdown') stop(); });
  lines.once('close', stop);
  input.once('error', stop);
  output.once('error', stop);
  signals.on('SIGINT', stop);
  signals.on('SIGTERM', stop);
  const emit = (event) => { if (!output.destroyed) output.write(`${JSON.stringify(event)}\n`); };
  try {
    config = desktopConfig(env);
    // Explicit options isolate the desktop build from inherited test/server
    // overrides (PORT, HOST, FE_MAX_TICKS, FE_DATA_DIR, policy, secure, etc.).
    profiles = createProfileService({ dataDir: config.dataDir, policy: {}, secureCookie: false });
    server = await startServer({
      host: '127.0.0.1', port: config.port, profileService: profiles, secure: false,
      log: { warn: (...args) => errorOutput.write(`${format(...args)}\n`) },
    });
    if (!stopping) emit({ type: 'ready', url: `http://localhost:${server.port}` });
    await stopped;
    await server.close();
    return 0;
  } catch (error) {
    emit({ type: 'error', message: startupMessage(error, config?.port ?? 3000) });
    errorOutput.write(`Frota Estelar: ${error.code || error.name || 'STARTUP_ERROR'}\n`);
    if (server) await server.close();
    return 1;
  } finally {
    profiles?.close();
    lines.close();
    input.pause();
    input.removeListener('error', stop);
    output.removeListener('error', stop);
    signals.removeListener('SIGINT', stop);
    signals.removeListener('SIGTERM', stop);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) process.exitCode = await runDesktop();
