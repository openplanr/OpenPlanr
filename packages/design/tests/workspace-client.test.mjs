import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalizeJson, sha256Hex } from '@openplanr/protocol/canonical-json';
import {
  DESIGN_REVIEW_BUNDLE_SCHEMA,
  DESIGN_WORKSPACE_EVENT_SCHEMA,
  assertWorkspaceContract,
} from '@openplanr/protocol/workspace-contracts';
import {
  prepareWorkspace,
  commitWorkspace,
  deriveWorkspaceAuthentication,
  workspaceReviewUrl,
  getWorkspace,
  decryptWorkspaceRevision,
  verifyWorkspaceSignature,
  prepareWorkspaceMutation,
  canonicalWorkspacePublicKey,
  commitWorkspaceMutation,
  createWorkspaceSigner,
  prepareWorkspaceEvent,
  readWorkspaceEvents,
  workspaceEnvelopeDigest,
  appendWorkspaceEvent,
} from '../lib/design/workspace-client.mjs';

const bundle = () => ({
  schemaVersion: '1.0.0',
  kind: 'openplanr-design-review-bundle',
  revision: 'render-1',
  design: {
    id: 'work',
    title: 'Secret product design',
    screens: [{ id: 'one', title: 'Overview', description: 'External notes' }],
    frames: [{ id: 'desktop', label: 'Desktop', width: 1440, height: 1024 }],
    variants: [{ id: 'A', label: 'First', status: 'ready' }],
    screenOrder: ['one'],
    selectedVariant: 'A',
    defaultView: 'canvas',
  },
  envelope: {
    schemaVersion: '1.0.0',
    artifacts: [{ id: 'one', html: '<h1>Confidential UI</h1>' }],
    viewer: { mode: 'single' },
  },
  entries: [{ artifactId: 'one', screenId: 'one', variantId: 'A', frameId: 'desktop' }],
  state: { positions: { one: { x: -100, y: 10 } } },
  verification: { status: 'unverified' },
});
function service(custody) {
  const create = structuredClone(custody.pendingCreate);
  const revisions = new Map([[create.revision.id, create.revision]]);
  const meta = {
    schemaVersion: '1.0.0',
    id: custody.id,
    version: 1,
    epoch: 1,
    currentRevision: create.revision.id,
    ownerPublicKey: create.ownerPublicKey,
    keyring: create.keyring,
    commentsPaused: false,
  };
  const requests = [];
  let reviewerHash = create.reviewerAuthHash;
  const fetchImpl = async (input, init) => {
    requests.push({ url: input, ...init });
    const url = new URL(input);
    const suffix = url.pathname.split(custody.id)[1];
    const bearer = init.headers.Authorization.slice(7);
    const owner = sha256Hex(bearer) === create.ownerAuthHash;
    if (!owner && sha256Hex(bearer) !== reviewerHash) return Response.json({}, { status: 401 });
    const body = init.body && JSON.parse(init.body);
    if (init.method === 'PUT') return Response.json(meta);
    if (init.method === 'POST') {
      if (!owner || !(await verifyWorkspaceSignature(body, meta.ownerPublicKey)))
        return Response.json({}, { status: 403 });
      if (body.expectedVersion !== meta.version) return Response.json({}, { status: 409 });
      if (suffix === '/rotate') {
        meta.keyring = body.keyring;
        meta.epoch = body.epoch;
        reviewerHash = body.reviewerAuthHash;
      }
      if (suffix === '/publish') {
        revisions.set(body.revision.id, body.revision);
        meta.currentRevision = body.revision.id;
      }
      meta.version++;
      return Response.json(meta);
    }
    if (suffix.startsWith('/revisions/')) return Response.json(revisions.get(suffix.split('/')[2]));
    return Response.json(meta);
  };
  return { fetchImpl, requests, revisions, meta };
}

test('share contracts reject authored paths and unrelated metadata', () => {
  assertWorkspaceContract(bundle(), DESIGN_REVIEW_BUNDLE_SCHEMA);
  for (const field of ['brief', 'designSystem', 'assets']) {
    const value = bundle();
    value.design[field] = { path: '/private/project' };
    assert.throws(() => assertWorkspaceContract(value, DESIGN_REVIEW_BUNDLE_SCHEMA), /Invalid/);
  }
  const value = bundle();
  value.design.screens[0].source = { html: '/secret/file.html' };
  assert.throws(() => assertWorkspaceContract(value, DESIGN_REVIEW_BUNDLE_SCHEMA), /Invalid/);
});

test('creation encrypts content, isolates capabilities and preserves exact retry request', async () => {
  const custody = await prepareWorkspace(bundle());
  const pending = canonicalizeJson(custody.pendingCreate);
  assert.equal(custody.token.length, 43);
  for (const secret of [
    custody.token,
    custody.ownerAuth,
    custody.ownerPrivateKey,
    'Confidential UI',
    'Secret product design',
  ])
    assert.ok(!pending.includes(secret));
  assert.equal(await verifyWorkspaceSignature(custody.pendingCreate, custody.ownerPublicKey), true);
  const { fetchImpl, requests } = service(custody);
  await assert.rejects(
    commitWorkspace(custody, {
      fetchImpl: async () => {
        throw new Error('timeout');
      },
    }),
    /unreachable/,
  );
  assert.equal(canonicalizeJson(custody.pendingCreate), pending);
  await commitWorkspace(custody, { fetchImpl });
  assert.equal(custody.pendingCreate, undefined);
  assert.equal(canonicalizeJson(JSON.parse(requests[0].body)), pending);
  assert.match(workspaceReviewUrl(custody), /^https:\/\/share\.openplanr\.dev\/d\/[\w-]+$/u);
  assert.ok(!workspaceReviewUrl(custody).includes(custody.token));
});

test('recipient unlocks signed revisions; wrong token and content tampering fail', async () => {
  const custody = await prepareWorkspace(bundle());
  const server = service(custody);
  await commitWorkspace(custody, server);
  const access = { id: custody.id, baseUrl: custody.baseUrl, token: custody.token };
  await getWorkspace(access, server);
  const opened = await decryptWorkspaceRevision(access, access.currentRevision, server);
  assert.deepEqual(opened.design, bundle().design);
  assert.equal(opened.reviewOf, workspaceEnvelopeDigest(bundle().envelope));
  await assert.rejects(getWorkspace({ ...access, token: 'A'.repeat(43) }, server), /incorrect/);
  const auth = await deriveWorkspaceAuthentication(access.token, access.id);
  assert.notEqual(auth, access.token);
  // Knowing the server's authentication material cannot decrypt the keyring.
  await assert.rejects(
    getWorkspace({ ...access, token: auth }, { fetchImpl: async () => Response.json(server.meta) }),
  );
  const revision = server.revisions.get(access.currentRevision);
  server.revisions.set(revision.id, { ...revision, createdAt: '2026-01-01T00:00:00.000Z' });
  await assert.rejects(decryptWorkspaceRevision(access, revision.id, server), /signature/);
});

test('rotation preserves prior revisions and prevents old tokens from future access', async () => {
  const custody = await prepareWorkspace(bundle());
  const server = service(custody);
  await commitWorkspace(custody, server);
  const originalRevision = custody.currentRevision;
  const old = { id: custody.id, baseUrl: custody.baseUrl, token: custody.token };
  await getWorkspace(old, server);
  await prepareWorkspaceMutation(custody, 'rotate');
  const nextToken = custody.pendingMutation.next.token;
  const pending = canonicalizeJson(custody.pendingMutation);
  await assert.rejects(
    commitWorkspaceMutation(custody, {
      fetchImpl: async () => {
        throw Error('offline');
      },
    }),
  );
  assert.equal(canonicalizeJson(custody.pendingMutation), pending);
  await commitWorkspaceMutation(custody, server);
  assert.equal(custody.token, nextToken);
  await assert.rejects(getWorkspace(old, server), /incorrect/);
  const current = { id: custody.id, baseUrl: custody.baseUrl, token: nextToken };
  await getWorkspace(current, server);
  assert.equal(
    (await decryptWorkspaceRevision(current, originalRevision, server)).design.title,
    bundle().design.title,
  );
  const updated = bundle();
  updated.design.title = 'A new revision';
  await prepareWorkspaceMutation(custody, 'publish', updated);
  await commitWorkspaceMutation(custody, server);
  await getWorkspace(current, server);
  assert.equal(
    (await decryptWorkspaceRevision(current, current.currentRevision, server)).design.title,
    'A new revision',
  );
  assert.equal(old.keys[2], undefined);
});

test('feedback is encrypted, signed, author-required, revision-bound and survives rotation', async () => {
  const custody = await prepareWorkspace(bundle());
  const server = service(custody);
  await commitWorkspace(custody, server);
  const reviewOf = workspaceEnvelopeDigest(bundle().envelope);
  await assert.rejects(
    prepareWorkspaceEvent(custody, { kind: 'review', author: '', reviewOf }),
    /name/,
  );
  const event = await prepareWorkspaceEvent(custody, {
    kind: 'review',
    author: 'Reviewer',
    reviewOf,
    review: { comment: 'Private comment' },
  });
  assert.ok(!JSON.stringify(event).includes('Private comment'));
  const options = {
    fetchImpl: async () =>
      Response.json({ events: [{ ...event, sequence: 1 }], cursor: 1, hasMore: false }),
  };
  assert.equal(
    (await readWorkspaceEvents(custody, options)).events[0].payload.review.comment,
    'Private comment',
  );
  const tampered = { ...event, id: 'tampered-event-abcdefghijkl', revisionId: custody.id };
  const page = await readWorkspaceEvents(custody, {
    fetchImpl: async () =>
      Response.json({
        events: [
          { ...tampered, sequence: 1 },
          { ...event, sequence: 2 },
        ],
        cursor: 2,
        hasMore: false,
      }),
  });
  assert.equal(page.events.length, 1);
  assert.equal(page.issues.length, 1);
  assert.equal(page.cursor, 2);
});

test('feedback signs the exact protocol public-key shape across browser JWK variants', async () => {
  const custody = await prepareWorkspace(bundle());
  await commitWorkspace(custody, service(custody));
  const signer = await createWorkspaceSigner();
  const browserKey = {
    ...signer.publicKey,
    alg: 'ES256',
    ext: true,
    key_ops: ['verify'],
    kid: 'browser-generated',
    use: 'sig',
  };
  const event = await prepareWorkspaceEvent(
    custody,
    {
      kind: 'review',
      author: 'Reviewer',
      reviewOf: workspaceEnvelopeDigest(bundle().envelope),
      review: { comment: 'Visible after reload' },
    },
    { signer: { ...signer, publicKey: browserKey } },
  );
  assert.deepEqual(event.publicKey, canonicalWorkspacePublicKey(browserKey));
  assert.deepEqual(Object.keys(event.publicKey), ['kty', 'crv', 'x', 'y']);
  assert.equal(await verifyWorkspaceSignature(event, event.publicKey), true);
  assert.throws(
    () => canonicalWorkspacePublicKey({ ...browserKey, d: 'A'.repeat(43) }),
    /public key/,
  );
});

test('signed change-request metadata round-trips alongside older categories without transport changes', async () => {
  const custody = await prepareWorkspace(bundle());
  const server = service(custody);
  await commitWorkspace(custody, server);
  const common = {
    kind: 'category',
    author: 'Reviewer',
    reviewOf: workspaceEnvelopeDigest(bundle().envelope),
    pinId: 'pin-1',
    updatedAt: '2026-09-11T10:00:00Z',
  };
  const payloads = [
    { ...common, schemaVersion: '1.0.0', category: 'suggestion' },
    { ...common, schemaVersion: '1.1.0', category: 'change-request' },
  ];
  const events = await Promise.all(
    payloads.map((payload) => prepareWorkspaceEvent(custody, payload)),
  );
  for (const event of events) {
    assertWorkspaceContract(event, DESIGN_WORKSPACE_EVENT_SCHEMA);
    assert.ok(!JSON.stringify(event).includes('change-request'));
  }
  assert.deepEqual(
    Object.keys(events[1]),
    Object.keys(events[0]),
    'encrypted transport fields remain unchanged',
  );
  const result = await readWorkspaceEvents(custody, {
    fetchImpl: async () =>
      Response.json({
        events: events.map((event, index) => ({ ...event, sequence: index + 1 })),
        cursor: 2,
        hasMore: false,
      }),
  });
  assert.deepEqual(
    result.events.map((event) => event.payload),
    payloads,
  );
  assert.equal(result.issues.length, 0);
  await assert.rejects(
    prepareWorkspaceEvent(custody, { ...payloads[1], schemaVersion: '1.0.0' }),
    /Invalid/,
  );
});

test('unverifiable successful responses retain pending operations for safe retry', async () => {
  const custody = await prepareWorkspace(bundle());
  const server = service(custody);
  await assert.rejects(
    commitWorkspace(custody, { fetchImpl: async () => Response.json({ ok: true }) }),
    /Invalid/,
  );
  assert.ok(custody.pendingCreate);
  await commitWorkspace(custody, server);
  await prepareWorkspaceMutation(custody, 'rotate');
  const token = custody.token;
  await assert.rejects(
    commitWorkspaceMutation(custody, {
      fetchImpl: async () => Response.json({ ...server.meta, version: 999 }),
    }),
    /receipt/,
  );
  assert.equal(custody.token, token);
  assert.ok(custody.pendingMutation);
});

test('event append verifies the exact receipt and event pages require strict ordering', async () => {
  const custody = await prepareWorkspace(bundle());
  const server = service(custody);
  await commitWorkspace(custody, server);
  const event = await prepareWorkspaceEvent(custody, {
    kind: 'review',
    author: 'Reviewer',
    reviewOf: workspaceEnvelopeDigest(bundle().envelope),
    review: { comment: 'Receipt bound' },
  });
  const receipt = await appendWorkspaceEvent(custody, null, {
    preparedEvent: event,
    fetchImpl: async () => Response.json({ event: { ...event, sequence: 7 }, sequence: 7 }),
  });
  assert.equal(receipt.sequence, 7);
  await assert.rejects(
    appendWorkspaceEvent(custody, null, {
      preparedEvent: event,
      fetchImpl: async () =>
        Response.json({ event: { ...event, id: 'changed', sequence: 7 }, sequence: 7 }),
    }),
    /does not match/,
  );
  await assert.rejects(
    readWorkspaceEvents(custody, {
      after: 0,
      fetchImpl: async () =>
        Response.json({
          events: [
            { ...event, sequence: 2 },
            { ...event, id: 'other', sequence: 1 },
          ],
          cursor: 2,
          hasMore: false,
        }),
    }),
    /sequence/,
  );
  await assert.rejects(
    readWorkspaceEvents(custody, {
      after: 0,
      fetchImpl: async () =>
        Response.json({
          events: [
            { ...event, sequence: 1 },
            { ...event, sequence: 2 },
          ],
          cursor: 2,
          hasMore: false,
        }),
    }),
    /event identity/,
  );
});
