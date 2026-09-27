import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import { validateJson } from '../../packages/protocol/src/json-schema.mjs';

const protocol = resolve(import.meta.dirname, '..', '..', 'packages', 'protocol');
const readJson = (path) => JSON.parse(readFileSync(join(protocol, path), 'utf8'));
const preserved = readJson('registry/artifact-theme.json');
const theme = readJson('registries/artifact-theme.json');
const schema = readJson('schemas/v1.14.0/artifact-theme.schema.json');

function changedKeys(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !isDeepStrictEqual(before[key], after[key]))
    .sort();
}

test('the Protocol 1.14 artifact theme satisfies its closed schema', () => {
  assert.equal(schema.$id, 'https://openplanr.dev/schemas/v1.14.0/artifact-theme.schema.json');
  assert.deepEqual(schema['x-openplanr-contract'], { id: 'artifact-theme', version: '1.14.0' });
  assert.deepEqual(validateJson(theme, schema), []);

  for (const palette of ['dark', 'light']) {
    const missing = structuredClone(theme);
    delete missing.themes[palette].onPrimary;
    assert.ok(
      validateJson(missing, schema).some(({ rule }) => rule === 'required'),
      `${palette} requires onPrimary`,
    );
  }
  assert.notDeepEqual(validateJson(preserved, schema), [], 'the preserved theme is not a 1.14 one');
});

test('the successor differs from the preserved theme only in identity, light teal and onPrimary', () => {
  assert.deepEqual(changedKeys(preserved, theme), [
    'kind',
    'protocolVersion',
    'schemaVersion',
    'themes',
  ]);
  assert.deepEqual(
    [theme.kind, theme.schemaVersion, theme.protocolVersion],
    ['artifact-theme', '1.1.0', '1.14.0'],
  );
  assert.deepEqual(changedKeys(preserved.themes.dark, theme.themes.dark), ['onPrimary']);
  assert.deepEqual(changedKeys(preserved.themes.light, theme.themes.light), [
    'onPrimary',
    'primary',
    'primaryStrong',
  ]);
  assert.equal(theme.themes.dark.onPrimary, '#07110f');
  assert.deepEqual(
    [theme.themes.light.primary, theme.themes.light.primaryStrong, theme.themes.light.onPrimary],
    ['#237a72', '#1b5f59', '#ffffff'],
  );
});
