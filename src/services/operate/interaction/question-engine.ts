import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveGuidedInteractionValidators } from '../../pipeline-package-service.js';
import { canonicalDigest } from '../canonical.js';
import { classifyLegacyOperatingProfile } from '../profile-migration.js';
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
  repeatedTextRenderability,
} from './question-registry.js';

const OPERATE_PROFILE_IDS: readonly NonNullable<OperatingInitAnswers['profile']>[] = [
  'saas',
  'product',
  'engineering',
  'custom',
];
const MAX_PROFILE_FILE_BYTES = 64 * 1024;

/**
 * Probe an existing `.planr/operate-profile.json` for its `id` so the profile
 * question can surface it as the suggested answer (finding 9). Fails safe: a
 * missing, oversized, malformed, or unrecognized profile file yields no
 * suggestion instead of throwing, so onboarding never breaks on a bad file.
 *
 * FR10 / T-009: the `id` is compatible and is still suggested, but the same file
 * may carry `enabledProviders`/`budgets` (or other) values the CLI would reject.
 * Those unsupported field names are returned alongside the id so the profile
 * question can name them explicitly instead of silently suggesting a profile the
 * tool will refuse.
 */
async function existingOperatingProfile(
  projectRoot?: string,
): Promise<
  { id: NonNullable<OperatingInitAnswers['profile']>; unsupportedFields: string[] } | undefined
> {
  if (!projectRoot) return undefined;
  const target = path.join(projectRoot, '.planr', 'operate-profile.json');
  const raw = await readFile(target, 'utf8').catch(() => undefined);
  if (raw === undefined || Buffer.byteLength(raw, 'utf8') > MAX_PROFILE_FILE_BYTES) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const id = (parsed as { id?: unknown }).id;
  if (typeof id !== 'string' || !(OPERATE_PROFILE_IDS as readonly string[]).includes(id)) {
    return undefined;
  }
  let unsupportedFields: string[] = [];
  try {
    unsupportedFields = classifyLegacyOperatingProfile(parsed as Record<string, unknown>)
      .unsupported.map((entry) => entry.field)
      .filter((field) => field !== 'id');
  } catch {
    unsupportedFields = [];
  }
  return { id: id as NonNullable<OperatingInitAnswers['profile']>, unsupportedFields };
}

/**
 * Enrich the engine context with the existing-profile suggestion once, so the
 * registry the create/resume/terminal paths all build carries the detect-don't-
 * ask profile answer. An explicit `existingProfileId` already on the context is
 * respected and not re-probed. When the detected profile carries unsupported
 * field values, those field names ride along so the suggestion can disclose them.
 */
async function withDetectedSuggestions(
  context: OperatingQuestionEngineContext,
): Promise<OperatingQuestionEngineContext> {
  if (context.existingProfileId !== undefined) return context;
  const detected = await existingOperatingProfile(context.projectRoot);
  if (!detected) return context;
  return {
    ...context,
    existingProfileId: detected.id,
    ...(detected.unsupportedFields.length > 0
      ? { existingProfileUnsupportedFields: detected.unsupportedFields }
      : {}),
  };
}

/**
 * Attach OpenPlanr presentation metadata to a Protocol-valid questionnaire after
 * validation: per-item renderability on `repeated-text` questions and the
 * `--answers-file` stdin-parity transport alternate. Both ride alongside the
 * frozen v1.2 artifact (whose schema forbids these fields) and are excluded from
 * the digest, which stays bound to the schema-valid answer contract.
 */
function decorateGuidedPresentation(questionnaire: GuidedQuestionnaire): GuidedQuestionnaire {
  return {
    ...questionnaire,
    questions: questionnaire.questions.map((question) => {
      if (question.type !== 'repeated-text') return question;
      const renderability = repeatedTextRenderability(question.questionId);
      return renderability
        ? {
            ...question,
            itemLabel: renderability.itemLabel,
            itemPlaceholder: renderability.itemPlaceholder,
          }
        : question;
    }),
    submission: {
      ...questionnaire.submission,
      transport: {
        ...questionnaire.submission.transport,
        alternates: [
          {
            kind: 'answers-file',
            mediaType: 'application/json',
            encoding: 'utf-8',
            maxBytes: 65536,
            argv: [
              'planr',
              'operate',
              'init',
              '--resume',
              questionnaire.sessionId,
              '--answers-file',
              '<path>',
              '--json',
            ],
          },
        ],
      },
    },
  };
}

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

/** Exported for the bounded-validation tests; the engine calls it internally. */
export function normalizeGuidedAnswerValue(
  question: GuidedQuestion,
  value: GuidedQuestionValue,
): GuidedQuestionValue {
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

  // An OPTIONAL question left empty is absent, not invalid. Lower bounds describe
  // what a supplied answer must contain; applying them to an empty optional answer
  // rejects the questionnaire on a field the author was never asked to fill.
  //
  // This is not hypothetical: a first `operate init` on a clean project failed its
  // write-free preview with "Known unknowns does not satisfy its bounded validation
  // rules" — a question declared `required: false` whose own contract says it never
  // blocks the preview. There was no way to satisfy it from the questionnaire,
  // because the questionnaire never surfaced it.
  const supplied = itemCount !== undefined ? itemCount > 0 : (length ?? 0) > 0;
  if (!question.required && !supplied) return normalized;

  const violations: string[] = [];
  if (length !== undefined) {
    const { minLength, maxLength } = question.validation ?? {};
    if (minLength !== undefined && length < minLength) {
      violations.push(`needs at least ${minLength} character(s), received ${length}`);
    }
    if (maxLength !== undefined && length > maxLength) {
      violations.push(`allows at most ${maxLength} character(s), received ${length}`);
    }
  }
  if (itemCount !== undefined) {
    const { minItems, maxItems } = question.validation ?? {};
    if (minItems !== undefined && itemCount < minItems) {
      violations.push(`needs at least ${minItems} item(s), received ${itemCount}`);
    }
    if (maxItems !== undefined && itemCount > maxItems) {
      violations.push(`allows at most ${maxItems} item(s), received ${itemCount}`);
    }
  }
  if (violations.length) {
    // State the rule and the received value. The previous message named only the
    // field, leaving an author to guess which bound was missed and by how much.
    throw new OperateError(
      'E_OPERATE_QUESTIONNAIRE_INVALID',
      `${question.label} does not satisfy its bounded validation rules: ${violations.join('; ')}.`,
    );
  }
  return normalized;
}

function validateSemanticAnswers(answers: OperatingInitAnswers): void {
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
}

export async function evaluateOperatingInitQuestions(input: {
  answers?: OperatingInitAnswers;
  context: OperatingQuestionEngineContext;
  requireCharter?: boolean;
}): Promise<OperatingQuestionEngineResult> {
  const context = await withDetectedSuggestions(input.context);
  const definitions = operatingInitQuestionRegistry(context);
  let answers = structuredClone(input.answers ?? {});
  for (const definition of definitions) {
    const current = definition.read(answers);
    if (current !== undefined && answered(current)) {
      answers = definition.write(answers, normalizeGuidedAnswerValue(definition.question, current));
    }
  }
  validateSemanticAnswers(answers);
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
          ? await buildOperatingCharterSuggestions({ projectRoot: context.projectRoot })
          : null;
      // Ship the required-missing questions plus the explicitly flagged ones — the
      // unanswered questions that carry a suggestion the human should confirm
      // (e.g. a detected runtime). Optional, defaulted, or 'none' questions
      // (cadence, component-roots, known-unknowns) are intentionally NOT dumped
      // into the first-run batch just because they are unanswered and visible.
      const toAsk = visible.filter(
        (definition) =>
          definition.question.type !== 'informational' &&
          !answered(definition.read(answers)) &&
          (definition.question.required || definition.question.valueSemantics === 'suggestion'),
      );
      return {
        status: 'input-required',
        stage: stage as 'foundation' | 'product-charter',
        answers,
        questions: toAsk.map((definition) => {
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
  return definition.write(answers, normalizeGuidedAnswerValue(definition.question, value));
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
  // The digest above binds the schema-valid answer contract. Presentation
  // metadata (repeated-text renderability, the --answers-file transport
  // alternate) is attached only now, after validation, so it never reaches the
  // frozen v1.2 schema and never perturbs the digest a resume recomputes.
  return decorateGuidedPresentation(questionnaire);
}
