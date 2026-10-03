import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const { build } = createRequire(new URL('../package.json', import.meta.url))('esbuild');
const compiled = await build({
  stdin: {
    contents: `
      import { createElement as h } from 'react';
      import { createRoot } from 'react-dom/client';
      import { StudioMenu } from ${JSON.stringify(new URL('../lib/artifact/ui/studio-shell-components.mjs', import.meta.url).pathname)};
      const operations = [];
      function App() {
        return h(StudioMenu, { label: 'Actions', items: [
          { id: 'first', label: 'First action', onSelect: () => operations.push('first') },
          { id: 'disabled', label: 'Disabled action', disabled: true },
          { id: 'last', label: 'Last action', onSelect: () => operations.push('last') },
        ] });
      }
      const root = createRoot(document.querySelector('#root'));
      window.fixture = { root, operations };
      document.querySelector('#canvas').addEventListener('click', () => operations.push('canvas'));
      root.render(h(App));
    `,
    resolveDir: import.meta.dirname,
    sourcefile: 'studio-menu-unit-fixture.mjs',
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  write: false,
  logLevel: 'silent',
});

async function eventually(assertion) {
  const deadline = Date.now() + 1000;
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(5);
    }
  }
}

async function fixture(t) {
  const errors = [],
    console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM(
    '<!doctype html><div id="root"></div><iframe title="Retained canvas"></iframe><button id="canvas">Select canvas shape</button>',
    {
      url: 'https://studio.example/',
      pretendToBeVisual: true,
      runScripts: 'dangerously',
      virtualConsole: console,
    },
  );
  t.after(async () => {
    try {
      dom.window.fixture?.root?.unmount();
      await delay(0); // Finish Radix's owned deferred unmount autofocus.
    } finally {
      dom.window.close();
    }
    assert.deepEqual(errors, []);
  });
  // This real browser bundle gets a fresh DOM and module state in each case.
  // JSDOM has no native hit-testing: pointer CSS gating is checked here;
  // the separately wired native case proves the same gesture reaches the canvas.
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.eval(compiled.outputFiles[0].text);
  const doc = dom.window.document;
  await eventually(() => assert.ok(doc.querySelector('[aria-label="Actions"]')));
  const trigger = doc.querySelector('[aria-label="Actions"]');
  const press = (key) =>
    doc.activeElement.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      }),
    );
  const open = async () => {
    trigger.focus();
    press('ArrowDown');
    await eventually(() => assert.ok(doc.querySelector('[role="menu"]')));
  };
  const pointer = (target) => {
    for (const type of ['pointerdown', 'pointerup', 'click'])
      target.dispatchEvent(
        new dom.window.MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
  };
  return {
    doc,
    trigger,
    frame: doc.querySelector('iframe'),
    canvas: doc.querySelector('#canvas'),
    operations: dom.window.fixture.operations,
    open,
    press,
    pointer,
  };
}

test('the canonical toolbar menu permits one outside canvas gesture while retaining its DOM', {
  timeout: 30_000,
}, async (t) => {
  const { doc, frame, canvas, operations, open, pointer } = await fixture(t);
  await open();
  assert.notEqual(doc.body.style.pointerEvents, 'none', 'toolbar actions must not lock the canvas');
  assert.notEqual(doc.defaultView.getComputedStyle(canvas).pointerEvents, 'none');
  assert.notEqual(frame.getAttribute('aria-hidden'), 'true');
  pointer(canvas);
  await eventually(() => assert.equal(doc.querySelector('[role="menu"]'), null));
  assert.deepEqual([...operations], ['canvas']);
  assert.equal(doc.querySelector('iframe') === frame, true);
  assert.equal(canvas.isConnected, true);
});
