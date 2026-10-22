import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cameraFromScreenTranslate } from '@openplanr/canvas';
import {
  makeBundle,
  placement,
  sealBundle,
} from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { createDiagramEditorSession } from '../lib/artifact/diagram/editor/index.mjs';
import { readEditorState } from '../lib/artifact/diagram/editor/session-view.mjs';
import { createEditorCanvas } from '../lib/artifact/ui/diagram-editor-canvas.mjs';
import { createEditorKeyboard } from '../lib/artifact/ui/diagram-editor-keyboard.mjs';
import { renderDiagramProperties } from '../lib/artifact/ui/diagram-editor-properties.mjs';
import {
  renderEditorControls,
  renderEditorSkeleton,
} from '../lib/artifact/ui/diagram-editor-template.mjs';
import { canvasDiagram } from './fixtures/diagram-editor-canvas.mjs';

const { JSDOM } = createRequire(new URL('../../protocol/package.json', import.meta.url))('jsdom');
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
function diagram(count = 2) {
  const bundle = makeBundle('flowchart', { blank: true });
  for (let index = 0; index < count; index++) {
    const id = `node-${index}`;
    bundle.document.nodes.push({ id, label: `Step ${index}`, kind: 'process', description: null });
    bundle.document.accessibility.readingOrder.push(id);
    bundle.presentation.elements.push(placement(id, 'rectangle', 40 + index * 240, 60));
  }
  return sealBundle(bundle);
}
function fixture(
  t,
  {
    count = 2,
    bundle = diagram(count),
    flushInitial = true,
    camera = { x: 0, y: 0, scale: 1, fit: null },
    compact = false,
    viewport = { width: 800, height: 600 },
  } = {},
) {
  const dom = new JSDOM('<!doctype html><main></main>', { pretendToBeVisual: true });
  const win = dom.window,
    doc = win.document,
    scopedId = (name) => `camera-test-${name}`;
  let time = 0,
    frameId = 0,
    chromeRenders = 0;
  const frames = new Map(),
    observers = [];
  win.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      observers.push(this);
    }
    observe(target) {
      this.targets.add(target);
    }
    disconnect() {}
  };
  win.requestAnimationFrame = (callback) => {
    frames.set(++frameId, callback);
    return frameId;
  };
  win.cancelAnimationFrame = (id) => frames.delete(id);
  const flush = () => {
    for (let iteration = 0; frames.size; iteration++) {
      assert.ok(iteration < 30, 'Canvas frames settle without a camera feedback loop');
      const pending = [...frames.values()];
      frames.clear();
      time += 16;
      for (const callback of pending) callback(time);
    }
  };
  const skeleton = renderEditorSkeleton(doc, scopedId);
  doc.querySelector('main').append(skeleton.shell);
  const elements = {
    ...skeleton,
    ...renderEditorControls(doc, skeleton, { scopedId, actions: [], panels: [] }),
  };
  const rect = {
    x: 24,
    y: 36,
    left: 24,
    top: 36,
    right: 24 + viewport.width,
    bottom: 36 + viewport.height,
    width: viewport.width,
    height: viewport.height,
  };
  elements.stage.getBoundingClientRect = () => rect;
  elements.svg.getBoundingClientRect = () => rect;
  Object.defineProperties(elements.stage, {
    clientWidth: { value: viewport.width },
    clientHeight: { value: viewport.height },
  });
  const captured = new Set();
  elements.stage.setPointerCapture = (id) => captured.add(id);
  elements.stage.hasPointerCapture = (id) => captured.has(id);
  elements.stage.releasePointerCapture = (id) => captured.delete(id);
  const session = createDiagramEditorSession({
    bundle,
    acknowledged: true,
  });
  assert.equal(session.setView({ camera, snap: false }).ok, true);
  const ctx = {
    doc,
    win,
    session,
    dom: elements,
    scopedId,
    current: () => readEditorState(session),
    displayed: (state) => state.gesture?.bundle ?? state.bundle,
    isDisposed: () => false,
    editable: () => true,
    prefersDark: () => false,
    notice() {},
    report(message) {
      assert.equal(message, '', message);
    },
    layout: { compact: () => compact, drawer: () => false },
    chrome: {
      render() {
        chromeRenders++;
      },
      railOpen: () => false,
      overflowOpen: () => false,
    },
    dialogs: { active: () => null },
    inspector: { dirty: () => false, guardDraft: () => true },
    outline: {},
    commands: {
      select: (selection) => session.setView({ selection }),
      submit: (command) => session.submit(command),
      hasClipboard: () => false,
      useTool: (tool) => ctx.canvas.setTool(tool),
    },
  };
  const canvas = createEditorCanvas(ctx);
  ctx.canvas = canvas;
  const keyboard = createEditorKeyboard(ctx);
  for (const [event, handler] of [
    ['pointerdown', canvas.pointerDown],
    ['pointermove', canvas.pointerMove],
    ['pointerup', canvas.pointerUp],
    ['pointercancel', canvas.pointerCancel],
  ])
    elements.stage.addEventListener(event, handler);
  doc.addEventListener('keydown', keyboard.keydown);
  doc.addEventListener('keyup', keyboard.keyup);
  const unsubscribe = session.subscribe((event) => canvas.draw(event));
  canvas.draw();
  if (flushInitial) flush();
  const pointer = (type, x, y, { target = elements.stage, button = 0 } = {}) => {
    const event = new win.MouseEvent(type, {
      clientX: x + rect.left,
      clientY: y + rect.top,
      button,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
    target.dispatchEvent(event);
    return event;
  };
  const key = (value, options = {}) => {
    const event = new win.KeyboardEvent('keydown', {
      key: value,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    doc.activeElement.dispatchEvent(event);
    return event;
  };
  t.after(() => {
    unsubscribe();
    canvas.dispose();
    session.dispose();
    win.close();
  });
  return {
    ...elements,
    canvas,
    controller: canvas.controller,
    session,
    doc,
    win,
    flush,
    advance: (milliseconds) => {
      time += milliseconds;
    },
    pointer,
    key,
    invalidateObserver: () => {
      const observer = observers.find((item) => item.targets.has(elements.contextTools));
      assert.ok(observer, 'Editor observes stage origin and context tools');
      observer.callback([{ target: elements.stage, contentRect: rect }]);
    },
    chromeRenders: () => chromeRenders,
    element: (id) => elements.world.querySelector(`[data-element-id="${id}"]`),
  };
}

test('zoom clamps and stored screen translation preserve world positions', (t) => {
  const stored = { x: -137, y: 89, scale: 0.625, fit: null },
    f = fixture(t, { camera: stored });
  assert.deepEqual(f.controller.getCamera(), cameraFromScreenTranslate(stored));
  const point = { x: 320, y: -45 },
    screen = f.controller.worldToScreen(point);
  close(screen.x, point.x * stored.scale + stored.x, 'Restored screen x');
  close(screen.y, point.y * stored.scale + stored.y, 'Restored screen y');
  assert.deepEqual(f.canvas.worldPoint(screen), point);
  f.canvas.zoom(1000);
  f.flush();
  assert.equal(f.controller.getCamera().zoom, 4);
  assert.equal(f.session.getState().view.camera.scale, 4);
  f.canvas.zoom(0.000001);
  f.flush();
  assert.equal(f.controller.getCamera().zoom, 0.04);
  assert.equal(f.session.getState().view.camera.scale, 0.04);
});

test('Ctrl and Cmd wheel use the shared per-event exponential zoom curve', (t) => {
  const f = fixture(t);
  for (const modifier of ['ctrlKey', 'metaKey'])
    for (const deltaY of [1, 5, -5, 100, -100]) {
      f.controller.setCamera({ x: 0, y: 0, zoom: 1 });
      f.flush();
      const event = new f.win.WheelEvent('wheel', {
        deltaY,
        [modifier]: true,
        clientX: 324,
        clientY: 236,
        bubbles: true,
        cancelable: true,
      });
      f.stage.dispatchEvent(event);
      f.flush();
      close(
        f.controller.getCamera().zoom,
        Math.min(1.25, Math.max(0.8, Math.exp(-deltaY * 0.01))),
        `${modifier} deltaY=${deltaY}`,
      );
      assert.equal(event.defaultPrevented, true);
    }
});

test('empty drag marquee selects intersecting elements without moving the camera', (t) => {
  const f = fixture(t),
    before = f.controller.getCamera();
  f.pointer('pointerdown', 20, 40);
  f.pointer('pointermove', 200, 150);
  f.pointer('pointerup', 200, 150);
  f.flush();
  assert.deepEqual(f.session.getState().view.selection, ['node-0']);
  assert.deepEqual(f.controller.getCamera(), before);
});

test('arrows nudge the selection once while leaving the camera unchanged', (t) => {
  const f = fixture(t);
  f.session.setView({ selection: ['node-0'] });
  f.stage.focus();
  f.flush();
  const before = f.controller.getCamera();
  f.key('ArrowRight');
  f.key('ArrowDown', { shiftKey: true });
  f.flush();
  assert.equal(f.session.geometry('node-0').bounds.x, 41);
  assert.equal(f.session.geometry('node-0').bounds.y, 70);
  assert.deepEqual(f.controller.getCamera(), before);
});

test('Space, middle button and Pan tool pan without selecting or editing', (t) => {
  for (const mode of ['space', 'middle', 'tool']) {
    const f = fixture(t);
    f.stage.focus();
    if (mode === 'space') f.key(' ', { code: 'Space' });
    if (mode === 'tool') f.canvas.setTool('pan');
    const before = f.controller.getCamera();
    f.pointer('pointerdown', 60, 80, { button: mode === 'middle' ? 1 : 0 });
    f.pointer('pointermove', 140, 130);
    f.pointer('pointerup', 140, 130);
    f.flush();
    close(f.controller.getCamera().x, before.x - 80, `${mode} pan x`);
    close(f.controller.getCamera().y, before.y - 50, `${mode} pan y`);
    assert.deepEqual(f.session.getState().view.selection, [], mode);
    assert.equal(f.session.getState().pendingCount, 0, mode);
    assert.equal(f.session.getState().gesture, null, mode);
    if (mode === 'space')
      f.doc.dispatchEvent(
        new f.win.KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }),
      );
    f.canvas.setTool('select');
    f.pointer('pointerdown', 500, 400);
    f.pointer('pointermove', 520, 420);
    assert.ok(f.overlays.querySelector('.de-marquee'), `${mode} releases pan ownership`);
    f.pointer('pointercancel', 520, 420);
  }
});

test('engine and external session camera changes cross the persistence seam once', (t) => {
  const f = fixture(t);
  let views = 0,
    cameras = 0;
  const setView = f.session.setView,
    setCamera = f.controller.setCamera;
  f.session.setView = (...args) => {
    views++;
    return setView(...args);
  };
  f.controller.setCamera = (...args) => {
    cameras++;
    return setCamera(...args);
  };
  f.controller.setCamera({ x: 32, y: -18, zoom: 1 });
  f.flush();
  assert.equal(views, 1, 'One engine camera event persists once');
  assert.equal(cameras, 1, 'Persisted session camera does not feed back into setCamera');
  views = 0;
  cameras = 0;
  f.session.setView({ camera: { x: 110, y: -70, scale: 1.25, fit: null } });
  f.flush();
  assert.equal(views, 1, 'External session camera is not written back');
  assert.equal(cameras, 1, 'External session camera reaches the engine once');
  assert.deepEqual(f.controller.getCamera(), { x: -88, y: 56, zoom: 1.25 });
});

test('camera frames preserve scene nodes, overlays and chrome while updating the zoom label', (t) => {
  const f = fixture(t);
  f.session.setView({ selection: ['node-0'] });
  f.flush();
  const nodes = [...f.world.children],
    overlays = [...f.overlays.children],
    renders = f.chromeRenders();
  let replacements = 0;
  const replaceChildren = f.overlays.replaceChildren.bind(f.overlays);
  f.overlays.replaceChildren = (...children) => {
    replacements++;
    replaceChildren(...children);
  };
  for (let frame = 0; frame < 5; frame++) {
    f.controller.panBy(2, 3);
    f.controller.zoomAt(1.01);
    f.flush();
  }
  assert.equal(f.world.children.length, nodes.length);
  assert.equal(f.overlays.children.length, overlays.length);
  nodes.forEach((node, index) => {
    assert.equal(f.world.children[index], node);
  });
  overlays.forEach((node, index) => {
    assert.equal(f.overlays.children[index], node);
  });
  assert.equal(replacements, 0);
  assert.equal(f.chromeRenders(), renders);
  assert.equal(f.zoomValue.textContent, `${Math.round(1.01 ** 5 * 100)}%`);
  assert.equal(f.world.hasAttribute('transform'), false);
  assert.equal(f.overlays.hasAttribute('transform'), false);
});

test('zoom settling keeps selection overlays drawn at the current zoom', async (t) => {
  const f = fixture(t);
  f.controller.zoomAt(1.5);
  f.flush();
  f.session.setView({ selection: ['node-0'] });
  f.flush();
  const box = f.overlays.querySelector('.de-selection-box');
  assert.ok(box, 'The selection outline is drawn');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(box.isConnected, true, 'Settling does not replace overlays drawn at this zoom');
});

test('culling starts above 500 elements and preserves order, selection, focus and host pins', async (t) => {
  for (const count of [500, 501]) {
    const f = fixture(t, { count }),
      order = [...f.world.children].map((element) => element.dataset.elementId);
    assert.equal(f.world.children.length, count);
    assert.equal(f.element('node-499').style.display === 'none', count > 500);
    if (count === 500) continue;
    f.session.setView({ selection: ['node-499'] });
    f.controller.setPinned('host-editor', ['node-498']);
    assert.equal(f.session.beginGesture().ok, true);
    assert.equal(
      f.session.previewGesture({ type: 'move', ids: ['node-495'], dx: 1, dy: 0 }).ok,
      true,
    );
    f.flush();
    assert.notEqual(f.element('node-495').style.display, 'none', 'Active edit stays mounted');
    assert.equal(f.session.cancelGesture().ok, true);
    f.flush();
    assert.equal(f.element('node-495').style.display, 'none', 'Completed edit releases its pin');
    assert.notEqual(f.element('node-499').style.display, 'none', 'Selection stays mounted');
    assert.notEqual(f.element('node-498').style.display, 'none', 'Host edit pin stays mounted');
    const focused = f.controller.focusNode('node-497');
    f.flush();
    await focused;
    f.controller.setCamera({ x: 0, y: 0, zoom: 1 });
    f.flush();
    assert.notEqual(
      f.element('node-497').style.display,
      'none',
      'Focused node stays mounted after pan',
    );
    assert.notEqual(f.element('node-499').style.display, 'none');
    assert.equal(f.element('node-496').style.display, 'none');
    assert.deepEqual(
      [...f.world.children].map((element) => element.dataset.elementId),
      order,
    );
    assert.deepEqual(
      f.session.getState().bundle,
      diagram(count),
      'Culling leaves authored output unchanged',
    );
  }
});

test('stage zoom keys have one owner and editable controls do not trigger them', (t) => {
  const f = fixture(t);
  let zooms = 0;
  const zoomAt = f.controller.zoomAt;
  f.controller.zoomAt = (...args) => {
    zooms++;
    return zoomAt(...args);
  };
  f.stage.focus();
  f.key('+');
  f.flush();
  assert.equal(zooms, 1, 'Plus invokes one engine zoom');
  assert.equal(f.controller.getCamera().zoom, 1.25);
  f.key('-');
  f.flush();
  assert.equal(zooms, 2, 'Minus invokes one engine zoom');
  assert.equal(f.controller.getCamera().zoom, 1);
  f.key('+');
  f.flush();
  f.key('0');
  f.flush();
  assert.equal(f.controller.getCamera().zoom, 1, 'Zero resets the engine zoom');
  const input = f.doc.createElement('input');
  f.stage.append(input);
  input.focus();
  const before = f.controller.getCamera(),
    count = zooms;
  f.key('+');
  f.key('ArrowRight');
  f.flush();
  assert.equal(zooms, count);
  assert.deepEqual(f.controller.getCamera(), before);
  assert.equal(f.session.getState().pendingCount, 0);
});

test('editor pointer coordinates measure once per gesture and never in pointermove', (t) => {
  const f = fixture(t);
  let reads = 0;
  const measure = f.stage.getBoundingClientRect;
  f.stage.getBoundingClientRect = () => {
    reads++;
    return measure();
  };
  const drag = () => {
    const before = reads;
    f.pointer('pointerdown', 600, 400);
    assert.equal(reads, before + 1, 'Each gesture refreshes its stage origin');
    for (let step = 0; step < 10; step++) {
      f.win.dispatchEvent(new f.win.Event('scroll'));
      f.win.dispatchEvent(new f.win.Event('resize'));
      f.invalidateObserver();
      const afterInvalidation = reads;
      f.pointer('pointermove', 610 + step, 410 + step);
      assert.equal(reads, afterInvalidation, 'Pointermove never reads layout after invalidation');
    }
    const beforeRelease = reads;
    f.pointer('pointercancel', 620, 420);
    assert.equal(reads, beforeRelease, 'Releasing the pointer does not remeasure its origin');
  };
  drag();
  drag();
});

test('editor fit respects host chrome safe area, padding and maximum zoom', (t) => {
  const f = fixture(t);
  f.controller.setChrome({
    id: 'inspector',
    edge: 'left',
    rect: { x: 0, y: 0, width: 200, height: 600 },
    open: true,
  });
  f.controller.setChrome({
    id: 'toolbar',
    edge: 'top',
    rect: { x: 0, y: 0, width: 800, height: 100 },
    open: true,
  });
  f.flush();
  const area = f.controller.getSafeArea();
  assert.deepEqual(area, { x: 212, y: 112, width: 576, height: 476 });
  f.canvas.fit();
  f.flush();
  const camera = f.controller.getCamera(),
    topLeft = f.controller.worldToScreen({ x: 40, y: 60 }),
    bottomRight = f.controller.worldToScreen({ x: 420, y: 130 });
  close(camera.zoom, (area.width - 144) / 380, 'Fit reserves 72 pixels at both horizontal edges');
  close(topLeft.x, area.x + 72, 'Left fit padding');
  close(bottomRight.x, area.x + area.width - 72, 'Right fit padding');
  assert.ok(topLeft.y >= area.y + 72);
  assert.ok(bottomRight.y <= area.y + area.height - 72);
  assert.equal(f.session.getState().view.camera.fit, 'all');
  f.controller.removeChrome('inspector');
  f.controller.removeChrome('toolbar');
  f.flush();
  f.canvas.fit();
  f.flush();
  assert.equal(f.controller.getCamera().zoom, 1.6, 'Fit never exceeds the editor maximum');
  assert.equal(f.session.getState().view.camera.fit, 'all');
});

test('compact initial fit keeps readable scale and explicit fit can show the full diagram', (t) => {
  const f = fixture(t, { compact: true, viewport: { width: 320, height: 480 } });
  f.canvas.fit();
  f.flush();
  assert.equal(f.controller.getCamera().zoom, 1, 'Compact framing retains the readable minimum');
  assert.equal(f.session.getState().view.camera.fit, 'all');
  f.canvas.fit(0);
  f.flush();
  close(f.controller.getCamera().zoom, (296 - 144) / 380, 'Explicit fit allows an overview');
  assert.equal(f.session.getState().view.camera.fit, 'all');
  f.canvas.fit();
  f.flush();
  close(
    f.controller.getCamera().zoom,
    0.4,
    'Subsequent fits preserve the explicit overview preference',
  );
});

test('camera-only frames retain content-sized SVG bounds and wrapper ownership', (t) => {
  const f = fixture(t);
  const snapshot = (svg) => ({
    viewBox: svg.getAttribute('viewBox'),
    width: svg.getAttribute('width'),
    height: svg.getAttribute('height'),
    left: svg.style.left,
    top: svg.style.top,
  });
  const drawings = [f.svg, f.overlaySvg],
    before = drawings.map(snapshot);
  for (const svg of drawings) {
    const [x, y, width, height] = svg.getAttribute('viewBox').split(' ').map(Number);
    assert.equal(svg.getAttribute('width'), String(width));
    assert.equal(svg.getAttribute('height'), String(height));
    assert.equal(svg.style.left, `${x}px`);
    assert.equal(svg.style.top, `${y}px`);
    assert.equal(svg.parentElement.namespaceURI, 'http://www.w3.org/1999/xhtml');
  }
  assert.notEqual(f.svg.parentElement, f.overlaySvg.parentElement);
  for (let frame = 0; frame < 8; frame++) {
    f.controller.panBy(12, -7);
    f.controller.zoomAt(1.1);
    f.flush();
  }
  assert.deepEqual(drawings.map(snapshot), before);
  assert.ok(f.svg.parentElement.style.transform.startsWith('scale('));
  assert.ok(f.overlaySvg.parentElement.style.transform.startsWith('scale('));
  assert.equal(f.world.hasAttribute('transform'), false);
  assert.equal(f.overlays.hasAttribute('transform'), false);
});

test('queued session selection changes retain the latest selection after engine events flush', (t) => {
  const f = fixture(t);
  const selections = [];
  f.session.subscribe((event) => {
    if (event.type === 'view') selections.push(f.session.getState().view.selection);
  });
  f.session.setView({ selection: ['node-0'] });
  f.session.setView({ selection: ['node-1'] });
  f.session.setView({ selection: ['node-0', 'node-1'] });
  f.flush();
  assert.deepEqual(f.session.getState().view.selection, ['node-0', 'node-1']);
  assert.deepEqual(f.controller.getSelection(), ['node-0', 'node-1']);
  assert.deepEqual(
    selections,
    [['node-0'], ['node-1'], ['node-0', 'node-1']],
    'Stale engine events do not write older selections into the session',
  );
});

for (const mode of ['move', 'resize']) {
  for (const finish of ['complete', 'cancel']) {
    test(`${mode} drag defers full canvas geometry until ${finish}`, (t) => {
      const f = fixture(t, { count: 501 });
      f.session.setView({ selection: ['node-0'] });
      f.flush();
      const indexed = [],
        geometryIds = [],
        sizeWrites = [];
      const setNodes = f.controller.setNodes,
        geometry = f.session.geometry;
      f.controller.setNodes = (nodes) => {
        indexed.push(nodes);
        return setNodes(nodes);
      };
      f.session.geometry = (id) => {
        geometryIds.push(id);
        return geometry(id);
      };
      for (const svg of [f.svg, f.overlaySvg]) {
        const setAttribute = svg.setAttribute.bind(svg);
        svg.setAttribute = (name, value) => {
          if (['viewBox', 'width', 'height'].includes(name)) sizeWrites.push([name, value]);
          setAttribute(name, value);
        };
      }
      const target =
        mode === 'resize'
          ? f.overlays.querySelector('[data-handle="resize"]')
          : f.element('node-0');
      assert.ok(target);
      const start = mode === 'resize' ? { x: 184, y: 134 } : { x: 70, y: 80 };
      f.pointer('pointerdown', start.x, start.y, { target });
      for (let frame = 1; frame <= 4; frame++) {
        f.pointer('pointermove', start.x + frame * 12, start.y + frame * 8);
        f.flush();
        assert.ok(f.session.getState().gesture, 'Pointer movement opens one editor gesture');
        assert.equal(indexed.length, 0, 'Open gestures never rebuild the full canvas node index');
        assert.equal(sizeWrites.length, 0, 'Open gestures never resize the static SVG worlds');
        assert.ok(
          !geometryIds.includes('node-250'),
          'Open gestures do not resolve untouched element geometry',
        );
      }
      f.pointer(finish === 'complete' ? 'pointerup' : 'pointercancel', start.x + 48, start.y + 32);
      f.flush();
      assert.equal(f.session.getState().gesture, null);
      assert.equal(indexed.length, 1, 'Ending the gesture rebuilds the full node index once');
      assert.equal(indexed[0].length, 501);
      assert.equal(geometryIds.filter((id) => id === 'node-250').length, 1);
      const bounds = geometry('node-0').bounds;
      if (finish === 'cancel') {
        assert.deepEqual(bounds, { x: 40, y: 60, width: 140, height: 70 });
        assert.equal(f.session.getState().pendingCount, 0);
      } else {
        assert.deepEqual(
          bounds,
          mode === 'move'
            ? { x: 88, y: 92, width: 140, height: 70 }
            : { x: 40, y: 60, width: 188, height: 102 },
        );
        assert.equal(f.session.getState().pendingCount, 1);
      }
      indexed.length = 0;
      geometryIds.length = 0;
      assert.equal(f.session.submit({ type: 'move', ids: ['node-1'], dx: 5, dy: 0 }).ok, true);
      f.flush();
      assert.equal(indexed.length, 1, 'A subsequent content change rebuilds the node index once');
      assert.equal(geometryIds.filter((id) => id === 'node-250').length, 1);
    });
  }
}

test('moving the stage without resizing refreshes the next gesture origin', (t) => {
  const f = fixture(t),
    initial = f.stage.getBoundingClientRect();
  f.pointer('pointerdown', 60, 80, { target: f.element('node-0') });
  f.pointer('pointerup', 60, 80, { target: f.element('node-0') });
  f.flush();
  assert.deepEqual(f.session.getState().view.selection, ['node-0']);
  const moved = { ...initial, left: initial.left + 240, top: initial.top + 40 };
  f.stage.getBoundingClientRect = () => moved;
  assert.equal(moved.width, initial.width);
  assert.equal(moved.height, initial.height);
  f.pointer('pointerdown', 300, 120, { target: f.element('node-0') });
  f.pointer('pointerup', 300, 120, { target: f.element('node-0') });
  f.flush();
  assert.deepEqual(f.session.getState().view.selection, ['node-0']);
  assert.equal(f.session.getState().pendingCount, 0);
});

test('property typing and apply edit the object selected after stage movement', (t) => {
  const f = fixture(t, { compact: true, viewport: { width: 390, height: 700 } });
  f.pointer('pointerdown', 600, 400);
  f.pointer('pointercancel', 600, 400);
  const initial = f.stage.getBoundingClientRect();
  f.stage.getBoundingClientRect = () => ({ ...initial, left: initial.left - 240 });
  f.pointer('pointerdown', 60, 80, { target: f.element('node-1') });
  f.pointer('pointerup', 60, 80, { target: f.element('node-1') });
  f.flush();
  renderDiagramProperties({
    root: f.propertiesPane,
    state: f.session.getState(),
    editable: true,
    act: (action) => assert.fail(`Typing dispatched editor action ${action}`),
    submitTransaction: (transaction) => f.session.submitTransaction(transaction),
  });
  const label = f.propertiesPane.querySelector('[aria-label="Label"]');
  assert.equal(label.value, 'Step 1');
  label.focus();
  label.value = 'Phone authoring';
  label.dispatchEvent(new f.win.Event('input', { bubbles: true }));
  const before = f.controller.getCamera();
  for (const key of ['ArrowRight', 'Backspace', ' ', 'h', 'v', '+', '-'])
    assert.equal(f.key(key).defaultPrevented, false, `${key} stays with the text input`);
  label.value = 'Phone authorin';
  label.dispatchEvent(new f.win.Event('input', { bubbles: true }));
  const apply = [...f.propertiesPane.querySelectorAll('button')].find(
    (button) => button.textContent === 'Apply changes',
  );
  assert.equal(apply.disabled, false);
  apply.click();
  f.flush();
  const nodes = f.session.getState().bundle.document.nodes;
  assert.equal(nodes.find((node) => node.id === 'node-1').label, 'Phone authorin');
  assert.equal(nodes.find((node) => node.id === 'node-0').label, 'Step 0');
  assert.deepEqual(f.controller.getCamera(), before);
});

test('records display writes per mounted-region update on a 5000-element diagram', (t) => {
  const f = fixture(t, {
    bundle: canvasDiagram(5000),
    flushInitial: false,
    camera: { x: 0, y: 0, scale: 0.04, fit: null },
  });
  let writes = 0,
    previous = 0;
  const batches = [];
  for (const element of f.world.children) {
    const style = element.style;
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(style), 'display');
    assert.equal(typeof descriptor?.get, 'function');
    assert.equal(typeof descriptor?.set, 'function');
    Object.defineProperty(style, 'display', {
      get: () => descriptor.get.call(style),
      set(value) {
        writes++;
        descriptor.set.call(style, value);
      },
    });
  }
  const off = f.controller.on('mount', (mounted) => {
    batches.push({ mounted: mounted.size, displayWrites: writes - previous });
    previous = writes;
  });
  t.after(off);
  f.flush();
  f.advance(121);
  f.controller.setCamera(f.controller.getCamera());
  f.flush();
  assert.equal(f.controller.getMountedIds().size, 5000);
  f.controller.setCamera({ x: 0, y: 0, zoom: 1 });
  f.flush();
  assert.ok(f.controller.getMountedIds().size < 5000);
  assert.ok(batches.length > 1);
  for (const batch of batches) assert.ok(batch.displayWrites <= 5000);
  t.diagnostic(
    JSON.stringify({
      elements: 5000,
      updates: batches.length,
      maximumDisplayWrites: Math.max(...batches.map((batch) => batch.displayWrites)),
      batches,
    }),
  );
});
