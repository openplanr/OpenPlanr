import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildOperatingTerminalVerificationAssignmentV2 } from '../../lib/operate/execution-verification-v2.mjs';
import {
  buildOperatingCycleWorkViewV2,
  buildOperatingWorkLedgerV2,
} from '../../lib/operate/persistent-work-projections-v2.mjs';
import {
  derivePersistentOperatingActionRevisionHashV2,
  derivePersistentOperatingExecutionVerificationProjectionV2,
} from '../../lib/operate/persistent-work-v2.mjs';
import {
  createEmptyOperatingRuntimeStateV2,
  transitionOperatingActionLifecycleV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const TIME = '2026-08-08T12:00:00.000Z';
const scope = { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' };
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

function cycle(cycleId, state = 'closed') {
  return {
    kind: 'operating-cycle',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    cycleId,
    ...scope,
    state,
    inputBindingId: `inb_${cycleId.slice(4)}`,
    contractVersions: {},
    trigger: { kind: 'manual' },
    focus: ['retention'],
    health: 'normal',
    activeReviewId: null,
    createdAt: TIME,
    updatedAt: TIME,
    ...(state === 'closed' ? { closedAt: TIME } : {}),
  };
}

function state() {
  return {
    ...createEmptyOperatingRuntimeStateV2(TIME),
    cycles: [cycle('cyc_00000001'), cycle('cyc_00000002')],
    findings: [
      {
        ...clone(valid['operating-finding']),
        findingId: 'fnd_00000001',
        ...scope,
        sourceCycleId: 'cyc_00000001',
        sourceArtifactId: 'art_00000001',
        title: 'Retention risk',
        statement: 'Retention is declining.',
        state: 'deferred',
        ownerActorId: 'owner-001',
        revisitAt: null,
        createdAt: TIME,
        updatedAt: TIME,
      },
    ],
    decisions: [
      {
        ...clone(valid['operating-decision']),
        decisionId: 'dec_00000001',
        ...scope,
        sourceCycleId: 'cyc_00000001',
        sourceArtifactId: 'art_00000001',
        title: 'Prioritize retention',
        question: 'What should we prioritize?',
        outcome: null,
        rationale: 'It is the largest current risk.',
        state: 'deferred',
        ownerActorId: 'owner-001',
        revisitAt: null,
        revision: 1,
        predecessorDecisionId: null,
        createdAt: TIME,
        updatedAt: TIME,
      },
    ],
    actions: [
      {
        ...clone(valid['operating-action']),
        actionId: 'act_00000001',
        ...scope,
        sourceCycleId: 'cyc_00000001',
        sourceArtifactId: 'art_00000001',
        title: 'Interview customers',
        state: 'deferred',
        ownerActorId: 'owner-001',
        accountabilityDisposition: null,
        sourceDecisionId: 'dec_00000001',
        sourceFindingIds: ['fnd_00000001'],
        dependsOnActionIds: [],
        createdAt: TIME,
        updatedAt: TIME,
      },
    ],
    reviews: [
      {
        kind: 'operating-review',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        reviewId: 'rev_00000002',
        cycleId: 'cyc_00000002',
        ownerActorId: 'owner-001',
        state: 'approved',
        disposition: 'approved',
        createdAt: TIME,
        updatedAt: TIME,
        workDispositions: [
          { entityType: 'operating-finding', entityId: 'fnd_00000001', disposition: 'deferred' },
          { entityType: 'operating-decision', entityId: 'dec_00000001', disposition: 'deferred' },
          { entityType: 'operating-action', entityId: 'act_00000001', disposition: 'deferred' },
        ],
      },
    ],
  };
}

test('scope ledger retains durable work and reconstructs source, touch, and carry-forward links deterministically', () => {
  const before = state();
  const first = buildOperatingWorkLedgerV2(before, scope);
  const second = buildOperatingWorkLedgerV2(before, scope);
  assert.deepEqual(first, second);
  assert.equal(first.findings.length, 1);
  assert.equal(first.decisions.length, 1);
  assert.equal(first.actions.length, 1);
  assert.ok(
    first.cycleLinks.some((link) => link.relation === 'source' && link.cycleId === 'cyc_00000001'),
  );
  assert.equal(
    first.cycleLinks.filter(
      (link) => link.relation === 'carried-forward' && link.cycleId === 'cyc_00000002',
    ).length,
    3,
  );
  assert.equal(before.findings[0].state, 'deferred');
  assert.equal(
    first.cycleLinks.filter(
      (link) => link.relation === 'carried-forward' && link.cycleId === 'cyc_00000001',
    ).length,
    0,
    'a closed source Cycle cannot invent carry-forward without owned execution verification',
  );
});

test('cycle views link existing ledger entities without becoming another mutable owner', () => {
  const before = state();
  const source = buildOperatingCycleWorkViewV2(before, 'cyc_00000001');
  const later = buildOperatingCycleWorkViewV2(before, 'cyc_00000002');
  assert.equal(source.findings[0].findingId, 'fnd_00000001');
  assert.equal(later.findings[0].findingId, 'fnd_00000001');
  assert.ok(later.cycleLinks.some((link) => link.relation === 'carried-forward'));
  later.findings[0].title = 'Local copy only';
  assert.equal(before.findings[0].title, 'Retention risk');
});

test('execution verification projection is scope-safe, order-stable, and retains later-cycle provenance', () => {
  const approvedAction = clone(
    JSON.parse(
      readFileSync(
        new URL(
          '../../conformance/fixtures/operating-runtime-v2/authorization-valid.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ).action,
  );
  approvedAction.actionHash = derivePersistentOperatingActionRevisionHashV2(approvedAction);
  approvedAction.revisionId = `actrev_${sha256Jcs({
    actionId: approvedAction.actionId,
    revision: approvedAction.revision,
    actionHash: approvedAction.actionHash,
  }).slice('sha256:'.length)}`;
  const queuedAction = transitionOperatingActionLifecycleV2(approvedAction, 'queued', {
    updatedAt: '2026-08-10T08:01:30Z',
  });
  const startedAction = transitionOperatingActionLifecycleV2(queuedAction, 'in_progress', {
    updatedAt: '2026-08-10T08:02:00Z',
  });
  const action = transitionOperatingActionLifecycleV2(startedAction, 'completed', {
    updatedAt: '2026-08-10T08:03:00Z',
  });
  const verificationPlan = {
    kind: 'operating-action-verification-plan',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    verificationPlanId: action.verificationPlanId,
    actionId: action.actionId,
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    metricId: action.metricId,
    baseline: action.baseline,
    target: action.target,
    window: action.verificationWindow,
    method: 'Compare the accepted observation with the target.',
    observationRequest: { kind: 'future-observation', reason: action.expectedResult },
    evaluationRules: ['succeeded: target reached.'],
    revisitDecisionIds: [action.sourceDecisionId],
    sourceArtifactId: action.sourceArtifactId,
    createdAt: action.createdAt,
  };
  const contracts = JSON.parse(
    readFileSync(
      new URL(
        '../../conformance/fixtures/operating-runtime-v2/governed-execution-contracts-valid.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const result = {
    ...clone(contracts['operating-execution-result']),
    action: {
      actionId: action.actionId,
      revision: action.revision,
      actionHash: action.actionHash,
    },
  };
  const operation = {
    ...clone(contracts['operating-governed-operation']),
    action: clone(result.action),
    state: result.status,
    resultId: result.resultId,
    updatedAt: result.completedAt,
  };
  delete operation.operationHash;
  operation.operationHash = sha256Jcs(operation);
  const sourceCycle = {
    ...clone(valid['operating-cycle']),
    cycleId: action.sourceCycleId,
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    state: 'verifying',
    activeReviewId: null,
  };
  const laterCycle = {
    ...clone(sourceCycle),
    cycleId: 'cyc_projection_later_0001',
    inputBindingId: 'inb_projection_later_0001',
    state: 'advising',
    createdAt: result.completedAt,
    updatedAt: result.completedAt,
  };
  const assignment = buildOperatingTerminalVerificationAssignmentV2({
    action,
    cycle: sourceCycle,
    operation,
    result,
    verificationPlan,
    timestamp: result.completedAt,
  });
  const verification = JSON.parse(
    readFileSync(
      new URL(
        '../../conformance/fixtures/operating-runtime-v2/action-verification-valid.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const outcome = {
    ...clone(verification.outcome),
    actionId: action.actionId,
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    verificationPlanId: verificationPlan.verificationPlanId,
    status: 'succeeded',
  };
  const learning = {
    ...clone(verification.learning),
    outcomeId: outcome.outcomeId,
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    sourceArtifactId: outcome.sourceArtifactId,
    evidenceRefIds: [...outcome.evidenceRefIds],
  };
  const snapshot = {
    ...clone(valid['operating-snapshot']),
    snapshotId: 'snp_projection_later_0001',
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    domainContract: {
      apiDomainId: action.domainId,
      id: `${action.domainId}-domain`,
      version: action.domainVersion,
    },
    stateId: 'oms_projection_later_0001',
    createdAt: '2026-08-10T13:00:00Z',
  };
  const delta = {
    ...clone(valid['operating-delta']),
    deltaId: 'dlt_projection_later_0001',
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    currentSnapshotId: snapshot.snapshotId,
    decisionRevisitIds: [action.sourceDecisionId],
    derivedAt: '2026-08-10T13:01:00Z',
  };
  const foreignSnapshot = {
    ...clone(snapshot),
    snapshotId: 'snp_projection_foreign_0001',
    domainId: 'business',
    domainContract: {
      apiDomainId: 'business',
      id: 'business-domain',
      version: action.domainVersion,
    },
    createdAt: '2026-08-10T14:00:00Z',
  };
  const foreignDelta = {
    ...clone(delta),
    deltaId: 'dlt_projection_foreign_0001',
    domainId: 'business',
    currentSnapshotId: foreignSnapshot.snapshotId,
    derivedAt: '2026-08-10T14:01:00Z',
  };
  const input = {
    action,
    verificationPlan,
    operations: [operation],
    executionResults: [result],
    verificationAssignments: [assignment],
    outcomes: [outcome],
    learnings: [learning],
    deltas: [foreignDelta, delta],
    snapshots: [foreignSnapshot, snapshot],
    sourceCycle,
    cycle: laterCycle,
  };
  const projection = derivePersistentOperatingExecutionVerificationProjectionV2(input);
  const reordered = derivePersistentOperatingExecutionVerificationProjectionV2({
    ...input,
    deltas: [...input.deltas].reverse(),
    snapshots: [...input.snapshots].reverse(),
  });
  assert.equal(projection.executionStatus, 'success');
  assert.equal(projection.hypothesisStatus, 'revisit');
  assert.equal(projection.verificationAssignmentId, assignment.assignmentId);
  assert.equal(projection.outcomeId, outcome.outcomeId);
  assert.equal(projection.learningId, learning.learningId);
  assert.equal(projection.deltaId, delta.deltaId);
  assert.equal(projection.snapshotId, snapshot.snapshotId);
  assert.equal(projection.carriedForward, true);
  assert.equal(reordered.projectionHash, projection.projectionHash);
  assert.throws(
    () =>
      derivePersistentOperatingExecutionVerificationProjectionV2({
        ...input,
        executionResults: [
          { ...result, action: { ...result.action, revision: result.action.revision + 1 } },
        ],
      }),
    (error) => error?.code === 'ACTION_REVISION_MISMATCH',
  );
  const foreign = {
    scopeId: 'scope-foreign',
    domainId: action.domainId === 'business' ? 'software' : 'business',
    domainVersion: '9.9.9',
  };
  for (const field of ['scopeId', 'domainId', 'domainVersion']) {
    assert.throws(
      () =>
        derivePersistentOperatingExecutionVerificationProjectionV2({
          ...input,
          verificationPlan: { ...verificationPlan, [field]: foreign[field] },
        }),
      (error) => error?.code === 'ACTION_REVISION_MISMATCH',
    );
    assert.throws(
      () =>
        derivePersistentOperatingExecutionVerificationProjectionV2({
          ...input,
          sourceCycle: { ...sourceCycle, [field]: foreign[field] },
        }),
      (error) => error?.code === 'OPERATING_SCOPE_INVALID',
    );
  }
  const forged = {
    ...clone(assignment),
    assignmentId: 'asg_vfy_forged_projection_0001',
  };
  for (const verificationAssignments of [
    [forged, assignment],
    [assignment, forged],
  ]) {
    assert.throws(
      () =>
        derivePersistentOperatingExecutionVerificationProjectionV2({
          ...input,
          verificationAssignments,
        }),
      (error) => error?.code === 'RESULT_CONTRACT_INVALID',
    );
  }
  assert.throws(
    () =>
      derivePersistentOperatingExecutionVerificationProjectionV2({
        ...input,
        verificationAssignments: [
          { ...clone(assignment), objective: 'Forged verification ownership.' },
        ],
      }),
    (error) => error?.code === 'RESULT_CONTRACT_INVALID',
  );
});
