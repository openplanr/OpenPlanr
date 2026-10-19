// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserShellAdapters,
  type ShellAdapters,
} from '../../../../apps/dashboard/src/app/browser-preferences.js';
import { useShellInteractions } from '../../../../apps/dashboard/src/features/shell/shell-interactions.js';
import {
  PlanningPresentationProvider,
  useListPresentation,
} from '../../../../apps/dashboard/src/lib/routing/planning-presentation.js';
import type { PlanningView } from '../../../../apps/dashboard/src/lib/routing/planning-view-codec.js';

const FIXTURE_FIRST = 'T-910';
const FIXTURE_SECOND = 'T-911';
const DETAIL = `#/detail/${FIXTURE_SECOND}`;
const DEFAULT_ADAPTERS: ShellAdapters = {
  loadSingleLetters: () => true,
  saveSingleLetters: () => undefined,
  copy: async () => undefined,
};

function RememberedList({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const presentation = useListPresentation(() => 'all');
  return (
    <section data-route-kind="planning.list">
      <label>
        Filter work
        <input
          aria-label="Filter work"
          type="search"
          value={presentation.query}
          onChange={(event) => presentation.setQuery(event.target.value)}
        />
      </label>
      <button type="button" onClick={() => presentation.setCompact((value) => !value)}>
        Toggle density
      </button>
      <button type="button" onClick={() => presentation.setPage((value) => value + 1)}>
        Next page
      </button>
      <output data-testid="list-state">
        {JSON.stringify({
          query: presentation.query,
          compact: presentation.compact,
          page: presentation.page,
        })}
      </output>
      <div data-scroll-context="board" data-testid="nested-scroll">
        {[FIXTURE_FIRST, FIXTURE_SECOND].map((id) => (
          <button
            key={id}
            type="button"
            data-keyboard-item={id}
            data-selected={selected === id}
            onClick={() => onSelect(id)}
          >
            {id}
          </button>
        ))}
      </div>
    </section>
  );
}

function Harness({
  routeKey = '#/list',
  scope = 'fixture-scope',
  adapters = DEFAULT_ADAPTERS,
  view = null,
}: {
  routeKey?: string;
  scope?: string;
  adapters?: ShellAdapters;
  view?: PlanningView | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const interactions = useShellInteractions({
    adapters,
    routeKey,
    scope,
    selectedId: selected,
    paletteOpen,
    togglePalette: () => setPaletteOpen((open) => !open),
    inspectorOpen,
    setInspectorOpen,
  });
  return (
    <main ref={interactions.rootRef}>
      {interactions.help}
      <button type="button" onClick={() => interactions.navigate(DETAIL)}>
        Promote selected item
      </button>
      <a href={DETAIL}>Native full page link</a>
      <output data-testid="selection">{selected ?? 'none'}</output>
      <output data-testid="palette">{String(paletteOpen)}</output>
      <output data-testid="inspector">{String(inspectorOpen)}</output>
      <div ref={interactions.scrollRef} data-testid="scroll">
        <PlanningPresentationProvider scope={scope} view={view}>
          {routeKey === '#/list' ? (
            <RememberedList
              selected={selected}
              onSelect={(id) => {
                setSelected(id);
                setInspectorOpen(true);
              }}
            />
          ) : (
            <article>
              <h1>Full detail</h1>
              <button type="button">Detail control</button>
            </article>
          )}
        </PlanningPresentationProvider>
      </div>
    </main>
  );
}

function listState() {
  return JSON.parse(screen.getByTestId('list-state').textContent ?? '{}');
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('browser single-letter preference adapter', () => {
  it('persists a versioned boolean and reloads it in a new adapter', () => {
    const adapters = createBrowserShellAdapters();
    expect(adapters.loadSingleLetters()).toBe(true);
    adapters.saveSingleLetters(false);
    expect(localStorage.getItem('op-shortcuts:v1')).toBe('false');
    expect(createBrowserShellAdapters().loadSingleLetters()).toBe(false);
    adapters.saveSingleLetters(true);
    expect(createBrowserShellAdapters().loadSingleLetters()).toBe(true);
  });

  it.each(['off', 'null', '0', '{}', '"false"'])(
    'surfaces malformed stored preference %s',
    (value) => {
      localStorage.setItem('op-shortcuts:v1', value);
      expect(() => createBrowserShellAdapters().loadSingleLetters()).toThrow(
        'Invalid browser shortcut preference',
      );
    },
  );

  it('surfaces unavailable preference storage without claiming persistence', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    expect(() => createBrowserShellAdapters().saveSingleLetters(false)).toThrow('storage blocked');
  });
});

describe('shell help and preference integration', () => {
  it('offers an accessible help launcher and disables letters while retaining Cmd/Ctrl-K', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<Harness adapters={{ ...DEFAULT_ADAPTERS, saveSingleLetters: save }} />);
    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const toggle = within(dialog).getByRole('switch', { name: 'Enable single-letter shortcuts' });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    await user.click(toggle);
    expect(save).toHaveBeenCalledWith(false);
    await user.click(within(dialog).getByRole('button', { name: 'Close keyboard shortcuts' }));
    expect(screen.getByRole('button', { name: 'Keyboard shortcuts' })).toBe(document.activeElement);
    const first = screen.getByRole('button', { name: FIXTURE_FIRST });
    first.focus();
    fireEvent.keyDown(first, { key: 'j' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'k', ctrlKey: true });
    expect(screen.getByTestId('palette').textContent).toBe('true');
  });

  it('uses a stored disabled preference at mount and can enable it accessibly', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(
      <Harness
        adapters={{ ...DEFAULT_ADAPTERS, loadSingleLetters: () => false, saveSingleLetters: save }}
      />,
    );
    const first = screen.getByRole('button', { name: FIXTURE_FIRST });
    first.focus();
    fireEvent.keyDown(first, { key: 'j' });
    expect(document.activeElement).toBe(first);
    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    const toggle = screen.getByRole('switch', { name: 'Enable single-letter shortcuts' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    await user.click(toggle);
    expect(save).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Close keyboard shortcuts' }));
    first.focus();
    fireEvent.keyDown(first, { key: 'j' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: FIXTURE_SECOND }));
  });

  it('surfaces preference read failure and keeps safe default shortcuts available', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        adapters={{
          ...DEFAULT_ADAPTERS,
          loadSingleLetters: () => {
            throw new Error('read blocked');
          },
        }}
      />,
    );
    const first = screen.getByRole('button', { name: FIXTURE_FIRST });
    first.focus();
    fireEvent.keyDown(first, { key: 'j' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: FIXTURE_SECOND }));
    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(
      within(screen.getByRole('dialog')).getByText(
        'Shortcut preference could not be read in this browser.',
      ),
    ).toBeTruthy();
  });

  it('keeps a failed save effective for this page and explains that persistence failed', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        adapters={{
          ...DEFAULT_ADAPTERS,
          saveSingleLetters: () => {
            throw new Error('quota');
          },
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    await user.click(screen.getByRole('switch', { name: 'Enable single-letter shortcuts' }));
    expect(
      screen.getByText(
        'Shortcut preference could not be saved. It applies until this page is closed.',
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close keyboard shortcuts' }));
    const first = screen.getByRole('button', { name: FIXTURE_FIRST });
    first.focus();
    fireEvent.keyDown(first, { key: 'j' });
    expect(document.activeElement).toBe(first);
  });
});

describe('promotion and return presentation', () => {
  it('restores selected item, both scroll axes and remembered List state after full-page promotion and back', async () => {
    const user = userEvent.setup();
    const rendered = render(<Harness />);
    await user.type(screen.getByRole('searchbox', { name: 'Filter work' }), 'keep this query');
    await user.click(screen.getByRole('button', { name: 'Toggle density' }));
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.click(screen.getByRole('button', { name: FIXTURE_SECOND }));
    const scroll = screen.getByTestId('scroll');
    scroll.scrollTop = 245;
    scroll.scrollLeft = 37;
    await user.click(screen.getByRole('button', { name: 'Promote selected item' }));
    expect(window.location.hash).toBe(DETAIL);
    rendered.rerender(<Harness routeKey={DETAIL} />);
    expect(scroll.scrollTop).toBe(0);
    scroll.scrollTop = 99;
    scroll.scrollLeft = 3;
    rendered.rerender(<Harness />);
    expect(listState()).toEqual({ query: 'keep this query', compact: true, page: 1 });
    expect(screen.getByTestId('selection').textContent).toBe(FIXTURE_SECOND);
    expect(scroll.scrollTop).toBe(245);
    expect(scroll.scrollLeft).toBe(37);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: FIXTURE_SECOND })),
    );
  });

  it('restores intrinsic Board scroll axes with the outer plane after promotion and back', async () => {
    const user = userEvent.setup();
    const rendered = render(<Harness />);
    await user.click(screen.getByRole('button', { name: FIXTURE_SECOND }));
    const outer = screen.getByTestId('scroll');
    const nested = screen.getByTestId('nested-scroll');
    outer.scrollTop = 154;
    outer.scrollLeft = 8;
    nested.scrollTop = 67;
    nested.scrollLeft = 580;
    await user.click(screen.getByRole('button', { name: 'Promote selected item' }));
    rendered.rerender(<Harness routeKey={DETAIL} />);
    expect(screen.queryByTestId('nested-scroll')).toBeNull();
    rendered.rerender(<Harness />);
    expect(outer.scrollTop).toBe(154);
    expect(outer.scrollLeft).toBe(8);
    expect(screen.getByTestId('nested-scroll').scrollTop).toBe(67);
    expect(screen.getByTestId('nested-scroll').scrollLeft).toBe(580);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: FIXTURE_SECOND }));
  });

  it('captures native hash link navigation before its origin disappears', async () => {
    const user = userEvent.setup();
    const rendered = render(<Harness />);
    await user.click(screen.getByRole('button', { name: FIXTURE_FIRST }));
    const scroll = screen.getByTestId('scroll');
    scroll.scrollTop = 312;
    scroll.scrollLeft = 24;
    await user.click(screen.getByRole('link', { name: 'Native full page link' }));
    rendered.rerender(<Harness routeKey={DETAIL} />);
    rendered.rerender(<Harness />);
    expect(scroll.scrollTop).toBe(312);
    expect(scroll.scrollLeft).toBe(24);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: FIXTURE_FIRST }));
  });

  it('captures native hash changes while retaining List query and focus', () => {
    const rendered = render(<Harness />);
    const selected = screen.getByRole('button', { name: FIXTURE_SECOND });
    fireEvent.click(selected);
    selected.focus();
    const scroll = screen.getByTestId('scroll');
    scroll.scrollTop = 410;
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    rendered.rerender(<Harness routeKey={DETAIL} />);
    rendered.rerender(<Harness />);
    expect(scroll.scrollTop).toBe(410);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: FIXTURE_SECOND }));
  });

  it('clears List presentation when its authority scope changes without unmounting the route', async () => {
    const user = userEvent.setup();
    const rendered = render(<Harness />);
    await user.type(screen.getByRole('searchbox'), 'private scope query');
    rendered.rerender(<Harness scope="new-fixture-scope" />);
    expect(listState()).toEqual({ query: '', compact: false, page: 0 });
  });

  it('does not restore remembered List state across authority scopes', async () => {
    const user = userEvent.setup();
    const rendered = render(<Harness />);
    await user.type(screen.getByRole('searchbox'), 'private scope query');
    rendered.rerender(<Harness routeKey={DETAIL} />);
    rendered.rerender(<Harness scope="new-fixture-scope" />);
    expect(listState()).toEqual({ query: '', compact: false, page: 0 });
  });
});
