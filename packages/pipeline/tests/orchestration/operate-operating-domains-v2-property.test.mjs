import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { projectPublicOperatingDomainV2 } from '../../lib/operate/operating-domains-v2.mjs';
import { buildOperatingSnapshotStateTransactionV2 } from '../../lib/operate/operating-snapshots-v2.mjs';

const valid = JSON.parse(
  readFileSync(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/all-contracts-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const clone = (value) => structuredClone(value);

function build(domainId, index) {
  const token = String(index).padStart(3, '0');
  const artifact = {
    ...clone(valid['operating-artifact']),
    artifactId: `art_property_${token}`,
    assignmentId: `asg_property_${token}`,
    scopeId: `scope-property-${token}`,
    domainId,
    domainVersion: '1.0.0',
    inputArtifactIds: [],
  };
  const domainContract =
    domainId === 'business'
      ? { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' }
      : { apiDomainId: 'software', id: 'software-domain', version: '1.0.0' };
  const transaction = buildOperatingSnapshotStateTransactionV2(
    {
      scope: { scopeId: artifact.scopeId, domainId, domainVersion: '1.0.0' },
      domainContract,
      sourceArtifactIds: [artifact.artifactId],
      evidenceRefIds: [],
      sourceRevisions: [{ sourceArtifactId: artifact.artifactId, revision: `r-${token}` }],
      collections: {
        objectives: [],
        metrics: [],
        findings: [],
        decisions: [],
        actions: [],
        risks: [],
        assumptions: [],
      },
    },
    {
      snapshotId: `snp_property_${token}`,
      stateId: `oms_property_${token}`,
      timestamp: '2026-08-09T12:00:00.000Z',
    },
  );
  return { artifact, ...transaction };
}

test('projection identity is stable and domain binding remains explicit across generated public inputs', () => {
  for (let index = 1; index <= 24; index += 1) {
    const domainId = index % 2 === 0 ? 'business' : 'software';
    const input = build(domainId, index);
    const projection = projectPublicOperatingDomainV2({
      state: input.state,
      snapshot: input.snapshot,
      referencedArtifacts: [input.artifact],
    });
    assert.equal(projection.domainId, domainId);
    assert.equal(projection.domainContract.apiDomainId, domainId);
    assert.equal(projection.domainContract.id, `${domainId}-domain`);
    assert.equal(projection.snapshotId, input.snapshot.snapshotId);
    assert.equal(projection.stateId, input.state.stateId);
    assert.deepEqual(
      projection,
      projectPublicOperatingDomainV2({
        state: input.state,
        snapshot: input.snapshot,
        referencedArtifacts: [input.artifact],
      }),
    );
  }
});
