// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArtifactStatus,
  ArtifactTag,
  type ArtifactType,
  Button,
  type ChipSurface,
  CommandHint,
  GovernedButton,
  IconButton,
  Input,
  Inspector,
  PriorityChip,
  Select,
  StatePanel,
  StatusBadge,
  Switch,
  Tabs,
  Toast,
  Tooltip,
  WorkItemChip,
} from '../../../../apps/dashboard/src/design-system/components/index.js';
import {
  contrast,
  palettes,
  rgb,
  statuses,
  surfaces,
  tint,
  types,
} from '../../../../apps/dashboard/tests/helpers/brand-contract.mjs';

const stylesheet = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../apps/dashboard/src/design-system/components/planr-console.css',
  ),
  'utf8',
);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
});

for (const theme of ['dark', 'light'] as const) {
  describe(`${theme} component recipes`, () => {
    beforeEach(() => document.documentElement.setAttribute('data-theme', theme));
    it('renders all 56 opaque tag/status/surface pairs with readable contrast', () => {
      const foregrounds = [
        ...types.map((type: string) => [`type-${type}`, `type-${type}`]),
        ...Object.entries(statuses).map(([status, fg]) => [`status-${status}`, fg]),
      ];
      let pair = 0;
      for (const [recipe, foreground] of foregrounds) {
        for (const surface of surfaces as ChipSurface[]) {
          const element = recipe.startsWith('type-') ? (
            <ArtifactTag type={recipe.slice(5) as ArtifactType} surface={surface}>
              {recipe}
            </ArtifactTag>
          ) : (
            <ArtifactStatus status={recipe.slice(7)} surface={surface} />
          );
          const html = renderToStaticMarkup(element);
          expect(html).toContain(`var(--pc-${recipe}${recipe.startsWith('status-') ? '-fg' : ''})`);
          expect(html).toContain(`background:var(--pc-${recipe}-bg-${surface})`);
          expect(html).toContain(`data-surface="${surface}"`);
          if (recipe.startsWith('status-')) expect(html).toContain('data-glyph=');
          const fg = rgb(palettes[theme][foreground]);
          expect(contrast(fg, tint(fg, rgb(palettes[theme][surface])))).toBeGreaterThanOrEqual(4.5);
          pair += 1;
        }
      }
      expect(pair).toBe(56);
    });

    it('keeps all state shapes distinct and quiet separate from raw status', () => {
      const view = render(
        <>
          <ArtifactStatus status="outstanding" />
          <ArtifactStatus status="in-progress" quiet />
          <ArtifactStatus status="blocked" />
          <ArtifactStatus status="addressed" />
          <StatusBadge status="done" />
          <ArtifactStatus status="future-status" />
        </>,
      );
      expect(
        [...view.container.querySelectorAll('[data-glyph]')].map((node) =>
          node.getAttribute('data-glyph'),
        ),
      ).toEqual(['ring', 'half-ring', 'pause', 'diamond', 'dotted-ring', 'solid-dot', 'unknown']);
      for (const label of [
        'Outstanding',
        'In progress',
        'Blocked',
        'Addressed',
        'Done',
        'Quiet',
        'future-status',
      ])
        expect(screen.getByText(label)).toBeTruthy();
      expect(view.container.querySelector('[data-status="in-progress"]')?.textContent).toBe(
        'In progress',
      );
      expect(renderToStaticMarkup(<ArtifactStatus status="blocked" showLabel={false} />)).toContain(
        'pc-visually-hidden',
      );
    });

    it('renders priorities, real IDs and unknown metadata without inventing a status', () => {
      const view = render(
        <>
          {['P0', 'P1', 'P2', 'P3', 'critical', 'high', 'medium', 'low', 'none', 'future'].map(
            (priority) => (
              <PriorityChip key={priority} priority={priority} />
            ),
          )}
          <WorkItemChip type="task" id="SPEC-020/T-025" />
          <WorkItemChip type="future-type" id="ITEM-5" />
        </>,
      );
      expect(view.container.querySelectorAll('.pc-priority')).toHaveLength(10);
      expect(view.container.querySelectorAll('.pc-priority > [aria-hidden]')).toHaveLength(10);
      expect(view.container.querySelector('[data-type="t"]')?.textContent).toBe('SPEC-020/T-025');
      expect(screen.getByText('ITEM-5 (future-type)')).toBeTruthy();
    });

    it('retains labels during loading and blocks every disabled control callback', () => {
      const invoke = vi.fn();
      render(
        <>
          <Button loading onClick={invoke}>
            Loading action
          </Button>
          <Button disabled disabledReason="Read unavailable" onClick={invoke}>
            Unavailable action
          </Button>
          <IconButton
            icon="copy"
            label="Copy item"
            disabled
            disabledReason="No item selected"
            onClick={invoke}
          />
          <Input
            value="query"
            ariaLabel="Filter"
            disabled
            disabledReason="Reading items"
            onChange={invoke}
          />
          <Select value="a" options={['a']} ariaLabel="Sort" disabled onChange={invoke} />
          <Switch
            checked
            label="Compact"
            disabled
            disabledReason="Setting unavailable"
            onChange={invoke}
          />
          <WorkItemChip
            type="task"
            id="T-025"
            disabled
            disabledReason="Missing item"
            onClick={invoke}
          />
        </>,
      );
      const loading = screen.getByRole('button', { name: 'Loading action' });
      expect(loading.getAttribute('aria-busy')).toBe('true');
      for (const button of screen.getAllByRole('button')) {
        expect((button as HTMLButtonElement).disabled).toBe(true);
        expect(button.getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(button);
        fireEvent.keyDown(button, { key: 'Enter' });
      }
      expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(true);
      expect((screen.getByRole('combobox') as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole('switch'));
      expect(invoke).not.toHaveBeenCalled();
      expect(screen.getByText('Read unavailable')).toBeTruthy();
    });

    it('exposes empty, error and reserved loading presentation without hiding recovery', () => {
      const view = render(
        <>
          <StatePanel
            state="booting"
            eyebrow="Loading"
            title="Reading items"
            description="Please wait"
          />
          <StatePanel
            state="empty"
            eyebrow="Empty"
            title="No items"
            description="Create planning files"
            actions={<Button>Copy recovery</Button>}
          />
          <StatePanel
            state="error"
            eyebrow="Error"
            title="Invalid data"
            description="A file could not be read"
          />
          <Input
            value=""
            ariaLabel="Invalid filter"
            error="Unsupported filter"
            onChange={() => undefined}
          />
          <Select
            value=""
            options={[]}
            ariaLabel="Empty choices"
            error="Choices could not be read"
            onChange={() => undefined}
          />
        </>,
      );
      expect(
        view.container.querySelector('[data-state="booting"]')?.getAttribute('aria-busy'),
      ).toBe('true');
      expect(
        view.container.querySelectorAll('.op-state-panel__skeleton .pc-skeleton'),
      ).toHaveLength(3);
      expect(screen.getByRole('button', { name: 'Copy recovery' })).toBeTruthy();
      expect(screen.getByText('Invalid data').closest('[role="alert"]')).toBeTruthy();
      expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByRole('combobox').getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByText('Unsupported filter')).toBeTruthy();
    });
  });
}

it('uses Radix roving tabs, skips disabled entries and activates only on request', () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  render(
    <Tabs
      tabs={[
        { id: 'one', label: 'One' },
        { id: 'two', label: 'Two', disabled: true, disabledReason: 'Not available' },
        { id: 'three', label: 'Three', count: 0 },
      ]}
      value="one"
      onChange={onChange}
      label="View"
    />,
  );
  const first = screen.getByRole('tab', { name: 'One' });
  act(() => first.focus());
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  act(() => vi.advanceTimersByTime(0));
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Three 0' }));
  expect(screen.getByRole('tab', { name: 'Two' }).getAttribute('aria-disabled')).toBe('true');
  expect(first.getAttribute('aria-selected')).toBe('true');
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Three 0' }), { key: 'Enter' });
  expect(onChange).toHaveBeenCalledExactlyOnceWith('three');
});

it('shows tooltips after 400ms hover, keeps a 100ms pointer grace and dismisses on Escape', async () => {
  vi.useFakeTimers();
  render(
    <Tooltip content="Complete title">
      <button type="button">Truncated title</button>
    </Tooltip>,
  );
  const trigger = screen.getByRole('button');
  fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
  act(() => vi.advanceTimersByTime(399));
  expect(screen.queryByRole('tooltip')).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole('tooltip').textContent).toBe('Complete title');
  expect(trigger.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
  fireEvent.pointerLeave(trigger);
  act(() => vi.advanceTimersByTime(99));
  expect(screen.getByRole('tooltip')).toBeTruthy();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole('tooltip')).toBeNull();
  act(() => trigger.focus());
  expect(screen.getByRole('tooltip')).toBeTruthy();
  fireEvent.keyDown(trigger, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  act(() => trigger.blur());
  act(() => trigger.focus());
  fireEvent.click(trigger);
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('keeps tooltip content open when crossing from its trigger and closes on blur', () => {
  vi.useFakeTimers();
  render(
    <Tooltip content="Detail">
      <button type="button">Help</button>
    </Tooltip>,
  );
  const trigger = screen.getByRole('button');
  fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
  act(() => vi.advanceTimersByTime(400));
  const content = screen.getByRole('tooltip').closest('.pc-tooltip');
  expect(content).toBeTruthy();
  fireEvent.pointerLeave(trigger);
  if (content) fireEvent.pointerEnter(content);
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getByRole('tooltip')).toBeTruthy();
  if (content) fireEvent.pointerLeave(content);
  act(() => vi.advanceTimersByTime(100));
  expect(screen.queryByRole('tooltip')).toBeNull();
  act(() => trigger.focus());
  act(() => trigger.blur());
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('counts six unpaused seconds for informational toasts and pauses across hover and focus', () => {
  vi.useFakeTimers();
  const dismissed = vi.fn();
  const view = render(
    <Toast title="Copied" onDismiss={dismissed}>
      Exact command
    </Toast>,
  );
  act(() => vi.advanceTimersByTime(2000));
  const toast = view.container.firstElementChild;
  if (!toast) throw new Error('Toast did not render');
  fireEvent.mouseEnter(toast);
  act(() => vi.advanceTimersByTime(10000));
  const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
  act(() => dismiss.focus());
  fireEvent.mouseLeave(toast);
  act(() => vi.advanceTimersByTime(10000));
  expect(dismissed).not.toHaveBeenCalled();
  act(() => dismiss.blur());
  act(() => vi.advanceTimersByTime(3999));
  expect(screen.getByRole('status')).toBeTruthy();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole('status')).toBeNull();
  expect(dismissed).toHaveBeenCalledTimes(1);
});

it.each(['error', 'actionable', 'disk-change', 'operation-outcome'] as const)(
  'persists %s notifications until keyboard dismissal',
  (kind) => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    render(
      <Toast title="Needs attention" kind={kind} onDismiss={dismiss}>
        Reason
      </Toast>,
    );
    act(() => vi.advanceTimersByTime(60000));
    const button = screen.getByRole('button', { name: 'Dismiss notification' });
    act(() => button.focus());
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByText('Needs attention')).toBeNull();
    expect(dismiss).toHaveBeenCalledTimes(1);
  },
);

it('keeps toasts with actions persistent even when their kind is informational', () => {
  vi.useFakeTimers();
  render(<Toast title="Items changed" action={<button type="button">Show</button>} />);
  act(() => vi.advanceTimersByTime(60000));
  expect(screen.getByRole('button', { name: 'Show' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
  expect(screen.queryByText('Items changed')).toBeNull();
});

it('copies exact command bytes with C once, locks pending, and reports confirmed success', async () => {
  const command = 'openplanr status SPEC-020 --md\n';
  let release!: () => void;
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const parentKey = vi.fn();
  render(
    <fieldset onKeyDown={parentKey}>
      <CommandHint command={command} />
    </fieldset>,
  );
  const button = screen.getByRole('button', { name: 'Copy command' });
  act(() => button.focus());
  fireEvent.keyDown(button, { key: 'c' });
  fireEvent.click(button);
  expect(writeText).toHaveBeenCalledExactlyOnceWith(command);
  expect(parentKey).not.toHaveBeenCalled();
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(screen.queryByText('Copied')).toBeNull();
  await act(async () => release());
  expect(screen.getByRole('status').textContent).toBe(`Copied${command}`);
});

it('keeps denied clipboard commands selectable and offers manual copy without false success', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('Denied'));
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const view = render(<CommandHint command="/planr:status" />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy command' })));
  expect(screen.getByRole('alert').textContent).toContain(
    'Select the command and copy it manually.',
  );
  expect(view.container.querySelector('code.pc-command-hint__command')?.textContent).toBe(
    '/planr:status',
  );
  expect(screen.queryByText('Copied')).toBeNull();
});

it('keeps command feedback outside row geometry for success and clipboard denial', async () => {
  const onCopy = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <CommandHint variant="row" artifactId="T-001" command="status" onCopy={onCopy} />,
  );
  const button = screen.getByRole('button', { name: 'Copy command for T-001' });
  await act(async () => fireEvent.click(button));
  const feedback = document.querySelector('.pc-command-hint__feedback');
  expect(feedback?.parentElement).toBe(document.body);
  expect(view.container.querySelector('.pc-toast')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('Copiedstatus');
  onCopy.mockRejectedValue(new Error('Denied'));
  await act(async () => fireEvent.click(button));
  expect(view.container.querySelector('.pc-toast')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain(
    'Select the command and copy it manually.',
  );
});

it('handles absent clipboard and ignores old completions after command selection changes', async () => {
  const view = render(<CommandHint command="first command" />);
  vi.stubGlobal('navigator', { clipboard: undefined });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy command' })));
  expect(screen.getByRole('alert')).toBeTruthy();
  let release!: () => void;
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    },
  });
  view.rerender(<CommandHint command="second command" />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
  view.rerender(<CommandHint command="third command" />);
  await act(async () => release());
  expect(screen.queryByText('Copied')).toBeNull();
  expect(screen.getByRole('button', { name: 'Copy command' })).toBeTruthy();
});

it('ignores copy chords, composition and disabled shortcuts, and blocks unavailable commands', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const view = render(<CommandHint command="status" />);
  let button = screen.getByRole('button');
  for (const modifiers of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { isComposing: true },
  ])
    fireEvent.keyDown(button, { key: 'c', ...modifiers });
  view.rerender(<CommandHint command="status" shortcutsEnabled={false} />);
  fireEvent.keyDown(screen.getByRole('button'), { key: 'c' });
  view.rerender(<CommandHint command="status" disabled disabledReason="Missing binding" />);
  button = screen.getByRole('button');
  fireEvent.click(button);
  fireEvent.keyDown(button, { key: 'c' });
  expect(writeText).not.toHaveBeenCalled();
  expect(screen.getByText('Missing binding')).toBeTruthy();
  view.rerender(<CommandHint command="" />);
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('No command available.')).toBeTruthy();
});

function InspectorExample({
  state = 'ready',
  modal = false,
}: {
  state?: 'ready' | 'loading' | 'empty' | 'error';
  modal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Inspector
      open={open}
      onOpenChange={setOpen}
      modal={modal}
      title="Item detail"
      description="Selected item"
      trigger={<button type="button">Inspect item</button>}
      state={state}
      reason="Item unavailable"
    >
      <p>Item body</p>
    </Inspector>
  );
}

it.each([false, true])(
  'preserves nonmodal focus and enters modal content with modal=%s',
  async (modal) => {
    render(<InspectorExample modal={modal} />);
    const trigger = screen.getByRole('button', { name: 'Inspect item' });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBe(
      screen.getByRole('heading').id,
    );
    expect(document.activeElement).toBe(modal ? screen.getByRole('heading') : trigger);
    fireEvent.keyDown(document.activeElement ?? trigger, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(trigger);
  },
);

it.each(['loading', 'empty', 'error'] as const)(
  'keeps inspector close available in %s state',
  (state) => {
    render(<InspectorExample state={state} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect item' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-state')).toBe(state);
    expect(screen.queryByText('Item body')).toBeNull();
    if (state === 'loading') expect(dialog.querySelector('[aria-busy="true"]')).toBeTruthy();
    else expect(screen.getByText('Item unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  },
);

it('surfaces governed invocation rejection and retains its exact single-flight callback', async () => {
  const onInvoke = vi.fn().mockRejectedValue(new Error('Transport failed'));
  render(<GovernedButton onInvoke={onInvoke}>Run reviewed action</GovernedButton>);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Run reviewed action' })),
  );
  expect(onInvoke).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert').textContent).toContain('Check its current state');
  expect(screen.queryByText('Copied')).toBeNull();
});

it('has accessible control, notification and portal semantics', async () => {
  render(
    <main>
      <Tabs
        tabs={[
          { id: 'one', label: 'One' },
          { id: 'two', label: 'Two' },
        ]}
        value="one"
        onChange={() => undefined}
        label="View"
      />
      <ArtifactTag type="spec">SPEC-020</ArtifactTag>
      <ArtifactStatus status="blocked" />
      <PriorityChip priority="high" />
      <Button>Open</Button>
      <Input ariaLabel="Filter" value="" onChange={() => undefined} />
      <Switch label="Compact" checked={false} onChange={() => undefined} />
      <Toast title="Copied">status command</Toast>
      <InspectorExample />
    </main>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Inspect item' }));
  const result = await axe.run(document.body, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  expect(result.violations).toEqual([]);
});

it('defines contrast-safe focus, non-color shapes, disabled, pressed and reduced-motion styles', () => {
  expect(stylesheet).toContain('outline: 2px solid var(--pc-focus-ring)');
  expect(stylesheet).toContain('outline-offset: 2px');
  expect(stylesheet).toContain(':active:not(:disabled)');
  expect(stylesheet).toContain('[data-glyph="half-ring"]');
  expect(stylesheet).toContain('[data-glyph="diamond"]');
  expect(stylesheet).toContain('[data-glyph="dotted-ring"]');
  expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)');
  expect(stylesheet).toContain('@media (forced-colors: active)');
});

it('preserves native keyboard activation for controls, command copy and notification dismissal', async () => {
  const user = userEvent.setup();
  const invoke = vi.fn();
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  render(
    <>
      <Button onClick={invoke}>Open item</Button>
      <CommandHint command="exact command" />
    </>,
  );
  await user.tab();
  await user.keyboard('{Enter}');
  expect(invoke).toHaveBeenCalledTimes(1);
  await user.tab();
  await user.keyboard('{Enter}');
  expect(writeText).toHaveBeenCalledExactlyOnceWith('exact command');
  expect(screen.getByRole('status')).toBeTruthy();
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss notification' }));
  await user.keyboard('{Enter}');
  expect(screen.queryByRole('status')).toBeNull();
});

it('closes only the topmost tooltip before closing its inspector', () => {
  const onOpenChange = vi.fn();
  render(
    <Inspector open onOpenChange={onOpenChange} title="Item" description="Selected item">
      <Tooltip content="Full command">
        <button type="button">Help</button>
      </Tooltip>
    </Inspector>,
  );
  const trigger = screen.getByRole('button', { name: 'Help' });
  act(() => trigger.focus());
  expect(screen.getByRole('tooltip')).toBeTruthy();
  fireEvent.keyDown(trigger, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(onOpenChange).not.toHaveBeenCalled();
  fireEvent.keyDown(trigger, { key: 'Escape' });
  expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
});

it('keeps a pending physical clipboard write locked across command selection changes', async () => {
  let release!: () => void;
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const view = render(<CommandHint command="command A" />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
  view.rerender(<CommandHint command="command B" />);
  const button = screen.getByRole('button', { name: 'Copying' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(writeText).toHaveBeenCalledExactlyOnceWith('command A');
  await act(async () => release());
  expect(screen.queryByText('Copied')).toBeNull();
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
  expect(writeText.mock.calls.map(([command]) => command)).toEqual(['command A', 'command B']);
  await act(async () => release());
  expect(screen.getByRole('status').textContent).toBe('Copiedcommand B');
});

it('dismisses a nested tooltip before its persistent toast', () => {
  const onDismiss = vi.fn();
  render(
    <Toast
      title="Action available"
      onDismiss={onDismiss}
      action={
        <Tooltip content="Full action">
          <button type="button">Show</button>
        </Tooltip>
      }
    />,
  );
  const trigger = screen.getByRole('button', { name: 'Show' });
  act(() => trigger.focus());
  expect(screen.getByRole('tooltip')).toBeTruthy();
  fireEvent.keyDown(trigger, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(onDismiss).not.toHaveBeenCalled();
  fireEvent.keyDown(trigger, { key: 'Escape' });
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it('preserves text contrast for primary, danger and inverse hover and pressed fills', () => {
  for (const theme of ['dark', 'light'] as const) {
    for (const kind of ['primary', 'danger', 'inverse']) {
      const foreground = rgb(palettes[theme][kind === 'inverse' ? 'bg' : 'on-accent']);
      const background = rgb(
        palettes[theme][kind === 'primary' ? 'accent' : kind === 'danger' ? 'danger' : 'text'],
      );
      for (const state of [':hover', ':active']) {
        const selector = `.pc-button[data-variant="${kind}"]${state}:not(:disabled)`;
        const offset = stylesheet.lastIndexOf(selector);
        expect(offset).toBeGreaterThanOrEqual(0);
        const rule = stylesheet.slice(offset).split('}')[0];
        const mix = rule.match(
          /color-mix\(in srgb,\s*var\([^)]+\)\s+(\d+)%,\s*var\([^)]+\)\s+(\d+)%\)/u,
        );
        if (!mix) throw new Error(`Missing explicit color mix for ${selector}`);
        const baseWeight = Number(mix[1]) / 100;
        const inkWeight = Number(mix[2]) / 100;
        expect(baseWeight + inkWeight).toBe(1);
        const fill = background.map(
          (channel: number, index: number) => channel * baseWeight + foreground[index] * inkWeight,
        );
        expect(contrast(foreground, fill), `${theme} ${kind} ${state}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});
