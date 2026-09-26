import {
  makeBundle,
  placement,
  sealBundle,
} from '../../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { canonicalizeJson } from '../../../protocol/src/canonical-json.mjs';
import {
  compileDiagramCommand,
  createConditionalInverse,
  diffDiagramBundles,
  previewDiagramTransaction,
  renderAuthoredDiagramSvg,
  resolveDiagramScene,
  validateAuthoringBundle,
} from '../../lib/artifact/diagram/authoring/index.mjs';

function freezeData(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if ('value' in descriptor) freezeData(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

function required(result, label) {
  if (!result.ok) throw new Error(`${label}: ${JSON.stringify(result.diagnostics)}`);
  return result;
}

// The browser and Worker execute this constructor too, retaining getters and
// frozen inputs that would be lost by passing pre-serialized fixtures around.
export function evaluateKernelCases() {
  const bundle = makeBundle('swimlane');
  bundle.document.groups[0].members = ['group-inner'];
  bundle.document.groups.push({ id: 'group-inner', label: 'Nested work', members: ['node-a'] });
  bundle.document.accessibility.readingOrder.splice(2, 0, 'group-inner');
  bundle.presentation.elements.push({
    ...placement('group-inner', 'container', 10, 10),
    bounds: { x: 10, y: 10, width: 170, height: 120 },
    zIndex: 0,
  });
  sealBundle(bundle);
  freezeData(bundle);
  const original = canonicalizeJson(bundle);
  const validation = required(validateAuthoringBundle(bundle), 'initial bundle');
  const moveCommand = freezeData({ type: 'move', ids: ['lane-a', 'group-a'], dx: 15, dy: 25 });
  const moved = required(
    compileDiagramCommand(bundle, moveCommand, { transactionId: 'move-nested' }),
    'move',
  );
  const movedAgain = required(
    previewDiagramTransaction(bundle, moved.transaction),
    'replay compiled transaction',
  );
  freezeData(moved.bundle);
  const renamed = required(
    compileDiagramCommand(
      moved.bundle,
      freezeData({
        type: 'rename',
        id: 'node-a',
        label: 'Accept Café ☕ order',
      }),
      { transactionId: 'rename-node' },
    ),
    'rename',
  );
  freezeData(renamed.bundle);
  const undo = required(
    createConditionalInverse(renamed.bundle, renamed.inverse, { transactionId: 'undo-rename' }),
    'inverse',
  );
  const undone = required(previewDiagramTransaction(renamed.bundle, undo.transaction), 'undo');
  const redo = required(
    createConditionalInverse(undone.bundle, undone.inverse, { transactionId: 'redo-rename' }),
    'redo inverse',
  );
  const redone = required(previewDiagramTransaction(undone.bundle, redo.transaction), 'redo');
  const difference = required(diffDiagramBundles(bundle, moved.bundle), 'diff');
  const stale = previewDiagramTransaction(moved.bundle, moved.transaction);
  const hostileBatch = structuredClone(moved.transaction);
  hostileBatch.transactionId = 'wrong-class-removal';
  hostileBatch.operations.push({
    type: 'remove-elements',
    elements: [
      {
        collection: 'annotations',
        value: { id: 'node-a', text: 'Wrong semantic class', targetId: null },
      },
    ],
    presentation: [bundle.presentation.elements.find((value) => value.elementId === 'node-a')],
  });
  const wrongClass = previewDiagramTransaction(bundle, freezeData(hostileBatch));
  const lockedBundle = structuredClone(bundle);
  lockedBundle.presentation.elements.find((value) => value.elementId === 'node-a').locks.position =
    true;
  freezeData(sealBundle(lockedBundle));
  const locked = compileDiagramCommand(lockedBundle, moveCommand, { transactionId: 'move-locked' });
  let getterReads = 0;
  const hostileCommand = { type: 'rename', id: 'node-a' };
  Object.defineProperty(hostileCommand, 'label', {
    enumerable: true,
    get() {
      getterReads++;
      return 'Do not evaluate';
    },
  });
  const hostile = compileDiagramCommand(bundle, hostileCommand, {
    transactionId: 'hostile-command',
  });
  const duplicated = required(
    compileDiagramCommand(
      bundle,
      {
        type: 'duplicate',
        ids: ['group-a'],
        dx: 500,
        dy: 0,
        idMap: {
          'group-a': 'group-copy',
          'group-inner': 'inner-copy',
          'node-a': 'node-copy',
          'note-a': 'note-copy',
        },
      },
      { transactionId: 'duplicate-group' },
    ),
    'duplicate',
  );
  const canceled = compileDiagramCommand(
    bundle,
    { type: 'cancel' },
    { transactionId: 'canceled-gesture' },
  );
  const authored = makeBundle('flowchart', { blank: true });
  authored.document.nodes.push({
    id: 'visible-step',
    label: 'Ready',
    kind: 'process',
    description: null,
  });
  authored.document.accessibility.readingOrder = ['visible-step'];
  authored.presentation.elements.push(placement('visible-step', 'rounded-rectangle', 90, 70));
  sealBundle(authored);
  freezeData(authored);
  const scene = required(resolveDiagramScene(authored), 'authored scene');
  const rendered = required(renderAuthoredDiagramSvg(authored), 'authored SVG');
  return {
    scene,
    rendered,
    validation,
    moved,
    movedAgain,
    renamed,
    undo,
    undone,
    redo,
    redone,
    difference,
    stale,
    locked,
    hostile,
    wrongClass,
    duplicated,
    canceled,
    getterReads,
    originalUnchanged: canonicalizeJson(bundle) === original,
    initialSemantic: bundle.document,
    initialBounds: Object.fromEntries(
      bundle.presentation.elements.map((value) => [value.elementId, value.bounds]),
    ),
  };
}

export function runKernelWithoutAmbientEffects() {
  const restore = [];
  const calls = [];
  const replace = (owner, key, label = key) => {
    if (!owner || !(key in owner)) return;
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    const blocked = function () {
      calls.push(label);
      throw new Error(`Unexpected kernel effect: ${label}`);
    };
    Object.defineProperty(owner, key, { configurable: true, writable: true, value: blocked });
    restore.push(() =>
      descriptor ? Object.defineProperty(owner, key, descriptor) : delete owner[key],
    );
  };
  try {
    for (const name of [
      'Date',
      'fetch',
      'setTimeout',
      'setInterval',
      'WebSocket',
      'XMLHttpRequest',
    ])
      replace(globalThis, name);
    replace(Math, 'random', 'Math.random');
    replace(globalThis.crypto, 'randomUUID', 'crypto.randomUUID');
    replace(globalThis.crypto, 'getRandomValues', 'crypto.getRandomValues');
    replace(globalThis.performance, 'now', 'performance.now');
    return { canonical: canonicalizeJson(evaluateKernelCases()), effects: calls };
  } finally {
    for (const reset of restore.reverse()) reset();
  }
}
