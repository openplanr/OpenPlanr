import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  readSkillSourceRegistry,
  readStandardSkillPackage,
} from '../../packages/skill-runtime/src/catalog.mjs';
import {
  buildStandaloneSkillEntries,
  verifyStandaloneSkillEntries,
} from '../../scripts/skills/standalone-resources.mjs';
import { resourceFootprint, suiteLocalResources } from '../../scripts/skills/suite-resources.mjs';
import { verifySuiteResources } from '../../scripts/skills/suite-verification.mjs';

const root = resolve(import.meta.dirname, '../..');
const registry = readSkillSourceRegistry({ repoRoot: root });
const row = (id) => registry.skills.find(({ skillId }) => skillId === id);

test('suite resources keep Operate and design skills free of helper scripts', () => {
  for (const id of [
    'planr-operate',
    'planr-ceo-review',
    'planr-chair-review',
    'planr-design',
    'planr-design-loop',
    'planr-design-review',
    'planr-plan',
  ]) {
    const local = suiteLocalResources(
      readStandardSkillPackage({ repoRoot: root, registryRow: row(id) }),
      'codex',
    );
    assert.deepEqual(
      local.filter(({ path }) => path.startsWith('scripts/')).map(({ path }) => path),
      id === 'planr-plan' ? ['scripts/planning-ids.mjs'] : [],
      id,
    );
    if (id.startsWith('planr-design') || id === 'planr-plan')
      assert.ok(
        local.some(({ path }) => path === 'schemas/design-document.schema.json'),
        id,
      );
    else
      assert.ok(
        local.some(({ path }) => path === 'references/note-checklist.md'),
        id,
      );
  }
});

test('standalone archive verification rejects self-consistent incomplete or substituted products', () => {
  const registryRow = row('planr-plan');
  const entries = buildStandaloneSkillEntries({ repoRoot: root, registryRow });
  assert.equal(
    verifyStandaloneSkillEntries({ repoRoot: root, registryRow, entries }).files,
    entries.length,
  );
  assert.throws(
    () => verifyStandaloneSkillEntries({ repoRoot: root, registryRow, entries: entries.slice(1) }),
    /inventory/u,
  );
  const changed = entries.map((entry) =>
    entry.path === 'scripts/planning-ids.mjs'
      ? { ...entry, bytes: Buffer.from('process.exit(0);') }
      : entry,
  );
  assert.throws(
    () => verifyStandaloneSkillEntries({ repoRoot: root, registryRow, entries: changed }),
    /canonical standalone closure/u,
  );
  const modeChanged = entries.map((entry) =>
    entry.path === 'scripts/planning-ids.mjs' ? { ...entry, mode: 0o644 } : entry,
  );
  assert.throws(
    () => verifyStandaloneSkillEntries({ repoRoot: root, registryRow, entries: modeChanged }),
    /canonical standalone closure/u,
  );
});

test('standalone downloads own complete canonical resources independently of thin suites', () => {
  for (const id of [
    'planr-design',
    'planr-design-loop',
    'planr-design-review',
    'planr-plan',
    'planr-ceo-review',
    'planr-delegate',
  ]) {
    const packageInfo = readStandardSkillPackage({ repoRoot: root, registryRow: row(id) });
    const entries = buildStandaloneSkillEntries({ repoRoot: root, registryRow: row(id) });
    const files = new Map(entries.map(({ path, bytes }) => [path, bytes]));
    assert.ok(files.get('LICENSE').equals(readFileSync(join(root, 'LICENSE'))), `${id}/LICENSE`);
    for (const resource of packageInfo.resources) {
      assert.ok(files.has(resource.path), `${id}/${resource.path}`);
      if (resource.path !== 'agents/openai.yaml')
        assert.ok(
          files.get(resource.path).equals(readFileSync(resource.absolute)),
          `${id}/${resource.path} is ${files.get(resource.path).length} bytes, source ${readFileSync(resource.absolute).length}`,
        );
    }
    const name = id.slice('planr-'.length);
    assert.match(files.get('agents/openai.yaml').toString(), new RegExp(`\\$${name}\\b`, 'u'));
    assert.doesNotMatch(files.get('agents/openai.yaml').toString(), /\$planr:/u);
    assert.equal(files.has('scripts/design.mjs'), false, `${id} ships no design runtime`);
  }
});

test('native suites project canonical resources without a runtime closure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-shared-suite-'));
  try {
    for (const [host, resourceHost] of [
      ['openai', 'codex'],
      ['claude', 'claude-code'],
      ['cursor', 'cursor'],
    ]) {
      const plugin = join(directory, host, 'openplanr');
      cpSync(join(root, `dist/plugins/${host}/openplanr`), plugin, { recursive: true });
      assert.deepEqual(readFileSync(join(plugin, 'LICENSE')), readFileSync(join(root, 'LICENSE')));
      assert.equal(existsSync(join(plugin, 'runtime')), false, host);
      for (const id of [
        'planr-design',
        'planr-design-loop',
        'planr-design-review',
        'planr-plan',
        'planr-ceo-review',
      ]) {
        const name = id.slice('planr-'.length);
        const skillRoot = host === 'cursor' ? `rules/${id}` : `skills/${name}`;
        verifySuiteResources({
          repoRoot: root,
          registryRow: row(id),
          host: resourceHost,
          pluginRoot: plugin,
          skillRoot,
        });
        assert.equal(existsSync(join(plugin, skillRoot, 'scripts/design.mjs')), false, id);
        if (id === 'planr-ceo-review')
          assert.equal(existsSync(join(plugin, skillRoot, 'scripts')), false, host);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('footprint reports account for byte duplication and binary resource identity', () => {
  const bytes = Buffer.from([0, 255, 13, 10]);
  assert.deepEqual(resourceFootprint([{ bytes }, { bytes }, { bytes: Buffer.from('other') }]), {
    files: 3,
    bytes: 13,
    uniqueFiles: 2,
    uniqueBytes: 9,
    duplicateBytes: 4,
  });
});
