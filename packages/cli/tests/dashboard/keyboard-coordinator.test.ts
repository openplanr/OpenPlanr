// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installKeyboardCoordinator,
  type KeyboardContext,
} from '../../../../apps/dashboard/src/features/shell/keyboard-coordinator.js';

const dispose: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of dispose.splice(0)) cleanup();
  document.body.replaceChildren();
});

function key(target: EventTarget, value: string, options: KeyboardEventInit = {}, time = 100) {
  const event = new KeyboardEvent('keydown', {
    key: value,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  Object.defineProperty(event, 'timeStamp', { value: time });
  target.dispatchEvent(event);
  return event;
}

function row(id: string, attributes = '') {
  return `<div tabindex="0" role="row" data-keyboard-item="${id}" ${attributes}>${id}</div>`;
}

function fixture(html = '', options: Partial<KeyboardContext> = {}) {
  document.body.innerHTML = `<main id="keyboard-root">${html}</main>`;
  const root = document.getElementById('keyboard-root') as HTMLElement;
  const context = {
    root,
    singleLetters: true,
    paletteOpen: false,
    togglePalette: vi.fn(),
    openHelp: vi.fn(),
    navigate: vi.fn(),
    closeInspector: vi.fn(() => false),
    selectedId: vi.fn((): string | null => 'fixture-selection'),
    copy: vi.fn(async (_text: string) => undefined),
    announce: vi.fn(),
    ...options,
  };
  const item = (id: string) =>
    root.querySelector<HTMLElement>(`[data-keyboard-item="${id}"]`) as HTMLElement;
  const clicks = vi.fn();
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    clicks(target.dataset.keyboardItem);
  });
  const cleanup = installKeyboardCoordinator(document, () => context);
  dispose.push(cleanup);
  return { root, context, item, clicks, cleanup };
}

const list = `<section data-route-kind="planning.list">${row('a')}${row('b')}${row('c')}</section>`;

function selected(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('[data-keyboard-item][aria-selected="true"]')].map(
    (item) => item.dataset.keyboardItem,
  );
}

describe('dashboard keyboard coordinator', () => {
  it.each(['metaKey', 'ctrlKey'] as const)(
    'toggles the palette with %s from a typing field',
    (modifier) => {
      const { root, context } = fixture('<input aria-label="Notes">', { singleLetters: false });
      const input = root.querySelector('input') as HTMLInputElement;
      expect(key(input, 'k', { [modifier]: true }).defaultPrevented).toBe(true);
      expect(context.togglePalette).toHaveBeenCalledTimes(1);
      expect(context.navigate).not.toHaveBeenCalled();
    },
  );

  it.each([
    { altKey: true, ctrlKey: true },
    { shiftKey: true, metaKey: true },
    { ctrlKey: true, isComposing: true },
    { metaKey: true, keyCode: 229 },
  ])('keeps modified or composing palette chords inert: %j', (options) => {
    const { context } = fixture();
    expect(key(document.body, 'k', options).defaultPrevented).toBe(false);
    expect(context.togglePalette).not.toHaveBeenCalled();
  });

  it('tracks composition across key events and cancels a pending navigation sequence', () => {
    const { context } = fixture(list);
    key(document.body, 'g');
    document.body.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    for (const value of ['k', 'j', 'c', '?', '/', 'Enter', 'Escape'])
      key(document.body, value, { ctrlKey: value === 'k' });
    expect(context.togglePalette).not.toHaveBeenCalled();
    expect(context.openHelp).not.toHaveBeenCalled();
    expect(context.copy).not.toHaveBeenCalled();
    document.body.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    key(document.body, 'h');
    expect(context.navigate).not.toHaveBeenCalled();
    key(document.body, 'k', { ctrlKey: true });
    expect(context.togglePalette).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['h', '#/home'],
    ['l', '#/list'],
    ['g', '#/graph'],
    ['b', '#/board'],
    ['s', '#/sprints'],
    ['a', '#/activity'],
    ['o', '#/operate/today'],
  ])('routes G then %s to %s at the exact one-second boundary', (letter, href) => {
    const { context } = fixture();
    expect(key(document.body, 'g', {}, 50).defaultPrevented).toBe(true);
    expect(key(document.body, letter, {}, 1050).defaultPrevented).toBe(true);
    expect(context.navigate).toHaveBeenCalledExactlyOnceWith(href);
  });

  it('expires G navigation after one second, ignores unknown suffixes, and permits a new sequence', () => {
    const { context } = fixture();
    key(document.body, 'g', {}, 10);
    key(document.body, 'h', {}, 1011);
    expect(context.navigate).not.toHaveBeenCalled();
    key(document.body, 'g', {}, 2000);
    key(document.body, 'z', {}, 2001);
    key(document.body, 'h', {}, 2002);
    expect(context.navigate).not.toHaveBeenCalled();
    key(document.body, 'g', {}, 3000);
    key(document.body, 'l', {}, 3001);
    expect(context.navigate).toHaveBeenCalledExactlyOnceWith('#/list');
  });

  it.each([
    '<input>',
    '<textarea></textarea>',
    '<select><option>Value</option></select>',
    '<div contenteditable="true"><span>Editable</span></div>',
    '<div role="textbox" tabindex="0">Editor</div>',
    '<div role="combobox" tabindex="0">Choose</div>',
  ])('preserves typing and cancels G prefixes in %s', (html) => {
    const { root, context, clicks } = fixture(html + list);
    const target = root.firstElementChild as HTMLElement;
    key(document.body, 'g');
    for (const value of ['j', 'k', 'c', '/', '?', 'Enter', 'Escape', 'ArrowDown', ' ', 'g', 'h']) {
      expect(key(target, value).defaultPrevented).toBe(false);
    }
    key(document.body, 'h');
    expect(context.navigate).not.toHaveBeenCalled();
    expect(context.copy).not.toHaveBeenCalled();
    expect(context.openHelp).not.toHaveBeenCalled();
    expect(context.closeInspector).not.toHaveBeenCalled();
    expect(clicks).not.toHaveBeenCalled();
  });

  it('allows shortcuts on explicitly noneditable content', () => {
    const { root, context } = fixture('<div contenteditable="false">Read only</div>');
    key(root.firstElementChild as HTMLElement, '?');
    expect(context.openHelp).toHaveBeenCalledTimes(1);
  });

  it.each(['dialog', 'modal', 'alertdialog'])('defers keys to an open %s', (kind) => {
    const html =
      kind === 'dialog'
        ? '<dialog open></dialog>'
        : `<div role="${kind === 'modal' ? 'dialog' : kind}" aria-modal="true"></div>`;
    const { context, clicks } = fixture(html + list);
    for (const value of ['j', 'k', 'c', '/', '?', 'Escape', 'Enter', 'ArrowDown'])
      key(document.body, value);
    key(document.body, 'k', { ctrlKey: true });
    expect(context.togglePalette).not.toHaveBeenCalled();
    expect(context.closeInspector).not.toHaveBeenCalled();
    expect(context.copy).not.toHaveBeenCalled();
    expect(context.openHelp).not.toHaveBeenCalled();
    expect(clicks).not.toHaveBeenCalled();
  });

  it('ignores hidden overlays when deciding whether shortcuts are available', () => {
    const { context } = fixture('<dialog open hidden></dialog>');
    key(document.body, '?');
    expect(context.openHelp).toHaveBeenCalledTimes(1);
  });

  it('allows Cmd/Ctrl-K to close the palette when it is the top modal', () => {
    const { context } = fixture('<dialog class="pc-palette" open></dialog>', { paletteOpen: true });
    key(document.body, 'k', { metaKey: true });
    expect(context.togglePalette).toHaveBeenCalledTimes(1);
  });

  it('does not toggle the underlying palette when a newer modal owns focus', () => {
    const { context } = fixture(
      '<dialog class="pc-palette" open></dialog><dialog open aria-label="Help"></dialog>',
      { paletteOpen: true },
    );
    expect(key(document.body, 'k', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(context.togglePalette).not.toHaveBeenCalled();
  });

  it('moves through visible rows using J/K and arrows and keeps boundaries stable', () => {
    const { item, context, clicks } = fixture(list);
    key(document.body, 'j');
    expect(document.activeElement).toBe(item('a'));
    key(item('a'), 'j');
    expect(document.activeElement).toBe(item('b'));
    key(item('b'), 'k');
    expect(document.activeElement).toBe(item('a'));
    key(item('a'), 'ArrowDown');
    expect(document.activeElement).toBe(item('b'));
    key(item('b'), 'ArrowUp');
    expect(document.activeElement).toBe(item('a'));
    key(item('a'), 'k');
    expect(document.activeElement).toBe(item('a'));
    expect(context.announce).toHaveBeenLastCalledWith('No item in that direction.');
    expect(clicks).not.toHaveBeenCalled();
    expect(context.announce).toHaveBeenCalledWith('2 of 3');
  });

  it('uses the selected row as the origin and never navigates unavailable rows', () => {
    const { item, clicks } = fixture(
      `<section>${row('a', 'data-selected="true"')}${row('hidden', 'hidden')}${row('disabled', 'aria-disabled="true"')}${row('b')}${row('inert', 'inert')}</section>`,
    );
    key(document.body, 'j');
    expect(document.activeElement).toBe(item('b'));
    expect(clicks).not.toHaveBeenCalled();
  });

  it('activates the focused row on Enter and keeps the row as the inspector origin', () => {
    const { item, clicks } = fixture(list);
    const origin = vi.fn();
    item('b').addEventListener('click', function () {
      origin(this);
    });
    item('b').focus();
    expect(key(item('b'), 'Enter').defaultPrevented).toBe(true);
    expect(clicks).toHaveBeenCalledExactlyOnceWith('b');
    expect(origin).toHaveBeenCalledExactlyOnceWith(item('b'));
    expect(document.activeElement).toBe(item('b'));
  });

  it.each(['button', 'a', 'tab', 'menuitem'])(
    'preserves native navigation on %s controls',
    (tag) => {
      const html =
        tag === 'button' || tag === 'a'
          ? `<${tag} href="#/list">Control</${tag}>`
          : `<div role="${tag}" tabindex="0">Control</div>`;
      const { root, clicks } = fixture(html + list);
      const target = root.firstElementChild as HTMLElement;
      for (const value of ['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Tab', 'Home', 'End'])
        expect(key(target, value).defaultPrevented).toBe(false);
      expect(clicks).not.toHaveBeenCalled();
    },
  );

  it('leaves modified navigation and native hash-link clicks untouched', () => {
    const { root, item, context, clicks } = fixture(`<a href="#/list">List</a>${list}`);
    for (const options of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      for (const value of ['j', 'ArrowDown', 'g', 'Enter'])
        expect(key(item('a'), value, options).defaultPrevented).toBe(false);
    }
    const link = root.querySelector('a') as HTMLAnchorElement;
    for (const modifier of ['ctrlKey', 'metaKey']) {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true, [modifier]: true });
      expect(link.dispatchEvent(click)).toBe(true);
      expect(click.defaultPrevented).toBe(false);
    }
    expect(context.navigate).not.toHaveBeenCalled();
    expect(clicks.mock.calls.every(([id]) => id === undefined)).toBe(true);
  });

  it('focuses the first available view filter, with palette fallback when none exists', () => {
    const { root, context } = fixture(
      '<input type="search" hidden><input type="search" disabled><input aria-label="Filter work">',
    );
    key(document.body, '/');
    expect(document.activeElement).toBe(root.lastElementChild);
    expect(context.togglePalette).not.toHaveBeenCalled();
    root.replaceChildren();
    expect(key(document.body, '/').defaultPrevented).toBe(true);
    expect(context.togglePalette).toHaveBeenCalledTimes(1);
  });

  it('opens shortcut help without activating a row', () => {
    const { context, clicks, item } = fixture(list);
    expect(key(item('b'), '?', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(context.openHelp).toHaveBeenCalledTimes(1);
    expect(clicks).not.toHaveBeenCalled();
  });

  it('copies a focused command before the selected artifact identity', () => {
    const { root, context } = fixture(
      '<div class="pc-command-hint" tabindex="0"><code>safe command</code><button class="pc-command-hint__copy">Copy</button></div>',
    );
    const copy = vi.fn();
    root.querySelector('button')?.addEventListener('click', copy);
    expect(key(root.querySelector('code') as HTMLElement, 'c').defaultPrevented).toBe(true);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(context.selectedId).not.toHaveBeenCalled();
    expect(context.copy).not.toHaveBeenCalled();
  });

  it('explains unavailable commands without falling through to identity copying', () => {
    const { root, context } = fixture(
      '<div class="pc-command-hint"><button class="pc-command-hint__copy" disabled>Copy</button></div>',
    );
    key(root.firstElementChild as HTMLElement, 'c');
    expect(context.announce).toHaveBeenCalledWith('This command is unavailable.');
    expect(context.selectedId).not.toHaveBeenCalled();
    expect(context.copy).not.toHaveBeenCalled();
  });

  it('copies selected canonical IDs and announces success, denial, and missing selection', async () => {
    const { context } = fixture();
    key(document.body, 'c');
    await Promise.resolve();
    expect(context.copy).toHaveBeenCalledExactlyOnceWith('fixture-selection');
    expect(context.announce).toHaveBeenLastCalledWith('Copied fixture-selection');
    context.copy = vi.fn(async () => {
      throw new Error('clipboard denied');
    });
    key(document.body, 'c');
    await Promise.resolve();
    expect(context.announce).toHaveBeenLastCalledWith(
      'Copy blocked. Select and copy manually: fixture-selection',
    );
    context.selectedId = vi.fn(() => null);
    key(document.body, 'c');
    expect(context.announce).toHaveBeenLastCalledWith('Select an item or focus a command to copy.');
  });

  it('copies a focused canonical row identity before an older inspector selection', async () => {
    const { item, context } = fixture(list);
    key(item('b'), 'c');
    await Promise.resolve();
    expect(context.copy).toHaveBeenCalledExactlyOnceWith('b');
    expect(context.selectedId).not.toHaveBeenCalled();
  });

  it('falls back to the selected identity for an empty row sentinel', async () => {
    const { root, context } = fixture(row(''));
    key(root.firstElementChild as HTMLElement, 'c');
    await Promise.resolve();
    expect(context.copy).toHaveBeenCalledExactlyOnceWith('fixture-selection');
  });

  it('keeps Space and range selection available when single-letter shortcuts are disabled', () => {
    const { root, item } = fixture(list, { singleLetters: false });
    key(item('a'), ' ');
    expect(selected(root)).toEqual(['a']);
    key(item('a'), 'ArrowDown', { shiftKey: true });
    expect(selected(root)).toEqual(['a', 'b']);
  });

  it('skips rows and filters in closed disclosures while retaining their summary', () => {
    const { root, item, context, clicks } = fixture(
      `<details><summary>More</summary><input type="search">${row('closed')}</details>${row('a')}<details><summary><span>Visible label</span></summary><details><summary>Hidden inner summary</summary>${row('inner')}</details></details>`,
    );
    key(document.body, 'j');
    expect(document.activeElement).toBe(item('a'));
    expect(clicks).not.toHaveBeenCalled();
    key(document.body, '/');
    expect(context.togglePalette).toHaveBeenCalledTimes(1);
    expect(root.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it('copies a Graph canonical identity instead of its presentation node key', async () => {
    const { item, context } = fixture(
      row('graph-node', 'data-canonical-id="fixture-canonical-id"'),
    );
    key(item('graph-node'), 'c');
    await Promise.resolve();
    expect(context.copy).toHaveBeenCalledExactlyOnceWith('fixture-canonical-id');
    expect(context.selectedId).not.toHaveBeenCalled();
  });

  it('never copies an empty Board column sentinel as an artifact identity', async () => {
    const { item, context } = fixture(row('empty:outstanding'));
    key(item('empty:outstanding'), 'c');
    await Promise.resolve();
    expect(context.copy).toHaveBeenCalledExactlyOnceWith('fixture-selection');
  });

  it('blocks command-card fallback handlers throughout IME composition', () => {
    const { root, context } = fixture(
      '<div class="pc-command-hint"><button class="pc-command-hint__copy">Copy</button></div>',
    );
    const button = root.querySelector('button') as HTMLButtonElement;
    const localKey = vi.fn();
    const copy = vi.fn();
    button.addEventListener('keydown', localKey);
    button.addEventListener('click', copy);
    button.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    key(button, 'c');
    button.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    key(button, 'c', { isComposing: true });
    key(button, 'c', { keyCode: 229 });
    expect(localKey).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(context.copy).not.toHaveBeenCalled();
    key(button, 'c');
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it.each(['a', 'button'])(
    'preserves native Enter and Space for a nested %s within a selectable row',
    (tag) => {
      const { root, clicks } = fixture(
        `<section data-route-kind="planning.list"><div tabindex="0" data-keyboard-item="a"><${tag} href="#/list">Native control</${tag}></div></section>`,
      );
      const control = root.querySelector(tag) as HTMLElement;
      expect(key(control, 'Enter').defaultPrevented).toBe(false);
      expect(key(control, ' ').defaultPrevented).toBe(false);
      expect(clicks).not.toHaveBeenCalled();
      expect(selected(root)).toEqual([]);
    },
  );

  it('uses the focused group header before the selected row to expand a List group', () => {
    const { root } = fixture(
      `<section data-route-kind="planning.list"><div data-keyboard-group><button aria-expanded="false">First group</button>${row('a', 'data-selected="true"')}</div><div data-keyboard-group><button aria-expanded="false">Focused group</button>${row('b')}</div></section>`,
    );
    const [first, second] = [...root.querySelectorAll('button')];
    second.addEventListener('click', () => second.setAttribute('aria-expanded', 'true'));
    key(second, ']');
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(second.getAttribute('aria-expanded')).toBe('true');
  });

  it('resets selection, its range anchor and pending G navigation when route scope changes', () => {
    const { context, item, root } = fixture(list, { selectionScope: 'first-view' });
    key(item('a'), ' ');
    key(item('a'), 'g');
    expect(selected(root)).toEqual(['a']);
    context.selectionScope = 'second-view';
    key(item('b'), 'h');
    expect(context.navigate).not.toHaveBeenCalled();
    expect(selected(root)).toEqual([]);
    key(item('b'), 'ArrowDown', { shiftKey: true });
    expect(selected(root)).toEqual(['b', 'c']);
  });

  it('traverses from desktop inspector controls without activating rows or inspector buttons', () => {
    const { item, context, clicks } = fixture(list);
    context.selectedId = vi.fn(() => 'b');
    document.body.insertAdjacentHTML(
      'beforeend',
      '<aside class="pc-shell-inspector"><button>Close inspector</button></aside>',
    );
    const button = document.querySelector('aside button') as HTMLButtonElement;
    const activate = vi.fn();
    button.addEventListener('click', activate);
    key(button, 'j');
    expect(document.activeElement).toBe(item('c'));
    key(button, 'k');
    expect(document.activeElement).toBe(item('a'));
    expect(clicks).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(context.closeInspector).not.toHaveBeenCalled();
  });

  it('keeps navigation and copy shortcuts inside menus and open disclosures with their owners', () => {
    const { root, context, clicks } = fixture(
      `<details open><summary>More</summary><a href="#/list">List</a></details><div role="menu"><button>Menu action</button></div>${list}`,
    );
    for (const target of [root.querySelector('a'), root.querySelector('[role="menu"] button')]) {
      for (const value of ['j', 'k', 'c', 'g', '?', '/', 'Enter'])
        key(target as HTMLElement, value);
    }
    expect(context.navigate).not.toHaveBeenCalled();
    expect(context.copy).not.toHaveBeenCalled();
    expect(context.openHelp).not.toHaveBeenCalled();
    expect(context.togglePalette).not.toHaveBeenCalled();
    expect(clicks).not.toHaveBeenCalled();
  });

  it('disables single-letter commands including command-card local handlers while preserving arrows and the palette chord', () => {
    const { root, context, item, clicks } = fixture(
      `<div class="pc-command-hint" tabindex="0"><button class="pc-command-hint__copy">Copy</button></div>${list}`,
      { singleLetters: false },
    );
    const localCopy = vi.fn();
    root.firstElementChild?.addEventListener('keydown', localCopy);
    key(root.firstElementChild as HTMLElement, 'c');
    expect(localCopy).not.toHaveBeenCalled();
    for (const value of ['j', 'k', 'c', 'g', 'h', '?', '/']) key(document.body, value);
    expect(clicks).not.toHaveBeenCalled();
    expect(context.copy).not.toHaveBeenCalled();
    expect(context.openHelp).not.toHaveBeenCalled();
    expect(context.navigate).not.toHaveBeenCalled();
    key(item('a'), 'ArrowDown');
    expect(document.activeElement).toBe(item('b'));
    key(document.body, 'k', { ctrlKey: true });
    expect(context.togglePalette).toHaveBeenCalledTimes(1);
  });

  it('toggles focused List rows with Space and extends or shrinks the contiguous range', () => {
    const { root, item, context } = fixture(list);
    key(item('a'), ' ');
    expect(selected(root)).toEqual(['a']);
    key(item('a'), 'ArrowDown', { shiftKey: true });
    expect(selected(root)).toEqual(['a', 'b']);
    key(item('b'), 'ArrowDown', { shiftKey: true });
    expect(selected(root)).toEqual(['a', 'b', 'c']);
    key(item('c'), 'ArrowUp', { shiftKey: true });
    expect(selected(root)).toEqual(['a', 'b']);
    key(item('b'), ' ');
    expect(selected(root)).toEqual(['a']);
    key(item('a'), 'Escape');
    expect(selected(root)).toEqual([]);
    expect(context.announce).toHaveBeenLastCalledWith('0 selected');
  });

  it('anchors reverse range selection at the focused row and leaves Space outside List unchanged', () => {
    const { root, item } = fixture(list);
    key(item('c'), 'ArrowUp', { shiftKey: true });
    expect(selected(root)).toEqual(['b', 'c']);
    root.querySelector('section')?.removeAttribute('data-route-kind');
    expect(key(item('b'), ' ').defaultPrevented).toBe(false);
    expect(selected(root)).toEqual(['b', 'c']);
  });

  it('collapses and expands only the active List group', () => {
    const { root, item } = fixture(
      `<section data-route-kind="planning.list"><div data-keyboard-group><button aria-expanded="true">Group</button>${row('a')}</div><div data-keyboard-group><button aria-expanded="true">Other group</button>${row('b')}</div></section>`,
    );
    const [first, second] = [...root.querySelectorAll('button')];
    first.addEventListener('click', () =>
      first.setAttribute('aria-expanded', String(first.getAttribute('aria-expanded') !== 'true')),
    );
    key(item('a'), '[');
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(second.getAttribute('aria-expanded')).toBe('true');
    key(item('a'), '[');
    expect(first.getAttribute('aria-expanded')).toBe('false');
    key(item('a'), ']');
    expect(first.getAttribute('aria-expanded')).toBe('true');
  });

  it('moves within Board columns and preserves a clamped ordinal across columns', () => {
    const { item, context } = fixture(
      `<section data-route-kind="planning.board"><div data-keyboard-column>${row('a')}${row('b')}</div><div data-keyboard-column>${row('c')}</div><div data-keyboard-column></div></section>`,
    );
    key(item('a'), 'ArrowDown');
    expect(document.activeElement).toBe(item('b'));
    key(item('b'), 'ArrowRight');
    expect(document.activeElement).toBe(item('c'));
    key(item('c'), 'ArrowDown');
    expect(document.activeElement).toBe(item('c'));
    key(item('c'), 'ArrowRight');
    expect(document.activeElement).toBe(item('c'));
    expect(context.announce).toHaveBeenLastCalledWith('No item in that direction.');
    key(item('c'), 'ArrowLeft');
    expect(document.activeElement).toBe(item('a'));
    key(item('a'), 'ArrowLeft');
    expect(document.activeElement).toBe(item('a'));
  });

  it('skips hidden and disabled Board cards in local and cross-column movement', () => {
    const { item } = fixture(
      `<section data-route-kind="planning.board"><div data-keyboard-column>${row('a')}${row('hidden', 'hidden')}${row('b')}</div><div data-keyboard-column hidden>${row('hidden-column')}</div><div data-keyboard-column>${row('disabled', 'aria-disabled="true"')}${row('c')}${row('d')}</div></section>`,
    );
    key(item('a'), 'ArrowDown');
    expect(document.activeElement).toBe(item('b'));
    key(item('b'), 'ArrowRight');
    expect(document.activeElement).toBe(item('d'));
    key(item('d'), 'ArrowUp');
    expect(document.activeElement).toBe(item('c'));
  });

  it('navigates only connected Graph neighbours with stable geometric and ID ordering', () => {
    const { item, context } = fixture(
      `<section data-route-kind="planning.graph">${row('center', 'data-x="0" data-y="0" data-neighbours="left&#10;right-a&#10;right-b&#10;up&#10;down"')}${row('left', 'data-x="-2" data-y="0"')}${row('right-b', 'data-x="2" data-y="0"')}${row('right-a', 'data-x="2" data-y="0"')}${row('up', 'data-x="0" data-y="-2"')}${row('down', 'data-x="0" data-y="2"')}${row('unconnected', 'data-x="1" data-y="0"')}</section>`,
    );
    key(item('center'), 'ArrowRight');
    expect(document.activeElement).toBe(item('right-a'));
    key(item('center'), 'ArrowLeft');
    expect(document.activeElement).toBe(item('left'));
    key(item('center'), 'f');
    expect(item('center').dataset.graphFocus).toBe('true');
    expect(document.activeElement).toBe(item('center'));
    key(item('center'), 'Escape');
    expect(item('center').hasAttribute('data-graph-focus')).toBe(false);
    expect(context.announce).toHaveBeenLastCalledWith('Graph focus cleared');
  });

  it('orders vertical Graph neighbours by y then canonical ID and reports absent directions', () => {
    const { item, context } = fixture(
      `<section data-route-kind="planning.graph">${row('center', 'data-x="0" data-y="0" data-neighbours="up&#10;down-b&#10;down-a"')}${row('up', 'data-x="0" data-y="-2"')}${row('down-b', 'data-x="0" data-y="2"')}${row('down-a', 'data-x="0" data-y="2"')}</section>`,
    );
    key(item('center'), 'ArrowUp');
    expect(document.activeElement).toBe(item('up'));
    key(item('center'), 'ArrowDown');
    expect(document.activeElement).toBe(item('down-a'));
    key(item('center'), 'ArrowLeft');
    expect(document.activeElement).toBe(item('down-a'));
    expect(context.announce).toHaveBeenLastCalledWith('No item in that direction.');
  });

  it('explains Graph focus without selection and lets inspector close before clearing Graph focus', () => {
    const closeInspector = vi.fn(() => true);
    const { context, root } = fixture(
      '<section data-route-kind="planning.graph"><div tabindex="0" data-graph-focus="true"></div></section>',
      { closeInspector },
    );
    key(document.body, 'f');
    expect(context.announce).toHaveBeenLastCalledWith('Select a Graph node to focus.');
    key(document.body, 'Escape');
    expect(closeInspector).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-graph-focus]')).not.toBeNull();
  });

  it('closes the focused More disclosure before inspector and leaves menu Escape to its owner', () => {
    const { root, context } = fixture(
      '<details open><summary>More</summary><a href="#/home">Home</a></details><div role="menu"><button>Command</button></div>',
    );
    key(root.querySelector('a') as HTMLElement, 'Escape');
    expect(root.querySelector('details')?.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(root.querySelector('summary'));
    expect(context.closeInspector).not.toHaveBeenCalled();
    key(root.querySelector('button') as HTMLElement, 'Escape');
    expect(context.closeInspector).not.toHaveBeenCalled();
  });

  it('honors already-handled events and detaches every coordinator listener', () => {
    const { context, cleanup } = fixture();
    const handled = new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(context.openHelp).not.toHaveBeenCalled();
    cleanup();
    key(document.body, '?');
    key(document.body, 'k', { ctrlKey: true });
    expect(context.openHelp).not.toHaveBeenCalled();
    expect(context.togglePalette).not.toHaveBeenCalled();
  });
});
