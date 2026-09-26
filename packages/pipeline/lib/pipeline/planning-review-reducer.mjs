import { validateProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';
import { PipelineError } from './errors.mjs';
import {
  MANDATORY_PLANNING_REVIEWERS,
  PLANNING_REVIEW_SPECIALISTS,
} from './planning-review-identity.mjs';

const BLOCKING = new Set(['P0', 'P1']);
const PRIVATE_TEXT =
  /(?:\b(?:password|secret|token|api[_-]?key|private[_-]?key)\b\s*[:=]\s*\S{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|(?:^|[\s("'`])(?:\/[A-Za-z0-9._-]+){3,}(?:[\s)"'`,:]|$)|[A-Za-z]:\\[^\s"'`,]+)/iu;

function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}

function clone(value) {
  return structuredClone(value);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertPortable(value, path = '$') {
  if (typeof value === 'string') {
    if (value.length > 8_000 || PRIVATE_TEXT.test(value))
      fail(
        'E_PLAN_REVIEW_PRIVATE_DATA',
        `${path} contains private, secret, path, or oversized text.`,
      );
    return;
  }
  if (Array.isArray(value))
    value.forEach((entry, index) => assertPortable(entry, `${path}[${index}]`));
  else if (value && typeof value === 'object')
    Object.entries(value).forEach(([key, entry]) => assertPortable(entry, `${path}.${key}`));
}

export function planningReviewerRoster(declaredSpecialists = []) {
  if (
    !Array.isArray(declaredSpecialists) ||
    new Set(declaredSpecialists).size !== declaredSpecialists.length
  ) {
    fail(
      'E_PLAN_REVIEW_REVIEWER_INVALID',
      'Declared planning specialists must be one unique array.',
    );
  }
  const specialists = PLANNING_REVIEW_SPECIALISTS.filter((id) => declaredSpecialists.includes(id));
  if (!same(specialists, declaredSpecialists))
    fail(
      'E_PLAN_REVIEW_REVIEWER_INVALID',
      'Declared planning specialists must use canonical registry order.',
    );
  return [...MANDATORY_PLANNING_REVIEWERS, ...specialists];
}

export function validatePlanningReviewEvent(event) {
  const publicEvent = clone(event);
  const suppliedEventId = publicEvent?.eventId;
  delete publicEvent.eventId;
  const errors = validateProtocolArtifact('planning-review-event', publicEvent, {
    protocolVersion: '1.1.0',
  });
  if (errors.length) fail('E_PLAN_REVIEW_EVENT_INVALID', `${errors[0].path}: ${errors[0].detail}`);
  const eventId = `pre_${sha256Jcs(publicEvent).slice(7, 39)}`;
  if (suppliedEventId !== undefined && suppliedEventId !== eventId)
    fail('E_PLAN_REVIEW_EVENT_INVALID', 'eventId does not match canonical event bytes.');
  assertPortable(publicEvent);
  return { ...publicEvent, eventId };
}

function blocking(findings) {
  return findings.filter(
    ({ severity, disposition }) =>
      BLOCKING.has(severity) && ['open', 'remains'].includes(disposition),
  );
}

function findingIdentity(finding) {
  const { id: _id, disposition: _disposition, ...identity } = finding;
  return identity;
}

function canonicalFinding(finding, phase, candidateDigest) {
  const value = clone(finding);
  if (phase === 'initial') {
    if (value.id !== null)
      fail(
        'E_PLAN_REVIEW_FINDING_INVALID',
        'Initial findings use id:null; the reducer owns persistent identities.',
      );
    if (BLOCKING.has(value.severity) && value.disposition !== 'open')
      fail('E_PLAN_REVIEW_FINDING_INVALID', 'Initial P0/P1 findings must be open.');
    if (value.severity === 'P2' && !['deferred', 'resolved'].includes(value.disposition))
      fail('E_PLAN_REVIEW_FINDING_INVALID', 'Initial P2 findings must be deferred or resolved.');
    value.id = `pfnd_${sha256Jcs({ candidateDigest, finding: findingIdentity(value) }).slice(7, 39)}`;
  }
  return value;
}

function assertReviewPacket(state, event) {
  const expectedPhase =
    state.state === 'reviewing_initial'
      ? 'initial'
      : state.state === 'reviewing_targeted'
        ? 'targeted'
        : null;
  if (event.phase !== expectedPhase)
    fail(
      'E_PLAN_REVIEW_TRANSITION_INVALID',
      `${event.phase} review cannot close from ${state.state}.`,
    );
  const candidate = state.candidateRevisions.at(-1);
  if (
    event.candidateRevision !== candidate.revision ||
    event.candidateDigest !== candidate.planDigest
  ) {
    fail('E_PLAN_REVIEW_CANDIDATE_STALE', 'Review does not bind the current exact plan candidate.');
  }
  if (!same(event.reviewerIds, state.reviewerRoster))
    fail(
      'E_PLAN_REVIEW_REVIEWER_UNDECLARED',
      'Review must name the frozen roster in canonical order.',
    );
  const contributionIds = event.contributions.map(({ reviewerId }) => reviewerId);
  if (!same(contributionIds, state.reviewerRoster))
    fail(
      'E_PLAN_REVIEW_REVIEWER_UNDECLARED',
      'Contributions must cover the frozen roster exactly once in canonical order.',
    );
  const dissentIds = event.dissent.map(({ reviewerId }) => reviewerId);
  if (
    new Set(dissentIds).size !== dissentIds.length ||
    dissentIds.some((id) => !state.reviewerRoster.includes(id))
  ) {
    fail(
      'E_PLAN_REVIEW_REVIEWER_UNDECLARED',
      'Dissent may name each frozen reviewer at most once.',
    );
  }
  if (event.phase === 'initial') {
    if (event.reviewedFindingIds.length)
      fail('E_PLAN_REVIEW_FINDING_INVALID', 'Initial review cannot adjudicate prior findings.');
    return event.findings.map((finding) =>
      canonicalFinding(finding, 'initial', candidate.planDigest),
    );
  }
  const initialBlocking = blocking(state.reviews[0].findings);
  const requiredIds = initialBlocking.map(({ id }) => id).sort();
  if (!same([...event.reviewedFindingIds].sort(), requiredIds))
    fail(
      'E_PLAN_REVIEW_FINDING_INVALID',
      'Targeted review must account for the exact initial blocking finding set.',
    );
  const repeated = event.findings.filter(({ id }) => id !== null);
  if (!same(repeated.map(({ id }) => id).sort(), requiredIds))
    fail(
      'E_PLAN_REVIEW_FINDING_INVALID',
      'Targeted findings must repeat every initial blocker exactly once.',
    );
  for (const finding of repeated) {
    const original = initialBlocking.find(({ id }) => id === finding.id);
    if (
      !original ||
      !same(findingIdentity(finding), findingIdentity(original)) ||
      !['resolved', 'remains'].includes(finding.disposition)
    ) {
      fail(
        'E_PLAN_REVIEW_FINDING_INVALID',
        `Targeted finding ${finding.id} changed immutable finding evidence or has an invalid disposition.`,
      );
    }
  }
  const newlyExposed = event.findings
    .filter(({ id }) => id === null)
    .map((finding) => {
      if (!BLOCKING.has(finding.severity) || finding.disposition !== 'open')
        fail(
          'E_PLAN_REVIEW_FINDING_INVALID',
          'Only directly correction-exposed open P0/P1 may be new in targeted review.',
        );
      return canonicalFinding(finding, 'initial', candidate.planDigest);
    });
  return [...repeated, ...newlyExposed];
}

function appendEvent(state, event, runtime) {
  state.generation += 1;
  state.updatedAt = runtime.now;
  state.events.push({
    eventId: event.eventId,
    type: event.type,
    generation: state.generation,
    inputDigest: runtime.inputDigest,
    at: runtime.now,
  });
}

function validateSemantics(value) {
  const roster = planningReviewerRoster(
    value.reviewerRoster.slice(MANDATORY_PLANNING_REVIEWERS.length),
  );
  if (!same(roster, value.reviewerRoster) || value.rosterDigest !== sha256Jcs(value.reviewerRoster))
    fail(
      'E_PLAN_REVIEW_INVALID',
      'reviewerRoster and rosterDigest do not bind the canonical roster.',
    );
  if (value.candidateRevisions.some((candidate, index) => candidate.revision !== index + 1))
    fail(
      'E_PLAN_REVIEW_INVALID',
      'Plan candidate revisions must be contiguous and bounded to two.',
    );
  if (
    new Set(value.events.map(({ eventId }) => eventId)).size !== value.events.length ||
    value.events.some((event, index) => event.generation !== index + 1) ||
    value.generation !== value.events.length
  )
    fail('E_PLAN_REVIEW_INVALID', 'Event receipts must be unique and generation-contiguous.');
  if (
    value.reviews.some(
      (review, index) =>
        review.candidateRevision !== index + 1 ||
        review.candidateDigest !== value.candidateRevisions[index]?.planDigest ||
        !same(review.reviewerIds, value.reviewerRoster) ||
        !same(
          review.contributions.map(({ reviewerId }) => reviewerId),
          value.reviewerRoster,
        ),
    )
  ) {
    fail('E_PLAN_REVIEW_INVALID', 'Reviews do not bind candidate and frozen reviewer custody.');
  }
  if (
    value.reviews.some(
      ({ findings }) => new Set(findings.map(({ id }) => id)).size !== findings.length,
    )
  ) {
    fail('E_PLAN_REVIEW_INVALID', 'Finding IDs must be unique within each consolidated batch.');
  }
  if (value.correction !== null) {
    const initialIds = blocking(value.reviews[0]?.findings ?? [])
      .map(({ id }) => id)
      .sort();
    if (
      value.candidateRevisions.length !== 2 ||
      !same([...value.correction.findingIds].sort(), initialIds) ||
      value.correction.fromPlanDigest !== value.candidateRevisions[0].planDigest ||
      value.correction.toPlanDigest !== value.candidateRevisions[1].planDigest ||
      value.correction.fromPlanDigest === value.correction.toPlanDigest
    )
      fail(
        'E_PLAN_REVIEW_INVALID',
        'Correction does not bind the single complete blocking batch and distinct successor plan.',
      );
  }
  if (value.recordType === 'active') {
    const valid =
      (value.state === 'reviewing_initial' &&
        value.reviews.length === 0 &&
        value.candidateRevisions.length === 1) ||
      (value.state === 'correction_required' &&
        value.reviews.length === 1 &&
        blocking(value.reviews[0].findings).length > 0 &&
        value.correction === null) ||
      (value.state === 'reviewing_targeted' &&
        value.reviews.length === 1 &&
        value.candidateRevisions.length === 2 &&
        value.correction !== null) ||
      (value.state === 'awaiting_owner' &&
        value.reviews.length === value.candidateRevisions.length &&
        value.reviewOutcome !== null);
    if (!valid)
      fail(
        'E_PLAN_REVIEW_INVALID',
        `Active state ${value.state} is inconsistent with finite review custody.`,
      );
  } else {
    if (
      !value.ownerDecision ||
      !value.terminal ||
      value.state !== value.terminal.status ||
      value.ownerDecision.planDigest !== value.candidateRevisions.at(-1).planDigest ||
      value.ownerDecision.candidateRevision !== value.candidateRevisions.at(-1).revision ||
      value.ownerDecision.decisionDigest !==
        sha256Jcs({ ...value.ownerDecision, decisionDigest: null }) ||
      value.terminal.ownerDecisionDigest !== value.ownerDecision.decisionDigest ||
      value.terminal.planDigest !== value.ownerDecision.planDigest ||
      value.receiptHash !== sha256Jcs({ ...value, receiptHash: null })
    )
      fail(
        'E_PLAN_REVIEW_INVALID',
        'Terminal receipt does not bind its exact owner decision, candidate, and canonical bytes.',
      );
  }
  assertPortable(value);
  return value;
}

export function assertPlanningReview(value) {
  const kind =
    value?.recordType === 'receipt' ? 'planning-review-receipt' : 'planning-review-state';
  const errors = validateProtocolArtifact(kind, value, { protocolVersion: '1.1.0' });
  if (errors.length) fail('E_PLAN_REVIEW_INVALID', `${errors[0].path}: ${errors[0].detail}`);
  return validateSemantics(value);
}

export function createPlanningReview({
  runId,
  feature,
  plan,
  reviewerRoster,
  runtime = 'unknown',
  now,
}) {
  const state = {
    kind: 'planning-review',
    schemaVersion: '1.0.0',
    protocolVersion: '1.1.0',
    recordType: 'active',
    runId,
    generation: 0,
    state: 'reviewing_initial',
    feature: clone(feature),
    runtime,
    createdAt: now,
    updatedAt: now,
    reviewerRoster: clone(reviewerRoster),
    rosterDigest: sha256Jcs(reviewerRoster),
    candidateRevisions: [
      {
        revision: 1,
        planDigest: plan.planDigest,
        professionalSpecificationDigest: plan.professionalSpecification.digest,
        createdAt: now,
      },
    ],
    reviews: [],
    correction: null,
    reviewOutcome: null,
    ownerDecision: null,
    events: [],
    terminal: null,
    receiptHash: null,
  };
  return assertPlanningReview(state);
}

export function reducePlanningReview(current, submittedEvent, runtime = {}) {
  const state = clone(assertPlanningReview(current));
  const event = validatePlanningReviewEvent(submittedEvent);
  const prior = state.events.find(({ eventId }) => event.eventId === eventId);
  if (prior) {
    if (prior.inputDigest !== runtime.inputDigest)
      fail(
        'E_PLAN_REVIEW_EVENT_REPLAY_DIVERGED',
        `Event ${event.eventId} replayed with divergent bytes.`,
      );
    return state;
  }
  if (state.recordType === 'receipt')
    fail('E_PLAN_REVIEW_TERMINAL', 'Terminal planning review receipts are immutable.');
  if (event.expectedGeneration !== state.generation)
    fail(
      'E_PLAN_REVIEW_GENERATION_CONFLICT',
      `Expected generation ${event.expectedGeneration}, current generation is ${state.generation}.`,
    );
  if (typeof runtime.now !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(runtime.inputDigest ?? ''))
    fail(
      'E_PLAN_REVIEW_RUNTIME_INVALID',
      'Reducer requires bounded runtime time and input digest.',
    );

  if (event.type === 'review.closed') {
    const findings = assertReviewPacket(state, event);
    state.reviews.push({
      phase: event.phase,
      candidateRevision: event.candidateRevision,
      candidateDigest: event.candidateDigest,
      reviewerIds: clone(event.reviewerIds),
      contributions: clone(event.contributions),
      findings,
      dissent: clone(event.dissent),
      reviewedFindingIds: clone(event.reviewedFindingIds),
      summary: event.summary,
      closedAt: runtime.now,
    });
    const blockers = blocking(findings);
    if (event.phase === 'initial' && blockers.length) {
      state.state = 'correction_required';
      state.reviewOutcome = null;
    } else {
      state.state = 'awaiting_owner';
      state.reviewOutcome = blockers.length ? 'blocked' : 'pass-candidate';
    }
  } else if (event.type === 'correction.registered') {
    if (
      state.state !== 'correction_required' ||
      state.correction !== null ||
      state.candidateRevisions.length !== 1
    )
      fail(
        'E_PLAN_REVIEW_TRANSITION_INVALID',
        'Only one correction may follow the initial blocking batch.',
      );
    const required = blocking(state.reviews[0].findings)
      .map(({ id }) => id)
      .sort();
    if (!same([...event.findingIds].sort(), required))
      fail(
        'E_PLAN_REVIEW_FINDING_INVALID',
        'Correction must address the exact initial blocking finding set.',
      );
    const candidate = runtime.candidate;
    if (
      !candidate ||
      candidate.planDigest !== event.expectedPlanDigest ||
      candidate.planDigest === state.candidateRevisions[0].planDigest
    )
      fail(
        'E_PLAN_REVIEW_CANDIDATE_STALE',
        'Correction must bind one distinct current plan successor.',
      );
    state.candidateRevisions.push({
      revision: 2,
      planDigest: candidate.planDigest,
      professionalSpecificationDigest: candidate.professionalSpecification.digest,
      createdAt: runtime.now,
    });
    state.correction = {
      summary: event.summary,
      findingIds: clone(event.findingIds),
      fromPlanDigest: state.candidateRevisions[0].planDigest,
      toPlanDigest: candidate.planDigest,
      registeredAt: runtime.now,
    };
    state.state = 'reviewing_targeted';
  } else if (event.type === 'owner.decided') {
    if (!['awaiting_owner', 'correction_required'].includes(state.state))
      fail(
        'E_PLAN_REVIEW_TRANSITION_INVALID',
        'Owner decision requires a completed review result or an explicit decision to stop before correction.',
      );
    const candidate = state.candidateRevisions.at(-1);
    if (event.candidateRevision !== candidate.revision || event.planDigest !== candidate.planDigest)
      fail('E_PLAN_REVIEW_CANDIDATE_STALE', 'Owner decision does not bind the current exact plan.');
    const outcome = state.state === 'correction_required' ? 'blocked' : state.reviewOutcome;
    if (event.decision === 'approved' && outcome !== 'pass-candidate')
      fail(
        'E_PLAN_REVIEW_OWNER_DECISION_INVALID',
        'Owner cannot approve a plan with unresolved P0/P1 findings.',
      );
    const decision = {
      ownerId: event.ownerId,
      decision: event.decision,
      reason: event.reason,
      candidateRevision: event.candidateRevision,
      planDigest: event.planDigest,
      decidedAt: runtime.now,
      decisionDigest: null,
    };
    decision.decisionDigest = sha256Jcs(decision);
    state.ownerDecision = decision;
    state.recordType = 'receipt';
    state.state = event.decision === 'approved' ? 'passed' : 'blocked';
    state.reviewOutcome = outcome;
    state.terminal = {
      status: state.state,
      at: runtime.now,
      reason: event.reason,
      planDigest: event.planDigest,
      ownerDecisionDigest: decision.decisionDigest,
    };
  }
  appendEvent(state, event, runtime);
  if (state.recordType === 'receipt')
    state.receiptHash = sha256Jcs({ ...state, receiptHash: null });
  return assertPlanningReview(state);
}
