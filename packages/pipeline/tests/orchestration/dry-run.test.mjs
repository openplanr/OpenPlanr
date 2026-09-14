import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { snapshotRelativePaths } from '../helpers/fsSnapshot.mjs';
import { planDryRunReadOnlyInspect } from '../../lib/shipPrecheck.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const fixtureRoot = join(root, 'tests/fixtures/dry-run-scenario');

test('`/plan`-style dry-run inspect is read-only (no filesystem deltas vs fixture snapshot)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-dry-'));
  try {
    cpSync(fixtureRoot, dir, { recursive: true });
    const before = snapshotRelativePaths(dir);
    const summary = planDryRunReadOnlyInspect(dir, 'dry-sample');
    assert.equal(summary.slug, 'dry-sample');
    const after = snapshotRelativePaths(dir);
    assert.deepEqual(after, before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
