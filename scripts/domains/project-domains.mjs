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

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptRoot, '..', '..');
const PROJECTION_MANIFEST_DIRECTORY = 'lib/generated/domain-projections';

const DOMAIN_PROJECTIONS = Object.freeze({
  operate: Object.freeze([
    Object.freeze({ source: 'packages/operate/lib/operate', target: 'lib/operate' }),
  ]),
  artifact: Object.freeze([
    Object.freeze({ source: 'packages/artifact/lib/artifact', target: 'lib/artifact' }),
    Object.freeze({ source: 'packages/artifact/fixtures/diagram', target: 'fixtures/diagram' }),
    Object.freeze({ source: 'packages/artifact/gallery/diagram', target: 'gallery/diagram' }),
    Object.freeze({ source: 'packages/artifact/references/diagram', target: 'references/diagram' }),
    Object.freeze({ source: 'packages/artifact/templates', target: 'templates' }),
    Object.freeze({
      source: 'packages/artifact/THIRD_PARTY_NOTICES.md',
      target: 'THIRD_PARTY-DIAGRAM-NOTICES.md',
    }),
    Object.freeze({
      source: 'packages/artifact/scripts/generate-artifact-shell.mjs',
      target: 'scripts/generate-artifact-shell.mjs',
    }),
  ]),
  design: Object.freeze([
    Object.freeze({ source: 'packages/design/lib/design', target: 'lib/design' }),
    Object.freeze({ source: 'packages/design/lib/design-engine', target: 'lib/design-engine' }),
    Object.freeze({ source: 'packages/design/templates/design', target: 'templates/design' }),
    Object.freeze({ source: 'packages/design/templates/studio', target: 'templates/studio' }),
  ]),
});

const PROTOCOL_TARGETS = Object.freeze({
  errors: 'lib/protocol/errors.mjs',
  'canonical-json': 'lib/protocol/canonical-json.mjs',
  'json-schema': 'lib/protocol/json-schema.mjs',
  contracts: 'lib/protocol/contracts.mjs',
  'diagram-contracts': 'lib/protocol/diagram-contracts.mjs',
  'diagram-authoring-contracts': 'lib/protocol/diagram-authoring-contracts.mjs',
  'design-contracts': 'lib/protocol/design-contracts.mjs',
  'design-publication-contracts': 'lib/protocol/design-publication-contracts.mjs',
  'workspace-contracts': 'lib/protocol/workspace-contracts.mjs',
  'review-experience-contracts': 'lib/protocol/review-experience-contracts.mjs',
  'design-handoff-contracts': 'lib/protocol/design-handoff-contracts.mjs',
  'operate-contract-catalog-v2': 'lib/protocol/generated/contract-catalog-v2.mjs',
  'operate-experience-live-patch': 'lib/protocol/operate-experience-live-patch.mjs',
  'live-evidence-v2': 'lib/protocol/live-evidence-v2.mjs',
  'operating-planning-contracts': 'lib/protocol/operating-planning-contracts.mjs',
});

function usage(message = '') {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write(
    'Usage: node scripts/domains/project-domains.mjs (--write|--check) ' +
      '--target <pipeline-package-root> [--domain operate|artifact|design]\n',
  );
  process.exitCode = 2;
}

function parseArgs(argv) {
  let mode = null;
  let target = null;
  const domains = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write' || arg === '--check') {
      if (mode && mode !== arg.slice(2)) return { error: 'Choose exactly one mode.' };
      mode = arg.slice(2);
    } else if (arg === '--target') {
      target = argv[index + 1];
      index += 1;
    } else if (arg === '--domain') {
      domains.push(argv[index + 1]);
      index += 1;
    } else {
      return { error: `Unknown argument: ${arg}` };
    }
  }
  if (!mode) return { error: 'A --write or --check mode is required.' };
  if (!target) return { error: 'A --target path is required.' };
  const selected = domains.length === 0 ? Object.keys(DOMAIN_PROJECTIONS) : [...new Set(domains)];
  const unknown = selected.filter((domain) => !DOMAIN_PROJECTIONS[domain]);
  if (unknown.length > 0) return { error: `Unknown domain: ${unknown.join(', ')}` };
  return { mode, target: resolve(target), domains: selected.sort() };
}

function walkFiles(root) {
  const entry = lstatSync(root);
  if (entry.isSymbolicLink()) throw new Error(`Canonical source must not be a symlink: ${root}`);
  if (entry.isFile()) return [''];
  if (!entry.isDirectory()) throw new Error(`Unsupported canonical source: ${root}`);
  const files = [];
  const visit = (directory, prefix = '') => {
    for (const child of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const childPath = join(directory, child.name);
      const childRelative = prefix ? join(prefix, child.name) : child.name;
      if (child.isSymbolicLink())
        throw new Error(`Canonical source must not contain symlinks: ${childPath}`);
      if (child.isDirectory()) visit(childPath, childRelative);
      else if (child.isFile()) files.push(childRelative);
      else throw new Error(`Unsupported canonical source entry: ${childPath}`);
    }
  };
  visit(root);
  return files;
}

function posixRelative(fromDirectory, toFile) {
  const value = relative(fromDirectory, toFile).split(sep).join('/');
  return value.startsWith('.') ? value : `./${value}`;
}

function projectedSpecifier(specifier, targetRelativeFile) {
  const targetDirectory = dirname(targetRelativeFile);
  if (specifier === '@openplanr/protocol') {
    return targetRelativeFile.endsWith('.d.mts')
      ? 'planr-pipeline/protocol'
      : posixRelative(targetDirectory, 'lib/protocol/loader.mjs');
  }
  if (specifier === '@openplanr/protocol/package.json') return 'planr-pipeline/package.json';
  if (specifier.startsWith('@openplanr/protocol/schemas/')) {
    return `planr-pipeline/schemas/${specifier.slice('@openplanr/protocol/schemas/'.length)}`;
  }
  if (specifier.startsWith('@openplanr/protocol/registry/')) {
    return `planr-pipeline/registry/${specifier.slice('@openplanr/protocol/registry/'.length)}`;
  }
  if (specifier.startsWith('@openplanr/protocol/registries/')) {
    return `planr-pipeline/registries/${specifier.slice('@openplanr/protocol/registries/'.length)}`;
  }
  if (specifier.startsWith('@openplanr/protocol/')) {
    const subpath = specifier.slice('@openplanr/protocol/'.length);
    const protocolTarget = PROTOCOL_TARGETS[subpath];
    if (!protocolTarget) throw new Error(`No pipeline projection for protocol import ${specifier}`);
    return posixRelative(targetDirectory, protocolTarget);
  }
  if (specifier === '@openplanr/artifact') {
    return posixRelative(targetDirectory, 'lib/artifact/index.mjs');
  }
  if (specifier === '@openplanr/artifact/package.json') return 'planr-pipeline/package.json';
  if (specifier.startsWith('@openplanr/artifact/')) {
    const subpath = specifier.slice('@openplanr/artifact/'.length);
    return posixRelative(targetDirectory, `lib/artifact/${subpath}`);
  }
  throw new Error(`No pipeline projection for workspace import ${specifier}`);
}

function projectBytes(bytes, targetRelativeFile) {
  if (!/\.(?:[cm]?[jt]s|mts)$/u.test(targetRelativeFile)) return bytes;
  const source = bytes.toString('utf8');
  const projected = source.replace(
    /(['"])(@openplanr\/(?:protocol|artifact)(?:\/[^'"\s]+)?)\1/gu,
    (match, quote, specifier) =>
      `${quote}${projectedSpecifier(specifier, targetRelativeFile)}${quote}`,
  );
  if (/(['"])@openplanr\//u.test(projected)) {
    throw new Error(`Unprojected private workspace import remains in ${targetRelativeFile}`);
  }
  return Buffer.from(projected);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function manifestTarget(domain) {
  return `${PROJECTION_MANIFEST_DIRECTORY}/${domain}.json`;
}

function renderManifest(domain, entries) {
  return Buffer.from(
    `${JSON.stringify(
      {
        schemaVersion: '1.0.0',
        kind: 'openplanr-domain-projection',
        domain,
        generator: 'scripts/domains/project-domains.mjs',
        entries: entries
          .filter((entry) => entry.domain === domain)
          .map(({ source, target, sha256: digest, mode }) => ({
            source,
            target,
            sha256: digest,
            mode: mode.toString(8),
          })),
      },
      null,
      2,
    )}\n`,
  );
}

function isOwnedTarget(domain, target) {
  return DOMAIN_PROJECTIONS[domain].some(
    (projection) => target === projection.target || target.startsWith(`${projection.target}/`),
  );
}

function previousManifestTargets(targetRoot, domain) {
  const path = resolve(targetRoot, manifestTarget(domain));
  if (!existsSync(path) || lstatSync(path).isSymbolicLink()) return [];
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (
      manifest?.schemaVersion !== '1.0.0' ||
      manifest?.kind !== 'openplanr-domain-projection' ||
      manifest?.domain !== domain ||
      !Array.isArray(manifest.entries)
    )
      return [];
    return manifest.entries
      .map((entry) => entry?.target)
      .filter((target) => typeof target === 'string' && isOwnedTarget(domain, target));
  } catch {
    return [];
  }
}

function atomicWrite(path, bytes, mode) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes, { mode });
  renameSync(temporary, path);
  chmodSync(path, mode);
}

function collectEntries(domains, targetRoot) {
  const entries = [];
  for (const domain of domains) {
    for (const projection of DOMAIN_PROJECTIONS[domain]) {
      const sourceRoot = resolve(workspaceRoot, projection.source);
      if (!existsSync(sourceRoot))
        throw new Error(`Missing canonical source: ${projection.source}`);
      for (const child of walkFiles(sourceRoot)) {
        const sourcePath = child ? join(sourceRoot, child) : sourceRoot;
        const targetRelative = child ? join(projection.target, child) : projection.target;
        const targetPath = resolve(targetRoot, targetRelative);
        const containment = relative(targetRoot, targetPath);
        if (containment.startsWith('..') || isAbsolute(containment)) {
          throw new Error(`Projection escapes target root: ${targetRelative}`);
        }
        const sourceBytes = readFileSync(sourcePath);
        const expectedBytes = projectBytes(sourceBytes, targetRelative.split(sep).join('/'));
        entries.push({
          domain,
          source: relative(workspaceRoot, sourcePath).split(sep).join('/'),
          target: targetRelative.split(sep).join('/'),
          targetPath,
          bytes: expectedBytes,
          mode: statSync(sourcePath).mode & 0o777,
          sha256: sha256(expectedBytes),
        });
      }
    }
  }
  return entries.sort((left, right) => left.target.localeCompare(right.target));
}

function validateTargetRoot(targetRoot) {
  if (!existsSync(targetRoot)) throw new Error(`Pipeline target does not exist: ${targetRoot}`);
  const targetStat = lstatSync(targetRoot);
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
    throw new Error(`Pipeline target must be a real directory: ${targetRoot}`);
  }
  const packagePath = join(targetRoot, 'package.json');
  if (existsSync(packagePath)) {
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
    if (manifest.name !== 'planr-pipeline') {
      throw new Error(`Projection target must be planr-pipeline, got ${String(manifest.name)}`);
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.error) return usage(options.error);
  try {
    validateTargetRoot(options.target);
    const entries = collectEntries(options.domains, options.target);
    const drift = [];
    let changed = 0;
    const currentTargets = new Set(entries.map((entry) => entry.target));
    for (const domain of options.domains) {
      for (const staleTarget of previousManifestTargets(options.target, domain)) {
        if (currentTargets.has(staleTarget)) continue;
        const stalePath = resolve(options.target, staleTarget);
        const containment = relative(options.target, stalePath);
        if (containment.startsWith('..') || isAbsolute(containment)) {
          throw new Error(`Recorded stale projection escapes target root: ${staleTarget}`);
        }
        if (!existsSync(stalePath)) continue;
        const staleStat = lstatSync(stalePath);
        if (staleStat.isSymbolicLink() || !staleStat.isFile()) {
          throw new Error(`Refusing to remove non-file stale projection: ${staleTarget}`);
        }
        drift.push({ domain, target: staleTarget, stale: true });
        if (options.mode === 'write') {
          unlinkSync(stalePath);
          changed += 1;
        }
      }
    }
    for (const entry of entries) {
      const actual =
        existsSync(entry.targetPath) && !lstatSync(entry.targetPath).isSymbolicLink()
          ? readFileSync(entry.targetPath)
          : null;
      const actualMode = actual === null ? null : statSync(entry.targetPath).mode & 0o777;
      const matches = actual !== null && actual.equals(entry.bytes) && actualMode === entry.mode;
      if (matches) continue;
      drift.push({
        domain: entry.domain,
        target: entry.target,
        expectedSha256: entry.sha256,
        actualSha256: actual === null ? null : sha256(actual),
        expectedMode: entry.mode.toString(8),
        actualMode: actualMode === null ? null : actualMode.toString(8),
      });
      if (options.mode === 'write') {
        if (existsSync(entry.targetPath) && lstatSync(entry.targetPath).isSymbolicLink()) {
          throw new Error(`Refusing to replace symlinked projection: ${entry.target}`);
        }
        atomicWrite(entry.targetPath, entry.bytes, entry.mode);
        changed += 1;
      }
    }
    for (const domain of options.domains) {
      const target = manifestTarget(domain);
      const targetPath = resolve(options.target, target);
      const expected = renderManifest(domain, entries);
      const actual =
        existsSync(targetPath) && !lstatSync(targetPath).isSymbolicLink()
          ? readFileSync(targetPath)
          : null;
      if (actual !== null && actual.equals(expected)) continue;
      drift.push({
        domain,
        target,
        expectedSha256: sha256(expected),
        actualSha256: actual === null ? null : sha256(actual),
        manifest: true,
      });
      if (options.mode === 'write') {
        if (existsSync(targetPath) && lstatSync(targetPath).isSymbolicLink()) {
          throw new Error(`Refusing to replace symlinked projection manifest: ${target}`);
        }
        atomicWrite(targetPath, expected, 0o644);
        changed += 1;
      }
    }
    const report = {
      ok: options.mode === 'write' || drift.length === 0,
      mode: options.mode,
      target: options.target,
      domains: options.domains,
      projectedFiles: entries.length,
      manifestFiles: options.domains.length,
      changedFiles: changed,
      driftFiles: options.mode === 'check' ? drift.length : 0,
      drift: options.mode === 'check' ? drift : [],
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (options.mode === 'check' && drift.length > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}

main();
