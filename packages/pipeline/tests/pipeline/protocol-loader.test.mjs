import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  LANDING_CONTRACT_KINDS_V1,
  OPERATE_LIVE_EVIDENCE_CONTRACT_KINDS_V2,
  OPERATE_RUNTIME_CONTRACT_KINDS,
  assertDashboardBootstrapV1,
  assertProtocolArtifact,
  listProtocolSchemas,
  loadLandingContract,
  loadOperateLiveEvidenceContract,
  loadOperateRuntimeContract,
  loadProtocolContract,
  validateDashboardBootstrapV1,
} from 'planr-pipeline/protocol';

const root = fileURLToPath(new URL('../..', import.meta.url));

const dashboardBootstrap = {
  kind: 'dashboard-bootstrap',
  schemaVersion: '1.0.0',
  protocolVersion: '1.2.0',
  ui: {
    buildId: 'dashboard-public-test',
    expectedBuildId: 'dashboard-public-test',
    assetManifestHash: `sha256:${'a'.repeat(64)}`,
  },
  server: { packageVersion: '0.42.0' },
  capabilities: {
    planningGraph: { schemaVersion: '1.0.0' },
    operateExperience: { protocolVersion: '2.0.0', schemaVersion: '1.0.0' },
    operateCommands: { protocolVersion: '2.0.0', transportVersion: '1.0.0', available: false },
    diagnostics: { schemaVersion: '1.0.0', available: true },
  },
  project: {
    projectId: `sha256:${'b'.repeat(64)}`,
    name: 'Public project',
    branch: 'main',
    products: ['planning', 'operate'],
  },
  queryRoots: {
    planning: {
      actorId: 'human-owner',
      projectId: `sha256:${'b'.repeat(64)}`,
      scopeId: 'planning',
      domainId: 'planning',
      domainVersion: '1.0.0',
      generation: 0,
    },
    operate: {
      actorId: 'human-owner',
      projectId: `sha256:${'b'.repeat(64)}`,
      scopeId: 'business',
      domainId: 'business',
      domainVersion: '2.0.0',
      generation: 0,
    },
  },
  origin: 'http://127.0.0.1:7473',
  compatibility: { status: 'compatible', reasonCodes: [] },
};

test('protocol exports require explicit identities and expose exactly the v2 Operate runtime catalog', () => {
  assert.throws(
    () => loadProtocolContract('pipeline-shipped'),
    (error) => error.code === 'E_SCHEMA_VERSION_REQUIRED',
  );
  const v2Kinds = listProtocolSchemas()
    .filter(({ protocolVersion }) => protocolVersion === '2.0.0')
    .map(({ kind }) => kind)
    .sort();
  assert.equal(new Set(v2Kinds).size, v2Kinds.length);
  assert.deepEqual(v2Kinds, [...OPERATE_RUNTIME_CONTRACT_KINDS].sort());
  assert.equal(
    listProtocolSchemas().some(({ kind }) => kind === 'operating-state'),
    false,
  );

  const contract = loadOperateRuntimeContract('operating-runtime-state', {
    protocolVersion: '2.0.0',
  });
  contract.schema.title = 'consumer mutation';
  assert.notEqual(
    loadOperateRuntimeContract('operating-runtime-state', { protocolVersion: '2.0.0' }).schema
      .title,
    'consumer mutation',
    'consumers receive defensive schema clones',
  );
});

test('live-evidence and landing loaders expose only their exact closed contract families', () => {
  assert.deepEqual(OPERATE_LIVE_EVIDENCE_CONTRACT_KINDS_V2, [
    'operate-live-evidence-provider-registration',
    'operate-live-evidence-provider-registry',
    'operating-live-evidence-consent-record',
    'operating-connector-checkpoint',
    'operating-live-evidence-ingestion',
    'operating-measurement-plan',
    'operating-measurement-schedule',
    'operating-measurement-schedule-receipt',
    'operating-evidence-observation',
    'operating-outcome-evaluation',
    'operating-learning-receipt',
  ]);
  assert.deepEqual(LANDING_CONTRACT_KINDS_V1, [
    'landing-plan',
    'landing-confirmation',
    'landing-event',
    'landing-phase-receipt',
    'landing-receipt',
    'landing-operation-registry',
  ]);

  for (const kind of OPERATE_LIVE_EVIDENCE_CONTRACT_KINDS_V2) {
    const contract = loadOperateLiveEvidenceContract(kind, { protocolVersion: '2.0.0' });
    assert.equal(contract.kind, kind);
    assert.equal(contract.protocolVersion, '2.0.0');
    assert.equal(contract.schema.properties.kind.const, kind);
  }
  for (const kind of LANDING_CONTRACT_KINDS_V1) {
    const contract = loadLandingContract(kind, { protocolVersion: '1.2.0' });
    assert.equal(contract.kind, kind);
    assert.equal(contract.protocolVersion, '1.2.0');
    assert.equal(contract.schema.properties.kind.const, kind);
  }

  assert.throws(
    () =>
      loadOperateLiveEvidenceContract(OPERATE_LIVE_EVIDENCE_CONTRACT_KINDS_V2[0], {
        protocolVersion: '1.2.0',
      }),
    { code: 'E_SCHEMA_VERSION_UNSUPPORTED' },
  );
  assert.throws(
    () =>
      loadOperateLiveEvidenceContract('operating-artifact', {
        protocolVersion: '2.0.0',
      }),
    { code: 'E_SCHEMA_UNKNOWN' },
  );
  assert.throws(
    () =>
      loadLandingContract(LANDING_CONTRACT_KINDS_V1[0], {
        protocolVersion: '2.0.0',
      }),
    { code: 'E_SCHEMA_VERSION_UNSUPPORTED' },
  );
  assert.throws(
    () =>
      loadLandingContract('operating-artifact', {
        protocolVersion: '1.2.0',
      }),
    { code: 'E_SCHEMA_UNKNOWN' },
  );
  assert.throws(
    () =>
      loadOperateRuntimeContract('landing-plan', {
        protocolVersion: '2.0.0',
      }),
    { code: 'E_SCHEMA_UNKNOWN' },
  );
  assert.throws(() => loadLandingContract('landing-plan'), { code: 'E_SCHEMA_VERSION_REQUIRED' });
});

test('registered schema references resolve with separator-independent containment checks', () => {
  for (const { kind, protocolVersion } of listProtocolSchemas()) {
    assert.doesNotThrow(
      () => loadProtocolContract(kind, { protocolVersion }),
      `${kind}@${protocolVersion} must resolve its schema references`,
    );
  }
  const valid = JSON.parse(
    readFileSync(
      join(root, 'conformance/fixtures/operating-runtime-v2/all-contracts-valid.json'),
      'utf8',
    ),
  );
  assert.doesNotThrow(() =>
    assertProtocolArtifact('operating-event', valid['operating-event'], {
      protocolVersion: '2.0.0',
    }),
  );
});

test('public protocol subpath exports complete dashboard bootstrap validation', () => {
  assert.deepEqual(validateDashboardBootstrapV1(dashboardBootstrap), []);
  assert.equal(assertDashboardBootstrapV1(dashboardBootstrap), dashboardBootstrap);
  const mismatch = structuredClone(dashboardBootstrap);
  mismatch.ui.expectedBuildId = 'dashboard-foreign';
  assert.notEqual(validateDashboardBootstrapV1(mismatch).length, 0);
  assert.throws(() => assertDashboardBootstrapV1(mismatch), {
    code: 'E_PROTOCOL_ARTIFACT_INVALID',
  });
});

test('package metadata publishes only declared stable subpaths', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.exports['./protocol'].types, './lib/protocol/index.d.ts');
  assert.equal(packageJson.exports['./protocol'].import, './lib/protocol/loader.mjs');
  assert.equal(
    packageJson.exports['./operate/runtime-v2'].import,
    './lib/operate/runtime-foundation.mjs',
  );
  assert.equal(packageJson.exports['./schemas/*'], './schemas/*');
  assert.equal(packageJson.exports['./registry/*'], './registry/*');
});

test('the public protocol declarations expose only explicit v2 Operate identities', () => {
  const declarations = readFileSync(join(root, 'lib/protocol/index.d.ts'), 'utf8');
  assert.match(declarations, /loadProtocolContract\([\s\S]*options: \{ protocolVersion: string \}/);
  assert.match(declarations, /loadOperateLiveEvidenceContract\(/);
  assert.match(declarations, /loadLandingContract\(/);
  assert.match(declarations, /export interface OperatingRuntimeStateV2/);
  assert.doesNotMatch(
    declarations,
    /OPERATING_PROTOCOL_VERSION|readOperatingBoardStateV1|loadOperatingContractBundle|listOperatingRoles|listOperatingProviders|reduceOperatingEvents\(/,
  );
});
