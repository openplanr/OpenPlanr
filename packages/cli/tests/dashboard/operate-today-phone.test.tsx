// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TodayLayout } from '../../../../apps/dashboard/src/features/operate/today/TodayParts.js';
import { todayViewFromLocalReview } from '../../../../apps/dashboard/src/features/operate/today/today-view.js';

const review = {
  cycleId: '2026-W43',
  href: '#/operate/cycles/2026-W43',
  updatedAt: '2026-10-25',
  decisions: [
    {
      id: 'D-031',
      title: 'Hold the next release?',
      whyNow: 'Fixes stay unreleased.',
      owner: 'Chair',
      confidence: 'Medium',
      firstStep: 'Freeze the branch.',
      expectedResult: 'One release.',
      dissent: 'Ship a patch.',
    },
  ],
  actions: [],
  gaps: [{ id: 'G-001', title: 'Linux screenshot baselines' }],
  lenses: ['CEO', 'CTO', 'CPO', 'CMO', 'COO', 'Chair', 'Challenger'].map((name) => ({
    name,
    present: name !== 'CMO',
    signal: 'action',
  })),
  evidence: [{ id: 'E1', reference: 'docs/release.md', freshness: 'today' }],
};

/** Stubs the phone media query and returns a setter that fires its change event. */
function stubPhone(initial: boolean) {
  let phone = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 599px)' && phone,
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  }));
  return (next: boolean) => {
    phone = next;
    act(() => {
      for (const listener of listeners) listener();
    });
  };
}

function controlled(button: HTMLElement) {
  const id = button.getAttribute('aria-controls');
  const list = id ? document.getElementById(id) : null;
  if (!list) throw new Error(`No list controlled by ${button.textContent}`);
  return list;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Operate Today on a phone', () => {
  it('opens Executive seats and Evidence in place from their disclosure rows', () => {
    stubPhone(true);
    render(<TodayLayout view={todayViewFromLocalReview(review)} places={false} />);
    const seats = screen.getByRole('button', { name: 'Executive seats 6/7' });
    const evidence = screen.getByRole('button', { name: 'Evidence 1 not proven' });
    for (const button of [seats, evidence]) {
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(controlled(button).hidden).toBe(true);
    }
    fireEvent.click(seats);
    expect(seats.getAttribute('aria-expanded')).toBe('true');
    expect(controlled(seats).hidden).toBe(false);
    expect(controlled(seats).querySelectorAll('li')).toHaveLength(7);
    expect(controlled(evidence).hidden).toBe(true);
    fireEvent.click(seats);
    expect(controlled(seats).hidden).toBe(true);
  });

  it('counts evidence by what is not proven, then by what is verified', () => {
    stubPhone(true);
    render(<TodayLayout view={todayViewFromLocalReview({ ...review, gaps: [] })} places={false} />);
    expect(screen.getByRole('button', { name: 'Evidence 1 verified' })).toBeTruthy();
  });

  it('drops the eyebrow date and uses the drawn short tile labels on a phone only', () => {
    const resize = stubPhone(true);
    render(<TodayLayout view={todayViewFromLocalReview(review)} places={false} />);
    const labels = () =>
      [...document.querySelectorAll('.pc-operate-today__tile dt')].map((dt) => dt.textContent);
    const eyebrow = () => document.querySelector('.pc-operate-today__eyebrow')?.textContent;
    expect(labels()).toEqual(['Confidence', 'Gaps', 'Dissent']);
    expect(eyebrow()).toBe('cycle 2026-W43');
    resize(false);
    expect(labels()).toEqual(['Confidence', 'Evidence gaps', 'Dissent kept']);
    expect(eyebrow()).toBe('Sun, 25 Oct · cycle 2026-W43');
  });

  it('shows every list with a plain heading once the width grows past a phone', () => {
    const resize = stubPhone(true);
    render(<TodayLayout view={todayViewFromLocalReview(review)} places={false} />);
    resize(false);
    expect(screen.queryByRole('button', { name: /Executive seats/u })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Executive seats' })).toBeTruthy();
    for (const list of document.querySelectorAll<HTMLElement>('.pc-operate-today__side ul'))
      expect(list.hidden).toBe(false);
  });
});
