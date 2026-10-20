// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChipToggle,
  Inspector,
  Select,
} from '../../../../apps/dashboard/src/design-system/components/index.js';
import { installKeyboardCoordinator } from '../../../../apps/dashboard/src/features/shell/keyboard-coordinator.js';
import { nameFailures } from './control-name-guard.js';

const options = [
  { value: 'all', label: 'All statuses' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

function Single() {
  const [value, onChange] = useState('all');
  return (
    <Select
      value={value}
      onChange={onChange}
      options={options}
      ariaLabel="Status"
      clearValue="all"
    />
  );
}
function Multiple() {
  const [values, onValuesChange] = useState<string[]>([]);
  return (
    <Select
      value="all"
      onChange={() => undefined}
      options={options}
      ariaLabel="Status"
      clearValue="all"
      values={values}
      onValuesChange={onValuesChange}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('chip menu', () => {
  it('uses an overlay and navigates with arrows, Home, End, typeahead and Escape', async () => {
    const user = userEvent.setup();
    const { container } = render(<Single />);
    const trigger = screen.getByRole('combobox', { name: 'Status: All statuses' });
    expect(container.querySelector('select')).toBeNull();
    await user.click(trigger);
    const list = screen.getByRole('listbox', { name: 'Status' });
    expect(container.contains(list)).toBe(false);
    expect(trigger.getAttribute('aria-controls')).toBe(list.id);
    await user.keyboard('{End}');
    expect(trigger.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Done' }).id,
    );
    await user.keyboard('{Home}{ArrowDown}');
    expect(trigger.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Outstanding' }).id,
    );
    await user.keyboard('{ArrowUp}i');
    expect(trigger.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'In progress' }).id,
    );
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('combobox').textContent).toBe('In progress');
    await user.keyboard('{ArrowDown}{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(await nameFailures(container)).toEqual([]);
  });

  it('toggles multiple values and clears them with a keyboard reachable action', async () => {
    const user = userEvent.setup();
    render(<Multiple />);
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'In progress' }));
    await user.click(screen.getByRole('option', { name: 'Outstanding' }));
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true');
    expect(screen.getByRole('option', { name: 'In progress' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('option', { name: 'Outstanding' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(trigger.getAttribute('data-active')).toBe('true');
    await user.click(screen.getByRole('option', { name: 'Outstanding' }));
    expect(screen.getByRole('option', { name: 'Outstanding' }).getAttribute('aria-selected')).toBe(
      'false',
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear Status' }));
    await user.keyboard('{Enter}');
    expect(trigger.textContent).toBe('All statuses');
    expect(trigger.getAttribute('data-active')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('dismisses outside and does not open or invoke a disabled menu', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(
      <>
        <Single />
        <Select
          value="all"
          options={options}
          ariaLabel="Disabled status"
          onChange={change}
          disabled
          disabledReason="Reading the snapshot"
        />
      </>,
    );
    await user.click(screen.getByRole('combobox', { name: 'Status: All statuses' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.click(screen.getByRole('combobox', { name: 'Disabled status: All statuses' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });

  it('leaves the clear action with Tab and keeps composition keys out of navigation', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Single />
        <button type="button">Next control</button>
      </>,
    );
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    const active = trigger.getAttribute('aria-activedescendant');
    fireEvent.keyDown(trigger, { key: 'End', isComposing: true });
    expect(trigger.getAttribute('aria-activedescendant')).toBe(active);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear Status' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next control' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keeps empty menus free of invalid active descendants', async () => {
    const user = userEvent.setup();
    render(<Select value="" onChange={() => undefined} options={[]} ariaLabel="Empty filter" />);
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    await user.keyboard('{ArrowDown}{End}{Home}{ArrowUp}');
    expect(trigger.hasAttribute('aria-activedescendant')).toBe(false);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('dismisses the menu before the inspector while its clear action owns focus', async () => {
    const user = userEvent.setup();
    const { container } = render(<Single />);
    const closeInspector = vi.fn(() => true);
    const dispose = installKeyboardCoordinator(document, () => ({
      root: container,
      singleLetters: true,
      paletteOpen: false,
      togglePalette: () => undefined,
      openHelp: () => undefined,
      navigate: () => undefined,
      closeInspector,
      selectedId: () => null,
      copy: async () => undefined,
      announce: () => undefined,
    }));
    try {
      const trigger = screen.getByRole('combobox');
      await user.click(trigger);
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear Status' }));
      await user.keyboard('{Escape}');
      expect(closeInspector).not.toHaveBeenCalled();
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      dispose();
    }
  });

  it('closes when a text field takes focus and allows the selected filter to reopen and clear', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Multiple />
        <input aria-label="Filter text" />
      </>,
    );
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'In progress' }));
    expect(document.activeElement).toBe(trigger);
    screen.getByRole('textbox', { name: 'Filter text' }).focus();
    expect(await screen.findByRole('combobox')).toBe(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Clear Status' }));
    expect(trigger.textContent).toBe('All statuses');
  });

  it('keeps the clear action outside the scrolling options and fits the popup to the viewport', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 20 }, (_, index) => ({
      value: String(index),
      label: `Option ${index}`,
    }));
    render(
      <Select
        ariaLabel="Long filter"
        value="0"
        onChange={() => undefined}
        options={many}
        clearValue="0"
      />,
    );
    const trigger = screen.getByRole('combobox');
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(640);
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 16,
      y: 700,
      top: 700,
      bottom: 732,
      left: 16,
      right: 144,
      width: 128,
      height: 32,
      toJSON: () => ({}),
    });
    await user.click(trigger);
    const list = screen.getByRole('listbox');
    const clear = screen.getByRole('button', { name: 'Clear Long filter' });
    expect(list.contains(clear)).toBe(false);
    expect(clear.parentElement).toBe(list.parentElement);
    expect(Number.parseFloat(list.parentElement?.style.maxHeight ?? '')).toBe(360);
    expect(Number.parseFloat(list.parentElement?.style.top ?? '')).toBeGreaterThanOrEqual(8);
    await user.keyboard('{End}');
    expect(trigger.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Option 19' }).id,
    );
    const stylesheet = readFileSync(
      resolve(process.cwd(), '../../apps/dashboard/src/design-system/components/chip-menu.css'),
      'utf8',
    );
    expect(stylesheet).toMatch(
      /\.pc-chip-menu__list\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto/u,
    );
    expect(stylesheet).toMatch(/\.pc-chip-menu__option,[^}]*box-sizing:\s*border-box/u);
  });

  it('uses a pressed tab fill distinct from the hover surface in both themes', () => {
    const stylesheet = readFileSync(
      resolve(process.cwd(), '../../apps/dashboard/src/design-system/components/chip-menu.css'),
      'utf8',
    );
    expect(stylesheet).toMatch(
      /\.pc-tabs\[data-variant="pill"\] \.pc-tabs__tab:active:not\(:disabled\)\s*\{\s*background:\s*var\(--pc-accent-soft\)/u,
    );
    const tokens = readFileSync(
      resolve(process.cwd(), '../../apps/dashboard/src/design-system/tokens.css'),
      'utf8',
    );
    const raised = [...tokens.matchAll(/--op-raised:\s*(#[a-f\d]+);/giu)].map((match) => match[1]);
    const pressed = [...tokens.matchAll(/--op-accent-soft:\s*(#[a-f\d]+);/giu)].map(
      (match) => match[1],
    );
    expect(raised.length).toBeGreaterThanOrEqual(2);
    expect(pressed.length).toBeGreaterThanOrEqual(2);
    expect(pressed.every((fill) => !raised.includes(fill))).toBe(true);
  });

  it('keeps exact Task selection available when the trigger dismisses an inspector', async () => {
    function InspectorFilter() {
      const [open, setOpen] = useState(false);
      const [values, onValuesChange] = useState<string[]>([]);
      const origin = useRef<HTMLButtonElement>(null);
      return (
        <>
          <Select
            ariaLabel="Filter by type"
            value="all"
            onChange={() => undefined}
            values={values}
            onValuesChange={onValuesChange}
            clearValue="all"
            options={[
              { value: 'all', label: 'All types' },
              { value: 'task', label: 'Task' },
            ]}
          />
          <Inspector
            trigger={
              <button type="button" ref={origin}>
                Inspect selected row
              </button>
            }
            open={open}
            onOpenChange={setOpen}
            onRestoreFocus={() => origin.current?.focus()}
            title="Selected row"
            description="Planning item"
          >
            <p>Selected item detail</p>
          </Inspector>
        </>
      );
    }
    const user = userEvent.setup();
    render(<InspectorFilter />);
    await user.click(screen.getByRole('button', { name: 'Inspect selected row' }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Inspect selected row' }),
    );
    const trigger = screen.getByRole('combobox', { name: 'Filter by type: All types' });
    await user.pointer({ target: trigger, keys: '[MouseLeft>]' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.pointer({ keys: '[/MouseLeft]' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(trigger);
    const task = screen.getByRole('option', { name: 'Task', exact: true });
    await user.click(task);
    expect(task.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Escape}');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-label')).toBe('Filter by type: Task');
    const origin = screen.getByRole('button', { name: 'Inspect selected row' });
    await user.click(origin);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(origin));
    await user.click(origin);
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.click(origin);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(origin);
  });

  it('exposes density as a pressed chip', async () => {
    const change = vi.fn();
    const user = userEvent.setup();
    render(
      <ChipToggle checked onChange={change}>
        Compact
      </ChipToggle>,
    );
    const chip = screen.getByRole('button', { name: 'Compact' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    await user.click(chip);
    expect(change).toHaveBeenCalledWith(false);
  });
});
