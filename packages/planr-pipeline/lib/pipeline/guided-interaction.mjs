import { PipelineError } from './errors.mjs';
import {
  validateGuidedAnswerEnvelope,
  validateGuidedQuestion,
  validateGuidedQuestionnaire,
  validateStructuredAction,
} from './engine.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';

export const GUIDED_INTERACTION_MODES = Object.freeze([
  'native',
  'chat',
  'terminal',
  'none',
]);

const MODE_AVAILABILITY_KEYS = Object.freeze({
  native: 'nativeQuestions',
  chat: 'structuredChat',
  terminal: 'attachedTerminal',
});

const FALLBACKS = Object.freeze({
  native: Object.freeze(['native', 'chat', 'terminal', 'none']),
  chat: Object.freeze(['chat', 'terminal', 'none']),
  terminal: Object.freeze(['terminal', 'none']),
  none: Object.freeze(['none']),
});

const ANSWER_VALUE_TYPES = Object.freeze({
  text: 'string',
  secret: 'string',
  'single-select': 'string',
  path: 'string',
  confirmation: 'boolean',
  'multi-select': 'string-array',
  'repeated-text': 'string-array',
});
const ANSWER_COPY_FIELDS = Object.freeze([
  'questionId',
  'questionVersion',
  'sensitivity',
]);

function fail(code, message, details = {}) {
  throw new PipelineError(code, message, undefined, details);
}

function validationFailure(kind, errors) {
  fail(
    'E_GUIDED_ADAPTER_INPUT_INVALID',
    `${kind}: ${errors[0].path} ${errors[0].detail}`,
    { kind, errors },
  );
}

function adapterFromRegistry(registry, runtime) {
  assertProtocolArtifact('adapter-registry', registry);
  const adapter = registry.adapters.find(({ id }) => id === runtime);
  if (!adapter) {
    fail(
      'E_GUIDED_ADAPTER_RUNTIME_UNSUPPORTED',
      `Runtime "${runtime}" is not present in the certified adapter registry.`,
      { runtime },
    );
  }
  return adapter;
}

/**
 * Resolve presentation only. The result cannot confer mutation or provider
 * authority; it describes how a validated CLI artifact can be shown.
 */
export function resolveGuidedInteraction({
  registry,
  runtime,
  runtimeReport = {},
} = {}) {
  const adapter = adapterFromRegistry(registry, runtime);
  const declared = adapter.capabilities.interactiveQuestions;
  const attempted = FALLBACKS[declared];
  const selected = attempted.find((mode) => (
    mode === 'none' || runtimeReport[MODE_AVAILABILITY_KEYS[mode]] === true
  )) ?? 'none';
  const fallback = selected !== declared;
  const reason = selected === 'none'
    ? 'No verified native, structured-chat, or attached-terminal interaction surface is available.'
    : fallback
      ? `${declared} interaction was not verified by the active runtime; using ${selected}.`
      : `${selected} interaction was verified by the active runtime.`;
  return Object.freeze({
    runtime,
    adapterVersion: adapter.version,
    declared,
    mode: selected,
    fallback,
    attempted: [...attempted],
    diagnostic: Object.freeze({
      code: selected === 'none'
        ? 'E_GUIDED_INTERACTION_UNAVAILABLE'
        : fallback
          ? 'W_GUIDED_INTERACTION_DOWNGRADED'
          : 'I_GUIDED_INTERACTION_VERIFIED',
      reason,
      recovery: selected === 'none'
        ? 'Attach an interactive terminal or use a certified runtime with structured questions/chat.'
        : null,
    }),
  });
}

export function assertGuidedCliResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    fail('E_GUIDED_ADAPTER_RESULT_INVALID', 'The CLI result must be a JSON object.');
  }
  if (result.questionnaire) {
    const errors = validateGuidedQuestionnaire(result.questionnaire);
    if (errors.length) validationFailure('guided-questionnaire', errors);
  }
  for (const action of result.actions ?? []) {
    const errors = validateStructuredAction(action);
    if (errors.length) validationFailure('structured-action', errors);
  }
  if (result.actions !== undefined && !Array.isArray(result.actions)) {
    fail('E_GUIDED_ADAPTER_RESULT_INVALID', 'The CLI actions field must be an array.');
  }
  return structuredClone(result);
}

function normalizedAnswers(questionnaire, answers) {
  const values = answers instanceof Map ? Object.fromEntries(answers) : answers;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    fail('E_GUIDED_ADAPTER_ANSWERS_INVALID', 'Answers must be keyed by canonical question ID.');
  }
  const questions = new Map(questionnaire.questions.map((question) => [question.questionId, question]));
  const unknown = Object.keys(values).filter((questionId) => !questions.has(questionId));
  if (unknown.length) {
    fail(
      'E_GUIDED_ADAPTER_ANSWERS_INVALID',
      `Answer references unknown question ID: ${unknown.sort()[0]}.`,
      { questionIds: unknown.sort() },
    );
  }
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([questionId, value]) => {
      const question = questions.get(questionId);
      return {
        questionId,
        questionVersion: question.questionVersion,
        sensitivity: question.sensitivity,
        value,
      };
    });
}

/**
 * Describe the exact bounded stdin document a runtime must submit.
 *
 * The questionnaire digest is calculated before this transport-only contract
 * is attached, avoiding a self-referential digest while still binding every
 * immutable answer-envelope field to the questionnaire.
 */
export function createGuidedAnswerSubmission(questionnaire) {
  if (!questionnaire || typeof questionnaire !== 'object' || Array.isArray(questionnaire)) {
    fail('E_GUIDED_ADAPTER_INPUT_INVALID', 'Questionnaire input must be an object.');
  }
  for (const question of questionnaire.questions ?? []) {
    const questionErrors = validateGuidedQuestion(question);
    if (questionErrors.length) validationFailure('guided-question', questionErrors);
  }
  const answers = questionnaire.questions
    .filter(({ type }) => type !== 'informational')
    .map((question) => ({
      questionId: question.questionId,
      questionVersion: question.questionVersion,
      sensitivity: question.sensitivity,
      required: question.required,
      valueType: ANSWER_VALUE_TYPES[question.type],
    }));
  return Object.freeze({
    kind: 'guided-answer-submission',
    version: '1.0.0',
    schema: 'https://openplanr.dev/schemas/v1.2.0/guided-answer-envelope.schema.json',
    transport: Object.freeze({
      kind: 'stdin-json',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 64 * 1024,
      argv: Object.freeze([
        'planr',
        'operate',
        'init',
        '--resume',
        questionnaire.sessionId,
        '--stdin',
        '--json',
      ]),
    }),
    envelope: Object.freeze({
      fixedFields: Object.freeze({
        kind: 'guided-answer-envelope',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        sessionId: questionnaire.sessionId,
        questionnaireVersion: questionnaire.questionnaireVersion,
        command: questionnaire.command,
        projectIdentity: questionnaire.projectIdentity,
        projectHead: questionnaire.projectHead,
        configHead: questionnaire.configHead,
        adapter: Object.freeze(structuredClone(questionnaire.adapter)),
      }),
      dynamicFields: Object.freeze({
        questionnaireDigest: Object.freeze({
          source: 'questionnaire',
          pointer: '/digest',
        }),
        submittedAt: Object.freeze({
          source: 'runtime-clock',
          format: 'date-time',
        }),
        answers: Object.freeze({
          source: 'chosen-values-by-question-id',
          copyFields: ANSWER_COPY_FIELDS,
          omitUnansweredOptional: true,
          items: Object.freeze(answers.map((answer) => Object.freeze(answer))),
        }),
      }),
    }),
  });
}

/**
 * Materialize a new self-describing questionnaire's exact answer envelope.
 * Runtime metadata is copied verbatim from the digest-bound questionnaire;
 * callers provide only chosen values and their wall-clock submission time.
 */
export function createGuidedAnswerEnvelopeFromQuestionnaire({
  questionnaire,
  answers,
  submittedAt,
} = {}) {
  const questionErrors = validateGuidedQuestionnaire(questionnaire);
  if (questionErrors.length) validationFailure('guided-questionnaire', questionErrors);
  if (!questionnaire.submission) {
    fail(
      'E_GUIDED_ADAPTER_SUBMISSION_UNAVAILABLE',
      'Questionnaire does not expose a self-describing answer submission contract.',
    );
  }
  const envelope = {
    ...structuredClone(questionnaire.submission.envelope.fixedFields),
    questionnaireDigest: questionnaire.digest,
    answers: normalizedAnswers(questionnaire, answers),
    submittedAt,
  };
  const errors = validateGuidedAnswerEnvelope(envelope);
  if (errors.length) validationFailure('guided-answer-envelope', errors);
  return envelope;
}

/**
 * Build the bounded stdin envelope. Question labels and explanations are never
 * accepted as inputs, so an adapter cannot rewrite the CLI-owned questionnaire.
 */
export function createGuidedAnswerEnvelope({
  questionnaire,
  answers,
  runtime,
  runtimeVersion,
  interaction,
  submittedAt,
} = {}) {
  const questionErrors = validateGuidedQuestionnaire(questionnaire);
  if (questionErrors.length) validationFailure('guided-questionnaire', questionErrors);
  if (!GUIDED_INTERACTION_MODES.includes(interaction) || interaction === 'none') {
    fail('E_GUIDED_ADAPTER_INTERACTION_INVALID', 'Answers require native, chat, or terminal interaction.');
  }
  if (questionnaire.submission) {
    fail(
      'E_GUIDED_ADAPTER_SUBMISSION_REQUIRED',
      'Use createGuidedAnswerEnvelopeFromQuestionnaire() for a self-describing questionnaire.',
    );
  }
  const envelope = {
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
    answers: normalizedAnswers(questionnaire, answers),
    adapter: {
      runtime,
      version: runtimeVersion,
      interaction,
    },
    submittedAt,
  };
  const errors = validateGuidedAnswerEnvelope(envelope);
  if (errors.length) validationFailure('guided-answer-envelope', errors);
  return envelope;
}

export function encodeGuidedAnswerStdin(envelope, { maxBytes = 64 * 1024 } = {}) {
  const errors = validateGuidedAnswerEnvelope(envelope);
  if (errors.length) validationFailure('guided-answer-envelope', errors);
  const input = `${JSON.stringify(envelope)}\n`;
  const bytes = Buffer.byteLength(input, 'utf8');
  if (bytes > maxBytes) {
    fail(
      'E_GUIDED_ADAPTER_STDIN_TOO_LARGE',
      `Guided answer input is ${bytes} bytes; the limit is ${maxBytes}.`,
      { bytes, maxBytes },
    );
  }
  return input;
}

/**
 * Transport identity and wall-clock submission time intentionally do not
 * participate in preview equivalence.
 */
export function reduceGuidedAnswerEnvelope(envelope) {
  const errors = validateGuidedAnswerEnvelope(envelope);
  if (errors.length) validationFailure('guided-answer-envelope', errors);
  return {
    schemaVersion: envelope.schemaVersion,
    protocolVersion: envelope.protocolVersion,
    sessionId: envelope.sessionId,
    questionnaireDigest: envelope.questionnaireDigest,
    questionnaireVersion: envelope.questionnaireVersion,
    command: envelope.command,
    projectIdentity: envelope.projectIdentity,
    projectHead: envelope.projectHead,
    configHead: envelope.configHead,
    answers: structuredClone(envelope.answers).sort(
      (left, right) => left.questionId.localeCompare(right.questionId),
    ),
  };
}

export function guidedAnswerPreviewDigest(envelope) {
  return sha256Jcs(reduceGuidedAnswerEnvelope(envelope));
}

/**
 * Echo a CLI-owned action and exact digest after a distinct user selection.
 * This helper never adds --yes and never treats a field answer as authority.
 */
export function selectGuidedAction({ actions, actionId, confirmationDigest } = {}) {
  if (!Array.isArray(actions)) {
    fail('E_GUIDED_ADAPTER_ACTIONS_INVALID', 'CLI actions must be an array.');
  }
  for (const action of actions) {
    const errors = validateStructuredAction(action);
    if (errors.length) validationFailure('structured-action', errors);
  }
  const action = actions.find(({ id }) => id === actionId);
  if (!action) {
    fail(
      'E_GUIDED_ADAPTER_ACTION_NOT_FOUND',
      `The CLI did not return an action named "${actionId}".`,
      { actionId },
    );
  }
  if (
    action.requiresConfirmation
    && confirmationDigest !== action.confirmationDigest
  ) {
    fail(
      'E_GUIDED_ADAPTER_CONFIRMATION_MISMATCH',
      `Action "${actionId}" requires its exact CLI confirmation digest.`,
      { actionId },
    );
  }
  return Object.freeze({
    actionId: action.id,
    command: action.command,
    confirmationDigest: action.confirmationDigest,
    effect: action.effect,
    providerUse: action.providerUse,
  });
}
