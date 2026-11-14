// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  GovernedButton,
  Tooltip,
} from '../../../../apps/dashboard/src/design-system/components/index.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('keeps the governed action node, label and trigger mounted throughout durable acceptance', async () => {
  let release!: () => void;
  const onInvoke = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  render(<GovernedButton onInvoke={onInvoke}>Run exact reviewed action</GovernedButton>);
  const button = screen.getByRole('button', { name: 'Run exact reviewed action' });
  const trigger = button.parentElement;
  act(() => button.focus());
  fireEvent.click(button);
  const pending = screen.getByRole('button', { name: 'Waiting for durable acceptance' });
  expect(pending).toBe(button);
  expect(pending.parentElement).toBe(trigger);
  expect(pending.textContent).toBe('Run exact reviewed action');
  expect(pending.getAttribute('aria-disabled')).toBe('true');
  expect(pending.getAttribute('aria-busy')).toBe('true');
  expect((pending as HTMLButtonElement).disabled).toBe(true);
  expect(document.getElementById(pending.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
    'Waiting for durable acceptance',
  );
  fireEvent.click(pending);
  expect(onInvoke).toHaveBeenCalledTimes(1);
  await act(async () => release());
  expect(screen.getByRole('button', { name: 'Run exact reviewed action' })).toBe(button);
  expect(button.parentElement).toBe(trigger);
  expect((button as HTMLButtonElement).disabled).toBe(false);
  expect(button.getAttribute('aria-busy')).toBeNull();
});

it('suppresses an unavailable tooltip without replacing its keyboard trigger', () => {
  vi.useFakeTimers();
  const view = render(
    <Tooltip content="Action pending" disabled>
      <button type="button">Action</button>
    </Tooltip>,
  );
  const trigger = screen.getByRole('button', { name: 'Action' });
  act(() => trigger.focus());
  fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
  act(() => vi.advanceTimersByTime(400));
  expect(screen.queryByRole('tooltip')).toBeNull();
  view.rerender(
    <Tooltip content="Action pending">
      <button type="button">Action</button>
    </Tooltip>,
  );
  expect(screen.getByRole('button', { name: 'Action' })).toBe(trigger);
  act(() => trigger.blur());
  act(() => trigger.focus());
  expect(screen.getByRole('tooltip').textContent).toBe('Action pending');
  view.rerender(
    <Tooltip content="Action pending" disabled>
      <button type="button">Action</button>
    </Tooltip>,
  );
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
