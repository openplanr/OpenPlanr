/**
 * `planr task` command group.
 *
 * AI-powered by default for creation. Supports:
 *   --story US-001     → tasks from a single story
 *   --feature FEAT-001 → tasks from all stories in a feature
 *
 * The `implement` subcommand delegates to a configured coding agent.
 */

import { Command } from 'commander';
import { loadConfig } from '../../services/config-service.js';
import {
  createArtifact,
  listArtifacts,
  readArtifact,
  resolveArtifactFilename,
  addChildReference,
  getArtifactDir,
} from '../../services/artifact-service.js';
import { isAIConfigured, getAIProvider, generateStreamingJSON } from '../../services/ai-service.js';
import { promptText, promptMultiText, promptConfirm } from '../../services/prompt-service.js';
import { buildTasksPrompt } from '../../ai/prompts/prompt-builder.js';
import { aiTasksResponseSchema } from '../../ai/schemas/ai-response-schemas.js';
import { gatherStoryArtifacts, gatherFeatureArtifacts } from '../../services/artifact-gathering.js';
import { logger } from '../../utils/logger.js';
import chalk from 'chalk';
import type { OpenPlanrConfig } from '../../models/types.js';

export function registerTaskCommand(program: Command) {
  const task = program.command('task').description('Manage tasks');

  task
    .command('create')
    .description('Create tasks from a user story or feature')
    .option('--story <storyId>', 'parent user story ID (e.g., US-001)')
    .option('--feature <featureId>', 'parent feature ID — generates tasks from all stories (e.g., FEAT-001)')
    .option('--title <title>', 'task list title')
    .option('--manual', 'use manual interactive prompts instead of AI')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      if (!opts.story && !opts.feature) {
        logger.error('Please provide --story <storyId> or --feature <featureId>.');
        process.exit(1);
      }

      if (opts.feature) {
        const featureData = await readArtifact(projectDir, config, 'feature', opts.feature);
        if (!featureData) {
          logger.error(`Feature ${opts.feature} not found.`);
          process.exit(1);
        }

        if (!isAIConfigured(config)) {
          logger.error('AI must be configured for --feature mode. Run `planr config set-provider`.');
          process.exit(1);
        }
        await createTasksFromFeature(projectDir, config, opts.feature);
        return;
      }

      // --story mode
      const storyData = await readArtifact(projectDir, config, 'story', opts.story);
      if (!storyData) {
        logger.error(`User story ${opts.story} not found.`);
        process.exit(1);
      }

      const useAI = !opts.manual && isAIConfigured(config);

      if (useAI) {
        await createTasksWithAI(projectDir, config, opts.story);
      } else {
        if (!opts.manual && !isAIConfigured(config)) {
          logger.warn('AI not configured. Using manual mode.');
        }
        await createTasksManually(projectDir, config, opts);
      }
    });

  task
    .command('list')
    .description('List task lists')
    .option('--story <storyId>', 'filter by story ID')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const tasks = await listArtifacts(projectDir, config, 'task');

      if (tasks.length === 0) {
        logger.info('No task lists found. Run "planr task create --story <ID>" to create one.');
        return;
      }

      logger.heading('Task Lists');
      for (const t of tasks) {
        console.log(`  ${t.id}  ${t.title}`);
      }
    });

  task
    .command('implement')
    .description('Implement a task using a coding agent')
    .argument('<taskId>', 'task list ID (e.g., TASK-001) or story ID with --all (e.g., US-001)')
    .option('-s, --subtask <id>', 'specific subtask ID or search term (e.g., 2.1 or "auth")')
    .option('--next', 'implement the next unchecked subtask')
    .option('--all', 'implement all task lists for the given story ID sequentially')
    .option('--agent <name>', 'override coding agent (claude, cursor, codex)')
    .option('--dry-run', 'show the composed prompt without executing')
    .option('--mark-done', 'mark subtask as done after implementation')
    .action(async (taskId: string, opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const { executeImplementation } = await import('../../agents/implementation-bridge.js');

      if (opts.all) {
        const allTasks = await listArtifacts(projectDir, config, 'task');
        const storyTasks: string[] = [];

        for (const t of allTasks) {
          const data = await readArtifact(projectDir, config, 'task', t.id);
          if (data && data.data.storyId === taskId) {
            storyTasks.push(t.id);
          }
        }

        if (storyTasks.length === 0) {
          logger.error(`No task lists found for story ${taskId}.`);
          return;
        }

        logger.heading(`Implementing all ${storyTasks.length} task lists for ${taskId}`);

        for (const tid of storyTasks) {
          logger.heading(`\n--- ${tid} ---`);
          await executeImplementation(projectDir, config, tid, {
            agent: opts.agent,
            dryRun: opts.dryRun,
            markDone: opts.markDone,
          });
        }
      } else {
        await executeImplementation(projectDir, config, taskId, {
          subtask: opts.subtask,
          next: opts.next,
          agent: opts.agent,
          dryRun: opts.dryRun,
          markDone: opts.markDone,
        });
      }
    });
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function displayTaskPreview(result: {
  tasks: Array<{ id: string; title: string; subtasks?: Array<{ id: string; title: string }> }>;
  acceptanceCriteriaMapping?: Array<{ criterion: string; sourceStoryId: string; taskIds: string[] }>;
  relevantFiles?: Array<{ path: string; reason: string }>;
}) {
  console.log(chalk.dim('━'.repeat(50)));
  for (const taskGroup of result.tasks) {
    console.log(chalk.bold(`  ${taskGroup.id} ${taskGroup.title}`));
    for (const sub of taskGroup.subtasks || []) {
      console.log(chalk.dim(`    ${sub.id} ${sub.title}`));
    }
  }

  if (result.acceptanceCriteriaMapping && result.acceptanceCriteriaMapping.length > 0) {
    console.log('');
    console.log(chalk.bold('  Acceptance Criteria Mapping:'));
    for (const ac of result.acceptanceCriteriaMapping) {
      console.log(chalk.dim(`    ${ac.criterion} (${ac.sourceStoryId}) → [${ac.taskIds.join(', ')}]`));
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
}

function buildTaskItems(result: {
  tasks: Array<{ id: string; title: string; subtasks?: Array<{ id: string; title: string }> }>;
}) {
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

function buildArtifactSources(
  ctx: import('../../services/artifact-gathering.js').TasksPromptContext,
  config: OpenPlanrConfig
): Array<{ type: string; path: string }> {
  const sources: Array<{ type: string; path: string }> = [];
  for (const s of ctx.stories) {
    sources.push({ type: 'User Story', path: `${config.outputPaths.agile}/stories/${s.id}` });
  }
  for (const g of ctx.gherkinScenarios) {
    sources.push({ type: 'Gherkin', path: `${config.outputPaths.agile}/stories/${g.storyId}-gherkin.feature` });
  }
  if (ctx.featureRaw) {
    sources.push({ type: 'Feature', path: `${config.outputPaths.agile}/features/` });
  }
  if (ctx.epicRaw) {
    sources.push({ type: 'Epic', path: `${config.outputPaths.agile}/epics/` });
  }
  for (const a of ctx.adrs) {
    sources.push({ type: 'ADR', path: `${config.outputPaths.agile}/adrs/${a.id}` });
  }
  return sources;
}

// ---------------------------------------------------------------------------
// AI-powered task creation from a single story
// ---------------------------------------------------------------------------

async function createTasksWithAI(
  projectDir: string,
  config: OpenPlanrConfig,
  storyId: string
) {
  logger.heading(`Create Tasks (AI-powered from ${storyId})`);

  // Warn if tasks already exist for this story
  const existingTasks = await listArtifacts(projectDir, config, 'task');
  const storyTasks: Array<{ id: string; title: string }> = [];
  for (const t of existingTasks) {
    const data = await readArtifact(projectDir, config, 'task', t.id);
    if (data && data.data.storyId === storyId) {
      storyTasks.push({ id: t.id, title: (data.data.title as string) || t.title });
    }
  }
  if (storyTasks.length > 0) {
    logger.warn(`${storyId} already has ${storyTasks.length} task list(s):`);
    for (const t of storyTasks) {
      console.log(chalk.dim(`  ${t.id}: ${t.title}`));
    }
    const continueCreate = await promptConfirm('Generate additional tasks?', false);
    if (!continueCreate) {
      logger.info('Task creation cancelled.');
      return;
    }
  }

  logger.dim('Gathering artifacts and codebase context...');

  try {
    const ctx = await gatherStoryArtifacts(projectDir, config, storyId);

    const storyParts = [
      `${ctx.stories.length} stories`,
      `${ctx.gherkinScenarios.length} gherkin files`,
      ctx.featureRaw ? '1 feature' : null,
      ctx.epicRaw ? '1 epic' : null,
      `${ctx.adrs.length} ADRs`,
      ctx.codebaseContext ? 'codebase context' : null,
    ].filter(Boolean);
    logger.dim(`Found ${storyParts.join(', ')}`);
    logger.dim('AI is generating implementation tasks...');

    const provider = await getAIProvider(config);
    ctx.scope = { type: 'story', id: storyId };
    const messages = buildTasksPrompt(ctx);
    logger.debug(`Task prompt: ${messages.length} messages, user content ${messages[1]?.content.length ?? 0} chars`);
    const result = await generateStreamingJSON(provider, messages, aiTasksResponseSchema);

    displayTaskPreview(result);

    const total = result.tasks.reduce((sum, t) => sum + (t.subtasks || []).length + 1, 0);
    const confirmCreate = await promptConfirm(`Create task list with ${total} items?`, true);

    if (!confirmCreate) {
      logger.info('Task creation cancelled.');
      return;
    }

    const tasks = buildTaskItems(result);
    const artifactSources = buildArtifactSources(ctx, config);
    const storyFilename = await resolveArtifactFilename(projectDir, config, 'story', storyId);

    const { id, filePath } = await createArtifact(projectDir, config, 'task', 'tasks/task-list.md.hbs', {
      title: result.title,
      storyId,
      storyFilename,
      tasks,
      artifactSources,
      acceptanceCriteriaMapping: result.acceptanceCriteriaMapping,
      relevantFiles: result.relevantFiles,
    });

    await addChildReference(projectDir, config, 'story', storyId, 'task', id, result.title);
    logger.success(`Created task list ${id}: ${result.title}`);
    logger.dim(`  ${filePath}`);
    logger.dim(`  ${total} tasks created`);
    logger.dim('');
    logger.heading('Next steps:');
    logger.dim(`  planr task implement ${id}            — Implement all tasks`);
    logger.dim(`  planr task implement ${id} --next     — Implement next pending subtask`);
    logger.dim(`  planr task implement ${id} -s 1.1     — Implement specific subtask`);
    logger.dim(`  planr task implement ${id} --dry-run  — Preview the implementation prompt`);
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
// AI-powered task creation from a feature (all stories)
// ---------------------------------------------------------------------------

async function createTasksFromFeature(
  projectDir: string,
  config: OpenPlanrConfig,
  featureId: string
) {
  logger.heading(`Create Tasks (AI-powered from ${featureId} — all stories)`);

  // Warn if tasks already exist for this feature
  const existingTasks = await listArtifacts(projectDir, config, 'task');
  const featureTasks: Array<{ id: string; title: string }> = [];
  for (const t of existingTasks) {
    const data = await readArtifact(projectDir, config, 'task', t.id);
    if (data && data.data.featureId === featureId) {
      featureTasks.push({ id: t.id, title: (data.data.title as string) || t.title });
    }
  }
  if (featureTasks.length > 0) {
    logger.warn(`${featureId} already has ${featureTasks.length} task list(s):`);
    for (const t of featureTasks) {
      console.log(chalk.dim(`  ${t.id}: ${t.title}`));
    }
    const continueCreate = await promptConfirm('Generate additional tasks?', false);
    if (!continueCreate) {
      logger.info('Task creation cancelled.');
      return;
    }
  }

  logger.dim('Gathering all stories, gherkin scenarios, ADRs, and codebase context...');

  try {
    const ctx = await gatherFeatureArtifacts(projectDir, config, featureId);

    const parts = [
      `${ctx.stories.length} stories`,
      `${ctx.gherkinScenarios.length} gherkin files`,
      ctx.featureRaw ? '1 feature' : null,
      ctx.epicRaw ? '1 epic' : null,
      `${ctx.adrs.length} ADRs`,
      ctx.codebaseContext ? 'codebase context' : null,
    ].filter(Boolean);
    logger.dim(`Found ${parts.join(', ')}`);
    logger.dim('AI is generating implementation tasks...');

    const provider = await getAIProvider(config);
    ctx.scope = { type: 'feature', id: featureId };
    const messages = buildTasksPrompt(ctx);
    logger.debug(`Task prompt: ${messages.length} messages, user content ${messages[1]?.content.length ?? 0} chars`);
    const result = await generateStreamingJSON(provider, messages, aiTasksResponseSchema);

    displayTaskPreview(result);

    const total = result.tasks.reduce((sum, t) => sum + (t.subtasks || []).length + 1, 0);
    const confirmCreate = await promptConfirm(`Create task list with ${total} items?`, true);

    if (!confirmCreate) {
      logger.info('Task creation cancelled.');
      return;
    }

    const tasks = buildTaskItems(result);
    const artifactSources = buildArtifactSources(ctx, config);
    const featureFilename = await resolveArtifactFilename(projectDir, config, 'feature', featureId);

    const { id, filePath } = await createArtifact(projectDir, config, 'task', 'tasks/task-list.md.hbs', {
      title: result.title,
      featureId,
      featureFilename,
      tasks,
      artifactSources,
      acceptanceCriteriaMapping: result.acceptanceCriteriaMapping,
      relevantFiles: result.relevantFiles,
    });

    // Add reference from each story to this task list
    for (const story of ctx.stories) {
      await addChildReference(projectDir, config, 'story', story.id, 'task', id, result.title);
    }

    logger.success(`Created task list ${id}: ${result.title}`);
    logger.dim(`  ${filePath}`);
    logger.dim(`  ${total} tasks from ${ctx.stories.length} stories`);
    logger.dim('');
    logger.heading('Next steps:');
    logger.dim(`  planr task implement ${id}            — Implement all tasks`);
    logger.dim(`  planr task implement ${id} --next     — Implement next pending subtask`);
    logger.dim(`  planr task implement ${id} -s 1.1     — Implement specific subtask`);
    logger.dim(`  planr task implement ${id} --dry-run  — Preview the implementation prompt`);
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
// Manual task creation (unchanged)
// ---------------------------------------------------------------------------

async function createTasksManually(
  projectDir: string,
  config: OpenPlanrConfig,
  opts: Record<string, string>
) {
  logger.heading(`Create Tasks (from ${opts.story})`);

  const title = opts.title || (await promptText('Task list title:', `Tasks for ${opts.story}`));
  const taskNames = await promptMultiText(
    'Enter task names',
    'comma-separated, e.g.: Setup, Implement API, Write tests'
  );

  const tasks = taskNames.map((name, i) => ({
    id: `${i + 1}.0`,
    title: name,
    status: 'pending' as const,
    subtasks: [],
  }));

  const storyFilename = await resolveArtifactFilename(projectDir, config, 'story', opts.story);
  const { id, filePath } = await createArtifact(projectDir, config, 'task', 'tasks/task-list.md.hbs', {
    title,
    storyId: opts.story,
    storyFilename,
    tasks,
  });

  await addChildReference(projectDir, config, 'story', opts.story, 'task', id, title);
  logger.success(`Created task list ${id}: ${title}`);
  logger.dim(`  ${filePath}`);
  logger.dim(`  ${tasks.length} tasks created`);
  logger.dim('');
  logger.dim(`Next: planr task implement ${id}`);
}
