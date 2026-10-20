import type { CanvasElements, CanvasNode } from './types.mjs';

export function createFrames(
  elements: CanvasElements,
  getNodes: () => Iterable<CanvasNode>,
  deactivate: () => void,
): {
  setActive(id: string | null): void;
  setMoving(moving: boolean): void;
  refresh(): void;
  updatePosition(): void;
  dispose(): void;
} {
  const { stage } = elements;
  const document = stage.ownerDocument;
  const originals = new Map<
    HTMLIFrameElement,
    Readonly<{ pointerEvents: string; tabindex: string | null }>
  >();
  const position = stage.style.position;
  const done = document.createElement('button');
  let active: string | null = null;
  let moving = false;
  let wrapper: Element | null = null;
  done.type = 'button';
  done.textContent = 'Done';
  done.className = 'canvas-frame-done';
  done.setAttribute('data-canvas-frame-done', '');
  done.setAttribute('aria-label', 'Done interacting with frame');
  Object.assign(done.style, {
    position: 'absolute',
    zIndex: 'var(--canvas-z-screen-overlays, 10)',
    pointerEvents: 'auto',
  });
  done.hidden = true;
  stage.append(done);
  if (document.defaultView?.getComputedStyle(stage).position === 'static')
    stage.style.position = 'relative';

  function setFrameState(
    frame: HTMLIFrameElement,
    pointerEvents: string,
    tabindex: string | null,
  ): void {
    if (frame.style.pointerEvents !== pointerEvents) frame.style.pointerEvents = pointerEvents;
    if (frame.getAttribute('tabindex') !== tabindex) {
      if (tabindex === null) frame.removeAttribute('tabindex');
      else frame.setAttribute('tabindex', tabindex);
    }
  }

  function restore(frame: HTMLIFrameElement): void {
    const original = originals.get(frame);
    if (!original) return;
    setFrameState(frame, original.pointerEvents, original.tabindex);
    originals.delete(frame);
  }

  function updatePosition(): void {
    if (active === null) return;
    const stageRect = stage.getBoundingClientRect();
    const frameRect = wrapper?.getBoundingClientRect();
    const width = done.offsetWidth || 60;
    const height = done.offsetHeight || 32;
    const left = `${Math.max(0, Math.min(stageRect.width - width, (frameRect?.right ?? stageRect.right) - stageRect.left - width))}px`;
    const top = `${Math.max(0, Math.min(stageRect.height - height, (frameRect?.top ?? stageRect.top) - stageRect.top))}px`;
    if (done.style.left !== left) done.style.left = left;
    if (done.style.top !== top) done.style.top = top;
  }

  function refresh(): void {
    const frameIds = new Set<string>();
    for (const node of getNodes()) if (node.frame) frameIds.add(node.id);
    wrapper = null;
    if (!frameIds.size && !originals.size && active === null) return;
    const present = new Set<HTMLIFrameElement>();
    const frames = frameIds.size ? stage.querySelectorAll('iframe') : [];
    for (const frame of frames) {
      const owner = frame.closest('[data-canvas-node-id]');
      const id = owner?.getAttribute('data-canvas-node-id');
      if (!id || !frameIds.has(id)) continue;
      present.add(frame);
      let original = originals.get(frame);
      if (!original) {
        original = {
          pointerEvents: frame.style.pointerEvents,
          tabindex: frame.getAttribute('tabindex'),
        };
        originals.set(frame, original);
      }
      const interactive = id === active && !moving;
      setFrameState(frame, interactive ? 'auto' : 'none', interactive ? original.tabindex : '-1');
      if (id === active) wrapper = owner;
    }
    for (const frame of originals.keys()) if (!present.has(frame)) restore(frame);
    const hidden = active === null;
    if (done.hidden !== hidden) done.hidden = hidden;
    updatePosition();
  }

  function outside(event: Event): void {
    const path = event.composedPath();
    if (active !== null && !path.includes(done) && !(wrapper && path.includes(wrapper)))
      deactivate();
  }
  function finish(): void {
    deactivate();
    stage.focus({ preventScroll: true });
  }
  done.addEventListener('click', finish);
  document.addEventListener('pointerdown', outside, true);
  document.defaultView?.addEventListener('resize', refresh);
  refresh();
  const observer = document.defaultView
    ? new document.defaultView.MutationObserver(refresh)
    : undefined;
  observer?.observe(stage, { childList: true, subtree: true });

  return {
    setActive(id) {
      if (active === id) return;
      active = id;
      refresh();
    },
    setMoving(value) {
      if (moving === value) return;
      moving = value;
      refresh();
    },
    refresh,
    updatePosition,
    dispose() {
      observer?.disconnect();
      for (const frame of originals.keys()) restore(frame);
      done.removeEventListener('click', finish);
      document.removeEventListener('pointerdown', outside, true);
      document.defaultView?.removeEventListener('resize', refresh);
      done.remove();
      if (stage.style.position !== position) stage.style.position = position;
    },
  };
}
