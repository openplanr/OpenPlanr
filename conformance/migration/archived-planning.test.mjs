import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ARCHIVED_PLANNING_RECORDS, excludeArchivedPlanningRecords } from '../../scripts/migration/archived-planning-records.mjs';
import { sha256 } from '../../scripts/migration/preservation-lib.mjs';

test('archived planning records keep the package layout and require original bytes', async () => {
  const custodyRoot = await mkdtemp(path.join(tmpdir(), 'openplanr-planning-archive-'));
  try {
    const inventory = { coverage: {}, pathMappings: [] };
    for (const { mappingId, archivePath } of ARCHIVED_PLANNING_RECORDS) {
      const [sourceId, , sourcePath] = mappingId.split(':');
      assert.match(archivePath, sourceId === 'planr-pipeline' ? /^pipeline\// : /^cli\//);
      assert.equal(archivePath.split('/').slice(1).join('/'), sourcePath.replace(/^docs\//, ''));
      const bytes = `Historical planning record: ${sourcePath}\n`;
      await mkdir(path.dirname(path.join(custodyRoot, archivePath)), { recursive: true });
      await writeFile(path.join(custodyRoot, archivePath), bytes, { mode: 0o644 });
      inventory.pathMappings.push({
        mappingId, sourcePath,
        included: { sha256: sha256(bytes), mode: '100644' }, cutoff: { present: true },
        disposition: 'exact', destinations: [{ path: `packages/${sourceId}/${sourcePath}` }],
        verification: { policy: 'byte-bound' },
      });
    }
    const current = { mappingId: 'planr-pipeline:cutoff:docs/rules.md', sourcePath: 'docs/rules.md', disposition: 'merged' };
    inventory.pathMappings.push(current);
    await assert.rejects(excludeArchivedPlanningRecords(inventory), /requires --archived-planning-custody/u);
    const classified = await excludeArchivedPlanningRecords(inventory, { custodyRoot });
    assert.equal(classified.pathMappings.length, inventory.pathMappings.length);
    for (let index = 0; index < ARCHIVED_PLANNING_RECORDS.length; index += 1) {
      const before = inventory.pathMappings[index];
      const after = classified.pathMappings[index];
      assert.deepEqual(after.included, before.included);
      assert.equal(after.sourcePath, before.sourcePath);
      assert.equal(after.disposition, 'excluded');
      assert.equal(after.reasonCode, 'retired-internal-planning-retained-in-verified-custody');
      assert.deepEqual(after.destinations, []);
      assert.equal(after.verification.policy, 'declared-absence');
    }
    assert.deepEqual(classified.pathMappings.at(-1), current);
    assert.deepEqual(await excludeArchivedPlanningRecords(classified), classified);
    assert.deepEqual(classified.coverage.dispositionCounts, { excluded: ARCHIVED_PLANNING_RECORDS.length, merged: 1 });

    const first = path.join(custodyRoot, ARCHIVED_PLANNING_RECORDS[0].archivePath);
    const original = await readFile(first);
    await writeFile(first, 'Changed historical content\n');
    await assert.rejects(excludeArchivedPlanningRecords(inventory, { custodyRoot }), /custody bytes differ/u);
    await writeFile(first, original);
    await chmod(first, 0o755);
    await assert.rejects(excludeArchivedPlanningRecords(inventory, { custodyRoot }), /custody mode differs/u);
    await chmod(first, 0o644);
    await rm(first);
    await assert.rejects(excludeArchivedPlanningRecords(inventory, { custodyRoot }), { code: 'ENOENT' });
  } finally {
    await rm(custodyRoot, { recursive: true, force: true });
  }
});
