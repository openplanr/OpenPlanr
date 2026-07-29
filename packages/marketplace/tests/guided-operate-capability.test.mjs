import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  resolveGuidedOperatingBoard,
} from '../scripts/operating-capability.mjs';
import {
  calculateOperationDigest,
  isVerifiedOperation,
  validateOperation,
} from '../scripts/validate-operation.mjs';
import { reconcileOperation } from '../scripts/reconcile-operation.mjs';

const readJson = async (path) =>
  JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

function adapters() {
  return [
    ['claude-code', 'native'],
    ['codex', 'native'],
    ['cursor', 'chat'],
  ].map(([runtime, interactiveQuestions]) => ({
    runtime,
    interactiveQuestions,
  }));
}

test('guided release ledger records the verified cross-repository transaction', async () => {
  const operation = await readJson('../examples/guided-operate-operation.json');
  assert.deepEqual(validateOperation(operation), []);
  assert.equal(operation.operationDigest, calculateOperationDigest(operation));
  assert.equal(operation.umbrellaSpecId, 'SPEC-003');
  assert.equal(operation.state, 'verified');
  assert.equal(operation.ledger.pullRequest.number, 76);
  assert.equal(operation.ledger.pullRequest.state, 'merged');
  assert.equal(isVerifiedOperation(operation), true);
  assert.deepEqual(
    operation.participants.map(({ targetVersion }) => targetVersion),
    ['0.31.0', '1.15.0', '1.17.2', '1.2.0'],
  );
  assert.deepEqual(
    operation.participants.map(({ commitSha }) => commitSha),
    [
      'a3df691ba5000828cee2580252b2d1e2ba5ed6eb',
      '37ec90c946c52a7b9e4488e78bbf5b85aef195d7',
      '714d5f6aa587f00f2d09ba148f31d85da4d84405',
      '7b1c88daa16f8adb66db2f388555a3bdba67df2f',
    ],
  );
});

test('guided capability opens only after versions, interaction metadata, and release reconcile', () => {
  const input = {
    protocolVersion: '1.2.0',
    pipelineVersion: '0.31.0',
    cliVersion: '1.15.0',
    skillsVersion: '1.17.2',
    marketplaceVersion: '1.2.0',
    adapters: adapters(),
    guidedContractsPresent: true,
    evidenceDiagnosticsPresent: true,
    releaseVerified: false,
  };
  const withheld = resolveGuidedOperatingBoard(input);
  assert.equal(withheld.status, 'unavailable');
  assert.deepEqual(withheld.missing, ['release']);

  const available = resolveGuidedOperatingBoard({
    ...input,
    releaseVerified: true,
  });
  assert.equal(available.status, 'available');
  assert.deepEqual(
    available.certifiedRuntimes.sort(),
    ['claude-code', 'codex', 'cursor'],
  );

  const missingCapability = resolveGuidedOperatingBoard({
    ...input,
    adapters: adapters().map((adapter) => (
      adapter.runtime === 'cursor'
        ? { ...adapter, interactiveQuestions: 'none' }
        : adapter
    )),
    releaseVerified: true,
  });
  assert.deepEqual(missingCapability.missing, ['adapters']);
});

test('published compatibility exposes the verified guided release set', async () => {
  const ecosystem = await readJson('../ecosystem.json');
  const guided = ecosystem.capabilities.guidedOperatingBoard;
  assert.equal(ecosystem.capabilities.operatingBoard.status, 'available');
  assert.equal(guided.status, 'available');
  assert.equal(guided.releaseOperation.operationId, 'OPERATE-SPEC-003');
  assert.equal(guided.releaseOperation.state, 'verified');
  assert.deepEqual(guided.components, {
    pipeline: '0.31.0',
    cli: '1.15.0',
    skills: '1.17.2',
    marketplace: '1.2.0',
  });
  assert.deepEqual(ecosystem.components, {
    cli: { version: '1.15.0', pipelineRange: '^0.31.0' },
    pipeline: { version: '0.31.0', cliRange: '^1.15.0' },
    skills: { version: '1.17.2', cliRange: '^1.15.0' },
    marketplace: { version: '1.2.0' },
  });
});

test('operation schema supports audited lifecycle and forward-fix state', async () => {
  const schema = await readJson('../schemas/ecosystem-operation.schema.json');
  for (const state of [
    'drafted',
    'preparing',
    'prepared',
    'promoting',
    'verified',
    'blocked',
    'compensating',
    'forward-fix',
  ]) {
    assert.ok(schema.properties.state.enum.includes(state));
  }
  assert.equal(schema.properties.umbrellaSpecId.pattern, '^SPEC-[0-9]{3,}$');
});

test('guided reconciliation checks the guided capability, not the legacy board gate', async () => {
  const operation = await readJson('../examples/guided-operate-operation.json');
  operation.state = 'verified';
  const liveState = {
    checkedAt: '2026-07-29T21:00:00.000Z',
    participants: operation.participants.map((participant) => ({
      component: participant.component,
      repository: participant.repository,
      targetBranch: participant.targetBranch,
      commitSha: participant.commitSha,
      checks: participant.checks,
      package: participant.package,
      pullRequest: participant.pullRequest,
      tag: participant.tag ? { name: participant.tag, commitSha: participant.commitSha } : null,
      tarballDigest: participant.tarballDigest,
    })),
    manifest: {
      components: Object.fromEntries(
        operation.participants.map(({ component, targetVersion }) => [
          component,
          targetVersion,
        ]),
      ),
      operatingBoardStatus: 'available',
      capabilities: {
        guidedOperatingBoard: { status: 'unavailable' },
      },
    },
    releaseEvidence: operation.releaseEvidence,
  };
  const result = reconcileOperation(operation, liveState);
  assert.ok(
    result.drift.some((entry) =>
      entry.includes('manifest.capabilities.guidedOperatingBoard.status')),
  );
});

test('marketplace test discovery is portable across POSIX shells and PowerShell', async () => {
  const packageJson = await readJson('../package.json');
  assert.equal(packageJson.scripts.test, 'node --test');
  assert.doesNotMatch(packageJson.scripts.test, /[*?[\]{}]/);
});
