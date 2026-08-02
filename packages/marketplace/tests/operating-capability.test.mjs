import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { atLeast, resolveOperatingBoard } from '../scripts/operating-capability.mjs';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('operating capability is advertised only after every release gate resolves', async () => {
  const ecosystem = await readJson('../ecosystem.json');
  const capability = ecosystem.capabilities.operatingBoard;

  assert.equal(ecosystem.schemaVersion, '1.1.0');
  assert.equal(capability.command, 'planr operate');
  assert.equal(capability.protocolRange, '^1.2.0');
  assert.ok(['available', 'unavailable'].includes(capability.status));

  if (capability.status === 'available') {
    assert.deepEqual(capability.missing, []);
    assert.ok(atLeast(ecosystem.protocol.current, '1.2.0'));
    assert.ok(atLeast(ecosystem.components.pipeline.version, '0.30.0'));
    assert.ok(atLeast(ecosystem.components.cli.version, '1.14.0'));
    assert.ok(atLeast(ecosystem.components.skills.version, '1.16.0'));
    assert.deepEqual(capability.certifiedRuntimes.sort(), ['claude-code', 'codex', 'cursor']);
    assert.ok(ecosystem.adapters.every((adapter) => adapter.operatingBoard.available));
  } else {
    assert.ok(capability.missing.length > 0);
    assert.deepEqual(capability.certifiedRuntimes, []);
    assert.ok(ecosystem.adapters.every((adapter) => adapter.operatingBoard.declared));
    assert.ok(ecosystem.adapters.every((adapter) => !adapter.operatingBoard.available));
    assert.equal(capability.releaseOperation.operationId, 'OPERATE-SPEC-002');
    if (capability.releaseOperation.state !== 'verified') {
      assert.ok(capability.missing.includes('release'));
    }
  }
});

test('manifest records the non-atomic coordinated release saga', async () => {
  const ecosystem = await readJson('../ecosystem.json');
  assert.deepEqual(ecosystem.releaseTransaction.participantOrder, [
    'pipeline',
    'cli',
    'skills',
    'marketplace',
  ]);
  assert.equal(ecosystem.releaseTransaction.model, 'coordinated-saga');
  assert.equal(ecosystem.releaseTransaction.atomicity, 'participant-local');
  assert.equal(ecosystem.releaseTransaction.ledger.kind, 'marketplace-draft-pr');
  assert.deepEqual(ecosystem.releaseTransaction.closeout.sequence, [
    'merge-unavailable-ledger',
    'tag-and-verify-marketplace',
    'record-finalization-and-expose',
  ]);
  assert.equal(
    ecosystem.releaseTransaction.closeout.availabilityGate,
    'verified-operation-after-ledger-merge-and-marketplace-tag',
  );
  assert.equal(ecosystem.releaseTransaction.publishedCompensation, 'forward-fix');
});

test('resolver opens the gate only for the complete certified release set', () => {
  const adapters = ['claude-code', 'codex', 'cursor'].map((runtime) => ({
    runtime,
    operatingBoard: { declared: true, available: false, entrypoint: 'planr operate' },
  }));
  const available = resolveOperatingBoard({
    protocolVersion: '1.2.0',
    pipelineVersion: '0.30.0',
    cliVersion: '1.14.0',
    skillsVersion: '1.16.0',
    marketplaceVersion: '1.1.0',
    operatingRolesPresent: true,
    cliCommandPresent: true,
    operateSkillPresent: true,
    adapters,
    releaseVerified: true,
  });
  assert.equal(available.status, 'available');
  assert.deepEqual(available.missing, []);

  const unavailable = resolveOperatingBoard({
    protocolVersion: '1.2.0',
    pipelineVersion: '0.29.9',
    cliVersion: '1.14.0',
    skillsVersion: '1.16.0',
    marketplaceVersion: '1.1.0',
    operatingRolesPresent: true,
    cliCommandPresent: true,
    operateSkillPresent: true,
    adapters,
    releaseVerified: true,
  });
  assert.equal(unavailable.status, 'unavailable');
  assert.deepEqual(unavailable.missing, ['pipeline']);
});

test('package version bumps alone cannot unlock an unreconciled release', () => {
  const adapters = ['claude-code', 'codex', 'cursor'].map((runtime) => ({
    runtime,
    operatingBoard: { declared: true, available: false, entrypoint: 'planr operate' },
  }));
  const result = resolveOperatingBoard({
    protocolVersion: '1.2.0',
    pipelineVersion: '0.30.0',
    cliVersion: '1.14.0',
    skillsVersion: '1.16.0',
    marketplaceVersion: '1.1.0',
    operatingRolesPresent: true,
    cliCommandPresent: true,
    operateSkillPresent: true,
    adapters,
    releaseVerified: false,
  });
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.missing, ['release']);
});

test('prerelease and malformed versions cannot satisfy stable release gates', () => {
  assert.equal(atLeast('0.30.0-alpha.1', '0.30.0'), false);
  assert.equal(atLeast('0.30.0', '0.30.0-alpha.1'), true);
  assert.equal(atLeast('1.14.1', '1.14.0'), true);
  assert.equal(atLeast('next', '1.14.0'), false);
});
