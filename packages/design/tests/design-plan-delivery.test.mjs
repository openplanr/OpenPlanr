import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { designImplementationHandoffDigest } from '@openplanr/protocol/design-handoff-contracts';
import { prepareDesignPlanHandoff } from '../lib/design/design-plan-handoff.mjs';
import { projectDesignDeliveryStatus } from '../lib/design/delivery-status.mjs';

const fixed = (value) => `sha256:${value.repeat(64)}`;
function handoff() {
  const value = {
    kind: 'openplanr-design-implementation-handoff', schemaVersion: '1.0.0', id: 'orders', version: 1,
    status: 'approved', authority: 'prepare-plan', title: 'Orders',
    basis: { designId: 'orders', sourceRevision: fixed('a'), selectedVariant: 'standard', readiness: { status: 'ready', digest: fixed('b') }, reviewHandoff: { version: 1, contentDigest: fixed('c') } },
    sources: [{ id: 'screen', kind: 'screen', path: 'design/orders.json', digest: fixed('d') }],
    requirements: [{ id: 'REQ-001', kind: 'behavior', statement: 'Confirm order.', sourceRefs: ['screen'], verification: ['Confirmation is visible.'] }],
    contentDigest: fixed('0'), markdown: '# Orders\n',
  };
  value.contentDigest = designImplementationHandoffDigest(value);
  value.approval = { actorId: 'owner', approvedAt: '2026-09-21T12:00:00.000Z', contentDigest: value.contentDigest, authority: 'prepare-plan' };
  return value;
}

function lineage(value) {
  return { kind: 'openplanr-design-planning-lineage', schemaVersion: '1.0.0', handoff: { id: value.id, version: value.version, contentDigest: value.contentDigest }, specId: 'SPEC-014', mappings: [{ requirementId: 'REQ-001', acceptanceRefs: [{ storyId: 'US-045', acceptanceId: 'AC-013' }], taskIds: ['T-046'] }] };
}

test('Continue to Plan returns host-native forms and causes no filesystem effect', () => {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-plan-handoff-'));
  try {
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, 'sentinel'), 'unchanged\n');
    const before = createHash('sha256').update(readFileSync(join(root, 'sentinel'))).digest('hex');
    const result = prepareDesignPlanHandoff(handoff(), { subject: 'SPEC-014' });
    assert.equal(result.invocations.claudeCode, '/planr:plan SPEC-014');
    assert.equal(result.invocations.codex, '$planr:plan SPEC-014');
    assert.deepEqual(result.effects, { planningFilesWritten: false, agentDispatched: false, shipStarted: false, gitChanged: false });
    assert.equal(createHash('sha256').update(readFileSync(join(root, 'sentinel'))).digest('hex'), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('delivery projection advances from approved to verified without mutating the package', () => {
  const value = handoff();
  const before = JSON.stringify(value);
  const current = { id: value.id, version: value.version, contentDigest: value.contentDigest, status: 'approved' };
  assert.equal(projectDesignDeliveryStatus({ handoff: value, currentHandoff: current }).phase, 'approved');
  assert.equal(projectDesignDeliveryStatus({ handoff: value, currentHandoff: current, lineage: lineage(value), tasks: [{ id: 'T-046', status: 'outstanding' }] }).phase, 'planned');
  assert.equal(projectDesignDeliveryStatus({ handoff: value, currentHandoff: current, lineage: lineage(value), tasks: [{ id: 'T-046', status: 'in_progress' }], shipClosure: { runId: 'ship_1', state: 'implementing' } }).phase, 'implementing');
  const verified = projectDesignDeliveryStatus({ handoff: value, currentHandoff: current, lineage: lineage(value), tasks: [{ id: 'T-046', status: 'done' }], shipClosure: { runId: 'ship_1', state: 'passed' } });
  assert.equal(verified.phase, 'verified');
  assert.equal(verified.stale, false);
  assert.equal(JSON.stringify(value), before);
  assert.equal(projectDesignDeliveryStatus({ handoff: value, currentHandoff: { ...current, version: 2 }, lineage: lineage(value) }).stale, true);
});
