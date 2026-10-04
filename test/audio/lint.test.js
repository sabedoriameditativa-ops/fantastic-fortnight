import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = ['client/audio/recipes.js', 'client/audio/music.js'];
const FORBIDDEN = [/new\s+(window\.)?(webkit)?AudioContext/, /\bsetTimeout\s*\(/, /\bsetInterval\s*\(/, /\bMath\.random\s*\(/, /\brequestAnimationFrame\b/, /\bDate\.now\b/];

describe('structural lint of audio recipes', () => {
  for (const f of FILES) {
    test(`${f} never creates contexts, uses timers or Math.random`, () => {
      const src = readFileSync(resolve(ROOT, f), 'utf8');
      for (const re of FORBIDDEN) assert.ok(!re.test(src), `${f} matches ${re}`);
    });
  }
  test('index.js is the only module allowed to create the context, and does it once', () => {
    const src = readFileSync(resolve(ROOT, 'client/audio/index.js'), 'utf8');
    assert.equal((src.match(/new\s+AC\(/g) || []).length, 2, 'one construction site (with fallback)');
    assert.ok(!/Math\.random/.test(src));
  });
  test('UI text in pt-BR only: no English user strings in audio modules', () => {
    for (const f of [...FILES, 'client/audio/index.js']) {
      const src = readFileSync(resolve(ROOT, f), 'utf8');
      assert.ok(!/alert\(|innerHTML/.test(src), `${f} touches the DOM`);
    }
  });
});
