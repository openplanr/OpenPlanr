import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { currentDesign, renderDesignDocument } from '../lib/design/document.mjs';
import { designFixture } from './design-fixture.mjs';
import { startDesignReview } from './studio-http-fixture.mjs';

const engine = browserEngine();

test(`revision comparison requests only its selected views (${engine})`, {
  timeout: 60000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-comparison-demand-'));
  let browser, session;
  try {
    const { file } = designFixture(root, {
      count: 3,
      frames: [
        { id: 'desktop', label: 'Desktop', width: 1000, height: 720 },
        { id: 'mobile', label: 'Mobile', width: 390, height: 720 },
      ],
    });
    await renderDesignDocument(file);
    const before = currentDesign(file);
    const path = join(root, 'source/screen-1.html');
    await writeFile(
      path,
      (await readFile(path, 'utf8')).replace('12 active tasks', '13 active tasks'),
    );
    await renderDesignDocument(file);
    const after = currentDesign(file);
    assert.notEqual(before.revision, after.revision);
    session = await startDesignReview(file, {
      noOpen: true,
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
    });
    browser = await launchBrowser({ engine });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const selectedRequests = [];
    page.on('request', (request) => {
      if (request.method() !== 'POST' || !request.url().endsWith('/api/design-revisions')) return;
      const input = request.postDataJSON();
      if (input.artifactIds) selectedRequests.push(input);
    });
    await page.goto(session.url);
    await page.getByRole('button', { name: 'Revision history', exact: true }).click();
    await page.getByRole('button', { name: 'Compare latest revisions', exact: true }).click();
    await page.waitForFunction(() => {
      const frames = [...document.querySelectorAll('.design-comparison-card iframe')];
      return (
        frames.length === 2 &&
        frames.every((frame) => frame.srcdoc.includes('Content-Security-Policy'))
      );
    });
    assert.equal(selectedRequests.length, 2);
    assert.deepEqual(
      selectedRequests.map(({ revision }) => revision).sort(),
      [before.revision, after.revision].sort(),
    );
    const desktop = after.entries.find(
      ({ screenId, frameId }) => screenId === 'screen-1' && frameId === 'desktop',
    ).artifactId;
    assert.ok(
      selectedRequests.every(
        ({ artifactIds }) => artifactIds.length === 1 && artifactIds[0] === desktop,
      ),
    );
    const initial = await page
      .locator('.design-comparison-card iframe')
      .evaluateAll((frames) => frames.map((frame) => frame.srcdoc));
    assert.match(initial[0], /12 active tasks/);
    assert.match(initial[1], /13 active tasks/);
    await page.getByLabel('Comparison frame', { exact: true }).selectOption('mobile');
    const mobile = after.entries.find(
      ({ screenId, frameId }) => screenId === 'screen-1' && frameId === 'mobile',
    ).artifactId;
    await page.waitForFunction((artifactId) => {
      const frames = [...document.querySelectorAll('.design-comparison-card iframe')];
      return (
        frames.length === 2 &&
        frames.every((frame) => frame.srcdoc.includes(`"artifactId":${JSON.stringify(artifactId)}`))
      );
    }, mobile);
    assert.equal(selectedRequests.length, 4);
    assert.ok(
      selectedRequests
        .slice(2)
        .every(({ artifactIds }) => artifactIds.length === 1 && artifactIds[0] === mobile),
    );
    assert.equal(await page.locator('.design-comparison-card iframe').count(), 2);
  } finally {
    await browser?.close();
    await session?.close();
    await rm(root, { recursive: true, force: true });
  }
});
