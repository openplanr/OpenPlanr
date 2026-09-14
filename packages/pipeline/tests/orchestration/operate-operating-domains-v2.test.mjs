import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { buildOperatingSnapshotStateTransactionV2 } from '../../lib/operate/operating-snapshots-v2.mjs';
import {
  OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
  createOperateExtensionRegistryV2,
} from '../../lib/operate/extensions-v2.mjs';
import {
  listPublicOperatingDomainsV2,
  projectPublicOperatingDomainV2,
  resolvePublicOperatingDomainV2,
} from '../../lib/operate/operating-domains-v2.mjs';

const valid = JSON.parse(readFileSync(
  new URL('../../conformance/fixtures/operating-runtime-v2/all-contracts-valid.json', import.meta.url),
  'utf8',
));
const fixture = (name) => JSON.parse(readFileSync(
  new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
  'utf8',
));
const clone = (value) => structuredClone(value);
const phase5DomainRegistration = (name) => {
  const registration = fixture(name);
  delete registration.policyRequirements;
  return registration;
};

function projectionInput(domainId = 'business', seed = '001') {
  const domainContract = domainId === 'business'
    ? { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' }
    : { apiDomainId: 'software', id: 'software-domain', version: '1.0.0' };
  const artifact = {
    ...clone(valid['operating-artifact']),
    artifactId: `art_domain_${seed}`,
    assignmentId: `asg_domain_${seed}`,
    scopeId: `scope-domain-${seed}`,
    domainId,
    domainVersion: '1.0.0',
    inputArtifactIds: [],
  };
  const transaction = buildOperatingSnapshotStateTransactionV2({
    scope: { scopeId: artifact.scopeId, domainId, domainVersion: '1.0.0' },
    domainContract,
    sourceArtifactIds: [artifact.artifactId],
    evidenceRefIds: [],
    sourceRevisions: [{ sourceArtifactId: artifact.artifactId, revision: `revision-${seed}` }],
    collections: { objectives: [], metrics: [], findings: [], decisions: [], actions: [], risks: [], assumptions: [] },
  }, {
    snapshotId: `snp_domain_${seed}`,
    stateId: `oms_domain_${seed}`,
    timestamp: '2026-08-09T12:00:00.000Z',
  });
  return { artifact, ...transaction };
}

test('public domain discovery returns exact deeply frozen registry-owned start identities', () => {
  const domains = listPublicOperatingDomainsV2();
  assert.deepEqual(domains.map(({ domainId, domainVersion, domainContract }) => ({
    domainId,
    domainVersion,
    domainContract,
  })), [
    {
      domainId: 'business',
      domainVersion: '1.0.0',
      domainContract: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
    },
    {
      domainId: 'software',
      domainVersion: '1.0.0',
      domainContract: { apiDomainId: 'software', id: 'software-domain', version: '1.0.0' },
    },
  ]);
  assert.equal(domains[0].roles.some(({ roleId, roleKind }) => roleId === 'strategy-finance' && roleKind === 'advisor'), true);
  assert.equal(domains[0].roles.some(({ roleId, roleKind }) => roleId === 'chair' && roleKind === 'chair'), true);
  assert.equal(Object.isFrozen(domains), true);
  assert.equal(Object.isFrozen(domains[0]), true);
  assert.equal(Object.isFrozen(domains[0].domainContract), true);
  assert.equal(Object.isFrozen(domains[0].roles), true);
  assert.equal(Object.isFrozen(domains[0].roles[0]), true);
});

test('business and software projections rebuild deterministically from only their own state, registration, and exact Artifacts', () => {
  for (const domainId of ['business', 'software']) {
    const input = projectionInput(domainId, domainId);
    const before = structuredClone(input);
    const first = projectPublicOperatingDomainV2({
      state: input.state,
      snapshot: input.snapshot,
      referencedArtifacts: [input.artifact],
    });
    const second = projectPublicOperatingDomainV2({
      state: input.state,
      snapshot: input.snapshot,
      referencedArtifacts: [input.artifact],
    });
    assert.deepEqual(first, second);
    assert.equal(first.kind, `${domainId}-operating-snapshot-projection`);
    assert.equal(first.projectionId.startsWith('prj_'), true);
    assert.deepEqual(first.sourceArtifactIds, [input.artifact.artifactId]);
    assert.equal(first.derivedAt, input.snapshot.createdAt);
    assert.equal(Object.isFrozen(first), true);
    assert.deepEqual(input, before, 'projection is pure and does not mutate input state or Artifact metadata');
    assert.doesNotMatch(JSON.stringify(first), /raw|bytes|resolver|credential|secret/iu);
  }
});

test('projection rejects cross-domain state, missing sources, and unregistered public bindings before producing a view', () => {
  const business = projectionInput('business', 'business');
  const software = projectionInput('software', 'software');
  assert.throws(() => projectPublicOperatingDomainV2({
    state: software.state,
    snapshot: business.snapshot,
    referencedArtifacts: [business.artifact],
  }), { code: 'STATE_TRANSITION_INVALID' });
  assert.throws(() => projectPublicOperatingDomainV2({
    state: business.state,
    snapshot: business.snapshot,
    referencedArtifacts: [],
  }), { code: 'OPERATING_DOMAIN_INPUT_INVALID' });
  const registry = createOperateExtensionRegistryV2({
    domains: [phase5DomainRegistration('software-domain-valid.json'), phase5DomainRegistration('business-domain-valid.json')],
  });
  assert.deepEqual(
    resolvePublicOperatingDomainV2(registry, 'business', { domainVersion: '1.0.0' })?.domainContract,
    { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
  );
  assert.equal(resolvePublicOperatingDomainV2(registry, 'business', { domainVersion: '2.0.0' }), null);
  assert.equal(resolvePublicOperatingDomainV2(OPEN_REFERENCE_OPERATE_EXTENSIONS_V2, 'synthetic-domain', { domainVersion: '1.0.0' }), null);
});

test('public domain resolution and projection reject hostile registry-shaped inputs before use', () => {
  const input = projectionInput('business', 'hostile');
  const hostile = {
    ...OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
    capabilityGrants: [{ capabilityId: 'filesystem', mode: 'write' }],
  };
  assert.throws(() => resolvePublicOperatingDomainV2(hostile, 'business', { domainVersion: '1.0.0' }), {
    code: 'OPERATING_DOMAIN_INPUT_INVALID',
  });
  assert.throws(() => listPublicOperatingDomainsV2(hostile), {
    code: 'OPERATING_DOMAIN_INPUT_INVALID',
  });
  assert.throws(() => projectPublicOperatingDomainV2({
    registry: hostile,
    state: input.state,
    snapshot: input.snapshot,
    referencedArtifacts: [input.artifact],
  }), { code: 'OPERATING_DOMAIN_INPUT_INVALID' });
});
