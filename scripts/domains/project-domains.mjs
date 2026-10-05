#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GeneratedOwnership,
  generatedPath,
  writeGeneratedOutput,
} from '../lib/generated-ownership.mjs';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptRoot, '..', '..');
const PROJECTION_MANIFEST_DIRECTORY = 'lib/generated/domain-projections';
const ARTIFACT_ASSET_MANIFEST =
  'packages/artifact/lib/artifact/ui/generated/artifact-shell-assets.json';

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
    Object.freeze({ source: 'packages/design/templates/studio', target: 'templates/studio' }),
  ]),
});

// Historical digest evidence bootstraps checkouts that predate the local ownership ledger.
// New retirements are recorded by the ledger, rather than added to a path-only cleanup list.
const legacyOwnership = JSON.parse(
  readFileSync(resolve(scriptRoot, 'legacy-projection-ownership.json'), 'utf8'),
).entries;

const PROTOCOL_TARGETS = Object.freeze({
  'large-object-contracts': 'lib/protocol/large-object-contracts.mjs',
  'sharing-security-contracts': 'lib/protocol/sharing-security-contracts.mjs',
  'studio-presentation-contracts': 'lib/protocol/studio-presentation-contracts.mjs',
  errors: 'lib/protocol/errors.mjs',
  names: 'lib/protocol/names.mjs',
  'canonical-json': 'lib/protocol/canonical-json.mjs',
  'json-schema': 'lib/protocol/json-schema.mjs',
  contracts: 'lib/protocol/contracts.mjs',
  'browser-contracts': 'lib/protocol/browser-contracts.mjs',
  'diagram-contracts': 'lib/protocol/diagram-contracts.mjs',
  'diagram-authoring-contracts': 'lib/protocol/diagram-authoring-contracts.mjs',
  'diagram-review-contracts': 'lib/protocol/diagram-review-contracts.mjs',
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

// Protocol keeps canonical registries flat in registries/; scripts/protocol/project-protocol.mjs
// files each one under its protocol version in the pipeline.
const PROTOCOL_REGISTRY_TARGETS = Object.freeze({
  'artifact-theme.json': 'registry/v1.14.0/artifact-theme.json',
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
    const file = specifier.slice('@openplanr/protocol/registries/'.length);
    if (!Object.hasOwn(PROTOCOL_REGISTRY_TARGETS, file))
      throw new Error(`No pipeline projection for protocol registry ${specifier}`);
    return `planr-pipeline/${PROTOCOL_REGISTRY_TARGETS[file]}`;
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
    (_match, quote, specifier) =>
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

function previousManifestEntries(targetRoot, domain) {
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
      .filter((entry) => typeof entry?.target === 'string' && isOwnedTarget(domain, entry.target))
      .map((entry) => ({ owner: domain, target: entry.target, sha256: entry.sha256 }));
  } catch {
    return [];
  }
}

// A TypeScript source ships as the .mjs and .d.mts compiled beside it. Shipping the source
// too would let a consumer's compiler resolve `./x.mjs` to `x.mts` and check it as its own.
const isTypeScriptSource = (path) => /\.(?:mts|tsx)$/u.test(path) && !path.endsWith('.d.mts');

// Bundled browser assets already contain their runtime dependencies. Preserve their bytes,
// including type comments, so the canonical integrity manifest remains authoritative.
function sealedArtifactAssets() {
  const manifest = JSON.parse(
    readFileSync(resolve(workspaceRoot, ARTIFACT_ASSET_MANIFEST), 'utf8'),
  );
  if (manifest.sync !== 'byte-for-byte' || !Array.isArray(manifest.assets)) {
    throw new Error(
      'Canonical artifact asset manifest must declare byte-for-byte synchronization.',
    );
  }
  return new Map(
    manifest.assets.map((asset) => [
      resolve(workspaceRoot, 'packages/artifact', asset.path),
      asset,
    ]),
  );
}

function collectEntries(domains, targetRoot) {
  const entries = [];
  const sealedAssets = domains.includes('artifact') ? sealedArtifactAssets() : new Map();
  for (const domain of domains) {
    for (const projection of DOMAIN_PROJECTIONS[domain]) {
      const sourceRoot = resolve(workspaceRoot, projection.source);
      if (!existsSync(sourceRoot))
        throw new Error(`Missing canonical source: ${projection.source}`);
      for (const child of walkFiles(sourceRoot)) {
        if (isTypeScriptSource(child)) {
          const compiled = join(projection.source, child.replace(/\.(?:mts|tsx)$/u, '.mjs'));
          if (!existsSync(resolve(workspaceRoot, compiled)))
            throw new Error(`Missing compiled ${compiled}; run npm run generate first.`);
          continue;
        }
        const sourcePath = child ? join(sourceRoot, child) : sourceRoot;
        const targetRelative = child ? join(projection.target, child) : projection.target;
        const targetPath = resolve(targetRoot, targetRelative);
        const containment = relative(targetRoot, targetPath);
        if (containment.startsWith('..') || isAbsolute(containment)) {
          throw new Error(`Projection escapes target root: ${targetRelative}`);
        }
        const sourceBytes = readFileSync(sourcePath);
        const sealedAsset = sealedAssets.get(sourcePath);
        if (
          sealedAsset &&
          (sourceBytes.length !== sealedAsset.bytes || sha256(sourceBytes) !== sealedAsset.sha256)
        ) {
          throw new Error(
            `Canonical asset ${sealedAsset.path} is stale; run npm run generate first.`,
          );
        }
        const expectedBytes = sealedAsset
          ? sourceBytes
          : projectBytes(sourceBytes, targetRelative.split(sep).join('/'));
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
    const custody = new GeneratedOwnership({
      root: options.target,
      scope: 'domain-projections',
      owns: (domain, target) =>
        Object.hasOwn(DOMAIN_PROJECTIONS, domain) &&
        (isOwnedTarget(domain, target) ||
          legacyOwnership.some((entry) => entry.owner === domain && entry.target === target)),
    }).bootstrap([
      ...options.domains.flatMap((domain) => previousManifestEntries(options.target, domain)),
      ...legacyOwnership.filter((entry) => options.domains.includes(entry.owner)),
    ]);
    const overwriteConflicts = custody.verifyWrites(
      entries.map(({ domain, target, sha256 }) => ({ owner: domain, target, sha256 })),
    );
    const retirement = custody.retire({
      owners: options.domains,
      expectedPaths: currentTargets,
      write: options.mode === 'write' && overwriteConflicts.length === 0,
    });
    drift.push(
      ...retirement.retired.map(({ owner, target }) => ({ domain: owner, target, stale: true })),
    );
    if (options.mode === 'write') changed += retirement.retired.length;
    const conflicts = [...overwriteConflicts, ...retirement.conflicts].map(
      ({ owner, target, reason }) => ({ domain: owner, target, reason }),
    );
    let mayWrite = options.mode === 'write' && conflicts.length === 0;
    for (const entry of entries) {
      generatedPath(options.target, entry.target);
      const actual =
        existsSync(entry.targetPath) && !lstatSync(entry.targetPath).isSymbolicLink()
          ? readFileSync(entry.targetPath)
          : null;
      const actualMode = actual === null ? null : statSync(entry.targetPath).mode & 0o777;
      const matches = actual?.equals(entry.bytes) && actualMode === entry.mode;
      if (matches) continue;
      drift.push({
        domain: entry.domain,
        target: entry.target,
        expectedSha256: entry.sha256,
        actualSha256: actual === null ? null : sha256(actual),
        expectedMode: entry.mode.toString(8),
        actualMode: actualMode === null ? null : actualMode.toString(8),
      });
      if (mayWrite) {
        const concurrent = custody.verifyWrites([
          { owner: entry.domain, target: entry.target, sha256: entry.sha256 },
        ]);
        if (concurrent.length > 0) {
          conflicts.push(
            ...concurrent.map(({ owner, target, reason }) => ({ domain: owner, target, reason })),
          );
          mayWrite = false;
          continue;
        }
        if (existsSync(entry.targetPath) && lstatSync(entry.targetPath).isSymbolicLink()) {
          throw new Error(`Refusing to replace symlinked projection: ${entry.target}`);
        }
        writeGeneratedOutput({
          root: options.target,
          target: entry.target,
          bytes: entry.bytes,
          mode: entry.mode,
          recheck: () => {
            const concurrent = custody.verifyWrites([
              { owner: entry.domain, target: entry.target, sha256: entry.sha256 },
            ]);
            if (concurrent.length > 0)
              throw new Error(
                `Generated projection changed before replacement: ${JSON.stringify(concurrent)}`,
              );
          },
        });
        changed += 1;
      }
    }
    for (const domain of options.domains) {
      const target = manifestTarget(domain);
      const targetPath = generatedPath(options.target, target);
      const expected = renderManifest(domain, entries);
      const actual =
        existsSync(targetPath) && !lstatSync(targetPath).isSymbolicLink()
          ? readFileSync(targetPath)
          : null;
      if (actual?.equals(expected)) continue;
      drift.push({
        domain,
        target,
        expectedSha256: sha256(expected),
        actualSha256: actual === null ? null : sha256(actual),
        manifest: true,
      });
      if (mayWrite) {
        if (existsSync(targetPath) && lstatSync(targetPath).isSymbolicLink()) {
          throw new Error(`Refusing to replace symlinked projection manifest: ${target}`);
        }
        writeGeneratedOutput({ root: options.target, target, bytes: expected, mode: 0o644 });
        changed += 1;
      }
    }
    if (mayWrite) {
      custody
        .record(entries.map(({ domain, target, sha256 }) => ({ owner: domain, target, sha256 })))
        .save();
    }
    const report = {
      ok: conflicts.length === 0 && (options.mode === 'write' || drift.length === 0),
      mode: options.mode,
      target: options.target,
      domains: options.domains,
      projectedFiles: entries.length,
      manifestFiles: options.domains.length,
      changedFiles: changed,
      driftFiles: options.mode === 'check' ? drift.length : 0,
      drift: options.mode === 'check' ? drift : [],
      conflicts,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}

main();
