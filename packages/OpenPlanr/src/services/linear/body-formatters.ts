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

/** Epic → Linear Project `description` (markdown). Skips whitespace-only sections. */
export function buildEpicProjectDescription(epic: Epic): string {
  const lines: string[] = [];
  const section = (label: string, value: string | undefined): void => {
    const trimmed = value?.trim();
    if (trimmed) lines.push(`**${label}**\n\n${trimmed}`);
  };
  section('Business value', epic.businessValue);
  section('Problem', epic.problemStatement);
  section('Solution', epic.solutionOverview);
  section('Success criteria', epic.successCriteria);
  section('Target users', epic.targetUsers);
  section('Risks', epic.risks);
  section('Dependencies', epic.dependencies);
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

/**
 * User story → Linear sub-issue body.
 *
 * Composes, in order:
 *   1. The "As a / I want / So that" sentence — only when all three fields
 *      are present (otherwise rendering with blanks produces visible
 *      garbage in Linear).
 *   2. The frontmatter `acceptanceCriteria` prose — if set.
 *   3. The Gherkin scenarios from `<storyId>-gherkin.feature` — if the
 *      caller provides them. Stories in the OpenPlanr convention store
 *      their real acceptance criteria as Gherkin in a sibling `.feature`
 *      file; without this, the Linear issue was empty for every story
 *      that followed the convention.
 */
export function buildStoryIssueBody(story: UserStory, gherkinContent?: string | null): string {
  const role = story.role?.trim();
  const goal = story.goal?.trim();
  const benefit = story.benefit?.trim();
  const ac = story.acceptanceCriteria?.trim();
  const gherkin = gherkinContent?.trim();
  const hasFullUserStoryLine = Boolean(role && goal && benefit);
  const sections: string[] = [];
  if (hasFullUserStoryLine) {
    sections.push(`As a **${role}**, I want **${goal}** so that **${benefit}**.`);
  }
  if (ac) sections.push(`**Acceptance criteria**\n\n${ac}`);
  if (gherkin) sections.push(`**Gherkin scenarios**\n\n\`\`\`gherkin\n${gherkin}\n\`\`\``);
  return sections.join('\n\n');
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
 * Extract the markdown body of a standalone artifact (QT / BL) for pushing
 * to Linear as an issue description.
 *
 * Strips:
 *   - the frontmatter block (YAML between the `---` markers)
 *   - the top-level `# <ID>: <title>` heading (Linear shows the title
 *     separately, so repeating it in the description is noise)
 *
 * Everything else — prose, sub-headings, checkbox lists — is preserved
 * verbatim. Linear renders standard markdown, so checkboxes stay checkboxes,
 * `## sections` stay sections, links stay clickable.
 */
export function buildStandaloneArtifactBody(raw: string, id: string): string {
  // Strip frontmatter if present.
  let body = raw;
  const fmMatch = /^---[^\S\r\n]*\r?\n[\s\S]*?\r?\n---[^\S\r\n]*\r?\n?/.exec(raw);
  if (fmMatch) {
    body = raw.slice(fmMatch[0].length);
  }
  // Drop leading blank lines — markdown files typically have a blank line
  // between the frontmatter's closing `---` and the first `#` heading.
  body = body.replace(/^\s*\r?\n/, '').trimStart();
  // Strip a single top-level `# <ID>:...` or `# <anything>` heading at the
  // start of the body, plus the blank line that typically follows it.
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const titleHeadingRegex = new RegExp(`^#\\s+(?:${escapedId}:\\s*)?.*\\r?\\n(?:\\r?\\n)?`);
  body = body.replace(titleHeadingRegex, '');
  return body.trimEnd();
}

/**
 * Backlog item → Linear issue body.
 *
 * Mirrors the QT push pattern: take the full markdown body (minus
 * frontmatter and the top-level `# <ID>: <title>` heading) so the
 * description, acceptance criteria, and notes the user authored under
 * `## Description` / `## Acceptance Criteria` / `## Notes` all land in
 * Linear. The previous version of this function read those sections from
 * frontmatter — but the BL template only writes them into the body —
 * so Linear issues consistently arrived with just Priority + Tags and
 * nothing else.
 *
 * Also strips the trailing `_Promote to agile hierarchy:..._` helper,
 * which has no value in the Linear issue.
 */
export function buildBacklogItemBody(bl: { id: string; raw: string }): string {
  const fullBody = buildStandaloneArtifactBody(bl.raw, bl.id);
  const withoutPromoteHint = fullBody.replace(/\n*---\n+_Promote to agile hierarchy:[\s\S]*$/, '');
  return withoutPromoteHint.trim();
}
