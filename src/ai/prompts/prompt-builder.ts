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
import {
  EPIC_SYSTEM_PROMPT,
  ESTIMATE_SYSTEM_PROMPT,
  FEATURES_SYSTEM_PROMPT,
  QUICK_TASKS_SYSTEM_PROMPT,
  REFINE_SYSTEM_PROMPT,
  STORIES_SYSTEM_PROMPT,
  TASKS_SYSTEM_PROMPT,
} from './system-prompts.js';

export function buildEpicPrompt(brief: string, existingEpics: string[] = []): AIMessage[] {
  const isDetailed = brief.split('\n').length > 5;

  let userContent: string;
  if (isDetailed) {
    userContent = `Create an epic from this detailed requirements document. Extract ALL key requirements, features, and success criteria from the full document:\n\n${brief}`;
  } else {
    userContent = `Create an epic from this brief:\n\n"${brief}"`;
  }

  if (existingEpics.length > 0) {
    userContent += `\n\nExisting epics in this project (do NOT duplicate):\n${existingEpics.map((e) => `- ${e}`).join('\n')}`;
  }

  return [
    { role: 'system', content: EPIC_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}

export function buildFeaturesPrompt(
  epicContent: string,
  existingFeatures: string[] = [],
  featureCount?: number,
): AIMessage[] {
  let userContent = `Decompose this epic into features:\n\n${epicContent}`;

  if (featureCount) {
    userContent += `\n\nGenerate approximately ${featureCount} features.`;
  }

  if (existingFeatures.length > 0) {
    userContent += `\n\nExisting features for this epic (do NOT duplicate):\n${existingFeatures.map((f) => `- ${f}`).join('\n')}`;
  }

  return [
    { role: 'system', content: FEATURES_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}

export function buildStoriesPrompt(
  featureContent: string,
  epicContext: string,
  existingStories: string[] = [],
): AIMessage[] {
  let userContent = `Generate user stories for this feature:\n\n${featureContent}`;
  userContent += `\n\n--- Parent Epic Context ---\n${epicContext}`;

  if (existingStories.length > 0) {
    userContent += `\n\nExisting stories for this feature (do NOT duplicate):\n${existingStories.map((s) => `- ${s}`).join('\n')}`;
  }

  return [
    { role: 'system', content: STORIES_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}

export interface TasksPromptInput {
  stories: Array<{ id: string; raw: string }>;
  gherkinScenarios?: Array<{ storyId: string; content: string }>;
  featureRaw?: string;
  epicRaw?: string;
  adrs?: Array<{ id: string; content: string }>;
  codebaseContext?: string;
  /** When set, tells the AI the creation scope for naming the task list title. */
  scope?: { type: 'feature'; id: string } | { type: 'story'; id: string };
}

export function buildTasksPrompt(ctx: TasksPromptInput): AIMessage[] {
  const sections: string[] = [];

  // User stories
  sections.push('--- User Stories ---');
  for (const story of ctx.stories) {
    sections.push(`\n[${story.id}]\n${story.raw}`);
  }

  // Gherkin acceptance criteria
  if (ctx.gherkinScenarios && ctx.gherkinScenarios.length > 0) {
    sections.push('\n--- Gherkin Acceptance Criteria ---');
    for (const g of ctx.gherkinScenarios) {
      sections.push(`\n[Gherkin for ${g.storyId}]\n${g.content}`);
    }
  }

  // Parent feature context
  if (ctx.featureRaw) {
    sections.push(`\n--- Parent Feature Context ---\n${ctx.featureRaw}`);
  }

  // Parent epic context
  if (ctx.epicRaw) {
    sections.push(`\n--- Parent Epic Context ---\n${ctx.epicRaw}`);
  }

  // Architecture decision records
  if (ctx.adrs && ctx.adrs.length > 0) {
    sections.push('\n--- Architecture Decision Records ---');
    for (const adr of ctx.adrs) {
      sections.push(`\n[${adr.id}]\n${adr.content}`);
    }
  }

  // Codebase context
  if (ctx.codebaseContext) {
    sections.push(`\n--- Codebase Context ---\n${ctx.codebaseContext}`);
  }

  // Add scope hint so the AI titles the task list correctly
  if (ctx.scope) {
    sections.push(
      `\n--- Scope ---\nThis task list is being generated at ${ctx.scope.type} level for ${ctx.scope.id}. Title the task list as "Tasks for ${ctx.scope.id}: <descriptive name>".`,
    );
  }

  const userContent = `Generate implementation tasks from the following agile artifacts:\n\n${sections.join('\n')}`;

  return [
    { role: 'system', content: TASKS_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}

export function buildQuickTasksPrompt(description: string, codebaseContext?: string): AIMessage[] {
  let userContent = `Generate an implementation task list for the following:\n\n"${description}"`;

  if (codebaseContext) {
    userContent += `\n\n--- Codebase Context ---\n${codebaseContext}`;
  }

  return [
    { role: 'system', content: QUICK_TASKS_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}

export function buildEstimatePrompt(
  artifactContent: string,
  artifactType: string,
  codebaseContext?: string,
): AIMessage[] {
  let userContent = `Estimate the effort for this ${artifactType} artifact:\n\n${artifactContent}`;

  if (codebaseContext) {
    userContent += `\n\n--- Codebase Context ---\n${codebaseContext}`;
  }

  return [
    { role: 'system', content: ESTIMATE_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}

export function buildRefinePrompt(
  artifactContent: string,
  artifactType: string,
  parentContext?: { type: string; content: string },
): AIMessage[] {
  let userContent = `Review and improve this ${artifactType} artifact. The "improvedMarkdown" in your response must preserve the same file format (YAML frontmatter + markdown body) as shown below:\n\n${artifactContent}`;

  if (parentContext) {
    userContent += `\n\n--- Updated Parent ${parentContext.type} (align with this) ---\n${parentContext.content}`;
    userContent += `\n\nIMPORTANT: The parent ${parentContext.type} above was just refined. Ensure this ${artifactType} is aligned with the updated parent — its scope, terminology, requirements, and priorities should be consistent.`;
  }

  return [
    { role: 'system', content: REFINE_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
