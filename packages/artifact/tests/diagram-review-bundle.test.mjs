import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeBundle, sealBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import {
  assertDiagramReviewBundle,
  assertDiagramReviewFeedback,
  diagramReviewBundleDigest,
} from '../../protocol/src/diagram-review-contracts.mjs';
import { prepareDiagramShareBundle } from '../lib/artifact/diagram/review-bundle.mjs';
import { renderDiagram } from '../lib/artifact/diagram/runtime.mjs';
import { prepareDiagramSvg } from '../lib/artifact/ui/diagram-svg.mjs';

async function root(t) {
  const root = await mkdtemp(join(tmpdir(), 'planr-native-bundle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test('legacy sequence and swimlane reviews retain verified SVG and every semantic endpoint', async (t) => {
  const directory = await root(t);
  for (const grammar of ['sequence', 'swimlane']) {
    const document = JSON.parse(
      await readFile(
        new URL(`../fixtures/diagram/grammars/${grammar}.planr-diagram.json`, import.meta.url),
        'utf8',
      ),
    );
    await renderDiagram(document, { outputRoot: directory });
    const file = join(
      directory,
      'diagrams',
      document.diagramId,
      `${document.diagramId}.manifest.json`,
    );
    const original = await readFile(file, 'utf8'),
      bundle = await prepareDiagramShareBundle(file);
    assertDiagramReviewBundle(bundle);
    assert.equal(bundle.source.kind, 'manifest');
    assert.equal(bundle.diagramId, document.diagramId);
    for (const relation of bundle.scene.relations) {
      assert.ok(bundle.scene.items.some((item) => item.id === relation.from));
      assert.ok(bundle.scene.items.some((item) => item.id === relation.to));
    }
    assert.equal(await readFile(file, 'utf8'), original);
    assert.ok(!JSON.stringify(bundle).includes(directory));
  }
});
test('authored reviews preserve manual geometry and remove source correspondence without mutation', async (t) => {
  const directory = await root(t),
    file = join(directory, 'saved.json');
  const authored = makeBundle('swimlane', { source: true });
  authored.document.annotations[0].text = 'Note';
  const placement = authored.presentation.elements.find((item) => item.elementId === 'node-a');
  placement.bounds.x = -120;
  placement.bounds.y = 90;
  sealBundle(authored);
  await writeFile(file, JSON.stringify(authored));
  const original = await readFile(file, 'utf8'),
    bundle = await prepareDiagramShareBundle(file);
  assert.equal(bundle.authored.originalSource, null);
  assert.equal(bundle.authored.sourceMap, null);
  assert.deepEqual(bundle.authored.presentation.elements, authored.presentation.elements);
  assert.deepEqual(bundle.authored.document, authored.document);
  assert.equal(bundle.source.digest, authored.bundleDigest);
  assert.notEqual(bundle.authored.bundleDigest, authored.bundleDigest);
  assert.ok(bundle.scene.items.some((item) => item.kind === 'Connection'));
  assert.equal(await readFile(file, 'utf8'), original);
  const corrupted = structuredClone(bundle);
  corrupted.authored.presentation.elements[0].bounds.x += 1;
  assert.throws(() => assertDiagramReviewBundle(corrupted));
  const privateExtra = structuredClone(bundle);
  privateExtra.localPath = directory;
  assert.throws(() => assertDiagramReviewBundle(privateExtra));
  const activeSvg = structuredClone(bundle);
  activeSvg.scene.svg = activeSvg.scene.svg.replace('</svg>', '<script>alert(1)</script></svg>');
  assert.throws(() => prepareDiagramSvg(activeSvg.scene.svg, { allowOffset: true }));
  assert.match(diagramReviewBundleDigest(bundle), /^[a-f0-9]{64}$/u);
});
test('feedback contracts reject incomplete coordinates, whitespace, secrets-shaped extra state and accessors', () => {
  const feedback = {
    kind: 'comment',
    author: 'Reviewer',
    reviewOf: 'a'.repeat(64),
    createdAt: '2026-09-30T12:00:00.000Z',
    commentId: 'comment-1',
    body: 'Move this label',
    target: { x: 0.4, y: 0.5 },
  };
  assert.equal(assertDiagramReviewFeedback(feedback), feedback);
  for (const changed of [
    { ...feedback, target: { x: 0.4 } },
    { ...feedback, author: ' ' },
    { ...feedback, body: ' ' },
    { ...feedback, ownerToken: 'secret' },
    { ...feedback, createdAt: 'yesterday' },
  ])
    assert.throws(() => assertDiagramReviewFeedback(changed));
  let accessed = false;
  const object = { ...feedback };
  Object.defineProperty(object, 'body', {
    get() {
      accessed = true;
      return 'hello';
    },
    enumerable: true,
  });
  assert.throws(() => assertDiagramReviewFeedback(object));
  assert.equal(accessed, false);
});
