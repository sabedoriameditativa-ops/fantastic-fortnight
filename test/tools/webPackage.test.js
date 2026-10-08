import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, lstatSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from 'es-module-lexer/minimal';
import { buildWeb } from '../../tools/build-web.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TOOL = fileURLToPath(new URL('../../tools/build-web.js', import.meta.url));

function put(root, name, value) {
  mkdirSync(dirname(join(root, name)), { recursive: true });
  writeFileSync(join(root, name), value);
}

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'Frota web ação '));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'source'), out = join(parent, 'public');
  put(root, 'package.json', JSON.stringify({ name: 'fixture', version: '1.2.3-preview.1', privateCredential: 'PRIVATE_TEST_SENTINEL' }));
  put(root, 'LICENSE.txt', 'Direitos reservados ao titular.');
  put(root, 'THIRD_PARTY_NOTICES.md', 'Licenças das dependências preservadas.');
  put(root, 'client/index.html', '<!doctype html><html lang="pt-BR" data-deployment="server"><link href="./styles.css" rel="stylesheet"><script type="module" src="./app.js"></script></html>');
  put(root, 'client/styles.css', '@font-face { font-family: Test; src: url(./fonts/test.woff2); }');
  put(root, 'client/fonts/test.woff2', Buffer.from([0, 1, 255, 42, 10]));
  put(root, 'client/fonts/LICENSES.txt', 'Complete font license notice');
  put(root, 'client/fonts/SOURCES.txt', 'Font provenance');
  put(root, 'client/app.js', `import { value } from '/shared/value.js';
import { relativeValue } from './util/bridge.js';
export { value, relativeValue };
export * from '/shared/value.js';
export const lazy = () => import('/shared/lazy.js?version=1#test');
export const workerURL = () => new URL('./battle/simWorker.js', import.meta.url);
// import('/server/private.js') is documentation, not a dependency.
export const note = "import('/server/private.js')";
`);
  put(root, 'client/util/bridge.js', "export { value as relativeValue } from '../../shared/value.js';\n");
  put(root, 'client/battle/simWorker.js', "import { value } from '/shared/value.js'; export const workerValue = value;\n");
  put(root, 'shared/value.js', 'export const value = 42;\n');
  put(root, 'shared/lazy.js', "export { value } from './value.js';\n");
  return { parent, root, out };
}

function filesBelow(root, prefix = '') {
  return readdirSync(join(root, prefix)).flatMap((name) => {
    const file = prefix ? `${prefix}/${name}` : name;
    return lstatSync(join(root, file)).isDirectory() ? filesBelow(root, file) : [file];
  }).sort();
}

function link(t, target, path, type) {
  try { symlinkSync(target, path, type); }
  catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('This account cannot create symlinks.'); return false; }
    throw error;
  }
  return true;
}

test('web package relocates imports, reexports, dynamic imports and Worker modules without changing sources', async (t) => {
  const { root, out } = fixture(t);
  const original = readFileSync(join(root, 'client/app.js'), 'utf8');
  const result = buildWeb({ root, out });
  assert.equal(result.out, out);
  assert.equal(result.version, '1.2.3-preview.1');
  assert.equal(result.deployment, 'static');
  assert.equal(readFileSync(join(root, 'client/app.js'), 'utf8'), original);
  assert.match(readFileSync(join(root, 'client/index.html'), 'utf8'), /data-deployment="server"/);
  assert.match(readFileSync(join(out, 'index.html'), 'utf8'), /data-deployment="static"/);
  assert.match(readFileSync(join(out, 'util/bridge.js'), 'utf8'), /from ['"]\.\.\/shared\/value\.js['"]/);
  assert.match(readFileSync(join(out, 'battle/simWorker.js'), 'utf8'), /from ['"]\.\.\/shared\/value\.js['"]/);
  const app = await import(pathToFileURL(join(out, 'app.js')).href);
  assert.equal(app.value, 42);
  assert.equal(app.relativeValue, 42);
  assert.equal((await app.lazy()).value, 42);
  assert.equal(app.note, "import('/server/private.js')", 'ordinary string content is not rewritten');
  assert.equal((await import(app.workerURL().href)).workerValue, 42);
  assert.deepEqual(readFileSync(join(out, 'fonts/test.woff2')), readFileSync(join(root, 'client/fonts/test.woff2')));
  for (const file of ['LICENSE.txt', 'THIRD_PARTY_NOTICES.md', 'fonts/LICENSES.txt', 'fonts/SOURCES.txt', '.nojekyll', 'build.json']) assert.ok(filesBelow(out).includes(file), file);
  assert.deepEqual([...result.files, 'build.json'].sort(), filesBelow(out));
  if (process.platform !== 'win32') {
    assert.equal(statSync(out).mode & 0o777, 0o755, 'Pages must be able to traverse the tar root');
    assert.equal(statSync(join(out, 'shared')).mode & 0o777, 0o755);
    assert.equal(statSync(join(out, 'app.js')).mode & 0o777, 0o644);
  }
});

test('only public runtime resources ship, including when private files live near allowed code', (t) => {
  const { root, out } = fixture(t);
  for (const name of [
    '.env', 'server/index.js', 'node_modules/private/index.js', 'data/profiles.sqlite',
    'test/secret.js', 'client/dev/demo.js', 'client/data/profiles.json', 'client/.env',
    'client/util/secret.json', 'client/util/private.test.js', 'client/util/unreferenced.js',
    'shared/unreferenced.js', 'shared/test/private.js', 'client/fonts/private.txt',
  ]) put(root, name, 'PRIVATE_TEST_SENTINEL');
  const result = buildWeb({ root, out });
  assert.ok(!result.files.some((name) => /server|node_modules|data\/|test|dev|\.env|unreferenced|secret|private/.test(name) && name !== 'fonts/test.woff2'));
  for (const name of filesBelow(out)) assert.ok(!readFileSync(join(out, name)).includes(Buffer.from('PRIVATE_TEST_SENTINEL')), name);
  const metadata = JSON.parse(readFileSync(join(out, 'build.json'), 'utf8'));
  assert.equal(metadata.version, '1.2.3-preview.1');
  assert.equal(metadata.privateCredential, undefined);
});

test('regular expressions and documentation cannot hide or invent module imports', (t) => {
  const { root, out } = fixture(t);
  put(root, 'client/app.js', `const quote = /['"]/;
const pattern = /import('private.js')/;
/** @type {import('/not-a-module.js').Example} */
import { value } from '/shared/value.js';
export { value };
`);
  buildWeb({ root, out });
  const built = readFileSync(join(out, 'app.js'), 'utf8');
  assert.match(built, /from ['"]\.\/shared\/value\.js['"]/);
  assert.ok(filesBelow(out).includes('shared/value.js'));
  assert.match(built, /@type \{import\('\/not-a-module\.js'\)/, 'JSDoc is preserved');
});

test('unsafe output paths and existing user directories are preserved', (t) => {
  const { parent, root, out } = fixture(t);
  const original = readFileSync(join(root, 'client/app.js'));
  for (const destination of [parent, root, join(root, 'client'), join(root, 'shared')]) {
    assert.throws(() => buildWeb({ root, out: destination }), /substituir a origem/);
  }
  put(out, 'my-notes.txt', 'keep me');
  assert.throws(() => buildWeb({ root, out }), /não pertencem/);
  assert.equal(readFileSync(join(out, 'my-notes.txt'), 'utf8'), 'keep me');
  assert.deepEqual(readFileSync(join(root, 'client/app.js')), original);
});

test('known output is replaced without stale files; unrelated additions block replacement', (t) => {
  const { root, out } = fixture(t);
  buildWeb({ root, out });
  put(root, 'client/app.js', "export { value } from '/shared/value.js';\n");
  buildWeb({ root, out });
  assert.ok(!filesBelow(out).includes('shared/lazy.js'));
  assert.ok(!filesBelow(out).includes('util/bridge.js'));
  put(out, 'notes.txt', 'keep me');
  const previous = readFileSync(join(out, 'app.js'));
  assert.throws(() => buildWeb({ root, out }), /alheio/);
  assert.equal(readFileSync(join(out, 'notes.txt'), 'utf8'), 'keep me');
  assert.deepEqual(readFileSync(join(out, 'app.js')), previous);
});

test('invalid imports fail before changing a previously generated site', (t) => {
  const { root, out } = fixture(t);
  buildWeb({ root, out });
  const previous = readFileSync(join(out, 'app.js'));
  put(root, 'server/private.js', 'export const secret = true;');
  put(root, 'client/app.js', "import '../server/private.js';\n");
  assert.throws(() => buildWeb({ root, out }), /fora dos recursos públicos/);
  assert.deepEqual(readFileSync(join(out, 'app.js')), previous);
});

test('source symlinks and symlink output parents cannot expose or overwrite external files', (t) => {
  const { parent, root, out } = fixture(t);
  const external = join(parent, 'external');
  put(external, 'private.js', 'PRIVATE_TEST_SENTINEL');
  if (!link(t, join(external, 'private.js'), join(root, 'client/util/link.js'), 'file')) return;
  assert.throws(() => buildWeb({ root, out }), /Symlink/);
  rmSync(join(root, 'client/util/link.js'));
  const alias = join(parent, 'alias');
  if (!link(t, external, alias, 'junction')) return;
  assert.throws(() => buildWeb({ root, out: join(alias, 'new-site') }), /link simbólico/);
  assert.deepEqual(filesBelow(external), ['private.js']);
});

test('the real distribution resolves every runtime import and Worker URL under a repository prefix', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'fe-web-real-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const out = join(parent, 'site'), result = buildWeb({ root: ROOT, out });
  const prefix = 'https://example.test/fantastic-fortnight/';
  const published = new Set(result.files);
  let references = 0;
  function check(specifier, source) {
    const url = new URL(specifier, new URL(source, prefix));
    assert.ok(url.href.startsWith(prefix), `${source}: ${specifier} escapes the repository prefix`);
    const target = decodeURIComponent(url.pathname.slice('/fantastic-fortnight/'.length));
    assert.ok(published.has(target), `${source}: missing ${target}`);
    references++;
  }
  for (const name of result.files.filter((name) => name.endsWith('.js'))) {
    const code = readFileSync(join(out, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const dependency of parse(code)[0]) if (dependency.d !== -2) check(dependency.n, name);
    for (const match of code.matchAll(/new\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url/g)) check(match[2], name);
  }
  assert.ok(references > 100, `Only ${references} runtime references were verified`);
  assert.ok(published.has('battle/simWorker.js'));
  assert.ok(published.has('shared/sim/battle.js'));
  assert.match(readFileSync(join(out, 'util/fleetLibrary.js'), 'utf8'), /from ['"]\.\.\/shared\/fleet\.js['"]/);
  assert.match(readFileSync(join(out, 'util/spConfig.js'), 'utf8'), /from ['"]\.\.\/shared\/spConfig\.js['"]/);
  assert.ok(!published.has('shared/sim/harness.js'));
  for (const name of ['server/index.js', 'client/index.html', 'dev/render-demo.html', 'package.json']) assert.ok(!published.has(name), name);
});

test('CLI rejects unknown arguments instead of building to an unintended destination', () => {
  const run = spawnSync(process.execPath, [TOOL, '--unknown'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Uso:/);
});
