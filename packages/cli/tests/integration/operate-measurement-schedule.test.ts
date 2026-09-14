import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import {
  assertOperatingMeasurementScheduleReceiptV2,
  assertOperatingMeasurementScheduleV2,
  reduceOperatingMeasurementScheduleV2,
} from 'planr-pipeline';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { registerOperateCommandDefinition } from '../../src/cli/commands/operate/registration.js';
import { createOperateClient } from '../../src/services/operate/client.js';
import { createOperateComposition } from '../../src/services/operate/composition.js';
import {
  createMeasurementScheduleService,
  createProjectMeasurementScheduleService,
  type MeasurementSchedule,
  type MeasurementScheduleContracts,
  type MeasurementScheduleStore,
  type StoredSchedule,
} from '../../src/services/operate/measurement-schedule-service.js';

const HASH = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;
const contracts: MeasurementScheduleContracts = {
  validateSchedule: (value) => assertOperatingMeasurementScheduleV2(value),
  validateReceipt: (value, previousSchedule, resultingSchedule) =>
    assertOperatingMeasurementScheduleReceiptV2(value, {
      previousSchedule,
      resultingSchedule,
    }),
  reduceSchedule: (schedule, transition, priorReceipt) =>
    reduceOperatingMeasurementScheduleV2(
      schedule,
      transition,
      priorReceipt === undefined ? {} : { priorReceipt },
    ),
};

function disabledSchedule(): MeasurementSchedule {
  const body = {
    kind: 'operating-measurement-schedule',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    scheduleId: 'msch_reference0001',
    generation: 0,
    measurementPlanId: 'mpln_reference0001',
    planHash: HASH('12'),
    ownerActorId: 'owner.reference',
    consentRecordHashes: [HASH('88')],
    ceilingsHash: HASH('13'),
    recurrence: { kind: 'interval', intervalSeconds: 3600, timeZone: 'Europe/Istanbul' },
    startsAt: '2026-08-24T12:00:00Z',
    endsAt: '2026-08-25T12:00:00Z',
    maxRuns: 24,
    misfirePolicy: 'run-once',
    dstPolicy: 'elapsed-time',
    state: 'disabled',
    runCount: 0,
    nextEventIdentity: null,
    nextDueAt: null,
    lastReceiptId: null,
    lastTransitionHash: null,
  };
  return { ...body, scheduleHash: sha256Jcs(body) } as unknown as MeasurementSchedule;
}

/** An in-memory store standing in for local disk; restart is a fresh service over it. */
function memoryStore(): MeasurementScheduleStore & { records: Map<string, StoredSchedule> } {
  const records = new Map<string, StoredSchedule>();
  return {
    records,
    async read(id) {
      return records.get(id) ?? null;
    },
    async list() {
      return [...records.keys()];
    },
    async mutate(id, mutation) {
      const updated = await mutation(records.get(id) ?? null);
      records.set(id, updated.stored);
      return updated.result;
    },
  };
}

function enableTransition(schedule: MeasurementSchedule) {
  return {
    receiptId: 'msrc_enable000001',
    type: 'enable',
    expectedGeneration: schedule.generation,
    expectedScheduleHash: schedule.scheduleHash,
    expectedState: schedule.state,
    expectedRunCount: schedule.runCount,
    expectedNextEventIdentity: schedule.nextEventIdentity,
    expectedNextDueAt: schedule.nextDueAt,
    planHash: HASH('12'),
    consentRecordHashes: [HASH('88')],
    ceilingsHash: HASH('13'),
    clockHash: HASH('15'),
    eventId: 'mevt_enable000001',
    nextEventIdentity: 'mevt_enable000001',
    nextDueAt: '2026-08-24T13:00:00Z',
    at: '2026-08-24T12:00:00Z',
  };
}

let store: ReturnType<typeof memoryStore>;
let service: ReturnType<typeof createMeasurementScheduleService>;

beforeEach(() => {
  store = memoryStore();
  service = createMeasurementScheduleService({ store, contracts });
});

describe('measurement schedules stay disabled until the owner enables them', () => {
  it('accepts only a disabled schedule at registration', async () => {
    const registered = await service.register(disabledSchedule());
    expect(registered.state).toBe('disabled');
  });

  it('never reports a freshly registered schedule as due, however late the clock', async () => {
    await service.register(disabledSchedule());
    expect(await service.due('2030-01-01T00:00:00Z')).toEqual([]);
  });

  it('refuses an already-enabled schedule as a new registration', async () => {
    const schedule = { ...disabledSchedule(), state: 'enabled' };
    await expect(service.register(schedule as MeasurementSchedule)).rejects.toThrow();
  });

  it('becomes due only after an explicit enable transition', async () => {
    const schedule = await service.register(disabledSchedule());
    const applied = await service.apply(schedule.scheduleId, enableTransition(schedule));
    expect(applied.replay).toBe(false);
    expect(applied.schedule.state).toBe('enabled');

    expect(await service.due('2026-08-24T12:30:00Z')).toEqual([]);
    const due = await service.due('2026-08-24T13:00:00Z');
    expect(due.map((entry) => entry.schedule.scheduleId)).toEqual(['msch_reference0001']);
  });
});

describe('restart and duplicate due work', () => {
  it('a restarted service sees the enabled state from the store', async () => {
    const schedule = await service.register(disabledSchedule());
    await service.apply(schedule.scheduleId, enableTransition(schedule));

    const restarted = createMeasurementScheduleService({ store, contracts });
    const due = await restarted.due('2026-08-24T13:00:00Z');
    expect(due).toHaveLength(1);
    expect(due[0].schedule.state).toBe('enabled');

    const root = await mkdtemp(path.join(tmpdir(), 'openplanr-measurement-'));
    try {
      const composition = await createOperateComposition();
      const persisted = createProjectMeasurementScheduleService(root, composition);
      const initial = await persisted.register(disabledSchedule());
      await persisted.apply(initial.scheduleId, enableTransition(initial));
      const recovered = createProjectMeasurementScheduleService(root, composition);
      expect(await recovered.due('2026-08-24T13:00:00Z')).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('replaying one transition identity does not run the work twice', async () => {
    const schedule = await service.register(disabledSchedule());
    const transition = enableTransition(schedule);
    const first = await service.apply(schedule.scheduleId, transition);

    const stored = await service.read(schedule.scheduleId);
    const replayed = await service.apply(schedule.scheduleId, transition);

    expect(replayed.replay).toBe(true);
    expect(replayed.receipt.receiptHash).toBe(first.receipt.receiptHash);
    // The stored record is untouched by a replay.
    expect(await service.read(schedule.scheduleId)).toEqual(stored);
  });

  it('a divergent transition reusing one receipt identity is refused', async () => {
    const schedule = await service.register(disabledSchedule());
    const transition = enableTransition(schedule);
    await service.apply(schedule.scheduleId, transition);
    await expect(
      service.apply(schedule.scheduleId, { ...transition, nextDueAt: '2026-08-24T14:00:00Z' }),
    ).rejects.toThrow();
  });

  it('an unknown schedule fails with a usable code', async () => {
    await expect(service.apply('msch_missing00001', {})).rejects.toMatchObject({
      code: 'E_MEASUREMENT_SCHEDULE_UNKNOWN',
    });
  });
});

describe('the contract still owns every rule', () => {
  it('the registered schedule is exactly what the pipeline validates', async () => {
    const schedule = await service.register(disabledSchedule());
    expect(assertOperatingMeasurementScheduleV2(schedule)).toEqual(schedule);

    const root = await mkdtemp(path.join(tmpdir(), 'openplanr-measurement-client-'));
    try {
      const result = await createOperateClient(root).measurement({
        operation: 'measurement.preview',
        schedule,
        actor: { actorId: schedule.ownerActorId, kind: 'human', runtime: 'openplanr' },
      });
      expect(result).toMatchObject({
        ok: true,
        operation: 'measurement.preview',
        authorityRequired: true,
        ownerActionRequired: true,
        effects: [
          { id: 'schedule-custody-write', executed: false },
          { id: 'due-work-issue', executed: false },
          { id: 'provider-call', executed: false },
        ],
        data: { confirmationDigest: schedule.scheduleHash },
      });
      const unavailable = await createOperateClient(root).measurement({
        operation: 'measurement.enable',
        schedule,
        transition: enableTransition(schedule),
        confirmDigest: schedule.scheduleHash,
        actor: { actorId: schedule.ownerActorId, kind: 'human', runtime: 'openplanr' },
      });
      expect(unavailable).toMatchObject({
        ok: false,
        error: {
          code: 'CYCLE_NOT_FOUND',
          problem: 'No durable Operate lifecycle exists.',
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('local state that lost its contract guarantees', () => {
  it('a non-enabled schedule that still carries a due identity is never run', async () => {
    // The contract nulls the due identity on any inactive schedule, so this shape can
    // only arrive from a hand-edited or partially-written local store. due() must refuse
    // it on its own rather than trusting the file.
    const schedule = disabledSchedule();
    for (const state of ['disabled', 'paused', 'revoked', 'expired', 'completed']) {
      store.records.set('msch_reference0001', {
        schedule: {
          ...schedule,
          state,
          nextEventIdentity: 'mevt_enable000001',
          nextDueAt: '2026-08-24T13:00:00Z',
        } as MeasurementSchedule,
        receipt: null,
      });
      expect(await service.due('2026-08-24T13:00:00Z')).toEqual([]);
    }
  });

  it('an enabled schedule missing its due identity is not run either', async () => {
    store.records.set('msch_reference0001', {
      schedule: {
        ...disabledSchedule(),
        state: 'enabled',
        nextDueAt: '2026-08-24T13:00:00Z',
      } as MeasurementSchedule,
      receipt: null,
    });
    expect(await service.due('2026-08-24T13:00:00Z')).toEqual([]);

    const program = new Command();
    registerOperateCommandDefinition(program, {
      createClient: async (projectDir) => createOperateClient(projectDir),
      createAssignmentPacketService: async () => {
        throw new Error('unused');
      },
      listDomains: async () => [],
      inspectOperateReviewNote: async () => {
        throw new Error('unused');
      },
      startDashboard: async () => ({ url: 'http://127.0.0.1' }),
    });
    const operate = program.commands.find((command) => command.name() === 'operate');
    const measurement = operate?.commands.find((command) => command.name() === 'measurement');
    expect(measurement?.commands.map((command) => command.name())).toEqual([
      'preview',
      'enable',
      'disable',
      'status',
    ]);
  });
});
