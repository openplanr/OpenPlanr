import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as reader from '../../lib/dashboard/graph-reader.mjs';
import { fixtureContents, identityCases } from './planning-identity-cases.mjs';

const root = fileURLToPath(
  new URL('../../conformance/fixtures/dashboard-identity/.planr/', import.meta.url),
);
for (const [name, check] of identityCases) {
  test(name, () => {
    const before = fixtureContents(root);
    const graph = reader.readGraph(root);
    check(graph, reader.readPlanningModel?.(root));
    assert.deepEqual(fixtureContents(root), before);
  });
}

// Model validation prevents future health consumers from treating malformed evidence as a read.
test('diagnostic models reject unsafe paths, unknown fields, and false reference resolutions', async () => {
  const { assertPlanningReadModel } = await import('../../lib/dashboard/graph-read-model.mjs');
  const { getPlanningReadModel } = await import('../../lib/dashboard/graph-engine.mjs');
  const model = getPlanningReadModel(root);
  assert.deepEqual(Object.keys(model.graph).sort(), ['edges', 'nodes']);
  assert.ok(Object.isFrozen(model.references));
  for (const sourcePath of ['/private/source.md', '../source.md', 'C:\\source.md']) {
    const hostile = structuredClone(model);
    hostile.diagnostics[0].sourcePath = sourcePath;
    assert.throws(() => assertPlanningReadModel(hostile), /Planning read model contract/);
  }
  const hostile = structuredClone(model);
  hostile.references[0].targetId = 'ADR-024';
  hostile.references[0].candidates = ['ADR-024'];
  assert.throws(() => assertPlanningReadModel(hostile), /Planning read model contract/);
  for (const field of ['body', 'unknown']) {
    const invalid = structuredClone(model);
    invalid.references[0].field = field;
    assert.throws(() => assertPlanningReadModel(invalid), /Planning read model contract/);
  }
  const invalidGraph = structuredClone(model);
  delete invalidGraph.graph.nodes[0].title;
  assert.throws(() => assertPlanningReadModel(invalidGraph), /Planning read model contract/);
  assert.throws(
    () => assertPlanningReadModel({ ...model, extra: true }),
    /Planning read model contract/,
  );
});

test('spec-local missing refs never escape scope and ambiguity is independent of discovery order', async () => {
  const { createReferenceResolver } = await import('../../lib/dashboard/graph-read-model.mjs');
  const graph = reader.readGraph(root);
  for (const nodes of [graph.nodes, [...graph.nodes].reverse()]) {
    const resolve = createReferenceResolver({ ...graph, nodes });
    assert.equal(resolve('T-055', 'SPEC-016', 'dependsOn').reason, 'missing');
    assert.equal(resolve('T-056', null, 'taskIds').reason, 'ambiguous');
    assert.equal(resolve('SPEC-016/T-056', 'SPEC-015', 'dependsOn').targetId, 'SPEC-016/T-056');
  }
});
