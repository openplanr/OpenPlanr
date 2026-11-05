// Hand delegate work back through its run branch: snapshot, review, check at tip, git apply.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureFileState, HOOKLESS_COMMIT, validateWorktreeCustody } from './custody.mjs';
import {
  resolveSelectedChecks,
  resolveSelectedGenerators,
  runDelegateChecks,
  runGenerator,
} from './integration-checks.mjs';
import {
  assertSafeChanges,
  changedSinceSnapshot,
  covers,
  IntegrationError,
  safePath,
  workingSnapshot,
} from './integration-files.mjs';
import {
  acquireRunTransitionLock,
  compactIntegrationState,
  processIdentity,
  processIdentityState,
} from './run-record.mjs';

const DIFF = [
  '-c',
  'diff.noprefix=false',
  '-c',
  'diff.ignoreSubmodules=none',
  'diff',
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--no-relative',
  '--no-renames',
  '--submodule=short',
  '--ignore-submodules=none',
];
const APPLY = [
  '-c',
  'apply.whitespace=nowarn',
  '-c',
  'apply.ignoreWhitespace=no',
  'apply',
  '--whitespace=nowarn',
];
const BRANCH_VIOLATIONS = ['E_CUSTODY_BRANCH', 'E_CUSTODY_BASE'];
const SELECTION_ERRORS = [
  'E_INTEGRATION_CHECK_SELECTION',
  'E_INTEGRATION_GENERATOR_SELECTION',
  'E_INTEGRATION_GENERATOR_DRIFT',
];

const ACTIVE_RECOVERY =
  'The delegate is still running: wait for this runId; if it stops for input, answer through resume, then review once it completes.';
const RUN_RECOVERY = {
  question:
    'The delegate is waiting for an answer: run resume with this runId and an answer, then review once it completes.',
  blocked:
    'The delegate stopped for attention: inspect status, resolve the cause, run resume with this runId and an answer or correction, then review once it completes.',
  running: ACTIVE_RECOVERY,
  resuming: ACTIVE_RECOVERY,
  prepared: 'The run has not been dispatched: dispatch it, then review once it completes.',
};

function completed(run) {
  return run?.status === 'completed' || run?.state === 'completed';
}

function reviewScope({ custody, run, scopePaths = [], preservePaths = [] } = {}) {
  if (!custody?.repositoryRoot || !custody?.worktreePath)
    throw new IntegrationError('E_INTEGRATION_RECORD', 'A custody record is required.');
  if (!completed(run))
    throw new IntegrationError(
      'E_INTEGRATION_RUN',
      `Only a completed delegate run can be reviewed. ${RUN_RECOVERY[run?.status] ?? 'Inspect the run with status.'}`,
      { status: run?.status ?? null },
    );
  if (!isBranchHandoff(custody))
    throw new IntegrationError(
      'E_INTEGRATION_RECORD',
      'This custody has no run branch; finish the run with the helper pinned when it was prepared.',
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
  return { allowed, protectedPaths };
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

function gitOperation(args) {
  return args.find((arg) => !arg.startsWith('-') && !arg.includes('='));
}

function git(cwd, args, { input, allowFailure = false, env } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = execFile(
      'git',
      args,
      {
        cwd,
        encoding: 'buffer',
        maxBuffer: 256 * 1024 * 1024,
        ...(env ? { env: { ...process.env, ...env } } : {}),
      },
      (error, stdout, stderr) => {
        const result = {
          code: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
          stdout,
          stderr: stderr.toString('utf8'),
        };
        if (!error || allowFailure) resolveResult(result);
        else {
          const operation = gitOperation(args);
          reject(
            new IntegrationError(
              'E_INTEGRATION_GIT',
              `git ${operation} failed: ${result.stderr.trim().slice(-1024)}`,
              { operation, exitCode: result.code },
            ),
          );
        }
      },
    );
    // Git may exit without reading stdin; its exit status, not the closed pipe, is the result.
    child.stdin.on('error', (error) => {
      if (error.code === 'EPIPE') return;
      const operation = gitOperation(args);
      reject(
        new IntegrationError(
          'E_INTEGRATION_GIT',
          `git ${operation} stdin failed: ${error.message}`,
          { operation, cause: error.code },
        ),
      );
    });
    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}

async function text(cwd, args, options) {
  return (await git(cwd, args, options)).stdout.toString('utf8').trim();
}

export function isBranchHandoff(custody) {
  return custody?.handoff === 'branch';
}

/** Commits everything Git does not ignore in the run worktree and returns the run branch tip. */
export async function snapshotTip(custody) {
  const root = custody.worktreePath;
  await git(root, ['add', '-A']);
  if ((await git(root, ['diff', '--cached', '--quiet'], { allowFailure: true })).code === 1)
    await git(root, [...HOOKLESS_COMMIT, `planr-delegate tip ${custody.runId}`]);
  return text(root, ['rev-parse', 'HEAD']);
}

async function statusPaths(root) {
  const tokens = (
    await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'])
  ).stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  return tokens.map((row) => ({ code: row.slice(0, 2), path: row.slice(3) }));
}

const STATUS_CHANGE = { '??': 'extra', ' D': 'missing', D: 'missing' };

/** Lists how the run worktree differs from the reviewed tip. */
async function staleViolations(root, tip) {
  const head = await text(root, ['rev-parse', 'HEAD']);
  const violations = (await statusPaths(root)).map(({ code, path }) => ({
    code: 'E_INTEGRATION_CANDIDATE_STALE',
    path,
    change: STATUS_CHANGE[code] ?? STATUS_CHANGE[code.trim()] ?? 'changed',
  }));
  if (head !== tip) violations.unshift({ code: 'E_INTEGRATION_CANDIDATE_STALE', head });
  return violations;
}

async function assertAtTip(root, tip, violations) {
  const stale = await staleViolations(root, tip);
  if (!stale.length) return;
  violations.push(...stale);
  throw new IntegrationError(
    'E_INTEGRATION_CANDIDATE_STALE',
    'The run worktree changed after review. Review the actual files before verification or acceptance.',
  );
}

async function changedEntries(root, base, tip) {
  const range = tip ? [base, tip] : [base];
  const tokens = (await git(root, [...DIFF, '-z', '--raw', '--no-abbrev', ...range])).stdout
    .toString('utf8')
    .split('\0');
  const entries = [];
  for (let index = 0; index + 1 < tokens.length && tokens[index]; index += 2) {
    const [beforeMode, afterMode, beforeOid, afterOid] = tokens[index].slice(1).split(' ');
    entries.push({ path: tokens[index + 1], beforeMode, afterMode, beforeOid, afterOid });
  }
  return entries;
}

/** Lists submodules that differ from base, including ones `ignore` settings hide from `git add`. */
async function submodulePaths(root, base) {
  const paths = new Set(
    (await changedEntries(root, base))
      .filter(({ beforeMode, afterMode }) => beforeMode === '160000' || afterMode === '160000')
      .map(({ path }) => path),
  );
  const status = (
    await git(root, ['status', '--porcelain=v2', '-z', '--ignore-submodules=none'])
  ).stdout
    .toString('utf8')
    .split('\0');
  for (const row of status) {
    const fields = row.split(' ');
    if (['1', '2'].includes(fields[0]) && fields[2]?.startsWith('S'))
      paths.add(fields.slice(fields[0] === '1' ? 8 : 9).join(' '));
  }
  return [...paths];
}

async function objectState(root, mode, oid) {
  if (/^0+$/u.test(mode)) return { kind: 'absent' };
  if (mode === '160000') return { kind: 'gitlink', mode: null, bytes: null, commit: oid };
  const bytes = Number(await text(root, ['cat-file', '-s', oid]));
  if (mode === '120000')
    return {
      kind: 'symlink',
      mode: 0o777,
      bytes,
      target: (await git(root, ['cat-file', 'blob', oid])).stdout.toString('utf8'),
    };
  return { kind: 'file', mode: mode === '100755' ? 0o755 : 0o644, bytes, oid };
}

async function applyCheck(root, patch, paths) {
  const result = await git(root, [...APPLY, '--check', '-'], {
    input: patch,
    allowFailure: true,
  });
  if (result.code === 0) return [];
  const lines = result.stderr.split('\n').filter((line) => line.startsWith('error: '));
  const named = paths
    .map((path) => ({
      path,
      line: lines.find(
        (line) => line.startsWith(`error: ${path}: `) || line.includes(`patch failed: ${path}:`),
      ),
    }))
    .filter(({ line }) => line);
  return named.length
    ? named.map(({ path, line }) => ({
        code: 'E_INTEGRATION_SOURCE_DRIFT',
        path,
        reason: line.slice('error: '.length),
      }))
    : [{ code: 'E_INTEGRATION_SOURCE_DRIFT', reason: result.stderr.trim().slice(-1024) }];
}

/** Reviews base..tip of the run branch against scope, Preserve and the current parent checkout. */
export async function reviewBranchDelta(input = {}) {
  const { custody, run } = input;
  const { allowed, protectedPaths } = reviewScope(input);
  const custodyCheck = await validateWorktreeCustody(custody, {
    native: Boolean(run.nativeSelection),
  });
  const violations = [...custodyCheck.violations];
  const empty = { ready: false, changedPaths: [], changes: [], violations, patch: [] };
  if (violations.some(({ code }) => BRANCH_VIOLATIONS.includes(code))) return empty;
  const root = custody.worktreePath;
  const tip = await snapshotTip(custody);
  // git apply without --index leaves a submodule untouched yet reports success.
  const submodules = await submodulePaths(root, custody.base);
  violations.push(...submodules.map((path) => ({ code: 'E_INTEGRATION_GITLINK', path })));
  const changes = [];
  for (const entry of await changedEntries(root, custody.base, tip)) {
    const { path } = entry;
    const before = await objectState(root, entry.beforeMode, entry.beforeOid);
    const after = await objectState(root, entry.afterMode, entry.afterOid);
    if (!allowed.some((rule) => covers(rule, path)))
      violations.push({ code: 'E_INTEGRATION_SCOPE', path });
    if (protectedPaths.some((rule) => covers(rule, path)))
      violations.push({ code: 'E_INTEGRATION_PRESERVE', path });
    if (before.kind === 'gitlink' || after.kind === 'gitlink') {
      if (!submodules.includes(path)) violations.push({ code: 'E_INTEGRATION_GITLINK', path });
    } else
      try {
        await assertSafeChanges(custody.repositoryRoot, [{ path, after }]);
      } catch (error) {
        if (!(error instanceof IntegrationError)) throw error;
        violations.push({ code: error.code, path });
      }
    changes.push({
      path,
      before,
      after,
      origin: run.verificationMutations?.includes(path)
        ? 'parent-verification'
        : run.preparationProvenance?.paths?.includes(path)
          ? 'preparation-and-delegate'
          : 'delegate',
    });
  }
  const patchBytes = (
    await git(root, [
      ...DIFF,
      '--binary',
      '--full-index',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      custody.base,
      tip,
    ])
  ).stdout;
  const changedPaths = changes.map(({ path }) => path);
  if (changes.length && !violations.length)
    violations.push(...(await applyCheck(custody.repositoryRoot, patchBytes, changedPaths)));
  return {
    ready: violations.length === 0,
    changedPaths,
    changes,
    violations,
    warnings: custodyCheck.warnings,
    patch: changes.map(({ path, before, after }) => ({ path, before, after })),
    base: custody.base,
    tip,
    patchBytes,
    patchSha256: createHash('sha256').update(patchBytes).digest('hex'),
  };
}

function restoreRef(runId) {
  return `refs/planr-delegate/${runId}/restore`;
}

async function baselineWorktree(custody) {
  const base = await mkdtemp(join(tmpdir(), 'planr-baseline-'));
  const root = join(base, 'checkout');
  await git(custody.repositoryRoot, ['worktree', 'add', '--detach', '--', root, custody.base]);
  return { base, root };
}

async function removeBaseline(custody, target) {
  await git(custody.repositoryRoot, ['worktree', 'remove', '--force', '--', target.root]);
  await rm(target.base, { recursive: true, force: true });
}

async function physicalModes(root, changes) {
  const modes = {};
  for (const { path, before } of changes) {
    if (before.kind !== 'file') continue;
    const info = await lstat(join(root, path));
    if (info.isFile()) modes[path] = info.mode & 0o777;
  }
  return modes;
}

// git apply and git restore write files with default permissions; only the executable bit belongs to the delta.
async function restorePhysicalModes(root, modes, paths) {
  for (const path of paths) {
    const before = modes?.[path];
    if (before === undefined) continue;
    let info;
    try {
      info = await lstat(join(root, path));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!info.isFile()) continue;
    const mode = (before & ~0o111) | (info.mode & 0o111);
    if (mode !== (info.mode & 0o777)) await chmod(join(root, path), mode);
  }
}

/** Verifies the reviewed tip in the run worktree, then applies base..tip to the parent checkout. */
export async function integrateBranchDelta({
  custody,
  run,
  scopePaths,
  preservePaths,
  checks,
  preparation,
  generators,
  timeoutMs,
  reviewedDigest,
  baselineComparison = false,
  reviewOnlyReason,
  patchPath,
  onVerification,
  onApplying,
  onAccepted,
  onRolledBack,
} = {}) {
  const native = Boolean(run.nativeSelection);
  const root = custody.worktreePath;
  let review = await reviewBranchDelta({ custody, run, scopePaths, preservePaths });
  if (!review.ready)
    return {
      status: 'blocked',
      ...review,
      nextAction: 'Inspect the retained worktree and resolve the reported conflicts.',
    };
  if (reviewedDigest && reviewedDigest !== review.tip)
    throw new IntegrationError(
      'E_INTEGRATION_REVIEW_DRIFT',
      'The delegate patch changed since review; review it again.',
    );
  const release = await checkoutLock(custody.repositoryRoot);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const verification = {
    status: 'running',
    phase: 'candidate-selection',
    candidateIdentity: review.tip,
    candidatePath: root,
    candidateKind: 'prepared-worktree',
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
  function recordMutations(effects) {
    verification.mutatedPaths = [
      ...new Set([...(verification.mutatedPaths ?? []), ...effects.map(({ path }) => path)]),
    ];
  }
  async function prepare(target, steps, targetName) {
    const before = await workingSnapshot(target);
    const results = await runDelegateChecks({
      repositoryRoot: target,
      checks: steps,
      timeoutMs,
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
    const effects = await changedSinceSnapshot(target, before);
    if (effects.length) {
      if (target === root) recordMutations(effects);
      const code = native ? 'E_INTEGRATION_REVIEW_DRIFT' : 'E_INTEGRATION_PREPARATION_SIDE_EFFECT';
      review.violations.push(...effects.map(({ path }) => ({ code, path })));
      throw new IntegrationError(
        code,
        'Preparation changed reviewable files. Inspect the updated candidate and review again.',
      );
    }
    if (results.some(({ status }) => status !== 'passed'))
      throw new IntegrationError('E_INTEGRATION_PREPARATION', 'Preparation failed before checks.');
  }
  const generatorRuns = [];
  const generatedPaths = [];
  const delegatePaths = [...review.changedPaths];
  let results = [];
  let failureCode;
  let applying = false;
  let baseline;
  let restoreCreated = false;
  try {
    const protectedPaths = reviewScope({ custody, run, scopePaths, preservePaths }).protectedPaths;
    const selectedGenerators = await resolveSelectedGenerators(
      custody.repositoryRoot,
      generators,
      delegatePaths,
      scopePaths,
      protectedPaths,
    );
    const selectedChecks = await resolveSelectedChecks(root, checks, { legacy: !native });
    const selectedPreparation = (
      await resolveSelectedChecks(root, preparation ?? [], { legacy: !native })
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
    verification.reviewOnlyReason = selectedChecks.length ? null : reviewOnlyReason;
    const selected = new Set(custody.selectedPaths ?? []);
    const unselected = (await statusPaths(custody.repositoryRoot))
      .map(({ path }) => path)
      .filter((path) => !selected.has(path));
    // Bounded: the list is kept in the size-limited run record.
    verification.unselectedDirtyPaths = unselected.slice(0, 50);
    verification.unselectedDirtyCount = unselected.length;
    await phase('candidate-selection', () => assertAtTip(root, review.tip, review.violations));
    if (selectedPreparation.length)
      await phase('build-preparation', () => prepare(root, selectedPreparation, 'candidate'));
    for (const generator of selectedGenerators) {
      const generated = await phase('generation', () =>
        runGenerator(root, { ...generator, signal: controller.signal, onProcess }, timeoutMs),
      );
      generatorRuns.push({
        packagePath: generator.packagePath,
        script: generator.script,
        ...generated.result,
      });
      if (generated.result.processTerminationConfirmed === false)
        throw new IntegrationError(
          'E_INTEGRATION_PROCESS',
          'An owned generator process could not be stopped. Recover it before inspecting or accepting the candidate.',
        );
      if (native) recordMutations(generated.changes);
      if (!generated.passed)
        throw new IntegrationError('E_INTEGRATION_GENERATION', 'A declared generator failed.', {
          results: [generated.result],
        });
      const unexpected = generated.changes.filter(
        ({ path }) => !generator.outputPaths.includes(path),
      );
      if (unexpected.length) {
        review.violations.push(
          ...unexpected.map(({ path }) => ({ code: 'E_INTEGRATION_GENERATOR_SCOPE', path })),
        );
        throw new IntegrationError(
          'E_INTEGRATION_GENERATOR_SCOPE',
          'Generator changed undeclared files.',
        );
      }
      generatedPaths.push(...generated.changes.map(({ path }) => path));
    }
    if (generatedPaths.length) {
      if (native)
        throw new IntegrationError(
          'E_INTEGRATION_REVIEW_DRIFT',
          'Generated files changed the candidate. Review the resulting files before accepting.',
        );
      const regenerated = await reviewBranchDelta({ custody, run, scopePaths, preservePaths });
      if (!regenerated.ready) {
        review = regenerated;
        throw new IntegrationError('E_INTEGRATION_GENERATOR_SCOPE', 'Generated files are unsafe.');
      }
      for (const change of regenerated.changes)
        if (generatedPaths.includes(change.path)) change.origin = 'generator';
      review = regenerated;
      verification.candidateIdentity = review.tip;
    }
    await assertAtTip(root, review.tip, review.violations);
    const beforeChecks = await workingSnapshot(root);
    results = await phase('checks', () =>
      runDelegateChecks({
        repositoryRoot: root,
        checks: selectedChecks,
        timeoutMs,
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
    const checkEffects = await changedSinceSnapshot(root, beforeChecks);
    if (checkEffects.length) {
      recordMutations(checkEffects);
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
      baseline = await phase('baseline-preparation', async () => {
        const target = await baselineWorktree(custody);
        baseline = target;
        await prepare(target.root, selectedPreparation, 'baseline');
        for (const generator of selectedGenerators) {
          const generated = await runGenerator(
            target.root,
            { ...generator, signal: controller.signal, onProcess },
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
      const comparison = await compareWithBaseline(results, selectedChecks, baseline, {
        phase,
        timeoutMs,
        signal: controller.signal,
        onProcess,
      });
      results = comparison.results;
      if (comparison.effects.length)
        review.violations.push(
          ...comparison.effects.map(({ path }) => ({
            code: 'E_INTEGRATION_BASELINE_SIDE_EFFECT',
            path,
          })),
        );
      verification.checks = results;
      await progress();
      throw new IntegrationError(
        comparison.effects.length ? 'E_INTEGRATION_BASELINE_SIDE_EFFECT' : 'E_INTEGRATION_CHECKS',
        'Independent checks failed.',
      );
    }
    if (results.some((result) => result.status !== 'passed'))
      throw new IntegrationError(
        'E_INTEGRATION_CHECKS',
        'Independent checks failed. Baseline comparison is an explicit diagnostic action.',
      );
    await assertAtTip(root, review.tip, review.violations);
    const custodyCheck = await validateWorktreeCustody(custody, { native });
    review.warnings = custodyCheck.warnings;
    if (!custodyCheck.valid) {
      review.violations.push(...custodyCheck.violations);
      throw new IntegrationError(
        'E_INTEGRATION_CUSTODY',
        'Run branch custody changed during verification.',
      );
    }
    if (controller.signal.aborted)
      throw new IntegrationError('E_INTEGRATION_INTERRUPTED', 'Integration was interrupted.');
    const parent = custody.repositoryRoot;
    const accepted = {
      delegatePaths,
      generatedPaths,
      changedPaths: review.changedPaths,
      checks: results,
      generators: generatorRuns,
      preparation: verification.preparation,
      candidateIdentity: review.tip,
      verified: results.length > 0 && results.every((result) => result.status === 'passed'),
      reviewOnlyReason: verification.reviewOnlyReason,
      base: review.base,
      tip: review.tip,
      patchSha256: review.patchSha256,
      patchPath: null,
      restoreRef: null,
      restore: null,
    };
    if (review.changedPaths.length) {
      const drift = await applyCheck(parent, review.patchBytes, review.changedPaths);
      if (drift.length) {
        review.violations.push(...drift);
        throw new IntegrationError(
          'E_INTEGRATION_SOURCE_DRIFT',
          'The parent checkout no longer accepts the reviewed patch.',
        );
      }
      if (patchPath) await writeFile(patchPath, review.patchBytes, { mode: 0o600 });
      accepted.patchPath = patchPath ?? null;
      accepted.restoreRef = restoreRef(custody.runId);
      accepted.restore =
        (await text(parent, ['stash', 'create'])) || (await text(parent, ['rev-parse', 'HEAD']));
      await git(parent, ['update-ref', accepted.restoreRef, accepted.restore]);
      restoreCreated = true;
      accepted.modes = await physicalModes(parent, review.changes);
      verification.phase = 'source-write';
      verification.phases.push({ phase: 'source-write', startedAt: new Date().toISOString() });
      await progress();
      await onApplying?.(accepted);
      applying = true;
      const applied = await git(parent, [...APPLY, '-'], {
        input: review.patchBytes,
        allowFailure: true,
      });
      if (applied.code !== 0) {
        const states = await pathStates(parent, accepted, review.patchBytes, review.changedPaths);
        if (Object.values(states).some((state) => ['applied', 'unknown'].includes(state)))
          throw new IntegrationError(
            'E_INTEGRATION_APPLY_INTERRUPTED',
            `git apply failed after its check: ${applied.stderr.trim().slice(-1024)}`,
          );
        // Nothing was written, so the run returns to review instead of recovery.
        await onRolledBack?.({ rollbackErrors: [], code: 'E_INTEGRATION_SOURCE_DRIFT' });
        applying = false;
        review.violations.push(
          ...Object.entries(states)
            .filter(([, state]) => state === 'conflict')
            .map(([path]) => ({ code: 'E_INTEGRATION_SOURCE_DRIFT', path })),
        );
        throw new IntegrationError(
          'E_INTEGRATION_SOURCE_DRIFT',
          `The parent checkout changed after the apply check: ${applied.stderr.trim().slice(-1024)}`,
        );
      }
      await restorePhysicalModes(parent, accepted.modes, review.changedPaths);
    }
    const states = {};
    for (const path of review.changedPaths)
      states[path] = compactIntegrationState(await captureFileState(parent, path));
    await onAccepted?.({ ...accepted, states });
    applying = false;
    if (restoreCreated) await git(parent, ['update-ref', '-d', accepted.restoreRef]);
    return {
      status: 'completed',
      ...review,
      unselectedDirtyPaths: verification.unselectedDirtyPaths,
      unselectedDirtyCount: verification.unselectedDirtyCount,
      checks: results,
      generatedPaths,
      generators: generatorRuns,
      nextAction:
        'Review the uncommitted local diff. The owned worktree is removed unless retention was requested.',
    };
  } catch (error) {
    failureCode = error.code ?? 'E_INTEGRATION_APPLY';
    if (SELECTION_ERRORS.includes(error.code)) throw error;
    if (error.details?.path) review.violations.push({ code: failureCode, ...error.details });
    if (restoreCreated && !applying)
      await git(custody.repositoryRoot, ['update-ref', '-d', restoreRef(custody.runId)]);
    return {
      status: 'blocked',
      ...review,
      code: failureCode,
      checks: results,
      generatedPaths,
      generators: generatorRuns,
      rollbackErrors: [],
      nextAction: applying
        ? 'Run integrate recover with this runId: rollback (default) or accept after inspecting the listed paths.'
        : failureCode === 'E_INTEGRATION_PROCESS'
          ? 'Recover the recorded owned parent command before checks, continuation or cleanup.'
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
    if (verification.commandProcess && baseline)
      verification.retainedCandidatePaths = [baseline.root];
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
      if (baseline && !verification.commandProcess) await removeBaseline(custody, baseline);
      await release();
    }
  }
}

async function workingObject(root, path) {
  let info;
  try {
    info = await lstat(join(root, path));
  } catch (error) {
    if (error.code === 'ENOENT') return ABSENT;
    throw error;
  }
  if (info.isSymbolicLink()) {
    const state = await captureFileState(root, path);
    return {
      mode: '120000',
      oid: await text(root, ['hash-object', '--stdin'], { input: state.target }),
    };
  }
  return {
    mode: info.mode & 0o111 ? '100755' : '100644',
    oid: await text(root, ['--literal-pathspecs', 'hash-object', '--', path]),
  };
}

const ABSENT = { mode: null, oid: 'absent' };
const UNKNOWN = { mode: null, oid: 'unknown' };

async function imageObjects(root, integration, patch, paths) {
  const directory = await mkdtemp(join(tmpdir(), 'planr-recover-'));
  const env = { GIT_INDEX_FILE: join(directory, 'index') };
  const objects = async () => {
    const found = {};
    for (const line of (
      await text(root, ['--literal-pathspecs', 'ls-files', '-s', '-z', '--', ...paths], { env })
    ).split('\0')) {
      const separator = line.indexOf('\t');
      if (separator > 0) {
        const [mode, oid] = line.slice(0, separator).split(' ');
        found[line.slice(separator + 1)] = { mode, oid };
      }
    }
    return Object.fromEntries(paths.map((path) => [path, found[path] ?? ABSENT]));
  };
  try {
    await git(root, ['read-tree', integration.restore], { env });
    // The restore point holds tracked files only; selected untracked files start at base.
    for (const path of paths) {
      const listed = await text(root, ['--literal-pathspecs', 'ls-files', '-s', '--', path], {
        env,
      });
      const fromBase = await text(root, [
        '--literal-pathspecs',
        'ls-tree',
        integration.base,
        '--',
        path,
      ]);
      if (!listed && fromBase) {
        const [mode, , oid] = fromBase.split('\t')[0].split(' ');
        await git(root, ['update-index', '--add', '--cacheinfo', `${mode},${oid},${path}`], {
          env,
        });
      }
    }
    const pre = await objects();
    const preIndex = join(directory, 'pre-index');
    await copyFile(env.GIT_INDEX_FILE, preIndex);
    if (
      (await git(root, [...APPLY, '--cached', '-'], { input: patch, env, allowFailure: true }))
        .code === 0
    )
      return { pre, post: await objects() };
    // The owner changed a path before the restore point; only that path's post-image is unknown.
    const post = {};
    for (const path of paths) {
      await copyFile(preIndex, env.GIT_INDEX_FILE);
      const include = `--include=${path.replace(/[*?[\]\\]/gu, '\\$&')}`;
      const result = await git(root, [...APPLY, '--cached', include, '-'], {
        input: patch,
        env,
        allowFailure: true,
      });
      post[path] = result.code === 0 ? (await objects())[path] : UNKNOWN;
    }
    return { pre, post };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function matches(current, image, other) {
  if (current.oid !== image.oid) return false;
  return image.oid !== other.oid || current.mode === image.mode;
}

/** Classifies each patch path as applied, pending or conflict against its pre and post images. */
async function pathStates(root, integration, patch, paths) {
  const { pre, post } = await imageObjects(root, integration, patch, paths);
  const states = {};
  for (const path of paths) {
    const current = await workingObject(root, path);
    states[path] = matches(current, post[path], pre[path])
      ? 'applied'
      : matches(current, pre[path], post[path])
        ? 'pending'
        : post[path] === UNKNOWN
          ? 'unknown'
          : 'conflict';
  }
  return states;
}

/** Resolves an apply interrupted between its check and completion without overwriting user edits. */
export async function recoverBranchApply(record, resolution = 'rollback') {
  if (!['rollback', 'accept'].includes(resolution))
    throw new IntegrationError(
      'E_INTEGRATION_RECOVERY',
      'Recovery resolution must be rollback or accept.',
    );
  const integration = record.integration;
  const root = record.repositoryRoot;
  if (integration.patchPath !== join(record.runPath, 'patch.diff'))
    throw new IntegrationError('E_INTEGRATION_PATCH', 'Recorded patch pointer is invalid.');
  const patch = await readFile(integration.patchPath);
  if (createHash('sha256').update(patch).digest('hex') !== integration.patchSha256)
    throw new IntegrationError('E_INTEGRATION_PATCH', 'Recorded patch changed after apply began.');
  const paths = integration.changedPaths;
  const release = await checkoutLock(root);
  try {
    const states = await pathStates(root, integration, patch, paths);
    const applied = paths.filter((path) => states[path] === 'applied');
    if (resolution === 'accept') {
      if (applied.length !== paths.length)
        throw new IntegrationError(
          'E_INTEGRATION_RECOVERY_INCOMPLETE',
          applied.length
            ? 'The patch was applied partially; recover with rollback.'
            : 'The patch was not applied; recover with rollback.',
        );
      await restorePhysicalModes(root, integration.modes, paths);
      return { state: 'applied', restored: [], conflicts: [] };
    }
    for (const path of applied) {
      const source = (await text(root, [
        '--literal-pathspecs',
        'ls-tree',
        integration.restore,
        '--',
        path,
      ]))
        ? integration.restore
        : (await text(root, ['--literal-pathspecs', 'ls-tree', integration.base, '--', path]))
          ? integration.base
          : null;
      if (!source) await rm(join(root, path), { force: true });
      else
        await git(root, [
          '--literal-pathspecs',
          'restore',
          `--source=${source}`,
          '--worktree',
          '--',
          path,
        ]);
    }
    await restorePhysicalModes(root, integration.modes, applied);
    const conflicts = paths
      .filter((path) => ['conflict', 'unknown'].includes(states[path]))
      .map((path) => ({ path, code: 'E_INTEGRATION_ROLLBACK_CONFLICT' }));
    return {
      state: conflicts.length ? 'interrupted' : 'rolled-back',
      restored: applied,
      conflicts,
    };
  } finally {
    await release();
  }
}
