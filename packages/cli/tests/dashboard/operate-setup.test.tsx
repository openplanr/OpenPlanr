// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalOperateReviews } from '../../../../apps/dashboard/src/features/operate/local-reviews/LocalOperateReviews.js';
import { OperateSetup } from '../../../../apps/dashboard/src/features/operate/OperateSetup.js';

const route = { kind: 'operate.today', product: 'operate', subjectId: null } as const;
const emptyIndex = {
  kind: 'local-operate-review-index',
  schemaVersion: '1.0.0',
  readOnly: true,
  pagination: { page: 1, pageSize: 12, pageCount: 1, total: 0 },
  items: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Completed local operating reviews', () => {
  const completedCycle = {
    cycleId: 'completed-cycle',
    title: 'Completed operating review',
    summary: 'A completed review for the current project.',
    signal: 'review',
    updatedAt: '2026-10-19T00:00:00Z',
    counts: { decisions: 0, actions: 0, gaps: 0, issues: 0 },
    href: '#/operate/cycles/completed-cycle',
    scope: { subject: 'Project', window: 'Current', requestedDecision: 'Review', custody: 'Local' },
    decisions: [],
    actions: [],
    gaps: [],
    risks: [],
    issues: [],
    lenses: [],
    evidence: [],
    recovery: {
      complete: true,
      presentFiles: [],
      missingFiles: [],
      totalBytes: 0,
      custody: 'Local',
    },
    markdown: '# Completed operating review',
  };

  it.each(['operate.cycle', 'operate.today'] as const)(
    'keeps the governed-actions section specific to completed cycle detail on %s',
    async (kind) => {
      const fetch = vi.fn(
        async (url: URL, _options?: RequestInit) =>
          new Response(
            JSON.stringify(
              url.pathname.endsWith('/completed-cycle')
                ? {
                    kind: 'local-operate-review',
                    schemaVersion: '1.0.0',
                    readOnly: true,
                    item: completedCycle,
                  }
                : {
                    ...emptyIndex,
                    items: [completedCycle],
                    pagination: { ...emptyIndex.pagination, total: 1 },
                  },
            ),
          ),
      );
      vi.stubGlobal('fetch', fetch);
      const { container } = render(
        <LocalOperateReviews
          route={
            kind === 'operate.cycle'
              ? { kind, product: 'operate', subjectId: completedCycle.cycleId }
              : route
          }
          origin="http://localhost"
        />,
      );
      await screen.findByRole('heading', { name: 'Review the latest operating cycle' });
      const workspace = container.querySelector<HTMLElement>(`[data-route-kind="${kind}"]`);
      if (!workspace) throw new Error(`Missing workspace for ${kind}`);
      const view = within(workspace);
      if (kind === 'operate.cycle') {
        expect(view.getByRole('heading', { name: 'Governed actions' })).toBeTruthy();
        expect(view.getByText('This local cycle is a read-only review record.')).toBeTruthy();
        expect(
          view.getByText('Approval and execution require an actor-bound Operate session'),
        ).toBeTruthy();
      } else {
        expect(view.queryByText('Governed actions')).toBeNull();
      }
      expect(view.queryByRole('button', { name: /approve|execute/i })).toBeNull();
      expect(
        fetch.mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
      ).toBe(true);
    },
  );
});

describe('Operate first-run presentation', () => {
  it('offers only the exact supplemental command after a verified empty read', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(emptyIndex)));
    vi.stubGlobal('fetch', fetch);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = render(<LocalOperateReviews route={route} origin="http://localhost" />);
    expect(
      await screen.findByRole('heading', { name: 'Operate is not set up here yet' }),
    ).toBeTruthy();
    expect(screen.getByText('Proposed')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Operate today' })).toBeNull();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Operate is not set up here yet' }),
    ).toBeTruthy();
    expect(screen.queryByText('Governed actions')).toBeNull();
    expect(container.querySelector('.pc-shell__scroll > .pc-local-review.pc-operate')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith('/planr:operate'));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(
      fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET'),
    ).toBe(true);
    const example = within(
      screen.getByRole('region', { name: /How Today reads once a cycle exists/ }),
    );
    expect(example.getByText('Example cycle')).toBeTruthy();
    expect(example.getByText('Focus item')).toBeTruthy();
    expect(example.getByText('Cycle [ID] · Chair synthesis')).toBeTruthy();
    expect(
      example.getByRole('heading', { name: '[The one decision this cycle asks for]' }),
    ).toBeTruthy();
    expect(example.getByText('Confidence in this cycle')).toBeTruthy();
    expect(example.getByText('[level]')).toBeTruthy();
    expect(example.getAllByText('[n]')).toHaveLength(5);
    expect(example.getByRole('heading', { name: 'Executive seats' })).toBeTruthy();
    for (const role of ['CEO', 'CTO', 'CPO', 'CMO', 'COO', 'CHAIR', 'CHALLENGER']) {
      expect(example.getByText(role)).toBeTruthy();
    }
    expect(example.getByRole('heading', { name: 'Evidence desk' })).toBeTruthy();
    expect(example.getByRole('heading', { name: 'Inbox' })).toBeTruthy();
    expect(example.getByRole('heading', { name: 'Planning handoff' })).toBeTruthy();
    expect(example.queryByRole('button')).toBeNull();
    expect(example.queryByRole('link')).toBeNull();
  });

  it('surfaces clipboard denial and keeps the exact command selectable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
    });
    render(<OperateSetup />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    expect(await screen.findByText('Copy was blocked')).toBeTruthy();
    expect(screen.getByText('Select the command and copy it manually.')).toBeTruthy();
    expect(screen.getAllByText('/planr:operate').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
  });

  it('shows a read failure without claiming that no operating cycle exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Local review read failed')));
    render(<LocalOperateReviews route={route} origin="http://localhost" />);
    expect(await screen.findByText('Local review read failed')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Operate today' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Operate is not set up here yet' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy command' })).toBeNull();
    expect(screen.queryByText('Example cycle')).toBeNull();
  });
});
