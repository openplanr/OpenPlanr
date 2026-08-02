/**
 * Epic-mapping strategy resolution + descendant-propagation context.
 *
 * `StrategyContext` is the read-only bundle that a single-scope push
 * (feature / story / tasklist / QT / BL) needs to attach descendant issues
 * into Linear correctly: `projectId` is always set, `milestoneId` / `labelId`
 * are populated per the epic's strategy. The epic-scope push also builds a
 * context on first push (interactive mapping prompt or `--as` flag) — that
 * builder lives inside `pushEpicScope` because it performs Linear mutations.
 */
import type { LinearClient } from '@linear/sdk';
import type { Epic, LinearMappingStrategy, OpenPlanrConfig } from '../../models/types.js';
/**
 * Type → Linear label name for auto-applied GitHub-style filters. Users
 * can override names via `linear.typeLabels` in `.planr/config.json`.
 */
export type LinearLabeledArtifactType = 'feature' | 'story' | 'task' | 'quick' | 'backlog';
export declare function resolveTypeLabelName(config: OpenPlanrConfig, type: LinearLabeledArtifactType): string;
export interface StrategyContext {
    strategy: LinearMappingStrategy;
    /** Always set — the Linear project that contains the epic's descendants. */
    projectId: string;
    /** Set when strategy === 'milestone-of' — written to every descendant issue. */
    milestoneId?: string;
    /** Set when strategy === 'label-on' — merged into every descendant issue's labelIds. */
    labelId?: string;
}
/**
 * Validate a stored `linearMappingStrategy` frontmatter value at the type
 * boundary. Returns `undefined` for anything that isn't one of the three
 * known strategies — the caller falls back to `'project'` in that case.
 */
export declare function toOptionalStrategy(v: unknown): LinearMappingStrategy | undefined;
/** Resolve the epic-mapping strategy for an already-pushed epic (read-only). */
export declare function strategyFromEpic(epic: Epic, config: OpenPlanrConfig): LinearMappingStrategy;
/**
 * Build the descendant-propagation context for a feature/story/tasklist push
 * **without** invoking any Linear mutation. Used by granular push scopes
 * (FEAT/US/TASK/QT/BL) where the epic is already mapped — the strategy is
 * whatever the epic's frontmatter says it is, and the containing projectId
 * + milestoneId + labelId are read-only from that frontmatter.
 */
export declare function contextFromMappedEpic(epic: Epic, config: OpenPlanrConfig): StrategyContext;
/**
 * Read an issue's existing labelIds from Linear so we can merge (not stomp)
 * when the push re-applies the epic's label. Only called in the `label-on`
 * branch, so the extra round-trip is isolated to that strategy.
 */
export declare function readExistingLabelIds(client: LinearClient, issueId: string): Promise<string[]>;
/** Dedupe helper — merges `extra` into `base`, preserving order. */
export declare function mergeLabelIds(base: string[], extra: string | undefined): string[];
/**
 * Idempotent team label for a given OpenPlanr artifact type. Ensures the
 * label exists in Linear (creates or reuses by name), caches the result
 * per-push so cascades don't call the API once per item. Used by every
 * push worker to tag issues with a GitHub-style `feature` / `story` /
 * `task` / `quick-task` / `backlog` label.
 */
export declare function ensureTypeLabel(client: LinearClient, teamId: string, config: OpenPlanrConfig, type: LinearLabeledArtifactType): Promise<string>;
/**
 * In-process cache keyed by artifact type. Avoids round-tripping
 * `ensureIssueLabel` once per item in a cascade (`pushEpicScope` with many
 * features / stories / tasks / QTs / BLs hits Linear once per type).
 */
export declare function createTypeLabelCache(client: LinearClient, teamId: string, config: OpenPlanrConfig): (type: LinearLabeledArtifactType) => Promise<string>;
//# sourceMappingURL=strategy-context.d.ts.map