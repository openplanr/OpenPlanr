import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  CANVAS_TRACE_BUDGETS,
  evaluateCanvasTrace,
  percentile95,
  rendererFrameWork,
} from '@openplanr/canvas/testing';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { canvasDiagram as diagram } from './fixtures/diagram-editor-canvas.mjs';

const enabled = process.env.PLANR_BROWSER_TESTS === '1';
// Timing traces need a quiet machine, so they run only in the dedicated canvas trace job.
const traced = enabled && process.env.PLANR_CANVAS_TRACE === '1';
const options = { skip: !enabled, timeout: 240_000 };
const requireProtocol = createRequire(new URL('../../protocol/package.json', import.meta.url));
const { build } = requireProtocol('esbuild');
const styles = readFileSync(
  new URL('../lib/artifact/ui/diagram-editor.css', import.meta.url),
  'utf8',
);
let runtime;

async function hostedFixture(t, count) {
  runtime ??= build({
    stdin: {
      contents: `
        import { createDiagramEditorSession, mountDiagramEditor } from ${JSON.stringify(new URL('../lib/artifact/diagram/editor/index.mjs', import.meta.url).pathname)};
        window.__mountEditor = bundle => {
          window.__mounted?.dispose();
          window.__session = createDiagramEditorSession({ bundle, acknowledged: true });
          window.__mounted = mountDiagramEditor({ root: document.querySelector('#editor'), session: window.__session, host: { brand: false, review: false } });
          return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        };
      `,
      resolveDir: import.meta.dirname,
      sourcefile: 'diagram-editor-canvas-browser.mjs',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    define: { 'import.meta.url': 'document.baseURI' },
    write: false,
    logLevel: 'silent',
  });
  const compiled = await runtime;
  const browser = await launchBrowser();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => {
    await browser.close();
    assert.deepEqual(errors, []);
  });
  await page.route('https://canvas.example/diagram', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><title>Canvas editor</title><body style="margin:0"><div id="editor" style="height:100vh"></div></body></html>',
    }),
  );
  await page.goto('https://canvas.example/diagram');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: compiled.outputFiles[0].text });
  const bundle = diagram(count);
  await page.evaluate((bundle) => window.__mountEditor(bundle), bundle);
  assert.equal(await page.locator('[data-world] > [data-element-id]').count(), count);
  assert.equal(await page.locator('[data-world] rect').count(), bundle.document.nodes.length);
  assert.equal(
    await page.locator('[data-world] text').first().locator('tspan').count(),
    2,
    'The performance fixture renders two-line node labels',
  );
  return { page, browser, bundle };
}

const settle = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

async function finishTrace(session) {
  const completed = new Promise((resolve, reject) =>
    session.once('Tracing.tracingComplete', (event) => {
      if (event.stream) resolve(event.stream);
      else reject(new Error('Editor Chromium trace stream is missing'));
    }),
  );
  await session.send('Tracing.end');
  const stream = await completed;
  let contents = '';
  try {
    for (;;) {
      const chunk = await session.send('IO.read', { handle: stream });
      contents += chunk.base64Encoded
        ? Buffer.from(chunk.data, 'base64').toString('utf8')
        : chunk.data;
      if (chunk.eof) break;
    }
  } finally {
    await session.send('IO.close', { handle: stream });
  }
  const parsed = JSON.parse(contents);
  assert.ok(Array.isArray(parsed.traceEvents), 'Chromium provides renderer trace events');
  return parsed.traceEvents;
}

async function hitTestProbe(page) {
  return page.evaluate(() => {
    const controller = window.__mounted.canvas;
    const area = controller.getSafeArea();
    const samples = [];
    let queryCount = 0,
      minSampleDurationMs = Infinity;
    for (let index = 0; index < 1000; index++) {
      const point = {
        x: area.x + (((index * 73) % 997) / 997) * area.width,
        y: area.y + (((index * 131) % 991) / 991) * area.height,
      };
      const start = performance.now();
      let queries = 0,
        elapsed = 0;
      do {
        controller.hitTest(point);
        queries++;
        elapsed = performance.now() - start;
      } while (elapsed < 1);
      samples.push(elapsed / queries);
      queryCount += queries;
      minSampleDurationMs = Math.min(minSampleDurationMs, elapsed);
    }
    samples.sort((a, b) => a - b);
    return { p95Ms: samples[949], sampleCount: samples.length, queryCount, minSampleDurationMs };
  });
}

async function interaction(page, scenario) {
  return page.evaluate(async (scenario) => {
    if (!PerformanceObserver.supportedEntryTypes.includes('longtask'))
      throw new Error('Editor long-task observations are unavailable');
    const stage = document.querySelector('.de-canvas');
    const rect = stage.getBoundingClientRect();
    const controller = window.__mounted.canvas;
    controller.setCamera({ x: 0, y: 0, zoom: 1 });
    const next = () => new Promise((resolve) => requestAnimationFrame(resolve));
    await next();
    await next();
    document.querySelector('[data-action="pan-tool"]').click();
    const entries = [];
    const observer = new PerformanceObserver((list) => entries.push(...list.getEntries()));
    observer.observe({ type: 'longtask' });
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const frames = [],
      cameras = [],
      start = performance.now();
    performance.mark('canvas-interaction-start');
    for (let frame = 0; frame < 180; frame++) {
      await next();
      performance.mark('canvas-frame');
      frames.push(performance.now());
      if (scenario === 'pan-100')
        stage.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaX: 8 * Math.cos(frame / 28),
            deltaY: 3 * Math.cos(frame / 41),
          }),
        );
      else
        stage.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            clientX: point.x,
            clientY: point.y,
            deltaY: frame < 90 ? 1.5 : -1.5,
          }),
        );
      cameras.push(controller.getCamera());
    }
    await next();
    performance.mark('canvas-frame');
    frames.push(performance.now());
    performance.mark('canvas-interaction-end');
    const end = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 0));
    entries.push(...observer.takeRecords());
    observer.disconnect();
    const durations = entries
      .filter((entry) => entry.startTime >= start && entry.startTime < end)
      .map((entry) => entry.duration);
    return {
      intervals: frames.slice(1).map((value, index) => value - frames[index]),
      longTaskDurationsMs: durations,
      domNodes: document.querySelectorAll('*').length,
      camera: controller.getCamera(),
      cameraRange: {
        x:
          Math.max(...cameras.map((camera) => camera.x)) -
          Math.min(...cameras.map((camera) => camera.x)),
        minZoom: Math.min(...cameras.map((camera) => camera.zoom)),
        maxZoom: Math.max(...cameras.map((camera) => camera.zoom)),
      },
    };
  }, scenario);
}

for (const count of [708, 5000])
  test(`the ${count}-element editor meets SVG pan and zoom renderer budgets`, {
    ...options,
    skip: !traced || browserEngine() !== 'chromium',
  }, async (t) => {
    const { page, browser, bundle } = await hostedFixture(t, count);
    const firstFrameTrialsMs = [];
    for (let load = 0; load < CANVAS_TRACE_BUDGETS.firstFrameLoads; load++) {
      firstFrameTrialsMs.push(
        await page.evaluate(async (bundle) => {
          const start = performance.now();
          await window.__mountEditor(bundle);
          return performance.now() - start;
        }, bundle),
      );
    }
    const firstFrameP50Ms = [...firstFrameTrialsMs].sort((a, b) => a - b)[2];
    const gpuRenderer = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      if (!gl) return 'WebGL unavailable';
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    });
    const probe = await hitTestProbe(page);
    const session = await page.context().newCDPSession(page);
    const measurements = [];
    try {
      for (const scenario of ['pan-100', 'zoom-sweep']) {
        await interaction(page, scenario);
        const runs = [];
        for (let run = 1; run <= 3; run++) {
          await session.send('Tracing.start', {
            categories:
              'toplevel,devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing',
            transferMode: 'ReturnAsStream',
          });
          const sample = await interaction(page, scenario);
          const events = await finishTrace(session);
          if (scenario === 'pan-100')
            assert.ok(sample.cameraRange.x > 100, 'The sweep pans the real editor camera');
          else
            assert.ok(
              sample.cameraRange.minZoom < 0.4 && sample.cameraRange.maxZoom > 0.9,
              'The sweep zooms the real editor camera',
            );
          const work = rendererFrameWork(events);
          const p95 = percentile95(work);
          const p50 = [...work].sort((a, b) => a - b)[Math.floor(work.length / 2)];
          const maximum = Math.max(...work);
          const marker = events.find((event) => event.name === 'canvas-interaction-start');
          const end = events.find(
            (event) =>
              event.name === 'canvas-interaction-end' &&
              event.pid === marker.pid &&
              event.tid === marker.tid,
          );
          const tasks = events
            .filter(
              (event) =>
                event.pid === marker.pid &&
                event.tid === marker.tid &&
                event.ts >= marker.ts &&
                event.ts < end.ts &&
                event.ph === 'X' &&
                Number.isFinite(event.dur) &&
                ['RunTask', 'ThreadControllerImpl::RunTask'].includes(event.name),
            )
            .map((event) => event.dur / 1000);
          const longestTask = Math.max(0, ...tasks, ...sample.longTaskDurationsMs);
          const longTasksOver50Ms = Math.max(
            tasks.filter((duration) => duration > 50).length,
            sample.longTaskDurationsMs.length,
          );
          t.diagnostic(
            JSON.stringify({
              count,
              scenario,
              run,
              gpuRenderer,
              rendererFrameP50Ms: p50,
              rendererFrameP95Ms: p95,
              rendererFrameMaxMs: maximum,
              longestTaskMs: longestTask,
              longTasksOver50Ms,
              samples: work.length,
            }),
          );
          runs.push({
            run,
            gpuRenderer,
            rendererMainP95Ms: p95,
            rafIntervalP95Ms: percentile95(sample.intervals),
            longTasksOver50Ms,
            domNodes: sample.domNodes,
            hitTestP95Ms: probe.p95Ms,
            hitTestProbe: probe,
          });
        }
        measurements.push({
          count,
          fixture: `editor-svg-${count}`,
          renderer: 'vanilla',
          world: 'svg',
          dpr: 1,
          scenario,
          runs,
          firstFrameTrialsMs,
          firstFrameP50Ms,
        });
      }
    } finally {
      await session.detach();
    }
    const evaluation = evaluateCanvasTrace(
      {
        browser: { name: 'chromium', version: browser.version() },
        budgetSet: process.env.CI ? 'runner' : 'local',
        measurements,
      },
      count,
    );
    t.diagnostic(JSON.stringify({ count, evaluation }));
    assert.deepEqual(
      evaluation.failures.filter((failure) => /rendererMainP95Ms|longTasksOver50Ms/u.test(failure)),
      [],
    );
    // The runner budget set reports the 5,000-element SVG tier; local runs gate every tier.
    if (!process.env.CI)
      for (const measurement of measurements) {
        const median = measurement.runs
          .map((run) => run.rendererMainP95Ms)
          .sort((a, b) => a - b)[1];
        assert.ok(
          median <= CANVAS_TRACE_BUDGETS.rendererMainP95Ms.svg[count],
          `${count} ${measurement.scenario}: renderer main p95 ${median} ms exceeds ${CANVAS_TRACE_BUDGETS.rendererMainP95Ms.svg[count]} ms`,
        );
        for (const run of measurement.runs)
          assert.equal(
            run.longTasksOver50Ms,
            0,
            `${count} ${measurement.scenario} run ${run.run}: no task may exceed 50 ms`,
          );
      }
  });

test(
  'host chrome registered through the mounted canvas keeps editor Fit inside the safe area',
  options,
  async (t) => {
    const { page } = await hostedFixture(t, 24);
    const before = await page.evaluate(() => window.__mounted.canvas.getSafeArea());
    await page.evaluate(() => {
      const stage = document.querySelector('.de-canvas');
      const { width, height } = stage.getBoundingClientRect();
      const panel = document.createElement('aside');
      panel.textContent = 'Host inspector';
      Object.assign(panel.style, {
        position: 'absolute',
        top: '0',
        right: '0',
        width: '260px',
        height: '100%',
        background: 'white',
      });
      stage.append(panel);
      window.__mounted.canvas.setChrome({
        id: 'host-inspector',
        edge: 'right',
        open: true,
        rect: { x: width - 260, y: 0, width: 260, height },
      });
    });
    await settle(page);
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await settle(page);
    const actual = await page.evaluate(() => {
      const stage = document.querySelector('.de-canvas').getBoundingClientRect();
      const safe = window.__mounted.canvas.getSafeArea();
      const bounds = document.querySelector('[data-world]').getBoundingClientRect();
      return {
        safe,
        bounds: {
          x: bounds.left - stage.left,
          y: bounds.top - stage.top,
          right: bounds.right - stage.left,
          bottom: bounds.bottom - stage.top,
        },
      };
    });
    assert.equal(
      actual.safe.width,
      before.width - 260,
      'The host surface reserves 260px of canvas width',
    );
    assert.ok(
      actual.bounds.x >= actual.safe.x + 71,
      `Fit left edge respects 72px padding: ${JSON.stringify(actual)}`,
    );
    assert.ok(
      actual.bounds.y >= actual.safe.y + 71,
      `Fit top edge respects 72px padding: ${JSON.stringify(actual)}`,
    );
    assert.ok(
      actual.bounds.right <= actual.safe.x + actual.safe.width - 71,
      `Fit right edge respects host chrome: ${JSON.stringify(actual)}`,
    );
    assert.ok(
      actual.bounds.bottom <= actual.safe.y + actual.safe.height - 71,
      `Fit bottom edge respects 72px padding: ${JSON.stringify(actual)}`,
    );
  },
);
