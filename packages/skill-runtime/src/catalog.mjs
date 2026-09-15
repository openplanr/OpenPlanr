import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { validateProtocolArtifact } from '@openplanr/protocol/contracts';

import { SkillRuntimeError } from './errors.mjs';

export { SkillRuntimeError } from './errors.mjs';

const generatedSkillMembership = JSON.parse(readFileSync(
  new URL('../contributions/canonical-skills.json', import.meta.url),
  'utf8',
));

// Compatibility export. Membership is generated from skills/registry.json;
// consumers retain the historical symbol without a second authored table.
export const EXPECTED_SKILL_IDS = Object.freeze([...generatedSkillMembership.skillIds]);

// Composed-v1 graph resolution is the versioned successor to the markdown-v1
// contribution graph read below; both are surfaced from the catalog so a single
// module owns skill-source reading.
export { resolveModuleGraph } from './compiler/graph.mjs';
export { assertAuthorityNarrows } from './compiler/authority.mjs';
export { compileComposedV1, compileMarkdownV1 } from './compiler/compile.mjs';

export const EXPECTED_ROLE_IDS = Object.freeze([
  'planr-backend',
  'planr-database',
  'planr-designer',
  'planr-devops',
  'planr-documentation',
  'planr-entity-scaffold',
  'planr-frontend',
  'planr-qa',
  'planr-specification',
]);

function fail(code, message, details) {
  throw new SkillRuntimeError(code, message, details);
}

export function assertSafeRelativePath(path, label = 'path') {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path)) {
    fail('E_SKILL_PATH_INVALID', `${label} must be a non-empty repository-relative path.`, { path });
  }
  const parts = path.split(/[\\/]/u);
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    fail('E_SKILL_PATH_INVALID', `${label} may not contain empty, current, or parent segments.`, { path });
  }
  return path;
}

export function resolveRegularFile(repoRoot, path, label = 'source') {
  assertSafeRelativePath(path, label);
  const absolute = resolve(repoRoot, path);
  const boundary = `${resolve(repoRoot)}${sep}`;
  if (!absolute.startsWith(boundary)) {
    fail('E_SKILL_PATH_ESCAPE', `${label} escapes the repository root.`, { path });
  }
  if (!existsSync(absolute)) fail('E_SKILL_SOURCE_MISSING', `${label} does not exist.`, { path });
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail('E_SKILL_SOURCE_TYPE_INVALID', `${label} must be a regular file.`, { path });
  }
  return absolute;
}

export function validateContributionGraph(manifests, {
  expectedSkillIds,
  repoRoot,
} = {}) {
  if (!Array.isArray(manifests) || manifests.length === 0) {
    fail('E_SKILL_CONTRIBUTIONS_INVALID', 'At least one contribution manifest is required.');
  }
  const contributionIds = new Set();
  const skills = [];
  for (const manifest of manifests) {
    if (manifest?.kind !== 'openplanr-skill-contribution' || manifest.schemaVersion !== '1.0.0') {
      fail('E_SKILL_CONTRIBUTION_KIND_INVALID', 'Contribution manifest kind/version is invalid.');
    }
    if (!/^[a-z][a-z0-9-]*$/u.test(manifest.id) || contributionIds.has(manifest.id)) {
      fail('E_SKILL_CONTRIBUTION_ID_INVALID', `Contribution id ${String(manifest.id)} is invalid or duplicated.`);
    }
    contributionIds.add(manifest.id);
    if (!Array.isArray(manifest.skills) || manifest.skills.length === 0) {
      fail('E_SKILL_CONTRIBUTION_EMPTY', `Contribution ${manifest.id} has no skills.`);
    }
    for (const row of manifest.skills) {
      if (!/^planr-[a-z0-9-]+$/u.test(row.id)) {
        fail('E_SKILL_ID_INVALID', `Skill id ${String(row.id)} is not canonical.`);
      }
      assertSafeRelativePath(row.source, `source for ${row.id}`);
      if (repoRoot) resolveRegularFile(repoRoot, row.source, `source for ${row.id}`);
      if (!Array.isArray(row.commands) || row.commands.some((command) => !/^[a-z][a-z0-9-]*$/u.test(command))) {
        fail('E_SKILL_COMMANDS_INVALID', `Skill ${row.id} has invalid command aliases.`);
      }
      skills.push(Object.freeze({ ...row, contribution: manifest.id }));
    }
  }
  const ids = skills.map(({ id }) => id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    fail('E_SKILL_ID_DUPLICATE', 'A canonical skill is contributed more than once.', { duplicates: [...new Set(duplicates)] });
  }
  if (expectedSkillIds) {
    const actual = [...ids].sort();
    const expected = [...expectedSkillIds].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail('E_SKILL_MEMBERSHIP_INVALID', 'Canonical skill membership differs from the source registry.', { expected, actual });
    }
  }
  return Object.freeze(skills.sort((left, right) => left.id.localeCompare(right.id)));
}

export function validateRoleContributions(manifest, {
  expectedRoleIds = EXPECTED_ROLE_IDS,
  repoRoot,
} = {}) {
  if (manifest?.kind !== 'openplanr-role-contributions' || manifest.schemaVersion !== '1.0.0' || !Array.isArray(manifest.roles)) {
    fail('E_ROLE_CONTRIBUTIONS_INVALID', 'Role contribution manifest kind/version is invalid.');
  }
  const ids = new Set();
  for (const role of manifest.roles) {
    if (!/^planr-[a-z0-9-]+$/u.test(role.id) || ids.has(role.id)) fail('E_ROLE_ID_INVALID', `Role id ${String(role.id)} is invalid or duplicated.`);
    assertSafeRelativePath(role.source, `source for ${role.id}`);
    if (repoRoot) resolveRegularFile(repoRoot, role.source, `source for ${role.id}`);
    ids.add(role.id);
  }
  const actual = [...ids].sort();
  const expected = [...expectedRoleIds].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('E_ROLE_MEMBERSHIP_INVALID', 'Canonical role membership differs from the locked catalog.', { expected, actual });
  }
  return Object.freeze([...manifest.roles].sort((left, right) => left.id.localeCompare(right.id)));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readSkillSourceRegistry({ repoRoot }) {
  const root = resolve(repoRoot);
  const registry = readJson(resolve(root, 'skills/registry.json'));
  if (
    registry?.kind !== 'openplanr-skill-source-registry'
    || registry.schemaVersion !== '1.0.0'
    || !['composed-v1', 'package-v1'].includes(registry.sourceFormat)
    || !Array.isArray(registry.skills)
    || registry.skills.length === 0
  ) {
    fail('E_SKILL_REGISTRY_INVALID', 'skills/registry.json is not a supported skill source registry.');
  }
  const ids = registry.skills.map(({ skillId }) => skillId);
  if (ids.some((id) => !/^planr-[a-z0-9-]+$/u.test(id)) || new Set(ids).size !== ids.length) {
    fail('E_SKILL_REGISTRY_MEMBERSHIP_INVALID', 'skills/registry.json contains invalid or duplicate skill IDs.', { ids });
  }
  if (JSON.stringify(ids) !== JSON.stringify([...ids].sort())) {
    fail('E_SKILL_REGISTRY_ORDER_INVALID', 'skills/registry.json skills must be sorted by canonical ID.');
  }
  for (const row of registry.skills) {
    const expectedSource = registry.sourceFormat === 'package-v1'
      ? `skills/${row.skillId}/openplanr.skill.json`
      : `skills/${row.skillId}/skill.json`;
    if (row.source !== expectedSource) {
      fail('E_SKILL_REGISTRY_SOURCE_INVALID', `${row.skillId} does not point at its canonical source manifest.`, { source: row.source, expectedSource });
    }
    resolveRegularFile(root, row.source, `source for ${row.skillId}`);
    resolveRegularFile(root, row.baseline, `baseline for ${row.skillId}`);
  }
  return Object.freeze({
    ...registry,
    aliases: Object.freeze((registry.aliases ?? []).map((alias) => Object.freeze({ ...alias }))),
    skills: Object.freeze(registry.skills.map((row) => Object.freeze({ ...row }))),
  });
}

export function readStandardSkillPackage({ repoRoot, registryRow }) {
  const root = resolve(repoRoot);
  const manifestPath = resolveRegularFile(root, registryRow.source, `manifest for ${registryRow.skillId}`);
  const manifest = readJson(manifestPath);
  const errors = validateProtocolArtifact('skill-package', manifest, { protocolVersion: '1.8.0' });
  if (errors.length > 0) {
    fail('E_SKILL_PACKAGE_SCHEMA_INVALID', `${registryRow.skillId} does not satisfy Protocol 1.8.`, { errors });
  }
  if (manifest.skillId !== registryRow.skillId || manifest.skillVersion !== registryRow.skillVersion) {
    fail('E_SKILL_PACKAGE_IDENTITY_DRIFT', `${registryRow.skillId} manifest identity differs from the registry.`, {
      registry: { skillId: registryRow.skillId, skillVersion: registryRow.skillVersion },
      manifest: { skillId: manifest.skillId, skillVersion: manifest.skillVersion },
    });
  }
  const skillDir = resolve(root, 'skills', registryRow.skillId);
  const entrypoint = resolveRegularFile(skillDir, manifest.entrypoint, `entrypoint for ${registryRow.skillId}`);
  const markdown = readFileSync(entrypoint, 'utf8');
  if (!new RegExp(`^name:\\s*["']?${registryRow.skillId}["']?\\s*$`, 'mu').test(markdown)) {
    fail('E_SKILL_PACKAGE_FRONTMATTER_INVALID', `${registryRow.skillId} SKILL.md has a different or missing name.`);
  }
  const seen = new Set();
  const resources = manifest.resources.map((resource) => {
    if (seen.has(resource.path)) fail('E_SKILL_PACKAGE_RESOURCE_DUPLICATE', `${registryRow.skillId} declares ${resource.path} more than once.`);
    seen.add(resource.path);
    const absolute = resolveRegularFile(skillDir, resource.path, `resource for ${registryRow.skillId}`);
    const executable = (lstatSync(absolute).mode & 0o111) !== 0;
    if (resource.executable !== executable) {
      fail('E_SKILL_PACKAGE_EXECUTABLE_DRIFT', `${registryRow.skillId}/${resource.path} executable mode differs from its declaration.`, {
        declared: resource.executable,
        actual: executable,
      });
    }
    return Object.freeze({ ...resource, absolute });
  });
  return Object.freeze({
    row: registryRow,
    manifest: Object.freeze(manifest),
    skillDir,
    markdown,
    resources: Object.freeze(resources),
  });
}

export function readContributionGraph({ repoRoot }) {
  const root = resolve(repoRoot);
  const directory = resolve(root, 'packages/skill-runtime/contributions');
  const registry = readSkillSourceRegistry({ repoRoot: root });
  const contributions = new Map();
  for (const row of registry.skills) {
    const skills = contributions.get(row.contribution) ?? [];
    skills.push({
      id: row.skillId,
      source: row.source,
      authorityClass: row.authorityClass,
      commands: [...new Set(row.cliRequirements.flatMap(({ argv }) => argv.slice(0, 1)))],
    });
    contributions.set(row.contribution, skills);
  }
  const manifests = [...contributions.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, skills]) => ({
    kind: 'openplanr-skill-contribution',
    schemaVersion: '1.0.0',
    id,
    skills,
  }));
  const skills = validateContributionGraph(manifests, { expectedSkillIds: registry.skills.map(({ skillId }) => skillId), repoRoot: root });
  const aliases = registry.sourceFormat === 'package-v1'
    ? { kind: 'openplanr-skill-aliases', schemaVersion: '1.0.0', aliases: registry.aliases }
    : readJson(resolve(directory, 'aliases.json'));
  const frozenCommands = registry.sourceFormat === 'package-v1'
    ? { kind: 'openplanr-frozen-command-aliases', schemaVersion: '1.0.0', commands: [] }
    : readJson(resolve(directory, 'frozen-commands.json'));
  const rolesManifest = readJson(resolve(directory, 'roles.json'));
  const roles = validateRoleContributions(rolesManifest, { repoRoot: root });
  return Object.freeze({ registry, manifests: Object.freeze(manifests), skills, aliases, frozenCommands, roles });
}

export function listRegularFiles(root, { relativeTo = root } = {}) {
  if (!existsSync(root)) return [];
  const result = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) fail('E_GENERATED_SYMLINK_INVALID', 'Generated custody trees may not contain symlinks.', { path: relative(relativeTo, absolute) });
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result.push(relative(relativeTo, absolute).split(sep).join('/'));
      else fail('E_GENERATED_FILE_TYPE_INVALID', 'Generated custody trees may contain regular files only.', { path: relative(relativeTo, absolute) });
    }
  };
  visit(resolve(root));
  return result.sort();
}
