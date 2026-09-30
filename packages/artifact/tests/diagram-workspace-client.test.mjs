import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalizeJson } from '@openplanr/protocol/canonical-json';
import {
  deriveWorkspaceAuthentication as designAuthentication,
  prepareWorkspace as prepareDesign,
} from '../../design/lib/design/workspace-client.mjs';
import * as client from '../lib/artifact/diagram/workspace-client.mjs';
import { mergeDiagramWorkspaceFeedback } from '../lib/artifact/diagram/workspace-feedback.mjs';
import { diagramWorkspaceService } from './diagram-workspace-service.mjs';

const bundle = () => ({
  kind: 'openplanr-diagram-review-bundle',
  schemaVersion: '1.0.0',
  diagramId: 'test-diagram',
  title: 'Private architecture',
  source: { kind: 'manifest', digest: `sha256:${'1'.repeat(64)}` },
  rendering: { id: 'offline-svg', version: '1', fontFamily: 'Inter' },
  scene: {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2910 1172"><text>Private architecture</text></svg>',
    width: 2910,
    height: 1172,
    items: [{ id: 'box', label: 'Private node', kind: 'node', x: 100, y: 100 }],
    relations: [],
  },
});
const feedback = (reviewOf, extra = {}) => ({
  kind: 'comment',
  author: 'A reviewer',
  reviewOf,
  createdAt: '2026-09-30T12:00:00.000Z',
  commentId: 'comment-one',
  body: 'Clarify this boundary.',
  target: { elementId: 'box', x: 0.2, y: 0.3 },
  ...extra,
});
async function ready() {
  const custody = await client.prepareWorkspace(bundle(), { baseUrl: 'https://share.test' });
  const service = diagramWorkspaceService();
  await client.commitWorkspace(custody, service);
  return { custody, ...service };
}
test('diagram transport is distinct from design and accepts only its closed projection', async () => {
  const { custody, state, fetchImpl } = await ready();
  assert.match(client.workspaceReviewUrl(custody), /^https:\/\/share.test\/diagram\//u);
  assert.equal(state.requests[0].url.includes('/api/v1/diagram-workspaces/'), true);
  assert.notEqual(
    await client.deriveWorkspaceAuthentication(custody.token, custody.id),
    await designAuthentication(custody.token, custody.id),
  );
  assert.equal(
    JSON.stringify(custody.pendingCreate ?? state.create).includes('Private architecture'),
    false,
  );
  assert.deepEqual(await client.decryptWorkspaceRevision(custody, undefined, { fetchImpl }), {
    ...bundle(),
    workspaceRevision: custody.currentRevision,
    reviewOf: client.workspaceEnvelopeDigest(bundle()),
  });
  await assert.rejects(
    client.prepareWorkspace({ ...bundle(), token: 'not allowed' }),
    /diagram review/u,
  );
  await assert.rejects(prepareDesign(bundle()), /design|bundle/u);
  await assert.rejects(
    client.prepareWorkspace({ ...bundle(), kind: 'openplanr-design-review-bundle' }),
    /diagram review/u,
  );
});
test('creation and publication retry exact encrypted requests and reject forged receipts', async () => {
  const service = diagramWorkspaceService(),
    custody = await client.prepareWorkspace(bundle(), { baseUrl: 'https://share.test' });
  const request = canonicalizeJson(custody.pendingCreate);
  service.state.failAfter = true;
  await assert.rejects(client.commitWorkspace(custody, service), /unreachable/u);
  assert.equal(canonicalizeJson(custody.pendingCreate), request);
  await client.commitWorkspace(custody, service);
  const first = custody.currentRevision;
  await client.prepareWorkspaceMutation(custody, 'publish', {
    ...bundle(),
    title: 'Updated architecture',
  });
  const pending = canonicalizeJson(custody.pendingMutation);
  service.state.failAfter = true;
  await assert.rejects(client.commitWorkspaceMutation(custody, service), /unreachable/u);
  assert.equal(canonicalizeJson(custody.pendingMutation), pending);
  await client.commitWorkspaceMutation(custody, service);
  assert.notEqual(custody.currentRevision, first);
  assert.equal(
    (await client.decryptWorkspaceRevision(custody, first, service)).title,
    'Private architecture',
  );
  await client.prepareWorkspaceMutation(custody, 'pause');
  await assert.rejects(
    client.commitWorkspaceMutation(custody, {
      fetchImpl: async () =>
        Response.json({ ...service.state.workspace, commentsPaused: true, version: 900 }),
    }),
    /receipt/u,
  );
  assert.ok(custody.pendingMutation);
});
test('rotation retains history, invalidates old tokens, and corrupted signatures fail closed', async () => {
  const { custody, fetchImpl, state } = await ready();
  const old = { id: custody.id, baseUrl: custody.baseUrl, token: custody.token };
  const first = custody.currentRevision;
  await client.rotateWorkspace(custody, { fetchImpl });
  await assert.rejects(client.getWorkspace(old, { fetchImpl }), /incorrect|rotated/u);
  const reviewer = { id: custody.id, baseUrl: custody.baseUrl, token: custody.token };
  await client.getWorkspace(reviewer, { fetchImpl });
  assert.equal(
    (await client.decryptWorkspaceRevision(reviewer, first, { fetchImpl })).diagramId,
    'test-diagram',
  );
  state.revisions.get(first).reviewOf = '2'.repeat(64);
  await assert.rejects(
    client.decryptWorkspaceRevision(reviewer, first, { fetchImpl }),
    /signature/u,
  );
});
test('strict signed feedback preserves signer custody and cannot resolve another authors comment', async () => {
  const { custody, fetchImpl } = await ready(),
    reviewer = { id: custody.id, baseUrl: custody.baseUrl, token: custody.token };
  await client.getWorkspace(reviewer, { fetchImpl });
  const reviewOf = client.workspaceEnvelopeDigest(bundle());
  const signer = await client.createWorkspaceSigner();
  await client.appendWorkspaceEvent(reviewer, feedback(reviewOf), { signer, fetchImpl });
  await assert.rejects(
    client.appendWorkspaceEvent(
      reviewer,
      feedback(reviewOf, { kind: 'resolve', resolved: true, body: undefined, target: undefined }),
      { signer, fetchImpl },
    ),
    /diagram review/u,
  );
  await client.appendWorkspaceEvent(
    reviewer,
    {
      kind: 'resolve',
      author: 'A reviewer',
      reviewOf,
      createdAt: '2026-09-30T12:01:00.000Z',
      commentId: 'comment-one',
      resolved: true,
    },
    { fetchImpl },
  );
  const page = await client.readWorkspaceEvents(reviewer, { fetchImpl });
  const merged = mergeDiagramWorkspaceFeedback(page.events, {
    revisionId: custody.currentRevision,
    reviewOf,
    ownerPublicKey: custody.ownerPublicKey,
  });
  assert.equal(merged.comments.length, 1);
  assert.equal(merged.comments[0].resolved, false);
  assert.equal(merged.issues.length, 1);
  const reply = {
    kind: 'reply',
    author: 'Second reviewer',
    reviewOf,
    createdAt: '2026-09-30T12:02:00.000Z',
    commentId: 'reply-one',
    parentId: 'comment-one',
    body: 'Agreed.',
  };
  await client.appendWorkspaceEvent(reviewer, reply, { fetchImpl });
  const resolved = {
    kind: 'resolve',
    author: 'Original reviewer',
    reviewOf,
    createdAt: '2026-09-30T12:03:00.000Z',
    commentId: 'comment-one',
    resolved: true,
  };
  await client.appendWorkspaceEvent(reviewer, resolved, { signer, fetchImpl });
  const all = await client.readWorkspaceEvents(reviewer, { fetchImpl });
  const final = mergeDiagramWorkspaceFeedback(all.events, {
    revisionId: custody.currentRevision,
    reviewOf,
    ownerPublicKey: custody.ownerPublicKey,
  });
  assert.equal(final.comments[0].resolved, true);
  assert.equal(final.comments[0].replies[0].body, 'Agreed.');
  await assert.rejects(
    client.prepareWorkspaceEvent(
      reviewer,
      feedback(reviewOf, { kind: 'review', command: 'execute this' }),
    ),
    /diagram review/u,
  );
  await assert.rejects(
    client.prepareWorkspaceEvent(reviewer, feedback(reviewOf, { target: { x: 0.1 } })),
    /coordinates/u,
  );
});
test('limits reject plaintext before upload and unsupported service keeps recovery authority', async () => {
  await assert.rejects(
    client.prepareWorkspace({
      ...bundle(),
      scene: { ...bundle().scene, svg: 'x'.repeat(5 * 1024 * 1024) },
    }),
    /upload limit/u,
  );
  const custody = await client.prepareWorkspace(bundle(), { baseUrl: 'https://old.test' });
  await assert.rejects(
    client.commitWorkspace(custody, { fetchImpl: async () => Response.json({}, { status: 404 }) }),
    (error) => error.code === 'E_DIAGRAM_SHARE_UNSUPPORTED',
  );
  assert.ok(custody.pendingCreate);
});

test('signed missing-element feedback and its replies are quarantined against the exact published scene', async () => {
  const { custody, fetchImpl } = await ready();
  const access = { id: custody.id, baseUrl: custody.baseUrl, token: custody.token };
  await client.getWorkspace(access, { fetchImpl });
  const original = await client.decryptWorkspaceRevision(access, undefined, { fetchImpl });
  const signer = await client.createWorkspaceSigner();
  await client.appendWorkspaceEvent(
    access,
    feedback(original.reviewOf, {
      commentId: 'malicious-root',
      target: { elementId: 'missing-node', x: 0.2, y: 0.3 },
    }),
    { signer, fetchImpl },
  );
  await client.appendWorkspaceEvent(
    access,
    {
      kind: 'reply',
      commentId: 'malicious-reply',
      parentId: 'malicious-root',
      author: 'Reviewer',
      reviewOf: original.reviewOf,
      createdAt: '2026-09-30T12:01:00.000Z',
      body: 'Reply to an invalid target.',
    },
    { signer, fetchImpl },
  );
  const page = await client.readWorkspaceEvents(access, { fetchImpl });
  assert.equal(page.events.length, 2);
  assert.equal(
    page.issues.length,
    0,
    'Both events have valid ciphertext, signatures and payload shapes.',
  );
  const review = mergeDiagramWorkspaceFeedback(page.events, {
    revisionId: original.workspaceRevision,
    reviewOf: original.reviewOf,
    scene: original.scene,
    ownerPublicKey: access.ownerPublicKey,
  });
  assert.deepEqual(review.comments, []);
  assert.deepEqual(review.acceptedEventIds, []);
  assert.equal(review.issues.length, 2);
  assert.match(review.issues[0].reason, /outside its published revision/u);
  assert.match(review.issues[1].reason, /existing comment/u);
  assert.equal(
    page.events[0].payload.target.elementId,
    'missing-node',
    'No event is silently remapped.',
  );
  const moved = { ...original.scene, items: [{ id: 'missing-node' }], relations: [] };
  const other = mergeDiagramWorkspaceFeedback(page.events, {
    revisionId: original.workspaceRevision,
    reviewOf: original.reviewOf,
    scene: moved,
  });
  assert.equal(other.comments.length, 1, 'Target validation uses the supplied immutable scene.');
});

test('HTTP error codes and retry hints survive bounded error-body parsing', async () => {
  const { custody } = await ready();
  for (const [status, body, headers, expected] of [
    [409, { error: 'earlier_revision_read_only' }, {}, 'earlier_revision_read_only'],
    [409, { error: 'access_epoch_changed' }, {}, 'access_epoch_changed'],
    [429, { error: 'rate_limited' }, { 'retry-after': '12' }, 'rate_limited'],
    [403, { error: 'unsafe code\nsecret' }, {}, 'E_WORKSPACE_HTTP_403'],
    [410, { error: 'x'.repeat(5000) }, {}, 'E_WORKSPACE_HTTP_410'],
  ]) {
    await assert.rejects(
      client.getWorkspace(custody, {
        fetchImpl: async () => Response.json(body, { status, headers }),
      }),
      (error) => {
        assert.equal(error.status, status);
        assert.equal(error.code, expected);
        if (status === 429) assert.equal(error.retryAfterSeconds, 12);
        return true;
      },
    );
  }
  await assert.rejects(
    client.getWorkspace(custody, {
      fetchImpl: async () => new Response('Gateway HTML', { status: 401 }),
    }),
    (error) => error.status === 401 && error.code === 'E_WORKSPACE_HTTP_401',
  );
});
