import {
  type DiagramAuthoringNode,
  type DiagramSemanticEntry,
  getDiagramAuthoringCapability,
} from '@openplanr/protocol/diagram-authoring-contracts';
import { elementIndex, isAuthoringSnapshot } from '../diagram/authoring/model.mjs';
import type { DiagramEditorState } from '../diagram/editor/index.mjs';
import type { DiagramEditorIconName } from './diagram-editor.mjs';
import { displayName, kindName } from './diagram-editor-actions.mjs';
import { errText } from './diagram-editor-commands.mjs';
import { button, element, field, icon } from './diagram-editor-dom.mjs';
import type { DiagramEditorContext } from './diagram-editor-regions.mjs';

export type DiagramEditorLeftTab = 'outline' | 'shapes';
export interface DiagramEditorOutline {
  tab(): DiagramEditorLeftTab;
  showTab(next: DiagramEditorLeftTab, options?: { focus?: boolean }): void;
  /** Choose the tab the next render shows without touching the DOM. */
  preferTab(next: DiagramEditorLeftTab): void;
  render(state: DiagramEditorState): void;
  toggleGroup(id: string): void;
  focusRow(row: HTMLElement | null | undefined): void;
}

const ACTION_LABELS: Record<string, string> = {
  process: 'process',
  start: 'start',
  end: 'end',
  decision: 'decision',
  'data-store': 'data store',
  component: 'component',
  annotation: 'annotation',
  container: 'container',
  'horizontal-lane': 'horizontal lane',
  'vertical-lane': 'vertical lane',
};
const KIND_ICONS: Readonly<Record<string, DiagramEditorIconName>> = Object.freeze({
  process: 'kind-process',
  start: 'kind-terminal',
  end: 'kind-terminal',
  decision: 'kind-decision',
  'data-store': 'kind-store',
  component: 'kind-component',
  container: 'kind-container',
  'horizontal-lane': 'kind-lane',
  'vertical-lane': 'kind-lane-vertical',
  annotation: 'kind-annotation',
});
// Groups and lanes share one entry type, so the checks below cannot narrow the last branch to a node.
const outlineIcon = (entry: DiagramSemanticEntry) =>
  entry.collection === 'relations'
    ? 'kind-connector'
    : entry.collection === 'lanes'
      ? 'kind-lane'
      : entry.collection === 'groups'
        ? 'kind-container'
        : entry.collection === 'annotations'
          ? 'kind-annotation'
          : (KIND_ICONS[(entry.value as DiagramAuthoringNode).kind] ?? 'kind-process');

/** The left rail: Outline and Shapes tabs, the object tree and the shape palette. */
export function createEditorOutline(ctx: DiagramEditorContext): DiagramEditorOutline {
  const { doc, session } = ctx;
  const { leftTabs, outlinePane, shapesPane } = ctx.dom;
  let tab: DiagramEditorLeftTab = 'outline';
  let renderedDocument: object | null = null;
  let renderedControls = '';

  function setLeftTab(next: DiagramEditorLeftTab, { focus = false }: { focus?: boolean } = {}) {
    tab = next;
    const outlineSelected = next === 'outline';
    outlinePane.hidden = !outlineSelected;
    shapesPane.hidden = outlineSelected;
    for (const tabNode of leftTabs.querySelectorAll<HTMLElement>('[role="tab"]')) {
      const selected = tabNode.dataset.action === (outlineSelected ? 'outline-tab' : 'shapes-tab');
      tabNode.setAttribute('aria-selected', String(selected));
      tabNode.tabIndex = selected ? 0 : -1;
      if (selected && focus) tabNode.focus({ preventScroll: true });
    }
  }
  function toggleGroup(id: string) {
    const collapsed = new Set(ctx.current().view.collapsedGroups);
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    const result = session.setView({ collapsedGroups: [...collapsed] });
    if (!result.ok) {
      ctx.report(errText(result));
      return;
    }
    focusOutlineRow(
      outlinePane.querySelector<HTMLElement>('[role="treeitem"][data-id="' + id + '"]'),
    );
  }
  function focusOutlineRow(row: HTMLElement | null | undefined) {
    if (!row) return;
    for (const item of outlinePane.querySelectorAll<HTMLElement>('[role="treeitem"]'))
      item.tabIndex = -1;
    row.tabIndex = 0;
    row.focus();
  }
  function renderLeft(state: DiagramEditorState) {
    const { editable, readOnly } = ctx;
    // Geometry-only revisions reuse an engine-certified immutable semantic root.
    // Unknown caller sessions never get identity-based rendering reuse.
    const document =
      state.bundle && isAuthoringSnapshot(state.bundle) ? state.bundle.document : null;
    const controls = JSON.stringify([
      state.view.selection,
      state.view.collapsedGroups,
      tab,
      editable(state),
      readOnly(state),
    ]);
    if (document && renderedDocument === document && renderedControls === controls) return;
    renderedDocument = null;
    leftTabs.replaceChildren();
    if (readOnly(state)) tab = 'outline';
    for (const [name, action] of readOnly(state)
      ? [['Outline', 'outline-tab']]
      : [
          ['Outline', 'outline-tab'],
          ['Shapes', 'shapes-tab'],
        ]) {
      const selected = tab === name.toLowerCase();
      const item = button(doc, name, action, {
        id: ctx.scopedId(name.toLowerCase() + '-tab'),
        role: 'tab',
        'aria-selected': String(selected),
        'aria-controls': ctx.scopedId(name.toLowerCase() + '-pane'),
        tabindex: selected ? '0' : '-1',
      });
      leftTabs.append(item);
    }
    outlinePane.replaceChildren();
    shapesPane.replaceChildren();
    setLeftTab(tab);
    if (!state.bundle) return;
    shapesPane.append(
      element(doc, 'p', { className: 'de-muted' }, 'Add a shape, then refine it in the inspector.'),
    );
    const capability = getDiagramAuthoringCapability(state.bundle.document.grammar.id);
    const groups: Array<[string, string[]]> = [
      ['Flow', ['process', 'start', 'end', 'decision', 'data-store', 'component']],
      ['Structure', ['container', 'horizontal-lane', 'vertical-lane']],
      ['Notes', ['annotation']],
    ];
    for (const [title, kinds] of groups) {
      const section = element(doc, 'section', { className: 'de-shape-section' }),
        grid = element(doc, 'div', { className: 'de-shape-grid' });
      section.append(element(doc, 'h3', {}, title), grid);
      for (const kind of kinds) {
        const primitive =
          kind === 'annotation'
            ? 'annotation'
            : kind === 'container'
              ? 'group'
              : kind.endsWith('-lane')
                ? 'lane'
                : 'node';
        if (capability && !capability.primitives.includes(primitive)) continue;
        if (
          capability &&
          primitive === 'node' &&
          !capability.nodeKinds.some((item) => item === kind)
        )
          continue;
        const shape = button(doc, '', 'create', {
          'data-kind': kind,
          className: 'de-shape-button',
          'aria-label': 'Create ' + ACTION_LABELS[kind],
          disabled: !editable(state),
        });
        const shapeKind = element(doc, 'span', {
          className: 'de-shape-kind',
          'aria-hidden': 'true',
        });
        shapeKind.append(icon(doc, KIND_ICONS[kind], { size: 16 }));
        shape.append(
          shapeKind,
          element(
            doc,
            'span',
            {},
            ACTION_LABELS[kind].replace(/^./, (letter) => letter.toUpperCase()),
          ),
        );
        grid.append(shape);
      }
      if (grid.childElementCount) shapesPane.append(section);
    }
    const search = field(doc, 'Find in diagram', '', {
      type: 'search',
      placeholder: 'Search objects',
    });
    search.label.append(icon(doc, 'search', { className: 'de-icon de-search-icon' }));
    outlinePane.append(search.label);
    const list = element(doc, 'div', {
      className: 'de-outline-list',
      role: 'tree',
      'aria-label': 'Diagram objects',
    });
    outlinePane.append(list);
    const indexed = elementIndex(state.bundle.document),
      parents = new Set(
        [...state.bundle.document.groups, ...state.bundle.document.lanes].flatMap(
          (value) => value.members,
        ),
      );
    const collapsedGroups = new Set(state.view.collapsedGroups);
    // Each row draws its own guide segments: a continuing rule per open ancestor branch, then a tee or an elbow.
    function itemFor(
      id: string,
      depth = 0,
      trail: boolean[] = [],
      last = true,
      parentId: string | null = null,
    ) {
      const entry = indexed.get(id);
      if (!entry) return;
      const members = (
          entry.collection === 'groups' || entry.collection === 'lanes' ? entry.value.members : []
        ).filter((member: string) => indexed.has(member)),
        collapsed = members.length > 0 && collapsedGroups.has(id);
      const name = displayName(indexed, id),
        kind = kindName(entry);
      const wrapper = element(doc, 'div', {
        className: 'de-outline-item',
        'data-id': id,
        'data-parent-id': parentId,
        'data-search-text': `${name} ${kind}`.toLowerCase(),
      });
      const choose = button(doc, '', 'select-id', {
        role: 'treeitem',
        'data-id': id,
        // A connector's name alone does not say it is one; the visible row shows its kind.
        'aria-label': entry.collection === 'relations' ? `${name}, ${kind}` : name,
        'aria-level': String(depth + 1),
        'aria-selected': String(state.view.selection.includes(id)),
        'aria-expanded': members.length ? String(!collapsed) : null,
        tabindex: '-1',
      });
      const guides = element(doc, 'span', {
        className: 'de-outline-guides',
        'aria-hidden': 'true',
      });
      for (const ancestorLast of trail.slice(1))
        guides.append(
          element(doc, 'span', { className: ancestorLast ? 'de-guide' : 'de-guide de-guide-line' }),
        );
      if (depth > 0)
        guides.append(
          element(doc, 'span', {
            className: 'de-guide ' + (last ? 'de-guide-elbow' : 'de-guide-tee'),
          }),
        );
      const twisty = element(doc, 'span', {
        className: members.length ? 'de-outline-twisty' : 'de-outline-twisty de-outline-leaf',
        'aria-hidden': 'true',
        'data-action': members.length ? 'toggle-group' : null,
        'data-id': members.length ? id : null,
      });
      if (members.length) twisty.append(icon(doc, 'chevron', { size: 12 }));
      const kindIcon = element(doc, 'span', {
        className: 'de-outline-kind',
        'aria-hidden': 'true',
      });
      kindIcon.append(icon(doc, outlineIcon(entry), { size: 14 }));
      choose.append(
        guides,
        twisty,
        kindIcon,
        element(doc, 'span', { className: 'de-outline-label' }, name),
      );
      if (kind.toLowerCase() !== name.toLowerCase())
        choose.append(
          element(doc, 'span', { className: 'de-outline-meta', 'aria-hidden': 'true' }, kind),
        );
      wrapper.append(choose);
      list.append(wrapper);
      if (!collapsed)
        members.forEach((child: string, index: number) => {
          itemFor(child, depth + 1, [...trail, last], index === members.length - 1, id);
        });
    }
    for (const id of state.bundle.document.accessibility.readingOrder)
      if (indexed.has(id) && !parents.has(id)) itemFor(id);
    for (const [id] of indexed)
      if (!parents.has(id) && !list.querySelector('[data-id="' + id + '"]')) itemFor(id);
    const rows = [...list.querySelectorAll('[role="treeitem"]')];
    (rows.find((row) => row.getAttribute('aria-selected') === 'true') ?? rows[0])?.setAttribute(
      'tabindex',
      '0',
    );
    search.input.addEventListener('input', () => {
      const query = search.input.value.toLowerCase().trim(),
        items = [...list.querySelectorAll<HTMLElement>('.de-outline-item')],
        keep = new Set();
      if (query)
        // itemFor sets data-search-text on every outline item.
        for (const item of items)
          if ((item.dataset.searchText as string).includes(query))
            for (
              let node: HTMLElement | null = item;
              node;
              node = node.dataset.parentId
                ? list.querySelector<HTMLElement>(
                    '.de-outline-item[data-id="' + node.dataset.parentId + '"]',
                  )
                : null
            )
              keep.add(node);
      for (const item of items) item.hidden = !!query && !keep.has(item);
    });
    if (!indexed.size)
      outlinePane.append(
        element(doc, 'p', { className: 'de-muted' }, 'No objects yet. Use Shapes to create one.'),
      );
    renderedDocument = document;
    renderedControls = controls;
  }
  return {
    tab: () => tab,
    showTab: setLeftTab,
    preferTab(next) {
      tab = next;
    },
    render: renderLeft,
    toggleGroup,
    focusRow: focusOutlineRow,
  };
}
