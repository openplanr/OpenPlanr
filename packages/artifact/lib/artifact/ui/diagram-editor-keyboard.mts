import type { DiagramEditorTool } from './diagram-editor-canvas.mjs';
import { focusable, visibleMenuItems } from './diagram-editor-dom.mjs';
import type { DiagramEditorContext } from './diagram-editor-regions.mjs';

export interface DiagramEditorKeyboard {
  keydown(event: KeyboardEvent): void;
  focusin(event: FocusEvent): void;
  keyup(event: KeyboardEvent): void;
}
export type DiagramEditorShortcut =
  | { type: 'temporary-pan' }
  | { type: 'tool'; tool: DiagramEditorTool }
  | { type: 'command'; action: 'save' | 'undo' | 'redo' | 'copy' | 'paste' | 'delete' }
  | { type: 'nudge'; dx: number; dy: number; delta: number };
interface ShortcutContext {
  selection: boolean;
  clipboard: boolean;
  editable: boolean;
}
/** A key event from a control or row inside the editor. */
type ElementKeyEvent = KeyboardEvent & { target: HTMLElement };

const DIALOG_CONTROLS =
  'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]';
const PANEL_CONTROLS =
  'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex]:not([tabindex="-1"])';
const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const TREE_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowRight', 'ArrowLeft'];

/** Focusable controls inside a container that are rendered and not hidden, inert or aria-hidden. */
const visibleControls = (container: Element, selector: string): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>(selector)].filter(
    (control) =>
      !control.closest('[hidden],[inert],[aria-hidden="true"]') && control.getClientRects().length,
  );

/** Resolve an editor shortcut from a key event, or null when the key is not an editor shortcut. */
export function editorShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  { selection, clipboard, editable }: ShortcutContext,
): DiagramEditorShortcut | null {
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

/** Document key handling: modal and drawer focus containment, menu, tab and tree navigation, shortcuts. */
export function createEditorKeyboard(ctx: DiagramEditorContext): DiagramEditorKeyboard {
  const { doc, dom, chrome, dialogs, canvas, outline, inspector, commands } = ctx;
  const { shell, stage, moreButton, moreMenu, leftTabs, rightTabs, outlinePane } = dom;
  const drawerPanel = () => (chrome.railOpen('left') ? dom.left : dom.right);
  const anyRailOpen = () => chrome.railOpen('left') || chrome.railOpen('right');

  function wrapDialogFocus(event: KeyboardEvent) {
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
  function cycleDrawerFocus(event: ElementKeyEvent) {
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
  function dismissLayers(event: KeyboardEvent) {
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
  function navigateMenu(event: ElementKeyEvent) {
    if (event.target === moreButton && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      chrome.setOverflow(true);
      const items = visibleMenuItems(moreMenu);
      ((event.key === 'ArrowUp' ? items.at(-1) : items[0]) ?? moreButton).focus({
        preventScroll: true,
      });
      return true;
    }
    if (chrome.overflowOpen() && event.target.matches?.('[role="menuitem"]')) {
      const items = visibleMenuItems(moreMenu),
        index = items.indexOf(event.target);
      if (!items.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        moreButton.focus({ preventScroll: true });
        return true;
      }
      let next = -1;
      if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length;
      if (event.key === 'ArrowUp')
        next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
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
  function navigateTabs(event: ElementKeyEvent) {
    if (
      !event.target.matches?.('[role="tab"]') ||
      !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    )
      return false;
    // Every tab sits in a tablist.
    const list = event.target.closest('[role="tablist"]') as Element,
      tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')],
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
    // Right-rail tabs carry the id of the pane they show.
    if (list === leftTabs) {
      outline.showTab(action === 'outline-tab' ? 'outline' : 'shapes');
      chrome.render(ctx.current(), { force: true });
      target.isConnected
        ? target.focus()
        : leftTabs.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    } else if (list === rightTabs) inspector.showTab(target.dataset.tab as string, { focus: true });
    return true;
  }
  function closeTransient(event: KeyboardEvent) {
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
  function navigateTree(event: ElementKeyEvent) {
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
    const rows = [...outlinePane.querySelectorAll<HTMLElement>('[role="treeitem"]')].filter(
        (row) => !row.closest('[hidden]'),
      ),
      row = event.target,
      index = rows.indexOf(row),
      expanded = row.getAttribute('aria-expanded');
    if (event.key === 'ArrowDown') outline.focusRow(rows[index + 1]);
    else if (event.key === 'ArrowUp') outline.focusRow(rows[index - 1]);
    else if (event.key === 'Home') outline.focusRow(rows[0]);
    else if (event.key === 'End') outline.focusRow(rows.at(-1));
    // A row with aria-expanded is a group or lane, which carries its id.
    else if (event.key === 'ArrowRight') {
      if (expanded === 'false') outline.toggleGroup(row.dataset.id as string);
      else if (expanded === 'true') outline.focusRow(rows[index + 1]);
    } else if (expanded === 'true') outline.toggleGroup(row.dataset.id as string);
    else {
      const parentId = row.closest<HTMLElement>('.de-outline-item')?.dataset.parentId;
      outline.focusRow(
        parentId
          ? outlinePane.querySelector<HTMLElement>('[role="treeitem"][data-id="' + parentId + '"]')
          : null,
      );
    }
    return true;
  }
  function selectAdditive(event: ElementKeyEvent) {
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
  function runShortcut(event: KeyboardEvent) {
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
      // biome-ignore lint/correctness/useHookAtTopLevel: This imperative editor command selects a tool; it is not a React hook.
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
  // Key events reach the document from its focused element; the steps below match editor controls.
  function keydown(event: KeyboardEvent) {
    if (wrapDialogFocus(event) || cycleDrawerFocus(event as ElementKeyEvent)) return;
    if (!shell.contains(event.target as Node) && !canvas.dragging() && !dialogs.active()) return;
    for (const step of navigation) if (step(event as ElementKeyEvent)) return;
    const connectionHandle = (event.target as Element).closest?.('[data-handle="connect"]');
    if (connectionHandle && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      commands.act('connect');
      return;
    }
    if (connectionHandle) return;
    if (focusable(event.target) && event.target !== stage) return;
    runShortcut(event);
  }
  function focusin(event: FocusEvent) {
    if (dialogs.active() || !ctx.layout.drawer() || dom.drawerBackdrop.hidden || !anyRailOpen())
      return;
    const panel = drawerPanel();
    // Host controls outside the editor stay reachable while a drawer is open.
    // Focus events target the element that took focus.
    // biome-ignore format: bundles keep this one-line statement; wrapping would change their bytes.
    if (!panel || panel.contains(event.target as Node) || !shell.contains(event.target as Node)) return;
    (visibleControls(panel, PANEL_CONTROLS)[0] ?? panel).focus({ preventScroll: true });
  }
  function keyup(event: KeyboardEvent) {
    if (event.key === ' ') canvas.setTemporaryPan(false);
  }
  return { keydown, focusin, keyup };
}
