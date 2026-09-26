import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { digestArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { createReviewLedger } from '@openplanr/artifact/merge.mjs';
import { writeArtifactReviewState } from '@openplanr/artifact/review.mjs';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { atomicJson, currentDesign, renderDesignDocument } from '../lib/design/document.mjs';
import { designReviewKey, designReviewPath, startDesignReview } from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';

const engine = browserEngine();
const thread = (page, id) => page.locator(`.planr-thread[data-planr-pin-id="${id}"]`);
const settle = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

test(`reviewer workflow stays focused, compact and usable with large discussions (${engine})`, {
  timeout: 90000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-reviewer-workflow-'));
  let browser, review;
  try {
    const { file } = designFixture(root, {
      count: 2,
      frames: [{ id: 'desktop', label: 'Desktop', width: 1000, height: 720 }],
    });
    const env = { ...process.env, PLANR_HOME: join(root, 'home') };
    await renderDesignDocument(file);
    const current = currentDesign(file),
      reviewOf = digestArtifactEnvelope(current.envelope);
    const pins = Array.from({ length: 120 }, (_, index) => ({
      id: `pin-${String(index).padStart(3, '0')}`,
      artifactId: current.entries[index === 119 ? 1 : 0].artifactId,
      author: { name: index === 119 ? 'Remote author' : 'Alex' },
      intent: index === 0 ? 'fix' : 'improve',
      status: 'open',
      region: { x: 0.1 + (index % 8) * 0.08, y: 0.15 + (index % 7) * 0.08, w: 0, h: 0 },
      viewport: { width: 1000, height: 720 },
      comment:
        index === 119
          ? 'A separate screen comment.'
          : index === 118
            ? 'Busy discussion.'
            : `Clarify action ${index + 1}.`,
      replies:
        index === 119
          ? [
              {
                id: 'last-reply',
                author: { name: 'Reply author' },
                comment: 'Unique pagination needle',
                createdAt: '2026-09-11T11:00:00Z',
              },
            ]
          : index === 118
            ? Array.from({ length: 42 }, (_, number) => ({
                id: `history-${number}`,
                author: { name: 'Sam' },
                comment: `Earlier response ${number + 1}`,
                createdAt: '2026-09-11T11:00:00Z',
              }))
            : [],
      createdAt: '2026-09-11T10:00:00Z',
      updatedAt: '2026-09-11T10:00:00Z',
    }));
    const reviewState = {
      schemaVersion: '1.0.0',
      reviewId: 'local-review',
      reviewOf,
      decision: 'pending',
      overall: '',
      pins,
    };
    writeArtifactReviewState(
      designReviewPath(file, env),
      createReviewLedger({
        artifactId: designReviewKey(current.document),
        currentReviewOf: reviewOf,
        reviews: [{ review: reviewState, stale: false }],
      }),
    );
    const metadata = {
      version: 1,
      categories: {
        'pin-001': 'question',
        'pin-002': 'suggestion',
        'pin-003': 'change-request',
        'pin-004': 'blocker',
      },
      dispositions: {},
    };
    atomicJson(join(root, '.design/review-metadata.json'), {
      version: 1,
      byRevision: { 'local-review': metadata },
    });
    review = await startDesignReview(file, { env, port: 0 });
    browser = await launchBrowser({ engine });
    for (const audience of ['owner', 'reviewer']) {
      const evidence = process.env.OPENPLANR_REVIEW_EVIDENCE_DIR;
      if (evidence) await mkdir(evidence, { recursive: true });
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
      if (audience === 'reviewer')
        await context.addInitScript(
          ({ metadata }) => {
            // Exercise the same explicit audience and adapter seam used by the hosted
            // review without uploading a fixture or exposing owner HTTP capabilities.
            let supplied = {};
            Object.defineProperty(window, '__OPENPLANR_DESIGN_STUDIO_OPTIONS__', {
              configurable: true,
              get: () => supplied,
              set: (value) => {
                supplied = {
                  ...value,
                  audience: 'reviewer',
                  loadExperience: async () => ({ metadata, capabilities: { owner: false } }),
                  updateReviewMetadata: async (input) => {
                    metadata.categories[input.pinId] = input.category;
                    metadata.version++;
                    return { metadata };
                  },
                };
              },
            });
            window.__OPENPLANR_DESIGN_STUDIO_OPTIONS__ = {};
          },
          { metadata },
        );
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.setDefaultNavigationTimeout(30000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(review.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.locator('[data-design-ready="true"]').waitFor();
      await page.waitForFunction(
        () =>
          window.__openPlanrDesignExperience?.getState().metadata.categories['pin-003'] ===
          'change-request',
      );
      await page.waitForFunction(
        () => window.__openPlanrArtifactStage.review.getState().review?.pins.length === 120,
      );
      await page.evaluate(() => {
        window.__openPlanrDesignStudio.setPanels({ navOpen: false, reviewOpen: true });
        window.__openPlanrDesignStudio.fitSelection();
      });
      assert.equal(
        await page.locator('.planr-shell').getAttribute('data-design-audience'),
        audience,
      );
      assert.equal(
        await page.getByRole('tab', { name: 'Inspect', exact: true }).count(),
        audience === 'owner' ? 1 : 0,
      );
      assert.equal(
        await page.locator('[data-design-inspect-mode]').count(),
        audience === 'owner' ? 1 : 0,
      );
      assert.equal(
        await page.locator('.design-direction-review').isVisible(),
        audience === 'owner',
      );
      assert.equal(
        await page.locator('[data-design-verification]').isVisible(),
        audience === 'owner',
      );
      assert.equal(await page.locator('.planr-thread[data-planr-compact="true"]').count(), 40);
      await page.getByRole('combobox', { name: 'Review scope', exact: true }).selectOption('all');
      assert.equal(await page.locator('.planr-thread').count(), 40);
      assert.match(await page.locator('[data-planr-threads-more]').textContent(), /40 of 120/);
      assert.match(await thread(page, 'pin-000').textContent(), /Fix/);
      assert.doesNotMatch(await thread(page, 'pin-000').textContent(), /Blocker/);
      await thread(page, 'pin-000')
        .getByRole('button', { name: 'Change comment type: Fix', exact: true })
        .click();
      const legacyPicker = page.getByRole('radiogroup', { name: 'Comment type', exact: true });
      await legacyPicker.waitFor();
      assert.equal(
        await page.getByRole('button', { name: 'Save type', exact: true }).isDisabled(),
        true,
        'legacy intent requires an explicit new category choice',
      );
      assert.equal(
        await legacyPicker
          .getByRole('radio', { name: 'Question', exact: true })
          .getAttribute('tabindex'),
        '0',
        'legacy picker has a keyboard entry point',
      );
      assert.equal(
        await legacyPicker.locator('[aria-checked="true"]').count(),
        0,
        'legacy Fix is not silently reclassified',
      );
      await legacyPicker.getByRole('radio', { name: 'Question', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(
        await legacyPicker
          .getByRole('radio', { name: 'Suggestion', exact: true })
          .getAttribute('aria-checked'),
        'true',
      );
      assert.equal(
        await page.getByRole('button', { name: 'Save type', exact: true }).isEnabled(),
        true,
      );
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(
        await thread(page, 'pin-000').getAttribute('data-design-category'),
        'fix',
        'cancel preserves original Fix intent',
      );
      const compactHeight = await thread(page, 'pin-000').evaluate(
        (value) => value.getBoundingClientRect().height,
      );
      assert.ok(
        compactHeight <= 180,
        `${audience} short comment card is compact (${compactHeight}px)`,
      );
      for (const theme of ['dark', 'light']) {
        await page.evaluate((theme) => window.__openPlanrDesignExperience.setTheme(theme), theme);
        const colors = await page
          .locator('.planr-thread .design-category-badge')
          .evaluateAll((values) =>
            ['question', 'suggestion', 'change-request', 'blocker'].map(
              (category) =>
                getComputedStyle(values.find((value) => value.dataset.designCategory === category))
                  .color,
            ),
          );
        assert.equal(new Set(colors).size, 4, `Four distinct category colors in ${theme}`);
        assert.ok(colors.every((value) => value !== 'rgba(0, 0, 0, 0)'));
      }
      if (evidence)
        await page.screenshot({
          path: join(evidence, `${engine}-${audience}-compact-desktop.png`),
        });
      await page.locator('[data-planr-threads-more]').click();
      assert.equal(await page.locator('.planr-thread').count(), 80);
      const search = page.getByRole('searchbox', { name: 'Search comments' });
      for (const query of ['Unique pagination needle', 'Reply author', 'Remote author']) {
        await search.fill(query);
        assert.equal(await page.locator('.planr-thread').count(), 1);
        assert.equal(
          await thread(page, 'pin-119').count(),
          1,
          'search reaches unloaded pages, replies and authors',
        );
      }
      await search.fill('Busy discussion');
      const busy = thread(page, 'pin-118');
      assert.equal(
        await busy.locator('.planr-reply').count(),
        2,
        'large discussions initially show the two latest replies',
      );
      await busy.locator('[data-planr-history-expand]').click();
      assert.equal(
        await busy.locator('.planr-reply').count(),
        22,
        'earlier replies expand in bounded groups',
      );
      await busy.locator('[data-planr-history-expand]').click();
      assert.equal(await busy.locator('.planr-reply').count(), 42);
      await search.fill('');
      assert.equal(
        await page.locator('.planr-thread').count(),
        40,
        'changing filters starts with a bounded page',
      );
      await thread(page, 'pin-000').locator('[data-planr-reply-toggle]').click();
      const reply = thread(page, 'pin-000').locator('textarea[name="reply"]');
      await reply.fill('Keep my unfinished reply.');
      await search.fill('Unique pagination needle');
      await search.fill('');
      assert.equal(await reply.inputValue(), 'Keep my unfinished reply.');
      assert.equal(await reply.isVisible(), true);
      await reply.focus();
      await reply.evaluate((value) => value.setSelectionRange(5, 9));
      await page.evaluate(() => {
        const api = window.__openPlanrArtifactStage.review,
          value = structuredClone(api.getState().review);
        value.pins[1].replies.push({
          id: 'incoming',
          author: { name: 'Sam' },
          comment: 'An incoming reply',
          createdAt: '2026-09-11T12:00:00Z',
        });
        api.replaceReview(value);
      });
      assert.equal(await reply.inputValue(), 'Keep my unfinished reply.');
      assert.deepEqual(
        await reply.evaluate((value) => [
          value === document.activeElement,
          value.selectionStart,
          value.selectionEnd,
        ]),
        [true, 5, 9],
      );
      await thread(page, 'pin-000').locator('[data-planr-reply-toggle]').click();

      await thread(page, 'pin-003')
        .getByRole('button', { name: 'Change comment type: Request change', exact: true })
        .click();
      await settle(page);
      assert.deepEqual(errors, [], 'comment type picker opens without runtime errors');
      const picker = page.getByRole('radiogroup', { name: 'Comment type', exact: true });
      await picker.waitFor();
      assert.deepEqual(await picker.getByRole('radio').allTextContents(), [
        'Question',
        'Suggestion',
        'Request change',
        'Blocker',
      ]);
      if (evidence)
        await page.screenshot({
          path: join(evidence, `${engine}-${audience}-category-desktop.png`),
        });
      await picker.getByRole('radio', { name: 'Request change', exact: true }).focus();
      await page.keyboard.press('Home');
      assert.equal(
        await picker
          .getByRole('radio', { name: 'Question', exact: true })
          .getAttribute('aria-checked'),
        'true',
      );
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      assert.equal(
        await picker
          .getByRole('radio', { name: 'Request change', exact: true })
          .getAttribute('aria-checked'),
        'true',
      );
      await page.keyboard.press('ArrowLeft');
      await page.getByRole('button', { name: 'Save type', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Comment type', exact: true })
        .waitFor({ state: 'detached' });
      assert.equal(
        await thread(page, 'pin-003').getAttribute('data-design-category'),
        'suggestion',
      );

      await page.evaluate(() => {
        window.__openPlanrArtifactStage.review.setIdentity({ name: 'Alex' });
        window.__openPlanrDesignStudio.selectScreen('screen-1');
        window.__openPlanrDesignStudio.fitSelection();
      });
      await page.getByRole('button', { name: 'Add comment', exact: true }).click();
      await page
        .locator('.planr-annotation-layer')
        .first()
        .click({ position: { x: 80, y: 80 } });
      const composer = page.locator('[data-planr-annotation-composer]');
      const composerPicker = composer.getByRole('radiogroup', {
        name: 'Comment type',
        exact: true,
      });
      await composerPicker.waitFor();
      assert.deepEqual(await composerPicker.getByRole('radio').allTextContents(), [
        'Question',
        'Suggestion',
        'Request change',
        'Blocker',
      ]);
      await composerPicker.getByRole('radio', { name: 'Request change', exact: true }).click();
      assert.equal(
        await composerPicker
          .getByRole('radio', { name: 'Request change', exact: true })
          .getAttribute('aria-checked'),
        'true',
      );
      await page.getByRole('button', { name: 'Close new comment', exact: true }).click();

      if (audience === 'reviewer') {
        await page.evaluate(() => {
          window.__OPENPLANR_DESIGN_STUDIO_OPTIONS__.updateReviewMetadata = async () => {
            throw new Error("Invalid design-workspace-event: $.publicKey: unknown property 'alg'");
          };
        });
        const pinsBefore = await page.locator('[data-planr-pin-id]').count();
        await page.getByRole('button', { name: 'Add comment', exact: true }).click();
        await page
          .locator('.planr-annotation-layer')
          .first()
          .click({ position: { x: 120, y: 120 } });
        await page
          .locator('[data-planr-composer-comment]')
          .fill('Keep the saved comment visible while its type retries.');
        await page.locator('[data-planr-composer-submit]').click();
        const status = page.locator('[data-experience-status]');
        await status
          .getByText(
            'Comment saved. Its type is waiting to sync. Retry when your connection is available.',
            { exact: true },
          )
          .waitFor();
        assert.doesNotMatch(await status.textContent(), /design-workspace-event|publicKey|alg/);
        assert.ok(
          (await page.locator('[data-planr-pin-id]').count()) > pinsBefore,
          'the saved comment stays visible when category sync is queued',
        );
        assert.equal(
          await page
            .getByRole('button', { name: 'Retry pending categories', exact: true })
            .isVisible(),
          true,
        );
      }

      await page.setViewportSize({ width: 760, height: 900 });
      await settle(page);
      await page.evaluate(() =>
        window.__openPlanrDesignStudio.setPanels({ navOpen: false, reviewOpen: true }),
      );
      await page.waitForFunction(() => {
        const rect = document.querySelector('.planr-review-rail').getBoundingClientRect();
        return (
          rect.width >= 300 && rect.width <= 360 && rect.left >= -1 && rect.right <= innerWidth + 1
        );
      });
      const narrow = await page.locator('.planr-review-rail').evaluate((value) => ({
        width: value.getBoundingClientRect().width,
        left: value.getBoundingClientRect().left,
        right: value.getBoundingClientRect().right,
        viewport: innerWidth,
        client: value.clientWidth,
        scroll: value.scrollWidth,
      }));
      assert.ok(
        narrow.width >= 300 &&
          narrow.width <= 360 &&
          narrow.left >= -1 &&
          narrow.right <= narrow.viewport + 1,
        `review is a bounded narrow-screen drawer: ${JSON.stringify(narrow)}`,
      );
      assert.ok(
        narrow.scroll <= narrow.client + 1,
        'review content does not overflow horizontally',
      );
      if (evidence)
        await page.screenshot({ path: join(evidence, `${engine}-${audience}-review-narrow.png`) });
      await thread(page, 'pin-003')
        .getByRole('button', { name: 'Change comment type: Suggestion', exact: true })
        .click();
      await picker.waitFor();
      const bounds = await page
        .getByRole('dialog', { name: 'Comment type', exact: true })
        .boundingBox();
      assert.ok(
        bounds.x >= 0 && bounds.x + bounds.width <= 760 && bounds.height <= 900,
        'category picker fits narrow viewport',
      );
      if (evidence)
        await page.screenshot({
          path: join(evidence, `${engine}-${audience}-category-narrow.png`),
        });
      await page.keyboard.press('Escape');
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser?.close();
    await review?.close();
    await rm(root, { recursive: true, force: true });
  }
});
