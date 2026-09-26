import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { renderArtifactParentRuntime } from '@openplanr/artifact/bridge.mjs';
import { createArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { createArtifactReviewServer } from '@openplanr/artifact/review-server.mjs';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { currentDesign, renderDesignDocument } from '../lib/design/document.mjs';
import { readDesignFeedback, startDesignReview } from '../lib/design/review.mjs';
import {
  createDesignStudioEntries,
  designStudioArtifactId,
  renderDesignStudio,
} from '../lib/design/studio.mjs';
import { designFixture as writeDesignFixture } from './design-fixture.mjs';

test('native local submit requires allow-forms even when form navigation is denied by CSP', {
  timeout: 15000,
}, async () => {
  const browser = await launchBrowser({ engine: 'chromium' });
  try {
    const page = await browser.newPage();
    const source = `<!doctype html><meta http-equiv="Content-Security-Policy" content="form-action 'none'"><form><label>Crew name<input name="crew" required></label><button type="submit">Check availability</button><p id="result">Unchecked</p></form><script>document.querySelector('form').addEventListener('submit',function(event){event.preventDefault();document.getElementById('result').textContent=this.elements.crew.value})</script>`;
    const encoded = source.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    await page.setContent(
      `<iframe id="restricted" sandbox="allow-scripts" srcdoc="${encoded}"></iframe><iframe id="local-forms" sandbox="allow-scripts allow-forms" srcdoc="${encoded}"></iframe>`,
    );
    const restricted = page.frameLocator('#restricted');
    await restricted.getByRole('textbox', { name: 'Crew name' }).fill('East');
    await restricted.getByRole('button', { name: 'Check availability' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(
      await restricted.locator('#result').textContent(),
      'Unchecked',
      'allow-scripts alone blocks the native submit event',
    );
    const local = page.frameLocator('#local-forms');
    await local.getByRole('button', { name: 'Check availability' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(
      await local.locator('#result').textContent(),
      'Unchecked',
      'the browser still enforces required input validity',
    );
    await local.getByRole('textbox', { name: 'Crew name' }).fill('North');
    await local.getByRole('button', { name: 'Check availability' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(
      await local.locator('#result').textContent(),
      'North',
      'allow-forms enables the native handler without any DOM click simulation',
    );
    assert.equal(await local.locator('body').evaluate(() => location.href), 'about:srcdoc');
  } finally {
    await browser.close();
  }
});

function designFixture() {
  const document = {
    kind: 'openplanr-design-document',
    schemaVersion: '1.0.0',
    id: 'northline',
    title: 'Northline workspace',
    brief: {
      text: 'Coordinate the field team with clear ownership and calm daily planning.',
      source: 'describe',
      provenance: 'inferred',
    },
    frames: [
      { id: 'desktop', label: 'Desktop', width: 1440, height: 1024 },
      { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
    ],
    screens: [
      {
        id: 'overview',
        title: 'Team overview',
        description: 'Start with the teams and assignments that need your attention.',
        source: { html: 'overview.html' },
      },
      {
        id: 'assignment',
        title: 'Assignment detail',
        description: 'A single place for the brief, assigned team, and next action.',
        source: { html: 'assignment.html' },
      },
      {
        id: 'confirmed',
        title: 'Ready for the day',
        description: 'Confirm the plan and keep the team moving.',
        source: { html: 'confirmed.html' },
      },
    ],
    screenOrder: ['overview', 'assignment', 'confirmed'],
    variants: [
      { id: 'calm', label: 'Calm workspace', status: 'ready' },
      { id: 'focused', label: 'Focused workspace', status: 'ready' },
    ],
    selectedVariant: 'calm',
    defaultView: 'canvas',
  };
  const source = (
    screen,
    variant,
  ) => `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  *{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui;background:${variant.id === 'calm' ? '#f6f8fa' : '#eef2f6'};color:#183344}header{height:68px;border-bottom:1px solid #d9e3e8;background:#fff;padding:0 32px;display:flex;align-items:center;justify-content:space-between}header strong{font-size:19px;letter-spacing:-.5px}main{padding:38px 40px;max-width:1000px;margin:auto}.context{font-size:13px;color:#476477}h1{font-size:32px;line-height:1.2;font-weight:600;letter-spacing:-1px;margin:10px 0 12px}p{color:#476477}.overview{display:grid;grid-template-columns:2fr 1fr;gap:22px;margin-top:30px}.assignments{background:#fff;border:1px solid #d9e3e8;border-radius:10px;padding:20px}h2{font-size:16px;font-weight:600;margin:0 0 12px}.assignment{padding:17px 0;display:flex;align-items:center;gap:12px;border-bottom:1px solid #e6ecef}.assignment:last-child{border:0}.avatar{width:34px;height:34px;display:grid;place-items:center;border-radius:8px;background:#e4edef;color:#244d5d;font-size:12px}.assignment span{flex:1}.assignment small{display:block;color:#536e7e}.tag{background:#e5f2ed;color:#1c5e45;border-radius:20px;padding:5px 9px;font-size:11px}button{font:inherit;cursor:pointer;border:0;border-radius:6px;background:#1d6175;color:#fff;padding:11px 16px}button:focus-visible{outline:3px solid #2563eb;outline-offset:3px}.summary{background:#e9f0f3;border-radius:10px;padding:22px}.summary strong{font-size:40px;font-weight:550;display:block;line-height:1.2}.summary p{font-size:12px;margin-top:5px}.primary{display:flex;align-items:center;justify-content:space-between;margin-top:28px;padding-top:20px;border-top:1px solid #d9e3e8}@media(max-width:600px){header{padding:0 22px}main{padding:26px 22px}h1{font-size:28px}.overview{grid-template-columns:1fr}.summary{display:flex;gap:18px}.summary p{margin:0}.primary{align-items:flex-start;gap:12px;flex-direction:column}}
  </style></head><body data-planr-screen="${screen.id}"><header><strong>Northline</strong><span>Field team</span></header><main><div class="context">Wednesday, 09 September</div><h1>${screen.title === 'Team overview' ? 'A clear start to your day.' : screen.title}</h1><p>${screen.description}</p><div class="overview"><section class="assignments" data-planr-id="assignment-list"><h2>Today’s assignments</h2>${['Waterfront site review', 'Harbour equipment check', 'Riverside installation'].map((text, index) => `<div class="assignment"><div class="avatar">${['MC', 'JT', 'AL'][index]}</div><span>${text}<small>${['Maya Chen', 'Jonah Tran', 'Amira Lewis'][index]} · ${index + 9}:00</small></span><b class="tag">Ready</b></div>`).join('')}</section><aside class="summary"><div><strong>12</strong><p>Assignments scheduled</p></div><p>Everyone has what they need.<br>Three teams are ready to begin.</p></aside></div><div class="primary"><p>Last updated just now</p><button data-planr-id="primary-action" onclick="parent.postMessage({type:'openplanr:design-navigate',screenId:'${screen.id === 'overview' ? 'assignment' : 'confirmed'}'},'*')">${screen.id === 'overview' ? 'Review assignment' : screen.id === 'assignment' ? 'Confirm assignment' : 'Plan confirmed'}</button></div></main></body></html>`;
  const artifacts = document.variants.flatMap((variant) =>
    document.screens.flatMap((screen) =>
      document.frames.map((frame) => ({
        id: designStudioArtifactId(variant.id, screen.id, frame.id),
        title: `${screen.title} / ${variant.label} / ${frame.label}`,
        html: source(screen, variant),
        viewport: { width: frame.width, height: frame.height },
      })),
    ),
  );
  const envelope = createArtifactEnvelope({
    artifacts,
    viewer: { mode: 'variants', presentation: 'canvas' },
  });
  return {
    document,
    envelope,
    entries: createDesignStudioEntries(document, envelope),
  };
}

test('browser studio boots through the protected artifact server and supports a real reviewed journey', {
  timeout: 60000,
}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'openplanr-studio-browser-'));
  const data = designFixture();
  const server = createArtifactReviewServer({
    env: { ...process.env, PLANR_HOME: temporary },
    renderDocument: ({ model, base }) =>
      renderDesignStudio(
        {
          ...data,
          envelope: model.envelope,
          stalePins: [
            {
              id: 'earlier-pin',
              screenId: 'overview',
              anchor: { planrId: 'removed-action' },
              comment: 'Clarify the earlier action before resolving this feedback.',
            },
          ],
        },
        { stageRuntimeUrl: `${base}runtime.js` },
      ),
    renderRuntime: ({ options }) =>
      `globalThis.__OPENPLANR_DESIGN_STUDIO_OPTIONS__={exportHtml:async()=>${JSON.stringify(data.envelope.artifacts[0].html)}};\n${renderArtifactParentRuntime(options)}`,
  });
  let browser;
  try {
    const port = await server.listen(0);
    const response = await fetch(`http://127.0.0.1:${port}/internal/v1/sessions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${server.controlToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        envelope: data.envelope,
        title: data.document.title,
        cwd: temporary,
      }),
    });
    assert.equal(response.status, 201);
    const session = await response.json();
    browser = await launchBrowser({ engine: 'chromium' });
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1050 },
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(8000);
    page.setDefaultNavigationTimeout(30000);
    const errors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${port}${session.path}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForSelector('[data-design-ready="true"]');
    // Runtime mounting replaces current threads; stale feedback must survive in
    // the same rail, outside that runtime-owned slot, including after reload.
    assert.equal(await page.locator('[data-design-stale-pin="earlier-pin"]').isVisible(), true);
    assert.equal(
      await page.locator('[data-planr-slot="feedback-rail"] [data-design-stale-pin]').count(),
      0,
    );
    await page.reload();
    await page.waitForSelector('[data-design-ready="true"]');
    assert.match(
      await page.locator('[data-design-stale-pin="earlier-pin"]').innerText(),
      /Clarify the earlier action/,
    );
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll('iframe')].every(
            (frame) => frame.dataset.planrBridgeTrusted === 'true',
          ),
        null,
        { timeout: 10000 },
      )
      .catch(async (error) => {
        throw new Error(
          `${error.message}\n${consoleErrors.join('\n')}\n${JSON.stringify(await page.locator('iframe').evaluateAll((frames) => frames.map((frame) => ({ id: frame.dataset.planrArtifactFrame, trusted: frame.dataset.planrBridgeTrusted, inert: frame.inert }))))}`,
        );
      });
    assert.equal(await page.locator('.planr-toolbar').count(), 1);
    assert.equal(await page.locator('.planr-artifact-panel:visible').count(), 6);
    const chrome = await page.evaluate(() => ({
      toolbar: document.querySelector('.planr-toolbar').getBoundingClientRect().height,
      navigator: document.querySelector('.design-navigator').getBoundingClientRect().width,
      review: document.querySelector('.planr-review-rail').getBoundingClientRect().width,
      stage: document.querySelector('.planr-stage').getBoundingClientRect().width,
    }));
    assert.ok(chrome.toolbar <= 60);
    assert.equal(await page.locator('html').getAttribute('data-planr-theme'), 'dark');
    assert.equal(await page.getByRole('button', { name: 'Review', exact: true }).count(), 1);
    assert.equal(await page.locator('.design-wordmark').textContent(), 'OpenPlanr');
    assert.equal(await page.getByRole('button', { name: 'Close screens', exact: true }).count(), 1);
    assert.ok(chrome.navigator <= 240);
    assert.ok(chrome.review <= 336);
    await page.waitForFunction(() => Boolean(window.__openPlanrDesignExperience));
    assert.equal(
      await page
        .locator('[data-design-screen]')
        .first()
        .evaluate((node) => getComputedStyle(node).fontSize),
      '13px',
    );
    assert.ok(
      (await page
        .locator('[data-design-screen]')
        .first()
        .evaluate((node) => node.getBoundingClientRect().height)) < 90,
      'screen rows stay compact',
    );
    const initialCamera = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
    const resizeScreens = page.getByRole('separator', { name: 'Resize screens sidebar' });
    await resizeScreens.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await resizeScreens.getAttribute('aria-valuenow'), '248');
    await resizeScreens.press('ArrowLeft');
    await page.getByRole('button', { name: 'About this review', exact: true }).first().click();
    assert.equal(
      await page.getByRole('dialog', { name: 'Welcome to this review' }).isVisible(),
      true,
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.getByRole('tab', { name: 'Inspect', exact: true }).click();
    await page.getByRole('button', { name: 'Select an element', exact: true }).click();
    assert.equal(await page.locator('.planr-shell').getAttribute('data-design-inspect'), 'true');
    const inspection = page
      .locator('.planr-artifact-panel:visible .design-inspect-overlay')
      .first();
    await inspection.click({ position: { x: 60, y: 70 } });
    await page.waitForSelector('.design-inspect-values');
    assert.match(await page.locator('.design-inspect-values').textContent(), /width.*px/);
    await page.getByRole('tab', { name: 'Review', exact: true }).click();
    assert.equal(await page.locator('.planr-shell').getAttribute('data-design-inspect'), 'false');
    await page.locator('.design-tools-menu > summary').click();
    await page.getByRole('button', { name: 'Fit selection', exact: true }).click();
    assert.ok(
      (await page.evaluate(() => window.__openPlanrDesignStudio.getState().zoom)) >
        initialCamera.zoom,
    );
    await page.locator('.design-tools-menu > summary').click();
    await page.getByRole('button', { name: 'Minimap', exact: true }).click();
    assert.equal(await page.locator('.design-minimap').isVisible(), true);
    await page.getByRole('button', { name: 'Close minimap', exact: true }).click();
    await page.evaluate(() =>
      window.__openPlanrDesignStudio.setCamera({ x: -345, y: 147, zoom: 0.42 }),
    );
    const beforePresentation = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
    await page.locator('.design-tools-menu > summary').click();
    await page.getByRole('button', { name: 'Present fullscreen', exact: true }).click();
    assert.equal(
      await page.locator('.planr-shell').getAttribute('data-design-presentation'),
      'true',
    );
    await page.waitForFunction(() => {
      const panel = document.querySelector('.planr-artifact-panel[data-design-active="true"]');
      const stage = document.querySelector('.planr-stage-scroll');
      if (!panel || !stage || panel.hidden) return false;
      const frame = panel.getBoundingClientRect(),
        viewport = stage.getBoundingClientRect();
      return (
        viewport.width > 100 &&
        viewport.height > 100 &&
        frame.width > 100 &&
        frame.height > 100 &&
        frame.right > viewport.left &&
        frame.left < viewport.right &&
        frame.bottom > viewport.top &&
        frame.top < viewport.bottom
      );
    });
    assert.ok(
      (await page
        .locator('.planr-stage-scroll')
        .evaluate((node) => node.getBoundingClientRect().height)) > 800,
      'presentation stage fills the fullscreen shell',
    );
    await page.getByRole('button', { name: 'Exit presentation', exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector('.planr-shell').hasAttribute('data-design-presentation'),
    );
    await page.waitForFunction(
      () => !document.querySelector('.planr-shell').hasAttribute('data-design-restoring'),
    );
    const afterPresentation = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
    for (const key of [
      'view',
      'screenId',
      'variantId',
      'frameId',
      'camera',
      'zoom',
      'viewports',
      'navOpen',
      'reviewOpen',
    ])
      assert.deepEqual(
        afterPresentation[key],
        beforePresentation[key],
        `Presentation restores ${key}`,
      );
    assert.equal(
      await page
        .locator('.design-tools-menu > summary')
        .evaluate((node) => node === document.activeElement),
      true,
      'focus returns to the canvas controls',
    );
    await page.evaluate(() => {
      document.querySelector('.planr-shell').requestFullscreen = async () => {
        throw new Error('Fullscreen denied');
      };
    });
    await page.locator('.design-tools-menu > summary').click();
    await page.getByRole('button', { name: 'Present fullscreen', exact: true }).click();
    await page.waitForFunction(() => {
      const panel = document.querySelector('.planr-artifact-panel[data-design-active="true"]');
      const stage = document.querySelector('.planr-stage-scroll');
      if (!panel || !stage || panel.hidden) return false;
      const frame = panel.getBoundingClientRect(),
        viewport = stage.getBoundingClientRect();
      return (
        frame.width > 100 &&
        frame.height > 100 &&
        frame.right > viewport.left &&
        frame.left < viewport.right &&
        frame.bottom > viewport.top &&
        frame.top < viewport.bottom
      );
    });
    await page.getByRole('button', { name: 'Exit presentation', exact: true }).focus();
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => !document.querySelector('.planr-shell').hasAttribute('data-design-restoring'),
    );
    assert.equal(
      await page.locator('.planr-shell').getAttribute('data-design-presentation'),
      null,
      'Escape exits presentation even when native fullscreen is denied',
    );
    assert.deepEqual(
      await page.evaluate(() => window.__openPlanrDesignStudio.getState().camera),
      beforePresentation.camera,
    );
    await page.evaluate(
      (value) => window.__openPlanrDesignStudio.setCamera({ ...value.camera, zoom: value.zoom }),
      initialCamera,
    );
    assert.match(
      await page.locator('[data-design-frame] option[value="desktop"]').textContent(),
      /1440 × 1024/,
    );
    await page.screenshot({ path: '/tmp/openplanr-design-studio-canvas.png' });
    assert.equal(
      await page.locator('.planr-stage-scroll').evaluate((node) => getComputedStyle(node).overflow),
      'hidden',
      'the camera owns navigation instead of a finite scroll surface',
    );
    const firstCanvasEntry = data.entries.find(
      (entry) =>
        entry.screenId === 'overview' && entry.frameId === 'desktop' && entry.variantId === 'calm',
    );
    const dragHandle = page.locator(
      `[data-artifact-id="${firstCanvasEntry.artifactId}"] [data-design-drag]`,
    );
    const dragBounds = await dragHandle.boundingBox();
    await page.mouse.move(dragBounds.x + 100, dragBounds.y + dragBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(dragBounds.x + 50, dragBounds.y + dragBounds.height / 2 - 50, {
      steps: 8,
    });
    await page.mouse.up();
    const movedPosition = await page.evaluate(
      (artifactId) => window.__openPlanrDesignStudio.getState().positions[artifactId],
      firstCanvasEntry.artifactId,
    );
    assert.ok(movedPosition.x < 0);
    assert.ok(movedPosition.y < 0);

    const cameraBeforePan = await page.evaluate(
      () => window.__openPlanrDesignStudio.getState().camera,
    );
    await page.locator('[data-design-pan]').click();
    const stageBounds = await page.locator('.planr-stage-scroll').boundingBox();
    const panStart = {
      x: stageBounds.x + stageBounds.width - 80,
      y: stageBounds.y + stageBounds.height - 120,
    };
    await page.mouse.move(panStart.x, panStart.y);
    await page.mouse.down();
    await page.mouse.move(panStart.x + 120, panStart.y + 70, { steps: 8 });
    await page.mouse.up();
    await page.locator('[data-design-pan]').click();
    const movedCamera = await page.evaluate(() => window.__openPlanrDesignStudio.getState().camera);
    assert.equal(movedCamera.x, cameraBeforePan.x + 120);
    assert.equal(movedCamera.y, cameraBeforePan.y + 70);

    await page.locator('[data-design-view="prototype"]').click();
    await page.locator('[data-design-view="canvas"]').click();
    assert.deepEqual(
      await page.evaluate(() => window.__openPlanrDesignStudio.getState().camera),
      movedCamera,
      'canvas restores its own camera after visiting another view',
    );
    await page.locator('[data-design-note="overview"]').first().click();
    assert.equal(await page.locator('[data-design-notes]').getAttribute('open'), '');
    assert.equal(
      await page.locator('[data-design-note-screen="overview"]').getAttribute('open'),
      '',
    );
    assert.equal(
      await page.locator('.planr-artifact-panel [data-design-note-screen]').count(),
      0,
      'studio guidance stays outside the product artboards',
    );
    await page.screenshot({
      path: '/tmp/openplanr-design-studio-freeform.png',
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Close design notes', exact: true }).click();
    assert.equal(await page.locator('[data-design-notes]').getAttribute('open'), null);
    assert.equal(
      await page
        .locator('[data-design-note="overview"]')
        .first()
        .evaluate((node) => node === document.activeElement),
      true,
    );
    // Use the mobile artboard marker, which remains outside the open popover.
    await page.locator('[data-design-note="overview"]:visible').last().click();
    await page.locator('[data-design-note="overview"]:visible').last().click();
    assert.equal(await page.locator('[data-design-notes]').getAttribute('open'), null);
    await page.locator('[data-design-notes] > summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-design-notes]').getAttribute('open'), '');
    await page.locator('[data-design-note-screen="overview"] > summary').click();
    assert.equal(
      await page.locator('[data-design-notes]').getAttribute('open'),
      '',
      'accordion stays open',
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-design-notes]').getAttribute('open'), null);
    assert.equal(
      await page
        .locator('[data-design-notes] > summary')
        .evaluate((node) => node === document.activeElement),
      true,
    );
    await page.locator('[data-design-notes] > summary').click();
    await page.locator('.planr-brand').click();
    assert.equal(await page.locator('[data-design-notes]').getAttribute('open'), null);
    await page.locator('[data-design-notes] > summary').click();
    await page.locator('[data-design-view="prototype"]').click();
    assert.equal(await page.locator('[data-design-notes]').getAttribute('open'), null);
    await page.locator('[data-design-view="canvas"]').click();

    await page.getByRole('button', { name: 'Screens', exact: true }).click();
    await page.waitForSelector('.planr-shell[data-design-nav-open="false"]');
    await page.waitForFunction(
      (width) =>
        document.querySelector('.planr-stage').getBoundingClientRect().width >= width + 180,
      chrome.stage,
    );
    const withoutNavigator = await page
      .locator('.planr-stage')
      .evaluate((node) => node.getBoundingClientRect().width);
    assert.ok(withoutNavigator >= chrome.stage + 180);
    await page.locator('[data-planr-action="feedback"]').click();
    await page.waitForSelector('.planr-shell[data-planr-rail-open="false"]');
    await page.waitForFunction(
      (width) =>
        document.querySelector('.planr-stage').getBoundingClientRect().width >= width + 260,
      withoutNavigator,
    );
    const distractionFree = await page
      .locator('.planr-stage')
      .evaluate((node) => node.getBoundingClientRect().width);
    assert.ok(distractionFree >= withoutNavigator + 260);
    await page.screenshot({
      path: '/tmp/openplanr-design-studio-focus.png',
      animations: 'disabled',
    });
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    await page.reload();
    await page.waitForSelector('[data-design-ready="true"]');
    assert.deepEqual(
      await page.evaluate(
        (artifactId) => ({
          camera: window.__openPlanrDesignStudio.getState().camera,
          position: window.__openPlanrDesignStudio.getState().positions[artifactId],
        }),
        firstCanvasEntry.artifactId,
      ),
      { camera: movedCamera, position: movedPosition },
      'freeform camera and artboard coordinates survive a restart',
    );
    assert.equal(await page.locator('.planr-shell').getAttribute('data-design-nav-open'), 'false');
    assert.equal(await page.locator('.planr-shell').getAttribute('data-planr-rail-open'), 'false');
    await page.getByRole('button', { name: 'Screens', exact: true }).click();
    await page.locator('[data-planr-action="feedback"]').click();
    await page.locator('[data-planr-action="share"]').click();
    assert.equal(await page.locator('[data-planr-share-dialog]').isVisible(), true);
    assert.match(
      await page.locator('#planr-share-description').textContent(),
      /encrypted and collaborative/i,
    );
    assert.equal(
      await page.locator('[data-planr-share-confirm]').isDisabled(),
      true,
      'a generic host without a share adapter cannot offer broken creation',
    );
    assert.match(
      await page.locator('[data-planr-share-error]').textContent(),
      /updated OpenPlanr installation/,
    );
    assert.equal(
      await page.locator('[data-planr-share-fragment-size]').textContent(),
      'Unavailable',
    );
    await page.locator('[data-planr-share-close]').click();
    const originalSources = await page
      .locator('iframe')
      .evaluateAll((frames) => frames.map((frame) => frame.src));

    await page.locator('[data-design-view="prototype"]').click();
    await page.screenshot({
      path: '/tmp/openplanr-design-studio-before-click.png',
    });
    const first = data.entries.find(
      (entry) =>
        entry.screenId === 'overview' && entry.frameId === 'desktop' && entry.variantId === 'calm',
    );
    assert.equal(
      await page.locator('button[data-design-view="prototype"]').getAttribute('aria-pressed'),
      'true',
    );
    // Playwright's frame locator adds the iframe offset but omits the ancestor
    // scale. A real mouse click uses the preview's displayed viewport geometry.
    const iframe = page.locator(`[data-planr-artifact-frame="${first.artifactId}"]`);
    const frameBounds = await iframe.boundingBox();
    const buttonBounds = await page
      .frameLocator(`[data-planr-artifact-frame="${first.artifactId}"]`)
      .getByRole('button', { name: 'Review assignment' })
      .evaluate((node) => ({
        rect: node.getBoundingClientRect().toJSON(),
        width: innerWidth,
        height: innerHeight,
      }));
    await page.mouse.click(
      frameBounds.x +
        ((buttonBounds.rect.x + buttonBounds.rect.width / 2) * frameBounds.width) /
          buttonBounds.width,
      frameBounds.y +
        ((buttonBounds.rect.y + buttonBounds.rect.height / 2) * frameBounds.height) /
          buttonBounds.height,
    );
    await page.waitForFunction(
      () => window.__openPlanrDesignStudio.getState().screenId === 'assignment',
    );
    assert.equal(await page.locator('.planr-artifact-panel:visible').count(), 1);
    await page.locator('[data-design-frame]').selectOption('mobile');
    await page.locator('[data-planr-mode="comment"]').click();
    const target = data.entries.find(
      (entry) =>
        entry.screenId === 'assignment' && entry.frameId === 'mobile' && entry.variantId === 'calm',
    );
    await page
      .locator(`[data-planr-annotation-layer="${target.artifactId}"]`)
      .click({ position: { x: 150, y: 140 } });
    await page.locator('[data-planr-composer-identity]').fill('Asem');
    await page
      .locator('[data-planr-composer-comment]')
      .fill('Make the next action easier to find.');
    await page.locator('[data-planr-composer-submit]').click();
    assert.equal(await page.locator('.planr-annotation-layer [data-planr-pin-id]').count(), 1);
    await page.screenshot({
      path: '/tmp/openplanr-design-studio-prototype.png',
    });
    await page.locator('[data-design-view="walkthrough"]').click();
    await page.locator('[data-design-step-change="1"]').click();
    assert.match(await page.locator('[data-design-step]').textContent(), /Step 3 of 3/);
    assert.equal(await page.locator('.planr-annotation-layer [data-planr-pin-id]').count(), 1);
    assert.deepEqual(
      await page.locator('iframe').evaluateAll((frames) => frames.map((frame) => frame.src)),
      originalSources,
    );
    // The out-of-process iframe paints after its hidden panel becomes visible;
    // wait for the compositor before capturing the visual review evidence.
    await page.waitForTimeout(150);
    await page.screenshot({
      path: '/tmp/openplanr-design-studio-walkthrough.png',
      animations: 'disabled',
    });

    await page.locator('[data-design-rating="4"]').click();
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    const htmlDownload = page.waitForEvent('download');
    await page.locator('.design-export summary').click();
    await page.locator('[data-design-export="html"]').click();
    assert.match((await htmlDownload).suggestedFilename(), /\.html$/);
    await page.reload();
    await page.waitForSelector('[data-design-ready="true"]');
    assert.equal(
      await page.evaluate(() => window.__openPlanrDesignStudio.getState().ratings.calm),
      4,
    );
    assert.equal(await page.locator('.planr-annotation-layer [data-planr-pin-id]').count(), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForSelector('.planr-shell[data-planr-rail-open="false"]');
    await page.screenshot({
      path: '/tmp/openplanr-design-studio-mobile.png',
      animations: 'disabled',
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.equal(
      await page.locator('.planr-artifact-panel[data-design-active="true"]').evaluate((panel) => {
        const rect = panel.getBoundingClientRect();
        return (
          rect.right > 0 && rect.left < innerWidth && rect.bottom > 130 && rect.top < innerHeight
        );
      }),
      true,
      'resizing a journey view keeps the active product screen in view',
    );
    await page.locator('[data-design-notes] > summary').click();
    await page
      .locator('[data-design-note-screen]')
      .first()
      .evaluate((item) => {
        item.open = true;
        item.querySelector('p').textContent =
          'A long implementation note remains readable without covering the controls. '.repeat(100);
      });
    const noteBounds = await page.locator('.design-guidance-panel').evaluate((panel) => {
      const rect = panel.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        scrolls: panel.scrollHeight > panel.clientHeight,
      };
    });
    assert.ok(
      noteBounds.left >= 0 &&
        noteBounds.right <= 390 &&
        noteBounds.top >= 0 &&
        noteBounds.bottom <= 844,
      'Notes remains completely inside a narrow viewport',
    );
    assert.equal(noteBounds.scrolls, true, 'long Notes scrolls internally');
    await page.getByRole('button', { name: 'Close design notes', exact: true }).click();
    assert.equal(await page.locator('[data-design-notes]').getAttribute('open'), null);
    await page.getByRole('button', { name: 'Screens', exact: true }).click();
    await page.getByRole('button', { name: 'Close screens', exact: true }).click();
    assert.equal(
      await page
        .getByRole('button', { name: 'Screens', exact: true })
        .evaluate((node) => node === document.activeElement),
      true,
    );
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await page.locator('.design-refinement > summary').click();
    await page
      .getByLabel('Refinement note', { exact: true })
      .fill('Keep these compact review controls.');
    await page.getByRole('button', { name: 'Save refinement note', exact: true }).click();
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    assert.equal(
      await page.evaluate(() => window.__openPlanrDesignStudio.getState().remix.calm),
      'Keep these compact review controls.',
    );
    await page.getByRole('button', { name: 'Close review', exact: true }).click();
    assert.equal(
      await page
        .getByRole('button', { name: 'Review', exact: true })
        .evaluate((node) => node === document.activeElement),
      true,
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test('journey-start thumbnails capture later screens when they become visible without retrying on camera motion', {
  timeout: 30000,
}, async () => {
  const browser = await launchBrowser({ engine: 'chromium' });
  try {
    for (const view of ['walkthrough', 'prototype']) {
      const temporary = await mkdtemp(join(tmpdir(), 'openplanr-journey-thumbnails-'));
      const data = designFixture();
      data.document.defaultView = view;
      const server = createArtifactReviewServer({
        env: { ...process.env, PLANR_HOME: temporary },
        renderDocument: ({ model, base }) =>
          renderDesignStudio(
            { ...data, envelope: model.envelope },
            { stageRuntimeUrl: `${base}runtime.js` },
          ),
        renderRuntime: ({ options }) => renderArtifactParentRuntime(options),
      });
      const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
      page.setDefaultTimeout(5000);
      try {
        const port = await server.listen(0);
        const response = await fetch(`http://127.0.0.1:${port}/internal/v1/sessions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${server.controlToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            envelope: data.envelope,
            title: data.document.title,
            cwd: temporary,
          }),
        });
        assert.equal(response.status, 201);
        const session = await response.json();
        await page.goto(`http://127.0.0.1:${port}${session.path}`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        await page.waitForSelector('[data-design-ready="true"]');
        await page.waitForSelector('[data-design-screen="overview"] .design-thumbnail img');
        const basis = await page.evaluate(() => {
          const { view, variantId, frameId } = window.__openPlanrDesignStudio.getState();
          return { view, variantId, frameId };
        });
        assert.equal(basis.view, view);
        assert.equal(
          await page.locator('[data-design-screen="assignment"] .design-thumbnail img').count(),
          0,
          'hidden journey frames retain a placeholder until paintable',
        );
        const iframeCount = await page.locator('iframe').count();
        const failingArtifact = data.entries.find(
          (item) =>
            item.screenId === 'confirmed' &&
            item.variantId === basis.variantId &&
            item.frameId === basis.frameId,
        ).artifactId;
        await page.evaluate((id) => {
          const frame = [...document.querySelectorAll('iframe')].find(
            (frame) => frame.dataset.planrArtifactFrame === id,
          );
          window.thumbnailFailureAttempts = 0;
          Object.defineProperty(frame, '__openPlanrBridge', {
            configurable: true,
            value: {
              ...frame.__openPlanrBridge,
              thumbnail: async () => {
                window.thumbnailFailureAttempts++;
                throw new Error('Capture unavailable');
              },
            },
          });
        }, failingArtifact);
        await page.locator('[data-design-screen="assignment"]').click();
        await page.waitForSelector('[data-design-screen="assignment"] .design-thumbnail img');
        assert.deepEqual(
          await page.evaluate(() => {
            const { view, variantId, frameId } = window.__openPlanrDesignStudio.getState();
            return { view, variantId, frameId };
          }),
          basis,
        );
        await page.locator('[data-design-screen="confirmed"]').click();
        await page.waitForFunction(() => window.thumbnailFailureAttempts === 1);
        await page.evaluate(() => {
          for (let i = 0; i < 5; i++)
            window.__openPlanrDesignStudio.setCamera({ x: i * 8, y: i * 4 });
        });
        await page.waitForTimeout(200);
        assert.equal(
          await page.evaluate(() => window.thumbnailFailureAttempts),
          1,
          'camera renders do not poll or retry a genuine capture failure',
        );
        assert.equal(
          await page.locator('[data-design-screen="confirmed"] .design-thumbnail img').count(),
          0,
        );
        await page.locator('[data-design-screen="assignment"]').click();
        await page.locator('[data-design-screen="confirmed"]').click();
        await page.waitForFunction(() => window.thumbnailFailureAttempts === 2);
        assert.equal(
          await page.locator('iframe').count(),
          iframeCount,
          'captures reuse the original frames',
        );
      } finally {
        await page.close();
        await server.close();
        await rm(temporary, { recursive: true, force: true });
      }
    }
  } finally {
    await browser.close();
  }
});

test('generated portable HTML and the public design review composition preserve interactions and durable pins', {
  timeout: 90000,
}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'openplanr-studio-generated-'));
  const { file } = writeDesignFixture(temporary, { count: 3, variants: 3 });
  const firstSource = join(temporary, 'source/screen-1.html');
  writeFileSync(
    firstSource,
    readFileSync(firstSource, 'utf8').replace(
      '</main>',
      `<form id="availability-form"><label>Crew name<input name="crew" required></label><button type="submit">Check availability</button><p id="availability-result" role="status">Unchecked</p></form><script>document.getElementById('availability-form').addEventListener('submit',function(event){event.preventDefault();document.getElementById('availability-result').textContent=this.elements.crew.value==='East'?'Unavailable':'Available'})</script></main>`,
    ),
  );
  const result = await renderDesignDocument(file);
  const current = currentDesign(file);
  let browser;
  let review;
  try {
    browser = await launchBrowser({ engine: 'chromium' });
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1050 },
    });
    page.setDefaultTimeout(8000);
    page.setDefaultNavigationTimeout(30000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(pathToFileURL(result.views.canvas).href);
    await page.waitForSelector('[data-design-ready="true"]');
    assert.equal(await page.locator('.planr-artifact-panel:visible').count(), 6);
    const first = current.entries.find(
      (entry) =>
        entry.screenId === 'screen-1' && entry.variantId === 'A' && entry.frameId === 'desktop',
    );
    await page.locator('button[data-design-view="prototype"]').click();
    const firstFrame = page.frameLocator(`[data-planr-artifact-frame="${first.artifactId}"]`);
    const firstSrc = await page
      .locator(`[data-planr-artifact-frame="${first.artifactId}"]`)
      .getAttribute('src');
    const availability = firstFrame.getByRole('button', {
      name: 'Check availability',
    });
    await availability.focus();
    await page.keyboard.press('Enter');
    assert.equal(
      await firstFrame.locator('#availability-result').textContent(),
      'Unchecked',
      'native required validation prevents the submit handler',
    );
    assert.equal(
      await firstFrame
        .getByRole('textbox', { name: 'Crew name' })
        .evaluate((input) => input.matches(':invalid') && document.activeElement === input),
      true,
    );
    await firstFrame.getByRole('textbox', { name: 'Crew name' }).fill('East');
    await availability.focus();
    await page.keyboard.press('Enter');
    assert.equal(
      await firstFrame.locator('#availability-result').textContent(),
      'Unavailable',
      'the authored submit handler renders its error state',
    );
    await firstFrame.getByRole('textbox', { name: 'Crew name' }).fill('North');
    await availability.focus();
    await page.keyboard.press('Enter');
    assert.equal(
      await firstFrame.locator('#availability-result').textContent(),
      'Available',
      'the same native form can be corrected and submitted',
    );
    assert.equal(
      await page.locator(`[data-planr-artifact-frame="${first.artifactId}"]`).getAttribute('src'),
      firstSrc,
      'local submit does not navigate the frame',
    );
    // Use unscaled keyboard interaction as a second independent primary-action
    // check; iframe source is opaque and the actual handler performs navigation.
    await page
      .frameLocator(`[data-planr-artifact-frame="${first.artifactId}"]`)
      .getByRole('button', { name: 'Continue', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => window.__openPlanrDesignStudio.getState().screenId === 'screen-2',
    );
    assert.equal(
      await page.locator('iframe[data-planr-bridge-trusted="true"]').count(),
      current.entries.length,
    );

    review = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: temporary },
    });
    await page.goto(review.url);
    await page.waitForSelector('[data-design-ready="true"]');
    await page.locator('[data-design-variant]').selectOption('B');
    await page.locator('[data-design-rating="5"]').click();
    await page.locator('[data-design-select-direction]').click();
    await page.locator('[data-planr-mode="comment"]').click();
    const target = current.entries.find(
      (entry) =>
        entry.screenId === 'screen-1' && entry.variantId === 'B' && entry.frameId === 'desktop',
    );
    await page
      .locator(`[data-planr-annotation-layer="${target.artifactId}"]`)
      .click({ position: { x: 100, y: 120 } });
    await page.locator('[data-planr-composer-identity]').fill('Asem');
    await page
      .locator('[data-planr-composer-comment]')
      .fill('Clarify the action hierarchy for this screen.');
    await page.locator('[data-planr-composer-submit]').click();
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    assert.equal(
      readDesignFeedback(file, { ...process.env, PLANR_HOME: temporary }).pins.length,
      1,
    );
    await page.reload();
    await page.waitForSelector('[data-design-ready="true"]');
    assert.equal(
      await page.evaluate(() => window.__openPlanrDesignStudio.getState().selectedVariant),
      'B',
    );
    assert.equal(await page.locator('.planr-annotation-layer [data-planr-pin-id]').count(), 1);
    assert.equal(await page.locator('[data-design-save-state]').textContent(), 'All changes saved');
    await review.close();
    review = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: temporary },
    });
    await page.goto(review.url);
    await page.waitForSelector('[data-design-ready="true"]');
    assert.equal(await page.locator('.planr-annotation-layer [data-planr-pin-id]').count(), 1);
    const download = page.waitForEvent('download');
    await page.locator('.design-export summary').click();
    await page.locator('[data-design-export="png"]').click();
    const png = await download;
    assert.match(png.suggestedFilename(), /\.png$/);
    // A close sent mid-download leaves Chromium running until Playwright kills it 30 s later.
    assert.deepEqual(
      readFileSync(await png.path()).subarray(0, 8),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await review?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
