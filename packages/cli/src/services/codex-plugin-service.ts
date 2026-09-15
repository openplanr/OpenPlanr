import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export type CodexCommandRunner = (args: string[]) => {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

export type CodexPluginOperation = Readonly<{
  runtime: 'codex';
  kind: 'add-marketplace' | 'install' | 'remove';
  id: string;
  scope: 'user';
  description: string;
}>;

export interface CodexPluginInspection {
  available: boolean;
  ready: boolean;
  marketplaceName: string;
  pluginId: string;
  installed: boolean;
  installedVersion: string | null;
  duplicates: string[];
  operations: CodexPluginOperation[];
  error?: string;
}

const defaultRunner: CodexCommandRunner = (args) => {
  const result = spawnSync('codex', args, { encoding: 'utf8', windowsHide: true });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  };
};

const HOST_PLUGIN_NAME = 'planr';
const LEGACY_HOST_PLUGIN_NAME = 'openplanr';

function canonicalRoot(value: string): string {
  const resolved = path.resolve(value);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function output<T>(runner: CodexCommandRunner, args: string[]): T {
  const result = runner(args);
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message ||
        result.stderr.trim() ||
        `codex ${args.join(' ')} exited ${result.status}`,
    );
  }
  return JSON.parse(result.stdout) as T;
}

function installedRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  const installed = (value as { installed?: unknown } | null)?.installed;
  return Array.isArray(installed) ? (installed as Array<Record<string, unknown>>) : [];
}

export function inspectCodexPluginIntegration(
  pipelineRoot: string,
  desiredMode: 'direct' | 'unified-plugin' | 'project-rule',
  previousMode: 'direct' | 'unified-plugin' | 'project-rule' | undefined,
  runner: CodexCommandRunner = defaultRunner,
): CodexPluginInspection {
  const marketplacePath = path.join(pipelineRoot, '.claude-plugin', 'marketplace.json');
  if (!existsSync(marketplacePath)) {
    return {
      available: false,
      ready: false,
      marketplaceName: 'openplanr-pipeline-local',
      pluginId: `${HOST_PLUGIN_NAME}@openplanr-pipeline-local`,
      installed: false,
      installedVersion: null,
      duplicates: [],
      operations: [],
      error: 'The installed pipeline package does not contain its OpenPlanr marketplace.',
    };
  }
  const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8')) as {
    name: string;
    plugins: Array<{ name: string; version: string }>;
  };
  const plugin = marketplace.plugins.find(({ name }) => name === HOST_PLUGIN_NAME);
  const marketplaceName = marketplace.name;
  const pluginId = `${HOST_PLUGIN_NAME}@${marketplaceName}`;
  if (!plugin)
    return {
      available: false,
      ready: false,
      marketplaceName,
      pluginId,
      installed: false,
      installedVersion: null,
      duplicates: [],
      operations: [],
      error: `The installed pipeline marketplace does not declare ${HOST_PLUGIN_NAME}.`,
    };
  const version = runner(['--version']);
  if (version.error || version.status !== 0)
    return {
      available: false,
      ready: false,
      marketplaceName,
      pluginId,
      installed: false,
      installedVersion: null,
      duplicates: [],
      operations: [],
      error: version.error?.message || version.stderr.trim() || 'Codex is unavailable.',
    };
  try {
    const listedMarketplaces = output<{
      marketplaces?: Array<{
        name?: string;
        root?: string;
        marketplaceSource?: { source?: string };
      }>;
    }>(runner, ['plugin', 'marketplace', 'list', '--json']);
    const configured = (listedMarketplaces.marketplaces ?? []).find(
      ({ name }) => name === marketplaceName,
    );
    if (configured) {
      const configuredRoot = canonicalRoot(
        String(configured.root ?? configured.marketplaceSource?.source ?? ''),
      );
      const expectedRoot = canonicalRoot(pipelineRoot);
      if (configuredRoot !== expectedRoot)
        throw new Error(
          `Codex marketplace ${marketplaceName} points to ${configuredRoot}, not ${expectedRoot}.`,
        );
    }
    const installed = installedRows(output<unknown>(runner, ['plugin', 'list', '--json']));
    const selected = installed.find(
      (row) =>
        row.pluginId === pluginId ||
        (row.name === HOST_PLUGIN_NAME && row.marketplaceName === marketplaceName),
    );
    const managedLegacy = installed.filter(
      (row) =>
        row.enabled !== false &&
        row.name === LEGACY_HOST_PLUGIN_NAME &&
        row.marketplaceName === marketplaceName,
    );
    const duplicates = installed
      .filter(
        (row) =>
          [HOST_PLUGIN_NAME, LEGACY_HOST_PLUGIN_NAME].includes(String(row.name)) &&
          row.enabled !== false &&
          row.pluginId !== pluginId &&
          !managedLegacy.includes(row),
      )
      .map((row) => String(row.pluginId ?? `${row.name}@${row.marketplaceName}`))
      .sort();
    const installedVersion = selected?.version ? String(selected.version) : null;
    const operations: CodexPluginOperation[] = [];
    if (desiredMode === 'unified-plugin') {
      if (!configured)
        operations.push({
          runtime: 'codex',
          kind: 'add-marketplace',
          id: marketplaceName,
          scope: 'user',
          description: `Add the packaged Codex marketplace ${marketplaceName}`,
        });
      if (selected && installedVersion !== plugin.version)
        operations.push({
          runtime: 'codex',
          kind: 'remove',
          id: pluginId,
          scope: 'user',
          description: `Replace stale Codex plugin ${pluginId} ${installedVersion}`,
        });
      if (!selected || installedVersion !== plugin.version)
        operations.push({
          runtime: 'codex',
          kind: 'install',
          id: pluginId,
          scope: 'user',
          description: `Install Codex plugin ${pluginId} ${plugin.version}`,
        });
      for (const legacy of managedLegacy) {
        const id = String(legacy.pluginId ?? `${legacy.name}@${legacy.marketplaceName}`);
        operations.push({
          runtime: 'codex',
          kind: 'remove',
          id,
          scope: 'user',
          description: `Retire legacy Codex plugin ${id} after installing ${pluginId}`,
        });
      }
    } else if (selected && previousMode === 'unified-plugin') {
      operations.push({
        runtime: 'codex',
        kind: 'remove',
        id: pluginId,
        scope: 'user',
        description: `Retire the managed Codex plugin before switching to ${desiredMode}`,
      });
    }
    return {
      available: true,
      ready:
        desiredMode === 'unified-plugin'
          ? Boolean(
              configured &&
                selected &&
                installedVersion === plugin.version &&
                duplicates.length === 0,
            )
          : !selected && duplicates.length === 0,
      marketplaceName,
      pluginId,
      installed: Boolean(selected),
      installedVersion,
      duplicates,
      operations,
    };
  } catch (cause) {
    return {
      available: true,
      ready: false,
      marketplaceName,
      pluginId,
      installed: false,
      installedVersion: null,
      duplicates: [],
      operations: [],
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export function applyCodexPluginIntegration(
  pipelineRoot: string,
  inspection: CodexPluginInspection,
  runner: CodexCommandRunner = defaultRunner,
): { operations: CodexPluginOperation[]; restartRequired: boolean } {
  if (!inspection.available || inspection.error)
    throw new Error(inspection.error ?? 'Codex plugin integration is unavailable.');
  for (const operation of inspection.operations) {
    const args =
      operation.kind === 'add-marketplace'
        ? ['plugin', 'marketplace', 'add', pipelineRoot, '--json']
        : operation.kind === 'install'
          ? ['plugin', 'add', operation.id, '--json']
          : ['plugin', 'remove', operation.id, '--json'];
    output(runner, args);
  }
  return { operations: inspection.operations, restartRequired: inspection.operations.length > 0 };
}
