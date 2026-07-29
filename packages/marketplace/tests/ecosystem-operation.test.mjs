import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  isVerifiedOperation,
  validateOperation,
} from '../scripts/validate-operation.mjs';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('verified ecosystem operation follows the coordinated saga contract', async () => {
  const operation = await readJson('../examples/ecosystem-operation.json');
  assert.deepEqual(validateOperation(operation), []);
  assert.equal(isVerifiedOperation(operation), true);
  assert.equal(operation.operationId, 'OPERATE-SPEC-002');
  assert.deepEqual(operation.participantOrder, ['pipeline', 'cli', 'skills', 'marketplace']);
  assert.equal(operation.ledger.kind, 'marketplace-draft-pr');
  assert.equal(operation.participants.at(-1).compensation, 'withhold-manifest');
  assert.ok(
    operation.participants.every(({ repoLocalSpecId, repoLocalWorkItem }) =>
      repoLocalSpecId.startsWith('OPERATE-SPEC-002:') &&
      repoLocalWorkItem.startsWith('docs/implementation/'),
    ),
  );
  assert.deepEqual(
    operation.releaseEvidence.map(({ status }) => status),
    Array.from({ length: 5 }, () => 'passed'),
  );
  assert.ok(
    operation.participants.every(({ approvals }) =>
      approvals.some(({ gate }) => gate === 'release'),
    ),
  );
});

test('completed operation requires verified participants and a merged ledger', async () => {
  const operation = await readJson('../examples/ecosystem-operation.json');
  operation.state = 'completed';
  operation.participants[0].phase = 'published';
  operation.ledger.pullRequest = null;
  // The example ledger carries real digests once an operation is under way, so
  // clear them here rather than relying on the fixture still being blank. The
  // rule under test is that completion demands them, not that the example
  // happens to lack them.
  operation.prepareDigest = null;
  operation.confirmationDigest = null;
  const errors = validateOperation(operation);
  assert.ok(errors.includes('completed operation requires every participant to be verified'));
  assert.ok(errors.includes('completed operation requires a merged marketplace ledger PR'));
  assert.ok(errors.includes('completed operation requires prepareDigest'));
  assert.ok(errors.includes('completed operation requires confirmationDigest'));
});

test('verified operation cannot omit deterministic canary evidence', async () => {
  const operation = await readJson('../examples/ecosystem-operation.json');
  operation.state = 'verified';
  for (const evidence of operation.releaseEvidence) {
    evidence.status = 'pending';
    evidence.url = null;
    evidence.digest = null;
    evidence.checkedAt = null;
  }
  const errors = validateOperation(operation);
  for (const id of [
    'packed-cli',
    'protocol-v1.2',
    'event-replay',
    'security-boundaries',
    'outcome-reconciliation',
  ]) {
    assert.ok(errors.includes(`operating canary: ${id} must pass before the operation can be verified`));
  }
});

test('verified closeout requires an ordered post-merge finalization record', async () => {
  const operation = await readJson('../examples/ecosystem-operation.json');
  operation.state = 'verified';
  operation.history = operation.history.filter(
    ({ type }) => !['reconciliation.recorded', 'operation.verified'].includes(type),
  );
  let errors = validateOperation(operation);
  assert.ok(
    errors.includes('verified operation requires a reconciliation.recorded history event'),
  );
  assert.ok(errors.includes('verified operation requires an operation.verified history event'));

  operation.history.push(
    {
      eventId: '1997bb60-7892-490b-9cba-0b1eaa26ead7',
      timestamp: '2026-07-28T13:00:00.000Z',
      type: 'operation.verified',
      actor: 'maintainer',
      participant: 'marketplace',
      digest: `sha256:${'a'.repeat(64)}`,
      note: 'Finalization update prepared.',
    },
    {
      eventId: 'f623aa96-73a5-4bc7-96b5-dbf34967539e',
      timestamp: '2026-07-28T13:01:00.000Z',
      type: 'reconciliation.recorded',
      actor: 'maintainer',
      participant: 'marketplace',
      digest: `sha256:${'b'.repeat(64)}`,
      note: 'Authoritative live state matched.',
    },
  );
  errors = validateOperation(operation);
  assert.ok(errors.includes('operation.verified must follow reconciliation.recorded'));
});

test('repo-local spec IDs are bound to canonical implementation work items', async () => {
  const operation = await readJson('../examples/ecosystem-operation.json');
  operation.participants[1].repoLocalWorkItem = 'docs/implementation/wrong.md';
  assert.ok(
    validateOperation(operation).includes(
      'cli repoLocalWorkItem must be docs/implementation/OPERATE-SPEC-002.md',
    ),
  );
});

test('operation schema remains strict and identifies the draft-PR ledger', async () => {
  const schema = await readJson('../schemas/ecosystem-operation.schema.json');
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.ledger.properties.kind.const, 'marketplace-draft-pr');
  assert.equal(schema.properties.ledger.properties.repository.const, 'openplanr/marketplace');
  assert.equal(schema.properties.kind.const, 'openplanr-ecosystem-operation');
  assert.equal(schema.properties.protocolVersion.const, '1.2.0');
  assert.ok(schema.required.includes('operationDigest'));
  assert.ok(schema.required.includes('releaseEvidence'));
  assert.ok(schema.required.includes('reconciliation'));
  assert.ok(schema.properties.state.enum.includes('verified'));
  assert.equal(schema.properties.participantOrder.prefixItems.length, 4);
  assert.equal(
    schema.allOf[0].then.properties.reconciliation.properties.status.const,
    'matched',
  );
  assert.deepEqual(
    schema.allOf[0].then.properties.history.allOf.map(
      ({ contains }) => contains.properties.type.const,
    ),
    ['reconciliation.recorded', 'operation.verified'],
  );
});
