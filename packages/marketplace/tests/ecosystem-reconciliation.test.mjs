import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { reconcileOperation } from '../scripts/reconcile-operation.mjs';
import {
  isVerifiedOperation,
  validateOperation,
} from '../scripts/validate-operation.mjs';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const sha = (character) => character.repeat(40);
const digest = (character) => `sha256:${character.repeat(64)}`;

async function verifiedFixture() {
  const operation = await readJson('../examples/ecosystem-operation.json');
  operation.state = 'verified';
  operation.prepareDigest = digest('a');
  operation.confirmationDigest = digest('b');
  operation.ledger.pullRequest = {
    number: 100,
    url: 'https://github.com/openplanr/marketplace/pull/100',
    state: 'merged',
  };
  operation.reconciliation.status = 'matched';
  operation.reconciliation.checkedAt = '2026-07-28T13:00:00.000Z';
  operation.nextSafeAction = 'Archive the verified operation ledger.';
  operation.history.push(
    {
      eventId: '84bf61f4-3510-4944-83aa-1613b53d4524',
      timestamp: '2026-07-28T13:00:00.000Z',
      type: 'reconciliation.recorded',
      actor: 'maintainer',
      participant: 'marketplace',
      digest: digest('c'),
      note: 'Authoritative release and candidate manifest state matched.',
    },
    {
      eventId: 'a27ec66e-2394-4846-b181-ad645578e642',
      timestamp: '2026-07-28T13:01:00.000Z',
      type: 'operation.verified',
      actor: 'maintainer',
      participant: 'marketplace',
      digest: digest('d'),
      note: 'Follow-up marketplace finalization recorded.',
    },
  );
  for (const [index, evidence] of operation.releaseEvidence.entries()) {
    evidence.status = 'passed';
    evidence.url = `https://github.com/openplanr/marketplace/actions/runs/500#${evidence.id}`;
    evidence.digest = digest(String(index + 5));
    evidence.checkedAt = '2026-07-28T13:00:00.000Z';
  }

  for (const [index, participant] of operation.participants.entries()) {
    participant.phase = 'verified';
    participant.branch = `release/${participant.component}`;
    participant.commitSha = sha(String(index + 1));
    participant.pullRequest = {
      number: 200 + index,
      url: `https://github.com/${participant.repository}/pull/${200 + index}`,
      state: 'merged',
    };
    participant.tag = `v${participant.targetVersion}`;
    participant.tarballDigest = digest(String(index + 1));
    participant.checks = [
      {
        name: 'test',
        status: 'passed',
        url: `https://github.com/${participant.repository}/actions/runs/${300 + index}`,
      },
    ];
    participant.approvals.push({
      gate: 'release',
      actor: 'maintainer',
      status: 'approved',
      timestamp: '2026-07-28T13:00:00.000Z',
      digest: operation.operationDigest,
    });
    participant.compensation =
      participant.component === 'marketplace' ? 'withhold-manifest' : 'forward-fix';
    if (participant.package) {
      participant.package.status = 'verified';
      participant.package.integrity = `sha512-${index + 1}`;
    }
  }
  return operation;
}

function liveStateFor(operation) {
  return {
    checkedAt: '2026-07-28T13:00:00.000Z',
    participants: operation.participants.map((participant) => ({
      component: participant.component,
      repository: participant.repository,
      targetBranch: participant.targetBranch,
      commitSha: participant.commitSha,
      pullRequest: {
        ...participant.pullRequest,
        baseBranch: participant.targetBranch,
        headSha: participant.commitSha,
      },
      tag: {
        name: participant.tag,
        commitSha: participant.commitSha,
      },
      tarballDigest: participant.tarballDigest,
      checks: participant.checks,
      package: participant.package
        ? {
            ...participant.package,
            tarballDigest: participant.tarballDigest,
          }
        : null,
    })),
    manifest: {
      components: Object.fromEntries(
        operation.participants.map(({ component, targetVersion }) => [component, targetVersion]),
      ),
      operatingBoardStatus: 'available',
    },
    releaseEvidence: structuredClone(operation.releaseEvidence),
  };
}

test('reconcile compares authoritative PR, commit, tag, CI, npm, and manifest state', async () => {
  const operation = await verifiedFixture();
  assert.deepEqual(validateOperation(operation), []);
  assert.equal(isVerifiedOperation(operation), true);
  const liveState = liveStateFor(operation);
  const result = reconcileOperation(operation, liveState);
  assert.equal(result.status, 'matched');
  assert.deepEqual(result.drift, []);
  assert.deepEqual(result.incomplete, []);

  liveState.participants[0].tag.name = 'v0.30.1';
  const drift = reconcileOperation(operation, liveState);
  assert.equal(drift.status, 'drift');
  assert.match(drift.nextSafeAction, /Stop promotion/);
  assert.ok(drift.drift.some((message) => message.includes('pipeline.tag.name')));
});

test('merged ledger and marketplace tag remain unavailable before finalization', async () => {
  const operation = await verifiedFixture();
  operation.state = 'completed';
  operation.reconciliation.status = 'pending';
  operation.reconciliation.checkedAt = null;
  operation.history = operation.history.filter(
    ({ type }) => !['reconciliation.recorded', 'operation.verified'].includes(type),
  );

  assert.equal(operation.ledger.pullRequest.state, 'merged');
  assert.equal(operation.participants.at(-1).phase, 'verified');
  assert.ok(operation.participants.at(-1).tag);
  assert.equal(isVerifiedOperation(operation), false);
});

test('draft ledger cannot substitute for an authoritative live-state snapshot', async () => {
  const operation = await readJson('../examples/ecosystem-operation.json');
  assert.throws(
    () => reconcileOperation(operation, null),
    /draft ledger is audit-only/,
  );
});

test('verified reconciliation requires authoritative canary evidence', async () => {
  const operation = await verifiedFixture();
  const liveState = liveStateFor(operation);
  liveState.releaseEvidence = liveState.releaseEvidence.slice(0, -1);
  const result = reconcileOperation(operation, liveState);
  assert.equal(result.status, 'drift');
  assert.ok(
    result.drift.some((message) =>
      message.includes('releaseEvidence must be ordered as'),
    ),
  );
  assert.ok(
    result.incomplete.some((message) =>
      message.includes('outcome-reconciliation'),
    ),
  );
});

test('a published package disables compensating rollback', async () => {
  const operation = await verifiedFixture();
  operation.participants[2].compensation = 'revert-pr';
  assert.ok(
    validateOperation(operation).includes(
      'published packages forbid compensating rollback; use forward-fix',
    ),
  );
});
