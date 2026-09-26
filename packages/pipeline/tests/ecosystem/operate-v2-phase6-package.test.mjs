import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkOperateRuntimePurity,
  packOperateV2DevelopmentSnapshot,
} from '../../scripts/check-operate-runtime-purity.mjs';
import { OPERATE_RUNTIME_CONTRACT_KINDS } from '../../lib/protocol/loader.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-operate-v2-phase6-package-'));

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

test('Phase 6 packs and runs the complete governed loop in an isolated public consumer', {
  timeout: 120_000,
}, () => {
  const packed = packOperateV2DevelopmentSnapshot(join(temporaryRoot, 'package'), {
    sourceRoot: root,
  });
  assert.equal(packed.ok, true);
  assert.match(packed.tarballPath, /\.tgz$/u);
  assert.match(packed.sha256, /^[a-f0-9]{64}$/u);
  assert.match(packed.shasum, /^[a-f0-9]{40}$/u);
  assert.match(packed.integrity, /^sha512-/u);
  assert.equal(packed.sourcePurity.ok, true);
  assert.equal(packed.tarballPurity.ok, true);

  const packedFiles = new Set(packed.files.map(({ path }) => path));
  for (const required of [
    'conformance/verify-operate-v2-governed-execution.mjs',
    'conformance/verify-operate-v2-operating-intelligence.mjs',
    'lib/operate/authorization-v2.mjs',
    'lib/operate/authorization-v2.d.mts',
    'lib/operate/policy-v2.mjs',
    'lib/operate/policy-v2.d.mts',
    'lib/operate/approvals-v2.mjs',
    'lib/operate/approvals-v2.d.mts',
    'lib/operate/governed-extensions-v2.mjs',
    'lib/operate/governed-extensions-v2.d.mts',
    'lib/operate/reference-governed-executors-v2.mjs',
    'lib/operate/reference-governed-executors-v2.d.mts',
    'lib/operate/governed-execution-v2.mjs',
    'lib/operate/governed-execution-v2.d.mts',
    'lib/operate/governed-recovery-v2.mjs',
    'lib/operate/governed-recovery-v2.d.mts',
    'lib/operate/execution-verification-v2.mjs',
    'lib/operate/execution-verification-v2.d.mts',
    'docs/protocol/operate-runtime-v2.md',
  ])
    assert.equal(packedFiles.has(required), true, `missing Phase-6 package asset ${required}`);
  for (const path of packedFiles) {
    assert.doesNotMatch(path, /^(?:\.planr\/|tests\/|node_modules\/|\.env(?:\.|\/|$))/u);
    assert.doesNotMatch(path, /(?:compatibility-v1_4|records-migration|operating-provider-kit)/iu);
  }

  const consumer = join(temporaryRoot, 'consumer');
  const installedPackage = join(consumer, 'node_modules', 'planr-pipeline');
  mkdirSync(installedPackage, { recursive: true });
  run('tar', ['-xzf', packed.tarballPath, '-C', installedPackage, '--strip-components=1']);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ type: 'module' }));
  const metadata = JSON.parse(readFileSync(join(installedPackage, 'package.json'), 'utf8'));
  for (const name of [
    'authorization-v2',
    'policy-v2',
    'approvals-v2',
    'governed-extensions-v2',
    'reference-governed-executors-v2',
    'governed-execution-v2',
    'governed-recovery-v2',
    'execution-verification-v2',
  ]) {
    const entry = metadata.exports[`./operate/${name}`];
    assert.equal(typeof entry?.import, 'string', `${name}: public runtime export`);
    assert.equal(typeof entry?.types, 'string', `${name}: public type export`);
    assert.equal(
      existsSync(join(installedPackage, entry.import)),
      true,
      `${name}: packaged runtime`,
    );
    assert.equal(
      existsSync(join(installedPackage, entry.types)),
      true,
      `${name}: packaged declaration`,
    );
  }
  for (const forbidden of [
    './operate/executor-v2',
    './operate/capability-v2',
    './operate/approval-bypass-v2',
  ])
    assert.equal(
      metadata.exports[forbidden],
      undefined,
      `${forbidden}: no ambient-authority facade`,
    );

  const verifierPath = join(
    installedPackage,
    'conformance',
    'verify-operate-v2-governed-execution.mjs',
  );
  const verifierSource = readFileSync(verifierPath, 'utf8');
  assert.doesNotMatch(
    verifierSource,
    /(?:file:|\/Users\/|\.planr\/|\.env|process\.env)/u,
    'the governed verifier has no source checkout, private path, or credential dependency',
  );
  for (const [, specifier] of verifierSource.matchAll(/from '([^']+)'/gu)) {
    if (!specifier.startsWith('planr-pipeline/')) continue;
    assert.notEqual(
      metadata.exports[`./${specifier.slice('planr-pipeline/'.length)}`],
      undefined,
      `${specifier}: declared package export`,
    );
  }
  const runnerPath = join(consumer, 'verify-phase6.mjs');
  writeFileSync(
    runnerPath,
    [
      "import { verifyOperateV2GovernedExecution } from './node_modules/planr-pipeline/conformance/verify-operate-v2-governed-execution.mjs';",
      'process.stdout.write(JSON.stringify(await verifyOperateV2GovernedExecution()));',
    ].join('\n'),
  );
  const conformance = run(process.execPath, [runnerPath], {
    cwd: consumer,
    env: { PATH: process.env.PATH },
  });
  const report = JSON.parse(conformance.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.contracts, OPERATE_RUNTIME_CONTRACT_KINDS.length);
  assert.equal(report.networkAttempts, 0);
  assert.equal(report.credentialReads, 0);
  assert.equal(report.externalEffects, 0);
  assert.equal(report.realEffects, 0);
  assert.equal(checkOperateRuntimePurity(installedPackage).ok, true);
});
