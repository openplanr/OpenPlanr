/** Server, build and project identity: package version, static root, build manifest and project descriptor. */

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { exactKeys } from './planning.mjs';
import { resolvePackagedDashboardRoot } from './platform.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Identifies a dashboard server on /health so a reuse probe never adopts a foreign process. */
export const DASHBOARD_SERVER_KIND = 'openplanr-dashboard';

/**
 * The dashboard's view ids, in rail order (design-spec §4). The client shell
 * uses this list to pre-select the landing view and to keep the hash router and
 * the server's notion of "known views" from drifting (one source of truth).
 */
export const DASHBOARD_VIEWS = [
  'overview',
  'graph',
  'board',
  'list',
  'sprints',
  'activity',
  'operate',
];

/** The landing view the client pre-activates on first load. */
export const DEFAULT_VIEW = 'overview';
const DASHBOARD_MANIFEST_FILE = 'dashboard-manifest.json';
export const DASHBOARD_BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const DASHBOARD_MANIFEST_LEGACY_KEYS = Object.freeze([
  'assets',
  'buildId',
  'entry',
  'kind',
  'schemaVersion',
]);
const DASHBOARD_MANIFEST_DIGEST_KEYS = Object.freeze([
  ...DASHBOARD_MANIFEST_LEGACY_KEYS,
  'assetDigests',
]);
const DASHBOARD_ASSET_DIGEST_KEYS = Object.freeze(['bytes', 'sha256']);
const DASHBOARD_ASSET_SHA256 = /^sha256:[a-f0-9]{64}$/u;

/**
 * Read the plugin version from the package's package.json (../../../ from this module).
 * Cached after first read; falls back to "0.0.0" if the file is missing/invalid
 * so /api/meta never throws (the route stays a 200 with a best-effort version).
 */
let versionCache;
export function readPackageVersion() {
  if (versionCache !== undefined) return versionCache;
  try {
    const pkgPath = join(here, '..', '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    versionCache = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    versionCache = '0.0.0';
  }
  return versionCache;
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function isPublicProjectName(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160) return false;
  return [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 31 && (codePoint < 127 || codePoint > 159);
  });
}

export function safeProjectMetadata(planrDir) {
  let projectName = 'OpenPlanr project';
  try {
    const config = JSON.parse(readFileSync(join(planrDir, 'config.json'), 'utf8'));
    if (isPublicProjectName(config?.projectName)) {
      projectName = config.projectName;
    }
  } catch {
    // A fixed display fallback cannot disclose the private repository path.
  }
  let stableRoot;
  try {
    stableRoot = realpathSync(dirname(planrDir));
  } catch {
    stableRoot = resolve(dirname(planrDir));
  }
  return Object.freeze({
    // The digest distinguishes equal display names without disclosing the local path.
    projectId: sha256(Buffer.from(`${stableRoot}\0${projectName}`, 'utf8')),
    name: projectName,
    branch: readGitBranch(dirname(planrDir)).slice(0, 255),
    products: Object.freeze(['planning', 'operate']),
  });
}

function validDashboardAssetDigests(manifest) {
  const paths = [manifest.entry, ...manifest.assets].sort();
  if (
    manifest.assetDigests === null ||
    typeof manifest.assetDigests !== 'object' ||
    Array.isArray(manifest.assetDigests) ||
    JSON.stringify(Object.keys(manifest.assetDigests)) !== JSON.stringify(paths)
  )
    return false;
  return paths.every((path) => {
    const digest = manifest.assetDigests[path];
    return (
      exactKeys(digest, DASHBOARD_ASSET_DIGEST_KEYS) &&
      Number.isSafeInteger(digest.bytes) &&
      digest.bytes >= 0 &&
      typeof digest.sha256 === 'string' &&
      DASHBOARD_ASSET_SHA256.test(digest.sha256)
    );
  });
}

export function dashboardManifestState(staticRoot) {
  const manifestPath = join(staticRoot, DASHBOARD_MANIFEST_FILE);
  let manifestBytes;
  try {
    const lexical = lstatSync(manifestPath);
    const real = realpathSync(manifestPath);
    const rel = relative(staticRoot, real);
    if (
      lexical.isSymbolicLink() ||
      !lexical.isFile() ||
      rel === '..' ||
      rel.startsWith(`..${sep}`) ||
      isAbsolute(rel)
    ) {
      return {
        buildId: null,
        assetManifestHash: null,
        reasonCodes: ['DASHBOARD_MANIFEST_INVALID'],
      };
    }
    manifestBytes = readFileSync(real);
  } catch {
    return { buildId: null, assetManifestHash: null, reasonCodes: ['DASHBOARD_MANIFEST_MISSING'] };
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    return {
      buildId: null,
      assetManifestHash: sha256(manifestBytes),
      reasonCodes: ['DASHBOARD_MANIFEST_INVALID'],
    };
  }
  const hasAssetDigests = Object.hasOwn(manifest, 'assetDigests');
  if (
    !exactKeys(
      manifest,
      hasAssetDigests ? DASHBOARD_MANIFEST_DIGEST_KEYS : DASHBOARD_MANIFEST_LEGACY_KEYS,
    ) ||
    manifest.kind !== 'openplanr-dashboard-build' ||
    manifest.schemaVersion !== '1.0.0' ||
    !DASHBOARD_BUILD_ID.test(manifest.buildId) ||
    manifest.entry !== 'index.html' ||
    !Array.isArray(manifest.assets) ||
    new Set(manifest.assets).size !== manifest.assets.length ||
    manifest.assets.some((asset) => typeof asset !== 'string' || asset.length === 0) ||
    (hasAssetDigests &&
      (JSON.stringify(manifest.assets) !== JSON.stringify([...manifest.assets].sort()) ||
        manifest.assets.includes(manifest.entry) ||
        manifest.assets.includes(DASHBOARD_MANIFEST_FILE) ||
        manifest.assets.includes('.vite/manifest.json') ||
        !validDashboardAssetDigests(manifest)))
  ) {
    return {
      buildId: null,
      assetManifestHash: sha256(manifestBytes),
      reasonCodes: ['DASHBOARD_MANIFEST_INVALID'],
    };
  }
  try {
    for (const asset of [manifest.entry, ...manifest.assets]) {
      const lexical = resolve(staticRoot, asset);
      const rel = relative(staticRoot, lexical);
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error();
      const lexicalStat = lstatSync(lexical);
      const real = realpathSync(lexical);
      const realRel = relative(staticRoot, real);
      if (
        lexicalStat.isSymbolicLink() ||
        !lexicalStat.isFile() ||
        realRel === '..' ||
        realRel.startsWith(`..${sep}`) ||
        isAbsolute(realRel) ||
        !statSync(real).isFile()
      )
        throw new Error();
      if (hasAssetDigests) {
        const bytes = readFileSync(real);
        const expected = manifest.assetDigests[asset];
        if (bytes.byteLength !== expected.bytes || sha256(bytes) !== expected.sha256) {
          return {
            buildId: manifest.buildId,
            assetManifestHash: sha256(manifestBytes),
            reasonCodes: ['DASHBOARD_MANIFEST_INVALID'],
          };
        }
      }
    }
  } catch {
    return {
      buildId: manifest.buildId,
      assetManifestHash: sha256(manifestBytes),
      reasonCodes: ['DASHBOARD_ASSET_MISSING'],
    };
  }
  return { buildId: manifest.buildId, assetManifestHash: sha256(manifestBytes), reasonCodes: [] };
}

/**
 * Best-effort current git branch for the workspace card. Reads `.git/HEAD`
 * directly (no subprocess) and parses `ref: refs/heads/<branch>`; falls back to
 * 'main' on a detached HEAD, a worktree gitfile, or any read error.
 * @param {string} repoRoot the repository root (the dir containing `.planr`)
 * @returns {string}
 */
export function readGitBranch(repoRoot) {
  try {
    const head = readFileSync(join(repoRoot, '.git', 'HEAD'), 'utf-8').trim();
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return m ? m[1] : 'main';
  } catch {
    return 'main';
  }
}

/** Resolve the packaged unified dashboard root on demand. */
export function defaultDashboardStaticRoot(env = process.env) {
  return resolvePackagedDashboardRoot(env);
}

/**
 * Validate a caller-owned dashboard static root before the server is created.
 *
 * The root is a closed interface: it must be an absolute, real directory with
 * a regular, real `index.html` directly beneath it. Symlink roots and symlinked
 * entry files are refused so an installed package cannot switch content after
 * validation. Individual asset requests still pass through `serveStaticFile`,
 * which proves real-path containment for every response.
 */
export function resolveDashboardStaticRoot(staticRoot) {
  const resolvedRoot = staticRoot ?? defaultDashboardStaticRoot();
  if (typeof resolvedRoot !== 'string' || resolvedRoot.length === 0 || !isAbsolute(resolvedRoot)) {
    throw new TypeError('dashboard staticRoot must be a non-empty absolute path');
  }

  const lexicalRoot = resolve(resolvedRoot);
  let realRoot;
  try {
    realRoot = realpathSync(lexicalRoot);
  } catch {
    throw new Error('dashboard staticRoot does not exist');
  }
  if (lstatSync(lexicalRoot).isSymbolicLink()) {
    throw new Error('dashboard staticRoot must not be a symbolic link');
  }
  if (!statSync(realRoot).isDirectory()) {
    throw new Error('dashboard staticRoot must be a directory');
  }

  const lexicalEntry = join(realRoot, 'index.html');
  let realEntry;
  try {
    realEntry = realpathSync(lexicalEntry);
  } catch {
    throw new Error('dashboard staticRoot must contain index.html');
  }
  const entryRelative = relative(realRoot, realEntry);
  if (
    lstatSync(lexicalEntry).isSymbolicLink() ||
    entryRelative === '..' ||
    entryRelative.startsWith(`..${sep}`) ||
    isAbsolute(entryRelative) ||
    !statSync(realEntry).isFile()
  ) {
    throw new Error('dashboard staticRoot index.html must be a contained regular file');
  }

  return realRoot;
}
