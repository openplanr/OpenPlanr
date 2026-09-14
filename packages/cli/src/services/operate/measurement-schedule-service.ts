import { createHash, randomBytes } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { sha256CanonicalJson } from '../canonical-json.js';
import type { JsonRecord, OperateComposition } from './composition.js';
import { assertOperatePathCustody, assertOperateTreeCustody } from './path-custody.js';
import { withOperateMutationLane } from './replay-safe-retry-service.js';

export type MeasurementSchedule = Readonly<Record<string, unknown>> & {
  scheduleId: string;
  measurementPlanId: string;
  ownerActorId: string;
  state: string;
  generation: number;
  scheduleHash: string;
  runCount: number;
  nextEventIdentity: string | null;
  nextDueAt: string | null;
};

export type MeasurementScheduleReceipt = Readonly<Record<string, unknown>> & {
  receiptId: string;
  receiptHash: string;
};

export type StoredSchedule = Readonly<{
  schedule: MeasurementSchedule;
  receipt: MeasurementScheduleReceipt | null;
}>;

export type ApplyResult = Readonly<{
  schedule: MeasurementSchedule;
  receipt: MeasurementScheduleReceipt;
  replay: boolean;
}>;

export type MeasurementScheduleContracts = Readonly<{
  validateSchedule(value: unknown): JsonRecord;
  validateReceipt(value: unknown, previous: JsonRecord, resulting: JsonRecord): JsonRecord;
  reduceSchedule(
    schedule: unknown,
    transition: unknown,
    priorReceipt?: unknown,
  ): { replay: boolean; schedule: JsonRecord; receipt: JsonRecord };
}>;

type StoreMutation<T> = Readonly<{
  stored: StoredSchedule;
  result: T;
  initial?: MeasurementSchedule;
}>;

export interface MeasurementScheduleStore {
  read(scheduleId: string): Promise<StoredSchedule | null>;
  list(): Promise<readonly string[]>;
  mutate<T>(
    scheduleId: string,
    mutation: (current: StoredSchedule | null) => StoreMutation<T> | Promise<StoreMutation<T>>,
  ): Promise<T>;
}

export type MeasurementScheduleErrorCode =
  | 'E_MEASUREMENT_SCHEDULE_UNKNOWN'
  | 'E_MEASUREMENT_SCHEDULE_EXISTS'
  | 'E_MEASUREMENT_SCHEDULE_INVALID'
  | 'E_MEASUREMENT_SCHEDULE_CONFLICT'
  | 'E_MEASUREMENT_SCHEDULE_CUSTODY_INVALID'
  | 'E_MEASUREMENT_SCHEDULE_CUSTODY_UNSAFE'
  | 'E_MEASUREMENT_SCHEDULE_LOCKED'
  | 'E_MEASUREMENT_OWNER_REQUIRED'
  | 'E_MEASUREMENT_CONFIRMATION_REQUIRED'
  | 'E_MEASUREMENT_SCHEDULE_CLOCK_INVALID';

export class MeasurementScheduleError extends Error {
  constructor(
    readonly code: MeasurementScheduleErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'MeasurementScheduleError';
  }
}

type StoredMeasurementCustody = Readonly<{
  format: 'openplanr-measurement-schedule-custody';
  version: 1;
  schedules: readonly MeasurementSchedule[];
  receipts: readonly MeasurementScheduleReceipt[];
  recordHash: `sha256:${string}`;
}>;

const SCHEDULE_ID = /^msch_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const CUSTODY_FILE = /^[a-f0-9]{64}\.schedule\.json$/u;
const MAX_CUSTODY_FILES = 2_048;
const MAX_CUSTODY_BYTES = 32 * 1024 * 1024;

function fail(code: MeasurementScheduleErrorCode, message: string, cause?: unknown): never {
  throw new MeasurementScheduleError(code, message, cause);
}

function isMissing(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

async function optionalStat(target: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(target);
  } catch (cause) {
    if (isMissing(cause)) return null;
    fail('E_MEASUREMENT_SCHEDULE_CUSTODY_INVALID', 'Measurement custody metadata failed.', cause);
  }
}

async function readLock(target: string): Promise<{ nonce: string; expiresAt: number } | null> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(target, 'utf8'));
  } catch (cause) {
    if (isMissing(cause)) return null;
    fail('E_MEASUREMENT_SCHEDULE_CUSTODY_INVALID', 'Measurement custody lock is invalid.', cause);
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof (value as { nonce?: unknown }).nonce !== 'string' ||
    typeof (value as { expiresAt?: unknown }).expiresAt !== 'number'
  ) {
    fail('E_MEASUREMENT_SCHEDULE_CUSTODY_INVALID', 'Measurement custody lock is invalid.');
  }
  return value as { nonce: string; expiresAt: number };
}

async function unlinkIfPresent(target: string): Promise<void> {
  try {
    await unlink(target);
  } catch (cause) {
    if (isMissing(cause)) return;
    fail('E_MEASUREMENT_SCHEDULE_CUSTODY_INVALID', 'Measurement custody cleanup failed.', cause);
  }
}

async function renameIfPresent(source: string, target: string): Promise<boolean> {
  try {
    await rename(source, target);
    return true;
  } catch (cause) {
    if (isMissing(cause)) return false;
    fail('E_MEASUREMENT_SCHEDULE_LOCKED', 'Measurement custody lock recovery failed.', cause);
  }
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('E_MEASUREMENT_SCHEDULE_CUSTODY_INVALID', 'Measurement custody is not one object.');
  }
  return value as Readonly<Record<string, unknown>>;
}

function schedule(value: JsonRecord): MeasurementSchedule {
  return value as MeasurementSchedule;
}

function receipt(value: JsonRecord): MeasurementScheduleReceipt {
  return value as MeasurementScheduleReceipt;
}

function custodyBody(
  schedules: readonly MeasurementSchedule[],
  receipts: readonly MeasurementScheduleReceipt[],
): Omit<StoredMeasurementCustody, 'recordHash'> {
  return {
    format: 'openplanr-measurement-schedule-custody',
    version: 1,
    schedules,
    receipts,
  };
}

function snapshot(custody: StoredMeasurementCustody): StoredSchedule {
  return Object.freeze({
    schedule: structuredClone(custody.schedules.at(-1) as MeasurementSchedule),
    receipt:
      custody.receipts.length === 0
        ? null
        : structuredClone(custody.receipts.at(-1) as MeasurementScheduleReceipt),
  });
}

export class ProjectMeasurementScheduleStore implements MeasurementScheduleStore {
  readonly #projectDir: string;
  readonly #root: string;
  readonly #contracts: MeasurementScheduleContracts;
  readonly #now: () => number;
  readonly #lockTtlMs: number;

  constructor(input: {
    projectDir: string;
    contracts: MeasurementScheduleContracts;
    now?: () => number;
    lockTtlMs?: number;
  }) {
    this.#projectDir = path.resolve(input.projectDir);
    this.#root = path.join(this.#projectDir, '.planr', 'operate', 'measurement-schedules');
    this.#contracts = input.contracts;
    this.#now = input.now ?? Date.now;
    this.#lockTtlMs = input.lockTtlMs ?? 30_000;
    if (
      !Number.isSafeInteger(this.#lockTtlMs) ||
      this.#lockTtlMs < 1_000 ||
      this.#lockTtlMs > 300_000
    ) {
      fail('E_MEASUREMENT_SCHEDULE_INVALID', 'Measurement lock policy is invalid.');
    }
  }

  async #ensureRoot(): Promise<void> {
    const options = {
      code: 'E_MEASUREMENT_SCHEDULE_CUSTODY_UNSAFE',
      message: 'Measurement custody cannot leave project-local Operate storage.',
    } as const;
    await assertOperatePathCustody(this.#projectDir, this.#root, options);
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    await assertOperatePathCustody(this.#projectDir, this.#root, {
      ...options,
      requireDirectory: true,
    });
    await assertOperateTreeCustody(this.#projectDir, this.#root, options);
    await chmod(this.#root, 0o700);
  }

  #paths(scheduleId: string): { data: string; lock: string } {
    if (!SCHEDULE_ID.test(scheduleId)) {
      fail('E_MEASUREMENT_SCHEDULE_INVALID', 'Measurement schedule identity is invalid.');
    }
    const id = createHash('sha256').update(scheduleId, 'utf8').digest('hex');
    return {
      data: path.join(this.#root, `${id}.schedule.json`),
      lock: path.join(this.#root, `${id}.lock`),
    };
  }

  async #withLock<T>(scheduleId: string, work: (dataPath: string) => Promise<T>): Promise<T> {
    await this.#ensureRoot();
    const paths = this.#paths(scheduleId);
    const nonce = randomBytes(32).toString('hex');
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    return withOperateMutationLane(`${this.#root}:${scheduleId}`, async () => {
      try {
        try {
          handle = await open(paths.lock, 'wx', 0o600);
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') {
            fail('E_MEASUREMENT_SCHEDULE_LOCKED', 'Measurement custody lock failed.', cause);
          }
          const metadata = await optionalStat(paths.lock);
          const observed = await readLock(paths.lock);
          if (
            metadata &&
            observed &&
            typeof observed.nonce === 'string' &&
            typeof observed.expiresAt === 'number' &&
            observed.expiresAt <= this.#now()
          ) {
            const stale = `${paths.lock}.stale-${randomBytes(8).toString('hex')}`;
            const moved = await renameIfPresent(paths.lock, stale);
            if (moved) {
              const staleMetadata = await optionalStat(stale);
              if (
                !staleMetadata ||
                staleMetadata.dev !== metadata.dev ||
                staleMetadata.ino !== metadata.ino
              ) {
                await rename(stale, paths.lock);
                fail(
                  'E_MEASUREMENT_SCHEDULE_LOCKED',
                  'Measurement custody changed during lock recovery.',
                );
              }
              await unlinkIfPresent(stale);
            }
            try {
              handle = await open(paths.lock, 'wx', 0o600);
            } catch (cause) {
              if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') {
                fail('E_MEASUREMENT_SCHEDULE_LOCKED', 'Measurement custody lock failed.', cause);
              }
            }
          }
          if (!handle) {
            fail('E_MEASUREMENT_SCHEDULE_LOCKED', 'Measurement custody is already in use.');
          }
        }
        await handle.writeFile(
          JSON.stringify({ nonce, expiresAt: this.#now() + this.#lockTtlMs }),
          'utf8',
        );
        await handle.sync();
        return await work(paths.data);
      } finally {
        await handle?.close();
        if (handle) {
          const current = await readLock(paths.lock);
          if (current?.nonce !== nonce) {
            fail('E_MEASUREMENT_SCHEDULE_LOCKED', 'Measurement custody lease was superseded.');
          }
          await unlinkIfPresent(paths.lock);
        }
      }
    });
  }

  async #readPath(dataPath: string): Promise<StoredMeasurementCustody | null> {
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(dataPath);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
      fail('E_MEASUREMENT_SCHEDULE_CUSTODY_INVALID', 'Measurement custody is unreadable.', cause);
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_CUSTODY_BYTES) {
      fail('E_MEASUREMENT_SCHEDULE_CUSTODY_UNSAFE', 'Measurement custody file is unsafe.');
    }
    let parsed: Readonly<Record<string, unknown>>;
    try {
      parsed = record(JSON.parse(await readFile(dataPath, 'utf8')));
    } catch (cause) {
      if (cause instanceof MeasurementScheduleError) throw cause;
      fail(
        'E_MEASUREMENT_SCHEDULE_CUSTODY_INVALID',
        'Measurement custody bytes are invalid.',
        cause,
      );
    }
    if (
      !exactKeys(parsed, ['format', 'version', 'schedules', 'receipts', 'recordHash']) ||
      parsed.format !== 'openplanr-measurement-schedule-custody' ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.schedules) ||
      parsed.schedules.length < 1 ||
      parsed.schedules.length > 10_001 ||
      !Array.isArray(parsed.receipts) ||
      parsed.receipts.length !== parsed.schedules.length - 1 ||
      !HASH.test(String(parsed.recordHash))
    ) {
      fail('E_MEASUREMENT_SCHEDULE_CUSTODY_INVALID', 'Measurement custody envelope is invalid.');
    }
    const schedules = parsed.schedules.map((value) =>
      schedule(this.#contracts.validateSchedule(value)),
    );
    const scheduleId = schedules[0].scheduleId;
    const receipts = parsed.receipts.map((value, index) =>
      receipt(
        this.#contracts.validateReceipt(
          value,
          schedules[index] as unknown as JsonRecord,
          schedules[index + 1] as unknown as JsonRecord,
        ),
      ),
    );
    if (
      schedules.some(
        (value, index) => value.scheduleId !== scheduleId || value.generation !== index,
      )
    ) {
      fail('E_MEASUREMENT_SCHEDULE_CUSTODY_INVALID', 'Measurement custody history is invalid.');
    }
    const body = custodyBody(schedules, receipts);
    if (parsed.recordHash !== sha256CanonicalJson(body)) {
      fail('E_MEASUREMENT_SCHEDULE_CUSTODY_INVALID', 'Measurement custody digest changed.');
    }
    return Object.freeze({ ...body, recordHash: parsed.recordHash }) as StoredMeasurementCustody;
  }

  async #writePath(dataPath: string, body: Omit<StoredMeasurementCustody, 'recordHash'>) {
    const value: StoredMeasurementCustody = {
      ...body,
      recordHash: sha256CanonicalJson(body),
    };
    const temporary = `${dataPath}.${randomBytes(8).toString('hex')}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, dataPath);
      await chmod(dataPath, 0o600);
    } finally {
      await handle?.close();
      await unlinkIfPresent(temporary);
    }
  }

  async read(scheduleId: string): Promise<StoredSchedule | null> {
    return this.#withLock(scheduleId, async (dataPath) => {
      const current = await this.#readPath(dataPath);
      if (current && current.schedules[0].scheduleId !== scheduleId) {
        fail('E_MEASUREMENT_SCHEDULE_CONFLICT', 'Measurement custody identity changed.');
      }
      return current ? snapshot(current) : null;
    });
  }

  async list(): Promise<readonly string[]> {
    await this.#ensureRoot();
    const entries = await readdir(this.#root, { withFileTypes: true });
    const files = entries.filter((entry) => CUSTODY_FILE.test(entry.name));
    if (files.length > MAX_CUSTODY_FILES) {
      fail('E_MEASUREMENT_SCHEDULE_CUSTODY_INVALID', 'Measurement inventory is too large.');
    }
    const identities: string[] = [];
    for (const entry of files.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        fail('E_MEASUREMENT_SCHEDULE_CUSTODY_UNSAFE', 'Measurement inventory is unsafe.');
      }
      const current = await this.#readPath(path.join(this.#root, entry.name));
      if (!current) {
        fail('E_MEASUREMENT_SCHEDULE_CUSTODY_INVALID', 'Measurement inventory changed.');
      }
      identities.push(current.schedules[0].scheduleId);
    }
    return Object.freeze(identities.sort());
  }

  async mutate<T>(
    scheduleId: string,
    mutation: (current: StoredSchedule | null) => StoreMutation<T> | Promise<StoreMutation<T>>,
  ): Promise<T> {
    return this.#withLock(scheduleId, async (dataPath) => {
      const current = await this.#readPath(dataPath);
      if (current && current.schedules[0].scheduleId !== scheduleId) {
        fail('E_MEASUREMENT_SCHEDULE_CONFLICT', 'Measurement custody identity changed.');
      }
      const previous = current ? snapshot(current) : null;
      const updated = await mutation(previous);
      const nextSchedule = schedule(
        this.#contracts.validateSchedule(updated.stored.schedule as unknown as JsonRecord),
      );
      if (nextSchedule.scheduleId !== scheduleId) {
        fail('E_MEASUREMENT_SCHEDULE_CONFLICT', 'Measurement mutation changed its identity.');
      }
      if (!current) {
        if (updated.initial) {
          const initial = schedule(
            this.#contracts.validateSchedule(updated.initial as unknown as JsonRecord),
          );
          if (
            initial.scheduleId !== scheduleId ||
            initial.generation !== 0 ||
            initial.state !== 'disabled' ||
            !updated.stored.receipt ||
            nextSchedule.generation !== 1
          ) {
            fail('E_MEASUREMENT_SCHEDULE_CONFLICT', 'Measurement initialization is invalid.');
          }
          const nextReceipt = receipt(
            this.#contracts.validateReceipt(
              updated.stored.receipt,
              initial as unknown as JsonRecord,
              nextSchedule as unknown as JsonRecord,
            ),
          );
          await this.#writePath(dataPath, custodyBody([initial, nextSchedule], [nextReceipt]));
          return updated.result;
        }
        if (updated.stored.receipt !== null || nextSchedule.generation !== 0) {
          fail('E_MEASUREMENT_SCHEDULE_CONFLICT', 'New measurement custody is not disabled.');
        }
        await this.#writePath(dataPath, custodyBody([nextSchedule], []));
        return updated.result;
      }
      if (sha256CanonicalJson(previous) === sha256CanonicalJson(updated.stored)) {
        return updated.result;
      }
      const prior = snapshot(current);
      if (!updated.stored.receipt || nextSchedule.generation !== prior.schedule.generation + 1) {
        fail('E_MEASUREMENT_SCHEDULE_CONFLICT', 'Measurement transition is not contiguous.');
      }
      const nextReceipt = receipt(
        this.#contracts.validateReceipt(
          updated.stored.receipt,
          prior.schedule as unknown as JsonRecord,
          nextSchedule as unknown as JsonRecord,
        ),
      );
      await this.#writePath(
        dataPath,
        custodyBody([...current.schedules, nextSchedule], [...current.receipts, nextReceipt]),
      );
      return updated.result;
    });
  }
}

export function measurementScheduleContracts(
  composition: OperateComposition,
): MeasurementScheduleContracts {
  return Object.freeze({
    validateSchedule: (value) => composition.validateMeasurementSchedule(value),
    validateReceipt: (value, previous, resulting) =>
      composition.validateMeasurementScheduleReceipt(value, previous, resulting),
    reduceSchedule: (current, transition, priorReceipt) =>
      composition.reduceMeasurementSchedule(current, transition, priorReceipt),
  });
}

export function createMeasurementScheduleService(
  dependencies: Readonly<{
    store: MeasurementScheduleStore;
    contracts: MeasurementScheduleContracts;
  }>,
) {
  const { store, contracts } = dependencies;

  const validated = (value: unknown): MeasurementSchedule =>
    schedule(contracts.validateSchedule(value));

  async function load(scheduleId: string): Promise<StoredSchedule> {
    const stored = await store.read(scheduleId);
    if (!stored) {
      throw new MeasurementScheduleError(
        'E_MEASUREMENT_SCHEDULE_UNKNOWN',
        `No measurement schedule is stored for ${scheduleId}.`,
      );
    }
    return stored;
  }

  async function transition(
    scheduleId: string,
    value: Readonly<Record<string, unknown>>,
    requiredType?: 'enable' | 'disable',
  ): Promise<ApplyResult> {
    if (requiredType && value.type !== requiredType) {
      fail('E_MEASUREMENT_SCHEDULE_INVALID', `Measurement transition must be ${requiredType}.`);
    }
    return store.mutate(scheduleId, (current) => {
      if (!current) {
        fail(
          'E_MEASUREMENT_SCHEDULE_UNKNOWN',
          `No measurement schedule is stored for ${scheduleId}.`,
        );
      }
      const outcome = contracts.reduceSchedule(
        current.schedule,
        value,
        current.receipt ?? undefined,
      ) as ApplyResult;
      return {
        stored: { schedule: outcome.schedule, receipt: outcome.receipt },
        result: outcome,
      };
    });
  }

  return {
    preview(value: unknown): MeasurementSchedule {
      return validated(value);
    },

    async register(value: MeasurementSchedule): Promise<MeasurementSchedule> {
      const candidate = validated(value);
      return store.mutate(candidate.scheduleId, (current) => {
        if (current) {
          if (current.schedule.scheduleHash === candidate.scheduleHash)
            return {
              stored: current,
              result: current.schedule,
            };
          fail(
            'E_MEASUREMENT_SCHEDULE_EXISTS',
            `Measurement schedule ${candidate.scheduleId} is already stored.`,
          );
        }
        return { stored: { schedule: candidate, receipt: null }, result: candidate };
      });
    },

    async enable(
      value: MeasurementSchedule,
      transitionValue: Readonly<Record<string, unknown>>,
    ): Promise<ApplyResult> {
      const candidate = validated(value);
      if (candidate.generation !== 0 || candidate.state !== 'disabled') {
        fail('E_MEASUREMENT_SCHEDULE_INVALID', 'Measurement enable requires a disabled schedule.');
      }
      if (
        transitionValue.type !== 'enable' ||
        transitionValue.expectedScheduleHash !== candidate.scheduleHash
      ) {
        fail(
          'E_MEASUREMENT_SCHEDULE_CONFLICT',
          'Measurement enable changed its previewed schedule.',
        );
      }
      return store.mutate(candidate.scheduleId, (current) => {
        const base = current ?? { schedule: candidate, receipt: null };
        const outcome = contracts.reduceSchedule(
          base.schedule,
          transitionValue,
          base.receipt ?? undefined,
        ) as ApplyResult;
        return {
          stored: { schedule: outcome.schedule, receipt: outcome.receipt },
          result: outcome,
          ...(current ? {} : { initial: candidate }),
        };
      });
    },

    async disable(
      scheduleId: string,
      transitionValue: Readonly<Record<string, unknown>>,
    ): Promise<ApplyResult> {
      return transition(scheduleId, transitionValue, 'disable');
    },

    async apply(
      scheduleId: string,
      transitionValue: Readonly<Record<string, unknown>>,
    ): Promise<ApplyResult> {
      return transition(scheduleId, transitionValue);
    },

    async read(scheduleId: string): Promise<StoredSchedule> {
      return load(scheduleId);
    },

    async due(atIso: string, ownerActorId?: string): Promise<readonly StoredSchedule[]> {
      const at = Date.parse(atIso);
      if (!Number.isFinite(at)) {
        throw new MeasurementScheduleError(
          'E_MEASUREMENT_SCHEDULE_CLOCK_INVALID',
          'Due evaluation requires one exact ISO timestamp.',
        );
      }
      const found: StoredSchedule[] = [];
      for (const scheduleId of await store.list()) {
        const current = await store.read(scheduleId);
        if (!current || (ownerActorId && current.schedule.ownerActorId !== ownerActorId)) continue;
        const { state, nextDueAt, nextEventIdentity } = current.schedule;
        if (state !== 'enabled' || nextDueAt === null || nextEventIdentity === null) continue;
        if (Date.parse(nextDueAt) <= at) found.push(current);
      }
      return Object.freeze(
        found.sort((left, right) =>
          left.schedule.scheduleId.localeCompare(right.schedule.scheduleId),
        ),
      );
    },
  };
}

export type MeasurementScheduleService = ReturnType<typeof createMeasurementScheduleService>;

export function createProjectMeasurementScheduleService(
  projectDir: string,
  composition: OperateComposition,
  options: Readonly<{ now?: () => number; lockTtlMs?: number }> = {},
): MeasurementScheduleService {
  const contracts = measurementScheduleContracts(composition);
  return createMeasurementScheduleService({
    contracts,
    store: new ProjectMeasurementScheduleStore({
      projectDir,
      contracts,
      now: options.now,
      lockTtlMs: options.lockTtlMs,
    }),
  });
}
