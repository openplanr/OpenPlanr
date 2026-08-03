import { existsSync } from 'node:fs';
import path from 'node:path';
import { configSchema } from '../models/schema.js';
import type { OpenPlanrConfig } from '../models/types.js';
import { CONFIG_FILENAME } from '../utils/constants.js';
import { fileExists, readFile, writeFile } from '../utils/fs.js';
import { logger } from '../utils/logger.js';

/** Error thrown when no OpenPlanr config file exists in the given project directory. */
export class ConfigNotFoundError extends Error {
  constructor(projectDir: string) {
    super(`No ${CONFIG_FILENAME} found in ${projectDir}.`);
    this.name = 'ConfigNotFoundError';
  }
}

/** Load and validate the OpenPlanr config file from the given project directory. */
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

/** Write the OpenPlanr config to disk as formatted JSON. */
export async function saveConfig(projectDir: string, config: OpenPlanrConfig): Promise<void> {
  const configPath = path.join(projectDir, CONFIG_FILENAME);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Walk up from `startDir` looking for a directory containing `.planr/config.json`.
 * Returns the first match, or `startDir` if none found (so `planr init` still works).
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  const { root } = path.parse(dir);
  while (true) {
    if (existsSync(path.join(dir, CONFIG_FILENAME))) {
      if (dir !== startDir) {
        logger.debug(`Resolved project root: ${dir}`);
      }
      return dir;
    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return startDir;
}

/** Build a default OpenPlanr config with standard prefixes and output paths. */
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
      spec: 'SPEC',
    },
    createdAt: new Date().toISOString().split('T')[0],
  };
}
