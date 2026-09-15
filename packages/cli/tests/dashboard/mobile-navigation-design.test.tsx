// @vitest-environment jsdom

import { render, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';

it('keeps the full dashboard navigable at phone width', () => {
  const initialWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 480 });
  const rendered = render(
    <DashboardProviders buildId="window-size-test" initialHash="#/operate/today">
      <UnifiedShell />
    </DashboardProviders>,
  );
  try {
    const navigation = rendered.getByRole('navigation', { name: 'Mobile Operate navigation' });
    expect(
      within(navigation).getByRole('link', { name: 'Today' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(within(navigation).getByRole('link', { name: 'Planning' }).getAttribute('href')).toBe(
      '#/overview',
    );
    expect(rendered.queryByRole('heading', { name: 'Use a wider window' })).toBeNull();
  } finally {
    rendered.unmount();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: initialWidth });
  }
});
