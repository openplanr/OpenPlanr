import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
  readSkillSourceRegistry,
  readStandardSkillPackage,
} from '../../packages/skill-runtime/src/catalog.mjs';
import {
  buildStandaloneSkillEntries,
  verifyStandaloneSkillEntries,
} from '../../scripts/skills/standalone-resources.mjs';
import {
  renderSuiteLauncher,
  resourceFootprint,
  suiteLocalResources,
  suiteSharedResources,
} from '../../scripts/skills/suite-resources.mjs';
import { verifySuiteResources } from '../../scripts/skills/suite-verification.mjs';

const root = resolve(import.meta.dirname, '../..');
const registry = readSkillSourceRegistry({ repoRoot: root });
const row = (id) => registry.skills.find(({ skillId }) => skillId === id);

test('suite closure shares Operate bytes and keeps design skills free of runtime', () => {
  const ceo = readStandardSkillPackage({ repoRoot: root, registryRow: row('planr-ceo-review') });
  const cto = readStandardSkillPackage({ repoRoot: root, registryRow: row('planr-cto-review') });
  const shared = suiteSharedResources(ceo, 'codex', 'skills/ceo-review');
  const repeated = suiteSharedResources(cto, 'codex', 'skills/cto-review');
  assert.ok(shared.length > 1);
  assert.deepEqual(
    repeated.map(({ path, bytes }) => ({ path, bytes })),
    shared.map(({ path, bytes }) => ({ path, bytes })),
  );
  const local = suiteLocalResources(ceo, 'codex', 'skills/ceo-review');
  assert.equal(local.filter(({ path }) => path.startsWith('scripts/')).length, 1);
  const launcher = local.find(({ path }) => path === 'scripts/validate-note.mjs').bytes.toString();
  assert.match(launcher, /import \{ runOperateReviewNoteValidator as run \}/u);
  assert.match(launcher, /await run\(process\.argv\.slice\(2\)\)/u);
  assert.doesNotMatch(launcher, /https?:|npm |npx |PLANR_HOME/u);
  for (const id of ['planr-design', 'planr-design-loop', 'planr-design-review', 'planr-plan']) {
    const design = readStandardSkillPackage({ repoRoot: root, registryRow: row(id) });
    const skillRoot = `skills/${id.slice('planr-'.length)}`;
    assert.deepEqual(
      suiteSharedResources(design, 'codex', skillRoot).map(({ path }) => path),
      [],
      id,
    );
    const designLocal = suiteLocalResources(design, 'codex', skillRoot);
    assert.deepEqual(
      designLocal.filter(({ path }) => path.startsWith('scripts/')).map(({ path }) => path),
      [],
    );
    assert.ok(designLocal.some(({ path }) => path === 'schemas/design-document.schema.json'));
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
    entry.path === 'references/planning-ids.md'
      ? { ...entry, bytes: Buffer.from('# Substituted\n') }
      : entry,
  );
  assert.throws(
    () => verifyStandaloneSkillEntries({ repoRoot: root, registryRow, entries: changed }),
    /canonical standalone closure/u,
  );
  const modeChanged = entries.map((entry) =>
    entry.path === 'references/planning-ids.md' ? { ...entry, mode: 0o755 } : entry,
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

test('standalone advisor validator executes through an aliased installation path', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'openplanr-standalone-alias-')));
  try {
    const installed = join(directory, 'installed');
    for (const entry of buildStandaloneSkillEntries({
      repoRoot: root,
      registryRow: row('planr-ceo-review'),
    })) {
      const path = join(installed, entry.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, entry.bytes, { mode: entry.mode });
    }
    const alias = join(directory, 'alias');
    symlinkSync(installed, alias, 'dir');
    const result = spawnSync(process.execPath, [join(alias, 'scripts/validate-note.mjs')], {
      cwd: directory,
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /E_OPERATE_NOTE: Usage: validate-note/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('exact native suites run exported-main launchers offline after relocation', () => {
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
        assert.ok(existsSync(join(plugin, 'runtime')));
        if (id === 'planr-ceo-review') {
          const result = spawnSync(
            process.execPath,
            [join(plugin, skillRoot, 'scripts/validate-note.mjs')],
            {
              cwd: directory,
              encoding: 'utf8',
              env: { PATH: '/usr/bin:/bin' },
            },
          );
          assert.equal(result.status, 1);
          assert.match(result.stderr, /E_OPERATE_NOTE: Usage: validate-note/u);
        } else {
          assert.equal(existsSync(join(plugin, skillRoot, 'scripts/design.mjs')), false, id);
          assert.equal(existsSync(join(plugin, 'runtime/design')), false, host);
          assert.equal(existsSync(join(plugin, 'runtime/plan')), false, host);
        }
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
  assert.equal(
    renderSuiteLauncher({
      skillId: 'planr-delegate',
      path: 'scripts/runner.mjs',
      skillRoot: 'skills/delegate',
    }),
    null,
  );
});
