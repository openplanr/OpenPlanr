import { type MissionDispatchBudgetSignal, runMissionDispatchFanOut } from './mission-dispatch.js';
import { OperateError, type OperatingRoleId } from './types.js';

/**
 * Deterministic advisor lifecycle driver (FR3, SPEC-005 T-003).
 *
 * SPEC-005 lost a full credentialed run because lifecycle correctness — result
 * transport, per-role completion handling, incremental recording, lease timing
 * and renewal, retry/timeout behaviour, and Chair readiness — lived in prose
 * delegated to the orchestrating language model. This module moves that
 * bookkeeping into an explicit, externally observable per-role state machine.
 *
 * It owns ONLY bookkeeping around the durable primitives T-002 already built. Its
 * only side-effecting calls are into T-002's `operateAdapterLifecycle`
 * `record`/`heartbeat` actions, injected here as `recordRole`/`heartbeat`. It
 * never re-implements lease or session persistence, and it never dispatches an
 * agent: runtime skills still perform the actual native-agent dispatch (passed in
 * as the `dispatch` callback), and the driver orchestrates the state around it —
 * bounded concurrency, per-role retry budgets, timeouts, automatic heartbeats,
 * cancellation, resume, and the `chairReady()` predicate.
 *
 * Lifecycle: `pending → running → returned → validating → recorded`, with terminal
 * alternatives `not_evaluated`, `failed`, `cancelled`. A stalled role retries
 * independently on its own budget; after its budget is exhausted the cycle
 * continues with an explicit `not_evaluated` role and a governed gap — never
 * blocking or cancelling siblings — unless that role is structurally required, in
 * which case it terminates `failed`.
 */

/**
 * The eight per-role lifecycle states. `advance` only ever moves a role between
 * these via a validated transition, so a role's state is ALWAYS exactly one of
 * them — there is no representable "unknown" or half-transitioned state.
 */
export type AdvisorLifecycleState =
  | 'pending'
  | 'running'
  | 'returned'
  | 'validating'
  | 'recorded'
  | 'not_evaluated'
  | 'failed'
  | 'cancelled';

/** The four terminal states; a role in any of them never transitions again. */
export const ADVISOR_LIFECYCLE_TERMINAL_STATES = Object.freeze([
  'recorded',
  'not_evaluated',
  'failed',
  'cancelled',
] as const);

export type AdvisorLifecycleTerminalState = (typeof ADVISOR_LIFECYCLE_TERMINAL_STATES)[number];

export function isAdvisorLifecycleTerminal(
  state: AdvisorLifecycleState,
): state is AdvisorLifecycleTerminalState {
  return (ADVISOR_LIFECYCLE_TERMINAL_STATES as readonly string[]).includes(state);
}

/**
 * A lifecycle transition event. The three terminal events (`fail`, `cancel`,
 * `not-evaluated`) carry a required `reason`, which becomes the role's
 * `statusReason` — the governed record that justifies the outcome. A role is
 * never rendered `not_evaluated`/`failed` without one (FR5).
 */
export type AdvisorLifecycleEvent =
  | { kind: 'dispatch' }
  | { kind: 'return' }
  | { kind: 'validate' }
  | { kind: 'record' }
  | { kind: 'retry'; reason: string }
  | { kind: 'fail'; reason: string }
  | { kind: 'cancel'; reason: string }
  | { kind: 'not-evaluated'; reason: string };

/**
 * The legal transition table. A `from` state maps to the events it accepts and
 * the `to` state each yields. Any (state, event) pair absent from this table is
 * an illegal transition and `advance` refuses it, which is what keeps the state
 * space closed to exactly the eight declared states.
 *
 * `retry` re-opens a role from `running`/`returned`/`validating` back to
 * `running`; the retry-budget accounting that decides WHETHER a retry is allowed
 * lives in the driver (`stall`), not in the table.
 */
const LIFECYCLE_TRANSITIONS: Readonly<
  Record<
    AdvisorLifecycleState,
    Partial<Record<AdvisorLifecycleEvent['kind'], AdvisorLifecycleState>>
  >
> = Object.freeze({
  pending: {
    dispatch: 'running',
    cancel: 'cancelled',
    fail: 'failed',
    'not-evaluated': 'not_evaluated',
  },
  running: {
    return: 'returned',
    retry: 'running',
    fail: 'failed',
    cancel: 'cancelled',
    'not-evaluated': 'not_evaluated',
  },
  returned: {
    validate: 'validating',
    retry: 'running',
    fail: 'failed',
    cancel: 'cancelled',
    'not-evaluated': 'not_evaluated',
  },
  validating: {
    record: 'recorded',
    retry: 'running',
    fail: 'failed',
    cancel: 'cancelled',
    'not-evaluated': 'not_evaluated',
  },
  // Terminal states accept no events.
  recorded: {},
  not_evaluated: {},
  failed: {},
  cancelled: {},
});

/**
 * A governed gap emitted when a structurally-optional role terminates without a
 * recorded analysis. It is NOT the full persisted `operating-data-gap` protocol
 * artifact (that is minted by the record/finalize path); it is the driver's
 * explicit, machine-readable statement that this perspective is missing and WHY,
 * so the Chair surfaces it as a gap rather than inventing the role's conclusions
 * (FR13) and `status`/`report` never render the role quietly (FR5).
 */
export interface AdvisorGovernedGap {
  roleId: OperatingRoleId;
  outcome: 'not_evaluated' | 'failed';
  reason: string;
}

/** A single prepared advisor role and its per-role policy. */
export interface AdvisorRolePlan {
  roleId: OperatingRoleId;
  /**
   * A structurally-required role's missing analysis is a hard gap the Chair
   * cannot synthesize around: on retry-budget exhaustion it terminates `failed`
   * (blocking chair readiness) rather than `not_evaluated`. A structurally
   * OPTIONAL role terminates `not_evaluated` with a governed gap and the cycle
   * continues. Defaults to optional.
   */
  structurallyRequired?: boolean;
  /**
   * Max INDEPENDENT re-dispatches after the first attempt. Exhausting it yields a
   * terminal `not_evaluated`/`failed`. Defaults to the driver's `retryBudget`.
   */
  retryBudget?: number;
  /**
   * Resume seeding (FR3): a role already recorded in a prior session starts
   * terminal `recorded` and is never re-dispatched. `not_evaluated`/`failed`/
   * `cancelled` seed the matching terminal.
   */
  initialState?: AdvisorLifecycleState;
  /** The governed statusReason to seed alongside a terminal `initialState`. */
  initialReason?: string;
}

/**
 * The outcome of T-002's `record` action, projected to exactly what the driver
 * needs. `recorded: true` with `notEvaluated` unset is a committed analysis;
 * `notEvaluated: true` is T-002 committing a governed quiet/zero-grounding result
 * (still durable, but a not-evaluated outcome). `leaseExpiresAtMs` carries the
 * lease forward from the record's refresh so the heartbeat scheduler stays in
 * step with the freshest window.
 */
export interface AdvisorRecordOutcome {
  recorded: boolean;
  notEvaluated?: boolean;
  statusReason?: string;
  leaseExpiresAtMs?: number;
}

/** The refreshed lease window returned by T-002's `heartbeat` action. */
export interface AdvisorLeaseSnapshot {
  leaseExpiresAtMs: number;
}

/** Injected timer handle; opaque so a test harness can queue and fire deterministically. */
export type LifecycleTimerHandle = unknown;

export interface AdvisorLifecycleDriverOptions {
  roles: readonly AdvisorRolePlan[];
  /**
   * Side-effecting: wraps `operateAdapterLifecycle({ action: 'record', ... })`.
   * The ONLY per-role side effect the driver performs — it never validates,
   * persists, or leases itself.
   */
  recordRole: (input: {
    roleId: OperatingRoleId;
    output: unknown;
  }) => Promise<AdvisorRecordOutcome>;
  /**
   * Side-effecting: wraps `operateAdapterLifecycle({ action: 'heartbeat', ... })`.
   * Called by the heartbeat scheduler to renew the cycle lease independent of any
   * role completing. Absent means heartbeats are disabled.
   */
  heartbeat?: () => Promise<AdvisorLeaseSnapshot>;
  /** Injected clock (ms epoch). Defaults to `Date.now`. */
  now?: () => number;
  /** Injected timer scheduler. Defaults to `setTimeout`/`clearTimeout`. */
  setTimer?: (fn: () => void, ms: number) => LifecycleTimerHandle;
  clearTimer?: (handle: LifecycleTimerHandle) => void;
  /** Current lease expiry (ms epoch); updated by every record/heartbeat outcome. */
  leaseExpiresAtMs?: number;
  /** Renew the lease when its remaining time drops to/below this. Defaults to 120_000ms. */
  heartbeatLeadMs?: number;
  /** Default per-role retry budget when a role plan omits its own. Defaults to 1. */
  retryBudget?: number;
  /** Bounded fan-out concurrency across dispatched roles. Absent/`<= 0` = unbounded. */
  concurrency?: number;
  /**
   * Per-attempt dispatch timeout (ms). A dispatch that has not returned within it
   * is treated as a stall (retried on budget, else terminal). Absent = no timeout.
   */
  roleTimeoutMs?: number;
}

/** An observability timeline entry recorded through the fan-out reporter. */
export interface AdvisorLifecycleTimelineEntry {
  roleId: OperatingRoleId;
  event: 'dispatch' | 'return' | 'error';
  at: number;
}

/** A per-role snapshot for `status`/`report` surfaces (FR5). */
export interface AdvisorRoleSnapshot {
  roleId: OperatingRoleId;
  state: AdvisorLifecycleState;
  attempts: number;
  retriesUsed: number;
  retryBudget: number;
  structurallyRequired: boolean;
  statusReason?: string;
}

/** The result of running the whole prepared board through the driver. */
export interface AdvisorLifecycleRunSummary {
  roles: AdvisorRoleSnapshot[];
  recorded: OperatingRoleId[];
  notEvaluated: OperatingRoleId[];
  failed: OperatingRoleId[];
  cancelled: OperatingRoleId[];
  gaps: AdvisorGovernedGap[];
  chairReady: boolean;
  heartbeats: number;
}

/**
 * A stall/timeout signal raised inside the driver's own dispatch wrapper. It is
 * caught by the retry loop and never escapes to a sibling — a stalled role's
 * failure is always converted to a governed terminal, so it cannot reject the
 * fan-out or cancel another lens.
 */
export class AdvisorRoleStalledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdvisorRoleStalledError';
  }
}

interface RoleRecord {
  plan: Required<Pick<AdvisorRolePlan, 'roleId'>> & {
    structurallyRequired: boolean;
    retryBudget: number;
  };
  state: AdvisorLifecycleState;
  attempts: number;
  retriesUsed: number;
  statusReason?: string;
}

export class AdvisorLifecycleDriver {
  private readonly roles = new Map<OperatingRoleId, RoleRecord>();
  private readonly order: OperatingRoleId[] = [];
  private readonly recordRole: AdvisorLifecycleDriverOptions['recordRole'];
  private readonly heartbeatFn?: () => Promise<AdvisorLeaseSnapshot>;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => LifecycleTimerHandle;
  private readonly clearTimer: (handle: LifecycleTimerHandle) => void;
  private readonly heartbeatLeadMs: number;
  private readonly concurrency?: number;
  private readonly roleTimeoutMs?: number;
  private leaseExpiresAtMs: number;
  private heartbeatCount = 0;
  private readonly timeline: AdvisorLifecycleTimelineEntry[] = [];
  private readonly gaps: AdvisorGovernedGap[] = [];

  constructor(options: AdvisorLifecycleDriverOptions) {
    this.recordRole = options.recordRole;
    this.heartbeatFn = options.heartbeat;
    this.now = options.now ?? Date.now;
    this.setTimer =
      options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as LifecycleTimerHandle);
    this.clearTimer =
      options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.heartbeatLeadMs = options.heartbeatLeadMs ?? 120_000;
    this.concurrency = options.concurrency;
    this.roleTimeoutMs = options.roleTimeoutMs;
    this.leaseExpiresAtMs = options.leaseExpiresAtMs ?? Number.POSITIVE_INFINITY;
    const defaultBudget = options.retryBudget ?? 1;
    for (const plan of options.roles) {
      if (this.roles.has(plan.roleId)) {
        throw new OperateError(
          'E_OPERATE_STATE_INVALID',
          `Advisor role ${plan.roleId} was prepared more than once.`,
        );
      }
      const initial = plan.initialState ?? 'pending';
      const record: RoleRecord = {
        plan: {
          roleId: plan.roleId,
          structurallyRequired: plan.structurallyRequired ?? false,
          retryBudget: Math.max(0, plan.retryBudget ?? defaultBudget),
        },
        state: initial,
        attempts: 0,
        retriesUsed: 0,
        statusReason: plan.initialReason,
      };
      // A resume-seeded terminal role (e.g. already `recorded`) surfaces its
      // governed gap so the Chair still sees a resumed not_evaluated perspective.
      if (isAdvisorLifecycleTerminal(initial) && initial !== 'recorded') {
        this.gaps.push({
          roleId: plan.roleId,
          outcome: initial === 'failed' ? 'failed' : 'not_evaluated',
          reason: plan.initialReason ?? `resumed as ${initial}`,
        });
      }
      this.roles.set(plan.roleId, record);
      this.order.push(plan.roleId);
    }
  }

  /** The current state of a prepared role. */
  state(roleId: OperatingRoleId): AdvisorLifecycleState {
    return this.require(roleId).state;
  }

  /** The governed statusReason recorded on a terminal `not_evaluated`/`failed`, if any. */
  statusReason(roleId: OperatingRoleId): string | undefined {
    return this.require(roleId).statusReason;
  }

  /**
   * Apply one validated lifecycle transition and return the new state. An illegal
   * (state, event) pair — anything absent from `LIFECYCLE_TRANSITIONS` — is
   * refused with `E_OPERATE_STATE_INVALID`, so a role can never reach a state
   * outside the declared eight, and a terminal role can never be re-opened.
   *
   * `retry` additionally consults the role's retry budget; a retry beyond budget
   * is refused here (the driver's `stall` decides retry-vs-terminate before ever
   * calling this).
   */
  advance(roleId: OperatingRoleId, event: AdvisorLifecycleEvent): AdvisorLifecycleState {
    const record = this.require(roleId);
    const next = LIFECYCLE_TRANSITIONS[record.state][event.kind];
    if (next === undefined) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Advisor role ${roleId} cannot ${event.kind} from ${record.state}.`,
        { roleId, from: record.state, event: event.kind },
      );
    }
    if (event.kind === 'retry') {
      if (record.retriesUsed >= record.plan.retryBudget) {
        throw new OperateError(
          'E_OPERATE_STATE_INVALID',
          `Advisor role ${roleId} exhausted its retry budget of ${record.plan.retryBudget}.`,
          { roleId, retriesUsed: record.retriesUsed, retryBudget: record.plan.retryBudget },
        );
      }
      record.retriesUsed += 1;
      record.attempts += 1;
      record.statusReason = event.reason;
    }
    if (event.kind === 'dispatch') {
      record.attempts += 1;
    }
    if (event.kind === 'fail' || event.kind === 'cancel' || event.kind === 'not-evaluated') {
      record.statusReason = event.reason;
    }
    record.state = next;
    return next;
  }

  /** Whether the given role still has retry budget for another independent attempt. */
  canRetry(roleId: OperatingRoleId): boolean {
    const record = this.require(roleId);
    return record.retriesUsed < record.plan.retryBudget;
  }

  /**
   * Resolve a stalled/failed attempt: retry independently while budget remains,
   * otherwise terminate. A structurally-required role terminates `failed`; an
   * optional role terminates `not_evaluated` with a governed gap and the cycle
   * continues. Returns the role's state after the decision (`running` on retry).
   * Never throws for a legitimately dispatched role and never touches a sibling.
   */
  stall(roleId: OperatingRoleId, reason: string): AdvisorLifecycleState {
    const record = this.require(roleId);
    if (this.canRetry(roleId)) {
      return this.advance(roleId, { kind: 'retry', reason });
    }
    if (record.plan.structurallyRequired) {
      this.advance(roleId, { kind: 'fail', reason });
      this.gaps.push({ roleId, outcome: 'failed', reason });
      return 'failed';
    }
    this.advance(roleId, { kind: 'not-evaluated', reason });
    this.gaps.push({ roleId, outcome: 'not_evaluated', reason });
    return 'not_evaluated';
  }

  /**
   * Drive ONE role's full lifecycle around a caller-supplied `dispatch` (the
   * runtime's native-agent launch — the driver never dispatches itself). Owns the
   * per-role retry loop, per-attempt timeout, immediate recording through T-002,
   * and terminal classification. It resolves to the role's terminal state and
   * NEVER rejects: a stall or hard failure becomes a governed terminal, so a
   * sibling's fan-out slot is never rejected or cancelled by this role (FR3).
   */
  async executeRole(
    roleId: OperatingRoleId,
    dispatch: (signal: MissionDispatchBudgetSignal) => Promise<unknown>,
    signal: MissionDispatchBudgetSignal,
  ): Promise<AdvisorLifecycleState> {
    const record = this.require(roleId);
    if (isAdvisorLifecycleTerminal(record.state)) {
      // Resume: an already-terminal role (e.g. recorded in a prior session) is not
      // re-dispatched — resume recovers recorded work without re-running it (FR2).
      return record.state;
    }
    this.advance(roleId, { kind: 'dispatch' });
    for (;;) {
      try {
        const output = await this.withTimeout(dispatch(signal), roleId);
        this.advance(roleId, { kind: 'return' });
        this.advance(roleId, { kind: 'validate' });
        const outcome = await this.recordRole({ roleId, output });
        this.updateLease(outcome.leaseExpiresAtMs);
        if (outcome.recorded && !outcome.notEvaluated) {
          this.advance(roleId, { kind: 'record' });
          return 'recorded';
        }
        // T-002 durably committed a governed quiet/zero-grounding result. That is a
        // TERMINAL not_evaluated outcome, not a stall — do not consume retry budget.
        const reason = outcome.statusReason ?? 'recorded result grounded no resolvable evidence';
        this.advance(roleId, { kind: 'not-evaluated', reason });
        this.gaps.push({ roleId, outcome: 'not_evaluated', reason });
        return 'not_evaluated';
      } catch (error) {
        const reason = stallReason(error);
        const state = this.stall(roleId, reason);
        if (state === 'running') continue; // retried independently on its own budget
        return state; // terminal not_evaluated/failed — siblings are untouched
      }
    }
  }

  /**
   * Fan the prepared, non-terminal roles out through the shared bounded-concurrency
   * primitive, driving each through `executeRole`. Already-terminal (resumed) roles
   * are skipped. The fan-out's new lifecycle reporter records an observability
   * timeline through the driver without owning any state transition — `executeRole`
   * remains the single source of truth for the state machine.
   */
  async run(input: {
    parallel: boolean;
    dispatch: (roleId: OperatingRoleId, signal: MissionDispatchBudgetSignal) => Promise<unknown>;
    perRoleBudgetMs?: number;
  }): Promise<AdvisorLifecycleRunSummary> {
    const items = this.order.filter((roleId) => !isAdvisorLifecycleTerminal(this.state(roleId)));
    await runMissionDispatchFanOut<OperatingRoleId, AdvisorLifecycleState>({
      items,
      parallel: input.parallel,
      ...(this.concurrency !== undefined ? { concurrency: this.concurrency } : {}),
      ...(input.perRoleBudgetMs !== undefined ? { perRoleBudgetMs: input.perRoleBudgetMs } : {}),
      now: this.now,
      lifecycle: {
        onDispatch: (roleId) => this.recordTimeline(roleId, 'dispatch'),
        onReturn: (roleId) => this.recordTimeline(roleId, 'return'),
        onError: (roleId) => this.recordTimeline(roleId, 'error'),
      },
      run: (roleId, signal) => this.executeRole(roleId, (s) => input.dispatch(roleId, s), signal),
    });
    return this.summary();
  }

  /**
   * True once every non-structurally-required role has reached a terminal state,
   * without requiring a structurally-optional role to have RECORDED — a governed
   * `not_evaluated` optional role satisfies readiness because the Chair surfaces
   * it as a gap (FR13). Structurally-required roles must reach `recorded`
   * specifically: their missing analysis is a hard gap the Chair cannot synthesize
   * around, so a required role that is `failed`/`not_evaluated`/`cancelled` — or
   * still in flight — holds Chair readiness closed. The `chair` role itself is
   * dispatched separately and is excluded here.
   */
  chairReady(): boolean {
    for (const roleId of this.order) {
      if (roleId === 'chair') continue;
      const record = this.require(roleId);
      if (record.plan.structurallyRequired) {
        if (record.state !== 'recorded') return false;
      } else if (!isAdvisorLifecycleTerminal(record.state)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Schedule automatic lease heartbeats independent of any role completing (FR2).
   * Every `intervalMs` (injected timer) the scheduler checks the lease's remaining
   * time against `heartbeatLeadMs`; when the window is approaching it renews
   * through T-002's `heartbeat` action and carries the refreshed expiry forward.
   * Returns a cancel function; the scheduler also stops on its own once every role
   * is terminal (nothing left to keep alive). A slow lens can therefore hold the
   * session open while siblings keep their recorded work, without raising the
   * configured lease duration.
   */
  scheduleHeartbeat(intervalMs: number): () => void {
    if (!this.heartbeatFn) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        'Heartbeat scheduling requires a heartbeat action; none was injected.',
      );
    }
    let cancelled = false;
    let handle: LifecycleTimerHandle | null = null;
    const stop = (): void => {
      cancelled = true;
      if (handle !== null) this.clearTimer(handle);
    };
    const tick = async (): Promise<void> => {
      if (cancelled) return;
      if (this.allRolesTerminal()) {
        stop();
        return;
      }
      const remaining = this.leaseExpiresAtMs - this.now();
      if (remaining <= this.heartbeatLeadMs) {
        const snapshot = await (this.heartbeatFn as () => Promise<AdvisorLeaseSnapshot>)();
        this.updateLease(snapshot.leaseExpiresAtMs);
        this.heartbeatCount += 1;
      }
      if (!cancelled) handle = this.setTimer(() => void tick(), intervalMs);
    };
    handle = this.setTimer(() => void tick(), intervalMs);
    return stop;
  }

  /** How many heartbeats the scheduler has issued so far (observability/tests). */
  heartbeatsIssued(): number {
    return this.heartbeatCount;
  }

  /** The current lease expiry (ms epoch) the driver is tracking. */
  leaseExpiry(): number {
    return this.leaseExpiresAtMs;
  }

  /** Governed gaps for roles that terminated without a recorded analysis (FR13). */
  governedGaps(): AdvisorGovernedGap[] {
    return [...this.gaps];
  }

  /** The observability timeline recorded through the fan-out reporter. */
  dispatchTimeline(): AdvisorLifecycleTimelineEntry[] {
    return [...this.timeline];
  }

  /** A per-role snapshot in prepared order for `status`/`report` (FR5). */
  snapshot(): AdvisorRoleSnapshot[] {
    return this.order.map((roleId) => {
      const record = this.require(roleId);
      return {
        roleId,
        state: record.state,
        attempts: record.attempts,
        retriesUsed: record.retriesUsed,
        retryBudget: record.plan.retryBudget,
        structurallyRequired: record.plan.structurallyRequired,
        ...(record.statusReason ? { statusReason: record.statusReason } : {}),
      };
    });
  }

  /**
   * Cancel every still-in-flight role (bookkeeping only — the session cancel is
   * the caller's concern). Already-terminal roles are left untouched, so a
   * mid-cycle cancel preserves recorded work.
   */
  cancelInFlight(reason: string): void {
    for (const roleId of this.order) {
      const record = this.require(roleId);
      if (!isAdvisorLifecycleTerminal(record.state)) {
        this.advance(roleId, { kind: 'cancel', reason });
      }
    }
  }

  private summary(): AdvisorLifecycleRunSummary {
    const collect = (state: AdvisorLifecycleState): OperatingRoleId[] =>
      this.order.filter((roleId) => roleId !== 'chair' && this.state(roleId) === state);
    return {
      roles: this.snapshot(),
      recorded: collect('recorded'),
      notEvaluated: collect('not_evaluated'),
      failed: collect('failed'),
      cancelled: collect('cancelled'),
      gaps: this.governedGaps(),
      chairReady: this.chairReady(),
      heartbeats: this.heartbeatCount,
    };
  }

  private allRolesTerminal(): boolean {
    return this.order.every((roleId) => isAdvisorLifecycleTerminal(this.state(roleId)));
  }

  private recordTimeline(roleId: OperatingRoleId, event: 'dispatch' | 'return' | 'error'): void {
    this.timeline.push({ roleId, event, at: this.now() });
  }

  private updateLease(expiresAtMs: number | undefined): void {
    if (expiresAtMs !== undefined && Number.isFinite(expiresAtMs)) {
      this.leaseExpiresAtMs = expiresAtMs;
    }
  }

  private require(roleId: OperatingRoleId): RoleRecord {
    const record = this.roles.get(roleId);
    if (!record) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Advisor role ${roleId} was not prepared by this driver.`,
        { roleId },
      );
    }
    return record;
  }

  /**
   * Race a role's dispatch against its per-attempt timeout using the INJECTED
   * timer, so timeout behaviour is deterministic under a test clock and never a
   * wall-clock sleep. With no configured timeout the dispatch promise is returned
   * as-is. A fired timeout rejects with `AdvisorRoleStalledError`, which the retry
   * loop converts to a governed retry or terminal — it never escapes to a sibling.
   */
  private withTimeout<T>(promise: Promise<T>, roleId: OperatingRoleId): Promise<T> {
    const timeoutMs = this.roleTimeoutMs;
    if (!timeoutMs || timeoutMs <= 0) return promise;
    return new Promise<T>((resolve, reject) => {
      const handle = this.setTimer(() => {
        reject(
          new AdvisorRoleStalledError(
            `Advisor role ${roleId} did not return within its ${timeoutMs}ms attempt budget.`,
          ),
        );
      }, timeoutMs);
      promise.then(
        (value) => {
          this.clearTimer(handle);
          resolve(value);
        },
        (error: unknown) => {
          this.clearTimer(handle);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }
}

function stallReason(error: unknown): string {
  if (error instanceof AdvisorRoleStalledError) return error.message;
  if (error instanceof OperateError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}
