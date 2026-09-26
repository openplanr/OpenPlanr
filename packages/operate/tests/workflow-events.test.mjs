import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sha256Jcs } from '@openplanr/protocol/canonical-json';

import { buildPersistentWorkMaterializationPayloadV2 } from '../lib/operate/persistent-work-v2.mjs';
import { createWorkflowRuntimeEventHandlerV2 } from '../lib/operate/runtime-foundation/workflow-events.mjs';
import {
  assertHandlesExactly,
  clone,
  handlerDependencies,
  RUNTIME_EVENT_TYPES,
  runtimeError,
  TIME,
} from './runtime-foundation-events.test-support.mjs';

function boundCycleIndex() {
  return {
    cycles: new Map([
      [
        'cyc_00000001',
        {
          cycleId: 'cyc_00000001',
          scopeId: 'scope-acme',
          domainId: 'business',
          domainVersion: '1.0.0',
          inputBindingId: 'inb_00000001',
          contractVersions: { 'advisor-result': '1.0.0' },
        },
      ],
    ]),
    inputBindings: new Map([
      ['inb_00000001', { inputBindingId: 'inb_00000001', cycleId: 'cyc_00000001' }],
    ]),
  };
}

function inputBoundEvent(payload = {}) {
  return {
    type: 'cycle.input-bound',
    cycleId: 'cyc_00000001',
    entityId: 'inb_00000001',
    payload: {
      inputBindingId: 'inb_00000001',
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
      contractVersions: { 'advisor-result': '1.0.0' },
      ...payload,
    },
  };
}

function deferredActionIndex(action = {}) {
  return {
    actions: new Map([
      [
        'act_00000001',
        {
          actionId: 'act_00000001',
          sourceCycleId: 'cyc_00000001',
          revision: 2,
          actionHash: `sha256:${'d'.repeat(64)}`,
          state: 'deferred',
          ...action,
        },
      ],
    ]),
  };
}

function reopenedEvent(event = {}) {
  return {
    type: 'action.reopened',
    cycleId: 'cyc_00000001',
    entityId: 'act_00000001',
    timestamp: TIME,
    actor: { kind: 'engine', id: 'openplanr' },
    payload: {
      action: { actionId: 'act_00000001', revision: 2, actionHash: `sha256:${'d'.repeat(64)}` },
      from: 'deferred',
      to: 'proposed',
      operationId: null,
      resultId: null,
      reasonCode: null,
    },
    ...event,
  };
}

function workChangeSet() {
  return {
    kind: 'operating-work-change-set',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    cycleId: 'cyc_00000001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    findings: [
      {
        draftRef: 'draft_find_0001',
        title: 'Revenue risk',
        statement: 'Revenue is below plan.',
        state: 'open',
        ownerActorId: 'owner-001',
        revisitAt: null,
      },
    ],
    decisions: [
      {
        draftRef: 'draft_decision_01',
        title: 'Prioritize retention',
        question: 'What should we prioritize?',
        rationale: 'Retention is the largest current risk.',
        evidenceRefIds: ['evr_00000001'],
        alternatives: ['Prioritize acquisition'],
        confidence: 0.8,
        assumptionIds: [],
        expectedUpside: 'Retention improves.',
        expectedDownside: 'Acquisition learning slows.',
        dissent: [],
        reopenConditions: ['Retention evidence changes materially.'],
        revisitConditions: ['Metric changes.'],
        ownerActorId: 'owner-001',
        revisitAt: null,
      },
    ],
    actions: [
      {
        draftRef: 'draft_action_001',
        title: 'Interview customers',
        ownerActorId: 'owner-001',
        accountabilityDisposition: null,
        sourceDecisionDraftRef: 'draft_decision_01',
        sourceFindingDraftRefs: ['draft_find_0001'],
        dependsOnActionDraftRefs: [],
        objectiveId: 'obj_retention_001',
        expectedResult: 'Customer interviews reveal retention friction.',
        metricId: 'met_retention_001',
        baseline: 0.4,
        target: 0.6,
        verificationWindow: 'next 30-day window',
        verificationPlanId: 'vfy_retention_001',
      },
    ],
  };
}

// The current Chair contract emits a decision ledger, so only a historical Artifact carries a
// work-change-set; the reducer reaches this case through requireValidatedWorkChangeSetArtifact.
function legacyWorkChangeSetArtifact(work) {
  const canonicalHash = sha256Jcs(work);
  return {
    kind: 'operating-artifact',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    artifactId: 'art_workset_001',
    artifactType: 'work-change-set',
    assignmentId: 'asg_legacy_chair_0001',
    cycleId: 'cyc_00000001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    schemaId: 'operating-work-change-set',
    artifactSchemaVersion: '2.0.0',
    mediaType: 'application/json',
    encoding: 'utf-8',
    rawHash: canonicalHash,
    canonicalHash,
    sizeBytes: Buffer.byteLength(JSON.stringify(work)),
    storageClass: 'machine-local',
    sensitivity: 'internal',
    retentionClass: 'project',
    producer: { actorId: 'chair-001', roleId: 'chair', runtime: 'codex' },
    inputArtifactIds: [],
    createdAt: TIME,
  };
}

function workIndex(artifact) {
  return {
    artifacts: new Map([[artifact.artifactId, artifact]]),
    findings: new Map(),
    decisions: new Map(),
    actions: new Map(),
    workReplay: new Map(),
  };
}

test('workflow handler applies exactly the Cycle, Review, board, work and Action Events', () => {
  assertHandlesExactly(
    createWorkflowRuntimeEventHandlerV2(handlerDependencies({ runtimeError })),
    RUNTIME_EVENT_TYPES.workflow,
  );
});

test('cycle.input-bound accepts only the durable Cycle binding and changes no state', () => {
  const apply = createWorkflowRuntimeEventHandlerV2(handlerDependencies({ runtimeError }));
  const index = boundCycleIndex();
  apply(index, inputBoundEvent());
  assert.deepEqual(index, boundCycleIndex());

  assert.throws(() => apply(index, inputBoundEvent({ scopeId: 'scope-other' })), {
    code: 'OPERATING_SCOPE_INVALID',
  });
  assert.throws(
    () => apply(index, inputBoundEvent({ contractVersions: { 'advisor-result': '2.0.0' } })),
    { code: 'OPERATING_SCOPE_INVALID' },
  );
  assert.throws(() => apply({ ...index, inputBindings: new Map() }, inputBoundEvent()), {
    code: 'CYCLE_NOT_FOUND',
  });
  assert.throws(() => apply(index, { ...inputBoundEvent(), entityId: 'inb_00000002' }), {
    code: 'STATE_TRANSITION_INVALID',
  });
});

test('action.reopened returns the exact deferred Action to proposed through its lifecycle', () => {
  const transitions = [];
  const apply = createWorkflowRuntimeEventHandlerV2(
    handlerDependencies({
      runtimeError,
      transitionOperatingActionLifecycleV2: (action, state, patch) => {
        transitions.push([action.actionId, action.state, state, patch]);
        return { ...action, state, ...patch };
      },
    }),
  );
  const index = deferredActionIndex();
  apply(index, reopenedEvent());
  assert.deepEqual(transitions, [['act_00000001', 'deferred', 'proposed', { updatedAt: TIME }]]);
  assert.equal(index.actions.get('act_00000001').state, 'proposed');

  assert.throws(
    () => apply(deferredActionIndex(), reopenedEvent({ actor: { kind: 'user', id: 'founder' } })),
    { code: 'CAPABILITY_DENIED' },
  );
  assert.throws(() => apply(deferredActionIndex({ revision: 3 }), reopenedEvent()), {
    code: 'ACTION_REVISION_MISMATCH',
  });
  assert.equal(transitions.length, 1);
});

test('work-change-set.materialized records the runtime-issued work of one Artifact once', () => {
  const work = workChangeSet();
  const artifact = legacyWorkChangeSetArtifact(work);
  const payload = buildPersistentWorkMaterializationPayloadV2({
    artifact,
    changeSet: work,
    timestamp: TIME,
  });
  const apply = createWorkflowRuntimeEventHandlerV2(
    handlerDependencies({
      clone,
      runtimeError,
      requireValidatedWorkChangeSetArtifact: (index, event) =>
        index.artifacts.get(event.payload.artifactId),
    }),
  );
  const event = {
    type: 'work-change-set.materialized',
    eventId: 'evt_work_00000001',
    cycleId: 'cyc_00000001',
    entityId: artifact.artifactId,
    timestamp: TIME,
    actor: { kind: 'runtime', id: 'openplanr' },
    payload,
  };

  const index = workIndex(artifact);
  apply(index, event);
  const [finding] = payload.findings;
  const [decision] = payload.decisions;
  const [action] = payload.actions;
  assert.deepEqual([...index.findings.entries()], [[finding.findingId, finding]]);
  assert.deepEqual([...index.decisions.entries()], [[decision.decisionId, decision]]);
  assert.deepEqual([...index.actions.entries()], [[action.actionId, action]]);
  assert.deepEqual(
    [...index.workReplay.entries()],
    [
      [
        artifact.artifactId,
        {
          artifactId: artifact.artifactId,
          canonicalHash: artifact.canonicalHash,
          eventId: event.eventId,
          findingIds: [finding.findingId],
          decisionIds: [decision.decisionId],
          actionIds: [action.actionId],
        },
      ],
    ],
  );

  assert.throws(() => apply(index, event), {
    code: 'STATE_TRANSITION_INVALID',
    message: /materialized only once/,
  });
  assert.throws(
    () => apply(workIndex(artifact), { ...event, actor: { kind: 'human', id: 'owner-001' } }),
    { code: 'CAPABILITY_DENIED' },
  );
  const forged = structuredClone(payload);
  forged.actions[0].actionId = 'act_forged_00000001';
  assert.throws(() => apply(workIndex(artifact), { ...event, payload: forged }), {
    code: 'STATE_TRANSITION_INVALID',
    message: /runtime-issued identities/,
  });
  const taken = workIndex(artifact);
  taken.decisions.set(decision.decisionId, decision);
  assert.throws(() => apply(taken, event), { code: 'CONCURRENT_MODIFICATION' });
  assert.deepEqual([...taken.findings.keys()], []);
  assert.deepEqual([...taken.workReplay.keys()], []);
});
