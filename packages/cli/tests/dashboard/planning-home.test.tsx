// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { deriveAttention } from '@openplanr/protocol/dashboard/planning-attention.mjs';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDashboardLocation } from '../../../../apps/dashboard/src/app/router.js';
import {
  ArtifactRowMeta,
  ArtifactRowMetaGroup,
} from '../../../../apps/dashboard/src/design-system/components/artifact-row.js';
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
import { installKeyboardCoordinator } from '../../../../apps/dashboard/src/features/shell/keyboard-coordinator.js';
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
import { nameFailures } from './control-name-guard.js';
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
    fireEvent.click(within(item).getByRole('button', { name: 'Copy command for T-036' }));
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
        vi.fn((query: string) => ({
          matches: query === '(prefers-reduced-motion: reduce)' && reduced,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
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

function idColumnWidth(value: string): number {
  const match = value.match(/^max\(9ch, calc\((\d+)ch \+ ([\d.]+)em \+ (\d+)px\)\)$/u);
  if (!match) throw new Error(`Unsupported ID column recipe: ${value}`);
  return Math.max(9 * 7.2, Number(match[1]) * 7.2 + Number(match[2]) * 12 + Number(match[3]));
}

it('caps each Home card at five rows and keeps the full count reachable', () => {
  const additions: PlanningModelGraph['nodes'] = Array.from({ length: 11 }, (_, index) => ({
    id: `SPEC-${900 + index}`,
    type: 'spec',
    status: 'in-progress',
    title: `Additional specification ${index + 1}`,
    frontmatter: { created: ARTBOARD_FIXTURE_CLOCK, updated: ARTBOARD_FIXTURE_CLOCK },
  }));
  const graph = { ...DATASET.graph, nodes: [...DATASET.graph.nodes, ...additions] };
  const { container } = render(<Home current={fixture(graph)} />);
  for (const list of container.querySelectorAll('.pc-home__card ul')) {
    expect(list.children.length).toBeLessThanOrEqual(5);
  }
  const specs = screen.getByRole('region', { name: 'Specs in flight' });
  const count = graph.nodes.filter(
    (node) => node.type === 'spec' && node.status !== 'done' && node.status !== 'addressed',
  ).length;
  expect(within(specs).getAllByRole('listitem')).toHaveLength(5);
  const link = within(specs).getByRole('link', { name: new RegExp(`See all ${count}`, 'u') });
  const location = parseDashboardLocation(link.getAttribute('href') ?? '');
  expect(location.invalidView).toBe(false);
  expect(location.presentationView).not.toBeNull();
  expect(
    applyPlanningView(
      graph.nodes,
      location.presentationView,
      new Date(ARTBOARD_FIXTURE_CLOCK),
      graph,
    ),
  ).toHaveLength(count);
  for (const title of container.querySelectorAll<HTMLElement>('.pc-artifact-row__title')) {
    expect(title.title).toBe(title.textContent);
  }
});

it('keeps single-line Home cards on the shared row grid without tag and title overlap', () => {
  const stylesheet = readFileSync(
    `${process.cwd()}/../../apps/dashboard/src/design-system/components/artifact-row.css`,
    'utf8',
  );
  const rowRule = stylesheet.match(/\.pc-artifact-row\s*\{([^}]+)\}/u)?.[1];
  expect(rowRule).toBeDefined();
  expect(rowRule).toMatch(
    /grid-template-columns:\s*var\(--id-col[^;]+minmax\(0,\s*1fr\) auto var\(--action-col/u,
  );
  const padding = Number(rowRule?.match(/padding:\s*0 (\d+)px/u)?.[1]);
  const gap = Number(rowRule?.match(/column-gap:\s*(\d+)px/u)?.[1]);
  const height = Number(rowRule?.match(/height:\s*(\d+)px/u)?.[1]);
  expect([padding, gap, height]).toEqual([20, 12, 44]);
  expect(stylesheet).toMatch(
    /\.pc-artifact-row__title\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis/u,
  );
  const { container } = render(<Home />);
  const cards = [...container.querySelectorAll('.pc-home__card')];
  expect(cards).toHaveLength(6);
  const home = container.querySelector<HTMLElement>('.pc-overview');
  const idColumn = idColumnWidth(home?.style.getPropertyValue('--id-col') ?? '');
  const titleColumns: number[] = [];
  for (const section of cards) {
    expect(section.querySelector('.pc-card__head')).toBeTruthy();
    for (const list of section.querySelectorAll<HTMLElement>('ul')) {
      const rows = [...list.querySelectorAll<HTMLElement>(':scope > .pc-artifact-row')];
      if (!rows.length) continue;
      expect(list.style.getPropertyValue('--id-col')).toBe('');
      expect(idColumn).toBeGreaterThanOrEqual(9 * 7.2);
      const titles = rows.map((row) => {
        const title = row.querySelector('.pc-artifact-row__title');
        const tag = row.querySelector('.pc-artifact-row__id .pc-artifact-tag');
        expect(title).toBeTruthy();
        expect(tag).toBeTruthy();
        expect(title?.parentElement?.classList.contains('pc-artifact-row__link')).toBe(true);
        if (row.dataset.layout === 'stacked') {
          expect(section.getAttribute('data-attention')).toBe('changed-today');
          return padding;
        }
        const ch = 7.2;
        const length = tag?.textContent?.length ?? 0;
        const tagRight = padding + length * (ch + 0.03 * 12) + 14;
        const titleLeft = padding + idColumn + gap;
        titleColumns.push(titleLeft);
        expect(tagRight).toBeLessThanOrEqual(titleLeft);
        return titleLeft;
      });
      expect(new Set(titles).size).toBe(1);
    }
  }
  expect(new Set(titleColumns).size).toBe(1);
});

it('stacks changed-today titles below their tag and summary without truncation', () => {
  const { container } = render(<Home />);
  const changed = container.querySelector('[data-attention="changed-today"]');
  const rows = [...(changed?.querySelectorAll('.pc-artifact-row') ?? [])];
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.getAttribute('data-layout')).toBe('stacked');
    expect(row.querySelector('.pc-artifact-row__id')).toBeTruthy();
    expect(row.querySelector('.pc-artifact-row__meta-value')?.textContent).toBeTruthy();
    expect(row.querySelector('.pc-artifact-row__title')?.getAttribute('title')).toBe(
      row.querySelector('.pc-artifact-row__title')?.textContent,
    );
  }
  const stylesheet = readFileSync(
    `${process.cwd()}/../../apps/dashboard/src/design-system/components/artifact-row.css`,
    'utf8',
  );
  expect(stylesheet).toMatch(
    /\[data-layout="stacked"\] \.pc-artifact-row__title\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*2;[^}]*white-space:\s*normal;[^}]*font-size:\s*13\.5px/u,
  );
});

it('uses plain summary glyphs and compact attention metadata', () => {
  const { container } = render(<Home />);
  const legend = screen.getByRole('region', { name: 'Project status' });
  for (const status of legend.querySelectorAll<HTMLElement>('.pc-artifact')) {
    expect(status.dataset.variant).toBe('legend');
    expect(status.style.background).toBe('');
  }
  for (const [filter, glyph] of [
    ['waiting', 'diamond'],
    ['stale', 'half-ring'],
    ['high-not-started', 'ring'],
  ]) {
    expect(
      container
        .querySelector(`[data-attention="${filter}"] .pc-card__glyph [data-glyph]`)
        ?.getAttribute('data-glyph'),
    ).toBe(glyph);
  }
  expect(
    container.querySelector('[data-attention="changed-today"] [data-live="true"]'),
  ).toBeTruthy();
  expect(container.querySelectorAll('.pc-home__dependency-tag')).toHaveLength(0);
  const quiet = container.querySelector('[data-attention="stale"] .pc-artifact-row__meta-value');
  expect(quiet?.textContent).toMatch(/^\d+d$/u);
});

it('summarizes multiple waiting dependencies with their full accessible ID list', () => {
  const graph: PlanningModelGraph = {
    nodes: ['T-001', 'T-109', 'T-110'].map((id) => ({
      id,
      type: 'task',
      status: 'outstanding',
      title: `Task ${id}`,
      frontmatter: {
        id,
        created: ARTBOARD_FIXTURE_CLOCK,
        ...(id === 'T-001' ? { dependsOn: ['T-109', 'T-110'] } : {}),
      },
    })),
    edges: [
      { from: 'T-001', to: 'T-109', kind: 'depends_on' },
      { from: 'T-001', to: 'T-110', kind: 'depends_on' },
    ],
  };
  const { container } = render(<Home current={fixture(graph)} />);
  const row = container
    .querySelector('[data-attention="waiting"] [data-keyboard-item="T-001"]')
    ?.closest('li');
  if (!row) throw new Error('Missing waiting row with multiple dependencies');
  const summary = within(row).getByRole('button', {
    name: '2 Waits on unfinished dependencies: T-109, T-110',
  });
  expect(summary.querySelector('.pc-artifact-row__meta-value')?.textContent).toBe('2');
  expect(document.getElementById(summary.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
    'Waits on unfinished dependencies: T-109, T-110',
  );
  expect(row.querySelectorAll('.pc-home__dependency-tag')).toHaveLength(0);
});

it('keeps every metadata item in one touch popover and restores focus on Escape', async () => {
  let coarse = true;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)' && coarse,
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  }));
  const labels = [
    '10 downstream open tasks',
    'Waits on unfinished dependencies: T-122',
    '36 days since authored update (2026-09-13). Git activity is unknown.',
    'Priority P1',
    '2026-10-19',
  ];
  const items = labels.map((label) => ({
    key: label,
    label,
    control: <ArtifactRowMeta label={label}>{label}</ArtifactRowMeta>,
  }));
  const subject = render(<ArtifactRowMetaGroup id="BL-440" items={items} />);
  const target = screen.getByRole('button', { name: `Details for BL-440: ${labels.join(', ')}` });
  expect(subject.container.querySelectorAll('.pc-artifact-row__meta')).toHaveLength(0);
  target.focus();
  const restoreFocus = vi.spyOn(target, 'focus');
  fireEvent.click(target);
  const dialog = await screen.findByRole('dialog', { name: 'Details for BL-440' });
  expect(document.body.hasAttribute('data-scroll-locked')).toBe(false);
  expect(dialog.getAttribute('aria-modal')).toBeNull();
  expect(
    within(dialog)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(labels);
  expect(await nameFailures(document.body)).toEqual([]);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(target));
  expect(restoreFocus).toHaveBeenLastCalledWith({ preventScroll: true });
  expect(await nameFailures(subject.container)).toEqual([]);

  act(() => {
    coarse = false;
    for (const listener of listeners) listener();
  });
  expect(screen.queryByRole('button', { name: /^Details for/u })).toBeNull();
  expect(subject.container.querySelectorAll('.pc-artifact-row__meta')).toHaveLength(5);
  for (const label of labels)
    expect(screen.getByRole('button', { name: `${label} ${label}` })).toBeTruthy();
  const first = subject.container.querySelector<HTMLButtonElement>('.pc-artifact-row__meta');
  if (!first) throw new Error('Missing fine-pointer metadata control');
  act(() => first.focus());
  subject.rerender(
    <ArtifactRowMetaGroup
      id="BL-440"
      items={items.map((item, index) =>
        index === 0
          ? {
              ...item,
              label: '11 downstream open tasks',
              control: <ArtifactRowMeta label="11 downstream open tasks">11</ArtifactRowMeta>,
            }
          : item,
      )}
    />,
  );
  expect(document.activeElement).toBe(first);
  expect(first.textContent).toContain('11 downstream open tasks');
});

it('restores popover focus during Escape and outside dismissal with the keyboard coordinator active', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const user = userEvent.setup();
  const items = ['Downstream tasks', 'Waiting dependencies'].map((label) => ({
    key: label,
    label,
    control: <ArtifactRowMeta label={label}>{label}</ArtifactRowMeta>,
  }));
  const subject = render(
    <>
      <ArtifactRowMetaGroup id="BL-440" items={items} />
      <button type="button">Outside action</button>
    </>,
  );
  const closeInspector = vi.fn(() => true);
  const dispose = installKeyboardCoordinator(document, () => ({
    root: subject.container,
    singleLetters: true,
    paletteOpen: false,
    togglePalette: vi.fn(),
    openHelp: vi.fn(),
    navigate: vi.fn(),
    closeInspector,
    selectedId: () => null,
    copy: vi.fn(async () => undefined),
    announce: vi.fn(),
  }));
  try {
    const target = screen.getByRole('button', { name: /^Details for BL-440:/u });
    const restoreFocus = vi.spyOn(target, 'focus');
    await user.click(target);
    expect(screen.getByRole('dialog', { name: 'Details for BL-440' })).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(target);
    expect(restoreFocus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(closeInspector).not.toHaveBeenCalled();

    await user.click(target);
    expect(screen.getByRole('dialog', { name: 'Details for BL-440' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Outside action' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(target);
    expect(restoreFocus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(closeInspector).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});

it('keeps List titles in one column with room for every identifier', () => {
  const current = fixture();
  const { container } = render(
    <PlanningPresentationProvider scope="row-geometry" view={planningAttentionView('waiting')}>
      <ListPage currentBinding={current.binding} current={current.state} />
    </PlanningPresentationProvider>,
  );
  const groups = [
    ...container.querySelectorAll<HTMLElement>('.pc-list__window tbody[data-keyboard-group]'),
  ];
  expect(groups.length).toBeGreaterThan(0);
  const stylesheet = readFileSync(
    `${process.cwd()}/../../apps/dashboard/src/features/planning/list.css`,
    'utf8',
  );
  expect(stylesheet).toMatch(/font-size:\s*12px/u);
  for (const group of groups) {
    const idColumn = idColumnWidth(
      container
        .querySelector<HTMLElement>('.pc-list__window')
        ?.style.getPropertyValue('--id-col') ?? '',
    );
    expect(idColumn).toBeGreaterThanOrEqual(9 * 7.2);
    const header = container.querySelector<HTMLElement>('th[data-column="id"]');
    expect(header?.style.width).toBe('max(92px, var(--id-col))');
    const rows = [...group.querySelectorAll<HTMLElement>('tr[data-keyboard-item]')];
    expect(rows.length).toBeGreaterThan(0);
    const titlePositions = rows.map((row) => {
      const title = row.querySelector('.pc-list__title');
      const tag = row.querySelector('.pc-artifact-tag');
      expect(title).toBeTruthy();
      expect(tag).toBeTruthy();
      const ch = 7.2;
      const tagWidth = (tag?.textContent?.length ?? 0) * (ch + 0.03 * 12) + 14;
      const idWidth = idColumn;
      expect(tagWidth).toBeLessThanOrEqual(idWidth);
      return idWidth + 26 + 6;
    });
    expect(new Set(titlePositions).size).toBe(1);
  }
});

it('copies a Home row through the supplied adapter while single-letter shortcuts are disabled', async () => {
  const onCopy = vi.fn().mockResolvedValue(undefined);
  const current = fixture();
  const { container } = render(
    <PlanningPresentationProvider
      scope="row-copy"
      view={null}
      onCopy={onCopy}
      singleLetters={false}
    >
      <Home current={current} />
    </PlanningPresentationProvider>,
  );
  const button = container.querySelector<HTMLButtonElement>('.pc-home__row .pc-command-hint__copy');
  expect(button).toBeTruthy();
  expect(button?.getAttribute('aria-keyshortcuts')).toBeNull();
  if (!button) throw new Error('Missing Home row copy action');
  fireEvent.keyDown(button, { key: 'c' });
  expect(onCopy).not.toHaveBeenCalled();
  fireEvent.click(button);
  await act(async () => {});
  expect(onCopy).toHaveBeenCalledTimes(1);
  expect(onCopy.mock.calls[0][0]).toMatch(/^\/planr:/u);
});
