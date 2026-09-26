// @vitest-environment node

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, type TestContext } from 'vitest';
import {
  parseDashboardRoute,
  serializeDashboardRoute,
} from '../../../../apps/dashboard/src/app/router.js';
import { resolveCompatibilityDiagnostics } from '../../../../apps/dashboard/src/features/diagnostics/compatibility-model.js';
import type { PlanningModelNode } from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import {
  buildDashboardSearchIndex,
  queryDashboardSearchIndex,
} from '../../../../apps/dashboard/src/features/search/search-index.js';
import {
  DASHBOARD_BUNDLE_BUDGETS,
  verifyDashboardAssets,
} from '../../scripts/verify-dashboard-assets.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dashboardRoot = resolve(repositoryRoot, 'dist/dashboard');

const ROUTE_SAMPLES = [
  '#/overview',
  '#/graph',
  '#/search',
  '#/operate/today',
  '#/operate/cycles/cycle-0001',
  '#/operate/actions/action-0001/planning',
  '#/operate/history',
  '#/diagnostics',
] as const;

function planningNodes(count: number): readonly PlanningModelNode[] {
  return Object.freeze(
    Array.from({ length: count }, (_, index) =>
      Object.freeze({
        id: `US-${String(index + 1).padStart(4, '0')}`,
        type: 'story',
        title: `Story ${index + 1}`,
        status: 'outstanding',
        frontmatter: Object.freeze({ id: `US-${String(index + 1).padStart(4, '0')}` }),
      }),
    ),
  );
}

// Time budgets fail only at SHARED_RUNNER_MARGIN times the product budget, because shared CI
// runners drift by more than the budgets tolerate; the product budget itself is annotated.
const SHARED_RUNNER_MARGIN = 2;

async function expectWithinBudget(
  context: TestContext,
  label: string,
  elapsedMs: number,
  budgetMs: number,
): Promise<void> {
  if (elapsedMs > budgetMs) {
    await context.annotate(
      `${label} ${elapsedMs.toFixed(1)}ms exceeds the ${budgetMs}ms product budget`,
    );
  }
  const limit = budgetMs * SHARED_RUNNER_MARGIN;
  expect(
    elapsedMs,
    `${label} ${elapsedMs.toFixed(1)}ms exceeds ${limit}ms (${SHARED_RUNNER_MARGIN}x the ${budgetMs}ms product budget)`,
  ).toBeLessThanOrEqual(limit);
}

describe('dashboard performance budgets', () => {
  it('keeps packed asset bytes within certified bundle budgets', () => {
    expect(existsSync(dashboardRoot), 'run npm run build before performance tests').toBe(true);
    const report = verifyDashboardAssets(dashboardRoot);
    expect(report.ok, report.violations.join('; ')).toBe(true);
    expect(report.sizes.runtime).toBeLessThanOrEqual(DASHBOARD_BUNDLE_BUDGETS.maxRuntimeAssetBytes);
  });

  it('parses and serializes closed routes within the Today budget', async (context) => {
    const started = performance.now();
    for (let index = 0; index < 5_000; index += 1) {
      for (const hash of ROUTE_SAMPLES) {
        const route = parseDashboardRoute(hash);
        if (route.kind !== 'not-found') serializeDashboardRoute(route);
      }
    }
    const elapsed = performance.now() - started;
    await expectWithinBudget(context, 'route parsing', elapsed, 300);
  });

  it('searches a 1,000-node planning index within the navigation budget', async (context) => {
    const index = buildDashboardSearchIndex({ planningNodes: planningNodes(1_000) });
    const started = performance.now();
    let hits = 0;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      hits += queryDashboardSearchIndex(index, 'story').length;
    }
    const elapsed = performance.now() - started;
    expect(hits).toBeGreaterThan(0);
    await expectWithinBudget(context, 'planning search', elapsed, 300);
  });

  it('resolves diagnostics without unbounded memory growth', () => {
    const beforeHeap = process.memoryUsage().heapUsed;
    for (let index = 0; index < 2_000; index += 1) {
      resolveCompatibilityDiagnostics({
        embeddedBuildId: 'dashboard-performance-test',
        bootstrap: null,
        bootPhase: 'unavailable',
        bootDetail: 'bootstrap unavailable',
        connection: Object.freeze({
          state: 'offline',
          label: 'OpenPlanr is offline',
          reason: 'Watcher gap simulated for diagnostics-only remediation.',
        }),
      });
    }
    const heapDelta = Math.max(0, process.memoryUsage().heapUsed - beforeHeap);
    expect(heapDelta).toBeLessThan(32 * 1024 * 1024);
  });
});
