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
    <output data-testid="selection">
      {store.selection?.kind === 'node' ? store.selection.id : 'none'}
    </output>
  );
}

function View({
  nodes = FIXTURE_NODES,
  view = FIXTURE_VIEW,
  invalidView = false,
  onCopy,
}: {
  nodes?: readonly PlanningNode[];
  view?: PlanningView | null;
  invalidView?: boolean;
  onCopy?: (text: string) => Promise<void>;
}) {
  const current = fixture(nodes);
  return (
    <PlanningPresentationProvider
      scope="fixture-list"
      view={view}
      invalidView={invalidView}
      onCopy={onCopy}
    >
      <ListPage currentBinding={current.binding} current={current.state} />
      <Selection />
    </PlanningPresentationProvider>
  );
}

function rowIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('tbody tr[data-keyboard-item]')).map(
    (row) => row.dataset.keyboardItem ?? '',
  );
}

afterEach(() => {
  cleanup();
  clearInspector();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('List presentation tokens against validated projections', () => {
  it('applies URL filter, density, sorting and grouping without changing the bound graph', () => {
    const { container, rerender } = render(<View />);
    expect(rowIds(container)).toEqual([FIXTURE_SECOND, FIXTURE_FIRST]);
    expect(
      screen.getByRole('textbox', { name: 'Filter by id or title' }).getAttribute('value'),
    ).toBe('review');
    expect((screen.getByRole('switch', { name: 'Compact' }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(container.querySelector('table')?.getAttribute('data-compact')).toBe('true');
    expect(container.querySelector('h1')?.parentElement?.textContent).toContain('2 of 5');
    rerender(<View view={{ ...FIXTURE_VIEW, groupBy: 'label' }} />);
    const ready = screen.getByRole('region', { name: 'ready' });
    const review = screen.getByRole('region', { name: 'review' });
    expect(rowIds(ready)).toEqual([FIXTURE_SECOND, FIXTURE_FIRST]);
    expect(rowIds(review)).toEqual([FIXTURE_FIRST]);
    expect(container.querySelector('h1')?.parentElement?.textContent).toContain('2 of 5');
    expect(screen.queryByText('Blocked review')).toBeNull();
  });

  it('collapses and expands the focused List label group without affecting its neighbours', () => {
    const { container } = render(<View view={{ ...FIXTURE_VIEW, groupBy: 'label' }} />);
    const ready = screen.getByRole('region', { name: 'ready' });
    const review = screen.getByRole('region', { name: 'review' });
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

  it('caps all grouped table appearances at 100 per page while global counts deduplicate labels', async () => {
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
    const visited = [...rowIds(container)];
    expect(visited).toHaveLength(100);
    expect(
      screen.getByRole('navigation', { name: 'Planning artifact pages' }).textContent,
    ).toContain('Page 1 of 3');
    expect(container.querySelector('h1')?.parentElement?.textContent).toContain('105 of 105');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(rowIds(container)).toHaveLength(100);
    visited.push(...rowIds(container));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(rowIds(container)).toHaveLength(10);
    visited.push(...rowIds(container));
    expect(visited).toHaveLength(210);
    expect(new Set(visited).size).toBe(105);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    for (const id of new Set(visited))
      expect(visited.filter((entry) => entry === id)).toHaveLength(2);
  });

  it('copies current presentation through the injected adapter, without binding or authority', async () => {
    const user = userEvent.setup();
    const copy = vi.fn(async (_text: string) => undefined);
    render(<View onCopy={copy} />);
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'Alpha');
    await user.click(screen.getByRole('switch', { name: 'Compact' }));
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
    expect((screen.getByRole('switch', { name: 'Compact' }) as HTMLInputElement).checked).toBe(
      false,
    );
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
      await user.selectOptions(
        screen.getByRole('combobox', { name: 'Filter by status' }),
        'outstanding',
      );
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
        expect(
          (screen.getByRole('combobox', { name: 'Filter by type' }) as HTMLSelectElement).value,
        ).toBe('all');
        expect(
          (screen.getByRole('combobox', { name: 'Filter by status' }) as HTMLSelectElement).value,
        ).toBe('outstanding');
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
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(rowIds(container)).toHaveLength(FIXTURE_NODES.length);
  });
});
