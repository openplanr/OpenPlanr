import { PipelineError } from './errors.mjs';
import {
  validateGuidedAnswerEnvelope,
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
