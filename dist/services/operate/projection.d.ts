import type { OperatingRoleId, OperatingState } from './types.js';
export declare function renderOperatingBrief(state: OperatingState): string;
export interface OperatingBoardRole {
    id: OperatingRoleId;
    label: string;
}
/**
 * The complete advisory board (FR5). Every role renders a `board/<role>.md`
 * lens report for each reviewable/closed cycle — roles a cycle did not enable
 * are still written explicitly as `not_evaluated` so the readable tree never
 * hides a silent lens.
 */
export declare const OPERATING_BOARD_ROLES: readonly OperatingBoardRole[];
/**
 * State-derived lens report for a single board role and cycle. Role proposals
 * live outside the projected state, so the persisted board report carries the
 * cycle-local, role-attributable facts (evaluation status and the evidence gaps
 * that name the role) and points at the live `planr operate report` lens for
 * the full advisory output.
 *
 * `Status:` derives from whether a persisted `advisor-result` record actually
 * exists for the role+cycle (`evaluatedRoleIds`), never from `config.enabledRoles`
 * or `cycle.enabledRoles` — a role a cycle enabled but that never produced a
 * result must read `not_evaluated`, not "evaluated" (FR1). The rich
 * `markdownLens` assembly in `reports.ts` is the primary board renderer; this
 * state-only renderer is the honest fallback when the advisor-result records
 * cannot be re-read from the event log.
 */
export declare function renderOperatingBoardReport(state: OperatingState, cycleId: string, role: OperatingBoardRole, evaluatedRoleIds?: ReadonlySet<string>): string;
/**
 * Canonical machine-readable evidence index (FR5). The projected state carries
 * evidence-source summaries rather than the full v1.3 evidence items, so this
 * index reflects those sources deterministically for the readable tree.
 */
export declare function renderOperatingEvidenceIndex(state: OperatingState): string;
export declare function selectCycleState(state: OperatingState, cycleId?: string): OperatingState;
//# sourceMappingURL=projection.d.ts.map