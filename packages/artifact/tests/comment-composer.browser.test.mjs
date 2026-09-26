import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { ARTIFACT_SHELL_CSS } from '../lib/artifact/ui/shell.mjs';

const enabled = process.env.PLANR_BROWSER_TESTS === '1';
const rootPath = fileURLToPath(new URL('../../../', import.meta.url));
const fixtureSource = `
import { mountArtifactFeedbackRail, ARTIFACT_REVIEW_DRAFT_CHANGE_EVENT } from './packages/artifact/lib/artifact/ui/feedback-rail.mjs';
import { mountArtifactAnnotations } from './packages/artifact/lib/artifact/ui/annotations.mjs';
const root=document.querySelector('.planr-shell');
const viewport={width:1440,height:1024};
const pin=(id)=>({id,author:{id:'reviewer',name:'Morgan'},artifactId:'screen',intent:'question',status:'open',comment:'Comment '+id,region:{x:.2,y:.2,w:0,h:0},viewport,createdAt:'2026-09-10T10:00:00Z',updatedAt:'2026-09-10T10:00:00Z',replies:[]});
const review={schemaVersion:'1.0.0',reviewId:'review',reviewOf:'a'.repeat(64),decision:'pending',overall:'',pins:[pin('first'),pin('second')]};
const rail=mountArtifactFeedbackRail({root,initialReview:review,reviewOf:review.reviewOf,identity:{id:'me',name:'Morgan'}});
const state={status:'ready',artifacts:[{id:'screen',viewport}],activeArtifactId:'screen',reviewMode:'comment'};
const stage={getState:()=>state,dispatch(patch){Object.assign(state,patch);root.dispatchEvent(new CustomEvent('planr:stage-change'));}};
const annotations=mountArtifactAnnotations({document,window,root,stageController:stage,reviewController:rail});
document.querySelector('#open').onclick=()=>annotations.openComposer({artifactId:'screen',variant:'direction',viewport,region:{x:.6,y:.5,w:.2,h:.2}});
root.addEventListener(ARTIFACT_REVIEW_DRAFT_CHANGE_EVENT,event=>sessionStorage.setItem('fixture-review-drafts',JSON.stringify(event.detail)));
const saved=sessionStorage.getItem('fixture-review-drafts');if(saved)rail.restoreDrafts(JSON.parse(saved));
window.fixture={rail,annotations,stage};
`;

async function browserFixture(t) {
  const requirePipeline = createRequire(new URL('../../pipeline/package.json', import.meta.url));
  const { chromium, webkit } = requirePipeline('playwright');
  const browser = await (process.env.PLANR_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({
    headless: true,
    ...(process.env.PLANR_BROWSER_CHANNEL ? { channel: process.env.PLANR_BROWSER_CHANNEL } : {}),
    ...(process.env.PLANR_BROWSER_EXECUTABLE
      ? { executablePath: process.env.PLANR_BROWSER_EXECUTABLE }
      : {}),
  });
  const bundle = await build({
    stdin: { contents: fixtureSource, resolveDir: rootPath },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
  });
  const server = createServer((req, res) => {
    if (req.url === '/fixture.js') {
      res.setHeader('content-type', 'application/javascript');
      res.end(bundle.outputFiles[0].text);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      :root { --planr-color-rule:#d5d9df; --planr-color-panel:#fff; --planr-color-text:#1b2524; --planr-color-text-muted:#667471; --planr-color-primary:#007d70; --planr-color-primary-strong:#007d70; --planr-color-background:#f8faf9; --planr-color-chrome:#f4f6f5; --planr-color-raised:#edf1ef; --planr-font-body:system-ui; --planr-font-display:system-ui; --planr-radius-large:12px; --planr-radius-small:6px; }
      ${ARTIFACT_SHELL_CSS}
      body{margin:0}.planr-shell{display:block;height:100vh;position:relative}#open{position:absolute;left:12px;top:12px;z-index:50}#canvas{position:absolute;left:90px;top:90px;width:1440px;height:1024px;transform:scale(.2);transform-origin:top left}#canvas .planr-annotation-layer{width:1440px;height:1024px;background:#ddd}.fixture-rail{position:absolute;right:0;top:70px;width:336px;max-height:calc(100vh - 70px);overflow:auto;background:#fff}[data-planr-slot="feedback-rail"]{min-height:0}
    </style></head><body><main class="planr-shell"><button id="open">Add comment</button><div id="canvas"><div class="planr-annotation-layer" data-planr-annotation-layer="screen" tabindex="0"></div></div><aside class="fixture-rail"><input data-planr-reviewer-name><div data-planr-identity-status></div><div data-planr-slot="feedback-rail"></div><p id="planr-review-error" hidden></p><textarea id="planr-overall-note"></textarea><div data-planr-slot="decision-status"></div><button data-planr-decision="approved">Approve</button></aside></main><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.fixture);
  return page;
}

test('new comment composer remains viewport sized across canvas zoom and narrow screens, with accessible dismissal', {
  skip: !enabled,
}, async (t) => {
  const page = await browserFixture(t);
  for (const scale of [0.15, 1, 2.6]) {
    await page.evaluate((value) => {
      document.querySelector('#canvas').style.transform = 'scale(' + value + ')';
    }, scale);
    await page.getByRole('button', { name: 'Add comment', exact: true }).focus();
    await page.getByRole('button', { name: 'Add comment', exact: true }).press('Enter');
    const composer = page.locator('[data-planr-annotation-composer]');
    await composer.waitFor({ state: 'visible' });
    const box = await composer.boundingBox();
    assert.ok(
      Math.abs(box.width - 360) < 1,
      `Composer width must stay 360px at canvas scale ${scale}`,
    );
    assert.ok(box.x >= 11 && box.y >= 11 && box.x + box.width <= 1429 && box.y + box.height <= 889);
    assert.equal(
      await composer.evaluate((form) => form.parentElement.classList.contains('planr-shell')),
      true,
    );
    assert.equal(await composer.getAttribute('role'), 'dialog');
    assert.equal(
      await page
        .locator('[data-planr-composer-comment]')
        .evaluate((field) => document.activeElement === field),
      true,
    );
    await page.keyboard.press('Escape');
    await composer.waitFor({ state: 'detached' });
    assert.equal(
      await page.locator('#open').evaluate((button) => document.activeElement === button),
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 420 });
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  let box = await page.locator('[data-planr-annotation-composer]').boundingBox();
  assert.ok(box.x >= 11 && box.y >= 11 && box.x + box.width <= 379 && box.y + box.height <= 409);
  await page.setViewportSize({ width: 320, height: 280 });
  await page.waitForFunction(() => {
    const r = document.querySelector('[data-planr-annotation-composer]').getBoundingClientRect();
    return r.bottom <= innerHeight - 11;
  });
  box = await page.locator('[data-planr-annotation-composer]').boundingBox();
  assert.ok(box.width <= 296 && box.height <= 256);
  assert.equal(
    await page
      .locator('[data-planr-annotation-composer]')
      .evaluate((form) => getComputedStyle(form).overflowY),
    'auto',
  );
  await page.getByRole('button', { name: 'Close new comment', exact: true }).click();
  assert.equal(await page.locator('[data-planr-annotation-composer]').count(), 0);
});

test('comment drafts suspend during product interaction and resume only on their original screen', {
  skip: !enabled,
}, async (t) => {
  const page = await browserFixture(t);
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  const field = page.locator('[data-planr-composer-comment]');
  await field.fill('Keep the original screen and pin');
  await field.evaluate((input) => input.setSelectionRange(5, 12));
  const before = await page.evaluate(() => fixture.annotations.snapshotDraft());
  await page.evaluate(() => fixture.stage.dispatch({ reviewMode: 'interact' }));
  assert.equal(await page.locator('[data-planr-annotation-composer]').count(), 0);
  assert.deepEqual(await page.evaluate(() => fixture.annotations.snapshotDraft()), before);
  await page.evaluate(() =>
    fixture.stage.dispatch({ reviewMode: 'comment', activeArtifactId: 'other' }),
  );
  assert.equal(
    await page.locator('[data-planr-annotation-composer]').count(),
    0,
    'A draft cannot move to another screen',
  );
  await page.evaluate(() => fixture.stage.dispatch({ activeArtifactId: 'screen' }));
  assert.equal(await field.inputValue(), before.comment);
  assert.deepEqual(await page.evaluate(() => fixture.annotations.snapshotDraft()), before);
  await page.getByRole('button', { name: 'Close new comment', exact: true }).click();
  await page.evaluate(() => {
    fixture.stage.dispatch({ reviewMode: 'interact' });
    fixture.stage.dispatch({ reviewMode: 'comment' });
  });
  assert.equal(
    await page.locator('[data-planr-annotation-composer]').count(),
    0,
    'Explicit dismissal does not reopen a discarded draft',
  );
  assert.equal(await page.evaluate(() => fixture.annotations.snapshotDraft()), null);
});

test('replies expand compactly, disable empty send, and preserve drafts, caret, filtering and refresh', {
  skip: !enabled,
}, async (t) => {
  const page = await browserFixture(t);
  const thread = page.locator('.planr-thread[data-planr-pin-id="first"]');
  assert.equal(await thread.locator('[data-planr-reply-form]').isVisible(), false);
  await thread.getByRole('button', { name: '+ Reply', exact: true }).click();
  const field = thread.getByLabel('Reply to thread');
  const send = thread.getByRole('button', { name: 'Send reply', exact: true });
  assert.equal(await send.isDisabled(), true);
  await field.fill('   ');
  assert.equal(await send.isDisabled(), true);
  await field.fill('Keep my reply draft');
  assert.equal(await send.isEnabled(), true);
  const sendBox = await send.boundingBox();
  assert.ok(sendBox.width <= 32 && sendBox.height <= 32);
  await field.evaluate((input) => input.setSelectionRange(2, 6));
  await page.evaluate(() => {
    const next = structuredClone(fixture.rail.getReview());
    next.pins[0].replies.push({
      id: 'remote',
      author: { name: 'Other reviewer' },
      comment: 'Incoming reply',
      createdAt: '2026-09-10T10:01:00Z',
    });
    fixture.rail.replaceReview(next);
  });
  assert.equal(await field.inputValue(), 'Keep my reply draft');
  assert.equal(
    await field.evaluate(
      (input) =>
        document.activeElement === input && input.selectionStart === 2 && input.selectionEnd === 6,
    ),
    true,
  );
  await page.evaluate(() =>
    fixture.rail.setPresentation({ filterPin: (pin) => pin.id === 'second' }),
  );
  assert.equal(await thread.count(), 0);
  await page.evaluate(() => fixture.rail.setPresentation({ filterPin: null }));
  assert.equal(await field.inputValue(), 'Keep my reply draft');
  await page.reload();
  await page.waitForFunction(() => window.fixture);
  assert.equal(await field.isVisible(), true);
  assert.equal(await field.inputValue(), 'Keep my reply draft');
  await field.focus();
  await page.keyboard.press('Escape');
  assert.equal(await field.isVisible(), false);
  assert.equal(
    await thread
      .getByRole('button', { name: '+ Reply', exact: true })
      .evaluate((button) => document.activeElement === button),
    true,
  );
  await thread.getByRole('button', { name: '+ Reply', exact: true }).click();
  assert.equal(await field.inputValue(), 'Keep my reply draft');
  await field.press('Control+Enter');
  assert.equal(await field.isVisible(), false);
  assert.equal(await thread.locator('.planr-reply p').last().textContent(), 'Keep my reply draft');
  assert.equal(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('fixture-review-drafts')).replies.first,
    ),
    '',
  );
});
