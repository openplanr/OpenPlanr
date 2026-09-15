import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { buildOperatingSnapshotStateTransactionV2 } from '../../lib/operate/operating-snapshots-v2.mjs';
import { createOperatingSnapshotCandidateV2 } from '../../lib/operate/operating-signal-providers-v2.mjs';

const valid = JSON.parse(readFileSync(
  new URL('../../conformance/fixtures/operating-runtime-v2/all-contracts-valid.json', import.meta.url),
  'utf8',
));
const clone = (value) => structuredClone(value);

test('snapshot candidate selection is stable across generated business and software accepted-input cases', () => {
  for (let index = 1; index <= 20; index += 1) {
    const domainId = index % 2 === 0 ? 'business' : 'software';
    const token = String(index).padStart(3, '0');
    const artifact = {
      ...clone(valid['operating-artifact']), artifactId: `art_signal_property_${token}`,
      assignmentId: `asg_signal_property_${token}`, scopeId: `scope-signal-property-${token}`,
      domainId, domainVersion: '1.0.0', inputArtifactIds: [],
    };
    const contract = domainId === 'business'
      ? { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' }
      : { apiDomainId: 'software', id: 'software-domain', version: '1.0.0' };
    const transaction = buildOperatingSnapshotStateTransactionV2({
      scope: { scopeId: artifact.scopeId, domainId, domainVersion: '1.0.0' }, domainContract: contract,
      sourceArtifactIds: [artifact.artifactId], evidenceRefIds: [],
      sourceRevisions: [{ sourceArtifactId: artifact.artifactId, revision: `r-${token}` }],
      collections: { objectives: [], metrics: [], findings: [], decisions: [], actions: [], risks: [], assumptions: [] },
    }, { snapshotId: `snp_signal_property_${token}`, stateId: `oms_signal_property_${token}`, timestamp: '2026-08-09T12:00:00.000Z' });
    const result = createOperatingSnapshotCandidateV2({
      providerId: 'open-reference-snapshot-provider', providerVersion: '1.0.0',
      snapshot: transaction.snapshot, state: transaction.state, acceptedArtifacts: [artifact],
    });
    assert.equal(result.status, 'candidate');
    assert.deepEqual(result.candidate, transaction.snapshot);
    assert.equal(result.provider.supportedDomains.length, 2);
  }
});
