// @vitest-environment jsdom

import { appendFileSync } from 'node:fs';
import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Profiler, type ProfilerOnRenderCallback, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import { StructuralTrace } from '../../../../apps/dashboard/src/features/planning/DeliveryTrace.js';
import * as markdown from '../../../../apps/dashboard/src/features/planning/PlanningMarkdown.js';
import {
  type PlanningGraphEnvelope,
  parsePlanningGraphEnvelope,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import { useListScrollAnchor } from '../../../../apps/dashboard/src/features/planning/planning-list-window.js';
import * as structural from '../../../../apps/dashboard/src/features/planning/planning-structural-model.js';
import { clearInspector } from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import {
  buildPremiumDashboardFixture,
  type FixtureDataset,
  fixtureSnapshot,
} from './fixtures/premium-dashboard-fixtures.js';

function writeProfile(value: unknown) {
  const output = process.env.OPENPLANR_DETAIL_PROFILE_PATH;
  if (output) appendFileSync(output, `${JSON.stringify(value)}\n`);
}

const BODY = [
  '## Acceptance Criteria',
  '- AC-proof: Verify the selected artifact',
  '## Detailed implementation',
  ...Array.from(
    { length: 500 },
    (_, index) =>
      `Paragraph ${index} preserves **authored detail** and \`source-${index}.ts\` with [safe evidence](https://example.com/proof).`,
  ),
].join('\n\n');
let sequence = 0;

function fixture(dataset: FixtureDataset) {
  sequence++;
  const fixture = buildPremiumDashboardFixture(dataset);
  const selectedId = fixture.manifest.selectedId;
  const graph = {
    ...fixture.graph,
    nodes: fixture.graph.nodes.map((node) =>
      node.id === selectedId
        ? {
            ...node,
            frontmatter: {
              ...node.frontmatter,
              ...Object.fromEntries(
                Array.from({ length: 150 }, (_, index) => [
                  `authoredField${index}`,
                  `Preserved metadata value ${index}`,
                ]),
              ),
            },
          }
        : node,
    ),
  };
  const snapshot = fixtureSnapshot(graph, {
    actorId: `detail-performance-${dataset}-${sequence}`,
    projectId: `sha256:${'c'.repeat(64)}`,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    generation: 6,
  });
  const binding = createDashboardQueryIdentity({
    ...snapshot.binding,
    productArea: 'planning',
    route: '#/list',
    subjectId: null,
    cycleId: null,
    eventHead: snapshot.cursor.eventHead,
    viewHash: snapshot.cursor.viewHash,
  });
  const envelope = parsePlanningGraphEnvelope(snapshot, binding);
  const projection = parseDashboardProductState<PlanningGraphEnvelope>(
    {
      kind: 'ready',
      binding,
      data: envelope,
      reasonCodes: [],
      error: null,
      mutationEnabled: false,
      policy: dashboardProductStatePolicy('ready'),
    },
    {
      currentBinding: binding,
      validateData: (value): value is PlanningGraphEnvelope => {
        parsePlanningGraphEnvelope(value, binding);
        return true;
      },
    },
  );
  const summary = graph.nodes.find((node) => node.id === selectedId);
  const node = { ...summary, body: BODY };
  const detail = {
    kind: 'planning-detail',
    schemaVersion: '1.0.0',
    binding: snapshot.binding,
    cursor: snapshot.cursor,
    subjectId: selectedId,
    node,
    nodeHash: sha256Jcs(node as never),
  };
  return { snapshot, binding, projection, detail, selectedId };
}

const adapters = {
  loadSingleLetters: () => true,
  saveSingleLetters: () => {},
  railPreference: { initialCompact: false, save: () => {} },
};

afterEach(() => {
  cleanup();
  clearInspector();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('Planning detail render work', () => {
  it.each(['representative', 'artboard', 'scaling'] as const)(
    'profiles closed disclosures and repeated %s inspector renders',
    async (dataset) => {
      vi.stubGlobal('innerWidth', 1440);
      window.history.replaceState(null, '', '#/list');
      const current = fixture(dataset);
      const projectionSpy = vi.spyOn(structural, 'selectStructuralDetail');
      const markdownSpy = vi.spyOn(markdown, 'PlanningMarkdown');
      const fetcher = vi.fn(
        async () =>
          new Response(JSON.stringify(current.detail), {
            headers: { 'content-type': 'application/json' },
          }),
      );
      vi.stubGlobal('fetch', fetcher);
      let phase = 'initial';
      const timings: Record<string, number[]> = {};
      const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
        timings[phase] ??= [];
        timings[phase].push(actualDuration);
      };
      const shell = (revision: number) => (
        <Profiler id="inspector-shell" onRender={onRender}>
          <DashboardProviders
            buildId={`detail-performance-${revision}`}
            initialHash="#/list"
            binding={current.binding}
            projection={current.projection}
            planningProjection={current.projection}
            bootPhase="compatible"
            planningLive={{ state: 'connected', attempt: 0 }}
            connection={{
              state: 'connected',
              label: 'Connected',
              reason: 'Verified performance fixture',
            }}
          >
            <UnifiedShell adapters={adapters} />
          </DashboardProviders>
        </Profiler>
      );
      const rendered = render(shell(0));
      expect(screen.queryByRole('dialog', { name: 'Inspector', exact: true })).toBeNull();
      fireEvent.change(screen.getByRole('textbox', { name: 'Filter by id or title' }), {
        target: { value: current.selectedId },
      });
      const row = rendered.container.querySelector<HTMLElement>('.pc-list tbody tr[tabindex]');
      if (!row) throw new Error('Missing selected performance row');
      await act(async () => row.click());
      await within(screen.getByRole('dialog', { name: 'Inspector', exact: true })).findByText(
        'Detail verified against the current planning snapshot.',
      );
      const panel = screen.getByRole('dialog', { name: 'Inspector', exact: true });
      const initial = {
        projectionSelects: projectionSpy.mock.calls.length,
        markdown: markdownSpy.mock.calls.length,
        fullBody: markdownSpy.mock.calls.filter(([props]) => props.text === BODY).length,
        dom: panel.querySelectorAll('*').length,
        traceLength: panel.querySelectorAll('.pc-detail__trace > li').length,
        rawProperties: panel.querySelectorAll('.pc-detail__raw > div').length,
        closedMarkdownNodes: panel.querySelectorAll('details:not([open]) .pc-detail__markdown *')
          .length,
      };
      projectionSpy.mockClear();
      markdownSpy.mockClear();
      phase = 'parent-update';
      for (let revision = 1; revision <= 20; revision++)
        await act(async () => rendered.rerender(shell(revision)));
      const updates = {
        projectionSelects: projectionSpy.mock.calls.length,
        markdown: markdownSpy.mock.calls.length,
        fullBody: markdownSpy.mock.calls.filter(([props]) => props.text === BODY).length,
        dom: panel.querySelectorAll('*').length,
      };
      projectionSpy.mockClear();
      markdownSpy.mockClear();
      phase = 'reopen';
      for (let iteration = 0; iteration < 5; iteration++) {
        fireEvent.click(
          within(screen.getByRole('dialog', { name: 'Inspector', exact: true })).getByRole(
            'button',
            { name: 'Close inspector', exact: true },
          ),
        );
        expect(screen.queryByRole('dialog', { name: 'Inspector', exact: true })).toBeNull();
        await act(async () => row.click());
        await within(screen.getByRole('dialog', { name: 'Inspector', exact: true })).findByText(
          'Detail verified against the current planning snapshot.',
        );
      }
      const reopenedProjections = projectionSpy.mock.results
        .filter((result) => result.type === 'return')
        .map((result) => result.value);
      const reopen = {
        projectionIdentities: new Set(reopenedProjections).size,
        projectionSelects: projectionSpy.mock.calls.length,
        markdown: markdownSpy.mock.calls.length,
        fullBody: markdownSpy.mock.calls.filter(([props]) => props.text === BODY).length,
      };
      const durations = Object.fromEntries(
        Object.entries(timings).map(([key, values]) => [
          key,
          {
            commits: values.length,
            totalMs: Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100,
            maxMs: Math.round(Math.max(...values) * 100) / 100,
          },
        ]),
      );
      writeProfile({ dataset, initial, updates, reopen, durations });
      expect(initial.fullBody).toBe(0);
      expect(initial.rawProperties).toBe(0);
      expect(initial.closedMarkdownNodes).toBe(0);
      expect(initial.dom).toBeLessThan(2000);
      expect(updates.markdown).toBe(0);
      expect(reopen.projectionIdentities).toBe(1);
      expect(reopen.fullBody).toBe(0);
      expect(updates.projectionSelects).toBe(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(initial.dom).toBeGreaterThan(0);
    },
  );
});

const anchorRows = Array.from({ length: 80 }, (_, index) => ({
  id: `row-${index}`,
  label: String(index),
}));

function ScrollAnchorHarness({ revision }: { revision: number }) {
  const root = useRef<HTMLDivElement>(null);
  useListScrollAnchor(root, 'stable-presentation', revision);
  return (
    <div ref={root}>
      <div className="pc-list__window">
        <section data-keyboard-group="all">
          {anchorRows.map((row) => (
            <div key={row.id} data-keyboard-item={row.id}>
              {row.label}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

it('bounds anchor geometry reads to the next animation frame and restores after all reads', async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let frameSequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++frameSequence;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const operations: string[] = [];
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    operations.push(`read:${this.dataset.keyboardItem ?? 'scroller'}`);
    const index = Number(this.dataset.keyboardItem?.split('-').at(-1) ?? 0);
    const scroller = this.closest<HTMLElement>('.pc-list__window');
    const top = this.dataset.keyboardItem ? index * 24 - (scroller?.scrollTop ?? 0) : 0;
    return {
      top,
      bottom: top + 24,
      left: 0,
      right: 500,
      width: 500,
      height: 24,
      x: 0,
      y: top,
      toJSON() {},
    };
  });
  const rendered = render(<ScrollAnchorHarness revision={1} />);
  const scroller = rendered.container.querySelector<HTMLElement>('.pc-list__window');
  if (!scroller) throw new Error('Missing scroll anchor harness');
  let scrollTop = 0;
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      operations.push('write:scrollTop');
      scrollTop = value;
    },
  });
  const flushFrame = async () => {
    const pending = [...frames.values()];
    frames.clear();
    await act(async () => {
      for (const callback of pending) callback(0);
    });
  };
  await flushFrame();
  scroller.scrollTop = 1800;
  operations.length = 0;
  fireEvent.scroll(scroller);
  const synchronousReads = operations.filter((value) => value.startsWith('read:')).length;
  operations.length = 0;
  await flushFrame();
  const frameReads = operations.filter((value) => value.startsWith('read:')).length;
  operations.length = 0;
  rendered.rerender(<ScrollAnchorHarness revision={2} />);
  const revisionOperations = [...operations];
  writeProfile({ scrollAnchor: { synchronousReads, frameReads, revisionOperations } });
  expect(synchronousReads).toBe(0);
  expect(frameReads).toBeGreaterThan(0);
  expect(frameReads).toBeLessThanOrEqual(Math.ceil(Math.log2(80)) + 2);
  const firstWrite = revisionOperations.findIndex((value) => value.startsWith('write:'));
  if (firstWrite >= 0)
    expect(
      revisionOperations.slice(firstWrite + 1).some((value) => value.startsWith('read:')),
    ).toBe(false);
});

it('records authored trace sizes independently of inspector mounting', () => {
  const traces = (['representative', 'artboard', 'scaling'] as const).map((dataset) => {
    const fixture = buildPremiumDashboardFixture(dataset);
    const selected = fixture.graph.nodes.find((node) => node.id === fixture.manifest.selectedId);
    if (!selected) throw new Error('Missing trace size fixture artifact');
    const detail = structural.buildStructuralDetail(
      structural.createStructuralIndex(fixture.graph),
      selected,
    );
    return { dataset, traceLength: detail.trace.length };
  });
  writeProfile({ traces });
  expect(traces.every(({ traceLength }) => traceLength > 0)).toBe(true);
});

it('reuses structural projections only while graph, selected body and referenced parent are unchanged', () => {
  const parent = {
    id: 'SPEC-scope',
    type: 'spec' as const,
    title: 'Scope',
    status: 'outstanding' as const,
    frontmatter: {},
    body: '## Acceptance Criteria\n- AC-proof: First parent criterion',
  };
  const node = {
    id: 'SPEC-scope/T-selected',
    type: 'task' as const,
    title: 'Selected',
    status: 'outstanding' as const,
    frontmatter: { specId: parent.id, acceptanceRefs: ['AC-proof'] },
    body: 'First body',
  };
  const graph = { nodes: [parent, node], edges: [] };
  const first = structural.selectStructuralDetail(graph, node, parent);
  expect(structural.selectStructuralDetail(graph, node, parent)).toBe(first);
  expect(first.criteria[0].text).toBe('First parent criterion');
  const nextNode = { ...node, body: 'Changed selected body' };
  expect(structural.selectStructuralDetail(graph, nextNode, parent)).not.toBe(first);
  expect(structural.selectStructuralDetail({ ...graph }, node, parent)).not.toBe(first);
  const nextParent = {
    ...parent,
    body: '## Acceptance Criteria\n- AC-proof: Changed parent criterion',
  };
  const revised = structural.selectStructuralDetail(graph, node, nextParent);
  expect(revised).not.toBe(first);
  expect(revised.criteria[0].text).toBe('Changed parent criterion');
  expect(structural.selectStructuralDetail(graph, node, nextParent)).toBe(revised);
});

it('mounts disclosure content only after its native disclosure opens', async () => {
  const content = vi.fn(() => <markdown.PlanningMarkdown text={BODY} />);
  const rendered = render(
    <markdown.DetailDisclosure label="Read large artifact">{content}</markdown.DetailDisclosure>,
  );
  const disclosure = rendered.container.querySelector('details');
  if (!disclosure) throw new Error('Missing detail disclosure');
  expect(content).not.toHaveBeenCalled();
  expect(rendered.container.querySelector('.pc-detail__markdown')).toBeNull();
  await act(async () => {
    disclosure.open = true;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(content.mock.calls.length).toBeGreaterThan(0);
  expect(rendered.container.querySelectorAll('.pc-detail__markdown p').length).toBe(500);
  await act(async () => {
    disclosure.open = false;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(rendered.container.querySelector('.pc-detail__markdown')).toBeNull();
  const closedCalls = content.mock.calls.length;
  rendered.rerender(
    <markdown.DetailDisclosure label="Read updated label">{content}</markdown.DetailDisclosure>,
  );
  expect(content).toHaveBeenCalledTimes(closedCalls);
});

it('reveals deferred scroll regions by intersection or keyboard focus without changing their container', async () => {
  const observers: {
    callback: IntersectionObserverCallback;
    elements: Element[];
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  class Observer {
    readonly root = null;
    readonly rootMargin = '100px';
    readonly thresholds = [0];
    readonly elements: Element[] = [];
    readonly disconnect = vi.fn();
    constructor(readonly callback: IntersectionObserverCallback) {
      observers.push(this);
    }
    observe(element: Element) {
      this.elements.push(element);
    }
    unobserve() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  const firstContent = vi.fn(() => <p>Intersection content</p>);
  const secondContent = vi.fn(() => <p>Keyboard content</p>);
  render(
    <>
      <section aria-label="Deferred first">
        <markdown.DeferredDetailContent>{firstContent}</markdown.DeferredDetailContent>
      </section>
      <section aria-label="Deferred second">
        <button type="button">Inspect deferred details</button>
        <markdown.DeferredDetailContent>{secondContent}</markdown.DeferredDetailContent>
      </section>
    </>,
  );
  const first = screen.getByRole('region', { name: 'Deferred first' });
  const second = screen.getByRole('region', { name: 'Deferred second' });
  expect(firstContent).not.toHaveBeenCalled();
  expect(secondContent).not.toHaveBeenCalled();
  const observer = observers.find((entry) => entry.elements.includes(first));
  if (!observer) throw new Error('Deferred content was not observed');
  await act(async () =>
    observer.callback(
      [{ isIntersecting: true, target: first } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    ),
  );
  expect(within(first).getByText('Intersection content')).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Deferred first' })).toBe(first);
  fireEvent.focusIn(within(second).getByRole('button', { name: 'Inspect deferred details' }));
  expect(within(second).getByText('Keyboard content')).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Deferred second' })).toBe(second);
  expect(observer.disconnect).toHaveBeenCalled();
});

it('keeps every trace artifact reachable while mounting only twelve items per page', () => {
  const fixture = buildPremiumDashboardFixture('representative');
  const selected = fixture.graph.nodes.find((node) => node.id === fixture.manifest.selectedId);
  if (!selected) throw new Error('Missing trace pagination fixture');
  const detail = structural.selectStructuralDetail(fixture.graph, selected);
  render(<StructuralTrace model={detail} />);
  const list = screen.getByRole('list', { name: 'Artifact lineage' });
  expect(list.querySelector('[data-current="true"]')).toBeTruthy();
  const previous = screen.getByRole('button', {
    name: 'Previous trace items',
  }) as HTMLButtonElement;
  const next = screen.getByRole('button', { name: 'Next trace items' }) as HTMLButtonElement;
  while (!previous.disabled) fireEvent.click(previous);
  const visitedTitles = new Set<string>();
  let offset = 0;
  while (true) {
    const expected = detail.trace.slice(offset, offset + 12);
    expect(list.querySelectorAll(':scope > li').length).toBe(expected.length);
    for (const { node } of expected) {
      expect(within(list).getByText(node.title, { exact: true })).toBeTruthy();
      visitedTitles.add(node.title);
    }
    if (next.disabled) break;
    fireEvent.click(next);
    offset += 12;
  }
  expect(visitedTitles.size).toBe(detail.trace.length);
  expect(previous.disabled).toBe(false);
  fireEvent.click(previous);
  expect(list.querySelectorAll(':scope > li').length).toBeLessThanOrEqual(12);
});

it('keeps the current trace artifact visible after selection or a live ancestry shift', () => {
  const fixture = buildPremiumDashboardFixture('representative');
  const selected = fixture.graph.nodes.find((node) => node.id === fixture.manifest.selectedId);
  if (!selected) throw new Error('Missing current trace fixture');
  const original = structural.selectStructuralDetail(fixture.graph, selected);
  const focusAt = (position: number) => ({
    ...original,
    trace: original.trace.map((entry, index) => ({
      ...entry,
      role: index === position ? 'Current artifact' : 'Parent',
    })),
  });
  const rendered = render(<StructuralTrace model={focusAt(0)} />);
  const list = screen.getByRole('list', { name: 'Artifact lineage' });
  fireEvent.click(screen.getByRole('button', { name: 'Next trace items' }));
  expect(list.querySelector('[data-current="true"]')).toBeNull();
  rendered.rerender(<StructuralTrace model={focusAt(0)} />);
  expect(list.querySelector('[data-current="true"]')).toBeNull();
  rendered.rerender(<StructuralTrace model={focusAt(35)} />);
  expect(list.querySelector('[data-current="true"]')?.textContent).toContain(
    original.trace[35].node.title,
  );
  const current = original.trace[35];
  const shifted = {
    ...original,
    trace: [
      ...original.trace.slice(0, 5).map((entry) => ({ ...entry, role: 'Parent' })),
      { ...current, role: 'Current artifact' },
      ...original.trace
        .slice(5)
        .filter((entry) => entry.node.id !== current.node.id)
        .map((entry) => ({ ...entry, role: 'Parent' })),
    ],
  };
  rendered.rerender(<StructuralTrace model={shifted} />);
  expect(list.querySelector('[data-current="true"]')?.textContent).toContain(current.node.title);
  expect(list.querySelectorAll(':scope > li').length).toBeLessThanOrEqual(12);
});
