/**
 * Real-browser dashboard quality gate.
 *
 * Playwright loads the source-owned fixture server and mounts the production
 * App. Representative states use reviewed Playwright-native golden comparisons;
 * the complete route inventory also emits native PNG attachments. Accessibility
 * and interaction claims are made from the rendered product, never from
 * source-text constants or a blank page.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  expect,
  type Locator,
  type Page,
  type Request,
  type Response,
  test,
} from '@playwright/test';
import axe from 'axe-core';
import {
  assertOperateReviewDisplayWorkspaceV1,
  assertOperatingReviewReceiptV2,
  type OperateReviewDisplayWorkspaceV1,
} from 'planr-pipeline/dashboard/operate-review-contract';
import {
  dashboardRouteDefinition,
  parseDashboardRoute,
} from '../../../../apps/dashboard/src/app/router.js';
import {
  encodePlanningCheckpoint,
  type PlanningGraphEnvelope,
  parsePlanningGraphEnvelope,
  parsePlanningLiveEvent,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import {
  assertBrandGalleryEvidence,
  brandGalleryStates,
  recordBrandGalleryEvidence,
} from '../../../../apps/dashboard/tests/helpers/brand-gallery-fixture.mjs';
import {
  activityParityRows,
  assertParityRow,
  boardParityRows,
  detailParityRows,
  homeParityRows,
  listParityRows,
  paletteParityRows,
  sprintsParityRows,
} from '../../../../apps/dashboard/tests/helpers/redesign-parity-rows.mjs';
import { installDashboardLayoutShifts } from '../dashboard/fixtures/dashboard-layout-shifts.js';
import { ARTBOARD_FIXTURE_CLOCK } from '../dashboard/fixtures/premium-artboard-fixture.js';
import { registerDashboardPerformanceTraceTests } from './fixtures/dashboard-performance-trace.js';
import {
  DASHBOARD_FIXTURE_CYCLE_ID,
  DASHBOARD_FIXTURE_REVIEW_ID,
  DASHBOARD_ROUTE_FIXTURES,
  dashboardRouteFixture,
} from './fixtures/dashboard-route-catalog.js';
import { SPRINT_SCENARIO_NOW } from './fixtures/dashboard-sprint-graph.js';

registerDashboardPerformanceTraceTests();

test('records fixture-only Tokens, Components and States in both themes', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const theme of ['dark', 'light']) {
    for (const state of brandGalleryStates) {
      await page.emulateMedia({
        reducedMotion: state === 'reduced-motion' ? 'reduce' : 'no-preference',
      });
      const response = await page.goto(
        `/__fixture/brand-gallery?${new URLSearchParams({ theme, state })}`,
      );
      expect(response?.ok()).toBe(true);
      await expect(page.locator('[data-brand-gallery]')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const evidence = await recordBrandGalleryEvidence(page, { theme, state });
      await testInfo.attach(`brand-gallery-${theme}-${state}.json`, {
        body: Buffer.from(JSON.stringify(evidence, null, 2)),
        contentType: 'application/json',
      });
      assertBrandGalleryEvidence(evidence);
    }
    await page.screenshot({
      path: testInfo.outputPath(`brand-gallery-${theme}.png`),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OPENPLANR_DASHBOARD_FIXTURE_PORT ?? '4173'}`;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'compact-tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'minimum', width: 320, height: 568 },
] as const;

const ACTIVE_TARGET_SELECTOR = [
  'a[href]',
  'button',
  'summary',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="slider"]',
].join(',');

function fixtureUrl(
  route: string,
  options: Readonly<Record<string, string>> = Object.freeze({}),
): string {
  const query = new URLSearchParams({ route, ...options });
  return `/?${query.toString()}`;
}

async function openFixture(page: Page, route = '#/overview', options = {}) {
  const browserErrors: string[] = [];
  const responseErrors: string[] = [];
  const onPageError = (error: Error) => browserErrors.push(error.message);
  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  };
  const onResponse = (response: Response) => {
    const { pathname } = new URL(response.url());
    if (pathname.startsWith('/api/') && response.status() >= 400) {
      responseErrors.push(`${response.status()} ${response.url()}`);
    }
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('response', onResponse);
  try {
    await page.goto(fixtureUrl(route, options));
    const expectation = dashboardRouteFixture(route);
    if (!expectation) throw new TypeError(`Missing ready-state assertion for ${route}.`);
    await expect(page.locator('.pc-shell')).toBeVisible();
    await expect(page.locator('#main-content')).toBeVisible();
    const workspace = page.locator(`[data-route-kind="${expectation.kind}"]`);
    await expect(workspace).toBeVisible();
    if (route === '#/search') {
      const palette = page.locator('dialog.pc-palette');
      await expect(palette).not.toBeVisible();
      await workspace.getByRole('textbox', { name: 'Search query' }).fill('appointment');
      await expect(workspace).toContainText(expectation.readyText);
    }
    if (!('planningScenario' in options)) {
      await expect(workspace).toContainText(expectation.readyText);
    }
    await expect(workspace).not.toContainText('cannot be trusted');
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
    page.off('response', onResponse);
  }
  expect(browserErrors, `browser errors while loading ${route}`).toEqual([]);
  expect(responseErrors, `API errors while loading ${route}`).toEqual([]);
}

async function layoutReport(page: Page) {
  return page.evaluate((activeTargetSelector) => {
    const horizontalOverflow =
      document.documentElement.scrollWidth > document.documentElement.clientWidth;
    const undersized = [...document.querySelectorAll<HTMLElement>(activeTargetSelector)]
      .filter((element) => {
        const style = getComputedStyle(element);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          element.getClientRects().length > 0 &&
          !element.matches(':disabled, [aria-disabled="true"]')
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
          width: rect.width,
          height: rect.height,
        };
      })
      .filter(({ width, height }) => width < 24 || height < 24);
    return { horizontalOverflow, undersized };
  }, ACTIVE_TARGET_SELECTOR);
}

async function expectControlsHitTestable(page: Page, scope = page.locator('#main-content')) {
  const controls = scope.locator(
    `${ACTIVE_TARGET_SELECTOR}, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]`,
  );
  let checked = 0;
  for (const control of await controls.all()) {
    if (
      !(await control.isVisible()) ||
      (await control.isDisabled()) ||
      (await control.getAttribute('aria-disabled')) === 'true'
    )
      continue;
    await control.scrollIntoViewIfNeeded();
    const report = await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        target: element.outerHTML,
        hit: hit?.outerHTML,
        reachable: hit !== null && (hit === element || element.contains(hit)),
      };
    });
    expect(report.reachable, `Control is covered: ${JSON.stringify(report)}`).toBe(true);
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
}

async function expectGovernedDialogFocusTrapped(page: Page, dialog: Locator, cancel: Locator) {
  await expect(cancel).toBeFocused();
  const controls = dialog.locator(ACTIVE_TARGET_SELECTOR);
  const steps = (await controls.count()) + 1;
  for (const direction of ['Tab', 'Shift+Tab']) {
    for (let step = 0; step < steps; step++) {
      await page.keyboard.press(direction);
      expect(
        await dialog.evaluate((element) => element.contains(document.activeElement)),
        `Governed dialog must retain focus after ${direction}`,
      ).toBe(true);
    }
  }
  await cancel.focus();
}

async function touchTap(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('Expected a visible target for emulated touch.');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function axeViolations(page: Page) {
  await page.addScriptTag({ content: axe.source });
  return page.evaluate(async () => {
    const runner = (
      window as unknown as {
        axe: {
          run: (
            root: Element,
            options: Record<string, unknown>,
          ) => Promise<{
            violations: Array<{ id: string; impact: string | null; nodes: unknown[] }>;
          }>;
        };
      }
    ).axe;
    const result = await runner.run(document.documentElement, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
    });
    return result.violations;
  });
}

async function attachScreenshot(
  page: Page,
  name: string,
  attach: (name: string, options: { body: Buffer; contentType: string }) => Promise<void>,
) {
  const screenshot = await page.screenshot({ fullPage: true, animations: 'disabled' });
  expect(screenshot.byteLength).toBeGreaterThan(1_024);
  expect(screenshot.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  await attach(name, { body: screenshot, contentType: 'image/png' });
}

// Soft, so a test with several goldens compares and records every one.
async function expectGoldenScreenshot(page: Page, name: string) {
  await expect.soft(page).toHaveScreenshot([process.platform, name], {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  });
}

async function expectTodayWorkspaceStatus(page: Page) {
  const passport = page.locator('.op-binding-passport');
  await expect(passport).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'watcher connected' })).toBeVisible();
  await expect(page.locator('.op-rail .op-binding')).toHaveCount(0);
}

async function expectSurfaceToUseRouteFrame(page: Page, selector: string) {
  const [frame, surface] = await Promise.all([
    page.locator('.op-route-frame').boundingBox(),
    page.locator(selector).boundingBox(),
  ]);
  expect(frame, `Expected the shared route frame for ${selector}`).not.toBeNull();
  expect(surface, `Expected ${selector} to be visible`).not.toBeNull();
  expect(surface?.x ?? Number.NaN).toBeCloseTo(frame?.x ?? Number.NaN, 1);
  expect(surface?.width ?? Number.NaN).toBeCloseTo(frame?.width ?? Number.NaN, 1);
}

test.describe('dashboard real-browser quality', () => {
  test('mounts the exact fixture state on every typed public route', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    for (const fixture of DASHBOARD_ROUTE_FIXTURES) {
      const { hash: route } = fixture;
      await openFixture(page, route);
      await expect(page.locator('.pc-skip-link')).toHaveAttribute('href', '#main-content');
      const parsed = parseDashboardRoute(route);
      if (parsed.kind === 'not-found') throw new TypeError(`Unparsed fixture route: ${route}`);
      const definition = dashboardRouteDefinition(parsed);
      if (!definition) throw new TypeError(`Undefined fixture route: ${route}`);
      const subject =
        parsed.kind === 'operate.review'
          ? ` · ${parsed.cycleId} · ${parsed.subjectId}`
          : parsed.subjectId
            ? ` · ${parsed.subjectId}`
            : '';
      await expect(page.locator('.op-route-announcer')).toHaveText(
        `${definition.label}${subject}. ${definition.description}`,
      );
      await expect(page.locator('[data-route-kind="not-found"]')).toHaveCount(0);
      await attachScreenshot(
        page,
        `dashboard-route-${route.slice(2).replaceAll('/', '-')}.png`,
        testInfo.attach.bind(testInfo),
      );
      if (route === '#/overview') {
        await expectGoldenScreenshot(page, 'console-planning-overview-ready.png');
      }
      if (route === '#/graph') {
        const graph = page.locator('[data-route-kind="planning.graph"]');
        await expect(graph.getByRole('heading', { level: 1, name: 'Graph' })).toBeVisible();
        await expect(graph).toContainText('1 of 1 nodes');
        await expect(graph).toContainText('Everything outside the focus is hidden, not deleted.');
        await expect(graph.getByRole('tab', { name: 'Graph' })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await expectGoldenScreenshot(page, 'console-planning-graph-ready.png');
      }
      if (route === '#/board') {
        await expectGoldenScreenshot(page, 'console-planning-board-ready.png');
      }
      if (route === '#/operate/today') {
        await expectTodayWorkspaceStatus(page);
        await expectGoldenScreenshot(page, 'console-operate-today-ready.png');
      }
    }
    expect(new URL(page.url()).origin).toBe(FIXTURE_ORIGIN);
    if (process.env.OPENPLANR_DASHBOARD_FIXTURE_REQUIRE_ISOLATION === '1') {
      expect(FIXTURE_ORIGIN).not.toBe('http://127.0.0.1:4173');
    }
  });

  test('uses the shared presentation across every Operate route in both themes', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      const theme = new URL(location.href).searchParams.get('operateTheme');
      if (theme === 'dark' || theme === 'light') localStorage.setItem('op-theme', theme);
    });
    const writes: string[] = [];
    page.on('request', (request) => {
      if (
        new URL(request.url()).pathname.startsWith('/api/operate/') &&
        !['GET', 'HEAD'].includes(request.method())
      )
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    const routes = DASHBOARD_ROUTE_FIXTURES.filter(({ kind }) => kind.startsWith('operate.'));
    expect(routes).toHaveLength(15);
    for (const theme of ['dark', 'light']) {
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const { hash, kind } of routes) {
          await openFixture(page, hash, { operateTheme: theme });
          const workspace = page.locator(`[data-route-kind="${kind}"]`);
          await expect(workspace).toHaveClass(/pc-operate/u);
          await page.evaluate(() => document.fonts.ready);
          const typography = await workspace.evaluate((element) => {
            const heading = element.querySelector('h1, h2');
            if (!heading) throw new Error('Missing Operate heading.');
            const style = getComputedStyle(heading);
            return {
              body: getComputedStyle(element).fontFamily,
              heading: style.fontFamily,
              size: parseFloat(style.fontSize),
              isPageTitle: heading.tagName === 'H1',
              overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            };
          });
          expect(typography.body).toContain('DM Sans');
          expect(typography.heading).toContain('Outfit');
          expect(typography.size).toBe(typography.isPageTitle ? 28 : 20);
          expect(typography.overflow, `${kind} at ${width}px in ${theme}`).toBe(false);
          if (kind === 'operate.recovery' && width === 390) {
            const history = workspace.getByRole('region', { name: 'Immutable recovery history' });
            await expect(history).toHaveAttribute('tabindex', '0');
            await history.focus();
            await expect(history).toBeFocused();
            await expect(history).toHaveCSS('outline-style', 'solid');
            await expect(history).toHaveCSS('outline-width', '2px');
          }
          const violations = await axeViolations(page);
          expect(violations, `${kind} accessibility at ${width}px in ${theme}`).toEqual([]);
          if (width === 1440) {
            await attachScreenshot(page, `${kind}-${theme}.png`, testInfo.attach.bind(testInfo));
          }
          if (kind === 'operate.today' && width === 1440) {
            const focus = workspace.locator('.op-today-focus');
            const evidence = workspace.locator('.op-today-evidence--wide');
            const [focusBox, evidenceBox] = await Promise.all([
              focus.boundingBox(),
              evidence.boundingBox(),
            ]);
            if (!focusBox || !evidenceBox) throw new Error('Missing focus or evidence desk.');
            expect(evidenceBox.x - focusBox.x - focusBox.width).toBeCloseTo(24, 0);
            await expect(focus).toHaveCSS('border-radius', '14px');
            await expect(evidence).toHaveCSS('border-radius', '14px');
          }
        }
      }
    }
    expect(writes).toEqual([]);
  });

  for (const theme of ['dark', 'light']) {
    for (const width of [1440, 320]) {
      test(`shows the truthful first-run Operate page with a copyable host command (${theme}, ${width}px)`, async ({
        page,
      }, testInfo) => {
        await page.addInitScript(installDashboardLayoutShifts);
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.addInitScript(() => {
          const theme = new URL(location.href).searchParams.get('operateTheme');
          if (theme === 'dark' || theme === 'light') localStorage.setItem('op-theme', theme);
        });
        await page.setViewportSize({ width, height: 1000 });
        const [bootstrapResponse, indexResponse] = await Promise.all([
          page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === '/api/bootstrap' && response.status() === 200,
          ),
          page.waitForResponse((response) => {
            const url = new URL(response.url());
            return (
              url.pathname === '/api/operate/local-reviews' &&
              url.searchParams.get('pageSize') === '12' &&
              response.status() === 200
            );
          }),
          page.goto(fixtureUrl('#/operate/today', { localOperate: 'empty', operateTheme: theme })),
        ]);
        expect(bootstrapResponse.ok()).toBe(true);
        expect(indexResponse.ok()).toBe(true);
        // API request bodies survive replacement of the document that issued the observed requests.
        const [bootstrapRead, indexRead] = await Promise.all([
          page.request.get(bootstrapResponse.url(), {
            headers: bootstrapResponse.request().headers(),
          }),
          page.request.get(indexResponse.url(), {
            headers: indexResponse.request().headers(),
          }),
        ]);
        expect(bootstrapRead.ok()).toBe(true);
        expect(await bootstrapRead.json()).toMatchObject({
          queryRoots: { operate: null },
          capabilities: { operateCommands: { available: false } },
        });
        expect(indexRead.ok()).toBe(true);
        expect(await indexRead.json()).toMatchObject({ pagination: { total: 0 }, items: [] });
        const workspace = page.locator('[data-route-kind="operate.today"]');
        await expect(
          workspace.getByRole('heading', { name: 'Operate is not set up here yet' }),
        ).toBeVisible();
        await expect(workspace.getByText('Proposed', { exact: true })).toBeVisible();
        if (width === 1440) {
          await expect(page.locator('.pc-shell-inspector, .pc-inspector-sheet')).toHaveCount(0);
          await expect(
            page.getByRole('button', {
              name: 'Show inspector: select an item first',
              exact: true,
            }),
          ).toBeDisabled();
          const main = page.locator('#main-content');
          const [content, column] = await Promise.all([
            main.boundingBox(),
            page.locator('.pc-shell__column').boundingBox(),
          ]);
          if (!content || !column) throw new Error('Missing main content or shell column.');
          expect(content.width).toBe(column.width);
          await expectControlsHitTestable(page);
        }

        await expect(workspace.locator('.op-today-focus, .pc-local-review__signal')).toHaveCount(0);
        await workspace.getByRole('button', { name: 'Copy command', exact: true }).click();
        await expect(workspace.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/planr:operate');
        expect((await layoutReport(page)).horizontalOverflow).toBe(false);
        expect(await axeViolations(page)).toEqual([]);
        await attachScreenshot(
          page,
          `operate-first-run-${theme}-${width}.png`,
          testInfo.attach.bind(testInfo),
        );
      });
    }
  }

  test('shows completed local operating reviews and keeps cycle and history routes distinct', async ({
    page,
  }) => {
    const requests: Request[] = [];
    const errors: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/operate/')) requests.push(request);
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(fixtureUrl('#/operate/cycles/2026-09-14-modul-events', { localOperate: '1' }));
    const detail = page.locator('[data-route-kind="operate.cycle"]');
    await expect(detail).toBeVisible();
    await expect(
      detail.getByRole('heading', { level: 1, name: 'Operating board report — Modul events' }),
    ).toBeVisible();
    await expect(detail).toContainText('Act now on the verified release path.');
    await expect(detail).toContainText('Run the CRM smoke test');
    await expect(detail.getByRole('heading', { name: 'Review coverage' })).toBeVisible();
    await expect(detail.getByRole('heading', { name: 'Decision record' })).toBeVisible();
    await expect(detail.getByText('Governed actions')).toBeVisible();
    await expect(detail).not.toContainText('No command gateway in this build');

    const navigation = page.getByRole('navigation', { name: 'Dashboard navigation' });

    await navigation.getByRole('link', { name: 'Today', exact: true }).click();
    const today = page.locator('[data-route-kind="operate.today"]');
    await expect(today.getByRole('heading', { level: 1, name: 'Operate today' })).toBeVisible();
    await expect(today.getByRole('heading', { name: 'Lens coverage' })).toBeVisible();
    await expect(today).toContainText('Board signal · act now');

    await navigation.getByRole('link', { name: 'Inbox', exact: true }).click();
    const inbox = page.locator('[data-route-kind="operate.inbox"]');
    await expect(inbox.getByRole('heading', { level: 1, name: 'Decision inbox' })).toBeVisible();
    await expect(inbox).toContainText('Recommendations require human disposition');
    await expect(inbox).toContainText('Live flow state');

    await navigation.getByRole('link', { name: 'Actions', exact: true }).click();
    const actions = page.locator('[data-route-kind="operate.actions"]');
    await expect(actions.getByRole('heading', { level: 1, name: 'Action register' })).toBeVisible();
    await expect(actions.getByRole('link', { name: /Run the CRM smoke test/u })).toBeVisible();
    await expect(actions).toContainText('Submit one test registration');

    await navigation.getByRole('link', { name: 'Evidence', exact: true }).click();
    const evidence = page.locator('[data-route-kind="operate.evidence"]');
    await expect(
      evidence.getByRole('heading', { level: 1, name: 'Evidence register' }),
    ).toBeVisible();
    await expect(evidence).toContainText('docs/crm-registration-webhook.md:12');

    await navigation.getByRole('link', { name: 'Outcomes', exact: true }).click();
    const outcomes = page.locator('[data-route-kind="operate.outcomes"]');
    await expect(
      outcomes.getByRole('heading', { level: 1, name: 'Outcome tracking' }),
    ).toBeVisible();
    await expect(outcomes).toContainText('awaiting observed evidence');

    await navigation.getByRole('link', { name: 'Recovery', exact: true }).click();
    const recovery = page.locator('[data-route-kind="operate.recovery"]');
    await expect(
      recovery.getByRole('heading', { level: 1, name: 'Cycle integrity' }),
    ).toBeVisible();
    await expect(recovery).toContainText('Complete review bundle detected');

    await navigation.getByRole('link', { name: 'History', exact: true }).click();
    const history = page.locator('[data-route-kind="operate.history"]');
    await expect(history).toBeVisible();
    await expect(
      history.getByRole('heading', { level: 1, name: 'Operating history' }),
    ).toBeVisible();
    await expect(
      history.getByRole('link', { name: /Operating board report — Modul events/u }),
    ).toBeVisible();
    await expect(history.getByRole('heading', { name: 'Decision queue' })).toHaveCount(0);

    await navigation.getByRole('link', { name: 'Cycles', exact: true }).click();
    const cycles = page.locator('[data-route-kind="operate.cycles"]');
    await expect(cycles.getByRole('heading', { level: 1, name: 'Operating cycles' })).toBeVisible();
    await expect(
      cycles.getByRole('link', { name: /Operating board report — Modul events/u }),
    ).toBeVisible();

    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(fixtureUrl('#/operate/today', { localOperate: '1' }));
    const compactToday = page.locator('[data-route-kind="operate.today"]');
    await expect(
      compactToday.getByRole('heading', { level: 1, name: 'Operate today' }),
    ).toBeVisible();
    expect(
      await compactToday
        .locator('.pc-local-review__signal')
        .evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
    ).toBe(true);
    expect((await layoutReport(page)).horizontalOverflow).toBe(false);
    expect(await axeViolations(page)).toEqual([]);

    expect(requests.length).toBeGreaterThanOrEqual(3);
    expect(requests.every((request) => request.method() === 'GET')).toBe(true);
    expect(errors).toEqual([]);
    expect((await layoutReport(page)).horizontalOverflow).toBe(false);
    expect(await axeViolations(page)).toEqual([]);
  });

  test('renders the pending Review from exact GET-only reads without mutation or private custody', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const route = `#/operate/cycles/${DASHBOARD_FIXTURE_CYCLE_ID}/reviews/${DASHBOARD_FIXTURE_REVIEW_ID}`;
    const reviewPath = `/api/operate/cycles/${DASHBOARD_FIXTURE_CYCLE_ID}/reviews/${DASHBOARD_FIXTURE_REVIEW_ID}`;
    const operateRequests: Request[] = [];
    const reviewResponses: Response[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/operate/')) {
        operateRequests.push(request);
      }
    });
    page.on('response', (response) => {
      if (new URL(response.url()).pathname === reviewPath) reviewResponses.push(response);
    });

    const started = performance.now();
    await openFixture(page, route);
    const useful = page.locator('[data-route-kind="operate.review"] [data-review-useful]');
    await expect(useful).toBeVisible();
    expect(performance.now() - started).toBeLessThan(2_500);

    await expect(useful.getByRole('heading', { level: 1, name: 'Owner Review' })).toBeVisible();
    await expect(useful).toContainText('executive decision docket');
    await expect(page.getByRole('heading', { name: 'What the board recommends' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Choose the record to make' })).toBeVisible();
    expect(
      await page.evaluate(() => {
        const recommendation = document.querySelector('#op-review-recommendation-title');
        const choices = document.querySelector('#op-review-choices-title');
        return Boolean(
          recommendation &&
            choices &&
            recommendation.compareDocumentPosition(choices) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    ).toBe(true);

    const choices = page.getByRole('radio');
    await expect(choices).toHaveCount(3);
    for (const choice of await choices.all()) expect(await choice.isChecked()).toBe(false);
    await expect(page.getByRole('button', { name: 'Review exact choice' })).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    const reviewRequests = operateRequests.filter(
      (request) => new URL(request.url()).pathname === reviewPath,
    );
    expect(reviewRequests.length).toBeGreaterThan(0);
    for (const request of reviewRequests) {
      const url = new URL(request.url());
      expect(request.method()).toBe('GET');
      expect(request.postData()).toBeNull();
      expect([...url.searchParams.entries()].sort()).toEqual(
        [
          ['domainId', 'customer-operations'],
          ['domainVersion', '1.0.0'],
          ['scopeId', 'appointment-reminders'],
        ].sort(),
      );
      const headers = await request.allHeaders();
      expect(headers['x-openplanr-actor']).toBe('careloop-ops');
    }
    expect(
      operateRequests
        .filter((request) => request.method() !== 'GET')
        .map((request) => request.url()),
    ).toEqual([]);
    expect(reviewResponses.length).toBeGreaterThan(0);
    expect(reviewResponses.every((response) => response.status() === 200)).toBe(true);

    const privateMarkers = [
      '/Users/',
      '/home/',
      'C:\\Users\\',
      '.planr/operate',
      'storePath',
      'BEGIN PRIVATE KEY',
      'OPENPLANR_API_TOKEN',
    ];
    const reviewBytes = (
      await Promise.all(reviewResponses.map((response) => response.text()))
    ).join('\n');
    const renderedBytes = await page.locator('body').innerHTML();
    for (const marker of privateMarkers) {
      expect(reviewBytes).not.toContain(marker);
      expect(renderedBytes).not.toContain(marker);
    }
    expect((await layoutReport(page)).horizontalOverflow).toBe(false);
    expect(await axeViolations(page)).toEqual([]);
  });

  test('keeps the Review keyboard-complete at 200% effective zoom, forced colors, and reduced motion', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 568 },
      screen: { width: 640, height: 1_136 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    try {
      await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
      const route = `#/operate/cycles/${DASHBOARD_FIXTURE_CYCLE_ID}/reviews/${DASHBOARD_FIXTURE_REVIEW_ID}`;
      const requests: Request[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/api/operate/')) requests.push(request);
      });
      await openFixture(page, route, {
        contrast: 'high',
        reviewDisposition: 'rejected',
        reviewProof: `accessibility-${testInfo.retry}`,
      });
      const media = await page.evaluate(() => ({
        forcedColors: matchMedia('(forced-colors: active)').matches,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        motionDuration: getComputedStyle(document.documentElement)
          .getPropertyValue('--op-motion-duration')
          .trim(),
        devicePixelRatio: window.devicePixelRatio,
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      expect(media).toEqual({
        forcedColors: true,
        reducedMotion: true,
        motionDuration: '0.01ms',
        devicePixelRatio: 2,
        width: 320,
        height: 568,
      });
      await expect(page.getByRole('heading', { level: 1, name: 'Owner Review' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Choose the record to make' })).toBeVisible();

      const radio = page.getByRole('radio', { name: /Reject recommendation/u });
      await radio.focus();
      await page.keyboard.press('Space');
      await expect(radio).toBeChecked();
      const trigger = page.getByRole('button', { name: 'Review exact choice' });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAccessibleName('Record “Reject recommendation”?');
      const cancel = dialog.getByRole('button', { name: 'Keep reviewing', exact: true });
      await expectGovernedDialogFocusTrapped(page, dialog, cancel);
      await expect(
        dialog.getByText(
          'Records owner rejection and applies only the listed work dispositions; it does not delete evidence or execute Actions.',
          { exact: true },
        ),
      ).toBeVisible();
      await expectControlsHitTestable(page, dialog);
      await expect(dialog.getByText('project-write')).toBeVisible();
      expect(
        requests.filter(
          (request) => new URL(request.url()).pathname === '/api/operate/commands/confirm',
        ),
      ).toHaveLength(0);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect((await layoutReport(page)).horizontalOverflow).toBe(false);
      expect(await axeViolations(page)).toEqual([]);
      await attachScreenshot(
        page,
        'operate-review-200-percent-forced-colors.png',
        testInfo.attach.bind(testInfo),
      );
    } finally {
      await context.close();
    }
  });

  for (const proof of [
    {
      disposition: 'approved',
      label: 'Approve bounded recommendation',
      consequence:
        'Records owner approval and applies only the listed work dispositions; it does not execute Actions or authorize external effects.',
      note: 'Disposable approved browser proof.',
    },
    {
      disposition: 'changes_requested',
      label: 'Request focused changes',
      consequence:
        'Records requested changes and applies only the listed work dispositions; a later Review requires separately governed work.',
      note: 'Disposable changes requested browser proof.',
    },
    {
      disposition: 'rejected',
      label: 'Reject recommendation',
      consequence:
        'Records owner rejection and applies only the listed work dispositions; it does not delete evidence or execute Actions.',
      note: 'Disposable rejected browser proof.',
    },
  ] as const) {
    test(`records the disposable ${proof.disposition} Review through exact browser confirmation`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      const route = `#/operate/cycles/${DASHBOARD_FIXTURE_CYCLE_ID}/reviews/${DASHBOARD_FIXTURE_REVIEW_ID}`;
      const requests: Request[] = [];
      const browserErrors: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/api/operate/')) requests.push(request);
      });
      page.on('pageerror', (error) => browserErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(message.text());
      });
      await openFixture(page, route, {
        reviewDisposition: proof.disposition,
        reviewProof: `${proof.disposition}-${testInfo.retry}`,
      });

      const radios = page.getByRole('radio');
      await expect(radios).toHaveCount(3);
      for (const radio of await radios.all()) expect(await radio.isChecked()).toBe(false);
      expect(requests.filter((request) => request.method() !== 'GET')).toHaveLength(0);

      const selected = page.getByRole('radio', { name: new RegExp(proof.label, 'u') });
      await selected.check();
      expect(requests.filter((request) => request.method() !== 'GET')).toHaveLength(0);
      const trigger = page.getByRole('button', { name: 'Review exact choice' });
      await trigger.click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAccessibleName(`Record “${proof.label}”?`);
      const cancel = dialog.getByRole('button', { name: 'Keep reviewing', exact: true });
      await expectGovernedDialogFocusTrapped(page, dialog, cancel);
      await expectControlsHitTestable(page, dialog);
      await expect(dialog.getByRole('heading', { name: `Record “${proof.label}”?` })).toBeVisible();
      await expect(dialog.getByText(proof.consequence, { exact: true })).toBeVisible();
      await expect(dialog.getByText('project-write')).toBeVisible();
      await expect(dialog).toContainText('Review only');
      await expect(dialog).toContainText('External effects');
      await expect(dialog).toContainText('Not authorized');
      await expect(dialog.getByRole('heading', { name: 'Exact work dispositions' })).toBeVisible();
      await expect(
        dialog.getByText('No persistent work disposition is attached to this choice.', {
          exact: true,
        }),
      ).toBeVisible();
      expect(
        requests.filter(
          (request) => new URL(request.url()).pathname === '/api/operate/commands/confirm',
        ),
      ).toHaveLength(0);

      await dialog.getByRole('textbox', { name: /Owner note/u }).fill(proof.note);
      const [response] = await Promise.all([
        page.waitForResponse(
          (candidate) => new URL(candidate.url()).pathname === '/api/operate/commands/confirm',
        ),
        dialog.getByRole('button', { name: `Record ${proof.label}` }).click(),
      ]);
      expect(response.status()).toBe(200);
      const envelope = (await response.json()) as Record<string, unknown>;
      const data = envelope.data as Record<string, unknown>;
      const receipt = assertOperatingReviewReceiptV2(data.receipt);
      const workspace = assertOperateReviewDisplayWorkspaceV1(
        data.workspace,
      ) as OperateReviewDisplayWorkspaceV1;
      expect(envelope).toMatchObject({
        ok: true,
        operation: 'operate.review.submit',
        allowedActions: [],
        eventHead: receipt.eventHead,
      });
      expect(receipt.decision).toBe(proof.disposition);
      expect(receipt.boundSubmission?.note).toBe(proof.note);
      expect(receipt.boundSubmission?.expectedReadEventHead).toEqual(receipt.readEventHead);
      expect(workspace.payload.status).toBe('terminal');
      expect(workspace.payload.mutationEnabled).toBe(false);
      expect(workspace.payload.sourceEventHead).toEqual(receipt.eventHead);
      expect(workspace.payload.data.terminalDisposition).toMatchObject({
        decision: proof.disposition,
        receiptId: receipt.receiptId,
        eventHead: receipt.eventHead,
        readEventHead: receipt.readEventHead,
      });

      const receiptTitle = page.getByRole('heading', { name: 'Review recorded' });
      await expect(receiptTitle).toBeVisible();
      await expect(receiptTitle).toBeFocused();
      await page.getByText('Technical receipt proof').click();
      await expect(page.getByText(proof.note)).toBeVisible();
      await page.waitForTimeout(100);
      const postPaths = requests
        .filter((request) => request.method() === 'POST')
        .map((request) => new URL(request.url()).pathname);
      expect(postPaths).toEqual([
        '/api/operate/session',
        '/api/operate/commands/preview',
        '/api/operate/commands/confirm',
      ]);
      expect(browserErrors).toEqual([]);
      expect((await layoutReport(page)).horizontalOverflow).toBe(false);
      expect(await axeViolations(page)).toEqual([]);
    });
  }

  test('keeps the Planning Graph calm at wide and narrow widths', async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 828, height: 900 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await openFixture(page, '#/graph');

      const graph = page.locator('[data-route-kind="planning.graph"]');
      await expect(graph.getByRole('heading', { level: 1, name: 'Graph' })).toBeVisible();
      await expect(graph).toContainText('Everything outside the focus is hidden, not deleted.');
      await expect(graph).toContainText('Arrows move to connected neighbours.');
      expect((await layoutReport(page)).horizontalOverflow).toBe(false);

      if (viewport.width >= 1024) {
        await expectSurfaceToUseRouteFrame(page, '[data-route-kind="planning.graph"]');
      }

      if (viewport.width === 1280) {
        await expectGoldenScreenshot(page, 'console-planning-graph-ready.png');
      }
    }
  });

  test('turns a real delivery plan into staged graph, bounded board, and sprint intelligence', async ({
    page,
  }) => {
    await page.addInitScript(installDashboardLayoutShifts);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFixture(page, '#/graph', { planningScenario: 'delivery' });

    const graph = page.locator('[data-route-kind="planning.graph"]');
    await expect(graph.getByRole('button', { name: 'Dependencies', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(graph.locator('.pc-graph-node')).toHaveCount(4);
    const fittedNodes = await graph.locator('.pc-graph-node').evaluateAll((nodes) =>
      nodes.map((node) => {
        const canvas = node.closest('.pc-graph');
        if (!canvas) throw new Error('Missing graph viewport.');
        const bounds = canvas.getBoundingClientRect();
        const rect = node.getBoundingClientRect();
        return {
          id: node.getAttribute('data-canonical-id'),
          fits:
            rect.left >= bounds.left - 2 &&
            rect.right <= bounds.right + 2 &&
            rect.top >= bounds.top - 2 &&
            rect.bottom <= bounds.bottom + 2,
        };
      }),
    );
    expect(fittedNodes.filter((node) => !node.fits)).toEqual([]);
    await expect(graph.locator('.pc-graph__rank')).toHaveCount(4);
    const nodePositions = await graph
      .locator('.pc-graph-node')
      .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().x)));
    expect(new Set(nodePositions).size).toBe(4);
    const canvasBounds = await graph.locator('.pc-graph').boundingBox();
    if (!canvasBounds) throw new Error('Missing fitted graph viewport.');
    // Stage spacing follows the available canvas at each viewport.
    expect(Math.max(...nodePositions) - Math.min(...nodePositions)).toBeGreaterThan(
      canvasBounds.width * 0.6,
    );

    await expect(page.locator('.pc-shell-inspector, .pc-inspector-sheet')).toHaveCount(0);
    await expectControlsHitTestable(page, graph);
    const main = page.locator('#main-content');
    const scroll = page.locator('.pc-shell__scroll');
    const before = { main: await main.boundingBox(), scroll: await scroll.boundingBox() };
    if (!before.main || !before.scroll) throw new Error('Missing main or scroll region.');
    await page.evaluate(() => window.__dashboardLayoutShifts.markPhase('inspector-toggle'));
    const selectedNode = graph.getByRole('button', {
      name: 'QT-071 Make failed CRM registrations visible and replayable',
      exact: true,
    });
    await selectedNode.click();
    const inspector = page.getByRole('dialog', { name: 'Inspector', exact: true });
    await expect(inspector).toContainText('Make failed CRM registrations visible and replayable');
    expect(await main.boundingBox()).toEqual(before.main);
    expect(await scroll.boundingBox()).toEqual(before.scroll);
    const overlay = await inspector.boundingBox();
    if (!overlay) throw new Error('Missing inspector overlay.');
    expect(overlay.x).toBeLessThan(before.main.x + before.main.width);
    expect(overlay.x + overlay.width).toBeGreaterThan(before.main.x + before.main.width - 1);
    await expect(inspector.locator('[data-artifact-id="QT-071"]')).toHaveAttribute(
      'data-detail-state',
      'ready',
    );
    const dependencies = inspector.getByRole('region', { name: 'Depends on', exact: true });
    await expect(dependencies.getByRole('link', { name: /QT-070/u })).toBeVisible();
    await expect(dependencies).toContainText('Done');
    await expect(
      inspector.getByRole('button', { name: 'Open full page', exact: true }),
    ).toBeVisible();
    expect(await inspector.evaluate((node) => getComputedStyle(node).animationName)).toBe(
      'pc-inspector-enter',
    );

    await page.keyboard.press('Escape');
    await expect(inspector).toHaveCount(0);
    await expect(selectedNode).toBeFocused();
    expect(await main.boundingBox()).toEqual(before.main);
    await selectedNode.click();
    await expect(inspector).toBeVisible();
    await main.click({ position: { x: 8, y: 8 } });
    await expect(inspector).toHaveCount(0);
    await expect(selectedNode).toBeFocused();
    expect(await main.boundingBox()).toEqual(before.main);
    expect(await scroll.boundingBox()).toEqual(before.scroll);
    await expectControlsHitTestable(page, graph);
    const shifts = await page.evaluate(() =>
      window.__dashboardLayoutShifts
        .snapshot()
        .shifts.filter((entry) => entry.phase === 'inspector-toggle'),
    );
    expect(shifts.reduce((sum, shift) => sum + shift.value, 0)).toBe(0);

    await selectedNode.click();
    await expect(inspector).toBeVisible();

    await page.evaluate(() => {
      window.location.hash = '#/list';
    });
    await expect(page.locator('[data-route-kind="planning.list"]')).toBeVisible();
    await expect(inspector).toHaveCount(0);
    await page.getByRole('button', { name: 'Show inspector', exact: true }).click();
    await expect(inspector).toContainText('Make failed CRM registrations visible and replayable');
    expect(await inspector.evaluate((node) => getComputedStyle(node).animationName)).toBe(
      'pc-inspector-enter',
    );

    await openFixture(page, '#/board', { planningScenario: 'delivery' });
    const doneCards = page.locator('[data-keyboard-column="done"] .pc-status-board__cards');
    await expect(doneCards.locator('.pc-status-board__card')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Hide done', exact: true }).click();
    await page
      .locator('[data-keyboard-column="done"]')
      .getByRole('button', { name: /^Show \d+ more$/u })
      .click();
    await expect(doneCards.locator('li[aria-setsize="33"]').first()).toBeAttached();
    expect(await doneCards.locator('.pc-status-board__card').count()).toBeLessThan(10);
    await doneCards.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(doneCards.locator('li[aria-posinset="33"]')).toBeAttached();
    const boardScroll = await doneCards.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      scrolls: element.scrollHeight > element.clientHeight,
    }));
    expect(boardScroll).toEqual({ overflowY: 'auto', scrolls: true });

    const operateReads: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/operate/local-reviews'))
        operateReads.push(request.url());
    });
    await openFixture(page, '#/sprints', { planningScenario: 'delivery' });
    const sprint = page.locator('[data-route-kind="planning.sprints"]');
    await expect(
      sprint.getByRole('heading', { name: 'CRM recovery and observability' }),
    ).toBeVisible();
    const members = sprint.getByRole('tabpanel', { name: 'SPRINT-009 items' });
    await expect(members).toContainText('QT-071');
    await expect(members.getByRole('listitem')).toHaveCount(3);
    await expect(sprint).toContainText('Recover failed registrations');
    await expect(members.locator('.pc-sprints__last[data-kind="blocker"]')).toHaveText([
      'by T-072',
      'by QT-071',
    ]);
    expect(operateReads).toEqual([]);
    expect((await layoutReport(page)).horizontalOverflow).toBe(false);
    expect(await axeViolations(page)).toEqual([]);
  });

  test('retains the List view and selection through a validated live patch', async ({ page }) => {
    const initialGraphResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/planning/graph',
    );
    const initialStream = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/planning/events',
    );
    await openFixture(page, '#/list', {
      planningScenario: 'live-list',
      planningSession: `list-${Date.now()}`,
    });
    await initialStream;
    const initialWire = (await (await initialGraphResponse).json()) as PlanningGraphEnvelope;
    const identity = createDashboardQueryIdentity({
      ...initialWire.binding,
      ...initialWire.cursor,
      productArea: 'planning',
      route: '#/list',
      cycleId: null,
      subjectId: null,
    });
    const initial = parsePlanningGraphEnvelope(initialWire, identity);
    const list = page.locator('[data-route-kind="planning.list"]');
    await list.getByRole('textbox', { name: 'Filter by id or title' }).fill('Live list artifact');
    await list.getByRole('combobox', { name: /^Type:/u }).click();
    await page.getByRole('option', { name: 'Task', exact: true }).click();
    await page.keyboard.press('Escape');
    await list.getByRole('combobox', { name: /^Status:/u }).click();
    await page.getByRole('option', { name: 'Outstanding', exact: true }).click();
    await page.keyboard.press('Escape');
    const compact = list.getByRole('button', { name: 'Compact', exact: true });
    await compact.click();
    await expect(compact).toHaveAttribute('aria-pressed', 'true');
    await list.getByRole('button', { name: 'Updated', exact: true }).click();
    await expect(list.getByRole('columnheader', { name: 'Updated', exact: true })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await list.getByRole('button', { name: 'Next', exact: true }).click();
    const selected = list.getByRole('row').filter({ hasText: 'list-item-101' });
    await selected.click();
    await expect(selected).toHaveAttribute('data-selected', 'true');
    await expect(list.locator('.pc-list__page-status')).toContainText('Showing 101–');

    await page.evaluate(() => {
      const state = { pending: false, removedList: false, notice: false };
      const contains = (node: Node, selector: string) =>
        node instanceof Element &&
        (node.matches(selector) || node.querySelector(selector) !== null);
      const observer = new MutationObserver((records) => {
        state.pending ||= records.some((record) =>
          Array.from(record.addedNodes).some((node) => contains(node, '[data-route-pending]')),
        );
        state.notice ||= records.some((record) =>
          Array.from(record.addedNodes).some((node) =>
            contains(node, '.op-planning-notice:not(.pc-visually-hidden)'),
          ),
        );
        state.removedList ||= records.some((record) =>
          Array.from(record.removedNodes).some((node) =>
            contains(node, '[data-route-kind="planning.list"]'),
          ),
        );
      });
      observer.observe(document.body, { childList: true, subtree: true });
      Reflect.set(window, '__fixtureListObservation', { state, observer });
    });

    let releaseRefresh: (() => void) | undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    await page.route('**/api/planning/graph?*', async (route) => {
      await refreshGate;
      await route.continue();
    });
    const refreshStarted = page.waitForRequest(
      (request) => new URL(request.url()).pathname === '/api/planning/graph',
    );
    try {
      const event = parsePlanningLiveEvent(
        await page.evaluate(async () => {
          const response = await fetch('/api/fixture/planning/patch', { method: 'POST' });
          if (!response.ok) throw new Error(`Live List patch failed: ${response.status}`);
          return response.json();
        }),
        identity,
      );
      expect(event.event).toBe('patch');
      expect(event.cursor.eventHead.sequence).toBe(initial.cursor.eventHead.sequence + 1);
      expect(event.cursor.viewHash).not.toBe(initial.cursor.viewHash);
      await refreshStarted;
      await expect(list).toBeVisible();
      await expect(page.locator('[data-route-pending]')).toHaveCount(0);
      await expect(list.locator('.op-planning-notice:not(.pc-visually-hidden)')).toHaveCount(0);
      await expect(selected).toHaveAttribute('data-selected', 'true');

      const checkpoint = encodePlanningCheckpoint(event.cursor);
      const cursorApplied = page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname === '/api/planning/events' &&
          request.headers()['last-event-id'] === checkpoint,
      );
      if (!releaseRefresh) throw new Error('Live List refresh gate is missing.');
      releaseRefresh();
      await cursorApplied;
      await expect(selected).toContainText('Live list artifact 101 refreshed');
      await expect(list.getByRole('textbox', { name: 'Filter by id or title' })).toHaveValue(
        'Live list artifact',
      );
      await expect(list.getByRole('combobox', { name: /^Type:/u })).toHaveText('Type: task');
      await expect(list.getByRole('combobox', { name: /^Status:/u })).toHaveText(
        'Status: outstanding',
      );
      await expect(compact).toHaveAttribute('aria-pressed', 'true');
      await expect(
        list.getByRole('columnheader', { name: 'Updated', exact: true }),
      ).toHaveAttribute('aria-sort', 'ascending');
      await expect(list.locator('.pc-list__page-status')).toContainText('Showing 101–');
      await expect(selected).toHaveAttribute('data-selected', 'true');
      await expect(page.locator('[data-route-pending]')).toHaveCount(0);
      await expect(list.locator('.op-planning-notice:not(.pc-visually-hidden)')).toHaveCount(0);
      const observation = await page.evaluate(() => {
        const value = Reflect.get(window, '__fixtureListObservation') as {
          state: { pending: boolean; removedList: boolean; notice: boolean };
          observer: MutationObserver;
        };
        value.observer.disconnect();
        Reflect.deleteProperty(window, '__fixtureListObservation');
        return value.state;
      });
      expect(observation).toEqual({ pending: false, removedList: false, notice: false });
    } finally {
      releaseRefresh?.();
      await page.unroute('**/api/planning/graph?*');
    }
  });

  test('does not replace a verified Planning workspace while changing Planning routes', async ({
    page,
  }) => {
    await openFixture(page, '#/search');

    const transition = await page.evaluate(async () => {
      const main = document.querySelector<HTMLElement>('#main-content');
      if (!main) throw new Error('Dashboard main landmark is missing.');
      const states: string[] = [];
      const sample = () => states.push(main.textContent ?? '');
      const observer = new MutationObserver(sample);
      observer.observe(main, { childList: true, subtree: true, characterData: true });

      window.location.hash = '#/graph';
      sample();
      await new Promise((resolve) => window.setTimeout(resolve, 200));
      observer.disconnect();
      sample();

      return {
        route: window.location.hash,
        showedPlanningRefusal: states.some((text) => text.includes('Planning cannot be trusted')),
      };
    });

    expect(transition).toEqual({ route: '#/graph', showedPlanningRefusal: false });
    await expect(page.locator('[data-route-kind="planning.graph"]')).toBeVisible();
    await expect(page.locator('[data-route-kind="planning.graph"]')).toContainText(
      'Everything outside the focus is hidden, not deleted.',
    );
  });

  test('passes axe on representative Planning and Operate routes', async ({ page }) => {
    for (const route of ['#/overview', '#/graph', '#/operate/today', '#/operate/actions']) {
      await openFixture(page, route);
      expect(await axeViolations(page), `axe violations on ${route}`).toEqual([]);
    }
  });

  test('keeps Planning Home bounded and decision-focused through the Overview alias', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFixture(page, '#/overview');

    const overview = page.locator('[data-route-kind="planning.overview"]');
    await expect(page).toHaveURL(/#\/home$/u);
    await expect(
      overview.getByRole('heading', { level: 1, name: 'Needs attention', exact: true }),
    ).toBeVisible();
    await expect(overview).toContainText(/\d+ items? needs? you\./u);
    await expect(
      overview.getByRole('heading', { name: /^Waiting on a dependency/u }),
    ).toBeVisible();
    await expect(
      overview.getByRole('heading', { name: /^In progress, gone quiet/u }),
    ).toBeVisible();
    await expect(
      overview.getByRole('heading', { name: /^High priority, not started/u }),
    ).toBeVisible();
    await expect(overview).not.toContainText('Phase 2');
    await expect(overview).toContainText('No active sprint');
    expect((await layoutReport(page)).horizontalOverflow).toBe(false);
    await expectGoldenScreenshot(page, 'console-planning-overview-wide.png');
  });

  test('keeps a sparse Planning Board focused at wide and narrow widths', async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await openFixture(page, '#/board');

      const phone = viewport.width < 900;
      const workspace = page.locator('[data-route-kind="planning.board"]');
      const board = page.locator('.pc-status-board');
      const columns = board.locator('.pc-status-board__column');
      await expect(columns).toHaveCount(phone ? 1 : 5);
      if (phone) await workspace.getByRole('tab', { name: /^In progress/u }).click();
      const inProgress = board.locator('[data-keyboard-column="in-progress"]');
      await expect(inProgress).toContainText('Improve appointment reminder delivery');
      for (const [status, label] of [
        ['outstanding', 'Outstanding'],
        ['blocked', 'Blocked'],
        ['addressed', 'Addressed'],
        ['done', 'Done'],
      ]) {
        if (phone) await workspace.getByRole('tab', { name: new RegExp(`^${label}`, 'u') }).click();
        const emptySlot = board
          .getByRole('region', { name: status, exact: true })
          .getByRole('button', { name: `Nothing is ${label.toLowerCase()}.`, exact: true });
        await expect(emptySlot).toBeVisible();
        await emptySlot.focus();
        await expect(emptySlot).toBeFocused();
      }
      expect((await layoutReport(page)).horizontalOverflow).toBe(false);

      if (viewport.width >= 1024) {
        await expectSurfaceToUseRouteFrame(page, '[data-route-kind="planning.board"]');
      }
    }
  });

  test('keeps Board status lanes read-only and keyboard reachable in both themes and sizes', async ({
    page,
  }, testInfo) => {
    const writes: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET')
        writes.push(`${request.method()} ${request.url()}`);
    });
    await page.addInitScript(() => {
      const theme = new URL(window.location.href).searchParams.get('boardTheme');
      if (theme === 'dark' || theme === 'light') localStorage.setItem('op-theme', theme);
    });
    for (const theme of ['dark', 'light']) {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 960 });
        await openFixture(page, '#/board', { planningScenario: 'delivery', boardTheme: theme });
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => localStorage.getItem('op-theme'))).toBe(theme);
        const board = page.locator('[data-route-kind="planning.board"]');
        await expect(board.getByRole('checkbox', { name: 'Hide done', exact: true })).toBeChecked();
        const card = board.locator('.pc-status-board__card [data-keyboard-item]').first();
        await card.focus();
        await page.keyboard.press('Enter');
        await expect(
          page.getByRole('dialog', {
            name: 'Inspector',
            exact: true,
          }),
        ).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(card).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await expect(board.locator('[data-keyboard-item]:focus')).toHaveCount(1);
        await board.getByRole('button', { name: /^Lanes/u }).click();
        await expect(board.locator('.pc-status-board__lane')).not.toHaveCount(0);
        expect(await board.locator('[draggable="true"]').count()).toBe(0);
        await board.locator('.pc-status-board__card').first().dispatchEvent('dragstart');
        await board.locator('.pc-status-board__column').last().dispatchEvent('drop');
        await expect(board).not.toContainText('Phase 2');
        expect((await layoutReport(page)).horizontalOverflow).toBe(false);
        expect(await axeViolations(page)).toEqual([]);
        await attachScreenshot(
          page,
          `planning-board-${theme}-${width}.png`,
          testInfo.attach.bind(testInfo),
        );
      }
    }
    expect(writes).toEqual([]);
  });

  test('matches the Board to its canvas parity rows in both themes', async ({ page }, testInfo) => {
    const results: unknown[] = [];
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const viewports = {
      D: { width: 1440, height: 900 },
      T: { width: 768, height: 1024 },
      M: { width: 390, height: 844 },
    } as const;
    for (const theme of ['dark', 'light'] as const) {
      for (const viewport of ['D', 'M'] as const) {
        await page.setViewportSize(viewports[viewport]);
        for (const setup of [null, 'select', 'lanes'] as const) {
          const rows = boardParityRows.filter(
            (row) => row.viewport === viewport && row.setup === setup,
          );
          if (!rows.length) continue;
          const dataset = setup === 'lanes' ? 'artboard' : 'representative';
          await page.goto(fixtureUrl('#/board', { dataset, theme }));
          await page.evaluate(() => localStorage.removeItem('op-board-view:v1'));
          await page.reload();
          await page.evaluate(() => document.fonts.ready);
          const board = page.locator('[data-route-kind="planning.board"]');
          await expect(board.locator('.pc-status-board__card').first()).toBeVisible();
          if (setup === 'select') await board.locator('.pc-status-board__open').first().focus();
          if (setup === 'lanes') {
            await board.getByRole('button', { name: /^Lanes/u }).click();
            await expect(board.locator('.pc-status-board__lane').first()).toBeVisible();
          }
          for (const row of rows) results.push(...(await assertParityRow(page, row, theme)));
          if (setup === null) {
            const text = await page.locator('#main-content').innerText();
            for (const banned of ['Unknown', 'Not recorded', 'None declared', 'Phase 2'])
              expect(text, `S-21 ${banned}`).not.toContain(banned);
            expect(text, 'S-21 none').not.toMatch(/\bnone\b/u);
          }
          if (setup === 'select') {
            const accents = await page.evaluate(() => {
              const accent = getComputedStyle(document.documentElement)
                .getPropertyValue('--op-accent')
                .trim();
              const probe = document.createElement('span');
              probe.style.backgroundColor = accent;
              document.body.append(probe);
              const resolved = getComputedStyle(probe).backgroundColor;
              probe.remove();
              return [...document.querySelectorAll<HTMLElement>('#main-content *')].filter(
                (node) =>
                  getComputedStyle(node).backgroundColor === resolved &&
                  !node.closest(
                    'nav, :focus, [aria-pressed="true"], [data-selected="true"], [data-status="in-progress"]',
                  ) &&
                  !node.matches('.pc-checkbox__box'),
              ).length;
            });
            expect(accents, 'S-22 accent backgrounds').toBeLessThanOrEqual(1);
            await page.keyboard.press('Tab');
            await page.keyboard.press('Shift+Tab');
            const outline = await page.evaluate(async () => {
              for (let frame = 0; frame < 2; frame += 1)
                await new Promise((resolve) => requestAnimationFrame(resolve));
              await new Promise((resolve) => setTimeout(resolve, 50));
              const focused = document.querySelector(':focus-visible');
              const style = focused ? getComputedStyle(focused) : null;
              return style && [style.outlineStyle, style.outlineWidth, style.outlineOffset];
            });
            expect(outline, 'S-20 focus outline').toEqual(['solid', '2px', '2px']);
          }
        }
      }
      for (const [viewport, size] of Object.entries(viewports)) {
        await page.setViewportSize(size);
        for (const view of ['columns', 'lanes']) {
          await page.goto(fixtureUrl('#/board', { dataset: 'artboard', theme }));
          await page.evaluate((value) => localStorage.setItem('op-board-view:v1', value), view);
          await page.reload();
          await page.evaluate(() => document.fonts.ready);
          await expect(page.locator('.pc-status-board__card').first()).toBeVisible();
          await page.screenshot({
            path: testInfo.outputPath(`board-${view}-${viewport}-${theme}.png`),
          });
        }
      }
    }
    const parity = testInfo.outputPath('board-parity.json');
    writeFileSync(parity, JSON.stringify(results, null, 2));
    await testInfo.attach('board-parity.json', { path: parity, contentType: 'application/json' });
  });

  test('matches Home to its canvas parity rows in both themes', async ({ page }, testInfo) => {
    const results: unknown[] = [];
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const viewports = {
      D: { width: 1440, height: 900 },
      T: { width: 768, height: 1024 },
      M: { width: 390, height: 844 },
    } as const;
    for (const theme of ['dark', 'light'] as const) {
      for (const viewport of ['D', 'M'] as const) {
        await page.setViewportSize(viewports[viewport]);
        await page.goto(fixtureUrl('#/home', { dataset: 'representative', theme }));
        await page.evaluate(() => document.fonts.ready);
        const home = page.locator('[data-route-kind="planning.overview"]');
        await expect(home.locator('.pc-home__row').first()).toBeVisible();
        for (const row of homeParityRows.filter((entry) => entry.viewport === viewport))
          results.push(...(await assertParityRow(page, row, theme)));
        const text = await page.locator('#main-content').innerText();
        for (const banned of ['Unknown', 'Not recorded', 'None declared', 'Phase 2'])
          expect(text, `S-21 ${banned}`).not.toContain(banned);
        expect(text, 'S-21 none').not.toMatch(/\bnone\b/u);
        await home.locator('.pc-home__row .pc-artifact-row__link').first().focus();
        const bar = page.locator('.pc-selection-bar');
        await expect(bar).toBeVisible();
        const accents = await page.evaluate(() => {
          const accent = getComputedStyle(document.documentElement)
            .getPropertyValue('--op-accent')
            .trim();
          const probe = document.createElement('span');
          probe.style.backgroundColor = accent;
          document.body.append(probe);
          const resolved = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return [...document.querySelectorAll<HTMLElement>('#main-content *')].filter(
            (node) =>
              getComputedStyle(node).backgroundColor === resolved &&
              !node.closest('nav, :focus, [data-selected="true"], .pc-home__progress'),
          ).length;
        });
        expect(accents, 'S-22 accent backgrounds').toBeLessThanOrEqual(1);
        const command = await bar.locator('code').textContent();
        expect(command).toMatch(/^(?:\/planr:|openplanr )/u);
        await page.keyboard.press('c');
        await expect(bar.locator('.pc-selection-bar__copy')).toContainText('Copied');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
      }
      for (const [viewport, size] of Object.entries(viewports)) {
        await page.setViewportSize(size);
        await page.goto(fixtureUrl('#/home', { dataset: 'artboard', theme }));
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('.pc-home__card').first()).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath(`home-${viewport}-${theme}.png`),
          fullPage: true,
        });
      }
    }
    const parity = testInfo.outputPath('home-parity.json');
    writeFileSync(parity, JSON.stringify(results, null, 2));
    await testInfo.attach('home-parity.json', { path: parity, contentType: 'application/json' });
  });

  test('matches the List to its canvas parity rows in both themes', async ({ page }, testInfo) => {
    const results: unknown[] = [];
    const emptyView =
      '#/list?v=eyJzY2hlbWFWZXJzaW9uIjoiMS4wLjAiLCJyb3V0ZSI6Imxpc3QiLCJmaWx0ZXJzIjp7InR5cGUiOltdLCJzdGF0dXMiOlsiYmxvY2tlZCJdLCJwcmlvcml0eSI6W10sImxhYmVsIjpbInNlY3VyaXR5Il0sInF1ZXJ5IjoiZW50cmEiLCJjcmVhdGVkV2l0aGluRGF5cyI6bnVsbCwidXBkYXRlZFdpdGhpbkRheXMiOm51bGx9LCJncm91cEJ5Ijoic3BlYyIsInNvcnQiOnsiZmllbGQiOiJ1cGRhdGVkIiwiZGlyZWN0aW9uIjoiZGVzYyJ9LCJkZW5zaXR5IjoiY29tZm9ydGFibGUiLCJmb2N1c0lkIjpudWxsfQ';
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    // The canvases draw the compact rail.
    await page.addInitScript(() => localStorage.setItem('op-rail-compact:v1', 'true'));
    const list = page.locator('[data-route-kind="planning.list"]');
    for (const theme of ['dark', 'light'] as const) {
      const open = async (hash: string, dataset = 'representative') => {
        await page.goto(fixtureUrl(hash, { dataset, theme }));
        await page.evaluate(() => document.fonts.ready);
        await expect(list.locator('.pc-list__toolbar')).toBeVisible();
      };
      // Specs head their own groups, so item rows start below the spec-only groups.
      const revealRows = async () => {
        await list.locator('.pc-list__group-header').last().scrollIntoViewIfNeeded();
        await expect(list.locator('tbody tr[data-keyboard-item]').first()).toBeVisible();
      };
      const check = async (setup: string | null) => {
        // Reduced motion still runs a 0.01ms transition; read styles once it has settled.
        await page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        );
        for (const row of listParityRows.filter((entry) => (entry.setup ?? null) === setup))
          results.push(...(await assertParityRow(page, row, theme)));
      };
      await open('#/list');
      await list.getByRole('tab', { name: /^Open by spec/u }).click();
      await revealRows();
      await check(null);
      const text = await list.innerText();
      for (const banned of ['Unknown', 'Not recorded', 'None declared', 'Phase 2'])
        expect(text, `S-21 ${banned}`).not.toContain(banned);
      expect(text, 'S-21 none').not.toMatch(/\bnone\b/u);
      const first = list.locator('tbody tr[data-keyboard-item]').first();
      await first.locator('.pc-list__check').click();
      const bar = page.locator('.pc-selection-bar');
      await expect(bar).toBeVisible();
      await expect(first).toHaveAttribute('aria-selected', 'true');
      await check('list-select');
      const command = await bar.locator('code').textContent();
      expect(command).toMatch(/^(?:\/planr:|openplanr )/u);
      await first.focus();
      await page.keyboard.press('c');
      await expect(bar.locator('.pc-selection-bar__copy')).toContainText('Copied');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
      await bar.getByRole('button', { name: 'Clear selection' }).click();
      await page.evaluate(() => {
        // The fixtures carry no labels, so one cell takes drawn label markup to measure its recipe.
        const cell = document.querySelector('[data-route-kind="planning.list"] .pc-list__labels');
        if (!cell) throw new Error('Missing List labels cell.');
        cell.innerHTML =
          '<span>dashboard</span><span>ci</span><span class="pc-list__labels-more" title="cli, docs">+2</span>';
      });
      await check('list-labels');
      await list.getByRole('button', { name: 'Compact', exact: true }).click();
      await expect(list.locator('table')).toHaveAttribute('data-compact', 'true');
      await revealRows();
      await check('list-compact');
      await list.getByRole('button', { name: 'Comfortable', exact: true }).click();
      await list.getByRole('combobox', { name: /^Status:/u }).click();
      await expect(page.locator('.pc-chip-menu__popup')).toBeVisible();
      await check('list-menu');
      await page.keyboard.press('Escape');
      await open(emptyView);
      await expect(list.locator('.pc-list__empty')).toBeVisible();
      await check('list-empty');
      await open('#/list', 'artboard');
      await page.screenshot({ path: testInfo.outputPath(`list-D-${theme}.png`) });
      await page.setViewportSize({ width: 768, height: 1024 });
      await open('#/list');
      await expect(list).toHaveAttribute('data-list-layout', 'tablet');
      await revealRows();
      await check('list-T');
      await open('#/list', 'artboard');
      await page.screenshot({ path: testInfo.outputPath(`list-T-${theme}.png`) });
      await page.setViewportSize({ width: 390, height: 844 });
      await open('#/list');
      await expect(list).toHaveAttribute('data-list-layout', 'phone');
      await revealRows();
      await check('list-M');
      const overflow = await list
        .locator('.pc-list__window')
        .evaluate((node) => node.getBoundingClientRect().right - innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await list.getByRole('button', { name: /^Filters/u }).click();
      await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
      await expect(page.locator('.pc-list-sheet__apply')).toHaveText(/^Show \d+ items?$/u);
      await check('list-sheet');
      await page.keyboard.press('Escape');
      await open('#/list', 'artboard');
      await page.screenshot({ path: testInfo.outputPath(`list-M-${theme}.png`) });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    const parity = testInfo.outputPath('list-parity.json');
    writeFileSync(parity, JSON.stringify(results, null, 2));
    await testInfo.attach('list-parity.json', { path: parity, contentType: 'application/json' });
  });

  test('matches Detail to its canvas parity rows in both themes', async ({ page }, testInfo) => {
    const results: unknown[] = [];
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 1276 });
    await page.addInitScript(() => localStorage.setItem('op-rail-compact:v1', 'true'));
    const routes = {
      'detail-task': '#/detail/SPEC-026%2FT-112',
      'detail-missing': '#/detail/SPEC-026%2FT-112',
      'detail-spec': '#/detail/SPEC-026',
    } as const;
    const banned = ['Unknown', 'Not recorded', 'None declared', 'Phase 2', 'Source:'];
    for (const theme of ['dark', 'light'] as const) {
      for (const [setup, hash] of Object.entries(routes)) {
        await page.goto(fixtureUrl(hash, { dataset: 'artboard', theme }));
        await page.evaluate(() => document.fonts.ready);
        const detail = page.locator('[data-route-kind="planning.detail"]');
        await expect(
          detail.locator('[data-detail-state="ready"] .pc-detail__columns'),
        ).toBeVisible();
        if (setup === 'detail-missing')
          // No fixture item declares a missing reference; measure the drawn chip recipe.
          await detail
            .locator('.pc-detail__properties dd')
            .first()
            .evaluate((dd) => {
              const chip = document.createElement('span');
              chip.className = 'pc-detail__property-reference';
              chip.dataset.missing = '';
              chip.innerHTML = '<code>T-301</code> not found';
              dd.append(chip);
            });
        for (const row of detailParityRows.filter((entry) => entry.setup === setup))
          results.push(...(await assertParityRow(page, row, theme)));
        const text = await page.locator('#main-content').innerText();
        for (const word of banned) expect(text, `S-21 ${word}`).not.toContain(word);
        expect(text, 'S-21 none').not.toMatch(/\bnone\b/u);
        if (setup !== 'detail-task') continue;
        await expect(page.locator('.pc-rail')).toBeVisible();
        expect(await page.locator('.pc-topbar__breadcrumbs').innerText()).toMatch(
          /^Plan\s*\/\s*List\s*\/\s*SPEC-026\s*\/\s*T-112$/u,
        );
        expect((await detail.locator('.pc-detail__header').boundingBox())?.x).toBeCloseTo(97, -1);
        expect((await layoutReport(page)).horizontalOverflow).toBe(false);
        await page.screenshot({
          path: testInfo.outputPath(`detail-D-${theme}.png`),
          fullPage: true,
        });
      }
      await page.goto(fixtureUrl('#/list', { dataset: 'artboard', theme }));
      const row = page.locator('.pc-list tbody [data-keyboard-item]').first();
      await row.click();
      const inspector = page.getByRole('dialog', { name: 'Inspector', exact: true });
      await expect(inspector.locator('[data-detail-state="ready"]')).toBeVisible();
      const inspectorText = await inspector.innerText();
      for (const word of banned)
        expect(inspectorText, `S-21 Inspector ${word}`).not.toContain(word);
      expect(inspectorText, 'S-21 Inspector none').not.toMatch(/\bnone\b/u);
    }
    const parity = testInfo.outputPath('detail-parity.json');
    writeFileSync(parity, JSON.stringify(results, null, 2));
    await testInfo.attach('detail-parity.json', { path: parity, contentType: 'application/json' });
  });

  test('fits Detail to phone width with selection and focus rings in both themes', async ({
    page,
  }, testInfo) => {
    const results: unknown[] = [];
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const focusRings = async (presses: number) => {
      const rings: unknown[] = [];
      for (let press = 0; press < presses; press += 1) {
        await page.keyboard.press('Tab');
        rings.push(
          await page.evaluate(async () => {
            for (let frame = 0; frame < 2; frame += 1)
              await new Promise((resolve) => requestAnimationFrame(resolve));
            const focused = document.querySelector(':focus-visible');
            if (!focused) return null;
            const style = getComputedStyle(focused);
            return {
              element: `${focused.tagName.toLowerCase()}.${focused.className}`,
              ring: [style.outlineStyle, style.outlineWidth, style.outlineOffset],
            };
          }),
        );
      }
      return rings.filter(Boolean) as { element: string; ring: string[] }[];
    };
    for (const theme of ['dark', 'light'] as const) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(fixtureUrl('#/detail/SPEC-026%2FT-112', { dataset: 'artboard', theme }));
      await page.evaluate(() => document.fonts.ready);
      const detail = page.locator('[data-route-kind="planning.detail"]');
      await expect(detail.locator('[data-detail-state="ready"] .pc-detail__columns')).toBeVisible();
      for (const row of detailParityRows.filter((entry) => entry.setup === 'detail-M'))
        results.push(...(await assertParityRow(page, row, theme)));
      const header = page.locator('.pc-topbar[data-detail-header]');
      await expect(header.getByRole('link', { name: 'Back to List' })).toHaveAttribute(
        'href',
        '#/list',
      );
      await expect(header.locator('[aria-current="page"]')).toHaveText('T-112');
      await expect(header.getByRole('button', { name: 'Copy link' })).toBeVisible();
      await expect(header.getByRole('button', { name: /^Jump to a view/u })).toHaveCount(0);
      await expect(header.locator('.pc-topbar__end')).toHaveCount(0);
      await expect(detail.locator('.pc-detail__navigation')).toHaveCount(0);
      expect((await layoutReport(page)).horizontalOverflow).toBe(false);
      const dock = page.getByRole('region', { name: 'Next step command' });
      await expect(dock).toBeVisible();
      const dockBox = await dock.boundingBox();
      const navBox = await page.locator('.pc-mobile-nav').boundingBox();
      expect(Math.round((dockBox?.y ?? 0) + (dockBox?.height ?? 0))).toBe(
        Math.round(navBox?.y ?? -1),
      );
      await page.screenshot({ path: testInfo.outputPath(`detail-M-${theme}.png`) });
      const spec = detail
        .locator('.pc-detail__trace a.pc-detail__step')
        .filter({ hasText: 'SPEC-026' });
      await spec.click();
      await expect(spec).toHaveAttribute('data-selected', 'true');
      await expect(dock).toHaveCount(0);
      const bar = page.getByRole('region', { name: 'Selected items' });
      const command = (await bar.locator('.pc-selection-bar__command').textContent()) ?? '';
      expect(command).toContain('SPEC-026');
      await page.screenshot({ path: testInfo.outputPath(`detail-M-selected-${theme}.png`) });
      await page.keyboard.press('c');
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(command);
      await page.keyboard.press('Escape');
      await expect(bar).toHaveCount(0);
      await expect(dock).toBeVisible();
      for (const { element, ring } of await focusRings(24))
        expect(ring, `S-20 ${element} at 390`).toEqual(['solid', '2px', '2px']);
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(header.getByRole('link', { name: 'Back to List' })).toBeVisible();
      await expect(header.locator('.pc-topbar__end')).toContainText('Live');
      const palette = header.getByRole('button', { name: /^Jump to a view/u });
      await expect(palette).toBeVisible();
      expect((await palette.boundingBox())?.width).toBe(44);
      await expect(header.getByRole('button', { name: 'Copy link' })).toBeVisible();
      expect((await layoutReport(page)).horizontalOverflow).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`detail-T-${theme}.png`) });
      await page.setViewportSize({ width: 1440, height: 1276 });
      await page.goto(fixtureUrl('#/detail/SPEC-026%2FT-112', { dataset: 'artboard', theme }));
      await expect(detail.locator('[data-detail-state="ready"] .pc-detail__columns')).toBeVisible();
      await detail.locator('.pc-detail__trace a.pc-detail__step').first().click();
      for (const { element, ring } of await focusRings(20))
        expect(ring, `S-20 ${element} at 1440`).toEqual(['solid', '2px', '2px']);
    }
    const parity = testInfo.outputPath('detail-m-parity.json');
    writeFileSync(parity, JSON.stringify(results, null, 2));
    await testInfo.attach('detail-m-parity.json', {
      path: parity,
      contentType: 'application/json',
    });
  });

  test('matches Sprints to its canvas parity rows in both themes', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const results: unknown[] = [];
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 1400 });
    await page.addInitScript(() => localStorage.setItem('op-rail-compact:v1', 'true'));
    await page.clock.setFixedTime(new Date(SPRINT_SCENARIO_NOW));
    const scenarios = {
      'sprints-active': { planningScenario: 'sprint' },
      'sprints-bare': { planningScenario: 'sprint-bare' },
      'sprints-none': { dataset: 'artboard' },
    } as const;
    const banned = ['Unknown', 'Not recorded', 'None declared', 'Phase 2', 'Release cut:'];
    for (const theme of ['dark', 'light'] as const) {
      for (const [setup, query] of Object.entries(scenarios)) {
        await page.goto(fixtureUrl('#/sprints', { ...query, theme }));
        await page.evaluate(() => document.fonts.ready);
        const sprints = page.locator('[data-route-kind="planning.sprints"]');
        await expect(
          sprints.locator(setup === 'sprints-none' ? '.pc-sprints__none' : '.pc-sprints__active'),
        ).toBeVisible();
        for (const row of sprintsParityRows.filter((entry) => entry.setup === setup))
          results.push(...(await assertParityRow(page, row, theme)));
        const text = await page.locator('#main-content').innerText();
        for (const word of banned) expect(text, `S-21 ${word}`).not.toContain(word);
        expect(text, 'S-21 none').not.toMatch(/\bnone\b/u);
        expect((await sprints.locator('.pc-sprints__header').boundingBox())?.x).toBeCloseTo(97, -1);
        expect((await layoutReport(page)).horizontalOverflow).toBe(false);
        await page.screenshot({
          path: testInfo.outputPath(`${setup}-D-${theme}.png`),
          fullPage: true,
        });
        if (setup === 'sprints-none') {
          const primary = sprints.getByRole('button', { name: 'Copy /planr:sprint' });
          await primary.click();
          await expect(primary.locator('.pc-copy-label > [data-active="true"]')).toHaveText(
            'Copied',
          );
          await expect(primary).toBeVisible();
          expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/planr:sprint');
          continue;
        }
        if (setup !== 'sprints-active') continue;
        const row = sprints.locator('.pc-sprints__item-link').first();
        await row.click();
        await expect(row).toHaveAttribute('aria-current', 'true');
        const bar = page.locator('.pc-selection-bar');
        await expect(bar).toBeVisible();
        const command = await bar.locator('code').textContent();
        expect(command).toMatch(/^(?:\/planr:|openplanr )/u);
        await page.keyboard.press('Escape');
        await row.focus();
        await page.keyboard.press('c');
        await expect(bar.locator('.pc-selection-bar__copy')).toContainText('Copied');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
        await page.screenshot({ path: testInfo.outputPath(`sprints-selected-D-${theme}.png`) });
        await page.goto(fixtureUrl('#/sprints', { ...query, theme }));
        await expect(sprints.locator('.pc-sprints__active')).toBeVisible();
        await page.locator('body').click({ position: { x: 1, y: 1 } });
        const rings: { element: string; ring: string[] }[] = [];
        for (let press = 0; press < 30; press += 1) {
          await page.keyboard.press('Tab');
          const ring = await page.evaluate(async () => {
            for (let frame = 0; frame < 2; frame += 1)
              await new Promise((resolve) => requestAnimationFrame(resolve));
            // Focus also selects the row, which restarts the reduced-motion transition.
            await new Promise((resolve) => setTimeout(resolve, 50));
            const focused = document.querySelector(
              '[data-route-kind="planning.sprints"] :focus-visible',
            );
            if (!focused) return null;
            const style = getComputedStyle(focused);
            return {
              element: `${focused.tagName.toLowerCase()}.${focused.className}`,
              ring: [style.outlineStyle, style.outlineWidth, style.outlineOffset],
            };
          });
          if (ring) rings.push(ring);
        }
        expect(rings.length).toBeGreaterThan(10);
        for (const { element, ring } of rings)
          expect(ring, `S-20 ${element} at 1440`).toEqual(['solid', '2px', '2px']);
      }
    }
    const parity = testInfo.outputPath('sprints-parity.json');
    writeFileSync(parity, JSON.stringify(results, null, 2));
    await testInfo.attach('sprints-parity.json', { path: parity, contentType: 'application/json' });
  });

  test('matches Activity to its canvas parity rows in both themes', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const results: unknown[] = [];
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.addInitScript(() => localStorage.setItem('op-rail-compact:v1', 'true'));
    await page.clock.setFixedTime(new Date(ARTBOARD_FIXTURE_CLOCK));
    const banned = ['Unknown', 'Not recorded', 'None declared', 'Phase 2'];
    for (const theme of ['dark', 'light'] as const) {
      expect((await page.request.post('/__fixture/reset?dataset=artboard')).ok()).toBe(true);
      await page.goto(fixtureUrl('#/activity', { dataset: 'artboard', theme }));
      await page.evaluate(() => document.fonts.ready);
      const activity = page.locator('[data-route-kind="planning.activity"]');
      await expect(activity.locator('.pc-activity__connection')).toContainText('Watching');
      await expect(activity.locator('.pc-activity__row').first()).toBeVisible();
      for (const kind of ['title', 'status', 'remove'])
        expect(
          (await page.request.post(`/__fixture/patch?dataset=artboard&kind=${kind}`)).ok(),
        ).toBe(true);
      await expect(activity.locator('.pc-activity__live-row')).toHaveCount(3);
      for (const row of activityParityRows.filter((entry) => entry.setup === 'activity'))
        results.push(...(await assertParityRow(page, row, theme)));
      const text = await page.locator('#main-content').innerText();
      for (const word of banned) expect(text, `S-21 ${word}`).not.toContain(word);
      expect(text, 'S-21 none').not.toMatch(/\bnone\b/u);
      expect((await activity.locator('.pc-activity__header h1').boundingBox())?.x).toBeCloseTo(
        97,
        -1,
      );
      expect((await layoutReport(page)).horizontalOverflow).toBe(false);
      expect(await axeViolations(page)).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`activity-D-${theme}.png`),
        fullPage: true,
      });
      const row = activity.locator('a.pc-activity__cells').first();
      await row.click();
      await expect(row).toHaveAttribute('aria-current', 'true');
      const bar = page.locator('.pc-selection-bar');
      await expect(bar).toBeVisible();
      const command = await bar.locator('code').textContent();
      expect(command).toMatch(/^(?:\/planr:|openplanr )/u);
      await page.screenshot({ path: testInfo.outputPath(`activity-selected-D-${theme}.png`) });
      await page.keyboard.press('Escape');
      await row.focus();
      await page.keyboard.press('c');
      await expect(bar.locator('.pc-selection-bar__copy')).toContainText('Copied');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
      await page.goto(fixtureUrl('#/activity', { dataset: 'artboard', theme }));
      await expect(activity.locator('.pc-activity__row').first()).toBeVisible();
      await page.locator('body').click({ position: { x: 1, y: 1 } });
      const rings: { element: string; ring: string[] }[] = [];
      for (let press = 0; press < 30; press += 1) {
        await page.keyboard.press('Tab');
        const ring = await page.evaluate(async () => {
          for (let frame = 0; frame < 2; frame += 1)
            await new Promise((resolve) => requestAnimationFrame(resolve));
          // Focus also selects the row, which restarts the reduced-motion transition.
          await new Promise((resolve) => setTimeout(resolve, 50));
          const focused = document.querySelector(
            '[data-route-kind="planning.activity"] :focus-visible',
          );
          if (!focused) return null;
          const style = getComputedStyle(focused);
          return {
            element: `${focused.tagName.toLowerCase()}.${focused.className}`,
            ring: [style.outlineStyle, style.outlineWidth, style.outlineOffset],
          };
        });
        if (ring) rings.push(ring);
      }
      expect(rings.length).toBeGreaterThan(10);
      for (const { element, ring } of rings)
        expect(ring, `S-20 ${element} at 1440`).toEqual(['solid', '2px', '2px']);
    }
    const parity = testInfo.outputPath('activity-parity.json');
    writeFileSync(parity, JSON.stringify(results, null, 2));
    await testInfo.attach('activity-parity.json', {
      path: parity,
      contentType: 'application/json',
    });
  });

  test.describe('Sprints below 1200px', () => {
    test.use({ hasTouch: true });
    test('matches Sprints on tablets and phones in both themes', async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      const results: unknown[] = [];
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(() => localStorage.setItem('op-rail-compact:v1', 'true'));
      await page.clock.setFixedTime(new Date(SPRINT_SCENARIO_NOW));
      const sprints = page.locator('[data-route-kind="planning.sprints"]');
      const rings = async (count: number) => {
        await page.locator('body').click({ position: { x: 1, y: 1 } });
        const read: { element: string; ring: string[] }[] = [];
        for (let press = 0; press < count; press += 1) {
          await page.keyboard.press('Tab');
          const ring = await page.evaluate(async () => {
            for (let frame = 0; frame < 2; frame += 1)
              await new Promise((resolve) => requestAnimationFrame(resolve));
            await new Promise((resolve) => setTimeout(resolve, 50));
            const focused = document.querySelector(
              '[data-route-kind="planning.sprints"] :focus-visible',
            );
            if (!focused) return null;
            const style = getComputedStyle(focused);
            return {
              element: `${focused.tagName.toLowerCase()}.${focused.className}`,
              ring: [style.outlineStyle, style.outlineWidth, style.outlineOffset],
            };
          });
          if (ring) read.push(ring);
        }
        return read;
      };
      for (const theme of ['dark', 'light'] as const) {
        for (const width of [1024, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await page.goto(fixtureUrl('#/sprints', { planningScenario: 'sprint', theme }));
          await page.evaluate(() => document.fonts.ready);
          await expect(sprints.locator('.pc-sprints__active')).toBeVisible();
          const widths = await page.evaluate(() => {
            const main = document.querySelector('#main-content');
            const root = document.querySelector('[data-route-kind="planning.sprints"]');
            return [main, root].map((node) => (node ? node.scrollWidth - node.clientWidth : -1));
          });
          expect(widths, `no clipped overflow at ${width}`).toEqual([0, 0]);
          expect((await layoutReport(page)).horizontalOverflow).toBe(false);
          await page.screenshot({
            path: testInfo.outputPath(`sprints-${width}-${theme}.png`),
            fullPage: true,
          });
          if (width < 600) {
            const boxes = await sprints.locator('.pc-sprints__item-link').evaluateAll((links) =>
              links.map((link) =>
                ['.pc-artifact-tag', '.pc-sprints__item-status', '.pc-sprints__last'].map(
                  (selector) => {
                    const box = link.querySelector(selector)?.getBoundingClientRect();
                    return box ? [box.left, box.right] : [0, 0];
                  },
                ),
              ),
            );
            expect(boxes).toHaveLength(4);
            for (const [tag, status, last] of boxes) {
              expect(tag[1]).toBeLessThanOrEqual(status[0]);
              if (last[1] > last[0]) expect(status[1]).toBeLessThanOrEqual(last[0]);
            }
            const head = await sprints.locator('.pc-sprints__active-head').boundingBox();
            const day = await sprints.locator('.pc-sprints__day').boundingBox();
            expect((day?.x ?? 0) + (day?.width ?? 0)).toBeLessThanOrEqual(
              (head?.x ?? 0) + (head?.width ?? 0),
            );
            await expect(sprints.getByRole('tab')).toHaveCount(0);
            await expect(sprints.locator('.pc-sprints__timeline')).toBeHidden();
          }
          if (width === 390) {
            for (const row of sprintsParityRows.filter((entry) => entry.setup === 'sprints-M'))
              results.push(...(await assertParityRow(page, row, theme)));
            const active = await sprints.locator('.pc-sprints__active').boundingBox();
            const past = sprints.getByRole('button', { name: 'Past sprints 3', exact: true });
            const pastBox = await past.boundingBox();
            expect(pastBox?.height).toBeCloseTo(54, 0);
            expect((pastBox?.y ?? 0) - ((active?.y ?? 0) + (active?.height ?? 0))).toBeCloseTo(
              16,
              0,
            );
            const read = await rings(24);
            const kinds = read.map(({ element }) => element).join(' | ');
            for (const part of [
              'a.pc-sprints__item-link',
              'button.pc-sprints__all',
              'button.pc-sprints__past',
            ])
              expect(kinds, `S-20 reach ${part}`).toContain(part);
            for (const { element, ring } of read)
              expect(ring, `S-20 ${element} at 390`).toEqual(['solid', '2px', '2px']);
          }
          if (width === 768) {
            const read = await rings(20);
            expect(read.some(({ element }) => element.includes('pc-tabs__tab'))).toBe(true);
            expect(read.some(({ element }) => element.includes('pc-sprints__item-link'))).toBe(
              true,
            );
            for (const { element, ring } of read)
              expect(ring, `S-20 ${element} at 768`).toEqual(['solid', '2px', '2px']);
          }
        }
      }

      // A row under the selection bar's Open: the tap selects it and the Inspector stays closed.
      await page.setViewportSize({ width: 390, height: 1000 });
      await page.goto(fixtureUrl('#/sprints', { planningScenario: 'sprint', theme: 'dark' }));
      await sprints.getByRole('button', { name: 'All 18 items', exact: true }).tap();
      const rows = sprints.locator('.pc-sprints__item-link');
      await expect(rows).toHaveCount(18);
      await rows.first().tap();
      const bar = page.locator('.pc-selection-bar');
      const open = bar.getByRole('button', { name: 'Open', exact: true });
      const openBox = await open.boundingBox();
      if (!openBox) throw new Error('Expected the selection bar Open button.');
      await bar.getByRole('button', { name: 'Clear selection', exact: true }).tap();
      await expect(bar).toBeHidden();
      const target = rows.nth(9);
      await target.evaluate(
        (link, y) => {
          const box = link.getBoundingClientRect();
          const scroller = link.closest('.pc-shell__scroll') ?? document.scrollingElement;
          scroller?.scrollBy(0, box.top + box.height / 2 - y);
        },
        openBox.y + openBox.height / 2,
      );
      const targetBox = await target.boundingBox();
      if (!targetBox) throw new Error('Expected the target row.');
      expect(
        Math.abs(targetBox.y + targetBox.height / 2 - (openBox.y + openBox.height / 2)),
      ).toBeLessThan(4);
      await page.touchscreen.tap(openBox.x + openBox.width / 2, openBox.y + openBox.height / 2);
      await expect(target).toHaveAttribute('aria-current', 'true');
      await expect(open).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Inspector', exact: true })).toBeHidden();

      // With a selection, the page still scrolls its last content clear of the bar.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const scroller = document.querySelector<HTMLElement>('.pc-shell__scroll');
            const past = document.querySelector('.pc-sprints__past');
            const bar = document.querySelector('.pc-selection-bar');
            if (!scroller || !past || !bar) return Number.POSITIVE_INFINITY;
            scroller.style.scrollBehavior = 'auto';
            scroller.scrollTop = scroller.scrollHeight;
            return past.getBoundingClientRect().bottom - bar.getBoundingClientRect().top;
          }),
        )
        .toBeLessThanOrEqual(0);

      const parity = testInfo.outputPath('sprints-M-parity.json');
      writeFileSync(parity, JSON.stringify(results, null, 2));
      await testInfo.attach('sprints-M-parity.json', {
        path: parity,
        contentType: 'application/json',
      });
    });
  });

  test.describe('Activity below 1200px', () => {
    test.use({ hasTouch: true });
    test('matches Activity on tablets and phones in both themes', async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const results: unknown[] = [];
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(() => localStorage.setItem('op-rail-compact:v1', 'true'));
      await page.clock.setFixedTime(new Date(ARTBOARD_FIXTURE_CLOCK));
      const activity = page.locator('[data-route-kind="planning.activity"]');
      const open = async (theme: 'dark' | 'light') => {
        expect((await page.request.post('/__fixture/reset?dataset=artboard')).ok()).toBe(true);
        await page.goto(fixtureUrl('#/activity', { dataset: 'artboard', theme }));
        await page.evaluate(() => document.fonts.ready);
        await expect(activity.locator('.pc-activity__connection')).toContainText('Watching');
        for (const kind of ['title', 'status', 'remove'])
          expect(
            (await page.request.post(`/__fixture/patch?dataset=artboard&kind=${kind}`)).ok(),
          ).toBe(true);
        await expect(activity.locator('.pc-activity__live-row')).toHaveCount(3);
        await expect(activity.locator('.pc-activity__row[data-gone]').first()).toBeVisible();
      };
      const rings = async (count: number) => {
        await page.locator('body').click({ position: { x: 1, y: 1 } });
        const read: { element: string; ring: string[] }[] = [];
        for (let press = 0; press < count; press += 1) {
          await page.keyboard.press('Tab');
          const ring = await page.evaluate(async () => {
            for (let frame = 0; frame < 2; frame += 1)
              await new Promise((resolve) => requestAnimationFrame(resolve));
            await new Promise((resolve) => setTimeout(resolve, 50));
            const focused = document.querySelector(
              '[data-route-kind="planning.activity"] :focus-visible',
            );
            if (!focused) return null;
            const style = getComputedStyle(focused);
            return {
              element: `${focused.tagName.toLowerCase()}.${focused.className}`,
              ring: [style.outlineStyle, style.outlineWidth, style.outlineOffset],
            };
          });
          if (ring) read.push(ring);
        }
        return read;
      };
      for (const theme of ['dark', 'light'] as const) {
        for (const width of [1024, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await open(theme);
          const widths = await page.evaluate(() => {
            // The filter row bleeds into the shell gutter by design; the scroller is what clips.
            const main = document.querySelector('#main-content');
            const scroller = document.querySelector('.pc-shell__scroll');
            return [main, scroller].map((node) =>
              node ? node.scrollWidth - node.clientWidth : -1,
            );
          });
          expect(widths, `no clipped overflow at ${width}`).toEqual([0, 0]);
          expect((await layoutReport(page)).horizontalOverflow).toBe(false);
          expect(await axeViolations(page)).toEqual([]);
          await page.screenshot({
            path: testInfo.outputPath(`activity-${width}-${theme}.png`),
            fullPage: true,
          });
          const chart = activity.locator('.pc-activity__chart');
          if (width >= 600) {
            const feed = await activity.locator('.pc-activity__main').boundingBox();
            const live = await activity.locator('.pc-activity__live').boundingBox();
            const busiest = await activity.locator('.pc-activity__busiest').boundingBox();
            if (!feed || !live || !busiest) throw new Error(`Missing Activity column at ${width}`);
            expect(live.y, 'feed first').toBeGreaterThan(feed.y + feed.height - 1);
            if (width >= 900) {
              expect(busiest.y, 'side cards paired').toBeCloseTo(live.y, 0);
              await expect(chart).toBeVisible();
            } else {
              expect(busiest.y, 'side cards stacked').toBeGreaterThan(live.y + live.height - 1);
              await expect(chart).toBeHidden();
              const tracks = await activity
                .locator('a.pc-activity__cells')
                .first()
                .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' '));
              expect(tracks[3]).toBe('160px');
            }
          } else {
            const header = activity.locator('.pc-activity__header');
            expect((await header.boundingBox())?.width).toBe(1);
            await expect(header.getByRole('heading', { level: 1 })).toHaveText(/^Activity/u);
            await expect(activity.getByRole('tab', { name: 'Removed', exact: true })).toBeVisible();
            await expect(activity.locator('.pc-activity__side')).toBeHidden();
            await expect(chart).toBeHidden();
          }
          if (width === 390) {
            for (const row of activityParityRows.filter((entry) => entry.setup === 'activity-M'))
              results.push(...(await assertParityRow(page, row, theme)));
            const read = await rings(24);
            const kinds = read.map(({ element }) => element).join(' | ');
            for (const part of ['a.pc-activity__cells', 'pc-tabs__tab', 'pc-activity__more'])
              expect(kinds, `S-20 reach ${part}`).toContain(part);
            for (const { element, ring } of read)
              expect(ring, `S-20 ${element} at 390`).toEqual(
                element.startsWith('a.pc-activity__cells')
                  ? ['solid', '2px', '-2px']
                  : ['solid', '2px', '2px'],
              );
            const more = activity.locator('.pc-activity__more');
            await more.tap();
            const sheet = page.getByRole('dialog', { name: 'Filters', exact: true });
            await expect(sheet).toBeVisible();
            await sheet.getByRole('button', { name: 'Last 30 days', exact: true }).tap();
            await expect(more).toHaveText('More filters 1');
            await sheet.locator('.pc-list-sheet__apply').tap();
            await expect(sheet).toBeHidden();
            await expect(activity).toContainText('in 30 days');
          }
          if (width === 768) {
            const read = await rings(20);
            expect(read.some(({ element }) => element.includes('pc-tabs__tab'))).toBe(true);
            expect(read.some(({ element }) => element.startsWith('a.pc-activity__cells'))).toBe(
              true,
            );
            for (const { element, ring } of read)
              expect(ring, `S-20 ${element} at 768`).toEqual(['solid', '2px', '2px']);
          }
        }
      }

      // Below 900 a tap selects the row; the selection bar's Open opens the Inspector.
      await page.setViewportSize({ width: 390, height: 1000 });
      await open('dark');
      const inspector = page.getByRole('dialog', { name: 'Inspector', exact: true });
      const row = activity.locator('a.pc-activity__cells').nth(4);
      await row.tap();
      await expect(row).toHaveAttribute('aria-current', 'true');
      await expect(inspector).toBeHidden();
      const bar = page.locator('.pc-selection-bar');
      await bar.getByRole('button', { name: 'Open', exact: true }).tap();
      await expect(inspector).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(inspector).toBeHidden();
      await expect(row).toHaveAttribute('aria-current', 'true');

      // With a selection, the page still scrolls its last row clear of the bar.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const scroller = document.querySelector<HTMLElement>('.pc-shell__scroll');
            const rows = document.querySelectorAll('.pc-activity__row');
            const last = rows[rows.length - 1];
            const bar = document.querySelector('.pc-selection-bar');
            if (!scroller || !last || !bar) return Number.POSITIVE_INFINITY;
            scroller.style.scrollBehavior = 'auto';
            scroller.scrollTop = scroller.scrollHeight;
            return last.getBoundingClientRect().bottom - bar.getBoundingClientRect().top;
          }),
        )
        .toBeLessThanOrEqual(0);

      const parity = testInfo.outputPath('activity-M-parity.json');
      writeFileSync(parity, JSON.stringify(results, null, 2));
      await testInfo.attach('activity-M-parity.json', {
        path: parity,
        contentType: 'application/json',
      });
    });
  });

  test.describe('List under a coarse pointer', () => {
    test.use({ hasTouch: true });
    test('keeps compact List rows at the 44px touch height', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(() => localStorage.setItem('op-rail-compact:v1', 'true'));
      const list = page.locator('[data-route-kind="planning.list"]');
      await page.goto(fixtureUrl('#/list', { dataset: 'representative', theme: 'dark' }));
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      await list.getByRole('button', { name: 'Compact', exact: true }).click();
      await expect(list.locator('table')).toHaveAttribute('data-compact', 'true');
      await list.locator('.pc-list__group-header').last().scrollIntoViewIfNeeded();
      await expect(list.locator('tbody tr[data-keyboard-item]').first()).toBeVisible();
      for (const row of listParityRows.filter((entry) => entry.setup === 'list-coarse'))
        await assertParityRow(page, row, 'dark');
    });
  });

  test.describe('sprint and activity evidence', () => {
    test.use({ hasTouch: true });
    test('renders sprint evidence and honest Activity states in both themes and touch sizes', async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);
      await page.addInitScript(() => {
        const theme = new URL(location.href).searchParams.get('evidenceTheme');
        if (theme === 'light' || theme === 'dark') localStorage.setItem('op-theme', theme);
      });
      const writes: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET')
          writes.push(`${request.method()} ${request.url()}`);
      });
      for (const theme of ['dark', 'light']) {
        for (const width of [1440, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          expect((await page.request.post('/__fixture/reset?dataset=artboard')).ok()).toBe(true);
          await page.goto(fixtureUrl('#/sprints', { dataset: 'artboard', evidenceTheme: theme }));
          await page.evaluate(() => document.fonts.ready);
          const sprints = page.locator('[data-route-kind="planning.sprints"]');
          await expect(
            sprints.getByRole('region', { name: 'No active sprint', exact: true }),
          ).toBeVisible();
          if (width < 600) {
            const past = sprints.getByRole('button', { name: 'Past sprints 3', exact: true });
            await expect(past).toHaveAttribute('aria-expanded', 'false');
            await past.tap();
            await expect(past).toHaveAttribute('aria-expanded', 'true');
          }
          const launch = sprints.getByRole('article', {
            name: 'SPRINT-001: Launch sprint 1',
            exact: true,
          });
          await expect(launch).toContainText('78 of 82 done');
          await expect(launch).toContainText('4 carried over');
          await expect(sprints).toContainText('closed-before-start');
          expect((await layoutReport(page)).horizontalOverflow).toBe(false);
          expect(await axeViolations(page)).toEqual([]);
          await testInfo.attach(`sprints-${theme}-${width}.png`, {
            body: await page.screenshot({ fullPage: true }),
            contentType: 'image/png',
          });
          // Carried items stay reachable through the closed sprint's Detail.
          await launch.getByRole('link').click();
          const detail = page.locator('[data-route-kind="planning.detail"]');
          await expect(detail.locator('[data-detail-state="ready"]')).toBeVisible();
          for (const href of [
            '#/detail/QT-006',
            '#/detail/BL-007',
            '#/detail/QT-005',
            '#/detail/SPEC-015%2FT-055',
          ])
            await expect(detail.locator(`a[href="${href}"]`).first()).toBeAttached();

          await page.clock.setFixedTime(new Date(SPRINT_SCENARIO_NOW));
          await page.goto(
            fixtureUrl('#/sprints', { planningScenario: 'sprint', evidenceTheme: theme }),
          );
          const row = sprints.locator('.pc-sprints__item-link').filter({ hasText: 'T-159' });
          await expect(row.locator('.pc-sprints__last')).toHaveText('carried from SPRINT-003');
          const inspector = page.getByRole('dialog', { name: 'Inspector', exact: true });
          if (width < 900) {
            // A tap selects the row; the bar's Open opens the Inspector.
            await row.tap();
            const open = page.locator('.pc-selection-bar').getByRole('button', {
              name: 'Open',
              exact: true,
            });
            await expect(row).toHaveAttribute('aria-current', 'true');
            await expect(open).toBeVisible();
            await expect(inspector).toBeHidden();
            await open.tap();
            await expect(inspector).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(inspector).toBeHidden();
            await expect(row).toBeFocused();
            await expect(row).toHaveAttribute('aria-current', 'true');
          } else {
            await row.focus();
            await page.keyboard.press('Enter');
            await expect(inspector).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(row).toBeFocused();
          }
          expect((await layoutReport(page)).horizontalOverflow).toBe(false);
          expect(await axeViolations(page)).toEqual([]);

          // The Sprints scenario clock above would put the artboard history inside the window.
          await page.clock.setFixedTime(Date.now());
          await page.goto(fixtureUrl('#/activity', { dataset: 'artboard', evidenceTheme: theme }));
          const activity = page.locator('[data-route-kind="planning.activity"]');
          await expect(activity).toContainText('Nothing changed in the last 14 days');
          await expect(activity).toContainText(
            'Changes saved to the plan appear here as they happen.',
          );
          await expect(activity).toContainText('This session only');
          await expect(activity.locator('[data-keyboard-item]')).toHaveCount(0);
          expect((await layoutReport(page)).horizontalOverflow).toBe(false);
          expect(await axeViolations(page)).toEqual([]);
          await testInfo.attach(`activity-${theme}-${width}.png`, {
            body: await page.screenshot({ fullPage: true }),
            contentType: 'image/png',
          });
        }
      }
      // The header's sprint command is hidden on phones, so the last checks run on desktop.
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openFixture(page, '#/sprints');
      await expect(page.locator('[data-route-kind="planning.sprints"]')).toContainText(
        'No sprints yet',
      );
      await openFixture(page, '#/sprints', { planningScenario: 'delivery' });
      await expect(page.getByRole('button', { name: /Plan the next sprint/ })).toBeVisible();
      expect(writes).toEqual([]);
    });

    test('retains session-only accepted Activity patches, focus and scroll on disconnect without layout shift', async ({
      page,
    }, testInfo) => {
      expect((await page.request.post('/__fixture/reset?dataset=artboard')).ok()).toBe(true);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(fixtureUrl('#/activity', { dataset: 'artboard' }));
      await page.evaluate(() => document.fonts.ready);
      const activity = page.locator('[data-route-kind="planning.activity"]');
      await expect(activity).toContainText('Watching');
      await page.evaluate(installDashboardLayoutShifts);
      await page.evaluate(() => window.__dashboardLayoutShifts.markPhase('activity-patches'));
      expect((await page.request.post('/__fixture/patch?dataset=artboard')).ok()).toBe(true);
      const row = activity.locator('[data-keyboard-item]').first();
      await expect(row).toBeVisible();
      await row.focus();
      // Both patches retitle one item, so the focused row is held by element identity.
      const focused = await row.elementHandle();
      if (!focused) throw new Error('Activity row is unavailable');
      const feed = activity.getByRole('region', { name: 'Live patches from this session' });
      await feed.evaluate((element) => {
        element.scrollTop = 0;
      });
      // New rows land where the current first rows are; everything above that must hold still.
      // A shift rect includes the focused row's ring: 2px wide at a 2px offset.
      const FOCUS_RING_INK = 4;
      const insertion = await activity.evaluate((root) => {
        const rect = (selector: string) => {
          const target = root.querySelector(selector);
          if (!target) throw new Error(`Missing Activity insertion point: ${selector}`);
          return target.getBoundingClientRect();
        };
        return {
          side: rect('.pc-activity__side').left,
          feed: rect('[data-keyboard-item]').top,
          card: rect('.pc-activity__live-row').top,
        };
      });
      expect((await page.request.post('/__fixture/patch?dataset=artboard')).ok()).toBe(true);
      await expect(activity.locator('[data-keyboard-item]')).toHaveCount(2);
      expect(await focused.evaluate((element) => element === document.activeElement)).toBe(true);
      expect(await feed.evaluate((element) => element.scrollTop)).toBe(0);
      const indicator = activity.locator('.pc-activity__connection');
      const badge = indicator.locator('.pc-badge');
      const indicatorBefore = await indicator.boundingBox();
      const badgeBefore = await badge.boundingBox();
      expect(indicatorBefore).not.toBeNull();
      expect(badgeBefore).not.toBeNull();
      expect(badgeBefore?.height).toBe(26);
      await page.evaluate(() => window.__dashboardLayoutShifts.markPhase('activity-disconnect'));
      await page.context().setOffline(true);
      await expect(
        activity.getByRole('region', { name: 'Live session activity', exact: true }),
      ).toContainText('Reconnecting');
      await expect(
        activity.getByRole('region', { name: 'Live session activity', exact: true }),
      ).toContainText('changes so far are kept');
      await expect(
        activity.getByRole('region', { name: 'Live session activity', exact: true }),
      ).not.toContainText('Watching');
      await expect(activity).toContainText('This session only');
      await expect(activity.locator('[data-keyboard-item]')).toHaveCount(2);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const report = await page.evaluate(() => window.__dashboardLayoutShifts.snapshot());
      const shifts = report.shifts.filter(
        (shift) =>
          !shift.hadRecentInput &&
          ['activity-patches', 'activity-disconnect'].includes(shift.phase),
      );
      if (shifts.length > 0)
        await testInfo.attach('activity-layout-shifts.json', {
          body: JSON.stringify(report, null, 2),
          contentType: 'application/json',
        });
      // Newest-first rows push down what sits below a live insert; nothing above it may move.
      const patchShifts = shifts.filter((shift) => shift.phase === 'activity-patches');
      const aboveInsertion = [
        ...patchShifts.filter((shift) => shift.sources.length === 0).map(() => 'unattributed'),
        ...patchShifts.flatMap((shift) =>
          shift.sources
            .filter(
              (source) =>
                source.previousRect.top + FOCUS_RING_INK <
                (source.previousRect.left >= insertion.side ? insertion.card : insertion.feed),
            )
            .map((source) => source.selector ?? source.nodeKind),
        ),
      ];
      expect(
        aboveInsertion,
        `Activity shifts above a live insert ${JSON.stringify(insertion)}: ${JSON.stringify(shifts, null, 2)}`,
      ).toEqual([]);
      const disconnectShift = shifts
        .filter((shift) => shift.phase === 'activity-disconnect')
        .reduce((sum, shift) => sum + shift.value, 0);
      expect(
        disconnectShift,
        `Activity disconnect shifts: ${JSON.stringify(shifts, null, 2)}`,
      ).toBe(0);
      expect(await indicator.boundingBox()).toEqual(indicatorBefore);
      const badgeAfter = await badge.boundingBox();
      expect(badgeAfter?.height).toBe(badgeBefore?.height);
      expect(badgeAfter?.y).toBe(badgeBefore?.y);
      if (!badgeBefore || !badgeAfter) throw new Error('Activity badge geometry is unavailable');
      expect(badgeAfter.x).toBe(badgeBefore.x);
      await page.context().setOffline(false);
    });
  });

  test('keeps Planning workspaces aligned to one shared application frame', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [route, selector] of [
      ['#/overview', '[data-route-kind="planning.overview"]'],
      ['#/graph', '[data-route-kind="planning.graph"]'],
      ['#/board', '[data-route-kind="planning.board"]'],
      ['#/list', '[data-route-kind="planning.list"]'],
    ] as const) {
      await openFixture(page, route);
      await expectSurfaceToUseRouteFrame(page, selector);
    }
  });

  test('supports skip-link, command-palette, escape, and route-announcement keyboard flows', async ({
    page,
  }) => {
    await openFixture(page);
    const initialAnnouncement = await page.locator('.op-route-announcer').textContent();

    await page.keyboard.press('Tab');
    await expect(page.locator('.pc-skip-link')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    await page.keyboard.press('Control+K');
    await expect(page.locator('dialog.pc-palette')).toBeVisible();
    await expect(page.locator('dialog.pc-palette input[type="search"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog.pc-palette')).not.toBeVisible();

    await page.evaluate(() => {
      window.location.hash = '#/operate/recovery';
    });
    await expect(page.locator('.op-route-announcer')).not.toHaveText(initialAnnouncement ?? '');
    await expect(page.locator('.op-route-announcer')).toContainText('Recovery');
    await expect(page.locator('[data-route-kind="operate.recovery"]')).toContainText(
      'Recovery is blocked',
    );
  });

  test('keeps palette preview named, reachable and trapped across themes and widths', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      const theme = new URL(location.href).searchParams.get('evidenceTheme');
      if (theme === 'light' || theme === 'dark') localStorage.setItem('op-theme', theme);
    });
    const writes: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/') && request.method() !== 'GET')
        writes.push(`${request.method()} ${path}`);
    });
    for (const theme of ['dark', 'light']) {
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: width === 320 ? 568 : 1000 });
        expect((await page.request.post('/__fixture/reset?dataset=artboard')).ok()).toBe(true);
        await page.goto(fixtureUrl('#/list', { dataset: 'artboard', evidenceTheme: theme }));
        await expect(page.locator('.pc-list')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const launcher = page.getByRole('button', { name: 'Jump to a view or an artifact' });
        await launcher.focus();
        await page.keyboard.press('Control+K');
        const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
        const input = palette.getByRole('searchbox', { name: 'Search views and artifacts' });
        await expect(input).toBeFocused();
        await input.fill('SPEC-014/T-046');
        const first = palette.locator('[data-search-result]').first();
        await expect(first).toHaveAttribute('data-search-result', 'planning:SPEC-014/T-046');
        const preview = palette.getByRole('complementary', { name: 'Search result preview' });
        await expect(preview).toHaveAttribute('data-preview-id', 'SPEC-014/T-046');
        await expect(preview).toHaveAttribute('data-preview-state', 'ready');
        await expect(preview).toContainText('Connect Plan Ship company sync and release proof');
        await expect(preview).toContainText('SPEC-014');
        await expect(preview).toContainText('T-045');
        await expect(page).toHaveURL(/#\/list$/u);
        for (const control of await palette.locator(ACTIVE_TARGET_SELECTOR).all()) {
          if (await control.isVisible()) await expect(control).toHaveAccessibleName(/\S/u);
        }
        await expectControlsHitTestable(page, palette);
        await input.focus();
        const steps = (await palette.locator(ACTIVE_TARGET_SELECTOR).count()) + 1;
        for (const direction of ['Tab', 'Shift+Tab']) {
          for (let step = 0; step < steps; step++) {
            await page.keyboard.press(direction);
            expect(
              await palette.evaluate((element) => element.contains(document.activeElement)),
              `Palette must retain focus after ${direction}`,
            ).toBe(true);
          }
        }
        await input.focus();
        expect((await layoutReport(page)).horizontalOverflow).toBe(false);
        expect(await axeViolations(page)).toEqual([]);
        await attachScreenshot(
          page,
          `palette-${theme}-${width}.png`,
          testInfo.attach.bind(testInfo),
        );
        await page.keyboard.press('Escape');
        await expect(palette).not.toBeVisible();
        await expect(launcher).toBeFocused();
        await expect(page).toHaveURL(/#\/list$/u);
      }
    }
    expect(writes).toEqual([]);
  });

  test('matches the command palette to its canvas parity rows in both themes', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const results: unknown[] = [];
    const heights: Record<string, number[]> = {};
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => localStorage.setItem('op-rail-compact:v1', 'true'));
    const rowsFor = (setup: string) => paletteParityRows.filter((entry) => entry.setup === setup);
    const settle = () =>
      page.evaluate(async () => {
        for (let frame = 0; frame < 2; frame += 1)
          await new Promise((resolve) => requestAnimationFrame(resolve));
      });
    for (const theme of ['dark', 'light'] as const) {
      await page.setViewportSize({ width: 1440, height: 900 });
      expect((await page.request.post('/__fixture/reset?dataset=artboard')).ok()).toBe(true);
      await page.goto(fixtureUrl('#/list', { dataset: 'artboard', theme }));
      await expect(page.locator('.pc-list')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
      const input = palette.getByRole('searchbox', { name: 'Search views and artifacts' });
      const panel = palette.locator('.pc-palette__panel');

      await page.keyboard.press('Control+K');
      await input.fill('SPEC-014/T-046');
      await expect(palette.locator('[data-search-result]').first()).toHaveAttribute(
        'data-search-result',
        'planning:SPEC-014/T-046',
      );
      await input.press('Enter');
      await expect(palette).not.toBeVisible();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+K');
      await expect(input).toHaveValue('');
      await settle();
      for (const row of rowsFor('palette-open'))
        results.push(...(await assertParityRow(page, row, theme)));
      await expect(palette.getByRole('list', { name: 'Recent' })).toContainText('T-046');
      const opened = (await panel.boundingBox())?.height ?? 0;
      expect(opened).toBeLessThan(600);
      await page.screenshot({ path: testInfo.outputPath(`palette-open-1440-${theme}.png`) });

      heights[theme] = [opened];
      for (const prefix of ['f', 'fi', 'fin', 'find']) {
        await input.fill(prefix);
        await settle();
        heights[theme].push((await panel.boundingBox())?.height ?? 0);
      }
      await expect(palette.locator('.pc-palette__match').first()).toBeVisible();
      for (const row of rowsFor('palette'))
        results.push(...(await assertParityRow(page, row, theme)));
      expect((await layoutReport(page)).horizontalOverflow).toBe(false);
      expect(await axeViolations(page)).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`palette-find-1440-${theme}.png`) });

      const selected = palette.locator('.pc-palette__result[data-selected="true"]');
      await selected.hover();
      await settle();
      const layers = await selected.evaluate((item) => {
        const fill = getComputedStyle(item, '::before');
        return {
          painted: [item, ...item.querySelectorAll(':not(.pc-palette__match)')]
            .map((node) => getComputedStyle(node).backgroundColor)
            .filter((color) => color !== 'rgba(0, 0, 0, 0)'),
          fill: fill.backgroundColor,
          inset: [fill.top, fill.bottom],
        };
      });
      expect(layers.painted, 'one background on the hovered selected row').toEqual([]);
      expect(layers.fill).not.toBe('rgba(0, 0, 0, 0)');
      expect(layers.inset, 'a 2px gap between adjacent highlights').toEqual(['1px', '1px']);
      await page.screenshot({
        path: testInfo.outputPath(`palette-hover-selected-1440-${theme}.png`),
        clip: { x: 240, y: 96, width: 960, height: 400 },
      });

      const rings: { element: string; ring: string[]; clipped: boolean }[] = [];
      const ringOf = () =>
        page.evaluate(async () => {
          for (let frame = 0; frame < 2; frame += 1)
            await new Promise((resolve) => requestAnimationFrame(resolve));
          // Focus also selects the row, which restarts the reduced-motion transition.
          await new Promise((resolve) => setTimeout(resolve, 50));
          const focused = document.querySelector<HTMLElement>('dialog.pc-palette :focus-visible');
          if (!focused) return null;
          const style = getComputedStyle(focused);
          const box = focused.getBoundingClientRect();
          const reach = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
          let clipped = false;
          for (let parent = focused.parentElement; parent; parent = parent.parentElement) {
            const overflow = getComputedStyle(parent);
            if (![overflow.overflowX, overflow.overflowY].some((value) => value !== 'visible'))
              continue;
            const frame = parent.getBoundingClientRect();
            if (
              box.left - reach < frame.left - 0.5 ||
              box.right + reach > frame.right + 0.5 ||
              box.top - reach < frame.top - 0.5 ||
              box.bottom + reach > frame.bottom + 0.5
            )
              clipped = true;
            break;
          }
          return {
            element: `${focused.tagName.toLowerCase()}.${focused.className}`,
            ring: [style.outlineStyle, style.outlineWidth, style.outlineOffset],
            clipped,
          };
        });
      await input.focus();
      for (let step = 0; step < 12; step += 1) {
        await page.keyboard.press('Tab');
        const ring = await ringOf();
        if (ring) rings.push(ring);
      }
      const results1440 = palette.locator('[data-search-result]');
      await results1440.first().focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      for (let step = 0; step < 40; step += 1) await page.keyboard.press('ArrowDown');
      await expect(results1440.last()).toBeFocused();
      const lastRing = await ringOf();
      if (lastRing) rings.push(lastRing);
      expect(rings.some((ring) => ring.element.includes('pc-palette__row'))).toBe(true);
      expect(rings.some((ring) => ring.element.includes('pc-palette__scope'))).toBe(true);
      for (const { element, ring, clipped } of rings) {
        expect(ring, `S-20 ${theme} ${element} ${JSON.stringify(rings)}`).toEqual([
          'solid',
          '2px',
          '2px',
        ]);
        expect(clipped, `S-20 ${element} clipped`).toBe(false);
      }

      await input.fill('SPEC-014/T-046');
      await expect(palette.locator('[data-search-result]').first()).toHaveAttribute(
        'data-active',
        'true',
      );
      await input.press('End');
      await input.press('Control+C');
      const copied = palette.locator('.pc-palette__copy');
      await expect(copied).toContainText('✓ Copied');
      const command = await copied.locator('code').textContent();
      expect(command).toBe('/planr:ship SPEC-014/T-046');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
      await page.screenshot({ path: testInfo.outputPath(`palette-copied-1440-${theme}.png`) });

      await input.fill('qzxqzx');
      await settle();
      for (const row of rowsFor('palette-empty'))
        results.push(...(await assertParityRow(page, row, theme)));
      expect((await panel.boundingBox())?.height ?? 600).toBeLessThan(260);
      await page.screenshot({ path: testInfo.outputPath(`palette-empty-1440-${theme}.png`) });

      await page.setViewportSize({ width: 1024, height: 768 });
      await input.fill('find');
      await settle();
      expect((await panel.boundingBox())?.width).toBe(960);
      expect((await layoutReport(page)).horizontalOverflow).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`palette-find-1024-${theme}.png`) });
      await input.fill('');
      await settle();
      await page.screenshot({ path: testInfo.outputPath(`palette-open-1024-${theme}.png`) });
      await page.keyboard.press('Escape');
      await expect(palette).not.toBeVisible();
      await page.setViewportSize({ width: 1440, height: 900 });
      let release: (() => void) | undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/api/operate/search**', async (route) => {
        await held;
        await route.continue();
      });
      await page.goto(fixtureUrl('#/operate/today', { dataset: 'artboard', theme }));
      await expect(page.locator('[data-route-kind="operate.today"]')).toBeVisible();
      await page.keyboard.press('Control+K');
      await input.fill('handoff');
      const busy = palette.locator('.pc-palette__group[aria-busy="true"]');
      await expect(busy).toBeVisible();
      for (const row of rowsFor('palette-operate'))
        results.push(...(await assertParityRow(page, row, theme)));
      const before = await palette.locator('[data-search-result]').first().boundingBox();
      release?.();
      await expect(busy).toHaveCount(0);
      const after = await palette.locator('[data-search-result]').first().boundingBox();
      expect(after?.y, 'P-14 planning rows stay put').toBe(before?.y);
      await page.unroute('**/api/operate/search**');
      await page.keyboard.press('Escape');
      await expect(palette).not.toBeVisible();
    }
    const parity = testInfo.outputPath('palette-parity.json');
    writeFileSync(parity, JSON.stringify({ results, heights }, null, 2));
    await testInfo.attach('palette-parity.json', { path: parity, contentType: 'application/json' });
  });

  test('starts the handoff trace through palette search and promotes only on full-page activation', async ({
    page,
  }) => {
    expect((await page.request.post('/__fixture/reset?dataset=artboard')).ok()).toBe(true);
    await page.goto(fixtureUrl('#/list', { dataset: 'artboard' }));
    await expect(page.locator('.pc-list')).toBeVisible();
    await page.keyboard.press('Control+K');
    const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
    const input = palette.getByRole('searchbox', { name: 'Search views and artifacts' });
    await input.fill('handoff');
    const result = palette.getByRole('button', { name: /Design-to-Delivery Handoff Center/u });
    await result.focus();
    const preview = palette.getByRole('complementary', { name: 'Search result preview' });
    await expect(preview).toHaveAttribute('data-preview-id', 'SPEC-014');
    await expect(preview).toContainText('openplanr status SPEC-014 --md');
    await expect(page).toHaveURL(/#\/list$/u);
    await page.keyboard.press('Control+Enter');
    await expect(palette).not.toBeVisible();
    await expect(page).toHaveURL(/#\/detail\/SPEC-014$/u);
    await expect(page.locator('[data-route-kind="planning.detail"]')).toContainText(
      'Design-to-Delivery Handoff Center',
    );
  });

  test('returns focus after cancelling a runtime-issued governed Action preview', async ({
    page,
  }, testInfo) => {
    await openFixture(page, '#/operate/actions/act_reminder_delivery_0001');
    const trigger = page.getByRole('button', { name: 'Restore the previous reminder settings' });
    await expect(trigger).toBeEnabled();
    await trigger.click();

    const dialog = page.getByRole('alertdialog', {
      name: 'Confirm Restore the previous reminder settings',
    });
    await expect(dialog).toBeVisible();
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel).toBeFocused();
    await expect(dialog).toContainText(
      'You are about to Restore the previous reminder settings. Review the reminder setting rollback before confirming.',
    );
    await expect(
      dialog.getByRole('button', { name: 'Confirm Restore the previous reminder settings' }),
    ).toBeVisible();
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    const skipLink = page.locator('.pc-skip-link');
    await expect(skipLink).not.toBeFocused();
    expect(
      await skipLink.evaluate((node) => node.getBoundingClientRect().bottom),
    ).toBeLessThanOrEqual(0);
    // Full-page Chromium captures fixed elements relative to the current scroll
    // offset. Resetting scroll keeps the intentionally off-screen skip link out
    // of the visual golden without changing the modal's focus custody.
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await attachScreenshot(
      page,
      'dashboard-governed-action-preview.png',
      testInfo.attach.bind(testInfo),
    );
    await expectGoldenScreenshot(page, 'console-operate-governed-action-dialog.png');

    await expectGovernedDialogFocusTrapped(page, dialog, cancel);
    await expectControlsHitTestable(page, dialog);
    await cancel.click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });

  test('supports explicitly emulated touch for mobile navigation, search, and Action cancellation', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    try {
      await openFixture(page, '#/operate/today');
      expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);

      const mobileNavigation = page.getByRole('navigation', { name: 'Mobile Operate navigation' });
      const more = mobileNavigation.locator('summary[aria-label="More Operate destinations"]');
      const moreSheet = mobileNavigation.locator('details.pc-mobile-more');
      await touchTap(page, more);
      await expect(moreSheet).toHaveAttribute('open', '');
      await touchTap(page, moreSheet.getByRole('link', { name: 'Inbox', exact: true }));
      await expect(page.locator('[data-route-kind="operate.inbox"]')).toBeVisible();
      await expect(moreSheet).not.toHaveAttribute('open', '');

      await touchTap(page, more);
      await expect(moreSheet).toHaveAttribute('open', '');
      await touchTap(page, moreSheet.getByRole('link', { name: 'Evidence' }));
      await expect(page.locator('[data-route-kind="operate.evidence"]')).toBeVisible();
      await expect(moreSheet).not.toHaveAttribute('open', '');

      await touchTap(page, mobileNavigation.getByRole('link', { name: 'Home', exact: true }));
      await expect(page.locator('[data-route-kind="planning.overview"]')).toBeVisible();
      const planningNavigation = page.getByRole('navigation', {
        name: 'Mobile Planning navigation',
      });
      await touchTap(page, planningNavigation.getByRole('link', { name: 'Operate' }));
      await expect(page.locator('[data-route-kind="operate.today"]')).toBeVisible();

      const paletteTrigger = page.getByRole('button', {
        name: 'Jump to a view or an artifact',
      });
      await touchTap(page, paletteTrigger);
      const palette = page.locator('dialog.pc-palette');
      await expect(palette).toBeVisible();
      const paletteInput = palette.getByRole('searchbox');
      await touchTap(page, paletteInput);
      await paletteInput.fill('action');
      const result = palette.getByRole('button', { name: /\bActions\b/u }).first();
      await touchTap(page, result);
      await expect(palette).not.toBeVisible();
      await expect(page.locator('[data-route-kind="operate.actions"]')).toBeVisible();

      await openFixture(page, '#/operate/actions/act_reminder_delivery_0001');
      const trigger = page.getByRole('button', { name: 'Restore the previous reminder settings' });
      await touchTap(page, trigger);
      const dialog = page.getByRole('alertdialog', {
        name: 'Confirm Restore the previous reminder settings',
      });
      await expect(dialog).toBeVisible();
      await touchTap(page, dialog.getByRole('button', { name: 'Cancel' }));
      await expect(dialog).not.toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('keeps desktop-rail destinations legible at tablet widths', async ({ page }) => {
    for (const width of [900, 1024, 1120]) {
      await page.setViewportSize({ width, height: 768 });
      await openFixture(page, '#/operate/today');

      const navigation = page.getByRole('navigation', { name: 'Dashboard navigation' });
      await expect(navigation).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: 'Mobile Operate navigation' }),
      ).not.toBeVisible();
      const labels = await navigation
        .locator('.pc-rail__item > span:last-child')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              text: element.textContent?.trim(),
              width: rect.width,
              height: rect.height,
              clipped: getComputedStyle(element).clip,
            };
          }),
        );

      // Expanded navigation keeps both product groups available (M2).
      expect(labels.map(({ text }) => text)).toEqual([
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
      for (const label of labels) {
        expect(label.width).toBeGreaterThan(24);
        expect(label.height).toBeGreaterThan(10);
        expect(label.clipped).toBe('auto');
      }
      expect((await layoutReport(page)).horizontalOverflow).toBe(false);
    }
  });

  test('exposes every omitted destination in the mobile menu below the desktop breakpoint', async ({
    page,
  }) => {
    for (const width of [801, 899]) {
      await page.setViewportSize({ width, height: 768 });
      await openFixture(page, '#/operate/today');
      await expect(
        page.getByRole('navigation', { name: 'Dashboard navigation' }),
      ).not.toBeVisible();
      const navigation = page.getByRole('navigation', { name: 'Mobile Operate navigation' });
      await expect(navigation).toBeVisible();
      expect(await navigation.getByRole('link').allTextContents()).toEqual([
        'Home',
        'List',
        'Activity',
        'Operate',
      ]);
      await navigation.locator('summary[aria-label="More Operate destinations"]').click();
      const more = navigation.locator('details.pc-mobile-more');
      await expect(more).toHaveAttribute('open', '');
      expect(await more.getByRole('link').allTextContents()).toEqual([
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
      ]);
      await more.getByRole('link', { name: 'Inbox', exact: true }).click();
      await expect(page.locator('[data-route-kind="operate.inbox"]')).toBeVisible();
      await expect(more).not.toHaveAttribute('open', '');
      expect((await layoutReport(page)).horizontalOverflow).toBe(false);
    }
  });

  test('uses a concise visible live status at responsive widths', async ({ page }) => {
    for (const width of [1120, 1024, 801, 800, 768, 480, 390, 320]) {
      await page.setViewportSize({ width, height: 768 });
      await openFixture(page, '#/operate/today');

      const status = page.getByRole('status', { name: 'watcher connected' });
      await expect(status).toBeVisible();
      // The mobile live pill uses its concise label (M3).
      await expect(status.locator('.pc-watcher__label')).toHaveCount(1);
      await expect(status.locator('.pc-watcher__label')).toBeVisible();
      await expect(status.locator('.pc-watcher__label')).toHaveText(
        width < 900 ? 'Live' : 'watcher connected',
      );
      expect((await status.boundingBox())?.width ?? 0).toBeGreaterThan(0);
    }
  });

  test('keeps the minimum-width Today heading and current lifecycle state clear of bottom navigation', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openFixture(page, '#/operate/today');

    const navigation = page.getByRole('navigation', { name: 'Mobile Operate navigation' });
    const title = page.getByRole('heading', { name: 'Confirm appointment reminders are arriving' });
    const currentStage = page.locator('.op-cycle-spine li[aria-current="step"]');
    const [navigationBox, titleBox] = await Promise.all([
      navigation.boundingBox(),
      title.boundingBox(),
    ]);

    expect(navigationBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(await navigation.evaluate((element) => getComputedStyle(element).position)).toBe(
      'fixed',
    );
    expect((titleBox?.y ?? Number.POSITIVE_INFINITY) + (titleBox?.height ?? 0)).toBeLessThanOrEqual(
      navigationBox?.y ?? Number.NEGATIVE_INFINITY,
    );

    await currentStage.scrollIntoViewIfNeeded();
    const [headerBox, currentStageBox, currentNavigationBox] = await Promise.all([
      page.locator('.pc-topbar').boundingBox(),
      currentStage.boundingBox(),
      navigation.boundingBox(),
    ]);
    expect(headerBox).not.toBeNull();
    expect(currentStageBox).not.toBeNull();
    expect(currentNavigationBox).not.toBeNull();
    expect(currentStageBox?.y ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(
      (headerBox?.y ?? 0) + (headerBox?.height ?? 0),
    );
    expect(
      (currentStageBox?.y ?? Number.POSITIVE_INFINITY) + (currentStageBox?.height ?? 0),
    ).toBeLessThanOrEqual(currentNavigationBox?.y ?? Number.NEGATIVE_INFINITY);
  });

  for (const viewport of VIEWPORTS) {
    test(`renders ${viewport.name} without loss or undersized active targets`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openFixture(page, '#/operate/today');
      await expectTodayWorkspaceStatus(page);
      const report = await layoutReport(page);
      expect(report.horizontalOverflow).toBe(false);
      expect(report.undersized).toEqual([]);
      await attachScreenshot(
        page,
        `dashboard-${viewport.name}.png`,
        testInfo.attach.bind(testInfo),
      );
      await expectGoldenScreenshot(page, `console-operate-today-${viewport.name}.png`);
    });
  }

  test('reflows ready content at an automated 200% effective zoom', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 720, height: 450 },
      screen: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    try {
      await openFixture(page, '#/operate/today');
      const scale = await page.evaluate(() => ({
        devicePixelRatio: window.devicePixelRatio,
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      expect(scale).toEqual({ devicePixelRatio: 2, width: 720, height: 450 });
      const report = await layoutReport(page);
      expect(report.horizontalOverflow).toBe(false);
      expect(report.undersized).toEqual([]);
      await expect(
        page.getByRole('heading', { name: 'Confirm appointment reminders are arriving' }),
      ).toBeVisible();
      await attachScreenshot(
        page,
        'dashboard-200-percent-reflow.png',
        testInfo.attach.bind(testInfo),
      );
    } finally {
      await context.close();
    }
  });

  test('renders forced colors and reduced motion as active browser preferences', async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await openFixture(page, '#/operate/inbox', { contrast: 'high' });
    const media = await page.evaluate(() => ({
      forcedColors: matchMedia('(forced-colors: active)').matches,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      motionDuration: getComputedStyle(document.documentElement)
        .getPropertyValue('--op-motion-duration')
        .trim(),
    }));
    expect(media).toEqual({
      forcedColors: true,
      reducedMotion: true,
      motionDuration: '0.01ms',
    });
    expect(await axeViolations(page)).toEqual([]);
    await attachScreenshot(page, 'dashboard-forced-colors.png', testInfo.attach.bind(testInfo));
    await expectGoldenScreenshot(page, 'console-operate-inbox-forced-colors-reduced-motion.png');
  });

  test('escapes hostile project identity instead of creating executable markup', async ({
    page,
  }) => {
    const hostile = '<img src=x onerror="window.__fixtureXssFired=1"> Fixture';
    await openFixture(page, '#/overview', { project: hostile });
    // The breadcrumb displays Plan; project identity remains in its escaped title (T6).
    const identity = page.locator('.pc-topbar__crumb').first();
    await expect(identity).toHaveText('Plan');
    await expect(identity).toHaveAttribute('title', hostile);
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(
      await page.evaluate(() =>
        Reflect.get(window as unknown as Record<string, unknown>, '__fixtureXssFired'),
      ),
    ).toBeUndefined();
  });

  test('keeps the browser fixture out of the production build manifest', async () => {
    let manifest: { assets?: string[] };
    try {
      manifest = JSON.parse(
        readFileSync(resolve(TEST_ROOT, '../../dist/dashboard/dashboard-manifest.json'), 'utf8'),
      ) as { assets?: string[] };
    } catch {
      test.skip(true, 'Production dashboard has not been built in this workspace.');
      return;
    }
    for (const asset of manifest.assets ?? []) {
      expect(asset).not.toMatch(/dashboard-test-entry|fixture/u);
    }
  });
});
