// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { computeAccessibleName } from 'dom-accessibility-api';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import { parseDashboardRoute } from '../../../../apps/dashboard/src/app/router.js';
import {
  clearInspector,
  selectInspector,
} from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import {
  Inspector,
  NavRail,
  StatusBar,
  ThemeToggle,
  TopBar,
} from '../../../../apps/dashboard/src/features/shell/shell-navigation.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';

afterEach(() => {
  cleanup();
  clearInspector();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
  window.history.replaceState(null, '', '/');
  document.querySelector('[data-shell-name-test]')?.remove();
});

describe('responsive navigation', () => {
  it.each(['#/home', '#/operate/today'])(
    'keeps the same mobile destinations on %s',
    async (hash) => {
      const user = userEvent.setup();
      const route = parseDashboardRoute(hash);
      render(
        <NavRail
          route={route}
          product={route.product === 'operate' ? 'operate' : 'planning'}
          operateAvailable={false}
          onOpenPalette={() => undefined}
        />,
      );
      const navigation = screen.getByRole('navigation', { name: /^Mobile/u });
      const nav = within(navigation);
      const links = [...navigation.querySelectorAll(':scope > a')];
      expect(links.map((link) => link.textContent)).toEqual([
        'Home',
        'List',
        'Activity',
        'Operate',
      ]);
      await user.click(nav.getByText('More'));
      for (const label of [
        'Graph',
        'Board',
        'Sprints',
        'Search',
        'Inbox',
        'Actions',
        'Cycles',
        'Evidence',
        'Outcomes',
        'History',
        'Recovery',
        'Console',
        'Diagnostics',
      ]) {
        const link = nav.getByRole('link', { name: label });
        expect(parseDashboardRoute(link.getAttribute('href') ?? '').kind).not.toBe('not-found');
      }
      expect(nav.getByText('Record')).toBeTruthy();
      await user.click(nav.getByRole('link', { name: 'Evidence' }));
      expect(navigation.querySelector('details')?.open).toBe(false);
    },
  );

  it.each([
    ['#/home', false],
    ['#/list', false],
    ['#/graph', true],
    ['#/board', true],
    ['#/sprints', true],
    ['#/activity', true],
  ])('uses the artboard rail default on %s', (hash, compact) => {
    render(
      <NavRail
        route={parseDashboardRoute(hash)}
        product="planning"
        operateAvailable
        onOpenPalette={() => undefined}
      />,
    );
    expect(
      screen.getByRole('navigation', { name: 'Dashboard navigation' }).hasAttribute('data-compact'),
    ).toBe(compact);
  });

  it.each([
    ['#/home', 'Read-only'],
    ['#/operate/today', 'Governed actions'],
  ])('explains the authority of %s', async (hash, label) => {
    const user = userEvent.setup();
    render(
      <TopBar
        route={parseDashboardRoute(hash)}
        connectionState="connected"
        inspectorOpen={false}
        onToggleInspector={() => undefined}
        onOpenPalette={() => undefined}
      />,
    );
    await user.click(screen.getByText(label));
    fireEvent.focus(screen.getByText(label));
    expect(await screen.findByRole('tooltip')).toBeTruthy();
    if (label === 'Governed actions') expect(screen.queryByText('Read-only')).toBeNull();
  });
});

describe('injected theme preferences', () => {
  it('cycles and reports adapter save failures', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockImplementationOnce(() => {
      throw new Error('Storage unavailable');
    });
    render(<ThemeToggle preference={{ initialChoice: 'system', save }} />);
    await user.click(screen.getByRole('button', { name: /Theme: system/u }));
    expect(save).toHaveBeenLastCalledWith('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByRole('status').textContent).toContain('could not be saved');
    await user.click(screen.getByRole('button', { name: /Theme: light/u }));
    expect(save).toHaveBeenLastCalledWith('dark');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

it.each([390, 1024])(
  'opens the selected inspector as a modal at %s px and returns focus to the opener',
  async (width) => {
    vi.stubGlobal('innerWidth', width);
    const user = userEvent.setup();
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Inspect item
          </button>
          {open ? (
            <Inspector
              mode="selection"
              selection={{
                kind: 'node',
                id: 'item-one',
                type: 'task',
                title: 'Selected item',
                status: 'outstanding',
                sprintId: null,
                updated: null,
                dependsOn: [],
                ref: null,
                href: null,
              }}
              floating
              onClose={() => setOpen(false)}
            />
          ) : null}
        </>
      );
    }
    render(<Example />);
    const opener = screen.getByRole('button', { name: 'Inspect item' });
    await user.click(opener);
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Inspector' })).toBe(document.activeElement);
    await user.tab();
    const close = screen.getByRole('button', { name: 'Close inspector' });
    expect(document.activeElement).toBe(close);
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.click(screen.getByRole('button', { name: 'Close inspector' }));
    await act(async () => undefined);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    await user.click(opener);
    const overlay = document.querySelector('.pc-inspector-overlay');
    if (!overlay) throw new Error('Missing inspector dismissal overlay.');
    await user.click(overlay);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  },
);

const shellStyles = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../apps/dashboard/src/features/shell/console-shell.css',
  ),
  'utf8',
);

// jsdom does not evaluate viewport media queries; use the real stylesheet's applicable rules.
function applyShellStyles(width: number): void {
  const style = document.createElement('style');
  style.dataset.shellNameTest = '';
  style.textContent = shellStyles;
  document.head.append(style);
  const rules = Array.from(style.sheet?.cssRules ?? []);
  style.textContent = rules
    .flatMap((rule) => {
      if (!('media' in rule)) return [rule.cssText];
      const media = rule as CSSMediaRule;
      const widths = [...media.media.mediaText.matchAll(/\((min|max)-width:\s*(\d+)px\)/gu)];
      if (
        !widths.length ||
        !widths.every(([, direction, limit]) =>
          direction === 'min' ? width >= Number(limit) : width <= Number(limit),
        )
      )
        return [];
      return Array.from(media.cssRules, (child) => child.cssText);
    })
    .join('\n');
}

function visibleText(element: HTMLElement): string {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const text: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    let visible = true;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse'
      )
        visible = false;
    }
    if (visible && node.textContent?.trim()) text.push(node.textContent.trim());
  }
  return text.join(' ').replace(/\s+/gu, ' ').trim();
}

function renderNamedShell(width: number, hash: string) {
  vi.stubGlobal('innerWidth', width);
  applyShellStyles(width);
  return render(
    <DashboardProviders
      buildId="launcher-name-fixture"
      initialHash={hash}
      bootPhase="compatible"
      connection={{ state: 'connected', label: 'Connected', reason: 'Validated fixture' }}
    >
      <UnifiedShell />
    </DashboardProviders>,
  );
}

function assertLauncherNames(container: HTMLElement, width: number, compact: boolean): void {
  const buttons = container.querySelectorAll<HTMLButtonElement>(
    '.pc-rail__palette, .pc-topbar__palette',
  );
  expect(buttons.length).toBe(2);
  for (const button of buttons) {
    if (width < 900 && button.matches('.pc-rail__palette')) {
      expect(visibleText(button)).toBe('');
      expect(getComputedStyle(button.closest('nav') as HTMLElement).display).toBe('none');
      continue;
    }
    const text = visibleText(button);
    const name = computeAccessibleName(button);
    const iconOnly = button.matches('.pc-topbar__palette') ? width < 1200 : width < 900 || compact;
    if (iconOnly) {
      expect(text).toBe('');
      expect(name).toBe(button.getAttribute('aria-label'));
      expect(name.length).toBeGreaterThan(0);
    } else {
      expect(text).toContain('⌘K');
      expect(
        name.startsWith(text),
        `computed name ${JSON.stringify(name)} must begin with visible text ${JSON.stringify(text)}`,
      ).toBe(true);
      expect(button.hasAttribute('aria-label')).toBe(false);
    }
  }
}

describe('shell accessible launcher names', () => {
  it.each([
    [1440, '#/home', false],
    [1440, '#/operate/today', false],
    [1024, '#/graph', true],
    [1120, '#/board', true],
    [900, '#/operate/today', false],
    [899, '#/operate/today', false],
    [390, '#/operate/today', false],
    [320, '#/operate/today', false],
  ] as const)(
    'compares actual shell launcher names and visible text at %i px on %s',
    async (width, hash, compact) => {
      const { container } = renderNamedShell(width, hash);
      assertLauncherNames(container, width, compact);
      const result = await axe.run(container, {
        runOnly: { type: 'rule', values: ['button-name', 'label-content-name-mismatch'] },
      });
      expect(result.violations).toEqual([]);
    },
  );

  it('updates naming at the mobile breakpoint on the mounted shell', () => {
    const { container } = renderNamedShell(1440, '#/home');
    assertLauncherNames(container, 1440, false);
    document.querySelector('[data-shell-name-test]')?.remove();
    applyShellStyles(390);
    act(() => {
      vi.stubGlobal('innerWidth', 390);
      window.dispatchEvent(new Event('resize'));
    });
    assertLauncherNames(container, 390, false);
    document.querySelector('[data-shell-name-test]')?.remove();
    applyShellStyles(900);
    act(() => {
      vi.stubGlobal('innerWidth', 900);
      window.dispatchEvent(new Event('resize'));
    });
    assertLauncherNames(container, 900, false);
  });
});

it.each(['#/home', '#/operate/today'])(
  'reaches the named mobile Inbox link through More by touch and keyboard on %s',
  async (hash) => {
    const user = userEvent.setup();
    const route = parseDashboardRoute(hash);
    render(
      <NavRail
        route={route}
        product={route.product === 'operate' ? 'operate' : 'planning'}
        operateAvailable
        onOpenPalette={() => undefined}
      />,
    );
    const navigation = screen.getByRole('navigation', { name: /^Mobile/u });
    const summary = within(navigation).getByText('More').closest('summary');
    if (!summary) throw new Error('Missing More control');
    const details = summary.closest('details');
    expect(details?.open).toBe(false);
    const sheet = document.getElementById(summary.getAttribute('aria-controls') ?? '');
    expect(sheet?.classList.contains('pc-mobile-more__sheet')).toBe(true);
    await user.pointer({ target: summary, keys: '[TouchA]' });
    await waitFor(() => expect(details?.open).toBe(true));
    const operate = within(navigation).getByRole('region', { name: 'Operate' });
    const inbox = within(operate).getByRole('link', { name: 'Inbox', exact: true });
    expect(inbox.getAttribute('href')).toBe('#/operate/inbox');
    summary.focus();
    for (let index = 0; index < 20 && document.activeElement !== inbox; index++) await user.tab();
    expect(document.activeElement).toBe(inbox);
    await user.pointer({ target: inbox, keys: '[TouchA]' });
    await waitFor(() => expect(window.location.hash).toBe('#/operate/inbox'));
    expect(details?.open).toBe(false);
  },
);

describe('route-independent rail presentation', () => {
  function shell(
    hash: string,
    adapters?: import('../../../../apps/dashboard/src/app/browser-preferences.js').ShellAdapters,
  ) {
    return (
      <DashboardProviders
        buildId="rail-fixture"
        initialHash={hash}
        bootPhase="compatible"
        connection={{ state: 'connected', label: 'Connected', reason: 'Validated fixture' }}
      >
        <UnifiedShell adapters={adapters} />
      </DashboardProviders>
    );
  }

  it.each([false, true])(
    'keeps the user compact preference %s through route changes at 1440 px',
    async (initialCompact) => {
      vi.stubGlobal('innerWidth', 1440);
      applyShellStyles(1440);
      const save = vi.fn();
      const adapters = {
        loadSingleLetters: () => true,
        saveSingleLetters: () => undefined,
        copy: async () => undefined,
        railPreference: { initialCompact, save },
      };
      const { container, rerender } = render(shell('#/list', adapters));
      const rail = container.querySelector<HTMLElement>('.pc-rail');
      if (!rail) throw new Error('Expected desktop rail');
      const initialWidth = getComputedStyle(rail).width;
      for (const hash of ['#/board', '#/list', '#/graph', '#/home', '#/list']) {
        rerender(shell(hash, adapters));
        expect(container.querySelector('.pc-rail')).toBe(rail);
        expect(rail.hasAttribute('data-compact')).toBe(initialCompact);
        expect(getComputedStyle(rail).width).toBe(initialWidth);
      }
      expect(save).not.toHaveBeenCalled();
      await userEvent.setup().click(
        screen.getByRole('button', {
          name: initialCompact ? 'Expand navigation' : 'Collapse navigation',
        }),
      );
      expect(save).toHaveBeenCalledExactlyOnceWith(!initialCompact);
      const chosenWidth = getComputedStyle(rail).width;
      expect(chosenWidth).not.toBe(initialWidth);
      rerender(shell('#/board', adapters));
      expect(rail.hasAttribute('data-compact')).toBe(!initialCompact);
      expect(getComputedStyle(rail).width).toBe(chosenWidth);
    },
  );

  it('surfaces denied persistence while keeping the explicit toggle usable', async () => {
    vi.stubGlobal('innerWidth', 1440);
    applyShellStyles(1440);
    const save = vi.fn(() => {
      throw new Error('denied');
    });
    render(
      shell('#/list', {
        loadSingleLetters: () => true,
        saveSingleLetters: () => undefined,
        copy: async () => undefined,
        railPreference: { initialCompact: false, initialStorageError: true, save },
      }),
    );
    expect(
      screen.getByText('Navigation preference could not be read in this browser.'),
    ).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeTruthy();
    expect(
      screen.getByText(
        'Navigation preference could not be saved. It applies until this page is closed.',
      ),
    ).toBeTruthy();
  });

  it('keeps breadcrumb, palette and connection tracks stable through bootstrap', () => {
    vi.stubGlobal('innerWidth', 1440);
    applyShellStyles(1440);
    const topbar = (projectName: string, connectionState: 'booting' | 'connected') => (
      <TopBar
        projectName={projectName}
        connectionState={connectionState}
        route={parseDashboardRoute('#/list')}
        inspectorOpen={false}
        onToggleInspector={() => undefined}
        onOpenPalette={() => undefined}
      />
    );
    const { container, rerender } = render(topbar('OpenPlanr', 'booting'));
    const tracks = () =>
      [
        ...container.querySelectorAll<HTMLElement>(
          '.pc-topbar__crumb, .pc-topbar__palette, .pc-topbar__end',
        ),
      ].map((element) => ({
        width: getComputedStyle(element).width,
        basis: getComputedStyle(element).flexBasis,
      }));
    const before = tracks();
    const header = container.querySelector('header');
    if (!header) throw new Error('Missing topbar');
    expect(getComputedStyle(header).display).toBe('grid');
    expect(getComputedStyle(header).gridTemplateColumns).toBe('minmax(0, 1fr) 300px 482px');
    rerender(topbar('app', 'connected'));
    expect(tracks()).toEqual(before);
  });
});

it.each([
  [1440, 'minmax(0, 1fr) 300px 482px'],
  [1024, 'minmax(0, 1fr) 44px 320px'],
  [390, 'minmax(0, 1fr) 88px 44px'],
])('keeps the topbar grid independent of route text at %i px', (width, columns) => {
  applyShellStyles(Number(width));
  const topbar = (hash: string) => (
    <TopBar
      route={parseDashboardRoute(hash)}
      connectionState="connected"
      inspectorOpen={false}
      showSubject
      onToggleInspector={() => undefined}
      onOpenPalette={() => undefined}
    />
  );
  const { container, rerender } = render(topbar('#/list'));
  for (const hash of ['#/list', '#/board', '#/graph', '#/operate/today', '#/detail/item-one']) {
    rerender(topbar(hash));
    const header = container.querySelector('header');
    if (!header) throw new Error('Missing topbar');
    expect(getComputedStyle(header).display).toBe('grid');
    expect(getComputedStyle(header).gridTemplateColumns).toBe(columns);
    expect([...header.children].map((element) => element.className)).toEqual([
      'pc-topbar__breadcrumbs',
      'pc-topbar__palette',
      'pc-topbar__actions',
    ]);
  }
});

it('inserts shell bootstrap text into empty reserved slots without replacing placeholders', () => {
  applyShellStyles(1440);
  const route = parseDashboardRoute('#/list');
  const shell = (branch: string | null, nodeCount: number | null, edgeCount: number | null) => (
    <>
      <NavRail
        product="planning"
        route={route}
        operateAvailable
        compact={false}
        branch={branch}
        onOpenPalette={() => undefined}
      />
      <TopBar
        projectName={branch === null ? undefined : 'Verified project'}
        route={route}
        connectionState={branch === null ? 'booting' : 'connected'}
        inspectorOpen={false}
        onToggleInspector={() => undefined}
        onOpenPalette={() => undefined}
      />
      <StatusBar
        branch={branch}
        nodeCount={nodeCount}
        edgeCount={edgeCount}
        connectionState={branch === null ? 'booting' : 'connected'}
        buildId="bootstrap-test"
      />
    </>
  );
  const { container, rerender } = render(shell(null, null, null));
  const branch = container.querySelector('.pc-rail__branch');
  const totals = container.querySelector('.pc-statusbar__item--totals .pc-statusbar__text');
  if (!branch || !totals) throw new Error('Missing reserved shell text slots');
  for (const slot of container.querySelectorAll(
    '.pc-rail__branch, .pc-statusbar__item .pc-statusbar__text, .pc-watcher__label',
  )) {
    expect(slot.childNodes.length).toBe(0);
    expect(getComputedStyle(slot).height).toBe('16px');
  }
  const connection = container.querySelector('.pc-conn--watcher');
  if (!connection) throw new Error('Missing connection chip');
  expect([...connection.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE)).toEqual([]);
  const observer = new MutationObserver(() => undefined);
  observer.observe(container, { childList: true, characterData: true, subtree: true });
  rerender(shell('main', 12, null));
  expect(branch.textContent).toBe('main · .planr/');
  expect(branch.childNodes.length).toBe(1);
  expect(totals.childNodes.length).toBe(0);
  expect(container.querySelector('.pc-conn--watcher')?.textContent).toBe('Live · watching .planr/');
  expect(container.querySelector('.pc-watcher__label')?.textContent).toBe('watcher connected');
  expect(container.querySelector('.pc-topbar__crumb')?.textContent).toBe('Plan');
  rerender(shell('main', 12, 0));
  expect(totals.textContent).toBe('12 nodes · 0 edges');
  expect(observer.takeRecords().filter((record) => record.type === 'characterData')).toEqual([]);
  observer.disconnect();
});

it.each([900, 1024, 1120])('keeps the rail toggle separate from destinations at %i px', (width) => {
  const { container } = renderNamedShell(width, '#/operate/today');
  const rail = container.querySelector('.pc-rail');
  expect(
    [...(rail?.querySelectorAll('.pc-rail__item > span:last-child') ?? [])].map(
      (element) => element.textContent,
    ),
  ).toEqual([
    'Home',
    'List',
    'Graph',
    'Board',
    'Sprints',
    'Activity',
    'Search',
    'Today',
    'Inbox',
    'Actions',
    'Cycles',
    'Evidence',
    'Outcomes',
    'History',
    'Recovery',
    'Console',
    'Diagnostics',
  ]);
  const toggle = screen.getByRole('button', { name: 'Collapse navigation' });
  expect(toggle.closest('.pc-rail__footer')).toBeTruthy();
  expect(toggle.closest('.pc-rail__sections')).toBeNull();
  expect(toggle.matches('.pc-rail__item')).toBe(false);
});

it('keeps mobile utilities reachable through More with 44 px hit targets', async () => {
  const { container, rerender } = renderNamedShell(390, '#/operate/today');
  const more = screen.getByText('More', { exact: true });
  await userEvent.setup().click(more);
  const utilities = container.querySelector<HTMLElement>('.pc-mobile-more__controls');
  if (!utilities) throw new Error('Missing mobile utilities');
  const capability = within(utilities).getByRole('button', { name: 'Governed actions' });
  expect(getComputedStyle(capability).minHeight).toBe('44px');
  expect(within(utilities).getByRole('button', { name: /^Theme:/u })).toBeTruthy();
  expect(within(utilities).getByRole('button', { name: /Show inspector/u })).toBeTruthy();
  await userEvent.setup().click(within(utilities).getByRole('button', { name: /^Theme:/u }));
  expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  rerender(
    <DashboardProviders
      buildId="launcher-name-fixture"
      initialHash="#/home"
      bootPhase="compatible"
      connection={{ state: 'connected', label: 'Connected', reason: 'Validated fixture' }}
    >
      <UnifiedShell />
    </DashboardProviders>,
  );
  await userEvent.setup().click(screen.getByText('More', { exact: true }));
  expect(within(utilities).getByRole('button', { name: 'Read-only' })).toBeTruthy();
  document.querySelector('[data-shell-name-test]')?.remove();
  applyShellStyles(1440);
  act(() => {
    vi.stubGlobal('innerWidth', 1440);
    window.dispatchEvent(new Event('resize'));
  });
  expect(screen.getByRole('button', { name: 'Theme: light. Switch to dark.' })).toBeTruthy();
});

it('opens only a selected inspector over the existing main content', async () => {
  const { container } = renderNamedShell(1440, '#/list');
  const main = container.querySelector('.pc-shell__main');
  expect(screen.queryByRole('dialog', { name: 'Inspector' })).toBeNull();
  expect(container.querySelector('.pc-shell__inspector-slot')).toBeNull();
  expect(
    screen
      .getByRole('button', { name: 'Show inspector: select an item first' })
      .hasAttribute('disabled'),
  ).toBe(true);
  act(() =>
    selectInspector({
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
    }),
  );
  const panel = screen.getByRole('dialog', { name: 'Inspector' });
  expect(panel.getAttribute('aria-modal')).not.toBe('true');
  expect(panel.closest('.pc-shell__plane')).toBeNull();
  expect(container.querySelector('.pc-shell__main')).toBe(main);
  await userEvent.setup().keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: 'Inspector' })).toBeNull();
  expect(container.querySelector('.pc-shell__main')).toBe(main);
});

it.each([390, 1024, 1440])('does not open an empty inspector overlay at %s px', (width) => {
  const { container } = renderNamedShell(width, '#/operate/today');
  const toggle = screen.getByRole('button', { name: 'Show inspector: select an item first' });
  expect((toggle as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(toggle);
  expect(screen.queryByRole('dialog', { name: 'Inspector' })).toBeNull();
  expect(container.querySelector('.pc-shell-inspector')).toBeNull();
});

it.each([
  ['#/graph', ['Home', 'List', 'Graph', 'Board', 'Sprints', 'Activity'], ['Plan']],
  [
    '#/operate/today',
    ['Today', 'Inbox', 'Actions', 'Cycles', 'Evidence', 'Outcomes', 'History', 'Recovery'],
    ['Work', 'Record'],
  ],
] as const)(
  'limits the compact rail to the current product on %s and expands to every destination',
  async (hash, labels, groups) => {
    vi.stubGlobal('innerWidth', 1440);
    applyShellStyles(1440);
    render(
      <DashboardProviders
        initialHash={hash}
        buildId="compact-product-test"
        bootPhase="compatible"
        connection={{ state: 'connected', label: 'Connected', reason: 'Validated fixture' }}
      >
        <UnifiedShell
          adapters={{
            loadSingleLetters: () => true,
            saveSingleLetters: () => undefined,
            copy: async () => undefined,
            railPreference: { initialCompact: true, save: () => undefined },
          }}
        />
      </DashboardProviders>,
    );
    const rail = screen.getByRole('navigation', { name: 'Dashboard navigation' });
    expect(
      within(rail)
        .getAllByRole('link')
        .map((link) => computeAccessibleName(link)),
    ).toEqual([...labels]);
    expect(
      within(rail)
        .getAllByRole('region')
        .map((group) => computeAccessibleName(group)),
    ).toEqual([...groups]);
    expect(within(rail).getByRole('button', { name: 'Search or jump' })).toBeTruthy();
    await userEvent.setup().click(within(rail).getByRole('button', { name: 'Expand navigation' }));
    for (const label of ['Home', 'Search', 'Today', 'Evidence', 'Console', 'Diagnostics'])
      expect(within(rail).getByRole('link', { name: label, exact: true })).toBeTruthy();
  },
);

it('shows the logo, page title, Live indicator and one search control in the mobile topbar', () => {
  const { container } = renderNamedShell(390, '#/home');
  const topbar = container.querySelector<HTMLElement>('.pc-topbar');
  if (!topbar) throw new Error('Missing topbar');
  for (const element of topbar.querySelectorAll<HTMLElement>(
    '.pc-topbar__crumb, .pc-topbar__separator, .pc-topbar__subject',
  ))
    expect(visibleText(element)).toBe('');
  expect(visibleText(topbar.querySelector<HTMLElement>('.pc-topbar__view') as HTMLElement)).toBe(
    'Home',
  );
  const controls = topbar.querySelectorAll<HTMLElement>(
    '.pc-topbar__palette, .pc-topbar__end > button.pc-conn, .pc-icon-button',
  );
  expect(controls).toHaveLength(1);
  const styles = [...controls].map((control) => getComputedStyle(control));
  for (const style of styles) {
    expect(style.width).toBe('44px');
    expect(style.height).toBe('44px');
    expect(style.borderRadius).toBe(styles[0].borderRadius);
    expect(style.backgroundColor).toBe(styles[0].backgroundColor);
    expect(style.border).toBe(styles[0].border);
  }
  expect(getComputedStyle(topbar.querySelector('.pc-topbar__logo') as Element).display).toBe(
    'block',
  );
  expect(visibleText(topbar.querySelector('.pc-conn--watcher') as HTMLElement)).toBe('Live');
  const tab = container.querySelector<HTMLElement>('.pc-mobile-nav__item[aria-current="page"]');
  if (!tab) throw new Error('Missing active mobile tab');
  expect(getComputedStyle(tab).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(getComputedStyle(tab).color).not.toBe(
    getComputedStyle(tab.querySelector('svg') as Element).color,
  );
  const status = container.querySelector<HTMLElement>('.pc-statusbar .pc-watcher');
  expect(visibleText(status as HTMLElement)).toBe('Live');
  expect(computeAccessibleName(status as HTMLElement)).toBe('watcher connected');
});

it.each([false, true])(
  'keeps counted rail names consistent with visible labels when compact=%s',
  async (compact) => {
    applyShellStyles(1440);
    const { container } = render(
      <NavRail
        route={parseDashboardRoute('#/home')}
        product="planning"
        operateAvailable
        compact={compact}
        counts={{ 'planning.overview': 45, 'planning.list': 708, 'planning.activity': 18 }}
        onOpenPalette={() => undefined}
      />,
    );
    const rail = screen.getByRole('navigation', { name: 'Dashboard navigation' });
    for (const link of within(rail).getAllByRole('link')) {
      if (compact) expect(computeAccessibleName(link)).toBe(link.getAttribute('title'));
      else expect(computeAccessibleName(link)).toBe(visibleText(link));
    }
    expect(
      (
        await axe.run(container, {
          runOnly: { type: 'rule', values: ['label-content-name-mismatch'] },
        })
      ).violations,
    ).toEqual([]);
  },
);

it('keeps hostile project identity as an escaped title without executable elements', () => {
  const hostile = '<img src=x onerror="window.__fixtureXssFired=1"> Fixture';
  const { container } = render(
    <TopBar
      projectName={hostile}
      route={parseDashboardRoute('#/home')}
      connectionState="connected"
      inspectorOpen={false}
      onToggleInspector={() => undefined}
      onOpenPalette={() => undefined}
    />,
  );
  const identity = container.querySelector('.pc-topbar__crumb');
  expect(identity?.textContent).toBe('Plan');
  expect(identity?.getAttribute('title')).toBe(hostile);
  expect(container.querySelector('img[src="x"]')).toBeNull();
  expect(Reflect.get(window, '__fixtureXssFired')).toBeUndefined();
});

it('renders one live status label when crossing the mobile breakpoint', () => {
  const { container } = renderNamedShell(1440, '#/home');
  const status = within(container).getByRole('status', { name: 'watcher connected' });
  expect(status.querySelectorAll('.pc-watcher__label')).toHaveLength(1);
  expect(status.querySelector('.pc-watcher__label')?.textContent).toBe('watcher connected');
  act(() => {
    vi.stubGlobal('innerWidth', 390);
    window.dispatchEvent(new Event('resize'));
  });
  expect(status.querySelectorAll('.pc-watcher__label')).toHaveLength(1);
  expect(status.querySelector('.pc-watcher__label')?.textContent).toBe('Live');
  expect(computeAccessibleName(status)).toBe('watcher connected');
});
