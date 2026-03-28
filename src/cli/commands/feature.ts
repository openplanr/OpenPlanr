/**
 * `planr feature` command group.
 *
 * AI-powered by default: reads the parent epic and generates
 * multiple features automatically. Use --manual for legacy mode.
 */

import { Command } from 'commander';
import { loadConfig } from '../../services/config-service.js';
import {
  createArtifact,
  listArtifacts,
  readArtifact,
  readArtifactRaw,
  resolveArtifactFilename,
  addChildReference,
} from '../../services/artifact-service.js';
import { isAIConfigured, getAIProvider, generateStreamingJSON } from '../../services/ai-service.js';
import { promptText, promptMultiText, promptConfirm } from '../../services/prompt-service.js';
import { buildFeaturesPrompt } from '../../ai/prompts/prompt-builder.js';
import { aiFeaturesResponseSchema } from '../../ai/schemas/ai-response-schemas.js';
import { TOKEN_BUDGETS } from '../../ai/types.js';
import { logger } from '../../utils/logger.js';
import chalk from 'chalk';

export function registerFeatureCommand(program: Command) {
  const feature = program.command('feature').description('Manage features');

  feature
    .command('create')
    .description('Create features from an epic')
    .requiredOption('--epic <epicId>', 'parent epic ID (e.g., EPIC-001)')
    .option('--title <title>', 'feature title')
    .option('--count <n>', 'number of features to generate', parseInt)
    .option('--manual', 'use manual interactive prompts instead of AI')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const epicData = await readArtifact(projectDir, config, 'epic', opts.epic);
      if (!epicData) {
        logger.error(`Epic ${opts.epic} not found.`);
        process.exit(1);
      }

      const useAI = !opts.manual && isAIConfigured(config);

      if (useAI) {
        await createFeaturesWithAI(projectDir, config, opts.epic, opts.count);
      } else {
        if (!opts.manual && !isAIConfigured(config)) {
          logger.warn('AI not configured. Using manual mode.');
        }
        await createFeatureManually(projectDir, config, opts);
      }
    });

  feature
    .command('list')
    .description('List features')
    .option('--epic <epicId>', 'filter by epic ID')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const features = await listArtifacts(projectDir, config, 'feature');

      if (features.length === 0) {
        logger.info('No features found. Run "planr feature create --epic <ID>" to create one.');
        return;
      }

      logger.heading('Features');
      for (const f of features) {
        console.log(`  ${f.id}  ${f.title}`);
      }
    });
}

async function createFeaturesWithAI(
  projectDir: string,
  config: import('../../models/types.js').OpenPlanrConfig,
  epicId: string,
  featureCount?: number
) {
  logger.heading(`Create Features (AI-powered from ${epicId})`);

  const epicRaw = await readArtifactRaw(projectDir, config, 'epic', epicId);
  if (!epicRaw) {
    logger.error(`Could not read epic ${epicId}.`);
    return;
  }

  // Find existing features for THIS epic (for dedup + warning)
  const allFeatures = await listArtifacts(projectDir, config, 'feature');
  const epicFeatures: Array<{ id: string; title: string }> = [];
  for (const f of allFeatures) {
    const data = await readArtifact(projectDir, config, 'feature', f.id);
    if (data && data.data.epicId === epicId) {
      epicFeatures.push({ id: f.id, title: (data.data.title as string) || f.title });
    }
  }

  if (epicFeatures.length > 0) {
    logger.warn(`${epicId} already has ${epicFeatures.length} feature(s):`);
    for (const f of epicFeatures) {
      console.log(chalk.dim(`  ${f.id}: ${f.title}`));
    }
    const continueCreate = await promptConfirm(
      'Generate additional features? (AI will avoid duplicates)',
      false
    );
    if (!continueCreate) {
      logger.info('Feature creation cancelled.');
      return;
    }
  }

  const existingTitles = epicFeatures.map((f) => `${f.id}: ${f.title}`);

  logger.dim('AI is generating features from the epic...');

  try {
    const provider = await getAIProvider(config);
    const messages = buildFeaturesPrompt(epicRaw, existingTitles, featureCount);
    const { result } = await generateStreamingJSON(provider, messages, aiFeaturesResponseSchema, { maxTokens: TOKEN_BUDGETS.feature });

    // Display generated features
    console.log(chalk.dim('━'.repeat(50)));
    result.features.forEach((feat, i) => {
      console.log(chalk.bold(`  ${i + 1}. ${feat.title}`));
      console.log(chalk.dim(`     ${feat.overview}`));
      console.log(`     Requirements: ${feat.functionalRequirements.length} items`);
    });
    console.log(chalk.dim('━'.repeat(50)));

    const confirmAll = await promptConfirm(
      `Create all ${result.features.length} features?`,
      true
    );

    if (!confirmAll) {
      logger.info('Feature creation cancelled.');
      return;
    }

    // Create each feature
    const createdIds: string[] = [];
    const epicFilename = await resolveArtifactFilename(projectDir, config, 'epic', epicId);
    for (const feat of result.features) {
      const { id, filePath } = await createArtifact(
        projectDir,
        config,
        'feature',
        'features/feature.md.hbs',
        {
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
        }
      );
      createdIds.push(id);
      await addChildReference(projectDir, config, 'epic', epicId, 'feature', id, feat.title);
      logger.success(`Created ${id}: ${feat.title}`);
      logger.dim(`  ${filePath}`);
    }

    logger.dim('');
    logger.heading('Next steps:');
    logger.dim(`  1. planr story create --feature ${createdIds[0]}   — Create user stories`);
    logger.dim(`  2. planr task create --story US-*            — Generate implementation tasks`);
    logger.dim(`  3. planr task implement TASK-*               — Implement with your coding agent`);
    logger.dim('');
    logger.dim(`  Or generate stories for all features at once:`);
    logger.dim(`  planr plan --epic ${epicId}                   — Auto-generate stories → tasks`);
  } catch (err) {
    const { AIError } = await import('../../ai/errors.js');
    if (err instanceof AIError) {
      logger.error(err.userMessage);
    } else {
      throw err;
    }
  }
}

async function createFeatureManually(
  projectDir: string,
  config: import('../../models/types.js').OpenPlanrConfig,
  opts: Record<string, string>
) {
  logger.heading(`Create Feature (from ${opts.epic})`);

  const title = opts.title || (await promptText('Feature title:'));
  const owner = await promptText('Owner:', config.author);
  const overview = await promptText('Overview:');
  const functionalRequirements = await promptMultiText('Functional requirements', 'comma-separated');
  const dependencies = await promptText('Dependencies:', 'None');
  const technicalConsiderations = await promptText('Technical considerations:', 'None');
  const risks = await promptText('Risks:', 'None');
  const successMetrics = await promptText('Success metrics:');

  const epicFilename = await resolveArtifactFilename(projectDir, config, 'epic', opts.epic);
  const { id, filePath } = await createArtifact(projectDir, config, 'feature', 'features/feature.md.hbs', {
    title,
    epicId: opts.epic,
    epicFilename,
    owner,
    overview,
    functionalRequirements,
    dependencies,
    technicalConsiderations,
    risks,
    successMetrics,
    storyIds: [],
  });

  await addChildReference(projectDir, config, 'epic', opts.epic, 'feature', id, title);
  logger.success(`Created feature ${id}: ${title}`);
  logger.dim(`  ${filePath}`);
  logger.dim('');
  logger.dim(`Next: planr story create --feature ${id}`);
}
