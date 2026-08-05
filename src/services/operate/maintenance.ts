import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  type AgentNativeAdvisorResponse,
  advisorResponseContractDetails,
  assertAdvisorOutputMatchesBrief,
  attachMandateResponseContract,
  buildOperatingMandate,
  collectAdvisorResponseContractIssues,
  createNativeMissionOperatingRoleResult,
  createRegistryReconciledAdvisorBrief,
  DEFAULT_OPERATING_ROLE_RESEARCH_BUDGET_MS,
  type OperatingMandate,
} from './advisors.js';
import { canonicalDigest, canonicalize, sha256Digest } from './canonical.js';
import { citationComponentsFromWorkspace } from './citation-resolution.js';
import { operatingProjectKey, readOperatingAdapterLeaseDurationMs } from './config.js';
import { buildOperatingBootstrapMap } from './context-research.js';
import { gateRecordedProposalCitations } from './engine.js';
import { OperatingEventStore, toPersistedDataGap } from './event-store.js';
import { OperatingEvidenceCache } from './evidence-cache.js';
import { guidedSessionStatus, purgeGuidedSessions } from './interaction/session-service.js';
import { assertCommittedOperatingView, recoverOperatingTransactions } from './journal.js';
import { withOperatingLock } from './lock-service.js';
import { assertOperatingArtifact, loadOperatingProtocol } from './protocol.js';
import {
  containsSecret,
  hardBlockedSecretDetections,
  redactSensitiveText,
  type SecretDetectionMetadata,
} from './redaction.js';
import { cleanOperatingScratch, listAbandonedOperatingScratch } from './scratch.js';
import {
  OPERATE_MISSION_PROTOCOL_VERSION,
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  OperateError,
  type OperatingAdapterHandoff,
  type OperatingAdvisorBrief,
  type OperatingDataGap,
  type OperatingEvidence,
  type OperatingRecoveryRecord,
  type OperatingRoleId,
  type OperatingRoleResult,
  type OperatingSensitivity,
} from './types.js';
import {
  readOperatingConfig,
  readOperatingWorkspaceRoots,
  refreshOperatingWorkspaceManifest,
  resolveContainedPath,
  resolveOperatingPaths,
} from './workspace.js';

interface PrivateAdvisorSession {
  implementation: 'openplanr-operate-adapter' | 'openplanr-operate-harness';
  // FR4: the committed event-chain genesis hash of the board that owns this
  // machine-local session. Two successive board generations at the same project
  // path re-genesis the event chain, so a session from a superseded generation
  // never matches (or collides with) the current board. Legacy sessions written
  // before this field are normalized to '' on read and treated as superseded.
  boardIdentity: string;
  cycleId: string;
  evidenceDigest: string;
  phase: 'advisors' | 'chair';
  runtime: string;
  protocolVersion?: '1.3.0' | '1.4.0';
  pinnedRevision?: string;
  lease: string;
  idempotencyKey: string;
  state: 'prepared' | 'recording' | 'finalized' | 'cancelled';
  expiresAt: string;
  roles: string[];
  recordedRoles: string[];
  // SPEC-005 T-020 (FR13): roles governed terminal `not_evaluated` because a
  // dispatched lens never returned — a runtime `harness abandon` (lease-bound) or
  // an operator escape after the lease lapsed. Keyed roleId → governed reason. A
  // not-evaluated role is terminal (like recorded): it no longer blocks finalize
  // and never carries a pending record action. Absent on healthy sessions, so an
  // existing session file stays byte-identical.
  notEvaluatedRoles?: Record<string, string>;
  roleInputDigests: Record<string, `sha256:${string}`>;
  roleBriefs: Record<string, OperatingAdvisorBrief>;
  roleMandates: Record<string, OperatingMandate>;
}

function adapterSessionSummary(
  session: PrivateAdvisorSession,
): Omit<PrivateAdvisorSession, 'roleBriefs' | 'roleMandates'> {
  const { roleBriefs: _roleBriefs, roleMandates: _roleMandates, ...summary } = session;
  return summary;
}

/**
 * The response-facing `session` view every harness handoff embeds (FR2 / DevEx
 * T4). It is the machine-local session summary (heavy `roleBriefs`/`roleMandates`
 * stripped) plus `leaseTtlSeconds` — the size of ONE lease window in whole
 * seconds. Together with `session.expiresAt` (the absolute deadline) this lets a
 * caller schedule heartbeats against a real deadline: renew before `expiresAt`,
 * and know each renew/record buys another `leaseTtlSeconds`. Surfaced identically
 * on `prepare`, `record`, `heartbeat`, and `resume` so no handoff kind leaves the
 * lease window invisible.
 */
function sessionView(
  session: PrivateAdvisorSession,
  leaseDurationMs: number,
): Omit<PrivateAdvisorSession, 'roleBriefs' | 'roleMandates'> & { leaseTtlSeconds: number } {
  return {
    ...adapterSessionSummary(session),
    leaseTtlSeconds: Math.floor(leaseDurationMs / 1_000),
  };
}

async function adapterHandoff(session: PrivateAdvisorSession): Promise<OperatingAdapterHandoff> {
  const recorded = new Set(session.recordedRoles);
  const notEvaluated = session.notEvaluatedRoles ?? {};
  // T-020: a role is terminal once it has recorded a result OR was governed
  // terminal `not-evaluated`. Only in-flight (pending) roles keep the board in
  // `record-required`; an all-terminal board is `finalize-required`, exactly the
  // T-001 wire contract the pipeline handoff validator enforces.
  const isTerminal = (role: string): boolean => recorded.has(role) || role in notEvaluated;
  const state: OperatingAdapterHandoff['state'] =
    session.state === 'cancelled'
      ? 'cancelled'
      : session.state === 'finalized'
        ? 'continue-required'
        : session.roles.some((role) => !isTerminal(role))
          ? 'record-required'
          : 'finalize-required';
  const protocol = await loadOperatingProtocol();
  const handoff = protocol.createOperatingAdapterHandoff({
    protocolVersion: session.protocolVersion ?? '1.3.0',
    phase: session.phase,
    state,
    cycleId: session.cycleId,
    evidenceDigest: session.evidenceDigest,
    runtime: session.runtime,
    idempotencyKey: session.idempotencyKey,
    lease: session.lease,
    expiresAt: session.expiresAt,
    roles: session.roles.map((role) => ({
      roleId: role,
      status: recorded.has(role) ? 'recorded' : role in notEvaluated ? 'not-evaluated' : 'pending',
      // A governed not-evaluated role carries its reason through the handoff;
      // recorded/pending roles omit the field so existing roles stay byte-identical.
      ...(role in notEvaluated ? { statusReason: notEvaluated[role] } : {}),
      inputDigest: session.roleInputDigests[role],
    })),
  });
  return protocol.validateOperatingAdapterHandoffBindings(handoff);
}

function adapterPhase(roles: readonly string[]): 'advisors' | 'chair' {
  return roles.length === 1 && roles[0] === 'chair' ? 'chair' : 'advisors';
}

function sameRoleSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((role, index) => role === [...right].sort()[index])
  );
}

function sessionExpired(session: PrivateAdvisorSession, nowMs: number = Date.now()): boolean {
  return Date.parse(session.expiresAt) <= nowMs;
}

/**
 * FR4: the board's identity is the hash of its event-chain genesis event (the
 * event whose `previousEventHash` is null). It is immutable for a board
 * generation — appending events never rewrites the genesis — and a board
 * re-inited at the same path re-genesises the chain, so the identity changes.
 * Machine-local adapter sessions are bound to it so a session from a superseded
 * generation is never matched or reused by the current board. Returns '' when
 * no committed chain exists yet, or if the chain cannot be read/verified (that
 * failure is surfaced by the dedicated event-replay diagnostics, not here).
 */
async function committedBoardIdentity(store: OperatingEventStore): Promise<string> {
  try {
    const { events } = await store.replay();
    const genesis = events.find((event) => event.previousEventHash === null) ?? events[0];
    return genesis?.eventHash ?? '';
  } catch {
    return '';
  }
}

async function removeMachineLocalCacheDir(target: string): Promise<number> {
  const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
  const removed = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).length;
  await rm(target, { recursive: true, force: true });
  return removed;
}

/**
 * FR4: purge the board's machine-local advisor sessions (`<localRoot>/advisors/`)
 * and incremental evidence baselines (`<localRoot>/evidence/incremental/`). A
 * committed `operate init` apply calls this so a board re-inited at the same path
 * never inherits a prior generation's sessions or cached baselines, and
 * `operate cache purge` calls it so the doctor's staleness diagnostics have a
 * scoped fix command. Both surfaces are rebuildable machine-local caches, never
 * committed protocol artifacts.
 */
export async function purgeBoardMachineLocalCaches(input: {
  projectRoot: string;
  localRoot?: string;
}): Promise<{ removedAdvisorSessions: number; removedIncrementalBaselines: number }> {
  const paths = resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot });
  const removedAdvisorSessions = await removeMachineLocalCacheDir(paths.advisors);
  const removedIncrementalBaselines = await removeMachineLocalCacheDir(
    path.join(paths.evidence, 'incremental'),
  );
  return { removedAdvisorSessions, removedIncrementalBaselines };
}

/**
 * FR7 (T-006): sibling machine-local cleanup for OpenPlanr-owned scratch left
 * behind by a session that never finalized. Deliberately NOT folded into
 * `purgeBoardMachineLocalCaches` — scratch has its own narrower per-cycle
 * lifecycle. Removes ONLY scratch a valid `openplanr-operate-scratch` manifest
 * confirms this project wrote and whose lease window has lapsed; it never touches
 * an unowned file found under the scratch root, nor any other machine-local
 * cache. This is the owned-only removal the doctor's abandoned-scratch diagnostic
 * points at, and the sibling `operate cache purge` invokes.
 */
export async function purgeAbandonedOperatingScratch(input: {
  projectRoot: string;
  localRoot?: string;
  now?: () => Date;
}): Promise<{ removed: number; cycles: string[] }> {
  const paths = resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot });
  const abandoned = await listAbandonedOperatingScratch(paths, input.now ? { now: input.now } : {});
  let removed = 0;
  const cycles: string[] = [];
  for (const entry of abandoned) {
    const result = await cleanOperatingScratch(paths, entry.cycleId);
    removed += result.removed;
    cycles.push(entry.cycleId);
  }
  return { removed, cycles: cycles.sort() };
}

/**
 * Surface the adapter session lease ergonomically (FR10 / T-008): the absolute
 * `expiresAt` plus the remaining time relative to the resolved clock. Included in
 * every adapter lifecycle response so a native runtime can see, at a glance, how
 * long its prepared session is still valid and when it must resume or re-run —
 * rather than parsing `expiresAt` against wall-clock itself. `remainingMs` is
 * floored at zero so an already-lapsed lease reads as `expired`, never negative.
 */
function adapterLeaseStatus(
  session: Pick<PrivateAdvisorSession, 'expiresAt'>,
  nowMs: number,
): {
  expiresAt: string;
  remainingMs: number;
  remainingSeconds: number;
  expired: boolean;
} {
  const remainingMs = Math.max(0, Date.parse(session.expiresAt) - nowMs);
  return {
    expiresAt: session.expiresAt,
    remainingMs,
    remainingSeconds: Math.floor(remainingMs / 1_000),
    expired: remainingMs <= 0,
  };
}

function retryRunCommand(session: Pick<PrivateAdvisorSession, 'cycleId' | 'runtime'>): string {
  return `planr operate run --cycle-id ${session.cycleId} --runtime ${session.runtime} --json`;
}

/**
 * The command that actually escapes a blocked second binding.
 *
 * A prepare rejected because another session is still open used to be handed
 * `planr operate run …` as its recovery — but that command's prepare
 * continuation re-enters this same branch and returns the identical error with
 * the identical suggestion. An agent following the CLI's own guidance loops
 * forever. The way out is to close the OPEN session, so that is what is named.
 *
 * The open session's lease is deliberately NOT interpolated: it belongs to the
 * holder of that session, and echoing a live credential into an error payload a
 * different caller receives would leak it. The placeholder says where it comes
 * from instead.
 */
function closeOpenSessionCommand(
  session: Pick<PrivateAdvisorSession, 'cycleId'>,
  action: 'finalize' | 'cancel' = 'cancel',
): string {
  return (
    `planr operate harness ${action} --cycle-id ${session.cycleId} ` +
    '--evidence-digest <open-session-evidence-digest> --lease <open-session-lease> ' +
    '--idempotency-key <open-session-idempotency-key> --json'
  );
}

async function atomicPrivateWrite(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${canonicalize(value)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

async function atomicBytesWrite(target: string, value: Buffer | string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, target);
}

// FR1 (SPEC-005 T-002): `harness record` and `harness heartbeat` both mutate ONE
// shared, lease-bound session file. T-001 widened the handoff so every pending
// role is authorized to record the instant it returns; that removed the batch
// barrier but, on the write side, two records returning together would each read
// the same `recordedRoles` snapshot and — last writer wins — silently drop the
// other already-recorded role. That trades lost-work-from-a-barrier for a
// nondeterministic lost-work-from-a-race, which is worse. T-001 states plainly
// that this handoff "never schedules concurrent session writes", so preventing
// the race is a write-side property owned here: serialize the session write per
// cycle and re-read the freshest snapshot inside the critical section before
// merging. The in-process chain serializes async writers in this process; the
// O_EXCL lockfile serializes concurrently spawned `planr operate harness record`
// processes. The per-role result file (`<cycle>.<role>.json`) is the durable
// cross-process record — re-adopted on prepare/resume — so a stolen stale lock
// never loses committed work.
const sessionCommitTails = new Map<string, Promise<void>>();

async function withInProcessSessionLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = sessionCommitTails.get(key) ?? Promise.resolve();
  let openGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  // `tail` resolves (never rejects) only once our gate opens, so the next writer
  // in the chain waits for us regardless of whether our operation threw.
  const tail = previous.then(() => gate);
  sessionCommitTails.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    openGate();
    if (sessionCommitTails.get(key) === tail) sessionCommitTails.delete(key);
  }
}

async function withCrossProcessSessionLock<T>(
  sessionPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = `${sessionPath}.commit.lock`;
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 10_000;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (;;) {
    try {
      handle = await open(lockPath, 'wx', 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Steal only a demonstrably abandoned lock (a crashed record process must
      // never deadlock the session). The per-role result files own committed
      // work, so stealing this mutex risks nothing durable.
      const age = await stat(lockPath)
        .then((info) => Date.now() - info.mtimeMs)
        .catch(() => 0);
      if (age > 30_000) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() > deadline) {
        throw new OperateError(
          'E_OPERATE_STATE_INVALID',
          'Timed out serializing the adapter session write.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  }
}

/**
 * Apply a mutation to the shared adapter session under the cross-process lock,
 * re-reading the freshest on-disk snapshot first so a sibling record committed
 * between the caller's snapshot and now is merged forward rather than clobbered
 * (FR1). The lease/idempotency binding and a recordable (`prepared`/`recording`)
 * state are re-asserted inside the critical section, so a concurrent cancel or
 * expiry cannot be silently overwritten. Callers must already hold the
 * in-process session lock for the same `target`.
 */
async function commitSessionWrite(
  target: string,
  input: {
    projectRoot: string;
    cycleId: string;
    localRoot?: string;
    lease: string;
    idempotencyKey: string;
    evidenceDigest?: string;
    nowMs: number;
    apply: (current: PrivateAdvisorSession) => PrivateAdvisorSession;
  },
): Promise<PrivateAdvisorSession> {
  return withCrossProcessSessionLock(target, async () => {
    const current = await readAdapterSession(
      input.projectRoot,
      input.cycleId,
      input.localRoot,
      input.nowMs,
    );
    assertAdapterBinding(current, input.lease, input.idempotencyKey, input.evidenceDigest);
    if (!['prepared', 'recording'].includes(current.state)) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Adapter session is ${current.state}; its lease-bound write is no longer valid.`,
        { recoveryCommand: retryRunCommand(current) },
      );
    }
    const next = input.apply(current);
    await atomicPrivateWrite(target, next);
    return next;
  });
}

/**
 * FR4/FR5: commit a just-recorded role's canonical `advisory.recorded` event and
 * materialize the readable partial projection immediately, so `planr operate
 * report`/`status` and `.planr/operate/cycles/<id>/` reflect every validated
 * lens BEFORE Chair runs — not only at finalize. The commit is idempotent (a
 * role already committed by a prior record or a finalize reconciliation is
 * skipped; a different digest for the same role is the same isolation error
 * finalize raises) and best-effort under concurrency: if another writer holds the
 * project lock or advanced the event head between replay and append, the role's
 * validated result is already durable in its machine-local file and session
 * entry, and finalize reconciles the canonical event, so the record defers rather
 * than fails.
 */
async function materializeRecordedRole(input: {
  projectRoot: string;
  localRoot?: string;
  cycleId: string;
  session: PrivateAdvisorSession;
  result: OperatingRoleResult;
  advisorReport: Record<string, unknown> | null;
}): Promise<void> {
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  try {
    const alreadyCommitted = new Map(
      (await readPersistedOperatingRoleResults(store, input.cycleId)).map((result) => [
        result.roleId,
        result,
      ]),
    );
    const prior = alreadyCommitted.get(input.result.roleId);
    if (prior) {
      if (prior.resultDigest !== input.result.resultDigest) {
        throw new OperateError(
          'E_OPERATE_ADVISOR_ISOLATION',
          `Cycle ${input.cycleId} already committed a different ${input.result.roleId} result.`,
        );
      }
    } else {
      const initial = await store.replay();
      await withOperatingLock(
        input.projectRoot,
        {
          projectKey: operatingProjectKey(input.projectRoot),
          expectedEventHead: initial.eventHead,
          currentEventHead: initial.eventHead,
          localRoot: input.localRoot,
        },
        async (lock) => {
          // Re-check under the lock: a concurrent writer may have committed this
          // role between our replay and lock acquisition.
          const committed = new Map(
            (await readPersistedOperatingRoleResults(store, input.cycleId)).map((result) => [
              result.roleId,
              result,
            ]),
          );
          if (committed.has(input.result.roleId)) return;
          const record = await store.putRecord(
            'advisor-result',
            input.result as unknown as Record<string, unknown>,
            { correlationId: input.session.idempotencyKey },
          );
          const advisorReportRecord =
            input.session.protocolVersion === '1.4.0' && input.advisorReport
              ? await store.putRecord('advisor-report', input.advisorReport, {
                  correlationId: input.session.idempotencyKey,
                })
              : null;
          const runtimeBinding = (await adapterHandoff(input.session)).binding;
          const event = await store.append({
            type: 'advisory.recorded',
            cycleId: input.cycleId,
            entityId: `${input.cycleId}-${input.result.roleId}`,
            correlationId: input.session.idempotencyKey,
            evidenceRefs: input.result.proposals.flatMap((proposal) => proposal.evidenceRefs),
            payload: {
              recordDigest: record.digest,
              ...(advisorReportRecord ? { advisorReportDigest: advisorReportRecord.digest } : {}),
              roleId: input.result.roleId,
              runtimeBinding: {
                runtime: runtimeBinding.runtime,
                runtimeBinding: runtimeBinding.runtimeBinding,
                crossRuntimeFallback: runtimeBinding.crossRuntimeFallback,
                executionMode: runtimeBinding.executionMode,
                assurance: runtimeBinding.assurance,
                toolIsolation: runtimeBinding.toolIsolation,
              },
            },
            ...(input.session.protocolVersion === '1.4.0'
              ? { protocolVersion: '1.4.0' as const }
              : {}),
            expectedHead: initial.eventHead.hash,
            actor: { kind: 'runtime', id: 'operate-adapter' },
          });
          await lock.advanceEventHead(initial.eventHead, {
            sequence: event.sequence,
            hash: event.eventHash,
          });
          await store.writeCheckpoint(await store.state());
        },
      );
    }
    // Refresh the readable projection from the freshest committed state so the
    // recorded lens' Markdown lands under `.planr/operate/cycles/<id>/` at once.
    const { persistOperatingProjections } = await import('./projection-persistence.js');
    await persistOperatingProjections({
      projectRoot: input.projectRoot,
      localRoot: input.localRoot,
      state: await store.state(),
      revalidateEventHead: async () => (await store.replay()).eventHead,
    });
  } catch (error) {
    if (
      error instanceof OperateError &&
      ['E_OPERATE_CYCLE_ACTIVE', 'E_OPERATE_ROUTE_DRIFT'].includes(error.code)
    ) {
      // A concurrent writer holds the project lock or advanced the head between
      // our replay and commit. The validated result is already durable in its
      // machine-local file and session entry; finalize reconciles the canonical
      // event idempotently. Defer rather than fail the record.
      return;
    }
    throw error;
  }
}

function maximumOperatingOrdinal(
  records: ReadonlyArray<Record<string, unknown>>,
  prefix: string,
): number {
  return records.reduce((maximum, record) => {
    const match = String(record.id ?? '').match(new RegExp(`^${prefix}-(\\d+)$`));
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0);
}

/**
 * SPEC-005 T-019 — persist the citation gate's governed gaps on the agent-native
 * adapter-lifecycle `record` path, exactly as the inline consolidation loop
 * (`engine.ts`) persists its dispatch gaps.
 *
 * A lens whose every proposal is citation-rejected records a schema-legal `quiet`
 * result; the `unresolvable-citation` / `missing-evidence` gaps that record WHY it
 * grounded nothing were previously only echoed transiently in the record response
 * (`citationGaps`) and never reached the event store. So the Chair board —
 * assembled by a later `run` continuation, after this role is already recorded and
 * is never re-dispatched — saw no citation signal in committed state and rendered
 * the lens a false-clean `recorded-quiet` (reason `null`, gapId `null`): the exact
 * dishonest surface SPEC-005 exists to eliminate, on the path real runtimes use.
 * Persisting the governed gap here makes it durable, readable back from the event
 * store, and reconstructible into the `citation-rejected` classification at
 * consolidation (see `engine.ts`).
 *
 * This reuses T-017's landed `toPersistedDataGap` v1.2 projection verbatim — the
 * SAME projection the inline path relies on (category/citations dropped, canonical
 * `GAP-NNN` id) — so the gap validates against the append log / `operating-record`
 * schemas instead of throwing `E_OPERATE_STATE_INVALID` (`$ matched 0/11
 * branches`). It is NOT a second, forked persistence path; it carries T-017's
 * signal across the record→consolidation boundary the inline path never crosses.
 *
 * Idempotent: the citation gate names every gap it opens for a role in that gap's
 * `affectedRoles`, so a role already gap-named in committed state is a no-op —
 * a resume, retry, or idempotent re-record never mints a duplicate under a fresh
 * `GAP-NNN` id.
 */
async function persistRecordedRoleGaps(input: {
  projectRoot: string;
  localRoot?: string;
  cycleId: string;
  roleId: string;
  gaps: OperatingDataGap[];
  correlationId: string;
}): Promise<void> {
  if (input.gaps.length === 0) return;
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const namesRole = (gap: Record<string, unknown>): boolean =>
    (gap.cycleId === undefined || gap.cycleId === input.cycleId) &&
    Array.isArray(gap.affectedRoles) &&
    (gap.affectedRoles as unknown[]).includes(input.roleId);
  if ((await store.state()).dataGaps.some(namesRole)) return;
  try {
    const initial = await store.replay();
    await withOperatingLock(
      input.projectRoot,
      {
        projectKey: operatingProjectKey(input.projectRoot),
        expectedEventHead: initial.eventHead,
        currentEventHead: initial.eventHead,
        localRoot: input.localRoot,
      },
      async (lock) => {
        // Re-check under the lock: a concurrent writer may have persisted this
        // role's gaps between our replay and lock acquisition.
        const current = await store.state();
        if (current.dataGaps.some(namesRole)) return;
        let head = initial.eventHead;
        let gapOrdinal = maximumOperatingOrdinal(current.dataGaps, 'GAP');
        for (const rawGap of input.gaps) {
          const gap = toPersistedDataGap(
            rawGap as unknown as Record<string, unknown>,
            () => `GAP-${String(++gapOrdinal).padStart(3, '0')}`,
          ) as unknown as OperatingDataGap;
          await assertOperatingArtifact('operating-data-gap', gap);
          await store.putRecord(
            'data-gap',
            structuredClone(gap) as unknown as Record<string, unknown>,
            { correlationId: input.correlationId },
          );
          const event = await store.append({
            type: 'gap.open',
            cycleId: input.cycleId,
            entityId: gap.id,
            correlationId: input.correlationId,
            evidenceRefs: gap.evidenceRefs,
            payload: { record: gap },
            expectedHead: head.hash,
            actor: { kind: 'runtime', id: 'operate-adapter' },
          });
          const next = { sequence: event.sequence, hash: event.eventHash };
          await lock.advanceEventHead(head, next);
          head = next;
        }
        await store.writeCheckpoint(await store.state());
      },
    );
  } catch (error) {
    if (
      error instanceof OperateError &&
      ['E_OPERATE_CYCLE_ACTIVE', 'E_OPERATE_ROUTE_DRIFT'].includes(error.code)
    ) {
      // A concurrent writer holds the project lock or advanced the head between our
      // replay and commit. The governed gap is idempotent and content-addressed;
      // the next record/finalize reconciles it. Defer rather than fail the record.
      return;
    }
    throw error;
  }
  const { persistOperatingProjections } = await import('./projection-persistence.js');
  await persistOperatingProjections({
    projectRoot: input.projectRoot,
    localRoot: input.localRoot,
    state: await store.state(),
    revalidateEventHead: async () => (await store.replay()).eventHead,
  });
}

/**
 * SPEC-005 T-020 (FR13): the governed gap recording a lens terminal
 * `not_evaluated` because it was dispatched but never returned a result — a true
 * stall on the agent-native adapter-lifecycle path, distinct from T-019's
 * citation-rejected case (a lens that DID return a result grounding zero
 * evidence). Shaped `missing-evidence` in memory so `toPersistedDataGap` mints its
 * canonical `GAP-NNN` id and strips `category` for the v1.2 committed projection —
 * the same projection T-017/T-019 rely on. This gap, in committed state, IS the
 * durable terminal signal: a role with NO committed result but named by such a
 * cycle gap is reconstructed `not_evaluated` at consolidation (`engine.ts`), keyed
 * on that committed-state fact, never the gap prose.
 */
function buildTerminalNotEvaluatedGap(input: {
  cycleId: string;
  roleId: string;
  reason: string;
  owner: string;
  now: string;
}): OperatingDataGap {
  return {
    kind: 'operating-data-gap',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_MISSION_PROTOCOL_VERSION,
    id: `GAP-${canonicalDigest({
      roleId: input.roleId,
      cycleId: input.cycleId,
      reason: 'stalled-not-evaluated',
    }).slice('sha256:'.length)}`,
    cycleId: input.cycleId,
    category: 'missing-evidence',
    question: `Why did ${input.roleId} not evaluate this cycle? It was dispatched but never recorded a result.`,
    reason: input.reason,
    unblocks: [],
    affectedRoles: [input.roleId],
    status: 'open',
    owner: input.owner && input.owner.length > 0 ? input.owner : 'chair',
    evidenceRefs: [],
    createdAt: input.now,
    updatedAt: input.now,
  } as unknown as OperatingDataGap;
}

/**
 * SPEC-005 T-020 — terminally govern one dispatched-but-unrecorded lens
 * `not_evaluated` with a reason, in committed state. Shared by the runtime
 * `harness abandon` action (lease-bound) and the operator escape
 * (`reapStalledOperatingRoles`, keyed on a lapsed lease). It persists the governed
 * gap through the SAME durable path T-019's citation gaps use
 * (`persistRecordedRoleGaps` → `gap.open` event), so a terminal transition is
 * always a governed event carrying its reason. Idempotent per role: a role already
 * named by a committed gap is a no-op. Never fabricates a result — the lens
 * contributes zero grounded proposals by construction (it recorded none).
 */
async function governTerminalNotEvaluated(input: {
  projectRoot: string;
  localRoot?: string;
  cycleId: string;
  roleId: string;
  reason: string;
  correlationId: string;
}): Promise<void> {
  const config = await readOperatingConfig(input.projectRoot, {
    localRoot: input.localRoot,
  }).catch(() => null);
  const gap = buildTerminalNotEvaluatedGap({
    cycleId: input.cycleId,
    roleId: input.roleId,
    reason: input.reason,
    owner: config?.decisionOwner ?? 'chair',
    now: new Date().toISOString(),
  });
  await persistRecordedRoleGaps({
    projectRoot: input.projectRoot,
    localRoot: input.localRoot,
    cycleId: input.cycleId,
    roleId: input.roleId,
    gaps: [gap],
    correlationId: input.correlationId,
  });
}

async function regularFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  await visit(root);
  return files.sort();
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function metadataPath(relativePath: string): string {
  const normalized = relativePath.split(path.sep).join('/');
  return redactSensitiveText(normalized).value;
}

async function fileMetadata(
  target: string,
  root: string,
  scope: 'commit-safe' | 'machine-local',
  affected: boolean,
): Promise<{
  scope: 'commit-safe' | 'machine-local';
  path: string;
  digest: `sha256:${string}`;
  size: number;
  affected: boolean;
}> {
  const bytes = await readFile(target);
  return {
    scope,
    path: metadataPath(path.relative(root, target)),
    digest: sha256Digest(bytes),
    size: bytes.byteLength,
    affected,
  };
}

export async function operatingCacheAction(input: {
  projectRoot: string;
  action: 'status' | 'purge';
  confirmed?: boolean;
  localRoot?: string;
}): Promise<unknown> {
  const paths = resolveOperatingPaths(input.projectRoot, {
    localRoot: input.localRoot,
  });
  const preferences = await readFile(path.join(paths.localRoot, 'preferences.json'), 'utf8')
    .then((raw) => JSON.parse(raw) as { sensitivityCeiling?: OperatingSensitivity })
    .catch(() => ({ sensitivityCeiling: 'internal' as const }));
  const cache = new OperatingEvidenceCache(
    paths.evidence,
    preferences.sensitivityCeiling ?? 'internal',
  );
  if (input.action === 'status') {
    return {
      evidence: await cache.status(),
      sessions: await guidedSessionStatus({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
      }),
    };
  }
  if (!input.confirmed) {
    throw new OperateError(
      'E_OPERATE_AUTHORITY_REQUIRED',
      'Purging machine-local evidence requires explicit confirmation.',
    );
  }
  const removed = await cache.purgeExpired(new Date(), { all: true });
  const sessions = await purgeGuidedSessions({
    projectRoot: input.projectRoot,
    localRoot: input.localRoot,
  });
  // FR4/FR11: clearing machine-local caches also drops board-bound adapter
  // sessions and incremental evidence baselines, so this is the scoped fix the
  // doctor names for stale adapter sessions and stale incremental baselines.
  const board = await purgeBoardMachineLocalCaches({
    projectRoot: input.projectRoot,
    localRoot: input.localRoot,
  });
  // FR7: sibling to the board purge — clear only confirmed OpenPlanr-owned stale
  // scratch (its own per-cycle lifecycle, kept out of purgeBoardMachineLocalCaches).
  const scratch = await purgeAbandonedOperatingScratch({
    projectRoot: input.projectRoot,
    localRoot: input.localRoot,
  });
  return {
    removed:
      removed.length +
      sessions.removed +
      board.removedAdvisorSessions +
      board.removedIncrementalBaselines +
      scratch.removed,
    evidence: { removed: removed.length, entries: removed },
    sessions,
    adapterSessions: { removed: board.removedAdvisorSessions },
    incrementalBaselines: { removed: board.removedIncrementalBaselines },
    scratch: { removed: scratch.removed, cycles: scratch.cycles },
  };
}

function integrityKeyPath(projectRoot: string, localRoot?: string): string {
  return path.join(resolveOperatingPaths(projectRoot, { localRoot }).localRoot, 'integrity.key');
}

// The committed checkpoint moved under `.state/` in Protocol v1.3; derive its
// project-relative display path from the resolver so these results never drift
// from the on-disk layout again.
function operatingCheckpointRelativePath(projectRoot: string, localRoot?: string): string {
  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  return path.relative(projectRoot, paths.checkpoint).split(path.sep).join('/');
}

async function loadIntegrityKey(projectRoot: string, localRoot?: string): Promise<Buffer | null> {
  return readFile(integrityKeyPath(projectRoot, localRoot)).catch(() => null);
}

function checkpointSigner(key: Buffer): (payload: string) => {
  algorithm: 'hmac-sha256';
  keyId: string;
  value: string;
} {
  const keyId = `local:${sha256Digest(key).slice(7, 23)}`;
  return (payload) => ({
    algorithm: 'hmac-sha256',
    keyId,
    value: createHmac('sha256', key).update(payload).digest('base64url'),
  });
}

function checkpointKeyFingerprint(keyId: string): string {
  return `digest:${sha256Digest(Buffer.from(keyId)).slice('sha256:'.length)}`;
}

export async function operatingIntegrityAction(input: {
  projectRoot: string;
  action: 'status' | 'enable';
  confirmed?: boolean;
  localRoot?: string;
}): Promise<unknown> {
  const store = new OperatingEventStore(input.projectRoot, {
    localRoot: input.localRoot,
  });
  const replay = await store.replay();
  if (input.action === 'enable') {
    if (!input.confirmed) {
      throw new OperateError(
        'E_OPERATE_AUTHORITY_REQUIRED',
        'Enabling signed checkpoints requires explicit confirmation.',
      );
    }
    const initial = replay.eventHead;
    return withOperatingLock(
      input.projectRoot,
      {
        projectKey: operatingProjectKey(input.projectRoot),
        expectedEventHead: initial,
        currentEventHead: initial,
        localRoot: input.localRoot,
      },
      async () => {
        const target = integrityKeyPath(input.projectRoot, input.localRoot);
        let key = await loadIntegrityKey(input.projectRoot, input.localRoot);
        if (!key) {
          key = randomBytes(32);
          await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
          await writeFile(target, key, { mode: 0o600, flag: 'wx' });
        }
        const checkpoint = await store.writeCheckpoint(await store.state(), {
          signer: checkpointSigner(key),
        });
        return {
          status: checkpoint.integrity.status,
          keyId:
            checkpoint.integrity.status === 'signed' ? checkpoint.integrity.signature.keyId : null,
          checkpoint: operatingCheckpointRelativePath(input.projectRoot, input.localRoot),
        };
      },
    );
  }
  const key = await loadIntegrityKey(input.projectRoot, input.localRoot);
  const checkpoint = await store.readCheckpoint(
    key
      ? {
          requireSignatureVerification: true,
          verifySignature(payload, signature) {
            if (signature.algorithm !== 'hmac-sha256') return false;
            const actual = checkpointSigner(key)(payload);
            const left = Buffer.from(actual.value);
            const right = Buffer.from(signature.value);
            return left.length === right.length && timingSafeEqual(left, right);
          },
        }
      : {},
  );
  return {
    eventHead: replay.eventHead,
    checkpoint: checkpoint
      ? {
          eventHead: checkpoint.eventHead,
          stateHash: checkpoint.stateHash,
          integrity: checkpoint.integrity,
          verified:
            checkpoint.integrity.status === 'hash' ||
            (checkpoint.integrity.status === 'signed' && Boolean(key)),
        }
      : null,
  };
}

export async function exportOperatingDiagnostics(input: {
  projectRoot: string;
  output?: string;
  localRoot?: string;
}): Promise<{ path: string; digest: `sha256:${string}` }> {
  await assertCommittedOperatingView(input.projectRoot, {
    localRoot: input.localRoot,
  });
  const store = new OperatingEventStore(input.projectRoot, {
    localRoot: input.localRoot,
  });
  const state = await store.state();
  const replay = await store.replay();
  const checkpoint = await store.readCheckpoint();
  const output = input.output ?? '.planr/operate/diagnostics.json';
  const target = await resolveContainedPath(input.projectRoot, output);
  const diagnostic = {
    schemaVersion: '1.0.0',
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    generatedAt: new Date().toISOString(),
    eventHead: replay.eventHead,
    checkpoint: checkpoint
      ? {
          eventHead: checkpoint.eventHead,
          stateHash: checkpoint.stateHash,
          integrity: checkpoint.integrity,
        }
      : null,
    summary: state.summary,
    paths: {
      commitSafe: '.planr/operate',
      local: '~/.planr/operate/<project-hash>',
    },
  };
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, `${canonicalize(diagnostic)}\n`, { mode: 0o600 });
  return { path: output, digest: canonicalDigest(diagnostic) };
}

export async function repairOperatingSecurity(input: {
  projectRoot: string;
  confirmed: boolean;
  localRoot?: string;
  faultInjector?: (boundary: 'project-quarantined') => void | Promise<void>;
}): Promise<unknown> {
  const paths = resolveOperatingPaths(input.projectRoot, {
    localRoot: input.localRoot,
  });
  const affected: string[] = [];
  for (const target of await regularFiles(paths.root)) {
    const relative = metadataPath(path.relative(input.projectRoot, target));
    const raw = await readFile(target, 'utf8').catch(() => '');
    if (containsSecret(raw)) affected.push(relative);
  }
  const pendingTransactions = await assertCommittedOperatingView(input.projectRoot, {
    localRoot: input.localRoot,
  }).then(
    () => false,
    () => true,
  );
  const preview = {
    affected,
    pendingTransactions,
    actions: [
      'recover incomplete local journals',
      'hold the project writer lock for the complete repair',
      'purge machine-local evidence, advisor, cache, journal, transaction, and prior quarantine data',
      ...(affected.length
        ? [
            'record metadata-only quarantine evidence, purge affected records, and require explicit Git-history remediation',
          ]
        : []),
    ],
  };
  if (!input.confirmed) return preview;
  const store = new OperatingEventStore(input.projectRoot, {
    localRoot: input.localRoot,
  });
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
      // The project writer lock is held before journal recovery or any purge.
      // If another operating mutation starts while repair is active, it fails
      // with E_OPERATE_CYCLE_ACTIVE instead of racing the discontinuity.
      const lockedReplay = await store.replay();
      lock.assertEventHead(lockedReplay.eventHead);
      const recovered = await recoverOperatingTransactions(input.projectRoot, {
        localRoot: input.localRoot,
      });
      const oldCheckpoint = await store.readCheckpoint().catch(() => null);
      const operatingFiles = await regularFiles(paths.root);
      const freshAffectedTargets: string[] = [];
      for (const target of operatingFiles) {
        const raw = await readFile(target, 'utf8').catch(() => '');
        if (containsSecret(raw)) freshAffectedTargets.push(target);
      }
      const freshAffected = freshAffectedTargets
        .map((target) => metadataPath(path.relative(input.projectRoot, target)))
        .sort();
      const purgeRoots = [
        paths.cache,
        paths.evidence,
        paths.advisors,
        paths.journals,
        paths.transactions,
        paths.quarantine,
      ];
      const localFiles = await regularFiles(paths.localRoot);
      const localPurgeTargets = new Set(
        localFiles.filter((target) => purgeRoots.some((root) => isInside(root, target))),
      );
      for (const target of localFiles) {
        if (
          isInside(paths.locks, target) ||
          target === integrityKeyPath(input.projectRoot, input.localRoot)
        ) {
          continue;
        }
        const raw = await readFile(target, 'utf8').catch(() => '');
        if (containsSecret(raw)) localPurgeTargets.add(target);
      }

      if (freshAffected.length > 0) {
        const recoveryId = `RCV-${randomUUID()}`;
        const confirmedAt = new Date().toISOString();
        const quarantineRoot = path.join(paths.quarantine, recoveryId);

        const commitSafeMetadata = await Promise.all(
          operatingFiles.map((target) =>
            fileMetadata(
              target,
              input.projectRoot,
              'commit-safe',
              freshAffectedTargets.includes(target),
            ),
          ),
        );
        const localMetadata = await Promise.all(
          [...localPurgeTargets]
            .sort()
            .map((target) => fileMetadata(target, paths.localRoot, 'machine-local', true)),
        );

        for (const root of purgeRoots) {
          await rm(root, { recursive: true, force: true });
        }
        for (const target of localPurgeTargets) {
          await unlink(target).catch(() => undefined);
        }

        const quarantineManifest = {
          implementation: 'openplanr-operate-security-quarantine',
          state: 'quarantined',
          recoveryId,
          createdAt: confirmedAt,
          oldHead: initial.eventHead,
          affectedPaths: freshAffected,
          files: [...commitSafeMetadata, ...localMetadata].sort(
            (left, right) =>
              left.scope.localeCompare(right.scope) || left.path.localeCompare(right.path),
          ),
        };
        const quarantineManifestDigest = canonicalDigest(quarantineManifest);
        await atomicPrivateWrite(path.join(quarantineRoot, 'manifest.json'), quarantineManifest);
        await input.faultInjector?.('project-quarantined');

        const preserved = new Set([paths.config, paths.charter, paths.workspace]);
        for (const target of operatingFiles) {
          if (preserved.has(target)) {
            const raw = await readFile(target, 'utf8');
            if (containsSecret(raw)) {
              await atomicBytesWrite(target, redactSensitiveText(raw).value);
            }
          } else {
            await unlink(target).catch(() => undefined);
          }
        }
        await mkdir(path.dirname(paths.events), {
          recursive: true,
          mode: 0o700,
        });
        await atomicBytesWrite(paths.events, '');

        const reason =
          'Explicit authority confirmed sensitive-state quarantine and event-chain re-genesis.';
        const guidance = [
          'Rotate every exposed credential immediately.',
          'Remove affected bytes from Git history with an approved history-rewrite procedure.',
          'Notify repository collaborators before force-updating protected branches.',
          'Run `planr operate integrity status` and a fresh deep operating cycle.',
        ].join(' ');
        const record: OperatingRecoveryRecord = {
          kind: 'operating-recovery-record',
          schemaVersion: OPERATE_SCHEMA_VERSION,
          protocolVersion: OPERATE_PROTOCOL_VERSION,
          id: recoveryId,
          transactionId: null,
          action: 'restore-backup',
          reason,
          previewDigest: canonicalDigest(preview),
          fromHead: initial.eventHead,
          toHead: { sequence: 1, hash: null },
          outcome: 'recovered',
          confirmedBy: 'operate-cli',
          createdAt: confirmedAt,
        };
        await assertOperatingArtifact('operating-recovery-record', record);
        const saved = await store.putRecord(
          'recovery',
          record as unknown as Record<string, unknown>,
          { correlationId: recoveryId, createdAt: confirmedAt },
        );
        const oldCheckpointSummary = oldCheckpoint
          ? {
              stateHash: oldCheckpoint.stateHash,
              integrityStatus: oldCheckpoint.integrity.status,
              keyId:
                oldCheckpoint.integrity.status === 'signed'
                  ? checkpointKeyFingerprint(oldCheckpoint.integrity.signature.keyId)
                  : null,
            }
          : null;
        const event = await store.append({
          type: 'security.discontinuity',
          cycleId: 'CYCLE-000',
          entityId: recoveryId,
          timestamp: confirmedAt,
          actor: { kind: 'human', id: 'operate-cli' },
          correlationId: recoveryId,
          expectedHead: null,
          payload: {
            oldHead: initial.eventHead,
            oldCheckpoint: oldCheckpointSummary,
            authority: {
              kind: 'human',
              id: 'operate-cli',
              confirmedAt,
            },
            remediation: {
              reasonDigest: canonicalDigest(reason),
              guidanceDigest: canonicalDigest(guidance),
              affectedPathsDigest: canonicalDigest(freshAffected),
              quarantineManifestDigest,
            },
            recoveryRecordDigest: saved.digest,
            requiresSignedCheckpoint: true,
          },
        });
        const next = { sequence: event.sequence, hash: event.eventHash };
        await lock.advanceEventHead(initial.eventHead, next);
        let key = await loadIntegrityKey(input.projectRoot, input.localRoot);
        if (!key) {
          key = randomBytes(32);
          await atomicBytesWrite(integrityKeyPath(input.projectRoot, input.localRoot), key);
        }
        const checkpoint = await store.writeCheckpoint(await store.state(), {
          signer: checkpointSigner(key),
        });
        return {
          recoveredTransactions: recovered,
          purgedEntries: localPurgeTargets.size,
          record,
          quarantine: {
            root: quarantineRoot,
            manifestDigest: quarantineManifestDigest,
            fileCount: quarantineManifest.files.length,
          },
          checkpoint: {
            integrity: checkpoint.integrity,
            path: operatingCheckpointRelativePath(input.projectRoot, input.localRoot),
          },
          guidance,
        };
      }
      for (const root of purgeRoots) {
        await rm(root, { recursive: true, force: true });
      }
      for (const target of localPurgeTargets) {
        await unlink(target).catch(() => undefined);
      }
      const record: OperatingRecoveryRecord = {
        kind: 'operating-recovery-record',
        schemaVersion: OPERATE_SCHEMA_VERSION,
        protocolVersion: OPERATE_PROTOCOL_VERSION,
        id: `RCV-${randomUUID()}`,
        transactionId: null,
        action: 'recover-journal',
        reason: 'Explicit security repair recovered local journals and purged local evidence.',
        previewDigest: canonicalDigest(preview),
        fromHead: initial.eventHead,
        toHead: initial.eventHead,
        outcome: 'recovered',
        confirmedBy: 'operate-cli',
        createdAt: new Date().toISOString(),
      };
      await assertOperatingArtifact('operating-recovery-record', record);
      const saved = await store.putRecord(
        'recovery',
        record as unknown as Record<string, unknown>,
        {
          correlationId: record.id,
        },
      );
      const event = await store.append({
        type: 'recovery.performed',
        cycleId: (await store.state()).summary.currentCycleId ?? 'CYCLE-000',
        entityId: record.id,
        payload: { recordDigest: saved.digest },
        expectedHead: initial.eventHead.hash,
        actor: { kind: 'human', id: 'operate-cli' },
      });
      const next = { sequence: event.sequence, hash: event.eventHash };
      await lock.advanceEventHead(initial.eventHead, next);
      await store.writeCheckpoint(await store.state());
      return {
        recoveredTransactions: recovered,
        purgedEntries: localPurgeTargets.size,
        record,
      };
    },
  );
}

function adapterSessionPath(projectRoot: string, cycleId: string, localRoot?: string): string {
  return path.join(resolveOperatingPaths(projectRoot, { localRoot }).advisors, `${cycleId}.json`);
}

async function persistedAdapterEvidence(
  store: OperatingEventStore,
  cycleId: string,
): Promise<OperatingEvidence> {
  const replay = await store.replay();
  const event = [...replay.events]
    .reverse()
    .find(
      (candidate) =>
        candidate.cycleId === cycleId &&
        candidate.type === 'evidence.collected' &&
        typeof candidate.payload.recordDigest === 'string',
    );
  if (!event) {
    throw new OperateError(
      'E_OPERATE_EVIDENCE_NOT_READY',
      `Cycle ${cycleId} has no committed evidence snapshot for native dispatch.`,
    );
  }
  const record = await store.readRecord(event.payload.recordDigest as `sha256:${string}`);
  if (record.recordType !== 'evidence-metadata') {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      `Cycle ${cycleId} evidence references an unexpected record type.`,
    );
  }
  return assertOperatingArtifact(
    'operating-evidence',
    record.content as unknown as OperatingEvidence,
  );
}

export async function readPersistedOperatingRoleResults(
  store: OperatingEventStore,
  cycleId: string,
): Promise<OperatingRoleResult[]> {
  const replay = await store.replay();
  const byRole = new Map<string, OperatingRoleResult>();
  for (const event of replay.events) {
    if (
      event.cycleId !== cycleId ||
      event.type !== 'advisory.recorded' ||
      typeof event.payload.recordDigest !== 'string'
    ) {
      continue;
    }
    const record = await store.readRecord(event.payload.recordDigest as `sha256:${string}`);
    if (record.recordType !== 'advisor-result') {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Cycle ${cycleId} advisor event references an unexpected record type.`,
      );
    }
    const result = await assertOperatingArtifact(
      'operating-role-result',
      record.content as unknown as OperatingRoleResult,
    );
    byRole.set(result.roleId, result);
  }
  return [...byRole.values()].sort((left, right) => left.roleId.localeCompare(right.roleId));
}

/** Read the rich Protocol v1.4 analysis sidecars associated with advisor events. */
export async function readPersistedOperatingAdvisorReports(
  store: OperatingEventStore,
  cycleId: string,
): Promise<Map<string, AgentNativeAdvisorResponse>> {
  const protocol = await loadOperatingProtocol();
  const reports = new Map<string, AgentNativeAdvisorResponse>();
  for (const event of (await store.replay()).events) {
    if (
      event.cycleId !== cycleId ||
      event.type !== 'advisory.recorded' ||
      typeof event.payload.advisorReportDigest !== 'string' ||
      typeof event.payload.roleId !== 'string'
    ) {
      continue;
    }
    const record = await store.readRecord(event.payload.advisorReportDigest as `sha256:${string}`);
    if (record.recordType !== 'advisor-report') continue;
    const issues = protocol.validateProtocolArtifact('operating-advisor-response', record.content, {
      protocolVersion: '1.4.0',
    });
    if (issues.length > 0) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Cycle ${cycleId} contains an invalid agent-native advisor report.`,
        { roleId: event.payload.roleId, issues: issues.slice(0, 8) },
      );
    }
    reports.set(event.payload.roleId, record.content as unknown as AgentNativeAdvisorResponse);
  }
  return reports;
}

async function readAdapterSession(
  projectRoot: string,
  cycleId: string,
  localRoot?: string,
  nowMs: number = Date.now(),
): Promise<PrivateAdvisorSession> {
  const parsed = JSON.parse(
    await readFile(adapterSessionPath(projectRoot, cycleId, localRoot), 'utf8'),
  ) as PrivateAdvisorSession;
  const session: PrivateAdvisorSession = {
    ...parsed,
    phase: parsed.phase ?? adapterPhase(parsed.roles ?? []),
    runtime: parsed.runtime ?? 'auto',
  };
  if (
    !['openplanr-operate-adapter', 'openplanr-operate-harness'].includes(session.implementation)
  ) {
    throw new OperateError('E_OPERATE_ADVISOR_FAILED', 'Operate harness session is invalid.');
  }
  // Expiry is evaluated against the resolved clock (an injected clock in tests,
  // wall-clock in production) so a lease that lapsed after its refresh window is
  // still rejected here even when the caller supplies a deterministic clock.
  if (sessionExpired(session, nowMs)) {
    throw new OperateError('E_OPERATE_ADVISOR_FAILED', 'Adapter session expired.', {
      cycleId,
      recoveryCommand: retryRunCommand(session),
    });
  }
  return session;
}

function assertAdapterBinding(
  session: PrivateAdvisorSession,
  lease: string,
  idempotencyKey: string,
  evidenceDigest: string | undefined,
): void {
  if (
    session.lease !== lease ||
    session.idempotencyKey !== idempotencyKey ||
    session.evidenceDigest !== evidenceDigest
  ) {
    throw new OperateError(
      'E_OPERATE_ADVISOR_ISOLATION',
      'Adapter evidence, lease, or idempotency binding does not match the prepared session.',
    );
  }
}

async function assertAdapterCycleBinding(
  input: {
    projectRoot: string;
    cycleId: string;
    localRoot?: string;
  },
  session: PrivateAdvisorSession,
): Promise<void> {
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const state = await store.state();
  const cycle = state.cycles.find((record) => record.id === input.cycleId);
  if (!cycle || !['advising', 'blocked'].includes(cycle.state)) {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      `Adapter session requires cycle ${input.cycleId} to remain advising or blocked.`,
    );
  }
  const cycleManifest = cycle as unknown as {
    producer: { runtime: string };
  };
  if (cycleManifest.producer.runtime !== session.runtime) {
    throw new OperateError(
      'E_OPERATE_ADVISOR_ISOLATION',
      'Adapter runtime no longer matches the immutable cycle runtime.',
    );
  }
  const evidence = await persistedAdapterEvidence(store, input.cycleId);
  if (evidence.fingerprint !== session.evidenceDigest) {
    throw new OperateError(
      'E_OPERATE_ADVISOR_ISOLATION',
      'Adapter evidence no longer matches the committed cycle snapshot.',
    );
  }
}

/**
 * The machine-local sensitivity ceiling (default `internal`), read the same way
 * the evidence cache and cycle engine read it. Mission packets and their tool
 * grants are narrowed to this ceiling.
 */
async function readAdapterSensitivityCeiling(
  projectRoot: string,
  localRoot?: string,
): Promise<OperatingSensitivity> {
  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  return readFile(path.join(paths.localRoot, 'preferences.json'), 'utf8')
    .then(
      (raw) =>
        (JSON.parse(raw) as { sensitivityCeiling?: OperatingSensitivity }).sensitivityCeiling ??
        'internal',
    )
    .catch(() => 'internal' as OperatingSensitivity);
}

// The mandate `boundaries.roots` items must satisfy this pattern (leading dot
// permitted, no `..` traversal), so `.planr` is a valid declared root.
const MANDATE_ROOT_PATTERN = /^(?!.*\.\.)[A-Za-z0-9._][A-Za-z0-9._/-]*$/;

/**
 * FR1/FR2: derive a mandate's declared read roots directly from the project
 * working tree — every top-level directory the agent may traverse — rather than
 * from a collected evidence index. `.planr/` is ALWAYS declared, whether or not
 * it exists yet and REGARDLESS of git tracking, because the mission tool surface
 * (`mission-dispatch.ts`) walks the filesystem directly rather than `git
 * ls-files`, so a gitignored `.planr/` tree is fully readable (finding 2's
 * tracked-file gap cannot reproduce here). `.git`/`node_modules` are never
 * declared, and every root is filtered to the mandate's schema pattern.
 */
async function deriveOperatingMandateRoots(projectRoot: string): Promise<string[]> {
  const entries = await readdir(projectRoot, { withFileTypes: true }).catch(() => []);
  const roots = new Set<string>(['.planr']);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    if (MANDATE_ROOT_PATTERN.test(entry.name)) roots.add(entry.name);
  }
  return [...roots].sort();
}

/** One hard-blocked secret detection, bound to the advisor field it was found in. */
interface HardBlockedSecretField {
  field: string;
  category: SecretDetectionMetadata['category'];
  ruleId: string;
  line: number;
}

/**
 * Refuse advisor text ONLY for a hard-blocked secret category — a known token, an
 * authorization header, a private key, a JWT, or a credential URL — exactly as the
 * citation resolver does.
 *
 * The soft categories are secret-SHAPED, not secret: a public `token: write`
 * workflow permission quoted inside an analysis matches `structured-secret`.
 * Rejecting the whole submission over one of those destroys legitimate work for
 * content the redaction path already handles — the result body's free text is
 * redacted inside `createNativeMissionOperatingRoleResult`, and the v1.4 rich
 * fields are redacted here before they are persisted.
 *
 * EVERY offending field is reported in one error, with its detection category, so
 * a runtime learns the complete list from a single rejection instead of one field
 * per resubmission. Only locations and categories are disclosed, never the value.
 */
function assertNoHardBlockedSecrets(
  fields: ReadonlyArray<{ location: string; value: unknown }>,
  context: { roleId: string; subject: string },
): void {
  const detected: HardBlockedSecretField[] = fields.flatMap((field) =>
    typeof field.value === 'string'
      ? hardBlockedSecretDetections(field.value).map((detection) => ({
          field: field.location,
          category: detection.category,
          ruleId: detection.ruleId,
          line: detection.line,
        }))
      : [],
  );
  if (detected.length === 0) return;
  const locations = detected.map((entry) => `${entry.field} (${entry.category})`).join(', ');
  throw new OperateError(
    'E_OPERATE_SECRET_DETECTED',
    `${context.subject} contains ${detected.length} secret${
      detected.length === 1 ? '' : 's'
    } at ${locations}; nothing was persisted.`,
    { roleId: context.roleId, fields: detected },
  );
}

/**
 * Redact the soft (non-hard-blocking) secret shapes out of a v1.4 advisor report
 * before it is persisted.
 *
 * The committed result's free text is already redacted inside
 * `createNativeMissionOperatingRoleResult`; the report's rich fields
 * (`analysisMarkdown`, claims, actions) are the only advisor text that reaches the
 * `advisor-report` record and the committed board Markdown verbatim, so the same
 * redaction has to run over them here. PII redaction stays off: this is the secret
 * boundary, not the PII one.
 */
function redactAdvisorReportText(value: unknown): unknown {
  if (typeof value === 'string') return redactSensitiveText(value, { redactPii: false }).value;
  if (Array.isArray(value)) return value.map(redactAdvisorReportText);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        redactAdvisorReportText(entry),
      ]),
    );
  }
  return value;
}

export async function createOperatingAdapterStartHandoff(input: {
  projectRoot: string;
  cycleId: string;
  evidenceDigest: `sha256:${string}`;
  runtime: string;
  phase: 'advisors' | 'chair';
  roles: string[];
  localRoot?: string;
}): Promise<OperatingAdapterHandoff> {
  const target = adapterSessionPath(input.projectRoot, input.cycleId, input.localRoot);
  const existing = await readFile(target, 'utf8')
    .then((raw) => JSON.parse(raw) as PrivateAdvisorSession)
    .catch(() => null);
  if (existing) {
    const normalized: PrivateAdvisorSession = {
      ...existing,
      phase: existing.phase ?? adapterPhase(existing.roles ?? []),
      runtime: existing.runtime ?? 'auto',
    };
    const exact =
      normalized.evidenceDigest === input.evidenceDigest &&
      normalized.runtime === input.runtime &&
      normalized.phase === input.phase &&
      sameRoleSet(normalized.roles, input.roles);
    if (!sessionExpired(normalized) && normalized.state !== 'cancelled' && exact) {
      return adapterHandoff(normalized);
    }
    if (
      !sessionExpired(normalized) &&
      ['prepared', 'recording'].includes(normalized.state) &&
      !exact
    ) {
      throw new OperateError(
        'E_OPERATE_ADVISOR_ISOLATION',
        `Cycle ${input.cycleId} already has a different active adapter session.`,
        { recoveryCommand: retryRunCommand(normalized) },
      );
    }
  }
  const protocol = await loadOperatingProtocol();
  const handoff = protocol.createOperatingAdapterHandoff({
    protocolVersion: '1.4.0',
    phase: input.phase,
    state: 'prepare-required',
    cycleId: input.cycleId,
    evidenceDigest: input.evidenceDigest,
    runtime: input.runtime,
    idempotencyKey: `native-${input.cycleId}-${input.phase}-${randomBytes(12).toString('hex')}`,
    lease: null,
    expiresAt: null,
    roles: [...new Set(input.roles)].sort().map((roleId) => ({
      roleId,
      status: 'awaiting-prepare',
      inputDigest: null,
    })),
  });
  return protocol.validateOperatingAdapterHandoffBindings(handoff);
}

export async function operateAdapterLifecycle(input: {
  projectRoot: string;
  action:
    | 'prepare'
    | 'record'
    | 'validate'
    | 'resume'
    | 'finalize'
    | 'cancel'
    | 'heartbeat'
    | 'abandon';
  cycleId?: string;
  evidenceDigest?: string;
  lease?: string;
  idempotencyKey?: string;
  role?: string;
  stdin?: string;
  /**
   * SPEC-005 T-020: the governed reason a lens is abandoned terminal
   * `not_evaluated`. Required for `action: 'abandon'`; unused otherwise.
   */
  reason?: string;
  localRoot?: string;
  /**
   * Injectable clock (FR10 / T-008). Defaults to wall-clock. Tests supply a
   * deterministic clock to prove the lease refreshes forward on `record` and that
   * expiry is still enforced once the refreshed window lapses.
   */
  now?: () => Date;
}): Promise<unknown> {
  // US-T1 dry-run: `harness validate` checks a draft advisor response against the
  // EXACT contract `record` enforces, but is read-only — it reads the prepared
  // session to reuse that role's brief + protocol version, takes NO lease, consumes
  // NO idempotency key, and mutates nothing. Handled before the record-path guards
  // (which require an idempotency key and, below, a lease) so a runtime can iterate
  // on its response with zero state cost. It shares collectAdvisorResponseContract-
  // Issues with the record path, so the dry-run and the real rejection never diverge.
  if (input.action === 'validate') {
    if (!input.cycleId) {
      throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Adapter validate requires --cycle-id.');
    }
    if (!input.role || !input.stdin) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        'Adapter validate requires --role and JSON on stdin.',
      );
    }
    const validateNowMs = (input.now?.() ?? new Date()).getTime();
    // Read-only: `readAdapterSession` reads the prepared session and checks expiry
    // only — it never asserts or refreshes the lease (that is `assertAdapterBinding`,
    // deliberately skipped here). Nothing below writes.
    const session = await readAdapterSession(
      input.projectRoot,
      input.cycleId,
      input.localRoot,
      validateNowMs,
    );
    if (!session.roles.includes(input.role)) {
      throw new OperateError(
        'E_OPERATE_ADVISOR_ISOLATION',
        `Role ${input.role} was not bound by adapter prepare.`,
      );
    }
    const brief = session.roleBriefs[input.role];
    let submitted: unknown;
    try {
      submitted = JSON.parse(input.stdin) as unknown;
    } catch {
      throw new OperateError(
        'E_OPERATE_ADVISOR_FAILED',
        'Native advisor response must be one valid JSON document.',
        { ...advisorResponseContractDetails(brief) },
      );
    }
    const issues = await collectAdvisorResponseContractIssues({
      brief,
      response: submitted,
      protocolVersion: session.roleMandates[input.role].protocolVersion,
    });
    // Same complete-issues output as a `record` rejection: when the draft fails, it
    // is one E_OPERATE_ADVISOR_FAILED whose `data.issues` array spans every category
    // at once — so a runtime's error handling is identical to the record path — but
    // it consumed no lease and wrote nothing.
    if (issues.length > 0) {
      throw new OperateError(
        'E_OPERATE_ADVISOR_FAILED',
        `Native ${input.role} response does not satisfy the disclosed advisor contract (${
          issues.length
        } issue${issues.length === 1 ? '' : 's'}).`,
        { issues, ...advisorResponseContractDetails(brief) },
      );
    }
    return {
      validated: input.role,
      valid: true,
      issues,
      ...advisorResponseContractDetails(brief),
    };
  }
  if (!input.cycleId || !input.idempotencyKey) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'Adapter calls require --cycle-id and --idempotency-key.',
    );
  }
  const nowMs = (input.now?.() ?? new Date()).getTime();
  // The lease window is a machine-local preference (default 30 minutes, or the
  // `OPENPLANR_ADAPTER_LEASE_MS` seam). Resolved once so both the fresh `prepare`
  // expiry and the per-`record` refresh use the same configured duration, and so
  // every handoff response can echo it as `session.leaseTtlSeconds`.
  const leaseDurationMs = await readOperatingAdapterLeaseDurationMs(input.projectRoot, {
    localRoot: input.localRoot,
  });
  const target = adapterSessionPath(input.projectRoot, input.cycleId, input.localRoot);
  if (input.action === 'prepare') {
    if (!input.evidenceDigest?.startsWith('sha256:')) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        'Adapter prepare requires --evidence-digest.',
      );
    }
    const store = new OperatingEventStore(input.projectRoot, {
      localRoot: input.localRoot,
    });
    const state = await store.state();
    // FR4: the identity of the board that owns this prepare. A machine-local
    // session bound to any other genesis belongs to a superseded generation.
    const boardIdentity = await committedBoardIdentity(store);
    const cycle = state.cycles.find((record) => record.id === input.cycleId);
    if (!cycle || !['advising', 'blocked'].includes(cycle.state)) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        'Adapter prepare requires an advising or blocked cycle.',
      );
    }
    const protocol = await loadOperatingProtocol();
    const knownRoles = new Set(
      protocol.listOperatingRoles().map((role) => role.id as OperatingRoleId),
    );
    const enabledRoles = (
      Array.isArray(cycle.enabledRoles) ? cycle.enabledRoles.map(String) : []
    ).filter((role): role is OperatingRoleId => knownRoles.has(role as OperatingRoleId));
    const requestedRoles = input.role
      ? input.role
          .split(',')
          .map((role) => role.trim())
          .filter(Boolean)
      : enabledRoles.filter((role) => role !== 'chair');
    const unknownRoles = requestedRoles.filter((role) => !knownRoles.has(role as OperatingRoleId));
    if (unknownRoles.length > 0) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        `Adapter prepare contains unknown roles: ${unknownRoles.sort().join(', ')}.`,
      );
    }
    const roles = [...new Set(requestedRoles)]
      .filter((role): role is OperatingRoleId => knownRoles.has(role as OperatingRoleId))
      .sort();
    if (roles.length === 0) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        'Adapter prepare requires at least one bound advisor role.',
      );
    }
    if (roles.some((role) => !enabledRoles.includes(role))) {
      throw new OperateError(
        'E_OPERATE_ADVISOR_ISOLATION',
        'Adapter prepare cannot widen the cycle enabled-role set.',
      );
    }
    if (roles.includes('chair') && roles.length !== 1) {
      throw new OperateError(
        'E_OPERATE_ADVISOR_ISOLATION',
        'Chair dispatch must be prepared separately after independent advisor results.',
      );
    }
    const baseEvidence = await persistedAdapterEvidence(store, input.cycleId);
    if (baseEvidence.fingerprint !== input.evidenceDigest) {
      throw new OperateError(
        'E_OPERATE_ADVISOR_ISOLATION',
        'Adapter evidence digest does not match the committed cycle snapshot.',
      );
    }
    const phase = adapterPhase(roles);
    const runtime = (cycle as unknown as { producer: { runtime: string } }).producer.runtime;
    const existing = await readFile(target, 'utf8')
      .then((raw) => JSON.parse(raw) as PrivateAdvisorSession)
      .catch(() => null);
    // Recovery semantics (FR10 / T-008, behavior unchanged — documented here so
    // the lease ergonomics read coherently): when a prior session for this cycle
    // exists and its binding is an *exact* match (same cycle, evidence digest,
    // runtime, phase, and role set) but it has lapsed or was cancelled, its
    // deterministic role packs are reused rather than rebuilt. The reused packs
    // carry the same per-role `inputDigest`, so any machine-local role result that
    // still matches that digest is re-adopted below as already-recorded work — the
    // lease is reissued fresh (new token + refreshed `expiresAt`) while the proven,
    // digest-bound advisory output is preserved. A non-exact prior binding is never
    // recovered; it fails closed above with `E_OPERATE_ADVISOR_ISOLATION`.
    let recoverableSession: PrivateAdvisorSession | null = null;
    if (existing) {
      const normalized: PrivateAdvisorSession = {
        ...existing,
        phase: existing.phase ?? adapterPhase(existing.roles ?? []),
        runtime: existing.runtime ?? 'auto',
        boardIdentity: existing.boardIdentity ?? '',
      };
      // FR4: a session bound to a superseded board generation (its genesis no
      // longer matches the committed event chain) never blocks, matches, or is
      // reused by the current board — it is silently superseded by the fresh
      // session written below. This is what lets a board re-inited at the same
      // path — whose CYCLE-NNN ordinal collides with a prior generation's
      // finalized session — prepare cleanly instead of dead-ending on
      // `E_OPERATE_ADVISOR_ISOLATION` / a whole-cycle cancel.
      const sessionMatchesBoard = normalized.boardIdentity === boardIdentity;
      if (sessionMatchesBoard) {
        const exact =
          normalized.cycleId === input.cycleId &&
          normalized.evidenceDigest === input.evidenceDigest &&
          normalized.runtime === runtime &&
          normalized.phase === phase &&
          sameRoleSet(normalized.roles, roles);
        if (normalized.idempotencyKey === input.idempotencyKey) {
          if (!exact) {
            throw new OperateError(
              'E_OPERATE_ADVISOR_ISOLATION',
              'Idempotent adapter prepare does not match its original cycle, evidence, runtime, phase, or role binding.',
            );
          }
          if (sessionExpired(normalized) || normalized.state === 'cancelled') {
            throw new OperateError(
              'E_OPERATE_ADVISOR_FAILED',
              'The prepared adapter session is expired or cancelled; request a fresh CLI-owned handoff.',
              { recoveryCommand: retryRunCommand(normalized) },
            );
          }
          return {
            ...normalized,
            session: sessionView(normalized, leaseDurationMs),
            leaseStatus: adapterLeaseStatus(normalized, nowMs),
            handoff: await adapterHandoff(normalized),
          };
        }
        if (!sessionExpired(normalized) && ['prepared', 'recording'].includes(normalized.state)) {
          throw new OperateError(
            'E_OPERATE_ADVISOR_ISOLATION',
            `Cycle ${input.cycleId} already has an active adapter session with another binding. ` +
              'Close that session before preparing a new one.',
            {
              // Names the escape, not the command that just failed.
              recoveryCommand: closeOpenSessionCommand(normalized),
              alternateRecoveryCommand: closeOpenSessionCommand(normalized, 'finalize'),
            },
          );
        }
        // FR4: a finalized/expired/cancelled same-board session no longer forces
        // a whole-cycle-cancelling error on a new compatible prepare. The
        // advisors→chair continuation and a same-phase re-prepare both fall
        // through and supersede the dead session; an exact dead session reuses
        // its already-built mandates so recorded advisory work is not recomputed.
        if (exact && (sessionExpired(normalized) || normalized.state === 'cancelled')) {
          recoverableSession = normalized;
        }
      }
    }
    // FR1/FR2: every requested role — the Chair included — dispatches an operating
    // MANDATE. The role-dependent pack/mission split is retired, so there is no
    // pre-dispatch readiness gate against collected evidence and no v1.2 role pack
    // is built. A mandate carries the lens question, the investigation mandate, the
    // declared read boundaries (the granted workspace roots — including a
    // gitignored `.planr/` tree — the registry sensitivity ceiling, and any
    // forbidden paths), the response schema, and the citation requirement. It
    // carries NO evidence body and NO evidence index: nothing is collected,
    // budgeted, packed, or pre-filtered. A response that grounds nothing is
    // post-gated at record time by the universal citation gate
    // (`gateRecordedProposalCitations`). A recovered dead-but-exact session reuses
    // its stored mandates verbatim.
    const roleMandates: Record<string, OperatingMandate> =
      recoverableSession?.roleMandates && Object.keys(recoverableSession.roleMandates).length > 0
        ? recoverableSession.roleMandates
        : await (async () => {
            const roots = await deriveOperatingMandateRoots(input.projectRoot);
            // FR12 (SPEC-005 T-003): the native harness prepare path is the one real
            // runs use, so it must thread the SAME shared research guidance the inline
            // dispatch path does — otherwise native-runtime agents receive no FR12
            // targeting at all. Build the ONE shared, citation-bearing bootstrap map
            // once per cycle here (cached per project+head) and reference it from every
            // advisor role's mandate below, alongside the graceful per-role research
            // budget. The Chair is prepared alone (`['chair']`), never mixed with
            // advisors, so it derives an empty advisor set, builds no map, and its
            // mandate stays byte-identical. The map is body-free targeting layered over
            // the immutable mandate — never an evidence-pack input, never a size ceiling,
            // never a cap on what a lens may examine.
            const advisorRoles = (roles as OperatingRoleId[]).filter(
              (roleId) => roleId !== 'chair',
            );
            const bootstrapMap =
              advisorRoles.length > 0 ? await buildOperatingBootstrapMap(input.projectRoot) : null;
            const built = await Promise.all(
              (roles as OperatingRoleId[]).map(
                async (roleId) =>
                  [
                    roleId,
                    await buildOperatingMandate({
                      roleId,
                      roots,
                      runtime,
                      ...(roleId !== 'chair' && bootstrapMap ? { bootstrapMap } : {}),
                      ...(roleId !== 'chair'
                        ? { researchBudgetMs: DEFAULT_OPERATING_ROLE_RESEARCH_BUDGET_MS }
                        : {}),
                    }),
                  ] as const,
              ),
            );
            return Object.fromEntries(built) as Record<string, OperatingMandate>;
          })();
    // Every requested role dispatches; the bound role set is exactly `roles`.
    const dispatchedRoles = roles;
    const roleBriefs: Record<string, OperatingAdvisorBrief> = Object.fromEntries(
      Object.keys(roleMandates).map((role) => [
        role,
        createRegistryReconciledAdvisorBrief(protocol, role),
      ]),
    );
    // US-T1: ship the disclosed response contract INSIDE every dispatched mandate.
    // Serialize each role brief's already-computed output facet onto its mandate's
    // `output` block so the runtime that must satisfy the contract can dereference
    // it, instead of only a `responseSchema` name it cannot resolve. Layered on
    // AFTER the pipeline signed each `mandateDigest` — exactly like the FR12
    // research guidance — so it never alters the signed digest or the immutable
    // mandate the digest pins (`roleInputDigests` below still equals it verbatim).
    const dispatchedMandates: Record<string, OperatingMandate> = Object.fromEntries(
      Object.entries(roleMandates).map(([role, mandate]) => [
        role,
        attachMandateResponseContract(mandate, roleBriefs[role]),
      ]),
    );
    // A role's committed input digest is its mandate digest. The record path
    // binds a recorded result to exactly this value.
    const roleInputDigests = Object.fromEntries(
      dispatchedRoles.map((role) => [role, roleMandates[role].mandateDigest] as const),
    ) as Record<string, `sha256:${string}`>;
    const validRecordedRoles: string[] = [];
    for (const role of dispatchedRoles) {
      const prior: OperatingRoleResult | null = await readFile(
        path.join(path.dirname(target), `${input.cycleId}.${role}.json`),
        'utf8',
      )
        .then((raw) => JSON.parse(raw) as OperatingRoleResult)
        .catch(() => null);
      if (
        prior &&
        prior.cycleId === input.cycleId &&
        prior.roleId === role &&
        prior.inputDigest === roleInputDigests[role]
      ) {
        try {
          await assertOperatingArtifact('operating-role-result', prior);
          protocol.validateOperatingRoleResultDigest(prior);
          validRecordedRoles.push(role);
        } catch {
          // A stale or invalid machine-local role file is never trusted as a
          // recovered result; the new session will request that role again.
        }
      }
    }
    const pinnedRevision = baseEvidence.items.find((item) => item.repository?.revision)?.repository
      ?.revision;
    const session: PrivateAdvisorSession = {
      implementation: 'openplanr-operate-harness',
      boardIdentity,
      cycleId: input.cycleId,
      evidenceDigest: input.evidenceDigest,
      phase,
      runtime,
      protocolVersion: '1.4.0',
      ...(pinnedRevision ? { pinnedRevision } : {}),
      lease: randomBytes(32).toString('base64url'),
      idempotencyKey: input.idempotencyKey,
      state: validRecordedRoles.length > 0 ? 'recording' : 'prepared',
      expiresAt: new Date(nowMs + leaseDurationMs).toISOString(),
      roles: dispatchedRoles,
      recordedRoles: validRecordedRoles.sort(),
      roleBriefs,
      roleMandates: dispatchedMandates,
      roleInputDigests,
    };
    await atomicPrivateWrite(target, session);
    return {
      ...session,
      mandates: dispatchedMandates,
      session: sessionView(session, leaseDurationMs),
      leaseStatus: adapterLeaseStatus(session, nowMs),
      handoff: await adapterHandoff(session),
    };
  }
  if (!input.lease) {
    throw new OperateError('E_OPERATE_ADVISOR_ISOLATION', 'Adapter lease is required.');
  }
  const session = await readAdapterSession(
    input.projectRoot,
    input.cycleId,
    input.localRoot,
    nowMs,
  );
  assertAdapterBinding(session, input.lease, input.idempotencyKey, input.evidenceDigest);
  await assertAdapterCycleBinding(
    {
      projectRoot: input.projectRoot,
      cycleId: input.cycleId,
      localRoot: input.localRoot,
    },
    session,
  );
  if (input.action === 'heartbeat') {
    // FR2: renew the cycle session's lease WITHOUT recording a role result. A
    // slow lens can hold the session open — extending `expiresAt` by the same
    // configured lease duration — while siblings keep their already-recorded work
    // instead of the shared lease lapsing and stranding it. This is the sanctioned
    // renewal path; raising `adapterLeaseDurationMs` is explicitly not (SPEC-005).
    // It carries no `--role`/stdin, changes no role's recorded/pending status, and
    // is safe to call concurrently by any coordinator holding the current lease:
    // it goes through the same per-cycle session serialization as `record`, so it
    // can never clobber a concurrent record's `recordedRoles`.
    if (!['prepared', 'recording'].includes(session.state)) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Adapter heartbeat is not valid after the session is ${session.state}.`,
        { recoveryCommand: retryRunCommand(session) },
      );
    }
    const renewed = await withInProcessSessionLock(target, () =>
      commitSessionWrite(target, {
        projectRoot: input.projectRoot,
        cycleId: input.cycleId as string,
        localRoot: input.localRoot,
        lease: input.lease as string,
        idempotencyKey: input.idempotencyKey as string,
        evidenceDigest: input.evidenceDigest,
        nowMs,
        apply: (current) => ({
          ...current,
          expiresAt: new Date(nowMs + leaseDurationMs).toISOString(),
        }),
      }),
    );
    return {
      session: sessionView(renewed, leaseDurationMs),
      leaseStatus: adapterLeaseStatus(renewed, nowMs),
      handoff: await adapterHandoff(renewed),
    };
  }
  if (input.action === 'abandon') {
    // SPEC-005 T-020 (FR13) — the runtime-side governed terminal path. The
    // orchestrating runtime, which dispatched this lens and holds the session
    // lease, invokes this when a dispatched lens exceeded its budget and never
    // returned (see the skill/command runtime workflow). The engine never spawned
    // the agent, so it cannot time it out unilaterally; this explicit governed
    // action, with a required reason, is the smallest honest substitute. It marks
    // ONE still-pending lens terminal `not_evaluated`, persists the governed gap
    // (a `gap.open` event carrying the reason), and lets the board consolidate
    // without it — its recorded siblings are untouched and the Chair names it as a
    // gap it must not synthesize around.
    if (!['prepared', 'recording'].includes(session.state)) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Adapter abandon is not valid after the session is ${session.state}.`,
        { recoveryCommand: retryRunCommand(session) },
      );
    }
    if (!input.role) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        'Adapter abandon requires --role naming the stalled lens.',
      );
    }
    const reason = input.reason?.trim();
    if (!reason) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        'Adapter abandon requires --reason recording why the lens is not_evaluated.',
      );
    }
    if (!session.roles.includes(input.role)) {
      throw new OperateError(
        'E_OPERATE_ADVISOR_ISOLATION',
        `Role ${input.role} was not bound by adapter prepare.`,
      );
    }
    if (session.recordedRoles.includes(input.role)) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Role ${input.role} already recorded a result and cannot be abandoned.`,
        { recoveryCommand: retryRunCommand(session) },
      );
    }
    // Persist the governed terminal gap first (committed state is the source of
    // truth the later `run` continuation reconstructs from), then mark the role
    // terminal in the lease-bound session so finalize no longer waits on it and
    // the handoff renders it `not-evaluated`. Idempotent: re-abandoning a role
    // already governed is a no-op that returns the same terminal handoff.
    await governTerminalNotEvaluated({
      projectRoot: input.projectRoot,
      localRoot: input.localRoot,
      cycleId: input.cycleId as string,
      roleId: input.role,
      reason,
      correlationId: input.idempotencyKey as string,
    });
    const updated = await withInProcessSessionLock(target, () =>
      commitSessionWrite(target, {
        projectRoot: input.projectRoot,
        cycleId: input.cycleId as string,
        localRoot: input.localRoot,
        lease: input.lease as string,
        idempotencyKey: input.idempotencyKey as string,
        evidenceDigest: input.evidenceDigest,
        nowMs,
        apply: (current) => ({
          ...current,
          state: 'recording',
          notEvaluatedRoles: {
            ...(current.notEvaluatedRoles ?? {}),
            [input.role as string]: reason,
          },
        }),
      }),
    );
    return {
      abandoned: input.role,
      notEvaluated: true,
      reason,
      session: sessionView(updated, leaseDurationMs),
      leaseStatus: adapterLeaseStatus(updated, nowMs),
      handoff: await adapterHandoff(updated),
    };
  }
  if (input.action === 'resume') {
    if (!['prepared', 'recording'].includes(session.state)) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Adapter resume is not valid after the session is ${session.state}.`,
        { recoveryCommand: retryRunCommand(session) },
      );
    }
    return {
      ...session,
      session: sessionView(session, leaseDurationMs),
      leaseStatus: adapterLeaseStatus(session, nowMs),
      handoff: await adapterHandoff(session),
    };
  }
  if (input.action === 'cancel') {
    if (session.state === 'finalized') {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        'A finalized adapter session cannot be cancelled.',
        { recoveryCommand: retryRunCommand(session) },
      );
    }
    if (session.state === 'cancelled') {
      return {
        session: sessionView(session, leaseDurationMs),
        leaseStatus: adapterLeaseStatus(session, nowMs),
        handoff: await adapterHandoff(session),
      };
    }
    const cancelled = { ...session, state: 'cancelled' as const };
    await atomicPrivateWrite(target, cancelled);
    return {
      session: sessionView(cancelled, leaseDurationMs),
      leaseStatus: adapterLeaseStatus(cancelled, nowMs),
      handoff: await adapterHandoff(cancelled),
    };
  }
  if (input.action === 'record') {
    if (!['prepared', 'recording'].includes(session.state)) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Adapter record is not valid after the session is ${session.state}.`,
        { recoveryCommand: retryRunCommand(session) },
      );
    }
    if (!input.role || !input.stdin) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        'Adapter record requires --role and JSON on stdin.',
      );
    }
    if (!session.roles.includes(input.role)) {
      throw new OperateError(
        'E_OPERATE_ADVISOR_ISOLATION',
        `Role ${input.role} was not bound by adapter prepare.`,
      );
    }
    // T-001 widened `record-required.next` to one record action per PENDING role,
    // so authorization is keyed by role, not by position: any pending role may
    // record the instant it returns, regardless of sibling order or completion
    // state (FR1). A role that is already recorded is not pending (so it has no
    // record action in `next`) but is still a legal idempotent replay target —
    // its identical-bytes no-op is enforced downstream by the resultDigest guard.
    // Only a role that is neither pending nor already recorded (e.g. a session
    // with no pending roles left) is rejected here, pointed at recovery.
    const currentHandoff = await adapterHandoff(session);
    const authorizedRecord = currentHandoff.next.find(
      (action) =>
        ['adapter.record', 'harness.record'].includes(action.action) && action.role === input.role,
    );
    const alreadyRecorded = session.recordedRoles.includes(input.role);
    if (!authorizedRecord && !alreadyRecorded) {
      throw new OperateError(
        'E_OPERATE_ADVISOR_ISOLATION',
        `Role ${input.role} has no pending adapter record action.`,
        {
          expectedRole:
            currentHandoff.next.find((action) =>
              ['adapter.record', 'harness.record'].includes(action.action),
            )?.role ?? null,
          recoveryCommand: currentHandoff.recovery
            .find((action) => ['adapter.resume', 'harness.resume'].includes(action.action))
            ?.argv.join(' '),
        },
      );
    }
    const outputLimit = Math.min(
      session.protocolVersion === '1.4.0' ? 262_144 : 32_768,
      session.roleBriefs[input.role].output.maximumOutputBytes,
    );
    if (Buffer.byteLength(input.stdin, 'utf8') > outputLimit) {
      throw new OperateError(
        'E_OPERATE_ADVISOR_FAILED',
        `Native advisor response exceeds the ${outputLimit}-byte bound.`,
        {
          ...advisorResponseContractDetails(session.roleBriefs[input.role]),
          recoveryCommand: retryRunCommand(session),
        },
      );
    }
    let submitted: unknown;
    try {
      submitted = JSON.parse(input.stdin) as unknown;
    } catch {
      throw new OperateError(
        'E_OPERATE_ADVISOR_FAILED',
        'Native advisor response must be one valid JSON document.',
        {
          ...advisorResponseContractDetails(session.roleBriefs[input.role]),
          recoveryCommand: retryRunCommand(session),
        },
      );
    }
    const submittedRecord =
      submitted && typeof submitted === 'object' ? (submitted as Record<string, unknown>) : {};
    let result: OperatingRoleResult;
    // FR1/FR2: unresolvable-citation and empty-grounding gaps opened while
    // resolving a mandate response's citations, surfaced in the record response
    // for observability. `recordNotEvaluated` marks a role whose citations
    // grounded zero evidence (committed as a quiet result plus the governed gap).
    let recordGaps: OperatingDataGap[] = [];
    let recordNotEvaluated = false;
    if (submittedRecord.kind === 'operating-role-result') {
      throw new OperateError(
        'E_OPERATE_ADVISOR_FAILED',
        'Native advisors must submit only the compact response contract; OpenPlanr owns canonical result metadata.',
        {
          ...advisorResponseContractDetails(session.roleBriefs[input.role]),
          recoveryCommand: retryRunCommand(session),
        },
      );
    } else {
      const submittedProposals = Array.isArray(submittedRecord.proposals)
        ? submittedRecord.proposals
        : [];
      const submittedText = [
        ...(typeof submittedRecord.analysisMarkdown === 'string'
          ? [{ location: 'analysisMarkdown', value: submittedRecord.analysisMarkdown }]
          : []),
        ...(Array.isArray(submittedRecord.claims) ? submittedRecord.claims : []).flatMap(
          (claim, index) =>
            claim && typeof claim === 'object' && !Array.isArray(claim)
              ? [
                  {
                    location: `claims.${index}.statement`,
                    value: (claim as Record<string, unknown>).statement,
                  },
                ]
              : [],
        ),
        ...(Array.isArray(submittedRecord.actions) ? submittedRecord.actions : []).flatMap(
          (action, index) =>
            action && typeof action === 'object' && !Array.isArray(action)
              ? ['title', 'summary'].map((field) => ({
                  location: `actions.${index}.${field}`,
                  value: (action as Record<string, unknown>)[field],
                }))
              : [],
        ),
        ...submittedProposals.flatMap((proposal, index) => {
          if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return [];
          const record = proposal as Record<string, unknown>;
          return ['title', 'problem', 'proposal'].map((field) => ({
            location: `proposals.${index}.${field}`,
            value: record[field],
          }));
        }),
        ...(Array.isArray(submittedRecord.gaps) ? submittedRecord.gaps : []).map(
          (value, index) => ({ location: `gaps.${index}`, value }),
        ),
        ...(Array.isArray(submittedRecord.conflicts) ? submittedRecord.conflicts : []).map(
          (value, index) => ({ location: `conflicts.${index}`, value }),
        ),
      ];
      assertNoHardBlockedSecrets(submittedText, {
        roleId: input.role,
        subject: 'Native advisor response',
      });
      const mandate = session.roleMandates[input.role];
      // US-T1 batch validation: collect EVERY advisor-contract violation (response
      // schema issues, the per-role proposal cap, disallowed proposal types) in one
      // pass and reject with ALL of them, so a runtime never learns one category per
      // rejected resubmission. Shared verbatim with `harness validate` via
      // collectAdvisorResponseContractIssues so the record path and the dry-run can
      // never disagree. Runs after the secret scan (never echo a secret in an issue)
      // and before the citation gate mutates anything.
      const contractIssues = await collectAdvisorResponseContractIssues({
        brief: session.roleBriefs[input.role],
        response: submitted,
        protocolVersion: mandate.protocolVersion,
      });
      if (contractIssues.length > 0) {
        throw new OperateError(
          'E_OPERATE_ADVISOR_FAILED',
          `Native ${input.role} response does not satisfy the disclosed advisor contract (${
            contractIssues.length
          } issue${contractIssues.length === 1 ? '' : 's'}).`,
          {
            issues: contractIssues,
            ...advisorResponseContractDetails(session.roleBriefs[input.role]),
            recoveryCommand: retryRunCommand(session),
          },
        );
      }
      try {
        const gated = await createNativeMissionOperatingRoleResult({
          mandate,
          cycleId: input.cycleId as string,
          response: submitted,
          runtime: session.runtime,
          pinnedRevision: session.pinnedRevision,
          resolveCitations: async (roleResults) => {
            const [workspace, sensitivityCeiling, config, workspaceRoots] = await Promise.all([
              refreshOperatingWorkspaceManifest(input.projectRoot, {
                localRoot: input.localRoot,
              }),
              readAdapterSensitivityCeiling(input.projectRoot, input.localRoot),
              readOperatingConfig(input.projectRoot, { localRoot: input.localRoot }).catch(
                () => null,
              ),
              readOperatingWorkspaceRoots(input.projectRoot, { localRoot: input.localRoot }),
            ]);
            return gateRecordedProposalCitations({
              roleResults,
              context: {
                projectRoot: input.projectRoot,
                cycleId: input.cycleId as string,
                descriptor: workspace.controlRepository,
                cache: new OperatingEvidenceCache(
                  resolveOperatingPaths(input.projectRoot, {
                    localRoot: input.localRoot,
                  }).evidence,
                  sensitivityCeiling,
                ),
                owner: config?.decisionOwner,
                components: citationComponentsFromWorkspace(workspace, workspaceRoots),
              },
            });
          },
        });
        result = gated.result;
        recordGaps = gated.gaps;
        recordNotEvaluated = gated.notEvaluated;
      } catch (error) {
        if (error instanceof OperateError && error.code === 'E_OPERATE_ADVISOR_FAILED') {
          throw new OperateError(error.code, error.message, {
            ...error.details,
            recoveryCommand: retryRunCommand(session),
          });
        }
        throw error;
      }
    }
    await assertOperatingArtifact('operating-role-result', result);
    // The structured provider path runs every proposal's free text through
    // sanitizeGeneratedPlainText before it is persisted. Native runtimes hand
    // their output in here instead, so the same post-output secret scan has to
    // happen on this path — otherwise a token in a proposal title reaches the
    // commit-safe records and the brief projection unredacted.
    //
    // A hard-blocked category rejects rather than redacts: the result is bound by
    // resultDigest, so rewriting the content in place would invalidate the binding
    // that proves the runtime returned exactly this. A runtime that emits a real
    // secret must produce a clean result, not have one silently edited underneath
    // it. Soft, secret-SHAPED matches were already redacted by
    // sanitizeGeneratedPlainText inside the result builder, so they never reach
    // here as a reason to discard the result.
    const generatedText = [
      ...(result.proposals ?? []).flatMap((proposal) =>
        (['title', 'problem', 'proposal'] as const).map((field) => ({
          location: `proposal.${proposal.proposalKey}.${field}`,
          value: proposal[field],
        })),
      ),
      ...(result.gaps ?? []).map((value, index) => ({
        location: `gaps.${index}`,
        value,
      })),
      ...(result.conflicts ?? []).map((value, index) => ({
        location: `conflicts.${index}`,
        value,
      })),
    ];
    assertNoHardBlockedSecrets(generatedText, {
      roleId: input.role,
      subject: 'Recorded advisor output',
    });
    if (result.cycleId !== input.cycleId || result.roleId !== input.role) {
      throw new OperateError(
        'E_OPERATE_ADVISOR_ISOLATION',
        'Recorded advisor output does not match its cycle and role binding.',
      );
    }
    assertAdvisorOutputMatchesBrief(session.roleBriefs[input.role], result);
    if (result.inputDigest !== session.roleInputDigests[input.role]) {
      throw new OperateError(
        'E_OPERATE_ADVISOR_ISOLATION',
        'Recorded advisor output does not match its role/evidence input digest.',
      );
    }
    try {
      (await loadOperatingProtocol()).validateOperatingRoleResultDigest(result);
    } catch {
      throw new OperateError(
        'E_OPERATE_ADVISOR_ISOLATION',
        'Recorded advisor output resultDigest does not match its canonical content.',
      );
    }
    const existingResult = await readFile(
      path.join(path.dirname(target), `${input.cycleId}.${input.role}.json`),
      'utf8',
    )
      .then((raw) => JSON.parse(raw) as OperatingRoleResult)
      .catch(() => null);
    if (existingResult && existingResult.resultDigest !== result.resultDigest) {
      throw new OperateError(
        'E_OPERATE_ADVISOR_ISOLATION',
        `Role ${input.role} already recorded a different result.`,
      );
    }
    await atomicPrivateWrite(
      path.join(path.dirname(target), `${input.cycleId}.${input.role}.json`),
      result,
    );
    // The v1.4 report is the ONLY advisor text persisted verbatim (response.json →
    // the `advisor-report` record → the committed board Markdown), so its soft,
    // secret-SHAPED matches are redacted here rather than rejected — the same
    // treatment the result body's text already received. The identical object is
    // written to disk and committed as the record, so finalize (which re-reads
    // response.json) can never disagree with this record.
    const advisorReport =
      session.protocolVersion === '1.4.0' &&
      submitted &&
      typeof submitted === 'object' &&
      !Array.isArray(submitted)
        ? (redactAdvisorReportText(submitted) as Record<string, unknown>)
        : null;
    if (session.protocolVersion === '1.4.0') {
      await atomicPrivateWrite(
        path.join(path.dirname(target), `${input.cycleId}.${input.role}.response.json`),
        advisorReport ?? submitted,
      );
    }
    // The role's validated result is now durable in its own machine-local file
    // (survives a sibling stalling, restart, lease expiry, and resume). Merging it
    // into the shared session's `recordedRoles`, committing its canonical event,
    // and materializing its projection all mutate cycle-shared state, so they run
    // inside the per-cycle in-process serialization — a concurrent record of a
    // DIFFERENT role can never lose this one (FR1). A successful record also
    // refreshes the lease forward from now (T-008): steady progress across a
    // multi-role dispatch keeps the session alive without a separate keep-alive
    // call, while an idle session past the refreshed window still lapses.
    const target2 = target;
    const updated = await withInProcessSessionLock(target2, async () => {
      const merged = await commitSessionWrite(target2, {
        projectRoot: input.projectRoot,
        cycleId: input.cycleId as string,
        localRoot: input.localRoot,
        lease: input.lease as string,
        idempotencyKey: input.idempotencyKey as string,
        evidenceDigest: input.evidenceDigest,
        nowMs,
        apply: (current) => ({
          ...current,
          state: 'recording',
          recordedRoles: [...new Set([...current.recordedRoles, input.role as string])].sort(),
          expiresAt: new Date(nowMs + leaseDurationMs).toISOString(),
        }),
      });
      // FR4/FR5: commit the canonical `advisory.recorded` event and refresh the
      // readable projection now, so `planr operate report`/`status` and
      // `.planr/operate/cycles/<id>/` reflect this lens' real analysis before
      // Chair runs — not only at finalize.
      await materializeRecordedRole({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        cycleId: input.cycleId as string,
        session: merged,
        result,
        advisorReport,
      });
      return merged;
    });
    // SPEC-005 T-019 (FR5/FR13): a citation-rejected lens commits a quiet result;
    // persist the governed gaps the citation gate opened so the Chair board — built
    // by a later `run` continuation, after this role is recorded and never
    // re-dispatched — can reconstruct the `citation-rejected` outcome from committed
    // state instead of rendering a false-clean `recorded-quiet`. Runs after the role
    // is materialized (its `advisory.recorded` event committed), acquiring the
    // event-store lock itself and idempotent per role, so a resume/retry never
    // duplicates. Empty on the normal healthy path (no citation rejection → no gaps).
    await persistRecordedRoleGaps({
      projectRoot: input.projectRoot,
      localRoot: input.localRoot,
      cycleId: input.cycleId as string,
      roleId: input.role as string,
      gaps: recordGaps,
      correlationId: input.idempotencyKey as string,
    });
    // FR7: the per-role result is now durably committed, so any OpenPlanr-owned
    // scratch this cycle used as a handoff is redundant. Clean only confirmed
    // owned scratch (a no-op on the normal stdin path, which writes none).
    await cleanOperatingScratch(
      resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot }),
      input.cycleId as string,
    );
    return {
      recorded: input.role,
      result,
      ...(recordGaps.length > 0 ? { citationGaps: recordGaps } : {}),
      ...(recordNotEvaluated ? { notEvaluated: true } : {}),
      session: sessionView(updated, leaseDurationMs),
      leaseStatus: adapterLeaseStatus(updated, nowMs),
      handoff: await adapterHandoff(updated),
    };
  }
  if (session.state === 'cancelled') {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      'A cancelled adapter session cannot be finalized.',
      { recoveryCommand: retryRunCommand(session) },
    );
  }
  if (session.state === 'finalized') {
    const summaries = await Promise.all(
      session.recordedRoles.map((role) =>
        readFile(path.join(path.dirname(target), `${input.cycleId}.${role}.json`), 'utf8').then(
          (raw) => {
            const result = JSON.parse(raw) as OperatingRoleResult;
            return {
              roleId: result.roleId,
              outcome: result.outcome,
              inputDigest: result.inputDigest,
              resultDigest: result.resultDigest,
            };
          },
        ),
      ),
    );
    return {
      session: sessionView(session, leaseDurationMs),
      results: summaries,
      leaseStatus: adapterLeaseStatus(session, nowMs),
      handoff: await adapterHandoff(session),
    };
  }
  // T-020: a role is terminal for finalize once it recorded a result OR was
  // governed terminal `not_evaluated` (a lens abandoned after a genuine stall).
  // Only an in-flight lens — never dispatched to a terminal outcome — blocks
  // finalize, matching the T-001 wire contract that accepts an all-terminal board.
  const notEvaluatedRoles = session.notEvaluatedRoles ?? {};
  const missingRoles = session.roles.filter(
    (role) => !session.recordedRoles.includes(role) && !(role in notEvaluatedRoles),
  );
  if (missingRoles.length > 0) {
    throw new OperateError(
      'E_OPERATE_ADVISOR_FAILED',
      `Adapter finalize is incomplete; missing roles: ${missingRoles.join(', ')}.`,
    );
  }
  const results = await Promise.all(
    session.recordedRoles.map((role) =>
      readFile(path.join(path.dirname(target), `${input.cycleId}.${role}.json`), 'utf8').then(
        (raw) => JSON.parse(raw) as OperatingRoleResult,
      ),
    ),
  );
  for (const result of results) {
    await assertOperatingArtifact('operating-role-result', result);
    let digestValid = true;
    try {
      (await loadOperatingProtocol()).validateOperatingRoleResultDigest(result);
    } catch {
      digestValid = false;
    }
    if (result.inputDigest !== session.roleInputDigests[result.roleId] || !digestValid) {
      throw new OperateError(
        'E_OPERATE_ADVISOR_ISOLATION',
        `Finalized result for ${result.roleId} failed digest binding.`,
      );
    }
  }
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const initial = await store.replay();
  await withOperatingLock(
    input.projectRoot,
    {
      projectKey: operatingProjectKey(input.projectRoot),
      expectedEventHead: initial.eventHead,
      currentEventHead: initial.eventHead,
      localRoot: input.localRoot,
    },
    async (lock) => {
      let head = initial.eventHead;
      const existing = new Map(
        (await readPersistedOperatingRoleResults(store, input.cycleId as string)).map((result) => [
          result.roleId,
          result,
        ]),
      );
      for (const result of [...results].sort((left, right) =>
        left.roleId.localeCompare(right.roleId),
      )) {
        const prior = existing.get(result.roleId);
        if (prior) {
          if (prior.resultDigest !== result.resultDigest) {
            throw new OperateError(
              'E_OPERATE_ADVISOR_ISOLATION',
              `Cycle ${input.cycleId} already committed a different ${result.roleId} result.`,
            );
          }
          continue;
        }
        const record = await store.putRecord(
          'advisor-result',
          result as unknown as Record<string, unknown>,
          {
            correlationId: session.idempotencyKey,
          },
        );
        const advisorReport =
          session.protocolVersion === '1.4.0'
            ? await readFile(
                path.join(path.dirname(target), `${input.cycleId}.${result.roleId}.response.json`),
                'utf8',
              )
                .then((raw) => JSON.parse(raw) as Record<string, unknown>)
                .catch(() => null)
            : null;
        const advisorReportRecord = advisorReport
          ? await store.putRecord('advisor-report', advisorReport, {
              correlationId: session.idempotencyKey,
            })
          : null;
        const runtimeBinding = (await adapterHandoff(session)).binding;
        const event = await store.append({
          type: 'advisory.recorded',
          cycleId: input.cycleId as string,
          entityId: `${input.cycleId}-${result.roleId}`,
          correlationId: session.idempotencyKey,
          evidenceRefs: result.proposals.flatMap((proposal) => proposal.evidenceRefs),
          payload: {
            recordDigest: record.digest,
            ...(advisorReportRecord ? { advisorReportDigest: advisorReportRecord.digest } : {}),
            roleId: result.roleId,
            runtimeBinding: {
              runtime: runtimeBinding.runtime,
              runtimeBinding: runtimeBinding.runtimeBinding,
              crossRuntimeFallback: runtimeBinding.crossRuntimeFallback,
              executionMode: runtimeBinding.executionMode,
              assurance: runtimeBinding.assurance,
              toolIsolation: runtimeBinding.toolIsolation,
            },
          },
          ...(session.protocolVersion === '1.4.0' ? { protocolVersion: '1.4.0' as const } : {}),
          expectedHead: head.hash,
          actor: { kind: 'runtime', id: 'operate-adapter' },
        });
        const next = { sequence: event.sequence, hash: event.eventHash };
        await lock.advanceEventHead(head, next);
        head = next;
      }
      await store.writeCheckpoint(await store.state());
    },
  );
  const finalized: PrivateAdvisorSession = { ...session, state: 'finalized' };
  await atomicPrivateWrite(target, finalized);
  // FR7: the cycle's advisory work is fully committed; clear any confirmed
  // OpenPlanr-owned scratch this cycle used as a handoff.
  await cleanOperatingScratch(
    resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot }),
    input.cycleId as string,
  );
  return {
    session: sessionView(finalized, leaseDurationMs),
    results: results.map((result) => ({
      roleId: result.roleId,
      outcome: result.outcome,
      inputDigest: result.inputDigest,
      resultDigest: result.resultDigest,
    })),
    leaseStatus: adapterLeaseStatus(finalized, nowMs),
    handoff: await adapterHandoff(finalized),
  };
}

/**
 * SPEC-005 T-020 (FR13) — the OPERATOR escape, independent of a well-behaved
 * runtime. When a runtime dispatched a lens and then reported nothing at all — it
 * crashed, or does not implement `harness abandon` — the cycle is stranded at
 * `phase: advisors` on every continuation: the stalled lens is never recorded, so
 * it stays runnable-and-required and Chair is never assembled. The only prior
 * recourse was `cycles cancel`, which discards the whole cycle including the
 * siblings that DID record.
 *
 * This governed escape reaches a reviewable cycle without discarding it. It is
 * gated on a LAPSED lease — the legitimate signal that no runtime is actively
 * working the session — and an explicit operator confirmation. It never touches
 * the runtime lifecycle (`harness abandon`/`record`/`finalize`), so it works when
 * the runtime is gone. For each still-unrecorded advisor lens it commits the SAME
 * governed terminal `not_evaluated` gap the runtime path commits
 * (`governTerminalNotEvaluated`), so the next `run` continuation reconstructs the
 * lens `not_evaluated` from committed state and consolidation proceeds. Recorded
 * siblings are never read, re-dispatched, or altered. It fabricates nothing.
 *
 * It does not itself run consolidation — the operator reaches `reviewable` with a
 * following `planr operate run` (offline when no runtime is available), so the
 * choice of a real or offline Chair stays the operator's.
 */
export async function reapStalledOperatingRoles(input: {
  projectRoot: string;
  cycleId: string;
  role?: string;
  reason?: string;
  confirmed?: boolean;
  localRoot?: string;
  now?: () => Date;
}): Promise<{
  cycleId: string;
  reaped: Array<{ roleId: string; reason: string; gapId: string }>;
  alreadyRecorded: string[];
  next: string[];
}> {
  if (!input.confirmed) {
    throw new OperateError(
      'E_OPERATE_AUTHORITY_REQUIRED',
      'Abandoning a stalled lens is a governed action; re-run with --yes to confirm.',
    );
  }
  const nowMs = (input.now?.() ?? new Date()).getTime();
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const state = await store.state();
  const cycle = state.cycles.find((record) => record.id === input.cycleId);
  if (!cycle || !['advising', 'blocked'].includes(cycle.state)) {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      `Cycle ${input.cycleId} must be advising or blocked to abandon a stalled lens.`,
    );
  }
  // Read the machine-local session RAW (never `readAdapterSession`, which throws on
  // a lapsed lease — the exact condition this escape keys on).
  const target = adapterSessionPath(input.projectRoot, input.cycleId, input.localRoot);
  const session = await readFile(target, 'utf8')
    .then((raw) => JSON.parse(raw) as PrivateAdvisorSession)
    .catch(() => null);
  if (!session) {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      `No adapter session exists for cycle ${input.cycleId}; nothing was dispatched to abandon.`,
    );
  }
  if (session.phase !== 'advisors') {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      'Only an advisors-phase session can have stalled lenses abandoned.',
    );
  }
  // The lapsed-lease gate: a still-live lease means the runtime may yet record or
  // heartbeat, so the operator must not race it. Once the lease has lapsed, the
  // runtime is not governing the session and the operator may terminate the
  // lenses it left unrecorded.
  if (!sessionExpired(session, nowMs)) {
    throw new OperateError(
      'E_OPERATE_ADVISOR_ISOLATION',
      'The adapter lease has not lapsed; the runtime may still be working. Wait for the lease to ' +
        'expire, or use `planr operate harness abandon` with the active lease.',
      { recoveryCommand: retryRunCommand(session) },
    );
  }
  const recorded = new Set(session.recordedRoles);
  const alreadyNotEvaluated = new Set(Object.keys(session.notEvaluatedRoles ?? {}));
  const candidates = session.roles.filter(
    (role) => role !== 'chair' && !recorded.has(role) && !alreadyNotEvaluated.has(role),
  );
  const targets = input.role ? candidates.filter((role) => role === input.role) : candidates;
  if (input.role && !session.roles.includes(input.role)) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      `Role ${input.role} was not part of the stalled session.`,
    );
  }
  if (input.role && recorded.has(input.role)) {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      `Role ${input.role} already recorded a result and cannot be abandoned.`,
    );
  }
  const reason =
    input.reason?.trim() ||
    `Operator terminated this lens not_evaluated after its adapter lease lapsed on ` +
      `${new Date(nowMs).toISOString()} with no recorded result.`;
  const reaped: Array<{ roleId: string; reason: string; gapId: string }> = [];
  const notEvaluated: Record<string, string> = { ...(session.notEvaluatedRoles ?? {}) };
  for (const roleId of targets) {
    await governTerminalNotEvaluated({
      projectRoot: input.projectRoot,
      localRoot: input.localRoot,
      cycleId: input.cycleId,
      roleId,
      reason,
      correlationId: session.idempotencyKey,
    });
    // The committed gap is the source of truth; look it back up so the caller can
    // reference the durable governed gap id.
    const gap = (await store.state()).dataGaps.find(
      (entry) =>
        Array.isArray(entry.affectedRoles) && (entry.affectedRoles as string[]).includes(roleId),
    );
    reaped.push({ roleId, reason, gapId: String(gap?.id ?? '') });
    notEvaluated[roleId] = reason;
  }
  // Best-effort: reflect the terminal status in the (already lapsed) machine-local
  // session so an inspecting `harness resume`/handoff reads honestly. The committed
  // gap above — not this file — is what unblocks consolidation, so a failure here
  // is non-fatal.
  if (reaped.length > 0) {
    await atomicPrivateWrite(target, { ...session, notEvaluatedRoles: notEvaluated }).catch(
      () => undefined,
    );
  }
  return {
    cycleId: input.cycleId,
    reaped,
    alreadyRecorded: [...recorded].sort(),
    next: [`planr operate run --cycle-id ${input.cycleId} --offline --yes`],
  };
}
