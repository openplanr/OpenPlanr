import type { OperatingState } from './types.js';
/**
 * FR7 — cycle integrity as a first-class surface.
 *
 * The integrity summary is assembled directly from committed state (the cycle's
 * governed data gaps), never from any advisory lens's own prose. In the audited
 * run the only integrity signal reached the operator because two lenses happened
 * to restate a citation rejection in their narrative; a lens that stayed silent
 * would have hidden it entirely. This module derives the same signal
 * deterministically so both `reports.ts` (the readable-tree section and its own
 * file) and `doctor.ts` (the regression guard) render it from one source and can
 * never drift.
 *
 * The signals:
 *  - citation rejections — `unresolvable-citation` gaps opened when a cited
 *    location could not be resolved to evidence at the pinned revision;
 *  - boundary refusals — the subset of those refused because the citation
 *    reached outside the pinned read boundary (uncommitted working-tree content,
 *    a root escape, or an above-ceiling read);
 *  - not_evaluated roles — a role whose citation-bearing response grounded zero
 *    evidence commits a schema-legal `quiet` result plus a governed
 *    `missing-evidence` gap naming it; that gap is the committed source of truth
 *    for the role's real not_evaluated reason.
 */
/** A rejected/refused citation, sourced from an `unresolvable-citation` gap. */
export interface OperatingIntegrityCitationEntry {
    gapId: string;
    reason: string;
    detail: string;
    affectedRoles: string[];
}
/** A role recorded not_evaluated, with its real gap reason (not lens prose). */
export interface OperatingIntegrityNotEvaluatedRole {
    roleId: string;
    gapId: string;
    reason: string;
    detail: string;
}
export interface OperatingIntegritySummary {
    cycleId: string;
    citationRejections: OperatingIntegrityCitationEntry[];
    boundaryRefusals: OperatingIntegrityCitationEntry[];
    notEvaluatedRoles: OperatingIntegrityNotEvaluatedRole[];
    /** True when any integrity signal is present for the cycle. */
    hasConcerns: boolean;
}
/**
 * Assemble the cycle's integrity summary from committed state. Pure over
 * `OperatingState`, so `reports.ts` and `doctor.ts` produce identical results.
 */
export declare function buildOperatingIntegritySummary(state: OperatingState, cycleId: string): OperatingIntegritySummary;
/**
 * Render the integrity signals as the body of the `# Integrity` section embedded
 * in the cycle report and the standalone `cycles/<id>/integrity.md`. Every entry
 * is named explicitly; a clean cycle states so plainly rather than omitting the
 * section, so the operator can always confirm integrity was evaluated.
 */
export declare function renderOperatingIntegritySection(summary: OperatingIntegritySummary): string;
/**
 * The standalone `cycles/<id>/integrity.md` body — the dedicated readable-tree
 * file guaranteeing the integrity signal survives independently of any report or
 * lens. Emitted only for a cycle that actually has integrity signals (a clean
 * cycle writes no integrity file), keeping the readable tree free of empty
 * artifacts.
 */
export declare function renderOperatingIntegrityDocument(summary: OperatingIntegritySummary): string;
/**
 * FR9 — honest workspace claims. Detect whether the project's `.planr/`
 * directory is gitignored, and state plainly what that means for versioning the
 * Operating Board. A gitignored `.planr/` is a legitimate choice (the board can
 * be a machine-local artifact), but the CLI must not imply the sanitized,
 * safe-to-commit board content is being tracked when git is configured to ignore
 * it. A project that is not a git worktree, or a git binary that cannot answer,
 * yields `ignored: false` with a neutral statement rather than a false claim.
 */
export interface OperatingWorkspaceVersioning {
    ignored: boolean;
    message: string;
}
export declare function detectGitignoredWorkspace(projectRoot: string): Promise<OperatingWorkspaceVersioning>;
//# sourceMappingURL=integrity.d.ts.map