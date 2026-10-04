#!/usr/bin/env node
// Project the generated Claude plugin into a checkout of the public marketplace repository.
// Usage: node scripts/release-train/publish-marketplace.mjs --plugin <dist/plugins/claude/openplanr> --marketplace <checkout>
import { resolve } from 'node:path';
import { publishMarketplacePlugin } from './lib/publish-plugin.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const pluginDir = resolve(flag('--plugin') ?? '');
const marketplaceDir = resolve(flag('--marketplace') ?? '');
if (!flag('--plugin') || !flag('--marketplace'))
  throw new Error('Usage: publish-marketplace.mjs --plugin <dir> --marketplace <checkout>');

const manifest = publishMarketplacePlugin({ pluginDir, marketplaceDir });
console.log(`planr ${manifest.version} projected into ${marketplaceDir}`);
