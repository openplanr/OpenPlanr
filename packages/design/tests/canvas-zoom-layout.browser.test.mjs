import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { designFixture } from './design-fixture.mjs';
import { startDesignReview } from './studio-http-fixture.mjs';
import { settleStudioChrome } from './studio-readiness.mjs';

const ZOOM_STEPS = 24;
const SCRIPT_EVENTS = new Set([
  'EventDispatch',
  'FunctionCall',
  'TimerFire',
  'FireAnimationFrame',
  'v8.callFunction',
]);

async function traceEvents(session) {
  const completed = new Promise((resolve) =>
    session.once('Tracing.tracingComplete', (event) => resolve(event.stream)),
  );
  await session.send('Tracing.end');
  const stream = await completed;
  let contents = '';
  for (;;) {
    const chunk = await session.send('IO.read', { handle: stream });
    contents += chunk.base64Encoded
      ? Buffer.from(chunk.data, 'base64').toString('utf8')
      : chunk.data;
    if (chunk.eof) break;
  }
  await session.send('IO.close', { handle: stream });
  return JSON.parse(contents).traceEvents;
}

/** Counts layouts forced by script on the studio frame while `zoom` drives the canvas. */
async function forcedZoomLayouts({ minimap, zoom }) {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-canvas-zoom-layout-'));
  let browser, session;
  try {
    const { file, document } = designFixture(root, { count: 4 });
    document.layout = {
      sections: [
        { id: 'start', x: 0, y: -120, text: 'Workspace journey', maxW: 320 },
        { id: 'review', x: 1800, y: -120, text: 'Review and release', maxW: 320 },
      ],
    };
    writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
    await renderDesignDocument(file);
    session = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      port: 0,
    });
    browser = await launchBrowser({ engine: browserEngine() });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(session.url);
    await page.locator('[data-design-ready="true"]').waitFor();
    await settleStudioChrome(page);
    if (minimap) {
      // Designs with few screens start with the minimap closed.
      await page.locator('button', { hasText: /^Minimap$/ }).dispatchEvent('click');
      await page.locator('.design-minimap:not([hidden])').waitFor();
    }
    await page.locator('[data-design-fit]').click();
    await settleStudioChrome(page);
    const box = await page.locator('.planr-stage-scroll').boundingBox();
    const center = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    await page.mouse.move(center.x, center.y);
    const cdp = await page.context().newCDPSession(page);
    const { frameTree } = await cdp.send('Page.getFrameTree');
    await cdp.send('Tracing.start', {
      categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing',
      transferMode: 'ReturnAsStream',
    });
    const before = await page.evaluate(() => window.__openPlanrDesignStudio.getState().zoom);
    await page.evaluate(() => performance.mark('zoom-start'));
    const frames = await zoom(page, cdp, center);
    await page.evaluate(() => performance.mark('zoom-end'));
    const zooms = await page.evaluate(() => window.__openPlanrDesignStudio.getState().zoom);
    const events = await traceEvents(cdp);
    assert.notEqual(zooms, before, 'The gesture zooms the studio canvas');
    const start = events.find((event) => event.name === 'zoom-start');
    const end = events.find((event) => event.name === 'zoom-end');
    const main = events.filter(
      (event) =>
        event.pid === start.pid &&
        event.tid === start.tid &&
        event.ph === 'X' &&
        event.ts >= start.ts &&
        event.ts <= end.ts,
    );
    const scripts = main.filter((event) => SCRIPT_EVENTS.has(event.name));
    const forced = main.filter(
      (event) =>
        event.name === 'Layout' &&
        event.args?.beginData?.frame === frameTree.frame.id &&
        scripts.some(
          (script) => script.ts <= event.ts && script.ts + script.dur >= event.ts + event.dur,
        ),
    );
    return { forced: forced.length, frames };
  } finally {
    await browser?.close();
    await session?.close();
    await rm(root, { recursive: true, force: true });
  }
}

test(`canvas zoom frames force at most one studio layout each (${browserEngine()})`, {
  skip: browserEngine() !== 'chromium',
  timeout: 60000,
}, async (t) => {
  const { forced, frames } = await forcedZoomLayouts({
    minimap: false,
    async zoom(page) {
      await page.keyboard.down('Control');
      for (let step = 0; step < ZOOM_STEPS; step++) {
        await page.mouse.wheel(0, step < ZOOM_STEPS / 2 ? -4 : 4);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      }
      await page.keyboard.up('Control');
      return ZOOM_STEPS;
    },
  });
  t.diagnostic(`${forced} forced layouts across ${frames} zoom frames`);
  assert.ok(forced <= frames, `${forced} forced layouts across ${frames} zoom frames`);
});

test(`pinch frames with the minimap open force at most one studio layout each (${browserEngine()})`, {
  skip: browserEngine() !== 'chromium',
  timeout: 60000,
}, async (t) => {
  const { forced, frames } = await forcedZoomLayouts({
    minimap: true,
    async zoom(page, cdp, center) {
      // Synthesized pinches deliver input faster than frames, as a trackpad does.
      await page.evaluate(() => {
        window.__zoomFrames = 0;
        const tick = () => {
          window.__zoomFrames++;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      for (const scaleFactor of [0.4, 2.5])
        await cdp.send('Input.synthesizePinchGesture', {
          ...center,
          scaleFactor,
          relativeSpeed: 600,
        });
      return page.evaluate(() => window.__zoomFrames);
    },
  });
  t.diagnostic(`${forced} forced layouts across ${frames} frames`);
  assert.ok(forced <= frames, `${forced} forced layouts across ${frames} frames`);
});
