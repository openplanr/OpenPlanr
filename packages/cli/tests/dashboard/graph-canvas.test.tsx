// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  GraphLayout,
  GraphNode,
} from '../../../../apps/dashboard/src/design-system/components/console-planr.js';
import { graphLayout } from '../../../../apps/dashboard/src/design-system/components/console-planr.js';
import { GraphPage } from '../../../../apps/dashboard/src/features/planning/GraphPage.js';
import {
  graphCanvasModel,
  graphNavigate,
} from '../../../../apps/dashboard/src/features/planning/graph-canvas.js';
import {
  type GraphLens,
  initialGraphFocus,
  selectFocusedGraph,
} from '../../../../apps/dashboard/src/features/planning/graph-focus-model.js';
import {
  type PlanningGraphEnvelope,
  parsePlanningGraphEnvelope,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import { clearInspector } from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import { installKeyboardCoordinator } from '../../../../apps/dashboard/src/features/shell/keyboard-coordinator.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import {
  captureCanvasControllers,
  liveController,
  RouteToolProbe,
  settleFrames,
  stubStageSize,
} from './fixtures/graph-canvas-harness.js';
import {
  buildPremiumDashboardFixture,
  fixtureSnapshot,
} from './fixtures/premium-dashboard-fixtures.js';

type LensBaseline = Readonly<{
  nodeIds: readonly string[];
  edges: readonly string[];
  edgeKinds: Readonly<Record<string, number>>;
  counts: Readonly<{
    shown: number;
    total: number;
    contains: number;
    dependsOn: number;
    unresolved: number;
  }>;
}>;
// Recorded from the scroll-camera DependencyGraph and GraphPage before the move to the engine.
const BASELINE = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/graph-lens-parity.json'),
    'utf8',
  ),
) as Readonly<{ focusId: string } & Record<GraphLens, LensBaseline>>;
const LENSES: readonly GraphLens[] = ['lineage', 'dependencies', 'project'];
const TYPES = [
  'spec',
  'story',
  'task',
  'backlog',
  'adr',
  'epic',
  'feature',
  'quick',
  'sprint',
] as const;
const LENS_LABEL: Readonly<Record<GraphLens, string>> = {
  lineage: 'Lineage',
  dependencies: 'Dependencies',
  project: 'Whole project',
};

const disposers: (() => void)[] = [];

beforeEach(() => clearInspector());
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  cleanup();
  clearInspector();
  vi.restoreAllMocks();
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Required fixture value unavailable');
  return value;
}

function engineEdge(edge: Readonly<{ from: string; to: string; style: string }>): string {
  const kind = edge.style.startsWith('pc-graph-edge-contains') ? 'contains' : 'depends_on';
  return `${edge.from}>${edge.to}:${kind}`;
}

function representativeState() {
  const fixture = buildPremiumDashboardFixture('representative');
  const snapshot = fixtureSnapshot(fixture.graph, {
    actorId: 'graph-canvas',
    projectId: `sha256:${'d'.repeat(64)}`,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    generation: 1,
  });
  const binding = createDashboardQueryIdentity({
    ...snapshot.binding,
    productArea: 'planning',
    route: '#/graph',
    subjectId: null,
    cycleId: null,
    eventHead: snapshot.cursor.eventHead,
    viewHash: snapshot.cursor.viewHash,
  });
  const state = parseDashboardProductState<PlanningGraphEnvelope>(
    {
      kind: 'ready',
      binding,
      data: parsePlanningGraphEnvelope(snapshot, binding),
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
  return { fixture, binding, state };
}

describe('Graph on the canvas engine', () => {
  it.each(LENSES)('gives the engine the scroll graph %s IDs, edges and counts', (lens) => {
    const { graph, manifest } = buildPremiumDashboardFixture('representative');
    const focusId = initialGraphFocus(graph, manifest.selectedId);
    expect(focusId).toBe(BASELINE.focusId);
    const projection = selectFocusedGraph(graph, {
      lens,
      focusId,
      types: TYPES,
      contains: true,
      dependencies: true,
      presentation: null,
    });
    const model = graphCanvasModel(
      graphLayout(
        projection.nodes,
        projection.edges,
        lens === 'dependencies' ? 'target-to-source' : 'source-to-target',
      ),
    );
    const baseline = BASELINE[lens];
    expect(model.nodes.map((node) => node.id).sort()).toEqual(baseline.nodeIds);
    expect(model.edges.map(engineEdge).sort()).toEqual(baseline.edges);
    for (const node of model.nodes) expect(node.bounds).toMatchObject({ width: 230, height: 66 });
    expect({
      shown: projection.nodes.length,
      total: graph.nodes.length,
      contains: projection.edges.filter((edge) => edge.kind === 'contains').length,
      dependsOn: projection.edges.filter((edge) => edge.kind === 'depends_on').length,
      unresolved: projection.unresolved.length,
    }).toEqual(baseline.counts);
  });

  it('renders each lens on one full-window stage with the recorded IDs and focus counts', async () => {
    const created = captureCanvasControllers();
    stubStageSize({ width: 1440, height: 1000 });
    const { binding, state } = representativeState();
    const rendered = render(
      <>
        <RouteToolProbe />
        <GraphPage currentBinding={binding} current={state} />
      </>,
    );
    await settleFrames();
    expect(created).toHaveLength(1);
    const stage = rendered.getByRole('group', { name: 'Dependency graph' });
    expect(stage.getAttribute('aria-roledescription')).toBe('canvas');
    expect(stage.closest('.pc-graph-stage')).toBeTruthy();
    expect(rendered.container.querySelector('[data-scroll-context]')).toBeNull();
    expect(stage.style.height).toBe('');
    for (const lens of LENSES) {
      fireEvent.click(rendered.getByRole('button', { name: LENS_LABEL[lens], exact: true }));
      await settleFrames(4);
      const baseline = BASELINE[lens];
      expect(
        rendered
          .getByRole('button', { name: LENS_LABEL[lens], exact: true })
          .getAttribute('aria-pressed'),
      ).toBe('true');
      expect([...liveController(created).getOutline()].sort()).toEqual(baseline.nodeIds);
      expect(rendered.getByRole('heading', { name: 'Graph' }).parentElement?.textContent).toContain(
        `${baseline.counts.shown} of ${baseline.counts.total} nodes`,
      );
      rendered.getByRole('switch', { name: `contains · ${baseline.counts.contains}` });
      rendered.getByRole('switch', { name: `depends_on · ${baseline.counts.dependsOn}` });
      rendered.getByRole('switch', {
        name: `Unresolved references · ${baseline.counts.unresolved}`,
      });
    }
    // One stage across lens changes: the canvas was never registered twice.
    expect(created).toHaveLength(1);
  });

  it('fits the selection on F without changing the lens, and focuses its lineage on request', async () => {
    const created = captureCanvasControllers();
    stubStageSize({ width: 1440, height: 1000 });
    const { binding, state } = representativeState();
    const rendered = render(
      <section>
        <RouteToolProbe />
        <GraphPage currentBinding={binding} current={state} />
      </section>,
    );
    disposers.push(
      installKeyboardCoordinator(document, () => ({
        root: rendered.container,
        singleLetters: true,
        paletteOpen: false,
        togglePalette: vi.fn(),
        openHelp: vi.fn(),
        navigate: vi.fn(),
        closeInspector: () => false,
        selectedId: () => null,
        copy: async () => undefined,
        announce: vi.fn(),
      })),
    );
    await settleFrames();
    fireEvent.click(rendered.getByRole('button', { name: 'Dependencies', exact: true }));
    await settleFrames();
    const controller = liveController(created);
    const node = required(rendered.container.querySelector<HTMLElement>('.pc-graph-node'));
    const id = required(node.dataset.canvasNodeId);
    fireEvent.click(node);
    act(() => controller.setCamera({ x: -4000, y: -4000, zoom: 0.5 }));
    const fit = vi.spyOn(controller, 'fit');
    fireEvent.keyDown(node, { key: 'f' });
    expect(fit).toHaveBeenCalledExactlyOnceWith('selection', { maxZoom: 1 });
    await settleFrames();
    expect(controller.getSelection()).toEqual([id]);
    expect(
      rendered
        .getByRole('button', { name: 'Dependencies', exact: true })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    const safe = controller.getSafeArea();
    const corner = controller.worldToScreen({
      x: Number(node.style.transform.match(/-?[\d.]+/u)?.[0]),
      y: Number(node.style.transform.match(/, (-?[\d.]+)/u)?.[1]),
    });
    expect(corner.x).toBeGreaterThanOrEqual(safe.x);
    expect(corner.y).toBeGreaterThanOrEqual(safe.y);
    fireEvent.click(rendered.getByRole('button', { name: `Focus on ${id}` }));
    expect(
      rendered.getByRole('button', { name: 'Lineage', exact: true }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('moves between connected neighbours by direction, vertical order and canonical ID', () => {
    const at = (x: number, y: number) => ({ x, y });
    const node = (id: string): GraphNode => ({ id, type: 'task', label: id });
    const ids = ['center', 'left', 'right-b', 'right-a', 'up', 'down', 'unconnected', 'v', 'v-up'];
    ids.push('down-b', 'down-a');
    const layout = {
      byId: new Map(ids.map((id) => [id, node(id)])),
      displayId: new Map(ids.map((id) => [id, id])),
      neighbours: new Map([
        ['center', ['left', 'right-a', 'right-b', 'up', 'down']],
        ['left', ['center']],
        ['v', ['v-up', 'down-b', 'down-a']],
      ]),
      relationships: new Map(),
      edges: [],
      columns: [],
      position: new Map([
        ['center', at(0, 0)],
        ['left', at(-2, 0)],
        ['right-b', at(2, 0)],
        ['right-a', at(2, 0)],
        ['up', at(0, -2)],
        ['down', at(0, 2)],
        ['unconnected', at(1, 0)],
        ['v', at(10, 0)],
        ['v-up', at(10, -2)],
        ['down-b', at(10, 2)],
        ['down-a', at(10, 2)],
      ]),
      width: 0,
      height: 0,
      tracedIds: new Set(),
    } as unknown as GraphLayout;
    expect(graphNavigate(layout, 'center', 'right')).toBe('right-a');
    expect(graphNavigate(layout, 'center', 'left')).toBe('left');
    expect(graphNavigate(layout, 'v', 'up')).toBe('v-up');
    expect(graphNavigate(layout, 'v', 'down')).toBe('down-a');
    expect(graphNavigate(layout, 'v', 'left')).toBeNull();
    expect(graphNavigate(layout, 'left', 'left')).toBeNull();
    expect(graphNavigate(layout, 'unconnected', 'right')).toBeNull();
  });

  it('keeps the camera and stage across a rerender and refits a new focus scope', async () => {
    const created = captureCanvasControllers();
    stubStageSize({ width: 1440, height: 1000 });
    const { binding, state } = representativeState();
    const rendered = render(
      <>
        <RouteToolProbe />
        <GraphPage currentBinding={binding} current={state} />
      </>,
    );
    await settleFrames();
    const controller = liveController(created);
    act(() => controller.setCamera({ x: 120, y: 80, zoom: 0.8 }));
    const stage = rendered.getByRole('group', { name: 'Dependency graph' });
    rendered.rerender(
      <>
        <RouteToolProbe />
        <GraphPage currentBinding={binding} current={state} />
      </>,
    );
    await settleFrames(4);
    expect(rendered.getByRole('group', { name: 'Dependency graph' })).toBe(stage);
    expect(controller.getCamera()).toEqual({ x: 120, y: 80, zoom: 0.8 });
    fireEvent.click(rendered.getByRole('button', { name: 'Whole project', exact: true }));
    await waitFor(() => expect(controller.getCamera().zoom).toBeLessThan(0.8));
    expect(created).toHaveLength(1);
  });
});
