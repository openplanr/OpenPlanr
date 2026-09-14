import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { designFixture } from './design-fixture.mjs';
import { prepareDesignDocument, renderDesignDocument, currentDesign } from '../lib/design/document.mjs';
import { startDesignReview, saveDesignState } from '../lib/design/review.mjs';
import { verifyDesignDocument } from '../lib/design/utility.mjs';

function fixture(t, options) { const root = mkdtempSync(join(tmpdir(), 'planr-design-')); t.after(() => rmSync(root, { recursive: true, force: true })); return { root, ...designFixture(root, options) }; }

test('one authored source generates all views and recoverable revision snapshots', async (t) => {
  const { root, file } = fixture(t);
  const prepared = prepareDesignDocument(file);
  assert.equal(prepared.envelope.artifacts.length, 4);
  assert.equal(prepared.envelope.artifacts[0].html, prepared.envelope.artifacts[1].html);
  const rendered = await renderDesignDocument(file);
  for (const path of Object.values(rendered.views)) { const html = readFileSync(path, 'utf8'); assert.match(html, /data-design-studio/); assert.match(html, /data:text\/javascript;base64/); }
  const initial = currentDesign(file);
  writeFileSync(join(root, 'source/screen-1.html'), readFileSync(join(root, 'source/screen-1.html'), 'utf8').replace('12 active tasks', '15 active tasks'));
  await assert.rejects(renderDesignDocument(file, { beforeCommit: () => { throw new Error('interrupted'); } }), /interrupted/);
  assert.equal(currentDesign(file).revision, initial.revision);
  assert.ok(!readdirSync(join(root, '.design')).some((name) => name.startsWith('pending-')));
  const second = await renderDesignDocument(file);
  assert.notEqual(second.revision, initial.revision);
  assert.match(readFileSync(join(initial.directory, 'sources/source/screen-1.html'), 'utf8'), /12 active tasks/);
});

test('thin handoff, missing assets, and lint errors cannot replace the current design', async (t) => {
  const { root, file } = fixture(t, { source: 'png' });
  const initial = await renderDesignDocument(file);
  writeFileSync(join(root, 'design-spec.md'), '## 1. Color Palette\nOnly one section.');
  await assert.rejects(renderDesignDocument(file), /missing section 2/);
  assert.equal(currentDesign(file).revision, initial.revision);
  rmSync(join(root, 'source/style.css'));
  await assert.rejects(renderDesignDocument(file), /style.css/);
});

test('custom project tokens and frames are accepted; layout evidence never implies journey verification', async (t) => {
  const { file, document } = fixture(t, { count: 12, variants: 3, frames: [{ id: 'custom', label: 'App width', width: 1320, height: 920 }] });
  document.designSystem = { spacing: [0, 4, 8, 16, 24] }; writeFileSync(file, JSON.stringify(document));
  await renderDesignDocument(file);
  const current = currentDesign(file);
  assert.equal(current.entries.length, 36);
  const result = verifyDesignDocument(file, { revision: current.revision, status: 'passed', checkedArtifacts: current.entries.map((item) => item.artifactId), issues: [] });
  assert.equal(result.status, 'unverified');
});

test('studio uses durable artifact server, health checks, and conflicting state writes are rejected', async (t) => {
  const { root, file } = fixture(t);
  await renderDesignDocument(file);
  const env = { ...process.env, PLANR_HOME: join(root, 'home') };
  const session = await startDesignReview(file, { env }); t.after(() => session.close());
  const page = await fetch(session.url); assert.equal(page.status, 200); assert.match(await page.text(), /data-design-studio/);
  const initial = await fetch(`${session.url}api/design-state`).then((r) => r.json());
  const saved = await saveDesignState(file, { ...initial, state: { view: 'prototype', ratings: { A: 5 } } });
  assert.equal(saved.stateVersion, 1);
  await assert.rejects(saveDesignState(file, { ...initial, state: { view: 'canvas' } }), /another window/);
  const restored = await fetch(`${session.url}api/design-state`).then((r) => r.json()); assert.equal(restored.state.ratings.A, 5);
  const reuse = await startDesignReview(file, { env }); assert.equal(reuse.url, session.url); assert.equal(reuse.reused, true);
});
