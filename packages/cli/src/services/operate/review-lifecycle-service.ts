import {
  type OperateReviewBoundSubmissionV1,
  readCommittedOperatingReviewReceiptV2,
  readOperatingReviewV2,
  submitBoundOperatingReviewV2,
  submitOperatingReviewV2,
} from 'planr-pipeline/operate/runtime-v2';
import { sha256Jcs } from 'planr-pipeline/protocol';
import type { JsonRecord } from './composition.js';
import {
  retryReplaySafeGenerationConflict,
  withOperateMutationLane,
} from './replay-safe-retry-service.js';
import type { OperateStoredRuntime } from './store.js';

const REVIEW_SUBMIT_CAPABILITY = Object.freeze({
  id: 'operate-review-submit',
  version: '2.0.0',
});

type ReviewActor = Readonly<{
  actorId: string;
  kind: 'human';
  runtime: string;
}>;

export type OperateReviewReadRequest = Readonly<{
  reviewId: string;
  cycleId: string;
  actor: ReviewActor;
  scope: { scopeId: string; domainId: string; domainVersion: string };
}>;

export type OperateReviewSubmitRequest = OperateReviewReadRequest &
  Readonly<{
    disposition: 'approved' | 'changes_requested' | 'rejected' | 'cancelled';
    workDispositions: JsonRecord[];
  }>;

type ReplaySafeIssue = Readonly<{
  id(prefix: string): string;
  stableId(prefix: string, value: string): string;
  timestamp(): string;
}>;

type Commit = (
  runtime: OperateStoredRuntime,
  nextState: JsonRecord,
  events: JsonRecord[],
) => Promise<OperateStoredRuntime>;

/** Read one exact owner-bound Review without projecting or re-synthesizing choices. */
export function readOperateReview(
  runtime: OperateStoredRuntime,
  request: OperateReviewReadRequest,
): unknown {
  return readOperatingReviewV2(request as never, {
    initialState: runtime.state as never,
    capabilities: ['operate.review.get'],
    readAt: new Date().toISOString(),
  });
}

/** Read one immutable terminal receipt through the same exact owner custody. */
export function readCommittedOperateReviewReceipt(
  runtime: OperateStoredRuntime,
  request: OperateReviewReadRequest,
): unknown {
  return readCommittedOperatingReviewReceiptV2(request as never, {
    initialState: runtime.state as never,
    capabilities: ['operate.review.get'],
  });
}

/** Own the replay-safe Review mutation lane and exact protocol submission transaction. */
export async function submitOperateReview(input: {
  root: string;
  request: OperateReviewSubmitRequest;
  issueFactory: () => () => ReplaySafeIssue;
  requiredRuntime: () => Promise<OperateStoredRuntime>;
  commit: Commit;
}): Promise<unknown> {
  const nextIssue = input.issueFactory();
  return await retryReplaySafeGenerationConflict(
    `review-submit:${sha256Jcs(input.request as never)}`,
    () =>
      withOperateMutationLane(input.root, async () => {
        const runtime = await input.requiredRuntime();
        const issue = nextIssue();
        const submitted = submitOperatingReviewV2(
          input.request as never,
          {
            eventId: issue.id('evt'),
            timestamp: issue.timestamp(),
            correlationId: issue.id('corr'),
          },
          {
            initialState: runtime.state as never,
            capabilities: [REVIEW_SUBMIT_CAPABILITY] as never,
          },
        );
        if (!submitted.replayed) {
          await input.commit(
            runtime,
            submitted.state as unknown as JsonRecord,
            [...submitted.events] as unknown as JsonRecord[],
          );
        }
        return submitted.response;
      }),
  );
}

/** Own the replay-safe lane for one head- and choice-bound Review submission. */
export async function submitBoundOperateReview(input: {
  root: string;
  submission: OperateReviewBoundSubmissionV1;
  issueFactory: () => () => ReplaySafeIssue;
  requiredRuntime: () => Promise<OperateStoredRuntime>;
  commit: Commit;
}): Promise<unknown> {
  const nextIssue = input.issueFactory();
  return await retryReplaySafeGenerationConflict(
    `review-submit-bound:${input.submission.boundSubmissionHash}`,
    () =>
      withOperateMutationLane(input.root, async () => {
        const runtime = await input.requiredRuntime();
        const issue = nextIssue();
        const submitted = submitBoundOperatingReviewV2(
          input.submission,
          {
            eventId: issue.id('evt'),
            timestamp: issue.timestamp(),
            correlationId: issue.id('corr'),
          },
          {
            initialState: runtime.state as never,
            capabilities: [REVIEW_SUBMIT_CAPABILITY],
          },
        );
        if (!submitted.replayed) {
          await input.commit(
            runtime,
            submitted.state as unknown as JsonRecord,
            [...submitted.events] as unknown as JsonRecord[],
          );
        }
        return submitted.response;
      }),
  );
}
