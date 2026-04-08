/**
 * `planr plan` command.
 *
 * Full agile planning flow in a single command:
 *   Epic → Features → User Stories → Tasks
 *
 * Can start from any level:
 *   --epic EPIC-001    → generates features → stories → tasks
 *   --feature FEAT-001 → generates stories → tasks
 *   --story US-001     → generates tasks
 *   (no flag)          → creates epic first, then cascades
 */

import path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import {
  buildEpicPrompt,
  buildFeaturesPrompt,
  buildStoriesPrompt,
} from '../../ai/prompts/prompt-builder.js';
import {
  aiEpicResponseSchema,
  aiFeaturesResponseSchema,
  aiStoriesResponseSchema,
} from '../../ai/schemas/ai-response-schemas.js';
import type { AIProvider } from '../../ai/types.js';
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
} from '../../services/artifact-service.js';
import { CHECKLIST, checkItem } from '../../services/checklist-service.js';
import { loadConfig } from '../../services/config-service.js';
import { promptConfirm, promptText } from '../../services/prompt-service.js';
import { renderTemplate } from '../../services/template-service.js';
import { writeFile } from '../../utils/fs.js';
import { display, logger } from '../../utils/logger.js';
import { buildTaskItems } from '../helpers/task-creation.js';

export function registerPlanCommand(program: Command) {
  program
    .command('plan')
    .description('Full agile planning flow: Epic → Features → Stories → Tasks')
    .option('--epic <epicId>', 'start from an existing epic')
    .option('--feature <featureId>', 'start from an existing feature')
    .option('--story <storyId>', 'start from an existing story (generates tasks only)')
    .option('--continue', 'continue an interrupted plan from where it left off')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      if (!isAIConfigured(config)) {
        logger.error(
          'AI must be configured for the plan command. Run `planr config set-provider`.',
        );
        process.exit(1);
      }

      const provider = await getAIProvider(config);

      try {
        if (opts.story) {
          // Start from story → generate tasks (find parent feature and generate at feature level)
          await generateTasksForSingleStory(projectDir, config, provider, opts.story);
        } else if (opts.feature) {
          // Start from feature → stories → tasks
          await planFromFeature(projectDir, config, provider, opts.feature);
        } else if (opts.epic && opts.continue) {
          // Continue an interrupted plan from where it left off
          await continuePlanFromEpic(projectDir, config, provider, opts.epic);
        } else if (opts.epic) {
          // Start from epic → features → stories → tasks
          await planFromEpic(projectDir, config, provider, opts.epic);
        } else {
          // Full flow: create epic first
          await planFromScratch(projectDir, config, provider);
        }
      } catch (err) {
        const { AIError } = await import('../../ai/errors.js');
        if (err instanceof AIError) {
          logger.error(err.userMessage);
        } else {
          throw err;
        }
      }
    });
}

async function planFromScratch(projectDir: string, config: OpenPlanrConfig, provider: AIProvider) {
  logger.heading('Full Agile Planning Flow');
  logger.dim('Epic → Features → User Stories → Tasks\n');

  // Step 1: Create Epic
  const brief = await promptText('Describe your epic in a sentence or two:');

  const existingEpics = await listArtifacts(projectDir, config, 'epic');
  const existingTitles = existingEpics.map((e) => `${e.id}: ${e.title}`);

  logger.dim('\n[1/4] Generating epic...');
  const epicMessages = buildEpicPrompt(brief, existingTitles);
  const { result: epicData } = await generateStreamingJSON(
    provider,
    epicMessages,
    aiEpicResponseSchema,
    { maxTokens: TOKEN_BUDGETS.epic },
  );

  display.line(chalk.bold(`\n  Epic: ${epicData.title}`));
  display.line(chalk.dim(`  ${epicData.solutionOverview}`));

  const continueFlow = await promptConfirm('Save epic and continue planning?', true);
  if (!continueFlow) {
    logger.info('Planning cancelled.');
    return;
  }

  const epicCriteriaArray = Array.isArray(epicData.successCriteria)
    ? epicData.successCriteria
    : [epicData.successCriteria];
  const { id: epicId } = await createArtifact(projectDir, config, 'epic', 'epics/epic.md.hbs', {
    ...epicData,
    successCriteria: epicCriteriaArray.join('; '),
    successCriteriaList: epicCriteriaArray,
    featureIds: [],
  });
  logger.success(`Created ${epicId}: ${epicData.title}`);
  await checkItem(projectDir, config, CHECKLIST.CREATE_EPIC);

  await planFromEpic(projectDir, config, provider, epicId);
}

async function planFromEpic(
  projectDir: string,
  config: OpenPlanrConfig,
  provider: AIProvider,
  epicId: string,
) {
  // Step 2: Generate Features
  const epicRaw = await readArtifactRaw(projectDir, config, 'epic', epicId);
  if (!epicRaw) {
    logger.error(`Epic ${epicId} not found.`);
    return;
  }

  const existingFeatures = await listArtifacts(projectDir, config, 'feature');
  const existingFeatureTitles = existingFeatures.map((f) => `${f.id}: ${f.title}`);

  logger.dim('\n[2/4] Generating features...');
  const featureMessages = buildFeaturesPrompt(epicRaw, existingFeatureTitles);
  const { result: featureResult } = await generateStreamingJSON(
    provider,
    featureMessages,
    aiFeaturesResponseSchema,
    { maxTokens: TOKEN_BUDGETS.feature },
  );

  display.line(chalk.bold(`\n  Generated ${featureResult.features.length} features:`));
  featureResult.features.forEach((f, i) => {
    display.line(chalk.dim(`    ${i + 1}. ${f.title}`));
  });

  const continueFeatures = await promptConfirm(
    `Create all ${featureResult.features.length} features and continue?`,
    true,
  );
  if (!continueFeatures) {
    logger.info('Planning paused after epic.');
    return;
  }

  const featureIds: string[] = [];
  const epicFilename = await resolveArtifactFilename(projectDir, config, 'epic', epicId);
  for (const feat of featureResult.features) {
    const { id } = await createArtifact(projectDir, config, 'feature', 'features/feature.md.hbs', {
      title: feat.title,
      epicId,
      epicFilename,
      owner: config.author || 'Engineering',
      overview: feat.overview,
      functionalRequirements: feat.functionalRequirements,
      dependencies: feat.dependencies,
      technicalConsiderations: feat.technicalConsiderations,
      risks: feat.risks,
      successMetrics: feat.successMetrics,
      storyIds: [],
    });
    featureIds.push(id);
    await addChildReference(projectDir, config, 'epic', epicId, 'feature', id, feat.title);
    logger.success(`Created ${id}: ${feat.title}`);
  }
  await checkItem(projectDir, config, CHECKLIST.CREATE_FEATURES);

  // Step 3+4: Stories and tasks for each feature
  let totalStories = 0;
  let totalTasks = 0;
  for (const featureId of featureIds) {
    const counts = await planFromFeature(projectDir, config, provider, featureId);
    totalStories += counts.stories;
    totalTasks += counts.tasks;
  }

  // Final summary — only count artifacts created in this run
  logger.heading('\nPlanning Complete!');
  display.line(`  Epic:     ${epicId}`);
  display.line(`  Features: ${featureIds.length}`);
  display.line(`  Stories:  ${totalStories}`);
  display.line(`  Tasks:    ${totalTasks}`);
  logger.dim('');
  logger.dim('Start implementing:');
  logger.dim('  planr rules generate              — Generate rules for your coding agent');
  logger.dim('  planr status');
}

async function continuePlanFromEpic(
  projectDir: string,
  config: OpenPlanrConfig,
  provider: AIProvider,
  epicId: string,
) {
  const epicRaw = await readArtifactRaw(projectDir, config, 'epic', epicId);
  if (!epicRaw) {
    logger.error(`Epic ${epicId} not found.`);
    return;
  }

  logger.heading('Continuing Interrupted Plan');
  logger.dim(`Scanning existing artifacts for ${epicId}...\n`);

  // Discover existing features for this epic
  const allFeatures = await listArtifacts(projectDir, config, 'feature');
  const epicFeatureIds: string[] = [];
  for (const feat of allFeatures) {
    const data = await readArtifact(projectDir, config, 'feature', feat.id);
    if (data?.data.epicId === epicId) {
      epicFeatureIds.push(feat.id);
    }
  }

  if (epicFeatureIds.length === 0) {
    logger.info('No features found — running full plan from epic.');
    await planFromEpic(projectDir, config, provider, epicId);
    return;
  }

  display.line(`  Found ${epicFeatureIds.length} existing feature(s)`);

  // Discover existing stories and tasks, grouped by feature
  const allStories = await listArtifacts(projectDir, config, 'story');
  const allTasks = await listArtifacts(projectDir, config, 'task');

  const storiesByFeature = new Map<string, string[]>();
  for (const story of allStories) {
    const data = await readArtifact(projectDir, config, 'story', story.id);
    const fId = data?.data.featureId as string | undefined;
    if (fId && epicFeatureIds.includes(fId)) {
      const list = storiesByFeature.get(fId);
      if (list) {
        list.push(story.id);
      } else {
        storiesByFeature.set(fId, [story.id]);
      }
    }
  }

  const tasksByFeature = new Map<string, string[]>();
  for (const task of allTasks) {
    const data = await readArtifact(projectDir, config, 'task', task.id);
    const fId = data?.data.featureId as string | undefined;
    if (fId && epicFeatureIds.includes(fId)) {
      const list = tasksByFeature.get(fId);
      if (list) {
        list.push(task.id);
      } else {
        tasksByFeature.set(fId, [task.id]);
      }
    }
  }

  // Classify each feature
  const needsStoriesAndTasks: string[] = [];
  const needsTasksOnly: { featureId: string; storyIds: string[] }[] = [];
  let skipped = 0;

  for (const featureId of epicFeatureIds) {
    const stories = storiesByFeature.get(featureId);
    const tasks = tasksByFeature.get(featureId);

    if (!stories || stories.length === 0) {
      needsStoriesAndTasks.push(featureId);
    } else if (!tasks || tasks.length === 0) {
      needsTasksOnly.push({ featureId, storyIds: stories });
    } else {
      skipped++;
    }
  }

  display.line(`  ${skipped} feature(s) already complete — skipping`);
  if (needsStoriesAndTasks.length > 0) {
    display.line(`  ${needsStoriesAndTasks.length} feature(s) need stories + tasks`);
  }
  if (needsTasksOnly.length > 0) {
    display.line(`  ${needsTasksOnly.length} feature(s) need tasks only`);
  }

  if (needsStoriesAndTasks.length === 0 && needsTasksOnly.length === 0) {
    logger.success('\nAll features already have stories and tasks — nothing to continue.');
    return;
  }

  const proceed = await promptConfirm('Continue generating missing artifacts?', true);
  if (!proceed) {
    logger.info('Cancelled.');
    return;
  }

  let totalStories = 0;
  let totalTasks = 0;

  // Generate stories + tasks for features that have neither
  for (const featureId of needsStoriesAndTasks) {
    const counts = await planFromFeature(projectDir, config, provider, featureId);
    totalStories += counts.stories;
    totalTasks += counts.tasks;
  }

  // Generate tasks only for features that already have stories
  for (const { featureId, storyIds } of needsTasksOnly) {
    logger.dim(`\nGenerating tasks for ${featureId} (${storyIds.length} existing stories)...`);
    const created = await generateTasksForFeature(
      projectDir,
      config,
      provider,
      featureId,
      storyIds,
    );
    if (created) totalTasks++;
  }

  logger.heading('\nContinue Complete!');
  display.line(`  Epic:     ${epicId}`);
  display.line(`  Features: ${epicFeatureIds.length} (${skipped} already done)`);
  display.line(`  Stories:  ${totalStories} new`);
  display.line(`  Tasks:    ${totalTasks} new`);
  logger.dim('');
  logger.dim('Start implementing:');
  logger.dim('  planr rules generate              — Generate rules for your coding agent');
  logger.dim('  planr status');
}

async function planFromFeature(
  projectDir: string,
  config: OpenPlanrConfig,
  provider: AIProvider,
  featureId: string,
): Promise<{ stories: number; tasks: number }> {
  // Step 3: Generate Stories
  const featureRaw = await readArtifactRaw(projectDir, config, 'feature', featureId);
  if (!featureRaw) {
    logger.error(`Feature ${featureId} not found.`);
    return { stories: 0, tasks: 0 };
  }

  const featureData = await readArtifact(projectDir, config, 'feature', featureId);
  const epicId = featureData?.data.epicId as string | undefined;
  let epicRaw = '';
  if (epicId) {
    epicRaw = (await readArtifactRaw(projectDir, config, 'epic', epicId)) || '';
  }

  const existingStories = await listArtifacts(projectDir, config, 'story');
  const existingStoryTitles = existingStories.map((s) => `${s.id}: ${s.title}`);

  logger.dim(`\n[3/4] Generating stories for ${featureId}...`);
  const storyMessages = buildStoriesPrompt(featureRaw, epicRaw, existingStoryTitles);
  const { result: storyResult } = await generateStreamingJSON(
    provider,
    storyMessages,
    aiStoriesResponseSchema,
    { maxTokens: TOKEN_BUDGETS.story },
  );

  display.line(chalk.dim(`  Generated ${storyResult.stories.length} stories for ${featureId}`));

  const storyDir = path.join(projectDir, getArtifactDir(config, 'story'));
  const storyIds: string[] = [];
  const featureFilename = await resolveArtifactFilename(projectDir, config, 'feature', featureId);

  for (const story of storyResult.stories) {
    const { id } = await createArtifact(projectDir, config, 'story', 'stories/user-story.md.hbs', {
      title: story.title,
      featureId,
      featureFilename,
      role: story.role,
      goal: story.goal,
      benefit: story.benefit,
      additionalNotes: story.additionalNotes || undefined,
    });

    // Gherkin file
    const gherkinContent = await renderTemplate(
      'stories/gherkin.feature.hbs',
      {
        id,
        title: story.title,
        role: story.role,
        goal: story.goal,
        benefit: story.benefit,
        scenarios: story.gherkinScenarios.map((s) => ({
          name: s.name,
          given: s.given,
          when: s.when,
          then: s.then,
        })),
      },
      config.templateOverrides,
    );
    await writeFile(path.join(storyDir, `${id}-gherkin.feature`), gherkinContent);

    storyIds.push(id);
    await addChildReference(projectDir, config, 'feature', featureId, 'story', id, story.title);
    logger.success(`Created ${id}: ${story.title}`);
  }
  await checkItem(projectDir, config, CHECKLIST.CREATE_STORIES);

  // Step 4: Generate one task list per feature (all stories + full context)
  const taskCreated = await generateTasksForFeature(
    projectDir,
    config,
    provider,
    featureId,
    storyIds,
  );
  return { stories: storyIds.length, tasks: taskCreated ? 1 : 0 };
}

async function generateTasksForFeature(
  projectDir: string,
  config: OpenPlanrConfig,
  provider: AIProvider,
  featureId: string,
  storyIds: string[],
): Promise<boolean> {
  const { gatherFeatureArtifacts } = await import('../../services/artifact-gathering.js');
  const { buildTasksPrompt } = await import('../../ai/prompts/prompt-builder.js');
  const { aiTasksResponseSchema } = await import('../../ai/schemas/ai-response-schemas.js');

  let ctx: Awaited<ReturnType<typeof gatherFeatureArtifacts>>;
  try {
    ctx = await gatherFeatureArtifacts(projectDir, config, featureId);
  } catch (err) {
    logger.debug('Failed to gather feature artifacts', err);
    logger.error(`Feature ${featureId} not found.`);
    return false;
  }

  logger.dim(`\n[4/4] Generating tasks for ${featureId} (${ctx.stories.length} stories)...`);
  ctx.scope = { type: 'feature', id: featureId };
  const taskMessages = buildTasksPrompt(ctx);
  const { result } = await generateStreamingJSON(provider, taskMessages, aiTasksResponseSchema, {
    maxTokens: TOKEN_BUDGETS.taskFeature,
  });

  const tasks = buildTaskItems(result);

  const featureFilename = await resolveArtifactFilename(projectDir, config, 'feature', featureId);

  // Build artifact sources for traceability
  const artifactSources: Array<{ type: string; path: string }> = [];
  for (const s of ctx.stories) {
    artifactSources.push({
      type: 'User Story',
      path: `${config.outputPaths.agile}/stories/${s.id}`,
    });
  }
  for (const g of ctx.gherkinScenarios) {
    artifactSources.push({
      type: 'Gherkin',
      path: `${config.outputPaths.agile}/stories/${g.storyId}-gherkin.feature`,
    });
  }
  for (const a of ctx.adrs) {
    artifactSources.push({ type: 'ADR', path: `${config.outputPaths.agile}/adrs/${a.id}` });
  }

  const { id } = await createArtifact(projectDir, config, 'task', 'tasks/task-list.md.hbs', {
    title: result.title,
    featureId,
    featureFilename,
    tasks,
    artifactSources,
    acceptanceCriteriaMapping: result.acceptanceCriteriaMapping,
    relevantFiles: result.relevantFiles,
  });

  const total = tasks.reduce((sum, t) => sum + t.subtasks.length + 1, 0);

  // Link task list from each story
  for (const sId of storyIds) {
    await addChildReference(projectDir, config, 'story', sId, 'task', id, result.title);
  }

  await checkItem(projectDir, config, CHECKLIST.CREATE_TASKS);
  logger.success(
    `Created ${id}: ${result.title} (${total} tasks from ${ctx.stories.length} stories)`,
  );
  return true;
}

async function generateTasksForSingleStory(
  projectDir: string,
  config: OpenPlanrConfig,
  provider: AIProvider,
  storyId: string,
) {
  // Find parent feature and generate tasks at feature level
  const storyData = await readArtifact(projectDir, config, 'story', storyId);
  if (!storyData) {
    logger.error(`Story ${storyId} not found.`);
    return;
  }

  const featureId = storyData.data.featureId as string | undefined;
  if (featureId) {
    logger.dim(`Story ${storyId} belongs to ${featureId} — generating tasks at feature level.`);
    await generateTasksForFeature(projectDir, config, provider, featureId, [storyId]);
  } else {
    // Orphan story — fall back to story-level gathering
    const { gatherStoryArtifacts } = await import('../../services/artifact-gathering.js');
    const { buildTasksPrompt } = await import('../../ai/prompts/prompt-builder.js');
    const { aiTasksResponseSchema } = await import('../../ai/schemas/ai-response-schemas.js');

    const ctx = await gatherStoryArtifacts(projectDir, config, storyId);
    logger.dim(`\nGenerating tasks for ${storyId}...`);
    ctx.scope = { type: 'story', id: storyId };
    const taskMessages = buildTasksPrompt(ctx);
    const { result } = await generateStreamingJSON(provider, taskMessages, aiTasksResponseSchema, {
      maxTokens: TOKEN_BUDGETS.plan,
    });

    const tasks = buildTaskItems(result);

    const storyFilename = await resolveArtifactFilename(projectDir, config, 'story', storyId);
    const artifactSources: Array<{ type: string; path: string }> = [];
    for (const s of ctx.stories) {
      artifactSources.push({
        type: 'User Story',
        path: `${config.outputPaths.agile}/stories/${s.id}`,
      });
    }
    for (const g of ctx.gherkinScenarios) {
      artifactSources.push({
        type: 'Gherkin',
        path: `${config.outputPaths.agile}/stories/${g.storyId}-gherkin.feature`,
      });
    }
    for (const a of ctx.adrs) {
      artifactSources.push({ type: 'ADR', path: `${config.outputPaths.agile}/adrs/${a.id}` });
    }

    const { id } = await createArtifact(projectDir, config, 'task', 'tasks/task-list.md.hbs', {
      title: result.title,
      storyId,
      storyFilename,
      tasks,
      artifactSources,
      acceptanceCriteriaMapping: result.acceptanceCriteriaMapping,
      relevantFiles: result.relevantFiles,
    });

    const total = tasks.reduce((sum, t) => sum + t.subtasks.length + 1, 0);
    await addChildReference(projectDir, config, 'story', storyId, 'task', id, result.title);
    await checkItem(projectDir, config, CHECKLIST.CREATE_TASKS);
    logger.success(`Created ${id}: ${result.title} (${total} tasks)`);
  }
}
