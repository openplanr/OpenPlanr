import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { issueOperateReviewDisplayWorkspaceV1 } from 'planr-pipeline/dashboard/operate-review-display-workspace-contract';
import { sha256Jcs } from 'planr-pipeline/dashboard/verified-json';
import { buildOperateReviewWorkspacePayloadV1 } from 'planr-pipeline/operate/review-workspace-projection-v2';
import {
  buildOperatingReviewBoundSubmissionV1,
  type OperatingReviewBoundSubmissionV1,
} from 'planr-pipeline/operate/runtime-v2';
import type { OperatingReviewReceiptV2 } from 'planr-pipeline/protocol';
import type { OperateReviewDisplayWorkspaceV1 } from 'planr-pipeline/schemas/v2.0.0/operate-review-display-workspace.mjs';
import { resolvePipelinePackageRoot } from './pipeline-package-root.js';

type RecordValue = Record<string, unknown>;
export type ReviewFixtureDisposition = 'approved' | 'changes_requested' | 'rejected';

export type ReviewFixtureIdentity = Readonly<{
  actorId: string;
  cycleId: string;
  reviewId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  projectId: string;
  readHead: Readonly<{ sequence: number; hash: string }>;
  terminalHead: Readonly<{ sequence: number; hash: string }>;
  readAt: string;
  committedAt: string;
}>;

export const REVIEW_FIXTURE: ReviewFixtureIdentity = Object.freeze({
  actorId: 'owner-review-dashboard',
  cycleId: 'cyc_review_dashboard_0001',
  reviewId: 'rev_review_dashboard_0001',
  scopeId: 'scope-review-dashboard',
  domainId: 'business',
  domainVersion: '1.0.0',
  projectId: `sha256:${'1'.repeat(64)}`,
  readHead: Object.freeze({ sequence: 1, hash: `sha256:${'a'.repeat(64)}` }),
  terminalHead: Object.freeze({ sequence: 2, hash: `sha256:${'b'.repeat(64)}` }),
  readAt: '2026-08-23T08:01:00.000Z',
  committedAt: '2026-08-23T08:02:00.000Z',
});

export function alternateReviewFixture(suffix: string): ReviewFixtureIdentity {
  return Object.freeze({
    ...REVIEW_FIXTURE,
    cycleId: `cyc_review_dashboard_${suffix}`,
    reviewId: `rev_review_dashboard_${suffix}`,
    readHead: Object.freeze({ sequence: 11, hash: `sha256:${'c'.repeat(64)}` }),
    terminalHead: Object.freeze({ sequence: 12, hash: `sha256:${'d'.repeat(64)}` }),
    readAt: '2026-08-23T09:01:00.000Z',
    committedAt: '2026-08-23T09:02:00.000Z',
  });
}

const experienceFixture = JSON.parse(
  readFileSync(
    join(
      resolvePipelinePackageRoot(),
      'conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json',
    ),
    'utf8',
  ),
)['operate-experience-view'] as RecordValue;

function without(value: RecordValue, field: string): RecordValue {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

function rehashExperienceView(value: RecordValue): RecordValue {
  const view = structuredClone(value);
  delete view.viewHash;
  view.viewHash = sha256Jcs(without(view, 'viewHash'));
  return view;
}

function scope(fixture: ReviewFixtureIdentity) {
  return {
    scopeId: fixture.scopeId,
    domainId: fixture.domainId,
    domainVersion: fixture.domainVersion,
  };
}

function actor(fixture: ReviewFixtureIdentity) {
  return { actorId: fixture.actorId, kind: 'human', runtime: 'openplanr' };
}

function choice(
  disposition: ReviewFixtureDisposition,
  index: number,
  fixture: ReviewFixtureIdentity,
) {
  const labels: Record<ReviewFixtureDisposition, string> = {
    approved: 'Approve bounded recommendation',
    changes_requested: 'Request focused changes',
    rejected: 'Reject recommendation',
  };
  const submitArguments = {
    reviewId: fixture.reviewId,
    cycleId: fixture.cycleId,
    actor: actor(fixture),
    scope: scope(fixture),
    disposition,
    workDispositions: [],
  };
  return {
    choiceId: `rch_review_dashboard_000${index}`,
    choiceHash: sha256Jcs(submitArguments),
    label: labels[disposition],
    submitArguments,
  };
}

function decisionSummary(fixture: ReviewFixtureIdentity) {
  return {
    origin: 'operating-intelligence',
    decisionId: 'dec_review_dashboard_0001',
    title: 'Adopt the bounded recommendation',
    question: 'Should the owner adopt the proposed operating change?',
    outcome: 'Adopt only the reviewed scope.',
    rationale: 'Accepted evidence supports a bounded next step.',
    confidence: 0.8,
    ownerActorId: fixture.actorId,
    expectedUpside: 'The selected outcome becomes explicit.',
    expectedDownside: 'A later change requires a separately governed event.',
    uncertainty: 'Measured impact remains uncertain.',
    reversibility: 'The Review event is immutable; later work is separately governed.',
    revisitConditions: ['Accepted outcome evidence changes.'],
    dissentIds: [],
    dissent: [],
    evidenceRefIds: ['evr_review_dashboard_0001'],
  };
}

function pendingSource(choiceCount = 2, fixture: ReviewFixtureIdentity = REVIEW_FIXTURE) {
  const choices = [
    choice('approved', 1, fixture),
    choice('changes_requested', 2, fixture),
    choice('rejected', 3, fixture),
  ];
  return {
    kind: 'operating-review-read',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    cycleId: fixture.cycleId,
    eventHead: structuredClone(fixture.readHead),
    scope: scope(fixture),
    reader: actor(fixture),
    review: {
      kind: 'operating-review',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      reviewId: fixture.reviewId,
      cycleId: fixture.cycleId,
      ownerActorId: fixture.actorId,
      state: 'pending',
      disposition: null,
      workDispositions: [],
      createdAt: '2026-08-23T08:00:00.000Z',
      updatedAt: '2026-08-23T08:00:00.000Z',
    },
    seatStatus: [],
    decisions: [decisionSummary(fixture)],
    actions: [],
    findings: [],
    dissent: [],
    gaps: [],
    dispositionChoices: (choiceCount >= 3 ? choices : [choices[0], choices[2]]).slice(
      0,
      choiceCount,
    ),
    readAt: fixture.readAt,
  };
}

function terminalSource(
  pending: ReturnType<typeof pendingSource>,
  note: string | null,
  fixture: ReviewFixtureIdentity,
  disposition: ReviewFixtureDisposition,
): OperatingReviewReceiptV2 & { boundSubmission: OperatingReviewBoundSubmissionV1 } {
  const selected = pending.dispositionChoices.find(
    (candidate) => candidate.submitArguments.disposition === disposition,
  );
  if (!selected) throw new TypeError(`Missing ${disposition} Review fixture choice.`);
  const boundSubmission = buildOperatingReviewBoundSubmissionV1({
    expectedReadEventHead: pending.eventHead,
    choice: selected,
    note,
  });
  return {
    kind: 'operating-review-receipt',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    receiptId: `rrc_review_dashboard_${disposition}`,
    cycleId: pending.cycleId,
    readEventHead: structuredClone(pending.eventHead),
    eventHead: structuredClone(fixture.terminalHead),
    scope: structuredClone(pending.scope),
    actor: structuredClone(pending.reader),
    review: {
      ...structuredClone(pending.review),
      state: disposition,
      disposition,
      updatedAt: fixture.committedAt,
    },
    decision: disposition,
    seatStatus: structuredClone(pending.seatStatus),
    decisions: structuredClone(pending.decisions),
    actions: structuredClone(pending.actions),
    findings: structuredClone(pending.findings),
    dissent: structuredClone(pending.dissent),
    gaps: structuredClone(pending.gaps),
    dispositionChoices: structuredClone(pending.dispositionChoices),
    appliedChoiceId: selected.choiceId,
    appliedChoiceHash: selected.choiceHash,
    appliedWorkDispositions: structuredClone(selected.submitArguments.workDispositions),
    summary: {
      decisionCount: pending.decisions.length,
      actionCount: pending.actions.length,
      findingCount: pending.findings.length,
      dissentCount: pending.dissent.length,
      gapCount: pending.gaps.length,
      message: `The exact advertised ${disposition} disposition was committed.`,
    },
    committedAt: fixture.committedAt,
    boundSubmission,
  } as OperatingReviewReceiptV2 & { boundSubmission: OperatingReviewBoundSubmissionV1 };
}

function stages(closed: boolean) {
  return ['observe', 'understand', 'decide', 'govern', 'act', 'verify', 'learn'].map(
    (id, index) => ({
      id,
      state: index < 4 || closed ? 'complete' : 'waiting',
      reason: null,
      inputArtifactIds: [],
      outputArtifactIds: [],
      gates: [],
      evidenceGapIds: [],
      uncertaintyIds: [],
      persistentActionIds: [],
    }),
  );
}

function reviewView(
  source: ReturnType<typeof pendingSource> | ReturnType<typeof terminalSource>,
  fixture: ReviewFixtureIdentity,
): RecordValue {
  const terminal = source.kind === 'operating-review-receipt';
  const sourceActor = terminal ? source.actor : source.reader;
  const generatedAt = terminal ? source.committedAt : source.readAt;
  const eventCount = source.eventHead.sequence;
  const allowedActions = terminal
    ? []
    : source.dispositionChoices.map((entry) => ({
        subjectId: source.review.reviewId,
        action: {
          tool: 'operate.review.submit',
          arguments: structuredClone(entry.submitArguments),
          label: entry.label,
          effect: 'project-write',
        },
      }));
  return rehashExperienceView({
    ...structuredClone(experienceFixture),
    actorId: sourceActor.actorId,
    scopeId: source.scope.scopeId,
    domainId: source.scope.domainId,
    domainVersion: source.scope.domainVersion,
    generatedAt,
    eventHead: structuredClone(source.eventHead),
    status: 'ready',
    cycles: [
      {
        cycleId: source.cycleId,
        state: terminal ? 'closed' : 'awaiting_review',
        health: 'normal',
        focus: ['Review the bounded operating recommendation'],
        createdAt: '2026-08-23T08:00:00.000Z',
        updatedAt: generatedAt,
        stages: stages(terminal),
        assignments: [
          {
            assignmentId: 'asg_review_dashboard_0001',
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
        ],
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
    evidence: [
      {
        evidenceRefId: 'evr_review_dashboard_0001',
        classification: 'internal',
        accessState: 'available',
        freshness: 'current',
        evidenceKind: null,
        resolvedAt: null,
        claimStatus: 'supported',
        supportClaimIds: ['clm_review_dashboard_0001'],
        contradictClaimIds: [],
        source: null,
        producer: null,
        observedAt: null,
        scope: scope(fixture),
        sensitivity: 'internal',
        provenance: null,
        confidence: 0.9,
        gaps: [],
        errors: [],
        accessReason: null,
        causalLinks: [],
        deepLink: '#/operate/evidence/evr_review_dashboard_0001',
      },
    ],
    claims: [
      {
        claimId: 'clm_review_dashboard_0001',
        status: 'supported',
        epistemicStatus: 'strongly-supported',
        statement: 'The accepted evidence supports the recommendation.',
        supportEvidenceRefIds: ['evr_review_dashboard_0001'],
        contradictEvidenceRefIds: [],
        source: null,
        producer: null,
        observedAt: generatedAt,
        scope: scope(fixture),
        sensitivity: 'internal',
        provenance: null,
        confidence: 0.9,
        gaps: [],
        errors: [],
        accessReason: null,
        causalLinks: [],
        deepLink: '#/operate/evidence/clm_review_dashboard_0001',
      },
    ],
    outcomes: [],
    learnings: [],
    history: [],
    replay: {
      checkpoint: null,
      tail: {
        startSequence: 1,
        endSequence: eventCount,
        eventCount,
        eventReplayIndexHash: fixture.readHead.hash,
      },
      finalHead: structuredClone(source.eventHead),
      liveAccessUsed: false,
      parityProof: {
        sourceStateHash: experienceFixture.sourceStateHash,
        eventReplayIndexHash: fixture.readHead.hash,
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
      redactions: [],
    },
    allowedActions,
    omissions: [],
    export: { formats: ['json', 'html'], accessSafe: true, redactionCount: 0 },
  });
}

export function createPendingReviewDisplay(
  choiceCount = 2,
  fixture: ReviewFixtureIdentity = REVIEW_FIXTURE,
): OperateReviewDisplayWorkspaceV1 {
  const source = pendingSource(choiceCount, fixture);
  return issueOperateReviewDisplayWorkspaceV1(
    buildOperateReviewWorkspacePayloadV1(source as never, reviewView(source, fixture) as never),
  );
}

export function createTerminalReviewDisplay(
  note: string | null = null,
  fixture: ReviewFixtureIdentity = REVIEW_FIXTURE,
  disposition: ReviewFixtureDisposition = 'approved',
): Readonly<{
  workspace: OperateReviewDisplayWorkspaceV1;
  receipt: OperatingReviewReceiptV2 & { boundSubmission: OperatingReviewBoundSubmissionV1 };
}> {
  const pending = pendingSource(3, fixture);
  const receipt = terminalSource(pending, note, fixture, disposition);
  const workspace = issueOperateReviewDisplayWorkspaceV1(
    buildOperateReviewWorkspacePayloadV1(receipt, reviewView(receipt, fixture) as never),
  );
  return Object.freeze({ workspace, receipt });
}
