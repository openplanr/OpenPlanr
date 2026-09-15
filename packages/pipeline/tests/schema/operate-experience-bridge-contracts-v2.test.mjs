import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  OPERATE_EXPERIENCE_CONTRACT_KINDS_V2,
  OPERATING_DELIVERY_ROUTES_V1,
  validateOperateExperienceArtifactV2,
  validateProtocolArtifact,
} from '../../lib/protocol/contracts.mjs';
import {
  loadOperateExperienceContract,
  readOperateExperienceViewV1,
  readOperatingDeliveryEvidenceV1,
  readOperatingOriginV1,
  readOperatingPlanningProposalV1,
} from '../../lib/protocol/loader.mjs';

const fixtureRoot = new URL('../../conformance/fixtures/operating-runtime-v2/', import.meta.url);
const valid = JSON.parse(await readFile(new URL('experience-bridge-valid.json', fixtureRoot), 'utf8'));
const invalid = JSON.parse(await readFile(new URL('experience-bridge-invalid.json', fixtureRoot), 'utf8'));
function clone(value) { return structuredClone(value); }

test('compiler exposes the exact closed experience and route vocabularies', () => {
  assert.deepEqual([...OPERATE_EXPERIENCE_CONTRACT_KINDS_V2], [
    'operate-experience-live-patch', 'operate-experience-preview', 'operate-experience-view',
    'operate-review-bound-submission',
    'operate-review-display-workspace',
    'operating-delivery-evidence', 'operating-delivery-route', 'operating-origin', 'operating-planning-proposal',
  ]);
  assert.deepEqual([...OPERATING_DELIVERY_ROUTES_V1], ['contained-execution', 'human-external', 'observe-only', 'planning-work']);
});

for (const kind of Object.keys(valid).sort()) {
  test(`${kind} is public, closed, and validates its conformance fixture`, () => {
    const contract = loadOperateExperienceContract(kind, { protocolVersion: '2.0.0' });
    assert.equal(contract.schema['x-openplanr-contract'].id, kind);
    assert.equal(contract.schema['x-openplanr-contract'].version, '1.0.0');
    assert.deepEqual(validateOperateExperienceArtifactV2(kind, valid[kind]), []);
    assert.notDeepEqual(validateOperateExperienceArtifactV2(kind, invalid[kind]), []);
  });
}

test('experience contracts require exact protocol identity', () => {
  assert.throws(() => loadOperateExperienceContract('operate-experience-view', {}), { code: 'E_SCHEMA_VERSION_REQUIRED' });
  assert.throws(() => loadOperateExperienceContract('operate-experience-view', { protocolVersion: '1.4.0' }), { code: 'E_SCHEMA_VERSION_UNSUPPORTED' });
  assert.throws(() => loadOperateExperienceContract('not-an-experience-contract', { protocolVersion: '2.0.0' }), { code: 'E_SCHEMA_UNKNOWN' });
});

test('the public protocol validator closes canonical SPEC frontmatter before publication', () => {
  const spec = {
    id: 'SPEC-001',
    title: 'Canonical title"\nslug: "foreign-workflow',
    slug: 'canonical-title-slug-foreign-workflow',
    schemaVersion: '1.0.0',
    status: 'shaping',
    priority: 'P1',
    po: 'owner-test',
    created: '2026-08-11',
    updated: '2026-08-11',
    ui_files: [],
    tech_dependencies: [],
  };
  assert.deepEqual(validateProtocolArtifact('spec', spec, { protocolVersion: '1.0.0' }), []);
  assert.notDeepEqual(
    validateProtocolArtifact('spec', { ...spec, injected: 'not-allowed' }, { protocolVersion: '1.0.0' }),
    [],
  );
});

test('preview subjects and live-patch Event heads are conditionally closed', () => {
  const preview = clone(valid['operate-experience-preview']);
  assert.deepEqual(validateOperateExperienceArtifactV2('operate-experience-preview', { ...preview, subject: { ...preview.subject, revision: null } }), []);
  assert.notDeepEqual(validateOperateExperienceArtifactV2('operate-experience-preview', { ...preview, subject: { ...preview.subject, kind: 'action', revision: null } }), []);

  const initialPatch = clone(valid['operate-experience-live-patch']);
  initialPatch.fromEventHead = { sequence: 0, hash: null };
  assert.deepEqual(validateOperateExperienceArtifactV2('operate-experience-live-patch', initialPatch), []);
  assert.notDeepEqual(validateOperateExperienceArtifactV2('operate-experience-live-patch', { ...initialPatch, fromEventHead: { sequence: 0, hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111' } }), []);
  assert.notDeepEqual(validateOperateExperienceArtifactV2('operate-experience-live-patch', { ...initialPatch, fromEventHead: { sequence: 1, hash: null } }), []);
  assert.notDeepEqual(validateOperateExperienceArtifactV2('operate-experience-live-patch', { ...initialPatch, operations: [{ op: 'replace', path: '/unknown', valueHash: initialPatch.patchHash, value: [] }] }), []);
  for (const [path, value] of [['/domainMetrics', []], ['/claims', []], ['/replay', valid['operate-experience-view'].replay]]) {
    assert.deepEqual(validateOperateExperienceArtifactV2('operate-experience-live-patch', { ...initialPatch, operations: [{ op: 'replace', path, valueHash: initialPatch.patchHash, value }] }), []);
  }
});

test('screen-fidelity collections and replay proof are required and recursively closed', () => {
  const view = clone(valid['operate-experience-view']);
  const schema = loadOperateExperienceContract('operate-experience-view', { protocolVersion: '2.0.0' }).schema;
  assert.deepEqual(schema.$defs.cycle.properties.replayCheckpoint, { oneOf: [{ type: 'null' }, { $ref: '#/$defs/replayCheckpoint' }] });
  assert.deepEqual(schema.$defs.evidenceProvenance.required, ['sourceArtifactId', 'evidenceArtifactId', 'rawHash', 'canonicalHash', 'sizeBytes', 'mediaType', 'accessLevel']);
  assert.ok(schema.$defs.outcomeMetric.required.includes('metricHash'));
  assert.ok(schema.$defs.verification.required.includes('verificationPlanHash'));
  assert.ok(schema.$defs.verification.required.includes('metricHash'));
  assert.ok(schema.$defs.parityProof.required.includes('stateParityVerified'));
  assert.deepEqual(schema.$defs.history.properties.actorId, { type: ['string', 'null'], minLength: 1, maxLength: 128 });
  for (const field of ['domainMetrics', 'claims', 'replay']) {
    const missing = clone(view); delete missing[field];
    assert.notDeepEqual(validateOperateExperienceArtifactV2('operate-experience-view', missing), [], field);
  }
  assert.notDeepEqual(validateOperateExperienceArtifactV2('operate-experience-view', { ...view, replay: { ...view.replay, liveAccessUsed: true } }), []);
  const missingStateParity = clone(view); delete missingStateParity.replay.parityProof.stateParityVerified;
  assert.notDeepEqual(validateOperateExperienceArtifactV2('operate-experience-view', missingStateParity), []);
  assert.notDeepEqual(validateOperateExperienceArtifactV2('operate-experience-view', { ...view, replay: { ...view.replay, hiddenReasoning: 'prohibited' } }), []);
  assert.notDeepEqual(validateOperateExperienceArtifactV2('operate-experience-view', { ...view, domainMetrics: [{ metricId: 'met_invalid', inventedValue: 42 }] }), []);
});

test('canonical public readers accept the synchronized valid fixtures', () => {
  const options = { protocolVersion: '2.0.0' };
  assert.equal(readOperateExperienceViewV1(valid['operate-experience-view'], options), valid['operate-experience-view']);
  assert.equal(readOperatingPlanningProposalV1(valid['operating-planning-proposal'], options), valid['operating-planning-proposal']);
  assert.equal(readOperatingOriginV1(valid['operating-origin'], options), valid['operating-origin']);
  assert.equal(readOperatingDeliveryEvidenceV1(valid['operating-delivery-evidence'], options), valid['operating-delivery-evidence']);
});
