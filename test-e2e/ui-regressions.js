// Real-browser regressions for input routing and persistent HUD/chat nodes.
// CHROMIUM_PATH=/usr/bin/chromium node test-e2e/ui-regressions.js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'fe-ui-regressions-'));
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: '0', FE_MAX_TICKS: '600', FE_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'],
});
const watchdog = setTimeout(() => { server.kill(); process.exit(1); }, 90_000);
let browser;
try {
  const port = await new Promise((resolve, reject) => {
    let out = '';
    server.stdout.on('data', chunk => { out += chunk; const m = out.match(/listening (\d+)/); if (m) resolve(m[1]); });
    server.once('exit', code => reject(new Error(`server exited: ${code}`)));
  });
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const base = `http://127.0.0.1:${port}`;
  let failed = 0;
  for (const [name, run] of [
    ['portrait camera shows the initial fleets without waiting for engagement', async page => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${base}/?autotest=1&debug=1&seed=ui-phone&speed=1`);
      await page.locator('[data-test="speed-0"]').click();
      await page.waitForFunction(() => window.__fe.renderer?.getView()?.ships.size > 0);
      const visible = await page.evaluate(() => {
        const r = window.__fe.renderer, ships = [...r.getView().ships.values()];
        return { total: ships.length, visible: ships.filter(s => r.camera.raw.isVisible(s.x, s.y, (s.size || 30) / 2)).length };
      });
      assert.ok(visible.total > 0);
      assert.equal(visible.visible, visible.total);
    }],
    ['battle canvas receives pointer, wheel and selection', async page => {
      await page.goto(`${base}/?autotest=1&debug=1&seed=ui-input&speed=1`);
      await page.locator('[data-test="speed-0"]').click();
      await page.waitForFunction(() => window.__fe.renderer?.getView()?.ships.size > 0);
      assert.equal(await page.evaluate(() => document.elementFromPoint(640, 400)?.id), 'arena');
      const zoom = await page.evaluate(() => window.__fe.renderer.camera.zoom);
      await page.mouse.move(640, 400);
      await page.mouse.wheel(0, -250);
      await page.waitForFunction(z => window.__fe.renderer.camera.zoom > z + 0.02, zoom);
      const target = await page.evaluate(() => {
        const r = window.__fe.renderer, c = r.camera.raw;
        const s = [...r.getView().ships.values()].find(v => {
          const x = c.worldToScreenX(v.x), y = c.worldToScreenY(v.y);
          return x > 60 && x < 1000 && y > 180 && y < 640;
        });
        return s && { id: s.id, x: c.worldToScreenX(s.x), y: c.worldToScreenY(s.y) };
      });
      assert.ok(target, 'visible ship to select');
      await page.mouse.click(target.x, target.y);
      await page.waitForFunction(id => window.__fe.renderer.camera.followId === id, target.id);
      await page.locator('[data-test="hud-grid"]').click();
      assert.equal(await page.evaluate(() => window.__fe.state.settings.grid), true);
    }],
    ['Enter on remove only removes one ship', async page => {
      await page.goto(`${base}/?debug=1`);
      await page.evaluate(() => window.__fe.go('fleetBuilder', { mode: 'sp', budget: 4000 }));
      const add = page.locator('[data-test^="ship-add-"]').first();
      const cls = (await add.getAttribute('data-test')).slice('ship-add-'.length);
      await add.click(); await add.click();
      await page.locator(`[data-test="ship-remove-${cls}"]`).press('Enter');
      assert.equal(await page.locator(`[data-test="ship-qty-${cls}"]`).innerText(), '1');
    }],
    ['room updates preserve chat node, draft, focus and selection', async page => {
      await page.goto(`${base}/?debug=1`);
      await page.locator('[data-test="name"]').fill('UI Test');
      await page.locator('[data-test="name"]').press('Tab');
      await page.locator('[data-test="menu-multi"]').click();
      await page.locator('[data-test="create-room"]').click();
      await page.locator('[data-test="chat-input"]').fill('Plano pela esquerda');
      await page.evaluate(() => {
        window.chatBefore = document.querySelector('[data-test="chat-input"]');
        window.chatBefore.setSelectionRange(6, 10);
      });
      await page.evaluate(() => window.__fe.state.net.setRoom({ teamSize: 2 }));
      assert.deepEqual(await page.evaluate(() => {
        const input = document.querySelector('[data-test="chat-input"]');
        return { same: input === window.chatBefore, text: input.value, focus: document.activeElement === input, range: [input.selectionStart, input.selectionEnd] };
      }), { same: true, text: 'Plano pela esquerda', focus: true, range: [6, 10] });
    }],
    ['unchanged HUD updates retain size and log nodes', async page => {
      await page.goto(`${base}/?autotest=1&debug=1&seed=ui-hud&speed=1`);
      await page.locator('[data-test="speed-0"]').click();
      await page.waitForFunction(() => document.querySelector('.ht-sizes > span'));
      await page.evaluate(() => {
        window.sizeBefore = document.querySelector('.ht-sizes > span');
        window.logBefore = document.querySelector('.hud-log > div');
      });
      await page.waitForTimeout(450);
      assert.equal(await page.evaluate(() => window.sizeBefore === document.querySelector('.ht-sizes > span')), true);
      assert.equal(await page.evaluate(() => !window.logBefore || window.logBefore === document.querySelector('.hud-log > div')), true);
      const fixture = await page.evaluate(async () => {
        const { createHud } = await import('/battle/hud.js');
        const root = document.createElement('div');
        const hud = createHud(root, { start: window.__fe.feed.lastStart, myTeam: 0, myPlayerId: 'p1', isLocal: true, settings: { speed: 1 } });
        const now = performance.now(), view = window.__fe.renderer.getView();
        hud.onFrame({ k: 1, e: [['phase', 'engage']], at: now });
        const entry = root.querySelector('.hud-log > div');
        hud.update(now + 100, view); hud.update(now + 200, view);
        const retained = !!entry && entry === root.querySelector('.hud-log > div');
        hud.update(now + 5500, view);
        const faded = entry === root.querySelector('.hud-log > div') && entry.classList.contains('fade');
        hud.setPaused(true); hud.setPaused(true);
        const paused = root.querySelector('.hud-banner').classList.contains('paused');
        hud.update(now + 7200, view);
        const expired = root.querySelector('.hud-log > div') === null;
        hud.dispose();
        return { retained, faded, expired, paused };
      });
      assert.deepEqual(fixture, { retained: true, faded: true, expired: true, paused: true });
    }],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try { await run(page); assert.deepEqual(errors, []); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
    finally { await page.close(); }
  }
  if (failed) process.exitCode = 1;
} finally {
  await browser?.close(); server.kill(); clearTimeout(watchdog);
  rmSync(dataDir, { recursive: true, force: true });
}
