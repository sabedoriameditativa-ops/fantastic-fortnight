#!/usr/bin/env node
// UI flow walker + screenshots (Playwright). Serves the repo (server/index.js
// when present, otherwise the global http-server, otherwise an inline static
// server), walks menu → SP setup → fleet builder (faction, ships, preset,
// confirm) → battle at x4 → results, plus codex / howto / options / lobby
// entry, and captures a screenshot of every screen. Fails on any page error or
// console error.
//
//   node tools/ui-shots.js [--out DIR] [--port 8766] [--w 1440] [--h 900] [--mobile] [--quick]

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { stat, mkdir, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const OUT = resolve(opt('out', process.env.SCRATCHPAD ? join(process.env.SCRATCHPAD, 'ui-shots') : join(ROOT, 'test-results', 'ui-shots')));
const PORT = +opt('port', 8766);
const MOBILE = args.includes('--mobile');
const W = +opt('w', MOBILE ? 390 : 1440), H = +opt('h', MOBILE ? 844 : 900);
const QUICK = args.includes('--quick');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serveStatic(port) {
  return new Promise((res, rej) => {
    const srv = createServer(async (req, resp) => {
      try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p === '/') p = '/client/index.html';
        else if (!p.startsWith('/shared/') && !p.startsWith('/client/')) p = '/client' + p;
        const file = resolve(ROOT, '.' + p);
        if (!file.startsWith(ROOT)) { resp.writeHead(403); resp.end(); return; }
        const st = await stat(file).catch(() => null);
        if (!st || !st.isFile()) { resp.writeHead(404); resp.end('not found'); return; }
        resp.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        createReadStream(file).pipe(resp);
      } catch (e) { resp.writeHead(500); resp.end(String(e)); }
    });
    srv.on('error', rej);
    srv.listen(port, '127.0.0.1', () => res({ close: () => srv.close(), kind: 'node', base: `http://127.0.0.1:${port}/` }));
  });
}

async function waitHttp(url, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* retry */ }
    await sleep(150);
  }
  return false;
}

async function startServer(port) {
  // 1. the real server, when it exists
  const serverEntry = join(ROOT, 'server', 'index.js');
  if (await access(serverEntry).then(() => true, () => false)) {
    // --tick <ms> / --countdown <ms> speed up the server's battles and countdown (FE_TICK_MS / FE_COUNTDOWN_MS)
    const env = { ...process.env, PORT: String(port) };
    if (opt('tick', '')) env.FE_TICK_MS = opt('tick', '');
    if (opt('countdown', '')) env.FE_COUNTDOWN_MS = opt('countdown', '');
    const child = spawn(process.execPath, [serverEntry], { env, stdio: 'ignore' });
    if (await waitHttp(`http://127.0.0.1:${port}/`, 5000)) return { close: () => child.kill(), kind: 'server/index.js', base: `http://127.0.0.1:${port}/` };
    child.kill();
  }
  // 2. the global http-server (repo root: client at /client/, shared at /shared/)
  try {
    const child = spawn('http-server', [ROOT, '-p', String(port), '-s', '-c-1', '-a', '127.0.0.1'], { stdio: 'ignore' });
    if (await waitHttp(`http://127.0.0.1:${port}/client/index.html`, 4000)) return { close: () => child.kill(), kind: 'http-server', base: `http://127.0.0.1:${port}/client/` };
    child.kill();
  } catch { /* fall through */ }
  // 3. inline
  const s = await serveStatic(port);
  await waitHttp(`${s.base}client/index.html`, 4000);
  return s;
}

async function loadPlaywright() {
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/opt/pw-browsers';
  try { return await import('/opt/node-tools/node_modules/playwright/index.mjs'); } catch { return await import('playwright'); }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startServer(PORT);
  console.log('serving via', server.kind, server.base);
  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-vsync'] });
  const errors = [];
  const shots = [];
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location && m.location();
    if (loc && /fonts\.(googleapis|gstatic)\.com/.test(loc.url || '')) return; // fonts are optional (offline fallback)
    errors.push(`console.error: ${m.text()}${loc && loc.url ? ` @ ${loc.url}` : ''}`);
  });
  page.on('requestfailed', (r) => { if (!/fonts\.g/.test(r.url())) errors.push(`requestfailed: ${r.url()} ${r.failure() && r.failure().errorText}`); });
  const shot = async (name) => { const p = join(OUT, `${String(shots.length + 1).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); shots.push(p); console.log('shot', p); };
  const click = async (test) => { await page.click(`[data-test="${test}"]`); await sleep(250); };
  const base = server.base.endsWith('/client/') ? server.base : server.base;
  const url = (q = '') => `${base}${base.endsWith('/client/') ? 'index.html' : ''}${q}`;

  try {
    await page.goto(url('?debug=1'), { waitUntil: 'load' });
    await page.waitForSelector('[data-test="menu-single"]');
    await sleep(1200);
    await shot('menu');

    // name
    await page.fill('[data-test="name"]', 'Ana');
    await page.press('[data-test="name"]', 'Tab');

    // options / howto / codex
    await click('menu-options'); await sleep(300); await shot('options'); await click('back');
    await click('menu-howto'); await sleep(500); await shot('howto'); await click('back');
    await click('menu-codex'); await sleep(900); await shot('codex');
    await click('codex-lum_catedral'); await sleep(600); await shot('codex-detail'); await click('codex-back'); await click('back');

    // multiplayer entry (no server → the error panel; with server → the entry form)
    await click('menu-multi'); await sleep(1500); await shot('mp-entry');
    if (server.kind === 'server/index.js') {
      // --- two humans (host + guest via the ?sala= link) + bots, through countdown, battle, results and rematch ---
      await click('create-teamsize-2');
      await click('create-room'); await sleep(800); await shot('lobby');
      const code = (await page.textContent('[data-test="room-code"]')).trim();
      console.log('room code', code);
      const guestCtx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      const guest = await guestCtx.newPage();
      guest.on('pageerror', (e) => errors.push(`guest pageerror: ${e.message}`));
      guest.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test((m.location() || {}).url || '')) errors.push(`guest console.error: ${m.text()}`); });
      const gshot = async (name) => { const p = join(OUT, `${String(shots.length + 1).padStart(2, '0')}-${name}.png`); await guest.screenshot({ path: p }); shots.push(p); console.log('shot', p); };
      const gclick = async (test) => { await guest.click(`[data-test="${test}"]`); await sleep(250); };
      await guest.goto(url(`?sala=${code}&debug=1`), { waitUntil: 'load' });
      await guest.waitForSelector('[data-test="room-code"]', { timeout: 15000 });
      await sleep(600); await gshot('lobby-guest-joined');
      // host: bots in the remaining slots, fleet, ready
      await click('add-bot-0-1'); await click('add-bot-1-1'); await sleep(400);
      await click('build-fleet'); await sleep(600);
      await click('preset-ter_linha'); await click('fleet-confirm'); await sleep(800);
      await click('ready'); await sleep(400); await shot('lobby-host-ready');
      // guest: fleet (another faction), ready
      await gclick('build-fleet'); await sleep(600);
      await gclick('faction-vorrax'); await gclick('preset-vor_garras'); await gclick('fleet-confirm'); await sleep(800);
      await gclick('ready'); await sleep(500); await gshot('lobby-guest-ready');
      // host starts → countdown on both → battle via the network feed
      await click('start');
      await page.waitForSelector('[data-test="countdown"]', { timeout: 10000 });
      await sleep(900); await shot('countdown');
      await page.waitForSelector('[data-test="hud-live"]', { timeout: 20000 });
      await guest.waitForSelector('[data-test="hud-live"]', { timeout: 20000 });
      await sleep(QUICK ? 5000 : 9000);
      await shot('mp-battle-host'); await gshot('mp-battle-guest');
      const live = await page.textContent('[data-test="hud-live"]');
      console.log('live indicator:', live.trim());
      if (!QUICK) {
        await page.waitForSelector('[data-test="result-winner"]', { timeout: 300000 });
        await guest.waitForSelector('[data-test="result-winner"]', { timeout: 20000 });
        await sleep(800); await shot('mp-results-host');
        await click('rematch'); await sleep(600);
        console.log('rematch label after one vote:', (await page.textContent('[data-test="rematch"]')).trim());
        await gclick('rematch');
        await page.waitForSelector('[data-test="start"]', { timeout: 15000 });
        await sleep(500); await shot('lobby-after-rematch');
        await gclick('leave-room'); await sleep(600);
        await shot('lobby-guest-left');
        await click('leave-room'); await sleep(500);
      } else {
        // quitting a network battle leaves the room → both land on the multiplayer entry
        await gclick('hud-quit'); await gclick('quit-ok'); await sleep(600);
        await click('hud-quit'); await click('quit-ok'); await sleep(600);
        await page.waitForSelector('[data-test="create-room"]', { timeout: 10000 });
      }
      await guestCtx.close();
    }
    await click('back');

    // single player
    await click('menu-single'); await sleep(400);
    await click('level-3'); await click('difficulty-dificil'); await click('teamsize-2'); await sleep(200);
    await shot('sp-setup');
    await click('sp-build'); await sleep(900);
    await shot('builder-empty');
    await click('faction-lumen'); await sleep(600);
    await click('ship-add-lum_prisma'); await click('ship-add-lum_prisma'); await click('ship-add-lum_serafim'); await click('ship-add-lum_centelha');
    await sleep(300); await shot('builder-manual');
    await click('preset-lum_coro'); await sleep(400); await shot('builder-preset');
    const validation = await page.textContent('[data-test="fleet-validation"]');
    console.log('validation:', validation);
    await page.evaluate(() => window.scrollTo(0, 0));
    await click('fleet-confirm');
    await page.waitForSelector('[data-test="battle-intro"]', { timeout: 15000 });
    await sleep(600); await shot('battle-intro');
    await click('battle-begin');
    await click('speed-4');
    await sleep(QUICK ? 4000 : 9000);
    await shot('battle-x4');
    // the battle may already be over at x4: these interactions are best-effort
    const ended = async () => !!(await page.$('[data-test="battle-end"], [data-test="result-winner"]'));
    if (!(await ended())) {
      await page.click('[data-test="hud-names"]', { timeout: 3000 }).catch(() => {}); await page.click('[data-test="hud-grid"]', { timeout: 3000 }).catch(() => {});
      await sleep(900); await shot('battle-names-grid');
      await page.click('[data-test="hud-names"]', { timeout: 3000 }).catch(() => {}); await page.click('[data-test="hud-grid"]', { timeout: 3000 }).catch(() => {});
    }
    if (!(await ended())) {
      await page.click('[data-test="speed-0"]', { timeout: 3000 }).catch(() => {}); await sleep(400); await shot('battle-paused');
      await page.click('[data-test="speed-4"]', { timeout: 3000 }).catch(() => {});
    }
    await page.waitForSelector('[data-test="result-winner"]', { timeout: 240000 });
    await sleep(900);
    await shot('results');
    const winner = await page.textContent('[data-test="result-winner"]');
    console.log('result:', winner);
    const hasNext = await page.$('[data-test="next-level"]');
    console.log('next-level button:', !!hasNext);
    await click('edit-fleet'); await sleep(600); await shot('builder-from-results');
    await click('back'); await sleep(300); await shot('sp-setup-cleared');

    // autotest entry point
    await page.goto(url('?autotest=1&level=1&difficulty=facil&faction=vorrax&preset=vor_garras&speed=4&seed=7&debug=1'), { waitUntil: 'load' });
    await page.waitForSelector('[data-test="hud-time"]', { timeout: 15000 });
    await sleep(2500); await shot('autotest-battle');
    const fe = await page.evaluate(() => ({ screen: window.__fe.screen, errors: window.__fe.errors, speed: window.__fe.feed && window.__fe.feed.controls.speed, mode: window.__fe.feed && window.__fe.feed.controls.mode, tick: window.__fe.renderer && window.__fe.renderer.getView().tick }));
    console.log('autotest __fe:', JSON.stringify(fe));
    if (fe.errors && fe.errors.length) errors.push(...fe.errors.map((e) => `__fe.errors: ${e}`));
    await page.waitForSelector('[data-test="result-winner"]', { timeout: 240000 });
    await sleep(500); await shot('autotest-results');
  } catch (e) {
    // capture the state of every open page to diagnose the failure
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) {
      const file = join(OUT, `error-${ctx === browser.contexts()[0] ? 'host' : 'guest'}.png`);
      await p.screenshot({ path: file }).catch(() => {});
      console.log('failure screenshot', file, p.url());
    }
    throw e;
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\nScreenshots:');
  for (const p of shots) console.log('  ' + p);
  if (errors.length) { console.log('\nErrors:'); for (const e of errors.slice(0, 30)) console.log('  ' + e); process.exitCode = 1; }
  else console.log('\nNo page errors.');
}

main().catch((e) => { console.error(e); process.exit(1); });
