import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const OPENPLANR_CLAUDE_MARKETPLACE = 'openplanr';
export const OPENPLANR_CLAUDE_MARKETPLACE_SOURCE = 'openplanr/marketplace';
/**
 * The skills-plugin version this CLI targets. It had drifted three releases behind the
 * published bundle, and because the plugin-half prescription derives its skills target
 * from here, a genuinely stale skills plugin was silently omitted from the commands — a
 * user could run every prescribed command and still be on an old bundle believing they
 * were current. Bumping it with each skills release is the interim contract; deriving it
 * from the published manifest instead is tracked separately.
 */
export const OPENPLANR_SKILLS_VERSION = '1.26.0';

export type ClaudePluginOperationKind =
  | 'add-marketplace'
  | 'refresh-marketplace'
  | 'install'
  | 'update'
  | 'enable';

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
  repo?: string;
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

function stableVersionParts(version: string): number[] | null {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
  return version.split('.').map(Number);
}

function newestCompatibleTarget(minimum: string, advertised?: string): string {
  if (!advertised) return minimum;
  const minimumParts = stableVersionParts(minimum);
  const advertisedParts = stableVersionParts(advertised);
  if (!minimumParts || !advertisedParts) return minimum;
  if (
    advertisedParts[0] !== minimumParts[0] ||
    (minimumParts[0] === 0 && advertisedParts[1] !== minimumParts[1])
  ) {
    return minimum;
  }
  for (let index = 0; index < minimumParts.length; index += 1) {
    if (advertisedParts[index] > minimumParts[index]) return advertised;
    if (advertisedParts[index] < minimumParts[index]) return minimum;
  }
  return advertised;
}

function marketplaceTargets(marketplace: MarketplaceEntry | undefined): Map<string, string> {
  if (!marketplace?.installLocation) return new Map();
  const manifestPath = path.join(marketplace.installLocation, '.claude-plugin', 'marketplace.json');
  if (!existsSync(manifestPath)) return new Map();
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      plugins?: Array<{ name?: string; version?: string }>;
    };
    return new Map(
      (manifest.plugins ?? [])
        .filter((plugin): plugin is { name: string; version: string } =>
          Boolean(plugin.name && plugin.version),
        )
        .map((plugin) => [plugin.name, plugin.version]),
    );
  } catch {
    return new Map();
  }
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

function pluginState(
  installed: InstalledPlugin[],
  name: string,
  expectedVersion: string,
): ClaudePluginState {
  const id = `${name}@${OPENPLANR_CLAUDE_MARKETPLACE}`;
  const selected = installed.find((plugin) => plugin.id === id && plugin.scope === 'user');
  const installedVersion = selected?.version;
  return {
    id,
    name,
    expectedVersion,
    ...(installedVersion ? { installedVersion } : {}),
    enabled: selected?.enabled === true,
    installed: Boolean(selected),
    identityValid: validManifest(selected?.installPath, name, expectedVersion),
    ...(selected?.installPath ? { installPath: selected.installPath } : {}),
  };
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

export function inspectClaudePluginIntegration(
  pipelineVersion: string,
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
      error: versionCheck.error?.message || versionCheck.stderr.trim() || 'Claude Code unavailable',
    };
  }

  try {
    const marketplaces = parseJson<MarketplaceEntry[]>(
      runner(['plugin', 'marketplace', 'list', '--json']),
    );
    const listed = parseJson<InstalledPlugin[] | { installed?: InstalledPlugin[] }>(
      runner(['plugin', 'list', '--json']),
    );
    const installed = installedPlugins(listed);
    const officialMarketplace = marketplaces.find(
      (marketplace) =>
        marketplace.name === OPENPLANR_CLAUDE_MARKETPLACE &&
        marketplace.repo === OPENPLANR_CLAUDE_MARKETPLACE_SOURCE,
    );
    const marketplaceConfigured = Boolean(officialMarketplace);
    const targets = marketplaceTargets(officialMarketplace);
    const plugins = [
      pluginState(
        installed,
        'openplanr',
        newestCompatibleTarget(OPENPLANR_SKILLS_VERSION, targets.get('openplanr')),
      ),
      pluginState(
        installed,
        'planr-pipeline',
        newestCompatibleTarget(pipelineVersion, targets.get('planr-pipeline')),
      ),
    ];
    const operations: ClaudePluginOperation[] = [
      {
        runtime: 'claude-code',
        kind: marketplaceConfigured ? 'refresh-marketplace' : 'add-marketplace',
        id: OPENPLANR_CLAUDE_MARKETPLACE,
        scope: 'user',
        description: marketplaceConfigured
          ? 'Refresh the official OpenPlanr Claude marketplace'
          : 'Add the official OpenPlanr Claude marketplace',
      },
      ...plugins.flatMap(pluginOperations),
    ];
    const legacyPluginIds = installed
      .filter(
        (plugin) =>
          plugin.scope === 'user' &&
          plugin.id?.startsWith('openplanr@') &&
          plugin.id !== `openplanr@${OPENPLANR_CLAUDE_MARKETPLACE}`,
      )
      .map((plugin) => plugin.id as string);
    return {
      available: true,
      marketplaceConfigured,
      ready:
        marketplaceConfigured &&
        plugins.every(
          (plugin) =>
            plugin.installed &&
            plugin.enabled &&
            plugin.identityValid &&
            plugin.installedVersion === plugin.expectedVersion,
        ),
      operations,
      plugins,
      legacyPluginIds,
    };
  } catch (cause) {
    return {
      available: true,
      marketplaceConfigured: false,
      ready: false,
      operations: [],
      plugins: [],
      legacyPluginIds: [],
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
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

/**
 * Render the exact `claude` shell command a plugin operation maps to — the same
 * argv `applyClaudePluginIntegration`'s `runOrThrow` calls above already use,
 * only as a printable string. `planr upgrade apply` prescribes (never executes)
 * the plugin half from these, so the printed commands can never drift from what
 * an apply would actually run. A pure formatter: it derives a command, it never
 * touches the host — plugin installation is a host command the CLI cannot own.
 */
export function formatClaudePluginOperationCommand(operation: ClaudePluginOperation): string {
  switch (operation.kind) {
    case 'add-marketplace':
      return `claude plugin marketplace add ${OPENPLANR_CLAUDE_MARKETPLACE_SOURCE} --scope user`;
    case 'refresh-marketplace':
      return `claude plugin marketplace update ${OPENPLANR_CLAUDE_MARKETPLACE}`;
    case 'install':
      return `claude plugin install ${operation.id} --scope user`;
    case 'update':
      return `claude plugin update ${operation.id} --scope user`;
    case 'enable':
      return `claude plugin enable ${operation.id} --scope user`;
  }
}

export function applyClaudePluginIntegration(
  pipelineVersion: string,
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
  if (marketplaceOperation) {
    if (marketplaceOperation.kind === 'add-marketplace') {
      runOrThrow(
        runner,
        ['plugin', 'marketplace', 'add', OPENPLANR_CLAUDE_MARKETPLACE_SOURCE, '--scope', 'user'],
        marketplaceOperation,
      );
    } else {
      runOrThrow(
        runner,
        ['plugin', 'marketplace', 'update', OPENPLANR_CLAUDE_MARKETPLACE],
        marketplaceOperation,
      );
    }
    performed.push(marketplaceOperation);
  }

  const refreshedInspection = inspectClaudePluginIntegration(pipelineVersion, runner);
  if (refreshedInspection.error) throw new Error(refreshedInspection.error);
  for (const operation of refreshedInspection.operations.filter(
    (item) => !['add-marketplace', 'refresh-marketplace'].includes(item.kind),
  )) {
    if (operation.kind === 'install') {
      runOrThrow(runner, ['plugin', 'install', operation.id, '--scope', 'user'], operation);
    } else if (operation.kind === 'update') {
      runOrThrow(runner, ['plugin', 'update', operation.id, '--scope', 'user'], operation);
    } else if (operation.kind === 'enable') {
      runOrThrow(runner, ['plugin', 'enable', operation.id, '--scope', 'user'], operation);
    }
    performed.push(operation);
  }

  const finalInspection = inspectClaudePluginIntegration(pipelineVersion, runner);
  if (!finalInspection.ready) {
    const drift = finalInspection.plugins
      .filter(
        (plugin) =>
          !plugin.installed ||
          !plugin.enabled ||
          !plugin.identityValid ||
          plugin.installedVersion !== plugin.expectedVersion,
      )
      .map(
        (plugin) =>
          `${plugin.id}=${plugin.installedVersion ?? 'missing'} (expected ${plugin.expectedVersion})`,
      )
      .join(', ');
    throw new Error(
      finalInspection.error || `Claude plugin verification failed${drift ? `: ${drift}` : ''}`,
    );
  }
  return {
    operations: performed,
    restartRequired: performed.some((operation) =>
      ['install', 'update', 'enable'].includes(operation.kind),
    ),
    inspection: finalInspection,
  };
}
