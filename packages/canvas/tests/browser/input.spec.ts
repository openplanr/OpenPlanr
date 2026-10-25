import { expect, type Page, test } from '@playwright/test';
import type {} from '../../bench/main';
import type { Camera } from '../../src/index.mts';
import { waitForBench } from './bench';

async function openBench(page: Page, query = ''): Promise<void> {
  await page.goto(`/?${query}`);
  await waitForBench(page);
}

test('reports bench setup errors instead of waiting for readiness', async ({ page }) => {
  await expect(openBench(page, 'fixture=invalid')).rejects.toThrow(
    'Canvas bench failed: fixture: invalid',
  );
});
async function camera(page: Page): Promise<Camera> {
  return page.evaluate(() => window.canvas.getCamera());
}
async function emptyPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    for (let y = 750; y >= 30; y -= 30) {
      for (let x = 1300; x >= 30; x -= 30) {
        const target = document.elementFromPoint(x, y);
        if (target?.closest('#stage') && !target.closest('[data-canvas-node-id]')) return { x, y };
      }
    }
    throw new Error('Bench has no empty-stage point');
  });
}
async function drag(page: Page, space = false, button: 'left' | 'middle' = 'left'): Promise<void> {
  const start = await emptyPoint(page);
  await page.locator('#stage').focus();
  if (space) await page.keyboard.down('Space');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button });
  await page.mouse.move(start.x + 70, start.y + 45, { steps: 4 });
  await page.mouse.up({ button });
  if (space) await page.keyboard.up('Space');
}

for (const world of ['html', 'svg']) {
  test(`${world} counter preserves multiple native transform mutations in one batch`, async ({
    page,
  }) => {
    await openBench(page, `world=${world}`);
    const counts = await page.evaluate(async () => {
      const sum = () =>
        window.bench.transformWrites.reduce(
          (total, frame) => ({
            world: total.world + frame.world,
            overlay: total.overlay + frame.overlay,
          }),
          { world: 0, overlay: 0 },
        );
      const before = sum();
      const world = document.querySelector('.canvas-world');
      const overlay = document.querySelector('[data-overlay]');
      if (!world || !overlay) throw new Error('Bench transform targets are missing');
      if (!(world instanceof HTMLElement) || !(overlay instanceof HTMLElement))
        throw new Error('Bench camera targets must be HTML wrappers');
      world.style.transform = 'scale(2)';
      world.style.willChange = '';
      world.style.transform = 'scale(3)';
      overlay.style.transform = 'scale(2)';
      overlay.style.transform = 'scale(3)';
      await Promise.resolve();
      const after = sum();
      return { world: after.world - before.world, overlay: after.overlay - before.overlay };
    });
    expect(counts).toEqual({ world: 2, overlay: 2 });
  });

  test(`${world} coalesces 180 pan frames into one transform write per target`, async ({
    page,
  }) => {
    await openBench(page, `world=${world}`);
    const result = await page.evaluate(() => window.bench.run('pan-100'));
    expect(result.writes).toHaveLength(180);
    for (const frame of result.writes) {
      expect(frame.world).toBe(1);
      expect(frame.overlay).toBe(1);
    }
    const frames = result.writes.map((frame) => frame.frame);
    expect(new Set(frames).size).toBe(180);
    expect(frames.at(-1)).toBe(frames[0] + 179);
  });
}

for (const pointerMode of ['pan', 'none']) {
  test(`mouse drag honours ${pointerMode} and Space always pans`, async ({ page }) => {
    await openBench(page, `pointerMode=${pointerMode}`);
    const before = await camera(page);
    await drag(page);
    const after = await camera(page);
    if (pointerMode === 'pan') {
      expect(after.x).toBeCloseTo(before.x - 70, 5);
      expect(after.y).toBeCloseTo(before.y - 45, 5);
    } else expect(after).toEqual(before);
    await drag(page, true);
    const afterSpace = await camera(page);
    expect(afterSpace.x).toBeCloseTo(after.x - 70, 5);
    expect(afterSpace.y).toBeCloseTo(after.y - 45, 5);
  });
}

test('middle-button pan captures the pointer until release', async ({ page }) => {
  await openBench(page, 'pointerMode=none');
  await page.evaluate(() => {
    const stage = document.getElementById('stage');
    if (!stage) throw new Error('Stage is missing');
    stage.addEventListener('gotpointercapture', () => {
      stage.dataset.captured = 'yes';
    });
    stage.addEventListener('lostpointercapture', () => {
      stage.dataset.released = 'yes';
    });
  });
  await drag(page, false, 'middle');
  expect((await camera(page)).x).toBeCloseTo(-70, 5);
  await expect(page.locator('#stage')).toHaveAttribute('data-captured', 'yes');
  await expect(page.locator('#stage')).toHaveAttribute('data-released', 'yes');
});

test('Ctrl wheel preserves the world point under the cursor', async ({ page }) => {
  await openBench(page);
  const point = { x: 620, y: 350 };
  const before = await page.evaluate((screen) => window.canvas.screenToWorld(screen), point);
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -180);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(1);
  const projected = await page.evaluate((world) => window.canvas.worldToScreen(world), before);
  expect(Math.hypot(projected.x - point.x, projected.y - point.y)).toBeLessThan(1);
});

test('two-finger CDP pinch zooms and keeps its centre anchored', async ({ page, context }) => {
  await openBench(page, 'pointerMode=none');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const centre = { x: 700, y: 450 };
  const world = await page.evaluate((point) => window.canvas.screenToWorld(point), centre);
  const before = await camera(page);
  const points = (radius: number) => [
    { x: centre.x - radius, y: centre.y, id: 1 },
    { x: centre.x + radius, y: centre.y, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(60) });
  for (const radius of [70, 85, 100, 120]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(radius) });
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(before.zoom * 1.8);
  const projected = await page.evaluate((point) => window.canvas.worldToScreen(point), world);
  expect(Math.hypot(projected.x - centre.x, projected.y - centre.y)).toBeLessThan(1);
  await cdp.detach();
});

for (const modifier of ['Control', 'Meta']) {
  test(`${modifier} browser zoom keys remain unconsumed`, async ({ page }) => {
    await openBench(page);
    const before = await camera(page);
    const prevented = await page.evaluate((keyModifier) => {
      const stage = document.getElementById('stage');
      if (!stage) throw new Error('Stage is missing');
      stage.focus();
      return ['+', '=', '-', '0'].map((key) => {
        const event = new KeyboardEvent('keydown', {
          key,
          ctrlKey: keyModifier === 'Control',
          metaKey: keyModifier === 'Meta',
          bubbles: true,
          cancelable: true,
        });
        stage.dispatchEvent(event);
        return event.defaultPrevented;
      });
    }, modifier);
    expect(prevented).toEqual([false, false, false, false]);
    expect(await camera(page)).toEqual(before);
  });
}

test('camera keyboard shortcuts apply once and report consumption', async ({ page }) => {
  await openBench(page);
  const results = await page.evaluate(() => {
    const stage = document.getElementById('stage');
    if (!stage) throw new Error('Stage is missing');
    stage.focus();
    const dispatch = (key: string, shiftKey = false, isComposing = false) => {
      let consumed = false;
      stage.addEventListener(
        'keydown',
        (event) => {
          consumed = window.canvas.handleKey(event);
          event.stopImmediatePropagation();
        },
        { capture: true, once: true },
      );
      const event = new KeyboardEvent('keydown', {
        key,
        shiftKey,
        isComposing,
        bubbles: true,
        cancelable: true,
      });
      stage.dispatchEvent(event);
      return { consumed, prevented: event.defaultPrevented, camera: window.canvas.getCamera() };
    };
    const zoomIn = dispatch('+');
    const zoomOut = dispatch('-');
    const reset = dispatch('0');
    const equals = dispatch('=');
    dispatch('0');
    const shiftArrow = dispatch('ArrowRight', true);
    const shiftDown = dispatch('ArrowDown', true);
    const shiftLeft = dispatch('ArrowLeft', true);
    const shiftUp = dispatch('ArrowUp', true);
    const unsupported = dispatch('q');
    const composing = dispatch('+', false, true);
    const arrow = dispatch('ArrowRight');
    window.canvas.setSelection([]);
    const fit = dispatch('1', true);
    const fitSelection = dispatch('2', true);
    return {
      safeArea: window.canvas.getSafeArea(),
      zoomIn,
      zoomOut,
      reset,
      equals,
      shiftArrow,
      shiftDown,
      shiftLeft,
      shiftUp,
      unsupported,
      composing,
      arrow,
      fit,
      fitSelection,
    };
  });
  expect(results.zoomIn.camera.zoom).toBeCloseTo(1.25, 8);
  expect(results.zoomOut.camera.zoom).toBeCloseTo(1, 8);
  expect(results.reset.camera.zoom).toBe(1);
  expect(results.safeArea).toEqual({ x: 12, y: 12, width: 1416, height: 876 });
  expect(results.shiftArrow.camera.x - results.reset.camera.x).toBeCloseTo(
    results.safeArea.width / 4,
    6,
  );
  expect(results.equals.camera.zoom).toBeCloseTo(1.25, 8);
  expect(results.shiftDown.camera.y - results.shiftArrow.camera.y).toBeCloseTo(
    results.safeArea.height / 4,
    6,
  );
  expect(results.shiftLeft.camera.x - results.shiftDown.camera.x).toBeCloseTo(
    -results.safeArea.width / 4,
    6,
  );
  expect(results.shiftUp.camera.y - results.shiftLeft.camera.y).toBeCloseTo(
    -results.safeArea.height / 4,
    6,
  );
  for (const name of [
    'zoomIn',
    'zoomOut',
    'reset',
    'equals',
    'shiftArrow',
    'shiftDown',
    'shiftLeft',
    'shiftUp',
    'arrow',
    'fit',
    'fitSelection',
  ] as const) {
    expect(results[name].consumed).toBe(true);
    expect(results[name].prevented).toBe(true);
  }
  for (const name of ['unsupported', 'composing'] as const) {
    expect(results[name].consumed).toBe(false);
    expect(results[name].prevented).toBe(false);
  }
});

test('stage shortcuts do not fire in editable elements or outside the stage', async ({ page }) => {
  await openBench(page, 'pointerMode=none');
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'stage-input';
    input.setAttribute('aria-label', 'Stage input');
    Object.assign(input.style, { position: 'absolute', left: '10px', bottom: '10px' });
    document.getElementById('stage')?.append(input);
  });
  const before = await camera(page);
  await page.locator('#stage-input').focus();
  await page.keyboard.press('+');
  await page.keyboard.press('Space');
  expect(await camera(page)).toEqual(before);
  await page.locator('#editable').focus();
  await page.keyboard.down('Space');
  const start = await emptyPoint(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 50, start.y + 30);
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect(await camera(page)).toEqual(before);
});

test('wheel over an inactive iframe pans, zooms and shields it during camera motion', async ({
  page,
  context,
}) => {
  await openBench(page, 'frame=1');
  const frame = page.locator('iframe');
  await expect(frame).toHaveCSS('pointer-events', 'none');
  const before = await camera(page);
  await frame.hover({ force: true });
  await page.mouse.wheel(40, 70);
  await expect.poll(async () => (await camera(page)).y).toBeGreaterThan(before.y);
  const dpr = await page.evaluate(() => devicePixelRatio);
  for (const cdpPinch of [false, true]) {
    const start = await camera(page);
    const bounds = await frame.boundingBox();
    if (!bounds) throw new Error('Preview frame has no bounds');
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await page.mouse.move(point.x, point.y);
    if (cdpPinch) {
      const session = await context.newCDPSession(page);
      try {
        await session.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          ...point,
          deltaX: 0,
          deltaY: -10,
          modifiers: 2,
        });
      } finally {
        await session.detach();
      }
    } else {
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -10);
      await page.keyboard.up('Control');
    }
    await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(start.zoom);
    expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
    expect(await page.evaluate(() => devicePixelRatio)).toBe(dpr);
  }
  await page.evaluate(() => window.canvas.setActiveFrame('preview-frame'));
  await expect(frame).toHaveCSS('pointer-events', 'auto');
  await page.evaluate(() => window.canvas.panBy(10, 10));
  await expect(frame).toHaveCSS('pointer-events', 'none');
  await expect(frame).toHaveCSS('pointer-events', 'auto');
});

for (const exit of ['pointer Done', 'touch Done', 'keyboard Done', 'outside click']) {
  test(`${exit} deactivates a frame when focus is inside it`, async ({ page, context }) => {
    await openBench(page, 'frame=1');
    await page.evaluate(() => window.canvas.setActiveFrame('preview-frame'));
    const frame = page.locator('iframe');
    await expect(frame).toHaveCSS('pointer-events', 'auto');
    await page.frameLocator('iframe').locator('#frame-field').focus();
    const done = page.getByRole('button', { name: 'Done interacting with frame', exact: true });
    await expect(done).toBeVisible();
    if (exit === 'pointer Done') await done.click();
    else if (exit === 'touch Done') {
      const bounds = await done.boundingBox();
      if (!bounds) throw new Error('Done button has no bounds');
      const session = await context.newCDPSession(page);
      try {
        await session.send('Emulation.setTouchEmulationEnabled', {
          enabled: true,
          maxTouchPoints: 2,
        });
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id: 1 }],
        });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } finally {
        await session.detach();
      }
    } else if (exit === 'keyboard Done') {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await page.keyboard.press('Tab');
        if (await done.evaluate((element) => element === document.activeElement)) break;
      }
      await expect(done).toBeFocused();
      await page.keyboard.press('Enter');
    } else {
      const point = await emptyPoint(page);
      await page.mouse.click(point.x, point.y);
    }
    await expect.poll(() => page.evaluate(() => window.canvas.getActiveFrame())).toBeNull();
    await expect(done).toHaveCount(0);
    await expect(frame).toHaveCSS('pointer-events', 'none');
  });
}

test('reduced motion makes an animated move immediate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openBench(page);
  const next = { x: 21, y: 37, zoom: 0.5 };
  const actual = await page.evaluate((value) => {
    window.canvas.setCamera(value, { animate: true });
    return window.canvas.getCamera();
  }, next);
  expect(actual).toEqual(next);
});

test('the product shortcut switch disables character zoom keys and preserves arrow panning', async ({
  page,
}) => {
  await openBench(page, 'shortcuts=off');
  await page.locator('#stage').focus();
  const before = await camera(page);
  const safe = await page.evaluate(() => window.canvas.getSafeArea());
  await page.keyboard.press('+');
  expect(await camera(page)).toEqual(before);
  await page.keyboard.press('Shift+ArrowRight');
  const after = await camera(page);
  expect(after.x - before.x).toBeCloseTo(safe.width / 4 / before.zoom, 6);
  expect(after.y).toBe(before.y);
  expect(after.zoom).toBe(before.zoom);
  const consumed = await page.evaluate(() =>
    window.canvas.handleKey(new KeyboardEvent('keydown', { key: '+' })),
  );
  expect(consumed).toBe(false);
});

test('trace scenarios start at fit and sweep from 100 percent through fit back to 100 percent', async ({
  page,
}) => {
  await openBench(page);
  const fit = await page.evaluate(() => window.bench.run('pan-fit'));
  expect(fit.fitCamera.zoom).toBeLessThan(1);
  expect(fit.startCamera).toEqual(fit.fitCamera);
  const sweep = await page.evaluate(() => window.bench.run('zoom-sweep'));
  expect(sweep.startCamera.zoom).toBe(1);
  expect(sweep.minimumZoom).toBeCloseTo(sweep.fitCamera.zoom, 9);
  expect(sweep.endCamera.zoom).toBeCloseTo(1, 9);
});

for (const pointerMode of ['pan', 'none']) {
  test(`one-finger touch follows ${pointerMode}`, async ({ page, context }) => {
    await openBench(page, `pointerMode=${pointerMode}`);
    await expect(page.locator('#stage')).toHaveCSS('touch-action', 'none');
    const start = await emptyPoint(page);
    const before = await camera(page);
    const session = await context.newCDPSession(page);
    try {
      await session.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 2,
      });
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...start, id: 1 }],
      });
      for (let step = 1; step <= 4; step += 1) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: start.x + step * 10, y: start.y + step * 5, id: 1 }],
        });
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
        );
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const after = await camera(page);
      if (pointerMode === 'pan') {
        expect(after.x).toBeCloseTo(before.x - 40, 5);
        expect(after.y).toBeCloseTo(before.y - 20, 5);
      } else expect(after).toEqual(before);
    } finally {
      await session.detach();
    }
  });
}

test('wheel prevention is scoped to the stage', async ({ page }) => {
  await openBench(page);
  const prevented = await page.evaluate(() => {
    return ['stage', 'editable'].map((id) => {
      const element = document.getElementById(id);
      if (!element) throw new Error(`Wheel target ${id} is missing`);
      const event = new WheelEvent('wheel', {
        ctrlKey: true,
        deltaY: -10,
        clientX: 500,
        clientY: 400,
        cancelable: true,
        bubbles: true,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
  });
  expect(prevented).toEqual([true, false]);
});

test('stage camera keys work through browser keyboard dispatch', async ({ page }) => {
  await openBench(page);
  await page.locator('#stage').focus();
  await page.keyboard.press('+');
  expect((await camera(page)).zoom).toBeCloseTo(1.25, 8);
  await page.keyboard.press('-');
  expect((await camera(page)).zoom).toBeCloseTo(1, 8);
  const beforePan = await camera(page);
  const safe = await page.evaluate(() => window.canvas.getSafeArea());
  await page.keyboard.press('Shift+ArrowRight');
  expect((await camera(page)).x - beforePan.x).toBeCloseTo(safe.width / 4 / beforePan.zoom, 6);
  await page.keyboard.press('Shift+1');
  await expect.poll(async () => (await camera(page)).zoom).toBeLessThan(0.5);
  const fitted = await camera(page);
  await page.evaluate(() => window.canvas.setSelection(['node-1']));
  await page.keyboard.press('Shift+2');
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(fitted.zoom);
  await page.keyboard.press('0');
  await expect.poll(async () => (await camera(page)).zoom).toBe(1);
});
