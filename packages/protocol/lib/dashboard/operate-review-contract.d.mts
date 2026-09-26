import type {
  OperateReviewBoundSubmissionV1,
  OperatingReviewReceiptV2,
} from '../protocol/index.js';

export type {
  OperateReviewDisplayWorkspaceExpectedBindingV1,
  OperateReviewDisplayWorkspaceIntegrityV1,
  OperateReviewDisplayWorkspaceV1,
} from './operate-review-display-workspace-contract.mjs';
export { assertOperateReviewDisplayWorkspaceV1 } from './operate-review-display-workspace-contract.mjs';

export type { OperateReviewBoundSubmissionV1, OperatingReviewReceiptV2 };

export const OPERATE_REVIEW_BOUND_SUBMISSION_DOMAIN: 'openplanr:operate-review-bound-submission:project-write:operating-review@2.0.0#/$defs/workDisposition:1.0.0';

export function computeOperatingReviewBoundSubmissionHashV1(
  value:
    | Omit<OperateReviewBoundSubmissionV1, 'boundSubmissionHash'>
    | OperateReviewBoundSubmissionV1,
): string;

export function assertOperatingReviewBoundSubmissionV1(
  value: unknown,
): OperateReviewBoundSubmissionV1;

export function assertOperatingReviewReceiptV2(value: unknown): OperatingReviewReceiptV2;
