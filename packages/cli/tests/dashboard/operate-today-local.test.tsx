// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalOperateReviews } from '../../../../apps/dashboard/src/features/operate/local-reviews/LocalOperateReviews.js';
import {
  dayLabel,
  todayViewFromLocalReview,
} from '../../../../apps/dashboard/src/features/operate/today/today-view.js';

const decision = {
  id: 'D1',
  priority: 'P0',
  title: 'Verify the CRM flow',
  recommendation: 'Run the smoke test before engineering work.',
  whyNow: 'A dated event depends on the flow and failures are silent.',
  owner: 'Asem',
  confidence: 'High',
  firstStep: 'Run the CRM smoke test and record the result.',
  expectedResult: 'The test row reaches created.',
  check: 'Inspect the admin row.',
  dependencies: 'none',
  revisitWhen: '',
  sources: '',
  dissent: 'Verify before dispatching engineering.',
};
const review = {
  cycleId: '2026-09-14-modul-events',
  title: 'Operating board report — Modul events',
  summary: 'Act now on the verified release path.',
  signal: 'act now',
  updatedAt: '2026-09-14T12:00:00.000Z',
  counts: { decisions: 1, actions: 1, gaps: 1, issues: 0 },
  href: '#/operate/cycles/2026-09-14-modul-events',
  scope: { subject: 'Modul', window: 'Current', requestedDecision: 'Review', custody: 'Local' },
  decisions: [decision],
  actions: [
    {
      id: 'A1',
      priority: 'P0',
      action: 'Run the CRM smoke test',
      owner: 'Asem',
      firstStep: 'Submit one test registration',
      successMeasure: 'Row reaches created',
      check: 'Inspect the admin row',
      dependencies: 'D1',
      state: 'proposed',
    },
  ],
  gaps: [{ id: 'G1', title: 'Live flow state', detail: 'Unknown until the smoke test.' }],
  risks: [],
  issues: [],
  lenses: ['CEO', 'CTO', 'CPO', 'CMO', 'COO', 'Challenger', 'Chair'].map((name) => ({
    name,
    filename: `${name.toLowerCase()}.md`,
    present: name !== 'CMO',
    outcome: 'reported',
    signal: name === 'Challenger' ? 'holds with exceptions' : 'action',
    informed: 'D1',
    findings: 1,
    recommendation: '',
  })),
  evidence: [
    { id: 'E1', reference: 'docs/crm.md:12', kind: 'source', freshness: 'captured in cycle' },
  ],
  recovery: { complete: true, presentFiles: [], missingFiles: [], totalBytes: 0, custody: 'Local' },
  markdown: '# Operating board report',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Operate Today from a local review', () => {
  it('labels a date without a time by its calendar day in every time zone', () => {
    const zone = process.env.TZ;
    try {
      for (const tz of ['Pacific/Honolulu', 'UTC', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        expect(dayLabel('2026-10-25')).toBe('Sun, 25 Oct');
      }
      process.env.TZ = 'UTC';
      expect(dayLabel('2026-10-25T09:00:00.000Z')).toBe('Sun, 25 Oct');
      expect(dayLabel('not a date')).toBeNull();
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it('leaves out the placeholders the review reader writes for missing fields', () => {
    const view = todayViewFromLocalReview({
      ...review,
      decisions: [
        {
          ...decision,
          owner: 'Unassigned',
          confidence: 'Not recorded',
          firstStep: ' None ',
          dissent: '',
        },
      ],
      actions: [{ ...review.actions[0], owner: 'none' }],
    });
    expect(view.decision?.owner).toBeNull();
    expect(view.decision?.tiles.map((tile) => tile.label)).toEqual([
      'Evidence gaps',
      'Dissent kept',
    ]);
    expect(view.decision?.facts.map((fact) => fact.label)).toEqual([
      'Expected result',
      'If we wait',
    ]);
    expect(view.rows.find((row) => row.id === 'A1')?.owner).toBeNull();
  });

  it('carries the nothing-waiting state in the headline and keeps the no-decision title otherwise', () => {
    const empty = todayViewFromLocalReview({ ...review, decisions: [], actions: [], gaps: [] });
    expect(empty.title).toBe('Nothing needs you today');
    expect(empty.summary).toBe(
      'Cycle 2026-09-14-modul-events closed on 14 Sep with no decisions recorded.',
    );
    expect(empty.decision).toBeNull();
    expect(empty.rows).toEqual([]);
    expect(todayViewFromLocalReview({ ...review, decisions: [] }).title).toBe(
      'No decision is waiting',
    );
  });

  it('shows which cycle could not be read, and nothing from it, when its detail read fails', async () => {
    const fetch = vi.fn(async (url: URL, _options?: RequestInit) =>
      url.pathname.endsWith(review.cycleId)
        ? new Response('{}', { status: 500 })
        : new Response(
            JSON.stringify({
              kind: 'local-operate-review-index',
              schemaVersion: '1.0.0',
              readOnly: true,
              pagination: { page: 1, pageSize: 12, pageCount: 1, total: 1 },
              items: [review],
            }),
          ),
    );
    vi.stubGlobal('fetch', fetch);
    const { container } = render(
      <LocalOperateReviews
        route={{ kind: 'operate.today', product: 'operate', subjectId: null }}
        origin="http://localhost"
      />,
    );
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Cycle 2026-09-14-modul-events could not be read',
      }),
    ).toBeTruthy();
    expect(screen.getByText('OpenPlanr could not read this report (500).')).toBeTruthy();
    expect(
      container.querySelector('.pc-operate-today__decision, .pc-operate-today__rows'),
    ).toBeNull();
    expect(screen.queryByText('planr-operate · local')).toBeNull();
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
  });

  it('shows the latest review with its cycle, decision, actions, gaps and seats', async () => {
    const fetch = vi.fn(
      async (url: URL, _options?: RequestInit) =>
        new Response(
          JSON.stringify(
            url.pathname.endsWith(review.cycleId)
              ? {
                  kind: 'local-operate-review',
                  schemaVersion: '1.0.0',
                  readOnly: true,
                  item: review,
                }
              : {
                  kind: 'local-operate-review-index',
                  schemaVersion: '1.0.0',
                  readOnly: true,
                  pagination: { page: 1, pageSize: 12, pageCount: 1, total: 1 },
                  items: [review],
                },
          ),
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const { container } = render(
      <LocalOperateReviews
        route={{ kind: 'operate.today', product: 'operate', subjectId: null }}
        origin="http://localhost"
      />,
    );
    await screen.findByRole('heading', { level: 1, name: 'One decision needs you' });
    const today = within(container.querySelector<HTMLElement>('.pc-operate-today') ?? container);
    const cycle = today.getByRole('link', { name: 'cycle 2026-09-14-modul-events' });
    expect(cycle.getAttribute('href')).toBe('#/operate/cycles/2026-09-14-modul-events');
    expect(today.getByRole('heading', { level: 2, name: 'Verify the CRM flow' })).toBeTruthy();
    expect(
      today.getByText('6 of 7 seats reported. 1 action and 1 open question are waiting.'),
    ).toBeTruthy();
    const gaps = today.getByText('Evidence gaps').closest('div');
    expect(gaps?.textContent).toBe('Evidence gaps1');
    expect(today.getByRole('link', { name: /Run the CRM smoke test/u })).toBeTruthy();
    expect(today.queryByText(/Depends on|\bnone\b/u)).toBeNull();
    const seats = today.getByRole('region', { name: 'Executive seats' });
    expect(seats.querySelectorAll('li')).toHaveLength(7);
    expect(seats.querySelector('[data-state="dissent"]')?.textContent).toContain('Challenger');
    expect(seats.querySelector('[data-state="waiting"]')?.textContent).toContain('CMO');
    expect(container.querySelector('.pc-local-review__footnote')).toBeNull();
    expect(screen.queryByText('planr-operate · local')).toBeNull();

    fireEvent.focus(today.getByRole('link', { name: /Run the CRM smoke test/u }));
    const bar = screen.getByRole('region', { name: 'Selected items' });
    expect(within(bar).getByRole('button', { name: /Copy ID and title/u })).toBeTruthy();
    expect(within(bar).queryByRole('button', { name: 'Open' })).toBeNull();
    expect(bar.querySelector('code')).toBeNull();
    expect(
      fetch.mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
    ).toBe(true);
  });
});
