import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  DIAGRAM_AUTHORING_CAPABILITIES,
  validateDiagramAuthoringArtifact, assertDiagramAuthoringArtifact,
  validateDiagramAuthoringBundle, assertDiagramAuthoringBundle,
  diagramDocumentDigest, diagramPresentationDigest, diagramAuthoringBundleDigest,
  getDiagramAuthoringCapability, summarizeDiagramAuthoringContent, inspectLegacyDiagramDocument,
} from '../../packages/protocol/src/diagram-authoring-contracts.mjs';
import { canonicalizeJson } from '../../packages/protocol/src/canonical-json.mjs';
import { validateProtocolArtifact } from '../../packages/protocol/src/contracts.mjs';
import { DIAGRAM_GRAMMAR_REGISTRY } from '../../packages/protocol/src/diagram-contracts.mjs';
import {
  SOURCE_TEXT, makeBundle, sealBundle, rehashBundle, makeTransaction, makeProposal,
  makeFidelity, makeManifest, snapshot, placement, clone, digestText, authoringCases, evaluateAuthoringCases,
} from './fixtures/diagram-authoring.mjs';

const root = resolve(import.meta.dirname, '../..');
const validate = validateDiagramAuthoringArtifact;
const failWith = (kind, value, rule, options = {}) => {
  const errors = validate(kind, value, options);
  assert.ok(errors.some(error => error.rule === rule), `Expected ${rule}, received ${JSON.stringify(errors)}`);
  assert.ok(errors.every(error => typeof error.path === 'string' && error.path.startsWith('$')));
};

test('blank drafts, empty containers and four populated authoring profiles retain their exact content', () => {
  const fixtures = [makeBundle('flowchart', { blank: true }), makeBundle('flowchart', { emptyContainer: true }),
    ...['flowchart', 'process', 'swimlane', 'architecture'].map(profile => makeBundle(profile))];
  for (const bundle of fixtures) {
    const encoded = JSON.stringify(bundle);
    assert.strictEqual(assertDiagramAuthoringBundle(bundle), bundle);
    const decoded = JSON.parse(encoded);
    assert.deepEqual(validateDiagramAuthoringBundle(decoded), []);
    assert.deepEqual(decoded, bundle);
    assert.equal(JSON.stringify(bundle), encoded, 'Validation cannot inject placeholder content or rewrite identifiers');
  }
  assert.deepEqual(summarizeDiagramAuthoringContent(fixtures[0]), { elementCount: 0, hasVisibleContent: false });
  assert.deepEqual(summarizeDiagramAuthoringContent(fixtures[1]), { elementCount: 1, hasVisibleContent: true });
});

test('hostile inputs fail their domain or data constraints without mutation or accessor execution', () => {
  for (const result of evaluateAuthoringCases()) {
    assert.equal(result.threw, null, `${result.name}: validator should return located diagnostics`);
    assert.equal(result.valid, result.expectedValid, `${result.name}: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(result.unchanged, true, result.name);
    assert.equal(result.getterReads, 0, result.name);
    if (result.expectedRule) assert.ok(result.diagnostics.some(error => error.rule === result.expectedRule), `${result.name}: ${JSON.stringify(result.diagnostics)}`);
  }
});

test('generic exact-version dispatch preserves dedicated domain rejection, not just schema validation', () => {
  for (const item of authoringCases().filter(item => Object.keys(item.options).length === 0)) {
    const direct = validate(item.kind, item.value).map(({ path, rule }) => ({ path, rule }));
    const generic = validateProtocolArtifact(item.kind, item.value, { protocolVersion: '1.13.0' }).map(({ path, rule }) => ({ path, rule }));
    assert.deepEqual(generic, direct, item.name);
    assert.equal(generic.length === 0, item.valid, item.name);
  }
});

test('generic version selection rejects an accessor before executing it', () => {
  const bundle = makeBundle(); let reads = 0;
  Object.defineProperty(bundle, 'protocolVersion', { enumerable: true, get() { reads++; return '1.13.0'; } });
  const generic = validateProtocolArtifact('diagram-authoring-bundle', bundle);
  assert.equal(reads, 0, 'Version inference cannot execute untrusted accessors');
  assert.ok(generic.some(issue => issue.path === '$' && issue.rule === 'accessor'));
  assert.deepEqual(generic, validate('diagram-authoring-bundle', bundle));
  assert.equal(reads, 0);
});

test('content digests exclude only their own field and bind each nested semantic and presentation basis', () => {
  const bundle = makeBundle('flowchart', { source: true });
  const independent = (value, field) => {
    const content = { ...value }; delete content[field];
    return `sha256:${createHash('sha256').update(canonicalizeJson(content), 'utf8').digest('hex')}`;
  };
  assert.equal(bundle.document.documentDigest, independent(bundle.document, 'documentDigest'));
  assert.equal(bundle.presentation.presentationDigest, independent(bundle.presentation, 'presentationDigest'));
  assert.equal(bundle.bundleDigest, independent(bundle, 'bundleDigest'));
  const transport = `sha256:${createHash('sha256').update(JSON.stringify(bundle, null, 2), 'utf8').digest('hex')}`;
  assert.notEqual(transport, bundle.bundleDigest, 'Transport bytes have a distinct digest basis');
  assert.equal(diagramAuthoringBundleDigest({ ...bundle, bundleDigest: 'ignored' }), bundle.bundleDigest);
  assert.equal(diagramDocumentDigest({ ...bundle.document, documentDigest: 'ignored' }), bundle.document.documentDigest);
  assert.equal(diagramPresentationDigest({ ...bundle.presentation, presentationDigest: 'ignored' }), bundle.presentation.presentationDigest);
  const semantic = clone(bundle); semantic.document.nodes[0].label = 'Changed';
  semantic.document.documentDigest = diagramDocumentDigest(semantic.document); rehashBundle(semantic);
  failWith('diagram-authoring-bundle', semantic, 'basis');
  const moved = clone(bundle); moved.presentation.elements[0].bounds.x += 10;
  moved.presentation.presentationDigest = diagramPresentationDigest(moved.presentation);
  assert.equal(moved.document.documentDigest, bundle.document.documentDigest);
  assert.notEqual(moved.presentation.presentationDigest, bundle.presentation.presentationDigest);
  failWith('diagram-authoring-bundle', moved, 'digest');
  rehashBundle(moved); assert.deepEqual(validateDiagramAuthoringBundle(moved), []);
});

test('source correspondence retains exact Unicode and CRLF bytes and rejects substituted ranges or identities', () => {
  const bundle = makeBundle('flowchart', { source: true });
  const raw = new TextEncoder().encode(SOURCE_TEXT);
  assert.equal(bundle.originalSource.sourceDigest, `sha256:${createHash('sha256').update(raw).digest('hex')}`);
  assert.notEqual(bundle.originalSource.sourceDigest, digestText(SOURCE_TEXT.replaceAll('\r\n', '\n')));
  assert.notEqual(bundle.originalSource.sourceDigest, digestText(SOURCE_TEXT.normalize('NFD')));
  assert.deepEqual(validate('diagram-source-map', bundle.sourceMap, { bundle }), []);
  assert.equal(JSON.parse(JSON.stringify(bundle)).originalSource.text, SOURCE_TEXT);
  const wrongBytes = SOURCE_TEXT.replace('Café', 'Cafe');
  failWith('diagram-source-map', bundle.sourceMap, 'source-digest', { document: bundle.document, sourceText: wrongBytes });
  const duplicate = clone(bundle.sourceMap); duplicate.entries[1].sourceId = duplicate.entries[0].sourceId;
  failWith('diagram-source-map', duplicate, 'ambiguous-source-id', { bundle });
  const outOfRange = clone(bundle.sourceMap); outOfRange.entries[0].range.endByte = raw.length + 1;
  failWith('diagram-source-map', outOfRange, 'source-range', { bundle });
  const missing = clone(bundle.sourceMap); missing.entries[0].elementIds = ['missing'];
  failWith('diagram-source-map', missing, 'reference', { bundle });
});

test('all six persisted edit classes describe bounded reversible data without arbitrary patch paths', () => {
  const bundle = makeBundle('swimlane');
  const state = () => ({ groups: bundle.document.groups.map(({ id, members }) => ({ id, members: [...members] })), lanes: bundle.document.lanes.map(({ id, members }) => ({ id, members: [...members] })), laneOrder: [...bundle.document.laneOrder] });
  const p = bundle.presentation.elements[0];
  const geometry = ({ bounds, route, label, zIndex }) => ({ bounds: clone(bounds), route: clone(route), label: clone(label), zIndex });
  const afterMembership = state(); afterMembership.groups[0].members = []; afterMembership.lanes[0].members.push('node-a');
  const operations = [
    { type: 'insert-elements', elements: [{ collection: 'nodes', value: { id: 'new-node', label: 'Failure branch', kind: 'process', description: null } }], presentation: [placement('new-node')] },
    makeTransaction(bundle).operations[0],
    { type: 'remove-elements', elements: [{ collection: 'annotations', value: clone(bundle.document.annotations[0]) }], presentation: [clone(bundle.presentation.elements.find(item => item.elementId === 'note-a'))] },
    { type: 'set-membership-order', before: state(), after: afterMembership },
    { type: 'set-geometry', changes: [{ elementId: 'node-a', before: geometry(p), after: { ...geometry(p), bounds: { ...p.bounds, x: p.bounds.x + 20 } } }] },
    { type: 'set-appearance-locks', changes: [{ elementId: 'node-a', before: { appearance: clone(p.appearance), locks: clone(p.locks) }, after: { appearance: { ...p.appearance, fill: 'accent' }, locks: { ...p.locks, position: true } } }] },
  ];
  for (const operation of operations) {
    const transaction = { ...makeTransaction(bundle), transactionId: `edit-${operation.type}`, operations: [operation] };
    assert.strictEqual(assertDiagramAuthoringArtifact('diagram-edit-transaction', transaction, { baseBundle: bundle }), transaction);
    const malformed = clone(transaction); malformed.operations[0].path = '/document/title';
    assert.ok(validate('diagram-edit-transaction', malformed, { baseBundle: bundle }).length, operation.type);
  }
  const selfUndo = makeTransaction(bundle); selfUndo.undoOf = selfUndo.transactionId;
  failWith('diagram-edit-transaction', selfUndo, 'undo-reference', { baseBundle: bundle });
  const duplicate = { ...makeTransaction(bundle), operations: [clone(operations[0])] };
  duplicate.operations[0].elements[0].value.id = 'node-a'; duplicate.operations[0].presentation[0].elementId = 'node-a';
  failWith('diagram-edit-transaction', duplicate, 'duplicate-id', { baseBundle: bundle });
  const noPlacement = { ...makeTransaction(bundle), operations: [clone(operations[0])] }; noPlacement.operations[0].presentation[0].elementId = 'different-id';
  failWith('diagram-edit-transaction', noPlacement, 'presentation-coverage', { baseBundle: bundle });
});

test('proposal, report and publication contracts bind exact bases without granting portable authority', () => {
  const bundle = makeBundle('flowchart', { source: true });
  const proposal = makeProposal(bundle);
  assert.deepEqual(validate('diagram-change-proposal', proposal, { bundle }), []);
  const substituted = clone(proposal); substituted.transaction.base.presentationDigest = `sha256:${'a'.repeat(64)}`;
  failWith('diagram-change-proposal', substituted, 'basis', { bundle });
  const report = makeFidelity(bundle);
  assert.deepEqual(validate('diagram-fidelity-report', report, { bundle }), []);
  const misleading = clone(report); misleading.presentation = 'lossless';
  failWith('diagram-fidelity-report', misleading, 'fidelity', { bundle });
  const publication = { kind: 'diagram-publication-state', schemaVersion: '1.0.0', protocolVersion: '1.13.0', diagramId: bundle.diagramId,
    draft: snapshot(bundle), published: null, audience: 'private', capabilitySemantics: 'descriptive-only-requires-host-authorization' };
  assert.deepEqual(validate('diagram-publication-state', publication, { bundle }), []);
  for (const [key, value] of Object.entries({ organizationId: 'org-a', roles: ['author'], credentials: { token: 'inert-test-token' }, comments: ['private review'], camera: { x: 0 }, selection: ['node-a'], publication })) {
    const polluted = clone(bundle); polluted[key] = value; rehashBundle(polluted);
    failWith('diagram-authoring-bundle', polluted, 'additionalProperties');
  }
  assert.ok(validate('diagram-authoring-bundle', bundle, { trustDigest: true }).length, 'Options cannot bypass validation');
});

test('capability certification separates renderer membership, authoring and interchange fidelity', () => {
  assert.deepEqual(validate('diagram-authoring-capabilities', DIAGRAM_AUTHORING_CAPABILITIES), []);
  assert.ok(DIAGRAM_GRAMMAR_REGISTRY.grammars.some(item => item.grammarId === 'sequence'));
  assert.equal(getDiagramAuthoringCapability('sequence'), null);
  assert.equal(getDiagramAuthoringCapability('unknown-grammar'), null);
  const capability = getDiagramAuthoringCapability('flowchart');
  assert.equal(capability.authoring, true);
  assert.equal(capability.mermaid.linkedSource, false);
  for (const direction of ['forward', 'both', 'none']) {
    const bundle = makeBundle(); bundle.document.relations[0].direction = direction; sealBundle(bundle);
    assert.deepEqual(validateDiagramAuthoringBundle(bundle), []);
  }
  const misleading = clone(DIAGRAM_AUTHORING_CAPABILITIES);
  misleading.profiles[0].mermaid.constructs.find(item => item.construct === 'manual-geometry').semanticRoundTrip = 'lossless';
  failWith('diagram-authoring-capabilities', misleading, 'capability-certification');
  const unknown = clone(DIAGRAM_AUTHORING_CAPABILITIES); unknown.profiles[0].mermaid.constructs.push({ construct: 'unknown-syntax', import: 'lossless', export: 'lossless', semanticRoundTrip: 'lossless', mapping: 'Uncertified claim' });
  failWith('diagram-authoring-capabilities', unknown, 'capability-certification');
});

test('legacy inspection preserves all grammar bytes and IDs without silently migrating unsupported kinds', () => {
  for (const grammar of DIAGRAM_GRAMMAR_REGISTRY.grammars) {
    const path = join(root, 'packages/artifact', grammar.fixture);
    const bytes = readFileSync(path);
    const document = JSON.parse(bytes.toString('utf8'));
    const original = clone(document);
    const report = inspectLegacyDiagramDocument(document);
    assert.equal(report.valid, true, `${grammar.grammarId}: ${JSON.stringify(report.errors)}`);
    assert.equal(report.requiresDerivedPresentation, true);
    assert.equal(report.adoption, 'explicit-save-required');
    assert.equal(report.sourceModified, false);
    assert.deepEqual(document, original);
    assert.deepEqual(readFileSync(path), bytes);
    if (!getDiagramAuthoringCapability(grammar.grammarId) || report.unsupportedNodeKinds.length) assert.equal(report.authoringAvailable, false);
    assert.equal(Object.hasOwn(report, 'document'), false, 'Inspection does not fabricate an adopted successor');
  }
});

test('legacy inspection obeys the frozen schema for path, version and text boundaries', () => {
  const fixture = JSON.parse(readFileSync(join(root, 'packages/artifact/fixtures/diagram/grammars/flowchart.planr-diagram.json'), 'utf8'));
  const cases = [
    ['source path with spaces', doc => { doc.source.path = 'diagrams/my flow.mmd'; }, true],
    ['source traversal', doc => { doc.source.path = 'a/../x'; }, false],
    ['version with leading zero', doc => { doc.documentVersion = '01.0.0'; }, false],
    ['text beyond frozen limit', doc => { doc.title = 'x'.repeat(16385); }, false],
  ];
  for (const [name, edit, expected] of cases) {
    const document = clone(fixture); edit(document); document.documentDigest = diagramDocumentDigest(document);
    const before = JSON.stringify(document);
    const frozen = validateProtocolArtifact('diagram-document', document, { protocolVersion: '1.6.0' });
    assert.equal(frozen.length === 0, expected, `${name}: frozen schema`);
    const actual = inspectLegacyDiagramDocument(document);
    assert.equal(actual.valid, expected, `${name}: ${JSON.stringify(actual.errors)}`);
    assert.equal(JSON.stringify(document), before, `${name}: immutable inspection`);
  }
});

test('manifest transport paths are scoped and cannot overwrite canonical content', () => {
  const bundle = makeBundle('flowchart', { source: true });
  const manifest = makeManifest(bundle);
  assert.deepEqual(validate('diagram-manifest', manifest, { bundle }), []);
  const collision = clone(manifest); collision.outputs[0].path = collision.bundle.path;
  failWith('diagram-manifest', collision, 'canonical-output-collision', { bundle });
  const traversal = clone(manifest); traversal.outputs[0].path = '../checkout.svg';
  assert.ok(validate('diagram-manifest', traversal, { bundle }).length);
  const duplicate = clone(manifest); duplicate.outputs.push(clone(duplicate.outputs[0]));
  failWith('diagram-manifest', duplicate, 'duplicate-path', { bundle });
  const substituted = clone(manifest); substituted.outputs[0].fidelity.basis.presentationDigest = `sha256:${'2'.repeat(64)}`;
  failWith('diagram-manifest', substituted, 'basis', { bundle });
});

test('UTF-8 source and aggregate data limits reject excessive inputs before any adoption', () => {
  const source = makeBundle('flowchart', { source: true });
  source.originalSource.text = 'é'.repeat(530000);
  source.originalSource.sourceDigest = digestText(source.originalSource.text);
  source.sourceMap.sourceDigest = source.originalSource.sourceDigest;
  source.sourceMap.sourceByteLength = new TextEncoder().encode(source.originalSource.text).length;
  rehashBundle(source);
  assert.ok(validateDiagramAuthoringBundle(source).length, 'UTF-8 bytes, not UTF-16 length, bound original source');
  const enormous = makeBundle(); enormous.extra = 'x'.repeat(8_388_609);
  failWith('diagram-authoring-bundle', enormous, 'resource-limit');
});
