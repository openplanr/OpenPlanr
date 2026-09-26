import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  DASHBOARD_SAFE_CONTEXT_FIELDS,
  DASHBOARD_SAFE_ERROR_CODES,
  assertDashboardSafeError,
  createDashboardServer,
  mapDashboardSafeError,
} from '../../lib/dashboard/server.mjs';

const temporaryRoots = [];
const CERTIFIED_HYPHENATED_OPERATIONS = Object.freeze([
  'operate.planning.create-spec',
  'operate.planning.ingest-delivery',
  'operate.recovery.clear-stale-lock',
]);

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'planr-dashboard-state-contract-'));
  temporaryRoots.push(root);
  const staticRoot = join(root, 'dashboard');
  const planrDir = join(root, 'project', '.planr');
  mkdirSync(staticRoot, { recursive: true });
  mkdirSync(planrDir, { recursive: true });
  writeFileSync(join(staticRoot, 'index.html'), '<main id="root"></main>\n');
  writeFileSync(
    join(staticRoot, 'dashboard-manifest.json'),
    `${JSON.stringify(
      {
        kind: 'openplanr-dashboard-build',
        schemaVersion: '1.0.0',
        buildId: 'dashboard-state-contract-test',
        entry: 'index.html',
        assets: [],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(planrDir, 'config.json'), JSON.stringify({ projectName: 'State contract' }));
  return { root, staticRoot, planrDir };
}

function get(port, path, headers = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolveRequest({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', rejectRequest);
    req.end();
  });
}

test('dashboard safe-error mapper emits one exact non-echoing contract', () => {
  const privateMarker = 'private-message-path-body-stack-must-not-echo';
  const mapped = mapDashboardSafeError({
    code: 'CONCURRENT_MODIFICATION',
    message: privateMarker,
    stack: privateMarker,
    retryable: true,
    context: {
      operation: 'operate.review.submit',
      cycleId: 'cycle-current',
      assignmentId: 'assignment-current',
      submissionId: 'submission-current',
      submissionState: 'awaiting_review',
      reviewId: 'review-current',
      state: 'awaiting_review',
      maxBytes: 65536,
      ownerActorId: privateMarker,
      privatePath: `/tmp/${privateMarker}`,
      body: privateMarker,
    },
  });
  assert.deepEqual(mapped, {
    code: 'CONCURRENT_MODIFICATION',
    retryable: true,
    context: {
      operation: 'operate.review.submit',
      cycleId: 'cycle-current',
      assignmentId: 'assignment-current',
      submissionId: 'submission-current',
      submissionState: 'awaiting_review',
      reviewId: 'review-current',
      state: 'awaiting_review',
      maxBytes: 65536,
    },
  });
  assert.deepEqual(Object.keys(mapped).sort(), ['code', 'context', 'retryable']);
  assert.equal(JSON.stringify(mapped).includes(privateMarker), false);
  assert.deepEqual(assertDashboardSafeError(mapped), mapped);
});

test('dashboard safe-error vocabulary is finite and field-identical for installed clients', () => {
  assert.deepEqual(DASHBOARD_SAFE_ERROR_CODES, [
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
  assert.deepEqual(DASHBOARD_SAFE_CONTEXT_FIELDS, [
    'operation',
    'cycleId',
    'assignmentId',
    'submissionId',
    'submissionState',
    'reviewId',
    'state',
    'maxBytes',
  ]);
  assert.deepEqual(
    mapDashboardSafeError({
      code: 'UNKNOWN_BUT_WELL_FORMED',
      retryable: true,
      context: {},
    }),
    {
      code: 'DASHBOARD_ERROR_UNAVAILABLE',
      retryable: false,
      context: {},
    },
  );
  for (const operation of CERTIFIED_HYPHENATED_OPERATIONS) {
    const candidate = {
      code: 'DASHBOARD_RESPONSE_INVALID',
      retryable: false,
      context: { operation },
    };
    assert.equal(mapDashboardSafeError(candidate).context.operation, operation);
    assert.deepEqual(assertDashboardSafeError(candidate), candidate);
  }
});

test('dashboard safe-error strings are exactly bounded and never echo oversized input', () => {
  const operation160 = `operate.${'a'.repeat(152)}`;
  const state160 = 'a'.repeat(160);
  assert.equal(operation160.length, 160);
  assert.equal(state160.length, 160);
  assert.deepEqual(
    mapDashboardSafeError({
      code: 'DASHBOARD_RESPONSE_INVALID',
      retryable: false,
      context: { operation: operation160, state: state160 },
    }).context,
    { operation: operation160, state: state160 },
  );

  for (const [field, value] of [
    ['operation', `operate.${'a'.repeat(153)}`],
    ['state', 'a'.repeat(161)],
    ['submissionState', 'a'.repeat(161)],
  ]) {
    const candidate = {
      code: 'DASHBOARD_RESPONSE_INVALID',
      retryable: false,
      context: { [field]: value },
    };
    assert.throws(() => assertDashboardSafeError(candidate), /Invalid dashboard safe error/u);
    assert.deepEqual(mapDashboardSafeError(candidate), {
      code: 'DASHBOARD_ERROR_UNAVAILABLE',
      retryable: false,
      context: {},
    });
  }

  const oversizedMarker = `${'a'.repeat(200_000)}private-marker`;
  for (const field of DASHBOARD_SAFE_CONTEXT_FIELDS) {
    if (field === 'maxBytes') continue;
    const candidate = {
      code: 'DASHBOARD_RESPONSE_INVALID',
      retryable: false,
      context: { [field]: field === 'operation' ? `operate.${oversizedMarker}` : oversizedMarker },
    };
    const mapped = mapDashboardSafeError(candidate);
    assert.deepEqual(mapped, {
      code: 'DASHBOARD_ERROR_UNAVAILABLE',
      retryable: false,
      context: {},
    });
    assert.equal(JSON.stringify(mapped).includes('private-marker'), false);
  }
});

test('dashboard safe-error output is canonical and public assertion rejects custom prototypes', () => {
  const forward = {
    code: 'DASHBOARD_RESPONSE_INVALID',
    retryable: false,
    context: { operation: 'operate.review.submit', cycleId: 'cycle-current', state: 'ready' },
  };
  const reordered = {
    context: { state: 'ready', cycleId: 'cycle-current', operation: 'operate.review.submit' },
    retryable: false,
    code: 'DASHBOARD_RESPONSE_INVALID',
  };
  const canonical = assertDashboardSafeError(forward);
  assert.equal(JSON.stringify(canonical), JSON.stringify(assertDashboardSafeError(reordered)));
  assert.equal(JSON.stringify(canonical), JSON.stringify(mapDashboardSafeError(reordered)));
  assert.deepEqual(Object.keys(canonical.context), ['operation', 'cycleId', 'state']);

  const custom = Object.assign(Object.create({ privateMarker: true }), forward);
  const internalError = Object.assign(new Error('private-marker'), forward);
  assert.throws(() => assertDashboardSafeError(custom), /Invalid dashboard safe error/u);
  assert.throws(() => assertDashboardSafeError(internalError), /Invalid dashboard safe error/u);
  const mappedInternal = mapDashboardSafeError(internalError);
  assert.deepEqual(mappedInternal, {
    code: 'DASHBOARD_ERROR_UNAVAILABLE',
    retryable: false,
    context: {},
  });
  assert.equal(Object.getPrototypeOf(mappedInternal), Object.prototype);
  assert.doesNotThrow(() => assertDashboardSafeError(mappedInternal));
  assert.equal(JSON.stringify(mappedInternal).includes('private-marker'), false);
});

test('dashboard safe-error context rejects public-field path, URL, and private values', () => {
  const hostile = 'https://private-marker.invalid/Users/private-marker';
  for (const field of DASHBOARD_SAFE_CONTEXT_FIELDS) {
    if (field === 'maxBytes') continue;
    const candidate = {
      code: 'DASHBOARD_RESPONSE_INVALID',
      retryable: false,
      context: { [field]: hostile },
    };
    assert.throws(() => assertDashboardSafeError(candidate), /Invalid dashboard safe error/u);
    const mapped = mapDashboardSafeError(candidate);
    assert.deepEqual(mapped, {
      code: 'DASHBOARD_ERROR_UNAVAILABLE',
      retryable: false,
      context: {},
    });
    assert.equal(JSON.stringify(mapped).includes('private-marker'), false);
  }
  const oversized = {
    code: 'DASHBOARD_RESPONSE_INVALID',
    retryable: false,
    context: { maxBytes: 16 * 1024 * 1024 + 1 },
  };
  assert.throws(() => assertDashboardSafeError(oversized), /Invalid dashboard safe error/u);
  assert.deepEqual(mapDashboardSafeError(oversized), {
    code: 'DASHBOARD_ERROR_UNAVAILABLE',
    retryable: false,
    context: {},
  });
  for (const operation of [
    '/Users/private-marker',
    'https://private-marker.invalid',
    'operate.review.\u0000private-marker',
    'private-marker',
    'operate.private.marker',
    'foo',
    'ingest-delivery',
  ]) {
    const candidate = {
      code: 'DASHBOARD_RESPONSE_INVALID',
      retryable: false,
      context: { operation },
    };
    assert.throws(() => assertDashboardSafeError(candidate), /Invalid dashboard safe error/u);
    const mapped = mapDashboardSafeError(candidate);
    assert.deepEqual(mapped, {
      code: 'DASHBOARD_ERROR_UNAVAILABLE',
      retryable: false,
      context: {},
    });
    assert.equal(JSON.stringify(mapped).includes('private-marker'), false);
  }
});

test('dashboard safe-error validator rejects expanded, nested, accessor, and proxy fields', () => {
  for (const hostile of [
    { code: 'OK', retryable: false, context: {}, message: 'not public' },
    { code: 'OK', retryable: false, context: { path: '/private' } },
    { code: 'OK', retryable: false, context: { operation: { nested: true } } },
    { code: 'lowercase', retryable: false, context: {} },
    { code: 'UNKNOWN_BUT_WELL_FORMED', retryable: false, context: {} },
  ]) {
    assert.throws(() => assertDashboardSafeError(hostile), /Invalid dashboard safe error/u);
  }

  let getterCalls = 0;
  const accessor = Object.defineProperties(
    {},
    {
      code: {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return 'OPERATION_UNCERTAIN';
        },
      },
      retryable: { enumerable: true, value: false },
      context: { enumerable: true, value: {} },
    },
  );
  assert.deepEqual(mapDashboardSafeError(accessor), {
    code: 'DASHBOARD_ERROR_UNAVAILABLE',
    retryable: false,
    context: {},
  });
  assert.equal(getterCalls, 0);

  const proxy = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error('private proxy');
      },
    },
  );
  assert.deepEqual(mapDashboardSafeError(proxy), {
    code: 'DASHBOARD_ERROR_UNAVAILABLE',
    retryable: false,
    context: {},
  });

  let getCalls = 0;
  const descriptorSafeProxy = new Proxy(
    { code: 'OPERATION_UNCERTAIN', retryable: false, context: {} },
    {
      get: () => {
        getCalls += 1;
        throw new Error('private-marker-from-get-trap');
      },
    },
  );
  assert.deepEqual(mapDashboardSafeError(descriptorSafeProxy), {
    code: 'DASHBOARD_ERROR_UNAVAILABLE',
    retryable: false,
    context: {},
  });
  assert.equal(getCalls, 0);
});

test('dashboard safe-error mapper fails closed without converting retryability into an action', () => {
  for (const value of [
    null,
    new Error('private error'),
    { reasonCode: 'OPERATION_UNCERTAIN', retryable: true, context: {} },
    { code: 'OPERATION_UNCERTAIN', retryable: true, context: { operation: ['retry'] } },
  ]) {
    assert.deepEqual(mapDashboardSafeError(value), {
      code: 'DASHBOARD_ERROR_UNAVAILABLE',
      retryable: false,
      context: {},
    });
  }
  const retryable = mapDashboardSafeError({
    code: 'CONCURRENT_MODIFICATION',
    retryable: true,
    context: {},
  });
  assert.equal(retryable.retryable, true);
  assert.equal(Object.hasOwn(retryable, 'retry'), false);
  assert.equal(Object.hasOwn(retryable, 'allowedActions'), false);
});

test('bootstrap owner-boundary failures use the new error contract without rewriting Operate errors', async () => {
  const { root, staticRoot, planrDir } = fixture();
  const dashboard = createDashboardServer({ staticRoot, planrDir, watch: false });
  try {
    const port = await dashboard.listen(0, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
    });
    const invalidHost = await get(port, '/api/bootstrap', { Host: '127.0.0.1:1' });
    assert.equal(invalidHost.status, 400);
    assert.equal(invalidHost.headers['cache-control'], 'no-store');
    const bootstrapFailure = JSON.parse(invalidHost.body);
    assert.deepEqual(bootstrapFailure, {
      error: {
        code: 'DASHBOARD_LOOPBACK_HOST_INVALID',
        retryable: false,
        context: {},
      },
    });
    assertDashboardSafeError(bootstrapFailure.error);

    const legacy = await get(
      port,
      '/api/operate/today?scopeId=scope&domainId=business&domainVersion=1.0.0',
    );
    assert.equal(legacy.status, 400);
    const legacyBody = JSON.parse(legacy.body);
    assert.equal(legacyBody.error.reasonCode, 'OPERATE_BINDING_REQUIRED');
    assert.equal(JSON.stringify(legacyBody).includes(planrDir), false);
    assert.deepEqual(mapDashboardSafeError(legacyBody.error), {
      code: 'DASHBOARD_ERROR_UNAVAILABLE',
      retryable: false,
      context: {},
    });
  } finally {
    await dashboard.close();
  }
});
