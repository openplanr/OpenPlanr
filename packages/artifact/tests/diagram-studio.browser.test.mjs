import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { createDiagramDocument } from '../lib/artifact/diagram/model.mjs';
import { renderDiagram } from '../lib/artifact/diagram/runtime.mjs';
import { startDiagramReview } from '../lib/artifact/diagram-review.mjs';
import { contrastRatio } from '../lib/artifact/internal/contrast.mjs';

const enabled = process.env.PLANR_BROWSER_TESTS === '1';
async function fixture(t, viewport = { width: 1440, height: 960 }, inputDocument = null) {
  const root = await mkdtemp(join(tmpdir(), 'planr-native-diagram-'));
  const draft = JSON.parse(
    readFileSync(
      new URL('../fixtures/diagram/grammars/sequence.planr-diagram.json', import.meta.url),
    ),
  );
  delete draft.documentDigest;
  draft.title = 'Application delivery';
  draft.layout.detailTier = 'balanced';
  draft.nodes = ['Applicant', 'Application', 'Admissions CRM', 'Operations'].map((label, i) => ({
    ...draft.nodes[0],
    id: `actor-${i}`,
    label,
  }));
  draft.relations = Array.from({ length: 9 }, (_, i) => ({
    ...draft.relations[0],
    id: `message-${i}`,
    from: `actor-${i % 3}`,
    to: `actor-${(i % 3) + 1}`,
    label: `Message ${i + 1}: acknowledge and deliver the submitted application`,
  }));
  draft.events = ['Sign up', 'Application', 'Submit', 'Updates'].map((label, i) => ({
    id: `phase-${i}`,
    label,
    order: i,
    at: null,
  }));
  draft.accessibility.readingOrder = [
    ...draft.nodes.map((n) => n.id),
    ...draft.events.flatMap((event, i) => [
      event.id,
      ...draft.relations.slice(i * 3, i * 3 + 3).map((r) => r.id),
    ]),
  ];
  const doc = inputDocument ?? createDiagramDocument(draft);
  await renderDiagram(doc, { outputRoot: root });
  const session = await startDiagramReview(
    join(root, 'diagrams', doc.diagramId, `${doc.diagramId}.manifest.json`),
    { noOpen: true, env: { ...process.env, PLANR_HOME: join(root, 'home') } },
  );
  t.after(async () => {
    await session.close();
    await rm(root, { recursive: true, force: true });
  });
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(async () => {
    await browser.close();
    assert.deepEqual(errors, []);
  });
  await page.goto(session.url);
  await page.locator('[data-ready=true]').waitFor();
  return { page, session, root };
}
async function geometry(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.diagram-canvas'),
      scene = document.querySelector('.diagram-scene');
    return {
      canvas: canvas.getBoundingClientRect().toJSON(),
      scene: scene.getBoundingClientRect().toJSON(),
      transform: scene.style.transform,
      zoom: Number(document.querySelector('[data-zoom]').textContent.replace('%', '')),
      scroll: [canvas.scrollLeft, canvas.scrollTop],
      bodyWidth: document.body.scrollWidth,
      width: innerWidth,
    };
  });
}
async function settled(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

test('parallel graph messages preserve visible label bounds and separate native routes in Studio', {
  skip: !enabled,
}, async (t) => {
  const document = JSON.parse(
    readFileSync(
      new URL(
        '../fixtures/diagram/regressions/parallel-opposing.planr-diagram.json',
        import.meta.url,
      ),
    ),
  );
  const { page } = await fixture(t, { width: 1440, height: 960 }, document);
  await page.evaluate(() => window.document.fonts.ready);
  const labels = await page.locator('.diagram-drawing [data-relation-id]').evaluateAll((elements) =>
    elements.map((element) => {
      const text = element.querySelector('text').getBBox();
      const bounds = element.querySelector('rect').getBBox();
      const path = element.querySelector('path').getAttribute('d');
      return {
        text: { x: text.x, y: text.y, width: text.width, height: text.height },
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        path,
      };
    }),
  );
  assert.equal(labels.length, 4);
  assert.equal(new Set(labels.map(({ path }) => path)).size, 4);
  for (const { text, bounds } of labels) {
    assert.ok(
      text.x >= bounds.x && text.x + text.width <= bounds.x + bounds.width,
      'Actual text fits its allocated width',
    );
    assert.ok(
      text.y >= bounds.y && text.y + text.height <= bounds.y + bounds.height,
      'Actual text fits its allocated height',
    );
  }
  for (let a = 0; a < labels.length; a += 1) {
    for (let b = a + 1; b < labels.length; b += 1) {
      const left = labels[a].text,
        right = labels[b].text;
      assert.ok(
        left.x >= right.x + right.width ||
          right.x >= left.x + left.width ||
          left.y >= right.y + right.height ||
          right.y >= left.y + left.height,
        'Actual message text never overlaps',
      );
    }
  }
  const view = await geometry(page);
  assert.ok(view.scene.left >= view.canvas.left && view.scene.right <= view.canvas.right);
  assert.ok(view.scene.top >= view.canvas.top && view.scene.bottom < view.canvas.bottom);
  assert.equal(await page.locator('iframe').count(), 0);
});

test('native diagram fits the full scene, pans over content, zooms at the pointer and survives layout changes', {
  skip: !enabled,
}, async (t) => {
  const { page } = await fixture(t);
  assert.equal(await page.locator('iframe').count(), 0);
  assert.equal(await page.locator('.diagram-drawing > svg').count(), 1);
  let initial = await geometry(page);
  assert.ok(
    initial.scene.left >= initial.canvas.left && initial.scene.right <= initial.canvas.right,
  );
  assert.ok(
    initial.scene.top >= initial.canvas.top && initial.scene.bottom < initial.canvas.bottom - 75,
  );
  assert.equal(initial.bodyWidth, initial.width);
  await page.locator('[data-action=zoom-in]').focus();
  await page.keyboard.press('Space');
  await settled(page);
  assert.ok((await geometry(page)).zoom > initial.zoom, 'Space activates focused toolbar buttons');
  await page.locator('[data-action=fit]').click();
  await settled(page);
  const x = initial.scene.x + initial.scene.width / 2,
    y = initial.scene.y + initial.scene.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 90, y + 55, { steps: 8 });
  await page.mouse.up();
  await settled(page);
  let moved = await geometry(page);
  assert.ok(Math.abs(moved.scene.x - initial.scene.x - 90) < 1);
  assert.ok(Math.abs(moved.scene.y - initial.scene.y - 55) < 1);
  await page.mouse.move(x, y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -90);
  await page.keyboard.up('Control');
  await settled(page);
  let zoomed = await geometry(page);
  assert.ok(zoomed.zoom > moved.zoom);
  const ax = (x - moved.scene.x) / moved.scene.width,
    ay = (y - moved.scene.y) / moved.scene.height;
  assert.ok(Math.abs((x - zoomed.scene.x) / zoomed.scene.width - ax) < 0.005);
  assert.ok(Math.abs((y - zoomed.scene.y) / zoomed.scene.height - ay) < 0.005);
  await page.locator('[data-action=fit]').click();
  await settled(page);
  await page.locator('[data-action=review]').click();
  await settled(page);
  moved = await geometry(page);
  assert.ok(moved.scene.right <= moved.canvas.right + 1);
  await page.locator('[data-planr-close-feedback]').click();
  await page.setViewportSize({ width: 1180, height: 820 });
  await settled(page);
  moved = await geometry(page);
  assert.ok(moved.scene.right <= moved.canvas.right + 1);
  assert.deepEqual(moved.scroll, [0, 0]);
  const samples = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const values = [];
        let n = 0;
        const sample = () => {
          values.push(document.querySelector('.diagram-scene').style.transform);
          if (++n < 20) requestAnimationFrame(sample);
          else resolve(values);
        };
        sample();
      }),
  );
  assert.equal(new Set(samples).size, 1, 'Idle fit must not oscillate');
  await page.locator('[data-search]').fill('Message 9');
  await page.locator('[data-search]').press('Enter');
  await settled(page);
  assert.equal(
    await page.locator('[data-selected=true]').getAttribute('data-relation-id'),
    'message-8',
  );
  await page.locator('[data-action=present]').click();
  await settled(page);
  assert.equal(await page.locator('.diagram-drawing').isVisible(), true);
  assert.equal(await page.locator('[data-presentation-nav]').isVisible(), true);
  assert.equal(await page.locator('[data-chapter-label]').textContent(), 'Sign up');
  assert.equal(await page.locator('[data-chapter-progress]').textContent(), '1 of 4');
  assert.equal(await page.locator('[data-action=review]').isVisible(), false);
  const firstChapter = (await geometry(page)).transform;
  await page.locator('[data-action=next-chapter]').click();
  await settled(page);
  assert.equal(await page.locator('[data-chapter-label]').textContent(), 'Application');
  assert.equal(await page.locator('[data-chapter-progress]').textContent(), '2 of 4');
  assert.notEqual((await geometry(page)).transform, firstChapter);
  await page.keyboard.press('End');
  await settled(page);
  assert.equal(await page.locator('[data-chapter-label]').textContent(), 'Updates');
  assert.equal(await page.locator('[data-action=next-chapter]').isDisabled(), true);
  moved = await geometry(page);
  assert.ok(moved.scene.width > 50 && moved.scene.right <= moved.canvas.right + 1);
  await page.keyboard.press('Escape');
  await settled(page);
  assert.equal(await page.locator('.diagram-shell').getAttribute('data-present'), 'false');
  assert.equal(await page.locator('[data-presentation-nav]').isVisible(), false);
});

test('groups collapse semantic detail without changing the native scene or losing discoverability', {
  skip: !enabled,
}, async (t) => {
  const draft = JSON.parse(
    readFileSync(
      new URL('../fixtures/diagram/grammars/nested.planr-diagram.json', import.meta.url),
    ),
  );
  delete draft.documentDigest;
  const { page } = await fixture(t, { width: 1180, height: 820 }, createDiagramDocument(draft));
  await page.locator('[data-search]').fill('group-main');
  await page.locator('[data-search]').press('Enter');
  await settled(page);
  assert.equal(await page.locator('[data-element-kind]').textContent(), 'Group');
  const before = await geometry(page);
  const toggle = page.locator('[data-action=toggle-group]');
  assert.equal(await toggle.isVisible(), true);
  await toggle.click();
  await settled(page);
  assert.equal(await page.locator('[data-group-id=group-main]').getAttribute('data-collapsed'), '');
  assert.equal(await page.locator('[data-item-id=item-a]').getAttribute('data-group-hidden'), '');
  assert.equal(await page.locator('[data-item-id=item-b]').getAttribute('data-group-hidden'), '');
  assert.equal(
    await page
      .locator('[data-item-index]')
      .filter({ hasText: 'Nested containment A' })
      .evaluate((element) => element.hidden),
    true,
  );
  const collapsed = await geometry(page);
  assert.equal(collapsed.scene.width, before.scene.width);
  assert.equal(collapsed.scene.height, before.scene.height);
  assert.equal(await page.locator('iframe').count(), 0);
  await toggle.click();
  await settled(page);
  assert.equal(
    await page.locator('[data-group-id=group-main]').getAttribute('data-collapsed'),
    null,
  );
  assert.equal(await page.locator('[data-item-id=item-a]').getAttribute('data-group-hidden'), null);
  await page.locator('[data-search]').fill('');
  assert.equal(
    await page
      .locator('[data-item-index]')
      .filter({ hasText: 'Nested containment A' })
      .evaluate((element) => element.hidden),
    false,
  );
});

test('comments persist in diagram coordinates and exports retain source custody', {
  skip: !enabled,
}, async (t) => {
  const { page, session } = await fixture(t);
  await page.locator('[data-action=review]').click();
  await page.locator('[data-planr-reviewer-name]').fill('Studio test');
  await page.locator('[data-planr-close-feedback]').click();
  await page.locator('[data-action=comment]').click();
  await settled(page);
  const g = await geometry(page);
  await page.mouse.click(g.scene.x + g.scene.width * 0.55, g.scene.y + g.scene.height * 0.32);
  await page.locator('[data-planr-composer-comment]').fill('Clarify this message');
  await page.locator('[data-planr-composer-submit]').click();
  await page.getByText('Comments saved on this computer', { exact: true }).waitFor();
  const left = await page.locator('.planr-pin').evaluate((el) => el.style.left);
  await page.locator('[data-action=zoom-in]').click();
  await settled(page);
  assert.equal(await page.locator('.planr-pin').evaluate((el) => el.style.left), left);
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  assert.equal(await page.locator('.planr-pin').count(), 1);
  await page.locator('[data-action=review]').click();
  await page.locator('[data-planr-thread-focus]').click();
  await settled(page);
  const focused = await page.locator('.planr-pin').boundingBox(),
    canvas = await page.locator('.diagram-canvas').boundingBox();
  assert.ok(focused.x >= canvas.x && focused.x < canvas.x + canvas.width);
  const handoff = await (await fetch(`${session.url}api/diagram-feedback`)).json();
  assert.equal(handoff.coordinates.space, 'normalized-diagram');
  assert.equal(handoff.reviews[0].review.pins[0].comment, 'Clarify this message');
  const source = await fetch(`${session.url}download/json`);
  assert.equal(source.status, 200);
  assert.equal((await source.json()).kind, 'planr-diagram');
  const svg = await fetch(`${session.url}download/svg`);
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-disposition'), /attachment/);
  assert.equal((await fetch(`${session.url}download/not-a-format`)).status, 404);
  assert.equal(
    (
      await fetch(
        session.url.replace(/\/r\/[^/]+\/[^/]+\//, '/r/invalid/invalid/') + 'download/svg',
      )
    ).status,
    404,
  );
});

test('phone layout has usable controls, one viewport, and 16px input fields', {
  skip: !enabled,
}, async (t) => {
  const { page } = await fixture(t, { width: 390, height: 844 });
  const g = await geometry(page);
  assert.equal(g.bodyWidth, g.width);
  assert.ok(g.scene.left >= g.canvas.left && g.scene.right <= g.canvas.right + 1);
  assert.equal(await page.locator('.diagram-shell').getAttribute('data-outline-open'), 'false');
  const toolbar = await page.locator('.diagram-canvas-tools').boundingBox();
  assert.ok(toolbar.x >= 0 && toolbar.x + toolbar.width <= 390);
  await page.locator('[data-action=outline]').click();
  assert.equal(await page.locator('[data-search]').isVisible(), true);
  assert.ok(
    (await page
      .locator('[data-search]')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >= 16,
  );
  await page.locator('[data-search]').fill('Message 1');
  await page.locator('[data-search]').press('Enter');
  assert.equal(await page.locator('.diagram-shell').getAttribute('data-outline-open'), 'false');
  await page.locator('[data-action=review]').click();
  assert.ok(
    (await page
      .locator('[data-planr-reviewer-name]')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >= 16,
  );
  await page.locator('[data-planr-close-feedback]').click();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator('[data-action=fit]').click();
  await settled(page);
  assert.equal((await geometry(page)).bodyWidth, 844);
});

test('semantic selection, connection focus and anchored feedback share one stable coordinate space', {
  skip: !enabled,
}, async (t) => {
  const { page, session } = await fixture(t);
  await page.locator('[data-search]').fill('actor-0');
  await page.locator('[data-search]').press('Enter');
  await settled(page);
  assert.equal(await page.locator('[data-element-label]').textContent(), 'Applicant');
  assert.equal(await page.locator('[data-element-id]').textContent(), 'actor-0');
  await page.locator('[data-action=connections]').click();
  assert.equal(await page.locator('[data-item-id=actor-3]').getAttribute('data-dimmed'), '');
  assert.equal(await page.locator('[data-item-id=actor-1]').getAttribute('data-dimmed'), null);
  await page.locator('[data-action=comment-element]').click();
  await page.locator('[data-planr-composer-identity]').fill('Engineering reviewer');
  await page.locator('[data-planr-composer-comment]').fill('Document this actor responsibility.');
  await page.locator('[data-planr-composer-submit]').click();
  await page.getByText('Comments saved on this computer', { exact: true }).waitFor();
  await page.locator('.planr-pin[data-planr-anchor-status=resolved]').waitFor();
  const handoff = await (await fetch(`${session.url}api/diagram-feedback`)).json();
  assert.equal(handoff.requests[0].target.elementId, 'actor-0');
  assert.equal(handoff.requests[0].target.label, 'Applicant');
  assert.equal(handoff.requests[0].target.coordinates.space, 'normalized-element');
  assert.equal(handoff.handling.executionAuthorized, false);
  const before = await page.locator('.planr-pin').evaluate((el) => [el.style.left, el.style.top]);
  await page.locator('[data-action=zoom-in]').click();
  await settled(page);
  await page.waitForTimeout(500);
  assert.deepEqual(
    await page.locator('.planr-pin').evaluate((el) => [el.style.left, el.style.top]),
    before,
  );
  await page.locator('[data-planr-thread-focus]').click();
  assert.equal(
    await page.locator('[data-action=connections]').getAttribute('aria-pressed'),
    'false',
  );
  assert.match(await (await fetch(`${session.url}api/diagram-feedback.md`)).text(), /actor-0/);
  await page.reload();
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('.planr-pin[data-planr-anchor-status=resolved]').waitFor();
  assert.deepEqual(
    await page.locator('.planr-pin').evaluate((el) => [el.style.left, el.style.top]),
    before,
  );
  assert.equal(await page.locator('iframe').count(), 0);
});

test('primary controls preserve readable contrast through hover, press, open and keyboard focus', {
  skip: !enabled,
}, async (t) => {
  const { page } = await fixture(t);
  const exportButton = page.locator('.diagram-export summary');
  const pan = page.locator('[data-action=pan]');
  const read = async (locator, label) => {
    const colors = await locator.evaluate((el) => {
      const css = getComputedStyle(el);
      return {
        foreground: css.color,
        background: css.backgroundColor,
        outline: css.outlineStyle,
        outlineWidth: parseFloat(css.outlineWidth),
      };
    });
    assert.ok(
      contrastRatio(colors.foreground, colors.background) >= 4.5,
      `${label}: ${JSON.stringify(colors)}`,
    );
    return colors;
  };
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => (document.documentElement.dataset.planrTheme = theme), theme);
    await page.mouse.move(400, 80);
    const normal = await read(exportButton, `${theme} export normal`);
    await exportButton.hover();
    const hovered = await read(exportButton, `${theme} export hover`);
    assert.notEqual(normal.background, hovered.background);
    await page.mouse.down();
    await read(exportButton, `${theme} export pressed`);
    await page.mouse.up();
    assert.equal(await page.locator('.diagram-export').getAttribute('open'), '');
    await page.mouse.move(400, 80);
    await read(exportButton, `${theme} export open`);
    await exportButton.press('Escape');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const focused = await read(exportButton, `${theme} export keyboard focus`);
    assert.ok(focused.outlineWidth >= 2 && focused.outline !== 'none');
    await pan.hover();
    await read(pan, `${theme} selected tool hover`);
    await page.mouse.down();
    await read(pan, `${theme} selected tool pressed`);
    await page.mouse.up();
    await page.locator('[data-action=review]').click();
    await read(page.locator('[data-action=review]'), `${theme} open comments`);
    await page.locator('[data-planr-close-feedback]').click();
  }
});
