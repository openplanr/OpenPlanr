import { randomUUID } from 'node:crypto';
import { access, appendFile, mkdir, open, readdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDigest, canonicalize } from './canonical.js';
import { assertOperatingArtifact, loadOperatingProtocol } from './protocol.js';
import { projectOperatingStalledItems } from './stalled-item-service.js';
import {
  OPERATE_MISSION_PROTOCOL_VERSION,
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  OperateError,
  type OperatingCheckpoint,
  type OperatingEvent,
  type OperatingEventType,
  type OperatingRecordEnvelope,
  type OperatingSensitivity,
  type OperatingState,
} from './types.js';
import { ensureOperatingDirectories, resolveOperatingPaths } from './workspace.js';

/**
 * Protocol v1.3 (FR5/E-005) serializes each immutable content-addressed record
 * as a single canonical line in the append-only `.state/records.jsonl`, declared
 * as `operating-records-log-entry@1.3.0`. It carries the same field set as the
 * v1.2 `operating-record`, retaining the content-address `digest` as a field,
 * so the container change is lossless and reversible.
 */
export interface OperatingRecordsLogEntry {
  kind: 'operating-records-log-entry';
  schemaVersion: typeof OPERATE_SCHEMA_VERSION;
  protocolVersion: '1.3.0';
  digest: `sha256:${string}`;
  recordType: OperatingRecordEnvelope['recordType'];
  createdAt: string;
  correlationId: string;
  contentDigest: `sha256:${string}`;
  content: Record<string, unknown>;
}

/**
 * The protocol version an `operating-record` envelope carries. It is a pure
 * function of the record content: a route record whose embedded route plan is a
 * v1.3 (`create-quick-task`) plan is stamped v1.3 so it validates against the
 * additive v1.3 operating-record schema (the only record schema whose route
 * content accepts a v1.3 route plan). Every other record — including a v1.2
 * route record — stays frozen at v1.2, so every existing write and the
 * `records.jsonl` read-back are byte-identical. Because it is derived, the write
 * path (`putRecord`) and the read-back (`logEntryToOperatingRecord`) agree.
 */
function recordEnvelopeProtocolVersion(
  recordType: OperatingRecordEnvelope['recordType'],
  content: Record<string, unknown>,
): OperatingRecordEnvelope['protocolVersion'] {
  return recordType === 'route' && content.protocolVersion === OPERATE_MISSION_PROTOCOL_VERSION
    ? OPERATE_MISSION_PROTOCOL_VERSION
    : OPERATE_PROTOCOL_VERSION;
}

/** Map a v1.2 `operating-record` envelope to its v1.3 records-log entry. */
export function operatingRecordToLogEntry(
  record: OperatingRecordEnvelope,
): OperatingRecordsLogEntry {
  return {
    kind: 'operating-records-log-entry',
    schemaVersion: record.schemaVersion,
    protocolVersion: '1.3.0',
    digest: record.digest,
    recordType: record.recordType,
    createdAt: record.createdAt,
    correlationId: record.correlationId,
    contentDigest: record.contentDigest,
    content: record.content,
  };
}

/** Exact inverse of {@link operatingRecordToLogEntry}. */
export function logEntryToOperatingRecord(
  entry: OperatingRecordsLogEntry,
): OperatingRecordEnvelope {
  return {
    kind: 'operating-record',
    schemaVersion: entry.schemaVersion,
    protocolVersion: recordEnvelopeProtocolVersion(entry.recordType, entry.content),
    digest: entry.digest,
    recordType: entry.recordType,
    createdAt: entry.createdAt,
    correlationId: entry.correlationId,
    contentDigest: entry.contentDigest,
    content: entry.content,
  };
}

/** One canonical `.state/records.jsonl` line (no trailing newline) for a record. */
export function operatingRecordsLogLine(record: OperatingRecordEnvelope): string {
  return canonicalize(operatingRecordToLogEntry(record));
}

async function fileExists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}

export interface EventStoreOptions {
  localRoot?: string;
}

export interface AppendOperatingEventInput {
  type: OperatingEventType;
  cycleId: string;
  entityId: string;
  payload?: Record<string, unknown>;
  /**
   * Additive Protocol v1.3 passthrough. Defaults to the frozen v1.2 event
   * contract; a caller embedding v1.3-only content (a `route.proposed` payload
   * carrying a `create-quick-task` route plan) stamps `1.3.0`, whose event
   * schema accepts either route-plan version. Every existing caller omits it and
   * is byte-identical.
   */
  protocolVersion?: string;
  actor?: OperatingEvent['actor'];
  timestamp?: string;
  eventId?: string;
  correlationId?: string;
  causationId?: string | null;
  evidenceRefs?: string[];
  expectedHead?: OperatingEvent['previousEventHash'];
}

export interface ReplayResult {
  events: OperatingEvent[];
  eventHead: { sequence: number; hash: `sha256:${string}` | null };
}

async function durableAppend(target: string, line: string): Promise<void> {
  const handle = await open(target, 'a', 0o600);
  try {
    await handle.writeFile(line, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicCanonicalWrite(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${canonicalize(value)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
}

// SPEC-002 (v1.2) directory-per-digest-prefix record file, kept only so readers
// can still resolve records on a project that has not yet migrated to the v1.3
// `.state/records.jsonl` append log. Live writes always target v1.3.
function legacyRecordPath(recordsDir: string, digest: string): string {
  const hex = digest.slice('sha256:'.length);
  return path.join(recordsDir, hex.slice(0, 2), `${hex.slice(2)}.json`);
}

function legacyRecordsDir(operateRoot: string): string {
  return path.join(operateRoot, 'records', 'sha256');
}

function legacyEventsPath(operateRoot: string): string {
  return path.join(operateRoot, 'events.jsonl');
}

function legacyCheckpointPath(operateRoot: string): string {
  return path.join(operateRoot, 'checkpoints', 'current.json');
}

async function readRecordsLog(recordsFile: string): Promise<OperatingRecordEnvelope[]> {
  const raw = await readFile(recordsFile, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  });
  const records: OperatingRecordEnvelope[] = [];
  for (const [index, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue;
    let entry: OperatingRecordsLogEntry;
    try {
      entry = JSON.parse(line) as OperatingRecordsLogEntry;
    } catch {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Operating records.jsonl line ${index + 1} is not valid JSON.`,
      );
    }
    records.push(logEntryToOperatingRecord(entry));
  }
  return records;
}

export class OperatingEventStore {
  readonly paths;

  constructor(
    readonly projectRoot: string,
    readonly options: EventStoreOptions = {},
  ) {
    this.paths = resolveOperatingPaths(projectRoot, options);
  }

  async initialize(): Promise<void> {
    await ensureOperatingDirectories(this.projectRoot, {
      localRoot: this.options.localRoot,
    });
    await appendFile(this.paths.events, '', { encoding: 'utf8', mode: 0o600 });
  }

  // Readers resolve the effective on-disk location so a project that has not yet
  // migrated to the v1.3 `.state/` layout stays readable. Writers always target
  // v1.3, because every mutating action migrates the layout before it proceeds.
  private async effectiveEventsPath(): Promise<string> {
    if (await fileExists(this.paths.events)) return this.paths.events;
    const legacy = legacyEventsPath(this.paths.root);
    return (await fileExists(legacy)) ? legacy : this.paths.events;
  }

  private async effectiveCheckpointPath(): Promise<string> {
    if (await fileExists(this.paths.checkpoint)) return this.paths.checkpoint;
    const legacy = legacyCheckpointPath(this.paths.root);
    return (await fileExists(legacy)) ? legacy : this.paths.checkpoint;
  }

  async replay(): Promise<ReplayResult> {
    const raw = await readFile(await this.effectiveEventsPath(), 'utf8').catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    });
    const events: OperatingEvent[] = [];
    for (const [index, line] of raw.split('\n').entries()) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as OperatingEvent);
      } catch {
        throw new OperateError(
          'E_OPERATE_STATE_INVALID',
          `Operating event line ${index + 1} is not valid JSON.`,
        );
      }
    }
    const protocol = await loadOperatingProtocol();
    try {
      const head = protocol.verifyOperatingEventChain(events);
      return {
        events,
        eventHead: {
          sequence: head.sequence,
          hash: head.hash,
        },
      };
    } catch (error) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        error instanceof Error ? error.message : 'Operating event chain is invalid.',
      );
    }
  }

  async putRecord(
    recordType: OperatingRecordEnvelope['recordType'],
    content: Record<string, unknown>,
    options: {
      createdAt?: string;
      correlationId: string;
      sensitivity?: OperatingSensitivity;
    },
  ): Promise<OperatingRecordEnvelope> {
    await this.initialize();
    const createdAt = options.createdAt ?? new Date().toISOString();
    const contentDigest = canonicalDigest(content);
    const digest = canonicalDigest({
      recordType,
      createdAt,
      correlationId: options.correlationId,
      contentDigest,
    });
    const record: OperatingRecordEnvelope = {
      kind: 'operating-record',
      schemaVersion: OPERATE_SCHEMA_VERSION,
      protocolVersion: recordEnvelopeProtocolVersion(recordType, content),
      digest,
      recordType,
      createdAt,
      correlationId: options.correlationId,
      contentDigest,
      content: structuredClone(content),
    };
    await assertOperatingArtifact('operating-record', record);
    // Persist as a single canonical `operating-records-log-entry@1.3.0` line in
    // the append-only `.state/records.jsonl`. The append is content-addressed:
    // an identical prior entry is a no-op; a colliding digest with different
    // bytes is rejected exactly as the per-file layout rejected it.
    const logEntry = operatingRecordToLogEntry(record);
    await assertOperatingArtifact('operating-records-log-entry', logEntry);
    const line = canonicalize(logEntry);
    for (const existing of await readRecordsLog(this.paths.records)) {
      if (existing.digest !== digest) continue;
      if (canonicalDigest(existing) !== canonicalDigest(record)) {
        throw new OperateError(
          'E_OPERATE_STATE_INVALID',
          `Content-addressed operating record ${digest} does not match its stored line.`,
        );
      }
      return record;
    }
    await durableAppend(this.paths.records, `${line}\n`);
    return record;
  }

  async readRecord(digest: `sha256:${string}`): Promise<OperatingRecordEnvelope> {
    let record = (await readRecordsLog(this.paths.records)).find(
      (entry) => entry.digest === digest,
    );
    if (!record) {
      // A project that has not yet migrated still stores this record as a
      // per-digest-prefix file under the SPEC-002 layout.
      const legacy = legacyRecordPath(legacyRecordsDir(this.paths.root), digest);
      if (await fileExists(legacy)) {
        record = JSON.parse(await readFile(legacy, 'utf8')) as OperatingRecordEnvelope;
      }
    }
    if (!record) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Content-addressed operating record ${digest} is not present in records.jsonl.`,
      );
    }
    await assertOperatingArtifact('operating-record', record);
    if (
      record.digest !== digest ||
      record.contentDigest !== canonicalDigest(record.content) ||
      record.digest !==
        canonicalDigest({
          recordType: record.recordType,
          createdAt: record.createdAt,
          correlationId: record.correlationId,
          contentDigest: record.contentDigest,
        })
    ) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Content-addressed operating record ${digest} failed integrity verification.`,
      );
    }
    return record;
  }

  async append(input: AppendOperatingEventInput): Promise<OperatingEvent> {
    await this.initialize();
    const replay = await this.replay();
    if (input.expectedHead !== undefined && input.expectedHead !== replay.eventHead.hash) {
      throw new OperateError('E_OPERATE_HEAD_DIVERGED', 'Operating event head changed.', {
        expected: input.expectedHead,
        actual: replay.eventHead.hash,
      });
    }
    const protocol = await loadOperatingProtocol();
    const correlationId = input.correlationId ?? randomUUID();
    let event: OperatingEvent;
    try {
      event = protocol.createOperatingEvent(
        {
          eventId: input.eventId ?? randomUUID(),
          timestamp: input.timestamp ?? new Date().toISOString(),
          cycleId: input.cycleId,
          type: input.type,
          entityId: input.entityId,
          actor: input.actor ?? { kind: 'engine', id: 'openplanr' },
          causationId: input.causationId ?? null,
          correlationId,
          evidenceRefs: [...new Set(input.evidenceRefs ?? [])].sort(),
          payload: structuredClone(input.payload ?? {}),
          // Omitted for every v1.2 caller so the pipeline's `createOperatingEvent`
          // default keeps the frozen v1.2 stamp and byte-identical event hash.
          ...(input.protocolVersion ? { protocolVersion: input.protocolVersion } : {}),
        },
        {
          previousEvent: replay.events.at(-1) ?? null,
          sequence: replay.eventHead.sequence + 1,
        },
      );
    } catch (error) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        error instanceof Error ? error.message : 'Operating event failed Protocol validation.',
      );
    }
    await durableAppend(this.paths.events, `${canonicalize(event)}\n`);
    return event;
  }

  async state(checkpoint: OperatingCheckpoint | null = null): Promise<OperatingState> {
    const replay = await this.replay();
    const protocol = await loadOperatingProtocol();
    // A checkpoint already carries the state of every event up to its head, so
    // the reducer resumes from the tail only. Passing the full log would
    // re-apply checkpointed events and fail the sequence check.
    const events = checkpoint ? replay.events.slice(checkpoint.eventHead.sequence) : replay.events;
    return projectOperatingStalledItems(
      protocol.reduceOperatingEvents(events, { checkpoint }),
      replay.events,
    );
  }

  async writeCheckpoint(
    state?: OperatingState,
    options: {
      signer?: (payload: string) => {
        algorithm: 'ed25519' | 'hmac-sha256';
        keyId: string;
        value: string;
      };
    } = {},
  ): Promise<OperatingCheckpoint> {
    await this.initialize();
    const protocol = await loadOperatingProtocol();
    const projected = state ?? (await this.state());
    const recordDigests = await this.listRecordDigests();
    const checkpoint = protocol.createOperatingCheckpoint(projected, {
      recordDigests,
      createdAt: projected.generatedAt,
      signer: options.signer,
    });
    await atomicCanonicalWrite(this.paths.checkpoint, checkpoint);
    return checkpoint;
  }

  async readCheckpoint(
    options: {
      verifySignature?: (
        payload: string,
        signature: {
          algorithm: 'ed25519' | 'hmac-sha256';
          keyId: string;
          value: string;
        },
      ) => boolean;
      requireSignatureVerification?: boolean;
    } = {},
  ): Promise<OperatingCheckpoint | null> {
    let checkpoint: OperatingCheckpoint;
    try {
      checkpoint = JSON.parse(
        await readFile(await this.effectiveCheckpointPath(), 'utf8'),
      ) as OperatingCheckpoint;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      return (await loadOperatingProtocol()).validateOperatingCheckpoint(checkpoint, options);
    } catch (error) {
      throw new OperateError(
        'E_OPERATE_CHECKPOINT_INVALID',
        error instanceof Error ? error.message : 'Operating checkpoint is invalid.',
      );
    }
  }

  private async listRecordDigests(): Promise<`sha256:${string}`[]> {
    const fromLog = (await readRecordsLog(this.paths.records)).map((record) => record.digest);
    if (fromLog.length > 0 || (await fileExists(this.paths.records))) {
      return [...new Set(fromLog)].sort();
    }
    // SPEC-002 fallback: enumerate the per-digest-prefix directory tree.
    const recordsDir = legacyRecordsDir(this.paths.root);
    const prefixes = await readdir(recordsDir).catch(() => []);
    const digests: `sha256:${string}`[] = [];
    for (const prefix of prefixes) {
      const names = await readdir(path.join(recordsDir, prefix)).catch(() => []);
      for (const name of names) {
        if (/^[a-f0-9]{62}\.json$/.test(name) && /^[a-f0-9]{2}$/.test(prefix)) {
          digests.push(`sha256:${prefix}${name.slice(0, -5)}`);
        }
      }
    }
    return digests.sort();
  }
}
