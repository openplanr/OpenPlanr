import { ARTIFACT_SHARE_FRAGMENT_LIMIT } from './share-dialog.mjs';

export const HOSTED_ARTIFACT_VIEWER_STATES = Object.freeze([
  'idle',
  'empty-hash',
  'loading',
  'ready',
  'invalid-version',
  'malformed-payload',
  'too-large',
  'paste-missing',
  'expired',
  'decryption-failed',
  'unsupported-browser',
  'network-error',
]);

export const HOSTED_ARTIFACT_STATE_COPY = Object.freeze({
  'empty-hash': Object.freeze({
    title: 'Open a private review link',
    detail: 'This page needs a complete OpenPlanr fragment or encrypted short-link URL.',
    action: '',
  }),
  loading: Object.freeze({
    title: 'Loading private review',
    detail: 'Validating the immutable payload before opening the artifact.',
    action: '',
  }),
  'invalid-version': Object.freeze({
    title: 'This review version is not supported',
    detail: 'Ask the sender to create a new link with a compatible OpenPlanr release.',
    action: '',
  }),
  'malformed-payload': Object.freeze({
    title: 'This review link is incomplete',
    detail: 'Copy the complete URL again, including everything after the # character.',
    action: '',
  }),
  'too-large': Object.freeze({
    title: 'This private fragment is too large',
    detail: 'Ask the sender to create an encrypted expiring short link instead.',
    action: '',
  }),
  'paste-missing': Object.freeze({
    title: 'This encrypted review is unavailable',
    detail: 'It may have been deleted. Ask the sender for a new immutable review link.',
    action: '',
  }),
  expired: Object.freeze({
    title: 'This encrypted review expired',
    detail: 'Ask the sender for a new immutable review link.',
    action: '',
  }),
  'decryption-failed': Object.freeze({
    title: 'This key cannot decrypt the review',
    detail: 'Use the complete link, including its private fragment key. The payload may also have been changed.',
    action: '',
  }),
  'unsupported-browser': Object.freeze({
    title: 'Browser support is required',
    detail: 'Use a current browser with raw DEFLATE and Web Crypto support.',
    action: '',
  }),
  'network-error': Object.freeze({
    title: 'The encrypted review could not be loaded',
    detail: 'Your link remains unchanged. Check the connection and try again safely.',
    action: 'Try again',
  }),
});

export class HostedArtifactViewerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'HostedArtifactViewerError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function freezeState(value) {
  const status = HOSTED_ARTIFACT_VIEWER_STATES.includes(value.status) ? value.status : 'idle';
  return Object.freeze({
    status,
    transport: ['fragment', 'short'].includes(value.transport) ? value.transport : null,
    request: value.request ? Object.freeze({ ...value.request }) : null,
    envelope: value.envelope ?? null,
    retryable: status === 'network-error',
  });
}

function locationParts(location) {
  if (typeof location === 'string') {
    const parsed = new URL(location, 'https://share.openplanr.dev/');
    return { pathname: parsed.pathname, hash: parsed.hash };
  }
  return {
    pathname: typeof location?.pathname === 'string' ? location.pathname : '/',
    hash: typeof location?.hash === 'string' ? location.hash : '',
  };
}

function malformed(status, details = {}) {
  return Object.freeze({ ok: false, status, details: Object.freeze(details) });
}

/** Parse only the public URL shape; decoding, decryption, and I/O are injected. */
export function parseHostedArtifactLocation(location, {
  fragmentLimit = ARTIFACT_SHARE_FRAGMENT_LIMIT,
} = {}) {
  const { pathname, hash } = locationParts(location);
  const shortMatch = pathname.match(/^\/p\/([A-Za-z0-9_-]{1,128})\/?$/);
  if (shortMatch) {
    if (!hash.startsWith('#k=')) return malformed('malformed-payload', { transport: 'short' });
    const key = hash.slice(3);
    if (!/^[A-Za-z0-9_-]{43}$/.test(key)) {
      return malformed('malformed-payload', { transport: 'short' });
    }
    return Object.freeze({
      ok: true,
      transport: 'short',
      id: shortMatch[1],
      key,
    });
  }

  if (!hash || hash === '#') return malformed('empty-hash');
  const fragment = hash.slice(1);
  if (fragment.length > fragmentLimit) {
    return malformed('too-large', { fragmentLength: fragment.length, fragmentLimit });
  }
  if (!fragment.startsWith('v1.')) {
    return malformed(/^v\d+\./.test(fragment) ? 'invalid-version' : 'malformed-payload');
  }
  const payload = fragment.slice(3);
  if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return malformed('malformed-payload');
  return Object.freeze({ ok: true, transport: 'fragment', version: 'v1', payload });
}

export function hostedArtifactStateForError(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (['E_ARTIFACT_BROWSER_UNSUPPORTED', 'E_ARTIFACT_CODEC_UNSUPPORTED'].includes(code)) {
    return 'unsupported-browser';
  }
  if (['E_ARTIFACT_FRAGMENT_TOO_LARGE', 'E_ARTIFACT_PAYLOAD_TOO_LARGE', 'E_ARTIFACT_DECOMPRESSION_LIMIT'].includes(code)) {
    return 'too-large';
  }
  if (['E_ARTIFACT_PASTE_NOT_FOUND', 'E_ARTIFACT_SHARE_NOT_FOUND', 'E_ARTIFACT_PASTE_UNAVAILABLE'].includes(code)) {
    return 'paste-missing';
  }
  if (['E_ARTIFACT_PASTE_EXPIRED', 'E_ARTIFACT_SHARE_EXPIRED'].includes(code)) {
    return 'expired';
  }
  if (['E_ARTIFACT_DECRYPTION_FAILED', 'E_ARTIFACT_AUTH_FAILED', 'E_ARTIFACT_PAYLOAD_TAMPERED', 'OperationError'].includes(code)) {
    return 'decryption-failed';
  }
  if (['E_ARTIFACT_SHARE_NETWORK', 'E_ARTIFACT_NETWORK', 'E_ARTIFACT_FETCH_FAILED'].includes(code)
    || error?.name === 'TypeError') {
    return 'network-error';
  }
  if (['E_ARTIFACT_VERSION_UNSUPPORTED', 'E_ARTIFACT_FRAGMENT_VERSION', 'E_ARTIFACT_FRAGMENT_VERSION_UNSUPPORTED'].includes(code)) {
    return 'invalid-version';
  }
  if (code === 'E_ARTIFACT_PASTE_INVALID') return 'malformed-payload';
  return 'malformed-payload';
}

function setCopy(document, status) {
  const copy = HOSTED_ARTIFACT_STATE_COPY[status] ?? { title: '', detail: '', action: '' };
  const title = document.querySelector('[data-planr-hosted-title]');
  const detail = document.querySelector('[data-planr-hosted-detail]');
  const action = document.querySelector('[data-planr-hosted-retry]');
  if (title) title.textContent = copy.title;
  if (detail) detail.textContent = copy.detail;
  if (action) {
    action.textContent = copy.action;
    action.hidden = !copy.action;
  }
}

export function mountHostedArtifactViewer({
  document = globalThis.document,
  window = document?.defaultView,
  enabled = false,
  location = window?.location,
  decodeFragment,
  loadShort,
  onEnvelope,
  supportsTransport = () => true,
  fragmentLimit = ARTIFACT_SHARE_FRAGMENT_LIMIT,
} = {}) {
  if (!enabled || !document || !window) return null;
  const slot = document.querySelector('[data-planr-hosted-viewer]');
  if (!slot) return null;
  let state = freezeState({ status: 'idle' });
  let generation = 0;
  const cleanup = [];

  function render() {
    const visible = !['idle', 'ready'].includes(state.status);
    slot.hidden = !visible;
    slot.dataset.planrHostedState = state.status;
    slot.setAttribute('aria-busy', String(state.status === 'loading'));
    setCopy(document, state.status);
  }

  function setState(next) {
    state = freezeState(next);
    render();
    return state;
  }

  async function load() {
    const parsed = parseHostedArtifactLocation(location, { fragmentLimit });
    if (!parsed.ok) return setState({ status: parsed.status });
    const request = parsed.transport === 'fragment'
      ? { transport: 'fragment', version: parsed.version, payload: parsed.payload }
      : { transport: 'short', id: parsed.id, key: parsed.key };
    if (!supportsTransport(parsed.transport)) {
      return setState({ status: 'unsupported-browser', transport: parsed.transport, request });
    }
    const sequence = ++generation;
    setState({ status: 'loading', transport: parsed.transport, request });
    try {
      const envelope = parsed.transport === 'fragment'
        ? await (typeof decodeFragment === 'function'
          ? decodeFragment(Object.freeze({ version: parsed.version, payload: parsed.payload }))
          : Promise.reject(new HostedArtifactViewerError(
            'E_ARTIFACT_CODEC_UNSUPPORTED',
            'No private-fragment decoder is installed.',
          )))
        : await (typeof loadShort === 'function'
          ? loadShort(Object.freeze({ id: parsed.id, key: parsed.key }))
          : Promise.reject(new HostedArtifactViewerError(
            'E_ARTIFACT_BROWSER_UNSUPPORTED',
            'No encrypted short-link loader is installed.',
          )));
      if (sequence !== generation) return state;
      setState({ status: 'ready', transport: parsed.transport, request, envelope });
      if (typeof onEnvelope === 'function') await onEnvelope(envelope, Object.freeze({ transport: parsed.transport }));
    } catch (error) {
      if (sequence !== generation) return state;
      setState({ status: hostedArtifactStateForError(error), transport: parsed.transport, request });
    }
    return state;
  }

  function onClick(event) {
    if (!event.target.closest?.('[data-planr-hosted-retry]') || !state.retryable) return;
    void load();
  }
  slot.addEventListener('click', onClick);
  cleanup.push(() => slot.removeEventListener('click', onClick));
  render();
  const ready = load();
  const controller = Object.freeze({
    getState: () => state,
    ready,
    retry() {
      return state.retryable ? load() : Promise.resolve(state);
    },
    load,
    destroy() {
      generation += 1;
      for (const remove of cleanup.splice(0)) remove();
    },
  });
  window.__openPlanrHostedArtifactViewer = controller;
  return controller;
}
