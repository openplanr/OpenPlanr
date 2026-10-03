import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const { build } = createRequire(new URL('../package.json', import.meta.url))('esbuild');
const compiled = await build({
  stdin: {
    contents: `
      import { createElement as h, useState } from 'react';
      import { flushSync } from 'react-dom';
      import { createRoot } from 'react-dom/client';
      import { StudioMenu, StudioPanelDialog } from ${JSON.stringify(new URL('../lib/artifact/ui/studio-shell-components.mjs', import.meta.url).pathname)};
      const operations = [];
      const controls = {};
      function App() {
        const [menuOpen, setMenuOpen] = useState(false);
        const [dialogOpen, setDialogOpen] = useState(false);
        controls.setMenuOpen = setMenuOpen;
        controls.setDialogOpen = setDialogOpen;
        return h('div', null, h(StudioMenu, { label: 'Actions',
          ...(window.fixtureConfig.controlled ? { open: menuOpen, onOpenChange: setMenuOpen } : {}),
          items: [
          { id: 'first', label: 'First action', onSelect: () => operations.push('first') },
          { id: 'disabled', label: 'Disabled action', disabled: true },
          { id: 'last', label: 'Last action', onSelect: () => operations.push('last') },
        ] }), dialogOpen ? h(StudioPanelDialog, { open: dialogOpen, onOpenChange: setDialogOpen, title: 'New review dialog',
          children: h('button', { id: 'review-action' }, 'Review action') }) : null);
      }
      const root = createRoot(document.querySelector('#root'));
      window.fixture = { root, operations,
        closeMenu: () => flushSync(() => controls.setMenuOpen(false)),
        openDialog: () => flushSync(() => controls.setDialogOpen(true)),
        sync: callback => flushSync(callback) };
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

async function fixture(t, { controlled = false } = {}) {
  const errors = [],
    console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM(
    '<!doctype html><div id="root"></div><iframe title="Retained canvas"></iframe><button id="canvas">Select canvas shape</button><a id="navigation" href="/project">Project navigation</a>',
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
  const doc = dom.window.document;
  const pointerListeners = new Set();
  const addListener = doc.addEventListener.bind(doc);
  const removeListener = doc.removeEventListener.bind(doc);
  doc.addEventListener = (type, listener, options) => {
    if (type === 'pointerdown') pointerListeners.add(listener);
    return addListener(type, listener, options);
  };
  doc.removeEventListener = (type, listener, options) => {
    if (type === 'pointerdown') pointerListeners.delete(listener);
    return removeListener(type, listener, options);
  };
  dom.window.fixtureConfig = { controlled };
  dom.window.eval(compiled.outputFiles[0].text);
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
  const open = async (synchronous = false) => {
    trigger.focus();
    if (synchronous) dom.window.fixture.sync(() => press('ArrowDown'));
    else press('ArrowDown');
    await eventually(() => assert.equal(doc.activeElement.textContent, 'First action'));
    // Radix installs its document outside-pointer listener in its own deferred task.
    if (!synchronous) await eventually(() => assert.ok(pointerListeners.size));
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
    closeMenu: dom.window.fixture.closeMenu,
    sync: dom.window.fixture.sync,
    openDialog: dom.window.fixture.openDialog,
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
  await eventually(() => assert.equal(doc.querySelector('[role="menu"]') === null, true));
  assert.deepEqual([...operations], ['canvas']);
  assert.equal(doc.querySelector('iframe') === frame, true);
  assert.equal(canvas.isConnected, true);
});

// Hold the real zero-delay tasks only across the close/focus race. The installed
// Radix FocusScope still dispatches its own unmount event and runs its callback.
async function deferredClose(t, context, close = () => context.press('Escape')) {
  const { doc } = context;
  const win = doc.defaultView;
  const closingMenu = doc.querySelector('[role="menu"]');
  assert.ok(closingMenu);
  const setTimeout = win.setTimeout.bind(win);
  const clearTimeout = win.clearTimeout.bind(win);
  const pending = new Map();
  let nextId = -1;
  win.setTimeout = (callback, milliseconds, ...args) => {
    if (milliseconds !== 0) return setTimeout(callback, milliseconds, ...args);
    const id = nextId--;
    pending.set(id, () => callback(...args));
    return id;
  };
  win.clearTimeout = (id) => {
    if (!pending.delete(id)) clearTimeout(id);
  };
  const restore = () => {
    win.setTimeout = setTimeout;
    win.clearTimeout = clearTimeout;
  };
  t.after(restore);
  const delivered = [];
  closingMenu.addEventListener('focusScope.autoFocusOnUnmount', () => {
    delivered.push(doc.activeElement);
  });
  context.sync(close);
  await eventually(() => assert.equal(doc.querySelector('[role="menu"]') === null, true));
  assert.ok(pending.size, 'the actual Radix close must have a queued unmount task');
  return () => {
    let count = 0;
    while (pending.size) {
      assert.ok(count++ < 100, 'deferred close tasks must terminate');
      const [id, callback] = pending.entries().next().value;
      pending.delete(id);
      callback();
    }
    restore();
    assert.equal(
      delivered.length,
      1,
      'the closing content must receive its actual Radix unmount autofocus',
    );
    return delivered[0];
  };
}

test('Escape returns focus to the Actions trigger after actual deferred teardown', {
  timeout: 30_000,
}, async (t) => {
  const context = await fixture(t);
  await context.open();
  const finishClose = await deferredClose(t, context);
  assert.equal(context.doc.activeElement === context.doc.body, true);
  assert.equal(finishClose() === context.doc.body, true);
  assert.equal(context.doc.activeElement === context.trigger, true);
  assert.deepEqual([...context.operations], []);
});

test('a newer navigation link keeps focus when the old menu teardown runs', {
  timeout: 30_000,
}, async (t) => {
  const context = await fixture(t);
  await context.open();
  const finishClose = await deferredClose(t, context);
  const link = context.doc.querySelector('#navigation');
  link.focus();
  assert.equal(context.doc.activeElement === link, true);
  assert.equal(finishClose() === link, true);
  assert.equal(context.doc.activeElement === link, true);
});

test('a newly opened Radix dialog keeps focus when the old menu teardown runs', {
  timeout: 30_000,
}, async (t) => {
  const context = await fixture(t);
  await context.open();
  const finishClose = await deferredClose(t, context);
  context.openDialog();
  const dialog = context.doc.querySelector('[role="dialog"]');
  const action = context.doc.activeElement;
  assert.ok(dialog.contains(action), 'the actual dialog autofocus owns the new target');
  let triggerFocuses = 0;
  context.trigger.addEventListener('focus', () => triggerFocuses++);
  assert.equal(finishClose() === action, true);
  assert.equal(triggerFocuses, 0, 'the old menu must not even briefly focus its trigger');
  assert.equal(context.doc.activeElement === action, true);
  assert.ok(context.doc.querySelector('[role="dialog"]'));
});

test('controlled menu teardown preserves the connected retained iframe focus', {
  timeout: 30_000,
}, async (t) => {
  const context = await fixture(t, { controlled: true });
  await context.open();
  const finishClose = await deferredClose(t, context, context.closeMenu);
  context.frame.focus();
  assert.equal(context.doc.activeElement === context.frame, true);
  assert.equal(finishClose() === context.frame, true);
  assert.equal(context.doc.activeElement === context.frame, true);
  assert.equal(context.doc.querySelector('iframe'), context.frame);
});

test('an older close cannot steal focus from a reopened controlled menu', {
  timeout: 30_000,
}, async (t) => {
  const context = await fixture(t, { controlled: true });
  await context.open();
  const finishClose = await deferredClose(t, context, context.closeMenu);
  await context.open(true);
  const newerMenu = context.doc.querySelector('[role="menu"]');
  const newerFocus = context.doc.activeElement;
  assert.ok(newerMenu.contains(newerFocus));
  assert.equal(finishClose() === newerFocus, true);
  assert.equal(context.doc.activeElement === newerFocus, true);
  assert.equal(context.doc.querySelector('[role="menu"]') === newerMenu, true);
  context.press('Escape');
  await eventually(() => assert.equal(context.doc.activeElement === context.trigger, true));
});

test('outside focus dismissal followed by reopen preserves the next Escape return', {
  timeout: 30_000,
}, async (t) => {
  const context = await fixture(t);
  await context.open();
  const link = context.doc.querySelector('#navigation');
  const finishOutsideClose = await deferredClose(t, context, () => link.focus());
  assert.equal(context.doc.activeElement === link, true);
  assert.equal(finishOutsideClose() === link, true);
  assert.equal(context.doc.activeElement === link, true);
  await context.open();
  const finishEscapeClose = await deferredClose(t, context);
  assert.equal(finishEscapeClose() === context.doc.body, true);
  assert.equal(context.doc.activeElement === context.trigger, true);
  assert.deepEqual([...context.operations], []);
});

test('Enter selection returns focus after the actual deferred menu teardown', {
  timeout: 30_000,
}, async (t) => {
  const context = await fixture(t);
  await context.open();
  const finishClose = await deferredClose(t, context, () => context.press('Enter'));
  assert.equal(finishClose() === context.doc.body, true);
  assert.equal(context.doc.activeElement === context.trigger, true);
  assert.deepEqual([...context.operations], ['first']);
});
