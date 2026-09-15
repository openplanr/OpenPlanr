import {
  DashboardValidationError,
  exactBoolean,
  exactRecord,
  exactString,
  nullableExactString,
  parseExactJson,
} from './validation.js';

const BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const QUERY_ROOT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const QUERY_ROOT_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;
const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/u;
const REASONS = [
  'DASHBOARD_MANIFEST_MISSING',
  'DASHBOARD_MANIFEST_INVALID',
  'DASHBOARD_ASSET_MISSING',
  'DASHBOARD_BUILD_MISMATCH',
] as const;

export type DashboardBootstrapReason = (typeof REASONS)[number];
export type DashboardProducts = readonly ['planning', 'operate'] | readonly ['operate', 'planning'];
export type DashboardQueryRoot = Readonly<{
  actorId: string;
  projectId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  generation: number;
}>;
export type DashboardBootstrap = Readonly<{
  kind: 'dashboard-bootstrap';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  ui: Readonly<{
    buildId: string | null;
    expectedBuildId: string | null;
    assetManifestHash: string | null;
  }>;
  server: Readonly<{ packageVersion: string }>;
  capabilities: Readonly<{
    planningGraph: Readonly<{ schemaVersion: '1.0.0' }>;
    operateExperience: Readonly<{ protocolVersion: '2.0.0'; schemaVersion: '1.0.0' }>;
    operateCommands: Readonly<{
      protocolVersion: '2.0.0';
      transportVersion: '1.0.0';
      available: boolean;
    }>;
    diagnostics: Readonly<{ schemaVersion: '1.0.0'; available: boolean }>;
  }>;
  project: Readonly<{
    projectId: string;
    name: string;
    branch: string;
    /** Exact unordered set containing Planning and Operate once each. */
    products: DashboardProducts;
  }>;
  queryRoots: Readonly<{
    planning: DashboardQueryRoot | null;
    operate: DashboardQueryRoot | null;
  }>;
  origin: string;
  compatibility: Readonly<{
    status: 'compatible' | 'incompatible';
    reasonCodes: readonly DashboardBootstrapReason[];
  }>;
}>;

function constant<T extends string>(value: unknown, expected: T, path: string): T {
  if (value !== expected) throw new DashboardValidationError(path, `expected ${expected}`);
  return expected;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new DashboardValidationError(path, 'contains an unsupported value');
  }
  return value as T;
}

function publicProjectName(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160) {
    throw new DashboardValidationError('$.project.name', 'contains an invalid string');
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)) {
      throw new DashboardValidationError('$.project.name', 'contains an invalid string');
    }
  }
  return value;
}

function queryRoot(value: unknown, path: string): DashboardQueryRoot | null {
  if (value === null) return null;
  const root = exactRecord(
    value,
    ['actorId', 'projectId', 'scopeId', 'domainId', 'domainVersion', 'generation'],
    path,
  );
  if (!Number.isSafeInteger(root.generation) || (root.generation as number) < 0) {
    throw new DashboardValidationError(
      `${path}.generation`,
      'expected a non-negative safe integer',
    );
  }
  return Object.freeze({
    actorId: exactString(root.actorId, `${path}.actorId`, QUERY_ROOT_ID),
    projectId: exactString(root.projectId, `${path}.projectId`, SHA256),
    scopeId: exactString(root.scopeId, `${path}.scopeId`, QUERY_ROOT_ID),
    domainId: exactString(root.domainId, `${path}.domainId`, QUERY_ROOT_ID),
    domainVersion: exactString(root.domainVersion, `${path}.domainVersion`, QUERY_ROOT_VERSION),
    generation: root.generation as number,
  });
}

export function parseDashboardBootstrap(value: unknown): DashboardBootstrap {
  const root = exactRecord(
    value,
    [
      'kind',
      'schemaVersion',
      'protocolVersion',
      'ui',
      'server',
      'capabilities',
      'project',
      'queryRoots',
      'origin',
      'compatibility',
    ],
    '$',
  );
  const ui = exactRecord(root.ui, ['buildId', 'expectedBuildId', 'assetManifestHash'], '$.ui');
  const server = exactRecord(root.server, ['packageVersion'], '$.server');
  const capabilities = exactRecord(
    root.capabilities,
    ['planningGraph', 'operateExperience', 'operateCommands', 'diagnostics'],
    '$.capabilities',
  );
  const planningGraph = exactRecord(
    capabilities.planningGraph,
    ['schemaVersion'],
    '$.capabilities.planningGraph',
  );
  const operateExperience = exactRecord(
    capabilities.operateExperience,
    ['protocolVersion', 'schemaVersion'],
    '$.capabilities.operateExperience',
  );
  const operateCommands = exactRecord(
    capabilities.operateCommands,
    ['protocolVersion', 'transportVersion', 'available'],
    '$.capabilities.operateCommands',
  );
  const diagnostics = exactRecord(
    capabilities.diagnostics,
    ['schemaVersion', 'available'],
    '$.capabilities.diagnostics',
  );
  const project = exactRecord(
    root.project,
    ['projectId', 'name', 'branch', 'products'],
    '$.project',
  );
  const queryRoots = exactRecord(root.queryRoots, ['planning', 'operate'], '$.queryRoots');
  const compatibility = exactRecord(
    root.compatibility,
    ['status', 'reasonCodes'],
    '$.compatibility',
  );
  const buildId = nullableExactString(ui.buildId, '$.ui.buildId', BUILD_ID);
  const expectedBuildId = nullableExactString(ui.expectedBuildId, '$.ui.expectedBuildId', BUILD_ID);
  const assetManifestHash = nullableExactString(
    ui.assetManifestHash,
    '$.ui.assetManifestHash',
    SHA256,
  );
  const status = oneOf(
    compatibility.status,
    ['compatible', 'incompatible'] as const,
    '$.compatibility.status',
  );
  if (!Array.isArray(compatibility.reasonCodes)) {
    throw new DashboardValidationError('$.compatibility.reasonCodes', 'expected an array');
  }
  const reasonCodes = compatibility.reasonCodes.map((reason, index) =>
    oneOf(reason, REASONS, `$.compatibility.reasonCodes[${index}]`),
  );
  if (new Set(reasonCodes).size !== reasonCodes.length) {
    throw new DashboardValidationError('$.compatibility.reasonCodes', 'contains duplicates');
  }
  if (status === 'compatible') {
    if (!buildId || !expectedBuildId || !assetManifestHash || reasonCodes.length > 0) {
      throw new DashboardValidationError(
        '$.compatibility',
        'compatible bootstrap lacks exact build custody',
      );
    }
    if (buildId !== expectedBuildId) {
      throw new DashboardValidationError('$.ui', 'compatible build identities differ');
    }
  } else if (reasonCodes.length === 0) {
    throw new DashboardValidationError(
      '$.compatibility',
      'incompatible bootstrap requires a reason',
    );
  }
  if (buildId !== expectedBuildId && !reasonCodes.includes('DASHBOARD_BUILD_MISMATCH')) {
    throw new DashboardValidationError('$.ui', 'build mismatch requires its exact reason');
  }
  if (reasonCodes.includes('DASHBOARD_BUILD_MISMATCH') && buildId === expectedBuildId) {
    throw new DashboardValidationError(
      '$.ui',
      'build mismatch reason requires unequal build identities',
    );
  }
  if (
    !Array.isArray(project.products) ||
    project.products.length !== 2 ||
    new Set(project.products).size !== 2 ||
    !project.products.includes('planning') ||
    !project.products.includes('operate')
  ) {
    throw new DashboardValidationError(
      '$.project.products',
      'expected the exact Planning and Operate set',
    );
  }
  const projectId = exactString(project.projectId, '$.project.projectId', SHA256);
  const planningQueryRoot = queryRoot(queryRoots.planning, '$.queryRoots.planning');
  const operateQueryRoot = queryRoot(queryRoots.operate, '$.queryRoots.operate');
  for (const [name, query] of [
    ['planning', planningQueryRoot],
    ['operate', operateQueryRoot],
  ] as const) {
    if (query !== null && query.projectId !== projectId) {
      throw new DashboardValidationError(
        `$.queryRoots.${name}.projectId`,
        'does not equal the bootstrap project identity',
      );
    }
  }
  if (
    planningQueryRoot !== null &&
    (planningQueryRoot.scopeId !== 'planning' ||
      planningQueryRoot.domainId !== 'planning' ||
      planningQueryRoot.domainVersion !== '1.0.0')
  ) {
    throw new DashboardValidationError(
      '$.queryRoots.planning',
      'does not equal the Planning read domain',
    );
  }

  return Object.freeze({
    kind: constant(root.kind, 'dashboard-bootstrap', '$.kind'),
    schemaVersion: constant(root.schemaVersion, '1.0.0', '$.schemaVersion'),
    protocolVersion: constant(root.protocolVersion, '1.2.0', '$.protocolVersion'),
    ui: Object.freeze({ buildId, expectedBuildId, assetManifestHash }),
    server: Object.freeze({
      packageVersion: exactString(server.packageVersion, '$.server.packageVersion', SEMVER),
    }),
    capabilities: Object.freeze({
      planningGraph: Object.freeze({
        schemaVersion: constant(
          planningGraph.schemaVersion,
          '1.0.0',
          '$.capabilities.planningGraph.schemaVersion',
        ),
      }),
      operateExperience: Object.freeze({
        protocolVersion: constant(
          operateExperience.protocolVersion,
          '2.0.0',
          '$.capabilities.operateExperience.protocolVersion',
        ),
        schemaVersion: constant(
          operateExperience.schemaVersion,
          '1.0.0',
          '$.capabilities.operateExperience.schemaVersion',
        ),
      }),
      operateCommands: Object.freeze({
        protocolVersion: constant(
          operateCommands.protocolVersion,
          '2.0.0',
          '$.capabilities.operateCommands.protocolVersion',
        ),
        transportVersion: constant(
          operateCommands.transportVersion,
          '1.0.0',
          '$.capabilities.operateCommands.transportVersion',
        ),
        available: exactBoolean(
          operateCommands.available,
          '$.capabilities.operateCommands.available',
        ),
      }),
      diagnostics: Object.freeze({
        schemaVersion: constant(
          diagnostics.schemaVersion,
          '1.0.0',
          '$.capabilities.diagnostics.schemaVersion',
        ),
        available: exactBoolean(diagnostics.available, '$.capabilities.diagnostics.available'),
      }),
    }),
    project: Object.freeze({
      projectId,
      name: publicProjectName(project.name),
      branch: exactString(project.branch, '$.project.branch', /^.{1,255}$/u),
      products: Object.freeze([...project.products]) as DashboardProducts,
    }),
    queryRoots: Object.freeze({
      planning: planningQueryRoot,
      operate: operateQueryRoot,
    }),
    origin: exactString(root.origin, '$.origin', LOOPBACK),
    compatibility: Object.freeze({ status, reasonCodes: Object.freeze(reasonCodes) }),
  });
}

export function assertCompatibleDashboardBootstrap(
  value: unknown,
  embeddedBuildId: string,
): DashboardBootstrap {
  const bootstrap = parseDashboardBootstrap(value);
  if (
    bootstrap.compatibility.status !== 'compatible' ||
    bootstrap.ui.buildId !== embeddedBuildId ||
    bootstrap.ui.expectedBuildId !== embeddedBuildId
  ) {
    throw new DashboardValidationError(
      '$.compatibility',
      'installed dashboard build is incompatible',
    );
  }
  return bootstrap;
}

export async function readDashboardBootstrap(
  embeddedBuildId: string,
  options: Readonly<{ signal?: AbortSignal; fetcher?: typeof fetch; expectedOrigin?: string }> = {},
): Promise<DashboardBootstrap> {
  const response = await (options.fetcher ?? fetch)('/api/bootstrap', {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: options.signal,
  });
  if (!response.ok) {
    throw new DashboardValidationError('$', `bootstrap request failed with ${response.status}`);
  }
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new DashboardValidationError('$', 'bootstrap response is not JSON');
  }
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    (!/^[0-9]+$/u.test(contentLength) || Number(contentLength) > 64 * 1024)
  ) {
    throw new DashboardValidationError('$', 'bootstrap response exceeds the dashboard JSON limit');
  }
  const bootstrap = assertCompatibleDashboardBootstrap(
    parseExactJson(await response.text()),
    embeddedBuildId,
  );
  const expectedOrigin =
    options.expectedOrigin ?? (typeof window === 'undefined' ? null : window.location.origin);
  if (!expectedOrigin || bootstrap.origin !== expectedOrigin) {
    throw new DashboardValidationError('$.origin', 'does not equal the current loopback origin');
  }
  return bootstrap;
}

export type DashboardBootstrapLoadPhase = 'compatible' | 'incompatible' | 'unavailable';

export type DashboardBootstrapLoadResult = Readonly<{
  bootstrap: DashboardBootstrap | null;
  phase: DashboardBootstrapLoadPhase;
  detail: string | null;
}>;

/** Reads bootstrap for diagnostics even when the installed build is incompatible. */
export async function loadDashboardBootstrapEnvelope(
  embeddedBuildId: string,
  options: Readonly<{ signal?: AbortSignal; fetcher?: typeof fetch; expectedOrigin?: string }> = {},
): Promise<DashboardBootstrapLoadResult> {
  try {
    const response = await (options.fetcher ?? fetch)('/api/bootstrap', {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: options.signal,
    });
    if (!response.ok) {
      throw new DashboardValidationError('$', `bootstrap request failed with ${response.status}`);
    }
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      throw new DashboardValidationError('$', 'bootstrap response is not JSON');
    }
    const bootstrap = parseDashboardBootstrap(parseExactJson(await response.text()));
    const expectedOrigin =
      options.expectedOrigin ?? (typeof window === 'undefined' ? null : window.location.origin);
    if (!expectedOrigin || bootstrap.origin !== expectedOrigin) {
      throw new DashboardValidationError('$.origin', 'does not equal the current loopback origin');
    }
    if (
      bootstrap.compatibility.status !== 'compatible' ||
      bootstrap.ui.buildId !== embeddedBuildId ||
      bootstrap.ui.expectedBuildId !== embeddedBuildId
    ) {
      return Object.freeze({
        bootstrap,
        phase: 'incompatible',
        detail:
          bootstrap.compatibility.reasonCodes.length > 0
            ? bootstrap.compatibility.reasonCodes.join(' · ')
            : 'Installed dashboard build is incompatible.',
      });
    }
    return Object.freeze({
      bootstrap,
      phase: 'compatible',
      detail: null,
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    return Object.freeze({
      bootstrap: null,
      phase: 'unavailable',
      detail:
        error instanceof Error
          ? error.message
          : 'OpenPlanr did not return a validated bootstrap envelope.',
    });
  }
}
