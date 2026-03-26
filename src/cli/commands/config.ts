/**
 * `planr config` command group.
 *
 * Manage AI provider settings, API keys, and coding agent preferences.
 */

import { Command } from 'commander';
import { loadConfig, saveConfig } from '../../services/config-service.js';
import { saveCredential, resolveApiKey } from '../../services/credentials-service.js';
import { promptSelect, promptSecret } from '../../services/prompt-service.js';
import { logger } from '../../utils/logger.js';
import type { AIProviderName, CodingAgentName } from '../../models/types.js';

export function registerConfigCommand(program: Command) {
  const config = program.command('config').description('Manage Planr configuration');

  config
    .command('show')
    .description('Display current configuration')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const cfg = await loadConfig(projectDir);

      logger.heading('Planr Configuration');
      console.log(`  Project:    ${cfg.projectName}`);
      console.log(`  Targets:    ${cfg.targets.join(', ')}`);
      console.log(`  Artifacts:  ${cfg.outputPaths.agile}/`);

      if (cfg.ai) {
        console.log('');
        console.log(`  AI Provider:  ${cfg.ai.provider}`);
        console.log(`  AI Model:     ${cfg.ai.model || '(default)'}`);

        const key = await resolveApiKey(cfg.ai.provider);
        if (key) {
          const masked = key.slice(0, 8) + '...' + key.slice(-4);
          console.log(`  API Key:      ${masked}`);
        } else {
          console.log(`  API Key:      (not set)`);
        }
      } else {
        console.log('');
        console.log('  AI:           Not configured');
        logger.dim('  Run `planr config set-provider <name>` to enable AI.');
      }

      if (cfg.defaultAgent) {
        console.log(`  Agent:        ${cfg.defaultAgent}`);
      }
    });

  config
    .command('set-provider')
    .description('Set the AI provider')
    .argument('[provider]', 'anthropic, openai, or ollama')
    .action(async (provider?: string) => {
      const projectDir = program.opts().projectDir as string;
      const cfg = await loadConfig(projectDir);

      const selected = (provider as AIProviderName) ||
        (await promptSelect<AIProviderName>('AI provider:', [
          { name: 'Anthropic (Claude)', value: 'anthropic' },
          { name: 'OpenAI (GPT-4o)', value: 'openai' },
          { name: 'Ollama (Local)', value: 'ollama' },
        ]));

      cfg.ai = { ...cfg.ai, provider: selected };
      await saveConfig(projectDir, cfg);
      logger.success(`AI provider set to: ${selected}`);
    });

  config
    .command('set-key')
    .description('Store an API key securely')
    .argument('[provider]', 'anthropic or openai')
    .action(async (provider?: string) => {
      const selected = provider ||
        (await promptSelect('Provider:', [
          { name: 'Anthropic', value: 'anthropic' },
          { name: 'OpenAI', value: 'openai' },
        ]));

      const key = await promptSecret(`API key for ${selected}:`);
      if (!key.trim()) {
        logger.error('API key cannot be empty.');
        return;
      }

      await saveCredential(selected, key.trim());
      logger.success(`API key for ${selected} saved to ~/.planr/credentials.json`);
    });

  config
    .command('set-model')
    .description('Set the AI model')
    .argument('<model>', 'model name (e.g., claude-sonnet-4-20250514, gpt-4o, llama3.1)')
    .action(async (model: string) => {
      const projectDir = program.opts().projectDir as string;
      const cfg = await loadConfig(projectDir);

      if (!cfg.ai) {
        logger.error('AI not configured. Run `planr config set-provider` first.');
        return;
      }

      cfg.ai.model = model;
      await saveConfig(projectDir, cfg);
      logger.success(`AI model set to: ${model}`);
    });

  config
    .command('set-agent')
    .description('Set the default coding agent for task implementation')
    .argument('[agent]', 'claude, cursor, or codex')
    .action(async (agent?: string) => {
      const projectDir = program.opts().projectDir as string;
      const cfg = await loadConfig(projectDir);

      const selected = (agent as CodingAgentName) ||
        (await promptSelect<CodingAgentName>('Default coding agent:', [
          { name: 'Claude Code CLI', value: 'claude' },
          { name: 'Cursor', value: 'cursor' },
          { name: 'Codex', value: 'codex' },
        ]));

      cfg.defaultAgent = selected;
      await saveConfig(projectDir, cfg);
      logger.success(`Default coding agent set to: ${selected}`);
    });
}
