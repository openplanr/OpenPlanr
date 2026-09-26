// @ts-check
import { getDiagramAuthoringCapability } from '@openplanr/protocol/diagram-authoring-contracts';
import { elementIndex } from '../diagram/authoring/model.mjs';
import { labelOf } from './diagram-editor-actions.mjs';
import { errText } from './diagram-editor-commands.mjs';
import { button, element, field, icon } from './diagram-editor-dom.mjs';

const ACTION_LABELS = {
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
const KIND_ICONS = Object.freeze({
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
const outlineIcon = (entry) =>
  entry.collection === 'relations'
    ? 'kind-connector'
    : entry.collection === 'lanes'
      ? 'kind-lane'
      : entry.collection === 'groups'
        ? 'kind-container'
        : entry.collection === 'annotations'
          ? 'kind-annotation'
          : (KIND_ICONS[entry.value.kind] ?? 'kind-process');

/**
 * The left rail: Outline and Shapes tabs, the object tree and the shape palette.
 * @type {typeof import('./diagram-editor-context.d.mts').createEditorOutline}
 */
export function createEditorOutline(ctx) {
  const { doc, session } = ctx;
  const { leftTabs, outlinePane, shapesPane } = ctx.dom;
  /** @type {'outline' | 'shapes'} */
  let tab = 'outline';

  function setLeftTab(next, { focus = false } = {}) {
    tab = next;
    const outlineSelected = next === 'outline';
    outlinePane.hidden = !outlineSelected;
    shapesPane.hidden = outlineSelected;
    for (const tabNode of /** @type {NodeListOf<HTMLElement>} */ (
      leftTabs.querySelectorAll('[role="tab"]')
    )) {
      const selected = tabNode.dataset.action === (outlineSelected ? 'outline-tab' : 'shapes-tab');
      tabNode.setAttribute('aria-selected', String(selected));
      tabNode.tabIndex = selected ? 0 : -1;
      if (selected && focus) tabNode.focus({ preventScroll: true });
    }
  }
  function toggleGroup(id) {
    const collapsed = new Set(ctx.current().view.collapsedGroups);
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    const result = session.setView({ collapsedGroups: [...collapsed] });
    if (!result.ok) {
      ctx.report(errText(result));
      return;
    }
    focusOutlineRow(outlinePane.querySelector('[role="treeitem"][data-id="' + id + '"]'));
  }
  function focusOutlineRow(row) {
    if (!row) return;
    for (const item of /** @type {NodeListOf<HTMLElement>} */ (
      outlinePane.querySelectorAll('[role="treeitem"]')
    ))
      item.tabIndex = -1;
    row.tabIndex = 0;
    row.focus();
  }
  function renderLeft(state) {
    const { editable, readOnly } = ctx;
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
    const groups = [
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
    function itemFor(id, depth = 0, trail = [], last = true, parentId = null) {
      const entry = indexed.get(id);
      if (!entry) return;
      const members = (entry.value.members ?? []).filter((member) => indexed.has(member)),
        collapsed = members.length > 0 && collapsedGroups.has(id);
      const wrapper = element(doc, 'div', {
        className: 'de-outline-item',
        'data-id': id,
        'data-parent-id': parentId,
        'data-search-text': labelOf(entry.value).toLowerCase(),
      });
      const kind =
        entry.collection === 'relations'
          ? 'Connector'
          : entry.collection === 'lanes'
            ? 'Lane'
            : entry.collection === 'groups'
              ? 'Group'
              : entry.collection === 'annotations'
                ? 'Note'
                : (entry.value.kind ?? 'Shape');
      const choose = button(doc, '', 'select-id', {
        role: 'treeitem',
        'data-id': id,
        'aria-label': labelOf(entry.value),
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
        element(doc, 'span', { className: 'de-outline-label' }, labelOf(entry.value)),
        element(doc, 'span', { className: 'de-outline-meta', 'aria-hidden': 'true' }, kind),
      );
      wrapper.append(choose);
      list.append(wrapper);
      if (!collapsed)
        members.forEach((child, index) => {
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
        items = [...list.querySelectorAll('.de-outline-item')],
        keep = new Set();
      if (query)
        for (const item of items)
          if (item.dataset.searchText.includes(query))
            for (
              let node = item;
              node;
              node = node.dataset.parentId
                ? list.querySelector('.de-outline-item[data-id="' + node.dataset.parentId + '"]')
                : null
            )
              keep.add(node);
      for (const item of items) item.hidden = !!query && !keep.has(item);
    });
    if (!indexed.size)
      outlinePane.append(
        element(doc, 'p', { className: 'de-muted' }, 'No objects yet. Use Shapes to create one.'),
      );
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
