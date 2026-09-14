/**
 * Pure plan-building for `planr linear push --dry-run`. Takes loaded scopes
 * and returns `LinearPushPlan` objects with per-kind row counts. No Linear
 * API calls; no mutations. Epic-scope plans cascade rows for linked QT/BL.
 */

import type { Epic, Feature, OpenPlanrConfig, UserStory } from '../../models/types.js';
import { findArtifactTypeById, listArtifacts, readArtifact } from '../artifact-service.js';
import { buildMergedTaskListBody, toOptionalString } from './body-formatters.js';
import {
  loadForBacklogItem,
  loadForFeature,
  loadForQuickTask,
  loadForStory,
  loadForTaskFile,
  loadLinearPushScope,
  type ScopedFeature,
  type ScopedTaskFile,
} from './scope-loaders.js';

export type LinearPushItemKind =
  | 'project'
  | 'feature'
  | 'story'
  | 'taskList'
  | 'quickTask'
  | 'backlogItem';

export type LinearPushAction = 'create' | 'update' | 'skip';

/** Scope of a granular push — what subtree `runLinearPush(artifactId)` touches. */
export type LinearPushScope = 'epic' | 'feature' | 'story' | 'taskFile' | 'quick' | 'backlog';

export interface LinearPushPlanRow {
  kind: LinearPushItemKind;
  /** Epic id, feature id, story id, or task-file id for this row. */
  artifactId: string;
  title: string;
  action: LinearPushAction;
  detail?: string;
}

export interface LinearPushPlan {
  /** The artifact the user pointed `planr linear push` at (any supported prefix). */
  rootArtifactId: string;
  /** The epic that owns this push's subtree; `undefined` for standalone QT/BL pushes. */
  epicId?: string;
  scope: LinearPushScope;
  rows: LinearPushPlanRow[];
  /** Counts by kind for non-`skip` rows. Missing kinds are 0. */
  counts: {
    project: number;
    features: number;
    stories: number;
    taskLists: number;
    quickTasks: number;
    backlogItems: number;
    total: number;
  };
}

/**
 * Extract the linked epic id from QT / BL frontmatter. Canonical field is
 * `epicId`; `parentEpic` is accepted as a compat alias for hand-authored
 * files. Empty strings are normalised to `undefined`.
 */
export function getLinkedEpicId(fm: Record<string, unknown>): string | undefined {
  return toOptionalString(fm.epicId) ?? toOptionalString(fm.parentEpic);
}

function sortByArtifactId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id, undefined, { numeric: true });
}

// ---------------------------------------------------------------------------
// Per-kind row builders
// ---------------------------------------------------------------------------

export function projectRow(epic: Epic): LinearPushPlanRow {
  const id = epic.linearProjectId;
  return {
    kind: 'project',
    artifactId: epic.id,
    title: epic.title.trim() || epic.id,
    action: id ? 'update' : 'create',
  };
}

export function featureRow(f: Feature): LinearPushPlanRow {
  return {
    kind: 'feature',
    artifactId: f.id,
    title: f.title.trim() || f.id,
    action: f.linearIssueId ? 'update' : 'create',
  };
}

export function storyRow(s: UserStory): LinearPushPlanRow {
  return {
    kind: 'story',
    artifactId: s.id,
    title: s.title.trim() || s.id,
    action: s.linearIssueId ? 'update' : 'create',
  };
}

export function taskListPlanRow(
  featureId: string,
  taskFiles: ScopedTaskFile[],
  hasBody: boolean,
  hadIssue: boolean,
): LinearPushPlanRow {
  if (!hasBody && !hadIssue) {
    return {
      kind: 'taskList',
      artifactId: featureId,
      title: `Tasks (${featureId})`,
      action: 'skip',
      detail: 'No task checkbox lines in task file(s) for this feature.',
    };
  }
  const label = taskFiles[0]?.id ?? featureId;
  return {
    kind: 'taskList',
    artifactId: label,
    title: `Tasks: ${featureId}`,
    action: hadIssue ? 'update' : 'create',
  };
}

export function applyUpdateOnly(
  rows: LinearPushPlanRow[],
  updateOnly: boolean,
): LinearPushPlanRow[] {
  if (!updateOnly) return rows;
  return rows.map((r) =>
    r.action === 'create'
      ? {
          ...r,
          action: 'skip' as const,
          detail: r.detail
            ? `${r.detail} (not created: --update-only)`
            : 'not created: --update-only',
        }
      : r,
  );
}

export function summarizePlan(
  rootArtifactId: string,
  epicId: string | undefined,
  scope: LinearPushScope,
  rows: LinearPushPlanRow[],
): LinearPushPlan {
  const countKind = (k: LinearPushItemKind) =>
    rows.filter((r) => r.kind === k && r.action !== 'skip').length;
  const project = countKind('project');
  const features = countKind('feature');
  const stories = countKind('story');
  const taskLists = countKind('taskList');
  const quickTasks = countKind('quickTask');
  const backlogItems = countKind('backlogItem');
  return {
    rootArtifactId,
    epicId,
    scope,
    rows,
    counts: {
      project,
      features,
      stories,
      taskLists,
      quickTasks,
      backlogItems,
      total: project + features + stories + taskLists + quickTasks + backlogItems,
    },
  };
}

// ---------------------------------------------------------------------------
// Scope-level row assembly
// ---------------------------------------------------------------------------

export async function buildFeaturePlanRows(
  projectDir: string,
  config: OpenPlanrConfig,
  sf: ScopedFeature,
  noCascade = false,
): Promise<LinearPushPlanRow[]> {
  const rows: LinearPushPlanRow[] = [];
  rows.push(featureRow(sf.data));
  if (noCascade) return rows;
  for (const st of sf.stories) {
    rows.push(storyRow(st.data));
  }
  const withLinear = await Promise.all(
    sf.taskFiles.map(async (tf) => {
      const a = await readArtifact(projectDir, config, 'task', tf.id);
      return { tf, issueId: toOptionalString(a?.data.linearIssueId) };
    }),
  );
  const hadIssue = Boolean(withLinear.find((x) => x.issueId)?.issueId);
  const body = await buildMergedTaskListBody(projectDir, config, sf.data.id, sf.taskFiles);
  const hasBody = body.trim().length > 0;
  rows.push(taskListPlanRow(sf.data.id, sf.taskFiles, hasBody, hadIssue));
  return rows;
}

export async function buildEpicPlanRows(
  projectDir: string,
  config: OpenPlanrConfig,
  epicScope: { epic: Epic; features: ScopedFeature[] },
  noCascade = false,
): Promise<LinearPushPlanRow[]> {
  const rows: LinearPushPlanRow[] = [];
  rows.push(projectRow(epicScope.epic));
  if (noCascade) return rows;
  for (const sf of epicScope.features) {
    rows.push(...(await buildFeaturePlanRows(projectDir, config, sf)));
  }
  // Linked QT / BL artifacts get their own rows so `--dry-run` matches what
  // `runLinearPush` would actually touch.
  const quicks = await listArtifacts(projectDir, config, 'quick');
  for (const q of quicks.sort(sortByArtifactId)) {
    const art = await readArtifact(projectDir, config, 'quick', q.id);
    if (!art || getLinkedEpicId(art.data) !== epicScope.epic.id) continue;
    const hasId = Boolean(toOptionalString(art.data.linearIssueId));
    rows.push({
      kind: 'quickTask',
      artifactId: q.id,
      title: (art.data.title as string)?.trim() || q.title || q.id,
      action: hasId ? 'update' : 'create',
    });
  }
  const backlogs = await listArtifacts(projectDir, config, 'backlog');
  for (const b of backlogs.sort(sortByArtifactId)) {
    const art = await readArtifact(projectDir, config, 'backlog', b.id);
    if (!art || getLinkedEpicId(art.data) !== epicScope.epic.id) continue;
    const hasId = Boolean(toOptionalString(art.data.linearIssueId));
    rows.push({
      kind: 'backlogItem',
      artifactId: b.id,
      title: (art.data.title as string)?.trim() || b.title || b.id,
      action: hasId ? 'update' : 'create',
    });
  }
  return rows;
}

/**
 * Build a push preview (and counts) for `planr linear push --dry-run` at any
 * granularity. Accepts any supported artifact id prefix (EPIC/FEAT/US/TASK/
 * QT/BL); returns `null` when the artifact can't be resolved or is not
 * pushable (ADR/SPRINT/checklist).
 */
export async function buildLinearPushPlan(
  projectDir: string,
  config: OpenPlanrConfig,
  artifactId: string,
  options?: { updateOnly?: boolean; noCascade?: boolean },
): Promise<LinearPushPlan | null> {
  const updateOnly = options?.updateOnly === true;
  const noCascade = options?.noCascade === true;
  const type = findArtifactTypeById(artifactId);
  if (!type) return null;

  if (type === 'epic') {
    const scope = await loadLinearPushScope(projectDir, config, artifactId);
    if (!scope) return null;
    const rows = applyUpdateOnly(
      await buildEpicPlanRows(projectDir, config, scope, noCascade),
      updateOnly,
    );
    return summarizePlan(artifactId, scope.epic.id, 'epic', rows);
  }

  if (type === 'feature') {
    const ctx = await loadForFeature(projectDir, config, artifactId);
    if (!ctx) return null;
    const rows = applyUpdateOnly(
      await buildFeaturePlanRows(projectDir, config, ctx.sf, noCascade),
      updateOnly,
    );
    return summarizePlan(artifactId, ctx.epic.id, 'feature', rows);
  }

  if (type === 'story') {
    const ctx = await loadForStory(projectDir, config, artifactId);
    if (!ctx) return null;
    const rows = applyUpdateOnly([storyRow(ctx.story.data)], updateOnly);
    return summarizePlan(artifactId, ctx.epic.id, 'story', rows);
  }

  if (type === 'task') {
    const ctx = await loadForTaskFile(projectDir, config, artifactId);
    if (!ctx) return null;
    const withLinear = await Promise.all(
      ctx.sf.taskFiles.map(async (tf) => {
        const a = await readArtifact(projectDir, config, 'task', tf.id);
        return { tf, issueId: toOptionalString(a?.data.linearIssueId) };
      }),
    );
    const hadIssue = Boolean(withLinear.find((x) => x.issueId)?.issueId);
    const body = await buildMergedTaskListBody(
      projectDir,
      config,
      ctx.sf.data.id,
      ctx.sf.taskFiles,
    );
    const hasBody = body.trim().length > 0;
    const rows = applyUpdateOnly(
      [taskListPlanRow(ctx.sf.data.id, ctx.sf.taskFiles, hasBody, hadIssue)],
      updateOnly,
    );
    return summarizePlan(artifactId, ctx.epic.id, 'taskFile', rows);
  }

  if (type === 'quick') {
    const qt = await loadForQuickTask(projectDir, config, artifactId);
    if (!qt) return null;
    const hasId = Boolean(toOptionalString(qt.frontmatter.linearIssueId));
    const rows = applyUpdateOnly(
      [
        {
          kind: 'quickTask',
          artifactId,
          title: qt.title.trim() || qt.id,
          action: hasId ? 'update' : 'create',
        },
      ],
      updateOnly,
    );
    return summarizePlan(artifactId, undefined, 'quick', rows);
  }

  if (type === 'backlog') {
    const bl = await loadForBacklogItem(projectDir, config, artifactId);
    if (!bl) return null;
    const hasId = Boolean(toOptionalString(bl.frontmatter.linearIssueId));
    const rows = applyUpdateOnly(
      [
        {
          kind: 'backlogItem',
          artifactId,
          title: bl.title.trim() || bl.id,
          action: hasId ? 'update' : 'create',
        },
      ],
      updateOnly,
    );
    return summarizePlan(artifactId, undefined, 'backlog', rows);
  }

  // sprint / adr / checklist — not supported.
  return null;
}
