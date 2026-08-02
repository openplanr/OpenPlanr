import { type OperatingEvidence, type OperatingSensitivity } from './types.js';
export interface CitationSnapshotInput {
    evidenceId: string;
    citationKey?: string | null;
    snapshotDigest: `sha256:${string}`;
    sourceLocation: string;
    sensitivity: OperatingSensitivity;
    /** Already redacted through the standard evidence redaction path before it is handed in. */
    content: string;
}
export declare class OperatingEvidenceCache {
    private readonly cacheRoot;
    private readonly sensitivityCeiling;
    constructor(cacheRoot: string, sensitivityCeiling: OperatingSensitivity);
    put(cacheKey: string, evidence: OperatingEvidence, ttlMs: number, now?: Date): Promise<string>;
    private citationSnapshotTarget;
    /**
     * Persist a resolved-citation snapshot as machine-local evidence, addressed by
     * its resolver-minted `evidenceId`. Enforces the same sensitivity ceiling as
     * collected evidence and refuses to persist any content that still matches a
     * secret pattern — the snapshot is redacted upstream, and this is the
     * fail-closed guard that keeps a raw secret off disk. Returns the `evidenceId`.
     */
    putCitationSnapshot(input: CitationSnapshotInput, ttlMs: number, now?: Date): Promise<string>;
    /** Read back a resolved-citation snapshot by its `evidenceId`, honouring TTL and the sensitivity ceiling. */
    getCitationSnapshot(evidenceId: string, now?: Date): Promise<{
        content: string;
        sensitivity: OperatingSensitivity;
        sourceLocation: string;
    } | undefined>;
    get(digest: string, now?: Date): Promise<OperatingEvidence | undefined>;
    status(now?: Date): Promise<{
        entries: number;
        expired: number;
        bytes: number;
    }>;
    purgeExpired(now?: Date, options?: {
        all?: boolean;
    }): Promise<string[]>;
}
//# sourceMappingURL=evidence-cache.d.ts.map