import assert from 'node:assert/strict';
import test from 'node:test';
import { createArtifactEnvelope } from '../lib/artifact/envelope.mjs';
import {
  commitArtifactPaste,
  createPasteClient,
  createReviewLink,
  decodeReviewLink,
  prepareArtifactPaste,
} from '../lib/artifact/share-client.mjs';

const envelope = createArtifactEnvelope({
  artifacts: [{ id: 'home', title: 'Private', html: '<h1>Private prototype</h1>' }],
});
const receipt = (prepared) => ({
  schemaVersion: '2.0.0',
  operation: 'created',
  id: prepared.body.id,
  creationId: prepared.body.creationId,
  deletionToken: prepared.custodyToken,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
});
test('paste restart repeats exact encrypted bytes and private custody, while a public reader cannot replay creation', async () => {
  const prepared = await prepareArtifactPaste(envelope),
    saved = JSON.stringify(prepared);
  let first = true,
    original;
  const telemetry = [];
  const fetchImpl = async (url, options) => {
    assert.ok(url.endsWith('/api/v2/pastes'));
    assert.equal(options.headers['x-openplanr-paste-custody'], prepared.custodyToken);
    assert.equal(options.credentials, 'omit');
    if (original) assert.equal(options.body, original);
    original = options.body;
    if (first) {
      first = false;
      throw new Error('response lost');
    }
    return Response.json(receipt(prepared), { status: 201 });
  };
  const client = createPasteClient({ fetchImpl, onRequest: (value) => telemetry.push(value) });
  await assert.rejects(
    commitArtifactPaste(prepared, { pasteClient: client }),
    (error) => error.code === 'E_ARTIFACT_SHARE_NETWORK',
  );
  const restarted = JSON.parse(saved),
    result = await commitArtifactPaste(restarted, { pasteClient: client });
  assert.ok(!result.url.includes(prepared.custodyToken));
  assert.ok(!JSON.stringify(telemetry).includes(prepared.custodyToken));
  assert.equal(JSON.stringify(restarted), saved);
  let called = false;
  await assert.rejects(
    createPasteClient({
      fetchImpl: async () => {
        called = true;
      },
    }).create(prepared.body),
    /private custody/,
  );
  assert.equal(called, false);
  const decoded = await decodeReviewLink(result.url, {
    pasteClient: {
      baseUrl: prepared.origin,
      get: async () => ({
        ...prepared.body,
        operation: 'read',
        size: Buffer.from(prepared.body.ciphertext, 'base64url').length,
        expiresAt: receipt(prepared).expiresAt,
      }),
    },
  });
  assert.deepEqual(decoded, envelope);
});
test('preparation storage failure aborts before mutation, and resume rejects different current content', async () => {
  let called = false;
  const client = {
    baseUrl: 'https://share.openplanr.dev',
    create: async () => {
      called = true;
    },
  };
  await assert.rejects(
    createReviewLink(envelope, {
      short: true,
      yes: true,
      pasteClient: client,
      onPreparedPaste: () => {
        throw new Error('private storage failed');
      },
    }),
    /private storage failed/,
  );
  assert.equal(called, false);
  const prepared = await prepareArtifactPaste(envelope),
    changed = createArtifactEnvelope({
      artifacts: [{ id: 'home', title: 'Private', html: '<h1>Other prototype</h1>' }],
    });
  await assert.rejects(
    createReviewLink(changed, {
      short: true,
      yes: true,
      pasteClient: client,
      preparedPaste: prepared,
    }),
    /content differs/,
  );
  assert.equal(called, false);
});
test('paste v2 rejects replacement custody receipts and dispatches deletion through its versioned authenticated path', async () => {
  const prepared = await prepareArtifactPaste(envelope);
  await assert.rejects(
    commitArtifactPaste(prepared, {
      pasteClient: {
        baseUrl: prepared.origin,
        create: async () => ({ ...receipt(prepared), deletionToken: 'X'.repeat(43) }),
      },
    }),
    /receipt differs/,
  );
  let request;
  const client = createPasteClient({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(null, { status: 204 });
    },
  });
  await client.delete(prepared.body.id, prepared.custodyToken, { protocolVersion: '2.0.0' });
  assert.ok(request.url.endsWith(`/api/v2/pastes/${prepared.body.id}`));
  assert.equal(request.options.headers.authorization, `Bearer ${prepared.custodyToken}`);
  assert.ok(!request.url.includes(prepared.custodyToken));
});
test('malformed private preparation is rejected before network, including public identity reused as custody', async () => {
  const prepared = await prepareArtifactPaste(envelope);
  let called = false;
  const client = {
    create: async () => {
      called = true;
    },
  };
  for (const invalid of [
    { ...prepared, unexpected: 'authority' },
    { ...prepared, custodyToken: prepared.body.creationId },
    { ...prepared, key: 'Z'.repeat(43) },
  ])
    await assert.rejects(commitArtifactPaste(invalid, { pasteClient: client }));
  assert.equal(called, false);
});
