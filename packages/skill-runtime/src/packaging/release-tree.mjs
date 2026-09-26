import { createHash } from 'node:crypto';

import { parseMarkdownAsset } from '../compiler/index.mjs';
import { SkillRuntimeError } from '../errors.mjs';
import { linkSkillProjection } from '../linker/index.mjs';
import { createDeterministicZip } from './deterministic-zip.mjs';

const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function fail(code, message, details = {}) {
  throw new SkillRuntimeError(code, message, details);
}

function add(tree, path, bytes) {
  if (tree.has(path))
    fail('E_SKILL_RELEASE_PATH_DUPLICATE', `Duplicate release output ${path}.`, { path });
  tree.set(path, Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8'));
}

function inventory(entries) {
  return entries
    .map(({ path, bytes }) => ({ path, byteLength: bytes.length, digest: digest(bytes) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function packageManifest({
  packageId,
  packageVersion,
  classification,
  canonicalSkillId = null,
  host,
  entries,
}) {
  const files = inventory(entries);
  return Object.freeze({
    kind: 'openplanr-skill-release-unit',
    schemaVersion: '1.0.0',
    packageId,
    packageVersion,
    classification,
    canonicalSkillId,
    host,
    license: 'MIT',
    provenance: {
      repository: 'openplanr/OpenPlanr',
      generator: 'scripts/skills/package-v18-release.mjs',
    },
    maintainerDigest: digest(Buffer.from(stableJson(files), 'utf8')),
    files,
  });
}

function validateSkillUnit(skillId, entries) {
  const members = entries.map(({ path, bytes }) => ({ path, bytes: bytes.toString('utf8') }));
  const primary = members.find(({ path }) => path === 'SKILL.md');
  const metadata = members.find(({ path }) => path === 'agents/openai.yaml');
  if (!primary || !metadata) {
    fail(
      'E_SKILL_RELEASE_ENTRYPOINT_MISSING',
      `${skillId} requires SKILL.md and agents/openai.yaml.`,
      { skillId },
    );
  }
  parseMarkdownAsset(primary.bytes, { expectedName: skillId });
  if (!metadata.bytes.includes(`$${skillId}`)) {
    fail(
      'E_SKILL_RELEASE_NATIVE_INVOCATION',
      `${skillId} Codex metadata must invoke its native skill name.`,
      { skillId },
    );
  }
  linkSkillProjection({
    skillId,
    host: 'codex',
    primary,
    references: members.filter(({ path }) => path.startsWith('references/')),
    auxiliary: members.filter(({ path }) => path !== 'SKILL.md' && !path.startsWith('references/')),
  });
}

/**
 * Build every local release unit from one already-compiled plugin graph. The
 * caller owns filesystem reads; this function owns release paths, manifests,
 * link closure, archives, and registry-derived counts.
 */
export function buildSkillReleaseTree({
  workspaceVersion,
  sourceRegistry,
  contentManifest,
  readProductEntries,
  licenseBytes,
  hostProducts = [
    { id: 'openplanr-openai', host: 'openai', source: 'dist/plugins/openai/openplanr' },
    { id: 'openplanr-claude', host: 'claude-code', source: 'dist/plugins/claude/openplanr' },
    { id: 'openplanr-cursor', host: 'cursor', source: 'dist/plugins/cursor/openplanr' },
  ],
}) {
  if (
    !workspaceVersion ||
    !Array.isArray(sourceRegistry?.skills) ||
    !Array.isArray(sourceRegistry?.aliases)
  ) {
    fail(
      'E_SKILL_RELEASE_CATALOG_INVALID',
      'Release packaging requires a workspace version and canonical skill registry.',
    );
  }
  if (!Array.isArray(contentManifest?.skills) || typeof readProductEntries !== 'function') {
    fail(
      'E_SKILL_RELEASE_CONTENT_INVALID',
      'Release packaging requires compiled plugin content and a product reader.',
    );
  }

  const canonical = new Map(sourceRegistry.skills.map((skill) => [skill.skillId, skill]));
  const aliases = new Map(sourceRegistry.aliases.map((alias) => [alias.id, alias]));
  const tree = new Map();
  const products = [];
  const skillRoot = contentManifest.skillRoot.replace(/^\.\//u, '').replace(/\/$/u, '');

  for (const skill of contentManifest.skills) {
    const packageRoot = `${contentManifest.pluginRoot}/${skillRoot}/${skill.skillId}`;
    const version = canonical.get(skill.skillId)?.skillVersion ?? workspaceVersion;
    const alias = aliases.get(skill.skillId);
    const entries = readProductEntries(packageRoot);
    validateSkillUnit(skill.skillId, entries);
    entries.push({ path: 'LICENSE', bytes: licenseBytes });
    const manifest = packageManifest({
      packageId: skill.skillId,
      packageVersion: version,
      classification: skill.classification,
      canonicalSkillId: alias?.canonicalSkillId ?? skill.skillId,
      host: 'portable-agent-skill',
      entries,
    });
    entries.push({
      path: 'openplanr-package.json',
      bytes: Buffer.from(stableJson(manifest), 'utf8'),
    });
    for (const entry of entries) add(tree, `skills/${skill.skillId}/${entry.path}`, entry.bytes);
    const archivePath = `archives/${skill.skillId}-${version}.zip`;
    const archive = createDeterministicZip(
      entries.map((entry) => ({ path: `${skill.skillId}/${entry.path}`, bytes: entry.bytes })),
    );
    add(tree, archivePath, archive);
    products.push({
      productId: skill.skillId,
      kind: 'individual-skill',
      classification: skill.classification,
      version,
      directory: `skills/${skill.skillId}`,
      archive: archivePath,
      archiveDigest: digest(archive),
      files: entries.length,
    });
  }

  const suiteEntries = readProductEntries(contentManifest.pluginRoot);
  suiteEntries.push({ path: 'LICENSE', bytes: licenseBytes });
  const suiteManifest = packageManifest({
    packageId: 'openplanr',
    packageVersion: workspaceVersion,
    classification: 'unified-plugin',
    host: 'claude-code+codex',
    entries: suiteEntries,
  });
  suiteEntries.push({
    path: 'openplanr-package.json',
    bytes: Buffer.from(stableJson(suiteManifest), 'utf8'),
  });
  for (const entry of suiteEntries) add(tree, `plugins/openplanr/${entry.path}`, entry.bytes);
  const suiteArchivePath = `archives/openplanr-suite-${workspaceVersion}.zip`;
  const suiteArchive = createDeterministicZip(
    suiteEntries.map((entry) => ({ path: `openplanr/${entry.path}`, bytes: entry.bytes })),
  );
  add(tree, suiteArchivePath, suiteArchive);
  products.push({
    productId: 'openplanr',
    kind: 'unified-plugin',
    version: workspaceVersion,
    directory: 'plugins/openplanr',
    archive: suiteArchivePath,
    archiveDigest: digest(suiteArchive),
    files: suiteEntries.length,
  });

  for (const product of hostProducts) {
    const entries = readProductEntries(product.source);
    entries.push({ path: 'LICENSE', bytes: licenseBytes });
    const manifest = packageManifest({
      packageId: product.id,
      packageVersion: workspaceVersion,
      classification: 'host-projection',
      host: product.host,
      entries,
    });
    entries.push({
      path: 'openplanr-package.json',
      bytes: Buffer.from(stableJson(manifest), 'utf8'),
    });
    for (const entry of entries) add(tree, `hosts/${product.host}/${entry.path}`, entry.bytes);
    const archivePath = `archives/${product.id}-${workspaceVersion}.zip`;
    const archive = createDeterministicZip(
      entries.map((entry) => ({ path: `${product.id}/${entry.path}`, bytes: entry.bytes })),
    );
    add(tree, archivePath, archive);
    products.push({
      productId: product.id,
      kind: 'host-projection',
      host: product.host,
      version: workspaceVersion,
      directory: `hosts/${product.host}`,
      archive: archivePath,
      archiveDigest: digest(archive),
      files: entries.length,
    });
  }

  const releaseIndex = Object.freeze({
    kind: 'openplanr-skill-release-index',
    schemaVersion: '1.0.0',
    releaseVersion: workspaceVersion,
    canonicalSkillCount: canonical.size,
    compatibilityAliasCount: aliases.size,
    productCount: products.length,
    products,
    publication: { state: 'local-only', publicActionOwner: 'maintainer-release-approval' },
  });
  add(tree, 'release-index.json', stableJson(releaseIndex));
  add(
    tree,
    '.openplanr-release.json',
    stableJson({
      kind: 'openplanr-generated-release-root',
      schemaVersion: '1.0.0',
      releaseVersion: workspaceVersion,
      indexDigest: digest(Buffer.from(stableJson(releaseIndex), 'utf8')),
    }),
  );
  return Object.freeze({ tree, index: releaseIndex });
}
