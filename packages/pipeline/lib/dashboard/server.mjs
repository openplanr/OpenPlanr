/**
 * Dashboard HTTP server.
 *
 * A persistent localhost server for the planr dashboard, following the same
 * agent-independent daemon pattern as lib/design-engine/daemon.mjs: the dashboard
 * keeps serving if the launching agent dies, and a second launch on the same port
 * reuses the running server instead of double-binding.
 *
 * Routes (graph data comes from lib/dashboard/graph-engine.mjs):
 *   GET /api/graph      → typed project graph { nodes, edges }   (application/json)
 *   GET /api/node/:id   → a single node with body                (application/json)
 *   GET /api/meta       → { version, planrDir, views, defaultView } (application/json)
 *   GET /api/events     → SSE stream, emits a `ready` event (text/event-stream)
 *   GET /api/operate/*  → bound product views + ordered live patches
 *   GET /health         → { ok, pid }                 (reuse-if-running probe)
 *   GET /*              → static asset from the unified OpenPlanr dashboard build
 *                         (traversal-guarded; see resolve-packaged-dashboard-root.mjs)
 *
 * State: <planrHome>/dashboard-daemon/{port} PID file (reuse detection) +
 * <planrHome>/dashboard-daemon/port (last bound port, discovery).
 *
 * Stdlib only — no npm runtime dependency. Live sync: when watching is
 * enabled the server starts lib/dashboard/watcher.mjs, keeps an in-memory
 * `currentGraph` cache that the watcher's diff events patch, and broadcasts each
 * patch to every open /api/events SSE client. `--no-watch` suppresses startup.
 */

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { types as utilTypes } from 'node:util';

import {
  assertDashboardBootstrapV1,
  assertOperateExperienceArtifactV2,
  assertOperateExperienceDisplaySurfaceV1,
  assertOperateExperiencePreviewV1,
  assertOperateExperienceTransportView,
  assertOperateReviewDisplayWorkspaceV1,
  assertOperatingReviewReceiptV2,
  buildOperateExperienceLivePatchV2,
  buildOperateExperienceTransportView,
  decodeOperateExperienceCheckpoint,
  encodeOperateExperienceCheckpoint,
  readLocalOperateReview,
  readLocalOperateReviewIndex,
  readOperateExperienceProjection,
  readOperatingProjection,
  selectOperateActionDisplayWorkspace,
  selectOperateCycleDisplayWorkspace,
  selectOperateExecutiveBoardDisplay,
  selectOperateExperienceAuditDisplaySurface,
  selectOperateExperienceDisplaySurface,
  selectOperateExperienceSurface,
  selectOperateInboxItemDisplaySurface,
  selectOperateRecoveryDisplay,
  sha256Jcs,
} from './server/operate.mjs';
import {
  assertPlanningGraph,
  assertPlanningNode,
  buildGraph,
  detectMode,
  engineGetNode,
} from './server/planning.mjs';
import {
  assertLoopbackRequest,
  createWatcher,
  listenLoopback,
  MIME,
  planrHome,
  probeLoopbackJson,
  resolvePackagedDashboardRoot,
  serveStaticFile,
  writePidFile,
} from './server/platform.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_PORT = 7473;

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
const DASHBOARD_BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
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

/** Resolve the `.planr/` directory for a project root (default: <cwd>/.planr). */
export function resolvePlanrDir(projectRoot = process.cwd()) {
  return join(projectRoot, '.planr');
}

/**
 * Read the plugin version from the repo's package.json (../../ from this module).
 * Cached after first read; falls back to "0.0.0" if the file is missing/invalid
 * so /api/meta never throws (the route stays a 200 with a best-effort version).
 */
let versionCache;
function readPackageVersion() {
  if (versionCache !== undefined) return versionCache;
  try {
    const pkgPath = join(here, '..', '..', 'package.json');
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

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

function isPublicProjectName(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160) return false;
  return [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 31 && (codePoint < 127 || codePoint > 159);
  });
}

function safeProjectMetadata(planrDir) {
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

function dashboardManifestState(staticRoot) {
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
function readGitBranch(repoRoot) {
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

/** Per-process state dir for the dashboard daemon (mirrors design-daemon). */
export function dashboardDir(env = process.env) {
  return join(planrHome(env), 'dashboard-daemon');
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const planningJson = (res, code, body) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
};

const experienceJson = (res, code, body) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
};

export const DASHBOARD_SAFE_ERROR_CODES = Object.freeze([
  'DASHBOARD_ERROR_UNAVAILABLE',
  'DASHBOARD_LOOPBACK_HOST_INVALID',
  'DASHBOARD_BOOTSTRAP_INVALID',
  'CAPABILITY_DENIED',
  'DASHBOARD_BUILD_MISMATCH',
  'DASHBOARD_RESPONSE_INVALID',
  'CONCURRENT_MODIFICATION',
  'OPERATION_UNCERTAIN',
  'DASHBOARD_ASSET_MISSING',
  'DASHBOARD_MANIFEST_INVALID',
  'DASHBOARD_MANIFEST_MISSING',
  'DASHBOARD_READ_FAILED',
  'DASHBOARD_STALE_RESPONSE',
  'OPERATION_CONFLICT',
]);
const DASHBOARD_SAFE_ERROR_CODE_SET = new Set(DASHBOARD_SAFE_ERROR_CODES);
export const DASHBOARD_SAFE_CONTEXT_FIELDS = Object.freeze([
  'operation',
  'cycleId',
  'assignmentId',
  'submissionId',
  'submissionState',
  'reviewId',
  'state',
  'maxBytes',
]);
const DASHBOARD_SAFE_CONTEXT_FIELD_SET = new Set(DASHBOARD_SAFE_CONTEXT_FIELDS);
const DASHBOARD_SAFE_OPERATION =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*){1,7}$/u;
const DASHBOARD_PRIVATE_OPERATION_SEGMENTS = new Set(['private', 'secret']);
const DASHBOARD_SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DASHBOARD_SAFE_STATE = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+){0,7}$/u;
const DASHBOARD_SAFE_CONTEXT_TEXT_LENGTH = 160;
const DASHBOARD_SAFE_MAX_BYTES = 16 * 1024 * 1024;

function dashboardSafeOperation(value) {
  return (
    typeof value === 'string' &&
    value.length <= DASHBOARD_SAFE_CONTEXT_TEXT_LENGTH &&
    DASHBOARD_SAFE_OPERATION.test(value) &&
    !value.split(/[.-]/u).some((segment) => DASHBOARD_PRIVATE_OPERATION_SEGMENTS.has(segment))
  );
}
const DASHBOARD_SAFE_ERROR_FALLBACK = Object.freeze({
  code: 'DASHBOARD_ERROR_UNAVAILABLE',
  retryable: false,
  context: Object.freeze({}),
});

function safeDashboardErrorRecord(value, allowInternalError = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return null;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (
      prototype !== Object.prototype &&
      prototype !== null &&
      !(allowInternalError && value instanceof Error)
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).some(
        (key) =>
          typeof key !== 'string' ||
          descriptors[key]?.get !== undefined ||
          descriptors[key]?.set !== undefined,
      )
    )
      return null;
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
    );
  } catch {
    return null;
  }
}

function dashboardSafeErrorContext(value) {
  if (value === undefined || value === null) return Object.freeze({});
  const source = safeDashboardErrorRecord(value);
  if (!source) return null;
  const context = {};
  for (const key of DASHBOARD_SAFE_CONTEXT_FIELDS) {
    if (!Object.hasOwn(source, key)) continue;
    const candidate = source[key];
    if (key === 'maxBytes') {
      if (!Number.isSafeInteger(candidate) || candidate < 0 || candidate > DASHBOARD_SAFE_MAX_BYTES)
        return null;
      context[key] = candidate;
    } else {
      const valid =
        key === 'operation'
          ? dashboardSafeOperation(candidate)
          : typeof candidate === 'string' &&
            candidate.length <= DASHBOARD_SAFE_CONTEXT_TEXT_LENGTH &&
            (key.endsWith('State') || key === 'state'
              ? DASHBOARD_SAFE_STATE
              : DASHBOARD_SAFE_ID
            ).test(candidate);
      if (!valid) return null;
      context[key] = candidate;
    }
  }
  return Object.freeze(context);
}

/**
 * Map an arbitrary internal failure to the closed dashboard wire contract.
 * Messages, stacks, paths, nested bodies, and non-allowlisted context are never echoed.
 */
export function mapDashboardSafeError(error) {
  const source = safeDashboardErrorRecord(error, true);
  if (!source || typeof source.code !== 'string' || !DASHBOARD_SAFE_ERROR_CODE_SET.has(source.code))
    return DASHBOARD_SAFE_ERROR_FALLBACK;
  const context = dashboardSafeErrorContext(source.context);
  if (!context) return DASHBOARD_SAFE_ERROR_FALLBACK;
  return Object.freeze({
    code: source.code,
    retryable: typeof source.retryable === 'boolean' ? source.retryable : false,
    context,
  });
}

/** Validate exact server/client parity for the public safe-error output. */
export function assertDashboardSafeError(value) {
  const source = safeDashboardErrorRecord(value);
  if (
    !source ||
    Object.keys(source).sort().join(',') !== 'code,context,retryable' ||
    typeof source.code !== 'string' ||
    !DASHBOARD_SAFE_ERROR_CODE_SET.has(source.code) ||
    typeof source.retryable !== 'boolean'
  ) {
    throw new TypeError('Invalid dashboard safe error.');
  }
  const context = safeDashboardErrorRecord(source.context);
  if (!context || Object.keys(context).some((key) => !DASHBOARD_SAFE_CONTEXT_FIELD_SET.has(key))) {
    throw new TypeError('Invalid dashboard safe error.');
  }
  for (const [key, candidate] of Object.entries(context)) {
    if (key === 'maxBytes') {
      if (
        !Number.isSafeInteger(candidate) ||
        candidate < 0 ||
        candidate > DASHBOARD_SAFE_MAX_BYTES
      ) {
        throw new TypeError('Invalid dashboard safe error.');
      }
    } else {
      const valid =
        key === 'operation'
          ? dashboardSafeOperation(candidate)
          : typeof candidate === 'string' &&
            candidate.length <= DASHBOARD_SAFE_CONTEXT_TEXT_LENGTH &&
            (key.endsWith('State') || key === 'state'
              ? DASHBOARD_SAFE_STATE
              : DASHBOARD_SAFE_ID
            ).test(candidate);
      if (!valid) {
        throw new TypeError('Invalid dashboard safe error.');
      }
    }
  }
  const canonicalContext = dashboardSafeErrorContext(context);
  if (!canonicalContext) throw new TypeError('Invalid dashboard safe error.');
  return Object.freeze({
    code: source.code,
    retryable: source.retryable,
    context: canonicalContext,
  });
}

const dashboardSafeErrorJson = (res, status, error) =>
  experienceJson(res, status, {
    error: assertDashboardSafeError(mapDashboardSafeError(error)),
  });

function experienceBinding(req, searchParams) {
  const actorHeader = req.headers['x-openplanr-actor'];
  const actorHeaders = req.headersDistinct?.['x-openplanr-actor'];
  const binding = {
    actorId:
      Array.isArray(actorHeader) || (Array.isArray(actorHeaders) && actorHeaders.length !== 1)
        ? null
        : actorHeader,
    ...Object.fromEntries(
      ['scopeId', 'domainId', 'domainVersion'].map((field) => [field, searchParams.get(field)]),
    ),
  };
  return Object.values(binding).every((value) => typeof value === 'string' && value.length > 0)
    ? binding
    : null;
}

const OPERATE_BINDING_QUERY_KEYS = Object.freeze(['scopeId', 'domainId', 'domainVersion']);
const OPERATE_COLLECTION_ROUTES = new Map([
  ['cycles', 'cycles'],
  ['outcomes', 'outcomes'],
  ['actions', 'actions'],
]);
const OPERATE_DETAIL_ROUTES = new Map([
  ['cycle', 'cycle'],
  ['cycles', 'cycle'],
  ['action', 'action'],
  ['actions', 'action'],
  ['evidence', 'evidence'],
  ['outcome', 'outcome'],
  ['outcomes', 'outcome'],
]);
const OPERATE_SINGLETON_ROUTES = new Set([
  'today',
  'inbox',
  'evidence',
  'history',
  'search',
  'export',
  'events',
  'recovery',
]);
const OPERATE_AUDIT_DISPLAY_SURFACES = new Set([
  'evidence',
  'outcomes',
  'outcome',
  'history',
  'search',
  'export',
]);
const OPERATE_SUBJECT_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const OPERATE_INBOX_ITEM_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const OPERATE_COMMAND_BODY_LIMIT = 32 * 1024;
const OPERATE_COMMAND_SESSION_MIN_TTL_MS = 1_000;
const OPERATE_COMMAND_SESSION_MAX_TTL_MS = 60 * 60 * 1_000;
const OPERATE_COMMAND_MUTATIONS = new Set([
  'operate.assignment.submit',
  'operate.review.submit',
  'operate.action.approve',
  'operate.action.execute',
  'operate.action.rollback',
]);
const OPERATE_COMMAND_ROUTES = new Map([
  [
    '/api/operate/session',
    Object.freeze({
      kind: 'session',
      fields: ['cycleId', 'eventHead', 'sourceViewHash', 'actionLocator'],
    }),
  ],
  [
    '/api/operate/commands/preview',
    Object.freeze({
      kind: 'preview',
      fields: ['sessionId', 'actionReference'],
    }),
  ],
  [
    '/api/operate/commands/confirm',
    Object.freeze({
      kind: 'confirm',
      fields: ['sessionId', 'previewId', 'previewHash'],
      optionalFields: ['note'],
    }),
  ],
  [
    '/api/operate/planning/preview',
    Object.freeze({
      kind: 'planning-preview',
      fields: ['sessionId', 'actionId'],
      optionalFields: ['framing'],
    }),
  ],
  [
    '/api/operate/planning/create-spec',
    Object.freeze({
      kind: 'planning-create-spec',
      fields: ['sessionId', 'proposalId', 'confirmDigest'],
    }),
  ],
]);

const PLANNING_FRAMING_FIELDS = Object.freeze([
  'title',
  'slug',
  'problem',
  'objective',
  'users',
  'scope',
  'nonScope',
  'risks',
  'constraints',
  'requirements',
  'acceptanceOutcomes',
]);

function exactPlanningFraming(value) {
  if (!exactObject(value, PLANNING_FRAMING_FIELDS)) return false;
  return (
    ['title', 'slug', 'problem', 'objective'].every((field) => typeof value[field] === 'string') &&
    [
      'users',
      'scope',
      'nonScope',
      'risks',
      'constraints',
      'requirements',
      'acceptanceOutcomes',
    ].every(
      (field) =>
        Array.isArray(value[field]) && value[field].every((entry) => typeof entry === 'string'),
    )
  );
}

function strictJsonError(code = 'OPERATE_BODY_INVALID') {
  const error = new Error(
    code === 'OPERATE_DUPLICATE_MEMBER'
      ? 'The command body contains a duplicate JSON object member.'
      : 'The command body is invalid JSON.',
  );
  error.code = code;
  error.status = 400;
  return error;
}

/**
 * Scan one bounded JSON body before JSON.parse can collapse duplicate object
 * members. Decoded property names are compared, so `"actor"` and
 * `"\u0061ctor"` are the same member; nested objects receive the same check.
 */
function parseStrictCommandJson(source) {
  let offset = 0;
  const whitespace = () => {
    while (/[\t\n\r ]/u.test(source[offset] ?? '')) offset += 1;
  };
  const string = () => {
    if (source[offset] !== '"') throw strictJsonError();
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      const character = source[offset];
      if (character === '"') {
        offset += 1;
        try {
          return JSON.parse(source.slice(start, offset));
        } catch {
          throw strictJsonError();
        }
      }
      if (character === '\\') {
        offset += 1;
        const escape = source[offset];
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/u.test(source.slice(offset + 1, offset + 5))) {
            throw strictJsonError();
          }
          offset += 5;
          continue;
        }
        if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) {
          throw strictJsonError();
        }
        offset += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) throw strictJsonError();
      offset += 1;
    }
    throw strictJsonError();
  };
  const value = () => {
    whitespace();
    const character = source[offset];
    if (character === '{') {
      offset += 1;
      whitespace();
      const members = new Set();
      if (source[offset] === '}') {
        offset += 1;
        return;
      }
      while (offset < source.length) {
        const member = string();
        if (members.has(member)) throw strictJsonError('OPERATE_DUPLICATE_MEMBER');
        members.add(member);
        whitespace();
        if (source[offset] !== ':') throw strictJsonError();
        offset += 1;
        value();
        whitespace();
        if (source[offset] === '}') {
          offset += 1;
          return;
        }
        if (source[offset] !== ',') throw strictJsonError();
        offset += 1;
        whitespace();
      }
      throw strictJsonError();
    }
    if (character === '[') {
      offset += 1;
      whitespace();
      if (source[offset] === ']') {
        offset += 1;
        return;
      }
      while (offset < source.length) {
        value();
        whitespace();
        if (source[offset] === ']') {
          offset += 1;
          return;
        }
        if (source[offset] !== ',') throw strictJsonError();
        offset += 1;
      }
      throw strictJsonError();
    }
    if (character === '"') {
      string();
      return;
    }
    const remainder = source.slice(offset);
    const primitive = /^(?:true|false|null)(?=[\t\n\r ,}\]]|$)/u.exec(remainder);
    if (primitive) {
      offset += primitive[0].length;
      return;
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?=[\t\n\r ,}\]]|$)/u.exec(
      remainder,
    );
    if (!number) throw strictJsonError();
    offset += number[0].length;
  };
  if (Buffer.byteLength(source, 'utf8') > OPERATE_COMMAND_BODY_LIMIT) {
    const error = new Error('The command body is too large.');
    error.code = 'OPERATE_BODY_TOO_LARGE';
    error.status = 413;
    throw error;
  }
  value();
  whitespace();
  if (offset !== source.length) throw strictJsonError();
  try {
    return JSON.parse(source);
  } catch {
    throw strictJsonError();
  }
}

export function parseOperateApiRoute(pathname) {
  return parseOperateRoute(pathname);
}

function parseOperateRoute(pathname) {
  const prefix = '/api/operate/';
  if (!pathname.startsWith(prefix)) return null;
  const rawParts = pathname.slice(prefix.length).split('/');
  if (rawParts.some((part) => part.length === 0 || /%(?:2f|5c)/iu.test(part))) return null;
  let parts;
  try {
    parts = rawParts.map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  if (rawParts[0] !== parts[0]) return null;
  if (parts.length === 1 && OPERATE_SINGLETON_ROUTES.has(parts[0])) {
    return Object.freeze({ surface: parts[0], subjectId: null });
  }
  if (parts.length === 1 && OPERATE_COLLECTION_ROUTES.has(parts[0])) {
    return Object.freeze({ surface: OPERATE_COLLECTION_ROUTES.get(parts[0]), subjectId: null });
  }
  if (parts.length === 3 && parts[0] === 'cycles' && parts[2] === 'executive-board') {
    const subjectId = parts[1];
    if (!OPERATE_SUBJECT_SEGMENT.test(subjectId) || subjectId === '.' || subjectId === '..') {
      return null;
    }
    return Object.freeze({ surface: 'cycle-executive-board', subjectId });
  }
  if (parts.length === 4 && parts[0] === 'cycles' && parts[2] === 'reviews') {
    const cycleId = parts[1];
    const subjectId = parts[3];
    if (
      ![cycleId, subjectId].every(
        (id) => OPERATE_SUBJECT_SEGMENT.test(id) && id !== '.' && id !== '..',
      )
    )
      return null;
    return Object.freeze({ surface: 'review', cycleId, subjectId });
  }
  if (parts.length === 2 && parts[0] === 'inbox') {
    const subjectId = parts[1];
    if (!OPERATE_INBOX_ITEM_SEGMENT.test(subjectId)) return null;
    return Object.freeze({ surface: 'inbox', subjectId });
  }
  if (parts.length !== 2 || !OPERATE_DETAIL_ROUTES.has(parts[0])) return null;
  const subjectId = parts[1];
  if (!OPERATE_SUBJECT_SEGMENT.test(subjectId) || subjectId === '.' || subjectId === '..')
    return null;
  return Object.freeze({ surface: OPERATE_DETAIL_ROUTES.get(parts[0]), subjectId });
}

function hasInvalidOperateQuery(route, searchParams) {
  const allowed = new Set(OPERATE_BINDING_QUERY_KEYS);
  if (OPERATE_AUDIT_DISPLAY_SURFACES.has(route.surface)) allowed.add('cycleId');
  if (route.surface === 'inbox' || route.surface === 'actions') {
    allowed.add('projectId');
    allowed.add('generation');
  }
  if (route.surface === 'actions') allowed.add('cycleId');
  if (route.surface === 'events') {
    allowed.add('generation');
    allowed.add('projectId');
    allowed.add('surface');
  }
  if (route.surface === 'search') allowed.add('q');
  if (route.surface === 'export') allowed.add('format');
  const seen = new Set();
  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function sameExperienceBinding(view, binding) {
  return (
    binding &&
    ['actorId', 'scopeId', 'domainId', 'domainVersion'].every(
      (field) => view?.[field] === binding[field],
    )
  );
}

function exactEventHead(left, right) {
  return left?.sequence === right?.sequence && left?.hash === right?.hash;
}

function sameCommandSessionBinding(sessionBinding, requestBinding, request) {
  return (
    sameExperienceBinding(sessionBinding, requestBinding) &&
    typeof request?.cycleId === 'string' &&
    sessionBinding?.cycleId === request.cycleId &&
    exactEventHead(sessionBinding?.eventHead, request.eventHead) &&
    sessionBinding?.sourceViewHash === request.sourceViewHash &&
    sessionBinding?.actionLocator?.subjectId === request.actionLocator?.subjectId &&
    sessionBinding?.actionLocator?.actionDigest === request.actionLocator?.actionDigest
  );
}

function validCommandSessionBinding(sessionBinding, requestBinding) {
  return (
    sameExperienceBinding(sessionBinding, requestBinding) &&
    typeof sessionBinding?.cycleId === 'string' &&
    OPERATE_SUBJECT_SEGMENT.test(sessionBinding.cycleId) &&
    validLiveHead(sessionBinding.eventHead) &&
    typeof sessionBinding.sourceViewHash === 'string' &&
    LIVE_HASH.test(sessionBinding.sourceViewHash) &&
    exactObject(sessionBinding.actionLocator, ['subjectId', 'actionDigest']) &&
    typeof sessionBinding.actionLocator.subjectId === 'string' &&
    OPERATE_SUBJECT_SEGMENT.test(sessionBinding.actionLocator.subjectId) &&
    typeof sessionBinding.actionLocator.actionDigest === 'string' &&
    LIVE_HASH.test(sessionBinding.actionLocator.actionDigest)
  );
}

function closedCommandSessionBinding(value) {
  const source = safeDashboardErrorRecord(value);
  if (
    !source ||
    !exactObject(source, [
      'actorId',
      'scopeId',
      'domainId',
      'domainVersion',
      'cycleId',
      'eventHead',
      'sourceViewHash',
      'actionLocator',
    ])
  )
    return null;
  const eventHead = safeDashboardErrorRecord(source.eventHead);
  const actionLocator = safeDashboardErrorRecord(source.actionLocator);
  const binding = {
    actorId: source.actorId,
    scopeId: source.scopeId,
    domainId: source.domainId,
    domainVersion: source.domainVersion,
    cycleId: source.cycleId,
    eventHead,
    sourceViewHash: source.sourceViewHash,
    actionLocator,
  };
  return eventHead &&
    actionLocator &&
    validCommandSessionBinding(binding, {
      actorId: binding.actorId,
      scopeId: binding.scopeId,
      domainId: binding.domainId,
      domainVersion: binding.domainVersion,
    })
    ? binding
    : null;
}

function sameClosedCommandSessionBinding(left, right) {
  return (
    sameExperienceBinding(left, right) &&
    left?.cycleId === right?.cycleId &&
    exactEventHead(left?.eventHead, right?.eventHead) &&
    left?.sourceViewHash === right?.sourceViewHash &&
    left?.actionLocator?.subjectId === right?.actionLocator?.subjectId &&
    left?.actionLocator?.actionDigest === right?.actionLocator?.actionDigest
  );
}

function exactObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return (
    actual.length === expected.length && actual.every((field, index) => field === expected[index])
  );
}

function exactRouteBody(value, route) {
  if (exactObject(value, route.fields)) {
    if (route.kind !== 'session') return true;
    return (
      typeof value.cycleId === 'string' &&
      OPERATE_SUBJECT_SEGMENT.test(value.cycleId) &&
      validLiveHead(value.eventHead) &&
      typeof value.sourceViewHash === 'string' &&
      LIVE_HASH.test(value.sourceViewHash) &&
      exactObject(value.actionLocator, ['subjectId', 'actionDigest']) &&
      typeof value.actionLocator.subjectId === 'string' &&
      OPERATE_SUBJECT_SEGMENT.test(value.actionLocator.subjectId) &&
      typeof value.actionLocator.actionDigest === 'string' &&
      LIVE_HASH.test(value.actionLocator.actionDigest)
    );
  }
  const optional = route.optionalFields ?? [];
  if (optional.length === 0 || !exactObject(value, [...route.fields, ...optional])) return false;
  if (Object.hasOwn(value, 'framing') && !exactPlanningFraming(value.framing)) return false;
  if (
    Object.hasOwn(value, 'note') &&
    !(
      value.note === null ||
      (typeof value.note === 'string' &&
        value.note.length <= 2048 &&
        /^\S(?:[\s\S]*\S)?$/u.test(value.note))
    )
  )
    return false;
  return true;
}

function exactReturnedSessionAction(response, request) {
  if (!Array.isArray(response?.allowedActions) || response.allowedActions.length !== 1)
    return false;
  const [action] = response.allowedActions;
  return (
    exactObject(action, ['actionReference', 'subjectId', 'actionDigest']) &&
    typeof action.actionReference === 'string' &&
    /^[A-Za-z0-9_-]{16,256}$/u.test(action.actionReference) &&
    action.subjectId === request.actionLocator.subjectId &&
    action.actionDigest === request.actionLocator.actionDigest
  );
}

function canonicalCommandTimestamp(value) {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  if (!Number.isSafeInteger(timestamp)) return null;
  try {
    return new Date(timestamp).toISOString() === value ? timestamp : null;
  } catch {
    return null;
  }
}

function closedCommandSessionResponse(response, requestBinding, request) {
  const source = safeDashboardErrorRecord(response);
  const issuedAtMs = source ? canonicalCommandTimestamp(source.issuedAt) : null;
  const expiresAtMs = source ? canonicalCommandTimestamp(source.expiresAt) : null;
  if (
    !source ||
    !exactObject(source, [
      'kind',
      'schemaVersion',
      'protocolVersion',
      'sessionId',
      'sessionCapability',
      'issuedAt',
      'expiresAt',
      'binding',
      'allowedActions',
      'readOnly',
    ]) ||
    source.kind !== 'operate-command-session' ||
    source.schemaVersion !== '1.0.0' ||
    source.protocolVersion !== '2.0.0' ||
    typeof source.sessionId !== 'string' ||
    !/^opsess_[A-Za-z0-9_-]{16,249}$/u.test(source.sessionId) ||
    typeof source.sessionCapability !== 'string' ||
    !/^[A-Za-z0-9_-]{43,256}$/u.test(source.sessionCapability) ||
    issuedAtMs === null ||
    expiresAtMs === null ||
    expiresAtMs - issuedAtMs < OPERATE_COMMAND_SESSION_MIN_TTL_MS ||
    expiresAtMs - issuedAtMs > OPERATE_COMMAND_SESSION_MAX_TTL_MS ||
    source.readOnly !== false ||
    !Array.isArray(source.allowedActions) ||
    utilTypes.isProxy(source.allowedActions) ||
    source.allowedActions.length !== 1
  )
    return null;
  const binding = closedCommandSessionBinding(source.binding);
  const action = safeDashboardErrorRecord(source.allowedActions[0]);
  if (
    !binding ||
    !action ||
    !sameCommandSessionBinding(binding, requestBinding, request) ||
    !exactReturnedSessionAction({ allowedActions: [action] }, request)
  )
    return null;
  return Object.freeze({
    kind: source.kind,
    schemaVersion: source.schemaVersion,
    protocolVersion: source.protocolVersion,
    sessionId: source.sessionId,
    sessionCapability: source.sessionCapability,
    issuedAt: source.issuedAt,
    expiresAt: source.expiresAt,
    binding: Object.freeze(structuredClone(binding)),
    allowedActions: Object.freeze([Object.freeze(structuredClone(action))]),
    readOnly: false,
  });
}

function closedCommandPreviewProof(value, sessionBinding) {
  const source = safeDashboardErrorRecord(value);
  const binding = source ? closedCommandSessionBinding(source.binding) : null;
  if (
    !source ||
    !exactObject(source, ['binding', 'operation']) ||
    !binding ||
    !sameClosedCommandSessionBinding(binding, sessionBinding) ||
    typeof source.operation !== 'string' ||
    !OPERATE_COMMAND_MUTATIONS.has(source.operation)
  )
    return null;
  return Object.freeze({ binding, operation: source.operation });
}

function emptyClosedArray(value) {
  return Array.isArray(value) && !utilTypes.isProxy(value) && value.length === 0;
}

function closedCommandFailureResponse(response, expectedOperation) {
  const source = safeDashboardErrorRecord(response);
  const error = source ? safeDashboardErrorRecord(source.error) : null;
  if (
    !source ||
    !error ||
    !exactObject(source, ['ok', 'operation', 'error', 'allowedActions']) ||
    !exactObject(error, ['code', 'message', 'retryable', 'context']) ||
    source.ok !== false ||
    source.operation !== expectedOperation ||
    !emptyClosedArray(source.allowedActions) ||
    typeof error.code !== 'string' ||
    typeof error.message !== 'string' ||
    typeof error.retryable !== 'boolean'
  )
    return null;
  const safe = assertDashboardSafeError(
    mapDashboardSafeError({
      code: error.code,
      retryable: error.retryable,
      context: error.context,
    }),
  );
  if (safe.code !== error.code) return null;
  return Object.freeze({
    ok: false,
    operation: expectedOperation,
    error: Object.freeze({
      code: safe.code,
      message:
        safe.code === 'OPERATION_UNCERTAIN'
          ? 'The durable result is uncertain. Inspect recovery state; do not retry blindly.'
          : 'The governed command was refused without effect.',
      retryable: false,
      context: Object.freeze({}),
    }),
    allowedActions: Object.freeze([]),
  });
}

function closedCommandSuccessResponse(response, expectedOperation, refreshedView) {
  const source = safeDashboardErrorRecord(response);
  if (
    !source ||
    !exactObject(source, ['ok', 'operation', 'data', 'allowedActions', 'eventHead']) ||
    source.ok !== true ||
    source.operation !== expectedOperation ||
    !emptyClosedArray(source.allowedActions) ||
    !validLiveHead(source.eventHead) ||
    !exactEventHead(source.eventHead, refreshedView.eventHead)
  )
    return null;
  try {
    assertOperateExperienceTransportView(source.data);
  } catch {
    return null;
  }
  if (
    !sameExperienceBinding(source.data, refreshedView) ||
    !exactEventHead(source.data.eventHead, source.eventHead) ||
    source.data.viewHash !== refreshedView.viewHash
  )
    return null;
  return Object.freeze({
    ok: true,
    operation: expectedOperation,
    data: structuredClone(refreshedView),
    allowedActions: Object.freeze([]),
    eventHead: Object.freeze(structuredClone(source.eventHead)),
  });
}

function closedReviewWorkspace(value, binding, cycleId, reviewId, refreshedView) {
  let workspace;
  try {
    workspace = structuredClone(value);
    assertOperateReviewDisplayWorkspaceV1(workspace);
  } catch {
    return null;
  }
  const payload = workspace.payload;
  const exactCurrentSource =
    exactEventHead(payload.sourceEventHead, refreshedView.eventHead) &&
    payload.sourceViewHash === refreshedView.viewHash;
  const historicalTerminalSource =
    payload.sourceArtifactKind === 'operating-review-receipt' &&
    payload.status === 'terminal' &&
    payload.sourceEventHead.sequence < refreshedView.eventHead.sequence &&
    refreshedView.cycles.some((cycle) => cycle.cycleId === cycleId);
  if (
    payload.actorId !== binding.actorId ||
    payload.scopeId !== binding.scopeId ||
    payload.domainId !== binding.domainId ||
    payload.domainVersion !== binding.domainVersion ||
    payload.cycleId !== cycleId ||
    payload.reviewId !== reviewId ||
    (!exactCurrentSource && !historicalTerminalSource)
  )
    return null;
  return Object.freeze(workspace);
}

function closedReviewCommandSuccessResponse(
  response,
  refreshedView,
  reviewWorkspace,
  sessionBinding,
  expectedNote,
) {
  const source = safeDashboardErrorRecord(response);
  const data = source ? safeDashboardErrorRecord(source.data) : null;
  if (
    !source ||
    !data ||
    !exactObject(source, ['ok', 'operation', 'data', 'allowedActions', 'eventHead']) ||
    !exactObject(data, ['receipt', 'workspace']) ||
    source.ok !== true ||
    source.operation !== 'operate.review.submit' ||
    !emptyClosedArray(source.allowedActions) ||
    !validLiveHead(source.eventHead) ||
    !currentHeadIncludesCommitted(refreshedView.eventHead, source.eventHead)
  )
    return null;
  const reviewId = sessionBinding.actionLocator.subjectId;
  const workspace = closedReviewWorkspace(
    reviewWorkspace,
    sessionBinding,
    sessionBinding.cycleId,
    reviewId,
    refreshedView,
  );
  if (!workspace || sha256Jcs(workspace) !== sha256Jcs(data.workspace)) return null;
  let receipt;
  try {
    receipt = structuredClone(data.receipt);
    assertOperatingReviewReceiptV2(receipt);
    if (receipt.boundSubmission === undefined) return null;
  } catch {
    return null;
  }
  const bound = receipt.boundSubmission;
  const terminal = workspace.payload.data.terminalDisposition;
  if (
    receipt.cycleId !== sessionBinding.cycleId ||
    receipt.review.reviewId !== reviewId ||
    receipt.actor.actorId !== sessionBinding.actorId ||
    receipt.scope.scopeId !== sessionBinding.scopeId ||
    receipt.scope.domainId !== sessionBinding.domainId ||
    receipt.scope.domainVersion !== sessionBinding.domainVersion ||
    !exactEventHead(receipt.eventHead, source.eventHead) ||
    !exactEventHead(receipt.readEventHead, sessionBinding.eventHead) ||
    !exactEventHead(bound.expectedReadEventHead, sessionBinding.eventHead) ||
    bound.note !== expectedNote ||
    bound.choiceId !== receipt.appliedChoiceId ||
    bound.choiceHash !== receipt.appliedChoiceHash ||
    workspace.payload.sourceArtifactKind !== 'operating-review-receipt' ||
    workspace.payload.sourceArtifactHash !== sha256Jcs(receipt) ||
    workspace.payload.status !== 'terminal' ||
    terminal === null ||
    terminal.receiptId !== receipt.receiptId ||
    terminal.appliedChoiceId !== receipt.appliedChoiceId ||
    terminal.appliedChoiceHash !== receipt.appliedChoiceHash ||
    !exactEventHead(terminal.eventHead, receipt.eventHead) ||
    !exactEventHead(terminal.readEventHead, receipt.readEventHead)
  )
    return null;
  return Object.freeze({
    ok: true,
    operation: 'operate.review.submit',
    data: Object.freeze({ receipt, workspace }),
    allowedActions: Object.freeze([]),
    eventHead: Object.freeze(structuredClone(source.eventHead)),
  });
}

function closedReviewCommandFailureResponse(response, workspace) {
  const source = safeDashboardErrorRecord(response);
  const error = source ? safeDashboardErrorRecord(source.error) : null;
  if (
    !source ||
    !error ||
    !exactObject(source, ['ok', 'operation', 'error', 'allowedActions']) ||
    source.ok !== false ||
    source.operation !== 'operate.review.submit' ||
    !Array.isArray(source.allowedActions) ||
    typeof error.code !== 'string' ||
    typeof error.message !== 'string' ||
    typeof error.retryable !== 'boolean'
  )
    return null;
  const safe = assertDashboardSafeError(
    mapDashboardSafeError({
      code: error.code,
      retryable: error.retryable,
      context: error.context,
    }),
  );
  if (safe.code !== error.code) return null;
  const allowedActions =
    workspace?.payload?.data?.capability?.available === true
      ? workspace.payload.data.capability.actions
      : [];
  return Object.freeze({
    ok: false,
    operation: 'operate.review.submit',
    error: Object.freeze({
      code: safe.code,
      message:
        safe.code === 'OPERATION_UNCERTAIN'
          ? 'The durable result is uncertain. Inspect recovery state; do not retry blindly.'
          : 'The governed command was refused without effect.',
      retryable: false,
      context: Object.freeze({}),
    }),
    allowedActions: Object.freeze(structuredClone(allowedActions)),
  });
}

function exactAdvancedHead(candidate, previous) {
  return (
    validLiveHead(candidate) && candidate.sequence > previous.sequence && candidate.hash !== null
  );
}

function currentHeadIncludesCommitted(current, committed) {
  return (
    validLiveHead(current) &&
    validLiveHead(committed) &&
    current.sequence >= committed.sequence &&
    (current.sequence !== committed.sequence || current.hash === committed.hash)
  );
}

function exactCommandBinding(req, searchParams, rawSearch, extraKeys = []) {
  const expectedKeys = [...OPERATE_BINDING_QUERY_KEYS, ...extraKeys];
  const seen = [...searchParams.keys()];
  const rawKeys =
    typeof rawSearch === 'string' && rawSearch.startsWith('?')
      ? rawSearch
          .slice(1)
          .split('&')
          .map((member) => member.split('=', 1)[0])
      : [];
  if (
    seen.length !== expectedKeys.length ||
    new Set(seen).size !== expectedKeys.length ||
    seen.some((key) => !expectedKeys.includes(key)) ||
    rawKeys.length !== expectedKeys.length ||
    new Set(rawKeys).size !== expectedKeys.length ||
    rawKeys.some((key) => !expectedKeys.includes(key))
  )
    return null;
  return experienceBinding(req, searchParams);
}

function commandOrigin(req) {
  const header = req.headers.origin;
  const host = req.headers.host;
  const origins = req.headersDistinct?.origin;
  const hosts = req.headersDistinct?.host;
  if (
    Array.isArray(header) ||
    typeof header !== 'string' ||
    Array.isArray(host) ||
    typeof host !== 'string' ||
    (Array.isArray(origins) && origins.length !== 1) ||
    (Array.isArray(hosts) && hosts.length !== 1)
  )
    return null;
  try {
    const origin = new URL(header);
    const requested = new URL(`http://${host}`);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'];
    if (
      origin.origin !== header ||
      origin.origin !== requested.origin ||
      origin.protocol !== 'http:' ||
      !loopback.includes(origin.hostname) ||
      !loopback.includes(requested.hostname)
    )
      return null;
    return origin.origin;
  } catch {
    return null;
  }
}

function loopbackCommandHost(req) {
  const host = req.headers.host;
  const hosts = req.headersDistinct?.host;
  if (
    Array.isArray(host) ||
    typeof host !== 'string' ||
    (Array.isArray(hosts) && hosts.length !== 1)
  )
    return false;
  try {
    const requested = new URL(`http://${host}`);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(requested.hostname);
  } catch {
    return false;
  }
}

function bearerCapability(req) {
  const header = req.headers.authorization;
  const headers = req.headersDistinct?.authorization;
  if (
    Array.isArray(header) ||
    typeof header !== 'string' ||
    (Array.isArray(headers) && headers.length !== 1)
  )
    return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43,256})$/u.exec(header);
  return match?.[1] ?? null;
}

function readCommandBody(req) {
  const contentType = req.headers['content-type'];
  if (
    Array.isArray(contentType) ||
    typeof contentType !== 'string' ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)
  ) {
    const error = new Error('The command body must be JSON.');
    error.code = 'OPERATE_CONTENT_TYPE_INVALID';
    error.status = 415;
    throw error;
  }
  const lengthHeader = req.headers['content-length'];
  const declared =
    typeof lengthHeader === 'string' && /^\d+$/u.test(lengthHeader) ? Number(lengthHeader) : null;
  if (declared !== null && declared > OPERATE_COMMAND_BODY_LIMIT) {
    const error = new Error('The command body is too large.');
    error.code = 'OPERATE_BODY_TOO_LARGE';
    error.status = 413;
    throw error;
  }
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    let refused = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > OPERATE_COMMAND_BODY_LIMIT && !refused) {
        refused = true;
        chunks.length = 0;
        const error = new Error('The command body is too large.');
        error.code = 'OPERATE_BODY_TOO_LARGE';
        error.status = 413;
        rejectBody(error);
        return;
      }
      if (!refused) chunks.push(chunk);
    });
    req.on('end', () => {
      if (refused) return;
      try {
        resolveBody(parseStrictCommandJson(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        rejectBody(error);
      }
    });
    req.on('error', rejectBody);
  });
}

function commandError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 409;
  const code =
    typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]*$/u.test(error.code)
      ? error.code
      : 'OPERATE_COMMAND_REFUSED';
  return experienceJson(res, status, {
    ok: false,
    error: {
      reasonCode: code,
      message: 'The governed local command was refused without effect.',
      retryable: false,
    },
  });
}

function sseFrame(event, payload, id = null) {
  return `${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

const LIVE_EVENT_KINDS = new Set(['snapshot', 'ready', 'patch', 'stale']);
const LIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const LIVE_HASH = /^sha256:[a-f0-9]{64}$/u;
const LIVE_REASON = /^[A-Z][A-Z0-9_]{0,127}$/u;
const LIVE_PATCH_ID = /^xpatch_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u;
const LIVE_PATCH_PATHS = new Set([
  '/status',
  '/attention',
  '/domainMetrics',
  '/cycles',
  '/inbox',
  '/actions',
  '/evidence',
  '/claims',
  '/rationale',
  '/outcomes',
  '/learnings',
  '/history',
  '/replay',
  '/allowedActions',
  '/omissions',
  '/export',
]);

function validLiveHead(value) {
  return (
    exactKeys(value, ['sequence', 'hash']) &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    ((value.sequence === 0 && value.hash === null) ||
      (value.sequence > 0 && typeof value.hash === 'string' && LIVE_HASH.test(value.hash)))
  );
}

function validLiveBinding(value) {
  return (
    exactKeys(value, [
      'actorId',
      'projectId',
      'scopeId',
      'domainId',
      'domainVersion',
      'generation',
    ]) &&
    [value.actorId, value.scopeId, value.domainId, value.domainVersion].every(
      (entry) => typeof entry === 'string' && LIVE_ID.test(entry),
    ) &&
    typeof value.projectId === 'string' &&
    LIVE_HASH.test(value.projectId) &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 0
  );
}

function validLiveCursor(value) {
  return (
    exactKeys(value, ['eventHead', 'viewHash']) &&
    validLiveHead(value.eventHead) &&
    typeof value.viewHash === 'string' &&
    LIVE_HASH.test(value.viewHash)
  );
}

/** Validate the closed, access-safe dashboard SSE envelope at its server-owner boundary. */
export function assertDashboardLiveEventEnvelope(value) {
  if (
    !exactKeys(value, ['kind', 'schemaVersion', 'event', 'binding', 'cursor', 'payload']) ||
    value.kind !== 'dashboard-live-event' ||
    value.schemaVersion !== '1.0.0' ||
    !LIVE_EVENT_KINDS.has(value.event) ||
    !validLiveBinding(value.binding) ||
    !validLiveCursor(value.cursor)
  ) {
    throw new TypeError('Invalid dashboard live event envelope.');
  }
  const { binding, cursor, payload } = value;
  if (value.event === 'snapshot') {
    const surface = payload?.payload?.surface;
    if (!['today', 'inbox'].includes(surface)) {
      throw new TypeError('Dashboard live snapshot surface is unsupported.');
    }
    assertOperateExperienceDisplaySurfaceV1(payload, {
      actorId: binding.actorId,
      scopeId: binding.scopeId,
      domainId: binding.domainId,
      domainVersion: binding.domainVersion,
      generatedAt: payload?.payload?.generatedAt,
      eventHead: cursor.eventHead,
      viewHash: cursor.viewHash,
      surface,
      ...(surface === 'inbox'
        ? { projectId: binding.projectId, generation: binding.generation, subjectId: null }
        : {}),
    });
    if (payload.payload.ok !== true || payload.payload.surface !== surface) {
      throw new TypeError('Dashboard live snapshot binding is inconsistent.');
    }
  } else if (value.event === 'patch') {
    if (
      !exactKeys(payload, ['patchId', 'patchHash', 'from', 'to', 'changedPaths']) ||
      typeof payload.patchId !== 'string' ||
      !LIVE_PATCH_ID.test(payload.patchId) ||
      typeof payload.patchHash !== 'string' ||
      !LIVE_HASH.test(payload.patchHash) ||
      !validLiveCursor(payload.from) ||
      !validLiveCursor(payload.to) ||
      !Array.isArray(payload.changedPaths) ||
      payload.changedPaths.length !== new Set(payload.changedPaths).size ||
      !payload.changedPaths.every(
        (path) => typeof path === 'string' && LIVE_PATCH_PATHS.has(path),
      ) ||
      payload.to.eventHead.sequence !== cursor.eventHead.sequence ||
      payload.to.eventHead.hash !== cursor.eventHead.hash ||
      payload.to.viewHash !== cursor.viewHash
    ) {
      throw new TypeError('Invalid dashboard live patch signal.');
    }
  } else if (value.event === 'ready') {
    if (
      !exactKeys(payload, ['mutationEnabled', 'reasonCodes']) ||
      typeof payload.mutationEnabled !== 'boolean' ||
      !Array.isArray(payload.reasonCodes) ||
      !payload.reasonCodes.every(
        (reason) => typeof reason === 'string' && LIVE_REASON.test(reason),
      ) ||
      (payload.mutationEnabled && payload.reasonCodes.length !== 0) ||
      (!payload.mutationEnabled && payload.reasonCodes.length === 0)
    ) {
      throw new TypeError('Invalid dashboard live ready payload.');
    }
  } else if (
    !exactKeys(payload, ['mutationEnabled', 'reasonCodes', 'recovery']) ||
    payload.mutationEnabled !== false ||
    !Array.isArray(payload.reasonCodes) ||
    payload.reasonCodes.length < 1 ||
    !payload.reasonCodes.every(
      (reason) => typeof reason === 'string' && LIVE_REASON.test(reason),
    ) ||
    typeof payload.recovery !== 'string' ||
    payload.recovery.length < 1 ||
    payload.recovery.length > 240
  ) {
    throw new TypeError('Invalid dashboard live stale payload.');
  }
  return value;
}

export function createDashboardLiveEventEnvelope({ event, binding, cursor, payload }) {
  let transportPayload = payload;
  if (event === 'patch') {
    assertOperateExperienceArtifactV2('operate-experience-live-patch', payload);
    if (
      payload.actorId !== binding.actorId ||
      payload.scopeId !== binding.scopeId ||
      payload.domainId !== binding.domainId ||
      payload.domainVersion !== binding.domainVersion ||
      payload.toEventHead.sequence !== cursor.eventHead.sequence ||
      payload.toEventHead.hash !== cursor.eventHead.hash ||
      payload.toViewHash !== cursor.viewHash
    ) {
      throw new TypeError('Dashboard live patch binding is inconsistent.');
    }
    transportPayload = Object.freeze({
      patchId: payload.patchId,
      patchHash: payload.patchHash,
      from: Object.freeze({ eventHead: payload.fromEventHead, viewHash: payload.fromViewHash }),
      to: Object.freeze({ eventHead: payload.toEventHead, viewHash: payload.toViewHash }),
      changedPaths: Object.freeze(payload.operations.map((operation) => operation.path)),
    });
  }
  return assertDashboardLiveEventEnvelope({
    kind: 'dashboard-live-event',
    schemaVersion: '1.0.0',
    event,
    binding,
    cursor,
    payload: transportPayload,
  });
}

function liveGeneration(searchParams) {
  const raw = searchParams.get('generation');
  if (raw === null) return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function liveCheckpointHeader(req) {
  const values = req.headersDistinct?.['last-event-id'];
  const fallback = req.headers['last-event-id'];
  if (values === undefined && fallback === undefined) {
    return Object.freeze({ valid: true, checkpoint: null });
  }
  const rawValues = Array.isArray(values) ? values : typeof fallback === 'string' ? [fallback] : [];
  if (rawValues.length !== 1 || typeof rawValues[0] !== 'string') {
    return Object.freeze({ valid: false, checkpoint: null });
  }
  const checkpoint = decodeOperateExperienceCheckpoint(rawValues[0]);
  if (!checkpoint || encodeOperateExperienceCheckpoint(checkpoint) !== rawValues[0]) {
    return Object.freeze({ valid: false, checkpoint: null });
  }
  return Object.freeze({ valid: true, checkpoint });
}

const PLANNING_SCHEMA_VERSION = '1.0.0';
const PLANNING_SCOPE_ID = 'planning';
const PLANNING_DOMAIN_ID = 'planning';
const PLANNING_DOMAIN_VERSION = '1.0.0';
const PLANNING_BINDING_QUERY_KEYS = Object.freeze([
  'projectId',
  'scopeId',
  'domainId',
  'domainVersion',
  'generation',
]);
const PLANNING_MODES = new Set(['agile', 'spec', 'mixed', 'empty']);
const PLANNING_EVENT_KINDS = new Set(['snapshot', 'ready', 'patch', 'stale']);
const PLANNING_PATCH_ID = /^ppatch_[1-9][0-9]*_[a-f0-9]{16}$/u;
const PLANNING_REASON = /^PLANNING_[A-Z0-9_]{1,119}$/u;

function sameLiveHead(left, right) {
  return left?.sequence === right?.sequence && left?.hash === right?.hash;
}

function sameLiveCursor(left, right) {
  return sameLiveHead(left?.eventHead, right?.eventHead) && left?.viewHash === right?.viewHash;
}

function planningRequestBinding(req, searchParams, projectId, expectedActorId) {
  const keys = [...searchParams.keys()];
  if (
    keys.length !== PLANNING_BINDING_QUERY_KEYS.length ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => !PLANNING_BINDING_QUERY_KEYS.includes(key))
  )
    return null;
  for (const key of PLANNING_BINDING_QUERY_KEYS) {
    if (searchParams.getAll(key).length !== 1) return null;
  }
  const actorValues = req.headersDistinct?.['x-openplanr-actor'];
  const actorFallback = req.headers['x-openplanr-actor'];
  const actorId = Array.isArray(actorValues)
    ? actorValues.length === 1
      ? actorValues[0]
      : null
    : typeof actorFallback === 'string'
      ? actorFallback
      : null;
  const generation = liveGeneration(searchParams);
  const binding = {
    actorId,
    projectId: searchParams.get('projectId'),
    scopeId: searchParams.get('scopeId'),
    domainId: searchParams.get('domainId'),
    domainVersion: searchParams.get('domainVersion'),
    generation,
  };
  if (
    !validLiveBinding(binding) ||
    binding.projectId !== projectId ||
    binding.scopeId !== PLANNING_SCOPE_ID ||
    binding.domainId !== PLANNING_DOMAIN_ID ||
    binding.domainVersion !== PLANNING_DOMAIN_VERSION ||
    (expectedActorId !== null && binding.actorId !== expectedActorId)
  )
    return null;
  return Object.freeze(binding);
}

function planningBindingError(res) {
  return dashboardSafeErrorJson(res, 403, {
    code: 'CAPABILITY_DENIED',
    retryable: false,
    context: {},
  });
}

function planningResponseError(res, status = 409) {
  return dashboardSafeErrorJson(res, status, {
    code: 'DASHBOARD_RESPONSE_INVALID',
    retryable: false,
    context: {},
  });
}

function validPlanningSubject(value) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 256 ||
    value === '.' ||
    value === '..' ||
    value.includes('\\')
  )
    return false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return ![...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

/** Closed structural assertion for the legacy watcher patch transported to React. */
export function assertPlanningPatch(value) {
  if (
    !exactKeys(value, ['updated', 'added', 'removed', 'edges']) ||
    !Array.isArray(value.updated) ||
    !Array.isArray(value.added) ||
    !Array.isArray(value.removed) ||
    !exactKeys(value.edges, ['added', 'removed']) ||
    !Array.isArray(value.edges.added) ||
    !Array.isArray(value.edges.removed)
  ) {
    throw new TypeError('Invalid Planning watcher patch.');
  }
  const nodes = (entries) =>
    entries.map((entry) => {
      const node = assertPlanningNode(entry);
      if (Object.hasOwn(node, 'body'))
        throw new TypeError('Planning watcher patches cannot include bodies.');
      return node;
    });
  const updated = nodes(value.updated);
  const added = nodes(value.added);
  const removed = value.removed.map((id) => {
    if (!validPlanningSubject(id)) throw new TypeError('Invalid Planning removed identity.');
    return id;
  });
  const allNodeIds = [...updated, ...added].map((node) => node.id);
  if (
    new Set(allNodeIds).size !== allNodeIds.length ||
    new Set(removed).size !== removed.length ||
    allNodeIds.some((id) => removed.includes(id))
  ) {
    throw new TypeError('Planning watcher patch has conflicting node operations.');
  }
  const edges = (entries) =>
    entries.map((edge) => {
      if (
        !exactKeys(edge, ['from', 'to', 'kind']) ||
        !validPlanningSubject(edge.from) ||
        !validPlanningSubject(edge.to) ||
        (edge.kind !== 'contains' && edge.kind !== 'depends_on')
      ) {
        throw new TypeError('Invalid Planning watcher edge.');
      }
      return Object.freeze({ from: edge.from, to: edge.to, kind: edge.kind });
    });
  const edgeAdded = edges(value.edges.added);
  const edgeRemoved = edges(value.edges.removed);
  const edgeKey = (edge) => `${edge.kind}\0${edge.from}\0${edge.to}`;
  const addedKeys = edgeAdded.map(edgeKey);
  const removedKeys = edgeRemoved.map(edgeKey);
  if (
    new Set(addedKeys).size !== addedKeys.length ||
    new Set(removedKeys).size !== removedKeys.length ||
    addedKeys.some((key) => removedKeys.includes(key))
  ) {
    throw new TypeError('Planning watcher patch has conflicting edge operations.');
  }
  return Object.freeze({
    updated: Object.freeze(updated),
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    edges: Object.freeze({ added: Object.freeze(edgeAdded), removed: Object.freeze(edgeRemoved) }),
  });
}

export function assertPlanningGraphEnvelope(value) {
  if (
    !exactKeys(value, ['kind', 'schemaVersion', 'binding', 'cursor', 'mode', 'graph']) ||
    value.kind !== 'planning-graph-snapshot' ||
    value.schemaVersion !== PLANNING_SCHEMA_VERSION ||
    !validLiveBinding(value.binding) ||
    !validLiveCursor(value.cursor) ||
    !PLANNING_MODES.has(value.mode)
  ) {
    throw new TypeError('Invalid Planning graph envelope.');
  }
  const graph = assertPlanningGraph(value.graph);
  if (sha256Jcs(graph) !== value.cursor.viewHash || detectMode(graph) !== value.mode) {
    throw new TypeError('Planning graph envelope is not bound to its graph.');
  }
  return Object.freeze({ ...value, graph });
}

export function assertPlanningDetailEnvelope(value) {
  if (
    !exactKeys(value, [
      'kind',
      'schemaVersion',
      'binding',
      'cursor',
      'subjectId',
      'node',
      'nodeHash',
    ]) ||
    value.kind !== 'planning-detail' ||
    value.schemaVersion !== PLANNING_SCHEMA_VERSION ||
    !validLiveBinding(value.binding) ||
    !validLiveCursor(value.cursor) ||
    !validPlanningSubject(value.subjectId) ||
    typeof value.nodeHash !== 'string' ||
    !LIVE_HASH.test(value.nodeHash)
  ) {
    throw new TypeError('Invalid Planning detail envelope.');
  }
  const node = assertPlanningNode(value.node, value.subjectId);
  if (sha256Jcs(node) !== value.nodeHash) {
    throw new TypeError('Planning detail envelope is not bound to its node.');
  }
  return Object.freeze({ ...value, node });
}

function assertPlanningPatchSignal(value, cursor) {
  if (
    !exactKeys(value, ['patchId', 'patchHash', 'from', 'to', 'patch']) ||
    typeof value.patchId !== 'string' ||
    !PLANNING_PATCH_ID.test(value.patchId) ||
    typeof value.patchHash !== 'string' ||
    !LIVE_HASH.test(value.patchHash) ||
    !validLiveCursor(value.from) ||
    !validLiveCursor(value.to) ||
    !sameLiveCursor(value.to, cursor) ||
    value.to.eventHead.sequence !== value.from.eventHead.sequence + 1 ||
    value.to.viewHash === value.from.viewHash
  ) {
    throw new TypeError('Invalid Planning live patch signal.');
  }
  const patch = assertPlanningPatch(value.patch);
  const patchDigest = sha256Jcs(patch);
  const expectedHeadHash = sha256Jcs({
    kind: 'planning-live-head',
    previous: value.from.eventHead,
    sequence: value.to.eventHead.sequence,
    patchHash: patchDigest,
    viewHash: value.to.viewHash,
  });
  if (
    value.to.eventHead.hash !== expectedHeadHash ||
    sha256Jcs({ from: value.from, to: value.to, patch }) !== value.patchHash ||
    value.patchId !== `ppatch_${value.to.eventHead.sequence}_${value.patchHash.slice(7, 23)}`
  ) {
    throw new TypeError('Planning live patch commitment is invalid.');
  }
  return Object.freeze({ ...value, patch });
}

export function assertPlanningLiveEventEnvelope(value) {
  if (
    !exactKeys(value, ['kind', 'schemaVersion', 'event', 'binding', 'cursor', 'payload']) ||
    value.kind !== 'planning-live-event' ||
    value.schemaVersion !== PLANNING_SCHEMA_VERSION ||
    !PLANNING_EVENT_KINDS.has(value.event) ||
    !validLiveBinding(value.binding) ||
    !validLiveCursor(value.cursor)
  ) {
    throw new TypeError('Invalid Planning live event envelope.');
  }
  let payload;
  if (value.event === 'snapshot') {
    if (!exactKeys(value.payload, ['mode', 'graph']) || !PLANNING_MODES.has(value.payload.mode)) {
      throw new TypeError('Invalid Planning live snapshot.');
    }
    const graph = assertPlanningGraph(value.payload.graph);
    if (sha256Jcs(graph) !== value.cursor.viewHash || detectMode(graph) !== value.payload.mode) {
      throw new TypeError('Planning live snapshot is not bound to its graph.');
    }
    payload = Object.freeze({ mode: value.payload.mode, graph });
  } else if (value.event === 'patch') {
    payload = assertPlanningPatchSignal(value.payload, value.cursor);
  } else if (value.event === 'ready') {
    if (
      !exactKeys(value.payload, ['readOnly', 'reasonCodes']) ||
      value.payload.readOnly !== true ||
      !Array.isArray(value.payload.reasonCodes) ||
      value.payload.reasonCodes.length !== 0
    ) {
      throw new TypeError('Invalid Planning live ready state.');
    }
    payload = Object.freeze({ readOnly: true, reasonCodes: Object.freeze([]) });
  } else {
    if (
      !exactKeys(value.payload, ['readOnly', 'reasonCodes', 'recovery']) ||
      value.payload.readOnly !== true ||
      !Array.isArray(value.payload.reasonCodes) ||
      value.payload.reasonCodes.length < 1 ||
      value.payload.reasonCodes.length > 8 ||
      value.payload.reasonCodes.some(
        (reason) => typeof reason !== 'string' || !PLANNING_REASON.test(reason),
      ) ||
      typeof value.payload.recovery !== 'string' ||
      value.payload.recovery.length < 1 ||
      value.payload.recovery.length > 240
    ) {
      throw new TypeError('Invalid Planning live stale state.');
    }
    payload = Object.freeze({
      readOnly: true,
      reasonCodes: Object.freeze([...value.payload.reasonCodes]),
      recovery: value.payload.recovery,
    });
  }
  return Object.freeze({ ...value, payload });
}

export function encodePlanningCheckpoint(cursor) {
  if (!validLiveCursor(cursor)) throw new TypeError('Invalid Planning checkpoint.');
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodePlanningCheckpoint(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!validLiveCursor(parsed) || encodePlanningCheckpoint(parsed) !== value) return null;
    return Object.freeze({
      eventHead: Object.freeze({ ...parsed.eventHead }),
      viewHash: parsed.viewHash,
    });
  } catch {
    return null;
  }
}

function planningCheckpointHeader(req) {
  const values = req.headersDistinct?.['last-event-id'];
  const fallback = req.headers['last-event-id'];
  if (values === undefined && fallback === undefined) {
    return Object.freeze({ valid: true, checkpoint: null });
  }
  const rawValues = Array.isArray(values) ? values : typeof fallback === 'string' ? [fallback] : [];
  if (rawValues.length !== 1) return Object.freeze({ valid: false, checkpoint: null });
  const checkpoint = decodePlanningCheckpoint(rawValues[0]);
  return Object.freeze({ valid: checkpoint !== null, checkpoint });
}

/**
 * Apply a watcher patch (`{ updated, added, removed, edges }`) to an in-memory
 * graph, returning a new graph. Updated nodes replace by id, added nodes append,
 * removed ids drop out; edges add/remove by their `kind from to` identity. Pure
 * — does not mutate the input — so the cache swap is atomic.
 */
export function applyPatch(graph, patch) {
  const base = graph && Array.isArray(graph.nodes) ? graph : { nodes: [], edges: [] };
  if (!patch) return { nodes: [...(base.nodes || [])], edges: [...(base.edges || [])] };

  const removed = new Set(patch.removed || []);
  const replaced = new Map((patch.updated || []).filter((n) => n && n.id).map((n) => [n.id, n]));

  const nodes = (base.nodes || [])
    .filter((n) => !removed.has(n.id))
    .map((n) => (replaced.has(n.id) ? replaced.get(n.id) : n));
  const have = new Set(nodes.map((n) => n.id));
  for (const n of patch.added || []) {
    if (n && n.id && !have.has(n.id)) {
      nodes.push(n);
      have.add(n.id);
    }
  }

  const edgePatch = patch.edges || { added: [], removed: [] };
  const edgeKey = (e) => `${e.kind} ${e.from} ${e.to}`;
  const dropEdges = new Set((edgePatch.removed || []).map(edgeKey));
  const edges = (base.edges || []).filter((e) => !dropEdges.has(edgeKey(e)));
  const haveEdges = new Set(edges.map(edgeKey));
  for (const e of edgePatch.added || []) {
    if (e && !haveEdges.has(edgeKey(e))) {
      edges.push(e);
      haveEdges.add(edgeKey(e));
    }
  }

  return { nodes, edges };
}

/** Refuse no-op/foreign patch operations before they can become a committed revision. */
function applyPlanningPatch(graph, patch) {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  if (
    patch.updated.some((node) => !nodeIds.has(node.id)) ||
    patch.added.some((node) => nodeIds.has(node.id)) ||
    patch.removed.some((id) => !nodeIds.has(id))
  ) {
    throw new TypeError('Planning watcher patch targets a foreign node revision.');
  }
  const edgeKey = (edge) => `${edge.kind}\0${edge.from}\0${edge.to}`;
  const edgeIds = new Set(graph.edges.map(edgeKey));
  if (
    patch.edges.added.some((edge) => edgeIds.has(edgeKey(edge))) ||
    patch.edges.removed.some((edge) => !edgeIds.has(edgeKey(edge)))
  ) {
    throw new TypeError('Planning watcher patch targets a foreign edge revision.');
  }
  const next = assertPlanningGraph(applyPatch(graph, patch));
  if (sha256Jcs(next) === sha256Jcs(graph)) {
    throw new TypeError('Planning watcher patch does not create a new graph revision.');
  }
  return next;
}

/**
 * Create the dashboard HTTP server. `getGraph` / `getNode` remain injectable so the
 * watcher can supply cached/patched readers without editing this module; the
 * defaults serve the in-memory `currentGraph` cache, which the watcher
 * patches in place. `watch` (default true) starts the filesystem watcher; pass
 * `watch: false` (the `--no-watch` flag) to suppress it.
 */
export function createDashboardServer({
  staticRoot,
  dashboardBuildId,
  planrDir = resolvePlanrDir(),
  watch = true,
  getGraph,
  getNode: suppliedGetNode,
  planningActorId = null,
  getOperatingProjection = () => readOperatingProjection(planrDir),
  getOperatingExperience = () => readOperateExperienceProjection(planrDir),
  getOperatingCycleRead = null,
  getOperatingReviewRead = null,
  getOperatingCommandGateway = null,
  getOperatingPlanningGateway = null,
} = {}) {
  const dashboardStaticRoot = resolveDashboardStaticRoot(staticRoot);
  const dashboardManifest = dashboardManifestState(dashboardStaticRoot);
  if (
    dashboardBuildId !== undefined &&
    (typeof dashboardBuildId !== 'string' || !DASHBOARD_BUILD_ID.test(dashboardBuildId))
  ) {
    throw new TypeError('dashboardBuildId must be a valid embedded dashboard build identity');
  }
  const expectedDashboardBuildId = dashboardBuildId ?? dashboardManifest.buildId;
  const project = safeProjectMetadata(planrDir);
  if (
    planningActorId !== null &&
    (typeof planningActorId !== 'string' || !LIVE_ID.test(planningActorId))
  ) {
    throw new TypeError('planningActorId must be a valid public actor identity');
  }
  // In-memory graph cache: seeded lazily, patched in place by the watcher so
  // fresh page loads and SSE clients see the same up-to-date graph (one truth).
  let planningSequence = 0;
  let planningHeadHash = null;
  let planningViewHash = null;
  let currentGraph = null;
  const readFreshGraph = (options = {}) =>
    assertPlanningGraph(
      typeof getGraph === 'function'
        ? getGraph(Object.freeze({ planrDir, scope: options.scope ?? null }))
        : buildGraph(planrDir, options),
    );
  const ensureGraph = () => {
    if (!currentGraph) {
      currentGraph = readFreshGraph();
      planningViewHash = sha256Jcs(currentGraph);
    }
    return currentGraph;
  };
  const readGraph = ensureGraph;
  const readNode = (id) => {
    const value =
      typeof suppliedGetNode === 'function' ? suppliedGetNode(id) : engineGetNode(planrDir, id);
    return value === null || value === undefined ? null : assertPlanningNode(value, id);
  };
  const planningCursor = () => {
    ensureGraph();
    return Object.freeze({
      eventHead: Object.freeze({ sequence: planningSequence, hash: planningHeadHash }),
      viewHash: planningViewHash,
    });
  };
  const planningGraphEnvelope = (binding) =>
    assertPlanningGraphEnvelope({
      kind: 'planning-graph-snapshot',
      schemaVersion: PLANNING_SCHEMA_VERSION,
      binding,
      cursor: planningCursor(),
      mode: detectMode(ensureGraph()),
      graph: ensureGraph(),
    });
  const planningLiveEnvelope = (event, binding, cursor, payload) =>
    assertPlanningLiveEventEnvelope({
      kind: 'planning-live-event',
      schemaVersion: PLANNING_SCHEMA_VERSION,
      event,
      binding,
      cursor,
      payload,
    });
  const planningSnapshotEvent = (binding) =>
    planningLiveEnvelope(
      'snapshot',
      binding,
      planningCursor(),
      Object.freeze({ mode: detectMode(ensureGraph()), graph: ensureGraph() }),
    );
  const planningReadyEvent = (binding) =>
    planningLiveEnvelope(
      'ready',
      binding,
      planningCursor(),
      Object.freeze({ readOnly: true, reasonCodes: Object.freeze([]) }),
    );
  const planningStaleEvent = (binding, reasonCode = 'PLANNING_EVENT_GAP') =>
    planningLiveEnvelope(
      'stale',
      binding,
      planningCursor(),
      Object.freeze({
        readOnly: true,
        reasonCodes: Object.freeze([reasonCode]),
        recovery: 'Refetch the validated Planning graph before applying more live events.',
      }),
    );
  const replayPlanningPatches = (checkpoint) => {
    const current = planningCursor();
    if (sameLiveCursor(checkpoint, current)) return Object.freeze([]);
    if (checkpoint.eventHead.sequence >= current.eventHead.sequence) return null;
    const chain = [];
    let cursor = checkpoint;
    for (let count = 0; count < planningPatchHistory.length; count += 1) {
      const signal = planningPatchHistory.find((entry) => sameLiveCursor(entry.from, cursor));
      if (!signal) return null;
      chain.push(signal);
      cursor = signal.to;
      if (sameLiveCursor(cursor, current)) return Object.freeze(chain);
    }
    return null;
  };
  let operatingCommandGatewayResolved = false;
  let operatingCommandGateway = null;
  const resolveOperatingCommandGateway = () => {
    if (!operatingCommandGatewayResolved) {
      operatingCommandGatewayResolved = true;
      try {
        operatingCommandGateway =
          typeof getOperatingCommandGateway === 'function' ? getOperatingCommandGateway() : null;
      } catch {
        // Capability discovery is optional. A broken provider remains safely unavailable.
        operatingCommandGateway = null;
      }
    }
    return operatingCommandGateway;
  };
  const supportsOperateSession = (gateway) =>
    gateway !== null &&
    typeof gateway?.issueSession === 'function' &&
    typeof gateway?.assertSessionBinding === 'function';
  const supportsGovernedAction = (gateway) =>
    supportsOperateSession(gateway) &&
    typeof gateway?.preview === 'function' &&
    typeof gateway?.assertPreviewBinding === 'function' &&
    typeof gateway?.confirm === 'function';
  let operatingPlanningGatewayResolved = false;
  let operatingPlanningGateway = null;
  const resolveOperatingPlanningGateway = () => {
    if (!operatingPlanningGatewayResolved) {
      operatingPlanningGateway =
        typeof getOperatingPlanningGateway === 'function' ? getOperatingPlanningGateway() : null;
      operatingPlanningGatewayResolved = true;
    }
    return operatingPlanningGateway;
  };

  /** Open SSE connections — the watcher broadcasts each patch to all of them. */
  const sseClients = new Set();
  const planningSseClients = new Set();
  const planningPatchHistory = [];
  const MAX_PLANNING_PATCH_HISTORY = 256;
  const operateSseClients = new Set();
  const operatePatchHistory = [];
  const MAX_OPERATE_PATCH_HISTORY = 256;
  let currentExperience = null;
  const readExperience = () => {
    try {
      const next = getOperatingExperience();
      const safe = next?.view
        ? Object.freeze({ ...next, view: buildOperateExperienceTransportView(next.view) })
        : next;
      currentExperience = safe;
      return safe;
    } catch {
      const refused = Object.freeze({
        available: true,
        readOnly: true,
        status: 'invalid',
        view: null,
        reasonCodes: ['OPERATE_PROJECTION_INVALID'],
        recovery: 'Refresh the validated access-safe snapshot through OpenPlanr.',
      });
      currentExperience = refused;
      return refused;
    }
  };
  const ensureExperience = () => currentExperience ?? readExperience();

  const dashboardQueryRoots = () => {
    const experience = ensureExperience();
    const view = experience?.view;
    const operate =
      view &&
      [view.actorId, view.scopeId, view.domainId, view.domainVersion].every(
        (value) => typeof value === 'string' && value.length > 0,
      )
        ? Object.freeze({
            actorId: view.actorId,
            projectId: project.projectId,
            scopeId: view.scopeId,
            domainId: view.domainId,
            domainVersion: view.domainVersion,
            generation: 0,
          })
        : null;
    const planning =
      planningActorId === null
        ? null
        : Object.freeze({
            actorId: planningActorId,
            projectId: project.projectId,
            scopeId: PLANNING_SCOPE_ID,
            domainId: PLANNING_DOMAIN_ID,
            domainVersion: PLANNING_DOMAIN_VERSION,
            generation: 0,
          });
    return Object.freeze({ planning, operate });
  };

  /** Watcher handle (started in listen() unless watching is disabled). */
  let watcher = null;

  /** Set by listen(): whether the last bind reused a running server, and its pid. */
  let reused = false;
  let ownerPid = process.pid;

  const server = createServer(async (req, res) => {
    let commandRequest = false;
    let planningRequest = false;
    let pathname = null;
    try {
      const url = new URL(req.url, 'http://localhost');
      pathname = url.pathname;
      commandRequest =
        (req.method === 'POST' && OPERATE_COMMAND_ROUTES.has(pathname)) ||
        (req.method === 'GET' && pathname.startsWith('/api/operate/planning/trace/'));
      assertLoopbackRequest(req, {
        port: req.socket.localPort,
        mutating: req.method !== 'GET' && req.method !== 'HEAD',
        hosts: ['127.0.0.1', 'localhost'],
      });
      const parts = pathname.split('/').filter(Boolean);

      if (req.method === 'GET' && pathname === '/api/bootstrap') {
        const hostHeaders = req.headersDistinct?.host;
        const requestedHost =
          typeof req.headers.host === 'string' &&
          Array.isArray(hostHeaders) &&
          hostHeaders.length === 1
            ? req.headers.host
            : '';
        const hostMatch = requestedHost.match(/^(127\.0\.0\.1|localhost):([1-9][0-9]{0,4})$/u);
        const localPort = req.socket.localPort;
        const origin =
          hostMatch && Number(hostMatch[2]) === localPort ? `http://${requestedHost}` : null;
        if (!origin) {
          return dashboardSafeErrorJson(res, 400, {
            code: 'DASHBOARD_LOOPBACK_HOST_INVALID',
            retryable: false,
            context: {},
          });
        }
        const reasonCodes = [...dashboardManifest.reasonCodes];
        if (
          dashboardManifest.buildId !== expectedDashboardBuildId &&
          !reasonCodes.includes('DASHBOARD_BUILD_MISMATCH')
        )
          reasonCodes.push('DASHBOARD_BUILD_MISMATCH');
        const body = {
          kind: 'dashboard-bootstrap',
          schemaVersion: '1.0.0',
          protocolVersion: '1.2.0',
          ui: {
            buildId: dashboardManifest.buildId,
            expectedBuildId: expectedDashboardBuildId,
            assetManifestHash: dashboardManifest.assetManifestHash,
          },
          server: { packageVersion: readPackageVersion() },
          capabilities: {
            planningGraph: { schemaVersion: '1.0.0' },
            operateExperience: { protocolVersion: '2.0.0', schemaVersion: '1.0.0' },
            operateCommands: {
              protocolVersion: '2.0.0',
              transportVersion: '1.0.0',
              available: supportsOperateSession(resolveOperatingCommandGateway()),
            },
            diagnostics: { schemaVersion: '1.0.0', available: true },
          },
          project,
          queryRoots: dashboardQueryRoots(),
          origin,
          compatibility: {
            status: reasonCodes.length === 0 ? 'compatible' : 'incompatible',
            reasonCodes,
          },
        };
        try {
          assertDashboardBootstrapV1(body);
        } catch {
          return dashboardSafeErrorJson(res, 500, {
            code: 'DASHBOARD_BOOTSTRAP_INVALID',
            retryable: false,
            context: {},
          });
        }
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(JSON.stringify(body));
        return undefined;
      }

      if (req.method === 'POST' && OPERATE_COMMAND_ROUTES.has(pathname)) {
        commandRequest = true;
        const route = OPERATE_COMMAND_ROUTES.get(pathname);
        const origin = commandOrigin(req);
        if (!origin) {
          return commandError(res, {
            code: 'OPERATE_ORIGIN_INVALID',
            status: 403,
          });
        }
        const binding = exactCommandBinding(req, url.searchParams, url.search);
        if (!binding) {
          return commandError(res, {
            code: 'OPERATE_BINDING_REQUIRED',
            status: 400,
          });
        }
        const gateway = resolveOperatingCommandGateway();
        const gatewaySupportsRoute =
          route.kind === 'session'
            ? supportsOperateSession(gateway)
            : route.kind === 'preview'
              ? supportsOperateSession(gateway) && typeof gateway?.preview === 'function'
              : route.kind === 'confirm'
                ? supportsGovernedAction(gateway)
                : supportsOperateSession(gateway);
        if (!gatewaySupportsRoute) {
          return commandError(res, {
            code: 'OPERATE_READ_ONLY',
            status: 409,
          });
        }
        const body = await readCommandBody(req);
        if (!exactRouteBody(body, route)) {
          return commandError(res, {
            code: 'OPERATE_COMMAND_INVALID',
            status: 400,
          });
        }
        let response;
        let experienceRefreshed = false;
        if (route.kind === 'session') {
          response = await gateway.issueSession({
            ...body,
            actor: {
              actorId: binding.actorId,
              kind: 'human',
              runtime: 'openplanr',
            },
            origin,
          });
          const closedSession = closedCommandSessionResponse(response, binding, body);
          if (!closedSession) {
            return commandError(res, {
              code: 'OPERATE_BINDING_MISMATCH',
              status: 403,
            });
          }
          response = closedSession;
        } else {
          const capability = bearerCapability(req);
          if (!capability) {
            return commandError(res, {
              code: 'OPERATE_SESSION_DENIED',
              status: 401,
            });
          }
          if (typeof gateway.assertSessionBinding !== 'function') {
            return commandError(res, {
              code: 'OPERATE_READ_ONLY',
              status: 409,
            });
          }
          const sessionBinding = await gateway.assertSessionBinding({
            sessionId: body.sessionId,
            capability,
            origin,
          });
          if (!validCommandSessionBinding(sessionBinding, binding)) {
            return commandError(res, {
              code: 'OPERATE_BINDING_MISMATCH',
              status: 403,
            });
          }
          if (route.kind.startsWith('planning-')) {
            const planningGateway = resolveOperatingPlanningGateway();
            if (!planningGateway) {
              return commandError(res, { code: 'OPERATE_READ_ONLY', status: 409 });
            }
            const request = {
              ...body,
              actor: {
                actorId: sessionBinding.actorId,
                kind: 'human',
                runtime: 'openplanr',
              },
              binding: structuredClone(sessionBinding),
            };
            delete request.sessionId;
            if (
              route.kind === 'planning-preview' &&
              typeof body.actionId === 'string' &&
              body.actionId !== sessionBinding.actionLocator?.subjectId
            ) {
              return commandError(res, {
                code: 'OPERATE_BINDING_MISMATCH',
                status: 403,
              });
            }
            response =
              route.kind === 'planning-preview'
                ? await planningGateway.preview(request)
                : await planningGateway.createSpec(request);
          } else {
            let expectedOperation = null;
            if (route.kind === 'confirm') {
              if (typeof gateway.assertPreviewBinding !== 'function') {
                return commandError(res, {
                  code: 'OPERATE_READ_ONLY',
                  status: 409,
                });
              }
              const proof = closedCommandPreviewProof(
                await gateway.assertPreviewBinding({
                  ...body,
                  capability,
                  origin,
                }),
                sessionBinding,
              );
              if (!proof) {
                return commandError(res, {
                  code: 'OPERATE_BINDING_MISMATCH',
                  status: 403,
                });
              }
              expectedOperation = proof.operation;
              if (Object.hasOwn(body, 'note') && expectedOperation !== 'operate.review.submit') {
                return commandError(res, {
                  code: 'OPERATE_COMMAND_INVALID',
                  status: 400,
                });
              }
            }
            response =
              route.kind === 'preview'
                ? await gateway.preview({ ...body, capability, origin })
                : await gateway.confirm({ ...body, capability, origin });
            if (route.kind === 'preview') {
              try {
                assertOperateExperiencePreviewV1(response, {
                  actorId: sessionBinding.actorId,
                  scopeId: sessionBinding.scopeId,
                  domainId: sessionBinding.domainId,
                  domainVersion: sessionBinding.domainVersion,
                  eventHead: sessionBinding.eventHead,
                  sourceViewHash: sessionBinding.sourceViewHash,
                  subjectId: sessionBinding.actionLocator.subjectId,
                  actionDigest: sessionBinding.actionLocator.actionDigest,
                });
              } catch {
                return commandError(res, {
                  code: 'OPERATE_PREVIEW_INVALID',
                  status: 409,
                });
              }
            } else {
              const responseRecord = safeDashboardErrorRecord(response);
              if (!responseRecord || typeof expectedOperation !== 'string') {
                return commandError(res, {
                  code: 'OPERATE_COMMAND_REFUSED',
                  status: 409,
                });
              }
              if (responseRecord.ok === true) {
                const refreshed = refreshOperatingExperience();
                experienceRefreshed = true;
                const committedHeadIsVisible =
                  expectedOperation === 'operate.review.submit'
                    ? currentHeadIncludesCommitted(
                        refreshed?.view?.eventHead,
                        responseRecord.eventHead,
                      )
                    : exactEventHead(refreshed?.view?.eventHead, responseRecord.eventHead);
                if (
                  !exactAdvancedHead(responseRecord.eventHead, sessionBinding.eventHead) ||
                  !refreshed?.view ||
                  !sameExperienceBinding(refreshed.view, sessionBinding) ||
                  !committedHeadIsVisible
                ) {
                  return commandError(res, {
                    code: 'OPERATION_UNCERTAIN',
                    status: 409,
                  });
                }
                let reviewWorkspace = null;
                if (
                  expectedOperation === 'operate.review.submit' &&
                  typeof getOperatingReviewRead === 'function'
                ) {
                  try {
                    reviewWorkspace = await getOperatingReviewRead(
                      Object.freeze({
                        cycleId: sessionBinding.cycleId,
                        reviewId: sessionBinding.actionLocator.subjectId,
                        actorId: sessionBinding.actorId,
                        scopeId: sessionBinding.scopeId,
                        domainId: sessionBinding.domainId,
                        domainVersion: sessionBinding.domainVersion,
                      }),
                    );
                  } catch {
                    reviewWorkspace = null;
                  }
                }
                const closedSuccess =
                  expectedOperation === 'operate.review.submit'
                    ? closedReviewCommandSuccessResponse(
                        response,
                        refreshed.view,
                        reviewWorkspace,
                        sessionBinding,
                        Object.hasOwn(body, 'note') ? body.note : null,
                      )
                    : closedCommandSuccessResponse(response, expectedOperation, refreshed.view);
                if (!closedSuccess) {
                  return commandError(res, {
                    code: 'OPERATION_UNCERTAIN',
                    status: 409,
                  });
                }
                response = closedSuccess;
              } else if (responseRecord.ok === false) {
                let reviewWorkspace = null;
                if (
                  expectedOperation === 'operate.review.submit' &&
                  typeof getOperatingReviewRead === 'function'
                ) {
                  const refreshed = refreshOperatingExperience();
                  experienceRefreshed = true;
                  if (refreshed?.view) {
                    try {
                      const candidate = await getOperatingReviewRead(
                        Object.freeze({
                          cycleId: sessionBinding.cycleId,
                          reviewId: sessionBinding.actionLocator.subjectId,
                          actorId: sessionBinding.actorId,
                          scopeId: sessionBinding.scopeId,
                          domainId: sessionBinding.domainId,
                          domainVersion: sessionBinding.domainVersion,
                        }),
                      );
                      reviewWorkspace = closedReviewWorkspace(
                        candidate,
                        sessionBinding,
                        sessionBinding.cycleId,
                        sessionBinding.actionLocator.subjectId,
                        refreshed.view,
                      );
                    } catch {
                      reviewWorkspace = null;
                    }
                  }
                }
                const closedFailure =
                  expectedOperation === 'operate.review.submit'
                    ? closedReviewCommandFailureResponse(response, reviewWorkspace)
                    : closedCommandFailureResponse(response, expectedOperation);
                if (!closedFailure) {
                  return commandError(res, {
                    code: 'OPERATE_COMMAND_REFUSED',
                    status: 409,
                  });
                }
                response = closedFailure;
              } else {
                return commandError(res, {
                  code: 'OPERATE_COMMAND_REFUSED',
                  status: 409,
                });
              }
            }
          }
        }
        if (!experienceRefreshed) refreshOperatingExperience();
        return experienceJson(res, 200, response);
      }

      if (req.method === 'GET' && pathname === '/health') {
        return json(res, 200, {
          ok: true,
          kind: DASHBOARD_SERVER_KIND,
          version: readPackageVersion(),
          pid: process.pid,
        });
      }

      if (req.method === 'GET' && pathname === '/api/planning/graph') {
        planningRequest = true;
        const binding = planningRequestBinding(
          req,
          url.searchParams,
          project.projectId,
          planningActorId,
        );
        if (!binding) return planningBindingError(res);
        return planningJson(res, 200, planningGraphEnvelope(binding));
      }

      if (req.method === 'GET' && pathname.startsWith('/api/planning/detail/')) {
        planningRequest = true;
        const binding = planningRequestBinding(
          req,
          url.searchParams,
          project.projectId,
          planningActorId,
        );
        if (!binding) return planningBindingError(res);
        const rawSubject = pathname.slice('/api/planning/detail/'.length);
        let subjectId;
        try {
          subjectId = decodeURIComponent(rawSubject);
        } catch {
          return planningResponseError(res, 400);
        }
        if (
          !validPlanningSubject(subjectId) ||
          rawSubject.includes('/') ||
          encodeURIComponent(subjectId) !== rawSubject
        ) {
          return planningResponseError(res, 400);
        }
        const graph = ensureGraph();
        const summary = graph.nodes.find((node) => node.id === subjectId);
        if (!summary) return planningResponseError(res, 404);
        const node = readNode(subjectId);
        if (!node) return planningResponseError(res, 404);
        const summaryFields = Object.fromEntries(
          Object.entries(node).filter(([key]) => key !== 'body'),
        );
        if (sha256Jcs(summaryFields) !== sha256Jcs(summary)) {
          return planningResponseError(res);
        }
        const envelope = assertPlanningDetailEnvelope({
          kind: 'planning-detail',
          schemaVersion: PLANNING_SCHEMA_VERSION,
          binding,
          cursor: planningCursor(),
          subjectId,
          node,
          nodeHash: sha256Jcs(node),
        });
        return planningJson(res, 200, envelope);
      }

      if (req.method === 'GET' && pathname === '/api/planning/events') {
        planningRequest = true;
        const binding = planningRequestBinding(
          req,
          url.searchParams,
          project.projectId,
          planningActorId,
        );
        if (!binding) return planningBindingError(res);
        const header = planningCheckpointHeader(req);
        if (!header.valid) return planningResponseError(res, 400);
        const frames = [];
        if (header.checkpoint === null) {
          const event = planningSnapshotEvent(binding);
          frames.push(sseFrame('snapshot', event, encodePlanningCheckpoint(event.cursor)));
        } else if (sameLiveCursor(header.checkpoint, planningCursor())) {
          const event = planningReadyEvent(binding);
          frames.push(sseFrame('ready', event, encodePlanningCheckpoint(event.cursor)));
        } else {
          const replay = replayPlanningPatches(header.checkpoint);
          if (replay === null) {
            const event = planningStaleEvent(binding);
            frames.push(sseFrame('stale', event, encodePlanningCheckpoint(event.cursor)));
          } else {
            for (const signal of replay) {
              const event = planningLiveEnvelope('patch', binding, signal.to, signal);
              frames.push(sseFrame('patch', event, encodePlanningCheckpoint(event.cursor)));
            }
          }
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        for (const frame of frames) res.write(frame);
        const client = Object.freeze({ res, binding });
        planningSseClients.add(client);
        req.on('close', () => planningSseClients.delete(client));
        return undefined;
      }

      if (req.method === 'GET' && pathname === '/api/graph') {
        return json(res, 200, readGraph());
      }

      if (req.method === 'GET' && pathname === '/api/operate/local-reviews') {
        const pageValue = url.searchParams.get('page');
        const pageSizeValue = url.searchParams.get('pageSize');
        const page = pageValue === null ? 1 : Number(pageValue);
        const pageSize = pageSizeValue === null ? 20 : Number(pageSizeValue);
        if (
          [...url.searchParams.keys()].some((key) => key !== 'page' && key !== 'pageSize') ||
          [...url.searchParams.getAll('page')].length > 1 ||
          [...url.searchParams.getAll('pageSize')].length > 1 ||
          !Number.isSafeInteger(page) ||
          page < 1 ||
          !Number.isSafeInteger(pageSize) ||
          pageSize < 1 ||
          pageSize > 50
        ) {
          return dashboardSafeErrorJson(res, 400, {
            code: 'DASHBOARD_RESPONSE_INVALID',
            retryable: false,
            context: {},
          });
        }
        return experienceJson(res, 200, readLocalOperateReviewIndex(planrDir, { page, pageSize }));
      }

      if (
        req.method === 'GET' &&
        parts.length === 4 &&
        parts.slice(0, 3).join('/') === 'api/operate/local-reviews'
      ) {
        let cycleId;
        try {
          cycleId = decodeURIComponent(parts[3]);
        } catch {
          cycleId = '';
        }
        const report = readLocalOperateReview(planrDir, cycleId);
        return report
          ? experienceJson(res, 200, report)
          : dashboardSafeErrorJson(res, 404, {
              code: 'DASHBOARD_ERROR_UNAVAILABLE',
              retryable: false,
              context: {},
            });
      }

      if (req.method === 'GET' && pathname === '/api/operate') {
        return json(res, 200, getOperatingProjection());
      }

      if (
        req.method === 'GET' &&
        parts.length === 5 &&
        parts.slice(0, 4).join('/') === 'api/operate/planning/trace'
      ) {
        commandRequest = true;
        if (!OPERATE_SUBJECT_SEGMENT.test(parts[4])) {
          return commandError(res, { code: 'OPERATE_COMMAND_INVALID', status: 400 });
        }
        const localHost = loopbackCommandHost(req);
        const binding = exactCommandBinding(req, url.searchParams, url.search);
        if (!localHost) {
          return commandError(res, { code: 'OPERATE_ORIGIN_INVALID', status: 403 });
        }
        if (!binding) {
          return commandError(res, { code: 'OPERATE_BINDING_REQUIRED', status: 400 });
        }
        const planningGateway = resolveOperatingPlanningGateway();
        if (!planningGateway) {
          return commandError(res, { code: 'OPERATE_READ_ONLY', status: 409 });
        }
        const response = await planningGateway.trace({
          specId: parts[4],
          actor: { actorId: binding.actorId, kind: 'human', runtime: 'openplanr' },
          binding: structuredClone(binding),
        });
        return experienceJson(res, 200, response);
      }

      if (req.method === 'GET' && pathname.startsWith('/api/operate/')) {
        const route = parseOperateRoute(pathname);
        if (!route) {
          return experienceJson(res, 400, {
            ok: false,
            error: {
              reasonCode: 'OPERATE_ROUTE_INVALID',
              message: 'The operating route does not match a documented surface shape.',
              retryable: false,
            },
          });
        }
        if (hasInvalidOperateQuery(route, url.searchParams)) {
          return experienceJson(res, 400, {
            ok: false,
            error: {
              reasonCode: 'OPERATE_QUERY_INVALID',
              message: 'The operating route accepts only its documented query fields.',
              retryable: false,
            },
          });
        }
        const binding = experienceBinding(req, url.searchParams);
        if (!binding) {
          return experienceJson(res, 400, {
            ok: false,
            error: {
              reasonCode: 'OPERATE_BINDING_REQUIRED',
              message: 'Actor, scope, domain, and domain version are required.',
              retryable: false,
            },
          });
        }
        const requestedAuditSurface = OPERATE_AUDIT_DISPLAY_SURFACES.has(route.surface);
        const requestedAuditCycleId = requestedAuditSurface
          ? url.searchParams.get('cycleId')
          : null;
        if (
          requestedAuditSurface &&
          (requestedAuditCycleId === null || !OPERATE_SUBJECT_SEGMENT.test(requestedAuditCycleId))
        ) {
          return experienceJson(res, 400, {
            ok: false,
            error: {
              reasonCode: 'OPERATE_QUERY_INVALID',
              message: 'The operating audit route requires one exact Cycle binding.',
              retryable: false,
            },
          });
        }
        const requestedAuditQuery =
          route.surface === 'search' ? (url.searchParams.get('q') ?? '') : null;
        const requestedAuditFormat =
          route.surface === 'export' ? (url.searchParams.get('format') ?? 'json') : null;
        if (
          (route.surface === 'search' && requestedAuditQuery.length > 512) ||
          (route.surface === 'export' && !['json', 'html'].includes(requestedAuditFormat))
        ) {
          return experienceJson(res, 400, {
            ok: false,
            error: {
              reasonCode: 'OPERATE_QUERY_INVALID',
              message: 'The operating audit selection is invalid.',
              retryable: false,
            },
          });
        }
        const requestedLiveSurface =
          pathname === '/api/operate/events' ? (url.searchParams.get('surface') ?? 'today') : null;
        if (
          pathname === '/api/operate/events' &&
          !['today', 'inbox'].includes(requestedLiveSurface)
        ) {
          return experienceJson(res, 400, {
            ok: false,
            error: {
              reasonCode: 'OPERATE_QUERY_INVALID',
              message: 'The operating live route accepts only a documented display surface.',
              retryable: false,
            },
          });
        }
        const requestedActionsCycleId =
          route.surface === 'actions' ? url.searchParams.get('cycleId') : null;
        if (
          route.surface === 'actions' &&
          (requestedActionsCycleId === null ||
            !OPERATE_SUBJECT_SEGMENT.test(requestedActionsCycleId))
        ) {
          return experienceJson(res, 400, {
            ok: false,
            error: {
              reasonCode: 'OPERATE_QUERY_INVALID',
              message: 'The operating Actions route requires one exact Cycle binding.',
              retryable: false,
            },
          });
        }
        const inboxSnapshot =
          route.surface === 'inbox' ||
          (pathname === '/api/operate/events' && requestedLiveSurface === 'inbox');
        const actionsSnapshot = pathname === '/api/operate/actions';
        const generation =
          pathname === '/api/operate/events' || inboxSnapshot || actionsSnapshot
            ? liveGeneration(url.searchParams)
            : undefined;
        if (
          (pathname === '/api/operate/events' || inboxSnapshot || actionsSnapshot) &&
          generation === null
        ) {
          return experienceJson(res, 400, {
            ok: false,
            error: {
              reasonCode: 'OPERATE_GENERATION_INVALID',
              message: 'The live request generation must be a non-negative safe integer.',
              retryable: false,
            },
          });
        }
        if (
          (inboxSnapshot || actionsSnapshot) &&
          url.searchParams.get('projectId') !== project.projectId
        ) {
          return experienceJson(res, 403, {
            ok: false,
            error: {
              reasonCode: 'OPERATE_BINDING_MISMATCH',
              message: 'The requested operating view is unavailable for this project.',
              retryable: false,
            },
          });
        }
        const checkpointHeader =
          pathname === '/api/operate/events' ? liveCheckpointHeader(req) : undefined;
        if (checkpointHeader && !checkpointHeader.valid) {
          return experienceJson(res, 400, {
            ok: false,
            error: {
              reasonCode: 'OPERATE_CHECKPOINT_INVALID',
              message: 'The live checkpoint is invalid. Refresh the access-safe snapshot.',
              retryable: false,
            },
          });
        }
        const read = ensureExperience();
        if (!read?.view) {
          return experienceJson(res, read?.status === 'absent' ? 404 : 409, {
            ok: false,
            error: {
              reasonCode: read?.reasonCodes?.[0] ?? 'OPERATE_PROJECTION_UNAVAILABLE',
              message: 'The operating experience is unavailable until OpenPlanr refreshes it.',
              retryable: false,
            },
          });
        }
        if (!sameExperienceBinding(read.view, binding)) {
          return experienceJson(res, 403, {
            ok: false,
            error: {
              reasonCode: 'OPERATE_BINDING_MISMATCH',
              message: 'The requested operating view is unavailable for this actor and scope.',
              retryable: false,
            },
          });
        }

        if (pathname === '/api/operate/events') {
          const checkpoint = checkpointHeader?.checkpoint ?? null;
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
            connection: 'keep-alive',
          });
          const current = read.view;
          const currentId = encodeOperateExperienceCheckpoint(current);
          const liveBinding = Object.freeze({
            ...binding,
            projectId: project.projectId,
            generation,
          });
          const currentCursor = Object.freeze({
            eventHead: current.eventHead,
            viewHash: current.viewHash,
          });
          if (!checkpoint) {
            const surface = selectOperateExperienceDisplaySurface(current, {
              surface: requestedLiveSurface,
              binding: {
                ...binding,
                generatedAt: current.generatedAt,
                eventHead: current.eventHead,
                viewHash: current.viewHash,
                surface: requestedLiveSurface,
                ...(requestedLiveSurface === 'inbox'
                  ? { projectId: project.projectId, generation, subjectId: null }
                  : {}),
              },
            });
            res.write(
              sseFrame(
                'snapshot',
                createDashboardLiveEventEnvelope({
                  event: 'snapshot',
                  binding: liveBinding,
                  cursor: currentCursor,
                  payload: surface,
                }),
                currentId,
              ),
            );
          } else if (
            checkpoint.viewHash === current.viewHash &&
            checkpoint.eventHead.sequence === current.eventHead.sequence &&
            checkpoint.eventHead.hash === current.eventHead.hash
          ) {
            const currentSurface = selectOperateExperienceDisplaySurface(current, {
              surface: requestedLiveSurface,
              binding: {
                ...binding,
                generatedAt: current.generatedAt,
                eventHead: current.eventHead,
                viewHash: current.viewHash,
                surface: requestedLiveSurface,
                ...(requestedLiveSurface === 'inbox'
                  ? { projectId: project.projectId, generation, subjectId: null }
                  : {}),
              },
            });
            res.write(
              sseFrame(
                'ready',
                createDashboardLiveEventEnvelope({
                  event: 'ready',
                  binding: liveBinding,
                  cursor: currentCursor,
                  payload: {
                    mutationEnabled:
                      currentSurface.kind === 'operate-experience-display-surface' &&
                      currentSurface.payload.status === 'ready' &&
                      currentSurface.payload.mutationEnabled === true,
                    reasonCodes:
                      currentSurface.kind === 'operate-experience-display-surface'
                        ? currentSurface.payload.reasonCodes
                        : ['OPERATE_PROJECTION_UNAVAILABLE'],
                  },
                }),
                currentId,
              ),
            );
          } else {
            const chain = [];
            let expectedViewHash = checkpoint.viewHash;
            let expectedHead = checkpoint.eventHead;
            for (const patch of operatePatchHistory) {
              if (
                patch.fromViewHash !== expectedViewHash ||
                patch.fromEventHead.sequence !== expectedHead.sequence ||
                patch.fromEventHead.hash !== expectedHead.hash
              )
                continue;
              chain.push(patch);
              expectedViewHash = patch.toViewHash;
              expectedHead = patch.toEventHead;
              if (expectedViewHash === current.viewHash) break;
            }
            const complete =
              chain.length > 0 &&
              expectedViewHash === current.viewHash &&
              expectedHead.sequence === current.eventHead.sequence &&
              expectedHead.hash === current.eventHead.hash;
            if (complete && requestedLiveSurface === 'inbox') {
              const surface = selectOperateExperienceDisplaySurface(current, {
                surface: 'inbox',
                binding: {
                  ...binding,
                  generatedAt: current.generatedAt,
                  eventHead: current.eventHead,
                  viewHash: current.viewHash,
                  surface: 'inbox',
                  projectId: project.projectId,
                  generation,
                  subjectId: null,
                },
              });
              res.write(
                sseFrame(
                  'snapshot',
                  createDashboardLiveEventEnvelope({
                    event: 'snapshot',
                    binding: liveBinding,
                    cursor: currentCursor,
                    payload: surface,
                  }),
                  currentId,
                ),
              );
            } else if (complete) {
              for (const patch of chain) {
                const cursor = { eventHead: patch.toEventHead, viewHash: patch.toViewHash };
                res.write(
                  sseFrame(
                    'patch',
                    createDashboardLiveEventEnvelope({
                      event: 'patch',
                      binding: liveBinding,
                      cursor,
                      payload: patch,
                    }),
                    encodeOperateExperienceCheckpoint(cursor),
                  ),
                );
              }
            } else {
              res.write(
                sseFrame(
                  'stale',
                  createDashboardLiveEventEnvelope({
                    event: 'stale',
                    binding: liveBinding,
                    cursor: currentCursor,
                    payload: {
                      mutationEnabled: false,
                      reasonCodes: ['OPERATE_EVENT_GAP'],
                      recovery: 'Refresh the validated snapshot before submitting any command.',
                    },
                  }),
                  currentId,
                ),
              );
            }
          }
          const client = { res, binding: liveBinding, surface: requestedLiveSurface };
          operateSseClients.add(client);
          req.on('close', () => operateSseClients.delete(client));
          return undefined;
        }

        if (route.surface === 'cycle-executive-board') {
          const response = selectOperateExecutiveBoardDisplay(read.view, {
            binding: {
              ...binding,
              cycleId: route.subjectId,
              subjectId: route.subjectId,
              generatedAt: read.view.generatedAt,
              eventHead: read.view.eventHead,
              viewHash: read.view.viewHash,
            },
            subjectId: route.subjectId,
          });
          return experienceJson(res, response.ok === false ? response.status : 200, response);
        }

        if (route.surface === 'review') {
          if (typeof getOperatingReviewRead !== 'function') {
            return experienceJson(res, 409, {
              ok: false,
              error: {
                reasonCode: 'OPERATE_PROJECTION_UNAVAILABLE',
                message:
                  'The Review workspace is unavailable until OpenPlanr connects its owner read.',
                retryable: false,
              },
            });
          }
          let workspace;
          try {
            workspace = await getOperatingReviewRead(
              Object.freeze({
                cycleId: route.cycleId,
                reviewId: route.subjectId,
                actorId: binding.actorId,
                scopeId: binding.scopeId,
                domainId: binding.domainId,
                domainVersion: binding.domainVersion,
              }),
            );
          } catch {
            return experienceJson(res, 409, {
              ok: false,
              error: {
                reasonCode: 'OPERATE_PROJECTION_UNAVAILABLE',
                message:
                  'The Review workspace is unavailable until OpenPlanr refreshes its owner read.',
                retryable: false,
              },
            });
          }
          const closed = closedReviewWorkspace(
            workspace,
            binding,
            route.cycleId,
            route.subjectId,
            read.view,
          );
          if (!closed) {
            return experienceJson(res, 409, {
              ok: false,
              error: {
                reasonCode: 'OPERATE_BINDING_MISMATCH',
                message:
                  'The Review workspace does not match the current actor-bound operating view.',
                retryable: false,
              },
            });
          }
          return experienceJson(res, 200, closed);
        }

        if (route.surface === 'action') {
          const commandGateway = resolveOperatingCommandGateway();
          const response = selectOperateActionDisplayWorkspace(read.view, {
            binding: {
              ...binding,
              actionId: route.subjectId,
              subjectId: route.subjectId,
              generatedAt: read.view.generatedAt,
              eventHead: read.view.eventHead,
              viewHash: read.view.viewHash,
            },
            subjectId: route.subjectId,
            commandsAvailable: supportsGovernedAction(commandGateway),
          });
          return experienceJson(res, response.ok === false ? response.status : 200, response);
        }

        if (route.surface === 'cycle') {
          if (typeof getOperatingCycleRead !== 'function') {
            return experienceJson(res, 409, {
              ok: false,
              error: {
                reasonCode: 'OPERATE_PROJECTION_UNAVAILABLE',
                message:
                  'The Cycle workspace is unavailable until OpenPlanr connects its owner read.',
                retryable: false,
              },
            });
          }
          let cycleRead;
          try {
            cycleRead = await getOperatingCycleRead(
              Object.freeze({
                cycleId: route.subjectId,
                actorId: binding.actorId,
                scopeId: binding.scopeId,
                domainId: binding.domainId,
                domainVersion: binding.domainVersion,
              }),
            );
          } catch {
            return experienceJson(res, 409, {
              ok: false,
              error: {
                reasonCode: 'OPERATE_PROJECTION_UNAVAILABLE',
                message:
                  'The Cycle workspace is unavailable until OpenPlanr refreshes its owner read.',
                retryable: false,
              },
            });
          }
          const response = selectOperateCycleDisplayWorkspace(read.view, cycleRead, {
            binding: {
              ...binding,
              cycleId: route.subjectId,
              subjectId: route.subjectId,
              generatedAt: read.view.generatedAt,
              eventHead: read.view.eventHead,
              viewHash: read.view.viewHash,
            },
            subjectId: route.subjectId,
          });
          return experienceJson(res, response.ok === false ? response.status : 200, response);
        }

        if (route.surface === 'recovery') {
          const gateway = resolveOperatingCommandGateway();
          if (!gateway || typeof gateway.inspectRecovery !== 'function') {
            return experienceJson(res, 409, {
              ok: false,
              error: {
                reasonCode: 'OPERATE_READ_ONLY',
                message: 'Recovery inspection is unavailable until OpenPlanr is connected.',
                retryable: false,
              },
            });
          }
          let recoveryRead;
          try {
            recoveryRead = await gateway.inspectRecovery();
          } catch {
            return experienceJson(res, 409, {
              ok: false,
              error: {
                reasonCode: 'OPERATE_PROJECTION_UNAVAILABLE',
                message: 'Recovery inspection is unavailable until OpenPlanr refreshes it.',
                retryable: false,
              },
            });
          }
          const response = selectOperateRecoveryDisplay(read.view, recoveryRead, {
            binding: {
              ...binding,
              generatedAt: read.view.generatedAt,
              eventHead: read.view.eventHead,
              viewHash: read.view.viewHash,
            },
          });
          return experienceJson(res, response.ok === false ? response.status : 200, response);
        }

        const displaySurface = ['today', 'inbox', 'cycles', 'actions'].includes(route.surface);
        const auditDisplaySurface = requestedAuditSurface;
        const auditCycleId = requestedAuditCycleId;
        const response =
          route.surface === 'inbox' && route.subjectId !== null
            ? selectOperateInboxItemDisplaySurface(read.view, {
                binding: {
                  ...binding,
                  generatedAt: read.view.generatedAt,
                  eventHead: read.view.eventHead,
                  viewHash: read.view.viewHash,
                  surface: 'inbox',
                  projectId: project.projectId,
                  generation,
                  subjectId: route.subjectId,
                },
                subjectId: route.subjectId,
              })
            : displaySurface
              ? selectOperateExperienceDisplaySurface(read.view, {
                  surface: route.surface,
                  binding: {
                    ...binding,
                    generatedAt: read.view.generatedAt,
                    eventHead: read.view.eventHead,
                    viewHash: read.view.viewHash,
                    surface: route.surface,
                    ...(route.surface === 'inbox' || route.surface === 'actions'
                      ? { projectId: project.projectId, generation }
                      : {}),
                    subjectId: route.subjectId,
                    cycleId:
                      route.surface === 'cycle'
                        ? route.subjectId
                        : route.surface === 'actions'
                          ? requestedActionsCycleId
                          : route.subjectId,
                  },
                  subjectId: route.subjectId,
                  cycleId:
                    route.surface === 'actions'
                      ? requestedActionsCycleId
                      : route.surface === 'cycle'
                        ? route.subjectId
                        : null,
                })
              : auditDisplaySurface
                ? selectOperateExperienceAuditDisplaySurface(read.view, {
                    surface: route.surface,
                    binding: {
                      ...binding,
                      cycleId: auditCycleId,
                      subjectId: route.subjectId,
                      surface: route.surface,
                      query: requestedAuditQuery,
                      format: requestedAuditFormat,
                      generatedAt: read.view.generatedAt,
                      eventHead: read.view.eventHead,
                      viewHash: read.view.viewHash,
                    },
                    subjectId: route.subjectId,
                    cycleId: auditCycleId,
                    query: requestedAuditQuery,
                    format: requestedAuditFormat,
                  })
                : selectOperateExperienceSurface(read.view, {
                    surface: route.surface,
                    binding,
                    subjectId: route.subjectId,
                    cycleId: route.surface === 'actions' ? requestedActionsCycleId : null,
                    query: url.searchParams.get('q') ?? '',
                    format: url.searchParams.get('format') ?? 'json',
                    projectId: route.surface === 'actions' ? project.projectId : null,
                    generation: route.surface === 'actions' ? generation : null,
                  });
        return experienceJson(res, response.ok === false ? response.status : 200, response);
      }

      // Shell metadata: lets the client pre-select the landing view, render the
      // planr-dir breadcrumb, and show the version chip without hard-coding any
      // of it (the version comes from package.json — one source of truth).
      if (req.method === 'GET' && pathname === '/api/meta') {
        const metaGraph = readGraph();
        const repoRoot = dirname(planrDir);
        return json(res, 200, {
          version: readPackageVersion(),
          planrDir,
          repo: repoRoot.split(sep).filter(Boolean).pop() || 'project',
          branch: readGitBranch(repoRoot),
          specs: (metaGraph.nodes || []).filter((n) => n && n.type === 'spec').length,
          mode: detectMode(metaGraph),
          views: DASHBOARD_VIEWS,
          defaultView: DEFAULT_VIEW,
        });
      }

      if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'node' && parts[2]) {
        const id = decodeURIComponent(parts.slice(2).join('/'));
        const node = readNode(id);
        if (!node) return json(res, 404, { error: `unknown node "${id}"` });
        return json(res, 200, node);
      }

      if (req.method === 'GET' && pathname === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write('event: ready\n');
        res.write(`data: ${JSON.stringify({ ok: true, pid: process.pid })}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return undefined; // keep the stream open
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        return serveStaticFile(res, dashboardStaticRoot, pathname, MIME);
      }

      return json(res, 404, { error: 'not found' });
    } catch (err) {
      if (String(err?.code ?? '').startsWith('E_LOOPBACK_')) {
        if (
          req.method === 'GET' &&
          pathname === '/api/bootstrap' &&
          err.code === 'E_LOOPBACK_HOST'
        ) {
          return dashboardSafeErrorJson(res, 400, {
            code: 'DASHBOARD_LOOPBACK_HOST_INVALID',
            retryable: false,
            context: {},
          });
        }
        if (commandRequest) {
          return commandError(res, {
            code: 'OPERATE_ORIGIN_INVALID',
            status: 403,
          });
        }
        return dashboardSafeErrorJson(res, 400, {
          code: 'DASHBOARD_LOOPBACK_REQUEST_REJECTED',
          retryable: false,
          context: {},
        });
      }
      if (commandRequest) return commandError(res, err);
      if (planningRequest) return planningResponseError(res);
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return undefined;
      }
      return json(res, 500, { error: 'dashboard request unavailable' });
    }
  });

  /**
   * Receive a watcher patch: update the in-memory cache, then push the patch to
   * every open SSE client as a default `message` event (the client merges it in
   * place, preserving selection / view / zoom / filters).
   */
  const onWatcherPatch = (patch) => {
    let accepted;
    let next;
    try {
      accepted = assertPlanningPatch(patch);
      next = applyPlanningPatch(ensureGraph(), accepted);
    } catch {
      for (const client of planningSseClients) {
        try {
          const event = planningStaleEvent(client.binding, 'PLANNING_PATCH_INVALID');
          client.res.write(sseFrame('stale', event, encodePlanningCheckpoint(event.cursor)));
        } catch {
          planningSseClients.delete(client);
        }
      }
      return false;
    }

    const from = planningCursor();
    const viewHash = sha256Jcs(next);
    const patchDigest = sha256Jcs(accepted);
    const nextSequence = from.eventHead.sequence + 1;
    const headHash = sha256Jcs({
      kind: 'planning-live-head',
      previous: from.eventHead,
      sequence: nextSequence,
      patchHash: patchDigest,
      viewHash,
    });
    const to = Object.freeze({
      eventHead: Object.freeze({ sequence: nextSequence, hash: headHash }),
      viewHash,
    });
    const patchHash = sha256Jcs({ from, to, patch: accepted });
    const signal = assertPlanningPatchSignal(
      {
        patchId: `ppatch_${nextSequence}_${patchHash.slice(7, 23)}`,
        patchHash,
        from,
        to,
        patch: accepted,
      },
      to,
    );

    currentGraph = next;
    planningSequence = nextSequence;
    planningHeadHash = headHash;
    planningViewHash = viewHash;
    planningPatchHistory.push(signal);
    if (planningPatchHistory.length > MAX_PLANNING_PATCH_HISTORY) planningPatchHistory.shift();

    const frame = `data: ${JSON.stringify(accepted)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(frame);
      } catch {
        sseClients.delete(client);
      }
    }
    for (const client of planningSseClients) {
      try {
        const event = planningLiveEnvelope('patch', client.binding, to, signal);
        client.res.write(sseFrame('patch', event, encodePlanningCheckpoint(to)));
      } catch {
        planningSseClients.delete(client);
      }
    }
    return true;
  };

  const onExperienceChange = ({ previous, next }) => {
    currentExperience = next;
    const before = previous?.view;
    const after = next?.view;
    let patch = null;
    if (before && after) {
      try {
        patch = buildOperateExperienceLivePatchV2(before, after);
        operatePatchHistory.push(patch);
        if (operatePatchHistory.length > MAX_OPERATE_PATCH_HISTORY) operatePatchHistory.shift();
      } catch {
        patch = null;
      }
    }
    for (const client of operateSseClients) {
      try {
        if (!after || !sameExperienceBinding(after, client.binding)) {
          const fallback = before ?? after;
          if (!fallback) continue;
          const cursor = { eventHead: fallback.eventHead, viewHash: fallback.viewHash };
          client.res.write(
            sseFrame(
              'stale',
              createDashboardLiveEventEnvelope({
                event: 'stale',
                binding: client.binding,
                cursor,
                payload: {
                  mutationEnabled: false,
                  reasonCodes: ['OPERATE_PROJECTION_UNAVAILABLE'],
                  recovery: 'Refresh the validated snapshot before submitting any command.',
                },
              }),
            ),
          );
        } else if (client.surface === 'inbox') {
          const cursor = { eventHead: after.eventHead, viewHash: after.viewHash };
          const surface = selectOperateExperienceDisplaySurface(after, {
            surface: 'inbox',
            binding: {
              actorId: client.binding.actorId,
              scopeId: client.binding.scopeId,
              domainId: client.binding.domainId,
              domainVersion: client.binding.domainVersion,
              generatedAt: after.generatedAt,
              eventHead: after.eventHead,
              viewHash: after.viewHash,
              surface: 'inbox',
              projectId: client.binding.projectId,
              generation: client.binding.generation,
              subjectId: null,
            },
          });
          if (surface?.kind !== 'operate-experience-display-surface') {
            throw new TypeError('The live Inbox display could not be issued.');
          }
          client.res.write(
            sseFrame(
              'snapshot',
              createDashboardLiveEventEnvelope({
                event: 'snapshot',
                binding: client.binding,
                cursor,
                payload: surface,
              }),
              encodeOperateExperienceCheckpoint(cursor),
            ),
          );
          client.res.write(
            sseFrame(
              'ready',
              createDashboardLiveEventEnvelope({
                event: 'ready',
                binding: client.binding,
                cursor,
                payload: {
                  mutationEnabled:
                    surface.payload.status === 'ready' && surface.payload.mutationEnabled === true,
                  reasonCodes: surface.payload.reasonCodes,
                },
              }),
              encodeOperateExperienceCheckpoint(cursor),
            ),
          );
        } else if (
          patch &&
          patch.actorId === client.binding.actorId &&
          patch.scopeId === client.binding.scopeId &&
          patch.domainId === client.binding.domainId &&
          patch.domainVersion === client.binding.domainVersion
        ) {
          const cursor = { eventHead: patch.toEventHead, viewHash: patch.toViewHash };
          client.res.write(
            sseFrame(
              'patch',
              createDashboardLiveEventEnvelope({
                event: 'patch',
                binding: client.binding,
                cursor,
                payload: patch,
              }),
              encodeOperateExperienceCheckpoint(cursor),
            ),
          );
        } else {
          const cursor = { eventHead: after.eventHead, viewHash: after.viewHash };
          client.res.write(
            sseFrame(
              'stale',
              createDashboardLiveEventEnvelope({
                event: 'stale',
                binding: client.binding,
                cursor,
                payload: {
                  mutationEnabled: false,
                  reasonCodes: ['OPERATE_EVENT_GAP'],
                  recovery: 'Refresh the validated snapshot before submitting any command.',
                },
              }),
              encodeOperateExperienceCheckpoint(after),
            ),
          );
        }
      } catch {
        operateSseClients.delete(client);
      }
    }
  };

  const refreshOperatingExperience = () => {
    const previous = ensureExperience();
    const next = readExperience();
    onExperienceChange({ previous, next });
    return next;
  };

  return {
    server,
    sseClients,
    planningSseClients,
    operateSseClients,
    /** Validated immutable asset root selected for this server instance. */
    staticRoot: dashboardStaticRoot,
    /** Current in-memory graph (for tests / introspection). */
    getCurrentGraph: () => ensureGraph(),
    /** Current committed Planning transport cursor (for tests / introspection). */
    getPlanningCursor: () => planningCursor(),
    /** The watcher and focused contract tests share this single validated ingress. */
    acceptPlanningWatcherPatch: onWatcherPatch,
    /** Current access-safe experience read result (for tests / introspection). */
    getCurrentExperience: () => ensureExperience(),
    /** Process-local gateway only; null keeps every command route read-only. */
    getOperatingCommandGateway: () => resolveOperatingCommandGateway(),
    /** Planning gateway is separate from generic governed command authority. */
    getOperatingPlanningGateway: () => resolveOperatingPlanningGateway(),
    /** Re-read the public projection now (the watcher calls the same path). */
    refreshOperatingExperience,
    /** True when the filesystem watcher is running. */
    isWatching: () => watcher != null,
    /**
     * Broadcast a named SSE event to every open /api/events client. Patches are
     * pushed as default `message` events via onWatcherPatch; this stays for the
     * `ready`-style named events.
     */
    broadcast(event, payload) {
      const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const client of sseClients) client.write(frame);
    },
    /** True when the last listen() reused a running server instead of binding. */
    get reused() {
      return reused;
    },
    /** Pid of the server the last listen() bound or reused (never a stale guess). */
    get ownerPid() {
      return ownerPid;
    },
    /**
     * Bind on 127.0.0.1 and write the port + PID files for reuse discovery.
     * A failed bind rejects (never an uncaught 'error' event). On EADDRINUSE, a
     * compatible running dashboard on the same port is reused instead of crashing;
     * an incompatible or unreachable occupant fails with a typed error.
     */
    async listen(port = DEFAULT_PORT, { env = process.env } = {}) {
      reused = false;
      ownerPid = process.pid;
      let actual;
      try {
        actual = await listenLoopback(server, port);
      } catch (error) {
        if (error?.code === 'EADDRINUSE' && Number(port) > 0) {
          const existing = await probeLoopbackJson(port, '/health');
          if (
            existing?.ok === true &&
            existing.kind === DASHBOARD_SERVER_KIND &&
            existing.version === readPackageVersion()
          ) {
            reused = true;
            ownerPid =
              Number.isInteger(existing.pid) && existing.pid > 0 ? existing.pid : process.pid;
            return port;
          }
          throw Object.assign(
            new Error(
              `Port ${port} is already in use by a process that is not a compatible dashboard.`,
            ),
            { code: 'E_DASHBOARD_PORT_IN_USE' },
          );
        }
        throw error;
      }
      const stateDir = dashboardDir(env);
      writePidFile(stateDir, actual);
      writePidFile(stateDir, 'port', actual); // last-bound port for discovery
      // Start live sync unless suppressed by --no-watch. The watcher is
      // seeded with the current cache so its first patch is a true diff.
      if (watch && !watcher) {
        const initialExperience = ensureExperience();
        watcher = createWatcher(planrDir, {
          onPatch: onWatcherPatch,
          initialGraph: ensureGraph(),
          buildGraph: (_directory, options) => readFreshGraph(options),
          getExperience: readExperience,
          initialExperience,
          onExperience: onExperienceChange,
        });
        watcher.start();
      }
      return actual;
    },
    close: () =>
      new Promise((r) => {
        if (watcher) {
          watcher.stop();
          watcher = null;
        }
        for (const client of sseClients) client.end();
        sseClients.clear();
        for (const client of planningSseClients) client.res.end();
        planningSseClients.clear();
        for (const client of operateSseClients) client.res.end();
        operateSseClients.clear();
        server.close(r);
      }),
  };
}

// CLI entry: `node server.mjs --serve [port] [--no-watch]`
if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop()) &&
  process.argv.includes('--serve')
) {
  const serveArg = process.argv[process.argv.indexOf('--serve') + 1];
  const portArg = Number(serveArg) || DEFAULT_PORT;
  // --no-watch suppresses the filesystem watcher (live sync off).
  const watch = !process.argv.includes('--no-watch');
  const dash = createDashboardServer({ watch });
  dash
    .listen(portArg)
    .then((port) => {
      process.stdout.write(`DASHBOARD_URL: http://localhost:${port}/\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({
          ok: false,
          code: error?.code ?? 'E_DASHBOARD_LISTEN',
          problem: error?.message ?? 'The dashboard server failed to start.',
        })}\n`,
      );
      process.exitCode = 1;
    });
}
