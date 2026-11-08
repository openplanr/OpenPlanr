#!/usr/bin/env node
/**
 * Holds every generated host bundle to instructions-only content and the Claude bundle to the
 * directory's `contained` reach. Offenders listed in the baseline pass until their unit removes them.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOST_BUNDLE_ROOTS,
  inspectDirectoryEntries,
  inspectHostBundle,
  readDirectoryEntries,
  readHostBundleBaseline,
  splitByBaseline,
} from './skills/plugin-artifact-validation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = 'scripts/skills/plugin-allowed-types-baseline.json';

/** Checks bundle roots; returns blocking findings per root and baseline entries nothing matched. */
export function checkHostBundles(bundles, baseline) {
  const results = bundles.map(({ host, pluginRoot }) => {
    if (!existsSync(pluginRoot))
      throw new Error(`Plugin bundle ${pluginRoot} is missing. Run npm run generate first.`);
    const entries = readDirectoryEntries(pluginRoot);
    const split = splitByBaseline(inspectHostBundle(entries, { host }).findings, host, baseline);
    const blocking = [...inspectDirectoryEntries(entries).findings, ...split.blocking];
    return { host, pluginRoot, blocking, excused: split.excused, stale: split.stale };
  });
  return { results, stale: results.flatMap(({ stale }) => stale) };
}

/** Refuses baseline entries the baseline at `ref`, the pull request's base, lacks. */
export function assertBaselineNotGrown(ref, workspace = root) {
  const git = (...args) => spawnSync('git', args, { cwd: workspace, encoding: 'utf8' });
  if (git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`).status !== 0)
    throw new Error(
      `Cannot resolve ${ref} to compare ${BASELINE} with the base branch; fetch it first. The check fails closed without it.`,
    );
  const base = git('show', `${ref}:${BASELINE}`);
  if (base.status !== 0) return { base: null };
  const key = ({ host, path, code }) => `${host} ${path} [${code}]`;
  const before = new Set(JSON.parse(base.stdout).entries.map(key));
  const added = readHostBundleBaseline(join(workspace, BASELINE))
    .entries.map(key)
    .filter((entry) => !before.has(entry));
  if (added.length)
    throw new Error(
      `${BASELINE} has entries ${ref} does not: ${added.join(', ')}. The baseline may only shrink.`,
    );
  return { base: before.size };
}

function main(argv) {
  const value = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  if (argv.includes('--baseline-base')) {
    const ref = value('--baseline-base');
    const { base } = assertBaselineNotGrown(ref);
    console.log(
      base === null
        ? `${BASELINE} does not exist at ${ref} yet; nothing to compare.`
        : `${BASELINE} has not grown since ${ref}.`,
    );
    return;
  }
  const single = value('--plugin-root');
  const bundles = single
    ? [{ host: value('--host'), pluginRoot: resolve(single) }]
    : Object.entries(HOST_BUNDLE_ROOTS).map(([host, path]) => ({
        host,
        pluginRoot: join(root, path),
      }));
  const { results, stale } = checkHostBundles(bundles, readHostBundleBaseline());
  for (const { pluginRoot, blocking } of results)
    for (const { path, code, reason } of blocking)
      console.error(
        `plugin allowed types: ${relative(root, pluginRoot) || pluginRoot}/${path} [${code}] ${reason}`,
      );
  if (!single)
    for (const { host, path, code } of stale)
      console.error(
        `plugin allowed types: baseline entry ${host} ${path} [${code}] matches nothing; remove it from ${BASELINE} and update its count and sha256.`,
      );
  if (results.some(({ blocking }) => blocking.length) || (!single && stale.length)) {
    process.exitCode = 1;
    return;
  }
  const excused = results.reduce((total, { excused }) => total + excused.length, 0);
  console.log(
    `Plugin bundles carry instructions only${excused ? ` (${excused} baseline offenders remain)` : ''}.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
