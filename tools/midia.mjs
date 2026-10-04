// Store media for Quinzena Fantástica / Fourteen Tides (dev tool; the game never loads it and the ZIP never ships it).
// Renders every cover, screenshot and preview video from the real game in headless Chromium, through the debug
// hooks of index.html#debug, into publicacao/ (repo root):
//
//   npm run midia                               (= node tools/midia.mjs)
//   node tools/midia.mjs --only covers,shots     (groups: covers, shots, phone, videos)
//   node tools/midia.mjs --out /tmp/media --keep-temp
//
//   publicacao/crazygames/  cover-landscape-1920x1080.png, cover-portrait-800x1200.png, cover-square-800x800.png
//                           preview-landscape-1920x1080.mp4, preview-portrait-1080x1620.mp4
//   publicacao/itch/        cover-630x500.png, embed-background-960x540.png
//   publicacao/screenshots/ en/*-1920x1080.png, en/phone-*-780x1688.png, pt/*-1920x1080.png
//
// How it stays reproducible and honest:
// - Every scene is real play: a seeded run (QF.debug.startRun / seed) driven by the balance bots of
//   tools/balance-bots.js, warmed up from night 1 in god mode with a fixed upgrade-priority picker, so level, kills,
//   score and build on the HUD are what that run really reached. The key art (no HUD) jumps straight to a night with a
//   granted build and lets the keeper stand by the lighthouse while creatures come in.
// - Capture-only page hooks, injected with addInitScript (nothing in game.js changes): the game's
//   requestAnimationFrame loop runs only when this tool pumps a frame, with the frame time it chooses; CSS
//   transitions and animations follow the same clock; Math.random (cosmetic effects only) is seeded. The simulation
//   itself advances only through QF.debug.runSteps at its fixed 1/60 s step, so a video frame is exactly 2 steps
//   (30 fps, real speed, no fast-forward), and the same command renders the same frames.
// - Covers: the game canvas is grabbed without the DOM HUD, then composed (crop, light bloom, vignette, and the title
//   in the game's display face IM Fell English SC from fonts/, SIL OFL 1.1) on a canvas page.
// - Videos: frames are screenshots piped into ffmpeg (H.264, yuv420p, faststart, no audio track); each opens on its
//   static cover for 1 s, then cross-fades into gameplay.
// - The network is blocked for every page (as in the tests). Requires Playwright + Chromium (local or global, never
//   downloaded) and ffmpeg/ffprobe on PATH.
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { loadPlaywright, launchChromium, blockNetwork } from '../tests/helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const BOTS = path.join(HERE, 'balance-bots.js');
const GAME_URL = pathToFileURL(path.join(REPO, 'index.html')).href + '#debug';
const FONT_TITLE = path.join(REPO, 'fonts', 'im-fell-english-sc-400-latin.woff2');
const FONT_BODY = path.join(REPO, 'fonts', 'alegreya-sans-500-latin.woff2');

const TITLE = 'Fourteen Tides';
const SUBTITLE = 'Fourteen nights at the lighthouse of the Lost Isle';
const FPS = 30;
const GROUPS = ['covers', 'shots', 'phone', 'videos'];

const HELP = `Usage: node tools/midia.mjs [options]
  --out <dir>        where to write (default: <repo>/publicacao)
  --only <list>      comma-separated groups: ${GROUPS.join(', ')} (default: all)
  --keep-temp        keep the temporary folder (key-art masters, video segments)
  --help             this text`;

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const o = { out: path.join(REPO, 'publicacao'), only: GROUPS.slice(), keepTemp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => { if (i + 1 >= argv.length) die('missing value for ' + a); return argv[++i]; };
    if (a === '--out') o.out = path.resolve(v());
    else if (a === '--only') {
      o.only = v().split(',').map(s => s.trim()).filter(Boolean);
      for (const g of o.only) if (!GROUPS.includes(g)) die(`unknown group "${g}" (use ${GROUPS.join(', ')})`);
    } else if (a === '--keep-temp') o.keepTemp = true;
    else if (a === '--help' || a === '-h') { console.log(HELP); process.exit(0); }
    else die('unknown option ' + a + '\n' + HELP);
  }
  return o;
}

function die(msg) {
  console.error('midia: ' + msg);
  process.exit(2);
}

// ---------------------------------------------------------------- what gets made

// Every file this tool writes, with its exact pixel size. `group` is the --only group that makes it.
const C = 'crazygames/', I = 'itch/', S = 'screenshots/';
const ASSETS = [
  { group: 'covers', file: C + 'cover-landscape-1920x1080.png', w: 1920, h: 1080, purpose: 'CrazyGames cover 16:9 (title only)' },
  { group: 'covers', file: C + 'cover-portrait-800x1200.png', w: 800, h: 1200, purpose: 'CrazyGames cover 2:3 (title only)' },
  { group: 'covers', file: C + 'cover-square-800x800.png', w: 800, h: 800, purpose: 'CrazyGames cover 1:1 (title only)' },
  { group: 'covers', file: I + 'cover-630x500.png', w: 630, h: 500, purpose: 'itch.io cover 315:250 (title + subtitle)' },
  { group: 'covers', file: I + 'embed-background-960x540.png', w: 960, h: 540, purpose: 'itch.io embed background behind the Play button (no text)' },
  { group: 'shots', file: S + 'en/01-early-night-1920x1080.png', w: 1920, h: 1080, purpose: 'Screenshot (EN): night 3, crabs and jellyfish at the lighthouse' },
  { group: 'shots', file: S + 'en/02-mid-game-build-1920x1080.png', w: 1920, h: 1080, purpose: 'Screenshot (EN): night 11, anchors + Fresnel beam + golden creatures' },
  { group: 'shots', file: S + 'en/03-level-up-1920x1080.png', w: 1920, h: 1080, purpose: 'Screenshot (EN): level-up cards' },
  { group: 'shots', file: S + 'en/04-crab-king-1920x1080.png', w: 1920, h: 1080, purpose: 'Screenshot (EN): night 7 boss, the Crab King' },
  { group: 'shots', file: S + 'en/05-tide-leviathan-1920x1080.png', w: 1920, h: 1080, purpose: 'Screenshot (EN): night 14 boss, the Tide Leviathan' },
  { group: 'shots', file: S + 'pt/01-melhoria-1920x1080.png', w: 1920, h: 1080, purpose: 'Screenshot (PT): level-up cards' },
  { group: 'shots', file: S + 'pt/02-caranguejo-rei-1920x1080.png', w: 1920, h: 1080, purpose: 'Screenshot (PT): night 7 boss' },
  { group: 'phone', file: S + 'en/phone-01-joystick-780x1688.png', w: 780, h: 1688, purpose: 'Phone screenshot (EN, 390x844 @2x): touch joystick' },
  { group: 'phone', file: S + 'en/phone-02-tide-leviathan-780x1688.png', w: 780, h: 1688, purpose: 'Phone screenshot (EN, 390x844 @2x): final boss' },
  { group: 'videos', file: C + 'preview-landscape-1920x1080.mp4', w: 1920, h: 1080, purpose: 'CrazyGames preview video 16:9 (silent, opens on the cover)' },
  { group: 'videos', file: C + 'preview-portrait-1080x1620.mp4', w: 1080, h: 1620, purpose: 'CrazyGames preview video 2:3 (silent, opens on the cover)' },
];

// ---------------------------------------------------------------- capture page (runs inside the game page)

// Injected before game.js. Capture-only: the page is opened by this tool, never by players.
function pageInit() {
  'use strict';
  const mulberry32 = seed => {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  // cosmetic randomness (particles, lantern flicker, shake): seeded, so the same command draws the same pixels.
  // The gameplay stream is seeded separately by QF.debug.startRun(seed).
  Math.random = mulberry32(0x2545f491);

  // The game's requestAnimationFrame loop runs only when the tool pumps a frame, with the time step it picks.
  const queue = [];
  let now = 1000;
  window.requestAnimationFrame = cb => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};
  // CSS transitions and animations (banner, toast, bars, overlays) follow the same clock
  const cssClock = ms => {
    for (const a of document.getAnimations()) {
      a.__vt = a.__vt == null ? 0 : a.__vt + ms;
      a.pause();
      a.currentTime = a.__vt;
    }
  };

  const M = (window.QFMedia = {});
  M.pump = ms => {
    now += ms;
    const cbs = queue.splice(0);
    for (const cb of cbs) cb(now);
    cssClock(ms);
  };
  // the simulation stands still while the camera catches up with the keeper and banners/toasts run out
  M.settle = (seconds = 3) => {
    for (let t = 0; t < seconds; t += 0.25) M.pump(250);
    M.pump(1000 / 60);
  };
  // one video frame: 2 fixed simulation steps (1/30 s of play), then one drawn frame of 1/30 s
  M.frame = () => {
    const st = window.QF.debug.runSteps(2);
    M.pump(1000 / 30);
    return st;
  };

  // A run staged for a picture. cfg: {
  //   seed, night, at (s into that night),
  //   build: [[id, levels], …]  → jump straight to `night` with this build (key art, HUD hidden)
  //   (no build)                 → play nights 1…night-1 for real (god mode), picks by `picks` priority
  //   bot: 'skilled' | 'kite' | …, botOpts, target: [x, y] (walk there and stand still instead),
  //   spawns: [[step, type, count], …] (steps counted from the night's start), until: 'js expression of v' }
  M.stage = cfg => {
    const d = window.QF.debug, B = window.QFBalance;
    const prio = cfg.picks || []; // upgrade ids, most wanted first (none: the first card)
    d.setManualClock(true);
    d.startRun(cfg.seed);
    d.godMode(true);
    const bot = B.AUTOPILOTS[cfg.bot || 'skilled'](Object.assign({}, B.DEFAULTS, cfg.botOpts || {}), mulberry32(cfg.seed ^ 0x5bd1e995));
    let nightSteps = 0;
    M.view = null;
    d.setAutopilot(v => {
      M.view = v;
      if (v.night === cfg.night) {
        nightSteps++;
        for (const s of cfg.spawns || []) if (s[0] === nightSteps) d.spawn(s[1], s[2]);
      }
      if (cfg.target) {
        const dx = cfg.target[0] - v.player.x, dy = cfg.target[1] - v.player.y, l = Math.hypot(dx, dy);
        return l < 6 ? { x: 0, y: 0 } : { x: dx / l, y: dy / l };
      }
      return bot(v);
    });
    d.setPicker(offers => {
      let best = 0, rank = 1e9;
      offers.forEach((o, i) => { const k = prio.indexOf(o.id); const r = k < 0 ? 99 : k; if (r < rank) { rank = r; best = i; } });
      return best;
    });
    // No drawing while the run gets there, but the frame clock keeps pace with the simulation (a 1/4 s frame every
    // 15 steps), so banners, toasts and CSS transitions are exactly as old as they would be in play.
    d.setRender(false);
    let st = d.runSteps(0), acc = 0;
    const step = () => {
      st = d.runSteps(1);
      if (++acc === 15) { M.pump(250); acc = 0; }
      return st;
    };
    if (cfg.build) {
      for (const [id, n] of cfg.build) for (let i = 0; i < n; i++) d.grantUpgrade(id);
      d.setNight(cfg.night);
      st = d.runSteps(0);
    } else {
      let guard = 0;
      while (!(st.night === cfg.night && st.phase === 'night') && guard++ < 200000) step();
    }
    for (let n = Math.round((cfg.at || 0) * 60) - nightSteps; n > 0; n--) step();
    if (cfg.until) {
      const pred = new Function('v', 'return (' + cfg.until + ');');
      let guard = 0;
      while (!(M.view && pred(M.view)) && st.night === cfg.night && guard++ < 60 * 120) step();
      if (!(M.view && pred(M.view)) || st.night !== cfg.night) throw new Error('stage: "' + cfg.until + '" never held in night ' + cfg.night);
    }
    d.setRender(true);
    return Object.assign({ nightSteps }, st, { state: window.QF.getState() });
  };

  // Opens the level-up screen of the next level (the embers it lacks are added) and shows the first three of
  // `candidates` the game could really offer now (not maxed; no 5th weapon; Long Wick only with the lantern).
  M.levelUp = candidates => {
    const d = window.QF.debug;
    let st = window.QF.getState();
    d.setPicker(null);
    d.addXp(st.xpToNext - st.xp);
    d.runSteps(1);
    st = window.QF.getState();
    if (st.screen !== 'levelup') throw new Error('levelUp: no level-up screen (' + st.screen + ')');
    const ups = st.upgrades, weapons = ['spark', 'beam', 'aura', 'anchors', 'harpoon'];
    const owned = weapons.filter(w => ups[w] > 0).length;
    const ok = id => (ups[id] || 0) < 5 && !(weapons.indexOf(id) >= 0 && !ups[id] && owned >= 4) && !(id === 'wick' && !ups.aura);
    const ids = candidates.filter(ok).slice(0, 3);
    if (ids.length < 3 || !d.setOffers(ids)) throw new Error('levelUp: cannot offer ' + candidates.join(', '));
    return { level: st.level, offers: ids, upgrades: ups };
  };
}

// ---------------------------------------------------------------- browser helpers

async function openGame(browser, { width, height, dpr = 1, locale = 'en-US', touch = false, noCanvasText = false }) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: dpr, locale, hasTouch: touch, isMobile: touch,
    colorScheme: 'dark', reducedMotion: 'no-preference',
  });
  await blockNetwork(context);
  await context.addInitScript({ content: `(${pageInit.toString()})();` });
  await context.addInitScript({ path: BOTS });
  if (noCanvasText) await context.addInitScript({ content: 'CanvasRenderingContext2D.prototype.fillText = CanvasRenderingContext2D.prototype.strokeText = function () {};' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.stack) || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.goto(GAME_URL);
  await page.waitForFunction(() => window.QF && window.QF.debug && window.QFBalance && window.QFMedia);
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return ['400 20px "IM Fell English SC"', '500 20px "Alegreya Sans"', '700 20px "Alegreya Sans"'].map(f => document.fonts.check(f));
  });
  if (fonts.includes(false)) throw new Error('the game fonts did not load from fonts/: ' + JSON.stringify(fonts));
  const close = async () => {
    await context.close();
    if (errors.length) throw new Error('page errors:\n' + errors.join('\n'));
  };
  return { context, page, close };
}

const stage = (page, cfg) => page.evaluate(c => window.QFMedia.stage(c), cfg);
const settle = (page, seconds) => page.evaluate(s => window.QFMedia.settle(s), seconds);

// The game canvas only (no DOM HUD), as PNG bytes.
async function grabCanvas(page) {
  const url = await page.evaluate(() => document.getElementById('game').toDataURL('image/png'));
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

function writeFile(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}

// Chromium's PNGs re-packed by ffmpeg (RGB, zlib 9, per-row filters): about a third smaller, kept only if every
// pixel decodes the same.
function savePng(file, buf) {
  writeFile(file, buf);
  const packed = file + '.packed.png';
  const md5 = f => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-pix_fmt', 'rgb24', '-f', 'md5', '-']).toString().trim();
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-pix_fmt', 'rgb24', '-compression_level', '9', '-pred', 'mixed', packed]);
    if (md5(packed) === md5(file) && fs.statSync(packed).size < buf.length) fs.renameSync(packed, file);
  } finally {
    fs.rmSync(packed, { force: true });
  }
}

// ---------------------------------------------------------------- key art

// The key-art scene: night 14, the Tide Leviathan coiled by the lighthouse, the keeper with three spinning anchors
// standing at the tower's foot, creatures of every kind coming in through the beam. Rendered once at 2x (3.2 device
// px per world unit) and cropped by every cover, so all of them share one image.
const KEYART = {
  view: { width: 1800, height: 1300, dpr: 2 },
  stage: {
    seed: 11, night: 14, at: 1050 / 60, target: [70, 95],
    build: [['beam', 5], ['anchors', 3], ['boots', 2]],
    spawns: [[60, 'jelly', 8], [90, 'puffer', 4], [120, 'crab', 8], [200, 'squid', 4], [240, 'eel', 4], [400, 'jelly', 6],
      [500, 'puffer', 3], [620, 'crab', 6], [680, 'jelly', 6], [740, 'eel', 3]],
  },
  // a picture, not a screenshot: the floating damage numbers (the only text the game draws on its canvas) are left out
  noCanvasText: true,
};

async function renderKeyArtMaster(browser, tmp) {
  const g = await openGame(browser, Object.assign({ noCanvasText: KEYART.noCanvasText }, KEYART.view));
  const st = await stage(g.page, KEYART.stage);
  await settle(g.page, 3);
  const png = await grabCanvas(g.page);
  // the camera rests on the keeper: the lamp (world 0,0) sits that far from the canvas centre
  const { width, height, dpr } = KEYART.view;
  const px = Math.min(dpr, 2) * Math.min(1.6, Math.max(0.55, Math.min(width, height) / 760)); // device px per world unit (game.js resize())
  const p = st.state.player;
  const lamp = [width * dpr / 2 - p.x * px, height * dpr / 2 - p.y * px];
  await g.close();
  writeFile(path.join(tmp, 'keyart-master.png'), png);
  return { png, lamp, info: st };
}

// Runs inside a blank page: draws one cover on a canvas and returns it as a PNG data URL.
async function composeInPage(spec) {
  const load = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  await Promise.all([document.fonts.load('400 100px "IM Fell English SC"', TITLE_PROBE), document.fonts.load('500 30px "Alegreya Sans"', 'Aa')]);
  if (!document.fonts.check('400 100px "IM Fell English SC"')) throw new Error('title font did not load');
  const master = await load(spec.master);
  const W = spec.w, H = spec.h;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 1. the crop, scaled down in halving steps (sharp, no aliasing): the lighthouse lamp lands at spec.crop.at
  const k = spec.crop.scale; // output px per master px
  const src = master, sw = W / k, sh = H / k;
  let sx = spec.lamp[0] - spec.crop.at[0] * sw, sy = spec.lamp[1] - spec.crop.at[1] * sh;
  sx = Math.max(0, Math.min(master.width - sw, sx));
  sy = Math.max(0, Math.min(master.height - sh, sy));
  let cur = { img: src, x: sx, y: sy, w: sw, h: sh };
  while (cur.w / W > 2) {
    const c2 = document.createElement('canvas');
    c2.width = Math.round(cur.w / 2); c2.height = Math.round(cur.h / 2);
    const x2 = c2.getContext('2d');
    x2.imageSmoothingQuality = 'high';
    x2.drawImage(cur.img, cur.x, cur.y, cur.w, cur.h, 0, 0, c2.width, c2.height);
    cur = { img: c2, x: 0, y: 0, w: c2.width, h: c2.height };
  }
  ctx.filter = 'contrast(1.12) saturate(1.12)';
  ctx.drawImage(cur.img, cur.x, cur.y, cur.w, cur.h, 0, 0, W, H);
  ctx.filter = 'none';
  const base = document.createElement('canvas');
  base.width = W; base.height = H;
  base.getContext('2d').drawImage(cv, 0, 0);
  const u = Math.min(W, H) / 800; // layout unit

  // 2. bloom: a blurred copy of the bright parts, added on top
  if (spec.bloom) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = spec.bloom;
    ctx.filter = `blur(${Math.round(14 * u)}px) brightness(1.15)`;
    ctx.drawImage(base, 0, 0);
    ctx.restore();
  }
  // 3. a cool, deep night grade and a vignette toward the corners
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgb(214, 226, 236)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const vg = ctx.createRadialGradient(W * spec.focus[0], H * spec.focus[1], Math.min(W, H) * 0.25, W * spec.focus[0], H * spec.focus[1], Math.hypot(W, H) * 0.62);
  vg.addColorStop(0, 'rgba(3, 8, 14, 0)');
  vg.addColorStop(1, `rgba(3, 8, 14, ${spec.vignette})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  if (spec.dim) {
    ctx.fillStyle = `rgba(4, 10, 18, ${spec.dim})`;
    ctx.fillRect(0, 0, W, H);
  }

  // 4. the title: the game's display face, parchment with the lantern's glow over a soft dark scrim
  const T = spec.title;
  if (T) {
    const lines = T.lines;
    const size = T.size;
    const font = px => `400 ${px}px "IM Fell English SC"`;
    ctx.font = font(size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const lh = size * T.leading;
    const widths = lines.map(l => ctx.measureText(l).width);
    const blockW = Math.max(...widths);
    const cx = W * T.x, top = H * T.y; // top = baseline of the first line
    const blockH = lh * (lines.length - 1) + size * 0.75;
    // scrim: a soft dark ellipse behind the lines
    const scx = cx, scy = top - size * 0.36 + blockH / 2;
    const rx = blockW * 0.62 + size * 0.4, ry = blockH / 2 + size * 0.75;
    ctx.save();
    ctx.translate(scx, scy);
    ctx.scale(1, ry / rx);
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    sg.addColorStop(0, `rgba(3, 9, 16, ${T.scrim})`);
    sg.addColorStop(0.55, `rgba(3, 9, 16, ${T.scrim * 0.7})`);
    sg.addColorStop(1, 'rgba(3, 9, 16, 0)');
    ctx.fillStyle = sg;
    ctx.fillRect(-rx, -rx, 2 * rx, 2 * rx);
    ctx.restore();
    const s = size / 77; // the title screen's 4.8rem title is the reference for the glow
    const each = fn => lines.forEach((l, i) => fn(l, cx, top + i * lh));
    const pass = (color, blur, dx, dy, fill) => {
      ctx.save();
      ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.shadowOffsetX = dx; ctx.shadowOffsetY = dy;
      ctx.fillStyle = fill;
      each((l, x, y) => ctx.fillText(l, x, y));
      ctx.restore();
    };
    pass('rgba(0, 0, 0, 0.85)', 10 * s, 0, 4 * s, '#fff3dc');
    pass('rgba(255, 122, 61, 0.5)', 60 * s, 0, 0, '#fff3dc');
    pass('rgba(255, 181, 71, 0.65)', 20 * s, 0, 0, '#fff3dc');
    ctx.save();
    ctx.lineWidth = Math.max(1, 1.2 * s);
    ctx.strokeStyle = 'rgba(40, 20, 8, 0.35)';
    each((l, x, y) => ctx.strokeText(l, x, y));
    ctx.restore();
    pass('rgba(0, 0, 0, 0)', 0, 0, 0, '#fff3dc');
    if (T.sub) {
      ctx.save();
      ctx.font = `500 ${T.sub.size}px "Alegreya Sans"`;
      ctx.fillStyle = '#ffb547';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)'; ctx.shadowBlur = 6 * s; ctx.shadowOffsetY = 2 * s;
      ctx.fillText(T.sub.text, cx, top + (lines.length - 1) * lh + T.sub.gap);
      ctx.restore();
    }
  }
  return cv.toDataURL('image/png');
}

// One composition page for all covers (fonts embedded as data URLs: nothing is fetched).
async function openComposer(browser) {
  const context = await browser.newContext({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
  await blockNetwork(context);
  const page = await context.newPage();
  const b64 = f => fs.readFileSync(f).toString('base64');
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: "IM Fell English SC"; font-weight: 400; src: url(data:font/woff2;base64,${b64(FONT_TITLE)}) format("woff2"); }
    @font-face { font-family: "Alegreya Sans"; font-weight: 500; src: url(data:font/woff2;base64,${b64(FONT_BODY)}) format("woff2"); }
    body { margin: 0; background: #06121c; }</style><body></body>`);
  await page.addScriptTag({ content: `const TITLE_PROBE = ${JSON.stringify(TITLE)};\nwindow.composeInPage = ${composeInPage.toString()};` });
  return {
    async compose(spec, masterPng) {
      const url = await page.evaluate(s => window.composeInPage(s), Object.assign({}, spec, { master: 'data:image/png;base64,' + masterPng.toString('base64') }));
      return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    },
    close: () => context.close(),
  };
}

// Cover layouts. crop.scale: cover px per master px; crop.at: where the lighthouse lamp lands (0-1 of the cover);
// focus: vignette centre (0-1); title: lines, size (px), x (0-1, centre), y (0-1, first baseline), leading, scrim.
function coverSpec(w, h, kind) {
  const titleLines = w / h > 1.5 ? [TITLE] : ['Fourteen', 'Tides'];
  const base = { w, h, bloom: 0.38, vignette: 0.8, focus: [0.5, 0.6] };
  const r = h / 1200; // the portrait cover is also drawn at 1080x1620 for its video
  switch (kind) {
    case 'landscape': return Object.assign(base, {
      crop: { scale: 0.7, at: [0.36, 0.53] },
      title: { lines: titleLines, size: 200, x: 0.5, y: 0.215, leading: 1, scrim: 0.62 },
    });
    case 'square': return Object.assign(base, {
      crop: { scale: 0.46, at: [0.4, 0.62] },
      title: { lines: titleLines, size: 152, x: 0.5, y: 0.2, leading: 0.9, scrim: 0.66 },
    });
    case 'portrait': return Object.assign(base, {
      crop: { scale: 0.47 * r, at: [0.38, 0.42] },
      title: { lines: titleLines, size: 170 * r, x: 0.5, y: 0.155, leading: 0.9, scrim: 0.66 },
    });
    case 'itch': return Object.assign(base, {
      crop: { scale: 0.34, at: [0.36, 0.68] },
      title: { lines: titleLines, size: 112, x: 0.5, y: 0.235, leading: 0.9, scrim: 0.66, sub: { text: SUBTITLE, size: 21, gap: 42 } },
    });
    case 'embed': return Object.assign(base, {
      crop: { scale: 0.4, at: [0.36, 0.55] }, vignette: 0.9, dim: 0.36, title: null,
    });
    default: throw new Error('cover kind ' + kind);
  }
}

async function makeCovers(browser, out, tmp) {
  const { png, lamp, info } = await renderKeyArtMaster(browser, tmp);
  console.log(`  key art: night ${info.night}, ${info.state.enemies} creatures, boss ${info.state.bossAlive ? 'on' : 'off'}`);
  const comp = await openComposer(browser);
  const made = {};
  const jobs = [
    ['landscape', 1920, 1080, C + 'cover-landscape-1920x1080.png'],
    ['portrait', 800, 1200, C + 'cover-portrait-800x1200.png'],
    ['square', 800, 800, C + 'cover-square-800x800.png'],
    ['itch', 630, 500, I + 'cover-630x500.png'],
    ['embed', 960, 540, I + 'embed-background-960x540.png'],
    ['portrait', 1080, 1620, null], // the portrait video's first frame (same layout as the 800x1200 cover)
  ];
  for (const [kind, w, h, file] of jobs) {
    const buf = await comp.compose(Object.assign(coverSpec(w, h, kind), { lamp }), png);
    const dest = file ? path.join(out, file) : path.join(tmp, `cover-${kind}-${w}x${h}.png`);
    savePng(dest, buf);
    made[`${kind}-${w}x${h}`] = dest;
  }
  await comp.close();
  return made;
}

// ---------------------------------------------------------------- screenshots

// 1280x720 CSS at 1.5x = 1920x1080: the world framed as on a 1080p screen (same world units per pixel as
// 1920x1080 at 1x), with the HUD at a size that stays readable in store thumbnails.
const LANDSCAPE = { width: 1280, height: 720, dpr: 1.5 };
const PHONE = { width: 390, height: 844, dpr: 2, touch: true };
// the build a warmed-up run grows into: anchors and the Fresnel lens first, then the harpoon
const PICKS = ['anchors', 'beam', 'harpoon', 'spark', 'boots', 'hull', 'regen', 'magnet', 'powder', 'hourglass', 'aura', 'wick', 'tea', 'coin'];
// the boss well inside the picture (fractions of the half-view), done rising from the sea
const bossInView = (fx, fy) => `v.boss && !v.boss.emerging && Math.abs(v.boss.x - v.player.x) < v.viewHalf.x * ${fx} && Math.abs(v.boss.y - v.player.y) < v.viewHalf.y * ${fy}`;
// the lighthouse in the picture
const LIGHTHOUSE_IN_VIEW = 'Math.abs(v.player.x) < v.viewHalf.x * 0.75 && Math.abs(v.player.y) < v.viewHalf.y * 0.7';
const NO_SLAM = "!v.telegraphs.some(t => t.kind === 'slam')";
// at least n creatures well inside the picture
const crowd = n => `v.enemies.filter(e => Math.abs(e.x - v.player.x) < v.viewHalf.x * 0.8 && Math.abs(e.y - v.player.y) < v.viewHalf.y * 0.8).length >= ${n}`;
// the night timer is not in its last 12 s (it turns red)
const CALM_TIMER = 'v.nightT < v.nightDur - 12';
const LEVELUP_OFFERS = ['harpoon', 'magnet', 'powder', 'hourglass', 'regen', 'boots', 'hull'];
const LEVELUP = { seed: 7, night: 9, at: 18, picks: PICKS };

// Moments picked by eye from seeded runs (`at`: seconds into the night). `until` only guards them: if the game ever
// plays differently, the picture moves forward to the next moment that still shows what it promises.
const SHOTS = [
  { file: S + 'en/01-early-night-1920x1080.png', view: LANDSCAPE,
    stage: { seed: 6, night: 3, at: 24.25, picks: PICKS, until: [LIGHTHOUSE_IN_VIEW, crowd(6), CALM_TIMER].join(' && ') } },
  { file: S + 'en/02-mid-game-build-1920x1080.png', view: LANDSCAPE,
    stage: { seed: 5, night: 11, at: 18, picks: PICKS, until: [LIGHTHOUSE_IN_VIEW, crowd(12), 'v.enemies.some(e => e.elite)'].join(' && ') } },
  { file: S + 'en/03-level-up-1920x1080.png', view: LANDSCAPE, stage: LEVELUP, levelUp: LEVELUP_OFFERS },
  { file: S + 'en/04-crab-king-1920x1080.png', view: LANDSCAPE,
    stage: { seed: 4, night: 7, at: 20.5, picks: PICKS, until: bossInView(0.85, 0.8) } },
  { file: S + 'en/05-tide-leviathan-1920x1080.png', view: LANDSCAPE,
    stage: { seed: 6, night: 14, at: 43, picks: PICKS, until: [bossInView(0.85, 0.8), NO_SLAM].join(' && ') } },
  { file: S + 'pt/01-melhoria-1920x1080.png', view: LANDSCAPE, locale: 'pt-BR', stage: LEVELUP, levelUp: LEVELUP_OFFERS },
  { file: S + 'pt/02-caranguejo-rei-1920x1080.png', view: LANDSCAPE, locale: 'pt-BR',
    stage: { seed: 4, night: 7, at: 35.5, picks: PICKS, until: bossInView(0.85, 0.8) } },
  { file: S + 'en/phone-01-joystick-780x1688.png', view: PHONE,
    stage: { seed: 8, night: 10, at: 20, picks: PICKS }, joystick: { from: [205, 640], to: [242, 604], steps: 24 } },
  { file: S + 'en/phone-02-tide-leviathan-780x1688.png', view: PHONE,
    stage: { seed: 6, night: 14, at: 18.5, picks: PICKS, until: bossInView(0.85, 0.8) } },
];

// A finger held on the screen: the floating joystick appears where it lands and the keeper walks where it points.
async function holdJoystick(g, { from, to, steps }) {
  await g.page.evaluate(() => window.QF.debug.setAutopilot(null)); // the bot lets go; the touch input moves the keeper
  const cdp = await g.context.newCDPSession(g.page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1], id: 1 }] });
  for (let i = 1; i <= 4; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / 4, y = from[1] + ((to[1] - from[1]) * i) / 4;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
  }
  await g.page.evaluate(n => { for (let i = 0; i < n; i++) window.QFMedia.frame(); }, steps);
}

async function makeShots(browser, out, which) {
  for (const spec of SHOTS) {
    const asset = ASSETS.find(a => a.file === spec.file);
    if (!which.includes(asset.group)) continue;
    const g = await openGame(browser, Object.assign({ locale: spec.locale || 'en-US' }, spec.view));
    const st = await stage(g.page, spec.stage);
    const want = (spec.locale || 'en-US').startsWith('pt') ? 'pt' : 'en';
    if (st.state.lang !== want) throw new Error(`${spec.file}: the game is in "${st.state.lang}", not "${want}"`);
    let note = `night ${st.night} at ${st.nightT.toFixed(1)} s, level ${st.level}, ${st.state.enemies} creatures`;
    if (spec.levelUp) note += ', cards ' + (await g.page.evaluate(c => window.QFMedia.levelUp(c), spec.levelUp)).offers.join('/');
    if (spec.joystick) await holdJoystick(g, spec.joystick);
    await settle(g.page, 1);
    const buf = await g.page.screenshot({ type: 'png' });
    await g.close();
    savePng(path.join(out, spec.file), buf);
    console.log(`  ${spec.file}: ${note}`);
  }
}

// ---------------------------------------------------------------- preview videos

// Three real-time gameplay segments per video (a swarm with the full build, the Crab King's charge, the Tide
// Leviathan's rings of orbs), each staged like the screenshots and recorded frame by frame at 30 fps.
// The portrait video plays at its own viewport, so its runs (and moments) are its own.
const PORTRAIT = { width: 720, height: 1080, dpr: 1.5 };
const VIDEOS = [
  {
    file: C + 'preview-landscape-1920x1080.mp4', view: LANDSCAPE, cover: 'landscape-1920x1080',
    segments: [
      { seconds: 6, stage: { seed: 5, night: 11, at: 15.5, picks: PICKS } },
      { seconds: 5, stage: { seed: 4, night: 7, at: 18.6, picks: PICKS } },
      { seconds: 6.5, stage: { seed: 6, night: 14, at: 40, picks: PICKS } },
    ],
  },
  {
    file: C + 'preview-portrait-1080x1620.mp4', view: PORTRAIT, cover: 'portrait-1080x1620',
    segments: [
      { seconds: 6, stage: { seed: 5, night: 11, at: 15.5, picks: PICKS } },
      { seconds: 5, stage: { seed: 4, night: 7, at: 7.5, picks: PICKS } },
      { seconds: 6.5, stage: { seed: 6, night: 14, at: 39.5, picks: PICKS } },
    ],
  },
];
const COVER_HOLD = 1.0; // s of still cover
// the screen's sRGB pixels go to video through the HD matrix, and say so (an untagged file may be read either way)
const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const FADE_IN = 0.4; // cover → gameplay
const FADE = 0.3; // between segments

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-2000)}`))));
    if (input) {
      p.stdin.on('error', () => {}); // a failing ffmpeg is reported by its exit code
      input(p.stdin);
    }
  });
}

// One segment: frames (2 simulation steps each) piped as PNG into a near-lossless intermediate.
async function recordSegment(browser, view, seg, file) {
  const g = await openGame(browser, Object.assign({ locale: 'en-US' }, view));
  const st = await stage(g.page, seg.stage);
  await settle(g.page, 1);
  const frames = Math.round(seg.seconds * FPS);
  // CDP's fast PNG encoder: the same pixels as page.screenshot (device pixels through clip.scale), ~5x quicker
  const cdp = await g.context.newCDPSession(g.page);
  const clip = { x: 0, y: 0, width: view.width, height: view.height, scale: view.dpr };
  let feed;
  const done = run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv444p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '6', '-pix_fmt', 'yuv444p',
    ...BT709, file], stdin => { feed = stdin; });
  for (let i = 0; i < frames; i++) {
    if (i) await g.page.evaluate(() => window.QFMedia.frame());
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip });
    if (!feed.write(Buffer.from(data, 'base64'))) await new Promise(r => feed.once('drain', r));
  }
  feed.end();
  await done;
  await g.close();
  return `night ${st.night} ${st.nightT.toFixed(1)}-${(st.nightT + seg.seconds).toFixed(1)} s`;
}

async function makeVideo(browser, out, tmp, spec, coverFile) {
  const parts = [];
  for (const [i, seg] of spec.segments.entries()) {
    const f = path.join(tmp, `${path.basename(spec.file, '.mp4')}-seg${i}.mkv`);
    const note = await recordSegment(browser, spec.view, seg, f);
    console.log(`  ${spec.file} segment ${i + 1}: ${note}`);
    parts.push({ file: f, seconds: seg.seconds });
  }
  // cover (held, then cross-faded into play), then the segments cross-faded into each other
  const coverLen = COVER_HOLD + FADE_IN;
  const args = ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', String(FPS), '-t', String(coverLen), '-i', coverFile];
  for (const p of parts) args.push('-i', p.file);
  const norm = (i, label) => `[${i}:v]format=yuv420p,setsar=1,fps=${FPS},settb=AVTB[${label}]`;
  const graph = [`[0:v]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1,fps=${FPS},settb=AVTB[c]`];
  parts.forEach((_, i) => graph.push(norm(i + 1, 's' + i)));
  let last = 'c', length = coverLen;
  parts.forEach((p, i) => {
    const fade = i === 0 ? FADE_IN : FADE;
    const label = 'x' + i;
    graph.push(`[${last}][s${i}]xfade=transition=fade:duration=${fade}:offset=${(length - fade).toFixed(4)}[${label}]`);
    length += p.seconds - fade;
    last = label;
  });
  const dest = path.join(out, spec.file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  args.push('-filter_complex', graph.join(';'), '-map', `[${last}]`, '-an',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-maxrate', '2200k', '-bufsize', '4400k',
    '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', ...BT709, '-r', String(FPS), '-movflags', '+faststart', dest);
  await run('ffmpeg', args);
  return length;
}

// both videos at once (two pages: the machine's browser budget)
async function makeVideos(browser, out, tmp, covers) {
  await Promise.all(VIDEOS.map(async spec => {
    const length = await makeVideo(browser, out, tmp, spec, covers[spec.cover]);
    console.log(`  ${spec.file}: ${length.toFixed(2)} s`);
  }));
}

// ---------------------------------------------------------------- checks

const PNG_MAX = 2.5 * 1024 * 1024;
const VIDEO_MAX = 50 * 1024 * 1024;

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('latin1', 12, 16) !== 'IHDR') throw new Error('not a PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

// top-level MP4 boxes, in file order
function mp4Boxes(file) {
  const b = fs.readFileSync(file), out = [];
  for (let i = 0; i + 8 <= b.length;) {
    let size = b.readUInt32BE(i);
    const type = b.toString('latin1', i + 4, i + 8);
    if (size === 1) size = Number(b.readBigUInt64BE(i + 8));
    else if (size === 0) size = b.length - i;
    if (size < 8) break;
    out.push(type);
    i += size;
  }
  return out;
}

// Every asset of the groups made: exact pixel size, and for the videos the CrazyGames rules (H.264 yuv420p, no audio
// track, 15-20 s, at most 50 MB, moov before mdat = fast start).
function verify(out, groups) {
  const rows = [], problems = [];
  let total = 0;
  for (const a of ASSETS.filter(x => groups.includes(x.group))) {
    const file = path.join(out, a.file);
    const bad = msg => problems.push(`${a.file}: ${msg}`);
    if (!fs.existsSync(file)) { bad('missing'); continue; }
    const bytes = fs.statSync(file).size;
    total += bytes;
    let size = '?', extra = '';
    if (file.endsWith('.png')) {
      const [w, h] = pngSize(file);
      size = `${w}x${h}`;
      if (bytes > PNG_MAX) bad(`${(bytes / 1048576).toFixed(2)} MB, over 2.5 MB`);
    } else {
      const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());
      const video = info.streams.filter(st => st.codec_type === 'video');
      const audio = info.streams.filter(st => st.codec_type === 'audio');
      const v = video[0] || {};
      const dur = Number(info.format.duration);
      size = `${v.width}x${v.height}`;
      extra = `${v.codec_name} ${v.pix_fmt} ${v.r_frame_rate} fps ${dur.toFixed(2)} s`;
      if (video.length !== 1) bad(`${video.length} video streams`);
      if (audio.length) bad('has an audio track');
      if (v.codec_name !== 'h264' || v.pix_fmt !== 'yuv420p') bad(`codec ${v.codec_name} ${v.pix_fmt}`);
      if (!(dur >= 15 && dur <= 20)) bad(`lasts ${dur} s`);
      if (bytes > VIDEO_MAX) bad('over 50 MB');
      const boxes = mp4Boxes(file);
      if (!(boxes.indexOf('moov') >= 0 && boxes.indexOf('moov') < boxes.indexOf('mdat'))) bad('not fast-start (moov after mdat): ' + boxes.join(','));
    }
    if (size !== `${a.w}x${a.h}`) bad(`is ${size}, wants ${a.w}x${a.h}`);
    rows.push([a.file, size, `${Math.round(bytes / 1024)} KB`, extra]);
  }
  const wid = rows.reduce((m, r) => r.map((c, i) => Math.max(m[i] || 0, c.length)), []);
  for (const r of rows) console.log('  ' + r.map((c, i) => (i === 2 ? c.padStart(wid[i]) : c.padEnd(wid[i]))).join('  ').trimEnd());
  console.log(`  ${rows.length} files, ${(total / 1048576).toFixed(1)} MB`);
  return problems;
}

// ---------------------------------------------------------------- main

async function main() {
  const o = parseArgs(process.argv.slice(2));
  for (const bin of ['ffmpeg', 'ffprobe']) {
    try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); } catch { die(bin + ' not found on PATH'); }
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'midia-'));
  const pw = await loadPlaywright();
  const browser = await launchChromium(pw);
  const t0 = Date.now();
  try {
    let covers = null;
    if (o.only.includes('covers') || o.only.includes('videos')) {
      console.log('covers…');
      // the videos open on the covers, so they are (re)made with them
      covers = await makeCovers(browser, o.only.includes('covers') ? o.out : path.join(tmp, 'covers'), tmp);
    }
    if (o.only.includes('shots') || o.only.includes('phone')) {
      console.log('screenshots…');
      await makeShots(browser, o.out, o.only);
    }
    if (o.only.includes('videos')) {
      console.log('videos…');
      await makeVideos(browser, o.out, tmp, covers);
    }
  } finally {
    await browser.close();
    if (!o.keepTemp) fs.rmSync(tmp, { recursive: true, force: true });
    else console.log('temp kept: ' + tmp);
  }
  console.log(`checks (${path.relative(process.cwd(), o.out) || '.'})…`);
  const problems = verify(o.out, o.only);
  for (const p of problems) console.error('  FAIL ' + p);
  console.log(`${problems.length ? 'FAILED' : 'done'} in ${Math.round((Date.now() - t0) / 1000)} s`);
  if (problems.length) process.exitCode = 1;
}

export { ASSETS, KEYART, SHOTS, openGame, stage, settle };

// run only as a script (importing it, e.g. from a test, renders nothing)
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
