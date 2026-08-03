/**
 * `planr revise` — core service.
 *
 * Exposes composable primitives. `reviseArtifact` produces dry-run decisions;
 * `applyDecision` writes them to disk. The verifier context is exposed so
 * callers can run `verifyDecision` against the same inputs the agent saw.
 */
import { type RevisePromptArtifact, type ReviseWritableScope } from '../ai/prompts/prompt-builder.js';
import { type AIProvider, type AIUsage } from '../ai/types.js';
import type { ArtifactType, OpenPlanrConfig, ReviseAuditEntry, ReviseDecision } from '../models/types.js';
import type { AuditLogWriter } from './audit-log-service.js';
import type { EvidenceVerifierContext } from './evidence-verifier.js';
export interface ReviseArtifactOptions {
    /** Must be `true` in this release; reserved for future write path. */
    dryRun: true;
    /** Which parts of the artifact the agent may modify. Default: 'all'. */
    writableScope?: ReviseWritableScope;
    /** Skip codebase context assembly (fast mode). Default: include code. */
    noCodeContext?: boolean;
    /** Skip immediate-sibling context gathering (fast mode / first-pass). Default: include. */
    noSiblingContext?: boolean;
    /** Maximum number of sibling artifacts to inject (budget guard). Default: 8. */
    maxSiblings?: number;
}
export interface ReviseArtifactContextStats {
    parentsLoaded: number;
    siblingsLoaded: number;
    codebaseContextIncluded: boolean;
    sourcesLoaded: number;
}
export interface ReviseArtifactResult {
    decision: ReviseDecision;
    usage: AIUsage;
    contextStats: ReviseArtifactContextStats;
    /** Filesystem path the decision's revisedMarkdown would be written to. */
    artifactPath: string;
    /** Pre-revise raw content, used for diff rendering and auditing. */
    originalContent: string;
    /** Context the caller should pass to `verifyDecision`. */
    verifierContext: EvidenceVerifierContext;
}
/**
 * Error thrown when an artifact id cannot be resolved to an artifact type or
 * the artifact file does not exist on disk.
 */
export declare class ReviseArtifactNotFoundError extends Error {
    readonly artifactId: string;
    constructor(artifactId: string, message: string);
}
/**
 * Revise a single artifact (dry-run).
 *
 * Does NOT write any files. The returned decision is the agent output after
 * schema validation; evidence verification, diff preview, and write live in
 * the CLI / apply path. Cascade, siblings, and declared sources are future
 * extensions.
 */
export declare function reviseArtifact(projectDir: string, config: OpenPlanrConfig, provider: AIProvider, artifactId: string, options: ReviseArtifactOptions): Promise<ReviseArtifactResult>;
export interface ApplyDecisionOptions {
    artifactPath: string;
    originalContent: string;
    decision: ReviseDecision;
    /**
     * Directory where sidecar backups are written. Typically
     * `.planr/reports/revise-<scope>-<date>/backup/` — set by the CLI.
     */
    backupDir: string;
    /** Audit writer that will persist an entry describing the outcome. */
    audit: AuditLogWriter;
    /** When true, produces an audit entry but does not write the artifact. */
    dryRun: boolean;
    /** Cascade level tag for audit log grouping; omit for single-artifact runs. */
    cascadeLevel?: ReviseAuditEntry['cascadeLevel'];
}
export interface ApplyDecisionResult {
    outcome: ReviseAuditEntry['outcome'];
    wrote: boolean;
    diff: string;
}
/**
 * Apply a (verified) decision: write the artifact atomically when
 * `action === 'revise'` and `dryRun` is false, emit an audit entry
 * describing the outcome either way.
 *
 * Caller is expected to have already run `verifyDecision` — `applyDecision`
 * trusts that whatever decision arrives is allowed to be written.
 */
export declare function applyDecision(options: ApplyDecisionOptions): Promise<ApplyDecisionResult>;
/**
 * `true` when the agent's `revisedMarkdown` is byte-identical to `original`,
 * or differs only in trailing whitespace/newlines (LLM markdown serializers
 * routinely drop or add one trailing newline without changing semantics).
 *
 * Exported so the `--apply-from <audit>` replay path and the interactive
 * UI can share the same unchanged-detection rule.
 */
export declare function isEffectivelyUnchanged(original: string, revised: string | undefined): boolean;
/**
 * Load immediate-sibling artifacts (same artifact type, same parent) as
 * prompt entries. Lazy-reads each sibling's body only if it's going to be
 * included — the listing check is cheap, the reads are budgeted by
 * `maxSiblings` (default 8) so the prompt stays within token budget even on
 * epics with many features.
 *
 * For epic scope, there are no siblings (epics live at the top). For types
 * without a parent-id relationship (quick, backlog, etc.), returns empty.
 */
export declare function loadSiblingPromptArtifacts(projectDir: string, config: OpenPlanrConfig, type: ArtifactType, id: string, maxSiblings: number): Promise<RevisePromptArtifact[]>;
/**
 * Resolve the parent chain for an artifact and return it as the ordered
 * `RevisePromptArtifact[]` the prompt builder expects (epic → feature →
 * story). Empty array for top-level artifacts (epic scope).
 */
export declare function loadParentPromptArtifacts(projectDir: string, config: OpenPlanrConfig, type: ArtifactType, id: string): Promise<RevisePromptArtifact[]>;
//# sourceMappingURL=revise-service.d.ts.map