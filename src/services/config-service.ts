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

/**
 * A config file that exists but does not satisfy the schema. Previously
 * `configSchema.parse` threw a raw `ZodError` straight through the CLI's top-level
 * handler, which rethrows anything without an `E_` code — so a single missing field
 * (`targets` and `createdAt` are required while every other field defaults) crashed
 * *every* config-reading command with an unhandled stack trace instead of naming the
 * field. Carrying a `code` and a `fix` plugs into the handler's existing contract.
 */
export class ConfigInvalidError extends Error {
  constructor(
    public code: string,
    message: string,
    public fix?: string,
  ) {
    super(message);
    this.name = 'ConfigInvalidError';
  }

  toJSON() {
    return { ok: false, code: this.code, problem: this.message, fix: this.fix };
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
  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    // Name every failing field with its path, so the message says what failed and
    // where — not just that validation happened.
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ConfigInvalidError(
      'E_CONFIG_INVALID',
      `${configPath} does not satisfy the OpenPlanr config schema — ${problems}`,
      'Add the field(s) named above, or re-create the file with `planr init`.',
    );
  }
  return result.data;
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
