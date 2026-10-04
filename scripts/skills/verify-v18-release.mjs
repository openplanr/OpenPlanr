#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readDeterministicZip } from '../../packages/skill-runtime/src/packaging/index.mjs';
import { assertDirectoryEntries, readDirectoryEntries } from './plugin-artifact-validation.mjs';
import { verifyStandaloneSkillEntries } from './standalone-resources.mjs';
import { verifySuiteResources } from './suite-verification.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const releaseRoot = resolve(root, 'release');
const index = JSON.parse(readFileSync(join(releaseRoot, 'release-index.json'), 'utf8'));
const registry = JSON.parse(readFileSync(join(root, 'skills/registry.json'), 'utf8'));
const expectedSkillCount = registry.skills.length;
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const hostProducts = new Map([
  ['openplanr-openai', { directory: 'openai', resourceHost: 'codex' }],
  ['openplanr-claude', { directory: 'claude', resourceHost: 'claude-code' }],
  ['openplanr-cursor', { directory: 'cursor', resourceHost: 'cursor' }],
]);
const expectedProducts = new Set([
  ...registry.skills.map(({ skillId }) => skillId),
  ...hostProducts.keys(),
]);
const actualProducts = new Set(index.products.map(({ productId }) => productId));
if (
  actualProducts.size !== index.products.length ||
  actualProducts.size !== expectedProducts.size ||
  [...actualProducts].some((id) => !expectedProducts.has(id)) ||
  index.productCount !== expectedProducts.size
)
  throw new Error(
    'Release index must contain exactly the canonical skills and complete host suites.',
  );
if (
  index.canonicalSkillCount !== expectedSkillCount ||
  index.compatibilityAliasCount !== 0 ||
  index.claudeAgentCount !== 9
) {
  throw new Error(
    `Release index does not describe the ${expectedSkillCount}-skill, nine-agent host-native catalog.`,
  );
}
for (const product of index.products) {
  const archive = readFileSync(join(releaseRoot, product.archive));
  if (digest(archive) !== product.archiveDigest)
    throw new Error(`${product.productId} archive digest drifted.`);
  const extracted = readDeterministicZip(archive);
  if (extracted.some(({ path }) => !path.startsWith(`${product.productId}/`)))
    throw new Error(`${product.productId} archive uses an unexpected product root.`);
  const directory = join(releaseRoot, product.directory);
  const installedFiles = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`${product.productId} contains a symlink.`);
      if (entry.isDirectory()) visit(absolute);
      else installedFiles.push(absolute);
    }
  };
  visit(directory);
  const archiveByPath = new Map(
    extracted.map((entry) => [entry.path.split('/').slice(1).join('/'), entry]),
  );
  if (product.productId === 'openplanr-claude') {
    assertDirectoryEntries([...archiveByPath].map(([path, entry]) => ({ ...entry, path })));
    assertDirectoryEntries(readDirectoryEntries(directory));
  }
  const registryRow = registry.skills.find(({ skillId }) => skillId === product.productId);
  if (registryRow) {
    verifyStandaloneSkillEntries({
      repoRoot: root,
      registryRow,
      entries: [...archiveByPath].map(([path, entry]) => ({ ...entry, path })),
    });
  } else {
    const host = hostProducts.get(product.productId);
    const contentPath = '.openplanr-content.json';
    const canonicalContent = readFileSync(
      join(root, 'dist/plugins', host.directory, 'openplanr', contentPath),
    );
    if (!archiveByPath.get(contentPath)?.bytes.equals(canonicalContent))
      throw new Error(`${product.productId} does not bind the current complete suite inventory.`);
    const content = JSON.parse(canonicalContent);
    if (archiveByPath.size !== content.files.length + 1)
      throw new Error(`${product.productId} suite archive has missing or extra files.`);
    for (const { path, digest: expectedDigest } of content.files) {
      const entry = archiveByPath.get(path);
      if (!entry || digest(entry.bytes) !== expectedDigest)
        throw new Error(`${product.productId}/${path} differs from the declared suite closure.`);
    }
    for (const row of registry.skills)
      verifySuiteResources({
        repoRoot: root,
        registryRow: row,
        host: host.resourceHost,
        pluginRoot: directory,
        skillRoot:
          host.directory === 'cursor'
            ? `rules/${row.skillId}`
            : `skills/${row.skillId.slice('planr-'.length)}`,
      });
  }
  for (const absolute of installedFiles) {
    const path = relative(directory, absolute).split(sep).join('/');
    const archived = archiveByPath.get(path);
    if (!archived || digest(archived.bytes) !== digest(readFileSync(absolute)))
      throw new Error(`${product.productId}/${path} differs from its archive.`);
    if (((lstatSync(absolute).mode & 0o111) !== 0) !== ((archived.mode & 0o111) !== 0))
      throw new Error(`${product.productId}/${path} lost its executable mode.`);
  }
  if (installedFiles.length !== extracted.length)
    throw new Error(`${product.productId} archive inventory differs.`);
}
process.stdout.write(
  `Release content PASS: ${index.productCount} products, ${expectedSkillCount} skills, 9 Claude agents.\n`,
);
