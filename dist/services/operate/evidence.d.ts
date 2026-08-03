/**
 * Surviving evidence projection helpers.
 *
 * SPEC-004 retired the pre-dispatch repository collector and its evidence-index
 * and mission-packet machinery. Evidence is now created only from citations
 * returned by operating mandates and resolved fail-closed by
 * citation-resolution.ts.
 */
import type { OperatingEvidence, OperatingEvidenceItem, OperatingSensitivity } from './types.js';
export declare function evidenceFingerprintItems(items: readonly OperatingEvidenceItem[]): Array<{
    id: string;
    digest: `sha256:${string}`;
    sensitivity: OperatingSensitivity;
}>;
export declare function evidenceProjectionSources(evidence: OperatingEvidence): Array<{
    id: string;
    freshness: OperatingEvidenceItem['freshness'];
    status: string;
    itemCount: number;
}>;
//# sourceMappingURL=evidence.d.ts.map