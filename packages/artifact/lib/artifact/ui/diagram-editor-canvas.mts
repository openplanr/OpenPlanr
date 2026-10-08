import type {
  DiagramBounds,
  DiagramPlacement,
} from '@openplanr/protocol/diagram-authoring-contracts';
import type { VersionedDiagramAuthoringBundle as DiagramAuthoringBundle } from '@openplanr/protocol/studio-presentation-contracts';
import type { DiagramCommand } from '../diagram/authoring/index.mjs';
import { clone, elementIndex, geometryFields } from '../diagram/authoring/model.mjs';
import {
  authoredDiagramPalette,
  renderAuthoredSceneElement,
} from '../diagram/authoring/renderer.mjs';
import { resolveDiagramSceneElement } from '../diagram/authoring/scene.mjs';
import type { DiagramEditorState, DiagramEditorView } from '../diagram/editor/index.mjs';
import {
  type DiagramEditorPoint,
  displayName,
  moveOrthogonalBend,
} from './diagram-editor-actions.mjs';
import { bundleOf, errText } from './diagram-editor-commands.mjs';
import { focusable } from './diagram-editor-dom.mjs';
import type { DiagramEditorContext } from './diagram-editor-regions.mjs';

export type DiagramEditorTool = 'select' | 'pan';
type Camera = DiagramEditorView['camera'];
/** A redraw request; `affectedIds` limits the elements that re-render. */
interface DrawEvent {
  type: string;
  affectedIds?: string[];
}
export interface DiagramEditorCanvas {
  tool(): DiagramEditorTool;
  setTool(tool: DiagramEditorTool): void;
  setTemporaryPan(active: boolean): void;
  dragging(): boolean;
  cancelDrag(): void;
  draw(event?: DrawEvent): void;
  fit(minimumScale?: number): void;
  zoom(factor: number, around?: DiagramEditorPoint): void;
  cameraPatch(camera: Camera): void;
  worldPoint(point: DiagramEditorPoint, camera?: Camera): DiagramEditorPoint;
  pointerDown(event: PointerEvent): void;
  pointerMove(event: PointerEvent): void;
  pointerUp(event: PointerEvent): void;
  pointerCancel(event: PointerEvent): void;
  lostPointerCapture(event: PointerEvent): void;
  wheel(event: WheelEvent): void;
  blur(): void;
  dispose(): void;
}
interface DragPoints {
  start: DiagramEditorPoint;
  last: DiagramEditorPoint;
}
/** A resize or bend drag, started on a selection handle. */
interface HandleDrag extends DragPoints {
  type: 'resize' | 'bend';
  id: string;
  index: number;
  origin: DiagramAuthoringBundle;
  originPoints: DiagramEditorPoint[];
  active: boolean;
}
type Drag =
  | (DragPoints & { type: 'pan'; camera: Camera; active?: boolean })
  | (DragPoints & { type: 'marquee'; additive: boolean; base: string[]; active?: boolean })
  | (DragPoints & {
      type: 'move';
      id: string;
      ids: string[];
      origin: DiagramAuthoringBundle | null;
      active: boolean;
    })
  | (DragPoints & { type: 'connect'; id: string; side: string; active?: false })
  | HandleDrag;

const SVG = 'http://www.w3.org/2000/svg';
const boundsOf = (bundle: DiagramAuthoringBundle) => {
  // The filter keeps the placements that have bounds.
  const rects = bundle.presentation.elements
    .map((item) => item.bounds)
    .filter(Boolean) as DiagramBounds[];
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
const intersect = (a: DiagramBounds | null, b: DiagramBounds) =>
  a &&
  b &&
  a.x <= b.x + b.width &&
  a.x + a.width >= b.x &&
  a.y <= b.y + b.height &&
  a.y + a.height >= b.y;

/** The drawing surface: camera, per-element SVG reconciliation, selection overlays and gestures. */
export function createEditorCanvas(ctx: DiagramEditorContext): DiagramEditorCanvas {
  const { doc, win, session, dom } = ctx;
  const { shell, stage, svg, world, overlays } = dom;
  const current = ctx.current,
    report = ctx.report;
  const elementNodes = new Map<string, SVGElement>(),
    renderSignatures = new Map<string, string>();
  let renderedDigest = '',
    renderedOrder = '',
    renderedCanvasPalette: 'light' | 'dark' | null = null,
    drag: Drag | null = null,
    raf = 0,
    tempPan = false;
  let tool: DiagramEditorTool = 'select';
  // Initial phone framing favors readable labels; the explicit Fit command requests an overview.
  let fitMinimumScale = ctx.layout.compact() ? 1 : 0;

  const editorTheme = (bundle: DiagramAuthoringBundle) =>
    ctx.prefersDark()
      ? bundle.presentation.theme.themeId === 'slate'
        ? 'slate'
        : 'midnight'
      : 'paper';
  const fromClient = (event: MouseEvent) => {
    const rect = svg.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const worldPoint = (point: DiagramEditorPoint, camera: Camera = current().view.camera) => ({
    x: (point.x - camera.x) / camera.scale,
    y: (point.y - camera.y) / camera.scale,
  });
  const cameraPatch = (camera: Camera) => session.setView({ camera });
  function fit(minimumScale = fitMinimumScale) {
    fitMinimumScale = minimumScale;
    const state = current();
    if (!state.bundle) return;
    const rect = stage.getBoundingClientRect(),
      bounds = boundsOf(state.bundle),
      pad = 72;
    const scale = Math.min(
      1.6,
      Math.max(
        Math.max(0.04, minimumScale),
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
  function zoom(factor: number, around?: DiagramEditorPoint) {
    const camera = current().view.camera,
      point = around ?? { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
    const scale = Math.min(4, Math.max(0.04, camera.scale * factor)),
      anchor = worldPoint(point, camera);
    cameraPatch({ x: point.x - anchor.x * scale, y: point.y - anchor.y * scale, scale, fit: null });
  }
  function draw(event: DrawEvent = { type: 'initial', affectedIds: [] }) {
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
      palette = authoredDiagramPalette(
        theme,
        bundle.schemaVersion === '1.1.0' ? bundle.studioPresentation : undefined,
      ),
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
      if (!source) continue;
      if (!elementNodes.has(id) || affected.has(id) || forceAll) {
        const signature = JSON.stringify([
          source,
          entry,
          emphasis.get(id) ?? null,
          theme,
          (bundle.schemaVersion === '1.1.0' ? bundle.studioPresentation : undefined) ?? null,
          source?.collection === 'relations'
            ? [placements.get(source.value.from), placements.get(source.value.to)]
            : null,
        ]);
        if (!elementNodes.has(id) || renderSignatures.get(id) !== signature) {
          const scene = resolveDiagramSceneElement(
            source,
            entry,
            placements,
            order,
            emphasis.get(id) ?? null,
          );
          const xml = parser.parseFromString(
            '<svg xmlns="' +
              SVG +
              '">' +
              renderAuthoredSceneElement(
                scene,
                palette,
                `${ctx.scopedId('drawing')}-${bundle.diagramId}`,
              ) +
              '</svg>',
            'image/svg+xml',
          );
          const rendered = xml.documentElement.firstElementChild;
          if (!rendered) throw new TypeError(`Element ${id} rendered no SVG markup.`);
          // An image/svg+xml document holds SVG elements.
          const replacement = doc.importNode(rendered as SVGElement, true);
          replacement.setAttribute('tabindex', '-1');
          replacement.setAttribute('role', 'img');
          const old = elementNodes.get(id);
          if (old) old.replaceWith(replacement);
          else world.append(replacement);
          elementNodes.set(id, replacement);
          renderSignatures.set(id, signature);
        }
      }
      // The branch above rendered every element that had no node.
      const node = elementNodes.get(id) as SVGElement;
      // A connector is named by its endpoints, so its name can change without a redraw.
      const name = displayName(byId, id);
      if (node.getAttribute('aria-label') !== name) node.setAttribute('aria-label', name);
      const selected = selection.has(id);
      const selectionChanged = node.dataset.selected !== String(selected);
      if (selectionChanged) node.dataset.selected = String(selected);
      if (node.classList.contains('de-selected') !== selected)
        node.classList.toggle('de-selected', selected);
      if (
        source?.collection === 'relations' &&
        (selectionChanged || selected || affected.has(id) || forceAll)
      )
        traceRoute(node, selected, camera.scale);
    }
    // Keep stable primitives; reordering moves only nodes whose source order changed.
    if (event.type === 'content' || event.type === 'refresh' || forceAll) {
      const ordered = bundle.presentation.elements
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => a.entry.zIndex - b.entry.zIndex || a.index - b.index);
      const orderStamp = JSON.stringify(ordered.map(({ entry }) => entry.elementId));
      if (forceAll || renderedOrder !== orderStamp) {
        for (const { entry } of ordered)
          world.append(elementNodes.get(entry.elementId) as SVGElement);
        renderedOrder = orderStamp;
      }
    }
    renderedDigest = bundle.bundleDigest;
    shell.dataset.diagramTheme = theme;
    const canvasPalette = bundle.schemaVersion === '1.1.0' ? bundle.studioPresentation.theme : null;
    if (renderedCanvasPalette !== canvasPalette) {
      renderedCanvasPalette = canvasPalette;
      if (canvasPalette) {
        stage.style.backgroundColor = palette.background;
        stage.style.backgroundImage = `radial-gradient(color-mix(in srgb, ${palette.border} 24%, transparent) 0.8px, transparent 0.8px)`;
        // Drawn selection and handles share the saved canvas palette; host chrome owns its theme.
        svg.style.setProperty('--de-primary', palette.accent);
        svg.style.setProperty('--de-panel', palette.fills.surface);
      } else {
        stage.style.removeProperty('background-color');
        stage.style.removeProperty('background-image');
        svg.style.removeProperty('--de-primary');
        svg.style.removeProperty('--de-panel');
      }
    }
    renderOverlays(state, bundle, selection);
    ctx.chrome.render(state);
  }
  function svgElement(tag: string, attributes: Record<string, string | number>) {
    const node = doc.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    return node;
  }
  /**
   * Trace a selected connector's route in the accent inside its own group, so its label still
   * paints on top; one screen pixel wider than the line and never under 2px.
   */
  function traceRoute(node: SVGElement, selected: boolean, scale: number) {
    const route = node.querySelector(':scope > path'),
      existing = node.querySelector(':scope > .de-selection-route');
    if (!selected || !route) {
      existing?.remove();
      return;
    }
    const trace =
      existing ?? svgElement('path', { class: 'de-selection-route', 'pointer-events': 'none' });
    if (!existing) route.after(trace);
    for (const name of ['d', 'stroke-dasharray', 'stroke-linecap']) {
      const value = route.getAttribute(name);
      if (value === null) trace.removeAttribute(name);
      else trace.setAttribute(name, value);
    }
    const width = Number(route.getAttribute('stroke-width')) || 0;
    trace.setAttribute('stroke-width', String(Math.max(width + 1 / scale, 2 / scale)));
  }
  /** A handle drawn small inside a larger transparent target that takes the pointer. */
  function handleGroup(attributes: Record<string, string | number>, parts: SVGElement[]) {
    const group = svgElement('g', { class: 'de-handle', ...attributes });
    group.append(...parts);
    return group;
  }
  function renderOverlays(
    state: DiagramEditorState,
    bundle: DiagramAuthoringBundle,
    selection: Set<string>,
  ) {
    overlays.replaceChildren();
    const selectedId = state.view.selection.length === 1 ? state.view.selection[0] : null;
    const selectedBounds = selectedId ? session.geometry(selectedId)?.bounds : null;
    const showContext =
      !drag &&
      ctx.editable(state) &&
      !!selectedBounds &&
      bundle.document.nodes.some((node) => node.id === selectedId);
    dom.contextTools.hidden = !showContext;
    if (showContext && selectedBounds) {
      const camera = state.view.camera;
      const width = dom.contextTools.getBoundingClientRect().width;
      dom.contextTools.style.left = `${Math.max(
        8,
        Math.min(
          stage.clientWidth - width - 8,
          camera.x + (selectedBounds.x + selectedBounds.width / 2) * camera.scale - width / 2,
        ),
      )}px`;
      dom.contextTools.style.top = `${Math.max(
        8,
        Math.min(
          stage.clientHeight - 132,
          camera.y + (selectedBounds.y + selectedBounds.height) * camera.scale + 12,
        ),
      )}px`;
    }
    const scale = state.view.camera.scale,
      byPlacement = new Map(bundle.presentation.elements.map((item) => [item.elementId, item]));
    for (const id of selection) {
      const geometry = session.geometry(id),
        rect = geometry?.bounds ?? geometry?.labelBounds;
      if (rect) {
        // Drawn 4px outside the bounds, so every shape's own outline stays visible inside it.
        const box = svgElement('rect', {
          x: rect.x - 4 / scale,
          y: rect.y - 4 / scale,
          width: rect.width + 8 / scale,
          height: rect.height + 8 / scale,
          class: 'de-selection-box',
          'stroke-width': 2 / scale,
          'pointer-events': 'none',
        });
        overlays.append(box);
        if (
          selection.size === 1 &&
          ctx.editable(state) &&
          byPlacement.get(id)?.bounds &&
          !(byPlacement.get(id) as DiagramPlacement).locks.size
        ) {
          const [x, y] = [rect.x + rect.width + 4 / scale, rect.y + rect.height + 4 / scale];
          const square = (size: number, attributes: Record<string, string | number>) =>
            svgElement('rect', {
              x: x - size / 2,
              y: y - size / 2,
              width: size,
              height: size,
              ...attributes,
            });
          overlays.append(
            handleGroup({ 'data-handle': 'resize', 'data-handle-id': id }, [
              square((ctx.layout.compact() ? 44 : 24) / scale, { class: 'de-handle-hit' }),
              square(8 / scale, { class: 'de-resize-handle', 'stroke-width': 1.5 / scale }),
            ]),
          );
        }
      }
      if (
        rect &&
        selection.size === 1 &&
        ctx.editable(state) &&
        bundle.document.nodes.some((node) => node.id === id)
      ) {
        const ports = [
          ['top', rect.x + rect.width / 2, rect.y - 12 / scale],
          ['right', rect.x + rect.width + 12 / scale, rect.y + rect.height / 2],
          ['bottom', rect.x + rect.width / 2, rect.y + rect.height + 12 / scale],
          ['left', rect.x - 12 / scale, rect.y + rect.height / 2],
        ] as const;
        for (const [side, x, y] of ports) {
          const circle = (radius: number, attributes: Record<string, string | number>) =>
            svgElement('circle', { cx: x, cy: y, r: radius / scale, ...attributes });
          overlays.append(
            handleGroup(
              {
                'data-handle': 'connect',
                'data-handle-id': id,
                'data-side': side,
                role: 'button',
                tabindex: 0,
                'aria-label': `Connect from ${side} of ${displayName(elementIndex(bundle.document), id)}`,
              },
              [
                circle(ctx.layout.compact() ? 22 : 14, { class: 'de-handle-hit' }),
                circle(6, { class: 'de-connection-port', 'stroke-width': 1.5 / scale }),
              ],
            ),
          );
        }
      }
      if (geometry?.points?.length && ctx.editable(state))
        for (let index = 1; index < geometry.points.length - 1; index++) {
          const point = geometry.points[index];
          const circle = (radius: number, attributes: Record<string, string | number>) =>
            svgElement('circle', { cx: point.x, cy: point.y, r: radius, ...attributes });
          overlays.append(
            handleGroup({ 'data-handle': 'bend', 'data-index': index, 'data-handle-id': id }, [
              circle((ctx.layout.compact() ? 22 : 12) / scale, { class: 'de-handle-hit' }),
              circle(4 / scale, { class: 'de-bend-handle', 'stroke-width': 1.5 / scale }),
            ]),
          );
        }
    }
    if (drag?.type === 'connect') {
      const a = worldPoint(drag.start),
        b = worldPoint(drag.last);
      overlays.append(
        svgElement('line', {
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          class: 'de-connection-preview',
          'stroke-width': 2 / scale,
          'pointer-events': 'none',
        }),
      );
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
  function pointerDown(event: PointerEvent) {
    const { select } = ctx.commands;
    if (event.button !== 0 || !current().bundle || ctx.dialogs.active() || focusable(event.target))
      return;
    // Pointer events target elements.
    const state = current(),
      start = fromClient(event),
      target = (event.target as Element).closest('[data-element-id]'),
      handle = (event.target as Element).closest<SVGElement>('[data-handle]');
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
    if (handle?.dataset.handle === 'connect') {
      drag = {
        type: 'connect',
        id: id as string,
        side: handle.dataset.side ?? 'right',
        start,
        last: start,
      };
    } else if (handle) {
      // Every handle carries its element id, and renderOverlays draws only resize and bend handles.
      if (!state.view.selection.includes(id as string) && !select([id as string]).ok) return;
      drag = {
        type: handle.dataset.handle,
        id,
        index: Number(handle.dataset.index),
        start,
        last: start,
        origin: state.bundle,
        originPoints: session.geometry(id as string)?.points ?? [],
        active: false,
      } as HandleDrag;
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
    if (
      !drag ||
      drag.type === 'connect' ||
      !drag.active ||
      drag.type === 'marquee' ||
      drag.type === 'pan'
    )
      return;
    const state = current(),
      scale = state.view.camera.scale;
    const dx = (drag.last.x - drag.start.x) / scale,
      dy = (drag.last.y - drag.start.y) / scale;
    let command: DiagramCommand;
    if (drag.type === 'move') {
      const x = state.view.snap ? Math.round(dx / 8) * 8 : Math.round(dx),
        y = state.view.snap ? Math.round(dy / 8) * 8 : Math.round(dy);
      command = { type: 'move', ids: drag.ids, dx: x, dy: y };
    } else {
      // A resize or bend drag, whose element has a placement in its origin; the callback cannot
      // see that narrowing.
      // biome-ignore format: bundles keep this one-line call; wrapping would change their bytes.
      const place = drag.origin.presentation.elements.find((item) => item.elementId === (drag as HandleDrag).id),
        before = geometryFields(place as DiagramPlacement),
        after = clone(before);
      if (drag.type === 'resize') {
        if (!before.bounds || !after.bounds) return;
        after.bounds.width = Math.max(24, Math.round(before.bounds.width + dx));
        after.bounds.height = Math.max(24, Math.round(before.bounds.height + dy));
      }
      if (drag.type === 'bend') {
        if (!after.route) return;
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
  function pointerMove(event: PointerEvent) {
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
    if (drag.type === 'marquee' || drag.type === 'connect') {
      // A marquee starts only on a readable diagram.
      // biome-ignore format: bundles keep these one-line arguments; wrapping would change their bytes.
      renderOverlays(current(), ctx.displayed(current()) as DiagramAuthoringBundle, new Set(current().view.selection));
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
      // Respond to the first movement immediately; continuing moves coalesce below.
      previewDrag();
      return;
    }
    if (drag.active && !raf) raf = win.requestAnimationFrame(previewDrag);
  }
  function finishPointer(event: PointerEvent | null, cancel = false) {
    if (!drag) return;
    if (raf) {
      win.cancelAnimationFrame(raf);
      raf = 0;
      if (drag.active && !cancel) previewDrag();
    }
    const finished = drag;
    drag = null;
    if (finished.type === 'connect' && !cancel) {
      const query = session.query({ x: finished.last.x, y: finished.last.y, tolerance: 8 });
      const bundle = current().bundle;
      const target =
        query.ok && bundle
          ? query.hits.find((hit) => bundle.document.nodes.some((node) => node.id === hit.id))?.id
          : null;
      if (target)
        ctx.commands.act('connect-drag', { from: finished.id, to: target, side: finished.side });
      else
        ctx.notice(
          'Release on another shape to connect. Use the inspector for keyboard connections.',
        );
    } else if (finished.active) {
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
  function wheel(event: WheelEvent) {
    // Wheel events target elements.
    if (!(event.target as Element).closest('.de-canvas')) return;
    event.preventDefault();
    const point = fromClient(event);
    if (event.ctrlKey || event.metaKey) zoom(Math.exp(-event.deltaY * 0.002), point);
    else {
      const camera = current().view.camera;
      cameraPatch({ ...camera, x: camera.x - event.deltaX, y: camera.y - event.deltaY, fit: null });
    }
  }
  function pointerUp(event: PointerEvent) {
    finishPointer(event);
  }
  function pointerCancel(event: PointerEvent) {
    finishPointer(event, true);
  }
  function lostPointerCapture(event: PointerEvent) {
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
