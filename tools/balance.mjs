// Balance harness for Quinzena Fantástica (dev tool; the game never loads it).
// Plays whole runs headless through the debug hooks (QF.debug.runSteps / setAutopilot / setPicker / stats), many
// times faster than real time, with seeded randomness, and writes per-run telemetry as JSON.
//
//   node tools/balance.mjs --bot kite --picks random --runs 10 --out /tmp/kite-random.json
//   node tools/balance.mjs --bot kite --picks beamFirst --tune '{"WEAPONS.beam.dpsPerLevel": 6}' --runs 20
//   node tools/balance-summary.mjs /tmp/*.json          (markdown tables + balance-target checks)
//
// Run with --help for every option.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { renderMarkdown } from './balance-summary.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const BOTS = path.join(HERE, 'balance-bots.js');
// kept in step with AUTOPILOTS / PICKS in balance-bots.js
const BOT_NAMES = ['idle', 'circle', 'kite', 'skilled'];
const PICK_NAMES = ['random', 'weapons', 'passives', 'noBeam', 'beamFirst', 'sparkFirst', 'auraFirst', 'harpoonFirst', 'anchorsFirst'];

const HELP = `Usage: node tools/balance.mjs [options]
  --root <dir>          folder holding the game's index.html (default: this repo)
  --bot <name>          idle | circle | kite | skilled (default: kite)
  --bot-opts <json>     bot options, e.g. '{"react":0.15,"threatR":300}' (see DEFAULTS in tools/balance-bots.js)
  --picks <policy>      random | weapons | passives | noBeam | beamFirst | sparkFirst | auraFirst | harpoonFirst |
                        anchorsFirst (xFirst: always take that weapon or its upgrade when offered, else random)
                        (default: random)
  --runs <N>            number of runs (default: 10)
  --seed-base <K>       run i uses seed K + i (default: 1)
  --tune <file|json>    dotted-path overrides of QF.debug.getConfig(), e.g. {"WEAPONS.beam.dpsPerLevel": 6};
                        applied before every run (unknown paths are an error)
  --nights <a-b>        play nights a..b only: nights before a run in god mode (the build grows naturally, no
                        damage taken) and are left out of the summary; the run stops after night b (default: 1-14)
  --concurrency <C>     pages in parallel (default: 2)
  --viewport <WxH>      browser viewport; spawn distances depend on it (default: 1280x800)
  --label <name>        arm name in the output (default: bot/picks[ @tune])
  --max-sim <s>         cap on simulated seconds per run (default: 3600) → result "timeout"
  --max-night <s>       cap on one night, e.g. an endless boss fight (default: 600) → result "stalled"
  --out <file.json>     write {meta, runs} here
  --quiet               no per-run lines`;

// ------------------------------------------------------------------ args

function parseArgs(argv) {
  const o = {
    root: REPO, bot: 'kite', botOpts: null, picks: 'random', runs: 10, seedBase: 1, tune: null, tuneName: 'none',
    nights: [1, 14], concurrency: 2, viewport: [1280, 800], label: null, maxSim: 3600, maxNight: 600, out: null, quiet: false,
  };
  const json = (v, what) => {
    try { return JSON.parse(v.trim().startsWith('{') ? v : fs.readFileSync(v, 'utf8')); } catch (e) { die('bad ' + what + ': ' + e.message); }
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => { if (i + 1 >= argv.length) die('missing value for ' + a); return argv[++i]; };
    switch (a) {
      case '--root': o.root = path.resolve(v()); break;
      case '--bot': o.bot = v(); break;
      case '--bot-opts': o.botOpts = json(v(), '--bot-opts'); break;
      case '--picks': o.picks = v(); break;
      case '--runs': o.runs = Math.max(1, parseInt(v(), 10) || 1); break;
      case '--seed-base': o.seedBase = parseInt(v(), 10) || 0; break;
      case '--tune': {
        const t = v();
        o.tune = json(t, '--tune');
        o.tuneName = t.trim().startsWith('{') ? 'inline' : path.basename(t).replace(/\.json$/, '');
        break;
      }
      case '--nights': {
        const m = /^(\d+)(?:-(\d+))?$/.exec(v());
        if (!m) die('--nights wants a-b, e.g. 1-7');
        o.nights = [Number(m[1]), Number(m[2] || m[1])];
        if (o.nights[0] < 1 || o.nights[1] > 14 || o.nights[0] > o.nights[1]) die('--nights must be within 1-14');
        break;
      }
      case '--concurrency': o.concurrency = Math.max(1, parseInt(v(), 10) || 1); break;
      case '--viewport': {
        const m = /^(\d+)x(\d+)$/.exec(v());
        if (!m) die('--viewport wants WxH');
        o.viewport = [Number(m[1]), Number(m[2])];
        break;
      }
      case '--label': o.label = v(); break;
      case '--max-sim': o.maxSim = Number(v()) || o.maxSim; break;
      case '--max-night': o.maxNight = Number(v()) || o.maxNight; break;
      case '--out': o.out = path.resolve(v()); break;
      case '--quiet': o.quiet = true; break;
      case '-h': case '--help': console.log(HELP); process.exit(0); break;
      default: die('unknown option ' + a + '\n\n' + HELP);
    }
  }
  if (!fs.existsSync(path.join(o.root, 'index.html'))) die('no index.html in ' + o.root);
  if (BOT_NAMES.indexOf(o.bot) < 0) die('unknown bot ' + o.bot + ' (use ' + BOT_NAMES.join(', ') + ')');
  if (PICK_NAMES.indexOf(o.picks) < 0) die('unknown pick policy ' + o.picks + ' (use ' + PICK_NAMES.join(', ') + ')');
  return o;
}

function die(msg) {
  console.error('balance: ' + msg);
  process.exit(2);
}

// ------------------------------------------------------------------ playwright (local install or global, like tests/smoke.mjs)

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
    if (process.env.CHROMIUM_PATH) return await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
    throw err;
  }
}

async function openPage(browser, o, errors) {
  const ctx = await browser.newContext({ viewport: { width: o.viewport[0], height: o.viewport[1] } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String((e && e.stack) || e)));
  // only the local files: no web fonts (they would slow loading down and change nothing in the simulation)
  await page.route('**/*', r => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  await page.goto(pathToFileURL(path.join(o.root, 'index.html')).href + '#debug');
  await page.waitForFunction(() => window.QF && window.QF.debug && window.QF.debug.runSteps, null, { timeout: 10000 });
  await page.addScriptTag({ path: BOTS });
  return { ctx, page };
}

// ------------------------------------------------------------------ main

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const pw = await loadPlaywright();
  const browser = await launch(pw);
  const errors = [];
  const meta = {
    bot: o.bot, botOpts: o.botOpts, picks: o.picks, runs: o.runs, seedBase: o.seedBase, nights: o.nights,
    tune: o.tune, tuneName: o.tuneName, viewport: o.viewport, root: o.root, label: o.label,
    date: new Date().toISOString(),
  };
  try { meta.git = execSync('git -C ' + JSON.stringify(o.root) + ' rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a repo */ }
  try { meta.gitDirty = execSync('git -C ' + JSON.stringify(o.root) + ' status --porcelain -- game.js', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== ''; } catch { /* not a repo */ }

  if (o.tune) {
    // check the overrides once, so a typo is one clear error instead of N failed runs
    const pg = await openPage(browser, o, errors);
    try {
      meta.tuneApplied = await pg.page.evaluate(t => window.QFBalance.applyTune(t), o.tune);
    } catch (e) {
      await browser.close();
      die(String((e && e.message) || e).split('\n')[0].replace(/^.*?Error: /, ''));
    }
    await pg.ctx.close();
  }

  const runs = new Array(o.runs);
  let next = 0, done = 0;
  const t0 = Date.now();
  async function worker() {
    let pg = null;
    while (next < o.runs) {
      const i = next++;
      const seed = o.seedBase + i;
      const cfg = { bot: o.bot, botOpts: o.botOpts, picks: o.picks, seed, nights: o.nights, maxSim: o.maxSim, maxNight: o.maxNight };
      const w0 = Date.now();
      try {
        // a fresh page per run: the tune is applied to pristine tables and nothing leaks between runs
        pg = await openPage(browser, o, errors);
        if (o.tune) await pg.page.evaluate(t => window.QFBalance.applyTune(t), o.tune);
        runs[i] = await pg.page.evaluate(c => window.QFBalance.run(c), cfg);
        runs[i].wallMs = Date.now() - w0;
      } catch (e) {
        runs[i] = { seed, error: String((e && e.message) || e).split('\n')[0] };
      }
      if (pg) { await pg.ctx.close().catch(() => {}); pg = null; }
      done++;
      if (!o.quiet) {
        const r = runs[i];
        const line = r.error ? 'ERROR ' + r.error
          : r.result.padEnd(7) + ' night ' + String(r.endNight).padStart(2) + '  level ' + String(r.level).padStart(2) +
            '  sim ' + Math.round(r.now.time) + ' s  page ' + (r.realMs / 1000).toFixed(1) + ' s';
        console.log('[' + String(done).padStart(String(o.runs).length) + '/' + o.runs + '] seed ' + seed + '  ' + line);
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(o.concurrency, o.runs) }, worker));
  } finally {
    await browser.close();
  }
  meta.wallSeconds = Math.round((Date.now() - t0) / 100) / 10;
  if (errors.length) {
    meta.pageErrors = errors.slice(0, 20);
    console.error('page errors:\n  ' + errors.slice(0, 5).join('\n  '));
  }
  const result = { meta, runs };
  if (o.out) {
    fs.mkdirSync(path.dirname(o.out), { recursive: true });
    fs.writeFileSync(o.out, JSON.stringify(result));
    console.log('wrote ' + o.out);
  }
  const key = o.label || o.bot + '/' + o.picks + (o.tuneName !== 'none' ? ' @' + o.tuneName : '');
  console.log('\n' + renderMarkdown(new Map([[key, { meta, runs }]]), { targets: false }));
  console.log('\n' + o.runs + ' runs in ' + meta.wallSeconds + ' s wall (concurrency ' + o.concurrency + ')');
  if (errors.length || runs.some(r => r.error)) process.exitCode = 1;
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
