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

function fixture(nodes: readonly PlanningNode[] = FIXTURE_NODES) {
  const graph: PlanningGraph = { nodes, edges: [] };
  const eventHead = { sequence: 0, hash: null };
  const viewHash = sha256Jcs(graph as never);
  const root = {
    actorId: 'fixture-list-owner',
    projectId: `sha256:${'d'.repeat(64)}`,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    generation: 1,
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
      mode: 'empty',
      graph,
    },
    binding,
  );
  const state = parseDashboardProductState<PlanningGraphEnvelope>(
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
