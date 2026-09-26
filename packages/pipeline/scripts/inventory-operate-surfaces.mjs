#!/usr/bin/env node

/**
 * Build the evidence record required before the Operate 2.0 legacy reset can
 * remove any source. Normal execution is read-only. Materialization is an
 * explicit local-development seam that can write only to a disposable path;
 * it can never regenerate the Phase 1 historical evidence bundle.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateJson } from '../conformance/json-schema-validate.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonicalOutputDirectory = '.planr/products/operate-2.0/phases';
const disposableOutputDirectory = 'conformance/.tmp/operate-inventory';
const outputFiles = Object.freeze({
  schema: 'operate-reset-inventory.schema.json',
  inventory: 'OPERATE_LEGACY_INVENTORY.json',
  review: 'OPERATE_LEGACY_INVENTORY.md',
  downstream: 'OPERATE_DOWNSTREAM_DELETION_MANIFEST.md',
});
const canonicalOutputPaths = Object.freeze(
  Object.values(outputFiles).map((name) => `${canonicalOutputDirectory}/${name}`),
);

export const INVENTORY_SCHEMA_VERSION = '1.0.0';
export const INVENTORY_CLASSIFICATIONS = Object.freeze([
  'KEEP_SHARED_FOUNDATION',
  'KEEP_V2',
  'REWRITE_V2',
  'DELETE_LEGACY',
  'DEFER_OWNER',
]);

// Reviewed compatibility pins for the CLI, engine, and regression suite.
// Update only with verified changes to these files. Historical source evidence
// remains immutable; current bytes are verified independently below.
export const PROTECTED_USER_OWNED_PATHS = Object.freeze({
  'bin/planr-pipeline.mjs': 'cb156a4a40ec0c0d930bb1800f5f9be26142e47cdc53131b7a6cddff6e65e3e0',
  'lib/pipeline/engine.mjs': '6b01dc99b961ff6913187ba2fcd5e8b541b5565294dc41807f0a8655e83f5451',
  'tests/pipeline/engine.test.mjs':
    '70c3ceb7c3101f381f5e2c4e91669ec777c7bb07d2a9509c5a80b75b2cbc6e50',
});

const knownRepositories = Object.freeze([
  { id: 'planr-pipeline', directory: '.', writeAuthority: 'authorized-current-task' },
  { id: 'OpenPlanr', directory: '../OpenPlanr', writeAuthority: 'read-only-inspection' },
  { id: 'skills', directory: '../skills', writeAuthority: 'read-only-inspection' },
  { id: 'marketplace', directory: '../marketplace', writeAuthority: 'read-only-inspection' },
]);

const ignoredSegments = new Set(['.git', 'node_modules', '.planr', 'coverage', 'dist']);
const textExtensions = new Set([
  '.cjs',
  '.css',
  '.d.mts',
  '.d.ts',
  '.feature',
  '.html',
  '.js',
  '.json',
  '.jsonl',
  '.md',
  '.mdc',
  '.mjs',
  '.sh',
  '.svg',
  '.ts',
  '.txt',
  '.yaml',
  '.yml',
]);
const outputPaths = new Set(canonicalOutputPaths);
const operatingNeedle =
  /\boperate\b|operating[-\s]|operatingboard|assignment\.submit|harness\s+(?:prepare|record|finalize|heartbeat)/i;
const legacyNeedle =
  /compatibility-v1_4|v1[_-]?[234]|operating-board|operating-mandate|harness\s+(?:prepare|record|finalize|heartbeat)|legacy-operating/i;

function fail(message) {
  throw new Error(message);
}

function command(commandName, args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync(commandName, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    fail(
      `${commandName} ${args.join(' ')} failed: ${result.stderr || result.stdout || `exit ${result.status}`}`,
    );
  }
  return result;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function portablePath(path) {
  return path.split(sep).join('/').replace(/^\.\//, '');
}

function isPortablePath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !isAbsolute(path) &&
    !/^[A-Za-z]:[\\/]/.test(path) &&
    !path.split('/').includes('..') &&
    !path.includes('\\') &&
    !path.startsWith('./')
  );
}

function readText(path) {
  const extension = path.endsWith('.d.mts')
    ? '.d.mts'
    : path.endsWith('.d.ts')
      ? '.d.ts'
      : extname(path);
  if (!textExtensions.has(extension)) return null;
  const value = readFileSync(path);
  return value.includes(0) ? null : value.toString('utf8');
}

function listFiles(root, current = root, files = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredSegments.has(entry.name)) continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) listFiles(root, path, files);
    else if (entry.isFile()) files.push(portablePath(relative(root, path)));
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function gitValue(root, args, fallback) {
  const result = command('git', args, { cwd: root, allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : fallback;
}

export function portableRepositoryRemote(remote) {
  const value = String(remote ?? '').trim();
  if (!value || value === 'no-remote-recorded') return 'no-remote-recorded';
  if (
    isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^file:/i.test(value) ||
    value.startsWith('./') ||
    value.startsWith('../')
  )
    return 'local-checkout';

  const scpRemote = value.match(/^(?:[^@/\s]+@)?([^:/\s]+):\/?([^\s]+)$/);
  if (scpRemote && !value.includes('://')) return `${scpRemote[1]}/${scpRemote[2]}`;

  try {
    const parsed = new URL(value);
    if (!['git:', 'http:', 'https:', 'ssh:'].includes(parsed.protocol)) return 'remote-recorded';
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}`;
  } catch {
    return 'local-checkout';
  }
}

function parseStatus(root) {
  const output = gitValue(root, ['status', '--porcelain=v1', '--untracked-files=all'], '');
  const entries = output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const original = line.slice(3);
      const path = original.includes(' -> ') ? original.split(' -> ').at(-1) : original;
      return {
        path: portablePath(path),
        index: line.slice(0, 1),
        worktree: line.slice(1, 2),
      };
    })
    .filter(({ path }) => !outputPaths.has(path));
  entries.sort((left, right) =>
    `${left.path}:${left.index}:${left.worktree}`.localeCompare(
      `${right.path}:${right.index}:${right.worktree}`,
    ),
  );
  return { state: entries.length === 0 ? 'clean' : 'dirty', entries };
}

function repositoryDescriptor(definition, root) {
  const directory = resolve(root, definition.directory);
  if (!existsSync(directory)) {
    return {
      id: definition.id,
      availability: 'unavailable',
      identity: 'unavailable',
      revision: 'UNAVAILABLE',
      worktree: { state: 'unavailable', entries: [] },
      writeAuthority: 'unavailable',
      evidenceGap: `${definition.id} checkout is unavailable for read-only inventory`,
    };
  }
  const packagePath = join(directory, 'package.json');
  let packageName = definition.id;
  if (existsSync(packagePath)) {
    try {
      packageName = JSON.parse(readFileSync(packagePath, 'utf8')).name ?? packageName;
    } catch {
      /* descriptive fallback */
    }
  }
  const remote = portableRepositoryRemote(
    gitValue(directory, ['config', '--get', 'remote.origin.url'], 'no-remote-recorded'),
  );
  return {
    id: definition.id,
    availability: 'available',
    identity: `${packageName} (${remote})`,
    revision: gitValue(directory, ['rev-parse', 'HEAD'], 'NOT_A_GIT_CHECKOUT'),
    worktree: parseStatus(directory),
    writeAuthority: definition.writeAuthority,
  };
}

function looksLikeOperatingSurface(path, text) {
  if (Object.hasOwn(PROTECTED_USER_OWNED_PATHS, path)) return true;
  const lower = path.toLowerCase();
  if (path === 'package.json' || path === 'docs/generated/adapters.md') return true;
  if (
    /^(?:lib\/operate\/|schemas\/v[0-9]|conformance\/|commands\/|templates\/runtime\/|agents\/operating\/|adapters\/|registry\/)/.test(
      lower,
    )
  ) {
    return operatingNeedle.test(`${path}\n${text ?? ''}`);
  }
  return operatingNeedle.test(`${path}\n${text ?? ''}`);
}

function classifyPlanrPipelineSurface(path, text) {
  if (Object.hasOwn(PROTECTED_USER_OWNED_PATHS, path)) return 'KEEP_SHARED_FOUNDATION';
  if (
    /^schemas\/v2\.0\.0\/(?:business-scope-binding|operate-v14-compatibility-transaction)\.schema\.json$/.test(
      path,
    )
  )
    return 'DELETE_LEGACY';
  if (/^lib\/operate\/compatibility-v1_4\./.test(path)) return 'DELETE_LEGACY';
  if (/^conformance\/fixtures\/operating-board\//.test(path)) return 'DELETE_LEGACY';
  if (
    /^conformance\/verify-operating-(?:board(?:-amendment|-v1_[34])?|mandate-vocabulary|records-migration)\.mjs$/.test(
      path,
    )
  )
    return 'DELETE_LEGACY';
  if (/^tests\/schema\/operating-schemas-v1_[34]\.test\.mjs$/.test(path)) return 'DELETE_LEGACY';
  if (
    path === 'tests/ecosystem/operate-release-contract.test.mjs' ||
    path === 'scripts/operate-release-canary.mjs'
  )
    return 'DELETE_LEGACY';
  if (
    /^schemas\/v2\.0\.0\//.test(path) ||
    /^conformance\/fixtures\/operating-runtime-v2\//.test(path) ||
    /^conformance\/verify-operate(?:-v2-absence|-ing-runtime-v2)\.mjs$/.test(path) ||
    /^tests\/ecosystem\/operate-(?:reset-inventory|v2-(?:development-package|legacy-absence))\.test\.mjs$/.test(
      path,
    ) ||
    /^lib\/operate\/runtime-foundation\./.test(path) ||
    /^lib\/dashboard\/(?:operate-reader\.mjs|app\/views\/operate\.js)$/.test(path) ||
    [
      'docs/compatibility-matrix.md',
      'docs/dashboard.md',
      'docs/ecosystem-guide.md',
      'docs/generated/adapters.md',
      'docs/ownership-map.md',
      'docs/protocol/README.md',
      'docs/protocol/operate-runtime-v2.md',
      'docs/release-checklist.md',
      'docs/runtime-guided-interactions.md',
      'input/tech/stack.md',
      'package.json',
      'scripts/check-operate-runtime-purity.mjs',
    ].includes(path)
  )
    return 'KEEP_V2';
  if (path === 'CHANGELOG.md' || path === 'scripts/inventory-operate-surfaces.mjs')
    return 'KEEP_SHARED_FOUNDATION';
  if (
    /^lib\/pipeline\//.test(path) ||
    /^lib\/dashboard\/(?!operate-reader\.mjs|app\/views\/operate\.js)/.test(path)
  )
    return 'KEEP_SHARED_FOUNDATION';
  if (legacyNeedle.test(`${path}\n${text ?? ''}`)) return 'DELETE_LEGACY';
  return 'KEEP_SHARED_FOUNDATION';
}

function kindFor(path) {
  if (Object.hasOwn(PROTECTED_USER_OWNED_PATHS, path)) return 'protected-user-owned';
  if (path === 'package.json') return 'package';
  if (path.startsWith('schemas/')) return 'schema';
  if (path.startsWith('conformance/fixtures/')) return 'fixture';
  if (path.startsWith('conformance/') || path.startsWith('tests/')) return 'test';
  if (path.startsWith('docs/') || path.endsWith('.md')) return 'documentation';
  if (path.startsWith('commands/')) return 'command';
  if (path.startsWith('templates/')) return 'template';
  if (path.startsWith('agents/') || path.startsWith('adapters/')) return 'runtime-asset';
  if (path.startsWith('registry/')) return 'registry';
  if (path.startsWith('scripts/')) return 'generator-or-script';
  return 'source';
}

function markdownLinks(path, text) {
  if (!/\.mdc?$/i.test(path)) return [];
  const links = [];
  for (const match of text?.matchAll(/\]\(([^)\s]+)(?:\s+[^)]*)?\)/g) ?? []) {
    const target = match[1].replace(/^<|>$/g, '');
    if (!target.startsWith('#') && !target.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(target))
      links.push(target.split('#', 1)[0]);
  }
  return [...new Set(links)].sort();
}

function importSpecifiers(text) {
  const imports = [];
  for (const match of text?.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()(['"])([^'"]+)\1/g,
  ) ?? [])
    imports.push(match[2]);
  return [...new Set(imports)].sort();
}

function resolveImport(path, specifier, allPaths) {
  if (!specifier.startsWith('.')) return `package:${specifier}`;
  const base = portablePath(normalize(join(dirname(path), specifier)));
  if (base === '..' || base.startsWith('../')) return 'unresolved:outside-repository';
  const alternatives = [
    base,
    `${base}.mjs`,
    `${base}.js`,
    `${base}.ts`,
    `${base}.d.mts`,
    `${base}.d.ts`,
    `${base}/index.mjs`,
    `${base}/index.js`,
  ];
  return alternatives.find((candidate) => allPaths.has(candidate)) ?? `unresolved:${base}`;
}

function packageReachability(path, packageJson) {
  if (!packageJson) return [];
  const references = [];
  if (path === 'package.json') references.push('package-manifest');
  for (const [exportName, target] of Object.entries(packageJson.exports ?? {})) {
    const targets = typeof target === 'string' ? [target] : Object.values(target ?? {});
    if (targets.some((value) => typeof value === 'string' && value.replace(/^\.\//, '') === path))
      references.push(`exports:${exportName}`);
  }
  const topLevel = path.split('/', 1)[0];
  if (
    (packageJson.files ?? []).some(
      (entry) => entry.replace(/\/$/, '') === topLevel || entry === path,
    )
  )
    references.push(`files:${topLevel}`);
  for (const [script, value] of Object.entries(packageJson.scripts ?? {})) {
    if (typeof value === 'string' && value.includes(path)) references.push(`script:${script}`);
  }
  return [...new Set(references)].sort();
}

function generatorEvidence(path) {
  if (
    path === 'docs/generated/adapters.md' ||
    path === 'docs/runtime-guided-interactions.md' ||
    /^adapters\/(?:claude-code\/README\.md|codex\/project-guidance\.md|cursor\/rules\/openplanr\.mdc)$/.test(
      path,
    )
  )
    return ['scripts/generate-guided-adapters.mjs'];
  return [];
}

function schemaRegistrationEvidence(path) {
  if (!path.startsWith('schemas/')) return [];
  // The protocol loader resolves catalogs by version rather than one literal
  // import per schema. Record that conservative resolver edge explicitly.
  return ['lib/protocol/loader.mjs:versioned-schema-catalog'];
}

function proofFor(classification, path) {
  if (classification === 'DELETE_LEGACY')
    return {
      mode: 'absence',
      requirement: `A later reset task must prove ${path} is absent and that no retained surface resolves it.`,
    };
  if (classification === 'REWRITE_V2')
    return {
      mode: 'replacement',
      requirement: `A later reset task must replace legacy semantics in ${path} with an explicit v2-only contract before removal.`,
    };
  if (classification === 'DEFER_OWNER')
    return {
      mode: 'owner-proof',
      requirement: `The owning repository must classify and prove any absence independently; this task has read-only evidence only.`,
    };
  return {
    mode: 'preserve',
    requirement: `Post-reset conformance must retain the supported behavior represented by ${path}.`,
  };
}

function describeClassification(classification, path) {
  const messages = {
    KEEP_SHARED_FOUNDATION: `Shared integrity, pipeline, or protected foundation retained at ${path}.`,
    KEEP_V2: `Explicit Operate 2.0 contract or fixture retained at ${path}.`,
    REWRITE_V2: `Mixed or client-facing Operate surface at ${path} requires a v2-only rewrite before any removal decision.`,
    DELETE_LEGACY: `Exact file-level v1.x compatibility or legacy-board surface at ${path}; eligible only after later absence proof.`,
    DEFER_OWNER: `Known downstream Operate reference at ${path}; its independent owner has not granted write authority to this task.`,
  };
  return messages[classification];
}

function makeSurface(repository, path, text, packageJson) {
  const classification =
    repository.id === 'planr-pipeline' ? classifyPlanrPipelineSurface(path, text) : 'DEFER_OWNER';
  const generatedBy = generatorEvidence(path);
  const observations = [
    `path:${path}`,
    text === null ? 'binary-or-nontext:no-text-parser' : 'text:conservative-static-scan',
  ];
  if (text?.match(/\bexport\b/)) observations.push('export:static-token');
  if (text?.match(/\$schema|schemaVersion|schemaId/)) observations.push('schema:static-token');
  if (text?.match(/\btest\s*\(|\bdescribe\s*\(/)) observations.push('test:static-token');
  if (text?.match(/\]\(/)) observations.push('markdown-link:static-parser');
  if (generatedBy.length > 0) observations.push('generated:declared-generator');
  const surface = {
    id: `${repository.id}:${path}`,
    repositoryId: repository.id,
    path,
    kind: kindFor(path),
    classification,
    rationale: describeClassification(classification, path),
    ownership:
      repository.id === 'planr-pipeline'
        ? 'contract-owner-or-shared-foundation'
        : 'independent-downstream-owner',
    evidence: {
      observations: observations.sort(),
      imports: importSpecifiers(text),
      markdownLinks: markdownLinks(path, text),
      packageReachability: packageReachability(path, packageJson),
      generatorEvidence: generatedBy,
      schemaRegistration: schemaRegistrationEvidence(path),
      testCoverage:
        path.startsWith('tests/') || path.startsWith('conformance/') ? [`self:${path}`] : [],
      documentationLinks: /\.mdc?$/i.test(path) ? [`self:${path}`] : [],
      downstreamReferences:
        repository.id === 'planr-pipeline' ? [] : [`repository:${repository.id}`],
    },
    reachability: {
      method:
        'static-import-and-content-reference-scan; dynamic resolution is conservatively unresolved',
      incoming: [],
      outgoing: [],
      unresolved: [],
    },
    proposedProof: proofFor(classification, path),
  };
  if (Object.hasOwn(PROTECTED_USER_OWNED_PATHS, path)) {
    surface.protectedPreserve = {
      recordedSha256: PROTECTED_USER_OWNED_PATHS[path],
      observedSha256: sha256File(join(repositoryRoot, path)),
      preserveOnly: true,
    };
  }
  return surface;
}

function packageManifest(root) {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function inventorySchema() {
  const portablePathSchema = {
    type: 'string',
    minLength: 1,
    pattern: '^(?!/)(?![A-Za-z]:)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._@/:-]+$',
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://openplanr.dev/schemas/operate-reset-inventory.schema.json',
    title: 'Operate reset surface inventory',
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion',
      'inventoryId',
      'classifications',
      'repositories',
      'surfaces',
      'evidenceGaps',
      'protectedPreserveEvidence',
    ],
    properties: {
      schemaVersion: { const: INVENTORY_SCHEMA_VERSION },
      inventoryId: { const: 'operate-2.0-legacy-surface-inventory' },
      classifications: {
        type: 'array',
        minItems: INVENTORY_CLASSIFICATIONS.length,
        items: { enum: INVENTORY_CLASSIFICATIONS },
      },
      repositories: {
        type: 'array',
        minItems: knownRepositories.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'availability', 'identity', 'revision', 'worktree', 'writeAuthority'],
          properties: {
            id: { enum: knownRepositories.map(({ id }) => id) },
            availability: { enum: ['available', 'unavailable'] },
            identity: { type: 'string', minLength: 1 },
            revision: { type: 'string', minLength: 1 },
            worktree: {
              type: 'object',
              additionalProperties: false,
              required: ['state', 'entries'],
              properties: {
                state: { enum: ['clean', 'dirty', 'unavailable'] },
                entries: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['path', 'index', 'worktree'],
                    properties: {
                      path: portablePathSchema,
                      index: { type: 'string' },
                      worktree: { type: 'string' },
                    },
                  },
                },
              },
            },
            writeAuthority: {
              enum: ['authorized-current-task', 'read-only-inspection', 'unavailable'],
            },
            evidenceGap: { type: 'string' },
          },
        },
      },
      surfaces: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'repositoryId',
            'path',
            'kind',
            'classification',
            'rationale',
            'ownership',
            'evidence',
            'reachability',
            'proposedProof',
          ],
          properties: {
            id: { type: 'string', minLength: 3 },
            repositoryId: { enum: knownRepositories.map(({ id }) => id) },
            path: portablePathSchema,
            kind: { type: 'string', minLength: 1 },
            classification: { enum: INVENTORY_CLASSIFICATIONS },
            rationale: { type: 'string', minLength: 1 },
            ownership: { type: 'string', minLength: 1 },
            evidence: {
              type: 'object',
              additionalProperties: false,
              required: [
                'observations',
                'imports',
                'markdownLinks',
                'packageReachability',
                'generatorEvidence',
                'schemaRegistration',
                'testCoverage',
                'documentationLinks',
                'downstreamReferences',
              ],
              properties: {
                observations: { type: 'array', minItems: 1, items: { type: 'string' } },
                imports: { type: 'array', items: { type: 'string' } },
                markdownLinks: { type: 'array', items: { type: 'string' } },
                packageReachability: { type: 'array', items: { type: 'string' } },
                generatorEvidence: { type: 'array', items: portablePathSchema },
                schemaRegistration: { type: 'array', items: { type: 'string' } },
                testCoverage: { type: 'array', items: { type: 'string' } },
                documentationLinks: { type: 'array', items: { type: 'string' } },
                downstreamReferences: { type: 'array', items: { type: 'string' } },
              },
            },
            reachability: {
              type: 'object',
              additionalProperties: false,
              required: ['method', 'incoming', 'outgoing', 'unresolved'],
              properties: {
                method: { type: 'string', minLength: 1 },
                incoming: { type: 'array', items: { type: 'string' } },
                outgoing: { type: 'array', items: { type: 'string' } },
                unresolved: { type: 'array', items: { type: 'string' } },
              },
            },
            proposedProof: {
              type: 'object',
              additionalProperties: false,
              required: ['mode', 'requirement'],
              properties: {
                mode: { enum: ['absence', 'replacement', 'owner-proof', 'preserve'] },
                requirement: { type: 'string', minLength: 1 },
              },
            },
            protectedPreserve: {
              type: 'object',
              additionalProperties: false,
              required: ['recordedSha256', 'observedSha256', 'preserveOnly'],
              properties: {
                recordedSha256: { pattern: '^[a-f0-9]{64}$' },
                observedSha256: { pattern: '^[a-f0-9]{64}$' },
                preserveOnly: { const: true },
              },
            },
          },
        },
      },
      evidenceGaps: { type: 'array', items: { type: 'string' } },
      protectedPreserveEvidence: {
        type: 'array',
        minItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'recordedSha256', 'observedSha256', 'matchesRecorded', 'preserveOnly'],
          properties: {
            path: portablePathSchema,
            recordedSha256: { pattern: '^[a-f0-9]{64}$' },
            observedSha256: { pattern: '^[a-f0-9]{64}$' },
            matchesRecorded: { const: true },
            preserveOnly: { const: true },
          },
        },
      },
    },
  };
}

function attachReachability(surfaces) {
  const surfacesByRepository = new Map();
  for (const surface of surfaces) {
    if (!surfacesByRepository.has(surface.repositoryId))
      surfacesByRepository.set(surface.repositoryId, new Map());
    surfacesByRepository.get(surface.repositoryId).set(surface.path, surface);
  }
  for (const surface of surfaces) {
    const localPaths = new Set(surfacesByRepository.get(surface.repositoryId).keys());
    const normalizedImports = [];
    for (const specifier of surface.evidence.imports) {
      const target = resolveImport(surface.path, specifier, localPaths);
      normalizedImports.push(target);
      if (target.startsWith('package:') || target.startsWith('unresolved:')) {
        surface.reachability.unresolved.push(target);
        continue;
      }
      surface.reachability.outgoing.push(`import:${target}`);
      surfacesByRepository
        .get(surface.repositoryId)
        .get(target)
        ?.reachability.incoming.push(`import:${surface.path}`);
    }
    surface.evidence.imports = [...new Set(normalizedImports)].sort();
    surface.evidence.markdownLinks = surface.evidence.markdownLinks
      .map((target) => {
        const resolved = portablePath(normalize(join(dirname(surface.path), target)));
        return resolved === '..' || resolved.startsWith('../')
          ? `unresolved-outside:${target.split('/').at(-1)}`
          : `markdown:${resolved}`;
      })
      .sort();
    for (const target of surface.evidence.markdownLinks) surface.reachability.outgoing.push(target);
  }
  for (const surface of surfaces) {
    for (const property of ['incoming', 'outgoing', 'unresolved'])
      surface.reachability[property] = [...new Set(surface.reachability[property])].sort();
  }
}

export function buildOperateSurfaceInventory({ root = repositoryRoot } = {}) {
  const repositories = knownRepositories.map((definition) =>
    repositoryDescriptor(definition, root),
  );
  const surfaces = [];
  for (const repository of repositories) {
    if (repository.availability !== 'available') continue;
    const definition = knownRepositories.find(({ id }) => id === repository.id);
    const directory = resolve(root, definition.directory);
    const manifest = packageManifest(directory);
    for (const path of listFiles(directory)) {
      if (repository.id === 'planr-pipeline' && outputPaths.has(path)) continue;
      const text = readText(join(directory, path));
      if (looksLikeOperatingSurface(path, text))
        surfaces.push(makeSurface(repository, path, text, manifest));
    }
  }
  surfaces.sort((left, right) => left.id.localeCompare(right.id));
  attachReachability(surfaces);
  const protectedPreserveEvidence = Object.entries(PROTECTED_USER_OWNED_PATHS)
    .map(([path, recordedSha256]) => {
      const observedSha256 = sha256File(join(root, path));
      return {
        path,
        recordedSha256,
        observedSha256,
        matchesRecorded: observedSha256 === recordedSha256,
        preserveOnly: true,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const evidenceGaps = repositories
    .filter(({ availability }) => availability === 'unavailable')
    .map(({ id, evidenceGap }) => `${id}: ${evidenceGap}`)
    .sort();
  const inventory = {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    inventoryId: 'operate-2.0-legacy-surface-inventory',
    classifications: [...INVENTORY_CLASSIFICATIONS],
    repositories,
    surfaces,
    evidenceGaps,
    protectedPreserveEvidence,
  };
  validateOperateSurfaceInventory(inventory);
  return inventory;
}

function assertPortableValue(value, label = '$') {
  if (typeof value === 'string') {
    const hasEmbeddedPosixPath = /(?:^|[\s("'=])\/(?!\/)(?:[^/\s"'()]+\/)+[^/\s"'()]*/.test(value);
    const hasWindowsPath = /(?:^|[\s("'=])(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+[\\/])/.test(value);
    if (
      isAbsolute(value) ||
      hasEmbeddedPosixPath ||
      hasWindowsPath ||
      value.includes('../') ||
      /(?:^|[\s"'])file:/i.test(value)
    )
      fail(`Non-portable absolute or sibling path in ${label}`);
    return;
  }
  if (Array.isArray(value))
    value.forEach((item, index) => assertPortableValue(item, `${label}[${index}]`));
  else if (value && typeof value === 'object')
    Object.entries(value).forEach(([key, item]) => assertPortableValue(item, `${label}.${key}`));
}

export function validateOperateSurfaceInventory(inventory) {
  const schemaErrors = validateJson(inventory, inventorySchema());
  if (schemaErrors.length > 0)
    fail(
      `Inventory schema validation failed: ${schemaErrors.map(({ path, rule }) => `${path} ${rule}`).join(', ')}`,
    );
  if (new Set(inventory.classifications).size !== INVENTORY_CLASSIFICATIONS.length)
    fail('Inventory classifications must contain every allowed classification exactly once.');
  const seen = new Set();
  for (const surface of inventory.surfaces) {
    const key = `${surface.repositoryId}:${surface.path}`;
    if (seen.has(key)) fail(`Duplicate surface ${key}`);
    seen.add(key);
    if (!isPortablePath(surface.path)) fail(`Surface path is not portable: ${surface.path}`);
    if (!INVENTORY_CLASSIFICATIONS.includes(surface.classification))
      fail(`Unsupported classification for ${key}`);
    if (surface.classification === 'DELETE_LEGACY') {
      if (surface.path.endsWith('/')) fail(`Directory-wide deletion is forbidden: ${surface.path}`);
      if (
        surface.proposedProof.mode !== 'absence' ||
        surface.evidence.observations.length === 0 ||
        !surface.reachability.method
      )
        fail(`DELETE_LEGACY lacks evidence or an absence proof: ${key}`);
    }
    if (
      surface.evidence.observations.includes('generated:declared-generator') &&
      surface.evidence.generatorEvidence.length === 0
    )
      fail(`Generated surface has no generator evidence: ${key}`);
  }
  for (const evidence of inventory.protectedPreserveEvidence) {
    if (!evidence.matchesRecorded) fail(`Protected user-owned bytes changed: ${evidence.path}`);
    const surface = inventory.surfaces.find(
      (candidate) =>
        candidate.repositoryId === 'planr-pipeline' && candidate.path === evidence.path,
    );
    if (!surface?.protectedPreserve?.preserveOnly)
      fail(`Missing protected Preserve surface evidence: ${evidence.path}`);
  }
  for (const repository of inventory.repositories) {
    if (
      repository.id !== 'planr-pipeline' &&
      repository.availability === 'available' &&
      repository.writeAuthority !== 'read-only-inspection'
    )
      fail(`Downstream authority must remain read-only: ${repository.id}`);
  }
  assertPortableValue(inventory);
  return inventory;
}

export function renderInventoryMarkdown(inventory) {
  const lines = [
    '# Operate Legacy Surface Inventory',
    '',
    '<!-- planr-product-workspace -->',
    '',
    'This deterministic review view is generated by `npm run inventory:operate-surfaces`. It contains no timestamps or local filesystem paths.',
    '',
    '## Repository evidence',
    '',
    '| Repository | Availability | Revision | Worktree | Write authority |',
    '| --- | --- | --- | --- | --- |',
    ...inventory.repositories.map(
      (repository) =>
        `| ${repository.id} | ${repository.availability} | ${repository.revision} | ${repository.worktree.state} | ${repository.writeAuthority} |`,
    ),
    '',
    '## Classified surfaces',
    '',
    '| Repository | Path | Classification | Kind | Proof mode |',
    '| --- | --- | --- | --- | --- |',
    ...inventory.surfaces.map(
      (surface) =>
        `| ${surface.repositoryId} | ${surface.path} | ${surface.classification} | ${surface.kind} | ${surface.proposedProof.mode} |`,
    ),
    '',
    'Every row above is a file-level decision. `DELETE_LEGACY` is eligibility only: it remains forbidden until the owning reset task proves both absence and no retained resolution edge.',
    '',
    '## Evidence gaps',
    '',
    ...(inventory.evidenceGaps.length > 0
      ? inventory.evidenceGaps.map((gap) => `- ${gap}`)
      : ['- None. Downstream repositories remain read-only in this task.']),
    '',
    '## Protected user-owned Preserve evidence',
    '',
    '| Path | Recorded SHA-256 | Observed SHA-256 | Preserve only |',
    '| --- | --- | --- | --- |',
    ...inventory.protectedPreserveEvidence.map(
      (evidence) =>
        `| ${evidence.path} | ${evidence.recordedSha256} | ${evidence.observedSha256} | ${evidence.preserveOnly} |`,
    ),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export function renderDownstreamManifest(inventory) {
  const downstream = inventory.surfaces.filter(
    ({ repositoryId }) => repositoryId !== 'planr-pipeline',
  );
  const lines = [
    '# Operate Downstream Deletion Manifest',
    '',
    '<!-- planr-product-workspace -->',
    '',
    'This manifest is a read-only handoff. It grants no deletion authority and contains the same downstream path/classification pairs as the machine inventory.',
    '',
    '| Repository | Path | Classification | Current authority | Required owner proof |',
    '| --- | --- | --- | --- | --- |',
    ...downstream.map(
      (surface) =>
        `| ${surface.repositoryId} | ${surface.path} | ${surface.classification} | read-only-inspection | ${surface.proposedProof.mode} |`,
    ),
    '',
    ...(downstream.length > 0
      ? [
          'Every row remains `DEFER_OWNER` until its repository owner authorizes a separately verified change.',
        ]
      : [
          'No downstream Operate paths were readable; unavailable repositories are recorded as evidence gaps in `OPERATE_LEGACY_INVENTORY.json`.',
        ]),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function canonicalOutputPath(root, path) {
  return portablePath(relative(root, resolve(root, path)));
}

function assertNoSymlinkSegments(root, portableDirectory) {
  let current = root;
  for (const segment of portableDirectory.split('/')) {
    current = join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      fail(`Output directory must not traverse a symbolic link: ${portableDirectory}`);
    }
  }
}

function resolveDisposableOutputDirectory(root, outputDirectory) {
  if (!isPortablePath(outputDirectory)) {
    fail('Output directory must be a safe disposable relative path.');
  }
  if (
    outputDirectory === disposableOutputDirectory ||
    !outputDirectory.startsWith(`${disposableOutputDirectory}/`)
  ) {
    fail(`Output directory must be a child of ${disposableOutputDirectory}.`);
  }

  const resolvedDirectory = resolve(root, outputDirectory);
  const resolvedRelativePath = portablePath(relative(root, resolvedDirectory));
  const canonicalDirectory = canonicalOutputPath(root, canonicalOutputDirectory);
  const canonicalTargets = new Set(
    canonicalOutputPaths.map((path) => canonicalOutputPath(root, path)),
  );
  if (
    resolvedRelativePath === canonicalDirectory ||
    resolvedRelativePath.startsWith(`${canonicalDirectory}/`) ||
    canonicalTargets.has(resolvedRelativePath)
  ) {
    fail(`Historical Operate evidence output is not a writable target: ${outputDirectory}`);
  }
  assertNoSymlinkSegments(root, outputDirectory);
  return { directory: resolvedDirectory, relativePath: resolvedRelativePath };
}

export function writeOperateSurfaceInventory({ root = repositoryRoot, outputDirectory } = {}) {
  const output = resolveDisposableOutputDirectory(root, outputDirectory);
  const inventory = buildOperateSurfaceInventory({ root });
  mkdirSync(output.directory, { recursive: true });
  assertNoSymlinkSegments(root, outputDirectory);
  const schemaPath = join(output.directory, outputFiles.schema);
  const inventoryPath = join(output.directory, outputFiles.inventory);
  const reviewPath = join(output.directory, outputFiles.review);
  const downstreamPath = join(output.directory, outputFiles.downstream);
  const schema = inventorySchema();
  writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
  writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  writeFileSync(reviewPath, renderInventoryMarkdown(inventory));
  writeFileSync(downstreamPath, renderDownstreamManifest(inventory));
  return {
    inventory,
    paths: {
      schema: `${output.relativePath}/${outputFiles.schema}`,
      inventory: `${output.relativePath}/${outputFiles.inventory}`,
      review: `${output.relativePath}/${outputFiles.review}`,
      downstream: `${output.relativePath}/${outputFiles.downstream}`,
    },
  };
}

function parseCliArguments(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--check')) {
    return { mode: 'check' };
  }
  if (argv.length === 3 && argv[0] === '--write' && argv[1] === '--output-dir') {
    return { mode: 'write', outputDirectory: argv[2] };
  }
  fail(
    'Usage: inventory-operate-surfaces.mjs [--check | --write --output-dir .planr/tmp/operate-inventory/<name>]',
  );
}

function summaryFor(mode, inventory, paths = undefined) {
  const summary = {
    ok: true,
    mode,
    inventoryId: inventory.inventoryId,
    surfaceCount: inventory.surfaces.length,
    sha256: sha256(JSON.stringify(inventory)),
  };
  if (paths) summary.paths = paths;
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseCliArguments(process.argv.slice(2));
    const result =
      options.mode === 'write'
        ? writeOperateSurfaceInventory({ outputDirectory: options.outputDirectory })
        : { inventory: buildOperateSurfaceInventory() };
    console.log(JSON.stringify(summaryFor(options.mode, result.inventory, result.paths)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
