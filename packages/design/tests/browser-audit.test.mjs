import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import { browserExecutable, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { auditDesignPage, auditRenderedScreen } from '../lib/design/browser-audit.mjs';

const entry = {
  artifactId: 'overview-desktop',
  screenId: 'overview',
  frameId: 'desktop',
  variantId: 'primary',
};
function mockPage(result, { attribute = 'data-planr-artifact-frame', throws = false } = {}) {
  const panel = { hidden: true };
  const handle = {
    async getAttribute(name) {
      return name === attribute ? entry.artifactId : null;
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

test('rendered checks remain unverified until caller supplies screenshots and completed journeys', async () => {
  const page = mockPage(clearResult());
  const report = await auditDesignPage(page, { revision: 'revision-one', entries: [entry] });
  assert.equal(report.status, 'unverified');
  assert.deepEqual(report.checkedArtifacts, [entry.artifactId]);
  assert.deepEqual(report.scenarios, []);
  assert.deepEqual(report.screenshots, []);
  assert.equal(page.panel.hidden, true, 'audit restores hidden review panels');
  const verified = await auditDesignPage(page, {
    revision: 'revision-one',
    entries: [entry],
    screenshotPaths: ['screenshots/overview.png'],
    scenarios: [{ name: 'Save account', status: 'passed' }],
  });
  assert.equal(verified.status, 'verified');
});

test('missing, mismatched and failed frames can never claim complete artifact coverage', async () => {
  const options = {
    revision: 'revision-one',
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

test('computed findings retain artifact identity and browser script failures remain visible', async () => {
  const page = mockPage({
    ...clearResult(),
    issues: [
      { rule: 'contrast-below-aa', severity: 'error', message: 'Computed contrast is 2:1.' },
    ],
  });
  page.pageErrors = async () => [new Error('Action handler failed.')];
  const report = await auditDesignPage(page, { revision: 'revision-one', entries: [entry] });
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.issues[0], {
    artifactId: entry.artifactId,
    rule: 'contrast-below-aa',
    severity: 'error',
    message: 'Computed contrast is 2:1.',
  });
  assert.ok(report.issues.some(({ rule }) => rule === 'browser-script-error'));
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
  const report = await auditDesignPage(page, { revision: 'browser-revision', entries: [entry] });
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
    assert.deepEqual(argument, { height: 'auto' });
    return clearResult();
  };
  await auditDesignPage(page, { entries: [{ ...entry, height: 'auto' }] });
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
