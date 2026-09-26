// @ts-check
import { getDiagramAuthoringCapability } from '@openplanr/protocol/diagram-authoring-contracts';
import { compileDiagramCommand } from '../diagram/authoring/index.mjs';
import {
  appearanceFields,
  clone,
  elementIndex,
  geometryFields,
  snapshot,
} from '../diagram/authoring/model.mjs';
import {
  authoredDiagramPalette,
  renderAuthoredSceneElement,
} from '../diagram/authoring/renderer.mjs';
import { resolveDiagramSceneElement } from '../diagram/authoring/scene.mjs';
import { copyDiagramSelection } from '../diagram/editor/clipboard.mjs';
import { mountDiagramConflicts } from './diagram-conflicts.mjs';
import {
  addOrthogonalDetour,
  arrangementCommand,
  connector,
  createObject,
  duplicateSelection,
  freshId,
  labelOf,
  laneArrangementCommand,
  moveOrthogonalBend,
  placement,
  processTemplate,
  transaction,
} from './diagram-editor-actions.mjs';
import {
  button,
  downloadJson,
  element,
  field,
  hasIcon,
  icon,
  iconButton,
} from './diagram-editor-dom.mjs';
import { renderDiagramProperties } from './diagram-editor-properties.mjs';
import { mountDiagramSourcePanel } from './diagram-source-panel.mjs';

/** @typedef {import('./diagram-editor.d.mts').DiagramEditorIconName} DiagramEditorIconName */
/** @typedef {import('../diagram/editor/index.d.mts').DiagramEditorState} DiagramEditorState */
/** @typedef {import('../diagram/authoring/index.d.mts').DiagramCommand} DiagramCommand */
/** @typedef {import('@openplanr/protocol/diagram-authoring-contracts').DiagramAuthoringBundle} DiagramAuthoringBundle */

const SVG = 'http://www.w3.org/2000/svg';
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
const PROPERTY_DRAFT_MESSAGE = 'Apply or revert property changes before selecting another object.';
const EMPTY_CALLBACK = () => {};
const errText = (result) =>
  result?.diagnostics
    ?.map((item) => item.detail)
    .filter(Boolean)
    .join(' ') ||
  result?.message ||
  'The change could not be applied.';
const boundsOf = (bundle) => {
  const rects = bundle.presentation.elements.map((item) => item.bounds).filter(Boolean);
  if (!rects.length) return { x: -200, y: -120, width: 400, height: 240 };
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const rect of rects) {
    x = Math.min(x, rect.x);
    y = Math.min(y, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
};
const safeAction = (fn, report) => {
  try {
    return fn();
  } catch (error) {
    report(error instanceof Error ? error.message : 'The edit is invalid.');
    return null;
  }
};
const intersect = (a, b) =>
  a &&
  b &&
  a.x <= b.x + b.width &&
  a.x + a.width >= b.x &&
  a.y <= b.y + b.height &&
  a.y + a.height >= b.y;
const focusable = (element) =>
  element?.closest('input,textarea,select,button,[contenteditable="true"],[role="dialog"]');
const DEFAULT_LABELS = Object.freeze({
  subtitle: 'Local diagram studio',
  emptyHint:
    'Add a shape or start with a small process flow. Everything stays local until you save.',
  reviewUnavailable:
    'Review comments are available after this diagram is published to a review workspace. Local editing does not publish it.',
  readOnly: 'Read only',
});
/** @param {Document} document */
const windowOf = (document) => {
  const view = document.defaultView;
  if (!view) throw new TypeError('Mount needs a root inside a live document.');
  return view;
};
/** @param {DiagramEditorState} state */
const bundleOf = (state) => {
  if (!state.bundle) throw new TypeError('The editor has no readable diagram.');
  return state.bundle;
};
/**
 * @param {DiagramAuthoringBundle} bundle
 * @param {string} id
 */
const placementOf = (bundle, id) => {
  const placement = bundle.presentation.elements.find((item) => item.elementId === id);
  if (!placement) throw new TypeError(`Element ${id} has no placement.`);
  return placement;
};
const HOST_ID = /^[a-z][a-z0-9-]{0,39}$/u;
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
const RESERVED_PANELS = new Set(['properties', 'review']);
function hostLabels(labels = {}) {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels))
    throw new TypeError('Host labels must be an object.');
  for (const [key, value] of Object.entries(labels)) {
    if (!Object.hasOwn(DEFAULT_LABELS, key)) throw new TypeError(`Unknown host label: ${key}.`);
    if (typeof value !== 'string' || !value.trim())
      throw new TypeError(`Host label ${key} must be non-empty text.`);
  }
  return { ...DEFAULT_LABELS, ...labels };
}
function hostEntries(list, kind, callback) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new TypeError(`Host ${kind}s must be an array.`);
  const seen = new Set();
  return list.map((entry) => {
    const id = entry?.id;
    if (!HOST_ID.test(id ?? '') || seen.has(id) || (kind === 'panel' && RESERVED_PANELS.has(id)))
      throw new TypeError(
        `Each host ${kind} needs a unique lowercase id; received ${JSON.stringify(id)}.`,
      );
    if (
      typeof entry.label !== 'string' ||
      !entry.label.trim() ||
      typeof entry[callback] !== 'function'
    )
      throw new TypeError(`Host ${kind} ${id} needs a label and ${callback}().`);
    if (entry.icon !== undefined && !hasIcon(entry.icon))
      throw new TypeError(`Host ${kind} ${id} uses an unknown icon: ${entry.icon}.`);
    for (const hook of ['disabled', 'hidden'])
      if (entry[hook] !== undefined && typeof entry[hook] !== 'function')
        throw new TypeError(`Host ${kind} ${id} ${hook} must be a function.`);
    seen.add(id);
    return { ...entry };
  });
}
function colorSchemeOf(value) {
  if (value === undefined || value === null) return null;
  if (value !== 'light' && value !== 'dark')
    throw new TypeError(
      `Color scheme must be light, dark or null; received ${JSON.stringify(value)}.`,
    );
  return value;
}

/**
 * Browser-safe, framework-neutral UI. The supplied session remains owned by its host.
 * @type {typeof import('./diagram-editor.d.mts').mountDiagramEditor}
 */
export function mountDiagramEditor({ root, session, host = {} }) {
  if (!root || !session || typeof session.getState !== 'function')
    throw new TypeError('Mount needs one root and one editor session.');
  if (host.review !== undefined && typeof host.review !== 'boolean')
    throw new TypeError('Host review must be true or false.');
  if (host.saveLabel !== undefined && typeof host.saveLabel !== 'function')
    throw new TypeError('Host saveLabel must be a function.');
  const labels = hostLabels(host.labels),
    hostActions = hostEntries(host.actions, 'action', 'onSelect'),
    hostPanels = hostEntries(host.panels, 'panel', 'mount');
  const reviewEnabled = host.review !== false;
  let hostScheme = colorSchemeOf(host.colorScheme);
  const doc = root.ownerDocument,
    win = windowOf(doc);
  const colorScheme = win.matchMedia?.('(prefers-color-scheme: dark)');
  let disposed = false,
    raf = 0,
    drag = null,
    tempPan = false,
    tool = 'select',
    tab = 'outline',
    rightTab = 'properties';
  let leftOpen = win.innerWidth > 1100,
    rightOpen = win.innerWidth > 1100,
    clipboard = null,
    dialog = null,
    conflictMount = null,
    sourceMount = null,
    sourceDraft = null,
    reviewCleanup = null;
  let elementNodes = new Map(),
    renderSignatures = new Map(),
    renderedDigest = '',
    lastCanvas = null,
    lastBreakpoint = null,
    mode = 'edit',
    lastAnnouncement = '',
    announcementFrame = 0,
    dialogOpener = null,
    actionTrigger = null;
  let overflowOpen = false,
    overflowOpener = null,
    drawerOpener = null,
    propertyController = null,
    propertiesDirty = false,
    propertiesStamp = '',
    propertiesSelection = '',
    propertyRefreshQueued = false,
    reviewMounted = false,
    modalBackgroundInert = false;
  const shell = element(doc, 'div', { className: 'planr-diagram-editor' });
  shell.innerHTML =
    '<header class="de-bar" role="toolbar" aria-label="Diagram commands"><div class="de-bar-start"><div class="de-command-group" role="group" aria-label="Document navigation"></div><div class="de-brand"><span class="de-mark" aria-hidden="true"></span><div class="de-identity"><strong class="de-title"></strong><small class="de-subtitle"></small></div></div></div><div class="de-bar-center"><div class="de-command-group" role="group" aria-label="History and arrangement"></div></div><div class="de-bar-end"><span class="de-save-state" role="status" aria-live="polite"></span><div class="de-command-group" role="group" aria-label="Save and inspect"></div><div class="de-more-wrap"></div></div></header><div class="de-work"><button class="de-drawer-backdrop" type="button" data-action="close-drawers" aria-label="Close open panel" tabindex="-1" hidden></button><aside class="de-left" id="diagram-outline-panel" aria-label="Diagram outline and shapes"><div class="de-panel-header"><strong class="de-panel-title">Objects</strong><div class="de-rail-tabs de-panel-tabs" role="tablist" aria-label="Left panel"></div><button type="button" data-action="close-outline" class="de-panel-close" aria-label="Close outline">×</button></div><div class="de-left-content"><div class="de-outline-pane de-tabpanel" id="diagram-outline-pane" role="tabpanel" aria-labelledby="diagram-outline-tab"></div><div class="de-shapes-pane de-tabpanel" id="diagram-shapes-pane" role="tabpanel" aria-labelledby="diagram-shapes-tab" hidden></div></div></aside><section class="de-stage"><p id="diagram-canvas-instructions" class="de-canvas-instructions">Use Select to choose and move objects, Pan to move around the canvas, and the arrow keys to move a selected object.</p><div class="de-canvas" aria-label="Diagram canvas" aria-describedby="diagram-canvas-instructions" role="application" tabindex="0"><svg data-editor-svg aria-label="Diagram drawing" role="img"><g data-world></g><g data-overlays></g></svg><div class="de-empty"></div><div class="de-canvas-tools" role="toolbar" aria-label="Canvas tools"></div><div class="de-mobile-message">Review on mobile. Open on desktop to edit.</div></div><div class="de-stage-footer"></div></section><aside class="de-right" id="diagram-inspector-panel" aria-label="Diagram properties and review"><div class="de-panel-header"><strong class="de-panel-title">Inspector</strong><div class="de-right-tabs de-panel-tabs" role="tablist" aria-label="Right panel"></div><button type="button" data-action="close-properties" class="de-panel-close" aria-label="Close properties">×</button></div><div class="de-right-content"><div class="de-properties-pane de-tabpanel" id="diagram-properties-pane" role="tabpanel" aria-labelledby="diagram-properties-tab"></div><div class="de-review-pane de-tabpanel" id="diagram-review-pane" role="tabpanel" aria-labelledby="diagram-review-tab" hidden></div></div></aside></div><div class="de-alert" role="alert" hidden></div><div class="de-announcer" aria-live="polite" aria-atomic="true"></div><div class="de-dialog-layer"></div>';
  root.replaceChildren(shell);
  const $ = (selector) => shell.querySelector(selector);
  const bar = $('.de-bar'),
    barStart = $('.de-bar-start .de-command-group'),
    barCenter = $('.de-bar-center .de-command-group'),
    barEnd = $('.de-bar-end .de-command-group');
  const saveState = $('.de-save-state'),
    leftTabs = $('.de-rail-tabs');
  const outlinePane = $('.de-outline-pane'),
    shapesPane = $('.de-shapes-pane'),
    stageRegion = $('.de-stage');
  const rightTabs = $('.de-right-tabs'),
    propertiesPane = $('.de-properties-pane'),
    reviewPane = $('.de-review-pane'),
    stage = $('.de-canvas'),
    svg = $('[data-editor-svg]');
  const world = $('[data-world]'),
    overlays = $('[data-overlays]'),
    empty = $('.de-empty'),
    footer = $('.de-stage-footer');
  const alert = $('.de-alert'),
    announcer = $('.de-announcer'),
    dialogLayer = $('.de-dialog-layer'),
    drawerBackdrop = $('.de-drawer-backdrop');
  $('.de-subtitle').textContent = labels.subtitle;
  if (host.brand === false) $('.de-mark').remove();
  else $('.de-mark').append(icon(doc, 'mark', { size: 18 }));
  const applyColorScheme = () => {
    if (hostScheme) shell.dataset.colorScheme = hostScheme;
    else delete shell.dataset.colorScheme;
  };
  applyColorScheme();
  const hostPanes = new Map(
    hostPanels.map((panel) => {
      const pane = element(doc, 'div', {
        className: 'de-host-pane de-tabpanel',
        id: 'diagram-' + panel.id + '-pane',
        role: 'tabpanel',
        'aria-labelledby': 'diagram-' + panel.id + '-tab',
        hidden: true,
      });
      $('.de-right-content').append(pane);
      return [panel.id, pane];
    }),
  );
  const hostPanelCleanups = new Map();
  /**
   * @param {HTMLElement} container
   * @param {string} label
   * @param {string} visible
   * @param {string} action
   * @param {{ title?: string; icon?: DiagramEditorIconName; className?: string }} [options]
   */
  const commandButton = (
    container,
    label,
    visible,
    action,
    { title = label, icon, className = '' } = {},
  ) => {
    const node = iconButton(doc, label, action, {
      title,
      icon,
      iconOnly: !visible,
      labelClassName: 'de-button-label',
      className: ['de-icon-button', className].filter(Boolean).join(' '),
    });
    if (visible) node.querySelector('.de-button-label').textContent = visible;
    container.append(node);
    return node;
  };
  commandButton(barStart, 'Outline', 'Outline', 'outline', {
    title: 'Show or hide outline',
    icon: 'panel',
  });
  commandButton(barCenter, 'Undo', '', 'undo', { title: 'Undo · Ctrl or Command Z', icon: 'undo' });
  commandButton(barCenter, 'Redo', '', 'redo', {
    title: 'Redo · Ctrl or Command Shift Z',
    icon: 'redo',
  });
  commandButton(barCenter, 'Layout', 'Arrange', 'layout', { icon: 'arrange' });
  commandButton(barEnd, 'Save diagram', 'Save', 'save', {
    title: 'Save diagram · Ctrl or Command S',
    icon: 'save',
    className: 'de-primary',
  });
  for (const entry of hostActions) {
    const control = commandButton(barEnd, entry.label, entry.label, 'host-action', {
      icon: entry.icon,
      className: entry.primary ? 'de-host-action de-primary' : 'de-host-action',
    });
    control.dataset.hostAction = entry.id;
  }
  commandButton(barEnd, 'Properties', 'Inspector', 'properties', {
    title: 'Show or hide properties',
    icon: 'properties',
  });
  const moreWrap = $('.de-more-wrap');
  const moreButton = commandButton(moreWrap, 'More', '', 'more', { icon: 'more' });
  moreButton.setAttribute('aria-haspopup', 'menu');
  moreButton.setAttribute('aria-expanded', 'false');
  moreButton.setAttribute('aria-controls', 'diagram-more-menu');
  const moreMenu = element(doc, 'div', {
    id: 'diagram-more-menu',
    className: 'de-more-menu',
    role: 'menu',
    'aria-label': 'Diagram options',
    hidden: true,
  });
  for (const [name, action] of [
    ['Mermaid copies', 'source-panel'],
    ['Show source', 'show-source'],
    ['Show revision', 'show-revision'],
    ['Export JSON', 'export-json'],
  ])
    moreMenu.append(
      button(doc, name, action, { role: 'menuitem', className: 'de-menu-item', tabindex: '-1' }),
    );
  moreWrap.append(moreMenu);
  const canvasTools = $('.de-canvas-tools');
  const modes = element(doc, 'div', {
    className: 'de-canvas-tool-group',
    role: 'group',
    'aria-label': 'Interaction mode',
  });
  const canvasButton = (container, label, action, options = {}) => {
    const node = options.icon
      ? iconButton(doc, label, action, { ...options, labelClassName: 'de-control-label' })
      : button(doc, label, action, options);
    container.append(node);
    return node;
  };
  canvasButton(modes, 'Select', 'select-tool', { icon: 'select', 'aria-pressed': 'true' });
  canvasButton(modes, 'Pan', 'pan-tool', { icon: 'pan', 'aria-pressed': 'false' });
  const snapping = element(doc, 'div', {
    className: 'de-canvas-tool-group',
    role: 'group',
    'aria-label': 'Snapping',
  });
  canvasButton(snapping, 'Snap', 'snap', { icon: 'snap', 'aria-pressed': 'false' });
  const zoomTools = element(doc, 'div', {
    className: 'de-canvas-tool-group',
    role: 'group',
    'aria-label': 'Zoom',
  });
  canvasButton(zoomTools, '−', 'zoom-out', { 'aria-label': 'Zoom out' });
  const zoomValue = element(
    doc,
    'output',
    { className: 'de-zoom-value', 'aria-label': 'Zoom level' },
    '100%',
  );
  zoomTools.append(zoomValue);
  canvasButton(zoomTools, '+', 'zoom-in', { 'aria-label': 'Zoom in' });
  canvasButton(zoomTools, 'Fit', 'fit', { icon: 'fit' });
  canvasTools.append(modes, snapping, zoomTools);
  const notice = (message) => {
    win.cancelAnimationFrame(announcementFrame);
    if (message === lastAnnouncement) {
      announcer.textContent = '';
      announcementFrame = win.requestAnimationFrame(() => {
        if (!disposed) announcer.textContent = message;
      });
    } else announcer.textContent = message;
    lastAnnouncement = message;
  };
  const report = (message) => {
    alert.hidden = !message;
    alert.textContent = message || '';
    if (message) notice(message);
  };
  const editable = (state) =>
    mode === 'edit' &&
    win.innerWidth > 700 &&
    state.capabilities.read &&
    state.capabilities.write &&
    state.saveState !== 'access-changed' &&
    !!getDiagramAuthoringCapability(state.bundle?.document.grammar.id);
  const readOnly = (state) => state.capabilities.read && !state.capabilities.write;
  const current = () => session.getState();
  const displayed = (state) => state.gesture?.bundle ?? state.bundle;
  const prefersDark = () => (hostScheme ? hostScheme === 'dark' : !!colorScheme?.matches);
  const editorTheme = (bundle) =>
    prefersDark()
      ? bundle.presentation.theme.themeId === 'slate'
        ? 'slate'
        : 'midnight'
      : 'paper';
  const controllerIsDirty = () => {
    if (!propertyController) return propertiesDirty;
    const value =
      typeof propertyController.dirty === 'function'
        ? propertyController.dirty()
        : propertyController.dirty;
    return value === undefined ? propertiesDirty : !!value;
  };
  const updateCommandState = (state = current(), dirty = controllerIsDirty()) => {
    propertiesDirty = !!dirty;
    shell.dataset.propertyDirty = String(propertiesDirty);
    const status = state.saveState;
    const saveControl = bar.querySelector('[data-action="save"]');
    if (saveControl)
      saveControl.disabled =
        !editable(state) ||
        status === 'saving' ||
        (!propertiesDirty &&
          status === 'saved' &&
          state.pendingCount === 0 &&
          !state.needsInitialization);
  };
  function synchronizePropertiesAfterApply() {
    if (propertyRefreshQueued) return;
    propertyRefreshQueued = true;
    win.queueMicrotask(() => {
      propertyRefreshQueued = false;
      if (disposed || controllerIsDirty()) return;
      renderRight(current());
    });
  }
  const handlePropertyDirty = (dirty) => {
    const wasDirty = propertiesDirty;
    updateCommandState(current(), dirty);
    if (wasDirty && !dirty) {
      if (alert.textContent === PROPERTY_DRAFT_MESSAGE) report('');
      synchronizePropertiesAfterApply();
    }
  };
  const guardPropertyDraft = () => {
    if (!controllerIsDirty()) return true;
    setRightTab('properties');
    setRail('right', true, { restoreFocus: false });
    report(PROPERTY_DRAFT_MESSAGE);
    propertyController?.focus?.();
    return false;
  };
  const select = (ids, { force = false } = {}) => {
    const next = [...new Set(ids)],
      previous = current().view.selection;
    const changed =
      next.length !== previous.length || next.some((id, index) => id !== previous[index]);
    if (changed && !force && !guardPropertyDraft()) return { ok: false, status: 'property-draft' };
    const result = session.setView({ selection: next });
    if (!result.ok) report(errText(result));
    else {
      report('');
      notice(
        next.length
          ? next.length + ' object' + (next.length === 1 ? '' : 's') + ' selected.'
          : 'Selection cleared.',
      );
    }
    return result;
  };
  const submit = (command, selectIds) => {
    if (controllerIsDirty()) {
      guardPropertyDraft();
      return { ok: false, status: 'property-draft' };
    }
    const result = session.submit(command);
    if (!result.ok) {
      report(errText(result));
      return result;
    }
    report('');
    if (selectIds?.length) select(selectIds);
    return result;
  };
  const submitTransaction = (value, { allowDirty = false } = {}) => {
    if (!allowDirty && controllerIsDirty()) {
      guardPropertyDraft();
      return { ok: false, status: 'property-draft' };
    }
    const result = session.submitTransaction(value);
    if (!result.ok) report(errText(result));
    else report('');
    return result;
  };
  const fromClient = (event) => {
    const rect = svg.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const worldPoint = (point, camera = current().view.camera) => ({
    x: (point.x - camera.x) / camera.scale,
    y: (point.y - camera.y) / camera.scale,
  });
  const cameraPatch = (camera) => session.setView({ camera });
  function fit() {
    const state = current();
    if (!state.bundle) return;
    const rect = stage.getBoundingClientRect(),
      bounds = boundsOf(state.bundle),
      pad = 72;
    const scale = Math.min(
      1.6,
      Math.max(
        0.04,
        Math.min((rect.width - pad * 2) / bounds.width, (rect.height - pad * 2) / bounds.height),
      ),
    );
    cameraPatch({
      x: (rect.width - bounds.width * scale) / 2 - bounds.x * scale,
      y: (rect.height - bounds.height * scale) / 2 - bounds.y * scale,
      scale,
      fit: 'all',
    });
  }
  function zoom(factor, around) {
    const camera = current().view.camera,
      point = around ?? { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
    const scale = Math.min(4, Math.max(0.04, camera.scale * factor)),
      anchor = worldPoint(point, camera);
    cameraPatch({ x: point.x - anchor.x * scale, y: point.y - anchor.y * scale, scale, fit: null });
  }
  function setOverflow(open, { focus = false, restoreFocus = true } = {}) {
    if (overflowOpen === open) return;
    overflowOpen = open;
    moreMenu.hidden = !open;
    moreButton.setAttribute('aria-expanded', String(open));
    if (open) {
      overflowOpener = doc.activeElement;
      if (focus) moreMenu.querySelector('[role="menuitem"]')?.focus();
    } else {
      const target = restoreFocus && overflowOpener?.isConnected ? overflowOpener : null;
      overflowOpener = null;
      target?.focus({ preventScroll: true });
    }
  }
  function toggleInert(node, inert) {
    if (inert) {
      node.setAttribute('inert', '');
      node.setAttribute('aria-hidden', 'true');
    } else {
      node.removeAttribute('inert');
      node.removeAttribute('aria-hidden');
    }
  }
  function synchronizeBackgroundInteractivity() {
    const drawer = win.innerWidth <= 1100;
    const drawerOpen = drawer && (leftOpen || rightOpen);
    toggleInert($('.de-work'), modalBackgroundInert);
    toggleInert(bar, modalBackgroundInert || drawerOpen);
    toggleInert(stageRegion, modalBackgroundInert || drawerOpen);
  }
  function setBackgroundInert(inert) {
    modalBackgroundInert = inert;
    synchronizeBackgroundInteractivity();
  }
  /** @param {{ focusPanel?: boolean; focusTarget?: HTMLElement | null }} [options] */
  function syncPanelState({ focusPanel = false, focusTarget = null } = {}) {
    const drawer = win.innerWidth <= 1100;
    const left = $('.de-left'),
      right = $('.de-right');
    left.querySelector('[data-action="close-outline"]').hidden = !drawer;
    right.querySelector('[data-action="close-properties"]').hidden = !drawer;
    shell.dataset.leftOpen = String(leftOpen);
    shell.dataset.rightOpen = String(rightOpen);
    // Open the destination before moving focus. A rail is made inert only after
    // focus has left it, avoiding a transient focused descendant of an inert tree.
    for (const [node, open] of [
      [left, leftOpen],
      [right, rightOpen],
    ]) {
      if (open) {
        node.setAttribute('aria-hidden', 'false');
        node.removeAttribute('inert');
      }
    }
    const outlineControl = bar.querySelector('[data-action="outline"]'),
      propertiesControl = bar.querySelector('[data-action="properties"]');
    outlineControl?.setAttribute('aria-expanded', String(leftOpen));
    outlineControl?.setAttribute('aria-controls', 'diagram-outline-panel');
    propertiesControl?.setAttribute('aria-expanded', String(rightOpen));
    propertiesControl?.setAttribute('aria-controls', 'diagram-inspector-panel');
    drawerBackdrop.hidden = !drawer || (!leftOpen && !rightOpen);
    drawerBackdrop.setAttribute('aria-hidden', String(drawerBackdrop.hidden));
    if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    else if (focusPanel) {
      const target = leftOpen
        ? leftTabs.querySelector('[role="tab"][aria-selected="true"]')
        : rightOpen
          ? rightTabs.querySelector('[role="tab"][aria-selected="true"]')
          : null;
      target?.focus({ preventScroll: true });
    }
    for (const [node, open] of [
      [left, leftOpen],
      [right, rightOpen],
    ]) {
      if (!open) {
        node.setAttribute('aria-hidden', 'true');
        node.setAttribute('inert', '');
      }
    }
    synchronizeBackgroundInteractivity();
  }
  function setRail(side, open, { focusPanel = false, restoreFocus = true } = {}) {
    const drawer = win.innerWidth <= 1100;
    const control = bar.querySelector(
      '[data-action="' + (side === 'left' ? 'outline' : 'properties') + '"]',
    );
    if (open && drawer) {
      if (side === 'left') rightOpen = false;
      else leftOpen = false;
      drawerOpener = control;
    }
    if (side === 'left') leftOpen = open;
    else rightOpen = open;
    const focusTarget =
      !open && restoreFocus ? (drawerOpener?.isConnected ? drawerOpener : control) : null;
    if (!leftOpen && !rightOpen) synchronizeBackgroundInteractivity();
    syncPanelState({ focusPanel: open && (focusPanel || drawer), focusTarget });
    if (!leftOpen && !rightOpen) drawerOpener = null;
  }
  function closeDrawers({ restoreFocus = true } = {}) {
    if (win.innerWidth > 1100) return;
    const focusTarget = restoreFocus && drawerOpener?.isConnected ? drawerOpener : null;
    leftOpen = false;
    rightOpen = false;
    synchronizeBackgroundInteractivity();
    syncPanelState({ focusTarget });
    drawerOpener = null;
  }
  function rightPanes() {
    /** @type {Array<[string, HTMLElement]>} */
    const panes = [['properties', propertiesPane]];
    if (reviewEnabled) panes.push(['review', reviewPane]);
    return new Map([...panes, ...hostPanes]);
  }
  function setRightTab(next, { focus = false } = {}) {
    const panes = rightPanes(),
      shown = [...rightTabs.querySelectorAll('[role="tab"]')].map((node) => node.dataset.tab);
    if (!panes.has(next) || (shown.length && !shown.includes(next))) next = 'properties';
    rightTab = next;
    for (const [id, pane] of panes) pane.hidden = id !== next;
    if (!reviewEnabled) reviewPane.hidden = true;
    for (const tabNode of rightTabs.querySelectorAll('[role="tab"]')) {
      const selected = tabNode.dataset.tab === next;
      tabNode.setAttribute('aria-selected', String(selected));
      tabNode.tabIndex = selected ? 0 : -1;
      if (selected && focus) tabNode.focus({ preventScroll: true });
    }
    if (next === 'review' && !reviewMounted) mountReview();
    if (hostPanes.has(next) && !hostPanelCleanups.has(next)) mountHostPanel(next);
  }
  function toggleGroup(id) {
    const collapsed = new Set(current().view.collapsedGroups);
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    const result = session.setView({ collapsedGroups: [...collapsed] });
    if (!result.ok) {
      report(errText(result));
      return;
    }
    focusOutlineRow(outlinePane.querySelector('[role="treeitem"][data-id="' + id + '"]'));
  }
  function focusOutlineRow(row) {
    if (!row) return;
    for (const item of outlinePane.querySelectorAll('[role="treeitem"]')) item.tabIndex = -1;
    row.tabIndex = 0;
    row.focus();
  }
  function mountHostPanel(id) {
    const panel = hostPanels.find((item) => item.id === id);
    const cleanup = panel.mount({
      root: hostPanes.get(id),
      session,
      select: (ids) => select(ids),
      close: () => setRail('right', false),
    });
    hostPanelCleanups.set(id, typeof cleanup === 'function' ? cleanup : null);
  }
  function setLeftTab(next, { focus = false } = {}) {
    tab = next;
    const outlineSelected = next === 'outline';
    outlinePane.hidden = !outlineSelected;
    shapesPane.hidden = outlineSelected;
    for (const tabNode of leftTabs.querySelectorAll('[role="tab"]')) {
      const selected = tabNode.dataset.action === (outlineSelected ? 'outline-tab' : 'shapes-tab');
      tabNode.setAttribute('aria-selected', String(selected));
      tabNode.tabIndex = selected ? 0 : -1;
      if (selected && focus) tabNode.focus({ preventScroll: true });
    }
  }
  /** @param {{ type: string; affectedIds?: string[] }} [event] */
  function draw(event = { type: 'initial', affectedIds: [] }) {
    if (disposed) return;
    const state = current(),
      bundle = displayed(state);
    if (!bundle) {
      world.replaceChildren();
      elementNodes.clear();
      renderChrome(state);
      return;
    }
    const camera = state.view.camera;
    zoomValue.textContent = Math.round(camera.scale * 100) + '%';
    world.setAttribute(
      'transform',
      'translate(' + camera.x + ' ' + camera.y + ') scale(' + camera.scale + ')',
    );
    overlays.setAttribute('transform', world.getAttribute('transform'));
    const byId = elementIndex(bundle.document),
      placements = new Map(bundle.presentation.elements.map((entry) => [entry.elementId, entry]));
    const theme = editorTheme(bundle),
      palette = authoredDiagramPalette(theme),
      emphasis = new Map(bundle.document.emphasis.map((entry) => [entry.targetId, entry.level]));
    const selection = new Set(state.view.selection);
    const forceAll =
      event.type === 'initial' ||
      !elementNodes.size ||
      renderedDigest === '' ||
      event.type === 'refresh';
    const affected = forceAll ? new Set(placements.keys()) : new Set(event.affectedIds ?? []);
    if (event.type === 'content' && !affected.size)
      for (const id of placements.keys()) affected.add(id);
    const parser = new win.DOMParser();
    for (const [id, node] of elementNodes)
      if (!placements.has(id)) {
        node.remove();
        elementNodes.delete(id);
        renderSignatures.delete(id);
      }
    for (let order = 0; order < bundle.presentation.elements.length; order++) {
      const entry = bundle.presentation.elements[order],
        id = entry.elementId;
      const source = byId.get(id);
      const signature = JSON.stringify([
        source,
        entry,
        emphasis.get(id) ?? null,
        theme,
        source?.collection === 'relations'
          ? [placements.get(source.value.from), placements.get(source.value.to)]
          : null,
      ]);
      if (
        !elementNodes.has(id) ||
        ((affected.has(id) || forceAll) && renderSignatures.get(id) !== signature)
      ) {
        const scene = resolveDiagramSceneElement(
          byId.get(id),
          entry,
          placements,
          order,
          emphasis.get(id) ?? null,
        );
        const xml = parser.parseFromString(
          '<svg xmlns="' +
            SVG +
            '">' +
            renderAuthoredSceneElement(scene, palette, bundle.diagramId) +
            '</svg>',
          'image/svg+xml',
        );
        const rendered = xml.documentElement.firstElementChild;
        if (!rendered) throw new TypeError(`Element ${id} rendered no SVG markup.`);
        const replacement = doc.importNode(rendered, true);
        replacement.setAttribute('tabindex', '-1');
        replacement.setAttribute('role', 'img');
        replacement.setAttribute('aria-label', scene.label || scene.kind);
        const old = elementNodes.get(id);
        if (old) old.replaceWith(replacement);
        else world.append(replacement);
        elementNodes.set(id, replacement);
        renderSignatures.set(id, signature);
      }
      const node = elementNodes.get(id);
      node.dataset.selected = String(selection.has(id));
      node.classList.toggle('de-selected', selection.has(id));
    }
    // Keep stable primitives; reordering moves only nodes whose source order changed.
    if (event.type === 'content' || event.type === 'refresh' || forceAll) {
      const ordered = [...bundle.presentation.elements].sort(
        (a, b) =>
          a.zIndex - b.zIndex ||
          bundle.presentation.elements.indexOf(a) - bundle.presentation.elements.indexOf(b),
      );
      for (const entry of ordered) world.append(elementNodes.get(entry.elementId));
    }
    renderedDigest = bundle.bundleDigest;
    shell.dataset.diagramTheme = theme;
    renderOverlays(state, bundle, selection);
    renderChrome(state);
  }
  function renderOverlays(state, bundle, selection) {
    overlays.replaceChildren();
    const scale = state.view.camera.scale,
      byPlacement = new Map(bundle.presentation.elements.map((item) => [item.elementId, item]));
    for (const id of selection) {
      const geometry = session.geometry(id),
        rect = geometry?.bounds ?? geometry?.labelBounds;
      if (rect) {
        const box = doc.createElementNS(SVG, 'rect');
        for (const [key, value] of Object.entries({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        }))
          box.setAttribute(key, String(value));
        box.setAttribute('class', 'de-selection-box');
        box.setAttribute('stroke-width', String(1.5 / scale));
        box.setAttribute('pointer-events', 'none');
        overlays.append(box);
        if (
          selection.size === 1 &&
          editable(state) &&
          byPlacement.get(id)?.bounds &&
          !byPlacement.get(id).locks.size
        ) {
          const handle = doc.createElementNS(SVG, 'rect');
          const size = 10 / scale;
          handle.setAttribute('x', String(rect.x + rect.width - size / 2));
          handle.setAttribute('y', String(rect.y + rect.height - size / 2));
          handle.setAttribute('width', String(size));
          handle.setAttribute('height', String(size));
          handle.setAttribute('rx', String(2 / scale));
          handle.setAttribute('class', 'de-resize-handle');
          handle.setAttribute('data-handle', 'resize');
          handle.setAttribute('data-handle-id', id);
          overlays.append(handle);
        }
      }
      if (geometry?.points?.length && editable(state))
        for (let index = 1; index < geometry.points.length - 1; index++) {
          const point = geometry.points[index],
            handle = doc.createElementNS(SVG, 'circle');
          handle.setAttribute('cx', String(point.x));
          handle.setAttribute('cy', String(point.y));
          handle.setAttribute('r', String(5 / scale));
          handle.setAttribute('class', 'de-bend-handle');
          handle.setAttribute('data-handle', 'bend');
          handle.setAttribute('data-index', String(index));
          handle.setAttribute('data-handle-id', id);
          overlays.append(handle);
        }
    }
    if (drag?.type === 'marquee') {
      const a = worldPoint(drag.start),
        b = worldPoint(drag.last),
        rect = doc.createElementNS(SVG, 'rect');
      rect.setAttribute('x', String(Math.min(a.x, b.x)));
      rect.setAttribute('y', String(Math.min(a.y, b.y)));
      rect.setAttribute('width', String(Math.abs(a.x - b.x)));
      rect.setAttribute('height', String(Math.abs(a.y - b.y)));
      rect.setAttribute('class', 'de-marquee');
      rect.setAttribute('stroke-width', String(1 / scale));
      overlays.append(rect);
    }
  }
  let controlsStamp = '';
  function hostSaveLabel(state) {
    const label = host.saveLabel?.(state) ?? null;
    if (label !== null && (typeof label !== 'string' || !label.trim()))
      throw new TypeError(
        `Host saveLabel must return non-empty text or null; received ${JSON.stringify(label)}.`,
      );
    return label;
  }
  function renderChrome(state) {
    const bundle = state.bundle;
    $('.de-title').textContent = bundle?.document.title ?? 'Diagram unavailable';
    const status = state.saveState;
    saveState.textContent = readOnly(state)
      ? labels.readOnly
      : (hostSaveLabel(state) ??
        {
          saved: 'Saved',
          saving: 'Saving…',
          unsaved: 'Unsaved',
          offline: 'Offline · Unsaved',
          conflict: 'Conflict · Unsaved',
          'access-changed': 'Access changed',
        }[status] ??
        'Unsaved');
    saveState.dataset.state = readOnly(state) ? 'read-only' : status;
    shell.dataset.editable = String(editable(state));
    shell.dataset.readOnly = String(readOnly(state));
    shell.dataset.mode = mode;
    syncPanelState();
    for (const control of canvasTools.querySelectorAll(
      '[data-action="select-tool"],[data-action="pan-tool"]',
    )) {
      const active = control.dataset.action === tool + '-tool';
      control.setAttribute('aria-pressed', String(active));
      control.dataset.active = String(active);
    }
    const snapControl = canvasTools.querySelector('[data-action="snap"]');
    snapControl?.setAttribute('aria-pressed', String(state.view.snap));
    if (snapControl) snapControl.dataset.active = String(state.view.snap);
    zoomValue.textContent = Math.round(state.view.camera.scale * 100) + '%';
    for (const [action, disabled] of Object.entries({
      undo: !state.canUndo || !editable(state),
      redo: !state.canRedo || !editable(state),
      save:
        !editable(state) ||
        status === 'saving' ||
        (!controllerIsDirty() &&
          status === 'saved' &&
          state.pendingCount === 0 &&
          !state.needsInitialization),
      layout: !editable(state),
      properties: !state.capabilities.read,
      outline: !state.capabilities.read,
    })) {
      const control = bar.querySelector('[data-action="' + action + '"]');
      if (control) control.disabled = disabled;
    }
    for (const entry of hostActions) {
      const control = bar.querySelector('[data-host-action="' + entry.id + '"]');
      control.hidden = !!entry.hidden?.(state);
      control.disabled = !!entry.disabled?.(state);
    }
    const stamp = [
      bundle?.bundleDigest,
      state.view.selection.join('|'),
      state.view.collapsedGroups.join('|'),
      state.pendingCount,
      state.saveState,
      state.recovery.mode,
      tab,
      rightTab,
      mode,
      leftOpen,
      rightOpen,
      win.innerWidth <= 700,
      hostPanels.map((panel) => (panel.hidden?.(state) ? 0 : 1)).join(''),
    ].join(':');
    if (stamp === controlsStamp) return;
    controlsStamp = stamp;
    renderLeft(state);
    renderRight(state);
    renderFooter(state);
    updateCommandState(state);
    const hasContent = bundle && bundle.presentation.elements.length > 0;
    empty.hidden = hasContent || !editable(state);
    if (!empty.hidden) {
      empty.replaceChildren(
        element(doc, 'h2', {}, 'Create your diagram'),
        element(doc, 'p', {}, labels.emptyHint),
      );
      empty.append(
        button(doc, 'Start blank', 'blank', { className: 'de-primary' }),
        button(doc, 'Use process template', 'template'),
      );
      const guide = element(doc, 'ol');
      for (const step of [
        'Add shapes and connectors',
        'Edit labels and layout',
        'Save the diagram',
      ])
        guide.append(element(doc, 'li', {}, step));
      empty.append(guide);
    }
  }
  function renderLeft(state) {
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
        id: 'diagram-' + name.toLowerCase() + '-tab',
        role: 'tab',
        'aria-selected': String(selected),
        'aria-controls': 'diagram-' + name.toLowerCase() + '-pane',
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
        members.forEach((child, index) =>
          itemFor(child, depth + 1, [...trail, last], index === members.length - 1, id),
        );
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
  function mountReview() {
    if (reviewMounted) return;
    reviewMounted = true;
    reviewPane.replaceChildren(
      element(doc, 'h2', { className: 'de-panel-section-title' }, 'Review'),
    );
    if (typeof host.mountReview === 'function') {
      const slot = element(doc, 'div', { className: 'de-review-slot' });
      reviewPane.append(slot);
      reviewCleanup = host.mountReview({ root: slot, session, select }) ?? null;
    } else
      reviewPane.append(element(doc, 'p', { className: 'de-muted' }, labels.reviewUnavailable));
  }
  function renderRight(state) {
    rightTabs.replaceChildren();
    const tabs = [
      ['Properties', 'properties', 'properties-tab'],
      ...hostPanels
        .filter((panel) => !panel.hidden?.(state))
        .map((panel) => [panel.label, panel.id, 'host-panel-tab']),
      ...(reviewEnabled ? [['Review', 'review', 'review-tab']] : []),
    ];
    for (const [name, id, action] of tabs) {
      const selected = rightTab === id;
      rightTabs.append(
        button(doc, name, action, {
          id: 'diagram-' + id + '-tab',
          role: 'tab',
          'aria-controls': 'diagram-' + id + '-pane',
          'aria-selected': String(selected),
          tabindex: selected ? '0' : '-1',
          'data-tab': id,
        }),
      );
    }
    setRightTab(rightTab);
    const selectionKey = state.view.selection.join('|'),
      nextStamp = [state.bundle?.bundleDigest ?? 'none', selectionKey, editable(state)].join('::');
    if (controllerIsDirty() && propertiesSelection === selectionKey) return;
    if (propertiesStamp === nextStamp) return;
    propertiesStamp = nextStamp;
    propertiesSelection = selectionKey;
    propertiesDirty = false;
    if (!state.bundle) {
      propertiesPane.replaceChildren(element(doc, 'p', {}, 'Access changed. Reopen this diagram.'));
      propertyController = null;
      updateCommandState(state);
      return;
    }
    const focused = propertiesPane.contains(doc.activeElement)
      ? doc.activeElement?.getAttribute('aria-label')
      : null;
    const submitPropertiesTransaction = (value) => {
      const result = submitTransaction(value, { allowDirty: true });
      if (result?.ok) {
        propertiesStamp = '';
        synchronizePropertiesAfterApply();
      }
      return result;
    };
    propertyController =
      renderDiagramProperties({
        root: propertiesPane,
        state,
        editable: editable(state),
        act,
        submitTransaction: submitPropertiesTransaction,
        onDirtyChange: handlePropertyDirty,
      }) ?? null;
    propertiesDirty = controllerIsDirty();
    updateCommandState(state);
    if (focused && !propertiesPane.contains(doc.activeElement))
      propertiesPane.querySelector('[aria-label="' + focused + '"]')?.focus();
  }
  function renderFooter(state) {
    footer.replaceChildren();
    if (!state.bundle) {
      footer.append(element(doc, 'span', {}, 'Access changed. Reopen this diagram to continue.'));
      return;
    }
    if (state.saveState === 'conflict')
      footer.append(
        element(doc, 'span', {}, 'A newer saved revision exists. Your draft remains in this tab.'),
        button(doc, 'Compare revisions', 'conflict', { className: 'de-primary' }),
      );
    else if (state.saveState === 'offline')
      footer.append(
        element(doc, 'span', {}, 'Save was not confirmed. Edits remain pending.'),
        button(doc, 'Retry save', 'save'),
      );
    else if (state.recovery.warning && !readOnly(state))
      footer.append(element(doc, 'span', {}, state.recovery.warning));
    else if (state.pendingCount > 0 && state.acknowledged)
      footer.append(
        element(
          doc,
          'span',
          {},
          'Recovered or pending edits are in this session. Review before you save.',
        ),
      );
    else if (!getDiagramAuthoringCapability(state.bundle.document.grammar.id))
      footer.append(
        element(
          doc,
          'span',
          {},
          'This diagram grammar is available for inspection only. Editing is not certified.',
        ),
      );
    else
      footer.append(
        element(
          doc,
          'span',
          {},
          state.view.selection.length +
            ' selected · ' +
            state.bundle.presentation.elements.length +
            ' objects',
        ),
      );
  }
  function closeDialog({ restoreFocus = true } = {}) {
    if (!dialog) return;
    const target = restoreFocus
      ? dialogOpener?.isConnected && shell.contains(dialogOpener)
        ? dialogOpener
        : stage
      : null;
    if (sourceMount) report('');
    sourceMount?.dispose();
    sourceMount = null;
    dialog.remove();
    dialog = null;
    dialogOpener = null;
    dialogLayer.replaceChildren();
    setBackgroundInert(false);
    const restore = () => {
      if (disposed || dialog || !target) return;
      const destination = target?.isConnected && shell.contains(target) ? target : stage;
      destination.focus({ preventScroll: true });
    };
    if (target) {
      restore();
      win.queueMicrotask(restore);
    }
  }
  function openDialog(name, content) {
    closeDialog({ restoreFocus: false });
    const active = actionTrigger?.isConnected ? actionTrigger : doc.activeElement;
    setOverflow(false, { restoreFocus: false });
    dialogOpener = active?.closest?.('.de-more-menu') ? moreButton : active;
    const panel = element(doc, 'section', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': name,
      className: 'de-dialog',
    });
    panel.append(element(doc, 'h2', {}, name));
    if (content) panel.append(content);
    dialogLayer.append(panel);
    dialog = panel;
    setBackgroundInert(true);
    panel.querySelector('button,input,select')?.focus();
    return panel;
  }
  /** @param {{ tab?: 'import' | 'export' }} [options] */
  function openSourcePanel({ tab: initialTab = 'import' } = {}) {
    const state = current();
    if (!state.bundle || !guardPropertyDraft()) return false;
    report('');
    const slot = element(doc, 'div', { className: 'de-source-slot' });
    openDialog('Mermaid import and export', slot).classList.add('de-source-dialog');
    sourceMount = mountDiagramSourcePanel({
      root: slot,
      session,
      source: sourceDraft ?? state.bundle.originalSource?.text ?? '',
      initialTab,
      onSourceChange: (value) => {
        sourceDraft = value;
      },
      onBeforeAdopt: guardPropertyDraft,
      onNavigateElements: (ids) => {
        const available = new Set(
          current().bundle?.presentation.elements.map((item) => item.elementId) ?? [],
        );
        const selected = ids.filter((id) => available.has(id));
        if (selected.length) select(selected, { force: true });
      },
      onAdopt: (bundle) => {
        sourceDraft = bundle.originalSource?.text ?? sourceDraft;
        closeDialog();
        report('');
        notice('Mermaid copy adopted as an unsaved diagram. Save to keep it.');
        fit();
      },
      onClose: () => {
        report('');
        closeDialog();
      },
      onReport: EMPTY_CALLBACK,
    });
    if (initialTab === 'import') sourceMount.focus();
    else sourceMount.selectTab('export', { focus: true });
    return true;
  }
  function askDelete() {
    const state = current(),
      ids = state.view.selection;
    if (!ids.length || !state.bundle) return;
    const preview = compileDiagramCommand(
      state.bundle,
      { type: 'delete', ids },
      { transactionId: freshId() },
    );
    const impact = preview.ok ? null : preview.deletionImpact;
    if (!impact) {
      report(errText(preview));
      return;
    }
    const body = element(doc, 'div');
    body.append(
      element(
        doc,
        'p',
        {},
        'Delete ' +
          impact.elementIds.length +
          ' object(s), including ' +
          impact.relationIds.length +
          ' connector(s)? This can be undone before another conflicting change.',
      ),
    );
    if (impact.relationIds.length)
      body.append(
        element(
          doc,
          'p',
          { className: 'de-muted' },
          'Connectors: ' + impact.relationIds.join(', '),
        ),
      );
    body.append(
      button(doc, 'Cancel', 'cancel-dialog'),
      button(doc, 'Delete', 'confirm-delete', { className: 'de-danger' }),
    );
    openDialog('Delete selection', body).dataset.impact = JSON.stringify(impact);
  }
  function connectDialog() {
    const state = current(),
      nodes = bundleOf(state).document.nodes;
    if (nodes.length < 2) {
      report('Create at least two nodes to connect.');
      return;
    }
    const body = element(doc, 'div'),
      ids = state.view.selection;
    const from = field(
      doc,
      'From',
      ids.find((id) => nodes.some((node) => node.id === id)) ?? nodes[0].id,
      { choices: nodes.map((node) => [node.id, node.label]) },
    );
    const to = field(
      doc,
      'To',
      ids.find((id) => nodes.some((node) => node.id === id && node.id !== from.input.value)) ??
        nodes[nodes.length - 1].id,
      { choices: nodes.map((node) => [node.id, node.label]) },
    );
    const label = field(doc, 'Connector label', '');
    body.append(
      from.label,
      to.label,
      label.label,
      button(doc, 'Cancel', 'cancel-dialog'),
      button(doc, 'Create connector', 'confirm-connect', { className: 'de-primary' }),
    );
    openDialog('Connect objects', body);
  }
  /** @param {'horizontal' | 'vertical' | null} [lane] */
  function layoutDialog(lane = null) {
    const body = element(doc, 'div');
    body.append(
      element(
        doc,
        'p',
        {},
        'Preview the arrangement before applying. No changes are saved during preview.',
      ),
    );
    if (!lane) {
      const scope = field(doc, 'Arrange', 'selection', {
        choices: [
          ['selection', 'Selection'],
          ['all', 'Whole diagram'],
        ],
      });
      body.append(scope.label);
    }
    if (lane)
      body.append(
        element(
          doc,
          'p',
          {},
          'Arrange direct members within this lane. Container geometry changes only when you apply.',
        ),
      );
    body.append(
      button(doc, 'Cancel layout', 'cancel-layout'),
      button(doc, 'Preview layout', 'preview-layout', { className: 'de-primary' }),
    );
    const panel = openDialog('Layout preview', body);
    if (lane) panel.dataset.lane = lane;
  }
  async function applyPropertiesDraft() {
    if (!controllerIsDirty()) return true;
    const controller = propertyController;
    const form = propertiesPane.querySelector('form');
    if (form && !form.checkValidity()) {
      form.reportValidity();
      form.querySelector(':invalid')?.focus();
      return false;
    }
    if (!controller?.apply) {
      report('Apply or revert property changes before saving.');
      controller?.focus?.();
      return false;
    }
    const result = await controller.apply();
    if (result === false || result?.ok === false) {
      controller.focus?.();
      return false;
    }
    propertiesDirty = false;
    updateCommandState(current(), false);
    synchronizePropertiesAfterApply();
    return true;
  }
  async function save() {
    const state = current();
    if (state.saveState === 'conflict') {
      act('conflict');
      return;
    }
    if (!(await applyPropertiesDraft())) return;
    const result = await session.save();
    if (disposed) return;
    if (!result.ok) {
      report(errText(result));
      if (result.status === 'conflict' && host.readCurrent) {
        try {
          const authoritative = await host.readCurrent();
          const compared = session.refresh(authoritative);
          if (!compared.ok && current().comparison) act('conflict');
        } catch (error) {
          report(
            error instanceof Error
              ? error.message
              : 'Could not read current revision. Pending edits remain.',
          );
        }
      }
    } else {
      report('');
      notice('Diagram saved.');
    }
  }
  function lockedSelection(bundle, ids, next) {
    const changes = ids
      .map((id) => bundle.presentation.elements.find((item) => item.elementId === id))
      .filter(Boolean)
      .map((item) => {
        const before = appearanceFields(item),
          after = clone(before);
        if (item.bounds) {
          after.locks.position = next;
          after.locks.size = next;
        }
        if (item.route) after.locks.route = next;
        return { elementId: item.elementId, before, after };
      });
    return { type: 'appearance', changes };
  }
  function act(action, value, options = {}) {
    const state = current(),
      bundle = state.bundle,
      ids = state.view.selection;
    if (action === 'host-action') {
      const entry = hostActions.find((item) => item.id === actionTrigger?.dataset.hostAction);
      if (entry && !actionTrigger.disabled)
        entry.onSelect({ session, state, trigger: actionTrigger });
      return;
    }
    if (action === 'cancel-dialog') {
      if (state.gesture) session.cancelGesture('cancel-dialog');
      closeDialog();
      return;
    }
    if (!bundle) return;
    if (action === 'toggle-group') {
      if (actionTrigger?.dataset.id) toggleGroup(actionTrigger.dataset.id);
      return;
    }
    if (action === 'save') return void save();
    if (action === 'undo') {
      if (!guardPropertyDraft()) return;
      const result = session.undo();
      if (!result.ok) report(errText(result));
      return;
    }
    if (action === 'redo') {
      if (!guardPropertyDraft()) return;
      const result = session.redo();
      if (!result.ok) report(errText(result));
      return;
    }
    if (action === 'outline' || action === 'close-outline') {
      setRail('left', action === 'outline' ? !leftOpen : false, {
        focusPanel: action === 'outline' && !leftOpen,
      });
      return;
    }
    if (action === 'properties' || action === 'close-properties') {
      setRail('right', action === 'properties' ? !rightOpen : false, {
        focusPanel: action === 'properties' && !rightOpen,
      });
      return;
    }
    if (action === 'close-drawers') {
      closeDrawers();
      return;
    }
    if (action === 'outline-tab' || action === 'shapes-tab') {
      setLeftTab(action === 'outline-tab' ? 'outline' : 'shapes');
      controlsStamp = '';
      renderChrome(state);
      return;
    }
    if (action === 'properties-tab' || action === 'review-tab' || action === 'host-panel-tab') {
      setRightTab(
        actionTrigger?.dataset.tab ?? (action === 'review-tab' ? 'review' : 'properties'),
      );
      return;
    }
    if (action === 'select-tool' || action === 'pan-tool') {
      tool = action === 'select-tool' ? 'select' : 'pan';
      controlsStamp = '';
      renderChrome(state);
      notice(tool === 'select' ? 'Select mode' : 'Pan mode');
      return;
    }
    if (action === 'snap') {
      session.setView({ snap: !state.view.snap });
      notice(state.view.snap ? 'Snap off' : 'Snap on');
      return;
    }
    if (action === 'fit') {
      fit();
      return;
    }
    if (action === 'zoom-in') {
      zoom(1.2);
      return;
    }
    if (action === 'zoom-out') {
      zoom(1 / 1.2);
      return;
    }
    if (action === 'more') {
      setOverflow(!overflowOpen, { focus: !overflowOpen });
      return;
    }
    if (action === 'source-panel') {
      openSourcePanel(readOnly(state) ? { tab: 'export' } : undefined);
      return;
    }
    if (action === 'show-source' || action === 'show-revision') {
      const pre = element(
        doc,
        'pre',
        { className: 'de-source-view' },
        JSON.stringify(
          action === 'show-source'
            ? { originalSource: bundle.originalSource, sourceMap: bundle.sourceMap }
            : snapshot(bundle),
          null,
          2,
        ),
      );
      const body = element(doc, 'div');
      body.append(pre, button(doc, 'Close', 'cancel-dialog'));
      openDialog(action === 'show-source' ? 'Source' : 'Current revision', body);
      return;
    }
    if (action === 'export-json') {
      setOverflow(false, { restoreFocus: false });
      downloadJson(doc, bundle, bundle.diagramId + '.planr-diagram-bundle.json');
      moreButton.focus({ preventScroll: true });
      return;
    }
    if (action === 'conflict') {
      const wrap = element(doc, 'div');
      openDialog('Compare revisions', wrap);
      conflictMount?.dispose();
      conflictMount = mountDiagramConflicts({
        root: wrap,
        session,
        onClose: closeDialog,
        onError: (result) => report(errText(result)),
      });
      return;
    }
    if (action === 'layout') {
      layoutDialog();
      return;
    }
    if (action === 'lane-horizontal' || action === 'lane-vertical') {
      layoutDialog(action === 'lane-horizontal' ? 'horizontal' : 'vertical');
      return;
    }
    if (action === 'preview-layout') {
      if (state.gesture) session.cancelGesture('new-layout');
      const start = session.beginGesture();
      if (!start.ok) {
        report(errText(start));
        return;
      }
      let preview;
      if (dialog.dataset.lane) {
        const laneId = ids[0],
          direction = dialog.dataset.lane;
        preview = safeAction(
          () => session.previewGesture(laneArrangementCommand(bundle, laneId, direction)),
          report,
        );
      } else {
        const scope = dialog.querySelector('[aria-label="Arrange"]').value;
        const targets = (
          scope === 'all' ? bundle.presentation.elements.map((item) => item.elementId) : ids
        ).filter((id) => !bundle.document.relations.some((relation) => relation.id === id));
        preview = session.previewLayout({ targetIds: targets.slice(0, 256) });
      }
      if (!preview?.ok) {
        if (preview) report(errText(preview));
        session.cancelGesture('invalid-layout');
        return;
      }
      dialog
        .querySelector('[data-action="preview-layout"]')
        .replaceWith(button(doc, 'Apply layout', 'apply-layout', { className: 'de-primary' }));
      dialog.append(
        element(
          doc,
          'p',
          { className: 'de-muted' },
          'Preview only · No changes saved. Apply as one undoable edit.',
        ),
      );
      return;
    }
    if (action === 'apply-layout') {
      const result = session.completeGesture();
      if (!result.ok) report(errText(result));
      else {
        closeDialog();
        notice('Layout applied as one edit. Save to keep it.');
      }
      return;
    }
    if (action === 'cancel-layout') {
      session.cancelGesture('cancel-layout');
      closeDialog();
      return;
    }
    if (action === 'blank') {
      empty.hidden = true;
      tab = 'shapes';
      controlsStamp = '';
      renderChrome(state);
      return;
    }
    if (action === 'template') {
      const at = worldPoint({ x: stage.clientWidth / 2 - 200, y: stage.clientHeight / 2 });
      const command = processTemplate({ x: Math.round(at.x), y: Math.round(at.y) });
      submit(
        command,
        command.elements.filter((item) => item.collection === 'nodes').map((item) => item.value.id),
      );
      fit();
      return;
    }
    if (action === 'create') {
      const kind = value,
        at = worldPoint({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 });
      const existing = bundle.presentation.elements
        .map((item) => item.bounds)
        .filter((rect) => rect !== null);
      const right = existing.length
        ? Math.max(...existing.map((item) => item.x + item.width))
        : null;
      const y = existing.length
        ? Math.min(...existing.map((item) => item.y))
        : Math.round(at.y - 36);
      const command = createObject(kind, {
        x: right === null ? Math.round(at.x - 80) : Math.round(right + 64),
        y: Math.round(y),
      });
      const result = submit(command, [command.elements[0].value.id]);
      if (result.ok) {
        if (state.view.camera.fit) fit();
        stage.focus();
      }
      return;
    }
    if (action === 'select-id' || action === 'select-member') {
      const selected = options.additive
        ? ids.includes(value)
          ? ids.filter((id) => id !== value)
          : [...ids, value]
        : [value];
      const result = select(selected);
      if (result.ok) {
        const outlineItem = options.fromOutline
          ? [...outlinePane.querySelectorAll('[data-action="select-id"]')].find(
              (item) => item.dataset.id === value,
            )
          : null;
        (outlineItem ?? stage).focus();
      }
      return;
    }
    if (action === 'connect') {
      connectDialog();
      return;
    }
    if (action === 'confirm-connect') {
      const from = dialog.querySelector('[aria-label="From"]').value,
        to = dialog.querySelector('[aria-label="To"]').value,
        label = dialog.querySelector('[aria-label="Connector label"]').value;
      const command = connector(from, to, label);
      const result = submit(command, [command.elements[0].value.id]);
      if (result.ok) closeDialog();
      return;
    }
    if (action === 'delete') {
      askDelete();
      return;
    }
    if (action === 'confirm-delete') {
      const impact = JSON.parse(dialog.dataset.impact);
      const result = submit({ type: 'delete', ids, confirmedImpact: impact });
      if (result.ok) {
        select([], { force: true });
        closeDialog();
      }
      return;
    }
    if (action === 'update-title') {
      const before = {
        title: bundle.document.title,
        summary: bundle.document.summary,
        audience: bundle.document.audience,
        accessibility: bundle.document.accessibility,
      };
      const after = clone(before);
      after.title = value;
      after.accessibility.title = value;
      submitTransaction(
        transaction(bundle, [{ type: 'update-semantics', collection: 'document', before, after }]),
      );
      return;
    }
    if (action === 'copy') {
      const copied = copyDiagramSelection(bundle, ids);
      if (!copied.ok) report(errText(copied));
      else {
        clipboard = copied.value;
        notice('Selection copied.');
      }
      return;
    }
    if (action === 'paste' || action === 'duplicate') {
      const result = duplicateSelection(
        bundle,
        action === 'paste' ? (clipboard?.ids ?? []) : ids,
        action === 'paste' ? clipboard : null,
      );
      if (!result?.ok) {
        report(errText(result));
        return;
      }
      const submitted = submitTransaction(result.transaction);
      if (submitted.ok) select(result.selectedIds);
      return;
    }
    if (action === 'lock' || action === 'unlock') {
      submit(lockedSelection(bundle, ids, action === 'lock'));
      return;
    }
    if (action.startsWith('align-') || action.startsWith('distribute-')) {
      const command = safeAction(() => arrangementCommand(bundle, ids, action), report);
      if (command) submit(command);
      return;
    }
    if (action === 'group') {
      const selected = ids
        .map((id) => bundle.presentation.elements.find((item) => item.elementId === id)?.bounds)
        .filter((rect) => rect != null);
      if (selected.length < 2) {
        report('Select at least two bounded objects to group.');
        return;
      }
      const x = Math.min(...selected.map((item) => item.x)) - 20,
        y = Math.min(...selected.map((item) => item.y)) - 40;
      const width = Math.max(...selected.map((item) => item.x + item.width)) - x + 20,
        height = Math.max(...selected.map((item) => item.y + item.height)) - y + 20;
      const id = freshId('group');
      submit(
        {
          type: 'group',
          group: { id, label: 'Group' },
          ids,
          placement: placement(id, 'container', { x, y, width, height }),
        },
        [id],
      );
      return;
    }
    if (action === 'ungroup') {
      submit({ type: 'ungroup', ids });
      return;
    }
    if (action === 'reparent') {
      submit({ type: 'reparent', ids, parentId: value });
      return;
    }
    if (action === 'lane-up' || action === 'lane-down') {
      const order = [...bundle.document.laneOrder],
        index = order.indexOf(ids[0]),
        delta = action === 'lane-up' ? -1 : 1;
      if (index < 0 || index + delta < 0 || index + delta >= order.length) return;
      [order[index], order[index + delta]] = [order[index + delta], order[index]];
      submit({ type: 'reorder-lanes', ids: order });
      return;
    }
    if (action === 'collapse') {
      const collapsed = new Set(state.view.collapsedGroups);
      if (collapsed.has(ids[0])) collapsed.delete(ids[0]);
      else collapsed.add(ids[0]);
      session.setView({ collapsedGroups: [...collapsed] });
      return;
    }
    if (['add-bend', 'remove-bend', 'reset-route', 'position-label'].includes(action)) {
      const id = ids[0],
        place = placementOf(bundle, id),
        before = geometryFields(place),
        after = clone(before);
      const points = session.geometry(id)?.points ?? [];
      if (action === 'reset-route') {
        after.route.mode = 'automatic';
        after.route.points = [];
      }
      if (action === 'add-bend') {
        const bent = safeAction(() => addOrthogonalDetour(points), report);
        if (!bent) return;
        after.route.mode = 'manual';
        after.route.strategy = 'orthogonal';
        after.route.points = bent;
      }
      if (action === 'remove-bend') {
        after.route.points.splice(Number(value) + 1, 1);
        if (
          after.route.points.some(
            (point, index, all) =>
              index > 0 && point.x !== all[index - 1].x && point.y !== all[index - 1].y,
          )
        ) {
          report(
            'This corner joins perpendicular segments. Move adjacent bends or reset the route.',
          );
          return;
        }
        if (after.route.points.length === 2) {
          after.route.mode = 'automatic';
          after.route.points = [];
        }
      }
      if (action === 'position-label') {
        const middle = points[Math.floor(points.length / 2)];
        after.label = { x: middle.x, y: middle.y, width: 140 };
      }
      submit({ type: 'geometry', changes: [{ elementId: id, before, after }] });
      return;
    }
  }
  function pointerDown(event) {
    if (event.button !== 0 || !current().bundle || dialog || focusable(event.target)) return;
    const state = current(),
      start = fromClient(event),
      target = event.target.closest('[data-element-id]'),
      handle = event.target.closest('[data-handle]');
    const query = session.query({ x: start.x, y: start.y, tolerance: 8 });
    if (!query.ok) {
      report(errText(query));
      return;
    }
    const id =
      handle?.getAttribute('data-handle-id') ??
      query.hits[0]?.id ??
      target?.getAttribute('data-element-id') ??
      null;
    if ((tool === 'pan' || tempPan) && !handle) {
      drag = { type: 'pan', start, last: start, camera: clone(state.view.camera) };
      stage.setPointerCapture(event.pointerId);
      return;
    }
    if (!editable(state)) {
      if (id) select([id]);
      return;
    }
    if (controllerIsDirty()) {
      event.preventDefault();
      guardPropertyDraft();
      return;
    }
    if (handle) {
      if (!state.view.selection.includes(id) && !select([id]).ok) return;
      drag = {
        type: handle.dataset.handle,
        id,
        index: Number(handle.dataset.index),
        start,
        last: start,
        origin: state.bundle,
        originPoints: session.geometry(id)?.points ?? [],
        active: false,
      };
    } else if (id) {
      const ids = event.shiftKey
        ? state.view.selection.includes(id)
          ? state.view.selection.filter((value) => value !== id)
          : [...state.view.selection, id]
        : state.view.selection.includes(id)
          ? state.view.selection
          : [id];
      if (!select(ids).ok) return;
      drag = { type: 'move', id, ids, start, last: start, origin: state.bundle, active: false };
    } else {
      if (!event.shiftKey && !select([]).ok) return;
      drag = {
        type: 'marquee',
        start,
        last: start,
        additive: event.shiftKey,
        base: [...state.view.selection],
      };
    }
    stage.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function previewDrag() {
    raf = 0;
    if (!drag || !drag.active || drag.type === 'marquee' || drag.type === 'pan') return;
    const state = current(),
      scale = state.view.camera.scale;
    const dx = (drag.last.x - drag.start.x) / scale,
      dy = (drag.last.y - drag.start.y) / scale;
    /** @type {DiagramCommand} */
    let command;
    if (drag.type === 'move') {
      const x = state.view.snap ? Math.round(dx / 8) * 8 : Math.round(dx),
        y = state.view.snap ? Math.round(dy / 8) * 8 : Math.round(dy);
      command = { type: 'move', ids: drag.ids, dx: x, dy: y };
    } else {
      const place = drag.origin.presentation.elements.find((item) => item.elementId === drag.id),
        before = geometryFields(place),
        after = clone(before);
      if (drag.type === 'resize') {
        after.bounds.width = Math.max(24, Math.round(before.bounds.width + dx));
        after.bounds.height = Math.max(24, Math.round(before.bounds.height + dy));
      }
      if (drag.type === 'bend') {
        const points = drag.originPoints,
          target = points[drag.index];
        if (!target) return;
        if (after.route.mode !== 'manual') {
          after.route.mode = 'manual';
          after.route.points = points;
        }
        if (after.route.strategy === 'orthogonal')
          after.route.points = moveOrthogonalBend(points, drag.index, dx, dy);
        else
          after.route.points[drag.index] = {
            x: Math.round(target.x + dx),
            y: Math.round(target.y + dy),
          };
      }
      command = { type: 'geometry', changes: [{ elementId: drag.id, before, after }] };
    }
    const result = session.previewGesture(command);
    if (!result.ok) report(errText(result));
    else report('');
  }
  function pointerMove(event) {
    if (!drag) return;
    const point = fromClient(event);
    drag.last = point;
    if (drag.type === 'pan') {
      const camera = drag.camera;
      cameraPatch({
        x: camera.x + point.x - drag.start.x,
        y: camera.y + point.y - drag.start.y,
        scale: camera.scale,
        fit: null,
      });
      return;
    }
    if (drag.type === 'marquee') {
      renderOverlays(current(), displayed(current()), new Set(current().view.selection));
      return;
    }
    if (!drag.active && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 3) {
      const result = session.beginGesture();
      if (!result.ok) {
        report(errText(result));
        drag = null;
        return;
      }
      drag.active = true;
    }
    if (drag.active && !raf) raf = win.requestAnimationFrame(previewDrag);
  }
  function finishPointer(event, cancel = false) {
    if (!drag) return;
    if (raf) {
      win.cancelAnimationFrame(raf);
      raf = 0;
      if (drag.active && !cancel) previewDrag();
    }
    const finished = drag;
    drag = null;
    if (finished.active) {
      const result = cancel ? session.cancelGesture('cancelled') : session.completeGesture();
      if (!result.ok) report(errText(result));
      else if (!cancel) notice('One edit applied. Save diagram to keep it.');
    } else if (finished.type === 'marquee' && !cancel) {
      const a = worldPoint(finished.start),
        b = worldPoint(finished.last),
        rect = {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: Math.abs(a.x - b.x),
          height: Math.abs(a.y - b.y),
        };
      if (rect.width > 3 || rect.height > 3) {
        const picked = bundleOf(current())
          .presentation.elements.filter((item) => item.bounds && intersect(item.bounds, rect))
          .map((item) => item.elementId);
        select(finished.additive ? [...finished.base, ...picked] : picked);
      }
    }
    if (event?.pointerId !== undefined && stage.hasPointerCapture(event.pointerId))
      stage.releasePointerCapture(event.pointerId);
    draw({ type: 'view' });
  }
  function handleKey(event) {
    if (dialog && event.key === 'Tab') {
      const controls = [
        ...dialog.querySelectorAll(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      ].filter(
        (control) =>
          !control.closest('[hidden],[inert],[aria-hidden="true"]') &&
          control.getClientRects().length,
      );
      if (controls.length) {
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && doc.activeElement === first) {
          event.preventDefault();
          last.focus();
          return;
        }
        if (!event.shiftKey && doc.activeElement === last) {
          event.preventDefault();
          first.focus();
          return;
        }
      }
    }
    if (
      !dialog &&
      event.key === 'Tab' &&
      win.innerWidth <= 1100 &&
      (leftOpen || rightOpen) &&
      shell.contains(event.target)
    ) {
      const panel = leftOpen ? $('.de-left') : $('.de-right');
      const controls = [
        ...panel.querySelectorAll(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex]:not([tabindex="-1"])',
        ),
      ].filter(
        (control) =>
          !control.closest('[hidden],[inert],[aria-hidden="true"]') &&
          control.getClientRects().length,
      );
      if (controls.length) {
        const active = doc.activeElement,
          index = controls.indexOf(active),
          step = event.shiftKey ? -1 : 1;
        const next =
          index < 0
            ? event.shiftKey
              ? controls.length - 1
              : 0
            : (index + step + controls.length) % controls.length;
        event.preventDefault();
        controls[next].focus({ preventScroll: true });
        return;
      }
    }
    if (!shell.contains(event.target) && !drag && !dialog) return;
    if (dialog && event.key === 'Escape') {
      event.preventDefault();
      act('cancel-dialog');
      return;
    }
    if (overflowOpen && event.key === 'Escape') {
      event.preventDefault();
      setOverflow(false);
      return;
    }
    if (overflowOpen && event.key === 'Tab') {
      setOverflow(false);
      return;
    }
    if (event.target === moreButton && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      setOverflow(true);
      const items = [...moreMenu.querySelectorAll('[role="menuitem"]')];
      (event.key === 'ArrowUp' ? items.at(-1) : items[0])?.focus();
      return;
    }
    if (overflowOpen && event.target.matches?.('[role="menuitem"]')) {
      const items = [...moreMenu.querySelectorAll('[role="menuitem"]:not(:disabled)')],
        index = items.indexOf(event.target);
      let next = -1;
      if (event.key === 'ArrowDown') next = (index + 1) % items.length;
      if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = items.length - 1;
      if (next >= 0) {
        event.preventDefault();
        items[next]?.focus();
        return;
      }
    }
    if (
      event.target.matches?.('[role="tab"]') &&
      ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    ) {
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
        setLeftTab(action === 'outline-tab' ? 'outline' : 'shapes');
        controlsStamp = '';
        renderChrome(current());
        target.isConnected
          ? target.focus()
          : leftTabs.querySelector('[aria-selected="true"]')?.focus();
      } else if (list === rightTabs) setRightTab(target.dataset.tab, { focus: true });
      return;
    }
    if (event.key === 'Escape' && win.innerWidth <= 1100 && (leftOpen || rightOpen)) {
      event.preventDefault();
      closeDrawers();
      return;
    }
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      finishPointer(null, true);
      return;
    }
    if (
      event.target.matches?.('[role="treeitem"][data-action="select-id"]') &&
      ['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowRight', 'ArrowLeft'].includes(event.key) &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      const rows = [...outlinePane.querySelectorAll('[role="treeitem"]')].filter(
          (row) => !row.closest('[hidden]'),
        ),
        row = event.target,
        index = rows.indexOf(row),
        expanded = row.getAttribute('aria-expanded');
      if (event.key === 'ArrowDown') focusOutlineRow(rows[index + 1]);
      else if (event.key === 'ArrowUp') focusOutlineRow(rows[index - 1]);
      else if (event.key === 'Home') focusOutlineRow(rows[0]);
      else if (event.key === 'End') focusOutlineRow(rows.at(-1));
      else if (event.key === 'ArrowRight') {
        if (expanded === 'false') toggleGroup(row.dataset.id);
        else if (expanded === 'true') focusOutlineRow(rows[index + 1]);
      } else if (expanded === 'true') toggleGroup(row.dataset.id);
      else {
        const parentId = row.closest('.de-outline-item')?.dataset.parentId;
        focusOutlineRow(
          parentId
            ? outlinePane.querySelector('[role="treeitem"][data-id="' + parentId + '"]')
            : null,
        );
      }
      return;
    }
    if (
      event.target.matches?.('[data-action="select-id"]') &&
      (event.shiftKey || event.metaKey || event.ctrlKey) &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      event.preventDefault();
      act('select-id', event.target.dataset.id, { additive: true, fromOutline: true });
      return;
    }
    if (focusable(event.target) && event.target !== stage) return;
    const state = current(),
      ids = state.view.selection;
    if (event.key === ' ') {
      if (event.target === stage) {
        event.preventDefault();
        tempPan = true;
      }
      return;
    }
    if (event.key.toLowerCase() === 'v' && !event.metaKey && !event.ctrlKey) {
      tool = 'select';
      controlsStamp = '';
      renderChrome(state);
      notice('Select mode');
      return;
    }
    if (event.key.toLowerCase() === 'h' && !event.metaKey && !event.ctrlKey) {
      tool = 'pan';
      controlsStamp = '';
      renderChrome(state);
      notice('Pan mode');
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      act('save');
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      act(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && ids.length) {
      event.preventDefault();
      act('copy');
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v' && clipboard) {
      event.preventDefault();
      act('paste');
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && ids.length && editable(state)) {
      event.preventDefault();
      act('delete');
      return;
    }
    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) &&
      ids.length &&
      editable(state)
    ) {
      event.preventDefault();
      if (!guardPropertyDraft()) return;
      const delta = event.shiftKey ? 10 : 1;
      const dx = event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0;
      const dy = event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0;
      const result = submit({ type: 'move', ids, dx, dy });
      if (result.ok) notice('Selection moved ' + delta + ' unit' + (delta === 1 ? '' : 's') + '.');
    }
  }
  function containDrawerFocus(event) {
    if (dialog || win.innerWidth > 1100 || drawerBackdrop.hidden || (!leftOpen && !rightOpen))
      return;
    const panel = leftOpen ? $('.de-left') : $('.de-right');
    // Host controls outside the editor stay reachable while a drawer is open.
    if (!panel || panel.contains(event.target) || !shell.contains(event.target)) return;
    const controls = [
      ...panel.querySelectorAll(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (control) =>
        !control.closest('[hidden],[inert],[aria-hidden="true"]') &&
        control.getClientRects().length,
    );
    (controls[0] ?? panel).focus({ preventScroll: true });
  }
  const onClick = (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || target.onclick) return;
    if (overflowOpen && !target.closest('.de-more-wrap'))
      setOverflow(false, { restoreFocus: false });
    const action = target.dataset.action;
    actionTrigger = target;
    try {
      if (action === 'create') act(action, target.dataset.kind);
      else if (action === 'select-id')
        act(action, target.dataset.id, {
          additive: event.shiftKey || event.metaKey || event.ctrlKey,
          fromOutline: true,
        });
      else if (action === 'select-member') act(action, target.dataset.member);
      else act(action);
    } finally {
      actionTrigger = null;
    }
  };
  const onDocumentPointerDown = (event) => {
    if (overflowOpen && !event.target.closest?.('.de-more-wrap'))
      setOverflow(false, { restoreFocus: false });
  };
  const onWheel = (event) => {
    if (!event.target.closest('.de-canvas')) return;
    event.preventDefault();
    const point = fromClient(event);
    if (event.ctrlKey || event.metaKey) zoom(Math.exp(-event.deltaY * 0.002), point);
    else {
      const camera = current().view.camera;
      cameraPatch({ ...camera, x: camera.x - event.deltaX, y: camera.y - event.deltaY, fit: null });
    }
  };
  let resizeFrame = 0;
  const onResize = () => {
    const breakpoint = win.innerWidth <= 1100 ? 'drawer' : 'desktop';
    const breakpointChanged = !!lastBreakpoint && lastBreakpoint !== breakpoint;
    let focusAfterRender = null;
    if (breakpointChanged && breakpoint === 'drawer') {
      const active = doc.activeElement,
        left = $('.de-left'),
        right = $('.de-right');
      const focusTarget = left.contains(active)
        ? bar.querySelector('[data-action="outline"]')
        : right.contains(active)
          ? bar.querySelector('[data-action="properties"]')
          : null;
      // Move focus to the matching trigger while the rail is still operable;
      // renderChrome will close and inert both responsive drawers afterward.
      focusTarget?.focus({ preventScroll: true });
      leftOpen = false;
      rightOpen = false;
      drawerOpener = null;
    }
    if (breakpointChanged && breakpoint === 'desktop' && doc.activeElement === drawerBackdrop)
      focusAfterRender = stage;
    const rect = stage.getBoundingClientRect();
    if (
      lastCanvas &&
      lastBreakpoint === breakpoint &&
      lastCanvas.width === rect.width &&
      lastCanvas.height === rect.height
    )
      return;
    if (!lastBreakpoint && breakpoint === 'drawer') {
      leftOpen = false;
      rightOpen = false;
    }
    if (breakpointChanged && breakpoint === 'desktop') {
      leftOpen = true;
      rightOpen = true;
      drawerOpener = null;
    }
    lastBreakpoint = breakpoint;
    if (lastCanvas) {
      const camera = current().view.camera;
      if (camera.fit) fit();
      else
        cameraPatch({
          ...camera,
          x: camera.x + (rect.width - lastCanvas.width) / 2,
          y: camera.y + (rect.height - lastCanvas.height) / 2,
        });
    } else fit();
    lastCanvas = { width: rect.width, height: rect.height };
    controlsStamp = '';
    renderChrome(current());
    focusAfterRender?.focus({ preventScroll: true });
  };
  const scheduleResize = () => {
    if (disposed || resizeFrame) return;
    resizeFrame = win.requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!disposed) onResize();
    });
  };
  const resize =
    typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(scheduleResize) : null;
  const onSession = (event) => {
    if (disposed) return;
    draw(event);
  };
  const unsubscribe = session.subscribe(onSession);
  const onPointerUp = (event) => finishPointer(event);
  const onPointerCancel = (event) => finishPointer(event, true);
  const onLostCapture = (event) => {
    if (drag) finishPointer(event, true);
  };
  const onKeyUp = (event) => {
    if (event.key === ' ') tempPan = false;
  };
  const onBlur = () => {
    tempPan = false;
    if (drag) finishPointer(null, true);
  };
  const onColorScheme = () => {
    if (!hostScheme) draw({ type: 'refresh', affectedIds: [] });
  };
  shell.addEventListener('click', onClick);
  stage.addEventListener('pointerdown', pointerDown);
  stage.addEventListener('pointermove', pointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerCancel);
  stage.addEventListener('lostpointercapture', onLostCapture);
  stage.addEventListener('wheel', onWheel, { passive: false });
  doc.addEventListener('keydown', handleKey);
  doc.addEventListener('focusin', containDrawerFocus);
  doc.addEventListener('keyup', onKeyUp);
  win.addEventListener('blur', onBlur);
  colorScheme?.addEventListener?.('change', onColorScheme);
  doc.addEventListener('pointerdown', onDocumentPointerDown);
  if (resize) resize.observe(stage);
  else win.addEventListener('resize', scheduleResize);
  draw();
  scheduleResize();
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      resize?.disconnect();
      win.cancelAnimationFrame(raf);
      win.cancelAnimationFrame(resizeFrame);
      win.cancelAnimationFrame(announcementFrame);
      reviewCleanup?.();
      for (const cleanup of hostPanelCleanups.values()) cleanup?.();
      conflictMount?.dispose();
      sourceMount?.dispose();
      shell.removeEventListener('click', onClick);
      stage.removeEventListener('pointerdown', pointerDown);
      stage.removeEventListener('pointermove', pointerMove);
      stage.removeEventListener('pointerup', onPointerUp);
      stage.removeEventListener('pointercancel', onPointerCancel);
      stage.removeEventListener('lostpointercapture', onLostCapture);
      stage.removeEventListener('wheel', onWheel);
      if (!resize) win.removeEventListener('resize', scheduleResize);
      doc.removeEventListener('keydown', handleKey);
      doc.removeEventListener('focusin', containDrawerFocus);
      doc.removeEventListener('keyup', onKeyUp);
      doc.removeEventListener('pointerdown', onDocumentPointerDown);
      win.removeEventListener('blur', onBlur);
      colorScheme?.removeEventListener?.('change', onColorScheme);
      shell.remove();
      elementNodes.clear();
      renderSignatures.clear();
    },
    refresh(bundle) {
      return session.refresh(bundle);
    },
    openSourcePanel,
    setColorScheme(next) {
      hostScheme = colorSchemeOf(next);
      applyColorScheme();
      draw({ type: 'refresh', affectedIds: [] });
    },
    openPanel(id) {
      if (disposed || !rightPanes().has(id)) return false;
      setRail('right', true);
      controlsStamp = '';
      renderChrome(current());
      setRightTab(id, { focus: true });
      return rightTab === id;
    },
    refreshHost() {
      if (disposed) return;
      controlsStamp = '';
      renderChrome(current());
    },
    getState() {
      return session.getState();
    },
  };
}
