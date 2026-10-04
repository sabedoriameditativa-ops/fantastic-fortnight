// No-network test: the game loads everything (scripts, styles, fonts) from its own folder, with no request to any
// other host, both opened as a file and served over HTTP (as a portal serves it). The fonts really load and the
// canvas draws with them.
// Usage: node tests/network.mjs
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { ROOT, loadPlaywright, launchChromium, blockNetwork, watchErrors, assert, sleep, createReport, fontReport, checkFonts } from './helpers.mjs';

const ROOT_URL = pathToFileURL(ROOT).href + '/';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const SERVED = /^\/(index\.html|style\.css|game\.js|fonts\/[\w.-]+)$/; // only the game's own files

const rep = createReport('No network');
const pw = await loadPlaywright();
const browser = await launchChromium(pw);
const errors = [];
const blocked = [];

// Opens url in a fresh guarded context and records every request and failure; plays for a moment.
async function visit(url, allowOrigins = []) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' });
  await blockNetwork(context, { allowOrigins, blocked });
  const requests = [];
  const failures = [];
  context.on('request', r => requests.push(r.url()));
  context.on('requestfailed', r => failures.push(r.url() + ' ' + ((r.failure() && r.failure().errorText) || '')));
  context.on('response', r => { if (r.status() >= 400) failures.push(r.url() + ' HTTP ' + r.status()); });
  const page = await context.newPage();
  watchErrors(page, url.startsWith('file:') ? 'file' : 'http', errors);
  await page.goto(url);
  await page.waitForFunction(() => window.QF && !document.getElementById('app').hasAttribute('data-i18n-pending'), null, { timeout: 8000 });
  const fonts = await fontReport(page);
  await page.click('#btn-start'); // the canvas draws its text (night banner, damage numbers) during play
  await page.keyboard.down('ArrowRight');
  await sleep(1500);
  await page.keyboard.up('ArrowRight');
  const state = await page.evaluate(() => window.QF.getState());
  await context.close();
  return { requests, failures, fonts, state };
}

try {
  let asFile = null;
  await rep.step('1. Opened as a file: only file: requests inside the game folder, none failed', async () => {
    const v = asFile = await visit(ROOT_URL + 'index.html');
    const outside = v.requests.filter(u => !u.startsWith(ROOT_URL));
    assert(!outside.length, 'requests outside the game folder: ' + outside.slice(0, 3).join(' | '));
    assert(!v.failures.length, 'failed: ' + v.failures.slice(0, 3).join(' | '));
    const woff = v.requests.filter(u => u.endsWith('.woff2')).map(u => u.slice(ROOT_URL.length));
    assert(woff.length >= 3 && woff.every(f => f.startsWith('fonts/')), 'font files requested: ' + woff.join(', '));
    assert(v.state.screen === 'playing' || v.state.screen === 'levelup', 'screen ' + v.state.screen);
    return `${v.requests.length} requests: ${v.requests.map(u => u.slice(ROOT_URL.length)).join(', ')}`;
  });

  await rep.step('2. Fonts load from fonts/ and the canvas draws with them (file)', async () => {
    assert(asFile, 'step 1 did not load the page');
    return checkFonts(asFile.fonts);
  });

  await rep.step('3. Served over HTTP: only same-origin requests, all found, fonts loaded', async () => {
    const server = http.createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = path.join(ROOT, p);
      if (!SERVED.test(p) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      const v = await visit(origin + '/index.html', [origin]);
      const foreign = v.requests.filter(u => !u.startsWith(origin + '/'));
      assert(!foreign.length, 'cross-origin requests: ' + foreign.slice(0, 3).join(' | '));
      assert(!v.failures.length, 'failed: ' + v.failures.slice(0, 3).join(' | '));
      checkFonts(v.fonts);
      assert(v.state.screen === 'playing' || v.state.screen === 'levelup', 'screen ' + v.state.screen);
      return `${v.requests.length} same-origin requests, fonts loaded`;
    } finally {
      server.close();
    }
  });

  await rep.step('4. No console errors, page errors or blocked requests', async () => {
    assert(!errors.length, errors.length + ' error(s): ' + errors.slice(0, 3).join(' | '));
    assert(!blocked.length, 'blocked requests: ' + blocked.slice(0, 3).join(' | '));
  });
} catch (err) {
  rep.record('Unexpected harness failure', false, String((err && err.message) || err).split('\n')[0]);
} finally {
  await browser.close();
}
for (const e of errors) console.log('  ' + e);
rep.finish();
