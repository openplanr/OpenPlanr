// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDashboardRoute } from '../../../../apps/dashboard/src/app/router.js';
import {
  BootScreen,
  PlaneBanner,
  TransitScreen,
} from '../../../../apps/dashboard/src/features/shell/shell-planes.js';

afterEach(cleanup);

describe('truthful shell recovery states', () => {
  it('uses real row geometry while the first Planning read is pending', () => {
    const { container } = render(
      <TransitScreen route={parseDashboardRoute('#/list')} note="loading" />,
    );
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('.pc-skeleton-table')).not.toBeNull();
    expect(
      screen.getByText('Reading .planr/. Planning files appear here after the read is validated.'),
    ).not.toBeNull();
    expect(container.querySelector('.pc-icon--spin')).toBeNull();
  });

  it('does not infer a missing project from an unavailable bootstrap', () => {
    const { container } = render(
      <BootScreen route={parseDashboardRoute('#/home')} phase="unavailable" detail={null} />,
    );
    expect(screen.getByText('The dashboard connection could not be verified')).not.toBeNull();
    expect(container.textContent).toContain('openplanr dashboard');
    expect(container.textContent).not.toContain('no .planr/ directory');
    expect(container.textContent).not.toContain('/planr-plan');
    expect(container.textContent).not.toContain('No graph at this path');
  });

  it('keeps watcher disconnection distinct from a server failure and reports known freshness', () => {
    const snapshotAt = Date.parse('2026-10-19T20:46:00.000Z');
    const { container } = render(
      <PlaneBanner
        state="offline"
        reason="The event connection closed."
        lastSnapshotAt={snapshotAt}
        attempt={3}
      />,
    );
    expect(screen.getByText('The file watcher disconnected')).not.toBeNull();
    expect(container.querySelector('time')?.dateTime).toBe('2026-10-19T20:46:00.000Z');
    expect(container.textContent).toContain('Reconnecting, attempt 3.');
    expect(container.textContent).not.toContain('server stopped');
    expect(container.textContent).not.toContain('openplanr dashboard');
    expect(container.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
  });

  it('explains a failed read without claiming the server is proven stopped', () => {
    const { container } = render(
      <PlaneBanner state="stale" reason="The read failed." errorCode="DASHBOARD_READ_FAILED" />,
    );
    expect(screen.getByText('The dashboard read failed')).not.toBeNull();
    expect(container.textContent).toContain('Check that the local server is running and reachable');
    expect(container.textContent).toContain('openplanr dashboard');
    expect(container.textContent).not.toContain('server is not running');
    expect(container.querySelector('time')).toBeNull();
    expect(container.textContent).toContain('Live freshness cannot be confirmed.');
  });

  it('rejects invalid response copy independently of watcher or server availability', () => {
    const { container } = render(
      <PlaneBanner
        state="stale"
        reason="Response validation failed."
        errorCode="DASHBOARD_RESPONSE_INVALID"
        lastSnapshotAt={Number.NaN}
      />,
    );
    expect(screen.getByText('The latest dashboard response could not be validated')).not.toBeNull();
    expect(container.textContent).toContain('The rejected response was not applied.');
    expect(container.textContent).not.toContain('openplanr dashboard');
    expect(container.querySelector('time')).toBeNull();
  });

  it('makes recovery reads explicit and exposes a failed retry without discarding content', async () => {
    let rejectRead!: (error: Error) => void;
    const onRetry = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRead = reject;
        }),
    );
    render(<PlaneBanner state="stale" reason="A newer snapshot is required." onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry read' }));
    const pending = screen.getByRole('button', { name: 'Reading again' }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect(pending.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(pending);
    expect(onRetry).toHaveBeenCalledTimes(1);
    rejectRead(new Error('Local read failed'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry read' })).not.toBeNull());
    expect(
      screen.getByText('Another read failed. Current data has not been refreshed.'),
    ).not.toBeNull();
  });
});
