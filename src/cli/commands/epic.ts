/**
 * `planr epic` command group.
 *
 * AI-powered by default: user provides a brief description,
 * AI expands into a full epic. Use --manual for the legacy
 * interactive prompt flow.
 */

import type { Command } from 'commander';
import { buildEpicPrompt } from '../../ai/prompts/prompt-builder.js';
import { aiEpicResponseSchema } from '../../ai/schemas/ai-response-schemas.js';
import { TOKEN_BUDGETS } from '../../ai/types.js';
import { generateStreamingJSON, getAIProvider, isAIConfigured } from '../../services/ai-service.js';
import { createArtifact, listArtifacts } from '../../services/artifact-service.js';
import { CHECKLIST, checkItem } from '../../services/checklist-service.js';
import { loadConfig } from '../../services/config-service.js';
import { requireInteractiveForManual } from '../../services/interactive-state.js';
import {
  promptEditor,
  promptMultiText,
  promptSelect,
  promptText,
} from '../../services/prompt-service.js';
import { display, logger } from '../../utils/logger.js';

export function registerEpicCommand(program: Command) {
  const epic = program.command('epic').description('Manage epics');

  epic
    .command('create')
    .description('Create a new epic')
    .option('--title <title>', 'epic title or brief description')
    .option('--file <path>', 'read epic description from a file (e.g., a PRD)')
    .option('--owner <owner>', 'epic owner')
    .option('--manual', 'use manual interactive prompts instead of AI')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const useAI = !opts.manual && isAIConfigured(config);

      requireInteractiveForManual(opts.manual);

      if (useAI) {
        await createEpicWithAI(projectDir, config, opts);
      } else {
        if (!opts.manual && !isAIConfigured(config)) {
          logger.warn(
            'AI not configured. Using manual mode. Run `planr config set-provider` to enable AI.',
          );
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
        display.line(`  ${e.id}  ${e.title}`);
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
  display.separator(50);
  display.heading(`  Title:            ${epicData.title}`);
  display.line(`  Owner:            ${epicData.owner}`);
  display.line(`  Business Value:   ${epicData.businessValue}`);
  display.line(`  Target Users:     ${epicData.targetUsers}`);
  display.line(`  Problem:          ${epicData.problemStatement}`);
  display.line(`  Solution:         ${epicData.solutionOverview}`);
  display.line(`  Success Criteria:`);
  const criteria = Array.isArray(epicData.successCriteria)
    ? epicData.successCriteria
    : [epicData.successCriteria];
  for (const c of criteria) {
    display.line(`    • ${c}`);
  }
  display.line(`  Key Features:`);
  for (const f of epicData.keyFeatures) {
    display.line(`    • ${f}`);
  }
  display.line(`  Dependencies:     ${epicData.dependencies || 'None'}`);
  display.line(`  Risks:            ${epicData.risks || 'None'}`);
  display.separator(50);
}

async function createEpicWithAI(
  projectDir: string,
  config: import('../../models/types.js').OpenPlanrConfig,
  opts: Record<string, string>,
) {
  logger.heading('Create Epic (AI-powered)');

  let brief: string;
  if (opts.file) {
    try {
      const { readFile } = await import('../../utils/fs.js');
      const path = await import('node:path');
      brief = await readFile(path.resolve(opts.file));
      logger.dim(`Read ${brief.split('\n').length} lines from ${opts.file}`);
    } catch (err) {
      logger.debug('Failed to read epic input file', err);
      logger.error(`Failed to read file: ${opts.file}`);
      return;
    }
  } else if (opts.title) {
    brief = opts.title;
  } else {
    brief = await promptText('Describe your epic:');
  }

  // Get existing epics for deduplication
  const existingEpics = await listArtifacts(projectDir, config, 'epic');
  const existingTitles = existingEpics.map((e) => `${e.id}: ${e.title}`);

  logger.dim('AI is generating your epic...');

  try {
    const provider = await getAIProvider(config);
    const messages = buildEpicPrompt(brief, existingTitles);
    let { result: epicData } = await generateStreamingJSON(
      provider,
      messages,
      aiEpicResponseSchema,
      { maxTokens: TOKEN_BUDGETS.epic },
    );

    displayEpic(epicData);

    // Action loop: save, edit, regenerate, cancel
    let saved = false;
    while (!saved) {
      const action = await promptSelect(
        'Action:',
        [
          { name: 'Save this epic', value: 'save' },
          { name: 'Edit before saving', value: 'edit' },
          { name: 'Regenerate', value: 'regenerate' },
          { name: 'Cancel', value: 'cancel' },
        ],
        'save',
      );

      if (action === 'cancel') {
        logger.info('Epic creation cancelled.');
        return;
      }

      if (action === 'regenerate') {
        logger.dim('Regenerating...');
        ({ result: epicData } = await generateStreamingJSON(
          provider,
          messages,
          aiEpicResponseSchema,
          { maxTokens: TOKEN_BUDGETS.epic },
        ));
        displayEpic(epicData);
        continue;
      }

      if (action === 'edit') {
        const editContent = JSON.stringify(epicData, null, 2);
        const edited = await promptEditor(
          'Edit the epic JSON (save & close to apply):',
          editContent,
        );
        try {
          const parsed = JSON.parse(edited);
          const validated = aiEpicResponseSchema.parse(parsed);
          epicData = validated;
          displayEpic(epicData);
          continue;
        } catch (_err) {
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
    const { id, filePath } = await createArtifact(
      projectDir,
      config,
      'epic',
      'epics/epic.md.hbs',
      templateData,
    );

    logger.success(`Created epic ${id}: ${epicData.title}`);
    logger.dim(`  ${filePath}`);
    await checkItem(projectDir, config, CHECKLIST.CREATE_EPIC);
    logger.dim('');
    logger.heading('Next steps:');
    logger.dim(`  1. planr feature create --epic ${id}    — Break epic into features`);
    logger.dim(`  2. planr story create --feature FEAT-*   — Create user stories per feature`);
    logger.dim(`  3. planr task create --feature FEAT-*    — Generate implementation tasks`);
    logger.dim(`  4. planr rules generate                 — Generate rules for your coding agent`);
    logger.dim('');
    logger.dim(`  Or run the full flow at once:`);
    logger.dim(
      `  planr plan --epic ${id}                  — Auto-generate features → stories → tasks`,
    );
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
  opts: Record<string, string>,
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
  await checkItem(projectDir, config, CHECKLIST.CREATE_EPIC);
  logger.dim('');
  logger.heading('Next steps:');
  logger.dim(`  1. planr feature create --epic ${id}    — Break epic into features`);
  logger.dim(`  2. planr story create --feature FEAT-*   — Create user stories per feature`);
  logger.dim(`  3. planr task create --story US-*        — Generate implementation tasks`);
  logger.dim(`  4. planr rules generate                 — Generate rules for your coding agent`);
}
