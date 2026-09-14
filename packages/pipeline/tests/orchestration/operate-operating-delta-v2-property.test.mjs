import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyOperatingDeltaMaterialityV2 } from '../../lib/operate/operating-delta-v2.mjs';

function delta(overrides = {}) {
  return {
    kind: 'operating-delta', schemaVersion: '1.0.0', protocolVersion: '2.0.0',
    deltaId: 'dlt_delta_property_001', scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0',
    priorSnapshotId: null, currentSnapshotId: 'snp_delta_property_001', sourceRevisionChanges: [], metricChanges: [],
    staleEvidenceRefIds: [], conflictingEvidenceRefIds: [], invalidatedAssumptionIds: [], exposedRiskIds: [], decisionRevisitIds: [],
    sourceArtifactId: 'art_delta_property_001', derivedAt: '2026-08-09T12:00:00.000Z', ...overrides,
  };
}

test('materiality is a total deterministic function over every Delta material field', () => {
  const fields = ['sourceRevisionChanges', 'metricChanges', 'staleEvidenceRefIds', 'conflictingEvidenceRefIds', 'invalidatedAssumptionIds', 'exposedRiskIds', 'decisionRevisitIds'];
  assert.deepEqual(classifyOperatingDeltaMaterialityV2(delta()), { material: false, reason: 'no-material-change' });
  for (const field of fields) {
    const value = field.endsWith('Changes')
      ? [{ subjectId: `subject-${field}`, kind: 'changed' }]
      : field === 'invalidatedAssumptionIds' ? ['asm_delta_property_001']
        : field === 'exposedRiskIds' ? ['rsk_delta_property_001']
          : field === 'decisionRevisitIds' ? ['dec_delta_property_001'] : ['evr_delta_property_001'];
    assert.deepEqual(classifyOperatingDeltaMaterialityV2(delta({ [field]: value })), { material: true, reason: 'material-change' }, field);
  }
});
