import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startDiagramOwner } from '../lib/artifact/diagram/editor/local-owner.mjs';
import { createDiagramAuthoringStore } from '../lib/artifact/diagram/authoring/store.mjs';
import { makeBundle, sealBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { mixedBundle } from './fixtures/diagram-editor-capacity.mjs';

const enabled = process.env.PLANR_BROWSER_TESTS === '1';
const requireProtocol = createRequire(new URL('../../protocol/package.json', import.meta.url));
const playwright = requireProtocol('playwright');
const options = { skip: !enabled, timeout: 60_000 };
async function fixture(t, { bundle, viewport = { width: 1440, height: 900 }, storageBlocked = false } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'planr-editor-ui-')));
  const store = createDiagramAuthoringStore({ root, slug: 'checkout' });
  if (bundle) await store.initialize(bundle, { transactionId: 'browser-fixture' });
  const owner = await startDiagramOwner({ root, slug: 'checkout', noOpen: true, env: { ...process.env, PLANR_HOME: join(root, 'home') } });
  const engine = process.env.PLANR_BROWSER_ENGINE ?? 'chromium';
  assert.ok(['chromium', 'firefox', 'webkit'].includes(engine), `Unsupported browser: ${engine}`);
  let browser;
  const errors = [], external = [];
  t.after(async () => { await browser?.close(); await owner.close(); await rm(root, { recursive: true, force: true }); assert.deepEqual(errors, []); assert.deepEqual(external, [], 'Local authoring requires no remote account or assets'); });
  browser = await playwright[engine].launch({ headless: true, ...(process.env.PLANR_BROWSER_EXECUTABLE ? { executablePath: process.env.PLANR_BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith(new URL(owner.baseUrl).origin)) external.push(request.url()); });
  if (storageBlocked) await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem', 'removeItem']) Storage.prototype[method] = () => { throw new DOMException('Storage disabled', 'SecurityError'); };
  });
  await page.goto(owner.baseUrl); await page.locator('[data-editor-svg]').waitFor();
  const read = async () => {
    const response = await fetch(`${owner.apiBase}read`, { headers: owner.headers });
    assert.equal(response.status, 200);
    return (await response.json()).bundle;
  };
  return { page, browser, owner, store, read };
}
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const drawing = (page, id) => page.locator(`[data-editor-svg] [data-element-id="${id}"]`);
async function save(page) {
  await page.getByRole('button', { name: 'Save diagram', exact: true }).click();
  await page.getByText('Saved', { exact: true }).waitFor();
}
async function apply(page, fields) {
  for (const [name, value] of Object.entries(fields)) await page.getByLabel(name, { exact: true }).fill(String(value));
  await page.getByRole('button', { name: 'Apply properties', exact: true }).click();
  await settle(page);
}
async function create(page, name) {
  await page.getByRole('tab', { name: 'Shapes', exact: true }).click();
  await page.getByRole('button', { name: `Create ${name}`, exact: true }).click();
  await settle(page);
  return page.locator('[data-editor-svg] [data-element-id][data-selected="true"]').getAttribute('data-element-id');
}
async function select(page, id, additive = false) {
  await drawing(page, id).click({ modifiers: additive ? ['Shift'] : [] });
  await settle(page);
}

// The shell and every read/save below are served by the actual scoped owner.
// Test assertions inspect observable controls, SVG, and persisted paired content.
test('blank authoring supports keyboard properties and retains IDs after local reload', options, async t => {
  const { page, read } = await fixture(t);
  const processId = await create(page, 'process');
  assert.ok(processId);
  await apply(page, { Label: 'Receive order', Description: 'Accept the submitted order.', X: 80, Y: 100, Width: 180, Height: 80 });
  const endId = await create(page, 'end');
  await apply(page, { Label: 'Order accepted', X: 400, Y: 100 });
  await select(page, processId); await select(page, endId, true);
  await page.getByRole('button', { name: 'Connect selection', exact: true }).click();
  await page.getByLabel('From', { exact: true }).selectOption(processId);
  await page.getByLabel('To', { exact: true }).selectOption(endId);
  await page.getByLabel('Connector label', { exact: true }).fill('Submit');
  await page.getByRole('button', { name: 'Create connector', exact: true }).click();
  await save(page);
  const saved = await read();
  assert.deepEqual(saved.document.nodes.map(node => [node.id, node.label]), [[processId, 'Receive order'], [endId, 'Order accepted']]);
  assert.equal(saved.document.relations[0].from, processId); assert.equal(saved.document.relations[0].to, endId);
  assert.deepEqual(saved.presentation.elements.find(item => item.elementId === processId).bounds, { x: 80, y: 100, width: 180, height: 80 });
  await page.reload(); await page.locator('[data-editor-svg]').waitFor();
  assert.match(await drawing(page, processId).textContent(), /Receive order/u);
  assert.equal(await drawing(page, endId).getAttribute('aria-label'), 'Order accepted');
  assert.deepEqual(await read(), saved);
  await select(page, processId);
  await page.getByLabel('Label', { exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('Version V H');
  await page.getByRole('button', { name: 'Apply properties', exact: true }).focus(); await page.keyboard.press('Space');
  await save(page);
  assert.equal((await read()).document.nodes.find(node => node.id === processId).label, 'Version V H', 'V/H shortcuts do not steal input or Space button activation');
});

test('keyboard users can create, multi-select, connect, move, and undo without canvas pointing', options, async t => {
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
  assert.equal(await page.getByRole('treeitem', { name: 'End', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.getByRole('button', { name: 'Connect selection', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Connector label', { exact: true }).focus();
  await page.keyboard.type('Approve');
  await page.getByRole('button', { name: 'Create connector', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('treeitem', { name: 'Process', exact: true }).focus();
  await page.keyboard.press('Enter');
  const before = await drawing(page, (await page.locator('[data-action=select-id]').first().getAttribute('data-id'))).getAttribute('transform');
  await page.getByLabel('Diagram canvas', { exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ControlOrMeta+Z');
  await settle(page);
  await save(page);
  const saved = await read();
  assert.equal(saved.document.nodes.length, 2);
  assert.equal(saved.document.relations[0].label, 'Approve');
  assert.equal(await drawing(page, saved.document.nodes[0].id).getAttribute('transform'), before);
});

test('new containers and lanes sit directly on the themed canvas without an opaque page wrapper', options, async t => {
  const { page, browser, owner, read } = await fixture(t);
  const containerId = await create(page, 'container');
  const laneId = await create(page, 'horizontal lane');
  for (const id of [containerId, laneId]) {
    const rectangle = drawing(page, id).locator('rect');
    assert.equal(await rectangle.getAttribute('fill'), 'none');
  }
  assert.equal(await page.locator('[data-editor-svg] > rect, [data-world] > rect').count(), 0, 'The editor does not draw a page background behind shapes');
  await save(page);
  const persisted = await read();
  assert.ok(persisted.presentation.elements.filter(item => [containerId, laneId].includes(item.elementId)).every(item => item.appearance.fill === 'transparent'));
  const stylesheet = await page.request.get(new URL('editor.css', owner.baseUrl).href);
  assert.equal(stylesheet.status(), 200);
  const host = await browser.newPage();
  await host.setContent('<!doctype html><style>body{margin:19px;overflow-y:auto;font-family:Georgia}</style><div class="planr-diagram-editor">Embedded editor</div>');
  await host.addStyleTag({ content: await stylesheet.text() });
  const hostStyle = await host.evaluate(() => ({ bodyMargin: getComputedStyle(document.body).marginLeft, bodyOverflow: getComputedStyle(document.body).overflowY, editorFont: getComputedStyle(document.querySelector('.planr-diagram-editor')).fontFamily }));
  assert.equal(hostStyle.bodyMargin, '19px', 'Importing editor CSS does not reset the host page');
  assert.equal(hostStyle.bodyOverflow, 'auto', 'Importing editor CSS does not lock host scrolling');
  assert.match(hostStyle.editorFont, /Georgia/u, 'The shared editor inherits its host typography');
});

test('duplicate, container membership, lock feedback and deletion confirmation preserve semantic identities', options, async t => {
  const bundle = makeBundle('process');
  const { page, read } = await fixture(t, { bundle });
  await select(page, 'node-a'); await select(page, 'node-b', true);
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await save(page);
  const copied = await read();
  const added = copied.document.nodes.filter(node => !bundle.document.nodes.some(old => old.id === node.id));
  assert.equal(added.length, 2); assert.ok(added.every(node => node.id !== 'node-a' && node.id !== 'node-b'));
  const copiedEdge = copied.document.relations.find(edge => edge.id !== 'edge-a');
  assert.ok(added.some(node => node.id === copiedEdge.from)); assert.ok(added.some(node => node.id === copiedEdge.to));
  await page.locator('[data-action=select-id][data-id=node-a]').click();
  await page.getByRole('checkbox', { name: 'Lock position', exact: true }).check();
  await page.getByRole('button', { name: 'Apply properties', exact: true }).click();
  await save(page); const locked = await read();
  assert.equal(await page.getByLabel('X', { exact: true }).isDisabled(), true);
  await page.getByLabel('Diagram canvas', { exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('alert').filter({ hasText: /lock/iu }).waitFor();
  assert.equal((await read()).bundleDigest, locked.bundleDigest);
  await page.locator('[data-action=select-id][data-id=node-b]').click();
  await page.getByRole('button', { name: 'Delete selection…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /delete/iu });
  await dialog.waitFor(); assert.match(await dialog.textContent(), /edge-a|Complete/u);
  assert.ok((await read()).document.nodes.some(node => node.id === 'node-b'), 'Opening deletion preview does not delete');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Delete selection…', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await save(page);
  const deleted = await read();
  assert.ok(!deleted.document.nodes.some(node => node.id === 'node-b'));
  assert.ok(!deleted.document.relations.some(edge => edge.id === 'edge-a'));
  assert.ok(deleted.document.nodes.some(node => node.id === 'node-a'));
});

test('connector endpoints, manual bends, label placement and nested lanes persist together', options, async t => {
  const { page, read } = await fixture(t, { bundle: makeBundle('process') });
  await select(page, 'edge-a');
  await page.getByRole('button', { name: 'Add bend', exact: true }).click();
  await apply(page, { 'Bend 2 Y': 115, 'Label X': 190, 'Label Y': 25 });
  let route = (await read()).presentation.elements.find(item => item.elementId === 'edge-a').route;
  assert.equal(route.points.length, 2, 'The new route remains pending until acknowledged');
  await page.getByLabel('Direction', { exact: true }).selectOption('both');
  await page.getByLabel('Line style', { exact: true }).selectOption('dashed');
  await page.getByLabel('Routing', { exact: true }).selectOption('orthogonal');
  await page.getByRole('button', { name: 'Apply properties', exact: true }).click();
  await save(page);
  let saved = await read();
  assert.equal(saved.document.relations[0].direction, 'both');
  assert.equal(saved.presentation.elements.find(item => item.elementId === 'edge-a').appearance.strokeStyle, 'dashed');
  route = saved.presentation.elements.find(item => item.elementId === 'edge-a').route;
  assert.equal(route.points.length, 5);
  assert.ok(route.points.every((point,index,all)=>index===0||point.x===all[index-1].x||point.y===all[index-1].y));
  assert.equal(saved.presentation.elements.find(item => item.elementId === 'edge-a').label.y, 25);
  await page.locator('[data-action=select-id][data-id=lane-a]').click();
  await page.getByRole('button', { name: 'Arrange vertically…', exact: true }).click();
  await page.getByRole('button', { name: 'Preview layout', exact: true }).click();
  await page.getByRole('button', { name: 'Apply layout', exact: true }).click();
  await save(page); saved = await read();
  const lane = saved.presentation.elements.find(item => item.elementId === 'lane-a').bounds;
  for (const id of ['group-a', 'node-b']) {
    const bounds = saved.presentation.elements.find(item => item.elementId === id).bounds;
    assert.ok(bounds.x >= lane.x && bounds.y >= lane.y && bounds.x + bounds.width <= lane.x + lane.width && bounds.y + bounds.height <= lane.y + lane.height);
  }
  await page.reload(); await page.locator('[data-editor-svg]').waitFor();
  assert.deepEqual(await read(), saved);
});

test('1,000-object canvas updates affected primitives and keeps one camera during targeted edits', options, async t => {
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
  t.diagnostic(`1,000-object targeted keyboard gesture and two animation frames: ${responseMs} ms in ${process.env.PLANR_BROWSER_ENGINE ?? 'chromium'}; this is not a release p95.`);
  assert.equal(await stable.evaluate(element=>element.isConnected), true);
  assert.equal(await selected.evaluate(element=>element.isConnected), false, 'Only affected node primitives are replaced');
  await page.getByRole('button', { name: 'Pan', exact: true }).click();
  const canvas = await page.getByLabel('Diagram canvas', { exact: true }).boundingBox();
  const oldTransform = await page.locator('[data-world]').getAttribute('transform');
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width / 2 + 42, canvas.y + canvas.height / 2 + 26, { steps: 4 });
  await page.mouse.up();
  await settle(page);
  assert.notEqual(await page.locator('[data-world]').getAttribute('transform'), oldTransform);
  assert.equal(await stable.evaluate(element=>element.isConnected), true, 'Camera motion keeps every object primitive stable');
  assert.deepEqual(await read(), before, 'Keyboard and camera changes are not persisted before Save');
  await save(page);
  assert.equal((await read()).presentation.elements.length, 1_000);
});

test('completed drag is one undoable edit, cancellation writes nothing, and canvas primitives retain identity', options, async t => {
  const bundle = makeBundle('process');
  bundle.document.lanes = []; bundle.document.groups = []; bundle.document.laneOrder = [];
  bundle.document.accessibility.readingOrder = bundle.document.accessibility.readingOrder.filter(id => !['lane-a', 'group-a'].includes(id));
  bundle.presentation.elements = bundle.presentation.elements.filter(item => !['lane-a', 'group-a'].includes(item.elementId)); sealBundle(bundle);
  const { page, store, read } = await fixture(t, { bundle });
  await select(page, 'node-a');
  const target = await drawing(page, 'node-a').boundingBox();
  const svg = await page.locator('[data-editor-svg]').elementHandle();
  const unchanged = await drawing(page, 'node-b').elementHandle();
  const before = await read(); const revisions = (await store.history()).length;
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2 + 70, target.y + target.height / 2 + 40, { steps: 8 });
  await page.keyboard.press('Escape'); await page.mouse.up(); await settle(page);
  assert.equal(await page.getByRole('button', { name: 'Save diagram', exact: true }).isDisabled(), true);
  assert.deepEqual(await read(), before); assert.equal((await store.history()).length, revisions);
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2 + 80, target.y + target.height / 2 + 50, { steps: 8 });
  await page.mouse.up(); await settle(page); await save(page);
  const moved = await read(); assert.notDeepEqual(moved.presentation, before.presentation);
  assert.equal((await store.history()).length, revisions + 1, 'Pointer samples commit one operation');
  assert.equal(await svg.evaluate(element => element.isConnected), true); assert.equal(await unchanged.evaluate(element => element.isConnected), true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await save(page);
  assert.deepEqual((await read()).presentation, before.presentation);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await save(page);
  assert.deepEqual((await read()).presentation, moved.presentation);
  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  await page.getByRole('button', { name: 'Preview layout', exact: true }).click();
  assert.deepEqual((await read()).presentation, moved.presentation, 'Layout preview never writes');
  await page.getByRole('button', { name: 'Cancel layout', exact: true }).click();
  assert.deepEqual((await read()).presentation, moved.presentation);
});

test('failed save, refresh recovery and blocked storage report actual durability', options, async t => {
  const { page, owner, read } = await fixture(t, { bundle: makeBundle('process') });
  await select(page, 'node-b'); await apply(page, { Label: 'Pending confirmation' });
  await page.route(`${owner.apiBase}commit`, route => route.abort('failed'), { times: 1 });
  await page.getByRole('button', { name: 'Save diagram', exact: true }).click();
  await page.getByText(/Offline.*[Uu]nsaved/u).waitFor();
  assert.equal((await read()).document.nodes.find(node => node.id === 'node-b').label, 'Done');
  await page.reload(); await page.locator('[data-editor-svg]').waitFor();
  assert.equal(await drawing(page, 'node-b').getAttribute('aria-label'), 'Pending confirmation');
  await page.getByText(/recover/iu).first().waitFor();
  assert.equal((await read()).document.nodes.find(node => node.id === 'node-b').label, 'Done', 'Recovery is disclosed before explicit retry');
  await save(page); assert.equal((await read()).document.nodes.find(node => node.id === 'node-b').label, 'Pending confirmation');
  const blocked = await fixture(t, { bundle: makeBundle('process'), storageBlocked: true });
  await blocked.page.getByText(/recovery.*unavailable|memory only|keep.*session open/iu).first().waitFor();
  await select(blocked.page, 'node-b'); await apply(blocked.page, { Label: 'In memory' });
  assert.equal(await drawing(blocked.page, 'node-b').getAttribute('aria-label'), 'In memory');
  assert.equal((await blocked.read()).document.nodes.find(node => node.id === 'node-b').label, 'Done');
  await save(blocked.page); assert.equal((await blocked.read()).document.nodes.find(node => node.id === 'node-b').label, 'In memory');
});

test('desktop chrome, tablet drawers and mobile review remain usable without page overflow', options, async t => {
  const { page, read } = await fixture(t, { bundle: makeBundle('process') });
  const original = await read();
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
      await page.setViewportSize(viewport); await settle(page);
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, canvas: document.querySelector('[aria-label="Diagram canvas"]').getBoundingClientRect().toJSON() }));
      assert.ok(dimensions.scrollWidth <= dimensions.width, `${colorScheme} ${viewport.width}px must not overflow`);
      if (viewport.width === 1440) assert.ok(dimensions.canvas.top <= 112, `Top chrome is ${dimensions.canvas.top}px`);
      if (viewport.width < 700) await page.getByText(/desktop.*edit|edit.*desktop/iu).first().waitFor();
    }
  }
  await page.setViewportSize({ width: 1024, height: 768 }); await settle(page);
  await page.getByRole('button', { name: 'Outline', exact: true }).click();
  await page.getByRole('button', { name: 'Close outline', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Outline', exact: true }).evaluate(element => element === document.activeElement), true);
  assert.deepEqual(await read(), original, 'View preferences do not create content revisions');
});
