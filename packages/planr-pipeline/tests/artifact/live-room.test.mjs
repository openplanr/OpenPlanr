import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendLiveRoomEvent,
  createLiveRoomClient,
  createLiveRoomEvent,
  createLiveRoomLinks,
  decryptLiveRoomEvent,
  encryptLiveRoomEvent,
  parseLiveRoomLink,
  reduceLiveRoomEvents,
} from '../../lib/artifact/index.mjs';

const roomId = 'room_123456789012';
const key = 'A'.repeat(43);
const write = 'B'.repeat(43);
const manage = 'C'.repeat(43);
const reviewOf = 'a'.repeat(64);

function pin() {
  return {
    id: 'pin-1', author: { name: 'Asem' }, artifactId: 'artifact',
    region: { x: 0.1, y: 0.2, w: 0, h: 0 }, viewport: { width: 1440, height: 2400 },
    intent: 'fix', status: 'open', comment: 'Fix this', replies: [],
    createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
  };
}

test('live room links isolate ordinary write and owner management capabilities', () => {
  const links = createLiveRoomLinks({ roomId, key, writeCapability: write, manageCapability: manage });
  const review = parseLiveRoomLink(links.url);
  const owner = parseLiveRoomLink(links.manageUrl);
  assert.equal(review.write, write);
  assert.equal(review.manage, undefined);
  assert.equal(owner.manage, manage);
  assert.equal(owner.write, undefined);
  assert.doesNotMatch(links.url, new RegExp(manage));
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
  let request;
  const client = { append: async (...args) => { request = args; return { ok: true }; } };
  const link = createLiveRoomLinks({ roomId, key, writeCapability: write, manageCapability: manage }).url;
  await appendLiveRoomEvent(link, createLiveRoomEvent({ roomId, reviewOf, kind: 'pin', payload: pin(), eventId: 'event-upload', createdAt: '2026-07-15T00:00:00.000Z' }), { client });
  assert.equal(request[0], roomId);
  assert.equal(request[1], write);
  assert.equal(typeof request[2].ciphertext, 'string');
  assert.doesNotMatch(request[2].ciphertext, /Fix this/);
});

test('live room creation encrypts the compressed envelope bytes', async () => {
  let request;
  const fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({
      id: roomId,
      expiresAt: '2026-07-22T00:00:00.000Z',
    }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  const envelope = {
    schemaVersion: '1.0.0',
    artifacts: [{ id: 'artifact', kind: 'html', title: 'Artifact', html: '<!doctype html><p>private</p>' }],
    viewer: { mode: 'single', activeArtifactId: 'artifact' },
  };

  const result = await createLiveRoomClient({ fetchImpl }).create({ envelope, ttl: '7d' });

  assert.equal(result.action, 'artifact_live_room_created');
  assert.equal(typeof request.iv, 'string');
  assert.equal(typeof request.ciphertext, 'string');
  assert.doesNotMatch(request.ciphertext, /private/);
});
