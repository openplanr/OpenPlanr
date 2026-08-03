import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  GUIDED_INTERACTION_CONTRACTS,
  normalizeGuidedInteractionArtifact,
  validateGuidedQuestion,
  validateStructuredAction,
} from '../../lib/pipeline/index.mjs';

const adapters = JSON.parse(readFileSync(new URL('../../registry/adapters.json', import.meta.url)));

test('the guided contract catalog is immutable and complete', () => {
  assert.equal(Object.isFrozen(GUIDED_INTERACTION_CONTRACTS), true);
  assert.deepEqual(Object.keys(GUIDED_INTERACTION_CONTRACTS).sort(), [
    'evidence-diagnostic',
    'guided-answer-envelope',
    'guided-confirmation',
    'guided-question',
    'guided-questionnaire',
    'guided-session',
    'structured-action',
  ]);
});

test('all certified adapters declare truthful presentation modes only', () => {
  const modes = new Set(['native', 'chat', 'terminal', 'none']);
  for (const adapter of adapters.adapters) {
    assert.ok(modes.has(adapter.capabilities.interactiveQuestions));
    assert.equal(typeof adapter.capabilities.operatingBoard, 'boolean');
    assert.ok([
      'native-isolated',
      'native-bounded',
      'structured-provider',
      'native-read-only',
      'native-agent',
      'sequential-native',
    ].includes(adapter.capabilities.operatingAdvisorDispatch));
    assert.equal(typeof adapter.capabilities.toolIsolation, 'string');
  }
  const byId = (id) => adapters.adapters.find((adapter) => adapter.id === id);
  const codex = byId('codex');
  assert.equal(codex.capabilities.toolIsolation, 'advisory');
  assert.equal(codex.capabilities.operatingAdvisorDispatch, 'native-agent');
  assert.equal(codex.capabilities.interactiveQuestions, 'native');
  // Protocol v1.4 makes every certified runtime a native Operating executor;
  // Cursor uses a same-runtime sequential fallback.
  assert.equal(byId('claude-code').capabilities.operatingAdvisorDispatch, 'native-agent');
  assert.equal(byId('cursor').capabilities.operatingAdvisorDispatch, 'sequential-native');
});

test('normalization cannot manufacture authority from adapter capabilities', () => {
  const action = {
    id: 'begin-cycle',
    label: 'Begin one operating cycle',
    command: 'planr operate run --offline --json',
    effect: 'project-write',
    providerUse: false,
    requiresConfirmation: false,
    confirmationScope: null,
    confirmationDigest: null,
    recommended: true,
  };
  assert.throws(
    () => normalizeGuidedInteractionArtifact('structured-action', action),
    /Confirmation-free read | Digest-bound confirmed action/,
  );
  assert.ok(validateStructuredAction({
    kind: 'structured-action',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    ...action,
  }).length);
});

test('unknown security-sensitive question fields and unbounded input are rejected', () => {
  const question = {
    kind: 'guided-question',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    questionId: 'provider-token',
    questionVersion: '1.0.0',
    type: 'secret',
    label: 'Provider token',
    explanation: 'Used once and never persisted.',
    required: true,
    sensitivity: 'sensitive',
    persistence: 'none',
    valueSemantics: 'none',
    validation: { maxLength: 4096 },
  };
  assert.deepEqual(validateGuidedQuestion(question), []);
  assert.ok(validateGuidedQuestion({ ...question, persistRawValue: true }).length);
  assert.ok(validateGuidedQuestion({
    ...question,
    validation: { maxLength: 1000000000 },
  }).length);
});
