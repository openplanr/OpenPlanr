import path from 'node:path';
import { resolveGuidedInteractionValidators } from '../../pipeline-package-service.js';
import { canonicalDigest } from '../canonical.js';
import {
  type GuidedQuestion,
  type GuidedQuestionnaire,
  type GuidedQuestionValue,
  OperateError,
  type OperatingInitAnswers,
} from '../types.js';
import { buildOperatingCharterSuggestions } from './charter-suggestions.js';
import {
  type OperatingInitQuestionDefinition,
  type OperatingInitStage,
  type OperatingQuestionContext,
  operatingInitQuestionRegistry,
} from './question-registry.js';

const STAGES: readonly OperatingInitStage[] = ['foundation', 'product-charter', 'review'];

export interface OperatingQuestionEngineContext extends OperatingQuestionContext {
  projectRoot: string;
  projectIdentity?: `sha256:${string}`;
  runtime?: string;
  interaction?: 'native' | 'chat' | 'terminal' | 'none';
  projectHead?: `sha256:${string}`;
  configHead?: `sha256:${string}`;
  now?: string;
}

export type OperatingQuestionEngineResult =
  | {
      status: 'input-required';
      stage: 'foundation' | 'product-charter';
      answers: OperatingInitAnswers;
      questions: GuidedQuestion[];
    }
  | {
      status: 'preview-ready';
      stage: 'review';
      answers: OperatingInitAnswers;
      questions: GuidedQuestion[];
    };

export function operatingInitAnswersFromOptions(
  options: Record<string, unknown>,
): OperatingInitAnswers {
  const list = (value: unknown): string[] | undefined =>
    Array.isArray(value)
      ? value
          .map(String)
          .map((entry) => entry.trim())
          .filter(Boolean)
      : undefined;
  const nonEmptyList = (value: unknown): string[] | undefined => {
    const entries = list(value);
    return entries?.length ? entries : undefined;
  };
  const goals = nonEmptyList(options.goal);
  const successMetrics = nonEmptyList(options.successMetric);
  const guardrails = nonEmptyList(options.guardrail);
  const knownUnknowns = nonEmptyList(options.knownUnknown);
  const sources = nonEmptyList(options.sources ?? options.source);
  const evidenceFiles = nonEmptyList(options.evidenceFile);
  const componentRoots = nonEmptyList(options.components ?? options.component);
  const charter =
    options.charter && typeof options.charter === 'object' && !Array.isArray(options.charter)
      ? (options.charter as OperatingInitAnswers['charter'])
      : {
          ...(typeof options.purpose === 'string' ? { purpose: options.purpose } : {}),
          ...(typeof options.productStage === 'string' ? { stage: options.productStage } : {}),
          ...(typeof options.businessModel === 'string'
            ? { businessModel: options.businessModel }
            : {}),
          ...(typeof options.idealCustomer === 'string'
            ? { idealCustomer: options.idealCustomer }
            : {}),
          ...(goals ? { goals } : {}),
          ...(successMetrics ? { successMetrics } : {}),
          ...(guardrails ? { guardrails } : {}),
          ...(knownUnknowns ? { knownUnknowns } : {}),
        };
  return {
    ...(typeof options.profile === 'string'
      ? { profile: options.profile as OperatingInitAnswers['profile'] }
      : {}),
    ...(typeof options.profileFile === 'string' ? { profileFile: options.profileFile } : {}),
    ...(typeof options.decisionOwner === 'string' ? { decisionOwner: options.decisionOwner } : {}),
    ...(typeof options.planningEngine === 'string'
      ? { planningEngine: options.planningEngine as OperatingInitAnswers['planningEngine'] }
      : {}),
    ...(typeof options.runtime === 'string'
      ? { runtime: options.runtime as OperatingInitAnswers['runtime'] }
      : {}),
    ...(typeof options.cadence === 'string'
      ? { cadence: options.cadence as OperatingInitAnswers['cadence'] }
      : {}),
    ...(typeof options.timezone === 'string' ? { timezone: options.timezone } : {}),
    ...(typeof options.sensitivityCeiling === 'string'
      ? {
          sensitivityCeiling:
            options.sensitivityCeiling as OperatingInitAnswers['sensitivityCeiling'],
        }
      : {}),
    ...(sources ? { sources } : {}),
    ...(evidenceFiles ? { evidenceFiles } : {}),
    ...(componentRoots ? { componentRoots } : {}),
    ...(Object.keys(charter ?? {}).length > 0 ? { charter } : {}),
  };
}

export function mergeOperatingInitAnswersIntoOptions(
  options: Record<string, unknown>,
  answers: OperatingInitAnswers,
): Record<string, unknown> {
  return {
    ...options,
    ...answers,
    ...(answers.sources === undefined ? {} : { source: answers.sources, sources: answers.sources }),
    ...(answers.evidenceFiles === undefined ? {} : { evidenceFile: answers.evidenceFiles }),
    ...(answers.componentRoots === undefined
      ? {}
      : { component: answers.componentRoots, components: answers.componentRoots }),
  };
}

function answered(value: GuidedQuestionValue | undefined): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined;
}

function conditionVisible(
  definition: OperatingInitQuestionDefinition,
  definitions: readonly OperatingInitQuestionDefinition[],
  answers: OperatingInitAnswers,
): boolean {
  return (definition.question.visibleWhen ?? []).every((condition) => {
    const dependency = definitions.find(
      (candidate) => candidate.question.questionId === condition.questionId,
    );
    const actual = dependency?.read(answers);
    switch (condition.operator) {
      case 'answered':
        return answered(actual);
      case 'not-answered':
        return !answered(actual);
      case 'equals':
        return actual === condition.value;
      case 'not-equals':
        return actual !== condition.value;
      case 'contains':
        return Array.isArray(actual)
          ? actual.includes(String(condition.value))
          : String(actual ?? '').includes(String(condition.value));
      case 'not-contains':
        return Array.isArray(actual)
          ? !actual.includes(String(condition.value))
          : !String(actual ?? '').includes(String(condition.value));
    }
    return false;
  });
}

function normalizeValue(question: GuidedQuestion, value: GuidedQuestionValue): GuidedQuestionValue {
  const normalized = Array.isArray(value)
    ? [...new Set(value.map((entry) => entry.trim()).filter(Boolean))]
    : typeof value === 'string'
      ? value.trim()
      : value;
  const choices = question.choices?.map((choice) => choice.id);
  if (
    choices &&
    (Array.isArray(normalized)
      ? normalized.some((entry) => !choices.includes(entry))
      : !choices.includes(String(normalized)))
  ) {
    throw new OperateError(
      'E_OPERATE_QUESTIONNAIRE_INVALID',
      `${question.label} contains an unsupported choice.`,
    );
  }
  const length = typeof normalized === 'string' ? normalized.length : undefined;
  const itemCount = Array.isArray(normalized) ? normalized.length : undefined;
  if (
    (length !== undefined &&
      ((question.validation?.minLength !== undefined && length < question.validation.minLength) ||
        (question.validation?.maxLength !== undefined &&
          length > question.validation.maxLength))) ||
    (itemCount !== undefined &&
      ((question.validation?.minItems !== undefined && itemCount < question.validation.minItems) ||
        (question.validation?.maxItems !== undefined && itemCount > question.validation.maxItems)))
  ) {
    throw new OperateError(
      'E_OPERATE_QUESTIONNAIRE_INVALID',
      `${question.label} does not satisfy its bounded validation rules.`,
    );
  }
  return normalized;
}

function validateSemanticAnswers(
  answers: OperatingInitAnswers,
  context: OperatingQuestionEngineContext,
): void {
  if (answers.timezone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: answers.timezone }).format(new Date(0));
    } catch {
      throw new OperateError(
        'E_OPERATE_QUESTIONNAIRE_INVALID',
        `Invalid IANA timezone: ${answers.timezone}.`,
      );
    }
  }
  const unavailable = (answers.sources ?? []).filter(
    (source) => !context.availableSources.includes(source),
  );
  if (unavailable.length > 0) {
    throw new OperateError(
      'E_OPERATE_QUESTIONNAIRE_INVALID',
      `Evidence source is unavailable: ${unavailable.join(', ')}. Configure it or leave it disabled.`,
    );
  }
  for (const candidate of answers.evidenceFiles ?? []) {
    if (path.isAbsolute(candidate) || candidate.split(/[\\/]+/).includes('..')) {
      throw new OperateError(
        'E_OPERATE_QUESTIONNAIRE_INVALID',
        'Evidence import paths must remain relative to a configured workspace root.',
      );
    }
  }
}

export async function evaluateOperatingInitQuestions(input: {
  answers?: OperatingInitAnswers;
  context: OperatingQuestionEngineContext;
  requireCharter?: boolean;
}): Promise<OperatingQuestionEngineResult> {
  const definitions = operatingInitQuestionRegistry(input.context);
  let answers = structuredClone(input.answers ?? {});
  for (const definition of definitions) {
    const current = definition.read(answers);
    if (current !== undefined && answered(current)) {
      answers = definition.write(answers, normalizeValue(definition.question, current));
    }
  }
  validateSemanticAnswers(answers, input.context);
  for (const stage of STAGES.slice(0, input.requireCharter === false ? 1 : 2)) {
    const visible = definitions.filter(
      (definition) =>
        definition.stage === stage && conditionVisible(definition, definitions, answers),
    );
    const missing = visible.filter(
      (definition) =>
        definition.question.type !== 'informational' &&
        definition.question.required &&
        !answered(definition.read(answers)),
    );
    if (missing.length > 0) {
      const suggestions =
        stage === 'product-charter'
          ? await buildOperatingCharterSuggestions({ projectRoot: input.context.projectRoot })
          : null;
      return {
        status: 'input-required',
        stage: stage as 'foundation' | 'product-charter',
        answers,
        questions: visible
          .filter((definition) => !answered(definition.read(answers)))
          .map((definition) => {
            const question = structuredClone(definition.question);
            const suggestion = suggestions?.suggestions.find(
              (entry) => entry.field === question.questionId,
            );
            if (!suggestion) return question;
            return {
              ...question,
              valueSemantics: 'suggestion' as const,
              suggestedValue: suggestion.value,
              suggestionReason: [
                `Draft from ${suggestion.citation.location}`,
                `${suggestion.confidence} confidence`,
                `evidence ${suggestion.citation.digest}`,
                `rules ${suggestion.engineVersion}`,
              ].join('; '),
            };
          }),
      };
    }
  }
  return {
    status: 'preview-ready',
    stage: 'review',
    answers,
    questions: definitions
      .filter((definition) => definition.stage === 'review')
      .map((definition) => structuredClone(definition.question)),
  };
}

export function applyOperatingInitAnswer(
  answers: OperatingInitAnswers,
  context: OperatingQuestionContext,
  questionId: string,
  value: GuidedQuestionValue,
): OperatingInitAnswers {
  const definition = operatingInitQuestionRegistry(context).find(
    (candidate) => candidate.question.questionId === questionId,
  );
  if (!definition) {
    throw new OperateError(
      'E_OPERATE_QUESTIONNAIRE_INVALID',
      `Unknown Operating Board question: ${questionId}.`,
    );
  }
  return definition.write(answers, normalizeValue(definition.question, value));
}

export async function createOperatingInitQuestionnaire(input: {
  context: OperatingQuestionEngineContext;
  questions: GuidedQuestion[];
  stage: 'foundation' | 'product-charter' | 'review';
  sessionId?: string;
  createdAt?: string;
  expiresAt?: string;
}): Promise<GuidedQuestionnaire> {
  const createdAt = input.createdAt ?? input.context.now ?? new Date().toISOString();
  const expiresAt =
    input.expiresAt ?? new Date(new Date(createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const projectIdentity =
    input.context.projectIdentity ??
    canonicalDigest({
      projectRoot: path.resolve(input.context.projectRoot),
    });
  const projectHead = input.context.projectHead ?? canonicalDigest({ projectIdentity });
  const configHead = input.context.configHead ?? canonicalDigest({ config: null });
  const seed = {
    command: 'operate.init',
    projectIdentity,
    projectHead,
    configHead,
    stage: input.stage,
    questions: input.questions,
    createdAt,
    expiresAt,
  };
  const sessionId =
    input.sessionId ??
    `GIS-${canonicalDigest(seed).slice('sha256:'.length, 'sha256:'.length + 24)}`;
  const questionnaireBase = {
    kind: 'guided-questionnaire' as const,
    schemaVersion: '1.1.0' as const,
    protocolVersion: '1.2.0' as const,
    sessionId,
    questionnaireVersion: '1.0.0' as const,
    command: 'operate.init' as const,
    projectIdentity,
    projectHead,
    configHead,
    adapter: {
      runtime: input.context.runtime ?? 'unknown',
      version: 'detected',
      interaction: input.context.interaction ?? 'none',
    },
    stage: input.stage,
    step: STAGES.indexOf(input.stage) + 1,
    totalSteps: 3 as const,
    title: 'Configure the Operating Board',
    description:
      input.stage === 'review'
        ? 'Review exact writes and boundaries before applying initialization.'
        : 'Answer only the governance questions in this stage.',
    questions: input.questions,
    createdAt,
    expiresAt,
  };
  let validators: Awaited<ReturnType<typeof resolveGuidedInteractionValidators>>;
  try {
    validators = await resolveGuidedInteractionValidators();
  } catch (error) {
    throw new OperateError(
      error instanceof Error && error.name === 'E_PIPELINE_NOT_INSTALLED'
        ? 'E_PIPELINE_NOT_INSTALLED'
        : 'E_PIPELINE_VERSION_INCOMPATIBLE',
      error instanceof Error ? error.message : 'Compatible guided validators are unavailable.',
    );
  }
  const withoutDigest = {
    ...questionnaireBase,
    submission: validators.createGuidedAnswerSubmission(questionnaireBase),
  };
  const questionnaire: GuidedQuestionnaire = {
    ...withoutDigest,
    digest: canonicalDigest(withoutDigest),
  };
  const errors = validators.validateGuidedQuestionnaire(questionnaire);
  if (errors.length > 0) {
    throw new OperateError(
      'E_OPERATE_QUESTIONNAIRE_INVALID',
      'The generated Operating Board questionnaire did not satisfy Protocol v1.2.',
      { validationErrors: errors },
    );
  }
  return questionnaire;
}
