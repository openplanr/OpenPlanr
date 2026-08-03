/**
 * Shared artifact-gathering utilities for task generation prompts.
 *
 * Collects all related artifacts (stories, gherkin, ADRs, epic, feature)
 * into a single context object that `buildTasksPrompt()` consumes.
 */
import type { OpenPlanrConfig } from '../models/types.js';
export interface TasksPromptContext {
    /** One or more user stories to generate tasks from. */
    stories: Array<{
        id: string;
        raw: string;
    }>;
    /** Gherkin acceptance criteria for stories. */
    gherkinScenarios: Array<{
        storyId: string;
        content: string;
    }>;
    /** Parent feature raw markdown. */
    featureRaw?: string;
    /** Parent epic raw markdown. */
    epicRaw?: string;
    /** Architecture decision records. */
    adrs: Array<{
        id: string;
        content: string;
    }>;
    /** Formatted codebase context (tech stack, folder tree, related files). */
    codebaseContext?: string;
    /** Raw codebase context for post-generation validation. */
    codebaseRawContext?: import('../ai/codebase/context-builder.js').CodebaseContext;
    /** Creation scope hint for AI task naming. */
    scope?: {
        type: 'feature';
        id: string;
    } | {
        type: 'story';
        id: string;
    };
}
/**
 * Gather all context for a single user story.
 * Used by `--story` flag and `planr plan` per-story generation.
 */
export declare function gatherStoryArtifacts(projectDir: string, config: OpenPlanrConfig, storyId: string): Promise<TasksPromptContext>;
/**
 * Gather all context for a feature — all stories + gherkin + ADRs + parent epic.
 * Used by `--feature` flag.
 */
export declare function gatherFeatureArtifacts(projectDir: string, config: OpenPlanrConfig, featureId: string): Promise<TasksPromptContext>;
/**
 * Read a gherkin file for a given story ID. Returns content or null.
 */
export declare function findGherkinContent(projectDir: string, config: OpenPlanrConfig, storyId: string): Promise<string | null>;
//# sourceMappingURL=artifact-gathering.d.ts.map