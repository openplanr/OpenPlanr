/**
 * Pure data loaders that hydrate OpenPlanr artifacts into the shapes the
 * Linear push expects. No Linear API calls, no mutations — just filesystem
 * reads + frontmatter parsing. Every scope-level push function routes
 * through one of these loaders first.
 */

import type { Epic, Feature, OpenPlanrConfig, TaskStatus, UserStory } from '../../models/types.js';
import { listArtifacts, readArtifact, readArtifactRaw } from '../artifact-service.js';
import { toOptionalString, toOptionalStringArray } from './body-formatters.js';
import { toOptionalStrategy } from './strategy-context.js';

function sortByArtifactId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id, undefined, { numeric: true });
}

function asTaskStatus(s: unknown): TaskStatus {
  if (s === 'pending' || s === 'in-progress' || s === 'done') return s;
  return 'pending';
}

function nowIso(): string {
  return new Date().toISOString().split('T')[0];
}

export interface ScopedTaskFile {
  id: string;
  title: string;
}

export interface ScopedStory {
  id: string;
  title: string;
  data: UserStory;
  /** Raw YAML frontmatter — carries fields not mapped onto the typed `data`
   * (e.g. `estimatedPoints`, `storyPoints` for Linear estimate sync). */
  frontmatter: Record<string, unknown>;
}

export interface ScopedFeature {
  id: string;
  title: string;
  data: Feature;
  /** Raw YAML frontmatter — same purpose as ScopedStory.frontmatter. */
  frontmatter: Record<string, unknown>;
  stories: ScopedStory[];
  taskFiles: ScopedTaskFile[];
}

/**
 * Shape needed to push a standalone artifact (QT or BL) — the raw markdown
 * (so QT can parse + re-render its checkbox list) plus the frontmatter
 * record (linear* fields, epicId link, etc.).
 */
export interface ScopedStandaloneArtifact {
  id: string;
  title: string;
  raw: string;
  frontmatter: Record<string, unknown>;
}

/**
 * Load the full epic subtree (epic frontmatter + features + stories per
 * feature + task-file ids per feature). Filters by `epicId` on each child
 * artifact.
 */
export async function loadLinearPushScope(
  projectDir: string,
  config: OpenPlanrConfig,
  epicId: string,
): Promise<{ epic: Epic; features: ScopedFeature[] } | null> {
  const epicArt = await readArtifact(projectDir, config, 'epic', epicId);
  if (!epicArt) return null;
  const d = epicArt.data;
  const epic: Epic = {
    id: (d.id as string) || epicId,
    title: (d.title as string) || '',
    createdAt: (d.createdAt as string) || (d.created as string) || nowIso(),
    updatedAt: (d.updatedAt as string) || (d.updated as string) || nowIso(),
    filePath: epicArt.filePath,
    owner: (d.owner as string) || '',
    businessValue: (d.businessValue as string) || '',
    targetUsers: (d.targetUsers as string) || '',
    problemStatement: (d.problemStatement as string) || '',
    solutionOverview: (d.solutionOverview as string) || '',
    successCriteria: (d.successCriteria as string) || '',
    keyFeatures: (d.keyFeatures as string[]) || [],
    dependencies: (d.dependencies as string) || '',
    risks: (d.risks as string) || '',
    featureIds: (d.featureIds as string[]) || [],
    linearProjectId: toOptionalString(d.linearProjectId),
    linearProjectIdentifier: toOptionalString(d.linearProjectIdentifier),
    linearProjectUrl: toOptionalString(d.linearProjectUrl),
    linearMappingStrategy: toOptionalStrategy(d.linearMappingStrategy),
    linearMilestoneId: toOptionalString(d.linearMilestoneId),
    linearLabelId: toOptionalString(d.linearLabelId),
  };

  const allFeatures = (await listArtifacts(projectDir, config, 'feature')).sort(sortByArtifactId);
  const allStories = (await listArtifacts(projectDir, config, 'story')).sort(sortByArtifactId);
  const allTasks = (await listArtifacts(projectDir, config, 'task')).sort(sortByArtifactId);

  const featuresUnderEpic: ScopedFeature[] = [];

  for (const f of allFeatures) {
    const a = await readArtifact(projectDir, config, 'feature', f.id);
    if (!a || (a.data.epicId as string) !== epicId) continue;
    const fd = a.data;
    const feature: Feature = {
      id: (fd.id as string) || f.id,
      title: (fd.title as string) || f.title,
      createdAt: (fd.createdAt as string) || (fd.created as string) || nowIso(),
      updatedAt: (fd.updatedAt as string) || (fd.updated as string) || nowIso(),
      filePath: a.filePath,
      epicId: fd.epicId as string,
      owner: (fd.owner as string) || '',
      status: asTaskStatus(fd.status),
      overview: (fd.overview as string) || '',
      functionalRequirements: (fd.functionalRequirements as string[]) || [],
      storyIds: (fd.storyIds as string[]) || [],
      linearIssueId: toOptionalString(fd.linearIssueId),
      linearIssueIdentifier: toOptionalString(fd.linearIssueIdentifier),
      linearIssueUrl: toOptionalString(fd.linearIssueUrl),
      linearProjectMilestoneId: toOptionalString(fd.linearProjectMilestoneId),
      linearLabelIds: toOptionalStringArray(fd.linearLabelIds),
    };

    const stories: ScopedStory[] = [];
    for (const s of allStories) {
      const st = await readArtifact(projectDir, config, 'story', s.id);
      if (!st || (st.data.featureId as string) !== feature.id) continue;
      const sd = st.data;
      const story: UserStory = {
        id: (sd.id as string) || s.id,
        title: (sd.title as string) || s.title,
        createdAt: (sd.createdAt as string) || (sd.created as string) || nowIso(),
        updatedAt: (sd.updatedAt as string) || (sd.updated as string) || nowIso(),
        filePath: st.filePath,
        featureId: sd.featureId as string,
        status: asTaskStatus(sd.status),
        role: (sd.role as string) || '',
        goal: (sd.goal as string) || '',
        benefit: (sd.benefit as string) || '',
        acceptanceCriteria: (sd.acceptanceCriteria as string) || '',
        additionalNotes: toOptionalString(sd.additionalNotes),
        linearIssueId: toOptionalString(sd.linearIssueId),
        linearIssueIdentifier: toOptionalString(sd.linearIssueIdentifier),
        linearIssueUrl: toOptionalString(sd.linearIssueUrl),
        linearParentIssueId: toOptionalString(sd.linearParentIssueId),
        linearProjectMilestoneId: toOptionalString(sd.linearProjectMilestoneId),
        linearLabelIds: toOptionalStringArray(sd.linearLabelIds),
      };
      stories.push({
        id: story.id,
        title: story.title,
        data: story,
        frontmatter: sd as Record<string, unknown>,
      });
    }

    const taskFiles: ScopedTaskFile[] = [];
    for (const t of allTasks) {
      const ta = await readArtifact(projectDir, config, 'task', t.id);
      const pfeat = toOptionalString(ta?.data.featureId);
      if (pfeat === feature.id) {
        taskFiles.push({ id: t.id, title: t.title });
      }
    }

    featuresUnderEpic.push({
      id: feature.id,
      title: feature.title,
      data: feature,
      frontmatter: fd as Record<string, unknown>,
      stories,
      taskFiles,
    });
  }

  return { epic, features: featuresUnderEpic };
}

/**
 * Parent-chain context needed to push a feature: the feature itself (with
 * its stories and task files) plus its parent epic. Returns `null` if the
 * feature can't be resolved or has no valid `epicId` pointer.
 */
export async function loadForFeature(
  projectDir: string,
  config: OpenPlanrConfig,
  featureId: string,
): Promise<{ epic: Epic; sf: ScopedFeature } | null> {
  const featureArt = await readArtifact(projectDir, config, 'feature', featureId);
  if (!featureArt) return null;
  const parentEpicId = toOptionalString(featureArt.data.epicId);
  if (!parentEpicId) return null;
  const epicScope = await loadLinearPushScope(projectDir, config, parentEpicId);
  if (!epicScope) return null;
  const sf = epicScope.features.find((f) => f.id === featureId);
  if (!sf) return null;
  return { epic: epicScope.epic, sf };
}

/**
 * Parent-chain context needed to push a story: the story itself, its
 * feature (with sibling stories + tasklists) and the containing epic.
 * Returns `null` if any link in the chain is missing.
 */
export async function loadForStory(
  projectDir: string,
  config: OpenPlanrConfig,
  storyId: string,
): Promise<{
  epic: Epic;
  sf: ScopedFeature;
  story: ScopedStory;
} | null> {
  const storyArt = await readArtifact(projectDir, config, 'story', storyId);
  if (!storyArt) return null;
  const parentFeatureId = toOptionalString(storyArt.data.featureId);
  if (!parentFeatureId) return null;
  const ctx = await loadForFeature(projectDir, config, parentFeatureId);
  if (!ctx) return null;
  const story = ctx.sf.stories.find((s) => s.id === storyId);
  if (!story) return null;
  return { epic: ctx.epic, sf: ctx.sf, story };
}

/**
 * Parent-chain context needed to push a task file: the containing feature
 * (with all its task files merged into one Linear sub-issue body) and the
 * epic.
 */
export async function loadForTaskFile(
  projectDir: string,
  config: OpenPlanrConfig,
  taskId: string,
): Promise<{ epic: Epic; sf: ScopedFeature } | null> {
  const taskArt = await readArtifact(projectDir, config, 'task', taskId);
  if (!taskArt) return null;
  const parentFeatureId = toOptionalString(taskArt.data.featureId);
  if (!parentFeatureId) return null;
  return loadForFeature(projectDir, config, parentFeatureId);
}

/**
 * Frontmatter sanity check for standalone artifacts. Every pushable file
 * MUST have at least a real `title` — otherwise we end up creating a
 * Linear issue whose title is just the artifact id (e.g. "QT-015"), and
 * then the subsequent `updateArtifactFields` write-back fails because the
 * file's frontmatter block is malformed. Bail here, before any API call,
 * so the Linear side stays clean.
 */
function requireFrontmatter(
  kind: 'Quick task' | 'Backlog item',
  id: string,
  filePath: string,
  data: Record<string, unknown>,
): void {
  const title = toOptionalString(data.title);
  if (!title) {
    throw new Error(
      `${kind} ${id} has no \`title\` field in its frontmatter.\n  ${filePath}\n  Fix the file's frontmatter (must be a \`---\`-delimited YAML block with at least \`id\` and \`title\`) and re-run. No changes were pushed to Linear.`,
    );
  }
}

export async function loadForQuickTask(
  projectDir: string,
  config: OpenPlanrConfig,
  qtId: string,
): Promise<ScopedStandaloneArtifact | null> {
  const art = await readArtifact(projectDir, config, 'quick', qtId);
  if (!art) return null;
  requireFrontmatter('Quick task', qtId, art.filePath, art.data);
  const raw = (await readArtifactRaw(projectDir, config, 'quick', qtId)) ?? '';
  return {
    id: (art.data.id as string) || qtId,
    title: art.data.title as string,
    raw,
    frontmatter: art.data,
  };
}

export async function loadForBacklogItem(
  projectDir: string,
  config: OpenPlanrConfig,
  blId: string,
): Promise<ScopedStandaloneArtifact | null> {
  const art = await readArtifact(projectDir, config, 'backlog', blId);
  if (!art) return null;
  requireFrontmatter('Backlog item', blId, art.filePath, art.data);
  const raw = (await readArtifactRaw(projectDir, config, 'backlog', blId)) ?? '';
  return {
    id: (art.data.id as string) || blId,
    title: art.data.title as string,
    raw,
    frontmatter: art.data,
  };
}
