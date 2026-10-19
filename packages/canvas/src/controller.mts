import {
  finite,
  invalid,
  nonnegative,
  point,
  positive,
  rect,
  screenToWorld,
  validateCamera,
  worldToScreen,
} from './camera.mjs';
import { createFrames } from './frames.mjs';
import { bindInput, isEditable } from './input.mjs';
import type {
  Camera,
  CanvasController,
  CanvasElements,
  CanvasEvents,
  CanvasNode,
  CanvasOptions,
  NodeId,
  Point,
  WorldElement,
} from './types.mjs';

function object(field: string, value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field, value);
}

export function createCanvas(options: CanvasOptions): CanvasController {
  object('options', options);
  if (options.zoom !== undefined) object('zoom', options.zoom);
  if (options.keyboard !== undefined) object('keyboard', options.keyboard);
  if (options.worldBounds !== undefined) object('worldBounds', options.worldBounds);
  if (typeof options.label !== 'string' || !options.label.trim()) invalid('label', options.label);
  const min = options.zoom?.min === undefined ? 0.04 : options.zoom.min;
  const max = options.zoom?.max === undefined ? 4 : options.zoom.max;
  positive('zoom.min', min);
  positive('zoom.max', max);
  if (min > max) invalid('zoom.min > zoom.max', `${min} > ${max}`);
  if (options.motion !== undefined && options.motion !== 'auto' && options.motion !== 'none')
    invalid('motion', options.motion);
  if (
    options.keyboard?.arrows !== undefined &&
    !['navigate', 'none'].includes(options.keyboard.arrows)
  )
    invalid('keyboard.arrows', options.keyboard.arrows);
  if (options.strict !== undefined && typeof options.strict !== 'boolean')
    invalid('strict', options.strict);
  if (options.shortcutsEnabled !== undefined && typeof options.shortcutsEnabled !== 'function')
    invalid('shortcutsEnabled', options.shortcutsEnabled);
  let pointerMode = options.pointerMode === undefined ? 'pan' : options.pointerMode;
  validatePointerMode(pointerMode);
  if (options.worldBounds) {
    rect('worldBounds.rect', options.worldBounds.rect);
    nonnegative('worldBounds.padding', options.worldBounds.padding);
  }
  const worldBounds = options.worldBounds
    ? { rect: { ...options.worldBounds.rect }, padding: options.worldBounds.padding }
    : undefined;
  let camera: Camera = { x: 0, y: 0, zoom: Math.max(min, Math.min(max, 1)) };
  let nodes = new Map<NodeId, CanvasNode>();
  let selection: readonly NodeId[] = [];
  let activeFrame: NodeId | null = null;
  let destroyed = false;
  let composing = false;
  let elements: CanvasElements | undefined;
  let view: Window | undefined;
  let frameId: number | undefined;
  let idleTimer: number | undefined;
  let isMoving = false;
  const consumedKeys = new WeakSet<KeyboardEvent>();
  let dirty = false;
  let cameraEvent = false;
  let activeFrameEvent = false;
  let animation: { from: Camera; to: Camera; start: number } | undefined;
  let input: ReturnType<typeof bindInput> | undefined;
  let frames: ReturnType<typeof createFrames> | undefined;
  let restore: (() => void) | undefined;
  const cameraListeners = new Set<(payload: Camera) => void>();
  const frameListeners = new Set<(payload: NodeId | null) => void>();
  const shortcutsEnabled = () => options.shortcutsEnabled?.() ?? true;

  function alive() {
    if (destroyed) throw new Error('Canvas controller is destroyed');
  }
  function size() {
    const bounds = elements?.stage.getBoundingClientRect();
    return { width: bounds?.width ?? 0, height: bounds?.height ?? 0 };
  }
  function clamp(value: Camera): Camera {
    const zoom = Math.max(min, Math.min(max, value.zoom));
    let { x, y } = value;
    if (worldBounds) {
      const { rect: bounds, padding } = worldBounds;
      const stage = size();
      const left = bounds.x - padding;
      const top = bounds.y - padding;
      const right = bounds.x + bounds.width + padding - stage.width / zoom;
      const bottom = bounds.y + bounds.height + padding - stage.height / zoom;
      x = right < left ? (left + right) / 2 : Math.max(left, Math.min(right, x));
      y = bottom < top ? (top + bottom) / 2 : Math.max(top, Math.min(bottom, y));
    }
    return { x, y, zoom };
  }
  function layers() {
    return elements ? [...new Set([elements.world, ...(elements.overlays ?? [])])] : [];
  }
  function schedule() {
    if (view && frameId === undefined) frameId = view.requestAnimationFrame(write);
  }
  function moving() {
    if (!view) return;
    if (!isMoving) {
      for (const layer of layers()) {
        if (layer.style.willChange !== 'transform') layer.style.willChange = 'transform';
      }
      frames?.setMoving(true);
    }
    isMoving = true;
    if (idleTimer !== undefined) view.clearTimeout(idleTimer);
    idleTimer = view.setTimeout(() => {
      idleTimer = undefined;
      for (const layer of layers()) {
        if (layer.style.willChange) layer.style.removeProperty('will-change');
      }
      isMoving = false;
      frames?.setMoving(false);
    }, 150);
  }
  function change(value: Camera) {
    camera = clamp(value);
    dirty = true;
    cameraEvent = true;
    moving();
    schedule();
  }
  function zoomTo(value: number, screenPoint?: Point) {
    const stage = size();
    const anchor = screenPoint ?? { x: stage.width / 2, y: stage.height / 2 };
    point('screenPoint', anchor);
    const world = screenToWorld(camera, anchor);
    const zoom = Math.max(min, Math.min(max, value));
    controller.setCamera({ x: world.x - anchor.x / zoom, y: world.y - anchor.y / zoom, zoom });
  }
  function write(time: number) {
    frameId = undefined;
    if (!elements) return;
    if (animation) {
      const progress = Math.min(1, (time - animation.start) / 200);
      const { from, to } = animation;
      change(
        progress === 1
          ? to
          : {
              x: from.x + (to.x - from.x) * progress,
              y: from.y + (to.y - from.y) * progress,
              zoom: from.zoom + (to.zoom - from.zoom) * progress,
            },
      );
      if (progress === 1) animation = undefined;
    }
    if (dirty) {
      dirty = false;
      const { x, y, zoom } = camera;
      for (const layer of layers()) {
        if (layer.namespaceURI === 'http://www.w3.org/2000/svg') {
          const transform = `translate(${-x * zoom} ${-y * zoom}) scale(${zoom})`;
          if (layer.getAttribute('transform') !== transform)
            layer.setAttribute('transform', transform);
        } else {
          const transform = `scale(${zoom}) translate(${-x}px, ${-y}px)`;
          if (layer.style.transform !== transform) layer.style.transform = transform;
        }
      }
      if (activeFrame !== null) frames?.updatePosition();
    }
    const notifyCamera = cameraEvent;
    const notifyFrame = activeFrameEvent;
    const framePayload = activeFrame;
    const cameraPayload = { ...camera };
    cameraEvent = false;
    activeFrameEvent = false;
    if (notifyCamera) for (const listener of cameraListeners) listener(cameraPayload);
    if (notifyFrame) for (const listener of frameListeners) listener(framePayload);
    if (animation) schedule();
  }
  function validatePointerMode(mode: 'pan' | 'none') {
    if (mode !== 'pan' && mode !== 'none') invalid('pointerMode', mode);
  }
  function requireNode(id: NodeId, field = 'id') {
    const node = nodes.get(id);
    if (!node) invalid(field, id);
    return node;
  }
  function validateWorld(field: string, value: WorldElement, stage: HTMLElement) {
    const realm = stage.ownerDocument.defaultView;
    if (
      !realm ||
      !(value instanceof realm.Element) ||
      (!(value instanceof realm.HTMLElement) &&
        !(value.namespaceURI === 'http://www.w3.org/2000/svg' && value.localName === 'g'))
    )
      invalid(field, value);
  }
  function detach() {
    alive();
    if (!elements) return;
    if (frameId !== undefined) view?.cancelAnimationFrame(frameId);
    if (idleTimer !== undefined) view?.clearTimeout(idleTimer);
    frameId = undefined;
    idleTimer = undefined;
    isMoving = false;
    composing = false;
    animation = undefined;
    input?.dispose();
    frames?.dispose();
    restore?.();
    input = undefined;
    frames = undefined;
    restore = undefined;
    elements = undefined;
    view = undefined;
  }

  const controller: CanvasController = {
    attach(next) {
      alive();
      const stage = next?.stage;
      const realm = stage?.ownerDocument?.defaultView;
      if (!realm || !(stage instanceof realm.HTMLElement)) invalid('elements.stage', stage);
      validateWorld('elements.world', next.world, stage);
      if (next.overlays !== undefined && !Array.isArray(next.overlays))
        invalid('elements.overlays', next.overlays);
      next.overlays?.forEach((overlay, index) => {
        validateWorld(`elements.overlays[${index}]`, overlay, stage);
      });
      if (
        elements?.stage === stage &&
        elements.world === next.world &&
        (elements.overlays ?? []).length === (next.overlays ?? []).length &&
        (elements.overlays ?? []).every((overlay, index) => overlay === next.overlays?.[index])
      )
        return;
      detach();
      elements = { ...next, overlays: [...(next.overlays ?? [])] };
      view = realm;
      const attributes = ['tabindex', 'role', 'aria-label', 'aria-roledescription'].map(
        (key) => [key, stage.getAttribute(key)] as const,
      );
      const touchAction = stage.style.touchAction;
      const previous = layers().map((layer) => ({
        layer,
        transform: layer.style.transform,
        origin: layer.style.transformOrigin,
        willChange: layer.style.willChange,
        attribute: layer.getAttribute('transform'),
      }));
      const compositionStart = () => {
        composing = true;
      };
      const compositionEnd = () => {
        composing = false;
      };
      stage.addEventListener('compositionstart', compositionStart);
      stage.addEventListener('compositionend', compositionEnd);
      stage.addEventListener('blur', compositionEnd);
      stage.addEventListener('focusout', compositionEnd);
      restore = () => {
        stage.removeEventListener('compositionstart', compositionStart);
        stage.removeEventListener('compositionend', compositionEnd);
        stage.removeEventListener('blur', compositionEnd);
        stage.removeEventListener('focusout', compositionEnd);
        stage.style.touchAction = touchAction;
        for (const [key, value] of attributes) {
          if (value === null) stage.removeAttribute(key);
          else stage.setAttribute(key, value);
        }
        for (const entry of previous) {
          entry.layer.style.transform = entry.transform;
          entry.layer.style.transformOrigin = entry.origin;
          entry.layer.style.willChange = entry.willChange;
          if (entry.attribute === null) entry.layer.removeAttribute('transform');
          else entry.layer.setAttribute('transform', entry.attribute);
        }
      };
      stage.tabIndex = 0;
      stage.setAttribute('role', 'group');
      stage.setAttribute('aria-label', options.label);
      stage.setAttribute('aria-roledescription', 'canvas');
      stage.style.touchAction = 'none';
      for (const layer of layers()) layer.style.transformOrigin = '0 0';
      frames = createFrames(
        elements,
        () => nodes.values(),
        () => controller.deactivateFrame(),
      );
      frames.setActive(activeFrame);
      input = bindInput(elements, controller, () => pointerMode, shortcutsEnabled);
      change(camera);
    },
    detach,
    destroy() {
      alive();
      detach();
      destroyed = true;
      cameraListeners.clear();
      frameListeners.clear();
      nodes.clear();
      selection = [];
    },
    setNodes(values) {
      alive();
      if (!Array.isArray(values)) invalid('nodes', values);
      const next = new Map<NodeId, CanvasNode>();
      for (const [index, node] of values.entries()) {
        if (!node || typeof node !== 'object') invalid(`nodes[${index}]`, node);
        if (typeof node.id !== 'string' || !node.id.trim()) invalid(`nodes[${index}].id`, node.id);
        if (next.has(node.id)) invalid('nodes.id duplicate', node.id);
        rect(`nodes[${index}].bounds`, node.bounds);
        if (node.frame !== undefined && typeof node.frame !== 'boolean')
          invalid(`nodes[${index}].frame`, node.frame);
        if (node.kind !== undefined && typeof node.kind !== 'string')
          invalid(`nodes[${index}].kind`, node.kind);
        next.set(node.id, { ...node, bounds: { ...node.bounds } });
      }
      nodes = next;
      selection = selection.filter((id) => nodes.has(id));
      if (activeFrame !== null && !nodes.get(activeFrame)?.frame) controller.deactivateFrame();
      frames?.refresh();
    },
    getCamera() {
      alive();
      return { ...camera };
    },
    setCamera(value, settings) {
      alive();
      validateCamera(value);
      if (settings !== undefined) object('setCamera.options', settings);
      if (settings?.animate !== undefined && typeof settings.animate !== 'boolean')
        invalid('animate', settings.animate);
      animation = undefined;
      if (
        settings?.animate &&
        view &&
        options.motion !== 'none' &&
        !view.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ) {
        animation = { from: { ...camera }, to: clamp(value), start: view.performance.now() };
        moving();
        schedule();
      } else change(value);
    },
    panBy(dxScreen, dyScreen) {
      alive();
      finite('dxScreen', dxScreen);
      finite('dyScreen', dyScreen);
      controller.setCamera({
        ...camera,
        x: camera.x + dxScreen / camera.zoom,
        y: camera.y + dyScreen / camera.zoom,
      });
    },
    zoomAt(factor, screenPoint) {
      alive();
      positive('factor', factor);
      zoomTo(camera.zoom * factor, screenPoint);
    },
    fit(target, settings) {
      alive();
      if (target !== 'all' && target !== 'selection' && !Array.isArray(target))
        invalid('target', target);
      if (settings !== undefined) object('fit.options', settings);
      const padding = settings?.padding === undefined ? 32 : settings.padding;
      const maxZoom = settings?.maxZoom === undefined ? max : settings.maxZoom;
      nonnegative('padding', padding);
      positive('maxZoom', maxZoom);
      const ids =
        target === 'all' ? [...nodes.keys()] : target === 'selection' ? selection : target;
      const values = ids.map((id) => requireNode(id, 'target.id').bounds);
      if (!values.length) return;
      const left = Math.min(...values.map((bounds) => bounds.x));
      const top = Math.min(...values.map((bounds) => bounds.y));
      const right = Math.max(...values.map((bounds) => bounds.x + bounds.width));
      const bottom = Math.max(...values.map((bounds) => bounds.y + bounds.height));
      const stage = size();
      const zoom = Math.max(
        min,
        Math.min(
          max,
          maxZoom,
          Math.max(0, stage.width - 2 * padding) / (right - left || 1),
          Math.max(0, stage.height - 2 * padding) / (bottom - top || 1),
        ),
      );
      controller.setCamera(
        {
          x: (left + right) / 2 - stage.width / (2 * zoom),
          y: (top + bottom) / 2 - stage.height / (2 * zoom),
          zoom,
        },
        { animate: true },
      );
    },
    reveal(id, settings) {
      alive();
      const bounds = requireNode(id).bounds;
      if (settings !== undefined) object('reveal.options', settings);
      const mode = settings?.mode === undefined ? 'minimal' : settings.mode;
      if (mode !== 'minimal' && mode !== 'center') invalid('mode', mode);
      const stage = size();
      const width = stage.width / camera.zoom;
      const height = stage.height / camera.zoom;
      let { x, y } = camera;
      if (mode === 'center' || bounds.width > width) x = bounds.x + bounds.width / 2 - width / 2;
      else if (bounds.x < x) x = bounds.x;
      else if (bounds.x + bounds.width > x + width) x = bounds.x + bounds.width - width;
      if (mode === 'center' || bounds.height > height)
        y = bounds.y + bounds.height / 2 - height / 2;
      else if (bounds.y < y) y = bounds.y;
      else if (bounds.y + bounds.height > y + height) y = bounds.y + bounds.height - height;
      if (x !== camera.x || y !== camera.y)
        controller.setCamera({ ...camera, x, y }, { animate: true });
    },
    worldToScreen(value) {
      alive();
      point('point', value);
      return worldToScreen(camera, value);
    },
    screenToWorld(value) {
      alive();
      point('point', value);
      return screenToWorld(camera, value);
    },
    setSelection(ids) {
      alive();
      if (!Array.isArray(ids)) invalid('selection', ids);
      ids.forEach((id) => {
        requireNode(id, 'selection.id');
      });
      if (new Set(ids).size !== ids.length) invalid('selection duplicate', ids.join(','));
      selection = [...ids];
    },
    getSelection() {
      alive();
      return [...selection];
    },
    setPointerMode(mode) {
      alive();
      validatePointerMode(mode);
      pointerMode = mode;
    },
    handleKey(event) {
      alive();
      if (
        consumedKeys.has(event) ||
        composing ||
        !elements ||
        event.isComposing ||
        isEditable(event) ||
        !shortcutsEnabled() ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return false;
      const target = event.target;
      const realm = elements.stage.ownerDocument.defaultView;
      if (target && realm && target instanceof realm.Element && !elements.stage.contains(target))
        return false;
      const key = event.key;
      let consumed = true;
      if (key === '+' || key === '=') controller.zoomAt(1.25);
      else if (key === '-') controller.zoomAt(1 / 1.25);
      else if (key === '0' && !event.shiftKey) zoomTo(1);
      else if (event.shiftKey && (key === '1' || key === '!' || event.code === 'Digit1'))
        controller.fit('all');
      else if (event.shiftKey && (key === '2' || key === '@' || event.code === 'Digit2'))
        controller.fit('selection');
      else if (
        event.shiftKey &&
        options.keyboard?.arrows !== 'none' &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)
      ) {
        const stage = size();
        controller.panBy(
          key === 'ArrowLeft' ? -stage.width / 4 : key === 'ArrowRight' ? stage.width / 4 : 0,
          key === 'ArrowUp' ? -stage.height / 4 : key === 'ArrowDown' ? stage.height / 4 : 0,
        );
      } else consumed = false;
      if (consumed) {
        consumedKeys.add(event);
        event.preventDefault();
      }
      return consumed;
    },
    setActiveFrame(id) {
      alive();
      if (id !== null && !requireNode(id).frame) invalid('frame.id', id);
      if (id === activeFrame) return;
      activeFrame = id;
      activeFrameEvent = true;
      frames?.setActive(id);
      schedule();
    },
    getActiveFrame() {
      alive();
      return activeFrame;
    },
    deactivateFrame() {
      alive();
      controller.setActiveFrame(null);
    },
    on<K extends keyof CanvasEvents>(event: K, listener: (payload: CanvasEvents[K]) => void) {
      alive();
      if (typeof listener !== 'function') invalid('listener', listener);
      if (event === 'camera') {
        const callback = listener as (payload: Camera) => void;
        cameraListeners.add(callback);
        return () => {
          cameraListeners.delete(callback);
        };
      }
      if (event === 'active-frame') {
        const callback = listener as (payload: NodeId | null) => void;
        frameListeners.add(callback);
        return () => {
          frameListeners.delete(callback);
        };
      }
      return invalid('event', event);
    },
  };
  return controller;
}
