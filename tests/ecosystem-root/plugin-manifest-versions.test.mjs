import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const json = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));

const cliVersion = json('packages/cli/package.json').version;
const pipelineVersion = json('packages/pipeline/package.json').version;

test('host plugin manifests and local marketplaces carry the CLI package version', () => {
  for (const path of [
    'dist/plugins/claude/openplanr/.claude-plugin/plugin.json',
    'dist/plugins/openai/openplanr/.codex-plugin/plugin.json',
    'dist/plugins/cursor/openplanr/manifest.json',
    '.claude-plugin/plugin.json',
  ]) {
    assert.equal(json(path).version, cliVersion, `${path} version`);
  }
  for (const path of [
    '.claude-plugin/marketplace.json',
    'dist/plugins/claude/.claude-plugin/marketplace.json',
    'dist/plugins/openai/.claude-plugin/marketplace.json',
  ]) {
    const marketplace = json(path);
    assert.equal(marketplace.metadata.version, cliVersion, `${path} metadata.version`);
    for (const plugin of marketplace.plugins)
      assert.equal(plugin.version, cliVersion, `${path} ${plugin.name}`);
  }
  const registry = json('packages/cli/lib/host-packages/adapter-registry.json');
  assert.equal(registry.pluginVersion, cliVersion);
  assert.equal(registry.pipelineVersion, pipelineVersion);
  for (const adapter of registry.adapters)
    assert.equal(adapter.version, cliVersion, `${adapter.id} adapter version`);
  assert.equal(
    json('packages/cli/lib/host-packages/capability-map.json').pluginVersion,
    cliVersion,
  );
});

test('the pipeline plugin manifest carries the pipeline package version', () => {
  const manifest = json('packages/pipeline/.claude-plugin/plugin.json');
  assert.equal(manifest.name, 'planr-pipeline');
  assert.equal(manifest.version, pipelineVersion);
});
