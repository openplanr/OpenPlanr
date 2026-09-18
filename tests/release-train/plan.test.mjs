import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { planRelease } from '../../scripts/release/lib/plan.mjs';

function workspace({ changesets = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-release-plan-'));
  const manifests = {
    'packages/protocol': { name: '@openplanr/protocol', version: '0.4.0' },
    'packages/pipeline': { name: 'planr-pipeline', version: '0.45.3' },
    'packages/cli': { name: 'openplanr', version: '2.2.1' },
  };
  for (const [path, manifest] of Object.entries(manifests)) {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, 'package.json'), JSON.stringify(manifest));
  }
  mkdirSync(join(root, '.changeset'));
  writeFileSync(join(root, '.changeset/README.md'), '# Changesets\n');
  for (const name of changesets) writeFileSync(join(root, '.changeset', name), '---\n');
  return root;
}

test('plans the unpublished packages in dependency order and reports untagged published ones', async () => {
  const root = workspace();
  try {
    const plan = await planRelease({
      root,
      commit: 'a'.repeat(40),
      lookupPublished: async (name, version) =>
        name === '@openplanr/protocol' && version === '0.4.0',
      lookupTag: async () => false,
    });
    assert.deepEqual(plan.pending, ['planr-pipeline', 'openplanr']);
    assert.deepEqual(plan.untagged, ['@openplanr/protocol']);
    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.releasable, true);
    assert.deepEqual(
      plan.packages.map((entry) => entry.tag),
      ['@openplanr/protocol@0.4.0', 'planr-pipeline@0.45.3', 'openplanr@2.2.1'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('nothing pending means nothing releasable, and unconsumed changesets block a release', async () => {
  const settled = workspace();
  const blocked = workspace({ changesets: ['brave-otters.md'] });
  try {
    const nothing = await planRelease({
      root: settled,
      commit: 'b'.repeat(40),
      lookupPublished: async () => true,
      lookupTag: async () => true,
    });
    assert.deepEqual(nothing.pending, []);
    assert.equal(nothing.releasable, false);
    const plan = await planRelease({
      root: blocked,
      commit: 'c'.repeat(40),
      lookupPublished: async () => false,
      lookupTag: async () => false,
    });
    assert.deepEqual(plan.pending, ['@openplanr/protocol', 'planr-pipeline', 'openplanr']);
    assert.equal(plan.releasable, false);
    assert.match(plan.blockers[0], /brave-otters\.md/u);
  } finally {
    rmSync(settled, { recursive: true, force: true });
    rmSync(blocked, { recursive: true, force: true });
  }
});
