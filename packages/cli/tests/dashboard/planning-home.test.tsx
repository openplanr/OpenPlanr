// @vitest-environment jsdom

import { deriveAttention } from '@openplanr/protocol/dashboard/planning-attention.mjs';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDashboardLocation } from '../../../../apps/dashboard/src/app/router.js';
import { ListPage } from '../../../../apps/dashboard/src/features/planning/ListPage.js';
import { OverviewPage } from '../../../../apps/dashboard/src/features/planning/OverviewPage.js';
import {
  createPlanningSseReconciler,
  type PlanningGraphEnvelope,
  parsePlanningGraphEnvelope,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import {
  type PlanningModelGraph,
  planningAttentionView,
} from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import { applyPlanningView } from '../../../../apps/dashboard/src/features/planning/presentation-view.js';
import {
  clearInspector,
  useInspectorStore,
} from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import {
  PlanningLiveFeedback,
  usePlanningLiveFeedback,
} from '../../../../apps/dashboard/src/features/shell/planning-live-feedback.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { PlanningPresentationProvider } from '../../../../apps/dashboard/src/lib/routing/planning-presentation.js';
import { validatePlanningView } from '../../../../apps/dashboard/src/lib/routing/planning-view-codec.js';
import {
  ARTBOARD_FIXTURE_CLOCK,
  buildPremiumDashboardFixture,
  fixturePatch,
  fixtureSnapshot,
} from './fixtures/premium-dashboard-fixtures.js';

const PROJECT_ID = `sha256:${'7'.repeat(64)}`;
const STORAGE_KEY = `op-home-seen:v1:${PROJECT_ID}`;
const DATASET = buildPremiumDashboardFixture('artboard');
const CARDS = ['Waiting on a dependency', 'In progress, gone quiet', 'High priority, not started'];

function fixture(
  graph: PlanningModelGraph = DATASET.graph,
  kind: 'ready' | 'refreshing' | 'stale' | 'offline' | 'loading' = 'ready',
  projectId = PROJECT_ID,
  accepted?: PlanningGraphEnvelope,
) {
  const root = {
    actorId: 'home-fixture-reader',
    projectId,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    generation: 1,
  };
  const snapshot = accepted ?? fixtureSnapshot(graph, root);
  const binding = createDashboardQueryIdentity({
    ...root,
    productArea: 'planning',
    route: '#/home',
    cycleId: null,
    subjectId: null,
    ...snapshot.cursor,
  });
  const envelope = parsePlanningGraphEnvelope(snapshot, binding);
  const state = parseDashboardProductState<PlanningGraphEnvelope>(
    {
      kind,
      binding,
      data: kind === 'loading' ? null : envelope,
      reasonCodes:
        kind === 'ready' || kind === 'loading' ? [] : [`DASHBOARD_${kind.toUpperCase()}`],
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
  return { binding, state, envelope };
}

function Selection() {
  const { selection, openTick } = useInspectorStore();
  return <output data-testid="selection">{JSON.stringify({ selection, openTick })}</output>;
}

function Home({ current = fixture() }: { current?: ReturnType<typeof fixture> }) {
  return (
    <>
      <OverviewPage currentBinding={current.binding} current={current.state} />
      <Selection />
    </>
  );
}

function LiveHome({ current }: { current: ReturnType<typeof fixture> }) {
  const { feedback, dismiss } = usePlanningLiveFeedback(current.state);
  return (
    <div className="pc-shell">
      <div data-testid="home-scroll">
        <Home current={current} />
      </div>
      <PlanningLiveFeedback feedback={feedback} onDismiss={dismiss} onShow={() => {}} />
    </div>
  );
}

function card(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: new RegExp(`^${title}(?:\\s+\\d+)?$`, 'u') });
  const section = heading.closest('section');
  if (!section) throw new Error(`Missing section for ${title}`);
  return section;
}

function ids(container: Element): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-keyboard-item]')].map(
    (row) => row.dataset.keyboardItem ?? '',
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(ARTBOARD_FIXTURE_CLOCK));
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  clearInspector();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Home attention', () => {
  it('refuses attention List data from a foreign binding before deriving filters', () => {
    const current = fixture();
    const foreign = fixture(DATASET.graph, 'ready', `sha256:${'8'.repeat(64)}`);
    render(
      <PlanningPresentationProvider
        scope="attention-refusal"
        view={planningAttentionView('waiting')}
      >
        <ListPage currentBinding={foreign.binding} current={current.state} />
      </PlanningPresentationProvider>,
    );
    expect(screen.getByText('Planning cannot be trusted')).toBeTruthy();
    expect(screen.queryByText(DATASET.graph.nodes[0].title)).toBeNull();
  });

  it('accepts only registered List attention filters with a full graph', () => {
    const view = planningAttentionView('waiting');
    expect(validatePlanningView({ ...view, route: 'graph' })).toBeNull();
    expect(
      validatePlanningView({ ...view, filters: { ...view.filters, attention: 'execute' } }),
    ).toBeNull();
    expect(() => applyPlanningView(DATASET.graph.nodes, view)).toThrow('full planning graph');
  });

  it.each(['light', 'dark'])('renders derived Dataset B counts and order in %s theme', (theme) => {
    const attention = deriveAttention(DATASET.graph, ARTBOARD_FIXTURE_CLOCK);
    expect([
      attention.waiting.length,
      attention.stale.length,
      attention.highPriorityNotStarted.length,
    ]).toEqual([15, 16, 17]);
    const { container } = render(
      <div data-theme={theme}>
        <Home />
      </div>,
    );
    const expected = [
      attention.waiting.map((item) => item.id),
      attention.stale.map((item) => item.id),
      attention.highPriorityNotStarted,
    ];
    for (let index = 0; index < CARDS.length; index += 1) {
      const section = card(CARDS[index]);
      expect(section.textContent).toContain(String(expected[index].length));
      const visible = ids(section);
      expect(visible.length).toBeGreaterThan(0);
      expect(visible).toEqual(expected[index].slice(0, visible.length));
    }
    const titles = [...container.querySelectorAll('h2')].map((heading) =>
      heading.textContent?.replace(/\s+\d+$/u, ''),
    );
    expect(titles.indexOf(CARDS[0])).toBeLessThan(titles.indexOf(CARDS[1]));
    expect(titles.indexOf(CARDS[1])).toBeLessThan(titles.indexOf(CARDS[2]));
    expect(card(CARDS[1]).textContent).toMatch(
      /7\+? days|days since authored update|no authored update/iu,
    );
    expect(container.textContent).toContain('Phase 2');
  });

  it('passes equivalent validated filters to every See all destination', () => {
    const attention = deriveAttention(DATASET.graph, ARTBOARD_FIXTURE_CLOCK);
    const expected = [
      attention.waiting.map((item) => item.id),
      attention.stale.map((item) => item.id),
      attention.highPriorityNotStarted,
    ];
    render(<Home />);
    for (let index = 0; index < CARDS.length; index += 1) {
      const link = within(card(CARDS[index])).getByRole('link', { name: /See all/iu });
      const view = parseDashboardLocation(link.getAttribute('href') ?? '').presentationView;
      expect(view).not.toBeNull();
      expect(view?.route).toBe('list');
      expect(
        applyPlanningView(
          DATASET.graph.nodes,
          view,
          new Date(ARTBOARD_FIXTURE_CLOCK),
          DATASET.graph,
        )
          .map((node) => node.id)
          .sort(),
      ).toEqual([...expected[index]].sort());
    }
  });

  it('opens the waiting item, dependency and copies its exact continuation in three activations', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<Home />);
    const first = card(CARDS[0]).querySelector<HTMLElement>('[data-keyboard-item]');
    if (!first) throw new Error('Expected a waiting row');
    const inspect = first.closest('a');
    if (!inspect) throw new Error('Expected an inspect link');
    const item = first.closest('li');
    if (!item) throw new Error('Expected an attention item');
    fireEvent.click(inspect);
    const selected = JSON.parse(screen.getByTestId('selection').textContent ?? '{}');
    expect(selected.selection.id).toBe(first.dataset.keyboardItem);
    expect(selected.openTick).toBeGreaterThan(0);
    const dependency = within(item).getAllByRole('link')[1];
    expect(dependency.textContent).toContain('T-109');
    fireEvent.click(dependency);
    expect(JSON.parse(screen.getByTestId('selection').textContent ?? '{}').selection.id).toBe(
      'SPEC-026/T-109',
    );
    const command = item.querySelector('code')?.textContent;
    expect(command).toBe('/planr:ship SPEC-026/T-109');
    fireEvent.click(within(item).getByRole('button', { name: 'Copy command' }));
    await act(async () => {});
    expect(writeText).toHaveBeenCalledExactlyOnceWith(command);
    expect(JSON.parse(screen.getByTestId('selection').textContent ?? '{}').selection.id).toBe(
      'SPEC-026/T-109',
    );
  });

  it('keeps the attention order without a sprint and copies the registered sprint continuation', async () => {
    const graph = {
      nodes: DATASET.graph.nodes.filter((node) => node.type !== 'sprint'),
      edges: DATASET.graph.edges.filter(
        (edge) =>
          !DATASET.graph.nodes.some(
            (node) => node.type === 'sprint' && (node.id === edge.from || node.id === edge.to),
          ),
      ),
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { container } = render(<Home current={fixture(graph)} />);
    for (const title of CARDS) expect(card(title)).toBeTruthy();
    const sprint = screen.getByRole('region', { name: 'No active sprint' });
    fireEvent.click(within(sprint).getByRole('button', { name: 'Copy command' }));
    await act(async () => {});
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/planr:sprint');
    expect(container.querySelector('h1')?.textContent).toBe('Needs attention');
  });

  it('surfaces derivation errors without recording a successful browser visit', () => {
    const invalid = {
      ...DATASET.graph,
      nodes: DATASET.graph.nodes.map((node, index) =>
        index === 0
          ? { ...node, frontmatter: { ...node.frontmatter, dependsOn: 'invalid' } }
          : node,
      ),
    };
    render(<Home current={fixture(invalid)} />);
    expect(screen.getByRole('heading', { name: 'Attention could not be derived' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Diagnostics' })).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole('heading', { name: /Waiting on a dependency/u })).toBeNull();
  });

  it('records the browser-local timestamp after a successful visit and scopes it by project', () => {
    const previous = '2026-10-17T09:00:00.000Z';
    localStorage.setItem(STORAGE_KEY, previous);
    const { rerender, unmount } = render(<Home current={fixture(DATASET.graph, 'refreshing')} />);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(previous);
    rerender(<Home />);
    expect(screen.getByText(/Since your last visit:/u).querySelector('time')?.dateTime).toBe(
      previous,
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe(ARTBOARD_FIXTURE_CLOCK);
    unmount();
    const otherProject = `sha256:${'8'.repeat(64)}`;
    render(<Home current={fixture(DATASET.graph, 'ready', otherProject)} />);
    expect(screen.getByText(/First visit in this browser/u)).toBeTruthy();
    expect(localStorage.getItem(`op-home-seen:v1:${otherProject}`)).toBe(ARTBOARD_FIXTURE_CLOCK);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(ARTBOARD_FIXTURE_CLOCK);
  });

  it.each(['loading', 'stale', 'offline', 'refreshing'] as const)(
    'does not record a %s visit',
    (kind) => {
      localStorage.setItem(STORAGE_KEY, '2026-10-17T09:00:00.000Z');
      render(<Home current={fixture(DATASET.graph, kind)} />);
      expect(localStorage.getItem(STORAGE_KEY)).toBe('2026-10-17T09:00:00.000Z');
    },
  );

  it('surfaces storage denial while keeping attention available', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });
    render(<Home />);
    expect(screen.getByText(/Since your last visit is unavailable/iu)).toBeTruthy();
    expect(ids(card(CARDS[0])).length).toBeGreaterThan(0);
  });

  it('surfaces a failed timestamp write without claiming a recorded visit', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    render(<Home />);
    expect(screen.getByText(/Since your last visit is unavailable/iu)).toBeTruthy();
    expect(screen.queryByText(/First visit in this browser/u)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it.each([false, true])(
    'shows accepted patch feedback with reduced motion %s and retains focus and scroll',
    (reduced) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(ARTBOARD_FIXTURE_CLOCK));
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({ matches: reduced })),
      );
      const current = fixture();
      const { container, rerender } = render(<LiveHome current={current} />);
      const row = card(CARDS[0]).querySelector<HTMLElement>('[data-keyboard-item]');
      if (!row?.dataset.keyboardItem) throw new Error('Expected a waiting row');
      const rowId = row.dataset.keyboardItem;
      const inspect = row.closest('a');
      if (!inspect) throw new Error('Expected an inspect link');
      act(() => inspect.focus());
      const scroll = screen.getByTestId('home-scroll');
      scroll.scrollTop = 37;
      const patch = fixturePatch(current.envelope, rowId);
      const onRefetch = vi.fn();
      const reconciler = createPlanningSseReconciler({
        identity: current.binding,
        initial: current.envelope,
        isCurrent: () => true,
        onSnapshot: () => {},
        onPatch: (accepted) =>
          rerender(<LiveHome current={fixture(accepted.graph, 'ready', PROJECT_ID, accepted)} />),
        onRefetch,
      });
      act(() =>
        expect(reconciler.ingest(patch.event)).toEqual({ kind: 'accepted', event: 'patch' }),
      );
      expect(onRefetch).not.toHaveBeenCalled();
      expect(container.querySelector(`[data-keyboard-item="${rowId}"]`)).toBe(row);
      expect(document.activeElement).toBe(inspect);
      expect(scroll.scrollTop).toBe(37);
      expect(row.textContent).toContain('Fixture patch 1');
      expect(row.getAttribute('data-live-changed')).toMatch(reduced ? /^dot$/u : /^wash-/u);
      act(() => vi.advanceTimersByTime(1599));
      expect(row.hasAttribute('data-live-changed')).toBe(true);
      act(() => vi.advanceTimersByTime(1));
      expect(row.hasAttribute('data-live-changed')).toBe(reduced);
      reconciler.dispose();
    },
  );
});
