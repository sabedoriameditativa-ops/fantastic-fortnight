#!/usr/bin/env node
// Static distribution only: client/ becomes the site root, shared/ stays shared/.
// Source files are never rewritten, and unknown output directories are preserved.
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'es-module-lexer/minimal';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILDER = 'frota-estelar-static-web-v1';
const DIRECTORIES = new Set([
  'client', 'client/audio', 'client/battle', 'client/battle/render', 'client/fonts',
  'client/screens', 'client/util', 'shared', 'shared/sim',
]);
const ROOT_CLIENT = new Set(['app.js', 'i18n.js', 'index.html', 'styles.css']);
const LEGAL = ['LICENSE.txt', 'THIRD_PARTY_NOTICES.md'];
const CODE = /\.(?:js|mjs)$/;

function stat(filename) {
  try { return lstatSync(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function inside(parent, child) {
  const part = relative(parent, child);
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`));
}

function plainDirectories(filename) {
  for (let current = filename; ; current = dirname(current)) {
    const info = stat(current);
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error(`Pasta inválida ou link simbólico: ${current}`);
    if (dirname(current) === current) break;
  }
}

function sourceFiles(root) {
  const files = new Map();
  function visit(dir) {
    const info = stat(join(root, dir));
    if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error(`Pasta de origem inválida ou symlink: ${dir}`);
    for (const name of readdirSync(join(root, dir)).sort()) {
      const source = `${dir}/${name}`, item = lstatSync(join(root, source));
      if (item.isSymbolicLink()) throw new Error(`Symlink não permitido no pacote web: ${source}`);
      if (name.startsWith('.')) continue;
      if (item.isDirectory()) { if (DIRECTORIES.has(source)) visit(source); continue; }
      if (!item.isFile() || /\.(?:test|spec)\.[cm]?js$/i.test(name)) continue;
      const allowed = dir === 'client' ? ROOT_CLIENT.has(name)
        : dir === 'client/fonts' ? /\.(?:woff2?|ttf|otf)$/i.test(name) || ['LICENSES.txt', 'SOURCES.txt'].includes(name)
          : CODE.test(name);
      if (allowed) files.set(source, source.startsWith('client/') ? source.slice(7) : source);
    }
  }
  visit('client'); visit('shared');
  for (const name of LEGAL) {
    const info = stat(join(root, name));
    if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Aviso legal ausente ou inválido: ${name}`);
    files.set(name, name);
  }
  for (const name of ['client/index.html', 'client/styles.css', 'client/app.js', 'client/fonts/LICENSES.txt']) {
    if (!files.has(name)) throw new Error(`Recurso obrigatório ausente: ${name}`);
  }
  return files;
}

// The lexer distinguishes executable module syntax from comments, strings and
// regex literals. Its minimal build initializes synchronously in Node.js.
function references(source) {
  return parse(source)[0].filter((item) => item.d !== -2).map((item) => {
    if (typeof item.n !== 'string') throw new Error('Imports dinâmicos precisam de um caminho literal no pacote web.');
    return {
      specifier: item.n,
      start: item.d === -1 ? item.s - 1 : item.s,
      end: item.d === -1 ? item.e + 1 : item.e,
    };
  });
}

function rewriteModule(source, sourcePath, outputPath, files, visit) {
  const replacements = [];
  for (const token of references(source)) {
    const specifier = token.specifier;
    if (specifier.includes('\\')) throw new Error(`Import com escape não suportado: ${sourcePath}: ${specifier}`);
    const [, pathname, suffix = ''] = /^([^?#]+)([?#].*)?$/.exec(specifier) || [];
    let target;
    if (pathname?.startsWith('/shared/')) target = posix.normalize(pathname.slice(1));
    else if (pathname?.startsWith('.')) target = posix.normalize(posix.join(posix.dirname(sourcePath), pathname));
    if (!target || !files.has(target)) throw new Error(`Import fora dos recursos públicos ou inexistente: ${sourcePath}: ${specifier}`);
    const mapped = files.get(target);
    let destination = posix.relative(posix.dirname(outputPath), mapped);
    if (!destination.startsWith('.')) destination = `./${destination}`;
    visit(target);
    replacements.push({ ...token, text: JSON.stringify(destination + suffix) });
  }
  for (const replacement of replacements.reverse()) source = source.slice(0, replacement.start) + replacement.text + source.slice(replacement.end);
  return source;
}

function validateOutput(root, out) {
  if (inside(out, root) || (inside(root, out) && !inside(join(root, 'dist'), out))) {
    throw new Error('A saída web não pode substituir a origem; use dist/web ou uma pasta externa nova.');
  }
  plainDirectories(out);
  if (!stat(out) || readdirSync(out).length === 0) return;
  const marker = stat(join(out, 'build.json'));
  if (!marker?.isFile() || marker.isSymbolicLink() || marker.size > 1_048_576) throw new Error('A saída já contém arquivos que não pertencem ao build web.');
  let previous;
  try { previous = JSON.parse(readFileSync(join(out, 'build.json'), 'utf8')); } catch { throw new Error('Metadados inválidos na saída existente.'); }
  if (previous.builder !== BUILDER || !Array.isArray(previous.files)
    || previous.files.some((name) => typeof name !== 'string' || name.startsWith('/') || name.includes('\\') || posix.normalize(name) !== name || name === '..' || name.startsWith('../'))) {
    throw new Error('A saída existente não é um build web reconhecido.');
  }
  const allowed = new Set([...previous.files, 'build.json']);
  const directories = new Set();
  for (const name of allowed) for (let parent = posix.dirname(name); parent !== '.'; parent = posix.dirname(parent)) directories.add(parent);
  function check(dir = '') {
    for (const name of readdirSync(join(out, dir))) {
      const path = dir ? `${dir}/${name}` : name, item = lstatSync(join(out, path));
      if (item.isSymbolicLink()) throw new Error(`Symlink na saída existente: ${path}`);
      if (item.isDirectory() && directories.has(path)) check(path);
      else if (!item.isFile() || !allowed.has(path)) throw new Error(`Arquivo alheio ao build na saída: ${path}`);
    }
  }
  check();
}

export function buildWeb({ root = ROOT, out = join(root, 'dist', 'web') } = {}) {
  root = resolve(root); out = resolve(out);
  plainDirectories(root);
  validateOutput(root, out);
  const files = sourceFiles(root), output = new Map(), visited = new Set();
  function visit(source) {
    if (visited.has(source)) return;
    visited.add(source);
    const target = files.get(source), bytes = readFileSync(join(root, source));
    output.set(target, CODE.test(source) ? rewriteModule(bytes.toString('utf8'), source, target, files, visit) : bytes);
  }
  // Only code reachable from the application (including its Worker) is shipped.
  visit('client/app.js');
  // This independent module entry point is created by localRunner via new URL.
  if (files.has('client/battle/simWorker.js')) visit('client/battle/simWorker.js');
  for (const source of files.keys()) if (!CODE.test(source)) visit(source);
  let html = output.get('index.html').toString('utf8');
  if (!/<html\b[^>]*>/i.test(html)) throw new Error('Documento inicial sem elemento html.');
  html = html.replace(/<html\b[^>]*>/i, (tag) => /\bdata-deployment\s*=/i.test(tag)
    ? tag.replace(/\bdata-deployment\s*=\s*(["'])[^"']*\1/i, 'data-deployment="static"')
    : tag.replace(/>$/, ' data-deployment="static">'));
  if (!/<html\b[^>]*\bdata-deployment="static"/i.test(html)) throw new Error('Marcador de publicação inválido no documento inicial.');
  output.set('index.html', html);
  output.set('.nojekyll', '');
  const packageFile = stat(join(root, 'package.json'));
  if (!packageFile?.isFile() || packageFile.isSymbolicLink()) throw new Error('package.json ausente ou symlink.');
  const packageInfo = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (typeof packageInfo.version !== 'string' || !/^[\w.+-]{1,100}$/.test(packageInfo.version)) throw new Error('Versão pública inválida em package.json.');
  const manifest = { schema: 1, builder: BUILDER, name: 'Frota Estelar', version: packageInfo.version, deployment: 'static', files: [...output.keys()].sort() };
  output.set('build.json', JSON.stringify(manifest, null, 2) + '\n');

  mkdirSync(dirname(out), { recursive: true });
  const staging = mkdtempSync(join(dirname(out), '.frota-web-build-'));
  let backup;
  try {
    // Pages serves the uploaded tar with these modes, including its root entry.
    chmodSync(staging, 0o755);
    for (const [name, bytes] of output) {
      const destination = join(staging, name);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, bytes);
      chmodSync(destination, 0o644);
      for (let dir = dirname(destination); dir !== staging; dir = dirname(dir)) chmodSync(dir, 0o755);
    }
    validateOutput(root, out);
    if (stat(out)) {
      backup = mkdtempSync(join(dirname(out), '.frota-web-previous-'));
      rmSync(backup, { recursive: true });
      renameSync(out, backup);
    }
    try { renameSync(staging, out); }
    catch (error) { if (backup) renameSync(backup, out); throw error; }
    if (backup) rmSync(backup, { recursive: true, force: true });
  } finally { rmSync(staging, { recursive: true, force: true }); }
  return { ...manifest, out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 0 && (args.length !== 2 || args[0] !== '--out' || !args[1])) throw new Error('Uso: node tools/build-web.js [--out pasta]');
    const result = buildWeb(args.length ? { out: args[1] } : {});
    console.log(`Web estática gerada em ${result.out}: ${result.files.length} arquivos, versão ${result.version}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
