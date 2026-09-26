import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { adoptMermaidCopy, previewMermaidCopy } from '../lib/artifact/diagram/authoring/index.mjs';
import { createDiagramAuthoringStore } from '../lib/artifact/diagram/authoring/store.mjs';
import { startDiagramOwner } from '../lib/artifact/diagram/editor/local-owner.mjs';

const enabled = process.env.PLANR_BROWSER_TESTS === '1';
const requireProtocol = createRequire(new URL('../../protocol/package.json', import.meta.url));
const { build } = requireProtocol('esbuild');
const supported = readFileSync(
  new URL('../fixtures/diagram/interchange/flowchart-supported.mmd', import.meta.url),
  'utf8',
);
const partial = readFileSync(
  new URL('../fixtures/diagram/interchange/flowchart-partial.mmd', import.meta.url),
  'utf8',
);
const editorStyles = readFileSync(
  new URL('../lib/artifact/ui/diagram-editor.css', import.meta.url),
  'utf8',
);

async function fixture(t, { initial = null, viewport = { width: 1280, height: 800 } } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'planr-source-ui-')));
  const store = createDiagramAuthoringStore({ root, slug: 'checkout' });
  if (initial) await store.initialize(initial, { transactionId: 'source-fixture' });
  const owner = await startDiagramOwner({
    root,
    slug: 'checkout',
    grammar: 'flowchart',
    noOpen: true,
    env: { ...process.env, PLANR_HOME: join(root, 'home') },
  });
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport, acceptDownloads: true });
  const errors = [],
    remote = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (
      !request.url().startsWith(new URL(owner.baseUrl).origin) &&
      !request.url().startsWith('data:')
    )
      remote.push(request.url());
  });
  t.after(async () => {
    await browser.close();
    await owner.close();
    await rm(root, { recursive: true, force: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(remote, []);
  });
  await page.goto(owner.baseUrl);
  await page.locator('[data-editor-svg]').waitFor();
  return { page, store, owner };
}

async function companyHostFixture(t) {
  const entry = join(
    import.meta.dirname,
    '..',
    'lib',
    'artifact',
    'diagram',
    'editor',
    'index.mjs',
  );
  const compiled = await build({
    stdin: {
      contents: `
				import { createDiagramEditorDraft, mountDiagramSourcePanel } from ${JSON.stringify(entry)};
				const draft = createDiagramEditorDraft({
					diagramId: "company-checkout",
					title: "Company checkout",
				});
				if (!draft.ok) throw new Error(JSON.stringify(draft.diagnostics));
				let state = {
					bundle: draft.bundle,
					capabilities: { read: true, write: true },
					needsInitialization: true,
					pendingCount: 0,
					saveState: "unsaved",
				};
				const calls = { adopt: 0, reports: [] };
				const session = Object.freeze({
					getState() { return structuredClone(state); },
					adoptInitialCopy(bundle) {
						if (!state.capabilities.write) {
							return { ok: false, diagnostics: [{ detail: "Company owner access was revoked." }] };
						}
						calls.adopt += 1;
						state = { ...state, bundle: structuredClone(bundle) };
						return { ok: true, bundle: structuredClone(bundle) };
					},
				});
				const controller = mountDiagramSourcePanel({
					root: document.querySelector("#company-source-panel"),
					session,
					onAdopt(bundle) { document.body.dataset.adopted = bundle.bundleDigest; },
					onReport(message) { calls.reports.push(message); },
				});
				globalThis.companyHostProof = {
					calls,
					controller,
					getState: () => structuredClone(state),
					setReadable(read) {
						state = { ...state, capabilities: { ...state.capabilities, read } };
					},
					setWritable(write) {
						state = { ...state, capabilities: { ...state.capabilities, write } };
					},
					sessionKeys: Object.keys(session).sort(),
				};
			`,
      resolveDir: import.meta.dirname,
      sourcefile: 'company-diagram-source-host.mjs',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  const browser = await launchBrowser();
  const page = await browser.newPage({
    viewport: { width: 1024, height: 768 },
  });
  await page.emulateMedia({ colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => {
    await browser.close();
    assert.deepEqual(errors, []);
  });
  await page.setContent(
    '<!doctype html><html lang="en"><title>Company diagram source</title><body style="margin:23px;font-family:Georgia,serif"><main><h1>Company diagram source</h1><div id="company-source-panel"></div></main></body></html>',
  );
  await page.addStyleTag({ content: editorStyles });
  await page.addScriptTag({ content: compiled.outputFiles[0].text });
  await page.getByRole('tab', { name: 'Import a copy' }).waitFor();
  return page;
}
const dialog = (page) => page.getByRole('dialog', { name: 'Mermaid import and export' });
async function open(page) {
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Mermaid copies', exact: true }).click();
  return dialog(page);
}

test('the exported source panel mounts in a minimal company host through the declared session seam', {
  skip: !enabled,
  timeout: 90_000,
}, async (t) => {
  const page = await companyHostFixture(t);
  assert.deepEqual(
    await page.evaluate(() => globalThis.companyHostProof.sessionKeys),
    ['adoptInitialCopy', 'getState'],
    'the host supplies only the public source-panel session interface',
  );
  const importTab = page.getByRole('tab', { name: 'Import a copy' });
  const exportTab = page.getByRole('tab', { name: 'Export a copy' });
  const standalone = page.locator('#company-source-panel');
  assert.equal(
    await standalone.getByRole('button', { name: 'Close', exact: true }).count(),
    0,
    'an inline host without a close callback does not expose a dead control',
  );
  assert.equal(
    await standalone.evaluate((node) => node.classList.contains('planr-diagram-source-panel')),
    true,
    'the direct seam applies its public, isolated style scope',
  );
  const lightStyles = await standalone.evaluate((node) => {
    const root = getComputedStyle(node);
    const input = getComputedStyle(node.querySelector('.de-source-input'));
    const primary = getComputedStyle(node.querySelector('.de-primary'));
    return {
      background: root.backgroundColor,
      color: root.color,
      font: root.fontFamily,
      inputBackground: input.backgroundColor,
      primaryBackground: primary.backgroundColor,
      panelDisplay: getComputedStyle(node.querySelector('.de-source-panel')).display,
      bodyMargin: getComputedStyle(document.body).marginLeft,
      bodyFont: getComputedStyle(document.body).fontFamily,
    };
  });
  assert.deepEqual(
    {
      background: lightStyles.background,
      color: lightStyles.color,
      inputBackground: lightStyles.inputBackground,
      primaryBackground: lightStyles.primaryBackground,
      panelDisplay: lightStyles.panelDisplay,
      bodyMargin: lightStyles.bodyMargin,
    },
    {
      background: 'rgb(250, 251, 252)',
      color: 'rgb(21, 25, 29)',
      inputBackground: 'rgb(255, 255, 255)',
      primaryBackground: 'rgb(8, 127, 115)',
      panelDisplay: 'grid',
      bodyMargin: '23px',
    },
    'the shared stylesheet renders a professional light surface without leaking into its host',
  );
  assert.match(lightStyles.font, /DM Sans|Inter|system-ui/iu);
  assert.match(lightStyles.bodyFont, /Georgia/iu);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('#company-source-panel .de-primary'))
        .backgroundColor === 'rgb(94, 234, 212)',
  );
  assert.deepEqual(
    await standalone.evaluate((node) => ({
      background: getComputedStyle(node).backgroundColor,
      color: getComputedStyle(node).color,
      inputBackground: getComputedStyle(node.querySelector('.de-source-input')).backgroundColor,
      primaryBackground: getComputedStyle(node.querySelector('.de-primary')).backgroundColor,
      transitionDuration: getComputedStyle(node.querySelector('.de-primary')).transitionDuration,
    })),
    {
      background: 'rgb(17, 21, 29)',
      color: 'rgb(242, 245, 247)',
      inputBackground: 'rgb(11, 14, 20)',
      primaryBackground: 'rgb(94, 234, 212)',
      transitionDuration: '0s',
    },
    'the direct host follows the same dark tokens as the local owner',
  );
  await page.emulateMedia({
    colorScheme: 'light',
    reducedMotion: 'no-preference',
  });
  assert.equal(await importTab.getAttribute('aria-selected'), 'true');
  assert.equal(await exportTab.getAttribute('aria-selected'), 'false');
  assert.equal(
    await page.getByRole('button', { name: /link|watch|write|overwrite|repository/iu }).count(),
    0,
    'the reusable panel exposes copy actions, never source custody',
  );

  const source = page.getByLabel('Mermaid source');
  await source.fill('flowchart TB\nA[Start]\ninvalid???\n');
  await page.getByRole('button', { name: 'Preview copy' }).click();
  assert.match(await page.getByRole('status').innerText(), /Import rejected/u);
  assert.match(
    await page.getByRole('button', { name: /Error at line 3/u }).innerText(),
    /valid certified Mermaid syntax/u,
    "the host receives the shared converter's located diagnostic",
  );
  assert.equal(await page.evaluate(() => globalThis.companyHostProof.calls.adopt), 0);

  await source.fill(supported);
  await page.getByRole('button', { name: 'Preview copy' }).click();
  assert.match(await page.getByRole('status').innerText(), /Preview ready/u);
  assert.equal(await page.getByText('Original source text').count(), 1);
  assert.equal(
    (
      await standalone
        .locator('.de-source-fidelity')
        .evaluate((node) => getComputedStyle(node).gridTemplateColumns)
    ).split(' ').length,
    3,
    'desktop presents the three fidelity dimensions side by side',
  );
  await page.setViewportSize({ width: 640, height: 900 });
  const responsive = await standalone.evaluate((node) => ({
    fidelityColumns: getComputedStyle(node.querySelector('.de-source-fidelity'))
      .gridTemplateColumns,
    proposalColumns: getComputedStyle(node.querySelector('.de-source-proposal'))
      .gridTemplateColumns,
    right: node.getBoundingClientRect().right,
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
  }));
  assert.equal(responsive.fidelityColumns.split(' ').length, 1);
  assert.equal(responsive.proposalColumns.split(' ').length, 1);
  assert.ok(responsive.right <= 640, 'the standalone panel stays inside the viewport');
  assert.ok(
    responsive.scrollWidth <= responsive.clientWidth,
    'the responsive source panel does not create horizontal overflow',
  );
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByLabel('Acknowledge this preview’s listed losses').check();
  await page.evaluate(() => globalThis.companyHostProof.setWritable(false));
  await page.getByRole('button', { name: 'Adopt copy' }).click();
  assert.match(await page.getByRole('alert').innerText(), /Company owner access was revoked/u);
  assert.equal(
    await page.getByRole('button', { name: 'Adopt copy' }).isDisabled(),
    true,
    'a failed adoption invalidates the preview instead of leaving a stale action enabled',
  );
  await page.evaluate(() => globalThis.companyHostProof.setWritable(true));
  await page.getByRole('button', { name: 'Preview copy' }).click();
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByLabel('Acknowledge this preview’s listed losses').check();
  await page.getByRole('button', { name: 'Adopt copy' }).click();
  const proof = await page.evaluate(() => ({
    adoptCalls: globalThis.companyHostProof.calls.adopt,
    adopted: document.body.dataset.adopted,
    bundle: globalThis.companyHostProof.getState().bundle,
  }));
  assert.equal(proof.adoptCalls, 1);
  assert.equal(proof.adopted, proof.bundle.bundleDigest);
  assert.equal(proof.bundle.diagramId, 'company-checkout');
  assert.equal(proof.bundle.document.title, 'Company checkout');
  assert.equal(proof.bundle.originalSource.text, supported);

  await exportTab.click();
  await page.getByRole('button', { name: 'Preview Mermaid export' }).click();
  assert.equal(await page.getByRole('button', { name: 'Download Mermaid copy' }).count(), 1);
  await page.evaluate(() => globalThis.companyHostProof.setReadable(false));
  await page.getByRole('button', { name: 'Download Mermaid copy' }).click();
  assert.match(await page.getByRole('alert').innerText(), /access has changed/u);
});

test('the canonical source panel bounds pasted input, blocks stale upload adoption and maps displayed CRLF ranges', {
  skip: !enabled,
  timeout: 90_000,
}, async (t) => {
  const page = await companyHostFixture(t);
  const sourceInput = page.getByLabel('Mermaid source');
  const uploadInput = page.getByLabel('Upload Mermaid copy');
  const previewButton = page.getByRole('button', { name: 'Preview copy' });
  const adoptButton = page.getByRole('button', { name: 'Adopt copy' });

  await sourceInput.fill(partial);
  await previewButton.click();
  await page.getByLabel('Acknowledge this preview’s listed losses').check();
  assert.equal(await adoptButton.isEnabled(), true);

  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    let release;
    globalThis.slowMermaidUploadPending = false;
    File.prototype.arrayBuffer = function arrayBuffer() {
      if (this.name !== 'slow.mmd') return original.call(this);
      globalThis.slowMermaidUploadPending = true;
      return new Promise((resolve, reject) => {
        release = () => original.call(this).then(resolve, reject);
      });
    };
    globalThis.releaseSlowMermaidUpload = () => release?.();
  });
  await uploadInput.setInputFiles({
    name: 'slow.mmd',
    mimeType: 'text/plain',
    buffer: Buffer.from('flowchart TB\nOld[Stale]\n'),
  });
  await page.waitForFunction(() => globalThis.slowMermaidUploadPending === true);
  assert.equal(await previewButton.isDisabled(), true);
  assert.equal(await adoptButton.isDisabled(), true);
  await previewButton.evaluate((button) => button.click());
  await adoptButton.evaluate((button) => button.click());
  assert.equal(await page.evaluate(() => globalThis.companyHostProof.calls.adopt), 0);
  assert.equal(await page.locator('.de-source-fidelity').count(), 0);

  const latest = 'flowchart TB\nLatest[Typed]\n';
  await sourceInput.fill(latest);
  assert.equal(await previewButton.isEnabled(), true);
  await page.evaluate(() => globalThis.releaseSlowMermaidUpload());
  await page.waitForTimeout(20);
  assert.equal(await sourceInput.inputValue(), latest);

  const oversizedPaste = `flowchart TB\n${'A[One]\n'.repeat(10_000)}`;
  assert.equal(Buffer.byteLength(oversizedPaste) > 65_536, true);
  await sourceInput.evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, oversizedPaste);
  assert.equal(await sourceInput.inputValue(), oversizedPaste);
  assert.equal(await page.locator('.de-source-lines').innerText(), '…');
  assert.equal(await previewButton.isDisabled(), true);
  assert.equal(await adoptButton.isDisabled(), true);
  assert.match(await page.getByRole('alert').innerText(), /64 KiB import limit/u);

  const invalid = 'flowchart TB\r\nA[Été]\r\ninvalid???\r\n';
  await sourceInput.fill(invalid);
  assert.equal(await previewButton.isEnabled(), true);
  assert.equal(await page.getByRole('alert').count(), 0);
  await previewButton.click();
  await page.getByRole('button', { name: /Error at line 3/u }).click();
  const byteRangeSelection = await sourceInput.evaluate((input) => ({
    start: input.selectionStart,
    end: input.selectionEnd,
    value: input.value,
    selected: input.value.slice(input.selectionStart, input.selectionEnd),
  }));
  assert.equal(byteRangeSelection.selected, 'invalid???');
  assert.equal(byteRangeSelection.start, byteRangeSelection.value.indexOf('invalid???'));
  assert.equal(byteRangeSelection.end, byteRangeSelection.start + 'invalid???'.length);

  const unclosed = 'flowchart TB\r\nsubgraph Group[Container]\r\nA[One]\r\n';
  await sourceInput.fill(unclosed);
  await previewButton.click();
  await page.getByRole('button', { name: /Error at line 3.*no end/u }).click();
  const lineSelection = await sourceInput.evaluate((input) => ({
    start: input.selectionStart,
    end: input.selectionEnd,
    value: input.value,
    selected: input.value.slice(input.selectionStart, input.selectionEnd),
  }));
  assert.equal(lineSelection.selected, 'A[One]');
  assert.equal(lineSelection.start, lineSelection.value.indexOf('A[One]'));
  assert.equal(lineSelection.end, lineSelection.start + 'A[One]'.length);
});

test('a new local diagram previews and adopts an exact Mermaid copy only after loss acknowledgement', {
  skip: !enabled,
  timeout: 90_000,
}, async (t) => {
  const { page, store } = await fixture(t);
  let panel = await open(page);
  await panel.getByRole('tab', { name: 'Import a copy' }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await panel.getByRole('tab', { name: 'Export a copy' }).getAttribute('aria-selected'),
    'true',
  );
  await page.keyboard.press('ArrowLeft');
  assert.equal(
    await panel.getByRole('tab', { name: 'Import a copy' }).getAttribute('aria-selected'),
    'true',
  );
  await panel.getByLabel('Mermaid source').fill(supported);
  await panel.getByRole('button', { name: 'Preview copy' }).click();
  assert.match(
    await panel.getByRole('status').innerText(),
    /Preview ready: 3 nodes, 2 connectors, 2 containers/u,
    await panel.innerText(),
  );
  assert.equal(
    await panel.getByText('Container · container: Platform', { exact: false }).count(),
    1,
  );
  assert.equal(await panel.getByText('Node · data-store', { exact: false }).count(), 1);
  assert.ok(await panel.locator('.de-source-lines').innerText());
  assert.equal(await panel.getByText('Authored layout').count(), 1);
  assert.equal(await panel.getByText('Original source text').count(), 1);
  assert.equal(await panel.getByRole('button', { name: 'Adopt copy' }).isDisabled(), true);
  await panel.getByLabel('Acknowledge this preview’s listed losses').check();
  await panel.getByRole('button', { name: 'Adopt copy' }).click();
  assert.equal(await dialog(page).count(), 0);
  assert.equal((await store.read()).status, 'absent', 'adoption is still unsaved');
  await page.getByRole('button', { name: 'Save diagram' }).click();
  await page.getByText('Saved', { exact: true }).waitFor();
  const saved = await store.read();
  assert.equal(saved.status, 'ready');
  assert.equal(saved.bundle.document.title, 'Untitled diagram');
  assert.equal(saved.bundle.document.accessibility.title, 'Untitled diagram');
  assert.equal(saved.bundle.originalSource.text, supported);
  assert.equal(saved.bundle.sourceMap.entries.length > 0, true);
  await page.reload();
  await page.locator('[data-editor-svg]').waitFor();
  assert.equal(await page.locator('[data-editor-svg] [data-element-id="a"]').count(), 1);
  panel = await open(page);
  assert.equal(
    await panel.getByLabel('Mermaid source').inputValue(),
    supported,
    'closing/reopening keeps pending input in the tab',
  );
  await panel.getByRole('button', { name: 'Preview copy' }).click();
  assert.equal(
    await panel.getByRole('button', { name: 'Adopt copy' }).isDisabled(),
    true,
    'published document cannot be overwritten by an import',
  );
});

test('unsafe and changed source leave the diagram untouched and diagnostics navigate original bytes', {
  skip: !enabled,
  timeout: 90_000,
}, async (t) => {
  const { page, store } = await fixture(t);
  const panel = await open(page);
  const source = 'flowchart TB\r\nA[Été]\r\ninvalid???\r\n';
  await panel.getByLabel('Mermaid source').fill(source);
  await panel.getByRole('button', { name: 'Preview copy' }).click();
  assert.match(await panel.getByRole('status').innerText(), /Import rejected/u);
  await panel.getByRole('button', { name: /Error at line 3/u }).click();
  assert.equal(await panel.getByText('No object was created.', { exact: true }).count(), 1);
  const selection = await panel.getByLabel('Mermaid source').evaluate((input) => ({
    start: input.selectionStart,
    end: input.selectionEnd,
    value: input.value,
    selected: input.value.slice(input.selectionStart, input.selectionEnd),
  }));
  assert.equal(selection.selected, 'invalid???');
  assert.equal(selection.start, selection.value.indexOf('invalid???'));
  assert.equal(selection.end, selection.start + 'invalid???'.length);
  assert.equal((await store.read()).status, 'absent');
  const unclosed = 'flowchart TB\r\nsubgraph Group[Container]\r\nA[One]\r\n';
  await panel.getByLabel('Mermaid source').fill(unclosed);
  await panel.getByRole('button', { name: 'Preview copy' }).click();
  await panel.getByRole('button', { name: /Error at line 3.*no end/u }).click();
  const fallbackSelection = await panel.getByLabel('Mermaid source').evaluate((input) => ({
    start: input.selectionStart,
    end: input.selectionEnd,
    value: input.value,
    selected: input.value.slice(input.selectionStart, input.selectionEnd),
  }));
  assert.equal(fallbackSelection.selected, 'A[One]');
  assert.equal(fallbackSelection.start, fallbackSelection.value.indexOf('A[One]'));
  assert.equal(
    fallbackSelection.end,
    fallbackSelection.start + 'A[One]'.length,
    'a diagnostic without a byte range focuses its exact displayed source line',
  );
  await panel.getByLabel('Mermaid source').fill(partial);
  await panel.getByRole('button', { name: 'Preview copy' }).click();
  assert.equal(
    await page.getByRole('alert').count(),
    0,
    'a corrected preview clears the prior parser alert',
  );
  await panel.getByLabel('Acknowledge this preview’s listed losses').check();
  assert.equal(await panel.getByRole('button', { name: 'Adopt copy' }).isEnabled(), true);
  await panel.getByLabel('Mermaid source').fill(partial.replace('Start', 'Begin'));
  assert.equal(await panel.getByRole('button', { name: 'Adopt copy' }).isDisabled(), true);
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(
    await page
      .getByRole('button', { name: 'More', exact: true })
      .evaluate((button) => document.activeElement === button),
    true,
  );
  assert.equal((await store.read()).status, 'absent');
  await open(page);
  assert.equal(
    await dialog(page).getByLabel('Mermaid source').inputValue(),
    partial.replace('Start', 'Begin'),
  );
});

test('unsafe, oversized, invalid UTF-8 and unsupported copies are rejected without replacing the last source', {
  skip: !enabled,
  timeout: 90_000,
}, async (t) => {
  const { page, store } = await fixture(t);
  const panel = await open(page);
  const sourceInput = panel.getByLabel('Mermaid source');
  const uploadInput = panel.getByLabel('Upload Mermaid copy');
  const adoptButton = panel.getByRole('button', { name: 'Adopt copy' });

  await sourceInput.fill(partial);
  await panel.getByRole('button', { name: 'Preview copy' }).click();
  await panel.getByLabel('Acknowledge this preview’s listed losses').check();
  assert.equal(await adoptButton.isEnabled(), true);

  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    let release;
    globalThis.slowMermaidUploadPending = false;
    File.prototype.arrayBuffer = function arrayBuffer() {
      if (this.name !== 'slow.mmd') return original.call(this);
      globalThis.slowMermaidUploadPending = true;
      return new Promise((resolve, reject) => {
        release = () => original.call(this).then(resolve, reject);
      });
    };
    globalThis.releaseSlowMermaidUpload = () => release?.();
  });
  await uploadInput.setInputFiles({
    name: 'slow.mmd',
    mimeType: 'text/plain',
    buffer: Buffer.from('flowchart TB\nOld[Stale]\n'),
  });
  const previewButton = panel.getByRole('button', { name: 'Preview copy' });
  await page.waitForFunction(() => globalThis.slowMermaidUploadPending === true);
  assert.equal(await previewButton.isDisabled(), true);
  assert.equal(await adoptButton.isDisabled(), true);
  await previewButton.evaluate((button) => button.click());
  await adoptButton.evaluate((button) => button.click());
  assert.equal((await store.read()).status, 'absent');
  assert.equal(
    await panel.locator('.de-source-fidelity').count(),
    0,
    'a pending upload cannot preview or adopt the retained older source',
  );
  await sourceInput.fill('flowchart TB\nLatest[Typed]\n');
  assert.equal(
    await previewButton.isEnabled(),
    true,
    'typing cancels the pending upload and makes the latest source previewable',
  );
  await page.evaluate(() => globalThis.releaseSlowMermaidUpload());
  await page.waitForTimeout(20);
  assert.equal(
    await sourceInput.inputValue(),
    'flowchart TB\nLatest[Typed]\n',
    'a stale asynchronous upload cannot replace newer typed source',
  );

  const manyLines = `flowchart TB\n${'\n'.repeat(4_100)}A[One]\n`;
  await sourceInput.evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, manyLines);
  assert.match(
    await panel.locator('.de-source-lines').innerText(),
    /4103$/u,
    'line numbers mirror every line within the bounded source size',
  );
  const oversizedPaste = `flowchart TB\n${'A[One]\n'.repeat(10_000)}`;
  assert.equal(Buffer.byteLength(oversizedPaste) > 65_536, true);
  await sourceInput.evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, oversizedPaste);
  assert.equal(
    await sourceInput.inputValue(),
    oversizedPaste,
    'an oversized pasted copy remains available for correction',
  );
  assert.equal(
    await panel.locator('.de-source-lines').innerText(),
    '…',
    'the gutter does not allocate one entry for every oversized line',
  );
  assert.equal(await previewButton.isDisabled(), true);
  assert.equal(await adoptButton.isDisabled(), true);
  await panel
    .getByRole('alert')
    .filter({ hasText: 'This source exceeds the 64 KiB import limit.' })
    .waitFor();
  await sourceInput.fill(partial);
  assert.equal(await previewButton.isEnabled(), true);
  assert.equal(await panel.getByRole('alert').count(), 0);

  await uploadInput.setInputFiles({
    name: 'invalid-utf8.mmd',
    mimeType: 'text/plain',
    buffer: Buffer.from([0xc3, 0x28]),
  });
  await panel.getByRole('status').filter({ hasText: 'This file is not valid UTF-8.' }).waitFor();
  assert.equal(await sourceInput.inputValue(), partial);
  assert.equal(await adoptButton.isDisabled(), true);

  await uploadInput.setInputFiles({
    name: 'oversized.mmd',
    mimeType: 'text/plain',
    buffer: Buffer.alloc(65_537, 0x61),
  });
  await panel
    .getByRole('status')
    .filter({ hasText: 'This source exceeds the 64 KiB import limit.' })
    .waitFor();
  assert.equal(await sourceInput.inputValue(), partial);
  assert.equal(await adoptButton.isDisabled(), true);

  const unsafe = 'flowchart TB\nA[Start]\n%%{init: {"theme": "dark"}}\n';
  await sourceInput.fill(unsafe);
  await panel.getByRole('button', { name: 'Preview copy' }).click();
  assert.match(await panel.getByRole('status').innerText(), /Import rejected/u);
  assert.match(
    await panel.getByRole('button', { name: /Error at line 3/u }).innerText(),
    /Executable directives or external resources/u,
  );
  assert.equal(await sourceInput.inputValue(), unsafe);

  const unsupported = 'sequenceDiagram\nA->>B: hello\n';
  await sourceInput.fill(unsupported);
  await panel.getByRole('button', { name: 'Preview copy' }).click();
  assert.match(await panel.getByRole('status').innerText(), /Import rejected/u);
  assert.match(
    await panel
      .getByRole('button', { name: /Error at line 1/u })
      .first()
      .innerText(),
    /certified flowchart/u,
  );
  assert.equal(await sourceInput.inputValue(), unsupported);
  assert.equal(await adoptButton.isDisabled(), true);
  assert.equal((await store.read()).status, 'absent');
  assert.equal((await store.history()).length, 0);
});

test('ambiguous correspondence diagnostics select their original range and continuing canvas object', {
  skip: !enabled,
  timeout: 90_000,
}, async (t) => {
  const original = previewMermaidCopy('flowchart TB\nA[One]\nB[Two]\nA --> B\n', {
    diagramId: 'checkout',
  });
  const initial = adoptMermaidCopy(original, original.acknowledgement).bundle;
  const { page, store } = await fixture(t, { initial });
  const before = await store.read();
  const relationId = initial.document.relations[0].id;
  const panel = await open(page);
  const ambiguous = 'flowchart TB\nA[One]\nB[Two]\nA --> B\nA --> B\n';

  await panel.getByLabel('Mermaid source').fill(ambiguous);
  await panel.getByRole('button', { name: 'Preview copy' }).click();
  const diagnostic = panel.getByRole('button', {
    name: /Error at line 5.*stable distinct identity/u,
  });
  await diagnostic.click();
  assert.equal(
    await panel
      .getByLabel('Mermaid source')
      .evaluate((input) => input.value.slice(input.selectionStart, input.selectionEnd)),
    'A --> B',
  );
  assert.equal(
    await page
      .locator(`[data-editor-svg] [data-element-id="${relationId}"]`)
      .getAttribute('data-selected'),
    'true',
    'the diagnostic identifies the continuing connector on the canvas',
  );
  assert.deepEqual(await store.read(), before);
});

test('the shared source dialog guards property drafts, traps focus and remains readable at desktop and tablet widths', {
  skip: !enabled,
  timeout: 90_000,
}, async (t) => {
  const converted = previewMermaidCopy('flowchart LR\nA[Start]\n', {
    diagramId: 'checkout',
  });
  const initial = adoptMermaidCopy(converted, converted.acknowledgement).bundle;
  const { page } = await fixture(t, {
    initial,
    viewport: { width: 1440, height: 900 },
  });
  await page.locator('[data-editor-svg] [data-element-id="a"]').click();
  const label = page.getByLabel('Label', { exact: true });
  await label.fill('Unapplied source-panel guard');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Mermaid copies', exact: true }).click();
  assert.equal(await dialog(page).count(), 0);
  await page
    .getByRole('alert')
    .filter({
      hasText: 'Apply or revert property changes before selecting another object.',
    })
    .waitFor();
  assert.equal(await label.evaluate((input) => input === document.activeElement), true);
  await page.getByRole('button', { name: 'Revert', exact: true }).click();

  const more = page.getByRole('button', { name: 'More', exact: true });
  await more.click();
  await page.getByRole('menuitem', { name: 'Mermaid copies', exact: true }).click();
  const panel = dialog(page);
  await panel.waitFor();
  assert.equal(await panel.getAttribute('aria-modal'), 'true');
  for (const selector of ['.de-bar', '.de-work']) {
    assert.equal(await page.locator(selector).getAttribute('inert'), '');
    assert.equal(await page.locator(selector).getAttribute('aria-hidden'), 'true');
  }

  const tabs = panel.getByRole('tablist', {
    name: 'Mermaid copy options',
  });
  for (const tab of await tabs.getByRole('tab').all()) {
    const [id, controls] = await Promise.all([
      tab.getAttribute('id'),
      tab.getAttribute('aria-controls'),
    ]);
    assert.ok(id);
    assert.ok(controls);
    const tabpanel = panel.locator(`[id="${controls}"]`);
    assert.equal(await tabpanel.count(), 1);
    assert.equal(await tabpanel.getAttribute('role'), 'tabpanel');
    assert.equal(await tabpanel.getAttribute('aria-labelledby'), id);
  }
  const importTab = panel.getByRole('tab', { name: 'Import a copy' });
  const exportTab = panel.getByRole('tab', { name: 'Export a copy' });
  assert.equal(await importTab.getAttribute('aria-selected'), 'true');
  assert.equal(await importTab.getAttribute('tabindex'), '0');
  assert.equal(await exportTab.getAttribute('tabindex'), '-1');
  await importTab.focus();
  await page.keyboard.press('End');
  assert.equal(await exportTab.getAttribute('aria-selected'), 'true');
  assert.equal(await exportTab.evaluate((tab) => tab === document.activeElement), true);
  await page.keyboard.press('Home');
  assert.equal(await importTab.getAttribute('aria-selected'), 'true');

  await importTab.focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(
    await panel
      .getByRole('button', { name: 'Close', exact: true })
      .evaluate((button) => button === document.activeElement),
    true,
    'backward Tab wraps to the last visible dialog control',
  );
  await page.keyboard.press('Tab');
  assert.equal(
    await importTab.evaluate((tab) => tab === document.activeElement),
    true,
    'forward Tab wraps to the first visible dialog control',
  );

  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 768, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const geometry = await panel.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          background: style.backgroundColor,
          color: style.color,
          overflow: node.scrollWidth > node.clientWidth,
        };
      });
      assert.ok(geometry.left >= 0 && geometry.top >= 0);
      assert.ok(
        geometry.right <= viewport.width && geometry.bottom <= viewport.height,
        `${colorScheme} dialog fits ${viewport.width}×${viewport.height}`,
      );
      assert.notEqual(geometry.background, 'rgba(0, 0, 0, 0)');
      assert.notEqual(geometry.background, geometry.color);
      assert.equal(geometry.overflow, false);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
    }
  }

  await page.keyboard.press('Escape');
  assert.equal(await dialog(page).count(), 0);
  assert.equal(
    await more.evaluate((button) => button === document.activeElement),
    true,
    'Escape returns focus to the command that opened the dialog',
  );
  for (const selector of ['.de-bar', '.de-work']) {
    assert.equal(await page.locator(selector).getAttribute('inert'), null);
    assert.equal(await page.locator(selector).getAttribute('aria-hidden'), null);
  }
});

test('export discloses losses and offers the complete bundle, Mermaid copy and SVG separately', {
  skip: !enabled,
  timeout: 90_000,
}, async (t) => {
  const converted = previewMermaidCopy('flowchart LR\nA[Start]\n', {
    diagramId: 'checkout',
  });
  const initial = adoptMermaidCopy(converted, converted.acknowledgement).bundle;
  const { page } = await fixture(t, {
    initial,
    viewport: { width: 390, height: 844 },
  });
  const panel = await open(page);
  await panel.getByRole('tab', { name: 'Export a copy' }).click();
  await panel.getByRole('button', { name: 'Preview Mermaid export' }).click();
  assert.match(
    await panel.getByLabel('Conversion losses').innerText(),
    /coordinates|routes|attachment|placement/iu,
  );
  assert.equal((await panel.getByText('Authored layout').count()) > 0, true);
  assert.match(
    await panel.getByLabel('Export format contents').innerText(),
    /semantic document.*original source.*SVG snapshot.*visual-only/isu,
  );
  const bundleDownload = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download editable bundle' }).click();
  const bundleFile = await bundleDownload;
  assert.match(bundleFile.suggestedFilename(), /planr-diagram-bundle\.json$/u);
  const downloadedBundle = JSON.parse(readFileSync(await bundleFile.path(), 'utf8'));
  assert.equal(downloadedBundle.document.nodes[0].id, 'a');
  assert.ok(downloadedBundle.presentation.elements.length);
  assert.ok(downloadedBundle.originalSource.text);
  assert.ok(downloadedBundle.sourceMap.entries.length);
  const mermaidDownload = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download Mermaid copy' }).click();
  const mermaidFile = await mermaidDownload;
  assert.match(mermaidFile.suggestedFilename(), /\.mmd$/u);
  assert.match(readFileSync(await mermaidFile.path(), 'utf8'), /^flowchart LR/u);
  const svgDownload = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download SVG snapshot' }).click();
  const svgFile = await svgDownload;
  assert.match(svgFile.suggestedFilename(), /\.svg$/u);
  assert.match(readFileSync(await svgFile.path(), 'utf8'), /<svg\b/u);
  assert.equal(await panel.getByRole('button', { name: /link|watch|overwrite/iu }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const more = page.getByRole('button', { name: 'More', exact: true });
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await dialog(page).count(), 0);
  assert.equal(
    await more.evaluate((button) => button === document.activeElement),
    true,
    'Export provides a visible close action and restores the opener',
  );
});

test('uploaded copies stay unlinked and produce an inspectable visual snapshot', {
  skip: !enabled,
  timeout: 90_000,
}, async (t) => {
  const { page, store } = await fixture(t);
  const panel = await open(page);
  const uploaded = `\uFEFF${supported.replace(/\n/gu, '\r\n')}`;
  await panel.getByLabel('Upload Mermaid copy').setInputFiles({
    name: 'checkout.mmd',
    mimeType: 'text/plain',
    buffer: Buffer.from(uploaded),
  });
  await panel.getByRole('status').filter({ hasText: 'unlinked local copy' }).waitFor();
  assert.equal(
    await panel.getByLabel('Mermaid source').inputValue(),
    `\uFEFF${supported}`,
    'the textarea shows normalized lines while retaining the UTF-8 BOM',
  );
  assert.match(await panel.getByRole('status').innerText(), /unlinked local copy/u);
  await panel.getByRole('button', { name: 'Preview copy' }).click();
  assert.match(await panel.getByRole('status').innerText(), /Preview ready/u);
  await panel.getByLabel('Acknowledge this preview’s listed losses').check();
  await panel.getByRole('button', { name: 'Adopt copy' }).click();
  assert.equal((await store.read()).status, 'absent');
  await page.reload();
  await page.locator('[data-editor-svg]').waitFor();
  assert.equal(await page.locator('.de-title').innerText(), 'Untitled diagram');
  assert.equal((await store.read()).status, 'absent', 'recovery before save creates no revision');
  await page.getByRole('button', { name: 'Save diagram' }).click();
  await page.getByText('Saved', { exact: true }).waitFor();
  const saved = await store.read();
  assert.equal(saved.bundle.originalSource.text, uploaded);
  assert.equal(saved.bundle.document.title, 'Untitled diagram');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Mermaid copies', exact: true }).click();
  const reopened = dialog(page);
  await reopened.getByRole('tab', { name: 'Export a copy' }).click();
  const visualDownload = page.waitForEvent('download');
  await reopened.getByRole('button', { name: 'Download SVG snapshot' }).click();
  assert.match((await visualDownload).suggestedFilename(), /\.svg$/u);
  const bundleDownload = page.waitForEvent('download');
  await reopened.getByRole('button', { name: 'Download editable bundle' }).click();
  assert.match((await bundleDownload).suggestedFilename(), /planr-diagram-bundle\.json$/u);
});

test('visual export explains invalid geometry while the complete bundle remains available', {
  skip: !enabled,
  timeout: 90_000,
}, async (t) => {
  const longSource = `flowchart LR\nA[${'long '.repeat(40)}]\n`;
  const converted = previewMermaidCopy(longSource, { diagramId: 'checkout' });
  const initial = adoptMermaidCopy(converted, converted.acknowledgement).bundle;
  const { page } = await fixture(t, { initial });
  const panel = await open(page);
  await panel.getByRole('tab', { name: 'Export a copy' }).click();
  await panel.getByRole('button', { name: 'Download SVG snapshot' }).click();
  assert.match(await panel.getByRole('alert').innerText(), /valid layout.*Label/u);
  const bundleDownload = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download editable bundle' }).click();
  assert.match((await bundleDownload).suggestedFilename(), /planr-diagram-bundle\.json$/u);
});
