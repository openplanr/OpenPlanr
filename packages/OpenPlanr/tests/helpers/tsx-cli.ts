import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

/**
 * Absolute path to tsx's CLI entrypoint.
 *
 * BL-010: under npm workspaces, tsx is hoisted to the MONOREPO root
 * node_modules, so the old `resolve('node_modules/tsx/dist/cli.mjs')` (cwd-
 * relative, assumes a nested install) no longer finds it. tsx's `exports` map
 * does not expose `./dist/cli.mjs` either, so `require.resolve` on that subpath
 * throws ERR_PACKAGE_PATH_NOT_EXPORTED.
 *
 * `./package.json` IS exported, so resolve that, then read the package's own
 * `bin` field. This works hoisted or nested and survives tsx changing its
 * internal layout.
 */
const require_ = createRequire(import.meta.url);
const manifestPath = require_.resolve('tsx/package.json');
const manifest = require_('tsx/package.json') as { bin?: string | Record<string, string> };
const binField = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.tsx;

if (!binField) {
  throw new Error('Unable to determine the tsx CLI entrypoint from its package manifest');
}

export const TSX_CLI = resolve(dirname(manifestPath), binField);
