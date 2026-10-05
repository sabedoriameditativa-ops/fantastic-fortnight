import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStaticHandler, safeResolve, mimeFor, MIME_TYPES } from '../../server/static.js';

let root;
let server;
let base;

async function get(p, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(base + p, { method }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('static server', () => {
  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-static-'));
    fs.mkdirSync(path.join(root, 'client', 'screens'), { recursive: true });
    fs.mkdirSync(path.join(root, 'shared', 'sim'), { recursive: true });
    fs.writeFileSync(path.join(root, 'client', 'index.html'), '<!doctype html><title>Frota</title>');
    fs.writeFileSync(path.join(root, 'client', 'styles.css'), 'body{}');
    fs.writeFileSync(path.join(root, 'client', 'app.js'), 'export const a = 1;');
    fs.writeFileSync(path.join(root, 'client', 'icon.svg'), '<svg/>');
    fs.writeFileSync(path.join(root, 'client', 'data.json'), '{"x":1}');
    fs.writeFileSync(path.join(root, 'client', 'favicon.ico'), Buffer.from([0, 0, 1, 0]));
    fs.writeFileSync(path.join(root, 'client', 'screens', 'menu.js'), 'export {};');
    fs.writeFileSync(path.join(root, 'shared', 'constants.js'), 'export const T = 20;');
    fs.writeFileSync(path.join(root, 'shared', 'sim', 'battle.js'), 'export function createBattle() {}');
    fs.writeFileSync(path.join(root, 'secret.txt'), 'top secret');
    const handler = createStaticHandler({
      clientDir: path.join(root, 'client'),
      sharedDir: path.join(root, 'shared'),
      health: () => ({ ok: true, rooms: 3, uptime: 7 }),
    });
    server = http.createServer(handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('/ serves client/index.html with html MIME and no-cache', async () => {
    const r = await get('/');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /^text\/html/);
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.match(r.body, /Frota/);
    const r2 = await get('/index.html');
    assert.equal(r2.status, 200);
  });

  test('MIME types: js, css, svg, json, ico', async () => {
    const cases = [
      ['/app.js', 'text/javascript'],
      ['/screens/menu.js', 'text/javascript'],
      ['/styles.css', 'text/css'],
      ['/icon.svg', 'image/svg+xml'],
      ['/data.json', 'application/json'],
      ['/favicon.ico', 'image/x-icon'],
    ];
    for (const [p, mime] of cases) {
      const r = await get(p);
      assert.equal(r.status, 200, p);
      assert.ok(r.headers['content-type'].startsWith(mime), `${p}: ${r.headers['content-type']}`);
      assert.equal(r.headers['cache-control'], 'no-cache');
    }
    assert.equal(mimeFor('x.unknownext'), 'application/octet-stream');
    assert.equal(MIME_TYPES['.js'], 'text/javascript; charset=utf-8');
  });

  test('/shared/ is served from the shared directory', async () => {
    const r = await get('/shared/constants.js');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /^text\/javascript/);
    assert.equal(r.body, 'export const T = 20;');
    const r2 = await get('/shared/sim/battle.js');
    assert.equal(r2.status, 200);
    assert.match(r2.body, /createBattle/);
  });

  test('missing files and directories → 404', async () => {
    assert.equal((await get('/nope.js')).status, 404);
    assert.equal((await get('/screens')).status, 404);
    assert.equal((await get('/screens/')).status, 404);
    assert.equal((await get('/shared/')).status, 404);
    assert.equal((await get('/shared')).status, 404);
  });

  test('path traversal is blocked', async () => {
    const attempts = [
      '/../secret.txt',
      '/../../secret.txt',
      '/%2e%2e/secret.txt',
      '/%2e%2e%2fsecret.txt',
      '/screens/../../secret.txt',
      '/shared/../secret.txt',
      '/shared/%2e%2e/secret.txt',
      '/shared/sim/../../secret.txt',
      '/..%5csecret.txt',
      '/%00secret.txt',
      '/secret.txt%00.js',
    ];
    for (const p of attempts) {
      const r = await get(p);
      assert.notEqual(r.status, 200, p);
      assert.doesNotMatch(r.body, /top secret/, p);
    }
    // Direct unit checks
    assert.equal(safeResolve(root, '/../secret.txt'), null);
    assert.equal(safeResolve(root, '/a/../../secret.txt'), null);
    assert.equal(safeResolve(root, '/a\\b'), null);
    assert.equal(safeResolve(root, '/a\0b'), null);
    assert.equal(safeResolve(root, '/client/index.html'), path.join(root, 'client', 'index.html'));
  });

  test('/health returns JSON { ok, rooms, uptime }', async () => {
    const r = await get('/health');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /application\/json/);
    assert.deepEqual(JSON.parse(r.body), { ok: true, rooms: 3, uptime: 7 });
  });

  test('HEAD works, other methods → 405', async () => {
    const h = await get('/app.js', 'HEAD');
    assert.equal(h.status, 200);
    assert.equal(h.body, '');
    assert.equal(Number(h.headers['content-length']), 'export const a = 1;'.length);
    assert.equal((await get('/app.js', 'POST')).status, 405);
    assert.equal((await get('/health', 'DELETE')).status, 405);
  });
});
