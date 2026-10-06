import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createArtifactEnvelope,
  createSharedArtifactEnvelope,
  digestArtifactEnvelope,
} from '../lib/artifact/envelope.mjs';
import { mintCapabilityToken } from '../lib/artifact/internal/board-token.mjs';
import { writePrivateJsonState } from '../lib/artifact/internal/server-util.mjs';
import { createArtifactReview } from '../lib/artifact/review.mjs';
import {
  artifactReviewStatePath,
  createArtifactReviewServer,
  exportArtifactReviewSession,
  listArtifactReviewServers,
  startArtifactReview,
  stopArtifactReviewServer,
} from '../lib/artifact/review-server.mjs';

function envelope(label = 'First') {
  return createArtifactEnvelope({
    artifacts: [
      {
        id: 'screen',
        title: label,
        html: `<!doctype html><title>${label}</title><button>Review</button>`,
        viewport: { width: 800, height: 600 },
        colorScheme: 'light',
      },
    ],
  });
}

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-studio-server-'));
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, '.git/HEAD'), 'ref: refs/heads/main\n');
  const env = { ...process.env, PLANR_HOME: join(root, 'home') };
  const servers = [];
  t.after(async () => {
    for (const server of servers) await server.close();
    rmSync(root, { recursive: true, force: true });
  });
  async function start(options = {}) {
    const server = createArtifactReviewServer({
      ...options,
      env,
      serverMetadata: { kind: 'design', projectRoot: root },
    });
    servers.push(server);
    await server.listen();
    const origin = `http://127.0.0.1:${server.port}`;
    async function register(options = {}) {
      const response = await fetch(`${origin}/internal/v1/sessions`, {
        method: 'POST',
        headers: {
          'x-openplanr-control': server.controlToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ envelope: envelope(), cwd: root, studioId: 'product', ...options }),
      });
      return { response, value: await response.json() };
    }
    return { server, origin, register };
  }
  return { root, env, start };
}

async function open(origin, path) {
  const response = await fetch(`${origin}${path}`);
  return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

function rawStatus(origin, path, headers) {
  return new Promise((resolve, reject) => {
    const req = request(new URL(path, origin), { headers }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

function review(current, overall = 'Check the action') {
  return createArtifactReview({
    reviewId: 'review-one',
    reviewOf: digestArtifactEnvelope(current),
    decision: 'pending',
    overall,
    pins: [],
    createdAt: '2026-10-02T08:00:00.000Z',
    updatedAt: '2026-10-02T08:01:00.000Z',
  });
}

function writeReview(origin, path, cookie, value) {
  return fetch(`${origin}${path}api/review`, {
    method: 'PUT',
    headers: { origin, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ review: value }),
  });
}

test('explicit local Studio alias uses cookie custody while capability routes and exact request guards remain', async (t) => {
  const context = await fixture(t),
    { origin, register } = await context.start();
  const { response: registered, value } = await register({
    sourceTransport: 'srcdoc',
    frameBudget: 2,
  });
  assert.equal(registered.status, 201);
  assert.equal(value.studioPath, '/studio/product/');
  const root = await fetch(origin, { redirect: 'manual' });
  assert.equal(root.headers.get('location'), '/studio');
  const select = await fetch(`${origin}/studio`, { redirect: 'manual' });
  assert.equal(select.headers.get('location'), value.studioPath);
  assert.equal((await fetch(`${origin}${value.studioPath}runtime.js`)).status, 404);
  const { response, cookie } = await open(origin, value.studioPath);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/u);
  const document = await response.text();
  assert.doesNotMatch(document, /allow-same-origin/u);
  assert.doesNotMatch(document, new RegExp(value.capability));
  const headers = { cookie };
  const runtime = await fetch(`${origin}${value.studioPath}runtime.js`, { headers }).then(
    (result) => result.text(),
  );
  assert.match(runtime, /"sourceTransport":"srcdoc"/u);
  assert.match(runtime, /"frameBudget":2/u);
  assert.match(runtime, new RegExp(`"artifactBaseUrl":"${value.path}artifacts/"`));
  assert.match(runtime, /credentials: ?["']omit["']/u);
  const privateRuntime = await fetch(`${origin}${value.path}runtime.js`).then((result) =>
    result.text(),
  );
  assert.match(
    privateRuntime,
    /"sourceTransport":"blob"/u,
    'srcdoc cannot inherit a capability-bearing parent URL',
  );
  const source = await fetch(`${origin}${value.path}artifacts/screen`).then((result) =>
    result.text(),
  );
  assert.ok(source.includes(origin), 'frame handshake pins the actual loopback parent origin');
  for (const bad of [{ cookie: `${cookie}; ${cookie}` }, { cookie: 'openplanr_studio_bad=bad' }])
    assert.equal(
      (await fetch(`${origin}${value.studioPath}api/review`, { headers: bad })).status,
      404,
    );
  assert.equal(
    (await fetch(`${origin}${value.studioPath}`, { headers: { 'sec-fetch-site': 'cross-site' } }))
      .status,
    403,
  );
  assert.equal(
    (await fetch(`${origin}${value.studioPath}`, { headers: { 'sec-fetch-dest': 'iframe' } }))
      .status,
    404,
  );
  assert.equal(await rawStatus(origin, value.studioPath, { host: 'evil.test:1234' }), 403);
  assert.equal(
    (
      await fetch(`${origin}${value.studioPath}api/review`, {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    403,
  );
  assert.equal(
    (await register()).response.status,
    409,
    'duplicate aliases never silently replace another session',
  );
});

test('Studio aliases use canonical feedback, reject competing content and obsolete revisions, and restore after restart', async (t) => {
  const context = await fixture(t),
    first = await context.start();
  const { value: registration } = await first.register();
  const { cookie } = await open(first.origin, registration.studioPath);
  const current = envelope(),
    feedback = review(current);
  assert.equal(
    (await writeReview(first.origin, registration.studioPath, cookie, feedback)).status,
    200,
  );
  assert.equal(
    (
      await writeReview(
        first.origin,
        registration.studioPath,
        cookie,
        review(current, 'Competing change'),
      )
    ).status,
    409,
  );
  const privateState = await fetch(`${first.origin}${registration.path}api/review`).then(
    (response) => response.json(),
  );
  assert.equal(privateState.reviewState.reviews[0].review.overall, feedback.overall);
  const advanced = envelope('Revision two');
  await first.register({ studioId: 'next-product', envelope: advanced });
  assert.equal(
    (await writeReview(first.origin, registration.studioPath, cookie, feedback)).status,
    409,
    'a stale session cannot merge its old digest into the advanced durable ledger',
  );
  const newState = await fetch(`${first.origin}/studio/next-product/`).then(
    (response) => response.headers.get('set-cookie').split(';')[0],
  );
  const ledger = await fetch(`${first.origin}/studio/next-product/api/review`, {
    headers: { cookie: newState },
  }).then((response) => response.json());
  assert.equal(ledger.reviewState.reviews[0].stale, true);
  await first.server.close();
  const restarted = await context.start(),
    { value: next } = await restarted.register({ envelope: advanced });
  const reopened = await open(restarted.origin, next.studioPath);
  const durable = await fetch(`${restarted.origin}${next.studioPath}api/review`, {
    headers: { cookie: reopened.cookie },
  }).then((response) => response.json());
  assert.equal(durable.reviewState.reviews[0].review.overall, feedback.overall);
  assert.equal(durable.reviewState.reviews[0].stale, true);
});

test('multiple designs have a safe selection page and invalid transport/budget never dispatch', async (t) => {
  const context = await fixture(t),
    { origin, register } = await context.start();
  await register({ title: '<script>unsafe</script>' });
  await register({ studioId: 'other-product', title: 'Second design' });
  const page = await fetch(`${origin}/studio`).then((response) => response.text());
  assert.match(page, /&lt;script&gt;unsafe&lt;\/script&gt;/u);
  assert.match(page, /href="\/studio\/other-product\/"/u);
  assert.doesNotMatch(page, /\/r\//u);
  for (const options of [
    { studioId: '../escape' },
    { studioId: 'new', sourceTransport: 'network' },
    { studioId: 'new', frameBudget: 0 },
    { studioId: 'new', frameBudget: 9 },
  ])
    assert.equal((await register(options)).response.status, 400);
});

test('owned local service discovery preserves every instance and authenticated stop targets only its instance', async (t) => {
  const context = await fixture(t);
  const first = await context.start(),
    second = await context.start();
  const { value: firstSession } = await first.register();
  await second.register();
  assert.equal(
    JSON.parse(
      (await exportArtifactReviewSession(firstSession.sessionId, { env: context.env })).content,
    ).artifactId,
    'screen',
  );
  const servers = await listArtifactReviewServers({ env: context.env });
  assert.equal(servers.length, 2);
  assert.ok(
    servers.every((server) => server.projectRoot === context.root && server.kind === 'design'),
  );
  assert.doesNotMatch(JSON.stringify(servers), /controlToken|capability/);
  assert.equal(
    (
      await fetch(`${first.origin}/internal/v1/shutdown`, {
        method: 'POST',
        headers: { origin: first.origin },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${first.origin}/internal/v1/shutdown`, {
        method: 'POST',
        headers: { 'x-openplanr-control': 'A'.repeat(43) },
      })
    ).status,
    403,
  );
  assert.equal(
    (await stopArtifactReviewServer(first.server.instanceId, { env: context.env })).status,
    'stopping',
  );
  await first.server.close();
  const remaining = await listArtifactReviewServers({ env: context.env });
  assert.deepEqual(
    remaining.map((server) => server.instanceId),
    [second.server.instanceId],
  );
  assert.equal((await fetch(`${second.origin}/health`)).status, 200);
  await assert.rejects(
    stopArtifactReviewServer(first.server.instanceId, { env: context.env }),
    /stopped or unavailable/u,
  );
});

test('generic review launches still reuse their daemon without enabling Studio discovery routes', async (t) => {
  const context = await fixture(t);
  const first = await startArtifactReview({
    envelope: envelope(),
    cwd: context.root,
    env: context.env,
    noOpen: true,
  });
  const second = await startArtifactReview({
    envelope: envelope(),
    cwd: context.root,
    env: context.env,
    noOpen: true,
  });
  t.after(async () => {
    await first.close();
    await second.close();
  });
  assert.equal(first.port, second.port);
  assert.equal((await fetch(`http://127.0.0.1:${first.port}/`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${first.port}/studio`)).status, 404);
  assert.equal((await fetch(first.url)).status, 200);
  const listed = await listArtifactReviewServers({ env: context.env });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].kind, 'artifact');
  assert.equal(
    listed[0].url,
    undefined,
    'a capability-only service must not advertise a nonexistent short route',
  );
  await first.close();
  await second.close();
});

test('simultaneous registrations cannot claim the same short Studio alias', async (t) => {
  const context = await fixture(t),
    service = await context.start();
  const responses = await Promise.all([service.register(), service.register()]);
  assert.deepEqual(responses.map(({ response }) => response.status).sort(), [201, 409]);
  assert.equal(service.server.sessionCount(), 1);
});

test('shared-source Studio views resolve their canonical HTML without duplicating source pools', async (t) => {
  const context = await fixture(t),
    service = await context.start();
  const html =
    '<!doctype html><title>Shared source</title><button data-planr-id="shared-action">Review</button>';
  const shared = createSharedArtifactEnvelope({
    sources: [{ id: 'canonical-screen', html }],
    artifacts: [390, 768, 1024, 1280, 1440].map((width) => ({
      id: `screen-${width}`,
      sourceId: 'canonical-screen',
      title: `Screen at ${width}`,
      viewport: { width, height: 900 },
      colorScheme: 'light',
    })),
  });
  const { response, value } = await service.register({ envelope: shared });
  assert.equal(response.status, 201);
  const opened = await open(service.origin, value.studioPath);
  assert.equal(opened.response.status, 200);
  const shell = await opened.response.text();
  const metadata = JSON.parse(
    shell.match(
      /<script type="application\/json" id="planr-artifact-review-state">([^<]*)<\/script>/u,
    )[1],
  );
  assert.equal(
    metadata.reviewOf,
    digestArtifactEnvelope(shared),
    'shell review identity includes the complete shared source pool',
  );
  assert.ok(
    shell.includes('schemaVersion'),
    'shared schema remains visible to the metadata-only shell',
  );
  for (const artifact of shared.artifacts) {
    const source = await fetch(`${service.origin}${value.path}artifacts/${artifact.id}`);
    assert.equal(source.status, 200);
    const prepared = await source.text();
    assert.match(prepared, /data-planr-id="shared-action"/u);
    assert.ok(prepared.includes(artifact.id), 'bridge identity binds the exact viewport');
  }
});

test('owned shutdown drains an authorized save waiting before its durable write is queued', async (t) => {
  const context = await fixture(t);
  let release, entered;
  const waiting = new Promise((resolveWait) => {
    release = resolveWait;
  });
  const started = new Promise((resolveStarted) => {
    entered = resolveStarted;
  });
  const first = await context.start({
    refreshSession: async () => {
      entered();
      await waiting;
    },
  });
  const current = envelope();
  const { value: registered } = await first.register();
  const save = writeReview(
    first.origin,
    registered.path,
    '',
    review(current, 'Retain this pending save'),
  );
  await started;
  await stopArtifactReviewServer(first.server.instanceId, { env: context.env });
  let closed = false;
  const closing = first.server.close().then(() => {
    closed = true;
  });
  await delay(20);
  assert.equal(closed, false, 'shutdown waits for the accepted save handler');
  release();
  assert.equal((await save).status, 200);
  await closing;
  const restarted = await context.start();
  const { value: next } = await restarted.register();
  const state = await fetch(`${restarted.origin}${next.path}api/review`).then((response) =>
    response.json(),
  );
  assert.equal(state.reviewState.reviews[0].review.overall, 'Retain this pending save');
});

test('new services retain healthy v1 custody for exact-session exports without reusing or stopping that daemon', async (t) => {
  const context = await fixture(t);
  const instanceId = mintCapabilityToken({ bytes: 16 });
  const controlToken = mintCapabilityToken({ bytes: 32 });
  const sessionId = mintCapabilityToken({ bytes: 16 });
  const privatePath = `/r/${sessionId}/${mintCapabilityToken({ bytes: 32 })}/`;
  let state,
    shutdownRequests = 0;
  const legacy = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health')
      res.end(
        JSON.stringify({
          ok: true,
          kind: 'artifact-review',
          version: 1,
          pid: process.pid,
          instanceId,
        }),
      );
    else if (
      req.url === `/internal/v1/sessions/${sessionId}/export/json` &&
      req.headers.authorization === `Bearer ${controlToken}`
    )
      res.end(JSON.stringify({ legacy: true }));
    else if (req.url === privatePath) res.end(JSON.stringify({ legacy: 'still open' }));
    else {
      if (req.url.includes('shutdown')) shutdownRequests++;
      res.writeHead(404);
      res.end('{}');
    }
  });
  await new Promise((resolveListen) => legacy.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise((resolveClose) => legacy.close(resolveClose)));
  state = {
    schemaVersion: '1.0.0',
    kind: 'artifact-review',
    serverVersion: 1,
    pid: process.pid,
    port: legacy.address().port,
    instanceId,
    controlToken,
  };
  const statePath = artifactReviewStatePath(0, context.env);
  writePrivateJsonState(statePath, state);
  assert.equal(
    JSON.parse((await exportArtifactReviewSession(sessionId, { env: context.env })).content).legacy,
    true,
  );
  const current = await startArtifactReview({
    envelope: envelope(),
    env: context.env,
    cwd: context.root,
  });
  t.after(() => current.close());
  assert.notEqual(current.port, state.port);
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).serverVersion, 3);
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        join(context.env.PLANR_HOME, 'artifact-daemon', `instance-${instanceId}.json`),
        'utf8',
      ),
    ),
    state,
  );
  assert.equal(
    JSON.parse((await exportArtifactReviewSession(sessionId, { env: context.env })).content).legacy,
    true,
  );
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${state.port}${privatePath}`).then((response) =>
        response.json(),
      )
    ).legacy,
    'still open',
  );
  await assert.rejects(stopArtifactReviewServer(instanceId, { env: context.env }), {
    code: 'E_ARTIFACT_SESSION_NOT_FOUND',
  });
  assert.equal(shutdownRequests, 0);
});

test('a running version 2 service stays listed, reused, exported and stopped through its own header', async (t) => {
  const context = await fixture(t);
  const instanceId = mintCapabilityToken({ bytes: 16 });
  const controlToken = mintCapabilityToken({ bytes: 32 });
  const sessionId = mintCapabilityToken({ bytes: 16 });
  const requests = [];
  const previous = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') {
      res.end(
        JSON.stringify({
          ok: true,
          kind: 'artifact-review',
          version: 2,
          pid: process.pid,
          instanceId,
        }),
      );
      return;
    }
    requests.push(`${req.method} ${req.url}`);
    if (
      req.headers.authorization !== `Bearer ${controlToken}` ||
      req.headers['x-openplanr-control'] !== undefined
    ) {
      res.writeHead(403);
      res.end('{}');
    } else if (req.method === 'POST' && req.url === '/internal/v1/sessions')
      res.end(JSON.stringify({ sessionId, path: `/r/${sessionId}/${'B'.repeat(43)}/` }));
    else if (req.url === `/internal/v1/sessions/${sessionId}/export/json`)
      res.end(JSON.stringify({ previous: 2 }));
    else if (req.method === 'POST' && req.url === '/internal/v1/shutdown')
      res.end(JSON.stringify({ ok: true, instanceId, status: 'stopping' }));
    else {
      res.writeHead(404);
      res.end('{}');
    }
  });
  await new Promise((resolveListen) => previous.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise((resolveClose) => previous.close(resolveClose)));
  const port = previous.address().port;
  writePrivateJsonState(artifactReviewStatePath(0, context.env), {
    schemaVersion: '1.0.0',
    kind: 'artifact-review',
    serverVersion: 2,
    pid: process.pid,
    port,
    instanceId,
    controlToken,
  });

  assert.deepEqual(
    (await listArtifactReviewServers({ env: context.env })).map((server) => [
      server.instanceId,
      server.port,
    ]),
    [[instanceId, port]],
  );
  const reused = await startArtifactReview({
    envelope: envelope(),
    env: context.env,
    cwd: context.root,
  });
  assert.equal(reused.port, port);
  assert.equal(reused.sessionId, sessionId);
  assert.equal(
    JSON.parse((await exportArtifactReviewSession(sessionId, { env: context.env })).content)
      .previous,
    2,
  );
  assert.equal(
    (await stopArtifactReviewServer(instanceId, { env: context.env })).status,
    'stopping',
  );
  assert.deepEqual(requests, [
    'POST /internal/v1/sessions',
    `GET /internal/v1/sessions/${sessionId}/export/json`,
    'POST /internal/v1/shutdown',
  ]);
});

for (const variant of ['malformed', 'invalid-schema', 'oversized', 'symlink', 'public-mode']) {
  test(`owner-state ${variant} blocks startup, discovery and export without discarding custody`, async (t) => {
    const context = await fixture(t);
    const statePath = artifactReviewStatePath(0, context.env);
    mkdirSync(join(context.env.PLANR_HOME, 'artifact-daemon'), { recursive: true, mode: 0o700 });
    const bytes =
      variant === 'invalid-schema'
        ? '{"schemaVersion":"unknown"}'
        : variant === 'oversized'
          ? 'x'.repeat(16_385)
          : '{unfinished-owner-state';
    const target = join(context.root, 'retained-owner.json');
    if (variant === 'symlink') {
      writeFileSync(target, bytes, { mode: 0o600 });
      symlinkSync(target, statePath);
    } else writeFileSync(statePath, bytes, { mode: 0o600 });
    if (variant === 'public-mode') chmodSync(statePath, 0o644);
    const operations = [
      () => startArtifactReview({ envelope: envelope(), env: context.env, cwd: context.root }),
      () => listArtifactReviewServers({ env: context.env }),
      () => exportArtifactReviewSession(mintCapabilityToken({ bytes: 16 }), { env: context.env }),
    ];
    for (const operation of operations) {
      await assert.rejects(operation(), { code: 'E_ARTIFACT_LOOPBACK_STATE' });
      assert.equal(readFileSync(statePath, 'utf8'), bytes);
    }
  });
}

test('unreachable but valid prior owner custody is retained before a replacement starts', async (t) => {
  const context = await fixture(t);
  const statePath = artifactReviewStatePath(0, context.env);
  const previous = {
    schemaVersion: '1.0.0',
    kind: 'artifact-review',
    serverVersion: 2,
    pid: 2147483647,
    port: 1,
    instanceId: mintCapabilityToken({ bytes: 16 }),
    controlToken: mintCapabilityToken({ bytes: 32 }),
  };
  writePrivateJsonState(statePath, previous);
  const current = await startArtifactReview({
    envelope: envelope(),
    env: context.env,
    cwd: context.root,
    fetchImpl: (url, options) =>
      String(url).endsWith('/health')
        ? Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }))
        : fetch(url, options),
  });
  try {
    assert.deepEqual(
      JSON.parse(
        readFileSync(
          join(context.env.PLANR_HOME, 'artifact-daemon', `instance-${previous.instanceId}.json`),
          'utf8',
        ),
      ),
      previous,
    );
    assert.notEqual(JSON.parse(readFileSync(statePath, 'utf8')).instanceId, previous.instanceId);
  } finally {
    await current.close();
  }
});
