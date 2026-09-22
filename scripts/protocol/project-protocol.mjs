#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DIAGRAM_V16_REGISTRIES, PROTOCOL_V17_REGISTRIES } from '../../packages/protocol/src/skill-source-contracts.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifestRelative = 'lib/generated/protocol-projection.json';

// The additive Protocol 1.6 registries share the flat protocol registries/
// directory but project only to registry/v1.6.0; the seven v1.5 canonical
// catalogs continue to project to registry/v1.5.0.
const V16_REGISTRIES = new Set(Object.keys(DIAGRAM_V16_REGISTRIES));
const V17_REGISTRIES = new Set(Object.keys(PROTOCOL_V17_REGISTRIES));
const V113_REGISTRIES = new Set(['diagram-authoring-capabilities.json']);

const DASHBOARD_CONTRACT_FILES = new Set([
  'generated/operate-schema-token-codec.mjs',
  'operate-experience-audit-display-contract.d.mts',
  'operate-experience-display-contract.d.mts',
  'operate-experience-surface-contract.d.mts',
  'operate-review-contract.d.mts',
  'operate-review-payload-safety.d.mts',
  'operate-review-payload-safety.mjs',
  'operate-review-workspace-projection-v2.d.mts',
]);

const mappings = Object.freeze([
  Object.freeze({
    source: 'packages/protocol/projections/pipeline/lib/protocol',
    target: 'lib/protocol',
    rejectExtras: false,
  }),
  // Every published schema version has one canonical Protocol owner.
  Object.freeze({ source: 'packages/protocol/schemas', target: 'schemas', rejectExtras: true }),
  Object.freeze({ source: 'packages/protocol/registry', target: 'registry', rejectExtras: false }),
  Object.freeze({
    source: 'packages/protocol/lib/dashboard', target: 'lib/dashboard', rejectExtras: false,
    include: (path) => DASHBOARD_CONTRACT_FILES.has(path),
  }),
  Object.freeze({
    source: 'packages/protocol/registries',
    target: 'registry/v1.13.0',
    rejectExtras: true,
    include: (path) => V113_REGISTRIES.has(path),
  }),
  Object.freeze({
    source: 'packages/protocol/registries',
    target: 'registry/v1.5.0',
    rejectExtras: true,
    include: (path) => !V16_REGISTRIES.has(path) && !V17_REGISTRIES.has(path) && !V113_REGISTRIES.has(path),
  }),
  Object.freeze({
    source: 'packages/protocol/registries',
    target: 'registry/v1.6.0',
    rejectExtras: false,
    include: (path) => V16_REGISTRIES.has(path),
  }),
  Object.freeze({
    source: 'packages/protocol/registries',
    target: 'registry/v1.7.0',
    rejectExtras: true,
    include: (path) => V17_REGISTRIES.has(path),
  }),
]);

function parseArgs(argv) {
  const mode = argv.includes('--write') ? 'write' : argv.includes('--check') ? 'check' : null;
  const targetIndex = argv.indexOf('--target');
  if (!mode || (argv.includes('--write') && argv.includes('--check')) || targetIndex < 0 || !argv[targetIndex + 1]) {
    throw new Error('Usage: project-protocol.mjs (--write|--check) --target <pipeline-root>');
  }
  return { mode, target: resolve(argv[targetIndex + 1]) };
}

function walk(root, prefix = '') {
  if (lstatSync(root).isSymbolicLink()) throw new Error(`Protocol source is a symlink: ${root}`);
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = join(root, entry.name);
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Protocol source is a symlink: ${absolute}`);
    if (entry.isDirectory()) files.push(...walk(absolute, path));
    else if (entry.isFile()) files.push({ absolute, path });
    else throw new Error(`Unsupported Protocol source entry: ${absolute}`);
  }
  return files;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function contained(root, path) {
  const child = relative(root, path);
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function atomicWrite(path, bytes, mode) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes, { mode });
  renameSync(temporary, path);
  chmodSync(path, mode);
}

const { mode, target } = parseArgs(process.argv.slice(2));
if (!existsSync(join(target, 'package.json'))) throw new Error(`Pipeline package is missing: ${target}`);
const targetManifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
if (targetManifest.name !== 'planr-pipeline') throw new Error('Protocol projection target is not planr-pipeline.');

const entries = [];
for (const mapping of mappings) {
  const sourceRoot = resolve(workspaceRoot, mapping.source);
  for (const source of walk(sourceRoot)) {
    if (mapping.include && !mapping.include(source.path)) continue;
    const targetRelative = `${mapping.target}/${source.path}`;
    const targetPath = resolve(target, targetRelative);
    if (!contained(target, targetPath)) throw new Error(`Protocol projection escapes target: ${targetRelative}`);
    const bytes = readFileSync(source.absolute);
    entries.push({
      source: `${mapping.source}/${source.path}`,
      target: targetRelative,
      targetPath,
      bytes,
      sha256: sha256(bytes),
      mode: statSync(source.absolute).mode & 0o777,
    });
  }
}
entries.sort((a, b) => a.target.localeCompare(b.target));

const expectedTargets = new Set(entries.map((entry) => entry.target));
const drift = [];
for (const entry of entries) {
  if (!existsSync(entry.targetPath) || lstatSync(entry.targetPath).isSymbolicLink()) {
    drift.push(`${entry.target}: missing or symlink`);
  } else {
    const actual = readFileSync(entry.targetPath);
    const actualMode = statSync(entry.targetPath).mode & 0o777;
    if (!actual.equals(entry.bytes)) drift.push(`${entry.target}: bytes`);
    if (actualMode !== entry.mode) drift.push(`${entry.target}: mode`);
  }
}

for (const mapping of mappings.filter((entry) => entry.rejectExtras)) {
  const targetRoot = resolve(target, mapping.target);
  if (!existsSync(targetRoot)) continue;
  for (const file of walk(targetRoot)) {
    const relativeTarget = `${mapping.target}/${file.path}`;
    if (!expectedTargets.has(relativeTarget)) drift.push(`${relativeTarget}: extra`);
  }
}

const previousManifestPath = resolve(target, manifestRelative);
const preservedV16SkillRegistries = new Set([...V17_REGISTRIES].map((path) => `registry/v1.6.0/${path}`));
if (mode === 'write' && existsSync(previousManifestPath)) {
  const previous = JSON.parse(readFileSync(previousManifestPath, 'utf8'));
  for (const item of previous.entries ?? []) {
    if (typeof item.target !== 'string' || expectedTargets.has(item.target) || preservedV16SkillRegistries.has(item.target)) continue;
    const stale = resolve(target, item.target);
    if (contained(target, stale) && existsSync(stale) && !lstatSync(stale).isDirectory()) unlinkSync(stale);
  }
}

const renderedManifest = Buffer.from(`${JSON.stringify({
  kind: 'openplanr-protocol-projection',
  schemaVersion: '1.0.0',
  generator: 'scripts/protocol/project-protocol.mjs',
  entries: entries.map(({ source, target: targetPath, sha256: digest, mode: fileMode }) => ({
    source,
    target: targetPath,
    sha256: digest,
    mode: fileMode.toString(8),
  })),
}, null, 2)}\n`);

if (!existsSync(previousManifestPath) || !readFileSync(previousManifestPath).equals(renderedManifest)) {
  drift.push(`${manifestRelative}: bytes`);
}

if (mode === 'check' && drift.length > 0) {
  throw new Error(`Protocol projection drift:\n${drift.map((item) => `- ${item}`).join('\n')}`);
}
if (mode === 'write') {
  for (const entry of entries) atomicWrite(entry.targetPath, entry.bytes, entry.mode);
  atomicWrite(previousManifestPath, renderedManifest, 0o644);
}

process.stdout.write(`${mode === 'check' ? 'Checked' : 'Projected'} ${entries.length} Protocol files into planr-pipeline.\n`);
