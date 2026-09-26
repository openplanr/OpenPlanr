import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { jcsHash } from '../../lib/dashboard/closed-json-contract.mjs';
import {
  assertOperatingReviewBoundSubmissionV1,
  assertOperatingReviewReceiptV2,
  computeOperatingReviewBoundSubmissionHashV1,
} from '../../lib/dashboard/operate-review-contract.mjs';

const TIME = '2026-08-23T08:00:00.000Z';
const COMMITTED_AT = '2026-08-23T08:01:00.000Z';
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const ACTOR = Object.freeze({ actorId: 'owner-browser-001', kind: 'human', runtime: 'openplanr' });
const SCOPE = Object.freeze({
  scopeId: 'scope-browser',
  domainId: 'business',
  domainVersion: '1.0.0',
});

function boundSubmission(submitArguments) {
  const base = {
    kind: 'operate-review-bound-submission',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    expectedReadEventHead: { sequence: 7, hash: HASH_A },
    choiceId: 'rch_browser_00000001',
    choiceHash: jcsHash(submitArguments),
    submitArguments: structuredClone(submitArguments),
    note: 'Owner confirmed the exact displayed choice.',
  };
  return {
    ...base,
    boundSubmissionHash: computeOperatingReviewBoundSubmissionHashV1(base),
  };
}

function receipt() {
  const submitArguments = {
    reviewId: 'rev_browser_00000001',
    cycleId: 'cyc_browser_00000001',
    actor: structuredClone(ACTOR),
    scope: structuredClone(SCOPE),
    disposition: 'approved',
    workDispositions: [],
  };
  const bound = boundSubmission(submitArguments);
  return {
    kind: 'operating-review-receipt',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    receiptId: 'rrc_browser_00000001',
    cycleId: submitArguments.cycleId,
    readEventHead: structuredClone(bound.expectedReadEventHead),
    eventHead: { sequence: 8, hash: HASH_B },
    scope: structuredClone(SCOPE),
    actor: structuredClone(ACTOR),
    review: {
      kind: 'operating-review',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      reviewId: submitArguments.reviewId,
      cycleId: submitArguments.cycleId,
      ownerActorId: ACTOR.actorId,
      state: 'approved',
      disposition: 'approved',
      workDispositions: [],
      createdAt: TIME,
      updatedAt: COMMITTED_AT,
    },
    decision: 'approved',
    seatStatus: [],
    decisions: [],
    actions: [],
    findings: [],
    dissent: [],
    gaps: [],
    dispositionChoices: [
      {
        choiceId: bound.choiceId,
        choiceHash: bound.choiceHash,
        label: 'Approve the exact proposed work',
        submitArguments: structuredClone(submitArguments),
      },
    ],
    appliedChoiceId: bound.choiceId,
    appliedChoiceHash: bound.choiceHash,
    appliedWorkDispositions: [],
    boundSubmission: bound,
    summary: {
      decisionCount: 0,
      actionCount: 0,
      findingCount: 0,
      dissentCount: 0,
      gapCount: 0,
      message: 'The exact advertised approval disposition was committed.',
    },
    committedAt: COMMITTED_AT,
  };
}

function rehashBound(value) {
  value.boundSubmissionHash = computeOperatingReviewBoundSubmissionHashV1(value);
  return value;
}

test('browser Review contract accepts exact bound submissions and legacy or bound receipts', () => {
  const exact = receipt();
  assert.equal(
    assertOperatingReviewBoundSubmissionV1(exact.boundSubmission),
    exact.boundSubmission,
  );
  assert.equal(assertOperatingReviewReceiptV2(exact), exact);

  const legacy = structuredClone(exact);
  delete legacy.boundSubmission;
  assert.equal(assertOperatingReviewReceiptV2(legacy), legacy);
});

test('browser Review contract rejects closed-schema, choice, work, head, hash, and bound-proof drift', () => {
  const extra = structuredClone(receipt());
  extra.privatePath = '/Users/owner/private';

  const choice = structuredClone(receipt());
  choice.appliedChoiceHash = `sha256:${'c'.repeat(64)}`;

  const work = structuredClone(receipt());
  work.review.workDispositions = [
    {
      entityType: 'operating-finding',
      entityId: 'fnd_browser_00000001',
      disposition: 'accepted',
    },
  ];

  const head = structuredClone(receipt());
  head.eventHead.sequence = 9;

  const boundHead = structuredClone(receipt());
  boundHead.boundSubmission.expectedReadEventHead = { sequence: 0, hash: null };
  rehashBound(boundHead.boundSubmission);

  const duplicateChoice = structuredClone(receipt());
  duplicateChoice.dispositionChoices.push({
    ...structuredClone(duplicateChoice.dispositionChoices[0]),
    choiceId: 'rch_browser_00000002',
  });

  const summary = structuredClone(receipt());
  summary.summary.findingCount = 1;

  for (const hostile of [extra, choice, work, head, boundHead, duplicateChoice, summary]) {
    assert.throws(() => assertOperatingReviewReceiptV2(hostile), {
      code: 'E_OPERATE_REVIEW_RECEIPT_INVALID',
    });
  }

  const boundExtra = structuredClone(receipt().boundSubmission);
  boundExtra.grant = 'forged';
  rehashBound(boundExtra);
  assert.throws(() => assertOperatingReviewBoundSubmissionV1(boundExtra), {
    code: 'RESULT_CONTRACT_INVALID',
  });

  const boundChoice = structuredClone(receipt().boundSubmission);
  boundChoice.choiceHash = `sha256:${'d'.repeat(64)}`;
  rehashBound(boundChoice);
  assert.throws(() => assertOperatingReviewBoundSubmissionV1(boundChoice), {
    code: 'RESULT_CONTRACT_INVALID',
  });

  const boundNote = structuredClone(receipt().boundSubmission);
  boundNote.note = 'Changed after hashing.';
  assert.throws(() => assertOperatingReviewBoundSubmissionV1(boundNote), {
    code: 'RESULT_CONTRACT_INVALID',
  });
});

test('browser Review contract rejects schema-valid private paths and secrets in receipt text', () => {
  const privatePath = structuredClone(receipt());
  privatePath.summary.message = 'Inspect /Users/owner/private/review-notes.md before approval.';
  assert.throws(() => assertOperatingReviewReceiptV2(privatePath), {
    code: 'E_OPERATE_REVIEW_WORKSPACE_UNSAFE',
  });

  const secret = structuredClone(receipt());
  secret.boundSubmission.note = 'Authorization: super-secret-review-token';
  rehashBound(secret.boundSubmission);
  assert.throws(() => assertOperatingReviewReceiptV2(secret), {
    code: 'E_OPERATE_REVIEW_WORKSPACE_UNSAFE',
  });
});

test('public Review contract bundles for a browser with no Node builtin or Node global', async () => {
  const result = await build({
    entryPoints: [
      fileURLToPath(new URL('../../lib/dashboard/operate-review-contract.mjs', import.meta.url)),
    ],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome103', 'firefox113', 'safari16.4'],
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const inputs = Object.keys(result.metafile.inputs);
  assert.equal(
    inputs.some((input) => input.startsWith('node:')),
    false,
  );
  assert.equal(
    inputs.some((input) => input.endsWith('generated/operate-review-schema-data.mjs')),
    true,
  );
  assert.equal(
    inputs.some((input) => input.endsWith('generated/operate-experience-surface-schema-data.mjs')),
    false,
  );
  assert.equal(
    inputs.some((input) => input.endsWith('generated/operate-schema-token-codec.mjs')),
    true,
  );
  assert.equal(
    inputs.some((input) => input.includes('review-workspace-projection-v2')),
    false,
  );
  assert.equal(
    inputs.some((input) => input.includes('protocol/contracts')),
    false,
  );
  assert.equal(
    inputs.some((input) => input.includes('protocol/loader')),
    false,
  );
  assert.equal(
    inputs.some((input) => input.includes('runtime-foundation')),
    false,
  );
  const output = result.outputFiles.map(({ text }) => text).join('\n');
  assert.doesNotMatch(output, /\bnode:/u);
  assert.doesNotMatch(output, /\bprocess\s*\.|\b(?:Buffer|__dirname|__filename)\b/u);
  assert.doesNotMatch(output, /\brequire\s*\(/u);
});
