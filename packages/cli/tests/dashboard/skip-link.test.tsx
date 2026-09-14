// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../../../apps/dashboard/src/app/App.js';

describe('dashboard skip link', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('focuses the main landmark without replacing the closed dashboard route', () => {
    window.location.hash = '#/overview';
    render(
      <App
        buildId="skip-link-test"
        identity={{
          projectName: 'OpenPlanr',
          projectDetail: 'local test',
          actorLabel: 'owner-test',
          bindingLabel: 'planning',
        }}
        connection={{
          state: 'connected',
          label: 'Connected',
          reason: 'Verified local projection.',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Skip to main content' }));

    expect(window.location.hash).toBe('#/overview');
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });
});
