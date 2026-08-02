/**
 * Post-flight evidence verification for `planr revise`.
 *
 * The revise agent emits a ReviseDecision with typed evidence citations. Before
 * the user ever sees a diff, this verifier checks each citation against the
 * real repo:
 *
 * - `file_exists` / `file_absent` — fs.stat on the ref path
 * - `grep_match`                   — literal check inside the codebase context
 *                                    the agent was given; rejects claims the
 *                                    agent could not have seen
 * - `sibling_artifact`             — artifact id must exist on disk
 * - `source_quote`                 — source path must exist on disk (quote
 *                                    fuzzy-match is best-effort)
 * - `pattern_rule`                 — rule id must be in the detected pattern
 *                                    rules for this run
 *
 * Unverifiable evidence is dropped with a reason. If a `revise` action has no
 * surviving evidence after the sweep, the decision is demoted to `flag` with
 * an explicit ambiguity entry — the agent's judgment wasn't necessarily wrong,
 * but its *proof* can't be trusted, so a human owns the call.
 */
import type { OpenPlanrConfig, ReviseDecision, ReviseEvidence } from '../models/types.js';
/**
 * Run-time context the verifier needs. Callers should populate this from the
 * same inputs used to build the revise prompt, so the verifier checks evidence
 * against exactly the material the agent had access to.
 */
export interface EvidenceVerifierContext {
    projectDir: string;
    config: OpenPlanrConfig;
    /**
     * Directory of the artifact being verified. Used to resolve relative
     * evidence refs like `../features/FEAT-001-slug.md` that appear in
     * markdown cross-reference links (those paths are relative to the
     * artifact's file location, not to projectDir). Falls back to projectDir
     * when omitted.
     */
    artifactDir?: string;
    /** Concatenated string from `formatCodebaseContext`; undefined in fast mode. */
    codebaseContextFormatted?: string;
    /** Labels (paths or URLs) of declared sources supplied to the agent. */
    knownSourceRefs: string[];
    /** Pattern rule ids detected in the codebase context (from pattern-rules). */
    knownPatternRuleIds: string[];
}
export interface DroppedEvidence {
    evidence: ReviseEvidence;
    reason: string;
}
export interface DecisionVerificationResult {
    /** Possibly-rewritten decision (evidence filtered; action demoted if needed). */
    decision: ReviseDecision;
    /** Evidence items that failed verification and were removed from the decision. */
    dropped: DroppedEvidence[];
    /** True when the verifier changed the action (e.g., revise → flag). */
    demoted: boolean;
}
/**
 * Verify every evidence item in a decision; drop anything unverifiable.
 * Demote `revise` to `flag` when no verifiable evidence remains.
 */
export declare function verifyDecision(decision: ReviseDecision, ctx: EvidenceVerifierContext): Promise<DecisionVerificationResult>;
interface EvidenceCheck {
    ok: boolean;
    reason: string;
}
/** Verify a single evidence item. Exported primarily for testing. */
export declare function verifyEvidence(ev: ReviseEvidence, ctx: EvidenceVerifierContext): Promise<EvidenceCheck>;
export {};
//# sourceMappingURL=evidence-verifier.d.ts.map