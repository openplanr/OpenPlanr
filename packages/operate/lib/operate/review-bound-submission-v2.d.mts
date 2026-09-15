import type {
  OperateExperienceEventHeadV1,
  OperatingReviewReadV2,
} from '@openplanr/protocol';

export type OperateReviewBoundSubmissionV1 = Readonly<{
  kind: 'operate-review-bound-submission';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  expectedReadEventHead: OperateExperienceEventHeadV1;
  choiceId: string;
  choiceHash: string;
  submitArguments: OperatingReviewReadV2['dispositionChoices'][number]['submitArguments'];
  note: string | null;
  boundSubmissionHash: string;
}>;

export const OPERATE_REVIEW_BOUND_SUBMISSION_DOMAIN: string;

export function computeOperatingReviewBoundSubmissionHashV1(
  value: Omit<OperateReviewBoundSubmissionV1, 'boundSubmissionHash'> | OperateReviewBoundSubmissionV1,
): string;

export function assertOperatingReviewBoundSubmissionV1<T>(value: T): T;

export function buildOperatingReviewBoundSubmissionV1(input: Readonly<{
  expectedReadEventHead: OperateExperienceEventHeadV1;
  choice: OperatingReviewReadV2['dispositionChoices'][number];
  note?: string | null;
}>): OperateReviewBoundSubmissionV1;
