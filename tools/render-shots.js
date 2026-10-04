#!/usr/bin/env node
// Renderer screenshot tool: serves the repo, opens client/dev/render-demo.html
// in headless Chromium (Playwright) and captures: the showcase grid of all 32
// ships, one row per faction at zoom 2, a mid-battle frame, an explosion
// moment and a 500-ship stress frame. Prints the paths and measured frame times.
//
//   node tools/render-shots.js [--out DIR] [--port 8765] [--w 1920] [--h 1080] [--quick]

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const OUT = resolve(opt('out', process.env.SCRATCHPAD ? join(process.env.SCRATCHPAD, 'shots') : join(ROOT, 'test-results', 'render-shots')));
const PORT = +opt('port', 8765);
const W = +opt('w', 1920), H = +opt('h', 1080);
const QUICK = args.includes('--quick');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

/** Tiny static server (fallback when the global http-server is unavailable). */
function serveStatic(port) {
  return new Promise((res, rej) => {
    const srv = createServer(async (req, resp) => {
      try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p === '/') p = '/client/index.html';
        const file = resolve(ROOT, '.' + p);
        if (!file.startsWith(ROOT)) { resp.writeHead(403); resp.end(); return; }
        const st = await stat(file).catch(() => null);
        if (!st || !st.isFile()) { resp.writeHead(404); resp.end('not found'); return; }
        resp.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        createReadStream(file).pipe(resp);
      } catch (e) { resp.writeHead(500); resp.end(String(e)); }
    });
    srv.on('error', rej);
    srv.listen(port, '127.0.0.1', () => res({ close: () => srv.close(), kind: 'node' }));
  });
}

async function waitHttp(url, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function startServer(port) {
  // prefer the global http-server binary, fall back to the inline server
  try {
    const child = spawn('http-server', [ROOT, '-p', String(port), '-s', '-c-1', '-a', '127.0.0.1'], { stdio: 'ignore' });
    const ok = await waitHttp(`http://127.0.0.1:${port}/client/dev/render-demo.html`, 4000);
    if (ok) return { close: () => child.kill(), kind: 'http-server' };
    child.kill();
  } catch (e) { /* fall through */ }
  const s = await serveStatic(port);
  await waitHttp(`http://127.0.0.1:${port}/client/dev/render-demo.html`, 4000);
  return s;
}

async function loadPlaywright() {
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/opt/pw-browsers';
  try { return await import('/opt/node-tools/node_modules/playwright/index.mjs'); } catch (e) { return await import('playwright'); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openDemo(browser, url, errors) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__demo && window.__demo.ready(), null, { timeout: 20000 });
  return page;
}

async function measure(page, ms) {
  // average the renderer's own counters over a window
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { samples.push(await page.evaluate(() => window.__demo.stats())); await sleep(250); }
  const avg = (k) => samples.reduce((s, x) => s + x[k], 0) / samples.length;
  return { fps: +avg('fps').toFixed(1), drawMs: +avg('drawMs').toFixed(2), frameMs: +avg('frameMs').toFixed(2), worstMs: +Math.max(...samples.map((s) => s.worstMs)).toFixed(1), ships: Math.round(avg('ships')), particles: Math.round(avg('particles')), density: +avg('density').toFixed(2), sprites: Math.round(avg('sprites')) };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startServer(PORT);
  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-vsync'] });
  const base = `http://127.0.0.1:${PORT}/client/dev/render-demo.html`;
  const errors = [];
  const shots = [];
  const stats = {};
  const shot = async (page, name) => { const p = join(OUT, name + '.png'); await page.screenshot({ path: p }); shots.push(p); console.log('shot', p); };
  try {
    // 1. showcase: all 32 ships + one row per faction at zoom 2
    let page = await openDemo(browser, `${base}?mode=showcase&ui=0`, errors);
    await sleep(1200);
    await page.evaluate(() => window.__demo.frameAll());
    await sleep(400);
    await shot(page, '01-showcase-all');
    for (const f of ['terran', 'vorrax', 'lumen', 'ferrix']) {
      for (const half of [0, 1]) {
        await page.evaluate(([fx, h]) => window.__demo.showcase(fx, 2, h), [f, half]);
        await sleep(350);
        await shot(page, `02-showcase-${f}-${half ? 'large' : 'small'}-zoom2`);
      }
    }
    stats.showcase = await measure(page, 1500);
    await page.close();

    // 2. battle: mid-fight, then an explosion moment
    page = await openDemo(browser, `${base}?mode=battle&seed=42&ui=0`, errors);
    await page.evaluate(() => window.__demo.feed.debug.engage());
    await sleep(QUICK ? 6000 : 12000);
    await page.evaluate(() => window.__demo.castAll());
    await sleep(900);
    await shot(page, '03-battle-mid');
    stats.battle = await measure(page, QUICK ? 2000 : 4000);
    // explosion: frame the biggest alive ship (free camera, zoom 1), kill it, capture the secondaries,
    // the main blast and the debris/smoke phase
    const id = await page.evaluate(() => {
      const d = window.__demo; const r = d.renderer;
      const big = d.feed.debug.ships.filter((s) => s.alive).sort((a, b) => b.cat.cost - a.cat.cost)[0];
      r.camera.follow(0); r.camera.setMode('free'); r.camera.raw.jumpTo(big.x, big.y, 1.0);
      d.feed.debug.kill(big.id);
      return big.id;
    });
    const keepFree = () => page.evaluate(() => window.__demo.renderer.camera.setMode('free'));
    await sleep(400); await keepFree(); await shot(page, '04-explosion-early');
    await sleep(400); await keepFree(); await shot(page, '05-explosion-main');
    await sleep(500); await keepFree(); await shot(page, '05b-explosion-debris');
    await page.evaluate(() => { const r = window.__demo.renderer; r.camera.setMode('auto'); });
    await sleep(1500);
    await shot(page, '06-battle-late');
    console.log('exploded ship id', id);
    // close-up: follow the biggest alive ship at zoom 1.5 to inspect beams, projectiles and muzzle flashes
    await page.evaluate(() => {
      const d = window.__demo; const r = d.renderer;
      const big = d.feed.debug.ships.filter((s) => s.alive).sort((a, b) => b.cat.cost - a.cat.cost)[0];
      if (big) { r.camera.follow(big.id); r.camera.raw.jumpTo(big.x, big.y, 1.5); }
    });
    await sleep(1800);
    await shot(page, '06b-closeup');
    await page.close();

    // 3. stress: ~500 ships
    page = await openDemo(browser, `${base}?mode=stress&seed=7&ui=0`, errors);
    await page.evaluate(() => window.__demo.feed.debug.engage());
    await sleep(QUICK ? 5000 : 10000);
    await shot(page, '07-stress-500');
    stats.stress = await measure(page, QUICK ? 3000 : 6000);
    await page.evaluate(() => window.__demo.renderer.camera.zoomBy(2.5));
    await sleep(1200);
    await shot(page, '08-stress-zoomed');
    stats.stressZoomed = await measure(page, 2000);
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\nScreenshots:');
  for (const p of shots) console.log('  ' + p);
  console.log('\nMeasured (headless Chromium, software GL — real GPUs are faster):');
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${JSON.stringify(v)}`);
  if (errors.length) { console.log('\nPage errors/warnings:'); for (const e of errors.slice(0, 20)) console.log('  ' + e); }
  else console.log('\nNo page errors.');
  process.exitCode = errors.some((e) => e.startsWith('pageerror')) ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
