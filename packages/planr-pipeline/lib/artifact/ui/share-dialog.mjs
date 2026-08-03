export const ARTIFACT_SHARE_FRAGMENT_LIMIT = 8_000;

export const ARTIFACT_SHARE_TTLS = Object.freeze({
  '1d': Object.freeze({ label: '1 day', milliseconds: 86_400_000 }),
  '7d': Object.freeze({ label: '7 days', milliseconds: 604_800_000 }),
  '30d': Object.freeze({ label: '30 days', milliseconds: 2_592_000_000 }),
});

export const ARTIFACT_SHARE_TRANSPORTS = Object.freeze(['live', 'fragment', 'short']);

const PHASES = Object.freeze(['idle', 'previewing', 'ready', 'creating', 'created', 'error']);

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

function frozenResult(value) {
  if (!value || typeof value !== 'object' || typeof value.url !== 'string' || value.url.length === 0) {
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
  const manageUrl = text(value.manageUrl);
  if (deletionToken && value.url.includes(deletionToken)) {
    throw new ArtifactShareUiError(
      'E_ARTIFACT_SHARE_DELETION_TOKEN_LEAK',
      'The deletion token must never be included in the review URL.',
    );
  }
  return Object.freeze({
    transport: value.transport,
    url: value.url,
    manageUrl,
    deletionToken,
    expiresAt: text(value.expiresAt),
  });
}

export function normalizeArtifactSharePreview(value = {}) {
  const preview = value && typeof value === 'object' ? value : {};
  const fragmentLength = count(preview.fragmentLength ?? 0, 'fragmentLength');
  return Object.freeze({
    fragmentLength,
    compressedBytes: count(preview.compressedBytes ?? 0, 'compressedBytes'),
    ciphertextBytes: count(preview.ciphertextBytes ?? 0, 'ciphertextBytes'),
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
    result: null,
    error: '',
  });
}

export function reduceArtifactShareDialog(state, action = {}) {
  const current = state ?? createArtifactShareDialogState();
  switch (action.type) {
    case 'open':
      return freezeState({ ...current, open: true, result: null, error: '' });
    case 'close':
      return freezeState({ ...current, open: false, phase: current.preview ? 'ready' : 'idle', error: '' });
    case 'preview-start':
      return freezeState({ ...current, open: true, phase: 'previewing', preview: null, result: null, error: '' });
    case 'preview-ready': {
      const preview = normalizeArtifactSharePreview(action.preview);
      return freezeState({
        ...current,
        phase: 'ready',
        preview,
        transport: current.transport === 'fragment' && !preview.fragmentEligible ? 'short' : current.transport,
        result: null,
        error: '',
      });
    }
    case 'select-transport': {
      const transport = member(action.transport, ARTIFACT_SHARE_TRANSPORTS, current.transport);
      if (transport === 'fragment' && current.preview?.fragmentEligible === false) return current;
      return transport === current.transport ? current : freezeState({ ...current, transport, result: null, error: '' });
    }
    case 'set-ttl': {
      const ttl = Object.hasOwn(ARTIFACT_SHARE_TTLS, action.ttl) ? action.ttl : current.ttl;
      return ttl === current.ttl ? current : freezeState({ ...current, ttl, result: null, error: '' });
    }
    case 'create-start':
      return freezeState({ ...current, phase: 'creating', result: null, error: '' });
    case 'create-success':
      return freezeState({ ...current, phase: 'created', result: action.result, error: '' });
    case 'failure':
      return freezeState({ ...current, phase: 'error', result: null, error: text(action.error, 'Share creation failed.') });
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
  return [...dialog.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hidden && !element.closest('[hidden]'));
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

export function mountArtifactShareDialog({
  document = globalThis.document,
  window = document?.defaultView,
  root = document?.querySelector?.('.planr-shell'),
  stageController,
  prepareShare,
  createShare,
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
  let returnFocus = null;
  let generation = 0;
  const copyResetTimers = new Map();
  const cleanup = [];
  const handlers = {
    prepareShare: typeof prepareShare === 'function'
      ? prepareShare
      : async () => ({ fragmentLength: 0, compressedBytes: 0, ciphertextBytes: 0 }),
    createShare: typeof createShare === 'function'
      ? createShare
      : async () => {
        throw new ArtifactShareUiError(
          'E_ARTIFACT_SHARE_HANDLER_REQUIRED',
          'Share creation is unavailable in this host.',
        );
      },
    copyText: typeof copyText === 'function' ? copyText : (value) => defaultCopy(window, value),
  };
  const stableShareUrl = typeof existingShareUrl === 'function' ? existingShareUrl : () => existingShareUrl;

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
    copyResetTimers.set(button, window.setTimeout(() => resetCopyButton(button), 1_800));
  }

  function resetCopyButtons() {
    for (const button of dialog.querySelectorAll('[data-planr-copy-state]')) resetCopyButton(button);
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
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
      button.disabled = state.phase === 'previewing'
        || state.phase === 'creating'
        || (transport === 'fragment' && preview?.fragmentEligible === false);
    }

    const fragmentSize = dialog.querySelector('[data-planr-share-fragment-size]');
    if (fragmentSize) fragmentSize.textContent = preview
      ? `${preview.fragmentLength.toLocaleString('en-US')} chars · ${formatArtifactShareBytes(preview.compressedBytes)}`
      : 'Calculating…';
    const shortSize = dialog.querySelector('[data-planr-share-short-size]');
    if (shortSize) shortSize.textContent = preview
      ? formatArtifactShareBytes(preview.ciphertextBytes)
      : 'Calculating…';
    const threshold = dialog.querySelector('[data-planr-share-threshold]');
    if (threshold) {
      threshold.textContent = preview?.fragmentEligible === false
        ? `Private fragment snapshot unavailable (${preview.fragmentLength.toLocaleString('en-US')} characters; 8,000 limit). Live review and encrypted short link are available.`
        : 'Private fragment snapshot available for links up to 8,000 characters.';
    }

    const ttlRow = dialog.querySelector('[data-planr-share-ttl-row]');
    if (ttlRow) ttlRow.hidden = !['live', 'short'].includes(state.transport);
    const ttlSelect = dialog.querySelector('[data-planr-share-ttl]');
    if (ttlSelect) {
      ttlSelect.value = state.ttl;
      ttlSelect.disabled = state.phase === 'creating';
    }
    const expiry = artifactShareExpiry(state.ttl, now());
    const expiryNode = dialog.querySelector('[data-planr-share-expiry]');
    if (expiryNode) {
      expiryNode.dateTime = expiry;
      expiryNode.textContent = new Intl.DateTimeFormat('en', {
        year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
      }).format(new Date(expiry));
    }

    const primary = dialog.querySelector('[data-planr-share-confirm]');
    if (primary) {
      primary.disabled = !preview || state.phase === 'previewing' || state.phase === 'creating';
      primary.textContent = state.phase === 'creating'
        ? 'Creating…'
        : state.transport === 'live'
          ? 'Create live review room'
          : state.transport === 'short'
          ? 'Create encrypted link'
          : 'Copy private link';
    }
    const receipt = dialog.querySelector('[data-planr-share-result]');
    if (receipt) receipt.hidden = state.phase !== 'created' || !state.result;
    const resultUrl = dialog.querySelector('[data-planr-share-url]');
    if (resultUrl) resultUrl.value = state.result?.url ?? '';
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
    resetCopyButtons();
    returnFocus = document.activeElement instanceof window.HTMLElement ? document.activeElement : trigger;
    state = reduceArtifactShareDialog(state, { type: 'open' });
    state = reduceArtifactShareDialog(state, { type: 'preview-start' });
    render();
    dialog.querySelector('[data-planr-share-close]')?.focus();
    const request = ++generation;
    try {
      const preview = await handlers.prepareShare(Object.freeze({
        review: reviewForShare(stageController),
        fragmentLimit: ARTIFACT_SHARE_FRAGMENT_LIMIT,
      }));
      if (request !== generation || !state.open) return state;
      state = reduceArtifactShareDialog(state, { type: 'preview-ready', preview });
      render();
      announce(state.preview.fragmentEligible
        ? 'Private fragment is available. Nothing will be uploaded.'
        : 'Private fragment snapshot is unavailable at this size. Live review and encrypted short link remain available.');
    } catch (error) {
      if (request !== generation || !state.open) return state;
      state = reduceArtifactShareDialog(state, { type: 'failure', error: error?.message });
      render();
      announce(state.error);
    }
    return state;
  }

  function close() {
    generation += 1;
    state = reduceArtifactShareDialog(state, { type: 'close' });
    resetCopyButtons();
    render();
    returnFocus?.focus?.();
    returnFocus = null;
    return state;
  }

  async function confirm() {
    if (!state.preview || state.phase === 'creating') return state;
    const transport = state.transport;
    const request = generation;
    state = reduceArtifactShareDialog(state, { type: 'create-start' });
    render();
    try {
      const result = await handlers.createShare(Object.freeze({
        review: reviewForShare(stageController),
        preview: state.preview,
        transport,
        ttl: ['live', 'short'].includes(transport) ? state.ttl : undefined,
        confirmed: ['live', 'short'].includes(transport),
      }));
      if (request !== generation || !state.open) return state;
      state = reduceArtifactShareDialog(state, {
        type: 'create-success',
        result: { ...result, transport },
      });
      render();
      await handlers.copyText(state.result.url);
      announce(transport === 'live'
        ? 'Live review URL copied. Save the separate private manage URL.'
        : transport === 'short'
        ? 'Encrypted short link copied. Store the one-time deletion token now.'
        : 'Private fragment copied. Nothing was uploaded.');
    } catch (error) {
      if (request !== generation || !state.open) return state;
      state = reduceArtifactShareDialog(state, { type: 'failure', error: error?.message });
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
      state = reduceArtifactShareDialog(state, { type: 'failure', error: error?.message });
      render();
      announce(state.error);
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
      listen(trigger, 'click', () => { void copyExistingRoom(); });
    } else {
      trigger.hidden = true;
    }
  } else {
    listen(trigger, 'click', open);
  }
  listen(backdrop, 'click', (event) => {
    const button = event.target.closest?.('button');
    if (!button) return;
    if (button.dataset.planrShareClose !== undefined || button.dataset.planrShareCancel !== undefined) {
      close();
      return;
    }
    if (button.dataset.planrShareTransport) {
      state = reduceArtifactShareDialog(state, {
        type: 'select-transport',
        transport: button.dataset.planrShareTransport,
      });
      render();
      announce(state.transport === 'live'
        ? 'Live encrypted review selected. Anyone with this link can comment.'
        : state.transport === 'short'
        ? 'Encrypted short link selected. Creation requires confirmation.'
        : 'Private fragment selected. Nothing will be uploaded.');
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
    if (button.dataset.planrShareCopyManage !== undefined) {
      void copy(state.result?.manageUrl, 'Private manage URL copied. Keep it private.', button);
      return;
    }
    if (button.dataset.planrShareCopyDeletion !== undefined) {
      void copy(state.result?.deletionToken, 'One-time deletion token copied.', button);
    }
  });
  const ttlSelect = dialog.querySelector('[data-planr-share-ttl]');
  if (ttlSelect) listen(ttlSelect, 'change', () => {
    state = reduceArtifactShareDialog(state, { type: 'set-ttl', ttl: ttlSelect.value });
    render();
    announce(`Expiry set to ${ARTIFACT_SHARE_TTLS[state.ttl].label}.`);
  });
  listen(document, 'keydown', (event) => {
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
  }, true);
  render();

  const controller = Object.freeze({
    getState: () => state,
    open,
    close,
    confirm,
    dispatch(action) {
      state = reduceArtifactShareDialog(state, action);
      render();
      return state;
    },
    destroy() {
      generation += 1;
      for (const timer of copyResetTimers.values()) window.clearTimeout(timer);
      copyResetTimers.clear();
      for (const remove of cleanup.splice(0)) remove();
      if (state.open) {
        state = reduceArtifactShareDialog(state, { type: 'close' });
        render();
      }
    },
  });
  window.__openPlanrArtifactShare = controller;
  return controller;
}
