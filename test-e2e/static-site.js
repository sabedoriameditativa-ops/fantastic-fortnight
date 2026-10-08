#!/usr/bin/env node
// Test the built static artifact, never the application server or source tree.
// npm run build:web && CHROMIUM_PATH=/usr/bin/chromium npm run e2e:static
// An optional first argument selects another artifact directory.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = await realpath(resolve(ROOT, process.argv[2] || 'dist/web')).catch(() => {
  throw new Error('Static artifact missing. Run npm run build:web first.');
});
assert.ok(existsSync(resolve(ARTIFACT, 'index.html')), 'artifact index.html exists');
const PREFIX = '/fantastic-fortnight/';
const SEED = 'static-site-campaign-1';
const NAME = 'Órbita Azul';
const FLEET_NAME = 'Guarda Estática';
const t = name => `[data-test="${name}"]`;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain' };

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
async function loadPlaywright() {
  const errors = [];
  for (const spec of ['playwright', '/opt/node-tools/node_modules/playwright/index.mjs']) {
    try { return await import(spec); } catch (error) { errors.push(`${spec}: ${error.code || error.message}`); }
  }
  throw new Error(`Cannot import Playwright: ${errors.join('; ')}`);
}

// No API, WebSocket, source-tree fallback, root mount or SPA rewrite exists here.
const requests = [], upgrades = [];
const server = createServer(async (req, res) => {
  const record = { method: req.method, path: req.url, status: 0 };
  requests.push(record);
  const finish = (status, body = '') => { record.status = status; res.writeHead(status); res.end(body); };
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://static.test').pathname);
    if (!['GET', 'HEAD'].includes(req.method)) return finish(405);
    if (!pathname.startsWith(PREFIX)) return finish(404);
    const target = resolve(ARTIFACT, pathname.slice(PREFIX.length) || 'index.html');
    if (!target.startsWith(`${ARTIFACT}${sep}`)) return finish(404);
    const physical = await realpath(target);
    if (!physical.startsWith(`${ARTIFACT}${sep}`) || !(await stat(physical)).isFile()) return finish(404);
    record.status = 200;
    res.writeHead(200, { 'Content-Type': mime[extname(physical)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    createReadStream(physical).on('error', error => res.destroy(error)).pipe(res);
  } catch (error) { finish(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 400); }
});
server.on('upgrade', (req, socket) => { upgrades.push(req.url); socket.destroy(); });

let browser, context;
const browserRequests = [], errors = [], failedRequests = [], sockets = [], workers = [];
function observePage(page) {
  page.setDefaultTimeout(12_000);
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('worker', worker => workers.push(worker.url()));
}

function assertNetwork(origin) {
  assert.deepEqual(sockets, [], 'no browser WebSocket attempts');
  assert.deepEqual(upgrades, [], 'no WebSocket upgrades');
  assert.deepEqual(failedRequests, [], 'all browser requests complete');
  assert.deepEqual(errors, [], 'no JavaScript or console errors');
  for (const request of browserRequests) {
    const url = new URL(request.url);
    assert.equal(url.origin, origin, `no external dependency: ${request.url}`);
    assert.ok(url.pathname.startsWith(PREFIX), `resource stays under the deployment prefix: ${request.url}`);
    assert.equal(request.method, 'GET', `no API mutation: ${request.url}`);
    assert.doesNotMatch(url.pathname, /\/(?:api|health)(?:\/|$)/, `no server endpoint: ${request.url}`);
  }
  assert.deepEqual(requests.filter(request => request.status !== 200), [], 'all requested artifact files return HTTP 200');
}

async function assertClientErrors(page) {
  assert.deepEqual(await page.evaluate(() => window.__fe.errors), [], 'app error collection is empty');
}

const watchdog = setTimeout(() => {
  console.error('FAIL static-site tests exceeded 150 seconds');
  process.exitCode = 1;
  void browser?.close();
  server.closeAllConnections();
  server.close();
}, 150_000);

try {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = `${origin}${PREFIX}`;
  // Prove a missing prefix cannot accidentally be served by a development server.
  for (const path of ['/', '/shared/catalog.js', `${PREFIX}api/profile`]) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, `unserved endpoint ${path}`);
  }
  requests.length = 0;

  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR' });
  context.on('request', request => browserRequests.push({ url: request.url(), method: request.method() }));
  context.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  const page = await context.newPage();
  observePage(page);
  await page.goto(`${base}?debug=1&seed=${SEED}`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('html').getAttribute('data-deployment'), 'static');
  assert.equal(await page.locator(t('menu-multi')).isDisabled(), true);
  assert.match(await page.locator(t('menu-multi')).innerText(), /exige servidor/i);
  assert.match(await page.locator(t('static-mode-notice')).innerText(), /navegador/i);
  assert.match(await page.locator(t('menu-profile')).innerText(), /^progresso local$/i);
  const legalLinks = await page.locator('.menu-foot a').evaluateAll(async links => Promise.all(links.map(async link => {
    const response = await fetch(link.href);
    await response.arrayBuffer(); // Finish the transfer before later navigation.
    return { href: link.href, status: response.status };
  })));
  assert.deepEqual(legalLinks, ['LICENSE.txt', 'THIRD_PARTY_NOTICES.md'].map(path => ({ href: `${base}${path}`, status: 200 })));
  await page.locator(t('menu-howto')).click();
  const instructions = await page.locator('.howto-steps').innerText();
  assert.match(instructions, /salas online e chat exigem a versão com servidor/i);
  assert.doesNotMatch(instructions, /crie uma sala|envie o código/i, 'static instructions do not promise hosted rooms');
  await page.locator(t('back')).click();
  await page.locator(t('name')).fill(NAME);
  await page.locator(t('name')).press('Tab');
  await page.locator(t('menu-profile')).click();
  assert.match(await page.locator(t('local-progress')).innerText(), /não são sincronizados/i);
  await page.locator(t('back')).click();
  await page.locator(t('menu-options')).click();
  await page.locator(t('opt-effects')).check();
  await page.locator(t('opt-contrast')).check();
  await page.locator(t('q-low')).click();
  await page.locator(t('chatter-frequency')).selectOption('rare');
  await page.locator(t('bind-fire')).click();
  await page.keyboard.press('h');
  await page.locator(t('back')).click();

  await page.locator(t('menu-single')).click();
  await page.locator(t('difficulty-facil')).click();
  await page.locator(t('enemy-resources')).selectOption('0.5');
  await page.locator(t('level-1')).click();
  await page.locator(t('sp-build')).click();
  await page.locator(t('faction-terran')).click();
  await page.locator(t('preset-ter_linha')).click();
  await page.locator(t('plan-formation')).selectOption('wedge');
  await page.locator(t('plan-position')).selectOption('rear');
  await page.locator(t('plan-priority')).selectOption('support');
  await page.locator(`${t('fleet-library')} summary`).click();
  await page.locator(t('fleet-library-name')).fill(FLEET_NAME);
  await page.locator(t('library-save')).click();
  assert.equal(await page.locator('.library-row').count(), 1);
  assert.match(await page.locator('.library-row').innerText(), /Guarda Estática/);
  await page.locator(t('fleet-confirm')).click();
  await page.waitForFunction(() => window.__fe.feed?.controls.mode === 'worker' && window.__fe.feed.lastStart);
  const actualInput = await page.evaluate(() => {
    // Observe the actual feed; do not inject results, modify storage or bypass UI.
    window.__staticResult = null;
    window.__fe.feed.onEnd(result => { window.__staticResult = { result, mode: window.__fe.feed.controls.mode }; });
    return { setup: window.__fe.state.spSetup, playerFleet: window.__fe.state.lastFleet, playerName: window.__fe.state.playerName, seed: window.__fe.feed.lastStart.seed };
  });
  assert.equal(actualInput.seed, SEED);
  const [{ buildSpConfig }, { createBattle, stepBattle, getResult }] = await Promise.all([
    import(pathToFileURL(resolve(ARTIFACT, 'shared/spConfig.js')).href),
    import(pathToFileURL(resolve(ARTIFACT, 'shared/sim/battle.js')).href),
  ]);
  const expectedBattle = createBattle(buildSpConfig(actualInput).config);
  while (!expectedBattle.ended && expectedBattle.tick < 20_000) stepBattle(expectedBattle);
  assert.ok(expectedBattle.ended, 'deterministic fixture finishes');
  const expectedResult = getResult(expectedBattle);
  assert.equal(expectedResult.winner, 0, 'the real campaign fixture wins without modifying simulation rules');
  await page.locator(t('battle-begin')).click();
  await page.locator(t('speed-4')).click();
  await page.waitForSelector(t('result-winner'), { timeout: 90_000 });
  const observed = await page.evaluate(() => window.__staticResult);
  assert.equal(observed.mode, 'worker', 'the Worker completed the simulation without fallback');
  assert.deepEqual(observed.result, expectedResult, 'browser result equals deterministic simulation of the artifact');
  assert.equal(await page.locator(t('result-winner')).getAttribute('data-winner'), '0');
  assert.equal(await page.locator(t('level-cleared')).isVisible(), true);
  assert.match(await page.locator(t('result-reward')).innerText(), /local.*sem pontos verificados/i);
  assert.match(await page.locator(t('battle-report')).innerText(), /dano efetivo/i);
  assert.ok(workers.includes(`${base}battle/simWorker.js`), 'real module Worker was created under the prefix');
  await assertClientErrors(page);
  console.log('PASS static menu, fleet library and real Worker campaign result match deterministic simulation');

  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator(t('name')).inputValue(), NAME);
  const persisted = await page.evaluate(() => ({ settings: window.__fe.state.settings, progress: window.__fe.state.progress, fleet: window.__fe.state.lastFleet, setup: window.__fe.state.spSetup }));
  assert.deepEqual([persisted.settings.reducedEffects, persisted.settings.highContrast, persisted.settings.quality, persisted.settings.chatter.frequency, persisted.settings.pilotBindings.fire, persisted.settings.speed], [true, true, 'low', 'rare', 'KeyH', 4]);
  assert.deepEqual(persisted.fleet, actualInput.playerFleet);
  assert.deepEqual(persisted.setup, actualInput.setup);
  assert.deepEqual(persisted.progress.facil, { max: 1, cleared: [1] });
  await page.locator(t('menu-profile')).click();
  const progressRow = page.locator(`${t('local-progress-table')} tbody tr`).filter({ hasText: 'Fácil' });
  assert.deepEqual(await progressRow.locator('td').allTextContents(), ['Fácil', '1', '1']);
  await page.locator(t('local-fleets')).click();
  await page.locator(`${t('fleet-library')} summary`).click();
  assert.equal(await page.locator('.library-row').count(), 1);
  assert.match(await page.locator('.library-row').innerText(), /Guarda Estática/);
  await page.locator(t('plan-formation')).selectOption('line');
  await page.locator('[data-test^="library-load-"]').click();
  assert.deepEqual(await Promise.all(['formation', 'position', 'priority'].map(key => page.locator(t(`plan-${key}`)).inputValue())), ['wedge', 'rear', 'support']);
  await assertClientErrors(page);
  console.log('PASS name, preferences, saved fleet and genuinely cleared campaign persist after reload');

  // A seeded run alone would miss regressions in the normal server-preparation path.
  // Obsolete multiplayer URL parameters must also remain inert on a static host.
  await page.goto(`${base}?debug=1&sala=ABCDE&ws=${encodeURIComponent(`ws://127.0.0.1:${server.address().port}/forbidden`)}`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator(t('menu-single')).isVisible(), true);
  assert.equal(await page.evaluate(() => window.__fe.params.seed), null);
  await page.locator(t('menu-single')).click();
  assert.match(await page.locator(t('level-1')).getAttribute('class'), /cleared/);
  await page.locator(t('sp-quick')).click();
  await page.waitForFunction(() => window.__fe.feed?.controls.mode === 'worker' && window.__fe.feed.lastStart);
  await page.locator(t('battle-begin')).click();
  await page.waitForFunction(() => window.__fe.renderer?.getView()?.ships.size > 0);
  assert.equal(await page.evaluate(() => window.__fe.state.net), null);
  await page.locator(t('hud-quit')).click();
  await page.locator(t('quit-ok')).click();
  await page.waitForSelector(t('menu-single'));
  await assertClientErrors(page);
  console.log('PASS ordinary unseeded quick play uses the Worker without profile API or WebSocket');

  await page.setViewportSize({ width: 390, height: 844 });
  for (const selector of ['menu-single', 'menu-profile', 'menu-options', 'name']) {
    const element = page.locator(t(selector));
    await element.scrollIntoViewIfNeeded();
    const bounds = await element.boundingBox();
    assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= 391, `mobile control fits horizontally: ${selector}`);
    assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= 845, `mobile control can scroll into view: ${selector}`);
  }
  assert.equal(await page.evaluate(() => document.querySelector('#app').scrollWidth <= innerWidth + 1), true, 'mobile menu has no horizontal overflow');
  await page.locator(t('menu-profile')).click();
  assert.equal(await page.locator(t('local-progress')).isVisible(), true);
  await page.locator(t('back')).click();
  await assertClientErrors(page);
  assertNetwork(origin);
  for (const asset of ['app.js', 'styles.css', 'fonts/orbitron-latin.woff2', 'fonts/exo2-latin.woff2', 'battle/simWorker.js', 'shared/sim/battle.js']) {
    assert.ok(requests.some(request => request.path.split('?')[0] === `${PREFIX}${asset}` && request.status === 200), `artifact resource served: ${asset}`);
  }
  console.log('PASS 390px mobile menu, local assets and prefix-safe imports; zero API, WebSocket or JavaScript errors');
  console.log(`Static artifact: ${ARTIFACT}; ${requests.length} HTTP requests, ${workers.length} real Workers; 4 checks passed.`);
} catch (error) {
  process.exitCode = 1;
  console.error(`FAIL static-site: ${error.stack}`);
  console.error('Browser errors:', errors);
  console.error('Failed requests:', failedRequests);
  console.error('HTTP errors:', requests.filter(request => request.status !== 200));
  console.error('WebSocket attempts:', sockets, upgrades);
} finally {
  clearTimeout(watchdog);
  await context?.close();
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolveClose => server.close(resolveClose));
}
