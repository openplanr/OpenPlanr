// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

describe('dashboard shell binding summary', () => {
  it('keeps a connected workspace out of the page hierarchy', () => {
    const binding = createDashboardQueryIdentity({
      productArea: 'operate',
      actorId: 'owner-bound',
      projectId: `sha256:${'c'.repeat(64)}`,
      scopeId: 'scope-bound',
      domainId: 'business',
      domainVersion: '1.0.0',
      cycleId: 'cyc_bound_12345678',
      route: '#/operate/today',
      subjectId: null,
      generation: 4,
      eventHead: { sequence: 1, hash: `sha256:${'a'.repeat(64)}` },
      viewHash: `sha256:${'b'.repeat(64)}`,
    });
    const projection = parseDashboardProductState(
      {
        kind: 'ready',
        binding,
        data: {},
        reasonCodes: [],
        error: null,
        mutationEnabled: false,
        policy: dashboardProductStatePolicy('ready'),
      },
      { currentBinding: binding, validateData: (value) => value as Record<string, unknown> },
    );
    const { container } = render(
      <DashboardProviders
        buildId="binding-test"
        initialHash="#/operate/today"
        identity={{
          projectName: 'OpenPlanr',
          projectDetail: 'local',
          actorLabel: 'Actor binding pending',
          bindingLabel: 'Scope and domain pending',
        }}
        connection={{ state: 'connected', label: 'Connected', reason: 'Verified.' }}
        binding={binding}
        projection={projection}
      >
        <UnifiedShell />
      </DashboardProviders>,
    );

    expect(container.querySelector('.op-binding-passport')).toBeNull();
    expect(container.querySelector('.pc-topbar__end')?.textContent).toContain('connected');
    expect(container.textContent).not.toContain('Ready to review');
    expect(container.textContent).not.toContain('Workspace details');
    expect(container.textContent).not.toContain('owner-bound');
    expect(container.textContent).not.toContain('scope-bound');
  });

  it('keeps recovery context visible only when the connection is degraded', () => {
    const binding = createDashboardQueryIdentity({
      productArea: 'planning',
      actorId: 'owner-bound',
      projectId: `sha256:${'d'.repeat(64)}`,
      scopeId: 'scope-bound',
      domainId: 'planning',
      domainVersion: '1.0.0',
      cycleId: null,
      route: '#/overview',
      subjectId: null,
      generation: 4,
      eventHead: { sequence: 1, hash: `sha256:${'e'.repeat(64)}` },
      viewHash: `sha256:${'f'.repeat(64)}`,
    });
    const projection = parseDashboardProductState(
      {
        kind: 'offline',
        binding,
        data: Object.freeze({}),
        reasonCodes: ['DASHBOARD_OFFLINE'],
        error: null,
        mutationEnabled: false,
        policy: dashboardProductStatePolicy('offline'),
      },
      { currentBinding: binding, validateData: (value) => value as Record<string, unknown> },
    );
    const { container } = render(
      <DashboardProviders
        buildId="binding-test"
        initialHash="#/overview"
        identity={{
          projectName: 'OpenPlanr',
          projectDetail: 'local',
          actorLabel: 'Actor binding pending',
          bindingLabel: 'Scope and domain pending',
        }}
        connection={{ state: 'offline', label: 'Offline', reason: 'Reconnect to continue.' }}
        binding={binding}
        projection={projection}
      >
        <UnifiedShell />
      </DashboardProviders>,
    );

    expect(container.querySelector('.pc-plane-banner')).not.toBeNull();
    expect(container.textContent).toContain('Offline');
    expect(container.querySelector('main')?.getAttribute('aria-busy')).not.toBe('true');
  });

  it('does not mistake an unbound offline workspace for normal startup', () => {
    const { container } = render(
      <DashboardProviders
        buildId="binding-test"
        initialHash="#/overview"
        connection={{ state: 'offline', label: 'Offline', reason: 'Reconnect to continue.' }}
      >
        <UnifiedShell />
      </DashboardProviders>,
    );

    expect(container.querySelector('.pc-plane-banner')).not.toBeNull();
    expect(container.querySelector('main')?.getAttribute('aria-busy')).not.toBe('true');
    expect(container.textContent).toContain('Offline — the watcher is not reachable');
  });

  it.each([
    ['loading', 'loading'],
    ['refreshing', 'refreshing'],
  ] as const)('keeps a %s Planning projection in its route frame', (kind, status) => {
    const binding = createDashboardQueryIdentity({
      productArea: 'planning',
      actorId: 'owner-bound',
      projectId: `sha256:${'1'.repeat(64)}`,
      scopeId: 'scope-bound',
      domainId: 'planning',
      domainVersion: '1.0.0',
      cycleId: null,
      route: '#/overview',
      subjectId: null,
      generation: 4,
      eventHead: { sequence: 1, hash: `sha256:${'2'.repeat(64)}` },
      viewHash: `sha256:${'3'.repeat(64)}`,
    });
    const projection = parseDashboardProductState(
      {
        kind,
        binding,
        data: kind === 'refreshing' ? {} : null,
        reasonCodes: kind === 'refreshing' ? ['DASHBOARD_REFRESHING'] : [],
        error: null,
        mutationEnabled: false,
        policy: dashboardProductStatePolicy(kind),
      },
      {
        currentBinding: binding,
        validateData: (value): value is Record<string, unknown> =>
          typeof value === 'object' && value !== null,
      },
    );
    const { container } = render(
      <DashboardProviders
        buildId="binding-test"
        initialHash="#/overview"
        connection={{ state: 'connected', label: 'Connected', reason: 'Verified.' }}
        binding={binding}
        projection={projection}
      >
        <UnifiedShell />
      </DashboardProviders>,
    );

    const pending = container.querySelector<HTMLElement>('.op-route-pending');
    expect(pending?.dataset.routePending).toBe(kind);
    expect(pending?.getAttribute('aria-busy')).toBe('true');
    expect(pending?.textContent).toContain(status);
    expect(pending?.querySelector('h1')?.textContent).toBe('Overview');
    expect(container.querySelector('.op-state-panel')).toBeNull();
    expect(container.textContent).not.toContain('Planning cannot be trusted');
  });
});
