import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';
import { userHome } from '../../../lib/planr-home.mjs';
import type { SkillInstallMode } from './global-state.js';
import { inspectRuntimeLocator, inspectRuntimePackage } from './runtime-package.js';

function canonicalPath(directory: string): string {
  const resolved = path.resolve(directory);
  let existing = resolved;
  while (!existsSync(existing) && path.dirname(existing) !== existing)
    existing = path.dirname(existing);
  return path.join(realpathSync(existing), path.relative(existing, resolved));
}

/** Uses the native profile selected by the caller, without inspecting other accounts. */
export function effectiveCodexHome(): string {
  const defaultHome = path.resolve(userHome(), '.codex');
  const selected = process.env.CODEX_HOME?.trim();
  if (!selected || canonicalPath(selected) === canonicalPath(defaultHome)) return defaultHome;
  return canonicalPath(selected);
}

type SkillCopy = Readonly<{
  kind: 'bundled' | 'user' | 'project' | 'plugin-cache';
  entrypoint: string;
  skillId: string;
  skillVersion: string | null;
  protocolVersion: string | null;
  packageVersion: string | null;
  sourceHash: string | null;
  packageDigest?: string;
  current: boolean;
  enabled?: boolean;
  issue?: string;
}>;

export type CodexSkillDiscovery = Readonly<{
  effectiveHome: string;
  configurationPath: string;
  ownershipStatePath: string;
  mode: SkillInstallMode;
  packageVersion: string;
  sessionResolution: 'restart-required-to-confirm';
  skills: Array<{
    skillId: string;
    resolution: 'current' | 'stale' | 'ambiguous' | 'missing' | 'unreadable';
    entrypoint: string | null;
    copies: SkillCopy[];
  }>;
  issues: string[];
}>;

/** Hashes the complete installed closure, including missing or additional support files. */
function sourceHash(directory: string): string {
  const digest = createHash('sha256');
  const visit = (root: string): void => {
    for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name, 'en'),
    )) {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) {
        digest.update(path.relative(directory, target).split(path.sep).join('/'));
        digest.update('\0');
        digest.update(createHash('sha256').update(readFileSync(target)).digest());
      } else throw new Error('Skill closure contains a symbolic link or unsupported entry.');
    }
  };
  visit(directory);
  return `sha256:${digest.digest('hex')}`;
}

function readCopy(
  directory: string,
  kind: SkillCopy['kind'],
  skillId: string,
  packageVersion: string | null,
  enabled?: boolean,
  verifiedPackages = new Map<string, string>(),
): Omit<SkillCopy, 'current'> | null {
  const entrypoint = path.join(directory, 'SKILL.md');
  if (!existsSync(entrypoint)) return null;
  try {
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
      throw new Error('Skill root is not a regular directory.');
    const locator = inspectRuntimeLocator(directory, verifiedPackages);
    let packageDigest = locator?.packageDigest;
    const suiteRoot = path.dirname(path.dirname(directory));
    const inventory = path.join(suiteRoot, '.openplanr-content.json');
    if (!locator && existsSync(inventory)) {
      packageDigest = `sha256:${createHash('sha256').update(readFileSync(inventory)).digest('hex')}`;
      if (verifiedPackages.get(suiteRoot) !== packageDigest) {
        inspectRuntimePackage(
          suiteRoot,
          path.join(suiteRoot, '.inspection-only'),
          'openai',
          packageVersion ?? 'unknown',
        );
        verifiedPackages.set(suiteRoot, packageDigest);
      }
    }
    const completeHash = sourceHash(
      locator ? path.dirname(path.join(locator.sourceRoot, locator.entryPath)) : directory,
    );
    const metadataPath = path.join(directory, 'openplanr.skill.json');
    const metadata = existsSync(metadataPath)
      ? (JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>)
      : {};
    return {
      kind,
      entrypoint,
      skillId,
      skillVersion: typeof metadata.skillVersion === 'string' ? metadata.skillVersion : null,
      protocolVersion:
        typeof metadata.protocolVersion === 'string' ? metadata.protocolVersion : null,
      packageVersion: locator?.packageVersion ?? packageVersion,
      sourceHash: completeHash,
      ...(packageDigest ? { packageDigest } : {}),
      ...(enabled === undefined ? {} : { enabled }),
    };
  } catch {
    return {
      kind,
      entrypoint,
      skillId,
      skillVersion: null,
      protocolVersion: null,
      packageVersion,
      sourceHash: null,
      ...(enabled === undefined ? {} : { enabled }),
      issue: 'Could not read the complete regular skill closure.',
    };
  }
}

function childDirectories(directory: string, issues: string[]): string[] {
  if (!existsSync(directory)) return [];
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch {
    issues.push(`Could not inspect skill directories in ${directory}.`);
    return [];
  }
}

type DiscoveryInput = {
  hostPackageRoot: string;
  projectDir: string;
  mode: SkillInstallMode;
  packageVersion: string;
  ownershipStatePath: string;
  activePlugin?: { id: string; version: string | null };
};
type DiscoveryRoot = {
  root: string;
  kind: SkillCopy['kind'];
  version: string | null;
  enabled?: boolean;
};

function pluginRegistrations(configurationPath: string, issues: string[]): Record<string, unknown> {
  if (!existsSync(configurationPath)) return {};
  try {
    const parsed = parse(readFileSync(configurationPath, 'utf8'));
    return parsed.plugins && typeof parsed.plugins === 'object' && !Array.isArray(parsed.plugins)
      ? (parsed.plugins as Record<string, unknown>)
      : {};
  } catch {
    issues.push(`Could not inspect plugin registrations in ${configurationPath}.`);
    return {};
  }
}

function pluginEnabled(registration: unknown): boolean | undefined {
  return registration &&
    typeof registration === 'object' &&
    'enabled' in registration &&
    typeof registration.enabled === 'boolean'
    ? registration.enabled
    : undefined;
}

function cachedSkillRoots(
  nativeHome: string,
  plugins: Record<string, unknown>,
  activePlugin: DiscoveryInput['activePlugin'],
  issues: string[],
): DiscoveryRoot[] {
  return ['planr', 'openplanr'].flatMap((plugin) => {
    const id = `${plugin}@openplanr-local`;
    const enabled = pluginEnabled(plugins[id]);
    return childDirectories(
      path.join(nativeHome, 'plugins', 'cache', 'openplanr-local', plugin),
      issues,
    ).map((directory) => ({
      root: path.join(directory, 'skills'),
      kind: 'plugin-cache',
      version: path.basename(directory),
      enabled:
        enabled === false
          ? false
          : activePlugin?.id === id
            ? activePlugin.version === path.basename(directory)
            : enabled,
    }));
  });
}

function classifyCopies(active: SkillCopy[]): CodexSkillDiscovery['skills'][number]['resolution'] {
  if (active.length === 0) return 'missing';
  if (active.length > 1) return 'ambiguous';
  if (active[0].sourceHash === null) return 'unreadable';
  return active[0].current ? 'current' : 'stale';
}

function inspectSkill(
  bundledDirectory: string,
  roots: DiscoveryRoot[],
  packageVersion: string,
  verifiedPackages: Map<string, string>,
): CodexSkillDiscovery['skills'][number] {
  const name = path.basename(bundledDirectory).replace(/^planr-/u, '');
  const skillId = `planr-${name}`;
  const bundled = readCopy(
    bundledDirectory,
    'bundled',
    skillId,
    packageVersion,
    undefined,
    verifiedPackages,
  );
  const candidates = [
    bundled,
    ...roots.flatMap(({ root, kind, version, enabled }) =>
      [name, `planr-${name}`].map((alias) =>
        readCopy(path.join(root, alias), kind, skillId, version, enabled, verifiedPackages),
      ),
    ),
  ];
  const copies = candidates
    .filter((copy): copy is Omit<SkillCopy, 'current'> => Boolean(copy))
    .filter(
      (copy, index, all) =>
        all.findIndex((other) => other.entrypoint === copy.entrypoint) === index,
    )
    .map((copy) => ({
      ...copy,
      current: Boolean(
        copy.sourceHash &&
          copy.sourceHash === bundled?.sourceHash &&
          (!copy.packageDigest || copy.packageDigest === bundled?.packageDigest),
      ),
    }));
  const active = copies.filter(
    (copy) => copy.kind !== 'bundled' && (copy.kind !== 'plugin-cache' || copy.enabled === true),
  );
  return {
    skillId,
    resolution: classifyCopies(active),
    entrypoint: active.length === 1 ? active[0].entrypoint : null,
    copies,
  };
}

/** Reports actual copies; it cannot claim which skill an already-open host session loaded. */
export function inspectCodexSkillDiscovery(input: DiscoveryInput): CodexSkillDiscovery {
  const verifiedPackages = new Map<string, string>();
  const effectiveHome = effectiveCodexHome();
  const configurationPath = path.join(effectiveHome, 'config.toml');
  const issues: string[] = [];
  const plugins = pluginRegistrations(configurationPath, issues);
  const roots: DiscoveryRoot[] = [
    { root: path.join(effectiveHome, 'skills'), kind: 'user', version: null },
    { root: path.join(userHome(), '.agents', 'skills'), kind: 'user', version: null },
    { root: path.join(input.projectDir, '.agents', 'skills'), kind: 'project', version: null },
    { root: path.join(input.projectDir, '.codex', 'skills'), kind: 'project', version: null },
    ...cachedSkillRoots(effectiveHome, plugins, input.activePlugin, issues),
  ];
  const bundledRoot = path.join(input.hostPackageRoot, 'openplanr', 'skills');
  const bundledDirectories = childDirectories(bundledRoot, issues);
  if (bundledDirectories.length === 0)
    issues.push(`The bundled Codex skills are unavailable at ${bundledRoot}.`);
  return {
    effectiveHome,
    configurationPath,
    ownershipStatePath: input.ownershipStatePath,
    mode: input.mode,
    packageVersion: input.packageVersion,
    sessionResolution: 'restart-required-to-confirm',
    skills: bundledDirectories.map((directory) =>
      inspectSkill(directory, roots, input.packageVersion, verifiedPackages),
    ),
    issues,
  };
}
