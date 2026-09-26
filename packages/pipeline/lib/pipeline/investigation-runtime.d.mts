import type { InvestigationRequestV1 } from './investigation-contracts.mjs';
export interface InvestigationSummaryV1 {
  ok: true;
  operation: string;
  runId: string;
  mode: 'diagnose' | 'fix';
  generation: number;
  state: string;
  recordType: 'active' | 'receipt';
  requestDigest: string;
  baselineDigest: string;
  diagnosisDigest: string | null;
  reproduction: unknown;
  observations: unknown[];
  hypotheses: unknown[];
  experiments: unknown[];
  diagnosis: unknown;
  changedPaths: unknown[];
  verification: unknown;
  receiptHash: string | null;
  replayed: boolean;
}
interface InvestigationReadOnlyCommandHostV1 {
  readonly kind: 'investigation-command-host';
  readonly schemaVersion: '1.0.0';
  readonly capability: {
    readonly filesystem: 'read-only';
    readonly network: 'denied';
    readonly processEffects: 'denied';
    readonly scope: 'declared-inputs-only';
  };
}
interface InvestigationFixStartCapabilityV1 {
  readonly kind: 'investigation-fix-start-capability';
  readonly schemaVersion: '1.0.0';
  readonly requestDigest: string;
  readonly diagnosisReceiptHash: string;
  readonly targetBaselineDigest: string;
  readonly scopeDigest: string;
}
export interface InvestigationRuntimeOptions {
  projectRoot: string;
  featureRoot: string;
  repositoryRoots: Record<string, string>;
  clock?: () => string;
  commandHost?: InvestigationReadOnlyCommandHostV1;
  captureBaseline?: (options: unknown) => unknown;
}
export declare function startStoredInvestigation(
  options: InvestigationRuntimeOptions & {
    request: InvestigationRequestV1;
    runId?: string;
    fixCapability?: InvestigationFixStartCapabilityV1;
  },
): InvestigationSummaryV1;
export declare function advanceStoredInvestigation(
  options: InvestigationRuntimeOptions & { runId: string; event: Record<string, unknown> },
): InvestigationSummaryV1;
export declare function verifyStoredInvestigation(
  options: InvestigationRuntimeOptions & { runId: string },
): InvestigationSummaryV1;
export declare function finalizeStoredInvestigation(
  options: InvestigationRuntimeOptions & { runId: string },
): InvestigationSummaryV1;
export declare function readInvestigationReceipt(options: {
  projectRoot: string;
  featureRoot: string;
  receiptHash: string;
}): Record<string, unknown>;
