// `npm test`: runs every test file in turn (one browser at a time) and ends with a summary.
// Usage: node tests/run-all.mjs [smoke] [language] [iframe] [network] [package]   (default: all)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TESTS = {
  smoke: 'whole game flow on desktop, phone portrait and landscape',
  language: 'browser language, toggle on title and pause, no Portuguese left in English',
  iframe: 'fills a portal iframe; keys, wheel and touch never scroll the host page',
  network: 'no request leaves the game folder; fonts load locally',
  package: 'npm run pacote: exact file set, unpacked copy plays offline',
};

const asked = process.argv.slice(2);
const unknown = asked.filter(n => !(n in TESTS));
if (unknown.length) {
  console.error(`unknown test(s): ${unknown.join(', ')} — choose from ${Object.keys(TESTS).join(', ')}`);
  process.exit(2);
}
const names = asked.length ? asked : Object.keys(TESTS);

const results = [];
let zipLine = '';
for (const name of names) {
  const t0 = Date.now();
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(HERE, name + '.mjs')], { stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      const m = String(chunk).match(/\S*quinzena-fantastica\.zip: [^\n]*files[^\n]*/);
      if (m) zipLine = m[0];
    });
    child.on('error', err => { console.error(err); resolve(1); });
    child.on('close', c => resolve(c === null ? 1 : c));
  });
  results.push({ name, ok: code === 0, secs: Math.round((Date.now() - t0) / 1000) });
}

const w = Math.max(...names.map(n => n.length));
console.log('\n=== npm test ===');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(w)}  ${String(r.secs).padStart(3)} s  ${TESTS[r.name]}`);
if (zipLine) console.log(`\nPackage: ${zipLine}`);
const failed = results.filter(r => !r.ok).map(r => r.name);
console.log(failed.length ? `\n${failed.length} of ${results.length} test files FAILED: ${failed.join(', ')}` : `\nAll ${results.length} test files passed.`);
process.exit(failed.length ? 1 : 0);
