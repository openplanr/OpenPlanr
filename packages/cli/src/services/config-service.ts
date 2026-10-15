import { existsSync } from 'node:fs';
import path from 'node:path';
import { planningFolderConflict } from '../../lib/planning-folder.mjs';
import { CliBoundaryError } from '../cli/error-boundary.js';
import { configSchema, targetCLISchema } from '../models/schema.js';
import type { OpenPlanrConfig, TargetCLI } from '../models/types.js';
import { CLI_COMMAND, CONFIG_FILENAME, PLANNING_FOLDER } from '../utils/constants.js';
import { describeSchemaIssues } from '../utils/external-json.js';
import { fileExists, readFile, writeFile } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import { firstAddedDate } from './git-service.js';

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

/** The refusal to write into a planning folder at `projectDir` that OpenPlanr didn't create, or null. */
export function foreignPlanningFolder(projectDir: string): CliBoundaryError | null {
  const conflict = planningFolderConflict(projectDir);
  return conflict
    ? new CliBoundaryError(conflict.code, conflict.problem, { recovery: conflict.fix })
    : null;
}

/** Throw before a write when OpenPlanr didn't create the planning folder at `projectDir`. */
export function assertPlanningFolderWritable(projectDir: string): void {
  const refusal = foreignPlanningFolder(projectDir);
  if (refusal) throw refusal;
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
    throw new ConfigInvalidError(
      'E_CONFIG_INVALID',
      `${CONFIG_FILENAME} does not satisfy the OpenPlanr config schema — ${describeSchemaIssues(result.error)}`,
      `Run \`${CLI_COMMAND} init --repair\` to add the missing fields.`,
    );
  }
  return result.data;
}

/** Required config fields that `init --repair` can fill in. */
export interface ConfigRepairFields {
  targets?: TargetCLI[];
  createdAt?: string;
}

export type ConfigRepairPlan =
  | { status: 'valid' }
  | {
      status: 'repair';
      raw: Record<string, unknown>;
      added: ConfigRepairFields;
      /** One line per added field, with its value and where it came from. */
      preview: string[];
    };

const AGENT_FILE_TARGETS: Record<TargetCLI, string[]> = {
  cursor: ['.cursor/rules'],
  claude: ['CLAUDE.md', '.claude'],
  codex: ['AGENTS.md'],
};

function repairRefusal(problem: string): CliBoundaryError {
  return new CliBoundaryError('E_CONFIG_INVALID', problem, {
    recovery: `Fix ${CONFIG_FILENAME} by hand; \`${CLI_COMMAND} init --repair\` only adds a missing \`targets\` or \`createdAt\`.`,
  });
}

async function detectTargets(projectDir: string): Promise<TargetCLI[]> {
  const detected: TargetCLI[] = [];
  for (const target of targetCLISchema.options) {
    for (const file of AGENT_FILE_TARGETS[target]) {
      if (await fileExists(path.join(projectDir, file))) {
        detected.push(target);
        break;
      }
    }
  }
  return detected;
}

/**
 * Plan the fields `init --repair` adds to the existing config without writing anything.
 * Throws `ConfigNotFoundError` without a config, and a refusal for unparseable JSON or issues it cannot fix.
 */
export async function planConfigRepair(projectDir: string): Promise<ConfigRepairPlan> {
  const configPath = path.join(projectDir, CONFIG_FILENAME);
  if (!(await fileExists(configPath))) throw new ConfigNotFoundError(projectDir);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configPath));
  } catch (error) {
    throw repairRefusal(
      `${CONFIG_FILENAME} is not valid JSON — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw repairRefusal(`${CONFIG_FILENAME} must contain a JSON object.`);
  }
  const existing = raw as Record<string, unknown>;
  if (configSchema.safeParse(existing).success) return { status: 'valid' };

  const added: ConfigRepairFields = {};
  const preview: string[] = [];
  if (!('targets' in existing)) {
    const detected = await detectTargets(projectDir);
    added.targets = detected.length > 0 ? detected : createDefaultConfig('').targets;
    preview.push(
      `targets: ${JSON.stringify(added.targets)} (${detected.length > 0 ? 'from agent files in the project' : 'default; no agent files found'})`,
    );
  }
  if (!('createdAt' in existing)) {
    const firstAdded = await firstAddedDate(projectDir, CONFIG_FILENAME);
    added.createdAt = firstAdded ?? createDefaultConfig('').createdAt;
    preview.push(
      `createdAt: ${JSON.stringify(added.createdAt)} (${firstAdded ? 'when git first added the config' : 'today; no git history for the config'})`,
    );
  }
  const result = configSchema.safeParse({ ...existing, ...added });
  if (!result.success) {
    throw repairRefusal(
      `${CONFIG_FILENAME} has issues a repair cannot fix — ${describeSchemaIssues(result.error)}`,
    );
  }
  return { status: 'repair', raw: existing, added, preview };
}

/** Write the planned fields into the existing config, keeping every existing key and value. */
export async function applyConfigRepair(
  projectDir: string,
  plan: Extract<ConfigRepairPlan, { status: 'repair' }>,
): Promise<void> {
  const configPath = path.join(projectDir, CONFIG_FILENAME);
  await writeFile(configPath, `${JSON.stringify({ ...plan.raw, ...plan.added }, null, 2)}\n`);
}

/** Write the OpenPlanr config to disk as formatted JSON. */
export async function saveConfig(projectDir: string, config: OpenPlanrConfig): Promise<void> {
  const configPath = path.join(projectDir, CONFIG_FILENAME);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Walk up from `startDir` looking for a directory containing `.planr/config.json`.
 * Returns the first match, or `startDir` if none found (so `openplanr init` still works).
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
      agile: PLANNING_FOLDER,
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
