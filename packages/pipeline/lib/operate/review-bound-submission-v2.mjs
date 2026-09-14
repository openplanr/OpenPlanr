import { PipelineError } from '../protocol/errors.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/canonical-json.mjs';

export const OPERATE_REVIEW_BOUND_SUBMISSION_DOMAIN =
  'openplanr:operate-review-bound-submission:project-write:operating-review@2.0.0#/$defs/workDisposition:1.0.0';

const HASH = /^sha256:[a-f0-9]{64}$/u;
const CHOICE_ID = /^rch_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u;
const NOTE = /^\S(?:[\s\S]*\S)?$/u;
const WRAPPER_KEYS = Object.freeze([
  'boundSubmissionHash', 'choiceHash', 'choiceId', 'expectedReadEventHead', 'kind',
  'note', 'protocolVersion', 'schemaVersion', 'submitArguments',
]);

function fail(message, context = {}) {
  throw new PipelineError('RESULT_CONTRACT_INVALID', message, '', {
    retryable: false,
    context,
  });
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((field, index) => field === expected[index]);
}

function validEventHead(value) {
  return exactKeys(value, ['hash', 'sequence'])
    && Number.isSafeInteger(value.sequence)
    && value.sequence >= 0
    && (value.sequence === 0 ? value.hash === null : HASH.test(value.hash));
}

function validNote(value) {
  return value === null
    || (typeof value === 'string' && value.length <= 2048 && NOTE.test(value));
}

function hashPayload(value) {
  return {
    domain: OPERATE_REVIEW_BOUND_SUBMISSION_DOMAIN,
    expectedReadEventHead: clone(value.expectedReadEventHead),
    choiceId: value.choiceId,
    choiceHash: value.choiceHash,
    submitArguments: clone(value.submitArguments),
    note: value.note,
  };
}

export function computeOperatingReviewBoundSubmissionHashV1(value) {
  return sha256Jcs(hashPayload(value));
}

export function assertOperatingReviewBoundSubmissionV1(value) {
  if (!exactKeys(value, WRAPPER_KEYS)
    || value.kind !== 'operate-review-bound-submission'
    || value.schemaVersion !== '1.0.0'
    || value.protocolVersion !== '2.0.0'
    || !validEventHead(value.expectedReadEventHead)
    || !CHOICE_ID.test(value.choiceId)
    || !HASH.test(value.choiceHash)
    || !value.submitArguments
    || typeof value.submitArguments !== 'object'
    || Array.isArray(value.submitArguments)
    || value.choiceHash !== sha256Jcs(value.submitArguments)
    || !validNote(value.note)
    || !HASH.test(value.boundSubmissionHash)
    || value.boundSubmissionHash !== computeOperatingReviewBoundSubmissionHashV1(value)) {
    fail('The bound Review submission wrapper is malformed or its canonical hash differs.');
  }
  try {
    assertProtocolArtifact('operate-tool-call', {
      kind: 'operate-tool-call',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      direction: 'request',
      operation: 'operate.review.submit',
      request: clone(value.submitArguments),
    }, { protocolVersion: '2.0.0' });
  } catch {
    fail('The bound Review submission must retain one exact closed legacy Review submit request.');
  }
  return value;
}

export function buildOperatingReviewBoundSubmissionV1({
  expectedReadEventHead,
  choice,
  note = null,
}) {
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
    fail('A bound Review submission requires one advertised choice.');
  }
  const base = {
    kind: 'operate-review-bound-submission',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    expectedReadEventHead: clone(expectedReadEventHead),
    choiceId: choice.choiceId,
    choiceHash: choice.choiceHash,
    submitArguments: clone(choice.submitArguments),
    note,
  };
  const value = { ...base, boundSubmissionHash: computeOperatingReviewBoundSubmissionHashV1(base) };
  assertOperatingReviewBoundSubmissionV1(value);
  return deepFreeze(value);
}
