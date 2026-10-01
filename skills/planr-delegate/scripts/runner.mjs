// Public helper entrypoint. Retained runs route to their pinned copy before any mutation.
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateDestination } from './adapters/generic.mjs';
import { verifiedHelper } from './helper-snapshot.mjs';
import {
  handoffPresentation,
  implementationReport,
  preparationPresentation,
} from './presentation.mjs';
import {
  enrollProfile,
  inspectEnrolledBackend,
  listProfiles,
  nativeReadiness,
  prepareProfile,
  previewProfileCandidate,
  profileReadiness,
  removeProfile,
} from './profiles.mjs';
import { DelegateRunError, integrationPaths, within } from './run-contract.mjs';
import { dispatchDelegateRun, resumeDelegateRun } from './run-execution.mjs';
import {
  cleanupDelegateRun,
  delegateRunStatus,
  recoverDelegateRun,
  waitDelegateRun,
} from './run-lifecycle.mjs';
import { prepareOwnedWorktree } from './run-preflight.mjs';
import { prepareDelegateRun, probeDelegateHost } from './run-preparation.mjs';
import {
  closeRunRecord,
  defaultRunDirectory,
  pruneClosedRunRecords,
  readRunRecord,
  withRunTransitionLock,
} from './run-record.mjs';

// Preserve the installed helper's JavaScript API as well as its command entrypoint.
export { DelegateRunError } from './run-contract.mjs';
export { dispatchDelegateRun, resumeDelegateRun } from './run-execution.mjs';
export {
  cleanupDelegateRun,
  delegateRunStatus,
  recoverDelegateRun,
  waitDelegateRun,
} from './run-lifecycle.mjs';
export { readDelegateCustody, validateDelegateCapsule } from './run-preflight.mjs';
export { prepareDelegateRun, probeDelegateHost } from './run-preparation.mjs';

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
  if (!['enrolled', 'saved'].includes(choice.status)) {
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
    const readiness =
      prepared.profile.kind === 'generic'
        ? profileReadiness(prepared.destination, backend)
        : nativeReadiness(prepared.destination, backend);
    return {
      ...choice,
      destination: prepared.destination,
      ...(prepared.executionPolicy ? { executionPolicy: prepared.executionPolicy } : {}),
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

async function probeCommand(input) {
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
    host: await probeDelegateHost({ repositoryRoot: cwd }),
    profiles: cwd ? await probeChoices(profiles, cwd, input.profileDirectory) : profiles,
  };
  if (input.profile !== undefined || input.engine !== undefined) {
    if (
      (input.profile !== undefined && typeof input.profile !== 'string') ||
      !input.repositoryRoot
    ) {
      throw new DelegateRunError(
        'E_DELEGATE_INPUT',
        'Selected profile probe requires a profile name and repository root.',
      );
    }
    const prepared = await prepareProfile(input.profile, {
      directory: input.profileDirectory,
      engine: input.engine,
      cwd: await realpath(input.repositoryRoot),
    });
    const backend = await inspectEnrolledBackend(prepared.profile);
    const readiness =
      prepared.profile.kind === 'generic'
        ? profileReadiness(prepared.destination, backend)
        : nativeReadiness(prepared.destination, backend);
    result.selected = {
      name: prepared.profile.name,
      kind: prepared.profile.kind,
      ...(prepared.executionPolicy ? { executionPolicy: prepared.executionPolicy } : {}),
      destination: prepared.destination,
      selectedModel: backend.selectedModel ?? null,
      backend,
      readiness,
      ready: readiness.state === 'ready' ? true : readiness.dispatchable ? null : false,
    };
  }
  return result;
}

async function previewProfileCommand(input) {
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
    ...(preview.executionPolicy ? { executionPolicy: preview.executionPolicy } : {}),
    backend: preview.backend,
    readiness: preview.readiness,
    ...(preview.enrollment ? { enrollment: preview.enrollment } : {}),
  };
}

async function enrollProfileCommand(input) {
  if (!input.repositoryRoot) {
    throw new DelegateRunError(
      'E_DELEGATE_INPUT',
      'Profile enrollment requires a repository root and confirmed destination.',
    );
  }
  const expected = input.expectedDestination ?? {
    class: 'native-managed',
    origin: 'native-managed',
  };
  const preview = await previewProfileCandidate(input.profile, {
    directory: input.profileDirectory,
    cwd: await realpath(input.repositoryRoot),
  });
  if (
    preview.candidate.kind === 'generic' &&
    (preview.candidate.destination.class !== expected.class ||
      preview.candidate.destination.origin !== expected.origin)
  ) {
    throw new DelegateRunError(
      'E_DESTINATION_CHANGED',
      'Effective destination differs from the confirmed destination; inspect it before enrollment.',
    );
  }
  if (
    preview.candidate.kind === 'generic' &&
    !preview.backend.selectedModel &&
    input.allowBackendDefault !== true
  ) {
    throw new DelegateRunError(
      'E_PROFILE_MODEL_CHOICE',
      'Select a model or explicitly choose the backend default before enrollment.',
    );
  }
  if (preview.candidate.kind === 'generic' && preview.readiness.state === 'model-unavailable') {
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

async function removeProfileCommand(input) {
  if (typeof input.name !== 'string')
    throw new DelegateRunError('E_DELEGATE_INPUT', 'Profile removal requires a name.');
  return {
    name: input.name,
    removed: await removeProfile(input.name, { directory: input.profileDirectory }),
  };
}

async function prepareCommand(input) {
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

async function closeCommand(input) {
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

async function executionCommand(action, input) {
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

const COMMANDS = Object.freeze({
  probe: probeCommand,
  'profile-preview': previewProfileCommand,
  'profile-enroll': enrollProfileCommand,
  'profile-remove': removeProfileCommand,
  prepare: prepareCommand,
  'prepare-worktree': prepareOwnedWorktree,
  dispatch: (input) => executionCommand('dispatch', input),
  resume: (input) => executionCommand('resume', input),
  recover: async (input) => publicRecordView(await recoverDelegateRun(input)),
  status: delegateRunStatus,
  wait: waitDelegateRun,
  close: closeCommand,
  cleanup: cleanupDelegateRun,
  prune: async (input) => ({
    removed: await pruneClosedRunRecords({ directory: input.runDirectory }),
  }),
});

export async function delegateRunnerCommand(action, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DelegateRunError('E_DELEGATE_INPUT', 'Command input must be one JSON object.');
  }
  if (
    [
      'dispatch',
      'resume',
      'recover',
      'status',
      'wait',
      'close',
      'cleanup',
      'prepare-worktree',
      'setup-preview',
      'setup-accept',
    ].includes(action) &&
    input.runId
  ) {
    const record = await readRunRecord(input.runId, { directory: input.runDirectory });
    const pinned = await verifiedHelper(record);
    if (pinned && resolve(fileURLToPath(import.meta.url)) !== pinned.runnerPath) {
      const module = await import(pathToFileURL(pinned.runnerPath).href);
      return module.delegateRunnerCommand(action, input);
    }
  }
  const handler = COMMANDS[action];
  if (!Object.hasOwn(COMMANDS, action))
    throw new DelegateRunError('E_DELEGATE_COMMAND', 'Unknown delegate runner action.');
  return handler(input);
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
    setup: record.setup ?? null,
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
