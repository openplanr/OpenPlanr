import type { OpenPlanrConfig, TargetCLI } from '../models/types.js';
import type { BaseGenerator } from './base-generator.js';
import { ClaudeGenerator } from './claude-generator.js';
import { CodexGenerator } from './codex-generator.js';
import { CursorGenerator } from './cursor-generator.js';

export function createGenerator(
  target: TargetCLI,
  config: OpenPlanrConfig,
  projectDir: string,
): BaseGenerator {
  switch (target) {
    case 'cursor':
      return new CursorGenerator(config, projectDir);
    case 'claude':
      return new ClaudeGenerator(config, projectDir);
    case 'codex':
      return new CodexGenerator(config, projectDir);
    default:
      throw new Error(`Unknown target: ${target}`);
  }
}

export function createGenerators(config: OpenPlanrConfig, projectDir: string): BaseGenerator[] {
  return config.targets.map((target) => createGenerator(target, config, projectDir));
}
