// @ts-check
import { focusable } from './diagram-editor-dom.mjs';

const DIALOG_CONTROLS =
  'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]';
const PANEL_CONTROLS =
  'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex]:not([tabindex="-1"])';
const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const TREE_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowRight', 'ArrowLeft'];

/**
 * Focusable controls inside a container that are rendered and not hidden, inert or aria-hidden.
 * @param {Element} container
 * @param {string} selector
 * @returns {HTMLElement[]}
 */
const visibleControls = (container, selector) =>
  [.../** @type {NodeListOf<HTMLElement>} */ (container.querySelectorAll(selector))].filter(
    (control) =>
      !control.closest('[hidden],[inert],[aria-hidden="true"]') && control.getClientRects().length,
  );

/**
 * Resolve an editor shortcut from a key event, or null when the key is not an editor shortcut.
 * @type {typeof import('./diagram-editor-context.d.mts').editorShortcut}
 */
export function editorShortcut(event, { selection, clipboard, editable }) {
  const modifier = event.metaKey || event.ctrlKey;
  if (event.key === ' ') return { type: 'temporary-pan' };
  const key = event.key.toLowerCase();
  if (key === 'v' && !modifier) return { type: 'tool', tool: 'select' };
  if (key === 'h' && !modifier) return { type: 'tool', tool: 'pan' };
  if (modifier && key === 's') return { type: 'command', action: 'save' };
  if (modifier && key === 'z') return { type: 'command', action: event.shiftKey ? 'redo' : 'undo' };
  if (modifier && key === 'c' && selection) return { type: 'command', action: 'copy' };
  if (modifier && key === 'v' && clipboard) return { type: 'command', action: 'paste' };
  if ((event.key === 'Delete' || event.key === 'Backspace') && selection && editable)
    return { type: 'command', action: 'delete' };
  if (ARROWS.includes(event.key) && selection && editable) {
    const delta = event.shiftKey ? 10 : 1;
    const dx = event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0;
    const dy = event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0;
    return { type: 'nudge', dx, dy, delta };
  }
  return null;
}

/**
 * Document key handling: modal and drawer focus containment, menu, tab and tree navigation, shortcuts.
 * @type {typeof import('./diagram-editor-context.d.mts').createEditorKeyboard}
 */
export function createEditorKeyboard(ctx) {
  const { doc, dom, chrome, dialogs, canvas, outline, inspector, commands } = ctx;
  const { shell, stage, moreButton, moreMenu, leftTabs, rightTabs, outlinePane } = dom;
  const drawerPanel = () => (chrome.railOpen('left') ? dom.left : dom.right);
  const anyRailOpen = () => chrome.railOpen('left') || chrome.railOpen('right');

  function wrapDialogFocus(event) {
    const dialog = dialogs.active();
    if (!dialog || event.key !== 'Tab') return false;
    const controls = visibleControls(dialog, DIALOG_CONTROLS);
    if (!controls.length) return false;
    const first = controls[0],
      last = controls[controls.length - 1];
    if (event.shiftKey && doc.activeElement === first) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }
  function cycleDrawerFocus(event) {
    if (
      dialogs.active() ||
      event.key !== 'Tab' ||
      !ctx.layout.drawer() ||
      !anyRailOpen() ||
      !shell.contains(event.target)
    )
      return false;
    const controls = visibleControls(drawerPanel(), PANEL_CONTROLS);
    if (!controls.length) return false;
    const active = doc.activeElement,
      index = controls.findIndex((control) => control === active),
      step = event.shiftKey ? -1 : 1;
    const next =
      index < 0
        ? event.shiftKey
          ? controls.length - 1
          : 0
        : (index + step + controls.length) % controls.length;
    event.preventDefault();
    controls[next].focus({ preventScroll: true });
    return true;
  }
  function dismissLayers(event) {
    if (dialogs.active() && event.key === 'Escape') {
      event.preventDefault();
      commands.act('cancel-dialog');
      return true;
    }
    if (chrome.overflowOpen() && event.key === 'Escape') {
      event.preventDefault();
      chrome.setOverflow(false);
      return true;
    }
    if (chrome.overflowOpen() && event.key === 'Tab') {
      chrome.setOverflow(false);
      return true;
    }
    return false;
  }
  function navigateMenu(event) {
    if (event.target === moreButton && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      chrome.setOverflow(true);
      const items = [
        .../** @type {NodeListOf<HTMLElement>} */ (moreMenu.querySelectorAll('[role="menuitem"]')),
      ];
      (event.key === 'ArrowUp' ? items.at(-1) : items[0])?.focus();
      return true;
    }
    if (chrome.overflowOpen() && event.target.matches?.('[role="menuitem"]')) {
      const items = [
          .../** @type {NodeListOf<HTMLElement>} */ (
            moreMenu.querySelectorAll('[role="menuitem"]:not(:disabled)')
          ),
        ],
        index = items.indexOf(event.target);
      let next = -1;
      if (event.key === 'ArrowDown') next = (index + 1) % items.length;
      if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = items.length - 1;
      if (next >= 0) {
        event.preventDefault();
        items[next]?.focus();
        return true;
      }
    }
    return false;
  }
  function navigateTabs(event) {
    if (
      !event.target.matches?.('[role="tab"]') ||
      !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    )
      return false;
    const list = event.target.closest('[role="tablist"]'),
      tabs = [...list.querySelectorAll('[role="tab"]')],
      index = tabs.indexOf(event.target);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : event.key === 'ArrowRight'
            ? (index + 1) % tabs.length
            : (index - 1 + tabs.length) % tabs.length;
    event.preventDefault();
    const target = tabs[next],
      action = target.dataset.action;
    if (list === leftTabs) {
      outline.showTab(action === 'outline-tab' ? 'outline' : 'shapes');
      chrome.render(ctx.current(), { force: true });
      target.isConnected
        ? target.focus()
        : /** @type {HTMLElement | null} */ (
            leftTabs.querySelector('[aria-selected="true"]')
          )?.focus();
    } else if (list === rightTabs) inspector.showTab(target.dataset.tab, { focus: true });
    return true;
  }
  function closeTransient(event) {
    if (event.key === 'Escape' && ctx.layout.drawer() && anyRailOpen()) {
      event.preventDefault();
      chrome.closeDrawers();
      return true;
    }
    if (event.key === 'Escape' && canvas.dragging()) {
      event.preventDefault();
      canvas.cancelDrag();
      return true;
    }
    if (event.key === 'Escape' && ctx.current().gesture) {
      event.preventDefault();
      ctx.session.cancelGesture('escape');
      return true;
    }
    return false;
  }
  function navigateTree(event) {
    if (
      !event.target.matches?.('[role="treeitem"][data-action="select-id"]') ||
      !TREE_KEYS.includes(event.key) ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey
    )
      return false;
    event.preventDefault();
    const rows = [
        .../** @type {NodeListOf<HTMLElement>} */ (
          outlinePane.querySelectorAll('[role="treeitem"]')
        ),
      ].filter((row) => !row.closest('[hidden]')),
      row = event.target,
      index = rows.indexOf(row),
      expanded = row.getAttribute('aria-expanded');
    if (event.key === 'ArrowDown') outline.focusRow(rows[index + 1]);
    else if (event.key === 'ArrowUp') outline.focusRow(rows[index - 1]);
    else if (event.key === 'Home') outline.focusRow(rows[0]);
    else if (event.key === 'End') outline.focusRow(rows.at(-1));
    else if (event.key === 'ArrowRight') {
      if (expanded === 'false') outline.toggleGroup(row.dataset.id);
      else if (expanded === 'true') outline.focusRow(rows[index + 1]);
    } else if (expanded === 'true') outline.toggleGroup(row.dataset.id);
    else {
      const parentId = row.closest('.de-outline-item')?.dataset.parentId;
      outline.focusRow(
        parentId
          ? /** @type {HTMLElement | null} */ (
              outlinePane.querySelector('[role="treeitem"][data-id="' + parentId + '"]')
            )
          : null,
      );
    }
    return true;
  }
  function selectAdditive(event) {
    if (
      !event.target.matches?.('[data-action="select-id"]') ||
      !(event.shiftKey || event.metaKey || event.ctrlKey) ||
      (event.key !== 'Enter' && event.key !== ' ')
    )
      return false;
    event.preventDefault();
    commands.act('select-id', event.target.dataset.id, { additive: true, fromOutline: true });
    return true;
  }
  function runShortcut(event) {
    const state = ctx.current(),
      ids = state.view.selection;
    const shortcut = editorShortcut(event, {
      selection: ids.length > 0,
      clipboard: commands.hasClipboard(),
      editable: ctx.editable(state),
    });
    if (!shortcut) return;
    if (shortcut.type === 'temporary-pan') {
      if (event.target === stage) {
        event.preventDefault();
        canvas.setTemporaryPan(true);
      }
      return;
    }
    if (shortcut.type === 'tool') {
      commands.useTool(shortcut.tool, state);
      return;
    }
    event.preventDefault();
    if (shortcut.type === 'command') {
      commands.act(shortcut.action);
      return;
    }
    if (!inspector.guardDraft()) return;
    const result = commands.submit({ type: 'move', ids, dx: shortcut.dx, dy: shortcut.dy });
    if (result.ok)
      ctx.notice(
        'Selection moved ' + shortcut.delta + ' unit' + (shortcut.delta === 1 ? '' : 's') + '.',
      );
  }
  /** Ordered: the first step that consumes the event ends handling. */
  const navigation = [
    dismissLayers,
    navigateMenu,
    navigateTabs,
    closeTransient,
    navigateTree,
    selectAdditive,
  ];
  function keydown(event) {
    if (wrapDialogFocus(event) || cycleDrawerFocus(event)) return;
    if (!shell.contains(event.target) && !canvas.dragging() && !dialogs.active()) return;
    for (const step of navigation) if (step(event)) return;
    if (focusable(event.target) && event.target !== stage) return;
    runShortcut(event);
  }
  function focusin(event) {
    if (dialogs.active() || !ctx.layout.drawer() || dom.drawerBackdrop.hidden || !anyRailOpen())
      return;
    const panel = drawerPanel();
    // Host controls outside the editor stay reachable while a drawer is open.
    if (!panel || panel.contains(event.target) || !shell.contains(event.target)) return;
    (visibleControls(panel, PANEL_CONTROLS)[0] ?? panel).focus({ preventScroll: true });
  }
  function keyup(event) {
    if (event.key === ' ') canvas.setTemporaryPan(false);
  }
  return { keydown, focusin, keyup };
}
