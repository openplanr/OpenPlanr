/**
 * Storage behind `planr sprint refinement|diff|close|apply` and the batched
 * sprint body: validates the refinement document a host skill produces,
 * renders the sprint tasks and the refinement note, records leftovers on
 * close and writes approved status changes back to the artifacts.
 */

import path from 'node:path';
import {
  REFINEMENT_BUCKETS,
  REFINEMENT_SCHEMA_VERSION,
  type RefinementBucket,
  type RefinementDocument,
  type RefinementItem,
  type RefinementLeftover,
  refinementDocumentSchema,
  type SchemaDiagnostic,
  sprintBatchesInputSchema,
  toSchemaDiagnostics,
} from '../models/sprint-refinement-schema.js';
import type { ArtifactType, OpenPlanrConfig } from '../models/types.js';
import { isValidStatus, VALID_STATUSES } from '../utils/constants.js';
import { fileExists, readFile } from '../utils/fs.js';
import {
  findArtifactTypeById,
  getArtifactDir,
  listArtifacts,
  readArtifact,
  resolveArtifactFilename,
  updateArtifact,
  updateArtifactFields,
} from './artifact-service.js';
import { atomicWriteFile } from './atomic-write-service.js';
import { commitPaths, type GitCommitResult, GitUnavailableError } from './git-service.js';
import { renderTemplate } from './template-service.js';

const CHECKBOX_LINE = /^(\s*)- \[(x| )\]\s+\*{0,2}([A-Z]+-\d+)\*{0,2}(?:\s+(.*))?$/u;
const DONE_STATES = new Set([
  'done',
  'closed',
  'completed',
  'promoted',
  'superseded',
  'shipped',
  'released',
]);
const TASKS_HEADING = '## Tasks';
const IMPLICIT_BATCH_TITLE = 'In progress';

export interface SprintCheckboxLine {
  id: string;
  title: string;
  done: boolean;
  lineIndex: number;
}

export interface SprintTaskBatch {
  title: string;
  effortDays?: number;
  items: Array<{ id: string; title: string; effort?: string; link?: string; checked: boolean }>;
}

export interface RefinementResult {
  id: string;
  refinedAt: string;
  artifactPath: string;
  refinementPath: string;
  notePath: string;
  counts: Record<RefinementBucket, number> & { refuted: number };
}

export interface RefinementDiff {
  from: { sprintId: string; refinedAt: string };
  to: { sprintId: string; refinedAt: string };
  moved: Array<{
    id: string;
    from: RefinementBucket;
    to: RefinementBucket;
    scoreFrom: number;
    scoreTo: number;
  }>;
  added: Array<{ id: string; bucket: RefinementBucket }>;
  removed: Array<{ id: string; bucket: RefinementBucket }>;
  unchanged: number;
}

export interface CloseResult {
  id: string;
  closedAt: string;
  leftovers: RefinementLeftover[];
  warnings: string[];
  artifactPath: string;
  refinementPath: string;
  notePath: string;
}

export interface ApplyOptions {
  yes?: boolean;
  dryRun?: boolean;
  force?: boolean;
  commit?: boolean;
}

export interface ApplyUpdate {
  id: string;
  type: ArtifactType;
  artifactPath: string;
  fields: Record<string, string>;
  from: { status?: string; priority?: string };
}

export interface ApplyResult {
  id: string;
  dryRun: boolean;
  message: string;
  updates: ApplyUpdate[];
  skipped: Array<{ id: string; reason: string }>;
  commit?: GitCommitResult;
  artifactPath: string;
  refinementPath: string;
  notePath: string;
}

export interface ActiveSprintSummary {
  id: string;
  name: string;
  status: string;
  releaseCut?: string;
  capacityDays?: number;
  refinedAt?: string;
  taskIds: string[];
  progress: { done: number; total: number };
  artifactPath: string;
}

interface SprintCreationInput extends Record<string, unknown> {
  title: string;
  goals: string[];
  taskIds: string[];
}

interface LoadedSprint {
  data: Record<string, unknown>;
  content: string;
  filePath: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function relativePath(projectDir: string, filePath: string): string {
  return path.relative(projectDir, filePath).split(path.sep).join('/');
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** A bounded failure the CLI renders as `{ ok: false, code, problem, recovery, diagnostics }`. */
export class SprintRefinementError extends Error {
  readonly code: string;
  readonly recovery: string;
  readonly details?: { diagnostics: SchemaDiagnostic[] };

  constructor(
    code: string,
    problem: string,
    recovery: string,
    extra: { diagnostics?: SchemaDiagnostic[]; cause?: unknown } = {},
  ) {
    super(problem, extra.cause === undefined ? undefined : { cause: extra.cause });
    this.name = code;
    this.code = code;
    this.recovery = recovery;
    if (extra.diagnostics?.length) this.details = { diagnostics: extra.diagnostics };
  }
}

function sprintError(
  code: string,
  problem: string,
  recovery: string,
  extra: { diagnostics?: SchemaDiagnostic[]; cause?: unknown } = {},
): SprintRefinementError {
  return new SprintRefinementError(code, problem, recovery, extra);
}

function inputError(field: string, problem: string, recovery: string): SprintRefinementError {
  return sprintError('E_PLANNING_INPUT_INVALID', problem, recovery, {
    diagnostics: [{ path: `$.${field}`, rule: 'sprint:input', detail: problem }],
  });
}

/** Sprint task lines: `- [ ] **BL-012** title · effort · [view](...)`; the bold marks are optional. */
export function parseSprintCheckboxes(content: string): SprintCheckboxLine[] {
  const lines: SprintCheckboxLine[] = [];
  content.split('\n').forEach((line, lineIndex) => {
    const match = CHECKBOX_LINE.exec(line);
    if (!match) return;
    lines.push({ id: match[3], done: match[2] === 'x', title: (match[4] ?? '').trim(), lineIndex });
  });
  return lines;
}

export function refinementPaths(
  config: OpenPlanrConfig,
  sprintId: string,
): { dir: string; json: string; note: string } {
  const dir = path.posix.join(getArtifactDir(config, 'sprint'), sprintId);
  return { dir, json: `${dir}/refinement.json`, note: `${dir}/refinement.md` };
}

function yamlValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => yamlValue(entry)).join(', ')}]`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Upsert frontmatter fields in place, keeping the file's own formatting.
 * Arrays are written in flow form; an existing block sequence is replaced whole.
 */
export function upsertFrontmatter(raw: string, fields: Record<string, unknown>): string {
  const openIdx = raw.indexOf('---');
  const closeIdx = raw.indexOf('\n---', openIdx + 3);
  if (openIdx === -1 || closeIdx === -1) throw new Error('The artifact has no valid frontmatter.');
  const lines = raw.slice(openIdx, closeIdx).split('\n');
  const body = raw.slice(closeIdx);

  for (const [key, value] of Object.entries({ ...fields, updated: today() })) {
    if (value === undefined) continue;
    const line = `${key}: ${yamlValue(value)}`;
    const keyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`, 'u');
    const at = lines.findIndex((entry, index) => index > 0 && keyPattern.test(entry));
    if (at === -1) {
      lines.push(line);
      continue;
    }
    let end = at + 1;
    while (end < lines.length && /^(\s+\S|- )/u.test(lines[end])) end++;
    lines.splice(at, end - at, line);
  }
  return `${lines.join('\n')}${body}`;
}

/** Replace the content under a level-2 heading, or append the section when the heading is absent. */
export function replaceSection(markdown: string, heading: string, content: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return `${markdown.trimEnd()}\n\n${heading}\n\n${content}\n`;
  let end = start + 1;
  while (end < lines.length && !/^## /u.test(lines[end])) end++;
  lines.splice(start + 1, end - start - 1, '', ...content.split('\n'), '');
  return lines.join('\n');
}

export function parseRefinementDocument(
  value: unknown,
  expectedSprintId?: string,
): RefinementDocument {
  const parsed = refinementDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw sprintError(
      'E_SPRINT_REFINEMENT_INVALID',
      'The refinement document does not match the refinement contract.',
      'Fix the listed paths and re-run; the contract is documented under planr sprint refinement --help.',
      { diagnostics: toSchemaDiagnostics(parsed.error) },
    );
  }
  if (expectedSprintId && parsed.data.sprintId !== expectedSprintId) {
    throw sprintError(
      'E_SPRINT_REFINEMENT_INVALID',
      `The refinement document targets ${parsed.data.sprintId}, not ${expectedSprintId}.`,
      'Set sprintId to the sprint being refined.',
      {
        diagnostics: [
          {
            path: '$.sprintId',
            rule: 'refinement:sprint-mismatch',
            detail: `expected ${expectedSprintId}`,
          },
        ],
      },
    );
  }
  return parsed.data;
}

export async function readRefinement(
  projectDir: string,
  config: OpenPlanrConfig,
  sprintId: string,
): Promise<RefinementDocument | null> {
  const relative = refinementPaths(config, sprintId).json;
  const file = path.join(projectDir, relative);
  if (!(await fileExists(file))) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file));
  } catch (cause) {
    throw sprintError(
      'E_SPRINT_REFINEMENT_INVALID',
      `${relative} is not valid JSON.`,
      'Restore the file from git or re-run planr sprint refinement.',
      { cause },
    );
  }
  return parseRefinementDocument(raw, sprintId);
}

async function requireRefinement(
  projectDir: string,
  config: OpenPlanrConfig,
  sprintId: string,
): Promise<RefinementDocument> {
  const document = await readRefinement(projectDir, config, sprintId);
  if (!document) {
    throw sprintError(
      'E_SPRINT_REFINEMENT_MISSING',
      `${sprintId} has no refinement document at ${refinementPaths(config, sprintId).json}.`,
      'Run planr sprint refinement <id> --data <refinement.json> first.',
    );
  }
  return document;
}

async function requireSprint(
  projectDir: string,
  config: OpenPlanrConfig,
  sprintId: string,
): Promise<LoadedSprint> {
  const sprint = await readArtifact(projectDir, config, 'sprint', sprintId);
  if (!sprint) {
    throw sprintError(
      'E_SPRINT_NOT_FOUND',
      `Sprint ${sprintId} was not found.`,
      'Run planr sprint list to see the available sprints.',
    );
  }
  return {
    data: sprint.data as unknown as Record<string, unknown>,
    content: sprint.content,
    filePath: sprint.filePath,
  };
}

async function resolveItem(
  projectDir: string,
  config: OpenPlanrConfig,
  id: string,
): Promise<{ type: ArtifactType; title?: string; link: string } | null> {
  const type = findArtifactTypeById(id);
  if (!type || type === 'sprint') return null;
  const artifact = await readArtifact(projectDir, config, type, id);
  if (!artifact) return null;
  const filename = await resolveArtifactFilename(projectDir, config, type, id);
  const dir = path.posix.relative(getArtifactDir(config, 'sprint'), getArtifactDir(config, type));
  return { type, title: optionalString(artifact.data.title), link: `${dir}/${filename}.md` };
}

async function renderTasksSection(
  config: OpenPlanrConfig,
  batches: SprintTaskBatch[],
  taskIds: string[],
): Promise<string> {
  const rendered = await renderTemplate(
    'sprints/sprint-tasks.md.hbs',
    { batches, taskIds },
    config.templateOverrides,
  );
  return rendered.trimEnd();
}

function optionalDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  throw inputError(
    field,
    `Sprint ${field} must be an ISO date (YYYY-MM-DD), not ${JSON.stringify(value)}.`,
    `Provide ${field} as YYYY-MM-DD or omit it.`,
  );
}

function optionalPositive(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  throw inputError(
    field,
    `Sprint ${field} must be a positive number, not ${JSON.stringify(value)}.`,
    `Provide ${field} as a positive number or omit it.`,
  );
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** Template data for `planr sprint create`, including the rendered `## Tasks` section. */
export async function prepareSprintCreation(
  projectDir: string,
  config: OpenPlanrConfig,
  input: SprintCreationInput,
  durationOption: unknown,
): Promise<Record<string, unknown>> {
  const duration = String(durationOption ?? input.duration ?? '2w');
  const weeks = /^(\d+)w$/u.exec(duration);
  if (!weeks) throw new Error('Sprint duration must use the form 1w, 2w, and so on.');

  const status = input.status === undefined ? 'active' : String(input.status);
  if (status !== 'planned' && status !== 'active') {
    throw inputError(
      'status',
      `A new sprint is planned or active, not "${status}".`,
      'Use planr sprint close <id> to close a sprint.',
    );
  }
  const releaseCut = optionalDate(input.releaseCut, 'releaseCut');
  const refinedAt = optionalDate(input.refinedAt, 'refinedAt');
  const capacityDays = optionalPositive(input.capacityDays, 'capacityDays');
  const startDate = optionalDate(input.startDate, 'startDate') ?? today();
  const explicitEnd = optionalDate(input.endDate, 'endDate') ?? releaseCut;
  const endDate = explicitEnd ?? addDays(startDate, Number(weeks[1]) * 7);

  const batches: SprintTaskBatch[] = [];
  if (input.batches !== undefined) {
    const parsed = sprintBatchesInputSchema.safeParse(input.batches);
    if (!parsed.success) {
      throw sprintError(
        'E_PLANNING_INPUT_INVALID',
        'Sprint batches must be a list of { title, effortDays?, items[{ id, title?, effort?, link? }] }.',
        'Fix the listed paths and re-run.',
        { diagnostics: toSchemaDiagnostics(parsed.error) },
      );
    }
    for (const batch of parsed.data) {
      const items: SprintTaskBatch['items'] = [];
      for (const item of batch.items) {
        const resolved = await resolveItem(projectDir, config, item.id);
        if (!resolved) {
          throw inputError(
            'batches',
            `Sprint item ${item.id} was not found.`,
            'Create the artifact first (planr backlog add, planr quick create) or remove it from the batch.',
          );
        }
        items.push({
          id: item.id,
          title: item.title ?? resolved.title ?? item.id,
          effort: item.effort,
          link: item.link ?? resolved.link,
          checked: false,
        });
      }
      batches.push({ title: batch.title, effortDays: batch.effortDays, items });
    }
  }
  const taskIds =
    batches.length > 0
      ? [...new Set(batches.flatMap((batch) => batch.items.map((item) => item.id)))]
      : input.taskIds;

  return {
    ...input,
    name: input.title,
    duration: explicitEnd ? `${daysBetween(startDate, endDate)}d` : duration,
    status,
    startDate,
    endDate,
    taskIds,
    releaseCut,
    capacityDays,
    refinedAt,
    tasksSection: await renderTasksSection(config, batches, taskIds),
  };
}

function effectiveBatches(document: RefinementDocument): RefinementDocument['batches'] {
  if (document.batches.length > 0) return document.batches;
  if (document.buckets.inProgress.length === 0) return [];
  return [{ title: IMPLICIT_BATCH_TITLE, itemIds: document.buckets.inProgress }];
}

async function batchesFromDocument(
  projectDir: string,
  config: OpenPlanrConfig,
  document: RefinementDocument,
  checked: Set<string>,
): Promise<SprintTaskBatch[]> {
  const byId = new Map(document.items.map((item) => [item.id, item]));
  const batches: SprintTaskBatch[] = [];
  for (const batch of effectiveBatches(document)) {
    const items: SprintTaskBatch['items'] = [];
    for (const id of batch.itemIds) {
      const item = byId.get(id);
      if (!item) continue;
      const resolved = await resolveItem(projectDir, config, id);
      items.push({
        id,
        title: item.title,
        effort: item.effort,
        link: resolved?.link,
        checked: checked.has(id),
      });
    }
    batches.push({ title: batch.title, effortDays: batch.effortDays, items });
  }
  return batches;
}

function itemRow(item: RefinementItem): string {
  const parts = [`**${item.id}** ${item.title}`, item.effort, item.reason];
  if (item.bucket === 'blocked') {
    if (item.blockedBy.length) parts.push(`blocked by ${item.blockedBy.join('; ')}`);
    if (item.unblockQuestion) parts.push(`unblock: ${item.unblockQuestion}`);
  }
  if (item.evidence) parts.push(`evidence: ${item.evidence}`);
  if (item.targetStatus) parts.push(`→ ${item.targetStatus}`);
  if (item.targetPriority) parts.push(`priority → ${item.targetPriority}`);
  return parts.join(' · ');
}

function cell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function noteView(document: RefinementDocument): Record<string, unknown> {
  const byId = new Map(document.items.map((item) => [item.id, item]));
  const rows = (ids: string[]) =>
    ids.flatMap((id) => {
      const item = byId.get(id);
      return item ? [itemRow(item)] : [];
    });
  const { inputs } = document;
  return {
    sprintId: document.sprintId,
    refinedAt: document.refinedAt,
    inputs: {
      capacity: inputs.capacityDays ? `${inputs.capacityDays} engineer-days` : 'not fitted',
      releaseCut: inputs.releaseCut ?? 'none',
      gitRevision: inputs.gitRevision ? `\`${inputs.gitRevision}\`` : 'not verified against code',
      previousSprintId: inputs.previousSprintId ?? 'none',
      operateCycleId: inputs.operateCycleId ?? 'none',
      sources: inputs.sources.length ? inputs.sources.join(', ') : 'none',
      defaulted: inputs.defaulted.length ? inputs.defaulted.join(', ') : 'none',
      notes: inputs.notes,
    },
    items: document.items.map((item) => ({
      id: item.id,
      score: String(item.score),
      evidenceDate: item.evidenceDate ?? '—',
      stale: item.stale ? 'yes' : 'no',
      blockedBy: item.blockedBy.length ? cell(item.blockedBy.join('; ')) : '—',
      effort: item.effort,
      bucket: item.bucket,
    })),
    refuted: document.refuted,
    batches: effectiveBatches(document).map((batch) => ({
      title: batch.title,
      effortDays: batch.effortDays,
      rows: rows(batch.itemIds),
    })),
    planNext: rows(document.buckets.planNext),
    blocked: rows(document.buckets.blocked),
    closeOrDemote: rows(document.buckets.closeOrDemote),
    leftovers: document.leftovers?.map((leftover) => `**${leftover.id}** · ${leftover.reason}`),
    applied: document.applied
      ? {
          at: document.applied.at,
          updates: document.applied.updates.map(
            (update) =>
              `**${update.id}** · ${Object.entries(update.fields)
                .map(([key, value]) => `${key}=${value}`)
                .join(', ')}`,
          ),
        }
      : undefined,
  };
}

async function writeRefinement(
  projectDir: string,
  config: OpenPlanrConfig,
  document: RefinementDocument,
): Promise<{ refinementPath: string; notePath: string }> {
  const paths = refinementPaths(config, document.sprintId);
  await atomicWriteFile(
    path.join(projectDir, paths.json),
    `${JSON.stringify(document, null, 2)}\n`,
  );
  const note = await renderTemplate(
    'sprints/refinement.md.hbs',
    noteView(document),
    config.templateOverrides,
  );
  await atomicWriteFile(path.join(projectDir, paths.note), note);
  return { refinementPath: paths.json, notePath: paths.note };
}

/** `planr sprint refinement <id> --data`: store the document and fill the sprint from it. */
export async function recordRefinement(
  projectDir: string,
  config: OpenPlanrConfig,
  sprintId: string,
  input: unknown,
): Promise<RefinementResult> {
  const sprint = await requireSprint(projectDir, config, sprintId);
  if (String(sprint.data.status ?? '').toLowerCase() === 'closed') {
    throw sprintError(
      'E_SPRINT_CLOSED',
      `${sprintId} is closed and cannot be refined.`,
      'Create a new sprint with planr sprint create and refine that one.',
    );
  }
  const document = parseRefinementDocument(input, sprintId);

  const checked = new Set(
    parseSprintCheckboxes(sprint.content)
      .filter((line) => line.done)
      .map((line) => line.id),
  );
  const batches = await batchesFromDocument(projectDir, config, document, checked);
  const taskIds = [...new Set(effectiveBatches(document).flatMap((batch) => batch.itemIds))];
  const tasksSection = await renderTasksSection(config, batches, taskIds);
  const fields: Record<string, unknown> = {
    refinedAt: document.refinedAt,
    taskIds,
    capacityDays: document.inputs.capacityDays,
    releaseCut: document.inputs.releaseCut,
  };
  const raw = await readFile(sprint.filePath);
  const next = replaceSection(upsertFrontmatter(raw, fields), TASKS_HEADING, tasksSection);
  await updateArtifact(projectDir, config, 'sprint', sprintId, next);
  const written = await writeRefinement(projectDir, config, document);

  const counts = Object.fromEntries(
    REFINEMENT_BUCKETS.map((bucket) => [bucket, document.buckets[bucket].length]),
  ) as Record<RefinementBucket, number>;
  return {
    id: sprintId,
    refinedAt: document.refinedAt,
    artifactPath: relativePath(projectDir, sprint.filePath),
    ...written,
    counts: { ...counts, refuted: document.refuted.length },
  };
}

/** `planr sprint diff <from> <to>`: bucket moves, additions, removals and score changes. */
export function diffRefinements(from: RefinementDocument, to: RefinementDocument): RefinementDiff {
  const before = new Map(from.items.map((item) => [item.id, item]));
  const after = new Map(to.items.map((item) => [item.id, item]));
  const byId = (a: { id: string }, b: { id: string }) =>
    a.id.localeCompare(b.id, undefined, { numeric: true });
  const moved: RefinementDiff['moved'] = [];
  let unchanged = 0;
  for (const [id, item] of before) {
    const next = after.get(id);
    if (!next) continue;
    if (next.bucket === item.bucket) unchanged++;
    else
      moved.push({
        id,
        from: item.bucket,
        to: next.bucket,
        scoreFrom: item.score,
        scoreTo: next.score,
      });
  }
  const added = [...after.values()]
    .filter((item) => !before.has(item.id))
    .map((item) => ({ id: item.id, bucket: item.bucket }));
  const removed = [...before.values()]
    .filter((item) => !after.has(item.id))
    .map((item) => ({ id: item.id, bucket: item.bucket }));
  return {
    from: { sprintId: from.sprintId, refinedAt: from.refinedAt },
    to: { sprintId: to.sprintId, refinedAt: to.refinedAt },
    moved: moved.sort(byId),
    added: added.sort(byId),
    removed: removed.sort(byId),
    unchanged,
  };
}

function emptyRefinement(sprintId: string, refinedAt: string): RefinementDocument {
  return {
    schemaVersion: REFINEMENT_SCHEMA_VERSION,
    sprintId,
    refinedAt,
    inputs: { sources: [], defaulted: ['refinement'] },
    items: [],
    buckets: { inProgress: [], planNext: [], blocked: [], closeOrDemote: [] },
    batches: [],
    refuted: [],
  };
}

/** `planr sprint close <id>`: mark the sprint closed and record what was not finished. */
export async function closeSprint(
  projectDir: string,
  config: OpenPlanrConfig,
  sprintId: string,
): Promise<CloseResult> {
  const sprint = await requireSprint(projectDir, config, sprintId);
  if (String(sprint.data.status ?? '').toLowerCase() === 'closed') {
    throw sprintError(
      'E_SPRINT_ALREADY_CLOSED',
      `${sprintId} is already closed.`,
      'Nothing to do; open the next sprint with planr sprint create.',
    );
  }
  const checkboxes = new Map(parseSprintCheckboxes(sprint.content).map((line) => [line.id, line]));
  const leftovers: RefinementLeftover[] = [];
  const warnings: string[] = [];
  for (const id of stringList(sprint.data.taskIds)) {
    const line = checkboxes.get(id);
    if (line) {
      if (!line.done) leftovers.push({ id, reason: 'unchecked' });
      continue;
    }
    const type = findArtifactTypeById(id);
    if (!type || type === 'sprint') {
      warnings.push(`${id}: not an artifact id; not carried forward.`);
      continue;
    }
    const artifact = await readArtifact(projectDir, config, type, id);
    if (!artifact) {
      warnings.push(`${id}: artifact not found; not carried forward.`);
      continue;
    }
    if (!DONE_STATES.has(String(artifact.data.status ?? '').toLowerCase()))
      leftovers.push({ id, reason: 'not-done' });
  }

  const closedAt = today();
  const document =
    (await readRefinement(projectDir, config, sprintId)) ?? emptyRefinement(sprintId, closedAt);
  const raw = await readFile(sprint.filePath);
  await updateArtifact(
    projectDir,
    config,
    'sprint',
    sprintId,
    upsertFrontmatter(raw, { status: 'closed', closedAt }),
  );
  const written = await writeRefinement(projectDir, config, { ...document, leftovers });
  return {
    id: sprintId,
    closedAt,
    leftovers,
    warnings,
    artifactPath: relativePath(projectDir, sprint.filePath),
    ...written,
  };
}

/** `planr sprint apply <id>`: write the approved status changes, then optionally commit them. */
export async function applyRefinement(
  projectDir: string,
  config: OpenPlanrConfig,
  sprintId: string,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const sprint = await requireSprint(projectDir, config, sprintId);
  const document = await requireRefinement(projectDir, config, sprintId);
  const updates: ApplyUpdate[] = [];
  const skipped: ApplyResult['skipped'] = [];
  const invalid: SchemaDiagnostic[] = [];

  for (const [index, item] of document.items.entries()) {
    const fields: Record<string, string> = {};
    if (item.targetStatus) fields.status = item.targetStatus;
    if (item.targetPriority) fields.priority = item.targetPriority;
    if (item.bucket === 'blocked' && item.blockedBy.length)
      fields.blockedBy = item.blockedBy.join('; ');
    if (Object.keys(fields).length === 0) continue;

    const type = findArtifactTypeById(item.id);
    if (!type || type === 'sprint') {
      skipped.push({ id: item.id, reason: 'not a writable artifact id' });
      continue;
    }
    if (fields.priority && type !== 'backlog') {
      skipped.push({
        id: item.id,
        reason: `priority applies to backlog items only; ${type} keeps its priority`,
      });
      delete fields.priority;
      if (Object.keys(fields).length === 0) continue;
    }
    const artifact = await readArtifact(projectDir, config, type, item.id);
    if (!artifact) {
      skipped.push({ id: item.id, reason: 'artifact not found' });
      continue;
    }
    if (fields.status && !options.force && !isValidStatus(type, fields.status)) {
      invalid.push({
        path: `$.items[${index}].targetStatus`,
        rule: 'refinement:status-vocabulary',
        detail: `"${fields.status}" is not a ${type} status (${VALID_STATUSES[type]?.join(', ')})`,
      });
      continue;
    }
    updates.push({
      id: item.id,
      type,
      artifactPath: relativePath(projectDir, artifact.filePath),
      fields,
      from: {
        status: optionalString(artifact.data.status),
        priority: optionalString(artifact.data.priority),
      },
    });
  }
  if (invalid.length) {
    throw sprintError(
      'E_SPRINT_APPLY_STATUS_INVALID',
      'Some target statuses are outside the repository status vocabulary.',
      'Use each type’s vocabulary from planr update --help, or pass --force.',
      { diagnostics: invalid },
    );
  }

  const message = `chore(planr): refine backlog for ${sprintId}`;
  const paths = refinementPaths(config, sprintId);
  const base = {
    id: sprintId,
    message,
    updates,
    skipped,
    artifactPath: relativePath(projectDir, sprint.filePath),
    refinementPath: paths.json,
    notePath: paths.note,
  };
  if (options.dryRun) return { ...base, dryRun: true };
  if (!options.yes) {
    throw sprintError(
      'E_SPRINT_APPLY_CONFIRMATION_REQUIRED',
      'Applying a refinement changes artifact statuses and needs explicit confirmation.',
      'Re-run with --yes after the approval question, or use --dry-run to preview the changes.',
    );
  }

  for (const update of updates) {
    await updateArtifactFields(projectDir, config, update.type, update.id, update.fields);
  }
  await writeRefinement(projectDir, config, {
    ...document,
    applied: {
      at: new Date().toISOString(),
      updates: updates.map((update) => ({
        id: update.id,
        type: update.type,
        fields: update.fields,
      })),
    },
  });

  let commit: GitCommitResult | undefined;
  if (options.commit) {
    const commitList = [
      ...new Set([
        base.artifactPath,
        paths.json,
        paths.note,
        ...updates.map((u) => u.artifactPath),
      ]),
    ];
    try {
      commit = await commitPaths(projectDir, commitList, message);
    } catch (cause) {
      if (cause instanceof GitUnavailableError) {
        throw sprintError(
          'E_SPRINT_GIT_UNAVAILABLE',
          `The status changes were written but not committed: ${cause.message.trim()}`,
          'Commit the changed files by hand, or re-run without --commit.',
          { cause },
        );
      }
      throw sprintError(
        'E_SPRINT_COMMIT_FAILED',
        `The status changes were written but git commit failed: ${
          cause instanceof Error ? cause.message.trim() : String(cause)
        }`,
        'Resolve the git error (identity, hooks, signing) and commit the listed paths by hand.',
        { cause },
      );
    }
  }
  return { ...base, dryRun: false, commit };
}

/** The newest sprint whose status is `active`, with its checkbox progress. */
export async function findActiveSprint(
  projectDir: string,
  config: OpenPlanrConfig,
): Promise<ActiveSprintSummary | null> {
  const rows = await listArtifacts(projectDir, config, 'sprint');
  const active: Array<{ id: string; sprint: LoadedSprint }> = [];
  for (const row of rows) {
    const sprint = await readArtifact(projectDir, config, 'sprint', row.id);
    if (!sprint) continue;
    const data = sprint.data as unknown as Record<string, unknown>;
    if (String(data.status ?? '').toLowerCase() !== 'active') continue;
    active.push({
      id: row.id,
      sprint: { data, content: sprint.content, filePath: sprint.filePath },
    });
  }
  if (active.length === 0) return null;
  active.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
  const { id, sprint } = active[0];
  const taskIds = stringList(sprint.data.taskIds);
  const checkboxes = parseSprintCheckboxes(sprint.content);
  const progress =
    checkboxes.length > 0
      ? { done: checkboxes.filter((line) => line.done).length, total: checkboxes.length }
      : { done: 0, total: taskIds.length };
  const capacity = sprint.data.capacityDays;
  return {
    id,
    name: optionalString(sprint.data.name) ?? id,
    status: 'active',
    releaseCut: optionalString(sprint.data.releaseCut),
    capacityDays: typeof capacity === 'number' ? capacity : undefined,
    refinedAt: optionalString(sprint.data.refinedAt),
    taskIds,
    progress,
    artifactPath: relativePath(projectDir, sprint.filePath),
  };
}
