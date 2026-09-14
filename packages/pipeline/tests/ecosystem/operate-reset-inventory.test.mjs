import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateJson } from '../../conformance/json-schema-validate.mjs';
import {
  buildOperateSurfaceInventory,
  portableRepositoryRemote,
  renderDownstreamManifest,
  renderInventoryMarkdown,
  validateOperateSurfaceInventory,
} from '../../scripts/inventory-operate-surfaces.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const phaseRoot = resolve(root, 'conformance/fixtures/operate-reset-inventory');
const inventoryScript = resolve(root, 'scripts/inventory-operate-surfaces.mjs');
const disposableTestRoot = resolve(root, 'conformance/.tmp/operate-inventory');
const preservedPaths = Object.freeze([
  'OPERATE_LEGACY_INVENTORY.json',
  'OPERATE_LEGACY_INVENTORY.md',
  'OPERATE_DOWNSTREAM_DELETION_MANIFEST.md',
  'operate-reset-inventory.schema.json',
]);

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function preservedHashes() {
  return Object.fromEntries(
    preservedPaths.map((path) => [path, digest(readFileSync(resolve(phaseRoot, path)))]),
  );
}

function assertPreserved(before, label) {
  assert.deepEqual(preservedHashes(), before, label);
}

function runInventory(args = []) {
  return spawnSync(process.execPath, [inventoryScript, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function parseSummary(result, label) {
  assert.equal(result.status, 0, `${label}: ${result.stderr}`);
  assert.equal(result.stderr, '', `${label}: no stderr output`);
  return JSON.parse(result.stdout);
}

function classifiedRows(markdown) {
  const marker = '| Repository | Path | Classification | Kind | Proof mode |';
  const index = markdown.indexOf(marker);
  assert.notEqual(index, -1, 'human view has classified-surface table');
  return markdown.slice(index + marker.length).split('\n').slice(1)
    .filter((line) => /^\| [^|]+ \| [^|]+ \| [A-Z0-9_]+ \|/.test(line))
    .map((line) => {
      const [, repositoryId, path, classification] = line.split('|').map((part) => part.trim());
      return `${repositoryId}:${path}:${classification}`;
    }).sort();
}

function throwsMutation(mutator, label) {
  const inventory = buildOperateSurfaceInventory({ root });
  mutator(inventory);
  assert.throws(() => validateOperateSurfaceInventory(inventory), undefined, label);
}

test('repository identity removes local clone paths and remote credentials', () => {
  assert.equal(portableRepositoryRemote('/private/tmp/openplanr-clean-clone/OpenPlanr'), 'local-checkout');
  assert.equal(portableRepositoryRemote('/Users/example/Work/OpenPlanr'), 'local-checkout');
  assert.equal(portableRepositoryRemote('file:///private/tmp/OpenPlanr'), 'local-checkout');
  assert.equal(portableRepositoryRemote('../OpenPlanr'), 'local-checkout');
  assert.equal(portableRepositoryRemote('git@github.com:AsemDevs/openplanr.git'), 'github.com/AsemDevs/openplanr.git');
  assert.equal(
    portableRepositoryRemote('https://token@example.com/AsemDevs/openplanr.git?access=secret#branch'),
    'example.com/AsemDevs/openplanr.git',
  );
});

test('Operate reset inventory is schema-valid, deterministic, portable, and agrees with its human review view', () => {
  const first = buildOperateSurfaceInventory({ root });
  const second = buildOperateSurfaceInventory({ root });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(digest(JSON.stringify(first)), digest(JSON.stringify(second)));

  const schema = JSON.parse(readFileSync(resolve(phaseRoot, 'operate-reset-inventory.schema.json'), 'utf8'));
  assert.deepEqual(validateJson(first, schema), []);
  assert.deepEqual(
    classifiedRows(renderInventoryMarkdown(first)),
    first.surfaces.map(({ repositoryId, path, classification }) => `${repositoryId}:${path}:${classification}`).sort(),
  );
  assert.equal(first.surfaces.some(({ path }) => path === 'lib/operate/runtime-foundation.mjs'), true);
  assert.equal(first.surfaces.some(({ path }) => path === 'lib/operate/compatibility-v1_4.mjs'), false);
  assert.equal(first.surfaces.find(({ path }) => path === 'schemas/v2.0.0/operating-cycle.schema.json').evidence.schemaRegistration.length, 1);
  assert.equal(first.protectedPreserveEvidence.every(({ matchesRecorded, preserveOnly }) => matchesRecorded && preserveOnly), true);
  assert.equal(JSON.stringify(first).includes('/Users/'), false);
  assert.equal(JSON.stringify(first).includes('../'), false);
});

test('inventory rejects the required destructive-decision mutation fixtures', () => {
  const first = buildOperateSurfaceInventory({ root });
  throwsMutation((inventory) => {
    inventory.repositories[0].identity = 'planr-pipeline (/private/tmp/leak/OpenPlanr)';
  }, 'embedded absolute repository identity is rejected');

  throwsMutation((inventory) => {
    inventory.surfaces.find(({ path }) => path === 'lib/protocol/index.d.ts').classification = 'UNCLASSIFIED_EXPORT';
  }, 'unclassified export is rejected');

  throwsMutation((inventory) => {
    const surface = inventory.surfaces.find(({ path }) => path === 'docs/generated/adapters.md');
    surface.evidence.observations = surface.evidence.observations.filter((entry) => entry !== 'generated:declared-generator');
    surface.evidence.generatorEvidence = [];
    surface.evidence.observations.push('generated:declared-generator');
  }, 'stale generated asset without generator evidence is rejected');

  assert.equal(first.surfaces.some(({ path }) => path.includes('compatibility-v1_4')), false);
});

test('inventory CLI is read-only by default and rejects every non-explicit write mode without changing protected evidence', () => {
  const before = preservedHashes();
  const defaultSummary = parseSummary(runInventory(), 'plain invocation');
  assert.deepEqual(defaultSummary.mode, 'check');
  assert.equal(defaultSummary.ok, true);
  assertPreserved(before, 'plain invocation leaves every protected file byte-identical');

  const checkSummary = parseSummary(runInventory(['--check']), 'explicit check invocation');
  assert.deepEqual(checkSummary, defaultSummary, '--check has the same deterministic machine summary');
  assertPreserved(before, '--check leaves every protected file byte-identical');

  const rejected = [
    ['--write'],
    ['--check', '--write'],
    ['--check', '--check'],
    ['--unknown'],
    ['--write', '--output-dir', resolve(root, 'conformance/.tmp/operate-inventory/absolute')],
    ['--write', '--output-dir', '../operate-inventory'],
    ['--write', '--output-dir', '.planr/products/operate-2.0/phases'],
    ['--write', '--output-dir', '.planr/products/operate-2.0/phases/OPERATE_LEGACY_INVENTORY.json'],
  ];
  for (const args of rejected) {
    const result = runInventory(args);
    assert.notEqual(result.status, 0, `${args.join(' ')} is rejected`);
    assertPreserved(before, `${args.join(' ')} leaves every protected file byte-identical`);
  }
});

test('inventory materializes a schema-valid, internally consistent bundle only in an explicit disposable directory', () => {
  const before = preservedHashes();
  mkdirSync(disposableTestRoot, { recursive: true });
  const target = join(disposableTestRoot, `test-${process.pid}-${Date.now()}`);
  const relativeTarget = relative(root, target).split('\\').join('/');

  try {
    const summary = parseSummary(
      runInventory(['--write', '--output-dir', relativeTarget]),
      'explicit disposable write invocation',
    );
    assert.equal(summary.mode, 'write');
    assert.equal(summary.ok, true);
    assert.equal(summary.paths.inventory, `${relativeTarget}/OPERATE_LEGACY_INVENTORY.json`);

    for (const path of preservedPaths) {
      assert.equal(existsSync(join(target, path)), true, `write target includes ${path}`);
    }
    const inventory = JSON.parse(readFileSync(join(target, 'OPERATE_LEGACY_INVENTORY.json'), 'utf8'));
    const schema = JSON.parse(readFileSync(join(target, 'operate-reset-inventory.schema.json'), 'utf8'));
    assert.deepEqual(validateJson(inventory, schema), []);
    assert.equal(readFileSync(join(target, 'OPERATE_LEGACY_INVENTORY.md'), 'utf8'), renderInventoryMarkdown(inventory));
    assert.equal(readFileSync(join(target, 'OPERATE_DOWNSTREAM_DELETION_MANIFEST.md'), 'utf8'), renderDownstreamManifest(inventory));
    assertPreserved(before, 'explicit disposable output leaves every protected file byte-identical');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
