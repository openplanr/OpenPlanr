#!/usr/bin/env node
// Project the generated Claude plugin into a checkout of the public marketplace repository.
// Usage: node scripts/release-train/publish-marketplace.mjs --plugin <dist/plugins/claude/openplanr> --marketplace <checkout>
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  renderMarketplaceManifest,
  renderPluginTable,
  replacePluginTable,
} from './lib/marketplace.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const pluginDir = resolve(flag('--plugin') ?? '');
const marketplaceDir = resolve(flag('--marketplace') ?? '');
if (!flag('--plugin') || !flag('--marketplace'))
  throw new Error('Usage: publish-marketplace.mjs --plugin <dir> --marketplace <checkout>');

const manifest = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin/plugin.json'), 'utf8'));
if (manifest.name !== 'planr' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version)) {
  throw new Error('The plugin manifest must be the generated planr plugin with a release version');
}

const target = join(marketplaceDir, 'plugins/planr');
rmSync(target, { recursive: true, force: true });
mkdirSync(join(marketplaceDir, 'plugins'), { recursive: true });
cpSync(pluginDir, target, { recursive: true });

mkdirSync(join(marketplaceDir, '.claude-plugin'), { recursive: true });
writeFileSync(
  join(marketplaceDir, '.claude-plugin/marketplace.json'),
  `${JSON.stringify(renderMarketplaceManifest({ version: manifest.version, description: manifest.description }), null, 2)}\n`,
);
const readmePath = join(marketplaceDir, 'README.md');
const readme = existsSync(readmePath)
  ? readFileSync(readmePath, 'utf8')
  : '# OpenPlanr Marketplace\n';
writeFileSync(
  readmePath,
  replacePluginTable(
    readme,
    renderPluginTable({
      version: manifest.version,
      description: manifest.description,
    }),
  ),
);
console.log(`planr ${manifest.version} projected into ${marketplaceDir}`);
