// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import { parseDashboardLocation } from '../../../../apps/dashboard/src/app/router.js';
import { ListPage } from '../../../../apps/dashboard/src/features/planning/ListPage.js';
import {
  type PlanningGraph,
  type PlanningGraphEnvelope,
  type PlanningNode,
  parsePlanningGraphEnvelope,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import {
  clearInspector,
  useInspectorStore,
} from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import { installKeyboardCoordinator } from '../../../../apps/dashboard/src/features/shell/keyboard-coordinator.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { PlanningPresentationProvider } from '../../../../apps/dashboard/src/lib/routing/planning-presentation.js';
import {
  type PlanningView,
  serializePlanningViewHref,
} from '../../../../apps/dashboard/src/lib/routing/planning-view-codec.js';
import { buildPremiumDashboardFixture } from './fixtures/premium-dashboard-fixtures.js';

const FIXTURE_FIRST = 'T-920';
const FIXTURE_SECOND = 'T-921';
const FIXTURE_VIEW: PlanningView = {
  schemaVersion: '1.0.0',
  route: 'list',
  filters: {
    type: ['task'],
    status: ['outstanding'],
    priority: ['P0', 'P1'],
    label: ['ready'],
    query: 'review',
    createdWithinDays: null,
    updatedWithinDays: null,
  },
  groupBy: 'none',
  sort: { field: 'title', direction: 'asc' },
  density: 'compact',
  focusId: null,
};

function node(
  id: string,
  title: string,
  frontmatter: Record<string, unknown> = {},
  status: PlanningNode['status'] = 'outstanding',
  type: PlanningNode['type'] = 'task',
): PlanningNode {
  return {
    id,
    title,
    type,
    status,
    frontmatter: { id, priority: 'P1', labels: ['ready'], ...frontmatter },
  };
}

const FIXTURE_NODES: readonly PlanningNode[] = [
  node(FIXTURE_FIRST, 'Zulu review', {
    labels: ['ready', 'review'],
    updated: '2026-10-19',
    created: '2026-10-17',
  }),
  node(FIXTURE_SECOND, 'Alpha review', {
    priority: 'P0',
    updated: '2026-10-18',
    created: '2026-10-16',
  }),
  node('T-922', 'Blocked review', {}, 'blocked'),
  node('US-923', 'Story review', {}, 'outstanding', 'story'),
  node('T-924', 'Other item', { priority: 'low', labels: ['later'] }),
];

function fixture(
  nodes: readonly PlanningNode[] = FIXTURE_NODES,
  kind: 'ready' | 'refreshing' | 'loading' = 'ready',
  sequence = 0,
  generation = 1,
) {
  const graph: PlanningGraph = { nodes, edges: [] };
  const eventHead = { sequence, hash: sequence ? `sha256:${'a'.repeat(64)}` : null };
  const viewHash = sha256Jcs(graph as never);
  const root = {
    actorId: 'fixture-list-owner',
    projectId: `sha256:${'d'.repeat(64)}`,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    generation,
  };
  const binding = createDashboardQueryIdentity({
    productArea: 'planning',
    route: '#/list',
    ...root,
    cycleId: null,
    subjectId: null,
    eventHead,
    viewHash,
  });
  const envelope = parsePlanningGraphEnvelope(
    {
      kind: 'planning-graph-snapshot',
      schemaVersion: '1.0.0',
      binding: root,
      cursor: { eventHead, viewHash },
      mode: nodes.some((node) => node.type === 'spec')
        ? nodes.some((node) => node.type === 'epic' || node.type === 'feature')
          ? 'mixed'
          : 'spec'
        : nodes.some((node) => node.type === 'epic' || node.type === 'feature')
          ? 'agile'
          : 'empty',
      graph,
    },
    binding,
  );
  const state = parseDashboardProductState<PlanningGraphEnvelope>(
    {
      kind,
      binding,
      data: kind === 'loading' ? null : envelope,
      reasonCodes: kind === 'refreshing' ? ['DASHBOARD_REFRESHING'] : [],
      error: null,
      mutationEnabled: false,
      policy: dashboardProductStatePolicy(kind),
    },
    {
      currentBinding: binding,
      validateData: (value): value is PlanningGraphEnvelope => {
        parsePlanningGraphEnvelope(value, binding);
        return true;
      },
    },
  );
  return { binding, state };
}

function Selection() {
  const store = useInspectorStore();
  return (
    <output data-testid="selection" data-open-tick={store.openTick}>
      {store.selection?.kind === 'node' ? store.selection.id : 'none'}
    </output>
  );
}

function View({
  nodes = FIXTURE_NODES,
  view = FIXTURE_VIEW,
  invalidView = false,
  onCopy,
  singleLetters,
  preferences,
}: {
  nodes?: readonly PlanningNode[];
  view?: PlanningView | null;
  invalidView?: boolean;
  onCopy?: (text: string) => Promise<void>;
  singleLetters?: boolean;
  preferences?: {
    load: (key: string) => string | null;
    save: (key: string, value: string) => void;
  };
}) {
  const current = fixture(nodes);
  return (
    <PlanningPresentationProvider
      scope="fixture-list"
      view={view}
      invalidView={invalidView}
      onCopy={onCopy}
      singleLetters={singleLetters}
    >
      <ListPage
        currentBinding={current.binding}
        current={current.state}
        preferences={preferences}
      />
      <Selection />
    </PlanningPresentationProvider>
  );
}

function rowIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('tbody tr[data-keyboard-item]')).map(
    (row) => row.dataset.keyboardItem ?? '',
  );
}

async function openListOptions(user: ReturnType<typeof userEvent.setup>) {
  const summary = screen.getByText('List options');
  if (!summary.closest('details')?.open) await user.click(summary);
}

afterEach(() => {
  cleanup();
  clearInspector();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('List presentation tokens against validated projections', () => {
  it('shows spec group headers by default and preserves an explicit ungrouped view', () => {
    const nodes = [
      node('SPEC-901', 'Delivery', {}, 'outstanding', 'spec'),
      node('SPEC-901/T-901', 'Open task', { specId: 'SPEC-901' }),
      node('SPEC-901/T-902', 'Completed task', { specId: 'SPEC-901' }, 'done'),
    ];
    const { container, rerender } = render(<View nodes={nodes} view={null} />);
    const group = screen.getByRole('rowgroup', { name: 'SPEC-901 · Delivery' });
    expect(
      within(group)
        .getByRole('button', { name: 'SPEC-901 · Delivery' })
        .getAttribute('aria-expanded'),
    ).toBe('true');
    expect(within(group).getByRole('progressbar').getAttribute('value')).toBe('1');
    expect(rowIds(container)).toHaveLength(3);
    rerender(
      <View
        nodes={nodes}
        view={{
          ...FIXTURE_VIEW,
          filters: {
            ...FIXTURE_VIEW.filters,
            type: [],
            status: [],
            priority: [],
            label: [],
            query: '',
          },
        }}
      />,
    );
    expect(container.querySelector('.pc-list__group-header')).toBeNull();
  });

  it('renders one no-results state and clears every active filter through its counted action', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <View
        view={{
          ...FIXTURE_VIEW,
          filters: {
            ...FIXTURE_VIEW.filters,
            query: 'no matching artifact',
            createdWithinDays: 7,
            updatedWithinDays: 7,
          },
        }}
      />,
    );
    expect(container.querySelectorAll('.pc-empty[data-variant="tile"]')).toHaveLength(1);
    expect(container.querySelector('table')).toBeNull();
    expect(screen.queryByText('No node matches this filter.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear 8 filters', exact: true }));
    expect(rowIds(container)).toHaveLength(FIXTURE_NODES.length);
    expect(screen.queryByText('Nothing matches “no matching artifact”')).toBeNull();
    expect(
      (screen.getByRole('textbox', { name: 'Filter by id or title' }) as HTMLInputElement).value,
    ).toBe('');
    const hints = screen.getByRole('region', { name: 'List keyboard shortcuts' });
    expect(hints.querySelectorAll('kbd')).toHaveLength(11);
    expect(hints.textContent).toContain('collapse / expand group');
    expect(hints.textContent).toContain('5 filtered items');
  });

  it('applies URL filter, density, sorting and grouping without changing the bound graph', () => {
    const { container, rerender } = render(<View />);
    expect(rowIds(container)).toEqual([FIXTURE_SECOND, FIXTURE_FIRST]);
    expect(
      screen.getByRole('textbox', { name: 'Filter by id or title' }).getAttribute('value'),
    ).toBe('review');
    expect(
      screen.getByRole('button', { name: 'Compact', exact: true }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(container.querySelector('table')?.getAttribute('data-compact')).toBe('true');
    expect(container.querySelector('h1')?.parentElement?.textContent).toContain('2 of 5');
    rerender(<View view={{ ...FIXTURE_VIEW, groupBy: 'label' }} />);
    const ready = screen.getByRole('rowgroup', { name: 'ready' });
    const review = screen.getByRole('rowgroup', { name: 'review' });
    expect(rowIds(ready)).toEqual([FIXTURE_SECOND, FIXTURE_FIRST]);
    expect(rowIds(review)).toEqual([FIXTURE_FIRST]);
    expect(container.querySelectorAll('table')).toHaveLength(1);
    expect(container.querySelectorAll('thead')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Updated', exact: true })).toHaveLength(1);
    expect(container.querySelector('h1')?.parentElement?.textContent).toContain('2 of 5');
    expect(screen.queryByText('Blocked review')).toBeNull();
  });

  it('keeps advanced controls on demand and retains selection across closing and reopening them', async () => {
    const user = userEvent.setup();
    const { container } = render(<View view={null} />);
    const options = screen.getByText('List options').closest('details');
    expect(options?.open).toBe(false);
    expect(screen.getByRole('button', { name: 'Copy bulk commands' }).closest('details')).toBe(
      options,
    );
    const filter = screen.getByRole('textbox', { name: 'Filter by id or title' });
    await user.type(filter, 'Alpha');
    expect(options?.open).toBe(false);
    expect(rowIds(container)).toEqual([FIXTURE_SECOND]);
    await user.clear(filter);
    expect(rowIds(container)).toHaveLength(FIXTURE_NODES.length);
    await openListOptions(user);
    await user.click(screen.getByRole('button', { name: 'Select all 5 filtered' }));
    const summary = screen.getByText('List options');
    fireEvent.keyDown(summary, { key: 'Escape' });
    expect(options?.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    await openListOptions(user);
    expect(screen.getByText('5 selected · 0 eligible · 5 skipped')).toBeTruthy();
    expect(rowIds(container)).toHaveLength(FIXTURE_NODES.length);
  });

  it('respects disabled single-letter shortcuts inside advanced command controls', async () => {
    const user = userEvent.setup();
    const copy = vi.fn(async (_text: string) => undefined);
    render(
      <View
        nodes={[node('BL-910', 'Finding', {}, 'outstanding', 'backlog')]}
        view={null}
        singleLetters={false}
        onCopy={copy}
      />,
    );
    await openListOptions(user);
    await user.click(screen.getByRole('button', { name: 'Select all 1 filtered' }));
    const bulk = screen.getByRole('button', { name: 'Copy bulk commands' });
    fireEvent.keyDown(bulk, { key: 'c' });
    expect(copy).not.toHaveBeenCalled();
    await user.click(bulk);
    expect(copy).toHaveBeenCalledExactlyOnceWith(
      'openplanr backlog update BL-910 --status in-progress',
    );
  });

  it('collapses and expands the focused List label group without affecting its neighbours', () => {
    const { container } = render(<View view={{ ...FIXTURE_VIEW, groupBy: 'label' }} />);
    const ready = screen.getByRole('rowgroup', { name: 'ready' });
    const review = screen.getByRole('rowgroup', { name: 'review' });
    const readyToggle = within(ready).getByRole('button', { name: 'ready' });
    const reviewToggle = within(review).getByRole('button', { name: 'review' });
    const row = ready.querySelector<HTMLElement>('[data-keyboard-item]');
    if (!row) throw new Error('Expected a fixture row');
    const dispose = installKeyboardCoordinator(document, () => ({
      root: container,
      selectionScope: 'fixture-list',
      singleLetters: true,
      paletteOpen: false,
      togglePalette: () => undefined,
      openHelp: () => undefined,
      navigate: () => undefined,
      closeInspector: () => false,
      selectedId: () => null,
      copy: async () => undefined,
      announce: () => undefined,
    }));
    try {
      act(() => row.focus());
      fireEvent.keyDown(row, { key: '[' });
      expect(readyToggle.getAttribute('aria-expanded')).toBe('false');
      expect(reviewToggle.getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(readyToggle);
      fireEvent.keyDown(readyToggle, { key: ']' });
      expect(readyToggle.getAttribute('aria-expanded')).toBe('true');
      expect(
        within(ready)
          .getAllByRole('row')
          .filter((candidate) => candidate.hasAttribute('data-keyboard-item')),
      ).toHaveLength(2);
      expect(reviewToggle.getAttribute('aria-expanded')).toBe('true');
    } finally {
      dispose();
    }
  });

  it('intersects inclusive UTC relative-date filters and excludes unknown and future authored dates', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    const nodes = [
      node(FIXTURE_FIRST, 'Today review', {
        created: '2026-10-19',
        updated: '2026-10-19T10:00:00Z',
      }),
      node(FIXTURE_SECOND, 'Older review', { created: '2026-10-18', updated: '2026-10-19' }),
      node('T-925', 'Unknown review'),
      node('T-926', 'Future review', { created: '2026-10-20', updated: '2026-10-20' }),
    ];
    const view = {
      ...FIXTURE_VIEW,
      filters: { ...FIXTURE_VIEW.filters, createdWithinDays: 1, updatedWithinDays: 2 },
    };
    const { container } = render(<View nodes={nodes} view={view} />);
    expect(rowIds(container)).toEqual([FIXTURE_FIRST]);
  });

  it('windows each grouped page while all appearances remain reachable and counts deduplicate labels', async () => {
    const user = userEvent.setup();
    const nodes = Array.from({ length: 105 }, (_, index) =>
      node(`T-${1000 + index}`, `Review ${index}`, { labels: ['ready', 'review'] }),
    );
    const view = {
      ...FIXTURE_VIEW,
      groupBy: 'label' as const,
      filters: { ...FIXTURE_VIEW.filters, query: '' },
    };
    const { container } = render(<View nodes={nodes} view={view} />);
    const visited = new Map<string, string>();
    const scrollPage = (expected: number) => {
      const page = new Map<string, string>();
      const scroller = container.querySelector<HTMLElement>('.pc-list__window');
      if (!scroller) throw new Error('Missing list window.');
      for (let top = 0; top <= 5000; top += 300) {
        fireEvent.scroll(scroller, { target: { scrollTop: top } });
        const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-keyboard-item]'));
        expect(rows.length).toBeLessThanOrEqual(26);
        for (const row of rows) {
          const id = row.dataset.keyboardItem ?? '';
          const group = row.closest<HTMLElement>('[data-keyboard-group]')?.dataset.keyboardGroup;
          page.set(`${group}:${id}`, id);
        }
      }
      expect(page.size).toBe(expected);
      for (const [key, id] of page) visited.set(key, id);
    };
    scrollPage(100);
    expect(
      screen.getByRole('navigation', { name: 'Planning artifact pages' }).textContent,
    ).toContain('Page 1 of 3');
    expect(container.querySelector('h1')?.parentElement?.textContent).toContain('105 of 105');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    scrollPage(100);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    scrollPage(10);
    expect(visited.size).toBe(210);
    expect(new Set(visited.values()).size).toBe(105);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    for (const id of new Set(visited.values()))
      expect([...visited.values()].filter((entry) => entry === id)).toHaveLength(2);
  });

  it('copies current presentation through the injected adapter, without binding or authority', async () => {
    const user = userEvent.setup();
    const copy = vi.fn(async (_text: string) => undefined);
    render(<View onCopy={copy} />);
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'Alpha');
    await user.click(screen.getByRole('button', { name: 'Compact', exact: true }));
    await openListOptions(user);
    await user.click(screen.getByRole('button', { name: 'Copy filter link' }));
    expect(copy).toHaveBeenCalledTimes(1);
    const href = copy.mock.calls[0]?.[0] as string | undefined;
    expect(href).toBeDefined();
    const location = parseDashboardLocation(new URL(href ?? '').hash);
    expect(location.invalidView).toBe(false);
    expect(location.presentationView).toMatchObject({
      density: 'comfortable',
      filters: { query: 'Alpha', priority: ['P0', 'P1'], label: ['ready'] },
    });
    expect(location.presentationView).not.toHaveProperty('binding');
    expect(screen.getByText('Filter link copied.')).toBeTruthy();
  });

  it.each(['missing', 'blocked'])(
    'provides a manual filter URL when clipboard is %s',
    async (mode) => {
      const user = userEvent.setup();
      render(
        <View
          onCopy={
            mode === 'missing'
              ? undefined
              : async () => {
                  throw new Error('denied');
                }
          }
        />,
      );
      await openListOptions(user);
      await user.click(screen.getByRole('button', { name: 'Copy filter link' }));
      const message = await screen.findByText(
        /^Copy blocked\. Select and copy this filter link manually:/u,
      );
      const href = message.textContent?.split('manually: ')[1] ?? '';
      expect(parseDashboardLocation(new URL(href).hash).presentationView).toMatchObject({
        route: 'list',
        filters: { query: 'review' },
      });
      expect(screen.queryByText('Filter link copied.')).toBeNull();
    },
  );

  it('uses canonical focusId to select the real item without a Plan mutation', async () => {
    const { container } = render(<View view={{ ...FIXTURE_VIEW, focusId: FIXTURE_SECOND }} />);
    await waitFor(() => expect(screen.getByTestId('selection').textContent).toBe(FIXTURE_SECOND));
    expect(
      container
        .querySelector(`tr[data-keyboard-item="${FIXTURE_SECOND}"]`)
        ?.getAttribute('data-selected'),
    ).toBe('true');
  });

  it('explains a missing focus item while preserving the shared filters', () => {
    const { container } = render(<View view={{ ...FIXTURE_VIEW, focusId: 'T-929' }} />);
    expect(
      screen.getByText('The focused item T-929 is unavailable in this snapshot.'),
    ).toBeTruthy();
    expect(rowIds(container)).toEqual([FIXTURE_SECOND, FIXTURE_FIRST]);
    expect(
      screen.getByRole('textbox', { name: 'Filter by id or title' }).getAttribute('value'),
    ).toBe('review');
  });

  it('resets remembered filters when a malformed token replaces a valid URL view', async () => {
    const { container, rerender } = render(<View />);
    expect(rowIds(container)).toHaveLength(2);
    rerender(<View view={null} invalidView />);
    expect(rowIds(container)).toHaveLength(5);
    expect(
      screen.getByRole('textbox', { name: 'Filter by id or title' }).getAttribute('value'),
    ).toBe('');
    expect(
      screen.getByRole('button', { name: 'Compact', exact: true }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('passes the shell clipboard adapter to the real List presentation provider', async () => {
    const user = userEvent.setup();
    const current = fixture();
    const copy = vi.fn(async (_text: string) => undefined);
    render(
      <DashboardProviders
        buildId="fixture-list"
        initialHash={serializePlanningViewHref(FIXTURE_VIEW)}
        binding={current.binding}
        projection={current.state}
        planningProjection={current.state}
        connection={{ state: 'connected', label: 'Connected', reason: 'Fixture ready' }}
        bootPhase="compatible"
      >
        <UnifiedShell
          adapters={{ copy, loadSingleLetters: () => true, saveSingleLetters: () => undefined }}
        />
      </DashboardProviders>,
    );
    await openListOptions(user);
    await user.click(screen.getByRole('button', { name: 'Copy filter link' }));
    expect(copy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Filter link copied.')).toBeTruthy();
  });

  it('keeps the base List usable and explains a malformed view token', () => {
    const current = fixture();
    render(
      <DashboardProviders
        buildId="fixture-list"
        initialHash="#/list?v=malformed"
        binding={current.binding}
        projection={current.state}
        planningProjection={current.state}
        connection={{ state: 'connected', label: 'Connected', reason: 'Fixture ready' }}
        bootPhase="compatible"
      >
        <UnifiedShell />
      </DashboardProviders>,
    );
    expect(
      screen.getByText('This view link is invalid or unsupported. Default filters are shown.'),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'List', level: 1 })).toBeTruthy();
    expect(screen.queryByText('Destination not available')).toBeNull();
    expect(
      screen.getByRole('textbox', { name: 'Filter by id or title' }).getAttribute('value'),
    ).toBe('');
    expect(
      screen.getAllByRole('row').filter((row) => row.hasAttribute('data-keyboard-item')),
    ).toHaveLength(5);
  });
});

function LiveShell({ current }: { current: ReturnType<typeof fixture> }) {
  return (
    <DashboardProviders
      buildId="live-list-fixture"
      initialHash="#/list"
      binding={current.binding}
      projection={current.state}
      planningProjection={current.state}
      connection={{ state: 'connected', label: 'Connected', reason: 'Verified fixture' }}
      bootPhase="compatible"
    >
      <UnifiedShell />
    </DashboardProviders>
  );
}

describe('List live refetch retention', () => {
  it.each(['representative', 'scaling'] as const)(
    'retains filters, sorting, pagination, row DOM, selection, focus and scroll for %s data',
    async (dataset) => {
      const user = userEvent.setup();
      const nodes = buildPremiumDashboardFixture(dataset).graph.nodes;
      const { container, rerender } = render(<LiveShell current={fixture(nodes)} />);
      await user.click(screen.getByRole('combobox', { name: /^Filter by status:/u }));
      await user.click(screen.getByRole('option', { name: 'Outstanding', exact: true }));
      await user.keyboard('{Escape}');
      await user.type(screen.getByRole('textbox', { name: 'Filter by id or title' }), 'Fixture');
      await user.click(screen.getByRole('button', { name: 'Updated' }));
      await user.click(screen.getByRole('button', { name: 'Next' }));
      const ids = rowIds(container);
      const row = container.querySelector<HTMLElement>(`tr[data-keyboard-item="${ids[0]}"]`);
      if (!row) throw new Error('Expected a second-page item');
      act(() => row.focus());
      const scroll = container.querySelector<HTMLElement>('.pc-shell__scroll');
      const table = container.querySelector<HTMLElement>('.pc-table-wrap');
      if (!scroll || !table) throw new Error('Expected scroll containers');
      scroll.scrollTop = 30;
      table.scrollLeft = 21;
      const assertRetained = () => {
        expect(container.querySelector(`tr[data-keyboard-item="${ids[0]}"]`)).toBe(row);
        expect(row.dataset.selected).toBe('true');
        expect(document.activeElement).toBe(row);
        expect(scroll.scrollTop).toBe(30);
        expect(table.scrollLeft).toBe(21);
        expect(rowIds(container)).toEqual(ids);
        expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Fixture');
        expect(screen.getByRole('combobox', { name: /^Filter by type:/u }).textContent).toContain(
          'All types',
        );
        expect(screen.getByRole('combobox', { name: /^Filter by status:/u }).textContent).toContain(
          'Outstanding',
        );
        expect(
          screen.getByRole('navigation', { name: 'Planning artifact pages' }).textContent,
        ).toContain('Page 2');
        expect(container.querySelector('th[aria-sort="ascending"]')?.textContent).toContain(
          'Updated',
        );
        expect(container.querySelector('.op-route-pending')).toBeNull();
      };
      rerender(<LiveShell current={fixture(nodes, 'refreshing')} />);
      assertRetained();
      const patched = nodes.map((node) =>
        node.id === ids[0]
          ? {
              ...node,
              title: 'Fixture changed on disk',
              frontmatter: { ...node.frontmatter, updated: '2000-01-01' },
            }
          : node,
      );
      rerender(<LiveShell current={fixture(patched, 'ready', 1)} />);
      assertRetained();
      expect(row.textContent).toContain('Fixture changed on disk');
      expect(row.getAttribute('data-live-changed')).toMatch(/^wash-/u);
      expect(screen.getByText('1 item changed on disk')).toBeTruthy();
      const show = screen.getByRole('link', { name: 'Show Filed since yesterday' });
      const preset = parseDashboardLocation(show.getAttribute('href') ?? '').presentationView;
      expect(preset).toMatchObject({
        route: 'list',
        groupBy: 'label',
        filters: { type: ['backlog'], createdWithinDays: 2 },
      });
      const revision = row.getAttribute('data-live-changed');
      rerender(<LiveShell current={fixture(patched, 'ready', 1)} />);
      expect(row.getAttribute('data-live-changed')).toBe(revision);
      await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
      expect(screen.queryByText('1 item changed on disk')).toBeNull();
      expect(document.activeElement).toBe(row);
    },
  );

  it('washes each accepted change for 1600 ms, coalesces disk feedback and ignores repeated heads', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<LiveShell current={fixture()} />);
    const patched = FIXTURE_NODES.map((node) =>
      node.id === FIXTURE_FIRST ? { ...node, title: 'Changed once' } : node,
    );
    rerender(<LiveShell current={fixture(patched, 'ready', 1)} />);
    const row = container.querySelector<HTMLElement>(`tr[data-keyboard-item="${FIXTURE_FIRST}"]`);
    const marker = row?.getAttribute('data-live-changed');
    expect(marker).toMatch(/^wash-/u);
    act(() => vi.advanceTimersByTime(1599));
    expect(row?.getAttribute('data-live-changed')).toBe(marker);
    rerender(<LiveShell current={fixture(patched, 'ready', 1)} />);
    act(() => vi.advanceTimersByTime(1));
    expect(row?.hasAttribute('data-live-changed')).toBe(false);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText('1 item changed on disk')).toBeTruthy();
    const next = patched.map((node) =>
      node.id === FIXTURE_SECOND ? { ...node, title: 'Another change' } : node,
    );
    rerender(<LiveShell current={fixture(next, 'ready', 2)} />);
    expect(screen.getByText('2 items changed on disk')).toBeTruthy();
    expect(screen.getAllByLabelText('Notification')).toHaveLength(1);
  });

  it('uses a persistent changed dot under reduced motion until viewed', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addListener: vi.fn(), removeListener: vi.fn() })),
    );
    const { container, rerender } = render(<LiveShell current={fixture()} />);
    const patched = FIXTURE_NODES.map((node) =>
      node.id === FIXTURE_FIRST ? { ...node, title: 'Changed title' } : node,
    );
    rerender(<LiveShell current={fixture(patched, 'ready', 1)} />);
    const row = container.querySelector<HTMLElement>(`tr[data-keyboard-item="${FIXTURE_FIRST}"]`);
    expect(row?.getAttribute('data-live-changed')).toBe('dot');
    expect(row?.getAttribute('aria-description')).toBe('Changed on disk');
    act(() => row?.focus());
    expect(row?.hasAttribute('data-live-changed')).toBe(false);
    expect(screen.getByText('1 item changed on disk')).toBeTruthy();
  });

  it('moves selection and focus to the next row when the selected item is removed', () => {
    const { container, rerender } = render(<LiveShell current={fixture()} />);
    const ids = rowIds(container);
    const row = container.querySelector<HTMLElement>(`tr[data-keyboard-item="${ids[0]}"]`);
    act(() => row?.focus());
    rerender(
      <LiveShell
        current={fixture(
          FIXTURE_NODES.filter((node) => node.id !== ids[0]),
          'ready',
          1,
        )}
      />,
    );
    const next = container.querySelector<HTMLElement>(`tr[data-keyboard-item="${ids[1]}"]`);
    expect(next?.dataset.selected).toBe('true');
    expect(document.activeElement).toBe(next);
    expect(screen.getByText(new RegExp(`${ids[0]} was removed`))).toBeTruthy();
  });

  it('shows first-load geometry and clears presentation across a changed binding', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(
      <LiveShell current={fixture(FIXTURE_NODES, 'loading')} />,
    );
    expect(container.querySelector('.op-route-pending')).toBeTruthy();
    rerender(<LiveShell current={fixture()} />);
    await user.type(screen.getByRole('textbox'), 'Alpha');
    rerender(<LiveShell current={fixture(FIXTURE_NODES, 'loading', 0, 2)} />);
    expect(container.querySelector('.op-route-pending')).toBeTruthy();
    rerender(<LiveShell current={fixture(FIXTURE_NODES, 'ready', 0, 2)} />);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(/items? changed on disk/u)).toBeNull();
  });

  it('clears all no-match filters including URL priority and label constraints', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <View view={{ ...FIXTURE_VIEW, filters: { ...FIXTURE_VIEW.filters, query: 'No match' } }} />,
    );
    expect(screen.getByText('Nothing matches “No match”')).toBeTruthy();
    await openListOptions(user);
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(rowIds(container)).toHaveLength(FIXTURE_NODES.length);
  });
});

describe('List triage, bounded windows and command-only selection', () => {
  it('virtualizes against shell scrolling and keeps its header aligned at a nonzero table offset', () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('pc-shell__scroll') ? 600 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.tagName === 'TABLE' ? 4436 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const shell = this.closest<HTMLElement>('.pc-shell__scroll');
      if (this.classList.contains('pc-shell__scroll')) return new DOMRect(0, 60, 900, 600);
      if (this.classList.contains('pc-list__window'))
        return new DOMRect(0, 380 - (shell?.scrollTop ?? 0), 900, 4436);
      const id = this.dataset.keyboardItem;
      if (id)
        return new DOMRect(
          0,
          416 + (Number(id.slice(2)) - 1000) * 44 - (shell?.scrollTop ?? 0),
          900,
          44,
        );
      return new DOMRect();
    });
    const nodes = Array.from({ length: 150 }, (_, index) =>
      node(`T-${1000 + index}`, `Task ${index}`),
    );
    const view: PlanningView = {
      ...FIXTURE_VIEW,
      filters: {
        ...FIXTURE_VIEW.filters,
        type: [],
        status: [],
        priority: [],
        label: [],
        query: '',
      },
      sort: { field: 'id', direction: 'asc' },
    };
    const content = (items: readonly PlanningNode[]) => (
      <div className="pc-shell__scroll">
        <View nodes={items} view={view} />
      </div>
    );
    const { container, rerender } = render(content(nodes));
    const shell = container.querySelector<HTMLElement>('.pc-shell__scroll');
    const window = container.querySelector<HTMLElement>('.pc-list__window');
    if (!shell || !window) throw new Error('Missing shell List viewport');
    expect(rowIds(container)[0]).toBe('T-1000');
    fireEvent.scroll(shell, { target: { scrollTop: 1200 } });
    expect(rowIds(container)[0]).toBe('T-1015');
    expect(rowIds(container).length).toBeLessThanOrEqual(24);
    expect(window.scrollTop).toBe(0);
    expect(container.querySelector('thead')?.style.transform).toBe('translateY(880px)');
    const first = container.querySelector<HTMLElement>('[data-keyboard-item="T-1015"]');
    if (!first) throw new Error('Expected a shell-visible List row');
    act(() => first.focus());
    rerender(
      content(
        nodes.map((item) => (item.id === 'T-1015' ? { ...item, title: 'Patched task' } : item)),
      ),
    );
    expect(container.querySelector('[data-keyboard-item="T-1015"]')).toBe(first);
    expect(document.activeElement).toBe(first);
    expect(shell.scrollTop).toBe(1200);
    expect(window.scrollTop).toBe(0);
  });

  it('counts grouped header rows consistently while virtualizing artifact rows', () => {
    const nodes = [
      node('SPEC-901', 'Delivery', {}, 'outstanding', 'spec'),
      ...Array.from({ length: 150 }, (_, index) =>
        node(`SPEC-901/T-${1000 + index}`, `Task ${index}`, { specId: 'SPEC-901' }),
      ),
    ];
    const { container } = render(<View nodes={nodes} view={null} />);
    const table = screen.getByRole('table', { name: 'Planning artifacts' });
    expect(table.getAttribute('aria-rowcount')).toBe('153');
    expect(table.querySelector('.pc-table__group-header')?.getAttribute('aria-rowindex')).toBe('2');
    expect(table.querySelector('[data-keyboard-item]')?.getAttribute('aria-rowindex')).toBe('3');
    expect(rowIds(container).length).toBeLessThanOrEqual(24);
    const scroller = container.querySelector('.pc-list__window');
    if (!scroller) throw new Error('Missing grouped List window');
    fireEvent.scroll(scroller, { target: { scrollTop: 3000 } });
    const index = Number(
      table.querySelector('[data-keyboard-item]')?.getAttribute('aria-rowindex'),
    );
    expect(index).toBeGreaterThan(3);
    expect(index).toBeLessThanOrEqual(153);
    expect(table.getAttribute('aria-rowcount')).toBe('153');
  });

  function coordinate(container: HTMLElement, singleLetters = true) {
    return installKeyboardCoordinator(document, () => ({
      root: container,
      selectionScope: 'list-window',
      singleLetters,
      paletteOpen: false,
      togglePalette: () => undefined,
      openHelp: () => undefined,
      navigate: () => undefined,
      closeInspector: () => false,
      selectedId: () => null,
      copy: async () => undefined,
      announce: () => undefined,
    }));
  }

  it.each(['representative', 'scaling'] as const)(
    'offers every preset and bounded grouped windows on %s',
    async (dataset) => {
      const user = userEvent.setup();
      const nodes = buildPremiumDashboardFixture(dataset).graph.nodes;
      const { container } = render(<View nodes={nodes} view={null} />);
      for (const name of [
        'All',
        'Open, by spec',
        'High priority',
        'Blocked',
        'ADRs',
        'Filed today',
        'Filed since yesterday',
      ]) {
        if (name.startsWith('Filed ')) {
          await openListOptions(user);
          await user.click(screen.getByRole('combobox', { name: /^Date preset:/u }));
          await user.click(screen.getByRole('option', { name, exact: true }));
        } else {
          await user.click(
            screen.getByRole('tab', {
              name: new RegExp(`^${name}(?: \\d+)?$`, 'u'),
            }),
          );
        }
        expect(rowIds(container).length).toBeLessThanOrEqual(100);
        const ids = rowIds(container);
        const shown = nodes.filter((node) => ids.includes(node.id));
        if (name === 'ADRs') expect(shown.every((node) => node.type === 'adr')).toBe(true);
        if (name === 'Blocked') expect(shown.every((node) => node.status === 'blocked')).toBe(true);
        if (name === 'Open, by spec')
          expect(shown.every((node) => !['done', 'addressed'].includes(node.status))).toBe(true);
        expect(screen.queryByRole('button', { name: /Save view/u })).toBeNull();
      }
    },
  );

  it.each(['representative', 'scaling'] as const)(
    'bounds mounted %s rows and retains the focused row outside the viewport through a patch',
    (dataset) => {
      const nodes = buildPremiumDashboardFixture(dataset).graph.nodes;
      const view = {
        ...FIXTURE_VIEW,
        filters: {
          ...FIXTURE_VIEW.filters,
          type: [],
          status: [],
          priority: [],
          label: [],
          query: '',
        },
        sort: { field: 'id' as const, direction: 'asc' as const },
      };
      const { container, rerender } = render(<View nodes={nodes} view={view} />);
      expect(rowIds(container).length).toBeLessThanOrEqual(24);
      const first = container.querySelector<HTMLElement>('[data-keyboard-item]');
      const scroller = container.querySelector<HTMLElement>('.pc-list__window');
      if (!first || !scroller) throw new Error('Missing list viewport.');
      const id = first.dataset.keyboardItem;
      act(() => first.focus());
      fireEvent.scroll(scroller, { target: { scrollTop: 3000 } });
      expect(rowIds(container).length).toBeLessThanOrEqual(25);
      expect(document.activeElement).toBe(first);
      expect(first.isConnected).toBe(true);
      expect(first.closest('table')?.getAttribute('aria-rowcount')).toBe(String(nodes.length + 1));
      const patched = nodes.map((node) =>
        node.id === id ? { ...node, title: 'Accepted live title' } : node,
      );
      rerender(<View nodes={patched} view={view} />);
      expect(container.querySelector(`[data-keyboard-item="${id}"]`)).toBe(first);
      expect(document.activeElement).toBe(first);
      expect(first.textContent).toContain('Accepted live title');
      expect(scroller.scrollTop).toBe(3000);
    },
  );

  it('walks across page boundaries, selects a range and retains the full position/count', () => {
    const nodes = Array.from({ length: 110 }, (_, index) =>
      node(`BL-${1000 + index}`, `Finding ${index}`, {}, 'outstanding', 'backlog'),
    );
    const { container } = render(
      <View
        nodes={nodes}
        view={{
          ...FIXTURE_VIEW,
          filters: { ...FIXTURE_VIEW.filters, type: [], status: [], priority: [], query: '' },
          sort: { field: 'id', direction: 'asc' },
        }}
      />,
    );
    const dispose = coordinate(container);
    try {
      const scroller = container.querySelector<HTMLElement>('.pc-list__window');
      if (!scroller) throw new Error('Missing list window.');
      fireEvent.scroll(scroller, { target: { scrollTop: 44 + 100 * 44 - 560 } });
      const last = container.querySelector<HTMLElement>('[data-keyboard-item="BL-1099"]');
      expect(last).not.toBeNull();
      act(() => last?.focus());
      fireEvent.keyDown(last ?? container, { key: ' ' });
      fireEvent.keyDown(last ?? container, { key: 'ArrowDown', shiftKey: true });
      const next = container.querySelector<HTMLElement>('[data-keyboard-item="BL-1100"]');
      expect(document.activeElement).toBe(next);
      expect(next?.getAttribute('aria-rowindex')).toBe('102');
      expect(next?.closest('table')?.getAttribute('aria-rowcount')).toBe('111');
      expect(next?.getAttribute('aria-selected')).toBe('true');
      expect(screen.getByText('BL-1100, 101 of 110')).toBeTruthy();
      expect(screen.getByText('2 selected · 2 eligible · 0 skipped')).toBeTruthy();
      fireEvent.keyDown(next ?? container, { key: 'k' });
      expect(document.activeElement?.getAttribute('data-keyboard-item')).toBe('BL-1099');
      expect(document.activeElement?.getAttribute('aria-selected')).toBe('true');
      fireEvent.keyDown(document.activeElement ?? container, { key: 'Escape' });
      expect(screen.getByText('0 selected · 0 eligible · 0 skipped')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('copies registered backlog status commands once, skips scoped tasks, and exposes clipboard failure', async () => {
    const user = userEvent.setup();
    const copy = vi.fn(async () => {
      throw new Error('denied');
    });
    const nodes = [
      node('BL-910', 'Finding', {}, 'outstanding', 'backlog'),
      node('SPEC-901/T-910', 'Task'),
    ];
    const { container } = render(<View nodes={nodes} view={null} onCopy={copy} />);
    await openListOptions(user);
    await user.click(screen.getByRole('button', { name: 'Select all 2 filtered' }));
    expect(screen.getByText('2 selected · 1 eligible · 1 skipped')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Copy bulk commands' }));
    expect(copy).toHaveBeenCalledExactlyOnceWith(
      'openplanr backlog update BL-910 --status in-progress',
    );
    expect(
      screen.getByText(
        'Copy blocked. Select and copy manually: openplanr backlog update BL-910 --status in-progress',
      ),
    ).toBeTruthy();
    expect(container.textContent).not.toContain('openplanr task update');
    await user.click(screen.getByRole('button', { name: 'Copy sprint command' }));
    expect(copy).toHaveBeenLastCalledWith('/planr:sprint');
  });

  it('keeps Cmd/Ctrl-click native and preserves selection through patches/removals', async () => {
    const user = userEvent.setup();
    const nodes = [
      node('BL-910', 'First', {}, 'outstanding', 'backlog'),
      node('BL-911', 'Second', {}, 'outstanding', 'backlog'),
    ];
    const { container, rerender } = render(<View nodes={nodes} view={null} />);
    await openListOptions(user);
    await user.click(screen.getByRole('button', { name: 'Select all 2 filtered' }));
    const row = container.querySelector('[data-keyboard-item="BL-910"]');
    const link = row?.querySelector('a');
    if (!link) throw new Error('Expected canonical item link');
    expect(link.getAttribute('href')).toBe('#/detail/BL-910');
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    rerender(<View nodes={[{ ...nodes[0], title: 'Patched' }, nodes[1]]} view={null} />);
    expect(container.querySelector('[data-keyboard-item="BL-910"]')).toBe(row);
    expect(row?.getAttribute('aria-selected')).toBe('true');
    rerender(<View nodes={[nodes[1]]} view={null} />);
    expect(screen.getByText('1 selected · 1 eligible · 0 skipped')).toBeTruthy();
  });

  it('recovers hidden done matches and distinguishes addressed groups', async () => {
    const user = userEvent.setup();
    const nodes = [
      node('BL-910', 'Done finding', {}, 'done', 'backlog'),
      node('BL-911', 'Addressed finding', {}, 'addressed', 'backlog'),
    ];
    const { container } = render(<View nodes={nodes} view={null} />);
    await user.click(screen.getByRole('tab', { name: /^Open, by spec/u }));
    expect(screen.getByRole('button', { name: 'Show 1 done matches' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show 1 done matches' }));
    expect(rowIds(container)).toEqual(['BL-910']);
    expect(container.querySelector('[data-done="true"]')).toBeTruthy();
    await openListOptions(user);
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await user.click(screen.getByRole('combobox', { name: /^Group by:/u }));
    await user.click(screen.getByRole('option', { name: 'Group: Status', exact: true }));
    expect(screen.getByRole('rowgroup', { name: 'addressed' })).toBeTruthy();
    expect(screen.getByRole('rowgroup', { name: 'done' })).toBeTruthy();
  });

  it('diagnoses missing/future dates and clears multi-status preset constraints', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    const user = userEvent.setup();
    const nodes = [
      node('BL-910', 'Today', { created: '2026-10-19' }, 'done', 'backlog'),
      node('BL-911', 'Unknown', {}, 'outstanding', 'backlog'),
      node('BL-912', 'Future', { created: '2026-10-19T14:00:00Z' }, 'outstanding', 'backlog'),
    ];
    const { container } = render(<View nodes={nodes} view={null} />);
    await openListOptions(user);
    await user.click(screen.getByRole('combobox', { name: /^Date preset:/u }));
    await user.click(screen.getByRole('option', { name: 'Filed today', exact: true }));
    expect(rowIds(container)).toEqual(['BL-910']);
    expect(
      screen.getByText('2 items excluded: unknown, invalid or future authored dates.'),
    ).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: /^Open, by spec/u }));
    await user.click(screen.getByRole('combobox', { name: /^Filter by status:/u }));
    await user.click(screen.getByRole('button', { name: 'Clear Filter by status', exact: true }));
    await user.keyboard('{Escape}');
    expect(rowIds(container)).toHaveLength(3);
  });
});

describe('List density and URL focus recovery', () => {
  it('loads project-scoped density and handles denied storage without discarding the choice', async () => {
    const user = userEvent.setup();
    const preferences = {
      load: vi.fn(() => 'compact'),
      save: vi.fn(() => {
        throw new Error('quota');
      }),
    };
    const { container } = render(<View view={null} preferences={preferences} />);
    expect(container.querySelector('table')?.getAttribute('data-compact')).toBe('true');
    expect(preferences.load).toHaveBeenCalledWith(`op-density:v1:${fixture().binding.projectId}`);
    await user.click(screen.getByRole('button', { name: 'Compact', exact: true }));
    expect(container.querySelector('table')?.hasAttribute('data-compact')).toBe(false);
    expect(preferences.save).toHaveBeenCalledWith(
      `op-density:v1:${fixture().binding.projectId}`,
      'comfortable',
    );
    expect(
      screen.getByText('Density changed for this session. Browser storage is unavailable.'),
    ).toBeTruthy();
  });

  it('lets URL density override a stored preference and mounts a focused item beyond the first window', () => {
    const nodes = Array.from({ length: 150 }, (_, index) =>
      node(`T-${1000 + index}`, `Review ${index}`),
    );
    const view = {
      ...FIXTURE_VIEW,
      focusId: 'T-1149',
      filters: { ...FIXTURE_VIEW.filters, query: '' },
      sort: { field: 'id' as const, direction: 'asc' as const },
    };
    const { container } = render(
      <View
        nodes={nodes}
        view={view}
        preferences={{ load: () => 'comfortable', save: () => undefined }}
      />,
    );
    expect(container.querySelector('table')?.getAttribute('data-compact')).toBe('true');
    expect(
      container.querySelector('[data-keyboard-item="T-1149"]')?.getAttribute('data-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('navigation', { name: 'Planning artifact pages' }).textContent,
    ).toContain('Page 2');
  });

  it('uses canonical IDs to break equal sort values and reports full-spec task progress', async () => {
    const user = userEvent.setup();
    const nodes = [
      node('SPEC-901', 'A spec', {}, 'outstanding', 'spec'),
      node('SPEC-901/T-902', 'Same title', { specId: 'SPEC-901' }, 'done'),
      node('SPEC-901/T-901', 'Same title', { specId: 'SPEC-901' }),
    ];
    const { container } = render(<View nodes={nodes} view={null} />);
    await user.click(screen.getByRole('combobox', { name: /^Group by:/u }));
    await user.click(screen.getByRole('option', { name: 'Group: Spec', exact: true }));
    expect(screen.getByText('1/2 tasks', { exact: false })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Title' }));
    expect(rowIds(container).filter((id) => id.includes('/'))).toEqual([
      'SPEC-901/T-901',
      'SPEC-901/T-902',
    ]);
  });
});

it('completes filed-findings triage with keyboard selection and copy precedence', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
  const user = userEvent.setup();
  const copy = vi.fn(async (_text: string) => undefined);
  const nodes = [
    node(
      'BL-910',
      'First finding',
      { created: '2026-10-18', labels: ['ship'] },
      'outstanding',
      'backlog',
    ),
    node(
      'BL-911',
      'Second finding',
      { created: '2026-10-19', labels: ['ship'] },
      'outstanding',
      'backlog',
    ),
  ];
  const { container } = render(<View nodes={nodes} view={null} onCopy={copy} />);
  const dispose = installKeyboardCoordinator(document, () => ({
    root: container,
    selectionScope: 'triage',
    singleLetters: true,
    paletteOpen: false,
    togglePalette: () => undefined,
    openHelp: () => undefined,
    navigate: () => undefined,
    closeInspector: () => false,
    selectedId: () => null,
    copy,
    announce: () => undefined,
  }));
  try {
    await openListOptions(user);
    await user.click(screen.getByRole('combobox', { name: /^Date preset:/u }));
    await user.click(screen.getByRole('option', { name: 'Filed since yesterday', exact: true }));
    expect(screen.getByRole('rowgroup', { name: 'ship' })).toBeTruthy();
    const first = container.querySelector<HTMLElement>('[data-keyboard-item]');
    act(() => first?.focus());
    fireEvent.keyDown(first ?? container, { key: 'j' });
    const selected = document.activeElement as HTMLElement;
    fireEvent.keyDown(selected, { key: ' ' });
    const bulk = screen.getByRole('button', { name: 'Copy bulk commands' });
    act(() => bulk.focus());
    fireEvent.keyDown(bulk, { key: 'c' });
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith(
        `openplanr backlog update ${selected.dataset.keyboardItem} --status in-progress`,
      ),
    );
    const sprint = screen.getByRole('button', { name: 'Copy sprint command' });
    act(() => sprint.focus());
    fireEvent.keyDown(sprint, { key: 'c' });
    await waitFor(() => expect(copy).toHaveBeenLastCalledWith('/planr:sprint'));
  } finally {
    dispose();
  }
});

it('shows short dates with full descriptions and copies a row command without opening it', async () => {
  const user = userEvent.setup();
  const copy = vi.fn(async () => undefined);
  const nodes = [node('BL-910', 'Finding', { updated: '2026-10-19' }, 'outstanding', 'backlog')];
  const { container } = render(<View nodes={nodes} view={null} onCopy={copy} />);
  const row = container.querySelector<HTMLElement>('[data-keyboard-item="BL-910"]');
  if (!row) throw new Error('Expected the planning row.');
  const openTick = screen.getByTestId('selection').getAttribute('data-open-tick');
  const date = within(row).getByRole('button', { name: /19 Oct.*Updated 2026-10-19/u });
  expect(date.getAttribute('aria-describedby')).toBeTruthy();
  await user.click(date);
  expect(row.dataset.selected).toBe('true');
  expect(screen.getByTestId('selection').getAttribute('data-open-tick')).toBe(openTick);
  await user.click(within(row).getByRole('button', { name: 'Copy command for BL-910' }));
  expect(copy).toHaveBeenCalledExactlyOnceWith('openplanr status BL-910 --md');
  expect(screen.getByTestId('selection').getAttribute('data-open-tick')).toBe(openTick);
});
