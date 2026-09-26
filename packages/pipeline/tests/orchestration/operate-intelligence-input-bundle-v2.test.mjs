import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareOperatingIntelligenceEvidenceSelectionV2 } from '../../lib/operate/intelligence-input-bundle-v2.mjs';
import { checkpoint } from './operate-operating-intelligence-state-v2.test-support.mjs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );

test('role bundle selection rejects a result Artifact substituted for exact materialized evidence custody', () => {
  const { result } = checkpoint();
  const role = fixture('business-domain-valid.json').roles.find(
    ({ roleId }) => roleId === 'strategy-finance',
  );
  const ref = result.state.evidenceRefs.find(({ evidenceRefId }) =>
    result.snapshot.evidenceRefIds.includes(evidenceRefId),
  );
  const evidenceArtifacts = structuredClone(result.state.artifacts);
  const position = evidenceArtifacts.findIndex(
    ({ artifactId }) => artifactId === ref.evidenceArtifactId,
  );
  evidenceArtifacts[position] = {
    ...evidenceArtifacts[position],
    artifactType: 'advisor-result',
    schemaId: 'operating-advisor-result',
    artifactSchemaVersion: '2.0.0',
  };

  assert.throws(
    () =>
      prepareOperatingIntelligenceEvidenceSelectionV2({
        snapshot: result.snapshot,
        role,
        evidenceRefs: result.state.evidenceRefs,
        evidenceArtifacts,
      }),
    (error) =>
      error.code === 'RESULT_CONTRACT_INVALID' &&
      error.message.includes('evidence-snapshot Artifact'),
  );
});

test('role bundle selection matches exact source contracts instead of treating a broad Evidence kind as professional evidence', () => {
  const { result } = checkpoint();
  const role = fixture('business-domain-valid.json').roles.find(
    ({ roleId }) => roleId === 'strategy-finance',
  );
  const ref = structuredClone(
    result.state.evidenceRefs.find(({ evidenceRefId }) =>
      result.snapshot.evidenceRefIds.includes(evidenceRefId),
    ),
  );
  const selection = (sourceContract) =>
    prepareOperatingIntelligenceEvidenceSelectionV2({
      snapshot: result.snapshot,
      role,
      evidenceRefs: result.state.evidenceRefs.map((candidate) =>
        candidate.evidenceRefId === ref.evidenceRefId ? { ...ref, sourceContract } : candidate,
      ),
      evidenceArtifacts: result.state.artifacts,
    });

  const generic = selection({ id: 'context-manifest', version: '1.0.0' });
  assert.deepEqual(
    generic.issuedEvidence,
    [],
    'a generic context manifest cannot satisfy finance requirements',
  );
  assert.deepEqual(
    generic.evidenceAbsenceDrafts.map(({ requirementId }) => requirementId),
    ['strategy-finance-evidence-1', 'strategy-finance-evidence-2', 'strategy-finance-evidence-3'],
  );
  assert.deepEqual(
    generic.evidenceAbsenceDrafts.map(({ sourceContracts }) => sourceContracts),
    [
      [{ id: 'objective-metrics', version: '1.0.0' }],
      [{ id: 'finance-metrics', version: '1.0.0' }],
      [{ id: 'prior-decisions', version: '1.0.0' }],
    ],
    'typed absences retain the exact requested source-contract vocabulary',
  );
  assert.ok(
    generic.evidenceAbsenceDrafts.every(({ sourceEvidenceRefIds }) =>
      sourceEvidenceRefIds.includes(ref.evidenceRefId),
    ),
    'same-kind wrong-contract Evidence remains auditable in the typed absence',
  );

  const finance = selection({ id: 'finance-metrics', version: '1.0.0' });
  assert.deepEqual(
    finance.issuedEvidence.map(({ requirementId, evidenceRefId }) => ({
      requirementId,
      evidenceRefId,
    })),
    [
      {
        requirementId: 'strategy-finance-evidence-2',
        evidenceRefId: ref.evidenceRefId,
      },
    ],
  );
  assert.deepEqual(
    finance.evidenceAbsenceDrafts.map(({ requirementId }) => requirementId),
    ['strategy-finance-evidence-1', 'strategy-finance-evidence-3'],
  );
});

test('role bundle selection fails closed when a persisted EvidenceRef loses runtime-owned source classification', () => {
  const { result } = checkpoint();
  const role = fixture('business-domain-valid.json').roles.find(
    ({ roleId }) => roleId === 'strategy-finance',
  );
  const evidenceRefs = structuredClone(result.state.evidenceRefs);
  const ref = evidenceRefs.find(({ evidenceRefId }) =>
    result.snapshot.evidenceRefIds.includes(evidenceRefId),
  );
  delete ref.sourceContract;
  assert.throws(
    () =>
      prepareOperatingIntelligenceEvidenceSelectionV2({
        snapshot: result.snapshot,
        role,
        evidenceRefs,
        evidenceArtifacts: result.state.artifacts,
      }),
    (error) => error.code === 'RESULT_CONTRACT_INVALID' && error.message.includes('EvidenceRef'),
  );
});
