/**
 * `planr epic` command group.
 *
 * AI-powered by default: user provides a brief description,
 * AI expands into a full epic. Use --manual for the legacy
 * interactive prompt flow.
 */

import { Command } from 'commander';
import { loadConfig } from '../../services/config-service.js';
import { createArtifact, listArtifacts, resolveArtifactFilename } from '../../services/artifact-service.js';
import { isAIConfigured, getAIProvider, generateStreamingJSON } from '../../services/ai-service.js';
import { promptText, promptMultiText, promptSelect, promptEditor } from '../../services/prompt-service.js';
import { buildEpicPrompt } from '../../ai/prompts/prompt-builder.js';
import { aiEpicResponseSchema } from '../../ai/schemas/ai-response-schemas.js';
import { TOKEN_BUDGETS } from '../../ai/types.js';
import { logger } from '../../utils/logger.js';
import chalk from 'chalk';

export function registerEpicCommand(program: Command) {
  const epic = program.command('epic').description('Manage epics');

  epic
    .command('create')
    .description('Create a new epic')
    .option('--title <title>', 'epic title')
    .option('--owner <owner>', 'epic owner')
    .option('--manual', 'use manual interactive prompts instead of AI')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const useAI = !opts.manual && isAIConfigured(config);

      if (useAI) {
        await createEpicWithAI(projectDir, config, opts);
      } else {
        if (!opts.manual && !isAIConfigured(config)) {
          logger.warn('AI not configured. Using manual mode. Run `planr config set-provider` to enable AI.');
        }
        await createEpicManually(projectDir, config, opts);
      }
    });

  epic
    .command('list')
    .description('List all epics')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const epics = await listArtifacts(projectDir, config, 'epic');

      if (epics.length === 0) {
        logger.info('No epics found. Run "planr epic create" to create one.');
        return;
      }

      logger.heading('Epics');
      for (const e of epics) {
        console.log(`  ${e.id}  ${e.title}`);
      }
    });
}

interface DisplayableEpic {
  title: string;
  owner: string;
  businessValue: string;
  targetUsers: string;
  problemStatement: string;
  solutionOverview: string;
  successCriteria: string | string[];
  keyFeatures: string[];
  dependencies?: string;
  risks?: string;
}

function displayEpic(epicData: DisplayableEpic) {
  console.log(chalk.dim('━'.repeat(50)));
  console.log(chalk.bold(`  Title:            ${epicData.title}`));
  console.log(`  Owner:            ${epicData.owner}`);
  console.log(`  Business Value:   ${epicData.businessValue}`);
  console.log(`  Target Users:     ${epicData.targetUsers}`);
  console.log(`  Problem:          ${epicData.problemStatement}`);
  console.log(`  Solution:         ${epicData.solutionOverview}`);
  console.log(`  Success Criteria:`);
  const criteria = Array.isArray(epicData.successCriteria) ? epicData.successCriteria : [epicData.successCriteria];
  for (const c of criteria) {
    console.log(`    • ${c}`);
  }
  console.log(`  Key Features:`);
  for (const f of epicData.keyFeatures) {
    console.log(`    • ${f}`);
  }
  console.log(`  Dependencies:     ${epicData.dependencies || 'None'}`);
  console.log(`  Risks:            ${epicData.risks || 'None'}`);
  console.log(chalk.dim('━'.repeat(50)));
}

async function createEpicWithAI(
  projectDir: string,
  config: import('../../models/types.js').OpenPlanrConfig,
  opts: Record<string, string>
) {
  logger.heading('Create Epic (AI-powered)');

  const brief = opts.title || await promptText('Describe your epic in a sentence or two:');

  // Get existing epics for deduplication
  const existingEpics = await listArtifacts(projectDir, config, 'epic');
  const existingTitles = existingEpics.map((e) => `${e.id}: ${e.title}`);

  logger.dim('AI is generating your epic...');

  try {
    const provider = await getAIProvider(config);
    const messages = buildEpicPrompt(brief, existingTitles);
    let { result: epicData } = await generateStreamingJSON(provider, messages, aiEpicResponseSchema, { maxTokens: TOKEN_BUDGETS.epic });

    displayEpic(epicData);

    // Action loop: save, edit, regenerate, cancel
    let saved = false;
    while (!saved) {
      const action = await promptSelect('Action:', [
        { name: 'Save this epic', value: 'save' },
        { name: 'Edit before saving', value: 'edit' },
        { name: 'Regenerate', value: 'regenerate' },
        { name: 'Cancel', value: 'cancel' },
      ]);

      if (action === 'cancel') {
        logger.info('Epic creation cancelled.');
        return;
      }

      if (action === 'regenerate') {
        logger.dim('Regenerating...');
        ({ result: epicData } = await generateStreamingJSON(provider, messages, aiEpicResponseSchema, { maxTokens: TOKEN_BUDGETS.epic }));
        displayEpic(epicData);
        continue;
      }

      if (action === 'edit') {
        const editContent = JSON.stringify(epicData, null, 2);
        const edited = await promptEditor('Edit the epic JSON (save & close to apply):', editContent);
        try {
          const parsed = JSON.parse(edited);
          const validated = aiEpicResponseSchema.parse(parsed);
          epicData = validated;
          displayEpic(epicData);
          continue;
        } catch (err) {
          logger.error('Invalid JSON after edit. Please try again.');
          continue;
        }
      }

      // Save
      saved = true;
    }

    const criteriaArray = Array.isArray(epicData.successCriteria)
      ? epicData.successCriteria
      : [epicData.successCriteria];
    const templateData: Record<string, unknown> = {
      ...epicData,
      successCriteria: criteriaArray.join('; '),
      successCriteriaList: criteriaArray,
      featureIds: [],
    };
    const { id, filePath } = await createArtifact(projectDir, config, 'epic', 'epics/epic.md.hbs', templateData);

    logger.success(`Created epic ${id}: ${epicData.title}`);
    logger.dim(`  ${filePath}`);
    logger.dim('');
    logger.heading('Next steps:');
    logger.dim(`  1. planr feature create --epic ${id}    — Break epic into features`);
    logger.dim(`  2. planr story create --feature FEAT-*   — Create user stories per feature`);
    logger.dim(`  3. planr task create --story US-*        — Generate implementation tasks`);
    logger.dim(`  4. planr task implement TASK-*           — Implement with your coding agent`);
    logger.dim('');
    logger.dim(`  Or run the full flow at once:`);
    logger.dim(`  planr plan --epic ${id}                  — Auto-generate features → stories → tasks`);
  } catch (err) {
    const { AIError } = await import('../../ai/errors.js');
    if (err instanceof AIError) {
      logger.error(err.userMessage);
    } else {
      throw err;
    }
  }
}

async function createEpicManually(
  projectDir: string,
  config: import('../../models/types.js').OpenPlanrConfig,
  opts: Record<string, string>
) {
  logger.heading('Create Epic');

  const title = opts.title || (await promptText('Epic title:'));
  const owner = opts.owner || (await promptText('Owner:', config.author));
  const businessValue = await promptText('Business value:');
  const targetUsers = await promptText('Target users:');
  const problemStatement = await promptText('Problem statement:');
  const solutionOverview = await promptText('Solution overview:');
  const successCriteria = await promptText('Success criteria:');
  const keyFeatures = await promptMultiText('Key features', 'comma-separated');
  const dependencies = await promptText('Dependencies:', 'None');
  const risks = await promptText('Risks:', 'None');

  const { id, filePath } = await createArtifact(projectDir, config, 'epic', 'epics/epic.md.hbs', {
    title,
    owner,
    businessValue,
    targetUsers,
    problemStatement,
    solutionOverview,
    successCriteria,
    keyFeatures,
    dependencies,
    risks,
    featureIds: [],
  });

  logger.success(`Created epic ${id}: ${title}`);
  logger.dim(`  ${filePath}`);
  logger.dim('');
  logger.heading('Next steps:');
  logger.dim(`  1. planr feature create --epic ${id}    — Break epic into features`);
  logger.dim(`  2. planr story create --feature FEAT-*   — Create user stories per feature`);
  logger.dim(`  3. planr task create --story US-*        — Generate implementation tasks`);
  logger.dim(`  4. planr task implement TASK-*           — Implement with your coding agent`);
}
