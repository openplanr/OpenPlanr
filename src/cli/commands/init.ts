/**
 * `planr init` command.
 *
 * Initializes a new Planr project with directory structure, config,
 * and optional AI provider setup.
 */

import path from 'node:path';
import type { Command } from 'commander';
import type { AIProviderName, CodingAgentName } from '../../models/types.js';
import { createChecklist } from '../../services/checklist-service.js';
import { createDefaultConfig, saveConfig } from '../../services/config-service.js';
import { saveCredential } from '../../services/credentials-service.js';
import {
  promptConfirm,
  promptSecret,
  promptSelect,
  promptText,
} from '../../services/prompt-service.js';
import { ARTIFACT_DIRS, CONFIG_FILENAME } from '../../utils/constants.js';
import { ensureDir, fileExists } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';

export function registerInitCommand(program: Command) {
  program
    .command('init')
    .description('Initialize Planr in the current project')
    .option('--name <name>', 'project name')
    .option('--no-ai', 'skip AI setup')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const configPath = path.join(projectDir, CONFIG_FILENAME);

      if (await fileExists(configPath)) {
        const overwrite = await promptConfirm(
          `${CONFIG_FILENAME} already exists. Overwrite?`,
          false,
        );
        if (!overwrite) {
          logger.info('Init cancelled.');
          return;
        }
      }

      const projectName =
        opts.name || (await promptText('Project name:', path.basename(projectDir)));

      const config = createDefaultConfig(projectName);

      // --- AI Provider Setup ---
      if (opts.ai !== false) {
        const enableAI = await promptConfirm('Enable AI-powered planning?', true);

        if (enableAI) {
          const provider = await promptSelect<AIProviderName>('AI provider:', [
            { name: 'Anthropic (Claude)', value: 'anthropic' },
            { name: 'OpenAI (GPT-4o)', value: 'openai' },
            { name: 'Ollama (Local — free, no API key)', value: 'ollama' },
          ]);

          config.ai = { provider };

          // Collect API key for cloud providers
          if (provider === 'anthropic' || provider === 'openai') {
            const keyHint = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
            const apiKey = await promptSecret(
              `API key (or press Enter to set ${keyHint} env var later):`,
            );
            if (apiKey.trim()) {
              const storage = await saveCredential(provider, apiKey.trim());
              const where =
                storage === 'keychain'
                  ? 'OS keychain'
                  : 'encrypted file (~/.planr/credentials.enc)';
              logger.success(`API key saved to ${where}`);
            } else {
              logger.dim(
                `  No key provided. Set ${keyHint} env var or run \`planr config set-key ${provider}\`.`,
              );
            }
          }

          // Coding agent preference
          const agent = await promptSelect<CodingAgentName>('Default coding agent:', [
            { name: 'Claude Code CLI', value: 'claude' },
            { name: 'Cursor', value: 'cursor' },
            { name: 'Codex', value: 'codex' },
          ]);
          config.defaultAgent = agent;
        }
      }

      // Create directory structure
      const agileDir = path.join(projectDir, config.outputPaths.agile);
      for (const dir of Object.values(ARTIFACT_DIRS)) {
        await ensureDir(path.join(agileDir, dir));
      }
      await ensureDir(path.join(agileDir, 'diagrams'));

      // Save config
      await saveConfig(projectDir, config);
      logger.success(`Created ${CONFIG_FILENAME}`);

      // Create checklist
      await createChecklist(projectDir, config);
      logger.success(`Created agile development checklist`);

      // Summary
      logger.heading('Planr initialized!');
      logger.info(`Project: ${projectName}`);
      logger.info(`Artifacts: ${config.outputPaths.agile}/`);

      if (config.ai) {
        logger.info(`AI: ${config.ai.provider} (every command is AI-powered)`);
        logger.info(`Agent: ${config.defaultAgent || 'claude'}`);
      }

      logger.dim('');
      logger.dim('Next steps:');
      logger.dim('  planr epic create        — Create your first epic');
      logger.dim('  planr quick "description" — Quick standalone task list (no agile ceremony)');
      logger.dim('  planr rules generate     — Generate AI agent rules');
      logger.dim('  planr config show        — View configuration');
    });
}
