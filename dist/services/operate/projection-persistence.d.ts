import { type OperatingEventHead, type OperatingState } from './types.js';
export type OperatingProjectionDriftStatus = 'absent' | 'current' | 'drift';
export interface OperatingProjectionDrift {
    path: string;
    status: OperatingProjectionDriftStatus;
    expectedDigest: `sha256:${string}`;
    actualDigest: `sha256:${string}` | null;
    reason?: string;
}
export interface OperatingProjectionFile {
    relativePath: string;
    content: string;
    markerName?: string;
    managedContent?: string;
}
export interface OperatingProjectionPreview {
    stateDigest: `sha256:${string}`;
    eventHead: OperatingEventHead;
    previewDigest: `sha256:${string}`;
    files: OperatingProjectionFile[];
    changedPaths: string[];
    drift: OperatingProjectionDrift[];
}
export interface PersistOperatingProjectionResult extends OperatingProjectionPreview {
    transactionId: string | null;
}
/**
 * The rich, event-log-derived board/report content for one governed cycle.
 * `reportMarkdown` is the full `readOperatingReport({cycleId}).markdown`;
 * `boardByRole` holds each role's `markdownLens` output (the exact per-role
 * Markdown `planr operate report <cycleId> --lens <role>` emits); and
 * `evaluatedRoleIds` names the roles that actually produced an advisor-result
 * record — the source of truth for a board's `Status:` line (FR1).
 */
export interface OperatingRichCycleArtifact {
    reportMarkdown: string;
    /** Added in Protocol v1.4; optional while replaying v1.2/v1.3 fixtures. */
    reportJson?: string;
    /** Added in Protocol v1.4; optional while replaying v1.2/v1.3 fixtures. */
    actionsMarkdown?: string;
    boardByRole: ReadonlyMap<string, string>;
    evaluatedRoleIds: ReadonlySet<string>;
}
/**
 * Re-read the committed event log to assemble the rich board/report content for
 * every reviewable/closed cycle. The persisted `report.md`/`board/<role>.md`
 * files must be the same scored, cited analysis the transient `review`/`report`
 * commands render — not the cheap state-only projection — so persistence and
 * drift-inspection both derive them here from the one `readOperatingReport`
 * assembly (FR1). Determinism from the immutable event log guarantees the
 * inspect re-render reproduces the persisted bytes.
 */
export declare function readOperatingRichCycleArtifacts(input: {
    projectRoot: string;
    state: OperatingState;
    localRoot?: string;
}): Promise<Map<string, OperatingRichCycleArtifact>>;
export declare function renderOperatingProjectionFiles(state: OperatingState, richArtifacts?: ReadonlyMap<string, OperatingRichCycleArtifact>): OperatingProjectionFile[];
export declare function inspectOperatingProjectionDrift(input: {
    projectRoot: string;
    state: OperatingState;
    localRoot?: string;
    richCycleArtifacts?: ReadonlyMap<string, OperatingRichCycleArtifact>;
}): Promise<OperatingProjectionDrift[]>;
export declare function assertOperatingProjectionsCurrent(input: {
    projectRoot: string;
    state: OperatingState;
    localRoot?: string;
}): Promise<void>;
export declare function prepareOperatingProjectionPersistence(input: {
    projectRoot: string;
    state: OperatingState;
    localRoot?: string;
}): Promise<OperatingProjectionPreview>;
export declare function persistOperatingProjections(input: {
    projectRoot: string;
    state: OperatingState;
    localRoot?: string;
    transactionId?: string;
    now?: string;
    revalidateEventHead?: () => Promise<OperatingEventHead>;
}): Promise<PersistOperatingProjectionResult>;
export declare const OPERATING_PROJECTION_PATHS: {
    readonly state: ".planr/operate/.state/state.json";
    readonly evidenceIndex: ".planr/operate/evidence-index.json";
    readonly brief: ".planr/operate/brief.md";
    readonly findings: ".planr/operate/findings.md";
    readonly decisions: ".planr/operate/decisions.md";
    readonly gaps: ".planr/operate/gaps.md";
    readonly routes: ".planr/operate/routes.md";
    readonly backlog: ".planr/operate/backlog.md";
};
//# sourceMappingURL=projection-persistence.d.ts.map