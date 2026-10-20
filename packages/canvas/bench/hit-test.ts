import type { NodeId, Point } from '../src/index.mts';
import { percentile95 } from '../src/testing/index.mts';

export type HitTestProbe = {
  p95Ms: number;
  sampleCount: number;
  queryCount: number;
  hitCount: number;
  minSampleDurationMs: number;
};

export function measureHitTests(
  query: (point: Point) => NodeId | null,
  bounds: { width: number; height: number },
  now: () => number = () => performance.now(),
): HitTestProbe {
  let seed = 7;
  const random = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const durations: number[] = [];
  let queryCount = 0;
  let hitCount = 0;
  let minSampleDurationMs = Infinity;
  for (let index = 0; index < 1000; index += 1) {
    const point = { x: random() * bounds.width, y: random() * bounds.height };
    const start = now();
    let elapsed = 0;
    let count = 0;
    // Batches span multiple clock ticks before normalizing to milliseconds per query.
    do {
      for (let repeat = 0; repeat < 100; repeat += 1) {
        if (query(point) !== null) hitCount += 1;
      }
      count += 100;
      elapsed = now() - start;
      if (!Number.isFinite(elapsed) || elapsed < 0)
        throw new Error(`Hit-test sample ${index}: invalid elapsed milliseconds ${elapsed}`);
      if (count >= 1_000_000 && elapsed < 1)
        throw new Error(
          `Hit-test sample ${index}: clock advanced ${elapsed} ms after ${count} queries`,
        );
    } while (elapsed < 1);
    queryCount += count;
    minSampleDurationMs = Math.min(minSampleDurationMs, elapsed);
    durations.push(elapsed / count);
  }
  return {
    p95Ms: percentile95(durations),
    sampleCount: durations.length,
    queryCount,
    hitCount,
    minSampleDurationMs,
  };
}
