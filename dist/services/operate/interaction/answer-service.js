import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveGuidedInteractionValidators, resolvePipelinePackage, } from '../../pipeline-package-service.js';
import { canonicalDigest } from '../canonical.js';
import { parseStrictJson } from '../evidence-import.js';
import { OperateError, } from '../types.js';
import { resolveOperatingPaths } from '../workspace.js';
import { applyOperatingInitAnswer, createOperatingInitQuestionnaire, evaluateOperatingInitQuestions, } from './question-engine.js';
import { operatingInitQuestionRegistry } from './question-registry.js';
import { GUIDED_ANSWER_MAX_BYTES, guidedSessionState, readGuidedSession, updateGuidedSession, } from './session-service.js';
const MAX_ANSWER_SCALARS = 256;
const MAX_ANSWER_DEPTH = 12;
const execFileAsync = promisify(execFile);
/**
 * The configured Git user name, used as the `decision-owner` suggestion. Shared
 * so the JSON/native init path and the terminal path make the same probe.
 */
export async function probeGitUserName(projectRoot) {
    return execFileAsync('git', ['config', 'user.name'], { cwd: projectRoot })
        .then(({ stdout }) => stdout.trim() || undefined)
        .catch(() => undefined);
}
/** Whether a compatible planr-pipeline is resolvable (drives planning-engine detection). */
export function probePipelineInstalled() {
    return resolvePipelinePackage(false) !== null;
}
async function interactionContext(projectRoot, session, bindings, now) {
    const gitUserName = await probeGitUserName(projectRoot);
    return {
        projectRoot,
        ...bindings,
        ...(gitUserName ? { gitUserName } : {}),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        pipelineInstalled: probePipelineInstalled(),
        // The registry rehydrates the effective detected runtime from `runtime`, so
        // detect-don't-ask stays byte-identical between create and this resume path.
        runtime: session.adapter.runtime,
        interaction: session.adapter.interaction,
        now: now.toISOString(),
    };
}
export function persistableOperatingInitAnswers(answers, context) {
    return operatingInitQuestionRegistry(context).flatMap((definition) => {
        const value = definition.read(answers);
        if (value === undefined ||
            definition.question.persistence !== 'session' ||
            definition.question.sensitivity === 'sensitive' ||
            definition.question.type === 'secret') {
            return [];
        }
        return [
            {
                questionId: definition.question.questionId,
                questionVersion: definition.question.questionVersion,
                sensitivity: definition.question.sensitivity,
                value: structuredClone(value),
            },
        ];
    });
}
function answersFromSession(session, context) {
    let answers = {};
    for (const answer of session.persistedAnswers) {
        answers = applyOperatingInitAnswer(answers, context, answer.questionId, answer.value);
    }
    return answers;
}
async function validateAnswerEnvelope(envelope) {
    let validators;
    try {
        validators = await resolveGuidedInteractionValidators();
    }
    catch (error) {
        throw new OperateError(error instanceof Error && error.name === 'E_PIPELINE_NOT_INSTALLED'
            ? 'E_PIPELINE_NOT_INSTALLED'
            : 'E_PIPELINE_VERSION_INCOMPATIBLE', error instanceof Error ? error.message : 'Guided answer validators are unavailable.');
    }
    if (validators.validateGuidedAnswerEnvelope(envelope).length > 0) {
        throw new OperateError('E_OPERATE_SESSION_INVALID', 'Guided answer envelope failed Protocol v1.2 validation.', { state: 'invalid', recoveryCommand: 'planr operate init --json' });
    }
}
export async function parseGuidedAnswerEnvelope(raw) {
    if (Buffer.byteLength(raw, 'utf8') > GUIDED_ANSWER_MAX_BYTES ||
        raw.includes('\0') ||
        raw.includes('\ufffd')) {
        throw new OperateError('E_OPERATE_INPUT_TOO_LARGE', `Guided answer stdin must be valid UTF-8 and at most ${GUIDED_ANSWER_MAX_BYTES} bytes.`);
    }
    let parsed;
    try {
        parsed = parseStrictJson(raw, {
            maxBytes: GUIDED_ANSWER_MAX_BYTES,
            maxDepth: MAX_ANSWER_DEPTH,
            maxScalars: MAX_ANSWER_SCALARS,
            maxStringLength: 4096,
        });
    }
    catch (error) {
        if (error instanceof OperateError && error.code === 'E_OPERATE_INPUT_TOO_LARGE')
            throw error;
        throw new OperateError('E_OPERATE_SESSION_INVALID', 'Guided answer stdin is not a bounded valid answer envelope.', { state: 'invalid', recoveryCommand: 'planr operate init --json' });
    }
    await validateAnswerEnvelope(parsed);
    if (new Set(parsed.answers.map((answer) => answer.questionId)).size !== parsed.answers.length) {
        throw new OperateError('E_OPERATE_SESSION_INVALID', 'Guided answer envelope contains duplicate question IDs.');
    }
    return parsed;
}
function assertEnvelopeBinding(envelope, session, bindings) {
    if (envelope.sessionId !== session.sessionId ||
        envelope.command !== session.command ||
        envelope.questionnaireVersion !== session.questionnaireVersion ||
        envelope.projectIdentity !== bindings.projectIdentity ||
        envelope.projectHead !== bindings.projectHead ||
        envelope.configHead !== bindings.configHead ||
        canonicalDigest(envelope.adapter) !== canonicalDigest(session.adapter)) {
        throw new OperateError('E_OPERATE_SESSION_STALE', 'Guided answer envelope does not match this session and project head.', { state: 'stale', recoveryCommand: 'planr operate init --json' });
    }
}
/** A guided session accepts answer revisions until its preview is confirmed. */
function sessionAcceptsRevisions(state) {
    return state !== 'confirmed' && state !== 'applied';
}
/**
 * Classify one submitted answer against the active questionnaire and the answers
 * already accepted. `'new'` is a first answer to a question in the current stage,
 * `'duplicate'` is an idempotent re-submission of the same value, and `'revised'`
 * is a differing value for a previously-accepted answer while the session is
 * still editable — the per-question rollback that lets an operator correct one
 * answer without restarting init. A differing re-answer after confirm/apply, or
 * an answer that names no known question, stays a replay conflict.
 */
function classifyAnswer(input) {
    const { answer, activeQuestions, knownQuestions, persisted, revisable, sessionId } = input;
    const known = knownQuestions.find((candidate) => candidate.questionId === answer.questionId);
    const prior = persisted.get(answer.questionId);
    if (!known) {
        if (prior !== undefined && canonicalDigest(prior) === canonicalDigest(answer.value)) {
            return 'duplicate';
        }
        throw new OperateError('E_OPERATE_SESSION_REPLAY_CONFLICT', `Answer does not belong to the active questionnaire: ${answer.questionId}.`);
    }
    if (answer.questionVersion !== known.questionVersion ||
        answer.sensitivity !== known.sensitivity) {
        throw new OperateError('E_OPERATE_SESSION_INVALID', `Answer metadata does not match question ${answer.questionId}.`);
    }
    if (prior !== undefined) {
        if (canonicalDigest(prior) === canonicalDigest(answer.value))
            return 'duplicate';
        // A differing value for an already-accepted answer, submitted before the
        // preview is confirmed, is a legitimate revision: accept the overwrite. After
        // confirm/apply the answer set is locked, so it stays a replay conflict —
        // which now names this exact session's resume command, not a dead-end init.
        if (revisable)
            return 'revised';
        throw new OperateError('E_OPERATE_SESSION_REPLAY_CONFLICT', `Answer replay conflicts with the accepted value for ${answer.questionId}.`, {
            state: 'awaiting-input',
            sessionId,
            recoveryCommand: `planr operate init --resume ${sessionId} --json`,
        });
    }
    // A brand-new answer must target a question the active questionnaire is asking.
    if (!activeQuestions.some((candidate) => candidate.questionId === answer.questionId)) {
        throw new OperateError('E_OPERATE_SESSION_REPLAY_CONFLICT', `Answer does not belong to the active questionnaire: ${answer.questionId}.`);
    }
    return 'new';
}
async function questionnaireFor(projectRoot, session, answers, bindings, now) {
    const context = await interactionContext(projectRoot, session, bindings, now);
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
export async function resumeGuidedSession(input) {
    const now = input.now ?? new Date();
    const session = await readGuidedSession({ ...input, now });
    const context = await interactionContext(input.projectRoot, session, input.bindings, now);
    const progress = await questionnaireFor(input.projectRoot, session, answersFromSession(session, context), input.bindings, now);
    if (progress.questionnaire.digest !== session.questionnaireDigest) {
        const { digest: _currentDigest, submission: _submission, ...currentQuestionnaire } = progress.questionnaire;
        const legacyDigest = canonicalDigest({
            ...currentQuestionnaire,
            schemaVersion: '1.0.0',
        });
        if (legacyDigest !== session.questionnaireDigest) {
            throw new OperateError('E_OPERATE_SESSION_INVALID', 'Guided session questionnaire digest was changed or is incompatible.', { state: 'invalid', recoveryCommand: 'planr operate init --json' });
        }
        const upgraded = guidedSessionState(session, session.state, now, {
            questionnaireDigest: progress.questionnaire.digest,
        });
        await updateGuidedSession({
            projectRoot: input.projectRoot,
            session: upgraded,
            localRoot: input.localRoot,
        });
        return { session: upgraded, ...progress };
    }
    return { session, ...progress };
}
export async function submitGuidedAnswers(input) {
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
    // No wall-clock ordering gate between the envelope's `submittedAt` and the
    // session's `createdAt`/`expiresAt`. A payload prepared before a restart
    // legitimately predates the newly minted session, and rejecting it as
    // "outside the active session lifetime" was the guided-init livelock: the
    // envelope is bound purely on validity — `assertEnvelopeBinding` (session id,
    // command, questionnaire version, project/config head, adapter) plus the
    // questionnaire-digest comparison below. Genuine expiry is still enforced,
    // once, by `readGuidedSession` against the real processing clock.
    if (await hasReplayReceipt({ ...input, envelope })) {
        return current;
    }
    if (envelope.questionnaireDigest !== current.questionnaire.digest) {
        throw new OperateError('E_OPERATE_SESSION_REPLAY_CONFLICT', 'Answer envelope targets an older or different questionnaire digest.', {
            state: current.session.state,
            recoveryCommand: `planr operate init --resume ${current.session.sessionId} --json`,
        });
    }
    const context = await interactionContext(input.projectRoot, current.session, input.bindings, now);
    const persisted = new Map(current.session.persistedAnswers.map((answer) => [answer.questionId, answer.value]));
    const knownQuestions = operatingInitQuestionRegistry(context).map((definition) => definition.question);
    const revisable = sessionAcceptsRevisions(current.session.state);
    let answers = current.answers;
    let revised = false;
    for (const answer of envelope.answers) {
        const disposition = classifyAnswer({
            answer,
            activeQuestions: current.questionnaire.questions,
            knownQuestions,
            persisted,
            revisable,
            sessionId: current.session.sessionId,
        });
        if (disposition === 'duplicate')
            continue;
        if (disposition === 'revised')
            revised = true;
        answers = applyOperatingInitAnswer(answers, context, answer.questionId, answer.value);
    }
    const next = await questionnaireFor(input.projectRoot, current.session, answers, input.bindings, now);
    const persistedAnswers = persistableOperatingInitAnswers(next.answers, context).filter((answer) => answer.sensitivity !== 'sensitive');
    const updated = guidedSessionState(current.session, 
    // The CLI prepares the canonical preview and sets preview-ready together
    // with its required digest. Until that write-free preparation completes,
    // the persisted Protocol session remains awaiting-input — the schema-valid
    // resting state, including after a revision (Protocol v1.2's guided-session
    // schema does not carry `revising`, so it is never written to disk).
    'awaiting-input', now, {
        questionnaireDigest: next.questionnaire.digest,
        persistedAnswers,
    });
    await updateGuidedSession({
        projectRoot: input.projectRoot,
        session: updated,
        localRoot: input.localRoot,
    });
    await persistReplayReceipt({ ...input, envelope });
    // Surface the transient `revising` state on the returned session (never
    // persisted) when a previously-accepted answer was overwritten, so the caller
    // can report the per-question rollback without a restart.
    return { session: revised ? { ...updated, state: 'revising' } : updated, ...next };
}
async function replayReceiptPath(input) {
    const directory = resolveOperatingPaths(input.projectRoot, {
        localRoot: input.localRoot,
    }).sessions;
    return path.join(directory, `${input.sessionId}.replays`);
}
async function hasReplayReceipt(input) {
    if (input.envelope.answers.some((answer) => answer.sensitivity === 'sensitive'))
        return false;
    const digest = canonicalDigest(input.envelope);
    return readFile(await replayReceiptPath(input), 'utf8').then((raw) => raw.split('\n').includes(digest), () => false);
}
export async function persistReplayReceipt(input) {
    if (input.envelope.answers.some((answer) => answer.sensitivity === 'sensitive'))
        return;
    const directory = resolveOperatingPaths(input.projectRoot, {
        localRoot: input.localRoot,
    }).sessions;
    const target = await replayReceiptPath(input);
    const digest = canonicalDigest(input.envelope);
    const previous = await readFile(target, 'utf8')
        .then((raw) => raw.split('\n').filter(Boolean))
        .catch(() => []);
    if (previous.includes(digest))
        return;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${[...previous, digest].slice(-100).join('\n')}\n`, {
        mode: 0o600,
    });
    await rename(temporary, target);
}
//# sourceMappingURL=answer-service.js.map