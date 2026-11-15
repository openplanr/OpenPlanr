// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('mobile palette touch activation', () => {
  it.each(['connected', 'read-only'] as const)(
    'keeps a palette opened by a touch sequence available for destination selection when %s',
    async (connectionState) => {
      vi.stubGlobal('innerWidth', 390);
      window.location.hash = '#/operate/today';
      const user = userEvent.setup();
      const { container } = render(
        <DashboardProviders
          buildId="mobile-palette-touch"
          bootPhase="compatible"
          connection={{ state: connectionState, label: connectionState, reason: 'Fixture' }}
        >
          <UnifiedShell />
        </DashboardProviders>,
      );
      const trigger = screen.getByRole('button', { name: /^Jump to a view or an artifact/u });
      const events: string[] = [];
      for (const type of ['pointerdown', 'touchstart', 'pointerup', 'touchend', 'click']) {
        trigger.addEventListener(type, () => events.push(type));
      }
      await user.pointer([{ keys: '[TouchA>]', target: trigger }, { keys: '[/TouchA]' }]);
      expect(events).toEqual(['pointerdown', 'pointerup', 'click']);
      const dialog = screen.getByRole('dialog', { name: 'Command palette' });
      expect(dialog.hasAttribute('open')).toBe(true);
      const input = within(dialog).getByRole('searchbox');
      expect(document.activeElement).toBe(input);
      await user.pointer([{ keys: '[TouchA>]', target: input }, { keys: '[/TouchA]' }]);
      fireEvent.change(input, { target: { value: 'action' } });
      const destination = within(dialog).getByRole('button', { name: /^Actions\b/u });
      await user.pointer([{ keys: '[TouchA>]', target: destination }, { keys: '[/TouchA]' }]);
      await waitFor(() => expect(window.location.hash).toBe('#/operate/actions'));
      expect(container.querySelector('dialog.pc-palette')?.hasAttribute('open')).toBe(false);
    },
  );
});
