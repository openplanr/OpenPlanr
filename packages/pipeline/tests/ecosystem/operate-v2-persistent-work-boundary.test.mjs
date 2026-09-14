import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const source = readFileSync(fileURLToPath(new URL(
  '../../lib/operate/persistent-work-projections-v2.mjs', import.meta.url,
)), 'utf8');

test('persistent-work projections remain a v2-only, read-only boundary', () => {
  assert.doesNotMatch(source, /parked/iu);
  assert.doesNotMatch(source, /(?:execute|policy|capability)/iu);
  assert.doesNotMatch(source, /(?:legacy[-_ ]?(?:reader|translator|mapper|import)|v1\.[234]\.0)/iu);
  assert.match(source, /assertProtocolArtifact\('operating-runtime-state'/u);
  assert.match(source, /Object\.freeze/u);
});
