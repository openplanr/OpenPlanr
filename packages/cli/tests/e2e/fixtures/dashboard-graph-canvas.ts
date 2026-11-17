import { expect, type Locator, type Page, test } from '@playwright/test';
import { installDashboardLayoutShifts } from '../../dashboard/fixtures/dashboard-layout-shifts.js';

type OpenFixture = (
  page: Page,
  route: string,
  options?: Readonly<Record<string, string>>,
) => Promise<void>;
type Camera = Readonly<{ x: number; y: number; zoom: number }>;
type Box = Readonly<{ x: number; y: number; width: number; height: number }>;

/** The engine writes `scale(z) translate(-x, -y)` on the world layer; this reads it back. */
export async function graphCamera(page: Page): Promise<Camera> {
  return page.locator('.pc-graph .canvas-world').evaluate((world) => {
    const match =
      /scale\(([-\d.e+]+)\) translate\(([-\d.e+]+)px, ([-\d.e+]+)px\)/u.exec(
        (world as HTMLElement).style.transform,
      ) ?? [];
    const [zoom, x, y] = match.slice(1).map(Number);
    if (![zoom, x, y].every(Number.isFinite)) throw new Error('The Graph camera is not written.');
    return { zoom: zoom as number, x: -(x as number), y: -(y as number) };
  });
}

/** Resolves once the camera has stopped moving for several frames. */
export async function settleGraph(page: Page): Promise<Camera> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = '';
        let still = 0;
        const step = () => {
          const transform =
            document.querySelector<HTMLElement>('.pc-graph .canvas-world')?.style.transform ?? '';
          still = transform === last ? still + 1 : 0;
          last = transform;
          if (still >= 12) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
  return graphCamera(page);
}

function required(box: Box | null, name: string): Box {
  if (!box) throw new Error(`Missing ${name}.`);
  return box;
}

async function tool(page: Page, name: string): Promise<Locator> {
  return page.locator('[data-chrome-slot="toolbar"]').getByRole('button', { name, exact: true });
}

/** Area left for content between the floating pills, panels, minimap and help. */
async function safeArea(page: Page): Promise<Box> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Missing viewport.');
  const toolbar = required(
    await page.locator('[data-chrome-slot="toolbar"]').boundingBox(),
    'tool pill',
  );
  const sidebar = page.locator('[data-chrome-slot="sidebar"][data-open="true"]');
  const right = (await sidebar.count())
    ? required(await sidebar.boundingBox(), 'sidebar').x
    : viewport.width;
  const minimap = required(await page.locator('.pc-graph-minimap').boundingBox(), 'minimap');
  return {
    x: 0,
    y: toolbar.y + toolbar.height,
    width: right,
    height: minimap.y - toolbar.y - toolbar.height,
  };
}

function inside(inner: Box, outer: Box, tolerance = 1): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

/** Browser coverage for the Graph on the shared canvas engine. */
export function registerGraphCanvasBrowserTests(openFixture: OpenFixture) {
  test.describe('Graph on the canvas engine', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
    });

    test('moves the camera to the clicked minimap point within 2 px', async ({ page }) => {
      await openFixture(page, '#/graph', { planningScenario: 'delivery' });
      await (await tool(page, 'Whole project')).click();
      const camera = await settleGraph(page);
      const minimap = page.locator('.pc-graph-minimap');
      const canvas = required(await minimap.locator('canvas').boundingBox(), 'minimap canvas');
      const frame = required(
        await minimap.locator('.pc-graph-minimap__viewport').boundingBox(),
        'minimap viewport',
      );
      const stage = required(await page.locator('.pc-graph').boundingBox(), 'stage');
      // The viewport outline is the stage in minimap pixels: recover the minimap transform.
      const scale = frame.width / (stage.width / camera.zoom);
      const offset = {
        x: frame.x - canvas.x - camera.x * scale,
        y: frame.y - canvas.y - camera.y * scale,
      };
      const click = { x: canvas.width * 0.8, y: canvas.height * 0.3 };
      const world = { x: (click.x - offset.x) / scale, y: (click.y - offset.y) / scale };
      await page.mouse.click(canvas.x + click.x, canvas.y + click.y);
      const moved = await settleGraph(page);
      expect(moved.zoom).toBe(camera.zoom);
      const centre = {
        x: moved.x + stage.width / 2 / moved.zoom,
        y: moved.y + stage.height / 2 / moved.zoom,
      };
      expect(Math.abs(centre.x - world.x) * moved.zoom).toBeLessThanOrEqual(2);
      expect(Math.abs(centre.y - world.y) * moved.zoom).toBeLessThanOrEqual(2);
    });

    test('fits the selection inside the safe area with the inspector open', async ({ page }) => {
      await openFixture(page, '#/graph', { planningScenario: 'delivery' });
      await settleGraph(page);
      const node = page.locator('.pc-graph-node[data-canonical-id="T-073"]');
      await node.click();
      await expect(page.getByRole('region', { name: 'Inspector', exact: true })).toBeVisible();
      await page.mouse.move(400, 400);
      await page.mouse.wheel(-900, 600);
      await settleGraph(page);
      expect(inside(required(await node.boundingBox(), 'panned node'), await safeArea(page))).toBe(
        false,
      );
      await node.focus();
      await page.keyboard.press('f');
      await settleGraph(page);
      const box = required(await node.boundingBox(), 'fitted node');
      expect(inside(box, await safeArea(page))).toBe(true);
      await expect(page.getByRole('region', { name: 'Inspector', exact: true })).toBeVisible();
      // F only fits: the lens and focus scope stay as they were.
      await expect(await tool(page, 'Dependencies')).toHaveAttribute('aria-pressed', 'true');
    });

    test('keeps fits below the phone tool bar and offers the minimap and Outline in More', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openFixture(page, '#/graph', { planningScenario: 'delivery' });
      const bar = page.getByRole('toolbar', { name: 'Graph tools' });
      await bar.getByRole('button', { name: 'Lineage', exact: true }).click();
      await settleGraph(page);
      const toolbar = required(await bar.boundingBox(), 'phone tool bar');
      const nodes = await page
        .locator('.pc-graph-node')
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
      expect(nodes.length).toBeGreaterThan(0);
      expect(Math.min(...nodes)).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
      await bar.getByText('More', { exact: true }).click();
      const minimap = bar.getByRole('button', { name: 'Graph minimap, center viewport' });
      await expect(minimap).toBeVisible();
      await expect(bar.getByRole('listbox', { name: 'Graph nodes' })).toBeVisible();
      const before = await graphCamera(page);
      const canvas = required(await minimap.locator('canvas').boundingBox(), 'phone minimap');
      await page.mouse.click(canvas.x + canvas.width * 0.9, canvas.y + canvas.height / 2);
      expect((await settleGraph(page)).x).not.toBe(before.x);
    });

    test('fits the longest dependency chain of the 5,000-node fixture', async ({ page }) => {
      test.setTimeout(120_000);
      const reset = await page.request.post('/__fixture/reset?dataset=scaling');
      expect(reset.ok(), await reset.text()).toBe(true);
      await page.goto('/__production/?dataset=scaling#/graph');
      await expect(page.getByRole('group', { name: 'Dependency graph' })).toBeVisible();
      await (await tool(page, 'Whole project')).click();
      const camera = await settleGraph(page);
      expect(camera.zoom).toBeGreaterThanOrEqual(0.0001);
      expect(camera.zoom).toBeLessThan(0.01);
      const canvas = required(
        await page.locator('.pc-graph-minimap canvas').boundingBox(),
        'minimap canvas',
      );
      const frame = required(
        await page.locator('.pc-graph-minimap__viewport').boundingBox(),
        'minimap viewport',
      );
      // The chain is far wider than tall, so the whole graph spans the minimap's width.
      expect(frame.x).toBeLessThanOrEqual(canvas.x + 1);
      expect(frame.x + frame.width).toBeGreaterThanOrEqual(canvas.x + canvas.width - 1);
      await expect(page.locator('.canvas-overview')).toBeVisible();
    });

    test('dispatches each arrow once along connected neighbours and announces the edge', async ({
      page,
    }) => {
      await openFixture(page, '#/graph', { planningScenario: 'delivery' });
      await settleGraph(page);
      await page.evaluate(() => {
        const counts = { keys: 0, moves: 0 };
        Object.assign(window, { graphKeyCounts: counts });
        document.addEventListener('keydown', () => counts.keys++, true);
        document.querySelector('.pc-graph')?.addEventListener('focusin', (event) => {
          if ((event.target as Element).matches('[data-canvas-node-id]')) counts.moves++;
        });
      });
      const ids = await page.locator('.pc-graph-node').evaluateAll((nodes) =>
        nodes
          .map((node) => ({
            id: node.getAttribute('data-canonical-id') ?? '',
            x: node.getBoundingClientRect().x,
          }))
          .sort((left, right) => left.x - right.x)
          .map((node) => node.id),
      );
      expect(ids.length).toBeGreaterThan(1);
      const first = page.locator(`.pc-graph-node[data-canonical-id="${ids[0]}"]`);
      await first.focus();
      await page.evaluate(() => {
        const counts = (window as unknown as { graphKeyCounts: { keys: number; moves: number } })
          .graphKeyCounts;
        counts.keys = 0;
        counts.moves = 0;
      });
      for (const id of ids.slice(1)) {
        await page.keyboard.press('ArrowRight');
        await expect(page.locator(`.pc-graph-node[data-canonical-id="${id}"]`)).toBeFocused();
      }
      expect(
        await page.evaluate(
          () => (window as unknown as { graphKeyCounts: unknown }).graphKeyCounts,
        ),
      ).toEqual({ keys: ids.length - 1, moves: ids.length - 1 });
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.pc-graph [role="status"]')).toHaveText('Edge of canvas');
      await expect(page.locator(`.pc-graph-node[data-canonical-id="${ids.at(-1)}"]`)).toBeFocused();
    });

    test('lists every node in the Outline and jumps to one', async ({ page }) => {
      await openFixture(page, '#/graph', { planningScenario: 'delivery' });
      await (await tool(page, 'Whole project')).click();
      await settleGraph(page);
      const shown = Number(
        /(\d+) of \d+ nodes/u.exec(
          (await page.locator('[data-route-kind="planning.graph"]').textContent()) ?? '',
        )?.[1],
      );
      await page.getByRole('button', { name: 'Sidebar', exact: true }).click();
      await page.getByRole('tab', { name: 'Outline' }).click();
      const outline = page.getByRole('listbox', { name: 'Graph nodes' });
      const option = outline.getByRole('option').first();
      await expect(option).toHaveAttribute('aria-setsize', String(shown));
      await option.focus();
      await page.keyboard.press('End');
      const last = outline.locator(`[aria-posinset="${shown}"]`);
      await expect(last).toBeFocused();
      const id = ((await last.textContent()) ?? '').match(/^[A-Z]+-\d+/u)?.[0];
      await page.keyboard.press('Enter');
      const node = page.locator(`.pc-graph-node[data-canonical-id="${id}"]`);
      await expect(node).toBeFocused();
      await settleGraph(page);
      expect(inside(required(await node.boundingBox(), 'jumped node'), await safeArea(page))).toBe(
        true,
      );
    });

    test('keeps camera and stage through 16 chrome toggles and pans minimally for a covered selection', async ({
      page,
    }) => {
      await page.addInitScript(installDashboardLayoutShifts);
      await openFixture(page, '#/graph', { planningScenario: 'delivery' });
      await settleGraph(page);
      const selected = page.locator('.pc-graph-node[data-canonical-id="QT-071"]');
      await selected.click();
      await expect(page.getByRole('region', { name: 'Inspector', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-chrome-slot="sidebar"]')).toHaveAttribute(
        'data-open',
        'false',
      );
      const stage = page.locator('.pc-graph');
      const before = { camera: await settleGraph(page), stage: await stage.boundingBox() };
      for (let index = 0; index < 16; index += 1) {
        await page.evaluate(
          (phase) => window.__dashboardLayoutShifts.markPhase(phase),
          `chrome-toggle ${index}`,
        );
        await page.keyboard.press(index % 2 === 0 ? 'Alt+BracketRight' : 'Alt+BracketLeft');
        await page.waitForTimeout(250);
        expect({ camera: await graphCamera(page), stage: await stage.boundingBox() }).toEqual(
          before,
        );
      }
      const shifts = await page.evaluate(() =>
        window.__dashboardLayoutShifts
          .snapshot()
          .shifts.filter((shift) => shift.phase.startsWith('chrome-toggle')),
      );
      expect(shifts.reduce((sum, shift) => sum + shift.value, 0)).toBe(0);
      for (const slot of ['sidebar', 'navigation'])
        if (
          (await page.locator(`[data-chrome-slot="${slot}"]`).getAttribute('data-open')) === 'true'
        )
          await page.keyboard.press(slot === 'sidebar' ? 'Alt+BracketRight' : 'Alt+BracketLeft');
      // Pan the selection under the sidebar's place, then open it: the camera pans, never zooms.
      const node = required(await selected.boundingBox(), 'selected node');
      const viewport = page.viewportSize();
      if (!viewport) throw new Error('Missing viewport.');
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.mouse.wheel(node.x - (viewport.width - 200), 0);
      const covered = await settleGraph(page);
      await page.keyboard.press('Alt+BracketRight');
      await page.waitForTimeout(400);
      const revealed = await settleGraph(page);
      expect(revealed.zoom).toBe(covered.zoom);
      expect(revealed.x).not.toBe(covered.x);
      const sidebar = required(
        await page.locator('[data-chrome-slot="sidebar"]').boundingBox(),
        'sidebar',
      );
      const after = required(await selected.boundingBox(), 'revealed node');
      expect(after.x + after.width).toBeLessThanOrEqual(sidebar.x);
      // Minimal: the card ends next to the sidebar rather than centred.
      expect(sidebar.x - (after.x + after.width)).toBeLessThan(80);
    });

    test('zooms the canvas, never the page, for ctrl+wheel and pinch over a card', async ({
      page,
    }) => {
      await openFixture(page, '#/graph', { planningScenario: 'delivery' });
      const start = await settleGraph(page);
      const card = required(
        await page.locator('.pc-graph-node[data-canonical-id="QT-071"]').boundingBox(),
        'card',
      );
      const centre = { x: card.x + card.width / 2, y: card.y + card.height / 2 };
      await page.mouse.move(centre.x, centre.y);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -120);
      await page.keyboard.up('Control');
      const wheeled = await settleGraph(page);
      expect(wheeled.zoom).toBeGreaterThan(start.zoom);
      expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.synthesizePinchGesture', {
        x: centre.x,
        y: centre.y,
        scaleFactor: 0.5,
        relativeSpeed: 600,
        gestureSourceType: 'mouse',
      });
      await cdp.detach();
      const pinched = await settleGraph(page);
      expect(pinched.zoom).toBeLessThan(wheeled.zoom);
      expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
      // The Graph renders no iframes, so there is no embedded frame to cover here.
      expect(await page.locator('.pc-graph iframe').count()).toBe(0);
    });
  });
}
