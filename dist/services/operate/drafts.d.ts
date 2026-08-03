export type OperatingDraftKind = 'quick-task' | 'spec' | 'epic' | 'decision' | 'agent-artifact';
export interface OperatingMaterializedDraft {
    kind: 'operating-materialized-draft';
    schemaVersion: '1.0.0';
    protocolVersion: '1.4.0';
    draftId: string;
    cycleId: string;
    actionKey: string;
    artifactKind: OperatingDraftKind;
    path: string;
    status: 'proposed' | 'approved' | 'discarded';
    artifactDigest: `sha256:${string}`;
    causality: {
        findingIds: string[];
        citationDigests: `sha256:${string}`[];
    };
    reversible: true;
    userEdited?: boolean;
}
interface StoredDraft {
    version: '1.0.0';
    candidateDigest: `sha256:${string}`;
    transactionId: string;
    draft: OperatingMaterializedDraft;
    createdAt: string;
    updatedAt: string;
}
export declare function listOperatingDrafts(projectRoot: string): Promise<StoredDraft[]>;
export declare function showOperatingDraft(projectRoot: string, draftId: string): Promise<StoredDraft>;
export declare function materializeOperatingDrafts(input: {
    projectRoot: string;
    cycleId: string;
}): Promise<{
    created: OperatingMaterializedDraft[];
    existing: OperatingMaterializedDraft[];
    rejected: Array<{
        actionKey: string;
        reason: string;
    }>;
}>;
export declare function approveOperatingDraft(projectRoot: string, draftId: string): Promise<StoredDraft>;
export declare function discardOperatingDraft(projectRoot: string, draftId: string): Promise<{
    discarded: OperatingMaterializedDraft;
    artifactPreserved: boolean;
}>;
export declare function assertOperatingDraftTargetApproved(projectRoot: string, target: string): Promise<void>;
export {};
//# sourceMappingURL=drafts.d.ts.map