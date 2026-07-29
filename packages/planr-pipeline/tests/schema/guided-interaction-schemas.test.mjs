import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  listProtocolSchemas,
  normalizeGuidedInteractionArtifact,
  validateEvidenceDiagnostic,
  validateGuidedAnswerEnvelope,
  validateGuidedConfirmation,
  validateGuidedQuestion,
  validateGuidedQuestionnaire,
  validateGuidedSession,
  validateStructuredAction,
} from '../../lib/pipeline/index.mjs';

const digest = (value = 'a') => `sha256:${value.repeat(64)}`;
const createdAt = '2026-07-29T09:00:00Z';
const expiresAt = '2026-07-30T09:00:00Z';
const adapter = { runtime: 'codex', version: '1.0.0', interaction: 'native' };

const question = {
  kind: 'guided-question',
  schemaVersion: '1.0.0',
  protocolVersion: '1.2.0',
  questionId: 'decision-owner',
  questionVersion: '1.0.0',
  type: 'text',
  label: 'Who owns final operating decisions?',
  explanation: 'This person approves governance decisions.',
  required: true,
  sensitivity: 'internal',
  persistence: 'session',
  valueSemantics: 'suggestion',
  suggestedValue: 'Git user',
  suggestionReason: 'Derived from the local Git identity and requires confirmation.',
  validation: { minLength: 1, maxLength: 160 },
};

const questionnaire = {
  kind: 'guided-questionnaire',
  schemaVersion: '1.0.0',
  protocolVersion: '1.2.0',
  sessionId: 'GIS-session-1234',
  digest: digest('a'),
  questionnaireVersion: '1.0.0',
  command: 'operate.init',
  projectIdentity: digest('b'),
  projectHead: digest('c'),
  configHead: digest('d'),
  adapter,
  stage: 'foundation',
  step: 1,
  totalSteps: 3,
  title: 'Configure the Operating Board',
  questions: [question],
  createdAt,
  expiresAt,
};

const answerEnvelope = {
  kind: 'guided-answer-envelope',
  schemaVersion: '1.0.0',
  protocolVersion: '1.2.0',
  sessionId: questionnaire.sessionId,
  questionnaireDigest: questionnaire.digest,
  questionnaireVersion: questionnaire.questionnaireVersion,
  command: questionnaire.command,
  projectIdentity: questionnaire.projectIdentity,
  projectHead: questionnaire.projectHead,
  configHead: questionnaire.configHead,
  answers: [{
    questionId: question.questionId,
    questionVersion: question.questionVersion,
    sensitivity: question.sensitivity,
    value: 'Asem',
  }],
  adapter,
  submittedAt: createdAt,
};

const action = {
  kind: 'structured-action',
  schemaVersion: '1.0.0',
  protocolVersion: '1.2.0',
  id: 'apply-operating-initialization',
  label: 'Apply this Operating Board configuration',
  command: `planr operate init --confirm ${digest('e')} --yes --json`,
  effect: 'project-write',
  providerUse: false,
  requiresConfirmation: true,
  confirmationScope: 'apply exactly this initialization preview',
  confirmationDigest: digest('e'),
  recommended: true,
};

test('guided interaction schemas are registered through the stable Protocol API', () => {
  const kinds = new Set(listProtocolSchemas()
    .filter(({ protocolVersion }) => protocolVersion === '1.2.0')
    .map(({ kind }) => kind));
  for (const kind of [
    'guided-question',
    'guided-questionnaire',
    'guided-answer-envelope',
    'guided-session',
    'guided-confirmation',
    'structured-action',
    'evidence-diagnostic',
  ]) {
    assert.ok(kinds.has(kind), `${kind} is missing from the Protocol registry`);
  }
});

test('questions and questionnaires reject executable conditions and duplicate identifiers', () => {
  assert.deepEqual(validateGuidedQuestion(question), []);
  assert.deepEqual(validateGuidedQuestionnaire(questionnaire), []);
  assert.ok(validateGuidedQuestion({
    ...question,
    visibleWhen: { questionId: 'profile', operator: 'javascript', value: 'run()' },
  }).length);
  assert.ok(validateGuidedQuestionnaire({
    ...questionnaire,
    questions: [question, { ...question, label: 'Duplicate identifier' }],
  }).some(({ rule }) => rule === 'uniqueQuestionId'));
  assert.ok(validateGuidedQuestionnaire({
    ...questionnaire,
    step: 4,
  }).some(({ rule }) => rule === 'stepRange'));
});

test('answer and session contracts are identity-bound and never persist sensitive answers', () => {
  assert.deepEqual(validateGuidedAnswerEnvelope(answerEnvelope), []);
  assert.ok(validateGuidedAnswerEnvelope({
    ...answerEnvelope,
    answers: [answerEnvelope.answers[0], { ...answerEnvelope.answers[0], value: 'Different' }],
  }).some(({ rule }) => rule === 'uniqueQuestionId'));

  const session = {
    kind: 'guided-session',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    sessionId: questionnaire.sessionId,
    state: 'awaiting-input',
    command: questionnaire.command,
    projectIdentity: questionnaire.projectIdentity,
    projectHead: questionnaire.projectHead,
    configHead: questionnaire.configHead,
    questionnaireDigest: questionnaire.digest,
    questionnaireVersion: questionnaire.questionnaireVersion,
    adapter,
    persistedAnswers: answerEnvelope.answers,
    createdAt,
    updatedAt: createdAt,
    expiresAt,
  };
  assert.deepEqual(validateGuidedSession(session), []);
  assert.ok(validateGuidedSession({
    ...session,
    persistedAnswers: [{ ...answerEnvelope.answers[0], sensitivity: 'sensitive' }],
  }).length);
});

test('structured actions separate presentation capability from mutation authority', () => {
  assert.deepEqual(validateStructuredAction(action), []);
  assert.deepEqual(validateStructuredAction({
    ...action,
    id: 'show-status',
    command: 'planr operate status --json',
    effect: 'read-only',
    requiresConfirmation: false,
    confirmationScope: null,
    confirmationDigest: null,
  }), []);
  assert.ok(validateStructuredAction({
    ...action,
    confirmationScope: null,
    confirmationDigest: null,
  }).length);
  assert.ok(validateStructuredAction({
    ...action,
    effect: 'provider-call',
    providerUse: false,
  }).length);
});

test('confirmations and evidence classifications are exact-digest-bound', () => {
  const confirmation = {
    kind: 'guided-confirmation',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    confirmationId: 'GIC-confirmation-1234',
    state: 'preview',
    actionId: action.id,
    sessionId: questionnaire.sessionId,
    command: action.command,
    effect: action.effect,
    providerUse: action.providerUse,
    confirmationScope: action.confirmationScope,
    confirmationDigest: action.confirmationDigest,
    projectIdentity: questionnaire.projectIdentity,
    projectHead: questionnaire.projectHead,
    configHead: questionnaire.configHead,
    arguments: [],
    destinations: ['.planr/operate/config.json'],
    writes: ['.planr/operate/config.json'],
    createdAt,
    expiresAt,
  };
  assert.deepEqual(validateGuidedConfirmation(confirmation), []);

  const diagnostic = {
    kind: 'evidence-diagnostic',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    candidateId: 'EVC-candidate-1234',
    source: 'repository',
    componentId: 'control-repository',
    location: '.github/workflows/deploy.yml',
    line: 26,
    ruleId: 'secret-assignment',
    category: 'assignment',
    contentDigest: digest('f'),
    projectHead: digest('1'),
    valueDisclosed: false,
    actions: [action],
    classification: {
      status: 'false-positive',
      ruleId: 'secret-assignment',
      contentDigest: digest('f'),
      projectHead: digest('1'),
      reason: 'Verified synthetic fixture at the exact content digest.',
      confirmationDigest: digest('2'),
      classifiedAt: createdAt,
      classifiedBy: 'Asem',
    },
  };
  assert.deepEqual(validateEvidenceDiagnostic(diagnostic), []);
  assert.ok(validateEvidenceDiagnostic({
    ...diagnostic,
    classification: { ...diagnostic.classification, contentDigest: digest('0') },
  }).some(({ rule }) => rule === 'exactEvidenceBinding'));
  assert.ok(validateEvidenceDiagnostic({ ...diagnostic, value: 'must never be present' }).length);
});

test('normalization is additive, strict, and rejects unsupported Protocol versions', () => {
  const normalized = normalizeGuidedInteractionArtifact('structured-action', {
    ...action,
    kind: undefined,
    schemaVersion: undefined,
    protocolVersion: undefined,
  });
  assert.equal(normalized.kind, 'structured-action');
  assert.equal(normalized.protocolVersion, '1.2.0');
  assert.ok(validateStructuredAction({ ...action, protocolVersion: '1.1.0' }).length);
});
