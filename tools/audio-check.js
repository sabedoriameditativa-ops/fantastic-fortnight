#!/usr/bin/env node
// Audio smoke check in a real (headless) Chromium: starts the game server,
// opens the app, performs the first gesture, asserts the AudioContext is
// running, runs an ?autotest=1 single-player battle at speed 4 and asserts
// there were no page errors. Prints audio.stats() at the end.
//
//   node tools/audio-check.js [--port 3177] [--timeout 180000] [--seed 42]
//   node tools/audio-check.js --render     # offline render: every recipe × faction and each theme;
//                                          # asserts peak ≤ 1.0, not silent, silent tail (no leaks)
//
// Chromium lives under /opt/pw-browsers; Playwright is imported from the
// global install with a fallback to a local dependency. Never runs
// `playwright install`.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const PORT = Number(opt('port', 3177));
const TIMEOUT = Number(opt('timeout', 180000));
const SEED = opt('seed', '42');

process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';

async function loadPlaywright() {
  try { return await import('/opt/node-tools/node_modules/playwright/index.mjs'); } catch { return import('playwright'); }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (d) => { out += String(d); if (/listening/i.test(out)) resolve(child); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`server exited early (${code}): ${out}`)));
    setTimeout(() => reject(new Error('server did not start: ' + out)), 15000).unref();
  });
}

const fail = (msg) => { console.error('FAIL: ' + msg); process.exitCode = 1; };

/** Runs inside the page: offline-render recipes and themes, return level metrics. */
async function renderInPage() {
  const { createAudioEngine } = await import('/audio/index.js');
  const { SFX_NAMES, UI_NAMES } = await import('/audio/recipes.js');
  const SR = 44100;
  const metrics = (buf) => {
    let peak = 0, sum = 0, tail = 0, n = 0, tn = 0;
    const tailFrom = Math.floor(buf.length * 0.9);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; n++; if (i >= tailFrom) { tail += d[i] * d[i]; tn++; } }
    }
    return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / n).toFixed(4), tail: +Math.sqrt(tail / tn).toFixed(5) };
  };
  async function render(dur, fn, ticks = false) {
    const ctx = new OfflineAudioContext(2, Math.ceil(SR * dur), SR);
    const eng = createAudioEngine({ createContext: () => ctx, storage: null, document: null, setInterval: () => 1, clearInterval: () => {}, seed: 7 });
    await eng.init();
    for (const b of ['master', 'sfx', 'ui', 'music']) eng.setVolume(b, 1);
    if (ticks) for (let t = 0.025; t < dur - 0.03; t += 0.025) ctx.suspend(t).then(() => { eng.tick(); ctx.resume(); });
    fn(eng, ctx);
    return metrics(await ctx.startRendering());
  }
  const out = { sfx: {}, ui: {}, music: {} };
  for (const name of SFX_NAMES) {
    for (const faction of ['terran', 'vorrax', 'lumen', 'ferrix']) {
      out.sfx[`${name}/${faction}`] = await render(5.5, (eng) => { eng.setCamera(0, 0, 1000, 1.78); eng.play(name, { x: 0.1, y: 0.1, size: name === 'death' ? 4 : 2, faction, seed: 11, count: 3, dur: 1, delay: 0.15 }); });
    }
  }
  for (const name of UI_NAMES) out.ui[name] = await render(3, (eng) => eng.play(name, { delay: 0.15 }));
  for (const scene of ['menu', 'builder', 'battle', 'victory', 'defeat']) {
    out.music[scene] = await render(9, (eng) => { eng.setScene(scene); if (scene === 'battle') eng.setBattleState({ aliveFrac: [0.3, 0.3], destroyedFrac: 0.8, elapsedSec: 200 }); }, true);
  }
  // music fade-out: 4 s of menu then 'none' → the tail must go quiet
  out.music.fadeOut = await render(12, (eng, ctx) => { eng.setScene('menu'); ctx.suspend(4.012).then(() => { eng.setScene('none'); ctx.resume(); }); }, true);
  return out;
}

async function renderMode() {
  const server = await startServer();
  let browser = null;
  try {
    const { chromium } = await loadPlaywright();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    await page.goto(`http://127.0.0.1:${PORT}/?debug=1`, { waitUntil: 'load' });
    const res = await page.evaluate(renderInPage);
    let bad = 0;
    const check = (label, m, { minRms = 0.002, maxTail = 0.01 } = {}) => {
      const problems = [];
      if (m.peak > 1.0) problems.push('clips');
      if (m.rms < minRms) problems.push('silent');
      if (m.tail > maxTail) problems.push('tail not silent');
      if (problems.length) { bad++; console.log(`  ${label.padEnd(32)} peak ${m.peak} rms ${m.rms} tail ${m.tail}  <- ${problems.join(', ')}`); }
      return problems.length === 0;
    };
    console.log('SFX (per recipe × faction):');
    let peakMax = 0;
    for (const [k, m] of Object.entries(res.sfx)) { peakMax = Math.max(peakMax, m.peak); check(k, m); }
    console.log(`  ${Object.keys(res.sfx).length} renders, max peak ${peakMax.toFixed(3)}`);
    console.log('UI:');
    for (const [k, m] of Object.entries(res.ui)) check(k, m, { minRms: 0.001 });
    console.log('Music (9 s per theme):');
    for (const [k, m] of Object.entries(res.music)) {
      console.log(`  ${k.padEnd(10)} peak ${m.peak} rms ${m.rms} tail ${m.tail}`);
      if (k === 'fadeOut') check(k, m, { maxTail: 0.002 }); else if (m.peak > 1.0 || m.rms < 0.01) { bad++; console.log('   <- bad level'); }
    }
    if (errors.length) { bad++; for (const e of errors) console.error('  pageerror: ' + e); }
    if (bad) fail(`${bad} render problem(s)`); else console.log('OK: every recipe and theme renders within level bounds, no leaks.');
  } catch (e) {
    fail(e && e.stack || String(e));
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
  }
}

async function main() {
  const server = await startServer();
  let browser = null;
  try {
    const { chromium } = await loadPlaywright();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
    // network resource failures (e.g. the Google Fonts stylesheet without internet) are not app errors
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });

    const url = `http://127.0.0.1:${PORT}/?autotest=1&speed=4&debug=1&seed=${encodeURIComponent(SEED)}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__fe && !!window.__fe.audio, null, { timeout: 15000 });
    const beforeGesture = await page.evaluate(() => ({ ready: window.__fe.audio.isReady(), state: window.__fe.audio.ctx ? window.__fe.audio.ctx.state : 'none' }));
    console.log('before gesture:', beforeGesture);
    if (beforeGesture.ready) fail('audio initialised before any gesture');

    await page.mouse.click(640, 360);          // first gesture → audio.init() inside the handler
    await page.waitForFunction(() => window.__fe.audio.isReady() && window.__fe.audio.ctx && window.__fe.audio.ctx.state === 'running', null, { timeout: 10000 })
      .catch(() => fail('AudioContext not running after the first click'));
    const after = await page.evaluate(() => ({ state: window.__fe.audio.ctx.state, sampleRate: window.__fe.audio.ctx.sampleRate, scene: window.__fe.audio.getScene(), stub: window.__fe.audio.isStub }));
    console.log('after gesture:', after);
    if (after.stub) fail('audio stub still in use');

    // UI sounds + settings round-trip
    await page.evaluate(() => { const a = window.__fe.audio; a.play('ui.click'); a.play('ui.confirm'); a.play('ui.error'); a.setVolume('sfx', 0.75); });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('frotaEstelar.audio.v1') || 'null'));
    if (!saved || saved.sfx !== 0.75) fail('settings not persisted: ' + JSON.stringify(saved));

    // battle runs; sample stats while it plays
    const t0 = Date.now();
    let peakVoices = 0;
    let done = false;
    while (Date.now() - t0 < TIMEOUT) {
      const s = await page.evaluate(() => ({ screen: window.__fe.screen, ended: !!document.querySelector('[data-test="battle-end"]'), stats: window.__fe.audio.stats() }));
      peakVoices = Math.max(peakVoices, s.stats.maxVoices || 0);
      if (s.screen === 'results' || (s.ended && s.screen !== 'battle')) { done = true; break; }
      if (s.screen === 'results') { done = true; break; }
      await page.waitForTimeout(1000);
    }
    if (!done) fail('battle did not reach the results screen within the timeout');
    const stats = await page.evaluate(() => window.__fe.audio.stats());
    console.log('audio.stats():', JSON.stringify(stats, null, 2));
    console.log('peak voices:', peakVoices, 'elapsed s:', Math.round((Date.now() - t0) / 1000));
    if (peakVoices > 24) fail(`voice cap exceeded (${peakVoices})`);
    if (stats.created < 10) fail('suspiciously few sounds were created');
    if (!/victory|defeat|menu/.test(stats.music ? stats.music.scene : '')) fail('music did not reach an ending scene: ' + JSON.stringify(stats.music));
    if (stats.ctxState !== 'running') fail('context not running at the end: ' + stats.ctxState);
    const feErrors = await page.evaluate(() => window.__fe.errors.slice());
    const all = errors.concat(feErrors.map((e) => 'app: ' + e));
    if (all.length) { fail(`${all.length} page error(s)`); for (const e of all) console.error('  ' + e.split('\n')[0]); }
    if (!process.exitCode) console.log('OK: audio context running, battle completed, no page errors.');
  } catch (e) {
    fail(e && e.stack || String(e));
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
  }
}

if (args.includes('--render')) renderMode(); else main();
