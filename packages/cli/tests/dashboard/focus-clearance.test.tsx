// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import {
  entirelyHidden,
  pinnedPanelCoversFocus,
  visibleFraction,
} from '../../../../apps/dashboard/src/features/shell/focus-clearance.js';
import {
  clearInspector,
  selectInspector,
} from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

const binding = createDashboardQueryIdentity({
  productArea: 'operate',
  actorId: 'owner-bound',
  projectId: `sha256:${'d'.repeat(64)}`,
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
  id: 'QT-001',
  type: 'quick',
  title: 'Covered row',
  status: 'outstanding',
  sprintId: null,
  updated: null,
  dependsOn: [],
  ref: null,
  href: '#/detail/QT-001',
} as const;

type Rect = Readonly<{ left: number; top: number; right: number; bottom: number }>;
const SIDEBAR: Rect = { left: 1100, top: 16, right: 1424, bottom: 884 };
const UNDER_SIDEBAR: Rect = { left: 1120, top: 400, right: 1300, bottom: 440 };
const MOSTLY_CLEAR: Rect = { left: 600, top: 400, right: 1200, bottom: 440 };
const MOSTLY_COVERED: Rect = { left: 1090, top: 400, right: 1300, bottom: 440 };

function slot(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-chrome-slot="${name}"]`);
  if (!element) throw new Error(`Missing ${name} slot`);
  return element;
}

function sidebarOpen(): boolean {
  return slot('sidebar').getAttribute('data-open') === 'true';
}

/**
 * Renders the shell with one focus target in `parent` whose box is `box`; chrome slots take
 * `slots`, and the box follows the page scroller's `scrollTop` from `scrolled`.
 */
function renderWithTarget(
  box: Rect,
  slots: Readonly<Record<string, Rect>> = { sidebar: SIDEBAR },
  parent = '#main-content',
  scrolled = 0,
): HTMLButtonElement {
  render(
    <DashboardProviders
      buildId="focus-clearance-test"
      initialHash="#/operate/today"
      bootPhase="compatible"
      connection={{ state: 'connected', label: 'Connected', reason: 'Validated fixture' }}
      binding={binding}
    >
      <UnifiedShell />
    </DashboardProviders>,
  );
  const host = document.querySelector(parent);
  if (!host) throw new Error(`Missing ${parent}`);
  const target = document.createElement('button');
  target.textContent = 'Covered row';
  target.dataset.keyboardItem = 'QT-001';
  host.append(target);
  const scroller = document.querySelector<HTMLElement>('.pc-shell__scroll');
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const offset = this === target ? scrolled - (scroller?.scrollTop ?? 0) : 0;
    const rect =
      this === target
        ? box
        : this === scroller
          ? { left: 0, top: 0, right: 1440, bottom: 900 }
          : (slots[this.dataset.chromeSlot ?? ''] ?? { left: 0, top: 0, right: 0, bottom: 0 });
    return DOMRect.fromRect({
      x: rect.left,
      y: rect.top + offset,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
    });
  });
  return target;
}

function openSidebar(): void {
  fireEvent.keyDown(document.body, { code: 'BracketRight', key: ']', altKey: true });
  expect(sidebarOpen()).toBe(true);
}

/** Lets the handler's measuring frame run. */
async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
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

describe('visible area of focus beside chrome', () => {
  it('counts overlapping covers once', () => {
    const box = { left: 0, top: 0, right: 100, bottom: 10 };
    const covers = [
      { left: 50, top: -10, right: 200, bottom: 20 },
      { left: 60, top: 0, right: 120, bottom: 10 },
    ];
    expect(visibleFraction(box, covers)).toBe(0.5);
    expect(visibleFraction(box, [])).toBe(1);
    expect(entirelyHidden(box, covers)).toBe(false);
  });

  it('counts focus as hidden only when no part of it is visible', () => {
    const box = { left: 10.1, top: 0.1, right: 110.7, bottom: 40.3 };
    // Two covers meeting at a fractional edge leave rounding, not area, uncovered.
    const halves = [
      { left: 0, top: 0, right: 33.7, bottom: 60 },
      { left: 33.7, top: 0, right: 200, bottom: 60 },
    ];
    expect(visibleFraction(box, halves)).toBeGreaterThan(0);
    expect(entirelyHidden(box, halves)).toBe(true);
    // A one-pixel sliver is still visible focus.
    expect(entirelyHidden(box, [{ left: 11.1, top: 0, right: 200, bottom: 60 }])).toBe(false);
  });
});

describe('focus under floating chrome', () => {
  it('closes an unpinned sidebar over a keyboard item focused without scrolling and keeps focus', async () => {
    const target = renderWithTarget(UNDER_SIDEBAR);
    openSidebar();
    act(() => target.focus({ preventScroll: true }));
    await nextFrame();
    expect(sidebarOpen()).toBe(false);
    expect(document.activeElement).toBe(target);
  });

  it('closes an unpinned navigation panel on the left over focused content and keeps focus', async () => {
    const target = renderWithTarget(
      { left: 40, top: 400, right: 200, bottom: 440 },
      { navigation: { left: 16, top: 16, right: 280, bottom: 884 } },
    );
    fireEvent.keyDown(document.body, { code: 'BracketLeft', key: '[', altKey: true });
    expect(slot('navigation').getAttribute('data-open')).toBe('true');
    act(() => target.focus({ preventScroll: true }));
    await nextFrame();
    expect(slot('navigation').getAttribute('data-open')).toBe('false');
    expect(document.activeElement).toBe(target);
  });

  it('scrolls the page within its range to clear a top pill over focused content', async () => {
    const target = renderWithTarget(
      { left: 40, top: 20, right: 200, bottom: 50 },
      { menu: { left: 16, top: 16, right: 300, bottom: 56 } },
      '.pc-shell__scroll',
      200,
    );
    const scroller = document.querySelector<HTMLElement>('.pc-shell__scroll');
    if (!scroller) throw new Error('Missing page scroller');
    let scrollTop = 200;
    Object.defineProperties(scroller, {
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
      scrollHeight: { configurable: true, value: 3000 },
      clientHeight: { configurable: true, value: 900 },
    });
    scroller.style.overflowY = 'auto';
    act(() => target.focus({ preventScroll: true }));
    await nextFrame();
    // Clears the pill's bottom edge by the kit's 12 px safe-area inset.
    expect(scrollTop).toBe(200 - (56 + 12 - 20));
    expect(target.getBoundingClientRect().top).toBe(68);
    expect(document.activeElement).toBe(target);
  });

  it('leaves a pinned sidebar to its branch point without reflowing the page', async () => {
    const target = renderWithTarget(UNDER_SIDEBAR);
    openSidebar();
    act(() => within(slot('sidebar')).getByRole('button', { name: 'Pin sidebar' }).click());
    const scroll = document.querySelector<HTMLElement>('.pc-shell__scroll');
    const before = scroll?.getAttribute('style') ?? null;
    act(() => target.focus({ preventScroll: true }));
    await nextFrame();
    expect(sidebarOpen()).toBe(true);
    expect(document.activeElement).toBe(target);
    expect(scroll?.getAttribute('style') ?? null).toBe(before);
    expect(pinnedPanelCoversFocus('sidebar', target)).toBe(false);
  });

  it('does not flap: a pressed item and a panel opened with the focus keep the panel open', async () => {
    const pressed = renderWithTarget(UNDER_SIDEBAR);
    openSidebar();
    fireEvent.pointerDown(pressed);
    act(() => pressed.focus({ preventScroll: true }));
    await nextFrame();
    expect(sidebarOpen()).toBe(true);

    fireEvent.keyDown(document.body, { code: 'BracketRight', key: ']', altKey: true });
    expect(sidebarOpen()).toBe(false);
    fireEvent.keyDown(pressed, { key: 'Enter', code: 'Enter' });
    act(() => pressed.focus({ preventScroll: true }));
    await nextFrame();
    // Inspecting the focused row opens the sidebar over it and the shell refocuses the row.
    act(() => selectInspector(SELECTION));
    expect(sidebarOpen()).toBe(true);
    await nextFrame();
    expect(document.activeElement).toBe(pressed);
    expect(sidebarOpen()).toBe(true);
  });

  it.each([
    ['mostly clear', MOSTLY_CLEAR],
    ['mostly covered', MOSTLY_COVERED],
  ])('leaves the panel open while part of the focused item stays visible: %s', async (_, box) => {
    const target = renderWithTarget(box);
    openSidebar();
    act(() => target.focus({ preventScroll: true }));
    await nextFrame();
    expect(sidebarOpen()).toBe(true);
  });
});
