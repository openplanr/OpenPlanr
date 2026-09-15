import type {
  OperatingEventHeadV2,
  OperatingRuntimeStateV2,
  OperatingTraceEdgeV2,
  OperatingTraceLocatorV2,
  OperatingTraceMatrixV2,
  OperatingTraceNodeV2,
} from 'planr-pipeline/protocol';

export type {
  OperatingTraceEdgeV2,
  OperatingTraceEndpointV2,
  OperatingTraceLocatorV2,
  OperatingTraceMatrixV2,
  OperatingTraceNodeKindV2,
  OperatingTraceNodeV2,
  OperatingTraceOmissionV2,
  OperatingTraceProofStateV2,
  OperatingTraceProofV2,
  OperatingTraceRelationV2,
} from 'planr-pipeline/protocol';

export function buildOperatingTraceMatrixV2(
  state: OperatingRuntimeStateV2,
  options: {
    cycleId: string;
    planId?: string;
    accessLevel?: 'public' | 'internal' | 'confidential' | 'restricted';
    eventHead?: OperatingEventHeadV2;
  },
): OperatingTraceMatrixV2;

export function deriveOperatingOmittedRoleAbsenceIdV2(
  planId: string,
  roleId: string,
  roleVersion: string,
): string;

export function assertOperatingTraceMatrixV2(value: unknown): OperatingTraceMatrixV2;

export function locateOperatingTraceNodeV2(
  matrix: OperatingTraceMatrixV2,
  locator: Pick<OperatingTraceLocatorV2, 'kind' | 'id'>,
  options?: { maxResults?: number },
): Readonly<{
  node: OperatingTraceNodeV2;
  inbound: readonly OperatingTraceEdgeV2[];
  outbound: readonly OperatingTraceEdgeV2[];
}> | null;
