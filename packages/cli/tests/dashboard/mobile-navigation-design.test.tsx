// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import { SHELL_MIN_WIDTH } from '../../../../apps/dashboard/src/features/shell/shell-planes.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';

it('explains the local console window minimum and restores navigation after resizing', () => {
  const initialWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 480 });
  const rendered = render(
    <DashboardProviders buildId="window-size-test" initialHash="#/operate/today">
      <UnifiedShell />
    </DashboardProviders>,
  );
  try {
    expect(rendered.getByRole('heading', { name: 'Use a wider window' })).toBeTruthy();
    expect(rendered.container.textContent).toContain(`needs ${SHELL_MIN_WIDTH}px`);
    expect(rendered.queryByRole('navigation')).toBeNull();
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
      window.dispatchEvent(new Event('resize'));
    });
    expect(rendered.getByRole('navigation', { name: 'Dashboard navigation' })).toBeTruthy();
    expect(rendered.getByRole('link', { name: 'planning' }).getAttribute('href')).toBe(
      '#/overview',
    );
    expect(rendered.getByRole('link', { name: 'operate' }).getAttribute('href')).toBe(
      '#/operate/today',
    );
    expect(rendered.queryByRole('heading', { name: 'Use a wider window' })).toBeNull();
  } finally {
    rendered.unmount();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: initialWidth });
  }
});
