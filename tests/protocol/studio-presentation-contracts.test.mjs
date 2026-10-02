import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDiagramData,
  diagramAuthoringBundleDigest,
} from '../../packages/protocol/src/diagram-authoring-contracts.mjs';
import {
  assertDiagramPresentation,
  assertDiagramReviewBundleV11,
  assertVersionedDiagramAuthoringBundle,
  assertVersionedDiagramEditTransaction,
  assertVersionedDiagramReviewBundle,
  legacyDiagramAuthoringProjection,
  normalizeDiagramPresentation,
  validateVersionedDiagramAuthoringArtifact,
  validateVersionedDiagramAuthoringBundle,
  validateVersionedDiagramEditTransaction,
  versionedDiagramReviewBundleDigest,
} from '../../packages/protocol/src/studio-presentation-contracts.mjs';
import { makeBundle, makeTransaction } from './fixtures/diagram-authoring.mjs';
import { makeReviewBundle } from './fixtures/diagram-review.mjs';

function brandBundle() {
  const value = makeBundle();
  value.schemaVersion = '1.1.0';
  value.protocolVersion = '1.17.0';
  value.studioPresentation = normalizeDiagramPresentation();
  value.bundleDigest = diagramAuthoringBundleDigest(value);
  return value;
}

function brandTransaction(bundle = brandBundle()) {
  const value = makeTransaction(bundle);
  value.schemaVersion = '1.1.0';
  value.protocolVersion = '1.17.0';
  return value;
}

function brandReview() {
  return {
    ...makeReviewBundle(),
    schemaVersion: '1.1.0',
    presentation: normalizeDiagramPresentation(),
  };
}

function installGetter(target, key) {
  let reads = 0;
  const previous = target[key];
  const getter = () => {
    reads += 1;
    return previous;
  };
  Object.defineProperty(target, key, { enumerable: true, configurable: true, get: getter });
  return () => {
    assert.equal(reads, 0, `${key}: untrusted accessor was never executed`);
    assert.equal(Object.getOwnPropertyDescriptor(target, key).get, getter);
  };
}

test('versioned assertions retain caller identity and leave valid legacy bundles unchanged', () => {
  const legacy = makeBundle();
  const encoded = JSON.stringify(legacy);
  assert.equal(assertVersionedDiagramAuthoringBundle(legacy), legacy);
  assert.equal(JSON.stringify(legacy), encoded);
  const bundle = brandBundle();
  const transaction = brandTransaction(bundle);
  const review = brandReview();
  const presentation = normalizeDiagramPresentation();
  assert.equal(assertDiagramData(bundle), bundle);
  assert.equal(assertDiagramPresentation(presentation), presentation);
  assert.equal(assertVersionedDiagramAuthoringBundle(bundle), bundle);
  assert.equal(
    assertVersionedDiagramEditTransaction(transaction, { baseBundle: bundle }),
    transaction,
  );
  assert.equal(assertDiagramReviewBundleV11(review), review);
  assert.equal(assertVersionedDiagramReviewBundle(review), review);
  assert.deepEqual(validateVersionedDiagramAuthoringBundle(bundle), []);
  assert.deepEqual(
    validateVersionedDiagramEditTransaction(transaction, { baseBundle: bundle }),
    [],
  );
  assert.deepEqual(
    validateVersionedDiagramAuthoringArtifact('diagram-authoring-bundle', bundle),
    [],
  );
});

test('presentation and version dispatch reject accessors before schema reads', () => {
  const cases = [
    [normalizeDiagramPresentation(), 'theme', assertDiagramPresentation],
    [{ theme: 'light' }, 'theme', normalizeDiagramPresentation],
    [brandBundle(), 'schemaVersion', assertVersionedDiagramAuthoringBundle],
    [brandTransaction(), 'schemaVersion', assertVersionedDiagramEditTransaction],
    [brandReview(), 'schemaVersion', assertDiagramReviewBundleV11],
    [brandReview(), 'schemaVersion', assertVersionedDiagramReviewBundle],
    [brandReview(), 'schemaVersion', versionedDiagramReviewBundleDigest],
    [brandBundle(), 'studioPresentation', legacyDiagramAuthoringProjection],
  ];
  for (const [value, key, operation] of cases) {
    const unchanged = installGetter(value, key);
    assert.throws(() => operation(value), /accessor/);
    unchanged();
  }
});

test('transaction operations and supplied context reject nested or root accessors without execution', () => {
  const bundle = brandBundle();
  const transaction = brandTransaction(bundle);
  const operationUnchanged = installGetter(transaction.operations[0], 'before');
  assert.throws(
    () => assertVersionedDiagramEditTransaction(transaction, { baseBundle: bundle }),
    /accessor/,
  );
  operationUnchanged();

  for (const key of ['baseBundle', 'bundle']) {
    const options = { [key]: bundle };
    const contextUnchanged = installGetter(options, key);
    assert.throws(
      () => assertVersionedDiagramEditTransaction(brandTransaction(bundle), options),
      /accessor/,
    );
    contextUnchanged();
  }

  const nested = brandBundle();
  const nestedUnchanged = installGetter(nested.studioPresentation, 'theme');
  assert.throws(
    () => assertVersionedDiagramEditTransaction(brandTransaction(bundle), { baseBundle: nested }),
    /accessor/,
  );
  nestedUnchanged();
});

test('diagnostic versioned validators reject accessors without throwing or invoking them', () => {
  const bundle = brandBundle();
  const bundleUnchanged = installGetter(bundle, 'schemaVersion');
  assert.ok(validateVersionedDiagramAuthoringBundle(bundle).length);
  assert.ok(validateVersionedDiagramAuthoringArtifact('diagram-authoring-bundle', bundle).length);
  bundleUnchanged();

  const transaction = brandTransaction();
  const transactionUnchanged = installGetter(transaction, 'schemaVersion');
  assert.ok(validateVersionedDiagramEditTransaction(transaction).length);
  assert.ok(
    validateVersionedDiagramAuthoringArtifact('diagram-edit-transaction', transaction).length,
  );
  transactionUnchanged();

  const options = { baseBundle: brandBundle() };
  const optionsUnchanged = installGetter(options, 'baseBundle');
  assert.ok(validateVersionedDiagramEditTransaction(brandTransaction(), options).length);
  assert.ok(
    validateVersionedDiagramAuthoringArtifact(
      'diagram-edit-transaction',
      brandTransaction(),
      options,
    ).length,
  );
  optionsUnchanged();
});

test('new presentation assertions inherit inert-data and aggregate resource boundaries', () => {
  const values = [];
  const inherited = Object.assign(
    Object.create({ privateMarker: true }),
    normalizeDiagramPresentation(),
  );
  values.push(inherited);
  const symbolic = normalizeDiagramPresentation();
  symbolic[Symbol('hidden')] = 'data';
  values.push(symbolic);
  const nonEnumerable = normalizeDiagramPresentation();
  Object.defineProperty(nonEnumerable, 'privateMarker', { value: true });
  values.push(nonEnumerable);
  const cycle = normalizeDiagramPresentation();
  cycle.extra = cycle;
  values.push(cycle);
  const oversized = normalizeDiagramPresentation();
  oversized.extra = 'x'.repeat(8 * 1024 * 1024 + 1);
  values.push(oversized);
  for (const value of values) assert.throws(() => assertDiagramPresentation(value), TypeError);
});

test('versioned bundle digest binds the full presentation rather than a caller claim', () => {
  const value = brandBundle();
  value.studioPresentation.theme = 'dark';
  assert.throws(
    () => assertVersionedDiagramAuthoringBundle(value),
    /Invalid diagram authoring bundle/,
  );
  value.bundleDigest = diagramAuthoringBundleDigest(value);
  assert.equal(assertVersionedDiagramAuthoringBundle(value), value);
  const projection = legacyDiagramAuthoringProjection(value);
  assert.notEqual(projection.bundleDigest, value.bundleDigest);
});
