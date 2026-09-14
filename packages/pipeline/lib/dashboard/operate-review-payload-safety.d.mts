export type OperateReviewUnsafeTextReasonV1 = 'private-path' | 'secret';

export function classifyOperateReviewUnsafeTextV1(
  value: string,
): OperateReviewUnsafeTextReasonV1 | null;

export function assertOperateReviewWorkspacePayloadSafeV1<T>(payload: T): T;
