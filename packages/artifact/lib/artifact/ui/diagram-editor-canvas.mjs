// @ts-check
import { clone, elementIndex, geometryFields } from '../diagram/authoring/model.mjs';
import {
  authoredDiagramPalette,
  renderAuthoredSceneElement,
} from '../diagram/authoring/renderer.mjs';
import { resolveDiagramSceneElement } from '../diagram/authoring/scene.mjs';
import { moveOrthogonalBend } from './diagram-editor-actions.mjs';
import { bundleOf, errText } from './diagram-editor-commands.mjs';
import { focusable } from './diagram-editor-dom.mjs';

/** @typedef {import('../diagram/authoring/index.d.mts').DiagramCommand} DiagramCommand */

const SVG = 'http://www.w3.org/2000/svg';
const boundsOf = (bundle) => {
  const rects = bundle.presentation.elements.map((item) => item.bounds).filter(Boolean);
  if (!rects.length) return { x: -200, y: -120, width: 400, height: 240 };
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const rect of rects) {
    x = Math.min(x, rect.x);
    y = Math.min(y, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
};
const intersect = (a, b) =>
  a &&
  b &&
  a.x <= b.x + b.width &&
  a.x + a.width >= b.x &&
  a.y <= b.y + b.height &&
  a.y + a.height >= b.y;

/**
 * The drawing surface: camera, per-element SVG reconciliation, selection overlays and gestures.
 * @type {typeof import('./diagram-editor-context.d.mts').createEditorCanvas}
 */
export function createEditorCanvas(ctx) {
  const { doc, win, session, dom } = ctx;
  const { shell, stage, svg, world, overlays } = dom;
  const current = ctx.current,
    report = ctx.report;
  const elementNodes = new Map(),
    renderSignatures = new Map();
  let renderedDigest = '',
    drag = null,
    raf = 0,
    tempPan = false;
  /** @type {'select' | 'pan'} */
  let tool = 'select';

  const editorTheme = (bundle) =>
    ctx.prefersDark()
      ? bundle.presentation.theme.themeId === 'slate'
        ? 'slate'
        : 'midnight'
      : 'paper';
  const fromClient = (event) => {
    const rect = svg.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const worldPoint = (point, camera = current().view.camera) => ({
    x: (point.x - camera.x) / camera.scale,
    y: (point.y - camera.y) / camera.scale,
  });
  const cameraPatch = (camera) => session.setView({ camera });
  function fit() {
    const state = current();
    if (!state.bundle) return;
    const rect = stage.getBoundingClientRect(),
      bounds = boundsOf(state.bundle),
      pad = 72;
    const scale = Math.min(
      1.6,
      Math.max(
        0.04,
        Math.min((rect.width - pad * 2) / bounds.width, (rect.height - pad * 2) / bounds.height),
      ),
    );
    cameraPatch({
      x: (rect.width - bounds.width * scale) / 2 - bounds.x * scale,
      y: (rect.height - bounds.height * scale) / 2 - bounds.y * scale,
      scale,
      fit: 'all',
    });
  }
  function zoom(factor, around) {
    const camera = current().view.camera,
      point = around ?? { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
    const scale = Math.min(4, Math.max(0.04, camera.scale * factor)),
      anchor = worldPoint(point, camera);
    cameraPatch({ x: point.x - anchor.x * scale, y: point.y - anchor.y * scale, scale, fit: null });
  }
  /** @param {{ type: string; affectedIds?: string[] }} [event] */
  function draw(event = { type: 'initial', affectedIds: [] }) {
    if (ctx.isDisposed()) return;
    const state = current(),
      bundle = ctx.displayed(state);
    if (!bundle) {
      world.replaceChildren();
      elementNodes.clear();
      ctx.chrome.render(state);
      return;
    }
    const camera = state.view.camera;
    dom.zoomValue.textContent = Math.round(camera.scale * 100) + '%';
    const transform = 'translate(' + camera.x + ' ' + camera.y + ') scale(' + camera.scale + ')';
    world.setAttribute('transform', transform);
    overlays.setAttribute('transform', transform);
    const byId = elementIndex(bundle.document),
      placements = new Map(bundle.presentation.elements.map((entry) => [entry.elementId, entry]));
    const theme = editorTheme(bundle),
      palette = authoredDiagramPalette(theme),
      emphasis = new Map(bundle.document.emphasis.map((entry) => [entry.targetId, entry.level]));
    const selection = new Set(state.view.selection);
    const forceAll =
      event.type === 'initial' ||
      !elementNodes.size ||
      renderedDigest === '' ||
      event.type === 'refresh';
    const affected = forceAll ? new Set(placements.keys()) : new Set(event.affectedIds ?? []);
    if (event.type === 'content' && !affected.size)
      for (const id of placements.keys()) affected.add(id);
    const parser = new win.DOMParser();
    for (const [id, node] of elementNodes)
      if (!placements.has(id)) {
        node.remove();
        elementNodes.delete(id);
        renderSignatures.delete(id);
      }
    for (let order = 0; order < bundle.presentation.elements.length; order++) {
      const entry = bundle.presentation.elements[order],
        id = entry.elementId;
      const source = byId.get(id);
      const signature = JSON.stringify([
        source,
        entry,
        emphasis.get(id) ?? null,
        theme,
        source?.collection === 'relations'
          ? [placements.get(source.value.from), placements.get(source.value.to)]
          : null,
      ]);
      if (
        !elementNodes.has(id) ||
        ((affected.has(id) || forceAll) && renderSignatures.get(id) !== signature)
      ) {
        const scene = resolveDiagramSceneElement(
          byId.get(id),
          entry,
          placements,
          order,
          emphasis.get(id) ?? null,
        );
        const xml = parser.parseFromString(
          '<svg xmlns="' +
            SVG +
            '">' +
            renderAuthoredSceneElement(scene, palette, bundle.diagramId) +
            '</svg>',
          'image/svg+xml',
        );
        const rendered = xml.documentElement.firstElementChild;
        if (!rendered) throw new TypeError(`Element ${id} rendered no SVG markup.`);
        const replacement = doc.importNode(rendered, true);
        replacement.setAttribute('tabindex', '-1');
        replacement.setAttribute('role', 'img');
        replacement.setAttribute('aria-label', scene.label || scene.kind);
        const old = elementNodes.get(id);
        if (old) old.replaceWith(replacement);
        else world.append(replacement);
        elementNodes.set(id, replacement);
        renderSignatures.set(id, signature);
      }
      const node = elementNodes.get(id);
      node.dataset.selected = String(selection.has(id));
      node.classList.toggle('de-selected', selection.has(id));
    }
    // Keep stable primitives; reordering moves only nodes whose source order changed.
    if (event.type === 'content' || event.type === 'refresh' || forceAll) {
      const ordered = [...bundle.presentation.elements].sort(
        (a, b) =>
          a.zIndex - b.zIndex ||
          bundle.presentation.elements.indexOf(a) - bundle.presentation.elements.indexOf(b),
      );
      for (const entry of ordered) world.append(elementNodes.get(entry.elementId));
    }
    renderedDigest = bundle.bundleDigest;
    shell.dataset.diagramTheme = theme;
    renderOverlays(state, bundle, selection);
    ctx.chrome.render(state);
  }
  function renderOverlays(state, bundle, selection) {
    overlays.replaceChildren();
    const scale = state.view.camera.scale,
      byPlacement = new Map(bundle.presentation.elements.map((item) => [item.elementId, item]));
    for (const id of selection) {
      const geometry = session.geometry(id),
        rect = geometry?.bounds ?? geometry?.labelBounds;
      if (rect) {
        const box = doc.createElementNS(SVG, 'rect');
        for (const [key, value] of Object.entries({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        }))
          box.setAttribute(key, String(value));
        box.setAttribute('class', 'de-selection-box');
        box.setAttribute('stroke-width', String(1.5 / scale));
        box.setAttribute('pointer-events', 'none');
        overlays.append(box);
        if (
          selection.size === 1 &&
          ctx.editable(state) &&
          byPlacement.get(id)?.bounds &&
          !byPlacement.get(id).locks.size
        ) {
          const handle = doc.createElementNS(SVG, 'rect');
          const size = 10 / scale;
          handle.setAttribute('x', String(rect.x + rect.width - size / 2));
          handle.setAttribute('y', String(rect.y + rect.height - size / 2));
          handle.setAttribute('width', String(size));
          handle.setAttribute('height', String(size));
          handle.setAttribute('rx', String(2 / scale));
          handle.setAttribute('class', 'de-resize-handle');
          handle.setAttribute('data-handle', 'resize');
          handle.setAttribute('data-handle-id', id);
          overlays.append(handle);
        }
      }
      if (geometry?.points?.length && ctx.editable(state))
        for (let index = 1; index < geometry.points.length - 1; index++) {
          const point = geometry.points[index],
            handle = doc.createElementNS(SVG, 'circle');
          handle.setAttribute('cx', String(point.x));
          handle.setAttribute('cy', String(point.y));
          handle.setAttribute('r', String(5 / scale));
          handle.setAttribute('class', 'de-bend-handle');
          handle.setAttribute('data-handle', 'bend');
          handle.setAttribute('data-index', String(index));
          handle.setAttribute('data-handle-id', id);
          overlays.append(handle);
        }
    }
    if (drag?.type === 'marquee') {
      const a = worldPoint(drag.start),
        b = worldPoint(drag.last),
        rect = doc.createElementNS(SVG, 'rect');
      rect.setAttribute('x', String(Math.min(a.x, b.x)));
      rect.setAttribute('y', String(Math.min(a.y, b.y)));
      rect.setAttribute('width', String(Math.abs(a.x - b.x)));
      rect.setAttribute('height', String(Math.abs(a.y - b.y)));
      rect.setAttribute('class', 'de-marquee');
      rect.setAttribute('stroke-width', String(1 / scale));
      overlays.append(rect);
    }
  }
  function pointerDown(event) {
    const { select } = ctx.commands;
    if (event.button !== 0 || !current().bundle || ctx.dialogs.active() || focusable(event.target))
      return;
    const state = current(),
      start = fromClient(event),
      target = event.target.closest('[data-element-id]'),
      handle = event.target.closest('[data-handle]');
    const query = session.query({ x: start.x, y: start.y, tolerance: 8 });
    if (!query.ok) {
      report(errText(query));
      return;
    }
    const id =
      handle?.getAttribute('data-handle-id') ??
      query.hits[0]?.id ??
      target?.getAttribute('data-element-id') ??
      null;
    if ((tool === 'pan' || tempPan) && !handle) {
      drag = { type: 'pan', start, last: start, camera: clone(state.view.camera) };
      stage.setPointerCapture(event.pointerId);
      return;
    }
    if (!ctx.editable(state)) {
      if (id) select([id]);
      return;
    }
    if (ctx.inspector.dirty()) {
      event.preventDefault();
      ctx.inspector.guardDraft();
      return;
    }
    if (handle) {
      if (!state.view.selection.includes(id) && !select([id]).ok) return;
      drag = {
        type: handle.dataset.handle,
        id,
        index: Number(handle.dataset.index),
        start,
        last: start,
        origin: state.bundle,
        originPoints: session.geometry(id)?.points ?? [],
        active: false,
      };
    } else if (id) {
      const ids = event.shiftKey
        ? state.view.selection.includes(id)
          ? state.view.selection.filter((value) => value !== id)
          : [...state.view.selection, id]
        : state.view.selection.includes(id)
          ? state.view.selection
          : [id];
      if (!select(ids).ok) return;
      drag = { type: 'move', id, ids, start, last: start, origin: state.bundle, active: false };
    } else {
      if (!event.shiftKey && !select([]).ok) return;
      drag = {
        type: 'marquee',
        start,
        last: start,
        additive: event.shiftKey,
        base: [...state.view.selection],
      };
    }
    stage.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function previewDrag() {
    raf = 0;
    if (!drag || !drag.active || drag.type === 'marquee' || drag.type === 'pan') return;
    const state = current(),
      scale = state.view.camera.scale;
    const dx = (drag.last.x - drag.start.x) / scale,
      dy = (drag.last.y - drag.start.y) / scale;
    /** @type {DiagramCommand} */
    let command;
    if (drag.type === 'move') {
      const x = state.view.snap ? Math.round(dx / 8) * 8 : Math.round(dx),
        y = state.view.snap ? Math.round(dy / 8) * 8 : Math.round(dy);
      command = { type: 'move', ids: drag.ids, dx: x, dy: y };
    } else {
      const place = drag.origin.presentation.elements.find((item) => item.elementId === drag.id),
        before = geometryFields(place),
        after = clone(before);
      if (drag.type === 'resize') {
        after.bounds.width = Math.max(24, Math.round(before.bounds.width + dx));
        after.bounds.height = Math.max(24, Math.round(before.bounds.height + dy));
      }
      if (drag.type === 'bend') {
        const points = drag.originPoints,
          target = points[drag.index];
        if (!target) return;
        if (after.route.mode !== 'manual') {
          after.route.mode = 'manual';
          after.route.points = points;
        }
        if (after.route.strategy === 'orthogonal')
          after.route.points = moveOrthogonalBend(points, drag.index, dx, dy);
        else
          after.route.points[drag.index] = {
            x: Math.round(target.x + dx),
            y: Math.round(target.y + dy),
          };
      }
      command = { type: 'geometry', changes: [{ elementId: drag.id, before, after }] };
    }
    const result = session.previewGesture(command);
    if (!result.ok) report(errText(result));
    else report('');
  }
  function pointerMove(event) {
    if (!drag) return;
    const point = fromClient(event);
    drag.last = point;
    if (drag.type === 'pan') {
      const camera = drag.camera;
      cameraPatch({
        x: camera.x + point.x - drag.start.x,
        y: camera.y + point.y - drag.start.y,
        scale: camera.scale,
        fit: null,
      });
      return;
    }
    if (drag.type === 'marquee') {
      renderOverlays(current(), ctx.displayed(current()), new Set(current().view.selection));
      return;
    }
    if (!drag.active && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 3) {
      const result = session.beginGesture();
      if (!result.ok) {
        report(errText(result));
        drag = null;
        return;
      }
      drag.active = true;
    }
    if (drag.active && !raf) raf = win.requestAnimationFrame(previewDrag);
  }
  function finishPointer(event, cancel = false) {
    if (!drag) return;
    if (raf) {
      win.cancelAnimationFrame(raf);
      raf = 0;
      if (drag.active && !cancel) previewDrag();
    }
    const finished = drag;
    drag = null;
    if (finished.active) {
      const result = cancel ? session.cancelGesture('cancelled') : session.completeGesture();
      if (!result.ok) {
        // The session keeps a refused gesture open; a released pointer can no longer retain it.
        session.cancelGesture('rejected');
        report(errText(result));
      } else if (!cancel) ctx.notice('One edit applied. Save diagram to keep it.');
    } else if (finished.type === 'marquee' && !cancel) {
      const a = worldPoint(finished.start),
        b = worldPoint(finished.last),
        rect = {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: Math.abs(a.x - b.x),
          height: Math.abs(a.y - b.y),
        };
      if (rect.width > 3 || rect.height > 3) {
        const picked = bundleOf(current())
          .presentation.elements.filter((item) => item.bounds && intersect(item.bounds, rect))
          .map((item) => item.elementId);
        ctx.commands.select(finished.additive ? [...finished.base, ...picked] : picked);
      }
    }
    if (event?.pointerId !== undefined && stage.hasPointerCapture(event.pointerId))
      stage.releasePointerCapture(event.pointerId);
    draw({ type: 'view' });
  }
  function wheel(event) {
    if (!event.target.closest('.de-canvas')) return;
    event.preventDefault();
    const point = fromClient(event);
    if (event.ctrlKey || event.metaKey) zoom(Math.exp(-event.deltaY * 0.002), point);
    else {
      const camera = current().view.camera;
      cameraPatch({ ...camera, x: camera.x - event.deltaX, y: camera.y - event.deltaY, fit: null });
    }
  }
  function pointerUp(event) {
    finishPointer(event);
  }
  function pointerCancel(event) {
    finishPointer(event, true);
  }
  function lostPointerCapture(event) {
    if (drag) finishPointer(event, true);
  }
  function blur() {
    tempPan = false;
    if (drag) finishPointer(null, true);
  }
  return {
    tool: () => tool,
    setTool(next) {
      tool = next;
    },
    setTemporaryPan(active) {
      tempPan = active;
    },
    dragging: () => !!drag,
    cancelDrag() {
      finishPointer(null, true);
    },
    draw,
    fit,
    zoom,
    cameraPatch,
    worldPoint,
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    lostPointerCapture,
    wheel,
    blur,
    dispose() {
      win.cancelAnimationFrame(raf);
      elementNodes.clear();
      renderSignatures.clear();
    },
  };
}
