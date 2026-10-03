import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeJson } from '@openplanr/protocol/canonical-json';
import {
  assertSharingSecurityContract,
  ROOM_V3_CAPABILITIES,
  ROOM_V3_GENESIS_HASH,
  verifyRoomV3Signature,
} from '@openplanr/protocol/sharing-security-contracts';
import { createArtifactEnvelope, digestArtifactEnvelope } from '../lib/artifact/envelope.mjs';
import {
  assertLiveRoomV3RecoveryMatchesPreparation,
  commitLiveReviewRoom,
  createLiveRoomEvent,
  exportLiveRoomRecoveryBundle,
  hydrateLiveReviewRoom,
  importLiveRoomRecoveryBundle,
  prepareLiveReviewRoom,
} from '../lib/artifact/live-room.mjs';
import { createLiveRoomSigner } from '../lib/artifact/live-room-integrity.mjs';
import {
  createSignedRoomV3Event,
  parseLiveRoomV3Link,
  verifySignedRoomV3Event,
} from '../lib/artifact/live-room-v3.mjs';
import { createReviewLink, decodeReviewLink } from '../lib/artifact/share-client.mjs';
import {
  decryptSharingPayload,
  encryptSharingPayload,
} from '../lib/artifact/sharing-crypto-v2.mjs';

const envelope = createArtifactEnvelope({
  artifacts: [{ id: 'one', title: 'Room', html: '<h1>Private room</h1>' }],
  viewer: { mode: 'single' },
});
test('new room preparation is opaque, retry identity survives recovery, and reads require the read capability', async () => {
  const prepared = await prepareLiveReviewRoom(envelope),
    recovery = await exportLiveRoomRecoveryBundle(prepared);
  assert.equal(prepared.protocolVersion, '3.0.0');
  assert.ok(!JSON.stringify(prepared).includes(recovery.key));
  assert.ok(!JSON.stringify(recovery.body).includes(digestArtifactEnvelope(envelope)));
  assert.ok(!Object.hasOwn(recovery.body, 'reviewOf'));
  const restored = await importLiveRoomRecoveryBundle(recovery);
  assert.deepEqual((await exportLiveRoomRecoveryBundle(restored)).body, recovery.body);
  const parsed = parseLiveRoomV3Link(restored.ownerUrl);
  assert.ok(parsed.readCapability);
  assert.ok(parsed.owner);
  assert.equal(parsed.write, null);
  let requestBody = null,
    requestCount = 0;
  const descriptor = {
    schemaVersion: '3.0.0',
    protocolVersion: '3.0.0',
    roomId: prepared.roomId,
    reviewCommitment: prepared.reviewCommitment,
    ownerKey: prepared.ownerKey,
    capabilities: ROOM_V3_CAPABILITIES,
    createdAt: new Date().toISOString(),
  };
  const fetchImpl = async (url, init) => {
    assert.ok(url.endsWith('/api/v2/rooms'));
    assert.equal(init.headers['x-openplanr-room-id'], prepared.roomId);
    requestCount++;
    if (requestBody) assert.equal(init.body, requestBody);
    requestBody = init.body;
    if (requestCount === 1) throw new Error('response lost');
    return Response.json({
      id: prepared.roomId,
      descriptor,
      generation: 0,
      head: ROOM_V3_GENESIS_HASH,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
  };
  await assert.rejects(commitLiveReviewRoom(restored, { fetchImpl }), /interrupted/);
  const result = await commitLiveReviewRoom(restored, { fetchImpl });
  assert.equal(result.id, prepared.roomId);
  assert.equal(requestCount, 2);
  assert.ok(await verifyRoomV3Signature('create', JSON.parse(requestBody), prepared.ownerKey));
  const room = {
    version: 'v3',
    cursor: 0,
    eventBytes: 2,
    sequence: 0,
    descriptor,
    iv: recovery.body.iv,
    ciphertext: recovery.body.ciphertext,
    commentsEnabled: true,
    events: [],
    nextCursor: null,
    generation: 0,
    head: ROOM_V3_GENESIS_HASH,
    expiresAt: result.expiresAt,
  };
  const hydrated = await hydrateLiveReviewRoom(result.ownerUrl, {
    client: {
      read: async (id, read) => {
        assert.equal(id, prepared.roomId);
        assert.equal(read, recovery.body.readCapability);
        return room;
      },
    },
  });
  assert.deepEqual(hydrated.envelope, envelope);
  assert.equal(hydrated.protocolVersion, '3.0.0');
  assert.equal(hydrated.mutation.enabled, true);
  await assert.rejects(
    importLiveRoomRecoveryBundle({ ...recovery, inputDigest: '0'.repeat(64) }),
    /payload differs/,
  );
});
test('room v3 signed semantic events conceal review digest and bind key, purpose, room and record identity', async () => {
  const prepared = await prepareLiveReviewRoom(envelope),
    recovery = await exportLiveRoomRecoveryBundle(prepared),
    descriptor = {
      schemaVersion: '3.0.0',
      protocolVersion: '3.0.0',
      roomId: prepared.roomId,
      reviewCommitment: prepared.reviewCommitment,
      ownerKey: prepared.ownerKey,
      capabilities: ROOM_V3_CAPABILITIES,
      createdAt: new Date().toISOString(),
    },
    signer = await createLiveRoomSigner({ role: 'reviewer' });
  const event = createLiveRoomEvent({
    roomId: prepared.roomId,
    reviewOf: digestArtifactEnvelope(envelope),
    kind: 'recommendation',
    payload: { author: { name: 'Reviewer' }, decision: 'approved', overall: 'Ready' },
  });
  const record = await createSignedRoomV3Event({
    descriptor,
    event,
    sequence: 1,
    signer,
    key: recovery.key,
  });
  assert.ok(!canonicalizeJson(record).includes(event.reviewOf));
  assert.ok(!Object.hasOwn(record, 'plaintextDigest'));
  assert.deepEqual(await verifySignedRoomV3Event({ descriptor, record, key: recovery.key }), event);
  await assert.rejects(
    verifySignedRoomV3Event({
      descriptor,
      record: { ...record, eventId: 'foreign' },
      key: recovery.key,
    }),
  );
  await assert.rejects(
    createSignedRoomV3Event({
      descriptor,
      event: { ...event, payload: { bad: true } },
      sequence: 1,
      signer,
      key: recovery.key,
    }),
  );
  const context = {
      version: '2.0.0',
      purpose: 'room-event',
      objectId: prepared.roomId,
      recordId: 'event-1',
    },
    sealed = await encryptSharingPayload(new TextEncoder().encode('secret'), {
      key: recovery.key,
      context,
    });
  for (const changed of [
    { ...context, purpose: 'artifact-paste' },
    { ...context, objectId: 'X'.repeat(22) },
    { ...context, recordId: 'event-2' },
  ])
    await assert.rejects(decryptSharingPayload(sealed, { key: recovery.key, context: changed }));
  assert.throws(
    () =>
      assertSharingSecurityContract(
        { ...recovery.body, readCapability: recovery.body.reviewerCapability },
        'artifact-room-create-v3',
      ),
    /distinct/,
  );
});
test('paste v2 round-trips through object-bound encryption and origin allowlist blocks injected network clients', async () => {
  let body;
  const client = {
    baseUrl: 'https://share.openplanr.dev',
    create: async (value, { custodyToken }) => {
      body = value;
      return {
        schemaVersion: '2.0.0',
        operation: 'created',
        id: value.id,
        creationId: value.creationId,
        deletionToken: custodyToken,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
    },
    get: async (id) => ({
      ...body,
      operation: 'read',
      size: Buffer.from(body.ciphertext, 'base64url').length,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    }),
  };
  const result = await createReviewLink(envelope, { short: true, yes: true, pasteClient: client });
  assert.equal(body.schemaVersion, '2.0.0');
  assert.ok(result.url.endsWith('&v=2'));
  assert.ok(!canonicalizeJson(body).includes('Private room'));
  assert.deepEqual(await decodeReviewLink(result.url, { pasteClient: client }), envelope);
  const forged = result.url.replace(`/p/${body.id}`, `/p/${'X'.repeat(43)}`);
  await assert.rejects(decodeReviewLink(forged, { pasteClient: client }));
  let called = false;
  await assert.rejects(
    decodeReviewLink(result.url.replace('share.openplanr.dev', 'evil.example'), {
      pasteClient: {
        get: async () => {
          called = true;
          return body;
        },
      },
    }),
    /origin/,
  );
  assert.equal(called, false);
});

test('browser v3 custody matches the original immutable private preparation and rejects forged authority inputs', async () => {
  const prepared = await prepareLiveReviewRoom(envelope),
    recovery = await exportLiveRoomRecoveryBundle(prepared);
  assert.equal(assertLiveRoomV3RecoveryMatchesPreparation(prepared, recovery), recovery);
  assert.ok(Object.isFrozen(prepared.ownerKey));
  for (const altered of [
    { ...recovery, key: 'X'.repeat(43) },
    { ...recovery, inputDigest: '0'.repeat(64) },
    { ...recovery, origin: 'https://other.example' },
    { ...recovery, body: { ...recovery.body, ttl: '1d' } },
    { ...recovery, unexpected: 'authority' },
  ])
    assert.throws(() => assertLiveRoomV3RecoveryMatchesPreparation(prepared, altered), /differs/);
  assert.throws(
    () => assertLiveRoomV3RecoveryMatchesPreparation({ ...prepared }, recovery),
    /differs/,
  );
});

test('new management signatures bind the exact room and client rejects crossed or missing identities before mutation', async () => {
  const { prepareLiveRoomV3Management, createLiveRoomV3Client } = await import(
    '../lib/artifact/live-room-v3.mjs'
  );
  const prepared = await prepareLiveReviewRoom(envelope);
  const request = await prepareLiveRoomV3Management(prepared.manageUrl, 'pause', {
    signer: prepared.ownerSigner,
    expectedGeneration: 0,
  });
  assert.equal(request.roomId, prepared.roomId);
  assert.equal(await verifyRoomV3Signature('management', request, prepared.ownerKey), true);
  assert.equal(
    await verifyRoomV3Signature(
      'management',
      { ...request, roomId: 'B'.repeat(22) },
      prepared.ownerKey,
    ),
    false,
  );
  const { roomId: _id, ...unbound } = request;
  assert.throws(() => assertSharingSecurityContract(unbound, 'artifact-room-management-v3'));
  let calls = 0;
  const client = createLiveRoomV3Client({
    fetchImpl: async () => {
      calls++;
      return Response.json({ generation: 1 });
    },
  });
  assert.throws(() => client.manage('B'.repeat(22), 'C'.repeat(43), request), /identity/);
  assert.equal(calls, 0);
  await assert.rejects(
    () => prepareLiveRoomV3Management(prepared.manageUrl, 'pause', { expectedGeneration: 0 }),
    /private owner signer/,
  );
});

test('saved room management retries exact body and rejects substituted receipts or origins', async () => {
  const { prepareLiveRoomV3Management, commitLiveRoomV3Management, createLiveRoomV3Client } =
    await import('../lib/artifact/live-room-v3.mjs');
  const prepared = await prepareLiveReviewRoom(envelope);
  const body = await prepareLiveRoomV3Management(prepared.manageUrl, 'resume', {
    signer: prepared.ownerSigner,
    expectedGeneration: 9,
  });
  let first,
    calls = 0;
  const client = createLiveRoomV3Client({
    fetchImpl: async (_url, init) => {
      calls++;
      if (first) assert.equal(init.body, first);
      first = init.body;
      if (calls === 1) throw Error('receipt lost');
      return Response.json({ generation: 10, commentsEnabled: true, deleted: false });
    },
  });
  await assert.rejects(
    () => commitLiveRoomV3Management(prepared.manageUrl, body, { client }),
    /exact saved/,
  );
  assert.equal(
    (await commitLiveRoomV3Management(prepared.manageUrl, structuredClone(body), { client }))
      .generation,
    10,
  );
  await assert.rejects(
    () =>
      commitLiveRoomV3Management(prepared.manageUrl, body, {
        client: createLiveRoomV3Client({ baseUrl: 'http://localhost:1234' }),
      }),
    /origin/,
  );
  await assert.rejects(
    () =>
      commitLiveRoomV3Management(prepared.manageUrl, body, {
        client: createLiveRoomV3Client({
          fetchImpl: async () =>
            Response.json({ generation: 11, commentsEnabled: true, deleted: false }),
        }),
      }),
    /receipt/,
  );
});
