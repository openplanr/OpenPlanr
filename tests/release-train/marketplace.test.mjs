import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  renderMarketplaceManifest,
  renderPluginTable,
  replacePluginTable,
} from '../../scripts/release-train/lib/marketplace.mjs';

test('the public marketplace serves one planr plugin at the CLI version', () => {
  const manifest = renderMarketplaceManifest({
    version: '2.2.1',
    description: 'Host-native OpenPlanr skills.',
  });
  assert.equal(manifest.name, 'openplanr');
  assert.equal(manifest.metadata.version, '2.2.1');
  assert.deepEqual(
    manifest.plugins.map((plugin) => [plugin.name, plugin.source, plugin.version, plugin.strict]),
    [['planr', './plugins/planr', '2.2.1', true]],
  );
});

test('the README plugin table is replaced between its markers or appended', () => {
  const table = renderPluginTable({
    version: '2.2.1',
    description: 'Host-native OpenPlanr skills.',
  });
  assert.match(
    table,
    /\| \[`planr`\]\(https:\/\/github\.com\/openplanr\/OpenPlanr\/tree\/openplanr@2\.2\.1\/packages\/cli\) \| 2\.2\.1 \|/u,
  );
  const readme =
    '# Marketplace\n\n<!-- plugin-table:start -->\nold\n<!-- plugin-table:end -->\n\nTail.\n';
  const replaced = replacePluginTable(readme, table);
  assert.equal(replaced, `# Marketplace\n\n${table}\n\nTail.\n`);
  assert.equal(replacePluginTable('# Bare\n', table), `# Bare\n\n## Plugins\n\n${table}\n`);
});
