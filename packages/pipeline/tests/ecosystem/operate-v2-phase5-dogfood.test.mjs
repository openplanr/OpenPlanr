import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { packOperateV2DevelopmentSnapshot } from '../../scripts/check-operate-runtime-purity.mjs';
import { OPERATE_RUNTIME_CONTRACT_KINDS } from '../../lib/protocol/loader.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-operate-v2-phase5-dogfood-'));
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

test('a clean public consumer completes deterministic synthetic business and software operating cycles', {
  timeout: 120_000,
}, () => {
  const packed = packOperateV2DevelopmentSnapshot(join(temporaryRoot, 'package'), {
    sourceRoot: root,
  });
  const consumer = join(temporaryRoot, 'consumer');
  const installedPackage = join(consumer, 'node_modules', 'planr-pipeline');
  mkdirSync(installedPackage, { recursive: true });
  const extracted = spawnSync(
    'tar',
    ['-xzf', packed.tarballPath, '-C', installedPackage, '--strip-components=1'],
    { encoding: 'utf8' },
  );
  assert.equal(extracted.status, 0, extracted.stderr);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ type: 'module' }));
  const result = spawnSync(
    process.execPath,
    [join(installedPackage, 'conformance', 'verify-operate-v2-operating-intelligence.mjs')],
    { cwd: consumer, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.contracts, OPERATE_RUNTIME_CONTRACT_KINDS.length);
  assert.deepEqual(report.domains, ['business', 'software']);
  assert.deepEqual(report.stageNames, PHASE_5_STAGES);
  assert.equal(report.journeys.length, 2);
  for (const journey of report.journeys) {
    assert.deepEqual(
      journey.stageOrder,
      PHASE_5_STAGES,
      `${journey.domainId}: complete public loop order`,
    );
    assert.deepEqual(
      Object.keys(journey.stages),
      PHASE_5_STAGES,
      `${journey.domainId}: named checkpoints only`,
    );
    for (const name of PHASE_5_STAGES) {
      assert.equal(journey.stages[name].passed, true, `${journey.domainId}/${name}`);
    }
    assert.equal(
      journey.finalEventSequence,
      journey.domainId === 'business' ? 124 : 68,
      `${journey.domainId}: exact durable history excludes non-durable provider candidates`,
    );
    assert.match(journey.finalEventHash, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(journey.modelDispatchCount, 0);
  }
  assert.match(
    report.stop,
    /No policy, capability grant, approval, executor, connector, operating provider\/model dispatch, external effect, release, or remote action/u,
  );
  assert.doesNotMatch(
    JSON.stringify(report),
    /contentBase64|rawBytes|resolverPayload|credential|operationId|executionAssignmentIds|externalEffect/iu,
  );
});
