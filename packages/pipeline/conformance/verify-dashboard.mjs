#!/usr/bin/env node

/**
 * Structural dashboard conformance.
 *
 * This gate certifies only contracts owned by planr-pipeline: package exports,
 * schemas, generated schema custody, server/bootstrap wiring, source hygiene,
 * and removal of the retired package-owned client. Product usability and visual
 * behavior belong to OpenPlanr's real-browser suite and are intentionally not
 * inferred from constants or a sibling source checkout here.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

function assertExactMembers(actual, expected, label) {
  assert.deepEqual([...new Set(actual)].sort(), [...expected].sort(), label);
}

function resolvePackageTarget(target) {
  assert.equal(typeof target, 'string', 'package export target must be a string');
  assert.equal(isAbsolute(target), false, `package export must be relative: ${target}`);
  const filesystemTarget = target.includes('*') ? target.slice(0, target.indexOf('*')) : target;
  const absolute = resolve(root, filesystemTarget);
  const fromRoot = relative(root, absolute);
  assert.ok(
    fromRoot !== '' && !fromRoot.startsWith('..'),
    `package export escapes package root: ${target}`,
  );
  assert.equal(existsSync(absolute), true, `package export target is missing: ${target}`);
}

function* walkFiles(relativePath) {
  const absolute = join(root, relativePath);
  if (!existsSync(absolute)) return;
  const stat = statSync(absolute);
  if (stat.isFile()) {
    yield relativePath;
    return;
  }
  for (const entry of readdirSync(absolute)) {
    yield* walkFiles(join(relativePath, entry));
  }
}

const requiredFiles = [
  'lib/dashboard/server.mjs',
  'lib/dashboard/resolve-packaged-dashboard-root.mjs',
  'lib/dashboard/verified-json.mjs',
  'lib/dashboard/verified-json.d.mts',
  'lib/dashboard/operate-experience-reader.mjs',
  'lib/dashboard/operate-experience-reader.d.mts',
  'lib/dashboard/operate-experience-display-contract.mjs',
  'lib/dashboard/operate-experience-display-contract.d.mts',
  'lib/dashboard/operate-experience-audit-display-contract.mjs',
  'lib/dashboard/operate-experience-audit-display-contract.d.mts',
  'lib/dashboard/generated/operate-experience-surface-schema-data.mjs',
  'lib/dashboard/generated/operate-review-schema-data.mjs',
  'lib/dashboard/generated/operate-schema-token-codec.mjs',
  'lib/dashboard/operate-review-contract.mjs',
  'lib/dashboard/operate-review-contract.d.mts',
  'scripts/generate-dashboard-surface-schema-data.mjs',
  'schemas/v1.0.0/graph.schema.json',
  'schemas/v1.2.0/dashboard-bootstrap.schema.json',
];

for (const relativePath of requiredFiles) {
  assert.equal(
    existsSync(join(root, relativePath)),
    true,
    `required dashboard contract is missing: ${relativePath}`,
  );
}

const packageJson = readJson('package.json');
assert.ok(packageJson.files.includes('lib/'), 'package files must include lib/');
assert.ok(packageJson.files.includes('schemas/'), 'package files must include schemas/');

const requiredExports = [
  '.',
  './dashboard/operate-experience-reader',
  './dashboard/operate-experience-audit-display-contract',
  './dashboard/resolve-packaged-dashboard-root',
  './dashboard/verified-json',
  './schemas/*',
];
for (const key of requiredExports) {
  assert.ok(Object.hasOwn(packageJson.exports, key), `required package export is missing: ${key}`);
  const descriptor = packageJson.exports[key];
  if (typeof descriptor === 'string') {
    resolvePackageTarget(descriptor);
  } else {
    for (const target of Object.values(descriptor)) resolvePackageTarget(target);
  }
}

const packageRootExport = packageJson.exports['.'];
const packageRootImport =
  typeof packageRootExport === 'string'
    ? packageRootExport
    : (packageRootExport.import ?? packageRootExport.default);
assert.equal(typeof packageRootImport, 'string', 'package root must expose an import target');
const publicModule = await import(pathToFileURL(join(root, packageRootImport)).href);
assert.equal(
  typeof publicModule.startDashboard,
  'function',
  'public package root must export startDashboard',
);

const verifiedJson = await import('planr-pipeline/dashboard/verified-json');
assert.equal(
  typeof verifiedJson.canonicalizeJson,
  'function',
  'verified JSON export must expose canonicalizeJson',
);
assert.equal(
  typeof verifiedJson.sha256Jcs,
  'function',
  'verified JSON export must expose sha256Jcs',
);
assert.match(verifiedJson.sha256Jcs({ openplanr: true }), /^sha256:[a-f0-9]{64}$/u);
let accessorEvaluated = false;
const hostileJson = {};
Object.defineProperty(hostileJson, 'privateValue', {
  enumerable: true,
  get() {
    accessorEvaluated = true;
    return 'must-not-be-read';
  },
});
assert.throws(
  () => verifiedJson.canonicalizeJson(hostileJson),
  /enumerable data properties/u,
  'verified JSON must reject accessors instead of evaluating them',
);
assert.equal(accessorEvaluated, false, 'verified JSON evaluated an accessor');

const graphSchema = readJson('schemas/v1.0.0/graph.schema.json');
assert.equal(typeof graphSchema.$id, 'string', 'graph schema must declare an id');

const bootstrapSchema = readJson('schemas/v1.2.0/dashboard-bootstrap.schema.json');
assert.equal(bootstrapSchema.properties?.kind?.const, 'dashboard-bootstrap');
assert.ok(
  bootstrapSchema.required.includes('queryRoots'),
  'dashboard bootstrap must require queryRoots',
);
assert.equal(bootstrapSchema.properties?.queryRoots?.additionalProperties, false);
assertExactMembers(
  bootstrapSchema.properties?.queryRoots?.required ?? [],
  ['planning', 'operate'],
  'dashboard bootstrap must expose exactly the Planning and Operate query roots',
);
assertExactMembers(
  bootstrapSchema.$defs?.queryRoot?.required ?? [],
  ['actorId', 'projectId', 'scopeId', 'domainId', 'domainVersion', 'generation'],
  'query-root identity fields drifted',
);
for (const area of ['planning', 'operate']) {
  assert.deepEqual(
    bootstrapSchema.properties.queryRoots.properties[area].oneOf,
    [{ type: 'null' }, { $ref: '#/$defs/queryRoot' }],
    `${area} query root must be null or the closed query-root contract`,
  );
}

const serverSource = readFileSync(join(root, 'lib/dashboard/server.mjs'), 'utf8');
assert.match(
  serverSource,
  /queryRoots:\s*dashboardQueryRoots\(\)/,
  'server bootstrap must publish owner-issued query roots',
);

const generation = spawnSync(
  process.execPath,
  ['scripts/generate-dashboard-surface-schema-data.mjs', '--check'],
  { cwd: root, encoding: 'utf8' },
);
assert.equal(
  generation.status,
  0,
  generation.stderr || generation.stdout || 'generated dashboard schema data is stale',
);

const retiredClientRoot = join(root, 'lib/dashboard/app');
const retiredFiles = existsSync(retiredClientRoot) ? [...walkFiles('lib/dashboard/app')] : [];
assert.deepEqual(
  retiredFiles,
  [],
  `retired package-owned dashboard client remains: ${retiredFiles.join(', ')}`,
);

const scannedFiles = [...walkFiles('lib/dashboard')];
const forbiddenSourcePatterns = [
  {
    pattern: /(?:^|[/'"])(?:\.\.\/)+OpenPlanr(?:[/'"]|$)/m,
    label: 'sibling OpenPlanr source dependency',
  },
  { pattern: /\/Users\//, label: 'machine-specific absolute path' },
  { pattern: /about:blank/, label: 'synthetic blank-page browser proof' },
];
for (const relativePath of scannedFiles) {
  const source = readFileSync(join(root, relativePath), 'utf8');
  for (const { pattern, label } of forbiddenSourcePatterns) {
    assert.equal(pattern.test(source), false, `${label} found in ${relativePath}`);
  }
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    scope: 'planr-pipeline-owned dashboard structure',
    requiredFiles: requiredFiles.length,
    checkedExports: requiredExports.length,
    checkedSourceFiles: scannedFiles.length,
    usabilityCertified: false,
  })}\n`,
);
