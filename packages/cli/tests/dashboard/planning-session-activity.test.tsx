// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityPage } from '../../../../apps/dashboard/src/features/planning/ActivityPage.js';
import {
  type PlanningGraphEnvelope,
  type PlanningPatchSignal,
  parsePlanningGraphEnvelope,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import { boardSelectionItems } from '../../../../apps/dashboard/src/features/planning/planning-board-view.js';
import {
  appendPlanningSessionPatch,
  EMPTY_SESSION_ACTIVITY,
  planningActivityScope,
} from '../../../../apps/dashboard/src/features/planning/planning-session-activity.js';
import {
  clearInspector,
  useInspectorStore,
} from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import { installKeyboardCoordinator } from '../../../../apps/dashboard/src/features/shell/keyboard-coordinator.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { PlanningPresentationProvider } from '../../../../apps/dashboard/src/lib/routing/planning-presentation.js';

const task = Object.freeze({
  id: 'SPEC-001/T-001',
  type: 'task' as const,
  title: 'Session patch example',
  status: 'outstanding' as const,
  frontmatter: Object.freeze({ id: 'T-001', updated: '2026-10-19' }),
});
const spec = Object.freeze({
  id: 'SPEC-001',
  type: 'spec' as const,
  title: 'Activity example',
  status: 'in-progress' as const,
  frontmatter: Object.freeze({ id: 'SPEC-001' }),
});
const graph = Object.freeze({ nodes: Object.freeze([spec, task]), edges: Object.freeze([]) });
const binding = createDashboardQueryIdentity({
  productArea: 'planning',
  route: '#/activity',
  actorId: 'activity-owner',
  projectId: `sha256:${'a'.repeat(64)}`,
  scopeId: 'planning',
  domainId: 'planning',
  domainVersion: '1.0.0',
  generation: 1,
  cycleId: null,
  subjectId: null,
  eventHead: { sequence: 0, hash: null },
  viewHash: sha256Jcs(graph as never),
});
const scope = planningActivityScope(binding);
const envelope = parsePlanningGraphEnvelope(
  {
    kind: 'planning-graph-snapshot',
    schemaVersion: '1.0.0',
    binding: {
      actorId: binding.actorId,
      projectId: binding.projectId,
      scopeId: 'planning',
      domainId: 'planning',
      domainVersion: '1.0.0',
      generation: 1,
    },
    cursor: { eventHead: binding.eventHead, viewHash: binding.viewHash },
    mode: 'spec',
    graph,
  },
  binding,
);
const state = parseDashboardProductState(
  {
    kind: 'ready',
    binding,
    data: envelope,
    reasonCodes: [],
    error: null,
    mutationEnabled: false,
    policy: dashboardProductStatePolicy('ready'),
  },
  {
    currentBinding: binding,
    validateData: (value: unknown): value is PlanningGraphEnvelope => {
      try {
        parsePlanningGraphEnvelope(value, binding);
        return true;
      } catch {
        return false;
      }
    },
  },
);
function patch(sequence = 1): PlanningPatchSignal {
  return {
    patchId: `ppatch_${sequence}_${'a'.repeat(16)}`,
    patchHash: `sha256:${'a'.repeat(64)}`,
    from: envelope.cursor,
    to: {
      eventHead: { sequence, hash: `sha256:${'b'.repeat(64)}` },
      viewHash: envelope.cursor.viewHash,
    },
    patch: { added: [], updated: [task], removed: [], edges: { added: [], removed: [] } },
  };
}
function InspectorProbe() {
  const inspector = useInspectorStore();
  return <output>{inspector.selection?.kind === 'node' ? inspector.selection.title : ''}</output>;
}
afterEach(() => {
  cleanup();
  clearInspector();
});

describe('Phase 1 session Activity', () => {
  it('captures added, updated, removed and relationship-only patches without inventing dates', () => {
    const signal = patch();
    const result = appendPlanningSessionPatch(EMPTY_SESSION_ACTIVITY, scope, envelope, {
      ...signal,
      patch: { ...signal.patch, added: [{ ...task, id: 'SPEC-001/T-002' }], removed: [spec.id] },
    });
    expect(result.entries.map((entry) => entry.kind)).toEqual(['added', 'updated', 'removed']);
    expect(result.entries[2].node).toEqual(spec);
    expect(result.entries.every((entry) => !('date' in entry))).toBe(true);
    const edges = appendPlanningSessionPatch(result, scope, envelope, {
      ...patch(2),
      patch: { added: [], updated: [], removed: [], edges: { added: [], removed: [] } },
    });
    expect(edges.entries.at(-1)?.kind).toBe('relationships');
  });
  it('deduplicates and bounds the in-memory ledger, clearing previous custody', () => {
    let activity = appendPlanningSessionPatch(EMPTY_SESSION_ACTIVITY, scope, envelope, patch());
    expect(appendPlanningSessionPatch(activity, scope, envelope, patch())).toBe(activity);
    for (let index = 2; index <= 205; index++)
      activity = appendPlanningSessionPatch(activity, scope, envelope, patch(index));
    expect(activity.entries).toHaveLength(200);
    expect(activity.entries[0].sequence).toBe(6);
    expect(activity.truncated).toBe(true);
    const foreignScope = planningActivityScope({ ...binding, generation: 2 });
    expect(appendPlanningSessionPatch(activity, foreignScope, envelope, patch(206))).toBe(activity);
    const foreignEnvelope = { ...envelope, binding: { ...envelope.binding, generation: 2 } };
    const replaced = appendPlanningSessionPatch(
      activity,
      foreignScope,
      foreignEnvelope,
      patch(206),
    );
    expect(replaced.entries).toHaveLength(1);
    expect(replaced.scope).toBe(foreignScope);
  });
  it('shows the arrival time of a live change and no time for one replayed after a reconnect', () => {
    const arrival = new Date();
    arrival.setHours(9, 5, 0, 0);
    const live = appendPlanningSessionPatch(
      EMPTY_SESSION_ACTIVITY,
      scope,
      envelope,
      patch(),
      arrival.getTime(),
    );
    const replayed = appendPlanningSessionPatch(live, scope, envelope, patch(2), null);
    expect(replayed.entries.map((entry) => entry.receivedAt)).toEqual([arrival.getTime(), null]);
    const view = render(
      <ActivityPage currentBinding={binding} current={state} sessionActivity={replayed} />,
    );
    const times = Array.from(
      view.container.querySelectorAll('.pc-activity__feed .pc-activity__time'),
      (cell) => cell.textContent,
    );
    expect(times).toEqual(['', '09:05']);
  });
  it('lists the five newest changes first in Since you opened, so a sixth replaces the oldest', () => {
    let activity = EMPTY_SESSION_ACTIVITY;
    for (let minute = 1; minute <= 6; minute += 1) {
      const arrival = new Date();
      arrival.setHours(9, minute, 0, 0);
      activity = appendPlanningSessionPatch(
        activity,
        scope,
        envelope,
        patch(minute),
        arrival.getTime(),
      );
    }
    const view = render(
      <ActivityPage currentBinding={binding} current={state} sessionActivity={activity} />,
    );
    const times = Array.from(
      view.container.querySelectorAll('.pc-activity__live-row .pc-activity__time'),
      (cell) => cell.textContent,
    );
    expect(times).toEqual(['09:06', '09:05', '09:04', '09:03', '09:02']);
    expect(view.container.querySelector('.pc-activity__live .pc-card__meta')?.textContent).toBe(
      '6',
    );
  });
  it('reserves the Activity frame while the first verified graph is loading', () => {
    const loading = parseDashboardProductState(
      {
        kind: 'loading',
        binding,
        data: null,
        reasonCodes: [],
        error: null,
        mutationEnabled: false,
        policy: dashboardProductStatePolicy('loading'),
      },
      { currentBinding: binding },
    );
    const view = render(<ActivityPage currentBinding={binding} current={loading} />);
    expect(view.getByText('Loading Activity')).toBeTruthy();
    expect(view.container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(view.queryByText('Planning cannot be trusted')).toBeNull();
  });

  it('renders a quiet snapshot without manufacturing activity', () => {
    const html = renderToStaticMarkup(<ActivityPage currentBinding={binding} current={state} />);
    expect(html).toContain('Nothing changed in the last 14 days');
    expect(html).toContain('Changes saved to the plan appear here as they happen.');
    expect(html).toContain('This session only');
    expect(html).not.toContain('Session patch example');
  });
  it('retains accepted patches on disconnect, rejects foreign custody, and keeps removed rows inert', () => {
    const activity = appendPlanningSessionPatch(EMPTY_SESSION_ACTIVITY, scope, envelope, {
      ...patch(),
      patch: { ...patch().patch, updated: [], removed: [task.id] },
    });
    const view = render(
      <ActivityPage
        currentBinding={binding}
        current={state}
        sessionActivity={{ ...activity, connection: 'paused' }}
      />,
    );
    const session = view.getByRole('region', { name: 'Live session activity', exact: true });
    expect(session.textContent).toContain('Reconnecting');
    expect(session.textContent).toContain('changes so far are kept');
    expect(session.textContent).not.toContain('Watching');
    expect(view.getByText('Removed from the graph')).toBeTruthy();
    expect(view.container.querySelector('[data-keyboard-item]')).toBeNull();
    expect(view.container.querySelector('a[href*="detail"]')).toBeNull();
    view.rerender(
      <ActivityPage
        currentBinding={binding}
        current={state}
        sessionActivity={{ ...activity, scope: 'foreign' }}
      />,
    );
    expect(view.getByText('Changes saved to the plan appear here as they happen.')).toBeTruthy();
    expect(view.queryByText('Session patch example')).toBeNull();
  });
  it('names offline snapshot recovery and keeps stale data separate from a disconnected watcher', () => {
    const activity = appendPlanningSessionPatch(EMPTY_SESSION_ACTIVITY, scope, envelope, patch());
    const retained = (kind: 'offline' | 'stale') =>
      parseDashboardProductState(
        {
          ...state,
          kind,
          reasonCodes: [`DASHBOARD_${kind.toUpperCase()}`],
          policy: dashboardProductStatePolicy(kind),
        },
        {
          currentBinding: binding,
          validateData: (value): value is PlanningGraphEnvelope => {
            parsePlanningGraphEnvelope(value, binding);
            return true;
          },
        },
      );
    const view = render(
      <ActivityPage
        currentBinding={binding}
        current={retained('offline')}
        sessionActivity={{ ...activity, connection: 'paused' }}
      />,
    );
    expect(view.getByRole('status').textContent).toContain('Offline.');
    expect(view.getByText('Reconnecting')).toBeTruthy();
    expect(view.container.querySelectorAll('[data-keyboard-item]')).toHaveLength(1);
    view.rerender(
      <ActivityPage
        currentBinding={binding}
        current={retained('stale')}
        sessionActivity={{ ...activity, connection: 'connected' }}
      />,
    );
    expect(view.getByRole('status').textContent).toContain('This plan may be out of date.');
    expect(view.getByText('Watching')).toBeTruthy();
    expect(view.queryByText('Reconnecting')).toBeNull();
  });
  it('keeps row focus, selection, scroll and native detail links while appending patches', () => {
    const activity = appendPlanningSessionPatch(EMPTY_SESSION_ACTIVITY, scope, envelope, patch());
    const view = render(
      <>
        <ActivityPage currentBinding={binding} current={state} sessionActivity={activity} />
        <InspectorProbe />
      </>,
    );
    const row = view.container.querySelector<HTMLAnchorElement>('[data-keyboard-item]');
    if (!row) throw new Error('Expected an interactive session entry.');
    expect(row.getAttribute('href')).toBe('#/detail/SPEC-001%2FT-001');
    const region = view.getByRole('region', { name: 'Live patches from this session' });
    region.scrollTop = 84;
    row.focus();
    fireEvent.click(row);
    const next = appendPlanningSessionPatch(activity, scope, envelope, patch(2));
    view.rerender(
      <>
        <ActivityPage currentBinding={binding} current={state} sessionActivity={next} />
        <InspectorProbe />
      </>,
    );
    expect(view.container.contains(row)).toBe(true);
    expect(document.activeElement).toBe(row);
    expect(row.dataset.selected).toBe('true');
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(region.scrollTop).toBe(84);
    expect(view.getByText('Session patch example', { selector: 'output' })).toBeTruthy();
  });
  it('refreshes the inspector from the current validated snapshot without reopening it', () => {
    const activity = appendPlanningSessionPatch(EMPTY_SESSION_ACTIVITY, scope, envelope, patch());
    const view = render(
      <>
        <ActivityPage currentBinding={binding} current={state} sessionActivity={activity} />
        <InspectorProbe />
      </>,
    );
    const row = view.container.querySelector<HTMLAnchorElement>('[data-keyboard-item]');
    if (!row) throw new Error('Expected an interactive session entry.');
    fireEvent.click(row);
    const changedGraph = {
      ...graph,
      nodes: [spec, { ...task, title: 'Owner accepted new title' }],
    };
    const changedBinding = createDashboardQueryIdentity({
      ...binding,
      viewHash: sha256Jcs(changedGraph as never),
    });
    const changedEnvelope = parsePlanningGraphEnvelope(
      {
        ...envelope,
        graph: changedGraph,
        cursor: { ...envelope.cursor, viewHash: changedBinding.viewHash },
      },
      changedBinding,
    );
    const changedState = parseDashboardProductState(
      {
        kind: 'ready',
        binding: changedBinding,
        data: changedEnvelope,
        reasonCodes: [],
        error: null,
        mutationEnabled: false,
        policy: dashboardProductStatePolicy('ready'),
      },
      {
        currentBinding: changedBinding,
        validateData: (value: unknown): value is PlanningGraphEnvelope => {
          try {
            parsePlanningGraphEnvelope(value, changedBinding);
            return true;
          } catch {
            return false;
          }
        },
      },
    );
    view.rerender(
      <>
        <ActivityPage
          currentBinding={changedBinding}
          current={changedState}
          sessionActivity={activity}
        />
        <InspectorProbe />
      </>,
    );
    expect(view.getByText('Owner accepted new title', { selector: 'output' })).toBeTruthy();
  });

  it('uses the shared keyboard coordinator and preserves modified anchor clicks', async () => {
    const first = appendPlanningSessionPatch(EMPTY_SESSION_ACTIVITY, scope, envelope, patch());
    const activity = appendPlanningSessionPatch(first, scope, envelope, patch(2));
    const copy = vi.fn(async (_text: string) => undefined);
    const view = render(
      <PlanningPresentationProvider scope={scope} view={null} onCopy={copy}>
        <ActivityPage currentBinding={binding} current={state} sessionActivity={activity} />
      </PlanningPresentationProvider>,
    );
    const rows = Array.from(view.container.querySelectorAll<HTMLElement>('[data-keyboard-item]'));
    const dispose = installKeyboardCoordinator(document, () => ({
      root: view.container,
      selectionScope: scope,
      singleLetters: true,
      paletteOpen: false,
      togglePalette: () => undefined,
      openHelp: () => undefined,
      navigate: () => undefined,
      closeInspector: () => false,
      selectedId: () => null,
      copy,
      announce: () => undefined,
    }));
    try {
      rows[0].focus();
      fireEvent.keyDown(rows[0], { key: 'j' });
      expect(document.activeElement).toBe(rows[1]);
      fireEvent.keyDown(rows[1], { key: 'c' });
      await waitFor(() =>
        expect(copy).toHaveBeenCalledExactlyOnceWith(boardSelectionItems(task)[0].command),
      );
      const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
      rows[1].dispatchEvent(modified);
      expect(modified.defaultPrevented).toBe(false);
      expect(view.container.querySelector('output')).toBeNull();
    } finally {
      dispose();
    }
  });
});
