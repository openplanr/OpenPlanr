import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate } from '../../conformance/json-schema-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

const schema = JSON.parse(readFileSync(join(root, 'schemas/v1.0.0/pipeline-shipped.schema.json'), 'utf-8'));
const valid = JSON.parse(readFileSync(join(root, 'tests/fixtures/valid-pipeline-shipped.json'), 'utf-8'));
const invalid = JSON.parse(readFileSync(join(root, 'tests/fixtures/invalid-pipeline-shipped-missing-fields.json'), 'utf-8'));

test('pipeline-shipped marker validates when all required fields are present', () => {
  assert.equal(validate(valid, schema).length, 0);
});

test('pipeline-shipped marker fails when required fields (mode, tasks_failed, duration_seconds, agents_invoked, *_status, error_reports) are omitted', () => {
  const errors = validate(invalid, schema);
  assert.ok(errors.length > 0);
});

test('pipeline-shipped marker rejects runtime not in enum [claude-code, cursor, codex]', () => {
  const badRuntime = { ...valid, runtime: 'aider' };
  const errors = validate(badRuntime, schema);
  assert.ok(errors.length > 0, 'expected runtime enum violation');
});

test('pipeline-shipped marker rejects mode other than default | spec-driven', () => {
  const badMode = { ...valid, mode: 'hybrid' };
  const errors = validate(badMode, schema);
  assert.ok(errors.length > 0, 'expected mode enum violation');
});

test('pipeline-shipped marker rejects qa_gate_status outside enum [passed, failed, skipped]', () => {
  const badQa = { ...valid, qa_gate_status: 'pending' };
  const errors = validate(badQa, schema);
  assert.ok(errors.length > 0, 'expected qa_gate_status enum violation');
});

test('pipeline-shipped marker rejects pipeline_version that is not semver', () => {
  const badVersion = { ...valid, pipeline_version: 'v0.7.3' };
  const errors = validate(badVersion, schema);
  assert.ok(errors.length > 0, 'expected pipeline_version pattern violation (leading "v" not allowed)');
});

test('pipeline-shipped marker rejects unknown additional properties', () => {
  const extra = { ...valid, snapshot_skip_reason: 'planr-managed' };
  const errors = validate(extra, schema);
  assert.ok(errors.length > 0, 'expected additionalProperties:false violation');
});

test('pipeline-shipped marker rejects negative tasks_executed', () => {
  const negative = { ...valid, tasks_executed: -1 };
  const errors = validate(negative, schema);
  assert.ok(errors.length > 0, 'expected tasks_executed minimum:0 violation');
});
