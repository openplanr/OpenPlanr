// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from '../../../../apps/dashboard/src/design-system/components/index.js';

const columns = [{ key: 'title', label: 'Title' }];
const rows = [{ id: 'one', title: 'Recovery record' }];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('shared table scroll region', () => {
  it('adds a named tab stop only during overflow and observes table and viewport resizing', async () => {
    let scrollWidth = 200;
    let resize: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => scrollWidth);
    const view = render(
      <DataTable columns={columns} rows={rows} caption="Immutable recovery history" />,
    );
    const wrapper = view.container.querySelector<HTMLDivElement>('.pc-table-wrap');
    if (!wrapper || !resize) throw new Error('Missing table or size observer.');
    expect(wrapper.hasAttribute('tabindex')).toBe(false);
    expect(screen.queryByRole('region')).toBeNull();
    expect(observe.mock.calls.map(([target]) => target)).toEqual([
      wrapper,
      screen.getByRole('table'),
    ]);
    scrollWidth = 400;
    act(() => resize?.([], {} as ResizeObserver));
    const region = screen.getByRole('region', { name: 'Immutable recovery history' });
    expect(region.getAttribute('aria-label')).toBe(region.getAttribute('data-scroll-context'));
    expect(region.tabIndex).toBe(0);
    await userEvent.tab();
    expect(document.activeElement).toBe(region);
    scrollWidth = 200;
    fireEvent.resize(window);
    expect(wrapper.hasAttribute('tabindex')).toBe(false);
    expect(screen.queryByRole('region')).toBeNull();
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('remeasures new content and supports resizing without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    let scrollWidth = 400;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => scrollWidth);
    const view = render(<DataTable columns={columns} rows={rows} />);
    expect(screen.getByRole('region', { name: 'table' }).tabIndex).toBe(0);
    scrollWidth = 200;
    view.rerender(<DataTable columns={columns} rows={[...rows]} />);
    expect(screen.queryByRole('region')).toBeNull();
    scrollWidth = 400;
    fireEvent.resize(window);
    expect(screen.getByRole('region', { name: 'table' }).tabIndex).toBe(0);
  });
});
