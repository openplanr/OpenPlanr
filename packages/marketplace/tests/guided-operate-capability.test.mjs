import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  normalizeOperatingAdapter,
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
    ['claude-code', 'native', 'native-isolated'],
    ['codex', 'native', 'native-bounded'],
    ['cursor', 'chat', 'structured-provider'],
  ].map(([runtime, interactiveQuestions, operatingAdvisorDispatch]) => ({
    runtime,
    interactiveQuestions,
    operatingAdvisorDispatch,
  }));
}

test('guided release ledger verifies the CLI forward fix against fresh canary evidence', async () => {
  const operation = await readJson('../examples/guided-operate-operation.json');
  assert.deepEqual(validateOperation(operation), []);
  assert.equal(operation.operationDigest, calculateOperationDigest(operation));
  assert.equal(operation.umbrellaSpecId, 'SPEC-003');
  assert.equal(operation.state, 'verified');
  assert.equal(operation.ledger.pullRequest.number, 82);
  assert.equal(operation.ledger.pullRequest.state, 'merged');
  assert.equal(isVerifiedOperation(operation), true);
  assert.deepEqual(
    operation.participants.map(({ targetVersion }) => targetVersion),
    ['0.31.0', '1.15.1', '1.17.2', '1.2.0'],
  );
  assert.deepEqual(
    operation.participants.map(({ commitSha }) => commitSha),
    [
      'a3df691ba5000828cee2580252b2d1e2ba5ed6eb',
      '2c3e774a279088304b5db5d3d633480a0b7cbad5',
      '714d5f6aa587f00f2d09ba148f31d85da4d84405',
      '7b1c88daa16f8adb66db2f388555a3bdba67df2f',
    ],
  );
});

test('guided capability opens only after versions, interaction metadata, and release reconcile', () => {
  const input = {
    protocolVersion: '1.2.0',
    pipelineVersion: '0.31.0',
    cliVersion: '1.15.1',
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
  assert.deepEqual(available.advisorDispatch, {
    'claude-code': 'native-isolated',
    codex: 'native-bounded',
    cursor: 'structured-provider',
  });

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

  const missingDispatch = resolveGuidedOperatingBoard({
    ...input,
    adapters: adapters().map((adapter) => (
      adapter.runtime === 'codex'
        ? { ...adapter, operatingAdvisorDispatch: undefined }
        : adapter
    )),
    releaseVerified: true,
  });
  assert.deepEqual(missingDispatch.missing, ['adapters']);
});

test('adapter normalization fails closed when native dispatch is undeclared', () => {
  const normalized = normalizeOperatingAdapter(
    {
      id: 'codex',
      version: '1.0.0',
      capabilityLevel: 'workflow',
      capabilities: {
        operatingBoard: true,
        interactiveQuestions: 'native',
      },
      entrypoints: { operate: '$planr-operate' },
    },
    '0.32.0',
  );
  assert.equal(normalized.operatingAdvisorDispatch, null);
  assert.equal(
    resolveGuidedOperatingBoard({
      protocolVersion: '1.2.0',
      pipelineVersion: '0.32.0',
      cliVersion: '1.16.0',
      skillsVersion: '1.18.0',
      marketplaceVersion: '1.3.0',
      adapters: [
        normalized,
        ...adapters().filter(({ runtime }) => runtime !== 'codex'),
      ],
      guidedContractsPresent: true,
      evidenceDiagnosticsPresent: true,
      releaseVerified: true,
    }).status,
    'unavailable',
  );
});

test('verified compatibility promotes the default native cycle after reconciliation', async () => {
  const ecosystem = await readJson('../ecosystem.json');
  const guided = ecosystem.capabilities.guidedOperatingBoard;
  assert.equal(ecosystem.capabilities.operatingBoard.status, 'available');
  assert.equal(guided.status, 'available');
  assert.deepEqual(guided.missing, []);
  assert.equal(guided.releaseOperation.operationId, 'OPERATE-SPEC-003-R3');
  assert.equal(guided.releaseOperation.state, 'verified');
  assert.equal(guided.releaseOperation.reconciliation, 'matched');
  assert.deepEqual(guided.components, {
    pipeline: '0.32.1',
    cli: '1.16.1',
    skills: '1.18.1',
    marketplace: '1.3.1',
  });
  assert.deepEqual(ecosystem.components, {
    cli: { version: '1.17.0', pipelineRange: '^0.33.1' },
    pipeline: { version: '0.33.1', cliRange: '^1.17.0' },
    skills: { version: '1.19.0', cliRange: '^1.17.0' },
    marketplace: { version: '1.4.0' },
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
  assert.equal(
    schema.properties.operationId.pattern,
    '^OPERATE-SPEC-[0-9]{3,}(?:-R[1-9][0-9]*)?$',
  );
});

test('a revisioned release transaction preserves its umbrella specification identity', async () => {
  const operation = await readJson('../examples/guided-operate-operation.json');
  operation.operationId = 'OPERATE-SPEC-003-R2';
  for (const participant of operation.participants) {
    participant.repoLocalSpecId = `OPERATE-SPEC-003-R2:${participant.component}`;
  }
  operation.operationDigest = calculateOperationDigest(operation);
  for (const participant of operation.participants) {
    for (const approval of participant.approvals) {
      approval.digest = operation.operationDigest;
    }
  }
  assert.deepEqual(validateOperation(operation), []);
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
