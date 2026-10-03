/** Authenticated staged publication over exact binary chunks, with legacy key custody. */
import { canonicalizeJson, sha256Hex } from '@openplanr/protocol/canonical-json';
import {
  assertLargeObjectContract,
  LARGE_OBJECT_LIMITS as LIMITS,
} from '@openplanr/protocol/large-object-contracts';
import {
  decodeResourceBytes,
  encodeResourceBytes,
  encryptResourcePack,
  openResourcePack,
  packResourceBundle,
  resourceSha256,
} from './resource-pack.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const preparedChunks = new WeakMap();
export async function boundedResponseBytes(response, limit) {
  const declared = response.headers?.get('content-length');
  if (
    declared !== undefined &&
    declared !== null &&
    (!/^[0-9]+$/.test(declared) || BigInt(declared) > BigInt(limit))
  ) {
    await response.body?.cancel();
    throw new RangeError('The sharing response declared size exceeds its byte limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError('The sharing service returned an empty response.');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RangeError('The sharing response exceeds its byte limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
function unsupported() {
  return Object.assign(
    new Error(
      'This sharing service does not support bounded resource uploads. Upgrade the hosted service before sharing this design; your local work is saved.',
    ),
    { code: 'E_WORKSPACE_TRANSPORT_UNSUPPORTED', status: 426 },
  );
}
export function uploadChunksFor(custody) {
  const body =
    custody.pendingCreate ??
    (custody.pendingMutation?.action === 'publish' ? custody.pendingMutation.body : null);
  return body && preparedChunks.get(body);
}
export function createChunkedWorkspaceClient({
  legacy,
  domain,
  apiPath,
  assertBundle,
  assertFeedback,
  digestInput = (value) => value,
  digestBundle,
}) {
  const api = apiPath.replace('/api/v1/', '/api/v2/');
  const idPattern = /^[A-Za-z0-9_-]{22,64}$/u;
  const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;
  function validateAccess(access) {
    legacy.normalizeWorkspaceBase(access.baseUrl);
    if (!idPattern.test(access.id)) throw new TypeError('Workspace identity is invalid.');
  }
  async function keyMaterial(token, id, purpose) {
    if (!tokenPattern.test(token) || !idPattern.test(id))
      throw new TypeError('Workspace token is invalid.');
    const imported = await crypto.subtle.importKey(
      'raw',
      decodeResourceBytes(token, 32),
      'HKDF',
      false,
      ['deriveBits'],
    );
    return new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: encoder.encode(id),
          info: encoder.encode(`${domain}/${purpose}`),
        },
        imported,
        256,
      ),
    );
  }
  async function seal(value, rawKey, context, limit = 65536) {
    const bytes = encoder.encode(canonicalizeJson(value));
    if (bytes.byteLength + 16 > limit)
      throw new RangeError('Encrypted metadata exceeds its byte limit.');
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: encoder.encode(canonicalizeJson(context)),
        tagLength: 128,
      },
      key,
      bytes,
    );
    return { iv: encodeResourceBytes(iv), ciphertext: encodeResourceBytes(new Uint8Array(cipher)) };
  }
  async function unseal(value, rawKey, context, limit = 65536) {
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    const bytes = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: decodeResourceBytes(value.iv, 12),
        additionalData: encoder.encode(canonicalizeJson(context)),
        tagLength: 128,
      },
      key,
      decodeResourceBytes(value.ciphertext, limit),
    );
    return JSON.parse(decoder.decode(bytes));
  }
  async function wrap(custody, token = custody.token, epoch = custody.epoch, keys = custody.keys) {
    return seal(
      { keys, ownerPublicKey: custody.ownerPublicKey },
      await keyMaterial(token, custody.id, 'key-wrap'),
      { type: 'keyring', workspaceId: custody.id, epoch },
    );
  }
  async function network(url, init, fetchImpl = globalThis.fetch) {
    let response;
    try {
      response = await fetchImpl(url, {
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
        ...init,
      });
    } catch (cause) {
      throw Object.assign(
        new Error(
          'Sharing was interrupted. Retry the saved operation; its identity and bytes are retained.',
        ),
        { code: 'E_WORKSPACE_NETWORK', cause },
      );
    }
    if (!response.ok) {
      const error = Object.assign(
        new Error(`Sharing failed (${response.status}). Retry the saved operation.`),
        { status: response.status, code: `E_WORKSPACE_HTTP_${response.status}` },
      );
      try {
        const value = JSON.parse(decoder.decode(await boundedResponseBytes(response, 4096)));
        if (/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(value.error ?? '')) error.code = value.error;
      } catch {}
      const seconds = Number(response.headers.get('retry-after'));
      if (response.status === 429 && Number.isFinite(seconds) && seconds > 0)
        error.retryAfterSeconds = Math.min(3600, Math.ceil(seconds));
      throw error;
    }
    return response;
  }
  async function capabilities({ baseUrl, fetchImpl } = {}) {
    const response = await network(
      `${legacy.normalizeWorkspaceBase(baseUrl)}/.well-known/openplanr-sharing`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      fetchImpl,
    );
    const value = JSON.parse(decoder.decode(await boundedResponseBytes(response, 65536)));
    if (!Array.isArray(value.workspaceTransports) || !value.workspaceTransports.includes('2'))
      throw unsupported();
    return value;
  }
  async function request(
    access,
    suffix = '',
    { method = 'GET', body, binary, limit = 128 * 1024, fetchImpl, signal } = {},
  ) {
    validateAccess(access);
    const auth =
      access.ownerAuth ?? (await legacy.deriveWorkspaceAuthentication(access.token, access.id));
    const headers = {
      Authorization: `Bearer ${auth}`,
      Accept: binary ? 'application/octet-stream' : 'application/json',
    };
    if (body !== undefined)
      headers['Content-Type'] = binary ? 'application/octet-stream' : 'application/json';
    const response = await network(
      `${legacy.normalizeWorkspaceBase(access.baseUrl)}${api}/${access.id}${suffix}`,
      {
        method,
        headers,
        body: body === undefined ? undefined : binary ? body : canonicalizeJson(body),
        ...(signal ? { signal } : {}),
      },
      fetchImpl,
    );
    if (response.status === 204) return {};
    const bytes = await boundedResponseBytes(response, limit);
    return binary ? bytes : JSON.parse(decoder.decode(bytes));
  }
  async function prepareUpload(custody, bundle) {
    assertBundle(bundle);
    const reviewOf = digestBundle
      ? digestBundle(bundle)
      : legacy.workspaceEnvelopeDigest(digestInput(bundle));
    const encrypted = await encryptResourcePack(await packResourceBundle(bundle, { reviewOf }), {
      workspaceId: custody.id,
      revisionId: legacy.newWorkspaceId(),
      epoch: custody.epoch,
      rawKey: decodeResourceBytes(custody.keys[custody.epoch], 32),
      sign: (value) => legacy.signWorkspaceValue(value, custody.ownerPrivateKey),
    });
    const body = await legacy.signWorkspaceValue(
      {
        schemaVersion: '2.0.0',
        workspaceId: custody.id,
        operationId: legacy.newWorkspaceId(),
        expectedVersion: custody.version,
        epoch: custody.epoch,
        ownerPublicKey: custody.ownerPublicKey,
        ownerAuthHash: sha256Hex(custody.ownerAuth),
        reviewerAuthHash: sha256Hex(
          await legacy.deriveWorkspaceAuthentication(custody.token, custody.id),
        ),
        keyring: custody.keyring,
        manifest: encrypted.manifest,
      },
      custody.ownerPrivateKey,
    );
    assertLargeObjectContract(body, 'encrypted-upload-prepare');
    preparedChunks.set(body, encrypted.chunks);
    return body;
  }
  async function prepareWorkspace(bundle, { baseUrl } = {}) {
    const signer = await legacy.createWorkspaceSigner();
    const custody = {
      schemaVersion: '2.0.0',
      id: legacy.newWorkspaceId(),
      baseUrl: legacy.normalizeWorkspaceBase(baseUrl),
      token: legacy.newWorkspaceToken(),
      ownerAuth: legacy.newWorkspaceToken(),
      ownerPrivateKey: signer.privateKey,
      ownerPublicKey: signer.publicKey,
      epoch: 1,
      keys: { 1: legacy.newWorkspaceToken() },
      version: 0,
    };
    custody.keyring = await wrap(custody);
    custody.pendingCreate = await prepareUpload(custody, bundle);
    return custody;
  }
  function verifyReceipt(custody, body, receipt) {
    assertLargeObjectContract(receipt, 'encrypted-upload-receipt');
    if (
      receipt.workspaceId !== custody.id ||
      receipt.operationId !== body.operationId ||
      receipt.revisionId !== body.manifest.revisionId ||
      receipt.manifestSha256 !== sha256Hex(canonicalizeJson(body.manifest)) ||
      receipt.version !== body.expectedVersion + 1
    )
      throw new TypeError('Publication receipt differs from the saved operation.');
    return receipt;
  }
  async function commitUpload(custody, body, options = {}) {
    if (!options.readChunk)
      throw new Error('Persist the exact upload spool before contacting the sharing service.');
    const readChunk = options.readChunk;
    const status = assertLargeObjectContract(
      await request(custody, `/uploads/${body.operationId}`, { ...options, method: 'PUT', body }),
      'encrypted-upload-status',
    );
    const manifestSha256 = sha256Hex(canonicalizeJson(body.manifest));
    if (
      status.workspaceId !== custody.id ||
      status.operationId !== body.operationId ||
      status.revisionId !== body.manifest.revisionId ||
      status.manifestSha256 !== manifestSha256
    )
      throw new TypeError('Upload status differs from the saved operation.');
    if (status.status === 'committed') return verifyReceipt(custody, body, status.receipt);
    const received = new Set();
    for (const part of status.receivedChunks) {
      const expected = body.manifest.chunks[part.index];
      if (!expected || expected.byteLength !== part.byteLength || expected.sha256 !== part.sha256)
        throw new TypeError('Uploaded chunk identity differs.');
      received.add(part.index);
    }
    for (const part of body.manifest.chunks) {
      if (received.has(part.index)) continue;
      const bytes = await readChunk(part.index);
      if (bytes.byteLength !== part.byteLength || (await resourceSha256(bytes)) !== part.sha256)
        throw new TypeError('Saved upload chunk is corrupt.');
      await request(custody, `/uploads/${body.operationId}/chunks/${part.index}`, {
        ...options,
        method: 'PUT',
        body: bytes,
        binary: true,
        limit: 65536,
      });
    }
    const commit = await legacy.signWorkspaceValue(
      {
        schemaVersion: '2.0.0',
        workspaceId: custody.id,
        operationId: body.operationId,
        manifestSha256,
      },
      custody.ownerPrivateKey,
    );
    return verifyReceipt(
      custody,
      body,
      await request(custody, `/uploads/${body.operationId}/commit`, {
        ...options,
        method: 'POST',
        body: commit,
      }),
    );
  }
  async function commitWorkspace(custody, options) {
    if (!custody.pendingCreate) return getWorkspace(custody, options);
    const receipt = await commitUpload(custody, custody.pendingCreate, options);
    custody.version = receipt.version;
    custody.currentRevision = receipt.revisionId;
    delete custody.pendingCreate;
    delete custody.spoolDirectory;
    return receipt;
  }
  async function getWorkspace(access, options) {
    const result = assertLargeObjectContract(
      await request(access, '', options),
      'encrypted-workspace-v2',
    );
    if (result.id !== access.id) throw new TypeError('Workspace identity differs.');
    const ring = await unseal(
      result.keyring,
      await keyMaterial(access.token, access.id, 'key-wrap'),
      { type: 'keyring', workspaceId: access.id, epoch: result.epoch },
    );
    if (
      canonicalizeJson(ring.ownerPublicKey) !== canonicalizeJson(result.ownerPublicKey) ||
      (access.ownerPublicKey &&
        canonicalizeJson(access.ownerPublicKey) !== canonicalizeJson(result.ownerPublicKey)) ||
      !ring.keys?.[result.epoch] ||
      Object.entries(ring.keys).some(
        ([epoch, key]) => !/^[1-9][0-9]*$/u.test(epoch) || !tokenPattern.test(key),
      )
    )
      throw new TypeError('Workspace key history or owner identity differs.');
    Object.assign(access, result, { keys: ring.keys });
    return result;
  }
  async function openRevision(access, revisionId = access.currentRevision, options = {}) {
    if (!access.keys) await getWorkspace(access, options);
    if (!idPattern.test(revisionId)) throw new TypeError('Revision identity is invalid.');
    const manifest = assertLargeObjectContract(
      await request(access, `/revisions/${revisionId}/manifest`, {
        ...options,
        limit: LIMITS.manifestBytes,
      }),
      'encrypted-resource-manifest',
    );
    if (
      manifest.workspaceId !== access.id ||
      manifest.revisionId !== revisionId ||
      !access.keys[manifest.epoch]
    )
      throw new TypeError('Revision identity or key epoch differs.');
    return openResourcePack(manifest, {
      rawKey: decodeResourceBytes(access.keys[manifest.epoch], 32),
      verify: (value) => legacy.verifyWorkspaceSignature(value, access.ownerPublicKey),
      fetchChunk: (index) =>
        request(access, `/revisions/${revisionId}/chunks/${index}`, {
          ...options,
          binary: true,
          limit: LIMITS.chunkBytes,
        }),
    });
  }
  async function decryptWorkspaceRevision(access, revisionId, options) {
    const pack = await openRevision(access, revisionId, options);
    try {
      const bundle = assertBundle(await pack.loadBundle());
      const reviewOf = digestBundle
        ? digestBundle(bundle)
        : legacy.workspaceEnvelopeDigest(digestInput(bundle));
      if (pack.reviewOf !== undefined && pack.reviewOf !== reviewOf)
        throw new TypeError('Full review basis differs from authenticated catalog.');
      return { ...bundle, workspaceRevision: revisionId ?? access.currentRevision, reviewOf };
    } finally {
      pack.dispose();
    }
  }
  async function prepareWorkspaceMutation(custody, action, payload) {
    if (custody.pendingCreate || custody.pendingMutation)
      throw new Error('Retry the pending sharing operation before preparing another.');
    if (action === 'publish')
      custody.pendingMutation = { action, body: await prepareUpload(custody, payload), next: {} };
    else {
      let body = {
          operationId: legacy.newWorkspaceId(),
          expectedVersion: custody.version,
          epoch: custody.epoch,
        },
        next = {};
      if (action === 'rotate') {
        const token = legacy.newWorkspaceToken(),
          epoch = custody.epoch + 1,
          keys = { ...custody.keys, [epoch]: legacy.newWorkspaceToken() };
        const keyring = await wrap(custody, token, epoch, keys);
        body = {
          ...body,
          epoch,
          reviewerAuthHash: sha256Hex(
            await legacy.deriveWorkspaceAuthentication(token, custody.id),
          ),
          keyring,
        };
        next = { token, epoch, keys, keyring };
      } else if (['pause', 'resume', 'revoke', 'delete'].includes(action)) body.action = action;
      else throw new TypeError('Unknown sharing action.');
      custody.pendingMutation = {
        action,
        body: await legacy.signWorkspaceValue(body, custody.ownerPrivateKey),
        next,
      };
    }
    return custody.pendingMutation;
  }
  async function commitWorkspaceMutation(custody, options) {
    const pending = custody.pendingMutation;
    if (!pending) throw new Error('No sharing operation is pending.');
    let result;
    if (pending.action === 'publish') result = await commitUpload(custody, pending.body, options);
    else {
      result = await request(custody, pending.action === 'rotate' ? '/rotate' : '/manage', {
        ...options,
        method: 'POST',
        body: pending.body,
      });
      if (pending.action === 'delete') {
        if (
          result.id !== custody.id ||
          result.deleted !== true ||
          result.schemaVersion !== '2.0.0' ||
          Object.keys(result).some((key) => !['id', 'deleted', 'schemaVersion'].includes(key))
        )
          throw new TypeError('Deletion receipt is invalid.');
      } else {
        assertLargeObjectContract(result, 'encrypted-workspace-v2');
        if (
          ['pause', 'resume'].includes(pending.action) &&
          result.commentsPaused !== (pending.action === 'pause')
        )
          throw new TypeError('Management state differs.');
        if (
          result.id !== custody.id ||
          result.version !== pending.body.expectedVersion + 1 ||
          result.epoch !== pending.body.epoch ||
          result.currentRevision !== custody.currentRevision ||
          canonicalizeJson(result.ownerPublicKey) !== canonicalizeJson(custody.ownerPublicKey) ||
          canonicalizeJson(result.keyring) !==
            canonicalizeJson(pending.next.keyring ?? custody.keyring)
        )
          throw new TypeError('Management receipt is invalid.');
      }
    }
    Object.assign(custody, pending.next, { version: pending.body.expectedVersion + 1 });
    if (pending.action === 'publish') {
      custody.currentRevision = result.revisionId;
      delete custody.spoolDirectory;
    }
    if (['pause', 'resume'].includes(pending.action))
      custody.commentsPaused = pending.action === 'pause';
    if (['revoke', 'delete'].includes(pending.action))
      custody.status = pending.action === 'revoke' ? 'revoked' : 'deleted';
    delete custody.pendingMutation;
    return result;
  }
  async function prepareWorkspaceEvent(
    access,
    payload,
    { revisionId = access.currentRevision, reviewOf, signer } = {},
  ) {
    assertFeedback(payload);
    if (!access.keys) throw new Error('Load the workspace before preparing feedback.');
    signer ??= await legacy.createWorkspaceSigner();
    const header = {
      id: legacy.newWorkspaceId(),
      epoch: access.epoch,
      revisionId,
      createdAt: new Date().toISOString(),
      authorPublicKey: signer.publicKey,
    };
    const context = {
      context: 'openplanr.workspace-event.v2',
      workspaceId: access.id,
      id: header.id,
      epoch: header.epoch,
      revisionId,
    };
    const event = await legacy.signWorkspaceValue(
      {
        ...header,
        ...(await seal(
          { payload, reviewOf: reviewOf ?? payload.reviewOf },
          decodeResourceBytes(access.keys[header.epoch], 32),
          context,
          LIMITS.eventBytes,
        )),
      },
      signer.privateKey,
    );
    return assertLargeObjectContract(event, 'encrypted-workspace-event-v2');
  }
  async function appendWorkspaceEvent(access, event, options) {
    assertLargeObjectContract(event, 'encrypted-workspace-event-v2');
    const result = await request(access, '/events', { ...options, method: 'POST', body: event });
    if (result.id !== event.id || !Number.isSafeInteger(result.sequence) || result.sequence < 1)
      throw new TypeError('Feedback receipt differs.');
    return result;
  }
  async function readWorkspaceEvents(access, { after = 0, ...options } = {}) {
    if (!Number.isSafeInteger(after) || after < 0) throw new TypeError('Invalid feedback cursor.');
    if (!access.keys) await getWorkspace(access, options);
    const page = await request(access, `/events?after=${after}`, {
      ...options,
      limit: LIMITS.eventPageBytes,
    });
    if (
      !Array.isArray(page.events) ||
      page.events.length > LIMITS.eventPageCount ||
      !Number.isSafeInteger(page.cursor) ||
      page.cursor < after ||
      (page.hasMore && page.cursor === after) ||
      typeof page.hasMore !== 'boolean'
    )
      throw new TypeError('Feedback page is invalid.');
    const events = [],
      issues = [];
    let previous = after;
    for (const entry of page.events) {
      try {
        const { sequence, ...event } = entry;
        if (!Number.isSafeInteger(sequence) || sequence <= previous || sequence > page.cursor)
          throw new TypeError('Feedback sequence is invalid.');
        previous = sequence;
        assertLargeObjectContract(event, 'encrypted-workspace-event-v2');
        if (
          !(await legacy.verifyWorkspaceSignature(event, event.authorPublicKey)) ||
          !access.keys[event.epoch]
        )
          throw new TypeError('Feedback signature or key epoch is invalid.');
        const value = await unseal(
          event,
          decodeResourceBytes(access.keys[event.epoch], 32),
          {
            context: 'openplanr.workspace-event.v2',
            workspaceId: access.id,
            id: event.id,
            epoch: event.epoch,
            revisionId: event.revisionId,
          },
          LIMITS.eventBytes,
        );
        assertFeedback(value.payload);
        if (value.payload.reviewOf !== undefined && value.payload.reviewOf !== value.reviewOf)
          throw new TypeError('Feedback payload identity differs.');
        if (!/^[a-f0-9]{64}$/u.test(value.reviewOf ?? ''))
          throw new TypeError('Feedback review identity is invalid.');
        events.push({
          ...event,
          publicKey: event.authorPublicKey,
          sequence,
          reviewOf: value.reviewOf,
          payload: value.payload,
        });
      } catch (error) {
        issues.push({ id: entry.id, sequence: entry.sequence, reason: error.message });
      }
    }
    return { ...page, events, issues };
  }
  return {
    capabilities,
    prepareWorkspace,
    commitWorkspace,
    getWorkspace,
    openRevision,
    decryptWorkspaceRevision,
    listWorkspaceRevisions: (access, options) => request(access, '/revisions', options),
    prepareWorkspaceMutation,
    commitWorkspaceMutation,
    prepareWorkspaceEvent,
    appendWorkspaceEvent,
    readWorkspaceEvents,
  };
}
