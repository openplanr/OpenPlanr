import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  captureFileState,
  gitFileState,
  headFileState,
  sameGitState,
  validateWorktreeCustody,
} from './custody.mjs';
import {
  executionEnvironment,
  resolveSelectedChecks,
  resolveSelectedGenerators,
  runDelegateChecks,
  runGenerator,
} from './integration-checks.mjs';
import {
  assertSafeChanges,
  changedSinceSnapshot,
  covers,
  git,
  IntegrationError,
  putState,
  putStateGuarded,
  rollbackWritten,
  safePath,
  sameState,
  treeIdentity,
  workingSnapshot,
} from './integration-files.mjs';
import {
  acquireRunTransitionLock,
  compactIntegrationState,
  processIdentity,
  processIdentityState,
} from './run-record.mjs';

const execFile = promisify(execFileCallback);

async function candidatePaths(custody) {
  const diff = await git(custody.worktreePath, 'diff', '--name-only', '-z', custody.initialHead);
  const untracked = await git(
    custody.worktreePath,
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  );
  return [
    ...new Set(
      [
        ...diff.toString('utf8').split('\0'),
        ...untracked.toString('utf8').split('\0'),
        ...Object.keys(custody.startingFiles ?? {}),
      ]
        .filter(Boolean)
        .map(safePath),
    ),
  ].sort();
}

function completed(run) {
  return run?.status === 'completed' || run?.state === 'completed';
}

export async function reviewDelegateDelta({
  custody,
  run,
  scopePaths = [],
  preservePaths = [],
} = {}) {
  if (!custody?.repositoryRoot || !custody?.worktreePath)
    throw new IntegrationError('E_INTEGRATION_RECORD', 'A custody record is required.');
  if (!completed(run))
    throw new IntegrationError(
      'E_INTEGRATION_RUN',
      'Only a completed delegate run can be reviewed.',
    );
  if (!Array.isArray(scopePaths) || scopePaths.length === 0)
    throw new IntegrationError(
      'E_INTEGRATION_SCOPE',
      'Explicit writable scope paths are required.',
    );
  const allowed = scopePaths.map(safePath);
  const protectedPaths = [...(custody.preservePaths ?? []), ...preservePaths].map((entry) =>
    safePath(typeof entry === 'string' ? entry : entry.path),
  );
  const custodyCheck = await validateWorktreeCustody(custody, {
    native: Boolean(run.nativeSelection),
  });
  const violations = [
    ...(custodyCheck.violations ?? []).map((violation) =>
      typeof violation === 'string'
        ? { code: 'E_INTEGRATION_CUSTODY', message: violation }
        : violation,
    ),
  ];
  const changes = [];
  for (const path of await candidatePaths(custody)) {
    const before =
      (!run.nativeSelection ? custody.setupFiles?.[path] : null) ??
      custody.startingFiles?.[path] ??
      (await headFileState(custody.worktreePath, path, custody.initialHead));
    let after;
    try {
      after = await captureFileState(custody.worktreePath, path);
    } catch (error) {
      violations.push({
        code: 'E_INTEGRATION_UNSAFE_WORKTREE_PATH',
        path,
        reason: error.code ?? 'unreadable',
      });
      continue;
    }
    if (
      sameGitState(
        await gitFileState(custody.worktreePath, path, before),
        await gitFileState(custody.worktreePath, path, after),
      )
    )
      continue;
    if (!allowed.some((rule) => covers(rule, path)))
      violations.push({ code: 'E_INTEGRATION_SCOPE', path });
    if (protectedPaths.some((rule) => covers(rule, path)))
      violations.push({ code: 'E_INTEGRATION_PRESERVE', path });
    const sourceBefore =
      custody.sourceFiles?.[path] ??
      (await headFileState(custody.repositoryRoot, path, custody.initialHead));
    let sourceNow;
    try {
      sourceNow = await captureFileState(custody.repositoryRoot, path);
    } catch (error) {
      violations.push({
        code: 'E_INTEGRATION_UNSAFE_SOURCE_PATH',
        path,
        reason: error.code ?? 'unreadable',
      });
      continue;
    }
    if (
      !sameGitState(
        await gitFileState(custody.repositoryRoot, path, sourceBefore),
        await gitFileState(custody.repositoryRoot, path, sourceNow),
      )
    )
      violations.push({ code: 'E_INTEGRATION_SOURCE_DRIFT', path });
    changes.push({
      path,
      before,
      after,
      sourceBefore: sourceNow,
      origin: run.verificationMutations?.includes(path)
        ? 'parent-verification'
        : run.preparationProvenance?.paths?.includes(path)
          ? 'preparation-and-delegate'
          : 'delegate',
    });
  }
  return {
    ready: violations.length === 0,
    changedPaths: changes.map(({ path }) => path),
    changes,
    violations,
    patch: changes.map(({ path, before, after }) => ({ path, before, after })),
  };
}

export function patchDigest(review) {
  return createHash('sha256').update(JSON.stringify(review.patch)).digest('hex');
}

async function createScratch(source) {
  const base = await mkdtemp(join(tmpdir(), 'planr-integration-'));
  await chmod(base, 0o700);
  const root = join(base, 'checkout');
  const home = join(base, 'home');
  await mkdir(root, { mode: 0o700 });
  await mkdir(home, { mode: 0o700 });
  try {
    const paths = (
      await git(source, 'ls-files', '-z', '--cached', '--others', '--exclude-standard')
    )
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
    for (const path of new Set(paths)) {
      const state = await captureFileState(source, safePath(path));
      await putState(root, path, state, randomUUID());
    }
    const env = executionEnvironment(home);
    await execFile('git', ['init', '-q'], { cwd: root, env });
    await execFile('git', ['-c', 'core.hooksPath=/dev/null', 'add', '--all'], { cwd: root, env });
    await execFile(
      'git',
      [
        '-c',
        'user.name=OpenPlanr',
        '-c',
        'user.email=delegate@localhost',
        '-c',
        'core.hooksPath=/dev/null',
        'commit',
        '-qm',
        'Integration baseline',
        '--allow-empty',
      ],
      { cwd: root, env },
    );
    // npm workspaces may keep tools in package-local node_modules as well as the root.
    const dependencyRoots = new Set([
      '.',
      ...paths.filter((path) => path.endsWith('/package.json')).map(dirname),
    ]);
    for (const directory of dependencyRoots) {
      // Dependencies are copied, never symlinked back to the owner's checkout.
      try {
        await cp(join(source, directory, 'node_modules'), join(root, directory, 'node_modules'), {
          recursive: true,
          verbatimSymlinks: true,
        });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    // A copied dependency must not point back into the owner checkout or elsewhere.
    async function checkLinks(directory) {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          const target = resolve(directory, await readlink(path));
          if (!target.startsWith(`${root}${sep}`))
            throw new IntegrationError(
              'E_INTEGRATION_DEPENDENCY_LINK',
              'Copied dependencies contain a link outside scratch.',
            );
        } else if (entry.isDirectory()) await checkLinks(path);
      }
    }
    for (const directory of dependencyRoots)
      await checkLinks(join(root, directory, 'node_modules'));
    return { base, root, home };
  } catch (error) {
    await rm(base, { recursive: true, force: true });
    throw error;
  }
}

async function integrationCandidate(custody, review) {
  const sourceIdentity = await treeIdentity(custody.repositoryRoot);
  const projectedSource = await treeIdentity(
    custody.repositoryRoot,
    new Map(review.changes.map((change) => [change.path, change.after])),
  );
  if (projectedSource === (await treeIdentity(custody.worktreePath)))
    return {
      root: custody.worktreePath,
      base: null,
      sourceIdentity,
      identity: projectedSource,
      kind: 'prepared-worktree',
    };
  // Owner edits elsewhere make the prepared worktree stale. Copy only in this case.
  const candidate = await createScratch(custody.worktreePath);
  // Preserve the prepared build/cache outputs as well as installed dependencies.
  await cp(custody.worktreePath, candidate.root, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (path) => path !== join(custody.worktreePath, '.git'),
  });
  const sourcePaths = (
    await git(
      custody.repositoryRoot,
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    )
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const candidatePaths = (
    await git(candidate.root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard')
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  for (const path of new Set([...sourcePaths, ...candidatePaths]))
    await putState(
      candidate.root,
      safePath(path),
      await captureFileState(custody.repositoryRoot, path),
      randomUUID(),
    );
  for (const change of review.changes)
    await putState(candidate.root, change.path, change.after, randomUUID());
  return {
    ...candidate,
    sourceIdentity,
    identity: await treeIdentity(candidate.root),
    kind: 'fresh-candidate',
  };
}

export async function checkoutLock(root) {
  const path = join(
    tmpdir(),
    `planr-integration-lock-${createHash('sha256').update(root).digest('hex')}`,
  );
  // Serialize stale recovery with the same crash-safe acquisition used by runs.
  // Keep the checkout owner file so retained helpers still observe an active apply.
  const transitions = `${path}-transitions`;
  await mkdir(join(transitions, 'checkout'), { recursive: true, mode: 0o700 });
  let releaseTransition;
  try {
    releaseTransition = await acquireRunTransitionLock('checkout', { directory: transitions });
  } catch (error) {
    if (error.code === 'E_RUN_LOCKED')
      throw new IntegrationError(
        'E_INTEGRATION_LOCKED',
        'Another integration holds this checkout.',
      );
    throw error;
  }
  const token = randomUUID();
  try {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'));
      if (!['exited', 'reused'].includes(await processIdentityState(owner)))
        throw new IntegrationError(
          'E_INTEGRATION_LOCKED',
          'Another integration holds this checkout.',
        );
      await rm(path, { recursive: true });
      await mkdir(path, { mode: 0o700 });
    }
    await writeFile(
      join(path, 'owner.json'),
      JSON.stringify({ ...(await processIdentity()), token }),
      {
        flag: 'wx',
        mode: 0o600,
      },
    );
  } catch (error) {
    await releaseTransition();
    throw error;
  }
  return async () => {
    try {
      const owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'));
      if (owner.token !== token)
        throw new IntegrationError('E_INTEGRATION_LOCKED', 'Checkout lock ownership changed.');
      await rm(path, { recursive: true });
    } finally {
      await releaseTransition();
    }
  };
}

async function generateCandidate({
  scratch,
  generators,
  custody,
  review,
  timeoutMs,
  signal,
  phase,
  generatorRuns,
  generatedPaths,
  retainMutation,
  onProcess,
}) {
  for (const generator of generators) {
    const result = await phase('generation', () =>
      runGenerator(
        scratch.root,
        { ...generator, home: scratch.home, signal, onProcess },
        timeoutMs,
      ),
    );
    generatorRuns.push({
      packagePath: generator.packagePath,
      script: generator.script,
      ...result.result,
    });
    if (result.result.processTerminationConfirmed === false)
      throw new IntegrationError(
        'E_INTEGRATION_PROCESS',
        'An owned generator process could not be stopped. Recover it before inspecting or accepting the candidate.',
      );
    await retainMutation?.(scratch, result.changes);
    if (!result.passed)
      throw new IntegrationError('E_INTEGRATION_GENERATION', 'A declared generator failed.', {
        results: [result.result],
      });
    const unexpected = result.changes.filter(({ path }) => !generator.outputPaths.includes(path));
    if (unexpected.length) {
      review.violations.push(
        ...unexpected.map(({ path }) => ({ code: 'E_INTEGRATION_GENERATOR_SCOPE', path })),
      );
      throw new IntegrationError(
        'E_INTEGRATION_GENERATOR_SCOPE',
        'Generator changed undeclared files.',
      );
    }
    for (const change of result.changes) {
      const sourceBefore = await captureFileState(custody.repositoryRoot, change.path);
      generatedPaths.push(change.path);
      review.changedPaths.push(change.path);
      review.changes.push({ ...change, sourceBefore, origin: 'generator' });
      review.patch.push(change);
    }
  }
}

async function compareWithBaseline(
  results,
  selectedChecks,
  target,
  { phase, timeoutMs, signal, onProcess },
) {
  const beforeBaseline = await workingSnapshot(target.root);
  const failing = selectedChecks.filter((_check, index) => results[index]?.status === 'failed');
  const baseline = await phase('baseline-checks', () =>
    runDelegateChecks({
      repositoryRoot: target.root,
      checks: failing,
      onProcess,
      timeoutMs,
      home: target.home,
      signal: signal,
    }),
  );
  const effects = await changedSinceSnapshot(target.root, beforeBaseline);
  let index = 0;
  const compared = results.map((result) => {
    if (result.status !== 'failed') return result;
    const evidence = baseline[index++];
    const baselineStatus = effects.length ? 'unverified' : evidence.status;
    return {
      ...result,
      baselineStatus,
      baseline: evidence,
      classification:
        baselineStatus === 'failed'
          ? 'baseline-failure'
          : baselineStatus === 'passed'
            ? 'regression'
            : 'unverified',
    };
  });
  return { results: compared, effects };
}

async function validateSourceChanges(root, changes) {
  for (const change of changes) {
    if (!sameState(await captureFileState(root, change.path), change.sourceBefore))
      throw new IntegrationError(
        'E_INTEGRATION_SOURCE_DRIFT',
        'A destination changed while checks ran.',
        { path: change.path },
      );
    // Keep physical non-executable permissions; only the Git executable bit belongs to the delta.
    if (change.after.kind === 'file' && change.sourceBefore.kind === 'file') {
      change.after = {
        ...change.after,
        mode: (change.sourceBefore.mode & ~0o111) | (change.after.mode & 0o111),
      };
    }
  }
}

async function writeChanges({ root, changes, signal, onProgress, applied, createdDirectories }) {
  for (const change of changes) {
    if (signal.aborted)
      throw new IntegrationError('E_INTEGRATION_INTERRUPTED', 'Integration was interrupted.');
    // The journal records all intended states before this first write, including crash recovery.
    await onProgress?.(change.path, 'before');
    await putStateGuarded(
      root,
      change.path,
      change.after,
      change.sourceBefore,
      change.writeId,
      createdDirectories,
    );
    applied.push(change);
    await onProgress?.(change.path, 'after');
  }
}

export async function integrateDelegateDelta({
  custody,
  run,
  scopePaths,
  preservePaths,
  capsule,
  checks,
  preparation,
  generators,
  timeoutMs,
  reviewedDigest,
  baselineComparison = false,
  reviewOnlyReason,
  onVerification,
  beforeApply,
  onProgress,
  onAccepted,
  onRolledBack,
} = {}) {
  const native = Boolean(run.nativeSelection);
  const review = await reviewDelegateDelta({ custody, run, scopePaths, preservePaths });
  if (!review.ready)
    return {
      status: 'blocked',
      ...review,
      nextAction: 'Inspect the retained worktree and resolve the reported conflicts.',
    };
  if (reviewedDigest && reviewedDigest !== patchDigest(review))
    throw new IntegrationError(
      'E_INTEGRATION_REVIEW_DRIFT',
      'The delegate patch changed since review; review it again.',
    );
  const release = await checkoutLock(custody.repositoryRoot);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let scratch, baselineScratch, worktreeBefore, worktreeIdentity;
  const verification = {
    status: 'running',
    phase: 'candidate-selection',
    candidateIdentity: patchDigest(review),
    startedAt: new Date().toISOString(),
    phases: [],
    preparation: [],
    checks: [],
  };
  const progress = () => onVerification?.(verification);
  const onProcess = async (identity) => {
    verification.commandProcess = identity;
    await progress();
  };
  async function phase(name, operation) {
    verification.phase = name;
    const step = { phase: name, startedAt: new Date().toISOString() };
    verification.phases.push(step);
    await progress();
    try {
      return await operation();
    } finally {
      step.finishedAt = new Date().toISOString();
      step.durationMs = Date.parse(step.finishedAt) - Date.parse(step.startedAt);
      await progress();
    }
  }
  async function assertCandidateIdentity() {
    if (native && (await treeIdentity(scratch.root)) !== scratch.identity)
      throw new IntegrationError(
        'E_INTEGRATION_CANDIDATE_STALE',
        'The selected candidate changed. Review the actual files before verification or acceptance.',
      );
  }
  async function retainVerificationMutation(target, effects) {
    if (!native || !effects.length) return;
    verification.mutatedPaths = [
      ...new Set([...(verification.mutatedPaths ?? []), ...effects.map((effect) => effect.path)]),
    ];
    if (target.kind !== 'fresh-candidate') return;
    verification.retainedCandidate = true;
    for (const { path } of effects) {
      const before =
        worktreeBefore.get(path) ??
        (await headFileState(custody.worktreePath, path, custody.initialHead));
      if (!sameState(await captureFileState(custody.worktreePath, path), before))
        throw new IntegrationError(
          'E_INTEGRATION_CANDIDATE_STALE',
          'Owned worktree changed during verification; preserve the fresh candidate for inspection.',
          { path },
        );
    }
    for (const { path } of effects) {
      const before =
        worktreeBefore.get(path) ??
        (await headFileState(custody.worktreePath, path, custody.initialHead));
      await putStateGuarded(
        custody.worktreePath,
        path,
        await captureFileState(target.root, path),
        before,
        randomUUID(),
      );
    }
    verification.mutationsReturnedToWorktree = true;
    verification.retainedCandidate = false;
  }
  async function prepareScratch(target, steps, targetName) {
    const before = await workingSnapshot(target.root);
    const results = await runDelegateChecks({
      repositoryRoot: target.root,
      checks: steps,
      timeoutMs,
      home: target.home,
      signal: controller.signal,
      onProcess,
      stopOnFailure: true,
      onResult: async (result) => {
        verification.preparation.push({ ...result, target: targetName });
        await progress();
      },
    });
    if (results.some((result) => result.processTerminationConfirmed === false))
      throw new IntegrationError(
        'E_INTEGRATION_PROCESS',
        'An owned preparation process could not be stopped.',
      );
    const effects = await changedSinceSnapshot(target.root, before);
    if (effects.length) {
      await retainVerificationMutation(target, effects);
      review.violations.push(
        ...effects.map(({ path }) => ({
          code: native ? 'E_INTEGRATION_REVIEW_DRIFT' : 'E_INTEGRATION_PREPARATION_SIDE_EFFECT',
          path,
        })),
      );
      throw new IntegrationError(
        native ? 'E_INTEGRATION_REVIEW_DRIFT' : 'E_INTEGRATION_PREPARATION_SIDE_EFFECT',
        'Preparation changed reviewable files. Inspect the updated candidate and review again.',
      );
    }
    if (results.some(({ status }) => status !== 'passed'))
      throw new IntegrationError(
        'E_INTEGRATION_PREPARATION',
        'Scratch preparation failed before checks.',
      );
  }
  const applied = [],
    createdDirectories = [],
    generatorRuns = [],
    generatedPaths = [];
  const delegatePaths = [...review.changedPaths];
  let results = [],
    failureCode,
    rollbackErrors = [];
  try {
    const protectedPaths = [...(custody.preservePaths ?? []), ...(preservePaths ?? [])].map(
      (entry) => safePath(typeof entry === 'string' ? entry : entry.path),
    );
    const selectedGenerators = await resolveSelectedGenerators(
      custody.repositoryRoot,
      generators,
      delegatePaths,
      scopePaths.map(safePath),
      protectedPaths,
    );
    await assertSafeChanges(custody.repositoryRoot, review.changes);
    if (native) {
      worktreeBefore = await workingSnapshot(custody.worktreePath);
      worktreeIdentity = await treeIdentity(custody.worktreePath);
    }
    scratch = await phase(native ? 'candidate-selection' : 'scratch-preparation', () =>
      native ? integrationCandidate(custody, review) : createScratch(custody.repositoryRoot),
    );
    if (!native)
      for (const change of review.changes)
        await putState(scratch.root, change.path, change.after, randomUUID());
    const selectedChecks = await resolveSelectedChecks(scratch.root, checks, { legacy: !native });
    const selectedPreparation = (
      await resolveSelectedChecks(scratch.root, preparation ?? [], { legacy: !native })
    ).map((step) => ({ ...step, kind: 'preparation' }));
    if (
      native &&
      !selectedChecks.length &&
      (typeof reviewOnlyReason !== 'string' || !reviewOnlyReason.trim())
    )
      throw new IntegrationError(
        'E_INTEGRATION_CHECKS_REQUIRED',
        'Select applicable independent commands or provide a reviewOnlyReason. Zero checks remains unverified.',
      );
    verification.candidateIdentity = scratch.identity;
    verification.candidatePath = scratch.root;
    verification.candidateKind = scratch.kind;
    verification.reviewOnlyReason = selectedChecks.length ? null : reviewOnlyReason;
    await assertCandidateIdentity();
    if (selectedPreparation.length)
      await phase('build-preparation', () =>
        prepareScratch(scratch, selectedPreparation, 'candidate'),
      );
    await generateCandidate({
      scratch,
      generators: selectedGenerators,
      custody,
      review,
      timeoutMs,
      signal: controller.signal,
      phase,
      generatorRuns,
      generatedPaths,
      retainMutation: native ? retainVerificationMutation : null,
      onProcess,
    });
    if (native && generatedPaths.length)
      throw new IntegrationError(
        'E_INTEGRATION_REVIEW_DRIFT',
        'Generated files changed the candidate. Review the resulting files before accepting.',
      );
    const beforeChecks = await workingSnapshot(scratch.root);
    await assertCandidateIdentity();
    results = await phase('checks', () =>
      runDelegateChecks({
        repositoryRoot: scratch.root,
        checks: selectedChecks,
        timeoutMs,
        home: scratch.home,
        signal: controller.signal,
        onProcess,
        onResult: async (_result, current) => {
          verification.checks = [...current];
          await progress();
        },
      }),
    );
    if (results.some((result) => result.processTerminationConfirmed === false))
      throw new IntegrationError(
        'E_INTEGRATION_PROCESS',
        'An owned check process could not be stopped. Recover it before verification or acceptance.',
      );
    const checkEffects = await changedSinceSnapshot(scratch.root, beforeChecks);
    if (checkEffects.length) {
      await retainVerificationMutation(scratch, checkEffects);
      review.violations.push(
        ...checkEffects.map(({ path }) => ({ code: 'E_INTEGRATION_CHECK_SIDE_EFFECT', path })),
      );
      throw new IntegrationError(
        native ? 'E_INTEGRATION_REVIEW_DRIFT' : 'E_INTEGRATION_CHECK_SIDE_EFFECT',
        'Verification changed reviewable files. Inspect this candidate and review again.',
      );
    }
    if (results.some((result) => result.status === 'timed-out'))
      throw new IntegrationError('E_INTEGRATION_CHECK_TIMEOUT', 'An independent check timed out.');
    if (results.some((result) => result.status === 'failed') && (!native || baselineComparison)) {
      // Rebuild a fresh source baseline; candidate build outputs must not influence classification.
      baselineScratch = await phase('baseline-preparation', async () => {
        const target = await createScratch(custody.repositoryRoot);
        baselineScratch = target;
        await prepareScratch(target, selectedPreparation, 'baseline');
        for (const generator of selectedGenerators) {
          const generated = await runGenerator(
            target.root,
            { ...generator, home: target.home, signal: controller.signal, onProcess },
            timeoutMs,
          );
          if (
            !generated.passed ||
            generated.changes.some(({ path }) => !generator.outputPaths.includes(path))
          )
            throw new IntegrationError(
              'E_INTEGRATION_BASELINE_GENERATION',
              'Baseline generation could not be verified.',
            );
        }
        return target;
      });
      const comparison = await compareWithBaseline(results, selectedChecks, baselineScratch, {
        phase,
        timeoutMs,
        signal: controller.signal,
        onProcess,
      });
      results = comparison.results;
      const effects = comparison.effects;
      if (effects.length)
        review.violations.push(
          ...effects.map(({ path }) => ({ code: 'E_INTEGRATION_BASELINE_SIDE_EFFECT', path })),
        );
      verification.checks = results;
      await progress();
      throw new IntegrationError(
        effects.length ? 'E_INTEGRATION_BASELINE_SIDE_EFFECT' : 'E_INTEGRATION_CHECKS',
        'Independent checks failed.',
      );
    }
    if (results.some((result) => result.status !== 'passed'))
      throw new IntegrationError(
        'E_INTEGRATION_CHECKS',
        'Independent checks failed. Baseline comparison is an explicit diagnostic action.',
      );
    await assertCandidateIdentity();
    if (native && (await treeIdentity(custody.worktreePath)) !== worktreeIdentity)
      throw new IntegrationError(
        'E_INTEGRATION_CANDIDATE_STALE',
        'Owned worktree changed during verification; retain it for review.',
      );
    if (native && (await treeIdentity(custody.repositoryRoot)) !== scratch.sourceIdentity)
      throw new IntegrationError(
        'E_INTEGRATION_CANDIDATE_STALE',
        'The source checkout changed while verification ran. Review the actual candidate again.',
      );
    if (controller.signal.aborted)
      throw new IntegrationError('E_INTEGRATION_INTERRUPTED', 'Integration was interrupted.');
    await assertSafeChanges(custody.repositoryRoot, review.changes);
    await validateSourceChanges(custody.repositoryRoot, review.changes);
    const states = Object.fromEntries(
      review.changes.map(({ path, after }) => [path, compactIntegrationState(after)]),
    );
    const accepted = {
      delegatePaths,
      generatedPaths,
      changedPaths: review.changedPaths,
      states,
      checks: results,
      generators: generatorRuns,
      preparation: verification.preparation,
      candidateIdentity: verification.candidateIdentity,
      ...(native ? { worktreeIdentity } : {}),
      verified: results.length > 0 && results.every((result) => result.status === 'passed'),
      reviewOnlyReason: verification.reviewOnlyReason,
    };
    verification.phase = 'source-write';
    verification.phases.push({
      phase: 'source-write',
      startedAt: new Date().toISOString(),
    });
    await progress();
    for (const change of review.changes) change.writeId = randomUUID();
    await beforeApply?.({ ...accepted, changes: review.changes });
    await assertCandidateIdentity();
    await writeChanges({
      root: custody.repositoryRoot,
      changes: review.changes,
      signal: controller.signal,
      onProgress,
      applied,
      createdDirectories,
    });
    await assertCandidateIdentity();
    if (native && (await treeIdentity(custody.worktreePath)) !== worktreeIdentity)
      throw new IntegrationError(
        'E_INTEGRATION_CANDIDATE_STALE',
        'Owned worktree changed before acceptance; retain it for review.',
      );
    if (native && (await treeIdentity(custody.repositoryRoot)) !== scratch.identity)
      throw new IntegrationError(
        'E_INTEGRATION_SOURCE_DRIFT',
        'The resulting checkout differs from the verified candidate. Retain concurrent edits and review again.',
      );
    await onAccepted?.(accepted);
    return {
      status: 'completed',
      ...review,
      checks: results,
      generatedPaths,
      generators: generatorRuns,
      nextAction:
        'Review the uncommitted local diff. The owned worktree is removed unless retention was requested.',
    };
  } catch (error) {
    failureCode = error.code ?? 'E_INTEGRATION_APPLY';
    if (verification.commandProcess && scratch?.base) verification.retainedCandidate = true;
    if (
      [
        'E_INTEGRATION_CHECK_SELECTION',
        'E_INTEGRATION_GENERATOR_SELECTION',
        'E_INTEGRATION_GENERATOR_DRIFT',
      ].includes(error.code)
    )
      throw error;
    failureCode = error.code ?? 'E_INTEGRATION_APPLY';
    if (error.details?.path) review.violations.push({ code: failureCode, ...error.details });
    rollbackErrors = await rollbackWritten(custody.repositoryRoot, applied, randomUUID());
    if (error.details?.published)
      rollbackErrors.push({
        path: error.details.path,
        retainedPath: error.details.retainedPath,
        code: 'E_INTEGRATION_ROLLBACK_CONFLICT',
      });
    for (const directory of createdDirectories.reverse()) {
      try {
        await rmdir(directory);
      } catch (cleanupError) {
        if (!['ENOTEMPTY', 'ENOENT'].includes(cleanupError.code))
          rollbackErrors.push({ path: directory, code: cleanupError.code });
      }
    }
    await onRolledBack?.({ rollbackErrors, code: failureCode });
    return {
      status: 'blocked',
      ...review,
      code: failureCode,
      checks: results,
      generatedPaths,
      generators: generatorRuns,
      rollbackErrors,
      nextAction:
        failureCode === 'E_INTEGRATION_PROCESS'
          ? 'Recover the recorded owned parent command before checks, continuation or cleanup.'
          : rollbackErrors.length
            ? 'Resolve the integration journal conflicts before continuing.'
            : failureCode === 'E_INTEGRATION_CHECK_TIMEOUT'
              ? 'Retry apply with a measured timeoutMs.'
              : 'Send the findings to the same delegate session for correction; the worktree remains available.',
    };
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    for (const step of verification.phases) {
      if (!step.finishedAt) {
        step.finishedAt = new Date().toISOString();
        step.durationMs = Date.parse(step.finishedAt) - Date.parse(step.startedAt);
      }
    }
    if (verification.commandProcess)
      verification.retainedCandidatePaths = [scratch?.root, baselineScratch?.root].filter(Boolean);
    verification.status = failureCode ? 'blocked' : 'completed';
    verification.phase = failureCode ? 'blocked' : 'integrated';
    verification.finishedAt = new Date().toISOString();
    verification.durationMs =
      Date.parse(verification.finishedAt) - Date.parse(verification.startedAt);
    verification.code = failureCode ?? null;
    verification.checks = results.length ? results : verification.checks;
    try {
      await progress();
    } finally {
      if (scratch?.base && !verification.retainedCandidate)
        await rm(scratch.base, { recursive: true, force: true });
      if (baselineScratch && !verification.commandProcess)
        await rm(baselineScratch.base, { recursive: true, force: true });
      await release();
    }
  }
}
