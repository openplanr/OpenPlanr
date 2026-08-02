/**
 * Pure markdown body/description formatters for Linear issues and projects.
 *
 * Every function here takes local OpenPlanr artifact data and returns the
 * string that goes into the Linear entity's `description` / `title` field.
 * Stateless + side-effect free except for `buildMergedTaskListBody`, which
 * reads task files via the artifact-service to assemble a feature's
 * aggregated checkbox body.
 */
import { type ParsedSubtask } from '../../agents/task-parser.js';
import type { Epic, Feature, OpenPlanrConfig, UserStory } from '../../models/types.js';
/** Convert an unknown frontmatter value to an optional string at the type boundary. */
export declare function toOptionalString(v: unknown): string | undefined;
/** Convert an unknown frontmatter value to an optional array of strings. */
export declare function toOptionalStringArray(v: unknown): string[] | undefined;
/** Epic → Linear Project `description` (markdown). Skips whitespace-only sections. */
export declare function buildEpicProjectDescription(epic: Epic): string;
/** Feature → Linear issue body (overview + functional requirements bullets). */
export declare function buildFeatureIssueBody(feature: Feature): string;
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
export declare function buildStoryIssueBody(story: UserStory, gherkinContent?: string | null): string;
/** Render parsed task lines to markdown checkboxes (Linear description). */
export declare function formatTaskCheckboxBody(parsed: ParsedSubtask[]): string;
/**
 * Build a merged task-list body for a feature — concatenates every task
 * artifact whose `featureId` matches, parses its checkboxes, renders them,
 * and (when multiple files exist) prefixes each section with its task id
 * as an `## h2`. Returns `''` when there's nothing to sync.
 */
export declare function buildMergedTaskListBody(projectDir: string, config: OpenPlanrConfig, featureId: string, taskFiles: Array<{
    id: string;
    title: string;
}>): Promise<string>;
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
export declare function buildStandaloneArtifactBody(raw: string, id: string): string;
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
export declare function buildBacklogItemBody(bl: {
    id: string;
    raw: string;
}): string;
//# sourceMappingURL=body-formatters.d.ts.map