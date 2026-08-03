/**
 * Prompt composition for each artifact type.
 *
 * Each builder assembles a message array with:
 * 1. Expert system prompt
 * 2. User context (brief, parent artifacts, existing siblings, codebase)
 *
 * Existing sibling titles are injected to prevent the AI from
 * generating duplicate artifacts.
 */
import type { AIMessage } from '../types.js';
/**
 * Maximum characters allowed in user input to prevent overwhelming the context window.
 * This limit helps protect against extremely large inputs while supporting most real-world use cases.
 */
export declare const MAX_INPUT_CHARS = 200000;
/**
 * Wraps user-supplied content with delimiters to protect against prompt injection attacks.
 * The AI is instructed to treat content within these delimiters as data, not instructions.
 *
 * @param input - User-provided text (e.g., epic brief, PRD, feature description)
 * @returns Input wrapped with protective boundaries and truncated if too large
 */
export declare function wrapUserInput(input: string): string;
export declare function buildEpicPrompt(brief: string, existingEpics?: string[]): AIMessage[];
export declare function buildFeaturesPrompt(epicContent: string, existingFeatures?: string[], featureCount?: number): AIMessage[];
export declare function buildStoriesPrompt(featureContent: string, epicContext: string, existingStories?: string[]): AIMessage[];
export interface TasksPromptInput {
    stories: Array<{
        id: string;
        raw: string;
    }>;
    gherkinScenarios?: Array<{
        storyId: string;
        content: string;
    }>;
    featureRaw?: string;
    epicRaw?: string;
    adrs?: Array<{
        id: string;
        content: string;
    }>;
    codebaseContext?: string;
    /** When set, tells the AI the creation scope for naming the task list title. */
    scope?: {
        type: 'feature';
        id: string;
    } | {
        type: 'story';
        id: string;
    };
}
export declare function buildTasksPrompt(ctx: TasksPromptInput): AIMessage[];
export declare function buildQuickTasksPrompt(description: string, codebaseContext?: string): AIMessage[];
export declare function buildEstimatePrompt(artifactContent: string, artifactType: string, codebaseContext?: string): AIMessage[];
export declare function buildBacklogPrioritizePrompt(items: Array<{
    id: string;
    title: string;
    priority: string;
    tags: string[];
    description: string;
}>, codebaseContext?: string): AIMessage[];
export declare function buildSprintAutoSelectPrompt(availableTasks: Array<{
    id: string;
    title: string;
    points?: number;
}>, velocity: number, codebaseContext?: string): AIMessage[];
export declare function buildRefinePrompt(artifactContent: string, artifactType: string, parentContext?: {
    type: string;
    content: string;
}): AIMessage[];
/** Writable scope passed to `buildRevisePrompt`; governs what the agent may modify. */
export type ReviseWritableScope = 'prose' | 'references' | 'paths' | 'all';
/** A saved artifact (target, parent, or sibling) passed to `buildRevisePrompt`. */
export interface RevisePromptArtifact {
    id: string;
    type: string;
    content: string;
}
/** One declared source-of-truth document injected into the revise prompt. */
export interface RevisePromptSource {
    label: string;
    content: string;
}
/**
 * Full context pack for a single revise agent call.
 *
 * The builder stays synchronous — the caller (revise-service) is responsible
 * for reading the target artifact, its parent chain, its siblings, and any
 * codebase / source context before invoking this function. This keeps prompt
 * composition a pure function that is easy to test.
 */
export interface RevisePromptContext {
    artifact: RevisePromptArtifact;
    parents: RevisePromptArtifact[];
    siblings: RevisePromptArtifact[];
    /** Pre-rendered string from `formatCodebaseContext`; omit in fast mode. */
    codebaseContextFormatted?: string;
    sources: RevisePromptSource[];
    writableScope: ReviseWritableScope;
    /**
     * Canonical `## Section` names for this artifact type (from the matching
     * Handlebars template). When provided, the prompt emits a
     * `[TEMPLATE_STRUCTURE]` section telling the agent to stay within this
     * section set — preventing additive drift like adding a task-level
     * `## Relevant Files` section to an epic. Omit to skip the hint.
     */
    canonicalSections?: readonly string[];
}
/**
 * Build the message array for a `planr revise` agent call.
 *
 * Emits labeled sections exactly as `REVISE_SYSTEM_PROMPT` expects:
 * `[TARGET_ARTIFACT]`, `[PARENT_CHAIN]`, `[SIBLINGS]`, `[CODEBASE_CONTEXT]`,
 * `[DECLARED_SOURCES]`, `[WRITABLE_SCOPE]`. Missing sections render as
 * explicit "(none)" / "(not loaded)" markers rather than being dropped, so
 * the agent can distinguish "checked and empty" from "not provided."
 */
export declare function buildRevisePrompt(ctx: RevisePromptContext): AIMessage[];
/**
 * Build the prompt for `planr spec decompose <SPEC-id>`.
 *
 * Produces a 2-message conversation that asks the AI to decompose a spec
 * body into N User Stories with 1-2 Tasks each, matching the
 * planr-pipeline plugin's specification-agent contract.
 *
 * @param specBody    Raw spec markdown (PO-authored, untrusted — wrapped via wrapUserInput)
 * @param hasPNGs     If true, instructs the AI to emit 2 tasks per US (UI + Tech)
 * @param stackInfo   Optional tech stack hints from input/tech/stack.md (untrusted, wrapped)
 * @param codebaseContext  Optional preformatted codebase context (system-generated, NOT wrapped)
 * @param maxStories  Soft cap on story count (1-8); included as a directive in the user prompt
 */
export declare function buildSpecDecomposePrompt(specBody: string, hasPNGs: boolean, stackInfo?: string, codebaseContext?: string, maxStories?: number): AIMessage[];
//# sourceMappingURL=prompt-builder.d.ts.map