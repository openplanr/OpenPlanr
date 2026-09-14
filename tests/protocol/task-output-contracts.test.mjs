import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256Jcs, withDocumentDigest } from '../../packages/protocol/src/canonical-json.mjs';
import { resolveProtocolSchema, validateProtocolArtifact } from '../../packages/protocol/src/contracts.mjs';
import { CANONICAL_REGISTRIES } from '../../packages/protocol/src/registries.mjs';
import {
  countR2Tasks, validateTaskGraph, validateTaskManifestSemantics, validateTaskOutputSemantics,
} from '../../packages/protocol/src/task-contracts.mjs';

const digest = (text) => sha256Jcs({ text });
const envelope = (kind) => ({
  kind, schemaVersion: '1.0.0', protocolVersion: '1.5.0', documentVersion: '1.0.0',
  digestAlgorithm: 'sha256', canonicalization: 'rfc8785',
});

function task(overrides = {}) {
  const value = {
    ...envelope('task-manifest'),
    taskManifestId: 'tmf_0123456789abcdef0123456789abcdef',
    task: { taskId: 'T-001', path: 'output/feats/feat-demo/us-001/tasks/task-1.md', schemaRef: { id: 'task', version: '1.0.0' }, contentDigest: digest('task') },
    parent: { projectMode: 'default', storyId: 'US-001', specId: null, featureSlug: 'demo' },
    routing: {
      taskKind: 'frontend', roleId: 'planr-frontend', roleVersion: '1.0.0',
      taskKindRegistryDigest: CANONICAL_REGISTRIES['task-kinds.json'].documentDigest,
      roleRegistryDigest: CANONICAL_REGISTRIES['roles.json'].documentDigest,
    },
    dependencies: [],
    scope: {
      create: [{ repositoryKey: 'project', path: 'src/new.ts' }],
      modify: [{ repositoryKey: 'project', path: 'src/existing.ts' }],
      preserve: [{ repositoryKey: 'project', path: 'src/protected.ts' }],
    },
    inputs: [],
    expectedOutputs: [{ outputId: 'generated-project-files', contractRef: { id: 'task-output-manifest', version: '1.0.0' }, paths: [], pathArguments: {} }],
    acceptanceRefs: [{ kind: 'gherkin-scenario', reference: 'output/feats/feat-demo/us-001/acceptance.feature', statement: 'Scenario: user sees the result' }],
    ruleIds: ['R2', 'R5', 'R6', 'R9'],
    reviewBinding: { planDigest: digest('plan'), planningReviewReceiptDigest: digest('review'), ownerDecisionDigest: digest('owner') },
    producer: { id: 'pipeline-engine', version: '1.0.0', sourceDigest: digest('engine') }, issuedAt: '2026-08-29T00:00:00Z',
    ...overrides,
  };
  return withDocumentDigest(value);
}

function output(taskManifest, overrides = {}) {
  return withDocumentDigest({
    ...envelope('task-output-manifest'),
    taskOutputId: 'tof_0123456789abcdef0123456789abcdef',
    taskBinding: { taskManifestId: taskManifest.taskManifestId, taskManifestDigest: taskManifest.documentDigest },
    roleBinding: { roleId: taskManifest.routing.roleId, roleVersion: taskManifest.routing.roleVersion, registryDigest: taskManifest.routing.roleRegistryDigest },
    attempt: { initialAttempt: 1, correctionIteration: 0 }, outcome: 'completed',
    startedAt: '2026-08-29T00:01:00Z', completedAt: '2026-08-29T00:02:00Z',
    changes: [{ repositoryKey: 'project', path: 'src/new.ts', operation: 'create', beforeDigest: null, afterDigest: digest('new'), byteLength: 3 }],
    preserveVerification: [{ repositoryKey: 'project', path: 'src/protected.ts', beforeDigest: digest('protected'), afterDigest: digest('protected'), unchanged: true }],
    commandEvidence: [{
      commandId: 'test', argvDigest: digest('argv'), workingDirectory: { repositoryKey: 'project', path: 'src' },
      startedAt: '2026-08-29T00:01:00Z', completedAt: '2026-08-29T00:02:00Z', exitCode: 0,
      stdoutDigest: digest('stdout'), stderrDigest: digest('stderr'), status: 'passed',
    }],
    acceptanceEvidence: [{ acceptanceRef: 'scenario-user-sees-result', verifier: 'qa', result: 'passed', evidenceDigest: digest('evidence') }],
    outputs: [], diagnostics: [], errorHandoff: null, externalEffects: [],
    producer: { id: 'pipeline-engine', version: '1.0.0', sourceDigest: digest('engine') },
    ...overrides,
  });
}

function implementationResult(overrides = {}) {
  return {
    outcome: { status: 'completed', summary: 'The requested behavior now works.' },
    task: { kind: 'planr-task', id: 'T-001', path: 'output/feats/feat-demo/us-001/tasks/task-1.md' },
    changed: [{ path: 'src/new.ts', purpose: 'Implement the requested behavior.' }],
    checks: [{ command: 'npm test', status: 'passed', detail: 'The focused suite passed.' }],
    issues: [],
    ...overrides,
  };
}

test('implementation result validates concise task and direct-request outcomes', () => {
  const planned = implementationResult();
  const direct = implementationResult({
    outcome: { status: 'partial', summary: 'The implementation works; one optional check was unavailable.' },
    task: { kind: 'direct-request' },
    checks: [{ command: 'npm run browser:qa', status: 'not-run', detail: 'No browser runtime is installed.' }],
    issues: [{
      problem: 'Browser QA was not run.', impact: 'Interactive behavior is not browser-verified.', nextAction: 'Run browser QA when Chromium is available.',
    }],
  });

  assert.deepEqual(validateProtocolArtifact('implementation-result', planned), []);
  assert.deepEqual(validateProtocolArtifact('implementation-result', direct), []);
  const { schema } = resolveProtocolSchema('implementation-result', { protocolVersion: '1.5.0' });
  assert.deepEqual(Object.keys(schema.properties).sort(), ['changed', 'checks', 'issues', 'outcome', 'task']);
  assert.doesNotMatch(JSON.stringify(schema), /hash|digest|evidence|attempt|receipt/iu);
  assert.ok(validateProtocolArtifact('implementation-result', { ...planned, attempt: 1 })
    .some(({ rule }) => rule === 'additionalProperties'));
  const withoutIssues = { ...planned };
  delete withoutIssues.issues;
  assert.ok(validateProtocolArtifact('implementation-result', withoutIssues)
    .some(({ rule }) => rule === 'required'));
});

test('legacy task output remains readable and satisfies its original semantic joins', () => {
  const manifest = task();
  const result = output(manifest);
  assert.deepEqual(validateProtocolArtifact('task-manifest', manifest, { protocolVersion: '1.5.0' }), []);
  assert.deepEqual(validateProtocolArtifact('task-output-manifest', result, { protocolVersion: '1.5.0' }), []);
  assert.deepEqual(validateTaskManifestSemantics(manifest), []);
  assert.deepEqual(validateTaskOutputSemantics(result, { taskManifest: manifest }), []);
  assert.equal(countR2Tasks([manifest]), 1);
});

test('routing mismatch, scope overlap, and unreviewed issuance have stable diagnostics', () => {
  const original = task();
  const invalid = task({
    routing: { ...original.routing, roleId: 'planr-backend' },
    scope: { ...original.scope, preserve: [{ repositoryKey: 'project', path: 'src/new.ts' }] },
    reviewBinding: { planDigest: null, planningReviewReceiptDigest: null, ownerDecisionDigest: null },
  });
  assert.deepEqual(validateTaskManifestSemantics(invalid).map(({ code }) => code), [
    'E_TASK_KIND_ROLE_MISMATCH', 'E_TASK_SCOPE_OVERLAP', 'E_TASK_REVIEW_BINDING_REQUIRED',
  ]);
});

test('task graph catches cycles and R2 ignores preflight/quality work', () => {
  const first = task({ dependencies: [{ taskId: 'T-002', taskManifestDigest: digest('two') }] });
  const secondBase = task({
    taskManifestId: 'tmf_1123456789abcdef0123456789abcdef',
    task: { ...task().task, taskId: 'T-002' },
    routing: {
      taskKind: 'database', roleId: 'planr-database', roleVersion: '1.0.0',
      taskKindRegistryDigest: CANONICAL_REGISTRIES['task-kinds.json'].documentDigest,
      roleRegistryDigest: CANONICAL_REGISTRIES['roles.json'].documentDigest,
    },
    dependencies: [{ taskId: 'T-001', taskManifestDigest: first.documentDigest }],
  });
  assert.ok(validateTaskGraph([first, secondBase]).some(({ code }) => code === 'E_TASK_GRAPH_CYCLE'));
  assert.equal(countR2Tasks([first, secondBase]), 1);
});

test('output semantics enforce Preserve, QA read-only, adaptive recovery, and terminal correlations', () => {
  const manifest = task();
  const changedPreserve = output(manifest, {
    changes: [{ repositoryKey: 'project', path: 'src/protected.ts', operation: 'modify', beforeDigest: digest('before'), afterDigest: digest('after'), byteLength: 3 }],
    preserveVerification: [{ repositoryKey: 'project', path: 'src/protected.ts', beforeDigest: digest('before'), afterDigest: digest('after'), unchanged: true }],
    commandEvidence: [{
      commandId: 'test', argvDigest: digest('argv'), workingDirectory: { repositoryKey: 'project', path: 'src' },
      startedAt: '2026-08-29T00:01:00Z', completedAt: '2026-08-29T00:02:00Z', exitCode: 1,
      stdoutDigest: digest('stdout'), stderrDigest: digest('stderr'), status: 'failed',
    }],
  });
  const codes = validateTaskOutputSemantics(changedPreserve, { taskManifest: manifest }).map(({ code }) => code);
  assert.ok(codes.includes('E_TASK_OUTPUT_SCOPE_ESCAPE'));
  assert.ok(codes.includes('E_TASK_OUTPUT_PRESERVE_CHANGED'));
  assert.ok(codes.includes('E_TASK_OUTPUT_COMPLETED_INVALID'));

  const qa = output(manifest, {
    roleBinding: { roleId: 'planr-qa', roleVersion: '1.0.0', registryDigest: manifest.routing.roleRegistryDigest },
  });
  assert.ok(validateTaskOutputSemantics(qa).some(({ code }) => code === 'E_TASK_OUTPUT_QA_WRITE'));

  const fourth = output(manifest, { attempt: { initialAttempt: 1, correctionIteration: 4 } });
  assert.deepEqual(validateProtocolArtifact('task-output-manifest', fourth, { protocolVersion: '1.5.0' }), []);

  const blocked = output(manifest, { outcome: 'blocked', diagnostics: [], errorHandoff: null });
  assert.ok(validateTaskOutputSemantics(blocked).some(({ code }) => code === 'E_TASK_OUTPUT_BLOCKED_HANDOFF_REQUIRED'));
});
