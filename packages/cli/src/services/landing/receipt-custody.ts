import { createHash, randomBytes } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { sha256CanonicalJson } from '../canonical-json.js';

export type LandingReceiptCustodyErrorCode =
  | 'E_LANDING_CUSTODY_INVALID'
  | 'E_LANDING_CUSTODY_UNSAFE'
  | 'E_LANDING_CUSTODY_NOT_FOUND'
  | 'E_LANDING_CUSTODY_CONFLICT'
  | 'E_LANDING_CUSTODY_LOCKED';

export class LandingReceiptCustodyError extends Error {
  readonly code: LandingReceiptCustodyErrorCode;

  constructor(code: LandingReceiptCustodyErrorCode, message: string) {
    super(message);
    this.name = 'LandingReceiptCustodyError';
    this.code = code;
  }
}

export type LandingReceiptCustodySnapshotV1 = Readonly<{
  feature: string;
  receiptHash: `sha256:${string}`;
  plan: Readonly<Record<string, unknown>>;
  baseRecords: readonly Readonly<Record<string, unknown>>[];
  candidateDigest: `sha256:${string}`;
  repositoryHeads: readonly Readonly<{ repositoryKey: string; head: string }>[];
  targetStateHash: `sha256:${string}`;
  events: readonly Readonly<Record<string, unknown>>[];
  journalHead: Readonly<{ sequence: number; hash: `sha256:${string}` | null }>;
  landingReceipt: Readonly<Record<string, unknown>> | null;
  pendingIntent: Readonly<Record<string, unknown>> | null;
  phaseReceiptHeadHash: `sha256:${string}` | null;
  phaseReceipts: readonly Readonly<Record<string, unknown>>[];
  confirmations: readonly Readonly<Record<string, unknown>>[];
  evidenceRecordsByOperation: Readonly<Record<string, unknown>>;
  evidenceContextsByOperation: Readonly<Record<string, unknown>>;
  startedAt: string | null;
}>;

type StoredLandingCustody = LandingReceiptCustodySnapshotV1 &
  Readonly<{
    format: 'openplanr-landing-receipt-custody';
    version: 1;
    recordHash: `sha256:${string}`;
  }>;

const HASH = /^sha256:[a-f0-9]{64}$/u;
const PLAN_ID = /^land_[a-f0-9]{32}$/u;
const PRIVATE_VALUE =
  /(?:^|[\s"'`(])\/(?:Users|home|private|var|etc|tmp)\/|(?:^|[\s"'`(])[A-Za-z]:[\\/][^\s]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[-_ ]?key|access[-_ ]?token|client[-_ ]?secret|password|passwd|secret|token)\s*[:=]\s*[^\s]+/iu;
const SENSITIVE_KEY =
  /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|credential|private[-_]?key)/iu;

function fail(code: LandingReceiptCustodyErrorCode, message: string): never {
  throw new LandingReceiptCustodyError(code, message);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('E_LANDING_CUSTODY_INVALID', 'Landing custody record is invalid.');
  }
  return value as Readonly<Record<string, unknown>>;
}

function scanPortable(value: unknown, key = '', seen = new Set<object>()): void {
  if (SENSITIVE_KEY.test(key)) {
    fail('E_LANDING_CUSTODY_UNSAFE', 'Landing custody contains restricted content.');
  }
  if (typeof value === 'string') {
    if (PRIVATE_VALUE.test(value)) {
      fail('E_LANDING_CUSTODY_UNSAFE', 'Landing custody contains restricted content.');
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) fail('E_LANDING_CUSTODY_INVALID', 'Landing custody contains a cycle.');
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

function body(
  value: Omit<StoredLandingCustody, 'recordHash'>,
): Omit<StoredLandingCustody, 'recordHash'> {
  return value;
}

function freezeSnapshot(value: StoredLandingCustody): LandingReceiptCustodySnapshotV1 {
  const { format: _format, version: _version, recordHash: _recordHash, ...snapshot } = value;
  return Object.freeze(structuredClone(snapshot));
}

function journalHead(events: readonly Readonly<Record<string, unknown>>[]): {
  sequence: number;
  hash: `sha256:${string}` | null;
} {
  const last = events.at(-1);
  return {
    sequence: last === undefined ? 0 : Number(last.sequence),
    hash: last === undefined ? null : (last.eventHash as `sha256:${string}`),
  };
}

function exactHead(
  left: unknown,
  right: Readonly<{ sequence: number; hash: `sha256:${string}` | null }>,
): boolean {
  const value = left && typeof left === 'object' ? (left as Record<string, unknown>) : null;
  return value?.sequence === right.sequence && value.hash === right.hash;
}

export class LandingReceiptCustodyV1 {
  readonly #root: string;
  readonly #now: () => number;
  readonly #lockTtlMs: number;

  constructor(input: { root: string; now?: () => number; lockTtlMs?: number }) {
    const root = path.resolve(input.root);
    const portableRoot = root.split(path.sep).join('/');
    const lockTtlMs = input.lockTtlMs ?? 30_000;
    if (
      !path.isAbsolute(root) ||
      !portableRoot.endsWith('/.planr/landing') ||
      portableRoot.includes('/.planr/operate/') ||
      !Number.isSafeInteger(lockTtlMs) ||
      lockTtlMs < 1_000 ||
      lockTtlMs > 300_000
    ) {
      fail('E_LANDING_CUSTODY_INVALID', 'Landing custody root or lock policy is invalid.');
    }
    this.#root = root;
    this.#now = input.now ?? Date.now;
    this.#lockTtlMs = lockTtlMs;
  }

  async #ensureRoot(): Promise<void> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.#root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      fail('E_LANDING_CUSTODY_UNSAFE', 'Landing custody root is unsafe.');
    }
    if ((await realpath(this.#root)) !== this.#root) {
      fail('E_LANDING_CUSTODY_UNSAFE', 'Landing custody root is indirect.');
    }
    await chmod(this.#root, 0o700);
  }

  #paths(planId: string): { data: string; lock: string } {
    if (!PLAN_ID.test(planId)) {
      fail('E_LANDING_CUSTODY_INVALID', 'Landing plan identity is invalid.');
    }
    const id = createHash('sha256').update(planId, 'utf8').digest('hex');
    return {
      data: path.join(this.#root, `${id}.landing.json`),
      lock: path.join(this.#root, `${id}.lock`),
    };
  }

  async #withLock<T>(planId: string, work: (dataPath: string) => Promise<T>): Promise<T> {
    await this.#ensureRoot();
    const paths = this.#paths(planId);
    const nonce = randomBytes(32).toString('hex');
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      try {
        handle = await open(paths.lock, 'wx', 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const observed = await readFile(paths.lock, 'utf8')
          .then((value) => JSON.parse(value) as { nonce?: unknown; expiresAt?: unknown })
          .catch(() => null);
        const metadata = await stat(paths.lock).catch(() => null);
        if (
          observed &&
          metadata &&
          typeof observed.nonce === 'string' &&
          typeof observed.expiresAt === 'number' &&
          observed.expiresAt <= this.#now()
        ) {
          const stale = `${paths.lock}.stale-${randomBytes(8).toString('hex')}`;
          await rename(paths.lock, stale).catch(() => {
            fail('E_LANDING_CUSTODY_LOCKED', 'Landing custody is locked.');
          });
          await unlink(stale).catch(() => undefined);
          handle = await open(paths.lock, 'wx', 0o600);
        } else {
          fail('E_LANDING_CUSTODY_LOCKED', 'Landing custody is locked.');
        }
      }
      await handle.writeFile(
        JSON.stringify({ nonce, expiresAt: this.#now() + this.#lockTtlMs }),
        'utf8',
      );
      await handle.sync();
      return await work(paths.data);
    } finally {
      await handle?.close().catch(() => undefined);
      const current = await readFile(paths.lock, 'utf8')
        .then((value) => JSON.parse(value) as { nonce?: unknown })
        .catch(() => null);
      if (current?.nonce === nonce) await unlink(paths.lock).catch(() => undefined);
    }
  }

  async #readPath(dataPath: string): Promise<StoredLandingCustody> {
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(dataPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        fail('E_LANDING_CUSTODY_NOT_FOUND', 'Landing custody was not found.');
      }
      throw error;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 8 * 1024 * 1024) {
      fail('E_LANDING_CUSTODY_UNSAFE', 'Landing custody file is unsafe.');
    }
    const parsed = record(JSON.parse(await readFile(dataPath, 'utf8'))) as StoredLandingCustody;
    const { recordHash, ...recordBody } = parsed;
    if (
      parsed.format !== 'openplanr-landing-receipt-custody' ||
      parsed.version !== 1 ||
      !HASH.test(recordHash) ||
      sha256CanonicalJson(recordBody) !== recordHash ||
      !PLAN_ID.test(String(parsed.plan?.planId)) ||
      !HASH.test(String(parsed.plan?.planHash))
    ) {
      fail('E_LANDING_CUSTODY_INVALID', 'Landing custody hash or identity is invalid.');
    }
    scanPortable(parsed);
    return parsed;
  }

  async #write(dataPath: string, value: Omit<StoredLandingCustody, 'recordHash'>): Promise<void> {
    scanPortable(value);
    const stored: StoredLandingCustody = {
      ...value,
      recordHash: sha256CanonicalJson(value),
    };
    const tempPath = `${dataPath}.tmp-${randomBytes(16).toString('hex')}`;
    const handle = await open(tempPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(stored)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, dataPath);
    await chmod(dataPath, 0o600);
  }

  async initialize(input: {
    feature: string;
    receiptHash: `sha256:${string}`;
    plan: Readonly<Record<string, unknown>>;
    baseRecords: readonly Readonly<Record<string, unknown>>[];
  }): Promise<LandingReceiptCustodySnapshotV1> {
    const plan = record(input.plan);
    const planId = String(plan.planId);
    if (
      !PLAN_ID.test(planId) ||
      !HASH.test(input.receiptHash) ||
      !Array.isArray(input.baseRecords)
    ) {
      fail('E_LANDING_CUSTODY_INVALID', 'Landing initialization is invalid.');
    }
    const repositories = plan.repositories as Record<string, unknown>[];
    if (!Array.isArray(repositories) || typeof plan.candidateDigest !== 'string') {
      fail('E_LANDING_CUSTODY_INVALID', 'Landing plan custody is invalid.');
    }
    return this.#withLock(planId, async (dataPath) => {
      const existing = await this.#readPath(dataPath).catch((error) => {
        if (
          error instanceof LandingReceiptCustodyError &&
          error.code === 'E_LANDING_CUSTODY_NOT_FOUND'
        ) {
          return null;
        }
        throw error;
      });
      if (existing) {
        if (
          existing.plan.planHash !== plan.planHash ||
          existing.receiptHash !== input.receiptHash
        ) {
          fail('E_LANDING_CUSTODY_CONFLICT', 'Landing custody already contains divergent bytes.');
        }
        return freezeSnapshot(existing);
      }
      const initial = body({
        format: 'openplanr-landing-receipt-custody',
        version: 1,
        feature: input.feature,
        receiptHash: input.receiptHash,
        plan: structuredClone(plan),
        baseRecords: structuredClone(input.baseRecords),
        candidateDigest: plan.candidateDigest as `sha256:${string}`,
        repositoryHeads: repositories.map(({ repositoryKey, head }) => ({
          repositoryKey: String(repositoryKey),
          head: String(head),
        })),
        targetStateHash: plan.currentTargetHash as `sha256:${string}`,
        events: [],
        journalHead: { sequence: 0, hash: null },
        landingReceipt: null,
        pendingIntent: null,
        phaseReceiptHeadHash: null,
        phaseReceipts: [],
        confirmations: [],
        evidenceRecordsByOperation: {},
        evidenceContextsByOperation: {},
        startedAt: null,
      });
      await this.#write(dataPath, initial);
      return freezeSnapshot({ ...initial, recordHash: sha256CanonicalJson(initial) });
    });
  }

  async read(planId: string): Promise<LandingReceiptCustodySnapshotV1> {
    await this.#ensureRoot();
    return freezeSnapshot(await this.#readPath(this.#paths(planId).data));
  }

  async commitIntent(
    planId: string,
    request: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>> {
    return this.#withLock(planId, async (dataPath) => {
      const current = await this.#readPath(dataPath);
      const currentHead = journalHead(current.events);
      if (
        request.kind !== 'landing-intent-cas' ||
        request.planHash !== current.plan.planHash ||
        !exactHead(request.expectedJournalHead, currentHead) ||
        !Array.isArray(request.events)
      ) {
        fail('E_LANDING_CUSTODY_CONFLICT', 'Landing intent CAS binding changed.');
      }
      if (current.pendingIntent !== null) {
        if (
          current.pendingIntent.requestHash !== request.requestHash ||
          current.pendingIntent.attemptIdentity !== request.attemptIdentity
        ) {
          fail('E_LANDING_CUSTODY_CONFLICT', 'A different landing intent is already durable.');
        }
        return Object.freeze({
          commitId: current.pendingIntent.commitId,
          dispatcherId: current.pendingIntent.dispatcherId,
          committedAt: current.pendingIntent.committedAt,
          journalHead: current.pendingIntent.journalHead,
        });
      }
      const events = [...current.events, ...structuredClone(request.events)];
      const persistedHead = journalHead(events);
      const committedAt = new Date(this.#now()).toISOString();
      const commitId = `lcom_${createHash('sha256').update(String(request.attemptIdentity)).digest('hex').slice(0, 32)}`;
      const dispatcherId = `ldsp_${randomBytes(16).toString('hex')}`;
      const pendingBody = {
        kind: 'landing-pending-intent',
        schemaVersion: '1.0.0',
        attemptIdentity: request.attemptIdentity,
        commitId,
        committedAt,
        dispatcherId,
        confirmation: structuredClone(request.confirmation),
        intentEventHash: request.intentEventHash,
        journalHead: persistedHead,
        planHash: request.planHash,
        runId: request.runId,
        operationId: request.operationId,
        requestHash: request.requestHash,
        targetBeforeHash: request.targetBeforeHash,
      };
      const firstTimestamp = (request.events[0] as Record<string, unknown> | undefined)?.timestamp;
      const { recordHash: _recordHash, ...currentBody } = current;
      const next = body({
        ...currentBody,
        events,
        journalHead: persistedHead,
        pendingIntent: {
          ...pendingBody,
          pendingIntentHash: sha256CanonicalJson(pendingBody),
        },
        startedAt:
          current.startedAt ?? (typeof firstTimestamp === 'string' ? firstTimestamp : committedAt),
      });
      await this.#write(dataPath, next);
      return Object.freeze({ commitId, dispatcherId, committedAt, journalHead: persistedHead });
    });
  }

  async commitOutcome(
    planId: string,
    request: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>> {
    return this.#withLock(planId, async (dataPath) => {
      const current = await this.#readPath(dataPath);
      if (
        request.kind !== 'landing-outcome-cas' ||
        current.pendingIntent === null ||
        request.commitId !== current.pendingIntent.commitId ||
        request.dispatcherId !== current.pendingIntent.dispatcherId ||
        !exactHead(request.expectedJournalHead, journalHead(current.events)) ||
        !Array.isArray(request.events)
      ) {
        fail('E_LANDING_CUSTODY_CONFLICT', 'Landing outcome CAS binding changed.');
      }
      const phaseReceipt = record(request.phaseReceipt);
      const confirmation = record(request.confirmation);
      const events = [...current.events, ...structuredClone(request.events)];
      const persistedHead = journalHead(events);
      const targetStateHash = (phaseReceipt.targetAfterHash ??
        phaseReceipt.targetBeforeHash) as `sha256:${string}`;
      const evidenceRecordsByOperation = {
        ...current.evidenceRecordsByOperation,
        [String(phaseReceipt.operationId)]: structuredClone(request.evidenceRecords),
      };
      const evidenceContextsByOperation = {
        ...current.evidenceContextsByOperation,
        [String(phaseReceipt.operationId)]: structuredClone(request.evidenceContexts),
      };
      const { recordHash: _recordHash, ...currentBody } = current;
      const next = body({
        ...currentBody,
        events,
        journalHead: persistedHead,
        targetStateHash,
        landingReceipt:
          request.landingReceipt === null ? null : structuredClone(record(request.landingReceipt)),
        pendingIntent: null,
        phaseReceiptHeadHash: phaseReceipt.receiptHash as `sha256:${string}`,
        phaseReceipts: [...current.phaseReceipts, structuredClone(phaseReceipt)],
        confirmations: [...current.confirmations, structuredClone(confirmation)],
        evidenceRecordsByOperation,
        evidenceContextsByOperation,
      });
      await this.#write(dataPath, next);
      return Object.freeze({
        commitId: request.commitId,
        committedAt: new Date(this.#now()).toISOString(),
        journalHead: persistedHead,
        phaseReceiptHash: phaseReceipt.receiptHash,
        landingReceiptHash:
          request.landingReceipt === null
            ? null
            : (request.landingReceipt as Record<string, unknown>).receiptHash,
      });
    });
  }
}
