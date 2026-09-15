import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../../../../apps/dashboard/src/app/App.js';
import {
  DASHBOARD_ROUTE_DEFINITIONS,
  parseDashboardRoute,
  serializeDashboardRoute,
} from '../../../../apps/dashboard/src/app/router.js';
import { installedOpenPlanrDashboardRoot } from '../../src/cli/commands/operate.js';
import { DASHBOARD_ROUTE_FIXTURES } from '../e2e/fixtures/dashboard-route-catalog.js';

const TEST_IDENTITY = {
  projectName: 'planr-pipeline',
  projectDetail: 'main · unified dashboard',
  actorLabel: 'owner-dashboard',
  bindingLabel: 'scope-dashboard · business',
} as const;

const TEST_CONNECTION = {
  state: 'connected',
  label: 'Connected to local OpenPlanr',
  reason: 'Validated projection channel is available.',
} as const;

function renderApp(hash: string): string {
  return renderToStaticMarkup(
    <App
      buildId="dashboard-test-build"
      initialHash={hash}
      identity={TEST_IDENTITY}
      connection={TEST_CONNECTION}
    />,
  );
}

const ROUTE_CASES = DASHBOARD_ROUTE_FIXTURES.map(({ hash, kind }) => [hash, kind, hash] as const);

describe('unified dashboard route contract', () => {
  it.each(ROUTE_CASES)('parses and serializes %s exactly', (hash, kind, serialized) => {
    const parsed = parseDashboardRoute(hash);
    expect(parsed.kind).toBe(kind);
    expect(parsed.kind).not.toBe('not-found');
    if (parsed.kind !== 'not-found') expect(serializeDashboardRoute(parsed)).toBe(serialized);
  });

  it('uses Planning overview only for a genuinely absent hash', () => {
    expect(parseDashboardRoute('')).toMatchObject({
      kind: 'planning.overview',
      product: 'planning',
    });
    expect(parseDashboardRoute('#')).toMatchObject({
      kind: 'planning.overview',
      product: 'planning',
    });
    expect(parseDashboardRoute('#/')).toMatchObject({ kind: 'not-found', product: null });
  });

  it.each([
    '#/Overview',
    '#/operate/Today',
    '#/operate',
    '#/operate/unknown',
    '#/operate/actions/action/planning/extra',
    '#/operate/history/foreign',
    '#/operate/actions/action/unknown',
    '#/operate/cycles/.',
    '#/operate/cycles/..',
    '#/operate/cycles/%2e',
    '#/operate/cycles/%2E%2e',
    '#/operate/cycles/a%2Fb',
    '#/operate/cycles/a%5Cb',
    '#/operate/cycles/%E0%A4%A',
    '#/operate//today',
    '#/operate/today/',
    '#/operate/today?actor=foreign',
  ])('rejects unsupported or hostile path %s without retaining foreign identity', (hash) => {
    expect(parseDashboardRoute(hash)).toEqual({
      kind: 'not-found',
      product: null,
      subjectId: null,
    });
    const html = renderApp(hash);
    expect(html).toContain('data-product="system"');
    expect(html).toContain('data-route-kind="not-found"');
  });

  it('keeps every emitted shell navigation link inside the closed grammar', () => {
    for (const definition of DASHBOARD_ROUTE_DEFINITIONS) {
      if (definition.navigation === 'hidden') continue;
      expect(parseDashboardRoute(definition.href).kind).toBe(definition.kind);
    }
  });

  it.each(['a/b', 'a\\b', '.', '..', '', 'line\nfeed'])(
    'refuses to serialize an invalid subject identity %j',
    (subjectId) => {
      expect(() =>
        serializeDashboardRoute({
          kind: 'operate.action',
          product: 'operate',
          subjectId,
        }),
      ).toThrow('valid opaque subject identity');
    },
  );
});

describe('unified dashboard shell', () => {
  it.each([
    ['#/operate/cycles/cycle-46', 'operate.cycle', 'Cycle detail', 'Cycle detail'],
    [
      '#/operate/actions/action-17/planning',
      'operate.action-planning',
      'Planning handoff',
      'Planning handoff',
    ],
    [
      '#/operate/evidence/evidence-8',
      'operate.evidence-item',
      'Evidence detail',
      'Evidence cannot be trusted',
    ],
    [
      '#/operate/outcomes/outcome-3',
      'operate.outcome',
      'Outcome detail',
      'Outcomes cannot be trusted',
    ],
    ['#/operate/history', 'operate.history', 'History', 'History cannot be trusted'],
    ['#/plan/specs/SPEC-020', 'planning.spec', 'SPEC trace', 'Loading SPEC trace'],
  ])('renders direct deep link %s as the correct first view', (hash, kind, label, heading) => {
    const html = renderApp(hash);
    expect(html).toContain(`data-route-kind="${kind}"`);
    expect(html).toContain(label);
    expect(html).toContain(heading);
    expect(html.match(/<main\b/gu)).toHaveLength(1);
  });

  it('keeps project identity, product switching, search, and honest live language stable', () => {
    const planning = renderApp('#/overview');
    const operate = renderApp('#/operate/today');
    for (const html of [planning, operate]) {
      expect(html).toContain('planr-pipeline');
      expect(html).not.toContain('owner-dashboard');
      expect(html).not.toContain('scope-dashboard · business');
      expect(html).toContain('href="#/overview"');
      expect(html).toContain('href="#/operate/today"');
      expect(html).toContain('Open the command palette');
      expect(html).toContain('role="status"');
      expect(html).toContain('title="connection: connected"');
      expect(html).toContain('watcher connected');
      expect(html).toContain('data-dashboard-build-id="dashboard-test-build"');
    }
    expect(planning).toContain('data-product="planning"');
    expect(operate).toContain('data-product="operate"');
  });

  it('mounts the complete dashboard through one React root', () => {
    const testDirectory = dirname(fileURLToPath(import.meta.url));
    const mainSource = readFileSync(
      resolve(testDirectory, '../../../../apps/dashboard/src/main.tsx'),
      'utf8',
    );
    expect(mainSource.match(/createRoot\s*\(/gu)).toHaveLength(1);
    expect(mainSource).toContain('<App buildId={__OPENPLANR_DASHBOARD_BUILD_ID__} />');
  });

  it('keeps contextual destinations reachable in the console navigation', () => {
    const html = renderApp('#/operate/actions/action-17');
    expect(html).toContain('aria-label="Dashboard navigation"');
    for (const href of [
      '#/operate/today',
      '#/operate/inbox',
      '#/operate/actions',
      '#/operate/cycles',
      '#/operate/evidence',
      '#/operate/outcomes',
      '#/operate/history',
      '#/operate/recovery',
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it('keeps normal startup inside the stable shell instead of mounting a page banner', () => {
    const html = renderApp('#/operate/today');
    expect(html).not.toContain('data-responsive-context="binding-status"');
    expect(html).not.toContain('aria-label="Workspace status and technical details"');
    expect(html).not.toContain('Preparing your workspace');
    expect(html).not.toContain('Workspace details');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-route-pending="booting"');
    expect(html).toContain('title="connection: connected"');
    expect(html).toContain('watcher connected');

    const testDirectory = dirname(fileURLToPath(import.meta.url));
    const stylesheet = readFileSync(
      resolve(testDirectory, '../../../../apps/dashboard/src/features/shell/console-shell.css'),
      'utf8',
    );
    expect(stylesheet).toMatch(/\.pc-shell__plane\s*\{[^}]*min-height: 0/u);
    expect(stylesheet).toMatch(/\.pc-shell__scroll\s*\{[^}]*overflow-y: auto/u);
    expect(stylesheet).toMatch(/\.pc-skip-link:focus\s*\{[^}]*transform: none/u);
    expect(stylesheet).toContain('var(--pc-text-inverse)');
  });

  it('keeps an operating route recognisable while its first projection is loading', () => {
    const html = renderApp('#/operate/today');
    expect(html).toContain('data-route-pending="booting"');
    expect(html).toContain('Loading Today');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('data-projection-boundary="booting"');
    expect(html).not.toContain('data-projection-state=');
  });

  it('keeps a Planning route recognisable while its first projection is loading', () => {
    const html = renderApp('#/overview');
    expect(html).toContain('data-route-pending="booting"');
    expect(html).toContain('Loading Overview');
    expect(html).not.toContain('Planning cannot be trusted');
    expect(html).not.toContain('Planning is not available');
  });

  it('contains no browser authority or transport implementation', () => {
    const testDirectory = dirname(fileURLToPath(import.meta.url));
    const dashboardRoot = resolve(testDirectory, '../../../../apps/dashboard/src');
    const source = [
      'app/App.tsx',
      'app/providers.tsx',
      'app/router.tsx',
      'features/shell/UnifiedShell.tsx',
    ]
      .map((file) => readFileSync(resolve(dashboardRoot, file), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/u);
    expect(source).not.toMatch(/actionReference|previewHash|operate\.dispatch/u);
    expect(source).toContain('without starting PLAN or SHIP');
  });

  it('resolves the production entry to the package-owned deterministic dashboard build', () => {
    const testDirectory = dirname(fileURLToPath(import.meta.url));
    expect(installedOpenPlanrDashboardRoot()).toBe(resolve(testDirectory, '../../dist/dashboard'));
  });
});
