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

const home = '[data-route-kind="planning.overview"]';
const homeRow = (id, selector, properties, options = {}) =>
  row(id, `${home} ${selector}`, properties, options.viewport).map((entry) => ({
    ...entry,
    setup: null,
    ...(options.items ? { items: options.items } : {}),
  }));
export const homeParityRows = [
  ...homeRow('H-01', 'h1', {
    'font-family': 'Outfit',
    'font-size': '28px',
    'font-weight': '700',
    'letter-spacing': '-0.56px',
  }),
  ...homeRow('H-02', '.pc-home__columns', {
    tracks: Array.from({ length: 12 }, () => '1fr').join(' '),
    'column-gap': '24px',
  }),
  ...homeRow('H-03', '.pc-home__attention', { 'grid-column-start': 'span 8' }),
  ...homeRow('H-03', '.pc-home__context', { 'grid-column-start': 'span 4' }),
  ...homeRow(
    'H-04',
    '.pc-home__attention',
    { 'text-order': 'Waiting on a dependency,In progress, gone quiet,High priority, not started' },
    { items: '.pc-card__title' },
  ),
  ...homeRow(
    'H-05',
    '.pc-home__context',
    { 'text-order': 'Changed today,Specs in flight,Active sprint' },
    { items: '.pc-card__title, .pc-home__sprint' },
  ),
  ...homeRow('H-06', '.pc-home__row', {
    height: '44px',
    'padding-left': '20px',
    'padding-right': '20px',
    'padding-top': '0px',
  }),
  ...homeRow('H-07', '.pc-home__row', { tracks: '109px 1fr auto' }),
  ...homeRow(
    'H-08',
    '.pc-home__legend',
    { 'text-order': 'Outstanding,In progress,Blocked,Addressed,Done' },
    { items: '.pc-artifact__label' },
  ),
  ...homeRow(
    'H-09',
    '.pc-home__row',
    { 'min-height': '64px', padding: '10px 16px' },
    { viewport: 'M' },
  ),
  ...homeRow('H-10', '.pc-home__card .pc-card__head', { height: '52px' }, { viewport: 'M' }),
  ...homeRow(
    'H-11',
    '.pc-home__card .pc-card__see-all',
    { 'min-height': '44px' },
    { viewport: 'M' },
  ),
];

const list = '[data-route-kind="planning.list"]';
const listRow = (id, selector, properties, options = {}) =>
  row(id, `${options.portal ? '' : `${list} `}${selector}`, properties, options.viewport).map(
    (entry) => ({
      ...entry,
      setup: options.setup ?? null,
      ...(options.items ? { items: options.items } : {}),
    }),
  );
export const listParityRows = [
  ...listRow('L-01', '.pc-list__presets [role="tab"]', {
    height: '32px',
    'border-radius': '8px',
  }),
  ...listRow('L-02', '.pc-list__presets [role="tab"][data-active]', {
    'background-color': '--op-raised',
    color: '--op-heading',
  }),
  ...listRow('L-03', '.pc-list__toolbar', { 'row-count': '1' }),
  ...listRow('L-04', '.pc-list__toolbar .pc-input', {
    width: '300px',
    height: '34px',
    'border-color': '--op-line-strong',
  }),
  ...listRow('L-05', '.pc-list__toolbar .pc-chip-menu > .pc-chip', {
    height: '32px',
    'border-radius': '999px',
  }),
  ...listRow('L-06', '.pc-list__toolbar .pc-chip[data-active="true"]', {
    'border-color': '--op-accent',
    'background-color': '--op-accent-soft',
  }),
  ...listRow('L-07', '.pc-table thead tr', { height: '40px' }),
  ...listRow('L-07', '.pc-table', { count: '1' }, { items: 'thead tr' }),
  ...listRow('L-08', '.pc-table thead th:not([data-column="select"])', {
    'font-family': 'Source Code Pro',
    'font-size': '11px',
    'font-weight': '600',
    'letter-spacing': '0.88px',
    'text-transform': 'uppercase',
  }),
  ...listRow('L-09', '.pc-table thead tr', { tracks: '40px 112px 1fr 132px 96px 200px 88px' }),
  ...listRow('L-10', '.pc-list__group-header', { height: '48px' }),
  ...listRow('L-11', '.pc-list__group-bar', { width: '120px', height: '4px' }),
  ...listRow('L-12', 'tbody tr[data-keyboard-item]', { height: '44px' }),
  ...listRow(
    'L-13',
    'tbody tr[aria-selected="true"]',
    {
      'background-color': '--op-accent-soft',
      'box-shadow': 'inset 2px 0 0 var(--op-accent)',
    },
    { setup: 'list-select' },
  ),
  ...listRow(
    'L-14',
    '.pc-list__labels > span:not(.pc-list__labels-more)',
    { height: '22px', 'border-color': '--op-line3' },
    { setup: 'list-labels' },
  ),
  ...listRow('L-15', 'tbody td[data-column="updated"]', {
    'text-align': 'right',
    'font-family': 'Source Code Pro',
    'font-size': '12px',
    'font-weight': '500',
  }),
  ...listRow('L-16', 'tbody tr[data-keyboard-item]', { height: '32px' }, { setup: 'list-compact' }),
  ...listRow(
    'L-18',
    '.pc-chip-menu__popup[data-variant="filter"]',
    { padding: '6px', 'border-radius': '10px' },
    { setup: 'list-menu', portal: true },
  ),
  ...listRow(
    'L-18',
    '.pc-chip-menu__popup[data-variant="filter"] .pc-chip-menu__option',
    { width: '240px' },
    { setup: 'list-menu', portal: true },
  ),
  ...listRow(
    'L-19',
    '.pc-chip-menu__popup[data-variant="filter"] .pc-chip-menu__option',
    { height: '36px' },
    { setup: 'list-menu', portal: true },
  ),
  ...listRow(
    'L-20',
    '.pc-list__empty-actions > button:first-child',
    { content: 'Clear 3 filters' },
    { setup: 'list-empty' },
  ),
  ...listRow('L-17', 'tbody tr[data-keyboard-item]', { height: '44px' }, { setup: 'list-coarse' }),
  ...listRow(
    'M-11',
    '.pc-list__toolbar :is(.pc-input, .pc-list__filters, .pc-chip)',
    { height: '44px' },
    { setup: 'list-T', viewport: 'T' },
  ),
  ...listRow(
    'L-25',
    'tbody tr[data-keyboard-item]',
    { height: '52px', tracks: '80px 1fr 120px 64px' },
    { setup: 'list-T', viewport: 'T' },
  ),
  ...listRow(
    'L-22',
    '.pc-list__toolbar :is(.pc-input, .pc-list__filters)',
    { height: '44px' },
    { setup: 'list-M', viewport: 'M' },
  ),
  ...listRow(
    'L-23',
    '.pc-list__presets [role="tab"]',
    { height: '36px', 'border-radius': '999px' },
    { setup: 'list-M', viewport: 'M' },
  ),
  // L-24 is a 64px minimum; rows keep one 84px pitch (two-line title box) for the row window.
  ...listRow(
    'L-24',
    'tbody tr[data-keyboard-item]',
    { height: '84px' },
    { setup: 'list-M', viewport: 'M' },
  ),
  ...listRow(
    'M-07',
    '.pc-list-sheet',
    { top: '120px', 'border-radius': '16px 16px 0 0' },
    { setup: 'list-sheet', viewport: 'M', portal: true },
  ),
  ...listRow(
    'M-08',
    '.pc-list-sheet__chip',
    { height: '40px' },
    { setup: 'list-sheet', viewport: 'M', portal: true },
  ),
  ...listRow(
    'M-09',
    '.pc-list-sheet__apply',
    { height: '48px' },
    { setup: 'list-sheet', viewport: 'M', portal: true },
  ),
];

const detail = '[data-route-kind="planning.detail"]';
const detailRow = (id, selector, properties, options = {}) =>
  row(id, `${detail} ${selector}`, properties, options.viewport).map((entry) => ({
    ...entry,
    setup: options.setup ?? 'detail-task',
    ...(options.items ? { items: options.items } : {}),
  }));
export const detailParityRows = [
  ...detailRow('DT-01', '.pc-detail__header h1', {
    'font-family': 'Outfit',
    'font-weight': '700',
    'font-size': '28px',
    'line-height': '36px',
  }),
  ...detailRow(
    'DT-02',
    '.pc-detail__trace-card',
    { 'distance-below': '24px' },
    { items: '.pc-detail__header h1' },
  ),
  ...detailRow(
    'DT-03',
    '.pc-detail__artifact',
    { count: '0' },
    { items: '.pc-detail__read-status' },
  ),
  ...detailRow('DT-04', '.pc-detail__step', {
    height: '112px',
    padding: '14px 16px',
    'border-radius': '10px',
  }),
  ...detailRow('DT-05', '.pc-detail__trace', { 'column-gap': '32px', 'no-overflow': 'true' }),
  ...detailRow('DT-06', '.pc-detail__step-title', { '-webkit-line-clamp': '2' }),
  ...detailRow('DT-07', 'li[data-current] .pc-detail__step', {
    'border-color': '--op-accent',
    'background-color': '--op-accent-soft',
  }),
  ...detailRow('DT-08', '.pc-detail__columns', {
    tracks: Array.from({ length: 12 }, () => '1fr').join(' '),
    'column-gap': '24px',
  }),
  ...detailRow('DT-08', '.pc-detail__columns > .pc-detail__stack:first-child', {
    'grid-column-start': 'span 8',
  }),
  ...detailRow('DT-08', '.pc-detail__columns > .pc-detail__stack:last-child', {
    'grid-column-start': 'span 4',
  }),
  ...detailRow('DT-09', '.pc-detail__criteria > li', {
    'min-height': '44px',
    tracks: '64px 1fr',
  }),
  ...detailRow(
    'DT-10',
    '.pc-detail__columns .pc-card[aria-label="Acceptance criteria"] .pc-detail__meta',
    { contains: 'criteria' },
  ),
  ...detailRow('DT-11', '.pc-detail__file', { 'min-height': '44px' }),
  ...detailRow('DT-12', '.pc-detail__properties > div', {
    'min-height': '40px',
    tracks: '96px 1fr',
  }),
  ...detailRow('DT-13', '.pc-detail__properties', { count: '0' }, { items: 'dd:empty' }),
  ...detailRow('DT-14', '.pc-detail__property-reference .pc-artifact-tag', {
    height: '24px',
    'border-radius': '6px',
    'font-family': 'Source Code Pro',
    'font-weight': '600',
    'font-size': '12px',
  }),
  ...detailRow('DT-15', '.pc-detail__command', {
    'font-family': 'Source Code Pro',
    'font-weight': '500',
    'font-size': '12px',
    'background-color': '--op-card',
  }),
  ...detailRow(
    'DT-16',
    '.pc-detail__properties-card',
    { count: '0' },
    { items: '.pc-detail__raw' },
  ),
  ...detailRow(
    'DT-17',
    '.pc-detail__property-reference[data-missing]',
    { 'border-top-style': 'dashed', color: '--op-warning' },
    { setup: 'detail-missing' },
  ),
  ...detailRow(
    'DT-18',
    '.pc-detail__trace',
    { 'text-order': 'Origin,This spec,Stories,Tasks' },
    { setup: 'detail-spec', items: '.pc-detail__step-role' },
  ),
  ...detailRow(
    'DT-19',
    '.pc-detail__step',
    { 'min-height': '52px', tracks: '76px 1fr' },
    { setup: 'detail-M', viewport: 'M' },
  ),
  ...detailRow(
    'DT-20',
    '.pc-detail__next-bar .pc-button',
    { height: '44px' },
    { setup: 'detail-M', viewport: 'M' },
  ),
];

const sprints = '[data-route-kind="planning.sprints"]';
const sprintRow = (id, selector, properties, options = {}) =>
  row(id, `${sprints} ${selector}`, properties, options.viewport).map((entry) => ({
    ...entry,
    setup: options.setup ?? 'sprints-active',
    ...(options.items ? { items: options.items } : {}),
  }));
const SEGMENTS = ['--op-dim', '--op-accent', '--op-info', '--op-danger'];
export const sprintsParityRows = [
  ...sprintRow('SP-01', '.pc-sprints__active-head', { height: '56px' }),
  ...sprintRow('SP-02', '.pc-sprints__stats', {
    tracks: '1fr 1fr 1fr 1fr',
    'column-gap': '24px',
  }),
  ...sprintRow('SP-02', '.pc-sprints__stat[data-goal]', { 'grid-column-start': 'span 2' }),
  ...sprintRow('SP-03', '.pc-sprints__value strong', {
    'font-family': 'Outfit',
    'font-weight': '600',
    'font-size': '24px',
  }),
  ...sprintRow('SP-04', '.pc-sprints__status-bar', {
    height: '8px',
    'border-radius': '4px',
    'column-gap': '2px',
  }),
  ...SEGMENTS.flatMap((token, index) =>
    sprintRow('SP-05', `.pc-sprints__status-bar > span:nth-child(${index + 1})`, {
      'background-color': token,
    }),
  ),
  ...sprintRow('SP-06', '.pc-sprints__tabs', { height: '48px' }),
  ...sprintRow('SP-07', '.pc-sprints__item', { height: '44px' }),
  ...sprintRow('SP-08', '.pc-sprints__last[data-kind="carried"]', {
    contains: 'carried',
    color: '--op-warning',
  }),
  ...sprintRow('SP-09', '.pc-sprints__timeline-row', { height: '40px' }),
  ...sprintRow(
    'SP-10',
    '.pc-sprints__timeline-body',
    { 'text-order': 'SPRINT-001,SPRINT-003,SPRINT-002,SPRINT-004' },
    { items: '.pc-sprints__timeline-label .pc-sprints__id' },
  ),
  ...sprintRow('SP-11', '.pc-sprints__timeline-row', { tracks: '220px 1fr 88px' }),
  ...sprintRow('SP-12', '.pc-sprints__legend', { 'row-count': '1' }),
  ...sprintRow('SP-13', '.pc-sprints__card', { height: '152px', 'grid-column-start': 'span 4' }),
  ...sprintRow('SP-14', '.pc-sprints__card-title', { '-webkit-line-clamp': '2' }),
  ...sprintRow(
    'SP-15',
    '.pc-sprints__active',
    { count: '0' },
    { setup: 'sprints-bare', items: '.pc-sprints__stat[data-goal], .pc-sprints__release' },
  ),
  ...sprintRow(
    'SP-16',
    '.pc-sprints__none .pc-sprints__command[data-variant="primary"]',
    { 'background-color': '--op-accent' },
    { setup: 'sprints-none' },
  ),
  ...sprintRow(
    'SP-17',
    '.pc-sprints__item-link',
    { 'min-height': '64px', 'padding-top': '10px', 'padding-left': '16px', 'row-gap': '6px' },
    { setup: 'sprints-M', viewport: 'M' },
  ),
  ...sprintRow(
    'SP-17',
    '.pc-sprints__item-title',
    { 'font-size': '14px', 'line-height': '20px', '-webkit-line-clamp': '2' },
    { setup: 'sprints-M', viewport: 'M' },
  ),
  ...sprintRow(
    'SP-18',
    '.pc-sprints__all',
    { height: '44px', color: '--op-accent', 'font-size': '13px' },
    { setup: 'sprints-M', viewport: 'M' },
  ),
];

const activity = '[data-route-kind="planning.activity"]';
const activityRow = (id, selector, properties, options = {}) =>
  row(id, `${activity} ${selector}`, properties, options.viewport).map((entry) => ({
    ...entry,
    setup: options.setup ?? 'activity',
    ...(options.items ? { items: options.items } : {}),
  }));
const KIND_ICONS = { created: 'plus', status: 'arrow-right', edited: 'pencil', removed: 'minus' };
export const activityParityRows = [
  ...activityRow('A-01', '.pc-activity__chart', { count: '14' }, { items: '.pc-activity__bar' }),
  ...activityRow('A-01', '.pc-activity__chart', { 'column-gap': '3px' }),
  ...activityRow('A-01', '.pc-activity__bar', { width: '8px' }),
  ...activityRow('A-02', '.pc-activity__bar[data-today]', { 'background-color': '--op-accent' }),
  ...activityRow('A-02', '.pc-activity__bar:not([data-today])', {
    'background-color': '--op-line3',
  }),
  ...activityRow('A-03', '.pc-activity__kinds .pc-tabs__tab', {
    height: '26px',
    'border-radius': '7px',
  }),
  ...activityRow('A-04', '.pc-activity__main', { 'grid-column-start': 'span 8' }),
  ...activityRow('A-04', '.pc-activity__side', { 'grid-column-start': 'span 4' }),
  ...activityRow(
    'A-05',
    '.pc-activity__day:first-child .pc-activity__row:first-child',
    { 'distance-below': '64px' },
    { items: `${activity} .pc-activity__filters` },
  ),
  ...activityRow('A-06', '.pc-activity__day-head', {
    height: '40px',
    'border-bottom-width': '1px',
    'border-bottom-color': '--op-line',
  }),
  ...activityRow('A-07', '.pc-activity__row', { height: '44px' }),
  ...activityRow('A-07', '.pc-activity__cells', { tracks: '20px 92px 1fr 200px 56px' }),
  ...activityRow(
    'A-08',
    '.pc-activity__feed',
    { 'space-below': '0px' },
    { items: '.pc-activity__row' },
  ),
  ...activityRow(
    'A-09',
    '.pc-activity__connection > .pc-badge',
    { 'right-inset': '20px' },
    { items: '.pc-activity__live .pc-card' },
  ),
  ...activityRow('A-10', '.pc-activity__live-row', { 'min-height': '56px' }),
  ...activityRow('A-11', '.pc-activity__busiest-row', {
    height: '44px',
    tracks: '76px 1fr 64px 32px',
  }),
  ...Object.entries(KIND_ICONS).flatMap(([kind, icon]) =>
    activityRow('A-12', `.pc-activity__kind[data-kind="${kind}"] .pc-icon`, { 'data-icon': icon }),
  ),
  ...activityRow('A-13', '.pc-activity__row[data-gone] .pc-activity__struck', {
    'text-decoration-line': 'line-through',
  }),
  ...activityRow(
    'A-13',
    '.pc-activity__row[data-gone]',
    { count: '0' },
    { items: 'a, [data-keyboard-item]' },
  ),
  ...activityRow(
    'A-14',
    '.pc-activity__body',
    { count: '0' },
    { items: '.pc-activity__explanation, .pc-activity__footnote' },
  ),
  ...activityRow(
    'A-15',
    ':is(.pc-activity__kinds .pc-tabs__tab, .pc-activity__more)',
    { height: '36px', 'border-radius': '999px', 'padding-left': '12px' },
    { setup: 'activity-M', viewport: 'M' },
  ),
  ...activityRow(
    'A-16',
    '.pc-activity__row',
    { height: '64px', 'border-bottom-color': '--op-line' },
    { setup: 'activity-M', viewport: 'M' },
  ),
  ...activityRow(
    'A-16',
    '.pc-activity__cells',
    { 'padding-top': '10px', 'padding-left': '16px', 'left-distance': '0px' },
    { setup: 'activity-M', viewport: 'M' },
  ),
  ...activityRow(
    'A-16',
    '.pc-activity__day-head',
    { height: '42px', 'background-color': '--op-panel', 'left-distance': '0px' },
    { setup: 'activity-M', viewport: 'M' },
  ),
  ...activityRow(
    'A-16',
    ':is(.pc-activity__side, .pc-activity__chart)',
    { display: 'none' },
    { setup: 'activity-M', viewport: 'M' },
  ),
];

const palette = 'dialog.pc-palette';
const paletteRow = (id, selector, properties, options = {}) =>
  row(id, `${palette} ${selector}`, properties, options.viewport).map((entry) => ({
    ...entry,
    setup: options.setup ?? 'palette',
    ...(options.items ? { items: options.items } : {}),
  }));
export const paletteParityRows = [
  ...paletteRow('P-01', '.pc-palette__panel', {
    width: '960px',
    'border-top-left-radius': '16px',
    'top-distance': '96px',
    'left-distance': '240px',
    'border-top-color': '--op-line3',
    'background-color': '--op-panel',
  }),
  ...paletteRow('P-02', '.pc-palette__panel', { 'max-height': '600px' }),
  ...paletteRow('P-03', '.pc-palette__input-row', {
    height: '56px',
    'border-bottom-width': '1px',
    'border-bottom-color': '--op-line',
  }),
  ...paletteRow('P-04', '.pc-palette__input', {
    'font-size': '16px',
    'font-weight': '400',
    'font-family': 'DM Sans Variable',
  }),
  ...paletteRow('P-04', '.pc-palette__input-row .pc-kbd', {
    height: '17px',
    'border-top-left-radius': '5px',
    'font-family': 'Source Code Pro',
    'font-size': '11px',
    'font-weight': '600',
  }),
  ...paletteRow('P-05', '.pc-palette__scopes', { height: '44px' }),
  ...paletteRow('P-05', '.pc-palette__scope', {
    height: '28px',
    'border-top-left-radius': '7px',
    'font-size': '12px',
    'font-weight': '500',
  }),
  ...paletteRow('P-05', '.pc-palette__scope[aria-pressed="true"]', {
    'background-color': '--op-raised',
    color: '--op-heading',
  }),
  ...paletteRow('P-06', '.pc-palette__group-title', {
    height: '28px',
    'font-family': 'Source Code Pro',
    'font-weight': '600',
    'font-size': '11px',
    'text-transform': 'uppercase',
    color: '--op-dim',
  }),
  ...paletteRow('P-07', '.pc-palette__result', { height: '44px', 'border-top-left-radius': '8px' }),
  ...paletteRow('P-07', '.pc-palette__id', {
    width: '76px',
    'font-family': 'Source Code Pro',
    'font-size': '12px',
  }),
  ...paletteRow('P-07', '.pc-palette__title', { 'font-size': '14px', color: '--op-heading' }),
  ...paletteRow('P-08', '.pc-palette__result[data-selected="true"]', {
    '--palette-row-fill': '--op-raised',
    'background-color': 'transparent',
  }),
  ...paletteRow('P-08', '.pc-palette__result[data-selected="true"] .pc-palette__row', {
    'background-color': 'transparent',
  }),
  ...paletteRow('P-09', '.pc-palette__preview', {
    width: '360px',
    'padding-top': '20px',
    'padding-left': '20px',
    'row-gap': '14px',
  }),
  ...paletteRow('P-09', '.pc-palette__command-copy', {
    height: '40px',
    'border-top-left-radius': '8px',
    'background-color': '--op-card',
  }),
  ...paletteRow('P-10', '.pc-palette__foot', { height: '44px', 'border-top-width': '1px' }),
  ...paletteRow(
    'P-11',
    '.pc-palette__results',
    { 'text-order': 'Recent,Go to' },
    { setup: 'palette-open', items: '.pc-palette__group-title' },
  ),
  ...paletteRow(
    'P-12',
    '.pc-palette__panel',
    { count: '0' },
    { setup: 'palette-empty', items: '.pc-palette__preview' },
  ),
  ...paletteRow(
    'P-12',
    '.pc-palette__empty-title',
    { contains: 'Nothing matches' },
    { setup: 'palette-empty' },
  ),
  ...paletteRow('P-13', '.pc-palette__match', {
    'background-color': 'color-mix(in srgb, var(--op-accent) 18%, transparent)',
  }),
  ...paletteRow(
    'P-14',
    '.pc-palette__group[aria-busy="true"]',
    { contains: 'Operate|searching…' },
    { setup: 'palette-operate' },
  ),
];

function sampleRows(nodes, { property, expected, items }) {
  return nodes.map((node) => {
    if (property === 'text')
      return { actual: node.querySelector('[data-active="true"]')?.textContent, expected };
    if (property === 'text-order')
      return {
        actual: [...node.querySelectorAll(items ?? '.pc-status-board__name')]
          .map((entry) => entry.getAttribute('aria-label') ?? entry.textContent)
          .join(','),
        expected,
      };
    if (property === 'content') return { actual: node.textContent?.trim(), expected };
    if (property === 'count')
      return { actual: String(node.querySelectorAll(items).length), expected };
    if (property === 'row-count') {
      const tops = [...node.children]
        .filter((child) => child.getBoundingClientRect().width > 0)
        .map((child) => {
          const box = child.getBoundingClientRect();
          return box.top + box.height / 2;
        });
      const rows = tops.filter(
        (top, index) => tops.findIndex((other) => Math.abs(other - top) <= 4) === index,
      );
      return { actual: String(rows.length), expected };
    }
    if (property === 'distance-below') {
      const reference = document.querySelector(items);
      return {
        actual: node.getBoundingClientRect().top - (reference?.getBoundingClientRect().bottom ?? 0),
        expected: parseFloat(expected),
      };
    }
    if (property === 'space-below') {
      const last = [...node.querySelectorAll(items)].at(-1);
      return {
        actual: node.getBoundingClientRect().bottom - (last?.getBoundingClientRect().bottom ?? 0),
        expected: parseFloat(expected),
      };
    }
    if (property === 'right-inset')
      return {
        actual:
          (node.closest(items)?.getBoundingClientRect().right ?? 0) -
          node.getBoundingClientRect().right,
        expected: parseFloat(expected),
      };
    if (property === 'no-overflow')
      return { actual: String(node.scrollWidth <= node.clientWidth), expected };
    if (property === 'contains') {
      const text = node.textContent ?? '';
      return { actual: expected.split('|').every((part) => text.includes(part)), expected: true };
    }
    if (property === 'tracks') {
      const actual = getComputedStyle(node).gridTemplateColumns.split(' ').map(parseFloat);
      const fixed = expected
        .split(' ')
        .map((track) =>
          track.endsWith('px') ? parseFloat(track) : track === 'auto' ? track : null,
        );
      const flexible = actual.filter((_, index) => fixed[index] === null);
      const matches =
        actual.length === fixed.length &&
        actual.every(
          (track, index) =>
            fixed[index] === null || fixed[index] === 'auto' || Math.abs(track - fixed[index]) <= 2,
        ) &&
        flexible.every((track) => Math.abs(track - flexible[0]) <= 2);
      return { actual: matches ? expected : actual.join(' '), expected };
    }
    if (['role', 'aria-live', 'data-icon'].includes(property))
      return { actual: node.getAttribute(property), expected };
    const rect = node.getBoundingClientRect();
    const distances = {
      'top-distance': rect.top,
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
  const samples = await elements.evaluateAll(sampleRows, {
    property: entry.property,
    expected,
    items: entry.items,
  });
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
