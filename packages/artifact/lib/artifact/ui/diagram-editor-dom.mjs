// @ts-check
/** Small DOM helpers keep authored labels out of HTML strings. */
const SVG = 'http://www.w3.org/2000/svg';

/** @typedef {import('./diagram-editor.d.mts').DiagramEditorIconName} DiagramEditorIconName */
/** @typedef {[string, Record<string, string | number>]} IconPrimitive */

const ICONS = Object.freeze(
  /** @satisfies {Record<DiagramEditorIconName, IconPrimitive[]>} */ ({
    panel: [['path', { d: 'M4 4h16v16H4zM9 4v16' }]],
    undo: [['path', { d: 'M9 7H4v-5M4 7l4-4M4 7h9a7 7 0 1 1-6.1 10.4' }]],
    redo: [['path', { d: 'M15 7h5v-5M20 7l-4-4M20 7h-9a7 7 0 1 0 6.1 10.4' }]],
    save: [['path', { d: 'M5 3h12l3 3v15H4V3zM8 3v6h8V3M8 21v-7h8v7' }]],
    more: [
      ['circle', { cx: 5, cy: 12, r: 1.4 }],
      ['circle', { cx: 12, cy: 12, r: 1.4 }],
      ['circle', { cx: 19, cy: 12, r: 1.4 }],
    ],
    select: [['path', { d: 'M5 3l13 9-6 1.5L9 20z' }]],
    pan: [
      [
        'path',
        {
          d: 'M8 11V6a2 2 0 0 1 4 0v4-6a2 2 0 0 1 4 0v6-4a2 2 0 0 1 4 0v7c0 5-3 8-8 8h-1c-3 0-5-1.5-7-4l-2-3a2 2 0 0 1 3-2z',
        },
      ],
    ],
    snap: [['path', { d: 'M5 4v7a7 7 0 0 0 14 0V4M5 8h4M15 8h4M5 4h4v4H5zM15 4h4v4h-4z' }]],
    fit: [['path', { d: 'M9 4H4v5M15 4h5v5M20 15v5h-5M9 20H4v-5' }]],
    search: [
      ['circle', { cx: 10.5, cy: 10.5, r: 6.5 }],
      ['path', { d: 'M15.5 15.5L21 21' }],
    ],
    properties: [
      ['path', { d: 'M4 6h7M15 6h5M4 12h3M11 12h9M4 18h9M17 18h3' }],
      ['circle', { cx: 13, cy: 6, r: 2 }],
      ['circle', { cx: 9, cy: 12, r: 2 }],
      ['circle', { cx: 15, cy: 18, r: 2 }],
    ],
    review: [['path', { d: 'M4 5h16v12H9l-5 4z' }]],
    copy: [
      ['rect', { x: 8, y: 8, width: 11, height: 11, rx: 2 }],
      ['path', { d: 'M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3' }],
    ],
    duplicate: [
      ['rect', { x: 8, y: 8, width: 11, height: 11, rx: 2 }],
      ['rect', { x: 3, y: 3, width: 11, height: 11, rx: 2 }],
      ['path', { d: 'M11 6v5M8.5 8.5h5' }],
    ],
    lock: [
      ['rect', { x: 5, y: 10, width: 14, height: 11, rx: 2 }],
      ['path', { d: 'M8 10V7a4 4 0 0 1 8 0v3' }],
    ],
    unlock: [
      ['rect', { x: 5, y: 10, width: 14, height: 11, rx: 2 }],
      ['path', { d: 'M16 10V7a4 4 0 0 0-7.5-2' }],
    ],
    trash: [['path', { d: 'M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6' }]],
    arrange: [
      ['rect', { x: 3, y: 4, width: 7, height: 6, rx: 1 }],
      ['rect', { x: 14, y: 4, width: 7, height: 6, rx: 1 }],
      ['rect', { x: 8.5, y: 14, width: 7, height: 6, rx: 1 }],
    ],
    group: [
      ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2, 'stroke-dasharray': '3 2' }],
      ['rect', { x: 6, y: 7, width: 5, height: 5, rx: 1 }],
      ['rect', { x: 13, y: 12, width: 5, height: 5, rx: 1 }],
    ],
    ungroup: [
      ['rect', { x: 3, y: 3, width: 8, height: 8, rx: 1 }],
      ['rect', { x: 13, y: 13, width: 8, height: 8, rx: 1 }],
      ['path', { d: 'M13 7h4v4M11 17H7v-4' }],
    ],
    connect: [
      ['circle', { cx: 6, cy: 12, r: 3 }],
      ['circle', { cx: 18, cy: 12, r: 3 }],
      ['path', { d: 'M9 12h6' }],
    ],
    parent: [
      ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
      ['path', { d: 'M7 8h10v8H7z' }],
    ],
    route: [['path', { d: 'M4 5h6v6h4v8h6M4 5l3-3M4 5l3 3M20 19l-3-3M20 19l-3 3' }]],
    content: [['path', { d: 'M6 4h12M6 9h12M6 14h8M6 19h10' }]],
    geometry: [
      ['rect', { x: 4, y: 4, width: 16, height: 16, rx: 2 }],
      ['path', { d: 'M8 4v4H4M16 4v4h4M8 20v-4H4M16 20v-4h4' }],
    ],
    appearance: [
      [
        'path',
        {
          d: 'M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a2 2 0 0 1 0-4h5a4 4 0 0 0 0-8z',
        },
      ],
      ['circle', { cx: 7.5, cy: 9, r: 1 }],
      ['circle', { cx: 10, cy: 6.5, r: 1 }],
    ],
    structure: [
      ['path', { d: 'M12 4v5M6 20v-5h12v5M6 15v-3h12v3' }],
      ['rect', { x: 9, y: 2, width: 6, height: 4, rx: 1 }],
      ['rect', { x: 3, y: 18, width: 6, height: 4, rx: 1 }],
      ['rect', { x: 15, y: 18, width: 6, height: 4, rx: 1 }],
    ],
    constraints: [
      ['path', { d: 'M7 4H4v3M17 4h3v3M20 17v3h-3M7 20H4v-3' }],
      ['rect', { x: 8, y: 9, width: 8, height: 7, rx: 1 }],
      ['path', { d: 'M10 9V7a2 2 0 0 1 4 0v2' }],
    ],
    advanced: [
      ['circle', { cx: 12, cy: 12, r: 3 }],
      [
        'path',
        {
          d: 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
        },
      ],
    ],
    plus: [['path', { d: 'M12 5v14M5 12h14' }]],
    'arrow-up': [['path', { d: 'M12 20V4M6 10l6-6 6 6' }]],
    'arrow-down': [['path', { d: 'M12 4v16M6 14l6 6 6-6' }]],
    mark: [
      ['path', { d: 'M18 5a9 9 0 1 0 3 7' }],
      ['circle', { cx: 20, cy: 5, r: 1.6 }],
    ],
    chevron: [['path', { d: 'm9 18 6-6-6-6' }]],
    share: [['path', { d: 'M4 12v7h16v-7M16 6l-4-4-4 4M12 2v13' }]],
    history: [['path', { d: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2' }]],
    'kind-container': [
      ['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2, 'stroke-dasharray': '3 2' }],
    ],
    'kind-lane': [
      ['rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }],
      ['path', { d: 'M3 10h18' }],
    ],
    'kind-lane-vertical': [
      ['rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }],
      ['path', { d: 'M9 5v14' }],
    ],
    'kind-terminal': [['rect', { x: 3, y: 8, width: 18, height: 8, rx: 4 }]],
    'kind-process': [['rect', { x: 3, y: 7, width: 18, height: 10, rx: 2 }]],
    'kind-decision': [['path', { d: 'M12 3 21 12 12 21 3 12z' }]],
    'kind-store': [['path', { d: 'M7 7h14l-4 10H3z' }]],
    'kind-component': [
      ['rect', { x: 6, y: 4, width: 14, height: 16, rx: 2 }],
      ['path', { d: 'M3 8h6M3 16h6' }],
    ],
    'kind-connector': [['path', { d: 'M5 19 19 5M12 5h7v7' }]],
    'kind-annotation': [['path', { d: 'M5 6h14M12 6v12' }]],
  }),
);

export function element(document, tag, attributes = {}, text) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'className') node.className = value;
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}
/** Editor-dispatched control; a null action leaves the button to its own click handler. */
export function button(document, text, action, options = {}) {
  return element(document, 'button', { type: 'button', 'data-action': action, ...options }, text);
}

/** Whether the editor icon set includes this name. */
export const hasIcon = (name) => Object.hasOwn(ICONS, name);

/**
 * Render a dependency-free icon from static SVG primitives.
 * @param {Document} document
 * @param {string} name
 * @param {{ size?: number; className?: string; label?: string }} [options]
 */
export function icon(document, name, { size = 16, className = 'de-icon', label } = {}) {
  const definition = ICONS[name];
  if (!definition) throw new Error(`Unknown editor icon: ${name}`);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', className);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('focusable', 'false');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attributes] of definition) {
    const primitive = document.createElementNS(SVG, tag);
    for (const [attribute, value] of Object.entries(attributes))
      primitive.setAttribute(attribute, String(value));
    svg.append(primitive);
  }
  return svg;
}

/**
 * Create an accessible editor button with a static icon and optional visible label.
 * @param {Document} document
 * @param {string} label
 * @param {string} action
 * @param {{
 *   icon?: DiagramEditorIconName;
 *   iconOnly?: boolean;
 *   labelClassName?: string;
 *   [attribute: string]: unknown;
 * }} [options]
 */
export function iconButton(document, label, action, options = {}) {
  const {
    icon: iconName,
    iconOnly = false,
    labelClassName = 'de-control-label',
    ...attributes
  } = options;
  const control = element(document, 'button', {
    type: 'button',
    'data-action': action,
    'aria-label': label,
    ...attributes,
  });
  if (iconName) control.append(icon(document, iconName));
  if (!iconOnly) control.append(element(document, 'span', { className: labelClassName }, label));
  return control;
}
/**
 * @param {Document} document
 * @param {string} name
 * @param {unknown} value
 * @param {{
 *   type?: string;
 *   choices?: Array<string | [string, string]>;
 *   multiline?: boolean;
 *   [attribute: string]: unknown;
 * }} [options]
 */
export function field(
  document,
  name,
  value,
  { type = 'text', choices, multiline = false, ...attributes } = {},
) {
  const label = element(document, 'label', { className: 'de-field' });
  label.append(element(document, 'span', {}, name));
  const input = element(document, choices ? 'select' : multiline ? 'textarea' : 'input', {
    'aria-label': name,
    ...(!choices && !multiline ? { type } : {}),
    ...attributes,
  });
  if (choices)
    for (const choice of choices) {
      const [id, title] = Array.isArray(choice) ? choice : [choice, choice];
      input.append(element(document, 'option', { value: id }, title));
    }
  if (type === 'checkbox') input.checked = value === true;
  else input.value = value ?? '';
  label.append(input);
  return { label, input };
}
export function downloadJson(document, value, filename) {
  const window = document.defaultView;
  const url = window.URL.createObjectURL(
    new window.Blob([JSON.stringify(value, null, 2)], {
      type: 'application/json',
    }),
  );
  const link = element(document, 'a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
