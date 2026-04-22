/**
 * Pure markdown body/description formatters for Linear issues and projects.
 *
 * Every function here takes local OpenPlanr artifact data and returns the
 * string that goes into the Linear entity's `description` / `title` field.
 * Stateless + side-effect free except for `buildMergedTaskListBody`, which
 * reads task files via the artifact-service to assemble a feature's
 * aggregated checkbox body.
 */

import { type ParsedSubtask, parseTaskMarkdown } from '../../agents/task-parser.js';
import type { Epic, Feature, OpenPlanrConfig, UserStory } from '../../models/types.js';
import { readArtifact, readArtifactRaw } from '../artifact-service.js';

/** Convert an unknown frontmatter value to an optional string at the type boundary. */
export function toOptionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Convert an unknown frontmatter value to an optional array of strings. */
export function toOptionalStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((item): item is string => typeof item === 'string');
  return out.length > 0 ? out : undefined;
}

/** Epic → Linear Project `description` (markdown). */
export function buildEpicProjectDescription(epic: Epic): string {
  const lines: string[] = [];
  if (epic.businessValue) lines.push(`**Business value**\n\n${epic.businessValue.trim()}`);
  if (epic.problemStatement) lines.push(`**Problem**\n\n${epic.problemStatement.trim()}`);
  if (epic.solutionOverview) lines.push(`**Solution**\n\n${epic.solutionOverview.trim()}`);
  if (epic.successCriteria) lines.push(`**Success criteria**\n\n${epic.successCriteria.trim()}`);
  if (epic.targetUsers) lines.push(`**Target users**\n\n${epic.targetUsers.trim()}`);
  if (epic.risks) lines.push(`**Risks**\n\n${epic.risks.trim()}`);
  if (epic.dependencies) lines.push(`**Dependencies**\n\n${epic.dependencies.trim()}`);
  return lines.join('\n\n');
}

/** Feature → Linear issue body (overview + functional requirements bullets). */
export function buildFeatureIssueBody(feature: Feature): string {
  const lines: string[] = [feature.overview?.trim() || ''];
  if (feature.functionalRequirements?.length) {
    lines.push('**Functional requirements**');
    for (const r of feature.functionalRequirements) {
      lines.push(`- ${r}`);
    }
  }
  return lines.filter(Boolean).join('\n\n');
}

/** User story → Linear sub-issue body (As a / I want / So that + acceptance criteria). */
export function buildStoryIssueBody(story: UserStory): string {
  const head = `As a **${story.role}**, I want **${story.goal}** so that **${story.benefit}**.`;
  const ac = story.acceptanceCriteria?.trim();
  if (!ac) return head;
  return `${head}\n\n**Acceptance criteria**\n\n${ac}`;
}

/** Render parsed task lines to markdown checkboxes (Linear description). */
export function formatTaskCheckboxBody(parsed: ParsedSubtask[]): string {
  if (parsed.length === 0) return '';
  return parsed
    .map((p) => {
      const mark = p.done ? 'x' : ' ';
      if (p.depth === 0) {
        return `- [${mark}] **${p.id}** ${p.title}`;
      }
      return `  - [${mark}] ${p.id} ${p.title}`;
    })
    .join('\n');
}

/**
 * Build a merged task-list body for a feature — concatenates every task
 * artifact whose `featureId` matches, parses its checkboxes, renders them,
 * and (when multiple files exist) prefixes each section with its task id
 * as an `## h2`. Returns `''` when there's nothing to sync.
 */
export async function buildMergedTaskListBody(
  projectDir: string,
  config: OpenPlanrConfig,
  featureId: string,
  taskFiles: Array<{ id: string; title: string }>,
): Promise<string> {
  const sections: string[] = [];
  const sorted = [...taskFiles].sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
  for (const tf of sorted) {
    const raw = await readArtifactRaw(projectDir, config, 'task', tf.id);
    if (!raw) continue;
    const data = (await readArtifact(projectDir, config, 'task', tf.id))?.data;
    const fId = toOptionalString(data?.featureId);
    if (fId !== featureId) continue;
    const parsed = parseTaskMarkdown(raw);
    if (parsed.length === 0) continue;
    const body = formatTaskCheckboxBody(parsed);
    if (taskFiles.length > 1) {
      sections.push(`## ${tf.id}\n\n${body}`);
    } else {
      sections.push(body);
    }
  }
  return sections.join('\n\n');
}

/**
 * Backlog item → Linear issue body. Priority + tags + description + optional
 * acceptance criteria + notes. Accepts the generic frontmatter record shape
 * because backlog items aren't currently loaded via a typed interface.
 */
export function buildBacklogItemBody(bl: { frontmatter: Record<string, unknown> }): string {
  const fm = bl.frontmatter;
  const lines: string[] = [];
  const priority = toOptionalString(fm.priority);
  if (priority) lines.push(`**Priority:** ${priority}`);
  if (Array.isArray(fm.tags) && fm.tags.length > 0) {
    const tags = (fm.tags as unknown[]).filter((t): t is string => typeof t === 'string');
    if (tags.length) lines.push(`**Tags:** ${tags.join(', ')}`);
  }
  const description = toOptionalString(fm.description);
  if (description) lines.push(description.trim());
  const ac = toOptionalString(fm.acceptanceCriteria);
  if (ac) lines.push(`**Acceptance criteria**\n\n${ac.trim()}`);
  const notes = toOptionalString(fm.notes);
  if (notes) lines.push(`**Notes**\n\n${notes.trim()}`);
  return lines.join('\n\n');
}
