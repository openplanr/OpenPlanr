import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CLI_NODE_REMEDIATION,
  cliNodeVersionMessage,
  supportsCliNodeVersion,
} from '../../../lib/node-runtime.mjs';
import { CLI_COMMAND, PLANNING_FOLDER } from '../../utils/constants.js';
import {
  type ClaudeCommandRunner,
  duplicateClaudePluginDiagnostic,
  inspectBundledClaudePluginIntegration,
} from '../claude-plugin-service.js';
import { type CodexCommandRunner, inspectCodexPluginIntegration } from '../codex-plugin-service.js';
import { resolvePipelinePackage } from '../pipeline-package-service.js';
import { readOpenPlanrVersion } from '../provenance-service.js';
import { type CodexSkillDiscovery, inspectCodexSkillDiscovery } from './codex-discovery.js';
import { RuntimeManagerError } from './errors.js';
import type { OwnedFile } from './global-state.js';
import {
  type InstallScope,
  inferRuntimeScope,
  loadState,
  previewHomeProjectCleanup,
  projectUsesUserRuntime,
  type SkillInstallMode,
} from './global-state.js';
import {
  type RuntimeLockAdapter,
  runtimeLockManifestDigest,
  validateRuntimeLockContract,
} from './install-plan.js';
import {
  detectInstalledRuntimes as detectRuntimes,
  listInstalledRuntimeAdapters as listRuntimeAdapters,
  type RuntimeId,
  readRegistry,
} from './inventory.js';
import { codexSkillsRoot, pathIsWithin, planrHome, projectKey, statePath } from './paths.js';
import {
  bundledHostRoot,
  bundledSkillAssets,
  inspectRuntimeLocator,
  inspectThinRule,
} from './runtime-package.js';
import { managedBlockBytes, ownershipHash } from './storage.js';

export type RuntimeDoctorDiagnostic = Readonly<{
  code: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}>;

export type InstalledDocument = Readonly<{
  runtime: string;
  target: string;
  kind?: OwnedFile['kind'];
  marker?: string;
}>;

const SETUP_RUNTIMES: Readonly<Record<string, string>> = {
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor',
};

export function classifyComponentDrift(input: {
  cliDrift: boolean;
  componentDrift: boolean;
  incompatibleDrift: boolean;
}): {
  drift: boolean;
  genuineDrift: boolean;
  upgradeOnlyDrift: boolean;
  status: 'pass' | 'warn' | 'fail';
} {
  const drift = input.componentDrift || input.incompatibleDrift;
  const genuineDrift = input.incompatibleDrift;
  const upgradeOnlyDrift = drift && !genuineDrift && input.cliDrift;
  const status: 'pass' | 'warn' | 'fail' = genuineDrift
    ? 'fail'
    : upgradeOnlyDrift
      ? 'warn'
      : drift
        ? 'fail'
        : 'pass';
  return { drift, genuineDrift, upgradeOnlyDrift, status };
}

/** Diagnoses byte ownership without mutating or repairing the managed targets. */
export function diagnoseManagedRuntimeFiles(
  files: readonly OwnedFile[],
  ownershipHash: (content: string | Buffer, kind: OwnedFile['kind'], marker?: string) => string,
): RuntimeDoctorDiagnostic | null {
  if (files.length === 0) return null;
  const conflicts: string[] = [];
  const missing: string[] = [];
  for (const file of files) {
    if (!existsSync(file.target)) missing.push(file.target);
    else if (ownershipHash(readFileSync(file.target), file.kind, file.marker) !== file.hash) {
      conflicts.push(file.target);
    }
  }
  return {
    code: conflicts.length ? 'migration-conflict' : 'managed-files',
    status: conflicts.length ? 'fail' : missing.length ? 'warn' : 'pass',
    message: conflicts.length
      ? `${conflicts.length} managed file(s) changed outside setup`
      : missing.length
        ? `${missing.length} managed file(s) are missing`
        : 'Managed runtime files match recorded ownership hashes',
    ...(conflicts.length || missing.length
      ? {
          fix: `Run \`${CLI_COMMAND} setup --dry-run\`, then explicitly approve repair or rollback.`,
        }
      : {}),
  };
}

/** Validates the append-only public provenance surface without inventing repairs. */
export function diagnoseRuntimeProvenance(projectDir: string): RuntimeDoctorDiagnostic | null {
  const provenancePath = path.join(projectDir, PLANNING_FOLDER, 'provenance.jsonl');
  if (!existsSync(provenancePath)) return null;
  const invalidLines: number[] = [];
  const lines = readFileSync(provenancePath, 'utf8').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        event_id?: string;
        producer?: { product?: string };
      };
      if (!event.event_id || !event.producer?.product) invalidLines.push(index + 1);
    } catch {
      invalidLines.push(index + 1);
    }
  }
  return {
    code: invalidLines.length ? 'provenance-invalid' : 'provenance',
    status: invalidLines.length ? 'fail' : 'pass',
    message: invalidLines.length
      ? `Provenance contains invalid event lines: ${invalidLines.join(', ')}`
      : 'Provenance is append-only JSONL with identifiable producers',
    ...(invalidLines.length
      ? {
          fix: 'Repair the invalid bytes, then explicitly append a recovery event. Doctor will not invent history.',
        }
      : {}),
  };
}

/** Markdown and rule documents under an installed plugin folder. */
export function pluginDocuments(runtime: string, root: string): InstalledDocument[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.mdc?$/u.test(entry))
    .map((entry) => ({ runtime, target: path.join(root, entry) }));
}

/**
 * Flags installed skills and rules that still tell the agent to run `planr <command>`.
 * In a shared file, only the block setup manages is read.
 */
export function diagnoseRetiredCommandSkills(
  documents: readonly InstalledDocument[],
  commandRoots: readonly string[],
  managedBlock: (content: Buffer, marker?: string) => Buffer,
): RuntimeDoctorDiagnostic | null {
  const readable = documents.filter(({ target }) => /\.mdc?$/u.test(target) && existsSync(target));
  const roots = commandRoots.filter((root) => /^[a-z][a-z0-9-]*$/u.test(root));
  if (readable.length === 0 || roots.length === 0) return null;
  const retired = new RegExp(`(?<![\\w./@:$#~-])planr[ \\t]+(?:${roots.join('|')})(?![\\w-])`, 'u');
  const stale = readable.filter(({ target, kind, marker }) => {
    const content = readFileSync(target);
    return retired.test(
      (kind === 'managed-block' ? managedBlock(content, marker) : content).toString('utf8'),
    );
  });
  if (stale.length === 0) {
    return {
      code: 'installed-skill-commands',
      status: 'pass',
      message: `Installed skills and rules run ${CLI_COMMAND}`,
    };
  }
  const hosts = [...new Set(stale.flatMap(({ runtime }) => SETUP_RUNTIMES[runtime] ?? []))].sort();
  return {
    code: 'installed-skill-commands',
    status: 'warn',
    message: `${stale.length} installed skill or rule file(s) still tell the agent to run planr, which is no longer installed`,
    fix: hosts.length
      ? `Rerun ${hosts.map((host) => `\`${CLI_COMMAND} setup --runtime ${host}\``).join(' and ')}, or update the plugin, then restart the agent.`
      : `Rerun \`${CLI_COMMAND} setup\`, then restart the agent.`,
  };
}

export async function runtimeDoctor(
  projectDir: string,
  options: {
    pipelineRepair?: 'preview' | 'apply';
    claudeCommandRunner?: ClaudeCommandRunner;
    codexCommandRunner?: CodexCommandRunner;
    /** CLI root commands; enables the check for installed skills that still run `planr`. */
    commandRoots?: readonly string[];
  } = {},
): Promise<{
  ok: boolean;
  codexDiscovery?: CodexSkillDiscovery;
  repairs: Array<{ id: string; operation: 'remove'; target: string; applied: boolean }>;
  diagnostics: Array<{
    code: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    fix?: string;
  }>;
}> {
  const diagnostics: Array<{
    code: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    fix?: string;
  }> = [];
  const repairs: Array<{ id: string; operation: 'remove'; target: string; applied: boolean }> = [];
  let lockedAdapters:
    | Array<{
        runtime: RuntimeId;
        version: string;
        capabilityLevel: string;
        installScope: InstallScope;
      }>
    | undefined;
  const supportedNode = supportsCliNodeVersion(process.versions.node);
  diagnostics.push({
    code: 'node-version',
    status: supportedNode ? 'pass' : 'fail',
    message: supportedNode
      ? `Node.js ${process.versions.node}`
      : cliNodeVersionMessage(process.versions.node),
    ...(!supportedNode ? { fix: CLI_NODE_REMEDIATION } : {}),
  });
  const state = await loadState();
  const installed = state.projects[projectKey(projectDir)];
  const detectedRuntimes = detectRuntimes();
  for (const result of detectedRuntimes) {
    const configured = installed?.runtimes.includes(result.runtime) ?? false;
    diagnostics.push({
      code: `runtime-${result.runtime}`,
      status: result.installed || !configured ? 'pass' : 'warn',
      message: result.installed
        ? `${result.runtime} detected`
        : configured
          ? `${result.runtime} is configured but not detected`
          : `${result.runtime} is not installed or configured`,
      ...(!result.installed && configured
        ? { fix: `Install ${result.command} only if you intend to use this adapter.` }
        : {}),
    });
  }
  const pipeline = resolvePipelinePackage(false);
  diagnostics.push({
    code: 'pipeline-package',
    status: pipeline ? 'pass' : 'warn',
    message: pipeline
      ? `Optional deterministic pipeline utilities ${pipeline.version}`
      : 'Optional deterministic pipeline utilities are not installed',
    ...(!pipeline
      ? { fix: 'Install optional dependencies only if you need pipeline utilities.' }
      : {}),
  });
  const registry = listRuntimeAdapters();
  for (const adapter of registry) {
    const detected = detectedRuntimes.find((entry) => entry.runtime === adapter.id)?.installed;
    const configured = installed?.runtimes.includes(adapter.id) ?? false;
    if (!detected && !configured) continue;
    const mode = adapter.capabilities?.interactiveQuestions;
    diagnostics.push({
      code: `runtime-interaction-${adapter.id}`,
      status: mode ? 'pass' : 'fail',
      message: mode
        ? `${adapter.id} uses ${mode} host-native questions`
        : `${adapter.id} does not declare a host-native question capability`,
      ...(!mode ? { fix: 'Reinstall the OpenPlanr utility CLI host package.' } : {}),
    });
  }
  try {
    const counts = {
      claude: new Set(bundledSkillAssets('claude-code').map(({ skillId }) => skillId)).size,
      codex: new Set(bundledSkillAssets('codex').map(({ skillId }) => skillId)).size,
      cursor: new Set(bundledSkillAssets('cursor').map(({ skillId }) => skillId)).size,
    };
    const uniqueCounts = new Set(Object.values(counts));
    const current = uniqueCounts.size === 1 && counts.claude > 0;
    diagnostics.push({
      code: 'host-skill-packages',
      status: current ? 'pass' : 'fail',
      message: current
        ? `Claude Code, Codex, and Cursor each expose all ${counts.claude} host-native skills`
        : `Host skill package membership drifted (${JSON.stringify(counts)})`,
      ...(!current ? { fix: 'Reinstall the CLI or regenerate its host packages.' } : {}),
    });
  } catch (cause) {
    diagnostics.push({
      code: 'host-skill-packages',
      status: 'fail',
      message: cause instanceof Error ? cause.message : String(cause),
      fix: 'Reinstall the CLI or regenerate its host packages.',
    });
  }
  const claudeManagedAtUserScope = Object.values(state.projects).some(
    (project) =>
      project.runtimes.includes('claude-code') &&
      ['user', 'both'].includes(
        project.runtimeScopes?.['claude-code'] ??
          inferRuntimeScope(project.ownedFiles, 'claude-code'),
      ),
  );
  const pluginSkillDocuments: InstalledDocument[] = [];
  const claudeDetected =
    Boolean(options.claudeCommandRunner) ||
    (detectedRuntimes.find((runtime) => runtime.runtime === 'claude-code')?.installed ?? false);
  if (claudeDetected && claudeManagedAtUserScope) {
    const inspection = inspectBundledClaudePluginIntegration(
      bundledHostRoot('claude'),
      options.claudeCommandRunner,
    );
    if (inspection.error) {
      diagnostics.push({
        code: 'runtime-claude-plugins',
        status: 'fail',
        message: `Claude plugin state could not be inspected: ${inspection.error}`,
        fix: `Update Claude Code, then run \`${CLI_COMMAND} runtime update claude --scope user\`.`,
      });
    } else {
      for (const root of [
        ...inspection.plugins.flatMap((plugin) => plugin.installPath ?? []),
        ...inspection.duplicatePluginPaths,
      ]) {
        pluginSkillDocuments.push(...pluginDocuments('claude-code', root));
      }
      const drift = inspection.plugins.filter(
        (plugin) =>
          !plugin.installed ||
          !plugin.enabled ||
          !plugin.identityValid ||
          plugin.installedVersion !== plugin.expectedVersion,
      );
      diagnostics.push({
        code: 'runtime-claude-plugins',
        status: inspection.ready ? 'pass' : 'fail',
        message: inspection.ready
          ? `Claude plugins match compatibility versions (${inspection.plugins
              .map((plugin) => `${plugin.name} ${plugin.expectedVersion}`)
              .join(', ')})`
          : `Claude plugin drift detected: ${drift
              .map(
                (plugin) =>
                  `${plugin.id} ${plugin.installedVersion ?? 'missing'} → ${plugin.expectedVersion}${
                    !plugin.identityValid ? ' (invalid identity)' : ''
                  }`,
              )
              .join(', ')}`,
        ...(!inspection.ready
          ? {
              fix: `Run \`${CLI_COMMAND} runtime update claude --scope user\` and restart Claude Code.`,
            }
          : {}),
      });
      if (inspection.staleMarketplacePath) {
        diagnostics.push({
          code: 'runtime-claude-marketplace-path',
          status: 'fail',
          message: `The local OpenPlanr Claude marketplace points to another install: ${inspection.staleMarketplacePath}, not ${bundledHostRoot('claude')}`,
          fix: `Run \`${CLI_COMMAND} setup --runtime claude --scope user\` to point it at this install.`,
        });
      }
      if (inspection.legacyPluginIds.length > 0) {
        diagnostics.push({
          code: 'runtime-claude-legacy-plugin',
          status: 'warn',
          message: `Legacy Claude plugin installation detected: ${inspection.legacyPluginIds.join(', ')}`,
          fix: 'Verify `planr@openplanr-local`, then remove the legacy plugin from Claude Code.',
        });
      }
      if (inspection.duplicatePluginIds.length > 0) {
        diagnostics.push({
          code: 'runtime-claude-duplicate-plugin',
          status: 'warn',
          ...duplicateClaudePluginDiagnostic(inspection),
        });
      }
    }
  }
  const expectsProjectLock =
    installed?.ownedFiles.some((file) => file.scope === 'project') ?? false;
  const lock = path.join(projectDir, PLANNING_FOLDER, 'runtime-lock.json');
  if (!existsSync(lock)) {
    // User-scope setup is recorded under the directory it ran in but serves every project.
    const managed =
      Boolean(installed) ||
      Object.values(state.projects).some((project) =>
        project.runtimes.some((runtime) => projectUsesUserRuntime(project, runtime)),
      );
    const lockStatus = expectsProjectLock ? 'warn' : managed ? 'pass' : 'warn';
    diagnostics.push({
      code: 'runtime-lock',
      status: lockStatus,
      message: expectsProjectLock
        ? 'Project runtime lock missing'
        : managed
          ? 'User-scope setup does not require a project runtime lock'
          : 'No managed runtime setup found for this directory',
      ...(expectsProjectLock
        ? { fix: `Run \`${CLI_COMMAND} setup --scope project\`.` }
        : !managed
          ? { fix: `Run \`${CLI_COMMAND} setup\`.` }
          : {}),
    });
  } else {
    try {
      const value = JSON.parse(readFileSync(lock, 'utf8')) as {
        components?: { cli?: string; pipeline?: string; skills?: string };
        protocolVersion?: string;
        manifestDigest?: string;
        adapters?: RuntimeLockAdapter[];
        skillModes?: Partial<Record<RuntimeId, SkillInstallMode>>;
      };
      const errors = validateRuntimeLockContract(value);
      if (errors.length) {
        throw new RuntimeManagerError(
          'E_RUNTIME_LOCK_INVALID',
          'Project runtime lock does not match the supported contract.',
        );
      }
      lockedAdapters = value.adapters;
      const cliVersion = readOpenPlanrVersion();
      const cliDrift = value.components?.cli !== cliVersion;
      const componentDrift =
        cliDrift ||
        (pipeline && value.components?.pipeline !== pipeline.version) ||
        value.components?.skills !== readRegistry().pluginVersion;
      const expectedDigest = runtimeLockManifestDigest({
        protocolVersion: value.protocolVersion,
        pipelineVersion: value.components?.pipeline,
        adapters: value.adapters,
        skillModes: value.skillModes,
      });
      const digestDrift = value.manifestDigest !== expectedDigest;
      const registry = listRuntimeAdapters();
      const adapterDrift = (value.adapters ?? []).some((locked) => {
        const current = registry.find((adapter) => adapter.id === locked.runtime);
        return (
          !current ||
          current.version !== locked.version ||
          current.capabilityLevel !== locked.capabilityLevel
        );
      });
      // An OpenPlanr upgrade advances the CLI version the lock recorded.
      // When the CLI component trails the installed build and nothing that
      // governs runtime dispatch (runtime adapters, manifest digest)
      // diverged, the lock is simply behind an expected upgrade — surface it as
      // an informational `warn`, not a `fail` implying the board is broken. A
      // digest/adapter drift, or a component drift that does not include the CLI
      // (for example a pinned obsolete skill bundle), remains a genuine `fail`.
      // The warn/fail derivation lives in the single `classifyComponentDrift`
      // helper so `openplanr upgrade status` reuses this exact distinction rather
      // than re-deriving it; a digest/adapter drift is doctor's
      // flavour of an incompatible tuple.
      const { drift, genuineDrift, upgradeOnlyDrift, status } = classifyComponentDrift({
        cliDrift,
        componentDrift: Boolean(componentDrift),
        incompatibleDrift: digestDrift || adapterDrift,
      });
      diagnostics.push({
        code: drift ? 'lock-drift' : 'runtime-lock',
        status,
        message: genuineDrift
          ? `Runtime lock drift detected (components: ${componentDrift}, digest: ${digestDrift}, adapters: ${adapterDrift})`
          : upgradeOnlyDrift
            ? `Runtime lock component versions trail an OpenPlanr upgrade (components: ${componentDrift}); this is expected after upgrading and does not affect runtime execution`
            : drift
              ? `Runtime lock drift detected (components: ${componentDrift}, digest: ${digestDrift}, adapters: ${adapterDrift})`
              : 'Project runtime lock matches installed component versions',
        ...(drift
          ? {
              fix: upgradeOnlyDrift
                ? `Run \`${CLI_COMMAND} runtime update all --scope project\` to refresh the lock to the upgraded component versions.`
                : `Run \`${CLI_COMMAND} runtime update all --scope project\`.`,
            }
          : {}),
      });
    } catch {
      diagnostics.push({
        code: 'runtime-lock-invalid',
        status: 'fail',
        message: 'Project runtime lock is not valid JSON or does not match the supported contract',
        fix: `Run \`${CLI_COMMAND} setup --scope project\` after reviewing the existing lock.`,
      });
    }
  }

  if (installed) {
    if (lockedAdapters) {
      const lockedState = lockedAdapters
        .map((adapter) => `${adapter.runtime}:${adapter.installScope}`)
        .sort();
      const installedState = installed.runtimes
        .map(
          (runtime) =>
            `${runtime}:${installed.runtimeScopes?.[runtime] ?? inferRuntimeScope(installed.ownedFiles, runtime)}`,
        )
        .sort();
      const stateDrift = JSON.stringify(lockedState) !== JSON.stringify(installedState);
      diagnostics.push({
        code: stateDrift ? 'lock-state-drift' : 'lock-state',
        status: stateDrift ? 'fail' : 'pass',
        message: stateDrift
          ? 'Runtime lock adapters do not match the managed installation state'
          : 'Runtime lock adapters match the managed installation state',
        ...(stateDrift
          ? { fix: `Run \`${CLI_COMMAND} setup --dry-run\`, then approve the repair.` }
          : {}),
      });
    }
  } else if (lockedAdapters?.length) {
    diagnostics.push({
      code: 'runtime-state-missing',
      status: 'warn',
      message: 'The project has a runtime lock but this machine has no managed adapter state',
      fix: `Run \`${CLI_COMMAND} setup\` to install the locked runtime adapters on this machine.`,
    });
  }

  const globallyOwned = Object.values(state.userBundles ?? {}).flatMap(
    (bundle) => bundle?.ownedFiles ?? [],
  );
  const managedFiles = [
    ...(installed?.ownedFiles ?? []),
    ...globallyOwned.filter(
      (file, index, files) =>
        files.findIndex((candidate) => candidate.target === file.target) === index,
    ),
  ];
  const managedFileDiagnostic = diagnoseManagedRuntimeFiles(managedFiles, ownershipHash);
  if (managedFileDiagnostic) diagnostics.push(managedFileDiagnostic);
  const commandDiagnostic = diagnoseRetiredCommandSkills(
    [...managedFiles, ...pluginSkillDocuments],
    options.commandRoots ?? [],
    managedBlockBytes,
  );
  if (commandDiagnostic) diagnostics.push(commandDiagnostic);
  const verifiedPackages = new Map<string, string>();
  const closureFailures: string[] = [];
  for (const file of managedFiles) {
    try {
      if (path.basename(file.target) === 'openplanr.install.json')
        inspectRuntimeLocator(path.dirname(file.target), verifiedPackages);
      else if (file.runtime === 'cursor' && file.target.endsWith('.mdc'))
        inspectThinRule(file.target, verifiedPackages);
    } catch (cause) {
      closureFailures.push(
        `${file.target}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
  if (verifiedPackages.size || closureFailures.length)
    diagnostics.push({
      code: 'runtime-package-custody',
      status: closureFailures.length ? 'fail' : 'pass',
      message: closureFailures.length
        ? `Pinned runtime package verification failed: ${closureFailures.join('; ')}`
        : 'Pinned runtime packages match their complete content inventories',
      ...(closureFailures.length
        ? {
            fix: `Run \`${CLI_COMMAND} doctor --fix\` to preview the repair; changed package files are backed up before anything is replaced.`,
          }
        : {}),
    });

  let codexDiscovery: CodexSkillDiscovery | undefined;
  const codexBundle = state.userBundles?.codex;
  if (
    options.codexCommandRunner ||
    detectedRuntimes.some((runtime) => runtime.runtime === 'codex' && runtime.installed)
  ) {
    const configuredMode = codexBundle?.installMode ?? installed?.skillModes?.codex ?? 'direct';
    const inspection = inspectCodexPluginIntegration(
      bundledHostRoot('openai'),
      configuredMode,
      configuredMode,
      options.codexCommandRunner,
    );
    codexDiscovery = inspectCodexSkillDiscovery({
      hostPackageRoot: bundledHostRoot('openai'),
      projectDir,
      mode: configuredMode,
      packageVersion: readOpenPlanrVersion(),
      ownershipStatePath: statePath(),
      activePlugin: inspection.installed
        ? { id: inspection.pluginId, version: inspection.installedVersion }
        : undefined,
    });
    diagnostics.push({
      code: 'runtime-codex-profile',
      status: 'pass',
      message: `Effective Codex profile: ${codexDiscovery.effectiveHome}; ownership: ${statePath()}`,
    });
    const stale = codexDiscovery.skills.filter((skill) => skill.resolution === 'stale');
    const ambiguous = codexDiscovery.skills.filter((skill) => skill.resolution === 'ambiguous');
    const missing = codexDiscovery.skills.filter((skill) => skill.resolution === 'missing');
    const unreadable = codexDiscovery.skills.filter((skill) => skill.resolution === 'unreadable');
    const oldCaches = codexDiscovery.skills.filter((skill) =>
      skill.copies.some(
        (copy) => copy.kind === 'plugin-cache' && !copy.current && copy.enabled !== true,
      ),
    );
    if (
      stale.length ||
      ambiguous.length ||
      missing.length ||
      unreadable.length ||
      codexDiscovery.issues.length
    ) {
      diagnostics.push({
        code: 'runtime-codex-skill-resolution',
        status: 'warn',
        message: `${stale.length} stale skill(s), ${missing.length} missing skill(s), ${unreadable.length} unreadable skill(s), ${ambiguous.length} multiple discovery path(s), ${oldCaches.length} skill(s) with inactive cached copies. CLI package ${codexDiscovery.packageVersion}; per-skill and Protocol versions, paths and closure hashes are in doctor --json. An already-open session may retain earlier skills.`,
        fix: `Run \`${CLI_COMMAND} setup --runtime codex --dry-run\` in this profile, review the installer repair, then restart Codex. Do not delete plugin caches by hand.`,
      });
    }
    if (oldCaches.length > 0) {
      diagnostics.push({
        code: 'runtime-codex-cache-history',
        status: 'pass',
        message: `${oldCaches.length} skill(s) have inactive cached copies. These do not imply enabled duplicates; restart Codex if an open session still shows earlier skills.`,
      });
    }
    const directSkillFiles =
      codexBundle?.ownedFiles.filter((file) => pathIsWithin(file.target, codexSkillsRoot()))
        .length ?? 0;
    if (inspection.error) {
      diagnostics.push({
        code: 'runtime-codex-plugin',
        status: 'warn',
        message: `Codex plugin state could not be inspected: ${inspection.error}`,
        fix: `Run \`${CLI_COMMAND} setup --runtime codex --dry-run\` for an exact repair preview.`,
      });
    } else {
      diagnostics.push({
        code: 'runtime-codex-install-mode',
        status: inspection.ready ? 'pass' : 'warn',
        message: inspection.ready
          ? `Codex ${configuredMode} discovery is current`
          : inspection.operations.length > 0
            ? `Codex ${configuredMode} discovery needs repair: ${inspection.operations.map((operation) => operation.description).join('; ')}`
            : `Codex ${configuredMode} discovery has conflicting enabled registrations: ${inspection.duplicates.join(', ')}`,
        ...(inspection.ready
          ? {}
          : {
              fix: `Run \`${CLI_COMMAND} doctor --fix\` to preview repairs while preserving your saved discovery choice.`,
            }),
      });
      if ((directSkillFiles > 0 && inspection.installed) || inspection.duplicates.length > 0) {
        diagnostics.push({
          code: 'runtime-codex-duplicate-discovery',
          status: 'warn',
          message: `Codex has duplicate OpenPlanr discovery ownership${inspection.duplicates.length ? `: ${inspection.duplicates.join(', ')}` : ' across direct skills and the unified plugin'}`,
          fix: 'Choose direct or unified-plugin mode, preview setup, and use --replace-managed only for manifest-owned content.',
        });
      }
    }
  }
  const accidentalHomeFiles = await previewHomeProjectCleanup();
  if (accidentalHomeFiles.length > 0) {
    diagnostics.push({
      code: 'home-project-install',
      status: 'warn',
      message: `${accidentalHomeFiles.length} project-scoped managed file(s) were installed in the home directory`,
      fix: `Run \`${CLI_COMMAND} doctor --fix\` to preview and remove only recorded OpenPlanr-owned project content.`,
    });
  }

  const provenanceDiagnostic = diagnoseRuntimeProvenance(projectDir);
  if (provenanceDiagnostic) diagnostics.push(provenanceDiagnostic);

  if (pipeline) {
    // The child gets the resolved home only, so it does not repeat the OPENPLANR_HOME warning.
    const { OPENPLANR_HOME: _deprecatedHome, ...inheritedEnvironment } = process.env;
    const result = spawnSync(
      process.execPath,
      [
        path.join(pipeline.root, 'scripts', 'doctor.mjs'),
        '--json',
        ...(options.pipelineRepair === 'preview' ? ['--repair-preview'] : []),
        ...(options.pipelineRepair === 'apply' ? ['--fix'] : []),
      ],
      {
        cwd: projectDir,
        encoding: 'utf8',
        windowsHide: true,
        env: { ...inheritedEnvironment, PLANR_HOME: planrHome() },
      },
    );
    try {
      const report = JSON.parse(result.stdout) as {
        checks?: Array<{
          id: string;
          status: 'ok' | 'warn' | 'fail';
          message: string;
          fix?: string;
        }>;
        repairs?: Array<{
          id: string;
          operation: 'remove';
          target: string;
          applied: boolean;
        }>;
      };
      repairs.push(...(report.repairs ?? []));
      for (const check of report.checks ?? []) {
        if (check.status === 'ok') continue;
        diagnostics.push({
          code: `pipeline-${check.id}`,
          status: check.status,
          message: check.message,
          ...(check.fix ? { fix: check.fix } : {}),
        });
      }
    } catch {
      diagnostics.push({
        code: 'pipeline-doctor-unavailable',
        status: 'warn',
        message: 'The pipeline doctor did not return valid JSON',
        fix: `Run \`${CLI_COMMAND} doctor\` for direct diagnostics.`,
      });
    }
  }
  const fail = diagnostics.some((item) => item.status === 'fail');
  return { ok: !fail, diagnostics, repairs, ...(codexDiscovery ? { codexDiscovery } : {}) };
}
