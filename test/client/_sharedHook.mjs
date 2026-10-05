// Node module resolve hook: maps the browser-absolute '/shared/...' imports used
// by client modules to the repository's shared/ directory so they can be
// unit-tested under node:test. Registered by each test file via
//   register('./_sharedHook.mjs', import.meta.url)
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('/shared/')) return next(pathToFileURL(resolvePath(ROOT, '.' + specifier)).href, context);
  return next(specifier, context);
}
