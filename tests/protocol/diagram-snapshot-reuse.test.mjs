import assert from 'node:assert/strict';
import test from 'node:test';
import {
  copyImmutableDiagramData,
  validateDiagramAuthoringBundle,
} from '../../packages/protocol/src/diagram-authoring-contracts.mjs';
import {
  createVersionedDiagramAuthoringSnapshot,
  sealVersionedDiagramAuthoringSnapshot,
} from '../../packages/protocol/src/studio-presentation-contracts.mjs';
import { makeBundle } from './fixtures/diagram-authoring.mjs';

test('equal independently owned snapshots reuse descendants without mutating frozen roots', () => {
  for (const copy of [
    copyImmutableDiagramData,
    createVersionedDiagramAuthoringSnapshot,
    sealVersionedDiagramAuthoringSnapshot,
  ]) {
    const left = createVersionedDiagramAuthoringSnapshot(makeBundle());
    const right = createVersionedDiagramAuthoringSnapshot(makeBundle());
    const original = JSON.stringify(left);
    const result = copy(left, right);
    assert.deepEqual(validateDiagramAuthoringBundle(result), []);
    assert.equal(JSON.stringify(result), original);
    assert.equal(JSON.stringify(left), original);
    assert.equal(JSON.stringify(right), original);
    assert.equal(result.document, right.document);
    assert.equal(result.presentation.elements[0], right.presentation.elements[0]);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.presentation));
    assert.ok(Object.isFrozen(result.presentation.elements));
  }
});
