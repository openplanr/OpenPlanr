import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import {
  assertOperateReviewDisplayWorkspaceV1,
  assertOperatingReviewBoundSubmissionV1,
  assertOperatingReviewReceiptV2,
  type OperateReviewDisplayWorkspaceV1,
  type OperatingReviewReceiptV2,
} from '@openplanr/protocol/dashboard/operate-review-contract.mjs';
import { freezeDashboardWire } from '../../../lib/api/product-state.js';
import type {
  DashboardEventHead,
  DashboardQueryIdentity,
} from '../../../lib/binding/query-identity.js';
import {
  createGovernedCommandLifecycle,
  type GovernedCommandPreview,
} from '../governed-command-lifecycle.js';

type JsonRecord = Record<string, unknown>;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const REVIEW_FAILURES = new Set([
  'CONCURRENT_MODIFICATION',
  'CAPABILITY_DENIED',
  'OPERATION_UNCERTAIN',
]);

export type ReviewConfirmationInput = Readonly<{ note: string | null }>;
export type ReviewConfirmation =
  | Readonly<{
      ok: true;
      receipt: OperatingReviewReceiptV2 & {
        boundSubmission: NonNullable<OperatingReviewReceiptV2['boundSubmission']>;
      };
      workspace: OperateReviewDisplayWorkspaceV1;
      eventHead: DashboardEventHead;
    }>
  | Readonly<{
      ok: false;
      reasonCode: 'CONCURRENT_MODIFICATION' | 'CAPABILITY_DENIED' | 'OPERATION_UNCERTAIN';
      allowedActionDigests: readonly string[];
    }>;

export type ReviewCommandPreview = GovernedCommandPreview<
  ReviewConfirmationInput,
  ReviewConfirmation
>;
export type ReviewActions = Readonly<{
  bind(identity: DashboardQueryIdentity): void;
  preview(
    locator: Readonly<{ subjectId: string; actionDigest: string }>,
  ): Promise<ReviewCommandPreview>;
  reconcile(identity: DashboardQueryIdentity): void;
  cancel(): void;
  dispose(): void;
}>;

function fail(code = 'OPERATE_RESPONSE_INVALID'): never {
  const error = new Error('The governed Review response was refused.');
  error.name = code;
  throw error;
}

function record(value: unknown): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) fail();
}

function exactHead(value: unknown): DashboardEventHead {
  const head = record(value);
  exactKeys(head, ['sequence', 'hash']);
  if (!Number.isSafeInteger(head.sequence) || (head.sequence as number) < 0) fail();
  const hash = head.hash;
  if (hash !== null && (typeof hash !== 'string' || !SHA256.test(hash))) fail();
  if (((head.sequence as number) === 0) !== (hash === null)) fail();
  return Object.freeze({ sequence: head.sequence as number, hash: hash as string | null });
}

function sameHead(left: DashboardEventHead, right: DashboardEventHead): boolean {
  return left.sequence === right.sequence && left.hash === right.hash;
}

function exactNote(input: ReviewConfirmationInput | undefined): string | null {
  if (!input || (input.note !== null && typeof input.note !== 'string')) {
    fail('OPERATE_COMMAND_INVALID');
  }
  if (input.note === null) return null;
  if (
    input.note.length === 0 ||
    input.note.length > 2_048 ||
    !/^\S(?:[\s\S]*\S)?$/u.test(input.note)
  ) {
    fail('OPERATE_COMMAND_INVALID');
  }
  return input.note;
}

function exactFailure(value: JsonRecord, reviewId: string): ReviewConfirmation {
  exactKeys(value, ['ok', 'operation', 'error', 'allowedActions']);
  const error = record(value.error);
  exactKeys(error, ['code', 'message', 'retryable', 'context']);
  const context = record(error.context);
  exactKeys(context, []);
  if (
    value.ok !== false ||
    value.operation !== 'operate.review.submit' ||
    typeof error.code !== 'string' ||
    !REVIEW_FAILURES.has(error.code) ||
    typeof error.message !== 'string' ||
    error.retryable !== false ||
    !Array.isArray(value.allowedActions) ||
    value.allowedActions.length > 16
  ) {
    fail();
  }
  const allowedActionDigests = value.allowedActions.map((candidate) => {
    const entry = record(candidate);
    exactKeys(entry, ['subjectId', 'action']);
    const action = record(entry.action);
    if (
      entry.subjectId !== reviewId ||
      action.tool !== 'operate.review.submit' ||
      action.effect !== 'project-write' ||
      typeof action.label !== 'string' ||
      action.arguments === null ||
      typeof action.arguments !== 'object' ||
      Array.isArray(action.arguments)
    ) {
      fail();
    }
    return sha256Jcs(action);
  });
  return Object.freeze({
    ok: false,
    reasonCode: error.code as Exclude<ReviewConfirmation, { ok: true }>['reasonCode'],
    allowedActionDigests: Object.freeze(allowedActionDigests),
  }) as ReviewConfirmation;
}

function exactSuccess(
  value: JsonRecord,
  identity: DashboardQueryIdentity,
  previousHead: DashboardEventHead,
  preview: ReviewCommandPreview['preview'],
  note: string | null,
): ReviewConfirmation {
  exactKeys(value, ['ok', 'operation', 'data', 'allowedActions', 'eventHead']);
  if (
    value.ok !== true ||
    value.operation !== 'operate.review.submit' ||
    !Array.isArray(value.allowedActions) ||
    value.allowedActions.length !== 0
  ) {
    fail();
  }
  const data = record(value.data);
  exactKeys(data, ['receipt', 'workspace']);
  const receipt = freezeDashboardWire(data.receipt) as OperatingReviewReceiptV2;
  assertOperatingReviewReceiptV2(receipt);
  if (receipt.boundSubmission === undefined) fail();
  const bound = assertOperatingReviewBoundSubmissionV1(receipt.boundSubmission) as NonNullable<
    OperatingReviewReceiptV2['boundSubmission']
  >;
  const workspace = freezeDashboardWire(data.workspace) as OperateReviewDisplayWorkspaceV1;
  assertOperateReviewDisplayWorkspaceV1(workspace);
  const eventHead = exactHead(value.eventHead);
  const terminal = workspace.payload.data.terminalDisposition;
  if (
    identity.cycleId === null ||
    identity.subjectId === null ||
    preview.allowedAction.tool !== 'operate.review.submit' ||
    preview.allowedAction.effect !== 'project-write' ||
    receipt.cycleId !== identity.cycleId ||
    receipt.review.reviewId !== identity.subjectId ||
    receipt.actor.actorId !== identity.actorId ||
    receipt.scope.scopeId !== identity.scopeId ||
    receipt.scope.domainId !== identity.domainId ||
    receipt.scope.domainVersion !== identity.domainVersion ||
    !sameHead(receipt.readEventHead, previousHead) ||
    !sameHead(receipt.eventHead, eventHead) ||
    receipt.eventHead.sequence <= previousHead.sequence ||
    !sameHead(bound.expectedReadEventHead, previousHead) ||
    bound.note !== note ||
    bound.choiceId !== receipt.appliedChoiceId ||
    bound.choiceHash !== receipt.appliedChoiceHash ||
    bound.choiceHash !== sha256Jcs(preview.allowedAction.arguments) ||
    sha256Jcs(bound.submitArguments) !== sha256Jcs(preview.allowedAction.arguments) ||
    workspace.payload.actorId !== identity.actorId ||
    workspace.payload.cycleId !== identity.cycleId ||
    workspace.payload.reviewId !== identity.subjectId ||
    workspace.payload.sourceArtifactKind !== 'operating-review-receipt' ||
    workspace.payload.sourceArtifactHash !== sha256Jcs(receipt) ||
    workspace.payload.status !== 'terminal' ||
    workspace.payload.mutationEnabled ||
    workspace.payload.data.choices.length !== 0 ||
    terminal === null ||
    terminal.receiptId !== receipt.receiptId ||
    terminal.appliedChoiceId !== receipt.appliedChoiceId ||
    terminal.appliedChoiceHash !== receipt.appliedChoiceHash ||
    !sameHead(terminal.readEventHead, receipt.readEventHead) ||
    !sameHead(terminal.eventHead, receipt.eventHead)
  ) {
    fail();
  }
  return Object.freeze({
    ok: true,
    receipt: receipt as OperatingReviewReceiptV2 & {
      boundSubmission: NonNullable<OperatingReviewReceiptV2['boundSubmission']>;
    },
    workspace,
    eventHead,
  }) as ReviewConfirmation;
}

/** Browser adapter for the governed Review mutation path. */
export function createReviewActions(
  options: Readonly<{
    origin: string;
    fetcher?: typeof fetch;
  }>,
): ReviewActions {
  return createGovernedCommandLifecycle<ReviewConfirmationInput, ReviewConfirmation>({
    ...options,
    routeKinds: ['operate.review'],
    routeErrorCode: 'OPERATE_REVIEW_ROUTE_REQUIRED',
    includeOriginHeader: true,
    confirmation: {
      additionalBody(_preview, input) {
        return { note: exactNote(input) };
      },
      parse({ value, preview, identity, previousHead, input }) {
        const candidate = record(value);
        if (candidate.ok === false) return exactFailure(candidate, identity.subjectId ?? '');
        return exactSuccess(candidate, identity, previousHead, preview, exactNote(input));
      },
    },
  });
}
