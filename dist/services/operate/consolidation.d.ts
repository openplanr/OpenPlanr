import { type OperatingConfig, type OperatingDataGap, type OperatingDecision, type OperatingEvidence, type OperatingFinding, type OperatingRoleResult } from './types.js';
export interface ConsolidationResult {
    findings: OperatingFinding[];
    decisions: OperatingDecision[];
    gaps: OperatingDataGap[];
    parked: OperatingFinding[];
    criticalOverflow: OperatingFinding[];
}
export declare function semanticallyEquivalentFindings(left: Pick<OperatingFinding, 'category' | 'title' | 'problem' | 'proposal' | 'sensitivity'>, right: Pick<OperatingFinding, 'category' | 'title' | 'problem' | 'proposal' | 'sensitivity'>): boolean;
export declare function consolidateOperatingResults(input: {
    cycleId: string;
    results: OperatingRoleResult[];
    evidence: OperatingEvidence;
    config: OperatingConfig;
    now?: string;
    existingGapCount?: number;
}): Promise<ConsolidationResult>;
//# sourceMappingURL=consolidation.d.ts.map