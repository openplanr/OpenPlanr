import {
  clientSelectionToNormalized,
  mountArtifactAnnotations,
} from './annotations.mjs';
import { mountArtifactFeedbackRail } from './feedback-rail.mjs';
import { mountHostedArtifactViewer } from './hosted-viewer.mjs';
import { mountArtifactShareDialog } from './share-dialog.mjs';

export const ARTIFACT_STAGE_EVENTS = Object.freeze({
  change: 'planr:stage-change',
  point: 'planr:artifact-point',
  region: 'planr:artifact-region',
  layout: 'planr:artifact-layout',
});

export const ARTIFACT_STAGE_LIMITS = Object.freeze({
  defaultZoom: 72,
  minZoom: 25,
  maxZoom: 200,
  zoomStep: 10,
  maxDocumentWidth: 16_384,
  maxDocumentHeight: 262_144,
});

const VIEW_MODES = Object.freeze(['single', 'variants', 'split']);
const REVIEW_MODES = Object.freeze(['interact', 'comment']);
const THEMES = Object.freeze(['auto', 'light', 'dark']);
const PRESENTATIONS = Object.freeze(['document', 'canvas']);
const STATUSES = Object.freeze([
  'ready',
  'empty',
  'bundling',
  'loading',
  'invalid',
  'expired',
  'decryption-failed',
  'unsupported-browser',
]);

const STATUS_COPY = Object.freeze({
  empty: Object.freeze({
    title: 'No artifact content',
    detail: 'Choose a bundled HTML artifact to begin this review.',
  }),
  bundling: Object.freeze({
    title: 'Bundling artifact',
    detail: 'Packaging local scripts, styles, fonts, and images without network access.',
  }),
  loading: Object.freeze({
    title: 'Loading private review',
    detail: 'Validating the envelope and frozen artifact viewport.',
  }),
  invalid: Object.freeze({
    title: 'This review is invalid',
    detail: 'The artifact envelope could not be decoded or validated.',
  }),
  expired: Object.freeze({
    title: 'This encrypted review expired',
    detail: 'Ask the sender for a new immutable review link.',
  }),
  'decryption-failed': Object.freeze({
    title: 'This key cannot decrypt the review',
    detail: 'Use the complete link, including its private fragment key.',
  }),
  'unsupported-browser': Object.freeze({
    title: 'Browser support is required',
    detail: 'Use a current browser with Blob URL support to review this artifact.',
  }),
});

function member(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function finite(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalized(value) {
  return Math.round(clamp(finite(value), 0, 1) * 1_000_000) / 1_000_000;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function freezeArtifactMetadata(artifact, index) {
  if (!artifact || typeof artifact !== 'object') {
    throw new TypeError(`Artifact ${index + 1} must be an object.`);
  }
  if (typeof artifact.id !== 'string' || artifact.id.length === 0) {
    throw new TypeError(`Artifact ${index + 1} requires an id.`);
  }
  return Object.freeze({
    id: artifact.id,
    title: typeof artifact.title === 'string' && artifact.title.length > 0
      ? artifact.title
      : `Artifact ${index + 1}`,
    sha256: typeof artifact.sha256 === 'string' ? artifact.sha256 : '',
    viewport: Object.freeze({
      width: positiveInteger(artifact.viewport?.width, 1440),
      height: positiveInteger(artifact.viewport?.height, 900),
    }),
    colorScheme: member(artifact.colorScheme, ['light', 'dark'], 'light'),
  });
}

function artifactMetadata(artifact) {
  return Object.freeze({
    id: artifact.id,
    title: artifact.title,
    sha256: artifact.sha256,
    viewport: artifact.viewport,
    colorScheme: artifact.colorScheme,
  });
}

function requestedArtifactId(value) {
  if (typeof value === 'string') return value;
  return typeof value?.id === 'string' ? value.id : '';
}

function availableId(artifacts, requested, fallback = '') {
  return artifacts.some(({ id }) => id === requested) ? requested : fallback;
}

function comparisonIdFor(artifacts, activeArtifactId, requested = '') {
  if (requested !== activeArtifactId && artifacts.some(({ id }) => id === requested)) return requested;
  return artifacts.find(({ id }) => id !== activeArtifactId)?.id ?? '';
}

function normalizeViewMode(value, artifactCount) {
  if (artifactCount < 2) return 'single';
  return member(value, VIEW_MODES, 'variants');
}

export function resolveArtifactPresentation(value, { viewMode = 'single', artifactCount = 1 } = {}) {
  if (PRESENTATIONS.includes(value)) return value;
  return artifactCount > 1 || viewMode === 'variants' || viewMode === 'split' ? 'canvas' : 'document';
}

/**
 * Build the metadata-only value embedded in the shell document. Artifact HTML,
 * review state, and all unknown/machine metadata are intentionally excluded.
 */
export function createArtifactStagePayload(envelope = {}, { viewer } = {}) {
  const artifacts = Object.freeze(
    (Array.isArray(envelope?.artifacts) ? envelope.artifacts : []).map(freezeArtifactMetadata),
  );
  const sourceViewer = viewer && typeof viewer === 'object'
    ? viewer
    : (envelope?.viewer && typeof envelope.viewer === 'object' ? envelope.viewer : {});
  const firstId = artifacts[0]?.id ?? '';
  const activeArtifactId = availableId(
    artifacts,
    requestedArtifactId(sourceViewer.activeArtifactId),
    firstId,
  );
  const mode = normalizeViewMode(sourceViewer.mode, artifacts.length);
  return Object.freeze({
    schemaVersion: '1.0.0',
    artifacts,
    viewer: Object.freeze({
      mode,
      activeArtifactId,
      ...(PRESENTATIONS.includes(sourceViewer.presentation)
        ? { presentation: sourceViewer.presentation }
        : {}),
    }),
  });
}

export function createArtifactStageState(payload = {}, shellModel = {}) {
  const artifacts = Object.freeze(
    (Array.isArray(payload?.artifacts) ? payload.artifacts : []).map(artifactMetadata),
  );
  const firstId = artifacts[0]?.id ?? '';
  const activeArtifactId = availableId(
    artifacts,
    requestedArtifactId(shellModel.activeArtifact ?? shellModel.activeArtifactId)
      || requestedArtifactId(payload?.viewer?.activeArtifactId),
    firstId,
  );
  const comparisonArtifactId = comparisonIdFor(
    artifacts,
    activeArtifactId,
    requestedArtifactId(shellModel.comparisonArtifact ?? shellModel.comparisonArtifactId),
  );
  const statusFallback = artifacts.length === 0 ? 'empty' : 'ready';
  let status = member(shellModel.status, STATUSES, statusFallback);
  if (artifacts.length === 0 && status === 'ready') status = 'empty';
  const viewMode = normalizeViewMode(
    shellModel.viewMode ?? payload?.viewer?.mode,
    artifacts.length,
  );
  const presentation = resolveArtifactPresentation(
    shellModel.presentation ?? payload?.viewer?.presentation,
    { viewMode, artifactCount: artifacts.length },
  );
  return Object.freeze({
    schemaVersion: '1.0.0',
    artifacts,
    activeArtifactId,
    comparisonArtifactId,
    viewMode,
    presentation,
    reviewMode: member(shellModel.reviewMode, REVIEW_MODES, 'interact'),
    zoom: clamp(
      Number.isInteger(shellModel.zoom) ? shellModel.zoom : ARTIFACT_STAGE_LIMITS.defaultZoom,
      ARTIFACT_STAGE_LIMITS.minZoom,
      ARTIFACT_STAGE_LIMITS.maxZoom,
    ),
    railOpen: shellModel.railOpen === undefined ? presentation === 'canvas' : Boolean(shellModel.railOpen),
    theme: member(shellModel.theme, THEMES, 'auto'),
    status,
  });
}

function nextState(state, changes) {
  return Object.freeze({ ...state, ...changes });
}

export function reduceArtifactStageState(state, action = {}) {
  switch (action.type) {
    case 'set-active': {
      const id = availableId(state.artifacts, action.artifactId);
      if (!id || id === state.activeArtifactId) return state;
      const comparisonArtifactId = id === state.comparisonArtifactId
        ? state.activeArtifactId
        : comparisonIdFor(state.artifacts, id, state.comparisonArtifactId);
      return nextState(state, { activeArtifactId: id, comparisonArtifactId });
    }
    case 'set-comparison': {
      const id = comparisonIdFor(state.artifacts, state.activeArtifactId, action.artifactId);
      return id === state.comparisonArtifactId ? state : nextState(state, { comparisonArtifactId: id });
    }
    case 'set-view-mode': {
      const viewMode = normalizeViewMode(action.viewMode, state.artifacts.length);
      return viewMode === state.viewMode ? state : nextState(state, { viewMode });
    }
    case 'set-review-mode': {
      const reviewMode = member(action.reviewMode, REVIEW_MODES, state.reviewMode);
      return reviewMode === state.reviewMode ? state : nextState(state, { reviewMode });
    }
    case 'set-zoom': {
      const zoom = clamp(
        Math.round(finite(action.zoom, state.zoom)),
        ARTIFACT_STAGE_LIMITS.minZoom,
        ARTIFACT_STAGE_LIMITS.maxZoom,
      );
      return zoom === state.zoom ? state : nextState(state, { zoom });
    }
    case 'zoom-by':
      return reduceArtifactStageState(state, {
        type: 'set-zoom',
        zoom: state.zoom + finite(action.delta),
      });
    case 'set-rail-open': {
      const railOpen = Boolean(action.railOpen);
      return railOpen === state.railOpen ? state : nextState(state, { railOpen });
    }
    case 'toggle-rail':
      return nextState(state, { railOpen: !state.railOpen });
    case 'set-theme': {
      const theme = member(action.theme, THEMES, state.theme);
      return theme === state.theme ? state : nextState(state, { theme });
    }
    case 'cycle-theme': {
      const index = THEMES.indexOf(state.theme);
      return nextState(state, { theme: THEMES[(index + 1) % THEMES.length] });
    }
    case 'set-status': {
      const status = member(action.status, STATUSES, state.status);
      return status === state.status ? state : nextState(state, { status });
    }
    default:
      return state;
  }
}

export function visibleArtifactIds(state) {
  if (!state.activeArtifactId) return Object.freeze([]);
  if (state.viewMode === 'split' && state.comparisonArtifactId) {
    return Object.freeze([state.activeArtifactId, state.comparisonArtifactId]);
  }
  return Object.freeze([state.activeArtifactId]);
}

function assertRect(rect) {
  if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)
    || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)
    || rect.width <= 0 || rect.height <= 0) {
    throw new RangeError('Artifact bounds must have positive finite dimensions.');
  }
}

export function clientPointToNormalized(rect, point) {
  assertRect(rect);
  return Object.freeze({
    x: normalized((finite(point?.x ?? point?.clientX) - rect.left) / rect.width),
    y: normalized((finite(point?.y ?? point?.clientY) - rect.top) / rect.height),
  });
}

export function normalizedPointToClient(rect, point) {
  assertRect(rect);
  return Object.freeze({
    x: rect.left + normalized(point?.x) * rect.width,
    y: rect.top + normalized(point?.y) * rect.height,
  });
}

function parseDataScript(document, id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing artifact shell data: ${id}`);
  return JSON.parse(node.textContent ?? 'null');
}

function isEditableTarget(target) {
  const HTMLElement = target?.ownerDocument?.defaultView?.HTMLElement;
  return Boolean(HTMLElement && target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)));
}

function stageArtifactById(state, id) {
  return state.artifacts.find((artifact) => artifact.id === id) ?? null;
}

function updateStatus(document, state) {
  const statusPanel = document.querySelector('.planr-stage-status');
  const surface = document.querySelector('.planr-stage-surface');
  if (!statusPanel || !surface) return;
  const ready = state.status === 'ready';
  statusPanel.hidden = ready;
  surface.toggleAttribute('inert', !ready);
  surface.setAttribute('aria-hidden', String(!ready));
  if (ready) surface.removeAttribute('aria-hidden');
  const copy = STATUS_COPY[state.status];
  if (copy) {
    const title = statusPanel.querySelector('strong');
    const detail = statusPanel.querySelector('p');
    if (title) title.textContent = copy.title;
    if (detail) detail.textContent = copy.detail;
  }
}

function emit(root, window, type, detail) {
  root.dispatchEvent(new window.CustomEvent(type, { detail, bubbles: true }));
}

async function htmlForSource(window, source) {
  if (typeof source === 'string' && source.trimStart().startsWith('<')) return source;
  if (source && typeof source === 'object' && typeof source.html === 'string') return source.html;
  if (source instanceof window.Blob) return source.text();
  if (source instanceof window.ArrayBuffer) return new window.TextDecoder().decode(source);
  if (window.ArrayBuffer.isView(source)) {
    return new window.TextDecoder().decode(
      new window.Uint8Array(source.buffer, source.byteOffset, source.byteLength),
    );
  }
  return null;
}

export function mountArtifactStage({
  document = globalThis.document,
  window = document?.defaultView,
  resolveArtifactSource,
  bridgeClient,
  onState,
  review: reviewOptions = {},
  share: shareOptions = {},
  hosted: hostedOptions = {},
} = {}) {
  if (!document || !window) return null;
  const root = document.querySelector('.planr-shell');
  if (!root) return null;

  let payload;
  let shellModel;
  let reviewConfig;
  try {
    payload = parseDataScript(document, 'planr-artifact-stage-payload');
    shellModel = parseDataScript(document, 'planr-artifact-shell-model');
    reviewConfig = parseDataScript(document, 'planr-artifact-review-state');
  } catch {
    payload = { artifacts: [], viewer: { mode: 'single', activeArtifactId: '' } };
    shellModel = { status: 'invalid' };
    reviewConfig = { reviewOf: '0'.repeat(64), review: null };
  }

  let state;
  try {
    state = createArtifactStageState(payload, shellModel);
  } catch {
    state = createArtifactStageState({}, { status: 'invalid' });
  }

  const frames = new Map(
    [...document.querySelectorAll('[data-planr-artifact-frame]')]
      .map((frame) => [frame.dataset.planrArtifactFrame, frame]),
  );
  const panels = new Map(
    [...document.querySelectorAll('.planr-artifact-panel[data-artifact-id]')]
      .map((panel) => [panel.dataset.artifactId, panel]),
  );
  const documentLayouts = new Map();
  const cleanup = [];

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    cleanup.push(() => target.removeEventListener(type, handler, options));
  }

  function render({ announce = false } = {}) {
    const visible = new Set(visibleArtifactIds(state));
    root.dataset.planrView = state.viewMode;
    root.dataset.planrReviewMode = state.reviewMode;
    root.dataset.planrState = state.status;
    root.dataset.planrRailOpen = String(state.railOpen);
    root.dataset.planrPresentation = state.presentation;
    document.documentElement.dataset.planrPresentation = state.presentation;
    document.documentElement.dataset.planrTheme = state.theme;

    const grid = document.querySelector('.planr-frame-grid');
    const surface = document.querySelector('.planr-stage-surface');
    const tablist = document.querySelector('.planr-variants');
    const rail = document.getElementById('planr-review-rail');
    const feedbackButton = document.querySelector('[data-planr-action="feedback"]');
    const themeButton = document.querySelector('[data-planr-action="theme"]');
    const statusSlot = document.querySelector('[data-planr-slot="status"]');
    const metadata = document.querySelector('.planr-title-block > span');
    const breadcrumb = document.querySelector('.planr-stage-heading > span:first-child');
    const activeArtifact = stageArtifactById(state, state.activeArtifactId);

    if (grid) grid.dataset.planrLayout = state.viewMode;
    const visualOrder = state.viewMode === 'split'
      ? [...visible, ...state.artifacts.map(({ id }) => id).filter((id) => !visible.has(id))]
      : state.artifacts.map(({ id }) => id);
    if (surface) surface.style.setProperty('--planr-shell-zoom', String(state.zoom / 100));
    if (tablist) tablist.hidden = state.viewMode === 'single' || state.artifacts.length < 2;
    if (rail) {
      rail.toggleAttribute('inert', !state.railOpen);
      rail.setAttribute('aria-hidden', String(!state.railOpen));
      if (state.railOpen) rail.removeAttribute('aria-hidden');
    }
    if (feedbackButton) feedbackButton.setAttribute('aria-expanded', String(state.railOpen));
    if (themeButton) {
      themeButton.textContent = state.theme;
      themeButton.setAttribute('aria-label', `Shell theme ${state.theme}`);
    }
    if (statusSlot) statusSlot.textContent = state.reviewMode === 'comment'
      ? 'Comment mode'
      : 'Interactions enabled';
    if (metadata && activeArtifact) {
      metadata.textContent = `HTML · ${activeArtifact.viewport.width}×${activeArtifact.viewport.height}`;
    }
    if (breadcrumb) breadcrumb.textContent = `ARTIFACT / ${(activeArtifact?.title ?? 'Artifact').toUpperCase()}`;

    for (const button of document.querySelectorAll('[data-planr-view]')) {
      const mode = button.dataset.planrView;
      button.setAttribute('aria-pressed', String(mode === state.viewMode));
      button.disabled = state.artifacts.length < 2 && mode !== 'single';
    }
    for (const button of document.querySelectorAll('[data-planr-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.planrMode === state.reviewMode));
    }
    for (const button of document.querySelectorAll('[data-planr-action="zoom-reset"]')) {
      button.textContent = `${state.zoom}%`;
    }
    for (const tab of document.querySelectorAll('[role="tab"][data-artifact-id]')) {
      const selected = tab.dataset.artifactId === state.activeArtifactId;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const [id, panel] of panels) {
      const isVisible = visible.has(id);
      const isPrimary = id === state.activeArtifactId;
      panel.hidden = !isVisible;
      panel.style.order = String(visualOrder.indexOf(id));
      const artifact = stageArtifactById(state, id);
      panel.setAttribute('aria-label', `${isPrimary ? 'Primary' : 'Comparison'} artifact: ${artifact?.title ?? id}`);
      const frame = frames.get(id);
      const annotationLayer = panel.querySelector('[data-planr-annotation-layer]');
      if (frame) frame.tabIndex = isVisible && state.status === 'ready' && state.reviewMode === 'interact' ? 0 : -1;
      if (annotationLayer) {
        const enabled = isVisible && state.status === 'ready' && state.reviewMode === 'comment';
        annotationLayer.tabIndex = enabled ? 0 : -1;
        annotationLayer.setAttribute('aria-disabled', String(!enabled));
      }
    }
    updateStatus(document, state);
    if (typeof onState === 'function') {
      try {
        onState(state);
      } catch {
        // UI state remains authoritative when an optional observer fails.
      }
    }
    if (announce) emit(root, window, ARTIFACT_STAGE_EVENTS.change, state);
  }

  function dispatch(action, { announce = true } = {}) {
    const previous = state;
    state = reduceArtifactStageState(state, action);
    if (state !== previous) render({ announce });
    return state;
  }

  function setActiveFromTab(tab, { focus = false } = {}) {
    dispatch({ type: 'set-active', artifactId: tab.dataset.artifactId });
    if (focus) tab.focus();
  }

  function onClick(event) {
    const target = event.target.closest?.('button');
    if (!target) return;
    if (target.dataset.planrView) {
      dispatch({ type: 'set-view-mode', viewMode: target.dataset.planrView });
      return;
    }
    if (target.dataset.artifactId && target.getAttribute('role') === 'tab') {
      setActiveFromTab(target);
      return;
    }
    if (target.dataset.planrMode) {
      dispatch({ type: 'set-review-mode', reviewMode: target.dataset.planrMode });
      return;
    }
    switch (target.dataset.planrAction) {
      case 'zoom-out':
        dispatch({ type: 'zoom-by', delta: -ARTIFACT_STAGE_LIMITS.zoomStep });
        break;
      case 'zoom-reset':
        dispatch({ type: 'set-zoom', zoom: ARTIFACT_STAGE_LIMITS.defaultZoom });
        break;
      case 'zoom-in':
        dispatch({ type: 'zoom-by', delta: ARTIFACT_STAGE_LIMITS.zoomStep });
        break;
      case 'feedback': {
        const rail = document.getElementById('planr-review-rail');
        if (state.railOpen && rail?.contains(document.activeElement)) target.focus();
        dispatch({ type: 'toggle-rail' });
        break;
      }
      case 'theme':
        dispatch({ type: 'cycle-theme' });
        break;
      default:
        break;
    }
  }

  function onKeyDown(event) {
    if (event.defaultPrevented) return;
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !isEditableTarget(event.target)) {
      if (event.key.toLowerCase() === 'i') {
        dispatch({ type: 'set-review-mode', reviewMode: 'interact' });
        return;
      }
      if (event.key.toLowerCase() === 'c') {
        dispatch({ type: 'set-review-mode', reviewMode: 'comment' });
        return;
      }
      if (event.key === 'Escape' && state.railOpen) {
        dispatch({ type: 'set-rail-open', railOpen: false });
        document.querySelector('[data-planr-action="feedback"]')?.focus();
        return;
      }
    }

    const tab = event.target.closest?.('[role="tab"][data-artifact-id]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll('[role="tab"][data-artifact-id]')];
    const index = tabs.indexOf(tab);
    if (index < 0) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setActiveFromTab(tabs[nextIndex], { focus: true });
  }

  function emitSelection(layer, start, end = start) {
    if (state.reviewMode !== 'comment' || state.status !== 'ready') return;
    const artifactId = layer.dataset.planrAnnotationLayer;
    if (!visibleArtifactIds(state).includes(artifactId)) return;
    const artifact = stageArtifactById(state, artifactId);
    if (!artifact) return;
    const region = clientSelectionToNormalized(layer.getBoundingClientRect(), start, end);
    const measured = state.presentation === 'document' ? documentLayouts.get(artifactId) : null;
    const detail = Object.freeze({
      schemaVersion: '1.0.0',
      artifactId,
      region,
      viewport: measured ?? artifact.viewport,
    });
    emit(root, window, ARTIFACT_STAGE_EVENTS.region, detail);
    emit(root, window, ARTIFACT_STAGE_EVENTS.point, detail);
  }

  for (const layer of document.querySelectorAll('[data-planr-annotation-layer]')) {
    let selection = null;
    let selectionPreview = null;
    listen(layer, 'pointerdown', (event) => {
      if (event.button !== 0 || state.reviewMode !== 'comment' || state.status !== 'ready') return;
      if (event.target !== layer) return;
      event.preventDefault();
      selection = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY } };
      layer.setPointerCapture?.(event.pointerId);
      selectionPreview = document.createElement('span');
      selectionPreview.className = 'planr-region-selection';
      selectionPreview.setAttribute('aria-hidden', 'true');
      layer.append(selectionPreview);
    });
    listen(layer, 'pointermove', (event) => {
      if (!selection || selection.pointerId !== event.pointerId || !selectionPreview) return;
      const region = clientSelectionToNormalized(
        layer.getBoundingClientRect(),
        selection.start,
        { x: event.clientX, y: event.clientY },
      );
      selectionPreview.style.left = `${region.x * 100}%`;
      selectionPreview.style.top = `${region.y * 100}%`;
      selectionPreview.style.width = `${region.w * 100}%`;
      selectionPreview.style.height = `${region.h * 100}%`;
    });
    listen(layer, 'pointercancel', (event) => {
      if (!selection || selection.pointerId !== event.pointerId) return;
      layer.releasePointerCapture?.(event.pointerId);
      selection = null;
      selectionPreview?.remove();
      selectionPreview = null;
    });
    listen(layer, 'pointerup', (event) => {
      if (!selection || selection.pointerId !== event.pointerId) return;
      const start = selection.start;
      layer.releasePointerCapture?.(event.pointerId);
      selection = null;
      selectionPreview?.remove();
      selectionPreview = null;
      emitSelection(layer, start, { x: event.clientX, y: event.clientY });
    });
    listen(layer, 'keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      if (event.target !== layer) return;
      event.preventDefault();
      const bounds = layer.getBoundingClientRect();
      emitSelection(layer, { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
    });
  }
  for (const [artifactId, frame] of frames) {
    listen(frame, ARTIFACT_STAGE_EVENTS.layout, (event) => {
      if (state.presentation !== 'document') return;
      const width = event.detail?.width;
      const height = event.detail?.height;
      if (!Number.isInteger(width) || !Number.isInteger(height)
        || width < 1 || width > ARTIFACT_STAGE_LIMITS.maxDocumentWidth
        || height < 1 || height > ARTIFACT_STAGE_LIMITS.maxDocumentHeight) return;
      const layout = Object.freeze({ width, height });
      documentLayouts.set(artifactId, layout);
      const panel = panels.get(artifactId);
      if (!panel) return;
      panel.dataset.planrLayoutMeasured = 'true';
      panel.style.setProperty('--planr-document-width', `${width}px`);
      panel.style.setProperty('--planr-document-height', `${height}px`);
    });
  }
  listen(root, 'click', onClick);
  listen(document, 'keydown', onKeyDown);

  render();

  let readyPromise = Promise.resolve(state);
  let feedbackController = null;
  let annotationController = null;
  let shareController = null;
  let hostedController = null;
  const controller = Object.freeze({
    getState: () => state,
    getFrame: (artifactId) => frames.get(artifactId) ?? null,
    getPanel: (artifactId) => panels.get(artifactId) ?? null,
    get review() {
      return feedbackController;
    },
    get annotations() {
      return annotationController;
    },
    get share() {
      return shareController;
    },
    get hosted() {
      return hostedController;
    },
    get ready() {
      return readyPromise;
    },
    dispatch,
    destroy() {
      for (const remove of cleanup.splice(0)) remove();
    },
  });
  window.__openPlanrArtifactStage = controller;

  feedbackController = mountArtifactFeedbackRail({
    document,
    window,
    root,
    stageController: controller,
    reviewOf: reviewConfig?.reviewOf,
    initialReview: reviewConfig?.review ?? null,
    artifacts: state.artifacts,
    ...reviewOptions,
  });
  annotationController = mountArtifactAnnotations({
    document,
    window,
    root,
    stageController: controller,
    reviewController: feedbackController,
  });
  shareController = mountArtifactShareDialog({
    document,
    window,
    root,
    stageController: controller,
    ...shareOptions,
  });
  hostedController = mountHostedArtifactViewer({
    document,
    window,
    ...hostedOptions,
  });
  if (feedbackController?.destroy) cleanup.push(() => feedbackController.destroy());
  if (annotationController?.destroy) cleanup.push(() => annotationController.destroy());
  if (shareController?.destroy) cleanup.push(() => shareController.destroy());
  if (hostedController?.destroy) cleanup.push(() => hostedController.destroy());

  async function assignArtifactSource(artifact) {
    const frame = frames.get(artifact.id);
    if (!frame) throw new Error(`Missing artifact frame: ${artifact.id}`);
    const source = await resolveArtifactSource(artifact, {
      frame,
      getState: () => state,
    });
    if (typeof window.TextDecoder !== 'function') {
      const error = new Error('UTF-8 decoding support is required for artifact sources.');
      error.code = 'E_ARTIFACT_BROWSER_UNSUPPORTED';
      throw error;
    }
    const html = await htmlForSource(window, source);
    if (!html) {
      throw new TypeError(
        `Artifact source resolver must return HTML bytes or a Blob for ${artifact.id}.`,
      );
    }

    const loaded = new Promise((resolve, reject) => {
      frame.addEventListener('load', resolve, { once: true });
      frame.addEventListener('error', () => reject(new Error(`Artifact frame failed: ${artifact.id}`)), { once: true });
    });
    if (typeof bridgeClient?.attach === 'function') {
      const detach = bridgeClient.attach({
        artifact,
        frame,
        getState: () => state,
      });
      if (typeof detach === 'function') cleanup.push(detach);
    }
    frame.dataset.planrArtifactDigest = artifact.sha256;
    if (typeof window.URL?.createObjectURL !== 'function' || typeof window.Blob !== 'function') {
      const error = new Error('Blob URL support is required for artifact sources.');
      error.code = 'E_ARTIFACT_BROWSER_UNSUPPORTED';
      throw error;
    }
    const sourceUrl = window.URL.createObjectURL(new window.Blob([html], {
      type: 'text/html;charset=utf-8',
    }));
    cleanup.push(() => window.URL.revokeObjectURL(sourceUrl));
    frame.removeAttribute('srcdoc');
    frame.src = sourceUrl;
    await loaded;
  }

  if (state.status === 'ready' && state.artifacts.length > 0) {
    if (typeof resolveArtifactSource !== 'function') {
      state = reduceArtifactStageState(state, { type: 'set-status', status: 'loading' });
      render();
      readyPromise = Promise.resolve(state);
    } else {
      state = reduceArtifactStageState(state, { type: 'set-status', status: 'loading' });
      render();
      readyPromise = Promise.all(state.artifacts.map(assignArtifactSource))
        .then(() => {
          state = reduceArtifactStageState(state, { type: 'set-status', status: 'ready' });
          render({ announce: true });
          return state;
        })
        .catch((error) => {
          const status = error?.code === 'E_ARTIFACT_BROWSER_UNSUPPORTED'
            ? 'unsupported-browser'
            : 'invalid';
          state = reduceArtifactStageState(state, { type: 'set-status', status });
          render({ announce: true });
          return state;
        });
    }
  }
  return controller;
}

export function bootstrapArtifactStage(document = globalThis.document, options = {}) {
  return mountArtifactStage({ ...options, document, window: document?.defaultView });
}

if (typeof document !== 'undefined') {
  const options = globalThis.__OPENPLANR_ARTIFACT_STAGE_OPTIONS__ ?? {};
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => bootstrapArtifactStage(document, options), { once: true });
  } else {
    queueMicrotask(() => bootstrapArtifactStage(document, options));
  }
}
