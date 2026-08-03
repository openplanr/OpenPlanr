import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
export const OPENPLANR_CLAUDE_MARKETPLACE = 'openplanr';
export const OPENPLANR_CLAUDE_MARKETPLACE_SOURCE = 'openplanr/marketplace';
export const OPENPLANR_SKILLS_VERSION = '1.23.0';
function defaultRunner(args) {
    const result = spawnSync('claude', args, {
        encoding: 'utf8',
        windowsHide: true,
    });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        ...(result.error ? { error: result.error } : {}),
    };
}
function parseJson(result) {
    if (result.error || result.status !== 0) {
        const detail = result.error?.message || result.stderr.trim() || `exit ${result.status}`;
        throw new Error(detail);
    }
    return JSON.parse(result.stdout);
}
function installedPlugins(value) {
    return Array.isArray(value) ? value : (value.installed ?? []);
}
function stableVersionParts(version) {
    if (!/^\d+\.\d+\.\d+$/.test(version))
        return null;
    return version.split('.').map(Number);
}
function newestCompatibleTarget(minimum, advertised) {
    if (!advertised)
        return minimum;
    const minimumParts = stableVersionParts(minimum);
    const advertisedParts = stableVersionParts(advertised);
    if (!minimumParts || !advertisedParts)
        return minimum;
    if (advertisedParts[0] !== minimumParts[0] ||
        (minimumParts[0] === 0 && advertisedParts[1] !== minimumParts[1])) {
        return minimum;
    }
    for (let index = 0; index < minimumParts.length; index += 1) {
        if (advertisedParts[index] > minimumParts[index])
            return advertised;
        if (advertisedParts[index] < minimumParts[index])
            return minimum;
    }
    return advertised;
}
function marketplaceTargets(marketplace) {
    if (!marketplace?.installLocation)
        return new Map();
    const manifestPath = path.join(marketplace.installLocation, '.claude-plugin', 'marketplace.json');
    if (!existsSync(manifestPath))
        return new Map();
    try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        return new Map((manifest.plugins ?? [])
            .filter((plugin) => Boolean(plugin.name && plugin.version))
            .map((plugin) => [plugin.name, plugin.version]));
    }
    catch {
        return new Map();
    }
}
function validManifest(installPath, expectedName, expectedVersion) {
    if (!installPath)
        return false;
    const manifestPath = path.join(installPath, '.claude-plugin', 'plugin.json');
    if (!existsSync(manifestPath))
        return false;
    try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        return manifest.name === expectedName && manifest.version === expectedVersion;
    }
    catch {
        return false;
    }
}
function pluginState(installed, name, expectedVersion) {
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
function pluginOperations(plugin) {
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
    const operations = [];
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
export function inspectClaudePluginIntegration(pipelineVersion, runner = defaultRunner) {
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
        const marketplaces = parseJson(runner(['plugin', 'marketplace', 'list', '--json']));
        const listed = parseJson(runner(['plugin', 'list', '--json']));
        const installed = installedPlugins(listed);
        const officialMarketplace = marketplaces.find((marketplace) => marketplace.name === OPENPLANR_CLAUDE_MARKETPLACE &&
            marketplace.repo === OPENPLANR_CLAUDE_MARKETPLACE_SOURCE);
        const marketplaceConfigured = Boolean(officialMarketplace);
        const targets = marketplaceTargets(officialMarketplace);
        const plugins = [
            pluginState(installed, 'openplanr', newestCompatibleTarget(OPENPLANR_SKILLS_VERSION, targets.get('openplanr'))),
            pluginState(installed, 'planr-pipeline', newestCompatibleTarget(pipelineVersion, targets.get('planr-pipeline'))),
        ];
        const operations = [
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
            .filter((plugin) => plugin.scope === 'user' &&
            plugin.id?.startsWith('openplanr@') &&
            plugin.id !== `openplanr@${OPENPLANR_CLAUDE_MARKETPLACE}`)
            .map((plugin) => plugin.id);
        return {
            available: true,
            marketplaceConfigured,
            ready: marketplaceConfigured &&
                plugins.every((plugin) => plugin.installed &&
                    plugin.enabled &&
                    plugin.identityValid &&
                    plugin.installedVersion === plugin.expectedVersion),
            operations,
            plugins,
            legacyPluginIds,
        };
    }
    catch (cause) {
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
function runOrThrow(runner, args, operation) {
    const result = runner(args);
    if (result.error || result.status !== 0) {
        const detail = result.error?.message || result.stderr.trim() || `exit ${result.status}`;
        throw new Error(`${operation.description}: ${detail}`);
    }
}
export function applyClaudePluginIntegration(pipelineVersion, inspection, runner = defaultRunner) {
    if (!inspection.available || inspection.error) {
        throw new Error(inspection.error ?? 'Claude Code is unavailable');
    }
    const performed = [];
    const marketplaceOperation = inspection.operations.find((operation) => ['add-marketplace', 'refresh-marketplace'].includes(operation.kind));
    if (marketplaceOperation) {
        if (marketplaceOperation.kind === 'add-marketplace') {
            runOrThrow(runner, ['plugin', 'marketplace', 'add', OPENPLANR_CLAUDE_MARKETPLACE_SOURCE, '--scope', 'user'], marketplaceOperation);
        }
        else {
            runOrThrow(runner, ['plugin', 'marketplace', 'update', OPENPLANR_CLAUDE_MARKETPLACE], marketplaceOperation);
        }
        performed.push(marketplaceOperation);
    }
    const refreshedInspection = inspectClaudePluginIntegration(pipelineVersion, runner);
    if (refreshedInspection.error)
        throw new Error(refreshedInspection.error);
    for (const operation of refreshedInspection.operations.filter((item) => !['add-marketplace', 'refresh-marketplace'].includes(item.kind))) {
        if (operation.kind === 'install') {
            runOrThrow(runner, ['plugin', 'install', operation.id, '--scope', 'user'], operation);
        }
        else if (operation.kind === 'update') {
            runOrThrow(runner, ['plugin', 'update', operation.id, '--scope', 'user'], operation);
        }
        else if (operation.kind === 'enable') {
            runOrThrow(runner, ['plugin', 'enable', operation.id, '--scope', 'user'], operation);
        }
        performed.push(operation);
    }
    const finalInspection = inspectClaudePluginIntegration(pipelineVersion, runner);
    if (!finalInspection.ready) {
        const drift = finalInspection.plugins
            .filter((plugin) => !plugin.installed ||
            !plugin.enabled ||
            !plugin.identityValid ||
            plugin.installedVersion !== plugin.expectedVersion)
            .map((plugin) => `${plugin.id}=${plugin.installedVersion ?? 'missing'} (expected ${plugin.expectedVersion})`)
            .join(', ');
        throw new Error(finalInspection.error || `Claude plugin verification failed${drift ? `: ${drift}` : ''}`);
    }
    return {
        operations: performed,
        restartRequired: performed.some((operation) => ['install', 'update', 'enable'].includes(operation.kind)),
        inspection: finalInspection,
    };
}
//# sourceMappingURL=claude-plugin-service.js.map