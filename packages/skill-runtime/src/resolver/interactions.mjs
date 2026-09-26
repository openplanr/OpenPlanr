import { randomUUID } from 'node:crypto';

import { validateProtocolArtifact } from '@openplanr/protocol/contracts';
import { verifyDocumentDigest } from '@openplanr/protocol/canonical-json';

import { SkillRuntimeError } from '../errors.mjs';
import { resolveCapabilities } from './capabilities.mjs';

export const INTERACTION_SURFACES = Object.freeze(['native', 'chat', 'terminal', 'headless']);

const SURFACE_PROTOCOL_INTERACTION = Object.freeze({
  native: 'native',
  chat: 'chat',
  terminal: 'terminal',
  headless: 'none',
});
const SURFACE_CAPABILITY = Object.freeze({
  native: 'native-questions',
  chat: 'structured-chat',
  terminal: 'attached-terminal',
  headless: null,
});
const VALUE_TYPES = Object.freeze({
  text: 'string',
  secret: 'string',
  'single-select': 'string',
  path: 'string',
  confirmation: 'boolean',
  'multi-select': 'string-array',
  'repeated-text': 'string-array',
});

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function fail(code, message, details = {}) {
  throw new SkillRuntimeError(code, message, details);
}

function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 3) {
    fail(
      'E_SKILL_QUESTION_BATCH_INVALID',
      'An interaction batch must contain one to three guided questions.',
    );
  }
  const ids = new Set();
  for (const question of questions) {
    const errors = validateProtocolArtifact('guided-question', question, {
      protocolVersion: '1.2.0',
    });
    if (errors.length) {
      fail(
        'E_SKILL_QUESTION_INVALID',
        `Guided question ${question?.questionId ?? '<unknown>'} is invalid.`,
        {
          questionId: question?.questionId ?? null,
          errors,
        },
      );
    }
    if (ids.has(question.questionId)) {
      fail(
        'E_SKILL_QUESTION_BATCH_INVALID',
        `Question ${question.questionId} is duplicated in the interaction batch.`,
      );
    }
    ids.add(question.questionId);
  }
  return questions;
}

function validateBindings(hostProfile) {
  const bindings = hostProfile?.interactionBindings;
  if (!Array.isArray(bindings) || bindings.length < 1) {
    fail(
      'E_SKILL_INTERACTION_BINDINGS_INVALID',
      'The host profile has no ordered interaction bindings.',
      {
        hostProfileId: hostProfile?.hostProfileId ?? null,
      },
    );
  }
  const declaredCapabilities = new Set(hostProfile.runtimeCapabilities ?? []);
  const seen = new Set();
  for (const [index, binding] of bindings.entries()) {
    const expectedCapability = SURFACE_CAPABILITY[binding?.surface];
    if (
      !binding ||
      !INTERACTION_SURFACES.includes(binding.surface) ||
      binding.protocolInteraction !== SURFACE_PROTOCOL_INTERACTION[binding.surface] ||
      (expectedCapability === null
        ? binding.capabilityId !== undefined
        : binding.capabilityId !== expectedCapability) ||
      (expectedCapability !== null && !declaredCapabilities.has(expectedCapability)) ||
      (binding.surface === 'headless' && index !== bindings.length - 1) ||
      seen.has(binding.surface)
    ) {
      fail(
        'E_SKILL_INTERACTION_BINDINGS_INVALID',
        'The host profile contains an invalid or duplicate interaction binding.',
        {
          hostProfileId: hostProfile?.hostProfileId ?? null,
          binding,
        },
      );
    }
    seen.add(binding.surface);
  }
  return bindings;
}

function answerValueEquals(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return Object.is(left, right);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function answerValueContains(answer, expected) {
  if (typeof answer === 'string' && typeof expected === 'string') return answer.includes(expected);
  if (!Array.isArray(answer)) return false;
  return Array.isArray(expected)
    ? expected.every((value) => answer.includes(value))
    : answer.includes(expected);
}

function conditionState(condition, values, unresolvedQuestionIds) {
  if (!values.has(condition.questionId)) {
    if (unresolvedQuestionIds.has(condition.questionId)) return 'unknown';
    return condition.operator === 'not-answered' ? 'matched' : 'unmatched';
  }
  const answer = values.get(condition.questionId);
  const matched = {
    equals: () => answerValueEquals(answer, condition.value),
    'not-equals': () => !answerValueEquals(answer, condition.value),
    contains: () => answerValueContains(answer, condition.value),
    'not-contains': () => !answerValueContains(answer, condition.value),
    answered: () => true,
    'not-answered': () => false,
  }[condition.operator]();
  return matched ? 'matched' : 'unmatched';
}

function questionVisibilityState(question, answers, unresolvedQuestionIds = new Set()) {
  const values = new Map(answers.map(({ questionId, value }) => [questionId, value]));
  if (!question.visibleWhen) return 'matched';
  const states = question.visibleWhen.map((condition) =>
    conditionState(condition, values, unresolvedQuestionIds),
  );
  if (states.includes('unmatched')) return 'unmatched';
  return states.includes('unknown') ? 'unknown' : 'matched';
}

function visibleQuestions(questions, answers, unresolvedQuestionIds = new Set()) {
  return questions.filter(
    (question) => questionVisibilityState(question, answers, unresolvedQuestionIds) !== 'unmatched',
  );
}

function matchedQuestions(questions, answers, unresolvedQuestionIds = new Set()) {
  return questions.filter(
    (question) => questionVisibilityState(question, answers, unresolvedQuestionIds) === 'matched',
  );
}

function validAnswer(question, value) {
  const expected = VALUE_TYPES[question.type];
  if (!expected) return false;
  if (expected === 'string' && typeof value !== 'string') return false;
  if (expected === 'boolean' && typeof value !== 'boolean') return false;
  if (
    expected === 'string-array' &&
    (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
  )
    return false;
  if (typeof value === 'string') {
    if (
      question.validation?.minLength !== undefined &&
      value.length < question.validation.minLength
    )
      return false;
    if (
      question.validation?.maxLength !== undefined &&
      value.length > question.validation.maxLength
    )
      return false;
  }
  if (Array.isArray(value)) {
    if (question.validation?.minItems !== undefined && value.length < question.validation.minItems)
      return false;
    if (question.validation?.maxItems !== undefined && value.length > question.validation.maxItems)
      return false;
    if (new Set(value).size !== value.length) return false;
  }
  if (question.type === 'single-select' && !question.choices.some(({ id }) => id === value))
    return false;
  if (
    question.type === 'multi-select' &&
    value.some((item) => !question.choices.some(({ id }) => id === item))
  )
    return false;
  return true;
}

function answerRecord(question, value, source, inferred) {
  return {
    questionId: question.questionId,
    questionVersion: question.questionVersion,
    sensitivity: question.sensitivity,
    value: structuredClone(value),
    source,
    inferred,
  };
}

function inferAnswers(questions, repositoryContext) {
  if (
    !repositoryContext ||
    typeof repositoryContext !== 'object' ||
    Array.isArray(repositoryContext)
  ) {
    fail(
      'E_SKILL_REPOSITORY_CONTEXT_INVALID',
      'repositoryContext must be keyed by guided question ID.',
    );
  }
  const answers = [];
  const pending = [];
  for (const question of questions) {
    if (question.type === 'informational') continue;
    const candidate = repositoryContext[question.questionId];
    if (
      question.sensitivity !== 'sensitive' &&
      candidate?.confidence === 'exact' &&
      candidate.safe === true &&
      typeof candidate.source === 'string' &&
      candidate.source.length > 0 &&
      validAnswer(question, candidate.value)
    ) {
      answers.push(answerRecord(question, candidate.value, candidate.source, true));
    } else {
      pending.push(question);
    }
  }
  return { answers, pending };
}

function validateHeadlessQuestionPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    fail(
      'E_SKILL_QUESTION_POLICY_INVALID',
      'headlessQuestionPolicy must be keyed by guided question ID.',
    );
  }
  for (const [questionId, declaration] of Object.entries(policy)) {
    if (
      !declaration ||
      typeof declaration !== 'object' ||
      Array.isArray(declaration) ||
      !['non-material', 'material'].includes(declaration.materiality) ||
      !['safe', 'unsafe'].includes(declaration.defaultSafety)
    ) {
      fail('E_SKILL_QUESTION_POLICY_INVALID', `Headless policy for ${questionId} is invalid.`, {
        questionId,
      });
    }
  }
  return policy;
}

function hasSafeHeadlessDefault(question, policy) {
  return (
    question.sensitivity !== 'sensitive' &&
    question.valueSemantics === 'default' &&
    validAnswer(question, question.defaultValue) &&
    policy?.materiality === 'non-material' &&
    policy?.defaultSafety === 'safe'
  );
}

function resolveHeadlessQuestions(questions, inferredAnswers, policy) {
  const answerable = questions.filter(({ type }) => type !== 'informational');
  const answers = [...inferredAnswers];
  const answeredIds = new Set(answers.map(({ questionId }) => questionId));
  const unresolvedIds = new Set(
    answerable
      .filter(({ questionId }) => !answeredIds.has(questionId))
      .map(({ questionId }) => questionId),
  );
  const omittedOptional = new Set();

  let changed = true;
  while (changed) {
    changed = false;
    for (const question of answerable) {
      if (!unresolvedIds.has(question.questionId)) continue;
      const visibility = questionVisibilityState(question, answers, unresolvedIds);
      if (visibility === 'unmatched') {
        unresolvedIds.delete(question.questionId);
        changed = true;
        continue;
      }
      if (visibility === 'unknown') continue;
      if (hasSafeHeadlessDefault(question, policy[question.questionId])) {
        answers.push(
          answerRecord(
            question,
            question.defaultValue,
            `question:${question.questionId}:default`,
            true,
          ),
        );
        unresolvedIds.delete(question.questionId);
        changed = true;
      } else if (!question.required) {
        unresolvedIds.delete(question.questionId);
        omittedOptional.add(question.questionId);
        changed = true;
      }
    }

    if (!changed) {
      const unresolvedOptional = answerable.filter(
        (question) => !question.required && unresolvedIds.has(question.questionId),
      );
      for (const question of unresolvedOptional) {
        unresolvedIds.delete(question.questionId);
        omittedOptional.add(question.questionId);
        changed = true;
      }
    }
  }

  const activeQuestions = matchedQuestions(questions, answers, unresolvedIds);
  const activeIds = new Set(activeQuestions.map(({ questionId }) => questionId));
  const activeAnswers = answers.filter(({ questionId }) => activeIds.has(questionId));
  const unresolvedRequired = answerable
    .filter(
      (question) =>
        question.required &&
        unresolvedIds.has(question.questionId) &&
        activeIds.has(question.questionId),
    )
    .map(({ questionId }) => questionId);

  return {
    activeQuestions,
    answers: activeAnswers,
    informational: activeQuestions.filter(({ type }) => type === 'informational'),
    omittedOptional: [...omittedOptional].sort(),
    unresolvedRequired,
  };
}

function sessionMetadata(session = {}, questionnaire = {}) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    fail('E_SKILL_INTERACTION_SESSION_INVALID', 'session must be an object when provided.');
  }
  if (!questionnaire || typeof questionnaire !== 'object' || Array.isArray(questionnaire)) {
    fail('E_SKILL_INTERACTION_SESSION_INVALID', 'questionnaire must be an object when provided.');
  }
  if (session.kind === 'skill-session') {
    const errors = validateProtocolArtifact('skill-session', session, { protocolVersion: '1.6.0' });
    const digestValid = verifyDocumentDigest(session);
    if (errors.length || !digestValid) {
      fail(
        'E_SKILL_INTERACTION_SESSION_INVALID',
        'The lifecycle session is not a valid Protocol 1.6 skill session.',
        {
          errors,
          digestValid,
        },
      );
    }
  }
  if (questionnaire.sessionId && questionnaire.sessionId !== session.sessionId) {
    fail(
      'E_SKILL_INTERACTION_SESSION_MISMATCH',
      'The questionnaire belongs to a different lifecycle session.',
      {
        questionnaireSessionId: questionnaire.sessionId,
        sessionId: session.sessionId ?? null,
      },
    );
  }
  return {
    sessionId: session.sessionId ?? `GIS-${randomUUID().replaceAll('-', '')}`,
    questionnaireDigest:
      questionnaire.digest ??
      questionnaire.questionnaireDigest ??
      session.questionnaireDigest ??
      null,
    questionnaireVersion:
      questionnaire.questionnaireVersion ?? session.questionnaireVersion ?? '1.0.0',
    command: questionnaire.command ?? session.command ?? null,
    projectIdentity: questionnaire.projectIdentity ?? session.projectIdentity ?? null,
    projectHead: questionnaire.projectHead ?? session.projectHead ?? null,
    configHead: questionnaire.configHead ?? session.configHead ?? null,
  };
}

function attempt(binding, capability) {
  return {
    surface: binding.surface,
    capabilityId: binding.capabilityId ?? null,
    status: capability?.status ?? 'completed',
    diagnostic: capability?.diagnostic ?? null,
  };
}

function baseResult({ hostProfile, metadata, inferred, attempts }) {
  return {
    sessionId: metadata.sessionId,
    session: metadata,
    host: hostProfile.host,
    hostProfileId: hostProfile.hostProfileId,
    hostProfileVersion: hostProfile.hostProfileVersion,
    inferredAnswers: inferred.answers,
    inference: inferred.answers.map(({ questionId, source }) => ({ questionId, source })),
    attempts,
  };
}

/** Select the first runtime-verified surface declared by a Protocol host profile. */
export function resolveInteraction({
  hostProfile,
  runtimeCapabilities = {},
  questions,
  repositoryContext = {},
  session = {},
  questionnaire = {},
  headlessQuestionPolicy = {},
} = {}) {
  const validatedQuestions = validateQuestions(questions ?? session?.questions);
  const bindings = validateBindings(hostProfile);
  const candidateInference = inferAnswers(validatedQuestions, repositoryContext);
  const candidatePendingIds = new Set(
    candidateInference.pending.map(({ questionId }) => questionId),
  );
  const activeQuestions = visibleQuestions(
    validatedQuestions,
    candidateInference.answers,
    candidatePendingIds,
  );
  const activeIds = new Set(activeQuestions.map(({ questionId }) => questionId));
  const inferred = {
    answers: candidateInference.answers.filter(({ questionId }) => activeIds.has(questionId)),
    pending: candidateInference.pending.filter(({ questionId }) => activeIds.has(questionId)),
  };
  const informational = activeQuestions.filter(({ type }) => type === 'informational');
  const metadata = sessionMetadata(session, questionnaire);
  const headlessPolicy = validateHeadlessQuestionPolicy(headlessQuestionPolicy);
  const attempts = [];

  if (inferred.pending.length === 0) {
    return freeze({
      status: 'completed',
      phase: 'answered',
      surface: 'headless',
      protocolInteraction: 'none',
      questions: [],
      informational: structuredClone(informational),
      answers: inferred.answers,
      ...baseResult({ hostProfile, metadata, inferred, attempts }),
      diagnostic: {
        code:
          informational.length > 0 ? 'I_SKILL_INFORMATION_PRESENTED' : 'I_SKILL_QUESTIONS_INFERRED',
        message:
          informational.length > 0
            ? 'The active batch contains information only; no answer is required.'
            : 'All answers came from exact repository context.',
        repair: null,
      },
    });
  }

  for (const binding of bindings) {
    if (binding.surface !== 'headless') {
      const capability = resolveCapabilities({
        hostProfile,
        runtimeCapabilities,
        required: [binding.capabilityId],
      });
      attempts.push(attempt(binding, capability));
      if (capability.status !== 'completed') continue;
      return freeze({
        status: 'completed',
        phase: 'awaiting-input',
        surface: binding.surface,
        protocolInteraction: binding.protocolInteraction,
        questions: structuredClone(
          activeQuestions.filter(
            ({ type, questionId }) =>
              type === 'informational' ||
              inferred.pending.some((question) => question.questionId === questionId),
          ),
        ),
        informational: structuredClone(informational),
        answers: inferred.answers,
        ...baseResult({ hostProfile, metadata, inferred, attempts }),
        diagnostic: {
          code: 'I_SKILL_INTERACTION_SELECTED',
          message: `${binding.surface} interaction is available for ${hostProfile.hostProfileId}.`,
          repair: null,
        },
      });
    }

    attempts.push(attempt(binding));
    const headless = resolveHeadlessQuestions(activeQuestions, inferred.answers, headlessPolicy);
    const finalInference = {
      answers: inferred.answers.filter(({ questionId }) =>
        headless.answers.some((answer) => answer.questionId === questionId),
      ),
      pending: [],
    };
    if (headless.unresolvedRequired.length === 0) {
      return freeze({
        status: 'completed',
        phase: 'answered',
        surface: 'headless',
        protocolInteraction: 'none',
        questions: [],
        informational: structuredClone(headless.informational),
        answers: headless.answers,
        omittedOptional: headless.omittedOptional,
        ...baseResult({ hostProfile, metadata, inferred: finalInference, attempts }),
        diagnostic: {
          code: 'I_SKILL_HEADLESS_DEFAULTS_APPLIED',
          message:
            'Headless execution used only exact context, declared safe defaults, and optional omissions.',
          repair: null,
        },
      });
    }
    return freeze({
      status: 'blocked',
      phase: 'unanswered',
      surface: 'headless',
      protocolInteraction: 'none',
      questions: structuredClone(headless.activeQuestions),
      informational: structuredClone(headless.informational),
      answers: headless.answers,
      unresolvedRequired: headless.unresolvedRequired,
      ...baseResult({ hostProfile, metadata, inferred: finalInference, attempts }),
      diagnostic: {
        code: 'E_SKILL_HEADLESS_ANSWER_REQUIRED',
        message: `Headless execution needs an answer for ${headless.unresolvedRequired.join(', ')}.`,
        repair: 'Use a declared interactive fallback or supply exact repository context.',
      },
    });
  }

  const status = attempts.some((entry) => entry.status === 'denied') ? 'denied' : 'unavailable';
  return freeze({
    status,
    phase: 'unanswered',
    surface: null,
    protocolInteraction: null,
    questions: structuredClone(inferred.pending),
    informational: structuredClone(informational),
    answers: inferred.answers,
    ...baseResult({ hostProfile, metadata, inferred, attempts }),
    diagnostic: {
      code: status === 'denied' ? 'E_SKILL_INTERACTION_DENIED' : 'E_SKILL_INTERACTION_UNAVAILABLE',
      message: `No declared interaction surface is ${status === 'denied' ? 'permitted' : 'available'}.`,
      repair: 'Use a host-profile fallback that the active runtime reports as available.',
    },
  });
}

function boundAnswers(resolution, supplied) {
  const values = supplied instanceof Map ? Object.fromEntries(supplied) : supplied;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    fail('E_SKILL_INTERACTION_ANSWERS_INVALID', 'answers must be keyed by guided question ID.');
  }
  const suppliedRecords = Object.entries(values).map(([questionId, value]) => ({
    questionId,
    value,
  }));
  const activeQuestions = visibleQuestions(resolution.questions, [
    ...resolution.inferredAnswers,
    ...suppliedRecords,
  ]);
  const activeQuestionIds = new Set(activeQuestions.map(({ questionId }) => questionId));
  const questions = new Map(
    activeQuestions
      .filter(({ type }) => type !== 'informational')
      .map((question) => [question.questionId, question]),
  );
  const unknown = Object.keys(values)
    .filter((questionId) => !questions.has(questionId))
    .sort();
  const answers = resolution.inferredAnswers.filter(({ questionId }) =>
    activeQuestionIds.has(questionId),
  );
  const invalid = [];
  const missing = [];
  for (const question of questions.values()) {
    if (!(question.questionId in values)) {
      if (question.required) missing.push(question.questionId);
      continue;
    }
    if (!validAnswer(question, values[question.questionId])) {
      invalid.push(question.questionId);
      continue;
    }
    answers.push(
      answerRecord(
        question,
        values[question.questionId],
        `interaction:${resolution.surface}`,
        false,
      ),
    );
  }
  return { answers, invalid, missing, unknown };
}

/** Bind chosen values to the internal session through the v1.2 answer envelope. */
export function bindInteractionAnswers({
  resolution,
  answers = {},
  submittedAt = new Date().toISOString(),
  cancelled = false,
  cancellationReason = 'The interaction was cancelled.',
} = {}) {
  if (!resolution || typeof resolution !== 'object' || resolution.phase !== 'awaiting-input') {
    fail(
      'E_SKILL_INTERACTION_RESOLUTION_INVALID',
      'An awaiting-input interaction resolution is required.',
    );
  }
  if (cancelled) {
    return freeze({
      status: 'cancelled',
      phase: 'cancelled',
      sessionId: resolution.sessionId,
      surface: resolution.surface,
      diagnostic: {
        code: 'I_SKILL_INTERACTION_CANCELLED',
        message: cancellationReason,
        repair: null,
      },
    });
  }

  const bound = boundAnswers(resolution, answers);
  if (bound.unknown.length) {
    return freeze({
      status: 'blocked',
      phase: 'unanswered',
      sessionId: resolution.sessionId,
      surface: resolution.surface,
      unknown: bound.unknown,
      diagnostic: {
        code: 'E_SKILL_INTERACTION_ANSWER_STALE',
        message: `The submitted answer references ${bound.unknown.join(', ')}, which is not in the current question batch.`,
        repair: 'Refresh the question surface and answer only the current questions.',
      },
    });
  }
  if (bound.invalid.length || bound.missing.length) {
    const questionIds = [...bound.invalid, ...bound.missing].sort();
    return freeze({
      status: 'blocked',
      phase: 'unanswered',
      sessionId: resolution.sessionId,
      surface: resolution.surface,
      invalid: bound.invalid,
      missing: bound.missing,
      diagnostic: {
        code: 'E_SKILL_INTERACTION_ANSWER_INVALID',
        message: `A valid answer is required for ${questionIds.join(', ')}.`,
        repair: 'Answer the named question using its declared type and choices.',
      },
    });
  }

  const session = resolution.session;
  const requiredSessionFields = [
    'questionnaireDigest',
    'questionnaireVersion',
    'command',
    'projectIdentity',
    'projectHead',
    'configHead',
  ];
  const missingSessionFields = requiredSessionFields.filter((field) => !session[field]);
  if (missingSessionFields.length) {
    return freeze({
      status: 'blocked',
      phase: 'unanswered',
      sessionId: resolution.sessionId,
      surface: resolution.surface,
      diagnostic: {
        code: 'E_SKILL_INTERACTION_SESSION_INCOMPLETE',
        message: `Internal session metadata is missing ${missingSessionFields.join(', ')}.`,
        repair: 'Resolve the lifecycle session with its internal questionnaire binding and retry.',
      },
    });
  }

  const envelope = {
    kind: 'guided-answer-envelope',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    sessionId: resolution.sessionId,
    questionnaireDigest: session.questionnaireDigest,
    questionnaireVersion: session.questionnaireVersion,
    command: session.command,
    projectIdentity: session.projectIdentity,
    projectHead: session.projectHead,
    configHead: session.configHead,
    answers: bound.answers
      .map(({ questionId, questionVersion, sensitivity, value }) => ({
        questionId,
        questionVersion,
        sensitivity,
        value,
      }))
      .sort((left, right) => left.questionId.localeCompare(right.questionId)),
    adapter: {
      runtime: resolution.host,
      version: resolution.hostProfileVersion,
      interaction: resolution.protocolInteraction,
    },
    submittedAt,
  };
  const errors = validateProtocolArtifact('guided-answer-envelope', envelope, {
    protocolVersion: '1.2.0',
  });
  if (errors.length) {
    return freeze({
      status: 'blocked',
      phase: 'unanswered',
      sessionId: resolution.sessionId,
      surface: resolution.surface,
      diagnostic: {
        code: 'E_SKILL_INTERACTION_ENVELOPE_INVALID',
        message: 'The internal answer envelope did not satisfy Protocol 1.2.',
        repair: 'Repair the named session or answer field and retry.',
        errors,
      },
    });
  }

  return freeze({
    status: 'completed',
    phase: 'answered',
    sessionId: resolution.sessionId,
    surface: resolution.surface,
    protocolInteraction: resolution.protocolInteraction,
    answers: bound.answers,
    envelope,
    diagnostic: {
      code: 'I_SKILL_INTERACTION_ANSWERED',
      message: `Answers are bound to session ${resolution.sessionId}.`,
      repair: null,
    },
  });
}
