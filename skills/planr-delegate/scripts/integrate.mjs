import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { lstat, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureFileState } from './custody.mjs';
import { integrateBranchDelta, recoverBranchApply, reviewBranchDelta } from './handoff.mjs';
import { verifiedHelper } from './helper-snapshot.mjs';
import { resolveSelectedChecks } from './integration-checks.mjs';
import { covers, git, IntegrationError } from './integration-files.mjs';
import { implementationReport, reviewPresentation } from './presentation.mjs';
import { cleanupAcceptedWorktree, recoverOwnedProcesses } from './run-lifecycle.mjs';
import { readDelegateCustody, validateDelegateCapsule } from './run-preflight.mjs';
import {
  assertRunRecordFits,
  closeRunRecord,
  compactIntegrationState,
  processIdentity,
  readRunRecord,
  updateRunRecord,
  withRunTransitionLock,
} from './run-record.mjs';

export { discoverDelegateChecks, runDelegateChecks } from './integration-checks.mjs';
export { IntegrationError } from './integration-files.mjs';

function publicReview(review) {
  return {
    ready: review.ready,
    changedPaths: review.changedPaths,
    violations: review.violations,
    warnings: review.warnings ?? [],
    patch: review.patch.map(({ path, before, after }) => ({
      path,
      origin: review.changes?.find((change) => change.path === path)?.origin ?? 'delegate',
      before: { kind: before.kind, mode: before.mode ?? null, bytes: before.bytes ?? null },
      after: { kind: after.kind, mode: after.mode ?? null, bytes: after.bytes ?? null },
    })),
  };
}

async function privateCapsule(record) {
  if (!record.capsulePath?.startsWith(`${record.runPath}${sep}`)) {
    throw new IntegrationError('E_INTEGRATION_CAPSULE', 'Run capsule pointer is invalid.');
  }
  const info = await lstat(record.capsulePath);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 32 * 1024 * 1024) {
    throw new IntegrationError('E_INTEGRATION_CAPSULE', 'Run capsule is unsafe or oversized.');
  }
  const capsule = JSON.parse(await readFile(record.capsulePath, 'utf8'));
  if (capsule.kind !== 'openplanr-delegation-context-capsule') {
    throw new IntegrationError('E_INTEGRATION_CAPSULE', 'Run capsule has an unsupported format.');
  }
  return capsule;
}

export async function delegateIntegrationCommand(action, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !input.runId) {
    throw new IntegrationError('E_INTEGRATION_INPUT', 'A run identifier is required.');
  }
  if (!['review', 'apply', 'recover'].includes(action)) {
    throw new IntegrationError('E_INTEGRATION_COMMAND', 'Unknown integration action.');
  }
  const record = await readRunRecord(input.runId, { directory: input.runDirectory });
  const pinned = await verifiedHelper(record);
  if (pinned && resolve(fileURLToPath(import.meta.url)) !== pinned.integrationPath) {
    const module = await import(pathToFileURL(pinned.integrationPath).href);
    return module.delegateIntegrationCommand(action, input);
  }
  if (!pinned && action !== 'recover')
    throw new IntegrationError(
      'E_DELEGATE_HELPER_REQUIRED',
      'This record has no pinned helper; inspect it read-only and prepare a new run.',
    );
  return withRunTransitionLock(input.runId, { directory: input.runDirectory }, async () => {
    const current = await readRunRecord(input.runId, { directory: input.runDirectory });
    return integrationCommandLocked(action, input, current);
  });
}

async function closeIntegrated(record, runDirectory) {
  const closed = await closeRunRecord(record.runId, {
    disposition: 'integrated',
    directory: runDirectory,
  });
  if (!closed.nativeSelection || closed.retainWorktree) return undefined;
  try {
    return await cleanupAcceptedWorktree(closed, runDirectory);
  } catch (error) {
    const cleanup = { status: 'failed', code: error.code ?? 'E_DELEGATE_CLEANUP' };
    await updateRunRecord(record.runId, { cleanup }, { directory: runDirectory });
    return cleanup;
  }
}

async function recoverBranchIntegration(input, record) {
  const integration = record.integration;
  if (!['applying', 'interrupted'].includes(integration?.status))
    throw new IntegrationError('E_INTEGRATION_RECOVERY', 'This run has no unresolved integration.');
  const result = await recoverBranchApply(record, input.resolution);
  const directory = { directory: input.runDirectory };
  if (result.state === 'applied') {
    const { status: _status, ...accepted } = integration;
    const states = {};
    for (const path of accepted.changedPaths)
      states[path] = compactIntegrationState(await captureFileState(record.repositoryRoot, path));
    await updateRunRecord(
      record.runId,
      { integration: { ...accepted, status: 'applied', at: new Date().toISOString(), states } },
      directory,
    );
    await removeRestoreRef(record);
    return {
      cleanup: await closeIntegrated(record, input.runDirectory),
      runId: record.runId,
      status: 'completed',
      report: implementationReport({ status: 'completed', ...accepted }, record.selector),
      recovered: 'accepted',
    };
  }
  await updateRunRecord(
    record.runId,
    {
      integration: {
        ...integration,
        status: result.state,
        restoredPaths: result.restored,
        rollbackErrors: result.conflicts,
      },
    },
    directory,
  );
  if (result.state === 'rolled-back') await removeRestoreRef(record);
  return {
    runId: record.runId,
    status: result.conflicts.length ? 'blocked' : 'completed',
    recovered: result.conflicts.length ? 'conflicts' : 'rolled-back',
    rollbackErrors: result.conflicts,
    nextAction: result.conflicts.length
      ? 'Preserve conflicting host edits and resolve the listed paths explicitly.'
      : 'Review the retained patch again before retrying apply.',
  };
}

async function removeRestoreRef(record) {
  const ref = record.integration.restoreRef;
  if (ref && (await git(record.repositoryRoot, 'for-each-ref', ref)).length)
    await git(record.repositoryRoot, 'update-ref', '-d', ref);
}

async function integrationCommandLocked(action, input, record) {
  record = await recoverOwnedProcesses(record, input.runDirectory);
  if (action === 'recover') return recoverBranchIntegration(input, record);
  if (['applying', 'interrupted'].includes(record.integration?.status))
    throw new IntegrationError(
      'E_RUN_INTEGRATION_RECOVERY',
      'Integration is unresolved; use integrate recover before review or apply.',
    );
  if (action === 'apply' && record.integration?.status === 'applied') {
    throw new IntegrationError(
      'E_INTEGRATION_ALREADY_APPLIED',
      'This run has already been integrated; review later changes as separate work.',
    );
  }
  const scopePaths = input.scopePaths ?? record.integrationScopePaths;
  if (
    record.integrationScopePaths &&
    (!Array.isArray(scopePaths) ||
      scopePaths.some(
        (path) => !record.integrationScopePaths.some((recorded) => covers(recorded, path)),
      ))
  ) {
    throw new IntegrationError(
      'E_INTEGRATION_SCOPE_WIDENED',
      'Integration scope cannot exceed the paths previewed before dispatch.',
    );
  }
  const capsuleCheck = await validateDelegateCapsule({
    runId: input.runId,
    runDirectory: input.runDirectory,
  });
  if (!capsuleCheck.valid) {
    const blocked = {
      runId: input.runId,
      ...(action === 'apply' ? { status: 'blocked' } : {}),
      ready: false,
      changedPaths: [],
      violations: [
        { code: capsuleCheck.code, message: 'Prepared delegate context changed during the run.' },
      ],
      patch: [],
      ...(action === 'apply'
        ? {
            checks: [],
            code: capsuleCheck.code,
            nextAction:
              'Retain the worktree for review and prepare a new delegate run from trusted context.',
          }
        : {}),
    };
    return action === 'review'
      ? { ...blocked, presentation: reviewPresentation(blocked) }
      : { ...blocked, report: implementationReport(blocked) };
  }
  const custody = await readDelegateCustody({
    runId: input.runId,
    runDirectory: input.runDirectory,
  });
  const common = {
    custody,
    run: record,
    scopePaths,
    preservePaths: input.preservePaths,
  };
  if (action === 'review') {
    const observed = await reviewBranchDelta(common);
    if (observed.ready)
      await updateRunRecord(
        input.runId,
        {
          verificationMutations:
            record.verification?.mutatedPaths ?? record.verificationMutations ?? [],
          reviewedPatch: {
            digest: observed.tip,
            at: new Date().toISOString(),
            scopePaths,
          },
        },
        { directory: input.runDirectory },
      );
    const review = { runId: input.runId, ...publicReview(observed) };
    return { ...review, presentation: reviewPresentation(review) };
  }
  if (!record.reviewedPatch?.digest)
    throw new IntegrationError(
      'E_INTEGRATION_REVIEW_REQUIRED',
      'Review the exact delegate patch before apply.',
    );
  if (
    record.verification?.status === 'blocked' &&
    Array.isArray(input.checks) &&
    input.checks.length === 0
  )
    throw new IntegrationError(
      'E_INTEGRATION_CHECKS_REQUIRED',
      'A failed verification cannot be retried with zero checks. Choose appropriate checks and preserve the earlier evidence.',
    );
  const previousFailures = (record.verification?.checks ?? []).filter(
    (check) => check.status !== 'passed',
  );
  if (previousFailures.length) {
    const selected = await resolveSelectedChecks(record.worktreePath, input.checks, {
      legacy: !record.nativeSelection,
    });
    const missing = previousFailures.filter(
      (old) =>
        !selected.some(
          (check) =>
            (check.executable ?? check.command) === old.executable &&
            JSON.stringify(check.args) === JSON.stringify(old.args) &&
            (check.cwd ?? '.') === (old.cwd ?? '.'),
        ),
    );
    if (missing.length && !input.checkSelectionReason)
      throw new IntegrationError(
        'E_INTEGRATION_CHECK_SELECTION',
        'Narrowing previously failed checks requires checkSelectionReason. Earlier failure evidence is retained.',
      );
  }
  const capsule = await privateCapsule(record);
  const verificationProcess = await processIdentity();
  const evidencePath = join(record.runPath, `verification-${randomUUID()}.json`);
  let verification;
  const result = await integrateBranchDelta({
    ...common,
    patchPath: join(record.runPath, 'patch.diff'),
    onApplying: async (accepted) => {
      const placeholder = { kind: 'file', mode: 0o644, digest: '0'.repeat(64) };
      const current = await readRunRecord(record.runId, { directory: input.runDirectory });
      assertRunRecordFits({
        ...current,
        integration: {
          status: 'applied',
          ...accepted,
          states: Object.fromEntries(accepted.changedPaths.map((path) => [path, placeholder])),
        },
        status: 'closed',
        disposition: 'integrated',
        closedAt: new Date().toISOString(),
      });
      await updateRunRecord(
        record.runId,
        { integration: { status: 'applying', phase: 'source-write', ...accepted } },
        { directory: input.runDirectory },
      );
    },
    checks: input.checks,
    preparation: input.preparation,
    baselineComparison: input.baselineComparison === true,
    reviewOnlyReason: input.reviewOnlyReason,
    onVerification: async (evidence) => {
      verification = {
        ...evidence,
        process: verificationProcess,
        evidencePath,
        attempt: (record.verification?.attempt ?? 0) + 1,
        priorEvidencePath: record.verification?.evidencePath ?? null,
        checkSelectionReason: input.checkSelectionReason ?? null,
      };
      const temporary = `${evidencePath}.tmp`;
      await writeFile(temporary, `${JSON.stringify(verification)}\n`, {
        mode: 0o600,
      });
      await rename(temporary, evidencePath);
      try {
        await updateRunRecord(record.runId, { verification }, { directory: input.runDirectory });
      } catch (error) {
        if (error.code !== 'E_RUN_LIMIT' || evidence.status === 'running') throw error;
      }
    },
    generators: input.generators,
    timeoutMs: input.timeoutMs,
    reviewedDigest: record.reviewedPatch.digest,
    onAccepted: async (integration) =>
      updateRunRecord(
        input.runId,
        {
          integration: { status: 'applied', at: new Date().toISOString(), ...integration },
        },
        { directory: input.runDirectory },
      ),
    onRolledBack: async ({ code }) => {
      const current = await readRunRecord(record.runId, { directory: input.runDirectory });
      if (current.integration?.status !== 'applying') return;
      await updateRunRecord(
        record.runId,
        {
          integration: { ...current.integration, status: 'rolled-back', rollbackErrors: [], code },
        },
        { directory: input.runDirectory },
      );
    },
  });
  const output = {
    runId: input.runId,
    nativeWarnings: record.nativeWarnings ?? [],
    status: result.status,
    ...publicReview(result),
    checks: result.checks ?? [],
    verification: verification ?? null,
    generatedPaths: result.generatedPaths ?? [],
    unselectedDirtyPaths: result.unselectedDirtyPaths ?? [],
    unselectedDirtyCount: result.unselectedDirtyCount ?? 0,
    generators: result.generators ?? [],
    code: result.code ?? null,
    rollbackErrors: result.rollbackErrors ?? [],
    nextAction: result.nextAction,
  };
  if (result.status === 'completed') {
    output.cleanup = await closeIntegrated(record, input.runDirectory);
    if (output.cleanup?.status === 'failed')
      output.violations.push({
        code: output.cleanup.code,
        message: 'Integration succeeded; owned worktree cleanup needs attention.',
      });
  }
  return {
    ...output,
    nativeWarnings: record.nativeWarnings ?? [],
    planning: record.planning ? { ...record.planning, status: 'not-updated' } : null,
    report: implementationReport(output, capsule.selector),
  };
}

if (
  process.argv[1] &&
  existsSync(resolve(process.argv[1])) &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
) {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 64 * 1024)
        throw new IntegrationError('E_INTEGRATION_INPUT', 'Command input is oversized.');
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    process.stdout.write(
      `${JSON.stringify(await delegateIntegrationCommand(process.argv[2], input))}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        code: typeof error?.code === 'string' ? error.code : 'E_INTEGRATION_UNKNOWN',
        message:
          typeof error?.code === 'string'
            ? error.message
            : 'Integration failed; inspect retained custody.',
        ...(error.details ? { details: error.details } : {}),
      })}\n`,
    );
    process.exitCode = 1;
  }
}
