import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
  dispatchOperateEvidenceResolverV2,
} from 'planr-pipeline/operate/evidence-v2';

const fixture = (name) => JSON.parse(readFileSync(
  new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
  'utf8',
));
const clone = (value) => structuredClone(value);
const classified = (record) => ({
  ...clone(record),
  sourceContract: { id: 'prior-decisions', version: '1.0.0' },
});

function resolve(candidate, acceptedArtifact, extra = {}) {
  const valid = fixture('evidence-artifact-valid.json');
  return dispatchOperateEvidenceResolverV2(OPEN_REFERENCE_EVIDENCE_REGISTRY_V2, candidate, {
    scope: valid.scope,
    capabilities: ['evidence.operate-artifact.read'],
    operateArtifacts: [acceptedArtifact],
    ...extra,
  });
}

test('Operate Artifact evidence references one accepted immutable v2 Artifact without a content copy or second acceptance', () => {
  const valid = fixture('evidence-artifact-valid.json');
  const acceptedArtifact = classified(valid.acceptedArtifact);
  const before = clone(acceptedArtifact);
  const resolved = resolve(valid.candidate, acceptedArtifact);

  assert.equal(resolved.status, 'resolved');
  assert.equal(Object.hasOwn(resolved.capture, 'contentBase64'), false);
  assert.equal(resolved.capture.artifactId, before.artifact.artifactId);
  assert.equal(resolved.capture.rawHash, before.artifact.rawHash);
  assert.equal(resolved.capture.canonicalHash, before.artifact.canonicalHash);
  assert.equal(resolved.capture.sensitivity, before.artifact.sensitivity);
  assert.equal(resolved.capture.retentionClass, before.artifact.retentionClass);
  assert.deepEqual(resolved.capture.locator, {
    artifactId: before.artifact.artifactId,
    expectedArtifactType: before.artifact.artifactType,
    expectedSchemaId: before.artifact.schemaId,
    expectedSchemaVersion: before.artifact.artifactSchemaVersion,
    expectedRawHash: before.artifact.rawHash,
  });
  assert.deepEqual(acceptedArtifact, before, 'resolution is metadata-only and cannot mutate accepted Artifact state');
  assert.equal(Object.isFrozen(resolved.capture), true);
});

test('Operate Artifact evidence validates accepted-v2/source binding/type/hash/access before reference', () => {
  const valid = fixture('evidence-artifact-valid.json');
  const invalid = fixture('evidence-artifact-invalid.json');
  const base = clone(valid.candidate);
  const acceptedArtifact = classified(valid.acceptedArtifact);

  assert.equal(resolve(base, { ...acceptedArtifact, accepted: false }).error.code, invalid.unacceptedArtifact);
  assert.equal(resolve(base, acceptedArtifact, { operateArtifacts: [] }).error.code, invalid.missingArtifact);
  assert.equal(resolve(base, acceptedArtifact, { capabilities: [] }).error.code, invalid.denied);
  assert.equal(resolve(base, valid.acceptedArtifact).error.code, 'OBJECT_TYPE_MISMATCH',
    'an accepted Artifact without runtime-owned semantic classification is never treated as a prior Decision');

  const missingPerArtifactAccess = clone(acceptedArtifact);
  missingPerArtifactAccess.access.requiredCapabilities = [];
  assert.equal(resolve(base, missingPerArtifactAccess).error.code, invalid.denied);

  const otherScope = clone(base);
  otherScope.scopeId = 'other-scope';
  assert.equal(resolve(otherScope, acceptedArtifact, {
    scope: { ...valid.scope, scopeId: 'other-scope' },
  }).error.code, invalid.scopeMismatch);

  const wrongType = clone(base);
  wrongType.locator.expectedArtifactType = 'chair-result';
  assert.equal(resolve(wrongType, acceptedArtifact).error.code, invalid.wrongType);

  const wrongHash = clone(base);
  wrongHash.locator.expectedRawHash = `sha256:${'f'.repeat(64)}`;
  assert.equal(resolve(wrongHash, acceptedArtifact).error.code, invalid.wrongHash);
});

test('an attempted non-Artifact dispatch is rejected as a precise kind mismatch before source access', () => {
  const valid = fixture('evidence-artifact-valid.json');
  const invalid = fixture('evidence-artifact-invalid.json');
  const candidate = clone(valid.candidate);
  candidate.provider = { id: 'local-filesystem-evidence-provider', version: '2.0.0' };
  candidate.resolver = { id: 'local-filesystem-evidence-resolver', version: '2.0.0' };
  const result = resolve(candidate, classified(valid.acceptedArtifact), { capabilities: ['evidence.filesystem.read'] });
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.code, invalid.kindMismatch);
  assert.equal(result.error.context.evidenceKind, 'operate-artifact');
});
