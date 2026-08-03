import type { OperatingEvidenceCache } from './evidence-cache.js';
import { type OperatingSensitivity, type OperatingWorkspaceComponent } from './types.js';
export type CitationRejectionReason = 'fabricated-path' | 'wrong-line-range' | 'stale-revision' | 'unresolvable' | 'dirty-working-tree';
/** The canonical `operating-citation@1.3.0` anchor shape (exactly one locator). */
export interface OperatingCitation {
    citationKey?: string;
    repositoryPath?: string;
    lineRange?: {
        start: number;
        end: number;
    };
    gitRevision?: string;
    planrArtifactId?: string;
    pinnedRevision: string;
}
/** A Protocol v1.3 `operating-data-gap` (`category: 'unresolvable-citation'`). */
export interface OperatingCitationGap {
    kind: 'operating-data-gap';
    schemaVersion: '1.0.0';
    protocolVersion: '1.3.0';
    id: string;
    cycleId: string;
    category: 'unresolvable-citation';
    question: string;
    reason: string;
    unblocks: string[];
    affectedRoles?: string[];
    status: 'open';
    owner: string;
    evidenceRefs: string[];
    createdAt: string;
    updatedAt: string;
}
export interface CitationResolutionContext {
    projectRoot: string;
    /** Must match `^CYCLE-[0-9]{3,}$` so an unresolvable-citation gap validates. */
    cycleId: string;
    /** The control repository descriptor: the frozen pinned revision and the dirty fingerprint. */
    descriptor: OperatingWorkspaceComponent;
    cache: OperatingEvidenceCache;
    owner?: string;
    affectedRoles?: string[];
    snapshotTtlMs?: number;
    now?: Date;
    /** Sensitivity a snapshot inherits when the cited source declares none (defaults to `internal`). */
    defaultSensitivity?: OperatingSensitivity;
    /** Per-citation sensitivity inherited from the cited file (T-002's evidence-item sensitivity). */
    sensitivityFor?(citation: OperatingCitation): OperatingSensitivity | undefined;
}
export interface ResolvedCitation {
    citation: OperatingCitation;
    citationKey: string;
    outcome: 'resolved' | 'rejected';
    reason?: CitationRejectionReason;
    evidenceId?: string;
    snapshotDigest?: `sha256:${string}`;
    gap?: OperatingCitationGap;
    sensitivity: OperatingSensitivity;
}
/**
 * Resolve one citation against the cycle's pinned revision. Never throws for a
 * resolvable/unresolvable outcome: a resolved citation carries an `evidenceId`
 * whose snapshot has been persisted to machine-local evidence; a rejected one
 * carries a distinct `reason` and a single unresolvable-citation `gap`.
 */
export declare function resolveOperatingCitationAtPin(citation: OperatingCitation, context: CitationResolutionContext): Promise<ResolvedCitation>;
/** A proposal that carries the citations an advisor returned instead of pre-loaded evidence IDs. */
export interface CitationBearingProposal {
    proposalKey: string;
    citations: OperatingCitation[];
}
export interface RejectedProposalCitation {
    proposalKey: string;
    /** The primary rejection reason (the single gap opened for this proposal). */
    reason: CitationRejectionReason;
    /** Every distinct rejection reason across the proposal's citations. */
    reasons: CitationRejectionReason[];
    gapId: string;
}
export interface ProposalCitationEnforcement<P extends CitationBearingProposal> {
    /** Proposals whose every citation resolved, with the minted evidence IDs attached. */
    accepted: Array<{
        proposal: P;
        evidenceRefs: string[];
    }>;
    /** Proposals dropped before consolidation because a citation could not be resolved. */
    rejected: RejectedProposalCitation[];
    /** Exactly one unresolvable-citation gap per rejected proposal. */
    gaps: OperatingCitationGap[];
    evidenceIds: string[];
    resolutions: ResolvedCitation[];
}
/**
 * Resolve and enforce every proposal's citations before consolidation. A
 * proposal whose citations all resolve is accepted with its minted evidence IDs
 * attached; a proposal with ANY unresolvable citation is dropped and a single
 * unresolvable-citation gap is opened in its place. Nothing with an unresolved
 * citation is ever returned in `accepted`, so it can never reach consolidation.
 */
export declare function enforceProposalCitations<P extends CitationBearingProposal>(proposals: readonly P[], context: CitationResolutionContext): Promise<ProposalCitationEnforcement<P>>;
//# sourceMappingURL=citation-resolution.d.ts.map