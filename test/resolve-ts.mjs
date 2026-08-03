import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Vite resolves extensionless relative imports; plain Node does not. Rewriting
 * `./deck` to `./deck.ts` lets the tests import the real sources rather than a
 * bundled copy, so failures point at source line numbers.
 */
export async function resolve(specifier, context, next) {
  if (context.parentURL && specifier.startsWith('.') && !specifier.endsWith('.ts')) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
}
