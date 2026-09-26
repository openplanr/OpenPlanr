import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { validateProtocolArtifact } from '@openplanr/protocol/contracts';

import {
  bindDiagramArtifactReview,
  createDiagramArtifactEnvelope,
  createDiagramDocumentationReference,
  createDiagramPdfAttachment,
  createDiagramSpecificationReference,
  renderDiagram,
} from '../lib/artifact/diagram/index.mjs';
import {
  createArtifactReview,
  createArtifactReviewEnvelope,
  digestArtifactEnvelope,
} from '../lib/artifact/index.mjs';

const packageRoot = resolve(import.meta.dirname, '..');
const fixture = JSON.parse(
  readFileSync(join(packageRoot, 'fixtures/diagram/grammars/flowchart.planr-diagram.json'), 'utf8'),
);
const pin = JSON.parse(
  readFileSync(join(packageRoot, 'fixtures/diagram/integration/review-pin.json'), 'utf8'),
);
const consumers = JSON.parse(
  readFileSync(join(packageRoot, 'fixtures/diagram/integration/consumers.json'), 'utf8'),
);

async function rendered(t) {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-diagram-integration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await renderDiagram(fixture, { outputRoot: root });
  const directory = join(root, 'diagrams', fixture.diagramId);
  return {
    root,
    directory,
    manifest: join(directory, `${fixture.diagramId}.manifest.json`),
    source: join(directory, `${fixture.diagramId}.planr-diagram.json`),
  };
}

test('diagram HTML uses the existing canvas review envelope and binds returned pins to exact digests', async (t) => {
  const set = await rendered(t);
  const sourceBefore = await readFile(set.source);
  const prepared = await createDiagramArtifactEnvelope(set.manifest);
  assert.equal(prepared.envelope.viewer.presentation, 'canvas');
  assert.equal(prepared.envelope.artifacts[0].id, fixture.diagramId);
  assert.deepEqual(
    validateProtocolArtifact('diagram-review-binding', prepared.binding, {
      protocolVersion: '1.6.0',
    }),
    [],
  );

  const review = createArtifactReview({
    reviewId: 'diagram-review-1',
    reviewOf: digestArtifactEnvelope(prepared.envelope),
    decision: 'changes_requested',
    overall: 'Clarify the decision path.',
    pins: [pin],
    createdAt: '2026-08-30T12:00:00.000Z',
    updatedAt: '2026-08-30T12:00:00.000Z',
  });
  const reviewed = createArtifactReviewEnvelope(prepared.envelope, review);
  assert.equal(reviewed.review.pins[0].id, 'diagram-pin-1');
  const binding = await bindDiagramArtifactReview(set.manifest, reviewed, review);
  assert.equal(binding.manifest.digest, prepared.manifest.documentDigest);
  assert.equal(binding.artifact.envelopeDigest, prepared.binding.artifact.envelopeDigest);
  assert.deepEqual(binding.review.pinIds, ['diagram-pin-1']);
  assert.deepEqual(
    validateProtocolArtifact('diagram-review-binding', binding, { protocolVersion: '1.6.0' }),
    [],
  );
  assert.ok(
    sourceBefore.equals(await readFile(set.source)),
    'review must not rewrite canonical IR',
  );
});

test('specification, documentation, and PDF consumers reuse one verified offline artifact set', async (t) => {
  const set = await rendered(t);
  const sourceBefore = await readFile(set.source);
  const values = await Promise.all([
    createDiagramSpecificationReference(set.manifest, {
      consumerPath: join(set.root, consumers.specification),
    }),
    createDiagramDocumentationReference(set.manifest, {
      consumerPath: join(set.root, consumers.documentation),
    }),
    createDiagramPdfAttachment(set.manifest, {
      consumerPath: join(set.root, consumers.pdf),
    }),
  ]);

  assert.deepEqual(
    values.map(({ reference }) => reference.consumer.kind),
    ['specification', 'documentation', 'pdf'],
  );
  for (const { reference, bytes, absolutePath } of values) {
    assert.deepEqual(
      validateProtocolArtifact('diagram-consumer-reference', reference, {
        protocolVersion: '1.6.0',
      }),
      [],
    );
    assert.equal(reference.manifest.digest, values[0].reference.manifest.digest);
    assert.equal(reference.source.digest, values[0].reference.source.digest);
    assert.ok(bytes.length > 0);
    assert.ok((await readFile(absolutePath)).equals(bytes));
    assert.equal(reference.accessibility.title, fixture.accessibility.title);
  }
  assert.match(values[2].reference.output.mediaType, /^image\/(?:svg\+xml|png)/u);
  assert.ok(
    sourceBefore.equals(await readFile(set.source)),
    'consumers must not copy or rewrite canonical IR',
  );
});
