#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { sha256Jcs, validateProtocolArtifact } from 'planr-pipeline/protocol';
import {
  buildOperatingWorkLedgerV2,
  createEmptyOperatingRuntimeStateV2,
  createOperatingRuntimeEventV2,
  readOperatingReviewV2,
  reduceOperatingRuntimeEventsV2,
} from 'planr-pipeline/operate/runtime-v2';
import { buildPersistentWorkMaterializationPayloadV2 } from 'planr-pipeline/operate/persistent-work-v2';

const TIME = '2026-08-08T13:00:00.000Z';
const NEXT = '2026-08-08T13:01:00.000Z';
const scope = { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' };
const executionVerificationFixture = JSON.parse(
  readFileSync(
    new URL('./fixtures/operating-runtime-v2/execution-verification-valid.json', import.meta.url),
    'utf8',
  ),
);
const allContractsFixture = JSON.parse(
  readFileSync(
    new URL('./fixtures/operating-runtime-v2/all-contracts-valid.json', import.meta.url),
    'utf8',
  ),
);
let checks = 0;

function pass(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

const changeSet = {
  kind: 'operating-work-change-set',
  schemaVersion: '1.0.0',
  protocolVersion: '2.0.0',
  cycleId: 'cyc_00000001',
  ...scope,
  findings: [
    {
      draftRef: 'draft_find_0001',
      title: 'Retention risk',
      statement: 'Retention is declining.',
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
      rationale: 'It is the largest current risk.',
      evidenceRefIds: ['evr_00000001'],
      alternatives: ['Prioritize acquisition.'],
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
      objectiveId: 'obj_00000001',
      expectedResult: 'Customer interviews reveal retention friction.',
      metricId: 'met_00000001',
      baseline: 0.4,
      target: 0.6,
      verificationWindow: '30d',
      verificationPlanId: 'vfy_00000001',
    },
  ],
};
const artifact = {
  kind: 'operating-artifact',
  schemaVersion: '1.0.0',
  protocolVersion: '2.0.0',
  artifactId: 'art_00000001',
  artifactType: 'chair-result',
  assignmentId: 'asg_00000001',
  cycleId: 'cyc_00000001',
  ...scope,
  schemaId: 'operating-work-change-set',
  artifactSchemaVersion: '2.0.0',
  mediaType: 'application/json',
  encoding: 'utf-8',
  rawHash: `sha256:${'a'.repeat(64)}`,
  canonicalHash: sha256Jcs(changeSet),
  sizeBytes: 1,
  storageClass: 'machine-local',
  sensitivity: 'internal',
  retentionClass: 'project',
  producer: { actorId: 'chair-001', roleId: 'chair', runtime: 'portable' },
  inputArtifactIds: [],
  createdAt: TIME,
};
const materialized = buildPersistentWorkMaterializationPayloadV2({
  artifact,
  changeSet,
  timestamp: NEXT,
});
pass(
  validateProtocolArtifact('operating-work-change-set', changeSet, { protocolVersion: '2.0.0' })
    .length === 0,
  'validated local change set',
);
pass(
  /^fnd_/.test(materialized.findings[0].findingId) &&
    /^dec_/.test(materialized.decisions[0].decisionId) &&
    /^act_/.test(materialized.actions[0].actionId),
  'runtime derives durable identities',
);
pass(
  sha256Jcs(materialized) ===
    sha256Jcs(
      buildPersistentWorkMaterializationPayloadV2({ artifact, changeSet, timestamp: NEXT }),
    ),
  'materialization payload is deterministic',
);

const cycle = {
  kind: 'operating-cycle',
  schemaVersion: '1.0.0',
  protocolVersion: '2.0.0',
  cycleId: 'cyc_00000001',
  ...scope,
  state: 'awaiting_review',
  inputBindingId: 'inb_00000001',
  contractVersions: {},
  trigger: { kind: 'manual' },
  focus: ['retention'],
  health: 'normal',
  activeReviewId: 'rev_00000001',
  createdAt: TIME,
  updatedAt: TIME,
};
const review = {
  kind: 'operating-review',
  schemaVersion: '1.0.0',
  protocolVersion: '2.0.0',
  reviewId: 'rev_00000001',
  cycleId: cycle.cycleId,
  ownerActorId: 'owner-001',
  state: 'pending',
  disposition: null,
  workDispositions: [],
  createdAt: TIME,
  updatedAt: TIME,
};
const state = {
  ...createEmptyOperatingRuntimeStateV2(TIME),
  cycles: [cycle],
  reviews: [review],
  findings: [
    {
      kind: 'operating-finding',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      findingId: 'fnd_00000001',
      ...scope,
      origin: 'persistent-work',
      sourceCycleId: cycle.cycleId,
      sourceArtifactId: artifact.artifactId,
      title: 'Retention risk',
      statement: 'Retention is declining.',
      state: 'open',
      ownerActorId: 'owner-001',
      revisitAt: null,
      createdAt: TIME,
      updatedAt: TIME,
    },
  ],
  decisions: [
    {
      kind: 'operating-decision',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      decisionId: 'dec_00000001',
      ...scope,
      origin: 'persistent-work',
      sourceCycleId: cycle.cycleId,
      sourceArtifactId: artifact.artifactId,
      title: 'Prioritize retention',
      question: 'What should we prioritize?',
      outcome: null,
      rationale: 'It is the largest current risk.',
      evidenceRefIds: ['evr_00000001'],
      alternatives: ['Prioritize acquisition.'],
      confidence: 0.8,
      assumptionIds: [],
      expectedUpside: 'Retention improves.',
      expectedDownside: 'Acquisition learning slows.',
      dissent: [],
      reopenConditions: ['Retention evidence changes materially.'],
      revisitConditions: ['Metric changes.'],
      state: 'proposed',
      ownerActorId: 'owner-001',
      revisitAt: null,
      revision: 1,
      predecessorDecisionId: null,
      historyDecisionIds: [],
      createdAt: TIME,
      updatedAt: TIME,
    },
  ],
  actions: [
    {
      kind: 'operating-action',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      actionId: 'act_00000001',
      ...scope,
      sourceCycleId: cycle.cycleId,
      sourceArtifactId: artifact.artifactId,
      title: 'Interview customers',
      state: 'proposed',
      ownerActorId: 'owner-001',
      accountabilityDisposition: null,
      sourceDecisionId: 'dec_00000001',
      sourceFindingIds: ['fnd_00000001'],
      dependsOnActionIds: [],
      objectiveId: 'obj_00000001',
      expectedResult: 'Customer interviews reveal retention friction.',
      metricId: 'met_00000001',
      baseline: 0.4,
      target: 0.6,
      verificationWindow: '30d',
      verificationPlanId: 'vfy_00000001',
      createdAt: TIME,
      updatedAt: TIME,
    },
  ],
  verificationPlans: [
    {
      ...structuredClone(allContractsFixture['operating-action-verification-plan']),
      verificationPlanId: 'vfy_00000001',
      actionId: 'act_00000001',
      ...scope,
      metricId: 'met_00000001',
      baseline: 0.4,
      target: 0.6,
      window: '30d',
      sourceArtifactId: artifact.artifactId,
      createdAt: TIME,
    },
  ],
};
const reviewRead = readOperatingReviewV2(
  {
    reviewId: review.reviewId,
    cycleId: cycle.cycleId,
    actor: { actorId: 'owner-001', kind: 'human', runtime: 'portable' },
    scope,
  },
  { initialState: state, capabilities: ['operate.review.get'], readAt: NEXT },
);
const appliedChoice = reviewRead.data.dispositionChoices.find(
  (choice) =>
    choice.submitArguments.disposition === 'approved' &&
    choice.submitArguments.workDispositions.length === 3 &&
    choice.submitArguments.workDispositions.every(({ disposition }) => disposition === 'deferred'),
);
pass(Boolean(appliedChoice), 'owner read advertises the exact persistent-work disposition');
const reviewEvent = createOperatingRuntimeEventV2({
  eventId: 'evt_00000001',
  timestamp: NEXT,
  cycleId: cycle.cycleId,
  type: 'review.submitted',
  entityId: review.reviewId,
  actor: { kind: 'human', id: 'owner-001' },
  causationId: null,
  correlationId: 'corr_00000001',
  payload: {
    reviewId: review.reviewId,
    disposition: 'approved',
    workDispositions: structuredClone(appliedChoice.submitArguments.workDispositions),
    receiptProjection: {
      read: reviewRead.data,
      appliedChoiceId: appliedChoice.choiceId,
      appliedChoiceHash: appliedChoice.choiceHash,
    },
  },
});
const closed = reduceOperatingRuntimeEventsV2([reviewEvent], { initialState: state });
pass(
  closed.cycles[0].state === 'closed' && closed.cycles[0].closedAt === NEXT,
  'approved review closes only through explicit dispositions',
);
pass(
  closed.findings[0].state === 'deferred' &&
    closed.decisions[0].state === 'deferred' &&
    closed.actions[0].state === 'deferred',
  'closure retains carried durable work',
);
const replay = reduceOperatingRuntimeEventsV2([reviewEvent], { initialState: closed });
pass(sha256Jcs(replay) === sha256Jcs(closed), 'identical closure Event replay is effect-free');
const ledger = buildOperatingWorkLedgerV2(closed, scope);
pass(
  ledger.cycleLinks.filter(({ relation }) => relation === 'carried-forward').length === 3,
  'scope ledger rebuilds carried-forward links',
);
pass(
  executionVerificationFixture.verificationOwnership.fromExistingPlan === true &&
    executionVerificationFixture.cyclePath.at(-1) === 'closed',
  'persistent Action verification ownership survives Cycle closure',
);

process.stdout.write(`${JSON.stringify({ ok: true, protocolVersion: '2.0.0', checks })}\n`);
