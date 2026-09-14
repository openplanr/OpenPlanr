import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  assertOperatingReviewBoundSubmissionV1,
  buildOperatingReviewBoundSubmissionV1,
  computeOperatingReviewBoundSubmissionHashV1,
  createEmptyOperatingRuntimeStateV2,
  readCommittedOperatingReviewReceiptV2,
  readOperatingReviewV2,
  submitBoundOperatingReviewV2,
} from '../../lib/operate/runtime-foundation.mjs';

const TIME = '2026-08-23T08:00:00.000Z';
const COMMIT_TIME = '2026-08-23T08:01:00.000Z';
const ACTOR = Object.freeze({ actorId: 'owner-bound-001', kind: 'human', runtime: 'portable' });
const SCOPE = Object.freeze({ scopeId: 'scope-bound', domainId: 'business', domainVersion: '1.0.0' });
const CAPABILITY = Object.freeze({ id: 'operate-review-submit', version: '2.0.0' });

function state() {
  return {
    ...createEmptyOperatingRuntimeStateV2(TIME),
    cycles: [{
      kind: 'operating-cycle', schemaVersion: '1.0.0', protocolVersion: '2.0.0',
      cycleId: 'cyc_bound_00000001', scopeId: SCOPE.scopeId, domainId: SCOPE.domainId,
      domainVersion: SCOPE.domainVersion, state: 'awaiting_review', inputBindingId: 'inb_bound_00000001',
      contractVersions: { 'advisor-result': '1.0.0' }, trigger: { kind: 'manual' }, focus: ['strategy'],
      health: 'normal', activeReviewId: 'rev_bound_00000001', createdAt: TIME, updatedAt: TIME,
    }],
    reviews: [{
      kind: 'operating-review', schemaVersion: '1.0.0', protocolVersion: '2.0.0',
      reviewId: 'rev_bound_00000001', cycleId: 'cyc_bound_00000001', ownerActorId: ACTOR.actorId,
      state: 'pending', disposition: null, workDispositions: [], createdAt: TIME, updatedAt: TIME,
    }],
  };
}

function read(initialState = state()) {
  return readOperatingReviewV2({
    reviewId: 'rev_bound_00000001', cycleId: 'cyc_bound_00000001', actor: ACTOR, scope: SCOPE,
  }, { initialState, capabilities: ['operate.review.get'], readAt: COMMIT_TIME });
}

function bound(disposition = 'approved', note = null, initialState = state()) {
  const reviewRead = read(initialState);
  const choice = reviewRead.data.dispositionChoices.find((entry) => (
    entry.submitArguments.disposition === disposition
  ));
  return buildOperatingReviewBoundSubmissionV1({
    expectedReadEventHead: reviewRead.data.eventHead,
    choice,
    note,
  });
}

function draft(eventId = 'evt_bound_review_00000001') {
  return { eventId, timestamp: COMMIT_TIME, correlationId: 'corr_bound_review_00000001' };
}

function rehash(value) {
  const next = structuredClone(value);
  next.boundSubmissionHash = computeOperatingReviewBoundSubmissionHashV1(next);
  return next;
}

test('bound Review wrapper rejects extra/missing legacy arguments and a substituted choice hash', () => {
  const canonical = bound();
  const extra = structuredClone(canonical);
  extra.submitArguments.ownerGrant = 'forged';
  extra.choiceHash = sha256Jcs(extra.submitArguments);
  assert.throws(() => assertOperatingReviewBoundSubmissionV1(rehash(extra)), {
    code: 'RESULT_CONTRACT_INVALID',
  });

  const missing = structuredClone(canonical);
  delete missing.submitArguments.scope;
  missing.choiceHash = sha256Jcs(missing.submitArguments);
  assert.throws(() => assertOperatingReviewBoundSubmissionV1(rehash(missing)), {
    code: 'RESULT_CONTRACT_INVALID',
  });

  const substituted = structuredClone(canonical);
  substituted.choiceHash = `sha256:${'f'.repeat(64)}`;
  assert.throws(() => assertOperatingReviewBoundSubmissionV1(rehash(substituted)), {
    code: 'RESULT_CONTRACT_INVALID',
  });

  const tamperedNote = structuredClone(canonical);
  tamperedNote.note = 'Changed after the owner-bound digest.';
  assert.throws(() => assertOperatingReviewBoundSubmissionV1(tamperedNote), {
    code: 'RESULT_CONTRACT_INVALID',
  });
});

test('foreign actor/scope/Review and altered dispositions append no Review event', () => {
  const candidates = [];
  const foreignActor = structuredClone(bound());
  foreignActor.submitArguments.actor.actorId = 'foreign-owner-001';
  foreignActor.choiceHash = sha256Jcs(foreignActor.submitArguments);
  candidates.push({ request: rehash(foreignActor), code: 'REVIEW_NOT_AUTHORIZED' });

  const foreignScope = structuredClone(bound());
  foreignScope.submitArguments.scope.scopeId = 'scope-foreign';
  foreignScope.choiceHash = sha256Jcs(foreignScope.submitArguments);
  candidates.push({ request: rehash(foreignScope), code: 'OPERATING_SCOPE_INVALID' });

  const foreignReview = structuredClone(bound());
  foreignReview.submitArguments.reviewId = 'rev_foreign_00000001';
  foreignReview.choiceHash = sha256Jcs(foreignReview.submitArguments);
  candidates.push({ request: rehash(foreignReview), code: 'REVIEW_NOT_FOUND' });

  const changedDispositions = structuredClone(bound());
  changedDispositions.submitArguments.workDispositions = [{
    entityType: 'operating-finding', entityId: 'fnd_foreign_00000001', disposition: 'accepted',
  }];
  changedDispositions.choiceHash = sha256Jcs(changedDispositions.submitArguments);
  candidates.push({ request: rehash(changedDispositions), code: 'CONCURRENT_MODIFICATION' });

  for (const [index, candidate] of candidates.entries()) {
    const initialState = state();
    const before = structuredClone(initialState);
    assert.throws(() => submitBoundOperatingReviewV2(
      candidate.request,
      draft(`evt_bound_hostile_${index}`),
      { initialState, capabilities: [CAPABILITY] },
    ), { code: candidate.code });
    assert.deepEqual(initialState, before);
    assert.equal(initialState.eventHead.sequence, 0);
  }
});

test('bound Review commit retains note/proof, reconstructs receipt, and lost-response retry is exact', () => {
  const initialState = state();
  const request = bound('approved', 'Approve after reviewing the exact evidence.', initialState);
  const eventDraft = draft();
  const committed = submitBoundOperatingReviewV2(request, eventDraft, {
    initialState, capabilities: [CAPABILITY],
  });
  assert.equal(committed.replayed, false);
  assert.equal(committed.events.length, 1);
  assert.deepEqual(committed.events[0].payload.receiptProjection.boundSubmission, request);
  assert.deepEqual(committed.response.data.boundSubmission, request);
  assert.equal(committed.response.data.boundSubmission.note, 'Approve after reviewing the exact evidence.');
  assert.equal(committed.state.reviews[0].state, 'approved');

  const reconstructed = readCommittedOperatingReviewReceiptV2({
    reviewId: request.submitArguments.reviewId,
    cycleId: request.submitArguments.cycleId,
    actor: ACTOR,
    scope: SCOPE,
  }, { initialState: committed.state, capabilities: ['operate.review.get'] });
  assert.deepEqual(reconstructed.data, committed.response.data);

  const replayed = submitBoundOperatingReviewV2(request, eventDraft, {
    initialState: committed.state, capabilities: [CAPABILITY],
  });
  assert.equal(replayed.replayed, true);
  assert.deepEqual(replayed.events, []);
  assert.deepEqual(replayed.response.data, committed.response.data);
});

test('every advertised bound Review disposition commits once with its exact choice proof', () => {
  for (const disposition of ['approved', 'changes_requested', 'rejected', 'cancelled']) {
    const initialState = state();
    const request = bound(disposition, `Owner selected ${disposition}.`, initialState);
    const committed = submitBoundOperatingReviewV2(
      request,
      draft(`evt_bound_disposition_${disposition}`),
      { initialState, capabilities: [CAPABILITY] },
    );
    assert.equal(committed.events.length, 1, disposition);
    assert.equal(committed.response.data.decision, disposition);
    assert.equal(committed.response.data.appliedChoiceId, request.choiceId);
    assert.equal(committed.response.data.appliedChoiceHash, request.choiceHash);
    assert.deepEqual(committed.response.data.boundSubmission, request);
    assert.equal(committed.state.eventHead.sequence, 1);
  }
});

test('novel stale/future head and changed choice proofs fail before mutation', () => {
  for (const expectedReadEventHead of [
    { sequence: 1, hash: `sha256:${'1'.repeat(64)}` },
    { sequence: 7, hash: `sha256:${'7'.repeat(64)}` },
  ]) {
    const initialState = state();
    const request = rehash({ ...structuredClone(bound()), expectedReadEventHead });
    const before = structuredClone(initialState);
    assert.throws(() => submitBoundOperatingReviewV2(request, draft(`evt_bound_head_${expectedReadEventHead.sequence}`), {
      initialState, capabilities: [CAPABILITY],
    }), { code: 'CONCURRENT_MODIFICATION' });
    assert.deepEqual(initialState, before);
  }

  const initialState = state();
  const changedChoice = rehash({ ...structuredClone(bound()), choiceId: 'rch_changed_00000001' });
  const before = structuredClone(initialState);
  assert.throws(() => submitBoundOperatingReviewV2(changedChoice, draft('evt_bound_changed_choice'), {
    initialState, capabilities: [CAPABILITY],
  }), { code: 'CONCURRENT_MODIFICATION' });
  assert.deepEqual(initialState, before);
});

test('concurrent owner tabs close once and divergent retry identity conflicts', () => {
  const initialState = state();
  const approved = bound('approved', null, initialState);
  const rejected = bound('rejected', null, initialState);
  const committed = submitBoundOperatingReviewV2(approved, draft('evt_bound_tab_approved'), {
    initialState, capabilities: [CAPABILITY],
  });
  assert.throws(() => submitBoundOperatingReviewV2(rejected, draft('evt_bound_tab_rejected'), {
    initialState: committed.state, capabilities: [CAPABILITY],
  }), { code: 'CONCURRENT_MODIFICATION' });
  assert.equal(committed.state.eventHead.sequence, 1);

  const changedNote = buildOperatingReviewBoundSubmissionV1({
    expectedReadEventHead: approved.expectedReadEventHead,
    choice: approved,
    note: 'Different retry bytes.',
  });
  assert.throws(() => submitBoundOperatingReviewV2(changedNote, draft('evt_bound_tab_approved'), {
    initialState: committed.state, capabilities: [CAPABILITY],
  }), { code: 'CONCURRENT_MODIFICATION' });
  assert.equal(committed.state.eventHead.sequence, 1);
});
