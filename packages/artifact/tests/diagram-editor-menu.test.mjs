import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createEditorChrome } from '../lib/artifact/ui/diagram-editor-chrome.mjs';
import { createEditorKeyboard } from '../lib/artifact/ui/diagram-editor-keyboard.mjs';

const { JSDOM } = createRequire(new URL('../../protocol/package.json', import.meta.url))('jsdom');
function overflowFixture(t, markup) {
  const dom = new JSDOM(
    `<!doctype html><main><header><button id="more">More</button><div role="menu" hidden>${markup}</div></header><div id="stage"></div></main>`,
  );
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const shell = doc.querySelector('main');
  const moreButton = doc.querySelector('#more');
  const moreMenu = doc.querySelector('[role="menu"]');
  // JSDOM has no layout; give items rectangles unless display:none. Visibility-hidden items retain them.
  for (const item of moreMenu.children)
    item.getClientRects = () => (item.style.display === 'none' ? [] : [{ width: 80, height: 24 }]);
  const ctx = {
    doc,
    dom: {
      shell,
      bar: doc.querySelector('header'),
      stage: doc.querySelector('#stage'),
      moreButton,
      moreMenu,
    },
    layout: { drawer: () => false, compact: () => false },
    dialogs: { active: () => null },
  };
  const chrome = createEditorChrome(ctx);
  const keyboard = createEditorKeyboard({ ...ctx, chrome });
  doc.addEventListener('keydown', keyboard.keydown);
  const press = (key) =>
    doc.activeElement.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  return { doc, chrome, moreButton, moreMenu, press };
}

test('overflow opening skips disabled, hidden and unrendered choices and restores its trigger', (t) => {
  const { doc, chrome, moreButton, moreMenu } = overflowFixture(
    t,
    `
    <button role="menuitem" disabled>Auto layout</button>
    <button role="menuitem" hidden>Hidden source</button>
    <button role="menuitem" style="display:none">Unrendered source</button>
    <button role="menuitem" style="visibility:hidden">CSS-hidden source</button>
    <button role="menuitem" style="visibility:collapse">CSS-collapsed source</button>
    <button role="menuitem" id="source">Mermaid copies</button>`,
  );
  assert.equal(doc.activeElement, doc.body);
  chrome.setOverflow(true, { focus: true });
  assert.equal(doc.activeElement, doc.querySelector('#source'));
  assert.equal(moreMenu.hidden, false);
  chrome.setOverflow(false);
  assert.equal(moreMenu.hidden, true);
  assert.equal(doc.activeElement, moreButton);
});

test('overflow with no operable choices keeps keyboard focus on its trigger', (t) => {
  const { doc, chrome, moreButton, moreMenu } = overflowFixture(
    t,
    `
    <button role="menuitem" disabled>Auto layout</button>
    <button role="menuitem" hidden>Hidden source</button>`,
  );
  chrome.setOverflow(true, { focus: true });
  assert.equal(doc.activeElement, moreButton);
  assert.equal(moreButton.getAttribute('aria-expanded'), 'true');
  assert.equal(moreMenu.hidden, false);
  chrome.setOverflow(false);
  assert.equal(doc.activeElement, moreButton);
  assert.equal(moreButton.getAttribute('aria-expanded'), 'false');
});

test('menu arrows choose the correct edge when the focused choice becomes unavailable', (t) => {
  const { doc, chrome, moreMenu, press } = overflowFixture(
    t,
    '<button role="menuitem">A</button><button role="menuitem">B</button><button role="menuitem">C</button><button role="menuitem">D</button>',
  );
  const [first, second, , last] = moreMenu.children;
  chrome.setOverflow(true, { focus: true });
  assert.equal(doc.activeElement, first);
  first.setAttribute('aria-disabled', 'true');
  press('ArrowUp');
  assert.equal(doc.activeElement, last);
  last.setAttribute('aria-disabled', 'true');
  press('ArrowDown');
  assert.equal(doc.activeElement, second);
});

test('every menu navigation key returns now-ineligible focus to the trigger when no choice remains', (t) => {
  for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End']) {
    const { doc, chrome, moreButton, moreMenu, press } = overflowFixture(
      t,
      '<button role="menuitem">A</button>',
    );
    chrome.setOverflow(true, { focus: true });
    const item = moreMenu.firstElementChild;
    assert.equal(doc.activeElement, item);
    item.setAttribute('aria-disabled', 'true');
    const uncancelled = press(key);
    assert.equal(uncancelled, false, key + ' is handled by the menu');
    assert.equal(doc.activeElement, moreButton, key + ' returns focus to More');
    press('Escape');
    assert.equal(moreMenu.hidden, true);
  }
});
