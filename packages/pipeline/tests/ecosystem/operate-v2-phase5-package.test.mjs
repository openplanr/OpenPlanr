import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkOperateRuntimePurity,
  packOperateV2DevelopmentSnapshot,
} from '../../scripts/check-operate-runtime-purity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-operate-v2-phase5-package-'));
const PHASE_5_STAGES = [
  'accepted-snapshot-state',
  'snapshot-provider-candidate-produced',
  'public-domain-projection',
  'delta-trigger-scenario',
  'minimum-plan-scheduler-topology',
  'advisor-submission-proof',
  'challenger-submission-proof',
  'chair-submission-proof',
  'decision-ledger-action-hypothesis',
  'durable-action-verification-plan',
  'metric-provider-candidate-produced',
  'metric-observation-accepted',
  'outcome-learning-atomic',
  'verification-provider-candidate-produced',
  'later-snapshot-delta-revisit',
];

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

test('Phase 5 packs every declared public operating-loop surface without a private or execution boundary', {
  timeout: 120_000,
}, () => {
  const packed = packOperateV2DevelopmentSnapshot(join(temporaryRoot, 'package'), {
    sourceRoot: root,
  });
  assert.equal(packed.ok, true);
  assert.match(packed.sha256, /^[a-f0-9]{64}$/);
  assert.equal(packed.sourcePurity.ok, true);
  assert.equal(packed.tarballPurity.ok, true);

  const packedFiles = new Set(packed.files.map(({ path }) => path));
  for (const required of [
    'conformance/verify-operate-v2-operating-intelligence.mjs',
    'lib/operate/assignment-contract-v2.mjs',
    'lib/operate/intelligence-input-bundle-v2.mjs',
    'lib/operate/intelligence-output-identities-v2.mjs',
    'lib/operate/intelligence-result-validator-v2.mjs',
    'lib/operate/intelligence-replay-v2.mjs',
    'lib/operate/result-packet-v2.mjs',
    'lib/operate/result-packet-v2.d.mts',
    'lib/operate/runtime-event-reducer-v2.mjs',
    'lib/operate/operating-state-v2.mjs',
    'lib/operate/operating-state-v2.d.mts',
    'lib/operate/operating-snapshots-v2.mjs',
    'lib/operate/operating-snapshots-v2.d.mts',
    'lib/operate/operating-delta-v2.mjs',
    'lib/operate/operating-delta-v2.d.mts',
    'lib/operate/intelligence-router-v2.mjs',
    'lib/operate/intelligence-router-v2.d.mts',
    'lib/operate/operating-intelligence-state-v2.mjs',
    'lib/operate/operating-intelligence-state-v2.d.mts',
    'lib/operate/action-verification-v2.mjs',
    'lib/operate/action-verification-v2.d.mts',
    'lib/operate/authorization-v2.mjs',
    'lib/operate/authorization-v2.d.mts',
    'lib/operate/policy-v2.mjs',
    'lib/operate/policy-v2.d.mts',
    'lib/operate/approvals-v2.mjs',
    'lib/operate/approvals-v2.d.mts',
    'lib/operate/operating-triggers-v2.mjs',
    'lib/operate/operating-triggers-v2.d.mts',
    'lib/operate/operating-domains-v2.mjs',
    'lib/operate/operating-domains-v2.d.mts',
    'lib/operate/operating-signal-providers-v2.mjs',
    'lib/operate/operating-signal-providers-v2.d.mts',
    'conformance/fixtures/operating-runtime-v2/business-domain-valid.json',
    'conformance/fixtures/operating-runtime-v2/software-domain-valid.json',
    'conformance/fixtures/operating-runtime-v2/operating-intelligence-contracts-valid.json',
    'conformance/fixtures/operating-runtime-v2/action-verification-valid.json',
    'conformance/fixtures/operating-runtime-v2/operating-trigger-scenario-valid.json',
  ])
    assert.equal(packedFiles.has(required), true, `missing Phase 5 package asset ${required}`);
  for (const path of packedFiles) {
    assert.doesNotMatch(path, /^(?:\.planr\/|tests\/|node_modules\/|\.env(?:\.|\/|$))/);
    assert.doesNotMatch(path, /(?:compatibility-v1_4|records-migration|operating-provider-kit)/iu);
    // Operate retirement does not remove other domains' supported schema readers.
    if (/^(?:lib\/operate\/|conformance\/fixtures\/operating-runtime-v2\/)/u.test(path)) {
      assert.doesNotMatch(path, /legacy/iu);
    }
  }

  const consumer = join(temporaryRoot, 'consumer');
  const installedPackage = join(consumer, 'node_modules', 'planr-pipeline');
  mkdirSync(installedPackage, { recursive: true });
  run('tar', ['-xzf', packed.tarballPath, '-C', installedPackage, '--strip-components=1']);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ type: 'module' }));
  const metadata = JSON.parse(readFileSync(join(installedPackage, 'package.json'), 'utf8'));
  for (const name of [
    'runtime-v2',
    'scheduler-v2',
    'extensions-v2',
    'evidence-v2',
    'result-packet-v2',
    'intelligence-router-v2',
    'authorization-v2',
    'policy-v2',
    'approvals-v2',
    'operating-domains-v2',
    'operating-signal-providers-v2',
  ]) {
    const entry = metadata.exports[`./operate/${name}`];
    assert.equal(typeof entry?.import, 'string', `${name}: declared runtime export`);
    assert.equal(typeof entry?.types, 'string', `${name}: declared type export`);
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
    './operate/intelligence-ledger-v2',
    './operate/executor-v2',
    './operate/capability-v2',
  ]) {
    assert.equal(
      metadata.exports[forbidden],
      undefined,
      `${forbidden}: no executor or effect package surface`,
    );
  }
  assert.equal(checkOperateRuntimePurity(installedPackage).ok, true);

  const verifierPath = join(
    installedPackage,
    'conformance',
    'verify-operate-v2-operating-intelligence.mjs',
  );
  const verifierSource = readFileSync(verifierPath, 'utf8');
  assert.doesNotMatch(
    verifierSource,
    /(?:\.\.\/lib\/|file:|\/Users\/|\.planr\/operate-v2\/)/u,
    'the package verifier has no source-checkout or private import path',
  );
  for (const [, specifier] of verifierSource.matchAll(/from '([^']+)'/gu)) {
    if (!specifier.startsWith('planr-pipeline/')) continue;
    const exportName = `./${specifier.slice('planr-pipeline/'.length)}`;
    assert.notEqual(
      metadata.exports[exportName],
      undefined,
      `${specifier}: declared public package export`,
    );
  }
  const journey = run(process.execPath, [verifierPath], { cwd: consumer });
  const report = JSON.parse(journey.stdout);
  assert.deepEqual(report.stageNames, PHASE_5_STAGES);
  assert.deepEqual(report.domains, ['business', 'software']);
  assert.equal(report.journeys.length, 2);
  for (const result of report.journeys) {
    assert.deepEqual(result.stageOrder, PHASE_5_STAGES, `${result.domainId}: complete stage order`);
    assert.deepEqual(
      Object.keys(result.stages),
      PHASE_5_STAGES,
      `${result.domainId}: every stage is reported`,
    );
    for (const name of PHASE_5_STAGES) {
      assert.equal(result.stages[name].passed, true, `${result.domainId}/${name}`);
    }
    assert.equal(
      result.finalEventSequence,
      result.domainId === 'business' ? 124 : 68,
      `${result.domainId}: exact durable Event journey without synthetic provider acceptance`,
    );
    assert.equal(result.modelDispatchCount, 0, `${result.domainId}: no model dispatch`);
  }
});
