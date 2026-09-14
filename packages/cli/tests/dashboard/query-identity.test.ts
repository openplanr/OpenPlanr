import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertDashboardBootstrapV1, validateDashboardBootstrapV1 } from 'planr-pipeline/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  assertCompatibleDashboardBootstrap,
  parseDashboardBootstrap,
  readDashboardBootstrap,
} from '../../../../apps/dashboard/src/lib/api/bootstrap.js';
import { DashboardValidationError } from '../../../../apps/dashboard/src/lib/api/validation.js';
import {
  createDashboardQueryIdentity,
  dashboardQueryKey,
  isCurrentDashboardQuery,
} from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const BUILD_ID = 'dashboard-1.25.3-test';

function fileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function bootstrap() {
  return {
    kind: 'dashboard-bootstrap',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    ui: { buildId: BUILD_ID, expectedBuildId: BUILD_ID, assetManifestHash: HASH_A },
    server: { packageVersion: '0.42.0' },
    capabilities: {
      planningGraph: { schemaVersion: '1.0.0' },
      operateExperience: { protocolVersion: '2.0.0', schemaVersion: '1.0.0' },
      operateCommands: { protocolVersion: '2.0.0', transportVersion: '1.0.0', available: true },
      diagnostics: { schemaVersion: '1.0.0', available: true },
    },
    project: {
      projectId: HASH_B,
      name: 'planr-pipeline',
      branch: 'main',
      products: ['planning', 'operate'],
    },
    queryRoots: {
      planning: {
        actorId: 'planning-owner',
        projectId: HASH_B,
        scopeId: 'planning',
        domainId: 'planning',
        domainVersion: '1.0.0',
        generation: 0,
      },
      operate: {
        actorId: 'operate-owner',
        projectId: HASH_B,
        scopeId: 'scope-acme',
        domainId: 'business',
        domainVersion: '1.0.0',
        generation: 0,
      },
    },
    origin: 'http://127.0.0.1:7473',
    compatibility: { status: 'compatible', reasonCodes: [] },
  };
}

function identity() {
  return {
    productArea: 'operate',
    route: '#/operate/actions/action-1',
    actorId: 'owner-acme',
    projectId: HASH_A,
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    cycleId: 'cycle-1',
    subjectId: 'action-1',
    eventHead: { sequence: 46, hash: HASH_B },
    viewHash: HASH_A,
    generation: 7,
  };
}

function reviewIdentity() {
  return {
    ...identity(),
    route: '#/operate/cycles/cycle-1/reviews/review-1',
    cycleId: 'cycle-1',
    subjectId: 'review-1',
  };
}

describe('dashboard bootstrap validation', () => {
  it('runs the exact pipeline bootstrap contract from the resolved package', async () => {
    const pipelineRoot = resolvePipelinePackageRoot();
    const custodyPaths = [
      'schemas/v1.2.0/dashboard-bootstrap.schema.json',
      'lib/dashboard/server.mjs',
      'lib/protocol/contracts.mjs',
      'lib/protocol/index.d.ts',
      'lib/protocol/loader.mjs',
    ];
    for (const path of custodyPaths) {
      expect(fileSha256(join(pipelineRoot, path)), path).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(typeof validateDashboardBootstrapV1).toBe('function');
    expect(typeof assertDashboardBootstrapV1).toBe('function');

    const temporaryRoot = mkdtempSync(join(tmpdir(), 'openplanr-installed-bootstrap-'));
    const staticRoot = join(temporaryRoot, 'dashboard');
    const planrDir = join(temporaryRoot, 'project', '.planr');
    mkdirSync(join(staticRoot, 'assets'), { recursive: true });
    mkdirSync(planrDir, { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<main id="root"></main>\n');
    writeFileSync(join(staticRoot, 'assets/main.js'), 'globalThis.__installedDashboard = true;\n');
    writeFileSync(
      join(planrDir, 'config.json'),
      JSON.stringify({ projectName: 'Installed dogfood' }),
    );
    const manifest = {
      kind: 'openplanr-dashboard-build',
      schemaVersion: '1.0.0',
      buildId: 'dashboard-installed-custody-test',
      entry: 'index.html',
      assets: ['assets/main.js'],
    };
    const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
    writeFileSync(join(staticRoot, 'dashboard-manifest.json'), manifestBytes);

    const installedServer = (await import(
      pathToFileURL(join(pipelineRoot, 'lib/dashboard/server.mjs')).href
    )) as {
      createDashboardServer(options: Record<string, unknown>): {
        listen(port: number, options: { env: NodeJS.ProcessEnv }): Promise<number>;
        close(): Promise<void>;
      };
    };
    const dashboard = installedServer.createDashboardServer({
      staticRoot,
      dashboardBuildId: manifest.buildId,
      planrDir,
      watch: false,
    });
    try {
      const port = await dashboard.listen(0, {
        env: { ...process.env, PLANR_HOME: join(temporaryRoot, 'home') },
      });
      const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`, {
        headers: { accept: 'application/json' },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const value = (await response.json()) as unknown;
      expect(validateDashboardBootstrapV1(value)).toEqual([]);
      expect(assertDashboardBootstrapV1(value)).toBe(value);
      const parsed = parseDashboardBootstrap(value);
      expect(parsed.origin).toBe(`http://127.0.0.1:${port}`);
      expect(parsed.ui).toEqual({
        buildId: manifest.buildId,
        expectedBuildId: manifest.buildId,
        assetManifestHash: `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`,
      });
      expect(parsed.project.name).toBe('Installed dogfood');
    } finally {
      await dashboard.close();
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('accepts and freezes the exact loopback build handshake', () => {
    const parsed = assertCompatibleDashboardBootstrap(bootstrap(), BUILD_ID);
    expect(parsed.ui.buildId).toBe(BUILD_ID);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(
      parseDashboardBootstrap({ ...bootstrap(), origin: 'http://localhost:7473' }).origin,
    ).toBe('http://localhost:7473');
  });

  it.each([
    [
      'foreign build',
      (value: ReturnType<typeof bootstrap>) => {
        value.ui.buildId = 'foreign';
      },
    ],
    [
      'unknown root field',
      (value: ReturnType<typeof bootstrap>) => Object.assign(value, { privatePath: '/secret' }),
    ],
    [
      'unknown nested field',
      (value: ReturnType<typeof bootstrap>) =>
        Object.assign(value.project, { storePath: '/secret' }),
    ],
    [
      'wrong protocol',
      (value: ReturnType<typeof bootstrap>) => {
        value.protocolVersion = '9.9.9';
      },
    ],
    [
      'duplicate products',
      (value: ReturnType<typeof bootstrap>) => {
        value.project.products = ['operate', 'operate'];
      },
    ],
    [
      'remote origin',
      (value: ReturnType<typeof bootstrap>) => {
        value.origin = 'https://openplanr.dev';
      },
    ],
    [
      'control project name',
      (value: ReturnType<typeof bootstrap>) => {
        value.project.name = 'Public\nname';
      },
    ],
    [
      'false compatible null hash',
      (value: ReturnType<typeof bootstrap>) => {
        value.ui.assetManifestHash = null as never;
      },
    ],
    [
      'false incompatible',
      (value: ReturnType<typeof bootstrap>) => {
        value.compatibility.status = 'incompatible';
      },
    ],
    [
      'mismatch without reason',
      (value: ReturnType<typeof bootstrap>) => {
        value.ui.expectedBuildId = 'foreign';
      },
    ],
    [
      'foreign query-root project',
      (value: ReturnType<typeof bootstrap>) => {
        value.queryRoots.operate.projectId = HASH_A;
      },
    ],
    [
      'overlong query-root actor',
      (value: ReturnType<typeof bootstrap>) => {
        value.queryRoots.operate.actorId = `a${'b'.repeat(128)}`;
      },
    ],
    [
      'non-semver query-root domain',
      (value: ReturnType<typeof bootstrap>) => {
        value.queryRoots.operate.domainVersion = 'business-latest';
      },
    ],
    [
      'substituted Planning query domain',
      (value: ReturnType<typeof bootstrap>) => {
        value.queryRoots.planning.domainId = 'business';
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const value = structuredClone(bootstrap());
    mutate(value);
    expect(() => parseDashboardBootstrap(value)).toThrow(DashboardValidationError);
  });

  it('accepts the exact product set independent of presentation order', () => {
    const value = bootstrap();
    value.project.products = ['operate', 'planning'];
    expect(parseDashboardBootstrap(value).project.products).toEqual(['operate', 'planning']);
  });

  it.each(['DASHBOARD_MANIFEST_MISSING', 'DASHBOARD_MANIFEST_INVALID'])(
    'accepts a closed combined %s and build-mismatch failure',
    (manifestReason) => {
      const value = bootstrap();
      value.ui.buildId = null as never;
      value.ui.assetManifestHash = null as never;
      value.compatibility.status = 'incompatible';
      value.compatibility.reasonCodes = [manifestReason, 'DASHBOARD_BUILD_MISMATCH'];
      expect(parseDashboardBootstrap(value).compatibility.reasonCodes).toEqual([
        manifestReason,
        'DASHBOARD_BUILD_MISMATCH',
      ]);
    },
  );

  it('requires JSON and forwards AbortSignal without retrying', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return new Response(JSON.stringify(bootstrap()), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    });
    await expect(
      readDashboardBootstrap(BUILD_ID, {
        signal: controller.signal,
        fetcher,
        expectedOrigin: 'http://127.0.0.1:7473',
      }),
    ).resolves.toMatchObject({ kind: 'dashboard-bootstrap' });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await expect(
      readDashboardBootstrap(BUILD_ID, {
        fetcher: async () =>
          new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
        expectedOrigin: 'http://127.0.0.1:7473',
      }),
    ).rejects.toThrow('not JSON');

    controller.abort();
    const abort = new DOMException('aborted', 'AbortError');
    await expect(
      readDashboardBootstrap(BUILD_ID, {
        fetcher: async () => {
          throw abort;
        },
        expectedOrigin: 'http://127.0.0.1:7473',
      }),
    ).rejects.toBe(abort);
  });

  it('rejects duplicate members, oversized bytes, and a foreign response origin', async () => {
    const exact = JSON.stringify(bootstrap());
    const duplicate = exact.replace(
      '"kind":"dashboard-bootstrap"',
      '"kind":"dashboard-bootstrap","kind":"dashboard-bootstrap"',
    );
    for (const body of [duplicate, `"${'x'.repeat(65 * 1024)}"`]) {
      await expect(
        readDashboardBootstrap(BUILD_ID, {
          fetcher: async () =>
            new Response(body, { headers: { 'content-type': 'application/json' } }),
          expectedOrigin: 'http://127.0.0.1:7473',
        }),
      ).rejects.toThrow(DashboardValidationError);
    }
    await expect(
      readDashboardBootstrap(BUILD_ID, {
        fetcher: async () =>
          new Response(exact, { headers: { 'content-type': 'application/json' } }),
        expectedOrigin: 'http://localhost:7473',
      }),
    ).rejects.toThrow('current loopback origin');

    const privateMarker = 'private/path/member-must-not-echo';
    const privateDuplicate = `{"${privateMarker}":1,"${privateMarker}":2}`;
    try {
      await readDashboardBootstrap(BUILD_ID, {
        fetcher: async () =>
          new Response(privateDuplicate, {
            headers: { 'content-type': 'application/json' },
          }),
        expectedOrigin: 'http://127.0.0.1:7473',
      });
      expect.fail('duplicate private members must reject');
    } catch (error) {
      expect(error).toBeInstanceOf(DashboardValidationError);
      expect(String(error)).not.toContain(privateMarker);
    }
  });
});

describe('complete dashboard query identity', () => {
  it('creates an immutable structured key without lossy concatenation', () => {
    const key = dashboardQueryKey(identity());
    expect(key).toEqual(['dashboard-projection', identity()]);
    expect(Object.isFrozen(key)).toBe(true);
    expect(Object.isFrozen(key[1])).toBe(true);
  });

  it('binds a Review query to the exact canonical Cycle and Review identities', () => {
    expect(createDashboardQueryIdentity(reviewIdentity())).toEqual(reviewIdentity());
    for (const hostile of [
      { ...reviewIdentity(), cycleId: 'cycle-foreign' },
      { ...reviewIdentity(), subjectId: 'review-foreign' },
    ]) {
      expect(() => createDashboardQueryIdentity(hostile)).toThrow(DashboardValidationError);
    }
  });

  it.each([
    ['actorId', 'owner-foreign'],
    ['projectId', HASH_B],
    ['scopeId', 'scope-foreign'],
    ['domainId', 'software'],
    ['domainVersion', '2.0.0'],
    ['cycleId', 'cycle-foreign'],
    ['subjectId', 'action-foreign'],
    ['viewHash', HASH_B],
    ['generation', 8],
    ['route', '#/operate/actions/action-2'],
    ['productArea', 'planning'],
  ])('rejects stale or foreign %s substitution', (field, replacement) => {
    const current = createDashboardQueryIdentity(identity());
    const hostile = createDashboardQueryIdentity({
      ...identity(),
      [field]: replacement,
      ...(field === 'productArea' ? { route: '#/overview', subjectId: null } : {}),
      ...(field === 'route' ? { subjectId: 'action-2' } : {}),
      ...(field === 'subjectId' ? { route: '#/operate/actions/action-foreign' } : {}),
    });
    expect(isCurrentDashboardQuery(hostile, current)).toBe(false);
  });

  it('rejects Event-head substitution independently', () => {
    const current = createDashboardQueryIdentity(identity());
    for (const eventHead of [
      { sequence: 45, hash: HASH_B },
      { sequence: 46, hash: HASH_A },
    ]) {
      expect(
        isCurrentDashboardQuery(
          createDashboardQueryIdentity({ ...identity(), eventHead }),
          current,
        ),
      ).toBe(false);
    }
  });

  it.each([
    '#/operate/actions/action-1/extra',
    '#/operate/actions/a%2Fb',
    '#/operate/actions/a%5Cb',
    '#/operate/actions/.',
    '#/operate/actions/..',
    '#/operate/Actions/action-1',
    '#/operate/unknown',
  ])('rejects noncanonical or hostile route %s', (route) => {
    expect(() => createDashboardQueryIdentity({ ...identity(), route })).toThrow(
      'canonical closed dashboard route',
    );
  });

  it.each([
    ['missing binding', ({ actorId: _actorId, ...value }) => value],
    ['private extra', (value) => ({ ...value, capability: 'secret' })],
    ['invalid head', (value) => ({ ...value, eventHead: { sequence: 46, hash: null } })],
    ['invalid generation', (value) => ({ ...value, generation: -1 })],
    ['cross-product route', (value) => ({ ...value, productArea: 'planning' })],
  ])('fails closed for %s', (_label, mutate) => {
    expect(() => createDashboardQueryIdentity(mutate(identity()))).toThrow(
      DashboardValidationError,
    );
  });
});
