import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';
import { z } from 'zod';
import { userHome } from '../../lib/planr-home.mjs';
import { parseExternalJson } from '../utils/external-json.js';

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
  payloadCurrent?: boolean;
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

const marketplaceListSchema = z.object({
  marketplaces: z
    .array(
      z.object({
        name: z.string().optional(),
        root: z.string().optional(),
        marketplaceSource: z.object({ source: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

const installedRowSchema = z.object({
  pluginId: z.string().optional(),
  name: z.string().optional(),
  marketplaceName: z.string().optional(),
  version: z.string().optional(),
  enabled: z.boolean().optional(),
  installed: z.boolean().optional(),
});

const pluginListSchema = z.union([
  z.array(installedRowSchema),
  z.object({ installed: z.array(installedRowSchema).optional() }),
]);

function output<T>(runner: CodexCommandRunner, args: string[], schema: z.ZodType<T>): T {
  const result = runner(args);
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message ||
        result.stderr.trim() ||
        `codex ${args.join(' ')} exited ${result.status}`,
    );
  }
  return parseExternalJson(result.stdout, schema, `codex ${args.join(' ')}`);
}

function installedRows(value: z.infer<typeof pluginListSchema>) {
  return Array.isArray(value) ? value : (value.installed ?? []);
}

/** Native marketplace listings can omit enabled registrations whose old identity was retired. */
function configuredPluginRows(): z.infer<typeof installedRowSchema>[] {
  const configPath = path.join(
    process.env.CODEX_HOME || path.join(userHome(), '.codex'),
    'config.toml',
  );
  if (!existsSync(configPath)) return [];
  let config: Record<string, unknown>;
  try {
    config = parse(readFileSync(configPath, 'utf8'));
  } catch {
    // Parser diagnostics can include private configuration values; report only the location.
    throw new Error(
      `Could not read Codex plugin registrations from ${configPath}. Repair its TOML before retrying.`,
    );
  }
  const plugins = config.plugins;
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return [];
  return Object.entries(plugins).flatMap(([pluginId, value]) => {
    const [name, marketplaceName, extra] = pluginId.split('@');
    if (extra || !marketplaceName || ![HOST_PLUGIN_NAME, LEGACY_HOST_PLUGIN_NAME].includes(name))
      return [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const enabled = 'enabled' in value ? value.enabled : undefined;
    if (typeof enabled !== 'boolean') return [];
    return [{ pluginId, name, marketplaceName, enabled, installed: true }];
  });
}

function pluginPayloadCurrent(
  hostPackageRoot: string,
  source: unknown,
  marketplaceName: string,
  version: string,
): boolean | undefined {
  const relativeSource =
    typeof source === 'string'
      ? source
      : source && typeof source === 'object' && 'path' in source
        ? source.path
        : undefined;
  if (
    typeof relativeSource !== 'string' ||
    !relativeSource.startsWith('./') ||
    relativeSource.split('/').includes('..')
  )
    return undefined;
  const packaged = path.join(hostPackageRoot, relativeSource);
  if (!existsSync(packaged)) return undefined;
  const nativeHome = process.env.CODEX_HOME || path.join(userHome(), '.codex');
  const cache = path.join(nativeHome, 'plugins', 'cache', marketplaceName, HOST_PLUGIN_NAME);
  const cached = existsSync(path.join(cache, version))
    ? path.join(cache, version)
    : path.join(cache, 'local');
  const matches = (directory: string): boolean =>
    readdirSync(directory, { withFileTypes: true }).every((entry) => {
      const expected = path.join(directory, entry.name);
      if (entry.isDirectory()) return matches(expected);
      if (!entry.isFile()) return false;
      const actual = path.join(cached, path.relative(packaged, expected));
      return (
        existsSync(actual) &&
        lstatSync(actual).isFile() &&
        readFileSync(actual).equals(readFileSync(expected))
      );
    });
  try {
    return matches(packaged);
  } catch {
    return false;
  }
}

export function inspectCodexPluginIntegration(
  hostPackageRoot: string,
  desiredMode: 'direct' | 'unified-plugin' | 'project-rule',
  previousMode: 'direct' | 'unified-plugin' | 'project-rule' | undefined,
  runner: CodexCommandRunner = defaultRunner,
): CodexPluginInspection {
  const marketplacePath = path.join(hostPackageRoot, '.claude-plugin', 'marketplace.json');
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
      error:
        'The CLI bundled Codex host package is missing its OpenPlanr marketplace. Run planr setup --runtime codex to repair it.',
    };
  }
  const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8')) as {
    name: string;
    plugins: Array<{ name: string; version: string; source?: unknown }>;
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
      error: `The CLI bundled Codex host marketplace does not declare ${HOST_PLUGIN_NAME}. Run planr setup --runtime codex to repair it.`,
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
    const listedMarketplaces = output(
      runner,
      ['plugin', 'marketplace', 'list', '--json'],
      marketplaceListSchema,
    );
    const configured = (listedMarketplaces.marketplaces ?? []).find(
      ({ name }) => name === marketplaceName,
    );
    if (configured) {
      const configuredRoot = canonicalRoot(
        String(configured.root ?? configured.marketplaceSource?.source ?? ''),
      );
      const expectedRoot = canonicalRoot(hostPackageRoot);
      if (configuredRoot !== expectedRoot)
        throw new Error(
          `Codex marketplace ${marketplaceName} points to ${configuredRoot}, not ${expectedRoot}.`,
        );
    }
    const listed = installedRows(output(runner, ['plugin', 'list', '--json'], pluginListSchema));
    const registrations = configuredPluginRows();
    const installed = listed
      .filter((row) => row.installed !== false)
      .map((row) => {
        const id = row.pluginId ?? `${row.name}@${row.marketplaceName}`;
        const registration = registrations.find((entry) => entry.pluginId === id);
        return registration ? { ...registration, ...row, enabled: registration.enabled } : row;
      });
    for (const registration of registrations) {
      if (
        !installed.some(
          (row) => (row.pluginId ?? `${row.name}@${row.marketplaceName}`) === registration.pluginId,
        )
      ) {
        installed.push(registration);
      }
    }
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
          (row.pluginId ?? `${row.name}@${row.marketplaceName}`) !== pluginId,
      )
      .map((row) => String(row.pluginId ?? `${row.name}@${row.marketplaceName}`))
      .sort();
    const installedVersion = selected?.version ? String(selected.version) : null;
    const payloadCurrent = selected
      ? pluginPayloadCurrent(hostPackageRoot, plugin.source, marketplaceName, plugin.version)
      : undefined;
    const needsInstall =
      !selected ||
      installedVersion !== plugin.version ||
      selected.enabled === false ||
      payloadCurrent === false;
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
      if (selected && needsInstall)
        operations.push({
          runtime: 'codex',
          kind: 'remove',
          id: pluginId,
          scope: 'user',
          description:
            payloadCurrent === false
              ? `Repair incomplete Codex plugin ${pluginId} ${plugin.version}`
              : `Replace stale or disabled Codex plugin ${pluginId} ${installedVersion}`,
        });
      if (needsInstall)
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
    } else {
      for (const row of [...(selected ? [selected] : []), ...managedLegacy]) {
        operations.push({
          runtime: 'codex',
          kind: 'remove',
          id: String(row.pluginId ?? `${row.name}@${row.marketplaceName}`),
          scope: 'user',
          description: `Retire the managed Codex plugin ${previousMode === 'unified-plugin' ? 'before switching to' : 'to preserve'} ${desiredMode} discovery`,
        });
      }
    }
    return {
      available: true,
      ready:
        desiredMode === 'unified-plugin'
          ? Boolean(
              configured &&
                selected &&
                selected.enabled !== false &&
                payloadCurrent !== false &&
                operations.length === 0 &&
                installedVersion === plugin.version &&
                duplicates.length === 0,
            )
          : !selected && duplicates.length === 0 && operations.length === 0,
      marketplaceName,
      pluginId,
      installed: Boolean(selected && selected.enabled !== false),
      installedVersion,
      duplicates,
      operations,
      ...(payloadCurrent === undefined ? {} : { payloadCurrent }),
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
  hostPackageRoot: string,
  inspection: CodexPluginInspection,
  runner: CodexCommandRunner = defaultRunner,
): { operations: CodexPluginOperation[]; restartRequired: boolean } {
  if (!inspection.available || inspection.error)
    throw new Error(inspection.error ?? 'Codex plugin integration is unavailable.');
  for (const operation of inspection.operations) {
    const args =
      operation.kind === 'add-marketplace'
        ? ['plugin', 'marketplace', 'add', hostPackageRoot, '--json']
        : operation.kind === 'install'
          ? ['plugin', 'add', operation.id, '--json']
          : ['plugin', 'remove', operation.id, '--json'];
    output(runner, args, z.unknown());
  }
  return { operations: inspection.operations, restartRequired: inspection.operations.length > 0 };
}
