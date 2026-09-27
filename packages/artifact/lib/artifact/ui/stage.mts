/**
 * Artifact review stage: loads sandboxed artifact frames, reduces view, review-mode, zoom, rail and
 * theme state, and mounts the feedback rail, annotations, share dialog and hosted viewer.
 * Entry points: `mountArtifactStage` (also run on load), `reduceArtifactStageState`.
 * Hosts inject artifact sources and the frame bridge via `__OPENPLANR_ARTIFACT_STAGE_OPTIONS__`.
 */

import { clientSelectionToNormalized, mountArtifactAnnotations } from './annotations.mjs';
import { type ArtifactReviewInput, mountArtifactFeedbackRail } from './feedback-rail.mjs';
import { mountHostedArtifactViewer } from './hosted-viewer.mjs';
import { mountArtifactShareDialog } from './share-dialog.mjs';
import { publishArtifactStage } from './stage-mount.mjs';

export { createArtifactStagePayload } from './stage-payload.mjs';

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

/** A stage artifact's metadata, as the stage payload embeds it. */
interface StageArtifact {
  id: string;
  title: string;
  sha256: string;
  viewport: { width: number; height: number };
  colorScheme: string;
}
/** The stage state: its artifacts, the view and review modes, zoom, rail, theme and status. */
export interface ArtifactStageState {
  readonly schemaVersion: '1.0.0';
  readonly artifacts: readonly StageArtifact[];
  readonly activeArtifactId: string;
  readonly comparisonArtifactId: string;
  readonly viewMode: string;
  readonly presentation: string;
  readonly reviewMode: string;
  readonly zoom: number;
  readonly railOpen: boolean;
  readonly theme: string;
  readonly status: string;
}
/** A stage action; the reducer validates every value it reads. */
export type ArtifactStageAction =
  | { type: 'set-active' | 'set-comparison'; artifactId?: string }
  | { type: 'set-view-mode'; viewMode?: unknown }
  | { type: 'set-review-mode'; reviewMode?: unknown }
  | { type: 'set-zoom'; zoom?: unknown }
  | { type: 'zoom-by'; delta?: unknown }
  | { type: 'set-rail-open'; railOpen?: unknown }
  | { type: 'toggle-rail' | 'cycle-theme' }
  | { type: 'set-theme'; theme?: unknown }
  | { type: 'set-status'; status?: unknown };
/** An empty action, which leaves the state unchanged. */
type NoAction = Record<string, never>;
type RequestedArtifact = string | { id?: unknown } | null | undefined;
/** The embedded stage payload, before the stage validates it. */
interface StagePayloadInput {
  artifacts?: unknown;
  viewer?: { activeArtifactId?: RequestedArtifact; mode?: unknown; presentation?: unknown } | null;
}
/** The embedded shell model fields the stage state starts from. */
interface ShellModelInput {
  activeArtifact?: RequestedArtifact;
  activeArtifactId?: RequestedArtifact;
  comparisonArtifact?: RequestedArtifact;
  comparisonArtifactId?: RequestedArtifact;
  status?: unknown;
  viewMode?: unknown;
  presentation?: unknown;
  reviewMode?: unknown;
  zoom?: unknown;
  railOpen?: unknown;
  theme?: unknown;
}
type StatusCopyTable = Readonly<Record<string, Readonly<{ title: string; detail: string }>>>;
/** An element's client bounds in CSS pixels. */
interface ClientBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}
/** A pointer position; `x` and `y` take precedence over an event's `clientX` and `clientY`. */
interface ClientPoint {
  x?: number;
  y?: number;
  clientX?: number;
  clientY?: number;
}
type StageWindow = Window & typeof globalThis;
/** A host's source object that carries the artifact HTML. */
type HtmlSource = { html?: string };
/** An artifact frame, matched by its `data-planr-artifact-frame`; the bridge attaches to it. */
type StageFrame = HTMLIFrameElement & {
  __openPlanrBridge?: unknown;
  dataset: { planrArtifactFrame: string };
};
/** An artifact panel, matched by its `data-artifact-id`. */
type ArtifactPanel = HTMLElement & { dataset: { artifactId: string } };
/** An error with the code the stage maps to the unsupported-browser status. */
type Coded = Error & { code?: string };
type FeedbackRail = ReturnType<typeof mountArtifactFeedbackRail>;
type Annotations = NonNullable<ReturnType<typeof mountArtifactAnnotations>>;
/** An annotation layer, matched by its `data-planr-annotation-layer`. */
type LayerElement = HTMLElement & { dataset: { planrAnnotationLayer: string } };
/** A frame's measured document layout, which the bridge validates before it dispatches. */
type LayoutEvent = CustomEvent<{ width: number; height: number }>;
type ShareDialog = NonNullable<ReturnType<typeof mountArtifactShareDialog>>;
type HostedViewer = NonNullable<ReturnType<typeof mountHostedArtifactViewer>>;
/** Resolves an artifact's HTML: text, an object with `html`, a Blob or bytes. */
type ResolveArtifactSource = (
  artifact: StageArtifact,
  context: { frame: StageFrame; getState(): ArtifactStageState; signal: AbortSignal | undefined },
) => unknown;
/** A bridge client attaches to a frame and may return a detach function. */
interface StageBridgeClient {
  attach?(context: {
    artifact: StageArtifact;
    frame: StageFrame;
    getState(): ArtifactStageState;
  }): (() => void) | void;
}
/** One frame's load: its promise, settle functions, abort signal and last use. */
interface FrameLoad {
  status: string;
  used: number;
  cancelled: boolean;
  abort: { signal: AbortSignal | undefined; abort(): void };
  promise: Promise<string>;
  resolve(artifactId: string): void;
  reject(reason: unknown): void;
  unlisten(): void;
  detach?(): void;
  requireTrust?: boolean;
  sourceUrl?: string;
}
/** The embedded review state: the artifact digest and any saved review. */
interface ReviewConfig {
  reviewOf?: string;
  review?: ArtifactReviewInput | null;
}
/** Stage options: the host's source resolver and bridge, and the review, share and hosted options. */
interface StageOptions {
  document?: Document;
  window?: StageWindow;
  resolveArtifactSource?: ResolveArtifactSource;
  sourceTransport?: string;
  bridgeClient?: StageBridgeClient | null;
  onState?: (state: ArtifactStageState) => void;
  review?: Parameters<typeof mountArtifactFeedbackRail>[0];
  share?: Parameters<typeof mountArtifactShareDialog>[0];
  hosted?: Parameters<typeof mountHostedArtifactViewer>[0];
}
type StageGlobal = typeof globalThis & { __OPENPLANR_ARTIFACT_STAGE_OPTIONS__?: StageOptions };
/** An event whose target is an element. */
type TargetedEvent<E extends Event> = E & { target: Element };

const STATUS_COPY: StatusCopyTable = Object.freeze({
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

function member<T>(value: unknown, allowed: readonly T[], fallback: T) {
  // includes accepts only its element type and does not narrow; a listed value is a member.
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function finite(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalized(value: unknown) {
  return Math.round(clamp(finite(value), 0, 1) * 1_000_000) / 1_000_000;
}

function artifactMetadata(artifact: StageArtifact) {
  return Object.freeze({
    id: artifact.id,
    title: artifact.title,
    sha256: artifact.sha256,
    viewport: artifact.viewport,
    colorScheme: artifact.colorScheme,
  });
}

function requestedArtifactId(value: RequestedArtifact) {
  if (typeof value === 'string') return value;
  return typeof value?.id === 'string' ? value.id : '';
}

function availableId<R extends string | undefined>(
  artifacts: readonly StageArtifact[],
  requested: R,
  fallback = '',
) {
  return artifacts.some(({ id }) => id === requested) ? requested : fallback;
}

function comparisonIdFor(
  artifacts: readonly StageArtifact[],
  activeArtifactId: string,
  requested: string | undefined = '',
) {
  if (requested !== activeArtifactId && artifacts.some(({ id }) => id === requested))
    return requested;
  return artifacts.find(({ id }) => id !== activeArtifactId)?.id ?? '';
}

function normalizeViewMode(value: unknown, artifactCount: number) {
  if (artifactCount < 2) return 'single';
  return member(value, VIEW_MODES, 'variants');
}

export function resolveArtifactPresentation(
  value: unknown,
  { viewMode = 'single', artifactCount = 1 }: { viewMode?: string; artifactCount?: number } = {},
) {
  // includes accepts only its element type; a listed value is a presentation.
  if (PRESENTATIONS.includes(value as string)) return value as string;
  return artifactCount > 1 || viewMode === 'variants' || viewMode === 'split'
    ? 'canvas'
    : 'document';
}

export function createArtifactStageState(
  payload: StagePayloadInput | null = {},
  shellModel: ShellModelInput = {},
): ArtifactStageState {
  const artifacts = Object.freeze(
    (Array.isArray(payload?.artifacts) ? payload.artifacts : []).map(artifactMetadata),
  );
  const firstId = artifacts[0]?.id ?? '';
  const activeArtifactId = availableId(
    artifacts,
    requestedArtifactId(shellModel.activeArtifact ?? shellModel.activeArtifactId) ||
      requestedArtifactId(payload?.viewer?.activeArtifactId),
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
  // Number.isInteger does not narrow its argument to a number.
  return Object.freeze({
    schemaVersion: '1.0.0',
    artifacts,
    activeArtifactId,
    comparisonArtifactId,
    viewMode,
    presentation,
    reviewMode: member(shellModel.reviewMode, REVIEW_MODES, 'interact'),
    zoom: clamp(
      Number.isInteger(shellModel.zoom)
        ? (shellModel.zoom as number)
        : ARTIFACT_STAGE_LIMITS.defaultZoom,
      ARTIFACT_STAGE_LIMITS.minZoom,
      ARTIFACT_STAGE_LIMITS.maxZoom,
    ),
    railOpen:
      shellModel.railOpen === undefined ? presentation === 'canvas' : Boolean(shellModel.railOpen),
    theme: member(shellModel.theme, THEMES, 'auto'),
    status,
  });
}

function nextState(state: ArtifactStageState, changes: Partial<ArtifactStageState>) {
  return Object.freeze({ ...state, ...changes });
}

export function reduceArtifactStageState(
  state: ArtifactStageState,
  action: ArtifactStageAction | NoAction = {},
): ArtifactStageState {
  switch (action.type) {
    case 'set-active': {
      const id = availableId(state.artifacts, action.artifactId);
      if (!id || id === state.activeArtifactId) return state;
      const comparisonArtifactId =
        id === state.comparisonArtifactId
          ? state.activeArtifactId
          : comparisonIdFor(state.artifacts, id, state.comparisonArtifactId);
      return nextState(state, { activeArtifactId: id, comparisonArtifactId });
    }
    case 'set-comparison': {
      const id = comparisonIdFor(state.artifacts, state.activeArtifactId, action.artifactId);
      return id === state.comparisonArtifactId
        ? state
        : nextState(state, { comparisonArtifactId: id });
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

export function visibleArtifactIds(
  state: Pick<ArtifactStageState, 'activeArtifactId' | 'comparisonArtifactId' | 'viewMode'>,
) {
  if (!state.activeArtifactId) return Object.freeze([]);
  if (state.viewMode === 'split' && state.comparisonArtifactId) {
    return Object.freeze([state.activeArtifactId, state.comparisonArtifactId]);
  }
  return Object.freeze([state.activeArtifactId]);
}

function assertRect(rect: ClientBounds | null | undefined) {
  if (
    !rect ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    throw new RangeError('Artifact bounds must have positive finite dimensions.');
  }
}

export function clientPointToNormalized(rect: ClientBounds, point: ClientPoint) {
  assertRect(rect);
  return Object.freeze({
    x: normalized((finite(point?.x ?? point?.clientX) - rect.left) / rect.width),
    y: normalized((finite(point?.y ?? point?.clientY) - rect.top) / rect.height),
  });
}

export function normalizedPointToClient(rect: ClientBounds, point: { x?: number; y?: number }) {
  assertRect(rect);
  return Object.freeze({
    x: rect.left + normalized(point?.x) * rect.width,
    y: rect.top + normalized(point?.y) * rect.height,
  });
}

/** Parse an embedded JSON script as `T`; the stage validates what it reads. */
function parseDataScript<T>(document: Document, id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing artifact shell data: ${id}`);
  return JSON.parse(node.textContent ?? 'null');
}

function isEditableTarget(target: (EventTarget & { ownerDocument?: Document | null }) | null) {
  const HTMLElement = target?.ownerDocument?.defaultView?.HTMLElement;
  return Boolean(
    HTMLElement &&
      target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)),
  );
}

function stageArtifactById(state: ArtifactStageState, id: string) {
  return state.artifacts.find((artifact) => artifact.id === id) ?? null;
}

function updateStatus(document: Document, state: ArtifactStageState) {
  const statusPanel = document.querySelector<HTMLElement>('.planr-stage-status');
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

function emit(root: EventTarget, window: StageWindow, type: string, detail: unknown) {
  root.dispatchEvent(new window.CustomEvent(type, { detail, bubbles: true }));
}

// An object source is read for an `html` string only.
async function htmlForSource(window: StageWindow, source: unknown) {
  if (typeof source === 'string' && source.trimStart().startsWith('<')) return source;
  // biome-ignore format: bundles keep this one-line statement; wrapping would change their bytes.
  if (source && typeof source === 'object' && typeof (source as HtmlSource).html === 'string') return (source as HtmlSource).html;
  if (source instanceof window.Blob) return source.text();
  if (source instanceof window.ArrayBuffer) return new window.TextDecoder().decode(source);
  if (window.ArrayBuffer.isView(source)) {
    return new window.TextDecoder().decode(
      new window.Uint8Array(source.buffer, source.byteOffset, source.byteLength),
    );
  }
  return null;
}

// Without a DOM the window default is missing and the check below returns null; the hoisted
// functions cannot see that check, so the default is typed as present.
export function mountArtifactStage({
  document = globalThis.document,
  window = document?.defaultView as StageWindow,
  resolveArtifactSource,
  sourceTransport = 'blob',
  bridgeClient,
  onState,
  review: reviewOptions = {},
  share: shareOptions = {},
  hosted: hostedOptions = {},
}: StageOptions = {}) {
  if (!document || !window) return null;
  // The hoisted functions below cannot see the null check that follows.
  const root = document.querySelector('.planr-shell') as HTMLElement;
  if (!root) return null;
  if (!['blob', 'srcdoc'].includes(sourceTransport)) {
    throw new TypeError('Artifact source transport must be blob or srcdoc.');
  }

  let payload: StagePayloadInput;
  let shellModel: ShellModelInput;
  let reviewConfig: ReviewConfig;
  try {
    payload = parseDataScript(document, 'planr-artifact-stage-payload');
    shellModel = parseDataScript(document, 'planr-artifact-shell-model');
    reviewConfig = parseDataScript(document, 'planr-artifact-review-state');
  } catch {
    payload = { artifacts: [], viewer: { mode: 'single', activeArtifactId: '' } };
    shellModel = { status: 'invalid' };
    reviewConfig = { reviewOf: '0'.repeat(64), review: null };
  }

  let state: ArtifactStageState;
  try {
    state = createArtifactStageState(payload, shellModel);
  } catch {
    state = createArtifactStageState({}, { status: 'invalid' });
  }

  const frames = new Map<string, StageFrame>(
    [...document.querySelectorAll<StageFrame>('[data-planr-artifact-frame]')].map((frame) => [
      frame.dataset.planrArtifactFrame,
      frame,
    ]),
  );
  // biome-ignore format: bundles keep this call's layout; wrapping would change their bytes.
  const panels = new Map<string, ArtifactPanel>(
    [...document.querySelectorAll<ArtifactPanel>('.planr-artifact-panel[data-artifact-id]')].map((panel) => [
      panel.dataset.artifactId,
      panel,
    ]),
  );
  const documentLayouts = new Map<string, Readonly<{ width: number; height: number }>>();
  const cleanup: Array<() => void> = [];
  // Trusted presentation hosts may opt into a bounded set of live documents.
  // The artifact contract remains metadata-only and eager hosts are unchanged.
  const frameBudget = root.dataset.planrFrameBudget === '3' ? 3 : null;
  const frameLoads = new Map<string, FrameLoad>();
  let frameUse = 0;
  let frameQueue: Promise<unknown> = Promise.resolve();
  let disposed = false;
  for (const frame of frames.values()) frame.dataset.planrFrameState = 'unloaded';

  // addEventListener types a listener by event name, which a name passed through loses.
  function listen<E extends Event>(
    target: EventTarget,
    type: string,
    handler: (event: E) => void,
    options?: boolean | AddEventListenerOptions,
  ) {
    target.addEventListener(type, handler as EventListener, options);
    cleanup.push(() => target.removeEventListener(type, handler as EventListener, options));
  }

  function render({ announce = false }: { announce?: boolean } = {}) {
    const visible = new Set(visibleArtifactIds(state));
    root.dataset.planrView = state.viewMode;
    root.dataset.planrReviewMode = state.reviewMode;
    root.dataset.planrState = state.status;
    root.dataset.planrRailOpen = String(state.railOpen);
    root.dataset.planrPresentation = state.presentation;
    document.documentElement.dataset.planrPresentation = state.presentation;
    document.documentElement.dataset.planrTheme = state.theme;

    const grid = document.querySelector<HTMLElement>('.planr-frame-grid');
    const surface = document.querySelector<HTMLElement>('.planr-stage-surface');
    const tablist = document.querySelector<HTMLElement>('.planr-variants');
    const rail = document.getElementById('planr-review-rail');
    const feedbackButton = document.querySelector('[data-planr-action="feedback"]');
    // biome-ignore format: bundles keep this one-line call; wrapping would change their bytes.
    const addCommentButton = document.querySelector<HTMLButtonElement>('[data-planr-action="add-comment"]');
    const themeButton = document.querySelector('[data-planr-action="theme"]');
    const statusSlot = document.querySelector('[data-planr-slot="status"]');
    const metadata = document.querySelector('.planr-title-block > span');
    const breadcrumb = document.querySelector('.planr-stage-heading > span:first-child');
    const activeArtifact = stageArtifactById(state, state.activeArtifactId);

    if (grid) grid.dataset.planrLayout = state.viewMode;
    const visualOrder =
      state.viewMode === 'split'
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
    if (addCommentButton) {
      const paused = root.hasAttribute('data-planr-room-comments-paused');
      addCommentButton.disabled = paused;
      addCommentButton.setAttribute('aria-pressed', String(state.reviewMode === 'comment'));
      addCommentButton.setAttribute(
        'aria-label',
        paused ? 'Add comment unavailable: comments are paused' : 'Add comment',
      );
      addCommentButton.dataset.planrTooltip = paused ? 'Comments are paused' : 'Add comment (C)';
    }
    if (themeButton) {
      themeButton.textContent = state.theme;
      themeButton.setAttribute('aria-label', `Shell theme ${state.theme}`);
    }
    if (statusSlot)
      statusSlot.textContent =
        state.reviewMode === 'comment' ? 'Comment mode' : 'Interactions enabled';
    if (metadata && activeArtifact) {
      metadata.textContent = `HTML · ${activeArtifact.viewport.width}×${activeArtifact.viewport.height}`;
    }
    if (breadcrumb)
      breadcrumb.textContent = `ARTIFACT / ${(activeArtifact?.title ?? 'Artifact').toUpperCase()}`;

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-planr-view]')) {
      const mode = button.dataset.planrView;
      button.setAttribute('aria-pressed', String(mode === state.viewMode));
      button.disabled = state.artifacts.length < 2 && mode !== 'single';
    }
    for (const button of document.querySelectorAll<HTMLElement>('[data-planr-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.planrMode === state.reviewMode));
    }
    for (const button of document.querySelectorAll('[data-planr-action="zoom-reset"]')) {
      button.textContent = `${state.zoom}%`;
    }
    for (const tab of document.querySelectorAll<HTMLElement>('[role="tab"][data-artifact-id]')) {
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
      panel.setAttribute(
        'aria-label',
        `${isPrimary ? 'Primary' : 'Comparison'} artifact: ${artifact?.title ?? id}`,
      );
      const frame = frames.get(id);
      const frameReady = frameBudget === null || frame?.dataset.planrFrameState === 'ready';
      const annotationLayer = panel.querySelector<HTMLElement>('[data-planr-annotation-layer]');
      if (frame) {
        frame.tabIndex =
          isVisible && frameReady && state.status === 'ready' && state.reviewMode === 'interact'
            ? 0
            : -1;
        if (state.presentation === 'document') {
          // The outer review page owns natural scrolling in document mode. This
          // also suppresses scroll containers authored on the artifact root,
          // which otherwise produce a nested scrollbar inside the opaque frame.
          frame.setAttribute('scrolling', 'no');
          frame.style.overflow = 'hidden';
        } else {
          frame.removeAttribute('scrolling');
          frame.style.removeProperty('overflow');
        }
      }
      if (annotationLayer) {
        const enabled =
          isVisible && frameReady && state.status === 'ready' && state.reviewMode === 'comment';
        const hasComposer = Boolean(
          annotationLayer.querySelector('[data-planr-annotation-composer]'),
        );
        annotationLayer.tabIndex = enabled ? 0 : -1;
        annotationLayer.setAttribute('aria-disabled', String(!enabled && !hasComposer));
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

  function dispatch(action: ArtifactStageAction, { announce = true }: { announce?: boolean } = {}) {
    const previous = state;
    state = reduceArtifactStageState(state, action);
    if (state !== previous) render({ announce });
    return state;
  }

  function setActiveFromTab(tab: HTMLElement, { focus = false }: { focus?: boolean } = {}) {
    dispatch({ type: 'set-active', artifactId: tab.dataset.artifactId });
    if (focus) tab.focus();
  }

  function onClick(event: TargetedEvent<MouseEvent>) {
    const target = event.target.closest?.('button');
    if (!target) return;
    if (target.hasAttribute('data-planr-close-feedback')) {
      dispatch({ type: 'set-rail-open', railOpen: false });
      document.querySelector<HTMLElement>('[data-planr-action="feedback"]')?.focus();
      return;
    }
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
      case 'add-comment':
        if (!root.hasAttribute('data-planr-room-comments-paused')) {
          dispatch({ type: 'set-review-mode', reviewMode: 'comment' });
        }
        break;
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
      case 'more': {
        const menu = target.closest('.planr-more')?.querySelector<HTMLElement>('.planr-more-menu');
        if (!menu) break;
        const open = menu.hidden;
        menu.hidden = !open;
        target.setAttribute('aria-expanded', String(open));
        if (open) menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
        break;
      }
      case 'sharing-options':
        // The sharing-options item sits in the more menu.
        (target.closest('.planr-more-menu') as HTMLElement).hidden = true;
        document
          .querySelector('[data-planr-action="more"]')
          ?.setAttribute('aria-expanded', 'false');
        shareController?.open?.();
        break;
      case 'theme':
        dispatch({ type: 'cycle-theme' });
        break;
      default:
        break;
    }
  }

  function onKeyDown(event: TargetedEvent<KeyboardEvent>) {
    if (event.defaultPrevented) return;
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !isEditableTarget(event.target)) {
      if (event.key.toLowerCase() === 'i') {
        dispatch({ type: 'set-review-mode', reviewMode: 'interact' });
        return;
      }
      if (event.key.toLowerCase() === 'c') {
        if (!root.hasAttribute('data-planr-room-comments-paused')) {
          dispatch({ type: 'set-review-mode', reviewMode: 'comment' });
          document.querySelector<HTMLElement>('[data-planr-action="add-comment"]')?.focus();
        }
        return;
      }
      if (event.key === 'Escape') {
        const more = document.querySelector<HTMLElement>('.planr-more-menu:not([hidden])');
        if (more) {
          more.hidden = true;
          const trigger = document.querySelector<HTMLElement>('[data-planr-action="more"]');
          trigger?.setAttribute('aria-expanded', 'false');
          trigger?.focus();
          return;
        }
        if (state.presentation === 'document' && state.reviewMode === 'comment') {
          dispatch({ type: 'set-review-mode', reviewMode: 'interact' });
          document.querySelector<HTMLElement>('[data-planr-action="add-comment"]')?.focus();
          return;
        }
        if (state.railOpen) {
          dispatch({ type: 'set-rail-open', railOpen: false });
          document.querySelector<HTMLElement>('[data-planr-action="feedback"]')?.focus();
          return;
        }
      }
    }

    const tab = event.target.closest?.<HTMLElement>('[role="tab"][data-artifact-id]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"][data-artifact-id]')];
    const index = tabs.indexOf(tab);
    if (index < 0) return;
    event.preventDefault();
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setActiveFromTab(tabs[nextIndex], { focus: true });
  }

  function emitSelection(layer: LayerElement, start: ClientPoint, end: ClientPoint = start) {
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
    if (state.presentation === 'document') {
      dispatch({ type: 'set-review-mode', reviewMode: 'interact' });
    }
  }

  for (const layer of document.querySelectorAll<LayerElement>('[data-planr-annotation-layer]')) {
    let selection: { pointerId: number; start: { x: number; y: number } } | null = null;
    let selectionPreview: HTMLSpanElement | null = null;
    listen(layer, 'pointerdown', (event: PointerEvent) => {
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
    listen(layer, 'pointermove', (event: PointerEvent) => {
      if (!selection || selection.pointerId !== event.pointerId || !selectionPreview) return;
      const region = clientSelectionToNormalized(layer.getBoundingClientRect(), selection.start, {
        x: event.clientX,
        y: event.clientY,
      });
      selectionPreview.style.left = `${region.x * 100}%`;
      selectionPreview.style.top = `${region.y * 100}%`;
      selectionPreview.style.width = `${region.w * 100}%`;
      selectionPreview.style.height = `${region.h * 100}%`;
    });
    listen(layer, 'pointercancel', (event: PointerEvent) => {
      if (!selection || selection.pointerId !== event.pointerId) return;
      layer.releasePointerCapture?.(event.pointerId);
      selection = null;
      selectionPreview?.remove();
      selectionPreview = null;
    });
    listen(layer, 'pointerup', (event: PointerEvent) => {
      if (!selection || selection.pointerId !== event.pointerId) return;
      const start = selection.start;
      layer.releasePointerCapture?.(event.pointerId);
      selection = null;
      selectionPreview?.remove();
      selectionPreview = null;
      emitSelection(layer, start, { x: event.clientX, y: event.clientY });
    });
    listen(layer, 'keydown', (event: KeyboardEvent) => {
      if (!['Enter', ' '].includes(event.key)) return;
      if (event.target !== layer) return;
      event.preventDefault();
      const bounds = layer.getBoundingClientRect();
      emitSelection(layer, {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      });
    });
  }
  for (const [artifactId, frame] of frames) {
    listen(frame, ARTIFACT_STAGE_EVENTS.layout, (event: LayoutEvent) => {
      if (state.presentation !== 'document') return;
      const width = event.detail?.width;
      const height = event.detail?.height;
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        width > ARTIFACT_STAGE_LIMITS.maxDocumentWidth ||
        height < 1 ||
        height > ARTIFACT_STAGE_LIMITS.maxDocumentHeight
      )
        return;
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
  listen(document, 'click', (event: TargetedEvent<MouseEvent>) => {
    const more = document.querySelector<HTMLElement>('.planr-more-menu:not([hidden])');
    if (!more || event.target.closest?.('.planr-more')) return;
    more.hidden = true;
    document.querySelector('[data-planr-action="more"]')?.setAttribute('aria-expanded', 'false');
  });
  const roomStateObserver =
    typeof window.MutationObserver === 'function'
      ? new window.MutationObserver(() => {
          if (
            root.hasAttribute('data-planr-room-comments-paused') &&
            state.reviewMode === 'comment'
          ) {
            dispatch({ type: 'set-review-mode', reviewMode: 'interact' });
          } else {
            render();
          }
        })
      : null;
  roomStateObserver?.observe(root, {
    attributes: true,
    attributeFilter: ['data-planr-room-comments-paused'],
  });
  if (roomStateObserver) cleanup.push(() => roomStateObserver.disconnect());

  render();

  let readyPromise = Promise.resolve(state);
  let feedbackController: FeedbackRail | null = null;
  let annotationController: Annotations | null = null;
  let shareController: ShareDialog | null = null;
  let hostedController: HostedViewer | null = null;
  const controller = Object.freeze({
    frameBudget,
    ensureFrames,
    getLoadedArtifactIds: () =>
      [...frameLoads].filter(([, record]) => record.status === 'ready').map(([id]) => id),
    getState: () => state,
    getFrame: (artifactId: string) => frames.get(artifactId) ?? null,
    getPanel: (artifactId: string) => panels.get(artifactId) ?? null,
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
      // Only a mounted share dialog reports a creating or ambiguous phase.
      if (['creating', 'ambiguous'].includes(shareController?.getState?.().phase as string)) {
        (shareController as ShareDialog).destroy?.();
        return false;
      }
      disposed = true;
      for (const id of [...frameLoads.keys()]) releaseFrame(id);
      for (const remove of cleanup.splice(0)) remove();
      return true;
    },
  });
  publishArtifactStage(window, controller);

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

  function cancelledFrame() {
    const error = new Error('Artifact frame loading was cancelled.');
    error.name = 'AbortError';
    return error;
  }

  function frameStatus(artifactId: string, status: string) {
    const frame = frames.get(artifactId);
    if (frame) frame.dataset.planrFrameState = status;
    if (!disposed) emit(root, window, 'planr:artifact-frame-state', { artifactId, status });
  }

  function releaseFrame(
    artifactId: string,
    { status = 'unloaded', error = cancelledFrame() }: { status?: string; error?: unknown } = {},
  ) {
    const record = frameLoads.get(artifactId);
    if (!record) return;
    frameLoads.delete(artifactId);
    record.cancelled = true;
    record.abort.abort();
    record.unlisten?.();
    record.detach?.();
    record.reject(error);
    // A frame load exists only for a known frame.
    const frame = frames.get(artifactId) as StageFrame;
    // Detach before navigating the old frame, so its bridge cannot recover the
    // intentionally retired document or authenticate a subsequent document.
    frame.removeAttribute('srcdoc');
    frame.removeAttribute('src');
    delete frame.dataset.planrArtifactDigest;
    delete frame.dataset.planrBridgeTrusted;
    try {
      delete frame.__openPlanrBridge;
    } catch {
      /* Host-owned configurable bridge. */
    }
    if (record.sourceUrl) window.URL.revokeObjectURL(record.sourceUrl);
    documentLayouts.delete(artifactId);
    const panel = panels.get(artifactId);
    if (panel) {
      delete panel.dataset.planrLayoutMeasured;
      panel.style.removeProperty('--planr-document-width');
      panel.style.removeProperty('--planr-document-height');
    }
    frameStatus(artifactId, status);
  }

  function assignArtifactSource(artifact: StageArtifact) {
    if (disposed) return Promise.reject(cancelledFrame());
    const existing = frameLoads.get(artifact.id);
    if (existing) {
      if (
        existing.status === 'ready' &&
        existing.requireTrust &&
        frames.get(artifact.id)?.dataset.planrBridgeTrusted !== 'true'
      ) {
        // A previously loaded document may have attempted navigation. Demanding
        // it again must authenticate a clean source, not reuse its old readiness.
        releaseFrame(artifact.id);
      } else {
        existing.used = ++frameUse;
        return existing.promise;
      }
    }
    const frame = frames.get(artifact.id);
    if (!frame) return Promise.reject(new Error(`Missing artifact frame: ${artifact.id}`));
    // The promise, its settle functions and unlisten are attached next.
    const record = {
      status: 'loading',
      used: ++frameUse,
      cancelled: false,
      abort:
        typeof window.AbortController === 'function'
          ? new window.AbortController()
          : { signal: undefined, abort() {} },
    } as FrameLoad;
    record.promise = new Promise((resolve, reject) => {
      record.resolve = resolve;
      record.reject = reject;
    });
    frameLoads.set(artifact.id, record);
    const current = () => !disposed && !record.cancelled && frameLoads.get(artifact.id) === record;
    const fail = (error: unknown) => {
      if (current()) releaseFrame(artifact.id, { status: 'error', error });
    };
    const timer =
      frameBudget === null
        ? null
        : window.setTimeout(
            () => fail(new Error(`Artifact frame did not finish loading: ${artifact.id}`)),
            15000,
          );
    let loaded = false;
    const ready = () => {
      if (
        !current() ||
        !loaded ||
        (record.requireTrust && frame.dataset.planrBridgeTrusted !== 'true')
      )
        return;
      record.status = 'ready';
      record.unlisten();
      frameStatus(artifact.id, 'ready');
      record.resolve(artifact.id);
    };
    const onLoad = () => {
      loaded = true;
      ready();
    };
    const onError = () => fail(new Error(`Artifact frame failed: ${artifact.id}`));
    // clearTimeout ignores the null timer of an unbudgeted stage.
    record.unlisten = () => {
      window.clearTimeout(timer as number);
      frame.removeEventListener('load', onLoad);
      frame.removeEventListener('error', onError);
      frame.removeEventListener('planr:artifact-bridge-ready', ready);
    };
    frameStatus(artifact.id, 'loading');
    if (!current()) return record.promise;
    // Source preparation can be asynchronous; it cannot revive an evicted frame.
    // Frames load only after the stage checked that resolveArtifactSource is a function.
    void (async () => {
      const source = await (resolveArtifactSource as ResolveArtifactSource)(artifact, {
        frame,
        getState: () => state,
        signal: record.abort.signal,
      });
      if (!current()) return;
      if (typeof window.TextDecoder !== 'function') {
        const error: Coded = new Error('UTF-8 decoding support is required for artifact sources.');
        error.code = 'E_ARTIFACT_BROWSER_UNSUPPORTED';
        throw error;
      }
      const html = await htmlForSource(window, source);
      if (!current()) return;
      if (!html) {
        throw new TypeError(
          `Artifact source resolver must return HTML bytes or a Blob for ${artifact.id}.`,
        );
      }

      if (typeof bridgeClient?.attach === 'function') {
        const detach = bridgeClient.attach({
          artifact,
          frame,
          getState: () => state,
        });
        if (typeof detach === 'function') record.detach = detach;
        record.requireTrust = frameBudget !== null;
      }
      // Bridge load handlers quarantine each navigation before we check trust.
      frame.addEventListener('load', onLoad);
      frame.addEventListener('error', onError);
      frame.addEventListener('planr:artifact-bridge-ready', ready);
      frame.dataset.planrArtifactDigest = artifact.sha256;
      if (sourceTransport === 'srcdoc') {
        // Trusted hosts may choose srcdoc to avoid WebKit applying inherited
        // frame-ancestors rules to blob navigations. The existing opaque sandbox
        // and the prepared document's CSP remain unchanged for either transport.
        frame.removeAttribute('src');
        frame.srcdoc = html;
      } else {
        if (
          typeof window.URL?.createObjectURL !== 'function' ||
          typeof window.Blob !== 'function'
        ) {
          const error: Coded = new Error('Blob URL support is required for artifact sources.');
          error.code = 'E_ARTIFACT_BROWSER_UNSUPPORTED';
          throw error;
        }
        const sourceUrl = window.URL.createObjectURL(
          new window.Blob([html], {
            type: 'text/html;charset=utf-8',
          }),
        );
        record.sourceUrl = sourceUrl;
        frame.removeAttribute('srcdoc');
        frame.src = sourceUrl;
      }
    })().catch(fail);
    return record.promise;
  }

  function ensureFrames(artifactIds: readonly string[]) {
    if (disposed) return Promise.reject(cancelledFrame());
    if (
      !Array.isArray(artifactIds) ||
      artifactIds.some((id) => typeof id !== 'string' || !frames.has(id))
    ) {
      return Promise.reject(new TypeError('Requested artifact frames must be known artifact IDs.'));
    }
    const requested = [...new Set(artifactIds)];
    if (frameBudget !== null && requested.length > frameBudget) {
      return Promise.reject(
        new RangeError(`At most ${frameBudget} artifact frames may be requested together.`),
      );
    }
    // Every requested id names a known frame, and every frame has its artifact.
    // biome-ignore format: bundles keep this one-line call; wrapping would change their bytes.
    if (frameBudget === null)
      return Promise.all(requested.map((id) => assignArtifactSource(stageArtifactById(state, id) as StageArtifact)));
    const run = async () => {
      if (disposed) throw cancelledFrame();
      for (const id of requested) {
        if (disposed) throw cancelledFrame();
        if (!frameLoads.has(id)) {
          while (frameLoads.size >= frameBudget) {
            const candidates = [...frameLoads]
              .filter(([loadedId]) => !requested.includes(loadedId))
              .sort((a, b) => a[1].used - b[1].used);
            if (!candidates.length) throw new Error('The artifact frame budget is exhausted.');
            releaseFrame(candidates[0][0]);
          }
        }
        await assignArtifactSource(stageArtifactById(state, id) as StageArtifact);
      }
      return requested;
    };
    const result = frameQueue.then(run);
    frameQueue = result.catch(() => {});
    return result;
  }

  if (state.status === 'ready' && state.artifacts.length > 0) {
    if (typeof resolveArtifactSource !== 'function') {
      state = reduceArtifactStageState(state, { type: 'set-status', status: 'loading' });
      render();
      readyPromise = Promise.resolve(state);
    } else {
      state = reduceArtifactStageState(state, { type: 'set-status', status: 'loading' });
      render();
      readyPromise = (
        frameBudget === null
          ? Promise.all(state.artifacts.map(assignArtifactSource))
          : ensureFrames([state.activeArtifactId])
      )
        .then(() => {
          if (disposed) return state;
          state = reduceArtifactStageState(state, { type: 'set-status', status: 'ready' });
          render({ announce: true });
          return state;
        })
        .catch((error) => {
          if (disposed) return state;
          const status =
            error?.code === 'E_ARTIFACT_BROWSER_UNSUPPORTED' ? 'unsupported-browser' : 'invalid';
          state = reduceArtifactStageState(state, { type: 'set-status', status });
          render({ announce: true });
          return state;
        });
    }
  }
  return controller;
}

// Without a DOM the window is missing and the mount returns null.
export function bootstrapArtifactStage(document = globalThis.document, options: StageOptions = {}) {
  return mountArtifactStage({ ...options, document, window: document?.defaultView as StageWindow });
}

if (typeof document !== 'undefined') {
  const options = (globalThis as StageGlobal).__OPENPLANR_ARTIFACT_STAGE_OPTIONS__ ?? {};
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => bootstrapArtifactStage(document, options), {
      once: true,
    });
  } else {
    queueMicrotask(() => bootstrapArtifactStage(document, options));
  }
}
