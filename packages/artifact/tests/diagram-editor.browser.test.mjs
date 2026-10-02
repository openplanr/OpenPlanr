import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeBundle, sealBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import {
  browserEngine,
  FIREFOX_COOP_PAGE_PREFS,
  launchBrowser,
} from '../../../tests/support/browser-launcher.mjs';
import { createDiagramAuthoringStore } from '../lib/artifact/diagram/authoring/store.mjs';
import { startDiagramOwner } from '../lib/artifact/diagram/editor/local-owner.mjs';
import { mixedBundle } from './fixtures/diagram-editor-capacity.mjs';

const enabled = process.env.PLANR_BROWSER_TESTS === '1';
const options = { skip: !enabled, timeout: 60_000 };
async function fixture(
  t,
  { bundle, viewport = { width: 1440, height: 900 }, storageBlocked = false } = {},
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'planr-editor-ui-')));
  const store = createDiagramAuthoringStore({ root, slug: 'checkout' });
  if (bundle) await store.initialize(bundle, { transactionId: 'browser-fixture' });
  const owner = await startDiagramOwner({
    root,
    slug: 'checkout',
    noOpen: true,
    env: { ...process.env, PLANR_HOME: join(root, 'home') },
  });
  let browser;
  const errors = [],
    external = [];
  t.after(async () => {
    await browser?.close();
    await owner.close();
    await rm(root, { recursive: true, force: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, [], 'Local authoring requires no remote account or assets');
  });
  browser = await launchBrowser({ firefoxUserPrefs: FIREFOX_COOP_PAGE_PREFS });
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(7000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith(new URL(owner.baseUrl).origin)) external.push(request.url());
  });
  if (storageBlocked)
    await page.addInitScript(() => {
      for (const method of ['getItem', 'setItem', 'removeItem'])
        Storage.prototype[method] = () => {
          throw new DOMException('Storage disabled', 'SecurityError');
        };
    });
  await page.goto(owner.baseUrl, { timeout: 15_000 });
  await page.locator('[data-editor-svg]').waitFor();
  const read = async () => {
    const response = await fetch(`${owner.apiBase}read`, { headers: owner.headers });
    assert.equal(response.status, 200);
    return (await response.json()).bundle;
  };
  return { page, browser, owner, store, read };
}
const settle = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
const drawing = (page, id) => page.locator(`[data-editor-svg] [data-element-id="${id}"]`);
async function save(page) {
  await page.getByRole('button', { name: 'Save diagram', exact: true }).click();
  try {
    await page.locator('.de-save-state[data-state="saved"]').waitFor();
  } catch (error) {
    const state = await page.locator('.de-save-state').getAttribute('data-state');
    const alert = await page.locator('.de-alert').textContent();
    throw new Error(
      `Diagram did not reach saved state (state: ${state}; alert: ${alert || 'none'})`,
      { cause: error },
    );
  }
}
async function apply(page, fields) {
  for (const [name, value] of Object.entries(fields))
    await page.getByLabel(name, { exact: true }).fill(String(value));
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await settle(page);
}
async function create(page, name) {
  await page.getByRole('tab', { name: 'Shapes', exact: true }).click();
  await page.getByRole('button', { name: `Create ${name}`, exact: true }).click();
  await settle(page);
  return page
    .locator('[data-editor-svg] [data-element-id][data-selected="true"]')
    .getAttribute('data-element-id');
}
async function select(page, id, additive = false) {
  await drawing(page, id).click({ modifiers: additive ? ['Shift'] : [] });
  await settle(page);
}
async function expandInspectorSection(page, name) {
  const summary = page
    .locator('.de-properties-pane details.de-inspector-section > summary')
    .filter({ hasText: new RegExp(`^${name}$`, 'u') });
  assert.equal(await summary.count(), 1, `Expected one ${name} inspector section`);
  const section = summary.locator('..');
  if (!(await section.evaluate((node) => node.open))) await summary.click();
  return section;
}
/** Rendered text, field values and accessible labels in the editor that contain an object id. */
function exposedIds(page) {
  return page.evaluate(() => {
    const id = /[a-z]+-[0-9a-f]{8}-/u;
    const shell = document.querySelector('.planr-diagram-editor');
    const found = [];
    const text = document.createTreeWalker(shell, NodeFilter.SHOW_TEXT);
    for (let node = text.nextNode(); node; node = text.nextNode())
      if (id.test(node.data) && node.parentElement.checkVisibility()) found.push(node.data);
    for (const element of shell.querySelectorAll('*')) {
      if (!element.checkVisibility()) continue;
      for (const name of ['aria-label', 'title', 'placeholder'])
        if (id.test(element.getAttribute(name) ?? '')) found.push(element.getAttribute(name));
      if (element.matches('input, textarea') && id.test(element.value)) found.push(element.value);
    }
    return found;
  });
}

// The shell and every read/save below are served by the actual scoped owner.
// Test assertions inspect observable controls, SVG, and persisted paired content.
test(
  'blank authoring supports keyboard properties and retains IDs after local reload',
  options,
  async (t) => {
    const { page, read } = await fixture(t);
    const processId = await create(page, 'process');
    assert.ok(processId);
    await apply(page, {
      Label: 'Receive order',
      Description: 'Accept the submitted order.',
      X: 80,
      Y: 100,
      Width: 180,
      Height: 80,
    });
    const endId = await create(page, 'end');
    await apply(page, { Label: 'Order accepted', X: 400, Y: 100 });
    await select(page, processId);
    await select(page, endId, true);
    await page.getByRole('button', { name: 'Connect selection', exact: true }).click();
    await page.getByLabel('From', { exact: true }).selectOption(processId);
    await page.getByLabel('To', { exact: true }).selectOption(endId);
    await page.getByLabel('Connector label', { exact: true }).fill('Submit');
    await page.getByRole('button', { name: 'Create connector', exact: true }).click();
    await save(page);
    const saved = await read();
    assert.deepEqual(
      saved.document.nodes.map((node) => [node.id, node.label]),
      [
        [processId, 'Receive order'],
        [endId, 'Order accepted'],
      ],
    );
    assert.equal(saved.document.relations[0].from, processId);
    assert.equal(saved.document.relations[0].to, endId);
    assert.deepEqual(
      saved.presentation.elements.find((item) => item.elementId === processId).bounds,
      { x: 80, y: 100, width: 180, height: 80 },
    );
    await page.reload();
    await page.locator('[data-editor-svg]').waitFor();
    assert.match(await drawing(page, processId).textContent(), /Receive order/u);
    assert.equal(await drawing(page, endId).getAttribute('aria-label'), 'Order accepted');
    assert.deepEqual(await read(), saved);
    await select(page, processId);
    await page.getByLabel('Label', { exact: true }).focus();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Version V H');
    await page.getByRole('button', { name: 'Apply changes', exact: true }).focus();
    await page.keyboard.press('Space');
    await save(page);
    assert.equal(
      (await read()).document.nodes.find((node) => node.id === processId).label,
      'Version V H',
      'V/H shortcuts do not steal input or Space button activation',
    );
  },
);

test(
  'keyboard users can create, multi-select, connect, move, and undo without canvas pointing',
  options,
  async (t) => {
    const { page, read } = await fixture(t);
    await page.getByRole('tab', { name: 'Shapes', exact: true }).focus();
    await page.keyboard.press('Enter');
    for (const shape of ['process', 'end']) {
      await page.getByRole('button', { name: `Create ${shape}`, exact: true }).focus();
      await page.keyboard.press('Enter');
    }
    await page.getByRole('tab', { name: 'Outline', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('treeitem', { name: 'Process', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('treeitem', { name: 'End', exact: true }).focus();
    await page.keyboard.press('Shift+Enter');
    await page.getByRole('heading', { name: '2 objects selected' }).waitFor();
    assert.equal(
      await page
        .getByRole('treeitem', { name: 'End', exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.getByRole('button', { name: 'Connect selection', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('Connector label', { exact: true }).focus();
    await page.keyboard.type('Approve');
    await page.getByRole('button', { name: 'Create connector', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('treeitem', { name: 'Process', exact: true }).focus();
    await page.keyboard.press('Enter');
    const before = await drawing(
      page,
      await page.locator('[data-action=select-id]').first().getAttribute('data-id'),
    ).getAttribute('transform');
    await page.getByLabel('Diagram canvas', { exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ControlOrMeta+Z');
    await settle(page);
    await save(page);
    const saved = await read();
    assert.equal(saved.document.nodes.length, 2);
    assert.equal(saved.document.relations[0].label, 'Approve');
    assert.equal(await drawing(page, saved.document.nodes[0].id).getAttribute('transform'), before);
  },
);

test(
  'selection announcements refresh and dialogs return focus to their opener or canvas fallback',
  options,
  async (t) => {
    const { page } = await fixture(t, { bundle: makeBundle('process') });
    await page.evaluate(() => {
      const announcer = document.querySelector('.de-announcer');
      window.__diagramAnnouncements = [];
      new MutationObserver(() => window.__diagramAnnouncements.push(announcer.textContent)).observe(
        announcer,
        {
          childList: true,
          characterData: true,
          subtree: true,
        },
      );
    });
    await select(page, 'node-a');
    await select(page, 'node-b');
    await page.waitForFunction(
      () =>
        window.__diagramAnnouncements.filter((value) => value === '1 object selected.').length >= 2,
    );
    assert.ok(
      (await page.evaluate(() => window.__diagramAnnouncements)).includes(''),
      'An identical message is cleared before it is announced again',
    );

    const deleteButton = page.getByRole('button', { name: 'Delete…', exact: true });
    await deleteButton.focus();
    const opener = await deleteButton.elementHandle();
    await deleteButton.click();
    let dialog = page.getByRole('dialog', { name: 'Delete selection' });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const cancelFocus = await opener.evaluate((element) => ({
      restored: element === document.activeElement,
      active: document.activeElement?.outerHTML,
    }));
    assert.equal(
      cancelFocus.restored,
      true,
      `Cancel returns focus to the invoking control; active element: ${cancelFocus.active}`,
    );

    await deleteButton.focus();
    await page.keyboard.press('Enter');
    dialog = page.getByRole('dialog', { name: 'Delete selection' });
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    assert.equal(
      await opener.evaluate((element) => element === document.activeElement),
      true,
      'Escape returns focus to the invoking control',
    );

    await deleteButton.click();
    dialog = page.getByRole('dialog', { name: 'Delete selection' });
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    assert.equal(
      await page
        .getByLabel('Diagram canvas', { exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
      'Successful deletion falls back to the canvas after its opener leaves the document',
    );
  },
);

test(
  'canvas rendering follows the studio color scheme without changing diagram data',
  options,
  async (t) => {
    const { page, read } = await fixture(t, { bundle: makeBundle('process') });
    const original = await read();
    const cases = [
      {
        scheme: 'dark',
        theme: 'midnight',
        canvas: 'rgb(11, 16, 21)',
        fill: '#151e28',
        text: '#e5edf5',
        connector: '#94a3b8',
      },
      {
        scheme: 'light',
        theme: 'paper',
        canvas: 'rgb(255, 255, 255)',
        fill: '#f8fafc',
        text: '#0f172a',
        connector: '#475569',
      },
    ];
    for (const expected of cases) {
      await page.emulateMedia({ colorScheme: expected.scheme });
      await page.waitForFunction(
        (theme) => document.querySelector('.planr-diagram-editor')?.dataset.diagramTheme === theme,
        expected.theme,
      );
      await settle(page);
      const colors = await page.evaluate(() => ({
        canvas: getComputedStyle(document.querySelector('.de-canvas')).backgroundColor,
        fill: document.querySelector('[data-element-id="node-a"] rect')?.getAttribute('fill'),
        text: document.querySelector('[data-element-id="node-a"] text')?.getAttribute('fill'),
        connector: document
          .querySelector('[data-element-id="edge-a"] > path')
          ?.getAttribute('stroke'),
      }));
      assert.deepEqual(colors, {
        canvas: expected.canvas,
        fill: expected.fill,
        text: expected.text,
        connector: expected.connector,
      });
    }
    assert.deepEqual(
      await read(),
      original,
      'Color-scheme rendering never mutates the authored bundle',
    );
  },
);

test(
  'Save, Delete, the rail headers and canvas labels stay readable in both color schemes',
  options,
  async (t) => {
    const { page } = await fixture(t, {
      bundle: makeBundle('process'),
      viewport: { width: 1440, height: 700 },
    });
    const contrast = (foreground, background) => {
      const luminance = (rgb) => {
        const [r, g, b] = rgb.slice(0, 3).map((value) => {
          value /= 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (light + 0.05) / (dark + 0.05);
    };
    const probe = (selector) =>
      page
        .locator(selector)
        .first()
        .evaluate((element) => {
          const canvas = document.createElement('canvas').getContext('2d');
          const rgba = (value) => {
            canvas.clearRect(0, 0, 1, 1);
            canvas.fillStyle = value;
            canvas.fillRect(0, 0, 1, 1);
            return [...canvas.getImageData(0, 0, 1, 1).data];
          };
          const shell = getComputedStyle(element.closest('.planr-diagram-editor'));
          const style = getComputedStyle(element);
          let surface = [255, 255, 255, 255];
          for (let node = element; node; node = node.parentElement) {
            const fill = rgba(getComputedStyle(node).backgroundColor);
            if (fill[3] === 255) {
              surface = fill;
              break;
            }
          }
          return {
            text: rgba(style.color),
            background: rgba(style.backgroundColor),
            surface,
            opacity: Number(style.opacity),
            primary: rgba(shell.getPropertyValue('--de-primary').trim()),
            danger: rgba(shell.getPropertyValue('--de-danger').trim()),
            themeDanger: shell.getPropertyValue('--planr-color-danger').trim(),
          };
        });
    const save = '.de-bar [data-action="save"]';
    const schemes = ['light', 'dark'];
    for (const colorScheme of schemes) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await settle(page);
      assert.equal(await page.locator(save).isDisabled(), true);
      const clean = await probe(save);
      assert.equal(clean.opacity, 0.5, `${colorScheme}: a clean Save is a neutral ghost`);
      assert.equal(clean.background[3], 0, `${colorScheme}: a clean Save has no fill`);
    }

    await select(page, 'node-a');
    await page.getByLabel('Diagram canvas', { exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await settle(page);
    for (const colorScheme of schemes) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await settle(page);
      assert.equal(await page.locator(save).isEnabled(), true);
      const pending = await probe(save);
      assert.deepEqual(
        pending.background,
        pending.primary,
        `${colorScheme}: pending edits give Save the primary fill`,
      );
      assert.ok(contrast(pending.text, pending.background) >= 4.5, `${colorScheme} Save text`);
      const entry = await probe('.de-properties-pane [data-action="delete"]');
      assert.notDeepEqual(
        entry.text,
        entry.danger,
        `${colorScheme}: Delete… in the inspector is neutral`,
      );
      assert.ok(contrast(entry.text, entry.background) >= 4.5, `${colorScheme} Delete… text`);
      await page.locator('.de-properties-pane [data-action="delete"]').click();
      const remove = await probe('.de-dialog .de-danger');
      assert.equal(
        remove.themeDanger,
        { light: '#c53f4f', dark: '#f87171' }[colorScheme],
        `${colorScheme}: the local studio loads the artifact theme`,
      );
      assert.deepEqual(
        remove.text,
        remove.danger,
        `${colorScheme}: the confirmation is danger red`,
      );
      assert.equal(remove.background[3], 0, `${colorScheme}: the confirmation is outlined only`);
      assert.ok(contrast(remove.text, remove.surface) >= 4.5, `${colorScheme} Delete text`);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      for (const action of ['undo', 'more']) {
        const command = `.de-bar [data-action="${action}"]`;
        await page
          .getByLabel('Diagram canvas', { exact: true })
          .hover({ position: { x: 8, y: 8 } });
        const rest = await probe(command);
        await page.locator(command).hover();
        const hovered = await probe(command);
        assert.ok(
          hovered.background[3] > 0,
          `${colorScheme}: a hovered ${action} button has a fill`,
        );
        assert.notDeepEqual(
          hovered.background,
          rest.background,
          `${colorScheme}: hovering ${action} changes its fill`,
        );
      }
    }

    const inspector = page.locator('.de-right-content');
    assert.ok(
      await inspector.evaluate((node) => node.scrollHeight > node.clientHeight),
      'The single-object inspector overflows at this height',
    );
    await inspector.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await settle(page);
    const [left, right] = await page.locator('.de-panel-header').evaluateAll((headers) =>
      headers.map((header) => {
        const box = header.getBoundingClientRect();
        return { height: box.height, bottom: box.bottom };
      }),
    );
    assert.equal(left.height, 44);
    assert.deepEqual(right, left, 'Both rail headers keep one height and bottom edge');

    const fonts = await page
      .locator('[data-editor-svg] text')
      .first()
      .evaluate((label) => ({
        label: getComputedStyle(label).fontFamily,
        editor: getComputedStyle(label.closest('.planr-diagram-editor')).fontFamily,
      }));
    assert.equal(fonts.label, fonts.editor, 'Canvas labels use the editor font stack');
  },
);

test(
  'the command bar is one right-aligned cluster whose names match their visible labels',
  options,
  async (t) => {
    const { page } = await fixture(t, { bundle: makeBundle('process') });
    const bar = await page.locator('.de-bar').evaluate((node) => {
      const box = node.getBoundingClientRect();
      const controls = [...node.querySelectorAll('button, .de-save-state')].filter(
        (element) =>
          !element.closest('[role="menu"]') &&
          element.checkVisibility() &&
          element.getBoundingClientRect().width > 0,
      );
      const rects = controls.map((element) => element.getBoundingClientRect());
      return {
        left: Math.min(...rects.map((rect) => rect.left)) - box.left,
        right: box.right - Math.max(...rects.map((rect) => rect.right)),
        order: controls.map((element) => element.dataset.action ?? 'save-state'),
        names: controls
          .filter((element) => element.matches('button'))
          .map((element) => ({
            name: element.getAttribute('aria-label') ?? element.textContent.trim(),
            label: (element.querySelector('.de-button-label')?.textContent ?? '').trim(),
          })),
      };
    });
    assert.deepEqual(bar.order, [
      'outline',
      'save-state',
      'undo',
      'redo',
      'save-state', // React palette menu precedes the preserved action controls.
      'properties',
      'save',
      'host-action',
      'more',
    ]);
    assert.equal(
      await page.getByRole('button', { name: 'Share diagram', exact: true }).count(),
      1,
      'The local owner exposes native sharing beside Save',
    );
    assert.equal(bar.left, 16, 'The outline toggle sits on the 16px gutter');
    assert.equal(bar.right, 16, 'More sits on the 16px gutter');
    for (const { name, label } of bar.names)
      if (label) assert.ok(name.startsWith(label), `${name} is named by its visible label`);

    assert.equal(await page.locator('.de-panel-title').count(), 0, 'Rail headers hold tabs only');
    const underline = await page
      .locator('.de-left [role="tab"][aria-selected="true"]')
      .evaluate((tab) => getComputedStyle(tab).boxShadow);
    assert.match(underline, /inset/u, 'The selected rail tab is underlined');

    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Auto layout…', exact: true }).click();
    await page.getByRole('button', { name: 'Preview layout', exact: true }).waitFor();
  },
);

test('no inspector label truncates in the 288px rail', options, async (t) => {
  const { page } = await fixture(t, { bundle: makeBundle('process') });
  assert.equal(
    await page.locator('.de-right').evaluate((rail) => rail.getBoundingClientRect().width),
    288,
  );
  const outlineRow = (id) => page.locator(`[data-action=select-id][data-id="${id}"]`);
  // Every section is opened so each control is laid out at the rail width.
  const clipped = () =>
    page.locator('.de-right-content').evaluate((content) => {
      for (const details of content.querySelectorAll('details')) details.open = true;
      return [
        content,
        ...content.querySelectorAll(
          'button, summary, h2, h3, label > span, legend, .de-inspector-reason',
        ),
      ]
        .filter((node) => node.checkVisibility() && node.scrollWidth > node.clientWidth)
        .map(
          (node) =>
            `${node.textContent.trim().slice(0, 40)}: ${node.scrollWidth} > ${node.clientWidth}`,
        );
    });
  assert.deepEqual(await clipped(), [], 'Diagram details');
  for (const [state, ids] of [
    ['Lane', ['lane-a']],
    ['Group', ['group-a']],
    ['Shape', ['node-a']],
    ['Connector', ['edge-a']],
    ['Two shapes', ['node-a', 'node-b']],
    ['A shape and a connector', ['node-a', 'edge-a']],
  ]) {
    for (const [index, id] of ids.entries())
      await outlineRow(id).click({ modifiers: index ? ['Shift'] : [] });
    await settle(page);
    assert.deepEqual(await clipped(), [], state);
  }
});

test(
  'multiple selection is flat, explains unavailable actions and deletes inline',
  options,
  async (t) => {
    const { page, read } = await fixture(t, { bundle: makeBundle('process') });
    const pane = page.locator('.de-properties-pane');
    const outlineRow = (id) => page.locator(`[data-action=select-id][data-id="${id}"]`);
    await outlineRow('node-a').click();
    await outlineRow('node-b').click({ modifiers: ['Shift'] });
    await page.getByRole('heading', { name: '2 objects selected', exact: true }).waitFor();
    assert.equal(await pane.locator('details').count(), 0, 'Multiple selection has no accordions');
    assert.deepEqual(await pane.locator('h3').allTextContents(), [
      'Align',
      'Distribute',
      'Structure',
      'Clipboard',
      'Lock',
    ]);
    const align = await pane
      .locator('.de-inspector-group')
      .first()
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons.map((button) => ({
          label: button.textContent,
          name: button.getAttribute('aria-label'),
          width: button.getBoundingClientRect().width,
        })),
      );
    assert.deepEqual(
      align.map(({ label, name }) => [label, name]),
      [
        ['Left', 'Align left'],
        ['Center', 'Align centers'],
        ['Top', 'Align top'],
      ],
    );
    assert.ok(
      align.every(({ width }) => Math.abs(width - align[0].width) < 0.5),
      'Align buttons share their row equally',
    );
    assert.equal(
      await page.getByRole('button', { name: 'Align left', exact: true }).isEnabled(),
      true,
    );
    assert.equal(
      await page.getByRole('button', { name: 'Distribute horizontally', exact: true }).isDisabled(),
      true,
      'Two objects cannot be distributed',
    );
    await pane
      .getByText('Select at least three shapes or containers to distribute.', { exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Ungroup selection', exact: true }).isDisabled(),
      true,
    );
    await pane.getByText('Only groups and lanes can be ungrouped.', { exact: true }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Move to parent', exact: true }).isEnabled(),
      true,
      'The shapes have different parents, so moving them changes the diagram',
    );
    assert.equal(await pane.getByText('Danger zone').count(), 0);
    assert.equal(await pane.locator('.de-inspector-header code').count(), 0);
    await page.getByRole('button', { name: 'Delete 2 objects…', exact: true }).waitFor();

    await outlineRow('edge-a').click({ modifiers: ['Shift'] });
    await page.getByRole('heading', { name: '3 objects selected', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Move to parent', exact: true }).isDisabled(),
      true,
    );
    await pane.getByText('Connectors cannot become container members.', { exact: true }).waitFor();

    await outlineRow('node-b').click();
    await page.getByRole('heading', { name: 'Done', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Delete…', exact: true }).waitFor();
    await expandInspectorSection(page, 'Structure');
    const move = page.getByRole('button', { name: 'Move to parent', exact: true });
    const reason = pane.getByText('Choose a different parent to move.', { exact: true });
    assert.equal(await move.isDisabled(), true, 'Done is already in Operations');
    await reason.waitFor();
    await page.getByLabel('Parent', { exact: true }).selectOption('');
    assert.equal(await move.isEnabled(), true);
    assert.equal(await reason.isHidden(), true);
    await move.click();
    await save(page);
    assert.deepEqual((await read()).document.lanes.find((lane) => lane.id === 'lane-a').members, [
      'group-a',
    ]);

    await page.evaluate(() => {
      window.__copied = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text) => void window.__copied.push(text) },
      });
    });
    await expandInspectorSection(page, 'Advanced');
    await page.getByRole('button', { name: 'Copy reference', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('.de-announcer')?.textContent === 'Reference copied.',
    );
    assert.deepEqual(await page.evaluate(() => window.__copied), ['node-b']);
  },
);

test(
  'selected outline rows keep ink text and show a kind only when it adds to the label',
  options,
  async (t) => {
    const { page } = await fixture(t, { bundle: makeBundle('process') });
    await create(page, 'process');
    await page.getByRole('tab', { name: 'Outline', exact: true }).click();
    const rows = await page.locator('.de-outline-list [role="treeitem"]').evaluateAll((items) =>
      items.map((item) => {
        const style = (selector) => {
          const node = item.querySelector(selector);
          return node && getComputedStyle(node);
        };
        const shell = getComputedStyle(item.closest('.planr-diagram-editor'));
        const token = (name) => {
          const probe = document.createElement('span');
          probe.style.color = shell.getPropertyValue(name);
          document.body.append(probe);
          const value = getComputedStyle(probe).color;
          probe.remove();
          return value;
        };
        return {
          label: item.querySelector('.de-outline-label').textContent,
          kind: item.querySelector('.de-outline-meta')?.textContent ?? null,
          selected: item.getAttribute('aria-selected') === 'true',
          top: item.getBoundingClientRect().top,
          bottom: item.getBoundingClientRect().bottom,
          ink: style('.de-outline-label').color === token('--de-text'),
          chip: style('.de-outline-kind').backgroundColor === token('--de-primary'),
        };
      }),
    );
    assert.deepEqual(
      rows.map(({ label, kind }) => [label, kind]),
      [
        ['Operations', 'Lane'],
        ['Checkout service', 'Group'],
        ['Café ☕', 'Process'],
        ['Done', 'End'],
        ['Complete', 'Connector'],
        ['Keep the operation idempotent.', 'Note'],
        ['Process', null],
      ],
    );
    const selected = rows.filter((row) => row.selected);
    assert.deepEqual(
      selected.map(({ label, ink, chip }) => ({ label, ink, chip })),
      [{ label: 'Process', ink: true, chip: true }],
      'The new shape is selected with ink text and a solid accent kind chip',
    );
    assert.ok(
      rows.slice(1).every((row, index) => Math.round(row.top - rows[index].bottom) === 2),
      'Rows are separated by 2px',
    );
    const search = await page.getByLabel('Find in diagram', { exact: true }).evaluate((input) => ({
      icon: !!input.parentElement.querySelector('svg.de-search-icon'),
      background: getComputedStyle(input).backgroundImage,
    }));
    assert.deepEqual(search, { icon: true, background: 'none' });
  },
);

test('endpoint and parent pickers name objects as the outline does', options, async (t) => {
  const { page } = await fixture(t, { bundle: makeBundle('process') });
  const outlineRow = (id) => page.locator(`[data-action=select-id][data-id="${id}"]`);
  const choicesOf = (scope, name) =>
    scope
      .getByLabel(name, { exact: true })
      .evaluate((select) => [...select.options].map((option) => option.textContent));
  await outlineRow('node-b').click();
  await apply(page, { Label: '' });
  await outlineRow('group-a').click();
  await apply(page, { Label: '' });

  await outlineRow('edge-a').click();
  assert.deepEqual(
    await choicesOf(page, 'From'),
    ['Café ☕', 'End'],
    'A cleared label shows the kind',
  );
  assert.deepEqual(await choicesOf(page, 'To'), ['Café ☕', 'End']);
  await outlineRow('node-b').click();
  await expandInspectorSection(page, 'Structure');
  assert.deepEqual(await choicesOf(page, 'Parent'), ['Diagram root', 'Group', 'Operations']);

  await outlineRow('node-a').click();
  await outlineRow('node-b').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Connect selection', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect objects' });
  assert.deepEqual(await choicesOf(dialog, 'From'), ['Café ☕', 'End']);
  assert.deepEqual(await choicesOf(dialog, 'To'), ['Café ☕', 'End']);
});

test('a click on the inert command bar closes an open drawer', options, async (t) => {
  const { page } = await fixture(t, {
    bundle: makeBundle('process'),
    viewport: { width: 1024, height: 768 },
  });
  const shell = page.locator('.planr-diagram-editor');
  const open = (side) => shell.getAttribute(`data-${side}-open`);
  // A pointer click, because the inert bar control itself can no longer be targeted.
  const clickBar = async (action) => {
    const box = await page.locator(`.de-bar [data-action="${action}"]`).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await settle(page);
  };
  const layers = () =>
    page.evaluate(() => ({
      bar: getComputedStyle(document.querySelector('.de-bar'), '::after').backgroundColor,
      backdrop: getComputedStyle(document.querySelector('.de-drawer-backdrop')).backgroundColor,
    }));
  assert.match(await shell.getAttribute('data-layout'), /drawer/u);

  await page.locator('.de-bar [data-action="outline"]').click();
  assert.equal(await open('left'), 'true');
  const outline = await layers();
  assert.equal(outline.bar, outline.backdrop, 'The bar is dimmed with the canvas');
  assert.notEqual(outline.bar, 'rgba(0, 0, 0, 0)');
  await clickBar('save');
  assert.equal(await open('left'), 'false', 'A click on the dimmed bar closes the outline');

  await page.locator('.de-bar [data-action="properties"]').click();
  assert.equal(await open('right'), 'true');
  const inspector = await layers();
  assert.equal(inspector.bar, inspector.backdrop, 'The bar matches the undimmed canvas');
  await clickBar('properties');
  assert.equal(await open('right'), 'false', 'The pressed Inspector toggle closes its drawer');
  assert.equal(
    await page
      .locator('.de-bar [data-action="properties"]')
      .evaluate((control) => control === document.activeElement),
    true,
    'Focus returns to the toggle that opened the drawer',
  );
});

test(
  'new containers and lanes sit directly on the themed canvas without an opaque page wrapper',
  options,
  async (t) => {
    const { page, browser, owner, read } = await fixture(t);
    const containerId = await create(page, 'container');
    const laneId = await create(page, 'horizontal lane');
    for (const id of [containerId, laneId]) {
      const rectangle = drawing(page, id).locator('rect');
      assert.equal(await rectangle.getAttribute('fill'), 'none');
    }
    assert.equal(
      await page.locator('[data-editor-svg] > rect, [data-world] > rect').count(),
      0,
      'The editor does not draw a page background behind shapes',
    );
    await save(page);
    const persisted = await read();
    assert.ok(
      persisted.presentation.elements
        .filter((item) => [containerId, laneId].includes(item.elementId))
        .every((item) => item.appearance.fill === 'transparent'),
    );
    const stylesheet = await page.request.get(new URL('editor.css', owner.baseUrl).href);
    assert.equal(stylesheet.status(), 200);
    const host = await browser.newPage();
    await host.setContent(
      '<!doctype html><style>body{margin:19px;overflow-y:auto;font-family:Georgia}</style><div class="planr-diagram-editor">Embedded editor</div>',
    );
    await host.addStyleTag({ content: await stylesheet.text() });
    const hostStyle = await host.evaluate(() => ({
      bodyMargin: getComputedStyle(document.body).marginLeft,
      bodyOverflow: getComputedStyle(document.body).overflowY,
      editorFont: getComputedStyle(document.querySelector('.planr-diagram-editor')).fontFamily,
    }));
    assert.equal(hostStyle.bodyMargin, '19px', 'Importing editor CSS does not reset the host page');
    assert.equal(
      hostStyle.bodyOverflow,
      'auto',
      'Importing editor CSS does not lock host scrolling',
    );
    assert.match(
      hostStyle.editorFont,
      /Georgia/u,
      'The shared editor inherits its host typography',
    );
  },
);

test(
  'duplicate, container membership, lock feedback and deletion confirmation preserve semantic identities',
  options,
  async (t) => {
    const bundle = makeBundle('process');
    const { page, read } = await fixture(t, { bundle });
    await select(page, 'node-a');
    await select(page, 'node-b', true);
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await save(page);
    const copied = await read();
    const added = copied.document.nodes.filter(
      (node) => !bundle.document.nodes.some((old) => old.id === node.id),
    );
    assert.equal(added.length, 2);
    assert.ok(added.every((node) => node.id !== 'node-a' && node.id !== 'node-b'));
    const copiedEdge = copied.document.relations.find((edge) => edge.id !== 'edge-a');
    assert.ok(added.some((node) => node.id === copiedEdge.from));
    assert.ok(added.some((node) => node.id === copiedEdge.to));
    await page.locator('[data-action=select-id][data-id=node-a]').click();
    await expandInspectorSection(page, 'Constraints');
    await page.getByRole('checkbox', { name: 'Lock position', exact: true }).check();
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await save(page);
    const locked = await read();
    assert.equal(await page.getByLabel('X', { exact: true }).isDisabled(), true);
    await page.getByLabel('Diagram canvas', { exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('alert').filter({ hasText: /lock/iu }).waitFor();
    assert.equal((await read()).bundleDigest, locked.bundleDigest);
    await page.locator('[data-action=select-id][data-id=node-b]').click();
    await page.getByRole('button', { name: 'Delete…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /delete/iu });
    await dialog.waitFor();
    assert.match(await dialog.textContent(), /edge-a|Complete/u);
    assert.ok(
      (await read()).document.nodes.some((node) => node.id === 'node-b'),
      'Opening deletion preview does not delete',
    );
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Delete…', exact: true }).click();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await save(page);
    const deleted = await read();
    assert.ok(!deleted.document.nodes.some((node) => node.id === 'node-b'));
    assert.ok(!deleted.document.relations.some((edge) => edge.id === 'edge-a'));
    assert.ok(deleted.document.nodes.some((node) => node.id === 'node-a'));
  },
);

test(
  'connector endpoints, manual bends, label placement and nested lanes persist together',
  options,
  async (t) => {
    const { page, read } = await fixture(t, { bundle: makeBundle('process') });
    await select(page, 'edge-a');
    await page.getByRole('button', { name: 'Add bend', exact: true }).click();
    await apply(page, { 'Bend 2 Y': 115, 'Label X': 190, 'Label Y': 25 });
    let route = (await read()).presentation.elements.find(
      (item) => item.elementId === 'edge-a',
    ).route;
    assert.equal(route.points.length, 2, 'The new route remains pending until acknowledged');
    await page.getByLabel('Direction', { exact: true }).selectOption('both');
    await expandInspectorSection(page, 'Appearance');
    await page.getByLabel('Line style', { exact: true }).selectOption('dashed');
    await page.getByLabel('Routing', { exact: true }).selectOption('orthogonal');
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await save(page);
    let saved = await read();
    assert.equal(saved.document.relations[0].direction, 'both');
    assert.equal(
      saved.presentation.elements.find((item) => item.elementId === 'edge-a').appearance
        .strokeStyle,
      'dashed',
    );
    route = saved.presentation.elements.find((item) => item.elementId === 'edge-a').route;
    assert.equal(route.points.length, 5);
    assert.ok(
      route.points.every(
        (point, index, all) =>
          index === 0 || point.x === all[index - 1].x || point.y === all[index - 1].y,
      ),
    );
    assert.equal(
      saved.presentation.elements.find((item) => item.elementId === 'edge-a').label.y,
      25,
    );
    await page.locator('[data-action=select-id][data-id=lane-a]').click();
    await expandInspectorSection(page, 'Structure');
    await page.getByRole('button', { name: 'Arrange vertically…', exact: true }).click();
    await page.getByRole('button', { name: 'Preview layout', exact: true }).click();
    await page.getByRole('button', { name: 'Apply layout', exact: true }).click();
    await save(page);
    saved = await read();
    const lane = saved.presentation.elements.find((item) => item.elementId === 'lane-a').bounds;
    for (const id of ['group-a', 'node-b']) {
      const bounds = saved.presentation.elements.find((item) => item.elementId === id).bounds;
      assert.ok(
        bounds.x >= lane.x &&
          bounds.y >= lane.y &&
          bounds.x + bounds.width <= lane.x + lane.width &&
          bounds.y + bounds.height <= lane.y + lane.height,
      );
    }
    await page.reload();
    await page.locator('[data-editor-svg]').waitFor();
    assert.deepEqual(await read(), saved);
  },
);

test(
  '1,000-object canvas updates affected primitives and keeps one camera during targeted edits',
  options,
  async (t) => {
    const { page, read } = await fixture(t, { bundle: mixedBundle() });
    page.setDefaultTimeout(20_000);
    const stable = await drawing(page, 'node-599').elementHandle();
    const selected = await drawing(page, 'node-7').elementHandle();
    const before = await read();
    await page.locator('[data-action=select-id][data-id=node-7]').click();
    await page.getByLabel('Diagram canvas', { exact: true }).focus();
    const started = Date.now();
    await page.keyboard.press('ArrowRight');
    await settle(page);
    const responseMs = Date.now() - started;
    t.diagnostic(
      `1,000-object targeted keyboard gesture and two animation frames: ${responseMs} ms in ${browserEngine()}; this is not a release p95.`,
    );
    assert.equal(await stable.evaluate((element) => element.isConnected), true);
    assert.equal(
      await selected.evaluate((element) => element.isConnected),
      false,
      'Only affected node primitives are replaced',
    );
    await page.getByRole('button', { name: 'Pan', exact: true }).click();
    const canvas = await page.getByLabel('Diagram canvas', { exact: true }).boundingBox();
    const oldTransform = await page.locator('[data-world]').getAttribute('transform');
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width / 2 + 42, canvas.y + canvas.height / 2 + 26, {
      steps: 4,
    });
    await page.mouse.up();
    await settle(page);
    assert.notEqual(await page.locator('[data-world]').getAttribute('transform'), oldTransform);
    assert.equal(
      await stable.evaluate((element) => element.isConnected),
      true,
      'Camera motion keeps every object primitive stable',
    );
    assert.deepEqual(
      await read(),
      before,
      'Keyboard and camera changes are not persisted before Save',
    );
    await save(page);
    assert.equal((await read()).presentation.elements.length, 1_000);
  },
);

test(
  'completed drag is one undoable edit, cancellation writes nothing, and canvas primitives retain identity',
  options,
  async (t) => {
    const bundle = makeBundle('process');
    bundle.document.lanes = [];
    bundle.document.groups = [];
    bundle.document.laneOrder = [];
    bundle.document.accessibility.readingOrder = bundle.document.accessibility.readingOrder.filter(
      (id) => !['lane-a', 'group-a'].includes(id),
    );
    bundle.presentation.elements = bundle.presentation.elements.filter(
      (item) => !['lane-a', 'group-a'].includes(item.elementId),
    );
    sealBundle(bundle);
    const { page, store, read } = await fixture(t, { bundle });
    await select(page, 'node-a');
    const target = await drawing(page, 'node-a').boundingBox();
    const svg = await page.locator('[data-editor-svg]').elementHandle();
    const unchanged = await drawing(page, 'node-b').elementHandle();
    const before = await read();
    const revisions = (await store.history()).length;
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2 + 70, target.y + target.height / 2 + 40, {
      steps: 8,
    });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await settle(page);
    assert.equal(
      await page.getByRole('button', { name: 'Save diagram', exact: true }).isDisabled(),
      true,
    );
    assert.deepEqual(await read(), before);
    assert.equal((await store.history()).length, revisions);
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2 + 80, target.y + target.height / 2 + 50, {
      steps: 8,
    });
    await page.mouse.up();
    await settle(page);
    await save(page);
    const moved = await read();
    assert.notDeepEqual(moved.presentation, before.presentation);
    assert.equal(
      (await store.history()).length,
      revisions + 1,
      'Pointer samples commit one operation',
    );
    assert.equal(await svg.evaluate((element) => element.isConnected), true);
    assert.equal(await unchanged.evaluate((element) => element.isConnected), true);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await save(page);
    assert.deepEqual((await read()).presentation, before.presentation);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await save(page);
    assert.deepEqual((await read()).presentation, moved.presentation);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Auto layout…', exact: true }).click();
    await page.getByRole('button', { name: 'Preview layout', exact: true }).click();
    assert.deepEqual(
      (await read()).presentation,
      moved.presentation,
      'Layout preview never writes',
    );
    await page.getByRole('button', { name: 'Cancel layout', exact: true }).click();
    assert.deepEqual((await read()).presentation, moved.presentation);
  },
);

test(
  'a rejected resize reverts and reports, and the next edit and its undo still work',
  options,
  async (t) => {
    const { page, read } = await fixture(t, { bundle: makeBundle('process') });
    const before = await read();
    const button = (name) => page.getByRole('button', { name, exact: true });
    await select(page, 'node-a');
    const original = await drawing(page, 'node-a').boundingBox();
    const handle = await page
      .locator('[data-handle="resize"][data-handle-id="node-a"]')
      .boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 120, handle.y + handle.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
    await settle(page);
    const rejection = 'Container group-a must contain child node-a.';
    assert.equal(await page.locator('.de-alert').textContent(), rejection);
    assert.equal(await page.locator('.de-announcer').textContent(), rejection);
    assert.deepEqual(await drawing(page, 'node-a').boundingBox(), original, 'The preview reverts');
    assert.equal(await button('Save diagram').isDisabled(), true, 'Nothing was applied');
    assert.equal(await button('Undo').isDisabled(), true);

    await page.getByLabel('Diagram canvas', { exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await settle(page);
    assert.equal(await page.locator('.de-alert').isHidden(), true);
    await save(page);
    const moved = (await read()).presentation.elements.find((item) => item.elementId === 'node-a');
    const start = before.presentation.elements.find((item) => item.elementId === 'node-a');
    assert.deepEqual(moved.bounds, { ...start.bounds, x: start.bounds.x + 1 });

    await button('Undo').click();
    assert.equal(await button('Undo').isDisabled(), true, 'The nudge is the only undoable edit');
    assert.equal(await button('Redo').isDisabled(), false);
    await save(page);
    assert.deepEqual((await read()).presentation, before.presentation);
  },
);

test(
  'failed save, refresh recovery and blocked storage report actual durability',
  options,
  async (t) => {
    const { page, owner, read } = await fixture(t, { bundle: makeBundle('process') });
    await select(page, 'node-b');
    await apply(page, { Label: 'Pending confirmation' });
    await page.route(`${owner.apiBase}commit`, (route) => route.abort('failed'), { times: 1 });
    await page.getByRole('button', { name: 'Save diagram', exact: true }).click();
    await page.getByText(/Offline.*[Uu]nsaved/u).waitFor();
    assert.equal((await read()).document.nodes.find((node) => node.id === 'node-b').label, 'Done');
    await page.reload();
    await page.locator('[data-editor-svg]').waitFor();
    assert.equal(await drawing(page, 'node-b').getAttribute('aria-label'), 'Pending confirmation');
    await page
      .getByText(/recover/iu)
      .first()
      .waitFor();
    assert.equal(
      (await read()).document.nodes.find((node) => node.id === 'node-b').label,
      'Done',
      'Recovery is disclosed before explicit retry',
    );
    await save(page);
    assert.equal(
      (await read()).document.nodes.find((node) => node.id === 'node-b').label,
      'Pending confirmation',
    );
    const blocked = await fixture(t, { bundle: makeBundle('process'), storageBlocked: true });
    await blocked.page
      .getByText(/recovery.*unavailable|memory only|keep.*session open/iu)
      .first()
      .waitFor();
    await select(blocked.page, 'node-b');
    await apply(blocked.page, { Label: 'In memory' });
    assert.equal(await drawing(blocked.page, 'node-b').getAttribute('aria-label'), 'In memory');
    assert.equal(
      (await blocked.read()).document.nodes.find((node) => node.id === 'node-b').label,
      'Done',
    );
    await save(blocked.page);
    assert.equal(
      (await blocked.read()).document.nodes.find((node) => node.id === 'node-b').label,
      'In memory',
    );
  },
);

test('dirty property guard keeps keyboard focus on the draft field', options, async (t) => {
  const { page } = await fixture(t, { bundle: makeBundle('process') });
  await select(page, 'node-a');
  const label = page.getByLabel('Label', { exact: true });
  await label.fill('Unapplied checkout label');
  assert.equal(await label.evaluate((node) => node === document.activeElement), true);

  await drawing(page, 'node-b').click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Apply or revert property changes before selecting another object.' })
    .waitFor();
  assert.equal(
    await label.evaluate((node) => node === document.activeElement),
    true,
    'Blocked selection returns focus to the field containing the draft',
  );
  assert.equal(await drawing(page, 'node-a').getAttribute('data-selected'), 'true');
  assert.notEqual(await drawing(page, 'node-b').getAttribute('data-selected'), 'true');

  await page.getByRole('button', { name: 'Revert', exact: true }).click();
  await page.waitForFunction(() => {
    const alert = document.querySelector('.de-alert');
    return alert?.hidden && alert.textContent.trim() === '';
  });
  await drawing(page, 'node-b').click();
  assert.equal(
    await drawing(page, 'node-b').getAttribute('data-selected'),
    'true',
    'Selection proceeds after reverting the draft',
  );
  assert.equal(
    await page.locator('.de-alert').isHidden(),
    true,
    'The resolved draft warning does not remain exposed',
  );
});

test(
  'responsive drawers contain keyboard focus while the backdrop is active',
  options,
  async (t) => {
    const { page } = await fixture(t, {
      bundle: makeBundle('process'),
      viewport: { width: 1024, height: 768 },
    });
    const assertFocusContained = async (panel, direction = 'Tab') => {
      for (let index = 0; index < 24; index++) {
        await page.keyboard.press(direction);
        const focus = await panel.evaluate((node) => ({
          contained: node.contains(document.activeElement),
          active: document.activeElement?.outerHTML,
        }));
        assert.equal(
          focus.contained,
          true,
          `Focus left the open drawer after ${direction} at step ${index + 1}; active element: ${focus.active}`,
        );
      }
    };

    const outline = page.locator('#diagram-outline-panel');
    await page.getByRole('button', { name: 'Outline', exact: true }).click();
    await page.locator('.de-drawer-backdrop').waitFor();
    assert.equal(await outline.evaluate((node) => node.contains(document.activeElement)), true);
    await assertFocusContained(outline);
    await assertFocusContained(outline, 'Shift+Tab');
    await page.keyboard.press('Escape');

    const inspector = page.locator('#diagram-inspector-panel');
    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    await page.locator('.de-drawer-backdrop').waitFor();
    assert.equal(await inspector.evaluate((node) => node.contains(document.activeElement)), true);
    await assertFocusContained(inspector);
    await assertFocusContained(inspector, 'Shift+Tab');
  },
);

test(
  'crossing from desktop rails to responsive drawers moves focus out of hidden content',
  options,
  async (t) => {
    const { page } = await fixture(t, {
      bundle: makeBundle('process'),
      viewport: { width: 1440, height: 900 },
    });
    await select(page, 'node-a');
    const label = page.getByLabel('Label', { exact: true });
    await label.focus();
    assert.equal(await label.evaluate((node) => node === document.activeElement), true);

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForFunction(
      () =>
        document.querySelector('#diagram-inspector-panel')?.getAttribute('aria-hidden') === 'true',
    );
    await settle(page);
    const focus = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        isBody: active === document.body,
        hidden: Boolean(active?.closest('[inert], [aria-hidden="true"]')),
        interactive: Boolean(
          active?.matches('button, input, textarea, select, [role="application"], [role="tab"]'),
        ),
      };
    });
    assert.deepEqual(
      focus,
      { isBody: false, hidden: false, interactive: true },
      'Breakpoint transition leaves focus on an available editor control',
    );
  },
);

test(
  'outline and shapes tabs always reference persistent labelled tabpanels',
  options,
  async (t) => {
    const { page } = await fixture(t, { bundle: makeBundle('process') });
    const assertRelationships = async () => {
      const tabs = page.getByRole('tablist', { name: 'Left panel', exact: true }).getByRole('tab');
      assert.equal(await tabs.count(), 2);
      for (const tab of await tabs.all()) {
        const [id, controls] = await Promise.all([
          tab.getAttribute('id'),
          tab.getAttribute('aria-controls'),
        ]);
        assert.ok(id);
        assert.ok(controls);
        const panel = page.locator(`[id="${controls}"]`);
        assert.equal(
          await panel.count(),
          1,
          `${await tab.textContent()} controls one existing panel`,
        );
        assert.equal(await panel.getAttribute('role'), 'tabpanel');
        assert.equal(await panel.getAttribute('aria-labelledby'), id);
      }
    };

    await assertRelationships();
    await page.getByRole('tab', { name: 'Shapes', exact: true }).click();
    await assertRelationships();
    await page.getByRole('tab', { name: 'Outline', exact: true }).click();
    await assertRelationships();
  },
);

test(
  'the outline shows nesting with guide lines, collapses containers and supports tree keys',
  options,
  async (t) => {
    const { page } = await fixture(t, { bundle: makeBundle('process') });
    const row = (name) => page.getByRole('treeitem', { name, exact: true });
    const focused = (name) => row(name).evaluate((element) => element === document.activeElement);
    const rows = () =>
      page.getByRole('treeitem').evaluateAll((items) =>
        items.map((item) => ({
          name: item.getAttribute('aria-label'),
          level: item.getAttribute('aria-level'),
          expanded: item.getAttribute('aria-expanded'),
          tabindex: item.getAttribute('tabindex'),
          guides: [...item.querySelectorAll('.de-guide')].map(
            (guide) => guide.className.replace('de-guide', '').trim() || 'blank',
          ),
          icon: !!item.querySelector('.de-outline-kind svg'),
        })),
      );
    const initial = await rows();
    assert.deepEqual(
      initial
        .slice(0, 4)
        .map(({ name, level, expanded, guides }) => ({ name, level, expanded, guides })),
      [
        { name: 'Operations', level: '1', expanded: 'true', guides: [] },
        { name: 'Checkout service', level: '2', expanded: 'true', guides: ['de-guide-tee'] },
        {
          name: 'Café ☕',
          level: '3',
          expanded: null,
          guides: ['de-guide-line', 'de-guide-elbow'],
        },
        { name: 'Done', level: '2', expanded: null, guides: ['de-guide-elbow'] },
      ],
    );
    assert.ok(
      initial.every((item) => item.icon),
      'Every row shows a kind icon',
    );
    assert.deepEqual(
      initial.filter((item) => item.tabindex === '0').map((item) => item.name),
      ['Operations'],
      'One row is in the tab order',
    );
    assert.ok(
      (await page.locator('.de-shapes-pane .de-shape-kind svg').count()) > 0,
      'Shape buttons use drawn icons',
    );

    await row('Café ☕').click();
    const marker = await row('Café ☕').evaluate(
      (element) => getComputedStyle(element, '::before').content,
    );
    assert.ok(
      ['none', 'normal', ''].includes(marker),
      `Selection uses a fill, not a left bar; found ${marker}`,
    );

    await row('Operations').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused('Checkout service'), true);
    await page.keyboard.press('ArrowLeft');
    assert.equal(await row('Checkout service').getAttribute('aria-expanded'), 'false');
    assert.equal(await row('Café ☕').count(), 0, 'Collapsed members leave the outline');
    assert.equal(await focused('Checkout service'), true, 'Focus stays on the collapsed row');
    await page.keyboard.press('ArrowRight');
    assert.equal(await row('Checkout service').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('ArrowRight');
    assert.equal(
      await focused('Café ☕'),
      true,
      'Right on an open container moves to its first member',
    );
    await page.keyboard.press('ArrowLeft');
    assert.equal(
      await focused('Checkout service'),
      true,
      'Left on a member moves to its container',
    );
    await page.keyboard.press('End');
    assert.equal(
      await page
        .getByRole('treeitem')
        .last()
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.keyboard.press('Home');
    assert.equal(await focused('Operations'), true);

    await row('Complete, Connector').click();
    const selection = await page.getByRole('treeitem', { selected: true }).allTextContents();
    await row('Operations').locator('[data-action="toggle-group"]').click();
    assert.equal(await row('Operations').getAttribute('aria-expanded'), 'false');
    assert.equal(await row('Done').count(), 0);
    assert.deepEqual(
      await page.getByRole('treeitem', { selected: true }).allTextContents(),
      selection,
      'The disclosure control does not change the selection',
    );
    await row('Operations').locator('[data-action="toggle-group"]').click();

    const search = page.getByLabel('Find in diagram', { exact: true });
    const visible = () =>
      page
        .locator('.de-outline-item:not([hidden]) > [role="treeitem"]')
        .evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
    await search.fill('café');
    assert.deepEqual(
      await visible(),
      ['Operations', 'Checkout service', 'Café ☕'],
      'A match keeps its containers visible',
    );
    await search.fill('connector');
    assert.deepEqual(await visible(), ['Complete, Connector'], 'A kind finds its objects');
  },
);

test('command menu is anchored, keyboard navigable, and restores focus', options, async (t) => {
  const { page } = await fixture(t, { bundle: makeBundle('process') });
  const trigger = page.getByRole('button', { name: 'More', exact: true });
  assert.equal(await trigger.getAttribute('aria-haspopup'), 'menu');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Diagram options', exact: true });
  await menu.waitFor();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), [
    'Auto layout…',
    'Mermaid copies',
    'Show source',
    'Show revision',
    'Export JSON',
  ]);
  assert.equal(
    await page
      .getByRole('menuitem', { name: 'Auto layout…', exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.keyboard.press('ArrowDown');
  assert.equal(
    await page
      .getByRole('menuitem', { name: 'Mermaid copies', exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.keyboard.press('End');
  assert.equal(
    await page
      .getByRole('menuitem', { name: 'Export JSON', exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.keyboard.press('Home');
  assert.equal(
    await page
      .getByRole('menuitem', { name: 'Auto layout…', exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  const [triggerBox, menuBox] = await Promise.all([trigger.boundingBox(), menu.boundingBox()]);
  assert.ok(
    menuBox.y >= triggerBox.y && menuBox.x + menuBox.width <= page.viewportSize().width,
    'Menu remains anchored to the command bar inside the viewport',
  );
  assert.equal(await page.getByRole('dialog').count(), 0, 'Overflow choices do not open a modal');
  await page.keyboard.press('Escape');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await menu.isHidden(), true);
  assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
});

test(
  'inspector tabs preserve drafts, block selection loss, revert, and save through the command bar',
  options,
  async (t) => {
    const { page, read } = await fixture(t, { bundle: makeBundle('process') });
    await select(page, 'node-a');
    const propertiesTab = page.getByRole('tab', { name: 'Properties', exact: true });
    const reviewTab = page.getByRole('tab', { name: 'Review', exact: true });
    assert.equal(await propertiesTab.getAttribute('aria-controls'), 'diagram-properties-pane');
    assert.equal(await reviewTab.getAttribute('aria-controls'), 'diagram-review-pane');
    assert.equal(await page.locator('#diagram-properties-pane').getAttribute('role'), 'tabpanel');
    assert.equal(await page.locator('#diagram-review-pane').getAttribute('role'), 'tabpanel');

    const label = page.getByLabel('Label', { exact: true });
    await label.fill('Draft checkout step');
    await propertiesTab.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await reviewTab.getAttribute('aria-selected'), 'true');
    assert.equal(await reviewTab.getAttribute('tabindex'), '0');
    assert.equal(await propertiesTab.getAttribute('tabindex'), '-1');
    assert.equal(await reviewTab.evaluate((node) => node === document.activeElement), true);
    assert.equal(
      await label.inputValue(),
      'Draft checkout step',
      'Switching tabs preserves an unsubmitted field',
    );
    await page.keyboard.press('ArrowLeft');
    assert.equal(await propertiesTab.evaluate((node) => node === document.activeElement), true);

    const inspectorTrigger = page.getByRole('button', { name: 'Inspector', exact: true });
    await inspectorTrigger.click();
    assert.equal(await inspectorTrigger.getAttribute('aria-expanded'), 'false');
    assert.equal(
      await page.locator('#diagram-inspector-panel').getAttribute('aria-hidden'),
      'true',
    );
    await inspectorTrigger.click();
    assert.equal(
      await label.inputValue(),
      'Draft checkout step',
      'Closing and reopening the inspector preserves the draft',
    );

    await drawing(page, 'node-b').click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Apply or revert property changes before selecting another object.' })
      .waitFor();
    assert.equal(await drawing(page, 'node-a').getAttribute('data-selected'), 'true');
    assert.notEqual(await drawing(page, 'node-b').getAttribute('data-selected'), 'true');
    assert.equal(await label.inputValue(), 'Draft checkout step');
    await page.getByRole('button', { name: 'Revert', exact: true }).click();
    assert.equal(await label.inputValue(), 'Café ☕');
    await select(page, 'node-b');
    assert.equal(
      await page.getByLabel('Label', { exact: true }).inputValue(),
      'Done',
      'Selection proceeds after reverting the draft',
    );

    await select(page, 'node-a');
    await page.getByLabel('Label', { exact: true }).fill('Saved from command bar');
    await save(page);
    const saved = await read();
    assert.equal(
      saved.document.nodes.find((node) => node.id === 'node-a').label,
      'Saved from command bar',
    );
    assert.equal(
      await page.getByRole('button', { name: 'Apply changes', exact: true }).isDisabled(),
      true,
    );
  },
);

test(
  'dialogs keep their actions in a right-aligned footer over the theme scrim',
  options,
  async (t) => {
    const { page } = await fixture(t, { bundle: makeBundle('process') });
    await select(page, 'node-b');
    const layout = () =>
      page.getByRole('dialog', { name: 'Delete selection' }).evaluate((node) => {
        const box = node.getBoundingClientRect();
        const heading = getComputedStyle(node.querySelector('h2'));
        const actions = node.querySelector('.de-dialog-actions');
        const layer = getComputedStyle(node.parentElement);
        return {
          width: box.width,
          padding: getComputedStyle(node).paddingTop,
          heading: `${heading.fontSize}/${heading.lineHeight}`,
          actions: [...actions.querySelectorAll('button')].map((button) => button.textContent),
          rightInset: Math.round(
            box.right - actions.lastElementChild.getBoundingClientRect().right,
          ),
          scrim: layer.backgroundColor,
          blur: layer.backdropFilter,
        };
      });
    for (const [colorScheme, scrim] of [
      ['light', 'rgba(23, 25, 29, 0.4)'],
      ['dark', 'rgba(5, 6, 8, 0.64)'],
    ]) {
      await page.emulateMedia({ colorScheme });
      await page.getByRole('button', { name: 'Delete…', exact: true }).click();
      assert.deepEqual(
        await layout(),
        {
          width: 560,
          padding: '20px',
          heading: '16px/24px',
          actions: ['Cancel', 'Delete'],
          rightInset: 21,
          scrim,
          blur: 'none',
        },
        `${colorScheme}: the footer ends at the dialog's padding and the scrim is not blurred`,
      );
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
  },
);

test(
  'canvas selection is an outset outline with small handles on large targets',
  options,
  async (t) => {
    const { page } = await fixture(t, { bundle: makeBundle('process') });
    // Geometry in screen pixels, without the stroke that some engines add to client rects.
    const box = (locator) =>
      locator.evaluate((node) => {
        const shape = node.getBBox(),
          matrix = node.getScreenCTM();
        return {
          x: matrix.a * shape.x + matrix.e,
          y: matrix.d * shape.y + matrix.f,
          width: shape.width * matrix.a,
          height: shape.height * matrix.d,
        };
      });
    const near = (actual, expected, message) =>
      assert.ok(Math.abs(actual - expected) < 0.75, `${message}: ${actual} is not ${expected}`);
    await select(page, 'node-a');
    const scale = await page.evaluate(
      () => Number(document.querySelector('.de-zoom-value').textContent.replace('%', '')) / 100,
    );
    const outline = page.locator('.de-selection-box');
    assert.equal(await outline.count(), 1);
    const style = await outline.evaluate((node) => ({
      dash: getComputedStyle(node).strokeDasharray,
      width: Number(node.getAttribute('stroke-width')),
    }));
    assert.equal(style.dash, 'none', 'The selection outline is solid');
    near(style.width * scale, 2, 'The outline is 2px on screen');
    const shape = await box(drawing(page, 'node-a').locator('rect').first());
    const drawn = await box(outline);
    near(shape.x - drawn.x, 4, 'The outline sits 4px outside the left edge');
    near(drawn.x + drawn.width - (shape.x + shape.width), 4, 'and outside the right edge');
    assert.equal(
      await drawing(page, 'node-a').evaluate((node) =>
        [...node.querySelectorAll('*')].some((part) => getComputedStyle(part).filter !== 'none'),
      ),
      false,
      'A selected shape has no glow',
    );
    const resize = page.locator('[data-handle="resize"][data-handle-id="node-a"]');
    near(
      (await box(resize.locator('.de-resize-handle'))).width,
      8,
      'The resize handle is drawn 8px',
    );
    near((await box(resize.locator('.de-handle-hit'))).width, 24, 'and takes the pointer on 24px');

    await select(page, 'edge-a');
    await page.getByRole('button', { name: 'Add bend', exact: true }).click();
    await settle(page);
    const bend = page.locator('[data-handle="bend"][data-handle-id="edge-a"]').first();
    near((await box(bend.locator('.de-bend-handle'))).width, 8, 'A bend handle is drawn at r4');
    near((await box(bend.locator('.de-handle-hit'))).width, 24, 'and takes the pointer at r12');
  },
);

test(
  'a selected connector is traced in the accent along its route, with or without a label or bends',
  options,
  async (t) => {
    const { page, read } = await fixture(t);
    await page.getByRole('button', { name: 'Use process template', exact: true }).click();
    await settle(page);
    await save(page);
    const contrast = (foreground, background) => {
      const luminance = (color) =>
        color
          .match(/[\d.]+/gu)
          .slice(0, 3)
          .map((value) => Number(value) / 255)
          .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
          .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (light + 0.05) / (dark + 0.05);
    };
    // Every accent stroke that runs the length of the connector's drawn route, in screen pixels.
    const traces = () =>
      page.locator('[data-editor-svg]').evaluate((svg, id) => {
        const probe = document.createElement('span');
        probe.style.color = getComputedStyle(svg).getPropertyValue('--de-primary');
        svg.closest('.planr-diagram-editor').append(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        const connector = svg.querySelector(`[data-element-id="${id}"]`);
        const route = connector.querySelector(':scope > path');
        const onScreen = (node) => {
          const shape = node.getBBox(),
            matrix = node.getScreenCTM();
          return {
            x: matrix.a * shape.x + matrix.e,
            y: matrix.d * shape.y + matrix.f,
            width: shape.width * matrix.a,
            height: shape.height * matrix.d,
            scale: matrix.a,
          };
        };
        const drawn = onScreen(route);
        const label = connector.querySelector('text');
        const along = [...svg.querySelectorAll('path, polyline, line, rect')]
          .filter((node) => node !== route && node.checkVisibility())
          .filter((node) => getComputedStyle(node).stroke === accent)
          .map((node) => ({ node, box: onScreen(node), style: getComputedStyle(node) }))
          .filter(
            ({ box }) =>
              Math.abs(box.x - drawn.x) <= 1 &&
              Math.abs(box.y - drawn.y) <= 1 &&
              Math.abs(box.width - drawn.width) <= 1 &&
              Math.abs(box.height - drawn.height) <= 1,
          );
        return {
          selected: connector.dataset.selected,
          canvas: getComputedStyle(svg.closest('.de-canvas')).backgroundColor,
          accent,
          arrowhead: getComputedStyle(connector.querySelector('marker path')).fill,
          handles: [...svg.querySelectorAll('.de-bend-handle')].map((handle) => ({
            fill: getComputedStyle(handle).fill,
            stroke: getComputedStyle(handle).stroke,
          })),
          traces: along.map(({ node, box, style }) => ({
            width: Number.parseFloat(style.strokeWidth) * box.scale,
            dash: style.strokeDasharray,
            filter: style.filter,
            underLabel:
              !label || !!(node.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING),
          })),
        };
      }, id);
    const assertTraced = async (state) => {
      const saved = await read();
      assert.equal(saved.schemaVersion, '1.1.0');
      const accent =
        saved.studioPresentation.theme === 'dark' ? 'rgb(94, 234, 212)' : 'rgb(35, 122, 114)';
      const surface =
        saved.studioPresentation.theme === 'dark' ? 'rgb(32, 43, 48)' : 'rgb(223, 232, 232)';
      for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme });
        await settle(page);
        const measured = await traces();
        assert.equal(measured.accent, accent, `${state}, ${colorScheme}: saved palette accent`);
        for (const handle of measured.handles) {
          assert.deepEqual(handle, { fill: surface, stroke: accent });
          assert.ok(contrast(handle.stroke, handle.fill) >= 3, 'A bend handle reaches 3:1');
        }
        assert.equal(
          measured.selected,
          'true',
          `${state}, ${colorScheme}: the connector is selected`,
        );
        assert.equal(
          measured.traces.length,
          1,
          `${state}, ${colorScheme}: one accent trace runs the route`,
        );
        const [trace] = measured.traces;
        assert.ok(trace.width >= 2, `${state}, ${colorScheme}: the trace is ${trace.width}px wide`);
        assert.equal(trace.dash, 'none', `${state}, ${colorScheme}: the trace is solid`);
        assert.equal(trace.filter, 'none', `${state}, ${colorScheme}: the trace has no glow`);
        assert.ok(trace.underLabel, `${state}, ${colorScheme}: the label paints over the trace`);
        assert.equal(
          measured.arrowhead,
          measured.accent,
          `${state}, ${colorScheme}: the arrowhead`,
        );
        assert.ok(
          contrast(measured.accent, measured.canvas) >= 3,
          `${state}, ${colorScheme}: ${measured.accent} on ${measured.canvas} reaches 3:1`,
        );
      }
      await page.emulateMedia({ colorScheme: 'light' });
    };

    const connector = page.getByRole('treeitem', {
      name: 'Start → Process, Connector',
      exact: true,
    });
    const id = await connector.getAttribute('data-id');
    await connector.click();
    await settle(page);
    await assertTraced('Unlabelled and unbent');

    await page.getByLabel('Label', { exact: true }).fill('Submit');
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await settle(page);
    await page.getByRole('button', { name: 'Add bend', exact: true }).click();
    await settle(page);
    await save(page);
    await assertTraced('Labelled with bends');

    const original = await read();
    for (const palette of ['Dark', 'Light']) {
      await page.emulateMedia({ colorScheme: palette === 'Dark' ? 'light' : 'dark' });
      await page.locator('[data-studio-palette-menu]').click();
      await page.getByRole('menuitem', { name: palette, exact: true }).click();
      await save(page);
      const saved = await read();
      assert.deepEqual(saved.document, original.document, 'Palette changes retain semantics');
      assert.deepEqual(
        saved.presentation,
        original.presentation,
        'Palette changes retain geometry',
      );
      await page.reload();
      await page.locator('[data-editor-svg]').waitFor();
      await page.locator(`[data-action="select-id"][data-id="${id}"]`).click();
      await settle(page);
      await assertTraced(`${palette} palette after reload`);
    }

    await page.getByRole('treeitem', { name: 'Process', exact: true }).click();
    await settle(page);
    assert.deepEqual((await traces()).traces, [], 'The trace leaves with the selection');
  },
);

test(
  'canvas tools sit in a 44px bar with one accent mode and a neutral Snap',
  options,
  async (t) => {
    const { page } = await fixture(t, { bundle: makeBundle('process') });
    const tools = page.locator('.de-canvas-tools');
    const shell = page.locator('.planr-diagram-editor');
    const token = (name) =>
      shell.evaluate((node, property) => {
        const probe = document.createElement('span');
        probe.style.color = getComputedStyle(node).getPropertyValue(property);
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      }, name);
    assert.equal(await tools.evaluate((node) => node.getBoundingClientRect().height), 44);
    const buttons = await tools.getByRole('button').evaluateAll((items) =>
      items.map((item) => {
        const rect = item.getBoundingClientRect();
        return { name: item.getAttribute('aria-label'), width: rect.width, height: rect.height };
      }),
    );
    assert.ok(
      buttons.every((item) => item.height === 36 && item.width >= 36),
      `Every tool is at least 36px square: ${JSON.stringify(buttons)}`,
    );
    for (const name of ['Zoom out', 'Zoom in']) {
      const zoom = page.getByRole('button', { name, exact: true });
      assert.equal(await zoom.textContent(), '', `${name} is an icon`);
      assert.equal(await zoom.locator('svg').count(), 1);
      assert.deepEqual(
        await zoom.evaluate((node) => [node.offsetWidth, node.offsetHeight]),
        [36, 36],
      );
    }
    const colours = (name) =>
      page
        .getByRole('button', { name, exact: true })
        .evaluate((node) => [getComputedStyle(node).color, getComputedStyle(node).backgroundColor]);
    assert.deepEqual(
      await colours('Select'),
      [await token('--de-primary-text'), await token('--de-primary')],
      'The pressed mode tool is solid accent',
    );
    const snap = page.getByRole('button', { name: 'Snap', exact: true });
    const snapIcon = () => snap.locator('svg path').count();
    assert.equal(await snap.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(
      await colours('Snap'),
      [await token('--de-text'), await token('--de-raised')],
      'Snap on is neutral',
    );
    const onPaths = await snapIcon();
    await snap.click();
    assert.equal(await snap.getAttribute('aria-pressed'), 'false');
    assert.equal(await snapIcon(), onPaths + 1, 'Snap off adds a slash to its icon');

    const caption = await page.locator('.de-stage-footer').evaluate((node) => {
      const style = getComputedStyle(node);
      const stage = node.closest('.de-stage').getBoundingClientRect();
      const canvas = node.closest('.de-stage').querySelector('.de-canvas').getBoundingClientRect();
      return {
        position: style.position,
        fontSize: style.fontSize,
        border: style.borderTopWidth,
        canvasToBottom: Math.round(stage.bottom - canvas.bottom),
      };
    });
    assert.deepEqual(
      caption,
      { position: 'absolute', fontSize: '11px', border: '0px', canvasToBottom: 0 },
      'The status caption floats over a canvas that runs to the bottom edge',
    );
  },
);

test(
  'canvas tools expose mode and snapping state with visible zoom feedback',
  options,
  async (t) => {
    const { page } = await fixture(t, { bundle: makeBundle('process') });
    const selectTool = page.getByRole('button', { name: 'Select', exact: true });
    const panTool = page.getByRole('button', { name: 'Pan', exact: true });
    const snapTool = page.getByRole('button', { name: 'Snap', exact: true });
    assert.equal(await selectTool.getAttribute('aria-pressed'), 'true');
    assert.equal(await panTool.getAttribute('aria-pressed'), 'false');
    assert.equal(await snapTool.getAttribute('aria-pressed'), 'true');
    await panTool.click();
    assert.equal(await selectTool.getAttribute('aria-pressed'), 'false');
    assert.equal(await panTool.getAttribute('aria-pressed'), 'true');
    await snapTool.click();
    assert.equal(await snapTool.getAttribute('aria-pressed'), 'false');
    const zoomLevel = page.locator('output[aria-label="Zoom level"]');
    await zoomLevel.waitFor();
    const before = await zoomLevel.textContent();
    assert.match(before, /^\d+%$/u);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.waitForFunction(
      (previous) =>
        document.querySelector('output[aria-label="Zoom level"]')?.textContent !== previous,
      before,
    );
    assert.match(await zoomLevel.textContent(), /^\d+%$/u);
  },
);

test(
  'desktop chrome, tablet drawers and mobile review remain usable without page overflow',
  options,
  async (t) => {
    const { page, read } = await fixture(t, { bundle: makeBundle('process') });
    const original = await read();
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1280, height: 800 },
        { width: 1024, height: 768 },
        { width: 701, height: 768 },
        { width: 700, height: 768 },
        { width: 390, height: 844 },
        { width: 320, height: 640 },
      ]) {
        await page.setViewportSize(viewport);
        await settle(page);
        const dimensions = await page.evaluate(() => ({
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          canvas: document
            .querySelector('[aria-label="Diagram canvas"]')
            .getBoundingClientRect()
            .toJSON(),
        }));
        assert.ok(
          dimensions.scrollWidth <= dimensions.width,
          `${colorScheme} ${viewport.width}px must not overflow`,
        );
        if (viewport.width === 1440) {
          assert.ok(dimensions.canvas.top <= 60, `Top chrome is ${dimensions.canvas.top}px`);
          assert.ok(
            dimensions.canvas.width / dimensions.width >= 0.6,
            `1440px canvas occupies ${dimensions.canvas.width / dimensions.width}`,
          );
        }
        if (viewport.width === 1280)
          assert.ok(
            dimensions.canvas.width / dimensions.width >= 0.55,
            `1280px canvas occupies ${dimensions.canvas.width / dimensions.width}`,
          );
        if (viewport.width <= 700) {
          await page
            .getByText(/desktop.*edit|edit.*desktop/iu)
            .first()
            .waitFor();
        }
      }
    }

    await page.setViewportSize({ width: 700, height: 768 });
    await settle(page);
    await page.getByRole('button', { name: 'Outline', exact: true }).click();
    await page.getByRole('tab', { name: 'Shapes', exact: true }).click();
    assert.equal(
      await page.getByRole('button', { name: 'Create process', exact: true }).isDisabled(),
      true,
      'Editing is disabled at the mobile breakpoint',
    );
    await page.getByRole('button', { name: 'Close outline', exact: true }).click();

    await page.setViewportSize({ width: 701, height: 768 });
    await settle(page);
    await page.getByRole('button', { name: 'Outline', exact: true }).click();
    await page.getByRole('tab', { name: 'Shapes', exact: true }).click();
    assert.equal(
      await page.getByRole('button', { name: 'Create process', exact: true }).isEnabled(),
      true,
      'Editing starts immediately above the mobile breakpoint',
    );
    await page.getByRole('button', { name: 'Close outline', exact: true }).click();

    await page.setViewportSize({ width: 1024, height: 768 });
    await settle(page);
    const outlineTrigger = page.locator('[data-action="outline"]');
    const propertiesTrigger = page.locator('[data-action="properties"]');
    await outlineTrigger.click();
    assert.equal(await outlineTrigger.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#diagram-outline-panel').getAttribute('aria-hidden'), 'false');
    assert.equal(await page.locator('.de-drawer-backdrop').isVisible(), true);
    await page.getByRole('button', { name: 'Close outline', exact: true }).click();
    assert.equal(await outlineTrigger.getAttribute('aria-expanded'), 'false');
    await propertiesTrigger.click();
    assert.equal(await propertiesTrigger.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#diagram-outline-panel').getAttribute('aria-hidden'), 'true');
    assert.equal(
      await page.locator('#diagram-inspector-panel').getAttribute('aria-hidden'),
      'false',
    );
    await page.keyboard.press('Escape');
    assert.equal(await propertiesTrigger.getAttribute('aria-expanded'), 'false');
    assert.equal(
      await propertiesTrigger.evaluate((element) => element === document.activeElement),
      true,
      'Escape restores focus to the drawer trigger',
    );
    await outlineTrigger.click();
    await page.locator('.de-drawer-backdrop').click({ position: { x: 500, y: 300 } });
    assert.equal(await outlineTrigger.getAttribute('aria-expanded'), 'false');
    assert.equal(
      await outlineTrigger.evaluate((element) => element === document.activeElement),
      true,
      'Backdrop close restores focus to the drawer trigger',
    );
    assert.deepEqual(await read(), original, 'View preferences do not create content revisions');
  },
);

test('Start blank closes the start card for the rest of the session', options, async (t) => {
  const { page } = await fixture(t);
  const card = page.locator('.de-empty');
  await card.getByRole('heading', { name: 'Create your diagram', exact: true }).waitFor();
  await card.getByRole('button', { name: 'Start blank', exact: true }).click();
  await settle(page);
  assert.equal(await card.isHidden(), true, 'Start blank closes the card');
  assert.equal(
    await page.getByRole('tab', { name: 'Shapes', exact: true }).getAttribute('aria-selected'),
    'true',
    'Start blank opens the shape palette',
  );
  await page.getByRole('tab', { name: 'Outline', exact: true }).click();
  assert.equal(await card.isHidden(), true, 'A later render keeps the card closed');
  await create(page, 'process');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settle(page);
  assert.equal(await page.locator('[data-editor-svg] [data-element-id]').count(), 0);
  assert.equal(await card.isHidden(), true, 'An empty canvas after an edit keeps the card closed');
});

test(
  'unlabelled connectors are named by their endpoints and Apply keeps them unlabelled',
  options,
  async (t) => {
    const { page, read } = await fixture(t);
    await page.getByRole('button', { name: 'Use process template', exact: true }).click();
    await settle(page);
    assert.deepEqual(await exposedIds(page), [], 'Template with its three shapes selected');
    const dialog = page.getByRole('dialog', { name: 'Delete selection' });
    const deletionCopy = async (entry) => {
      await page.getByRole('button', { name: entry, exact: true }).click();
      await dialog.waitFor();
      const copy = await dialog.locator('p').allTextContents();
      assert.deepEqual(await exposedIds(page), [], 'Delete confirmation');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      return copy;
    };
    assert.deepEqual(await deletionCopy('Delete 3 objects…'), [
      'Delete 5 objects, including 2 connectors? This can be undone before another conflicting change.',
      'Connectors: Start → Process, Process → End',
    ]);

    await page.getByRole('treeitem', { name: 'Start → Process, Connector', exact: true }).click();
    await page.getByRole('heading', { name: 'Start → Process', exact: true }).waitFor();
    const label = page.getByLabel('Label', { exact: true });
    assert.equal(await label.inputValue(), '', 'The Label field holds only a stored label');
    assert.equal(await label.getAttribute('placeholder'), 'Start → Process');
    assert.equal(
      await page.locator('.de-stage-footer').textContent(),
      'Selected: Start → Process · 5 objects',
    );
    assert.deepEqual(await exposedIds(page), [], 'Connector selected');
    assert.equal(
      await page
        .locator('[data-editor-svg] [data-collection="relations"][role="img"]')
        .first()
        .getAttribute('aria-label'),
      'Start → Process',
      'The canvas names an unlabelled connector as the outline does',
    );
    assert.deepEqual(await deletionCopy('Delete…'), [
      'Delete 1 connector? This can be undone before another conflicting change.',
      'Connector: Start → Process',
    ]);

    await page.getByLabel('Direction', { exact: true }).selectOption('both');
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await settle(page);
    assert.equal(await label.inputValue(), '', 'Apply does not turn the name into a label');
    assert.deepEqual(await exposedIds(page), [], 'After Apply');
    await save(page);
    const saved = await read();
    const node = (name) => saved.document.nodes.find((item) => item.label === name).id;
    const relation = saved.document.relations.find((item) => item.direction === 'both');
    assert.deepEqual(
      [relation.from, relation.to, relation.label],
      [node('Start'), node('Process'), null],
    );
    assert.equal(await drawing(page, relation.id).locator('text').count(), 0, 'No label is drawn');
  },
);

test(
  'React palette menu persists canvas and drawing colors against opposite OS themes without altering legacy geometry',
  options,
  async (t) => {
    const original = makeBundle('process');
    const { page, read } = await fixture(t, { bundle: original });
    assert.equal(
      await page.locator('.planr-diagram-editor').getAttribute('data-studio-framework'),
      'react',
    );
    assert.equal(await page.locator('.studio-type-badge').textContent(), 'Diagram');
    for (const expected of [
      {
        name: 'Dark',
        theme: 'dark',
        os: 'light',
        canvas: 'rgb(8, 8, 12)',
        text: '#f5f7f7',
        connector: '#94a3b8',
      },
      {
        name: 'Light',
        theme: 'light',
        os: 'dark',
        canvas: 'rgb(245, 247, 247)',
        text: '#08080c',
        connector: '#475569',
      },
    ]) {
      await page.emulateMedia({ colorScheme: expected.os });
      await page.locator('[data-studio-palette-menu]').click();
      await page.getByRole('menuitem', { name: expected.name, exact: true }).click();
      await page.locator('.de-save-state[data-state="unsaved"]').waitFor();
      await save(page);
      const saved = await read();
      assert.equal(saved.schemaVersion, '1.1.0');
      assert.equal(saved.studioPresentation.theme, expected.theme);
      assert.deepEqual(saved.document, original.document);
      assert.deepEqual(saved.presentation, original.presentation);
      await page.reload();
      await page.locator('[data-editor-svg]').waitFor();
      await settle(page);
      assert.deepEqual(
        await page.evaluate(() => ({
          canvas: getComputedStyle(document.querySelector('.de-canvas')).backgroundColor,
          text: document.querySelector('[data-element-id="node-a"] text').getAttribute('fill'),
          connector: document
            .querySelector('[data-element-id="edge-a"] > path')
            .getAttribute('stroke'),
          wrapper: document.querySelectorAll('[data-editor-svg] > [data-canvas-background]').length,
        })),
        { canvas: expected.canvas, text: expected.text, connector: expected.connector, wrapper: 0 },
      );
      await page.locator('[data-studio-palette-menu]').click();
      assert.equal(
        await page
          .getByRole('menuitem', { name: `${expected.name} · Selected`, exact: true })
          .count(),
        1,
      );
      await page.keyboard.press('Escape');
    }
  },
);
