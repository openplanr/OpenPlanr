// Validate retained context, enrollment and host setup before a delegate can execute.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateContextMirror } from './context.mjs';
import { inspectWorktreeSetup, validateWorktreeCustody } from './custody.mjs';
import { inspectEnrolledBackend, prepareProfile } from './profiles.mjs';
import {
  DelegateRunError,
  MAX_CAPSULE_BYTES,
  MAX_CUSTODY_BYTES,
  profileMatches,
  SHA256,
} from './run-contract.mjs';
import {
  defaultRunDirectory,
  readRunRecord,
  updateRunRecord,
  withRunTransitionLock,
} from './run-record.mjs';

export async function assertBackendReady(prepared, runId = null) {
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

export async function custodyAt(record, runDirectory) {
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
  if (record.setup) {
    const path = join(expectedRunPath, 'setup.json');
    const info = await lstat(path);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > MAX_CUSTODY_BYTES)
      throw new DelegateRunError('E_DELEGATE_SETUP', 'Setup snapshot is unsafe.', record.runId);
    const bytes = await readFile(path);
    if (createHash('sha256').update(bytes).digest('hex') !== record.setup.digest)
      throw new DelegateRunError('E_DELEGATE_SETUP', 'Setup snapshot changed.', record.runId);
    custody.setupFiles = JSON.parse(bytes.toString('utf8'));
  }
  return custody;
}

export async function readDelegateCustody({ runId, runDirectory = defaultRunDirectory() } = {}) {
  const record = await readRunRecord(runId, { directory: runDirectory });
  return custodyAt(record, runDirectory);
}

export async function capsuleIntegrity(record, runDirectory) {
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

export async function eligible(record, { runDirectory, profileDirectory, env, signal, timeoutMs }) {
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
  } catch (error) {
    throw new DelegateRunError(
      'E_DELEGATE_CUSTODY',
      'Worktree custody could not be inspected.',
      record.runId,
      { cause: error.code ?? error.name, ...error.details },
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
  if (record.status === 'prepared') {
    const setup = await inspectWorktreeSetup(custody);
    if (Object.keys(setup.files).length)
      throw new DelegateRunError(
        'E_DELEGATE_SETUP_UNACKNOWLEDGED',
        'Inspect setup-preview and accept its digest before dispatch; setup changes are host-authored.',
        record.runId,
        { paths: Object.keys(setup.files) },
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

export async function contextCapacity(record, prepared, env) {
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

export async function checkpointSetup(
  action,
  { runId, runDirectory = defaultRunDirectory(), expectedDigest } = {},
) {
  return withRunTransitionLock(runId, { directory: runDirectory }, async () => {
    const record = await readRunRecord(runId, { directory: runDirectory });
    if (record.status !== 'prepared' || record.backendSessionId || record.executionTiming)
      throw new DelegateRunError(
        'E_DELEGATE_SETUP_STATE',
        'Setup checkpoints are only allowed before first dispatch.',
        runId,
      );
    const custody = await custodyAt(record, runDirectory);
    const delta = await inspectWorktreeSetup(custody);
    const paths = Object.keys(delta.files);
    const preview = {
      runId,
      digest: delta.digest,
      paths,
      files: paths.map((path) => ({
        path,
        kind: delta.files[path].kind,
        bytes: delta.files[path].bytes ?? 0,
      })),
      attribution:
        'host-authored setup; excluded from delegate integration; immutable during execution',
    };
    if (action === 'setup-preview') return preview;
    if (expectedDigest !== delta.digest)
      throw new DelegateRunError(
        'E_DELEGATE_SETUP_DRIFT',
        'Setup changed since inspection; preview again.',
        runId,
      );
    const bytes = Buffer.from(JSON.stringify({ ...(custody.setupFiles ?? {}), ...delta.files }));
    if (bytes.length > MAX_CUSTODY_BYTES)
      throw new DelegateRunError(
        'E_DELEGATE_SETUP',
        'Setup snapshot exceeds its private size limit.',
        runId,
      );
    const temporary = join(record.runPath, `setup-${randomUUID()}.tmp`);
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, join(record.runPath, 'setup.json'));
    const setup = {
      paths: Object.keys(JSON.parse(bytes.toString('utf8'))),
      digest: createHash('sha256').update(bytes).digest('hex'),
      at: new Date().toISOString(),
      attribution: preview.attribution,
    };
    await updateRunRecord(runId, { setup }, { directory: runDirectory });
    return { ...preview, accepted: true, setup };
  });
}
