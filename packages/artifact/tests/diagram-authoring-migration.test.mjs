import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { withDocumentDigest } from '@openplanr/protocol/canonical-json';
import { validateDiagramAuthoringBundle } from '@openplanr/protocol/diagram-authoring-contracts';
import {
  previewLegacyDiagramDocument,
  previewLegacyDiagramMigration,
} from '../lib/artifact/diagram/authoring/migration.mjs';
import { createDiagramAuthoringStore } from '../lib/artifact/diagram/authoring/store.mjs';
import { layoutDiagram, renderDiagram } from '../lib/artifact/diagram/index.mjs';

const fixturePath = new URL(
  '../fixtures/diagram/grammars/flowchart.planr-diagram.json',
  import.meta.url,
);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
function supported() {
  const doc = structuredClone(fixture);
  doc.nodes.forEach((node) => {
    node.kind = 'process';
  });
  doc.relations = [
    { id: 'flow', from: 'item-a', to: 'item-b', kind: 'flow', label: 'Continue', weight: null },
  ];
  doc.accessibility.readingOrder = ['item-a', 'flow', 'item-b'];
  return withDocumentDigest(doc);
}
async function workspace(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'diagram-migration-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function bytes(directory) {
  const entries = await readdir(directory);
  return Object.fromEntries(
    await Promise.all(entries.map(async (name) => [name, await readFile(join(directory, name))])),
  );
}

test('migration captures the legacy scene and semantic IDs in preview only', async (t) => {
  const root = await workspace(t),
    doc = supported();
  const legacy = layoutDiagram(doc);
  await renderDiagram(doc, { outputRoot: root });
  const directory = join(root, 'diagrams', doc.diagramId);
  const before = await bytes(directory);
  const preview = await previewLegacyDiagramMigration({ root, slug: doc.diagramId });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.equal(preview.sourceModified, false);
  assert.equal(preview.adoption, 'explicit-save-required');
  assert.deepEqual(validateDiagramAuthoringBundle(preview.bundle), []);
  assert.deepEqual(
    preview.bundle.document.nodes.map((node) => node.id),
    doc.nodes.map((node) => node.id),
  );
  for (const box of legacy.boxes) {
    assert.deepEqual(
      preview.bundle.presentation.elements.find((item) => item.elementId === box.id).bounds,
      { x: box.x, y: box.y, width: box.width, height: box.height },
    );
  }
  const route = preview.bundle.presentation.elements.find(
    (item) => item.elementId === 'flow',
  ).route;
  assert.deepEqual(
    route.points,
    legacy.edges[0].routePoints.map(([x, y]) => ({ x, y })),
  );
  assert.deepEqual(
    await bytes(directory),
    before,
    'Preview never creates or alters any source or output member',
  );
});

test('unsupported legacy kinds and grammars stay readable without fabricated semantics', async (t) => {
  const root = await workspace(t);
  await renderDiagram(fixture, { outputRoot: root });
  const result = await previewLegacyDiagramMigration({ root, slug: fixture.diagramId });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'unsupported-legacy-content');
  assert.equal(previewLegacyDiagramDocument({ ...fixture, documentDigest: 'invalid' }).ok, false);
});

test('migration refuses changed bytes, substituted output manifests and symlinked collections', async (t) => {
  const root = await workspace(t),
    doc = supported();
  await renderDiagram(doc, { outputRoot: root });
  const directory = join(root, 'diagrams', doc.diagramId);
  const svg = join(directory, `${doc.diagramId}.svg`);
  const original = await readFile(svg);
  await writeFile(svg, 'substituted');
  assert.equal((await previewLegacyDiagramMigration({ root, slug: doc.diagramId })).ok, false);
  await writeFile(svg, original);
  const manifestPath = join(directory, `${doc.diagramId}.manifest.json`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.diagramId = 'foreign';
  await writeFile(manifestPath, JSON.stringify(withDocumentDigest(manifest)));
  assert.equal((await previewLegacyDiagramMigration({ root, slug: doc.diagramId })).ok, false);
  const other = await workspace(t);
  await symlink(join(root, 'diagrams'), join(other, 'diagrams'));
  assert.equal(
    (await previewLegacyDiagramMigration({ root: other, slug: doc.diagramId })).diagnostics[0].code,
    'unsafe-legacy-path',
  );
});

test('explicit adoption preserves the legacy source and prevents a legacy renderer overwrite', async (t) => {
  const root = await workspace(t),
    doc = supported();
  await renderDiagram(doc, { outputRoot: root });
  const directory = join(root, 'diagrams', doc.diagramId);
  const before = await bytes(directory);
  const preview = await previewLegacyDiagramMigration({ root, slug: doc.diagramId });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  const store = createDiagramAuthoringStore({ root, slug: doc.diagramId });
  const saved = await store.initialize(preview.bundle, { transactionId: 'explicit-adoption' });
  assert.equal(saved.status, 'saved', JSON.stringify(saved));
  assert.equal((await store.read()).bundle.bundleDigest, preview.bundle.bundleDigest);
  await assert.rejects(renderDiagram(doc, { outputRoot: root }));
  for (const [name, contents] of Object.entries(before))
    assert.deepEqual(await readFile(join(directory, name)), contents);
  assert.equal((await store.read()).bundle.bundleDigest, preview.bundle.bundleDigest);
});
