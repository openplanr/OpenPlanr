/**
 * `planr config` command group.
 *
 * Manage AI provider settings, API keys, and coding agent preferences.
 */

import type { Command } from 'commander';
import { ENV_KEY_MAP } from '../../ai/types.js';
import type { AIProviderName, CodingAgentName } from '../../models/types.js';
import { loadConfig, saveConfig } from '../../services/config-service.js';
import { resolveApiKeySource, saveCredential } from '../../services/credentials-service.js';
import { promptSecret, promptSelect } from '../../services/prompt-service.js';
import { display, logger } from '../../utils/logger.js';

export function registerConfigCommand(program: Command) {
  const config = program.command('config').description('Manage Planr configuration');

  config
    .command('show')
    .description('Display current configuration')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const cfg = await loadConfig(projectDir);

      logger.heading('Planr Configuration');
      display.line(`  Project:    ${cfg.projectName}`);
      display.line(`  Targets:    ${cfg.targets.join(', ')}`);
      display.line(`  Artifacts:  ${cfg.outputPaths.agile}/`);

      if (cfg.ai) {
        display.blank();
        display.line(`  AI Provider:  ${cfg.ai.provider}`);
        display.line(`  AI Model:     ${cfg.ai.model || '(default)'}`);

        const resolved = await resolveApiKeySource(cfg.ai.provider);
        if (resolved) {
          const masked = `${resolved.key.slice(0, 8)}...${resolved.key.slice(-4)}`;
          const sourceLabel =
            resolved.source === 'env'
              ? `env: ${ENV_KEY_MAP[cfg.ai.provider] ?? 'env'}`
              : resolved.source === 'keychain'
                ? 'OS keychain'
                : 'encrypted file';
          display.line(`  API Key:      ${masked} (${sourceLabel})`);
        } else {
          display.line(`  API Key:      (not set)`);
        }
      } else {
        display.blank();
        display.line('  AI:           Not configured');
        logger.dim('  Run `planr config set-provider <name>` to enable AI.');
      }

      if (cfg.defaultAgent) {
        display.line(`  Agent:        ${cfg.defaultAgent}`);
      }
    });

  config
    .command('set-provider')
    .description('Set the AI provider')
    .argument('[provider]', 'anthropic, openai, or ollama')
    .action(async (provider?: string) => {
      const projectDir = program.opts().projectDir as string;
      const cfg = await loadConfig(projectDir);

      const selected =
        (provider as AIProviderName) ||
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
      const selected =
        provider ||
        (await promptSelect('Provider:', [
          { name: 'Anthropic', value: 'anthropic' },
          { name: 'OpenAI', value: 'openai' },
        ]));

      const key = await promptSecret(`API key for ${selected}:`);
      if (!key.trim()) {
        logger.error('API key cannot be empty.');
        return;
      }

      const storage = await saveCredential(selected, key.trim());
      const where =
        storage === 'keychain' ? 'OS keychain' : 'encrypted file (~/.planr/credentials.enc)';
      logger.success(`API key for ${selected} saved to ${where}`);
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

      const selected =
        (agent as CodingAgentName) ||
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
