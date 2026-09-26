#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readDeterministicZip } from '../../packages/skill-runtime/src/packaging/index.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const releaseRoot = resolve(root, 'release');
const index = JSON.parse(readFileSync(join(releaseRoot, 'release-index.json'), 'utf8'));
const registry = JSON.parse(readFileSync(join(root, 'skills/registry.json'), 'utf8'));
const expectedSkillCount = registry.skills.length;
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
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
