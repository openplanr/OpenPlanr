import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveGuidedInteractionValidators } from '../../pipeline-package-service.js';
import { canonicalDigest } from '../canonical.js';
import { parseStrictJson } from '../evidence-import.js';
import {
  type GuidedAnswer,
  type GuidedAnswerEnvelope,
  type GuidedQuestion,
  type GuidedQuestionValue,
  type GuidedSession,
  OperateError,
  type OperatingInitAnswers,
} from '../types.js';
import { resolveOperatingPaths } from '../workspace.js';
import {
  applyOperatingInitAnswer,
  createOperatingInitQuestionnaire,
  evaluateOperatingInitQuestions,
  type OperatingQuestionEngineContext,
} from './question-engine.js';
import { operatingInitQuestionRegistry } from './question-registry.js';
import {
  GUIDED_ANSWER_MAX_BYTES,
  type GuidedSessionBindings,
  guidedSessionState,
  readGuidedSession,
  updateGuidedSession,
} from './session-service.js';

const MAX_ANSWER_SCALARS = 256;
const MAX_ANSWER_DEPTH = 12;

export interface GuidedSessionProgress {
  session: GuidedSession;
  questionnaire: Awaited<ReturnType<typeof createOperatingInitQuestionnaire>>;
  answers: OperatingInitAnswers;
  status: 'input-required' | 'preview-ready';
}

function interactionContext(
  projectRoot: string,
  session: GuidedSession,
  bindings: GuidedSessionBindings,
  now: Date,
): OperatingQuestionEngineContext {
  return {
    projectRoot,
    ...bindings,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    availableSources: ['repository', 'planr', 'git', 'file-import'],
    runtime: session.adapter.runtime,
    interaction: session.adapter.interaction,
    now: now.toISOString(),
  };
}

export function persistableOperatingInitAnswers(
  answers: OperatingInitAnswers,
  context: OperatingQuestionEngineContext,
): GuidedAnswer[] {
  return operatingInitQuestionRegistry(context).flatMap((definition) => {
    const value = definition.read(answers);
    if (
      value === undefined ||
      definition.question.persistence !== 'session' ||
      definition.question.sensitivity === 'sensitive' ||
      definition.question.type === 'secret'
    ) {
      return [];
    }
    return [
      {
        questionId: definition.question.questionId,
        questionVersion: definition.question.questionVersion,
        sensitivity: definition.question.sensitivity,
        value: structuredClone(value),
      } satisfies GuidedAnswer,
    ];
  });
}

function answersFromSession(
  session: GuidedSession,
  context: OperatingQuestionEngineContext,
): OperatingInitAnswers {
  let answers: OperatingInitAnswers = {};
  for (const answer of session.persistedAnswers) {
    answers = applyOperatingInitAnswer(answers, context, answer.questionId, answer.value);
  }
  return answers;
}

async function validateAnswerEnvelope(envelope: GuidedAnswerEnvelope): Promise<void> {
  let validators: Awaited<ReturnType<typeof resolveGuidedInteractionValidators>>;
  try {
    validators = await resolveGuidedInteractionValidators();
  } catch (error) {
    throw new OperateError(
      error instanceof Error && error.name === 'E_PIPELINE_NOT_INSTALLED'
        ? 'E_PIPELINE_NOT_INSTALLED'
        : 'E_PIPELINE_VERSION_INCOMPATIBLE',
      error instanceof Error ? error.message : 'Guided answer validators are unavailable.',
    );
  }
  if (validators.validateGuidedAnswerEnvelope(envelope).length > 0) {
    throw new OperateError(
      'E_OPERATE_SESSION_INVALID',
      'Guided answer envelope failed Protocol v1.2 validation.',
      { state: 'invalid', recoveryCommand: 'planr operate init --json' },
    );
  }
}

export async function parseGuidedAnswerEnvelope(raw: string): Promise<GuidedAnswerEnvelope> {
  if (
    Buffer.byteLength(raw, 'utf8') > GUIDED_ANSWER_MAX_BYTES ||
    raw.includes('\0') ||
    raw.includes('\ufffd')
  ) {
    throw new OperateError(
      'E_OPERATE_INPUT_TOO_LARGE',
      `Guided answer stdin must be valid UTF-8 and at most ${GUIDED_ANSWER_MAX_BYTES} bytes.`,
    );
  }
  let parsed: GuidedAnswerEnvelope;
  try {
    parsed = parseStrictJson(raw, {
      maxBytes: GUIDED_ANSWER_MAX_BYTES,
      maxDepth: MAX_ANSWER_DEPTH,
      maxScalars: MAX_ANSWER_SCALARS,
      maxStringLength: 4096,
    }) as GuidedAnswerEnvelope;
  } catch (error) {
    if (error instanceof OperateError && error.code === 'E_OPERATE_INPUT_TOO_LARGE') throw error;
    throw new OperateError(
      'E_OPERATE_SESSION_INVALID',
      'Guided answer stdin is not a bounded valid answer envelope.',
      { state: 'invalid', recoveryCommand: 'planr operate init --json' },
    );
  }
  await validateAnswerEnvelope(parsed);
  if (new Set(parsed.answers.map((answer) => answer.questionId)).size !== parsed.answers.length) {
    throw new OperateError(
      'E_OPERATE_SESSION_INVALID',
      'Guided answer envelope contains duplicate question IDs.',
    );
  }
  return parsed;
}

function assertEnvelopeBinding(
  envelope: GuidedAnswerEnvelope,
  session: GuidedSession,
  bindings: GuidedSessionBindings,
): void {
  if (
    envelope.sessionId !== session.sessionId ||
    envelope.command !== session.command ||
    envelope.questionnaireVersion !== session.questionnaireVersion ||
    envelope.projectIdentity !== bindings.projectIdentity ||
    envelope.projectHead !== bindings.projectHead ||
    envelope.configHead !== bindings.configHead ||
    canonicalDigest(envelope.adapter) !== canonicalDigest(session.adapter)
  ) {
    throw new OperateError(
      'E_OPERATE_SESSION_STALE',
      'Guided answer envelope does not match this session and project head.',
      { state: 'stale', recoveryCommand: 'planr operate init --json' },
    );
  }
}

function assertAnswer(
  answer: GuidedAnswer,
  questions: GuidedQuestion[],
  persisted: Map<string, GuidedQuestionValue>,
): 'new' | 'duplicate' {
  const question = questions.find((candidate) => candidate.questionId === answer.questionId);
  const prior = persisted.get(answer.questionId);
  if (!question) {
    if (prior !== undefined && canonicalDigest(prior) === canonicalDigest(answer.value)) {
      return 'duplicate';
    }
    throw new OperateError(
      'E_OPERATE_SESSION_REPLAY_CONFLICT',
      `Answer does not belong to the active questionnaire: ${answer.questionId}.`,
    );
  }
  if (
    answer.questionVersion !== question.questionVersion ||
    answer.sensitivity !== question.sensitivity
  ) {
    throw new OperateError(
      'E_OPERATE_SESSION_INVALID',
      `Answer metadata does not match question ${answer.questionId}.`,
    );
  }
  if (prior !== undefined) {
    if (canonicalDigest(prior) === canonicalDigest(answer.value)) return 'duplicate';
    throw new OperateError(
      'E_OPERATE_SESSION_REPLAY_CONFLICT',
      `Answer replay conflicts with the accepted value for ${answer.questionId}.`,
      {
        state: sessionStateForConflict(),
        recoveryCommand: 'planr operate init --resume <session-id> --json',
      },
    );
  }
  return 'new';
}

function sessionStateForConflict(): 'awaiting-input' {
  return 'awaiting-input';
}

async function questionnaireFor(
  projectRoot: string,
  session: GuidedSession,
  answers: OperatingInitAnswers,
  bindings: GuidedSessionBindings,
  now: Date,
): Promise<{
  answers: OperatingInitAnswers;
  questionnaire: GuidedSessionProgress['questionnaire'];
  status: GuidedSessionProgress['status'];
}> {
  const context = interactionContext(projectRoot, session, bindings, now);
  const state = await evaluateOperatingInitQuestions({
    answers,
    context,
    requireCharter: true,
  });
  const questionnaire = await createOperatingInitQuestionnaire({
    context,
    questions: state.questions,
    stage: state.stage,
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  });
  return { answers: state.answers, questionnaire, status: state.status };
}

export async function resumeGuidedSession(input: {
  projectRoot: string;
  sessionId: string;
  bindings: GuidedSessionBindings;
  localRoot?: string;
  now?: Date;
}): Promise<GuidedSessionProgress> {
  const now = input.now ?? new Date();
  const session = await readGuidedSession({ ...input, now });
  const context = interactionContext(input.projectRoot, session, input.bindings, now);
  const progress = await questionnaireFor(
    input.projectRoot,
    session,
    answersFromSession(session, context),
    input.bindings,
    now,
  );
  if (progress.questionnaire.digest !== session.questionnaireDigest) {
    throw new OperateError(
      'E_OPERATE_SESSION_INVALID',
      'Guided session questionnaire digest was changed or is incompatible.',
      { state: 'invalid', recoveryCommand: 'planr operate init --json' },
    );
  }
  return { session, ...progress };
}

export async function submitGuidedAnswers(input: {
  projectRoot: string;
  sessionId: string;
  raw: string;
  bindings: GuidedSessionBindings;
  localRoot?: string;
  now?: Date;
}): Promise<GuidedSessionProgress> {
  const envelope = await parseGuidedAnswerEnvelope(input.raw);
  const now = input.now ?? new Date();
  const current = await resumeGuidedSession({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    bindings: input.bindings,
    localRoot: input.localRoot,
    now,
  });
  assertEnvelopeBinding(envelope, current.session, input.bindings);
  const submittedAt = Date.parse(envelope.submittedAt);
  if (
    !Number.isFinite(submittedAt) ||
    submittedAt < Date.parse(current.session.createdAt) ||
    submittedAt >= Date.parse(current.session.expiresAt)
  ) {
    throw new OperateError(
      'E_OPERATE_SESSION_EXPIRED',
      'Guided answer was submitted outside the active session lifetime.',
      { state: 'expired', recoveryCommand: 'planr operate init --json' },
    );
  }
  if (await hasReplayReceipt({ ...input, envelope })) {
    return current;
  }
  if (envelope.questionnaireDigest !== current.questionnaire.digest) {
    throw new OperateError(
      'E_OPERATE_SESSION_REPLAY_CONFLICT',
      'Answer envelope targets an older or different questionnaire digest.',
      {
        state: current.session.state,
        recoveryCommand: `planr operate init --resume ${current.session.sessionId} --json`,
      },
    );
  }
  const context = interactionContext(input.projectRoot, current.session, input.bindings, now);
  const persisted = new Map(
    current.session.persistedAnswers.map((answer) => [answer.questionId, answer.value]),
  );
  let answers = current.answers;
  for (const answer of envelope.answers) {
    if (assertAnswer(answer, current.questionnaire.questions, persisted) === 'duplicate') continue;
    answers = applyOperatingInitAnswer(answers, context, answer.questionId, answer.value);
  }
  const next = await questionnaireFor(
    input.projectRoot,
    current.session,
    answers,
    input.bindings,
    now,
  );
  const persistedAnswers = persistableOperatingInitAnswers(next.answers, context).filter(
    (
      answer,
    ): answer is GuidedAnswer & {
      sensitivity: 'public' | 'internal';
    } => answer.sensitivity !== 'sensitive',
  );
  const updated = guidedSessionState(
    current.session,
    // The CLI prepares the canonical preview and sets preview-ready together
    // with its required digest. Until that write-free preparation completes,
    // the persisted Protocol session remains awaiting-input.
    'awaiting-input',
    now,
    {
      questionnaireDigest: next.questionnaire.digest,
      persistedAnswers,
    },
  );
  await updateGuidedSession({
    projectRoot: input.projectRoot,
    session: updated,
    localRoot: input.localRoot,
  });
  await persistReplayReceipt({ ...input, envelope });
  return { session: updated, ...next };
}

async function replayReceiptPath(input: {
  projectRoot: string;
  sessionId: string;
  localRoot?: string;
}): Promise<string> {
  const directory = resolveOperatingPaths(input.projectRoot, {
    localRoot: input.localRoot,
  }).sessions;
  return path.join(directory, `${input.sessionId}.replays`);
}

async function hasReplayReceipt(input: {
  projectRoot: string;
  sessionId: string;
  envelope: GuidedAnswerEnvelope;
  localRoot?: string;
}): Promise<boolean> {
  if (input.envelope.answers.some((answer) => answer.sensitivity === 'sensitive')) return false;
  const digest = canonicalDigest(input.envelope);
  return readFile(await replayReceiptPath(input), 'utf8').then(
    (raw) => raw.split('\n').includes(digest),
    () => false,
  );
}

export async function persistReplayReceipt(input: {
  projectRoot: string;
  sessionId: string;
  envelope: GuidedAnswerEnvelope;
  localRoot?: string;
}): Promise<void> {
  if (input.envelope.answers.some((answer) => answer.sensitivity === 'sensitive')) return;
  const directory = resolveOperatingPaths(input.projectRoot, {
    localRoot: input.localRoot,
  }).sessions;
  const target = await replayReceiptPath(input);
  const digest = canonicalDigest(input.envelope);
  const previous: string[] = await readFile(target, 'utf8')
    .then((raw) => raw.split('\n').filter(Boolean))
    .catch((): string[] => []);
  if (previous.includes(digest)) return;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${[...previous, digest].slice(-100).join('\n')}\n`, {
    mode: 0o600,
  });
  await rename(temporary, target);
}
