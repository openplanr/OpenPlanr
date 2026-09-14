import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ARCHIVED_DASHBOARD_PATHS, excludeArchivedDashboardRecords } from '../../scripts/migration/archived-dashboard-records.mjs';
import { sha256 } from '../../scripts/migration/preservation-lib.mjs';

test('retired dashboard records require original archive bytes and preserve all other custody', async () => {
  const custodyRoot = await mkdtemp(path.join(tmpdir(), 'openplanr-dashboard-archive-'));
  try {
    const inventory = { coverage: {}, pathMappings: [] };
    for (const sourcePath of ARCHIVED_DASHBOARD_PATHS) {
      const bytes = `Historical dashboard record: ${sourcePath}\n`;
      await writeFile(path.join(custodyRoot, path.basename(sourcePath)), bytes, { mode: 0o644 });
      inventory.pathMappings.push({
        mappingId: `planr-pipeline:cutoff:${sourcePath}`, sourcePath,
        included: { sha256: sha256(bytes), mode: '100644' }, cutoff: { present: true },
        disposition: 'exact', destinations: [{ path: `packages/pipeline/${sourcePath}` }],
        verification: { policy: 'byte-bound' },
      });
    }
    const current = { mappingId: 'planr-pipeline:cutoff:docs/dashboard.md', sourcePath: 'docs/dashboard.md', disposition: 'exact' };
    inventory.pathMappings.push(current);
    await assert.rejects(excludeArchivedDashboardRecords(inventory), /requires --archived-dashboard-custody/u);
    const classified = await excludeArchivedDashboardRecords(inventory, { custodyRoot });
    assert.equal(classified.pathMappings.length, inventory.pathMappings.length);
    for (let index = 0; index < ARCHIVED_DASHBOARD_PATHS.length; index += 1) {
      const before = inventory.pathMappings[index];
      const after = classified.pathMappings[index];
      assert.deepEqual(after.included, before.included);
      assert.deepEqual(after.cutoff, before.cutoff);
      assert.equal(after.sourcePath, before.sourcePath);
      assert.equal(after.disposition, 'excluded');
      assert.deepEqual(after.destinations, []);
      assert.equal(after.verification.policy, 'declared-absence');
    }
    assert.deepEqual(classified.pathMappings.at(-1), current);
    assert.deepEqual(await excludeArchivedDashboardRecords(classified), classified);
    assert.deepEqual(classified.coverage.dispositionCounts, { excluded: 12, exact: 1 });

    const first = path.join(custodyRoot, path.basename(ARCHIVED_DASHBOARD_PATHS[0]));
    const original = await readFile(first);
    await writeFile(first, 'Changed historical content\n');
    await assert.rejects(excludeArchivedDashboardRecords(inventory, { custodyRoot }), /custody bytes differ/u);
    await writeFile(first, original);
    await chmod(first, 0o755);
    await assert.rejects(excludeArchivedDashboardRecords(inventory, { custodyRoot }), /custody mode differs/u);
    await chmod(first, 0o644);
    await rm(first);
    await assert.rejects(excludeArchivedDashboardRecords(inventory, { custodyRoot }), { code: 'ENOENT' });
  } finally {
    await rm(custodyRoot, { recursive: true, force: true });
  }
});
