import type {
  OperateAuditDisplayBindingV1,
  OperateExperienceAuditDisplaySurfaceV1,
} from './operate-experience-audit-display-contract.mjs';
import type {
  OperateActionDisplayWorkspaceV1,
  OperateCycleDisplayWorkspaceV1,
  OperateDisplayBindingV1,
  OperateExecutiveBoardDisplaySurfaceV1,
  OperateExperienceDisplaySurfaceV1,
  OperateRecoveryDisplaySurfaceV1,
} from './operate-experience-display-contract.mjs';
import type { OperateReviewDisplayWorkspaceV1 } from './operate-review-display-workspace-contract.mjs';
import type {
  OperateReviewWorkspacePayloadV1,
  OperateReviewWorkspaceSourceV1,
} from './operate-review-workspace-projection-v2.mjs';

export const OPERATE_EXPERIENCE_MAX_BYTES: 4194304;
export const OPERATE_EXPERIENCE_RELATIVE_PATH: 'operate/projections/experience-view.json';

export type OperateExperienceEventHead = Readonly<{
  sequence: number;
  hash: string | null;
}>;

export type OperateExperienceBinding = Readonly<{
  actorId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
}>;

export type OperateCycleWorkspaceSelectionOptions = Readonly<{
  binding?:
    | (OperateExperienceBinding &
        Readonly<{
          cycleId?: string | null;
          actionId?: string | null;
          subjectId: string | null;
          generatedAt: string;
          eventHead: OperateExperienceEventHead;
          viewHash: string;
        }>)
    | null;
  subjectId?: string | null;
}>;

export type OperateActionWorkspaceSelectionOptions = OperateCycleWorkspaceSelectionOptions &
  Readonly<{
    commandsAvailable?: boolean;
  }>;

export type OperateReviewWorkspaceSelectionOptions = Readonly<{
  subjectId: string;
  binding: OperateExperienceBinding &
    Readonly<{
      cycleId: string;
      reviewId: string;
      generatedAt: string;
      sourceArtifactKind: OperateReviewWorkspaceSourceV1['kind'];
      sourceArtifactHash: string;
      sourceEventHead: OperateExperienceEventHead;
      sourceReadEventHead: OperateExperienceEventHead;
      sourceViewHash: string;
    }>;
}>;

export type OperateExperienceSurfaceSelectionOptions = Readonly<{
  surface?:
    | 'today'
    | 'inbox'
    | 'cycles'
    | 'cycle'
    | 'actions'
    | 'action'
    | 'evidence'
    | 'outcomes'
    | 'outcome'
    | 'history'
    | 'search'
    | 'export';
  binding?: OperateExperienceBinding | null;
  subjectId?: string | null;
  cycleId?: string | null;
  query?: string;
  format?: 'json' | 'html';
  projectId?: string | null;
  generation?: number | null;
}>;

export type OperateExperienceSearchDestination = Readonly<{
  route: string;
  surface:
    | 'today'
    | 'cycles'
    | 'cycle'
    | 'evidence'
    | 'outcomes'
    | 'outcome'
    | 'action'
    | 'history';
  subjectId: string | null;
}>;

export function assertOperateExperienceTransportView<T>(view: T): T;

export function buildOperateExperienceTransportView<T>(view: T): T;

export function readOperateExperienceProjection(
  planrDir: string,
  options?: Readonly<{
    maxBytes?: number;
    relativePath?: string;
  }>,
): unknown;

export function resolveOperateExperienceSearchDestination(
  view: unknown,
  value: unknown,
): OperateExperienceSearchDestination | null;

export function selectOperateExperienceSurface(
  view: unknown,
  options?: OperateExperienceSurfaceSelectionOptions,
): unknown;

export function selectOperateExperienceAuditDisplaySurface(
  view: unknown,
  options: Readonly<{
    surface?: 'evidence' | 'outcomes' | 'outcome' | 'history' | 'search' | 'export';
    binding?: OperateAuditDisplayBindingV1 | null;
    subjectId?: string | null;
    cycleId?: string | null;
    query?: string | null;
    format?: 'json' | 'html' | null;
  }>,
): OperateExperienceAuditDisplaySurfaceV1 | unknown;

export function selectOperateExperienceDisplaySurface(
  view: unknown,
  options: Readonly<{
    surface?: 'today' | 'inbox' | 'cycles' | 'cycle' | 'actions';
    binding?: OperateDisplayBindingV1 | null;
    subjectId?: string | null;
    cycleId?: string | null;
  }>,
): OperateExperienceDisplaySurfaceV1 | unknown;

export function selectOperateInboxItemDisplaySurface(
  view: unknown,
  options: Readonly<{
    binding?: OperateDisplayBindingV1 | null;
    subjectId?: string | null;
  }>,
): OperateExperienceDisplaySurfaceV1 | unknown;

export function selectOperateCycleWorkspace(
  view: unknown,
  cycleRead: unknown,
  options?: OperateCycleWorkspaceSelectionOptions,
): unknown;

export function selectOperateCycleDisplayWorkspace(
  view: unknown,
  cycleRead: unknown,
  options?: OperateCycleWorkspaceSelectionOptions,
): OperateCycleDisplayWorkspaceV1 | unknown;

export function selectOperateReviewWorkspace(
  view: unknown,
  reviewSource: OperateReviewWorkspaceSourceV1,
  options: OperateReviewWorkspaceSelectionOptions,
): OperateReviewWorkspacePayloadV1 | unknown;

export function selectOperateReviewDisplayWorkspace(
  view: unknown,
  reviewSource: OperateReviewWorkspaceSourceV1,
  options: OperateReviewWorkspaceSelectionOptions,
): OperateReviewDisplayWorkspaceV1 | unknown;

export function selectOperateExecutiveBoardDisplay(
  view: unknown,
  options?: OperateCycleWorkspaceSelectionOptions,
): OperateExecutiveBoardDisplaySurfaceV1 | unknown;

export function selectOperateActionWorkspace(
  view: unknown,
  options?: OperateActionWorkspaceSelectionOptions,
): unknown;

export function selectOperateActionDisplayWorkspace(
  view: unknown,
  options?: OperateActionWorkspaceSelectionOptions,
): OperateActionDisplayWorkspaceV1 | unknown;

export function selectOperateRecoveryDisplay(
  view: unknown,
  recoveryRead: unknown,
  options?: Readonly<{ binding?: OperateExperienceBinding | null }>,
): OperateRecoveryDisplaySurfaceV1 | unknown;

export function encodeOperateExperienceCheckpoint(
  value: Readonly<{
    eventHead: OperateExperienceEventHead;
    viewHash: string;
  }>,
): string;

export function decodeOperateExperienceCheckpoint(value: unknown): Readonly<{
  eventHead: OperateExperienceEventHead;
  viewHash: string;
}> | null;
