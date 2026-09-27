import type {
  DiagramAppearance,
  DiagramAuthoringBundle,
  DiagramEditTransaction,
  DiagramPlacement,
} from '@openplanr/protocol/diagram-authoring-contracts';
import {
  appearanceFields,
  clone,
  elementIndex,
  geometryFields,
  parentIndex,
  semanticFields,
} from '../diagram/authoring/model.mjs';
import type { DiagramEditorState } from '../diagram/editor/index.mjs';
import type { DiagramEditorIconName } from './diagram-editor.mjs';
import {
  arrangedPlacements,
  COLLECTION_NAMES,
  displayName,
  moveOrthogonalBend,
  NODE_NAMES,
  propertyTransaction,
  quantity,
} from './diagram-editor-actions.mjs';
import type { DiagramEditorPoint as Point } from './diagram-editor-context.d.mts';
import {
  button,
  type ElementAttributes,
  element,
  type FieldControl,
  type FieldOptions,
  field,
  icon,
  iconButton,
} from './diagram-editor-dom.mjs';

type PropertiesAct = (action: string, value?: unknown) => void;
/** What the inspector reads from a submitted property transaction. */
interface PropertiesResult {
  ok: boolean;
  skipped?: boolean;
}
/** The inspector's handle on the properties form it asked for. */
export interface DiagramPropertiesController {
  readonly dirty: boolean;
  apply(): PropertiesResult;
  revert(): PropertiesResult;
  focus(): void;
}
interface DiagramPropertiesOptions {
  root: HTMLElement;
  state: DiagramEditorState;
  editable: boolean;
  act: PropertiesAct;
  submitTransaction: (transaction: DiagramEditTransaction) => PropertiesResult;
  onDirtyChange?: (dirty: boolean) => void;
}
interface InspectorHeading {
  kicker: string;
  title: string;
  description?: string;
}
interface SectionOptions {
  iconName?: string;
  open?: boolean;
  className?: string;
}
type ActionItem = [
  label: string,
  action: string | null,
  iconName: DiagramEditorIconName | null,
  attributes?: ElementAttributes,
];
/** The selected objects and how to act on them. */
interface Inspection {
  bundle: DiagramAuthoringBundle;
  byId: ReturnType<typeof elementIndex>;
  ids: string[];
  editable: boolean;
  act: PropertiesAct;
}
interface SelectionView extends Inspection {
  document: Document;
  root: HTMLElement;
}

/** Select options that show a stored value in sentence case: "data-store" reads "Data store". */
const labelled = (...values: string[]): Array<[string, string]> =>
  values.map((value) => [value, value[0].toUpperCase() + value.slice(1).replaceAll('-', ' ')]);

function cleanController(root: HTMLElement): DiagramPropertiesController {
  return {
    get dirty() {
      return false;
    },
    apply() {
      return { ok: true, skipped: true };
    },
    revert() {
      return { ok: true, skipped: true };
    },
    focus() {
      root
        .querySelector<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
        )
        ?.focus();
    },
  };
}

function inspectorHeader(document: Document, { kicker, title, description }: InspectorHeading) {
  const header = element(document, 'header', {
    className: 'de-inspector-header',
  });
  const identity = element(document, 'div', {
    className: 'de-inspector-identity',
  });
  identity.append(element(document, 'span', { className: 'de-inspector-kicker' }, kicker));
  identity.append(element(document, 'h2', { className: 'de-inspector-title' }, title));
  if (description)
    identity.append(element(document, 'p', { className: 'de-inspector-description' }, description));
  header.append(identity);
  return header;
}

/** An internal id, readable and copyable, for the Advanced section only. */
function referenceRow(document: Document, reference: string, act: PropertiesAct) {
  const row = element(document, 'div', { className: 'de-inspector-reference' });
  const copy = button(document, 'Copy', null, { 'aria-label': 'Copy reference' });
  copy.onclick = () => act('copy-reference', reference);
  row.append(
    element(document, 'span', {}, 'Reference'),
    element(document, 'code', {}, reference),
    copy,
  );
  return row;
}

/** A flat group of controls under a sentence-case heading. */
function inspectorGroup(document: Document, title: string) {
  const group = element(document, 'section', { className: 'de-inspector-group' });
  group.append(element(document, 'h3', {}, title));
  return group;
}

/** A muted line under a control that says why it is disabled. */
function disabledReason(document: Document) {
  return element(document, 'p', { className: 'de-inspector-reason', hidden: true });
}
/** Disable `control` and show `text` while there is a reason; a read-only view shows none. */
function explain(control: HTMLButtonElement, reason: HTMLElement, text: string, editable: boolean) {
  control.disabled = !editable || !!text;
  reason.textContent = text;
  reason.hidden = !editable || !text;
}

function inspectorSection(
  document: Document,
  title: string,
  { iconName, open = false, className = '' }: SectionOptions = {},
) {
  const details = element(document, 'details', {
    className: ['de-inspector-section', className].filter(Boolean).join(' '),
    ...(open ? { open: true } : {}),
  });
  const summary = element(document, 'summary', {
    className: 'de-inspector-section-summary',
  });
  if (iconName) summary.append(icon(document, iconName, { size: 15 }));
  summary.append(element(document, 'span', {}, title));
  const body = element(document, 'div', {
    className: 'de-inspector-section-body',
  });
  details.append(summary, body);
  return { details, body };
}

function actionRow(
  document: Document,
  target: HTMLElement,
  items: ActionItem[],
  { className = '' }: { className?: string } = {},
) {
  const row = element(document, 'div', {
    className: ['de-actions', 'de-inspector-action-row', className].filter(Boolean).join(' '),
  });
  for (const [label, action, iconName, attributes = {}] of items) {
    row.append(
      iconName
        ? iconButton(document, label, action, { icon: iconName, ...attributes })
        : button(document, label, action, attributes),
    );
  }
  target.append(row);
  return row;
}

/** Context-specific controls; validation and mutation remain in the session. */
export function renderDiagramProperties({
  root,
  state,
  editable,
  act,
  submitTransaction,
  onDirtyChange,
}: DiagramPropertiesOptions): DiagramPropertiesController {
  const document = root.ownerDocument;
  const bundle = state.bundle;
  const ids = state.view.selection;
  root.replaceChildren();
  root.classList.add('de-inspector');
  root.dataset.inspectorSelection =
    ids.length > 1 ? 'multiple' : ids.length === 1 ? 'single' : 'none';

  if (!bundle) {
    root.append(
      inspectorHeader(document, {
        kicker: 'Unavailable',
        title: 'Diagram access changed',
      }),
    );
    root.append(
      element(
        document,
        'p',
        { className: 'de-inspector-empty' },
        'Reopen this diagram with a current owner session.',
      ),
    );
    onDirtyChange?.(false);
    return cleanController(root);
  }
  const byId = elementIndex(bundle.document);
  const placements = new Map(bundle.presentation.elements.map((item) => [item.elementId, item]));

  if (!ids.length) {
    root.append(
      inspectorHeader(document, {
        kicker: 'Diagram',
        title: 'Diagram details',
        description: bundle.document.title,
      }),
    );
    const overview = inspectorSection(document, 'Overview', {
      iconName: 'content',
      open: true,
    });
    overview.body.append(
      element(
        document,
        'p',
        {},
        editable
          ? 'Select an object on the canvas or in the outline to edit its properties.'
          : 'Select an object to inspect its properties.',
      ),
      element(
        document,
        'p',
        { className: 'de-muted' },
        `Profile: ${bundle.document.grammar.id}. Layout and meaning are saved together.`,
      ),
    );
    const title = field(document, 'Diagram title', bundle.document.title, {
      maxlength: 240,
      disabled: !editable,
    });
    overview.body.append(title.label);
    const changeTitle = iconButton(document, 'Update title', null, {
      icon: 'save',
      disabled: !editable,
    });
    changeTitle.onclick = () => act('update-title', title.input.value);
    overview.body.append(changeTitle);
    root.append(overview.details);
    const advanced = inspectorSection(document, 'Advanced', { iconName: 'advanced' });
    advanced.body.append(referenceRow(document, bundle.diagramId, act));
    root.append(advanced.details);
    onDirtyChange?.(false);
    return cleanController(root);
  }

  if (ids.length > 1) {
    renderMultiSelection({ document, root, bundle, ids, byId, editable, act });
    onDirtyChange?.(false);
    return cleanController(root);
  }

  const id = ids[0];
  const entry = byId.get(id);
  // Every object in a validated bundle has a placement.
  const place = placements.get(id) as DiagramPlacement;
  const sem = semanticFields(entry.collection, entry.value);
  const geom = geometryFields(place);
  const look = appearanceFields(place);
  root.append(
    inspectorHeader(document, {
      kicker: `${COLLECTION_NAMES[entry.collection] ?? 'Object'} properties`,
      title: displayName(byId, id),
    }),
  );

  const form = element(document, 'form', {
    className: 'de-properties-form de-inspector-form',
    'aria-label': 'Object properties',
  });
  const inputs = new Map<string, FieldControl>();
  const trackedInputs = new Set<FieldControl>();
  const add = (target: HTMLElement, name: string, value: unknown, options: FieldOptions = {}) => {
    const item = field(document, name, value, {
      disabled: !editable,
      ...options,
    });
    inputs.set(name, item.input);
    trackedInputs.add(item.input);
    target.append(item.label);
    return item.input;
  };

  const content = inspectorSection(document, 'Content', {
    iconName: 'content',
    open: true,
  });
  // Apply writes this field back, so a derived name is only ever a placeholder.
  const storedLabel = entry.value.label ?? entry.value.text ?? '';
  add(content.body, 'Label', storedLabel, {
    maxlength: 500,
    placeholder: storedLabel ? null : displayName(byId, id),
  });
  if (entry.collection === 'nodes') {
    add(content.body, 'Description', sem.description, {
      multiline: true,
      maxlength: 4000,
    });
    add(content.body, 'Semantic role', sem.kind, {
      choices: Object.entries(NODE_NAMES),
    });
  }
  form.append(content.details);

  const geometry = inspectorSection(document, 'Geometry', {
    iconName: 'geometry',
    open: true,
  });
  if (geom.bounds) {
    const grid = element(document, 'div', { className: 'de-field-grid' });
    for (const [name, key] of [
      ['X', 'x'],
      ['Y', 'y'],
      ['Width', 'width'],
      ['Height', 'height'],
    ]) {
      const lock = ['x', 'y'].includes(key) ? place.locks.position : place.locks.size;
      add(grid, name, geom.bounds[key], {
        type: 'number',
        step: '1',
        min: ['width', 'height'].includes(key) ? 1 : -1000000,
        max: 1000000,
        disabled: !editable || lock,
      });
    }
    geometry.body.append(grid);
    if (place.locks.position || place.locks.size)
      geometry.body.append(
        element(
          document,
          'p',
          { className: 'de-muted' },
          'Geometry is locked. Use Unlock selection to change it.',
        ),
      );
  } else
    geometry.body.append(
      element(
        document,
        'p',
        { className: 'de-muted' },
        'This object is positioned by its connected endpoints.',
      ),
    );
  form.append(geometry.details);

  if (entry.collection === 'relations') {
    const connection = inspectorSection(document, 'Connection', {
      iconName: 'route',
      open: true,
    });
    // biome-ignore format: bundles keep this one-line array; wrapping would change their bytes.
    const choices: Array<[string, string]> = bundle.document.nodes.map((node) => [node.id, displayName(byId, node.id)]);
    add(connection.body, 'From', sem.from, { choices });
    add(connection.body, 'To', sem.to, { choices });
    add(connection.body, 'Direction', sem.direction, {
      choices: [
        ['forward', 'Forward'],
        ['both', 'Both directions'],
        ['none', 'No arrow'],
      ],
    });
    add(connection.body, 'Relationship', sem.kind, {
      choices: labelled('association', 'dependency', 'flow', 'message', 'transition'),
    });
    add(connection.body, 'Routing', geom.route.strategy, {
      choices: labelled('straight', 'orthogonal'),
      disabled: !editable || place.locks.route,
    });
    const endpointGrid = element(document, 'div', {
      className: 'de-field-grid',
    });
    add(endpointGrid, 'Start side', geom.route.from.side, {
      choices: labelled('top', 'right', 'bottom', 'left'),
      disabled: !editable || place.locks.route,
    });
    add(endpointGrid, 'End side', geom.route.to.side, {
      choices: labelled('top', 'right', 'bottom', 'left'),
      disabled: !editable || place.locks.route,
    });
    connection.body.append(endpointGrid);
    const bends = element(document, 'fieldset', {
      className: 'de-inspector-bends',
    });
    bends.append(element(document, 'legend', {}, 'Bend points'));
    const points = geom.route.mode === 'manual' ? geom.route.points.slice(1, -1) : [];
    points.forEach((point: Point, index: number) => {
      const row = element(document, 'div', {
        className: 'de-field-grid de-bend-row',
      });
      for (const key of ['x', 'y'] satisfies Array<keyof Point>)
        add(row, `Bend ${index + 1} ${key.toUpperCase()}`, point[key], {
          type: 'number',
          disabled: !editable || place.locks.route,
        });
      const remove = iconButton(document, `Remove bend ${index + 1}`, null, {
        icon: 'trash',
        disabled: !editable || place.locks.route,
      });
      remove.onclick = () => act('remove-bend', index);
      row.append(remove);
      bends.append(row);
    });
    bends.append(
      iconButton(document, 'Add bend', 'add-bend', {
        icon: 'plus',
        disabled: !editable || place.locks.route,
      }),
    );
    connection.body.append(bends);
    actionRow(document, connection.body, [
      ['Reset route', 'reset-route', 'route', { disabled: !editable || place.locks.route }],
    ]);
    if (geom.label) {
      const labelGrid = element(document, 'div', {
        className: 'de-field-grid',
      });
      add(labelGrid, 'Label X', geom.label.x, { type: 'number' });
      add(labelGrid, 'Label Y', geom.label.y, { type: 'number' });
      add(labelGrid, 'Label width', geom.label.width, {
        type: 'number',
        min: 1,
      });
      connection.body.append(labelGrid);
    } else
      connection.body.append(
        iconButton(document, 'Position label', 'position-label', {
          icon: 'geometry',
          disabled: !editable,
        }),
      );
    form.append(connection.details);
  }

  const appearance = inspectorSection(document, 'Appearance', {
    iconName: 'appearance',
  });
  add(appearance.body, 'Fill', look.appearance.fill, {
    choices: labelled('surface', 'accent', 'success', 'warning', 'danger', 'transparent'),
  });
  add(appearance.body, 'Stroke', look.appearance.stroke, {
    choices: labelled('default', 'accent', 'muted', 'danger', 'none'),
  });
  add(appearance.body, 'Line style', look.appearance.strokeStyle, {
    choices: labelled('solid', 'dashed', 'dotted'),
  });
  add(appearance.body, 'Font size', look.appearance.fontSize, {
    type: 'number',
    min: 12,
    max: 48,
  });
  form.append(appearance.details);

  if (entry.collection !== 'relations' || ['groups', 'lanes'].includes(entry.collection)) {
    const structure = inspectorSection(document, 'Structure', {
      iconName: 'structure',
    });
    if (entry.collection !== 'relations')
      structure.body.append(...parentOperation(document, { bundle, byId, ids, editable, act }));
    if (['groups', 'lanes'].includes(entry.collection)) appendMembers(structure.body);
    form.append(structure.details);
  }

  const constraints = inspectorSection(document, 'Constraints', {
    iconName: 'constraints',
  });
  for (const [name, key] of [
    ['Lock position', 'position'],
    ['Lock size', 'size'],
    ['Lock route', 'route'],
  ]) {
    if (key === 'route' && entry.collection !== 'relations') continue;
    if (key !== 'route' && !geom.bounds) continue;
    add(constraints.body, name, look.locks[key], { type: 'checkbox' });
  }
  actionRow(document, constraints.body, [
    ['Unlock selection', 'unlock', 'unlock', { disabled: !editable }],
  ]);
  form.append(constraints.details);

  const objectActions = inspectorSection(document, 'Object actions', {
    iconName: 'advanced',
  });
  actionRow(document, objectActions.body, [
    ['Copy', 'copy', 'copy', { disabled: !editable }],
    ['Duplicate', 'duplicate', 'duplicate', { disabled: !editable }],
  ]);
  form.append(objectActions.details);

  const advanced = inspectorSection(document, 'Advanced', {
    iconName: 'advanced',
  });
  const metadata = element(document, 'dl', { className: 'de-inspector-meta' });
  metadata.append(
    element(document, 'dt', {}, 'Object type'),
    element(document, 'dd', {}, COLLECTION_NAMES[entry.collection] ?? entry.collection),
    element(document, 'dt', {}, 'Grammar'),
    element(document, 'dd', {}, bundle.document.grammar.id),
  );
  advanced.body.append(referenceRow(document, id, act), metadata);
  form.append(advanced.details);

  form.append(
    button(document, 'Delete…', 'delete', {
      className: 'de-inspector-delete',
      disabled: !editable,
    }),
  );

  const footer = element(document, 'footer', {
    className: 'de-inspector-footer',
  });
  const revertButton = button(document, 'Revert', null, {
    disabled: true,
  });
  const applyButton = element(
    document,
    'button',
    {
      type: 'submit',
      className: 'de-primary',
      disabled: true,
    },
    'Apply changes',
  );
  footer.append(revertButton, applyButton);
  form.append(footer);
  root.append(form);

  let dirty = false;
  let initialValues = captureValues();
  const setDirty = (value: boolean) => {
    if (dirty === value) return;
    dirty = value;
    applyButton.disabled = !editable || !dirty;
    revertButton.disabled = !editable || !dirty;
    form.dataset.dirty = String(dirty);
    onDirtyChange?.(dirty);
  };
  const refreshDirty = () =>
    setDirty([...trackedInputs].some((input) => inputValue(input) !== initialValues.get(input)));
  const apply = () => {
    if (!editable || !dirty) return { ok: true, skipped: true };
    const result = submitTransaction(buildPropertyTransaction());
    if (result?.ok) {
      initialValues = captureValues();
      setDirty(false);
    }
    return result;
  };
  const revert = () => {
    for (const [input, value] of initialValues) {
      // inputValue captured a checkbox's checked state.
      if (input.type === 'checkbox') input.checked = value as boolean;
      else input.value = value;
    }
    setDirty(false);
    return { ok: true };
  };
  const focus = () => [...trackedInputs].find((input) => !input.disabled)?.focus();
  // Set.has accepts only the element type; any other target is simply not tracked.
  form.addEventListener('input', (event) => {
    if (trackedInputs.has(event.target as FieldControl)) refreshDirty();
  });
  form.addEventListener('change', (event) => {
    if (trackedInputs.has(event.target as FieldControl)) refreshDirty();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    apply();
  });
  revertButton.onclick = revert;
  form.dataset.dirty = 'false';
  onDirtyChange?.(false);

  return {
    get dirty() {
      return dirty;
    },
    apply,
    revert,
    focus,
  };

  function inputValue(input: FieldControl) {
    return input.type === 'checkbox' ? input.checked : input.value;
  }
  function captureValues() {
    // biome-ignore format: bundles keep this one-line call; wrapping would change their bytes.
    return new Map<FieldControl, string | boolean | undefined>([...trackedInputs].map((input) => [input, inputValue(input)]));
  }

  function buildPropertyTransaction() {
    const nextSem = clone(sem),
      nextGeom = clone(geom),
      nextLook = clone(look);
    const value = (name: string) => inputs.get(name)?.value;
    const number = (name: string) => Number(value(name));
    if (entry.collection === 'annotations') nextSem.text = value('Label');
    else nextSem.label = value('Label') || (entry.collection === 'relations' ? null : '');
    if (entry.collection === 'nodes') {
      nextSem.description = value('Description') || null;
      nextSem.kind = value('Semantic role');
      nextLook.appearance.shape = (
        {
          process: 'rectangle',
          start: 'ellipse',
          end: 'ellipse',
          decision: 'diamond',
          'data-store': 'cylinder',
          component: 'rounded-rectangle',
        } as Record<string, DiagramAppearance['shape']>
      )[nextSem.kind];
    }
    if (nextGeom.bounds)
      for (const [name, key] of [
        ['X', 'x'],
        ['Y', 'y'],
        ['Width', 'width'],
        ['Height', 'height'],
      ])
        nextGeom.bounds[key] = number(name);
    if (entry.collection === 'relations') {
      nextSem.from = value('From');
      nextSem.to = value('To');
      nextSem.direction = value('Direction');
      nextSem.kind = value('Relationship');
      nextGeom.route.strategy = value('Routing');
      nextGeom.route.from.side = value('Start side');
      nextGeom.route.to.side = value('End side');
      if (nextGeom.route.mode === 'manual')
        nextGeom.route.points.slice(1, -1).forEach((_: Point, index: number) => {
          const original = geom.route.points[index + 1],
            x = number(`Bend ${index + 1} X`),
            y = number(`Bend ${index + 1} Y`);
          if (x === original.x && y === original.y) return;
          if (nextGeom.route.strategy === 'orthogonal')
            nextGeom.route.points = moveOrthogonalBend(
              nextGeom.route.points,
              index + 1,
              x - nextGeom.route.points[index + 1].x,
              y - nextGeom.route.points[index + 1].y,
            );
          else nextGeom.route.points[index + 1] = { x, y };
        });
      if (nextGeom.label)
        nextGeom.label = {
          x: number('Label X'),
          y: number('Label Y'),
          width: number('Label width'),
        };
    }
    nextLook.appearance.fill = value('Fill');
    nextLook.appearance.stroke = value('Stroke');
    nextLook.appearance.strokeStyle = value('Line style');
    nextLook.appearance.fontSize = number('Font size');
    for (const [name, key] of [
      ['Lock position', 'position'],
      ['Lock size', 'size'],
      ['Lock route', 'route'],
    ])
      if (inputs.has(name)) nextLook.locks[key] = (inputs.get(name) as FieldControl).checked;
    // The form this builds from exists only when the state has a bundle.
    return propertyTransaction(bundle as DiagramAuthoringBundle, id, {
      semantic: nextSem,
      geometry: nextGeom,
      appearance: nextLook,
    });
  }

  function appendMembers(target: HTMLElement) {
    target.append(element(document, 'h3', { className: 'de-inspector-subheading' }, 'Members'));
    const members = element(document, 'ul', {
      className: 'de-inspector-member-list',
      'aria-label': 'Members',
    });
    for (const member of entry.value.members) {
      const item = element(document, 'li', {
        className: 'de-inspector-member',
      });
      item.append(
        button(document, displayName(byId, member), 'select-member', {
          'data-member': member,
        }),
      );
      members.append(item);
    }
    if (entry.value.members.length) target.append(members);
    else
      target.append(
        element(
          document,
          'p',
          { className: 'de-muted' },
          'No members. Select objects and choose this parent to add them.',
        ),
      );
    actionRow(document, target, [
      ['Arrange horizontally…', 'lane-horizontal', 'arrange', { disabled: !editable }],
      ['Arrange vertically…', 'lane-vertical', 'arrange', { disabled: !editable }],
      ['Ungroup', 'ungroup', 'ungroup', { disabled: !editable }],
    ]);
    if (entry.collection === 'lanes')
      actionRow(document, target, [
        ['Move lane up', 'lane-up', 'arrow-up', { disabled: !editable }],
        ['Move lane down', 'lane-down', 'arrow-down', { disabled: !editable }],
      ]);
    target.append(
      button(
        document,
        state.view.collapsedGroups.includes(id) ? 'Expand contents' : 'Collapse contents',
        'collapse',
        { disabled: !editable },
      ),
    );
  }
}

function renderMultiSelection({ document, root, bundle, ids, byId, editable, act }: SelectionView) {
  const selectedLabels = ids.slice(0, 8).map((id) => displayName(byId, id));
  root.append(
    inspectorHeader(document, {
      kicker: 'Multiple selection',
      title: `${ids.length} objects selected`,
      description: selectedLabels.join(', '),
    }),
  );
  // Short visible labels fit equal columns in the rail; the full phrase stays the accessible name,
  // which also lets the inspector restore focus to the button after it re-renders.
  const group = (title: string, items: Array<[visible: string, action: string, name?: string]>) => {
    const section = inspectorGroup(document, title);
    actionRow(
      document,
      section,
      items.map(([visible, action, name = visible]) => [
        visible,
        action,
        null,
        { 'aria-label': name, disabled: !editable },
      ]),
    );
    root.append(section);
    return section;
  };
  const arranged = arrangedPlacements(bundle, ids).length;
  // Each group's buttons share one precondition, so one reason line serves the row.
  const requireArranged = (section: HTMLElement, minimum: number, text: string) => {
    const reason = disabledReason(document);
    for (const control of section.querySelectorAll('button'))
      explain(control, reason, arranged < minimum ? text : '', editable);
    section.append(reason);
  };
  requireArranged(
    group('Align', [
      ['Left', 'align-left', 'Align left'],
      ['Center', 'align-center', 'Align centers'],
      ['Top', 'align-top', 'Align top'],
    ]),
    2,
    'Select at least two shapes or containers to align.',
  );
  requireArranged(
    group('Distribute', [
      ['Horizontal', 'distribute-horizontal', 'Distribute horizontally'],
      ['Vertical', 'distribute-vertical', 'Distribute vertically'],
    ]),
    3,
    'Select at least three shapes or containers to distribute.',
  );
  const structure = group('Structure', [
    ['Group', 'group', 'Group selection'],
    ['Ungroup', 'ungroup', 'Ungroup selection'],
    ['Connect', 'connect', 'Connect selection'],
  ]);
  const ungroupReason = disabledReason(document);
  // The Structure group above rendered the ungroup button.
  explain(
    structure.querySelector('[data-action="ungroup"]') as HTMLButtonElement,
    ungroupReason,
    ids.every((id) => ['groups', 'lanes'].includes(byId.get(id).collection))
      ? ''
      : 'Only groups and lanes can be ungrouped.',
    editable,
  );
  structure.append(
    ungroupReason,
    ...parentOperation(document, { bundle, byId, ids, editable, act }),
  );
  group('Clipboard', [
    ['Copy', 'copy'],
    ['Paste', 'paste'],
    ['Duplicate', 'duplicate'],
  ]);
  group('Lock', [
    ['Lock', 'lock', 'Lock selection'],
    ['Unlock', 'unlock', 'Unlock selection'],
  ]);
  root.append(
    button(document, `Delete ${quantity(ids.length, 'object')}…`, 'delete', {
      className: 'de-inspector-delete',
      disabled: !editable,
    }),
  );
}

/** Parent select and Move button; Move is disabled, with its reason, while it cannot apply. */
function parentOperation(document: Document, { bundle, byId, ids, editable, act }: Inspection) {
  const parents = parentIndex(bundle.document);
  const choices: Array<[string, string]> = [
    ['', 'Diagram root'],
    ...[...bundle.document.groups, ...bundle.document.lanes]
      .filter((item) => !ids.includes(item.id))
      .map((item): [string, string] => [item.id, displayName(byId, item.id)]),
  ];
  const operation = element(document, 'div', {
    className: 'de-inspector-operation',
  });
  const parent = field(document, 'Parent', parents.get(ids[0]) ?? '', {
    choices,
    disabled: !editable,
  });
  const move = iconButton(document, 'Move to parent', null, { icon: 'parent' });
  const reason = disabledReason(document);
  const refresh = () =>
    explain(
      move,
      reason,
      ids.some((id) => byId.get(id).collection === 'relations')
        ? 'Connectors cannot become container members.'
        : ids.every((id) => (parents.get(id) ?? '') === parent.input.value)
          ? 'Choose a different parent to move.'
          : '',
      editable,
    );
  parent.input.addEventListener('change', refresh);
  refresh();
  move.onclick = () => act('reparent', parent.input.value || null);
  operation.append(parent.label, move);
  return [operation, reason];
}
