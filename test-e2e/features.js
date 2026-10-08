// Integrated UI smoke: library, doctrine, tutorial, pilot, accessibility,
// campaign and server-verified progression. No real profile database is used.
// CHROMIUM_PATH=/usr/bin/chromium node test-e2e/features.js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const dataDir = mkdtempSync(join(tmpdir(), 'fe-features-'));
const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '0', FE_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
let browser, stderr = '';
server.stderr.on('data', c => { stderr = (stderr + c).slice(-8000); });
const watchdog = setTimeout(() => { console.error('Feature tests timed out', stderr); server.kill(); process.exit(1); }, 180_000);
const t = name => `[data-test="${name}"]`;
try {
  const port = await new Promise((resolve, reject) => {
    let out = '';
    server.stdout.on('data', c => { out += c; const m = out.match(/listening (\d+)/); if (m) resolve(m[1]); });
    server.once('exit', code => reject(new Error(`server exited ${code}: ${stderr}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const tests = [
    ['fleet library saves, renames, duplicates, compares and restores doctrine', async page => {
      await page.goto(`${base}/?debug=1`);
      await page.evaluate(() => window.__fe.go('fleetBuilder', { mode: 'sp' }));
      await page.locator(`${t('presets')} button`).first().click();
      await page.locator(t('plan-formation')).selectOption('wedge');
      await page.locator(t('plan-position')).selectOption('rear');
      await page.locator(t('plan-priority')).selectOption('support');
      await page.locator(`${t('fleet-library')} summary`).click();
      await page.locator(t('fleet-library-name')).fill('Guarda Azul');
      await page.locator(t('library-save')).click();
      assert.equal(await page.locator('.library-row').count(), 1);
      await page.locator('[data-test^="library-duplicate-"]').first().click();
      assert.equal(await page.locator('.library-row').count(), 2);
      assert.match(await page.locator(t('fleet-compare')).innerText(), /Guarda Azul/i);
      await page.locator(t('fleet-library-name')).fill('Guarda Reserva');
      await page.locator('.library-row').nth(1).getByRole('button', { name: 'Renomear', exact: true }).click();
      assert.match(await page.locator('.library-row').nth(1).innerText(), /Guarda Reserva/);
      await page.locator(t('plan-formation')).selectOption('line');
      await page.locator(t('clear')).click();
      await page.locator('[data-test^="library-load-"]').first().click();
      assert.equal(await page.locator(t('plan-formation')).inputValue(), 'wedge');
      assert.equal(await page.locator(t('plan-position')).inputValue(), 'rear');
      assert.equal(await page.locator(t('plan-priority')).inputValue(), 'support');
      assert.equal(await page.locator(t('fleet-confirm')).isEnabled(), true);
      await page.reload();
      await page.evaluate(() => window.__fe.go('fleetBuilder', { mode: 'sp' }));
      await page.locator(`${t('fleet-library')} summary`).click();
      assert.equal(await page.locator('.library-row').count(), 2);
    }],
    ['tutorial requires a fleet and advances through three practical steps', async page => {
      await page.goto(`${base}/?debug=1`);
      await page.locator(t('menu-howto')).click();
      await page.locator(t('start-tutorial')).click();
      assert.equal(await page.locator(t('tutorial-next')).isEnabled(), false);
      await page.locator(`${t('presets')} button`).first().click();
      await page.locator(t('tutorial-next')).click();
      assert.match(await page.locator(t('tutorial-panel')).innerText(), /2 de 3/);
      await page.locator(t('plan-formation')).selectOption('screen');
      await page.locator(t('tutorial-next')).click();
      assert.match(await page.locator(t('tutorial-panel')).innerText(), /3 de 3/);
    }],
    ['options persist remapping, radio and accessible graphics', async page => {
      await page.goto(`${base}/?debug=1`);
      await page.locator(t('menu-options')).click();
      await page.locator(t('bind-fire')).click();
      await page.keyboard.press('h');
      assert.equal(await page.locator(t('bind-fire')).innerText(), 'H');
      await page.locator(t('opt-effects')).check();
      await page.locator(t('opt-contrast')).check();
      await page.locator(t('rm-on')).click();
      await page.locator(t('chatter-frequency')).selectOption('rare');
      await page.locator(t('chatter-subtitles')).uncheck();
      await page.locator(t('music-theme')).selectOption('arcade');
      await page.locator(t('sound-profile')).selectOption('tactical');
      await page.locator(t('chatter-language')).selectOption('en-US');
      await page.locator(t('chatter-preview-faction')).selectOption('ferrix');
      await page.locator(t('chatter-test')).click();
      assert.match(await page.locator(t('chatter-preview-text')).innerText(), /Fleet synchronized|Scrap probability/);
      assert.deepEqual(await page.evaluate(() => {
        const s = window.__fe.audio.getSettings();
        return [s.musicTheme, s.soundProfile];
      }), ['arcade', 'tactical']);
      await page.reload();
      assert.deepEqual(await page.evaluate(() => {
        const s = window.__fe.state.settings;
        return [s.pilotBindings.fire, s.reducedEffects, s.highContrast, s.reducedMotion, s.chatter.frequency, s.chatter.subtitles, s.musicTheme, s.soundProfile, s.chatter.language];
      }), ['KeyH', true, true, 'on', 'rare', false, 'arcade', 'tactical', 'en-US']);
      await page.locator(t('menu-options')).click();
      assert.equal(await page.locator(t('music-theme')).inputValue(), 'arcade');
      assert.equal(await page.locator(t('chatter-language')).inputValue(), 'en-US');
    }],
    ['pilot moves, fires directionally, follows camera and releases on pause/focus', async page => {
      await page.goto(`${base}/?debug=1`);
      await page.evaluate(() => {
        const fleet = { faction: 'terran', ships: [{ cls: 'ter_artemis', count: 1 }] };
        window.__fe.go('battle', { mode: 'sp', intro: false, config: { seed: 'pilot-ui', maxTicks: 600, players: [
          { id: 'p1', name: 'Piloto', team: 0, pilot: true, fleet, ai: 'especialista' },
          { id: 'p2', name: 'Rival', team: 1, isBot: true, fleet, ai: 'facil' },
        ] } });
        window.pilotEvents = [];
        window.__fe.feed.onFrame(f => window.pilotEvents.push(...f.e));
      });
      await page.waitForSelector(t('pilot-toggle'));
      await page.waitForFunction(() => window.__fe.renderer.getView()?.ships.size > 0);
      const id = await page.evaluate(() => window.__fe.feed.lastStart.ships.find(s => s.cls === 'ter_ace').id);
      await page.locator(t('pilot-toggle')).click();
      await page.waitForFunction(id => window.__fe.renderer.camera.followId === id, id);
      assert.match(await page.locator(t('pilot-panel')).innerText(), /Controle manual/);
      await page.locator(t('pilot-toggle')).click();
      assert.match(await page.locator(t('pilot-panel')).innerText(), /Piloto automático/);
      await page.locator(t('pilot-toggle')).click();
      assert.match(await page.locator(t('pilot-panel')).innerText(), /Controle manual/);
      const y = await page.evaluate(id => window.__fe.renderer.getView().ships.get(id).y, id);
      await page.keyboard.down('ArrowUp');
      await page.waitForTimeout(650);
      await page.keyboard.up('ArrowUp');
      assert.ok(await page.evaluate(({ id, y }) => window.__fe.renderer.getView().ships.get(id).y < y - 8, { id, y }));
      await page.mouse.move(900, 400);
      await page.keyboard.down('f');
      await page.waitForFunction(id => window.pilotEvents.some(e => e[0] === 'proj' && e[2] === id && e[3] === 0 && Number.isFinite(e[7]) && Number.isFinite(e[8])), id);
      await page.keyboard.up('f');
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.__fe.feed.controls.speed === 0);
      await page.waitForFunction(() => document.querySelector('[data-test="pilot-panel"]').textContent.includes('Piloto automático'));
      await page.keyboard.press('Space');
      await page.keyboard.press('p');
      assert.match(await page.locator(t('pilot-panel')).innerText(), /Controle manual/);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.waitForFunction(() => document.querySelector('[data-test="pilot-panel"]').textContent.includes('Piloto automático'));
      assert.ok(await page.evaluate(() => window.__fe.feed.controls.getPilotReplay().some(e => e.input.fire)));
      assert.match(await page.locator(t('battle-subtitle')).innerText(), /./);
    }],
    ['campaign objective and independent resource/personality controls are visible', async page => {
      await page.goto(`${base}/?debug=1`);
      await page.locator(t('menu-single')).click();
      const original = await page.locator(t('enemy-budget')).innerText();
      await page.locator(t('enemy-resources')).selectOption('2');
      assert.notEqual(await page.locator(t('enemy-budget')).innerText(), original);
      await page.locator(t('bot-personality')).selectOption('artillery');
      await page.locator(t('level-3')).click();
      assert.match(await page.locator(t('mission-objective')).innerText(), /Defender/);
      await page.goto(`${base}/?autotest=1&debug=1&level=3&speed=1`);
      await page.waitForSelector(`${t('mission-status')}:not(.hidden)`);
      assert.match(await page.locator(t('mission-status')).innerText(), /Defesa.*objetivo/);
    }],
    ['server profile records a completed browser battle and remains after reload', async page => {
      await page.goto(`${base}/?debug=1`);
      await page.locator(t('menu-profile')).click();
      await page.waitForSelector(t('inactivity-policy'));
      assert.match(await page.locator(t('inactivity-policy')).innerText(), /14.*2.*40/);
      await page.evaluate(() => { window.__fe.state.settings.speed = 4; window.__fe.go('fleetBuilder', { mode: 'sp' }); });
      await page.locator(t('ship-add-ter_hercules')).click();
      await page.locator(t('fleet-confirm')).click();
      await page.waitForSelector(t('battle-intro'));
      await page.locator(t('battle-begin')).click();
      await page.waitForSelector(t('result-winner'), { timeout: 90_000 });
      await page.waitForFunction(() => !document.querySelector('[data-test="result-reward"]')?.textContent.includes('Verificando'), null, { timeout: 30_000 });
      assert.match(await page.locator(t('result-reward')).innerText(), /Partida verificada/);
      assert.match(await page.locator(t('battle-report')).innerText(), /dano efetivo/);
      await page.locator(t('result-profile')).click();
      await page.waitForFunction(() => document.querySelector('[data-test="profile-content"] table tbody tr'));
      assert.equal(await page.locator(`${t('profile-content')} table tbody tr`).count(), 1);
      await page.reload();
      await page.locator(t('menu-profile')).click();
      await page.waitForFunction(() => document.querySelector('[data-test="profile-content"] table tbody tr'));
      assert.equal(await page.locator(`${t('profile-content')} table tbody tr`).count(), 1);
    }],
  ];
  let failed = 0;
  for (const [name, run] of tests) {
    if (process.env.FE_FEATURE_FILTER && !name.includes(process.env.FE_FEATURE_FILTER)) continue;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(12_000);
    const errors = [];
    const profileErrors = [];
    page.on('response', async response => { if (response.url().includes('/api/profile') && !response.ok()) profileErrors.push({ status: response.status(), error: (await response.json().catch(() => ({}))).error }); });
    page.on('pageerror', e => errors.push(e.message));
    try { await run(page); assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.__fe.errors.map(e => String(e))), []); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); console.error('Client:', await page.evaluate(() => window.__fe?.errors.map(String)).catch(() => [])); console.error('Profile:', profileErrors); console.error('Reward:', await page.locator(t('result-reward')).textContent().catch(() => 'not shown')); }
    finally { await page.close(); }
  }
  if (failed) process.exitCode = 1;
} finally {
  await browser?.close(); server.kill(); clearTimeout(watchdog); rmSync(dataDir, { recursive: true, force: true });
}
