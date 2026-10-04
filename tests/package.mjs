// Package test: runs tools/pacote.mjs (what `npm run pacote` runs), checks that dist/quinzena-fantastica.zip holds
// exactly the game's files with index.html at the root, then unpacks it and plays the unpacked copy offline.
// Usage: node tests/package.mjs
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { ROOT, loadPlaywright, launchChromium, blockNetwork, watchErrors, assert, sleep, createReport, fontReport, checkFonts } from './helpers.mjs';
import { readZip } from '../tools/pacote.mjs';

const ZIP = path.join(ROOT, 'dist', 'quinzena-fantastica.zip');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-package-'));
const FORBIDDEN = [/^tests\//, /^tools\//, /^dist\//, /^publicacao\//, /^node_modules\//, /(^|\/)\.git/, /^README/i,
  /^PUBLICACAO/i, /^package(-lock)?\.json$/];

// The files the game needs, listed from the repo (not from tools/pacote.mjs, which this checks).
function expectedFiles() {
  const fonts = fs.readdirSync(path.join(ROOT, 'fonts')).filter(f => /\.woff2$/.test(f) || /^OFL-.*\.txt$/.test(f));
  return ['index.html', 'style.css', 'game.js', ...fonts.map(f => 'fonts/' + f)].sort();
}

// Lists and unpacks the ZIP with Python's zipfile (an independent reader, with its CRC check); without python3, with
// the reader in tools/pacote.mjs.
function unpack(zip, dir) {
  const py = `import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
z.extractall(sys.argv[2])
print(json.dumps({"bad": bad, "entries": [[i.filename, i.file_size, i.compress_size] for i in z.infolist()]}))`;
  const r = spawnSync('python3', ['-c', py, zip, dir], { encoding: 'utf8' });
  if (!r.error && r.status === 0) {
    const o = JSON.parse(r.stdout);
    return { reader: 'python3 zipfile', bad: o.bad, entries: o.entries.map(([name, size, packed]) => ({ name, size, packed })) };
  }
  if (r.error && r.error.code !== 'ENOENT') throw r.error;
  if (!r.error) throw new Error('python3 zipfile: ' + (r.stderr || '').trim().split('\n').pop());
  const entries = readZip(fs.readFileSync(zip));
  for (const e of entries) {
    const out = path.join(dir, e.name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.data);
  }
  return { reader: 'tools/pacote.mjs readZip', bad: null, entries: entries.map(e => ({ name: e.name, size: e.size, packed: e.compressedSize })) };
}

const rep = createReport('Package');
const errors = [];
const blocked = [];
let summary = '';
let listing = null;

try {
  await rep.step('1. tools/pacote.mjs builds dist/quinzena-fantastica.zip', async () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'pacote.mjs')], { cwd: ROOT, encoding: 'utf8' });
    process.stdout.write(r.stdout.split('\n').map(l => (l ? '      ' + l : l)).join('\n'));
    assert(r.status === 0, 'exit ' + r.status + ': ' + (r.stderr || '').trim().split('\n').slice(0, 3).join(' | '));
    assert(fs.existsSync(ZIP), 'no ' + ZIP);
    summary = (r.stdout.trim().split('\n').pop() || '').trim();
    return summary;
  });

  await rep.step('2. The ZIP holds exactly the game files, index.html at the root, intact', async () => {
    listing = unpack(ZIP, TMP);
    const names = listing.entries.map(e => e.name);
    const want = expectedFiles();
    assert(listing.bad === null, 'CRC error in ' + listing.bad);
    const extra = names.filter(n => !want.includes(n));
    const missing = want.filter(n => !names.includes(n));
    assert(!extra.length && !missing.length, `extra: ${extra.join(', ') || '-'}; missing: ${missing.join(', ') || '-'}`);
    assert(names.length === new Set(names).size, 'duplicate entries');
    assert(names.includes('index.html'), 'no index.html at the root');
    const odd = names.filter(n => n.startsWith('/') || n.includes('\\') || n.split('/').includes('..') || n.endsWith('/'));
    assert(!odd.length, 'odd paths: ' + odd.join(', '));
    const forbidden = names.filter(n => FORBIDDEN.some(re => re.test(n)));
    assert(!forbidden.length, 'must not ship: ' + forbidden.join(', '));
    for (const n of names) {
      const same = fs.readFileSync(path.join(TMP, n)).equals(fs.readFileSync(path.join(ROOT, n)));
      assert(same, n + ' differs from the repo copy');
    }
    return `${names.length} files (${listing.reader}): ${names.join(', ')}`;
  });

  await rep.step('3. The unpacked copy plays offline (network blocked, fonts from the copy)', async () => {
    assert(listing, 'not unpacked');
    const pw = await loadPlaywright();
    const browser = await launchChromium(pw);
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' });
      await blockNetwork(context, { blocked });
      const requests = [];
      context.on('request', r => requests.push(r.url()));
      const page = await context.newPage();
      watchErrors(page, 'unpacked', errors);
      const base = pathToFileURL(TMP).href + '/';
      await page.goto(base + 'index.html');
      await page.waitForFunction(() => window.QF && !document.getElementById('app').hasAttribute('data-i18n-pending'), null, { timeout: 8000 });
      const fonts = checkFonts(await fontReport(page));
      await page.click('#btn-start');
      const s0 = await page.evaluate(() => window.QF.getState());
      assert(s0.screen === 'playing', 'screen ' + s0.screen);
      await page.keyboard.down('ArrowRight');
      await sleep(800);
      await page.keyboard.up('ArrowRight');
      await sleep(1200);
      const s1 = await page.evaluate(() => window.QF.getState());
      await context.close();
      assert(s1.screen === 'playing' || s1.screen === 'levelup', 'screen ' + s1.screen);
      assert(s1.player.x > s0.player.x + 40, `player x ${s0.player.x.toFixed(0)} → ${s1.player.x.toFixed(0)}`);
      const outside = requests.filter(u => !u.startsWith(base));
      assert(!outside.length, 'loaded from outside the unpacked copy: ' + outside.slice(0, 3).join(' | '));
      return `played ${s1.nightElapsed.toFixed(1)} s, x ${s0.player.x.toFixed(0)} → ${s1.player.x.toFixed(0)}, ${requests.length} requests all inside the copy; ${fonts}`;
    } finally {
      await browser.close();
    }
  });

  await rep.step('4. No console errors, page errors or network requests', async () => {
    assert(!errors.length, errors.length + ' error(s): ' + errors.slice(0, 3).join(' | '));
    assert(!blocked.length, 'requests outside file: ' + blocked.slice(0, 3).join(' | '));
  });
} catch (err) {
  rep.record('Unexpected harness failure', false, String((err && err.message) || err).split('\n')[0]);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
for (const e of errors) console.log('  ' + e);
rep.finish(summary);
