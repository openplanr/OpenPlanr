import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendOperatingApprovalRecordV2,
  assertOperatingApprovalRequirementIntegrityV2,
  consumeOperatingApprovalRecordsV2,
  createOperatingActionReviewV2,
  createOperatingApprovalRecordV2,
  createOperatingApprovalRequirementV2,
  evaluateOperatingApprovalSetV2,
  partitionSupersededOperatingAuthorityV2,
} from '../../lib/operate/approvals-v2.mjs';
import { evaluateOperatingActionPolicyV2 } from '../../lib/operate/policy-v2.mjs';
import { assertProtocolArtifact } from '../../lib/protocol/contracts.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import { action, policy } from './operate-policy-v2.test.mjs';

const TIME = '2026-08-10T08:00:00Z';
const LATER = '2026-08-10T08:01:00Z';
const EXPIRY = '2026-08-11T08:00:00Z';

function authority(mode = 'named-single-party') {
  const value = action();
  const requirementId = mode === 'named-single-party' ? 'aprq_single001' : 'aprq_multi0001';
  const selectedPolicy = policy(value, {
    tier: 'domain', decisionMode: mode, approvalRequirementIds: [requirementId],
  });
  const corePolicy = policy(value, {
    tier: 'core', decisionMode: 'automatic', approvalRequirementIds: [],
  });
  const evaluation = evaluateOperatingActionPolicyV2({
    action: value, configuredPolicies: [corePolicy, selectedPolicy], evaluatedAt: TIME,
  });
  const parties = mode === 'named-single-party'
    ? [{ partyId: 'owner-party', actorKind: 'human', actorId: 'owner-0001', requiredCapability: { id: 'action-approve', version: '1.0.0' } }]
    : [1, 2, 3].map((index) => ({
      partyId: `owner-${index}-party`, actorKind: 'human', actorId: `owner-000${index}`,
      requiredCapability: { id: 'action-approve', version: '1.0.0' },
    }));
  const requirement = createOperatingApprovalRequirementV2({
    policyRequirementId: requirementId, evaluation, action: value, parties,
    threshold: mode === 'threshold' ? 2 : undefined,
    expiresAt: EXPIRY, consumable: true,
  });
  return { action: value, policies: [corePolicy, selectedPolicy], policy: selectedPolicy, evaluation, requirement, parties, policyRequirementId: requirementId };
}

function record(state, index = 0, decision = 'approved', approvalId = `aprv_record00${index + 1}`) {
  const party = state.parties[index];
  return createOperatingApprovalRecordV2({
    approvalId, requirement: state.requirement, evaluation: state.evaluation, action: state.action,
    partyId: party.partyId,
    actor: { kind: party.actorKind, actorId: party.actorId, capability: party.requiredCapability },
    decision, issuedAt: LATER, expiresAt: EXPIRY,
  });
}

function rehashRequirement(requirement) {
  const next = structuredClone(requirement);
  delete next.scopeHash;
  next.scopeHash = sha256Jcs(next);
  return next;
}

test('single-party approval binds exact Action/policy/target/actor scope and replay is harmless', () => {
  const state = authority();
  const approval = record(state);
  const first = appendOperatingApprovalRecordV2({ records: [], record: approval, requirement: state.requirement });
  const replay = appendOperatingApprovalRecordV2({ records: first.records, record: approval, requirement: state.requirement });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.records, first.records);
  assert.deepEqual(evaluateOperatingApprovalSetV2({
    evaluation: state.evaluation, action: state.action,
    requirements: [state.requirement], approvals: first.records, now: '2026-08-10T08:02:00Z',
  }), {
    complete: true, disposition: 'approved', approvalIds: [approval.approvalId],
    requirementIds: [state.requirement.requirementId], reasonCode: 'approval-quorum-complete',
  });
  const divergent = record(state, 0, 'rejected', approval.approvalId);
  assert.throws(() => appendOperatingApprovalRecordV2({
    records: first.records, record: divergent, requirement: state.requirement,
  }), ({ code }) => code === 'APPROVAL_INVALID');
});

test('canonical requirement integrity rejects schema-valid forged parties, cardinality, and derived actor sets', () => {
  const single = authority();
  const outsiderParty = {
    ...structuredClone(single.parties[0]),
    partyId: 'outsider-party',
    actorId: null,
  };
  const forgedSingle = rehashRequirement({
    ...structuredClone(single.requirement),
    parties: [...structuredClone(single.requirement.parties), outsiderParty],
  });
  assert.doesNotThrow(() => assertProtocolArtifact('operating-approval-requirement', forgedSingle, {
    protocolVersion: '2.0.0',
  }));
  assert.throws(() => assertOperatingApprovalRequirementIntegrityV2(forgedSingle),
    ({ code }) => code === 'APPROVAL_INVALID');
  assert.throws(() => createOperatingApprovalRecordV2({
    approvalId: 'aprv_outsider01', requirement: forgedSingle, evaluation: single.evaluation, action: single.action,
    partyId: outsiderParty.partyId,
    actor: {
      kind: outsiderParty.actorKind,
      actorId: 'outsider-0001',
      capability: outsiderParty.requiredCapability,
    },
    decision: 'approved', issuedAt: LATER, expiresAt: EXPIRY,
  }), ({ code }) => code === 'APPROVAL_INVALID');

  const multi = authority('named-multi-party');
  const thresholdTooSmall = rehashRequirement({ ...structuredClone(multi.requirement), threshold: 2 });
  const wrongNamedActors = rehashRequirement({
    ...structuredClone(multi.requirement),
    namedActorIds: ['owner-0001', 'owner-0002', 'outsider-0001'],
  });
  const wrongActorKinds = rehashRequirement({
    ...structuredClone(multi.requirement),
    requiredActorKinds: ['engine'],
  });
  const duplicatePartyId = structuredClone(multi.requirement);
  duplicatePartyId.parties[1].partyId = duplicatePartyId.parties[0].partyId;
  const forgedDuplicateParty = rehashRequirement(duplicatePartyId);
  for (const forged of [thresholdTooSmall, wrongNamedActors, wrongActorKinds, forgedDuplicateParty]) {
    assert.doesNotThrow(() => assertProtocolArtifact('operating-approval-requirement', forged, {
      protocolVersion: '2.0.0',
    }));
    assert.throws(() => assertOperatingApprovalRequirementIntegrityV2(forged),
      ({ code }) => code === 'APPROVAL_INVALID');
  }

  const threshold = authority('threshold');
  const wildcardThreshold = structuredClone(threshold.requirement);
  wildcardThreshold.parties[2].actorId = null;
  wildcardThreshold.namedActorIds = wildcardThreshold.namedActorIds.slice(0, 2);
  const forgedWildcardThreshold = rehashRequirement(wildcardThreshold);
  assert.doesNotThrow(() => assertProtocolArtifact('operating-approval-requirement', forgedWildcardThreshold, {
    protocolVersion: '2.0.0',
  }));
  assert.throws(() => assertOperatingApprovalRequirementIntegrityV2(forgedWildcardThreshold),
    ({ code }) => code === 'APPROVAL_INVALID');
});

test('threshold and named multi-party quorum reject partial, duplicate actor, stale, and consumed authority', () => {
  const state = authority('threshold');
  const first = record(state, 0);
  const second = record(state, 1);
  assert.equal(evaluateOperatingApprovalSetV2({
    evaluation: state.evaluation, action: state.action, requirements: [state.requirement], approvals: [first], now: '2026-08-10T08:02:00Z',
  }).complete, false);
  assert.equal(evaluateOperatingApprovalSetV2({
    evaluation: state.evaluation, action: state.action, requirements: [state.requirement], approvals: [first, second], now: '2026-08-10T08:02:00Z',
  }).complete, true);

  const duplicateActorParties = structuredClone(state.parties);
  duplicateActorParties[1].actorId = duplicateActorParties[0].actorId;
  assert.throws(() => createOperatingApprovalRequirementV2({
    policyRequirementId: state.policyRequirementId, evaluation: state.evaluation, action: state.action,
    parties: duplicateActorParties, threshold: 2, expiresAt: EXPIRY,
  }), ({ code }) => code === 'APPROVAL_INVALID');

  assert.throws(() => evaluateOperatingApprovalSetV2({
    evaluation: state.evaluation, action: state.action, requirements: [state.requirement], approvals: [first, second], now: EXPIRY,
  }), ({ code }) => code === 'APPROVAL_EXPIRED');
  const consumed = consumeOperatingApprovalRecordsV2({
    approvals: [first, second], requirements: [state.requirement],
    approvalIds: [first.approvalId, second.approvalId], operationId: 'op_approval001',
  });
  assert.equal(consumed.history.every(({ consumedByOperationId }) => consumedByOperationId === null), true);
  assert.equal(consumed.records.every(({ consumedByOperationId }) => consumedByOperationId === 'op_approval001'), true);
  assert.throws(() => evaluateOperatingApprovalSetV2({
    evaluation: state.evaluation, action: state.action, requirements: [state.requirement], approvals: consumed.records, now: '2026-08-10T08:02:00Z',
  }), ({ code }) => code === 'APPROVAL_INVALID');
});

test('actor-to-party uniqueness is global across requirements and non-consumable authority cannot be consumed', () => {
  const value = action();
  const templateIds = ['aprq_globalone', 'aprq_globaltwo'];
  const corePolicy = policy(value, { tier: 'core', decisionMode: 'automatic' });
  const selectedPolicy = policy(value, {
    tier: 'domain', decisionMode: 'named-single-party', approvalRequirementIds: templateIds,
  });
  const evaluation = evaluateOperatingActionPolicyV2({
    action: value, configuredPolicies: [corePolicy, selectedPolicy], evaluatedAt: TIME,
  });
  const duplicateActorRequirements = templateIds.map((policyRequirementId, index) => createOperatingApprovalRequirementV2({
    policyRequirementId, evaluation, action: value,
    parties: [{
      partyId: `global-${index + 1}-party`, actorKind: 'human', actorId: 'owner-0001',
      requiredCapability: { id: 'action-approve', version: '1.0.0' },
    }],
    expiresAt: EXPIRY,
  }));
  assert.throws(() => evaluateOperatingApprovalSetV2({
    evaluation, action: value, requirements: duplicateActorRequirements, approvals: [], now: LATER,
  }), ({ code }) => code === 'APPROVAL_INVALID');

  const single = authority();
  const nonConsumable = createOperatingApprovalRequirementV2({
    policyRequirementId: single.policyRequirementId,
    evaluation: single.evaluation,
    action: single.action,
    parties: single.parties,
    expiresAt: EXPIRY,
    consumable: false,
  });
  const approval = createOperatingApprovalRecordV2({
    approvalId: 'aprv_noconsume1', requirement: nonConsumable, evaluation: single.evaluation, action: single.action,
    partyId: single.parties[0].partyId,
    actor: {
      kind: single.parties[0].actorKind, actorId: single.parties[0].actorId,
      capability: single.parties[0].requiredCapability,
    },
    decision: 'approved', issuedAt: LATER, expiresAt: EXPIRY,
  });
  assert.throws(() => consumeOperatingApprovalRecordsV2({
    approvals: [approval], requirements: [nonConsumable], approvalIds: [approval.approvalId],
    operationId: 'op_noconsume1',
  }), ({ code }) => code === 'APPROVAL_INVALID');
  const widenedRequirement = structuredClone(nonConsumable);
  widenedRequirement.consumable = true;
  assert.throws(() => consumeOperatingApprovalRecordsV2({
    approvals: [approval], requirements: [widenedRequirement], approvalIds: [approval.approvalId],
    operationId: 'op_noconsume1',
  }), ({ code }) => code === 'APPROVAL_INVALID');
});

test('re-evaluation supersedes only prior authority while preserving history', () => {
  const state = authority();
  const approval = record(state);
  const nextEvaluation = evaluateOperatingActionPolicyV2({
    action: state.action,
    configuredPolicies: state.policies,
    evaluatedAt: '2026-08-10T08:03:00Z',
  });
  const nextRequirement = createOperatingApprovalRequirementV2({
    policyRequirementId: state.policyRequirementId,
    evaluation: nextEvaluation,
    action: state.action,
    parties: state.parties,
    expiresAt: EXPIRY,
    consumable: true,
  });
  assert.notEqual(nextRequirement.requirementId, state.requirement.requirementId);
  const partition = partitionSupersededOperatingAuthorityV2({
    evaluation: state.evaluation, requirements: [state.requirement], approvals: [approval], currentEvaluationId: nextEvaluation.evaluationId,
  });
  assert.equal(partition.activeEvaluation, null);
  assert.deepEqual(partition.supersededEvaluations, [state.evaluation]);
  assert.deepEqual(partition.supersededRequirements, [state.requirement]);
  assert.deepEqual(partition.supersededApprovals, [approval]);
});

test('Action-scoped Review binds one exact Action revision and is separate from Cycle review authority', () => {
  const state = authority();
  const review = createOperatingActionReviewV2({
    reviewId: 'rev_action0001', action: state.action, ownerActorId: 'owner-0001', timestamp: TIME,
  });
  assert.deepEqual(review.subject, {
    type: 'action', actionId: state.action.actionId, revision: state.action.revision, actionHash: state.action.actionHash,
  });
  assert.equal(review.cycleId, state.action.sourceCycleId);
  assert.doesNotThrow(() => assertProtocolArtifact('operating-review', review, { protocolVersion: '2.0.0' }));
});

test('empty automatic authority still rejects copied Action identity and future evaluation time', () => {
  const value = action();
  const selectedPolicy = policy(value, { tier: 'domain', decisionMode: 'automatic' });
  const corePolicy = policy(value, { tier: 'core', decisionMode: 'automatic' });
  const evaluation = evaluateOperatingActionPolicyV2({
    action: value, configuredPolicies: [corePolicy, selectedPolicy], evaluatedAt: TIME,
  });
  assert.equal(evaluateOperatingApprovalSetV2({
    evaluation, action: value, requirements: [], approvals: [], now: LATER,
  }).disposition, 'approved');
  const copied = structuredClone(value);
  copied.actionHash = `sha256:${'f'.repeat(64)}`;
  assert.throws(() => evaluateOperatingApprovalSetV2({
    evaluation, action: copied, requirements: [], approvals: [], now: LATER,
  }), ({ code }) => code === 'APPROVAL_INVALID');
  assert.throws(() => evaluateOperatingApprovalSetV2({
    evaluation, action: value, requirements: [], approvals: [], now: '2026-08-10T07:59:59Z',
  }), ({ code }) => code === 'APPROVAL_INVALID');
});

export { authority, record };
