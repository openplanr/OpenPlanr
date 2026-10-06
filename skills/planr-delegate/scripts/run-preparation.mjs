// Collect the complete capsule and create a detached worktree; never launch implementation.
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { invokeProcess } from './adapters/generic.mjs';
import { buildContextCapsule, previewContextCapsule, writeContextCapsule } from './context.mjs';
import { createWorktreeCustody } from './custody.mjs';
import { snapshotHelper } from './helper-snapshot.mjs';
import { prepareProfile, saveEngineChoice } from './profiles.mjs';
import {
  blocked,
  DelegateRunError,
  integrationPaths,
  MAX_CUSTODY_BYTES,
  profileIdentity,
  within,
} from './run-contract.mjs';
import { assertBackendReady, contextCapacity } from './run-preflight.mjs';
import { createRunRecord, defaultRunDirectory, updateRunRecord } from './run-record.mjs';

const PACKAGE_LOCKS = Object.freeze([
  ['package-lock.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
]);

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

export async function probeDelegateHost({ repositoryRoot, env = process.env } = {}) {
  const nodeReady = Number(process.versions.node.split('.')[0]) >= 22;
  const options = {
    env: { PATH: env.PATH, HOME: env.HOME, USER: env.USER, TMPDIR: env.TMPDIR },
    cwd: repositoryRoot,
    timeoutMs: 5000,
    maxOutputBytes: 16 * 1024,
    withExitCode: true,
  };
  let gitReady = false;
  let repository = null;
  let gitDiagnostic = null;
  const discoveryDiagnostics = [];
  try {
    gitReady = (await invokeProcess('git', ['--version'], options)).exitCode === 0;
    if (gitReady && repositoryRoot) {
      const root = await invokeProcess('git', ['rev-parse', '--show-toplevel'], options);
      const head = await invokeProcess('git', ['rev-parse', '--verify', 'HEAD'], options);
      repository = {
        ready:
          root.exitCode === 0 &&
          head.exitCode === 0 &&
          (await realpath(root.output.trim())) === repositoryRoot,
      };
    }
  } catch (error) {
    if (
      !(typeof error.code === 'string' && error.code.startsWith('E_ADAPTER_')) &&
      error.code !== 'ENOENT'
    )
      throw error;
    gitDiagnostic = { code: error.code, cause: error.details?.reason ?? error.code };
    repository = repositoryRoot ? { ready: false, diagnostic: gitDiagnostic } : null;
  }
  const engines = [];
  for (const [kind, command] of [
    ['claude', 'claude'],
    ['codex', 'codex'],
    ['cursor', 'agent'],
  ]) {
    for (const directory of (env.PATH ?? '').split(delimiter).filter(isAbsolute)) {
      try {
        const executable = join(
          directory,
          process.platform === 'win32' ? `${command}.exe` : command,
        );
        await access(executable, 1);
        if (!(await lstat(await realpath(executable))).isFile()) continue;
        engines.push({
          kind,
          executable,
          supported: true,
        });
        break;
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) continue;
        if (['EACCES', 'ELOOP'].includes(error.code)) {
          discoveryDiagnostics.push({ kind, code: error.code });
          continue;
        }
        throw new DelegateRunError(
          'E_DELEGATE_DISCOVERY',
          'Installed engine could not be inspected.',
          null,
          { kind, cause: error.code ?? error.name },
        );
      }
    }
  }
  return {
    ready: nodeReady && gitReady,
    node: { ready: nodeReady, minimumMajor: 22 },
    git: { ready: gitReady, ...(gitDiagnostic ? { diagnostic: gitDiagnostic } : {}) },
    repository,
    engines,
    ...(discoveryDiagnostics.length ? { discoveryDiagnostics } : {}),
  };
}

export async function prepareDelegateRun({
  repositoryRoot,
  taskSelector,
  request,
  selectedFiles = [],
  optionalFiles = [],
  readOnlyRepositories = [],
  credentialResolutions = [],
  selectedPaths,
  scopePaths,
  preservePaths = [],
  profile,
  engine,
  model,
  configDir,
  retainWorktree = false,
  profileDirectory,
  runDirectory = defaultRunDirectory(),
  worktreeParent,
  env,
  signal,
  timeoutMs,
} = {}) {
  const preparationStartedAt = Date.now();
  if (!repositoryRoot)
    throw new DelegateRunError('E_DELEGATE_INPUT', 'Repository root is required.');
  const root = await realpath(repositoryRoot);
  const host = await probeDelegateHost({ repositoryRoot: root, env });
  if (!host.ready || !host.repository?.ready)
    throw new DelegateRunError(
      'E_DELEGATE_PREREQUISITE',
      'Node 22+, Git, and a repository with a commit are required before task collection.',
      null,
      host,
    );
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
    engine,
    model,
    configDir,
    directory: profileDirectory,
    cwd: root,
    env,
    signal,
    timeoutMs,
  });

  if (prepared.profile.kind === 'generic') await assertBackendReady(prepared);
  const capsule = await buildContextCapsule({
    repositoryRoot: root,
    taskSelector,
    request,
    selectedFiles,
    optionalFiles,
    readOnlyRepositories,
    credentialResolutions,
  });
  const integrationScopePaths = scopePaths === undefined ? null : integrationPaths(scopePaths);
  let identity = profileIdentity(prepared);
  const runId = randomUUID();
  const runPath = join(privateDirectory, runId);
  await createRunRecord(
    {
      runId,
      nativeSelection: prepared.profile.kind !== 'generic' ? prepared.profile : null,
      retainWorktree,
      status: 'preparing',
      createdAt: new Date(preparationStartedAt).toISOString(),
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
      native: prepared.profile.kind !== 'generic',
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
    const worktreeProfile = await prepareProfile(prepared.profile, {
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
        'Native routing differs in the owned worktree. Inspect its configuration and prepare a new preview.',
        runId,
      );
    }
    identity = worktreeIdentity;
    await updateRunRecord(
      runId,
      {
        nativeSelection:
          worktreeProfile.profile.kind !== 'generic' ? worktreeProfile.profile : null,
        profileEnrollmentId: identity.enrollmentId,
        destination: identity.destination,
      },
      { directory: privateDirectory },
    );
    const worktreeDependencies = await inspectWorktreeDependencies(custody.worktreePath);
    if (worktreeDependencies.state === 'unsafe-link-or-path')
      throw new DelegateRunError(
        'E_DELEGATE_DEPENDENCIES',
        'Worktree dependency path is not a private real directory.',
        runId,
      );
    await saveEngineChoice(worktreeProfile.profile.kind, {
      directory: profileDirectory,
      ...(typeof profile === 'string' ? { profile } : {}),
      model: worktreeProfile.profile.argv[1],
      configDir: worktreeProfile.profile.configDir,
    });
    const ready = await updateRunRecord(
      runId,
      {
        status: 'prepared',
        preparationTiming: { durationMs: Date.now() - preparationStartedAt },
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
      ...(prepared.executionPolicy ? { executionPolicy: prepared.executionPolicy } : {}),
      runId,
      writableRepository: root,
      selectedPaths: custody.selectedPaths,
      integrationScopePaths,
      preservePaths: custody.preservePaths,
      worktreePath: custody.worktreePath,
      profile: identity.name,
      backend: identity.backend,
      modelSelection: worktreeProfile.profile.argv[1] ?? 'native default/automatic',
      provider:
        identity.destination.class === 'native-managed'
          ? 'native-managed'
          : identity.destination.origin,
      destination: identity.destination,
      ...(worktreeProfile.routing ? { routing: worktreeProfile.routing } : {}),
      contextCapacity: capacity,
      worktreeDependencies,
      preparationTiming: ready.preparationTiming,
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
