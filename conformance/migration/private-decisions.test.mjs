import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { excludePrivateDecisionRecords, PRIVATE_DECISION_PATHS } from '../../scripts/migration/private-decision-records.mjs';
import { sha256 } from '../../scripts/migration/preservation-lib.mjs';

test('private ADR classification requires byte-proven custody and preserves every source identity', async () => {
  const custodyRoot = await mkdtemp(path.join(tmpdir(), 'openplanr-private-decisions-'));
  try {
    const inventory = { coverage: {}, pathMappings: [] };
    for (const sourcePath of PRIVATE_DECISION_PATHS) {
      const bytes = `Original decision: ${sourcePath}\n`;
      const target = path.join(custodyRoot, 'packages/pipeline', sourcePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
      inventory.pathMappings.push({ mappingId: `planr-pipeline:cutoff:${sourcePath}`, sourcePath, included: { sha256: sha256(bytes) }, cutoff: { present: true }, disposition: 'exact', destinations: [{ path: `packages/pipeline/${sourcePath}` }], verification: { policy: 'byte-bound' } });
    }
    inventory.pathMappings.push({ mappingId: 'synthetic-adr-fixture', sourcePath: 'conformance/fixtures/context/.planr/adrs/ADR-001.md', disposition: 'exact' });
    await assert.rejects(excludePrivateDecisionRecords(inventory), /requires --private-decision-custody/u);
    const classified = await excludePrivateDecisionRecords(inventory, { custodyRoot });
    assert.equal(classified.pathMappings.length, inventory.pathMappings.length);
    for (let index = 0; index < PRIVATE_DECISION_PATHS.length; index += 1) {
      assert.deepEqual(classified.pathMappings[index].included, inventory.pathMappings[index].included);
      assert.deepEqual(classified.pathMappings[index].cutoff, inventory.pathMappings[index].cutoff);
      assert.equal(classified.pathMappings[index].disposition, 'excluded');
    }
    assert.deepEqual(classified.pathMappings.at(-1), inventory.pathMappings.at(-1));
    assert.deepEqual(await excludePrivateDecisionRecords(classified), classified);
    const first = path.join(custodyRoot, 'packages/pipeline', PRIVATE_DECISION_PATHS[0]);
    await writeFile(first, `${await readFile(first, 'utf8')}Changed\n`);
    await assert.rejects(excludePrivateDecisionRecords(inventory, { custodyRoot }), /custody bytes differ/u);
  } finally {
    await rm(custodyRoot, { recursive: true, force: true });
  }
});
