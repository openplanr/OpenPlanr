import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  assertDesignImplementationHandoff,
  assertDesignPlanningLineage,
} from '../protocol/design-handoff-contracts.mjs';
import { validatePlanningAcceptanceCoverage } from '../protocol/planning-contracts.mjs';

const LINEAGE_FILE = 'design-lineage.json';
const TRANSACTION_FILE = '.design-lineage-transaction.json';

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function safeRelativePath(value, label = 'Planning artifact path') {
  if (typeof value !== 'string' || !value || isAbsolute(value)) {
    throw new TypeError(`${label} must be repository-relative.`);
  }
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').some((part) => part === '..' || part === '')) {
    throw new TypeError(`${label} must stay inside the planning root.`);
  }
  return normalized;
}

function assertInside(root, path) {
  const rel = relative(root, path);
  if (
    rel === '..' ||
    rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(rel)
  ) {
    throw new TypeError('Planning transaction path escaped its root.');
  }
}

function normalizeArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new TypeError('Each planning artifact must be one object.');
  }
  const path = safeRelativePath(artifact.path);
  const bytes =
    typeof artifact.bytes === 'string'
      ? artifact.bytes
      : artifact.bytes instanceof Uint8Array
        ? Buffer.from(artifact.bytes)
        : null;
  if (bytes === null)
    throw new TypeError(`Planning artifact ${path} must provide string or Uint8Array bytes.`);
  return { path, bytes };
}

function normalizePlanningTask(task) {
  return {
    ...task,
    acceptanceRefs: task.acceptanceRefs ?? [],
    testRequirements: task.testRequirements ?? '',
  };
}

/** Build and fully validate the closed requirement → acceptance → task lineage. */
export function composeDesignPlanningLineage({
  handoff,
  specId,
  mappings,
  stories = [],
  tasks = [],
} = {}) {
  assertDesignImplementationHandoff(handoff);
  if (handoff.status !== 'approved')
    throw new TypeError('Planning lineage requires a current approved implementation handoff.');
  const lineage = {
    kind: 'openplanr-design-planning-lineage',
    schemaVersion: '1.0.0',
    handoff: { id: handoff.id, version: handoff.version, contentDigest: handoff.contentDigest },
    specId,
    mappings: structuredClone(mappings ?? []),
  };
  assertDesignPlanningLineage(lineage, handoff);

  const normalizedTasks = tasks.map(normalizePlanningTask);
  const taskById = new Map(normalizedTasks.map((task) => [task.id, task]));
  const acceptanceByStory = new Map(
    stories.map((story) => [
      story.id,
      new Set((story.acceptanceCriteria ?? []).map((criterion) => criterion.id)),
    ]),
  );
  for (const mapping of lineage.mappings) {
    for (const reference of mapping.acceptanceRefs) {
      if (!acceptanceByStory.get(reference.storyId)?.has(reference.acceptanceId)) {
        throw new TypeError(
          `${mapping.requirementId} references missing acceptance criterion ${reference.storyId}:${reference.acceptanceId}.`,
        );
      }
    }
    for (const taskId of mapping.taskIds) {
      const task = taskById.get(taskId);
      if (!task) throw new TypeError(`${mapping.requirementId} references missing task ${taskId}.`);
      const relevantAcceptance = mapping.acceptanceRefs
        .filter(({ storyId }) => storyId === task.storyId)
        .map(({ acceptanceId }) => acceptanceId);
      if (!relevantAcceptance.some((acceptanceId) => task.acceptanceRefs.includes(acceptanceId))) {
        throw new TypeError(
          `${taskId} does not map an acceptance criterion for ${mapping.requirementId}.`,
        );
      }
      if (
        !relevantAcceptance.some((acceptanceId) =>
          String(task.testRequirements).includes(acceptanceId),
        )
      ) {
        throw new TypeError(
          `${taskId} Test Requirements do not name the acceptance criterion for ${mapping.requirementId}.`,
        );
      }
    }
  }
  const coverageIssues = validatePlanningAcceptanceCoverage(stories, normalizedTasks);
  if (coverageIssues.length) {
    throw new TypeError(
      `Planning acceptance coverage is incomplete: ${coverageIssues.map(({ path, detail }) => `${path}: ${detail}`).join(' ')}`,
    );
  }
  return Object.freeze(lineage);
}

export function designPlanningLineagePath(root) {
  return join(resolve(root), LINEAGE_FILE);
}

/**
 * Restore the pre-transaction state after an interrupted multi-file Plan write.
 * Recovery always rolls back; a later explicit Plan invocation may retry safely.
 */
export function recoverDesignPlanningWrite(root, fs = {}) {
  const io = { existsSync, readFileSync, renameSync, rmSync, ...fs };
  const absoluteRoot = resolve(root);
  const journalPath = join(absoluteRoot, TRANSACTION_FILE);
  if (!io.existsSync(journalPath)) return false;
  const journal = JSON.parse(io.readFileSync(journalPath, 'utf8'));
  for (const entry of [...journal.entries].reverse()) {
    assertInside(absoluteRoot, entry.target);
    assertInside(absoluteRoot, entry.stage);
    assertInside(absoluteRoot, entry.backup);
    io.rmSync(entry.stage, { force: true });
    if (io.existsSync(entry.backup)) {
      io.rmSync(entry.target, { force: true });
      io.renameSync(entry.backup, entry.target);
    } else if (!entry.existed) {
      io.rmSync(entry.target, { force: true });
    }
  }
  io.rmSync(journalPath, { force: true });
  return true;
}

/**
 * Commit generated Plan artifacts and their lineage as one recoverable transaction.
 * All semantic validation finishes before the first filesystem write.
 */
export function writeDesignPlanningArtifacts(root, input, options = {}) {
  const io = {
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
    ...options.fs,
  };
  const absoluteRoot = resolve(root);
  const lineage = composeDesignPlanningLineage(input);
  const artifacts = (input.artifacts ?? []).map(normalizeArtifact);
  const targets = [...artifacts, { path: LINEAGE_FILE, bytes: json(lineage) }];
  if (new Set(targets.map(({ path }) => path)).size !== targets.length) {
    throw new TypeError('Planning transaction declares a target path more than once.');
  }
  for (const { path } of targets) {
    const target = join(absoluteRoot, path);
    assertInside(absoluteRoot, target);
    if (io.existsSync(target) && options.replace !== true) {
      const intended = targets.find((entry) => entry.path === path).bytes;
      const current = io.readFileSync(target);
      if (!Buffer.from(current).equals(Buffer.from(intended))) {
        throw new TypeError(`Planning artifact ${path} already exists with different content.`);
      }
    }
  }
  if (
    targets.every(
      ({ path, bytes }) =>
        io.existsSync(join(absoluteRoot, path)) &&
        Buffer.from(io.readFileSync(join(absoluteRoot, path))).equals(Buffer.from(bytes)),
    )
  ) {
    return Object.freeze({ lineage, written: [], repeated: true });
  }

  io.mkdirSync(absoluteRoot, { recursive: true });
  recoverDesignPlanningWrite(absoluteRoot, io);
  const token = randomUUID();
  const entries = targets.map(({ path, bytes }) => {
    const target = join(absoluteRoot, path);
    const stage = `${target}.${token}.stage`;
    const backup = `${target}.${token}.backup`;
    return { path, target, stage, backup, existed: io.existsSync(target), bytes };
  });
  const journalPath = join(absoluteRoot, TRANSACTION_FILE);
  try {
    for (const entry of entries) {
      io.mkdirSync(dirname(entry.target), { recursive: true });
      io.writeFileSync(entry.stage, entry.bytes, { flag: 'wx', mode: 0o600 });
    }
    io.writeFileSync(
      journalPath,
      json({
        kind: 'openplanr-design-planning-transaction',
        schemaVersion: '1.0.0',
        entries: entries.map(({ bytes: _bytes, ...entry }) => entry),
      }),
      { flag: 'wx', mode: 0o600 },
    );
    for (const entry of entries) {
      if (entry.existed) io.renameSync(entry.target, entry.backup);
      io.renameSync(entry.stage, entry.target);
    }
    for (const entry of entries) io.rmSync(entry.backup, { force: true });
    io.rmSync(journalPath, { force: true });
    return Object.freeze({ lineage, written: entries.map(({ path }) => path), repeated: false });
  } catch (error) {
    try {
      recoverDesignPlanningWrite(absoluteRoot, io);
    } catch {
      /* retain the original transaction error */
    }
    for (const entry of entries) {
      io.rmSync(entry.stage, { force: true });
      if (io.existsSync(entry.backup) && !io.existsSync(entry.target))
        io.renameSync(entry.backup, entry.target);
      io.rmSync(entry.backup, { force: true });
    }
    io.rmSync(journalPath, { force: true });
    throw error;
  }
}

export function readDesignPlanningLineage(root, options = {}) {
  const path = designPlanningLineagePath(root);
  if (!existsSync(path)) {
    if (options.allowMissing === true) return null;
    throw new TypeError(`Design planning lineage is missing at ${path}.`);
  }
  return assertDesignPlanningLineage(JSON.parse(readFileSync(path, 'utf8')));
}

function handoffDirectoryName(identity) {
  const id = createHash('sha256').update(identity.id).digest('hex').slice(0, 16);
  return `${id}-v${identity.version}-${identity.contentDigest.slice(7, 23)}`;
}

function readJsonIfPresent(path, readFile) {
  try {
    return JSON.parse(readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Resolve the exact approved package named by lineage without scanning unrelated package versions. */
export function resolveDesignPlanningLineage({
  root,
  lineage,
  taskIds = [],
  readFile = readFileSync,
} = {}) {
  if (!lineage)
    return Object.freeze({
      status: 'absent',
      reason: 'no-lineage',
      lineage: null,
      handoff: null,
      mappings: [],
      requirements: [],
      sources: [],
    });
  assertDesignPlanningLineage(lineage);
  const selected = new Set(taskIds);
  const mappings = selected.size
    ? lineage.mappings.filter((mapping) => mapping.taskIds.some((taskId) => selected.has(taskId)))
    : lineage.mappings;
  const roots = [join(root, 'design'), root];
  const directory = handoffDirectoryName(lineage.handoff);
  let handoff = null;
  let current = null;
  for (const handoffRoot of roots) {
    handoff ??= readJsonIfPresent(
      join(handoffRoot, 'implementation-handoff', 'versions', directory, 'handoff.json'),
      readFile,
    );
    current ??= readJsonIfPresent(
      join(handoffRoot, 'implementation-handoff', 'current.json'),
      readFile,
    );
  }
  if (!handoff)
    return Object.freeze({
      status: 'stale',
      reason: 'approved-package-unavailable',
      lineage,
      handoff: null,
      mappings,
      requirements: [],
      sources: [],
    });
  try {
    assertDesignPlanningLineage(lineage, handoff);
  } catch {
    return Object.freeze({
      status: 'stale',
      reason: 'package-mismatch',
      lineage,
      handoff: null,
      mappings,
      requirements: [],
      sources: [],
    });
  }
  const exactCurrent =
    current &&
    current.id === handoff.id &&
    current.version === handoff.version &&
    current.contentDigest === handoff.contentDigest &&
    current.status === 'approved';
  const requirementIds = new Set(mappings.map(({ requirementId }) => requirementId));
  const requirements = handoff.requirements.filter(({ id }) => requirementIds.has(id));
  const sourceIds = new Set(requirements.flatMap(({ sourceRefs }) => sourceRefs));
  const sources = handoff.sources.filter(({ id }) => sourceIds.has(id));
  return Object.freeze({
    status: exactCurrent ? 'current' : 'stale',
    reason: exactCurrent ? 'exact-approved-package' : 'approved-package-is-not-current',
    lineage,
    handoff,
    mappings,
    requirements,
    sources,
  });
}
