import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appFiles, runtimeFiles } from '../../tools/build-windows.js';

test('desktop distribution includes verifier and runtime dependency but no profile database, cache or development dependency', () => {
  const files = appFiles();
  for (const file of ['server/desktop.js', 'server/profileVerifier.js', 'client/battle/simWorker.js', 'shared/sim/battle.js', 'node_modules/ws/index.js']) assert.ok(files.includes(file), file);
  assert.ok(files.every(file => !/sqlite|\.env|playwright|test-results|\.git\//.test(file)));
  assert.ok(files.every(file => !file.startsWith('node_modules/') || file.startsWith('node_modules/ws/')));
});

test('desktop packaging refuses corrupted runtime instead of embedding it', () => {
  assert.throws(() => runtimeFiles(Buffer.from('untrusted runtime')), /Checksum SHA256/);
});

test('desktop packaging ignores databases and refuses symlink escape', () => {
  const root = mkdtempSync(join(tmpdir(), 'fe-package-'));
  try {
    for (const dir of ['client', 'shared', 'server', 'node_modules/ws']) mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(join(root, 'server/profiles.sqlite'), 'private');
    writeFileSync(join(root, 'server/.env'), 'private');
    writeFileSync(join(root, 'client/app.js'), 'app');
    assert.deepEqual(appFiles(root), ['client/app.js', 'package.json']);
    // Directory junction is available to ordinary Windows users, unlike symlinks.
    symlinkSync(join(root, 'server'), join(root, 'client/escape'), 'junction');
    assert.throws(() => appFiles(root), /Symlink/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
