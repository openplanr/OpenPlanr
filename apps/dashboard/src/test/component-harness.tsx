import type { DashboardProduct } from '@dashboard/app/router.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RenderResult, render } from '@testing-library/react';
import { type UserEvent, userEvent } from '@testing-library/user-event';
import axe, { type AxeResults, type RunOptions } from 'axe-core';
import { type ReactElement, type ReactNode, StrictMode } from 'react';
import { createMemoryRouter, type RouteObject, RouterProvider } from 'react-router';

const HARNESS_DEFAULT_PRODUCT: DashboardProduct = 'planning';

export type DashboardHarnessOptions = Readonly<{
  initialEntries?: readonly string[];
  routes?: readonly RouteObject[];
  queryClient?: QueryClient;
}>;

export type RenderedDashboardComponent = Readonly<{
  result: RenderResult;
  user: UserEvent;
  queryClient: QueryClient;
  audit(options?: RunOptions): Promise<AxeResults>;
  cleanup(): void;
}>;

const NETWORK_DISABLED_MESSAGE =
  'Dashboard component harness network is disabled; inject deterministic query data.';

const DEFAULT_ROUTES: readonly RouteObject[] = [
  {
    path: '*',
    element: <div data-dashboard-harness-route={HARNESS_DEFAULT_PRODUCT} />,
  },
];

/**
 * Strict, deterministic composition for component accessibility tests.
 * It owns only ephemeral test state and never retries, persists, or reaches a network.
 */
export function createDashboardComponentHarness(
  subject: ReactElement,
  options: DashboardHarnessOptions = {},
): ReactElement {
  const queryClient =
    options.queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
        mutations: { retry: false },
      },
    });
  const routes = (options.routes ?? DEFAULT_ROUTES).map((route, index) =>
    index === 0 ? { ...route, element: subject } : route,
  );
  const router = createMemoryRouter(routes, {
    initialEntries: [...(options.initialEntries ?? ['/'])],
  });

  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>
  );
}

export function DashboardTestSurface({ children }: { children: ReactNode }) {
  return (
    <main aria-label="Dashboard component test surface" data-dashboard-component-harness="true">
      {children}
    </main>
  );
}

export function renderDashboardComponent(
  subject: ReactElement,
  options: DashboardHarnessOptions = {},
): RenderedDashboardComponent {
  const originalFetch = globalThis.fetch;
  const blockedFetch: typeof fetch = async () => {
    throw new Error(NETWORK_DISABLED_MESSAGE);
  };
  globalThis.fetch = blockedFetch;
  const queryClient =
    options.queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
        mutations: { retry: false },
      },
    });
  let result: RenderResult;
  try {
    result = render(createDashboardComponentHarness(subject, { ...options, queryClient }));
  } catch (error) {
    globalThis.fetch = originalFetch;
    queryClient.clear();
    throw error;
  }
  const user = userEvent.setup();
  return Object.freeze({
    result,
    user,
    queryClient,
    audit: async (auditOptions?: RunOptions) =>
      await axe.run(
        result.container,
        auditOptions ?? {
          // jsdom has no layout/canvas; contrast remains a real-browser gate.
          rules: { 'color-contrast': { enabled: false } },
        },
      ),
    cleanup: () => {
      result.unmount();
      queryClient.clear();
      if (globalThis.fetch === blockedFetch) globalThis.fetch = originalFetch;
    },
  });
}
