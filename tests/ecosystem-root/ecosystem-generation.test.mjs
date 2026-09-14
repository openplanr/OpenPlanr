import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PROTOCOL_V16_CONTRACT_FILES,
  PROTOCOL_V17_CONTRACT_FILES,
  PROTOCOL_V18_CONTRACT_FILES,
} from '../../packages/protocol/src/skill-source-contracts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outputPaths = [
  'ecosystem.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  'adapters/manifests/codex-plugin-content.json',
  'adapters/manifests/ecosystem-assets.json',
  'docs/generated/adapters.md',
  'docs/generated/ecosystem.md',
  'docs/generated/skills.md',
];
const read = (path) => readFileSync(resolve(root, path));
const json = (path) => JSON.parse(read(path));
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

test('local ecosystem derives component versions and preserved public parity in-repo', () => {
  const ecosystem = json('ecosystem.json');
  assert.equal(ecosystem.workspace.version, json('package.json').version);
  assert.equal(ecosystem.components.protocol.publication, 'public');
  assert.equal(ecosystem.releaseState, 'local-candidate');
  assert.equal(ecosystem.remoteState, 'not-queried');
  assert.equal(ecosystem.components.cli.version, json('packages/cli/package.json').version);
  assert.equal(ecosystem.components.pipeline.version, json('packages/pipeline/package.json').version);
  assert.equal(ecosystem.components.protocol.version, json('packages/protocol/package.json').version);
  assert.equal(ecosystem.components.skillRuntime.version, json('packages/skill-runtime/package.json').version);
  assert.equal(ecosystem.compatibility.cliOptionalPipeline.version, json('packages/cli/package.json').optionalDependencies['planr-pipeline']);
  assert.equal(ecosystem.compatibility.cliOptionalPipeline.exact, true);
  assert.equal(ecosystem.publicCompatibility.pipelineExportKeys, 37);
  assert.equal(ecosystem.publicCompatibility.pipelineRootSymbols, 229);
  assert.deepEqual(ecosystem.binaries.cli, {
    planr: './bin/planr.js',
    openplanr: './bin/planr.js',
    opr: './bin/planr.js',
  });
});

test('catalog, schema, role, skill, and adapter membership is exact', () => {
  const ecosystem = json('ecosystem.json');
  const commands = json('packages/protocol/registries/commands.json');
  const skills = json('packages/protocol/registries/skills.json');
  const additiveByVersion = {
    'v1.5.0': 13,
    'v1.6.0': Object.keys(PROTOCOL_V16_CONTRACT_FILES).length + 1,
    'v1.7.0': Object.keys(PROTOCOL_V17_CONTRACT_FILES).length + 1,
    'v1.8.0': Object.keys(PROTOCOL_V18_CONTRACT_FILES).length + 1,
  };
  assert.equal(ecosystem.protocol.current, '1.8.0');
  assert.equal(ecosystem.catalogs.commands.rootCommands, commands.inventory.rootCommandModules);
  assert.equal(ecosystem.catalogs.commands.frozenClaudeDocuments, 8);
  assert.equal(ecosystem.catalogs.skills.count, skills.skills.length);
  assert.deepEqual(ecosystem.catalogs.skills.aliases, []);
  assert.equal(ecosystem.catalogs.roles.count, 9);
  assert.ok(ecosystem.catalogs.roles.ids.includes('planr-documentation'));
  assert.ok(!ecosystem.catalogs.roles.ids.includes('planr-docs'));
  assert.deepEqual(ecosystem.adapters.hosts.map(({ id }) => id), ['claude-code', 'codex', 'cursor']);
  assert.equal(ecosystem.registries.capturedEvaluationContracts.lifecycle, 'byte-preserved');
  assert.equal(ecosystem.registries.capturedEvaluationContracts.hostProfiles.count, 3);
  assert.equal(ecosystem.registries.capturedEvaluationContracts.graders.count, 6);
  assert.equal(ecosystem.schemas.preserved.count, 180);
  assert.deepEqual(ecosystem.schemas.preserved.distribution, {
    'v1.0.0': 12,
    'v1.1.0': 34,
    'v1.2.0': 25,
    'v1.3.0': 5,
    'v1.4.0': 15,
    'v2.0.0': 89,
  });
  assert.equal(ecosystem.schemas.successors.protocolVersion, '1.8.0');
  assert.equal(ecosystem.schemas.successors.count, additiveByVersion['v1.8.0']);
  assert.equal(ecosystem.schemas.additive.count, Object.values(additiveByVersion).reduce((sum, count) => sum + count, 0));
  assert.deepEqual(ecosystem.schemas.additive.byVersion, additiveByVersion);
  assert.equal(ecosystem.registries.canonicalCatalogs.count, 12);
  assert.equal(ecosystem.registries.protocol15Catalogs.count, 7);
  assert.equal(ecosystem.registries.protocol16Catalogs.count, 2);
  assert.equal(ecosystem.registries.protocol17Catalogs.count, 3);
  assert.equal(ecosystem.catalogs.outputPaths.count, 4);
  assert.equal(
    ecosystem.catalogs.outputPaths.outputCatalogDigest,
    json('packages/protocol/registries/outputs.json').documentDigest,
  );
  assert.equal(ecosystem.registries.preserved.count, 12);
  assert.equal(ecosystem.catalogs.commands.negativeContracts[0].negativeContractId, 'retired-pipeline-operate');
});

test('the local marketplace points at one registry-complete Claude package with nine agents', () => {
  const plugin = json('.claude-plugin/plugin.json');
  const marketplace = json('.claude-plugin/marketplace.json');
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, 'planr');
  assert.equal(marketplace.plugins[0].source, './dist/plugins/claude/openplanr');
  assert.equal(marketplace.plugins[0].strict, true);
  assert.equal(plugin.name, 'planr');
  assert.equal('commands' in plugin, false);
  assert.equal('skills' in plugin, false);
  assert.equal('agents' in plugin, false);
  assert.equal(existsSync(resolve(root, 'dist/plugins/claude/openplanr/commands')), false);
  assert.equal(
    readdirSync(resolve(root, 'dist/plugins/claude/openplanr/skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length,
    json('skills/registry.json').skills.length,
  );
  assert.equal(readdirSync(resolve(root, 'dist/plugins/claude/openplanr/agents'), { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.md')).length, 9);
});

test('OpenAI plugin exposes readable content for every canonical skill and no aliases', () => {
  const plugin = json('dist/plugins/openai/openplanr/.codex-plugin/plugin.json');
  const content = json('adapters/manifests/codex-plugin-content.json');
  const canonical = json('adapters/manifests/canonical-skills.json');
  assert.equal(plugin.name, 'planr');
  assert.equal(content.plugin, 'planr');
  assert.equal(plugin.skills, './skills/');
  assert.equal(content.skillRoot, plugin.skills);
  assert.equal(content.canonicalSkillCount, canonical.skillIds.length);
  assert.equal(content.compatibilityAliasCount, 0);
  assert.equal(content.skillCount, canonical.skillIds.length);
  assert.equal(content.assetCount, content.skills.reduce((count, skill) => count + skill.assets.length, 0));
  assert.deepEqual(content.skills.map(({ skillId }) => skillId), canonical.skillIds);
  assert.deepEqual(canonical.aliases, []);
  for (const skill of content.skills) {
    assert.equal(skill.entrypoint, `skills/${skill.projectedName}/SKILL.md`);
    assert.ok(skill.description.length > 0, skill.skillId);
    assert.ok(skill.assets.length > 0, skill.skillId);
    for (const asset of skill.assets) {
      assert.equal(digest(read(`dist/plugins/openai/openplanr/${asset.path}`)), asset.digest, asset.path);
    }
    const metadataPath = `skills/${skill.projectedName}/agents/openai.yaml`;
    const metadata = read(`dist/plugins/openai/openplanr/${metadataPath}`).toString('utf8');
    assert.ok(skill.assets.some(({ path }) => path === metadataPath), metadataPath);
    assert.equal(skill.projectedName, skill.skillId.replace(/^planr-/u, ''));
    assert.equal(skill.invocation, `$planr:${skill.projectedName}`);
    assert.match(metadata, new RegExp(`default_prompt: .*\\$planr:${skill.projectedName}`, 'u'), metadataPath);
    assert.match(metadata, /allow_implicit_invocation: true/u, metadataPath);
  }
});

test('ecosystem output custody binds every generated byte', () => {
  const custody = json('adapters/manifests/ecosystem-assets.json');
  const hostAssets = json('adapters/manifests/generated-assets.json');
  assert.equal(new Set(custody.outputs.map(({ path }) => path)).size, custody.outputs.length);
  assert.ok(custody.inputs.some(({ path }) => path === 'adapters/manifests/generated-assets.json'));
  assert.ok(hostAssets.assets.some(({ path }) => path.endsWith('/agents/openai.yaml')));
  for (const output of custody.outputs) assert.equal(digest(read(output.path)), output.digest, output.path);
  for (const input of custody.inputs) assert.equal(digest(read(input.path)), input.digest, input.path);
});

test('check mode is deterministic and does not mutate generated metadata', () => {
  const before = outputPaths.map((path) => digest(read(path)));
  const run = () => spawnSync(process.execPath, ['scripts/marketplace/generate-ecosystem.mjs', '--check'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const first = run();
  const second = run();
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.equal(first.stdout, second.stdout);
  assert.deepEqual(outputPaths.map((path) => digest(read(path))), before);
});

test('marketplace generator has no sibling-checkout or machine-specific assumptions', () => {
  const source = read('scripts/marketplace/generate-ecosystem.mjs').toString('utf8');
  assert.doesNotMatch(source, /OPENPLANR_ECOSYSTEM_ROOT|\/Users\/|join\([^\n]+['"]\.\.['"]/u);
  for (const component of Object.values(json('ecosystem.json').components)) assert.ok(!component.path.startsWith('../'));
});
