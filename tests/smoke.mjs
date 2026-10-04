// Smoke test for Quinzena Fantástica.
// Usage: node tests/smoke.mjs   (optional: SHOT_DIR=/some/dir to save screenshots)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PLAIN_URL = pathToFileURL(path.join(ROOT, 'index.html')).href; // what players load
const PAGE_URL = PLAIN_URL + '#debug';
const SHOT_DIR = process.env.SHOT_DIR || '';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const req = createRequire(execSync('npm root -g').toString().trim() + '/');
    return req('playwright');
  }
}

async function launch(pw) {
  const chromium = pw.chromium || (pw.default && pw.default.chromium);
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    if (process.env.CHROMIUM_PATH) {
      return await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
    }
    throw err;
  }
}

// ---------------------------------------------------------------- helpers

const results = [];
const errors = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function step(name, fn) {
  try {
    const r = await fn();
    if (r === false) record(name, false);
    else record(name, true, typeof r === 'string' ? r : '');
  } catch (err) {
    record(name, false, String((err && err.message) || err).split('\n')[0]);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function watchErrors(page, label) {
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const loc = (msg.location && msg.location() && msg.location().url) || '';
    if (/fonts\.(googleapis|gstatic)\.com/.test(text + ' ' + loc)) return; // offline font loads are fine
    errors.push(`[${label}] console.error: ${text}${loc ? ' @ ' + loc : ''}`);
  });
  page.on('pageerror', err => errors.push(`[${label}] pageerror: ${(err && err.stack) || err}`));
}

const getState = page => page.evaluate(() => window.QF.getState());
const debug = (page, fn, ...args) => page.evaluate(([f, a]) => window.QF.debug[f](...a), [fn, args]);

async function waitState(page, predicateSrc, timeout = 3000) {
  // predicateSrc: body of a function receiving `s` (QF state)
  const fn = new Function('s', 'return (' + predicateSrc + ');');
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < timeout) {
    s = await getState(page);
    if (fn(s)) return s;
    await page.waitForTimeout(40);
  }
  throw new Error(`timeout waiting for: ${predicateSrc} (screen=${s && s.screen}, night=${s && s.night})`);
}

async function resolveLevelUps(page, until, timeout = 8000) {
  // presses "1" through any queued level-ups until the predicate holds
  const fn = new Function('s', 'return (' + until + ');');
  const t0 = Date.now();
  let s = await getState(page);
  while (Date.now() - t0 < timeout) {
    s = await getState(page);
    if (fn(s)) return s;
    if (s.screen === 'levelup') {
      await page.keyboard.press('1');
      await page.waitForTimeout(80);
    } else {
      await page.waitForTimeout(50);
    }
  }
  throw new Error(`timeout resolving level-ups until: ${until} (screen=${s.screen})`);
}

async function shot(page, name) {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, name + '.png') });
}

const visible = (page, sel) => page.evaluate(s => {
  const n = document.querySelector(s);
  if (!n || n.hidden) return false;
  const r = n.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(n).display !== 'none';
}, sel);

const noHorizontalOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const upgradeSum = s => Object.values(s.upgrades).reduce((a, b) => a + b, 0);

async function overlayFits(page, sel) {
  return page.evaluate(s => {
    const ov = document.querySelector(s);
    if (!ov || ov.hidden) return { ok: false, why: 'overlay hidden' };
    const panel = ov.querySelector('.panel');
    const r = panel.getBoundingClientRect();
    const cs = getComputedStyle(ov);
    const docOk = document.documentElement.scrollWidth <= window.innerWidth;
    const ovOk = ov.scrollWidth <= ov.clientWidth + 1;
    const panelOk = r.left >= -0.5 && r.right <= window.innerWidth + 0.5;
    const scrollOk = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
    const ok = docOk && ovOk && panelOk && scrollOk;
    return { ok, why: `doc=${docOk} overlay=${ovOk} panel=${panelOk} [${Math.round(r.left)}..${Math.round(r.right)} of ${window.innerWidth}] scrollY=${cs.overflowY} tall=${ov.scrollHeight > ov.clientHeight}` };
  }, sel);
}

// ---------------------------------------------------------------- run

const pw = await loadPlaywright();
const browser = await launch(pw);

try {
  // ======================= desktop =======================
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watchErrors(page, 'desktop');
  await page.goto(PAGE_URL);
  await page.waitForFunction(() => window.QF && window.QF.debug && document.querySelector('#ov-title'), null, { timeout: 5000 });
  await page.waitForTimeout(400);

  await step('1. Title overlay visible, screen = title', async () => {
    const s = await getState(page);
    assert(s.screen === 'title', 'screen is ' + s.screen);
    assert(await visible(page, '#ov-title'), 'title overlay not visible');
    await shot(page, 'desktop-01-title');
  });

  await step('2. "Começar" starts play within 1 s, HUD visible', async () => {
    await page.getByRole('button', { name: 'Começar' }).click();
    await waitState(page, "s.screen === 'playing'", 1000);
    assert(await visible(page, '#hud'), 'HUD not visible');
  });

  await step('3. Holding "d" for 800 ms moves the player right', async () => {
    const before = (await getState(page)).player.x;
    await page.keyboard.down('d');
    await page.waitForTimeout(800);
    await page.keyboard.up('d');
    const after = (await getState(page)).player.x;
    assert(after > before + 40, `x ${before.toFixed(1)} -> ${after.toFixed(1)}`);
    return `x ${before.toFixed(0)} → ${after.toFixed(0)}`;
  });

  await step('4. Creatures spawn (time scale ×3 for 2 s)', async () => {
    await debug(page, 'godMode', true);
    await debug(page, 'setTimeScale', 3);
    await page.waitForTimeout(2000);
    await debug(page, 'setTimeScale', 1);
    let s = await getState(page);
    if (s.screen === 'levelup') s = await resolveLevelUps(page, "s.screen === 'playing'");
    assert(s.enemies > 0, 'enemies = ' + s.enemies);
    await shot(page, 'desktop-02-playing');
    return 'enemies = ' + s.enemies;
  });

  await step('5. addXp → level-up modal with 3 cards; "1" picks and resumes', async () => {
    let s = await getState(page);
    if (s.screen === 'levelup') s = await resolveLevelUps(page, "s.screen === 'playing'");
    const before = upgradeSum(s);
    await debug(page, 'addXp', 200);
    await waitState(page, "s.screen === 'levelup'", 2000);
    const cards = await page.locator('#lu-cards .card').count();
    assert(cards === 3, 'cards = ' + cards);
    assert(await visible(page, '#ov-levelup'), 'level-up overlay hidden');
    await shot(page, 'desktop-03-levelup');
    s = await resolveLevelUps(page, "s.screen === 'playing'");
    const after = upgradeSum(s);
    assert(after > before, `upgrade levels ${before} -> ${after}`);
    return `upgrade levels ${before} → ${after}, level ${s.level}`;
  });

  await step('6. skipNight → dawn; Enter → night 2 playing', async () => {
    await debug(page, 'skipNight');
    await resolveLevelUps(page, "s.screen === 'dawn'", 8000);
    assert(await visible(page, '#ov-dawn'), 'dawn overlay hidden');
    await page.waitForTimeout(350);
    await shot(page, 'desktop-04-dawn');
    await page.keyboard.press('Enter');
    const s = await waitState(page, "s.screen === 'playing' && s.night === 2", 2000);
    return 'night ' + s.night;
  });

  await step('6b. Enter pressed twice fast on a sunrise level-up stops at Dawn', async () => {
    let s = await getState(page);
    if (s.screen === 'levelup') s = await resolveLevelUps(page, "s.screen === 'playing'");
    await debug(page, 'skipNight');
    await debug(page, 'addXp', s.xpToNext); // queues a level-up for the end of the sunrise
    s = await waitState(page, "s.screen === 'levelup'", 4000);
    while (s.screen === 'levelup' && s.pendingLevelUps > 1) {
      await page.keyboard.press('1');
      await page.waitForTimeout(80);
      s = await getState(page);
    }
    assert(s.screen === 'levelup', 'screen ' + s.screen);
    await page.waitForTimeout(350);
    await page.focus('#lu-cards .card');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    s = await getState(page);
    assert(s.screen === 'dawn', `screen ${s.screen}, night ${s.night} (Dawn was skipped)`);
    await page.waitForTimeout(350);
    await page.keyboard.press('Enter');
    s = await waitState(page, "s.screen === 'playing' && s.night === 3", 2000);
    return 'dawn held; a later Enter started night ' + s.night;
  });

  await step('7. setNight(7) → boss night with boss; damageBoss → dawn', async () => {
    await debug(page, 'setNight', 7);
    let s = await waitState(page, 's.isBossNight && s.bossAlive', 2000);
    await page.waitForTimeout(1500);
    await shot(page, 'desktop-05-boss7');
    await debug(page, 'damageBoss', 1e6);
    s = await resolveLevelUps(page, "s.screen === 'dawn'", 8000);
    return 'boss down, screen ' + s.screen;
  });

  await step('8. setNight(14) → Leviathan; damageBoss → victory', async () => {
    await debug(page, 'setNight', 14);
    await waitState(page, 's.isBossNight && s.bossAlive', 2000);
    await page.waitForTimeout(1600);
    await shot(page, 'desktop-06-boss14');
    await debug(page, 'damageBoss', 1e6);
    await resolveLevelUps(page, "s.screen === 'victory'", 8000);
    assert(await visible(page, '#ov-victory'), 'victory overlay hidden');
    await page.waitForTimeout(400);
    await shot(page, 'desktop-07-victory');
  });

  await step('9. "Jogar de novo" → night 1 level 1; setHp(0) → game over', async () => {
    await page.getByRole('button', { name: 'Jogar de novo' }).click();
    let s = await waitState(page, "s.screen === 'playing'", 1000);
    assert(s.night === 1 && s.level === 1, `night ${s.night} level ${s.level}`);
    await debug(page, 'godMode', false);
    await debug(page, 'setHp', 0);
    s = await waitState(page, "s.screen === 'gameover'", 2000);
    assert(await visible(page, '#ov-gameover'), 'game over overlay hidden');
    await page.waitForTimeout(400);
    await shot(page, 'desktop-08-gameover');
  });

  await step('10. "p" pauses (overlay visible) and "p" resumes', async () => {
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await waitState(page, "s.screen === 'playing'", 1000);
    await page.keyboard.press('p');
    let s = await waitState(page, "s.screen === 'paused'", 1000);
    assert(s.paused === true, 'paused flag false');
    assert(await visible(page, '#ov-pause'), 'pause overlay hidden');
    await shot(page, 'desktop-09-pause');
    await page.keyboard.press('p');
    s = await waitState(page, "s.screen === 'playing'", 1000);
  });

  await ctx.close();

  // ======================= phone portrait =======================
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const pp = await phone.newPage();
  watchErrors(pp, 'phone');
  await pp.goto(PAGE_URL);
  await pp.waitForFunction(() => window.QF && window.QF.debug, null, { timeout: 5000 });
  await pp.waitForTimeout(400);

  await step('11. Phone 390×844: tap to start, touch-drag moves, no horizontal overflow', async () => {
    const notes = [];
    assert(await noHorizontalOverflow(pp), 'overflow on title');
    await shot(pp, 'phone-01-title');
    await pp.tap('#btn-start');
    await waitState(pp, "s.screen === 'playing'", 1500);
    assert(await noHorizontalOverflow(pp), 'overflow while playing');
    await pp.evaluate(() => window.QF.debug.godMode(true));
    const before = (await getState(pp)).player;
    // real touch events through CDP (Chrome derives pointer events from them)
    const cdp = await phone.newCDPSession(pp);
    const x0 = 200, y0 = 600;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * 7, y: y0 - i * 6, id: 1 }] });
      await pp.waitForTimeout(16);
    }
    await pp.waitForTimeout(700);
    await shot(pp, 'phone-02-playing-joystick');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = (await getState(pp)).player;
    const moved = Math.hypot(after.x - before.x, after.y - before.y);
    assert(moved > 30 && after.x > before.x && after.y < before.y, `moved ${moved.toFixed(1)} (${before.x.toFixed(0)},${before.y.toFixed(0)}) -> (${after.x.toFixed(0)},${after.y.toFixed(0)})`);
    notes.push(`moved ${moved.toFixed(0)} u`);
    await pp.evaluate(() => window.QF.debug.addXp(30));
    await waitState(pp, "s.screen === 'levelup'", 2000);
    assert(await noHorizontalOverflow(pp), 'overflow on level-up');
    await pp.waitForTimeout(400);
    await shot(pp, 'phone-03-levelup');
    await resolveLevelUps(pp, "s.screen === 'playing'");
    await pp.evaluate(() => { window.QF.debug.godMode(false); window.QF.debug.setHp(0); });
    await waitState(pp, "s.screen === 'gameover'", 2500);
    assert(await noHorizontalOverflow(pp), 'overflow on game over');
    await pp.waitForTimeout(400);
    await shot(pp, 'phone-04-gameover');
    return notes.join(', ');
  });

  await step('11b. Phone: lifting the joystick finger hands the stick to a finger still down', async () => {
    await pp.tap('#btn-retry');
    await waitState(pp, "s.screen === 'playing'", 1500);
    await pp.evaluate(() => window.QF.debug.godMode(true));
    const cdp = await phone.newCDPSession(pp);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([id, x, y]) => ({ id, x, y })) });
    // finger A drags right
    await touch('touchStart', [[1, 120, 600]]);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [[1, 120 + i * 10, 600]]); await pp.waitForTimeout(16); }
    // finger B goes down and drags left while A is still held
    await touch('touchStart', [[1, 180, 600], [2, 300, 600]]);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [[1, 180, 600], [2, 300 - i * 10, 600]]); await pp.waitForTimeout(16); }
    // A lifts; B stays down and keeps pulling left
    await touch('touchEnd', [[1, 180, 600]]);
    for (let i = 1; i <= 3; i++) { await touch('touchMove', [[2, 240 - i * 2, 600]]); await pp.waitForTimeout(16); }
    await pp.waitForTimeout(150);
    const p0 = (await getState(pp)).player;
    await pp.waitForTimeout(400);
    const p1 = (await getState(pp)).player;
    await touch('touchEnd', []);
    assert(p1.x < p0.x - 30, `x ${p0.x.toFixed(1)} -> ${p1.x.toFixed(1)} after finger A lifted`);
    return `moved ${(p1.x - p0.x).toFixed(0)} u with finger B`;
  });
  await phone.close();

  // ======================= phone landscape =======================
  const land = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const lp = await land.newPage();
  watchErrors(lp, 'landscape');
  await lp.goto(PAGE_URL);
  await lp.waitForFunction(() => window.QF && window.QF.debug, null, { timeout: 5000 });
  await lp.waitForTimeout(400);

  await step('12. Landscape 844×390: title and level-up overlays fit', async () => {
    const t = await overlayFits(lp, '#ov-title');
    assert(t.ok, 'title: ' + t.why);
    await shot(lp, 'landscape-01-title');
    await lp.tap('#btn-start');
    await waitState(lp, "s.screen === 'playing'", 1500);
    await lp.evaluate(() => window.QF.debug.addXp(30));
    await waitState(lp, "s.screen === 'levelup'", 2000);
    await lp.waitForTimeout(400);
    const l = await overlayFits(lp, '#ov-levelup');
    assert(l.ok, 'levelup: ' + l.why);
    await shot(lp, 'landscape-02-levelup');
    return `title ${t.why.split(' ').pop()}, levelup ${l.why.split(' ').pop()}`;
  });
  await land.close();

  // ======================= no #debug (what players get) =======================
  const plain = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const np = await plain.newPage();
  watchErrors(np, 'no-debug');
  await np.goto(PLAIN_URL);
  await np.waitForFunction(() => window.QF && document.querySelector('#ov-title'), null, { timeout: 5000 });
  await np.waitForTimeout(400);

  await step('13. Without #debug: QF has only getState, a later #debug adds nothing, the game plays', async () => {
    const keys = await np.evaluate(() => Object.keys(window.QF));
    assert(JSON.stringify(keys) === '["getState"]', 'QF keys ' + JSON.stringify(keys));
    await np.evaluate(() => { location.hash = '#debug'; });
    await np.waitForTimeout(100);
    assert(await np.evaluate(() => typeof window.QF.debug) === 'undefined', 'QF.debug appeared after the hash change');
    await np.click('#btn-start');
    const s0 = await waitState(np, "s.screen === 'playing'", 1500);
    await np.keyboard.down('d');
    await np.waitForTimeout(800);
    await np.keyboard.up('d');
    // a few seconds of real play with the Faísca firing: the no-telemetry paths of hits, kills and the night
    await np.waitForTimeout(3000);
    const s1 = await getState(np);
    assert(s1.screen === 'playing' || s1.screen === 'levelup', 'screen ' + s1.screen);
    assert(s1.nightElapsed > s0.nightElapsed + 1, `night time ${s0.nightElapsed.toFixed(2)} -> ${s1.nightElapsed.toFixed(2)}`);
    assert(s1.player.x > s0.player.x + 40, `x ${s0.player.x.toFixed(1)} -> ${s1.player.x.toFixed(1)}`);
    return `night time ${s0.nightElapsed.toFixed(1)} → ${s1.nightElapsed.toFixed(1)} s, x ${s0.player.x.toFixed(0)} → ${s1.player.x.toFixed(0)}, kills ${s1.kills}`;
  });
  await plain.close();

  await step('14. No console errors or page errors', async () => {
    assert(errors.length === 0, errors.length + ' error(s): ' + errors.slice(0, 3).join(' | '));
  });
} catch (err) {
  record('Unexpected harness failure', false, String((err && err.message) || err).split('\n')[0]);
} finally {
  await browser.close();
}

// ---------------------------------------------------------------- summary
const w = Math.max(...results.map(r => r.name.length), 10);
console.log('\n' + '─'.repeat(w + 12));
console.log('Result  | Step');
console.log('─'.repeat(w + 12));
for (const r of results) console.log(`${r.ok ? 'PASS  ' : 'FAIL  '}  | ${r.name}`);
console.log('─'.repeat(w + 12));
const failed = results.filter(r => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed${SHOT_DIR ? ` · screenshots in ${SHOT_DIR}` : ''}`);
if (errors.length) {
  console.log('\nErrors captured:');
  for (const e of errors) console.log('  ' + e);
}
process.exit(failed ? 1 : 0);
