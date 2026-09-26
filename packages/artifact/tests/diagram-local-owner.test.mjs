import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  makeBundle,
  makeTransaction,
  placement,
} from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { compileDiagramCommand } from '../lib/artifact/diagram/authoring/index.mjs';
import { createDiagramAuthoringStore } from '../lib/artifact/diagram/authoring/store.mjs';
import {
  createDiagramLocalOwnerAdapter,
  startDiagramOwner,
} from '../lib/artifact/diagram/editor/local-owner.mjs';
import { createArtifactEnvelope } from '../lib/artifact/envelope.mjs';
import { createArtifactReviewServer } from '../lib/artifact/review-server.mjs';

async function workspace(t) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'openplanr-diagram-owner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function request(url, { method = 'GET', headers = {}, body } = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: Number(target.port),
        path: target.pathname + target.search,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let value;
          try {
            value = JSON.parse(text);
          } catch {
            value = null;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, value });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Owner request timed out')));
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const post = (owner, action, value, headers = {}) =>
  request(`${owner.apiBase}${action}`, {
    method: 'POST',
    headers: {
      ...owner.headers,
      origin: new URL(owner.baseUrl).origin,
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(value),
  });
const read = (owner) => request(`${owner.apiBase}read`, { headers: owner.headers });
async function ownerFor(t, options = {}) {
  const root = options.root ?? (await workspace(t));
  const owner = await startDiagramOwner({ root, slug: 'checkout', ...options });
  t.after(() => owner.close());
  return { root, owner };
}

// All requests stay on IPv4 loopback. No company session or provider is involved.
test('offline blank and template create/edit/save/reopen retain complete paired content', async (t) => {
  const { root, owner } = await ownerFor(t);
  const absent = await read(owner);
  assert.equal(absent.status, 200);
  assert.equal(absent.value.status, 'absent');
  assert.equal(absent.value.recoveryScope, owner.recoveryScope);
  assert.deepEqual(absent.value.capabilities, { read: true, write: true });
  assert.equal(Object.hasOwn(absent.value, 'path'), false);
  const blank = makeBundle('flowchart', { blank: true });
  assert.equal(
    (await post(owner, 'initialize', { bundle: blank, transactionId: 'create-blank' })).value
      .status,
    'saved',
  );
  const edit = compileDiagramCommand(
    blank,
    {
      type: 'create',
      elements: [
        {
          collection: 'nodes',
          value: {
            id: 'first-node',
            label: 'First authored object',
            kind: 'process',
            description: null,
          },
        },
      ],
      presentation: [placement('first-node')],
    },
    { transactionId: 'create-first-object' },
  );
  assert.equal(edit.ok, true);
  const committed = await post(owner, 'commit', { transaction: edit.transaction });
  assert.equal(committed.status, 200);
  assert.equal(committed.value.status, 'saved');
  assert.deepEqual(committed.value.bundle, edit.bundle);
  assert.equal(
    (await read(owner)).value.recoveryScope,
    owner.recoveryScope,
    'refresh retains one recovery namespace',
  );
  await owner.close();
  const reopened = await startDiagramOwner({ root, slug: 'checkout' });
  t.after(() => reopened.close());
  assert.notEqual(
    reopened.recoveryScope,
    owner.recoveryScope,
    'a new authority session has a new browser recovery namespace',
  );
  assert.deepEqual((await read(reopened)).value.bundle, edit.bundle);
  const replay = await post(reopened, 'commit', { transaction: edit.transaction });
  assert.equal(replay.value.replayed, true);
  assert.deepEqual(replay.value.receipt, committed.value.receipt);
  const templateOwner = (await ownerFor(t)).owner;
  const template = makeBundle('swimlane', { source: true });
  assert.equal(
    (
      await post(templateOwner, 'initialize', {
        bundle: template,
        transactionId: 'create-template',
      })
    ).status,
    200,
  );
  assert.deepEqual((await read(templateOwner)).value.bundle, template);
  assert.match(committed.headers['cache-control'], /no-store/u);
  assert.equal(committed.headers['cross-origin-resource-policy'], 'same-origin');
});

test('owner page and packaged assets are capability scoped with safe types and no draft disclosure', async (t) => {
  const title = '</script><img src=x onerror=alert(1)>';
  const { owner, root } = await ownerFor(t, { title });
  await post(owner, 'initialize', { bundle: makeBundle(), transactionId: 'create-draft' });
  const page = await request(owner.baseUrl);
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /^text\/html;/u);
  assert.match(page.headers['content-security-policy'], /script-src 'self';/u);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/u);
  assert.equal(page.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(page.headers['cross-origin-opener-policy'], 'same-origin');
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.equal(page.headers['x-frame-options'], 'DENY');
  assert.match(page.headers['cache-control'], /no-store/u);
  assert.match(page.text, /id="diagram-owner-editor"/u);
  assert.equal(page.text.includes('<img'), false);
  assert.equal(page.text.includes(root), false);
  assert.equal(page.text.includes(makeBundle().bundleDigest), false);
  assert.equal(
    page.text.includes(owner.recoveryScope),
    false,
    'recovery scope is delivered only by authenticated API read',
  );
  assert.equal((await request(owner.baseUrl, { method: 'HEAD' })).text, '');
  const redirect = await request(owner.baseUrl.slice(0, -1));
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.location, new URL(owner.baseUrl).pathname);
  for (const [asset, mediaType] of [
    ['runtime.js', 'text/javascript'],
    ['editor.css', 'text/css'],
  ]) {
    const response = await request(`${owner.baseUrl}${asset}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], `${mediaType}; charset=utf-8`);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(
      (
        await request(`${owner.baseUrl}${asset}`, {
          headers: { origin: 'https://attacker.example' },
        })
      ).status,
      403,
    );
    assert.equal(
      (await request(`${owner.baseUrl}${asset}`, { headers: { host: 'attacker.example' } })).status,
      403,
    );
  }
  for (const path of ['other.js', 'editor.css/nested', 'api/runtime.js'])
    assert.equal((await request(`${owner.baseUrl}${path}`)).status, 404);
  assert.equal(
    (await request(owner.apiBase + 'read')).status,
    403,
    'page access never relaxes the explicit API header',
  );
  assert.equal(
    (await request(owner.baseUrl, { headers: { 'sec-fetch-site': 'cross-site' } })).status,
    403,
  );
});

test('programmatic owner opens its scoped editor on request and tolerates browser launch failure', async (t) => {
  const opened = [];
  const { owner } = await ownerFor(t, { openUrl: (url) => opened.push(url) });
  assert.deepEqual(opened, [owner.baseUrl]);
  assert.equal(owner.url, owner.baseUrl);
  const suppressed = (
    await ownerFor(t, {
      noOpen: true,
      openUrl: () => assert.fail('noOpen must suppress browser launch'),
    })
  ).owner;
  assert.equal((await read(suppressed)).value.status, 'absent');
  const failed = (
    await ownerFor(t, {
      openUrl: () => {
        throw new Error('browser unavailable');
      },
    })
  ).owner;
  assert.match(failed.launchError, /manually/u);
  assert.equal((await request(failed.baseUrl)).status, 200);
  assert.equal(
    (await read(failed)).value.status,
    'absent',
    'opening does not create a persisted blank',
  );
});

test('review capability and HTTP registration cannot acquire owner read or write authority', async (t) => {
  const root = await workspace(t);
  const server = createArtifactReviewServer({
    env: { ...process.env, PLANR_HOME: join(root, 'home') },
  });
  t.after(() => server.close());
  const registration = server.registerOwnerSession(
    createDiagramLocalOwnerAdapter({ root, slug: 'checkout' }),
  );
  await server.listen();
  const origin = `http://127.0.0.1:${server.port}`;
  const envelope = createArtifactEnvelope({
    artifacts: [
      {
        id: 'checkout',
        title: 'Reviewer copy',
        html: '<!doctype html><html><body>Published review only</body></html>',
        viewport: { width: 800, height: 600 },
        colorScheme: 'light',
      },
    ],
  });
  const registered = await request(`${origin}/internal/v1/sessions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${server.controlToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ envelope, cwd: root, owner: true, root, slug: 'checkout' }),
  });
  assert.equal(registered.status, 201);
  assert.equal(Object.hasOwn(registered.value, 'recoveryScope'), false);
  const reviewer = registered.value;
  const owner = {
    baseUrl: origin + registration.path,
    apiBase: origin + registration.path + 'api/',
    headers: { 'x-openplanr-owner': '1' },
  };
  await post(owner, 'initialize', { bundle: makeBundle(), transactionId: 'create-draft' });
  for (const base of [
    origin + reviewer.path,
    `${origin}/o/${reviewer.sessionId}/${reviewer.capability}/`,
    `${origin}/o/${registration.sessionId}/${reviewer.capability}/`,
  ]) {
    assert.equal((await request(`${base}api/read`, { headers: owner.headers })).status, 404);
    if (base.includes('/o/')) {
      for (const asset of ['', 'runtime.js', 'editor.css'])
        assert.equal((await request(base + asset)).status, 404);
    }
    assert.equal(
      (
        await request(`${base}api/commit`, {
          method: 'POST',
          headers: { ...owner.headers, origin, 'content-type': 'application/json' },
          body: JSON.stringify({ transaction: makeTransaction() }),
        })
      ).status,
      404,
    );
  }
  assert.equal(
    (
      await request(`${origin}/internal/v1/owner-sessions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${server.controlToken}`,
          'content-type': 'application/json',
        },
        body: '{}',
      })
    ).status,
    404,
  );
  const reviewPage = await request(origin + reviewer.path);
  assert.equal(reviewPage.status, 200);
  assert.equal(reviewPage.text.includes(registration.capability), false);
  assert.equal(
    (await read(owner)).value.bundle.document.nodes[0].label,
    makeBundle().document.nodes[0].label,
  );
  await registration.close();
  assert.equal((await read(owner)).status, 404);
});

test('owner APIs enforce host, origin, capability, headers, method and closed path boundaries', async (t) => {
  const { owner } = await ownerFor(t);
  const url = `${owner.apiBase}read`;
  for (const headers of [
    {},
    { ...owner.headers, host: 'attacker.example:8080' },
    { ...owner.headers, origin: 'https://attacker.example' },
    { ...owner.headers, origin: 'null' },
    { ...owner.headers, 'sec-fetch-site': 'cross-site' },
    { ...owner.headers, 'sec-fetch-dest': 'iframe' },
    { ...owner.headers, 'x-openplanr-owner': ['1', '1'] },
  ])
    assert.equal((await request(url, { headers })).status, 403);
  const init = { bundle: makeBundle(), transactionId: 'create-draft' };
  const missingOrigin = await request(`${owner.apiBase}initialize`, {
    method: 'POST',
    headers: { ...owner.headers, 'content-type': 'application/json' },
    body: JSON.stringify(init),
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal(
    (await post(owner, 'initialize', init, { origin: 'https://attacker.example' })).status,
    403,
  );
  assert.equal(
    (await post(owner, 'initialize', init, { 'content-type': 'application/jsonish' })).status,
    415,
  );
  assert.equal((await post(owner, 'initialize', init, { 'content-encoding': 'gzip' })).status, 415);
  assert.equal(
    (await post(owner, 'initialize', { ...init, root: '/tmp/other', slug: 'other' })).status,
    400,
  );
  assert.equal((await request(`${owner.apiBase}commit`, { headers: owner.headers })).status, 404);
  assert.equal(
    (await request(url, { method: 'OPTIONS', headers: { origin: 'https://attacker.example' } }))
      .status,
    403,
  );
  assert.equal((await request(`${url}?path=outside`, { headers: owner.headers })).status, 400);
  assert.equal(
    (await request(`${owner.apiBase}%2foutside`, { headers: owner.headers })).status,
    400,
  );
  assert.equal((await read(owner)).value.status, 'absent');
});

test('bounded UTF-8 JSON and prototype rejection leave the connection and source usable', async (t) => {
  const { root, owner } = await ownerFor(t, { maxRequestBytes: 256 });
  const bundle = makeBundle();
  await createDiagramAuthoringStore({ root, slug: 'checkout' }).initialize(bundle, {
    transactionId: 'initialize-direct',
  });
  const headers = {
    ...owner.headers,
    origin: new URL(owner.baseUrl).origin,
    'content-type': 'application/json',
  };
  assert.equal(
    (
      await request(`${owner.apiBase}commit`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ transaction: 'x'.repeat(400) }),
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await request(`${owner.apiBase}recover`, {
        method: 'POST',
        headers: { ...headers, 'content-length': '500' },
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await request(`${owner.apiBase}recover`, {
        method: 'POST',
        headers,
        body: Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]),
      })
    ).status,
    400,
  );
  const hostile = '{"transaction":{"__proto__":{"polluted":true}}}';
  assert.equal(
    (await request(`${owner.apiBase}commit`, { method: 'POST', headers, body: hostile })).status,
    422,
  );
  assert.equal({}.polluted, undefined);
  assert.equal(
    (await request(`${owner.apiBase}recover`, { method: 'POST', headers, body: '[' })).status,
    400,
  );
  assert.deepEqual((await read(owner)).value.bundle, bundle);
});

test('HTTP idempotency, stale bases and historical recovery preserve the authoritative head', async (t) => {
  const { owner } = await ownerFor(t);
  const bundle = makeBundle();
  const initialized = await post(owner, 'initialize', { bundle, transactionId: 'create-draft' });
  const transaction = makeTransaction(bundle);
  const saved = await post(owner, 'commit', { transaction });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.receipt.transactionId, transaction.transactionId);
  const retry = await post(owner, 'commit', { transaction });
  assert.equal(retry.value.replayed, true);
  assert.deepEqual(retry.value.receipt, saved.value.receipt);
  const stale = await post(owner, 'commit', {
    transaction: { ...transaction, transactionId: 'stale-edit' },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.value.status, 'conflict');
  const changed = structuredClone(transaction);
  changed.operations[0].after.label = 'Changed bytes with same ID';
  assert.equal((await post(owner, 'commit', { transaction: changed })).status, 409);
  const historical = await post(owner, 'recover', {
    transactionId: 'create-draft',
    fingerprint: initialized.value.receipt.fingerprint,
  });
  assert.deepEqual(historical.value.bundle, bundle);
  assert.deepEqual((await read(owner)).value.bundle, saved.value.bundle);
  assert.equal((await read(owner)).value.byteDigest, saved.value.receipt.resultBytesDigest);
});

test('uncertain HTTP save is recoverable by exact identity without leaking filesystem errors', async (t) => {
  const root = await workspace(t);
  let interrupt = false;
  const { owner } = await ownerFor(t, {
    root,
    storeOptions: {
      faultInjector: (phase) => {
        if (interrupt && phase === 'after-replacement') {
          interrupt = false;
          throw new Error(`Private failure ${root}/private-data`);
        }
      },
    },
  });
  const bundle = makeBundle();
  await post(owner, 'initialize', { bundle, transactionId: 'create-draft' });
  interrupt = true;
  const transaction = makeTransaction(bundle);
  const unknown = await post(owner, 'commit', { transaction });
  assert.equal(unknown.status, 202);
  assert.equal(unknown.value.status, 'unknown');
  assert.equal(unknown.value.transactionId, transaction.transactionId);
  assert.equal(unknown.text.includes(root), false);
  assert.equal((await read(owner)).status, 202);
  const wrong = await post(owner, 'recover', { transactionId: 'wrong-transaction' });
  assert.equal(wrong.status, 422);
  const recovered = await post(owner, 'recover', {
    transactionId: unknown.value.transactionId,
    fingerprint: unknown.value.fingerprint,
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.value.status, 'saved');
  assert.equal(recovered.value.receipt.fingerprint, unknown.value.fingerprint);
  assert.deepEqual((await read(owner)).value.bundle, recovered.value.bundle);
  assert.equal((await post(owner, 'commit', { transaction })).value.replayed, true);
});

test('HTTP callers cannot redirect local custody or overwrite unowned files', async (t) => {
  const { root, owner } = await ownerFor(t);
  const outside = await workspace(t);
  const sentinel = join(outside, 'source.json');
  await writeFile(sentinel, 'keep outside source');
  await symlink(outside, join(root, 'diagrams'));
  const failed = await post(owner, 'initialize', {
    bundle: makeBundle(),
    transactionId: 'create-draft',
  });
  assert.equal(failed.status, 409);
  assert.equal(failed.value.code, 'E_DIAGRAM_STORE_PATH');
  assert.equal(failed.text.includes(root), false);
  assert.equal(failed.text.includes(outside), false);
  assert.equal(await readFile(sentinel, 'utf8'), 'keep outside source');
  await rm(join(root, 'diagrams'));
  await mkdir(join(root, 'diagrams', 'checkout'), { recursive: true });
  const source = join(root, 'diagrams', 'checkout', 'checkout.planr-diagram-bundle.json');
  await writeFile(source, 'unowned source');
  assert.equal(
    (await post(owner, 'initialize', { bundle: makeBundle(), transactionId: 'create-draft' }))
      .status,
    409,
  );
  assert.equal(await readFile(source, 'utf8'), 'unowned source');
});

test('owner shutdown drains the in-flight store operation before closing its authority', async (t) => {
  let resume, entered;
  const held = new Promise((resolve) => {
    resume = resolve;
  });
  const reached = new Promise((resolve) => {
    entered = resolve;
  });
  let hold = false;
  const { root, owner } = await ownerFor(t, {
    storeOptions: {
      faultInjector: async (phase) => {
        if (hold && phase === 'after-journal') {
          entered();
          await held;
        }
      },
    },
  });
  const bundle = makeBundle();
  await post(owner, 'initialize', { bundle, transactionId: 'create-draft' });
  hold = true;
  const saving = post(owner, 'commit', { transaction: makeTransaction(bundle) });
  await reached;
  let closed = false;
  const closing = owner.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  resume();
  const saved = await saving;
  assert.equal(saved.value.status, 'saved');
  await closing;
  const local = createDiagramAuthoringStore({ root, slug: 'checkout' });
  assert.equal((await local.read()).bundle.document.nodes[0].label, 'Accept order');
});

test('an aborted JSON request releases its handler and leaves later owner reads usable', async (t) => {
  const { owner } = await ownerFor(t);
  const bundle = makeBundle();
  await post(owner, 'initialize', { bundle, transactionId: 'create-draft' });
  const target = new URL(`${owner.apiBase}commit`);
  await new Promise((resolve) => {
    const req = httpRequest({
      hostname: target.hostname,
      port: Number(target.port),
      path: target.pathname,
      method: 'POST',
      agent: false,
      headers: {
        ...owner.headers,
        origin: target.origin,
        'content-type': 'application/json',
        'content-length': '200',
      },
    });
    req.on('error', resolve);
    req.on('response', (res) => {
      res.resume();
      res.once('end', resolve);
    });
    req.once('socket', (socket) =>
      socket.once('connect', () => {
        req.write('{');
        setImmediate(() => req.destroy(new Error('simulated browser disconnection')));
      }),
    );
  });
  const ready = await read(owner);
  assert.equal(ready.status, 200);
  assert.deepEqual(ready.value.bundle, bundle);
  assert.equal(
    (await post(owner, 'commit', { transaction: makeTransaction(bundle) })).value.status,
    'saved',
  );
});
