import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  normalizeDiagramPresentation,
  validateVersionedDiagramAuthoringArtifact,
} from '@openplanr/protocol/studio-presentation-contracts';
import { makeBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import {
  compileDiagramCommand,
  createConditionalInverse,
  exportMermaidCopy,
  previewDiagramTransaction,
  previewMermaidCopy,
  validateAuthoringBundle,
} from '../lib/artifact/diagram/authoring/index.mjs';
import { createDiagramAuthoringStore } from '../lib/artifact/diagram/authoring/store.mjs';

const compile = (bundle, theme, transactionId = 'palette-light') =>
  compileDiagramCommand(
    bundle,
    { type: 'set-studio-presentation', presentation: normalizeDiagramPresentation({ theme }) },
    { transactionId },
  );
const accepted = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result;
};

test('explicit palette revisions preserve semantic content, old geometry themes and exact legacy undo', () => {
  const original = makeBundle('process', { source: true });
  const bytes = JSON.stringify(original);
  const light = accepted(compile(original, 'light'));
  assert.equal(JSON.stringify(original), bytes);
  assert.equal(light.bundle.schemaVersion, '1.1.0');
  assert.equal(light.transaction.schemaVersion, '1.1.0');
  assert.deepEqual(light.bundle.document, original.document);
  assert.deepEqual(light.bundle.presentation, original.presentation);
  assert.deepEqual(light.bundle.sourceMap, original.sourceMap);
  assert.notEqual(light.bundle.bundleDigest, original.bundleDigest);
  assert.equal(light.diff.semantic.length, 0);
  assert.equal(light.diff.presentation[0].collection, 'studio-presentation');
  assert.equal(validateAuthoringBundle(light.bundle).ok, true);
  const dark = accepted(compile(light.bundle, 'dark', 'palette-dark'));
  const stale = previewDiagramTransaction(dark.bundle, light.transaction);
  assert.equal(stale.ok, false);
  assert.equal(stale.diagnostics[0].rule, 'stale-base');
  const conflicted = createConditionalInverse(dark.bundle, light.inverse, {
    transactionId: 'undo-conflict',
  });
  assert.equal(conflicted.ok, false);
  assert.equal(conflicted.diagnostics[0].rule, 'inverse-conflict');
  const renamed = accepted(
    compileDiagramCommand(
      light.bundle,
      { type: 'rename', id: 'node-a', label: 'New label' },
      { transactionId: 'rename-after-palette' },
    ),
  );
  const undo = accepted(
    createConditionalInverse(renamed.bundle, light.inverse, { transactionId: 'undo-palette' }),
  );
  const restored = accepted(previewDiagramTransaction(renamed.bundle, undo.transaction)).bundle;
  assert.equal(restored.schemaVersion, '1.0.0');
  assert.equal(restored.document.nodes[0].label, 'New label');
  assert.equal(Object.hasOwn(restored, 'studioPresentation'), false);
  const directUndo = accepted(
    createConditionalInverse(light.bundle, light.inverse, { transactionId: 'undo-direct' }),
  );
  assert.deepEqual(
    accepted(previewDiagramTransaction(light.bundle, directUndo.transaction)).bundle,
    original,
  );
  assert.equal(compile(light.bundle, 'light').changed, false);
});

test('palette custody survives store restart and rejects a concurrent base without overwriting it', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'planr-presentation-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = makeBundle('process');
  const store = createDiagramAuthoringStore({ root, slug: 'checkout' });
  await store.initialize(original, { transactionId: 'initialize' });
  const light = accepted(compile(original, 'light'));
  const dark = accepted(compile(original, 'dark', 'concurrent-dark'));
  const saved = await store.commit(light.transaction);
  assert.equal(saved.status, 'saved');
  assert.deepEqual(
    (await createDiagramAuthoringStore({ root, slug: 'checkout' }).read()).bundle,
    light.bundle,
  );
  await assert.rejects(
    store.commit(dark.transaction),
    (error) =>
      error.code === 'E_DIAGRAM_STORE_INVALID_TRANSACTION' &&
      error.details.diagnostics.some((item) => item.rule === 'stale-base'),
  );
  assert.deepEqual((await store.read()).bundle, light.bundle);
  const undo = accepted(
    createConditionalInverse(light.bundle, light.inverse, { transactionId: 'undo-palette' }),
  );
  const restored = await store.commit(undo.transaction);
  assert.equal(restored.status, 'saved');
  assert.deepEqual(restored.bundle, original);
});

test('Mermaid refresh and fidelity bind the full versioned palette basis', () => {
  const source = 'flowchart TB\nA[Start]\nB[Done]\nA --> B\n';
  const original = accepted(previewMermaidCopy(source, { diagramId: 'palette-copy' })).bundle;
  const dark = accepted(compile(original, 'dark')).bundle;
  const refreshed = accepted(
    previewMermaidCopy(source, { diagramId: dark.diagramId, previousBundle: dark }),
  );
  assert.equal(refreshed.bundle.schemaVersion, '1.1.0');
  assert.deepEqual(refreshed.bundle.studioPresentation, dark.studioPresentation);
  assert.deepEqual(
    validateVersionedDiagramAuthoringArtifact('diagram-fidelity-report', refreshed.fidelity, {
      bundle: refreshed.bundle,
    }),
    [],
  );
  const exported = accepted(exportMermaidCopy(dark));
  assert.equal(exported.fidelity.basis.bundleDigest, dark.bundleDigest);
  assert.deepEqual(
    validateVersionedDiagramAuthoringArtifact('diagram-fidelity-report', exported.fidelity, {
      bundle: dark,
    }),
    [],
  );
  const legacyBasis = structuredClone(exported.fidelity);
  legacyBasis.basis.bundleDigest = original.bundleDigest;
  assert.ok(
    validateVersionedDiagramAuthoringArtifact('diagram-fidelity-report', legacyBasis, {
      bundle: dark,
    }).length,
  );
});
