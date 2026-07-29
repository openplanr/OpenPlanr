import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDigest, canonicalize } from './canonical.js';
import { assertOperatingArtifact, loadOperatingProtocol } from './protocol.js';
import { projectOperatingStalledItems } from './stalled-item-service.js';
import {
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

export interface EventStoreOptions {
  localRoot?: string;
}

export interface AppendOperatingEventInput {
  type: OperatingEventType;
  cycleId: string;
  entityId: string;
  payload?: Record<string, unknown>;
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

function recordPath(root: string, digest: string): string {
  const hex = digest.slice('sha256:'.length);
  return path.join(root, hex.slice(0, 2), `${hex.slice(2)}.json`);
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

  async replay(): Promise<ReplayResult> {
    const raw = await readFile(this.paths.events, 'utf8').catch((error) => {
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
      protocolVersion: OPERATE_PROTOCOL_VERSION,
      digest,
      recordType,
      createdAt,
      correlationId: options.correlationId,
      contentDigest,
      content: structuredClone(content),
    };
    await assertOperatingArtifact('operating-record', record);
    const target = recordPath(this.paths.records, digest);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    try {
      const handle = await open(target, 'wx', 0o600);
      try {
        await handle.writeFile(canonicalize(record), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await readFile(target, 'utf8');
      if (canonicalDigest(JSON.parse(existing)) !== canonicalDigest(record)) {
        throw new OperateError(
          'E_OPERATE_STATE_INVALID',
          `Content-addressed operating record ${digest} does not match its path.`,
        );
      }
    }
    return record;
  }

  async readRecord(digest: `sha256:${string}`): Promise<OperatingRecordEnvelope> {
    const record = JSON.parse(
      await readFile(recordPath(this.paths.records, digest), 'utf8'),
    ) as OperatingRecordEnvelope;
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
      checkpoint = JSON.parse(await readFile(this.paths.checkpoint, 'utf8')) as OperatingCheckpoint;
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
    const { readdir } = await import('node:fs/promises');
    const prefixes = await readdir(this.paths.records).catch(() => []);
    const digests: `sha256:${string}`[] = [];
    for (const prefix of prefixes) {
      const names = await readdir(path.join(this.paths.records, prefix)).catch(() => []);
      for (const name of names) {
        if (/^[a-f0-9]{62}\.json$/.test(name) && /^[a-f0-9]{2}$/.test(prefix)) {
          digests.push(`sha256:${prefix}${name.slice(0, -5)}`);
        }
      }
    }
    return digests.sort();
  }
}
