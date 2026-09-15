import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendLiveRoomEvent,
  commitLiveReviewRoom,
  createArtifactEnvelope,
  compressArtifactPayload,
  createLiveRoomClient,
  createLiveRoomDescriptor,
  createLiveRoomEvent,
  createLiveRoomEventFromReviewChange,
  createLiveRoomLinks,
  createLiveRoomSigner,
  createSignedLiveRoomEvent,
  digestArtifactEnvelope,
  decryptLiveRoomEvent,
  encryptLiveRoomEvent,
  encryptArtifactPayload,
  exportLiveRoomRecoveryBundle,
  hydrateLiveReviewRoom,
  importLiveRoomRecoveryBundle,
  parseLiveRoomLink,
  prepareLiveReviewRoom,
  recoverLiveReviewRoom,
  reduceLiveRoomEvents,
  verifySignedLiveRoomEvent,
} from '../../lib/artifact/index.mjs';

const roomId = 'room_123456789012';
const key = 'A'.repeat(43);
const write = 'B'.repeat(43);
const manage = 'C'.repeat(43);
const owner = 'D'.repeat(43);
const reviewOf = 'a'.repeat(64);

function pin() {
  return {
    id: 'pin-1', author: { name: 'Asem' }, artifactId: 'artifact',
    region: { x: 0.1, y: 0.2, w: 0, h: 0 }, viewport: { width: 1440, height: 2400 },
    intent: 'fix', status: 'open', comment: 'Fix this', replies: [],
    createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
  };
}

test('live room links isolate reviewer owner-verdict and management capabilities', () => {
  const links = createLiveRoomLinks({ roomId, key, writeCapability: write, ownerCapability: owner, manageCapability: manage });
  const review = parseLiveRoomLink(links.url);
  const verdict = parseLiveRoomLink(links.ownerUrl);
  const management = parseLiveRoomLink(links.manageUrl);
  assert.equal(review.write, write);
  assert.equal(review.manage, undefined);
  assert.equal(verdict.owner, owner);
  assert.equal(verdict.manage, undefined);
  assert.equal(management.manage, manage);
  assert.equal(management.owner, undefined);
  assert.doesNotMatch(links.url, new RegExp(manage));
  assert.throws(() => parseLiveRoomLink(`https://user:secret@example.test/r/${roomId}#k=${key}`), { code: 'E_ARTIFACT_ROOM_INVALID' });
  assert.throws(() => parseLiveRoomLink(`http://example.test/r/${roomId}#k=${key}`), { code: 'E_ARTIFACT_ROOM_INVALID' });
  assert.equal(parseLiveRoomLink(`http://127.0.0.1:8787/r/${roomId}#k=${key}`).role, 'reader');
  assert.throws(() => parseLiveRoomLink(`https://example.test/r/${roomId}#k=${key}&k=${key}`), { code: 'E_ARTIFACT_ROOM_INVALID' });
});

test('room event encryption round trips and binds room plus reviewed digest', async () => {
  const event = createLiveRoomEvent({ roomId, reviewOf, kind: 'pin', payload: pin(), eventId: 'event-1', createdAt: '2026-07-15T00:00:00.000Z' });
  const encrypted = await encryptLiveRoomEvent(event, { key });
  assert.doesNotMatch(encrypted.ciphertext, /Fix this/);
  assert.deepEqual(await decryptLiveRoomEvent(encrypted, { key, roomId, reviewOf }), event);
  await assert.rejects(() => decryptLiveRoomEvent(encrypted, { key, roomId, reviewOf: 'b'.repeat(64) }), { code: 'E_ARTIFACT_DIGEST_MISMATCH' });
});

test('room event decryption accepts versionless Worker records from existing rooms', async () => {
  const event = createLiveRoomEvent({ roomId, reviewOf, kind: 'pin', payload: pin(), eventId: 'event-legacy-wire', createdAt: '2026-07-15T00:00:00.000Z' });
  const encrypted = await encryptLiveRoomEvent(event, { key });
  const wire = { sequence: 1, iv: encrypted.iv, ciphertext: encrypted.ciphertext };
  assert.deepEqual(await decryptLiveRoomEvent(wire, { key, roomId, reviewOf }), event);
});

test('room reduction deduplicates replayed events and reserves final decision for owner event', () => {
  const events = [
    createLiveRoomEvent({ roomId, reviewOf, kind: 'pin', payload: pin(), eventId: '1', createdAt: '2026-07-15T00:00:00.000Z' }),
    createLiveRoomEvent({ roomId, reviewOf, kind: 'reply', payload: { pinId: 'pin-1', reply: { id: 'reply-1', author: { name: 'Sam' }, comment: 'Agree', createdAt: '2026-07-15T00:00:01.000Z' } }, eventId: '2', createdAt: '2026-07-15T00:00:01.000Z' }),
    createLiveRoomEvent({ roomId, reviewOf, kind: 'owner_decision', payload: { decision: 'changes_requested' }, eventId: '3', createdAt: '2026-07-15T00:00:02.000Z' }),
  ];
  const result = reduceLiveRoomEvents({ roomId, reviewOf, events: [...events, events[1]] });
  assert.equal(result.review.decision, 'changes_requested');
  assert.equal(result.review.pins[0].replies.length, 1);
});

test('append helper uploads ciphertext instead of feedback plaintext', async () => {
  const ownerSigner = await createLiveRoomSigner({ role: 'owner' });
  const descriptor = createLiveRoomDescriptor({ roomId, reviewOf, ownerSigner, createdAt: '2026-07-15T00:00:00.000Z' });
  let request;
  const client = {
    read: async () => ({ schemaVersion: '2.0.0', operation: 'read', descriptor, iv: 'A'.repeat(16), ciphertext: 'A'.repeat(22), expiresAt: '2026-07-22T00:00:00.000Z', commentsEnabled: true, generation: 0, head: `sha256:${'0'.repeat(64)}`, events: [] }),
    append: async (...args) => { request = args; return { ok: true }; },
  };
  const link = createLiveRoomLinks({ roomId, key, writeCapability: write, ownerCapability: owner, manageCapability: manage }).url;
  await appendLiveRoomEvent(link, createLiveRoomEvent({ roomId, reviewOf, kind: 'pin', payload: pin(), eventId: 'event-upload', createdAt: '2026-07-15T00:00:00.000Z' }), { client });
  assert.equal(request[0], roomId);
  assert.equal(request[1], write);
  assert.equal(request[2].expectedGeneration, 0);
  assert.equal(request[2].record.authorRole, 'reviewer');
  assert.equal(typeof request[2].record.ciphertext, 'string');
  assert.doesNotMatch(request[2].record.ciphertext, /Fix this/);
});

test('one hosted-style reviewer append and one owner digest-bound verdict converge through their separate authorities', async () => {
  const envelope = createArtifactEnvelope({ artifacts: [{ id: 'artifact', title: 'Artifact', html: '<p>journey</p>' }] });
  const boundReviewOf = digestArtifactEnvelope(envelope);
  const ownerSigner = await createLiveRoomSigner({ role: 'owner' });
  const descriptor = createLiveRoomDescriptor({ roomId, reviewOf: boundReviewOf, ownerSigner, createdAt: '2026-07-15T00:00:00.000Z' });
  const roomCiphertext = await encryptArtifactPayload(compressArtifactPayload(envelope).compressed, { key });
  const state = { generation: 0, head: `sha256:${'0'.repeat(64)}`, events: [] };
  const client = {
    read: async () => ({
      schemaVersion: '2.0.0', operation: 'read', descriptor,
      iv: roomCiphertext.iv, ciphertext: roomCiphertext.ciphertext,
      expiresAt: '2026-07-22T00:00:00.000Z', commentsEnabled: true,
      generation: state.generation, head: state.head, events: state.events,
    }),
    append: async (_id, capability, { expectedGeneration, record }) => {
      assert.equal(expectedGeneration, state.generation);
      const authorizedCapability = capability === write ? 'reviewer-write' : capability === owner ? 'owner-verdict' : null;
      assert.ok(authorizedCapability);
      const verified = await verifySignedLiveRoomEvent({
        descriptor,
        record,
        expectedSequence: state.generation + 1,
        expectedPredecessor: state.head,
        authorizedCapability,
      });
      state.events = [...state.events, verified.record];
      state.generation += 1;
      state.head = verified.recordHash;
      return { ok: true, generation: state.generation, head: state.head };
    },
  };
  const links = createLiveRoomLinks({ roomId, key, writeCapability: write, ownerCapability: owner, manageCapability: manage });
  const empty = reduceLiveRoomEvents({ roomId, reviewOf: boundReviewOf }).review;
  const reviewerReview = { ...empty, pins: [pin()], updatedAt: pin().updatedAt };
  const reviewerEvent = createLiveRoomEventFromReviewChange({
    roomId,
    reviewOf: boundReviewOf,
    role: 'reviewer',
    previousReview: empty,
    nextReview: reviewerReview,
  });
  assert.equal(reviewerEvent.kind, 'pin');
  await appendLiveRoomEvent(links.url, reviewerEvent, { client });
  const afterReviewer = await hydrateLiveReviewRoom(links.url, { client });
  assert.equal(afterReviewer.review.pins[0].comment, 'Fix this');

  const ownerReview = { ...afterReviewer.review, decision: 'approved', overall: 'Digest-bound owner verdict' };
  const ownerEvent = createLiveRoomEventFromReviewChange({
    roomId,
    reviewOf: boundReviewOf,
    role: 'owner',
    previousReview: afterReviewer.review,
    nextReview: ownerReview,
  });
  assert.equal(ownerEvent.kind, 'owner_decision');
  await appendLiveRoomEvent(links.ownerUrl, ownerEvent, { client, signer: ownerSigner });
  const final = await hydrateLiveReviewRoom(links.ownerUrl, { client });
  assert.equal(final.integrity.generation, 2);
  assert.deepEqual(final.integrity.quarantinedEventIds, []);
  assert.equal(final.review.decision, 'approved');
  assert.equal(final.review.overall, 'Digest-bound owner verdict');
  assert.equal(final.review.pins[0].comment, 'Fix this');
});

test('live room creation encrypts the compressed envelope bytes', async () => {
  let request;
  const fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({
      id: request.roomId,
      expiresAt: '2026-07-22T00:00:00.000Z',
      descriptor: {
        schemaVersion: '2.0.0',
        protocolVersion: '2.0.0',
        roomId: request.roomId,
        reviewOf: request.reviewOf,
        ownerKey: request.ownerKey,
        capabilities: { reviewer: 'reviewer-write', owner: 'owner-verdict', management: 'room-management' },
        createdAt: '2026-07-15T00:00:00.000Z',
      },
      generation: 0,
      head: `sha256:${'0'.repeat(64)}`,
    }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  const envelope = createArtifactEnvelope({
    artifacts: [{ id: 'artifact', title: 'Artifact', html: '<!doctype html><p>private</p>' }],
  });

  const result = await createLiveRoomClient({ fetchImpl }).create({ envelope, ttl: '7d' });

  assert.equal(result.action, 'artifact_live_room_created');
  assert.equal(request.schemaVersion, '2.0.0');
  assert.equal(request.operation, 'create');
  assert.equal(request.roomId, result.id);
  assert.match(request.creationId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(request.ownerKey.keyId, result.descriptor.ownerKey.keyId);
  assert.notEqual(request.reviewerCapability, request.ownerCapability);
  assert.notEqual(request.ownerCapability, request.manageCapability);
  assert.equal(typeof request.iv, 'string');
  assert.equal(typeof request.ciphertext, 'string');
  assert.doesNotMatch(request.ciphertext, /private/);
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(result)), 'ownerSigner'), false);
  assert.equal(typeof result.ownerSigner.sign, 'function');
});

test('one prepared creation survives a lost response and exact retry without rotating any secret', async () => {
  const envelope = createArtifactEnvelope({
    artifacts: [{ id: 'artifact', title: 'Artifact', html: '<p>retry-safe</p>' }],
  });
  const prepared = await prepareLiveReviewRoom(envelope, { ttl: '7d' });
  const recovery = await exportLiveRoomRecoveryBundle(prepared);
  const requests = [];
  let dropped = true;
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ body, headers: { ...options.headers } });
    if (dropped) {
      dropped = false;
      throw new Error('response lost after durable commit');
    }
    return new Response(JSON.stringify({
      id: body.roomId,
      expiresAt: '2026-07-22T00:00:00.000Z',
      descriptor: {
        schemaVersion: '2.0.0',
        protocolVersion: '2.0.0',
        roomId: body.roomId,
        reviewOf: body.reviewOf,
        ownerKey: body.ownerKey,
        capabilities: { reviewer: 'reviewer-write', owner: 'owner-verdict', management: 'room-management' },
        createdAt: '2026-07-15T00:00:00.000Z',
      },
      generation: 0,
      head: `sha256:${'0'.repeat(64)}`,
    }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  let ambiguousFailure;
  await assert.rejects(
    () => commitLiveReviewRoom(prepared, { fetchImpl }),
    (failure) => {
      ambiguousFailure = failure;
      return failure.code === 'E_ARTIFACT_ROOM_CREATE_AMBIGUOUS'
        && failure.details?.effect === 'ambiguous';
    },
  );
  assert.deepEqual(Object.keys(ambiguousFailure.details).sort(), ['effect', 'roomId']);
  const result = await commitLiveReviewRoom(prepared, { fetchImpl });
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(result.id, prepared.roomId);
  assert.equal(result.url, recovery.url);
  assert.equal(result.ownerUrl, recovery.ownerUrl);
  assert.equal(result.manageUrl, recovery.manageUrl);
  assert.equal(JSON.stringify(prepared).includes(requests[0].body.creationId), false);
  assert.equal(JSON.stringify(prepared).includes(requests[0].body.ciphertext), false);
  assert.equal(JSON.stringify(recovery).includes(requests[0].body.creationId), false);
  assert.equal(Object.hasOwn(recovery, 'ciphertext'), false);
  assert.equal(JSON.stringify(ambiguousFailure.toJSON()).includes(requests[0].body.creationId), false);
  assert.equal(JSON.stringify(ambiguousFailure.toJSON()).includes(requests[0].body.reviewerCapability), false);

  const imported = await importLiveRoomRecoveryBundle(recovery);
  assert.equal(imported.ownerUrl, recovery.ownerUrl);
  assert.equal(imported.ownerSigner.keyId, prepared.ownerKey.keyId);
  await assert.rejects(
    () => importLiveRoomRecoveryBundle({ ...recovery, ownerUrl: recovery.manageUrl }),
    { code: 'E_ARTIFACT_ROOM_INVALID' },
  );
  const recoveredRoom = await recoverLiveReviewRoom(recovery, {
    client: {
      read: async () => ({
        schemaVersion: '2.0.0',
        operation: 'read',
        descriptor: result.descriptor,
        iv: requests[0].body.iv,
        ciphertext: requests[0].body.ciphertext,
        expiresAt: result.expiresAt,
        commentsEnabled: true,
        generation: 0,
        head: `sha256:${'0'.repeat(64)}`,
        events: [],
      }),
    },
  });
  assert.equal(recoveredRoom.descriptor.roomId, prepared.roomId);
  assert.equal(recoveredRoom.ownerSigner.keyId, prepared.ownerKey.keyId);

  const rejected = await prepareLiveReviewRoom(envelope, { ttl: '7d' });
  await assert.rejects(
    () => commitLiveReviewRoom(rejected, {
      fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: 'invalid_request' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    }),
    (failure) => failure.code === 'E_ARTIFACT_ROOM_INVALID'
      && failure.details?.effect === 'none'
      && failure.details?.status === 400,
  );
});

test('legacy rooms hydrate as readable and permanently non-mutable', async () => {
  const envelope = createArtifactEnvelope({ artifacts: [{ id: 'artifact', title: 'Artifact', html: '<p>legacy</p>' }] });
  let createRequest;
  const createFetch = async (_url, options) => {
    createRequest = JSON.parse(options.body);
    return new Response('{}');
  };
  const preparedClient = createLiveRoomClient({ fetchImpl: createFetch });
  await assert.rejects(() => preparedClient.create({ envelope }), { code: 'E_ARTIFACT_ROOM_CREATE_AMBIGUOUS' });
  assert.equal(typeof createRequest.ciphertext, 'string');

  const { compressArtifactPayload } = await import('../../lib/artifact/codec.mjs');
  const { encryptArtifactPayload } = await import('../../lib/artifact/crypto.mjs');
  const encrypted = await encryptArtifactPayload(compressArtifactPayload(envelope).compressed, { key });
  const client = { read: async () => ({ reviewOf: await (async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ artifacts: envelope.artifacts, schemaVersion: envelope.schemaVersion, viewer: envelope.viewer }));
    void bytes;
    return createRequest.reviewOf;
  })(), iv: encrypted.iv, ciphertext: encrypted.ciphertext, expiresAt: '2026-07-22T00:00:00.000Z', commentsEnabled: true, events: [] }) };
  const link = createLiveRoomLinks({ roomId, key, writeCapability: write, ownerCapability: owner, manageCapability: manage }).url;
  const hydrated = await (await import('../../lib/artifact/index.mjs')).hydrateLiveReviewRoom(link, { client });
  assert.equal(hydrated.protocolVersion, '1.0.0');
  assert.deepEqual(hydrated.mutation, { enabled: false, reason: 'legacy-unsigned-room' });
  await assert.rejects(() => appendLiveRoomEvent(link, createLiveRoomEvent({ roomId, reviewOf: createRequest.reviewOf, kind: 'pin', payload: pin(), eventId: 'legacy-mutation' }), { client }), { code: 'E_ARTIFACT_ROOM_LEGACY_READ_ONLY' });
});

test('v2 hydration authenticates the full chain and rejects a foreign server head', async () => {
  const envelope = createArtifactEnvelope({ artifacts: [{ id: 'artifact', title: 'Artifact', html: '<p>signed</p>' }] });
  const signedReviewOf = digestArtifactEnvelope(envelope);
  const ownerSigner = await createLiveRoomSigner({ role: 'owner' });
  const reviewerSigner = await createLiveRoomSigner({ role: 'reviewer' });
  const descriptor = createLiveRoomDescriptor({ roomId, reviewOf: signedReviewOf, ownerSigner, createdAt: '2026-07-15T00:00:00.000Z' });
  const semantic = createLiveRoomEvent({ roomId, reviewOf: signedReviewOf, kind: 'pin', payload: pin(), eventId: 'signed-hydration', createdAt: '2026-07-15T00:00:01.000Z' });
  const eventCiphertext = await encryptLiveRoomEvent(semantic, { key });
  const record = await createSignedLiveRoomEvent({ descriptor, event: semantic, ciphertext: eventCiphertext, sequence: 1, signer: reviewerSigner, key });
  const head = (await verifySignedLiveRoomEvent({ descriptor, record })).recordHash;
  const roomCiphertext = await encryptArtifactPayload(compressArtifactPayload(envelope).compressed, { key });
  const room = { schemaVersion: '2.0.0', operation: 'read', descriptor, iv: roomCiphertext.iv, ciphertext: roomCiphertext.ciphertext, expiresAt: '2026-07-22T00:00:00.000Z', commentsEnabled: true, generation: 1, head, events: [record] };
  const client = { read: async () => room };
  const link = createLiveRoomLinks({ roomId, key, writeCapability: write, ownerCapability: owner, manageCapability: manage }).url;
  const hydrated = await hydrateLiveReviewRoom(link, { client });
  assert.equal(hydrated.protocolVersion, '2.0.0');
  assert.equal(hydrated.integrity.head, head);
  assert.equal(hydrated.review.pins[0].comment, 'Fix this');
  await assert.rejects(
    () => hydrateLiveReviewRoom(link, { client: { read: async () => ({ ...room, head: `sha256:${'f'.repeat(64)}` }) } }),
    { code: 'E_ARTIFACT_ROOM_EVENT_REPLAY' },
  );
});

test('semantic event payloads reject unknown fields and role payload drift before encryption', () => {
  assert.throws(() => createLiveRoomEvent({ roomId, reviewOf, kind: 'owner_decision', payload: { decision: 'approved', injected: true } }), { code: 'E_ARTIFACT_ROOM_EVENT_INVALID' });
  assert.throws(() => createLiveRoomEvent({ roomId, reviewOf, kind: 'pin_status', payload: { pinId: 'pin-1', status: 'reopened' } }), { code: 'E_ARTIFACT_ROOM_EVENT_INVALID' });
});
