import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readBoardEmbeddedJson,
  reportBoardInitializationError,
} from '../lib/artifact/internal/board-embedded-data.mjs';

function document(content) {
  const status = {
      textContent: '',
      setAttribute(name) {
        this[name] = true;
      },
    },
    root = {
      setAttribute(name) {
        this[name] = true;
      },
    };
  return {
    status,
    root,
    getElementById: (id) => (Object.hasOwn(content, id) ? { textContent: content[id] } : null),
    querySelector: (selector) => (selector === '.planr-shell' ? root : status),
  };
}
test('missing embedded legacy state alone permits its explicit fallback', () => {
  const fallback = { review: null };
  assert.equal(readBoardEmbeddedJson(document({}), 'review', fallback), fallback);
  assert.deepEqual(
    readBoardEmbeddedJson(document({ review: '{"review":null}' }), 'review', fallback),
    fallback,
  );
});
test('present malformed state is visible, blocks initialization, and reveals none of its private content', () => {
  const dom = document({ review: '{"private":"customer secret", truncated' });
  let error;
  try {
    readBoardEmbeddedJson(dom, 'review', { review: null });
  } catch (value) {
    error = value;
  }
  assert.match(error.message, /review.*not valid JSON/);
  assert.doesNotMatch(error.message, /customer secret/);
  reportBoardInitializationError(dom, error);
  assert.equal(dom.status.textContent, error.message);
  assert.equal(dom.status['data-error'], true);
  assert.equal(dom.status.role, true);
  assert.equal(dom.root['data-planr-initialization-error'], true);
  assert.equal(globalThis.__OPENPLANR_ARTIFACT_STAGE_INITIALIZATION_ERROR__, error.message);
  delete globalThis.__OPENPLANR_ARTIFACT_STAGE_INITIALIZATION_ERROR__;
});
for (const value of ['null', '[]', '42', '"private"'])
  test(`present wrong-shape state ${value} cannot initialize an empty review`, () =>
    assert.throws(
      () => readBoardEmbeddedJson(document({ review: value }), 'review', {}),
      /must be an object/,
    ));
