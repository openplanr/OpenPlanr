// Hand delegate work back through its run branch: snapshot, review, check at tip, git apply.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  workingSnapshot,
} from './integration-files.mjs';
import { checkoutLock, compareWithBaseline, reviewScope } from './integration-transaction.mjs';
import { compactIntegrationState } from './run-record.mjs';

const DIFF = [
  '-c',
  'diff.noprefix=false',
  'diff',
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--no-relative',
  '--no-renames',
  '--submodule=short',
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
          const operation = args.find((arg) => !arg.startsWith('-') && !arg.includes('='));
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
    child.stdin.on('error', reject);
    child.stdin.end(input ?? '');
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
  const tokens = (await git(root, [...DIFF, '-z', '--raw', '--no-abbrev', base, tip])).stdout
    .toString('utf8')
    .split('\0');
  const entries = [];
  for (let index = 0; index + 1 < tokens.length && tokens[index]; index += 2) {
    const [beforeMode, afterMode, beforeOid, afterOid] = tokens[index].slice(1).split(' ');
    entries.push({ path: tokens[index + 1], beforeMode, afterMode, beforeOid, afterOid });
  }
  return entries;
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

async function applyCheck(root, patch, paths, reverse = false) {
  const result = await git(root, [...APPLY, '--check', ...(reverse ? ['-R'] : []), '-'], {
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
  const changes = [];
  for (const entry of await changedEntries(root, custody.base, tip)) {
    const { path } = entry;
    const before = await objectState(root, entry.beforeMode, entry.beforeOid);
    const after = await objectState(root, entry.afterMode, entry.afterOid);
    if (!allowed.some((rule) => covers(rule, path)))
      violations.push({ code: 'E_INTEGRATION_SCOPE', path });
    if (protectedPaths.some((rule) => covers(rule, path)))
      violations.push({ code: 'E_INTEGRATION_PRESERVE', path });
    // git apply without --index leaves a submodule untouched yet reports success.
    if (before.kind === 'gitlink' || after.kind === 'gitlink')
      violations.push({ code: 'E_INTEGRATION_GITLINK', path });
    else
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
  const modes = new Map();
  for (const { path, before, after } of changes) {
    if (before.kind !== 'file' || after.kind !== 'file') continue;
    const info = await lstat(join(root, path));
    if (info.isFile()) modes.set(path, info.mode & 0o777);
  }
  return modes;
}

// git apply rewrites files with default permissions; only the executable bit belongs to the delta.
async function restorePhysicalModes(root, modes) {
  for (const [path, before] of modes) {
    const info = await lstat(join(root, path));
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
    const drift = await applyCheck(parent, review.patchBytes, review.changedPaths);
    if (drift.length) {
      review.violations.push(...drift);
      throw new IntegrationError(
        'E_INTEGRATION_SOURCE_DRIFT',
        'The parent checkout no longer accepts the reviewed patch.',
      );
    }
    if (patchPath) await writeFile(patchPath, review.patchBytes, { mode: 0o600 });
    const ref = restoreRef(custody.runId);
    const restore =
      (await text(parent, ['stash', 'create'])) || (await text(parent, ['rev-parse', 'HEAD']));
    await git(parent, ['update-ref', ref, restore]);
    restoreCreated = true;
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
      patchPath: patchPath ?? null,
      restoreRef: ref,
      restore,
    };
    verification.phase = 'source-write';
    verification.phases.push({ phase: 'source-write', startedAt: new Date().toISOString() });
    await progress();
    const modes = await physicalModes(parent, review.changes);
    await onApplying?.(accepted);
    applying = true;
    const applied = await git(parent, [...APPLY, '-'], {
      input: review.patchBytes,
      allowFailure: true,
    });
    if (applied.code !== 0)
      throw new IntegrationError(
        'E_INTEGRATION_APPLY_INTERRUPTED',
        `git apply failed after its check: ${applied.stderr.trim().slice(-1024)}`,
      );
    await restorePhysicalModes(parent, modes);
    const states = {};
    for (const path of review.changedPaths)
      states[path] = compactIntegrationState(await captureFileState(parent, path));
    await onAccepted?.({ ...accepted, states });
    applying = false;
    await git(parent, ['update-ref', '-d', ref]);
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
    if (error.code === 'ENOENT') return 'absent';
    throw error;
  }
  if (info.isSymbolicLink()) {
    const state = await captureFileState(root, path);
    return text(root, ['hash-object', '--stdin'], { input: state.target });
  }
  return text(root, ['hash-object', '--', path]);
}

async function imageObjects(root, integration, patch, paths) {
  const directory = await mkdtemp(join(tmpdir(), 'planr-recover-'));
  const env = { GIT_INDEX_FILE: join(directory, 'index') };
  const objects = async () => {
    const found = {};
    for (const line of (await text(root, ['ls-files', '-s', '-z', '--', ...paths], { env })).split(
      '\0',
    )) {
      const separator = line.indexOf('\t');
      if (separator > 0) found[line.slice(separator + 1)] = line.split(' ')[1];
    }
    return Object.fromEntries(paths.map((path) => [path, found[path] ?? 'absent']));
  };
  try {
    await git(root, ['read-tree', integration.restore], { env });
    // The restore point holds tracked files only; selected untracked files start at base.
    for (const path of paths) {
      const listed = await text(root, ['ls-files', '-s', '--', path], { env });
      const fromBase = await text(root, ['ls-tree', integration.base, '--', path]);
      if (!listed && fromBase) {
        const [mode, , oid] = fromBase.split('\t')[0].split(' ');
        await git(root, ['update-index', '--add', '--cacheinfo', `${mode},${oid},${path}`], {
          env,
        });
      }
    }
    const pre = await objects();
    await git(root, [...APPLY, '--cached', '-'], { input: patch, env });
    return { pre, post: await objects() };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
    if (!(await applyCheck(root, patch, paths, true)).length) {
      if (resolution === 'accept') return { state: 'applied', restored: [], conflicts: [] };
      await git(root, [...APPLY, '-R', '-'], { input: patch });
      return { state: 'rolled-back', restored: paths, conflicts: [] };
    }
    if (!(await applyCheck(root, patch, paths)).length) {
      if (resolution === 'accept')
        throw new IntegrationError(
          'E_INTEGRATION_RECOVERY_INCOMPLETE',
          'The patch was not applied; recover with rollback.',
        );
      return { state: 'rolled-back', restored: [], conflicts: [] };
    }
    if (resolution === 'accept')
      throw new IntegrationError(
        'E_INTEGRATION_RECOVERY_INCOMPLETE',
        'The patch was applied partially; recover with rollback.',
      );
    const { pre, post } = await imageObjects(root, integration, patch, paths);
    const restored = [];
    const conflicts = [];
    for (const path of paths) {
      const current = await workingObject(root, path);
      if (current === pre[path]) continue;
      if (current !== post[path]) {
        conflicts.push({ path, code: 'E_INTEGRATION_ROLLBACK_CONFLICT' });
        continue;
      }
      if (pre[path] === 'absent') await rm(join(root, path), { force: true });
      else {
        const source = (await text(root, ['ls-tree', integration.restore, '--', path]))
          ? integration.restore
          : integration.base;
        await git(root, [
          '--literal-pathspecs',
          'restore',
          `--source=${source}`,
          '--worktree',
          '--',
          path,
        ]);
      }
      restored.push(path);
    }
    return { state: conflicts.length ? 'interrupted' : 'rolled-back', restored, conflicts };
  } finally {
    await release();
  }
}
