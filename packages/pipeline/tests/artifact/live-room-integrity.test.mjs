import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

import { validateJson } from '../../conformance/json-schema-validate.mjs';
import {
  ARTIFACT_ROOM_GENESIS_HASH,
  base64UrlToBytes,
  createLiveRoomDescriptor,
  createLiveRoomEvent,
  createLiveRoomSigner,
  createSignedLiveRoomEvent,
  encryptArtifactPayload,
  encryptLiveRoomEvent,
  exportLiveRoomSignerSecret,
  importLiveRoomSignerSecret,
  liveRoomSignedEventBytes,
  reduceResilientSignedLiveRoomEvents,
  reduceSignedLiveRoomEvents,
  verifyLiveRoomEventChain,
  verifySignedLiveRoomEvent,
} from '../../lib/artifact/index.mjs';
import { loadSchema } from '../../lib/design/schema-loader.mjs';

const roomId = 'room_123456789012';
const reviewOf = 'a'.repeat(64);
const roomKey = 'A'.repeat(43);

async function taggedDigest(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(value);
  const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes));
  return `sha256:${[...digest].map((item) => item.toString(16).padStart(2, '0')).join('')}`;
}

test('owner signer stays opaque by default and round-trips only through explicit secret export', async () => {
  const signer = await createLiveRoomSigner({ role: 'owner', crypto: webcrypto });
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(signer)), 'privateKey'), false);
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(signer)), 'sign'), false);
  const secret = await exportLiveRoomSignerSecret(signer);
  assert.equal(secret.kind, 'openplanr-live-room-signer');
  assert.equal(secret.keyId, signer.keyId);
  assert.equal(typeof secret.privateKey, 'string');
  const imported = await importLiveRoomSignerSecret(secret, { crypto: webcrypto });
  assert.equal(imported.keyId, signer.keyId);
  const descriptor = createLiveRoomDescriptor({
    roomId,
    reviewOf,
    ownerSigner: imported,
    createdAt: '2026-07-15T00:00:00.000Z',
  });
  const event = createLiveRoomEvent({
    roomId,
    reviewOf,
    kind: 'owner_decision',
    payload: { decision: 'approved' },
    eventId: 'owner-imported',
    createdAt: '2026-07-15T00:00:01.000Z',
  });
  const ciphertext = await encryptLiveRoomEvent(event, { key: roomKey, crypto: webcrypto });
  const record = await createSignedLiveRoomEvent({
    descriptor,
    event,
    ciphertext,
    sequence: 1,
    signer: imported,
    key: roomKey,
    crypto: webcrypto,
  });
  assert.equal(
    (
      await verifySignedLiveRoomEvent({
        descriptor,
        record,
        event,
        expectedSequence: 1,
        expectedPredecessor: ARTIFACT_ROOM_GENESIS_HASH,
        key: roomKey,
        crypto: webcrypto,
      })
    ).record.eventId,
    event.eventId,
  );
});

function pin() {
  return {
    id: 'pin-1',
    author: { name: 'Reviewer' },
    artifactId: 'artifact',
    region: { x: 0.1, y: 0.2, w: 0, h: 0 },
    viewport: { width: 1440, height: 2400 },
    intent: 'fix',
    status: 'open',
    comment: 'Bind this feedback',
    replies: [],
    createdAt: '2026-08-23T10:00:01.000Z',
    updatedAt: '2026-08-23T10:00:01.000Z',
  };
}

function event(kind, payload, eventId, createdAt) {
  return createLiveRoomEvent({ roomId, reviewOf, kind, payload, eventId, createdAt });
}

async function signedFixture() {
  const owner = await createLiveRoomSigner({ role: 'owner', crypto: webcrypto });
  const reviewer = await createLiveRoomSigner({ role: 'reviewer', crypto: webcrypto });
  const descriptor = createLiveRoomDescriptor({
    roomId,
    reviewOf,
    ownerSigner: owner,
    createdAt: '2026-08-23T10:00:00.000Z',
  });
  const reviewerEvent = event('pin', pin(), 'event-reviewer', '2026-08-23T10:00:01.000Z');
  const reviewerCiphertext = await encryptLiveRoomEvent(reviewerEvent, {
    key: roomKey,
    crypto: webcrypto,
  });
  const reviewerRecord = await createSignedLiveRoomEvent({
    descriptor,
    event: reviewerEvent,
    ciphertext: reviewerCiphertext,
    sequence: 1,
    predecessor: ARTIFACT_ROOM_GENESIS_HASH,
    signer: reviewer,
    key: roomKey,
    crypto: webcrypto,
  });
  const first = await verifySignedLiveRoomEvent({
    descriptor,
    record: reviewerRecord,
    event: reviewerEvent,
    expectedSequence: 1,
    expectedPredecessor: ARTIFACT_ROOM_GENESIS_HASH,
    key: roomKey,
    crypto: webcrypto,
  });
  const ownerEvent = event(
    'owner_decision',
    { decision: 'changes_requested' },
    'event-owner',
    '2026-08-23T10:00:02.000Z',
  );
  const ownerCiphertext = await encryptLiveRoomEvent(ownerEvent, {
    key: roomKey,
    crypto: webcrypto,
  });
  const ownerRecord = await createSignedLiveRoomEvent({
    descriptor,
    event: ownerEvent,
    ciphertext: ownerCiphertext,
    sequence: 2,
    predecessor: first.recordHash,
    signer: owner,
    key: roomKey,
    crypto: webcrypto,
  });
  return { descriptor, owner, reviewer, reviewerEvent, reviewerRecord, ownerEvent, ownerRecord };
}

test('v2 descriptor registers only public owner material and distinct capability roles', async () => {
  const owner = await createLiveRoomSigner({ role: 'owner', crypto: webcrypto });
  const descriptor = createLiveRoomDescriptor({ roomId, reviewOf, ownerSigner: owner });
  assert.equal(descriptor.ownerKey.keyId, owner.keyId);
  assert.equal(descriptor.capabilities.reviewer, 'reviewer-write');
  assert.equal(descriptor.capabilities.owner, 'owner-verdict');
  assert.equal(descriptor.capabilities.management, 'room-management');
  assert.deepEqual(Object.keys(owner).sort(), ['algorithm', 'encoding', 'keyId', 'role', 'value']);
  assert.doesNotMatch(JSON.stringify({ descriptor, owner }), /private|pkcs8|secret/i);
  assert.deepEqual(validateJson(descriptor, loadSchema('artifact-room-descriptor', 'v1.1.0')), []);
});

test('signed chain verifies reviewer feedback and owner verdict before reduction', async () => {
  const fixture = await signedFixture();
  const entries = [
    { record: fixture.reviewerRecord, event: fixture.reviewerEvent },
    { record: fixture.ownerRecord, event: fixture.ownerEvent },
  ];
  const verified = await verifyLiveRoomEventChain({
    descriptor: fixture.descriptor,
    entries,
    key: roomKey,
    crypto: webcrypto,
  });
  assert.equal(verified.generation, 2);
  assert.match(verified.head, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    validateJson(fixture.reviewerEvent, loadSchema('artifact-room-event', 'v1.1.0')),
    [],
  );
  assert.deepEqual(
    validateJson(fixture.ownerRecord, loadSchema('artifact-room-signed-event', 'v1.1.0')),
    [],
  );
  assert.notDeepEqual(
    validateJson(
      { ...fixture.reviewerEvent, payload: { ...fixture.reviewerEvent.payload, injected: true } },
      loadSchema('artifact-room-event', 'v1.1.0'),
    ),
    [],
  );
  const projection = await reduceSignedLiveRoomEvents({
    descriptor: fixture.descriptor,
    entries,
    key: roomKey,
    crypto: webcrypto,
  });
  assert.equal(projection.review.decision, 'changes_requested');
  assert.equal(projection.review.pins[0].comment, 'Bind this feedback');
  assert.equal(projection.integrity.generation, 2);
});

test('reviewer signer cannot author an owner verdict and another owner key cannot replace custody', async () => {
  const fixture = await signedFixture();
  const forgedVerdict = event(
    'owner_decision',
    { decision: 'approved' },
    'forged-owner',
    '2026-08-23T10:00:03.000Z',
  );
  const ciphertext = await encryptLiveRoomEvent(forgedVerdict, { key: roomKey, crypto: webcrypto });
  await assert.rejects(
    () =>
      createSignedLiveRoomEvent({
        descriptor: fixture.descriptor,
        event: forgedVerdict,
        ciphertext,
        sequence: 3,
        predecessor: 'sha256:'.concat('b'.repeat(64)),
        signer: fixture.reviewer,
        key: roomKey,
        crypto: webcrypto,
      }),
    (error) => error.code === 'E_ARTIFACT_ROOM_FORBIDDEN',
  );
  const foreignOwner = await createLiveRoomSigner({ role: 'owner', crypto: webcrypto });
  await assert.rejects(
    () =>
      createSignedLiveRoomEvent({
        descriptor: fixture.descriptor,
        event: forgedVerdict,
        ciphertext,
        sequence: 3,
        predecessor: 'sha256:'.concat('b'.repeat(64)),
        signer: foreignOwner,
        key: roomKey,
        crypto: webcrypto,
      }),
    (error) => error.code === 'E_ARTIFACT_ROOM_FORBIDDEN',
  );
});

test('signature binds room review role kind ordering and ciphertext bytes', async () => {
  const fixture = await signedFixture();
  const changedCiphertext = `${fixture.ownerRecord.ciphertext.slice(0, -1)}${fixture.ownerRecord.ciphertext.endsWith('A') ? 'B' : 'A'}`;
  const mutations = [
    { ...fixture.ownerRecord, roomId: 'room_999999999999' },
    { ...fixture.ownerRecord, reviewOf: 'b'.repeat(64) },
    { ...fixture.ownerRecord, sequence: 3 },
    { ...fixture.ownerRecord, predecessor: 'sha256:'.concat('c'.repeat(64)) },
    { ...fixture.ownerRecord, kind: 'review_snapshot' },
    { ...fixture.ownerRecord, plaintextDigest: 'sha256:'.concat('d'.repeat(64)) },
    { ...fixture.ownerRecord, ciphertext: changedCiphertext },
  ];
  for (const record of mutations) {
    await assert.rejects(
      () =>
        verifySignedLiveRoomEvent({
          descriptor: fixture.descriptor,
          record,
          event: fixture.ownerEvent,
          crypto: webcrypto,
        }),
      (error) =>
        ['E_ARTIFACT_ROOM_EVENT_INVALID', 'E_ARTIFACT_DIGEST_MISMATCH'].includes(error.code),
    );
  }
  await assert.rejects(
    () =>
      verifySignedLiveRoomEvent({
        descriptor: fixture.descriptor,
        record: fixture.ownerRecord,
        authorizedCapability: 'reviewer-write',
        crypto: webcrypto,
      }),
    (error) => error.code === 'E_ARTIFACT_ROOM_FORBIDDEN',
  );
  for (const record of [
    { ...fixture.ownerRecord, signature: 'A' },
    {
      ...fixture.ownerRecord,
      authorKey: { ...fixture.ownerRecord.authorKey, value: 'A'.repeat(122) },
    },
  ]) {
    await assert.rejects(
      () =>
        verifySignedLiveRoomEvent({ descriptor: fixture.descriptor, record, crypto: webcrypto }),
      (error) => error.code === 'E_ARTIFACT_ROOM_EVENT_INVALID',
    );
  }
  await assert.rejects(
    () =>
      verifySignedLiveRoomEvent({
        descriptor: fixture.descriptor,
        record: fixture.ownerRecord,
        event: { ...fixture.ownerEvent, payload: { decision: 'approved' } },
        key: roomKey,
        crypto: webcrypto,
      }),
    (error) => error.code === 'E_ARTIFACT_ROOM_EVENT_INVALID',
  );
});

test('official signing rejects semantic/ciphertext drift and resilient hydration quarantines a malicious signed poison record', async () => {
  const fixture = await signedFixture();
  const foreignEvent = event(
    'pin',
    { ...pin(), id: 'pin-foreign', comment: 'different authenticated plaintext' },
    'event-foreign',
    '2099-01-01T00:00:00.000Z',
  );
  const foreignCiphertext = await encryptLiveRoomEvent(foreignEvent, {
    key: roomKey,
    crypto: webcrypto,
  });
  await assert.rejects(
    () =>
      createSignedLiveRoomEvent({
        descriptor: fixture.descriptor,
        event: fixture.reviewerEvent,
        ciphertext: foreignCiphertext,
        sequence: 1,
        signer: fixture.reviewer,
        key: roomKey,
        crypto: webcrypto,
      }),
    (error) => error.code === 'E_ARTIFACT_ROOM_EVENT_INVALID',
  );

  const nonJsonCiphertext = await encryptArtifactPayload(new TextEncoder().encode('not-json'), {
    key: roomKey,
    crypto: webcrypto,
  });
  const unsignedPoison = {
    ...fixture.reviewerRecord,
    iv: nonJsonCiphertext.iv,
    ciphertext: nonJsonCiphertext.ciphertext,
    ciphertextDigest: await taggedDigest(base64UrlToBytes(nonJsonCiphertext.ciphertext)),
  };
  const poison = {
    ...unsignedPoison,
    signature: await fixture.reviewer.sign(liveRoomSignedEventBytes(unsignedPoison)),
  };
  const poisonHash = (
    await verifySignedLiveRoomEvent({
      descriptor: fixture.descriptor,
      record: poison,
      expectedSequence: 1,
      expectedPredecessor: ARTIFACT_ROOM_GENESIS_HASH,
      crypto: webcrypto,
    })
  ).recordHash;
  const honestEvent = event(
    'owner_decision',
    { decision: 'approved' },
    'event-honest-after-poison',
    '2026-08-23T10:00:02.000Z',
  );
  const honestCiphertext = await encryptLiveRoomEvent(honestEvent, {
    key: roomKey,
    crypto: webcrypto,
  });
  const honestRecord = await createSignedLiveRoomEvent({
    descriptor: fixture.descriptor,
    event: honestEvent,
    ciphertext: honestCiphertext,
    sequence: 2,
    predecessor: poisonHash,
    signer: fixture.owner,
    key: roomKey,
    crypto: webcrypto,
  });

  const projection = await reduceResilientSignedLiveRoomEvents({
    descriptor: fixture.descriptor,
    records: [poison, honestRecord],
    key: roomKey,
    crypto: webcrypto,
  });
  assert.equal(projection.integrity.generation, 2);
  assert.deepEqual(projection.integrity.quarantinedEventIds, ['event-reviewer']);
  assert.equal(projection.review.decision, 'approved');
  assert.equal(projection.review.pins.length, 0);
});

test('exact replay is idempotent while divergent identity and reordered predecessor fail unchanged', async () => {
  const fixture = await signedFixture();
  const first = { record: fixture.reviewerRecord, event: fixture.reviewerEvent };
  const second = { record: fixture.ownerRecord, event: fixture.ownerEvent };
  const replayed = await verifyLiveRoomEventChain({
    descriptor: fixture.descriptor,
    entries: [first, first, second],
    key: roomKey,
    crypto: webcrypto,
  });
  assert.equal(replayed.generation, 2);
  assert.deepEqual(replayed.replayedEventIds, ['event-reviewer']);

  const divergent = {
    record: { ...fixture.reviewerRecord, ciphertextDigest: 'sha256:'.concat('f'.repeat(64)) },
    event: fixture.reviewerEvent,
  };
  await assert.rejects(
    () =>
      verifyLiveRoomEventChain({
        descriptor: fixture.descriptor,
        entries: [first, divergent],
        key: roomKey,
        crypto: webcrypto,
      }),
    (error) => error.code === 'E_ARTIFACT_ROOM_EVENT_REPLAY',
  );
  await assert.rejects(
    () =>
      verifyLiveRoomEventChain({
        descriptor: fixture.descriptor,
        entries: [
          first,
          {
            record: { ...fixture.ownerRecord, predecessor: ARTIFACT_ROOM_GENESIS_HASH },
            event: fixture.ownerEvent,
          },
        ],
        key: roomKey,
        crypto: webcrypto,
      }),
    (error) => error.code === 'E_ARTIFACT_ROOM_EVENT_REPLAY',
  );

  const staleEvent = event(
    'owner_decision',
    { decision: 'approved' },
    'event-stale',
    '2026-08-23T10:00:00.500Z',
  );
  const staleCiphertext = await encryptLiveRoomEvent(staleEvent, {
    key: roomKey,
    crypto: webcrypto,
  });
  const staleRecord = await createSignedLiveRoomEvent({
    descriptor: fixture.descriptor,
    event: staleEvent,
    ciphertext: staleCiphertext,
    sequence: 2,
    predecessor: (
      await verifySignedLiveRoomEvent({
        descriptor: fixture.descriptor,
        record: fixture.reviewerRecord,
        crypto: webcrypto,
      })
    ).recordHash,
    signer: fixture.owner,
    key: roomKey,
    crypto: webcrypto,
  });
  const timestampIndependent = await verifyLiveRoomEventChain({
    descriptor: fixture.descriptor,
    entries: [first, { record: staleRecord, event: staleEvent }],
    key: roomKey,
    crypto: webcrypto,
  });
  assert.equal(
    timestampIndependent.generation,
    2,
    'sequence and predecessor, not client wall-clock order, govern the chain',
  );
});
