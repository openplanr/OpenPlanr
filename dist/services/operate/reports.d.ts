import type { DecisionBriefSource } from './decision-brief.js';
import { type OperatingRoleId, type OperatingRoleResult, type OperatingState } from './types.js';
export interface OperatingLensReport {
    roleId: OperatingRoleId;
    label: string;
    mandate: string;
    outcome: OperatingRoleResult['outcome'] | 'not_evaluated';
    proposals: OperatingRoleResult['proposals'];
    gaps: string[];
    conflicts: string[];
    resultDigest: `sha256:${string}` | null;
    analysisMarkdown?: string;
    claims?: Array<Record<string, unknown>>;
    actions?: Array<Record<string, unknown>>;
}
/**
 * Render a single role's advisory lens report as the exact Markdown the
 * `review`/`report` commands emit for that role. Exported so
 * `projection-persistence.ts` can persist each `cycles/<id>/board/<role>.md`
 * from the same assembly, guaranteeing the committed board file byte-matches
 * `planr operate report <cycleId> --lens <role>` (FR1). A role with no
 * advisor-result record renders honestly as `Status: not_evaluated`.
 */
export declare function markdownLens(report: OperatingLensReport): string;
/**
 * FR8: the complete, uncapped registers appended to the persisted
 * `cycles/<id>/report.md` so the on-disk artifact is self-contained. The concise
 * brief `renderOperatingBrief` produces keeps its top-5/top-4 cap for the CLI's
 * `operate review`/`operate report` display; this renders every finding,
 * decision, evidence gap, and route with no `.slice()` cap, for the persisted
 * report path only. Callers pass the cycle-scoped state so the registers are
 * exactly this cycle's records.
 */
export declare function markdownCompleteRegisters(state: OperatingState): string;
/**
 * Assemble the human report for a governed cycle: the concise brief, the
 * per-role advisory lens reports, and the exact next actions, plus a single
 * rendered `markdown` string. This is the shared review/report Markdown
 * assembly — `lifecycle.ts`'s `readOperatingReview` human path reuses this
 * `markdown` output for `operate review` (FR3/E-003) rather than re-deriving the
 * per-role/actions logic, while the raw state object stays reserved for the
 * `--json` surface.
 */
export declare function readOperatingReport(input: {
    projectRoot: string;
    cycleId?: string;
    lens?: string;
    localRoot?: string;
}): Promise<{
    cycleId: string;
    brief: string;
    reports: OperatingLensReport[];
    actions: Array<{
        kind: 'review' | 'finding' | 'route' | 'planning';
        label: string;
        command: string;
    }>;
    markdown: string;
}>;
/**
 * Assemble render-ready brief/decision data (FR7/E-007). With `decisionId`, the
 * result is a decision-focused source (question, cited evidence, options, and
 * what the decision blocks); otherwise it is the cycle brief. Evidence carries
 * only `{ ref, sensitivity }`, ready for the render-time sensitivity ceiling.
 */
export declare function readOperatingDecisionBriefSource(input: {
    projectRoot: string;
    cycleId?: string;
    decisionId?: string;
    localRoot?: string;
}): Promise<DecisionBriefSource>;
//# sourceMappingURL=reports.d.ts.map