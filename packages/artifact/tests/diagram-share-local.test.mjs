import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { makeBundle, sealBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { createDiagramShareLocalHandler } from '../lib/artifact/diagram/share-local.mjs';
import { diagramWorkspaceService } from './diagram-workspace-service.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'diagram-owner-share-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'project', '.git'), { recursive: true });
  const bundle = makeBundle('swimlane');
  bundle.document.annotations[0].text = 'Note';
  sealBundle(bundle);
  const directory = join(root, 'project', 'diagrams', bundle.diagramId);
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${bundle.diagramId}.planr-diagram-bundle.json`);
  await writeFile(file, JSON.stringify(bundle));
  const service = diagramWorkspaceService();
  const handlerWith = (overrides = {}) =>
    createDiagramShareLocalHandler(file, {
      custodyRoot: join(root, 'private'),
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      baseUrl: 'https://share.test',
      fetchImpl: service.fetchImpl,
      ...overrides,
    });
  return { root, file, service, handlerWith, handle: handlerWith() };
}
function request({ method = 'GET', headers = {}, value } = {}) {
  const req = Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))]);
  req.method = method;
  req.headers = { 'x-openplanr-owner': '1', ...headers };
  return { req, segments: ['api', 'share'], origin: 'http://127.0.0.1:4400' };
}
test('local share preview is scoped, credential-free and creates nothing before explicit action', async (t) => {
  const { root, handle } = await fixture(t);
  const unauthorized = await handle(request({ headers: { 'x-openplanr-owner': '0' } }));
  assert.equal(unauthorized.status, 403);
  const preview = await handle(request());
  assert.equal(preview.status, 200);
  assert.equal(preview.body.shared, false);
  assert.ok(!JSON.stringify(preview.body).includes(root));
  assert.equal(preview.body.token, undefined);
  assert.match(preview.body.localRevision, /^[a-f0-9]{64}$/u);
});
test('local publication accepts only the displayed revision and exact owner origin', async (t) => {
  const { handle } = await fixture(t),
    preview = await handle(request()),
    value = { action: 'create', expectedRevision: preview.body.localRevision };
  assert.equal(
    (
      await handle(
        request({
          method: 'POST',
          headers: { origin: 'https://other.test', 'content-type': 'application/json' },
          value,
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handle(
        request({
          method: 'POST',
          headers: { origin: 'http://127.0.0.1:4400', 'content-type': 'application/json' },
          value: { ...value, expectedRevision: 'b'.repeat(64) },
        }),
      )
    ).status,
    409,
  );
  const created = await handle(
    request({
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:4400', 'content-type': 'application/json' },
      value,
    }),
  );
  assert.equal(created.status, 200);
  assert.equal(created.body.token, undefined);
  const status = await handle(request());
  assert.equal(status.body.shared, true);
  const access = await handle(
    request({
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:4400', 'content-type': 'application/json' },
      value: { ...value, action: 'access' },
    }),
  );
  assert.equal(typeof access.body.token, 'string');
});
test('local share request rejects caller-provided paths, destinations and duplicate owner headers', async (t) => {
  const { handle } = await fixture(t),
    preview = await handle(request());
  const denied = await handle(
    request({
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:4400', 'content-type': 'application/json' },
      value: {
        action: 'create',
        expectedRevision: preview.body.localRevision,
        file: '/tmp/other',
        baseUrl: 'https://other.test',
      },
    }),
  );
  assert.equal(denied.status, 400);
  const duplicate = request();
  duplicate.req.headersDistinct = { 'x-openplanr-owner': ['1', '1'] };
  assert.equal((await handle(duplicate)).status, 403);
});

function ownerAction(preview, action = 'create') {
  return request({
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:4400', 'content-type': 'application/json' },
    value: { action, expectedRevision: preview.body.localRevision },
  });
}
for (const [status, code, message] of [
  [401, 'invalid_access_token', 'Access token is incorrect or has been rotated.'],
  [403, 'owner_required', 'This review is unavailable or this action requires its owner.'],
  [404, 'not_found', 'This shared review could not be found.'],
  [409, 'version_conflict', 'The shared review changed. Refresh its status before retrying.'],
  [410, 'revoked', 'This shared review has been revoked or deleted.'],
  [413, 'payload_too_large', 'This diagram exceeds the sharing upload limit.'],
  [429, 'rate_limited', 'Too many requests. Wait a moment and retry.'],
]) {
  test(`local share preserves known HTTP ${status} and service code ${code}`, async (t) => {
    const f = await fixture(t);
    const preview = await f.handle(request());
    assert.equal((await f.handle(ownerAction(preview))).status, 200);
    const handle = f.handlerWith({
      fetchImpl: async () =>
        Response.json(
          { error: code },
          {
            status,
            headers: status === 429 ? { 'retry-after': '23' } : {},
          },
        ),
    });
    const result = await handle(ownerAction(preview, 'rotate'));
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
    assert.equal(result.body.message, message);
    if (status === 429) assert.equal(result.body.retryAfterSeconds, 23);
  });
}
test('local share explains a custody location rejection without masking it as a retry', async (t) => {
  const f = await fixture(t);
  const handle = f.handlerWith({ custodyRoot: join(f.root, 'project', 'private') });
  const result = await handle(ownerAction(await handle(request())));
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'E_OWNER_CUSTODY_LOCATION');
  assert.match(result.body.message, /outside the project.*PLANR_HOME/u);
});
test('local share reports source validation or render failures as an actionable 422', async (t) => {
  const f = await fixture(t);
  await writeFile(f.file, JSON.stringify({ kind: 'diagram-authoring-bundle' }));
  const result = await f.handle(request());
  assert.equal(result.status, 422);
  assert.equal(result.body.code, 'E_DIAGRAM_REVIEW_BUNDLE');
  assert.match(result.body.message, /source custody checks/u);
});
test('local share retains the explicit preview-changed code and HTTP 409', async (t) => {
  const { handle } = await fixture(t);
  const preview = await handle(request());
  preview.body.localRevision = 'b'.repeat(64);
  const result = await handle(ownerAction(preview));
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'E_DIAGRAM_SHARE_PREVIEW_CHANGED');
  assert.match(result.body.message, /local diagram changed/u);
});
test('local share reports a pending rotation before publication and permits its exact retry', async (t) => {
  const f = await fixture(t);
  const preview = await f.handle(request());
  await f.handle(ownerAction(preview));
  const interrupted = f.handlerWith({
    fetchImpl: async (url, init) => {
      if (init?.method === 'POST' && new URL(url).pathname.endsWith('/rotate'))
        f.service.state.failAfter = true;
      return f.service.fetchImpl(url, init);
    },
  });
  assert.equal((await interrupted(ownerAction(preview, 'rotate'))).status, 503);
  const pending = await f.handle(ownerAction(preview, 'publish'));
  assert.equal(pending.status, 409);
  assert.equal(pending.body.code, 'E_DIAGRAM_SHARE_PENDING');
  assert.match(pending.body.message, /pending rotate/u);
  assert.equal((await f.handle(ownerAction(preview, 'rotate'))).status, 200);
});
test('local share distinguishes a local request size violation from an uncertain response', async (t) => {
  const f = await fixture(t);
  const req = ownerAction(await f.handle(request()));
  req.req = Readable.from([Buffer.alloc(4097, 32)]);
  req.req.method = 'POST';
  req.req.headers = {
    'x-openplanr-owner': '1',
    origin: req.origin,
    'content-type': 'application/json',
  };
  const result = await f.handle(req);
  assert.equal(result.status, 413);
  assert.equal(result.body.code, 'E_REQUEST_BODY_LIMIT');
  assert.match(result.body.message, /exceeds 4096/u);
});
for (const kind of ['network', 'parse', 'receipt']) {
  test(`local share uses uncertainty guidance only for an unconfirmed ${kind} response`, async (t) => {
    const f = await fixture(t);
    const preview = await f.handle(request());
    const handle = f.handlerWith({
      fetchImpl: async (url, init) => {
        if (kind === 'network') throw new Error('PRIVATE NETWORK DETAILS');
        if (kind === 'parse') return new Response('<html>temporary proxy failure</html>');
        const response = await f.service.fetchImpl(url, init);
        return Response.json({ ...(await response.json()), version: 900 });
      },
    });
    const result = await handle(ownerAction(preview));
    assert.equal(result.status, 503);
    assert.match(result.body.message, /could not be confirmed/u);
    assert.ok(!result.body.message.includes('PRIVATE'));
    assert.equal((await f.handle(request())).body.pendingAction, 'create');
    assert.equal((await f.handle(ownerAction(preview))).status, 200);
  });
}

test('local share rejects malformed source bytes as a validation error rather than an uncertain publication', async (t) => {
  const f = await fixture(t);
  await writeFile(f.file, 'not JSON');
  const result = await f.handle(request());
  assert.equal(result.status, 422);
  assert.equal(result.body.code, 'E_DIAGRAM_REVIEW_BUNDLE');
  assert.ok(!result.body.message.includes('could not be confirmed'));
});
