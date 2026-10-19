import type { IncomingMessage, ServerResponse } from 'node:http';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  type DashboardTraceMeasurements,
  evaluateDashboardTrace,
  installFixedDashboardDate,
  percentile95,
  rendererFrameWork,
  TRACE_PLAN,
} from '../dashboard/fixtures/dashboard-trace-model.js';
import { buildPremiumDashboardFixture } from '../dashboard/fixtures/premium-dashboard-fixtures.js';
import { premiumRequestState, servePremiumFixture } from './fixtures/premium-dashboard-server.js';

function smokeMeasurements(tier: 'representative' | 'scaling'): DashboardTraceMeasurements {
  const { manifest } = buildPremiumDashboardFixture(tier);
  const selection = {
    id: manifest.selectedId,
    focusedId: manifest.selectedId,
    scrollTop: 240,
    anchorTop: 100,
  };
  const interaction = {
    durationMs: TRACE_PLAN.durationMs,
    frameWorkMs: [4, 8, 12],
    frameIntervalsMs: [16.6, 16.7],
    longTasksMs: [],
    cls: 0,
    interactionObserved: true,
  };
  return {
    coldShellMs: 500,
    usefulSnapshotMs: 1_000,
    warmRoutesMs: [100],
    panelsMs: [100],
    filterMs: Array(100).fill(100),
    paletteMs: Array(100).fill(100),
    palettePreviewMs: Array(100).fill(100),
    patchesMs: Array(50).fill(100),
    graph: interaction,
    list: interaction,
    cls: 0,
    selectionBefore: selection,
    selectionAfter: Array(50).fill(selection),
    nodeCount: manifest.nodeCount,
    edgeCount: manifest.edgeCount,
    browserErrors: [],
  };
}

describe('offline dashboard trace contract smoke', () => {
  it('freezes only wall time while preserving native trace marks and scheduling', () => {
    const now = Date.parse('2026-10-19T12:00:00Z');
    const sandbox = {
      Date,
      performance,
      requestAnimationFrame: () => {},
      setTimeout,
    };
    const requestFrame = sandbox.requestAnimationFrame;
    runInNewContext(`(${installFixedDashboardDate.toString()})(${now})`, sandbox);
    expect(sandbox.Date.now()).toBe(now);
    expect(new sandbox.Date().getTime()).toBe(now);
    expect(sandbox.Date()).toBe(new Date(now).toString());
    expect(new sandbox.Date(0).getTime()).toBe(0);
    expect(new sandbox.Date(2020, 0, 2).getTime()).toBe(new Date(2020, 0, 2).getTime());
    expect(sandbox.Date.parse('2020-01-02')).toBe(Date.parse('2020-01-02'));
    expect(sandbox.Date.UTC(2020, 0, 2)).toBe(Date.UTC(2020, 0, 2));
    expect(new sandbox.Date()).toBeInstanceOf(Date);
    expect(sandbox.performance).toBe(performance);
    expect(sandbox.setTimeout).toBe(setTimeout);
    expect(sandbox.requestAnimationFrame).toBe(requestFrame);
    const mark = sandbox.performance.mark('dashboard-clock-smoke');
    expect(performance.getEntriesByName(mark.name)).toContain(mark);
    performance.clearMarks(mark.name);
  });

  it.each(['representative', 'scaling'] as const)(
    'serves isolated %s controls and emits stable task identities without a port',
    (dataset) => {
      const binding = {
        actorId: 'trace-reader',
        projectId: `sha256:${'2'.repeat(64)}`,
        scopeId: 'planning',
        domainId: 'planning',
        domainVersion: '1.0.0',
        generation: 1,
      } as const;
      let body = '';
      const writes: string[] = [];
      const response = {
        setHeader: () => {},
        end: (bytes: string) => {
          body = bytes;
        },
        write: (bytes: string) => {
          writes.push(bytes);
        },
      } as unknown as ServerResponse;
      const request = (url: string, method = 'GET') =>
        ({
          url,
          method,
          headers: { referer: `http://fixture.invalid/__production/?dataset=${dataset}` },
        }) as IncomingMessage;
      expect(
        servePremiumFixture(
          request(`/__fixture/reset?dataset=${dataset}`, 'POST'),
          response,
          binding,
        ),
      ).toBe(true);
      const reset = JSON.parse(body);
      const fixture = buildPremiumDashboardFixture(dataset);
      expect(reset.manifest.nodeCount).toBe(fixture.manifest.nodeCount);
      const state = premiumRequestState(request('/api/planning/graph'), binding);
      if (!state) throw new Error('Missing fixture state.');
      expect(() =>
        servePremiumFixture(
          request(`/__fixture/patch?dataset=${dataset}`, 'POST'),
          response,
          binding,
        ),
      ).toThrow('No Planning SSE consumer');
      state.streams.add(response);
      const selected = state.snapshot.graph.nodes.find(
        (node) => node.id === state.fixture.manifest.selectedId,
      );
      if (!selected) throw new Error('Selected fixture task is absent.');
      servePremiumFixture(
        request(`/__fixture/patch?dataset=${dataset}`, 'POST'),
        response,
        binding,
      );
      expect(writes).toHaveLength(1);
      const emitted = JSON.parse(writes[0].split('data: ')[1].trim());
      expect(emitted).toMatchObject({
        event: 'patch',
        cursor: { eventHead: { sequence: 1 } },
        binding,
        payload: {
          patch: {
            updated: [
              {
                id: selected.id,
                type: selected.type,
                status: selected.status,
                title: 'Fixture patch 1',
                frontmatter: selected.frontmatter,
              },
            ],
            added: [],
            removed: [],
          },
        },
      });
      expect(JSON.parse(body).cursor).toEqual(emitted.cursor);
      expect(state.snapshot.graph.nodes).toHaveLength(fixture.manifest.nodeCount);
      state.streams.delete(response);
      expect(() =>
        servePremiumFixture(request('/__fixture/state?dataset=unknown'), response, binding),
      ).toThrow('Invalid dashboard dataset');
      expect(() =>
        servePremiumFixture(
          request('/__fixture/unknown?dataset=representative'),
          response,
          binding,
        ),
      ).toThrow('Invalid fixture control');
      expect(servePremiumFixture(request('/unrelated'), response, binding)).toBe(false);
    },
  );
  it('accepts complete boundary measurements against fixture assets', () => {
    expect(
      evaluateDashboardTrace('representative', smokeMeasurements('representative')),
    ).toMatchObject({
      passed: true,
      policy: 'budget',
      summaries: { filterP95Ms: 100, graphFrameWorkP95Ms: 12 },
    });
  });
  it('names a slow route even when its tail is hidden by the combined p95', () => {
    const warmRouteSamples = [
      ...Array.from({ length: 40 }, (_, index) => ({
        route: index % 2 === 0 ? '#/board' : '#/list',
        durationMs: 30,
      })),
      ...Array.from({ length: 20 }, (_, index) => ({
        route: '#/graph',
        durationMs: index < 18 ? 40 : 110,
      })),
    ];
    const metrics = {
      ...smokeMeasurements('representative'),
      warmRouteSamples,
      warmRoutesMs: warmRouteSamples.map((sample) => sample.durationMs),
    };
    expect(evaluateDashboardTrace('representative', metrics)).toMatchObject({
      summaries: {
        warmRouteP95Ms: 40,
        warmRouteP95ByRouteMs: { '#/board': 30, '#/list': 30, '#/graph': 110 },
      },
      failures: ['#/graph warmRouteP95Ms exceeds budget.'],
    });
    expect(evaluateDashboardTrace('scaling', metrics)).toMatchObject({
      summaries: { warmRouteP95ByRouteMs: { '#/graph': 110 } },
      failures: ['Graph cardinality changed.'],
    });
    expect(
      evaluateDashboardTrace('representative', {
        ...metrics,
        warmRouteSamples: warmRouteSamples.slice(1),
      }).failures,
    ).toContain('Warm route samples are inconsistent.');
    for (const sample of [
      { route: ' ', durationMs: 30 },
      { route: '#/graph', durationMs: Number.NaN },
    ])
      expect(() =>
        evaluateDashboardTrace('representative', {
          ...metrics,
          warmRouteSamples: [sample],
        }),
      ).toThrow(TypeError);
  });
  it('enforces List warm-load headroom on the representative tier', () => {
    for (const [durationMs, passed] of [
      [59.9, true],
      [60, false],
      [92.1, false],
    ] as const) {
      const samples = [{ route: '#/list', durationMs }];
      const result = evaluateDashboardTrace('representative', {
        ...smokeMeasurements('representative'),
        warmRouteSamples: samples,
        warmRoutesMs: [durationMs],
      });
      expect(result.passed).toBe(passed);
      expect(result.failures).toEqual(passed ? [] : ['#/list warmRouteP95Ms exceeds budget.']);
    }
  });

  it('reports each latency, stability, integrity and interaction violation', () => {
    const base = smokeMeasurements('representative');
    const result = evaluateDashboardTrace('representative', {
      ...base,
      coldShellMs: 501,
      usefulSnapshotMs: 1_001,
      warmRoutesMs: [101],
      panelsMs: [101],
      filterMs: Array(100).fill(101),
      paletteMs: Array(100).fill(101),
      patchesMs: Array(50).fill(101),
      graph: {
        ...base.graph,
        frameWorkMs: [16.8],
        longTasksMs: [51],
        cls: 0.01,
        interactionObserved: false,
      },
      cls: 0.01,
      selectionAfter: [{ ...base.selectionBefore, id: null, focusedId: null, anchorTop: 500 }],
      nodeCount: 707,
      browserErrors: ['Renderer crashed.'],
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(14);
  });
  it('records scaling measurements without applying a 60fps or latency budget', () => {
    const base = smokeMeasurements('scaling');
    expect(
      evaluateDashboardTrace('scaling', {
        ...base,
        coldShellMs: 8_000,
        usefulSnapshotMs: 9_000,
        warmRoutesMs: [500],
        graph: { ...base.graph, frameWorkMs: [70], longTasksMs: [150] },
      }),
    ).toMatchObject({ passed: true, policy: 'scaling-baseline' });
    expect(evaluateDashboardTrace('scaling', { ...base, edgeCount: 8_498 }).passed).toBe(false);
    expect(
      evaluateDashboardTrace('scaling', {
        ...base,
        selectionAfter: base.selectionAfter.map((sample) => ({ ...sample, scrollTop: 0 })),
      }).passed,
    ).toBe(false);
  });
  it('uses nearest-rank p95 and rejects missing or corrupt metrics', () => {
    expect(percentile95(Array.from({ length: 100 }, (_, index) => index + 1))).toBe(95);
    for (const samples of [[], [Number.NaN], [-1], [Number.POSITIVE_INFINITY]])
      expect(() => percentile95(samples)).toThrow();
    expect(() =>
      evaluateDashboardTrace('representative', {
        ...smokeMeasurements('representative'),
        paletteMs: [],
      }),
    ).toThrow();
    expect(
      evaluateDashboardTrace('representative', {
        ...smokeMeasurements('representative'),
        palettePreviewMs: null,
      }),
    ).toMatchObject({
      passed: false,
      status: 'failed',
      failures: ['Palette preview measurements are absent.'],
      pending: [],
    });
  });
  it('fails missing graph interactions and missing palette preview independently', () => {
    const base = smokeMeasurements('representative');
    const metrics = {
      ...base,
      palettePreviewMs: null,
      graph: {
        ...base.graph,
        interactionObserved: false,
      },
    };
    expect(evaluateDashboardTrace('representative', metrics)).toMatchObject({
      status: 'failed',
      passed: false,
      failures: [
        'Palette preview measurements are absent.',
        'graph interaction trace is incomplete.',
      ],
      pending: [],
    });
    expect(
      evaluateDashboardTrace('representative', { ...metrics, coldShellMs: 501 }),
    ).toMatchObject({
      status: 'failed',
      passed: false,
      failures: [
        'Palette preview measurements are absent.',
        'graph interaction trace is incomplete.',
        'Cold shell exceeds budget.',
      ],
    });
  });
  it('enforces independent result and preview p95 budgets with complete preview samples', () => {
    const base = smokeMeasurements('representative');
    for (const field of ['paletteMs', 'palettePreviewMs'] as const) {
      const result = evaluateDashboardTrace('representative', {
        ...base,
        [field]: Array(TRACE_PLAN.inputCount).fill(101),
      });
      expect(result.status).toBe('failed');
      expect(result.pending).toEqual([]);
      expect(result.failures).toEqual([
        `${field === 'paletteMs' ? 'paletteP95Ms' : 'palettePreviewP95Ms'} exceeds budget.`,
      ]);
    }
    expect(
      evaluateDashboardTrace('representative', {
        ...base,
        palettePreviewMs: Array(TRACE_PLAN.inputCount - 1).fill(100),
      }).failures,
    ).toEqual(['Palette preview measurements are incomplete.']);
    expect(() =>
      evaluateDashboardTrace('representative', { ...base, palettePreviewMs: [] }),
    ).toThrow();
    expect(() =>
      evaluateDashboardTrace('representative', { ...base, palettePreviewMs: [Number.NaN] }),
    ).toThrow();
  });
  it('measures renderer work with overlapping task intervals counted once', () => {
    const result = rendererFrameWork([
      { name: 'thread_name', ph: 'M', ts: 0, pid: 1, tid: 2, args: { name: 'CrRendererMain' } },
      { name: 'dashboard-interaction-start', ph: 'I', ts: 0, pid: 1, tid: 2 },
      { name: 'dashboard-interaction-end', ph: 'I', ts: 32_001, pid: 1, tid: 2 },
      ...[0, 16_000, 32_000].map((ts) => ({
        name: 'dashboard-frame',
        ph: 'I',
        ts,
        dur: 100,
        pid: 1,
        tid: 2,
      })),
      { name: 'RunTask', ph: 'X', ts: 1_000, dur: 5_000, pid: 1, tid: 2 },
      { name: 'RunTask', ph: 'X', ts: 2_000, dur: 2_000, pid: 1, tid: 2 },
      { name: 'RunTask', ph: 'X', ts: 15_000, dur: 3_000, pid: 1, tid: 2 },
      { name: 'RunTask', ph: 'X', ts: 0, dur: 50_000, pid: 9, tid: 9 },
    ]);
    expect(result).toEqual([6, 2]);
    expect(() =>
      rendererFrameWork([
        { name: 'thread_name', ph: 'M', ts: 0, pid: 1, tid: 2, args: { name: 'CrRendererMain' } },
      ]),
    ).toThrow('Dashboard frame marks are absent. Preserve native performance.mark.');
    expect(() =>
      rendererFrameWork([
        { name: 'thread_name', ph: 'M', ts: 0, pid: 9, tid: 9, args: { name: 'CrRendererMain' } },
        { name: 'dashboard-frame', ph: 'I', ts: 0, pid: 1, tid: 2 },
      ]),
    ).toThrow('Renderer main thread metadata is absent.');
  });
});
