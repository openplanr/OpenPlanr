import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { digestArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { currentDesign, renderDesignDocument } from '../lib/design/document.mjs';
import { readDesignFeedback } from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';
import { startDesignReview } from './studio-http-fixture.mjs';

test('rating, direction and typed pin saves share a canonical revision across reload and restart', {
  timeout: 45000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-save-coordination-'));
  let browser, session;
  try {
    const { file } = designFixture(root);
    await renderDesignDocument(file);
    const env = { ...process.env, PLANR_HOME: join(root, 'home') };
    const current = currentDesign(file);
    session = await startDesignReview(file, { env, port: 0 });
    browser = await launchBrowser({ engine: 'chromium' });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    page.setDefaultTimeout(8000);
    const errors = [],
      responses = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.request().method() !== 'GET' && response.url().includes('/api/'))
        responses.push({
          path: new URL(response.url()).pathname.split('/').at(-1),
          status: response.status(),
        });
    });
    await page.goto(session.url);
    await page.locator('[data-design-ready="true"]').waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(document.getElementById('planr-artifact-review-state').textContent).reviewOf,
      ),
      digestArtifactEnvelope(current.envelope),
      'the visible shell and canonical ledger use the same pooled-source identity',
    );
    await page.locator('[data-design-rating="4"]').click();
    await page.locator('[data-design-select-direction]').click();
    await page.locator('[data-planr-mode="comment"]').click();
    const artifactId = current.entries[0].artifactId;
    await page
      .locator(`[data-planr-annotation-layer="${artifactId}"]`)
      .click({ position: { x: 100, y: 120 } });
    const composer = page.locator('[data-planr-annotation-composer]');
    await composer.getByRole('radio', { name: 'Request change', exact: true }).click();
    await page.locator('[data-planr-composer-identity]').fill('Morgan');
    await page.locator('[data-planr-composer-comment]').fill('Clarify this primary action.');
    const categorySaved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/design-handoff') && response.request().method() === 'POST',
    );
    await page.locator('[data-planr-composer-submit]').click();
    assert.equal((await categorySaved).status(), 200);
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    await page.waitForFunction(() => !window.__openPlanrDesignStudio.getSaveState().dirty);
    assert.equal(await page.locator('[data-design-save-state]').textContent(), 'All changes saved');
    assert.equal(
      await page.getByRole('button', { name: 'Retry pending categories', exact: true }).isVisible(),
      false,
    );
    assert.equal(readDesignFeedback(file, env).pins.length, 1);
    assert.equal(readDesignFeedback(file, env).state.ratings.A, 4);
    assert.equal(readDesignFeedback(file, env).state.selectedVariant, 'A');

    await page.reload();
    await page.locator('[data-design-ready="true"]').waitFor();
    assert.equal(await page.locator('.planr-annotation-layer [data-planr-pin-id]').count(), 1);
    await session.close();
    session = await startDesignReview(file, { env, port: 0 });
    await page.goto(session.url);
    await page.locator('[data-design-ready="true"]').waitFor();
    const saved = readDesignFeedback(file, env);
    assert.equal(saved.pins.length, 1);
    assert.equal(saved.pins[0].comment, 'Clarify this primary action.');
    assert.equal(saved.pins[0].author.name, 'Morgan');
    assert.equal(saved.state.ratings.A, 4);
    assert.deepEqual(saved.state.preferences.selected, ['A']);
    assert.equal(await page.locator('.planr-annotation-layer [data-planr-pin-id]').count(), 1);
    assert.ok(responses.some(({ path }) => path === 'review'));
    assert.ok(
      responses.every(({ status }) => status === 200),
      JSON.stringify(responses),
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await session?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('a failed pin save preserves its draft and retries the comment before its category', {
  timeout: 45000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-save-failure-'));
  let browser, session;
  try {
    const { file } = designFixture(root, { count: 1 });
    await renderDesignDocument(file);
    const env = { ...process.env, PLANR_HOME: join(root, 'home') };
    session = await startDesignReview(file, { env, port: 0 });
    browser = await launchBrowser({ engine: 'chromium' });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    page.setDefaultTimeout(8000);
    let blocked = true,
      categoryRequests = 0;
    await page.route('**/api/review', async (route) => {
      if (blocked && route.request().method() === 'PUT') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'Review changed before this save.' }),
        });
      } else await route.continue();
    });
    page.on('request', (request) => {
      if (request.url().endsWith('/api/design-handoff') && request.method() === 'POST')
        categoryRequests++;
    });
    await page.goto(session.url);
    await page.locator('[data-design-ready="true"]').waitFor();
    await page.locator('[data-planr-mode="comment"]').click();
    await page
      .locator('.planr-annotation-layer')
      .first()
      .click({ position: { x: 100, y: 120 } });
    await page.locator('[data-planr-composer-identity]').fill('Morgan');
    await page.locator('[data-planr-composer-comment]').fill('Preserve this unsaved comment.');
    await page.locator('[data-planr-composer-submit]').click();
    const retry = page.getByRole('button', { name: 'Retry comment save', exact: true });
    await retry.waitFor({ state: 'visible' });
    assert.equal(readDesignFeedback(file, env).pins.length, 0);
    assert.equal(categoryRequests, 0, 'no category save is sent until its comment exists durably');
    assert.equal(
      await page.evaluate(() => window.__openPlanrDesignStudio.getSaveState().commentsPending),
      true,
    );
    assert.equal(await page.locator('[data-design-save-state]').textContent(), 'Comments unsaved');
    assert.equal(
      await page
        .getByText(
          'Comment is not saved yet. Your draft remains in this browser. Retry to save the comment and its type.',
          { exact: true },
        )
        .isVisible(),
      true,
    );
    assert.equal(
      await page
        .getByText(
          'Comment saved. Its type is waiting to sync. Retry when your connection is available.',
          { exact: true },
        )
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(() => {
        const values = Object.keys(localStorage)
          .filter((key) => key.endsWith('.review'))
          .map((key) => JSON.parse(localStorage.getItem(key)));
        return values.some(
          (value) =>
            value.unsaved &&
            value.review.pins.some((pin) => pin.comment === 'Preserve this unsaved comment.'),
        );
      }),
      true,
      'the failed comment remains recoverable from this browser draft',
    );

    blocked = false;
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/design-handoff') && response.request().method() === 'POST',
    );
    await retry.click();
    assert.equal((await saved).status(), 200);
    await page.waitForFunction(() => !window.__openPlanrDesignStudio.getSaveState().dirty);
    assert.equal(readDesignFeedback(file, env).pins.length, 1);
    assert.equal(readDesignFeedback(file, env).pins[0].comment, 'Preserve this unsaved comment.');
    assert.equal(categoryRequests, 1);
    assert.equal(
      await page.getByText('Comment and type saved.', { exact: true }).isVisible(),
      true,
    );
    assert.equal(
      await page.getByRole('button', { name: 'Retry pending categories', exact: true }).isVisible(),
      false,
    );
    assert.equal(await page.locator('[data-design-save-state]').textContent(), 'All changes saved');
  } finally {
    await browser?.close();
    await session?.close();
    await rm(root, { recursive: true, force: true });
  }
});
