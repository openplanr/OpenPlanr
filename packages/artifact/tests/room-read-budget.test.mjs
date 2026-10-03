import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeJson } from '@openplanr/protocol/canonical-json';
import {
  assertSharingSecurityContract,
  ROOM_V3_CAPABILITIES,
  ROOM_V3_GENESIS_HASH,
  ROOM_V3_READ_LIMITS,
} from '@openplanr/protocol/sharing-security-contracts';
import { boundedResponseBytes } from '../lib/artifact/chunked-workspace-client.mjs';
import { createArtifactEnvelope, digestArtifactEnvelope } from '../lib/artifact/envelope.mjs';
import {
  createLiveRoomEvent,
  exportLiveRoomRecoveryBundle,
  hydrateLiveReviewRoom,
  prepareLiveReviewRoom,
} from '../lib/artifact/live-room.mjs';
import { createLiveRoomSigner } from '../lib/artifact/live-room-integrity.mjs';
import {
  commitLiveRoomV3Append,
  createLiveRoomV3Client,
  createSignedRoomV3Event,
  hydrateLiveReviewRoomV3,
  prepareLiveRoomV3Append,
} from '../lib/artifact/live-room-v3.mjs';
import { resourceSha256 } from '../lib/artifact/resource-pack.mjs';

const bytes = (value) => new TextEncoder().encode(canonicalizeJson(value)).byteLength;
async function fixture(count = 14) {
  const envelope = createArtifactEnvelope({
      artifacts: [{ id: 'home', title: 'History', html: '<h1>Private prototype</h1>' }],
    }),
    prepared = await prepareLiveReviewRoom(envelope),
    recovery = await exportLiveRoomRecoveryBundle(prepared),
    signer = await createLiveRoomSigner({ role: 'reviewer' });
  const descriptor = {
    schemaVersion: '3.0.0',
    protocolVersion: '3.0.0',
    roomId: prepared.roomId,
    reviewCommitment: prepared.reviewCommitment,
    ownerKey: prepared.ownerKey,
    capabilities: ROOM_V3_CAPABILITIES,
    createdAt: new Date().toISOString(),
  };
  let head = ROOM_V3_GENESIS_HASH;
  const records = [];
  for (let i = 0; i < count; i++) {
    const event = createLiveRoomEvent({
        roomId: prepared.roomId,
        reviewOf: digestArtifactEnvelope(envelope),
        kind: 'recommendation',
        payload: {
          author: { name: `Reviewer ${i}` },
          decision: 'approved',
          overall: 'x'.repeat(60000),
        },
      }),
      record = await createSignedRoomV3Event({
        descriptor,
        event,
        sequence: i + 1,
        predecessor: head,
        signer,
        key: recovery.key,
      });
    records.push(record);
    head = `sha256:${await resourceSha256(new TextEncoder().encode(canonicalizeJson(record)))}`;
  }
  const page = (cursor) => {
    const events = [];
    for (const record of records.slice(cursor)) {
      if (events.length === 10 || bytes([...events, record]) > ROOM_V3_READ_LIMITS.eventPageBytes)
        break;
      events.push(record);
    }
    const last = cursor + events.length;
    return {
      version: 'v3',
      descriptor,
      expiresAt: new Date(Date.now() + 86400000).toISOString().replace(/\.[0-9]{3}Z$/, 'Z'),
      commentsEnabled: true,
      generation: records.length + 3,
      sequence: records.length,
      head,
      cursor,
      eventBytes: bytes(events),
      events,
      nextCursor: last < records.length ? last : null,
      ...(cursor === 0 ? { iv: recovery.body.iv, ciphertext: recovery.body.ciphertext } : {}),
    };
  };
  const expiry = page(0).expiresAt;
  return {
    prepared,
    recovery,
    records,
    page: (cursor) => ({ ...page(cursor), expiresAt: expiry }),
  };
}
test('bounded authenticated history returns explicit continuation without skipping records or declaring a partial verdict complete', async () => {
  const f = await fixture(),
    reads = [],
    client = {
      read: async (_id, _cap, { cursor = 0 } = {}) => {
        reads.push(cursor);
        return f.page(cursor);
      },
    };
  const first = await hydrateLiveReviewRoom(f.prepared.ownerUrl, {
    client,
    maxAggregateBytes: 1024 * 1024,
  });
  assert.equal(first.complete, false);
  assert.equal(first.reviewComplete, false);
  assert.equal(first.review, null);
  assert.equal(first.mutation.enabled, false);
  assert.ok(first.consumedBytes <= 1024 * 1024);
  assert.equal(first.integrity.generation, f.records.length + 3);
  assert.ok(first.range.through > 0 && first.range.through < f.records.length);
  const rest = await hydrateLiveReviewRoomV3(f.prepared.ownerUrl, {
    client,
    continuation: first.continuation,
    maxAggregateBytes: 1024 * 1024,
  });
  assert.equal(rest.complete, true);
  assert.equal(rest.range.after, first.range.through);
  assert.equal(rest.range.through, f.records.length);
  assert.equal(first.events.length + rest.events.length, f.records.length);
  assert.equal(rest.integrity.head, f.page(0).head);
  assert.ok(reads.includes(first.range.through));
  const final = await hydrateLiveReviewRoom(f.prepared.ownerUrl, {
    client,
    continuation: first.continuation,
    maxAggregateBytes: 1024 * 1024,
  });
  assert.equal(final.reviewComplete, true);
  assert.equal(final.recommendations.length, f.records.length);
  assert.equal(final.mutation.enabled, true);
  assert.equal(final.review.decision, 'pending');

  await assert.rejects(
    hydrateLiveReviewRoomV3(f.prepared.ownerUrl, {
      client,
      continuation: { ...first.continuation },
    }),
    /continuation is unavailable/,
  );
  await assert.rejects(
    hydrateLiveReviewRoomV3(f.prepared.ownerUrl, {
      client: {
        read: async () => ({ ...f.page(first.range.through), generation: f.records.length + 4 }),
      },
      continuation: first.continuation,
    }),
    /changed/,
  );
});
test('canonical page accounting rejects dishonest byte counts, skipped cursors, repeated envelopes and premature terminal cursors', async () => {
  const f = await fixture(1),
    page = f.page(0);
  assert.equal(assertSharingSecurityContract(page, 'artifact-room-read-page-v3'), page);
  for (const invalid of [
    { ...page, eventBytes: 0 },
    { ...page, sequence: 2, nextCursor: null },
    { ...page, cursor: 1 },
    { ...page, nextCursor: 0 },
    { ...page, generation: 0 },
  ])
    assert.throws(() => assertSharingSecurityContract(invalid, 'artifact-room-read-page-v3'));
  const client = createLiveRoomV3Client({
    baseUrl: 'https://share.openplanr.dev',
    fetchImpl: async () => Response.json({ ...page, cursor: 1 }),
  });
  await assert.rejects(
    client.read(f.prepared.roomId, f.recovery.body.readCapability),
    /room|Room|Invalid/,
  );
});
test('hostile declared and actual response sizes are rejected before an unbounded JSON allocation', async () => {
  let cancelled = false;
  const declared = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { 'content-length': String(ROOM_V3_READ_LIMITS.pageBytes + 1) } },
  );
  await assert.rejects(
    boundedResponseBytes(declared, ROOM_V3_READ_LIMITS.pageBytes),
    /declared size/,
  );
  assert.equal(cancelled, true);
  const actual = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2048));
        controller.close();
      },
    }),
    { headers: { 'content-length': '1' } },
  );
  await assert.rejects(boundedResponseBytes(actual, 1024), /byte limit/);
});

test('saved v3 append retries exact bytes with independent management generation and log sequence', async () => {
  const f = await fixture(1),
    reader = { read: async () => f.page(0) };
  const event = createLiveRoomEvent({
    roomId: f.prepared.roomId,
    reviewOf: digestArtifactEnvelope(
      createArtifactEnvelope({
        artifacts: [{ id: 'home', title: 'History', html: '<h1>Private prototype</h1>' }],
      }),
    ),
    kind: 'recommendation',
    payload: { author: { name: 'Another reviewer' }, decision: 'approved', overall: 'Ready' },
  });
  const body = await prepareLiveRoomV3Append(f.prepared.url, event, { client: reader });
  assert.equal(body.expectedGeneration, 4);
  assert.equal(body.record.sequence, 2);
  assert.ok(Object.isFrozen(body.record.authorKey));
  const exact = canonicalizeJson(body),
    head = `sha256:${await resourceSha256(new TextEncoder().encode(canonicalizeJson(body.record)))}`;
  let writes = 0;
  const client = createLiveRoomV3Client({
    baseUrl: 'https://share.openplanr.dev',
    fetchImpl: async (url, init) => {
      writes++;
      assert.equal(init.body, exact);
      assert.ok(init.headers.Authorization);
      assert.ok(url.endsWith('/events'));
      if (writes === 1) throw new Error('response lost after commit');
      return Response.json({ eventId: body.record.eventId, sequence: 2, generation: 5, head });
    },
  });
  await assert.rejects(
    commitLiveRoomV3Append(f.prepared.url, JSON.parse(exact), { client }),
    /interrupted/,
  );
  assert.equal(
    (await commitLiveRoomV3Append(f.prepared.url, JSON.parse(exact), { client })).generation,
    5,
  );
  assert.equal(writes, 2);
  await assert.rejects(
    commitLiveRoomV3Append(f.prepared.url, { ...body, extra: 'authority' }, { client }),
    /Invalid/,
  );
  assert.equal(writes, 2);
});

test('a completed continuation supplies a private authenticated append basis without rereading the full retained history', async () => {
  const f = await fixture();
  let reads = 0;
  const client = {
    read: async (_id, _cap, { cursor = 0 } = {}) => {
      reads++;
      return f.page(cursor);
    },
  };
  const first = await hydrateLiveReviewRoom(f.prepared.url, {
    client,
    maxAggregateBytes: 1024 * 1024,
  });
  assert.equal(first.complete, false);
  assert.equal(first.appendBasis, null);
  const complete = await hydrateLiveReviewRoom(f.prepared.url, {
    client,
    continuation: first.continuation,
    maxAggregateBytes: 1024 * 1024,
  });
  assert.equal(complete.complete, true);
  assert.ok(Object.isFrozen(complete.appendBasis));
  const before = reads;
  const event = createLiveRoomEvent({
    roomId: f.prepared.roomId,
    reviewOf: complete.reviewOf,
    kind: 'recommendation',
    payload: {
      author: { name: 'Continued reviewer' },
      decision: 'approved',
      overall: 'Verified complete history',
    },
  });
  // Mutable public projection fields cannot alter the private authenticated terminal proof.
  complete.descriptor.reviewCommitment = 'a'.repeat(64);
  complete.integrity.generation = 999;
  const body = await prepareLiveRoomV3Append(f.prepared.url, event, {
    client,
    appendBasis: complete.appendBasis,
  });
  assert.equal(reads, before);
  assert.equal(body.expectedGeneration, f.records.length + 3);
  assert.equal(body.record.sequence, f.records.length + 1);
  assert.equal(body.record.predecessor, f.page(0).head);
  await assert.rejects(
    prepareLiveRoomV3Append(f.prepared.url, event, {
      client,
      appendBasis: structuredClone(complete.appendBasis),
    }),
    /basis.*unavailable/,
  );
  await assert.rejects(
    prepareLiveRoomV3Append(f.prepared.url.replace(f.prepared.roomId, 'Z'.repeat(22)), event, {
      client,
      appendBasis: complete.appendBasis,
    }),
    /another read/,
  );
  assert.equal(reads, before);
});
