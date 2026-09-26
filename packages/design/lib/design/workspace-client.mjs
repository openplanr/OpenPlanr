import { canonicalizeJson, sha256Hex } from '@openplanr/protocol/canonical-json';
import {
  assertDesignReviewBundle,
  assertDesignReviewMetadata,
} from '@openplanr/protocol/review-experience-contracts';
import {
  assertWorkspaceContract,
  DESIGN_WORKSPACE_API,
  DESIGN_WORKSPACE_CREATE_SCHEMA,
  DESIGN_WORKSPACE_EVENT_SCHEMA,
  DESIGN_WORKSPACE_MAX_BYTES,
  DESIGN_WORKSPACE_MAX_EVENT_BYTES,
  DESIGN_WORKSPACE_REVISION_SCHEMA,
  DESIGN_WORKSPACE_SCHEMA,
  DESIGN_WORKSPACE_VERSION,
} from '@openplanr/protocol/workspace-contracts';

export const DESIGN_SHARE_BASE_URL = 'https://share.openplanr.dev';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const idPattern = /^[A-Za-z0-9_-]{22,64}$/;
const ec = { name: 'ECDSA', namedCurve: 'P-256' };
const signatureAlgorithm = { name: 'ECDSA', hash: 'SHA-256' };
const omitSignature = ({ signature: _signature, ...value }) => value;

export function encodeWorkspaceBytes(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
export function decodeWorkspaceBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value))
    throw new TypeError('Invalid encoded workspace value.');
  const decoded = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) =>
    char.charCodeAt(0),
  );
  if (encodeWorkspaceBytes(decoded) !== value)
    throw new TypeError('Noncanonical encoded workspace value.');
  return decoded;
}
export function newWorkspaceToken() {
  return encodeWorkspaceBytes(crypto.getRandomValues(new Uint8Array(32)));
}
export function newWorkspaceId() {
  return encodeWorkspaceBytes(crypto.getRandomValues(new Uint8Array(18)));
}
export function normalizeWorkspaceBase(baseUrl = DESIGN_SHARE_BASE_URL) {
  const url = new URL(baseUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  ) {
    throw new TypeError('Design sharing requires an HTTPS origin or a local development server.');
  }
  return url.origin;
}
export function workspaceReviewUrl(access) {
  if (!idPattern.test(access.id)) throw new TypeError('Invalid design workspace identity.');
  return `${normalizeWorkspaceBase(access.baseUrl)}/d/${access.id}`;
}

async function tokenMaterial(token, id, purpose) {
  if (!tokenPattern.test(token) || decodeWorkspaceBytes(token).length !== 32 || !idPattern.test(id))
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
        info: encoder.encode(`openplanr-design-workspace/v1/${purpose}`),
      },
      key,
      256,
    ),
  );
}
export async function deriveWorkspaceAuthentication(token, id) {
  return encodeWorkspaceBytes(await tokenMaterial(token, id, 'reviewer-auth'));
}
export function canonicalWorkspacePublicKey(value) {
  if (
    !value ||
    value.kty !== 'EC' ||
    value.crv !== 'P-256' ||
    !tokenPattern.test(value.x ?? '') ||
    !tokenPattern.test(value.y ?? '') ||
    'd' in value
  ) {
    throw new TypeError('Invalid design workspace public key.');
  }
  return { kty: 'EC', crv: 'P-256', x: value.x, y: value.y };
}
export async function createWorkspaceSigner() {
  const pair = await crypto.subtle.generateKey(ec, true, ['sign', 'verify']);
  return {
    privateKey: encodeWorkspaceBytes(
      new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    ),
    publicKey: canonicalWorkspacePublicKey(await crypto.subtle.exportKey('jwk', pair.publicKey)),
  };
}
export async function signWorkspaceValue(value, privateKey) {
  const key = await crypto.subtle.importKey('pkcs8', decodeWorkspaceBytes(privateKey), ec, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign(
    signatureAlgorithm,
    key,
    encoder.encode(canonicalizeJson(omitSignature(value))),
  );
  return { ...omitSignature(value), signature: encodeWorkspaceBytes(new Uint8Array(signature)) };
}
export async function verifyWorkspaceSignature(value, publicKey) {
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
async function seal(value, rawKey, context, limit = DESIGN_WORKSPACE_MAX_BYTES) {
  const bytes = encoder.encode(canonicalizeJson(value));
  if (bytes.length + 16 > limit)
    throw new RangeError(
      `Encrypted design data exceeds the ${Math.floor(limit / 1024)} KB upload limit.`,
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
async function unseal(value, rawKey, context, limit = DESIGN_WORKSPACE_MAX_BYTES) {
  const bytes = decodeWorkspaceBytes(value.ciphertext);
  if (bytes.length > limit) throw new RangeError('Shared design data exceeds its size limit.');
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
export function workspaceEnvelopeDigest(envelope) {
  return sha256Hex(
    canonicalizeJson({
      schemaVersion: envelope.schemaVersion,
      artifacts: envelope.artifacts,
      viewer: envelope.viewer,
    }),
  );
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
  assertDesignReviewBundle(bundle);
  const header = {
    id: newWorkspaceId(),
    epoch: custody.epoch,
    reviewOf: workspaceEnvelopeDigest(bundle.envelope),
    createdAt: new Date().toISOString(),
  };
  return signWorkspaceValue(
    {
      ...header,
      ...(await seal(
        bundle,
        decodeWorkspaceBytes(custody.keys[custody.epoch]),
        revisionContext(custody.id, header),
      )),
    },
    custody.ownerPrivateKey,
  );
}

/** Returns serializable secrets and the exact pending request. Persist privately
 * BEFORE commit; retries reuse the same id, ciphertext, signature and operation. */
export async function prepareWorkspace(bundle, { baseUrl = DESIGN_SHARE_BASE_URL } = {}) {
  const signer = await createWorkspaceSigner();
  const custody = {
    schemaVersion: DESIGN_WORKSPACE_VERSION,
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
      schemaVersion: DESIGN_WORKSPACE_VERSION,
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
  assertWorkspaceContract(custody.pendingCreate, DESIGN_WORKSPACE_CREATE_SCHEMA);
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
  if (!idPattern.test(access.id)) throw new TypeError('Invalid design workspace identity.');
  const authorization = owner
    ? access.ownerAuth
    : await deriveWorkspaceAuthentication(access.token, access.id);
  const headers = { Authorization: `Bearer ${authorization}`, Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetchImpl(
      `${normalizeWorkspaceBase(access.baseUrl)}${DESIGN_WORKSPACE_API}/${access.id}${suffix}`,
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
    throw new Error(
      'Design sharing is unreachable. Check the connection and retry; the previous review is unchanged.',
    );
  }
  if (!response.ok) {
    const messages = {
      401: 'Access token is incorrect or has been rotated.',
      403: 'This review is unavailable or this action requires its owner.',
      404: 'This shared review could not be found.',
      409: 'The shared review changed. Refresh its status before retrying.',
      410: 'This shared review has been revoked or deleted.',
      413: 'This design exceeds the sharing upload limit.',
      429: 'Too many requests. Wait a moment and retry.',
      503: 'Design sharing is temporarily unavailable. Retry shortly.',
    };
    const error = new Error(
      messages[response.status] ?? `Design sharing failed (${response.status}). Retry shortly.`,
    );
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return {};
  const limit = DESIGN_WORKSPACE_MAX_BYTES * 1.5 + 65536;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Design service returned an empty response.');
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new RangeError('Design service returned an oversized response.');
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
  return JSON.parse(decoder.decode(bytes));
}
export async function commitWorkspace(custody, options = {}) {
  if (!custody.pendingCreate) return getWorkspace(custody, options);
  const result = await request(custody, '', {
    ...options,
    method: 'PUT',
    body: custody.pendingCreate,
  });
  assertWorkspaceContract(result, DESIGN_WORKSPACE_SCHEMA);
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
export async function getWorkspace(access, options = {}) {
  const result = assertWorkspaceContract(
    await request(access, '', options),
    DESIGN_WORKSPACE_SCHEMA,
  );
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
    !ring.keys ||
    !ring.keys[result.epoch] ||
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
export async function listWorkspaceRevisions(access, { after = '', ...options } = {}) {
  if (after && !idPattern.test(after)) throw new TypeError('Invalid revision cursor.');
  return request(
    access,
    `/revisions${after ? `?after=${encodeURIComponent(after)}` : ''}`,
    options,
  );
}
export async function decryptWorkspaceRevision(
  access,
  revisionId = access.currentRevision,
  options = {},
) {
  if (!access.keys) await getWorkspace(access, options);
  if (!idPattern.test(revisionId)) throw new TypeError('Invalid design revision.');
  const revision = assertWorkspaceContract(
    await request(access, `/revisions/${revisionId}`, options),
    DESIGN_WORKSPACE_REVISION_SCHEMA,
  );
  if (
    revision.id !== revisionId ||
    !(await verifyWorkspaceSignature(revision, access.ownerPublicKey))
  )
    throw new Error('The published design signature is invalid.');
  if (!access.keys[revision.epoch]) throw new Error('The access token cannot open this revision.');
  const bundle = assertDesignReviewBundle(
    await unseal(
      revision,
      decodeWorkspaceBytes(access.keys[revision.epoch]),
      revisionContext(access.id, revision),
    ),
  );
  if (workspaceEnvelopeDigest(bundle.envelope) !== revision.reviewOf)
    throw new Error('Published design content does not match its revision.');
  return { ...bundle, workspaceRevision: revision.id, reviewOf: revision.reviewOf };
}

/** Prepare then privately save custody before sending this request. Only one
 * mutation can be pending per owner; a persisted retry must not be overwritten. */
export async function prepareWorkspaceMutation(custody, action, payload = undefined) {
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
  else throw new TypeError('Unknown design sharing operation.');
  custody.pendingMutation = {
    action,
    body: await signWorkspaceValue(body, custody.ownerPrivateKey),
    next,
  };
  return custody.pendingMutation;
}
export async function commitWorkspaceMutation(custody, options = {}) {
  const pending = custody.pendingMutation;
  if (!pending) throw new Error('No sharing operation is pending.');
  const suffix = ['publish', 'rotate'].includes(pending.action) ? pending.action : 'manage';
  const result = await request(custody, `/${suffix}`, {
    ...options,
    method: 'POST',
    body: pending.body,
  });
  if (pending.action === 'delete') {
    if (
      result.schemaVersion !== DESIGN_WORKSPACE_VERSION ||
      result.id !== custody.id ||
      result.deleted !== true ||
      Object.keys(result).some((key) => !['schemaVersion', 'id', 'deleted'].includes(key))
    )
      throw new Error('The deletion receipt is invalid. Retry the saved operation.');
  } else {
    assertWorkspaceContract(result, DESIGN_WORKSPACE_SCHEMA);
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
  Object.assign(custody, pending.next, { version: pending.body.expectedVersion + 1 });
  if (pending.action === 'publish') custody.currentRevision = pending.body.revision.id;
  if (pending.action === 'pause' || pending.action === 'resume')
    custody.commentsPaused = pending.action === 'pause';
  if (pending.action === 'revoke' || pending.action === 'delete')
    custody.status = pending.action === 'revoke' ? 'revoked' : 'deleted';
  delete custody.pendingMutation;
  return result;
}
export async function publishWorkspace(custody, bundle, options = {}) {
  await prepareWorkspaceMutation(custody, 'publish', bundle);
  return commitWorkspaceMutation(custody, options);
}
export async function rotateWorkspace(custody, options = {}) {
  await prepareWorkspaceMutation(custody, 'rotate');
  return commitWorkspaceMutation(custody, options);
}
export async function manageWorkspace(custody, action, options = {}) {
  await prepareWorkspaceMutation(custody, action);
  return commitWorkspaceMutation(custody, options);
}

/** Feedback authors are self-asserted identities, not company accounts. Each
 * writer signs their own events; owner signatures remain separate. */
export async function prepareWorkspaceEvent(
  access,
  payload,
  { revisionId = access.currentRevision, reviewOf = payload.reviewOf, signer } = {},
) {
  if (!access.keys) throw new Error('Unlock the shared review before commenting.');
  if (['category', 'disposition'].includes(payload.kind)) assertDesignReviewMetadata(payload);
  if (!['review', 'direction', 'category', 'disposition'].includes(payload.kind))
    throw new TypeError('Unknown design feedback kind.');
  if (typeof payload.author !== 'string' || !payload.author.trim() || payload.author.length > 160)
    throw new TypeError('Enter your name before leaving feedback.');
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
        DESIGN_WORKSPACE_MAX_EVENT_BYTES,
      )),
      publicKey,
    },
    identity.privateKey,
  );
  return assertWorkspaceContract(event, DESIGN_WORKSPACE_EVENT_SCHEMA);
}
export async function appendWorkspaceEvent(
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
export async function readWorkspaceEvents(access, { after = 0, ...options } = {}) {
  if (!Number.isSafeInteger(after) || after < 0) throw new TypeError('Invalid feedback cursor.');
  if (!access.keys) await getWorkspace(access, options);
  const page = await request(access, `/events?after=${after}`, options);
  if (
    !Array.isArray(page.events) ||
    page.events.length > 100 ||
    !Number.isSafeInteger(page.cursor) ||
    page.cursor < after ||
    typeof page.hasMore !== 'boolean'
  )
    throw new Error('Invalid shared feedback page.');
  const events = [];
  const issues = [];
  let previousSequence = after;
  const pageIds = new Set();
  for (const item of page.events) {
    const { sequence, ...record } = item?.event
      ? { ...item.event, sequence: item.sequence }
      : (item ?? {});
    if (!Number.isSafeInteger(sequence) || sequence <= previousSequence || sequence > page.cursor)
      throw new Error('Invalid shared feedback sequence.');
    previousSequence = sequence;
    if (typeof record.id !== 'string' || pageIds.has(record.id))
      throw new Error('Invalid shared feedback event identity.');
    pageIds.add(record.id);
    try {
      assertWorkspaceContract(record, DESIGN_WORKSPACE_EVENT_SCHEMA);
      if (!(await verifyWorkspaceSignature(record, record.publicKey)))
        throw new Error('Signature verification failed.');
      if (!access.keys[record.epoch]) throw new Error('The encryption epoch is unavailable.');
      const payload = await unseal(
        record,
        decodeWorkspaceBytes(access.keys[record.epoch]),
        eventContext(access.id, record),
        DESIGN_WORKSPACE_MAX_EVENT_BYTES,
      );
      if (['category', 'disposition'].includes(payload.kind)) assertDesignReviewMetadata(payload);
      if (
        !['review', 'direction', 'category', 'disposition'].includes(payload.kind) ||
        typeof payload.author !== 'string' ||
        !payload.author.trim() ||
        payload.author.length > 160 ||
        payload.reviewOf !== record.reviewOf
      )
        throw new Error('Feedback author, kind or revision is invalid.');
      events.push({ ...record, sequence, payload });
    } catch {
      // One authorized but malformed event must not suppress everybody else's
      // feedback. Keep a visible sequence/id quarantine record, never its body.
      issues.push({
        sequence,
        id: typeof record.id === 'string' && idPattern.test(record.id) ? record.id : null,
        reason: 'Invalid encrypted feedback; not imported.',
      });
    }
  }
  if (previousSequence > page.cursor) throw new Error('Invalid shared feedback cursor.');
  return { ...page, events, issues };
}
