import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PipelineError } from './errors.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const registry = JSON.parse(readFileSync(join(root, 'registry/adapters.json'), 'utf8'));

const NORMALIZE = {
  claude: 'claude-code',
  'claude-code': 'claude-code',
  codex: 'codex',
  cursor: 'cursor',
};
const EXECUTABLE = { 'claude-code': 'claude', codex: 'codex', cursor: 'cursor' };

export function listRuntimeAdapters() {
  return registry.adapters.map((adapter) => structuredClone(adapter));
}

export function normalizeRuntime(value) {
  return value ? (NORMALIZE[String(value).toLowerCase()] ?? String(value).toLowerCase()) : null;
}

export function commandExists(command, run = spawnSync) {
  const result = run(command, ['--version'], { encoding: 'utf8', windowsHide: true });
  return !result.error && result.status === 0;
}

export function detectInstalledRuntimes(run = spawnSync) {
  return registry.adapters
    .filter((adapter) => commandExists(EXECUTABLE[adapter.id], run))
    .map((adapter) => adapter.id);
}

function readProjectDefault(projectRoot) {
  const configPath = join(projectRoot, '.planr', 'config.json');
  if (!existsSync(configPath)) return null;
  try {
    return normalizeRuntime(JSON.parse(readFileSync(configPath, 'utf8')).defaultAgent);
  } catch {
    return null;
  }
}

export function validateRuntimeLock(projectRoot, runtimeId) {
  const lockPath = join(projectRoot, '.planr', 'runtime-lock.json');
  if (!existsSync(lockPath)) return null;
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch (error) {
    throw new PipelineError(
      'E_LOCK_INVALID',
      `Could not parse ${lockPath}: ${error.message}`,
      'Review the lock, then run `planr setup --scope project`.',
    );
  }
  const adapter = lock.adapters?.find((entry) => entry.runtime === runtimeId);
  const expected = registry.adapters.find((entry) => entry.id === runtimeId);
  if (
    lock.protocolVersion !== registry.protocolVersion ||
    lock.components?.pipeline !== registry.pipelineVersion ||
    !adapter ||
    adapter.version !== expected?.version
  ) {
    throw new PipelineError(
      'E_LOCK_INCOMPATIBLE',
      `Project lock is incompatible with pipeline ${registry.pipelineVersion} and adapter ${runtimeId} ${expected?.version}.`,
      `Run \`planr runtime update ${runtimeId} --scope project\`.`,
    );
  }
  return lock;
}

function resolvedAdapter(id, source, available, projectRoot, { strictRuntimeLock = true } = {}) {
  let diagnostics = [];
  try {
    validateRuntimeLock(projectRoot, id);
  } catch (error) {
    if (strictRuntimeLock || !(error instanceof PipelineError)) throw error;
    diagnostics = [
      {
        code: error.code,
        problem: error.message,
        ...(error.fix ? { fix: error.fix } : {}),
      },
    ];
  }
  return {
    adapter: structuredClone(registry.adapters.find((entry) => entry.id === id)),
    source,
    installed: available.includes(id),
    diagnostics,
  };
}

function readActiveRuntime(projectRoot) {
  const statePath = join(
    process.env.OPENPLANR_HOME ?? homedir(),
    '.planr',
    'runtime',
    'state.json',
  );
  if (!existsSync(statePath)) return null;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const key = createHash('sha256').update(resolve(projectRoot)).digest('hex').slice(0, 16);
    const project = state?.projects?.[key];
    return normalizeRuntime(
      project?.activeRuntime ?? (project?.runtimes?.length === 1 ? project.runtimes[0] : null),
    );
  } catch {
    return null;
  }
}

export function resolveRuntimeAdapter({
  projectRoot = process.cwd(),
  explicit,
  active,
  projectDefault,
  installed,
  strictRuntimeLock = true,
} = {}) {
  const available = installed ?? detectInstalledRuntimes();
  const activeRuntime = active ?? process.env.OPENPLANR_RUNTIME ?? readActiveRuntime(projectRoot);
  const candidates = [
    ['explicit', normalizeRuntime(explicit)],
    ['active', normalizeRuntime(activeRuntime)],
    ['project', normalizeRuntime(projectDefault ?? readProjectDefault(projectRoot))],
  ];

  for (const [source, id] of candidates) {
    if (!id) continue;
    const adapter = registry.adapters.find((entry) => entry.id === id);
    if (!adapter) {
      throw new PipelineError(
        'E_RUNTIME_UNSUPPORTED',
        `Runtime "${id}" is not supported.`,
        'Choose claude, codex, or cursor.',
      );
    }
    return resolvedAdapter(id, source, available, projectRoot, { strictRuntimeLock });
  }

  if (available.length === 1) {
    return resolvedAdapter(available[0], 'installed', available, projectRoot, {
      strictRuntimeLock,
    });
  }
  if (available.length === 0) {
    throw new PipelineError(
      'E_RUNTIME_NOT_FOUND',
      'No supported coding runtime was detected.',
      'Install Claude Code, Codex, or Cursor, then run `planr setup`.',
    );
  }
  throw new PipelineError(
    'E_RUNTIME_AMBIGUOUS',
    `Multiple runtimes are installed: ${available.join(', ')}.`,
    'Pass `--runtime claude|codex|cursor` or set a project default.',
  );
}

function runtimeEntrypoint(adapter, phase, feature) {
  const entrypoint = adapter.entrypoints[phase];
  return entrypoint.includes('{feature}')
    ? entrypoint.replace('{feature}', feature)
    : `${entrypoint} ${feature}`.trim();
}

/** Composes host-native skill guidance with the concrete working context. */
export function composeRuntimePrompt(adapter, phase, feature, context) {
  const entrypoint = runtimeEntrypoint(adapter, phase, feature);
  return typeof context === 'string' && context.length ? `${entrypoint}\n\n${context}` : entrypoint;
}

export function runtimeHandoff(adapter, phase, feature, context) {
  const featureCommand = runtimeEntrypoint(adapter, phase, feature);
  if (typeof context === 'string' && context.length) {
    return {
      ok: false,
      action: 'runtime_required',
      runtime: adapter.id,
      executionMode: 'handoff',
      command: `${adapter.id === 'cursor' ? 'Open Cursor and invoke' : 'Invoke'} ${featureCommand} with the working context below.`,
      context,
      code: 'E_RUNTIME_HANDOFF_REQUIRED',
    };
  }
  const prefix = adapter.id === 'cursor' ? 'Open Cursor and invoke' : 'Invoke';
  return {
    ok: false,
    action: 'runtime_required',
    runtime: adapter.id,
    executionMode: 'handoff',
    command: `${prefix} ${featureCommand}`,
    code: 'E_RUNTIME_HANDOFF_REQUIRED',
  };
}
