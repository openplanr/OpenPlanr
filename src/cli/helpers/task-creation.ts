/**
 * Shared helpers for task creation commands (quick + task).
 *
 * Both `planr quick` and `planr task` follow the same AI-powered workflow:
 *   1. Display a preview of AI-generated task groups / subtasks
 *   2. Show post-generation validation warnings
 *   3. Map AI output to artifact-ready task items
 *   4. Display "next steps" after successful creation
 *   5. Handle AI errors uniformly
 *
 * This module extracts those shared patterns so the command files
 * stay focused on their unique orchestration logic.
 */

import chalk from 'chalk';
import type { CodebaseContext } from '../../ai/codebase/index.js';
import { display, logger } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskGroup {
  id: string;
  title: string;
  subtasks?: Array<{ id: string; title: string }>;
}

export interface AcceptanceCriteriaMapping {
  criterion: string;
  sourceStoryId: string;
  taskIds: string[];
}

export interface RelevantFile {
  path: string;
  reason: string;
  action: 'modify' | 'create';
}

export interface TaskPreviewData {
  tasks: TaskGroup[];
  acceptanceCriteriaMapping?: AcceptanceCriteriaMapping[];
  relevantFiles?: RelevantFile[];
}

// ---------------------------------------------------------------------------
// Task preview display
// ---------------------------------------------------------------------------

/**
 * Render a preview of AI-generated task groups and subtasks.
 *
 * Optionally shows acceptance-criteria mapping (task-from-story mode)
 * and relevant files (both modes).
 */
export function displayTaskPreview(result: TaskPreviewData): void {
  display.separator(50);
  for (const taskGroup of result.tasks) {
    display.heading(`  ${taskGroup.id} ${taskGroup.title}`);
    for (const sub of taskGroup.subtasks || []) {
      display.line(chalk.dim(`    ${sub.id} ${sub.title}`));
    }
  }

  if (result.acceptanceCriteriaMapping && result.acceptanceCriteriaMapping.length > 0) {
    display.blank();
    display.heading('  Acceptance Criteria Mapping:');
    for (const ac of result.acceptanceCriteriaMapping) {
      display.line(
        chalk.dim(`    ${ac.criterion} (${ac.sourceStoryId}) → [${ac.taskIds.join(', ')}]`),
      );
    }
  }

  if (result.relevantFiles && result.relevantFiles.length > 0) {
    display.blank();
    display.heading('  Relevant Files:');
    for (const f of result.relevantFiles) {
      display.line(chalk.dim(`    ${f.path} — ${f.reason}`));
    }
  }
  display.separator(50);
}

// ---------------------------------------------------------------------------
// Validation warnings
// ---------------------------------------------------------------------------

/**
 * Run post-generation validation on relevant files and display any warnings.
 * Best-effort — silently swallows errors so the main flow is never interrupted.
 */
export async function displayValidationWarnings(
  relevantFiles: RelevantFile[] | undefined,
  rawContext: CodebaseContext | undefined,
): Promise<void> {
  if (!rawContext || !relevantFiles?.length) return;
  try {
    const { validateRelevantFiles } = await import('../../ai/validation/index.js');
    const validation = validateRelevantFiles(relevantFiles, rawContext.sourceInventory);
    if (validation.warnings.length > 0) {
      display.blank();
      logger.warn('Quality warnings:');
      for (const w of validation.warnings) {
        display.line(chalk.yellow(`  ⚠ ${w}`));
      }
      display.blank();
    }
  } catch (err) {
    logger.debug('Post-generation validation failed', err);
    // Validation is best-effort
  }
}

// ---------------------------------------------------------------------------
// Build task items for artifact creation
// ---------------------------------------------------------------------------

/**
 * Convert the AI response task groups into the shape expected by the
 * artifact template (with `status` and nested `subtasks`).
 */
export function buildTaskItems(result: { tasks: TaskGroup[] }) {
  return result.tasks.map((tg) => ({
    id: tg.id,
    title: tg.title,
    status: 'pending' as const,
    subtasks: (tg.subtasks || []).map((st) => ({
      id: st.id,
      title: st.title,
      status: 'pending' as const,
      subtasks: [],
    })),
  }));
}

// ---------------------------------------------------------------------------
// Count total task items
// ---------------------------------------------------------------------------

/**
 * Count total items (top-level tasks + subtasks) for confirmation prompts.
 */
export function countTaskItems(tasks: TaskGroup[]): number {
  return tasks.reduce((sum, t) => sum + (t.subtasks || []).length + 1, 0);
}

// ---------------------------------------------------------------------------
// Next steps display
// ---------------------------------------------------------------------------

export interface NextStepsOptions {
  /** The CLI command group, e.g. 'quick' or 'task'. */
  command: 'quick' | 'task';
  /** The artifact ID, e.g. 'QT-001' or 'TASK-001'. */
  id: string;
  /** Extra lines to append (e.g. promote hint for quick tasks). */
  extras?: string[];
}

/**
 * Display the "Next steps" block after successful creation.
 */
export function displayNextSteps(opts: NextStepsOptions): void {
  logger.heading('Next steps:');
  logger.dim(
    `  planr ${opts.command} list                          — View all ${opts.command} tasks`,
  );
  logger.dim(`  Open ${opts.id} in your coding agent (Claude Code, Cursor, Codex)`);
  logger.dim(`  The agent rules will guide context-aware implementation automatically`);
  if (opts.extras) {
    for (const line of opts.extras) {
      logger.dim(`  ${line}`);
    }
  }
}

// ---------------------------------------------------------------------------
// AI error handler
// ---------------------------------------------------------------------------

/**
 * Handle errors from AI generation calls.
 * Recognises `AIError` (shows `.userMessage`) and generic `Error`.
 * Re-throws anything else.
 */
export async function handleAIError(err: unknown): Promise<void> {
  const { AIError } = await import('../../ai/errors.js');
  if (err instanceof AIError) {
    logger.error(err.userMessage);
  } else if (err instanceof Error) {
    logger.error(err.message);
  } else {
    throw err;
  }
}
