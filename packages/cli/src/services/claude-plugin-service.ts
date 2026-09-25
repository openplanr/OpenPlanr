import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const OPENPLANR_CLAUDE_PLUGIN = 'planr';

export type ClaudePluginOperationKind =
  | 'add-marketplace'
  | 'refresh-marketplace'
  | 'install'
  | 'update'
  | 'enable'
  | 'remove';

export interface ClaudePluginOperation {
  runtime: 'claude-code';
  kind: ClaudePluginOperationKind;
  id: string;
  scope: 'user';
  currentVersion?: string;
  targetVersion?: string;
  description: string;
}

export interface ClaudePluginState {
  id: string;
  name: string;
  expectedVersion: string;
  installedVersion?: string;
  enabled: boolean;
  installed: boolean;
  identityValid: boolean;
  installPath?: string;
}

export interface ClaudePluginInspection {
  available: boolean;
  marketplaceConfigured: boolean;
  ready: boolean;
  operations: ClaudePluginOperation[];
  plugins: ClaudePluginState[];
  legacyPluginIds: string[];
  /** `planr` plugins installed from another marketplace; reported, never removed. */
  duplicatePluginIds: string[];
  error?: string;
}

export interface ClaudePluginApplyResult {
  operations: ClaudePluginOperation[];
  restartRequired: boolean;
  inspection: ClaudePluginInspection;
}

export interface ClaudeCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type ClaudeCommandRunner = (args: string[]) => ClaudeCommandResult;

interface MarketplaceEntry {
  name?: string;
  source?: string;
  repo?: string;
  path?: string;
  installLocation?: string;
}

interface InstalledPlugin {
  id?: string;
  version?: string;
  scope?: string;
  enabled?: boolean;
  installPath?: string;
}

/**
 * `OPENPLANR_CLAUDE_BIN` is a test seam of the same shape as `upgrade-service.ts`'s
 * `OPENPLANR_NPM_BIN`: a path to a Node script standing in for the `claude` binary, so a
 * test can drive the real CLI end to end against a fabricated plugin tuple. Bare
 * `spawnSync('claude')` resolves only `.exe` on Windows, which a stub that must branch on
 * its arguments cannot be — without this seam the plugin-half path is only testable on
 * POSIX, and that is precisely the path that shipped a promise with no commands behind it.
 * Unset in production, where the real `claude` runs.
 */
function defaultRunner(args: string[]): ClaudeCommandResult {
  const override = process.env.OPENPLANR_CLAUDE_BIN?.trim();
  const result = spawnSync(
    override ? process.execPath : 'claude',
    override ? [override, ...args] : args,
    {
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  };
}

function parseJson<T>(result: ClaudeCommandResult): T {
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() || `exit ${result.status}`;
    throw new Error(detail);
  }
  return JSON.parse(result.stdout) as T;
}

function installedPlugins(value: InstalledPlugin[] | { installed?: InstalledPlugin[] }) {
  return Array.isArray(value) ? value : (value.installed ?? []);
}

function validManifest(
  installPath: string | undefined,
  expectedName: string,
  expectedVersion: string,
): boolean {
  if (!installPath) return false;
  const manifestPath = path.join(installPath, '.claude-plugin', 'plugin.json');
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string;
      version?: string;
    };
    return manifest.name === expectedName && manifest.version === expectedVersion;
  } catch {
    return false;
  }
}

function pluginOperations(plugin: ClaudePluginState): ClaudePluginOperation[] {
  if (!plugin.installed) {
    return [
      {
        runtime: 'claude-code',
        kind: 'install',
        id: plugin.id,
        scope: 'user',
        targetVersion: plugin.expectedVersion,
        description: `Install ${plugin.id} ${plugin.expectedVersion}`,
      },
    ];
  }
  const operations: ClaudePluginOperation[] = [];
  if (plugin.installedVersion !== plugin.expectedVersion || !plugin.identityValid) {
    operations.push({
      runtime: 'claude-code',
      kind: 'update',
      id: plugin.id,
      scope: 'user',
      currentVersion: plugin.installedVersion,
      targetVersion: plugin.expectedVersion,
      description: !plugin.identityValid
        ? `Refresh ${plugin.id} to restore its stable plugin identity`
        : `Update ${plugin.id} from ${plugin.installedVersion} to ${plugin.expectedVersion}`,
    });
  }
  if (!plugin.enabled) {
    operations.push({
      runtime: 'claude-code',
      kind: 'enable',
      id: plugin.id,
      scope: 'user',
      currentVersion: plugin.installedVersion,
      targetVersion: plugin.expectedVersion,
      description: `Enable ${plugin.id}`,
    });
  }
  return operations;
}

function runOrThrow(
  runner: ClaudeCommandRunner,
  args: string[],
  operation: ClaudePluginOperation,
): void {
  const result = runner(args);
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() || `exit ${result.status}`;
    throw new Error(`${operation.description}: ${detail}`);
  }
}

/** The uninstall command setup runs for a plugin it retires; the same text is given to users. */
export function claudePluginUninstallCommand(id: string): string {
  return `claude plugin uninstall ${id} --scope user --keep-data --yes`;
}

/**
 * Render the exact `claude` shell command a plugin operation maps to — the same
 * argv `applyBundledClaudePluginIntegration`'s `runOrThrow` calls use, only as a
 * printable string. `planr upgrade apply` prescribes (never executes) the plugin
 * half from these, so the printed commands can never drift from what an apply
 * would actually run. `marketplaceRoot` is the bundled directory an
 * `add-marketplace` registers. A pure formatter: it never touches the host.
 */
export function formatClaudePluginOperationCommand(
  operation: ClaudePluginOperation,
  marketplaceRoot: string,
): string {
  switch (operation.kind) {
    case 'add-marketplace':
      return `claude plugin marketplace add ${marketplaceRoot}`;
    case 'refresh-marketplace':
      return `claude plugin marketplace update ${operation.id}`;
    case 'install':
      return `claude plugin install ${operation.id} --scope user`;
    case 'update':
      return `claude plugin update ${operation.id} --scope user`;
    case 'enable':
      return `claude plugin enable ${operation.id} --scope user`;
    case 'remove':
      return claudePluginUninstallCommand(operation.id);
  }
}

function bundledMarketplace(marketplaceRoot: string) {
  const manifestPath = path.join(marketplaceRoot, '.claude-plugin', 'marketplace.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Bundled Claude marketplace is missing: ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    name?: string;
    plugins?: Array<{ name?: string; version?: string }>;
  };
  const plugin = manifest.plugins?.find(({ name }) => name === OPENPLANR_CLAUDE_PLUGIN);
  if (!manifest.name || !plugin?.version) {
    throw new Error(
      `Bundled Claude marketplace does not declare ${OPENPLANR_CLAUDE_PLUGIN} and its version.`,
    );
  }
  return { name: manifest.name, version: plugin.version };
}

function bundledPluginState(
  installed: InstalledPlugin[],
  marketplaceName: string,
  expectedVersion: string,
  expectedRoot: string,
): ClaudePluginState {
  const id = `${OPENPLANR_CLAUDE_PLUGIN}@${marketplaceName}`;
  const selected = installed.find((plugin) => plugin.id === id && plugin.scope === 'user');
  return {
    id,
    name: OPENPLANR_CLAUDE_PLUGIN,
    expectedVersion,
    ...(selected?.version ? { installedVersion: selected.version } : {}),
    enabled: selected?.enabled === true,
    installed: Boolean(selected),
    identityValid:
      validManifest(selected?.installPath, OPENPLANR_CLAUDE_PLUGIN, expectedVersion) &&
      bundledContentMatches(expectedRoot, selected?.installPath),
    ...(selected?.installPath ? { installPath: selected.installPath } : {}),
  };
}

function bundledContentMatches(expectedRoot: string, installedRoot: string | undefined): boolean {
  if (!installedRoot) return false;
  const identity = '.openplanr-content.json';
  const expected = path.join(expectedRoot, identity);
  const installed = path.join(installedRoot, identity);
  if (!existsSync(expected) || !existsSync(installed)) return false;
  if (!readFileSync(expected).equals(readFileSync(installed))) return false;
  return (
    !existsSync(path.join(installedRoot, 'commands')) &&
    !existsSync(path.join(installedRoot, 'codex-skills'))
  );
}

/** Inspect the self-contained generated Claude package without consulting a remote marketplace. */
export function inspectBundledClaudePluginIntegration(
  marketplaceRoot: string,
  runner: ClaudeCommandRunner = defaultRunner,
): ClaudePluginInspection {
  const versionCheck = runner(['--version']);
  if (versionCheck.error || versionCheck.status !== 0) {
    return {
      available: false,
      marketplaceConfigured: false,
      ready: false,
      operations: [],
      plugins: [],
      legacyPluginIds: [],
      duplicatePluginIds: [],
      error: versionCheck.error?.message || versionCheck.stderr.trim() || 'Claude Code unavailable',
    };
  }
  try {
    const desired = bundledMarketplace(marketplaceRoot);
    const marketplaces = parseJson<MarketplaceEntry[]>(
      runner(['plugin', 'marketplace', 'list', '--json']),
    );
    const installed = installedPlugins(
      parseJson<InstalledPlugin[] | { installed?: InstalledPlugin[] }>(
        runner(['plugin', 'list', '--json']),
      ),
    );
    const configured = marketplaces.find(({ name }) => name === desired.name);
    const plugin = bundledPluginState(
      installed,
      desired.name,
      desired.version,
      path.join(marketplaceRoot, 'openplanr'),
    );
    const legacyPluginIds = installed
      .filter(
        (candidate) =>
          candidate.scope === 'user' &&
          Boolean(candidate.id) &&
          candidate.id !== plugin.id &&
          (candidate.id?.startsWith('openplanr@') || candidate.id?.startsWith('planr-pipeline@')),
      )
      .map((candidate) => candidate.id as string)
      .sort();
    // A `planr` plugin from another marketplace (`/plugin install planr@openplanr`) exposes the
    // same `/planr` commands as the bundled one. Removing it is the user's call, so it is only
    // reported: it neither blocks `ready` nor becomes a remove operation like a legacy id.
    const duplicatePluginIds = installed
      .filter(
        (candidate) =>
          candidate.scope === 'user' &&
          Boolean(candidate.id) &&
          candidate.id !== plugin.id &&
          candidate.id?.startsWith(`${OPENPLANR_CLAUDE_PLUGIN}@`),
      )
      .map((candidate) => candidate.id as string)
      .sort();
    const marketplaceOperation: ClaudePluginOperation = {
      runtime: 'claude-code',
      kind: configured ? 'refresh-marketplace' : 'add-marketplace',
      id: desired.name,
      scope: 'user',
      description: configured
        ? 'Refresh the generated local OpenPlanr Claude marketplace'
        : 'Add the generated local OpenPlanr Claude marketplace',
    };
    return {
      available: true,
      marketplaceConfigured: Boolean(configured),
      ready:
        Boolean(configured) &&
        plugin.installed &&
        plugin.enabled &&
        plugin.identityValid &&
        plugin.installedVersion === plugin.expectedVersion &&
        legacyPluginIds.length === 0,
      operations: [
        marketplaceOperation,
        ...pluginOperations(plugin),
        ...legacyPluginIds.map<ClaudePluginOperation>((id) => ({
          runtime: 'claude-code',
          kind: 'remove',
          id,
          scope: 'user',
          description: `Remove legacy OpenPlanr Claude plugin ${id}`,
        })),
      ],
      plugins: [plugin],
      legacyPluginIds,
      duplicatePluginIds,
    };
  } catch (cause) {
    return {
      available: true,
      marketplaceConfigured: false,
      ready: false,
      operations: [],
      plugins: [],
      legacyPluginIds: [],
      duplicatePluginIds: [],
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/** Apply and verify a local Claude package installation through Claude's native plugin manager. */
export function applyBundledClaudePluginIntegration(
  marketplaceRoot: string,
  inspection: ClaudePluginInspection,
  runner: ClaudeCommandRunner = defaultRunner,
): ClaudePluginApplyResult {
  if (!inspection.available || inspection.error) {
    throw new Error(inspection.error ?? 'Claude Code is unavailable');
  }
  const performed: ClaudePluginOperation[] = [];
  const marketplaceOperation = inspection.operations.find((operation) =>
    ['add-marketplace', 'refresh-marketplace'].includes(operation.kind),
  );
  if (marketplaceOperation?.kind === 'add-marketplace') {
    runOrThrow(runner, ['plugin', 'marketplace', 'add', marketplaceRoot], marketplaceOperation);
    performed.push(marketplaceOperation);
  } else if (marketplaceOperation?.kind === 'refresh-marketplace') {
    runOrThrow(
      runner,
      ['plugin', 'marketplace', 'update', marketplaceOperation.id],
      marketplaceOperation,
    );
    performed.push(marketplaceOperation);
  }
  const refreshed = inspectBundledClaudePluginIntegration(marketplaceRoot, runner);
  if (refreshed.error) throw new Error(refreshed.error);
  for (const operation of refreshed.operations.filter(
    ({ kind }) => !['add-marketplace', 'refresh-marketplace'].includes(kind),
  )) {
    const plugin = refreshed.plugins.find(({ id }) => id === operation.id);
    const replaceSameVersion =
      operation.kind === 'update' &&
      plugin !== undefined &&
      plugin.installedVersion === plugin.expectedVersion &&
      !plugin.identityValid;
    if (operation.kind === 'remove') {
      runOrThrow(
        runner,
        ['plugin', 'uninstall', operation.id, '--scope', 'user', '--keep-data', '--yes'],
        operation,
      );
    } else if (replaceSameVersion) {
      runOrThrow(
        runner,
        ['plugin', 'uninstall', operation.id, '--scope', 'user', '--keep-data', '--yes'],
        operation,
      );
      runOrThrow(runner, ['plugin', 'install', operation.id, '--scope', 'user'], operation);
    } else {
      runOrThrow(runner, ['plugin', operation.kind, operation.id, '--scope', 'user'], operation);
    }
    performed.push(operation);
  }
  const finalInspection = inspectBundledClaudePluginIntegration(marketplaceRoot, runner);
  if (!finalInspection.ready) {
    throw new Error(finalInspection.error ?? 'Claude local OpenPlanr plugin verification failed.');
  }
  return {
    operations: performed,
    restartRequired: performed.some(({ kind }) =>
      ['install', 'update', 'enable', 'remove'].includes(kind),
    ),
    inspection: finalInspection,
  };
}
