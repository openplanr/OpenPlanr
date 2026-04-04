/**
 * `planr story` command group.
 *
 * AI-powered by default: reads the parent feature and epic context
 * to generate user stories with Gherkin scenarios.
 */

import path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { buildStoriesPrompt } from '../../ai/prompts/prompt-builder.js';
import { aiStoriesResponseSchema } from '../../ai/schemas/ai-response-schemas.js';
import { TOKEN_BUDGETS } from '../../ai/types.js';
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
import { loadConfig } from '../../services/config-service.js';
import { promptConfirm, promptText } from '../../services/prompt-service.js';
import { renderTemplate } from '../../services/template-service.js';
import { writeFile } from '../../utils/fs.js';
import { display, logger } from '../../utils/logger.js';

export function registerStoryCommand(program: Command) {
  const story = program.command('story').description('Manage user stories');

  story
    .command('create')
    .description('Create user stories from a feature or all features under an epic')
    .option('--feature <featureId>', 'parent feature ID (e.g., FEAT-001)')
    .option(
      '--epic <epicId>',
      'parent epic ID — generates stories for ALL features under this epic',
    )
    .option('--title <title>', 'story title (manual mode only)')
    .option('--manual', 'use manual interactive prompts instead of AI')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      // Validate: exactly one of --feature or --epic must be provided
      if (opts.feature && opts.epic) {
        logger.error('Cannot use both --feature and --epic. Choose one.');
        process.exit(1);
      }
      if (!opts.feature && !opts.epic) {
        logger.error('Must provide --feature <featureId> or --epic <epicId>.');
        process.exit(1);
      }

      if (opts.epic) {
        // Batch mode: generate stories for all features under the epic
        if (opts.manual) {
          logger.error('--manual is not supported with --epic. Use --feature for manual mode.');
          process.exit(1);
        }
        if (!isAIConfigured(config)) {
          logger.error('AI not configured. Run `planr config set-provider` to enable AI.');
          process.exit(1);
        }

        const epicData = await readArtifact(projectDir, config, 'epic', opts.epic);
        if (!epicData) {
          logger.error(`Epic ${opts.epic} not found.`);
          process.exit(1);
        }

        // Find all features under this epic
        const allFeatures = await listArtifacts(projectDir, config, 'feature');
        const epicFeatures: Array<{ id: string; title: string }> = [];
        for (const f of allFeatures) {
          const data = await readArtifact(projectDir, config, 'feature', f.id);
          if (data && data.data.epicId === opts.epic) {
            epicFeatures.push({ id: f.id, title: (data.data.title as string) || f.title });
          }
        }

        if (epicFeatures.length === 0) {
          logger.error(
            `No features found under ${opts.epic}. Create features first with \`planr feature create --epic ${opts.epic}\`.`,
          );
          process.exit(1);
        }

        logger.heading(`Batch Story Generation for ${opts.epic}`);
        display.line(chalk.dim(`Found ${epicFeatures.length} feature(s):`));
        for (const f of epicFeatures) {
          display.line(chalk.dim(`  ${f.id}: ${f.title}`));
        }
        display.blank();

        const confirmBatch = await promptConfirm(
          `Generate stories for all ${epicFeatures.length} features?`,
          true,
        );
        if (!confirmBatch) {
          logger.info('Batch story generation cancelled.');
          return;
        }

        let totalCreated = 0;
        for (const feature of epicFeatures) {
          const count = await createStoriesWithAI(projectDir, config, feature.id);
          totalCreated += count;
        }

        display.blank();
        display.separator(50);
        logger.success(
          `Batch complete: created ${totalCreated} stories across ${epicFeatures.length} features.`,
        );
        logger.dim('');
        logger.heading('Next steps:');
        logger.dim('  1. planr story list                          — View all stories');
        logger.dim('  2. planr task create --story <ID>            — Generate tasks for a story');
        logger.dim('  3. planr task create --feature <ID>          — Generate tasks for a feature');
        return;
      }

      // Single feature mode
      const featureData = await readArtifact(projectDir, config, 'feature', opts.feature);
      if (!featureData) {
        logger.error(`Feature ${opts.feature} not found.`);
        process.exit(1);
      }

      const useAI = !opts.manual && isAIConfigured(config);

      if (useAI) {
        await createStoriesWithAI(projectDir, config, opts.feature);
      } else {
        if (!opts.manual && !isAIConfigured(config)) {
          logger.warn('AI not configured. Using manual mode.');
        }
        await createStoryManually(projectDir, config, opts);
      }
    });

  story
    .command('list')
    .description('List user stories')
    .option('--feature <featureId>', 'filter by feature ID')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const stories = await listArtifacts(projectDir, config, 'story');

      if (stories.length === 0) {
        logger.info('No stories found. Run "planr story create --feature <ID>" to create one.');
        return;
      }

      // Filter by feature if specified
      let filtered = stories;
      if (opts.feature) {
        filtered = [];
        for (const s of stories) {
          const data = await readArtifact(projectDir, config, 'story', s.id);
          if (data && data.data.featureId === opts.feature) {
            filtered.push(s);
          }
        }
        if (filtered.length === 0) {
          logger.info(`No stories found for feature ${opts.feature}.`);
          return;
        }
      }

      logger.heading('User Stories');
      for (const s of filtered) {
        display.line(`  ${s.id}  ${s.title}`);
      }
    });
}

/**
 * Generate stories with AI for a single feature. Returns the number of stories created.
 */
async function createStoriesWithAI(
  projectDir: string,
  config: import('../../models/types.js').OpenPlanrConfig,
  featureId: string,
): Promise<number> {
  logger.heading(`Create User Stories (AI-powered from ${featureId})`);

  const featureRaw = await readArtifactRaw(projectDir, config, 'feature', featureId);
  if (!featureRaw) {
    logger.error(`Could not read feature ${featureId}.`);
    return 0;
  }

  // Read parent epic for context
  const featureData = await readArtifact(projectDir, config, 'feature', featureId);
  const epicId = featureData?.data.epicId as string | undefined;
  let epicRaw = '';
  if (epicId) {
    epicRaw = (await readArtifactRaw(projectDir, config, 'epic', epicId)) || '';
  }

  // Find existing stories for THIS feature (for dedup + warning)
  const allStories = await listArtifacts(projectDir, config, 'story');
  const featureStories: Array<{ id: string; title: string }> = [];
  for (const s of allStories) {
    const data = await readArtifact(projectDir, config, 'story', s.id);
    if (data && data.data.featureId === featureId) {
      featureStories.push({ id: s.id, title: (data.data.title as string) || s.title });
    }
  }

  if (featureStories.length > 0) {
    logger.warn(`${featureId} already has ${featureStories.length} story/stories:`);
    for (const s of featureStories) {
      display.line(chalk.dim(`  ${s.id}: ${s.title}`));
    }
    const continueCreate = await promptConfirm(
      'Generate additional stories? (AI will avoid duplicates)',
      false,
    );
    if (!continueCreate) {
      logger.info('Story creation cancelled.');
      return 0;
    }
  }

  const existingTitles = featureStories.map((s) => `${s.id}: ${s.title}`);

  logger.dim('AI is generating user stories...');

  try {
    const provider = await getAIProvider(config);
    const messages = buildStoriesPrompt(featureRaw, epicRaw, existingTitles);
    const { result } = await generateStreamingJSON(provider, messages, aiStoriesResponseSchema, {
      maxTokens: TOKEN_BUDGETS.story,
    });

    // Display generated stories
    display.separator(50);
    result.stories.forEach((story, i) => {
      display.heading(`  ${i + 1}. ${story.title}`);
      display.line(chalk.dim(`     As a ${story.role}, I want to ${story.goal}`));
      display.line(chalk.dim(`     So that ${story.benefit}`));
      display.line(`     Scenarios: ${story.gherkinScenarios.length}`);
    });
    display.separator(50);

    const confirmAll = await promptConfirm(
      `Create all ${result.stories.length} user stories?`,
      true,
    );

    if (!confirmAll) {
      logger.info('Story creation cancelled.');
      return 0;
    }

    const createdIds: string[] = [];
    const storyDir = path.join(projectDir, getArtifactDir(config, 'story'));
    const featureFilename = await resolveArtifactFilename(projectDir, config, 'feature', featureId);

    for (const story of result.stories) {
      // Create the user story markdown
      const { id, filePath } = await createArtifact(
        projectDir,
        config,
        'story',
        'stories/user-story.md.hbs',
        {
          title: story.title,
          featureId,
          featureFilename,
          role: story.role,
          goal: story.goal,
          benefit: story.benefit,
          additionalNotes: story.additionalNotes || undefined,
        },
      );

      // Create companion Gherkin file
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
      const gherkinPath = path.join(storyDir, `${id}-gherkin.feature`);
      await writeFile(gherkinPath, gherkinContent);

      createdIds.push(id);
      await addChildReference(projectDir, config, 'feature', featureId, 'story', id, story.title);
      logger.success(`Created ${id}: ${story.title}`);
      logger.dim(`  ${filePath}`);
    }

    logger.dim('');
    logger.heading('Next steps:');
    logger.dim(
      `  1. planr task create --story ${createdIds[0]}      — Generate implementation tasks`,
    );
    logger.dim(
      `  2. planr rules generate                    — Generate rules for your coding agent`,
    );

    return createdIds.length;
  } catch (err) {
    const { AIError } = await import('../../ai/errors.js');
    if (err instanceof AIError) {
      logger.error(err.userMessage);
    } else {
      throw err;
    }
    return 0;
  }
}

async function createStoryManually(
  projectDir: string,
  config: import('../../models/types.js').OpenPlanrConfig,
  opts: Record<string, string>,
) {
  logger.heading(`Create User Story (from ${opts.feature})`);

  const title = opts.title || (await promptText('Story title:'));
  const role = await promptText('As a (role):');
  const goal = await promptText('I want to (goal):');
  const benefit = await promptText('So that (benefit):');
  const additionalNotes = await promptText('Additional notes:', '');

  const featureFilename = await resolveArtifactFilename(
    projectDir,
    config,
    'feature',
    opts.feature,
  );
  const { id, filePath } = await createArtifact(
    projectDir,
    config,
    'story',
    'stories/user-story.md.hbs',
    {
      title,
      featureId: opts.feature,
      featureFilename,
      role,
      goal,
      benefit,
      additionalNotes: additionalNotes || undefined,
    },
  );

  // Create companion Gherkin file
  const storyDir = path.join(projectDir, getArtifactDir(config, 'story'));
  const gherkinContent = await renderTemplate(
    'stories/gherkin.feature.hbs',
    {
      id,
      title,
      role,
      goal,
      benefit,
      scenarios: [
        {
          name: 'Happy path',
          given: 'the preconditions are met',
          when: `the user ${goal.toLowerCase()}`,
          then: 'the expected outcome occurs',
        },
      ],
    },
    config.templateOverrides,
  );
  const gherkinPath = path.join(storyDir, `${id}-gherkin.feature`);
  await writeFile(gherkinPath, gherkinContent);

  await addChildReference(projectDir, config, 'feature', opts.feature, 'story', id, title);
  logger.success(`Created user story ${id}: ${title}`);
  logger.dim(`  ${filePath}`);
  logger.dim(`  ${gherkinPath}`);
  logger.dim('');
  logger.dim(`Next: planr task create --story ${id}`);
}
