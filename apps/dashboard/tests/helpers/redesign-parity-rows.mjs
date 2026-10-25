import { readFileSync } from 'node:fs';

const tokens = readFileSync(new URL('../../src/design-system/tokens.css', import.meta.url), 'utf8');
const declarations = (selector) => {
  const start = tokens.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Token selector ${selector} is missing`);
  return Object.fromEntries(
    [
      ...tokens.slice(start, tokens.indexOf('}', start)).matchAll(/(--op-[\w-]+):\s*([^;]+);/gu),
    ].map((match) => [match[1], match[2]]),
  );
};
export function resolveParityToken(value, theme) {
  const values = {
    ...declarations(':root'),
    ...(theme === 'light' ? declarations(':root[data-theme="light"]') : {}),
  };
  const resolve = (input, seen = []) =>
    input.replace(/var\((--op-[\w-]+)\)|^(--op-[\w-]+)$/gu, (_, nested, direct) => {
      const name = nested ?? direct;
      if (!values[name] || seen.includes(name))
        throw new Error(`Cannot resolve ${name} for ${theme}`);
      return resolve(values[name], [...seen, name]);
    });
  return resolve(value);
}
const bar = '.pc-selection-bar';
const copy = `${bar} .pc-selection-bar__copy`;
const fixture = '[data-redesign-fixture]';
const row = (id, selector, properties, viewport = 'D') =>
  Object.entries(properties).map(([property, expected]) => ({
    id,
    selector,
    property,
    expected,
    viewport,
    theme: 'both',
  }));
// S-20 to S-22 require route adoption and are checked in later screen work.
export const redesignParityRows = [
  ...row('S-01', bar, { height: '56px' }),
  ...row('S-02', bar, { 'border-radius': '--op-radius-surface' }),
  ...row('S-03', bar, { 'background-color': '--op-raised' }),
  ...row('S-04', bar, { 'border-color': '--op-line3' }),
  ...row('S-05', bar, { 'bottom-distance': '24px' }),
  ...row('S-06', bar, { width: 'min(800px, content - 128px)' }),
  ...row('S-07', copy, { height: '40px', 'background-color': '--op-accent' }),
  ...row('S-08', `${bar} .pc-selection-bar__command`, {
    'font-family': 'Source Code Pro',
    'font-size': '12px',
    color: '--op-body',
  }),
  ...row('S-09', `${bar} .pc-selection-bar__title`, {
    'max-width': '260px',
    'text-overflow': 'ellipsis',
  }),
  ...row(
    'S-10',
    bar,
    { 'left-distance': '8px', 'right-distance': '8px', 'bottom-distance': '72px' },
    'M',
  ),
  ...row('S-11', `${bar} button`, { 'min-height': '44px' }, 'M'),
  ...row('S-12', copy, {
    text: 'Copy 3 commands',
    clipboard: 'fixture commands joined by newline',
  }),
  ...row('S-13', `${fixture} .pc-card__header`, {
    height: '56px',
    'border-bottom-width': '1px',
    'border-bottom-style': 'solid',
    'border-bottom-color': '--op-line',
  }),
  ...row('S-14', `${fixture} .pc-card`, {
    'border-radius': '--op-radius-surface',
    'background-color': '--op-panel',
  }),
  ...row('S-15', `${fixture} .pc-card h2`, {
    'font-family': 'DM Sans Variable',
    'font-size': '15px',
    'font-weight': '600',
    color: '--op-heading',
  }),
  ...row('S-16', `${fixture} [data-redesign-tags] .pc-artifact-row__id`, {
    height: '22px',
    'padding-top': '0px',
    'padding-bottom': '0px',
    'padding-left': '7px',
    'padding-right': '7px',
    'border-radius': '--op-radius-tag',
  }),
  ...row('S-17', `${fixture} [data-redesign-tags] [data-type="t"]`, {
    color: '--op-type-t',
    'background-color': '--op-type-t-bg-panel',
  }),
  ...row('S-18', `${fixture} [aria-pressed="true"]`, {
    'background-color': '--op-raised',
    color: '--op-heading',
  }),
  ...row('S-19', `${fixture} [aria-pressed="false"]`, {
    'background-color': 'transparent',
    color: '--op-muted',
  }),
  ...row('S-23', `${fixture} .pc-state-empty h2`, {
    'font-family': 'DM Sans Variable',
    'font-size': '15px',
    'font-weight': '600',
    color: '--op-heading',
  }),
  ...row('S-24', `${fixture} .pc-state-error`, {
    role: 'alert',
    'border-color': 'color-mix(in srgb, var(--op-danger) 45%, transparent)',
  }),
  ...row('S-25', copy, { 'text-after-copy': 'Copied' }),
  ...row('S-25', `${bar} [aria-live]`, { 'aria-live': 'polite' }),
];
