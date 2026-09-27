/**
 * Artifact comment annotations: turns pointer selections into normalized regions, anchors them to
 * elements through the frame bridge, and renders the pin markers and the new-comment composer.
 * Entry points: `mountArtifactAnnotations`, `clientSelectionToNormalized`, `annotationDomIds`.
 * Review state stays in the injected `feedback-rail.mjs` controller; new pins go through `add-pin`.
 */

import type {
  ArtifactReviewAnchor,
  ArtifactReviewPin,
  ArtifactReviewRegion,
  ArtifactReviewViewport,
} from './feedback-rail.mjs';

export const ARTIFACT_ANNOTATION_EVENTS = Object.freeze({
  draft: 'planr:artifact-annotation-draft',
  focus: 'planr:artifact-annotation-focus',
});

export const ARTIFACT_ANNOTATION_LIMITS = Object.freeze({
  dragThreshold: 4,
  maxCommentLength: 65_536,
  maxIdentityLength: 256,
});

const INTENTS = Object.freeze(['fix', 'improve', 'question']);

type Anchor = ArtifactReviewAnchor;
type Region = ArtifactReviewRegion;
type Viewport = ArtifactReviewViewport;
type Draft = ArtifactAnnotationDraft;
type ComposerTarget = ArtifactAnnotationTarget;
type DraftSnapshot = ArtifactAnnotationDraftSnapshot;
type CloseOptions = ArtifactAnnotationCloseOptions;
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
/** An anchor element's bounds in artifact viewport pixels. */
interface AnchorRect {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}
/** The element under a point, as the frame bridge reports it. */
interface HitAnchor {
  planrId?: unknown;
  screen?: unknown;
  rect?: AnchorRect;
}
/** An anchor resolved to its current bounds in the frame. */
interface ResolvedAnchor {
  rect: { x?: number; y?: number; width: number; height: number };
  viewport?: Viewport;
}
/** The frame bridge the annotations resolve anchors through. */
interface AnnotationBridge {
  resolve(planrId: string, screen?: string): PromiseLike<ResolvedAnchor | null>;
  hitTest?(x: number, y: number): PromiseLike<HitAnchor | null> | HitAnchor | null;
}
type BridgeFrame = HTMLIFrameElement & { __openPlanrBridge?: AnnotationBridge };
/** A pin's marker, optional region outline and anchor request state. */
interface PinRecord {
  button: HTMLButtonElement;
  region: HTMLSpanElement | null;
  pin: ArtifactReviewPin;
  geometryKey: string | null;
  pending: object | null;
  requestedAt: number;
}
/** A comment being composed; resolving its anchor rewrites the region relative to it. */
export interface ArtifactAnnotationDraft {
  artifactId: string;
  region: Readonly<Region>;
  viewport: Readonly<Viewport>;
  variant: string;
  anchor: Readonly<Anchor> | null;
  displayRegion: Readonly<Region>;
}
/** Where a new comment points: a stage region selection or a restored draft. */
export interface ArtifactAnnotationTarget {
  artifactId: string;
  region: Region;
  viewport: Viewport;
  variant?: unknown;
}
/** A suspended composer: its target, fields and caret, for the review it was written against. */
export type ArtifactAnnotationDraftSnapshot = Readonly<
  ArtifactAnnotationDraft & {
    reviewOf: string | null;
    identity: string;
    fields: Record<string, string>;
    comment: string;
    intent: string;
    selectionStart: number | null;
    selectionEnd: number | null;
    selectionDirection: 'forward' | 'backward' | 'none';
  }
>;
/** A host field in the composer whose value a snapshot keeps under its draft key. */
type DraftField = HTMLElement & { value?: unknown; dataset: { planrDraftKey: string } };
/** An element that may take focus. */
type FocusTarget = Element & { focus?(options?: FocusOptions): void };
/** The add-pin action the composer dispatches; the review controller adds the author. */
interface AddPinAction {
  type: 'add-pin';
  pin: {
    artifactId: string;
    region: Readonly<Region>;
    viewport: Readonly<Viewport>;
    variant: string;
    anchor?: Readonly<Anchor>;
    intent: string | undefined;
    comment: string;
  };
}
/** A review as the annotations read it. */
interface AnnotationReview {
  reviewOf?: string;
  pins?: readonly ArtifactReviewPin[];
}
/** A review state that carries the review, or is the review itself. */
type AnnotationReviewState = AnnotationReview & { review?: AnnotationReview | null };
/** The review controller the annotations read pins from and add pins through. */
interface AnnotationReviewController {
  getReview?(): AnnotationReview | null;
  getState?(): AnnotationReviewState | null;
  getReviewOf?(): string | null | undefined;
  getIdentity?(): { name?: unknown } | null;
  setIdentity?(identity: { name: string }): unknown;
  selectPin?(pinId: string): unknown;
  dispatch(action: AddPinAction): AnnotationReviewState | null | undefined;
}
/** The stage state the annotations read; a single-artifact stage may omit the view fields. */
interface AnnotationStageState {
  status: string;
  activeArtifactId: string;
  comparisonArtifactId?: string | null;
  viewMode?: string;
  presentation?: string;
  reviewMode: string;
  artifacts: ReadonlyArray<{ id: string; viewport: Viewport }>;
}
/** The stage the annotations follow and steer. */
interface AnnotationStage {
  getState(): AnnotationStageState;
  dispatch(
    action:
      | { type: 'set-active'; artifactId: string }
      | { type: 'set-rail-open'; railOpen: boolean },
  ): unknown;
}
type AnnotationWindow = Window & typeof globalThis & { __openPlanrArtifactAnnotations?: object };
/** The annotation layer's document, stage and review controller. */
interface AnnotationOptions {
  document?: Document;
  window?: AnnotationWindow;
  root?: HTMLElement;
  stageController: AnnotationStage;
  reviewController: AnnotationReviewController;
  onFocusPin?: (pin: ArtifactReviewPin) => void;
}
/** No options: without a stage and a review controller nothing mounts. */
type NoOptions = Record<string, never>;
/** A new element's class, text and attributes; nullish attributes are skipped. */
interface MakeOptions {
  className?: string;
  textContent?: string;
  attributes?: Record<string, unknown>;
}
/** Whether closing the composer returns focus and keeps the draft to restore. */
export interface ArtifactAnnotationCloseOptions {
  restoreFocus?: boolean;
  preserveDraft?: boolean;
}
/** An event whose target is an element. */
type TargetedEvent<E extends Event> = E & { target: Element };
type RegionEvent = CustomEvent<ComposerTarget>;
type PinFocusEvent = CustomEvent<{ target?: string; pinId: string } | null>;
type ReviewSelectEvent = CustomEvent<{ source?: string; pinId?: unknown } | null>;

function finite(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: unknown, min = 0, max = 1) {
  return Math.min(max, Math.max(min, finite(value)));
}

function normalized(value: unknown) {
  return Math.round(clamp(value) * 1_000_000) / 1_000_000;
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

/**
 * Convert a click or reverse-direction pointer drag into bounded normalized
 * geometry. A click intentionally serializes with zero width and height.
 */
export function clientSelectionToNormalized(
  rect: ClientBounds,
  start: ClientPoint,
  end: ClientPoint = start,
  { dragThreshold = ARTIFACT_ANNOTATION_LIMITS.dragThreshold }: { dragThreshold?: number } = {},
) {
  assertRect(rect);
  const startX = clamp(
    finite(start?.x ?? start?.clientX, rect.left),
    rect.left,
    rect.left + rect.width,
  );
  const startY = clamp(
    finite(start?.y ?? start?.clientY, rect.top),
    rect.top,
    rect.top + rect.height,
  );
  const endX = clamp(finite(end?.x ?? end?.clientX, startX), rect.left, rect.left + rect.width);
  const endY = clamp(finite(end?.y ?? end?.clientY, startY), rect.top, rect.top + rect.height);
  const dragged = Math.hypot(endX - startX, endY - startY) >= Math.max(0, finite(dragThreshold, 4));
  const left = dragged ? Math.min(startX, endX) : startX;
  const top = dragged ? Math.min(startY, endY) : startY;
  const right = dragged ? Math.max(startX, endX) : startX;
  const bottom = dragged ? Math.max(startY, endY) : startY;
  return Object.freeze({
    x: normalized((left - rect.left) / rect.width),
    y: normalized((top - rect.top) / rect.height),
    w: normalized((right - left) / rect.width),
    h: normalized((bottom - top) / rect.height),
  });
}

/** The bridge samples a point inside the frozen artifact viewport. */
export function artifactAnchorPoint(region: Region, viewport: Viewport) {
  const width = Number.isInteger(viewport?.width) && viewport.width > 0 ? viewport.width : 1;
  const height = Number.isInteger(viewport?.height) && viewport.height > 0 ? viewport.height : 1;
  return Object.freeze({
    x: Math.round(clamp(region?.x + finite(region?.w) / 2) * width),
    y: Math.round(clamp(region?.y + finite(region?.h) / 2) * height),
  });
}

export function annotationStyle(region: Region) {
  const percent = (value: number) => `${Math.round(clamp(value) * 1_000_000) / 10_000}%`;
  return Object.freeze({
    left: percent(region?.x),
    top: percent(region?.y),
    width: percent(region?.w),
    height: percent(region?.h),
  });
}

/** Convert a viewport-normalized region into coordinates relative to a stable anchor. */
export function viewportRegionToAnchorRegion(
  region: Region,
  viewport: Viewport,
  anchorRect: AnchorRect | null | undefined,
) {
  const width = Number.isInteger(viewport?.width) && viewport.width > 0 ? viewport.width : 1;
  const height = Number.isInteger(viewport?.height) && viewport.height > 0 ? viewport.height : 1;
  const anchorWidth = Math.max(1, finite(anchorRect?.width, 1));
  const anchorHeight = Math.max(1, finite(anchorRect?.height, 1));
  const left = clamp(region?.x) * width;
  const top = clamp(region?.y) * height;
  const right = left + clamp(region?.w) * width;
  const bottom = top + clamp(region?.h) * height;
  const x = clamp((left - finite(anchorRect?.x)) / anchorWidth);
  const y = clamp((top - finite(anchorRect?.y)) / anchorHeight);
  return Object.freeze({
    x: normalized(x),
    y: normalized(y),
    w: normalized(Math.max(0, Math.min(1 - x, (right - left) / anchorWidth))),
    h: normalized(Math.max(0, Math.min(1 - y, (bottom - top) / anchorHeight))),
  });
}

/** Project an anchor-relative persisted region back into the frozen artifact viewport. */
export function anchorRegionToViewportRegion(
  region: Region,
  viewport: Viewport,
  anchorRect: AnchorRect | null | undefined,
) {
  const width = Number.isInteger(viewport?.width) && viewport.width > 0 ? viewport.width : 1;
  const height = Number.isInteger(viewport?.height) && viewport.height > 0 ? viewport.height : 1;
  const anchorWidth = Math.max(0, finite(anchorRect?.width));
  const anchorHeight = Math.max(0, finite(anchorRect?.height));
  return Object.freeze({
    x: normalized((finite(anchorRect?.x) + clamp(region?.x) * anchorWidth) / width),
    y: normalized((finite(anchorRect?.y) + clamp(region?.y) * anchorHeight) / height),
    w: normalized((clamp(region?.w) * anchorWidth) / width),
    h: normalized((clamp(region?.h) * anchorHeight) / height),
  });
}

function domToken(value: unknown) {
  const source = String(value);
  let token = '';
  for (let index = 0; index < source.length; index += 1) {
    token += source.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return token;
}

export function annotationDomIds(pinId: string) {
  const suffix = domToken(pinId);
  return Object.freeze({
    pin: `planr-pin-${suffix}`,
    thread: `planr-thread-${suffix}`,
  });
}

function text(value: unknown, max: number = ARTIFACT_ANNOTATION_LIMITS.maxCommentLength) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function make<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  { className, textContent, attributes = {} }: MakeOptions = {},
) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) node.setAttribute(name, String(value));
  }
  return node;
}

function setRegionStyle(node: HTMLElement, region: Region) {
  const style = annotationStyle(region);
  if (node.style.left !== style.left) node.style.left = style.left;
  if (node.style.top !== style.top) node.style.top = style.top;
  if (region.w > 0 || region.h > 0) {
    if (node.style.width !== style.width) node.style.width = style.width;
    if (node.style.height !== style.height) node.style.height = style.height;
  }
}

function announce(document: Document, value: string) {
  const node = document.querySelector('[data-planr-slot="review-announcer"]');
  if (node) node.textContent = value;
}

function identityName(reviewController: AnnotationReviewController) {
  return text(
    reviewController?.getIdentity?.()?.name,
    ARTIFACT_ANNOTATION_LIMITS.maxIdentityLength,
  );
}

function createIntentPicker(document: Document) {
  const group = make(document, 'div', {
    className: 'planr-intent-picker',
    attributes: { role: 'radiogroup', 'aria-label': 'Feedback intent' },
  });
  for (const [index, intent] of INTENTS.entries()) {
    const button = make(document, 'button', {
      textContent: intent[0].toUpperCase() + intent.slice(1),
      attributes: {
        type: 'button',
        role: 'radio',
        'aria-checked': String(index === 0),
        tabindex: index === 0 ? 0 : -1,
        'data-planr-intent': intent,
      },
    });
    group.append(button);
  }
  return group;
}

/**
 * Mount the transient annotation UI. Persistence/export belongs to the engine;
 * this controller only dispatches schema-shaped mutations to reviewController.
 */
// Without a DOM the window and root defaults are missing and the check below returns null; the
// hoisted functions cannot see that check, so the defaults are typed as present.
export function mountArtifactAnnotations({
  document = globalThis.document,
  window = document?.defaultView as AnnotationWindow,
  root = document?.querySelector?.('.planr-shell') as HTMLElement,
  stageController,
  reviewController,
  onFocusPin,
}: AnnotationOptions | NoOptions = {}) {
  if (!document || !window || !root || !stageController || !reviewController) return null;
  const cleanup: Array<() => void> = [];
  let draft: Draft | null = null;
  let suspendedDraft: DraftSnapshot | null = null;
  let draftToken = 0;
  let draftFieldCleanup: (() => void) | null = null;
  let composerLayoutCleanup: (() => void) | null = null;
  let composerReturnFocus: FocusTarget | null = null;
  const pinRecords = new Map<HTMLElement, Map<string, PinRecord>>();
  const anchorRequests = new Map<BridgeFrame, number>();
  let destroyed = false;

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

  function review() {
    return (
      reviewController.getReview?.() ??
      reviewController.getState?.()?.review ??
      reviewController.getState?.()
    );
  }

  function layerFor(artifactId: string) {
    return (
      [...document.querySelectorAll<HTMLElement>('[data-planr-annotation-layer]')].find(
        (node) => node.dataset.planrAnnotationLayer === artifactId,
      ) ?? null
    );
  }

  function frameFor(artifactId: string) {
    return (
      [...document.querySelectorAll<BridgeFrame>('[data-planr-artifact-frame]')].find(
        (node) => node.dataset.planrArtifactFrame === artifactId,
      ) ?? null
    );
  }

  function focusThread(pinId: string) {
    const pin = review()?.pins?.find((item) => item.id === pinId);
    if (!pin) return;
    reviewController.selectPin?.(pinId);
    const state = stageController.getState();
    if (state.activeArtifactId !== pin.artifactId) {
      stageController.dispatch({ type: 'set-active', artifactId: pin.artifactId });
    }
    stageController.dispatch({ type: 'set-rail-open', railOpen: true });
    queueMicrotask(() => document.getElementById(annotationDomIds(pinId).thread)?.focus());
  }

  function focusPin(pinId: string) {
    const pin = review()?.pins?.find((item) => item.id === pinId);
    if (!pin) return;
    reviewController.selectPin?.(pinId);
    const state = stageController.getState();
    if (state.activeArtifactId !== pin.artifactId) {
      stageController.dispatch({ type: 'set-active', artifactId: pin.artifactId });
    }
    queueMicrotask(() => {
      const marker = document.getElementById(annotationDomIds(pinId).pin);
      if (marker?.hidden) {
        announce(
          document,
          'This pin’s element is not currently visible. The original comment remains in Review.',
        );
        return;
      }
      if (onFocusPin) onFocusPin(pin);
      else marker?.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
      marker?.focus?.({ preventScroll: true });
      marker?.classList.add('planr-pin-highlight');
      window.setTimeout(() => marker?.classList.remove('planr-pin-highlight'), 1_200);
    });
  }

  function pinGeometryKey(pin: ArtifactReviewPin) {
    // Reusing a pin id in another revision must not reuse its old geometry.
    return JSON.stringify([
      reviewController.getReviewOf?.() ?? review()?.reviewOf,
      pin.artifactId,
      pin.anchor,
      pin.region,
      pin.viewport,
    ]);
  }

  function setPinPosition(record: PinRecord, region: Region) {
    const point = { x: region.x + region.w / 2, y: region.y + region.h / 2, w: 0, h: 0 };
    setRegionStyle(record.button, point);
    if (record.region) setRegionStyle(record.region, region);
    if (record.button.hidden) record.button.hidden = false;
    if (record.region?.hidden) record.region.hidden = false;
  }

  function hidePin(record: PinRecord) {
    if (!record.button.hidden) record.button.hidden = true;
    if (record.region && !record.region.hidden) record.region.hidden = true;
  }

  function removePin(record: PinRecord) {
    record.pending = null;
    record.button.remove();
    record.region?.remove();
  }

  function refreshAnchors() {
    if (destroyed) return;
    const now = window.performance.now();
    const frames = new Map<string | undefined, BridgeFrame>(
      [...document.querySelectorAll<BridgeFrame>('[data-planr-artifact-frame]')].map((frame) => [
        frame.dataset.planrArtifactFrame,
        frame,
      ]),
    );
    // Oldest first keeps large reviews fair. At most eight anchor operations
    // per frame may be in flight, leaving room for inspection and exports.
    const records = [...pinRecords.values()]
      .flatMap((records) => [...records.values()])
      .filter((record) => record.pin.anchor?.planrId)
      .sort((a, b) => a.requestedAt - b.requestedAt);
    for (const record of records) {
      if (record.pending || now - record.requestedAt < 200 || !record.button.isConnected) continue;
      // A missing frame has no bridge, which the check below skips; the filter above kept only
      // anchored pins.
      const frame = frames.get(record.pin.artifactId) as BridgeFrame;
      const bridge = frame?.__openPlanrBridge;
      if (
        !bridge?.resolve ||
        frame.closest('[hidden]') ||
        frame.dataset.planrBridgeTrusted === 'false' ||
        (anchorRequests.get(frame) ?? 0) >= 8
      )
        continue;
      const request = {},
        key = record.geometryKey,
        pin = record.pin;
      record.pending = request;
      record.requestedAt = now;
      anchorRequests.set(frame, (anchorRequests.get(frame) ?? 0) + 1);
      Promise.resolve()
        .then(() => bridge.resolve((pin.anchor as Anchor).planrId, (pin.anchor as Anchor).screen))
        .then((anchor) => {
          // A delayed response cannot move a revised/deleted pin or a newly
          // loaded frame. Existing positions stay put while the request runs.
          if (
            destroyed ||
            record.pending !== request ||
            record.geometryKey !== key ||
            !record.button.isConnected ||
            frame.__openPlanrBridge !== bridge
          )
            return;
          if (!anchor || anchor.rect.width <= 0 || anchor.rect.height <= 0) {
            hidePin(record);
            if (record.button.dataset.planrAnchorStatus !== 'unavailable')
              record.button.dataset.planrAnchorStatus = 'unavailable';
            return;
          }
          const projected = anchorRegionToViewportRegion(
            pin.region,
            anchor.viewport ?? pin.viewport,
            anchor.rect,
          );
          setPinPosition(record, projected);
          if (record.button.dataset.planrAnchorStatus !== 'resolved')
            record.button.dataset.planrAnchorStatus = 'resolved';
        })
        .catch(() => {})
        .finally(() => {
          const remaining = (anchorRequests.get(frame) ?? 1) - 1;
          if (remaining > 0) anchorRequests.set(frame, remaining);
          else anchorRequests.delete(frame);
          if (record.pending === request) record.pending = null;
        });
    }
  }

  function renderPins() {
    if (destroyed) return;
    // Array.isArray checked the pins of the same review.
    const pins = Array.isArray(review()?.pins) ? (review() as Required<AnnotationReview>).pins : [];
    const layers = new Set(document.querySelectorAll<HTMLElement>('[data-planr-annotation-layer]'));
    for (const [layer, records] of pinRecords) {
      if (layers.has(layer)) continue;
      for (const record of records.values()) removePin(record);
      pinRecords.delete(layer);
    }
    for (const layer of layers) {
      let records = pinRecords.get(layer);
      if (!records) {
        records = new Map();
        pinRecords.set(layer, records);
      }
      const current = new Set<string>();
      for (const [index, pin] of pins.entries()) {
        if (pin.artifactId !== layer.dataset.planrAnnotationLayer) continue;
        current.add(pin.id);
        const ids = annotationDomIds(pin.id),
          ordinal = index + 1;
        const hasRegion = pin.region.w > 0 || pin.region.h > 0;
        let record = records.get(pin.id);
        if (!record) {
          const button = make(document, 'button', {
            attributes: {
              type: 'button',
              id: ids.pin,
              'data-planr-pin-id': pin.id,
              'aria-controls': ids.thread,
            },
          });
          button.addEventListener('click', () => focusThread(pin.id));
          layer.append(button);
          record = {
            button,
            region: null,
            pin,
            geometryKey: null,
            pending: null,
            requestedAt: -Infinity,
          };
          records.set(pin.id, record);
        }
        record.pin = pin;
        if (hasRegion && !record.region) {
          record.region = make(document, 'span', {
            attributes: { 'data-planr-pin-region-id': pin.id, 'aria-hidden': 'true' },
          });
          layer.insertBefore(record.region, record.button);
        } else if (!hasRegion && record.region) {
          record.region.remove();
          record.region = null;
        }
        const buttonClass = `planr-pin planr-pin-${pin.intent} planr-pin-${pin.status}${hasRegion ? ' planr-pin-region-handle' : ''}${record.button.classList.contains('planr-pin-highlight') ? ' planr-pin-highlight' : ''}`;
        if (record.button.className !== buttonClass) record.button.className = buttonClass;
        if (record.button.textContent !== String(ordinal))
          record.button.textContent = String(ordinal);
        for (const [name, value] of Object.entries({
          'data-planr-intent': pin.intent,
          'data-planr-status': pin.status,
          'aria-label': `${pin.intent} comment ${ordinal}: ${pin.comment}`,
        })) {
          if (record.button.getAttribute(name) !== value) record.button.setAttribute(name, value);
        }
        if (record.region) {
          const regionClass = `planr-pin-region planr-pin-region-${pin.intent} planr-pin-region-${pin.status}`;
          if (record.region.className !== regionClass) record.region.className = regionClass;
        }
        const key = pinGeometryKey(pin);
        if (record.geometryKey !== key) {
          record.geometryKey = key;
          record.pending = null;
          record.requestedAt = -Infinity;
          // Anchored geometry is relative to the element, never to the frame.
          // Keep new/revised markers hidden until the authenticated projection
          // is ready instead of briefly drawing them at an unrelated position.
          if (pin.anchor?.planrId) hidePin(record);
          else {
            delete record.button.dataset.planrAnchorStatus;
            setPinPosition(record, pin.region);
          }
        }
      }
      for (const [id, record] of records) {
        if (!current.has(id)) {
          removePin(record);
          records.delete(id);
        }
      }
    }
    refreshAnchors();
  }

  function closeComposer({ restoreFocus = false, preserveDraft = false }: CloseOptions = {}) {
    const snapshot = preserveDraft ? snapshotDraft() : null;
    draftFieldCleanup?.();
    draftFieldCleanup = null;
    composerLayoutCleanup?.();
    composerLayoutCleanup = null;
    const activeLayer = draft ? layerFor(draft.artifactId) : null;
    const composer = root.querySelector<HTMLElement>('[data-planr-annotation-composer]');
    try {
      if (composer?.matches(':popover-open')) composer.hidePopover();
    } catch {
      /* Fixed-position fallback. */
    }
    composer?.remove();
    draft = null;
    suspendedDraft = snapshot;
    draftToken += 1;
    if (activeLayer && stageController.getState().reviewMode !== 'comment') {
      activeLayer.setAttribute('aria-disabled', 'true');
    }
    if (restoreFocus) {
      const target =
        composerReturnFocus?.isConnected && composerReturnFocus !== document.body
          ? composerReturnFocus
          : activeLayer;
      target?.focus?.({ preventScroll: true });
    }
    composerReturnFocus = null;
  }

  async function resolveAnchor(token: number, candidate: Draft) {
    const frame = frameFor(candidate.artifactId);
    const point = artifactAnchorPoint(candidate.region, candidate.viewport);
    let result: HitAnchor | null = null;
    try {
      const anchor = frame?.__openPlanrBridge?.hitTest?.(point.x, point.y);
      if (anchor) {
        result = await Promise.race([
          anchor,
          new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 800)),
        ]);
      }
    } catch {
      result = null;
    }
    if (token !== draftToken || !draft || draft.artifactId !== candidate.artifactId) return;
    if (result?.planrId) {
      draft.anchor = Object.freeze({
        planrId: String(result.planrId).slice(0, 512),
        ...(result.screen ? { screen: String(result.screen).slice(0, 128) } : {}),
      });
      draft.region = viewportRegionToAnchorRegion(draft.region, draft.viewport, result.rect);
    }
  }

  function positionComposer() {
    const composer = root.querySelector<HTMLElement>('[data-planr-annotation-composer]');
    const layer = draft && layerFor(draft.artifactId);
    if (!composer || !layer) return;
    const visual = window.visualViewport;
    const viewport = {
      x: finite(visual?.offsetLeft),
      y: finite(visual?.offsetTop),
      width: finite(visual?.width, window.innerWidth),
      height: finite(visual?.height, window.innerHeight),
    };
    const margin = Math.min(12, viewport.width / 8, viewport.height / 8);
    const availableWidth = Math.max(1, viewport.width - margin * 2),
      availableHeight = Math.max(1, viewport.height - margin * 2);
    composer.style.width = `${Math.min(360, availableWidth)}px`;
    composer.style.maxHeight = `${Math.min(620, availableHeight)}px`;
    const bounds = layer.getBoundingClientRect();
    // A layer is looked up only for a draft, so the draft exists here.
    const point = {
      x:
        bounds.left +
        clamp((draft as Draft).displayRegion.x + (draft as Draft).displayRegion.w / 2) *
          bounds.width,
      y:
        bounds.top +
        clamp((draft as Draft).displayRegion.y + (draft as Draft).displayRegion.h / 2) *
          bounds.height,
    };
    const size = composer.getBoundingClientRect();
    const width = Math.min(size.width || 360, availableWidth),
      height = Math.min(size.height || 360, availableHeight);
    const left =
      point.x + 16 + width <= viewport.x + viewport.width - margin
        ? point.x + 16
        : point.x - width - 16;
    composer.style.left = `${clamp(left, viewport.x + margin, viewport.x + viewport.width - width - margin)}px`;
    composer.style.top = `${clamp(point.y + 16, viewport.y + margin, viewport.y + viewport.height - height - margin)}px`;
  }

  function openComposer(
    detail: ComposerTarget,
    { restoredDraft = null }: { restoredDraft?: DraftSnapshot | null } = {},
  ) {
    const opener = document.activeElement;
    closeComposer();
    composerReturnFocus = opener;
    const layer = layerFor(detail.artifactId);
    if (!layer) return;
    draftToken += 1;
    const token = draftToken;
    draft = {
      artifactId: detail.artifactId,
      region: Object.freeze({ ...detail.region }),
      viewport: Object.freeze({ ...detail.viewport }),
      variant:
        typeof detail.variant === 'string' && detail.variant.length > 0
          ? detail.variant
          : detail.artifactId,
      anchor: restoredDraft?.anchor ?? null,
      displayRegion: Object.freeze({ ...(restoredDraft?.displayRegion ?? detail.region) }),
    };

    const composer = make(document, 'form', {
      className: 'planr-annotation-composer',
      attributes: {
        'data-planr-annotation-composer': '',
        role: 'dialog',
        popover: 'manual',
        'aria-label': 'Add artifact comment',
      },
    });
    const header = make(document, 'header', { className: 'planr-composer-header' });
    const heading = make(document, 'strong', { textContent: 'New comment' });
    const close = make(document, 'button', {
      textContent: '×',
      attributes: {
        type: 'button',
        'data-planr-composer-close': '',
        'aria-label': 'Close new comment',
        title: 'Close new comment (Escape)',
      },
    });
    header.append(heading, close);
    const identityLabel = make(document, 'label', { textContent: 'Your name' });
    const identity = make(document, 'input', {
      attributes: {
        type: 'text',
        maxlength: ARTIFACT_ANNOTATION_LIMITS.maxIdentityLength,
        autocomplete: 'name',
        value: identityName(reviewController),
        'data-planr-composer-identity': '',
        'aria-describedby': 'planr-composer-error',
      },
    });
    identityLabel.append(identity);
    const intentPicker = createIntentPicker(document);
    const commentLabel = make(document, 'label', { textContent: 'Comment' });
    const comment = make(document, 'textarea', {
      attributes: {
        maxlength: ARTIFACT_ANNOTATION_LIMITS.maxCommentLength,
        required: '',
        placeholder: 'Describe what the coding agent should change or consider…',
        'data-planr-composer-comment': '',
        'aria-describedby': 'planr-composer-error',
      },
    });
    commentLabel.append(comment);
    const error = make(document, 'p', {
      className: 'planr-field-error',
      attributes: { id: 'planr-composer-error', role: 'alert', 'data-planr-composer-error': '' },
    });
    const actions = make(document, 'div', { className: 'planr-composer-actions' });
    actions.append(
      make(document, 'button', {
        textContent: 'Cancel',
        attributes: { type: 'button', 'data-planr-composer-cancel': '' },
      }),
      make(document, 'button', {
        textContent: 'Add comment',
        attributes: { type: 'submit', 'data-planr-composer-submit': '' },
      }),
    );
    composer.append(header, identityLabel, intentPicker, commentLabel, error, actions);
    // The composer belongs to trusted chrome, not to the transformed artboard.
    root.append(composer);
    try {
      if (typeof composer.showPopover === 'function') composer.showPopover();
      else composer.removeAttribute('popover');
    } catch {
      composer.removeAttribute('popover');
    }
    positionComposer();
    const observer =
      typeof window.ResizeObserver === 'function'
        ? new window.ResizeObserver(positionComposer)
        : null;
    observer?.observe(composer);
    composerLayoutCleanup = () => observer?.disconnect();

    let selectedIntent: string | undefined = 'fix';
    // includes accepts only its element type; a button without an intent is not listed.
    listen(intentPicker, 'click', (event: TargetedEvent<MouseEvent>) => {
      const button = event.target.closest?.<HTMLElement>('[data-planr-intent]');
      if (!button || !INTENTS.includes(button.dataset.planrIntent as string)) return;
      selectedIntent = button.dataset.planrIntent;
      for (const option of intentPicker.querySelectorAll<HTMLElement>('[data-planr-intent]')) {
        option.setAttribute('aria-checked', String(option === button));
        option.tabIndex = option === button ? 0 : -1;
      }
    });
    listen(intentPicker, 'keydown', (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
        return;
      const options = [...intentPicker.querySelectorAll<HTMLElement>('[data-planr-intent]')];
      const current = options.findIndex((option) => option.getAttribute('aria-checked') === 'true');
      const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
      const nextIndex =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? options.length - 1
            : (Math.max(0, current) + delta + options.length) % options.length;
      event.preventDefault();
      options[nextIndex].click();
      options[nextIndex].focus();
    });
    listen(close, 'click', () => closeComposer({ restoreFocus: true }));
    // The composer was built above with its cancel button.
    listen(
      composer.querySelector('[data-planr-composer-cancel]') as HTMLButtonElement,
      'click',
      () => {
        closeComposer({ restoreFocus: true });
      },
      { once: true },
    );
    listen(composer, 'keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeComposer({ restoreFocus: true });
      } else if (event.key === 'Enter' && !event.isComposing && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        composer.requestSubmit();
      }
    });
    listen(composer, 'submit', (event) => {
      event.preventDefault();
      if (!draft) return;
      const author = text(identity.value, ARTIFACT_ANNOTATION_LIMITS.maxIdentityLength);
      const body = text(comment.value);
      identity.setAttribute('aria-invalid', String(!author));
      comment.setAttribute('aria-invalid', String(!body));
      if (!author || !body) {
        error.textContent = !author
          ? 'Enter your name before adding a comment.'
          : 'Enter a comment before submitting.';
        (!author ? identity : comment).focus();
        return;
      }
      reviewController.setIdentity?.({ name: author });
      const existingIds = new Set(review()?.pins?.map(({ id }) => id) ?? []);
      const action: AddPinAction = {
        type: 'add-pin',
        pin: {
          artifactId: draft.artifactId,
          region: draft.region,
          viewport: draft.viewport,
          variant: draft.variant,
          ...(draft.anchor ? { anchor: draft.anchor } : {}),
          intent: selectedIntent,
          comment: body,
        },
      };
      const next = reviewController.dispatch(action);
      const nextReview = next?.review ?? next;
      const created = nextReview?.pins?.find?.(({ id }) => !existingIds.has(id));
      closeComposer();
      renderPins();
      announce(document, `${selectedIntent} comment added.`);
      if (created?.id) queueMicrotask(() => focusThread(created.id));
    });
    comment.focus();
    root.dispatchEvent(
      new window.CustomEvent(ARTIFACT_ANNOTATION_EVENTS.draft, {
        bubbles: true,
        detail: Object.freeze({ ...draft }),
      }),
    );
    if (restoredDraft) {
      identity.value = restoredDraft.identity;
      comment.value = restoredDraft.comment;
      selectedIntent = restoredDraft.intent;
      for (const option of intentPicker.querySelectorAll<HTMLElement>('[data-planr-intent]')) {
        const selected = option.dataset.planrIntent === selectedIntent;
        option.setAttribute('aria-checked', String(selected));
        option.tabIndex = selected ? 0 : -1;
      }
      if (Number.isInteger(restoredDraft.selectionStart))
        comment.setSelectionRange(
          restoredDraft.selectionStart,
          restoredDraft.selectionEnd,
          restoredDraft.selectionDirection,
        );
      const fields = new Map(
        Object.entries(restoredDraft.fields ?? {})
          .slice(0, 32)
          .filter(
            ([key, value]) =>
              key.length <= 128 &&
              typeof value === 'string' &&
              value.length <= ARTIFACT_ANNOTATION_LIMITS.maxCommentLength,
          ),
      );
      if (fields.size) {
        let timer: number | undefined;
        const observer = new window.MutationObserver(restoreFields);
        const finish = () => {
          observer.disconnect();
          window.clearTimeout(timer);
        };
        function restoreFields() {
          if (token !== draftToken || !composer.isConnected) {
            finish();
            return;
          }
          for (const field of composer.querySelectorAll<DraftField>('[data-planr-draft-key]')) {
            const key = field.dataset.planrDraftKey;
            if (!fields.has(key) || typeof field.value !== 'string') continue;
            field.value = fields.get(key);
            fields.delete(key);
            field.dispatchEvent(new window.Event('change', { bubbles: true }));
          }
          if (!fields.size) finish();
        }
        observer.observe(composer, { childList: true, subtree: true });
        timer = window.setTimeout(finish, 1500);
        draftFieldCleanup = finish;
        restoreFields();
      }
    } else void resolveAnchor(token, draft);
  }

  function snapshotDraft(): DraftSnapshot | null {
    const composer = document.querySelector('[data-planr-annotation-composer]');
    if (!draft || !composer) return suspendedDraft;
    // The composer is built with its comment and identity fields.
    const comment = composer.querySelector('[data-planr-composer-comment]') as HTMLTextAreaElement;
    return Object.freeze({
      ...draft,
      reviewOf: reviewController.getReviewOf?.() ?? review()?.reviewOf ?? null,
      identity: (composer.querySelector('[data-planr-composer-identity]') as HTMLInputElement)
        .value,
      fields: Object.fromEntries(
        [...composer.querySelectorAll<DraftField>('[data-planr-draft-key]')]
          .slice(0, 32)
          .filter(
            (field) => field.dataset.planrDraftKey.length <= 128 && typeof field.value === 'string',
          )
          .map((field): [string, string] => [
            field.dataset.planrDraftKey,
            (field.value as string).slice(0, ARTIFACT_ANNOTATION_LIMITS.maxCommentLength),
          ]),
      ),
      comment: comment.value,
      intent:
        composer.querySelector<HTMLElement>('[data-planr-intent][aria-checked="true"]')?.dataset
          .planrIntent ?? 'fix',
      selectionStart: comment.selectionStart,
      selectionEnd: comment.selectionEnd,
      selectionDirection: comment.selectionDirection,
    });
  }

  function restoreDraft(snapshot: DraftSnapshot | null | undefined) {
    if (
      !snapshot ||
      snapshot.reviewOf !== (reviewController.getReviewOf?.() ?? review()?.reviewOf ?? null)
    )
      return false;
    const artifact = stageController
      .getState()
      .artifacts.find((entry) => entry.id === snapshot.artifactId);
    if (
      !artifact ||
      artifact.viewport.width !== snapshot.viewport?.width ||
      artifact.viewport.height !== snapshot.viewport?.height ||
      !(['x', 'y', 'w', 'h'] satisfies Array<keyof Region>).every(
        (key) =>
          Number.isFinite(snapshot.region?.[key]) &&
          snapshot.region[key] >= 0 &&
          snapshot.region[key] <= 1,
      ) ||
      !(['x', 'y', 'w', 'h'] satisfies Array<keyof Region>).every(
        (key) =>
          Number.isFinite(snapshot.displayRegion?.[key]) &&
          snapshot.displayRegion[key] >= 0 &&
          snapshot.displayRegion[key] <= 1,
      ) ||
      typeof snapshot.comment !== 'string' ||
      snapshot.comment.length > ARTIFACT_ANNOTATION_LIMITS.maxCommentLength ||
      typeof snapshot.identity !== 'string' ||
      snapshot.identity.length > ARTIFACT_ANNOTATION_LIMITS.maxIdentityLength ||
      !INTENTS.includes(snapshot.intent) ||
      (snapshot.anchor &&
        (typeof snapshot.anchor.planrId !== 'string' || snapshot.anchor.planrId.length > 512))
    )
      return false;
    openComposer(snapshot, { restoredDraft: snapshot });
    return Boolean(draft);
  }

  listen(window, 'resize', positionComposer);
  if (window.visualViewport) {
    listen(window.visualViewport, 'resize', positionComposer);
    listen(window.visualViewport, 'scroll', positionComposer);
  }
  listen(root, 'planr:artifact-region', (event: RegionEvent) => openComposer(event.detail));
  listen(root, 'planr:stage-change', () => {
    const state = stageController.getState();
    const visible =
      state.viewMode === 'split'
        ? [state.activeArtifactId, state.comparisonArtifactId]
        : [state.activeArtifactId];
    if (!draft) {
      if (
        suspendedDraft &&
        state.status === 'ready' &&
        state.reviewMode === 'comment' &&
        visible.includes(suspendedDraft.artifactId)
      )
        restoreDraft(suspendedDraft);
      return;
    }
    if (
      state.status !== 'ready' ||
      (state.presentation !== 'document' && state.reviewMode !== 'comment')
    ) {
      closeComposer({ preserveDraft: true });
      return;
    }
    if (!visible.includes(draft.artifactId)) closeComposer({ preserveDraft: true });
    else {
      draftToken += 1;
      positionComposer();
    }
  });
  listen(root, 'planr:artifact-review-change', renderPins);
  const anchorRefresh = window.setInterval(refreshAnchors, 250);
  cleanup.push(() => window.clearInterval(anchorRefresh));
  listen(root, ARTIFACT_ANNOTATION_EVENTS.focus, (event: PinFocusEvent) => {
    if (event.detail?.target === 'pin') focusPin(event.detail.pinId);
    if (event.detail?.target === 'thread') focusThread(event.detail.pinId);
  });
  listen(root, 'planr:artifact-review-select', (event: ReviewSelectEvent) => {
    if (event.detail?.source === 'thread' && typeof event.detail?.pinId === 'string') {
      focusPin(event.detail.pinId);
    }
  });

  renderPins();
  const controller = Object.freeze({
    render: renderPins,
    openComposer,
    closeComposer,
    snapshotDraft,
    restoreDraft,
    focusPin,
    focusThread,
    destroy() {
      destroyed = true;
      closeComposer();
      for (const remove of cleanup.splice(0)) remove();
      for (const records of pinRecords.values())
        for (const record of records.values()) removePin(record);
      pinRecords.clear();
      anchorRequests.clear();
    },
  });
  window.__openPlanrArtifactAnnotations = controller;
  return controller;
}
