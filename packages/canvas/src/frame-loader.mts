import type { CanvasElements, CanvasNode, Point } from './types.mjs';

type FrameEntry = {
  id: string;
  frame: HTMLIFrameElement;
  tile: HTMLDivElement;
  portal: HTMLDivElement;
  anchor: Comment;
  originalStyle: string | null;
  source: string | null;
  content: string | null;
  live: boolean;
  booting: boolean;
  retainedUntil: number | null;
  failed: boolean;
  loaded: () => void;
  failedLoad: () => void;
};

export function createFrameLoader(
  elements: CanvasElements,
  getNodes: () => Iterable<CanvasNode>,
  getMountedIds: () => ReadonlySet<string>,
  getCenter: () => Point,
  getBudget: () => number,
  onChange: () => void = () => {},
): {
  refresh(): void;
  setMoving(value: boolean): void;
  request(id: string | null): void;
  getLiveIds(): ReadonlySet<string>;
  dispose(): void;
} {
  const { stage } = elements;
  const document = stage.ownerDocument;
  const entries = new Map<string, FrameEntry>();
  const cache = document.createElement('div');
  cache.setAttribute('data-canvas-frame-cache', '');
  Object.assign(cache.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '0',
    height: '0',
  });
  let moving = false;
  let disposed = false;
  let requested: string | null = null;
  let expiry: ReturnType<typeof setTimeout> | undefined;

  function showTile(entry: FrameEntry): void {
    if (entry.anchor.parentNode && !entry.tile.isConnected) entry.anchor.after(entry.tile);
  }

  function suspend(entry: FrameEntry): void {
    entry.frame.removeAttribute('src');
    entry.frame.removeAttribute('srcdoc');
    entry.frame.removeAttribute('data-canvas-frame-live');
    entry.frame.removeAttribute('data-canvas-frame-booting');
    entry.frame.remove();
    entry.portal.remove();
    entry.live = false;
    entry.booting = false;
    entry.retainedUntil = null;
    showTile(entry);
  }

  function boot(entry: FrameEntry): void {
    entry.failed = false;
    entry.tile.querySelector('[role="status"]')?.remove();
    entry.live = true;
    entry.booting = true;
    entry.retainedUntil = null;
    entry.frame.setAttribute('data-canvas-frame-live', 'true');
    entry.frame.setAttribute('data-canvas-frame-booting', 'true');
    if (entry.source !== null) entry.frame.setAttribute('src', entry.source);
    if (entry.content !== null) entry.frame.setAttribute('srcdoc', entry.content);
    entry.tile.remove();
    Object.assign(entry.frame.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      transform: 'none',
    });
    entry.portal.append(entry.frame);
    if (!cache.isConnected) elements.world.append(cache);
    cache.append(entry.portal);
    onChange();
  }

  function createEntry(id: string, frame: HTMLIFrameElement, node: CanvasNode): FrameEntry {
    const anchor = document.createComment('');
    const portal = document.createElement('div');
    portal.setAttribute('data-canvas-node-id', id);
    portal.setAttribute('data-canvas-frame-portal', id);
    portal.style.position = 'absolute';
    const tile = document.createElement('div');
    tile.className = 'canvas-frame-placeholder';
    tile.setAttribute('data-canvas-frame-placeholder', id);
    tile.style.cssText = frame.style.cssText;
    tile.style.width = `${node.bounds.width}px`;
    tile.style.height = `${node.bounds.height}px`;
    if (frame.getAttribute('data-canvas-node-id') === id)
      tile.setAttribute('data-canvas-node-id', id);
    const load = document.createElement('button');
    load.type = 'button';
    load.textContent = 'Load';
    load.setAttribute('aria-label', `Load frame ${id}`);
    load.addEventListener('click', () => request(id));
    tile.append(load);
    const entry: FrameEntry = {
      id,
      frame,
      tile,
      portal,
      anchor,
      originalStyle: frame.getAttribute('style'),
      source: frame.getAttribute('src'),
      content: frame.getAttribute('srcdoc'),
      live: false,
      booting: false,
      retainedUntil: null,
      failed: false,
      loaded() {
        if (!entry.live || !entry.booting || disposed) return;
        entry.booting = false;
        entry.frame.removeAttribute('data-canvas-frame-booting');
        onChange();
        refresh();
      },
      failedLoad() {
        if (!entry.live || !entry.booting || disposed) return;
        entry.failed = true;
        suspend(entry);
        const error = document.createElement('span');
        error.setAttribute('role', 'status');
        error.textContent = `Frame ${id} failed to load. `;
        entry.tile.prepend(error);
        onChange();
        refresh();
      },
    };
    frame.addEventListener('load', entry.loaded);
    frame.addEventListener('error', entry.failedLoad);
    frame.replaceWith(anchor, tile);
    frame.removeAttribute('src');
    frame.removeAttribute('srcdoc');
    return entry;
  }

  function refresh(): void {
    if (disposed) return;
    if (expiry !== undefined) clearTimeout(expiry);
    expiry = undefined;
    const nodes = new Map(
      Array.from(getNodes())
        .filter((node) => node.frame)
        .map((node) => [node.id, node]),
    );
    if (!nodes.size && !entries.size) return;
    const mounted = getMountedIds();
    const center = getCenter();
    for (const frame of stage.querySelectorAll('iframe')) {
      if (cache.contains(frame)) continue;
      const owner = frame.closest('[data-canvas-node-id]');
      const id = owner?.getAttribute('data-canvas-node-id');
      if (!id) continue;
      const node = nodes.get(id);
      if (!node) continue;
      const current = entries.get(id);
      if (!current) entries.set(id, createEntry(id, frame, node));
      else if (current.frame !== frame) {
        current.anchor.remove();
        current.anchor = document.createComment('');
        frame.replaceWith(current.anchor);
        if (!current.live) showTile(current);
      }
    }
    const now = Date.now();
    for (const [id, entry] of entries) {
      if (!nodes.has(id)) {
        suspend(entry);
        entry.tile.remove();
        entry.anchor.remove();
        entry.frame.removeEventListener('load', entry.loaded);
        entry.frame.removeEventListener('error', entry.failedLoad);
        entries.delete(id);
      } else {
        const node = nodes.get(id);
        if (!node) continue;
        const bounds = node.bounds;
        const geometry = {
          left: `${bounds.x}px`,
          top: `${bounds.y}px`,
          width: `${bounds.width}px`,
          height: `${bounds.height}px`,
        };
        for (const [property, value] of Object.entries(geometry)) {
          if (entry.portal.style.getPropertyValue(property) !== value)
            entry.portal.style.setProperty(property, value);
        }
        if (entry.tile.style.width !== geometry.width) entry.tile.style.width = geometry.width;
        if (entry.tile.style.height !== geometry.height) entry.tile.style.height = geometry.height;
        const hidden = !mounted.has(id);
        if (entry.portal.hidden !== hidden) entry.portal.hidden = hidden;
        if (!mounted.has(id) && entry.live) {
          entry.retainedUntil ??= now + 180_000;
          if (now >= entry.retainedUntil) suspend(entry);
        } else if (mounted.has(id)) entry.retainedUntil = null;
      }
    }
    function distance(id: string): number {
      const bounds = nodes.get(id)?.bounds;
      return bounds
        ? (bounds.x + bounds.width / 2 - center.x) ** 2 +
            (bounds.y + bounds.height / 2 - center.y) ** 2
        : Infinity;
    }
    const candidates = Array.from(entries.values()).filter(
      (entry) => mounted.has(entry.id) && !entry.failed && (entry.live || entry.anchor.isConnected),
    );
    candidates.sort((a, b) => {
      if (a.id === requested) return -1;
      if (b.id === requested) return 1;
      return distance(a.id) - distance(b.id) || a.id.localeCompare(b.id);
    });
    const budget = getBudget();
    const chosen = new Set(candidates.slice(0, budget).map((entry) => entry.id));
    let remaining = Math.max(0, budget - chosen.size);
    const retained = Array.from(entries.values()).filter(
      (entry) => entry.live && !mounted.has(entry.id),
    );
    retained.sort((a, b) => (b.retainedUntil ?? 0) - (a.retainedUntil ?? 0));
    for (const entry of retained) {
      if (remaining > 0) {
        chosen.add(entry.id);
        remaining -= 1;
      }
    }
    for (const entry of entries.values()) if (entry.live && !chosen.has(entry.id)) suspend(entry);
    if (!moving && !Array.from(entries.values()).some((entry) => entry.booting)) {
      const next = candidates.find((entry) => chosen.has(entry.id) && !entry.live);
      if (next) boot(next);
    }
    const deadlines = Array.from(entries.values()).flatMap((entry) =>
      entry.retainedUntil === null ? [] : [entry.retainedUntil],
    );
    if (deadlines.length) expiry = setTimeout(refresh, Math.max(0, Math.min(...deadlines) - now));
  }

  function request(id: string | null): void {
    requested = id;
    const entry = id === null ? undefined : entries.get(id);
    if (entry) entry.failed = false;
    refresh();
  }

  const observer = document.defaultView
    ? new document.defaultView.MutationObserver(refresh)
    : undefined;
  observer?.observe(stage, { childList: true, subtree: true });
  refresh();
  return {
    refresh,
    request,
    setMoving(value) {
      if (moving === value) return;
      moving = value;
      refresh();
    },
    getLiveIds: () =>
      new Set(
        Array.from(entries.values())
          .filter((entry) => entry.live)
          .map((entry) => entry.id),
      ),
    dispose() {
      disposed = true;
      observer?.disconnect();
      if (expiry !== undefined) clearTimeout(expiry);
      for (const entry of entries.values()) {
        entry.frame.removeEventListener('load', entry.loaded);
        entry.frame.removeEventListener('error', entry.failedLoad);
        entry.frame.removeAttribute('data-canvas-frame-live');
        entry.frame.removeAttribute('data-canvas-frame-booting');
        if (entry.source !== null) entry.frame.setAttribute('src', entry.source);
        if (entry.content !== null) entry.frame.setAttribute('srcdoc', entry.content);
        if (entry.originalStyle === null) entry.frame.removeAttribute('style');
        else entry.frame.setAttribute('style', entry.originalStyle);
        entry.tile.remove();
        if (entry.anchor.parentNode) entry.anchor.replaceWith(entry.frame);
      }
      entries.clear();
      cache.remove();
    },
  };
}
