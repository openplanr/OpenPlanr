// @vitest-environment jsdom

import { runInNewContext } from 'node:vm';
import { afterEach, expect, it } from 'vitest';
import { installDashboardLayoutShifts } from './dashboard-layout-shifts.js';
import { aggregateDashboardLayoutShifts } from './dashboard-trace-model.js';

type Entry = PerformanceEntry & {
  value: number;
  hadRecentInput: boolean;
  sources?: { node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[];
};

function harness() {
  let now = 0;
  let deliver!: (entries: Entry[]) => void;
  let pending: Entry[] = [];
  const observations: unknown[] = [];
  const target = {} as Window;
  class Observer {
    constructor(callback: (list: { getEntries: () => Entry[] }) => void) {
      deliver = (entries) => callback({ getEntries: () => entries });
    }
    observe(options: unknown) {
      observations.push(options);
    }
    takeRecords() {
      const records = pending;
      pending = [];
      return records;
    }
  }
  runInNewContext(`(${installDashboardLayoutShifts.toString()})()`, {
    window: target,
    performance: { now: () => now },
    PerformanceObserver: Observer,
  });
  return {
    api: target.__dashboardLayoutShifts,
    observations,
    deliver: (entries: Entry[]) => deliver(entries),
    queue: (entries: Entry[]) => {
      pending.push(...entries);
    },
    mark: (phase: string, time: number) => {
      now = time;
      target.__dashboardLayoutShifts.markPhase(phase);
    },
    input: (time: number) => {
      now = time;
      target.__dashboardLayoutShifts.markInputAction();
    },
  };
}

function entry(startTime: number, hadRecentInput = false, sources: Entry['sources'] = []): Entry {
  return {
    name: '',
    entryType: 'layout-shift',
    startTime,
    duration: 0,
    value: 0.125,
    hadRecentInput,
    sources,
    toJSON: () => ({}),
  };
}

afterEach(() => document.body.replaceChildren());

it('runs after standalone serialization and assigns delayed entries by their start time', () => {
  const recorder = harness();
  expect(recorder.observations).toEqual([{ type: 'layout-shift', buffered: true }]);
  recorder.mark('filter-input 1', 10);
  recorder.input(11);
  recorder.mark('palette open', 20);
  recorder.mark('inspector 1', 30);
  recorder.mark('patch 1', 40);
  recorder.mark('pan-scroll list', 50);
  recorder.deliver([entry(45), entry(5), entry(15, true), entry(20), entry(35)]);
  recorder.queue([entry(55)]);
  const report = recorder.api.snapshot();
  expect(
    report.shifts.map(({ startTime, phase, hadRecentInput }) => ({
      startTime,
      phase,
      hadRecentInput,
    })),
  ).toEqual([
    { startTime: 5, phase: 'route-load', hadRecentInput: false },
    { startTime: 15, phase: 'filter-input 1', hadRecentInput: true },
    { startTime: 20, phase: 'palette open', hadRecentInput: false },
    { startTime: 35, phase: 'inspector 1', hadRecentInput: false },
    { startTime: 45, phase: 'patch 1', hadRecentInput: false },
    { startTime: 55, phase: 'pan-scroll list', hadRecentInput: false },
  ]);
  expect(report.phases).toHaveLength(6);
  expect(report.inputActions).toEqual([{ phase: 'filter-input 1', phaseIndex: 1, startTime: 11 }]);
  expect(aggregateDashboardLayoutShifts(report).admittedCls).toBe(0.625);
  expect(aggregateDashboardLayoutShifts(report).shifts[1]).toMatchObject({
    startTime: 15,
    phase: 'filter-input 1',
    hadRecentInput: true,
    inputDriven: true,
    reason: 'native-excluded',
  });
  expect(recorder.api.snapshot().shifts).toHaveLength(6);
  expect(report.shifts.every((shift) => shift.value === 0.125)).toBe(true);
});

it('records stable keyed selectors, text parents and plain source rectangles', () => {
  const recorder = harness();
  document.body.innerHTML =
    '<main id="work"><table><tbody><tr data-keyboard-item="T-19"><td>Changed title</td></tr></tbody></table></main>';
  const cell = document.querySelector('td');
  if (!cell) throw new Error('Missing source cell.');
  const previousRect = new DOMRect(1, 2, 30, 40);
  const currentRect = new DOMRect(5, 6, 30, 40);
  recorder.deliver([entry(1, false, [{ node: cell.firstChild, previousRect, currentRect }])]);
  const source = recorder.api.snapshot().shifts[0].sources[0];
  expect(source).toEqual({
    selector: '[id="work"] > table > tbody > tr[data-keyboard-item="T-19"] > td',
    nodeKind: 'text',
    connected: true,
    previousRect: { x: 1, y: 2, width: 30, height: 40, top: 2, right: 31, bottom: 42, left: 1 },
    currentRect: { x: 5, y: 6, width: 30, height: 40, top: 6, right: 35, bottom: 46, left: 5 },
  });
  const row = cell.parentElement;
  if (!row) throw new Error('Missing keyed row.');
  row.before(document.createElement('tr'));
  recorder.deliver([entry(2, false, [{ node: cell.firstChild, previousRect, currentRect }])]);
  expect(recorder.api.snapshot().shifts[1].sources[0].selector).toBe(source.selector);
  expect(JSON.parse(JSON.stringify(source))).toEqual(source);
});

it('retains disconnected and missing sources, and escapes selector attribute values', () => {
  const recorder = harness();
  const detached = document.createElement('div');
  detached.id = 'quoted"\\\n';
  detached.append('Removed');
  const rectangle = new DOMRect();
  recorder.deliver([
    entry(1, false, [
      { node: detached, previousRect: rectangle, currentRect: rectangle },
      { node: detached.firstChild, previousRect: rectangle, currentRect: rectangle },
      { node: null, previousRect: rectangle, currentRect: rectangle },
    ]),
    entry(2),
  ]);
  const report = recorder.api.snapshot();
  const [element, text, unavailable] = report.shifts[0].sources;
  expect(element.selector).toBe('[id="quoted\\22 \\5c \\a "]');
  expect(element.connected).toBe(false);
  expect(element.nodeKind).toBe('element');
  expect(text.selector).toBe(element.selector);
  expect(text.nodeKind).toBe('text');
  expect(text.connected).toBe(false);
  expect(unavailable.selector).toBeNull();
  expect(unavailable.connected).toBeNull();
  expect(unavailable.nodeKind).toBe('unavailable');
  expect(report.shifts[1].sources).toEqual([]);
});

it('disambiguates repeated class siblings while retaining unique semantic selectors', () => {
  const recorder = harness();
  document.body.innerHTML =
    '<section id="inspector"><div class="pc-field">First</div><div class="pc-field">Second</div><aside class="pc-field">Only aside</aside><div class="pc-field" aria-label="Owner">Owner</div></section>';
  const elements = [...document.querySelectorAll('.pc-field')];
  const rectangle = new DOMRect();
  recorder.deliver([
    entry(
      1,
      false,
      elements.map((node) => ({ node, previousRect: rectangle, currentRect: rectangle })),
    ),
  ]);
  const selectors = recorder.api.snapshot().shifts[0].sources.map((source) => source.selector);
  expect(selectors).toEqual([
    '[id="inspector"] > div.pc-field:nth-of-type(1)',
    '[id="inspector"] > div.pc-field:nth-of-type(2)',
    '[id="inspector"] > aside.pc-field',
    '[id="inspector"] > div[aria-label="Owner"]',
  ]);
  expect(selectors.map((selector) => document.querySelector(selector ?? ''))).toEqual(elements);
});
