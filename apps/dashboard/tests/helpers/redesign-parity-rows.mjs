import assert from 'node:assert/strict';
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

const board = '[data-route-kind="planning.board"]';
const boardRow = (id, selector, properties, options = {}) =>
  row(id, `${board} ${selector}`, properties, options.viewport).map((entry) => ({
    ...entry,
    setup: options.setup ?? null,
  }));
const STATUSES = ['outstanding', 'in-progress', 'blocked', 'addressed', 'done'];
export const boardParityRows = [
  ...boardRow('B-01', '.pc-status-board__header h1', {
    'font-family': 'Outfit',
    'font-size': '22px',
    'font-weight': '700',
    color: '--op-heading',
  }),
  ...boardRow('B-02', '.pc-status-board__toggle', {
    padding: '3px',
    'border-radius': '10px',
    'border-color': '--op-line3',
  }),
  ...boardRow('B-03', '.pc-status-board__toggle button', {
    height: '28px',
    'border-radius': '7px',
  }),
  ...boardRow('S-18', '.pc-status-board__toggle [aria-pressed="true"]', {
    'background-color': '--op-raised',
    color: '--op-heading',
  }),
  ...boardRow('S-19', '.pc-status-board__toggle [aria-pressed="false"]', {
    'background-color': 'transparent',
    color: '--op-muted',
  }),
  ...boardRow('B-04', '.pc-status-board__columns', { tracks: '1fr 1fr 1fr 1fr 168px' }),
  ...boardRow('B-05', '.pc-status-board__columns', { 'column-gap': '16px', padding: '16px 32px' }),
  ...boardRow('B-06', '.pc-status-board__columns', {
    'text-order': 'Outstanding,In progress,Blocked,Addressed,Done',
  }),
  ...boardRow('B-07', '.pc-status-board__head-row', { height: '32px' }),
  ...boardRow('B-08', '.pc-status-board__share', { height: '2px' }),
  ...STATUSES.flatMap((status) =>
    boardRow('B-08', `.pc-status-board__share > [data-status="${status}"]`, {
      'background-color': `--op-status-${status}-fg`,
    }),
  ),
  ...boardRow('B-09', '.pc-status-board__card', {
    padding: '12px',
    'border-radius': '10px',
    'background-color': '--op-card',
  }),
  ...boardRow('B-10', '.pc-status-board__title', {
    'font-size': '13.5px',
    'line-height': '19px',
    '-webkit-line-clamp': '2',
  }),
  ...boardRow(
    'B-11',
    '.pc-status-board__card[data-selected="true"]',
    { 'border-color': '--op-accent' },
    { setup: 'select' },
  ),
  ...boardRow('B-12', '.pc-status-board__done-summary', {
    contains: 'done and hidden|Show done',
  }),
  ...boardRow(
    'B-13',
    '.pc-status-board__lane',
    { tracks: '280px 1fr 1fr 1fr 1fr' },
    { setup: 'lanes' },
  ),
  ...boardRow('B-14', '.pc-status-board__lanes-head', { height: '40px' }, { setup: 'lanes' }),
  ...boardRow(
    'B-15',
    '.pc-status-board__lane',
    {
      'padding-top': '16px',
      'padding-bottom': '16px',
      'border-bottom-width': '1px',
      'border-bottom-color': '--op-line',
    },
    { setup: 'lanes' },
  ),
  ...boardRow(
    'B-16',
    '.pc-status-board__progress > span',
    { width: '96px', height: '4px' },
    { setup: 'lanes' },
  ),
  ...boardRow(
    'B-17',
    '.pc-status-board__tabs .pc-tabs__tab',
    { height: '36px' },
    { viewport: 'M' },
  ),
  ...boardRow('B-18', '.pc-status-board__card', { 'min-height': '44px' }, { viewport: 'M' }),
];

function sampleRows(nodes, { property, expected }) {
  return nodes.map((node) => {
    if (property === 'text')
      return { actual: node.querySelector('[data-active="true"]')?.textContent, expected };
    if (property === 'text-order')
      return {
        actual: [...node.querySelectorAll('.pc-status-board__name')]
          .map((entry) => entry.textContent)
          .join(','),
        expected,
      };
    if (property === 'contains') {
      const text = node.textContent ?? '';
      return { actual: expected.split('|').every((part) => text.includes(part)), expected: true };
    }
    if (property === 'tracks') {
      const actual = getComputedStyle(node).gridTemplateColumns.split(' ').map(parseFloat);
      const fixed = expected
        .split(' ')
        .map((track) => (track.endsWith('px') ? parseFloat(track) : null));
      const flexible = actual.filter((_, index) => fixed[index] === null);
      const matches =
        actual.length === fixed.length &&
        actual.every(
          (track, index) => fixed[index] === null || Math.abs(track - fixed[index]) <= 2,
        ) &&
        flexible.every((track) => Math.abs(track - flexible[0]) <= 2);
      return { actual: matches ? expected : actual.join(' '), expected };
    }
    if (['role', 'aria-live'].includes(property))
      return { actual: node.getAttribute(property), expected };
    const rect = node.getBoundingClientRect();
    const distances = {
      'bottom-distance': innerHeight - rect.bottom,
      'left-distance': rect.left,
      'right-distance': innerWidth - rect.right,
    };
    if (property in distances)
      return { actual: distances[property], expected: parseFloat(expected) };
    if (expected.startsWith('min('))
      return {
        actual: rect.width,
        expected: Math.min(800, node.parentElement.getBoundingClientRect().width - 128),
      };
    const probe = document.createElement('span');
    probe.style.setProperty(property, expected);
    document.body.append(probe);
    const resolved = getComputedStyle(probe).getPropertyValue(property);
    const actual = getComputedStyle(node).getPropertyValue(property);
    probe.remove();
    if (property === 'font-family')
      return { actual: actual.split(',')[0].replaceAll('"', ''), expected };
    return { actual, expected: resolved };
  });
}

/** Asserts one parity row against every element its selector matches; lengths allow 2px. */
export async function assertParityRow(page, entry, theme) {
  const expected = resolveParityToken(entry.expected, theme);
  const elements = page.locator(entry.selector);
  assert((await elements.count()) > 0, `${entry.id}: missing ${entry.selector}`);
  const samples = await elements.evaluateAll(sampleRows, { property: entry.property, expected });
  for (const sample of samples) {
    const label = `${entry.id} ${theme} ${entry.viewport} ${entry.property}: ${JSON.stringify(sample)}`;
    if (typeof sample.actual === 'number' || /^-?[\d.]+px$/u.test(sample.expected))
      assert(Math.abs(parseFloat(sample.actual) - parseFloat(sample.expected)) <= 2, label);
    else assert.equal(sample.actual, sample.expected, label);
  }
  return samples.map((sample) => ({
    id: entry.id,
    theme,
    viewport: entry.viewport,
    property: entry.property,
    ...sample,
  }));
}
