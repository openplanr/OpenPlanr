import { describe, expect, it } from 'vitest';
import {
  ADVISOR_LIFECYCLE_TERMINAL_STATES,
  AdvisorLifecycleDriver,
  type AdvisorLifecycleState,
  type AdvisorRecordOutcome,
  isAdvisorLifecycleTerminal,
} from '../../src/services/operate/lifecycle-driver.js';
import type { MissionDispatchBudgetSignal } from '../../src/services/operate/mission-dispatch.js';
import { OperateError, type OperatingRoleId } from '../../src/services/operate/types.js';

const ALL_STATES: AdvisorLifecycleState[] = [
  'pending',
  'running',
  'returned',
  'validating',
  'recorded',
  'not_evaluated',
  'failed',
  'cancelled',
];

/** Flush pending microtasks (and the setImmediate queue) without any wall-clock sleep. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * A fully deterministic injected clock + timer scheduler. Nothing here touches
 * wall-clock: `clock()` returns the manually advanced epoch, and `advance()` fires
 * exactly the timers that come due — including ones a fired timer schedules — so
 * heartbeat and per-attempt-timeout behaviour is provable without a real sleep.
 */
class ManualClock {
  private nowMs = 0;
  private nextId = 1;
  private timers: Array<{ id: number; fn: () => void; due: number }> = [];

  clock = (): number => this.nowMs;

  setTimer = (fn: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.timers.push({ id, fn, due: this.nowMs + ms });
    return id;
  };

  clearTimer = (handle: unknown): void => {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  };

  async advance(ms: number): Promise<void> {
    const target = this.nowMs + ms;
    // Let any already-scheduled async work settle before we begin firing.
    await flush();
    for (;;) {
      const due = this.timers
        .filter((timer) => timer.due <= target)
        .sort((left, right) => left.due - right.due || left.id - right.id);
      const next = due[0];
      if (!next) break;
      this.timers = this.timers.filter((timer) => timer.id !== next.id);
      this.nowMs = next.due;
      next.fn();
      // A fired timer may schedule the next one from inside an async chain; drain
      // the microtask + immediate queues so that reschedule is visible to the loop.
      await flush();
    }
    this.nowMs = target;
  }
}

const advisorPlan = (
  roleId: OperatingRoleId,
  extra: { structurallyRequired?: boolean; retryBudget?: number } = {},
) => ({ roleId, ...extra });

describe('AdvisorLifecycleDriver — per-role state machine (FR3 / US-003, DoD 1)', () => {
  it('keeps every role in exactly one of the eight declared states across a full happy path', () => {
    const driver = new AdvisorLifecycleDriver({
      roles: [advisorPlan('strategy-finance'), advisorPlan('technology-risk')],
      recordRole: async () => ({ recorded: true }),
    });

    const role: OperatingRoleId = 'strategy-finance';
    expect(driver.state(role)).toBe('pending');
    expect(driver.advance(role, { kind: 'dispatch' })).toBe('running');
    expect(driver.advance(role, { kind: 'return' })).toBe('returned');
    expect(driver.advance(role, { kind: 'validate' })).toBe('validating');
    expect(driver.advance(role, { kind: 'record' })).toBe('recorded');

    // Every observed state was one of the eight; the sibling was untouched.
    for (const snapshot of driver.snapshot()) {
      expect(ALL_STATES).toContain(snapshot.state);
    }
    expect(driver.state('technology-risk')).toBe('pending');
    expect([...ADVISOR_LIFECYCLE_TERMINAL_STATES]).toEqual([
      'recorded',
      'not_evaluated',
      'failed',
      'cancelled',
    ]);
    expect(isAdvisorLifecycleTerminal('recorded')).toBe(true);
    expect(isAdvisorLifecycleTerminal('running')).toBe(false);
  });

  it('refuses every illegal transition so no role can reach a state outside the eight', () => {
    const driver = new AdvisorLifecycleDriver({
      roles: [advisorPlan('strategy-finance')],
      recordRole: async () => ({ recorded: true }),
    });
    const role: OperatingRoleId = 'strategy-finance';

    // Cannot skip states: pending cannot record, run cannot validate directly.
    expect(() => driver.advance(role, { kind: 'record' })).toThrow(OperateError);
    driver.advance(role, { kind: 'dispatch' });
    expect(() => driver.advance(role, { kind: 'validate' })).toThrow(OperateError);

    // A terminal role can never be re-opened.
    driver.advance(role, { kind: 'fail', reason: 'boom' });
    expect(driver.state(role)).toBe('failed');
    expect(() => driver.advance(role, { kind: 'dispatch' })).toThrow(/cannot dispatch from failed/);
    expect(driver.statusReason(role)).toBe('boom');
  });
});

describe('AdvisorLifecycleDriver — retry budget and stall isolation (FR3 / DoD 2)', () => {
  it('resolves a role past its retry budget to not_evaluated with a governed gap without blocking siblings', async () => {
    const clock = new ManualClock();
    const recorded: OperatingRoleId[] = [];
    const roleTimeoutMs = 1_000;

    const driver = new AdvisorLifecycleDriver({
      roles: [
        // Optional lens that stalls forever; budget of one independent retry.
        advisorPlan('strategy-finance', { retryBudget: 1 }),
        // A healthy sibling that records normally.
        advisorPlan('technology-risk', { retryBudget: 1 }),
      ],
      now: clock.clock,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      roleTimeoutMs,
      recordRole: async ({ roleId }): Promise<AdvisorRecordOutcome> => {
        recorded.push(roleId);
        return { recorded: true, leaseExpiresAtMs: clock.clock() + 900_000 };
      },
    });

    const dispatch = (
      roleId: OperatingRoleId,
      _signal: MissionDispatchBudgetSignal,
    ): Promise<unknown> => {
      if (roleId === 'strategy-finance') {
        // Never returns — the injected per-attempt timeout is what ends each attempt.
        return new Promise<unknown>(() => {});
      }
      return Promise.resolve({ analysisMarkdown: 'healthy lens' });
    };

    const runPromise = driver.run({ parallel: true, dispatch });
    // Fire the stalling role's two attempt timeouts (initial + one retry) on the
    // injected clock; no wall-clock sleep participates.
    await clock.advance(roleTimeoutMs * 3);
    const summary = await runPromise;

    // The stalled optional role terminated not_evaluated with a governed gap and
    // its statusReason; the healthy sibling recorded and was never cancelled.
    expect(driver.state('strategy-finance')).toBe('not_evaluated');
    expect(driver.state('technology-risk')).toBe('recorded');
    expect(recorded).toEqual(['technology-risk']);
    expect(summary.notEvaluated).toEqual(['strategy-finance']);
    expect(summary.recorded).toEqual(['technology-risk']);
    expect(summary.cancelled).toEqual([]);

    const stalledSnapshot = driver.snapshot().find((role) => role.roleId === 'strategy-finance');
    expect(stalledSnapshot?.retriesUsed).toBe(1); // budget of one retry was spent
    expect(stalledSnapshot?.attempts).toBe(2); // initial dispatch + one retry
    expect(stalledSnapshot?.statusReason).toMatch(/did not return within/);

    const gaps = driver.governedGaps();
    expect(gaps).toContainEqual(
      expect.objectContaining({ roleId: 'strategy-finance', outcome: 'not_evaluated' }),
    );
    expect(gaps.every((gap) => gap.reason.length > 0)).toBe(true);

    // The fan-out reported each item's lifecycle through the driver (proves the
    // mission-dispatch reporter is wired, not cosmetic).
    const timelineRoles = new Set(driver.dispatchTimeline().map((entry) => entry.roleId));
    expect(timelineRoles).toContain('strategy-finance');
    expect(timelineRoles).toContain('technology-risk');
  });

  it('terminates a structurally-required stalled role as failed rather than not_evaluated', async () => {
    const clock = new ManualClock();
    const roleTimeoutMs = 1_000;
    const driver = new AdvisorLifecycleDriver({
      roles: [advisorPlan('strategy-finance', { structurallyRequired: true, retryBudget: 0 })],
      now: clock.clock,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      roleTimeoutMs,
      recordRole: async () => ({ recorded: true }),
    });

    const runPromise = driver.run({
      parallel: true,
      dispatch: () => new Promise<unknown>(() => {}),
    });
    await clock.advance(roleTimeoutMs * 2);
    const summary = await runPromise;

    expect(driver.state('strategy-finance')).toBe('failed');
    expect(summary.failed).toEqual(['strategy-finance']);
    expect(driver.chairReady()).toBe(false); // a required role never recorded
  });

  it('records a T-002 zero-grounding result as a governed not_evaluated, not a stall retry', async () => {
    const driver = new AdvisorLifecycleDriver({
      roles: [advisorPlan('growth-market', { retryBudget: 3 })],
      recordRole: async () => ({
        recorded: true,
        notEvaluated: true,
        statusReason: 'grounded no resolvable evidence',
      }),
    });
    const summary = await driver.run({
      parallel: false,
      dispatch: () => Promise.resolve({ analysisMarkdown: 'ungrounded' }),
    });
    expect(driver.state('growth-market')).toBe('not_evaluated');
    // A zero-grounding record is terminal — it must NOT have consumed retry budget.
    expect(driver.snapshot()[0].retriesUsed).toBe(0);
    expect(summary.gaps).toContainEqual(
      expect.objectContaining({
        roleId: 'growth-market',
        outcome: 'not_evaluated',
        reason: 'grounded no resolvable evidence',
      }),
    );
  });
});

describe('AdvisorLifecycleDriver — automatic heartbeat scheduling (FR2 / DoD 3)', () => {
  it('renews the lease as the window approaches without any role completing', async () => {
    const clock = new ManualClock();
    const leaseWindowMs = 900_000; // 15 minutes
    let heartbeatCalls = 0;

    const driver = new AdvisorLifecycleDriver({
      roles: [advisorPlan('operations-customer'), advisorPlan('product-activation')],
      now: clock.clock,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      leaseExpiresAtMs: leaseWindowMs,
      heartbeatLeadMs: 120_000, // renew when <= 2 minutes remain
      recordRole: async () => ({ recorded: true }),
      heartbeat: async () => {
        heartbeatCalls += 1;
        return { leaseExpiresAtMs: clock.clock() + leaseWindowMs };
      },
    });

    const stop = driver.scheduleHeartbeat(60_000); // check every minute
    // Advance almost the whole window. No role is ever dispatched or recorded.
    await clock.advance(800_000);

    // The heartbeat fired automatically as the lease window approached (at 780s,
    // when only 120s remained) and carried the lease forward — independent of any
    // role completing.
    expect(heartbeatCalls).toBe(1);
    expect(driver.heartbeatsIssued()).toBe(1);
    expect(driver.leaseExpiry()).toBe(780_000 + leaseWindowMs);
    // Proof that nothing completed: every role is still pending.
    expect(driver.state('operations-customer')).toBe('pending');
    expect(driver.state('product-activation')).toBe('pending');
    stop();
  });

  it('stops heartbeating once every role has reached a terminal state', async () => {
    const clock = new ManualClock();
    let heartbeatCalls = 0;
    const driver = new AdvisorLifecycleDriver({
      roles: [advisorPlan('operations-customer')],
      now: clock.clock,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      leaseExpiresAtMs: 100_000,
      heartbeatLeadMs: 120_000, // always "approaching" so it would beat every tick
      recordRole: async () => ({ recorded: true }),
      heartbeat: async () => {
        heartbeatCalls += 1;
        return { leaseExpiresAtMs: clock.clock() + 900_000 };
      },
    });

    driver.advance('operations-customer', { kind: 'dispatch' });
    driver.advance('operations-customer', { kind: 'cancel', reason: 'cycle cancelled' });
    driver.scheduleHeartbeat(60_000);
    await clock.advance(600_000);

    // The board is fully terminal, so the scheduler quiesced instead of beating a
    // dead cycle forever.
    expect(heartbeatCalls).toBe(0);
  });
});

describe('AdvisorLifecycleDriver — chair readiness over a partial board (FR13 / DoD 4)', () => {
  it('reports ready once every non-structurally-required role is terminal, without them recording', () => {
    const driver = new AdvisorLifecycleDriver({
      roles: [
        advisorPlan('strategy-finance', { structurallyRequired: true }),
        advisorPlan('technology-risk'), // optional
        advisorPlan('growth-market'), // optional
      ],
      recordRole: async () => ({ recorded: true }),
    });

    expect(driver.chairReady()).toBe(false); // nothing terminal yet

    // Required role records; one optional role records.
    for (const event of ['dispatch', 'return', 'validate', 'record'] as const) {
      driver.advance('strategy-finance', { kind: event });
      driver.advance('growth-market', { kind: event });
    }
    // Still not ready: the remaining optional role is in flight.
    driver.advance('technology-risk', { kind: 'dispatch' });
    expect(driver.chairReady()).toBe(false);

    // The optional role terminates not_evaluated — NOT recorded — and the board is
    // now chair-ready: an optional lens need not record to release the Chair.
    driver.advance('technology-risk', { kind: 'not-evaluated', reason: 'stalled past budget' });
    expect(driver.state('technology-risk')).toBe('not_evaluated');
    expect(driver.chairReady()).toBe(true);
  });

  it('holds the Chair closed while a structurally-required role is only not_evaluated', () => {
    const driver = new AdvisorLifecycleDriver({
      roles: [
        advisorPlan('strategy-finance', { structurallyRequired: true }),
        advisorPlan('technology-risk'),
      ],
      recordRole: async () => ({ recorded: true }),
    });
    for (const event of ['dispatch', 'return', 'validate', 'record'] as const) {
      driver.advance('technology-risk', { kind: event });
    }
    driver.advance('strategy-finance', { kind: 'dispatch' });
    driver.advance('strategy-finance', { kind: 'not-evaluated', reason: 'no grounding' });
    // Optional role recorded, but the required perspective is missing — the Chair
    // cannot synthesize around a required gap, so readiness stays false.
    expect(driver.chairReady()).toBe(false);
  });

  it('excludes the chair role itself and treats resumed recorded roles as terminal', () => {
    const driver = new AdvisorLifecycleDriver({
      roles: [
        advisorPlan('strategy-finance'),
        { roleId: 'technology-risk', initialState: 'recorded' }, // resumed from a prior session
        advisorPlan('chair'),
      ],
      recordRole: async () => ({ recorded: true }),
    });
    // The resumed role is already recorded and never re-dispatched by run().
    for (const event of ['dispatch', 'return', 'validate', 'record'] as const) {
      driver.advance('strategy-finance', { kind: event });
    }
    // chair is excluded from readiness even though it is still pending.
    expect(driver.state('chair')).toBe('pending');
    expect(driver.chairReady()).toBe(true);
  });
});
