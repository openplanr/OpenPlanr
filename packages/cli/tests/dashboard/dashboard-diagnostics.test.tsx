// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../../../apps/dashboard/src/app/App.js';
import { CompatibilityPage } from '../../../../apps/dashboard/src/features/diagnostics/CompatibilityPage.js';
import { resolveCompatibilityDiagnostics } from '../../../../apps/dashboard/src/features/diagnostics/compatibility-model.js';
import { SupportSummary } from '../../../../apps/dashboard/src/features/diagnostics/SupportSummary.js';
import { ProjectionBoundary } from '../../../../apps/dashboard/src/features/shell/ProjectionBoundary.js';
import type { DashboardBootstrap } from '../../../../apps/dashboard/src/lib/api/bootstrap.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

afterEach(cleanup);

const BUILD_ID = 'dashboard-diagnostics-test';
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

function bootstrap(
  overrides: Partial<{
    status: 'compatible' | 'incompatible';
    reasonCodes: readonly string[];
    buildId: string | null;
    expectedBuildId: string | null;
    diagnosticsAvailable: boolean;
    commandsAvailable: boolean;
  }> = {},
): DashboardBootstrap {
  const buildId = overrides.buildId ?? BUILD_ID;
  const expectedBuildId = overrides.expectedBuildId ?? BUILD_ID;
  const reasonCodes = overrides.reasonCodes ?? [];
  return Object.freeze({
    kind: 'dashboard-bootstrap',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    ui: Object.freeze({
      buildId,
      expectedBuildId,
      assetManifestHash: HASH_A,
    }),
    server: Object.freeze({ packageVersion: '1.25.3' }),
    capabilities: Object.freeze({
      planningGraph: Object.freeze({ schemaVersion: '1.0.0' }),
      operateExperience: Object.freeze({
        protocolVersion: '2.0.0',
        schemaVersion: '1.0.0',
      }),
      operateCommands: Object.freeze({
        protocolVersion: '2.0.0',
        transportVersion: '1.0.0',
        available: overrides.commandsAvailable ?? true,
      }),
      diagnostics: Object.freeze({
        schemaVersion: '1.0.0',
        available: overrides.diagnosticsAvailable ?? true,
      }),
    }),
    project: Object.freeze({
      projectId: HASH_B,
      name: 'planr-pipeline',
      branch: 'main',
      products: Object.freeze(['planning', 'operate']),
    }),
    queryRoots: Object.freeze({ planning: null, operate: null }),
    origin: 'http://127.0.0.1:7473',
    compatibility: Object.freeze({
      status: overrides.status ?? (reasonCodes.length > 0 ? 'incompatible' : 'compatible'),
      reasonCodes: Object.freeze([...reasonCodes]),
    }),
  });
}

describe('dashboard diagnostics model', () => {
  it('covers boot, package, API, watcher, and optional dependency categories', () => {
    const findings = resolveCompatibilityDiagnostics({
      embeddedBuildId: BUILD_ID,
      bootstrap: bootstrap({
        status: 'incompatible',
        reasonCodes: ['DASHBOARD_BUILD_MISMATCH', 'DASHBOARD_ASSET_MISSING'],
        buildId: 'dashboard-old',
        expectedBuildId: BUILD_ID,
        diagnosticsAvailable: false,
        commandsAvailable: false,
      }),
      bootPhase: 'incompatible',
      bootDetail: 'DASHBOARD_BUILD_MISMATCH',
      connection: Object.freeze({
        state: 'stale',
        label: 'Projection is stale',
        reason: 'Watcher gap detected while reconciling live updates.',
      }),
    });

    expect(findings.map((entry) => entry.category)).toEqual([
      'boot',
      'incompatible-installation',
      'missing-asset',
      'stale-package',
      'api-version',
      'watcher-gap',
      'optional-dependency',
    ]);
    expect(findings.find((entry) => entry.category === 'missing-asset')?.status).toBe('fail');
    expect(findings.find((entry) => entry.category === 'stale-package')?.status).toBe('fail');
    expect(findings.find((entry) => entry.category === 'optional-dependency')?.status).toBe('warn');
  });
});

describe('SupportSummary', () => {
  it('never renders private installation paths in the support bundle', () => {
    const privateMarker = '/Users/owner/private-dashboard-path';
    render(
      <SupportSummary
        embeddedBuildId={BUILD_ID}
        bootstrap={bootstrap({
          reasonCodes: ['DASHBOARD_MANIFEST_INVALID'],
          buildId: privateMarker as unknown as string,
        })}
      />,
    );

    expect(screen.getByLabelText('Support bundle text').textContent).not.toContain(privateMarker);
    expect(screen.getByText('Redacted')).not.toBeNull();
    expect(screen.getByText('DASHBOARD_MANIFEST_INVALID')).not.toBeNull();
  });
});

describe('CompatibilityPage', () => {
  it('renders certified remediation without mutation authority', () => {
    render(
      <CompatibilityPage
        embeddedBuildId={BUILD_ID}
        bootstrap={bootstrap({
          status: 'incompatible',
          reasonCodes: ['DASHBOARD_MANIFEST_MISSING', 'DASHBOARD_BUILD_MISMATCH'],
          buildId: 'dashboard-old',
          expectedBuildId: BUILD_ID,
        })}
        bootPhase="incompatible"
        bootDetail="DASHBOARD_BUILD_MISMATCH"
        connection={Object.freeze({
          state: 'incompatible',
          label: 'Dashboard installation is incompatible',
          reason: 'DASHBOARD_MANIFEST_MISSING · DASHBOARD_BUILD_MISMATCH',
        })}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Compatibility and installation checks' }),
    ).not.toBeNull();
    expect(screen.getByText('Dashboard compatibility needs attention')).not.toBeNull();
    expect(screen.getAllByText(/DASHBOARD_MANIFEST_MISSING/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        /Diagnostics do not create arguments, authority, effects, repeated instructions, PLAN runs, or SHIP runs./,
      ),
    ).not.toBeNull();
  });
});

describe('ProjectionBoundary diagnostics link', () => {
  it('links incompatible projection states to the diagnostics route', () => {
    const state = parseDashboardProductState({
      kind: 'incompatible',
      binding: null,
      data: null,
      reasonCodes: ['DASHBOARD_INCOMPATIBLE'],
      error: {
        code: 'DASHBOARD_BUILD_MISMATCH',
        retryable: false,
        context: {},
      },
      mutationEnabled: false,
      policy: dashboardProductStatePolicy('incompatible'),
    });
    render(
      <ProjectionBoundary currentBinding={null} state={state}>
        {() => null}
      </ProjectionBoundary>,
    );

    const link = screen.getByRole('link', { name: 'Open diagnostics' });
    expect(link.getAttribute('href')).toBe('#/diagnostics');
  });
});

describe('App diagnostics routing', () => {
  it('renders diagnostics for an explicit diagnostics hash with a compatible bootstrap override', () => {
    render(
      <App
        buildId={BUILD_ID}
        initialHash="#/diagnostics"
        bootstrap={bootstrap()}
        bootPhase="compatible"
        connection={Object.freeze({
          state: 'connected',
          label: 'Connected to local OpenPlanr',
          reason: 'Validated projection channel is available.',
        })}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Compatibility and installation checks' }),
    ).not.toBeNull();
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getByText('Dashboard compatibility is certified')).not.toBeNull();
    expect(document.querySelector('.op-route-announcer')?.textContent).toContain('Diagnostics');
    expect(screen.queryByText('Search project')).toBeNull();
  });

  it('replaces the shell when bootstrap custody is incompatible', () => {
    render(
      <App
        buildId={BUILD_ID}
        bootstrap={bootstrap({
          status: 'incompatible',
          reasonCodes: ['DASHBOARD_ASSET_MISSING', 'DASHBOARD_BUILD_MISMATCH'],
          buildId: 'dashboard-old',
          expectedBuildId: BUILD_ID,
        })}
        bootPhase="incompatible"
        connection={Object.freeze({
          state: 'incompatible',
          label: 'Dashboard installation is incompatible',
          reason: 'DASHBOARD_ASSET_MISSING · DASHBOARD_BUILD_MISMATCH',
        })}
      />,
    );

    expect(screen.getByText('Packaged asset is missing')).not.toBeNull();
    expect(document.querySelector('.op-route-announcer')?.textContent).toContain('Diagnostics');
    expect(screen.queryByText('Search project')).toBeNull();
  });
});

describe('product-state diagnostics boundary', () => {
  it('keeps incompatible product-state recovery guidance access-safe', () => {
    const binding = createDashboardQueryIdentity({
      productArea: 'operate',
      route: '#/operate/recovery',
      actorId: 'owner-dashboard',
      projectId: HASH_A,
      scopeId: 'scope-dashboard',
      domainId: 'software-delivery',
      domainVersion: '2.0.0',
      cycleId: 'cycle-current',
      subjectId: null,
      eventHead: { sequence: 46, hash: HASH_B },
      viewHash: HASH_A,
      generation: 7,
    });
    const state = parseDashboardProductState({
      kind: 'incompatible',
      binding: null,
      data: null,
      reasonCodes: ['DASHBOARD_INCOMPATIBLE', 'DASHBOARD_BUILD_MISMATCH'],
      error: {
        code: 'DASHBOARD_BUILD_MISMATCH',
        retryable: false,
        context: {},
      },
      mutationEnabled: false,
      policy: dashboardProductStatePolicy('incompatible'),
    });

    render(
      <ProjectionBoundary currentBinding={binding} state={state}>
        {() => null}
      </ProjectionBoundary>,
    );

    expect(screen.getByText('Dashboard installation is incompatible')).not.toBeNull();
    expect(
      screen.getAllByText(
        'Install matching OpenPlanr dashboard assets, then verify compatibility again.',
      ).length,
    ).toBeGreaterThan(0);
  });
});
