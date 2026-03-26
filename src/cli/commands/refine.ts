/**
 * `planr refine` command.
 *
 * AI reviews and suggests improvements for any existing artifact.
 * Shows suggestions and an improved version, then asks to apply.
 */

import { Command } from 'commander';
import { loadConfig } from '../../services/config-service.js';
import {
  readArtifactRaw,
  updateArtifact,
  findArtifactTypeById,
} from '../../services/artifact-service.js';
import { isAIConfigured, getAIProvider, generateJSON } from '../../services/ai-service.js';
import { buildRefinePrompt } from '../../ai/prompts/prompt-builder.js';
import { aiRefineResponseSchema } from '../../ai/schemas/ai-response-schemas.js';
import { promptSelect } from '../../services/prompt-service.js';
import { logger } from '../../utils/logger.js';
import chalk from 'chalk';

export function registerRefineCommand(program: Command) {
  program
    .command('refine')
    .description('AI-powered review and improvement of any artifact')
    .argument('<artifactId>', 'artifact ID (e.g., EPIC-001, FEAT-002, US-003)')
    .action(async (artifactId: string) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      if (!isAIConfigured(config)) {
        logger.error('AI not configured. Run `planr config set-provider` to enable AI.');
        process.exit(1);
      }

      const type = findArtifactTypeById(artifactId);
      if (!type) {
        logger.error(`Cannot determine artifact type from ID: ${artifactId}`);
        logger.dim('Expected format: EPIC-001, FEAT-001, US-001, TASK-001');
        process.exit(1);
      }

      const rawContent = await readArtifactRaw(projectDir, config, type, artifactId);
      if (!rawContent) {
        logger.error(`Artifact ${artifactId} not found.`);
        process.exit(1);
      }

      logger.heading(`Refine ${artifactId}`);

      const ora = (await import('ora')).default;
      const spinner = ora('AI is reviewing your artifact...').start();

      try {
        const provider = await getAIProvider(config);
        const messages = buildRefinePrompt(rawContent, type);
        const result = await generateJSON(provider, messages, aiRefineResponseSchema);

        spinner.stop();

        // Display suggestions
        console.log(chalk.dim('━'.repeat(50)));
        console.log(chalk.bold('  Suggestions:'));
        for (const suggestion of result.suggestions) {
          console.log(chalk.yellow(`    • ${suggestion}`));
        }
        console.log(chalk.dim('━'.repeat(50)));

        const action = await promptSelect('Action:', [
          { name: 'View improved version', value: 'view' },
          { name: 'Skip (keep original)', value: 'skip' },
        ]);

        if (action === 'skip') {
          logger.info('Artifact unchanged.');
          return;
        }

        // Show improved content
        const improvedStr = JSON.stringify(result.improved, null, 2);
        console.log(chalk.dim('━'.repeat(50)));
        console.log(chalk.green(improvedStr));
        console.log(chalk.dim('━'.repeat(50)));

        logger.info('Note: Full apply functionality coming in a future release.');
        logger.dim('You can manually apply these suggestions to the artifact file.');
      } catch (err) {
        spinner.stop();
        const { AIError } = await import('../../ai/errors.js');
        if (err instanceof AIError) {
          logger.error(err.userMessage);
        } else {
          throw err;
        }
      }
    });
}
