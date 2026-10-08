#!/usr/bin/env node
// Exercises the actual ZIP's app in Chromium using the HOST Node binary.
// This validates packaged assets/JS, not Windows GUI or Windows runtime execution.
// FE_BUILD_PAYLOAD_OUT=/tmp/payload.zip npm run build:windows
// CHROMIUM_PATH=/usr/bin/chromium node tools/verify-desktop-package.js /tmp/payload.zip
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { unzipSync } from 'fflate';
import { chromium } from 'playwright';

if (process.argv.length !== 3) throw new Error('Informe o ZIP gerado por FE_BUILD_PAYLOAD_OUT');
const root = await mkdtemp(join(tmpdir(), 'Frota pacote ação '));
let child, browser, exited;
const watchdog = setTimeout(() => { child?.kill(); process.exit(1); }, 60_000);
try {
  const files = unzipSync(new Uint8Array(await readFile(process.argv[2])), { filter: f => f.name.startsWith('app/') });
  for (const [name, bytes] of Object.entries(files)) {
    const target = resolve(root, name);
    assert.ok(target.startsWith(root + sep) && !name.includes('\\') && !name.includes('..'), 'Unsafe package path');
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
  }
  const started = performance.now();
  child = spawn(process.execPath, [join(root, 'app/server/desktop.js')], {
    cwd: join(root, 'app'), stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FE_DESKTOP_DATA_DIR: join(root, 'dados'), FE_DESKTOP_PORT: '0' },
  });
  exited = once(child, 'exit');
  let stderr = ''; child.stderr.on('data', value => { stderr = (stderr + value).slice(-4000); });
  const lines = createInterface({ input: child.stdout });
  const message = await Promise.race([
    once(lines, 'line').then(([line]) => JSON.parse(line)),
    exited.then(() => { throw new Error('Packaged server exited: ' + stderr); }),
  ]);
  assert.equal(message.type, 'ready', message.message);
  const serverReadyMs = performance.now() - started;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage();
  const errors = [], externals = [], failed = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => failed.push(request.url()));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === message.url) return route.continue();
    externals.push(route.request().url()); return route.abort();
  });
  await page.goto(message.url + '/?debug=1');
  await page.waitForFunction(() => window.__fe?.screen === 'menu');
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('700 16px Orbitron')), true);
  const profile = await page.evaluate(async () => {
    const response = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return { status: response.status, points: (await response.json()).profile.points };
  });
  assert.deepEqual(profile, { status: 200, points: 0 });
  await page.goto(message.url + '/?autotest=1&level=2&seed=packaged-smoke&debug=1&speed=4');
  await page.waitForFunction(() => window.__fe?.screen === 'battle' && window.__fe.renderer?.stats().tick > 25);
  const battle = await page.evaluate(() => ({ tick: window.__fe.renderer.stats().tick, ships: window.__fe.renderer.stats().ships, errors: window.__fe.errors }));
  assert.ok(battle.ships > 0); assert.deepEqual(battle.errors, []);
  assert.deepEqual(errors, []); assert.deepEqual(externals, []); assert.deepEqual(failed, []);
  console.log(JSON.stringify({ passed: true, hostPlatform: process.platform, windowsExecutionTested: false, serverReadyMs: Math.round(serverReadyMs), files: Object.keys(files).length, battle, externalRequests: externals.length }));
} finally {
  clearTimeout(watchdog);
  await browser?.close();
  if (child && child.exitCode === null) {
    child.stdin.end('shutdown\n');
    const force = setTimeout(() => child.kill(), 5000);
    try { await exited; } finally { clearTimeout(force); }
  }
  await rm(root, { recursive: true, force: true });
}
