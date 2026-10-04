// Shared bits for the browser tests: Playwright resolution, the network guard, error capture and PASS/FAIL output.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Playwright from this project if installed, else the global install. Never downloads a browser.
export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    try {
      const req = createRequire(execSync('npm root -g').toString().trim() + '/');
      return req('playwright');
    } catch (err) {
      throw new Error('Playwright not found (neither in node_modules nor installed globally): ' + err.message);
    }
  }
}

// Headless Chromium; CHROMIUM_PATH points at another build if the bundled one is missing.
export async function launchChromium(pw) {
  const chromium = pw.chromium || (pw.default && pw.default.chromium);
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    if (process.env.CHROMIUM_PATH) return chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
    throw err;
  }
}

// The game must never touch the network. Every request of the context (pages and iframes) that is not file:,
// data: or blob: (or one of the allowed origins, for a page served over HTTP) is aborted and recorded in `blocked`
// (returned; pass one array to collect several contexts).
export async function blockNetwork(context, { allowOrigins = [], blocked = [] } = {}) {
  const ok = url => /^(file|data|blob):/.test(url) || allowOrigins.some(o => url.startsWith(o + '/'));
  context.on('request', req => { if (!ok(req.url())) blocked.push(req.url()); });
  await context.route('**/*', route => (ok(route.request().url()) ? route.continue() : route.abort()));
  return blocked;
}

// console.error and uncaught exceptions of a page go into sink, labelled.
export function watchErrors(page, label, sink) {
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const loc = (msg.location && msg.location() && msg.location().url) || '';
    sink.push(`[${label}] console.error: ${msg.text()}${loc ? ' @ ' + loc : ''}`);
  });
  page.on('pageerror', err => sink.push(`[${label}] pageerror: ${(err && err.stack) || err}`));
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// PASS/FAIL lines, a summary table and the exit code.
//   const rep = createReport('Language');
//   await rep.step('1. something', async () => { assert(...); return 'detail'; });
//   rep.finish();   // exits 1 if any step failed
export function createReport(title) {
  const results = [];
  console.log(`\n=== ${title} ===`);
  const record = (name, ok, detail) => {
    results.push({ name, ok, detail: detail || '' });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  };
  return {
    record,
    async step(name, fn) {
      try {
        const r = await fn();
        if (r === false) record(name, false);
        else record(name, true, typeof r === 'string' ? r : '');
      } catch (err) {
        record(name, false, String((err && err.message) || err).split('\n')[0]);
      }
    },
    get failed() { return results.filter(r => !r.ok).length; },
    finish(extra) {
      const w = Math.max(...results.map(r => r.name.length), 10);
      console.log('\n' + '─'.repeat(w + 12));
      console.log('Result  | Step');
      console.log('─'.repeat(w + 12));
      for (const r of results) console.log(`${r.ok ? 'PASS  ' : 'FAIL  '}  | ${r.name}`);
      console.log('─'.repeat(w + 12));
      const failed = results.filter(r => !r.ok).length;
      console.log(`${title}: ${results.length - failed}/${results.length} passed${extra ? ' · ' + extra : ''}`);
      process.exit(failed || !results.length ? 1 : 0);
    },
  };
}

// The game's three font faces, as they must load from fonts/ (never from a font service).
export const GAME_FONTS = [['Alegreya Sans', '500'], ['Alegreya Sans', '700'], ['IM Fell English SC', '400']];

// Loads the game's faces in the page and reports them: every FontFace with its status, and canvas text widths with
// each font next to its generic fallback (equal widths would mean the canvas fell back).
export const fontReport = page => page.evaluate(async fonts => {
  await document.fonts.ready;
  await Promise.all(fonts.map(([family, weight]) => document.fonts.load(`${weight} 16px "${family}"`, 'Aa').catch(() => null)));
  const faces = [...document.fonts].map(f => ({ family: f.family.replace(/["']/g, ''), weight: String(f.weight), status: f.status }));
  const ctx = document.createElement('canvas').getContext('2d');
  const width = font => { ctx.font = font; return Math.round(ctx.measureText('Quinzena Fantástica 12,840').width * 10) / 10; };
  const canvas = fonts.map(([family, weight]) => {
    const generic = family === 'IM Fell English SC' ? 'serif' : 'sans-serif';
    return { family, weight, own: width(`${weight} 40px "${family}", ${generic}`), fallback: width(`${weight} 40px ${generic}`) };
  });
  return { faces, canvas };
}, GAME_FONTS);

// Throws unless each game face loaded (and none failed) and the canvas draws with it.
export function checkFonts(report) {
  for (const [family, weight] of GAME_FONTS) {
    const mine = report.faces.filter(f => f.family === family && f.weight === weight);
    assert(mine.length, `no @font-face for ${family} ${weight}`);
    assert(mine.some(f => f.status === 'loaded'), `${family} ${weight} not loaded: ${mine.map(f => f.status).join(', ')}`);
  }
  const failed = report.faces.filter(f => f.status === 'error');
  assert(!failed.length, 'font faces failed: ' + failed.map(f => `${f.family} ${f.weight}`).join(', '));
  for (const c of report.canvas) assert(c.own !== c.fallback, `canvas ${c.family} ${c.weight} measures like ${c.fallback} (fallback font)`);
  return report.canvas.map(c => `${c.family} ${c.weight} ${c.own}px vs fallback ${c.fallback}px`).join('; ');
}
