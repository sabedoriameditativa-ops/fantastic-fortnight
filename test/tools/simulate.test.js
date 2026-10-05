// tools/simulate.js argument validation: usage errors exit 2 with a message
// instead of silently running the wrong matchup (or zero battles) with exit 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = resolve(dirname(fileURLToPath(import.meta.url)), '../../tools/simulate.js');
const run = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', timeout: 60_000 });

test('unknown --ai profile is rejected (no silent fallback to especialista)', () => {
  const r = run('--a', 'ter_linha', '--b', 'vor_garras', '--ai', 'nope', '--seeds', '1');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /error: --ai must be one of facil, normal, dificil, especialista, got "nope"/);
  assert.match(r.stderr, /Usage:/);
});

test('non-positive or non-numeric --seeds/--budget/--maxTicks are rejected', () => {
  for (const [flag, v] of [['--seeds', 'abc'], ['--seeds', '0'], ['--seeds', '-3'], ['--budget', '0'], ['--maxTicks', '1.5']]) {
    const r = run('--a', 'ter_linha', '--b', 'vor_garras', flag, v);
    assert.equal(r.status, 2, `${flag} ${v}`);
    assert.match(r.stderr, new RegExp(`error: ${flag} must be a positive integer`));
  }
});

test('value-taking flags without a value, unknown flags and unknown presets/classes exit 2', () => {
  let r = run('--a', 'ter_linha', '--b', 'vor_garras', '--dump');
  assert.equal(r.status, 2); assert.match(r.stderr, /--dump needs a value/);
  r = run('--a', 'ter_linha', '--b');
  assert.equal(r.status, 2); assert.match(r.stderr, /--b needs a value/);
  r = run('--a', 'ter_linha', '--b', 'vor_garras', '--bogus');
  assert.equal(r.status, 2); assert.match(r.stderr, /Unknown argument: --bogus/);
  r = run('--a', 'foo', '--b', 'vor_garras', '--seeds', '1');
  assert.equal(r.status, 2); assert.match(r.stderr, /error: Unknown class: foo/); assert.doesNotMatch(r.stderr, /at .*simulate\.js/);
  r = run();
  assert.equal(r.status, 2); assert.match(r.stderr, /choose a mode/);
});

test('--help exits 0 and a valid run exits 0 with a summary', () => {
  assert.equal(run('--help').status, 0);
  const r = run('--a', 'ter_linha', '--b', 'vor_garras', '--seeds', '1', '--ai', 'normal', '--json');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.n, 1);
  assert.equal(out.runs.length, 1);
});
