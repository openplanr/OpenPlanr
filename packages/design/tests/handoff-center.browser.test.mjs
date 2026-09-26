import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { digestArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { createReviewLedger } from '@openplanr/artifact/merge.mjs';
import { writeArtifactReviewState } from '@openplanr/artifact/review.mjs';
import { atomicJson, currentDesign, renderDesignDocument } from '../lib/design/document.mjs';
import { designReviewKey, designReviewPath, startDesignReview } from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';

const engines = createRequire(new URL('../../pipeline/package.json', import.meta.url))(
  'playwright',
);
const engine = process.env.PLANR_BROWSER_ENGINE || 'chromium';

async function ownerFixture() {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-handoff-center-'));
  const { file } = designFixture(root, {
    count: 2,
    frames: [
      { id: 'desktop', label: 'Desktop', width: 1440, height: 1024 },
      { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
    ],
  });
  const env = { ...process.env, PLANR_HOME: join(root, 'home') };
  await renderDesignDocument(file);
  const current = currentDesign(file),
    reviewOf = digestArtifactEnvelope(current.envelope);
  const review = {
    schemaVersion: '1.0.0',
    reviewId: 'owner-review',
    reviewOf,
    decision: 'pending',
    overall: '',
    pins: [
      {
        id: 'primary-action',
        artifactId: current.entries[0].artifactId,
        author: { name: 'Morgan', id: 'morgan' },
        comment: 'Keep the primary action visible.',
        intent: 'improve',
        status: 'open',
        region: { x: 0.1, y: 0.2, w: 0, h: 0 },
        viewport: { width: 1440, height: 1024 },
        replies: [],
        createdAt: '2026-09-21T10:00:00Z',
        updatedAt: '2026-09-21T10:00:00Z',
      },
    ],
  };
  writeArtifactReviewState(
    designReviewPath(file, env),
    createReviewLedger({
      artifactId: designReviewKey(current.document),
      currentReviewOf: reviewOf,
      reviews: [{ review, stale: false }],
    }),
  );
  atomicJson(join(root, '.design/review-metadata.json'), {
    version: 1,
    byRevision: {
      'owner-review': {
        version: 1,
        categories: { 'primary-action': 'suggestion' },
        dispositions: {
          'primary-action': { disposition: 'accepted', reason: 'Include in implementation.' },
        },
      },
    },
  });
  atomicJson(join(root, '.design/verification', `${current.revision}.json`), {
    status: 'verified',
    revision: current.revision,
  });
  const server = await startDesignReview(file, {
    env,
    noOpen: true,
    clock: () => new Date('2026-09-21T12:00:00.000Z'),
  });
  const origin = new URL(server.url).origin;
  const headers = { 'content-type': 'application/json', 'x-openplanr-design': '1', origin };
  const request = async (route, input) => {
    const response = await fetch(
      `${server.url}api/${route}`,
      input === undefined ? {} : { method: 'POST', headers, body: JSON.stringify(input) },
    );
    const value = await response.json();
    assert.equal(response.ok, true, JSON.stringify(value));
    return value;
  };
  let handoff = await request('design-handoff', {
    action: 'draft',
    revision: current.revision,
    version: 0,
  });
  const content = structuredClone(handoff.draft.content);
  content.summary = 'The approved design is ready for implementation.';
  handoff = await request('design-handoff', {
    action: 'update',
    revision: current.revision,
    version: handoff.draft.version,
    content,
  });
  handoff = await request('design-handoff', {
    action: 'approve',
    revision: current.revision,
    version: handoff.draft.version,
    contentHash: handoff.draft.contentHash,
  });
  assert.equal(handoff.current, true);
  return { root, file, server };
}

test(`the five-step owner center preserves canvas context and prepares a separate Plan invocation (${engine})`, {
  timeout: 90000,
}, async () => {
  const fixture = await ownerFixture();
  let browser;
  try {
    browser = await engines[engine].launch({
      headless: true,
      ...(engine === 'chromium' &&
      existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        ? { channel: 'chrome' }
        : {}),
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [],
      remote = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== new URL(fixture.server.url).origin)
        remote.push(request.url());
    });
    await page.goto(fixture.server.url, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-design-ready="true"]').waitFor();
    await page.getByRole('button', { name: 'Prepare handoff' }).click();
    const center = page.getByRole('dialog', { name: 'Handoff Center' });
    await center.waitFor();
    await page.waitForFunction(
      () => window.__openPlanrDesignHandoffCenter?.getState().statuses.readiness === 'ready',
    );
    assert.match(await center.textContent(), /This design can move into implementation packaging/);
    assert.doesNotMatch(await center.textContent(), /sha256:|contentDigest|canonical/i);
    assert.equal(
      await page.locator('.planr-stage').isVisible(),
      true,
      'the design canvas remains mounted behind the owner panel',
    );

    await center.getByRole('button', { name: /3\. Implementation package/ }).click();
    await center.getByRole('button', { name: 'Save implementation package' }).click();
    await page.waitForFunction(
      () => window.__openPlanrDesignHandoffCenter?.getState().statuses.package === 'pass',
    );
    assert.match(await center.textContent(), /requirements/);
    assert.doesNotMatch(await center.textContent(), /sha256:|contentDigest|canonical/i);

    await center.getByRole('button', { name: /4\. Owner approval/ }).click();
    await center.getByRole('button', { name: 'Approve exact package' }).click();
    await page.waitForFunction(
      () => window.__openPlanrDesignHandoffCenter?.getState().statuses.approval === 'pass',
    );
    await center.getByRole('button', { name: /5\. Continue to Plan/ }).click();
    await center.getByRole('button', { name: 'Prepare Plan handoff' }).click();
    await center.getByText('$planr:plan operations', { exact: true }).waitFor();
    assert.match(
      await center.textContent(),
      /No planning files, agents, Git state or Ship run were changed/,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(remote, []);

    await center.getByRole('button', { name: 'Close Handoff Center' }).click();
    assert.equal(await center.count(), 0);

    await page.setViewportSize({ width: 320, height: 720 });
    await page.evaluate(() => window.__openPlanrDesignHandoffCenter.open('plan'));
    await center.waitFor();
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      panel: document.querySelector('.design-handoff-center').getBoundingClientRect().toJSON(),
    }));
    assert.ok(geometry.scroll <= geometry.width + 1, JSON.stringify(geometry));
    assert.ok(
      geometry.panel.left >= -1 && geometry.panel.right <= geometry.width + 1,
      JSON.stringify(geometry),
    );
    const targets = await center.locator('button,input,textarea,summary').evaluateAll((values) =>
      values
        .filter((value) => {
          const box = value.getBoundingClientRect();
          return box.width && box.height && box.top < innerHeight && box.bottom > 0;
        })
        .map((value) => ({
          label: value.getAttribute('aria-label') || value.textContent.trim(),
          height: value.getBoundingClientRect().height,
        })),
    );
    assert.ok(targets.length > 5);
    for (const target of targets)
      assert.ok(target.height >= 44, `${target.label}: ${target.height}`);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 720 });
      const fit = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        panel: document.querySelector('.design-handoff-center').getBoundingClientRect().toJSON(),
      }));
      assert.ok(
        fit.scroll <= fit.width + 1 && fit.panel.left >= -1 && fit.panel.right <= fit.width + 1,
        JSON.stringify(fit),
      );
    }
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    assert.equal(
      await center.evaluate(
        (value) => getComputedStyle(value.querySelector('button')).transitionDuration,
      ),
      '0s',
    );

    const readinessCases = [
      ['ready', 'All current design evidence is ready.', 'pass'],
      ['attention', 'A non-blocking review decision needs attention.', 'attention'],
      ['blocked', 'A blocking review decision remains.', 'blocked'],
      ['stale', 'The approved review belongs to an earlier revision.', 'stale'],
    ];
    for (const [status, message, checkStatus] of readinessCases) {
      await page.evaluate(
        async ({ status, message, checkStatus }) => {
          const options = window.__OPENPLANR_DESIGN_STUDIO_OPTIONS__;
          options.loadReadiness = async () => ({
            ok: true,
            digest: `sha256:${'a'.repeat(64)}`,
            readiness: {
              kind: 'openplanr-design-handoff-readiness',
              schemaVersion: '1.0.0',
              scope: 'design-originated',
              authority: 'none',
              designId: 'operations',
              sourceRevision: `sha256:${'b'.repeat(64)}`,
              selectedVariant: 'A',
              status,
              continuation: { action: 'prepare-plan', available: status === 'ready' },
              blockers: status === 'blocked' ? ['review'] : [],
              nextActions: [],
              evidence: [],
              checks: [
                {
                  id: 'review-freshness',
                  status: checkStatus,
                  message,
                  evidenceRefs: [],
                  ...(checkStatus === 'pass'
                    ? {}
                    : { recoveryAction: { id: 'refresh-review', label: 'Refresh review' } }),
                },
              ],
            },
          });
          await window.__openPlanrDesignHandoffCenter.refresh();
          window.__openPlanrDesignHandoffCenter.open('readiness');
        },
        { status, message, checkStatus },
      );
      await center.getByText(message, { exact: true }).waitFor();
      assert.doesNotMatch(await center.textContent(), /sha256:|contentDigest|canonical/i);
    }
    await page.evaluate(async () => {
      window.__OPENPLANR_DESIGN_STUDIO_OPTIONS__.loadReadiness = async () => ({
        ok: true,
        readiness: {
          kind: 'openplanr-design-handoff-readiness-absence',
          schemaVersion: '1.0.0',
          status: 'absent',
          reason: 'unavailable',
          message: 'Readiness is unavailable for this ordinary planning fixture.',
          nextAction: { id: 'open-plan', label: 'Open Plan normally' },
        },
      });
      await window.__openPlanrDesignHandoffCenter.refresh();
    });
    await center
      .getByText('Readiness is unavailable for this ordinary planning fixture.', { exact: true })
      .waitFor();

    await page.evaluate(() => {
      window.__handoffOriginalImplementationLoader =
        window.__OPENPLANR_DESIGN_STUDIO_OPTIONS__.loadImplementationHandoff;
    });
    for (const message of [
      'Offline while loading the package.',
      'You are not authorized.',
      'Your session expired.',
      'The package changed in another tab.',
    ]) {
      await page.evaluate(async (message) => {
        window.__OPENPLANR_DESIGN_STUDIO_OPTIONS__.loadImplementationHandoff = async () => {
          throw new Error(message);
        };
        await window.__openPlanrDesignHandoffCenter.refresh();
        window.__openPlanrDesignHandoffCenter.open('package');
      }, message);
      await center.getByText(message, { exact: true }).waitFor();
    }
    await page.evaluate(async () => {
      const options = window.__OPENPLANR_DESIGN_STUDIO_OPTIONS__,
        original = window.__handoffOriginalImplementationLoader;
      const approved = await original();
      options.loadImplementationHandoff = async () => ({
        ...approved,
        current: { ...approved.current, status: 'superseded' },
      });
      await window.__openPlanrDesignHandoffCenter.refresh();
      window.__openPlanrDesignHandoffCenter.open('approval');
    });
    await center.getByRole('button', { name: /Owner approval: Superseded/ }).waitFor();
    await page.evaluate(async () => {
      const options = window.__OPENPLANR_DESIGN_STUDIO_OPTIONS__,
        approved = await window.__handoffOriginalImplementationLoader();
      options.loadImplementationHandoff = async () => ({
        ...approved,
        current: { ...approved.current, status: 'revoked' },
      });
      await window.__openPlanrDesignHandoffCenter.refresh();
    });
    await center.getByText('The current approval was revoked', { exact: true }).waitFor();
  } finally {
    await browser?.close();
    await fixture.server.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
