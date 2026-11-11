// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBench, type Scenario } from '../bench/harness';
import { type CanvasController, createCanvas } from '../src/index.mts';

vi.mock('../bench/hit-test', () => ({
  measureHitTests: () => ({
    p95Ms: 0.01,
    sampleCount: 1000,
    queryCount: 1000,
    hitCount: 0,
    minSampleDurationMs: 1,
  }),
}));

const controllers: CanvasController[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const start = Date.now();
  vi.stubGlobal('performance', {
    now: () => Date.now() - start,
    mark: vi.fn(),
    clearMarks: vi.fn(),
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  vi.stubGlobal('PerformanceObserver', undefined);
  const getContext = vi.mocked(HTMLCanvasElement.prototype.getContext).getMockImplementation();
  if (!getContext) throw new Error('Canvas context mock is missing');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    contextId: string,
  ) {
    return contextId === 'webgl' ? null : getContext.call(this, contextId);
  });
});

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function makeBench() {
  const stage = document.createElement('div');
  const world = document.createElement('div');
  stage.append(world);
  document.body.append(stage);
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 900));
  const controller = createCanvas({ label: 'Bench setup', motion: 'none' });
  controllers.push(controller);
  controller.setNodes(
    Array.from({ length: 5000 }, (_, index) => ({
      id: `node-${index}`,
      bounds: { x: (index % 100) * 50, y: Math.floor(index / 100) * 50, width: 40, height: 40 },
    })),
  );
  controller.attach({ stage, world });
  const bench = createBench({
    controller,
    stage,
    world,
    fixtureName: 'dense-5000',
    worldType: 'html',
    setNodes: (nodes) => controller.setNodes(nodes),
  });
  await vi.advanceTimersByTimeAsync(16);
  await bench.ready;
  return { controller, bench };
}

describe('bench scenario readiness', () => {
  it.each([
    ['pan-40', 'compact'],
    ['pan-100', 'dom'],
    ['zoom-sweep', 'dom'],
    ['pan-fit', 'overview'],
  ] as const)(
    'starts %s measurement in %s after a slow overview handoff',
    async (scenario, level) => {
      const { controller, bench } = await makeBench();
      const levels: string[] = [];
      const readMetrics = controller.getOverviewMetrics.bind(controller);
      vi.spyOn(controller, 'getOverviewMetrics').mockImplementation(() => {
        levels.push(controller.getLevel());
        return readMetrics();
      });
      const run = bench.run(scenario);
      await vi.advanceTimersByTimeAsync(8000);
      const result = await run;
      expect(result.fitCamera.zoom).toBeLessThan(0.37);
      expect(levels[0]).toBe(level);
      expect(result.startCamera.zoom).toBe(
        scenario === 'pan-fit' ? result.fitCamera.zoom : scenario === 'pan-40' ? 0.4 : 1,
      );
    },
  );

  it('waits for the remount setup to leave overview before measuring admissions', async () => {
    const { controller, bench } = await makeBench();
    controller.setCamera({ x: 0, y: 0, zoom: 0.2 });
    await vi.advanceTimersByTimeAsync(32);
    expect(controller.getLevel()).toBe('overview');
    const levels: string[] = [];
    const readMetrics = controller.getOverviewMetrics.bind(controller);
    vi.spyOn(controller, 'getOverviewMetrics').mockImplementation(() => {
      levels.push(controller.getLevel());
      return readMetrics();
    });
    const run = bench.remount();
    await vi.advanceTimersByTimeAsync(2000);
    await run;
    expect(levels[0]).toBe('dom');
  });

  it.each(['pan-40', 'pan-100', 'zoom-sweep', 'remount'] as const)(
    'bounds a stuck overview during %s setup with a fixture and camera error',
    async (scenario) => {
      const { controller, bench } = await makeBench();
      vi.spyOn(controller, 'getLevel').mockReturnValue('overview');
      const run = scenario === 'remount' ? bench.remount() : bench.run(scenario satisfies Scenario);
      const assertion = expect(run).rejects.toThrow(
        `Canvas dense-5000 ${scenario} setup: overview did not return to DOM at zoom 1 within 5000 ms`,
      );
      await vi.advanceTimersByTimeAsync(6000);
      await assertion;
    },
  );

  it('times out even when animation frames stop during the overview handoff', async () => {
    const { controller, bench } = await makeBench();
    let waiting = false;
    vi.spyOn(controller, 'getLevel').mockImplementation(() => {
      waiting = true;
      return 'overview';
    });
    const requestFrame = requestAnimationFrame;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      waiting ? 0 : requestFrame(callback),
    );
    const assertion = expect(bench.run('pan-40')).rejects.toThrow(
      'overview did not return to DOM at zoom 1 within 5000 ms',
    );
    await vi.advanceTimersByTimeAsync(6000);
    await assertion;
  });
});
