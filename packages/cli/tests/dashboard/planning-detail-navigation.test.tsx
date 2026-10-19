// @vitest-environment jsdom

import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import {
  parseDashboardLocation,
  serializeDashboardRoute,
} from '../../../../apps/dashboard/src/app/router.js';
import {
  type PlanningGraph,
  type PlanningGraphEnvelope,
  parsePlanningGraphEnvelope,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import { inspectPlanningNode } from '../../../../apps/dashboard/src/features/planning/planning-inspector.js';
import { clearInspector } from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import {
  type PlanningView,
  serializePlanningViewHref,
} from '../../../../apps/dashboard/src/lib/routing/planning-view-codec.js';

const sourceView: PlanningView = {
  schemaVersion: '1.0.0',
  route: 'list',
  filters: {
    type: ['task'],
    status: [],
    priority: [],
    label: [],
    query: 'Review',
    createdWithinDays: null,
    updatedWithinDays: null,
  },
  groupBy: 'status',
  sort: { field: 'id', direction: 'desc' },
  density: 'compact',
  focusId: null,
};
const sourceHref = serializePlanningViewHref(sourceView);
const taskIds = ['SPEC-026/T-003', 'SPEC-026/T-002', 'SPEC-026/T-001'];
let fixtureSequence = 0;

function fixture() {
  fixtureSequence += 1;
  const graph: PlanningGraph = {
    nodes: [
      {
        id: 'SPEC-026',
        type: 'spec',
        title: 'Inspection specification',
        status: 'in-progress',
        frontmatter: {},
      },
      ...taskIds.map((id, index) => ({
        id,
        type: 'task' as const,
        title: `Review artifact ${3 - index}`,
        status: 'outstanding' as const,
        frontmatter: {
          id: id.split('/')[1],
          specId: 'SPEC-026',
          status: 'pending',
          sourcePath: `.planr/tasks/task-${3 - index}.md`,
        },
      })),
    ],
    edges: taskIds.map((to) => ({ from: 'SPEC-026', to, kind: 'contains' as const })),
  };
  const binding = {
    actorId: `detail-navigation-${fixtureSequence}`,
    projectId: `sha256:${'c'.repeat(64)}`,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    generation: 6,
  };
  return {
    kind: 'planning-graph-snapshot' as const,
    schemaVersion: '1.0.0' as const,
    binding,
    cursor: { eventHead: { sequence: 0, hash: null }, viewHash: sha256Jcs(graph as never) },
    mode: 'spec' as const,
    graph,
  };
}

function revision(snapshot: ReturnType<typeof fixture>) {
  const graph = {
    ...snapshot.graph,
    nodes: snapshot.graph.nodes.map((node) =>
      node.type === 'spec' ? { ...node, title: 'Specification changed on disk' } : node,
    ),
  };
  return {
    ...snapshot,
    graph,
    cursor: {
      eventHead: { sequence: 1, hash: `sha256:${'a'.repeat(64)}` },
      viewHash: sha256Jcs(graph as never),
    },
  };
}

function subscribeHash(notify: () => void) {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
}

const adapters = {
  loadSingleLetters: () => true,
  saveSingleLetters: () => {},
  copy: async () => {},
  railPreference: { initialCompact: false, save: () => {} },
};

function ShellHarness({
  snapshot,
}: {
  snapshot: ReturnType<typeof fixture> | ReturnType<typeof revision>;
}) {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash);
  const state = useMemo(() => {
    const { route } = parseDashboardLocation(hash);
    const binding = createDashboardQueryIdentity({
      ...snapshot.binding,
      productArea: 'planning',
      route: serializeDashboardRoute(route),
      subjectId: route.subjectId,
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
    return { binding, projection };
  }, [hash, snapshot]);
  return (
    <DashboardProviders
      buildId="detail-navigation"
      binding={state.binding}
      projection={state.projection}
      planningProjection={state.projection}
      bootPhase="compatible"
      planningLive={{ state: 'connected', attempt: 0 }}
      connection={{ state: 'connected', label: 'Connected', reason: 'Verified test projection' }}
    >
      <UnifiedShell adapters={adapters} />
    </DashboardProviders>
  );
}

function detail(
  snapshot: ReturnType<typeof fixture> | ReturnType<typeof revision>,
  id: string,
  body = `## Acceptance Criteria\n- Current verified criterion for ${id}.\n\n## Files\n- \`src/detail.ts\`\n`,
) {
  const summary = snapshot.graph.nodes.find((node) => node.id === id);
  const node = { ...summary, body };
  return {
    kind: 'planning-detail',
    schemaVersion: '1.0.0',
    binding: snapshot.binding,
    cursor: snapshot.cursor,
    subjectId: id,
    node,
    nodeHash: sha256Jcs(node as never),
  };
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}

function rows(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      '[data-route-kind="planning.list"] [data-keyboard-item]',
    ),
  ];
}

function inspector() {
  return screen.getByRole('dialog', { name: 'Inspector', exact: true });
}

afterEach(() => {
  cleanup();
  clearInspector();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('Planning detail shell navigation', () => {
  it('renders a resolved inspector dependency with the shared Done label and solid-dot glyph', async () => {
    vi.stubGlobal('innerWidth', 1440);
    const base = fixture();
    const graph: PlanningGraph = {
      nodes: base.graph.nodes.map((node) =>
        node.id === taskIds[0]
          ? { ...node, frontmatter: { ...node.frontmatter, dependsOn: [taskIds[1]] } }
          : node.id === taskIds[1]
            ? { ...node, status: 'done', frontmatter: { ...node.frontmatter, status: 'done' } }
            : node,
      ),
      edges: [...base.graph.edges, { from: taskIds[0], to: taskIds[1], kind: 'depends_on' }],
    };
    const snapshot = {
      ...base,
      graph,
      cursor: { ...base.cursor, viewHash: sha256Jcs(graph as never) },
    };
    window.history.replaceState(null, '', sourceHref);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const id = decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1) ?? '');
        return json(detail(snapshot, id));
      }),
    );
    const view = render(<ShellHarness snapshot={snapshot} />);
    const selected = rows(view.container).find((row) => row.dataset.keyboardItem === taskIds[0]);
    if (!selected) throw new Error('Missing selected List row');
    fireEvent.click(selected);
    await within(inspector()).findByText('Detail verified against the current planning snapshot.');
    const dependencies = within(inspector()).getByRole('region', { name: 'Depends on' });
    const status = within(dependencies).getByText('Done').closest('[data-status]');
    expect(status?.getAttribute('data-status')).toBe('done');
    expect(status?.querySelector('[data-glyph="solid-dot"]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(status?.getAttribute('style')).toContain('var(--pc-status-done-fg)');
    expect(within(dependencies).getByRole('link').getAttribute('href')).toBe(
      '#/detail/SPEC-026%2FT-002',
    );
  });

  it.each([false, true])(
    'copies the canonical scoped ID on a direct detail link with previous selection=%s',
    async (previousSelection) => {
      vi.stubGlobal('innerWidth', 1440);
      const snapshot = fixture();
      const href = '#/detail/SPEC-026%2FT-002';
      window.history.replaceState(null, '', href);
      if (previousSelection) {
        const previous = snapshot.graph.nodes.find((node) => node.id === taskIds[0]);
        if (!previous) throw new Error('Missing previous selection fixture');
        inspectPlanningNode(previous, false);
      }
      const copy = vi.spyOn(adapters, 'copy').mockResolvedValue(undefined);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const id = decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1) ?? '');
          return json(detail(snapshot, id));
        }),
      );
      render(<ShellHarness snapshot={snapshot} />);
      const main = screen.getByRole('main');
      await within(main).findByRole('heading', { name: 'Review artifact 2', level: 1 });
      main.focus();
      fireEvent.keyDown(main, { key: 'c' });
      await waitFor(() => expect(copy).toHaveBeenCalledExactlyOnceWith(taskIds[1]));
      expect(document.activeElement).toBe(main);
      expect(window.location.hash).toBe(href);
    },
  );

  it('moves between real List artifacts with J/K from the shared desktop inspector', async () => {
    vi.stubGlobal('innerWidth', 1440);
    const snapshot = fixture();
    window.history.replaceState(null, '', sourceHref);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const id = decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1) ?? '');
        return json(detail(snapshot, id));
      }),
    );
    const view = render(<ShellHarness snapshot={snapshot} />);
    const tableRows = rows(view.container);
    expect(tableRows.map((row) => row.dataset.keyboardItem)).toEqual(taskIds);
    tableRows[0].focus();
    fireEvent.click(tableRows[0]);
    await within(inspector()).findByText('Detail verified against the current planning snapshot.');
    const copy = within(inspector()).getByRole('button', { name: 'Copy link to item' });
    copy.focus();
    fireEvent.keyDown(copy, { key: 'j' });
    await within(inspector()).findByRole('heading', { name: 'Review artifact 2', exact: true });
    expect(document.activeElement).toBe(tableRows[1]);
    expect(tableRows[1].dataset.selected).toBe('true');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'k' });
    await within(inspector()).findByRole('heading', { name: 'Review artifact 3', exact: true });
    expect(document.activeElement).toBe(tableRows[0]);
    fireEvent.keyDown(tableRows[0], { key: 'j' });
    await within(inspector()).findByRole('heading', { name: 'Review artifact 2', exact: true });
    const latestCopy = within(inspector()).getByRole('button', { name: 'Copy link to item' });
    latestCopy.focus();
    fireEvent.keyDown(latestCopy, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Inspector', exact: true })).toBeNull();
      expect(document.activeElement).toBe(tableRows[1]);
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.activeElement).toBe(tableRows[1]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Show inspector', exact: true }));
    expect(inspector()).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Hide inspector', exact: true }));
    expect(screen.queryByRole('dialog', { name: 'Inspector', exact: true })).toBeNull();
    expect(window.location.hash).toBe(sourceHref);
  });

  it.each([false, true])(
    'promotes and restores source context on Back with local edits=%s',
    async (localEdits) => {
      vi.stubGlobal('innerWidth', 1440);
      const snapshot = fixture();
      window.history.replaceState(null, '', sourceHref);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const id = decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1) ?? '');
          return json(detail(snapshot, id));
        }),
      );
      const view = render(<ShellHarness snapshot={snapshot} />);
      if (localEdits) {
        fireEvent.change(screen.getByRole('textbox', { name: 'Filter by id or title' }), {
          target: { value: 'artifact' },
        });
        fireEvent.change(screen.getByRole('combobox', { name: 'Group by' }), {
          target: { value: 'type' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Title', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Title', exact: true }));
      }
      const expectedOrder = localEdits ? [...taskIds].reverse() : taskIds;
      const tableRows = rows(view.container);
      expect(tableRows.map((row) => row.dataset.keyboardItem)).toEqual(expectedOrder);
      const second = tableRows[1];
      fireEvent.click(second);
      fireEvent.keyDown(second, { key: ' ' });
      expect(second.getAttribute('aria-selected')).toBe('true');
      await within(inspector()).findByText(
        'Detail verified against the current planning snapshot.',
      );
      const scroll = view.container.querySelector<HTMLElement>('.pc-shell__scroll') as HTMLElement;
      const tableScroll = second.closest<HTMLElement>('[data-scroll-context]') as HTMLElement;
      const listWindow = second.closest<HTMLElement>('.pc-list__window') as HTMLElement;
      scroll.scrollTop = 390;
      tableScroll.scrollTop = 145;
      tableScroll.scrollLeft = 87;
      listWindow.scrollTop = 268;
      const back = vi.spyOn(window.history, 'back');
      fireEvent.click(within(inspector()).getByRole('button', { name: 'Open full page' }));
      await waitFor(() => expect(window.location.hash).toBe('#/detail/SPEC-026%2FT-002'));
      const main = screen.getByRole('main');
      await within(main).findByRole('heading', { name: 'Review artifact 2', level: 1 });
      expect(
        within(within(main).getByLabelText('Acceptance criteria')).getByText(
          'Current verified criterion for SPEC-026/T-002.',
        ),
      ).toBeTruthy();
      fireEvent.click(within(main).getByRole('button', { name: 'Back', exact: true }));
      expect(back).toHaveBeenCalledOnce();
      await waitFor(() => expect(window.location.hash).toBe(sourceHref));
      await waitFor(() =>
        expect(rows(view.container).map((row) => row.dataset.keyboardItem)).toEqual(expectedOrder),
      );
      const restored = rows(view.container)[1];
      expect(
        screen.getByRole('textbox', { name: 'Filter by id or title' }).getAttribute('value'),
      ).toBe(localEdits ? 'artifact' : 'Review');
      expect((screen.getByRole('combobox', { name: 'Group by' }) as HTMLSelectElement).value).toBe(
        localEdits ? 'type' : 'status',
      );
      expect(restored.getAttribute('aria-selected')).toBe('true');
      expect(restored.dataset.selected).toBe('true');
      expect(view.container.querySelector('.pc-shell__scroll')).toBe(scroll);
      expect(scroll.scrollTop).toBe(390);
      const returnedTable = restored.closest<HTMLElement>('[data-scroll-context]') as HTMLElement;
      expect(returnedTable.scrollTop).toBe(145);
      expect(returnedTable.scrollLeft).toBe(87);
      expect(restored.closest<HTMLElement>('.pc-list__window')?.scrollTop).toBe(268);
      await waitFor(() => expect(document.activeElement).toBe(restored));
    },
  );

  it.each([1440, 390])(
    'preserves the mounted inspector and nested scroll while revalidating a live revision at %ipx',
    async (width) => {
      vi.stubGlobal('innerWidth', width);
      const snapshot = fixture();
      const revised = revision(snapshot);
      window.history.replaceState(null, '', sourceHref);
      let current = snapshot as ReturnType<typeof fixture> | ReturnType<typeof revision>;
      let serveOldCursor = false;
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const id = decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1) ?? '');
        return json(detail(serveOldCursor ? snapshot : current, id));
      });
      vi.stubGlobal('fetch', fetcher);
      const view = render(<ShellHarness snapshot={snapshot} />);
      fireEvent.click(rows(view.container)[0]);
      const panel = inspector();
      await within(panel).findByText('Detail verified against the current planning snapshot.');
      const article = panel.querySelector('[data-artifact-id]');
      const criteria = panel.querySelector<HTMLElement>(
        '[data-scroll-context="criteria"]',
      ) as HTMLElement;
      const files = panel.querySelector<HTMLElement>(
        '[data-scroll-context="files"]',
      ) as HTMLElement;
      const scroller = panel.querySelector<HTMLElement>('.pc-inspector-sheet__body') ?? panel;
      const focused = within(panel).getByRole('button', { name: 'Copy link to item' });
      focused.focus();
      criteria.scrollTop = 125;
      files.scrollTop = 86;
      scroller.scrollTop = 420;
      current = revised;
      serveOldCursor = true;
      view.rerender(<ShellHarness snapshot={revised} />);
      await within(panel).findByText(/artifact detail could not be verified/iu);
      expect(inspector()).toBe(panel);
      expect(panel.querySelector('[data-artifact-id]')).toBe(article);
      expect(panel.querySelector('[data-scroll-context="criteria"]')).toBe(criteria);
      expect(criteria.scrollTop).toBe(125);
      expect(files.scrollTop).toBe(86);
      expect(scroller.scrollTop).toBe(420);
      expect(document.activeElement).toBe(focused);
      expect(
        within(criteria).getByText('Current verified criterion for SPEC-026/T-003.'),
      ).toBeTruthy();
      serveOldCursor = false;
      fireEvent.click(within(panel).getByRole('button', { name: 'Retry detail' }));
      await within(panel).findByText('Detail verified against the current planning snapshot.');
      expect(criteria.scrollTop).toBe(125);
      expect(files.scrollTop).toBe(86);
      expect(scroller.scrollTop).toBe(420);
      expect(document.activeElement).toBe(focused);
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );

  it('applies a genuinely different incoming view after local presentation changes', async () => {
    vi.stubGlobal('innerWidth', 1440);
    const snapshot = fixture();
    window.history.replaceState(null, '', sourceHref);
    vi.stubGlobal('fetch', vi.fn());
    const view = render(<ShellHarness snapshot={snapshot} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter by id or title' }), {
      target: { value: 'artifact' },
    });
    const newHref = serializePlanningViewHref({
      ...sourceView,
      filters: { ...sourceView.filters, query: 'artifact 1' },
      groupBy: 'none',
      sort: { field: 'title', direction: 'asc' },
    });
    window.location.hash = newHref;
    await waitFor(() =>
      expect(rows(view.container).map((row) => row.dataset.keyboardItem)).toEqual([taskIds[2]]),
    );
    expect(
      (screen.getByRole('textbox', { name: 'Filter by id or title' }) as HTMLInputElement).value,
    ).toBe('artifact 1');
    expect((screen.getByRole('combobox', { name: 'Group by' }) as HTMLSelectElement).value).toBe(
      'none',
    );
  });
});
