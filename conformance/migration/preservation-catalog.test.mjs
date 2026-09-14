import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyPreservationCatalog } from '../../scripts/migration/verify-preservation-catalog.mjs';
import { RELEASE_CHANGELOG_PATHS, preserveReleaseChangelogHistory, verifyReleaseChangelogHistory } from '../../scripts/migration/release-changelog-history.mjs';
import { sha256 } from '../../scripts/migration/preservation-lib.mjs';
import { GENERATOR_STEPS } from '../../scripts/generate-all.mjs';
import {
  PROTOCOL_V16_CONTRACT_FILES,
  DIAGRAM_V16_REGISTRIES,
  PROTOCOL_V17_CONTRACT_FILES,
  PROTOCOL_V17_REGISTRIES,
} from '../../packages/protocol/src/skill-source-contracts.mjs';

const INVENTORY = new URL('./preservation-path-inventory.json', import.meta.url);
const SURFACES = new URL('./preservation-surface-catalog.json', import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('preservation catalog verifies from committed data without custody evidence', async () => {
  const previousEvidence = process.env.OPENPLANR_SOURCE_EVIDENCE;
  delete process.env.OPENPLANR_SOURCE_EVIDENCE;
  try {
    const result = await verifyPreservationCatalog();
    assert.equal(result.status, 'PASS');
    assert.equal(result.custodyEvidenceRequired, false);
    assert.deepEqual(result.coverage.outputClasses, ['A', 'B', 'C', 'D']);
    assert.equal(result.coverage.pathRecords, 2237);
    assert.equal(result.coverage.unmappedPaths, 0);
  } finally {
    if (previousEvidence === undefined) delete process.env.OPENPLANR_SOURCE_EVIDENCE;
    else process.env.OPENPLANR_SOURCE_EVIDENCE = previousEvidence;
  }
});

test('clean-clone generation check is mutation-free and needs no raw evidence', async () => {
  const guardedPaths = [
    'conformance/migration/preservation-path-inventory.json',
    'conformance/migration/preservation-surface-catalog.json',
    'conformance/migration/preservation-verification-baseline.json',
  ];
  const before = await Promise.all(guardedPaths.map((relativePath) => readFile(path.join(REPOSITORY_ROOT, relativePath))));
  const environment = { ...process.env };
  delete environment.OPENPLANR_SOURCE_EVIDENCE;
  execFileSync(process.execPath, ['scripts/migration/generate-preservation-catalog.mjs', '--check'], {
    cwd: REPOSITORY_ROOT,
    env: environment,
    stdio: 'pipe',
  });
  const after = await Promise.all(guardedPaths.map((relativePath) => readFile(path.join(REPOSITORY_ROOT, relativePath))));
  assert.deepEqual(after, before);
});

test('root generation graph requires preservation after every other derived asset', () => {
  const preservation = GENERATOR_STEPS.at(-1);
  assert.equal(preservation.id, 'preservation-catalog');
  assert.equal(preservation.required, true);
  assert.equal(
    preservation.candidates[0].check.script,
    'scripts/migration/generate-preservation-catalog.mjs',
  );
  assert.deepEqual(preservation.candidates[0].check.arguments, ['--check']);
});

test('redacted path inventory accounts for all pinned sources and included overlay bytes', async () => {
  const inventory = JSON.parse(await readFile(INVENTORY, 'utf8'));
  assert.equal(inventory.sources.length, 5);
  assert.equal(inventory.coverage.cutoffTrackedPaths, 2124);
  assert.equal(inventory.coverage.includedOpenPlanrOverlayPaths, 618);
  assert.equal(inventory.pathMappings.length, 2237);
  assert.equal(
    Object.values(inventory.coverage.dispositionCounts).reduce((sum, count) => sum + count, 0),
    inventory.pathMappings.length,
  );
  assert.ok(inventory.pathMappings.every((mapping) => mapping.disposition !== 'unmapped'));

  const serialized = JSON.stringify(inventory);
  assert.doesNotMatch(serialized, /\/Users\//);
  assert.doesNotMatch(serialized, /\/private\/tmp\//);
  assert.doesNotMatch(serialized, /source-evidence\.json/);
});

test('surface catalog locks every required compatibility floor', async () => {
  const catalog = JSON.parse(await readFile(SURFACES, 'utf8'));
  const commands = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, 'packages/protocol/registries/commands.json'), 'utf8'));
  const skills = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, 'packages/protocol/registries/skills.json'), 'utf8'));
  assert.ok(catalog.commands.root.length >= 38);
  assert.equal(catalog.commands.root.length, commands.inventory.rootCommandModules);
  assert.equal(catalog.commands.pipelineMachine.length, 31);
  assert.equal(catalog.commands.frozenAliases.length, 8);
  assert.ok(catalog.skills.canonical.length >= 23);
  assert.equal(catalog.skills.canonical.length, skills.skills.length);
  assert.equal(catalog.roles.length, 9);
  assert.equal(catalog.rules.length, 10);
  assert.equal(catalog.schemas.original.length, 180);
  const protocol16SchemaCount = Object.keys(PROTOCOL_V16_CONTRACT_FILES).length + 1;
  const protocol17SchemaCount = Object.keys(PROTOCOL_V17_CONTRACT_FILES).length + 1;
  const protocol16RegistryCount = Object.keys(DIAGRAM_V16_REGISTRIES).length;
  const protocol17RegistryCount = Object.keys(PROTOCOL_V17_REGISTRIES).length;
  assert.equal(catalog.schemas.additive.length, 13 + protocol16SchemaCount + protocol17SchemaCount);
  assert.deepEqual(catalog.schemas.additiveByVersion, { '1.5.0': 13, '1.6.0': protocol16SchemaCount, '1.7.0': protocol17SchemaCount });
  assert.equal(catalog.registries.legacy.length, 12);
  assert.equal(catalog.registries.canonical.length, 7 + protocol16RegistryCount + protocol17RegistryCount);
  assert.deepEqual(catalog.registries.canonicalByVersion, { '1.5.0': 7, '1.6.0': protocol16RegistryCount, '1.7.0': protocol17RegistryCount });
  assert.equal(catalog.packageSurface.baselineExportKeys.length, 37);
  assert.equal(catalog.packageSurface.baselineRootSymbols.length, 229);
  assert.deepEqual([...new Set(catalog.outputs.map((output) => output.outputClass))].sort(), ['A', 'B', 'C', 'D']);
});

test('release changelogs require verified original custody and preserve history through prepended releases', async () => {
  const custodyRoot = await mkdtemp(path.join(tmpdir(), 'openplanr-changelog-history-'));
  try {
    const original = Buffer.from('# Changelog\n\nOriginal introduction.\n\n## [0.1.0] — original release\n\n- Preserve *exact* historical bytes.\n');
    const inventory = { coverage: {}, pathMappings: [] };
    for (const [mappingId, destination] of Object.entries(RELEASE_CHANGELOG_PATHS)) {
      const target = path.join(custodyRoot, destination);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, original);
      inventory.pathMappings.push({
        mappingId, sourcePath: 'CHANGELOG.md', included: { sha256: sha256(original) },
        cutoff: { present: true }, disposition: 'exact', destinations: [{ path: destination }],
        verification: { policy: 'byte-bound', sha256: sha256(original) },
      });
    }
    inventory.pathMappings.push({ mappingId: 'unrelated-source', disposition: 'exact', verification: { policy: 'byte-bound' } });
    await assert.rejects(preserveReleaseChangelogHistory(inventory), /requires --release-changelog-custody/u);
    const classified = await preserveReleaseChangelogHistory(inventory, { custodyRoot });
    assert.deepEqual(classified.pathMappings.at(-1), inventory.pathMappings.at(-1));
    assert.deepEqual(await preserveReleaseChangelogHistory(classified), classified);
    for (const mapping of classified.pathMappings.slice(0, 2)) {
      assert.equal(mapping.included.sha256, sha256(original));
      assert.equal(mapping.verification.sha256, sha256(original));
      verifyReleaseChangelogHistory(mapping, original);
      const prefix = original.subarray(0, mapping.verification.prefixBytes);
      const suffix = original.subarray(mapping.verification.prefixBytes);
      const appendReleases = Buffer.concat([prefix, Buffer.from('\n## 1.1.0\n\n### Minor Changes\n\n- New feature.\n\n## 1.0.0\n\n- Prior feature.\n'), suffix]);
      verifyReleaseChangelogHistory(mapping, appendReleases);
      for (const changed of [
        Buffer.from(appendReleases.toString().replace('*exact*', '_exact_')),
        Buffer.from(appendReleases.toString().replace('Changelog', 'Edited title')),
        appendReleases.subarray(0, appendReleases.length - 1),
        Buffer.concat([appendReleases, Buffer.from('Appended history edit')]),
      ]) assert.throws(() => verifyReleaseChangelogHistory(mapping, changed), /history changed|history was truncated/u);
      assert.throws(() => verifyReleaseChangelogHistory(mapping, Buffer.concat([prefix, Buffer.from('Arbitrary replacement\n'), suffix])), /Expected prepended release notes/u);
      assert.throws(() => verifyReleaseChangelogHistory({ ...mapping, mappingId: 'unrelated-source' }, original), /Not an approved release changelog/u);
    }
    const first = path.join(custodyRoot, Object.values(RELEASE_CHANGELOG_PATHS)[0]);
    await writeFile(first, Buffer.concat([original, Buffer.from('Changed')]));
    await assert.rejects(preserveReleaseChangelogHistory(inventory, { custodyRoot }), /custody bytes differ/u);
  } finally {
    await rm(custodyRoot, { recursive: true, force: true });
  }
});
