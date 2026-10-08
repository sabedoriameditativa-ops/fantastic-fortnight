// Static file server: client/ at `/`, shared/ at `/shared/`, `/health`.
// Correct MIME types, `Cache-Control: no-cache`, path traversal blocked.
// See docs/ARCHITECTURE.md §4.1.

import fs from 'node:fs';
import path from 'node:path';

/** Extension → media type. Text types get a UTF-8 charset. */
export const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webmanifest': 'application/manifest+json',
});

/**
 * Media type for a file name (default `application/octet-stream`).
 * @param {string} file
 * @returns {string}
 */
export function mimeFor(file) {
  return MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/**
 * Resolve a URL path inside `root`, refusing anything that escapes it
 * (`..` segments, NUL bytes, absolute paths, backslashes).
 * @param {string} root absolute directory
 * @param {string} urlPath decoded path relative to root (leading `/` optional)
 * @returns {string|null} absolute file path or null when unsafe
 */
export function safeResolve(root, urlPath) {
  if (typeof urlPath !== 'string') return null;
  if (urlPath.includes('\0') || urlPath.includes('\\')) return null;
  const segments = urlPath.split('/');
  for (const seg of segments) {
    if (seg === '..' || seg === '.') return null;
  }
  const rootAbs = path.resolve(root);
  const resolved = path.resolve(rootAbs, '.' + path.posix.normalize('/' + urlPath));
  if (resolved !== rootAbs && !resolved.startsWith(rootAbs + path.sep)) return null;
  return resolved;
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-cache',
  });
  res.end(text);
}

function sendText(res, status, text, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-cache',
    ...extraHeaders,
  });
  res.end(text);
}

/**
 * Create an `(req, res)` handler.
 * @param {Object} o
 * @param {string} o.clientDir   directory served at `/`
 * @param {string} o.sharedDir   directory served at `/shared/`
 * @param {() => object} [o.health]  returns the `/health` JSON body
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => void}
 */
export function createStaticHandler({ clientDir, sharedDir, health = () => ({ ok: true }) }) {
  const clientRoot = path.resolve(clientDir);
  const sharedRoot = path.resolve(sharedDir);

  return function handle(req, res) {
    const method = req.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      return sendText(res, 405, 'Método não permitido', { Allow: 'GET, HEAD' });
    }
    let pathname;
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return sendText(res, 400, 'URL inválida');
    }
    if (pathname === '/health') {
      let body;
      try {
        body = health();
      } catch {
        body = { ok: false };
      }
      return sendJson(res, body.ok === false ? 503 : 200, body);
    }

    let file;
    if (pathname === '/' || pathname === '/index.html') {
      file = path.join(clientRoot, 'index.html');
    } else if (pathname === '/shared' || pathname.startsWith('/shared/')) {
      file = safeResolve(sharedRoot, pathname.slice('/shared'.length) || '/');
    } else {
      file = safeResolve(clientRoot, pathname);
    }
    if (!file) return sendText(res, 404, 'Não encontrado');

    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return sendText(res, 404, 'Não encontrado');
      const headers = {
        'Content-Type': mimeFor(file),
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      };
      if (method === 'HEAD') {
        res.writeHead(200, headers);
        return res.end();
      }
      const stream = fs.createReadStream(file);
      stream.on('open', () => res.writeHead(200, headers));
      stream.on('error', () => {
        if (!res.headersSent) sendText(res, 500, 'Erro ao ler o arquivo');
        else res.destroy();
      });
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    });
  };
}
