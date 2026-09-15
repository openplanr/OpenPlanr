import type { OperateAllowedActionV2, OperatingCheckpointV2, OperatingEventV2, OperatingRuntimeStateV2 } from '@openplanr/protocol';
import type { OperateExperienceLivePatchV1, OperateExperiencePreviewV1, OperateExperienceViewV1, OperatingDeliveryRouteV1 } from '@openplanr/protocol';

export interface OperateExperienceActorV1 { actorId: string; accessLevel: 'public' | 'internal' | 'confidential' | 'restricted' }
export interface OperateExperienceScopeV1 { scopeId: string; domainId: string; domainVersion: string }

export function createOperateExperienceReplayCheckpointV2(
  state: OperatingRuntimeStateV2,
  options?: { createdAt?: string; recoveryVersion?: string },
): OperatingCheckpointV2;

export function buildOperateExperienceViewV2(state: OperatingRuntimeStateV2, options: {
  scope: OperateExperienceScopeV1;
  actor: OperateExperienceActorV1;
  deliveryRoutes: readonly OperatingDeliveryRouteV1[];
  allowedActions?: readonly { subjectId: string; action: OperateAllowedActionV2 }[];
  events: readonly OperatingEventV2[];
  checkpoint?: OperatingCheckpointV2 | null;
  checkpointState?: OperatingRuntimeStateV2 | null;
  generatedAt?: string;
  status?: OperateExperienceViewV1['status'];
}): OperateExperienceViewV1;
export function rankOperateAttentionV2(view: OperateExperienceViewV1): OperateExperienceViewV1['attention'];
export function createOperateExperiencePreviewV1(state: OperatingRuntimeStateV2, options: {
  scope: OperateExperienceScopeV1; view: OperateExperienceViewV1; actionDigest: string;
  authority: OperateExperiencePreviewV1['authority']; consequence?: string;
  reasonCodes?: readonly string[]; issuedAt?: string; expiresAt: string;
}): OperateExperiencePreviewV1;
export function buildOperateExperienceLivePatchV2(previous: OperateExperienceViewV1, next: OperateExperienceViewV1, options?: { createdAt?: string }): OperateExperienceLivePatchV1;
export function applyOperateExperienceLivePatchV2(previous: OperateExperienceViewV1, patch: OperateExperienceLivePatchV1, next: OperateExperienceViewV1): OperateExperienceViewV1;
