import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createGuidedAnswerEnvelopeFromQuestionnaire,
  createGuidedAnswerSubmission,
  listProtocolSchemas,
  normalizeGuidedInteractionArtifact,
  sha256Jcs,
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

function selfDescribingQuestionnaire() {
  const core = {
    ...questionnaire,
    schemaVersion: '1.1.0',
    adapter: { ...questionnaire.adapter, interaction: 'none' },
  };
  delete core.digest;
  const withoutDigest = {
    ...core,
    submission: createGuidedAnswerSubmission(core),
  };
  return {
    ...withoutDigest,
    digest: sha256Jcs(withoutDigest),
  };
}

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

test('self-describing questionnaires preserve v1.0 compatibility and bind exact stdin metadata', () => {
  const current = selfDescribingQuestionnaire();
  assert.deepEqual(validateGuidedQuestionnaire(questionnaire), []);
  assert.deepEqual(validateGuidedQuestionnaire(current), []);
  assert.ok(validateGuidedQuestionnaire({
    ...questionnaire,
    submission: current.submission,
  }).length, 'schema 1.0 cannot claim the new submission contract');
  const { submission: _submission, ...missingSubmission } = current;
  assert.ok(validateGuidedQuestionnaire(missingSubmission).length);
  assert.ok(validateGuidedQuestionnaire({
    ...current,
    submission: {
      ...current.submission,
      transport: {
        ...current.submission.transport,
        argv: current.submission.transport.argv.map((part) =>
          part === current.sessionId ? 'GIS-different-session' : part),
      },
    },
  }).some(({ rule }) => rule === 'exactSubmissionCommand'));
  assert.deepEqual(
    current.submission.envelope.dynamicFields.answers.copyFields,
    ['questionId', 'questionVersion', 'sensitivity'],
  );
  assert.ok(validateGuidedQuestionnaire({
    ...current,
    submission: {
      ...current.submission,
      envelope: {
        ...current.submission.envelope,
        dynamicFields: {
          ...current.submission.envelope.dynamicFields,
          answers: {
            ...current.submission.envelope.dynamicFields.answers,
            copyFields: ['questionId', 'required', 'valueType'],
          },
        },
      },
    },
  }).some(({ rule }) => rule === 'exactAnswerCopyFields'));
  assert.equal(
    current.digest,
    sha256Jcs(Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'digest'))),
    'the descriptor uses a digest pointer and can participate in the questionnaire digest',
  );
});

test('a literal runtime can materialize a valid envelope from declared copy fields', () => {
  const current = selfDescribingQuestionnaire();
  const answersContract = current.submission.envelope.dynamicFields.answers;
  const descriptor = answersContract.items.find(
    ({ questionId }) => questionId === question.questionId,
  );
  const answer = Object.fromEntries(
    answersContract.copyFields.map((field) => [field, descriptor[field]]),
  );
  answer.value = 'Asem';
  const envelope = {
    ...structuredClone(current.submission.envelope.fixedFields),
    questionnaireDigest: current.digest,
    answers: [answer],
    submittedAt: createdAt,
  };

  assert.deepEqual(validateGuidedAnswerEnvelope(envelope), []);
  assert.deepEqual(Object.keys(envelope.answers[0]).sort(), [
    'questionId',
    'questionVersion',
    'sensitivity',
    'value',
  ]);
  assert.equal('required' in envelope.answers[0], false);
  assert.equal('valueType' in envelope.answers[0], false);
  const helperEnvelope = createGuidedAnswerEnvelopeFromQuestionnaire({
    questionnaire: current,
    answers: { 'decision-owner': 'Asem' },
    submittedAt: createdAt,
  });
  assert.deepEqual(envelope, helperEnvelope);

  const invalidEnvelope = {
    ...envelope,
    answers: [{
      ...structuredClone(descriptor),
      value: 'Asem',
    }],
  };
  const invalidErrors = validateGuidedAnswerEnvelope(invalidEnvelope);
  assert.ok(invalidErrors.some(
    ({ path, detail }) => path === '$.answers[0]' && detail.includes("'required'"),
  ));
  assert.ok(invalidErrors.some(
    ({ path, detail }) => path === '$.answers[0]' && detail.includes("'valueType'"),
  ));
});

test('a runtime can materialize a valid envelope from only the questionnaire and chosen values', () => {
  const current = selfDescribingQuestionnaire();
  const envelope = createGuidedAnswerEnvelopeFromQuestionnaire({
    questionnaire: current,
    answers: { 'decision-owner': 'Asem' },
    submittedAt: createdAt,
  });
  assert.deepEqual(validateGuidedAnswerEnvelope(envelope), []);
  assert.deepEqual(envelope, {
    ...current.submission.envelope.fixedFields,
    questionnaireDigest: current.digest,
    answers: [{
      questionId: question.questionId,
      questionVersion: question.questionVersion,
      sensitivity: question.sensitivity,
      value: 'Asem',
    }],
    submittedAt: createdAt,
  });
  assert.equal(envelope.adapter.interaction, 'none');
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
