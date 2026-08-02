/**
 * Pure data loaders that hydrate OpenPlanr artifacts into the shapes the
 * Linear push expects. No Linear API calls, no mutations — just filesystem
 * reads + frontmatter parsing. Every scope-level push function routes
 * through one of these loaders first.
 */
import type { Epic, Feature, OpenPlanrConfig, UserStory } from '../../models/types.js';
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
export declare function loadLinearPushScope(projectDir: string, config: OpenPlanrConfig, epicId: string): Promise<{
    epic: Epic;
    features: ScopedFeature[];
} | null>;
/**
 * Parent-chain context needed to push a feature: the feature itself (with
 * its stories and task files) plus its parent epic. Returns `null` if the
 * feature can't be resolved or has no valid `epicId` pointer.
 */
export declare function loadForFeature(projectDir: string, config: OpenPlanrConfig, featureId: string): Promise<{
    epic: Epic;
    sf: ScopedFeature;
} | null>;
/**
 * Parent-chain context needed to push a story: the story itself, its
 * feature (with sibling stories + tasklists) and the containing epic.
 * Returns `null` if any link in the chain is missing.
 */
export declare function loadForStory(projectDir: string, config: OpenPlanrConfig, storyId: string): Promise<{
    epic: Epic;
    sf: ScopedFeature;
    story: ScopedStory;
} | null>;
/**
 * Parent-chain context needed to push a task file: the containing feature
 * (with all its task files merged into one Linear sub-issue body) and the
 * epic.
 */
export declare function loadForTaskFile(projectDir: string, config: OpenPlanrConfig, taskId: string): Promise<{
    epic: Epic;
    sf: ScopedFeature;
} | null>;
export declare function loadForQuickTask(projectDir: string, config: OpenPlanrConfig, qtId: string): Promise<ScopedStandaloneArtifact | null>;
export declare function loadForBacklogItem(projectDir: string, config: OpenPlanrConfig, blId: string): Promise<ScopedStandaloneArtifact | null>;
//# sourceMappingURL=scope-loaders.d.ts.map