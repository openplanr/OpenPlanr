import { canonicalizeJson, sha256Hex } from '@openplanr/protocol/canonical-json';
import { createWorkspaceAddress } from './internal/workspace-address.mjs';

/** Domain-specific codecs and validators sit above this encrypted capability transport. */
export function createEncryptedWorkspaceClient({
  domain,
  apiPath,
  reviewPath,
  label,
  compatibilityMessage,
  compatibilityCode = 'E_WORKSPACE_UNSUPPORTED',
  defaultBaseUrl = 'https://share.openplanr.dev',
  version = '1.0.0',
  maxBytes = 5 * 1024 * 1024,
  maxEventBytes = 256 * 1024,
  schemas,
  assertContract,
  assertBundle,
  assertFeedback,
  bundleDigest,
  digestInput = (bundle) => bundle,
  packBundle = async (bundle) => bundle,
  unpackBundle = async (bundle) => bundle,
}) {
  if (!domain || !apiPath?.startsWith('/') || !reviewPath?.startsWith('/') || !label)
    throw new TypeError('An encrypted workspace requires an explicit domain and routes.');
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
  const idPattern = /^[A-Za-z0-9_-]{22,64}$/;
  const ec = { name: 'ECDSA', namedCurve: 'P-256' };
  const signatureAlgorithm = { name: 'ECDSA', hash: 'SHA-256' };
  const omitSignature = ({ signature: _signature, ...value }) => value;
  const operationError = (message, code, status) =>
    Object.assign(new Error(message), { code, ...(status ? { status } : {}) });

  function encodeWorkspaceBytes(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
  }
  function decodeWorkspaceBytes(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value))
      throw new TypeError('Invalid encoded workspace value.');
    const decoded = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) =>
      char.charCodeAt(0),
    );
    if (encodeWorkspaceBytes(decoded) !== value)
      throw new TypeError('Noncanonical encoded workspace value.');
    return decoded;
  }
  function newWorkspaceToken() {
    return encodeWorkspaceBytes(crypto.getRandomValues(new Uint8Array(32)));
  }
  function newWorkspaceId() {
    return encodeWorkspaceBytes(crypto.getRandomValues(new Uint8Array(18)));
  }
  const { normalizeWorkspaceBase, workspaceReviewUrl } = createWorkspaceAddress({
    label,
    reviewPath,
    defaultBaseUrl,
  });

  async function tokenMaterial(token, id, purpose) {
    if (
      !tokenPattern.test(token) ||
      decodeWorkspaceBytes(token).length !== 32 ||
      !idPattern.test(id)
    )
      throw new TypeError('Enter the complete generated access token.');
    const key = await crypto.subtle.importKey('raw', decodeWorkspaceBytes(token), 'HKDF', false, [
      'deriveBits',
    ]);
    return new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: encoder.encode(id),
          info: encoder.encode(`${domain}/${purpose}`),
        },
        key,
        256,
      ),
    );
  }
  async function deriveWorkspaceAuthentication(token, id) {
    return encodeWorkspaceBytes(await tokenMaterial(token, id, 'reviewer-auth'));
  }
  function canonicalWorkspacePublicKey(value) {
    if (
      value?.kty !== 'EC' ||
      value.crv !== 'P-256' ||
      !tokenPattern.test(value.x ?? '') ||
      !tokenPattern.test(value.y ?? '') ||
      'd' in value
    ) {
      throw new TypeError(`Invalid ${label.toLowerCase()} workspace public key.`);
    }
    return { kty: 'EC', crv: 'P-256', x: value.x, y: value.y };
  }
  async function createWorkspaceSigner() {
    const pair = await crypto.subtle.generateKey(ec, true, ['sign', 'verify']);
    return {
      privateKey: encodeWorkspaceBytes(
        new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
      ),
      publicKey: canonicalWorkspacePublicKey(await crypto.subtle.exportKey('jwk', pair.publicKey)),
    };
  }
  async function signWorkspaceValue(value, privateKey) {
    const key = await crypto.subtle.importKey(
      'pkcs8',
      decodeWorkspaceBytes(privateKey),
      ec,
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign(
      signatureAlgorithm,
      key,
      encoder.encode(canonicalizeJson(omitSignature(value))),
    );
    return { ...omitSignature(value), signature: encodeWorkspaceBytes(new Uint8Array(signature)) };
  }
  async function verifyWorkspaceSignature(value, publicKey) {
    try {
      const key = await crypto.subtle.importKey('jwk', publicKey, ec, false, ['verify']);
      return await crypto.subtle.verify(
        signatureAlgorithm,
        key,
        decodeWorkspaceBytes(value.signature),
        encoder.encode(canonicalizeJson(omitSignature(value))),
      );
    } catch {
      return false;
    }
  }
  async function seal(value, rawKey, context, limit = maxBytes) {
    const bytes = encoder.encode(canonicalizeJson(value));
    if (bytes.length + 16 > limit)
      throw Object.assign(
        new RangeError(
          `Encrypted ${label.toLowerCase()} data exceeds the ${Math.floor(limit / 1024)} KB upload limit.`,
        ),
        { code: 'E_WORKSPACE_PAYLOAD_TOO_LARGE', status: 413 },
      );
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(canonicalizeJson(context)) },
      key,
      bytes,
    );
    return {
      iv: encodeWorkspaceBytes(iv),
      ciphertext: encodeWorkspaceBytes(new Uint8Array(ciphertext)),
    };
  }
  async function unseal(value, rawKey, context, limit = maxBytes) {
    const bytes = decodeWorkspaceBytes(value.ciphertext);
    if (bytes.length > limit)
      throw new RangeError(`Shared ${label.toLowerCase()} data exceeds its size limit.`);
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: decodeWorkspaceBytes(value.iv),
        additionalData: encoder.encode(canonicalizeJson(context)),
      },
      key,
      bytes,
    );
    return JSON.parse(decoder.decode(plaintext));
  }

  const keyringContext = (id, epoch) => ({ type: 'keyring', workspaceId: id, epoch });
  const revisionContext = (id, revision) => ({
    type: 'revision',
    workspaceId: id,
    id: revision.id,
    epoch: revision.epoch,
    reviewOf: revision.reviewOf,
  });
  const eventContext = (id, event) => ({
    type: 'event',
    workspaceId: id,
    id: event.id,
    epoch: event.epoch,
    revisionId: event.revisionId,
    reviewOf: event.reviewOf,
  });
  function workspaceEnvelopeDigest(value) {
    return bundleDigest(value);
  }
  async function wrapKeyring(
    custody,
    token = custody.token,
    epoch = custody.epoch,
    keys = custody.keys,
  ) {
    return seal(
      { keys, ownerPublicKey: custody.ownerPublicKey },
      await tokenMaterial(token, custody.id, 'key-wrap'),
      keyringContext(custody.id, epoch),
    );
  }
  async function prepareRevision(custody, bundle) {
    assertBundle(bundle);
    const header = {
      id: newWorkspaceId(),
      epoch: custody.epoch,
      reviewOf: workspaceEnvelopeDigest(digestInput(bundle)),
      createdAt: new Date().toISOString(),
    };
    return signWorkspaceValue(
      {
        ...header,
        ...(await seal(
          await packBundle(bundle),
          decodeWorkspaceBytes(custody.keys[custody.epoch]),
          revisionContext(custody.id, header),
        )),
      },
      custody.ownerPrivateKey,
    );
  }

  /** Returns serializable secrets and the exact pending request. Persist privately
   * BEFORE commit; retries reuse the same id, ciphertext, signature and operation. */
  async function prepareWorkspace(bundle, { baseUrl = defaultBaseUrl } = {}) {
    const signer = await createWorkspaceSigner();
    const custody = {
      schemaVersion: version,
      id: newWorkspaceId(),
      baseUrl: normalizeWorkspaceBase(baseUrl),
      token: newWorkspaceToken(),
      ownerAuth: newWorkspaceToken(),
      ownerPrivateKey: signer.privateKey,
      ownerPublicKey: signer.publicKey,
      epoch: 1,
      keys: { 1: newWorkspaceToken() },
      version: 0,
    };
    custody.keyring = await wrapKeyring(custody);
    custody.pendingCreate = await signWorkspaceValue(
      {
        schemaVersion: version,
        id: custody.id,
        ownerPublicKey: custody.ownerPublicKey,
        ownerAuthHash: sha256Hex(custody.ownerAuth),
        reviewerAuthHash: sha256Hex(await deriveWorkspaceAuthentication(custody.token, custody.id)),
        epoch: 1,
        keyring: custody.keyring,
        revision: await prepareRevision(custody, bundle),
        operationId: newWorkspaceId(),
      },
      custody.ownerPrivateKey,
    );
    assertContract(custody.pendingCreate, schemas.create);
    return custody;
  }

  async function request(
    access,
    suffix = '',
    {
      method = 'GET',
      body,
      fetchImpl = globalThis.fetch,
      owner = Boolean(access.ownerAuth),
      timeoutMs = 20_000,
    } = {},
  ) {
    if (!idPattern.test(access.id))
      throw new TypeError(`Invalid ${label.toLowerCase()} workspace identity.`);
    const authorization = owner
      ? access.ownerAuth
      : await deriveWorkspaceAuthentication(access.token, access.id);
    const headers = { Authorization: `Bearer ${authorization}`, Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetchImpl(
        `${normalizeWorkspaceBase(access.baseUrl)}${apiPath}/${access.id}${suffix}`,
        {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          redirect: 'error',
          cache: 'no-store',
          credentials: 'omit',
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
    } catch {
      throw operationError(
        `${label} sharing is unreachable. Check the connection and retry; the previous review is unchanged.`,
        'E_WORKSPACE_NETWORK',
      );
    }
    if (!response.ok) await throwResponseError(response, method);
    return readResponse(response);
  }
  async function throwResponseError(response, method) {
    if (response.status === 404 && method === 'PUT' && compatibilityMessage) {
      const error = new Error(compatibilityMessage);
      error.code = compatibilityCode;
      error.status = 404;
      throw error;
    }
    const messages = {
      401: 'Access token is incorrect or has been rotated.',
      403: 'This review is unavailable or this action requires its owner.',
      404: 'This shared review could not be found.',
      409: 'The shared review changed. Refresh its status before retrying.',
      410: 'This shared review has been revoked or deleted.',
      413: `This ${label.toLowerCase()} exceeds the sharing upload limit.`,
      429: 'Too many requests. Wait a moment and retry.',
      503: `${label} sharing is temporarily unavailable. Retry shortly.`,
    };
    const error = new Error(
      messages[response.status] ?? `${label} sharing failed (${response.status}). Retry shortly.`,
    );
    error.status = response.status;
    error.code = `E_WORKSPACE_HTTP_${response.status}`;
    try {
      const reader = response.body?.getReader();
      const body = reader && JSON.parse(decoder.decode(await responseBytes(reader, 4096)));
      if (typeof body?.error === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(body.error))
        error.code = body.error;
    } catch {
      // A malformed error body must not erase an observed HTTP failure.
    }
    if (response.status === 429) {
      const header = response.headers.get('retry-after');
      const seconds =
        header && /^\d+(?:\.\d+)?$/u.test(header.trim())
          ? Number(header)
          : header
            ? (Date.parse(header) - Date.now()) / 1000
            : NaN;
      if (Number.isFinite(seconds) && seconds >= 0)
        error.retryAfterSeconds = Math.min(3600, Math.max(1, Math.ceil(seconds)));
    }
    throw error;
  }
  async function responseBytes(reader, limit) {
    const chunks = [];
    let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > limit) {
          await reader.cancel();
          throw new RangeError(`${label} service returned an oversized response.`);
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof RangeError) throw error;
      throw new Error('The sharing response was interrupted. Retry the pending operation.');
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }
  async function readResponse(response) {
    if (response.status === 204) return {};
    const reader = response.body?.getReader();
    if (!reader) throw new Error(`${label} service returned an empty response.`);
    try {
      return JSON.parse(decoder.decode(await responseBytes(reader, maxBytes * 1.5 + 65536)));
    } catch (cause) {
      throw Object.assign(
        operationError(
          'The sharing response could not be verified. Retry the pending operation.',
          'E_WORKSPACE_RESPONSE_INVALID',
        ),
        { cause },
      );
    }
  }
  async function commitWorkspace(custody, options = {}) {
    if (!custody.pendingCreate) return getWorkspace(custody, options);
    const result = await request(custody, '', {
      ...options,
      method: 'PUT',
      body: custody.pendingCreate,
    });
    assertContract(result, schemas.workspace);
    if (
      result.id !== custody.id ||
      result.version !== 1 ||
      result.epoch !== 1 ||
      result.currentRevision !== custody.pendingCreate.revision.id ||
      canonicalizeJson(result.ownerPublicKey) !== canonicalizeJson(custody.ownerPublicKey) ||
      canonicalizeJson(result.keyring) !== canonicalizeJson(custody.keyring)
    )
      throw new Error('The sharing creation receipt is invalid. Retry the saved operation.');
    custody.version = result.version;
    custody.currentRevision = result.currentRevision;
    delete custody.pendingCreate;
    return result;
  }
  async function getWorkspace(access, options = {}) {
    const result = assertContract(await request(access, '', options), schemas.workspace);
    if (result.id !== access.id) throw new Error('Shared review identity mismatch.');
    const ring = await unseal(
      result.keyring,
      await tokenMaterial(access.token, access.id, 'key-wrap'),
      keyringContext(access.id, result.epoch),
    );
    if (
      canonicalizeJson(ring.ownerPublicKey) !== canonicalizeJson(result.ownerPublicKey) ||
      (access.ownerPublicKey &&
        canonicalizeJson(access.ownerPublicKey) !== canonicalizeJson(result.ownerPublicKey))
    )
      throw new Error('Shared review owner identity changed.');
    if (
      !ring.keys?.[result.epoch] ||
      Object.entries(ring.keys).some(
        ([keyEpoch, key]) => !/^[1-9][0-9]*$/u.test(keyEpoch) || !tokenPattern.test(key),
      )
    )
      throw new Error('Invalid shared review key history.');
    Object.assign(access, {
      keys: ring.keys,
      ownerPublicKey: result.ownerPublicKey,
      epoch: result.epoch,
      keyring: result.keyring,
      version: result.version,
      currentRevision: result.currentRevision,
      commentsPaused: result.commentsPaused,
    });
    return result;
  }
  async function listWorkspaceRevisions(access, { after = '', ...options } = {}) {
    if (after && !idPattern.test(after)) throw new TypeError('Invalid revision cursor.');
    return request(
      access,
      `/revisions${after ? `?after=${encodeURIComponent(after)}` : ''}`,
      options,
    );
  }
  async function decryptWorkspaceRevision(
    access,
    revisionId = access.currentRevision,
    options = {},
  ) {
    if (!access.keys) await getWorkspace(access, options);
    if (!idPattern.test(revisionId))
      throw new TypeError(`Invalid ${label.toLowerCase()} revision.`);
    const revision = assertContract(
      await request(access, `/revisions/${revisionId}`, options),
      schemas.revision,
    );
    if (
      revision.id !== revisionId ||
      !(await verifyWorkspaceSignature(revision, access.ownerPublicKey))
    )
      throw new Error(`The published ${label.toLowerCase()} signature is invalid.`);
    if (!access.keys[revision.epoch])
      throw new Error('The access token cannot open this revision.');
    const bundle = assertBundle(
      await unpackBundle(
        await unseal(
          revision,
          decodeWorkspaceBytes(access.keys[revision.epoch]),
          revisionContext(access.id, revision),
        ),
      ),
    );
    if (workspaceEnvelopeDigest(digestInput(bundle)) !== revision.reviewOf)
      throw new Error(`Published ${label.toLowerCase()} content does not match its revision.`);
    return { ...bundle, workspaceRevision: revision.id, reviewOf: revision.reviewOf };
  }

  /** Prepare then privately save custody before sending this request. Only one
   * mutation can be pending per owner; a persisted retry must not be overwritten. */
  async function prepareWorkspaceMutation(custody, action, payload = undefined) {
    if (custody.pendingCreate)
      throw new Error('Finish creating this shared review before changing it.');
    if (custody.pendingMutation)
      throw new Error('A sharing operation is pending. Retry it before making another change.');
    const body = {
      operationId: newWorkspaceId(),
      expectedVersion: custody.version,
      epoch: custody.epoch,
    };
    let next = {};
    if (action === 'publish') body.revision = await prepareRevision(custody, payload);
    else if (action === 'rotate') {
      const token = newWorkspaceToken();
      const epoch = custody.epoch + 1;
      const keys = { ...custody.keys, [epoch]: newWorkspaceToken() };
      const keyring = await wrapKeyring(custody, token, epoch, keys);
      Object.assign(body, {
        epoch,
        reviewerAuthHash: sha256Hex(await deriveWorkspaceAuthentication(token, custody.id)),
        keyring,
      });
      next = { token, epoch, keys, keyring };
    } else if (['pause', 'resume', 'revoke', 'delete'].includes(action)) body.action = action;
    else throw new TypeError(`Unknown ${label.toLowerCase()} sharing operation.`);
    custody.pendingMutation = {
      action,
      body: await signWorkspaceValue(body, custody.ownerPrivateKey),
      next,
    };
    return custody.pendingMutation;
  }
  function assertDeletionReceipt(custody, result) {
    if (
      result.schemaVersion !== version ||
      result.id !== custody.id ||
      result.deleted !== true ||
      Object.keys(result).some((key) => !['schemaVersion', 'id', 'deleted'].includes(key))
    )
      throw new Error('The deletion receipt is invalid. Retry the saved operation.');
  }
  function assertMutationReceipt(custody, pending, result) {
    if (pending.action === 'delete') return assertDeletionReceipt(custody, result);
    assertContract(result, schemas.workspace);
    const expectedRevision =
      pending.action === 'publish' ? pending.body.revision.id : custody.currentRevision;
    if (
      result.id !== custody.id ||
      result.version !== pending.body.expectedVersion + 1 ||
      result.epoch !== pending.body.epoch ||
      result.currentRevision !== expectedRevision ||
      canonicalizeJson(result.ownerPublicKey) !== canonicalizeJson(custody.ownerPublicKey) ||
      canonicalizeJson(result.keyring) !==
        canonicalizeJson(pending.next.keyring ?? custody.keyring) ||
      (['pause', 'resume'].includes(pending.action) &&
        result.commentsPaused !== (pending.action === 'pause'))
    )
      throw new Error('The sharing operation receipt is invalid. Retry the saved operation.');
  }
  async function commitWorkspaceMutation(custody, options = {}) {
    const pending = custody.pendingMutation;
    if (!pending) throw new Error('No sharing operation is pending.');
    const suffix = ['publish', 'rotate'].includes(pending.action) ? pending.action : 'manage';
    const result = await request(custody, `/${suffix}`, {
      ...options,
      method: 'POST',
      body: pending.body,
    });
    assertMutationReceipt(custody, pending, result);
    Object.assign(custody, pending.next, { version: pending.body.expectedVersion + 1 });
    if (pending.action === 'publish') custody.currentRevision = pending.body.revision.id;
    if (pending.action === 'pause' || pending.action === 'resume')
      custody.commentsPaused = pending.action === 'pause';
    if (pending.action === 'revoke' || pending.action === 'delete')
      custody.status = pending.action === 'revoke' ? 'revoked' : 'deleted';
    delete custody.pendingMutation;
    return result;
  }
  async function publishWorkspace(custody, bundle, options = {}) {
    await prepareWorkspaceMutation(custody, 'publish', bundle);
    return commitWorkspaceMutation(custody, options);
  }
  async function rotateWorkspace(custody, options = {}) {
    await prepareWorkspaceMutation(custody, 'rotate');
    return commitWorkspaceMutation(custody, options);
  }
  async function manageWorkspace(custody, action, options = {}) {
    await prepareWorkspaceMutation(custody, action);
    return commitWorkspaceMutation(custody, options);
  }

  /** Each feedback writer signs their own events; owner signatures remain separate. */
  async function prepareWorkspaceEvent(
    access,
    payload,
    { revisionId = access.currentRevision, reviewOf = payload.reviewOf, signer } = {},
  ) {
    if (!access.keys) throw new Error('Unlock the shared review before commenting.');
    assertFeedback(payload);
    const identity = signer ?? (await createWorkspaceSigner());
    const publicKey = canonicalWorkspacePublicKey(identity.publicKey);
    const header = { id: newWorkspaceId(), revisionId, reviewOf, epoch: access.epoch };
    const event = await signWorkspaceValue(
      {
        ...header,
        ...(await seal(
          payload,
          decodeWorkspaceBytes(access.keys[access.epoch]),
          eventContext(access.id, header),
          maxEventBytes,
        )),
        publicKey,
      },
      identity.privateKey,
    );
    return assertContract(event, schemas.event);
  }
  async function appendWorkspaceEvent(
    access,
    payload,
    { preparedEvent, signer, revisionId, reviewOf, ...options } = {},
  ) {
    const event =
      preparedEvent ??
      (await prepareWorkspaceEvent(access, payload, {
        signer,
        revisionId,
        reviewOf: reviewOf ?? payload.reviewOf,
      }));
    const result = await request(access, '/events', { ...options, method: 'POST', body: event });
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      !Number.isSafeInteger(result.sequence) ||
      result.sequence < 1 ||
      !result.event ||
      typeof result.event !== 'object' ||
      Array.isArray(result.event)
    )
      throw new Error('The feedback receipt is invalid. Retry the saved operation.');
    const { sequence: eventSequence, ...received } = result.event;
    if (
      (eventSequence !== undefined && eventSequence !== result.sequence) ||
      canonicalizeJson(received) !== canonicalizeJson(event)
    )
      throw new Error(
        'The feedback receipt does not match the saved event. Retry the saved operation.',
      );
    return { event: { ...received, sequence: result.sequence }, sequence: result.sequence };
  }
  function assertEventPage(page, after) {
    if (
      !Array.isArray(page.events) ||
      page.events.length > 100 ||
      !Number.isSafeInteger(page.cursor) ||
      page.cursor < after ||
      typeof page.hasMore !== 'boolean'
    )
      throw new Error('Invalid shared feedback page.');
  }
  async function decryptEvent(access, record, sequence) {
    assertContract(record, schemas.event);
    if (!(await verifyWorkspaceSignature(record, record.publicKey)))
      throw new Error('Signature verification failed.');
    if (!access.keys[record.epoch]) throw new Error('The encryption epoch is unavailable.');
    const payload = await unseal(
      record,
      decodeWorkspaceBytes(access.keys[record.epoch]),
      eventContext(access.id, record),
      maxEventBytes,
    );
    assertFeedback(payload);
    if (payload.reviewOf !== record.reviewOf) throw new Error('Feedback revision is invalid.');
    return { ...record, sequence, payload };
  }
  function eventFromPage(item, pageIds, previousSequence, cursor) {
    const { sequence, ...record } = item?.event
      ? { ...item.event, sequence: item.sequence }
      : (item ?? {});
    if (!Number.isSafeInteger(sequence) || sequence <= previousSequence || sequence > cursor)
      throw new Error('Invalid shared feedback sequence.');
    if (typeof record.id !== 'string' || pageIds.has(record.id))
      throw new Error('Invalid shared feedback event identity.');
    pageIds.add(record.id);
    return { sequence, record };
  }
  async function readWorkspaceEvents(access, { after = 0, ...options } = {}) {
    if (!Number.isSafeInteger(after) || after < 0) throw new TypeError('Invalid feedback cursor.');
    if (!access.keys) await getWorkspace(access, options);
    const page = await request(access, `/events?after=${after}`, options);
    assertEventPage(page, after);
    const events = [],
      issues = [],
      pageIds = new Set();
    let previousSequence = after;
    for (const item of page.events) {
      const { sequence, record } = eventFromPage(item, pageIds, previousSequence, page.cursor);
      previousSequence = sequence;
      try {
        events.push(await decryptEvent(access, record, sequence));
      } catch {
        // Quarantine one malformed event without suppressing valid feedback or disclosing its body.
        issues.push({
          sequence,
          id: typeof record.id === 'string' && idPattern.test(record.id) ? record.id : null,
          reason: 'Invalid encrypted feedback; not imported.',
        });
      }
    }
    return { ...page, events, issues };
  }

  return {
    encodeWorkspaceBytes,
    decodeWorkspaceBytes,
    newWorkspaceToken,
    newWorkspaceId,
    normalizeWorkspaceBase,
    workspaceReviewUrl,
    deriveWorkspaceAuthentication,
    canonicalWorkspacePublicKey,
    createWorkspaceSigner,
    signWorkspaceValue,
    verifyWorkspaceSignature,
    workspaceEnvelopeDigest,
    prepareWorkspace,
    commitWorkspace,
    getWorkspace,
    listWorkspaceRevisions,
    decryptWorkspaceRevision,
    prepareWorkspaceMutation,
    commitWorkspaceMutation,
    publishWorkspace,
    rotateWorkspace,
    manageWorkspace,
    prepareWorkspaceEvent,
    appendWorkspaceEvent,
    readWorkspaceEvents,
  };
}
