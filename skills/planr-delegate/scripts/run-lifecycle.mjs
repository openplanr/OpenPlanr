// Inspect and recover retained execution, report integration, and explicitly clean closed worktrees.
import { setTimeout as delay } from 'node:timers/promises';
import { terminateProcessGroup } from './adapters/generic.mjs';
import { cleanupWorktreeCustody } from './custody.mjs';
import { implementationReport, runStatusPresentation } from './presentation.mjs';
import { blocked, DelegateRunError, sessionId } from './run-contract.mjs';
import { custodyAt } from './run-preflight.mjs';
import {
  defaultRunDirectory,
  processIdentityState,
  readRunRecord,
  updateRunRecord,
  verifyIntegrationState,
  withRunTransitionLock,
} from './run-record.mjs';

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
      execution: record.executionTiming ?? null,
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
          preparation: record.integration.preparation ?? [],
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
