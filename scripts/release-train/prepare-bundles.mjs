#!/usr/bin/env node
// Pack every pending public package into <out>/<bundle>/ with its publication proof.
// Usage: node scripts/release-train/prepare-bundles.mjs <out-dir> --pending '["@openplanr/protocol", ...]'
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleDirectory, PUBLIC_TARGETS } from './lib/targets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [outDir, ...rest] = process.argv.slice(2);
if (!outDir) throw new Error('Usage: prepare-bundles.mjs <out-dir> --pending <json array>');
const pendingIndex = rest.indexOf('--pending');
const pending =
  pendingIndex === -1
    ? PUBLIC_TARGETS.map((target) => target.name)
    : JSON.parse(rest[pendingIndex + 1]);

for (const target of PUBLIC_TARGETS) {
  if (!pending.includes(target.name)) continue;
  const version = JSON.parse(readFileSync(join(root, target.path, 'package.json'), 'utf8')).version;
  const bundle = join(resolve(outDir), bundleDirectory(target.name));
  execFileSync(process.execPath, [join(root, 'scripts/prepare-publication.mjs'), bundle], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      RELEASE_PACKAGE: target.name,
      RELEASE_VERSION: version,
    },
  });
}
