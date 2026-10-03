import { decryptSharingPayload, encryptSharingPayload } from './sharing-crypto-v2.mjs';

export { decryptSharingPayload, encryptSharingPayload } from './sharing-crypto-v2.mjs';

/** Strong room transport: authenticated reads and encrypted semantic identities. */
import { canonicalizeJson } from '@openplanr/protocol/canonical-json';
import {
  assertSharingSecurityContract,
  ROOM_V3_API,
  ROOM_V3_CAPABILITIES,
  ROOM_V3_GENESIS_HASH,
  ROOM_V3_READ_LIMITS,
  roomV3SignatureBytes,
  SHARING_CRYPTO_CONTEXT,
  verifyRoomV3Signature,
} from '@openplanr/protocol/sharing-security-contracts';
import { boundedResponseBytes } from './chunked-workspace-client.mjs';
import {
  canonicalArtifactJson,
  compressArtifactPayload,
  decodeCompressedArtifactPayload,
} from './codec.mjs';
import { assertEnvelope, digestEnvelope } from './live-room.mjs';
import {
  createLiveRoomSigner,
  exportLiveRoomSignerSecret,
  importLiveRoomSignerSecret,
  normalizeSemanticEvent,
} from './live-room-integrity.mjs';
import { decodeResourceBytes, encodeResourceBytes, resourceSha256 } from './resource-pack.mjs';

const encoder = new TextEncoder(),
  decoder = new TextDecoder('utf-8', { fatal: true });
const preparations = new WeakMap();
const continuations = new WeakMap();
const appendBases = new WeakMap();
export function isLiveRoomV3Preparation(value) {
  return preparations.has(value);
}
function attachPreparation(body, state) {
  body = structuredClone(body);
  Object.freeze(body.ownerKey);
  Object.freeze(body);
  state = { ...state, body };
  const prepared = {
    schemaVersion: '1.0.0',
    kind: 'openplanr-live-room-preparation',
    protocolVersion: '3.0.0',
    id: body.roomId,
    roomId: body.roomId,
    ttl: body.ttl,
    reviewCommitment: body.reviewCommitment,
    ownerKey: body.ownerKey,
  };
  Object.defineProperties(
    prepared,
    Object.fromEntries(
      Object.entries({ ...state.links, ownerSigner: state.ownerSigner }).map(([key, value]) => [
        key,
        { value, enumerable: false },
      ]),
    ),
  );
  Object.freeze(prepared);
  preparations.set(prepared, state);
  return prepared;
}
const token = () => encodeResourceBytes(crypto.getRandomValues(new Uint8Array(32)));
function base(value = 'https://share.openplanr.dev') {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new TypeError('Sharing requires a secure origin.');
  return url.origin;
}
async function commitment(key, roomId, reviewOf, ownerKey) {
  const material = await crypto.subtle.importKey(
    'raw',
    decodeResourceBytes(key, 32),
    'HKDF',
    false,
    ['deriveKey'],
  );
  const hmac = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(roomId),
      info: encoder.encode('openplanr.room-review-commitment.v3'),
    },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );
  return [
    ...new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        hmac,
        encoder.encode(canonicalizeJson({ reviewOf, ownerKey })),
      ),
    ),
  ]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
}
function publicKey(signer) {
  return {
    algorithm: signer.algorithm,
    encoding: signer.encoding,
    keyId: signer.keyId,
    value: signer.publicKey ?? signer.value,
  };
}
export function parseLiveRoomV3Link(link, { allowedOrigins } = {}) {
  const url = new URL(link),
    origin = base(url.origin);
  if (
    !(allowedOrigins ?? ['https://share.openplanr.dev']).includes(origin) &&
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new TypeError('Room origin is not allowed.');
  if (url.search || url.username || url.password) throw new TypeError('Room link is invalid.');
  const roomId = /^\/r\/([A-Za-z0-9_-]{16,128})\/?$/u.exec(url.pathname)?.[1];
  const params = new URLSearchParams(url.hash.slice(1));
  if (
    !roomId ||
    [...params.keys()].some((key) => !['k', 'r', 'w', 'o', 'm'].includes(key)) ||
    [...params.keys()].some((key) => params.getAll(key).length !== 1) ||
    !params.has('k') ||
    !params.has('r') ||
    ['w', 'o', 'm'].filter((key) => params.has(key)).length > 1 ||
    [...params.values()].some((value) => !/^[A-Za-z0-9_-]{43}$/u.test(value))
  )
    throw new TypeError('Room link is invalid.');
  return {
    origin,
    roomId,
    key: params.get('k'),
    readCapability: params.get('r'),
    writeCapability: params.get('w'),
    ownerCapability: params.get('o'),
    manageCapability: params.get('m'),
    write: params.get('w'),
    owner: params.get('o'),
    manage: params.get('m'),
    role: params.has('o')
      ? 'owner'
      : params.has('w')
        ? 'reviewer'
        : params.has('m')
          ? 'management'
          : 'viewer',
  };
}
export async function prepareLiveReviewRoomV3(envelope, { baseUrl, ttl = '7d', ownerSigner } = {}) {
  assertEnvelope(envelope);
  ownerSigner ??= await createLiveRoomSigner({ role: 'owner' });
  if (ownerSigner.role !== 'owner') throw new TypeError('Room creation requires its owner signer.');
  const roomId = token(),
    creationId = token(),
    key = token(),
    reviewOf = await digestEnvelope(envelope);
  const ownerKey = publicKey(ownerSigner),
    reviewCommitment = await commitment(key, roomId, reviewOf, ownerKey);
  const encrypted = await encryptSharingPayload(compressArtifactPayload(envelope).compressed, {
    key,
    context: { version: '2.0.0', purpose: 'room-envelope', objectId: roomId, recordId: roomId },
  });
  const body = {
    schemaVersion: '3.0.0',
    operation: 'create',
    roomId,
    creationId,
    ttl,
    reviewCommitment,
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
    ownerKey,
    readCapability: token(),
    reviewerCapability: token(),
    ownerCapability: token(),
    manageCapability: token(),
  };
  body.signature = await ownerSigner.sign(roomV3SignatureBytes('create', body));
  assertSharingSecurityContract(body, 'artifact-room-create-v3');
  const origin = base(baseUrl),
    prefix = `${origin}/r/${roomId}#k=${key}&r=${body.readCapability}`;
  const links = {
    url: `${prefix}&w=${body.reviewerCapability}`,
    ownerUrl: `${prefix}&o=${body.ownerCapability}`,
    manageUrl: `${prefix}&m=${body.manageCapability}`,
  };
  return attachPreparation(body, {
    body,
    key,
    links,
    ownerSigner,
    origin,
    reviewOf,
    inputDigest: await resourceSha256(encoder.encode(canonicalArtifactJson(envelope))),
  });
}
export async function exportLiveRoomV3Recovery(prepared) {
  const state = preparations.get(prepared);
  if (!state) throw new TypeError('Room preparation is unavailable.');
  return {
    schemaVersion: '2.0.0',
    kind: 'openplanr-live-room-recovery',
    origin: state.origin,
    body: structuredClone(state.body),
    key: state.key,
    reviewOf: state.reviewOf,
    inputDigest: state.inputDigest,
    ownerSigner: await exportLiveRoomSignerSecret(state.ownerSigner),
  };
}
/** Compare browser custody against its original private preparation without decrypting again. */
export function assertLiveRoomV3RecoveryMatchesPreparation(prepared, recovery) {
  const state = preparations.get(prepared),
    names = [
      'schemaVersion',
      'kind',
      'origin',
      'body',
      'key',
      'reviewOf',
      'inputDigest',
      'ownerSigner',
    ];
  if (
    !state ||
    !recovery ||
    typeof recovery !== 'object' ||
    Array.isArray(recovery) ||
    Object.keys(recovery).length !== names.length ||
    Object.keys(recovery).some((name) => !names.includes(name)) ||
    Object.values(Object.getOwnPropertyDescriptors(recovery)).some(
      (descriptor) => !('value' in descriptor),
    ) ||
    recovery.schemaVersion !== '2.0.0' ||
    recovery.kind !== 'openplanr-live-room-recovery'
  )
    throw new TypeError('Room recovery differs from its private preparation.');
  assertSharingSecurityContract(recovery.body, 'artifact-room-create-v3');
  const expected = {
    origin: state.origin,
    body: state.body,
    key: state.key,
    reviewOf: state.reviewOf,
    inputDigest: state.inputDigest,
  };
  const actual = {
    origin: recovery.origin,
    body: recovery.body,
    key: recovery.key,
    reviewOf: recovery.reviewOf,
    inputDigest: recovery.inputDigest,
  };
  if (canonicalizeJson(expected) !== canonicalizeJson(actual))
    throw new TypeError('Room recovery differs from its private preparation.');
  return recovery;
}
export async function importLiveRoomV3Recovery(recovery) {
  if (
    !recovery ||
    Object.keys(recovery).length !== 8 ||
    Object.keys(recovery).some(
      (key) =>
        ![
          'schemaVersion',
          'kind',
          'origin',
          'body',
          'key',
          'reviewOf',
          'inputDigest',
          'ownerSigner',
        ].includes(key),
    )
  )
    throw new TypeError('Room recovery is invalid.');
  if (recovery?.kind !== 'openplanr-live-room-recovery' || recovery.schemaVersion !== '2.0.0')
    throw new TypeError('Room recovery is invalid.');
  const body = assertSharingSecurityContract(recovery.body, 'artifact-room-create-v3');
  const ownerSigner = await importLiveRoomSignerSecret(recovery.ownerSigner);
  if (
    !(await verifyRoomV3Signature('create', body, body.ownerKey)) ||
    canonicalizeJson(publicKey(ownerSigner)) !== canonicalizeJson(body.ownerKey) ||
    (await commitment(recovery.key, body.roomId, recovery.reviewOf, body.ownerKey)) !==
      body.reviewCommitment
  )
    throw new TypeError('Room recovery identity differs.');
  const origin = base(recovery.origin),
    prefix = `${origin}/r/${body.roomId}#k=${recovery.key}&r=${body.readCapability}`;
  const plaintext = await decryptSharingPayload(
    { version: '2.0.0', iv: body.iv, ciphertext: body.ciphertext },
    {
      key: recovery.key,
      context: {
        version: '2.0.0',
        purpose: 'room-envelope',
        objectId: body.roomId,
        recordId: body.roomId,
      },
    },
  );
  const envelope = decodeCompressedArtifactPayload(plaintext).value;
  assertEnvelope(envelope);
  if (
    (await digestEnvelope(envelope)) !== recovery.reviewOf ||
    (await resourceSha256(encoder.encode(canonicalArtifactJson(envelope)))) !== recovery.inputDigest
  )
    throw new TypeError('Room recovery payload differs.');
  return attachPreparation(body, {
    body,
    key: recovery.key,
    origin,
    ownerSigner,
    reviewOf: recovery.reviewOf,
    inputDigest: recovery.inputDigest,
    links: {
      url: `${prefix}&w=${body.reviewerCapability}`,
      ownerUrl: `${prefix}&o=${body.ownerCapability}`,
      manageUrl: `${prefix}&m=${body.manageCapability}`,
    },
  });
}
export function createLiveRoomV3Client({ baseUrl, fetchImpl = globalThis.fetch } = {}) {
  const origin = base(baseUrl);
  async function request(path, { method = 'GET', body, capability, stream = false, signal } = {}) {
    const headers = {
      Accept: stream ? 'text/event-stream' : 'application/json',
      ...(capability ? { Authorization: `Bearer ${capability}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(body?.operation === 'create' ? { 'x-openplanr-room-id': body.roomId } : {}),
    };
    let response;
    try {
      response = await fetchImpl(`${origin}${ROOM_V3_API}${path}`, {
        method,
        headers,
        body: body ? canonicalizeJson(body) : undefined,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: signal ?? AbortSignal.timeout(20000),
      });
    } catch (cause) {
      throw Object.assign(
        new Error('Room sharing was interrupted. Retry the exact saved operation.'),
        { code: 'E_ROOM_CREATE_AMBIGUOUS', cause },
      );
    }
    if (!response.ok)
      throw Object.assign(
        new Error(
          response.status === 404 || response.status === 426
            ? 'The sharing service needs the room-v3 upgrade. Retry your saved preparation after it is updated.'
            : `Room sharing failed (${response.status}).`,
        ),
        {
          status: response.status,
          code:
            response.status === 404 || response.status === 426
              ? 'E_ROOM_UNSUPPORTED'
              : `E_ROOM_HTTP_${response.status}`,
        },
      );
    return stream
      ? response
      : JSON.parse(
          decoder.decode(await boundedResponseBytes(response, ROOM_V3_READ_LIMITS.pageBytes)),
        );
  }
  return {
    baseUrl: origin,
    async create(prepared) {
      const state = preparations.get(prepared);
      if (!state || state.origin !== origin)
        throw new TypeError('Room preparation belongs to another service.');
      const result = await request('', { method: 'POST', body: state.body });
      assertSharingSecurityContract(result.descriptor, 'artifact-room-descriptor-v3');
      if (
        result.id !== prepared.roomId ||
        result.descriptor.roomId !== prepared.roomId ||
        result.descriptor.reviewCommitment !== prepared.reviewCommitment ||
        canonicalizeJson(result.descriptor.ownerKey) !== canonicalizeJson(prepared.ownerKey) ||
        result.generation !== 0 ||
        result.head !== ROOM_V3_GENESIS_HASH ||
        !Number.isFinite(Date.parse(result.expiresAt))
      )
        throw new TypeError('Room creation receipt differs from the saved preparation.');
      const receipt = {
        ...result,
        ...state.links,
        ok: true,
        action: 'artifact_live_room_created',
        reviewOf: state.reviewOf,
      };
      Object.defineProperties(receipt, {
        ownerSigner: { value: state.ownerSigner, enumerable: false },
        prepared: { value: prepared, enumerable: false },
      });
      return Object.freeze(receipt);
    },
    async read(roomId, readCapability, { cursor = 0 } = {}) {
      if (
        !Number.isSafeInteger(cursor) ||
        cursor < 0 ||
        cursor > ROOM_V3_READ_LIMITS.retainedEvents
      )
        throw new TypeError('Invalid room read cursor.');
      if (!/^[A-Za-z0-9_-]{16,128}$/u.test(roomId) || !/^[A-Za-z0-9_-]{43}$/u.test(readCapability))
        throw new TypeError('Room reads require a valid read capability.');
      const page = assertSharingSecurityContract(
        await request(`/${roomId}?cursor=${cursor}`, { capability: readCapability }),
        'artifact-room-read-page-v3',
      );
      if (page.cursor !== cursor) throw new TypeError('Room page returned another cursor.');
      return page;
    },
    append(roomId, capability, body) {
      const requestBody = assertSharingSecurityContract(
        { schemaVersion: '3.0.0', operation: 'append', ...body },
        'artifact-room-append-v3',
      );
      if (requestBody.record.roomId !== roomId || !/^[A-Za-z0-9_-]{43}$/u.test(capability))
        throw new TypeError('Room append identity is invalid.');
      return request(`/${roomId}/events`, { method: 'POST', capability, body: requestBody });
    },
    manage(roomId, capability, body) {
      assertSharingSecurityContract(body, 'artifact-room-management-v3');
      if (body.roomId !== roomId || !/^[A-Za-z0-9_-]{43}$/u.test(capability))
        throw new TypeError('Room management identity is invalid.');
      return request(`/${roomId}/manage`, { method: 'POST', capability, body }).then((receipt) => {
        if (
          !receipt ||
          Object.keys(receipt).sort().join(',') !== 'commentsEnabled,deleted,generation' ||
          receipt.generation !== body.expectedGeneration + 1 ||
          receipt.commentsEnabled !== (body.operation === 'resume') ||
          receipt.deleted !== (body.operation === 'delete')
        )
          throw new TypeError('Room management receipt differs from the saved operation.');
        return receipt;
      });
    },
    stream(roomId, readCapability, { after = 0, signal } = {}) {
      if (
        !/^[A-Za-z0-9_-]{16,128}$/u.test(roomId) ||
        !Number.isSafeInteger(after) ||
        after < 0 ||
        !/^[A-Za-z0-9_-]{43}$/u.test(readCapability)
      )
        throw new TypeError('Invalid room stream cursor or capability.');
      return request(`/${roomId}/stream?cursor=${after}`, {
        capability: readCapability,
        stream: true,
        signal,
      });
    },
  };
}
export async function createSignedRoomV3Event({
  descriptor,
  event,
  sequence,
  predecessor = ROOM_V3_GENESIS_HASH,
  signer,
  key,
}) {
  assertSharingSecurityContract(descriptor, 'artifact-room-descriptor-v3');
  event = normalizeSemanticEvent(event);
  if (
    event.roomId !== descriptor.roomId ||
    (await commitment(key, descriptor.roomId, event.reviewOf, descriptor.ownerKey)) !==
      descriptor.reviewCommitment ||
    (signer.role === 'owner' &&
      canonicalizeJson(publicKey(signer)) !== canonicalizeJson(descriptor.ownerKey))
  )
    throw new TypeError('Room event identity differs.');
  const payload = encoder.encode(canonicalizeJson(event));
  const encrypted = await encryptSharingPayload(payload, {
    key,
    context: {
      version: '2.0.0',
      purpose: 'room-event',
      objectId: descriptor.roomId,
      recordId: event.eventId,
    },
    limit: 256 * 1024,
  });
  const record = {
    schemaVersion: '3.0.0',
    protocolVersion: '3.0.0',
    roomId: descriptor.roomId,
    eventId: event.eventId,
    sequence,
    predecessor,
    kind: event.kind,
    reviewCommitment: descriptor.reviewCommitment,
    authorRole: signer.role,
    authorKey: publicKey(signer),
    capability: ROOM_V3_CAPABILITIES[signer.role],
    createdAt: event.createdAt,
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
    ciphertextDigest: `sha256:${await resourceSha256(decodeResourceBytes(encrypted.ciphertext, 256 * 1024))}`,
  };
  record.signature = await signer.sign(roomV3SignatureBytes('event', record));
  return assertSharingSecurityContract(record, 'artifact-room-event-v3');
}
export async function verifySignedRoomV3Event({ descriptor, record, key }) {
  assertSharingSecurityContract(descriptor, 'artifact-room-descriptor-v3');
  assertSharingSecurityContract(record, 'artifact-room-event-v3');
  if (
    record.roomId !== descriptor.roomId ||
    record.reviewCommitment !== descriptor.reviewCommitment ||
    !(await verifyRoomV3Signature('event', record, record.authorKey)) ||
    (record.authorRole === 'owner' &&
      canonicalizeJson(record.authorKey) !== canonicalizeJson(descriptor.ownerKey)) ||
    record.ciphertextDigest !==
      `sha256:${await resourceSha256(decodeResourceBytes(record.ciphertext, 256 * 1024))}`
  )
    throw new TypeError('Room event integrity check failed.');
  const event = normalizeSemanticEvent(
    JSON.parse(
      decoder.decode(
        await decryptSharingPayload(
          { version: '2.0.0', ...record },
          {
            key,
            context: {
              version: '2.0.0',
              purpose: 'room-event',
              objectId: record.roomId,
              recordId: record.eventId,
            },
            limit: 256 * 1024,
          },
        ),
      ),
    ),
  );
  if (
    event.roomId !== record.roomId ||
    event.eventId !== record.eventId ||
    event.kind !== record.kind ||
    event.createdAt !== record.createdAt ||
    (await commitment(key, record.roomId, event.reviewOf, descriptor.ownerKey)) !==
      descriptor.reviewCommitment
  )
    throw new TypeError('Room semantic event identity differs.');
  return event;
}
export async function hydrateLiveReviewRoomV3(
  link,
  {
    client,
    allowedOrigins,
    continuation,
    maxAggregateBytes = ROOM_V3_READ_LIMITS.aggregateBytes,
  } = {},
) {
  if (
    !Number.isSafeInteger(maxAggregateBytes) ||
    maxAggregateBytes < ROOM_V3_READ_LIMITS.eventPageBytes ||
    maxAggregateBytes > ROOM_V3_READ_LIMITS.aggregateBytes
  )
    throw new RangeError('Invalid room hydration byte budget.');
  const parsed = parseLiveRoomV3Link(link, { allowedOrigins });
  client ??= createLiveRoomV3Client({ baseUrl: parsed.origin });
  if (client.baseUrl && base(client.baseUrl) !== parsed.origin)
    throw new TypeError('Room client origin differs.');
  const identity = canonicalizeJson({
    origin: parsed.origin,
    roomId: parsed.roomId,
    key: parsed.key,
    readCapability: parsed.readCapability,
  });
  const retained = continuation ? continuations.get(continuation) : undefined;
  if (continuation && (!retained || retained.identity !== identity))
    throw new TypeError(
      'Room continuation is unavailable or belongs to another read. Restart hydration.',
    );
  let sequence = retained?.cursor ?? 0,
    predecessor = retained?.predecessor ?? ROOM_V3_GENESIS_HASH;
  let page = assertSharingSecurityContract(
    await client.read(parsed.roomId, parsed.readCapability, { cursor: sequence }),
    'artifact-room-read-page-v3',
  );
  const room = retained?.room ?? page;
  if (
    !Number.isFinite(Date.parse(page.expiresAt)) ||
    Date.parse(page.expiresAt) <= Date.now() ||
    page.descriptor.roomId !== parsed.roomId ||
    page.cursor !== sequence
  )
    throw new TypeError('Room read identity is invalid or expired.');
  const snapshot = (value) =>
    canonicalizeJson({
      descriptor: value.descriptor,
      generation: value.generation,
      sequence: value.sequence,
      head: value.head,
      expiresAt: value.expiresAt,
      commentsEnabled: value.commentsEnabled,
    });
  const expectedSnapshot = retained?.snapshot ?? snapshot(room);
  if (snapshot(page) !== expectedSnapshot)
    throw new TypeError('Room changed during authenticated pagination. Restart hydration.');
  const expanded = decodeCompressedArtifactPayload(
    await decryptSharingPayload(
      { version: '2.0.0', iv: room.iv, ciphertext: room.ciphertext },
      {
        key: parsed.key,
        context: {
          version: '2.0.0',
          purpose: 'room-envelope',
          objectId: parsed.roomId,
          recordId: parsed.roomId,
        },
      },
    ),
  ).value;
  assertEnvelope(expanded);
  const reviewOf = await digestEnvelope(expanded);
  if (
    (await commitment(parsed.key, parsed.roomId, reviewOf, room.descriptor.ownerKey)) !==
    room.descriptor.reviewCommitment
  )
    throw new TypeError('Room envelope identity differs.');
  const startCursor = sequence,
    events = [];
  let consumed = new TextEncoder().encode(canonicalArtifactJson(expanded)).byteLength,
    complete = false,
    next = null;
  for (;;) {
    assertSharingSecurityContract(page, 'artifact-room-read-page-v3');
    if (snapshot(page) !== expectedSnapshot || page.cursor !== sequence)
      throw new TypeError('Room changed during authenticated pagination. Restart hydration.');
    const bytes = encoder.encode(canonicalizeJson(page)).byteLength;
    if (consumed + bytes > maxAggregateBytes) {
      if (!events.length)
        throw new RangeError(
          'The configured room hydration budget cannot hold one bounded page and envelope.',
        );
      next = Object.freeze({
        schemaVersion: '1.0.0',
        kind: 'openplanr-room-read-continuation',
        roomId: parsed.roomId,
        cursor: sequence,
      });
      continuations.set(next, {
        identity,
        cursor: sequence,
        predecessor,
        snapshot: expectedSnapshot,
        room,
      });
      break;
    }
    consumed += bytes;
    for (const record of page.events) {
      if (record.sequence !== sequence + 1 || record.predecessor !== predecessor)
        throw new TypeError('Room event chain is invalid.');
      events.push(
        await verifySignedRoomV3Event({ descriptor: room.descriptor, record, key: parsed.key }),
      );
      sequence = record.sequence;
      predecessor = `sha256:${await resourceSha256(encoder.encode(canonicalizeJson(record)))}`;
    }
    if (page.nextCursor === null) {
      if (sequence !== room.sequence || predecessor !== room.head)
        throw new TypeError('Room event chain head differs.');
      complete = true;
      break;
    }
    if (page.nextCursor !== sequence)
      throw new TypeError('Room pagination cursor did not advance.');
    page = assertSharingSecurityContract(
      await client.read(parsed.roomId, parsed.readCapability, { cursor: sequence }),
      'artifact-room-read-page-v3',
    );
  }
  const appendBasis = complete
    ? Object.freeze({
        kind: 'openplanr-room-append-basis',
        roomId: parsed.roomId,
        generation: room.generation,
        sequence,
      })
    : null;
  if (appendBasis)
    appendBases.set(appendBasis, {
      identity,
      descriptor: JSON.parse(canonicalizeJson(room.descriptor)),
      commentsEnabled: room.commentsEnabled,
      expiresAt: room.expiresAt,
      generation: room.generation,
      sequence,
      head: predecessor,
    });
  return {
    envelope: expanded,
    reviewOf,
    events,
    appendBasis,
    response: page,
    room: parsed,
    parsed,
    descriptor: room.descriptor,
    commentsEnabled: room.commentsEnabled,
    expiresAt: room.expiresAt,
    protocolVersion: '3.0.0',
    complete,
    continuation: next,
    range: { after: startCursor, through: sequence, total: room.sequence },
    consumedBytes: consumed,
    integrity: {
      generation: room.generation,
      sequence,
      head: predecessor,
      terminalSequence: room.sequence,
      terminalHead: room.head,
    },
    mutation: {
      enabled:
        complete &&
        (parsed.role === 'owner' || (parsed.role === 'reviewer' && room.commentsEnabled)),
      reason: !complete
        ? 'history-continuation-required'
        : parsed.role === 'management'
          ? 'management-only'
          : parsed.role === 'viewer'
            ? 'read-only-link'
            : !room.commentsEnabled && parsed.role === 'reviewer'
              ? 'comments-paused'
              : null,
    },
    ownerKey: room.descriptor.ownerKey,
  };
}

export async function commitLiveReviewRoomV3(prepared, options = {}) {
  const state = preparations.get(prepared);
  if (!state) throw new TypeError('Room preparation is unavailable.');
  return createLiveRoomV3Client({
    baseUrl: options.baseUrl ?? state.origin,
    fetchImpl: options.fetchImpl,
  }).create(prepared);
}
/** Prepare one immutable append request for durable storage before any mutation. */
export async function prepareLiveRoomV3Append(link, event, { client, signer, appendBasis } = {}) {
  const parsed = parseLiveRoomV3Link(link);
  client ??= createLiveRoomV3Client({ baseUrl: parsed.origin });
  let hydrated;
  if (appendBasis) {
    const retained = appendBases.get(appendBasis);
    const identity = canonicalizeJson({
      origin: parsed.origin,
      roomId: parsed.roomId,
      key: parsed.key,
      readCapability: parsed.readCapability,
    });
    if (!retained || retained.identity !== identity || Date.parse(retained.expiresAt) <= Date.now())
      throw new TypeError(
        'Completed room history basis is unavailable, expired or belongs to another read.',
      );
    if (client.baseUrl && base(client.baseUrl) !== parsed.origin)
      throw new TypeError('Room client origin differs.');
    hydrated = {
      descriptor: retained.descriptor,
      commentsEnabled: retained.commentsEnabled,
      integrity: {
        generation: retained.generation,
        sequence: retained.sequence,
        head: retained.head,
      },
    };
  } else {
    const read = await hydrateLiveReviewRoomV3(link, { client });
    if (!read.complete)
      throw Object.assign(
        new Error('Complete the authenticated room history before appending feedback.'),
        { code: 'E_ROOM_READ_CONTINUATION_REQUIRED', continuation: read.continuation },
      );
    hydrated = read;
  }
  const ownerKind = ['owner_decision', 'review_snapshot'].includes(event.kind);
  const capability = ownerKind ? parsed.owner : parsed.write;
  if (!capability || (!ownerKind && !hydrated.commentsEnabled))
    throw new TypeError('Room capability does not permit this event.');
  signer ??= ownerKind ? null : await createLiveRoomSigner({ role: 'reviewer' });
  if (!signer) throw new TypeError('Owner events require the owner signer.');
  const record = await createSignedRoomV3Event({
    descriptor: hydrated.descriptor,
    event,
    sequence: hydrated.integrity.sequence + 1,
    predecessor: hydrated.integrity.head,
    signer,
    key: parsed.key,
  });
  const body = assertSharingSecurityContract(
    {
      schemaVersion: '3.0.0',
      operation: 'append',
      expectedGeneration: hydrated.integrity.generation,
      record,
    },
    'artifact-room-append-v3',
  );
  Object.freeze(record.authorKey);
  Object.freeze(record);
  return Object.freeze(body);
}

/** Replay the exact stored append; never rotate its ciphertext, event identity or signature. */
export async function commitLiveRoomV3Append(link, body, { client } = {}) {
  body = assertSharingSecurityContract(body, 'artifact-room-append-v3');
  const parsed = parseLiveRoomV3Link(link),
    ownerKind = ['owner_decision', 'review_snapshot'].includes(body.record.kind);
  const capability = ownerKind ? parsed.owner : parsed.write;
  if (body.record.roomId !== parsed.roomId || !capability)
    throw new TypeError('Room capability does not permit this saved event.');
  client ??= createLiveRoomV3Client({ baseUrl: parsed.origin });
  if (client.baseUrl && base(client.baseUrl) !== parsed.origin)
    throw new TypeError('Room client origin differs.');
  const receipt = await client.append(parsed.roomId, capability, body);
  if (
    receipt.sequence !== body.record.sequence ||
    receipt.generation !== body.expectedGeneration + 1 ||
    receipt.head !==
      `sha256:${await resourceSha256(encoder.encode(canonicalizeJson(body.record)))}` ||
    (receipt.eventId ?? receipt.id) !== body.record.eventId
  )
    throw new TypeError('Room append receipt differs from the saved event.');
  return receipt;
}

export async function appendLiveRoomEventV3(link, event, options = {}) {
  const body = await prepareLiveRoomV3Append(link, event, options);
  return commitLiveRoomV3Append(link, body, options);
}

/** Persist this exact signed body before sending a room management mutation. */
export async function prepareLiveRoomV3Management(
  link,
  operation,
  { signer, expectedGeneration, operationId = token() } = {},
) {
  const parsed = parseLiveRoomV3Link(link);
  if (!parsed.manage || !signer || signer.role !== 'owner' || typeof signer.sign !== 'function')
    throw new TypeError(
      'Room management requires its capability and private owner signer custody.',
    );
  const unsigned = {
    schemaVersion: '3.0.0',
    roomId: parsed.roomId,
    operation,
    operationId,
    expectedGeneration,
  };
  const body = {
    ...unsigned,
    signature: await signer.sign(roomV3SignatureBytes('management', unsigned)),
  };
  assertSharingSecurityContract(body, 'artifact-room-management-v3');
  return Object.freeze(body);
}

/** Replay an already persisted signed operation without changing identity or signature. */
export async function commitLiveRoomV3Management(link, body, { client } = {}) {
  const parsed = parseLiveRoomV3Link(link);
  assertSharingSecurityContract(body, 'artifact-room-management-v3');
  if (!parsed.manage || body.roomId !== parsed.roomId)
    throw new TypeError('Room management identity is invalid.');
  client ??= createLiveRoomV3Client({ baseUrl: parsed.origin });
  if (client.baseUrl && base(client.baseUrl) !== parsed.origin)
    throw new TypeError('Room management origin is invalid.');
  return client.manage(parsed.roomId, parsed.manage, body);
}
