import type { InvestigationScope } from './investigation-contracts.mjs';
export interface InvestigationBaselineV1 { kind: 'investigation-baseline'; schemaVersion: '1.0.0'; scope: InvestigationScope; entries: Array<Record<string, unknown>>; digest: string }
export declare function captureInvestigationBaseline(options: { repositoryRoots: Record<string, string>; scope: InvestigationScope }): InvestigationBaselineV1;
export declare function diffInvestigationBaselines(before: InvestigationBaselineV1, after: InvestigationBaselineV1): Array<{ repositoryKey: string; path: string; changeType: 'add' | 'delete' | 'replace' | 'modify' }>;
export declare function scopeContains(scope: InvestigationScope, target: { repositoryKey: string; path: string }): boolean;
