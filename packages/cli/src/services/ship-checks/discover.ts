import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { CliBoundaryError } from '../../cli/error-boundary.js';
import type { ChangeSet } from './changes.js';
import { listFiles, readAddedLines, readAtBase, readChangeSet, repositoryRoot } from './changes.js';
import {
  type CheckCandidate,
  diagnostic,
  SHIP_CHECKS_KIND,
  SHIP_CHECKS_SCHEMA_VERSION,
  type ShipCheck,
  type ShipChecksResult,
  type ShipDiagnostic,
  type ShipTier,
} from './contract.js';
import { readHuskyHook, readPreCommitFramework } from './hooks.js';
import {
  isBuildCommand,
  ManifestError,
  manifestFrom,
  type PackageManifest,
  parseScriptCall,
  readManifest,
  toPosix,
} from './packages.js';
import { findRelatedTests, isCodeFile, namesFromAddedLines } from './related-tests.js';
import { classifyScope } from './scope.js';
import { readTaskRequirements, type TaskRequirements } from './task-requirements.js';
import { firesForChange, type ParsedWorkflow, readWorkflows } from './workflows.js';

export type DiscoverShipChecksOptions = {
  projectDir: string;
  task?: string;
  tier?: ShipTier;
  base?: string;
};

const PLANNING_ROOT = '.planr/';
const BUNDLER_CONFIG =
  /^(?:vite|tsup|tsdown|rollup|rolldown|webpack|esbuild|rspack|rsbuild)\.config\.[cm]?[jt]s$/u;
const FALLBACK_SCRIPTS = ['test', 'typecheck', 'lint'] as const;

function readTask(
  projectDir: string,
  root: string,
  task: string,
): { path: string; requirements: TaskRequirements } {
  const absolute = resolve(projectDir, task);
  const stats = statSync(absolute, { throwIfNoEntry: false });
  if (!stats?.isFile()) {
    throw new CliBoundaryError(
      'E_SHIP_CHECKS_TASK_NOT_FOUND',
      `The task file "${task}" does not exist.`,
      {
        recovery: 'Pass the path of one task Markdown file, relative to the project directory.',
      },
    );
  }
  const path = toPosix(relative(root, realpathSync(absolute)));
  try {
    return { path, requirements: readTaskRequirements(root, absolute, path) };
  } catch (cause) {
    throw new CliBoundaryError(
      'E_SHIP_CHECKS_TASK_UNREADABLE',
      `The task file "${task}" could not be read.`,
      {
        cause,
      },
    );
  }
}

function packageManager(root: string): string {
  if (existsSync(resolve(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(resolve(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(resolve(root, 'bun.lock')) || existsSync(resolve(root, 'bun.lockb'))) return 'bun';
  return 'npm';
}

const BUILD_FIELDS = (manifest: PackageManifest) =>
  JSON.stringify([
    manifest.main,
    manifest.exports,
    manifest.bin,
    Object.entries(manifest.scripts).filter(([name]) => /^build(?::|$)/u.test(name)),
  ]);

/** Whether the change touches a package entry point, a build script, a tsconfig or a bundler config. */
async function touchesBuildInputs(root: string, changes: ChangeSet): Promise<boolean> {
  for (const file of changes.files) {
    const name = basename(file.path);
    if (/^tsconfig.*\.json$/u.test(name) || BUNDLER_CONFIG.test(name)) return true;
    if (name !== 'package.json') continue;
    if (file.status !== 'modified' && file.status !== 'renamed') return true;
    const before = await readAtBase(root, changes.base, file.path);
    const after = readFileSync(resolve(root, file.path), 'utf8');
    try {
      if (
        before === null ||
        BUILD_FIELDS(manifestFrom(JSON.parse(before))) !==
          BUILD_FIELDS(manifestFrom(JSON.parse(after)))
      )
        return true;
    } catch (error) {
      if (error instanceof SyntaxError) return true;
      throw error;
    }
  }
  return false;
}

function planningChecks(root: string): CheckCandidate[] {
  const entry = (id: string, command: string): CheckCandidate => ({
    id: `planning:${id}`,
    command,
    cwd: '.',
    sources: [{ kind: 'planning', file: null, line: null }],
    // Both commands exit 0 even when they report findings, so the output decides the result.
    tags: ['planning', 'report-only'],
    acceptanceIds: [],
  });
  return [
    ...(existsSync(resolve(root, '.planr/specs'))
      ? [entry('spec-sync', 'openplanr spec sync --dry-run')]
      : []),
    entry('sync', 'openplanr sync --dry-run'),
  ];
}

function fallbackChecks(root: string, manifest: PackageManifest | null): CheckCandidate[] {
  const manager = packageManager(root);
  return FALLBACK_SCRIPTS.filter((name) => manifest?.scripts[name] !== undefined).map((name) => ({
    id: `package:${name}`,
    command: `${manager} run ${name}`,
    cwd: '.',
    sources: [{ kind: 'package', file: 'package.json', line: null }],
    tags: ['fallback'],
    acceptanceIds: [],
  }));
}

function selectWorkflows(
  workflows: readonly ParsedWorkflow[],
  tier: ShipTier,
  paths: readonly string[],
  diagnostics: ShipDiagnostic[],
): ParsedWorkflow[] {
  return workflows.filter(({ file, triggers }) => {
    const reviewed = triggers.pullRequest || triggers.mergeGroup;
    if (!reviewed && !triggers.push) {
      diagnostics.push(
        diagnostic(
          'WORKFLOW_NOT_IN_TIER',
          'info',
          `${file} runs only on ${triggers.names.join(', ') || 'no trigger'}; no tier includes it.`,
          file,
        ),
      );
      return false;
    }
    if (tier === 'push') return true;
    if (tier !== 'story') return false;
    if (reviewed && firesForChange(triggers, paths)) return true;
    diagnostics.push(
      diagnostic(
        'WORKFLOW_NOT_IN_TIER',
        'info',
        reviewed
          ? `${file} path filters do not match the change; the push tier includes it.`
          : `${file} runs on push; the push tier includes it.`,
        file,
      ),
    );
    return false;
  });
}

function merge(target: CheckCandidate, source: CheckCandidate): void {
  target.sources.push(...source.sources);
  for (const tag of source.tags) if (!target.tags.includes(tag)) target.tags.push(tag);
  for (const id of source.acceptanceIds)
    if (!target.acceptanceIds.includes(id)) target.acceptanceIds.push(id);
}

/** De-duplicates script calls and identical commands, puts builds first and classifies scope. */
function finalize(
  root: string,
  candidates: readonly CheckCandidate[],
  diagnostics: ShipDiagnostic[],
): ShipCheck[] {
  const manifests = new Map<string, PackageManifest | null>();
  const manifestAt = (dir: string): PackageManifest | null => {
    if (!manifests.has(dir)) {
      try {
        manifests.set(dir, readManifest(resolve(root, dir)));
      } catch (error) {
        if (!(error instanceof ManifestError)) throw error;
        diagnostics.push(
          diagnostic(
            'MANIFEST_INVALID',
            'error',
            `${dir}/package.json is not valid JSON.`,
            `${dir}/package.json`,
          ),
        );
        manifests.set(dir, null);
      }
    }
    return manifests.get(dir) ?? null;
  };
  const byKey = new Map<string, { check: CheckCandidate; packageDir: string }>();
  for (const candidate of candidates) {
    const check: CheckCandidate = {
      ...candidate,
      sources: [...candidate.sources],
      tags: [...candidate.tags],
      acceptanceIds: [...candidate.acceptanceIds],
    };
    const call = check.tags.includes('needs-review')
      ? null
      : parseScriptCall(check.command, check.cwd, root);
    if (call !== null) {
      check.script = { name: call.name, workspace: call.workspace };
      check.tags.push('package-script');
    }
    if (isBuildCommand(check.command)) check.tags.push('build');
    const key =
      call === null
        ? `command\0${check.cwd}\0${check.command}`
        : `script\0${call.packageDir}\0${call.name}`;
    const existing = byKey.get(key);
    if (existing) merge(existing.check, check);
    else byKey.set(key, { check, packageDir: call?.packageDir ?? check.cwd });
  }
  const entries = [...byKey.values()];
  const ordered = [
    ...entries.filter(({ check }) => check.tags.includes('build')),
    ...entries.filter(({ check }) => !check.tags.includes('build')),
  ];
  return ordered.map(({ check, packageDir }) =>
    classifyScope(root, check, packageDir, check.script ? manifestAt(packageDir) : null),
  );
}

/** Discovers the ordered checks for one tier without running any of them. */
export async function discoverShipChecks(
  options: DiscoverShipChecksOptions,
): Promise<ShipChecksResult> {
  const projectDir = resolve(options.projectDir);
  const root = await repositoryRoot(projectDir);
  const task = options.task === undefined ? null : readTask(projectDir, root, options.task);
  const changes = await readChangeSet(root, options.base);
  const diagnostics: ShipDiagnostic[] = [...changes.diagnostics];
  const paths = changes.files.map((file) => file.path);
  const planningOnly = paths.length > 0 && paths.every((path) => path.startsWith(PLANNING_ROOT));
  const tier: ShipTier = options.tier ?? (planningOnly ? 'planning' : 'task');
  if (options.tier !== undefined && options.tier !== 'planning' && planningOnly) {
    diagnostics.push(
      diagnostic(
        'PLANNING_ONLY_CHANGE',
        'info',
        'Only .planr/ files changed; OpenPlanr validation is listed with the requested tier.',
      ),
    );
  }

  const candidates: CheckCandidate[] = [];
  let relatedTests: ShipChecksResult['relatedTests'] = [];
  if (tier !== 'planning') {
    const workflows = readWorkflows(root, diagnostics);
    const selected = selectWorkflows(workflows, tier, paths, diagnostics);
    candidates.push(...selected.flatMap((workflow) => workflow.checks));
    diagnostics.push(...selected.flatMap((workflow) => workflow.notes));
    if (tier === 'task' && (await touchesBuildInputs(root, changes))) {
      const ciRuns = workflows.filter(
        ({ triggers }) => triggers.pullRequest || triggers.mergeGroup || triggers.push,
      );
      candidates.push(
        ...ciRuns
          .flatMap((workflow) => workflow.checks)
          .filter((check) => isBuildCommand(check.command)),
      );
    }
    candidates.push(...readHuskyHook(root, 'pre-commit'), ...readPreCommitFramework(root));
    if (tier === 'push') candidates.push(...readHuskyHook(root, 'pre-push'));
    const taskChecks = task?.requirements.checks ?? [];
    candidates.push(...taskChecks);
    if (taskChecks.length === 0)
      candidates.push(...fallbackChecks(root, readManifestOrNull(root, diagnostics)));
    const added = await readAddedLines(
      root,
      changes,
      (path) => isCodeFile(path) && !path.startsWith(PLANNING_ROOT),
      (path) => readFileSync(resolve(root, path), 'utf8'),
    );
    relatedTests = findRelatedTests(
      root,
      namesFromAddedLines(added),
      await listFiles(root),
      diagnostics,
    );
  }
  if (tier === 'planning' || planningOnly) candidates.push(...planningChecks(root));

  const checks = finalize(root, candidates, diagnostics);
  if (checks.length === 0) {
    diagnostics.push(
      diagnostic('NO_CHECKS', 'warning', `No checks were discovered for the ${tier} tier.`),
    );
  }
  return {
    kind: SHIP_CHECKS_KIND,
    schemaVersion: SHIP_CHECKS_SCHEMA_VERSION,
    complete: !diagnostics.some((entry) => entry.severity === 'error'),
    projectRoot: root,
    tier,
    tierSource: options.tier === undefined ? 'auto' : 'flag',
    base: changes.base,
    task: task === null ? null : { path: task.path },
    changed: { planningOnly, files: changes.files },
    checks,
    requirements: task?.requirements.requirements ?? [],
    acceptance: task?.requirements.acceptance ?? [],
    relatedTests,
    diagnostics,
  };
}

function readManifestOrNull(root: string, diagnostics: ShipDiagnostic[]): PackageManifest | null {
  try {
    return readManifest(root);
  } catch (error) {
    if (!(error instanceof ManifestError)) throw error;
    diagnostics.push(
      diagnostic('MANIFEST_INVALID', 'error', 'package.json is not valid JSON.', 'package.json'),
    );
    return null;
  }
}
