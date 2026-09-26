import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  loadOperateEvidenceContract,
  OPERATE_EVIDENCE_CONTRACT_KINDS_V2,
  OPERATE_EVIDENCE_EDGE_RELATIONS_V2,
  OPERATE_EVIDENCE_KINDS_V2,
  OPERATE_EVIDENCE_RESOLVER_ERROR_CODES_V2,
  validateProtocolArtifact,
} from '../../lib/protocol/loader.mjs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const clone = (value) => structuredClone(value);

function invalidFromDescriptor(base, descriptor) {
  const value = clone(base);
  if (descriptor.patch) Object.assign(value, descriptor.patch);
  return value;
}

test('Phase 4 evidence vocabulary is compiler-owned, finite, and explicit-v2', () => {
  assert.deepEqual(OPERATE_EVIDENCE_CONTRACT_KINDS_V2, [
    'operate-evidence-provider-registration',
    'operate-evidence-resolver-registration',
    'operating-evidence-candidate',
    'operating-evidence-edge',
    'operating-evidence-graph',
    'operating-evidence-ref',
    'operating-evidence-resolution',
  ]);
  assert.deepEqual(OPERATE_EVIDENCE_KINDS_V2, ['filesystem', 'git', 'operate-artifact', 'planr']);
  assert.deepEqual(OPERATE_EVIDENCE_EDGE_RELATIONS_V2, ['contradictedBy', 'supportedBy']);
  assert.ok(OPERATE_EVIDENCE_RESOLVER_ERROR_CODES_V2.includes('SOURCE_UNTRACKED'));
  assert.ok(OPERATE_EVIDENCE_RESOLVER_ERROR_CODES_V2.includes('REVISION_NOT_FOUND'));
  assert.ok(OPERATE_EVIDENCE_RESOLVER_ERROR_CODES_V2.includes('EVIDENCE_SOURCE_SCOPE_MISMATCH'));

  for (const kind of OPERATE_EVIDENCE_CONTRACT_KINDS_V2) {
    assert.equal(loadOperateEvidenceContract(kind, { protocolVersion: '2.0.0' }).kind, kind);
  }
  assert.throws(() => loadOperateEvidenceContract('citation', { protocolVersion: '2.0.0' }), {
    code: 'E_SCHEMA_UNKNOWN',
  });
  assert.throws(() => loadOperateEvidenceContract('operating-evidence-ref'), {
    code: 'E_SCHEMA_VERSION_REQUIRED',
  });
});

test('evidence fixtures validate only their exact contracts and reject unsafe future or legacy shapes', () => {
  const valid = fixture('evidence-contracts-valid.json');
  const invalid = fixture('evidence-contracts-invalid.json');
  assert.deepEqual(Object.keys(valid).sort(), [...OPERATE_EVIDENCE_CONTRACT_KINDS_V2].sort());
  assert.deepEqual(Object.keys(invalid).sort(), [...OPERATE_EVIDENCE_CONTRACT_KINDS_V2].sort());

  for (const kind of OPERATE_EVIDENCE_CONTRACT_KINDS_V2) {
    assert.deepEqual(
      validateProtocolArtifact(kind, valid[kind], { protocolVersion: '2.0.0' }),
      [],
      kind,
    );
    assert.ok(
      validateProtocolArtifact(kind, invalidFromDescriptor(valid[kind], invalid[kind]), {
        protocolVersion: '2.0.0',
      }).length > 0,
      `${kind} invalid descriptor`,
    );
  }

  const candidate = valid['operating-evidence-candidate'];
  for (const [evidenceKind, locator] of Object.entries({
    filesystem: { sourceRootId: 'workspace-root', path: 'notes/plan.md' },
    planr: {
      projectId: 'project-default',
      artifactId: 'SPEC-016',
      artifactType: 'specification',
      path: '.planr/specs/SPEC-016.md',
      contentHash: `sha256:${'a'.repeat(64)}`,
    },
    'operate-artifact': {
      artifactId: 'art_00000002',
      expectedArtifactType: 'advisor-result',
      expectedSchemaId: 'operating-artifact',
      expectedSchemaVersion: '2.0.0',
    },
  })) {
    assert.deepEqual(
      validateProtocolArtifact(
        'operating-evidence-candidate',
        {
          ...candidate,
          evidenceKind,
          locator,
        },
        { protocolVersion: '2.0.0' },
      ),
      [],
      evidenceKind,
    );
  }
  for (const malformed of [
    {
      evidenceKind: 'filesystem',
      locator: { sourceRootId: 'workspace-root', path: '/private/secret' },
    },
    { evidenceKind: 'filesystem', locator: { sourceRootId: 'workspace-root', path: '../escape' } },
    { evidenceKind: 'planr', locator: { projectId: 'project-default', artifactId: 'SPEC-016' } },
    {
      evidenceKind: 'git',
      locator: { repositoryId: 'repo-control', revision: '852aea6', lines: { start: 1, end: 2 } },
    },
  ]) {
    assert.ok(
      validateProtocolArtifact(
        'operating-evidence-candidate',
        {
          ...candidate,
          ...malformed,
        },
        { protocolVersion: '2.0.0' },
      ).length > 0,
    );
  }

  const rejected = {
    ...valid['operating-evidence-resolution'],
    outcome: 'rejected',
    sourceContract: null,
    evidenceRefId: null,
    evidenceArtifactId: null,
    error: {
      code: 'SOURCE_UNTRACKED',
      retryable: false,
      context: { evidenceKind: 'git', repositoryId: 'repo-control' },
    },
  };
  assert.deepEqual(
    validateProtocolArtifact('operating-evidence-resolution', rejected, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  assert.ok(
    validateProtocolArtifact(
      'operating-evidence-candidate',
      {
        ...candidate,
        sourceContract: { id: 'finance-metrics', version: '1.0.0' },
      },
      { protocolVersion: '2.0.0' },
    ).length > 0,
    'an untrusted candidate cannot assert its own source contract',
  );
  const withoutRuntimeSourceContract = structuredClone(valid['operating-evidence-ref']);
  delete withoutRuntimeSourceContract.sourceContract;
  assert.ok(
    validateProtocolArtifact('operating-evidence-ref', withoutRuntimeSourceContract, {
      protocolVersion: '2.0.0',
    }).length > 0,
    'a resolved EvidenceRef requires the runtime-owned source contract',
  );
  assert.ok(
    validateProtocolArtifact(
      'operating-evidence-edge',
      {
        ...valid['operating-evidence-edge'],
        claimId: 'durable-claim-is-future',
      },
      { protocolVersion: '2.0.0' },
    ).length > 0,
  );
});
