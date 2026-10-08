#!/usr/bin/env node
// Produces a self-contained Windows GUI executable. Build tools are never
// needed on the player's computer. Downloaded runtimes must match a pinned hash.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync, unzipSync, strToU8 } from 'fflate';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NODE_VERSION = '24.19.0';
export const NODE_ZIP_SHA256 = '57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73';
export const sha256 = value => createHash('sha256').update(value).digest('hex');

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024, ...options });
}

/** Explicit roots and extensions prevent profiles, secrets and caches shipping. */
export function appFiles(root = ROOT) {
  const files = [];
  function walk(dir) {
    for (const name of readdirSync(join(root, dir)).sort()) {
      if (name.startsWith('.')) continue;
      const relative = `${dir}/${name}`, stat = lstatSync(join(root, relative));
      if (stat.isSymbolicLink()) throw new Error(`Symlink não permitido no pacote: ${relative}`);
      if (stat.isDirectory()) walk(relative);
      else if (stat.isFile() && (/\.(js|mjs|json|html|css|svg|ico|woff2?|ttf)$/i.test(name)
        || (dir.startsWith('client/fonts') && name.endsWith('.txt')))) files.push(relative);
    }
  }
  for (const dir of ['client', 'shared', 'server', 'node_modules/ws']) walk(dir);
  files.push('package.json');
  return files;
}

export function assertWindowsPE(bytes, { gui = false } = {}) {
  const b = Buffer.from(bytes);
  if (b.length < 256 || b.toString('ascii', 0, 2) !== 'MZ') throw new Error('Executável Windows inválido');
  const pe = b.readUInt32LE(0x3c);
  if (pe + 94 > b.length || b.toString('ascii', pe, pe + 4) !== 'PE\0\0' || b.readUInt16LE(pe + 4) !== 0x8664) {
    throw new Error('O executável precisa ser PE Windows x64');
  }
  if (gui && b.readUInt16LE(pe + 24 + 68) !== 2) throw new Error('Launcher com console: esperado subsistema Windows GUI');
}

export function runtimeFiles(bytes) {
  if (sha256(bytes) !== NODE_ZIP_SHA256) throw new Error('Checksum SHA256 do Node divergente; pacote recusado');
  const prefix = `node-v${NODE_VERSION}-win-x64/`;
  const files = unzipSync(new Uint8Array(bytes), { filter: f => [prefix + 'node.exe', prefix + 'LICENSE'].includes(f.name) });
  if (!files[prefix + 'node.exe'] || !files[prefix + 'LICENSE']) throw new Error('Runtime incompleto');
  assertWindowsPE(files[prefix + 'node.exe']);
  return { 'node.exe': files[prefix + 'node.exe'], 'LICENSES/Node.txt': files[prefix + 'LICENSE'] };
}

export async function buildWindows() {
  const cache = resolve(process.env.FE_BUILD_CACHE || join(homedir(), '.cache', 'frota-desktop'));
  const out = resolve(process.env.FE_BUILD_OUT || join(ROOT, 'dist'));
  const go = process.env.GO_BINARY || 'go';
  let goVersion;
  try { goVersion = run(go, ['version']).trim(); } catch {
    throw new Error('Para gerar o pacote, instale Go >=1.24 ou indique GO_BINARY. Jogadores não precisam de Go ou Node.');
  }
  const version = goVersion.match(/go1\.(\d+)/);
  if (!version || Number(version[1]) < 24) throw new Error(`Compilador Go >=1.24 necessário; recebido: ${goVersion}`);
  const goRoot = run(go, ['env', 'GOROOT']).trim();
  mkdirSync(cache, { recursive: true }); mkdirSync(out, { recursive: true });
  const archive = `node-v${NODE_VERSION}-win-x64.zip`, cached = join(cache, archive);
  if (!existsSync(cached)) {
    const partial = `${cached}.${process.pid}.partial`;
    try {
      console.log(`Baixando Node oficial ${NODE_VERSION} para Windows x64...`);
      run('curl', ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--max-time', '120',
        `https://nodejs.org/dist/v${NODE_VERSION}/${archive}`, '--output', partial]);
      if (sha256(readFileSync(partial)) !== NODE_ZIP_SHA256) throw new Error('Checksum SHA256 do download divergente');
      renameSync(partial, cached);
    } finally { rmSync(partial, { force: true }); }
  }
  const entries = runtimeFiles(readFileSync(cached));
  const files = appFiles();
  for (const file of files) entries[`app/${file}`] = new Uint8Array(readFileSync(join(ROOT, file)));
  entries['LICENSES/ws.txt'] = new Uint8Array(readFileSync(join(ROOT, 'node_modules/ws/LICENSE')));
  entries['LICENSES/Go.txt'] = new Uint8Array(readFileSync(join(goRoot, 'LICENSE')));
  entries['LEIA-ME.txt'] = strToU8('Frota Estelar\n\nAbra FrotaEstelar.exe. O navegador abre automaticamente.\nUse Encerrar na janela do jogo para parar o servidor.\nDados: %LOCALAPPDATA%\\FrotaEstelar\\data\nO Node e todas as dependências de execução já estão incluídos.\n');
  // Stable order and timestamps allow comparing builds with the same toolchain.
  const zipped = Object.fromEntries(Object.keys(entries).sort().map(name => [name, [entries[name], { mtime: new Date('2026-01-01T00:00:00Z') }]]));
  const payload = zipSync(zipped, { level: 6 });
  // Optional validation artifact; ordinary builds only emit the executable.
  if (process.env.FE_BUILD_PAYLOAD_OUT) writeFileSync(resolve(process.env.FE_BUILD_PAYLOAD_OUT), payload);
  const staging = mkdtempSync(join(tmpdir(), 'frota-build-'));
  const temporaryExe = join(out, `.FrotaEstelar-${process.pid}.exe`);
  try {
    for (const name of readdirSync(join(ROOT, 'desktop/launcher'))) {
      if ((name.endsWith('.go') && !name.endsWith('_test.go')) || name === 'go.mod') {
        writeFileSync(join(staging, name), readFileSync(join(ROOT, 'desktop/launcher', name)));
      }
    }
    writeFileSync(join(staging, 'payload.zip'), payload);
    console.log(`Compilando launcher (${files.length} arquivos do jogo, Node incluído)...`);
    run(go, ['build', '-trimpath', '-buildvcs=false', '-ldflags=-H=windowsgui -s -w', '-o', temporaryExe, '.'], {
      cwd: staging,
      env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0', GOTOOLCHAIN: 'local', GOWORK: 'off', GOPROXY: 'off' },
    });
    const binary = readFileSync(temporaryExe);
    assertWindowsPE(binary, { gui: true });
    const manifest = { name: 'Frota Estelar', version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
      platform: 'windows-x64', node: NODE_VERSION, go: goVersion,
      runtimeArchiveSHA256: NODE_ZIP_SHA256, payloadSHA256: sha256(payload), exeSHA256: sha256(binary),
      bytes: binary.length, appFiles: files.length, files };
    const executable = join(out, 'FrotaEstelar.exe');
    renameSync(temporaryExe, executable);
    writeFileSync(join(out, 'FrotaEstelar.build.json'), JSON.stringify(manifest, null, 2) + '\n');
    writeFileSync(join(out, 'FrotaEstelar.sha256'), `${manifest.exeSHA256}  FrotaEstelar.exe\n`);
    console.log(`Gerado: ${executable} (${(binary.length / 1024 / 1024).toFixed(1)} MiB)`);
    console.log(`SHA256: ${manifest.exeSHA256}`);
    return manifest;
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(temporaryExe, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildWindows().catch(error => { console.error(error.message); process.exitCode = 1; });
}
