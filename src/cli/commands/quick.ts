/**
 * `planr quick` command group.
 *
 * Standalone task lists without the full agile hierarchy.
 * Ideal for prototyping, bug fixes, hackathons, or any work
 * that doesn't need epics/features/stories.
 *
 * Quick tasks can later be promoted into the agile hierarchy
 * via `planr quick promote`.
 */

import path from 'node:path';
import type { Command } from 'commander';
import { buildQuickTasksPrompt } from '../../ai/prompts/prompt-builder.js';
import { aiQuickTasksResponseSchema } from '../../ai/schemas/ai-response-schemas.js';
import { TOKEN_BUDGETS } from '../../ai/types.js';
import type { OpenPlanrConfig } from '../../models/types.js';
import { generateStreamingJSON, getAIProvider, isAIConfigured } from '../../services/ai-service.js';
import {
  addChildReference,
  createArtifact,
  getArtifactDir,
  listArtifacts,
  readArtifact,
  readArtifactRaw,
  resolveArtifactFilename,
  updateArtifact,
  updateArtifactFields,
} from '../../services/artifact-service.js';
import { loadConfig } from '../../services/config-service.js';
import { getNextId } from '../../services/id-service.js';
import { requireInteractiveForManual } from '../../services/interactive-state.js';
import { promptConfirm, promptMultiText, promptText } from '../../services/prompt-service.js';
import { VALID_STATUSES } from '../../utils/constants.js';
import { ensureDir, writeFile } from '../../utils/fs.js';
import { display, logger } from '../../utils/logger.js';
import { slugify } from '../../utils/slugify.js';
import { applyBulkCheckboxes, resolveBulkStatusIntent } from '../helpers/bulk-checkbox-update.js';
import {
  buildTaskItems,
  countTaskItems,
  displayNextSteps,
  displayTaskPreview,
  displayValidationWarnings,
  handleAIError,
} from '../helpers/task-creation.js';

export function registerQuickCommand(program: Command) {
  const quick = program
    .command('quick')
    .description('Standalone task lists — no agile ceremony required');

  // -----------------------------------------------------------------------
  // planr quick <description>  (default subcommand: create)
  // -----------------------------------------------------------------------
  quick
    .command('create', { isDefault: true })
    .description('Create a standalone task list from a brief description')
    .argument('[description...]', 'what to build (one-line description)')
    .option('--file <path>', 'read description from a file (PRD, spec, etc.)')
    .option('--manual', 'use manual interactive prompts instead of AI')
    .option(
      '--epic <epicId>',
      'link this quick task to an epic so `planr linear push EPIC-XXX` cascades to it',
    )
    .action(async (descriptionParts: string[], opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      let description = descriptionParts.join(' ').trim();

      if (opts.file) {
        try {
          const { readInputFile } = await import('../../utils/fs.js');
          const content = await readInputFile(path.resolve(opts.file), logger);
          if (!content) return;
          description = content;
        } catch (err) {
          logger.debug('Failed to read quick task input file', err);
          logger.error(`Failed to read file: ${opts.file}`);
          return;
        }
      } else if (!description && !opts.manual) {
        description = await promptText('What do you want to build?');
      }

      requireInteractiveForManual(opts.manual);

      // --epic soft-validates: warn if the epic doesn't exist locally, but still
      // write the linkage so the user can author QT before the epic lands.
      const epicId = typeof opts.epic === 'string' ? opts.epic.trim() : undefined;
      if (epicId) {
        const epicArt = await readArtifact(projectDir, config, 'epic', epicId);
        if (!epicArt) {
          logger.warn(
            `--epic ${epicId}: no such epic found locally yet. Linking anyway; create the epic before \`planr linear push\` or the link will fail there.`,
          );
        }
      }

      const useAI = !opts.manual && isAIConfigured(config);

      if (useAI) {
        if (!description) {
          logger.error('Please provide a description.');
          return;
        }
        await createQuickWithAI(projectDir, config, description, {
          fromFile: !!opts.file,
          epicId,
        });
      } else {
        if (!opts.manual && !isAIConfigured(config)) {
          logger.warn('AI not configured. Using manual mode.');
        }
        await createQuickManually(projectDir, config, description, epicId);
      }
    });

  // -----------------------------------------------------------------------
  // planr quick list
  // -----------------------------------------------------------------------
  quick
    .command('list')
    .description('List all quick task lists')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const tasks = await listArtifacts(projectDir, config, 'quick');

      if (tasks.length === 0) {
        logger.info('No quick tasks found. Run "planr quick <description>" to create one.');
        return;
      }

      logger.heading('Quick Tasks');
      for (const t of tasks) {
        display.line(`  ${t.id}  ${t.title}`);
      }
    });

  // -----------------------------------------------------------------------
  // planr quick promote <qtId>
  // -----------------------------------------------------------------------
  quick
    .command('promote')
    .description('Promote a quick task into the agile hierarchy')
    .argument('<qtId>', 'quick task ID (e.g., QT-001)')
    .option('--story <storyId>', 'attach to a user story')
    .option('--feature <featureId>', 'attach to a feature')
    .action(async (qtId: string, opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      if (!opts.story && !opts.feature) {
        logger.error('Please provide --story <storyId> or --feature <featureId>.');
        return;
      }

      await promoteQuickTask(projectDir, config, qtId, opts);
    });

  // -----------------------------------------------------------------------
  // planr quick update <qtId>
  // -----------------------------------------------------------------------
  quick
    .command('update')
    .description('Update a quick task')
    .argument('<qtId>', 'quick task ID (e.g., QT-001)')
    .option('--status <status>', 'new status (pending, in-progress, done)')
    .option('--all-done', 'set status=done AND flip every `N.M` task checkbox to `[x]` in the body')
    .option(
      '--all-pending',
      'set status=pending AND flip every `N.M` task checkbox to `[ ]` in the body',
    )
    .action(
      async (qtId: string, opts: { status?: string; allDone?: boolean; allPending?: boolean }) => {
        const projectDir = program.opts().projectDir as string;
        const config = await loadConfig(projectDir);

        let intent: ReturnType<typeof resolveBulkStatusIntent>;
        try {
          intent = resolveBulkStatusIntent(opts);
        } catch (err) {
          logger.error((err as Error).message);
          process.exit(1);
          return;
        }

        if (intent.useBulk) {
          try {
            const result = await applyBulkCheckboxes(
              projectDir,
              config,
              'quick',
              qtId,
              intent.bulkStatus,
            );
            const checkboxNote = result.flippedAny ? ' (subtasks flipped)' : '';
            logger.success(`Updated ${qtId}: status=${result.status}${checkboxNote}`);
          } catch (err) {
            logger.error(`Failed to update ${qtId}: ${(err as Error).message}`);
            process.exit(1);
          }
          return;
        }

        if (!intent.status) {
          logger.error('Provide --status <value>, --all-done, or --all-pending.');
          process.exit(1);
        }

        const allowed = VALID_STATUSES.quick;
        if (allowed && !allowed.includes(intent.status)) {
          logger.error(`Invalid status "${intent.status}". Valid: ${allowed.join(', ')}`);
          process.exit(1);
        }

        try {
          await updateArtifactFields(projectDir, config, 'quick', qtId, { status: intent.status });
          logger.success(`Updated ${qtId}: status=${intent.status}`);
        } catch (err) {
          logger.error(`Failed to update ${qtId}: ${(err as Error).message}`);
          process.exit(1);
        }
      },
    );
}

// ---------------------------------------------------------------------------
// AI-powered quick task creation
// ---------------------------------------------------------------------------

export interface CreateQuickWithAIOptions {
  /** When true, use the larger token budget (for spec/PRD input). */
  fromFile?: boolean;
  /** Link the new QT to this epic (frontmatter `epicId`). */
  epicId?: string;
  /** Provenance: which BL-XXX this QT was promoted from (frontmatter `sourceBacklog`). */
  sourceBacklog?: string;
  /** Optional override of the heading shown in the CLI preview. */
  headingLabel?: string;
  /** Optional override for the confirm prompt text. */
  confirmLabel?: string;
}

export async function createQuickWithAI(
  projectDir: string,
  config: OpenPlanrConfig,
  description: string,
  options: CreateQuickWithAIOptions = {},
): Promise<{ id: string; filePath: string } | undefined> {
  const { fromFile = false, epicId, sourceBacklog, headingLabel, confirmLabel } = options;

  logger.heading(headingLabel ?? 'Quick Task (AI-powered)');
  logger.dim('Analyzing description and codebase...');

  try {
    let codebaseContext: string | undefined;
    let rawCodebaseContext: import('../../ai/codebase/index.js').CodebaseContext | undefined;
    try {
      const { buildCodebaseContext, extractKeywords, formatCodebaseContext } = await import(
        '../../ai/codebase/index.js'
      );
      const keywords = extractKeywords(description);
      const ctx = await buildCodebaseContext(projectDir, keywords);
      rawCodebaseContext = ctx;
      codebaseContext = formatCodebaseContext(ctx);

      const stackInfo = ctx.techStack
        ? ` — ${ctx.techStack.language}${ctx.techStack.framework ? ` + ${ctx.techStack.framework}` : ''}`
        : '';
      logger.success(`Scanned codebase${stackInfo}`);
    } catch (err) {
      logger.debug('Codebase scanning failed during quick task creation', err);
    }

    const provider = await getAIProvider(config);
    const messages = buildQuickTasksPrompt(description, codebaseContext);
    logger.dim('AI is generating tasks...');

    const maxTokens = fromFile ? TOKEN_BUDGETS.taskFeature : TOKEN_BUDGETS.task;
    const { result } = await generateStreamingJSON(provider, messages, aiQuickTasksResponseSchema, {
      maxTokens,
    });

    displayTaskPreview(result);
    await displayValidationWarnings(result.relevantFiles, rawCodebaseContext);

    const total = countTaskItems(result.tasks);
    const confirmCreate = await promptConfirm(
      confirmLabel ?? `Create quick task list with ${total} items?`,
      true,
    );

    if (!confirmCreate) {
      logger.info('Cancelled.');
      return undefined;
    }

    const tasks = buildTaskItems(result);

    const { id, filePath } = await createArtifact(
      projectDir,
      config,
      'quick',
      'quick/quick-task.md.hbs',
      {
        title: result.title,
        tasks,
        relevantFiles: result.relevantFiles,
        epicId,
        sourceBacklog,
      },
    );

    logger.success(`Created ${id}: ${result.title}`);
    logger.dim(`  ${filePath}`);
    logger.dim(`  ${total} tasks`);
    logger.dim('');
    displayNextSteps({
      command: 'quick',
      id,
      extras: [`planr quick promote ${id} --story US-001 — Move into agile hierarchy`],
    });
    return { id, filePath };
  } catch (err) {
    await handleAIError(err);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Manual quick task creation
// ---------------------------------------------------------------------------

async function createQuickManually(
  projectDir: string,
  config: OpenPlanrConfig,
  description?: string,
  epicId?: string,
) {
  logger.heading('Quick Task (manual)');

  const title = description || (await promptText('Task list title:'));
  const taskNames = await promptMultiText(
    'Enter task names',
    'comma-separated, e.g.: Setup, Implement API, Write tests',
  );

  const tasks = taskNames.map((name, i) => ({
    id: `${i + 1}.0`,
    title: name,
    status: 'pending' as const,
    subtasks: [],
  }));

  const { id, filePath } = await createArtifact(
    projectDir,
    config,
    'quick',
    'quick/quick-task.md.hbs',
    { title, tasks, epicId },
  );

  logger.success(`Created ${id}: ${title}`);
  logger.dim(`  ${filePath}`);
  logger.dim(`  ${tasks.length} tasks`);
  logger.dim('');
  logger.dim(`Next: planr quick list`);
}

// ---------------------------------------------------------------------------
// Promote quick task into agile hierarchy
// ---------------------------------------------------------------------------

async function promoteQuickTask(
  projectDir: string,
  config: OpenPlanrConfig,
  qtId: string,
  opts: { story?: string; feature?: string },
) {
  const quickData = await readArtifact(projectDir, config, 'quick', qtId);
  if (!quickData) {
    logger.error(`Quick task ${qtId} not found.`);
    return;
  }

  const rawContent = await readArtifactRaw(projectDir, config, 'quick', qtId);
  if (!rawContent) {
    logger.error(`Could not read ${qtId}.`);
    return;
  }

  const title = (quickData.data.title as string) || qtId;

  // Verify the target parent exists
  if (opts.story) {
    const story = await readArtifact(projectDir, config, 'story', opts.story);
    if (!story) {
      logger.error(`Story ${opts.story} not found.`);
      return;
    }
  }

  if (opts.feature) {
    const feature = await readArtifact(projectDir, config, 'feature', opts.feature);
    if (!feature) {
      logger.error(`Feature ${opts.feature} not found.`);
      return;
    }
  }

  // Generate a new TASK-xxx ID and write the file directly.
  // We copy the raw markdown content (preserving all task checkboxes)
  // instead of re-rendering through a template which would lose them.
  const taskDir = path.join(projectDir, getArtifactDir(config, 'task'));
  await ensureDir(taskDir);
  const prefix = config.idPrefix.task || 'TASK';
  const newId = await getNextId(taskDir, prefix);
  const slug = slugify(title);
  const filename = `${newId}-${slug}.md`;
  const filePath = path.join(taskDir, filename);

  // Transform the raw quick task markdown:
  // 1. Replace QT-xxx ID with TASK-xxx throughout
  let promoted = rawContent.replace(new RegExp(qtId, 'g'), newId);

  // 2. Add storyId/featureId to frontmatter and body links
  if (opts.story) {
    const storyFilename = await resolveArtifactFilename(projectDir, config, 'story', opts.story);
    promoted = promoted.replace(/^(title: .+)$/m, `$1\nstoryId: "${opts.story}"`);
    const storyLink = `**User Story:** [${opts.story}](../stories/${storyFilename}.md)`;
    promoted = promoted.replace(/^(# .+)$/m, `$1\n\n${storyLink}`);
  }

  if (opts.feature) {
    const featFilename = await resolveArtifactFilename(projectDir, config, 'feature', opts.feature);
    promoted = promoted.replace(/^(title: .+)$/m, `$1\nfeatureId: "${opts.feature}"`);
    const featLink = `**Feature:** [${opts.feature}](../features/${featFilename}.md)`;
    promoted = promoted.replace(/^(# .+)$/m, `$1\n\n${featLink}`);
  }

  // 3. Remove the quick-task promote hint
  promoted = promoted.replace(/^_To move this into your agile hierarchy.*$/m, '');

  await writeFile(filePath, promoted);

  // Add reference from parent story/feature to the new task
  if (opts.story) {
    await addChildReference(projectDir, config, 'story', opts.story, 'task', newId, title);
  }

  // Mark the original quick task as promoted
  const today = new Date().toISOString().split('T')[0];
  const promotedNote = `\n\n> **Promoted** to [${newId}](../tasks/${filename}) on ${today}.\n`;
  await updateArtifact(projectDir, config, 'quick', qtId, rawContent + promotedNote);

  logger.success(`Promoted ${qtId} → ${newId}`);
  logger.dim(`  ${filePath}`);
  if (opts.story) logger.dim(`  Linked to story ${opts.story}`);
  if (opts.feature) logger.dim(`  Linked to feature ${opts.feature}`);
  logger.dim('');
  logger.dim(`Next: planr task list`);
}
