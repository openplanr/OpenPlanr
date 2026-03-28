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

import { Command } from 'commander';
import path from 'node:path';
import { loadConfig } from '../../services/config-service.js';
import {
  createArtifact,
  listArtifacts,
  readArtifact,
  readArtifactRaw,
  getArtifactDir,
  resolveArtifactFilename,
  addChildReference,
} from '../../services/artifact-service.js';
import { isAIConfigured, getAIProvider, generateStreamingJSON } from '../../services/ai-service.js';
import { promptText, promptConfirm } from '../../services/prompt-service.js';
import { renderTemplate } from '../../services/template-service.js';
import { writeFile } from '../../utils/fs.js';
import { buildEpicPrompt, buildFeaturesPrompt, buildStoriesPrompt, buildTasksPrompt } from '../../ai/prompts/prompt-builder.js';
import {
  aiEpicResponseSchema,
  aiFeaturesResponseSchema,
  aiStoriesResponseSchema,
  aiTasksResponseSchema,
} from '../../ai/schemas/ai-response-schemas.js';
import { logger } from '../../utils/logger.js';
import chalk from 'chalk';
import type { OpenPlanrConfig } from '../../models/types.js';
import type { AIProvider } from '../../ai/types.js';

export function registerPlanCommand(program: Command) {
  program
    .command('plan')
    .description('Full agile planning flow: Epic → Features → Stories → Tasks')
    .option('--epic <epicId>', 'start from an existing epic')
    .option('--feature <featureId>', 'start from an existing feature')
    .option('--story <storyId>', 'start from an existing story (generates tasks only)')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      if (!isAIConfigured(config)) {
        logger.error('AI must be configured for the plan command. Run `planr config set-provider`.');
        process.exit(1);
      }

      const provider = await getAIProvider(config);

      try {
        if (opts.story) {
          // Start from story → generate tasks
          await generateTasksForStory(projectDir, config, provider, opts.story);
        } else if (opts.feature) {
          // Start from feature → stories → tasks
          await planFromFeature(projectDir, config, provider, opts.feature);
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

async function planFromScratch(
  projectDir: string,
  config: OpenPlanrConfig,
  provider: AIProvider
) {
  logger.heading('Full Agile Planning Flow');
  logger.dim('Epic → Features → User Stories → Tasks\n');

  // Step 1: Create Epic
  const brief = await promptText('Describe your epic in a sentence or two:');

  const existingEpics = await listArtifacts(projectDir, config, 'epic');
  const existingTitles = existingEpics.map((e) => `${e.id}: ${e.title}`);

  logger.dim('\n[1/4] Generating epic...');
  const epicMessages = buildEpicPrompt(brief, existingTitles);
  const { result: epicData } = await generateStreamingJSON(provider, epicMessages, aiEpicResponseSchema);

  console.log(chalk.bold(`\n  Epic: ${epicData.title}`));
  console.log(chalk.dim(`  ${epicData.solutionOverview}`));

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

  await planFromEpic(projectDir, config, provider, epicId);

}

async function planFromEpic(
  projectDir: string,
  config: OpenPlanrConfig,
  provider: AIProvider,
  epicId: string
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
  const { result: featureResult } = await generateStreamingJSON(provider, featureMessages, aiFeaturesResponseSchema);

  console.log(chalk.bold(`\n  Generated ${featureResult.features.length} features:`));
  featureResult.features.forEach((f, i) => {
    console.log(chalk.dim(`    ${i + 1}. ${f.title}`));
  });

  const continueFeatures = await promptConfirm(`Create all ${featureResult.features.length} features and continue?`, true);
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

  // Step 3+4: Stories and tasks for each feature
  for (const featureId of featureIds) {
    await planFromFeature(projectDir, config, provider, featureId);
  }

  // Final summary
  logger.heading('\nPlanning Complete!');
  const allFeatures = await listArtifacts(projectDir, config, 'feature');
  const allStories = await listArtifacts(projectDir, config, 'story');
  const allTasks = await listArtifacts(projectDir, config, 'task');
  console.log(`  Epic:     ${epicId}`);
  console.log(`  Features: ${allFeatures.length}`);
  console.log(`  Stories:  ${allStories.length}`);
  console.log(`  Tasks:    ${allTasks.length}`);
  logger.dim('');
  logger.dim('Start implementing:');
  logger.dim('  planr task implement TASK-001 --next');
  logger.dim('  planr status');
}

async function planFromFeature(
  projectDir: string,
  config: OpenPlanrConfig,
  provider: AIProvider,
  featureId: string
) {
  // Step 3: Generate Stories
  const featureRaw = await readArtifactRaw(projectDir, config, 'feature', featureId);
  if (!featureRaw) {
    logger.error(`Feature ${featureId} not found.`);
    return;
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
  const { result: storyResult } = await generateStreamingJSON(provider, storyMessages, aiStoriesResponseSchema);

  console.log(chalk.dim(`  Generated ${storyResult.stories.length} stories for ${featureId}`));

  const storyDir = path.join(projectDir, getArtifactDir(config, 'story'));
  const storyIds: string[] = [];
  const featureFilename = await resolveArtifactFilename(projectDir, config, 'feature', featureId);

  for (const story of storyResult.stories) {
    const { id, filePath } = await createArtifact(projectDir, config, 'story', 'stories/user-story.md.hbs', {
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
          name: s.name, given: s.given, when: s.when, then: s.then,
        })),
      },
      config.templateOverrides
    );
    await writeFile(path.join(storyDir, `${id}-gherkin.feature`), gherkinContent);

    storyIds.push(id);
    await addChildReference(projectDir, config, 'feature', featureId, 'story', id, story.title);
    logger.success(`Created ${id}: ${story.title}`);
  }

  // Step 4: Generate tasks for each story
  for (const storyId of storyIds) {
    await generateTasksForStory(projectDir, config, provider, storyId);
  }
}

async function generateTasksForStory(
  projectDir: string,
  config: OpenPlanrConfig,
  provider: AIProvider,
  storyId: string
) {
  const { gatherStoryArtifacts } = await import('../../services/artifact-gathering.js');

  let ctx;
  try {
    ctx = await gatherStoryArtifacts(projectDir, config, storyId);
  } catch {
    logger.error(`Story ${storyId} not found.`);
    return;
  }

  logger.dim(`\n[4/4] Generating tasks for ${storyId}...`);
  ctx.scope = { type: 'story', id: storyId };
  const taskMessages = buildTasksPrompt(ctx);
  const { result } = await generateStreamingJSON(provider, taskMessages, aiTasksResponseSchema);

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

  const storyFilename = await resolveArtifactFilename(projectDir, config, 'story', storyId);

  // Build artifact sources for traceability
  const artifactSources: Array<{ type: string; path: string }> = [];
  for (const s of ctx.stories) {
    artifactSources.push({ type: 'User Story', path: `${config.outputPaths.agile}/stories/${s.id}` });
  }
  for (const g of ctx.gherkinScenarios) {
    artifactSources.push({ type: 'Gherkin', path: `${config.outputPaths.agile}/stories/${g.storyId}-gherkin.feature` });
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
  logger.success(`Created ${id}: ${result.title} (${total} tasks)`);
}
