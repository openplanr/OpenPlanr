// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityFilterRow } from '../../../../apps/dashboard/src/features/planning/ActivityFilters.js';
import type { ActivityFilters } from '../../../../apps/dashboard/src/features/planning/planning-activity-view.js';

const counts = { all: 12, created: 4, status: 1, edited: 6, removed: 1 };

function stubWidth(phone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(max-width: 1199px)' || (phone && query === '(max-width: 599px)'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function renderRow(filters: Partial<ActivityFilters> = {}) {
  const onChange = vi.fn();
  render(
    <ActivityFilterRow
      filters={{ kind: 'all', spec: null, types: [], days: 14, ...filters }}
      counts={counts}
      specs={['SPEC-1', 'SPEC-2']}
      panelId="feed"
      onChange={onChange}
    />,
  );
  return onChange;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Activity More filters sheet', () => {
  it('renders no sheet trigger from 600px up', () => {
    stubWidth(false);
    renderRow();
    expect(screen.queryByRole('button', { name: /More filters/u })).toBeNull();
    expect(screen.getByRole('tab', { name: /Removed/u })).toBeTruthy();
  });

  it('opens on a phone and sets Type, range and Spec, counting what is not default', () => {
    stubWidth(true);
    const onChange = renderRow({ types: ['task'], spec: 'SPEC-2', days: 30 });
    const trigger = screen.getByRole('button', { name: 'More filters 3' });
    expect(trigger.closest('[role="tablist"]')).toBeNull();
    expect(screen.getByRole('tab', { name: /Removed/u })).toBeTruthy();
    fireEvent.click(trigger);
    const sheet = within(screen.getByRole('dialog', { name: 'Filters' }));
    expect(sheet.getByRole('button', { name: 'Task' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(sheet.getByRole('button', { name: 'Story' }));
    expect(onChange).toHaveBeenLastCalledWith({ types: ['task', 'story'] });
    fireEvent.click(sheet.getByRole('button', { name: 'Last 90 days' }));
    expect(onChange).toHaveBeenLastCalledWith({ days: 90 });
    fireEvent.click(sheet.getByRole('button', { name: 'SPEC-2' }));
    expect(onChange).toHaveBeenLastCalledWith({ spec: null });
    fireEvent.click(sheet.getByRole('button', { name: 'Clear all' }));
    expect(onChange).toHaveBeenLastCalledWith({ types: [], spec: null, days: 14 });
    expect(sheet.getByRole('button', { name: 'Show 12 changes' })).toBeTruthy();
  });

  it('labels the trigger without a count when every filter is at its default', () => {
    stubWidth(true);
    renderRow();
    expect(screen.getByRole('button', { name: 'More filters' })).toBeTruthy();
  });
});
