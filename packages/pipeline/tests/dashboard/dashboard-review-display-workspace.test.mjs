import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateJson } from '../../conformance/json-schema-validate.mjs';
import * as slicedReviewSchemaData from '../../lib/dashboard/generated/operate-review-schema-data.mjs';
import {
  issueOperateReviewDisplayWorkspaceV1,
  OPERATE_REVIEW_DISPLAY_WORKSPACE_DOMAIN,
  validateOperateReviewDisplayWorkspaceV1,
} from '../../lib/dashboard/operate-review-display-workspace-contract.mjs';
import {
  assertOperateReviewDisplayWorkspaceV1 as assertBrowserSafeReviewDisplayWorkspaceV1,
  assertOperatingReviewReceiptV2,
} from '../../lib/dashboard/operate-review-contract.mjs';
import {
  selectOperateExperienceSurface,
  selectOperateReviewDisplayWorkspace,
  selectOperateReviewWorkspace,
} from '../../lib/dashboard/operate-experience-reader.mjs';
import { contentHash } from '../../lib/dashboard/closed-json-contract.mjs';
import {
  buildOperateReviewWorkspacePayloadV1,
  deriveOperateSharedTruthSummaryV1,
} from '../../lib/dashboard/operate-review-workspace-projection-v2.mjs';
import { buildOperatingReviewBoundSubmissionV1 } from '../../lib/operate/review-bound-submission-v2.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import { rehashExperienceView } from './experience-view-test-support.mjs';

const TIME = '2026-08-23T08:00:00.000Z';
const NEXT_TIME = '2026-08-23T08:01:00.000Z';
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
)['operate-experience-view'];
const allContractsFixture = JSON.parse(
  readFileSync(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/all-contracts-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const REVIEW_SCHEMA_INPUTS = Object.freeze([
  ['OPERATE_ALLOWED_ACTION_SCHEMA', 'operate-allowed-action.schema.json'],
  ['OPERATE_EXPERIENCE_VIEW_SCHEMA', 'operate-experience-view.schema.json'],
  ['OPERATE_REVIEW_BOUND_SUBMISSION_SCHEMA', 'operate-review-bound-submission.schema.json'],
  ['OPERATE_REVIEW_DISPLAY_WORKSPACE_SCHEMA', 'operate-review-display-workspace.schema.json'],
  ['OPERATING_ASSIGNMENT_SCHEMA', 'operating-assignment.schema.json'],
  ['OPERATING_EVIDENCE_RESOLUTION_SCHEMA', 'operating-evidence-resolution.schema.json'],
  ['OPERATING_REVIEW_READ_SCHEMA', 'operating-review-read.schema.json'],
  ['OPERATING_REVIEW_RECEIPT_SCHEMA', 'operating-review-receipt.schema.json'],
  ['OPERATING_REVIEW_SCHEMA', 'operating-review.schema.json'],
  ['OPERATING_TRACE_MATRIX_SCHEMA', 'operating-trace-matrix.schema.json'],
]);
const fullReviewSchemas = new Map(
  REVIEW_SCHEMA_INPUTS.map(([, filename]) => [
    filename,
    JSON.parse(readFileSync(new URL(`../../schemas/v2.0.0/${filename}`, import.meta.url), 'utf8')),
  ]),
);
const slicedReviewSchemas = new Map(
  REVIEW_SCHEMA_INPUTS.map(([exportName, filename]) => [
    filename,
    slicedReviewSchemaData[`${exportName}_REVIEW_SLICE`],
  ]),
);

function schemaPointer(root, fragment) {
  if (!fragment || fragment === '#') return root;
  if (!fragment.startsWith('#/')) return null;
  return fragment
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, part) => value?.[part], root);
}

function schemaResolver(schemas, reference) {
  const [path, pointer = ''] = reference.split('#');
  const filename = path.split('/').at(-1);
  const rootSchema = schemas.get(filename);
  if (!rootSchema) return null;
  return {
    schema: schemaPointer(rootSchema, pointer ? `#${pointer}` : '#'),
    rootSchema,
    base: filename,
  };
}

function schemaAccepts(value, filename, schemas) {
  return (
    validateJson(structuredClone(value), schemas.get(filename), {
      base: `schemas/v2.0.0/${filename}`,
      resolveRef: (reference) => schemaResolver(schemas, reference),
    }).length === 0
  );
}

function valueAtPath(value, path) {
  return path.reduce((nested, part) => nested[part], value);
}

function deterministicPropertyMutations(value, limit = 160) {
  const paths = [];
  const visit = (nested, path) => {
    if (paths.length >= limit) return;
    paths.push(path);
    if (Array.isArray(nested)) {
      nested.slice(0, 3).forEach((entry, index) => visit(entry, [...path, index]));
    } else if (nested && typeof nested === 'object') {
      Object.keys(nested)
        .sort()
        .slice(0, 8)
        .forEach((field) => visit(nested[field], [...path, field]));
    }
  };
  visit(value, []);
  return paths
    .flatMap((path) => {
      const nested = valueAtPath(value, path);
      const mutations = [];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const extra = structuredClone(value);
        valueAtPath(extra, path).__sliceProbe = true;
        mutations.push(extra);
        const [firstField] = Object.keys(nested).sort();
        if (firstField !== undefined) {
          const missing = structuredClone(value);
          delete valueAtPath(missing, path)[firstField];
          mutations.push(missing);
        }
      } else if (Array.isArray(nested)) {
        const appended = structuredClone(value);
        valueAtPath(appended, path).push({ __sliceProbe: true });
        mutations.push(appended);
      } else if (path.length > 0) {
        const replaced = structuredClone(value);
        const parent = valueAtPath(replaced, path.slice(0, -1));
        const key = path.at(-1);
        parent[key] =
          typeof nested === 'string'
            ? 7
            : typeof nested === 'number'
              ? 'invalid'
              : typeof nested === 'boolean'
                ? 'invalid'
                : { __sliceProbe: true };
        mutations.push(replaced);
      }
      return mutations;
    })
    .slice(0, limit);
}

function stages({ verificationState = 'waiting' } = {}) {
  return ['observe', 'understand', 'decide', 'govern', 'act', 'verify', 'learn'].map(
    (id, index) => ({
      id,
      state: id === 'verify' ? verificationState : index < 4 ? 'complete' : 'waiting',
      reason: verificationState === 'skipped' && id === 'verify' ? 'Cycle is cancelled.' : null,
      inputArtifactIds: [],
      outputArtifactIds: [],
      gates: [],
      evidenceGapIds: [],
      uncertaintyIds: [],
      persistentActionIds: [],
    }),
  );
}

function evidenceRecord({
  evidenceRefId = 'evr_review_0001',
  claimId = 'clm_review_0001',
  restricted = false,
} = {}) {
  return {
    evidenceRefId,
    classification: restricted ? 'restricted' : 'internal',
    accessState: restricted ? 'restricted' : 'available',
    freshness: 'current',
    evidenceKind: null,
    resolvedAt: null,
    claimStatus: restricted ? 'restricted' : 'supported',
    supportClaimIds: [claimId],
    contradictClaimIds: [],
    source: null,
    producer: null,
    observedAt: null,
    scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
    sensitivity: restricted ? 'restricted' : 'internal',
    provenance: null,
    confidence: restricted ? null : 0.9,
    gaps: [],
    errors: [],
    accessReason: restricted ? 'access-denied' : null,
    causalLinks: [],
    deepLink: `#/operate/evidence/${evidenceRefId}`,
  };
}

function claimRecord({
  claimId = 'clm_review_0001',
  evidenceRefId = 'evr_review_0001',
  restricted = false,
} = {}) {
  return {
    claimId,
    status: restricted ? 'restricted' : 'supported',
    epistemicStatus: restricted ? 'unknown' : 'strongly-supported',
    statement: restricted ? null : 'The accepted evidence supports the recommendation.',
    supportEvidenceRefIds: [evidenceRefId],
    contradictEvidenceRefIds: [],
    source: null,
    producer: null,
    observedAt: TIME,
    scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
    sensitivity: restricted ? 'restricted' : 'internal',
    provenance: null,
    confidence: restricted ? null : 0.9,
    gaps: [],
    errors: [],
    accessReason: restricted ? 'access-denied' : null,
    causalLinks: [],
    deepLink: `#/operate/evidence/${claimId}`,
  };
}

function decisionSummary({
  decisionId = 'dec_review_0001',
  evidenceRefId = 'evr_review_0001',
  rationale = 'Accepted evidence supports a bounded next step.',
} = {}) {
  return {
    origin: 'operating-intelligence',
    decisionId,
    title: 'Adopt the bounded recommendation',
    question: 'Should the owner adopt the proposed operating change?',
    outcome: 'Adopt only the reviewed scope.',
    rationale,
    confidence: 0.8,
    ownerActorId: 'owner-001',
    expectedUpside: 'The selected outcome becomes explicit.',
    expectedDownside: 'The immutable disposition requires a governed follow-on to change.',
    uncertainty: 'Measured impact remains uncertain.',
    reversibility: 'The Review event is immutable; later work is separately governed.',
    revisitConditions: ['Accepted outcome evidence changes.'],
    dissentIds: [],
    dissent: [],
    evidenceRefIds: [evidenceRefId],
  };
}

function pendingSource({ decisions = [decisionSummary()] } = {}) {
  const actor = { actorId: 'owner-001', kind: 'human', runtime: 'openplanr' };
  const scope = { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' };
  const submitArguments = {
    reviewId: 'rev_00000001',
    cycleId: 'cyc_00000001',
    actor,
    scope,
    disposition: 'approved',
    workDispositions: [],
  };
  return {
    kind: 'operating-review-read',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    cycleId: 'cyc_00000001',
    eventHead: { sequence: 1, hash: HASH_A },
    scope,
    reader: actor,
    review: {
      kind: 'operating-review',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      reviewId: 'rev_00000001',
      cycleId: 'cyc_00000001',
      ownerActorId: 'owner-001',
      state: 'pending',
      disposition: null,
      workDispositions: [],
      createdAt: TIME,
      updatedAt: TIME,
    },
    seatStatus: [],
    decisions,
    actions: [],
    findings: [],
    dissent: [],
    gaps: [],
    dispositionChoices: [
      {
        choiceId: 'rch_00000001',
        choiceHash: sha256Jcs(submitArguments),
        label: 'Approve exact proposed work',
        submitArguments,
      },
    ],
    readAt: NEXT_TIME,
  };
}

function terminalSource(read = pendingSource()) {
  const [choice] = read.dispositionChoices;
  return {
    kind: 'operating-review-receipt',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    receiptId: 'rrc_00000001',
    cycleId: read.cycleId,
    readEventHead: structuredClone(read.eventHead),
    eventHead: { sequence: 2, hash: HASH_B },
    scope: structuredClone(read.scope),
    actor: structuredClone(read.reader),
    review: {
      ...structuredClone(read.review),
      state: 'approved',
      disposition: 'approved',
      updatedAt: '2026-08-23T08:02:00.000Z',
    },
    decision: 'approved',
    seatStatus: structuredClone(read.seatStatus),
    decisions: structuredClone(read.decisions),
    actions: structuredClone(read.actions),
    findings: structuredClone(read.findings),
    dissent: structuredClone(read.dissent),
    gaps: structuredClone(read.gaps),
    dispositionChoices: structuredClone(read.dispositionChoices),
    appliedChoiceId: choice.choiceId,
    appliedChoiceHash: choice.choiceHash,
    appliedWorkDispositions: structuredClone(choice.submitArguments.workDispositions),
    summary: {
      decisionCount: read.decisions.length,
      actionCount: read.actions.length,
      findingCount: read.findings.length,
      dissentCount: read.dissent.length,
      gapCount: read.gaps.length,
      message: 'The exact advertised approval disposition was committed.',
    },
    committedAt: '2026-08-23T08:02:00.000Z',
  };
}

function reviewView(
  source,
  {
    status = 'ready',
    restricted = false,
    evidence = [evidenceRecord({ restricted })],
    claims = [claimRecord({ restricted })],
    omissions = restricted
      ? [{ classification: 'restricted', count: 1, reason: 'access-denied' }]
      : [],
    assignments,
    verificationState = 'waiting',
  } = {},
) {
  const sourceActor = source.kind === 'operating-review-read' ? source.reader : source.actor;
  const sourceTime = source.kind === 'operating-review-read' ? source.readAt : source.committedAt;
  const eventCount = source.eventHead.sequence;
  const cycleAssignments = assignments ?? [
    {
      assignmentId: 'asg_review_0001',
      title: 'Synthesize the owner Review',
      role: 'chair',
      ownerLabel: 'Chair',
      state: 'validated',
      absence: null,
      dueAt: null,
      next: null,
      deepLink: `#/operate/cycles/${source.cycleId}`,
      dependencies: [],
      blockers: [],
      inputArtifactIds: [],
      outputArtifactIds: [],
    },
  ];
  const allowedActions =
    source.kind === 'operating-review-read'
      ? source.dispositionChoices.map((choice) => ({
          subjectId: source.review.reviewId,
          action: {
            tool: 'operate.review.submit',
            arguments: structuredClone(choice.submitArguments),
            label: choice.label,
            effect: 'project-write',
          },
        }))
      : [];
  return rehashExperienceView({
    ...structuredClone(fixture),
    actorId: sourceActor.actorId,
    scopeId: source.scope.scopeId,
    domainId: source.scope.domainId,
    domainVersion: source.scope.domainVersion,
    generatedAt: sourceTime,
    eventHead: structuredClone(source.eventHead),
    status,
    cycles: [
      {
        cycleId: source.cycleId,
        state: source.kind === 'operating-review-read' ? 'awaiting_review' : 'closed',
        health: 'normal',
        focus: ['Review the bounded operating recommendation'],
        createdAt: TIME,
        updatedAt: sourceTime,
        stages: stages({ verificationState }),
        assignments: cycleAssignments,
        lensAbsences: [],
        executiveBoard: null,
        dependencies: [],
        blockers: [],
        persistentActionIds: [],
        replayCheckpoint: null,
        deepLink: `#/operate/cycles/${source.cycleId}`,
      },
    ],
    attention: [],
    inbox: [],
    actions: [],
    evidence,
    claims,
    outcomes: [],
    learnings: [],
    history: [],
    replay: {
      checkpoint: null,
      tail: {
        startSequence: eventCount === 0 ? null : 1,
        endSequence: eventCount === 0 ? null : eventCount,
        eventCount,
        eventReplayIndexHash: HASH_A,
      },
      finalHead: structuredClone(source.eventHead),
      liveAccessUsed: false,
      parityProof: {
        sourceStateHash: fixture.sourceStateHash,
        eventReplayIndexHash: HASH_A,
        checkpointVerified: false,
        finalEventHashMatches: true,
        stateParityVerified: false,
      },
      filterDimensions: [
        'cycle',
        'action',
        'decision',
        'actor',
        'operation',
        'result',
        'event-type',
        'date',
      ],
      redactions: structuredClone(omissions),
    },
    allowedActions,
    omissions,
    export: {
      formats: ['json', 'html'],
      accessSafe: true,
      redactionCount: omissions.reduce((sum, item) => sum + item.count, 0),
    },
  });
}

function bindingFor(source, view) {
  return {
    actorId: view.actorId,
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    cycleId: source.cycleId,
    reviewId: source.review.reviewId,
    generatedAt: source.kind === 'operating-review-read' ? source.readAt : source.committedAt,
    sourceArtifactKind: source.kind,
    sourceArtifactHash: sha256Jcs(source),
    sourceEventHead: structuredClone(source.eventHead),
    sourceReadEventHead: structuredClone(
      source.kind === 'operating-review-read' ? source.eventHead : source.readEventHead,
    ),
    sourceViewHash: view.viewHash,
  };
}

function expectedBinding(payload) {
  return Object.fromEntries(
    [
      'actorId',
      'scopeId',
      'domainId',
      'domainVersion',
      'cycleId',
      'reviewId',
      'sourceArtifactKind',
      'sourceArtifactHash',
      'sourceEventHead',
      'sourceReadEventHead',
      'sourceViewHash',
    ].map((field) => [field, structuredClone(payload[field])]),
  );
}

test('pending Review workspace preserves exact choices and only exposes exact verified owner submit capability', () => {
  const source = pendingSource();
  const view = reviewView(source);
  const beforeSource = structuredClone(source);
  const beforeView = structuredClone(view);
  const payload = buildOperateReviewWorkspacePayloadV1(source, view);
  const selected = selectOperateReviewWorkspace(view, source, {
    binding: bindingFor(source, view),
    subjectId: source.review.reviewId,
  });
  assert.deepEqual(selected, payload);
  assert.equal(payload.status, 'ready');
  assert.equal(payload.mutationEnabled, true);
  assert.deepEqual(
    payload.data.choices[0].submitArguments,
    source.dispositionChoices[0].submitArguments,
  );
  assert.equal(payload.data.choices[0].choiceId, source.dispositionChoices[0].choiceId);
  assert.equal(payload.data.choices[0].choiceHash, source.dispositionChoices[0].choiceHash);
  assert.equal(payload.data.choices[0].consequence.includes('does not execute Actions'), true);
  assert.equal(payload.data.choices[0].reversibility, 'immutable-review-event');
  assert.deepEqual(payload.data.capability.actions, view.allowedActions);
  assert.deepEqual(source, beforeSource);
  assert.deepEqual(view, beforeView);

  const display = issueOperateReviewDisplayWorkspaceV1(payload);
  assert.equal(assertBrowserSafeReviewDisplayWorkspaceV1(display), display);
  assert.equal(
    display.integrity.contentHash,
    contentHash(payload, OPERATE_REVIEW_DISPLAY_WORKSPACE_DOMAIN),
  );
  assert.deepEqual(validateOperateReviewDisplayWorkspaceV1(display, expectedBinding(payload)), []);
});

test('terminal Review workspace derives exact receipt disposition and exposes no choices or mutation capability', () => {
  const source = terminalSource();
  assert.equal(assertOperatingReviewReceiptV2(source), source);
  const view = reviewView(source);
  const payload = buildOperateReviewWorkspacePayloadV1(source, view);
  assert.equal(payload.status, 'terminal');
  assert.deepEqual(payload.reasonCodes, ['REVIEW_TERMINAL']);
  assert.deepEqual(payload.sourceEventHead, source.eventHead);
  assert.deepEqual(payload.sourceReadEventHead, source.readEventHead);
  assert.deepEqual(payload.data.choices, []);
  assert.deepEqual(payload.data.capability, {
    available: false,
    actions: [],
    reason: { code: 'REVIEW_TERMINAL', message: 'This Review is terminal.' },
  });
  assert.deepEqual(payload.data.terminalDisposition, {
    receiptId: source.receiptId,
    decision: source.decision,
    appliedChoiceId: source.appliedChoiceId,
    appliedChoiceHash: source.appliedChoiceHash,
    appliedWorkDispositions: source.appliedWorkDispositions,
    readEventHead: source.readEventHead,
    eventHead: source.eventHead,
    committedAt: source.committedAt,
  });
  const display = selectOperateReviewDisplayWorkspace(view, source, {
    binding: bindingFor(source, view),
    subjectId: source.review.reviewId,
  });
  assert.equal(display.kind, 'operate-review-display-workspace');
  assert.deepEqual(validateOperateReviewDisplayWorkspaceV1(display, expectedBinding(payload)), []);
});

test('terminal Review workspace validates the exact real evidence-gap summary branch', () => {
  const pending = pendingSource({ decisions: [] });
  pending.gaps = [
    {
      absenceId: 'abs_evidence_review_terminal_0001',
      kind: 'evidence',
      requirementId: 'operations-customer-evidence-1',
      sourceContracts: [{ id: 'operations-customer-health', version: '1.0.0' }],
      reason: 'No materialized in-scope Evidence matched this role requirement.',
      recoveryDisposition: 'refresh-or-issue-evidence',
    },
  ];
  const source = terminalSource(pending);
  const view = reviewView(source);
  const payload = buildOperateReviewWorkspacePayloadV1(source, view);
  const display = issueOperateReviewDisplayWorkspaceV1(payload);
  assert.deepEqual(display.payload.data.gaps, source.gaps);
  assert.deepEqual(validateOperateReviewDisplayWorkspaceV1(display, expectedBinding(payload)), []);
});

test('partial, restricted, stale, offline, and read-only pending workspaces remain bounded and never invent authority', () => {
  for (const status of ['partial', 'stale', 'offline', 'read-only']) {
    const source = pendingSource();
    const view = reviewView(source, { status });
    const payload = buildOperateReviewWorkspacePayloadV1(source, view);
    assert.equal(payload.status, status);
    assert.equal(payload.mutationEnabled, false);
    assert.equal(payload.data.capability.available, false);
    assert.deepEqual(
      validateOperateReviewDisplayWorkspaceV1(issueOperateReviewDisplayWorkspaceV1(payload)),
      [],
    );
  }

  const source = pendingSource();
  const view = reviewView(source, { restricted: true });
  const payload = buildOperateReviewWorkspacePayloadV1(source, view);
  assert.equal(payload.data.truthSummary.evidence.total, 1);
  assert.equal(payload.data.truthSummary.evidence.restricted, 1);
  assert.equal(payload.data.truthSummary.evidence.linked, 1);
  assert.equal(payload.data.truthSummary.proof.linkedEvidence, 1);
  assert.equal(payload.data.truthSummary.proof.status, 'unverified');
  assert.ok(
    payload.data.omissions.some(
      (entry) =>
        entry.kind === 'restricted' &&
        entry.subject === 'evidence' &&
        entry.subjectIds.includes('evr_review_0001'),
    ),
  );
});

test('typed proof absences cannot collapse to not-required and seat truth forms an exact partition', () => {
  const source = pendingSource({ decisions: [] });
  const assignment = {
    assignmentId: 'asg_review_0001',
    title: 'Unavailable advisor seat',
    role: 'advisor',
    ownerLabel: 'Advisor',
    state: 'failed',
    absence: {
      outcome: 'failed',
      code: 'RESULT_UNAVAILABLE',
      reason: 'The advisor result is unavailable.',
      recoveryDisposition: 'Proceed with a typed absence.',
    },
    dueAt: null,
    next: null,
    deepLink: `#/operate/cycles/${source.cycleId}`,
    dependencies: [],
    blockers: [],
    inputArtifactIds: [],
    outputArtifactIds: [],
  };
  const view = reviewView(source, {
    evidence: [],
    claims: [],
    assignments: [assignment],
    verificationState: 'skipped',
  });
  const summary = deriveOperateSharedTruthSummaryV1(view);
  assert.equal(summary.proof.status, 'unverified');
  assert.ok(summary.proof.reasonCodes.includes('OPERATE_PROOF_ABSENCE'));
  assert.equal(
    summary.seats.total,
    summary.seats.terminal + summary.seats.active + summary.seats.pending,
  );
  assert.equal(summary.seats.failed, 1);
  assert.equal(summary.seats.typedAbsences, 1);
});

test('available evidence without a reciprocal claim edge remains visible but is not counted as linked proof', () => {
  const source = pendingSource();
  const unlinked = evidenceRecord();
  unlinked.supportClaimIds = [];
  unlinked.claimStatus = 'unknown';
  const view = reviewView(source, { evidence: [unlinked], claims: [] });
  const summary = deriveOperateSharedTruthSummaryV1(view);
  assert.equal(summary.evidence.total, 1);
  assert.equal(summary.evidence.linked, 0);
  assert.equal(summary.proof.linkedEvidence, 0);
});

test('Today, Cycle, Inbox, Evidence, and Review carry the exact same shared truth object', () => {
  const source = pendingSource();
  const view = reviewView(source);
  const binding = {
    actorId: view.actorId,
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
  };
  const surfaces = [
    selectOperateExperienceSurface(view, { surface: 'today', binding }),
    selectOperateExperienceSurface(view, { surface: 'cycle', subjectId: source.cycleId, binding }),
    selectOperateExperienceSurface(view, {
      surface: 'inbox',
      binding,
      projectId: HASH_B,
      generation: 0,
    }),
    selectOperateExperienceSurface(view, { surface: 'evidence', binding }),
  ];
  const review = buildOperateReviewWorkspacePayloadV1(source, view);
  for (const surface of surfaces) {
    assert.equal(surface.ok, true);
    assert.deepEqual(surface.truthSummary, review.data.truthSummary);
    assert.deepEqual(surface.truthSummary.sourceEventHead, view.eventHead);
  }
  assert.equal(review.data.truthSummary.proof.status, 'partial');
});

test('foreign bindings, divergent source identities, graph drift, and contradictory counts fail closed', () => {
  const source = pendingSource();
  const view = reviewView(source);
  const binding = bindingFor(source, view);
  for (const hostile of [
    { actorId: 'foreign-owner' },
    { scopeId: 'foreign-scope' },
    { cycleId: 'cyc_foreign_0001' },
    { reviewId: 'rev_foreign_0001' },
    { sourceArtifactHash: HASH_B },
    { sourceViewHash: HASH_B },
    { sourceEventHead: { sequence: 2, hash: HASH_B } },
  ]) {
    const refused = selectOperateReviewWorkspace(view, source, {
      binding: { ...binding, ...hostile },
      subjectId: source.review.reviewId,
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.error.reasonCode, 'OPERATE_BINDING_MISMATCH');
  }

  const foreignCycle = structuredClone(source);
  foreignCycle.cycleId = 'cyc_foreign_0001';
  assert.throws(() => buildOperateReviewWorkspacePayloadV1(foreignCycle, view));

  const divergentHead = structuredClone(source);
  divergentHead.eventHead = { sequence: 1, hash: HASH_B };
  assert.throws(() => buildOperateReviewWorkspacePayloadV1(divergentHead, view), {
    code: 'E_OPERATE_BINDING_MISMATCH',
  });

  const broken = structuredClone(view);
  broken.evidence[0].supportClaimIds = ['clm_missing_0001'];
  rehashExperienceView(broken);
  assert.throws(() => buildOperateReviewWorkspacePayloadV1(source, broken), {
    code: 'E_OPERATE_REVIEW_WORKSPACE_GRAPH_INVALID',
  });

  const duplicate = structuredClone(view);
  duplicate.evidence[0].supportClaimIds.push(duplicate.evidence[0].supportClaimIds[0]);
  rehashExperienceView(duplicate);
  assert.throws(() => buildOperateReviewWorkspacePayloadV1(source, duplicate));

  const payload = structuredClone(buildOperateReviewWorkspacePayloadV1(source, view));
  payload.data.truthSummary.evidence.total += 1;
  assert.throws(() => issueOperateReviewDisplayWorkspaceV1(payload), {
    code: 'E_OPERATE_REVIEW_DISPLAY_INVALID',
  });

  const display = structuredClone(
    issueOperateReviewDisplayWorkspaceV1(buildOperateReviewWorkspacePayloadV1(source, view)),
  );
  display.payload.data.executiveSummary.text = 'Divergent unhashed summary.';
  assert.notDeepEqual(validateOperateReviewDisplayWorkspaceV1(display), []);
});

test('narrative redaction happens before payload hashing and unsafe post-projection bytes are rejected', () => {
  const source = pendingSource({
    decisions: [
      decisionSummary({ rationale: 'Inspect /Users/private-owner/secret.txt before deciding.' }),
    ],
  });
  const view = reviewView(source);
  const payload = buildOperateReviewWorkspacePayloadV1(source, view);
  assert.equal(JSON.stringify(payload).includes('/Users/private-owner'), false);
  assert.ok(
    payload.data.omissions.some(({ reasonCode }) => reasonCode === 'DISPLAY_SOURCE_REDACTED'),
  );
  const display = issueOperateReviewDisplayWorkspaceV1(payload);
  assert.equal(
    display.integrity.contentHash,
    contentHash(payload, OPERATE_REVIEW_DISPLAY_WORKSPACE_DOMAIN),
  );

  const unsafe = structuredClone(payload);
  unsafe.data.executiveSummary.text = 'Bearer abcdefghijklmnopqrstuvwxyz';
  assert.throws(() => issueOperateReviewDisplayWorkspaceV1(unsafe), {
    code: 'E_OPERATE_REVIEW_WORKSPACE_UNSAFE',
  });
});

test('equivalent randomized source collection order preserves normalized semantic records without mutation', () => {
  const firstDecision = decisionSummary();
  const secondDecision = decisionSummary({
    decisionId: 'dec_review_0002',
    evidenceRefId: 'evr_review_0002',
  });
  const firstSource = pendingSource({ decisions: [firstDecision, secondDecision] });
  const secondSource = structuredClone(firstSource);
  secondSource.decisions.reverse();
  const evidence = [
    evidenceRecord(),
    evidenceRecord({ evidenceRefId: 'evr_review_0002', claimId: 'clm_review_0002' }),
  ];
  const claims = [
    claimRecord(),
    claimRecord({ claimId: 'clm_review_0002', evidenceRefId: 'evr_review_0002' }),
  ];
  const firstView = reviewView(firstSource, { evidence, claims });
  const secondView = reviewView(secondSource, {
    evidence: [...evidence].reverse(),
    claims: [...claims].reverse(),
  });
  const firstBefore = structuredClone(firstView);
  const secondBefore = structuredClone(secondView);
  const first = structuredClone(buildOperateReviewWorkspacePayloadV1(firstSource, firstView).data);
  const second = structuredClone(
    buildOperateReviewWorkspacePayloadV1(secondSource, secondView).data,
  );
  delete first.truthSummary.sourceViewHash;
  delete second.truthSummary.sourceViewHash;
  assert.deepEqual(first, second);
  assert.deepEqual(firstView, firstBefore);
  assert.deepEqual(secondView, secondBefore);
});

test('generated Review schema slices are acceptance-equivalent to canonical schemas across fixtures and property mutations', () => {
  const pending = pendingSource();
  const pendingDisplay = issueOperateReviewDisplayWorkspaceV1(
    buildOperateReviewWorkspacePayloadV1(pending, reviewView(pending)),
  );
  const terminal = terminalSource(pending);
  const terminalDisplay = issueOperateReviewDisplayWorkspaceV1(
    buildOperateReviewWorkspacePayloadV1(terminal, reviewView(terminal)),
  );
  const boundSubmission = buildOperatingReviewBoundSubmissionV1({
    expectedReadEventHead: pending.eventHead,
    choice: pending.dispositionChoices[0],
    note: 'Confirm the exact advertised Review choice.',
  });
  const boundReceipt = {
    ...structuredClone(terminal),
    boundSubmission: structuredClone(boundSubmission),
  };
  assert.equal(assertOperatingReviewReceiptV2(boundReceipt), boundReceipt);

  const multiChoice = pendingSource();
  multiChoice.dispositionChoices = [
    ['approved', 'Approve exact proposed work'],
    ['changes_requested', 'Request bounded changes'],
    ['rejected', 'Reject exact proposed work'],
    ['cancelled', 'Cancel this Review'],
  ].map(([disposition, label], index) => {
    const submitArguments = {
      ...structuredClone(multiChoice.dispositionChoices[0].submitArguments),
      disposition,
      workDispositions: [],
    };
    return {
      choiceId: `rch_0000000${index + 1}`,
      choiceHash: sha256Jcs(submitArguments),
      label,
      submitArguments,
    };
  });
  const multiChoiceDisplay = issueOperateReviewDisplayWorkspaceV1(
    buildOperateReviewWorkspacePayloadV1(multiChoice, reviewView(multiChoice)),
  );
  assert.equal(
    multiChoiceDisplay.payload.data.capability.actions.every(
      ({ action }) => action.tool === 'operate.review.submit' && action.effect === 'project-write',
    ),
    true,
  );

  const fixtures = [
    ['operate-review-display-workspace.schema.json', pendingDisplay, 'pending display'],
    ['operate-review-display-workspace.schema.json', terminalDisplay, 'terminal display'],
    ['operate-review-display-workspace.schema.json', multiChoiceDisplay, 'multi-choice display'],
    ['operate-review-bound-submission.schema.json', boundSubmission, 'bound submission'],
    ['operating-review-receipt.schema.json', terminal, 'terminal receipt'],
    ['operating-review-receipt.schema.json', boundReceipt, 'bound terminal receipt'],
    [
      'operating-review-receipt.schema.json',
      allContractsFixture['operating-review-receipt'],
      'rich canonical receipt fixture',
    ],
  ];

  let mutationCount = 0;
  let rejectedMutationCount = 0;
  for (const [filename, value, label] of fixtures) {
    assert.equal(schemaAccepts(value, filename, fullReviewSchemas), true, `${label}: canonical`);
    assert.equal(schemaAccepts(value, filename, slicedReviewSchemas), true, `${label}: sliced`);
    for (const mutation of deterministicPropertyMutations(value)) {
      const canonicalAccepts = schemaAccepts(mutation, filename, fullReviewSchemas);
      const sliceAccepts = schemaAccepts(mutation, filename, slicedReviewSchemas);
      assert.equal(sliceAccepts, canonicalAccepts, `${label}: property mutation ${mutationCount}`);
      mutationCount += 1;
      if (!canonicalAccepts) rejectedMutationCount += 1;
    }
  }
  assert.ok(mutationCount >= 400, mutationCount);
  assert.ok(rejectedMutationCount >= 100, rejectedMutationCount);

  const readOnlyReviewAction = structuredClone(multiChoiceDisplay);
  const [capabilityAction] = readOnlyReviewAction.payload.data.capability.actions;
  const submitArguments = capabilityAction.action.arguments;
  capabilityAction.action = {
    tool: 'operate.review.get',
    arguments: {
      reviewId: submitArguments.reviewId,
      cycleId: submitArguments.cycleId,
      actor: structuredClone(submitArguments.actor),
      scope: structuredClone(submitArguments.scope),
    },
    label: 'Inspect this Review',
    effect: 'read-only',
  };
  readOnlyReviewAction.integrity.contentHash = contentHash(
    readOnlyReviewAction.payload,
    OPERATE_REVIEW_DISPLAY_WORKSPACE_DOMAIN,
  );
  assert.equal(
    schemaAccepts(
      readOnlyReviewAction,
      'operate-review-display-workspace.schema.json',
      fullReviewSchemas,
    ),
    true,
  );
  assert.equal(
    schemaAccepts(
      readOnlyReviewAction,
      'operate-review-display-workspace.schema.json',
      slicedReviewSchemas,
    ),
    true,
  );
  assert.throws(() => assertBrowserSafeReviewDisplayWorkspaceV1(readOnlyReviewAction), {
    code: 'E_OPERATE_REVIEW_DISPLAY_INVALID',
  });

  const wrongSubmitEffect = structuredClone(multiChoiceDisplay);
  wrongSubmitEffect.payload.data.capability.actions[0].action.effect = 'external-effect';
  wrongSubmitEffect.integrity.contentHash = contentHash(
    wrongSubmitEffect.payload,
    OPERATE_REVIEW_DISPLAY_WORKSPACE_DOMAIN,
  );
  assert.equal(
    schemaAccepts(
      wrongSubmitEffect,
      'operate-review-display-workspace.schema.json',
      fullReviewSchemas,
    ),
    false,
  );
  assert.equal(
    schemaAccepts(
      wrongSubmitEffect,
      'operate-review-display-workspace.schema.json',
      slicedReviewSchemas,
    ),
    false,
  );
});
