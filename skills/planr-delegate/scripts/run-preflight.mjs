// Validate retained context, enrollment and host setup before a delegate can execute.
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AdapterError } from './adapters/generic.mjs';
import { safeAdapterDetails } from './adapters/native.mjs';
import { validateContextMirror } from './context.mjs';
import { inspectWorktreeSetup, validateWorktreeCustody } from './custody.mjs';
import { resolveSelectedChecks, runDelegateChecks } from './integration-checks.mjs';
import { inspectEnrolledBackend, prepareProfile } from './profiles.mjs';
import {
  DelegateRunError,
  MAX_CAPSULE_BYTES,
  MAX_CUSTODY_BYTES,
  profileMatches,
  SHA256,
} from './run-contract.mjs';
import { recoverOwnedProcesses } from './run-lifecycle.mjs';
import {
  defaultRunDirectory,
  processIdentity,
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
    prepared = await prepareProfile(record.nativeSelection ?? record.profileName, {
      directory: profileDirectory ?? record.profileDirectory,
      cwd: record.worktreePath,
      env,
      signal,
      timeoutMs,
    });
  } catch (error) {
    const details =
      error instanceof AdapterError
        ? safeAdapterDetails(error.details, record.destination)
        : error.details;
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
        'Effective destination changed; inspect routing and prepare a new preview. The prepared run and any recorded session remain retained.',
        record.runId,
        details,
      );
    }
    throw new DelegateRunError(
      typeof error?.code === 'string' ? error.code : 'E_DELEGATE_PROFILE',
      typeof error?.code === 'string'
        ? error.message
        : 'Profile eligibility failed; inspect enrollment and effective destination.',
      record.runId,
      details,
    );
  }
  if (!profileMatches(record, prepared)) {
    const changes = profileChanges(record, prepared);
    throw new DelegateRunError(
      'E_DELEGATE_PROFILE_CHANGED',
      `The prepared selection changed (${changes.map((change) => change.field).join(', ')}). Inspect the before/after values and prepare a new preview; the prepared run and any recorded session remain retained.`,
      record.runId,
      { changes, nextAction: 'prepare' },
    );
  }
  if (!record.nativeSelection) await assertBackendReady(prepared, record.runId);
  const custody = await custodyAt(record, runDirectory);
  let check;
  try {
    check = await validateWorktreeCustody(custody, { native: Boolean(record.nativeSelection) });
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
  if (record.status === 'prepared' && !record.nativeSelection) {
    const setup = await inspectWorktreeSetup(custody);
    if (Object.keys(setup.files).length)
      throw new DelegateRunError(
        'E_DELEGATE_SETUP_UNACKNOWLEDGED',
        'Inspect setup-preview and accept its digest before dispatch; setup changes are host-authored.',
        record.runId,
        { paths: Object.keys(setup.files) },
      );
  }
  if (record.nativeSelection && record.status === 'prepared' && !record.preparationProvenance) {
    const delta = await inspectWorktreeSetup(custody, { native: true });
    const provenance = {
      status: 'observed',
      paths: Object.keys(delta.files),
      attribution: 'parent preparation; tracked changes join the candidate',
      at: new Date().toISOString(),
    };
    await writeFile(
      join(record.runPath, 'preparation.json'),
      JSON.stringify({ ...provenance, files: delta.files }),
      { mode: 0o600 },
    );
    await updateRunRecord(
      record.runId,
      { preparationProvenance: provenance },
      { directory: runDirectory },
    );
  }
  if (record.preparationProvenance?.status === 'failed')
    throw new DelegateRunError(
      'E_DELEGATE_PREPARATION',
      'Preparation failed. Fix the recorded prerequisite and retry prepare-worktree.',
    );
  const capsuleCheck = await capsuleIntegrity(record, runDirectory);
  if (!capsuleCheck.valid) {
    throw new DelegateRunError(
      'E_DELEGATE_CAPSULE_DRIFT',
      'Private capsule changed or became unreadable; inspect the retained run before dispatch.',
      record.runId,
      capsuleCheck.details,
    );
  }
  const capacity = await contextCapacity(record, prepared, env);
  await updateRunRecord(record.runId, { contextCapacity: capacity }, { directory: runDirectory });
  return prepared;
}

function profileChanges(record, prepared) {
  const previous = record.nativeSelection;
  const current = prepared.profile;
  const candidates = [
    ['profile', record.profileName, current.name],
    ['engine', record.backend, current.kind],
    ['destination', record.destination, prepared.destination],
    ...(previous
      ? [
          ['model', previous.argv?.[1] ?? null, current.argv?.[1] ?? null],
          ['configDir', previous.configDir ?? null, current.configDir ?? null],
          ['executable', previous.executable, current.executable],
        ]
      : []),
  ];
  const changes = candidates
    .filter(([, before, after]) => JSON.stringify(before) !== JSON.stringify(after))
    .map(([field, before, after]) => ({ field, before, after }));
  return changes.length
    ? changes
    : [
        {
          field: 'profile configuration',
          before: 'prepared identity',
          after: 'different identity',
        },
      ];
}

export async function contextCapacity(record, prepared, env) {
  const capsuleBytes = (await lstat(record.capsulePath)).size;
  const capsule = JSON.parse(await readFile(record.capsulePath, 'utf8'));
  const inventory = capsule.inventory ?? [];
  const contextBytes = inventory.reduce((total, file) => total + file.bytes, 0);
  const requiredFiles = inventory.filter((file) => file.required);
  const metrics = {
    capsuleBytes,
    contextBytes,
    requiredFileCount: requiredFiles.length,
    optionalFileCount: inventory.length - requiredFiles.length,
    requiredBytes: requiredFiles.reduce((total, file) => total + file.bytes, 0),
    largestFiles: [...inventory]
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 5)
      .map(({ repositoryKey, path, bytes, required }) => ({
        repositoryKey,
        path,
        bytes,
        required,
      })),
    tokenEstimate: 'unverified: no matching tokenizer',
    durationEstimate: 'unverified: no measured task throughput',
    ...(prepared.destination.class === 'local'
      ? {
          guidance:
            'Local inference speed depends on the model, hardware and tool loop. Select only relevant sources and split large tasks before preparing a new run. Required sources remain complete; optional background is read when needed.',
        }
      : {}),
  };
  if (prepared.destination.class !== 'local' || prepared.profile.argv.length !== 2)
    return { state: 'unverified', ...metrics, modelContextTokens: null };
  const backend = await inspectEnrolledBackend(prepared.profile, {
    env,
    cwd: record.worktreePath ?? record.repositoryRoot,
  });
  const modelContextTokens = backend.contextLength ?? null;
  if (!modelContextTokens)
    return { state: 'unverified', ...metrics, modelContextTokens: null, backend };
  // The decoded mirror is read by native tools; serialized/base64 package bytes
  // are not the prompt. UTF-8 bytes give a conservative pressure diagnostic, not
  // an exact tokenizer result. Leave room
  // for the host's instructions, tool schemas, conversation, and model output.
  const reserveTokens = Math.max(4096, Math.ceil(modelContextTokens / 4));
  const textByteBound = contextBytes + Buffer.byteLength(capsule.request ?? capsule.brief ?? '');
  if (!record.nativeSelection && textByteBound + reserveTokens > modelContextTokens)
    throw new DelegateRunError(
      'E_DELEGATE_CONTEXT_CAPACITY',
      'The required capsule exceeds a conservative bound for the loaded model context; use a larger context or narrow the task before dispatch.',
      record.runId,
    );
  return {
    state:
      textByteBound + reserveTokens > modelContextTokens
        ? 'context-pressure-diagnostic'
        : 'within-conservative-bound',
    ...metrics,
    textByteBound,
    modelContextTokens,
    reserveTokens,
    backend,
  };
}

export async function prepareOwnedWorktree({
  runId,
  runDirectory = defaultRunDirectory(),
  commands = [],
} = {}) {
  return withRunTransitionLock(runId, { directory: runDirectory }, async () => {
    const record = await recoverOwnedProcesses(
      await readRunRecord(runId, { directory: runDirectory }),
      runDirectory,
    );
    if (record.status !== 'prepared' || record.backendSessionId || !record.nativeSelection)
      throw new DelegateRunError(
        'E_DELEGATE_SETUP_STATE',
        'Prepare dependencies before the first native dispatch.',
      );
    if (record.preparationProvenance?.status === 'passed') return record.preparationProvenance;
    const started = Date.now();
    const selected = await resolveSelectedChecks(record.worktreePath, commands);
    await updateRunRecord(
      runId,
      { preparationProvenance: { status: 'running', startedAt: new Date().toISOString() } },
      { directory: runDirectory },
    );
    const results = await runDelegateChecks({
      repositoryRoot: record.worktreePath,
      checks: selected,
      onProcess: async (identity) =>
        updateRunRecord(
          runId,
          { preparationProcess: identity, preparationHost: await processIdentity() },
          { directory: runDirectory },
        ),
      stopOnFailure: true,
    });
    const custody = await custodyAt(record, runDirectory);
    const delta = await inspectWorktreeSetup(custody, { native: true });
    const provenance = {
      status: results.every((result) => result.status === 'passed') ? 'passed' : 'failed',
      paths: Object.keys(delta.files),
      checks: results,
      durationMs: Date.now() - started,
      attribution: 'parent preparation; tracked changes join the scoped candidate',
      at: new Date().toISOString(),
    };
    await writeFile(
      join(record.runPath, 'preparation.json'),
      JSON.stringify({ ...provenance, files: delta.files }),
      { mode: 0o600 },
    );
    await updateRunRecord(
      runId,
      { preparationProvenance: provenance },
      { directory: runDirectory },
    );
    return provenance;
  });
}
