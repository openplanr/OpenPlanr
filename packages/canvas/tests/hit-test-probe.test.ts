import { describe, expect, it } from 'vitest';
import { measureHitTests } from '../bench/hit-test';
import { createCanvas, type Point } from '../src/index.mjs';

describe('hit-test probe', () => {
  it('runs real grid queries at 1000 seeded points and resolves sub-millisecond latency', () => {
    const controller = createCanvas({ label: 'Hit-test probe' });
    controller.setNodes([{ id: 'cover', bounds: { x: 0, y: 0, width: 800, height: 600 } }]);
    let microseconds = 0;
    let calls = 0;
    const points = new Set<Point>();
    try {
      const probe = measureHitTests(
        (point) => {
          calls += 1;
          microseconds += 2;
          points.add(point);
          return controller.hitTest(point);
        },
        { width: 800, height: 600 },
        () => Math.floor(microseconds / 100) / 10,
      );
      expect(probe.sampleCount).toBe(1000);
      expect(points.size).toBe(1000);
      expect(probe.queryCount).toBe(calls);
      expect(calls).toBeGreaterThanOrEqual(100_000);
      expect(probe.hitCount).toBe(calls);
      expect(probe.minSampleDurationMs).toBeGreaterThanOrEqual(1);
      expect(probe.p95Ms).toBeCloseTo(0.002, 10);
    } finally {
      controller.destroy();
    }
  });

  it('counts misses and preserves a positive measurement with a coarser clock', () => {
    let microseconds = 0;
    let calls = 0;
    const probe = measureHitTests(
      () => {
        calls += 1;
        microseconds += 2;
        return null;
      },
      { width: 800, height: 600 },
      () => Math.floor(microseconds / 1000),
    );
    expect(probe.hitCount).toBe(0);
    expect(probe.queryCount).toBe(calls);
    expect(probe.p95Ms).toBeCloseTo(0.002, 10);
  });

  it('surfaces a clock that cannot produce a measurable sample', () => {
    expect(() =>
      measureHitTests(
        () => null,
        { width: 800, height: 600 },
        () => 0,
      ),
    ).toThrow(/sample 0: clock advanced 0 ms after 1000000 queries/u);
  });
});
