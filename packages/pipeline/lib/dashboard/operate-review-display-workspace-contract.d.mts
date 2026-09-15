import type { JsonValue, ProtocolValidationError } from '../protocol/index.js';
import type { OperateReviewWorkspacePayloadV1 } from './operate-review-workspace-projection-v2.mjs';

export const OPERATE_REVIEW_DISPLAY_WORKSPACE_DOMAIN:
  'openplanr:operate-review-display-workspace:1.0.0';

export type OperateReviewDisplayWorkspaceIntegrityV1 = Readonly<{
  algorithm: 'sha-256-jcs';
  domain: typeof OPERATE_REVIEW_DISPLAY_WORKSPACE_DOMAIN;
  sourceArtifactKind: OperateReviewWorkspacePayloadV1['sourceArtifactKind'];
  sourceViewHash: string;
  sourceArtifactHash: string;
  contentHash: string;
}>;

export type OperateReviewDisplayWorkspaceV1 = Readonly<{
  kind: 'operate-review-display-workspace';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  payload: OperateReviewWorkspacePayloadV1;
  integrity: OperateReviewDisplayWorkspaceIntegrityV1;
}>;

export type OperateReviewDisplayWorkspaceExpectedBindingV1 = Readonly<{
  actorId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  cycleId: string;
  reviewId: string;
  sourceArtifactKind: OperateReviewWorkspacePayloadV1['sourceArtifactKind'];
  sourceArtifactHash: string;
  sourceEventHead: OperateReviewWorkspacePayloadV1['sourceEventHead'];
  sourceReadEventHead: OperateReviewWorkspacePayloadV1['sourceReadEventHead'];
  sourceViewHash: string;
}>;

export function validateOperateReviewDisplayWorkspaceV1(
  value: unknown,
  expected?: OperateReviewDisplayWorkspaceExpectedBindingV1,
): ProtocolValidationError[];

export function assertOperateReviewDisplayWorkspaceV1<T>(
  value: T,
  expected?: OperateReviewDisplayWorkspaceExpectedBindingV1,
): T;

export function issueOperateReviewDisplayWorkspaceV1(
  payload: OperateReviewWorkspacePayloadV1,
): OperateReviewDisplayWorkspaceV1;

export const OPERATE_REVIEW_DISPLAY_WORKSPACE_SCHEMA_V1: Readonly<
  Record<string, JsonValue>
>;

