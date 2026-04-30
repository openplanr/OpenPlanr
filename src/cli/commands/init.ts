/**
 * `planr init` command.
 *
 * Initializes a new Planr project with directory structure, config,
 * and optional AI provider setup.
 */

import path from 'node:path';
import type { Command } from 'commander';
import { ENV_KEY_MAP, PROVIDER_LABELS } from '../../ai/types.js';
import { createGenerators } from '../../generators/generator-factory.js';
import type { AIProviderName, CodingAgentName, GenerationScope } from '../../models/types.js';
import { createChecklist } from '../../services/checklist-service.js';
import { createDefaultConfig, saveConfig } from '../../services/config-service.js';
import { resolveApiKeySource, saveCredential } from '../../services/credentials-service.js';
import {
  promptConfirm,
  promptSecret,
  promptSelect,
  promptText,
} from '../../services/prompt-service.js';
import { renderTemplate } from '../../services/template-service.js';
import { ARTIFACT_DIRS, CONFIG_FILENAME } from '../../utils/constants.js';
import { ensureDir, fileExists, writeFile } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';

export function registerInitCommand(program: Command) {
  program
    .command('init')
    .description('Initialize Planr in the current project')
    .option('--name <name>', 'project name')
    .option('--no-ai', 'skip AI setup')
    .option(
      '--no-pipeline-rules',
      'skip planr-pipeline rules (generates agile rules only — equivalent to running `planr rules generate --scope agile` post-init)',
    )
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const configPath = path.join(projectDir, CONFIG_FILENAME);

      if (await fileExists(configPath)) {
        const overwrite = await promptConfirm('Planr is already initialized. Overwrite?', false);
        if (!overwrite) {
          logger.info('Init cancelled.');
          return;
        }
      }

      const projectName =
        opts.name || (await promptText('Project name:', path.basename(projectDir)));

      const config = createDefaultConfig(projectName);
      let apiKeyConfigured = false;

      // --- AI Provider Setup ---
      if (opts.ai === false) {
        // Explicit --no-ai. Warn so the user knows what they lose.
        logger.warn(
          'AI features disabled (--no-ai). `planr spec decompose`, `planr refine`, ' +
            'and `planr backlog prioritize` will be unavailable. ' +
            'Re-enable later with: planr config set-provider <provider>',
        );
      }

      if (opts.ai !== false) {
        const enableAI = await promptConfirm('Enable AI-powered planning?', true);

        if (enableAI) {
          const provider = await promptSelect<AIProviderName>(
            'AI provider:',
            [
              { name: 'Anthropic (Claude)', value: 'anthropic' },
              { name: 'OpenAI (GPT-4o)', value: 'openai' },
              { name: 'Ollama (Local — free, no API key)', value: 'ollama' },
            ],
            'anthropic',
          );

          config.ai = { provider };

          // Collect API key for cloud providers
          const envVar = ENV_KEY_MAP[provider];
          if (envVar) {
            const existing = await resolveApiKeySource(provider);
            if (existing) {
              // Key already available (env var, keychain, or encrypted file)
              apiKeyConfigured = true;
              const sourceLabel =
                existing.source === 'env'
                  ? `${envVar} environment variable`
                  : existing.source === 'keychain'
                    ? 'OS keychain'
                    : 'encrypted file';
              logger.success(`API key found in ${sourceLabel}`);
            } else {
              const apiKey = await promptSecret(
                `API key (or press Enter to set ${envVar} env var later):`,
              );
              if (apiKey.trim()) {
                const storage = await saveCredential(provider, apiKey.trim());
                const where =
                  storage === 'keychain'
                    ? 'OS keychain'
                    : 'encrypted file (~/.planr/credentials.enc)';
                logger.success(`API key saved to ${where}`);
                apiKeyConfigured = true;
              }
            }
          }

          // Coding agent preference
          const agent = await promptSelect<CodingAgentName>(
            'Default coding agent:',
            [
              { name: 'Claude Code CLI', value: 'claude' },
              { name: 'Cursor', value: 'cursor' },
              { name: 'Codex', value: 'codex' },
            ],
            'claude',
          );
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

      // Create estimation guide
      const estimationPath = path.join(agileDir, 'ESTIMATION.md');
      if (!(await fileExists(estimationPath))) {
        const estimationContent = await renderTemplate('guides/estimation.md.hbs', {});
        await writeFile(estimationPath, estimationContent);
        logger.success('Created estimation guide');
      }

      // Decide rule scope: agile (default agile workflow rules) or all (agile +
      // planr-pipeline rules so Cursor/Codex/Claude pick up the spec-driven
      // workflow automatically). Interactive default is `true` to give every new
      // project a complete cross-runtime experience without an extra command.
      const includePipelineRules =
        opts.pipelineRules === false
          ? false
          : await promptConfirm(
              'Generate planr-pipeline rules (auto-activates spec-driven workflow in Cursor and Codex)?',
              true,
            );
      const ruleScope: GenerationScope = includePipelineRules ? 'all' : 'agile';

      // Generate AI agent rules
      const generators = createGenerators(config, projectDir);
      let ruleFiles = 0;
      for (const generator of generators) {
        generator.setScope(ruleScope);
        const files = await generator.generate({
          epics: [],
          features: [],
          stories: [],
          tasks: [],
        });
        for (const file of files) {
          const fullPath = path.join(projectDir, file.path);
          await ensureDir(path.dirname(fullPath));
          await writeFile(fullPath, file.content);
          ruleFiles++;
        }
      }
      logger.success(`Generated ${ruleFiles} AI agent rule file(s) (scope: ${ruleScope})`);

      // Summary
      logger.heading('Planr initialized!');
      logger.info(`Project: ${projectName}`);
      logger.info(`Artifacts: ${config.outputPaths.agile}/`);

      if (config.ai) {
        const label = PROVIDER_LABELS[config.ai.provider] ?? config.ai.provider;
        logger.info(`AI: ${label} (every command is AI-powered)`);
        logger.info(`Agent: ${config.defaultAgent || 'claude'}`);
      }

      // Warn if AI is enabled but no key was provided
      if (config.ai && ENV_KEY_MAP[config.ai.provider] && !apiKeyConfigured) {
        logger.dim('');
        logger.warn('No API key configured. Before planning, run:');
        logger.dim('');
        logger.dim(`    planr config set-key ${config.ai.provider}`);
        logger.dim('');
      }

      logger.dim('');
      logger.dim('Next steps:');
      if (config.ai && ENV_KEY_MAP[config.ai.provider] && !apiKeyConfigured) {
        logger.dim('  planr config set-key     — Configure your AI provider key');
      }
      logger.dim('  planr epic create        — Create your first epic');
      logger.dim('  planr quick "description" — Quick standalone task list (no agile ceremony)');
      if (includePipelineRules) {
        logger.dim('  planr spec create        — Author a spec for the planr-pipeline workflow');
      }
      logger.dim('  planr rules generate     — Regenerate AI agent rules after changes');
      logger.dim('  planr config show        — View configuration');
    });
}
