export type KeyboardContext = Readonly<{
  root: HTMLElement;
  selectionScope?: string;
  singleLetters: boolean;
  paletteOpen: boolean;
  togglePalette: () => void;
  openHelp: () => void;
  navigate: (href: string) => void;
  closeInspector: () => boolean;
  selectedId: () => string | null;
  copy: (text: string) => Promise<void>;
  announce: (message: string) => void;
}>;

export const SHORTCUT_MAP = [
  ['Cmd/Ctrl-K', 'Toggle search and focus its query'],
  ['J/K, Up/Down', 'Move through visible rows or palette results'],
  ['Enter', 'Open the inspector; palette commands copy only'],
  ['Cmd/Ctrl-Enter', 'Open the palette item as a full page'],
  ['@spec/@story/@task/@backlog/@adr/@sprint/@view/@command', 'Filter palette results by type'],
  ['C', 'Copy the focused command first, otherwise the selected canonical ID'],
  ['/', 'Focus the current filter, or open search'],
  [
    'G then H/L/G/B/S/A/O',
    'Home, List, Graph, Board, Sprints, Activity, Operate within one second',
  ],
  ['[ / ]', 'Collapse or expand the active List group'],
  ['F', 'Focus the selected Graph node'],
  ['Left/Right, Up/Down', 'Board columns/cards; Graph connected neighbours'],
  ['?', 'Open this shortcut help'],
  ['Esc', 'Close the top layer, then inspector, then clear Graph focus or selection'],
  ['Tab/Shift-Tab, Home/End', 'Normal traversal; roving menus and tabs retain their own keys'],
  ['Space, Shift-Up/Down', 'Toggle a List row or extend the contiguous selection'],
  ['Cmd/Ctrl-click', 'Open hash links in a new tab using the browser'],
] as const;

const DESTINATIONS: Readonly<Record<string, string>> = {
  h: '#/home',
  l: '#/list',
  g: '#/graph',
  b: '#/board',
  s: '#/sprints',
  a: '#/activity',
  o: '#/operate/today',
};

function typing(target: Element | null): boolean {
  return Boolean(
    target?.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]',
    ),
  );
}

function hiddenByDisclosure(element: HTMLElement): boolean {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName !== 'DETAILS' || parent.hasAttribute('open')) continue;
    const summary = Array.from(parent.children).find((child) => child.tagName === 'SUMMARY');
    if (!summary?.contains(element)) return true;
  }
  return false;
}

function visible(element: HTMLElement): boolean {
  return (
    !hiddenByDisclosure(element) &&
    !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
    !element.matches(':disabled, [aria-disabled="true"]')
  );
}

function items(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-keyboard-item]')).filter(visible);
}

function focusItem(item: HTMLElement, context: KeyboardContext): void {
  item.focus({ preventScroll: true });
  item.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  const rows = items(context.root);
  context.announce(`${rows.indexOf(item) + 1} of ${rows.length}`);
}

function graphNeighbour(
  current: HTMLElement,
  rows: HTMLElement[],
  key: string,
): HTMLElement | undefined {
  const ids = (current.dataset.neighbours ?? '').split('\n');
  const neighbours = rows.filter((row) => ids.includes(row.dataset.keyboardItem ?? ''));
  const x = Number(current.dataset.x);
  const y = Number(current.dataset.y);
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const direction = key === 'ArrowLeft' ? -1 : 1;
    return neighbours
      .filter((row) => (Number(row.dataset.x) - x) * direction > 0)
      .sort(
        (a, b) =>
          Math.hypot(Number(a.dataset.x) - x, Number(a.dataset.y) - y) -
            Math.hypot(Number(b.dataset.x) - x, Number(b.dataset.y) - y) ||
          (a.dataset.keyboardItem ?? '').localeCompare(b.dataset.keyboardItem ?? ''),
      )[0];
  }
  const ordered = [...neighbours, current].sort(
    (a, b) =>
      Number(a.dataset.y) - Number(b.dataset.y) ||
      (a.dataset.keyboardItem ?? '').localeCompare(b.dataset.keyboardItem ?? ''),
  );
  return ordered[ordered.indexOf(current) + (key === 'ArrowUp' ? -1 : 1)];
}

type CoordinatorState = {
  composing: boolean;
  goAt: number | null;
  anchor: string | null;
  selectionScope: string | undefined;
  selected: Set<string>;
};

type KeyStroke = Readonly<{
  event: KeyboardEvent;
  context: KeyboardContext;
  target: Element | null;
  key: string;
  command: boolean;
}>;

const INSPECTOR = '.pc-shell-inspector, .pc-inspector-sheet:not([aria-modal="true"])';
const ARROWS = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];

function consume(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function syncSelectionScope(state: CoordinatorState, context: KeyboardContext): void {
  if (state.selectionScope === context.selectionScope) return;
  state.selected.clear();
  state.anchor = null;
  state.goAt = null;
  state.selectionScope = context.selectionScope;
  for (const row of items(context.root)) {
    if (row.hasAttribute('aria-selected')) row.setAttribute('aria-selected', 'false');
  }
}

function renderSelection(state: CoordinatorState, context: KeyboardContext): void {
  for (const row of items(context.root)) {
    row.setAttribute('aria-selected', String(state.selected.has(row.dataset.keyboardItem ?? '')));
  }
  context.announce(`${state.selected.size} selected`);
}

function topModal(document: Document): HTMLElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      'dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"]',
    ),
  )
    .filter(visible)
    .at(-1);
}

function paletteChord(stroke: KeyStroke): boolean {
  return stroke.command && !stroke.event.altKey && !stroke.event.shiftKey && stroke.key === 'k';
}

function targetOwnsKeys(stroke: KeyStroke, modal: HTMLElement | undefined): boolean {
  if (modal || typing(stroke.target)) return true;
  return (
    Boolean(stroke.target?.closest('details[open], [role="menu"], [role="menuitem"]')) &&
    stroke.event.key !== 'Escape'
  );
}

function skipShortcut(stroke: KeyStroke, state: CoordinatorState, document: Document): boolean {
  const { event, context, target } = stroke;
  if (state.composing || event.isComposing || event.keyCode === 229) {
    event.stopPropagation();
    return true;
  }
  if (event.defaultPrevented) return true;
  const modal = topModal(document);
  if (paletteChord(stroke)) {
    if (modal && (!context.paletteOpen || !modal.matches('.pc-palette'))) return true;
    consume(event);
    context.togglePalette();
    return true;
  }
  if (targetOwnsKeys(stroke, modal) || stroke.command || event.altKey) return true;
  if (event.key.length !== 1 || event.key === ' ' || context.singleLetters) return false;
  if (stroke.key === 'c' && target?.closest('.pc-command-hint')) event.stopPropagation();
  return true;
}

function navigateSequence(stroke: KeyStroke, state: CoordinatorState): boolean {
  if (state.goAt === null) return false;
  const withinWindow = stroke.event.timeStamp - state.goAt <= 1000;
  state.goAt = null;
  const destination = DESTINATIONS[stroke.key];
  if (!withinWindow || !destination) return false;
  consume(stroke.event);
  stroke.context.navigate(destination);
  return true;
}

function focusFilter(context: KeyboardContext): void {
  const filter = Array.from(
    context.root.querySelectorAll<HTMLInputElement>(
      'input[type="search"], input[aria-label*="Filter"], input[aria-label*="filter"], input[aria-label="Search query"]',
    ),
  ).find(visible);
  if (filter) filter.focus();
  else context.togglePalette();
}

function focusedCanonicalId(target: Element | null): string | null {
  const row = target?.closest<HTMLElement>('[data-keyboard-item]');
  const id = row?.dataset.canonicalId || row?.dataset.keyboardItem;
  return id && !id.startsWith('empty:') ? id : null;
}

function copyFocused(stroke: KeyStroke): void {
  const { context, target } = stroke;
  const commandCard = target?.closest('.pc-command-hint');
  if (commandCard) {
    const button = commandCard.querySelector<HTMLButtonElement>('.pc-command-hint__copy');
    if (button && !button.disabled) button.click();
    else context.announce('This command is unavailable.');
    return;
  }
  const id = focusedCanonicalId(target) || context.selectedId();
  if (!id) {
    context.announce('Select an item or focus a command to copy.');
    return;
  }
  void context.copy(id).then(
    () => context.announce(`Copied ${id}`),
    () => context.announce(`Copy blocked. Select and copy manually: ${id}`),
  );
}

function closeTopLayer(stroke: KeyStroke, state: CoordinatorState): void {
  const { target, event, context } = stroke;
  if (target?.closest('[role="menu"], [role="tooltip"], [data-state="open"]')) return;
  const details = target?.closest('details[open]');
  if (details) {
    consume(event);
    details.removeAttribute('open');
    details.querySelector('summary')?.focus();
    return;
  }
  if (context.closeInspector()) {
    consume(event);
    return;
  }
  if (state.selected.size > 0) {
    consume(event);
    state.selected.clear();
    renderSelection(state, context);
    return;
  }
  const graph = context.root.querySelector<HTMLElement>('[data-graph-focus]');
  if (!graph) return;
  consume(event);
  delete graph.dataset.graphFocus;
  context.announce('Graph focus cleared');
}

function globalShortcut(stroke: KeyStroke, state: CoordinatorState): boolean {
  if (navigateSequence(stroke, state)) return true;
  switch (stroke.key) {
    case 'g':
      consume(stroke.event);
      state.goAt = stroke.event.timeStamp;
      return true;
    case '?':
      consume(stroke.event);
      stroke.context.openHelp();
      return true;
    case '/':
      consume(stroke.event);
      focusFilter(stroke.context);
      return true;
    case 'c':
      consume(stroke.event);
      copyFocused(stroke);
      return true;
    case 'escape':
      closeTopLayer(stroke, state);
      return true;
    default:
      return false;
  }
}

function routeIs(context: KeyboardContext, route: string): boolean {
  return Boolean(context.root.querySelector(`[data-route-kind="planning.${route}"]`));
}

function focusGraph(stroke: KeyStroke, current: HTMLElement | undefined): void {
  consume(stroke.event);
  if (!current) {
    stroke.context.announce('Select a Graph node to focus.');
    return;
  }
  current.dataset.graphFocus = 'true';
  current.focus();
  current.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'instant' });
}

function toggleGroup(stroke: KeyStroke, current: HTMLElement | undefined): void {
  consume(stroke.event);
  const group =
    stroke.target?.closest<HTMLElement>('[data-keyboard-group]') ??
    current?.closest<HTMLElement>('[data-keyboard-group]') ??
    stroke.context.root.querySelector<HTMLElement>('[data-keyboard-group]');
  const toggle = group?.querySelector<HTMLButtonElement>('[aria-expanded]');
  if (toggle && toggle.getAttribute('aria-expanded') !== String(stroke.key === ']')) {
    toggle.click();
    toggle.focus({ preventScroll: true });
  }
}

function rowActivation(
  stroke: KeyStroke,
  state: CoordinatorState,
  current: HTMLElement | undefined,
): boolean {
  if (!current || stroke.target !== current) return false;
  if (stroke.key === 'enter') {
    consume(stroke.event);
    current.click();
    return true;
  }
  if (stroke.key !== ' ' || !routeIs(stroke.context, 'list')) return false;
  consume(stroke.event);
  const id = current.dataset.keyboardItem ?? '';
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  state.anchor = id;
  renderSelection(state, stroke.context);
  return true;
}

function viewShortcut(
  stroke: KeyStroke,
  state: CoordinatorState,
  current: HTMLElement | undefined,
): boolean {
  if (stroke.key === 'f' && routeIs(stroke.context, 'graph')) {
    focusGraph(stroke, current);
    return true;
  }
  if ((stroke.key === '[' || stroke.key === ']') && routeIs(stroke.context, 'list')) {
    toggleGroup(stroke, current);
    return true;
  }
  return rowActivation(stroke, state, current);
}

function boardNeighbour(
  context: KeyboardContext,
  current: HTMLElement,
  key: string,
): HTMLElement | undefined {
  const column = current.closest<HTMLElement>('[data-keyboard-column]');
  const columns = Array.from(
    context.root.querySelectorAll<HTMLElement>('[data-keyboard-column]'),
  ).filter(visible);
  const ordinal = Array.from(column?.querySelectorAll<HTMLElement>('[data-keyboard-item]') ?? [])
    .filter(visible)
    .indexOf(current);
  const adjacent = columns[columns.indexOf(column as HTMLElement) + (key === 'ArrowLeft' ? -1 : 1)];
  const cards = Array.from(
    adjacent?.querySelectorAll<HTMLElement>('[data-keyboard-item]') ?? [],
  ).filter(visible);
  return cards[Math.min(ordinal, cards.length - 1)];
}

function nextItem(
  stroke: KeyStroke,
  rows: HTMLElement[],
  current: HTMLElement | undefined,
): HTMLElement | undefined {
  const { event, key, context } = stroke;
  if (current?.dataset.neighbours !== undefined && event.key.startsWith('Arrow'))
    return graphNeighbour(current, rows, event.key);
  const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
  if (current?.closest('[data-keyboard-column]') && horizontal)
    return boardNeighbour(context, current, event.key);
  if (horizontal) return undefined;
  const localRows = current
    ?.closest('[data-keyboard-column]')
    ?.querySelectorAll<HTMLElement>('[data-keyboard-item]');
  const group = localRows ? Array.from(localRows).filter(visible) : rows;
  const forward = key === 'j' || event.key === 'ArrowDown';
  if (!current) return group[forward ? 0 : group.length - 1];
  return group[group.indexOf(current) + (forward ? 1 : -1)];
}

function nativeTraversal(stroke: KeyStroke, current: HTMLElement | undefined): boolean {
  if (!stroke.target?.closest('button, a, [role="tab"], [role="menuitem"]')) return false;
  if ((stroke.key === 'j' || stroke.key === 'k') && stroke.target.closest(INSPECTOR)) return false;
  return stroke.target !== current;
}

function extendRange(
  state: CoordinatorState,
  context: KeyboardContext,
  rows: HTMLElement[],
  current: HTMLElement | undefined,
  next: HTMLElement,
): void {
  state.anchor ??= current?.dataset.keyboardItem ?? next.dataset.keyboardItem ?? null;
  const start = rows.findIndex((row) => row.dataset.keyboardItem === state.anchor);
  const end = rows.indexOf(next);
  state.selected.clear();
  for (const row of rows.slice(Math.min(start, end), Math.max(start, end) + 1))
    state.selected.add(row.dataset.keyboardItem ?? '');
  focusItem(next, context);
  renderSelection(state, context);
}

function moveShortcut(
  stroke: KeyStroke,
  state: CoordinatorState,
  rows: HTMLElement[],
  current: HTMLElement | undefined,
): void {
  if (nativeTraversal(stroke, current)) return;
  const move = stroke.key === 'j' || stroke.key === 'k' || ARROWS.includes(stroke.event.key);
  if (!move || rows.length === 0) return;
  const next = nextItem(stroke, rows, current);
  consume(stroke.event);
  if (!next) {
    stroke.context.announce('No item in that direction.');
    return;
  }
  const range =
    stroke.event.shiftKey &&
    routeIs(stroke.context, 'list') &&
    ['ArrowUp', 'ArrowDown'].includes(stroke.event.key);
  if (range) extendRange(state, stroke.context, rows, current, next);
  else {
    state.anchor = null;
    focusItem(next, stroke.context);
  }
}

function currentItem(stroke: KeyStroke, rows: HTMLElement[]): HTMLElement | undefined {
  const focused = stroke.target?.closest<HTMLElement>('[data-keyboard-item]');
  const selected = rows.find((row) => row.dataset.selected === 'true');
  if (focused || selected) return focused ?? selected;
  if (!stroke.target?.closest(INSPECTOR)) return undefined;
  const id = stroke.context.selectedId();
  return rows.find((row) => (row.dataset.canonicalId || row.dataset.keyboardItem) === id);
}

/** A single owner arbitrates global keys before component activation can conflict. */
export function installKeyboardCoordinator(
  document: Document,
  getContext: () => KeyboardContext,
): () => void {
  const state: CoordinatorState = {
    composing: false,
    goAt: null,
    anchor: null,
    selectionScope: undefined,
    selected: new Set(),
  };
  const compositionStart = () => {
    state.composing = true;
    state.goAt = null;
  };
  const compositionEnd = () => {
    state.composing = false;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const context = getContext();
    syncSelectionScope(state, context);
    const stroke: KeyStroke = {
      event,
      context,
      target: event.target instanceof Element ? event.target : null,
      key: event.key.toLowerCase(),
      command: event.metaKey || event.ctrlKey,
    };
    if (skipShortcut(stroke, state, document)) {
      state.goAt = null;
      return;
    }
    if (globalShortcut(stroke, state)) return;
    const rows = items(context.root);
    const current = currentItem(stroke, rows);
    if (viewShortcut(stroke, state, current)) return;
    moveShortcut(stroke, state, rows, current);
  };
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('compositionstart', compositionStart, true);
  document.addEventListener('compositionend', compositionEnd, true);
  return () => {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('compositionstart', compositionStart, true);
    document.removeEventListener('compositionend', compositionEnd, true);
  };
}
