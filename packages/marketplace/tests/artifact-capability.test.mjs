import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('published artifact-review components resolve from one compatibility manifest', async () => {
  const ecosystem = await readJson('../ecosystem.json');
  const marketplace = await readJson('../.claude-plugin/marketplace.json');

  assert.match(ecosystem.protocol.current, /^1\.[1-9][0-9]*\.0$/);
  assert.ok(ecosystem.protocol.supported.includes('1.0.x'));
  assert.ok(ecosystem.protocol.supported.includes('1.1.x'));
  assert.match(ecosystem.components.cli.version, /^[0-9]+\.[0-9]+\.[0-9]+$/);
  assert.match(ecosystem.components.pipeline.version, /^[0-9]+\.[0-9]+\.[0-9]+$/);
  assert.match(ecosystem.components.skills.version, /^[0-9]+\.[0-9]+\.[0-9]+$/);
  assert.equal(ecosystem.components.cli.pipelineRange, `^${ecosystem.components.pipeline.version}`);
  assert.equal(ecosystem.components.pipeline.cliRange, `^${ecosystem.components.cli.version}`);
  assert.deepEqual(ecosystem.adapters.map(({ runtime }) => runtime).sort(), ['claude-code', 'codex', 'cursor']);
  assert.ok(ecosystem.adapters.every(({ pipelineRange }) => pipelineRange === `^${ecosystem.components.pipeline.version}`));

  const plugins = new Map(marketplace.plugins.map((plugin) => [plugin.name, plugin]));
  assert.equal(plugins.get('planr-pipeline')?.version, ecosystem.components.pipeline.version);
  assert.equal(plugins.get('openplanr')?.version, ecosystem.components.skills.version);
});
