import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { currentDesign, renderDesignDocument } from '../lib/design/document.mjs';
import { readDesignFeedback } from '../lib/design/review.mjs';
import { manageDesignShare, syncDesignShare } from '../lib/design/share.mjs';
import { getWorkspace, readWorkspaceEvents } from '../lib/design/workspace-client.mjs';
import { designFixture } from './design-fixture.mjs';
import { startDesignReview } from './studio-http-fixture.mjs';

// Companion-service acceptance is explicitly opted into. Ordinary installs have
// no dependency on the external web source tree or its development tools.
const webRoot = process.env.OPENPLANR_WEB_ROOT;
const remoteBase = process.env.OPENPLANR_SHARE_TEST_BASE;
async function enterHostedReview(page) {
  const welcome = page.getByRole('dialog', { name: 'Welcome to this review', exact: true });
  await welcome.waitFor();
  await welcome.getByRole('button', { name: 'Explore freely', exact: true }).click();
  await page.getByRole('textbox', { name: 'Reviewer name', exact: true }).fill('Company reviewer');
  await page.getByRole('button', { name: 'Continue to review', exact: true }).click();
  await welcome.waitFor({ state: 'hidden' });
}
test('local Share UI publishes a permanent review usable by another browser after local shutdown', {
  skip: !webRoot,
  timeout: 150_000,
}, async (t) => {
  const webRequire = createRequire(join(webRoot, 'package.json'));
  const shareRoot = existsSync(join(webRoot, 'apps/share/src/index.ts'))
    ? join(webRoot, 'apps/share')
    : join(webRoot, 'share');
  const { Miniflare } = webRequire('miniflare');
  const { build } = webRequire('esbuild');
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
    assert.notEqual(
      remote.hostname,
      'share.openplanr.dev',
      'This test must not create reviews on production',
    );
    assert.equal(remote.href, `${remote.origin}/`, 'Provide only the staging origin');
    baseUrl = remote.origin;
  } else {
    const built = await build({
      entryPoints: [join(shareRoot, 'src/index.ts')],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
    });
    const mf = new Miniflare({
      modules: true,
      script: built.outputFiles[0].text,
      compatibilityDate: '2026-07-14',
      port: 0,
      durableObjects: {
        ROOMS: { className: 'ArtifactReviewRoom', useSQLite: true },
        DESIGN_WORKSPACES: { className: 'DesignReviewWorkspace', useSQLite: true },
      },
      r2Buckets: ['DESIGN_REVISIONS'],
      kvNamespaces: ['PASTES'],
      ratelimits: {
        PASTE_RATE_LIMITER: { namespace_id: '26001', simple: { limit: 1000, period: 60 } },
      },
      serviceBindings: {
        ASSETS: async (request) => {
          const path = new URL(request.url).pathname;
          if (path.includes('..')) return new Response('', { status: 404 });
          try {
            return new Response(readFileSync(join(shareRoot, 'public', path)), {
              headers: { 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/html' },
            });
          } catch {
            return new Response('Missing asset', { status: 404 });
          }
        },
      },
    });
    t.after(() => mf.dispose());
    baseUrl = (await mf.ready).origin;
  }
  const env = {
    ...process.env,
    PLANR_HOME: join(temporary, 'private'),
    OPENPLANR_SHARE_BASE: baseUrl,
  };
  let local = await startDesignReview(file, { env });
  t.after(async () => {
    if (local) await local.close();
  });
  const browser = await launchBrowser({ engine: 'chromium' });
  t.after(() => browser.close());
  const ownerContext = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const owner = await ownerContext.newPage();
  owner.setDefaultTimeout(12_000);
  const failures = [];
  owner.on('pageerror', (error) => failures.push(error.message));
  await owner.goto(local.url);
  await owner.locator('[data-design-ready="true"]').waitFor();
  await owner.getByRole('button', { name: 'Share design', exact: true }).click();
  await owner.getByRole('button', { name: 'Create shared review', exact: true }).click();
  await owner
    .getByLabel('Design review link', { exact: true })
    .waitFor()
    .catch(async (error) => {
      await owner.screenshot({ path: '/tmp/openplanr-local-share-failure.png' });
      throw new Error(
        `Local share creation: ${await owner.locator('[data-share-message]').textContent()}`,
        { cause: error },
      );
    });
  const url = await owner.getByLabel('Design review link', { exact: true }).inputValue();
  shared = true;
  const accessResponse = owner.waitForResponse(
    (response) =>
      response.url().endsWith('/api/design-share') &&
      response.request().postData()?.includes('access'),
  );
  await owner.getByRole('button', { name: 'Copy access token', exact: true }).click();
  await owner
    .getByText('Access token copied. Send it separately from the link.', { exact: true })
    .waitFor();
  // Clipboard-read is intentionally forbidden by the studio Permissions Policy.
  // Observe the explicit Copy action's response instead of weakening that policy.
  const { token } = await (await accessResponse).json();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
  assert.ok(!url.includes(token));
  await owner.getByRole('button', { name: 'Close sharing', exact: true }).click();
  const recipientContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const recipient = await recipientContext.newPage();
  recipient.setDefaultTimeout(12_000);
  recipient.on('pageerror', (error) => failures.push(error.message));
  const requestUrls = [];
  recipient.on('request', (request) => requestUrls.push(request.url()));
  await recipient.goto(url);
  await recipient.getByLabel('Access token', { exact: true }).fill(token);
  await recipient.getByRole('button', { name: 'Open design', exact: true }).click();
  await recipient.locator('[data-design-ready="true"]').waitFor({ timeout: 25000 });
  await enterHostedReview(recipient);
  await recipient.getByRole('button', { name: 'Prototype', exact: true }).click();
  const target = currentDesign(file).entries.find(
    (entry) => entry.screenId === 'screen-1' && entry.frameId === 'desktop',
  );
  const product = recipient.frameLocator(
    `iframe[data-planr-artifact-frame="${target.artifactId}"]`,
  );
  const saveButton = product.getByRole('button', { name: 'Save workspace', exact: true });
  // Chromium's automation hit testing can double-apply transforms for an
  // opaque-origin iframe. Map the actual DOM coordinates into the board camera
  // and use a native mouse event, asserting both hit targets first.
  await saveButton.waitFor();
  const frameElement = recipient.locator(
    `iframe[data-planr-artifact-frame="${target.artifactId}"]`,
  );
  await recipient.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const frameRect = await frameElement.boundingBox();
  const buttonPoint = await saveButton.evaluate((button) => {
    const r = button.getBoundingClientRect();
    return {
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      width: innerWidth,
      height: innerHeight,
      hit:
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') ===
        button,
    };
  });
  const mousePoint = {
    x: frameRect.x + (buttonPoint.x * frameRect.width) / buttonPoint.width,
    y: frameRect.y + (buttonPoint.y * frameRect.height) / buttonPoint.height,
  };
  assert.equal(buttonPoint.hit, true);
  assert.equal(
    await frameElement.evaluate(
      (frame, { x, y }) => document.elementFromPoint(x, y) === frame,
      mousePoint,
    ),
    true,
  );
  await recipient.mouse.click(mousePoint.x, mousePoint.y).catch(async (error) => {
    await recipient.screenshot({ path: '/tmp/openplanr-hosted-source-failure.png' });
    const frames = await Promise.all(
      recipient.frames().map(async (frame) => ({
        url: frame.url().slice(0, 80),
        text: (
          await frame
            .locator('body')
            .innerText()
            .catch(() => '')
        ).slice(0, 1200),
      })),
    );
    const attributes = await recipient
      .locator('iframe')
      .evaluateAll((frames) =>
        frames.map((frame) =>
          [...frame.attributes].filter((a) => a.name !== 'src').map((a) => [a.name, a.value]),
        ),
      );
    throw new Error(`Hosted source: ${JSON.stringify({ failures, frames, attributes })}`, {
      cause: error,
    });
  });
  await product
    .getByRole('button', { name: 'Saved', exact: true })
    .waitFor()
    .catch(async (error) => {
      await recipient.screenshot({ path: '/tmp/openplanr-hosted-pointer-failure.png' });
      const current = await frameElement.boundingBox();
      const camera = await recipient.evaluate(
        () => window.__openPlanrDesignStudio.getState().camera,
      );
      throw new Error(
        `Hosted source click: ${JSON.stringify({ frameRect, current, buttonPoint, mousePoint, camera, failures })}`,
        { cause: error },
      );
    });
  await recipient.getByRole('button', { name: 'Annotate', exact: true }).click();
  await recipient
    .locator(`[data-planr-annotation-layer="${target.artifactId}"]`)
    .click({ position: { x: 100, y: 120 } });
  const composerIdentity = recipient.locator('[data-planr-composer-identity]');
  if (await composerIdentity.isVisible()) await composerIdentity.fill('Company reviewer');
  await recipient
    .locator('[data-planr-composer-comment]')
    .fill('Keep this action visible on small screens.');
  await recipient.locator('[data-planr-composer-submit]').click();
  await recipient.getByText('Feedback saved', { exact: true }).waitFor({ timeout: 15000 });
  await recipient.locator('.planr-reply-toggle').first().click();
  await recipient
    .locator('[data-planr-reply-form] textarea')
    .first()
    .fill('The existing interaction works well.');
  // The prior pin's saved notice can remain visible while this reply is being
  // signed and durably queued. Bind readiness to this reply's committed event.
  const reviewUrl = new URL(url);
  const feedbackAccess = {
    id: reviewUrl.pathname.split('/').at(-1),
    baseUrl,
    token,
    ...(reviewUrl.searchParams.get('v') === '2' ? { schemaVersion: '2.0.0' } : {}),
  };
  await getWorkspace(feedbackAccess);
  const replyAcknowledgement = recipient.waitForResponse(
    async (response) => {
      const request = response.request();
      const endpoint = new URL(request.url());
      if (
        request.method() !== 'POST' ||
        endpoint.origin !== baseUrl ||
        !endpoint.pathname.endsWith(`/${feedbackAccess.id}/events`) ||
        !response.ok()
      )
        return false;
      const prepared = request.postDataJSON();
      const receipt = await response.json();
      const committedId = feedbackAccess.schemaVersion === '2.0.0' ? receipt.id : receipt.event?.id;
      if (
        committedId !== prepared.id ||
        !Number.isSafeInteger(receipt.sequence) ||
        receipt.sequence < 1
      )
        return false;
      const page = await readWorkspaceEvents(feedbackAccess, { after: receipt.sequence - 1 });
      return page.events.some(
        (event) =>
          event.id === committedId &&
          event.sequence === receipt.sequence &&
          event.revisionId === feedbackAccess.currentRevision &&
          event.payload.kind === 'review' &&
          event.payload.review.pins.some(
            (pin) =>
              pin.comment === 'Keep this action visible on small screens.' &&
              pin.replies.some((reply) => reply.comment === 'The existing interaction works well.'),
          ),
      );
    },
    { timeout: 15000 },
  );
  await recipient.getByRole('button', { name: 'Send reply', exact: true }).click();
  await replyAcknowledgement;
  await recipient.getByText('Feedback saved', { exact: true }).waitFor({ timeout: 15000 });
  await syncDesignShare(file, { env });
  let feedback = readDesignFeedback(file, env);
  assert.equal(feedback.pins.length, 1);
  assert.equal(feedback.pins[0].author.name, 'Company reviewer');
  assert.equal(feedback.pins[0].replies.length, 1);
  const pinId = feedback.pins[0].id;
  assert.equal(feedback.ledger.reviews[0].review.decision, 'pending');
  await recipient.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  await recipient.getByRole('button', { name: 'Next', exact: true }).click();
  await recipient.getByRole('button', { name: 'Canvas', exact: true }).click();
  for (const entry of currentDesign(file).entries) {
    await recipient
      .locator(
        `iframe[data-planr-artifact-frame="${entry.artifactId}"][data-planr-bridge-trusted="true"]`,
      )
      .waitFor();
    await recipient
      .frameLocator(`iframe[data-planr-artifact-frame="${entry.artifactId}"]`)
      .getByRole('heading', { level: 1 })
      .waitFor();
  }
  await recipient.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await recipient.screenshot({ path: '/tmp/openplanr-permanent-company-review.png' });
  const source = join(temporary, 'project/source/screen-1.html');
  writeFileSync(source, readFileSync(source, 'utf8').replace('12 active tasks', '24 active tasks'));
  await renderDesignDocument(file);
  await owner.reload();
  await owner.locator('[data-design-ready="true"]').waitFor();
  await owner.getByRole('button', { name: 'Share design', exact: true }).click();
  assert.equal(await owner.getByLabel('Design review link').inputValue(), url);
  await owner.getByRole('button', { name: 'Publish update', exact: true }).click();
  await owner.getByText('Changes saved.', { exact: true }).waitFor();
  await recipient
    .getByRole('button', { name: 'New revision available', exact: true })
    .waitFor({ timeout: 15000 });
  feedback = readDesignFeedback(file, env);
  assert.equal(feedback.pins[0].id, pinId);
  assert.equal(feedback.pins[0].stale, true);
  await recipient.getByRole('button', { name: 'New revision available', exact: true }).click();
  await recipient.locator('[data-design-ready="true"]').waitFor();
  assert.ok(!requestUrls.some((value) => value.includes(token)));
  // The service, assets and published review must survive the laptop's local
  // studio stopping; use another clean browser context, not a loaded document.
  await local.close();
  local = null;
  const offlineContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const offlineRecipient = await offlineContext.newPage();
  await offlineRecipient.goto(url);
  await offlineRecipient.getByLabel('Access token', { exact: true }).fill(token);
  await offlineRecipient.getByRole('button', { name: 'Open design', exact: true }).click();
  await offlineRecipient.locator('[data-design-ready="true"]').waitFor({ timeout: 25000 });
  await enterHostedReview(offlineRecipient);
  await manageDesignShare(file, 'revoke', { env });
  await offlineRecipient
    .getByText('Access changed. Enter the current token to continue.', { exact: true })
    .waitFor({ timeout: 15000 });
  assert.deepEqual(failures, []);
});
