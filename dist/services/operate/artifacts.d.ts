import { type OperatingArtifactSession, type OperatingEventHead, type OperatingSensitivity } from './types.js';
export declare function createArtifactSession(input: {
    id: string;
    cycleId: string;
    artifactType: OperatingArtifactSession['artifactType'];
    inputDigest: `sha256:${string}`;
    destination: string;
    evidenceRefs: string[];
    runtime: string;
    capability?: 'analysis-standard' | 'analysis-high';
    now?: string;
}): Promise<OperatingArtifactSession>;
export declare function commitGeneratedArtifact(input: {
    projectRoot: string;
    session: OperatingArtifactSession;
    content: string;
    eventHead: OperatingEventHead;
    previewDigest: `sha256:${string}`;
    localRoot?: string;
}): Promise<OperatingArtifactSession>;
export interface PlanrArtifactCitationResolution {
    /** Engine-computed existence fact the citation resolver consumes fail-closed. */
    artifactExists: boolean;
    /** The `.planr/`-relative path that was snapshotted, or null when nothing resolved. */
    location: string | null;
    /** Redacted artifact content, snapshotted through the same path repository citations use. */
    content: string | null;
    sensitivity: OperatingSensitivity;
    redactions: string[];
}
/**
 * Resolve a planr-artifact citation against `.planr/` at the cycle's pinned
 * revision (FR3/E-003). Computes the `artifactExists` fact the citation resolver
 * consumes and, when the artifact is a readable markdown/text file, snapshots its
 * content through the same redaction path repository citations use. Existence is
 * checked at the pinned revision, so an in-flight artifact that is not yet
 * committed does not resolve.
 */
export declare function resolvePlanrArtifactCitation(input: {
    projectRoot: string;
    pinnedRevision: string;
    artifactId: string;
    sensitivity?: OperatingSensitivity;
    maxBytes?: number;
    timeoutMs?: number;
}): Promise<PlanrArtifactCitationResolution>;
export declare function artifactInputDigest(input: {
    cycleId: string;
    evidenceRefs: string[];
    purpose: string;
}): `sha256:${string}`;
//# sourceMappingURL=artifacts.d.ts.map