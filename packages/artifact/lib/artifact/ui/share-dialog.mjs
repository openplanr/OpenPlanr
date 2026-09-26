export const ARTIFACT_SHARE_FRAGMENT_LIMIT = 8_000;

export const ARTIFACT_SHARE_TTLS = Object.freeze({
  '1d': Object.freeze({ label: '1 day', milliseconds: 86_400_000 }),
  '7d': Object.freeze({ label: '7 days', milliseconds: 604_800_000 }),
  '30d': Object.freeze({ label: '30 days', milliseconds: 2_592_000_000 }),
});

export const ARTIFACT_SHARE_TRANSPORTS = Object.freeze(['live', 'fragment', 'short']);

const PHASES = Object.freeze([
  'idle',
  'previewing',
  'ready',
  'custody-preparing',
  'custody-ready',
  'creating',
  'ambiguous',
  'created',
  'error',
]);
const LIVE_ROOM_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
const LIVE_ROOM_SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
const LIVE_ROOM_KEY_ID_RE = /^sha256:[a-f0-9]{64}$/;
const LIVE_ROOM_REVIEW_RE = /^[a-f0-9]{64}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const OWNER_SECRET_MAX_BYTES = 64 * 1024;

export class ArtifactShareUiError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ArtifactShareUiError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function member(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function count(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_PREVIEW_INVALID',
      `${name} must be a non-negative integer.`,
      { field: name },
    );
  }
  return value;
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return (
    record(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function exactLoopback(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

function parseLiveResultUrl(value, capability) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_RESULT_INVALID',
      'Live room creation returned a malformed capability URL.',
    );
  }
  const fields = new URLSearchParams(url.hash.slice(1));
  const keys = [...fields.keys()];
  const roomId = /^\/r\/([A-Za-z0-9_-]{16,128})\/?$/.exec(url.pathname)?.[1];
  if (
    url.username ||
    url.password ||
    url.search ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && exactLoopback(url.hostname))) ||
    !roomId ||
    !LIVE_ROOM_ID_RE.test(roomId) ||
    keys.length !== 2 ||
    !keys.includes('k') ||
    !keys.includes(capability) ||
    keys.some((key) => !['k', capability].includes(key) || fields.getAll(key).length !== 1) ||
    !LIVE_ROOM_SECRET_RE.test(fields.get('k') ?? '') ||
    !LIVE_ROOM_SECRET_RE.test(fields.get(capability) ?? '')
  ) {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_RESULT_INVALID',
      'Live room creation returned an invalid or mixed capability URL.',
    );
  }
  return Object.freeze({
    origin: url.origin,
    pathname: url.pathname.replace(/\/$/, ''),
    key: fields.get('k'),
    capability: fields.get(capability),
  });
}

function validateLiveResultUrls({ url, ownerUrl, manageUrl }) {
  const reviewer = parseLiveResultUrl(url, 'w');
  const owner = parseLiveResultUrl(ownerUrl, 'o');
  const management = parseLiveResultUrl(manageUrl, 'm');
  if (
    reviewer.origin !== owner.origin ||
    reviewer.origin !== management.origin ||
    reviewer.pathname !== owner.pathname ||
    reviewer.pathname !== management.pathname ||
    reviewer.key !== owner.key ||
    reviewer.key !== management.key ||
    new Set([reviewer.capability, owner.capability, management.capability]).size !== 3
  ) {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_RESULT_INVALID',
      'Live room creation must return separate reviewer, owner-verdict, and management capabilities for one room.',
    );
  }
}

function normalizeOwnerCustody(value) {
  if (record(value?.prepared) && record(value?.recovery)) {
    const { prepared, recovery } = value;
    if (
      !exactKeys(prepared, [
        'schemaVersion',
        'kind',
        'protocolVersion',
        'id',
        'roomId',
        'reviewOf',
        'ttl',
        'ownerKey',
      ]) ||
      prepared.schemaVersion !== '1.0.0' ||
      prepared.kind !== 'openplanr-live-room-preparation' ||
      prepared.protocolVersion !== '2.0.0' ||
      prepared.id !== prepared.roomId ||
      !LIVE_ROOM_ID_RE.test(prepared.roomId ?? '') ||
      !LIVE_ROOM_REVIEW_RE.test(prepared.reviewOf ?? '') ||
      !Object.hasOwn(ARTIFACT_SHARE_TTLS, prepared.ttl) ||
      !record(prepared.ownerKey) ||
      !exactKeys(prepared.ownerKey, ['algorithm', 'encoding', 'keyId', 'value']) ||
      !record(prepared.ownerSigner) ||
      !exactKeys(recovery, [
        'schemaVersion',
        'kind',
        'protocolVersion',
        'id',
        'roomId',
        'reviewOf',
        'ttl',
        'ownerKey',
        'url',
        'ownerUrl',
        'manageUrl',
        'ownerSigner',
      ]) ||
      recovery.schemaVersion !== '1.0.0' ||
      recovery.kind !== 'openplanr-live-room-recovery' ||
      recovery.protocolVersion !== '2.0.0' ||
      recovery.id !== prepared.id ||
      recovery.roomId !== prepared.roomId ||
      recovery.reviewOf !== prepared.reviewOf ||
      recovery.ttl !== prepared.ttl ||
      JSON.stringify(recovery.ownerKey) !== JSON.stringify(prepared.ownerKey) ||
      recovery.url !== prepared.url ||
      recovery.ownerUrl !== prepared.ownerUrl ||
      recovery.manageUrl !== prepared.manageUrl
    ) {
      throw new ArtifactShareUiError(
        'E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID',
        'Live room recovery custody does not match its prepared creation.',
      );
    }
    validateLiveResultUrls(recovery);
    const signerCustody = normalizeOwnerCustody({
      signer: prepared.ownerSigner,
      secret: recovery.ownerSigner,
    });
    if (
      prepared.ownerKey.algorithm !== signerCustody.signer.algorithm ||
      prepared.ownerKey.encoding !== signerCustody.signer.encoding ||
      prepared.ownerKey.keyId !== signerCustody.signer.keyId ||
      prepared.ownerKey.value !== (signerCustody.signer.value ?? signerCustody.signer.publicKey)
    ) {
      throw new ArtifactShareUiError(
        'E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID',
        'Live room recovery owner key does not match its prepared signer.',
      );
    }
    const serialized = `${JSON.stringify(recovery, null, 2)}\n`;
    const byteLength = new TextEncoder().encode(serialized).byteLength;
    if (byteLength < 2 || byteLength > OWNER_SECRET_MAX_BYTES) {
      throw new ArtifactShareUiError(
        'E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID',
        'Live room recovery bundle exceeds its bounded export size.',
      );
    }
    return Object.freeze({
      credential: prepared,
      signer: signerCustody.signer,
      serialized,
      filename: `openplanr-live-room-recovery-${prepared.roomId.slice(0, 12)}.json`,
    });
  }
  if (!record(value) || !record(value.signer) || !record(value.secret)) {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID',
      'Live room owner custody could not be prepared safely.',
    );
  }
  const { signer, secret } = value;
  if (
    signer.role !== 'owner' ||
    typeof signer.sign !== 'function' ||
    signer.algorithm !== 'ECDSA-P256-SHA256' ||
    signer.encoding !== 'spki-base64url' ||
    !LIVE_ROOM_KEY_ID_RE.test(signer.keyId ?? '') ||
    !BASE64URL_RE.test(signer.value ?? signer.publicKey ?? '') ||
    (signer.value ?? signer.publicKey).length < 64 ||
    (signer.value ?? signer.publicKey).length > 512
  ) {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID',
      'Live room owner signer is invalid.',
    );
  }
  if (
    !exactKeys(secret, [
      'schemaVersion',
      'kind',
      'role',
      'algorithm',
      'keyId',
      'publicKey',
      'privateKey',
    ]) ||
    secret.schemaVersion !== '1.0.0' ||
    secret.kind !== 'openplanr-live-room-signer' ||
    secret.role !== 'owner' ||
    secret.algorithm !== 'ECDSA-P256-SHA256' ||
    secret.keyId !== signer.keyId ||
    secret.publicKey !== (signer.value ?? signer.publicKey) ||
    !BASE64URL_RE.test(secret.publicKey ?? '') ||
    !BASE64URL_RE.test(secret.privateKey ?? '') ||
    secret.publicKey.length < 64 ||
    secret.publicKey.length > 512 ||
    secret.privateKey.length < 64 ||
    secret.privateKey.length > 1_024
  ) {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID',
      'Live room owner secret does not match its signer.',
    );
  }
  const serialized = `${JSON.stringify(secret, null, 2)}\n`;
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength < 2 || byteLength > OWNER_SECRET_MAX_BYTES) {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID',
      'Live room owner secret exceeds its bounded export size.',
    );
  }
  return Object.freeze({
    credential: signer,
    signer,
    serialized,
    filename: `openplanr-live-room-owner-${signer.keyId.slice(7, 19)}.json`,
  });
}

function defaultSaveOwnerCustody(document, window, { filename, serialized }) {
  if (
    typeof window?.Blob !== 'function' ||
    typeof window?.URL?.createObjectURL !== 'function' ||
    typeof window?.URL?.revokeObjectURL !== 'function' ||
    typeof document?.createElement !== 'function' ||
    !document.body
  ) {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_OWNER_CUSTODY_UNAVAILABLE',
      'This browser cannot save the private owner key. No room was created.',
    );
  }
  const blobUrl = window.URL.createObjectURL(
    new window.Blob([serialized], { type: 'application/json;charset=utf-8' }),
  );
  try {
    const anchor = document.createElement('a');
    anchor.hidden = true;
    anchor.href = blobUrl;
    anchor.download = filename;
    anchor.rel = 'noreferrer';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } catch (error) {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_OWNER_CUSTODY_UNAVAILABLE',
      'The private owner key could not be handed to the browser download manager. No room was created.',
      { cause: error?.name },
    );
  } finally {
    window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 0);
  }
  return true;
}

export async function establishArtifactOwnerCustody({
  prepareOwnerCustody,
  saveOwnerCustody,
} = {}) {
  if (typeof prepareOwnerCustody !== 'function' || typeof saveOwnerCustody !== 'function') {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_OWNER_CUSTODY_REQUIRED',
      'Live room creation requires explicit private owner-key custody. No room was created.',
    );
  }
  const custody = normalizeOwnerCustody(await prepareOwnerCustody());
  const saved = await saveOwnerCustody(
    Object.freeze({
      filename: custody.filename,
      serialized: custody.serialized,
    }),
  );
  if (saved !== true && saved?.saved !== true) {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_OWNER_CUSTODY_UNAVAILABLE',
      'Private owner-key custody was not confirmed. No room was created.',
    );
  }
  return custody.credential;
}

function frozenResult(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.url !== 'string' ||
    value.url.length === 0
  ) {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_RESULT_INVALID',
      'Share creation must return a non-empty review URL.',
    );
  }
  if (!ARTIFACT_SHARE_TRANSPORTS.includes(value.transport)) {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_RESULT_INVALID',
      'Share creation must return a known transport.',
      { field: 'transport' },
    );
  }
  const deletionToken = text(value.deletionToken);
  const ownerUrl = text(value.ownerUrl);
  const manageUrl = text(value.manageUrl);
  if (deletionToken && value.url.includes(deletionToken)) {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_DELETION_TOKEN_LEAK',
      'The deletion token must never be included in the review URL.',
    );
  }
  if (value.transport === 'live') {
    validateLiveResultUrls({ url: value.url, ownerUrl, manageUrl });
  } else if (ownerUrl || manageUrl) {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_RESULT_INVALID',
      'Snapshot creation cannot return live room capabilities.',
    );
  }
  return Object.freeze({
    transport: value.transport,
    url: value.url,
    ownerUrl,
    manageUrl,
    deletionToken,
    expiresAt: text(value.expiresAt),
  });
}

export function normalizeArtifactSharePreview(value = {}) {
  const preview = value && typeof value === 'object' ? value : {};
  const fragmentLength = count(preview.fragmentLength, 'fragmentLength');
  return Object.freeze({
    fragmentLength,
    compressedBytes: count(preview.compressedBytes, 'compressedBytes'),
    ciphertextBytes: count(preview.ciphertextBytes, 'ciphertextBytes'),
    fragmentEligible: fragmentLength <= ARTIFACT_SHARE_FRAGMENT_LIMIT,
  });
}

function freezeState(value) {
  return Object.freeze({
    open: Boolean(value.open),
    phase: member(value.phase, PHASES, 'idle'),
    transport: member(value.transport, ARTIFACT_SHARE_TRANSPORTS, 'live'),
    ttl: Object.hasOwn(ARTIFACT_SHARE_TTLS, value.ttl) ? value.ttl : '7d',
    preview: value.preview ? normalizeArtifactSharePreview(value.preview) : null,
    ownerCustodyEstablished: Boolean(value.ownerCustodyEstablished),
    result: value.result ? frozenResult(value.result) : null,
    error: text(value.error),
  });
}

export function createArtifactShareDialogState({ preview, ttl = '7d' } = {}) {
  const normalizedPreview = preview ? normalizeArtifactSharePreview(preview) : null;
  return freezeState({
    open: false,
    phase: normalizedPreview ? 'ready' : 'idle',
    transport: 'live',
    ttl,
    preview: normalizedPreview,
    ownerCustodyEstablished: false,
    result: null,
    error: '',
  });
}

export function reduceArtifactShareDialog(state, action = {}) {
  const current = state ?? createArtifactShareDialogState();
  if (current.phase === 'created' && action.type !== 'close') return current;
  if (
    current.phase === 'ambiguous' &&
    !['create-start', 'create-success', 'failure'].includes(action.type)
  )
    return current;
  if (current.phase === 'custody-ready' && ['select-transport', 'set-ttl'].includes(action.type))
    return current;
  switch (action.type) {
    case 'open':
      return freezeState({
        ...current,
        open: true,
        ownerCustodyEstablished: false,
        result: null,
        error: '',
      });
    case 'close':
      return freezeState({
        ...current,
        open: false,
        phase: current.preview ? 'ready' : 'idle',
        ownerCustodyEstablished: false,
        error: '',
      });
    case 'preview-start':
      return freezeState({
        ...current,
        open: true,
        phase: 'previewing',
        preview: null,
        ownerCustodyEstablished: false,
        result: null,
        error: '',
      });
    case 'preview-ready': {
      const preview = normalizeArtifactSharePreview(action.preview);
      return freezeState({
        ...current,
        phase: 'ready',
        preview,
        ownerCustodyEstablished: false,
        transport:
          current.transport === 'fragment' && !preview.fragmentEligible
            ? 'short'
            : current.transport,
        result: null,
        error: '',
      });
    }
    case 'select-transport': {
      const transport = member(action.transport, ARTIFACT_SHARE_TRANSPORTS, current.transport);
      if (transport === 'fragment' && current.preview?.fragmentEligible === false) return current;
      return transport === current.transport
        ? current
        : freezeState({
            ...current,
            phase: current.preview ? 'ready' : 'idle',
            transport,
            ownerCustodyEstablished: false,
            result: null,
            error: '',
          });
    }
    case 'set-ttl': {
      const ttl = Object.hasOwn(ARTIFACT_SHARE_TTLS, action.ttl) ? action.ttl : current.ttl;
      return ttl === current.ttl
        ? current
        : freezeState({ ...current, ttl, result: null, error: '' });
    }
    case 'custody-start':
      return freezeState({
        ...current,
        phase: 'custody-preparing',
        ownerCustodyEstablished: false,
        result: null,
        error: '',
      });
    case 'custody-ready':
      return freezeState({
        ...current,
        phase: 'custody-ready',
        ownerCustodyEstablished: true,
        result: null,
        error: '',
      });
    case 'create-start':
      return freezeState({ ...current, phase: 'creating', result: null, error: '' });
    case 'create-success':
      return freezeState({ ...current, phase: 'created', result: action.result, error: '' });
    case 'failure':
      return freezeState({
        ...current,
        phase: action.ambiguous ? 'ambiguous' : 'error',
        ownerCustodyEstablished: Boolean(action.ownerCustodyEstablished),
        result: null,
        error: text(action.error, 'Share creation failed.'),
      });
    default:
      return current;
  }
}

export function artifactShareExpiry(ttl, now = new Date()) {
  const choice = ARTIFACT_SHARE_TTLS[ttl] ?? ARTIFACT_SHARE_TTLS['7d'];
  const base = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(base)) throw new TypeError('Share expiry requires a valid date.');
  return new Date(base + choice.milliseconds).toISOString();
}

export function formatArtifactShareBytes(value) {
  const bytes = count(value, 'bytes');
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes >= 10_000 ? 0 : 1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function focusableElements(dialog) {
  return [
    ...dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => !element.hidden && !element.closest('[hidden]'));
}

function defaultCopy(window, value) {
  if (typeof window?.navigator?.clipboard?.writeText !== 'function') {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_CLIPBOARD_UNAVAILABLE',
      'Clipboard access is unavailable. Copy the value manually.',
    );
  }
  return window.navigator.clipboard.writeText(value);
}

function reviewForShare(stageController) {
  return stageController?.review?.getReview?.() ?? null;
}

/** A host can narrow its supported transports, but cannot enable missing handlers. */
export function artifactShareCapabilities({
  prepareShare,
  prepareOwnerCustody,
  createShare,
  supportedTransports,
} = {}) {
  const canCreate = typeof prepareShare === 'function' && typeof createShare === 'function';
  return Object.freeze(
    ARTIFACT_SHARE_TRANSPORTS.filter(
      (transport) =>
        canCreate &&
        (transport !== 'live' || typeof prepareOwnerCustody === 'function') &&
        (supportedTransports === undefined ||
          (Array.isArray(supportedTransports) && supportedTransports.includes(transport))),
    ),
  );
}

export function mountArtifactShareDialog({
  document = globalThis.document,
  window = document?.defaultView,
  root = document?.querySelector?.('.planr-shell'),
  stageController,
  prepareShare,
  prepareOwnerCustody,
  saveOwnerCustody,
  createShare,
  supportedTransports,
  unavailableReason,
  copyText,
  existingRoom = false,
  existingShareUrl = null,
  now = () => new Date(),
} = {}) {
  if (!document || !window || !root) return null;
  const backdrop = document.querySelector('[data-planr-share-dialog]');
  const dialog = backdrop?.querySelector('[role="dialog"]');
  const trigger = root.querySelector('[data-planr-action="share"]');
  if (!backdrop || !dialog || !trigger) return null;

  let state = createArtifactShareDialogState();
  const capabilities = artifactShareCapabilities({
    prepareShare,
    prepareOwnerCustody,
    createShare,
    supportedTransports,
  });
  const unavailable =
    text(unavailableReason) ||
    'Sharing is not configured in this viewer. Open the review with an updated OpenPlanr installation that supports sharing.';
  let returnFocus = null;
  let generation = 0;
  let pendingOwnerCustody = null;
  const copyResetTimers = new Map();
  const cleanup = [];
  const handlers = {
    prepareShare: typeof prepareShare === 'function' ? prepareShare : null,
    prepareOwnerCustody: typeof prepareOwnerCustody === 'function' ? prepareOwnerCustody : null,
    saveOwnerCustody:
      typeof saveOwnerCustody === 'function'
        ? saveOwnerCustody
        : (value) => defaultSaveOwnerCustody(document, window, value),
    createShare: typeof createShare === 'function' ? createShare : null,
    copyText: typeof copyText === 'function' ? copyText : (value) => defaultCopy(window, value),
  };
  const stableShareUrl =
    typeof existingShareUrl === 'function' ? existingShareUrl : () => existingShareUrl;

  function supports(transport) {
    return (
      capabilities.includes(transport) &&
      (transport !== 'fragment' || state.preview?.fragmentEligible !== false)
    );
  }

  function selectSupportedTransport() {
    if (!supports(state.transport)) {
      const transport = capabilities.find(supports);
      if (transport)
        state = reduceArtifactShareDialog(state, { type: 'select-transport', transport });
    }
  }

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    cleanup.push(() => target.removeEventListener(type, handler, options));
  }

  function announce(message) {
    const live = dialog.querySelector('[data-planr-share-status]');
    if (live) live.textContent = message;
  }

  function resetCopyButton(button) {
    const timer = copyResetTimers.get(button);
    if (timer) window.clearTimeout(timer);
    copyResetTimers.delete(button);
    button.removeAttribute('data-planr-copy-state');
    const label = button.querySelector?.('.planr-action-label');
    if (label) label.textContent = button.dataset.planrCopyLabel ?? label.textContent;
    else button.textContent = button.dataset.planrCopyLabel ?? button.textContent;
  }

  function showCopyState(button, stateValue) {
    if (!button) return;
    const label = button.querySelector?.('.planr-action-label');
    if (!button.dataset.planrCopyLabel) {
      button.dataset.planrCopyLabel = (label?.textContent ?? button.textContent).trim();
    }
    const prior = copyResetTimers.get(button);
    if (prior) window.clearTimeout(prior);
    button.dataset.planrCopyState = stateValue;
    if (label) label.textContent = stateValue === 'copied' ? 'Copied' : 'Try again';
    else button.textContent = stateValue === 'copied' ? 'Copied' : 'Try again';
    copyResetTimers.set(
      button,
      window.setTimeout(() => resetCopyButton(button), 1_800),
    );
  }

  function resetCopyButtons() {
    for (const button of dialog.querySelectorAll('[data-planr-copy-state]'))
      resetCopyButton(button);
  }

  function clearPendingOwnerSigner() {
    pendingOwnerCustody = null;
  }

  function pendingOwnerSigner() {
    return pendingOwnerCustody?.ownerSigner ?? pendingOwnerCustody;
  }

  async function copyExistingRoom() {
    const value = stableShareUrl();
    if (!value) return;
    try {
      await handlers.copyText(value);
      showCopyState(trigger, 'copied');
      announce('Live review URL copied. This remains the same collaboration room.');
    } catch (error) {
      showCopyState(trigger, 'error');
      announce(error?.message ?? 'Review URL could not be copied.');
    }
  }

  function render() {
    const preview = state.preview;
    backdrop.hidden = !state.open;
    backdrop.style.pointerEvents = state.open ? 'auto' : '';
    root.toggleAttribute('inert', state.open);
    root.setAttribute('aria-hidden', String(state.open));
    if (!state.open) root.removeAttribute('aria-hidden');
    dialog.dataset.planrSharePhase = state.phase;
    dialog.dataset.planrShareSelected = state.transport;

    for (const button of dialog.querySelectorAll('[data-planr-share-transport]')) {
      const transport = button.dataset.planrShareTransport;
      const selected = transport === state.transport;
      button.hidden = state.phase === 'created';
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
      button.disabled =
        [
          'previewing',
          'custody-preparing',
          'custody-ready',
          'creating',
          'ambiguous',
          'created',
        ].includes(state.phase) || !supports(transport);
      button.setAttribute('aria-disabled', String(button.disabled));
      button.title = capabilities.includes(transport)
        ? ''
        : transport === 'live' && capabilities.length
          ? 'Live review requires this host to provide private owner-key custody. Choose an available snapshot option.'
          : unavailable;
      if (transport === 'live')
        button.querySelector('.planr-share-receipt-size').textContent = capabilities.includes(
          'live',
        )
          ? 'Default'
          : 'Unavailable';
    }

    const fragmentSize = dialog.querySelector('[data-planr-share-fragment-size]');
    if (fragmentSize)
      fragmentSize.textContent = !capabilities.includes('fragment')
        ? 'Unavailable'
        : preview
          ? `${preview.fragmentLength.toLocaleString('en-US')} chars · ${formatArtifactShareBytes(preview.compressedBytes)}`
          : state.phase === 'previewing'
            ? 'Calculating…'
            : 'Size unavailable';
    const shortSize = dialog.querySelector('[data-planr-share-short-size]');
    if (shortSize)
      shortSize.textContent = !capabilities.includes('short')
        ? 'Unavailable'
        : preview
          ? formatArtifactShareBytes(preview.ciphertextBytes)
          : state.phase === 'previewing'
            ? 'Calculating…'
            : 'Size unavailable';
    const threshold = dialog.querySelector('[data-planr-share-threshold]');
    if (threshold) {
      threshold.hidden = !capabilities.includes('fragment');
      threshold.textContent =
        preview?.fragmentEligible === false
          ? `Private fragment snapshot unavailable (${preview.fragmentLength.toLocaleString('en-US')} characters; 8,000 limit). Choose an available sharing option.`
          : preview
            ? 'Private fragment snapshot available for links up to 8,000 characters.'
            : 'Preparing the snapshot size before sharing.';
    }

    const ttlRow = dialog.querySelector('[data-planr-share-ttl-row]');
    if (ttlRow)
      ttlRow.hidden =
        state.phase === 'created' ||
        !supports(state.transport) ||
        !['live', 'short'].includes(state.transport);
    const ttlSelect = dialog.querySelector('[data-planr-share-ttl]');
    if (ttlSelect) {
      ttlSelect.value = state.ttl;
      ttlSelect.disabled = [
        'custody-preparing',
        'custody-ready',
        'creating',
        'ambiguous',
        'created',
      ].includes(state.phase);
    }
    const expiry = artifactShareExpiry(state.ttl, now());
    const expiryNode = dialog.querySelector('[data-planr-share-expiry]');
    if (expiryNode) {
      expiryNode.dateTime = expiry;
      expiryNode.textContent = new Intl.DateTimeFormat('en', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(expiry));
    }

    const primary = dialog.querySelector('[data-planr-share-confirm]');
    if (primary) {
      primary.hidden = state.phase === 'created';
      primary.disabled =
        !supports(state.transport) ||
        (!preview && state.phase !== 'error') ||
        state.phase === 'previewing' ||
        state.phase === 'custody-preparing' ||
        state.phase === 'creating' ||
        state.phase === 'created';
      primary.textContent = !supports(state.transport)
        ? 'Sharing unavailable'
        : state.phase === 'error' && !preview
          ? 'Retry preparation'
          : state.phase === 'custody-preparing'
            ? 'Preparing owner key…'
            : state.phase === 'creating'
              ? 'Creating…'
              : state.phase === 'ambiguous'
                ? 'Retry exact room creation'
                : state.transport === 'live'
                  ? state.ownerCustodyEstablished
                    ? state.phase === 'error'
                      ? 'Retry live review room'
                      : 'I saved it — create live room'
                    : 'Download recovery bundle'
                  : state.transport === 'short'
                    ? 'Create encrypted link'
                    : 'Copy private link';
    }
    for (const closeControl of dialog.querySelectorAll(
      '[data-planr-share-close], [data-planr-share-cancel]',
    )) {
      const closeBlocked = state.phase === 'creating' || state.phase === 'ambiguous';
      closeControl.disabled = closeBlocked;
      closeControl.setAttribute('aria-disabled', String(closeBlocked));
    }
    const custody = dialog.querySelector('[data-planr-share-owner-custody]');
    if (custody)
      custody.hidden = state.transport !== 'live' || !supports('live') || state.phase === 'created';
    const custodyStatus = dialog.querySelector('[data-planr-share-owner-custody-status]');
    if (custodyStatus)
      custodyStatus.textContent = state.ownerCustodyEstablished
        ? 'Full recovery bundle handed to the browser. It contains the three scoped URLs and owner key; no room exists until you confirm creation.'
        : 'No room will be created until the full private recovery bundle is downloaded successfully.';
    const receipt = dialog.querySelector('[data-planr-share-result]');
    if (receipt) receipt.hidden = state.phase !== 'created' || !state.result;
    const resultUrl = dialog.querySelector('[data-planr-share-url]');
    if (resultUrl) resultUrl.value = state.result?.url ?? '';
    const owner = dialog.querySelector('[data-planr-share-owner]');
    if (owner) owner.hidden = !state.result?.ownerUrl;
    const ownerUrl = dialog.querySelector('[data-planr-share-owner-url]');
    if (ownerUrl) ownerUrl.value = state.result?.ownerUrl ?? '';
    const manage = dialog.querySelector('[data-planr-share-manage]');
    if (manage) manage.hidden = !state.result?.manageUrl;
    const manageUrl = dialog.querySelector('[data-planr-share-manage-url]');
    if (manageUrl) manageUrl.value = state.result?.manageUrl ?? '';
    const deletion = dialog.querySelector('[data-planr-share-deletion]');
    if (deletion) deletion.hidden = !state.result?.deletionToken;
    const deletionToken = dialog.querySelector('[data-planr-share-deletion-token]');
    if (deletionToken) deletionToken.textContent = state.result?.deletionToken ?? '';
    const error = dialog.querySelector('[data-planr-share-error]');
    if (error) {
      error.hidden = !state.error;
      error.textContent = state.error;
    }
  }

  async function open() {
    clearPendingOwnerSigner();
    resetCopyButtons();
    if (!state.open)
      returnFocus =
        document.activeElement instanceof window.HTMLElement ? document.activeElement : trigger;
    state = reduceArtifactShareDialog(state, { type: 'open' });
    state = reduceArtifactShareDialog(state, { type: 'preview-start' });
    selectSupportedTransport();
    // A new preview must stay in the loading phase even when the default changes.
    state = reduceArtifactShareDialog(state, { type: 'preview-start' });
    render();
    dialog.querySelector('[data-planr-share-close]')?.focus();
    const request = ++generation;
    try {
      if (!capabilities.length)
        throw new ArtifactShareUiError('E_ARTIFACT_SHARE_HANDLER_REQUIRED', unavailable);
      const preview = await handlers.prepareShare(
        Object.freeze({
          review: reviewForShare(stageController),
          fragmentLimit: ARTIFACT_SHARE_FRAGMENT_LIMIT,
        }),
      );
      if (request !== generation || !state.open) return state;
      state = reduceArtifactShareDialog(state, { type: 'preview-ready', preview });
      selectSupportedTransport();
      if (!supports(state.transport))
        throw new ArtifactShareUiError(
          'E_ARTIFACT_SHARE_TRANSPORT_UNAVAILABLE',
          'This review is too large for the sharing options supported by this viewer. Open it with an updated OpenPlanr installation or export the review.',
        );
      render();
      announce(
        capabilities.includes('fragment') && state.preview.fragmentEligible
          ? 'Private fragment is available. Nothing will be uploaded.'
          : 'Review prepared. Choose an available sharing option.',
      );
    } catch (error) {
      if (request !== generation || !state.open) return state;
      state = reduceArtifactShareDialog(state, { type: 'failure', error: error?.message });
      render();
      announce(state.error);
    }
    return state;
  }

  function close() {
    if (state.phase === 'creating' || state.phase === 'ambiguous') {
      announce(
        state.phase === 'ambiguous'
          ? 'Room creation may have completed. Retry the exact attempt until its receipt is shown.'
          : 'Room creation is in progress. Keep this dialog open until its receipt is shown.',
      );
      return state;
    }
    generation += 1;
    clearPendingOwnerSigner();
    state = reduceArtifactShareDialog(state, { type: 'close' });
    resetCopyButtons();
    render();
    returnFocus?.focus?.();
    returnFocus = null;
    return state;
  }

  async function confirm() {
    if (!state.open || !supports(state.transport)) return state;
    if (!state.preview && state.phase === 'error') return open();
    if (!state.preview || ['custody-preparing', 'creating', 'created'].includes(state.phase))
      return state;
    const transport = state.transport;
    const request = generation;
    if (transport === 'live' && !state.ownerCustodyEstablished) {
      state = reduceArtifactShareDialog(state, { type: 'custody-start' });
      render();
      try {
        const custody = await establishArtifactOwnerCustody({
          prepareOwnerCustody: () =>
            handlers.prepareOwnerCustody(
              Object.freeze({
                review: reviewForShare(stageController),
                ttl: state.ttl,
              }),
            ),
          saveOwnerCustody: handlers.saveOwnerCustody,
        });
        if (request !== generation || !state.open) return state;
        pendingOwnerCustody = custody;
        state = reduceArtifactShareDialog(state, { type: 'custody-ready' });
        render();
        announce(
          'Private recovery-bundle download started. Verify the file is saved, then confirm room creation.',
        );
      } catch (error) {
        if (request !== generation || !state.open) return state;
        clearPendingOwnerSigner();
        state = reduceArtifactShareDialog(state, {
          type: 'failure',
          ownerCustodyEstablished: false,
          error: error?.message,
        });
        render();
        announce(state.error);
      }
      return state;
    }
    if (transport === 'live' && !pendingOwnerCustody) {
      state = reduceArtifactShareDialog(state, {
        type: 'failure',
        ownerCustodyEstablished: false,
        error:
          'The prepared recovery attempt is no longer available. Download a new bundle before creating a room.',
      });
      render();
      announce(state.error);
      return state;
    }
    state = reduceArtifactShareDialog(state, { type: 'create-start' });
    render();
    try {
      const input = {
        review: reviewForShare(stageController),
        preview: state.preview,
        transport,
        ttl: ['live', 'short'].includes(transport) ? state.ttl : undefined,
        confirmed: ['live', 'short'].includes(transport),
      };
      if (transport === 'live') {
        if (pendingOwnerCustody?.kind === 'openplanr-live-room-preparation') {
          Object.defineProperty(input, 'prepared', {
            enumerable: false,
            value: pendingOwnerCustody,
          });
        } else {
          Object.defineProperty(input, 'ownerSigner', {
            enumerable: false,
            value: pendingOwnerCustody,
          });
        }
      }
      const result = await handlers.createShare(Object.freeze(input));
      if (request !== generation || !state.open) return state;
      if (transport === 'live' && result?.ownerSigner !== pendingOwnerSigner()) {
        throw new ArtifactShareUiError(
          'E_ARTIFACT_SHARE_OWNER_CUSTODY_MISMATCH',
          'The created room did not bind the prepared owner key. Retry the exact prepared attempt.',
          { effect: 'ambiguous' },
        );
      }
      state = reduceArtifactShareDialog(state, {
        type: 'create-success',
        result: { ...result, transport },
      });
      clearPendingOwnerSigner();
      render();
      announce(
        transport === 'live'
          ? 'Live room created. Keep the downloaded owner key with the separate owner-verdict URL; management cannot set a verdict.'
          : transport === 'short'
            ? 'Encrypted short link copied. Store the one-time deletion token now.'
            : 'Private fragment copied. Nothing was uploaded.',
      );
      try {
        await handlers.copyText(state.result.url);
        announce(
          transport === 'live'
            ? 'Live review URL copied. Keep the downloaded owner key with the separate owner-verdict URL.'
            : transport === 'short'
              ? 'Encrypted short link copied. Store the one-time deletion token now.'
              : 'Private fragment copied. Nothing was uploaded.',
        );
      } catch {
        announce(
          transport === 'live'
            ? 'Live room created. Copy the review and owner-verdict URLs manually; the room receipt remains visible.'
            : 'Share created. Copy the URL manually; the receipt remains visible.',
        );
      }
    } catch (error) {
      if (request !== generation || !state.open) return state;
      const ambiguous = transport === 'live' && error?.details?.effect === 'ambiguous';
      if (transport === 'live' && !ambiguous) clearPendingOwnerSigner();
      state = reduceArtifactShareDialog(state, {
        type: 'failure',
        ambiguous,
        ownerCustodyEstablished: transport === 'live' && Boolean(pendingOwnerCustody),
        error: error?.message,
      });
      render();
      announce(state.error);
    }
    return state;
  }

  async function copy(value, successMessage, button) {
    if (!value) return;
    try {
      await handlers.copyText(value);
      showCopyState(button, 'copied');
      announce(successMessage);
    } catch (error) {
      showCopyState(button, 'error');
      announce(
        error?.message ?? 'The value could not be copied. The share receipt remains visible.',
      );
    }
  }

  if (existingRoom) {
    const value = stableShareUrl();
    if (value) {
      const label = trigger.querySelector('.planr-action-label');
      if (label) label.textContent = 'Copy link';
      else trigger.textContent = 'Copy link';
      trigger.dataset.planrCopyLabel = 'Copy link';
      trigger.dataset.planrTooltip = 'Copy link';
      trigger.removeAttribute('aria-haspopup');
      trigger.setAttribute('aria-label', 'Copy this live review room link');
      listen(trigger, 'click', () => {
        void copyExistingRoom();
      });
    } else {
      trigger.hidden = true;
    }
  } else {
    listen(trigger, 'click', open);
  }
  listen(backdrop, 'click', (event) => {
    const button = event.target.closest?.('button');
    if (!button) return;
    if (
      button.dataset.planrShareClose !== undefined ||
      button.dataset.planrShareCancel !== undefined
    ) {
      close();
      return;
    }
    if (button.dataset.planrShareTransport) {
      if (!supports(button.dataset.planrShareTransport)) return;
      if (['custody-ready', 'creating', 'ambiguous', 'created'].includes(state.phase)) return;
      if (button.dataset.planrShareTransport !== state.transport) clearPendingOwnerSigner();
      state = reduceArtifactShareDialog(state, {
        type: 'select-transport',
        transport: button.dataset.planrShareTransport,
      });
      render();
      announce(
        state.transport === 'live'
          ? 'Live encrypted review selected. Anyone with this link can comment.'
          : state.transport === 'short'
            ? 'Encrypted short link selected. Creation requires confirmation.'
            : 'Private fragment selected. Nothing will be uploaded.',
      );
      return;
    }
    if (button.dataset.planrShareConfirm !== undefined) {
      void confirm();
      return;
    }
    if (button.dataset.planrShareCopyUrl !== undefined) {
      void copy(state.result?.url, 'Review URL copied.', button);
      return;
    }
    if (button.dataset.planrShareCopyOwner !== undefined) {
      void copy(
        state.result?.ownerUrl,
        'Private owner-verdict URL copied. It requires the matching downloaded owner key.',
        button,
      );
      return;
    }
    if (button.dataset.planrShareCopyManage !== undefined) {
      void copy(
        state.result?.manageUrl,
        'Private management URL copied. It can pause, reopen, or delete the room, but cannot set a verdict.',
        button,
      );
      return;
    }
    if (button.dataset.planrShareCopyDeletion !== undefined) {
      void copy(state.result?.deletionToken, 'One-time deletion token copied.', button);
    }
  });
  const ttlSelect = dialog.querySelector('[data-planr-share-ttl]');
  if (ttlSelect)
    listen(ttlSelect, 'change', () => {
      if (['custody-ready', 'creating', 'ambiguous', 'created'].includes(state.phase)) {
        ttlSelect.value = state.ttl;
        return;
      }
      state = reduceArtifactShareDialog(state, { type: 'set-ttl', ttl: ttlSelect.value });
      render();
      announce(`Expiry set to ${ARTIFACT_SHARE_TTLS[state.ttl].label}.`);
    });
  listen(
    document,
    'keydown',
    (event) => {
      if (!state.open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableElements(dialog);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    true,
  );
  render();

  const controller = Object.freeze({
    getState: () => state,
    open,
    close,
    confirm,
    dispatch(action) {
      if (action.type === 'select-transport' && !supports(action.transport)) return state;
      state = reduceArtifactShareDialog(state, action);
      render();
      return state;
    },
    destroy() {
      if (state.phase === 'creating' || state.phase === 'ambiguous') {
        announce(
          state.phase === 'ambiguous'
            ? 'Room creation may have completed. Retry the exact attempt until its receipt is shown.'
            : 'Room creation is in progress. Keep this review open until its receipt is shown.',
        );
        return false;
      }
      generation += 1;
      clearPendingOwnerSigner();
      for (const timer of copyResetTimers.values()) window.clearTimeout(timer);
      copyResetTimers.clear();
      for (const remove of cleanup.splice(0)) remove();
      if (state.open) {
        state = reduceArtifactShareDialog(state, { type: 'close' });
        render();
      }
      return true;
    },
  });
  window.__openPlanrArtifactShare = controller;
  return controller;
}
