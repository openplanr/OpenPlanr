// @vitest-environment jsdom

import {
  ActionPill,
  ChromeProvider,
  ChromeRoot,
  defaultChromeKeymap,
  FloatingToolbar,
  formatShortcut,
  MenuPill,
} from '@openplanr/canvas/react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chromePreferenceKey,
  createBrowserShellAdapters,
  type ShellAdapters,
} from '../../../../apps/dashboard/src/app/browser-preferences.js';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import {
  paletteShortcut,
  WelcomeLabels,
} from '../../../../apps/dashboard/src/features/shell/floating-chrome-parts.js';
import {
  clearInspector,
  selectInspector,
} from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import {
  LIST_TOOL_SHORTCUTS,
  SHORTCUT_MAP,
} from '../../../../apps/dashboard/src/features/shell/keyboard-coordinator.js';
import { usePublishRouteTools } from '../../../../apps/dashboard/src/features/shell/route-tools.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { DASHBOARD_ROUTE_FIXTURES } from '../e2e/fixtures/dashboard-route-catalog.js';

const PROJECT_ID = `sha256:${'c'.repeat(64)}`;
const binding = createDashboardQueryIdentity({
  productArea: 'operate',
  actorId: 'owner-bound',
  projectId: PROJECT_ID,
  scopeId: 'scope-bound',
  domainId: 'business',
  domainVersion: '1.0.0',
  cycleId: 'cyc_bound_12345678',
  route: '#/operate/today',
  subjectId: null,
  generation: 4,
  eventHead: { sequence: 1, hash: `sha256:${'a'.repeat(64)}` },
  viewHash: `sha256:${'b'.repeat(64)}`,
});

const SELECTION = {
  kind: 'node',
  id: 'QT-071',
  type: 'quick',
  title: 'Selected row',
  status: 'outstanding',
  sprintId: null,
  updated: null,
  dependsOn: [],
  ref: null,
  href: '#/detail/QT-071',
} as const;

function shell(hash: string, adapters?: ShellAdapters) {
  return (
    <DashboardProviders
      buildId="floating-chrome-test"
      initialHash={hash}
      bootPhase="compatible"
      connection={{ state: 'connected', label: 'Connected', reason: 'Validated fixture' }}
      binding={binding}
    >
      <UnifiedShell adapters={adapters} />
    </DashboardProviders>
  );
}

function slot(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-chrome-slot="${name}"]`);
  if (!element) throw new Error(`Missing ${name} slot`);
  return element;
}

function panelOpen(name: 'navigation' | 'sidebar'): boolean {
  return slot(name).getAttribute('data-open') === 'true';
}

function press(code: string, init: KeyboardEventInit = {}, target: Element = document.body) {
  const key = { BracketLeft: '[', BracketRight: ']', KeyZ: 'z', F6: 'F6' }[code] ?? code;
  return fireEvent.keyDown(target, { code, key, ...init });
}

function regionName(element: Element | null): string {
  if (!element) return 'none';
  return (
    element.closest<HTMLElement>('[data-chrome-slot]')?.dataset.chromeSlot ??
    (element.id || element.className)
  );
}

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1440);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  clearInspector();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('floating chrome slots', () => {
  it.each(DASHBOARD_ROUTE_FIXTURES.map(({ hash }) => hash))(
    'renders the menu, tool, action, sidebar and help slots on %s without a zoom pill',
    (hash) => {
      render(shell(hash));
      const menu = slot('menu');
      expect(within(menu).getByRole('button', { name: 'Menu' })).toBeTruthy();
      expect(menu.querySelector('.canvas-chrome-view-picker')?.textContent).not.toBe('');
      const toolbar = slot('toolbar');
      expect(within(toolbar).getByRole('button', { name: /^Search or run/u })).toBeTruthy();
      expect(within(toolbar).getByRole('button', { name: 'More tools' })).toBeTruthy();
      const action = slot('action');
      expect(action.querySelector('.pc-conn')?.textContent).toMatch(
        /^(Read-only|Governed actions)$/u,
      );
      expect(action.querySelector('.pc-chrome-live')).not.toBeNull();
      expect(within(action).getByRole('button', { name: 'Sidebar' })).toBeTruthy();
      expect(within(slot('sidebar')).getByRole('tab', { name: 'Outline' })).toBeTruthy();
      expect(within(slot('help')).getByRole('button', { name: 'Help' })).toBeTruthy();
      expect(document.querySelector('[data-chrome-slot="zoom"]')).toBeNull();
      expect(document.querySelector('.pc-topbar, .pc-mobile-nav')).toBeNull();
    },
  );

  it('keeps the phone top bar, bottom navigation and sheet below 600 px', () => {
    vi.stubGlobal('innerWidth', 599);
    render(shell('#/operate/today'));
    expect(document.querySelector('.canvas-chrome-root')).toBeNull();
    expect(document.querySelector('header.pc-topbar')).not.toBeNull();
    expect(screen.getByRole('navigation', { name: 'Mobile Operate navigation' })).toBeTruthy();
    act(() => selectInspector(SELECTION));
    expect(screen.getByRole('dialog', { name: 'Inspector' }).getAttribute('aria-modal')).toBe(
      'true',
    );
  });

  it('shows the Governed actions chip on Operate and Read-only on Plan', () => {
    const { rerender } = render(shell('#/operate/today'));
    expect(slot('action').querySelector('.pc-conn')?.textContent).toBe('Governed actions');
    rerender(shell('#/list'));
    expect(slot('action').querySelector('.pc-conn')?.textContent).toBe('Read-only');
  });
});

describe('floating panels', () => {
  it('starts closed and inert, opens from its toggles and becomes interactive', async () => {
    const user = userEvent.setup();
    render(shell('#/list'));
    for (const name of ['navigation', 'sidebar'] as const) {
      expect(panelOpen(name)).toBe(false);
      expect(slot(name).querySelector('[data-chrome-panel-content]')?.hasAttribute('inert')).toBe(
        true,
      );
    }
    await user.click(screen.getByRole('button', { name: 'List: show navigation' }));
    expect(panelOpen('navigation')).toBe(true);
    expect(
      slot('navigation').querySelector('[data-chrome-panel-content]')?.hasAttribute('inert'),
    ).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Sidebar' }));
    expect(panelOpen('sidebar')).toBe(true);
    expect(panelOpen('navigation')).toBe(true);
  });

  it('keeps one side panel at a time between 600 and 1099 px', async () => {
    vi.stubGlobal('innerWidth', 1024);
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 1099.97px)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const user = userEvent.setup();
    render(shell('#/list'));
    await user.click(screen.getByRole('button', { name: 'List: show navigation' }));
    expect(panelOpen('navigation')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Sidebar' }));
    expect(panelOpen('sidebar')).toBe(true);
    expect(panelOpen('navigation')).toBe(false);
    await user.click(within(slot('sidebar')).getByRole('button', { name: 'Pin sidebar' }));
    expect(document.querySelector('.pc-shell')?.hasAttribute('data-sidebar-inset')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'List: show navigation' }));
    expect(panelOpen('navigation')).toBe(true);
    expect(panelOpen('sidebar')).toBe(false);
    expect(document.querySelector('.pc-shell')?.hasAttribute('data-navigation-inset')).toBe(false);
    expect(document.querySelector('.pc-shell')?.hasAttribute('data-sidebar-inset')).toBe(false);
  });

  it('persists open and pinned state per project through the browser adapter', async () => {
    const user = userEvent.setup();
    const adapters = createBrowserShellAdapters();
    const first = render(shell('#/list', adapters));
    await user.click(screen.getByRole('button', { name: 'List: show navigation' }));
    await user.click(within(slot('navigation')).getByRole('button', { name: 'Pin navigation' }));
    expect(JSON.parse(localStorage.getItem(chromePreferenceKey(PROJECT_ID)) ?? '{}')).toEqual({
      'canvas.chrome.panel.navigation': { open: true, pinned: true },
    });
    expect(localStorage.length).toBe(1);
    first.unmount();
    render(shell('#/home', createBrowserShellAdapters()));
    expect(panelOpen('navigation')).toBe(true);
    expect(
      within(slot('navigation'))
        .getByRole('button', { name: 'Pin navigation' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(document.querySelector('.pc-shell')?.hasAttribute('data-navigation-inset')).toBe(true);
  });

  it.each(['{broken', '[]', '{"canvas.chrome.panel.sidebar":{"open":"yes","pinned":false}}'])(
    'recovers a corrupt saved value %s with closed panels and a visible notice',
    async (stored) => {
      localStorage.setItem(chromePreferenceKey(PROJECT_ID), stored);
      const user = userEvent.setup();
      render(shell('#/list', createBrowserShellAdapters()));
      expect(panelOpen('navigation')).toBe(false);
      expect(panelOpen('sidebar')).toBe(false);
      await user.click(screen.getByRole('button', { name: 'Help' }));
      expect(
        within(screen.getByRole('dialog', { name: 'Help and status' })).getByRole('status')
          .textContent,
      ).toContain('Panel layout could not be read in this browser');
      await user.click(screen.getByRole('button', { name: 'Sidebar' }));
      expect(panelOpen('sidebar')).toBe(true);
      expect(
        JSON.parse(localStorage.getItem(chromePreferenceKey(PROJECT_ID)) ?? '{}')[
          'canvas.chrome.panel.sidebar'
        ],
      ).toEqual({ open: true, pinned: false });
    },
  );

  it('marks the toggle for a selection, opens on inspect, and closes unpinned on Escape and outside press', async () => {
    const user = userEvent.setup();
    render(shell('#/operate/today'));
    const toggle = screen.getByRole('button', { name: 'Sidebar' });
    act(() => selectInspector(SELECTION, false));
    expect(toggle.querySelector('[data-inspector-pending]')).not.toBeNull();
    expect(panelOpen('sidebar')).toBe(false);
    act(() => selectInspector(SELECTION));
    expect(panelOpen('sidebar')).toBe(true);
    expect(screen.getByRole('region', { name: 'Inspector' })).toBeTruthy();
    expect(toggle.querySelector('[data-inspector-pending]')).toBeNull();
    await user.keyboard('{Escape}');
    expect(panelOpen('sidebar')).toBe(false);
    act(() => selectInspector(SELECTION));
    await user.click(screen.getByRole('main'));
    expect(panelOpen('sidebar')).toBe(false);
    act(() => selectInspector(SELECTION));
    expect(panelOpen('sidebar')).toBe(true);
    await user.click(within(slot('sidebar')).getByRole('button', { name: 'Pin sidebar' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('main'));
    expect(panelOpen('sidebar')).toBe(true);
  });
});

describe('floating chrome keyboard', () => {
  it('toggles each panel once per Alt bracket press and ignores the keys while typing', () => {
    render(shell('#/operate/today'));
    press('BracketRight', { altKey: true });
    expect(panelOpen('sidebar')).toBe(true);
    press('BracketLeft', { altKey: true });
    expect(panelOpen('navigation')).toBe(true);
    press('BracketRight', { altKey: true });
    press('BracketLeft', { altKey: true });
    expect(panelOpen('sidebar')).toBe(false);
    expect(panelOpen('navigation')).toBe(false);
    const input = document.createElement('input');
    document.querySelector('main')?.append(input);
    input.focus();
    press('BracketRight', { altKey: true }, input);
    press('KeyZ', { altKey: true }, input);
    expect(panelOpen('sidebar')).toBe(false);
    expect(document.querySelector('.canvas-chrome-root')?.getAttribute('data-chrome-hidden')).toBe(
      'false',
    );
    const plain = press('BracketLeft', {}, document.body);
    expect(plain).toBe(true);
    expect(panelOpen('navigation')).toBe(false);
  });

  it('hides every surface in focus mode and moves focus out of the hidden chrome', () => {
    render(shell('#/list'));
    const toggle = screen.getByRole('button', { name: 'Sidebar' });
    toggle.focus();
    press('KeyZ', { altKey: true }, toggle);
    const root = document.querySelector('.canvas-chrome-root');
    expect(root?.getAttribute('data-chrome-hidden')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('main'));
    press('KeyZ', { altKey: true }, document.activeElement ?? document.body);
    expect(root?.getAttribute('data-chrome-hidden')).toBe('false');
  });

  it('cycles F6 through skip link, menu, tool, action, main, sidebar and help', () => {
    render(shell('#/list'));
    press('BracketRight', { altKey: true });
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    skip.focus();
    const order = [regionName(document.activeElement)];
    for (let index = 0; index < 6; index += 1) {
      press('F6', {}, document.activeElement ?? document.body);
      order.push(regionName(document.activeElement));
    }
    expect(order).toEqual([
      'pc-skip-link',
      'menu',
      'toolbar',
      'action',
      'main-content',
      'sidebar',
      'help',
    ]);
    const back = [];
    for (let index = 0; index < 3; index += 1) {
      press('F6', { shiftKey: true }, document.activeElement ?? document.body);
      back.push(regionName(document.activeElement));
    }
    expect(back).toEqual(['sidebar', 'main-content', 'action']);
  });

  it('renders tool hints from the bindings the coordinator matches', () => {
    function ListTools() {
      usePublishRouteTools([
        {
          id: 'list.group.spec',
          label: 'Spec',
          group: 'group-by',
          active: true,
          shortcut: LIST_TOOL_SHORTCUTS.groupSpec,
          run: () => undefined,
        },
        {
          id: 'list.density',
          label: 'Compact density',
          icon: 'rows-3',
          shortcut: LIST_TOOL_SHORTCUTS.density,
          run: () => undefined,
        },
        {
          id: 'list.collapse',
          label: 'Collapse group',
          icon: 'chevron-up',
          shortcut: LIST_TOOL_SHORTCUTS.collapse,
          run: () => undefined,
        },
      ]);
      return null;
    }
    render(
      <>
        <ListTools />
        {shell('#/operate/today')}
      </>,
    );
    const toolbar = slot('toolbar');
    const hints = [...toolbar.querySelectorAll('.canvas-chrome-tool-shortcut')].map((hint) =>
      hint.textContent?.trim(),
    );
    expect(hints).toEqual([
      formatShortcut(paletteShortcut()),
      formatShortcut(LIST_TOOL_SHORTCUTS.groupSpec),
      formatShortcut(LIST_TOOL_SHORTCUTS.density),
      formatShortcut(LIST_TOOL_SHORTCUTS.collapse),
    ]);
    expect(
      within(toolbar).getByRole('button', { name: 'Spec 1' }).getAttribute('aria-pressed'),
    ).toBe('true');
    const keys = SHORTCUT_MAP.map(([binding]) => binding);
    for (const action of ['menu', 'sidebar', 'hideChrome'] as const)
      expect(keys).toContain(formatShortcut(defaultChromeKeymap[action]));
    expect(keys).toContain(
      `${formatShortcut(defaultChromeKeymap.nextRegion)} / ${formatShortcut(defaultChromeKeymap.previousRegion)}`,
    );
  });

  it('lists the chrome shortcuts in the help card from the live keymap', async () => {
    const user = userEvent.setup();
    render(shell('#/home'));
    await user.click(screen.getByRole('button', { name: 'Help' }));
    const card = screen.getByRole('dialog', { name: 'Help and status' });
    expect(
      [...within(card).getByRole('list', { name: 'Chrome shortcuts' }).querySelectorAll('li')].map(
        (row) => [row.querySelector('span')?.textContent, row.querySelector('kbd')?.textContent],
      ),
    ).toEqual([
      ['Next region', formatShortcut(defaultChromeKeymap.nextRegion)],
      ['Menu and navigation', formatShortcut(defaultChromeKeymap.menu)],
      ['Sidebar', formatShortcut(defaultChromeKeymap.sidebar)],
      ['Focus mode', formatShortcut(defaultChromeKeymap.hideChrome)],
    ]);
    await user.click(within(card).getByRole('button', { name: /^All shortcuts/u }));
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Help and status' })).toBeNull();
  });
});

describe('welcome labels', () => {
  it('anchors one label under each of the menu, tool and action pills', () => {
    const rects: Record<string, DOMRect> = {
      menu: new DOMRect(12, 12, 120, 40),
      toolbar: new DOMRect(676, 12, 88, 44),
      action: new DOMRect(1210, 12, 218, 40),
    };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return rects[this.dataset.chromeSlot ?? ''] ?? new DOMRect();
    });
    render(
      <ChromeProvider>
        <ChromeRoot>
          <MenuPill />
          <FloatingToolbar />
          <ActionPill />
          <WelcomeLabels />
        </ChromeRoot>
      </ChromeProvider>,
    );
    const label = (anchor: string) =>
      document.querySelector<HTMLElement>(`[data-welcome-anchor="${anchor}"]`);
    expect(label('menu')?.style.left).toBe('12px');
    expect(label('menu')?.style.top).toBe('60px');
    expect(label('toolbar')?.style.left).toBe('720px');
    expect(label('toolbar')?.style.top).toBe('64px');
    expect(label('action')?.style.right).toBe(`${window.innerWidth - 1428}px`);
    expect(label('menu')?.textContent).toContain('behind the menu');
  });
});
