// Dispatch and continue one exact native session; the CLI owns its implementation loop.

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { AdapterError } from './adapters/generic.mjs';
import { safeAdapterDetails, safeNativeDiagnostic } from './adapters/native.mjs';
import {
  blocked,
  boundedText,
  DelegateRunError,
  hardLimit,
  resultShape,
  sessionId,
  timeout,
} from './run-contract.mjs';
import { recoverOwnedProcesses } from './run-lifecycle.mjs';
import { capsuleIntegrity, eligible } from './run-preflight.mjs';
import {
  defaultRunDirectory,
  processIdentity,
  readRunRecord,
  updateRunRecord,
  withRunTransitionLock,
} from './run-record.mjs';

const SAFE_ADAPTER_DIAGNOSTICS = Object.freeze({
  E_DESTINATION_UNKNOWN:
    'Native routing could not be confirmed. Inspect the displayed sources and prepare a fresh preview before dispatch.',
  E_DESTINATION_CHANGED:
    'Native routing changed. Compare the displayed destinations and prepare a fresh preview before dispatch.',
  E_ADAPTER_BACKEND_UNAVAILABLE:
    'The configured backend could not serve this run; check model availability and endpoint health.',
  E_ADAPTER_CONFIG:
    'Adapter configuration is invalid; inspect the enrolled profile before retrying.',
  E_ADAPTER_CONNECT: 'The enrolled adapter endpoint is unreachable or rejected the request.',
  E_ADAPTER_EXIT:
    'Adapter process exited unsuccessfully; inspect the retained worktree and backend availability.',
  E_ADAPTER_INCOMPATIBLE: 'Adapter output or capabilities do not match the enrolled protocol.',
  E_ADAPTER_LAUNCH: 'The enrolled adapter executable could not start.',
  E_ADAPTER_OUTPUT_LIMIT:
    'Adapter output exceeded its private size limit; inspect the retained worktree.',
  E_ADAPTER_PROCESS_IDENTITY:
    'Process identity inspection is unavailable. Restore normal host process inspection before retrying; native permissions were not changed.',
  E_ADAPTER_PERMISSION:
    'Native permission needs attention. Resolve it in the native configuration, then continue this exact session; permissions are never weakened automatically.',
  E_ADAPTER_RESULT:
    'Native execution ended without terminal evidence; inspect the exact session and retained worktree.',
  E_ADAPTER_MODEL_TEMPLATE:
    'The local backend rejected its chat template. Fix the backend configuration and continue the same session; OpenPlanr does not rewrite messages or templates.',
  E_ADAPTER_AUTHENTICATION:
    'The native CLI reported an authentication failure. Confirm the displayed destination and selected configuration before signing in or continuing this exact session.',
  E_ADAPTER_QUOTA:
    'The native provider reported a quota or rate limit. Retry this exact session when capacity is available.',
  E_ADAPTER_MODEL_UNAVAILABLE:
    'The explicitly selected model is unavailable. Make it available before continuing; no fallback was selected.',
});

const STRUCTURED_RESULT_INSTRUCTIONS = [
  'Your final response must be exactly one valid JSON object, with no Markdown fence or surrounding prose.',
  'Required fields: "status" (exactly "completed", "blocked", or "question") and "summary" (a nonempty string).',
  'Optional fields: "checks" (array of strings) and "issues" (array of strings).',
  'When status is "question", include "question" with a nonempty "text" string and optional "options" array of strings; otherwise omit "question".',
  'Report checks actually run and concrete issues. Do not include "sessionId"; the adapter supplies the backend session identifier.',
].join('\n');

function runPrompt(record) {
  return [
    `Implement the task in the readable private context at ${join(record.runPath, 'capsule', 'readable', 'index.json')}.`,
    'Use the index readingOrder: instructions and requirements, then relevant implementation/tests; optional references are available when needed. Read each required file once from the mirror, using the worktree for edits and additional investigation.',
    `Read ${join(record.runPath, 'capsule', 'readable', 'request.md')} and every required file in that index before editing.`,
    `The integrity-covered capsule is at ${record.capsulePath}; read decoded context files directly with permitted inspection tools; no base64 decoding is needed.`,
    `Edit only the detached worktree at ${record.worktreePath}.`,
    ...(record.integrationScopePaths?.length
      ? [
          `Keep implementation changes within the declared integration boundary: ${record.integrationScopePaths.join(', ')}.`,
        ]
      : []),
    'Do not stage, commit, publish, or deploy. Surface missing decisions and native permission requests to the parent.',
    ...(record.backend === 'generic'
      ? [STRUCTURED_RESULT_INSTRUCTIONS]
      : [
          'Investigate, implement, run relevant builds/tests and correct failures. Return your normal summary of changes, checks and remaining issues.',
        ]),
  ].join('\n');
}

async function boundedCall(call, { signal, timeoutMs, onActivity }) {
  if (signal?.aborted)
    throw new DelegateRunError('E_DELEGATE_CANCELLED', 'Delegate was cancelled.');
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  const deadline = timeout(timeoutMs);
  let expired = false;
  const timer =
    deadline === null
      ? null
      : setTimeout(() => {
          expired = true;
          controller.abort();
        }, deadline);
  try {
    return await call(controller.signal, onActivity);
  } catch (error) {
    if (expired) {
      const deadline = new DelegateRunError(
        'E_DELEGATE_TIMEOUT',
        'The explicit run deadline elapsed.',
      );
      deadline.processTerminationConfirmed = error.processTerminationConfirmed;
      deadline.ownedProcess = error.ownedProcess;
      throw deadline;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

function executionDiagnostic(error) {
  if (
    (error instanceof DelegateRunError && error.code === 'E_DELEGATE_TIMEOUT') ||
    (error instanceof AdapterError && error.code === 'E_ADAPTER_TIMEOUT')
  ) {
    return {
      code: 'E_DELEGATE_TIMEOUT',
      message:
        'Delegate timed out; inspect the retained worktree and exact session before recovery.',
    };
  }
  if (
    (error instanceof DelegateRunError && error.code === 'E_DELEGATE_CANCELLED') ||
    (error instanceof AdapterError && error.code === 'E_ADAPTER_CANCELLED')
  ) {
    return {
      code: 'E_DELEGATE_CANCELLED',
      message: 'Delegate was cancelled; the worktree and run record are retained.',
    };
  }
  if (error instanceof AdapterError && error.code === 'E_ADAPTER_SESSION') {
    return {
      code: 'E_DELEGATE_SESSION',
      message: 'The exact backend session could not resume; inspect the retained worktree.',
    };
  }
  if (error instanceof AdapterError && Object.hasOwn(SAFE_ADAPTER_DIAGNOSTICS, error.code)) {
    return { code: error.code, message: SAFE_ADAPTER_DIAGNOSTICS[error.code] };
  }
  return {
    code: 'E_DELEGATE_PROCESS',
    message: 'Delegate exited or failed before a valid result; inspect its retained worktree.',
  };
}

function eligibilityDiagnostic(error, record) {
  if (error instanceof DelegateRunError)
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  if (error instanceof AdapterError) {
    return {
      code: error.code,
      message:
        SAFE_ADAPTER_DIAGNOSTICS[error.code] ??
        'The selected native configuration or routing could not be verified. Inspect the displayed sources and prepared selection before retrying.',
      details: safeAdapterDetails(error.details, record.destination),
    };
  }
  return {
    code: 'E_DELEGATE_PROFILE',
    message: 'Profile eligibility failed; inspect enrollment and effective destination.',
  };
}

async function execute(record, prepared, options) {
  const startedAt = new Date().toISOString();
  const prior = record.executionTiming ?? { attempts: 0, durationMs: 0 };
  const timing = {
    attempts: prior.attempts + 1,
    durationMs: prior.durationMs,
    last: {
      phase: options.resume ? 'delegate-correction' : 'delegate-execution',
      startedAt,
      status: 'running',
    },
  };
  await updateRunRecord(
    record.runId,
    { executionTiming: timing },
    { directory: options.directory },
  );
  let outcome;
  try {
    outcome = await executeAttempt(record, prepared, options);
    return outcome;
  } finally {
    const finishedAt = new Date().toISOString();
    const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
    timing.durationMs += durationMs;
    timing.last = {
      ...timing.last,
      finishedAt,
      durationMs,
      status: outcome?.status ?? 'blocked',
    };
    const updated = await updateRunRecord(
      record.runId,
      { executionTiming: timing },
      { directory: options.directory },
    );
    if (outcome) outcome.record = updated;
  }
}

async function executeAttempt(
  record,
  prepared,
  { directory, env, signal, timeoutMs, prompt, resume = false },
) {
  const previousSession = record.backendSessionId;
  const reservedSession = !resume && record.backend === 'claude' ? randomUUID() : null;
  let observedSession = reservedSession;
  const startedAt = Date.now();
  const idleMs = timeout(timeoutMs);
  let lastPersistedActivity = 0;
  let lastProgressIdentity = null;
  await updateRunRecord(
    record.runId,
    {
      status: resume ? 'resuming' : 'running',
      activePid: process.pid,
      hostProcess: await processIdentity(),
      delegateProcess: null,
      delegateTerminationConfirmed: true,
      diagnostic: null,
      lastActivityAt: new Date(startedAt).toISOString(),
      activityEvidence: 'dispatch',
      idleDeadlineAt: null,
      hardDeadlineAt: idleMs === null ? null : new Date(startedAt + idleMs).toISOString(),
      ...(reservedSession
        ? { backendSessionId: reservedSession, sessionEvidence: 'reserved' }
        : {}),
    },
    { directory },
  );
  const onSessionId = async (value) => {
    const id = sessionId(value);
    if (!id || (observedSession && observedSession !== id)) {
      throw new AdapterError(
        'E_ADAPTER_SESSION',
        'Backend session identifier changed during execution.',
      );
    }
    observedSession = id;
    await updateRunRecord(
      record.runId,
      { backendSessionId: id, sessionEvidence: 'observed' },
      { directory },
    );
  };
  const onProcess = async (identity) => {
    await updateRunRecord(
      record.runId,
      { delegateProcess: identity, delegateTerminationConfirmed: false },
      { directory },
    );
  };
  let result;
  try {
    result = await boundedCall(
      (boundedSignal, markActivity) => {
        const method = resume ? prepared.adapter.resume : prepared.adapter.run;
        return method.call(prepared.adapter, {
          profile: prepared.profile,
          cwd: record.worktreePath,
          capsulePath: record.capsulePath,
          prompt,
          sessionId: resume ? previousSession : reservedSession,
          onSessionId,
          onProcess,
          onActivity: markActivity,
          env,
          signal: boundedSignal,
          timeoutMs: hardLimit(timeoutMs),
        });
      },
      {
        signal,
        timeoutMs,
        onActivity: async (progress) => {
          const now = Date.now();
          const tool = progress?.latestTool;
          const identity = JSON.stringify([progress?.phase, tool?.name, tool?.state, tool?.files]);
          const terminal = ['result', 'turn.completed', 'turn.failed'].includes(progress?.event);
          if (
            progress?.phase !== 'attention' &&
            !terminal &&
            identity === lastProgressIdentity &&
            now - lastPersistedActivity < 5_000
          )
            return;
          lastPersistedActivity = now;
          lastProgressIdentity = identity;
          await updateRunRecord(
            record.runId,
            {
              lastActivityAt: new Date(now).toISOString(),
              activityEvidence: 'backend-event',
              nativeProgress: progress ?? null,
              idleDeadlineAt: null,
            },
            { directory },
          );
        },
      },
    );
  } catch (error) {
    const diagnostic = (await capsuleIntegrity(record, directory)).valid
      ? executionDiagnostic(error)
      : {
          code: 'E_DELEGATE_CAPSULE_DRIFT',
          message:
            'Private capsule changed during the delegate run; inspect the retained worktree.',
        };
    const knownSession =
      previousSession ??
      observedSession ??
      (error instanceof AdapterError ? sessionId(error.sessionId) : null);
    let retained = await blocked(
      record.runId,
      directory,
      diagnostic.code,
      diagnostic.message,
      knownSession,
    );
    retained = await updateRunRecord(
      record.runId,
      {
        diagnostic: {
          ...diagnostic,
          ...(error instanceof AdapterError
            ? {
                details: safeAdapterDetails(error.details, record.destination),
              }
            : {}),
        },
        delegateTerminationConfirmed: error.processTerminationConfirmed !== false,
        ...(error.ownedProcess ? { delegateProcess: error.ownedProcess } : {}),
      },
      { directory },
    );
    if (error?.usage || error?.completionEvidence) {
      retained = await updateRunRecord(
        record.runId,
        {
          observedUsage: error.usage ?? null,
          completionEvidence: error.completionEvidence ?? 'unavailable',
        },
        { directory },
      );
    }
    return {
      status: 'blocked',
      runId: record.runId,
      record: retained,
      nextAction: diagnostic.message,
    };
  }
  return finishExecution(record, result, {
    directory,
    expectedSession: resume ? previousSession : (reservedSession ?? observedSession),
    retainedSession: previousSession ?? observedSession,
  });
}

// A valid process turn is not complete until context integrity and the exact result are verified.
async function finishExecution(record, result, { directory, expectedSession, retainedSession }) {
  if (!(await capsuleIntegrity(record, directory)).valid) {
    const message =
      'Private capsule changed during the delegate run; inspect the retained worktree.';
    const retained = await blocked(
      record.runId,
      directory,
      'E_DELEGATE_CAPSULE_DRIFT',
      message,
      retainedSession ?? sessionId(result?.sessionId),
    );
    return { status: 'blocked', runId: record.runId, record: retained, nextAction: message };
  }
  const accepted = resultShape(result, expectedSession);
  if (!accepted) {
    const retained = await blocked(
      record.runId,
      directory,
      'E_DELEGATE_RESULT',
      'Delegate returned a malformed result or a different session; inspect the retained worktree.',
      retainedSession ?? sessionId(result?.sessionId),
    );
    return {
      status: 'blocked',
      runId: record.runId,
      record: retained,
      nextAction: retained.diagnostic.message,
    };
  }
  const question = accepted.status === 'question' ? accepted.question : null;
  const updated = await updateRunRecord(
    record.runId,
    {
      status: accepted.status,
      activePid: null,
      delegateTerminationConfirmed: true,
      backendSessionId: accepted.sessionId,
      sessionEvidence: 'confirmed',
      observedUsage: accepted.usage ?? null,
      completionEvidence: accepted.completionEvidence ?? 'structured-result',
      nativeSummary: accepted.summary,
      observedModel: accepted.observedModel ?? null,
      nativeWarnings: accepted.warnings ?? [],
      question,
      reportedBlocker: accepted.status === 'blocked' ? accepted.summary.slice(0, 1024) : null,
      diagnostic:
        accepted.status === 'blocked'
          ? {
              code: accepted.diagnosticCode ?? 'E_DELEGATE_BLOCKED',
              message:
                SAFE_ADAPTER_DIAGNOSTICS[accepted.diagnosticCode] ??
                'Delegate reported a blocker; inspect its summary and worktree.',
              ...(accepted.nativeDiagnostic
                ? {
                    details: {
                      native: safeNativeDiagnostic(accepted.nativeDiagnostic, record.destination),
                    },
                  }
                : {}),
            }
          : null,
    },
    { directory },
  );
  return { status: accepted.status, runId: record.runId, record: updated, result: accepted };
}

async function dispatchRun({
  runId,
  runDirectory = defaultRunDirectory(),
  profileDirectory,
  env,
  signal,
  timeoutMs,
} = {}) {
  const record = await recoverOwnedProcesses(
    await readRunRecord(runId, { directory: runDirectory }),
    runDirectory,
  );
  assertExecutionReady(record);
  if (record.status !== 'prepared') {
    throw new DelegateRunError('E_DELEGATE_STATE', 'Only a prepared run can dispatch.', runId);
  }
  let prepared;
  try {
    prepared = await eligible(record, { runDirectory, profileDirectory, env, signal, timeoutMs });
  } catch (error) {
    const diagnostic = eligibilityDiagnostic(error, record);
    const retained = await updateRunRecord(runId, { diagnostic }, { directory: runDirectory });
    return { status: retained.status, runId, record: retained, nextAction: diagnostic.message };
  }
  return execute(record, prepared, {
    directory: runDirectory,
    env,
    signal,
    timeoutMs,
    prompt: runPrompt(record),
  });
}

async function resumeRun({
  runId,
  answer,
  correction,
  runDirectory = defaultRunDirectory(),
  profileDirectory,
  env,
  signal,
  timeoutMs,
} = {}) {
  const record = await recoverOwnedProcesses(
    await readRunRecord(runId, { directory: runDirectory }),
    runDirectory,
  );
  assertExecutionReady(record);
  if (record.integration?.status === 'applied') {
    throw new DelegateRunError(
      'E_DELEGATE_ALREADY_INTEGRATED',
      'This run has already been integrated; use a new delegated run for further corrections.',
      runId,
    );
  }
  if (Boolean(answer) === Boolean(correction)) {
    throw new DelegateRunError('E_DELEGATE_INPUT', 'Provide one answer or correction.', runId);
  }
  if (
    (answer && !['question', 'blocked'].includes(record.status)) ||
    (correction && !['completed', 'blocked'].includes(record.status))
  ) {
    throw new DelegateRunError('E_DELEGATE_STATE', 'Run is not ready for this handoff.', runId);
  }
  if (!sessionId(record.backendSessionId)) {
    const message =
      'The exact backend session is unavailable; inspect the retained run and worktree.';
    const retained = await blocked(runId, runDirectory, 'E_DELEGATE_SESSION', message);
    return { status: 'blocked', runId, record: retained, nextAction: message };
  }
  const handoff = boundedText(answer ?? correction, answer ? 'Answer' : 'Correction');
  let prepared;
  try {
    prepared = await eligible(record, { runDirectory, profileDirectory, env, signal, timeoutMs });
  } catch (error) {
    const diagnostic = eligibilityDiagnostic(error, record);
    const retained = await updateRunRecord(runId, { diagnostic }, { directory: runDirectory });
    return { status: retained.status, runId, record: retained, nextAction: diagnostic.message };
  }
  await updateRunRecord(
    runId,
    {
      lastHandoff: {
        kind: answer ? 'answer' : 'correction',
        text: handoff,
        at: new Date().toISOString(),
      },
      question: null,
    },
    { directory: runDirectory },
  );
  return execute(record, prepared, {
    directory: runDirectory,
    env,
    signal,
    timeoutMs,
    prompt: `${answer ? 'Answer / permission resolution' : 'Review correction'} for the same run and session:\n${handoff}${record.backend === 'generic' ? `\n\n${STRUCTURED_RESULT_INSTRUCTIONS}` : ''}`,
    resume: true,
  });
}

function assertExecutionReady(record) {
  if (['applying', 'interrupted'].includes(record.integration?.status))
    throw new DelegateRunError(
      'E_DELEGATE_INTEGRATION_RECOVERY',
      'Source integration is unresolved; use the integration recovery action before another delegate operation.',
      record.runId,
    );
  if (!record.helper)
    throw new DelegateRunError(
      'E_DELEGATE_UNPINNED_RUN',
      'This retained record has no pinned helper. It remains readable; prepare a new run before executing code.',
      record.runId,
    );
}

export async function dispatchDelegateRun(input = {}) {
  return withRunTransitionLock(input.runId, { directory: input.runDirectory }, () =>
    dispatchRun(input),
  );
}

export async function resumeDelegateRun(input = {}) {
  return withRunTransitionLock(input.runId, { directory: input.runDirectory }, () =>
    resumeRun(input),
  );
}
