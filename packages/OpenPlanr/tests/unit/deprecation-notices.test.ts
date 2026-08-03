import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  saveCredential: vi.fn(),
  promptSecret: vi.fn(),
  promptSelect: vi.fn(),
  warn: vi.fn(),
  success: vi.fn(),
}));

vi.mock('../../src/services/config-service.js', () => ({
  loadConfig: mocks.loadConfig,
  saveConfig: mocks.saveConfig,
}));
vi.mock('../../src/services/credentials-service.js', () => ({
  clearCredential: vi.fn(),
  resolveApiKeySource: vi.fn(),
  saveCredential: mocks.saveCredential,
}));
vi.mock('../../src/services/prompt-service.js', () => ({
  promptSecret: mocks.promptSecret,
  promptSelect: mocks.promptSelect,
}));
vi.mock('../../src/utils/logger.js', () => ({
  display: { blank: vi.fn(), line: vi.fn() },
  logger: {
    dim: vi.fn(),
    error: vi.fn(),
    heading: vi.fn(),
    success: mocks.success,
    warn: mocks.warn,
  },
}));

import { registerConfigCommand } from '../../src/cli/commands/config.js';
import {
  HARNESS_FLOW_DEPRECATION_NOTICE,
  printDeprecationNotice,
} from '../../src/services/deprecation-notices.js';

function program(): Command {
  const root = new Command()
    .name('planr')
    .exitOverride()
    .option('--project-dir <path>', 'project directory', '/workspace');
  root.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
  registerConfigCommand(root);
  return root;
}

describe('T-006 deprecation notices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockResolvedValue({ projectName: 'test', targets: [], outputPaths: {} });
    mocks.saveConfig.mockResolvedValue(undefined);
    mocks.promptSecret.mockResolvedValue('test-secret');
    mocks.saveCredential.mockResolvedValue('keychain');
  });

  it('emits one byte-identical notice through the shared helper', () => {
    const sink = { warn: vi.fn() };
    printDeprecationNotice('ai-planning', sink as never);
    printDeprecationNotice('operate-structured-provider', sink as never);
    expect(sink.warn).toHaveBeenNthCalledWith(1, HARNESS_FLOW_DEPRECATION_NOTICE);
    expect(sink.warn).toHaveBeenNthCalledWith(2, HARNESS_FLOW_DEPRECATION_NOTICE);
  });

  it('keeps config set-provider functional and prints the mandate-harness notice', async () => {
    await program().parseAsync(['node', 'planr', 'config', 'set-provider', 'anthropic']);
    expect(mocks.saveConfig).toHaveBeenCalledOnce();
    expect(mocks.success).toHaveBeenCalledWith('AI provider set to: anthropic');
    expect(mocks.warn).toHaveBeenCalledWith(HARNESS_FLOW_DEPRECATION_NOTICE);
  });

  it('keeps config set-key functional and prints the mandate-harness notice', async () => {
    await program().parseAsync(['node', 'planr', 'config', 'set-key', 'anthropic']);
    expect(mocks.saveCredential).toHaveBeenCalledWith('anthropic', 'test-secret');
    expect(mocks.success).toHaveBeenCalledWith('API key for anthropic saved to OS keychain');
    expect(mocks.warn).toHaveBeenCalledWith(HARNESS_FLOW_DEPRECATION_NOTICE);
  });

  it('covers every CLI-side AI planning surface with the shared post-generation notice', () => {
    const commands = [
      'epic',
      'spec',
      'feature',
      'story',
      'task',
      'sprint',
      'plan',
      'quick',
      'revise',
      'refine',
      'backlog',
    ];
    for (const command of commands) {
      const source = readFileSync(resolve(`src/cli/commands/${command}.ts`), 'utf8');
      expect(source, `${command} must emit the shared AI-planning notice`).toContain(
        "printDeprecationNotice('ai-planning')",
      );
    }
  });
});
