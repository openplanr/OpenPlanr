import type {
  PlanningFileLinkContext,
  PlanningFileLinkErrorCode,
} from './planning-file-link-contracts.mjs';

export const PLANNING_DIAGNOSTICS_MAX_BYTES: number;
export const PLANNING_DIAGNOSTICS_MAX_COUNT: 500;
export const PLANNING_DIAGNOSTIC_REASONS: readonly [
  'missing-reference',
  'ambiguous-reference',
  'invalid-date',
  'missing-date',
  'closed-before-start',
  'end-before-start',
  'dependency-cycle',
  'containment-cycle',
  'duplicate-identity',
];
export type PlanningReadDiagnostic = Readonly<{
  nodeId: string;
  sourcePath: string;
  field: string;
  reason: (typeof PLANNING_DIAGNOSTIC_REASONS)[number];
  classification: 'source-data';
}>;
export type PlanningDiagnosticsContext = Pick<PlanningFileLinkContext, 'binding' | 'cursor'>;
export type PlanningDiagnosticsEnvelope = Readonly<{
  kind: 'planning-diagnostics';
  schemaVersion: '1.0.0';
  binding: PlanningDiagnosticsContext['binding'];
  cursor: PlanningDiagnosticsContext['cursor'];
  sourceViewHash: string;
  state: 'available' | 'unavailable' | 'error';
  reason: string | null;
  errorCode: PlanningFileLinkErrorCode | null;
  diagnostics: readonly PlanningReadDiagnostic[];
  totalCount: number | null;
  truncated: boolean;
}>;
/** expected must come from a validated current Planning graph read. */
export function assertPlanningDiagnosticsEnvelope(
  value: unknown,
  expected: PlanningDiagnosticsContext,
): PlanningDiagnosticsEnvelope;
