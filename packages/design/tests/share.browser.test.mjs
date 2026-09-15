import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { designFixture } from './design-fixture.mjs';
import { renderDesignDocument, currentDesign } from '../lib/design/document.mjs';
import { startDesignReview, readDesignFeedback } from '../lib/design/review.mjs';
import { syncDesignShare, manageDesignShare } from '../lib/design/share.mjs';

// Companion-service acceptance is explicitly opted into. Ordinary installs have
// no dependency on the external web source tree or its development tools.
const webRoot = process.env.OPENPLANR_WEB_ROOT;
const remoteBase = process.env.OPENPLANR_SHARE_TEST_BASE;
test('local Share UI publishes a permanent review usable by another browser after local shutdown', { skip: !webRoot, timeout: 150_000 }, async (t) => {
  const webRequire = createRequire(join(webRoot, 'package.json'));
  const { Miniflare } = webRequire('miniflare');
  const { build } = webRequire('esbuild');
  const { chromium } = createRequire(new URL('../../pipeline/package.json', import.meta.url))('playwright');
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'design-company-review-')));
  let shared = false;
  t.after(async () => {
    // Delete only this run's synthetic hosted review before removing custody.
    // Preserve private custody for a retry if remote cleanup itself fails.
    if (remoteBase && shared) await manageDesignShare(file, 'delete', { env });
    rmSync(temporary, { recursive: true, force: true });
  });
  const { file } = designFixture(join(temporary, 'project'));
  await renderDesignDocument(file);
  let baseUrl;
  if (remoteBase) {
    const remote = new URL(remoteBase);
    assert.equal(remote.protocol, 'https:', 'Remote acceptance requires HTTPS staging');
    assert.notEqual(remote.hostname, 'share.openplanr.dev', 'This test must not create reviews on production');
    assert.equal(remote.href, `${remote.origin}/`, 'Provide only the staging origin');
    baseUrl = remote.origin;
  } else {
    const built = await build({ entryPoints: [join(webRoot, 'share/src/index.ts')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
    const mf = new Miniflare({ modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-07-14', port: 0,
    durableObjects: { ROOMS: { className: 'ArtifactReviewRoom', useSQLite: true }, DESIGN_WORKSPACES: { className: 'DesignReviewWorkspace', useSQLite: true } },
    r2Buckets: ['DESIGN_REVISIONS'], kvNamespaces: ['PASTES'],
    ratelimits: { PASTE_RATE_LIMITER: { namespace_id: '26001', simple: { limit: 1000, period: 60 } } },
    serviceBindings: { ASSETS: async (request) => {
      const path = new URL(request.url).pathname;
      if (path.includes('..')) return new Response('', { status: 404 });
      try { return new Response(readFileSync(join(webRoot, 'share/public', path)), { headers: { 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/html' } }); }
      catch { return new Response('Missing asset', { status: 404 }); }
    } },
    });
    t.after(() => mf.dispose());
    baseUrl = (await mf.ready).origin;
  }
  const env = { ...process.env, PLANR_HOME: join(temporary, 'private'), OPENPLANR_SHARE_BASE: baseUrl };
  let local = await startDesignReview(file, { env });
  t.after(async () => { if (local) await local.close(); });
  const browser = await chromium.launch({ headless: true, ...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? { channel: 'chrome' } : {}) });
  t.after(() => browser.close());
  const ownerContext = await browser.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const owner = await ownerContext.newPage();
  owner.setDefaultTimeout(12_000);
  const failures = []; owner.on('pageerror', (error) => failures.push(error.message));
  await owner.goto(local.url); await owner.locator('[data-design-ready="true"]').waitFor();
  await owner.getByRole('button', { name: 'Share design', exact: true }).click();
  await owner.getByRole('button', { name: 'Create shared review', exact: true }).click();
  await owner.getByLabel('Design review link', { exact: true }).waitFor().catch(async (error) => {
    await owner.screenshot({ path: '/tmp/openplanr-local-share-failure.png' });
    throw new Error(`Local share creation: ${await owner.locator('[data-share-message]').textContent()}`, { cause: error });
  });
  const url = await owner.getByLabel('Design review link', { exact: true }).inputValue();
  shared = true;
  const accessResponse = owner.waitForResponse((response) => response.url().endsWith('/api/design-share') && response.request().postData()?.includes('access'));
  await owner.getByRole('button', { name: 'Copy access token', exact: true }).click();
  await owner.getByText('Access token copied. Send it separately from the link.', { exact: true }).waitFor();
  // Clipboard-read is intentionally forbidden by the studio Permissions Policy.
  // Observe the explicit Copy action's response instead of weakening that policy.
  const { token } = await (await accessResponse).json();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/u); assert.ok(!url.includes(token));
  await owner.getByRole('button', { name: 'Close sharing', exact: true }).click();
  const recipientContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const recipient = await recipientContext.newPage(); recipient.setDefaultTimeout(12_000); recipient.on('pageerror', (error) => failures.push(error.message));
  const requestUrls = []; recipient.on('request', (request) => requestUrls.push(request.url()));
  await recipient.goto(url); await recipient.getByLabel('Access token', { exact: true }).fill(token);
  await recipient.getByRole('button', { name: 'Open design', exact: true }).click();
  await recipient.locator('[data-design-ready="true"]').waitFor({ timeout: 25000 });
  await recipient.getByRole('button', { name: 'Prototype', exact: true }).click();
  const target = currentDesign(file).entries.find((entry) => entry.screenId === 'screen-1' && entry.frameId === 'desktop');
  const product = recipient.frameLocator(`iframe[data-planr-artifact-frame="${target.artifactId}"]`);
  const saveButton = product.getByRole('button', { name: 'Save workspace', exact: true });
  // Chromium's automation hit testing can double-apply transforms for an
  // opaque-origin iframe. Map the actual DOM coordinates into the board camera
  // and use a native mouse event, asserting both hit targets first.
  await saveButton.waitFor();
  const frameElement = recipient.locator(`iframe[data-planr-artifact-frame="${target.artifactId}"]`);
  const frameRect = await frameElement.boundingBox();
  const frameSize = await frameElement.evaluate((frame) => ({ width: frame.clientWidth, height: frame.clientHeight }));
  const buttonPoint = await saveButton.evaluate((button) => { const r = button.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === button }; });
  const mousePoint = { x: frameRect.x + buttonPoint.x * frameRect.width / frameSize.width, y: frameRect.y + buttonPoint.y * frameRect.height / frameSize.height };
  assert.equal(buttonPoint.hit, true);
  assert.equal(await recipient.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, mousePoint), 'IFRAME');
  await recipient.mouse.click(mousePoint.x, mousePoint.y).catch(async (error) => {
    await recipient.screenshot({ path: '/tmp/openplanr-hosted-source-failure.png' });
    const frames = await Promise.all(recipient.frames().map(async (frame) => ({ url: frame.url().slice(0, 80), text: (await frame.locator('body').innerText().catch(() => '')).slice(0, 1200) })));
    const attributes = await recipient.locator('iframe').evaluateAll((frames) => frames.map((frame) => [...frame.attributes].filter((a) => a.name !== 'src').map((a) => [a.name, a.value])));
    throw new Error(`Hosted source: ${JSON.stringify({ failures, frames, attributes })}`, { cause: error });
  });
  await product.getByRole('button', { name: 'Saved', exact: true }).waitFor();
  await recipient.getByRole('button', { name: 'Annotate', exact: true }).click();
  await recipient.locator(`[data-planr-annotation-layer="${target.artifactId}"]`).click({ position: { x: 100, y: 120 } });
  await recipient.locator('[data-planr-composer-identity]').fill('Company reviewer');
  await recipient.locator('[data-planr-composer-comment]').fill('Keep this action visible on small screens.');
  await recipient.locator('[data-planr-composer-submit]').click();
  await recipient.getByText('Feedback saved', { exact: true }).waitFor({ timeout: 15000 });
  await recipient.getByPlaceholder('Add a reply…').fill('The existing interaction works well.');
  await recipient.getByRole('button', { name: 'Reply', exact: true }).click();
  await recipient.getByText('Feedback saved', { exact: true }).waitFor({ timeout: 15000 });
  await syncDesignShare(file, { env });
  let feedback = readDesignFeedback(file, env);
  assert.equal(feedback.pins.length, 1); assert.equal(feedback.pins[0].author.name, 'Company reviewer');
  assert.equal(feedback.pins[0].replies.length, 1);
  const pinId = feedback.pins[0].id;
  assert.equal(feedback.ledger.reviews[0].review.decision, 'pending');
  await recipient.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  await recipient.getByRole('button', { name: 'Next', exact: true }).click();
  await recipient.getByRole('button', { name: 'Canvas', exact: true }).click();
  for (const entry of currentDesign(file).entries) {
    await recipient.locator(`iframe[data-planr-artifact-frame="${entry.artifactId}"][data-planr-bridge-trusted="true"]`).waitFor();
    await recipient.frameLocator(`iframe[data-planr-artifact-frame="${entry.artifactId}"]`).getByRole('heading', { level: 1 }).waitFor();
  }
  await recipient.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await recipient.screenshot({ path: '/tmp/openplanr-permanent-company-review.png' });
  const source = join(temporary, 'project/source/screen-1.html');
  writeFileSync(source, readFileSync(source, 'utf8').replace('12 active tasks', '24 active tasks'));
  await renderDesignDocument(file);
  await owner.reload(); await owner.locator('[data-design-ready="true"]').waitFor();
  await owner.getByRole('button', { name: 'Share design', exact: true }).click();
  assert.equal(await owner.getByLabel('Design review link').inputValue(), url);
  await owner.getByRole('button', { name: 'Publish update', exact: true }).click();
  await owner.getByText('Changes saved.', { exact: true }).waitFor();
  await recipient.getByRole('button', { name: 'New revision available', exact: true }).waitFor({ timeout: 15000 });
  feedback = readDesignFeedback(file, env); assert.equal(feedback.pins[0].id, pinId); assert.equal(feedback.pins[0].stale, true);
  await recipient.getByRole('button', { name: 'New revision available', exact: true }).click();
  await recipient.locator('[data-design-ready="true"]').waitFor();
  assert.ok(!requestUrls.some((value) => value.includes(token)));
  // The service, assets and published review must survive the laptop's local
  // studio stopping; use another clean browser context, not a loaded document.
  await local.close(); local = null;
  const offlineContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const offlineRecipient = await offlineContext.newPage();
  await offlineRecipient.goto(url); await offlineRecipient.getByLabel('Access token', { exact: true }).fill(token);
  await offlineRecipient.getByRole('button', { name: 'Open design', exact: true }).click();
  await offlineRecipient.locator('[data-design-ready="true"]').waitFor({ timeout: 25000 });
  await manageDesignShare(file, 'revoke', { env });
  await offlineRecipient.getByText('Access changed. Enter the current token to continue.', { exact: true }).waitFor({ timeout: 15000 });
  assert.deepEqual(failures, []);
});
