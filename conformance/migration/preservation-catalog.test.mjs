import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyPreservationCatalog } from '../../scripts/migration/verify-preservation-catalog.mjs';
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
