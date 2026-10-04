// Inspect and recover retained execution, report integration, and explicitly clean closed worktrees.
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { terminateProcessGroup } from './adapters/generic.mjs';
import { captureFileState, cleanupWorktreeCustody, validateWorktreeCustody } from './custody.mjs';
import { git, treeIdentity } from './integration-files.mjs';
import {
  implementationReport,
  liveExecutionTiming,
  runStatusPresentation,
} from './presentation.mjs';
import { blocked, DelegateRunError, sessionId } from './run-contract.mjs';
import { custodyAt } from './run-preflight.mjs';
import {
  closeRunRecord,
  defaultRunDirectory,
  processIdentityState,
  readRunRecord,
  updateRunRecord,
  verifyIntegrationState,
  withRunTransitionLock,
} from './run-record.mjs';

function abandonError(record, message) {
  return new DelegateRunError(
    'E_DELEGATE_ABANDON',
    `${message} The run and its worktree are retained for inspection.`,
    record.runId,
  );
}

function assertNeverStarted(record) {
  const closedAbandonment =
    record.status === 'closed' &&
    record.disposition === 'abandoned' &&
    record.abandonment?.kind === 'never-started';
  if (
    !(['prepared', 'blocked'].includes(record.status) || closedAbandonment) ||
    (record.sessionEvidence && record.sessionEvidence !== 'unavailable') ||
    record.delegateTerminationConfirmed === false ||
    [
      record.executionTiming,
      record.backendSessionId,
      record.activePid,
      record.hostProcess,
      record.delegateProcess,
      record.preparationHost,
      record.preparationProcess,
      record.preparationProvenance,
      record.setup,
      record.verification,
      record.integration,
      record.nativeProgress,
      record.completionEvidence,
    ].some(Boolean)
  )
    throw abandonError(
      record,
      'Only a run with no execution, session, setup or recovery work may be abandoned automatically.',
    );
}

async function abandonmentWorktreeExists(record, custody) {
  const target = custody.worktreePath;
  const parent = dirname(target);
  let physicalParent;
  try {
    physicalParent = await realpath(parent);
  } catch (error) {
    if (error.code === 'ENOENT' && record.status === 'closed') return false;
    throw error;
  }
  if (
    basename(target) !== 'worktree' ||
    !basename(parent).startsWith(`planr-delegate-${record.runId}-`) ||
    physicalParent !== parent
  )
    throw abandonError(record, 'The managed worktree location cannot be verified.');
  const ownerPath = join(parent, 'ownership.json');
  const ownerInfo = await lstat(ownerPath);
  if (
    !ownerInfo.isFile() ||
    ownerInfo.isSymbolicLink() ||
    ownerInfo.size > 4096 ||
    ownerInfo.mode & 0o077
  )
    throw abandonError(record, 'The managed worktree ownership file is unsafe.');
  const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
  if (
    owner.runId !== record.runId ||
    owner.custodyToken !== custody.custodyToken ||
    owner.repositoryRoot !== custody.repositoryRoot ||
    owner.worktreePath !== target ||
    (await readdir(parent)).some((name) => !['ownership.json', 'worktree'].includes(name))
  )
    throw abandonError(record, 'The worktree ownership or surrounding resources changed.');
  try {
    if ((await realpath(target)) !== target)
      throw abandonError(record, 'The managed worktree location changed.');
  } catch (error) {
    if (error.code === 'ENOENT' && record.status === 'closed') return false;
    throw error;
  }
  return true;
}

async function initialAbandonmentInventory(record, custody) {
  const target = custody.worktreePath;
  const check = await validateWorktreeCustody(custody, {
    native: Boolean(record.nativeSelection),
    inspectStatus: false,
  });
  if (
    !check.valid ||
    (record.initialHead && record.initialHead !== custody.initialHead) ||
    (record.initialIndex && record.initialIndex !== custody.initialIndex)
  )
    throw abandonError(record, 'The initial worktree HEAD, index or protected contents changed.');
  const entries = new Map(
    (await git(target, 'ls-tree', '-r', '-z', custody.initialHead))
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf('\t');
        return [entry.slice(separator + 1), entry.slice(0, separator)];
      }),
  );
  const paths = new Set(entries.keys());
  for (const path of Object.keys(custody.startingFiles ?? {})) paths.add(path);
  const directories = new Set();
  for (const path of paths) {
    let ancestor = dirname(path);
    while (ancestor !== '.') {
      directories.add(ancestor);
      ancestor = dirname(ancestor);
    }
  }
  return { entries, paths, directories };
}

async function assertNoUnknownResources(record, inventory, directory = '') {
  for (const entry of await readdir(join(record.worktreePath, directory), {
    withFileTypes: true,
  })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (path === '.git') continue;
    const expected = entry.isDirectory() ? inventory.directories : inventory.paths;
    if (!expected.has(path)) throw abandonError(record, `An unrecorded resource remains: ${path}.`);
    if (entry.isDirectory()) await assertNoUnknownResources(record, inventory, path);
  }
}

// Reconstruct the initial checkout without trusting Git's untracked/ignored filtering.
// Any unknown resource is retained, including empty directories and ignored dependencies.
async function assertUnchangedAbandonment(record, custody) {
  assertNeverStarted(record);
  if (!(await abandonmentWorktreeExists(record, custody))) return;
  const target = custody.worktreePath;
  const inventory = await initialAbandonmentInventory(record, custody);
  await assertNoUnknownResources(record, inventory);
  const objectFormat = (await git(target, 'rev-parse', '--show-object-format'))
    .toString('utf8')
    .trim();
  if (!['sha1', 'sha256'].includes(objectFormat))
    throw abandonError(record, 'The initial Git object format is unsupported.');
  for (const path of inventory.paths) {
    const actual = await captureFileState(target, path);
    if (
      !initialContentMatches(
        actual,
        custody.startingFiles?.[path],
        inventory.entries.get(path),
        objectFormat,
        custody.initialCheckoutFiles?.[path],
      )
    )
      throw abandonError(record, `Worktree content changed: ${path}.`);
  }
}

function initialContentMatches(actual, captured, treeEntry, objectFormat, checkout) {
  if (captured)
    return (
      actual.kind === captured.kind &&
      (actual.kind === 'absent' ||
        (actual.kind === 'file' &&
          actual.contentBase64 === captured.contentBase64 &&
          Boolean(actual.mode & 0o100) === Boolean(captured.mode & 0o100)) ||
        (actual.kind === 'symlink' && actual.target === captured.target))
    );
  if (checkout)
    return (
      actual.kind === 'file' &&
      checkout.kind === 'file' &&
      actual.bytes === checkout.bytes &&
      actual.digest === checkout.digest &&
      Boolean(actual.mode & 0o100) === Boolean(checkout.mode & 0o100)
    );
  const entry = /^(100644|100755|120000) blob ([a-f0-9]+)$/u.exec(treeEntry ?? '');
  if (!entry) return false;
  const symlink = entry[1] === '120000';
  if (actual.kind !== (symlink ? 'symlink' : 'file')) return false;
  if (!symlink && Boolean(actual.mode & 0o100) !== (entry[1] === '100755')) return false;
  const bytes = symlink ? Buffer.from(actual.target) : Buffer.from(actual.contentBase64, 'base64');
  const digest = createHash(objectFormat)
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
  return digest === entry[2];
}

export async function abandonDelegateRun({ runId, runDirectory = defaultRunDirectory() } = {}) {
  return withRunTransitionLock(runId, { directory: runDirectory }, async () => {
    let record = await readRunRecord(runId, { directory: runDirectory });
    assertNeverStarted(record);
    if (record.cleanup?.status === 'removed' || record.cleanup?.status === 'not-created')
      return record;
    if (record.worktreePath || record.custodyPath) {
      if (!record.worktreePath || !record.custodyPath)
        throw abandonError(record, 'Worktree custody preparation is incomplete.');
      await assertUnchangedAbandonment(record, await custodyAt(record, runDirectory));
    }
    record = await updateRunRecord(
      runId,
      { abandonment: { kind: 'never-started', checkedAt: new Date().toISOString() } },
      { directory: runDirectory },
    );
    record = await closeRunRecord(runId, { disposition: 'abandoned', directory: runDirectory });
    if (record.worktreePath) await cleanupAcceptedWorktree(record, runDirectory);
    else
      await updateRunRecord(
        runId,
        { cleanup: { status: 'not-created', at: new Date().toISOString() } },
        { directory: runDirectory },
      );
    return readRunRecord(runId, { directory: runDirectory });
  });
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

export async function recoverOwnedProcesses(record, runDirectory) {
  if (record.delegateTerminationConfirmed === false) {
    if (['running', 'resuming'].includes(record.status)) {
      const state = await executionProcessState(record);
      if (state === 'alive' || state === 'unknown')
        throw new DelegateRunError('E_RUN_LOCKED', 'The owned delegate is still running.');
    }
    if (!record.delegateProcess)
      throw new DelegateRunError(
        'E_DELEGATE_PROCESS',
        'Native termination is unconfirmed and its process identity is unavailable. Inspect the retained run before continuing.',
      );
    await terminateProcessGroup(record.delegateProcess);
    record = await updateRunRecord(
      record.runId,
      {
        delegateProcess: null,
        delegateTerminationConfirmed: true,
      },
      { directory: runDirectory },
    );
  }
  for (const [field, host] of [
    ['verification', record.verification?.process],
    ['preparation', record.preparationHost],
  ]) {
    const identity =
      field === 'verification' ? record.verification?.commandProcess : record.preparationProcess;
    if (!identity) continue;
    const state = await processIdentityState(host);
    const finished =
      field === 'verification'
        ? record.verification?.status === 'blocked'
        : ['failed', 'interrupted'].includes(record.preparationProvenance?.status);
    if (!finished && !['exited', 'reused'].includes(state))
      throw new DelegateRunError('E_RUN_LOCKED', 'An owned parent command is still running.');
    await terminateProcessGroup(identity);
    const changes =
      field === 'verification'
        ? {
            verification: {
              ...record.verification,
              commandProcess: null,
              status: 'blocked',
              code: 'E_INTEGRATION_INTERRUPTED',
            },
          }
        : {
            preparationProcess: null,
            preparationProvenance: { ...record.preparationProvenance, status: 'interrupted' },
          };
    record = await updateRunRecord(record.runId, changes, { directory: runDirectory });
  }
  return record;
}

export async function recoverDelegateRun({ runId, runDirectory = defaultRunDirectory() } = {}) {
  return withRunTransitionLock(runId, { directory: runDirectory }, async () => {
    let record = await readRunRecord(runId, { directory: runDirectory });
    if (['running', 'resuming', 'preparing'].includes(record.status)) {
      const state = await executionProcessState(record);
      if (state === 'alive' || state === 'unknown') return record;
    }
    record = await recoverOwnedProcesses(record, runDirectory);
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

export async function cleanupAcceptedWorktree(record, runDirectory) {
  if (record.cleanup?.status === 'removed') return record.cleanup;
  const disposition = record.disposition === 'integrated' ? 'accepted' : 'abandoned';
  if (record.status !== 'closed')
    throw new DelegateRunError(
      'E_DELEGATE_CLEANUP',
      'Only closed runs may remove their owned worktree.',
    );
  const unstarted = record.abandonment?.kind === 'never-started';
  if (unstarted) await assertUnchangedAbandonment(record, await custodyAt(record, runDirectory));
  else {
    await recoverOwnedProcesses(record, runDirectory);
    if (record.delegateProcess) await terminateProcessGroup(record.delegateProcess);
  }
  const result = await cleanupWorktreeCustody(await custodyAt(record, runDirectory), {
    disposition,
    beforeRemove: async (target) => {
      if (unstarted)
        await assertUnchangedAbandonment(record, await custodyAt(record, runDirectory));
      if (
        record.nativeSelection &&
        record.integration?.worktreeIdentity &&
        (await treeIdentity(target)) !== record.integration.worktreeIdentity
      )
        throw new DelegateRunError(
          'E_DELEGATE_CLEANUP_DRIFT',
          'Owned worktree changed after acceptance; retain it for inspection.',
        );
    },
  });
  const cleanup = { ...result, status: 'removed', at: new Date().toISOString() };
  await updateRunRecord(record.runId, { cleanup }, { directory: runDirectory });
  return cleanup;
}

export async function cleanupDelegateRun({
  runId,
  disposition,
  runDirectory = defaultRunDirectory(),
} = {}) {
  return withRunTransitionLock(runId, { directory: runDirectory }, async () => {
    const record = await readRunRecord(runId, { directory: runDirectory });
    if (disposition !== (record.disposition === 'integrated' ? 'accepted' : 'abandoned'))
      throw new DelegateRunError(
        'E_DELEGATE_CLEANUP',
        'Cleanup disposition does not match this run.',
      );
    return cleanupAcceptedWorktree(record, runDirectory);
  });
}

export async function delegateRunStatus({ runId, runDirectory = defaultRunDirectory() } = {}) {
  const record = await readRunRecord(runId, { directory: runDirectory });
  const integrationCheck = await verifyIntegrationState(record);
  const custody = record.custodyPath ? await custodyAt(record, runDirectory) : null;
  const active = ['preparing', 'running', 'resuming'].includes(record.status);
  const processState = active ? await executionProcessState(record) : 'none';
  const unresolvedIntegration = ['applying', 'interrupted'].includes(record.integration?.status);
  const verificationProcessState =
    record.verification?.status === 'running'
      ? await processIdentityState(record.verification.process)
      : 'none';
  const verificationInterrupted = ['exited', 'reused'].includes(verificationProcessState);
  const presentation = runStatusPresentation(
    record,
    integrationCheck,
    processState,
    verificationInterrupted,
  );
  return {
    runId: record.runId,
    status: record.status,
    phase: presentation.phase,
    elapsedMs: Math.max(
      0,
      Date.parse(record.closedAt ?? new Date().toISOString()) - Date.parse(record.createdAt),
    ),
    timings: {
      preparation: record.preparationTiming ?? null,
      execution: liveExecutionTiming(record),
      verification: record.verification
        ? {
            durationMs: record.verification.durationMs ?? null,
            phases: record.verification.phases,
          }
        : null,
    },
    verification: record.verification ?? null,
    verificationProcessState,
    lastActivityAt: record.lastActivityAt ?? record.updatedAt,
    inactivityMs: Math.max(0, Date.now() - Date.parse(record.lastActivityAt ?? record.updatedAt)),
    nativeProgress: record.nativeProgress ?? null,
    preparationProvenance: record.preparationProvenance ?? null,
    nativeSummary: record.nativeSummary ?? null,
    observedModel: record.observedModel ?? null,
    nativeWarnings: record.nativeWarnings ?? [],
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
    setup: record.setup ?? null,
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
          verified: record.integration.verified ?? false,
          reviewOnlyReason: record.integration.reviewOnlyReason ?? null,
          preparation: record.integration.preparation ?? [],
          driftPaths: integrationCheck.driftPaths,
          ...(integrationCheck.inspectionFailures
            ? { inspectionFailures: integrationCheck.inspectionFailures }
            : {}),
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
              nativeWarnings: record.nativeWarnings ?? [],
              cleanup: record.cleanup,
              verified: record.integration.verified ?? false,
              reviewOnlyReason: record.integration.reviewOnlyReason ?? null,
            },
            record.selector,
          ),
        }
      : {}),
    nextAction: presentation.nextAction,
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
