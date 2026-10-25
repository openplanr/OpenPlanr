// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, within } from '@testing-library/react';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDashboardRoute } from '../../../../apps/dashboard/src/app/router.js';
import { parsePlanningGraphEnvelope } from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import { requestListStatus } from '../../../../apps/dashboard/src/features/planning/planning-list-filter.js';
import { usePlanningListState } from '../../../../apps/dashboard/src/features/planning/planning-list-state.js';
import { clearInspector } from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import { RouteWorkspace } from '../../../../apps/dashboard/src/features/shell/route-workspace.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

let generation = 0;

function planningList(count = 125, sequence = 0, currentGeneration = ++generation) {
  const graph = {
    nodes: [
      ...Array.from({ length: count }, (_, index) => ({
        id: `item-${String(index).padStart(3, '0')}`,
        type: 'task',
        title: `Live item ${index}${sequence > 0 && index === 0 ? ' patched' : ''}`,
        status: 'outstanding',
        frontmatter: { updated: '2026-10-01' },
      })),
      { id: 'epic', type: 'epic', title: 'Live plan', status: 'outstanding', frontmatter: {} },
    ],
    edges: [],
  };
  const binding = createDashboardQueryIdentity({
    productArea: 'planning',
    route: '#/list',
    actorId: 'list-owner',
    projectId: `sha256:${'a'.repeat(64)}`,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    cycleId: null,
    subjectId: null,
    eventHead: { sequence, hash: sequence === 0 ? null : `sha256:${'b'.repeat(64)}` },
    viewHash: sha256Jcs(graph as never),
    generation: currentGeneration,
  });
  const data = {
    kind: 'planning-graph-snapshot',
    schemaVersion: '1.0.0',
    binding: {
      actorId: binding.actorId,
      projectId: binding.projectId,
      scopeId: binding.scopeId,
      domainId: binding.domainId,
      domainVersion: binding.domainVersion,
      generation: binding.generation,
    },
    cursor: { eventHead: binding.eventHead, viewHash: binding.viewHash },
    mode: 'agile',
    graph,
  };
  const projection = (kind: 'ready' | 'refreshing' | 'loading') =>
    parseDashboardProductState(
      {
        kind,
        binding,
        data: kind === 'loading' ? null : JSON.parse(JSON.stringify(data)),
        reasonCodes: kind === 'refreshing' ? ['DASHBOARD_REFRESHING'] : [],
        error: null,
        mutationEnabled: false,
        policy: dashboardProductStatePolicy(kind),
      },
      {
        currentBinding: binding,
        validateData: (value): value is typeof data => {
          parsePlanningGraphEnvelope(value, binding);
          return true;
        },
      },
    );
  return {
    binding,
    workspace: (kind: 'ready' | 'refreshing' | 'loading' = 'ready') => (
      <RouteWorkspace
        route={parseDashboardRoute('#/list')}
        binding={binding}
        projection={projection(kind)}
        connectionState="connected"
        searchSources={{}}
        operateSearchBindings={[]}
        operateReviewNavigation={null}
        refetchCurrent={async () => projection('ready')}
      />
    ),
  };
}

function setView(container: HTMLElement) {
  const view = within(container);
  fireEvent.change(view.getByLabelText('Filter by id or title'), { target: { value: 'Live' } });
  fireEvent.change(view.getByLabelText('Filter by type'), { target: { value: 'task' } });
  fireEvent.change(view.getByLabelText('Filter by status'), { target: { value: 'outstanding' } });
  fireEvent.click(view.getByRole('switch', { name: 'Compact' }));
  fireEvent.click(view.getByRole('button', { name: 'Updated' }));
  fireEvent.click(view.getByRole('button', { name: 'Next' }));
  const row = container.querySelector('tbody tr');
  if (!row) throw new Error('List page two has no row.');
  fireEvent.click(row);
  return row.textContent;
}

function expectView(container: HTMLElement, selected: string | null) {
  const view = within(container);
  expect((view.getByLabelText('Filter by id or title') as HTMLInputElement).value).toBe('Live');
  expect((view.getByLabelText('Filter by type') as HTMLSelectElement).value).toBe('task');
  expect((view.getByLabelText('Filter by status') as HTMLSelectElement).value).toBe('outstanding');
  expect((view.getByRole('switch', { name: 'Compact' }) as HTMLInputElement).checked).toBe(true);
  expect(container.querySelector('th[aria-sort="ascending"]')?.textContent).toContain('Updated');
  expect(container.querySelector('.pc-list__page-status')?.textContent).toContain('Page 2 of 2');
  expect(container.querySelector('tr[data-selected="true"]')?.textContent).toBe(selected);
  expect(container.querySelector('[data-route-pending]')).toBeNull();
  expect(container.querySelector('.op-planning-notice')).toBeNull();
}

describe('List live view state', () => {
  afterEach(() => {
    cleanup();
    clearInspector();
  });

  it('keeps the List mounted and preserves its view through refresh and a patched cursor', () => {
    const initial = planningList();
    const subject = render(initial.workspace());
    const selected = setView(subject.container);
    const mounted = subject.container.querySelector('.pc-list');
    subject.rerender(initial.workspace('refreshing'));
    expectView(subject.container, selected);
    expect(subject.container.querySelector('.pc-list')).toBe(mounted);

    const patched = planningList(125, 1, initial.binding.generation);
    subject.rerender(patched.workspace());
    expectView(subject.container, selected);
    expect(subject.container.querySelector('.pc-list')).toBe(mounted);
  });

  it('restores the view on remount within the same binding and isolates other bindings', () => {
    const initial = planningList();
    const subject = render(initial.workspace());
    const selected = setView(subject.container);
    subject.unmount();
    const remounted = render(initial.workspace());
    expectView(remounted.container, selected);

    const other = planningList();
    remounted.rerender(other.workspace('loading'));
    expect(remounted.container.querySelector('[data-route-pending="loading"]')).not.toBeNull();
    remounted.rerender(other.workspace());
    expect(
      (within(remounted.container).getByLabelText('Filter by type') as HTMLSelectElement).value,
    ).toBe('all');
    expect(remounted.container.querySelector('.pc-list__page-status')?.textContent).toContain(
      'Page 1 of 2',
    );
    remounted.rerender(initial.workspace());
    expectView(remounted.container, selected);
  });

  it('clamps a removed page and honors a new Overview status handoff on remount', () => {
    const initial = planningList(225);
    const subject = render(initial.workspace());
    fireEvent.click(within(subject.container).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(subject.container).getByRole('button', { name: 'Next' }));
    const smaller = planningList(125, 1, initial.binding.generation);
    subject.rerender(smaller.workspace());
    expect(subject.container.querySelector('.pc-list__page-status')?.textContent).toContain(
      'Page 2 of 2',
    );
    subject.unmount();
    requestListStatus('blocked');
    const remounted = render(initial.workspace());
    expect(
      (within(remounted.container).getByLabelText('Filter by status') as HTMLSelectElement).value,
    ).toBe('blocked');
    expect(remounted.container.textContent).toContain('No node matches this filter.');
  });

  it('applies an Overview handoff before the first snapshot under StrictMode', () => {
    const initial = planningList();
    const previous = renderHook(() => usePlanningListState(initial.binding));
    act(() => previous.result.current[1]({ status: 'outstanding', page: 1 }));
    previous.unmount();
    requestListStatus('blocked');

    const snapshots: string[] = [];
    const remounted = renderHook(
      () => {
        const [state] = usePlanningListState(initial.binding);
        snapshots.push(`${state.status}:${state.page}`);
        return state;
      },
      { wrapper: StrictMode },
    );

    expect(snapshots.length).toBeGreaterThan(0);
    expect(new Set(snapshots)).toEqual(new Set(['blocked:0']));
    remounted.rerender();
    expect(remounted.result.current.status).toBe('blocked');
    expect(remounted.result.current.page).toBe(0);
  });
});
