import path from 'node:path';
import { configSchema } from '../models/schema.js';
import type { OpenPlanrConfig } from '../models/types.js';
import { CONFIG_FILENAME } from '../utils/constants.js';
import { fileExists, readFile, writeFile } from '../utils/fs.js';

export class ConfigNotFoundError extends Error {
  constructor(projectDir: string) {
    super(`No ${CONFIG_FILENAME} found in ${projectDir}.`);
    this.name = 'ConfigNotFoundError';
  }
}

export async function loadConfig(projectDir: string): Promise<OpenPlanrConfig> {
  const configPath = path.join(projectDir, CONFIG_FILENAME);
  const exists = await fileExists(configPath);
  if (!exists) {
    throw new ConfigNotFoundError(projectDir);
  }
  const raw = await readFile(configPath);
  const parsed = JSON.parse(raw);
  return configSchema.parse(parsed);
}

export async function saveConfig(projectDir: string, config: OpenPlanrConfig): Promise<void> {
  const configPath = path.join(projectDir, CONFIG_FILENAME);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export function createDefaultConfig(projectName: string): OpenPlanrConfig {
  return {
    projectName,
    targets: ['cursor', 'claude', 'codex'],
    outputPaths: {
      agile: '.planr',
      cursorRules: '.cursor/rules',
      claudeConfig: '.',
      codexConfig: '.',
    },
    idPrefix: {
      epic: 'EPIC',
      feature: 'FEAT',
      story: 'US',
      task: 'TASK',
      quick: 'QT',
      backlog: 'BL',
      sprint: 'SPRINT',
    },
    createdAt: new Date().toISOString().split('T')[0],
  };
}
