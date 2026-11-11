#!/usr/bin/env node
/**
 * Holds every generated host bundle to instructions-only content and the Claude bundle to the
 * directory's `contained` reach. Any finding fails; nothing is excused.
 */
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOST_BUNDLE_ROOTS,
  inspectDirectoryEntries,
  inspectHostBundle,
  readDirectoryEntries,
} from './skills/plugin-artifact-validation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Checks bundle roots; returns the blocking findings per root. */
export function checkHostBundles(bundles) {
  return bundles.map(({ host, pluginRoot }) => {
    if (!existsSync(pluginRoot))
      throw new Error(`Plugin bundle ${pluginRoot} is missing. Run npm run generate first.`);
    const entries = readDirectoryEntries(pluginRoot);
    const blocking = [
      ...inspectDirectoryEntries(entries).findings,
      ...inspectHostBundle(entries, { host }).findings,
    ];
    return { host, pluginRoot, blocking };
  });
}

function main(argv) {
  const value = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const single = value('--plugin-root');
  const bundles = single
    ? [{ host: value('--host'), pluginRoot: resolve(single) }]
    : Object.entries(HOST_BUNDLE_ROOTS).map(([host, path]) => ({
        host,
        pluginRoot: join(root, path),
      }));
  const results = checkHostBundles(bundles);
  for (const { pluginRoot, blocking } of results)
    for (const { path, code, reason } of blocking)
      console.error(
        `plugin allowed types: ${relative(root, pluginRoot) || pluginRoot}/${path} [${code}] ${reason}`,
      );
  if (results.some(({ blocking }) => blocking.length)) {
    process.exitCode = 1;
    return;
  }
  console.log('Plugin bundles carry instructions only.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
