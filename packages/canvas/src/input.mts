import type { CanvasController, CanvasElements, Point } from './types.mjs';

const WHEEL_ZOOM_RATE = 0.01;
const WHEEL_ZOOM_MIN_FACTOR = 0.8;
const WHEEL_ZOOM_MAX_FACTOR = 1.25;
const WHEEL_BURST_GAP_MS = 150;

function editable(target: EventTarget | null): boolean {
  if (!target || !('nodeType' in target)) return false;
  const element = target.nodeType === 1 ? (target as Element) : (target as Node).parentElement;
  if (!element) return false;
  if (element.closest('input, textarea, select')) return true;
  const owner = element.closest('[contenteditable]');
  return owner !== null && owner.getAttribute('contenteditable') !== 'false';
}

export function isEditable(event: KeyboardEvent): boolean {
  const target = event.target;
  const document =
    target && 'ownerDocument' in target
      ? (target as Node).ownerDocument
      : (event.view?.document ?? globalThis.document);
  let active = document?.activeElement ?? null;
  while (active) {
    const nested =
      active.shadowRoot?.activeElement ??
      (active.localName === 'iframe'
        ? (active as HTMLIFrameElement).contentDocument?.activeElement
        : null);
    if (!nested) break;
    active = nested;
  }
  return editable(target) || editable(active) || event.composedPath().some(editable);
}

export function normalizeWheel(
  event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>,
  stageHeight: number,
): Point {
  const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stageHeight : 1;
  return { x: event.deltaX * multiplier, y: event.deltaY * multiplier };
}

type Pointer = Readonly<{ x: number; y: number; touch: boolean }>;

function pinch(
  pointers: ReadonlyMap<number, Pointer>,
): Readonly<{ center: Point; distance: number }> | null {
  const points = [...pointers.values()].filter((point) => point.touch);
  const [first, second] = points;
  if (!first || !second) return null;
  return {
    center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    distance: Math.hypot(first.x - second.x, first.y - second.y),
  };
}

export function bindInput(
  elements: CanvasElements,
  controller: CanvasController,
  getPointerMode: () => 'pan' | 'none',
  shortcutsEnabled: () => boolean,
  setGesture: (active: boolean) => void = () => {},
): { dispose(): void } {
  const { stage } = elements;
  const document = stage.ownerDocument;
  const view = document.defaultView;
  const removers: (() => void)[] = [];
  const pointers = new Map<number, Pointer>();
  const touchAction = stage.style.touchAction;
  let space = false;
  let composing = false;
  let gestureScale = 1;
  stage.style.touchAction = 'none';

  function listen(
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener, options);
    removers.push(() => target.removeEventListener(type, listener, options));
  }

  // Reading the rect per wheel event forces layout after the frame's style writes.
  let rect: DOMRect | null = null;
  let lastWheel = -Infinity;
  function stageRect(): DOMRect {
    rect ??= stage.getBoundingClientRect();
    return rect;
  }
  const invalidate = () => {
    rect = null;
  };
  const observer = view?.ResizeObserver ? new view.ResizeObserver(invalidate) : undefined;
  observer?.observe(stage);
  removers.push(() => observer?.disconnect());
  if (view) {
    listen(view, 'resize', invalidate);
    listen(document, 'scroll', invalidate, { capture: true, passive: true });
  }

  function local(point: Point): Point {
    const { left, top } = stageRect();
    return { x: point.x - left, y: point.y - top };
  }

  listen(
    stage,
    'wheel',
    (raw) => {
      const event = raw as WheelEvent;
      // A stage can move without resizing; re-measure once per wheel burst.
      if (event.timeStamp - lastWheel > WHEEL_BURST_GAP_MS) invalidate();
      lastWheel = event.timeStamp;
      const delta = normalizeWheel(event, stageRect().height);
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        controller.zoomAt(
          Math.min(
            WHEEL_ZOOM_MAX_FACTOR,
            Math.max(WHEEL_ZOOM_MIN_FACTOR, Math.exp(-delta.y * WHEEL_ZOOM_RATE)),
          ),
          local({ x: event.clientX, y: event.clientY }),
        );
      } else {
        controller.panBy(delta.x, delta.y);
      }
    },
    { passive: false },
  );

  listen(stage, 'keydown', (raw) => {
    const event = raw as KeyboardEvent;
    if (composing || event.isComposing || isEditable(event)) return;
    if (
      (event.key === ' ' || event.code === 'Space') &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      if (controller.handleKey(event)) return;
      if (document.activeElement === stage) {
        space = true;
        event.preventDefault();
      }
      return;
    }
    if (event.key.length === 1 && !shortcutsEnabled()) return;
    if (controller.handleKey(event)) event.preventDefault();
  });
  listen(document, 'keyup', (raw) => {
    const event = raw as KeyboardEvent;
    if (event.key === ' ' || event.code === 'Space') space = false;
  });
  listen(stage, 'compositionstart', () => {
    composing = true;
    space = false;
  });
  listen(stage, 'compositionend', () => {
    composing = false;
  });

  listen(stage, 'pointerdown', (raw) => {
    const event = raw as PointerEvent;
    const touch = event.pointerType === 'touch';
    const target = event.target;
    if (editable(target)) return;
    const interactive =
      target &&
      'closest' in target &&
      typeof target.closest === 'function' &&
      target.closest('button, a, [role="button"]');
    if (touch && interactive && !interactive.hasAttribute('data-canvas-node-id')) return;
    const occupied =
      interactive ||
      (target &&
        'closest' in target &&
        typeof target.closest === 'function' &&
        target.closest('[data-canvas-node-id]'));
    const pan =
      event.button === 1 ||
      space ||
      (event.button === 0 && getPointerMode() === 'pan' && !occupied);
    if (!touch && !pan) return;
    invalidate();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, touch });
    setGesture(true);
    if (stage.setPointerCapture) stage.setPointerCapture(event.pointerId);
    if (touch || pan) {
      stage.focus({ preventScroll: true });
      event.preventDefault();
    }
  });

  listen(stage, 'pointermove', (raw) => {
    const event = raw as PointerEvent;
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const before = pinch(pointers);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, touch: previous.touch });
    const after = pinch(pointers);
    if (before && after) {
      controller.panBy(before.center.x - after.center.x, before.center.y - after.center.y);
      if (before.distance > 0 && after.distance > 0) {
        controller.zoomAt(after.distance / before.distance, local(after.center));
      }
    } else if (!previous.touch || space || getPointerMode() === 'pan') {
      controller.panBy(previous.x - event.clientX, previous.y - event.clientY);
    }
    event.preventDefault();
  });

  function release(raw: Event): void {
    const event = raw as PointerEvent;
    pointers.delete(event.pointerId);
    setGesture(pointers.size > 0);
    if (stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  }
  listen(stage, 'pointerup', release);
  listen(stage, 'pointercancel', release);
  listen(stage, 'lostpointercapture', (raw) => {
    pointers.delete((raw as PointerEvent).pointerId);
    setGesture(pointers.size > 0);
  });
  function reset(): void {
    space = false;
    composing = false;
    for (const pointerId of pointers.keys()) {
      if (stage.hasPointerCapture?.(pointerId)) stage.releasePointerCapture(pointerId);
    }
    pointers.clear();
    setGesture(false);
  }
  if (view) listen(view, 'blur', reset);
  listen(stage, 'blur', () => {
    space = false;
    composing = false;
  });
  listen(stage, 'focusout', () => {
    space = false;
    composing = false;
  });

  if (view && ('GestureEvent' in view || 'ongesturestart' in stage)) {
    listen(
      stage,
      'gesturestart',
      (event) => {
        gestureScale = 1;
        invalidate();
        setGesture(true);
        event.preventDefault();
      },
      { passive: false },
    );
    listen(
      stage,
      'gesturechange',
      (raw) => {
        const event = raw as Event & { scale: number; clientX: number; clientY: number };
        if (!Number.isFinite(event.scale) || event.scale <= 0) return;
        event.preventDefault();
        controller.zoomAt(
          event.scale / gestureScale,
          local({ x: event.clientX, y: event.clientY }),
        );
        gestureScale = event.scale;
      },
      { passive: false },
    );
    listen(
      stage,
      'gestureend',
      (event) => {
        event.preventDefault();
        gestureScale = 1;
        setGesture(false);
      },
      { passive: false },
    );
  }

  return {
    dispose() {
      reset();
      for (const remove of removers) remove();
      stage.style.touchAction = touchAction;
    },
  };
}
