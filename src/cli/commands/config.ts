/**
 * `planr config` command group.
 *
 * Manage AI provider settings, API keys, and coding agent preferences.
 */

import type { Command } from 'commander';
import { DEFAULT_MODELS, ENV_KEY_MAP } from '../../ai/types.js';
import type { AIProviderName, CodingAgentName } from '../../models/types.js';
import { loadConfig, saveConfig } from '../../services/config-service.js';
import {
  clearCredential,
  resolveApiKeySource,
  saveCredential,
} from '../../services/credentials-service.js';
import { printDeprecationNotice } from '../../services/deprecation-notices.js';
import { promptSecret, promptSelect } from '../../services/prompt-service.js';
import {
  readSnoozeState,
  UPGRADE_REENABLE_COMMAND,
  writeSnoozeState,
} from '../../services/upgrade-offer-service.js';
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
        // When no explicit model is set, show the actual default that will
        // be used — annotated so users can tell it came from the default
        // map rather than their config.
        const modelLabel = cfg.ai.model
          ? cfg.ai.model
          : `${DEFAULT_MODELS[cfg.ai.provider]} (default)`;
        display.line(`  AI Model:     ${modelLabel}`);

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

      // Spec-driven readiness check.
      display.blank();
      display.line('Spec-driven readiness:');
      const aiReady =
        cfg.ai !== undefined &&
        (cfg.ai.provider === 'ollama' || (await resolveApiKeySource(cfg.ai.provider)) !== null);
      if (aiReady) {
        display.line('  ✓ planr spec decompose       (AI configured)');
      } else if (cfg.ai === undefined) {
        display.line('  ✗ planr spec decompose       (AI disabled)');
      } else {
        display.line(`  ✗ planr spec decompose       (${cfg.ai.provider}: API key missing)`);
      }
      display.line('  ✓ planr spec create + shape  (no AI required)');
      logger.dim('  Schema reference: https://openplanr.dev/docs/reference/spec-schema');
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
        (await promptSelect<AIProviderName>(
          'AI provider:',
          [
            { name: 'Anthropic (Claude)', value: 'anthropic' },
            { name: 'OpenAI (GPT-4o)', value: 'openai' },
            { name: 'Ollama (Local)', value: 'ollama' },
          ],
          'anthropic',
        ));

      cfg.ai = { ...cfg.ai, provider: selected };
      await saveConfig(projectDir, cfg);
      logger.success(`AI provider set to: ${selected}`);
      printDeprecationNotice('ai-planning');
    });

  config
    .command('set-key')
    .description('Store an API key securely')
    .argument('[provider]', 'anthropic or openai')
    .action(async (provider?: string) => {
      const selected =
        provider ||
        (await promptSelect(
          'Provider:',
          [
            { name: 'Anthropic', value: 'anthropic' },
            { name: 'OpenAI', value: 'openai' },
          ],
          'anthropic',
        ));

      const key = await promptSecret(`API key for ${selected}:`);
      if (!key.trim()) {
        logger.error('API key cannot be empty.');
        return;
      }

      const storage = await saveCredential(selected, key.trim());
      const where =
        storage === 'keychain' ? 'OS keychain' : 'encrypted file (~/.planr/credentials.enc)';
      logger.success(`API key for ${selected} saved to ${where}`);
      printDeprecationNotice('ai-planning');
    });

  config
    .command('remove-key')
    .description('Remove a stored API key')
    .argument('[provider]', 'anthropic or openai')
    .action(async (provider?: string) => {
      const validProviders = ['anthropic', 'openai'];
      const selected =
        provider ||
        (await promptSelect(
          'Provider:',
          [
            { name: 'Anthropic', value: 'anthropic' },
            { name: 'OpenAI', value: 'openai' },
          ],
          'anthropic',
        ));

      if (!validProviders.includes(selected)) {
        logger.error(`Unknown provider "${selected}". Supported: ${validProviders.join(', ')}.`);
        return;
      }

      const existing = await resolveApiKeySource(selected);
      if (!existing) {
        logger.info(`No stored API key found for ${selected}.`);
        return;
      }

      if (existing.source === 'env') {
        const envVar = ENV_KEY_MAP[selected];
        logger.warn(
          `API key for ${selected} is set via ${envVar} environment variable — unset it in your shell.`,
        );
        return;
      }

      await clearCredential(selected);
      logger.success(`API key for ${selected} removed.`);
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
    .description('Set the default coding agent for rules generation')
    .argument('[agent]', 'claude, cursor, or codex')
    .action(async (agent?: string) => {
      const projectDir = program.opts().projectDir as string;
      const cfg = await loadConfig(projectDir);

      const selected =
        (agent as CodingAgentName) ||
        (await promptSelect<CodingAgentName>(
          'Default coding agent:',
          [
            { name: 'Claude Code CLI', value: 'claude' },
            { name: 'Cursor', value: 'cursor' },
            { name: 'Codex', value: 'codex' },
          ],
          'claude',
        ));

      cfg.defaultAgent = selected;
      await saveConfig(projectDir, cfg);
      logger.success(`Default coding agent set to: ${selected}`);
    });

  config
    .command('set-upgrade-policy')
    .description('Configure how OpenPlanr offers upgrades (FR6: auto_upgrade / update_check)')
    .option('--auto-upgrade <true|false>', 'upgrade automatically, without prompting (team-shared)')
    .option(
      '--update-check <true|false>',
      'enable or disable the upgrade check entirely (team-shared)',
    )
    .option('--never-ask', 'never prompt about upgrades again on this machine')
    .option('--ask-again', 're-enable upgrade prompts on this machine after --never-ask')
    .action(
      async (opts: {
        autoUpgrade?: string;
        updateCheck?: string;
        neverAsk?: boolean;
        askAgain?: boolean;
      }) => {
        const projectDir = program.opts().projectDir as string;
        let didSomething = false;

        // `neverAsk` is a personal preference, so it lives in the machine-local
        // upgrade-state.json — never the team-shared config.json.
        if (opts.askAgain) {
          await writeSnoozeState({ neverAsk: false, snoozeUntil: null, snoozeStage: 0 });
          logger.success('Upgrade prompts re-enabled on this machine.');
          didSomething = true;
        }
        if (opts.neverAsk) {
          await writeSnoozeState({ ...readSnoozeState(), neverAsk: true, snoozeUntil: null });
          logger.success('Upgrade prompts disabled on this machine.');
          // FR6: a permanent opt-out must state the exact command that reverses it.
          logger.info(`To re-enable them, run: ${UPGRADE_REENABLE_COMMAND}`);
          didSomething = true;
        }

        // `autoUpgrade` / `updateCheck` are team-shared settings in config.json.
        if (opts.autoUpgrade !== undefined || opts.updateCheck !== undefined) {
          const cfg = await loadConfig(projectDir);
          const upgrade = { ...cfg.upgrade };
          if (opts.autoUpgrade !== undefined) {
            upgrade.autoUpgrade = parseUpgradeBool(opts.autoUpgrade, '--auto-upgrade');
          }
          if (opts.updateCheck !== undefined) {
            upgrade.updateCheck = parseUpgradeBool(opts.updateCheck, '--update-check');
          }
          cfg.upgrade = upgrade;
          await saveConfig(projectDir, cfg);
          logger.success('Upgrade policy updated.');
          didSomething = true;
        }

        if (!didSomething) {
          logger.warn(
            'Nothing to set. Use --auto-upgrade, --update-check, --never-ask, or --ask-again.',
          );
        }
      },
    );
}

/** Parse a `<true|false>` policy flag, rejecting anything else with a clear error. */
function parseUpgradeBool(value: string, flag: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${flag} expects "true" or "false", received "${value}".`);
}
