import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { designSystemStatus, resolveDesignSystem, summarizeDesignSystem } from '../../lib/design/designSystem.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures');

test('status priority: package > design-md > theme > stack > none', () => {
  assert.equal(designSystemStatus({ hasPackage: true, hasDesignMd: true }).source, 'package');
  assert.equal(designSystemStatus({ hasDesignMd: true, hasTheme: true }).source, 'design-md');
  assert.equal(designSystemStatus({ hasTheme: true, hasStackTokens: true }).source, 'theme');
  assert.equal(designSystemStatus({ hasStackTokens: true }).source, 'stack');
  assert.equal(designSystemStatus({}).found, false);
  assert.equal(designSystemStatus({}).source, 'none');
});

test('resolveDesignSystem reads a package fixture (tokens + themes + fonts + brand/components)', () => {
  const dir = join(fixtures, 'design-system');
  const ds = resolveDesignSystem({ dir, projectRoot: dir });
  assert.equal(ds.found, true);
  assert.equal(ds.source, 'package');
  assert.ok(ds.tokens.length >= 5, `tokens parsed (${ds.tokens.length})`);
  assert.equal(ds.themes.length, 1);
  assert.equal(ds.fonts.length, 1);
  assert.ok(ds.brand && ds.components, 'brand.md + components.md detected');
  assert.ok(ds.tokensCss, 'tokens.css path bound');
  assert.ok(summarizeDesignSystem(ds).startsWith('package · 6 tokens (3 color)'));
});

test('resolveDesignSystem on an empty project → not found → gate message', () => {
  const dir = join(fixtures, '__none__');
  const ds = resolveDesignSystem({ dir, projectRoot: dir });
  assert.equal(ds.found, false);
  assert.equal(summarizeDesignSystem(ds), 'none — preflight will ask to generate / point to one / describe');
});
