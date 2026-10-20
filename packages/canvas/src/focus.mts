import type { CanvasNode, Direction, NodeId } from './types.mjs';

export class CanvasFocusError extends Error {
  readonly code: 'unknown-node' | 'no-element';

  constructor(id: NodeId, code: 'unknown-node' | 'no-element') {
    super(
      `Cannot focus node ${id}: ${code === 'unknown-node' ? 'unknown node' : 'no focusable element registered within two frames'}`,
    );
    this.name = 'CanvasFocusError';
    this.code = code;
  }
}

export function navigateSpatial(
  nodes: Iterable<CanvasNode>,
  from: CanvasNode,
  direction: Direction,
): NodeId | null {
  const x = from.bounds.x + from.bounds.width / 2;
  const y = from.bounds.y + from.bounds.height / 2;
  let nearest: NodeId | null = null;
  let distance = Infinity;
  for (const node of nodes) {
    if (node.id === from.id) continue;
    const dx = node.bounds.x + node.bounds.width / 2 - x;
    const dy = node.bounds.y + node.bounds.height / 2 - y;
    const forward =
      direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy;
    const sideways = direction === 'right' || direction === 'left' ? Math.abs(dy) : Math.abs(dx);
    if (forward <= 0 || sideways > forward) continue;
    const next = dx * dx + dy * dy;
    if (
      next < distance ||
      (next === distance &&
        nearest !== null &&
        node.id.localeCompare(nearest, undefined, { numeric: true }) < 0)
    ) {
      nearest = node.id;
      distance = next;
    }
  }
  return nearest;
}

type FocusRequest = {
  id: NodeId;
  frames: number;
  resolve(): void;
  reject(error: CanvasFocusError): void;
};

export function createRovingFocus(
  stage: HTMLElement,
  registered: ReadonlyMap<NodeId, Element>,
  outline: () => readonly NodeId[],
  current: () => NodeId | null,
  changed: (id: NodeId | null) => void,
  reveal: (id: NodeId) => void,
  pending: (ids: readonly NodeId[]) => void,
) {
  const attributes = new Map<Element, string | null>();
  const requests = new Set<FocusRequest>();
  let pendingIds = '';
  let parking = false;
  let parked = false;
  let skippingTab = false;
  let order: readonly NodeId[] | undefined;
  let positions = new Map<NodeId, number>();
  let fallback: NodeId | undefined;
  let fallbackDirty = true;
  let tabStop: Element | undefined;
  function tabindex(element: Element, value: string) {
    if (element.getAttribute('tabindex') !== value) element.setAttribute('tabindex', value);
  }
  function moveTabStop(element: Element | undefined) {
    if (tabStop === element) return;
    if (tabStop) tabindex(tabStop, '-1');
    tabStop = element;
    if (tabStop) tabindex(tabStop, '0');
  }
  function sync() {
    const next = outline();
    if (order !== next) {
      order = next;
      positions = new Map(order.map((id, index) => [id, index]));
      fallbackDirty = true;
      if (!tabStop) fallback = order[0];
    }
    const id = current();
    const first = id ?? fallback;
    const stageIndex = id === null ? 0 : -1;
    if (stage.tabIndex !== stageIndex) stage.tabIndex = stageIndex;
    moveTabStop(skippingTab || first === undefined ? undefined : registered.get(first));
  }
  function restore(element: Element) {
    if (!attributes.has(element)) return;
    const original = attributes.get(element);
    if (original === null || original === undefined) element.removeAttribute('tabindex');
    else element.setAttribute('tabindex', original);
    attributes.delete(element);
  }
  function focusElement(element: Element) {
    if ('focus' in element && typeof element.focus === 'function')
      element.focus({ preventScroll: true });
    return stage.ownerDocument.activeElement === element;
  }
  function updatePending() {
    const ids = [...requests].map((request) => request.id);
    const key = JSON.stringify(ids);
    if (key === pendingIds) return;
    pendingIds = key;
    pending(ids);
  }
  const focusIn = (event: FocusEvent) => {
    if (parking) return;
    const target = event.target;
    const fallback =
      target && 'closest' in target && typeof target.closest === 'function'
        ? target.closest('[data-canvas-node-id]')?.getAttribute('data-canvas-node-id')
        : null;
    const id =
      [...registered].find(([, element]) => event.composedPath().includes(element))?.[0] ??
      (fallback && outline().includes(fallback) ? fallback : null);
    parked = false;
    changed(id);
    sync();
    if (id !== null) reveal(id);
  };
  const focusOut = (event: FocusEvent) => {
    const target = event.relatedTarget;
    if (target && 'nodeType' in target && stage.contains(target as Node)) return;
    if (parked && !target) return;
    parked = false;
    changed(null);
    sync();
  };
  const tab = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || current() !== null || stage.ownerDocument.activeElement !== stage)
      return;
    // The stage owns entry until a node takes focus, so its fallback node must not add a second stop.
    skippingTab = true;
    sync();
    pending([...requests].map((request) => request.id));
  };
  stage.addEventListener('focusin', focusIn);
  stage.addEventListener('focusout', focusOut);
  stage.addEventListener('keydown', tab);
  sync();
  return {
    sync,
    register(id: NodeId, element: Element) {
      if (!attributes.has(element)) attributes.set(element, element.getAttribute('tabindex'));
      if (!skippingTab && id === (current() ?? fallback)) moveTabStop(element);
      else if (element !== tabStop) tabindex(element, '-1');
      if (
        !fallbackDirty &&
        (positions.get(id) ?? Infinity) <
          (fallback === undefined ? Infinity : (positions.get(fallback) ?? Infinity))
      )
        fallback = id;
    },
    unregister(id: NodeId, element: Element) {
      if (current() === id && stage.ownerDocument.activeElement === element) {
        parking = true;
        parked = true;
        stage.focus({ preventScroll: true });
        parking = false;
      }
      if (element === tabStop) tabStop = undefined;
      if (id === fallback) fallbackDirty = true;
      restore(element);
    },
    request(id: NodeId): Promise<void> {
      return new Promise((resolve, reject) => {
        requests.add({ id, resolve, reject, frames: 0 });
        updatePending();
      });
    },
    update(settled: boolean) {
      if (fallbackDirty) {
        let first = Infinity;
        fallback = undefined;
        for (const id of registered.keys()) {
          const position = positions.get(id) ?? Infinity;
          if (position < first) {
            first = position;
            fallback = id;
          }
        }
        fallbackDirty = false;
      }
      if (skippingTab) {
        skippingTab = false;
      }
      sync();
      const id = current();
      const element = id === null ? undefined : registered.get(id);
      if (parked && element && focusElement(element)) parked = false;
      if (!settled) return requests.size > 0;
      for (const request of requests) {
        const element = registered.get(request.id);
        if (element && focusElement(element)) {
          changed(request.id);
          sync();
          reveal(request.id);
          requests.delete(request);
          request.resolve();
        } else if (request.frames++ >= 2) {
          requests.delete(request);
          request.reject(new CanvasFocusError(request.id, 'no-element'));
        }
      }
      updatePending();
      return requests.size > 0;
    },
    dispose() {
      stage.removeEventListener('focusin', focusIn);
      stage.removeEventListener('focusout', focusOut);
      stage.removeEventListener('keydown', tab);
      for (const request of requests)
        request.reject(new CanvasFocusError(request.id, 'no-element'));
      requests.clear();
      pending([]);
      for (const element of attributes.keys()) restore(element);
    },
  };
}
