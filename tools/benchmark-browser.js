#!/usr/bin/env node
// Real shared simulation in a browser Worker, not the synthetic graphics feed.
// Run alone, without other browser/CPU-heavy suites, for meaningful timings.
// CHROMIUM_PATH=/usr/bin/chromium node tools/benchmark-browser.js [--out DIR]
// FROTA_RENDER_QUALITY=high|medium|low|auto (default high); FROTA_RENDER_OUT=DIR.
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { startServer } from '../server/index.js';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out' || !args[1])) {
  throw new Error('Usage: node tools/benchmark-browser.js [--out DIR]');
}
const out = resolve(args[1] || process.env.FROTA_RENDER_OUT || join(tmpdir(), 'frota-real-6v6-render'));
const quality = process.env.FROTA_RENDER_QUALITY || 'high';
if (!['high', 'medium', 'low', 'auto'].includes(quality)) throw new Error('Invalid FROTA_RENDER_QUALITY');
const seed = 'render-real-6v6-20261008';
const executable = process.env.CHROMIUM_PATH || chromium.executablePath();
const dataDir = await mkdtemp(join(tmpdir(), 'frota-render-profile-'));
const errors = [], warnings = [], requests = [];
let server, browser;
let cleanupPromise;
function cleanup() {
  return cleanupPromise ||= (async () => {
    await Promise.allSettled([browser?.close(), server?.close()]);
    await rm(dataDir, { recursive: true, force: true });
  })();
}
const watchdog = setTimeout(async () => {
  console.error('Browser benchmark exceeded 115 seconds; shutting down.');
  const forceExit = setTimeout(() => process.exit(1), 5000);
  forceExit.unref();
  try { await cleanup(); } finally { process.exit(1); }
}, 115000);
try {
  await mkdir(out, { recursive: true });
  server = await startServer({ port: 0, profileDataDir: dataDir, log: { info() {}, warn() {}, error() {} } });
  browser = await chromium.launch({ executablePath: executable, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'warning') warnings.push(m.text());
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('requestfailed', request => requests.push({ url: request.url(), error: request.failure()?.errorText }));
  await page.goto(`http://127.0.0.1:${server.port}/?debug=1`);
  await page.waitForFunction(() => window.__fe?.screen === 'menu');
  const environment = await page.evaluate(async ({ quality, seed }) => {
    const { buildSpConfig } = await import('/shared/spConfig.js');
    const { presetFleet } = await import('/shared/fleet.js');
    const { FACTION_IDS, SHIP_LIST } = await import('/shared/catalog.js');
    const built = buildSpConfig({
      setup: { level: 9, difficulty: 'normal', teamSize: 6, allyDifficulty: 'normal', resourceMul: 1, botPersonality: 'varied' },
      playerFleet: presetFleet('ter_linha', 1500), playerName: 'Benchmark 6v6', seed,
    });
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const gpu = gl ? { vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) } : null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    const fe = window.__fe;
    fe.state.settings.quality = quality;
    fe.state.settings.reducedEffects = false;
    fe.state.settings.reducedMotion = 'off';
    fe.state.settings.highContrast = false;
    fe.go('battle', { mode: 'sp', config: built.config, meta: built.meta, intro: false, speed: 1 });
    return { seed, quality, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, gpu,
      hardwareConcurrency: navigator.hardwareConcurrency, catalog: { factions: FACTION_IDS.length, classes: SHIP_LIST.length },
      players: built.config.players.map(p => ({ id: p.id, team: p.team, faction: p.fleet.faction, bot: p.isBot, fleetCount: p.fleet.ships.reduce((sum, ship) => sum + ship.count, 0) })),
      campaign: built.config.campaign };
  }, { quality, seed });
  console.log(JSON.stringify({ stage: 'started', environment, chromium: browser.version() }));
  await page.waitForFunction(() => window.__fe?.renderer?.phase === 'engage', null, { timeout: 45000 });
  const initial = await page.evaluate(() => ({ stats: window.__fe.renderer.stats(), mode: window.__fe.feed.controls.mode, world: window.__fe.feed.lastStart.world, viewport: window.__fe.renderer.viewport }));
  console.log(JSON.stringify({ stage: 'combat-started', initial }));
  const result = await page.evaluate(async () => {
    const start = performance.now(), samples = [], frames = [], startTick = window.__fe.renderer.stats().tick;
    let lastFrame = start, lastSample = start - 1000;
    return await new Promise(resolve => {
      function frame(now) {
        if (!window.__fe?.renderer || window.__fe.screen !== 'battle') {
          resolve({ durationMs: now - start, endedBefore30Seconds: true, samples, frames }); return;
        }
        frames.push(now - lastFrame); lastFrame = now;
        if (now - lastSample >= 1000) {
          samples.push({ elapsedMs: now - start, ...window.__fe.renderer.stats() }); lastSample = now;
        }
        if (now - start >= 30000) {
          const sorted = frames.slice().sort((a,b) => a-b);
          const percentile = p => sorted[Math.min(sorted.length-1, Math.floor(sorted.length*p))];
          const finalStats = window.__fe.renderer.stats();
          resolve({ durationMs: now - start, frameCount: frames.length, measuredFps: frames.length * 1000 / (now-start),
            frameMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: sorted.at(-1) },
            startTick, endTick: finalStats.tick, observedTicksPerSecond: (finalStats.tick-startTick)*1000/(now-start),
            shipRange: [Math.min(...samples.map(s=>s.ships)), Math.max(...samples.map(s=>s.ships))],
            drawEmaMs: { mean: samples.reduce((n,s)=>n+s.drawMs,0)/samples.length, min: Math.min(...samples.map(s=>s.drawMs)), max: Math.max(...samples.map(s=>s.drawMs)) },
            extrapolatingSamples: samples.filter(s=>s.extrapolating).length, samples, finalStats, workerMode: window.__fe.feed.controls.mode,
          }); return;
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  });
  // Screenshot is outside the measured interval: capture stalls do not affect FPS.
  await page.screenshot({ path: join(out, 'battle-30s.png') });
  const quota = await readFile('/sys/fs/cgroup/cpu.max', 'utf8').catch(() => 'unknown');
  const report = { date: new Date().toISOString(), chromium: browser.version(), executable, cpuQuota: quota.trim(), environment, initial, result, errors, warnings, requests,
    limitations: 'Single-player real 6v6 (one human-controlled commander and eleven bots), actual shared simulation in Worker, speed1. This does not measure twelve browser clients or network latency. One seeded 30-second interval; no claim of general stability or 60FPS.' };
  await writeFile(join(out, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ stage: 'complete', out, errors, warnings, summary: { ...result, samples: undefined, frames: undefined } }, null, 2));
  if (errors.length || requests.length || result.endedBefore30Seconds) process.exitCode = 1;
} finally {
  try { await cleanup(); } finally { clearTimeout(watchdog); }
}
