import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { designFixture } from './design-fixture.mjs';
import { atomicJson, currentDesign, prepareDesignDocument, renderDesignDocument } from '../lib/design/document.mjs';
import { saveDesignState, startDesignReview } from '../lib/design/review.mjs';
import { designUtility, verifyDesignDocument } from '../lib/design/utility.mjs';

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const payload = (html) => JSON.parse(/<script type="application\/json" id="planr-design-studio-payload">([\s\S]*?)<\/script>/u.exec(html)[1]);
function fixture(t, options) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'planr-publication-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, ...designFixture(root, options) };
}

test('failed alternatives with unfinished source paths do not block available designs', async (t) => {
  const { file, document } = fixture(t, { variants: 3 });
  document.variants[2] = { ...document.variants[2], status: 'failed', issue: 'Interrupted generation', sources: { 'screen-1': { html: 'source/unfinished.html' } } };
  writeFileSync(file, JSON.stringify(document));
  const prepared = prepareDesignDocument(file);
  assert.equal(prepared.entries.length, 8);
  assert.equal(prepared.document.variants[2].status, 'failed');
  assert.ok(!prepared.sourceFiles.includes('source/unfinished.html'));
  const result = await renderDesignDocument(file);
  assert.ok(existsSync(result.artifact));
});

test('portable and live exports retain the board selection, layout and refinement state', async (t) => {
  const { root, file } = fixture(t, { variants: 2 });
  await renderDesignDocument(file);
  const current = currentDesign(file);
  const state = { view: 'walkthrough', selectedVariant: 'B', variantId: 'A', positions: { [current.entries[0].artifactId]: { x: 42, y: 84 } }, ratings: { A: 2, B: 5 }, remix: { B: 'Keep the dense layout' }, preferences: { selected: ['B'], rejected: ['A'] } };
  const saved = await saveDesignState(file, { state, revision: current.revision, stateVersion: 0 });
  assert.deepEqual(json(saved.tastePath).designs.operations.selected, ['B']);
  assert.deepEqual(json(saved.tastePath).designs.operations.rejected, ['A']);
  assert.equal(json(saved.tastePath).designs.operations.remix.B, 'Keep the dense layout');
  const output = join(root, 'export.html');
  await designUtility(['export', file, '--view', 'prototype', '--output', output], { stdout() {} });
  const exported = payload(readFileSync(output, 'utf8'));
  assert.equal(exported.state.selectedVariant, 'B');
  assert.equal(exported.state.variantId, 'B');
  assert.equal(exported.state.view, 'prototype');
  assert.deepEqual(exported.state.positions, state.positions);
  assert.equal(json(file).selectedVariant, 'A', 'a provisional board selection does not silently author the semantic handoff');
  const session = await startDesignReview(file, { env: { ...process.env, PLANR_HOME: join(root, 'home') } });
  t.after(() => session.close());
  const live = payload(await (await fetch(`${session.url}api/design-export`)).text());
  assert.equal(live.state.selectedVariant, 'B');
  assert.deepEqual(live.state.positions, state.positions);
});

test('independent design boards preserve each others project preferences under concurrent saves', async (t) => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'planr-project-taste-')));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, '.planr'));
  const designs = ['alpha', 'beta'].map((id) => {
    const value = designFixture(join(project, id), { variants: 2 });
    value.document.id = id; writeFileSync(value.file, JSON.stringify(value.document)); return value;
  });
  for (const design of designs) await renderDesignDocument(design.file);
  const saves = await Promise.all(designs.map((design) => saveDesignState(design.file, { revision: currentDesign(design.file).revision, stateVersion: 0, state: { selectedVariant: 'B', ratings: { B: 5 }, remix: { B: design.document.id }, preferences: { selected: ['B'], rejected: [] } } })));
  assert.equal(saves[0].tastePath, saves[1].tastePath);
  const taste = json(saves[0].tastePath);
  assert.deepEqual(Object.keys(taste.designs).sort(), ['alpha', 'beta']);
  assert.equal(taste.designs.alpha.remix.B, 'alpha');
  assert.equal(taste.designs.beta.remix.B, 'beta');
});

test('publication failure restores exact compatibility bytes while retaining the previous live pointer', async (t) => {
  const { root, file } = fixture(t);
  const initial = await renderDesignDocument(file);
  const priorManifest = readFileSync(join(root, 'finalized.json'));
  const priorPointer = readFileSync(join(root, '.design/current.json'));
  writeFileSync(join(root, 'source/screen-1.html'), readFileSync(join(root, 'source/screen-1.html'), 'utf8').replace('12 active tasks', '19 active tasks'));
  await assert.rejects(renderDesignDocument(file, { writePointer() { throw new Error('Pointer replacement failed'); } }), /Pointer replacement failed/u);
  assert.deepEqual(readFileSync(join(root, 'finalized.json')), priorManifest);
  assert.deepEqual(readFileSync(join(root, '.design/current.json')), priorPointer);
  assert.equal(currentDesign(file).revision, initial.revision);
  assert.equal(existsSync(join(root, '.design/publication.json')), false);
});

test('dead publication journals recover correctly before and after the pointer was committed', async (t) => {
  const { root, file } = fixture(t);
  const first = await renderDesignDocument(file), firstPointer = json(join(root, '.design/current.json'));
  const firstManifest = readFileSync(join(root, 'finalized.json'));
  const second = await renderDesignDocument(file, { rendererRevision: 'upgraded-renderer' });
  const secondPointer = json(join(root, '.design/current.json')), secondManifest = json(join(root, 'finalized.json'));
  const journal = { revision: second.revision, previousRevision: first.revision, previousManifest: firstManifest.toString('base64'), manifest: secondManifest };
  atomicJson(join(root, '.design/current.json'), firstPointer);
  atomicJson(join(root, '.design/publication.json'), journal);
  assert.equal(currentDesign(file).revision, first.revision);
  assert.deepEqual(readFileSync(join(root, 'finalized.json')), firstManifest);
  atomicJson(join(root, '.design/current.json'), secondPointer);
  atomicJson(join(root, '.design/publication.json'), journal);
  assert.equal(currentDesign(file).revision, second.revision);
  assert.deepEqual(json(join(root, 'finalized.json')), secondManifest);
  assert.equal(existsSync(join(root, '.design/publication.json')), false);
});

test('renderer upgrades produce a new snapshot while identical renders retain immutable metadata', async (t) => {
  const { root, file } = fixture(t);
  const initial = await renderDesignDocument(file, { rendererRevision: 'renderer-one', now: () => '2026-09-09T09:00:00Z' });
  const repeated = await renderDesignDocument(file, { rendererRevision: 'renderer-one', now: () => '2026-09-09T10:00:00Z' });
  assert.equal(repeated.revision, initial.revision);
  assert.deepEqual(json(join(root, 'finalized.json')), currentDesign(file).manifest);
  assert.equal(currentDesign(file).manifest.framework, 'vanilla');
  const upgraded = await renderDesignDocument(file, { rendererRevision: 'renderer-two' });
  assert.notEqual(upgraded.revision, initial.revision);
  assert.ok(existsSync(initial.artifact));
});

test('verification needs valid screenshots and identity-matched rendered evidence for every frame', async (t) => {
  const { root, file } = fixture(t);
  await renderDesignDocument(file);
  const current = currentDesign(file);
  const path = join(root, 'screenshot.png');
  const report = {
    revision: current.revision, status: 'passed', checkedArtifacts: current.entries.map((entry) => entry.artifactId),
    screenshots: [path], scenarios: [{ name: 'Save workspace', status: 'passed' }], issues: [],
    screens: current.entries.map((entry) => ({ artifactId: entry.artifactId, screenId: entry.screenId, viewport: current.document.frames.find((frame) => frame.id === entry.frameId), checkedElements: 5, issues: [] })),
  };
  writeFileSync(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(verifyDesignDocument(file, report).status, 'unverified');
  // Valid 1×1 PNG fixture represents a completed image, not a visual-quality claim.
  writeFileSync(path, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6F8sAAAAASUVORK5CYII=', 'base64'));
  assert.equal(verifyDesignDocument(file, { ...report, screens: [] }).status, 'unverified');
  assert.equal(verifyDesignDocument(file, { ...report, scenarios: [{ status: 'passed' }] }).status, 'unverified');
  const wrongFrame = structuredClone(report); wrongFrame.screens[0].viewport.width = 1;
  assert.equal(verifyDesignDocument(file, wrongFrame).status, 'unverified');
  assert.equal(verifyDesignDocument(file, report).status, 'verified');
  const failing = structuredClone(report); failing.screens[0].issues.push({ severity: 'error', message: 'Content clipped' });
  assert.equal(verifyDesignDocument(file, failing).status, 'failed');
});
