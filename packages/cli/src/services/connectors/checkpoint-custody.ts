import { createHash, randomBytes } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { sha256CanonicalJson } from '../canonical-json.js';

export type ConnectorCheckpointCustodyErrorCode =
  | 'LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID'
  | 'LIVE_EVIDENCE_CHECKPOINT_CUSTODY_UNSAFE'
  | 'LIVE_EVIDENCE_CHECKPOINT_NOT_FOUND'
  | 'LIVE_EVIDENCE_CHECKPOINT_CONFLICT'
  | 'LIVE_EVIDENCE_CHECKPOINT_LOCKED';

export class ConnectorCheckpointCustodyError extends Error {
  constructor(
    readonly code: ConnectorCheckpointCustodyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

export type ConnectorCheckpointCustodySnapshotV2 = Readonly<{
  checkpoint: Readonly<Record<string, unknown>>;
  checkpointHistory: readonly Readonly<Record<string, unknown>>[];
  evidence: null | Readonly<{
    bytes: Uint8Array;
    digest: `sha256:${string}`;
    capturedAt: string;
    freshUntil: string;
  }>;
}>;

type StoredBytes = Readonly<{
  bytesBase64: string;
  digest: `sha256:${string}`;
}>;

type StoredEvidence = StoredBytes &
  Readonly<{
    capturedAt: string;
    freshUntil: string;
  }>;

type StoredCheckpointCustody = Readonly<{
  format: 'openplanr-live-evidence-checkpoint-custody';
  version: 1;
  checkpoint: Readonly<Record<string, unknown>>;
  checkpointHistory: readonly Readonly<Record<string, unknown>>[];
  evidence: StoredEvidence | null;
  providerCursor: StoredBytes | null;
  recordHash: `sha256:${string}`;
}>;

const HASH = /^sha256:[a-f0-9]{64}$/u;
const CHECKPOINT_ID = /^lchk_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u;
const REQUEST_ID = /^lreq_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u;
const CUSTODY_FILE = /^[a-f0-9]{64}\.checkpoint\.json$/u;
const MAX_CUSTODY_FILES = 2_048;
const PRIVATE_VALUE =
  /(?:^|[\s"'`(])\/(?:Users|home|private|var|etc|tmp)\/|(?:^|[\s"'`(])[A-Za-z]:[\\/][^\s]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[-_ ]?key|access[-_ ]?token|client[-_ ]?secret|password|passwd|secret|token)\s*[:=]\s*[^\s]+/iu;
const SENSITIVE_KEY =
  /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|credential|private[-_]?key)/iu;
const MAX_EVIDENCE_BYTES = 10_485_760;

function fail(code: ConnectorCheckpointCustodyErrorCode, message: string): never {
  throw new ConnectorCheckpointCustodyError(code, message);
}

function bytesHash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function exactKeys(input: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(input).sort()) === JSON.stringify([...expected].sort());
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID', 'Checkpoint custody bytes are invalid.');
  }
  return value as Readonly<Record<string, unknown>>;
}

function scanPortable(value: unknown, key = '', seen = new Set<object>()): void {
  if (SENSITIVE_KEY.test(key)) {
    fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_UNSAFE', 'Evidence bytes contain restricted content.');
  }
  if (typeof value === 'string') {
    if (PRIVATE_VALUE.test(value)) {
      fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_UNSAFE', 'Evidence bytes contain restricted content.');
    }
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) {
    fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID', 'Evidence bytes contain a cycle.');
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (const entry of value) scanPortable(entry, key, seen);
    } else {
      for (const [nestedKey, nested] of Object.entries(value)) {
        scanPortable(nested, nestedKey, seen);
      }
    }
  } finally {
    seen.delete(value);
  }
}

function assertEvidenceBytes(bytes: Uint8Array): void {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 1 ||
    bytes.byteLength > MAX_EVIDENCE_BYTES
  ) {
    fail(
      'LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID',
      'Evidence bytes are outside the exact custody bound.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail(
      'LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID',
      'Evidence custody requires valid UTF-8 JSON bytes.',
    );
  }
  scanPortable(parsed);
}

function iso(value: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID', 'Evidence freshness is invalid.');
  }
}

function custodyBody(
  checkpoint: Readonly<Record<string, unknown>>,
  checkpointHistory: readonly Readonly<Record<string, unknown>>[],
  evidence: StoredEvidence | null,
  providerCursor: StoredBytes | null,
): Omit<StoredCheckpointCustody, 'recordHash'> {
  return {
    format: 'openplanr-live-evidence-checkpoint-custody',
    version: 1,
    checkpoint,
    checkpointHistory,
    evidence,
    providerCursor,
  };
}

function storedBytes(bytes: Uint8Array): StoredBytes {
  return Object.freeze({
    bytesBase64: Buffer.from(bytes).toString('base64'),
    digest: bytesHash(bytes),
  });
}

function sameBytes(left: StoredBytes | null, right?: Uint8Array): boolean {
  return (
    right === undefined ||
    (left !== null &&
      left.digest === bytesHash(right) &&
      Buffer.from(left.bytesBase64, 'base64').equals(Buffer.from(right)))
  );
}

export class ConnectorCheckpointCustodyV2 {
  readonly #root: string;
  readonly #assertCheckpoint: (value: unknown) => Readonly<Record<string, unknown>>;
  readonly #reduceCheckpoint: (
    current: unknown,
    event: unknown,
  ) => Readonly<Record<string, unknown>>;
  readonly #now: () => number;
  readonly #lockTtlMs: number;

  constructor(input: {
    root: string;
    contracts: Readonly<{
      assertOperatingConnectorCheckpointV2(value: unknown): Readonly<Record<string, unknown>>;
      reduceOperatingConnectorCheckpointV2(
        current: unknown,
        event: unknown,
      ): Readonly<Record<string, unknown>>;
    }>;
    now?: () => number;
    lockTtlMs?: number;
  }) {
    const root = path.resolve(input.root);
    if (
      !path.isAbsolute(root) ||
      /(?:^|[/\\])\.planr[/\\]operate(?:[/\\]|$)/u.test(root) ||
      !Number.isSafeInteger(input.lockTtlMs ?? 30_000) ||
      (input.lockTtlMs ?? 30_000) < 1_000 ||
      (input.lockTtlMs ?? 30_000) > 300_000
    ) {
      fail(
        'LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID',
        'Checkpoint custody root or lock policy is invalid.',
      );
    }
    this.#root = root;
    this.#assertCheckpoint = input.contracts.assertOperatingConnectorCheckpointV2;
    this.#reduceCheckpoint = input.contracts.reduceOperatingConnectorCheckpointV2;
    this.#now = input.now ?? Date.now;
    this.#lockTtlMs = input.lockTtlMs ?? 30_000;
  }

  async #ensureRoot(): Promise<void> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    const rootStat = await lstat(this.#root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      fail(
        'LIVE_EVIDENCE_CHECKPOINT_CUSTODY_UNSAFE',
        'Checkpoint custody root is not a real directory.',
      );
    }
    const resolved = await realpath(this.#root);
    if (resolved !== this.#root) {
      fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_UNSAFE', 'Checkpoint custody root is indirect.');
    }
    await chmod(this.#root, 0o700);
  }

  #paths(checkpointId: string): { data: string; lock: string } {
    if (!CHECKPOINT_ID.test(checkpointId)) {
      fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID', 'Checkpoint identity is invalid.');
    }
    const fileId = createHash('sha256').update(checkpointId, 'utf8').digest('hex');
    return {
      data: path.join(this.#root, `${fileId}.checkpoint.json`),
      lock: path.join(this.#root, `${fileId}.lock`),
    };
  }

  async #withLock<T>(
    checkpointId: string,
    work: (dataPath: string, assertLease: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    await this.#ensureRoot();
    const paths = this.#paths(checkpointId);
    const nonce = randomBytes(32).toString('hex');
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      try {
        handle = await open(paths.lock, 'wx', 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const lockStat = await stat(paths.lock).catch(() => null);
        const observed = await readFile(paths.lock, 'utf8')
          .then((bytes) => JSON.parse(bytes) as { nonce?: unknown; expiresAt?: unknown })
          .catch(() => null);
        if (
          lockStat &&
          observed &&
          typeof observed.nonce === 'string' &&
          typeof observed.expiresAt === 'number' &&
          observed.expiresAt <= this.#now()
        ) {
          const stalePath = `${paths.lock}.stale-${randomBytes(8).toString('hex')}`;
          const renamed = await rename(paths.lock, stalePath)
            .then(() => true)
            .catch(() => false);
          if (renamed) {
            const staleStat = await stat(stalePath).catch(() => null);
            if (staleStat?.dev !== lockStat.dev || staleStat?.ino !== lockStat.ino) {
              await rename(stalePath, paths.lock).catch(() => undefined);
              fail(
                'LIVE_EVIDENCE_CHECKPOINT_LOCKED',
                'Checkpoint custody changed during stale-lock recovery.',
              );
            }
            await unlink(stalePath).catch(() => undefined);
          }
          handle = await open(paths.lock, 'wx', 0o600).catch(() => undefined);
        }
        if (!handle)
          fail('LIVE_EVIDENCE_CHECKPOINT_LOCKED', 'Checkpoint custody is already in use.');
      }
      await handle.writeFile(
        JSON.stringify({ nonce, expiresAt: this.#now() + this.#lockTtlMs }),
        'utf8',
      );
      await handle.sync();
      const assertLease = async (): Promise<void> => {
        const lock = await readFile(paths.lock, 'utf8')
          .then((bytes) => JSON.parse(bytes) as { nonce?: unknown })
          .catch(() => null);
        if (lock?.nonce !== nonce) {
          fail('LIVE_EVIDENCE_CHECKPOINT_LOCKED', 'Checkpoint custody lease was superseded.');
        }
      };
      return await work(paths.data, assertLease);
    } finally {
      await handle?.close().catch(() => undefined);
      if (handle) {
        const lock = await readFile(paths.lock, 'utf8')
          .then((bytes) => JSON.parse(bytes) as { nonce?: unknown })
          .catch(() => null);
        if (lock?.nonce === nonce) await unlink(paths.lock).catch(() => undefined);
      }
    }
  }

  async #readStored(dataPath: string): Promise<StoredCheckpointCustody | null> {
    let dataStat: Awaited<ReturnType<typeof lstat>>;
    try {
      dataStat = await lstat(dataPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    if (!dataStat.isFile() || dataStat.isSymbolicLink()) {
      fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_UNSAFE', 'Checkpoint custody target is indirect.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(dataPath, 'utf8'));
    } catch {
      fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID', 'Checkpoint custody bytes are corrupt.');
    }
    const value = asRecord(parsed);
    if (
      !exactKeys(value, [
        'format',
        'version',
        'checkpoint',
        'checkpointHistory',
        'evidence',
        'providerCursor',
        'recordHash',
      ]) ||
      value.format !== 'openplanr-live-evidence-checkpoint-custody' ||
      value.version !== 1 ||
      !HASH.test(String(value.recordHash))
    ) {
      fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID', 'Checkpoint custody envelope is invalid.');
    }
    const checkpoint = this.#assertCheckpoint(value.checkpoint);
    if (!Array.isArray(value.checkpointHistory) || value.checkpointHistory.length > 16) {
      fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID', 'Checkpoint history is invalid.');
    }
    const checkpointHistory = value.checkpointHistory.map((entry) => this.#assertCheckpoint(entry));
    const chain = [...checkpointHistory, checkpoint];
    for (let index = 0; index < chain.length; index += 1) {
      if (
        chain[index].checkpointId !== checkpoint.checkpointId ||
        chain[index].requestHash !== checkpoint.requestHash ||
        (index > 0 &&
          (chain[index].generation !== Number(chain[index - 1].generation) + 1 ||
            chain[index].predecessorDigest !== chain[index - 1].checkpointHash))
      ) {
        fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID', 'Checkpoint history is not contiguous.');
      }
    }
    const evidence = this.#decodeEvidence(value.evidence);
    const providerCursor = this.#decodeStoredBytes(value.providerCursor, false);
    const body = custodyBody(
      checkpoint,
      Object.freeze(checkpointHistory),
      evidence,
      providerCursor,
    );
    if (value.recordHash !== sha256CanonicalJson(body)) {
      fail(
        'LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID',
        'Checkpoint custody digest does not match its bytes.',
      );
    }
    return Object.freeze({ ...body, recordHash: value.recordHash }) as StoredCheckpointCustody;
  }

  #decodeStoredBytes(value: unknown, evidence: boolean): StoredBytes | null {
    if (value === null) return null;
    const stored = asRecord(value);
    if (
      !exactKeys(stored, ['bytesBase64', 'digest']) ||
      typeof stored.bytesBase64 !== 'string' ||
      !HASH.test(String(stored.digest))
    ) {
      fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID', 'Checkpoint custody content is invalid.');
    }
    const bytes = Buffer.from(stored.bytesBase64, 'base64');
    if (stored.digest !== bytesHash(bytes)) {
      fail(
        'LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID',
        'Checkpoint custody content digest changed.',
      );
    }
    if (evidence) assertEvidenceBytes(bytes);
    return Object.freeze({
      bytesBase64: stored.bytesBase64,
      digest: stored.digest,
    }) as StoredBytes;
  }

  #decodeEvidence(value: unknown): StoredEvidence | null {
    if (value === null) return null;
    const stored = asRecord(value);
    if (!exactKeys(stored, ['bytesBase64', 'digest', 'capturedAt', 'freshUntil'])) {
      fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID', 'Evidence custody is invalid.');
    }
    const bytes = this.#decodeStoredBytes(
      { bytesBase64: stored.bytesBase64, digest: stored.digest },
      true,
    );
    if (!bytes || typeof stored.capturedAt !== 'string' || typeof stored.freshUntil !== 'string') {
      fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID', 'Evidence custody is incomplete.');
    }
    iso(stored.capturedAt);
    iso(stored.freshUntil);
    if (Date.parse(stored.capturedAt) >= Date.parse(stored.freshUntil)) {
      fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID', 'Evidence freshness is unordered.');
    }
    return Object.freeze({
      ...bytes,
      capturedAt: stored.capturedAt,
      freshUntil: stored.freshUntil,
    });
  }

  async #writeStored(
    dataPath: string,
    value: StoredCheckpointCustody,
    assertLease: () => Promise<void>,
  ): Promise<void> {
    const temporary = `${dataPath}.${randomBytes(8).toString('hex')}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await assertLease();
      await rename(temporary, dataPath);
      await chmod(dataPath, 0o600);
    } finally {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
    }
  }

  #snapshot(stored: StoredCheckpointCustody): ConnectorCheckpointCustodySnapshotV2 {
    const evidence = stored.evidence
      ? Object.freeze({
          bytes: new Uint8Array(Buffer.from(stored.evidence.bytesBase64, 'base64')),
          digest: stored.evidence.digest,
          capturedAt: stored.evidence.capturedAt,
          freshUntil: stored.evidence.freshUntil,
        })
      : null;
    return Object.freeze({
      checkpoint: structuredClone(stored.checkpoint),
      checkpointHistory: Object.freeze(structuredClone(stored.checkpointHistory)),
      evidence,
    });
  }

  async initialize(checkpointValue: unknown): Promise<ConnectorCheckpointCustodySnapshotV2> {
    const checkpoint = this.#assertCheckpoint(checkpointValue);
    const checkpointId = String(checkpoint.checkpointId);
    return this.#withLock(checkpointId, async (dataPath, assertLease) => {
      const current = await this.#readStored(dataPath);
      if (current) {
        if (current.checkpoint.requestHash !== checkpoint.requestHash) {
          fail(
            'LIVE_EVIDENCE_CHECKPOINT_CONFLICT',
            'Checkpoint identity belongs to another request.',
          );
        }
        if (sha256CanonicalJson(current.checkpoint) !== sha256CanonicalJson(checkpoint)) {
          fail(
            'LIVE_EVIDENCE_CHECKPOINT_CONFLICT',
            'Checkpoint identity was reused with divergent bytes.',
          );
        }
        return this.#snapshot(current);
      }
      const body = custodyBody(structuredClone(checkpoint), Object.freeze([]), null, null);
      const stored = Object.freeze({ ...body, recordHash: sha256CanonicalJson(body) });
      await this.#writeStored(dataPath, stored, assertLease);
      return this.#snapshot(stored);
    });
  }

  async read(input: {
    checkpointId: string;
    requestHash: `sha256:${string}`;
  }): Promise<ConnectorCheckpointCustodySnapshotV2> {
    if (!HASH.test(input.requestHash)) {
      fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID', 'Checkpoint request digest is invalid.');
    }
    return this.#withLock(input.checkpointId, async (dataPath) => {
      const current = await this.#readStored(dataPath);
      if (!current)
        fail('LIVE_EVIDENCE_CHECKPOINT_NOT_FOUND', 'Checkpoint custody does not exist.');
      if (current.checkpoint.requestHash !== input.requestHash) {
        fail('LIVE_EVIDENCE_CHECKPOINT_CONFLICT', 'Checkpoint request digest changed.');
      }
      return this.#snapshot(current);
    });
  }

  async readByIdentity(identity: string): Promise<ConnectorCheckpointCustodySnapshotV2> {
    if (!CHECKPOINT_ID.test(identity) && !REQUEST_ID.test(identity)) {
      fail(
        'LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID',
        'Checkpoint or request identity is invalid.',
      );
    }
    if (CHECKPOINT_ID.test(identity)) {
      return this.#withLock(identity, async (dataPath) => {
        const current = await this.#readStored(dataPath);
        if (!current)
          fail('LIVE_EVIDENCE_CHECKPOINT_NOT_FOUND', 'Checkpoint custody does not exist.');
        if (current.checkpoint.checkpointId !== identity) {
          fail('LIVE_EVIDENCE_CHECKPOINT_CONFLICT', 'Checkpoint identity changed.');
        }
        return this.#snapshot(current);
      });
    }

    await this.#ensureRoot();
    const entries = await readdir(this.#root, { withFileTypes: true });
    const custodyEntries = entries.filter(({ name }) => name.endsWith('.checkpoint.json'));
    if (custodyEntries.length > MAX_CUSTODY_FILES) {
      fail(
        'LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID',
        'Checkpoint custody inventory exceeds the bounded status-read limit.',
      );
    }
    const matches: Array<{ checkpointId: string; fileName: string }> = [];
    for (const entry of custodyEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!CUSTODY_FILE.test(entry.name) || !entry.isFile() || entry.isSymbolicLink()) {
        fail(
          'LIVE_EVIDENCE_CHECKPOINT_CUSTODY_UNSAFE',
          'Checkpoint custody inventory contains an unsafe entry.',
        );
      }
      const stored = await this.#readStored(path.join(this.#root, entry.name));
      if (!stored) {
        fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID', 'Checkpoint custody changed during read.');
      }
      if (stored.checkpoint.requestId === identity) {
        matches.push({
          checkpointId: String(stored.checkpoint.checkpointId),
          fileName: entry.name,
        });
      }
    }
    if (matches.length === 0) {
      fail('LIVE_EVIDENCE_CHECKPOINT_NOT_FOUND', 'Checkpoint custody does not exist.');
    }
    if (matches.length !== 1) {
      fail(
        'LIVE_EVIDENCE_CHECKPOINT_CONFLICT',
        'Request identity matches ambiguous checkpoint custody.',
      );
    }
    const selected = matches[0];
    return this.#withLock(selected.checkpointId, async (dataPath) => {
      if (path.basename(dataPath) !== selected.fileName) {
        fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID', 'Checkpoint custody filename changed.');
      }
      const current = await this.#readStored(dataPath);
      if (!current || current.checkpoint.requestId !== identity) {
        fail('LIVE_EVIDENCE_CHECKPOINT_CONFLICT', 'Checkpoint custody changed during status read.');
      }
      return this.#snapshot(current);
    });
  }

  async transition(input: {
    checkpointId: string;
    event: unknown;
    evidenceBytes?: Uint8Array;
    evidenceFreshness?: Readonly<{ capturedAt: string; freshUntil: string }>;
    providerCursor?: Uint8Array;
  }): Promise<ConnectorCheckpointCustodySnapshotV2> {
    return this.#withLock(input.checkpointId, async (dataPath, assertLease) => {
      const current = await this.#readStored(dataPath);
      if (!current)
        fail('LIVE_EVIDENCE_CHECKPOINT_NOT_FOUND', 'Checkpoint custody does not exist.');
      const nextCheckpoint = this.#reduceCheckpoint(current.checkpoint, input.event);
      if (nextCheckpoint.checkpointId !== input.checkpointId) {
        fail('LIVE_EVIDENCE_CHECKPOINT_CONFLICT', 'Checkpoint transition changed its identity.');
      }
      const replay = nextCheckpoint.checkpointHash === current.checkpoint.checkpointHash;
      if (replay) {
        if (
          !sameBytes(current.evidence, input.evidenceBytes) ||
          !sameBytes(current.providerCursor, input.providerCursor)
        ) {
          fail(
            'LIVE_EVIDENCE_CHECKPOINT_CONFLICT',
            'Exact checkpoint replay changed locally retained bytes.',
          );
        }
        return this.#snapshot(current);
      }
      let evidence = current.evidence;
      if (input.evidenceBytes) {
        assertEvidenceBytes(input.evidenceBytes);
        if (!input.evidenceFreshness) {
          fail(
            'LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID',
            'Evidence bytes require exact freshness custody.',
          );
        }
        iso(input.evidenceFreshness.capturedAt);
        iso(input.evidenceFreshness.freshUntil);
        if (
          Date.parse(input.evidenceFreshness.capturedAt) >=
          Date.parse(input.evidenceFreshness.freshUntil)
        ) {
          fail('LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID', 'Evidence freshness is unordered.');
        }
        evidence = Object.freeze({
          ...storedBytes(input.evidenceBytes),
          capturedAt: input.evidenceFreshness.capturedAt,
          freshUntil: input.evidenceFreshness.freshUntil,
        });
      }
      let providerCursor = current.providerCursor;
      if (input.providerCursor) providerCursor = storedBytes(input.providerCursor);
      if (
        providerCursor &&
        nextCheckpoint.watermarkDigest !== null &&
        nextCheckpoint.watermarkDigest !== providerCursor.digest
      ) {
        fail(
          'LIVE_EVIDENCE_CHECKPOINT_CONFLICT',
          'Checkpoint watermark does not match retained local cursor custody.',
        );
      }
      if (
        ['materialized', 'committed'].includes(String(nextCheckpoint.state)) &&
        evidence === null
      ) {
        fail(
          'LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID',
          'Materialized checkpoint requires retained redacted evidence.',
        );
      }
      const checkpointHistory = Object.freeze([
        ...structuredClone(current.checkpointHistory),
        structuredClone(current.checkpoint),
      ]);
      const body = custodyBody(
        structuredClone(nextCheckpoint),
        checkpointHistory,
        evidence,
        providerCursor,
      );
      const stored = Object.freeze({ ...body, recordHash: sha256CanonicalJson(body) });
      await this.#writeStored(dataPath, stored, assertLease);
      return this.#snapshot(stored);
    });
  }
}

export function createConnectorCheckpointCustodyV2(
  input: ConstructorParameters<typeof ConnectorCheckpointCustodyV2>[0],
): ConnectorCheckpointCustodyV2 {
  return new ConnectorCheckpointCustodyV2(input);
}
