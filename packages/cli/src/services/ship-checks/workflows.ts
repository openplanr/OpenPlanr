import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, posix } from 'node:path';
import { isMap, isScalar, LineCounter, parseDocument, type YAMLMap } from 'yaml';
import type { CheckCandidate, ShipDiagnostic } from './contract.js';
import { diagnostic } from './contract.js';
import { matchesFilterList } from './glob.js';

export type WorkflowTriggers = {
  pullRequest: boolean;
  mergeGroup: boolean;
  push: boolean;
  pullRequestPaths: string[] | null;
  pullRequestPathsIgnore: string[] | null;
  names: string[];
};

export type ParsedWorkflow = {
  file: string;
  triggers: WorkflowTriggers;
  checks: CheckCandidate[];
  /** Diagnostics that apply only when a tier includes this workflow. */
  notes: ShipDiagnostic[];
};

const WORKFLOW_DIR = '.github/workflows';
const INSTALL =
  /^(?:npm (?:ci|install|i)|yarn|yarn install(?: .*)?|pnpm (?:install|i)(?: .*)?|bun install(?: .*)?)$/u;
const MATRIX_REF = /\$\{\{\s*matrix\.([\w-]+)\s*\}\}/gu;
const OTHER_CI_FILES = [
  '.gitlab-ci.yml',
  '.circleci/config.yml',
  'azure-pipelines.yml',
  'Jenkinsfile',
  '.travis.yml',
  'bitbucket-pipelines.yml',
];

type Json = Record<string, unknown>;
const record = (value: unknown): Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const text = (value: unknown): string | undefined =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : undefined;
const stringList = (value: unknown): string[] | null =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : null;

function readTriggers(on: unknown): WorkflowTriggers {
  const names =
    typeof on === 'string' ? [on] : Array.isArray(on) ? on.map(String) : Object.keys(record(on));
  const pullRequest = record(record(on).pull_request);
  return {
    pullRequest: names.includes('pull_request'),
    mergeGroup: names.includes('merge_group'),
    push: names.includes('push'),
    pullRequestPaths: stringList(pullRequest.paths),
    pullRequestPathsIgnore: stringList(pullRequest['paths-ignore']),
    names: [...names].sort(),
  };
}

/** Whether the workflow's pull-request-side triggers fire for the changed paths. */
export function firesForChange(triggers: WorkflowTriggers, paths: readonly string[]): boolean {
  if (triggers.mergeGroup) return true;
  if (!triggers.pullRequest) return false;
  if (triggers.pullRequestPaths !== null) {
    const include = triggers.pullRequestPaths;
    return paths.some((path) => matchesFilterList(path, include));
  }
  if (triggers.pullRequestPathsIgnore !== null) {
    const ignore = triggers.pullRequestPathsIgnore;
    return paths.some((path) => !matchesFilterList(path, ignore));
  }
  return true;
}

type Combination = Record<string, string>;

/** Static matrix combinations for the referenced keys, or null when they cannot be derived. */
function matrixCombinations(strategy: unknown, keys: string[]): Combination[] | null {
  if (keys.length === 0) return [{}];
  const matrix = record(record(strategy).matrix);
  const axes = Object.keys(matrix).filter((key) => key !== 'include' && key !== 'exclude');
  const include = matrix.include;
  if (matrix.exclude !== undefined) return null;
  if (include !== undefined && axes.length > 0) return null;
  if (include !== undefined) {
    if (!Array.isArray(include)) return null;
    const seen = new Set<string>();
    const combinations: Combination[] = [];
    for (const entry of include) {
      const values = record(entry);
      const combination: Combination = {};
      for (const key of keys) {
        const value = text(values[key]);
        if (value === undefined) return null;
        combination[key] = value;
      }
      const id = JSON.stringify(combination);
      if (!seen.has(id)) {
        seen.add(id);
        combinations.push(combination);
      }
    }
    return combinations;
  }
  let combinations: Combination[] = [{}];
  for (const key of keys) {
    const values = matrix[key];
    if (!Array.isArray(values)) return null;
    const scalars = values.map(text);
    if (scalars.some((value) => value === undefined)) return null;
    combinations = combinations.flatMap((combination) =>
      (scalars as string[]).map((value) => ({ ...combination, [key]: value })),
    );
  }
  return combinations;
}

function substitute(value: string, combination: Combination): string {
  return value.replace(MATRIX_REF, (whole, key: string) => combination[key] ?? whole);
}

function normalizeCwd(value: string | undefined): string {
  if (value === undefined || value.trim() === '') return '.';
  const normalized = posix.normalize(value.trim().replace(/^\.\/+/u, ''));
  return normalized === '' ? '.' : normalized.replace(/\/+$/u, '');
}

function runLine(
  document: ReturnType<typeof parseDocument>,
  counter: LineCounter,
  path: (string | number)[],
): number | null {
  const node = document.getIn(path, true);
  const range = isScalar(node) ? node.range : null;
  return range ? counter.linePos(range[0]).line : null;
}

function parseWorkflow(
  root: string,
  name: string,
  diagnostics: ShipDiagnostic[],
): ParsedWorkflow | null {
  const file = `${WORKFLOW_DIR}/${name}`;
  const counter = new LineCounter();
  const document = parseDocument(readFileSync(join(root, file), 'utf8'), { lineCounter: counter });
  if (document.errors.length > 0) {
    const first = document.errors[0];
    diagnostics.push(
      diagnostic(
        'WORKFLOW_INVALID',
        'error',
        `${file} is not valid YAML: ${first?.message ?? 'parse error'}`,
        file,
      ),
    );
    return null;
  }
  const workflow = record(document.toJS());
  const jobsNode = document.get('jobs', true);
  if (!isMap(jobsNode)) {
    diagnostics.push(diagnostic('WORKFLOW_INVALID', 'error', `${file} has no jobs map.`, file));
    return null;
  }
  const workflowDefaults = record(record(workflow.defaults).run);
  const jobs = record(workflow.jobs);
  const checks: CheckCandidate[] = [];
  const notes: ShipDiagnostic[] = [];
  for (const jobId of (jobsNode as YAMLMap).items.map((pair) =>
    String(isScalar(pair.key) ? pair.key.value : pair.key),
  )) {
    const job = record(jobs[jobId]);
    if (typeof job.uses === 'string') {
      notes.push(
        diagnostic(
          'REUSABLE_WORKFLOW_SKIPPED',
          'warning',
          `${file} job ${jobId} calls the reusable workflow ${job.uses}, which is not followed.`,
          file,
        ),
      );
      continue;
    }
    const jobDefaults = record(record(job.defaults).run);
    const needsServices = job.services !== undefined || job.container !== undefined;
    const steps = Array.isArray(job.steps) ? job.steps : [];
    steps.forEach((value: unknown, index: number) => {
      const step = record(value);
      const run = text(step.run);
      if (run === undefined) return;
      const command = run.replace(/\n+$/u, '');
      if (INSTALL.test(command.trim())) return;
      const stepLabel = text(step.name) ?? text(step.id) ?? `step ${index + 1}`;
      const rawCwd =
        text(step['working-directory']) ??
        text(jobDefaults['working-directory']) ??
        text(workflowDefaults['working-directory']);
      const keys = [
        ...new Set(
          [...`${command}\n${rawCwd ?? ''}`.matchAll(MATRIX_REF)].map((match) => match[1] ?? ''),
        ),
      ];
      const combinations = matrixCombinations(job.strategy, keys) ?? [{}];
      const condition = text(step.if) ?? text(job.if);
      const shell = text(step.shell) ?? text(jobDefaults.shell) ?? text(workflowDefaults.shell);
      const line = runLine(document, counter, ['jobs', jobId, 'steps', index, 'run']);
      for (const combination of combinations) {
        const expanded = substitute(command, combination);
        const cwd = substitute(rawCwd ?? '', combination);
        const tags = ['ci'];
        if (expanded.includes('\n')) tags.push('multi-line');
        if (/\$\{\{/u.test(`${expanded}\n${cwd}`)) tags.push('needs-review');
        if (condition !== undefined) tags.push('conditional');
        if (needsServices) tags.push('needs-services');
        const suffix = Object.entries(combination)
          .map(([key, entry]) => `[${key}=${entry}]`)
          .join('');
        checks.push({
          id: `ci:${name}:${jobId}:${text(step.id) ?? index + 1}${suffix}`,
          command: expanded,
          cwd: normalizeCwd(cwd),
          sources: [{ kind: 'ci', file, line, job: jobId, step: stepLabel }],
          tags,
          ...(condition === undefined ? {} : { condition }),
          ...(shell === undefined ? {} : { shell }),
          acceptanceIds: [],
        });
      }
    });
  }
  return { file, triggers: readTriggers(workflow.on), checks, notes };
}

/** Parses every GitHub Actions workflow; invalid files become error diagnostics. */
export function readWorkflows(root: string, diagnostics: ShipDiagnostic[]): ParsedWorkflow[] {
  for (const other of OTHER_CI_FILES) {
    if (existsSync(join(root, other))) {
      diagnostics.push(
        diagnostic(
          'CI_SYSTEM_UNSUPPORTED',
          'warning',
          `${other} is not read; only GitHub Actions workflows are parsed.`,
          other,
        ),
      );
    }
  }
  let names: string[];
  try {
    names = readdirSync(join(root, WORKFLOW_DIR))
      .filter((name) => /\.ya?ml$/u.test(name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return names.flatMap((name) => parseWorkflow(root, basename(name), diagnostics) ?? []);
}
