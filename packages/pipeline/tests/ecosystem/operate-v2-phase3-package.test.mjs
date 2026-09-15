import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkOperateRuntimePurity,
  packOperateV2DevelopmentSnapshot,
} from '../../scripts/check-operate-runtime-purity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-operate-v2-phase3-package-'));

after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

test('Phase 3 packed consumer exposes durable-work readers without a legacy or execution surface', { timeout: 120_000 }, () => {
  const packageDestination = join(temporaryRoot, 'package');
  const packed = packOperateV2DevelopmentSnapshot(packageDestination, { sourceRoot: root });
  assert.equal(packed.ok, true);
  assert.match(packed.sha256, /^[a-f0-9]{64}$/);
  assert.equal(packed.sourcePurity.ok, true);
  assert.equal(packed.tarballPurity.ok, true);

  const packedFiles = new Set(packed.files.map(({ path }) => path));
  for (const required of [
    'conformance/verify-operate-v2-persistent-work.mjs',
    'conformance/fixtures/operating-runtime-v2/persistent-work-valid.json',
    'conformance/fixtures/operating-runtime-v2/persistent-work-invalid.json',
    'conformance/fixtures/operating-runtime-v2/carry-forward-valid.json',
    'conformance/fixtures/operating-runtime-v2/carry-forward-invalid.json',
    'conformance/fixtures/operating-runtime-v2/persistent-work-cross-cycle.json',
    'lib/operate/persistent-work-v2.mjs',
    'lib/operate/persistent-work-v2.d.mts',
    'lib/operate/cycle-closure-v2.mjs',
    'lib/operate/cycle-closure-v2.d.mts',
    'lib/operate/persistent-work-projections-v2.mjs',
    'lib/operate/persistent-work-projections-v2.d.mts',
    'schemas/v2.0.0/operating-finding.schema.json',
    'schemas/v2.0.0/operating-decision.schema.json',
    'schemas/v2.0.0/operating-action.schema.json',
    'schemas/v2.0.0/operating-work-change-set.schema.json',
    'schemas/v2.0.0/operating-work-ledger.schema.json',
  ]) assert.equal(packedFiles.has(required), true, `missing Phase 3 package asset ${required}`);

  for (const path of packedFiles) {
    assert.doesNotMatch(path, /^(?:\.planr\/|tests\/|node_modules\/|\.env(?:\.|\/|$))/);
    assert.doesNotMatch(path, /(?:compatibility-v1_4|records-migration|operating-provider-kit)/);
  }

  const installedPackage = join(temporaryRoot, 'consumer', 'node_modules', 'planr-pipeline');
  mkdirSync(installedPackage, { recursive: true });
  run('tar', ['-xzf', packed.tarballPath, '-C', installedPackage, '--strip-components=1']);
  const metadata = JSON.parse(readFileSync(join(installedPackage, 'package.json'), 'utf8'));
  assert.deepEqual(metadata.exports['./operate/persistent-work-v2'], {
    types: './lib/operate/persistent-work-v2.d.mts',
    import: './lib/operate/persistent-work-v2.mjs',
  });
  assert.deepEqual(metadata.exports['./operate/persistent-work-projections-v2'], {
    types: './lib/operate/persistent-work-projections-v2.d.mts',
    import: './lib/operate/persistent-work-projections-v2.mjs',
  });
  assert.equal(metadata.exports['./operate/cycle-close-v2'], undefined);
  assert.equal(metadata.exports['./operate/executor-v2'], undefined);
  assert.equal(existsSync(join(installedPackage, 'schemas/v1.4.0/operating-event.schema.json')), false);

  const conformance = run(process.execPath, [
    join(installedPackage, 'conformance', 'verify-operate-v2-persistent-work.mjs'),
  ], { cwd: installedPackage });
  const report = JSON.parse(conformance.stdout);
  assert.deepEqual(report, { ok: true, protocolVersion: '2.0.0', checks: 9 });
  assert.equal(checkOperateRuntimePurity(installedPackage).ok, true);
});
