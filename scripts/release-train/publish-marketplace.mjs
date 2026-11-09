#!/usr/bin/env node
// Project the generated Claude plugin into a checkout of the public marketplace repository.
// Usage: node scripts/release-train/publish-marketplace.mjs --plugin <dir> --marketplace <checkout> --sha256 <digest>
// The digest comes from prepare-bundles in the verify job, where every host bundle was checked.
import { resolve } from 'node:path';
import { publishMarketplacePlugin } from './lib/publish-plugin.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const pluginDir = resolve(flag('--plugin') ?? '');
const marketplaceDir = resolve(flag('--marketplace') ?? '');
const expectedSha256 = flag('--sha256');
if (!flag('--plugin') || !flag('--marketplace') || !/^[0-9a-f]{64}$/u.test(expectedSha256 ?? ''))
  throw new Error(
    'Usage: publish-marketplace.mjs --plugin <dir> --marketplace <checkout> --sha256 <64 hex digits>',
  );

const manifest = publishMarketplacePlugin({ pluginDir, marketplaceDir, expectedSha256 });
console.log(`planr ${manifest.version} projected into ${marketplaceDir}`);
