import { validateJson } from '../../src/json-schema.mjs';
import { exactEventHead, exactJson, jcsHash, safeDataClone } from './closed-json-contract.mjs';
import {
  OPERATE_REVIEW_BOUND_SUBMISSION_SCHEMA_REVIEW_SLICE as boundSubmissionSchema,
  OPERATING_ASSIGNMENT_SCHEMA_REVIEW_SLICE as assignmentSchema,
  OPERATING_REVIEW_READ_SCHEMA_REVIEW_SLICE as reviewReadSchema,
  OPERATING_REVIEW_RECEIPT_SCHEMA_REVIEW_SLICE as reviewReceiptSchema,
  OPERATING_REVIEW_SCHEMA_REVIEW_SLICE as reviewSchema,
} from './generated/operate-review-schema-data.mjs';
import { assertOperateReviewWorkspacePayloadSafeV1 } from './operate-review-payload-safety.mjs';

export { assertOperateReviewDisplayWorkspaceV1 } from './operate-review-display-workspace-contract.mjs';

export const OPERATE_REVIEW_BOUND_SUBMISSION_DOMAIN =
  'openplanr:operate-review-bound-submission:project-write:operating-review@2.0.0#/$defs/workDisposition:1.0.0';

const schemas = new Map([
  ['operate-review-bound-submission.schema.json', boundSubmissionSchema],
  ['operating-assignment.schema.json', assignmentSchema],
  ['operating-review-read.schema.json', reviewReadSchema],
  ['operating-review-receipt.schema.json', reviewReceiptSchema],
  ['operating-review.schema.json', reviewSchema],
]);

function jsonPointer(root, fragment) {
  if (!fragment || fragment === '#') return root;
  if (!fragment.startsWith('#/')) return null;
  return fragment
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, part) => value?.[part], root);
}

function resolveSchemaRef(reference) {
  const [path, pointer = ''] = reference.split('#');
  const filename = path.split('/').at(-1);
  const rootSchema = schemas.get(filename);
  if (!rootSchema) return null;
  return {
    schema: jsonPointer(rootSchema, pointer ? `#${pointer}` : '#'),
    rootSchema,
    base: filename,
  };
}

function fail(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function assertClosedSchema(value, schema, base, code, message) {
  let clone;
  try {
    clone = safeDataClone(value);
    const errors = validateJson(clone, schema, { base, resolveRef: resolveSchemaRef });
    if (errors.length > 0) fail(code, message);
  } catch (error) {
    if (error?.code === code) throw error;
    fail(code, message);
  }
  return clone;
}

function boundSubmissionHashPayload(value) {
  return {
    domain: OPERATE_REVIEW_BOUND_SUBMISSION_DOMAIN,
    expectedReadEventHead: value.expectedReadEventHead,
    choiceId: value.choiceId,
    choiceHash: value.choiceHash,
    submitArguments: value.submitArguments,
    note: value.note,
  };
}

export function computeOperatingReviewBoundSubmissionHashV1(value) {
  return jcsHash(boundSubmissionHashPayload(safeDataClone(value)));
}

export function assertOperatingReviewBoundSubmissionV1(value) {
  const candidate = assertClosedSchema(
    value,
    boundSubmissionSchema,
    'schemas/v2.0.0/operate-review-bound-submission.schema.json',
    'RESULT_CONTRACT_INVALID',
    'The bound Review submission does not satisfy its closed integrity contract.',
  );
  if (
    candidate.choiceHash !== jcsHash(candidate.submitArguments) ||
    candidate.boundSubmissionHash !== computeOperatingReviewBoundSubmissionHashV1(candidate)
  ) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'The bound Review submission does not satisfy its closed integrity contract.',
    );
  }
  return value;
}

function exactChoiceBinding(choice, receipt) {
  return (
    choice.choiceHash === jcsHash(choice.submitArguments) &&
    choice.submitArguments.reviewId === receipt.review.reviewId &&
    choice.submitArguments.cycleId === receipt.cycleId &&
    exactJson(choice.submitArguments.actor, receipt.actor) &&
    exactJson(choice.submitArguments.scope, receipt.scope)
  );
}

function exactReceiptSemantics(receipt) {
  const choices = receipt.dispositionChoices;
  const choiceIds = new Set(choices.map(({ choiceId }) => choiceId));
  const choiceHashes = new Set(choices.map(({ choiceHash }) => choiceHash));
  if (
    choiceIds.size !== choices.length ||
    choiceHashes.size !== choices.length ||
    choices.some((choice) => !exactChoiceBinding(choice, receipt)) ||
    receipt.review.reviewId.length === 0 ||
    receipt.review.cycleId !== receipt.cycleId ||
    receipt.review.ownerActorId !== receipt.actor.actorId ||
    receipt.review.state !== receipt.decision ||
    receipt.review.disposition !== receipt.decision ||
    !exactJson(receipt.review.workDispositions, receipt.appliedWorkDispositions) ||
    receipt.eventHead.sequence !== receipt.readEventHead.sequence + 1
  ) {
    return false;
  }

  const applied = choices.filter(
    (choice) =>
      choice.choiceId === receipt.appliedChoiceId &&
      choice.choiceHash === receipt.appliedChoiceHash,
  );
  if (applied.length !== 1) return false;
  const [choice] = applied;
  if (
    choice.submitArguments.disposition !== receipt.decision ||
    !exactJson(choice.submitArguments.workDispositions, receipt.appliedWorkDispositions) ||
    receipt.summary.decisionCount !== receipt.decisions.length ||
    receipt.summary.actionCount !== receipt.actions.length ||
    receipt.summary.findingCount !== receipt.findings.length ||
    receipt.summary.dissentCount !== receipt.dissent.length ||
    receipt.summary.gapCount !== receipt.gaps.length
  ) {
    return false;
  }

  if (receipt.boundSubmission === undefined) return true;
  try {
    assertOperatingReviewBoundSubmissionV1(receipt.boundSubmission);
  } catch {
    return false;
  }
  return (
    exactEventHead(receipt.boundSubmission.expectedReadEventHead, receipt.readEventHead) &&
    receipt.boundSubmission.choiceId === choice.choiceId &&
    receipt.boundSubmission.choiceHash === choice.choiceHash &&
    exactJson(receipt.boundSubmission.submitArguments, choice.submitArguments)
  );
}

export function assertOperatingReviewReceiptV2(value) {
  const candidate = assertClosedSchema(
    value,
    reviewReceiptSchema,
    'schemas/v2.0.0/operating-review-receipt.schema.json',
    'E_OPERATE_REVIEW_RECEIPT_INVALID',
    'The operating Review receipt does not satisfy its closed integrity contract.',
  );
  assertOperateReviewWorkspacePayloadSafeV1(candidate);
  if (!exactReceiptSemantics(candidate)) {
    fail(
      'E_OPERATE_REVIEW_RECEIPT_INVALID',
      'The operating Review receipt does not satisfy its closed integrity contract.',
    );
  }
  return value;
}
