import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardPlacement } from '../lib/design/ui/layout.mjs';

const design = {
  frames: [
    { id: 'desktop', width: 1440, height: 1024 },
    { id: 'mobile', width: 390, height: 844 },
  ],
  screens: [
    { id: 'home', title: 'Home' },
    { id: 'details', title: 'Details' },
  ],
  screenOrder: ['home', 'details'],
  variants: [
    { id: 'light', label: 'Light', status: 'ready' },
    { id: 'dark', label: 'Dark', status: 'ready' },
  ],
  selectedVariant: 'light',
};
const entry = { screenId: 'details', frameId: 'mobile', variantId: 'dark' };

test('absent and empty layouts reproduce grid positions and labels in both comparison modes', () => {
  for (const compare of [false, true]) {
    const options = { compare, variantId: 'dark' };
    const original = boardPlacement(design, entry, options);
    assert.deepEqual(original, {
      x: 1536 + (compare ? 2086 : 0),
      y: 1272,
      title: 'Details / Dark',
    });
    for (const layout of [{}, { boards: {} }, { sections: [] }])
      assert.deepEqual(boardPlacement({ ...design, layout }, entry, options), original);
  }
});

test('exact and frame placements override screen origins while titles inherit independently', () => {
  const boards = { details: { x: -100, y: 80, title: 'Details journey' } };
  const placement = () => boardPlacement(design, entry, { layout: { boards }, compare: true });
  assert.deepEqual(placement(), { x: 3522, y: 80, title: 'Details journey' });
  boards['details/mobile'] = { x: 300, y: -40, title: 'Mobile details' };
  assert.deepEqual(placement(), { x: 300, y: -40, title: 'Mobile details' });
  boards['details/mobile/dark'] = { x: 700, y: 900 };
  assert.deepEqual(placement(), { x: 700, y: 900, title: 'Mobile details' });
  boards['details/mobile/dark'].title = 'Dark detail';
  assert.deepEqual(placement(), { x: 700, y: 900, title: 'Dark detail' });
  delete boards['details/mobile'].title;
  delete boards['details/mobile/dark'].title;
  assert.equal(placement().title, 'Details journey');
});

test('empty board maps ignore inherited properties for valid screen IDs', () => {
  const document = {
    ...design,
    screens: [{ id: 'constructor', title: 'Constructor' }],
    screenOrder: ['constructor'],
  };
  const board = { ...entry, screenId: 'constructor', variantId: 'light' };
  assert.deepEqual(
    boardPlacement(document, board, { layout: { boards: {} } }),
    boardPlacement(document, board),
  );
});
