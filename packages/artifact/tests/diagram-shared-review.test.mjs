import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { makeBundle, sealBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { prepareAuthoredDiagramReviewBundle } from '../lib/artifact/diagram/review-bundle-browser.mjs';

const requireProtocol = createRequire(new URL('../../protocol/package.json', import.meta.url));
const { JSDOM } = requireProtocol('jsdom');
const { build } = requireProtocol('esbuild');
const compiled = await build({
  stdin: {
    contents: `export { mountDiagramSharedReview } from './diagram-shared-review.mts';`,
    resolveDir: new URL('../lib/artifact/ui/', import.meta.url).pathname,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  globalName: 'sharedReview',
  define: { 'import.meta.url': 'document.baseURI' },
  logLevel: 'silent',
});

async function fixture(t) {
  const dom = new JSDOM('<!doctype html><main></main>', {
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    url: 'https://share.test/diagram',
  });
  const win = dom.window;
  win.structuredClone = (value) => win.JSON.parse(JSON.stringify(value));
  win.TextEncoder = TextEncoder;
  Object.defineProperty(win.crypto, 'subtle', { value: webcrypto.subtle });
  win.FontFace = class {
    async load() {
      return this;
    }
  };
  Object.defineProperty(win.document, 'fonts', {
    value: { ready: Promise.resolve(), add() {}, async load() {}, check: () => true },
  });
  win.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const frames = new Map();
  let frameId = 0,
    time = 0;
  win.requestAnimationFrame = (callback) => {
    frames.set(++frameId, callback);
    return frameId;
  };
  win.cancelAnimationFrame = (id) => frames.delete(id);
  const flush = () => {
    for (let iteration = 0; frames.size; iteration++) {
      assert.ok(iteration < 30, 'Shared-review camera frames settle');
      const pending = [...frames.values()];
      frames.clear();
      time += 16;
      for (const callback of pending) callback(time);
    }
  };
  win.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 1200,
    bottom: 800,
    width: 1200,
    height: 800,
  });
  Object.defineProperties(win.HTMLElement.prototype, {
    clientWidth: { get: () => 1200 },
    clientHeight: { get: () => 800 },
  });
  win.eval(compiled.outputFiles[0].text);
  const root = win.document.querySelector('main');
  const authored = makeBundle('swimlane');
  authored.document.annotations[0].text = 'Note';
  const bundle = prepareAuthoredDiagramReviewBundle(sealBundle(authored));
  const controller = win.sharedReview.mountDiagramSharedReview({
    root,
    bundle: win.JSON.parse(JSON.stringify(bundle)),
    host: { reviewOf: 'a'.repeat(64) },
  });
  t.after(() => {
    controller.dispose();
    win.close();
  });
  await controller.ready;
  flush();
  return { root, controller, flush, bundle };
}

test('authored shared-review access changes immediately refresh host feedback actions', async (t) => {
  const { root, controller, flush } = await fixture(t);
  const actions = [
    ...root.querySelectorAll('[data-host-action="pin-comment"],[data-host-action="comment"]'),
  ];
  assert.equal(actions.length, 2);
  assert.ok(actions.every((button) => !button.hidden && !button.disabled));
  controller.setReadOnly(true);
  assert.ok(
    actions.every((button) => button.hidden && button.disabled),
    'Read-only access hides and disables feedback without a camera change',
  );
  controller.fit();
  flush();
  assert.ok(actions.every((button) => button.hidden && button.disabled));
  controller.setReadOnly(false);
  assert.ok(
    actions.every((button) => !button.hidden && !button.disabled),
    'Restoring feedback access refreshes the host immediately',
  );
});

test('authored shared-review pins retain saved world coordinates across camera changes', async (t) => {
  const { root, controller, flush, bundle } = await fixture(t);
  controller.updateReview({
    schemaVersion: '1.0.0',
    reviewId: 'review-1',
    reviewOf: 'a'.repeat(64),
    decision: 'pending',
    overall: '',
    pins: [
      {
        id: 'pin-1',
        artifactId: bundle.diagramId,
        region: { x: 0.35, y: 0.6, w: 0, h: 0 },
        viewport: { width: bundle.scene.width, height: bundle.scene.height },
        author: { name: 'Reviewer' },
        intent: 'question',
        status: 'open',
        comment: 'At this point',
        replies: [],
        createdAt: '2026-09-30T12:00:00Z',
        updatedAt: '2026-09-30T12:00:00Z',
      },
    ],
  });
  const position = () => {
    const pin = root.querySelector('[data-review-pin="pin-1"]');
    assert.ok(root.querySelector('[data-world]').contains(pin));
    return [pin.getAttribute('cx'), pin.getAttribute('cy')];
  };
  const before = position();
  root.querySelector('[data-action="zoom-in"]').click();
  flush();
  assert.deepEqual(position(), before);
  controller.fit();
  flush();
  assert.deepEqual(position(), before);
});
