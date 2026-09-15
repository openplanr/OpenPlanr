import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkOperateRuntimePurity,
  packOperateV2DevelopmentSnapshot,
} from '../../scripts/check-operate-runtime-purity.mjs';
import { OPERATE_RUNTIME_CONTRACT_KINDS } from '../../lib/protocol/loader.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-operate-v2-phase4-package-'));

after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

test('Phase 4 packed consumer imports only the declared local evidence facade', { timeout: 120_000 }, () => {
  const packageDestination = join(temporaryRoot, 'package');
  const packed = packOperateV2DevelopmentSnapshot(packageDestination, { sourceRoot: root });
  assert.equal(packed.ok, true);
  assert.match(packed.sha256, /^[a-f0-9]{64}$/);
  assert.equal(packed.sourcePurity.ok, true);
  assert.equal(packed.tarballPurity.ok, true);

  const packedFiles = new Set(packed.files.map(({ path }) => path));
  for (const required of [
    'conformance/verify-operate-v2-evidence.mjs',
    'conformance/fixtures/operating-runtime-v2/evidence-contracts-valid.json',
    'conformance/fixtures/operating-runtime-v2/evidence-contracts-invalid.json',
    'conformance/fixtures/operating-runtime-v2/evidence-registry-valid.json',
    'conformance/fixtures/operating-runtime-v2/evidence-registry-invalid.json',
    'conformance/fixtures/operating-runtime-v2/evidence-git-valid.json',
    'conformance/fixtures/operating-runtime-v2/evidence-filesystem-valid.json',
    'conformance/fixtures/operating-runtime-v2/evidence-planr-valid.json',
    'conformance/fixtures/operating-runtime-v2/evidence-artifact-valid.json',
    'conformance/fixtures/operating-runtime-v2/evidence-resolution-valid.json',
    'conformance/fixtures/operating-runtime-v2/evidence-graph-valid.json',
    'lib/operate/evidence-v2.mjs',
    'lib/operate/evidence-v2.d.mts',
    'lib/operate/evidence-registry-v2.mjs',
    'lib/operate/evidence-registry-v2.d.mts',
    'lib/operate/evidence-git-v2.mjs',
    'lib/operate/evidence-filesystem-v2.mjs',
    'lib/operate/evidence-planr-v2.mjs',
    'lib/operate/evidence-artifact-v2.mjs',
    'lib/operate/evidence-materialization-v2.mjs',
    'lib/operate/evidence-materialization-v2.d.mts',
    'lib/operate/evidence-projections-v2.mjs',
    'lib/operate/evidence-projections-v2.d.mts',
    'schemas/v2.0.0/operating-evidence-candidate.schema.json',
    'schemas/v2.0.0/operating-evidence-ref.schema.json',
    'schemas/v2.0.0/operating-evidence-resolution.schema.json',
    'schemas/v2.0.0/operate-evidence-provider-registration.schema.json',
    'schemas/v2.0.0/operate-evidence-resolver-registration.schema.json',
    'schemas/v2.0.0/operating-evidence-edge.schema.json',
    'schemas/v2.0.0/operating-evidence-graph.schema.json',
  ]) assert.equal(packedFiles.has(required), true, `missing Phase 4 package asset ${required}`);

  for (const path of packedFiles) {
    assert.doesNotMatch(path, /^(?:\.planr\/|tests\/|node_modules\/|\.env(?:\.|\/|$))/);
    assert.doesNotMatch(path, /(?:citation|compatibility-v1_4|records-migration|operating-provider-kit)/iu);
  }

  const consumer = join(temporaryRoot, 'consumer');
  const installedPackage = join(consumer, 'node_modules', 'planr-pipeline');
  mkdirSync(installedPackage, { recursive: true });
  run('tar', ['-xzf', packed.tarballPath, '-C', installedPackage, '--strip-components=1']);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ type: 'module' }));

  const metadata = JSON.parse(readFileSync(join(installedPackage, 'package.json'), 'utf8'));
  for (const [subpath, target] of Object.entries({
    './operate/evidence-v2': {
      types: './lib/operate/evidence-v2.d.mts',
      import: './lib/operate/evidence-v2.mjs',
    },
    './operate/evidence-materialization-v2': {
      types: './lib/operate/evidence-materialization-v2.d.mts',
      import: './lib/operate/evidence-materialization-v2.mjs',
    },
    './operate/evidence-projections-v2': {
      types: './lib/operate/evidence-projections-v2.d.mts',
      import: './lib/operate/evidence-projections-v2.mjs',
    },
  })) {
    assert.deepEqual(metadata.exports[subpath], target, `${subpath}: declared public export`);
    assert.equal(existsSync(join(installedPackage, target.import)), true, `${subpath}: runtime file`);
    assert.equal(existsSync(join(installedPackage, target.types)), true, `${subpath}: declaration file`);
  }
  assert.equal(metadata.exports['./operate/citation'], undefined);
  assert.equal(existsSync(join(installedPackage, 'lib/operate/citation.mjs')), false);

  const smoke = String.raw`
    import assert from 'node:assert/strict';
    import {
      OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
      createOperateEvidenceRegistryV2,
      dispatchOperateEvidenceResolverV2,
    } from 'planr-pipeline/operate/evidence-v2';
    import { buildOperatingEvidenceMaterializationV2 } from 'planr-pipeline/operate/evidence-materialization-v2';
    import { buildOperatingEvidenceGraphV2 } from 'planr-pipeline/operate/evidence-projections-v2';
    import { createEmptyOperatingRuntimeStateV2 } from 'planr-pipeline/operate/runtime-v2';

    const scope = { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' };
    const candidate = {
      kind: 'operating-evidence-candidate', schemaVersion: '1.0.0', protocolVersion: '2.0.0',
      candidateId: 'evc_package_001', sourceArtifactId: 'art_source_001', evidenceKind: 'git',
      locator: { repositoryId: 'repo-package', revision: '852aea6', objectType: 'blob', path: 'README.md' },
      provider: { id: 'local-git-evidence-provider', version: '2.0.0' },
      resolver: { id: 'local-git-evidence-resolver', version: '2.0.0' },
      ...scope,
    };
    assert.equal(createOperateEvidenceRegistryV2().providers.length, 4);
    assert.equal(OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.resolvers.length, 4);
    const dispatched = dispatchOperateEvidenceResolverV2(OPEN_REFERENCE_EVIDENCE_REGISTRY_V2, candidate, {
      scope, capabilities: ['evidence.git.read'],
    });
    assert.equal(dispatched.status, 'unavailable');
    assert.equal(dispatched.error.code, 'EVIDENCE_RESOLVER_UNAVAILABLE');
    assert.equal(typeof buildOperatingEvidenceMaterializationV2, 'function');
    const graph = buildOperatingEvidenceGraphV2(createEmptyOperatingRuntimeStateV2('2026-08-09T10:00:00.000Z'), scope, {
      generatedAt: '2026-08-09T10:00:00.000Z',
    });
    assert.equal(Object.isFrozen(graph), true);
    assert.deepEqual(graph.evidenceRefs, []);
    assert.deepEqual(graph.edges, []);
  `;
  const smokePath = join(consumer, 'verify-phase4.mjs');
  writeFileSync(smokePath, smoke);
  run(process.execPath, [smokePath], { cwd: consumer });

  const conformance = run(process.execPath, [
    join(installedPackage, 'conformance', 'verify-operate-v2-evidence.mjs'),
  ], { cwd: consumer });
  const report = JSON.parse(conformance.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.contracts, OPERATE_RUNTIME_CONTRACT_KINDS.length);
  assert.equal(report.evidenceContracts, 7);
  assert.equal(checkOperateRuntimePurity(installedPackage).ok, true);
});
