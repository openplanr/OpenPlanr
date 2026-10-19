// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('Operate first-run presentation', () => {
  it('offers only the exact supplemental command after a verified empty read', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(emptyIndex)));
    vi.stubGlobal('fetch', fetch);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<LocalOperateReviews route={route} origin="http://localhost" />);
    expect(
      await screen.findByRole('heading', { name: 'Operate is not set up here yet' }),
    ).toBeTruthy();
    expect(screen.getByText('Proposed')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Operate today' })).toBeTruthy();
    expect(screen.getByText('Governed actions')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith('/planr:operate'));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(
      fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET'),
    ).toBe(true);
    expect(screen.queryByText('Example cycle')).toBeNull();
    expect(screen.queryByText('Focus item')).toBeNull();
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
    expect(screen.queryByRole('heading', { name: 'Operate is not set up here yet' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy command' })).toBeNull();
  });
});
