import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { FIXTURE_FONT_FAMILY, localFontDesign } from './local-font-fixture.mjs';
import { startDesignReview } from './studio-http-fixture.mjs';

const engine = browserEngine();
const SCREEN_TEXT = 'Keep the team focused';

async function productFrame(page) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const text = await frame
        .evaluate(() => document.body?.innerText ?? '')
        .catch((error) => {
          // Studio frames are replaced while it loads; any other failure is real.
          if (/detached|context was destroyed|navigat/iu.test(error.message)) return '';
          throw error;
        });
      if (text.includes(SCREEN_TEXT)) return frame;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`No frame rendered the product screen text "${SCREEN_TEXT}" within 30 s.`);
}

test(`a snapshotted font loads inside the sandboxed product frame (${engine})`, {
  timeout: 120000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-local-font-'));
  let browser, review;
  try {
    const { file } = localFontDesign(root);
    await renderDesignDocument(file);
    review = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      port: 0,
    });
    browser = await launchBrowser({ engine });
    const page = await browser.newPage();
    const origin = new URL(review.url).origin;
    const external = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith(origin) && !/^(data|blob|about):/u.test(url)) external.push(url);
    });
    await page.goto(review.url);
    const frame = await productFrame(page);
    const fonts = await frame.evaluate(async (family) => {
      await document.fonts.ready;
      return {
        faces: [...document.fonts].map(
          (face) => `${face.family.replaceAll('"', '')}:${face.status}`,
        ),
        available: document.fonts.check(`16px "${family}"`),
        body: getComputedStyle(document.body).fontFamily,
      };
    }, FIXTURE_FONT_FAMILY);

    assert.deepEqual(fonts.faces, [`${FIXTURE_FONT_FAMILY}:loaded`]);
    assert.equal(fonts.available, true);
    assert.match(fonts.body, new RegExp(`^"?${FIXTURE_FONT_FAMILY}"?,`, 'u'));
    assert.deepEqual(external, [], 'opening the design fetches nothing from the network');
  } finally {
    await browser?.close();
    await review?.close();
    await rm(root, { recursive: true, force: true });
  }
});
