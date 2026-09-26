// @ts-check
import { button, element, iconButton } from './diagram-editor-dom.mjs';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Build the static editor chrome: toolbar groups, both rails, the stage and the live regions.
 * @type {typeof import('./diagram-editor-context.d.mts').renderEditorSkeleton}
 */
export function renderEditorSkeleton(doc, scopedId) {
  const node = (tag, attributes, ...children) => {
    const created = element(doc, tag, attributes);
    created.append(...children);
    return created;
  };
  const svgNode = (tag, attributes) => {
    const created = doc.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) created.setAttribute(name, value);
    return created;
  };
  const group = (label) =>
    node('div', { className: 'de-command-group', role: 'group', 'aria-label': label });

  const barStart = group('Document navigation'),
    barCenter = group('History and arrangement'),
    barEnd = group('Save and inspect');
  const mark = node('span', { className: 'de-mark', 'aria-hidden': 'true' }),
    title = node('strong', { className: 'de-title' }),
    subtitle = node('small', { className: 'de-subtitle' }),
    saveState = node('span', { className: 'de-save-state', role: 'status', 'aria-live': 'polite' }),
    moreWrap = node('div', { className: 'de-more-wrap' });
  const bar = node(
    'header',
    { className: 'de-bar', role: 'toolbar', 'aria-label': 'Diagram commands' },
    node(
      'div',
      { className: 'de-bar-start' },
      barStart,
      node(
        'div',
        { className: 'de-brand' },
        mark,
        node('div', { className: 'de-identity' }, title, subtitle),
      ),
    ),
    node('div', { className: 'de-bar-center' }, barCenter),
    node('div', { className: 'de-bar-end' }, saveState, barEnd, moreWrap),
  );

  const drawerBackdrop = node('button', {
    className: 'de-drawer-backdrop',
    type: 'button',
    'data-action': 'close-drawers',
    'aria-label': 'Close open panel',
    tabindex: '-1',
    hidden: true,
  });
  const tabPanel = (className, name, hidden = false) =>
    node('div', {
      className: `${className} de-tabpanel`,
      id: scopedId(`${name}-pane`),
      role: 'tabpanel',
      'aria-labelledby': scopedId(`${name}-tab`),
      hidden,
    });
  const leftTabs = node('div', {
      className: 'de-rail-tabs de-panel-tabs',
      role: 'tablist',
      'aria-label': 'Left panel',
    }),
    closeOutline = button(doc, '×', 'close-outline', {
      className: 'de-panel-close',
      'aria-label': 'Close outline',
    }),
    outlinePane = tabPanel('de-outline-pane', 'outline'),
    shapesPane = tabPanel('de-shapes-pane', 'shapes', true);
  const left = node(
    'aside',
    {
      className: 'de-left',
      id: scopedId('outline-panel'),
      'aria-label': 'Diagram outline and shapes',
    },
    node(
      'div',
      { className: 'de-panel-header' },
      node('strong', { className: 'de-panel-title' }, 'Objects'),
      leftTabs,
      closeOutline,
    ),
    node('div', { className: 'de-left-content' }, outlinePane, shapesPane),
  );

  const world = svgNode('g', { 'data-world': '' }),
    overlays = svgNode('g', { 'data-overlays': '' });
  const svg = svgNode('svg', {
    'data-editor-svg': '',
    'aria-label': 'Diagram drawing',
    role: 'img',
  });
  svg.append(world, overlays);
  const empty = node('div', { className: 'de-empty' }),
    canvasTools = node('div', {
      className: 'de-canvas-tools',
      role: 'toolbar',
      'aria-label': 'Canvas tools',
    }),
    footer = node('div', { className: 'de-stage-footer' });
  const stage = node(
    'div',
    {
      className: 'de-canvas',
      'aria-label': 'Diagram canvas',
      'aria-describedby': scopedId('canvas-instructions'),
      role: 'application',
      tabindex: '0',
    },
    svg,
    empty,
    canvasTools,
    node('div', { className: 'de-mobile-message' }, 'Review on mobile. Open on desktop to edit.'),
  );
  const stageRegion = node(
    'section',
    { className: 'de-stage' },
    node(
      'p',
      { id: scopedId('canvas-instructions'), className: 'de-canvas-instructions' },
      'Use Select to choose and move objects, Pan to move around the canvas, and the arrow keys to move a selected object.',
    ),
    stage,
    footer,
  );

  const rightTabs = node('div', {
      className: 'de-right-tabs de-panel-tabs',
      role: 'tablist',
      'aria-label': 'Right panel',
    }),
    closeProperties = button(doc, '×', 'close-properties', {
      className: 'de-panel-close',
      'aria-label': 'Close properties',
    }),
    propertiesPane = tabPanel('de-properties-pane', 'properties'),
    reviewPane = tabPanel('de-review-pane', 'review', true),
    rightContent = node('div', { className: 'de-right-content' }, propertiesPane, reviewPane);
  const right = node(
    'aside',
    {
      className: 'de-right',
      id: scopedId('inspector-panel'),
      'aria-label': 'Diagram properties and review',
    },
    node(
      'div',
      { className: 'de-panel-header' },
      node('strong', { className: 'de-panel-title' }, 'Inspector'),
      rightTabs,
      closeProperties,
    ),
    rightContent,
  );

  const work = node('div', { className: 'de-work' }, drawerBackdrop, left, stageRegion, right),
    alert = node('div', { className: 'de-alert', role: 'alert', hidden: true }),
    announcer = node('div', {
      className: 'de-announcer',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    }),
    dialogLayer = node('div', { className: 'de-dialog-layer' });
  const shell = node(
    'div',
    { className: 'planr-diagram-editor' },
    bar,
    work,
    alert,
    announcer,
    dialogLayer,
  );
  return {
    shell,
    bar,
    barStart,
    barCenter,
    barEnd,
    mark,
    title,
    subtitle,
    saveState,
    moreWrap,
    work,
    drawerBackdrop,
    left,
    leftTabs,
    closeOutline,
    outlinePane,
    shapesPane,
    stageRegion,
    stage,
    svg,
    world,
    overlays,
    empty,
    canvasTools,
    footer,
    right,
    rightTabs,
    closeProperties,
    rightContent,
    propertiesPane,
    reviewPane,
    alert,
    announcer,
    dialogLayer,
  };
}

/**
 * Add the toolbar commands, host actions, overflow menu, canvas tools and host panel panes.
 * @type {typeof import('./diagram-editor-context.d.mts').renderEditorControls}
 */
export function renderEditorControls(doc, dom, { scopedId, actions, panels }) {
  const hostPanes = new Map(
    panels.map((panel) => {
      const pane = element(doc, 'div', {
        className: 'de-host-pane de-tabpanel',
        id: scopedId(panel.id + '-pane'),
        role: 'tabpanel',
        'aria-labelledby': scopedId(panel.id + '-tab'),
        hidden: true,
      });
      dom.rightContent.append(pane);
      return [panel.id, pane];
    }),
  );
  /**
   * @param {HTMLElement} container
   * @param {string} label
   * @param {string} visible
   * @param {string} action
   * @param {{ title?: string; icon?: import('./diagram-editor.d.mts').DiagramEditorIconName; className?: string }} [options]
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
  commandButton(dom.barStart, 'Outline', 'Outline', 'outline', {
    title: 'Show or hide outline',
    icon: 'panel',
  });
  commandButton(dom.barCenter, 'Undo', '', 'undo', {
    title: 'Undo · Ctrl or Command Z',
    icon: 'undo',
  });
  commandButton(dom.barCenter, 'Redo', '', 'redo', {
    title: 'Redo · Ctrl or Command Shift Z',
    icon: 'redo',
  });
  commandButton(dom.barCenter, 'Layout', 'Arrange', 'layout', { icon: 'arrange' });
  commandButton(dom.barEnd, 'Save diagram', 'Save', 'save', {
    title: 'Save diagram · Ctrl or Command S',
    icon: 'save',
    className: 'de-primary',
  });
  for (const entry of actions) {
    const control = commandButton(dom.barEnd, entry.label, entry.label, 'host-action', {
      icon: entry.icon,
      className: entry.primary ? 'de-host-action de-primary' : 'de-host-action',
    });
    control.dataset.hostAction = entry.id;
  }
  commandButton(dom.barEnd, 'Properties', 'Inspector', 'properties', {
    title: 'Show or hide properties',
    icon: 'properties',
  });
  const moreButton = commandButton(dom.moreWrap, 'More', '', 'more', { icon: 'more' });
  moreButton.setAttribute('aria-haspopup', 'menu');
  moreButton.setAttribute('aria-expanded', 'false');
  moreButton.setAttribute('aria-controls', scopedId('more-menu'));
  const moreMenu = element(doc, 'div', {
    id: scopedId('more-menu'),
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
  dom.moreWrap.append(moreMenu);
  const toolGroup = (label) =>
    element(doc, 'div', { className: 'de-canvas-tool-group', role: 'group', 'aria-label': label });
  const canvasButton = (container, label, action, options = {}) => {
    const node = options.icon
      ? iconButton(doc, label, action, { ...options, labelClassName: 'de-control-label' })
      : button(doc, label, action, options);
    container.append(node);
    return node;
  };
  const modes = toolGroup('Interaction mode');
  canvasButton(modes, 'Select', 'select-tool', { icon: 'select', 'aria-pressed': 'true' });
  canvasButton(modes, 'Pan', 'pan-tool', { icon: 'pan', 'aria-pressed': 'false' });
  const snapping = toolGroup('Snapping');
  canvasButton(snapping, 'Snap', 'snap', { icon: 'snap', 'aria-pressed': 'false' });
  const zoomTools = toolGroup('Zoom');
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
  dom.canvasTools.append(modes, snapping, zoomTools);
  return { hostPanes, moreButton, moreMenu, zoomValue };
}
