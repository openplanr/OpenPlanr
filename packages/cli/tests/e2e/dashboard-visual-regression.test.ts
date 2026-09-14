/**
 * Real-browser dashboard quality gate.
 *
 * Playwright loads the source-owned fixture server and mounts the production
 * App. Representative states use reviewed Playwright-native golden comparisons;
 * the complete route inventory also emits native PNG attachments. Accessibility
 * and interaction claims are made from the rendered product, never from
 * source-text constants or a blank page.
 */

import { readFileSync } from 'node:fs';
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
} from 'planr-pipeline/dashboard/operate-review-contract';
import {
  dashboardRouteDefinition,
  parseDashboardRoute,
} from '../../../../apps/dashboard/src/app/router.js';
import {
  DASHBOARD_FIXTURE_CYCLE_ID,
  DASHBOARD_FIXTURE_REVIEW_ID,
  DASHBOARD_ROUTE_FIXTURES,
  dashboardRouteFixture,
} from './fixtures/dashboard-route-catalog.js';

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
    if (expectation.composition === 'shell') {
      await expect(page.locator('.op-shell')).toBeVisible();
      await expect(page.locator('#main-content')).toBeVisible();
    } else {
      await expect(page.locator('.op-shell')).toHaveCount(0);
      await expect(page.locator('main.op-diagnostics')).toBeVisible();
    }
    const workspace = page.locator(`[data-route-kind="${expectation.kind}"]`);
    await expect(workspace).toBeVisible();
    if (route === '#/search') {
      const palette = page.locator('dialog.op-command-palette');
      await expect(palette).not.toBeVisible();
      await workspace.getByRole('searchbox', { name: 'Query' }).fill('appointment');
      await expect(workspace).toContainText(expectation.readyText);
    }
    await expect(workspace).toContainText(expectation.readyText);
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
      .filter(({ width, height }) => width < 44 || height < 44);
    return { horizontalOverflow, undersized };
  }, ACTIVE_TARGET_SELECTOR);
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

async function expectGoldenScreenshot(page: Page, name: string) {
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  });
}

async function expectTodayWorkspaceStatus(page: Page) {
  const passport = page.locator('.op-binding-passport');
  await expect(passport).toHaveCount(0);
  await expect(page.locator('.op-live')).toContainText('Workspace online');
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
    for (const fixture of DASHBOARD_ROUTE_FIXTURES) {
      const { hash: route } = fixture;
      await openFixture(page, route);
      if (fixture.composition === 'shell') {
        await expect(page.locator('.op-skip-link')).toHaveAttribute('href', '#main-content');
      } else {
        await expect(page.locator('.op-skip-link')).toHaveCount(0);
      }
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
        await expectGoldenScreenshot(page, 'planning-overview-ready.png');
      }
      if (route === '#/graph') {
        const graph = page.locator('[data-route-kind="planning.graph"]');
        const region = graph.getByRole('region', { name: 'Work relationships' });
        const table = region.getByRole('table', { name: 'Work items and dependencies' });
        await expect(region).toBeVisible();
        await expect(table).toBeVisible();
        await expect(table.locator('caption')).toHaveCount(1);
        await expect(table).toContainText('Improve appointment reminder delivery');
        await expect(table).not.toContainText('SPEC-020');
        await expect(graph).not.toContainText('Accessible planning graph');
        await expect(graph).not.toContainText('Inspect exact artifact');
        await expectGoldenScreenshot(page, 'planning-graph-ready.png');
      }
      if (route === '#/board') {
        await expectGoldenScreenshot(page, 'planning-board-ready.png');
      }
      if (route === '#/operate/today') {
        await expectTodayWorkspaceStatus(page);
        await expectGoldenScreenshot(page, 'operate-today-ready.png');
      }
    }
    expect(new URL(page.url()).origin).toBe(FIXTURE_ORIGIN);
    if (process.env.OPENPLANR_DASHBOARD_FIXTURE_REQUIRE_ISOLATION === '1') {
      expect(FIXTURE_ORIGIN).not.toBe('http://127.0.0.1:4173');
    }
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
    await expect(useful).toContainText('Executive decision docket');
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
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
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
      const workspace = assertOperateReviewDisplayWorkspaceV1(data.workspace);
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

      const region = page.getByRole('region', { name: 'Work relationships' });
      const table = region.getByRole('table', { name: 'Work items and dependencies' });
      await expect(table.locator('caption')).toHaveText('Work items and dependencies');
      await expect(table).toContainText('No linked work');
      expect(await table.innerText()).not.toContain('SPEC-020');
      expect((await layoutReport(page)).horizontalOverflow).toBe(false);

      if (viewport.width === 828) {
        await expect(table.locator('.op-graph-alternative__status')).toHaveCSS(
          'white-space',
          'nowrap',
        );
      }

      if (viewport.width === 320) {
        const graph = region.locator('.op-graph-alternative');
        const row = table.locator('tbody tr').first();
        await expect(row.locator('.op-graph-alternative__mobile-label')).toHaveText([
          'Work item',
          'Status',
          'Relationships',
          'Open',
        ]);
        await expect(row.getByText('In progress', { exact: true })).toBeVisible();
        await expect(row.getByText('No linked work', { exact: true })).toBeVisible();
        await expect(
          row.getByRole('link', { name: 'Open Improve appointment reminder delivery' }),
        ).toBeVisible();
        const graphWidths = await graph.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));
        expect(graphWidths.clientWidth).toBeGreaterThan(0);
        expect(graphWidths.scrollWidth).toBe(graphWidths.clientWidth);
      }

      if (viewport.width >= 1024) {
        await expectSurfaceToUseRouteFrame(page, '.op-graph-alternative');
      }

      if (viewport.width === 1280) {
        await expectGoldenScreenshot(page, 'planning-graph-ready.png');
      }
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
      'Improve appointment reminder delivery',
    );
  });

  test('passes axe on representative Planning and Operate routes', async ({ page }) => {
    for (const route of ['#/overview', '#/graph', '#/operate/today', '#/operate/actions']) {
      await openFixture(page, route);
      expect(await axeViolations(page), `axe violations on ${route}`).toEqual([]);
    }
  });

  test('keeps Planning Overview bounded and decision-focused', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFixture(page, '#/overview');

    const decisionView = page.locator('section[aria-label="Decision view"]');
    await expect(decisionView.getByRole('heading', { name: 'Decision view' })).toBeVisible();
    await expect(decisionView).toContainText('Nothing is blocked. 1 work item is in progress.');
    await expect(decisionView).toContainText('Improve appointment reminder delivery');
    await expect(decisionView).not.toContainText('Highest planning attention');
    await expect(decisionView).not.toContainText('Needs attention');

    const linkNames = await decisionView
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('aria-label')));
    expect(linkNames).toEqual([
      'View current work Improve appointment reminder delivery',
      'View work by status on Board',
      'Browse all planning work in List',
    ]);
    expect(new Set(linkNames).size).toBe(linkNames.length);
    await expectGoldenScreenshot(page, 'planning-overview-wide.png');
  });

  test('keeps a sparse Planning Board focused at wide and narrow widths', async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await openFixture(page, '#/board');

      const board = page.locator('.op-planning-board');
      const column = board.locator('.op-planning-board__column');
      await expect(column).toHaveCount(1);
      await expect(column.getByRole('heading', { name: 'In progress' })).toBeVisible();
      await expect(column).toContainText('Improve appointment reminder delivery');
      expect(await board.textContent()).not.toContain('Outstanding');
      expect(await board.textContent()).not.toContain('Blocked');
      expect((await layoutReport(page)).horizontalOverflow).toBe(false);

      if (viewport.width >= 1024) {
        await expectSurfaceToUseRouteFrame(page, '.op-planning-board');
        await expectSurfaceToUseRouteFrame(page, '.op-planning-board__column');
      }
    }
  });

  test('keeps Planning workspaces aligned to one shared application frame', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [route, selector] of [
      ['#/overview', '.op-planning-overview'],
      ['#/graph', '.op-graph-alternative'],
      ['#/board', '.op-planning-board'],
      ['#/list', '.op-planning-list'],
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
    await expect(page.locator('.op-skip-link')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    await page.keyboard.press('Control+K');
    await expect(page.locator('dialog.op-command-palette')).toBeVisible();
    await expect(page.locator('dialog.op-command-palette input[type="search"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog.op-command-palette')).not.toBeVisible();

    await page.evaluate(() => {
      window.location.hash = '#/operate/recovery';
    });
    await expect(page.locator('.op-route-announcer')).not.toHaveText(initialAnnouncement ?? '');
    await expect(page.locator('.op-route-announcer')).toContainText('Recovery');
    await expect(page.locator('[data-route-kind="operate.recovery"]')).toContainText(
      'Recovery is blocked',
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
    await expect(dialog).toContainText(
      'You are about to Restore the previous reminder settings. Review the reminder setting rollback before confirming.',
    );
    await expect(
      dialog.getByRole('button', { name: 'Confirm Restore the previous reminder settings' }),
    ).toBeVisible();
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    const skipLink = page.locator('.op-skip-link');
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
    await expectGoldenScreenshot(page, 'operate-governed-action-dialog.png');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
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
      await touchTap(page, mobileNavigation.getByRole('link', { name: 'Inbox' }));
      await expect(page.locator('[data-route-kind="operate.inbox"]')).toBeVisible();

      const more = mobileNavigation.locator('summary[aria-label="More Operate destinations"]');
      await touchTap(page, more);
      const moreSheet = mobileNavigation.locator('details.op-mobile-more');
      await expect(moreSheet).toHaveAttribute('open', '');
      await touchTap(page, moreSheet.getByRole('link', { name: 'Evidence' }));
      await expect(page.locator('[data-route-kind="operate.evidence"]')).toBeVisible();

      const paletteTrigger = page.getByRole('button', {
        name: 'Search Planning and Operate destinations',
      });
      await touchTap(page, paletteTrigger);
      const palette = page.locator('dialog.op-command-palette');
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

  test('keeps compact-rail destinations legible at tablet widths', async ({ page }) => {
    for (const width of [801, 1024, 1120]) {
      await page.setViewportSize({ width, height: 768 });
      await openFixture(page, '#/operate/today');

      const navigation = page.getByRole('navigation', { name: 'Operate navigation' });
      const labels = await navigation
        .locator('.op-route-nav__item > span:last-child')
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

      expect(labels.map(({ text }) => text)).toEqual([
        'Today',
        'Cycles',
        'Inbox',
        'Actions',
        'Evidence',
        'Outcomes',
        'History',
        'Recovery',
      ]);
      for (const label of labels) {
        expect(label.width).toBeGreaterThan(40);
        expect(label.height).toBeGreaterThan(10);
        expect(label.clipped).toBe('auto');
      }
      expect((await layoutReport(page)).horizontalOverflow).toBe(false);
    }
  });

  test('uses a concise visible live status at responsive widths', async ({ page }) => {
    for (const width of [1120, 1024, 801, 800, 768, 480, 390, 320]) {
      await page.setViewportSize({ width, height: 768 });
      await openFixture(page, '#/operate/today');

      const status = page.locator('.op-live');
      const fullLabel = status.locator('.op-live__label-full');
      const compactLabel = status.locator('.op-live__label-compact');
      await expect(status.locator('strong')).toHaveAttribute('title', 'Workspace online');
      await expect(compactLabel).toBeVisible();
      await expect(compactLabel).toHaveText('Online');
      await expect(compactLabel).toHaveAttribute('aria-hidden', 'true');

      const [fullBox, compactBox] = await Promise.all([
        fullLabel.boundingBox(),
        compactLabel.boundingBox(),
      ]);
      expect(fullBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);
      expect(compactBox?.width ?? 0).toBeGreaterThan(0);
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
      page.locator('.op-topbar').boundingBox(),
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
      await expectGoldenScreenshot(page, `operate-today-${viewport.name}.png`);
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
    await expectGoldenScreenshot(page, 'operate-inbox-forced-colors-reduced-motion.png');
  });

  test('escapes hostile project identity instead of creating executable markup', async ({
    page,
  }) => {
    const hostile = '<img src=x onerror="window.__fixtureXssFired=1"> Fixture';
    await openFixture(page, '#/overview', { project: hostile });
    await expect(page.locator('.op-project strong')).toHaveText(hostile);
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
