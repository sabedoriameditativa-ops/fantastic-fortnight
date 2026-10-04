// Release package for Quinzena Fantástica (dev tool; the game never loads it).
// Writes dist/quinzena-fantastica.zip with ONLY the files the game needs (index.html at the ZIP root), for
// itch.io / CrazyGames uploads. Zero dependencies: the ZIP is written by hand with node:zlib (raw deflate) and a
// CRC-32 table. Deterministic: entries sorted by path, fixed timestamps and permissions, so the same files always
// give the same bytes (with the same Node/zlib).
//
//   npm run pacote                       (= node tools/pacote.mjs)
//   node tools/pacote.mjs --out /tmp/x.zip
//
// Before writing, it validates the game: every src/href/url() in index.html and style.css must be relative and point
// to a file that goes into the ZIP, and the shipped HTML/CSS/JS must not reference http:, https: or // resources
// (comments are ignored). After writing, it reads the ZIP back and checks every entry byte for byte.
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
export const ZIP_NAME = 'quinzena-fantastica.zip';

// What ships. Root files are required; asset dirs are listed explicitly, each with the file names it may contain
// (anything else in them is left out and reported). A new asset folder must be added here.
export const ROOT_FILES = ['index.html', 'style.css', 'game.js'];
export const ASSET_DIRS = [
  { dir: 'fonts', include: [/^[a-z0-9-]+\.woff2$/, /^OFL-[A-Za-z0-9]+\.txt$/] },
];
// Never shipped, whatever the lists above say (belt and braces).
const FORBIDDEN = [/^tests\//, /^tools\//, /^dist\//, /^publicacao\//, /^node_modules\//, /(^|\/)\.git/,
  /^README\.md$/i, /^PUBLICACAO\.md$/i, /^package(-lock)?\.json$/];
// XML namespace URIs are names, not downloads.
const NAMESPACES = ['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xhtml', 'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace'];

const HELP = `Usage: node tools/pacote.mjs [options]
  --root <dir>   folder holding the game (default: this repo)
  --out <file>   ZIP to write (default: <root>/dist/${ZIP_NAME})
  --help         this text`;

// ---------------------------------------------------------------- file set

export function collectFiles(root) {
  const files = [];
  const skipped = [];
  for (const f of ROOT_FILES) {
    if (!fs.statSync(path.join(root, f), { throwIfNoEntry: false })?.isFile()) throw new Error(`missing ${f}`);
    files.push(f);
  }
  for (const { dir, include } of ASSET_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.statSync(abs, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`missing folder ${dir}/`);
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = dir + '/' + ent.name;
      if (ent.isFile() && include.some(re => re.test(ent.name))) files.push(rel);
      else skipped.push(rel + (ent.isDirectory() ? '/' : ''));
    }
  }
  files.sort(byPath);
  for (const f of files) {
    if (FORBIDDEN.some(re => re.test(f))) throw new Error(`forbidden file in package: ${f}`);
    if (fs.statSync(path.join(root, f)).size === 0) throw new Error(`empty file: ${f}`);
  }
  return { files, skipped: skipped.sort(byPath) };
}

const byPath = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- comment stripping (keeps offsets and newlines)

const blank = s => s.replace(/[^\n]/g, ' ');

export function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?(-->|$)/g, blank);
}

export function stripCssComments(src) {
  let out = '';
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const j = scanQuoted(src, i);
      out += src.slice(i, j); i = j;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end < 0 ? src.length : end + 2;
      out += blank(src.slice(i, j)); i = j;
    } else { out += c; i++; }
  }
  return out;
}

function scanQuoted(src, i) { // i at the opening quote; returns the index after the closing one
  const q = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== q && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
  return Math.min(j + 1, src.length);
}

const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await']);

// Small JS lexer: strings, template literals (with nested ${…}), regex literals and comments. Comments become spaces;
// everything else is kept, so string contents can still be checked.
export function stripJsComments(src) {
  let out = '';
  let last = ''; // last significant token: a word, or one punctuation char
  const braces = []; // 'b' for a plain {, 't' for a template ${
  let i = 0;
  const n = src.length;
  const template = () => { // i just after ` or after the } closing a ${…}
    while (i < n) {
      const c = src[i];
      if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { out += c; i++; last = '`'; return; }
      if (c === '$' && src[i + 1] === '{') { out += '${'; i += 2; braces.push('t'); last = '{'; return; }
      out += c; i++;
    }
  };
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const j = scanQuoted(src, i);
      out += src.slice(i, j); i = j; last = '"';
    } else if (c === '`') {
      out += c; i++; template();
    } else if (c === '/' && src[i + 1] === '/') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      out += blank(src.slice(i, j)); i = j;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end < 0 ? n : end + 2;
      out += blank(src.slice(i, j)); i = j;
    } else if (c === '/' && (last === '' || REGEX_AFTER_WORD.has(last) || /^[(,=:[!&|?{};+\-*%<>~^]$/.test(last))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      out += src.slice(i, j); i = j; last = 'regex';
    } else if (c === '{') {
      braces.push('b'); out += c; i++; last = c;
    } else if (c === '}') {
      out += c; i++;
      if (braces.pop() === 't') template();
      else last = c;
    } else if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$.]/.test(src[j])) j++;
      last = src.slice(i, j).replace(/^.*\./, '') || 'x';
      if (/^[0-9]/.test(last) || src[j - 1] === '.') last = 'x';
      out += src.slice(i, j); i = j;
    } else {
      out += c; i++;
      if (!/\s/.test(c)) last = c;
    }
  }
  return out;
}

// ---------------------------------------------------------------- validation

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

function refsInHtml(code) {
  const refs = [];
  const attr = /\s(src|href|srcset|poster|data|action|formaction|background|manifest|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  for (const tag of code.matchAll(/<[a-z][^>]*>/gi)) {
    for (const m of tag[0].matchAll(attr)) {
      const value = (m[2] ?? m[3] ?? m[4] ?? '').trim();
      const list = m[1].toLowerCase() === 'srcset' ? value.split(',').map(s => s.trim().split(/\s+/)[0]) : [value];
      for (const v of list) if (v) refs.push({ value: v, index: tag.index + m.index });
    }
  }
  return refs.concat(refsInCss(code)); // inline style="" and <style> blocks
}

function refsInCss(code) {
  const refs = [];
  for (const m of code.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) {
    refs.push({ value: (m[1] ?? m[2] ?? m[3] ?? '').trim(), index: m.index });
  }
  for (const m of code.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) {
    refs.push({ value: (m[1] ?? m[2]).trim(), index: m.index });
  }
  return refs;
}

// Returns a list of problems (empty = valid).
export function validate(root, files) {
  const problems = [];
  const inZip = new Set(files);
  if (!inZip.has('index.html')) problems.push('index.html is not at the package root');

  const shipped = files.filter(f => /\.(html?|css|m?js)$/i.test(f));
  for (const file of shipped) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const kind = /\.html?$/i.test(file) ? 'html' : /\.css$/i.test(file) ? 'css' : 'js';
    const code = kind === 'html' ? stripHtmlComments(src) : kind === 'css' ? stripCssComments(src) : stripJsComments(src);

    // 1) local references must be relative and inside the package (index.html and style.css, plus any shipped CSS)
    if (kind !== 'js') {
      for (const { value, index } of kind === 'html' ? refsInHtml(code) : refsInCss(code)) {
        const where = `${file}:${lineOf(src, index)}`;
        if (value.startsWith('#') || /^data:/i.test(value)) continue; // in-page anchor / inline data: no request
        if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
          problems.push(`${where}: external reference "${value}"`); continue;
        }
        if (value.startsWith('/') || value.startsWith('\\')) {
          problems.push(`${where}: absolute path "${value}" (must be relative)`); continue;
        }
        let rel;
        try { rel = decodeURI(value.replace(/[?#].*$/, '')); } catch { rel = value; }
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), rel));
        if (target.startsWith('../') || target === '..') {
          problems.push(`${where}: "${value}" points outside the package`); continue;
        }
        if (!inZip.has(target)) problems.push(`${where}: "${value}" -> ${target} is not in the package`);
      }
    }

    // 2) no http(s) URLs anywhere outside comments (XML namespace names excepted)
    for (const m of code.matchAll(/\bhttps?:\/*[^\s"'`<>()]*/gi)) {
      if (NAMESPACES.includes(m[0].replace(/[.,;]+$/, ''))) continue;
      problems.push(`${file}:${lineOf(src, m.index)}: network URL "${m[0].slice(0, 80)}"`);
    }
    // 3) protocol-relative URLs ("//host/…") in JS strings
    if (kind === 'js') {
      for (const m of code.matchAll(/(['"`])\/\/[^\s'"`]/g)) {
        problems.push(`${file}:${lineOf(src, m.index)}: protocol-relative URL ${code.slice(m.index, m.index + 40).split('\n')[0]}`);
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------- ZIP writer / reader

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let k = 0; k < 256; k++) {
    let c = k;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[k] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01, the earliest DOS date: fixed for reproducible builds
const UNIX_FILE_0644 = (0o100644 << 16) >>> 0;

// entries: [{ name, data: Buffer }] -> Buffer (sorted by name; deflate when it saves bytes, else stored)
export function buildZip(entries) {
  const sorted = [...entries].sort((a, b) => byPath(a.name, b.name));
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of sorted) {
    const nameBuf = Buffer.from(name, 'utf8');
    const utf8Flag = /[^\x20-\x7e]/.test(name) ? 0x0800 : 0;
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const method = deflated.length < data.length ? 8 : 0;
    const body = method === 8 ? deflated : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(utf8Flag, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: UNIX, 2.0 (so the 0644 mode below is honoured)
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(utf8Flag, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    // extra length, comment length, disk number start, internal attributes: all 0 (bytes 30..37)
    central.writeUInt32LE(UNIX_FILE_0644, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  if (sorted.length > 0xffff || offset + cd.length > 0xffffffff) throw new Error('package too large for a plain ZIP');
  return Buffer.concat([...locals, cd, end]);
}

// Buffer -> [{ name, method, compressedSize, size, crc, data }] (enough for our own ZIPs; no ZIP64)
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP file (no end of central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry ' + k);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('bad local header for ' + name);
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compressedSize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : method === 0 ? Buffer.from(raw) : null;
    if (!data) throw new Error(`unsupported compression method ${method} for ${name}`);
    if (data.length !== size || crc32(data) !== crc) throw new Error('size/CRC mismatch for ' + name);
    entries.push({ name, method, compressedSize, size, crc, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------------------------------------------------------------- main

export function pacote({ root = REPO, out } = {}) {
  root = path.resolve(root);
  out = path.resolve(out || path.join(root, 'dist', ZIP_NAME));
  const { files, skipped } = collectFiles(root);
  const problems = validate(root, files);
  if (problems.length) {
    const err = new Error('package validation failed:\n  ' + problems.join('\n  '));
    err.problems = problems;
    throw err;
  }
  const entries = files.map(name => ({ name, data: fs.readFileSync(path.join(root, name)) }));
  const zip = buildZip(entries);

  // read it back: same names, same bytes
  const back = readZip(zip);
  if (back.length !== entries.length) throw new Error('read-back entry count mismatch');
  back.forEach((e, k) => {
    if (e.name !== files[k] || !e.data.equals(entries[k].data)) throw new Error('read-back mismatch for ' + files[k]);
  });

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = out + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, zip);
  fs.renameSync(tmp, out);
  return {
    out,
    bytes: zip.length,
    files,
    skipped,
    uncompressed: entries.reduce((s, e) => s + e.data.length, 0),
    entries: back.map(e => ({ name: e.name, size: e.size, compressedSize: e.compressedSize, method: e.method })),
  };
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--root') o.root = val();
    else if (a === '--out') o.out = val();
    else if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else fail(`unknown option ${a} (see --help)`);
  }
  return o;
}

function fail(msg) {
  console.error('pacote: ' + msg);
  process.exit(1);
}

const fmt = n => n.toLocaleString('en-US');

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let r;
  try {
    r = pacote(parseArgs(process.argv.slice(2)));
  } catch (err) {
    fail(err.message);
  }
  const w = Math.max(...r.entries.map(e => e.name.length));
  for (const e of r.entries) {
    console.log(`  ${e.name.padEnd(w)}  ${fmt(e.size).padStart(9)} B  ->  ${fmt(e.compressedSize).padStart(9)} B  ${e.method === 8 ? 'deflate' : 'stored'}`);
  }
  if (r.skipped.length) console.log('left out (not in the asset list): ' + r.skipped.join(', '));
  console.log(`\n${path.relative(process.cwd(), r.out) || r.out}: ${fmt(r.bytes)} bytes (${(r.bytes / 1024).toFixed(1)} KB), ` +
    `${r.files.length} files (${fmt(r.uncompressed)} bytes uncompressed)`);
}
