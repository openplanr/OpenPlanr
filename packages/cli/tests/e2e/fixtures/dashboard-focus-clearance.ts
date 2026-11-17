import { expect, type Locator, type Page, test } from '@playwright/test';
import { FOCUS_HIDDEN_SHARE } from '../../../../../apps/dashboard/src/features/shell/focus-clearance.js';
import { installDashboardLayoutShifts } from '../../dashboard/fixtures/dashboard-layout-shifts.js';
import { settleGraph } from './dashboard-graph-canvas.js';

type OpenFixture = (
  page: Page,
  route: string,
  options?: Readonly<Record<string, string>>,
) => Promise<void>;
type FocusReport = Readonly<{ id: string; visible: number; covered: boolean }>;

const WIDTHS = [1440, 1024] as const;

/** Share of the focused element left visible by open chrome, measured after the remedy's frame. */
function focusReport(page: Page): Promise<FocusReport> {
  return page.evaluate(async () => {
    for (let frame = 0; frame < 3; frame += 1)
      await new Promise((resolve) => requestAnimationFrame(resolve));
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) throw new Error('Nothing is focused.');
    const box = active.getBoundingClientRect();
    const covers = Array.from(
      document.querySelectorAll<HTMLElement>('.canvas-chrome-root [data-chrome-slot]'),
    )
      .filter(
        (slot) =>
          !slot.hidden &&
          !slot.inert &&
          getComputedStyle(slot).visibility !== 'hidden' &&
          slot.dataset.open !== 'false',
      )
      .map((slot) => slot.getBoundingClientRect())
      .filter(
        (rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          box.left < rect.right &&
          box.right > rect.left &&
          box.top < rect.bottom &&
          box.bottom > rect.top,
      )
      .map((rect) => ({
        left: Math.max(box.left, rect.left),
        top: Math.max(box.top, rect.top),
        right: Math.min(box.right, rect.right),
        bottom: Math.min(box.bottom, rect.bottom),
      }));
    const xs = [...new Set(covers.flatMap((cover) => [cover.left, cover.right]))].sort(
      (a, b) => a - b,
    );
    const ys = [...new Set(covers.flatMap((cover) => [cover.top, cover.bottom]))].sort(
      (a, b) => a - b,
    );
    let covered = 0;
    for (let i = 0; i < xs.length - 1; i += 1)
      for (let j = 0; j < ys.length - 1; j += 1) {
        const x = (xs[i] + xs[i + 1]) / 2;
        const y = (ys[j] + ys[j + 1]) / 2;
        if (covers.some((c) => x > c.left && x < c.right && y > c.top && y < c.bottom))
          covered += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      }
    return {
      id: active.dataset.keyboardItem ?? active.dataset.canonicalId ?? active.tagName,
      visible: 1 - covered / (box.width * box.height),
      covered: covers.length > 0,
    };
  });
}

async function pinSidebar(page: Page): Promise<void> {
  const sidebar = page.locator('[data-chrome-slot="sidebar"]');
  const pin = sidebar.getByRole('button', { name: 'Pin sidebar' });
  // Pinned panels persist per project, so a later page load may already show it.
  if ((await sidebar.getAttribute('data-open')) !== 'true') {
    await page.keyboard.press('Alt+BracketRight');
    await expect(sidebar).toHaveAttribute('data-open', 'true');
  }
  if ((await pin.getAttribute('aria-pressed')) !== 'true') await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
}

/** Opens the sidebar without pinning it, so it overlays the page. */
async function openSidebar(page: Page): Promise<void> {
  const sidebar = page.locator('[data-chrome-slot="sidebar"]');
  const pin = sidebar.getByRole('button', { name: 'Pin sidebar' });
  if ((await sidebar.getAttribute('data-open')) !== 'true') {
    await page.keyboard.press('Alt+BracketRight');
    await expect(sidebar).toHaveAttribute('data-open', 'true');
  }
  // Pinned panels persist per project, so an earlier test may have left it pinned.
  if ((await pin.getAttribute('aria-pressed')) === 'true') await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
}

async function expectSidebarOverlay(page: Page): Promise<void> {
  const sidebar = page.locator('[data-chrome-slot="sidebar"]');
  await expect(sidebar).toHaveAttribute('data-open', 'true');
  await expect(sidebar.getByRole('button', { name: 'Pin sidebar' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
}

async function expectSidebarPinned(page: Page): Promise<void> {
  const sidebar = page.locator('[data-chrome-slot="sidebar"]');
  await expect(sidebar).toHaveAttribute('data-open', 'true');
  await expect(sidebar.getByRole('button', { name: 'Pin sidebar' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

/** Moves right card by card to the last Board column. */
async function walkBoardRight(page: Page): Promise<void> {
  let previous = '';
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('ArrowRight');
    const id = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.keyboardItem ?? '',
    );
    if (id === previous) return;
    previous = id;
  }
}

/**
 * Appends a horizontally overflowing row of keyboard items to the route frame. No route renders
 * an overflowing nested scroller under the sidebar at these widths, so the row stands in for one.
 */
async function injectScroller(page: Page): Promise<void> {
  await page.evaluate(() => {
    const frame = document.querySelector('#main-content .op-route-frame');
    if (!frame) throw new Error('Missing route frame.');
    const row = document.createElement('div');
    row.dataset.testScroller = '';
    row.style.cssText = 'display:flex;gap:8px;overflow-x:auto;padding:8px 0';
    for (let index = 0; index < 12; index += 1) {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = `Probe ${index + 1}`;
      item.dataset.keyboardItem = `probe-${index + 1}`;
      item.style.cssText = 'flex:none;width:160px;height:40px';
      row.append(item);
    }
    frame.append(row);
  });
}

/** Walks the injected row with the coordinator's arrow path, reporting each focused item. */
async function walkScroller(page: Page): Promise<FocusReport[]> {
  await page.locator('[data-keyboard-item="probe-1"]').focus();
  const reports = [await focusReport(page)];
  for (let index = 2; index <= 12; index += 1) {
    await page.keyboard.press('ArrowDown');
    await expect(page.locator(`[data-keyboard-item="probe-${index}"]`)).toBeFocused();
    reports.push(await focusReport(page));
  }
  return reports;
}

/** Whether more than half of `target` sits under the open sidebar, measured now. */
function underSidebar(target: Locator): Promise<boolean> {
  return target.evaluate((element) => {
    const sidebar = document.querySelector('[data-chrome-slot="sidebar"]');
    if (!sidebar) throw new Error('Missing sidebar.');
    const box = element.getBoundingClientRect();
    const edge = sidebar.getBoundingClientRect().left;
    return Math.max(0, box.right - Math.max(edge, box.left)) > box.width / 2;
  });
}

/** Whether `target` sits entirely within the open sidebar's columns, measured now. */
function hiddenBySidebar(target: Locator): Promise<boolean> {
  return target.evaluate((element) => {
    const sidebar = document.querySelector('[data-chrome-slot="sidebar"]');
    if (!sidebar) throw new Error('Missing sidebar.');
    const box = element.getBoundingClientRect();
    const panel = sidebar.getBoundingClientRect();
    return box.left >= panel.left && box.right <= panel.right;
  });
}

/** Content focus stops that overlap the open sidebar, tabbing from the main content once round. */
function stopsUnderSidebar(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const sidebar = document.querySelector('[data-chrome-slot="sidebar"]');
    const main = document.querySelector<HTMLElement>('#main-content');
    if (!sidebar || !main) throw new Error('Missing sidebar or main content.');
    const panel = sidebar.getBoundingClientRect();
    const stops = Array.from(
      main.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select, textarea, summary, [tabindex="0"]',
      ),
    ).filter((element) => element.checkVisibility() && !element.closest('[inert]'));
    const covered: string[] = [];
    for (const stop of stops) {
      stop.focus();
      for (let frame = 0; frame < 2; frame += 1)
        await new Promise((resolve) => requestAnimationFrame(resolve));
      const box = stop.getBoundingClientRect();
      if (
        box.width > 0 &&
        box.left < panel.right &&
        box.right > panel.left &&
        box.top < panel.bottom &&
        box.bottom > panel.top
      )
        covered.push(
          stop.getAttribute('aria-label') ?? stop.textContent?.trim().slice(0, 40) ?? '',
        );
    }
    return covered;
  });
}

/** Browser coverage that keyboard focus stays clear of the floating chrome. */
export function registerFocusClearanceBrowserTests(openFixture: OpenFixture) {
  test.describe('focus clear of floating chrome', () => {
    for (const width of WIDTHS) {
      test(`scrolls a nested horizontal scroller clear of an open sidebar on the preventScroll arrow path at ${width}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await openFixture(page, '#/list');
        await openSidebar(page);
        await injectScroller(page);
        const row = page.locator('[data-test-scroller]');
        const reports = await walkScroller(page);
        expect(reports.filter((report) => report.visible <= FOCUS_HIDDEN_SHARE)).toEqual([]);
        // The last items sit under the sidebar at the row's end, so they needed extra range.
        expect(await row.evaluate((element) => element.style.paddingInlineEnd)).not.toBe('');
        expect(await row.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
        // Scrolling cleared every item, so the sidebar that was open before focus stayed open.
        await expectSidebarOverlay(page);
        await page
          .locator('[data-route-kind="planning.list"] [data-keyboard-item]')
          .first()
          .focus();
        await expect.poll(() => row.evaluate((element) => element.style.paddingInlineEnd)).toBe('');
      });

      test(`keeps the last List row fully visible beside a pinned sidebar at ${width}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await openFixture(page, '#/list');
        await pinSidebar(page);
        await page
          .locator('[data-route-kind="planning.list"] [data-keyboard-item]')
          .first()
          .focus();
        let previous = '';
        for (let press = 0; press < 400; press += 1) {
          await page.keyboard.press('ArrowDown');
          const id = await page.evaluate(
            () => (document.activeElement as HTMLElement | null)?.dataset.keyboardItem ?? '',
          );
          if (id === previous) break;
          previous = id;
        }
        const report = await focusReport(page);
        expect(report.id).toBe(previous);
        expect(report).toMatchObject({ covered: false, visible: 1 });
        const edge = await page
          .locator('[data-chrome-slot="sidebar"]')
          .evaluate((sidebar) => sidebar.getBoundingClientRect().left);
        const row = await page.locator(`[data-keyboard-item="${previous}"]`).boundingBox();
        if (!row) throw new Error('Missing last List row box.');
        expect(row.x + row.width).toBeLessThanOrEqual(edge);
        await expectSidebarPinned(page);
      });

      test(`keeps content focus stops clear of a pinned sidebar at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        for (const route of ['#/list', '#/board', '#/sprints', '#/overview']) {
          await openFixture(page, route);
          await pinSidebar(page);
          expect({ route, covered: await stopsUnderSidebar(page) }).toEqual({ route, covered: [] });
        }
      });

      test(`shifts nothing across route changes with the sidebar pinned and unpinned at ${width}`, async ({
        page,
      }) => {
        await page.addInitScript(installDashboardLayoutShifts);
        await page.setViewportSize({ width, height: 900 });
        const shifts = () =>
          page.evaluate(() =>
            window.__dashboardLayoutShifts.snapshot().shifts.map((shift) => ({
              phase: shift.phase,
              value: shift.value,
              input: shift.hadRecentInput,
            })),
          );
        const visit = async (route: string, kind: string) => {
          await page.evaluate((hash) => {
            window.__dashboardLayoutShifts.markPhase(`route ${hash}`);
            window.location.hash = hash;
          }, route);
          await expect(page.locator(`[data-route-kind="${kind}"]`)).toBeVisible();
          await page.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
        };
        await openFixture(page, '#/list');
        await page.evaluate(() => window.__dashboardLayoutShifts.markPhase('pin'));
        await pinSidebar(page);
        await visit('#/board', 'planning.board');
        await visit('#/overview', 'planning.overview');
        await page.evaluate(() => window.__dashboardLayoutShifts.markPhase('unpin'));
        await page
          .locator('[data-chrome-slot="sidebar"]')
          .getByRole('button', { name: 'Pin sidebar' })
          .click();
        await visit('#/sprints', 'planning.sprints');
        await visit('#/list', 'planning.list');
        const recorded = await shifts();
        // Pinning and unpinning move the page only as the direct result of that press.
        expect(recorded.filter((shift) => shift.phase.startsWith('route') || !shift.input)).toEqual(
          [],
        );
        expect(recorded.some((shift) => shift.phase === 'pin')).toBe(true);
        // A persisted pin is in place at first paint.
        await page.evaluate(() => window.__dashboardLayoutShifts.markPhase('pin'));
        await pinSidebar(page);
        await openFixture(page, '#/list');
        await expectSidebarPinned(page);
        expect(await shifts()).toEqual([]);
      });
    }

    for (const width of WIDTHS) {
      test(`clears focus returning from a dialog to an item under the open sidebar at ${width}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await openFixture(page, '#/list');
        await openSidebar(page);
        await injectScroller(page);
        await walkScroller(page);
        const origin = page.locator('[data-keyboard-item="probe-12"]');
        await page.keyboard.press('ControlOrMeta+KeyK');
        const palette = page.locator('dialog.pc-palette');
        await expect(palette).toBeVisible();
        // A layout change while the dialog is open moves the origin entirely under the sidebar.
        await page.locator('[data-test-scroller]').evaluate((element) => {
          const sidebar = document.querySelector('[data-chrome-slot="sidebar"]');
          const item = element.querySelector('[data-keyboard-item="probe-12"]');
          if (!sidebar || !item) throw new Error('Missing sidebar or origin.');
          element.scrollLeft -=
            sidebar.getBoundingClientRect().left + 8 - item.getBoundingClientRect().left;
        });
        expect(await hiddenBySidebar(origin)).toBe(true);
        await page.keyboard.press('Escape');
        await expect(palette).not.toBeVisible();
        await expect(origin).toBeFocused();
        expect((await focusReport(page)).visible).toBe(1);
        await expectSidebarOverlay(page);
      });

      test(`reveals a focused Graph node into the safe area through the engine without zooming at ${width}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await openFixture(page, '#/graph', { planningScenario: 'delivery' });
        await settleGraph(page);
        await pinSidebar(page);
        const node = page.locator('.pc-graph-node[data-canonical-id="T-073"]');
        const sidebar = page.locator('[data-chrome-slot="sidebar"]');
        const edge = (await sidebar.boundingBox())?.x;
        const start = await node.boundingBox();
        if (edge === undefined || !start) throw new Error('Missing sidebar or node box.');
        await page.mouse.move(width / 4, 400);
        // Pans the node so its centre sits under the sidebar.
        await page.mouse.wheel(start.x + start.width / 2 - (edge + 40), 0);
        const before = await settleGraph(page);
        expect(await underSidebar(node)).toBe(true);
        await node.focus();
        const after = await settleGraph(page);
        expect(after.zoom).toBe(before.zoom);
        const box = await node.boundingBox();
        if (!box) throw new Error('Missing revealed node box.');
        expect(box.x + box.width).toBeLessThanOrEqual(edge);
        expect((await focusReport(page)).visible).toBeGreaterThan(FOCUS_HIDDEN_SHARE);
        await expectSidebarPinned(page);
      });

      test(`moves no layout while clearing and releasing focus beside the sidebar at ${width}`, async ({
        page,
      }) => {
        await page.addInitScript(installDashboardLayoutShifts);
        await page.setViewportSize({ width, height: 900 });
        // Each document load starts a new shift buffer, so each route is summed before leaving it.
        const shifts = () =>
          page.evaluate(() =>
            window.__dashboardLayoutShifts
              .snapshot()
              .shifts.filter((shift) => shift.phase === 'focus-clearance')
              .map((shift) => ({
                value: shift.value,
                sources: shift.sources.map(
                  (source) =>
                    `${source.selector} ${JSON.stringify(source.previousRect)} -> ${JSON.stringify(source.currentRect)}`,
                ),
              })),
          );
        await openFixture(page, '#/board', { planningScenario: 'delivery' });
        await pinSidebar(page);
        const board = page.locator('.pc-status-board');
        await board.locator('.pc-status-board__card [data-keyboard-item]').first().focus();
        await page.evaluate(() => window.__dashboardLayoutShifts.markPhase('focus-clearance'));
        await walkBoardRight(page);
        await focusReport(page);
        // The Board's columns are fluid, so trailing padding would reflow them; it is not added.
        expect(await board.evaluate((element) => element.style.paddingInlineEnd)).toBe('');
        // Each focused card is inspected, which reflows the inspector and selection bar text;
        // the Board grid itself must not move.
        expect(
          (await shifts()).flatMap((shift) =>
            shift.sources.filter((source) => source.includes('pc-status-board')),
          ),
        ).toEqual([]);

        await openFixture(page, '#/list');
        await openSidebar(page);
        await injectScroller(page);
        await page.evaluate(() => window.__dashboardLayoutShifts.markPhase('focus-clearance'));
        await walkScroller(page);
        expect(
          await page
            .locator('[data-test-scroller]')
            .evaluate((element) => element.style.paddingInlineEnd),
        ).not.toBe('');
        await page
          .locator('[data-route-kind="planning.list"] [data-keyboard-item]')
          .first()
          .focus();
        await focusReport(page);
        // Keyboard input counts as recent input, so every entry counts, not only unexpected ones.
        expect(await shifts()).toEqual([]);
      });
    }
  });
}
