import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { browserExecutable, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { auditDesignPage, auditRenderedScreen } from '../lib/design/browser-audit.mjs';
import { currentDesign, renderDesignDocument } from '../lib/design/document.mjs';
import { compileDesignHandoffReadiness } from '../lib/design/handoff-readiness.mjs';
import { saveDesignLayout } from '../lib/design/layout-save.mjs';
import { verifyDesignDocument } from '../lib/design/utility.mjs';
import { designFixture } from './design-fixture.mjs';

const document = { frames: [{ id: 'desktop', width: 900, height: 700 }] };
const entry = {
  artifactId: 'overview-desktop',
  screenId: 'overview',
  frameId: 'desktop',
  variantId: 'primary',
};
function mockPage(
  result,
  { attribute = 'data-planr-artifact-frame', throws = false, artifact = entry } = {},
) {
  const panel = { hidden: true };
  const handle = {
    async getAttribute(name) {
      return name === attribute ? artifact.artifactId : null;
    },
    async evaluate(fn, argument) {
      return fn({ closest: () => panel }, argument);
    },
    async dispose() {},
  };
  const frame = {
    async frameElement() {
      return handle;
    },
    async waitForLoadState() {
      if (throws) throw new Error('Frame timed out.');
    },
    async evaluate() {
      assert.equal(panel.hidden, false);
      return result;
    },
  };
  return { frames: () => [frame], panel };
}
const clearResult = () => ({
  screenId: 'overview',
  checkedElements: 3,
  checkedContrast: 1,
  checkedFocus: 1,
  skippedContrast: 0,
  viewport: { width: 900, height: 700 },
  issues: [],
});

test('rendered audits require a design document input', async () => {
  for (const options of [undefined, { entries: [entry] }, { document: null, entries: [entry] }]) {
    await assert.rejects(auditDesignPage(mockPage(clearResult()), options), {
      name: 'TypeError',
      message: 'Audit requires a design document input.',
    });
  }
});

test('rendered checks remain unverified until caller supplies screenshots and completed journeys', async () => {
  const page = mockPage(clearResult());
  const report = await auditDesignPage(page, {
    revision: 'revision-one',
    document,
    entries: [entry],
  });
  assert.equal(report.status, 'unverified');
  assert.deepEqual(report.checkedArtifacts, [entry.artifactId]);
  assert.deepEqual(report.scenarios, []);
  assert.deepEqual(report.screenshots, []);
  assert.equal(page.panel.hidden, true, 'audit restores hidden review panels');
  const verified = await auditDesignPage(page, {
    revision: 'revision-one',
    document,
    entries: [entry],
    screenshotPaths: ['screenshots/overview.png'],
    scenarios: [{ name: 'Save account', status: 'passed' }],
  });
  assert.equal(verified.status, 'verified');
});

test('missing, mismatched and failed frames can never claim complete artifact coverage', async () => {
  const options = {
    revision: 'revision-one',
    document,
    entries: [entry],
    screenshotPaths: ['overview.png'],
    scenarios: [{ name: 'Save', status: 'passed' }],
  };
  for (const page of [
    { frames: () => [] },
    mockPage({ ...clearResult(), screenId: 'wrong' }),
    mockPage(clearResult(), { throws: true }),
  ]) {
    const report = await auditDesignPage(page, options);
    assert.equal(report.status, 'failed');
    assert.deepEqual(report.checkedArtifacts, []);
    assert.ok(report.issues.some(({ rule }) => rule === 'missing-frame-inspection'));
  }
  assert.equal((await auditDesignPage(null, options)).status, 'unverified');
});

test('full audits load each expected artifact sequentially within the stage frame budget', async () => {
  const entries = Array.from({ length: 5 }, (_, index) => ({
    ...entry,
    artifactId: `screen-${index}-desktop`,
    screenId: `screen-${index}`,
  }));
  const loaded = new Set();
  const inspected = [];
  const requested = [];
  const stage = {
    frameBudget: 2,
    async ensureFrames(ids) {
      assert.equal(ids.length, 1);
      await Promise.resolve();
      while (loaded.size >= 2) loaded.delete(loaded.values().next().value);
      loaded.add(ids[0]);
      requested.push(ids[0]);
      assert.ok(loaded.size <= 2);
    },
  };
  const frames = entries.map((artifact) => {
    const frame = mockPage(null, { artifact }).frames()[0];
    frame.evaluate = async () => {
      if (!loaded.has(artifact.artifactId)) throw new Error('Artifact source is not loaded.');
      inspected.push(artifact.artifactId);
      return { ...clearResult(), screenId: artifact.screenId };
    };
    return frame;
  });
  const unknown = mockPage(null, { artifact: { artifactId: 'unknown' } }).frames()[0];
  const page = {
    frames: () => [unknown, ...frames, frames[0]],
    evaluate: (fn, artifactId) =>
      runInNewContext(`(${fn.toString()})(artifactId)`, {
        artifactId,
        window: { __openPlanrArtifactStage: stage },
      }),
  };
  const report = await auditDesignPage(page, { document, entries });
  const artifactIds = entries.map(({ artifactId }) => artifactId);
  assert.deepEqual(report.checkedArtifacts, artifactIds);
  assert.deepEqual(requested, artifactIds);
  assert.deepEqual(inspected, artifactIds);
  assert.deepEqual(
    report.issues.map(({ rule }) => rule),
    ['duplicate-frame'],
  );
});

test('computed findings retain artifact identity and browser script failures remain visible', async () => {
  const page = mockPage({
    ...clearResult(),
    issues: [
      { rule: 'contrast-below-aa', severity: 'error', message: 'Computed contrast is 2:1.' },
    ],
  });
  page.pageErrors = async () => [new Error('Action handler failed.')];
  const report = await auditDesignPage(page, {
    revision: 'revision-one',
    document,
    entries: [entry],
  });
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.issues[0], {
    artifactId: entry.artifactId,
    rule: 'contrast-below-aa',
    severity: 'error',
    message: 'Computed contrast is 2:1.',
  });
  assert.ok(report.issues.some(({ rule }) => rule === 'browser-script-error'));
});

test('full audits discover frames mounted on demand and evicted beyond the budget', async () => {
  const entries = Array.from({ length: 4 }, (_, index) => ({
    ...entry,
    artifactId: `screen-${index}-desktop`,
    screenId: `screen-${index}`,
  }));
  const mounted = new Map();
  const requested = [];
  const stage = {
    frameBudget: 2,
    async ensureFrames(ids) {
      requested.push(...ids);
      for (const id of ids) {
        if (mounted.has(id)) continue;
        if (mounted.size === this.frameBudget) mounted.delete(mounted.keys().next().value);
        const artifact = entries.find(({ artifactId }) => artifactId === id);
        const frame = mockPage(clearResult(), { artifact }).frames()[0];
        frame.evaluate = async () => {
          assert.ok(mounted.has(id), 'only mounted frames can be inspected');
          return { ...clearResult(), screenId: artifact.screenId };
        };
        mounted.set(id, frame);
      }
    },
  };
  const page = {
    frames: () => [...mounted.values()],
    evaluate: (fn, artifactId) =>
      runInNewContext(`(${fn.toString()})(artifactId)`, {
        artifactId,
        window: { __openPlanrArtifactStage: stage },
      }),
  };
  const report = await auditDesignPage(page, { document, entries });
  const ids = entries.map(({ artifactId }) => artifactId);
  assert.deepEqual(report.checkedArtifacts, ids);
  assert.deepEqual(requested, ids);
  assert.deepEqual(report.issues, []);
  assert.equal(mounted.size, 2);
});

test('audits hold frames through competing demand, inspection failures and panel restoration', async (t) => {
  for (const failure of [null, 'mount', 'attachment', 'inspection', 'restore']) {
    await t.test(failure ?? 'success', async () => {
      const page = mockPage(clearResult());
      const frame = page.frames()[0];
      const handle = await frame.frameElement();
      let held = false,
        mounted = false,
        restored = false,
        released = false,
        disposed = false;
      const stage = {
        frameBudget: 1,
        holdFrames(ids) {
          assert.deepEqual([...ids], [entry.artifactId]);
          held = true;
          return () => {
            assert.equal(page.panel.hidden, failure !== 'restore');
            assert.equal(restored, !['mount', 'attachment'].includes(failure));
            held = false;
            released = true;
          };
        },
        async ensureFrames(ids) {
          if (ids[0] === entry.artifactId) {
            mounted = true;
            if (failure === 'mount') throw new Error('Source unavailable.');
          } else if (!held) mounted = false;
        },
      };
      const evaluate = (fn, artifactId) =>
        runInNewContext(`(${fn.toString()})(artifactId)`, {
          artifactId,
          window: { __openPlanrArtifactStage: stage },
        });
      page.evaluate = evaluate;
      page.evaluateHandle = async (fn, artifactId) => {
        const value = await evaluate(fn, artifactId);
        return {
          evaluate: (fn) => fn(value),
          dispose: async () => {
            disposed = true;
          },
        };
      };
      page.keyboard = { press: () => stage.ensureFrames(['competing-screen']) };
      const evaluatePanel = handle.evaluate;
      handle.evaluate = async (fn, argument) => {
        if (argument) {
          assert.equal(mounted, true, 'the panel remains mounted until restoration');
          restored = true;
          if (failure === 'restore') throw new Error('Panel detached.');
        }
        return evaluatePanel(fn, argument);
      };
      frame.evaluate = async () => {
        if (!mounted) throw new Error('Frame was detached.');
        if (failure === 'inspection') throw new Error('Inspection failed.');
        return clearResult();
      };
      if (failure === 'attachment') {
        page.on = () => {};
        page.off = () => {};
        page.waitForSelector = async () => {
          throw new Error('Frame did not attach.');
        };
      }
      const report = await auditDesignPage(page, { document, entries: [entry] });
      assert.deepEqual(
        report.checkedArtifacts,
        failure && failure !== 'restore' ? [] : [entry.artifactId],
        JSON.stringify(report.issues),
      );
      assert.equal(released, true);
      assert.equal(disposed, true);
      assert.equal(held, false);
      if (failure)
        assert.ok(
          report.issues.some(({ message }) => /unavailable|attach|failed|detached/u.test(message)),
        );
      else assert.deepEqual(report.issues, []);
    });
  }
});

test('rendered audits wait for Playwright to attach a mounted frame', async (t) => {
  for (const event of ['frameattached', 'framenavigated']) {
    await t.test(event, async () => {
      const page = Object.assign(new EventEmitter(), mockPage(clearResult()));
      const frame = page.frames()[0];
      const handle = await frame.frameElement();
      let attached = false;
      handle.contentFrame = async () => null;
      const evaluate = handle.evaluate;
      handle.evaluate = async (fn, argument) =>
        argument === handle ? fn(handle, handle) : evaluate(fn, argument);
      page.frames = () => (attached ? [frame] : []);
      page.waitForSelector = async () => handle;
      const stage = {
        frameBudget: 1,
        async ensureFrames(ids) {
          assert.deepEqual([...ids], [entry.artifactId]);
          setImmediate(() => {
            page.emit(event, mockPage(clearResult()).frames()[0]);
            attached = true;
            page.emit(event, frame);
          });
        },
      };
      page.evaluate = (fn, artifactId) =>
        runInNewContext(`(${fn.toString()})(artifactId)`, {
          artifactId,
          window: { __openPlanrArtifactStage: stage },
        });
      const report = await auditDesignPage(page, { document, entries: [entry] });
      assert.deepEqual(report.checkedArtifacts, [entry.artifactId], JSON.stringify(report.issues));
      assert.deepEqual(report.issues, []);
      assert.equal(page.panel.hidden, true);
      assert.equal(page.listenerCount('frameattached'), 0);
      assert.equal(page.listenerCount('framenavigated'), 0);
    });
  }
});

test('frame element lookup escapes artifact identities and retains duplicate checks', async () => {
  const artifact = { ...entry, artifactId: 'overview."\\\n' };
  const page = Object.assign(new EventEmitter(), mockPage(clearResult(), { artifact }));
  const frames = [page.frames()[0], mockPage(clearResult(), { artifact }).frames()[0]];
  const handle = await frames[0].frameElement();
  handle.contentFrame = async () => frames[0];
  page.frames = () => frames;
  page.waitForSelector = async (selector, options) => {
    assert.equal(
      selector,
      'iframe[data-planr-artifact-frame="overview\\2e \\22 \\5c \\a "], iframe[data-planr-artifact-id="overview\\2e \\22 \\5c \\a "]',
    );
    assert.deepEqual(options, { state: 'attached', timeout: 5000 });
    return handle;
  };
  const report = await auditDesignPage(page, { document, entries: [artifact] });
  assert.deepEqual(report.checkedArtifacts, [artifact.artifactId]);
  assert.deepEqual(
    report.issues.map(({ rule }) => rule),
    ['duplicate-frame'],
  );
  assert.equal(page.listenerCount('frameattached'), 0);
  assert.equal(page.listenerCount('framenavigated'), 0);
});

test('an unrelated detached frame does not abort the target attachment wait', async () => {
  const page = Object.assign(new EventEmitter(), mockPage(clearResult()));
  const frame = page.frames()[0];
  const handle = await frame.frameElement();
  const evaluate = handle.evaluate;
  handle.evaluate = async (fn, argument) =>
    argument === handle ? fn(handle, handle) : evaluate(fn, argument);
  handle.contentFrame = async () => {
    page.emit('frameattached', {
      async frameElement() {
        throw new Error('Frame has been detached.');
      },
    });
    page.emit('frameattached', frame);
    return null;
  };
  page.waitForSelector = async () => handle;
  const report = await auditDesignPage(page, { document, entries: [entry] });
  assert.deepEqual(report.checkedArtifacts, [entry.artifactId]);
  assert.deepEqual(
    report.issues.map(({ rule, severity }) => ({ rule, severity })),
    [{ rule: 'frame-attachment-inspection-error', severity: 'warning' }],
  );
  assert.match(report.issues[0].message, /Frame has been detached/u);
  assert.equal(page.listenerCount('frameattached'), 0);
  assert.equal(page.listenerCount('framenavigated'), 0);
});

test('unattached frame timeouts name the artifact and remove attachment listeners', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = Object.assign(new EventEmitter(), mockPage(clearResult()));
  const handle = await page.frames()[0].frameElement();
  let lookupStarted;
  const started = new Promise((resolve) => {
    lookupStarted = resolve;
  });
  handle.contentFrame = async () => {
    lookupStarted();
    return null;
  };
  page.frames = () => [];
  page.waitForSelector = async () => handle;
  const pending = auditDesignPage(page, { document, entries: [entry] });
  await started;
  t.mock.timers.tick(5000);
  const report = await pending;
  assert.deepEqual(report.checkedArtifacts, []);
  assert.equal(report.status, 'failed');
  assert.deepEqual(
    report.issues.map(({ rule }) => rule),
    ['frame-load-error', 'missing-frame-inspection'],
  );
  assert.match(report.issues[0].message, /overview-desktop.*no frame attached/iu);
  assert.equal(page.listenerCount('frameattached'), 0);
  assert.equal(page.listenerCount('framenavigated'), 0);
});

test('pages without attachment events retain the frame scan fallback', async () => {
  const page = mockPage(clearResult());
  page.waitForSelector = async () => {
    throw new Error('Eventless pages must use the frame scan.');
  };
  const report = await auditDesignPage(page, { document, entries: [entry] });
  assert.deepEqual(report.checkedArtifacts, [entry.artifactId]);
  assert.deepEqual(report.issues, []);
});

test('panel visibility restoration failures remain visible as warnings', async () => {
  const page = mockPage(clearResult());
  const handle = await page.frames()[0].frameElement();
  const evaluate = handle.evaluate;
  handle.evaluate = async (fn, argument) => {
    if (argument) throw new Error('Panel detached.');
    return evaluate(fn, argument);
  };
  const report = await auditDesignPage(page, { document, entries: [entry] });
  assert.deepEqual(report.checkedArtifacts, [entry.artifactId]);
  assert.deepEqual(report.issues, [
    {
      artifactId: entry.artifactId,
      rule: 'panel-visibility-restore-error',
      severity: 'warning',
      message: 'Artifact overview-desktop panel visibility could not be restored: Panel detached.',
    },
  ]);
});

async function browser(t) {
  const executablePath = browserExecutable('chromium');
  if (!existsSync(executablePath)) {
    t.skip(`No Chromium executable at ${executablePath}; no runtime download is attempted.`);
    return null;
  }
  const instance = await launchBrowser({ engine: 'chromium' });
  t.after(() => instance.close());
  return instance;
}

test('real browser resolves token contrast and diagnoses overflow, clipping, focus and missing media', async (t) => {
  const instance = await browser(t);
  if (!instance) return;
  const page = await instance.newPage({ viewport: { width: 640, height: 600 } });
  await page.setContent(
    `<!doctype html><html lang="en"><head><style>
    :root { --weak: #b2b2b2; --surface: white; } body { background: var(--surface); color: black; }
    .weak { color: var(--weak); } .clip { width: 40px; overflow: hidden; white-space: nowrap; }
    .wide { width: 900px; } button { outline: none; box-shadow: none; } button:focus { outline: none; }
    </style></head><body data-planr-screen="overview"><p class="weak">Low contrast uses project tokens.</p>
    <div class="clip">This primary information is clipped.</div><div class="wide">Content</div>
    <img src="data:image/png;base64,invalid" alt="Company logo"><button>Continue</button></body></html>`,
    { waitUntil: 'load' },
  );
  await page.keyboard.press('Tab');
  const report = await page.evaluate(auditRenderedScreen);
  assert.equal(report.screenId, 'overview');
  assert.ok(report.checkedContrast > 0);
  for (const rule of [
    'contrast-below-aa',
    'clipped-content',
    'horizontal-overflow',
    'missing-image',
    'missing-focus-indicator',
  ]) {
    assert.ok(
      report.issues.some((issue) => issue.rule === rule),
      `${rule}: ${JSON.stringify(report)}`,
    );
  }
});

test('real browser audits hidden frames and restores their review visibility', async (t) => {
  const instance = await browser(t);
  if (!instance) return;
  const page = await instance.newPage({ viewport: { width: 1200, height: 900 } });
  const content =
    '<!doctype html><html lang="en"><body data-planr-screen="overview" style="box-sizing:border-box"><h1>Account</h1><p>Review your account information.</p><button onclick="this.textContent=\'Saved\'">Save account</button></body></html>';
  const srcdoc = content.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  await page.setContent(
    `<section data-artifact-id="overview-desktop" hidden><iframe title="Account" data-planr-artifact-frame="overview-desktop" width="900" height="700" srcdoc="${srcdoc}"></iframe></section>`,
    { waitUntil: 'load' },
  );
  const report = await auditDesignPage(page, {
    revision: 'browser-revision',
    document,
    entries: [entry],
  });
  assert.deepEqual(report.checkedArtifacts, [entry.artifactId]);
  assert.equal(
    report.issues.filter(({ severity }) => severity === 'error').length,
    0,
    JSON.stringify(report.issues),
  );
  assert.equal(report.status, 'unverified', 'layout audit does not invent screenshots or journeys');
  assert.equal(await page.locator('section').evaluate((element) => element.hidden), true);
});

test('frame mode reaches the rendered auditor', async () => {
  const page = mockPage(clearResult());
  page.frames()[0].evaluate = async (_fn, argument) => {
    assert.deepEqual(argument, { height: 'auto', frameBoundsSeverity: 'error' });
    return clearResult();
  };
  await auditDesignPage(page, {
    document: { frames: [{ ...document.frames[0], height: 'auto' }] },
    entries: [{ ...entry, height: 'auto' }],
  });
});

test('frame severity depends only on auto frames, regardless of schema version or layout', async () => {
  for (const schemaVersion of ['1.0.0', '1.1.0', '2.0.0']) {
    for (const layout of [undefined, {}, { boards: { overview: { x: 120, y: 180 } } }]) {
      for (const auto of [false, true]) {
        const page = mockPage(clearResult());
        let severity;
        page.frames()[0].evaluate = async (_fn, argument) => {
          severity = argument.frameBoundsSeverity;
          return clearResult();
        };
        const report = await auditDesignPage(page, {
          document: {
            ...document,
            schemaVersion,
            layout,
            frames: [...document.frames, ...(auto ? [{ id: 'long', height: 'auto' }] : [])],
          },
          entries: [entry],
        });
        assert.equal(
          severity,
          auto ? 'error' : 'warning',
          `${schemaVersion}/${JSON.stringify(layout)}`,
        );
        assert.deepEqual(
          report.checkedArtifacts,
          [entry.artifactId],
          JSON.stringify(report.issues),
        );
      }
    }
  }
});

test('real browser enforces frame bounds and root sizing while respecting clipped scroll content', async (t) => {
  const instance = await browser(t);
  if (!instance) return;
  const page = await instance.newPage({ viewport: { width: 640, height: 600 } });
  await page.setContent(
    `<!doctype html><style>
    body { margin:0; } main { height:1200px; }
    .outside { position:absolute; left:650px; top:10px; width:40px; height:40px; }
    .clipped { position:relative; overflow:auto; width:100px; height:100px; }
    .clipped span { position:absolute; left:700px; top:900px; width:40px; height:40px; }
    </style><body data-planr-screen="overview"><main>Long page
    <div class="outside" data-planr-id="escaped">Outside</div>
    <div class="clipped"><span data-planr-id="scroll-content">Scrollable</span></div>
    <div style="display:none;position:absolute;left:-900px;width:40px;height:40px">Hidden</div>
    <div style="position:fixed;top:-50px;width:40px;height:40px" data-planr-id="fixed-outside">Fixed</div>
    </main></body>`,
    { waitUntil: 'load' },
  );
  const fixed = await page.evaluate(auditRenderedScreen);
  assert.ok(
    fixed.issues.some(
      ({ rule, message }) => rule === 'vertical-overflow' && /1200px.*600px/.test(message),
    ),
  );
  assert.ok(fixed.issues.some(({ rule }) => rule === 'board-root-box-sizing'));
  assert.deepEqual(
    fixed.issues
      .filter(({ rule }) => rule === 'outside-frame')
      .map(({ message }) => message)
      .sort(),
    [
      'escaped is positioned outside the frame box.',
      'fixed-outside is positioned outside the frame box.',
    ],
  );
  await page.locator('body').evaluate((body) => {
    body.style.boxSizing = 'border-box';
  });
  const auto = await page.evaluate(auditRenderedScreen, { height: 'auto' });
  assert.equal(
    auto.issues.some(
      ({ rule }) => rule === 'vertical-overflow' || rule === 'board-root-box-sizing',
    ),
    false,
  );
  assert.ok(
    auto.issues.some(
      ({ rule, message }) => rule === 'outside-frame' && message.startsWith('escaped '),
    ),
  );
  await page.locator('.outside').evaluate((node) => {
    node.style.left = '10px';
    node.style.top = '800px';
  });
  const scrolling = await page.evaluate(auditRenderedScreen, { height: 'auto' });
  assert.equal(
    scrolling.issues.some(
      ({ rule, message }) => rule === 'outside-frame' && message.startsWith('escaped '),
    ),
    false,
  );
});

function scrollingScreen(fn, argument, screenId) {
  const body = { getAttribute: () => screenId };
  const drawer = {
    getAttribute: () => 'drawer',
    getBoundingClientRect: () => ({
      left: -50,
      right: -10,
      top: 0,
      bottom: 40,
      width: 40,
      height: 40,
    }),
    parentElement: body,
    childNodes: [],
    closest: () => null,
    tabIndex: -1,
  };
  const result = runInNewContext(`(${fn.toString()})(argument)`, {
    argument,
    document: {
      body,
      readyState: 'complete',
      documentElement: { scrollHeight: 1200, scrollWidth: 640 },
      querySelectorAll: () => [drawer],
      createElement: () => ({ getContext: () => null }),
    },
    window: { innerWidth: 640, innerHeight: 600, scrollX: 0, scrollY: 0 },
    getComputedStyle: (node) =>
      node === body
        ? { boxSizing: 'content-box' }
        : { position: 'fixed', visibility: 'visible', opacity: '1' },
  });
  return JSON.parse(JSON.stringify(result));
}

test('frame bounds preserve fixed-frame warnings after migration and drags and enforce auto frames', async (t) => {
  for (const mode of ['legacy', 'migrated', 'dragged', 'auto']) {
    await t.test(mode, async (t) => {
      const root = mkdtempSync(join(tmpdir(), 'design-audit-severity-'));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      const { file, document } = designFixture(root, {
        count: 1,
        frames: [{ id: 'desktop', label: 'Desktop', width: 640, height: 600 }],
      });
      if (mode === 'auto')
        document.frames.push({ id: 'long', label: 'Long', width: 640, height: 'auto' });
      writeFileSync(file, JSON.stringify(document));
      await renderDesignDocument(file);
      const moves = {
        migrated: [{ x: 120, y: 180 }],
        dragged: [
          { x: 120, y: 180 },
          { x: 600, y: 400 },
        ],
      };
      for (const point of moves[mode] ?? []) {
        const current = currentDesign(file);
        const board = current.entries[0];
        await saveDesignLayout(file, {
          revision: current.revision,
          boards: { [`${board.screenId}/${board.frameId}/${board.variantId}`]: point },
        });
        assert.equal(currentDesign(file).document.schemaVersion, '1.0.0');
      }
      const expected =
        mode === 'auto'
          ? { severity: 'error', verification: 'failed', readiness: 'blocked' }
          : { severity: 'warning', verification: 'verified', readiness: 'pass' };
      const current = currentDesign(file);
      const frames = current.entries.map((artifact) => {
        const page = mockPage(null, { artifact });
        page.frames()[0].evaluate = async (fn, argument) =>
          scrollingScreen(fn, argument, artifact.screenId);
        return page.frames()[0];
      });
      const screenshot = join(root, 'screen.png');
      writeFileSync(
        screenshot,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6F8sAAAAASUVORK5CYII=',
          'base64',
        ),
      );
      const report = await auditDesignPage(
        { frames: () => frames },
        {
          revision: current.revision,
          document: current.document,
          entries: current.entries,
          screenshotPaths: [screenshot],
          scenarios: [{ name: 'Open drawer', status: 'passed' }],
        },
      );
      assert.deepEqual(
        Array.from(report.screens[0].issues, ({ rule, severity }) => ({ rule, severity })),
        ['board-root-box-sizing', 'vertical-overflow', 'outside-frame'].map((rule) => ({
          rule,
          severity: expected.severity,
        })),
        mode,
      );
      const verified = verifyDesignDocument(file, report);
      assert.equal(verified.status, expected.verification, mode);
      const readiness = compileDesignHandoffReadiness({
        document: current.document,
        sourceRevision: current.revision,
        verification: verified,
      });
      assert.equal(
        readiness.checks.find(({ id }) => id === 'rendered-verification').status,
        expected.readiness,
        mode,
      );
    });
  }
});
