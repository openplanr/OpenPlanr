import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import { validateJson } from '../protocol/json-schema.mjs';
import { PipelineError } from './errors.mjs';
import { atomicWrite, withLock } from './ship-closure-persistence.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const schemaPath = join(root, 'schemas/v1.1.0/provenance-event.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const supportedSchemaVersion = '1.0.0';
const repairCommand = 'planr doctor --json';
const maxHistoryBytes = 64 * 1024 * 1024;
const lockTimeoutMs = 10_000;
const lockRetryMs = 10;
const lockWaiter = new Int32Array(new SharedArrayBuffer(4));

function fail(code, message, fix, details) {
  throw new PipelineError(code, message, fix, details);
}

function safeDeclaredVersion(value) {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/u.test(value)
    ? value
    : null;
}

function historyFailure({ line, record, reason, declaredSchemaVersion = null }) {
  fail(
    'E_PROVENANCE_HISTORY_INVALID',
    `Provenance history is invalid at line ${line}, record ${record}.`,
    `Run \`${repairCommand}\`, repair only the reported provenance record, then retry. The ledger was not changed.`,
    {
      retryable: false,
      context: { line, record, reason, declaredSchemaVersion },
      repairCommand,
    },
  );
}

function incomingFailure(reason) {
  fail(
    'E_PROVENANCE_INVALID',
    'The new provenance event does not satisfy the supported provenance contract.',
    'Fix the producer metadata before retrying the operation.',
    { retryable: false, context: { reason } },
  );
}

function storageFailure() {
  fail(
    'E_PROVENANCE_STORAGE_UNSAFE',
    'Provenance storage is not an owned regular file beneath the project planning directory.',
    `Run \`${repairCommand}\` and repair the reported storage custody before retrying.`,
    { retryable: false, repairCommand },
  );
}

function generationFailure() {
  fail(
    'E_PROVENANCE_GENERATION_CONFLICT',
    'Provenance history changed while an append was being prepared.',
    'Retry after the competing writer finishes.',
    { retryable: true },
  );
}

function ensurePlanrDirectory(planrDir) {
  if (!existsSync(planrDir)) mkdirSync(planrDir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(planrDir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) storageFailure();
}

function boundedRegularFile(path, { allowMissing = false } = {}) {
  let before;
  try {
    before = lstatSync(path);
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return Buffer.alloc(0);
    throw error;
  }
  if (before.isSymbolicLink() || !before.isFile()) storageFailure();
  if (before.size > maxHistoryBytes) {
    fail(
      'E_PROVENANCE_HISTORY_LIMIT',
      'Provenance history exceeds the bounded validation limit.',
      `Run \`${repairCommand}\` and archive the ledger through an explicit owner-reviewed repair.`,
      { retryable: false, maxBytes: maxHistoryBytes, repairCommand },
    );
  }
  const bytes = readFileSync(path);
  if (bytes.length > maxHistoryBytes) {
    fail(
      'E_PROVENANCE_HISTORY_LIMIT',
      'Provenance history exceeds the bounded validation limit.',
      `Run \`${repairCommand}\` and archive the ledger through an explicit owner-reviewed repair.`,
      { retryable: false, maxBytes: maxHistoryBytes, repairCommand },
    );
  }
  const after = lstatSync(path);
  if (
    before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
  ) generationFailure();
  return bytes;
}

function terminalPosition(bytes) {
  const lines = bytes.toString('utf8').split('\n');
  return {
    line: lines.length,
    record: lines.filter((line) => line.replace(/\r$/u, '').length > 0).length,
  };
}

function validateRecord(value, { line, record, history }) {
  const declaredSchemaVersion = safeDeclaredVersion(value?.schema_version);
  if (value?.schema_version !== supportedSchemaVersion) {
    if (history) historyFailure({
      line,
      record,
      reason: 'unsupported-version',
      declaredSchemaVersion,
    });
    incomingFailure('unsupported-version');
  }
  const errors = validateJson(value, schema);
  if (errors.length > 0) {
    if (history) historyFailure({
      line,
      record,
      reason: 'schema-invalid',
      declaredSchemaVersion,
    });
    incomingFailure('schema-invalid');
  }
  return value;
}

function parseHistory(bytes) {
  if (bytes.length === 0) return [];
  if (bytes.at(-1) !== 0x0a) {
    const position = terminalPosition(bytes);
    historyFailure({ ...position, reason: 'truncated-tail' });
  }
  const lines = bytes.toString('utf8').split('\n');
  lines.pop();
  const records = [];
  const eventIds = new Set();
  let record = 0;
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) continue;
    record += 1;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      historyFailure({ line: index + 1, record, reason: 'malformed-json' });
    }
    validateRecord(value, { line: index + 1, record, history: true });
    if (eventIds.has(value.event_id)) {
      historyFailure({
        line: index + 1,
        record,
        reason: 'duplicate-identity',
        declaredSchemaVersion: supportedSchemaVersion,
      });
    }
    eventIds.add(value.event_id);
    records.push({ line: index + 1, record, value });
  }
  return records;
}

function normalizeIncomingEvent(event) {
  let serialized;
  let normalized;
  try {
    serialized = JSON.stringify(event);
    if (typeof serialized !== 'string') incomingFailure('not-json');
    normalized = JSON.parse(serialized);
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    incomingFailure('not-json');
  }
  validateRecord(normalized, { line: 0, record: 0, history: false });
  return { event: normalized, bytes: Buffer.from(`${serialized}\n`, 'utf8') };
}

function fsyncDirectory(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function removeStage(stage, planrDir) {
  unlinkSync(stage);
  fsyncDirectory(planrDir);
}

function recoverStagedAppend({ target, stage, planrDir }) {
  if (!existsSync(stage)) return;
  const targetBytes = boundedRegularFile(target, { allowMissing: true });
  const targetRecords = parseHistory(targetBytes);
  const stageBytes = boundedRegularFile(stage);
  const stageRecords = parseHistory(stageBytes);
  if (stageBytes.equals(targetBytes)) {
    removeStage(stage, planrDir);
    return;
  }
  const extendsTarget = stageBytes.length > targetBytes.length
    && stageBytes.subarray(0, targetBytes.length).equals(targetBytes)
    && stageRecords.length === targetRecords.length + 1;
  if (!extendsTarget) {
    fail(
      'E_PROVENANCE_RECOVERY_REQUIRED',
      'Interrupted provenance staging does not match the current ledger generation.',
      `Run \`${repairCommand}\` and reconcile the staged append before retrying.`,
      { retryable: false, repairCommand },
    );
  }
  const currentBytes = boundedRegularFile(target, { allowMissing: true });
  if (!currentBytes.equals(targetBytes)) generationFailure();
  renameSync(stage, target);
  fsyncDirectory(planrDir);
}

function appendLocked({ target, stage, planrDir, normalized, hooks }) {
  recoverStagedAppend({ target, stage, planrDir });
  const baselineBytes = boundedRegularFile(target, { allowMissing: true });
  const records = parseHistory(baselineBytes);
  const identityMatch = records.find(({ value }) => value.event_id === normalized.event.event_id);
  if (identityMatch) {
    if (isDeepStrictEqual(identityMatch.value, normalized.event)) return target;
    fail(
      'E_PROVENANCE_REPLAY_DIVERGENT',
      'The provenance event identity is already bound to different content.',
      'Use a new deterministic event identity for a distinct operation.',
      { retryable: false, context: { reason: 'divergent-event-identity' } },
    );
  }
  if (baselineBytes.length + normalized.bytes.length > maxHistoryBytes) {
    fail(
      'E_PROVENANCE_HISTORY_LIMIT',
      'The provenance append would exceed the bounded validation limit.',
      `Run \`${repairCommand}\` and archive the ledger through an explicit owner-reviewed repair.`,
      { retryable: false, maxBytes: maxHistoryBytes, repairCommand },
    );
  }
  const candidateBytes = Buffer.concat([baselineBytes, normalized.bytes]);
  atomicWrite(stage, candidateBytes);
  hooks.afterStage?.();
  const currentBytes = boundedRegularFile(target, { allowMissing: true });
  if (!currentBytes.equals(baselineBytes)) generationFailure();
  renameSync(stage, target);
  fsyncDirectory(planrDir);
  hooks.afterCommit?.();
  return target;
}

function removeProvablyDeadLock(lock) {
  let before;
  let bytes;
  let metadata;
  try {
    before = lstatSync(lock);
    if (before.isSymbolicLink() || !before.isFile()) return false;
    bytes = readFileSync(lock, 'utf8');
    metadata = JSON.parse(bytes);
  } catch {
    return false;
  }
  if (
    metadata?.host !== hostname()
    || !Number.isSafeInteger(metadata.pid)
    || metadata.pid < 1
  ) return false;
  try {
    process.kill(metadata.pid, 0);
    return false;
  } catch (error) {
    if (error?.code !== 'ESRCH') return false;
  }
  try {
    const current = lstatSync(lock);
    if (
      current.dev !== before.dev
      || current.ino !== before.ino
      || readFileSync(lock, 'utf8') !== bytes
    ) return false;
    unlinkSync(lock);
    fsyncDirectory(dirname(lock));
    return true;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

function withProvenanceLock(lock, fn) {
  const deadline = Date.now() + lockTimeoutMs;
  while (true) {
    try {
      return withLock(lock, fn);
    } catch (error) {
      if (error?.code === 'E_SHIP_LOCKED' && removeProvablyDeadLock(lock)) continue;
      if (error?.code === 'E_SHIP_LOCKED' && Date.now() < deadline) {
        Atomics.wait(lockWaiter, 0, 0, lockRetryMs);
        continue;
      }
      if (error?.code === 'E_SHIP_LOCKED') {
        fail(
          'E_PROVENANCE_LOCKED',
          'Another provenance writer still owns the append lock.',
          'Retry after the active writer finishes.',
          { retryable: true },
        );
      }
      if (error?.code === 'E_SHIP_STORAGE_UNSAFE') storageFailure();
      if (error?.code === 'E_SHIP_LOCK_OWNERSHIP') {
        fail(
          'E_PROVENANCE_LOCK_OWNERSHIP',
          'Provenance lock ownership changed before release.',
          `Run \`${repairCommand}\` before retrying.`,
          { retryable: false, repairCommand },
        );
      }
      throw error;
    }
  }
}

export function createProvenanceEvent({
  projectRoot,
  artifactId,
  artifactPath,
  operation,
  product,
  version,
  runtime,
  phase,
  runId = randomUUID(),
  eventId = randomUUID(),
  timestamp = new Date().toISOString(),
  correlation = null,
  runEvidence = null,
  rollbackEvidence = null,
}) {
  const normalizedPath = artifactPath.startsWith(projectRoot)
    ? relative(projectRoot, artifactPath).split('\\').join('/')
    : artifactPath.split('\\').join('/');
  return {
    schema_version: supportedSchemaVersion,
    event_id: eventId,
    timestamp,
    artifact_id: artifactId,
    artifact_path: normalizedPath,
    operation,
    producer: { product, version, runtime, phase },
    run_id: runId,
    ...(correlation === null ? {} : { correlation: structuredClone(correlation) }),
    ...(runEvidence === null ? {} : { run_evidence: structuredClone(runEvidence) }),
    ...(rollbackEvidence === null ? {} : { rollback_evidence: structuredClone(rollbackEvidence) }),
  };
}

export function appendProvenanceEvent(projectRoot, event, { hooks = {} } = {}) {
  const normalized = normalizeIncomingEvent(event);
  const planrDir = join(projectRoot, '.planr');
  const target = join(planrDir, 'provenance.jsonl');
  const stage = join(planrDir, 'provenance.jsonl.stage');
  const lock = join(planrDir, 'provenance.lock');
  try {
    ensurePlanrDirectory(planrDir);
    return withProvenanceLock(lock, () => appendLocked({
      target,
      stage,
      planrDir,
      normalized,
      hooks,
    }));
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError(
      'E_PROVENANCE_WRITE',
      'Could not commit the provenance append.',
      `Run \`${repairCommand}\`, repair the reported storage condition, then retry the exact event.`,
      { retryable: true, repairCommand },
    );
  }
}
