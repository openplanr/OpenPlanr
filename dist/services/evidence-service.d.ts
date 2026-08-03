/**
 * Evidence linking and validation for stakeholder reports.
 */
import type { ClaimValidationResult, EvidenceSummary, ReportEvidenceItem, StakeholderReportType } from '../models/types.js';
export declare function countEvidenceAnchors(markdown: string): number;
export interface ValidateClaimsOptions {
    /** Included for forward-compatible per-report tuning; reserved for future use. */
    reportType?: StakeholderReportType;
}
export declare function validateClaimsHaveAnchors(markdown: string, minAnchors: number, options?: ValidateClaimsOptions): ClaimValidationResult[];
export declare function validateRemoteEvidence(items: ReportEvidenceItem[]): Promise<{
    inaccessible: ReportEvidenceItem[];
    repoOk: boolean;
    repoMessage: string;
}>;
export declare function summarizeEvidenceItem(item: ReportEvidenceItem): EvidenceSummary;
//# sourceMappingURL=evidence-service.d.ts.map