import assert from 'node:assert/strict';
import test from 'node:test';

import { runOperatingIntelligenceJourneyV2 } from '../../conformance/verify-operate-v2-operating-intelligence.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  assertOperatingTraceMatrixV2,
  buildOperatingTraceMatrixV2,
  deriveOperatingOmittedRoleAbsenceIdV2,
  locateOperatingTraceNodeV2,
} from '../../lib/operate/trace-matrix-v2.mjs';

function clone(value) {
  return structuredClone(value);
}
function without(value, field) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}
function rehash(matrix) {
  matrix.matrixHash = sha256Jcs(without(matrix, 'matrixHash'));
  return matrix;
}

const journey = runOperatingIntelligenceJourneyV2('business', {
  includeContext: true,
  stopAfterAction: true,
});
const sourceState = journey.context.state;
const planId = sourceState.intelligencePlans[0].planId;
const outcomeJourney = runOperatingIntelligenceJourneyV2('business', { includeContext: true });

function matrix(options = {}) {
  return buildOperatingTraceMatrixV2(clone(sourceState), {
    cycleId: journey.cycleId,
    planId,
    ...options,
  });
}

test('trace matrix exposes one reciprocal requirement-to-evidence-to-action path at one exact scope and Event head', () => {
  const result = matrix();
  const claim = result.nodes.find(
    ({ locator, proofState }) => locator.kind === 'claim' && proofState === 'supported',
  );
  assert.ok(claim);
  const artifactEdge = result.edges.find(
    (edge) => edge.relation === 'contains' && edge.to.id === claim.locator.id,
  );
  const assignmentEdge = result.edges.find(
    (edge) => edge.relation === 'produces' && edge.to.id === artifactEdge.from.id,
  );
  const seatEdge = result.edges.find(
    (edge) => edge.relation === 'issued-as' && edge.to.id === assignmentEdge.from.id,
  );
  const requirementEdge = result.edges.find(
    (edge) => edge.relation === 'assigned-to' && edge.to.id === seatEdge.from.id,
  );
  const evidenceEdge = result.edges.find(
    (edge) => edge.relation === 'supported-by' && edge.from.id === claim.locator.id,
  );
  const decisionEdge = result.edges.find(
    (edge) =>
      edge.relation === 'informs' &&
      edge.from.id === claim.locator.id &&
      edge.to.kind === 'decision',
  );
  const actionEdge = result.edges.find(
    (edge) => edge.relation === 'proposes' && edge.from.id === decisionEdge.to.id,
  );
  assert.ok(requirementEdge);
  assert.ok(evidenceEdge);
  assert.ok(actionEdge);
  for (const edge of result.edges) {
    const from = result.nodes.find(
      ({ locator }) => locator.kind === edge.from.kind && locator.id === edge.from.id,
    );
    const to = result.nodes.find(
      ({ locator }) => locator.kind === edge.to.kind && locator.id === edge.to.id,
    );
    assert.ok(from.outboundEdgeIds.includes(edge.edgeId));
    assert.ok(to.inboundEdgeIds.includes(edge.edgeId));
  }
  for (const { locator } of result.nodes) {
    assert.deepEqual(
      [locator.scopeId, locator.domainId, locator.domainVersion, locator.cycleId],
      [result.scopeId, result.domainId, result.domainVersion, result.cycleId],
    );
  }
  const located = locateOperatingTraceNodeV2(result, claim.locator);
  assert.equal(
    located.outbound.some(({ edgeId }) => edgeId === evidenceEdge.edgeId),
    true,
  );
  assert.equal(
    located.inbound.some(({ edgeId }) => edgeId === artifactEdge.edgeId),
    true,
  );
  assert.deepEqual(result.eventHead, sourceState.eventHead);
});

test('terminal seats do not promote stale or uncited material claims to verified proof', () => {
  const uncited = clone(sourceState);
  uncited.claims[0].supportingEvidenceRefIds = [];
  uncited.claims[0].epistemicStatus = 'speculative';
  const uncitedMatrix = buildOperatingTraceMatrixV2(uncited, { cycleId: journey.cycleId, planId });
  assert.equal(
    uncitedMatrix.nodes.find(({ locator }) => locator.kind === 'claim').proofState,
    'unverified',
  );
  assert.equal(uncitedMatrix.proof.unverifiedClaims, 1);
  assert.equal(
    uncitedMatrix.proof.terminalAssignments >= uncited.intelligencePlans[0].selectedRoles.length,
    true,
  );

  const stale = clone(sourceState);
  stale.evidenceRefs[0].freshness = 'stale';
  const staleMatrix = buildOperatingTraceMatrixV2(stale, { cycleId: journey.cycleId, planId });
  assert.equal(staleMatrix.proof.staleEvidence, 1);
  assert.equal(staleMatrix.proof.supportedClaims, 0);
  assert.equal(staleMatrix.proof.unverifiedClaims, 1);

  const incompleteAction = uncitedMatrix.nodes.find(({ locator }) => locator.kind === 'action');
  assert.notEqual(incompleteAction.proofState, 'completed');
  assert.equal(uncitedMatrix.proof.verifiedActions, 0);
});

test('restricted proof is retained as a typed omission without exposing reciprocal edges', () => {
  const result = matrix({ accessLevel: 'public' });
  const restricted = result.nodes.filter(({ accessState }) => accessState === 'restricted');
  assert.ok(restricted.length > 0);
  for (const node of restricted) {
    assert.equal(node.inboundEdgeIds.length + node.outboundEdgeIds.length, 0);
    assert.ok(
      result.omissions.some(
        (omission) =>
          omission.kind === 'restricted' &&
          omission.subject === node.locator.kind &&
          omission.subjectId === node.locator.id,
      ),
    );
  }
  assert.doesNotThrow(() => assertOperatingTraceMatrixV2(result));
});

test('orphan resolutions and substituted evidence or accepted-output custody fail closed', () => {
  const orphan = clone(sourceState);
  orphan.evidenceResolutions = [];
  assert.throws(() => buildOperatingTraceMatrixV2(orphan, { cycleId: journey.cycleId, planId }), {
    code: 'E_OPERATE_TRACE_DANGLING',
  });

  for (const mutate of [
    (state) => {
      state.artifacts.find(
        ({ artifactId }) => artifactId === state.evidenceRefs[0].evidenceArtifactId,
      ).artifactType = 'advisor-result';
    },
    (state) => {
      state.artifacts.find(
        ({ artifactId }) => artifactId === state.evidenceRefs[0].evidenceArtifactId,
      ).inputArtifactIds = [];
    },
    (state) => {
      state.artifacts.find(
        ({ artifactId }) => artifactId === state.claims[0].sourceArtifactId,
      ).schemaId = 'operating-challenger-review';
    },
  ]) {
    const substituted = clone(sourceState);
    mutate(substituted);
    assert.throws(
      () => buildOperatingTraceMatrixV2(substituted, { cycleId: journey.cycleId, planId }),
      {
        code: 'E_OPERATE_TRACE_DANGLING',
      },
    );
  }

  const foreign = clone(sourceState);
  foreign.claims[0].scopeId = 'foreign-scope';
  assert.throws(() => buildOperatingTraceMatrixV2(foreign, { cycleId: journey.cycleId, planId }), {
    code: 'E_OPERATE_TRACE_FOREIGN_SCOPE',
  });
});

test('verified Action proof requires the exact current Metric, plan, observation, snapshot, source, and Evidence chain', () => {
  const verified = clone(outcomeJourney.context.state);
  verified.actions[0].state = 'completed';
  const verifiedMatrix = buildOperatingTraceMatrixV2(verified, {
    cycleId: outcomeJourney.cycleId,
    planId: verified.intelligencePlans[0].planId,
  });
  assert.equal(verifiedMatrix.proof.verifiedActions, 1);
  assert.equal(
    verifiedMatrix.nodes.find(({ locator }) => locator.kind === 'outcome').proofState,
    'verified',
  );

  const wrongObservation = clone(verified);
  wrongObservation.outcomes[0].observationIds = ['mob_forged_observation_001'];
  assert.throws(
    () =>
      buildOperatingTraceMatrixV2(wrongObservation, {
        cycleId: outcomeJourney.cycleId,
        planId: wrongObservation.intelligencePlans[0].planId,
      }),
    { code: 'E_OPERATE_TRACE_DANGLING' },
  );

  const wrongPlan = clone(verified);
  wrongPlan.outcomes[0].verificationPlanId = 'vfy_foreign_plan_001';
  assert.throws(
    () =>
      buildOperatingTraceMatrixV2(wrongPlan, {
        cycleId: outcomeJourney.cycleId,
        planId: wrongPlan.intelligencePlans[0].planId,
      }),
    { code: 'E_OPERATE_TRACE_DANGLING' },
  );

  const staleMetric = clone(verified);
  staleMetric.operatingModelStates.find(
    ({ snapshotId }) =>
      snapshotId ===
      [...staleMetric.operatingSnapshots]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .at(-1).snapshotId,
  ).metrics[0].freshness = 'stale';
  const staleMatrix = buildOperatingTraceMatrixV2(staleMetric, {
    cycleId: outcomeJourney.cycleId,
    planId: staleMetric.intelligencePlans[0].planId,
  });
  assert.equal(staleMatrix.proof.verifiedActions, 0);
  assert.equal(
    staleMatrix.nodes.find(({ locator }) => locator.kind === 'outcome').proofState,
    'insufficient',
  );
  assert.equal(
    staleMatrix.nodes.find(({ locator }) => locator.kind === 'action').proofState,
    'insufficient',
  );
});

test('closed trace assertion rejects rehashed schema, ordering, dangling, duplicate, cyclic, and oversized attacks', () => {
  const valid = matrix();
  const schemaAttacks = [
    (candidate) => {
      candidate.unexpected = true;
    },
    (candidate) => {
      candidate.nodes[0].accessState = 'leaked';
    },
    (candidate) => {
      candidate.omissions[0].reasonCode = 'TRUST_ME';
    },
  ];
  for (const mutate of schemaAttacks) {
    const candidate = clone(valid);
    mutate(candidate);
    assert.throws(() => assertOperatingTraceMatrixV2(rehash(candidate)), {
      code: 'E_PROTOCOL_ARTIFACT_INVALID',
    });
  }

  const unsorted = clone(valid);
  unsorted.nodes.reverse();
  assert.throws(() => assertOperatingTraceMatrixV2(rehash(unsorted)), {
    code: 'E_OPERATE_TRACE_GRAPH_INVALID',
  });

  const dangling = clone(valid);
  dangling.edges[0].to.id = 'missing-node';
  dangling.edges[0].edgeId = `tre_${sha256Jcs({
    relation: dangling.edges[0].relation,
    from: dangling.edges[0].from,
    to: dangling.edges[0].to,
  }).slice(7, 39)}`;
  dangling.edges.sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  assert.throws(() => assertOperatingTraceMatrixV2(rehash(dangling)), {
    code: 'E_OPERATE_TRACE_DANGLING',
  });

  const duplicate = clone(valid);
  duplicate.nodes.push(clone(duplicate.nodes[0]));
  duplicate.nodes.sort((left, right) =>
    `${left.locator.kind}:${left.locator.id}`.localeCompare(
      `${right.locator.kind}:${right.locator.id}`,
    ),
  );
  assert.throws(() => assertOperatingTraceMatrixV2(rehash(duplicate)), {
    code: 'E_OPERATE_TRACE_DUPLICATE',
  });

  const cyclic = clone(valid);
  const edge = cyclic.edges.find(({ relation }) => relation === 'supported-by');
  [edge.from, edge.to] = [edge.to, edge.from];
  edge.edgeId = `tre_${sha256Jcs({ relation: edge.relation, from: edge.from, to: edge.to }).slice(7, 39)}`;
  cyclic.edges.sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  assert.throws(() => assertOperatingTraceMatrixV2(rehash(cyclic)), {
    code: 'E_OPERATE_TRACE_CYCLE',
  });

  const oversized = clone(valid);
  oversized.nodes = Array.from({ length: 8193 }, (_, index) => ({
    ...clone(valid.nodes[0]),
    locator: {
      ...clone(valid.nodes[0].locator),
      id: `oversized:${String(index).padStart(5, '0')}`,
    },
    inboundEdgeIds: [],
    outboundEdgeIds: [],
  }));
  assert.throws(() => assertOperatingTraceMatrixV2(rehash(oversized)), {
    code: 'E_PROTOCOL_ARTIFACT_INVALID',
  });
});

test('trace construction rejects caller-supplied Event-head relabeling', () => {
  assert.throws(
    () =>
      matrix({
        eventHead: { sequence: sourceState.eventHead.sequence, hash: `sha256:${'f'.repeat(64)}` },
      }),
    { code: 'E_OPERATE_TRACE_BINDING_INVALID' },
  );
});

test('omitted-role absence identity is deterministic and plan-bound', () => {
  const first = deriveOperatingOmittedRoleAbsenceIdV2(planId, 'independent-challenge', '2.0.0');
  const replay = deriveOperatingOmittedRoleAbsenceIdV2(planId, 'independent-challenge', '2.0.0');
  const foreign = deriveOperatingOmittedRoleAbsenceIdV2(
    'ipl_foreign_0001',
    'independent-challenge',
    '2.0.0',
  );
  assert.match(first, /^abs_[a-f0-9]{32}$/u);
  assert.equal(first, replay);
  assert.notEqual(first, foreign);
});
