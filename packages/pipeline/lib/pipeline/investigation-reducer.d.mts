import type { InvestigationRequestV1 } from './investigation-contracts.mjs';
import type { InvestigationBaselineV1 } from './investigation-identity.mjs';
export interface InvestigationRecordV1 extends Record<string, unknown> {
  kind: 'investigation-record' | 'investigation-receipt';
  recordType: 'active' | 'receipt';
  runId: string;
  mode: 'diagnose' | 'fix';
  generation: number;
  state: string;
  receiptHash: string | null;
}
export declare function createInvestigationRecord(options: {
  runId: string;
  request: InvestigationRequestV1;
  baseline: InvestigationBaselineV1;
  reproduction?: unknown;
  diagnosisReceipt?: InvestigationRecordV1 | null;
  now: string;
}): InvestigationRecordV1;
export declare function assertInvestigationRecord<T extends InvestigationRecordV1>(value: T): T;
export declare function reduceInvestigationRecord(
  current: InvestigationRecordV1,
  event: Record<string, unknown>,
  runtime: { now: string; inputDigest: string },
): InvestigationRecordV1;
export declare function finalizeInvestigationRecord(
  current: InvestigationRecordV1,
  runtime: { baseline: InvestigationBaselineV1; now: string },
): InvestigationRecordV1;
