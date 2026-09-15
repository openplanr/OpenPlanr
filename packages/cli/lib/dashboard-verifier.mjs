import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_FILE = 'dashboard-manifest.json';
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

// Bundle ceilings sized for the token-driven console redesign. They stay real
// integrity guards (a runaway bundle still fails) but no longer gate ordinary
// design work. This file is an intentional post-cutoff overlay; its divergence
// from the source cutoff is recorded in the migration preservation catalog.
export const DASHBOARD_BUNDLE_BUDGETS = Object.freeze({
  maxJavaScriptBytes: 2_000_000,
  maxCssBytes: 400_000,
  maxRuntimeAssetBytes: 2_500_000,
  maxSourceMapBytes: 8_000_000,
});

export const DASHBOARD_ASSET_ERROR_CODES = Object.freeze({
  MISSING: 'E_DASHBOARD_ASSETS_MISSING',
  MANIFEST_INVALID: 'E_DASHBOARD_MANIFEST_INVALID',
  ASSETS_INVALID: 'E_DASHBOARD_ASSETS_INVALID',
});

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function declaredAssetPaths(manifest, violations) {
  const entryIsValid = typeof manifest.entry === 'string' && manifest.entry === 'index.html';
  if (!entryIsValid) violations.push('dashboard manifest entry must be index.html');

  const assetsAreValid = Array.isArray(manifest.assets)
    && manifest.assets.length > 0
    && manifest.assets.every((asset) => typeof asset === 'string' && asset.length > 0);
  if (!assetsAreValid) {
    violations.push('dashboard manifest assets must be a non-empty array of paths');
  }
  if (!entryIsValid || !assetsAreValid) return [];

  const assets = manifest.assets;
  const sortedAssets = [...assets].sort();
  if (!sameValues(assets, sortedAssets)) {
    violations.push('dashboard manifest assets must be in canonical order');
  }

  const declared = [manifest.entry, ...assets];
  if (new Set(declared).size !== declared.length) {
    violations.push('dashboard manifest assets must not contain duplicate paths');
    return [];
  }
  return declared;
}

function expectedAssetDigests(manifest, declared, violations) {
  if (!isRecord(manifest.assetDigests)) {
    violations.push('dashboard manifest assetDigests must be an object');
    return new Map();
  }

  const digestPaths = Object.keys(manifest.assetDigests);
  const canonicalPaths = [...digestPaths].sort();
  if (!sameValues(digestPaths, canonicalPaths)) {
    violations.push('dashboard manifest assetDigests must be in canonical order');
  }
  const expectedPaths = [...declared].sort();
  if (!sameValues(canonicalPaths, expectedPaths)) {
    violations.push('dashboard manifest assetDigests must cover exactly the declared assets');
  }

  const digests = new Map();
  for (const asset of declared) {
    const digest = manifest.assetDigests[asset];
    if (
      !isRecord(digest)
      || Object.keys(digest).length !== 2
      || !Object.hasOwn(digest, 'bytes')
      || !Object.hasOwn(digest, 'sha256')
      || !Number.isSafeInteger(digest.bytes)
      || digest.bytes < 0
      || typeof digest.sha256 !== 'string'
      || !SHA256.test(digest.sha256)
    ) {
      violations.push(`dashboard manifest asset digest is invalid: ${safeAssetPath(asset)}`);
      continue;
    }
    digests.set(asset, digest);
  }
  return digests;
}

function safeAssetPath(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,511}$/u.test(value)
    ? value
    : '<invalid-asset-path>';
}

function listFiles(directory, outputRoot, violations) {
  const entries = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink()) {
      const asset = safeAssetPath(relative(outputRoot, absolute).split(sep).join('/'));
      violations.push(`dashboard output contains a symbolic link: ${asset}`);
      continue;
    }
    if (entry.isDirectory()) entries.push(...listFiles(absolute, outputRoot, violations));
    else if (entry.isFile()) entries.push(absolute);
  }
  return entries;
}

function classifyAsset(path) {
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'javascript';
  if (path.endsWith('.css')) return 'css';
  return 'other';
}

function emptySizes() {
  return { javascript: 0, css: 0, other: 0, sourceMap: 0, runtime: 0, total: 0 };
}

function failureReport(code, problem, violations, sizes = emptySizes()) {
  return Object.freeze({
    ok: false,
    code,
    problem,
    root: 'dashboard',
    violations: Object.freeze([...violations]),
    buildId: null,
    assetManifestHash: null,
    assets: Object.freeze([]),
    sizes: Object.freeze({ ...sizes }),
  });
}

function failureCode(violations) {
  if (violations.some((violation) => violation.startsWith('manifest asset is missing:'))) {
    return DASHBOARD_ASSET_ERROR_CODES.MISSING;
  }
  if (violations.some((violation) => /manifest/u.test(violation))) {
    return DASHBOARD_ASSET_ERROR_CODES.MANIFEST_INVALID;
  }
  return DASHBOARD_ASSET_ERROR_CODES.ASSETS_INVALID;
}

function failureProblem(code) {
  if (code === DASHBOARD_ASSET_ERROR_CODES.MISSING) {
    return 'The installed OpenPlanr dashboard assets are incomplete.';
  }
  if (code === DASHBOARD_ASSET_ERROR_CODES.MANIFEST_INVALID) {
    return 'The installed OpenPlanr dashboard manifest is invalid.';
  }
  return 'The installed OpenPlanr dashboard assets failed integrity verification.';
}

/** Verify an installed OpenPlanr dashboard manifest, asset custody, and bundle budgets. */
export function verifyDashboardAssets(root = join(packageRoot, 'dist/dashboard')) {
  const requestedRoot = resolve(root);
  if (!existsSync(requestedRoot)) {
    return failureReport(
      DASHBOARD_ASSET_ERROR_CODES.MISSING,
      failureProblem(DASHBOARD_ASSET_ERROR_CODES.MISSING),
      ['dashboard output directory is missing'],
    );
  }
  const requestedStat = lstatSync(requestedRoot);
  if (requestedStat.isSymbolicLink() || !requestedStat.isDirectory()) {
    return failureReport(
      DASHBOARD_ASSET_ERROR_CODES.ASSETS_INVALID,
      failureProblem(DASHBOARD_ASSET_ERROR_CODES.ASSETS_INVALID),
      ['dashboard output root must be one real directory'],
    );
  }
  const outputRoot = realpathSync(requestedRoot);
  const violations = [];
  const manifestPath = join(outputRoot, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    return failureReport(
      DASHBOARD_ASSET_ERROR_CODES.MISSING,
      failureProblem(DASHBOARD_ASSET_ERROR_CODES.MISSING),
      ['dashboard-manifest.json is missing'],
    );
  }

  const manifestBytes = readFileSync(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    violations.push('dashboard-manifest.json is not valid JSON');
    manifest = null;
  }
  const assets = [];
  const sizes = emptySizes();
  if (!isRecord(manifest)) {
    if (manifest) violations.push('dashboard-manifest.json must contain an object');
    return failureReport(
      DASHBOARD_ASSET_ERROR_CODES.MANIFEST_INVALID,
      failureProblem(DASHBOARD_ASSET_ERROR_CODES.MANIFEST_INVALID),
      violations,
      sizes,
    );
  }

  if (manifest.kind !== 'openplanr-dashboard-build' || manifest.schemaVersion !== '1.0.0') {
    violations.push('dashboard manifest kind or schemaVersion is invalid');
  }
  if (typeof manifest.buildId !== 'string' || manifest.buildId.length === 0) {
    violations.push('dashboard manifest buildId is missing');
  }
  const declared = declaredAssetPaths(manifest, violations);
  const expectedDigests = expectedAssetDigests(manifest, declared, violations);
  const declaredSet = new Set(declared);
  for (const asset of declared) {
    if (asset.length === 0 || isAbsolute(asset)) {
      violations.push(`manifest asset path is unsafe: ${safeAssetPath(asset)}`);
      continue;
    }
    const lexical = resolve(outputRoot, asset);
    const rel = relative(outputRoot, lexical);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      violations.push(`manifest asset path is unsafe: ${safeAssetPath(asset)}`);
      continue;
    }
    if (!existsSync(lexical) || !lstatSync(lexical).isFile()) {
      violations.push(`manifest asset is missing: ${safeAssetPath(asset)}`);
      continue;
    }
    const real = realpathSync(lexical);
    const realRel = relative(outputRoot, real);
    if (realRel === '..' || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
      violations.push(`manifest asset path is unsafe: ${safeAssetPath(asset)}`);
      continue;
    }
    const bytes = readFileSync(real);
    const kind = classifyAsset(asset);
    const digest = sha256(bytes);
    const expected = expectedDigests.get(asset);
    if (expected && (expected.bytes !== bytes.length || expected.sha256 !== digest)) {
      violations.push(`manifest asset digest mismatch: ${safeAssetPath(asset)}`);
    }
    sizes[kind] += bytes.length;
    sizes.total += bytes.length;
    if (asset.endsWith('.map')) sizes.sourceMap += bytes.length;
    else sizes.runtime += bytes.length;
    assets.push(Object.freeze({ path: asset, bytes: bytes.length, sha256: digest, kind }));
  }

  const extraFiles = listFiles(outputRoot, outputRoot, violations).filter((absolute) => {
    const rel = relative(outputRoot, absolute).split(sep).join('/');
    return rel !== MANIFEST_FILE && !declaredSet.has(rel) && !rel.startsWith('.vite/');
  });
  if (extraFiles.length > 0) {
    violations.push(`unexpected files exist outside the manifest: ${extraFiles.length}`);
  }
  if (sizes.javascript > DASHBOARD_BUNDLE_BUDGETS.maxJavaScriptBytes) {
    violations.push(
      `javascript bundle ${sizes.javascript} exceeds ${DASHBOARD_BUNDLE_BUDGETS.maxJavaScriptBytes}`,
    );
  }
  if (sizes.css > DASHBOARD_BUNDLE_BUDGETS.maxCssBytes) {
    violations.push(`css bundle ${sizes.css} exceeds ${DASHBOARD_BUNDLE_BUDGETS.maxCssBytes}`);
  }
  if (sizes.runtime > DASHBOARD_BUNDLE_BUDGETS.maxRuntimeAssetBytes) {
    violations.push(
      `runtime assets ${sizes.runtime} exceeds ${DASHBOARD_BUNDLE_BUDGETS.maxRuntimeAssetBytes}`,
    );
  }
  if (sizes.sourceMap > DASHBOARD_BUNDLE_BUDGETS.maxSourceMapBytes) {
    violations.push(
      `source maps ${sizes.sourceMap} exceeds ${DASHBOARD_BUNDLE_BUDGETS.maxSourceMapBytes}`,
    );
  }
  const indexPath = join(outputRoot, 'index.html');
  if (existsSync(indexPath) && lstatSync(indexPath).isFile()) {
    const indexHtml = readFileSync(indexPath, 'utf8');
    if (!indexHtml.includes('id="root"')) {
      violations.push('index.html does not expose the dashboard root mount point');
    }
    if (/\/(?:Users|home|opt)\//u.test(indexHtml)) {
      violations.push('index.html leaks a private machine path');
    }
  }
  const code = violations.length > 0 ? failureCode(violations) : null;
  return Object.freeze({
    ok: code === null,
    code,
    problem: code === null ? null : failureProblem(code),
    root: 'dashboard',
    violations: Object.freeze([...violations]),
    buildId: manifest.buildId ?? null,
    assetManifestHash: sha256(manifestBytes),
    assets: Object.freeze(assets),
    sizes: Object.freeze({ ...sizes }),
  });
}
