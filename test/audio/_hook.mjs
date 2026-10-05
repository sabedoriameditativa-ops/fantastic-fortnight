// Node resolve hook mapping the browser-absolute '/shared/...' imports used by
// client/audio to the repository's shared/ directory (same approach as
// test/client/_sharedHook.mjs). Registered by each audio test file.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('/shared/')) return next(pathToFileURL(resolvePath(ROOT, '.' + specifier)).href, context);
  return next(specifier, context);
}
