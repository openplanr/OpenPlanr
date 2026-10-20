import type { Camera, CanvasController, CanvasNode } from '../src/index.mts';
import { type HitTestProbe, measureHitTests } from './hit-test';
import { observeTransformWrites } from './transform-writes';

export type Scenario = 'pan-100' | 'pan-40' | 'pan-fit' | 'zoom-sweep';
export type WriteFrame = { frame: number; world: number; overlay: number };
export type ScenarioOverviewMetrics = ReturnType<CanvasController['getOverviewMetrics']> &
  Readonly<{ peakCachePixelBytes: number }>;
export type ReactScenarioMetrics = {
  commits: number;
  mountEvents: number;
  levelEvents: number;
  pureCameraFrames: number;
  pureCameraCommits: number;
};
export type ScenarioResult = {
  react?: ReactScenarioMetrics;
  intervals: number[];
  writes: WriteFrame[];
  longTasks: number[] | null;
  domNodes: number;
  fitCamera: Camera;
  startCamera: Camera;
  endCamera: Camera;
  minimumZoom: number;
  gpuRenderer: string;
  hitTestP95Ms: number;
  hitTestProbe: HitTestProbe;
  overview: ScenarioOverviewMetrics;
};
export type RemountResult = Pick<
  ScenarioResult,
  'intervals' | 'longTasks' | 'domNodes' | 'gpuRenderer' | 'hitTestP95Ms' | 'hitTestProbe' | 'overview' | 'react'
> & { mountCounts: number[] };
export interface Bench {
  ready: Promise<void>;
  firstFrameMs: number;
  readonly gpuRenderer: string;
  probeHitTests(): HitTestProbe;
  transformWrites: WriteFrame[];
  fixture: string;
  world: 'html' | 'svg';
  setNodes(nodes: readonly CanvasNode[]): void;
  run(scenario: Scenario): Promise<ScenarioResult>;
  remount(): Promise<RemountResult>;
}

declare global {
  interface Window {
    canvas: CanvasController;
    bench: Bench;
    benchError?: string;
  }
}

export function createBench({ controller, stage, world, overlays = [], fixtureName, worldType, setNodes, waitUntilReady, getReactCommits }: {
    controller: CanvasController;
    stage: HTMLElement;
    world: HTMLElement;
    overlays?: readonly HTMLElement[];
    fixtureName: string;
    worldType: 'html' | 'svg';
    setNodes: Bench['setNodes'];
    waitUntilReady?: () => Promise<void>;
    getReactCommits?: () => number;
  }): Bench {
  function gpuRenderer(): string {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    if (!gl) return 'WebGL unavailable';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  }
  const renderer = gpuRenderer();

  let frameNumber = 0;
  let writes: WriteFrame[] = [];
  function recordWrite(target: 'world' | 'overlay'): void {
    let frame = writes.at(-1);
    if (!frame || frame.frame !== frameNumber) {
      frame = { frame: frameNumber, world: 0, overlay: 0 };
      writes.push(frame);
    }
    frame[target] += 1;
  }
  const transformObservers = [
    observeTransformWrites(world, () => recordWrite('world')),
    ...overlays.map((overlay) => observeTransformWrites(overlay, () => recordWrite('overlay'))),
  ];
  function markFrame(): void {
    frameNumber += 1;
    performance.mark('canvas-frame');
    requestAnimationFrame(markFrame);
  }
  requestAnimationFrame(markFrame);
  const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));
  let longTasks: PerformanceEntry[] = [];
  const observer =
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes.includes('longtask')
      ? new PerformanceObserver((list) => {
          longTasks.push(...list.getEntries());
        })
      : null;
  observer?.observe({ type: 'longtask', buffered: true });
  const probeHitTests = () => measureHitTests((point) => controller.hitTest(point), stage.getBoundingClientRect());
  function observeReactScenario() {
    if (!getReactCommits) return undefined;
    const readCommits = getReactCommits;
    const initialCommits = readCommits();
    let previousCommits = initialCommits;
    let previousMounts = 0;
    let previousLevels = 0;
    const metrics: ReactScenarioMetrics = {
      commits: 0, mountEvents: 0, levelEvents: 0, pureCameraFrames: 0, pureCameraCommits: 0,
    };
    const offMount = controller.on('mount', () => { metrics.mountEvents += 1; });
    const offLevel = controller.on('level', () => { metrics.levelEvents += 1; });
    return {
      frame() {
        const commits = readCommits();
        if (metrics.mountEvents === previousMounts && metrics.levelEvents === previousLevels) {
          metrics.pureCameraFrames += 1;
          metrics.pureCameraCommits += commits - previousCommits;
        }
        previousCommits = commits;
        previousMounts = metrics.mountEvents;
        previousLevels = metrics.levelEvents;
      },
      finish() {
        offMount();
        offLevel();
        return { ...metrics, commits: readCommits() - initialCommits };
      },
    };
  }
  const bench: Bench = {
    ready: (waitUntilReady ? waitUntilReady() : nextFrame()).then(() => {
      bench.firstFrameMs = performance.now();
      performance.mark('canvas-first-frame');
    }),
    firstFrameMs: 0,
    gpuRenderer: renderer,
    probeHitTests,
    get transformWrites() {
      for (const observer of transformObservers) observer.flush();
      return writes;
    },
    fixture: fixtureName,
    world: worldType,
    setNodes,
    async remount() {
      bench.setNodes([]);
      controller.setCamera({ x: 0, y: 0, zoom: 1 });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
      await nextFrame();
      const nodes = Array.from({ length: 968 }, (_, index) => ({
        id: `remount-${index}`,
        bounds: { x: (index % 44) * 30, y: Math.floor(index / 44) * 30, width: 20, height: 20 },
      }));
      const mountCounts: number[] = [];
      let previousCount = 0;
      const off = controller.on('mount', (ids) => {
        mountCounts.push(ids.size - previousCount);
        previousCount = ids.size;
      });
      const intervals: number[] = [];
      longTasks = [];
      performance.clearMarks('canvas-remount-start');
      performance.clearMarks('canvas-remount-end');
      let previous = await nextFrame();
      const overviewStart = controller.getOverviewMetrics();
      let peakCachePixelBytes = overviewStart.cachePixelBytes;
      const start = performance.now();
      const react = observeReactScenario();
      performance.mark('canvas-remount-start');
      bench.setNodes(nodes);
      for (let frame = 0; frame < 30 && controller.getMountedIds().size < nodes.length; frame += 1) {
        const time = await nextFrame();
        peakCachePixelBytes = Math.max(peakCachePixelBytes, controller.getOverviewMetrics().cachePixelBytes);
        intervals.push(time - previous);
        previous = time;
      }
      await nextFrame();
      performance.mark('canvas-remount-end');
      const end = performance.now();
      off();
      if (controller.getMountedIds().size !== nodes.length)
        throw new Error(`Remount admitted ${controller.getMountedIds().size} of ${nodes.length} nodes`);
      await nextFrame();
      longTasks.push(...(observer?.takeRecords() ?? []));
      const hitTestProbe = probeHitTests();
      const overview = controller.getOverviewMetrics();
      peakCachePixelBytes = Math.max(peakCachePixelBytes, overview.cachePixelBytes);
      return {
        intervals,
        mountCounts,
        ...(react ? { react: react.finish() } : {}),
        longTasks: observer
          ? longTasks.filter((entry) => entry.startTime >= start && entry.startTime < end && entry.duration > 50).map((entry) => entry.duration)
          : null,
        domNodes: stage.querySelectorAll('*').length,
        gpuRenderer: renderer,
        hitTestP95Ms: hitTestProbe.p95Ms,
        hitTestProbe,
        overview: {
          ...overview,
          peakCachePixelBytes,
          redraws: overview.redraws - overviewStart.redraws,
          presentationLagFrames: overview.presentationLagFrames.slice(overviewStart.presentationLagFrames.length),
        },
      };
    },
    async run(scenario) {
      controller.fit('all', { padding: 32, maxZoom: 1 });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 220));
      await nextFrame();
      const fitCamera = controller.getCamera();
      controller.setCamera(fitCamera);
      if (scenario === 'pan-40') {
        controller.setCamera({ x: 0, y: 0, zoom: 1 });
        await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
        await nextFrame();
      }
      if (scenario !== 'pan-fit')
        controller.setCamera({ x: 0, y: 0, zoom: scenario === 'pan-40' ? 0.4 : 1 });
      if (scenario === 'pan-40') {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
        await nextFrame();
        if (controller.getLevel() !== 'compact')
          throw new Error(`Compact pan benchmark entered ${controller.getLevel()} at zoom 0.4`);
      }
      await nextFrame();
      await nextFrame();
      for (const observer of transformObservers) observer.flush();
      writes = [];
      longTasks = [];
      performance.clearMarks('canvas-interaction-start');
      performance.clearMarks('canvas-interaction-end');
      const intervals: number[] = [];
      const overviewStart = controller.getOverviewMetrics();
      let peakCachePixelBytes = overviewStart.cachePixelBytes;
      const startCamera = controller.getCamera();
      let minimumZoom = startCamera.zoom;
      let domNodes = stage.querySelectorAll('*').length;
      let previous = await nextFrame();
      const start = performance.now();
      const react = observeReactScenario();
      performance.mark('canvas-interaction-start');
      for (let index = 0; index < 180; index += 1) {
        if (scenario === 'zoom-sweep') {
          const fraction = index < 90 ? (index + 1) / 90 : (179 - index) / 90;
          const zoom = Math.exp(Math.log(fitCamera.zoom) * fraction);
          controller.zoomAt(zoom / controller.getCamera().zoom);
        } else {
          controller.panBy(2 + Math.sin(index / 20), 1 + Math.cos(index / 20));
          controller.panBy(1, 0.5);
        }
        minimumZoom = Math.min(minimumZoom, controller.getCamera().zoom);
        domNodes = Math.max(domNodes, stage.querySelectorAll('*').length);
        const now = await nextFrame();
        react?.frame();
        peakCachePixelBytes = Math.max(peakCachePixelBytes, controller.getOverviewMetrics().cachePixelBytes);
        intervals.push(now - previous);
        previous = now;
      }
      performance.mark('canvas-interaction-end');
      const end = performance.now();
      await nextFrame();
      for (const observer of transformObservers) observer.flush();
      longTasks.push(...(observer?.takeRecords() ?? []));
      const hitTestProbe = probeHitTests();
      const overview = controller.getOverviewMetrics();
      peakCachePixelBytes = Math.max(peakCachePixelBytes, overview.cachePixelBytes);
      return {
        intervals,
        writes: [...writes],
        ...(react ? { react: react.finish() } : {}),
        fitCamera,
        startCamera,
        endCamera: controller.getCamera(),
        minimumZoom,
        longTasks: observer
          ? longTasks
              .filter(
                (entry) => entry.startTime >= start && entry.startTime < end && entry.duration > 50,
              )
              .map((entry) => entry.duration)
          : null,
        domNodes,
        gpuRenderer: renderer,
        hitTestP95Ms: hitTestProbe.p95Ms,
        hitTestProbe,
        overview: {
          ...overview,
          peakCachePixelBytes,
          redraws: overview.redraws - overviewStart.redraws,
          presentationLagFrames: overview.presentationLagFrames.slice(overviewStart.presentationLagFrames.length),
        },
      };
    },
  };
  window.bench = bench;
  return bench;
}
