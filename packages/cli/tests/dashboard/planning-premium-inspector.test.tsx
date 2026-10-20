// @vitest-environment jsdom

import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import {
  type PlanningGraphEnvelope,
  parsePlanningGraphEnvelope,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import { clearInspector } from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import {
  buildPremiumDashboardFixture,
  fixtureSnapshot,
} from './fixtures/premium-dashboard-fixtures.js';

const adapters = {
  loadSingleLetters: () => true,
  saveSingleLetters: () => {},
  railPreference: { initialCompact: false, save: () => {} },
};

let fixtureSequence = 0;

function fixture(dataset: 'representative' | 'artboard') {
  fixtureSequence += 1;
  const source = buildPremiumDashboardFixture(dataset);
  const snapshot = fixtureSnapshot(source.graph, {
    actorId: `premium-inspector-${dataset}-${fixtureSequence}`,
    projectId: `sha256:${'c'.repeat(64)}`,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    generation: 6,
  });
  const binding = createDashboardQueryIdentity({
    ...snapshot.binding,
    productArea: 'planning',
    route: '#/list',
    subjectId: null,
    cycleId: null,
    eventHead: snapshot.cursor.eventHead,
    viewHash: snapshot.cursor.viewHash,
  });
  const envelope = parsePlanningGraphEnvelope(snapshot, binding);
  const projection = parseDashboardProductState<PlanningGraphEnvelope>(
    {
      kind: 'ready' as const,
      binding,
      data: envelope,
      reasonCodes: [],
      error: null,
      mutationEnabled: false,
      policy: dashboardProductStatePolicy('ready'),
    },
    {
      currentBinding: binding,
      validateData: (value): value is PlanningGraphEnvelope => {
        parsePlanningGraphEnvelope(value, binding);
        return true;
      },
    },
  );
  return { ...source, snapshot, binding, projection };
}

function detail(snapshot: PlanningGraphEnvelope, id: string) {
  const summary = snapshot.graph.nodes.find((node) => node.id === id);
  if (!summary) throw new Error('Missing premium inspector artifact');
  const node = {
    ...summary,
    body: '## Acceptance Criteria\n- AC-proof: Verify the selected artifact\n',
  };
  return {
    kind: 'planning-detail',
    schemaVersion: '1.0.0',
    binding: snapshot.binding,
    cursor: snapshot.cursor,
    subjectId: id,
    node,
    nodeHash: sha256Jcs(node as never),
  };
}

afterEach(() => {
  cleanup();
  clearInspector();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('premium inspector repeated selection', () => {
  it.each([
    ['representative', 1440],
    ['artboard', 1440],
    ['representative', 390],
    ['artboard', 390],
  ] as const)('reopens verified %s inspector twenty times at %ipx', async (dataset, width) => {
    vi.stubGlobal('innerWidth', width);
    window.history.replaceState(null, '', '#/list');
    const current = fixture(dataset);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const id = decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1) ?? '');
      return new Response(JSON.stringify(detail(current.snapshot, id)), {
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const rendered = render(
      <DashboardProviders
        buildId="premium-inspector"
        initialHash="#/list"
        binding={current.binding}
        projection={current.projection}
        planningProjection={current.projection}
        bootPhase="compatible"
        planningLive={{ state: 'connected', attempt: 0 }}
        connection={{ state: 'connected', label: 'Connected', reason: 'Verified premium fixture' }}
      >
        <UnifiedShell adapters={adapters} />
      </DashboardProviders>,
    );
    expect(screen.queryByRole('dialog', { name: 'Inspector', exact: true })).toBeNull();
    expect(rendered.container.querySelector('.pc-shell-inspector')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter by id or title' }), {
      target: { value: current.manifest.selectedId },
    });
    const rows = rendered.container.querySelectorAll<HTMLElement>('.pc-list tbody tr[tabindex]');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    const expectedTitle = row.querySelector('.pc-list__title')?.textContent;
    expect(expectedTitle).toBeTruthy();
    // The performance probe's old selector now falls back to an empty expected title.
    expect(row.querySelector('.pc-work-item__title')).toBeNull();
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const existing = screen.queryByRole('dialog', {
        name: 'Inspector',
      });
      if (existing) {
        fireEvent.click(
          within(existing).getByRole('button', {
            name: 'Close inspector',
            exact: true,
          }),
        );
      }
      expect(screen.queryByRole('dialog', { name: 'Inspector', exact: true })).toBeNull();
      await act(async () => row.click());
      const panel = screen.getByRole('dialog', {
        name: 'Inspector',
      });
      await within(panel).findByText('Detail verified against the current planning snapshot.');
      expect(
        within(panel).getByRole('heading', { name: expectedTitle ?? '', exact: true }),
      ).toBeTruthy();
      const promote = within(panel).getByRole('button', {
        name: 'Open full page',
        exact: true,
      }) as HTMLButtonElement;
      expect(promote.disabled).toBe(dataset === 'representative');
      if (dataset === 'representative') {
        expect(
          within(panel).getByText('A full-page route is unavailable for this artifact identity.'),
        ).toBeTruthy();
      }
      expect(row.dataset.selected).toBe('true');
      expect(row.isConnected).toBe(true);
      expect(panel.classList.contains('pc-inspector-sheet')).toBe(true);
      expect(panel.getAttribute('aria-modal')).toBe(width < 900 ? 'true' : null);
      expect(rendered.container.contains(panel)).toBe(false);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
