import { createHash, randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AdapterError, terminateProcessGroup, validateDestination } from './adapters/generic.mjs';
import {
  assertCredentialFreeText,
  buildContextCapsule,
  previewContextCapsule,
  validateContextMirror,
  writeContextCapsule,
} from './context.mjs';
import {
  cleanupWorktreeCustody,
  createWorktreeCustody,
  validateWorktreeCustody,
} from './custody.mjs';
import { snapshotHelper, verifiedHelper } from './helper-snapshot.mjs';
import {
  handoffPresentation,
  implementationReport,
  preparationPresentation,
} from './presentation.mjs';
import {
  enrollProfile,
  inspectEnrolledBackend,
  listProfiles,
  prepareProfile,
  previewProfileCandidate,
  profileReadiness,
  removeProfile,
} from './profiles.mjs';
import {
  closeRunRecord,
  createRunRecord,
  defaultRunDirectory,
  processIdentity,
  processIdentityState,
  pruneClosedRunRecords,
  readRunRecord,
  updateRunRecord,
  verifyIntegrationState,
  withRunTransitionLock,
} from './run-record.mjs';

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_RUN_DURATION_MS = 60 * 60 * 1000;
const MAX_HANDOFF_TEXT = 4096;
const MAX_CUSTODY_BYTES = 64 * 1024 * 1024;
const MAX_CAPSULE_BYTES = 32 * 1024 * 1024;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const RESULT_STATES = new Set(['completed', 'blocked', 'question']);
const PACKAGE_LOCKS = Object.freeze([
  ['package-lock.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
]);
const SAFE_ADAPTER_DIAGNOSTICS = Object.freeze({
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
  E_ADAPTER_PERMISSION:
    'The headless delegate repeatedly attempted tools requiring approval; inspect its retained worktree and permissions.',
  E_ADAPTER_RESULT:
    'Adapter returned no complete structured result; inspect backend availability and the retained worktree.',
  E_ADAPTER_STALLED:
    'Delegate repeated completed commands or exceeded its command budget; inspect the retained session and worktree before correction.',
  E_ADAPTER_NO_FINAL:
    'Codex completed without a final result; inspect the retained exact session and worktree before correction.',
});
const STRUCTURED_RESULT_INSTRUCTIONS = [
  'Your final response must be exactly one valid JSON object, with no Markdown fence or surrounding prose.',
  'Required fields: "status" (exactly "completed", "blocked", or "question") and "summary" (a nonempty string).',
  'Optional fields: "checks" (array of strings) and "issues" (array of strings).',
  'When status is "question", include "question" with a nonempty "text" string and optional "options" array of strings; otherwise omit "question".',
  'Report checks actually run and concrete issues. Do not include "sessionId"; the adapter supplies the backend session identifier.',
].join('\n');
const CREDENTIAL =
  /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}/iu;

export class DelegateRunError extends Error {
  constructor(code, message, runId = null, details = null) {
    super(message);
    this.name = 'DelegateRunError';
    this.code = code;
    this.runId = runId;
    if (details) this.details = details;
  }
}

function within(root, path) {
  return path === root || path.startsWith(`${root}${sep}`);
}

function integrationPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 64)
    throw new DelegateRunError(
      'E_DELEGATE_SCOPE',
      'Declare one to 64 integration boundary paths before dispatch.',
    );
  return [
    ...new Set(
      paths.map((path) => {
        if (
          typeof path !== 'string' ||
          !path ||
          path.includes('\\') ||
          path.includes('\0') ||
          isAbsolute(path) ||
          /^[A-Za-z]:/u.test(path) ||
          path.split('/').some((part) => !part || part === '.' || part === '..') ||
          path === '.git' ||
          path.startsWith('.git/')
        )
          throw new DelegateRunError(
            'E_DELEGATE_SCOPE',
            'Integration paths must be safe repository-relative paths.',
          );
        return path;
      }),
    ),
  ].sort();
}

async function optionalFile(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function inspectWorktreeDependencies(worktreePath) {
  const manifest = await optionalFile(join(worktreePath, 'package.json'));
  if (!manifest?.isFile()) return { state: 'not-applicable' };
  const lock = [];
  for (const [file, manager] of PACKAGE_LOCKS) {
    if ((await optionalFile(join(worktreePath, file)))?.isFile()) lock.push({ file, manager });
  }
  const modules = await optionalFile(join(worktreePath, 'node_modules'));
  return {
    state:
      modules?.isDirectory() && !modules.isSymbolicLink()
        ? 'available'
        : modules
          ? 'unsafe-link-or-path'
          : 'not-provisioned',
    lockfiles: lock,
    nextAction: modules
      ? modules.isDirectory() && !modules.isSymbolicLink()
        ? undefined
        : 'Inspect and remove the unsafe worktree dependency path before dispatch; do not link the source checkout node_modules.'
      : 'If tests require dependencies, install them inside the detached worktree with its lockfile before dispatch; do not link the source checkout node_modules.',
  };
}

function boundedText(value, label) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Buffer.byteLength(value, 'utf8') > MAX_HANDOFF_TEXT ||
    CREDENTIAL.test(value)
  ) {
    throw new DelegateRunError(
      'E_DELEGATE_INPUT',
      `${label} must be nonempty, bounded, and free of credential material.`,
    );
  }
  assertCredentialFreeText(value, { code: 'E_DELEGATE_INPUT', label });
  return value;
}

function sessionId(value) {
  return typeof value === 'string' && SESSION_ID.test(value) ? value : null;
}

function timeout(value) {
  const duration = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > MAX_TIMEOUT_MS) {
    throw new DelegateRunError(
      'E_DELEGATE_TIMEOUT',
      'Run timeout must be between 1 ms and 1 hour.',
    );
  }
  return duration;
}

function hardLimit(timeoutMs) {
  return Math.min(MAX_RUN_DURATION_MS, timeout(timeoutMs) * 3);
}

function destinationIdentity(destination) {
  if (!destination || typeof destination !== 'object') {
    throw new DelegateRunError('E_DELEGATE_PROFILE', 'Profile has no verified destination.');
  }
  const { classification, class: destinationClass, origin } = destination;
  const category = classification ?? destinationClass;
  if (typeof category !== 'string' || typeof origin !== 'string' || !origin) {
    throw new DelegateRunError('E_DELEGATE_PROFILE', 'Profile destination is incomplete.');
  }
  return { class: category, origin };
}

function profileIdentity(prepared) {
  const name = prepared?.profile?.name;
  const backend = prepared?.profile?.kind;
  if (typeof name !== 'string' || !name || typeof backend !== 'string' || !backend) {
    throw new DelegateRunError('E_DELEGATE_PROFILE', 'Profile identity is incomplete.');
  }
  if (
    typeof prepared.adapter?.run !== 'function' ||
    typeof prepared.adapter?.resume !== 'function'
  ) {
    throw new DelegateRunError(
      'E_DELEGATE_CAPABILITY',
      'Profile adapter must run and resume exactly.',
    );
  }
  return {
    name,
    backend,
    destination: destinationIdentity(prepared.destination),
    enrollmentId:
      prepared.profile.recordDigest ??
      createHash('sha256').update(JSON.stringify(prepared.profile)).digest('hex'),
  };
}

function profileMatches(record, prepared) {
  const identity = profileIdentity(prepared);
  return (
    identity.name === record.profileName &&
    identity.backend === record.backend &&
    identity.enrollmentId === record.profileEnrollmentId &&
    identity.destination.class === record.destination.class &&
    identity.destination.origin === record.destination.origin
  );
}

async function assertBackendReady(prepared, runId = null) {
  if (prepared.destination.class !== 'local' || prepared.profile.argv.length !== 2) return;
  const backend = await inspectEnrolledBackend(prepared.profile);
  if (backend.status === 'unreachable') {
    throw new DelegateRunError(
      'E_DELEGATE_BACKEND_UNAVAILABLE',
      'The enrolled local model server is unreachable. Start it and retry the same run.',
      runId,
    );
  }
  if (backend.modelStatus === 'not-listed') {
    throw new DelegateRunError(
      'E_DELEGATE_MODEL_UNAVAILABLE',
      'The selected model is not visible at the enrolled local endpoint. Load it or re-enroll the profile.',
      runId,
    );
  }
  if (backend.loadStatus === 'not-loaded') {
    throw new DelegateRunError(
      'E_DELEGATE_MODEL_NOT_LOADED',
      'The selected model is downloaded but not loaded at the enrolled local endpoint. Load it before dispatching this run.',
      runId,
    );
  }
}

function resultShape(result, expectedSessionId = null) {
  if (!result || typeof result !== 'object' || !RESULT_STATES.has(result.status)) return null;
  const exactId = sessionId(result.sessionId);
  if (
    (!exactId && (result.status !== 'blocked' || result.sessionId != null)) ||
    (expectedSessionId && exactId !== expectedSessionId)
  )
    return null;
  if (
    typeof result.summary !== 'string' ||
    Buffer.byteLength(result.summary, 'utf8') > MAX_HANDOFF_TEXT
  ) {
    return null;
  }
  if (CREDENTIAL.test(result.summary)) return null;
  if (result.status === 'blocked' && !result.summary.trim()) return null;
  if (result.status === 'question') {
    const question = result.question;
    if (
      !question ||
      typeof question !== 'object' ||
      typeof question.text !== 'string' ||
      !question.text.trim() ||
      Buffer.byteLength(question.text, 'utf8') > MAX_HANDOFF_TEXT ||
      CREDENTIAL.test(question.text) ||
      (question.options !== undefined &&
        (!Array.isArray(question.options) ||
          question.options.length > 12 ||
          question.options.some(
            (option) =>
              typeof option !== 'string' ||
              Buffer.byteLength(option, 'utf8') > 256 ||
              CREDENTIAL.test(option),
          )))
    )
      return null;
  }
  if (
    (result.checks !== undefined && !Array.isArray(result.checks)) ||
    (result.issues !== undefined && !Array.isArray(result.issues))
  )
    return null;
  return { ...result, sessionId: exactId };
}

async function custodyAt(record, runDirectory) {
  const expectedRunPath = join(await realpath(runDirectory ?? defaultRunDirectory()), record.runId);
  if (
    record.runPath !== expectedRunPath ||
    record.custodyPath !== join(expectedRunPath, 'custody.json')
  ) {
    throw new DelegateRunError(
      'E_DELEGATE_CUSTODY',
      'Run custody pointer is invalid.',
      record.runId,
    );
  }
  const details = await lstat(record.custodyPath);
  if (!details.isFile() || (details.mode & 0o077) !== 0 || details.size > MAX_CUSTODY_BYTES) {
    throw new DelegateRunError(
      'E_DELEGATE_CUSTODY',
      'Run custody file is unsafe or oversized.',
      record.runId,
    );
  }
  const bytes = await readFile(record.custodyPath);
  if (bytes.length > MAX_CUSTODY_BYTES) {
    throw new DelegateRunError(
      'E_DELEGATE_CUSTODY',
      'Run custody record is oversized.',
      record.runId,
    );
  }
  let custody;
  try {
    custody = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new DelegateRunError(
      'E_DELEGATE_CUSTODY',
      'Run custody record is malformed.',
      record.runId,
    );
  }
  if (
    custody.runId !== record.runId ||
    custody.worktreePath !== record.worktreePath ||
    custody.repositoryRoot !== record.repositoryRoot
  ) {
    throw new DelegateRunError('E_DELEGATE_CUSTODY', 'Run custody identity changed.', record.runId);
  }
  return custody;
}

export async function readDelegateCustody({ runId, runDirectory = defaultRunDirectory() } = {}) {
  const record = await readRunRecord(runId, { directory: runDirectory });
  return custodyAt(record, runDirectory);
}

async function capsuleIntegrity(record, runDirectory) {
  try {
    const expectedRunPath = join(
      await realpath(runDirectory ?? defaultRunDirectory()),
      record.runId,
    );
    const capsuleDirectory = join(expectedRunPath, 'capsule');
    if (
      record.runPath !== expectedRunPath ||
      record.capsulePath !== join(capsuleDirectory, 'capsule.json') ||
      !SHA256.test(record.capsuleDigest ?? '')
    )
      return { valid: false, code: 'E_DELEGATE_CAPSULE_DRIFT' };
    const [folder, file] = await Promise.all([lstat(capsuleDirectory), lstat(record.capsulePath)]);
    if (
      !folder.isDirectory() ||
      (folder.mode & 0o077) !== 0 ||
      (folder.mode & 0o100) === 0 ||
      !file.isFile() ||
      (file.mode & 0o077) !== 0 ||
      (file.mode & 0o400) === 0 ||
      file.size > MAX_CAPSULE_BYTES
    )
      return { valid: false, code: 'E_DELEGATE_CAPSULE_DRIFT' };
    const bytes = await readFile(record.capsulePath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const valid = bytes.length <= MAX_CAPSULE_BYTES && digest === record.capsuleDigest;
    if (valid) await validateContextMirror(record.capsulePath, JSON.parse(bytes.toString('utf8')));
    return { valid, code: valid ? null : 'E_DELEGATE_CAPSULE_DRIFT' };
  } catch (error) {
    return {
      valid: false,
      code: 'E_DELEGATE_CAPSULE_DRIFT',
      details: { cause: error.code ?? error.name ?? 'unknown' },
    };
  }
}

export async function validateDelegateCapsule({
  runId,
  runDirectory = defaultRunDirectory(),
} = {}) {
  const record = await readRunRecord(runId, { directory: runDirectory });
  return capsuleIntegrity(record, runDirectory);
}

async function eligible(record, { runDirectory, profileDirectory, env, signal, timeoutMs }) {
  let prepared;
  try {
    prepared = await prepareProfile(record.profileName, {
      directory: profileDirectory ?? record.profileDirectory,
      cwd: record.worktreePath,
      env,
      signal,
      timeoutMs,
    });
  } catch (error) {
    if (signal?.aborted || error?.code === 'E_ADAPTER_CANCELLED') {
      throw new DelegateRunError(
        'E_DELEGATE_CANCELLED',
        'Delegate eligibility check was cancelled.',
        record.runId,
      );
    }
    if (error?.code === 'E_ADAPTER_TIMEOUT') {
      throw new DelegateRunError(
        'E_DELEGATE_TIMEOUT',
        'Delegate eligibility check timed out.',
        record.runId,
      );
    }
    if (error?.code === 'E_DESTINATION_CHANGED') {
      throw new DelegateRunError(
        'E_DELEGATE_DESTINATION_CHANGED',
        'Effective destination changed; re-enroll the profile and prepare a new preview.',
        record.runId,
      );
    }
    throw new DelegateRunError(
      typeof error?.code === 'string' ? error.code : 'E_DELEGATE_PROFILE',
      typeof error?.code === 'string'
        ? error.message
        : 'Profile eligibility failed; inspect enrollment and effective destination.',
      record.runId,
      error?.details,
    );
  }
  if (!profileMatches(record, prepared)) {
    throw new DelegateRunError(
      'E_DELEGATE_PROFILE_CHANGED',
      'The enrolled profile changed; inspect its destination and prepare a new preview.',
      record.runId,
    );
  }
  await assertBackendReady(prepared, record.runId);
  const custody = await custodyAt(record, runDirectory);
  let check;
  try {
    check = await validateWorktreeCustody(custody);
  } catch {
    throw new DelegateRunError(
      'E_DELEGATE_CUSTODY',
      'Worktree custody could not be inspected.',
      record.runId,
    );
  }
  if (check?.valid !== true) {
    throw new DelegateRunError(
      'E_DELEGATE_CUSTODY_DRIFT',
      'Worktree or source custody changed; inspect the retained worktree before dispatch.',
      record.runId,
      { violations: check.violations },
    );
  }
  const capacity = await contextCapacity(record, prepared, env);
  await updateRunRecord(record.runId, { contextCapacity: capacity }, { directory: runDirectory });
  const capsuleCheck = await capsuleIntegrity(record, runDirectory);
  if (!capsuleCheck.valid) {
    throw new DelegateRunError(
      'E_DELEGATE_CAPSULE_DRIFT',
      'Private capsule changed or became unreadable; inspect the retained run before dispatch.',
      record.runId,
      capsuleCheck.details,
    );
  }
  return prepared;
}

function runPrompt(record) {
  return [
    `Implement the task in the readable private context at ${join(record.runPath, 'capsule', 'readable', 'index.json')}.`,
    `Read ${join(record.runPath, 'capsule', 'readable', 'request.md')} and every required file in that index before editing.`,
    `The integrity-covered capsule is at ${record.capsulePath}; read decoded context files directly, without a shell or base64 decoding.`,
    `Edit only the detached worktree at ${record.worktreePath}.`,
    ...(record.integrationScopePaths?.length
      ? [
          `Keep implementation changes within the declared integration boundary: ${record.integrationScopePaths.join(', ')}.`,
        ]
      : []),
    'Do not stage, commit, publish, or deploy. Ask a structured question when a material decision is missing.',
    STRUCTURED_RESULT_INSTRUCTIONS,
  ].join('\n');
}

async function boundedCall(call, { signal, timeoutMs, onActivity }) {
  if (signal?.aborted) {
    throw new DelegateRunError('E_DELEGATE_CANCELLED', 'Delegate run was cancelled.');
  }
  const idleMs = timeout(timeoutMs);
  const controller = new AbortController();
  let idleTimer;
  let hardTimer;
  let cancel;
  let resetIdle;
  let running;
  const interrupted = new Promise((_, reject) => {
    cancel = () => {
      controller.abort();
      reject(new DelegateRunError('E_DELEGATE_CANCELLED', 'Delegate run was cancelled.'));
    };
    resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        reject(
          new DelegateRunError(
            'E_DELEGATE_TIMEOUT',
            'Delegate stopped emitting progress before its idle limit.',
          ),
        );
        controller.abort();
      }, idleMs);
    };
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    resetIdle();
    hardTimer = setTimeout(() => {
      reject(
        new DelegateRunError('E_DELEGATE_TIMEOUT', 'Delegate reached its absolute safety limit.'),
      );
      controller.abort();
    }, hardLimit(timeoutMs));
  });
  const activity = async () => {
    if (controller.signal.aborted) return;
    resetIdle();
    await onActivity?.();
  };
  let outcome;
  let failure;
  running = Promise.resolve().then(() => {
    if (controller.signal.aborted)
      throw new DelegateRunError('E_DELEGATE_CANCELLED', 'Delegate run was cancelled.');
    return call(controller.signal, activity);
  });
  try {
    outcome = await Promise.race([running, interrupted]);
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(hardTimer);
    signal?.removeEventListener('abort', cancel);
  }
  // Cancellation is complete only after the adapter has stopped its process group.
  if (controller.signal.aborted) {
    try {
      await running;
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
  return outcome;
}

async function contextCapacity(record, prepared, env) {
  const capsuleBytes = (await lstat(record.capsulePath)).size;
  if (prepared.destination.class !== 'local' || prepared.profile.argv.length !== 2)
    return { state: 'unverified', capsuleBytes, modelContextTokens: null };
  const backend = await inspectEnrolledBackend(prepared.profile, { env });
  const modelContextTokens = backend.contextLength ?? null;
  if (!modelContextTokens) return { state: 'unverified', capsuleBytes, modelContextTokens: null };
  // UTF-8 bytes are a conservative upper bound for capsule text tokens. Leave room
  // for the host's instructions, tool schemas, conversation, and model output.
  const reserveTokens = Math.max(4096, Math.ceil(modelContextTokens / 4));
  if (capsuleBytes + reserveTokens > modelContextTokens)
    throw new DelegateRunError(
      'E_DELEGATE_CONTEXT_CAPACITY',
      'The required capsule exceeds a conservative bound for the loaded model context; use a larger context or narrow the task before dispatch.',
      record.runId,
    );
  return { state: 'within-conservative-bound', capsuleBytes, modelContextTokens, reserveTokens };
}

async function blocked(runId, directory, code, message, session = null) {
  return updateRunRecord(
    runId,
    {
      status: 'blocked',
      activePid: null,
      backendSessionId: session,
      diagnostic: { code, message },
    },
    { directory },
  );
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

async function execute(
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
  await updateRunRecord(
    record.runId,
    {
      status: resume ? 'resuming' : 'running',
      activePid: process.pid,
      hostProcess: await processIdentity(),
      delegateProcess: null,
      diagnostic: null,
      lastActivityAt: new Date(startedAt).toISOString(),
      activityEvidence: 'dispatch',
      idleDeadlineAt: new Date(startedAt + idleMs).toISOString(),
      hardDeadlineAt: new Date(startedAt + hardLimit(timeoutMs)).toISOString(),
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
    await updateRunRecord(record.runId, { delegateProcess: identity }, { directory });
  };
  let result;
  try {
    result = await boundedCall(
      (boundedSignal, markActivity) =>
        resume
          ? prepared.adapter.resume({
              profile: prepared.profile,
              cwd: record.worktreePath,
              capsulePath: record.capsulePath,
              prompt,
              sessionId: previousSession,
              onSessionId,
              onProcess,
              onActivity: markActivity,
              env,
              signal: boundedSignal,
              timeoutMs: hardLimit(timeoutMs),
            })
          : prepared.adapter.run({
              profile: prepared.profile,
              cwd: record.worktreePath,
              capsulePath: record.capsulePath,
              prompt,
              sessionId: reservedSession,
              onSessionId,
              onProcess,
              onActivity: markActivity,
              env,
              signal: boundedSignal,
              timeoutMs: hardLimit(timeoutMs),
            }),
      {
        signal,
        timeoutMs,
        onActivity: async () => {
          const now = Date.now();
          if (now - lastPersistedActivity < 5_000) return;
          lastPersistedActivity = now;
          await updateRunRecord(
            record.runId,
            {
              lastActivityAt: new Date(now).toISOString(),
              activityEvidence: 'backend-event',
              idleDeadlineAt: new Date(now + idleMs).toISOString(),
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
  if (!(await capsuleIntegrity(record, directory)).valid) {
    const message =
      'Private capsule changed during the delegate run; inspect the retained worktree.';
    const retained = await blocked(
      record.runId,
      directory,
      'E_DELEGATE_CAPSULE_DRIFT',
      message,
      previousSession ?? observedSession ?? sessionId(result?.sessionId),
    );
    return { status: 'blocked', runId: record.runId, record: retained, nextAction: message };
  }
  const accepted = resultShape(
    result,
    resume ? previousSession : (reservedSession ?? observedSession),
  );
  if (!accepted) {
    const retained = await blocked(
      record.runId,
      directory,
      'E_DELEGATE_RESULT',
      'Delegate returned a malformed result or a different session; inspect the retained worktree.',
      previousSession ?? observedSession ?? sessionId(result?.sessionId),
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
      backendSessionId: accepted.sessionId,
      sessionEvidence: 'confirmed',
      observedUsage: accepted.usage ?? null,
      completionEvidence: accepted.completionEvidence ?? 'structured-result',
      question,
      reportedBlocker: accepted.status === 'blocked' ? accepted.summary.slice(0, 1024) : null,
      diagnostic:
        accepted.status === 'blocked'
          ? {
              code: 'E_DELEGATE_BLOCKED',
              message: 'Delegate reported a blocker; inspect its summary and worktree.',
            }
          : null,
    },
    { directory },
  );
  return { status: accepted.status, runId: record.runId, record: updated, result: accepted };
}

export async function prepareDelegateRun({
  repositoryRoot,
  taskSelector,
  request,
  selectedFiles = [],
  optionalFiles = [],
  readOnlyRepositories = [],
  selectedPaths,
  scopePaths,
  preservePaths = [],
  profile,
  profileDirectory,
  runDirectory = defaultRunDirectory(),
  worktreeParent,
  env,
  signal,
  timeoutMs,
} = {}) {
  if (!repositoryRoot)
    throw new DelegateRunError('E_DELEGATE_INPUT', 'Repository root is required.');
  const root = await realpath(repositoryRoot);
  const requestedDirectory = resolve(runDirectory);
  await mkdir(requestedDirectory, { recursive: true, mode: 0o700 });
  const privateDirectory = await realpath(requestedDirectory);
  if (within(root, privateDirectory)) {
    throw new DelegateRunError(
      'E_DELEGATE_PRIVATE',
      'Run storage must be outside the source repository.',
    );
  }
  // Eligibility is checked before any worktree is created or backend is called.
  const prepared = await prepareProfile(profile, {
    directory: profileDirectory,
    cwd: root,
    env,
    signal,
    timeoutMs,
  });
  await assertBackendReady(prepared);
  const capsule = await buildContextCapsule({
    repositoryRoot: root,
    taskSelector,
    request,
    selectedFiles,
    optionalFiles,
    readOnlyRepositories,
  });
  const integrationScopePaths = scopePaths === undefined ? null : integrationPaths(scopePaths);
  const identity = profileIdentity(prepared);
  const runId = randomUUID();
  const runPath = join(privateDirectory, runId);
  await createRunRecord(
    {
      runId,
      status: 'preparing',
      mode: capsule.mode,
      selector: capsule.selector,
      repositoryRoot: root,
      integrationScopePaths,
      runPath,
      capsulePath: null,
      capsuleDigest: null,
      custodyPath: null,
      worktreePath: null,
      profileName: identity.name,
      backend: identity.backend,
      profileEnrollmentId: identity.enrollmentId,
      destination: identity.destination,
      profileDirectory: profileDirectory ?? null,
      backendSessionId: null,
      sessionEvidence: 'unavailable',
      activePid: null,
      diagnostic: null,
      question: null,
      reportedBlocker: null,
      lastHandoff: null,
      planning: capsule.planning,
    },
    { directory: privateDirectory },
  );
  try {
    const helper = await snapshotHelper(runPath);
    await updateRunRecord(runId, { helper }, { directory: privateDirectory });
    const capsulePath = await writeContextCapsule(capsule, {
      directory: join(runPath, 'capsule'),
      repositoryRoot: root,
    });
    const capsuleDigest = createHash('sha256')
      .update(await readFile(capsulePath))
      .digest('hex');
    const withCapsule = await updateRunRecord(
      runId,
      { capsulePath, capsuleDigest },
      { directory: privateDirectory },
    );
    const capacity = await contextCapacity(withCapsule, prepared, env);
    await updateRunRecord(runId, { contextCapacity: capacity }, { directory: privateDirectory });
    const custodyParent = resolve(worktreeParent ?? join(privateDirectory, '..', 'worktrees'));
    if (within(root, custodyParent)) {
      throw new DelegateRunError(
        'E_DELEGATE_CUSTODY',
        'Worktree parent must be outside the source repository.',
        runId,
      );
    }
    await mkdir(custodyParent, { recursive: true, mode: 0o700 });
    const custody = await createWorktreeCustody({
      repositoryRoot: root,
      capsule,
      selectedPaths,
      preservePaths,
      readOnlyRepositories: readOnlyRepositories.map((source) => ({ ...source, writable: false })),
      worktreeParent: custodyParent,
      runId,
    });
    const custodyPath = join(runPath, 'custody.json');
    await updateRunRecord(
      runId,
      {
        capsulePath,
        worktreePath: custody.worktreePath,
        initialHead: custody.initialHead,
        initialIndex: custody.initialIndex,
      },
      { directory: privateDirectory },
    );
    const custodyBytes = Buffer.from(`${JSON.stringify(custody)}\n`);
    if (custodyBytes.length > MAX_CUSTODY_BYTES) {
      throw new DelegateRunError(
        'E_DELEGATE_CUSTODY',
        'Worktree custody record exceeds its private size limit.',
        runId,
      );
    }
    await writeFile(custodyPath, custodyBytes, { flag: 'wx', mode: 0o600 });
    await updateRunRecord(runId, { custodyPath }, { directory: privateDirectory });
    const worktreeProfile = await prepareProfile(identity.name, {
      directory: profileDirectory,
      cwd: custody.worktreePath,
      env,
      signal,
      timeoutMs,
    });
    const worktreeIdentity = profileIdentity(worktreeProfile);
    if (
      worktreeIdentity.enrollmentId !== identity.enrollmentId ||
      worktreeIdentity.destination.class !== identity.destination.class ||
      worktreeIdentity.destination.origin !== identity.destination.origin
    ) {
      throw new DelegateRunError(
        'E_DELEGATE_DESTINATION_CHANGED',
        'Effective destination changed in the detached worktree; inspect and re-enroll before dispatch.',
        runId,
      );
    }
    const worktreeDependencies = await inspectWorktreeDependencies(custody.worktreePath);
    if (worktreeDependencies.state === 'unsafe-link-or-path')
      throw new DelegateRunError(
        'E_DELEGATE_DEPENDENCIES',
        'Worktree dependency path is not a private real directory.',
        runId,
      );
    const ready = await updateRunRecord(
      runId,
      {
        status: 'prepared',
        runPath,
        capsulePath,
        custodyPath,
        worktreePath: custody.worktreePath,
        initialHead: custody.initialHead,
        initialIndex: custody.initialIndex,
      },
      { directory: privateDirectory },
    );
    const preview = {
      ...previewContextCapsule(capsule),
      runId,
      writableRepository: root,
      selectedPaths: custody.selectedPaths,
      integrationScopePaths,
      preservePaths: custody.preservePaths,
      worktreePath: custody.worktreePath,
      profile: identity.name,
      backend: identity.backend,
      destination: identity.destination,
      contextCapacity: capacity,
      worktreeDependencies,
      helper,
    };
    return { runId, preview, record: ready };
  } catch (error) {
    const destinationChanged = ['E_DESTINATION_CHANGED', 'E_DELEGATE_DESTINATION_CHANGED'].includes(
      error?.code,
    );
    const contextTooLarge = error?.code === 'E_DELEGATE_CONTEXT_CAPACITY';
    await blocked(
      runId,
      privateDirectory,
      destinationChanged
        ? 'E_DELEGATE_DESTINATION_CHANGED'
        : contextTooLarge
          ? 'E_DELEGATE_CONTEXT_CAPACITY'
          : 'E_DELEGATE_PREPARE',
      destinationChanged
        ? 'Effective worktree destination changed; inspect enrollment and prepare a new preview.'
        : contextTooLarge
          ? error.message
          : 'Preparation failed; inspect retained capsule or worktree custody before retrying.',
    );
    throw error;
  }
}

async function dispatchRun({
  runId,
  runDirectory = defaultRunDirectory(),
  profileDirectory,
  env,
  signal,
  timeoutMs,
} = {}) {
  const record = await readRunRecord(runId, { directory: runDirectory });
  assertExecutionReady(record);
  if (record.status !== 'prepared') {
    throw new DelegateRunError('E_DELEGATE_STATE', 'Only a prepared run can dispatch.', runId);
  }
  let prepared;
  try {
    prepared = await eligible(record, { runDirectory, profileDirectory, env, signal, timeoutMs });
  } catch (error) {
    const code = error instanceof DelegateRunError ? error.code : 'E_DELEGATE_PROFILE';
    const message =
      error instanceof DelegateRunError
        ? error.message
        : 'Profile eligibility failed; inspect enrollment and effective destination.';
    const retained = await updateRunRecord(
      runId,
      { diagnostic: { code, message, ...(error?.details ? { details: error.details } : {}) } },
      { directory: runDirectory },
    );
    return { status: retained.status, runId, record: retained, nextAction: message };
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
  const record = await readRunRecord(runId, { directory: runDirectory });
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
    (answer && record.status !== 'question') ||
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
    const code = error instanceof DelegateRunError ? error.code : 'E_DELEGATE_PROFILE';
    const message =
      error instanceof DelegateRunError
        ? error.message
        : 'Profile eligibility failed; inspect enrollment and effective destination.';
    const retained = await updateRunRecord(
      runId,
      { diagnostic: { code, message, ...(error?.details ? { details: error.details } : {}) } },
      { directory: runDirectory },
    );
    return { status: retained.status, runId, record: retained, nextAction: message };
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
    prompt: `${answer ? 'Answer to your question' : 'Review correction'} for the same run and session:\n${handoff}\n\n${STRUCTURED_RESULT_INSTRUCTIONS}`,
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

async function executionProcessState(record) {
  const deadlineExpired =
    Number.isFinite(Date.parse(record.hardDeadlineAt ?? '')) &&
    Date.now() >= Date.parse(record.hardDeadlineAt);
  if (deadlineExpired) return 'deadline-expired';
  if (record.hostProcess) return processIdentityState(record.hostProcess);
  if (record.activePid) {
    try {
      process.kill(record.activePid, 0);
      return 'unknown';
    } catch (error) {
      if (error.code === 'ESRCH') return 'exited';
      if (error.code === 'EPERM') return 'unknown';
      throw error;
    }
  }
  return 'exited';
}

export async function recoverDelegateRun({ runId, runDirectory = defaultRunDirectory() } = {}) {
  return withRunTransitionLock(runId, { directory: runDirectory }, async () => {
    const record = await readRunRecord(runId, { directory: runDirectory });
    if (['applying', 'interrupted'].includes(record.integration?.status)) return record;
    if (!['running', 'resuming', 'preparing'].includes(record.status)) return record;
    const state = await executionProcessState(record);
    if (state === 'alive' || state === 'unknown') return record;
    if (record.delegateProcess) await terminateProcessGroup(record.delegateProcess);
    return blocked(
      runId,
      runDirectory,
      'E_DELEGATE_INTERRUPTED',
      'Run was interrupted or reached its hard deadline; the delegate process group was stopped. Inspect its capsule, worktree, and exact session.',
      record.backendSessionId,
    );
  });
}

export async function cleanupDelegateRun({
  runId,
  disposition,
  runDirectory = defaultRunDirectory(),
} = {}) {
  return withRunTransitionLock(runId, { directory: runDirectory }, async () => {
    const record = await readRunRecord(runId, { directory: runDirectory });
    const expected = record.disposition === 'integrated' ? 'accepted' : 'abandoned';
    if (record.status !== 'closed' || disposition !== expected)
      throw new DelegateRunError(
        'E_DELEGATE_CLEANUP',
        'Cleanup requires a closed run and its matching accepted or abandoned disposition.',
        runId,
      );
    if (record.cleanup?.status === 'removed') return record.cleanup;
    if (record.delegateProcess) await terminateProcessGroup(record.delegateProcess);
    const result = await cleanupWorktreeCustody(await custodyAt(record, runDirectory), {
      disposition,
    });
    const cleanup = { ...result, status: 'removed', at: new Date().toISOString() };
    await updateRunRecord(runId, { cleanup }, { directory: runDirectory });
    return cleanup;
  });
}

export async function delegateRunStatus({ runId, runDirectory = defaultRunDirectory() } = {}) {
  const record = await readRunRecord(runId, { directory: runDirectory });
  const integrationCheck = await verifyIntegrationState(record);
  const custody = record.custodyPath ? await custodyAt(record, runDirectory) : null;
  const active = ['preparing', 'running', 'resuming'].includes(record.status);
  const processState = active ? await executionProcessState(record) : 'none';
  const unresolvedIntegration = ['applying', 'interrupted'].includes(record.integration?.status);
  const nextAction = unresolvedIntegration
    ? 'Source integration is unresolved; run the integration helper recover action for this run before dispatch, resume, review, apply, or abandon.'
    : integrationCheck.recorded && integrationCheck.driftPaths.length
      ? 'Accepted source paths changed after integration; review those edits as separate work before attributing the final diff to the delegate.'
      : integrationCheck.recorded
        ? record.status === 'closed'
          ? 'Delegated integration is closed; later corrections need a new run or an explicit host-native handoff.'
          : 'The accepted local diff is recorded; close this run as integrated.'
        : ['exited', 'reused', 'deadline-expired'].includes(processState)
          ? 'The dispatch process exited; run recover for this exact run ID and inspect the retained worktree.'
          : active
            ? 'Wait for this run ID; if its host process ended, use recover and inspect the retained worktree.'
            : record.status === 'completed'
              ? 'Review the observed worktree delta and run independent checks before integration.'
              : record.status === 'question'
                ? 'Answer the structured question, then resume this exact run ID.'
                : record.status === 'blocked'
                  ? 'Inspect the diagnostic and retained worktree; resume only if the exact session is available.'
                  : record.status === 'prepared'
                    ? 'Present the complete preview and verified destination before dispatch.'
                    : 'Inspect the retained run record.';
  return {
    runId: record.runId,
    status: record.status,
    phase: unresolvedIntegration
      ? 'integration-recovery'
      : integrationCheck.recorded
        ? integrationCheck.driftPaths.length
          ? 'integrated-drift'
          : 'integrated'
        : active
          ? 'delegate-execution'
          : record.status === 'completed'
            ? 'review-pending'
            : record.status,
    elapsedMs: Math.max(0, Date.now() - Date.parse(record.createdAt)),
    lastActivityAt: record.lastActivityAt ?? record.updatedAt,
    activityEvidence: record.activityEvidence ?? 'record',
    idleDeadlineAt: record.idleDeadlineAt ?? null,
    hardDeadlineAt: record.hardDeadlineAt ?? null,
    processState,
    delegateProcess: record.delegateProcess ?? null,
    hostProcess: record.hostProcess ?? null,
    question: record.question ?? null,
    diagnostic: record.diagnostic ?? null,
    reportedBlocker: record.reportedBlocker ?? null,
    helperCompatibility: record.helper ? 'pinned' : 'read-only-record',
    cleanup: record.cleanup ?? null,
    integrationRecovery: unresolvedIntegration
      ? {
          status: record.integration.status,
          phase: record.integration.phase,
          journalPath: record.integration.journalPath,
          cursor: record.integration.cursor,
          pendingPath: record.integration.pendingPath,
          nextAction: `Run node ${record.helper?.integrationPath ?? 'integrate.mjs'} recover with this run ID and resolution rollback (default) or accept after verifying every written path.`,
        }
      : null,
    repositoryRoot: record.repositoryRoot,
    worktreePath: record.worktreePath,
    selectedPaths: custody?.selectedPaths ?? [],
    integrationScopePaths: record.integrationScopePaths ?? null,
    destination: record.destination,
    profile: record.profileName,
    contextCapacity: record.contextCapacity ?? null,
    observedUsage: record.observedUsage ?? null,
    completionEvidence: record.completionEvidence ?? null,
    exactSessionResume: Boolean(
      sessionId(record.backendSessionId) && record.sessionEvidence !== 'reserved',
    ),
    sessionEvidence:
      record.sessionEvidence ?? (record.backendSessionId ? 'confirmed' : 'unavailable'),
    integration: integrationCheck.recorded
      ? {
          status: record.integration.status,
          delegatePaths: record.integration.delegatePaths,
          generatedPaths: record.integration.generatedPaths,
          checks: record.integration.checks,
          driftPaths: integrationCheck.driftPaths,
        }
      : unresolvedIntegration
        ? { ...record.integration }
        : null,
    planning: record.planning ? { ...record.planning, status: 'not-updated' } : null,
    helper: record.helper ?? null,
    ...(record.integration?.status === 'applied'
      ? {
          report: implementationReport(
            {
              status: 'completed',
              changedPaths: record.integration.changedPaths,
              checks: record.integration.checks,
            },
            record.selector,
          ),
        }
      : {}),
    nextAction,
  };
}

export async function waitDelegateRun({
  runId,
  runDirectory = defaultRunDirectory(),
  afterUpdatedAt,
  timeoutMs = 30_000,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) {
    throw new DelegateRunError('E_DELEGATE_TIMEOUT', 'Wait must be bounded to at most 60 seconds.');
  }
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const current = await delegateRunStatus({ runId, runDirectory });
    if (
      !['preparing', 'running', 'resuming'].includes(current.status) ||
      ['exited', 'reused', 'deadline-expired'].includes(current.processState) ||
      (afterUpdatedAt && current.lastActivityAt !== afterUpdatedAt) ||
      Date.now() >= deadline
    ) {
      return current;
    }
    await delay(Math.min(500, deadline - Date.now()));
  }
}

async function commandInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) {
      throw new DelegateRunError(
        'E_DELEGATE_INPUT',
        'Command input exceeds its private size limit.',
      );
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new DelegateRunError('E_DELEGATE_INPUT', 'Command input must be one JSON object.');
  }
}

function probeFailure(error) {
  const code = typeof error?.code === 'string' ? error.code : 'E_DELEGATE_PROFILE';
  const state =
    code === 'E_DESTINATION_UNKNOWN'
      ? 'endpoint-unknown'
      : code === 'E_DESTINATION_CHANGED'
        ? 'destination-changed'
        : code === 'E_ADAPTER_INCOMPATIBLE'
          ? 'adapter-incompatible'
          : 'profile-unavailable';
  return {
    state,
    dispatchable: false,
    code,
    nextAction:
      state === 'endpoint-unknown'
        ? 'Configure an inspectable provider endpoint, then preview or renew the profile.'
        : state === 'destination-changed'
          ? 'Inspect the new destination and renew the profile before dispatch.'
          : state === 'adapter-incompatible'
            ? 'Use a compatible tool-capable executable or a versioned adapter wrapper.'
            : 'Inspect the enrolled executable and profile configuration.',
  };
}

async function probedChoice(choice, cwd, directory) {
  if (choice.status !== 'enrolled') {
    return {
      ...choice,
      readiness:
        choice.status === 'expired'
          ? {
              state: 'expired',
              dispatchable: false,
              nextAction: 'Renew this profile after inspecting its destination.',
            }
          : {
              state: 'profile-unavailable',
              dispatchable: false,
              code: choice.code,
              nextAction: 'Inspect or remove this profile.',
            },
    };
  }
  try {
    const prepared = await prepareProfile(choice.name, { directory, cwd });
    const backend = await inspectEnrolledBackend(prepared.profile);
    const readiness = profileReadiness(prepared.destination, backend);
    return {
      ...choice,
      destination: prepared.destination,
      backend,
      readiness,
      ready: readiness.state === 'ready' ? true : readiness.dispatchable ? null : false,
    };
  } catch (error) {
    return { ...choice, readiness: probeFailure(error), ready: false };
  }
}

async function probeChoices(choices, cwd, directory) {
  const results = new Array(choices.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, choices.length) }, async () => {
      while (next < choices.length) {
        const index = next++;
        results[index] = await probedChoice(choices[index], cwd, directory);
      }
    }),
  );
  return results;
}

export async function delegateRunnerCommand(action, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DelegateRunError('E_DELEGATE_INPUT', 'Command input must be one JSON object.');
  }
  if (
    ['dispatch', 'resume', 'recover', 'status', 'wait', 'close', 'cleanup'].includes(action) &&
    input.runId
  ) {
    const record = await readRunRecord(input.runId, { directory: input.runDirectory });
    const pinned = await verifiedHelper(record);
    if (pinned && resolve(fileURLToPath(import.meta.url)) !== pinned.runnerPath) {
      const module = await import(pathToFileURL(pinned.runnerPath).href);
      return module.delegateRunnerCommand(action, input);
    }
  }
  if (action === 'probe') {
    if (input.hostCapabilities?.localExecution === false) {
      throw new DelegateRunError(
        'E_DELEGATE_HOST_UNSUPPORTED',
        'This host cannot run the local delegation helper.',
      );
    }
    const cwd = input.repositoryRoot ? await realpath(input.repositoryRoot) : null;
    const profiles = await listProfiles({ directory: input.profileDirectory });
    const result = {
      ok: true,
      localExecutable: true,
      nodeVersion: process.versions.node,
      profiles: cwd ? await probeChoices(profiles, cwd, input.profileDirectory) : profiles,
    };
    if (input.profile !== undefined) {
      if (typeof input.profile !== 'string' || !input.repositoryRoot) {
        throw new DelegateRunError(
          'E_DELEGATE_INPUT',
          'Selected profile probe requires a profile name and repository root.',
        );
      }
      const prepared = await prepareProfile(input.profile, {
        directory: input.profileDirectory,
        cwd: await realpath(input.repositoryRoot),
      });
      const backend = await inspectEnrolledBackend(prepared.profile);
      const readiness = profileReadiness(prepared.destination, backend);
      result.selected = {
        name: prepared.profile.name,
        kind: prepared.profile.kind,
        destination: prepared.destination,
        selectedModel: backend.selectedModel ?? null,
        backend,
        readiness,
        ready: readiness.state === 'ready' ? true : readiness.dispatchable ? null : false,
      };
    }
    return result;
  }
  if (action === 'profile-preview') {
    if (!input.repositoryRoot)
      throw new DelegateRunError('E_DELEGATE_INPUT', 'Profile preview requires a repository root.');
    const preview = await previewProfileCandidate(input.profile, {
      directory: input.profileDirectory,
      cwd: await realpath(input.repositoryRoot),
    });
    return {
      profile: {
        name: preview.candidate.name,
        kind: preview.candidate.kind,
        selectedModel: preview.backend.selectedModel ?? null,
      },
      destination: preview.candidate.destination,
      previousDestination: preview.previousDestination,
      capabilities: preview.capabilities,
      backend: preview.backend,
      readiness: preview.readiness,
      ...(preview.enrollment ? { enrollment: preview.enrollment } : {}),
    };
  }
  if (action === 'profile-enroll') {
    if (!input.repositoryRoot || !input.expectedDestination) {
      throw new DelegateRunError(
        'E_DELEGATE_INPUT',
        'Profile enrollment requires a repository root and confirmed destination.',
      );
    }
    const expected = validateDestination(input.expectedDestination);
    const preview = await previewProfileCandidate(input.profile, {
      directory: input.profileDirectory,
      cwd: await realpath(input.repositoryRoot),
    });
    if (
      preview.candidate.destination.class !== expected.class ||
      preview.candidate.destination.origin !== expected.origin
    ) {
      throw new DelegateRunError(
        'E_DESTINATION_CHANGED',
        'Effective destination differs from the confirmed destination; inspect it before enrollment.',
      );
    }
    if (!preview.backend.selectedModel && input.allowBackendDefault !== true) {
      throw new DelegateRunError(
        'E_PROFILE_MODEL_CHOICE',
        'Select a model or explicitly choose the backend default before enrollment.',
      );
    }
    if (preview.readiness.state === 'model-unavailable') {
      throw new DelegateRunError(
        'E_DELEGATE_MODEL_UNAVAILABLE',
        'Selected local model is not visible; choose an available model before enrollment.',
      );
    }
    const enrolled = await enrollProfile(preview.candidate, { directory: input.profileDirectory });
    return {
      name: enrolled.name,
      kind: enrolled.kind,
      destination: enrolled.destination,
      selectedModel:
        enrolled.argv[0] === '--model' || enrolled.argv[0] === '-m' ? enrolled.argv[1] : null,
      expiresAt: enrolled.expiresAt,
      readiness: preview.readiness,
      nextAction: preview.readiness.dispatchable
        ? 'Continue the original request with this profile.'
        : preview.readiness.nextAction,
    };
  }
  if (action === 'profile-remove') {
    if (typeof input.name !== 'string')
      throw new DelegateRunError('E_DELEGATE_INPUT', 'Profile removal requires a name.');
    return {
      name: input.name,
      removed: await removeProfile(input.name, { directory: input.profileDirectory }),
    };
  }
  if (action === 'prepare') {
    integrationPaths(input.scopePaths);
    const durableRoot = resolve(homedir(), '.openplanr', 'delegate');
    const requested = resolve(input.runDirectory ?? defaultRunDirectory());
    if (!within(durableRoot, requested)) {
      throw new DelegateRunError(
        'E_DELEGATE_PRIVATE',
        'New CLI runs must use durable private storage under ~/.openplanr/delegate/.',
      );
    }
    if (input.worktreeParent && !within(durableRoot, resolve(input.worktreeParent))) {
      throw new DelegateRunError(
        'E_DELEGATE_PRIVATE',
        'New CLI worktrees must use durable private storage under ~/.openplanr/delegate/.',
      );
    }
    await mkdir(requested, { recursive: true, mode: 0o700 });
    const physical = await realpath(requested);
    const physicalDurableRoot = resolve(await realpath(homedir()), '.openplanr', 'delegate');
    if (!within(physicalDurableRoot, physical)) {
      throw new DelegateRunError(
        'E_DELEGATE_PRIVATE',
        'New CLI run storage resolves outside ~/.openplanr/delegate/.',
      );
    }
    if (input.worktreeParent) {
      await mkdir(input.worktreeParent, { recursive: true, mode: 0o700 });
      if (!within(physicalDurableRoot, await realpath(input.worktreeParent))) {
        throw new DelegateRunError(
          'E_DELEGATE_PRIVATE',
          'New CLI worktree storage resolves outside ~/.openplanr/delegate/.',
        );
      }
    }
    const prepared = await prepareDelegateRun(input);
    return {
      runId: prepared.runId,
      preview: prepared.preview,
      presentation: preparationPresentation(prepared.preview),
    };
  }
  if (action === 'dispatch' || action === 'resume') {
    const outcome =
      action === 'dispatch' ? await dispatchDelegateRun(input) : await resumeDelegateRun(input);
    return {
      runId: outcome.runId,
      status: outcome.status,
      ...(outcome.result ? { result: outcome.result } : {}),
      ...(outcome.nextAction ? { nextAction: outcome.nextAction } : {}),
      record: publicRecordView(outcome.record),
      presentation: handoffPresentation(outcome),
    };
  }
  if (action === 'recover') return publicRecordView(await recoverDelegateRun(input));
  if (action === 'status') return delegateRunStatus(input);
  if (action === 'wait') return waitDelegateRun(input);
  if (action === 'close') {
    const record = await withRunTransitionLock(input.runId, { directory: input.runDirectory }, () =>
      closeRunRecord(input.runId, {
        disposition: input.disposition,
        directory: input.runDirectory,
      }),
    );
    return {
      ...publicRecordView(record),
      ...(record.integration?.status === 'applied'
        ? {
            report: implementationReport(
              {
                status: 'completed',
                changedPaths: record.integration.changedPaths,
                checks: record.integration.checks,
              },
              record.selector,
            ),
          }
        : {}),
    };
  }
  if (action === 'cleanup') return cleanupDelegateRun(input);
  if (action === 'prune') {
    return { removed: await pruneClosedRunRecords({ directory: input.runDirectory }) };
  }
  throw new DelegateRunError('E_DELEGATE_COMMAND', 'Unknown delegate runner action.');
}

function publicRecordView(record) {
  return {
    runId: record.runId,
    status: record.status,
    repositoryRoot: record.repositoryRoot,
    integrationScopePaths: record.integrationScopePaths ?? null,
    capsulePath: record.capsulePath,
    custodyPath: record.custodyPath,
    worktreePath: record.worktreePath,
    initialHead: record.initialHead,
    initialIndex: record.initialIndex,
    profile: record.profileName,
    destination: record.destination,
    contextCapacity: record.contextCapacity ?? null,
    observedUsage: record.observedUsage ?? null,
    completionEvidence: record.completionEvidence ?? null,
    backendSessionId: record.backendSessionId,
    sessionEvidence: record.sessionEvidence ?? null,
    question: record.question,
    reportedBlocker: record.reportedBlocker,
    diagnostic: record.diagnostic,
    integrationRecovery: ['applying', 'interrupted'].includes(record.integration?.status)
      ? { ...record.integration }
      : null,
    delegateProcess: record.delegateProcess ?? null,
    cleanup: record.cleanup ?? null,
    integration: record.integration
      ? {
          status: record.integration.status,
          delegatePaths: record.integration.delegatePaths,
          generatedPaths: record.integration.generatedPaths,
          checks: record.integration.checks,
        }
      : null,
    planning: record.planning ? { ...record.planning, status: 'not-updated' } : null,
    helper: record.helper ?? null,
  };
}

if (
  process.argv[1] &&
  existsSync(resolve(process.argv[1])) &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
) {
  const interruption = new AbortController();
  const interrupted = () => interruption.abort();
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  try {
    const result = await delegateRunnerCommand(process.argv[2], {
      ...(await commandInput()),
      signal: interruption.signal,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        code: typeof error?.code === 'string' ? error.code : 'E_DELEGATE_UNKNOWN',
        message:
          typeof error?.code === 'string'
            ? error.message
            : 'Delegate command failed; inspect private run custody.',
        ...(error?.runId ? { runId: error.runId } : {}),
        ...(error?.details ? { details: error.details } : {}),
      })}\n`,
    );
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
  }
}
