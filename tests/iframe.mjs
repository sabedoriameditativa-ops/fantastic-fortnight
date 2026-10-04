// Iframe test: portals (itch.io, CrazyGames) run the game inside an iframe on a page that scrolls.
// A generated host page, taller than the window, embeds index.html. The game must fill the frame at every size, and
// nothing done inside the game (keys, wheel, touch drags) may scroll the host page; buttons still work by keyboard,
// and a click or tap on the game gives it the keyboard.
// Usage: node tests/iframe.mjs
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { ROOT, loadPlaywright, launchChromium, blockNetwork, watchErrors, assert, sleep, createReport } from './helpers.mjs';

const GAME_URL = pathToFileURL(path.join(ROOT, 'index.html')).href + '#debug';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-iframe-'));
const TOP = 120; // host content above the frame
const HOST_Y = 60; // the host page is scrolled here before each check, so it could move both ways

const DESKTOP = [{ w: 960, h: 540 }, { w: 1280, h: 720 }, { w: 1920, h: 1080 }];
const PHONES = [{ w: 390, h: 844, mobile: true, name: 'portrait' }, { w: 844, h: 390, mobile: true, name: 'landscape' }];
const SCROLL_KEYS = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'End', 'Home', 'ArrowLeft', 'ArrowRight'];

const hostHtml = (w, h) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Portal host</title>
<style>html, body { margin: 0; } body { background: #ccc; font: 16px sans-serif; }
.above { height: ${TOP}px; } .below { height: 3000px; background: linear-gradient(#ccc, #333); }
iframe { display: block; border: 0; width: ${w}px; height: ${h}px; }</style></head>
<body><div class="above"><input id="host-input" aria-label="Host search"></div>
<iframe id="game" src="${GAME_URL}" title="Game"></iframe><div class="below"></div></body></html>`;

const rep = createReport('Iframe');
const pw = await loadPlaywright();
const browser = await launchChromium(pw);
const errors = [];
const blocked = [];

async function openHost({ w, h, mobile }) {
  const context = await browser.newContext(mobile
    ? { viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'en-US' }
    : { viewport: { width: w + 40, height: h + TOP + 120 }, locale: 'en-US' });
  await blockNetwork(context, { blocked });
  const page = await context.newPage();
  watchErrors(page, `host ${w}x${h}`, errors);
  const file = path.join(TMP, `host-${w}x${h}.html`);
  fs.writeFileSync(file, hostHtml(w, h));
  await page.goto(pathToFileURL(file).href);
  const frame = await (await page.waitForSelector('#game')).contentFrame();
  await frame.waitForFunction(() => window.QF && window.QF.debug && !document.getElementById('app').hasAttribute('data-i18n-pending'), null, { timeout: 8000 });
  await sleep(200);
  return { context, page, frame };
}

const hostY = page => page.evaluate(() => window.scrollY);
const setHostY = (page, y = HOST_Y) => page.evaluate(y => window.scrollTo(0, y), y);
const frameBox = async page => (await page.$('#game')).boundingBox();
const screen = frame => frame.evaluate(() => window.QF.getState().screen);
const D = (frame, fn, ...args) => frame.evaluate(([f, a]) => window.QF.debug[f](...a), [fn, args]);

async function until(frame, want, timeout = 8000) {
  const t0 = Date.now();
  let s;
  while (Date.now() - t0 < timeout) {
    s = await screen(frame);
    if (s === want) return;
    if (s === 'levelup' && want !== 'levelup') await frame.evaluate(() => { const c = document.querySelector('#lu-cards .card'); if (c) c.click(); });
    await sleep(50);
  }
  throw new Error(`screen ${s}, expected ${want}`);
}

// Presses each key with the host scrolled to HOST_Y; returns the keys that moved the host page.
async function keysThatScroll(page, keys) {
  const moved = [];
  for (const k of keys) {
    await setHostY(page);
    await page.keyboard.press(k);
    await sleep(150);
    const dy = (await hostY(page)) - HOST_Y;
    if (dy) moved.push(`${k} ${dy > 0 ? '+' : ''}${dy}px`);
  }
  return moved;
}

// Wheel down and up over the middle of the frame; returns the host movement.
async function wheelMoves(page) {
  const b = await frameBox(page);
  const moved = [];
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 300));
  for (const dy of [300, -300]) {
    await setHostY(page);
    await page.mouse.wheel(0, dy);
    await sleep(300);
    const d = (await hostY(page)) - HOST_Y;
    if (d) moved.push(`wheel ${dy > 0 ? 'down' : 'up'} ${d}px`);
  }
  return moved;
}

// A one-finger drag inside the visible part of the frame (raw touch events through CDP).
async function touchDrag(context, page, dir) {
  const cdp = await context.newCDPSession(page);
  const b = await frameBox(page);
  const vh = await page.evaluate(() => innerHeight);
  const x = b.x + b.width * 0.3;
  const top = Math.max(b.y, 0), bottom = Math.min(b.y + b.height, vh);
  const y0 = (top + bottom) / 2;
  const sgn = dir === 'up' ? -1 : 1;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 1 }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + sgn * i * 12, id: 1 }] });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
  await cdp.detach();
}

// What the frame looks like from inside: the canvas must cover it exactly and nothing may scroll.
const fillReport = frame => frame.evaluate(() => {
  const r = el => { const q = el.getBoundingClientRect(); return [q.left, q.top, q.width, q.height].map(v => Math.round(v * 10) / 10); };
  const canvas = document.getElementById('game');
  const de = document.documentElement;
  return {
    inner: [innerWidth, innerHeight], canvas: r(canvas), backing: [canvas.width, canvas.height],
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    scroll: [de.scrollWidth, de.scrollHeight, document.body.scrollWidth, document.body.scrollHeight],
    overlay: (() => { const o = document.querySelector('.overlay:not([hidden])'); return o ? r(o) : null; })(),
    panel: (() => { const p = document.querySelector('.overlay:not([hidden]) .panel'); return p ? r(p) : null; })(),
    hud: document.getElementById('hud').hidden ? null : r(document.getElementById('hud')),
    pauseBtn: document.getElementById('hud').hidden ? null : r(document.getElementById('btn-pause')),
  };
});

function checkFill(f, w, h, where) {
  const near = (a, b) => Math.abs(a - b) <= 0.5;
  assert(f.inner[0] === w && f.inner[1] === h, `${where}: frame viewport ${f.inner} ≠ ${w}x${h}`);
  assert(near(f.canvas[0], 0) && near(f.canvas[1], 0) && near(f.canvas[2], w) && near(f.canvas[3], h), `${where}: canvas ${f.canvas}`);
  assert(f.backing[0] === Math.round(w * f.dpr) && f.backing[1] === Math.round(h * f.dpr), `${where}: canvas buffer ${f.backing} at dpr ${f.dpr}`);
  assert(f.scroll[0] <= w && f.scroll[1] <= h && f.scroll[2] <= w && f.scroll[3] <= h, `${where}: page scrolls ${f.scroll}`);
  if (f.overlay) assert(near(f.overlay[2], w) && near(f.overlay[3], h), `${where}: overlay ${f.overlay}`);
  if (f.panel) assert(f.panel[0] >= 0 && f.panel[0] + f.panel[2] <= w + 0.5, `${where}: panel ${f.panel} outside ${w}`);
  if (f.hud) {
    assert(near(f.hud[2], w), `${where}: HUD width ${f.hud[2]}`);
    const p = f.pauseBtn;
    assert(p[0] >= 0 && p[1] >= 0 && p[0] + p[2] <= w + 0.5 && p[1] + p[3] <= h + 0.5, `${where}: pause button ${p} outside the frame`);
  }
}

try {
  for (const size of [...DESKTOP, ...PHONES]) {
    const { w, h } = size;
    await rep.step(`1. Fills the frame at ${w}×${h}${size.mobile ? ' (phone ' + size.name + ')' : ''}: title, play, pause`, async () => {
      const { context, page, frame } = await openHost(size);
      try {
        checkFill(await fillReport(frame), w, h, 'title');
        if (size.mobile) await frame.tap('#btn-start'); else await frame.click('#btn-start');
        await until(frame, 'playing');
        await sleep(200);
        const play = await fillReport(frame);
        checkFill(play, w, h, 'playing');
        if (size.mobile) await frame.tap('#btn-pause'); else await frame.click('#btn-pause');
        await until(frame, 'paused');
        checkFill(await fillReport(frame), w, h, 'paused');
        if (size.mobile) await frame.tap('#btn-resume'); else await frame.click('#btn-resume');
        await until(frame, 'playing');
        return `canvas ${play.canvas[2]}×${play.canvas[3]}, buffer ${play.backing.join('×')}`;
      } finally {
        await context.close();
      }
    });
  }

  await rep.step('2. Keys and wheel inside the game never scroll the host page (every screen)', async () => {
    const { context, page, frame } = await openHost(DESKTOP[1]);
    const leaks = [];
    let checks = 0;
    // body focus (after a click on the background) and button focus (the overlay's first button)
    const probe = async (name, { spaceOnBody = true } = {}) => {
      await frame.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
      const keys = spaceOnBody ? [...SCROLL_KEYS, 'Space'] : SCROLL_KEYS;
      for (const m of await keysThatScroll(page, keys)) leaks.push(`${name} (body focus): ${m}`);
      checks += keys.length;
      const btn = await frame.evaluate(() => { const b = document.querySelector('.overlay:not([hidden]) button'); if (b) b.focus(); return !!b; });
      if (btn) {
        for (const m of await keysThatScroll(page, SCROLL_KEYS)) leaks.push(`${name} (button focus): ${m}`);
        checks += SCROLL_KEYS.length;
      }
      for (const m of await wheelMoves(page)) leaks.push(`${name}: ${m}`);
      checks += 2;
    };
    try {
      const b = await frameBox(page);
      await page.mouse.click(b.x + 8, b.y + b.height - 8); // focus the frame like a player would
      assert(await frame.evaluate(() => document.hasFocus()), 'the frame did not get focus from a click');
      await probe('title');
      await frame.click('#btn-howto');
      await until(frame, 'howto');
      await probe('how-to');
      await frame.click('#btn-howto-back');
      await frame.click('#btn-start');
      await until(frame, 'playing');
      await D(frame, 'godMode', true);
      await probe('playing');
      await page.keyboard.press('Escape');
      await until(frame, 'paused');
      await probe('paused');
      await page.keyboard.press('Escape');
      await until(frame, 'playing');
      await D(frame, 'addXp', 30);
      await until(frame, 'levelup');
      await probe('level-up');
      await until(frame, 'playing');
      await D(frame, 'skipNight');
      await until(frame, 'dawn');
      await probe('dawn', { spaceOnBody: false }); // Space at Dawn starts the next night (checked in step 3)
      await D(frame, 'godMode', false);
      await frame.click('#btn-next-night');
      await until(frame, 'playing');
      await D(frame, 'setHp', 0);
      await until(frame, 'gameover');
      await probe('game over');
      await frame.click('#btn-retry');
      await until(frame, 'playing');
      await D(frame, 'godMode', true);
      await D(frame, 'setNight', 14);
      await frame.waitForFunction(() => window.QF.getState().bossAlive);
      await D(frame, 'damageBoss', 1e7);
      await until(frame, 'victory');
      await probe('victory');
    } finally {
      await context.close();
    }
    assert(!leaks.length, `${leaks.length} leak(s): ` + leaks.slice(0, 5).join(' | '));
    return `${checks} key/wheel checks on 8 screens, host scrollY stayed ${HOST_Y}`;
  });

  await rep.step('3. Space and Enter still press the focused button inside the frame', async () => {
    const { context, page, frame } = await openHost(DESKTOP[1]);
    try {
      const b = await frameBox(page);
      await page.mouse.click(b.x + 8, b.y + b.height - 8);
      const press = async (sel, key) => { await frame.focus(sel); await setHostY(page); await page.keyboard.press(key); await sleep(150); };
      await press('#btn-howto', 'Space');
      await until(frame, 'howto');
      await press('#btn-howto-back', 'Enter');
      await until(frame, 'title');
      await press('#btn-start', 'Space');
      await until(frame, 'playing');
      await D(frame, 'godMode', true);
      await page.keyboard.press('Escape');
      await until(frame, 'paused');
      const lang0 = await frame.evaluate(() => window.QF.getState().lang);
      await press('#btn-lang-pause', 'Space');
      const lang1 = await frame.evaluate(() => window.QF.getState().lang);
      assert(lang1 !== lang0, `Space on the language button: ${lang0} → ${lang1}`);
      await press('#btn-lang-pause', 'Enter');
      assert(await frame.evaluate(() => window.QF.getState().lang) === lang0, 'Enter on the language button did not switch back');
      await press('#btn-resume', 'Enter');
      await until(frame, 'playing');
      const before = await frame.evaluate(() => Object.values(window.QF.getState().upgrades).reduce((a, b) => a + b, 0));
      await D(frame, 'addXp', 20);
      await until(frame, 'levelup');
      await sleep(350);
      await page.keyboard.press('ArrowRight'); // arrows still walk the cards
      const idx = await frame.evaluate(() => [...document.querySelectorAll('#lu-cards .card')].indexOf(document.activeElement));
      assert(idx === 1, 'ArrowRight focused card ' + idx);
      await page.keyboard.press('Space');
      await until(frame, 'playing');
      const after = await frame.evaluate(() => Object.values(window.QF.getState().upgrades).reduce((a, b) => a + b, 0));
      assert(after === before + 1, `upgrade levels ${before} → ${after}`);
      await D(frame, 'skipNight');
      await until(frame, 'dawn');
      await sleep(400);
      await frame.evaluate(() => document.activeElement && document.activeElement.blur());
      await page.keyboard.press('Space'); // the Dawn shortcut, with no button focused
      await until(frame, 'playing');
      const y = await hostY(page);
      assert(y === HOST_Y, 'host scrolled to ' + y);
      return 'how-to, back, start, language ×2, resume, card, Dawn';
    } finally {
      await context.close();
    }
  });

  await rep.step('4. A tall overlay scrolls by keys and wheel inside the frame, the host does not', async () => {
    const { context, page, frame } = await openHost({ w: 960, h: 400 });
    try {
      const b = await frameBox(page);
      await page.mouse.click(b.x + 8, b.y + b.height - 8);
      await frame.click('#btn-howto');
      await until(frame, 'howto');
      await frame.evaluate(() => document.activeElement.blur());
      const top = () => frame.evaluate(() => { const o = document.getElementById('ov-howto'); return [o.scrollTop, o.scrollHeight - o.clientHeight]; });
      const [, max] = await top();
      assert(max > 40, 'how-to does not overflow at 960×400 (max ' + max + ')');
      await setHostY(page);
      const seen = [];
      for (const k of ['ArrowDown', 'End', 'PageUp', 'Home', 'PageDown']) { await page.keyboard.press(k); await sleep(80); seen.push((await top())[0]); }
      assert(seen[0] === 40 && seen[1] === max && seen[2] < max && seen[3] === 0 && seen[4] > 0, `scrollTop after ↓ End PgUp Home PgDn: ${seen}`);
      await page.keyboard.press('Home');
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.wheel(0, 150);
      await sleep(300);
      const wheel = (await top())[0];
      assert(wheel > 0, 'wheel did not scroll the overlay');
      const y = await hostY(page);
      assert(y === HOST_Y, 'host scrolled to ' + y);
      return `scrollTop ${seen.join(' → ')} (max ${max}), wheel → ${wheel}`;
    } finally {
      await context.close();
    }
  });

  for (const size of PHONES) {
    await rep.step(`5. Touch drags never scroll the host (phone ${size.name} ${size.w}×${size.h})`, async () => {
      const { context, page, frame } = await openHost(size);
      const leaks = [];
      const drags = async name => {
        for (const dir of ['up', 'down']) {
          await setHostY(page);
          await touchDrag(context, page, dir);
          const dy = (await hostY(page)) - HOST_Y;
          if (dy) leaks.push(`${name} drag ${dir}: host ${dy}px`);
        }
      };
      let overlayScroll = null;
      try {
        await drags('title');
        await frame.tap('#btn-howto');
        await until(frame, 'howto');
        const before = await frame.evaluate(() => document.getElementById('ov-howto').scrollTop);
        await drags('how-to');
        if (await frame.evaluate(() => { const o = document.getElementById('ov-howto'); return o.scrollHeight > o.clientHeight + 1; })) {
          await frame.evaluate(() => { document.getElementById('ov-howto').scrollTop = 0; });
          await setHostY(page);
          await touchDrag(context, page, 'up');
          overlayScroll = (await frame.evaluate(() => document.getElementById('ov-howto').scrollTop)) - before;
          if (!(overlayScroll > 0)) leaks.push('the tall how-to did not scroll by touch');
        }
        await frame.tap('#btn-howto-back');
        await frame.tap('#btn-start');
        await until(frame, 'playing');
        await D(frame, 'godMode', true);
        await drags('playing');
        await frame.tap('#btn-pause');
        await until(frame, 'paused');
        await drags('paused');
        await frame.tap('#btn-resume');
        await until(frame, 'playing');
        await D(frame, 'addXp', 30);
        await until(frame, 'levelup');
        await drags('level-up');
      } finally {
        await context.close();
      }
      assert(!leaks.length, leaks.join(' | '));
      return overlayScroll === null ? 'title, how-to, playing, paused, level-up' : `title, how-to (scrolled itself ${overlayScroll}px), playing, paused, level-up`;
    });
  }

  await rep.step('6. A click on the game gives it the keyboard (even when play started without focus)', async () => {
    const { context, page, frame } = await openHost(DESKTOP[1]);
    try {
      await page.focus('#host-input');
      await D(frame, 'startRun', 1); // playing, but the frame never had focus
      await D(frame, 'godMode', true);
      assert(!(await frame.evaluate(() => document.hasFocus())), 'the frame already had focus');
      const b = await frameBox(page);
      await page.mouse.click(b.x + b.width * 0.75, b.y + b.height / 2); // on the canvas
      await sleep(100);
      assert(await frame.evaluate(() => document.hasFocus()), 'clicking the canvas did not focus the frame');
      const x0 = await frame.evaluate(() => window.QF.getState().player.x);
      await page.keyboard.down('d');
      await sleep(500);
      await page.keyboard.up('d');
      const x1 = await frame.evaluate(() => window.QF.getState().player.x);
      const typed = await page.evaluate(() => document.getElementById('host-input').value);
      assert(x1 > x0 + 30, `player x ${x0.toFixed(0)} → ${x1.toFixed(0)}`);
      assert(typed === '', 'the key went to the host page: "' + typed + '"');
      return `player x ${x0.toFixed(0)} → ${x1.toFixed(0)} after one click`;
    } finally {
      await context.close();
    }
  });

  await rep.step('6b. A tap on the game gives it focus (phone)', async () => {
    const { context, page, frame } = await openHost(PHONES[0]);
    try {
      await page.focus('#host-input');
      await D(frame, 'startRun', 1);
      assert(!(await frame.evaluate(() => document.hasFocus())), 'the frame already had focus');
      const b = await frameBox(page);
      const cdp = await context.newCDPSession(page);
      const pt = { x: b.x + b.width / 2, y: Math.max(b.y, 0) + 200, id: 1 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(150);
      assert(await frame.evaluate(() => document.hasFocus()), 'tapping the canvas did not focus the frame');
    } finally {
      await context.close();
    }
  });

  await rep.step('7. No console errors, page errors or network requests', async () => {
    assert(!errors.length, errors.length + ' error(s): ' + errors.slice(0, 3).join(' | '));
    assert(!blocked.length, 'requests outside file: ' + blocked.slice(0, 3).join(' | '));
  });
} catch (err) {
  rep.record('Unexpected harness failure', false, String((err && err.message) || err).split('\n')[0]);
} finally {
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}
for (const e of errors) console.log('  ' + e);
rep.finish();
