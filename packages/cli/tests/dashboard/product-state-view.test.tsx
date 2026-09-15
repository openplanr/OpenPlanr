// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductStateView } from '../../../../apps/dashboard/src/features/diagnostics/ProductStateView.js';
import { ProjectionBoundary } from '../../../../apps/dashboard/src/features/shell/ProjectionBoundary.js';
import {
  DASHBOARD_PRODUCT_STATE_KINDS,
  type DashboardProductState,
  type DashboardProductStateKind,
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { renderDashboardComponent } from '../../../../apps/dashboard/src/test/component-harness.js';

afterEach(cleanup);

const HASH = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const binding = createDashboardQueryIdentity({
  productArea: 'operate',
  route: '#/operate/recovery',
  actorId: 'owner-dashboard',
  projectId: HASH('a'),
  scopeId: 'scope-dashboard',
  domainId: 'software-delivery',
  domainVersion: '2.0.0',
  cycleId: 'cycle-current',
  subjectId: null,
  eventHead: { sequence: 46, hash: HASH('b') },
  viewHash: HASH('c'),
  generation: 7,
});
const noCycleBinding = createDashboardQueryIdentity({
  ...binding,
  cycleId: null,
});

type ViewData = Readonly<{ marker: string; title: string }>;

const DATA_KINDS = new Set<DashboardProductStateKind>([
  'ready',
  'read-only',
  'refreshing',
  'stale',
  'degraded',
  'blocked',
  'partial',
  'uncertain',
  'recovering',
  'offline',
]);
const UNBOUND_KINDS = new Set<DashboardProductStateKind>([
  'booting',
  'unauthorized',
  'incompatible',
  'corrupt',
]);
const TITLES: Readonly<Record<DashboardProductStateKind, string>> = Object.freeze({
  booting: 'Verifying this dashboard',
  loading: 'Loading the exact projection',
  'first-use': 'Choose the first durable context',
  ready: 'Current state is ready',
  empty: 'Nothing is present in this view',
  'read-only': 'Current state is read-only',
  refreshing: 'Refreshing current state',
  stale: 'Current view is stale',
  degraded: 'Some current data is unavailable',
  blocked: 'Current work is blocked',
  unavailable: 'This view is unavailable',
  unauthorized: 'Access is not available',
  offline: 'OpenPlanr is offline',
  incompatible: 'Dashboard installation is incompatible',
  corrupt: 'Projection cannot be trusted',
  conflict: 'Current state changed',
  partial: 'Only part of the state is proven',
  uncertain: 'Effect state is uncertain',
  recovering: 'Recovery is in progress',
});

function errorFor(kind: DashboardProductStateKind) {
  const context =
    kind === 'conflict' || kind === 'uncertain'
      ? { operation: 'operate.review.submit', cycleId: binding.cycleId ?? undefined }
      : {};
  if (kind === 'unauthorized') {
    return { code: 'CAPABILITY_DENIED', retryable: false, context } as const;
  }
  if (kind === 'incompatible') {
    return { code: 'DASHBOARD_BUILD_MISMATCH', retryable: false, context } as const;
  }
  if (kind === 'corrupt') {
    return { code: 'DASHBOARD_RESPONSE_INVALID', retryable: false, context } as const;
  }
  if (kind === 'conflict') {
    return { code: 'CONCURRENT_MODIFICATION', retryable: true, context } as const;
  }
  if (kind === 'uncertain') {
    return { code: 'OPERATION_UNCERTAIN', retryable: false, context } as const;
  }
  return null;
}

function productState(
  kind: DashboardProductStateKind,
  overrides: Readonly<{
    mutationEnabled?: boolean;
    binding?: typeof binding;
  }> = {},
): DashboardProductState<ViewData> {
  const exactBinding =
    overrides.binding ?? (kind === 'first-use' || kind === 'empty' ? noCycleBinding : binding);
  const value = {
    kind,
    binding: UNBOUND_KINDS.has(kind) ? null : exactBinding,
    data: DATA_KINDS.has(kind)
      ? { marker: `validated-${kind}`, title: `Access-safe ${kind} data` }
      : null,
    reasonCodes: ['booting', 'loading', 'ready'].includes(kind)
      ? []
      : [`DASHBOARD_${kind.toUpperCase().replace('-', '_')}`],
    error: errorFor(kind),
    mutationEnabled: overrides.mutationEnabled ?? kind === 'ready',
    policy: dashboardProductStatePolicy(kind),
  };
  return parseDashboardProductState(value, {
    currentBinding: exactBinding,
    validateData: (data: unknown): data is ViewData =>
      !!data &&
      typeof data === 'object' &&
      typeof (data as ViewData).marker === 'string' &&
      typeof (data as ViewData).title === 'string',
  });
}

function view(state: DashboardProductState<ViewData>, current = state.binding ?? binding) {
  return (
    <main tabIndex={-1}>
      <h1>Recovery</h1>
      <ProductStateView state={state} currentBinding={current}>
        {(data, kind, mutationAllowed) => (
          <article data-testid="retained-data" data-presentation={kind}>
            <h2>{data.title}</h2>
            <code>{data.marker}</code>
            {mutationAllowed ? (
              <button type="button">Exact allowed action</button>
            ) : (
              <p data-mutation-disabled>Mutation remains unavailable.</p>
            )}
          </article>
        )}
      </ProductStateView>
    </main>
  );
}

describe('honest product-state and recovery presentation', () => {
  it('renders deterministic truth and recovery posture for all 19 closed tags', () => {
    for (const kind of DASHBOARD_PRODUCT_STATE_KINDS) {
      const state = productState(kind);
      const html = renderToStaticMarkup(view(state));
      expect(html, kind).toContain(`data-product-state="${kind}"`);
      if (kind === 'ready') {
        expect(html).toContain('Access-safe ready data');
        expect(html).not.toContain('Current state is ready');
        expect(html).not.toContain('data-recovery-guidance');
        continue;
      }
      expect(html, kind).toContain(TITLES[kind]);
      expect(html, kind).toContain(
        `data-recovery-guidance="${dashboardProductStatePolicy(kind).recovery}"`,
      );
      expect(html, kind).toContain('Proven');
      expect(html, kind).toContain('Not proven');
      expect(html, kind).toContain('Next safe step');
      expect(html, kind).toContain('data-product-state-mutation="disabled"');
    }
  });

  it('renders exact-current ready as the normal product view without recovery inventory', () => {
    const html = renderToStaticMarkup(view(productState('ready')));
    expect(html).toContain('data-product-state="ready"');
    expect(html).toContain('data-product-state-mutation="allowed"');
    expect(html).toContain('Access-safe ready data');
    expect(html).toContain('validated-ready');
    expect(html).not.toContain('Current state is ready');
    expect(html).not.toContain('Recovery posture');
    expect(html).not.toContain('Known, unknown, and next safe step');
    expect(html).not.toContain('data-recovery-guidance');
  });

  it('exposes mutation only for the branded exact-current ready state', () => {
    const parsedReady = productState('ready');
    const subject = render(view(parsedReady));
    expect(
      (screen.getByRole('button', { name: 'Exact allowed action' }) as HTMLButtonElement).disabled,
    ).toBe(false);

    subject.rerender(view(productState('ready', { mutationEnabled: false })));
    expect(screen.queryByRole('button', { name: 'Exact allowed action' })).toBeNull();
    expect(screen.getByText('Mutation remains unavailable.')).not.toBeNull();

    const forgedReady = { ...parsedReady };
    subject.rerender(
      <main>
        <ProjectionBoundary
          currentBinding={binding}
          state={forgedReady as DashboardProductState<ViewData>}
        >
          {(data, _kind, mutationAllowed) => (
            <button type="button" disabled={!mutationAllowed}>
              {data.marker}
            </button>
          )}
        </ProjectionBoundary>
      </main>,
    );
    expect(screen.getByText('Product state could not be validated')).not.toBeNull();
    expect(screen.queryByText('validated-ready')).toBeNull();

    const privateMarker = '/Users/owner/private-frozen-lookalike';
    const frozenReady = Object.freeze({
      ...parsedReady,
      data: Object.freeze({ marker: privateMarker, title: privateMarker }),
    }) as DashboardProductState<ViewData>;
    subject.rerender(
      <main>
        <ProjectionBoundary currentBinding={binding} state={frozenReady}>
          {(data) => <p>{data.marker}</p>}
        </ProjectionBoundary>
      </main>,
    );
    expect(screen.getByText('Product state could not be validated')).not.toBeNull();
    expect(subject.container.textContent).not.toContain(privateMarker);

    const uncertain = productState('uncertain');
    const frozenUncertain = Object.freeze({
      ...uncertain,
      data: Object.freeze({ marker: privateMarker, title: privateMarker }),
      reasonCodes: Object.freeze([privateMarker]),
      error: Object.freeze({ code: 'PRIVATE_ERROR', retryable: true, context: {} }),
    }) as unknown as DashboardProductState<ViewData>;
    subject.rerender(view(frozenUncertain));
    expect(screen.getByText('Product state could not be validated')).not.toBeNull();
    expect(subject.container.textContent).not.toContain(privateMarker);
    expect(subject.container.textContent).not.toContain('PRIVATE_ERROR');

    let hostileGets = 0;
    const hostile = new Proxy(forgedReady, {
      get() {
        hostileGets += 1;
        throw new Error('/Users/owner/private-product-state');
      },
    });
    subject.rerender(
      <main>
        <ProjectionBoundary
          currentBinding={binding}
          state={hostile as DashboardProductState<ViewData>}
        >
          {(data) => <p>{data.marker}</p>}
        </ProjectionBoundary>
      </main>,
    );
    expect(screen.getByText('Product state could not be validated')).not.toBeNull();
    expect(subject.container.textContent).not.toContain('/Users/owner/private-product-state');
    expect(hostileGets).toBe(0);
  });

  it('retains only exact same-binding offline data and hides every foreign substitution', () => {
    const offline = productState('offline');
    const subject = render(view(offline));
    expect(screen.getByText('validated-offline')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Exact allowed action' })).toBeNull();

    subject.rerender(view(offline, { ...binding, generation: 8 }));
    expect(screen.queryByText('validated-offline')).toBeNull();
    expect(screen.getByText('Projection does not match the current context')).not.toBeNull();

    const substitutions = [
      { actorId: 'foreign-actor' },
      { projectId: HASH('z') },
      { scopeId: 'foreign-scope' },
      { domainId: 'foreign-domain' },
      { domainVersion: '9.0.0' },
      { cycleId: 'foreign-cycle' },
      { eventHead: { sequence: 46, hash: HASH('z') } },
      { viewHash: HASH('z') },
    ];
    for (const substitution of substitutions) {
      subject.rerender(view(offline, { ...binding, ...substitution }));
      expect(screen.queryByText('validated-offline'), JSON.stringify(substitution)).toBeNull();
    }

    let hostileGets = 0;
    const hostileCurrent = new Proxy(binding, {
      get() {
        hostileGets += 1;
        throw new Error('/Users/owner/private-current-binding');
      },
    });
    subject.rerender(view(offline, hostileCurrent));
    expect(screen.queryByText('validated-offline')).toBeNull();
    expect(subject.container.textContent).not.toContain('/Users/owner/private-current-binding');
    expect(hostileGets).toBe(0);
  });

  it('rejects first-use and Today empty when a durable Cycle exists', () => {
    const todayBinding = createDashboardQueryIdentity({
      ...binding,
      route: '#/operate/today',
      cycleId: 'cycle-proven',
    });
    const inboxBinding = createDashboardQueryIdentity({
      ...binding,
      route: '#/operate/inbox',
      cycleId: 'cycle-proven',
    });

    const subject = render(
      view(productState('first-use', { binding: todayBinding }), todayBinding),
    );
    expect(screen.getByText('Product state contradicts durable context')).not.toBeNull();
    expect(screen.queryByText('Choose the first durable context')).toBeNull();

    subject.rerender(view(productState('empty', { binding: todayBinding }), todayBinding));
    expect(screen.getByText('Product state contradicts durable context')).not.toBeNull();
    expect(screen.queryByText('Nothing is present in this view')).toBeNull();

    subject.rerender(view(productState('empty', { binding: inboxBinding }), inboxBinding));
    expect(screen.getByText('Nothing is present in this view')).not.toBeNull();
    expect(screen.queryByText('Product state contradicts durable context')).toBeNull();
  });

  it('keeps uncertainty free of outcome and repeated-instruction claims', () => {
    const html = renderToStaticMarkup(view(productState('uncertain')));
    expect(html).toContain('Effect state is uncertain');
    expect(html).toContain('OPERATION_UNCERTAIN');
    expect(html).toContain('operate.review.submit');
    expect(html).not.toMatch(/\b(success|failure|retry)\b/iu);
    expect(html).toContain('Open Recovery');
    expect(html).not.toContain('Exact allowed action</button>');
  });

  it('renders only certified safe-error fields and canonical read-only destinations', () => {
    const conflict = productState('conflict');
    const html = renderToStaticMarkup(view(conflict));
    expect(html).toContain('CONCURRENT_MODIFICATION');
    expect(html).toContain('cycle-current');
    expect(html).toContain('operate.review.submit');
    expect(html).not.toContain('/Users/owner/private-token');
    expect(html).not.toContain('private-stack');
    expect(html).toContain('href="#/operate/recovery"');
    expect(html).not.toMatch(/on(click|submit)=/iu);
  });

  it('never invents an Operate destination for Planning-bound or unbound recovery', () => {
    const planningBinding = createDashboardQueryIdentity({
      ...binding,
      productArea: 'planning',
      route: '#/overview',
      cycleId: null,
    });
    for (const kind of ['read-only', 'stale', 'blocked'] as const) {
      const html = renderToStaticMarkup(
        view(productState(kind, { binding: planningBinding }), planningBinding),
      );
      expect(html, kind).not.toContain('href="#/operate/');
      expect(html, kind).toContain('Known, unknown, and next safe step');
    }
    const corrupt = renderToStaticMarkup(view(productState('corrupt')));
    expect(corrupt).not.toContain('href="#/operate/');
  });

  it('closes unsafe controls when mutation becomes denied and focuses the policy target', async () => {
    const onClose = vi.fn();
    const subject = render(
      <main tabIndex={-1}>
        <h1>Recovery route</h1>
        <div data-live-state-boundary>
          <details open data-live-unsafe-control>
            <summary>Unsafe confirmation</summary>
            <button type="button">Confirm</button>
          </details>
          <ProductStateView state={productState('ready')} currentBinding={binding} />
        </div>
      </main>,
    );
    const boundary = subject.container.querySelector<HTMLElement>('[data-live-state-boundary]');
    boundary?.addEventListener('openplanr-live-state-close', onClose);

    subject.rerender(
      <main tabIndex={-1}>
        <h1>Recovery route</h1>
        <div data-live-state-boundary>
          <details open data-live-unsafe-control>
            <summary>Unsafe confirmation</summary>
            <button type="button">Confirm</button>
          </details>
          <ProductStateView state={productState('conflict')} currentBinding={binding} />
        </div>
      </main>,
    );

    await waitFor(() => expect(subject.container.querySelector('details')?.open).toBe(false));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Known, unknown, and next safe step' }),
      ),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('follows route, state, and recovery focus policies without a network or axe defect', async () => {
    const ready = render(view(productState('ready')));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Recovery' })),
    );
    ready.unmount();

    const stale = render(view(productState('stale')));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Current view is stale' }),
      ),
    );
    stale.unmount();

    const harness = renderDashboardComponent(view(productState('uncertain')));
    try {
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole('heading', { name: 'Known, unknown, and next safe step' }),
        ),
      );
      const results = await harness.audit();
      expect(results.violations).toEqual([]);
      expect(harness.result.container.querySelectorAll('a')).toHaveLength(1);
      expect(harness.result.container.querySelector('a')?.getAttribute('href')).toBe(
        '#/operate/recovery',
      );
    } finally {
      harness.cleanup();
    }
  });
});
