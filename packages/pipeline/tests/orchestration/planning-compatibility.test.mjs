import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildPlanContext } from '../../lib/pipeline/ship-context.mjs';
import { materializeLegacyPlanningFixture } from '../helpers/legacy-planning-fixture.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = materializeLegacyPlanningFixture();
after(() => rmSync(fixture, { recursive: true, force: true }));
const plan = () => buildPlanContext({ projectRoot: fixture, feature: 'legacy-plan' });
const barePlan = () => buildPlanContext({ projectRoot: fixture, feature: 'bare-plan' });

test('a plan authored under the removed bookkeeping fields still loads', () => {
  // T-001 carries contentHash, correctionBudget, reviewerIds and proofPacket. None of
  // them is required any more, and none of them may prevent the plan being read.
  const envelope = plan();
  assert.match(envelope.objective.summary, /Legacy Plan/u);
  assert.ok(envelope.acceptanceCriteria.length >= 1);
  assert.ok(envelope.startingPoints.some((entry) => /T-001/u.test(entry)));
});

test('none of the obsolete fields reaches the working context', () => {
  const serialized = JSON.stringify(plan());
  for (const obsolete of [
    'contentHash',
    'correctionBudget',
    'reviewerIds',
    'proofPacket',
    'deadbeef',
  ]) {
    assert.ok(!serialized.includes(obsolete), `${obsolete} must not survive into the context`);
  }
});

test('structured and body-only Preserve plus absent dependsOn read cleanly', () => {
  const envelope = plan();
  // T-002 declares dependsOn and legacy body Preserve; T-001 declares structured
  // Preserve and no dependsOn.
  assert.deepEqual(
    envelope.dependencies,
    [
      { task: 'T-002', requires: ['T-001'] },
      { task: 'T-003', requires: ['T-001', 'T-002'] },
    ],
    'only the tasks that declare a dependency carry a row',
  );
  assert.deepEqual(envelope.boundaries.doNotChange, [
    'project: .planr/operate',
    'project: config/legacy-preserve.json',
    'openplanr: src/services',
  ]);
});

test('a spec without FR headings or acceptance criteria still yields usable context', () => {
  // A plan authored before the professional specification shape existed has neither
  // section; the reader must fall back rather than refuse to build a context.
  const envelope = barePlan();
  assert.equal(envelope.requirements.length, 1);
  assert.match(envelope.requirements[0], /Implement the requested scope for Bare Plan/u);
  assert.equal(envelope.acceptanceCriteria.length, 1);
  assert.match(envelope.acceptanceCriteria[0], /recorded in the specification/u);
  assert.deepEqual(envelope.dependencies, [], 'a lone task carries no dependency row');
  assert.deepEqual(envelope.boundaries.doNotChange, [], 'no preserve entry is invented');
});

test('the task schema requires no orchestration bookkeeping', () => {
  const schema = JSON.parse(readFileSync(join(root, 'schemas/v1.0.0/task.schema.json'), 'utf8'));
  for (const field of [
    'contentHash',
    'runId',
    'candidate',
    'receiptHash',
    'reviewerIds',
    'correctionBudget',
  ]) {
    assert.ok(!schema.required.includes(field), `${field} must not be required of a task`);
  }
});
