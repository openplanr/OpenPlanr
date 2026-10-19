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
  Inspector,
  NavRail,
  ThemeToggle,
  TopBar,
} from '../../../../apps/dashboard/src/features/shell/shell-navigation.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';

afterEach(() => {
  cleanup();
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
    ['#/graph', false],
    ['#/board', false],
  ])('keeps the default expanded rail on %s', (hash, compact) => {
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

it('opens the mobile inspector as a modal and returns focus to the opener', async () => {
  vi.stubGlobal('innerWidth', 390);
  const user = userEvent.setup();
  function Example() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Inspect item
        </button>
        {open ? (
          <Inspector mode="selection" selection={null} floating onClose={() => setOpen(false)} />
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
});

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
      expect(text).toContain('⌘ K');
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
    [1024, '#/graph', false],
    [1120, '#/board', false],
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

  it('reserves project, product, palette and connection tracks before bootstrap resolves', () => {
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
    expect(before.map((track) => track.basis)).toEqual(['12ch', '8ch', '300px', '38ch']);
    rerender(topbar('app', 'connected'));
    expect(tracks()).toEqual(before);
  });
});

it.each([900, 1024, 1120])('keeps the rail toggle separate from destinations at %i px', (width) => {
  const { container } = renderNamedShell(width, '#/operate/today');
  const rail = container.querySelector('.pc-rail');
  expect(
    [...(rail?.querySelectorAll('.pc-rail__item > span:last-child') ?? [])].map(
      (element) => element.textContent,
    ),
  ).toEqual([
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

it('constrains the mobile capability control to its 44 px hit slot', () => {
  const { container } = renderNamedShell(390, '#/operate/today');
  const capability = container.querySelector<HTMLElement>('.pc-topbar__end > button.pc-conn');
  expect(capability).toBeTruthy();
  expect(getComputedStyle(capability as HTMLElement).flexBasis).toBe('44px');
  expect(getComputedStyle(capability as HTMLElement).width).toBe('44px');
});

it('keeps the nonmodal inspector outside the main flex layout', async () => {
  const { container } = renderNamedShell(1440, '#/list');
  const inspector = screen.getByRole('complementary', { name: 'Inspector' });
  const main = container.querySelector('.pc-shell__main');
  expect(getComputedStyle(inspector).position).toBe('absolute');
  expect(inspector.parentElement).toBe(main?.parentElement);
  expect(inspector.getAttribute('aria-modal')).toBeNull();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Hide inspector' }));
  expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
  expect(container.querySelector('.pc-shell__main')).toBe(main);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Show inspector' }));
  expect(getComputedStyle(screen.getByRole('complementary', { name: 'Inspector' })).position).toBe(
    'absolute',
  );
  expect(container.querySelector('.pc-shell__main')).toBe(main);
});
