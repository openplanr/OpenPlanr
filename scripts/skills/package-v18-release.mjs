#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDeterministicZip } from '../../packages/skill-runtime/src/packaging/index.mjs';
import { projectedSkillName } from './host-invocations.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const releaseRoot = resolve(root, 'release');
const mode = process.argv[2];
if (!['--write', '--check'].includes(mode) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/skills/package-v18-release.mjs <--write|--check>');
}

const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const workspaceVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const registry = JSON.parse(readFileSync(resolve(root, 'skills/registry.json'), 'utf8'));

function files(directory) {
  const result = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = join(current, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Release inputs may not contain symlinks: ${absolute}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  };
  visit(directory);
  return result;
}

function entries(directory) {
  return files(directory).map((absolute) => ({
    path: relative(directory, absolute).split(sep).join('/'),
    bytes: readFileSync(absolute),
    mode: (lstatSync(absolute).mode & 0o111) !== 0 ? 0o755 : 0o644,
  }));
}

const tree = new Map();
function add(path, bytes, fileMode = 0o644) {
  if (tree.has(path)) throw new Error(`Duplicate release path: ${path}`);
  tree.set(path, { bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), mode: fileMode });
}

function addProduct({ id, kind, host, source, destination }) {
  const sourceEntries = entries(resolve(root, source));
  for (const entry of sourceEntries) add(`${destination}/${entry.path}`, entry.bytes, entry.mode);
  const archive = createDeterministicZip(
    sourceEntries.map((entry) => ({
      ...entry,
      path: `${id}/${entry.path}`,
    })),
  );
  const archivePath = `archives/${id}-${workspaceVersion}.zip`;
  add(archivePath, archive);
  return {
    productId: id,
    kind,
    host,
    version: workspaceVersion,
    directory: destination,
    archive: archivePath,
    archiveDigest: digest(archive),
    files: sourceEntries.length,
  };
}

const products = [];
for (const row of registry.skills) {
  const source = `dist/plugins/openai/openplanr/skills/${projectedSkillName(row.skillId)}`;
  products.push(
    addProduct({
      id: row.skillId,
      kind: 'individual-skill',
      host: 'openai',
      source,
      destination: `skills/${row.skillId}`,
    }),
  );
}
for (const product of [
  {
    id: 'openplanr-openai',
    host: 'openai',
    source: 'dist/plugins/openai/openplanr',
    destination: 'plugins/openai/openplanr',
  },
  {
    id: 'openplanr-claude',
    host: 'claude-code',
    source: 'dist/plugins/claude/openplanr',
    destination: 'plugins/claude/openplanr',
  },
  {
    id: 'openplanr-cursor',
    host: 'cursor',
    source: 'dist/plugins/cursor/openplanr',
    destination: 'plugins/cursor/openplanr',
  },
])
  products.push(addProduct({ ...product, kind: 'host-plugin' }));

const index = {
  kind: 'openplanr-skill-release-index',
  schemaVersion: '2.0.0',
  protocolVersion: '1.8.0',
  releaseVersion: workspaceVersion,
  canonicalSkillCount: registry.skills.length,
  compatibilityAliasCount: 0,
  claudeAgentCount: 9,
  productCount: products.length,
  products,
  publication: { state: 'local-only', publicActionOwner: 'maintainer-release-approval' },
};
add('release-index.json', json(index));
add(
  '.openplanr-release.json',
  json({
    kind: 'openplanr-generated-release-root',
    schemaVersion: '2.0.0',
    releaseVersion: workspaceVersion,
    indexDigest: digest(json(index)),
  }),
);

function writeTree(directory) {
  for (const [path, entry] of tree) {
    const absolute = resolve(directory, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, entry.bytes, { mode: entry.mode });
    chmodSync(absolute, entry.mode);
  }
}

function compare() {
  const expected = [...tree.keys()].sort();
  const actual = existsSync(releaseRoot)
    ? files(releaseRoot)
        .map((path) => relative(releaseRoot, path).split(sep).join('/'))
        .sort()
    : [];
  const drift = [];
  for (const path of expected) {
    const absolute = resolve(releaseRoot, path);
    const entry = tree.get(path);
    if (!existsSync(absolute)) drift.push({ path, reason: 'missing' });
    else if (digest(readFileSync(absolute)) !== digest(entry.bytes))
      drift.push({ path, reason: 'content' });
    else if (((lstatSync(absolute).mode & 0o111) !== 0) !== ((entry.mode & 0o111) !== 0))
      drift.push({ path, reason: 'mode' });
  }
  for (const path of actual) if (!tree.has(path)) drift.push({ path, reason: 'extra' });
  return drift;
}

if (mode === '--check') {
  const drift = compare();
  if (drift.length > 0) throw new Error(`Release package drift:\n${json(drift)}`);
  process.stdout.write(`Checked ${products.length} release products.\n`);
} else {
  if (existsSync(releaseRoot)) {
    const marker = resolve(releaseRoot, '.openplanr-release.json');
    if (!existsSync(marker))
      throw new Error(`Refusing to replace unowned release directory: ${releaseRoot}`);
  }
  const staging = mkdtempSync(join(tmpdir(), 'openplanr-release-v18-'));
  writeTree(staging);
  if (existsSync(releaseRoot)) rmSync(releaseRoot, { recursive: true });
  renameSync(staging, releaseRoot);
  process.stdout.write(
    `Packaged ${registry.skills.length} skills, three host plugins, and nine Claude agents.\n`,
  );
}
