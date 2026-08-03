import { type AdvisorAdapter, type AdvisorDispatchResult } from './advisors.js';
import type { CitationResolutionContext } from './citation-resolution.js';
import { type OperatingCycleManifest, type OperatingDataGap, type OperatingDecision, type OperatingEvidence, type OperatingEvidenceReadiness, type OperatingFinding, type OperatingProviderManifest, type OperatingRoleResult, type OperatingRoutePlan, type OperatingState } from './types.js';
export interface RunOperatingCycleInput {
    projectRoot: string;
    cycleId?: string;
    focus?: OperatingCycleManifest['focus'];
    depth?: OperatingCycleManifest['depth'];
    runtime?: string;
    offline?: boolean;
    reviewOnly?: boolean;
    preview?: boolean;
    dryRun?: boolean;
    confirmed?: boolean;
    quiet?: boolean;
    localRoot?: string;
    now?: Date;
    adapter?: AdvisorAdapter;
    /** Stop after preparing a cycle when a certified runtime executes mandates. */
    deferAdvisors?: boolean;
}
export interface NativeAdvisorHandoff {
    phase: 'advisors' | 'chair';
    cycleId: string;
    evidenceDigest: `sha256:${string}`;
    roles: string[];
}
export interface RunOperatingCycleResult {
    preview: boolean;
    dryRun: boolean;
    cycle: OperatingCycleManifest;
    evidence?: OperatingEvidence;
    readiness?: OperatingEvidenceReadiness;
    roleResults?: OperatingRoleResult[];
    findings?: OperatingFinding[];
    decisions?: OperatingDecision[];
    gaps?: OperatingDataGap[];
    routes?: OperatingRoutePlan[];
    provider?: OperatingProviderManifest | null;
    state?: OperatingState;
    modelCalls: number;
    warnings: string[];
    nativeHandoff?: NativeAdvisorHandoff;
    /** Per-role isolation provenance from this run's mandate dispatch. */
    dispatchProvenance?: AdvisorDispatchResult['provenance'];
}
export declare function buildChairEvidence(evidence: OperatingEvidence, results: OperatingRoleResult[], now: string): OperatingEvidence;
/**
 * FR2 universal citation gate — the PRIMARY, unconditional mechanism, run on
 * every dispatch path and every evidence source (no `bearing.length === 0`
 * bypass remains, so it is entered even for a citation-free result).
 *
 * Every recorded proposal that carries citations is resolved against the cycle's
 * pinned revision through `enforceRecordedProposalCitations`. A proposal with ANY
 * unresolvable citation is DROPPED — it never reaches `consolidateOperatingResults`
 * — and exactly one `unresolvable-citation` gap is opened in its place. A proposal
 * whose citations all resolve keeps its minted evidence IDs.
 *
 * On top of that per-proposal gate, the FR2 role-level rule: a role result whose
 * proposals carried citations but whose accepted citations resolve to ZERO
 * evidence IDs is `not_evaluated` — every one of its proposals is dropped, its id
 * is returned in `notEvaluatedRoleIds`, and one governed `missing-evidence` gap
 * naming the role and its empty grounding is opened. This replaces SPEC-003's
 * mission-only, repository-only starvation gate with one rule that holds whatever
 * the dispatch path or evidence source. A v1.2 pack result (evidenceRefs, no
 * citations) carries no citation-bearing proposal, so it is never demoted — the
 * pack path stays functional until T-003 removes it.
 */
export declare function gateRecordedProposalCitations(input: {
    roleResults: OperatingRoleResult[];
    context: CitationResolutionContext;
}): Promise<{
    roleResults: OperatingRoleResult[];
    gaps: OperatingDataGap[];
    notEvaluatedRoleIds: string[];
}>;
export declare function runOperatingCycle(input: RunOperatingCycleInput): Promise<RunOperatingCycleResult>;
//# sourceMappingURL=engine.d.ts.map