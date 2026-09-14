import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildManifest, validateManifest, SCHEMA_VERSION,
} from '../../lib/design/manifest.mjs';

const BASE = {
  designFormat: 'walkthrough',
  source: 'spec',
  generatedAt: '2026-06-07T00:00:00Z',
  screens: ['Login', 'Dashboard', 'Settings'],
  navMode: 'anchor',
  screenName: 'auth-flow',
};

test('buildManifest produces a schema-valid manifest', () => {
  const m = buildManifest(BASE);
  assert.equal(m.schema_version, SCHEMA_VERSION);
  assert.equal(m.design_format, 'walkthrough');
  assert.equal(m.framework, 'vanilla');
  assert.equal(m.screen_count, 3);
  assert.deepEqual(validateManifest(m), { ok: true, errors: [] });
});

test('the discriminator field is design_format, never format (T2)', () => {
  const m = buildManifest(BASE);
  assert.ok('design_format' in m);
  assert.ok(!('format' in m), 'must not use the reserved JSON-Schema keyword "format"');
});

test('canvas defaults to the react framework', () => {
  const m = buildManifest({ ...BASE, designFormat: 'canvas', navMode: null });
  assert.equal(m.framework, 'react');
  assert.equal(validateManifest(m).ok, true);
});

test('buildManifest throws when a required field is missing', () => {
  assert.throws(() => buildManifest({ source: 'spec', generatedAt: 'x' }), /designFormat is required/);
  assert.throws(() => buildManifest({ designFormat: 'prototype', generatedAt: 'x' }), /source is required/);
  assert.throws(() => buildManifest({ designFormat: 'prototype', source: 'spec' }), /generatedAt is required/);
});

test('validateManifest rejects a bad format enum and a react/non-canvas mismatch', () => {
  const bad = validateManifest({
    schema_version: '1.0.0', design_format: 'mockup', source: 'spec',
    content_provenance: 'spec', framework: 'vanilla', screens: [], generated_at: 'x',
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('design_format')));

  const mismatch = validateManifest({
    schema_version: '1.0.0', design_format: 'prototype', source: 'spec',
    content_provenance: 'spec', framework: 'react', screens: [], generated_at: 'x',
  });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.some((e) => e.includes('react')));
});

test('omits empty optional fields to keep the manifest terse', () => {
  const m = buildManifest({ designFormat: 'prototype', source: 'describe', generatedAt: 'x' });
  assert.ok(!('nav_mode' in m));
  assert.ok(!('spec_id' in m));
});
