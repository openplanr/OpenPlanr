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
import { ensureIssueLabel } from '../linear-service.js';
import { withLinearRetry } from './errors.js';

/**
 * Type → Linear label name for auto-applied GitHub-style filters. Users
 * can override names via `linear.typeLabels` in `.planr/config.json`.
 */
export type LinearLabeledArtifactType = 'feature' | 'story' | 'task' | 'quick' | 'backlog';

const DEFAULT_TYPE_LABEL_NAMES: Record<LinearLabeledArtifactType, string> = {
  feature: 'feature',
  story: 'story',
  task: 'task',
  quick: 'quick-task',
  backlog: 'backlog',
};

const TYPE_LABEL_COLORS: Record<LinearLabeledArtifactType, string> = {
  feature: '#5E6AD2', // Linear's indigo
  story: '#4CB782', // green
  task: '#F2994A', // orange
  quick: '#BB87FC', // purple
  backlog: '#888888', // grey (unchanged — matches pre-refactor default)
};

const TYPE_LABEL_DESCRIPTIONS: Record<LinearLabeledArtifactType, string> = {
  feature: 'OpenPlanr features (auto-applied by `planr linear push FEAT-*`).',
  story: 'OpenPlanr user stories (auto-applied by `planr linear push US-*`).',
  task: 'OpenPlanr task lists (auto-applied by `planr linear push TASK-*`).',
  quick: 'OpenPlanr quick tasks (auto-applied by `planr linear push QT-*`).',
  backlog: 'OpenPlanr backlog items (auto-applied by `planr linear push BL-*`).',
};

export function resolveTypeLabelName(
  config: OpenPlanrConfig,
  type: LinearLabeledArtifactType,
): string {
  return config.linear?.typeLabels?.[type] ?? DEFAULT_TYPE_LABEL_NAMES[type];
}

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
export function toOptionalStrategy(v: unknown): LinearMappingStrategy | undefined {
  if (v === 'project' || v === 'milestone-of' || v === 'label-on') return v;
  return undefined;
}

/** Resolve the epic-mapping strategy for an already-pushed epic (read-only). */
export function strategyFromEpic(epic: Epic, config: OpenPlanrConfig): LinearMappingStrategy {
  return epic.linearMappingStrategy ?? config.linear?.defaultEpicStrategy ?? 'project';
}

/**
 * Build the descendant-propagation context for a feature/story/tasklist push
 * **without** invoking any Linear mutation. Used by granular push scopes
 * (FEAT/US/TASK/QT/BL) where the epic is already mapped — the strategy is
 * whatever the epic's frontmatter says it is, and the containing projectId
 * + milestoneId + labelId are read-only from that frontmatter.
 */
export function contextFromMappedEpic(epic: Epic, config: OpenPlanrConfig): StrategyContext {
  const strategy = strategyFromEpic(epic, config);
  const projectId = epic.linearProjectId ?? '';
  return {
    strategy,
    projectId,
    milestoneId: strategy === 'milestone-of' ? epic.linearMilestoneId : undefined,
    labelId: strategy === 'label-on' ? epic.linearLabelId : undefined,
  };
}

/**
 * Read an issue's existing labelIds from Linear so we can merge (not stomp)
 * when the push re-applies the epic's label. Only called in the `label-on`
 * branch, so the extra round-trip is isolated to that strategy.
 */
export async function readExistingLabelIds(
  client: LinearClient,
  issueId: string,
): Promise<string[]> {
  return withLinearRetry('read label ids', async () => {
    const issue = await client.issue(issueId);
    const ids = (issue as unknown as { labelIds?: string[] })?.labelIds;
    return Array.isArray(ids) ? ids : [];
  });
}

/** Dedupe helper — merges `extra` into `base`, preserving order. */
export function mergeLabelIds(base: string[], extra: string | undefined): string[] {
  if (!extra) return [...base];
  if (base.includes(extra)) return [...base];
  return [...base, extra];
}

/**
 * Idempotent team label for a given OpenPlanr artifact type. Ensures the
 * label exists in Linear (creates or reuses by name), caches the result
 * per-push so cascades don't call the API once per item. Used by every
 * push worker to tag issues with a GitHub-style `feature` / `story` /
 * `task` / `quick-task` / `backlog` label.
 */
export async function ensureTypeLabel(
  client: LinearClient,
  teamId: string,
  config: OpenPlanrConfig,
  type: LinearLabeledArtifactType,
): Promise<string> {
  const name = resolveTypeLabelName(config, type);
  const label = await ensureIssueLabel(client, {
    teamId,
    name,
    color: TYPE_LABEL_COLORS[type],
    description: TYPE_LABEL_DESCRIPTIONS[type],
  });
  return label.id;
}

/**
 * In-process cache keyed by artifact type. Avoids round-tripping
 * `ensureIssueLabel` once per item in a cascade (`pushEpicScope` with many
 * features / stories / tasks / QTs / BLs hits Linear once per type).
 */
export function createTypeLabelCache(
  client: LinearClient,
  teamId: string,
  config: OpenPlanrConfig,
): (type: LinearLabeledArtifactType) => Promise<string> {
  const cache = new Map<LinearLabeledArtifactType, Promise<string>>();
  return (type: LinearLabeledArtifactType) => {
    const hit = cache.get(type);
    if (hit) return hit;
    const promise = ensureTypeLabel(client, teamId, config, type);
    cache.set(type, promise);
    return promise;
  };
}
