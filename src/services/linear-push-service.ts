/**
 * `planr linear push` — map Epic → Linear Project, Feature → top-level project issue,
 * Story and TaskList → sub-issues of the feature issue (FEAT-016).
 */

import type { LinearClient } from '@linear/sdk';
import { parseTaskMarkdown } from '../agents/task-parser.js';
import type {
  LinearMappingStrategy,
  OpenPlanrConfig,
  TaskStatus,
  UserStory,
} from '../models/types.js';
import { logger } from '../utils/logger.js';
import {
  findArtifactTypeById,
  listArtifacts,
  readArtifact,
  updateArtifactFields,
} from './artifact-service.js';
import {
  buildBacklogItemBody,
  buildEpicProjectDescription,
  buildFeatureIssueBody,
  buildMergedTaskListBody,
  buildStoryIssueBody,
  formatTaskCheckboxBody,
  toOptionalString,
} from './linear/body-formatters.js';
import {
  buildLinearPushPlan,
  getLinkedEpicId,
  type LinearPushAction,
  type LinearPushItemKind,
  type LinearPushPlan,
  type LinearPushPlanRow,
  type LinearPushScope,
} from './linear/plan-builders.js';
import {
  loadForBacklogItem,
  loadForFeature,
  loadForQuickTask,
  loadForStory,
  loadForTaskFile,
  loadLinearPushScope,
  type ScopedFeature,
  type ScopedStandaloneArtifact,
} from './linear/scope-loaders.js';
import {
  contextFromMappedEpic,
  createTypeLabelCache,
  type LinearLabeledArtifactType,
  mergeLabelIds,
  readExistingLabelIds,
  type StrategyContext,
} from './linear/strategy-context.js';
import {
  createLinearIssue,
  createLinearProject,
  createProjectMilestone,
  ensureIssueLabel,
  isLikelyLinearIssueId,
  isLikelyLinearWorkflowStateId,
  updateLinearIssue,
  updateLinearProject,
} from './linear-service.js';

export {
  buildBacklogItemBody,
  buildEpicProjectDescription,
  buildFeatureIssueBody,
  buildLinearPushPlan,
  buildMergedTaskListBody,
  buildStoryIssueBody,
  formatTaskCheckboxBody,
  type LinearPushAction,
  type LinearPushItemKind,
  type LinearPushPlan,
  type LinearPushPlanRow,
  type LinearPushScope,
  loadForBacklogItem,
  loadForFeature,
  loadForQuickTask,
  loadForStory,
  loadForTaskFile,
  loadLinearPushScope,
  type ScopedFeature,
  type ScopedStandaloneArtifact,
};

/**
 * H1 — Decide whether a stored `linearIssueId` frontmatter value should be
 * trusted for an update call, or treated as stale/corrupted so we fall
 * through to the create path instead. Logs a warning either way so the user
 * can spot the repair.
 */
function isUsableLinearIssueId(value: string | undefined, artifactLabel: string): value is string {
  if (!value) return false;
  if (!isLikelyLinearIssueId(value)) {
    logger.warn(
      `${artifactLabel}: stored linearIssueId "${value}" is not a valid Linear id (expected uuid or \`ENG-42\` identifier). Falling through to the create path — re-push will write a fresh, valid id.`,
    );
    return false;
  }
  return true;
}

// LinearPushItemKind / LinearPushAction / LinearPushScope / LinearPushPlanRow /
// LinearPushPlan live in `./linear/plan-builders.ts` and are re-exported above.

export interface LinearPushOptions {
  /** Only update existing linked entities; never create new ones. */
  updateOnly?: boolean;
  /**
   * When true and a FEAT/US/TASK push's parent chain is not yet in Linear,
   * push the missing parents first without prompting. Non-interactive mode
   * requires this to be set explicitly to auto-cascade.
   */
  pushParents?: boolean;
  /**
   * Phase 2: first-time epic mapping override — used when the user passes
   * `--as project|milestone-of:<id>|label-on:<id>` or picks a strategy at the
   * interactive first-push prompt. Ignored on subsequent pushes when the
   * epic already has `linearMappingStrategy` stored (re-strategize is Phase 5).
   */
  strategyOverride?: {
    strategy: LinearMappingStrategy;
    /** For milestone-of / label-on only: the Linear project UUID to attach into. */
    targetProjectId?: string;
  };
}

// StrategyContext is defined in `./linear/strategy-context.ts` and imported above.

function sortByArtifactId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id, undefined, { numeric: true });
}

function asTaskStatus(s: unknown): TaskStatus {
  if (s === 'pending' || s === 'in-progress' || s === 'done') return s;
  return 'pending';
}

/** OpenPlanr status → Linear `stateId` for create/update (FEAT-016). Prefer `linear.pushStateIds`. */
function resolveStateIdForPush(
  config: OpenPlanrConfig,
  status: string | undefined,
): string | undefined {
  if (!status) return undefined;
  const s = asTaskStatus(status);
  const push = config.linear?.pushStateIds;
  if (push) {
    const v = push[s] ?? push[status];
    if (v) return v;
  }
  const m = config.linear?.statusMap;
  if (m) {
    const v = m[s] ?? m[status];
    if (v && isLikelyLinearWorkflowStateId(v)) return v;
  }
  return undefined;
}

// Plan builders live in `./linear/plan-builders.ts` and are re-exported above.

// ---------------------------------------------------------------------------
// Per-feature / per-story / per-tasklist push primitives.
// Shared between epic-scope pushes (which loop over features) and granular
// scope pushes (which push a single feature / story / task subtree).
// ---------------------------------------------------------------------------

/**
 * Push one feature issue and its descendants (stories + merged tasklist) under
 * an already-resolved Linear project. Returns the feature's Linear issue id,
 * or `null` when `updateOnly` is set and the feature has no prior linear link
 * (caller decides whether to propagate the skip).
 *
 * Strategy propagation: when `strategyCtx.strategy === 'milestone-of'` the
 * feature issue gets `projectMilestoneId` set; when `'label-on'` the epic's
 * label is merged into the issue's labelIds (existing labels preserved).
 */
async function pushOneFeatureAndDescendants(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  sf: ScopedFeature,
  strategyCtx: StrategyContext,
  typeLabelCache: (type: LinearLabeledArtifactType) => Promise<string>,
  teamId: string,
  updateOnly: boolean,
): Promise<string | null> {
  const f = sf.data;
  const featureTitle = f.title.trim();
  const featureBody = buildFeatureIssueBody(f);
  const stateF = resolveStateIdForPush(config, f.status);
  const { projectId } = strategyCtx;
  const typeLabelId = await typeLabelCache('feature');

  let featureIssueId: string;
  if (isUsableLinearIssueId(f.linearIssueId, `Feature ${f.id}`)) {
    const existingLabels = await readExistingLabelIds(client, f.linearIssueId);
    const labelIds = mergeLabelIds(
      mergeLabelIds(existingLabels, typeLabelId),
      strategyCtx.strategy === 'label-on' ? strategyCtx.labelId : undefined,
    );
    const u = await updateLinearIssue(client, f.linearIssueId, {
      title: featureTitle,
      description: featureBody,
      projectId,
      teamId,
      stateId: stateF ?? null,
      projectMilestoneId: strategyCtx.milestoneId ?? null,
      labelIds,
    });
    featureIssueId = u.id;
    const fmUpdate: Record<string, string | string[]> = {
      linearIssueId: u.id,
      linearIssueIdentifier: u.identifier,
      linearIssueUrl: u.url,
      linearLabelIds: labelIds,
    };
    if (strategyCtx.milestoneId) fmUpdate.linearProjectMilestoneId = strategyCtx.milestoneId;
    await updateArtifactFields(projectDir, config, 'feature', f.id, fmUpdate);
  } else {
    if (updateOnly) {
      logger.warn(
        `Update-only: skipping feature ${f.id} (no linearIssueId) — not creating it; stories and tasks under this feature are skipped.`,
      );
      return null;
    }
    const initialLabelIds = mergeLabelIds(
      [typeLabelId],
      strategyCtx.strategy === 'label-on' ? strategyCtx.labelId : undefined,
    );
    const c = await createLinearIssue(client, {
      teamId,
      projectId,
      title: featureTitle,
      description: featureBody,
      stateId: stateF ?? null,
      ...(strategyCtx.milestoneId ? { projectMilestoneId: strategyCtx.milestoneId } : {}),
      labelIds: initialLabelIds,
    });
    featureIssueId = c.id;
    const fmUpdate: Record<string, string | string[]> = {
      linearIssueId: c.id,
      linearIssueIdentifier: c.identifier,
      linearIssueUrl: c.url,
      linearLabelIds: initialLabelIds,
    };
    if (strategyCtx.milestoneId) fmUpdate.linearProjectMilestoneId = strategyCtx.milestoneId;
    await updateArtifactFields(projectDir, config, 'feature', f.id, fmUpdate);
  }

  for (const st of sf.stories) {
    await pushOneStoryUnderFeature(
      projectDir,
      config,
      client,
      st.data,
      featureIssueId,
      strategyCtx,
      typeLabelCache,
      teamId,
      updateOnly,
    );
  }

  await pushOneTaskListForFeature(
    projectDir,
    config,
    client,
    sf,
    featureIssueId,
    strategyCtx,
    typeLabelCache,
    teamId,
    updateOnly,
  );

  return featureIssueId;
}

/**
 * Create or update one story sub-issue under a resolved feature Linear parent.
 * Inherits milestone/label attributes from the containing epic via `strategyCtx`.
 */
async function pushOneStoryUnderFeature(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  s: UserStory,
  featureIssueId: string,
  strategyCtx: StrategyContext,
  typeLabelCache: (type: LinearLabeledArtifactType) => Promise<string>,
  teamId: string,
  updateOnly: boolean,
): Promise<void> {
  const storyTitle = s.title.trim();
  const storyBody = buildStoryIssueBody(s);
  const stateS = resolveStateIdForPush(config, s.status);
  const { projectId } = strategyCtx;
  const typeLabelId = await typeLabelCache('story');
  if (isUsableLinearIssueId(s.linearIssueId, `Story ${s.id}`)) {
    const existingLabels = await readExistingLabelIds(client, s.linearIssueId);
    const labelIds = mergeLabelIds(
      mergeLabelIds(existingLabels, typeLabelId),
      strategyCtx.strategy === 'label-on' ? strategyCtx.labelId : undefined,
    );
    const u = await updateLinearIssue(client, s.linearIssueId, {
      title: storyTitle,
      description: storyBody,
      projectId,
      teamId,
      parentId: featureIssueId,
      stateId: stateS ?? null,
      projectMilestoneId: strategyCtx.milestoneId ?? null,
      labelIds,
    });
    const fmUpdate: Record<string, string | string[]> = {
      linearIssueId: u.id,
      linearIssueIdentifier: u.identifier,
      linearIssueUrl: u.url,
      linearParentIssueId: featureIssueId,
      linearLabelIds: labelIds,
    };
    if (strategyCtx.milestoneId) fmUpdate.linearProjectMilestoneId = strategyCtx.milestoneId;
    await updateArtifactFields(projectDir, config, 'story', s.id, fmUpdate);
    return;
  }
  if (updateOnly) {
    logger.warn(`Update-only: skipping story ${s.id} (no linearIssueId).`);
    return;
  }
  const initialLabelIds = mergeLabelIds(
    [typeLabelId],
    strategyCtx.strategy === 'label-on' ? strategyCtx.labelId : undefined,
  );
  const c = await createLinearIssue(client, {
    teamId,
    projectId,
    parentId: featureIssueId,
    title: storyTitle,
    description: storyBody,
    stateId: stateS ?? null,
    ...(strategyCtx.milestoneId ? { projectMilestoneId: strategyCtx.milestoneId } : {}),
    labelIds: initialLabelIds,
  });
  const fmUpdate: Record<string, string | string[]> = {
    linearIssueId: c.id,
    linearIssueIdentifier: c.identifier,
    linearIssueUrl: c.url,
    linearParentIssueId: featureIssueId,
    linearLabelIds: initialLabelIds,
  };
  if (strategyCtx.milestoneId) fmUpdate.linearProjectMilestoneId = strategyCtx.milestoneId;
  await updateArtifactFields(projectDir, config, 'story', s.id, fmUpdate);
}

/**
 * Create or update the single "Tasks for <feature>" sub-issue that aggregates
 * all task-file checkboxes for a feature. Merges all task files sharing this
 * feature into one body. Returns without writing when there is nothing to
 * push and no existing linear issue to keep in sync.
 */
async function pushOneTaskListForFeature(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  sf: ScopedFeature,
  featureIssueId: string,
  strategyCtx: StrategyContext,
  typeLabelCache: (type: LinearLabeledArtifactType) => Promise<string>,
  teamId: string,
  updateOnly: boolean,
): Promise<void> {
  const f = sf.data;
  const { projectId } = strategyCtx;
  const mergedBody = await buildMergedTaskListBody(projectDir, config, f.id, sf.taskFiles);
  const issueFromFiles = await Promise.all(
    sf.taskFiles.map(async (tf) => {
      const a = await readArtifact(projectDir, config, 'task', tf.id);
      return toOptionalString(a?.data.linearIssueId);
    }),
  );
  const rawExistingTaskIssueId = issueFromFiles.find(Boolean);
  const existingTaskIssueId = isUsableLinearIssueId(
    rawExistingTaskIssueId,
    `TaskList under ${f.id}`,
  )
    ? rawExistingTaskIssueId
    : undefined;

  if (!mergedBody.trim() && !existingTaskIssueId) {
    return;
  }
  const title =
    sf.taskFiles.length > 1
      ? `Tasks: ${f.title} (${sf.taskFiles.length} files)`
      : `Tasks: ${f.title}`;
  const typeLabelId = await typeLabelCache('task');

  if (existingTaskIssueId) {
    const existingLabels = await readExistingLabelIds(client, existingTaskIssueId);
    const labelIds = mergeLabelIds(
      mergeLabelIds(existingLabels, typeLabelId),
      strategyCtx.strategy === 'label-on' ? strategyCtx.labelId : undefined,
    );
    const u = await updateLinearIssue(client, existingTaskIssueId, {
      title,
      description: mergedBody || '_No open tasks in OpenPlanr task file(s)._',
      projectId,
      teamId,
      parentId: featureIssueId,
      projectMilestoneId: strategyCtx.milestoneId ?? null,
      labelIds,
    });
    const synced = new Date().toISOString();
    for (const tf of sf.taskFiles) {
      const fmUpdate: Record<string, string | string[]> = {
        linearIssueId: u.id,
        linearIssueIdentifier: u.identifier,
        linearIssueUrl: u.url,
        linearParentIssueId: featureIssueId,
        linearTaskChecklistSyncedAt: synced,
        linearLabelIds: labelIds,
      };
      if (strategyCtx.milestoneId) fmUpdate.linearProjectMilestoneId = strategyCtx.milestoneId;
      await updateArtifactFields(projectDir, config, 'task', tf.id, fmUpdate);
    }
    return;
  }

  if (updateOnly) {
    logger.warn(
      `Update-only: skipping task list issue for feature ${f.id} (no existing linearIssueId on task files).`,
    );
    return;
  }
  const initialLabelIds = mergeLabelIds(
    [typeLabelId],
    strategyCtx.strategy === 'label-on' ? strategyCtx.labelId : undefined,
  );
  const c = await createLinearIssue(client, {
    teamId,
    projectId,
    parentId: featureIssueId,
    title,
    description: mergedBody,
    ...(strategyCtx.milestoneId ? { projectMilestoneId: strategyCtx.milestoneId } : {}),
    labelIds: initialLabelIds,
  });
  const synced = new Date().toISOString();
  for (const tf of sf.taskFiles) {
    const fmUpdate: Record<string, string | string[]> = {
      linearIssueId: c.id,
      linearIssueIdentifier: c.identifier,
      linearIssueUrl: c.url,
      linearParentIssueId: featureIssueId,
      linearTaskChecklistSyncedAt: synced,
      linearLabelIds: initialLabelIds,
    };
    if (strategyCtx.milestoneId) fmUpdate.linearProjectMilestoneId = strategyCtx.milestoneId;
    await updateArtifactFields(projectDir, config, 'task', tf.id, fmUpdate);
  }
}

/**
 * Epic-scope push: resolves the mapping strategy (first-time choice persisted,
 * subsequent runs read from frontmatter), creates/updates the Linear container
 * (project + optional milestone or label), and cascades through every feature.
 */
async function pushEpicScope(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  epicId: string,
  updateOnly: boolean,
  teamId: string,
  leadId: string | undefined,
  override: LinearPushOptions['strategyOverride'],
): Promise<LinearPushPlan | null> {
  const scope = await loadLinearPushScope(projectDir, config, epicId);
  if (!scope) {
    throw new Error(`Epic not found: ${epicId}`);
  }
  const { epic, features } = scope;
  const plan = await buildLinearPushPlan(projectDir, config, epicId, { updateOnly });
  if (!plan) return null;

  // Resolve strategy: stored on epic > override > config default > 'project'.
  const stored = epic.linearMappingStrategy;
  const chosen: LinearMappingStrategy =
    stored ?? override?.strategy ?? config.linear?.defaultEpicStrategy ?? 'project';

  // Phase 5 (re-strategize) is out of scope for this release — refuse to
  // silently migrate an epic to a different mapping.
  if (stored && override?.strategy && override.strategy !== stored) {
    throw new Error(
      `Epic ${epic.id} is already mapped as '${stored}'. Re-strategizing to '${override.strategy}' is not supported in this release (planned for Phase 5). Use \`planr linear unlink ${epic.id}\` + re-push once that arrives.`,
    );
  }

  if (updateOnly && !epic.linearProjectId) {
    throw new Error(
      'Cannot use --update-only: this epic has no `linearProjectId` in frontmatter. Run `planr linear push` without --update-only once to create the Linear project.',
    );
  }

  const epicName = epic.title.trim() || epic.id;
  const projectDescription = buildEpicProjectDescription(epic);
  const typeLabelCache = createTypeLabelCache(client, teamId, config);

  let strategyCtx: StrategyContext;

  if (chosen === 'project') {
    let projectId: string;
    if (epic.linearProjectId) {
      const updated = await updateLinearProject(client, epic.linearProjectId, {
        name: epicName,
        description: projectDescription,
        leadId: leadId ?? null,
      });
      projectId = updated.id;
      await updateArtifactFields(projectDir, config, 'epic', epic.id, {
        linearProjectId: updated.id,
        linearProjectIdentifier: updated.identifier,
        linearProjectUrl: updated.url,
        linearMappingStrategy: chosen,
      });
    } else {
      const created = await createLinearProject(client, {
        name: epicName,
        teamIds: [teamId],
        description: projectDescription,
        leadId: leadId ?? null,
      });
      projectId = created.id;
      await updateArtifactFields(projectDir, config, 'epic', epic.id, {
        linearProjectId: created.id,
        linearProjectIdentifier: created.identifier,
        linearProjectUrl: created.url,
        linearMappingStrategy: chosen,
      });
    }
    strategyCtx = { strategy: 'project', projectId };
  } else if (chosen === 'milestone-of') {
    const targetProjectId = epic.linearProjectId ?? override?.targetProjectId;
    if (!targetProjectId) {
      throw new Error(
        `milestone-of strategy requires a Linear project to attach into. Re-run with \`--as milestone-of:<projectId>\`.`,
      );
    }
    let milestoneId = epic.linearMilestoneId;
    if (!milestoneId) {
      const m = await createProjectMilestone(client, {
        projectId: targetProjectId,
        name: epicName,
        description: projectDescription,
      });
      milestoneId = m.id;
    }
    await updateArtifactFields(projectDir, config, 'epic', epic.id, {
      linearProjectId: targetProjectId,
      linearMilestoneId: milestoneId,
      linearMappingStrategy: chosen,
    });
    strategyCtx = { strategy: 'milestone-of', projectId: targetProjectId, milestoneId };
  } else {
    // label-on
    const targetProjectId = epic.linearProjectId ?? override?.targetProjectId;
    if (!targetProjectId) {
      throw new Error(
        `label-on strategy requires a Linear project to attach into. Re-run with \`--as label-on:<projectId>\`.`,
      );
    }
    const label = await ensureIssueLabel(client, {
      teamId,
      name: epicName,
      description: `OpenPlanr epic ${epic.id} (auto-created by \`planr linear push\`).`,
    });
    await updateArtifactFields(projectDir, config, 'epic', epic.id, {
      linearProjectId: targetProjectId,
      linearLabelId: label.id,
      linearMappingStrategy: chosen,
    });
    strategyCtx = { strategy: 'label-on', projectId: targetProjectId, labelId: label.id };
  }

  for (const sf of features) {
    await pushOneFeatureAndDescendants(
      projectDir,
      config,
      client,
      sf,
      strategyCtx,
      typeLabelCache,
      teamId,
      updateOnly,
    );
  }

  // Cascade to any QT / BL artifacts explicitly linked via `epicId: <this epic>`.
  // Unlinked QT/BL stay in their standalone project; only opt-in children are
  // pulled into the epic's Linear container.
  const quicks = await listArtifacts(projectDir, config, 'quick');
  for (const q of quicks.sort(sortByArtifactId)) {
    const art = await readArtifact(projectDir, config, 'quick', q.id);
    if (!art || getLinkedEpicId(art.data) !== epic.id) continue;
    const qt = await loadForQuickTask(projectDir, config, q.id);
    if (!qt) continue;
    await pushOneQuickTaskWithContext(
      projectDir,
      config,
      client,
      qt,
      strategyCtx,
      typeLabelCache,
      teamId,
      updateOnly,
    );
  }
  const backlogs = await listArtifacts(projectDir, config, 'backlog');
  for (const b of backlogs.sort(sortByArtifactId)) {
    const art = await readArtifact(projectDir, config, 'backlog', b.id);
    if (!art || getLinkedEpicId(art.data) !== epic.id) continue;
    const bl = await loadForBacklogItem(projectDir, config, b.id);
    if (!bl) continue;
    await pushOneBacklogItemWithContext(
      projectDir,
      config,
      client,
      bl,
      strategyCtx,
      typeLabelCache,
      teamId,
      updateOnly,
    );
  }

  return plan;
}

/**
 * Feature-scope push: exactly one feature issue + its stories + its tasklist.
 * Requires the parent epic's Linear project to already exist (or `pushParents`).
 */
async function pushFeatureScope(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  featureId: string,
  options: LinearPushOptions,
  teamId: string,
  leadId: string | undefined,
): Promise<LinearPushPlan | null> {
  const ctx = await loadForFeature(projectDir, config, featureId);
  if (!ctx) {
    throw new Error(`Feature not found or has no \`epicId\`: ${featureId}`);
  }
  const updateOnly = options.updateOnly === true;

  if (!ctx.epic.linearProjectId) {
    if (options.pushParents) {
      logger.info(
        `Parent epic ${ctx.epic.id} is not in Linear yet — pushing the full epic first (--push-parents).`,
      );
      return pushEpicScope(
        projectDir,
        config,
        client,
        ctx.epic.id,
        updateOnly,
        teamId,
        leadId,
        options.strategyOverride,
      );
    }
    throw new Error(
      `Parent epic ${ctx.epic.id} has not been pushed to Linear yet. Run \`planr linear push ${ctx.epic.id}\` first, or re-run with \`--push-parents\`.`,
    );
  }

  const strategyCtx = contextFromMappedEpic(ctx.epic, config);
  const typeLabelCache = createTypeLabelCache(client, teamId, config);
  await pushOneFeatureAndDescendants(
    projectDir,
    config,
    client,
    ctx.sf,
    strategyCtx,
    typeLabelCache,
    teamId,
    updateOnly,
  );

  return buildLinearPushPlan(projectDir, config, featureId, { updateOnly });
}

/**
 * Story-scope push: one story sub-issue under an already-mapped feature.
 */
async function pushStoryScope(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  storyId: string,
  options: LinearPushOptions,
  teamId: string,
  leadId: string | undefined,
): Promise<LinearPushPlan | null> {
  const ctx = await loadForStory(projectDir, config, storyId);
  if (!ctx) {
    throw new Error(`Story not found or has no \`featureId\`: ${storyId}`);
  }
  const updateOnly = options.updateOnly === true;

  if (!isUsableLinearIssueId(ctx.sf.data.linearIssueId, `Feature ${ctx.sf.data.id}`)) {
    if (options.pushParents) {
      logger.info(
        `Parent feature ${ctx.sf.data.id} is not in Linear yet — pushing the feature subtree first (--push-parents).`,
      );
      return pushFeatureScope(
        projectDir,
        config,
        client,
        ctx.sf.data.id,
        { ...options, pushParents: true },
        teamId,
        leadId,
      );
    }
    throw new Error(
      `Parent feature ${ctx.sf.data.id} has not been pushed to Linear yet. Run \`planr linear push ${ctx.sf.data.id}\` first, or re-run with \`--push-parents\`.`,
    );
  }

  // Ensure parent epic also has a Linear project — required for the story's `projectId`.
  if (!ctx.epic.linearProjectId) {
    throw new Error(
      `Parent epic ${ctx.epic.id} has no \`linearProjectId\`. Run \`planr linear push ${ctx.epic.id}\` first.`,
    );
  }

  const strategyCtx = contextFromMappedEpic(ctx.epic, config);
  const typeLabelCache = createTypeLabelCache(client, teamId, config);
  const featureIssueId = ctx.sf.data.linearIssueId;
  await pushOneStoryUnderFeature(
    projectDir,
    config,
    client,
    ctx.story.data,
    featureIssueId,
    strategyCtx,
    typeLabelCache,
    teamId,
    updateOnly,
  );

  return buildLinearPushPlan(projectDir, config, storyId, { updateOnly });
}

/**
 * Task-file-scope push: update the single "Tasks for <feature>" sub-issue, merging
 * checkbox bodies across all task files under the same feature (matches epic-scope
 * behavior — one Linear sub-issue per feature regardless of how many task files exist).
 */
async function pushTaskFileScope(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  taskId: string,
  options: LinearPushOptions,
  teamId: string,
  leadId: string | undefined,
): Promise<LinearPushPlan | null> {
  const ctx = await loadForTaskFile(projectDir, config, taskId);
  if (!ctx) {
    throw new Error(`Task file not found or has no \`featureId\`: ${taskId}`);
  }
  const updateOnly = options.updateOnly === true;

  if (!isUsableLinearIssueId(ctx.sf.data.linearIssueId, `Feature ${ctx.sf.data.id}`)) {
    if (options.pushParents) {
      logger.info(
        `Parent feature ${ctx.sf.data.id} is not in Linear yet — pushing the feature subtree first (--push-parents).`,
      );
      return pushFeatureScope(
        projectDir,
        config,
        client,
        ctx.sf.data.id,
        { ...options, pushParents: true },
        teamId,
        leadId,
      );
    }
    throw new Error(
      `Parent feature ${ctx.sf.data.id} has not been pushed to Linear yet. Run \`planr linear push ${ctx.sf.data.id}\` first, or re-run with \`--push-parents\`.`,
    );
  }
  if (!ctx.epic.linearProjectId) {
    throw new Error(
      `Parent epic ${ctx.epic.id} has no \`linearProjectId\`. Run \`planr linear push ${ctx.epic.id}\` first.`,
    );
  }

  const strategyCtx = contextFromMappedEpic(ctx.epic, config);
  const typeLabelCache = createTypeLabelCache(client, teamId, config);
  const featureIssueId = ctx.sf.data.linearIssueId;
  await pushOneTaskListForFeature(
    projectDir,
    config,
    client,
    ctx.sf,
    featureIssueId,
    strategyCtx,
    typeLabelCache,
    teamId,
    updateOnly,
  );

  return buildLinearPushPlan(projectDir, config, taskId, { updateOnly });
}

/**
 * Resolve the Linear container for a QT / BL push:
 *   1. If the artifact has a linked epic (`epicId` / `parentEpic`) and that epic
 *      is already mapped in Linear → reuse the epic's StrategyContext so the
 *      issue inherits project + milestone / label propagation.
 *   2. If the epic is linked but not yet mapped — cascade to `pushEpicScope`
 *      when `--push-parents` is set, otherwise error with a clear pointer.
 *   3. No linked epic → fall back to `config.linear.standaloneProjectId`.
 *   4. Still missing — actionable error (interactive setup or manual config edit).
 *
 * Returns `null` when the caller already pushed a cascaded ancestor (so the
 * caller should short-circuit its own push).
 */
async function resolveQuickOrBacklogContext(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  artifactKind: 'quick' | 'backlog',
  artifactId: string,
  frontmatter: Record<string, unknown>,
  options: LinearPushOptions,
  teamId: string,
  leadId: string | undefined,
): Promise<{ kind: 'cascaded' } | { kind: 'resolved'; ctx: StrategyContext }> {
  const linkedEpicId = getLinkedEpicId(frontmatter);
  if (linkedEpicId) {
    const epicArt = await readArtifact(projectDir, config, 'epic', linkedEpicId);
    if (!epicArt) {
      throw new Error(
        `${artifactKind === 'quick' ? 'Quick task' : 'Backlog item'} ${artifactId} declares epicId "${linkedEpicId}" but no such epic exists locally. Fix the frontmatter or create the epic first.`,
      );
    }
    const epicScope = await loadLinearPushScope(projectDir, config, linkedEpicId);
    if (!epicScope) {
      throw new Error(`Failed to load epic ${linkedEpicId} for push context.`);
    }
    if (!epicScope.epic.linearProjectId) {
      if (options.pushParents) {
        logger.info(
          `Parent epic ${linkedEpicId} is not in Linear yet — pushing the full epic first (--push-parents).`,
        );
        await pushEpicScope(
          projectDir,
          config,
          client,
          linkedEpicId,
          options.updateOnly === true,
          teamId,
          leadId,
          options.strategyOverride,
        );
        // The cascade re-pushes every linked QT/BL, including this one.
        return { kind: 'cascaded' };
      }
      throw new Error(
        `${artifactId} is linked to epic ${linkedEpicId}, which has not been pushed to Linear yet. Run \`planr linear push ${linkedEpicId}\` first, or re-run with \`--push-parents\`.`,
      );
    }
    return { kind: 'resolved', ctx: contextFromMappedEpic(epicScope.epic, config) };
  }

  // No linked epic — fall back to the standalone project.
  const standaloneId = config.linear?.standaloneProjectId;
  if (!standaloneId) {
    throw new Error(
      `No Linear container resolved for ${artifactId}: no \`epicId\` on the artifact and no \`linear.standaloneProjectId\` configured. Either add \`epicId: "EPIC-XXX"\` to the frontmatter (and push that epic first), or run \`planr linear push ${artifactId}\` interactively once to pick a standalone project, or set \`linear.standaloneProjectId\` in \`.planr/config.json\`.`,
    );
  }
  return { kind: 'resolved', ctx: { strategy: 'project', projectId: standaloneId } };
}

/**
 * Internal worker: create-or-update one quick-task Linear issue using a
 * pre-resolved StrategyContext. Used by both the QT-scope entry point and
 * the epic-cascade path (which already has the context in hand).
 */
async function pushOneQuickTaskWithContext(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  qt: ScopedStandaloneArtifact,
  ctx: StrategyContext,
  typeLabelCache: (type: LinearLabeledArtifactType) => Promise<string>,
  teamId: string,
  updateOnly: boolean,
): Promise<void> {
  const parsed = parseTaskMarkdown(qt.raw);
  const body = parsed.length > 0 ? formatTaskCheckboxBody(parsed) : '';
  const title = qt.title.trim();
  const typeLabelId = await typeLabelCache('quick');
  const rawExistingId = toOptionalString(qt.frontmatter.linearIssueId);
  const existingId = isUsableLinearIssueId(rawExistingId, `QuickTask ${qt.id}`)
    ? rawExistingId
    : undefined;

  if (existingId) {
    const existingLabels = await readExistingLabelIds(client, existingId);
    const labelIds = mergeLabelIds(
      mergeLabelIds(existingLabels, typeLabelId),
      ctx.strategy === 'label-on' ? ctx.labelId : undefined,
    );
    const u = await updateLinearIssue(client, existingId, {
      title,
      description: body,
      projectId: ctx.projectId,
      teamId,
      projectMilestoneId: ctx.milestoneId ?? null,
      labelIds,
    });
    const fmUpdate: Record<string, string | string[]> = {
      linearIssueId: u.id,
      linearIssueIdentifier: u.identifier,
      linearIssueUrl: u.url,
      linearLabelIds: labelIds,
    };
    if (ctx.milestoneId) fmUpdate.linearProjectMilestoneId = ctx.milestoneId;
    await updateArtifactFields(projectDir, config, 'quick', qt.id, fmUpdate);
    return;
  }
  if (updateOnly) {
    logger.warn(`Update-only: skipping quick task ${qt.id} (no linearIssueId).`);
    return;
  }
  const initialLabelIds = mergeLabelIds(
    [typeLabelId],
    ctx.strategy === 'label-on' ? ctx.labelId : undefined,
  );
  const c = await createLinearIssue(client, {
    teamId,
    projectId: ctx.projectId,
    title,
    description: body,
    ...(ctx.milestoneId ? { projectMilestoneId: ctx.milestoneId } : {}),
    labelIds: initialLabelIds,
  });
  const fmUpdate: Record<string, string | string[]> = {
    linearIssueId: c.id,
    linearIssueIdentifier: c.identifier,
    linearIssueUrl: c.url,
    linearLabelIds: initialLabelIds,
  };
  if (ctx.milestoneId) fmUpdate.linearProjectMilestoneId = ctx.milestoneId;
  await updateArtifactFields(projectDir, config, 'quick', qt.id, fmUpdate);
}

/**
 * Internal worker: create-or-update one backlog-item Linear issue. Always
 * carries the team-scoped `backlog` label; merges the epic's `label-on`
 * label when applicable (and preserves any user-added labels on update).
 */
async function pushOneBacklogItemWithContext(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  bl: ScopedStandaloneArtifact,
  ctx: StrategyContext,
  typeLabelCache: (type: LinearLabeledArtifactType) => Promise<string>,
  teamId: string,
  updateOnly: boolean,
): Promise<void> {
  const title = bl.title.trim();
  const body = buildBacklogItemBody(bl);
  const typeLabelId = await typeLabelCache('backlog');
  const rawExistingId = toOptionalString(bl.frontmatter.linearIssueId);
  const existingId = isUsableLinearIssueId(rawExistingId, `Backlog ${bl.id}`)
    ? rawExistingId
    : undefined;

  if (existingId) {
    const existingLabels = await readExistingLabelIds(client, existingId);
    const labelIds = mergeLabelIds(
      mergeLabelIds(existingLabels, typeLabelId),
      ctx.strategy === 'label-on' ? ctx.labelId : undefined,
    );
    const u = await updateLinearIssue(client, existingId, {
      title,
      description: body,
      projectId: ctx.projectId,
      teamId,
      labelIds,
      projectMilestoneId: ctx.milestoneId ?? null,
    });
    const fmUpdate: Record<string, string | string[]> = {
      linearIssueId: u.id,
      linearIssueIdentifier: u.identifier,
      linearIssueUrl: u.url,
      linearLabelIds: labelIds,
    };
    if (ctx.milestoneId) fmUpdate.linearProjectMilestoneId = ctx.milestoneId;
    await updateArtifactFields(projectDir, config, 'backlog', bl.id, fmUpdate);
    return;
  }
  if (updateOnly) {
    logger.warn(`Update-only: skipping backlog item ${bl.id} (no linearIssueId).`);
    return;
  }
  const initialLabelIds = mergeLabelIds(
    [typeLabelId],
    ctx.strategy === 'label-on' ? ctx.labelId : undefined,
  );
  const c = await createLinearIssue(client, {
    teamId,
    projectId: ctx.projectId,
    title,
    description: body,
    labelIds: initialLabelIds,
    ...(ctx.milestoneId ? { projectMilestoneId: ctx.milestoneId } : {}),
  });
  const fmUpdate: Record<string, string | string[]> = {
    linearIssueId: c.id,
    linearIssueIdentifier: c.identifier,
    linearIssueUrl: c.url,
    linearLabelIds: initialLabelIds,
  };
  if (ctx.milestoneId) fmUpdate.linearProjectMilestoneId = ctx.milestoneId;
  await updateArtifactFields(projectDir, config, 'backlog', bl.id, fmUpdate);
}

/**
 * QT-scope entry point: resolve the Linear container via linked epic or the
 * standalone fallback, then push the single issue.
 */
async function pushQuickTaskScope(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  qtId: string,
  options: LinearPushOptions,
  teamId: string,
  leadId: string | undefined,
): Promise<LinearPushPlan | null> {
  const updateOnly = options.updateOnly === true;
  const qt = await loadForQuickTask(projectDir, config, qtId);
  if (!qt) {
    throw new Error(`Quick task not found: ${qtId}`);
  }
  const resolved = await resolveQuickOrBacklogContext(
    projectDir,
    config,
    client,
    'quick',
    qtId,
    qt.frontmatter,
    options,
    teamId,
    leadId,
  );
  if (resolved.kind === 'cascaded') {
    // Epic cascade already pushed this QT — just return the scope-1 plan.
    return buildLinearPushPlan(projectDir, config, qtId, { updateOnly });
  }
  const typeLabelCache = createTypeLabelCache(client, teamId, config);
  await pushOneQuickTaskWithContext(
    projectDir,
    config,
    client,
    qt,
    resolved.ctx,
    typeLabelCache,
    teamId,
    updateOnly,
  );
  return buildLinearPushPlan(projectDir, config, qtId, { updateOnly });
}

/**
 * BL-scope entry point: same resolution order as QT, plus the mandatory
 * `backlog` label.
 */
async function pushBacklogItemScope(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  blId: string,
  options: LinearPushOptions,
  teamId: string,
  leadId: string | undefined,
): Promise<LinearPushPlan | null> {
  const updateOnly = options.updateOnly === true;
  const bl = await loadForBacklogItem(projectDir, config, blId);
  if (!bl) {
    throw new Error(`Backlog item not found: ${blId}`);
  }
  const resolved = await resolveQuickOrBacklogContext(
    projectDir,
    config,
    client,
    'backlog',
    blId,
    bl.frontmatter,
    options,
    teamId,
    leadId,
  );
  if (resolved.kind === 'cascaded') {
    return buildLinearPushPlan(projectDir, config, blId, { updateOnly });
  }
  const typeLabelCache = createTypeLabelCache(client, teamId, config);
  await pushOneBacklogItemWithContext(
    projectDir,
    config,
    client,
    bl,
    resolved.ctx,
    typeLabelCache,
    teamId,
    updateOnly,
  );
  return buildLinearPushPlan(projectDir, config, blId, { updateOnly });
}

/**
 * Granular push entry point: dispatches on the artifact-id prefix. Accepts any
 * supported artifact type (EPIC/FEAT/US/TASK); errors with an actionable
 * message for types that are not pushable (ADR/SPRINT/checklist) or not yet
 * supported in this release (QT/BL — arrives in Phase 3).
 */
export async function runLinearPush(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  artifactId: string,
  options?: LinearPushOptions,
): Promise<LinearPushPlan | null> {
  const teamId = config.linear?.teamId;
  if (!teamId) {
    throw new Error('`linear.teamId` is not set. Run `planr linear init` first.');
  }
  const leadId = config.linear?.defaultProjectLead;
  const opts: LinearPushOptions = options ?? {};
  const updateOnly = opts.updateOnly === true;

  const type = findArtifactTypeById(artifactId);
  if (!type) {
    throw new Error(
      `Unknown artifact id: ${artifactId}. Expected an EPIC-/FEAT-/US-/TASK- prefix.`,
    );
  }
  if (type === 'sprint' || type === 'adr' || type === 'checklist') {
    throw new Error(
      `planr linear push does not support ${type}s in this release. Push its parent epic instead: planr linear push <EPIC-ID>.`,
    );
  }

  if (type === 'epic') {
    return pushEpicScope(
      projectDir,
      config,
      client,
      artifactId,
      updateOnly,
      teamId,
      leadId,
      opts.strategyOverride,
    );
  }
  if (type === 'feature') {
    return pushFeatureScope(projectDir, config, client, artifactId, opts, teamId, leadId);
  }
  if (type === 'story') {
    return pushStoryScope(projectDir, config, client, artifactId, opts, teamId, leadId);
  }
  if (type === 'task') {
    return pushTaskFileScope(projectDir, config, client, artifactId, opts, teamId, leadId);
  }
  if (type === 'quick') {
    return pushQuickTaskScope(projectDir, config, client, artifactId, opts, teamId, leadId);
  }
  if (type === 'backlog') {
    return pushBacklogItemScope(projectDir, config, client, artifactId, opts, teamId, leadId);
  }
  return null;
}
