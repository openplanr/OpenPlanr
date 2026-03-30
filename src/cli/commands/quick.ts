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

import chalk from 'chalk';
import type { Command } from 'commander';
import { buildQuickTasksPrompt } from '../../ai/prompts/prompt-builder.js';
import { aiQuickTasksResponseSchema } from '../../ai/schemas/ai-response-schemas.js';
import { TOKEN_BUDGETS } from '../../ai/types.js';
import type { OpenPlanrConfig } from '../../models/types.js';
import { generateStreamingJSON, getAIProvider, isAIConfigured } from '../../services/ai-service.js';
import {
  createArtifact,
  listArtifacts,
  readArtifact,
  readArtifactRaw,
  updateArtifact,
} from '../../services/artifact-service.js';
import { loadConfig } from '../../services/config-service.js';
import { promptConfirm, promptMultiText, promptText } from '../../services/prompt-service.js';
import { logger } from '../../utils/logger.js';

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
    .option('--manual', 'use manual interactive prompts instead of AI')
    .action(async (descriptionParts: string[], opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      let description = descriptionParts.join(' ').trim();

      if (!description && !opts.manual) {
        description = await promptText('What do you want to build?');
      }

      const useAI = !opts.manual && isAIConfigured(config);

      if (useAI) {
        if (!description) {
          logger.error('Please provide a description.');
          return;
        }
        await createQuickWithAI(projectDir, config, description);
      } else {
        if (!opts.manual && !isAIConfigured(config)) {
          logger.warn('AI not configured. Using manual mode.');
        }
        await createQuickManually(projectDir, config, description);
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
        console.log(`  ${t.id}  ${t.title}`);
      }
    });

  // -----------------------------------------------------------------------
  // planr quick implement <qtId>
  // -----------------------------------------------------------------------
  quick
    .command('implement')
    .description('Implement a quick task using a coding agent')
    .argument('<qtId>', 'quick task ID (e.g., QT-001)')
    .option('-s, --subtask <id>', 'specific subtask ID or search term')
    .option('--next', 'implement the next unchecked subtask')
    .option('--agent <name>', 'override coding agent (claude, cursor, codex)')
    .option('--dry-run', 'show the composed prompt without executing')
    .action(async (qtId: string, opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const { executeImplementation } = await import('../../agents/implementation-bridge.js');
      await executeImplementation(projectDir, config, qtId, {
        subtask: opts.subtask,
        next: opts.next,
        agent: opts.agent,
        dryRun: opts.dryRun,
      });
    });

  // -----------------------------------------------------------------------
  // planr quick fix <message>
  // -----------------------------------------------------------------------
  quick
    .command('fix')
    .description('Send a follow-up prompt to fix issues')
    .argument('[message...]', 'describe the issue (or pipe error output)')
    .option('--agent <name>', 'override coding agent (claude, cursor, codex)')
    .action(async (messageParts: string[], opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const { extractErrorContext, readMultilineInput } = await import(
        '../../utils/error-context.js'
      );
      const { executeFollowUp } = await import('../../agents/implementation-bridge.js');

      let message = messageParts.join(' ').trim();

      if (!message && !process.stdin.isTTY) {
        const chunks: string[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk.toString());
        }
        message = extractErrorContext(chunks.join(''));
      }

      if (!message) {
        logger.info('Describe the issue or paste error output.');
        logger.dim('Type your message, then press Enter twice (empty line) to submit:\n');
        message = await readMultilineInput();
      }

      if (!message.trim()) {
        logger.error('No message provided.');
        return;
      }

      await executeFollowUp(projectDir, config, message, { agent: opts.agent });
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
}

// ---------------------------------------------------------------------------
// AI-powered quick task creation
// ---------------------------------------------------------------------------

async function createQuickWithAI(projectDir: string, config: OpenPlanrConfig, description: string) {
  logger.heading('Quick Task (AI-powered)');
  logger.dim('Analyzing description and codebase...');

  try {
    // Build optional codebase context
    let codebaseContext: string | undefined;
    try {
      const { buildCodebaseContext, extractKeywords, formatCodebaseContext } = await import(
        '../../ai/codebase/index.js'
      );
      const keywords = extractKeywords(description);
      const ctx = await buildCodebaseContext(projectDir, keywords);
      codebaseContext = formatCodebaseContext(ctx);

      const stackInfo = ctx.techStack
        ? ` — ${ctx.techStack.language}${ctx.techStack.framework ? ` + ${ctx.techStack.framework}` : ''}`
        : '';
      logger.success(`Scanned codebase${stackInfo}`);
    } catch {
      // Codebase scanning is best-effort
    }

    const provider = await getAIProvider(config);
    const messages = buildQuickTasksPrompt(description, codebaseContext);
    logger.dim('AI is generating tasks...');

    const { result } = await generateStreamingJSON(provider, messages, aiQuickTasksResponseSchema, {
      maxTokens: TOKEN_BUDGETS.task,
    });

    // Display preview
    console.log(chalk.dim('━'.repeat(50)));
    for (const taskGroup of result.tasks) {
      console.log(chalk.bold(`  ${taskGroup.id} ${taskGroup.title}`));
      for (const sub of taskGroup.subtasks || []) {
        console.log(chalk.dim(`    ${sub.id} ${sub.title}`));
      }
    }
    if (result.relevantFiles && result.relevantFiles.length > 0) {
      console.log('');
      console.log(chalk.bold('  Relevant Files:'));
      for (const f of result.relevantFiles) {
        console.log(chalk.dim(`    ${f.path} — ${f.reason}`));
      }
    }
    console.log(chalk.dim('━'.repeat(50)));

    const total = result.tasks.reduce((sum, t) => sum + (t.subtasks || []).length + 1, 0);
    const confirmCreate = await promptConfirm(`Create quick task list with ${total} items?`, true);

    if (!confirmCreate) {
      logger.info('Cancelled.');
      return;
    }

    const tasks = result.tasks.map((tg) => ({
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

    const { id, filePath } = await createArtifact(
      projectDir,
      config,
      'quick',
      'quick/quick-task.md.hbs',
      { title: result.title, tasks, relevantFiles: result.relevantFiles },
    );

    logger.success(`Created ${id}: ${result.title}`);
    logger.dim(`  ${filePath}`);
    logger.dim(`  ${total} tasks`);
    logger.dim('');
    logger.heading('Next steps:');
    logger.dim(`  planr quick implement ${id}            — Implement all tasks`);
    logger.dim(`  planr quick implement ${id} --next     — Implement next pending subtask`);
    logger.dim(`  planr quick implement ${id} -s 1.1     — Implement specific subtask`);
    logger.dim(`  planr quick implement ${id} --dry-run  — Preview the implementation prompt`);
    logger.dim(`  planr quick promote ${id} --story US-001 — Move into agile hierarchy`);
  } catch (err) {
    const { AIError } = await import('../../ai/errors.js');
    if (err instanceof AIError) {
      logger.error(err.userMessage);
    } else if (err instanceof Error) {
      logger.error(err.message);
    } else {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Manual quick task creation
// ---------------------------------------------------------------------------

async function createQuickManually(
  projectDir: string,
  config: OpenPlanrConfig,
  description?: string,
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
    { title, tasks },
  );

  logger.success(`Created ${id}: ${title}`);
  logger.dim(`  ${filePath}`);
  logger.dim(`  ${tasks.length} tasks`);
  logger.dim('');
  logger.dim(`Next: planr quick implement ${id}`);
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

  // Create as a proper TASK artifact with the parent reference
  const { id: newId, filePath } = await createArtifact(
    projectDir,
    config,
    'task',
    'tasks/task-list.md.hbs',
    {
      title,
      storyId: opts.story,
      featureId: opts.feature,
      tasks: quickData.data.tasks || [],
    },
  );

  if (opts.story) {
    const { addChildReference } = await import('../../services/artifact-service.js');
    await addChildReference(projectDir, config, 'story', opts.story, 'task', newId, title);
  }

  // Mark the original quick task as promoted
  const promotedNote = `\n\n> **Promoted** to [${newId}](../tasks/${newId}.md) on ${new Date().toISOString().split('T')[0]}.\n`;
  await updateArtifact(projectDir, config, 'quick', qtId, rawContent + promotedNote);

  logger.success(`Promoted ${qtId} → ${newId}`);
  logger.dim(`  ${filePath}`);
  if (opts.story) logger.dim(`  Linked to story ${opts.story}`);
  if (opts.feature) logger.dim(`  Linked to feature ${opts.feature}`);
  logger.dim('');
  logger.dim(`Next: planr task implement ${newId}`);
}
