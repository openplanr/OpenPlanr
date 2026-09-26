import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PACKED_WORKSPACE_PROTOCOL_ASSET_COUNTS } from '../../packages/pipeline/lib/ecosystem/packed-workspace-proof.mjs';
import { GENERATOR_STEPS } from '../../scripts/generate-all.mjs';
import {
  assertPackedSurfaceCompatibility,
  countProtocolAssets,
  readPackedSurfaceBaseline,
} from '../../scripts/verify-packed-workspace.mjs';

const baseline = readPackedSurfaceBaseline();
const pipeline = new URL('../../packages/pipeline/', import.meta.url);

test('the static packed compatibility floor retains actual export names and symbols', async () => {
  assert.equal(baseline.baselineExportKeys.length, 37);
  assert.equal(baseline.baselineRootSymbols.length, 229);
  assert.equal(baseline.baselineVersion, '0.44.0');
  assert.match(baseline.sourceCatalogDigest, /^sha256:[a-f0-9]{64}$/u);
  const manifest = JSON.parse(readFileSync(new URL('package.json', pipeline), 'utf8'));
  const current = await import(new URL(manifest.exports['.'].import, pipeline));
  assertPackedSurfaceCompatibility(baseline, {
    exportKeys: Object.keys(manifest.exports),
    rootSymbols: Object.keys(current),
  });
});

test('same-size substitutions cannot conceal removal of a supported export or root symbol', () => {
  const accepted = {
    exportKeys: [...baseline.baselineExportKeys],
    rootSymbols: [...baseline.baselineRootSymbols],
  };
  assert.doesNotThrow(() => assertPackedSurfaceCompatibility(baseline, accepted));
  const changedExport = {
    ...accepted,
    exportKeys: ['replaced-export', ...accepted.exportKeys.slice(1)],
  };
  assert.throws(() => assertPackedSurfaceCompatibility(baseline, changedExport), {
    code: 'E_PIPELINE_EXPORT_BASELINE_MISSING',
  });
  const changedSymbol = {
    ...accepted,
    rootSymbols: ['replacedSymbol', ...accepted.rootSymbols.slice(1)],
  };
  assert.throws(() => assertPackedSurfaceCompatibility(baseline, changedSymbol), {
    code: 'E_PIPELINE_ROOT_SYMBOL_DRIFT',
  });
});

function protocolInventory() {
  const files = [];
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) visit(join(directory, entry.name), relative);
      else if (entry.isFile()) files.push({ path: relative });
    }
  };
  for (const name of ['schemas', 'registry'])
    visit(fileURLToPath(new URL(`${name}/`, pipeline)), name);
  return files;
}

test('the packed asset floor identifies required paths without a repository-wide digest catalog', () => {
  const inventory = protocolInventory();
  assert.deepEqual(
    countProtocolAssets(inventory, baseline),
    PACKED_WORKSPACE_PROTOCOL_ASSET_COUNTS,
  );
  for (const required of [
    baseline.protocolAssets.originalRegistryPaths[0],
    baseline.protocolAssets.successorRegistryPaths[0],
    baseline.protocolAssets.successorSchemaPaths[0],
  ]) {
    const substituted = inventory.map((entry) =>
      entry.path === required ? { path: `${required}.replacement` } : entry,
    );
    assert.notDeepEqual(
      countProtocolAssets(substituted, baseline),
      PACKED_WORKSPACE_PROTOCOL_ASSET_COUNTS,
      required,
    );
  }
  assert.throws(
    () => countProtocolAssets([...inventory, { path: 'registry/unknown.json' }], baseline),
    { code: 'E_PACK_PROTOCOL_ASSET_DRIFT' },
  );
});

test('normal generation never rewrites the reviewed compatibility baseline', () => {
  assert.ok(GENERATOR_STEPS.every((step) => step.id !== 'preservation-catalog'));
  for (const step of GENERATOR_STEPS)
    for (const candidate of step.candidates) {
      assert.doesNotMatch(candidate.write.script, /preservation-catalog|packed-surface-baseline/u);
    }
});
