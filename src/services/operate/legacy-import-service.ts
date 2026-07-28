import { lstat, mkdir, open, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDigest, canonicalize, sha256Digest } from './canonical.js';
import { operatingProjectKey } from './config.js';
import { OperatingEventStore } from './event-store.js';
import { parseStrictJson } from './evidence-import.js';
import { applyJournalTransaction, prepareJournalTransaction } from './journal.js';
import { withOperatingLock } from './lock-service.js';
import { persistOperatingProjections } from './projection-persistence.js';
import { assertOperatingArtifact } from './protocol.js';
import { containsSecret } from './redaction.js';
import {
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  OperateError,
  type OperatingEvent,
  type OperatingEventHead,
  type OperatingMigrationRecord,
  type OperatingRecoveryRecord,
} from './types.js';
import { isPathInside, resolveContainedPath, resolveOperatingPaths } from './workspace.js';

const LEGACY_ROOT = '.planr/board';
const MAX_FILES = 1_000;
const MAX_BYTES = 10 * 1024 * 1024;
const UNKNOWN_CREATED_AT = '1970-01-01T00:00:00.000Z';
const IMPORT_EVENT_TYPE = 'migration.legacy-imported' as const;
const IMPORT_ACTOR = { kind: 'migration' as const, id: 'openplanr-operate' };
const SUPPORTED_EVENT_SOURCE_PATH = /^\.planr\/board(?:\/[A-Za-z0-9._-]+)*$/;
const STRUCTURED_JSON_NAMES = new Set([
  'board.json',
  'register.json',
  'findings.json',
  'decisions.json',
  'gaps.json',
  'routes.json',
  'outcomes.json',
  'backlog.json',
]);

export type LegacyOperatingKind = 'finding' | 'decision' | 'gap' | 'route' | 'outcome' | 'unknown';

export interface LegacyMigrationFilePreview {
  path: string;
  digest: `sha256:${string}`;
  size: number;
  rows: number;
}

export interface LegacyMigrationRowPreview {
  sourceId: string;
  sourcePath: string;
  sourceDigest: `sha256:${string}`;
  legacyKind: LegacyOperatingKind;
  legacyId: string | null;
  recordDigest: `sha256:${string}`;
  eventId: string;
  targetId: string;
  disposition: 'import' | 'already-imported' | 'duplicate' | 'conflict';
  duplicateOf?: string;
}

export interface OperatingMigrationInspection {
  record: OperatingMigrationRecord | null;
  sourcePath: typeof LEGACY_ROOT | null;
  files: LegacyMigrationFilePreview[];
  rows: LegacyMigrationRowPreview[];
  counts: {
    files: number;
    bytes: number;
    importable: number;
    alreadyImported: number;
    duplicates: number;
    conflicts: number;
  };
}

interface LegacySourceFile {
  absolutePath: string;
  path: string;
  digest: `sha256:${string}`;
  bytes: Buffer;
}

interface LegacyCandidate extends LegacyMigrationRowPreview {
  legacyRecord: Record<string, unknown>;
}

interface PreparedInspection extends OperatingMigrationInspection {
  sourceDigest: `sha256:${string}` | null;
  backupManifest: LegacyBackupManifest | null;
  candidates: LegacyCandidate[];
}

interface LegacyBackupManifest {
  implementation: 'openplanr-operate-legacy-backup';
  version: '1.0.0';
  migrationId: string;
  sourceRoot: typeof LEGACY_ROOT;
  sourceDigest: `sha256:${string}`;
  files: Array<{
    path: string;
    digest: `sha256:${string}`;
    size: number;
    backupFile: string;
  }>;
}

interface LegacyImportHooks {
  beforeTransition?: (
    transition: 'lock' | 'backup' | 'record' | 'event' | 'metadata' | 'checkpoint',
    index?: number,
  ) => Promise<void> | void;
}

function slashPath(value: string): string {
  return value.split(path.sep).join('/');
}

function emptyInspection(): PreparedInspection {
  return {
    record: null,
    sourcePath: null,
    sourceDigest: null,
    backupManifest: null,
    files: [],
    rows: [],
    candidates: [],
    counts: {
      files: 0,
      bytes: 0,
      importable: 0,
      alreadyImported: 0,
      duplicates: 0,
      conflicts: 0,
    },
  };
}

function decodeUtf8(bytes: Buffer, sourcePath: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new OperateError(
      'E_OPERATE_MIGRATION_CONFLICT',
      `Legacy board file is not valid UTF-8: ${sourcePath}`,
    );
  }
}

async function readLegacyFiles(projectRoot: string): Promise<LegacySourceFile[]> {
  const root = await resolveContainedPath(projectRoot, LEGACY_ROOT);
  const rootInfo = await lstat(root).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (!rootInfo) return [];
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new OperateError(
      'E_OPERATE_MIGRATION_CONFLICT',
      `${LEGACY_ROOT} must be a real directory, not a file or symlink.`,
    );
  }
  const canonicalProject = await realpath(projectRoot);
  const canonicalRoot = await realpath(root);
  if (!isPathInside(canonicalProject, canonicalRoot)) {
    throw new OperateError('E_OPERATE_PATH_ESCAPE', `${LEGACY_ROOT} resolves outside the project.`);
  }

  const files: LegacySourceFile[] = [];
  let totalBytes = 0;
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      const relative = slashPath(path.relative(canonicalProject, target));
      if (containsSecret(entry.name)) {
        throw new OperateError(
          'E_OPERATE_SECRET_DETECTED',
          'Legacy board contains a secret-shaped file name; rename or remove it before migration.',
        );
      }
      if (entry.isSymbolicLink()) {
        throw new OperateError(
          'E_OPERATE_MIGRATION_CONFLICT',
          `Legacy board contains a symlink: ${relative}`,
        );
      }
      if (entry.isDirectory()) {
        await visit(target);
        continue;
      }
      if (!entry.isFile()) {
        throw new OperateError(
          'E_OPERATE_MIGRATION_CONFLICT',
          `Legacy board contains a non-file entry: ${relative}`,
        );
      }
      if (files.length >= MAX_FILES) {
        throw new OperateError(
          'E_OPERATE_INPUT_TOO_LARGE',
          `Legacy board exceeds the ${MAX_FILES}-file limit.`,
        );
      }
      const bytes = await readFile(target);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_BYTES) {
        throw new OperateError(
          'E_OPERATE_INPUT_TOO_LARGE',
          `Legacy board exceeds the ${MAX_BYTES}-byte limit.`,
        );
      }
      files.push({
        absolutePath: target,
        path: relative,
        digest: sha256Digest(bytes),
        bytes,
      });
    }
  }
  await visit(canonicalRoot);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function splitMarkdownTableRow(line: string): string[] {
  const value = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (escaped) current += '\\';
  cells.push(current.trim());
  return cells;
}

function normalizedHeader(value: string): string {
  return value
    .replace(/[*_`]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function legacyKindFromId(value: string): LegacyOperatingKind {
  const id = value.trim().toUpperCase();
  if (/^(?:F|FND)-/.test(id)) return 'finding';
  if (/^(?:D|DEC)-/.test(id)) return 'decision';
  if (/^GAP-/.test(id)) return 'gap';
  if (/^(?:A|ACT)-/.test(id)) return 'route';
  if (/^OUT-/.test(id)) return 'outcome';
  return 'unknown';
}

function legacyKindFromHeaders(headers: string[], sourcePath: string): LegacyOperatingKind {
  if (headers.includes('question')) {
    return sourcePath.includes('gap') ? 'gap' : 'decision';
  }
  if (headers.includes('lane') || headers.includes('title')) return 'finding';
  if (sourcePath.includes('decision')) return 'decision';
  if (sourcePath.includes('gap')) return 'gap';
  if (sourcePath.includes('route')) return 'route';
  if (sourcePath.includes('outcome')) return 'outcome';
  return 'unknown';
}

function boundedLegacyId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (containsSecret(id)) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) ? id : null;
}

function candidate(input: {
  sourcePath: string;
  sourceDigest: `sha256:${string}`;
  locator: string;
  kind: LegacyOperatingKind;
  legacyId: string | null;
  record: Record<string, unknown>;
}): LegacyCandidate {
  const recordDigest = canonicalDigest(input.record);
  const identity = `${input.kind}:${input.legacyId ?? recordDigest}`;
  return {
    sourceId: `${input.sourcePath}:${input.locator}`,
    sourcePath: input.sourcePath,
    sourceDigest: input.sourceDigest,
    legacyKind: input.kind,
    legacyId: input.legacyId,
    recordDigest,
    eventId: `legacy-import-${canonicalDigest(identity).slice('sha256:'.length)}`,
    targetId: `legacy:${identity}`,
    disposition: 'import',
    legacyRecord: input.record,
  };
}

function parseMarkdownCandidates(file: LegacySourceFile): {
  candidates: LegacyCandidate[];
  conflicts: string[];
} {
  if (!file.path.endsWith('.md')) return { candidates: [], conflicts: [] };
  const source = decodeUtf8(file.bytes, file.path).replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const candidates: LegacyCandidate[] = [];
  const conflicts: string[] = [];
  const claimedLines = new Set<number>();

  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (!lines[index].includes('|') || !lines[index + 1].includes('-')) continue;
    const headers = splitMarkdownTableRow(lines[index]).map(normalizedHeader);
    const separator = splitMarkdownTableRow(lines[index + 1]);
    if (
      headers.length < 2 ||
      separator.length !== headers.length ||
      separator.some((cell) => !/^:?-{3,}:?$/.test(cell.trim()))
    ) {
      continue;
    }
    if (!headers.includes('id')) continue;
    const idIndex = headers.indexOf('id');
    const kind = legacyKindFromHeaders(headers, file.path);
    let rowIndex = index + 2;
    while (rowIndex < lines.length && lines[rowIndex].includes('|')) {
      const cells = splitMarkdownTableRow(lines[rowIndex]);
      if (cells.length !== headers.length) {
        conflicts.push(`${file.path}:${rowIndex + 1}:malformed-table-row`);
        claimedLines.add(rowIndex);
        rowIndex += 1;
        continue;
      }
      const fields = Object.fromEntries(headers.map((header, cell) => [header, cells[cell]]));
      const legacyId = boundedLegacyId(cells[idIndex]);
      if (!legacyId) {
        conflicts.push(`${file.path}:${rowIndex + 1}:missing-or-invalid-id`);
      } else {
        candidates.push(
          candidate({
            sourcePath: file.path,
            sourceDigest: file.digest,
            locator: `line-${rowIndex + 1}`,
            kind: kind === 'unknown' ? legacyKindFromId(legacyId) : kind,
            legacyId,
            record: {
              format: 'markdown-table',
              fields,
            },
          }),
        );
      }
      claimedLines.add(rowIndex);
      rowIndex += 1;
    }
    index = rowIndex - 1;
  }

  let block:
    | {
        start: number;
        fields: Record<string, string>;
      }
    | undefined;
  const flushBlock = () => {
    if (!block) return;
    const legacyId = boundedLegacyId(block.fields.id);
    if (legacyId && Object.keys(block.fields).length >= 2) {
      candidates.push(
        candidate({
          sourcePath: file.path,
          sourceDigest: file.digest,
          locator: `line-${block.start + 1}`,
          kind: legacyKindFromId(legacyId),
          legacyId,
          record: {
            format: 'markdown-fields',
            fields: block.fields,
          },
        }),
      );
    } else if (block.fields.id) {
      conflicts.push(`${file.path}:${block.start + 1}:missing-or-invalid-id`);
    }
    block = undefined;
  };
  for (let index = 0; index < lines.length; index += 1) {
    if (claimedLines.has(index)) continue;
    const match = lines[index].match(
      /^\s*(?:[-*]\s*)?(?:\*\*)?([A-Za-z][A-Za-z0-9 /_-]{0,48})(?:\*\*)?\s*:\s*(.*?)\s*$/,
    );
    if (!match) {
      if (!lines[index].trim()) flushBlock();
      continue;
    }
    const key = normalizedHeader(match[1]);
    if (key === 'id') {
      flushBlock();
      block = { start: index, fields: { id: match[2].trim() } };
    } else if (block) {
      block.fields[key] = match[2].trim();
    }
  }
  flushBlock();
  return { candidates, conflicts };
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonKind(key: string | null, value: Record<string, unknown>): LegacyOperatingKind {
  if (key?.startsWith('finding')) return 'finding';
  if (key?.startsWith('decision')) return 'decision';
  if (key?.startsWith('gap')) return 'gap';
  if (key?.startsWith('route')) return 'route';
  if (key?.startsWith('outcome')) return 'outcome';
  const id = boundedLegacyId(value.id);
  if (id) return legacyKindFromId(id);
  return 'unknown';
}

function parseJsonCandidates(file: LegacySourceFile): {
  candidates: LegacyCandidate[];
  conflicts: string[];
} {
  if (!STRUCTURED_JSON_NAMES.has(path.basename(file.path).toLowerCase())) {
    return { candidates: [], conflicts: [] };
  }
  const source = decodeUtf8(file.bytes, file.path);
  let parsed: unknown;
  try {
    parsed = parseStrictJson(source, {
      maxBytes: MAX_BYTES,
      maxDepth: 32,
      maxScalars: 20_000,
      maxStringLength: 100_000,
    });
  } catch {
    return { candidates: [], conflicts: [`${file.path}:corrupt-json`] };
  }
  const entries: Array<{ key: string | null; value: Record<string, unknown> }> = [];
  if (Array.isArray(parsed)) {
    for (const value of parsed) {
      if (!plainObject(value)) {
        return { candidates: [], conflicts: [`${file.path}:non-object-json-record`] };
      }
      entries.push({ key: null, value });
    }
  } else if (plainObject(parsed)) {
    let foundCollection = false;
    for (const key of ['findings', 'decisions', 'gaps', 'routes', 'outcomes', 'records']) {
      const collection = parsed[key];
      if (collection === undefined) continue;
      foundCollection = true;
      if (!Array.isArray(collection) || collection.some((value) => !plainObject(value))) {
        return { candidates: [], conflicts: [`${file.path}:invalid-${key}-collection`] };
      }
      entries.push(
        ...collection.map((value) => ({
          key,
          value: value as Record<string, unknown>,
        })),
      );
    }
    if (!foundCollection) entries.push({ key: null, value: parsed });
  } else {
    return { candidates: [], conflicts: [`${file.path}:invalid-json-root`] };
  }
  const candidates: LegacyCandidate[] = [];
  const conflicts: string[] = [];
  for (const [index, entry] of entries.entries()) {
    if (typeof entry.value.id === 'string' && containsSecret(entry.value.id.trim())) {
      conflicts.push(`${file.path}:json-${index + 1}:sensitive-id`);
      continue;
    }
    const legacyId = boundedLegacyId(entry.value.id);
    candidates.push(
      candidate({
        sourcePath: file.path,
        sourceDigest: file.digest,
        locator: `json-${index + 1}`,
        kind: jsonKind(entry.key, entry.value),
        legacyId,
        record: {
          format: 'json',
          value: entry.value,
        },
      }),
    );
  }
  return {
    candidates,
    conflicts,
  };
}

function migrationEventPayload(event: OperatingEvent): {
  migrationId?: string;
  legacyKind?: LegacyOperatingKind;
  legacyId?: string | null;
  sourceDigest?: `sha256:${string}`;
  recordDigest?: `sha256:${string}`;
} {
  return event.payload as {
    migrationId?: string;
    legacyKind?: LegacyOperatingKind;
    legacyId?: string | null;
    sourceDigest?: `sha256:${string}`;
    recordDigest?: `sha256:${string}`;
  };
}

async function applyDuplicateAndConflictRules(
  candidates: LegacyCandidate[],
  store: OperatingEventStore,
  migrationId: string,
): Promise<string[]> {
  const conflicts: string[] = [];
  const byIdentity = new Map<string, LegacyCandidate>();
  for (const row of candidates) {
    const identity = `${row.legacyKind}:${row.legacyId ?? row.recordDigest}`;
    const prior = byIdentity.get(identity);
    if (!prior) {
      byIdentity.set(identity, row);
      continue;
    }
    if (prior.recordDigest === row.recordDigest) {
      row.disposition = 'duplicate';
      row.duplicateOf = prior.sourceId;
    } else {
      prior.disposition = 'conflict';
      row.disposition = 'conflict';
      conflicts.push(`${identity}:conflicting-source-records`);
    }
  }

  const replay = await store.replay();
  const imported = replay.events.filter((event) => event.type === IMPORT_EVENT_TYPE);
  const importedByIdentity = new Map<string, OperatingEvent>();
  const importedByEventId = new Map(imported.map((event) => [event.eventId, event]));
  for (const event of imported) {
    const payload = migrationEventPayload(event);
    const identity = `${payload.legacyKind}:${payload.legacyId ?? payload.sourceDigest}`;
    importedByIdentity.set(identity, event);
  }
  for (const row of candidates) {
    if (row.disposition !== 'import') continue;
    const exact = importedByEventId.get(row.eventId);
    if (exact && migrationEventPayload(exact).migrationId === migrationId) {
      const exactPayload = migrationEventPayload(exact);
      if (exactPayload.sourceDigest === row.sourceDigest) {
        row.disposition = 'already-imported';
      } else {
        row.disposition = 'conflict';
        conflicts.push(
          `${row.legacyKind}:${row.legacyId ?? row.recordDigest}:event-payload-mismatch:${exact.eventId}`,
        );
      }
      continue;
    }
    const identity = `${row.legacyKind}:${row.legacyId ?? row.recordDigest}`;
    const prior = importedByIdentity.get(identity);
    if (!prior) continue;
    const payload = migrationEventPayload(prior);
    if (payload.sourceDigest === row.sourceDigest) {
      row.disposition = 'duplicate';
      row.duplicateOf = prior.eventId;
    } else {
      row.disposition = 'conflict';
      conflicts.push(`${identity}:conflicts-with-imported-event:${prior.eventId}`);
    }
  }
  return [...new Set(conflicts)].sort();
}

function backupManifest(
  migrationId: string,
  sourceDigest: `sha256:${string}`,
  files: LegacySourceFile[],
): LegacyBackupManifest {
  return {
    implementation: 'openplanr-operate-legacy-backup',
    version: '1.0.0',
    migrationId,
    sourceRoot: LEGACY_ROOT,
    sourceDigest,
    files: files.map((file, index) => ({
      path: file.path,
      digest: file.digest,
      size: file.bytes.byteLength,
      backupFile: `files/${String(index).padStart(4, '0')}`,
    })),
  };
}

async function inspectPrepared(input: {
  projectRoot: string;
  localRoot?: string;
  now?: string;
}): Promise<PreparedInspection> {
  const files = await readLegacyFiles(input.projectRoot);
  if (files.length === 0) return emptyInspection();
  const sourceDigest = canonicalDigest(
    files.map((file) => ({
      path: file.path,
      digest: file.digest,
      size: file.bytes.byteLength,
    })),
  );
  const migrationId = `MIG-${sourceDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`;
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const candidates: LegacyCandidate[] = [];
  const conflicts: string[] = [];
  for (const file of files) {
    try {
      const parsed = file.path.endsWith('.json')
        ? parseJsonCandidates(file)
        : parseMarkdownCandidates(file);
      candidates.push(...parsed.candidates);
      conflicts.push(...parsed.conflicts);
    } catch (error) {
      if (error instanceof OperateError && error.code === 'E_OPERATE_MIGRATION_CONFLICT') {
        conflicts.push(`${file.path}:corrupt-input`);
      } else {
        throw error;
      }
    }
  }
  for (const row of candidates) {
    row.eventId = `legacy-import-${canonicalDigest({
      migrationId,
      identity: `${row.legacyKind}:${row.legacyId ?? row.recordDigest}`,
    }).slice('sha256:'.length)}`;
    if (!SUPPORTED_EVENT_SOURCE_PATH.test(row.sourcePath)) {
      row.disposition = 'conflict';
      conflicts.push(`${row.sourcePath}:unsupported-source-path`);
    }
  }
  conflicts.push(...(await applyDuplicateAndConflictRules(candidates, store, migrationId)));
  const manifest = backupManifest(migrationId, sourceDigest, files);
  const backupManifestDigest = canonicalDigest(manifest);
  const mappings = candidates
    .filter((row) => row.disposition === 'import' || row.disposition === 'already-imported')
    .map((row) => ({
      sourceId: row.sourceId,
      targetId: row.targetId,
      eventId: row.eventId,
    }))
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const stableConflicts = [...new Set(conflicts)].sort();
  const now = input.now ?? new Date().toISOString();
  const previewDigest = canonicalDigest({
    migrationId,
    sourceDigest,
    backupManifestDigest,
    mappings,
    conflicts: stableConflicts,
  });
  const record: OperatingMigrationRecord = {
    kind: 'operating-migration-record',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    id: migrationId,
    sourceKind: 'prototype-board',
    sourceDigest,
    state: stableConflicts.length > 0 ? 'conflict' : 'previewed',
    previewDigest,
    backupManifestDigest,
    mappings,
    conflicts: stableConflicts,
    createdAt: now,
    updatedAt: now,
  };
  await assertOperatingArtifact('operating-migration-record', record);
  const publicRows = candidates.map(({ legacyRecord: _legacyRecord, ...row }) => row);
  return {
    record,
    sourcePath: LEGACY_ROOT,
    sourceDigest,
    backupManifest: manifest,
    files: files.map((file) => ({
      path: file.path,
      digest: file.digest,
      size: file.bytes.byteLength,
      rows: candidates.filter((candidate) => candidate.sourcePath === file.path).length,
    })),
    rows: publicRows,
    candidates,
    counts: {
      files: files.length,
      bytes: files.reduce((total, file) => total + file.bytes.byteLength, 0),
      importable: candidates.filter((row) => row.disposition === 'import').length,
      alreadyImported: candidates.filter((row) => row.disposition === 'already-imported').length,
      duplicates: candidates.filter((row) => row.disposition === 'duplicate').length,
      conflicts: stableConflicts.length,
    },
  };
}

function publicInspection(prepared: PreparedInspection): OperatingMigrationInspection {
  return {
    record: prepared.record,
    sourcePath: prepared.sourcePath,
    files: prepared.files,
    rows: prepared.rows,
    counts: prepared.counts,
  };
}

async function writePrivateBytes(target: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    const handle = await open(target, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readFile(target);
    if (sha256Digest(existing) !== sha256Digest(bytes)) {
      throw new OperateError(
        'E_OPERATE_MIGRATION_CONFLICT',
        `Migration backup changed unexpectedly: ${path.basename(target)}`,
      );
    }
  }
}

function backupRoot(projectRoot: string, migrationId: string, localRoot?: string): string {
  return path.join(
    resolveOperatingPaths(projectRoot, { localRoot }).localRoot,
    'migration-backups',
    migrationId,
  );
}

async function ensureBackup(input: {
  projectRoot: string;
  localRoot?: string;
  prepared: PreparedInspection;
}): Promise<void> {
  const { record, backupManifest } = input.prepared;
  if (!record || !backupManifest) return;
  const currentFiles = await readLegacyFiles(input.projectRoot);
  const byPath = new Map(currentFiles.map((file) => [file.path, file]));
  if (
    canonicalDigest(
      currentFiles.map((file) => ({
        path: file.path,
        digest: file.digest,
        size: file.bytes.byteLength,
      })),
    ) !== record.sourceDigest
  ) {
    throw new OperateError(
      'E_OPERATE_MIGRATION_CONFLICT',
      'Legacy board changed after migration preview.',
    );
  }
  const root = backupRoot(input.projectRoot, record.id, input.localRoot);
  for (const file of backupManifest.files) {
    const source = byPath.get(file.path);
    if (!source || source.digest !== file.digest || source.bytes.byteLength !== file.size) {
      throw new OperateError(
        'E_OPERATE_MIGRATION_CONFLICT',
        `Legacy board changed after preview: ${file.path}`,
      );
    }
    await writePrivateBytes(path.join(root, file.backupFile), source.bytes);
  }
  const manifestBytes = Buffer.from(`${canonicalize(backupManifest)}\n`);
  await writePrivateBytes(path.join(root, 'manifest.json'), manifestBytes);
  if (canonicalDigest(backupManifest) !== record.backupManifestDigest) {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      'Migration backup manifest digest does not match the preview.',
    );
  }
}

async function verifyBackup(input: {
  projectRoot: string;
  localRoot?: string;
  record: OperatingMigrationRecord;
}): Promise<LegacyBackupManifest> {
  const root = backupRoot(input.projectRoot, input.record.id, input.localRoot);
  const manifest = JSON.parse(
    await readFile(path.join(root, 'manifest.json'), 'utf8'),
  ) as LegacyBackupManifest;
  if (
    manifest.migrationId !== input.record.id ||
    manifest.sourceDigest !== input.record.sourceDigest ||
    canonicalDigest(manifest) !== input.record.backupManifestDigest
  ) {
    throw new OperateError(
      'E_OPERATE_MIGRATION_CONFLICT',
      `Migration ${input.record.id} backup manifest failed integrity verification.`,
    );
  }
  for (const file of manifest.files) {
    const bytes = await readFile(path.join(root, file.backupFile));
    if (bytes.byteLength !== file.size || sha256Digest(bytes) !== file.digest) {
      throw new OperateError(
        'E_OPERATE_MIGRATION_CONFLICT',
        `Migration ${input.record.id} backup is corrupt: ${file.path}`,
      );
    }
  }
  return manifest;
}

async function readMigrationRecord(
  projectRoot: string,
  migrationId: string,
  localRoot?: string,
): Promise<OperatingMigrationRecord | null> {
  const target = path.join(
    resolveOperatingPaths(projectRoot, { localRoot }).migrations,
    `${migrationId}.json`,
  );
  try {
    const record = JSON.parse(await readFile(target, 'utf8')) as OperatingMigrationRecord;
    return assertOperatingArtifact('operating-migration-record', record);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeMigrationMetadata(input: {
  projectRoot: string;
  localRoot?: string;
  record: OperatingMigrationRecord;
  eventHead: OperatingEventHead;
}): Promise<void> {
  const relativePath = `.planr/operate/migrations/${input.record.id}.json`;
  const target = path.join(input.projectRoot, relativePath);
  const current = await readFile(target).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  const desired = Buffer.from(`${canonicalize(input.record)}\n`);
  if (current?.equals(desired)) return;
  const journal = await prepareJournalTransaction(input.projectRoot, {
    transactionId: `TXN-${input.record.id}-${input.record.state}-metadata`,
    writes: [
      {
        relativePath,
        operation: current ? 'replace' : 'create',
        content: desired,
      },
    ],
    eventHead: input.eventHead,
    previewDigest: canonicalDigest({
      migrationId: input.record.id,
      state: input.record.state,
      sourceDigest: input.record.sourceDigest,
      eventHead: input.eventHead,
    }),
    localRoot: input.localRoot,
  });
  await applyJournalTransaction(input.projectRoot, journal, {
    currentEventHead: input.eventHead,
  });
}

async function persistMigrationHead(
  projectRoot: string,
  store: OperatingEventStore,
  localRoot?: string,
): Promise<void> {
  const state = await store.state();
  await store.writeCheckpoint(state);
  await persistOperatingProjections({
    projectRoot,
    localRoot,
    state,
    revalidateEventHead: async () => (await store.replay()).eventHead,
  });
}

export async function inspectOperatingMigration(input: {
  projectRoot: string;
  localRoot?: string;
  now?: string;
}): Promise<OperatingMigrationInspection> {
  return publicInspection(await inspectPrepared(input));
}

export async function applyOperatingMigration(
  input: {
    projectRoot: string;
    confirmed: boolean;
    localRoot?: string;
    now?: string;
  } & LegacyImportHooks,
): Promise<OperatingMigrationRecord | null> {
  const preview = await inspectPrepared(input);
  if (!preview.record) return null;
  const previewRecord = preview.record;
  if (previewRecord.state === 'conflict') {
    throw new OperateError(
      'E_OPERATE_MIGRATION_CONFLICT',
      'Legacy board contains conflicts or corrupt input; no migration was applied.',
      { preview: publicInspection(preview) },
    );
  }
  if (!input.confirmed) {
    throw new OperateError(
      'E_OPERATE_AUTHORITY_REQUIRED',
      'Migration requires explicit confirmation of its preview.',
      { preview: publicInspection(preview) },
    );
  }
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const initial = await store.replay();
  await input.beforeTransition?.('lock');
  return withOperatingLock(
    input.projectRoot,
    {
      projectKey: operatingProjectKey(input.projectRoot),
      expectedEventHead: initial.eventHead,
      currentEventHead: initial.eventHead,
      localRoot: input.localRoot,
    },
    async (lock) => {
      const lockedReplay = await store.replay();
      lock.assertEventHead(lockedReplay.eventHead);
      const existing = await readMigrationRecord(
        input.projectRoot,
        previewRecord.id,
        input.localRoot,
      );
      if (existing?.state === 'applied') {
        await verifyBackup({
          projectRoot: input.projectRoot,
          localRoot: input.localRoot,
          record: existing,
        });
        await persistMigrationHead(input.projectRoot, store, input.localRoot);
        return existing;
      }
      if (existing) {
        throw new OperateError(
          'E_OPERATE_MIGRATION_CONFLICT',
          `Migration ${existing.id} is already ${existing.state}.`,
        );
      }
      const current = await inspectPrepared(input);
      if (
        !current.record ||
        current.record.previewDigest !== previewRecord.previewDigest ||
        current.record.state === 'conflict'
      ) {
        throw new OperateError(
          'E_OPERATE_MIGRATION_CONFLICT',
          'Legacy migration input or conflicts changed after preview.',
        );
      }
      await input.beforeTransition?.('backup');
      await ensureBackup({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        prepared: current,
      });

      let replay = await store.replay();
      let head = replay.eventHead;
      const existingEventIds = new Set(replay.events.map((event) => event.eventId));
      const importRows = current.candidates.filter(
        (row) => row.disposition === 'import' || row.disposition === 'already-imported',
      );
      const immutablePlan: OperatingMigrationRecord = {
        ...current.record,
        createdAt: UNKNOWN_CREATED_AT,
        updatedAt: UNKNOWN_CREATED_AT,
      };
      await assertOperatingArtifact('operating-migration-record', immutablePlan);
      await input.beforeTransition?.('record');
      const savedPlan = await store.putRecord(
        'migration',
        immutablePlan as unknown as Record<string, unknown>,
        {
          correlationId: current.record.id,
          createdAt: UNKNOWN_CREATED_AT,
        },
      );
      for (const [index, row] of importRows.entries()) {
        if (existingEventIds.has(row.eventId)) continue;
        await input.beforeTransition?.('event', index);
        const event = await store.append({
          type: IMPORT_EVENT_TYPE,
          eventId: row.eventId,
          cycleId: 'CYCLE-000',
          entityId: current.record.id,
          actor: IMPORT_ACTOR,
          correlationId: current.record.id,
          evidenceRefs: [],
          timestamp: input.now,
          expectedHead: head.hash,
          payload: {
            migrationId: current.record.id,
            sourcePath: row.sourcePath,
            sourceDigest: row.sourceDigest,
            recordDigest: savedPlan.digest,
            backupManifestDigest: current.record.backupManifestDigest,
            legacyKind: row.legacyKind,
            ...(row.legacyId ? { legacyId: row.legacyId } : {}),
          },
        });
        const next = { sequence: event.sequence, hash: event.eventHash };
        await lock.advanceEventHead(head, next);
        head = next;
        existingEventIds.add(event.eventId);
      }

      replay = await store.replay();
      const appliedAt = input.now ?? new Date().toISOString();
      const applied: OperatingMigrationRecord = {
        ...current.record,
        state: 'applied',
        updatedAt: appliedAt,
      };
      await assertOperatingArtifact('operating-migration-record', applied);
      await input.beforeTransition?.('metadata');
      await writeMigrationMetadata({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        record: applied,
        eventHead: replay.eventHead,
      });
      await input.beforeTransition?.('checkpoint');
      await persistMigrationHead(input.projectRoot, store, input.localRoot);
      await verifyBackup({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        record: applied,
      });
      return applied;
    },
  );
}

export async function rollbackOperatingMigration(input: {
  projectRoot: string;
  migrationId: string;
  confirmed: boolean;
  localRoot?: string;
  now?: string;
}): Promise<OperatingMigrationRecord> {
  if (!input.confirmed) {
    throw new OperateError(
      'E_OPERATE_AUTHORITY_REQUIRED',
      'Migration rollback requires explicit confirmation.',
    );
  }
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const initial = await store.replay();
  return withOperatingLock(
    input.projectRoot,
    {
      projectKey: operatingProjectKey(input.projectRoot),
      expectedEventHead: initial.eventHead,
      currentEventHead: initial.eventHead,
      localRoot: input.localRoot,
    },
    async (lock) => {
      const lockedReplay = await store.replay();
      lock.assertEventHead(lockedReplay.eventHead);
      const current = await readMigrationRecord(
        input.projectRoot,
        input.migrationId,
        input.localRoot,
      );
      if (!current) {
        throw new OperateError(
          'E_OPERATE_MIGRATION_CONFLICT',
          `Unknown migration ${input.migrationId}.`,
        );
      }
      if (current.state === 'rolled-back') {
        await verifyBackup({
          projectRoot: input.projectRoot,
          localRoot: input.localRoot,
          record: current,
        });
        await persistMigrationHead(input.projectRoot, store, input.localRoot);
        return current;
      }
      if (current.state !== 'applied') {
        throw new OperateError(
          'E_OPERATE_MIGRATION_CONFLICT',
          `Migration ${input.migrationId} is not applied.`,
        );
      }
      await verifyBackup({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        record: current,
      });
      const eventId = `legacy-rollback-${current.id}`;
      const replay = lockedReplay;
      let head = replay.eventHead;
      if (!replay.events.some((event) => event.eventId === eventId)) {
        const now = input.now ?? new Date().toISOString();
        const recovery: OperatingRecoveryRecord = {
          kind: 'operating-recovery-record',
          schemaVersion: OPERATE_SCHEMA_VERSION,
          protocolVersion: OPERATE_PROTOCOL_VERSION,
          id: `RCV-${current.id.slice('MIG-'.length)}-rollback`,
          transactionId: null,
          action: 'rollback',
          reason: `Compensate legacy Operating Board import ${current.id}; source bytes remain untouched.`,
          previewDigest: canonicalDigest({
            migrationId: current.id,
            from: current.state,
            to: 'rolled-back',
            sourceDigest: current.sourceDigest,
          }),
          fromHead: head,
          toHead: head,
          outcome: 'recovered',
          confirmedBy: 'operate-cli',
          createdAt: now,
        };
        await assertOperatingArtifact('operating-recovery-record', recovery);
        const saved = await store.putRecord(
          'recovery',
          recovery as unknown as Record<string, unknown>,
          {
            correlationId: recovery.id,
            createdAt: now,
          },
        );
        const event = await store.append({
          type: 'recovery.performed',
          eventId,
          cycleId: 'CYCLE-000',
          entityId: recovery.id,
          actor: { kind: 'human', id: 'operate-cli' },
          correlationId: recovery.id,
          timestamp: now,
          expectedHead: head.hash,
          payload: { recordDigest: saved.digest },
        });
        const next = { sequence: event.sequence, hash: event.eventHash };
        await lock.advanceEventHead(head, next);
        head = next;
      }
      const rolledBack: OperatingMigrationRecord = {
        ...current,
        state: 'rolled-back',
        updatedAt: input.now ?? new Date().toISOString(),
      };
      await assertOperatingArtifact('operating-migration-record', rolledBack);
      await writeMigrationMetadata({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        record: rolledBack,
        eventHead: head,
      });
      await persistMigrationHead(input.projectRoot, store, input.localRoot);
      await verifyBackup({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        record: rolledBack,
      });
      return rolledBack;
    },
  );
}
