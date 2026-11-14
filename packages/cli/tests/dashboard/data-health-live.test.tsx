// @vitest-environment jsdom

import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import { DataHealth } from '../../../../apps/dashboard/src/features/diagnostics/DataHealth.js';
import { useDataHealth } from '../../../../apps/dashboard/src/features/diagnostics/use-data-health.js';
import { parsePlanningGraphEnvelope } from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import type { PlanningWorkspaceModel } from '../../../../apps/dashboard/src/features/planning/planning-workspace.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';
import type { DashboardBootstrap } from '../../../../apps/dashboard/src/lib/api/bootstrap.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

const hash = `sha256:${'a'.repeat(64)}`;
function workspace(generation = 1, revision = 0): PlanningWorkspaceModel {
  const graph = { nodes: [], edges: [] };
  const cursor = {
    eventHead: { sequence: revision, hash: revision ? hash : null },
    viewHash: sha256Jcs(graph),
  };
  const binding = {
    actorId: 'health-reader',
    projectId: hash,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    generation,
  };
  const identity = createDashboardQueryIdentity({
    ...binding,
    productArea: 'planning',
    route: '#/home',
    cycleId: null,
    subjectId: null,
    eventHead: cursor.eventHead,
    viewHash: cursor.viewHash,
  });
  const envelope = parsePlanningGraphEnvelope(
    {
      kind: 'planning-graph-snapshot',
      schemaVersion: '1.0.0',
      binding,
      cursor,
      mode: 'empty',
      graph,
    },
    identity,
  );
  return {
    envelope,
    binding: identity,
    graph,
    presentation: 'ready',
    readOnly: true,
    mutationEnabled: false,
  };
}
function response(
  model: PlanningWorkspaceModel,
  options: { empty?: boolean; error?: boolean; truncated?: boolean } = {},
) {
  return new Response(
    JSON.stringify({
      kind: 'planning-diagnostics',
      schemaVersion: '1.0.0',
      binding: model.envelope.binding,
      cursor: model.envelope.cursor,
      sourceViewHash: model.envelope.cursor.viewHash,
      state: options.error ? 'error' : 'available',
      reason: options.error
        ? 'The source could not be read.'
        : options.truncated
          ? 'The response is capped.'
          : null,
      errorCode: options.error ? 'EACCES' : null,
      diagnostics:
        options.empty || options.error
          ? []
          : [
              {
                nodeId: 'SPRINT-002',
                sourcePath: '.planr/sprints/SPRINT-002.md',
                field: 'closedAt',
                reason: 'closed-before-start',
                classification: 'source-data',
              },
            ],
      totalCount: options.error ? null : options.truncated ? 700 : options.empty ? 0 : 1,
      truncated: options.truncated ?? false,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}
function Harness({ model }: { model: PlanningWorkspaceModel }) {
  const health = useDataHealth(model, 'http://127.0.0.1:7473', true);
  return <DataHealth {...health} />;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('loads, filters, retains findings through patches and errors, retries, and renders verified empty reads', async () => {
  const user = userEvent.setup();
  const first = workspace();
  const next = workspace(1, 1);
  let complete: ((value: Response) => void) | undefined;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValueOnce(response(next, { error: true }))
    .mockResolvedValueOnce(response(next, { empty: true }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<Harness model={first} />);
  expect(screen.getByRole('status', { name: 'Reading source diagnostics' })).not.toBeNull();
  expect(screen.queryByText('No source findings reported')).toBeNull();
  await act(async () => {
    complete?.(response(first));
  });
  const item = await screen.findByRole('link', { name: 'SPRINT-002' });
  await user.type(screen.getByRole('textbox', { name: 'Filter data health' }), 'closed');
  item.focus();
  const content = view.container.querySelector('.op-diagnostics__health-content');
  if (!content) throw new Error('Missing content');
  content.scrollTop = 90;
  view.rerender(<Harness model={next} />);
  await screen.findByText(/EACCES/);
  expect(screen.getByText(/Showing the last verified/)).not.toBeNull();
  expect(document.activeElement).toBe(item);
  expect(content.scrollTop).toBe(90);
  expect(
    (screen.getByRole('textbox', { name: 'Filter data health' }) as HTMLInputElement).value,
  ).toBe('closed');
  expect(screen.getByRole('link', { name: 'SPRINT-002' })).toBe(item);
  await user.click(screen.getByRole('button', { name: 'Retry diagnostics' }));
  await screen.findByText('No source findings reported');
  expect(screen.queryByRole('link', { name: 'SPRINT-002' })).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('discards obsolete responses and clears retained findings after a binding change', async () => {
  const first = workspace();
  const next = workspace(2);
  let obsolete: ((value: Response) => void) | undefined;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(first))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          obsolete = resolve;
        }),
    )
    .mockResolvedValueOnce(response(next, { empty: true }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<Harness model={first} />);
  await screen.findByRole('link', { name: 'SPRINT-002' });
  view.rerender(<Harness model={workspace(1, 1)} />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  view.rerender(<Harness model={next} />);
  expect(screen.queryByRole('link', { name: 'SPRINT-002' })).toBeNull();
  await screen.findByText('No source findings reported');
  await act(async () => {
    obsolete?.(response(workspace(1, 1)));
  });
  expect(screen.queryByRole('link', { name: 'SPRINT-002' })).toBeNull();
});

it('surfaces safe first-read errors and discloses truncated totals', async () => {
  const user = userEvent.setup();
  const model = workspace();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(response(model, { error: true }))
      .mockResolvedValueOnce(response(model, { truncated: true })),
  );
  render(<Harness model={model} />);
  await screen.findByText('Source diagnostics could not be read');
  expect(screen.getByText(/EACCES/)).not.toBeNull();
  expect(screen.queryByText('No source findings reported')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Retry diagnostics' }));
  await screen.findByText(/showing 1 of 700 reported findings. Results are truncated/);
});

it('connects the Diagnostics tab to the retained Planning projection through the real shell', async () => {
  const user = userEvent.setup();
  const model = workspace();
  const fetcher = vi.fn().mockResolvedValue(response(model));
  vi.stubGlobal('fetch', fetcher);
  const bootstrap: DashboardBootstrap = {
    kind: 'dashboard-bootstrap',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    ui: { buildId: 'health-test', expectedBuildId: 'health-test', assetManifestHash: hash },
    server: { packageVersion: '1.0.0' },
    capabilities: {
      planningGraph: { schemaVersion: '1.0.0' },
      operateExperience: { protocolVersion: '2.0.0', schemaVersion: '1.0.0' },
      operateCommands: { protocolVersion: '2.0.0', transportVersion: '1.0.0', available: false },
      diagnostics: { schemaVersion: '1.0.0', available: true },
    },
    project: { projectId: hash, name: 'health', branch: 'main', products: ['planning', 'operate'] },
    queryRoots: { planning: model.envelope.binding, operate: null },
    origin: 'http://127.0.0.1:7473',
    compatibility: { status: 'compatible', reasonCodes: [] },
  };
  const projection = parseDashboardProductState(
    {
      kind: 'read-only',
      binding: model.binding,
      data: model.envelope,
      reasonCodes: ['DASHBOARD_READ_ONLY'],
      error: null,
      mutationEnabled: false,
      policy: dashboardProductStatePolicy('read-only'),
    },
    {
      currentBinding: model.binding,
      validateData: (value) => Boolean(parsePlanningGraphEnvelope(value, model.binding)),
    },
  );
  render(
    <DashboardProviders
      buildId="health-test"
      initialHash="#/diagnostics"
      bootstrap={bootstrap}
      bootPhase="compatible"
      planningProjection={projection}
      connection={{ state: 'connected', label: 'Connected', reason: 'Current graph' }}
    >
      <UnifiedShell />
    </DashboardProviders>,
  );
  expect(fetcher).not.toHaveBeenCalled();
  await user.click(screen.getByRole('tab', { name: 'Data health', exact: true }));
  await screen.findByRole('link', { name: 'SPRINT-002' });
  expect(fetcher).toHaveBeenCalledOnce();
});
