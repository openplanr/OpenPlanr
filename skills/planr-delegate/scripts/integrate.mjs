import { createHash, randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { lstat, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureFileState } from './custody.mjs';
import { verifiedHelper } from './helper-snapshot.mjs';
import { covers, IntegrationError, rollbackWritten, sameState } from './integration-files.mjs';
import {
  checkoutLock,
  integrateDelegateDelta,
  patchDigest,
  reviewDelegateDelta,
} from './integration-transaction.mjs';
import { implementationReport, reviewPresentation } from './presentation.mjs';
import { readDelegateCustody, validateDelegateCapsule } from './run-preflight.mjs';
import {
  assertRunRecordFits,
  closeRunRecord,
  processIdentity,
  readRunRecord,
  updateRunRecord,
  withRunTransitionLock,
} from './run-record.mjs';

export { discoverDelegateChecks, runDelegateChecks } from './integration-checks.mjs';
export { IntegrationError } from './integration-files.mjs';
export { integrateDelegateDelta, reviewDelegateDelta } from './integration-transaction.mjs';

function publicReview(review) {
  return {
    ready: review.ready,
    changedPaths: review.changedPaths,
    violations: review.violations,
    patch: review.patch.map(({ path, before, after }) => ({
      path,
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

async function writeJournal(path, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > 32 * 1024 * 1024)
    throw new IntegrationError(
      'E_INTEGRATION_JOURNAL_LIMIT',
      'Integration recovery states exceed the private limit.',
    );
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
  return createHash('sha256').update(bytes).digest('hex');
}

async function recoverIntegration(input, record) {
  const integration = record.integration;
  if (!['applying', 'interrupted'].includes(integration?.status))
    throw new IntegrationError('E_INTEGRATION_RECOVERY', 'This run has no unresolved integration.');
  if (integration.journalPath !== join(record.runPath, 'integration-journal.json'))
    throw new IntegrationError(
      'E_INTEGRATION_JOURNAL',
      'Integration recovery journal pointer is invalid.',
    );
  const details = await lstat(integration.journalPath);
  if (!details.isFile() || details.mode & 0o077 || details.size > 32 * 1024 * 1024)
    throw new IntegrationError('E_INTEGRATION_JOURNAL', 'Integration recovery journal is unsafe.');
  const bytes = await readFile(integration.journalPath);
  if (createHash('sha256').update(bytes).digest('hex') !== integration.journalDigest)
    throw new IntegrationError('E_INTEGRATION_JOURNAL', 'Integration recovery journal changed.');
  const journal = JSON.parse(bytes.toString('utf8'));
  if (journal.runId !== record.runId || journal.repositoryRoot !== record.repositoryRoot)
    throw new IntegrationError(
      'E_INTEGRATION_JOURNAL',
      'Integration recovery journal identity differs.',
    );
  const release = await checkoutLock(record.repositoryRoot);
  try {
    if (input.resolution === 'accept') {
      if (integration.cursor !== journal.changes.length || integration.pendingPath)
        throw new IntegrationError(
          'E_INTEGRATION_RECOVERY_INCOMPLETE',
          'Source writes did not complete; recover with rollback.',
        );
      for (const change of journal.changes) {
        if (!sameState(await captureFileState(record.repositoryRoot, change.path), change.after))
          throw new IntegrationError(
            'E_INTEGRATION_RECOVERY_CONFLICT',
            'Accepted source changed after interruption.',
            { path: change.path },
          );
      }
      await updateRunRecord(
        record.runId,
        { integration: { status: 'applied', at: new Date().toISOString(), ...journal.accepted } },
        { directory: input.runDirectory },
      );
      await closeRunRecord(record.runId, {
        disposition: 'integrated',
        directory: input.runDirectory,
      });
      return {
        runId: record.runId,
        status: 'completed',
        report: implementationReport({ status: 'completed', ...journal.accepted }, record.selector),
        recovered: 'accepted',
      };
    }
    if (input.resolution && input.resolution !== 'rollback')
      throw new IntegrationError(
        'E_INTEGRATION_RECOVERY',
        'Recovery resolution must be rollback or accept.',
      );
    const count = integration.cursor + (integration.pendingPath ? 1 : 0);
    const rollbackErrors = await rollbackWritten(
      record.repositoryRoot,
      journal.changes.slice(0, count),
      randomUUID(),
    );
    await updateRunRecord(
      record.runId,
      {
        integration: {
          ...integration,
          status: rollbackErrors.length ? 'interrupted' : 'rolled-back',
          rollbackErrors,
        },
      },
      { directory: input.runDirectory },
    );
    return {
      runId: record.runId,
      status: rollbackErrors.length ? 'blocked' : 'completed',
      recovered: rollbackErrors.length ? 'conflicts' : 'rolled-back',
      rollbackErrors,
      nextAction: rollbackErrors.length
        ? 'Preserve conflicting host edits and resolve the listed paths explicitly.'
        : 'Review the retained patch again before retrying apply.',
    };
  } finally {
    await release();
  }
}

async function integrationCommandLocked(action, input, record) {
  if (action === 'recover') return recoverIntegration(input, record);
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
    const observed = await reviewDelegateDelta(common);
    if (observed.ready)
      await updateRunRecord(
        input.runId,
        {
          reviewedPatch: {
            digest: patchDigest(observed),
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
  const capsule = await privateCapsule(record);
  const verificationProcess = await processIdentity();
  const evidencePath = join(record.runPath, `verification-${randomUUID()}.json`);
  let verification;
  const result = await integrateDelegateDelta({
    ...common,
    capsule,
    checks: input.checks,
    preparation: input.preparation,
    onVerification: async (evidence) => {
      verification = {
        ...evidence,
        process: verificationProcess,
        evidencePath,
        attempt: (record.verification?.attempt ?? 0) + 1,
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
    beforeApply: async ({ changes, ...accepted }) => {
      const current = await readRunRecord(record.runId, { directory: input.runDirectory });
      assertRunRecordFits({
        ...current,
        integration: { status: 'applied', ...accepted },
        status: 'closed',
        disposition: 'integrated',
        closedAt: new Date().toISOString(),
      });
      const journalPath = join(record.runPath, 'integration-journal.json');
      const journalDigest = await writeJournal(journalPath, {
        schemaVersion: '1.0.0',
        runId: record.runId,
        repositoryRoot: record.repositoryRoot,
        changes,
        accepted,
      });
      await updateRunRecord(
        record.runId,
        {
          integration: {
            status: 'applying',
            phase: 'source-write',
            journalPath,
            journalDigest,
            changedPaths: accepted.changedPaths,
            cursor: 0,
            pendingPath: null,
          },
        },
        { directory: input.runDirectory },
      );
    },
    onProgress: async (path, phase) => {
      const current = await readRunRecord(record.runId, { directory: input.runDirectory });
      await updateRunRecord(
        record.runId,
        {
          integration: {
            ...current.integration,
            cursor: current.integration.cursor + (phase === 'after' ? 1 : 0),
            pendingPath: phase === 'before' ? path : null,
          },
        },
        { directory: input.runDirectory },
      );
    },
    onAccepted: async (integration) =>
      updateRunRecord(
        input.runId,
        {
          integration: { status: 'applied', at: new Date().toISOString(), ...integration },
        },
        { directory: input.runDirectory },
      ),
    onRolledBack: async ({ rollbackErrors, code }) => {
      const current = await readRunRecord(record.runId, { directory: input.runDirectory });
      if (current.integration?.status !== 'applying') return;
      await updateRunRecord(
        record.runId,
        {
          integration: {
            ...current.integration,
            status: rollbackErrors.length ? 'interrupted' : 'rolled-back',
            rollbackErrors,
            code,
          },
        },
        { directory: input.runDirectory },
      );
    },
  });
  const output = {
    runId: input.runId,
    status: result.status,
    ...publicReview(result),
    checks: result.checks ?? [],
    verification: verification ?? null,
    generatedPaths: result.generatedPaths ?? [],
    generators: result.generators ?? [],
    code: result.code ?? null,
    rollbackErrors: result.rollbackErrors ?? [],
    nextAction: result.nextAction,
  };
  if (result.status === 'completed') {
    await closeRunRecord(input.runId, { disposition: 'integrated', directory: input.runDirectory });
  }
  return {
    ...output,
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
