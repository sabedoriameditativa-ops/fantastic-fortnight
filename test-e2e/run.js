#!/usr/bin/env node
// Frota Estelar — end-to-end tests (Playwright + Chromium).
//
// Spawns the real server (server/index.js) on a free port with FE_MAX_TICKS=600
// (30 s battles) and drives the client through the browser:
//   (a) single-player ?autotest=1 battle completes and shows results, no page errors
//   (b) two browser contexts play a 1v1 multiplayer match to the results screen and
//       both see the same winner
//   (c) fleet builder validation: an over-budget fleet (and an empty one) cannot be confirmed
//   (d) the AudioContext is running after the first click
// Each case prints PASS/FAIL; the exit code is 1 when any case fails.
//
//   npm run e2e          (or: node test-e2e/run.js [--headed] [--keep-server])
//
// Playwright comes from the 'playwright' devDependency (npm install), with a
// fallback to /opt/node-tools/node_modules/playwright/index.mjs; Chromium is
// looked up under /opt/pw-browsers (PLAYWRIGHT_BROWSERS_PATH) when that directory
// exists, otherwise in Playwright's own cache (`npx playwright install chromium`).
//
// The server child is killed on every exit path (normal end, failed browser
// launch, global watchdog, process exit); if it dies after reporting
// 'listening', every pending case fails immediately with its stderr tail
// (set E2E_VERBOSE=1 to stream the server's stderr live).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overBudgetAdds } from './overBudget.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const HEADED = ARGS.includes('--headed');
const KEEP_SERVER = ARGS.includes('--keep-server');
const GLOBAL_TIMEOUT_MS = 170_000;          // whole run must finish in < 3 minutes
const BATTLE_TIMEOUT_MS = 90_000;
const STDERR_TAIL_BYTES = 8 * 1024;         // kept from the server's stderr for failure messages
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (name) => `[data-test="${name}"]`;

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

async function loadPlaywright() {
  const attempts = [];
  for (const spec of ['playwright', '/opt/node-tools/node_modules/playwright/index.mjs']) {
    try { return await import(spec); } catch (e) { attempts.push(`${spec}: ${e && (e.code || e.message)}`); }
  }
  throw new Error(`cannot import Playwright (${attempts.join('; ')}).\n` +
    '      Install it with: npm install && npx playwright install chromium');
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/**
 * Spawn server/index.js on a free port (PORT=0). Resolves once it prints
 * "listening <port>" with { port, kill, onExit, stderrTail, child }; onExit
 * callbacks fire only when the child dies on its own (not after kill()).
 */
function startServer() {
  return new Promise((resolveStart, reject) => {
    const env = { ...process.env, PORT: '0', FE_MAX_TICKS: '600', FE_COUNTDOWN_MS: process.env.FE_COUNTDOWN_MS || '2000' };
    const child = spawn(process.execPath, [resolve(ROOT, 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let started = false;
    let killed = false;
    let tail = '';
    const exitListeners = [];
    const handle = {
      child,
      port: 0,
      exitCode: null,
      kill() { killed = true; child.kill('SIGTERM'); },
      onExit(cb) { exitListeners.push(cb); },
      stderrTail: () => tail,
    };
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
      const m = out.match(/listening (\d+)/);
      if (m && !started) { started = true; handle.port = Number(m[1]); resolveStart(handle); }
    });
    child.stderr.on('data', (c) => {
      const s = String(c);
      if (process.env.E2E_VERBOSE) process.stderr.write(s);
      tail = (tail + s).slice(-STDERR_TAIL_BYTES);
    });
    child.on('exit', (code, signal) => {
      handle.exitCode = code ?? signal;
      if (!started) { started = true; reject(new Error(`server exited early (code ${code ?? signal}): ${out}${tail}`)); return; }
      if (!killed) for (const cb of exitListeners) cb(code ?? signal);
    });
    setTimeout(() => { if (!started) { started = true; child.kill(); reject(new Error('server did not start in time')); } }, 10_000).unref();
  });
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

/** Create a page that records page errors and in-origin console errors. */
async function newPage(browser, base, tag, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport, locale: 'pt-BR' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${tag}: pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = (m.location() && m.location().url) || '';
    // resource failures from third-party hosts (e.g. Google Fonts without network) are not app errors
    if (/Failed to load resource/.test(m.text()) && url && !url.startsWith(base)) return;
    if (/Failed to load resource/.test(m.text()) && !url) return;
    errors.push(`${tag}: console.error: ${m.text()}${url ? ` (${url})` : ''}`);
  });
  page.setDefaultTimeout(15_000);
  return { page, context, errors };
}

async function setName(page, name) {
  await page.fill(t('name'), name);
  await page.press(t('name'), 'Tab');
}

/** In the lobby: open the fleet builder, pick a faction + first preset, confirm, back in the lobby. */
async function buildPresetFleet(page, faction) {
  await page.click(t('build-fleet'));
  await page.waitForSelector(t('fleet-confirm'));
  await page.click(t(`faction-${faction}`));
  const presets = await page.$$eval(`${t('presets')} button[data-test^="preset-"]`, (bs) => bs.map((b) => b.dataset.test));
  if (!presets.length) throw new Error(`no presets for ${faction}`);
  await page.click(t(presets[0]));
  await page.waitForFunction((sel) => { const b = document.querySelector(sel); return b && !b.disabled; }, t('fleet-confirm'));
  await page.click(t('fleet-confirm'));
  await page.waitForSelector(t('ready'));
}

async function debugErrors(page) {
  try { return await page.evaluate(() => (window.__fe && window.__fe.errors) ? window.__fe.errors.slice() : []); } catch { return []; }
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

async function caseAutotest(browser, base) {
  const { page, context, errors } = await newPage(browser, base, 'sp');
  try {
    await page.goto(`${base}/?autotest=1&level=2&difficulty=normal&faction=terran&speed=4&seed=e2e-1&debug=1`);
    await page.waitForSelector('#hud', { timeout: 15_000 });
    await page.waitForSelector(t('hud-time'));
    await page.waitForSelector(t('result-winner'), { timeout: BATTLE_TIMEOUT_MS });
    const winner = await page.getAttribute(t('result-winner'), 'data-winner');
    const reason = (await page.textContent(t('result-reason'))).trim();
    const rows = await page.$$eval(`${t('result-table')} tbody tr`, (rs) => rs.length);
    const feErrors = await debugErrors(page);
    if (!['-1', '0', '1'].includes(winner)) throw new Error(`unexpected winner "${winner}"`);
    if (rows !== 2) throw new Error(`expected 2 result rows, got ${rows}`);
    if (!reason) throw new Error('empty result reason');
    if (feErrors.length) throw new Error(`app reported errors: ${feErrors.join(' | ')}`);
    if (errors.length) throw new Error(errors.join(' | '));
    return `winner=${winner} (${reason})`;
  } finally { await context.close(); }
}

async function caseMultiplayer(browser, base) {
  const A = await newPage(browser, base, 'host');
  const B = await newPage(browser, base, 'guest');
  try {
    await A.page.goto(`${base}/?debug=1`);
    await A.page.waitForSelector(t('menu-multi'));
    await setName(A.page, 'Alice');
    await A.page.click(t('menu-multi'));
    await A.page.waitForSelector(t('create-room'));
    await A.page.click(t('create-teamsize-1'));
    await A.page.click(t('create-room'));
    await A.page.waitForSelector(t('room-code'));
    const code = (await A.page.textContent(t('room-code'))).trim();
    if (!/^[A-Z2-9]{4}$/.test(code)) throw new Error(`bad room code "${code}"`);

    await B.page.goto(`${base}/?debug=1`);
    await B.page.waitForSelector(t('menu-multi'));
    await setName(B.page, 'Bruno');
    await B.page.goto(`${base}/?sala=${code}&debug=1`);
    await B.page.waitForSelector(t('room-code'));
    const joined = (await B.page.textContent(t('room-code'))).trim();
    if (joined !== code) throw new Error(`guest joined "${joined}" instead of "${code}"`);

    await buildPresetFleet(A.page, 'terran');
    await buildPresetFleet(B.page, 'vorrax');
    await A.page.click(t('ready'));
    await B.page.click(t('ready'));
    await A.page.waitForFunction((sel) => { const b = document.querySelector(sel); return b && !b.disabled; }, t('start'));
    await A.page.click(t('start'));
    await A.page.waitForSelector(t('countdown'), { timeout: 10_000 });
    await Promise.all([
      A.page.waitForSelector('#hud', { timeout: 20_000 }),
      B.page.waitForSelector('#hud', { timeout: 20_000 }),
    ]);
    await Promise.all([
      A.page.waitForSelector(t('result-winner'), { timeout: BATTLE_TIMEOUT_MS }),
      B.page.waitForSelector(t('result-winner'), { timeout: BATTLE_TIMEOUT_MS }),
    ]);
    const wa = await A.page.getAttribute(t('result-winner'), 'data-winner');
    const wb = await B.page.getAttribute(t('result-winner'), 'data-winner');
    if (wa !== wb) throw new Error(`winners differ: host=${wa} guest=${wb}`);
    if (!['-1', '0', '1'].includes(wa)) throw new Error(`unexpected winner "${wa}"`);
    const rowsA = await A.page.$$eval(`${t('result-table')} tbody tr`, (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
    if (rowsA.length !== 2) throw new Error(`expected 2 result rows, got ${rowsA.length}`);
    const errs = [...A.errors, ...B.errors, ...(await debugErrors(A.page)), ...(await debugErrors(B.page))];
    if (errs.length) throw new Error(errs.join(' | '));
    return `room ${code}, winner=${wa} on both clients`;
  } finally { await A.context.close(); await B.context.close(); }
}

async function caseBuilderValidation(browser, base) {
  const { page, context, errors } = await newPage(browser, base, 'builder');
  try {
    await page.goto(`${base}/?debug=1`);
    await page.waitForSelector(t('menu-single'));
    await page.click(t('menu-single'));
    await page.waitForSelector(t('sp-build'));
    await page.click(t('sp-build'));
    await page.waitForSelector(t('fleet-confirm'));
    await page.click(t('faction-lumen'));
    await page.click(t('clear'));
    if (!(await page.isDisabled(t('fleet-confirm')))) throw new Error('confirm enabled with an empty fleet');
    // buy the most expensive ships (within the size-class caps) until the catalog says the fleet is over budget
    const { adds, cost: expectedCost } = overBudgetAdds('lumen');
    for (const id of adds) {
      const b = await page.$(t(`ship-add-${id}`));
      if (!b) throw new Error(`no add button for ${id}`);
      if (await b.isDisabled()) throw new Error(`add button for ${id} disabled before its cap`);
      await b.click();
    }
    await sleep(100);
    const costText = (await page.textContent(t('budget-cost'))).trim();
    const validation = (await page.textContent(t('fleet-validation'))).trim();
    const disabled = await page.isDisabled(t('fleet-confirm'));
    const over = /ultrapassa/i.test(validation);
    if (!over) throw new Error(`expected an over-budget message after ${adds.length} adds (catalog cost ${expectedCost}), got "${validation}" (${costText})`);
    if (!disabled) throw new Error('confirm button enabled while over budget');
    // clicking the (disabled) confirm must not start a battle
    await page.click(t('fleet-confirm'), { force: true }).catch(() => {});
    await sleep(300);
    if (await page.$('#hud')) throw new Error('battle started with an over-budget fleet');
    // a preset makes it valid again
    const presets = await page.$$eval(`${t('presets')} button[data-test^="preset-"]`, (bs) => bs.map((b) => b.dataset.test));
    if (!presets.length) throw new Error('no presets for lumen');
    await page.click(t(presets[0]));
    await page.waitForFunction((sel) => { const b = document.querySelector(sel); return b && !b.disabled; }, t('fleet-confirm'));
    if (errors.length) throw new Error(errors.join(' | '));
    return `${adds.length} adds → ${costText} → "${validation}" (confirm disabled)`;
  } finally { await context.close(); }
}

async function caseAudio(browser, base) {
  const { page, context, errors } = await newPage(browser, base, 'audio');
  try {
    await page.goto(`${base}/?debug=1`);
    await page.waitForSelector(t('menu-codex'));
    const before = await page.evaluate(() => window.__fe.audio.isReady());
    await page.click(t('menu-codex'));           // first user gesture → audio.init()
    await page.waitForSelector(t('back'));
    await page.waitForFunction(() => window.__fe.audio.isReady() && window.__fe.audio.stats().ctxState === 'running', null, { timeout: 5000 });
    const stats = await page.evaluate(() => window.__fe.audio.stats());
    await page.click(t('back'));
    await page.waitForSelector(t('menu-options'));
    if (errors.length) throw new Error(errors.join(' | '));
    return `ready before click=${before}, after click: state=${stats.ctxState}, scene=${stats.scene}`;
  } finally { await context.close(); }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  const { chromium } = await loadPlaywright();
  const server = await startServer();
  const base = `http://127.0.0.1:${server.port}`;
  console.log(`server listening on ${base} (FE_MAX_TICKS=600)`);

  // --- teardown on every exit path -----------------------------------------
  let browser = null;
  const stopServer = () => { if (!KEEP_SERVER) server.kill(); };
  process.on('exit', stopServer);
  const closeAll = async () => { if (browser) await browser.close().catch(() => {}); browser = null; stopServer(); };
  const watchdog = setTimeout(() => {
    console.log('FAIL  global timeout');
    closeAll().finally(() => process.exit(1));
  }, GLOBAL_TIMEOUT_MS);
  watchdog.unref();

  // --- fail fast when the server dies mid-run --------------------------------
  let serverDeath = null;
  const serverDied = new Promise((_, rej) => server.onExit((code) => {
    serverDeath = new Error(`server died (code ${code}) — stderr tail:\n${server.stderrTail().trim() || '(empty)'}`);
    rej(serverDeath);
  }));
  serverDied.catch(() => {});
  const run = (fn) => {
    if (serverDeath) return Promise.reject(serverDeath);
    const p = fn(browser, base);
    p.catch(() => {});                       // the race may abandon it; its own rejection is reported via the race
    return Promise.race([p, serverDied]);
  };

  const cases = [
    ['(a) single-player autotest battle → results', caseAutotest],
    ['(b) multiplayer 1v1, two clients, same winner', caseMultiplayer],
    ['(c) fleet builder blocks an over-budget fleet', caseBuilderValidation],
    ['(d) audio context running after a click', caseAudio],
  ];
  let failed = 0;
  function report(name, r) {
    if (r.status === 'fulfilled') console.log(`PASS  ${name}${r.value ? ` — ${r.value}` : ''}`);
    else { failed++; console.log(`FAIL  ${name} — ${r.reason && r.reason.message ? r.reason.message : r.reason}`); }
  }
  try {
    browser = await chromium.launch({ headless: !HEADED, args: ['--autoplay-policy=no-user-gesture-required'] });
    // (a) and (b) are the long ones: run them concurrently, then the quick checks
    const results = await Promise.allSettled([run(cases[0][1]), run(cases[1][1])]);
    for (let i = 0; i < 2; i++) report(cases[i][0], results[i]);
    for (const [name, fn] of cases.slice(2)) report(name, await Promise.allSettled([run(fn)]).then((r) => r[0]));
  } finally {
    clearTimeout(watchdog);
    await closeAll();
  }
  console.log(`${cases.length - failed}/${cases.length} passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.log(`FAIL  runner — ${e && e.stack || e}`); process.exit(1); });
