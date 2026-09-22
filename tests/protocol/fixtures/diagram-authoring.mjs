import {
  diagramDocumentDigest, diagramPresentationDigest, diagramAuthoringBundleDigest,
  validateDiagramAuthoringArtifact,
} from '../../../packages/protocol/src/diagram-authoring-contracts.mjs';
import { sha256Hex } from '../../../packages/protocol/src/canonical-json.mjs';

const meta = kind => ({ kind, schemaVersion: '1.0.0', protocolVersion: '1.13.0' });
export const SOURCE_TEXT = 'flowchart LR\r\n  A["Café ☕"] --> B[Done]\r\n';
export const digestText = text => `sha256:${sha256Hex(text)}`;
export const clone = value => structuredClone(value);

export function placement(elementId, shape = 'rectangle', x = 20, y = 30) {
  return {
    elementId, bounds: { x, y, width: 140, height: 70 }, route: null, label: null, zIndex: 1,
    appearance: { shape, fill: 'surface', stroke: 'default', strokeWidth: 2, strokeStyle: 'solid', fontSize: 14, textAlign: 'center' },
    locks: { position: false, size: false, route: false },
  };
}
export function sealBundle(bundle) {
  bundle.document.documentDigest = diagramDocumentDigest(bundle.document);
  bundle.presentation.semanticDigest = bundle.document.documentDigest;
  if (bundle.sourceMap) bundle.sourceMap.semanticDigest = bundle.document.documentDigest;
  bundle.presentation.presentationDigest = diagramPresentationDigest(bundle.presentation);
  bundle.bundleDigest = diagramAuthoringBundleDigest(bundle);
  return bundle;
}
export function rehashBundle(bundle) {
  bundle.bundleDigest = diagramAuthoringBundleDigest(bundle);
  return bundle;
}
export function makeBundle(profile = 'flowchart', { blank = false, emptyContainer = false, source = false } = {}) {
  const document = {
    ...meta('planr-diagram'), diagramId: 'checkout', title: 'Checkout', summary: 'Review the checkout path.', audience: 'engineer',
    grammar: { id: profile, version: '1.0.0' },
    nodes: [], relations: [], groups: [], lanes: [], events: [], series: [], axes: [], sets: [], annotations: [], emphasis: [], laneOrder: [],
    accessibility: { title: 'Checkout', description: 'Checkout with a labeled relationship.', readingOrder: [] },
    documentDigest: '',
  };
  const presentation = {
    ...meta('diagram-presentation'), diagramId: 'checkout', semanticDigest: '', coordinateSystem: 'global-canvas',
    layout: { direction: 'left-right', detailTier: 'balanced' }, theme: { themeId: 'paper', mode: 'light' },
    elements: [], presentationDigest: '',
  };
  if (emptyContainer) {
    document.groups.push({ id: 'group-a', label: 'Unassigned work', members: [] });
    presentation.elements.push(placement('group-a', 'container'));
  } else if (!blank) {
    document.nodes = [
      { id: 'node-a', label: 'Café ☕', kind: profile === 'architecture' ? 'component' : 'process', description: null },
      { id: 'node-b', label: 'Done', kind: profile === 'architecture' ? 'component' : 'end', description: 'Checkout finished.' },
    ];
    document.relations = [{ id: 'edge-a', from: 'node-a', to: 'node-b', kind: 'flow', direction: 'forward', label: 'Complete', weight: null }];
    document.groups = [{ id: 'group-a', label: 'Checkout service', members: ['node-a'] }];
    document.annotations = [{ id: 'note-a', text: 'Keep the operation idempotent.', targetId: 'node-a' }];
    document.accessibility.readingOrder = ['group-a', 'node-a', 'edge-a', 'node-b', 'note-a'];
    presentation.elements = [
      placement('node-a'), placement('node-b', 'rounded-rectangle', 260),
      { ...placement('edge-a', 'connector'), bounds: null, route: { mode: 'manual', strategy: 'straight', from: { side: 'right', offset: 0.5 }, to: { side: 'left', offset: 0.5 }, points: [{ x: 160, y: 65 }, { x: 260, y: 65 }] }, label: { x: 180, y: 40, width: 70 } },
      { ...placement('group-a', 'container', 0, 0), bounds: { x: 0, y: 0, width: 190, height: 150 }, zIndex: 0 },
      placement('note-a', 'text', 20, 200),
    ];
    if (profile === 'process' || profile === 'swimlane') {
      document.lanes.push({ id: 'lane-a', label: 'Operations', members: ['group-a', 'node-b'] });
      document.laneOrder = ['lane-a'];
      document.accessibility.readingOrder.unshift('lane-a');
      presentation.elements.push({ ...placement('lane-a', 'container'), bounds: { x: -20, y: -20, width: 460, height: 210 }, zIndex: 0 });
    }
  }
  const bundle = { ...meta('diagram-authoring-bundle'), diagramId: 'checkout', document, presentation, originalSource: null, sourceMap: null, bundleDigest: '' };
  sealBundle(bundle);
  if (source) {
    const startByte = (part) => new TextEncoder().encode(SOURCE_TEXT.slice(0, SOURCE_TEXT.indexOf(part))).length;
    bundle.originalSource = { format: 'mermaid', text: SOURCE_TEXT, sourceDigest: digestText(SOURCE_TEXT) };
    bundle.sourceMap = {
      ...meta('diagram-source-map'), diagramId: 'checkout', semanticDigest: document.documentDigest,
      sourceDigest: digestText(SOURCE_TEXT), sourceByteLength: new TextEncoder().encode(SOURCE_TEXT).length,
      encoding: 'utf-8', parser: { id: 'bounded-flowchart', version: '1.0.0' }, certificationVersion: 'flowchart-copy-v1',
      entries: [
        { sourceId: 'A', elementIds: ['node-a'], range: { startByte: startByte('A['), endByte: startByte('A[') + new TextEncoder().encode('A["Café ☕"]').length }, construct: 'rectangle-node', confidence: 'exact', losses: [] },
        { sourceId: 'B', elementIds: ['node-b'], range: { startByte: startByte('B['), endByte: startByte('B[') + 7 }, construct: 'rectangle-node', confidence: 'exact', losses: [] },
      ],
    };
    rehashBundle(bundle);
  }
  return bundle;
}
export const snapshot = bundle => ({ bundleDigest: bundle.bundleDigest, semanticDigest: bundle.document.documentDigest, presentationDigest: bundle.presentation.presentationDigest });
export function makeTransaction(bundle = makeBundle()) {
  const before = { label: bundle.document.nodes[0].label, kind: bundle.document.nodes[0].kind, description: bundle.document.nodes[0].description };
  return { ...meta('diagram-edit-transaction'), transactionId: 'rename-checkout', diagramId: bundle.diagramId, base: snapshot(bundle),
    operations: [{ type: 'update-semantics', collection: 'nodes', elementId: 'node-a', before, after: { ...before, label: 'Accept order' } }], undoOf: null };
}
export function makeMembershipTransaction(bundle = makeBundle('swimlane')) {
  const state = { groups: bundle.document.groups.map(({ id, members }) => ({ id, members: [...members] })),
    lanes: bundle.document.lanes.map(({ id, members }) => ({ id, members: [...members] })), laneOrder: [...bundle.document.laneOrder] };
  return { ...makeTransaction(bundle), transactionId: 'reparent-checkout',
    operations: [{ type: 'set-membership-order', before: state, after: clone(state) }] };
}
export function makeProposal(bundle = makeBundle()) {
  return { ...meta('diagram-change-proposal'), proposalId: 'proposal-checkout', diagramId: bundle.diagramId, base: snapshot(bundle), transaction: makeTransaction(bundle), summary: 'Clarify the checkout step.', author: { kind: 'agent', id: 'active-host' }, status: 'proposed' };
}
export function makeFidelity(bundle = makeBundle('flowchart', { source: true })) {
  return { ...meta('diagram-fidelity-report'), diagramId: bundle.diagramId, basis: snapshot(bundle), sourceDigest: bundle.originalSource?.sourceDigest ?? null,
    sourceFormat: 'mermaid', targetFormat: 'planr-diagram-bundle', semantic: 'lossless', presentation: 'partial', sourceText: 'partial',
    losses: [
      { dimension: 'presentation', code: 'derived-placement', elementIds: [], message: 'Mermaid positions are derived.' },
      { dimension: 'sourceText', code: 'canonical-format', elementIds: [], message: 'Generated Mermaid is canonically formatted.' },
    ] };
}

export function makeManifest(bundle = makeBundle('flowchart', { source: true })) {
  return { ...meta('diagram-manifest'), diagramId: bundle.diagramId, basis: snapshot(bundle),
    bundle: { path: 'diagrams/checkout/checkout.planr-diagram-bundle.json', transportDigest: digestText(JSON.stringify(bundle)) },
    renderer: { id: 'semantic-svg', version: '1.0.0' },
    outputs: [{ path: 'diagrams/checkout/checkout.svg', mediaType: 'image/svg+xml', transportDigest: digestText('<svg></svg>'),
      fidelity: { ...makeFidelity(bundle), targetFormat: 'svg' } }] };
}

// Snapshot descriptors without evaluating getters, including non-JSON cases.
function audit(value, seen = new Map()) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'number') return Number.isFinite(value) ? value : String(value);
  if (type !== 'object') return [type, type === 'function' ? 'function' : String(value)];
  if (seen.has(value)) return ['ref', seen.get(value)];
  seen.set(value, seen.size);
  const proto = Object.getPrototypeOf(value);
  const shape = Array.isArray(value) ? 'array' : proto === Object.prototype ? 'plain' : proto === null ? 'null-prototype' : 'custom-prototype';
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return [shape, Reflect.ownKeys(descriptors).map(key => {
    const d = descriptors[key];
    return [String(key), d.enumerable, d.configurable, Object.hasOwn(d, 'value') ? ['data', d.writable, audit(d.value, seen)] : ['accessor', Boolean(d.get), Boolean(d.set)]];
  })];
}
export function authoringCases() {
  const cases = [];
  const add = (name, value, valid, expectedRule, options = {}, kind = 'diagram-authoring-bundle') => cases.push({ name, value, valid, expectedRule, options, kind });
  for (const profile of ['flowchart', 'process', 'swimlane', 'architecture']) add(`populated ${profile}`, makeBundle(profile), true);
  add('blank without placeholders', makeBundle('flowchart', { blank: true }), true);
  add('empty container', makeBundle('flowchart', { emptyContainer: true }), true);
  add('exact CRLF and Unicode source', makeBundle('flowchart', { source: true }), true);
  for (const direction of ['both', 'none']) {
    const b = makeBundle(); b.document.relations[0].direction = direction; add(`${direction} relation`, sealBundle(b), true);
  }
  const orthogonal = makeBundle(); orthogonal.presentation.elements[2].route.strategy = 'orthogonal';
  add('orthogonal routing strategy', sealBundle(orthogonal), true);
  const changed = (name, edit, rule, reseal = true) => { const b = makeBundle('process', { source: true }); edit(b); add(name, reseal ? sealBundle(b) : b, false, rule); };
  changed('unknown portable field', b => { b.camera = { x: 0, y: 0 }; }, 'additionalProperties');
  changed('unsupported forward version', b => { b.protocolVersion = '1.14.0'; }, 'const', false);
  changed('duplicate semantic identity', b => { b.document.groups[0].id = 'node-a'; }, 'duplicate-id');
  changed('dangling endpoint', b => { b.document.relations[0].to = 'absent'; }, 'endpoint');
  changed('annotation target missing', b => { b.document.annotations[0].targetId = 'absent'; }, 'reference');
  changed('multiple immediate parents', b => { b.document.lanes[0].members.push('node-a'); }, 'multiple-parents');
  changed('cyclic containment', b => { b.document.groups[0].members.push('lane-a'); }, 'containment-cycle');
  changed('invalid lane order', b => { b.document.laneOrder = []; }, 'lane-order');
  changed('missing placement', b => { b.presentation.elements.pop(); }, 'presentation-coverage');
  changed('duplicate placement', b => { b.presentation.elements.push(clone(b.presentation.elements[0])); }, 'duplicate-id');
  changed('presentation cannot retarget an edge', b => { b.presentation.elements[2].route.to.elementId = 'node-a'; }, 'anyOf');
  changed('manual route needs actual segment', b => { b.presentation.elements[2].route.points = [{ x: 0, y: 0 }]; }, 'manual-route');
  changed('automatic route cannot hide manual points', b => { b.presentation.elements[2].route.mode = 'automatic'; }, 'automatic-route');
  changed('straight route cannot contain bends', b => { b.presentation.elements[2].route.points.splice(1, 0, { x: 180, y: 65 }); }, 'route-strategy');
  changed('orthogonal route cannot contain diagonal segments', b => { b.presentation.elements[2].route.strategy = 'orthogonal'; b.presentation.elements[2].route.points[1].y += 10; }, 'route-strategy');
  changed('uncertified routing strategy', b => { b.presentation.elements[2].route.strategy = 'bezier'; }, 'anyOf');
  changed('invalid attachment offset', b => { b.presentation.elements[2].route.from.offset = 1.1; }, 'anyOf');
  changed('negative shape width', b => { b.presentation.elements[0].bounds.width = -1; }, 'anyOf');
  changed('coordinates beyond bounded canvas', b => { b.presentation.elements[0].bounds.x = 1000001; }, 'anyOf');
  changed('active resource token', b => { b.presentation.elements[0].appearance.fill = 'url(https://attacker.invalid/a.svg)'; }, 'enum');
  changed('forbidden semantic primitive', b => { b.document.events.push({ id: 'event-a', label: 'Uncertified event' }); }, 'maxItems');
  changed('non-finite geometry', b => { b.presentation.elements[0].bounds.x = Infinity; }, 'finite-number', false);
  changed('NaN geometry', b => { b.presentation.elements[0].bounds.y = NaN; }, 'finite-number', false);
  changed('lone surrogate', b => { b.document.title = '\ud800'; }, 'unicode', false);
  changed('unsafe own proto key', b => { Object.defineProperty(b, '__proto__', { value: { polluted: true }, enumerable: true }); }, 'unsafe-key', false);
  changed('unsafe own constructor key', b => { b.document.constructor = 'not-a-constructor'; }, 'unsafe-key', false);
  changed('custom object prototype', b => { Object.setPrototypeOf(b.presentation, { inherited: true }); }, 'plain-data', false);
  changed('Date object', b => { b.document.title = new Date('2026-09-22T00:00:00Z'); }, 'plain-data', false);
  changed('typed array object', b => { b.document.nodes = new Uint8Array([1, 2]); }, 'plain-data', false);
  changed('sparse semantic array', b => { delete b.document.nodes[0]; }, 'sparse-array', false);
  changed('array extra property', b => { b.document.nodes.authority = 'admin'; }, 'plain-data', false);
  changed('cyclic JavaScript object', b => { b.document.circular = b.document; }, 'cycle', false);
  changed('excessive depth', b => { let target = b; for (let i = 0; i < 60; i++) target = target.nested = {}; }, 'resource-limit', false);
  const accessor = makeBundle(); let reads = 0;
  Object.defineProperty(accessor.document, 'title', { enumerable: true, configurable: true, get() { reads++; return 'Executed getter'; } });
  add('getter is rejected without execution', accessor, false, 'accessor'); cases.at(-1).getReads = () => reads;
  const contextBundle = makeBundle(); let contextReads = 0;
  Object.defineProperty(contextBundle.document, 'title', { enumerable: true, get() { contextReads++; return 'Executed context getter'; } });
  add('context getter is rejected without execution', makeBundle().presentation, false, 'accessor', { document: contextBundle.document }, 'diagram-presentation');
  cases.at(-1).getReads = () => contextReads;
  const basis = makeBundle(); const other = makeBundle(); other.document.title = 'Another semantic basis'; sealBundle(other);
  basis.presentation = clone(other.presentation); rehashBundle(basis); add('substituted presentation basis', basis, false, 'basis');
  const sourceBasis = makeBundle('flowchart', { source: true }); sourceBasis.sourceMap.semanticDigest = other.document.documentDigest; rehashBundle(sourceBasis); add('substituted source-map basis', sourceBasis, false, 'basis');
  const rawSource = makeBundle('flowchart', { source: true }); rawSource.originalSource.text = rawSource.originalSource.text.replaceAll('\r\n', '\n'); rehashBundle(rawSource); add('rewritten exact source bytes', rawSource, false, 'source-digest');
  const sourceRange = makeBundle('flowchart', { source: true });
  const unicodeStart = new TextEncoder().encode(SOURCE_TEXT.slice(0, SOURCE_TEXT.indexOf('é'))).length;
  sourceRange.sourceMap.entries[0].range.startByte = unicodeStart + 1; rehashBundle(sourceRange); add('source range inside UTF-8 scalar', sourceRange, false, 'source-range');
  const anonymous = makeBundle('flowchart', { source: true }); anonymous.sourceMap.entries[0].sourceId = null;
  add('exact anonymous source range', rehashBundle(anonymous), true);
  const unidentified = clone(anonymous); unidentified.sourceMap.entries[0].range = null;
  add('exact source mapping without evidence', rehashBundle(unidentified), false, 'source-identity');
  const uncertified = makeBundle('flowchart', { source: true }); uncertified.sourceMap.entries[0].construct = 'unknown-syntax';
  add('unknown source construct cannot claim exact', rehashBundle(uncertified), false, 'source-certification');
  const omittedLoss = makeBundle('flowchart', { source: true }); omittedLoss.sourceMap.entries[0].construct = 'styles-and-directives'; omittedLoss.sourceMap.entries[0].confidence = 'ambiguous';
  add('unsupported source construct requires loss', rehashBundle(omittedLoss), false, 'source-certification');
  const unsupported = makeBundle('flowchart', { source: true });
  unsupported.sourceMap.entries.push({ sourceId: null, elementIds: [], range: null, construct: 'styles-and-directives', confidence: 'ambiguous', losses: ['Unsupported styling directive'] });
  rehashBundle(unsupported); add('retained unsupported source diagnostic', unsupported, true);
  const falseReport = makeFidelity(unsupported); falseReport.semantic = 'lossless'; falseReport.presentation = 'lossless'; falseReport.sourceText = 'lossless'; falseReport.losses = [];
  add('unsupported source cannot become lossless', falseReport, false, 'fidelity', { bundle: unsupported }, 'diagram-fidelity-report');
  const geometryReport = { ...makeFidelity(makeBundle()), sourceFormat: 'planr-diagram-bundle', targetFormat: 'mermaid', semantic: 'lossless', presentation: 'lossless', sourceText: 'lossless', losses: [] };
  add('Mermaid cannot preserve manual presentation losslessly', geometryReport, false, 'fidelity', { bundle: makeBundle() }, 'diagram-fidelity-report');
  const missingSource = makeBundle('flowchart', { source: true }); missingSource.originalSource = null; rehashBundle(missingSource); add('source map without original bytes', missingSource, false, 'source-pair');
  const swappedId = makeBundle(); swappedId.presentation.diagramId = 'another-diagram'; swappedId.presentation.presentationDigest = diagramPresentationDigest(swappedId.presentation); rehashBundle(swappedId); add('substituted diagram identity', swappedId, false, 'basis');
  const b = makeBundle(); const transaction = makeTransaction(b); add('typed rename transaction', transaction, true, undefined, { baseBundle: b }, 'diagram-edit-transaction');
  const stale = makeTransaction(b); stale.base.presentationDigest = `sha256:${'0'.repeat(64)}`; add('transaction substituted base', stale, false, 'basis', { baseBundle: b }, 'diagram-edit-transaction');
  const patch = makeTransaction(b); patch.operations = [{ type: 'update-semantics', path: '/document/title', value: 'arbitrary patch' }]; add('arbitrary JSON patch is not a typed edit', patch, false, 'oneOf', { baseBundle: b }, 'diagram-edit-transaction');
  const proposal = makeProposal(b); proposal.base.semanticDigest = `sha256:${'1'.repeat(64)}`; add('proposal substituted transaction basis', proposal, false, 'basis', { baseBundle: b }, 'diagram-change-proposal');
  const membershipBundle = makeBundle('swimlane');
  const invalidMembership = (name, edit, rule) => {
    const transaction = makeMembershipTransaction(membershipBundle); edit(transaction.operations[0].after);
    add(name, transaction, false, rule, { baseBundle: membershipBundle }, 'diagram-edit-transaction');
  };
  invalidMembership('membership cannot reference missing elements', state => { state.groups[0].members.push('missing-object'); }, 'containment-reference');
  invalidMembership('membership cannot fabricate a container', state => { state.groups[0].id = 'missing-container'; }, 'containment-reference');
  invalidMembership('relation cannot become a membership container', state => { state.groups[0].id = 'edge-a'; }, 'element-class');
  invalidMembership('relation cannot become a container member', state => { state.groups[0].members.push('edge-a'); }, 'containment-reference');
  const unsupportedLane = makeTransaction(b);
  unsupportedLane.operations = [{ type: 'insert-elements', elements: [{ collection: 'lanes', value: { id: 'new-lane', label: 'Uncertified lane', members: [] } }], presentation: [placement('new-lane', 'container')] }];
  add('flowchart cannot insert an unsupported lane', unsupportedLane, false, 'profile-primitive', { baseBundle: b }, 'diagram-edit-transaction');
  const geometry = ({ bounds, route, label, zIndex }) => ({ bounds: clone(bounds), route: clone(route), label: clone(label), zIndex });
  for (const [name, elementId, beforeIndex, afterIndex] of [
    ['node cannot become a connector through geometry', 'node-a', 0, 2],
    ['relation cannot become a shape through geometry', 'edge-a', 2, 0],
  ]) {
    const transaction = makeTransaction(b);
    transaction.operations = [{ type: 'set-geometry', changes: [{ elementId,
      before: geometry(b.presentation.elements[beforeIndex]), after: geometry(b.presentation.elements[afterIndex]) }] }];
    add(name, transaction, false, 'geometry-kind', { baseBundle: b }, 'diagram-edit-transaction');
  }
  const manifestBundle = makeBundle('flowchart', { source: true }); const manifest = makeManifest(manifestBundle);
  add('manifest binds exact snapshot', manifest, true, undefined, { bundle: manifestBundle }, 'diagram-manifest');
  const collision = clone(manifest); collision.outputs[0].path = collision.bundle.path;
  add('derived output cannot replace canonical bundle', collision, false, 'canonical-output-collision', { bundle: manifestBundle }, 'diagram-manifest');
  return cases;
}
export function evaluateAuthoringCases() {
  return authoringCases().map(item => {
    const before = JSON.stringify(audit({ value: item.value, options: item.options }));
    let diagnostics = [], threw = null;
    try { diagnostics = validateDiagramAuthoringArtifact(item.kind, item.value, item.options); } catch (error) { threw = String(error); }
    return { name: item.name, valid: diagnostics.length === 0 && threw === null, expectedValid: item.valid, expectedRule: item.expectedRule ?? null,
      diagnostics: diagnostics.map(({ path, rule, detail }) => ({ path, rule, detail })), threw,
      unchanged: JSON.stringify(audit({ value: item.value, options: item.options })) === before, getterReads: item.getReads?.() ?? 0 };
  });
}
