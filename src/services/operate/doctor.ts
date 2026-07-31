import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDigest } from './canonical.js';
import { operatingProjectKey, readOperatingDispatchModeOverrides } from './config.js';
import { OperatingEventStore } from './event-store.js';
import { guidedSessionStatus } from './interaction/session-service.js';
import { readJournal } from './journal.js';
import { readOperatingLock } from './lock-service.js';
import { detectOperatingStorageLayout } from './migration.js';
import { inspectOperatingProjectionDrift } from './projection-persistence.js';
import { loadOperatingProtocol, operatingPipelineAvailable } from './protocol.js';
import type { OperatingState } from './types.js';
import { resolveOperatingPaths } from './workspace.js';

export interface OperatingDoctorDiagnostic {
  code: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

const EXPECTED_ROLES = [
  'strategy-finance',
  'technology-risk',
  'product-activation',
  'growth-market',
  'operations-customer',
  'chair',
] as const;

const EXPECTED_PROVIDERS = [
  'repository',
  'planr',
  'git',
  'github',
  'linear',
  'file-import',
] as const;

const TERMINAL_JOURNAL_STATES = new Set(['committed', 'rolled-back', 'failed']);

function sameIds(actual: string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    [...actual].sort().join('\0') === [...expected].sort().join('\0')
  );
}

async function diagnoseProtocol(pipelineVersion?: string): Promise<OperatingDoctorDiagnostic> {
  if (!operatingPipelineAvailable()) {
    return {
      code: 'operate-protocol',
      status: 'warn',
      message: 'Operating Board Protocol v1.2 is unavailable in this planning-only installation',
      fix: 'Run `npm install -g openplanr@latest` without `--omit=optional`, then `planr setup --scope user`.',
    };
  }
  try {
    const protocol = await loadOperatingProtocol();
    const roles = protocol.listOperatingRoles();
    const providers = protocol.listOperatingProviders();
    const roleIds = roles.map((entry) => entry.id);
    const providerIds = providers.map((entry) => entry.id);
    const boundariesValid =
      roles.every((entry) => entry.readOnly === true && entry.writeBoundary === 'none') &&
      providers.every((entry) => entry.readOnly === true);
    if (
      !sameIds(roleIds, EXPECTED_ROLES) ||
      !sameIds(providerIds, EXPECTED_PROVIDERS) ||
      !boundariesValid
    ) {
      return {
        code: 'operate-protocol',
        status: 'fail',
        message:
          'Operating Board Protocol v1.2 registries do not match the certified role/provider contract',
        fix: 'Install the exact OpenPlanr release dependencies, then rerun `planr doctor`.',
      };
    }
    return {
      code: 'operate-protocol',
      status: 'pass',
      message: `Operating Board Protocol v1.2 registries are compatible${pipelineVersion ? ` with planr-pipeline ${pipelineVersion}` : ''}`,
    };
  } catch (error) {
    return {
      code: 'operate-protocol',
      status: 'fail',
      message: `Operating Board Protocol v1.2 compatibility check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      fix: 'Install the exact OpenPlanr release dependencies, then rerun `planr doctor`.',
    };
  }
}

async function diagnoseEventState(
  projectRoot: string,
  localRoot: string | undefined,
): Promise<OperatingDoctorDiagnostic[]> {
  const diagnostics: OperatingDoctorDiagnostic[] = [];
  const store = new OperatingEventStore(projectRoot, { localRoot });
  let replay: Awaited<ReturnType<OperatingEventStore['replay']>>;
  let state: OperatingState;
  try {
    replay = await store.replay();
    state = await store.state();
    diagnostics.push({
      code: 'operate-event-replay',
      status: 'pass',
      message: `Operating event chain replays through sequence ${replay.eventHead.sequence}`,
    });
  } catch (error) {
    diagnostics.push({
      code: 'operate-event-replay',
      status: 'fail',
      message: `Operating event replay failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      fix: 'Run `planr operate integrity status`; do not edit events.jsonl by hand.',
    });
    return diagnostics;
  }

  try {
    const projectionDrift = await inspectOperatingProjectionDrift({
      projectRoot,
      state,
    });
    const mismatches = projectionDrift.filter((entry) => entry.status !== 'current');
    diagnostics.push({
      code: 'operate-projection-files',
      status: mismatches.length === 0 ? 'pass' : 'fail',
      message:
        mismatches.length === 0
          ? 'Committed Operating Board projections match the verified event replay'
          : `${mismatches.length} committed Operating Board projection(s) are missing or stale`,
      ...(mismatches.length > 0
        ? {
            fix: 'Run `planr operate cycles recover <cycleId> --yes` to rebuild projections from the verified event chain.',
          }
        : {}),
    });
  } catch (error) {
    diagnostics.push({
      code: 'operate-projection-files',
      status: 'fail',
      message: `Operating projection file validation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      fix: 'Run `planr operate integrity status`, then explicitly recover the affected cycle.',
    });
  }

  try {
    const checkpoint = await store.readCheckpoint();
    if (!checkpoint) {
      diagnostics.push({
        code: 'operate-checkpoint',
        status: 'warn',
        message: 'Operating event chain is valid but no checkpoint has been written',
        fix: 'Run a completed operating mutation or `planr operate integrity enable` to write a checkpoint.',
      });
      diagnostics.push({
        code: 'operate-projection',
        status: 'pass',
        message: 'Operating projection rebuilds deterministically from the event chain',
      });
      return diagnostics;
    }

    const checkpointEvent =
      checkpoint.eventHead.sequence === 0
        ? null
        : replay.events.find((event) => event.sequence === checkpoint.eventHead.sequence);
    const checkpointIsAnchored =
      checkpoint.eventHead.sequence === 0
        ? checkpoint.eventHead.hash === null
        : checkpointEvent?.eventHash === checkpoint.eventHead.hash;
    if (!checkpointIsAnchored || checkpoint.eventHead.sequence > replay.eventHead.sequence) {
      diagnostics.push({
        code: 'operate-checkpoint',
        status: 'fail',
        message: 'Operating checkpoint is not anchored to the verified event chain',
        fix: 'Run `planr operate integrity status`, then explicitly recover the affected cycle.',
      });
      return diagnostics;
    }

    diagnostics.push({
      code: 'operate-checkpoint',
      status: 'pass',
      message: `Operating checkpoint is valid at sequence ${checkpoint.eventHead.sequence}`,
    });

    const protocol = await loadOperatingProtocol();
    const tail = replay.events.filter((event) => event.sequence > checkpoint.eventHead.sequence);
    const resumed = protocol.reduceOperatingEvents(tail, { checkpoint });
    const projectionMatches =
      canonicalDigest(resumed) === canonicalDigest(state) &&
      resumed.eventHead.sequence === replay.eventHead.sequence &&
      resumed.eventHead.hash === replay.eventHead.hash;
    diagnostics.push({
      code: 'operate-projection',
      status: projectionMatches ? 'pass' : 'fail',
      message: projectionMatches
        ? `Checkpoint plus ${tail.length} tail event(s) reproduces the canonical operating projection`
        : 'Checkpoint projection differs from a full replay of the operating event chain',
      ...(!projectionMatches
        ? {
            fix: 'Run `planr operate integrity status`, then rebuild the projection from the verified event chain.',
          }
        : {}),
    });
  } catch (error) {
    diagnostics.push({
      code: 'operate-checkpoint',
      status: 'fail',
      message: `Operating checkpoint validation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      fix: 'Run `planr operate integrity status`; do not replace the checkpoint without reviewing the event head.',
    });
  }
  return diagnostics;
}

async function diagnoseLocks(
  projectRoot: string,
  localRoot: string | undefined,
): Promise<OperatingDoctorDiagnostic> {
  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  const entries = (await readdir(paths.locks, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.lock'))
    .map((entry) => path.join(paths.locks, entry.name));
  const malformed: string[] = [];
  const stale: string[] = [];
  const active: string[] = [];
  const expectedProjectKey = operatingProjectKey(projectRoot);
  for (const target of entries) {
    try {
      const record = await readOperatingLock(target);
      if (record.projectKey !== expectedProjectKey) {
        malformed.push(path.basename(target));
      } else if (Date.parse(record.leaseExpiresAt) < Date.now()) {
        stale.push(path.basename(target));
      } else {
        active.push(path.basename(target));
      }
    } catch {
      malformed.push(path.basename(target));
    }
  }
  if (malformed.length > 0) {
    return {
      code: 'operate-locks',
      status: 'fail',
      message: `${malformed.length} operating lock(s) are malformed or belong to another project`,
      fix: 'Inspect the lock owner and use `planr operate cycles recover`; never delete an unverified lock.',
    };
  }
  if (stale.length > 0) {
    return {
      code: 'operate-locks',
      status: 'warn',
      message: `${stale.length} operating lock lease(s) are stale`,
      fix: 'Run `planr operate cycles recover <cycleId> --yes` so ownership is revalidated before cleanup.',
    };
  }
  return {
    code: 'operate-locks',
    status: 'pass',
    message:
      active.length > 0
        ? `${active.length} active operating lock lease(s) are structurally valid`
        : 'No stale operating lock leases detected',
  };
}

async function journalPaths(projectRoot: string, localRoot: string | undefined): Promise<string[]> {
  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  const result: string[] = [];
  for (const entry of await readdir(paths.transactions, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) result.push(path.join(paths.transactions, entry.name, 'journal.json'));
  }
  for (const entry of await readdir(paths.journals, { withFileTypes: true }).catch(() => [])) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      result.push(path.join(paths.journals, entry.name));
    }
  }
  return [...new Set(result)].sort();
}

async function diagnoseJournals(
  projectRoot: string,
  localRoot: string | undefined,
): Promise<OperatingDoctorDiagnostic> {
  const invalid: string[] = [];
  const pending: string[] = [];
  const paths = await journalPaths(projectRoot, localRoot);
  for (const target of paths) {
    try {
      const journal = await readJournal(target);
      if (!TERMINAL_JOURNAL_STATES.has(journal.state)) pending.push(journal.transactionId);
    } catch {
      invalid.push(path.basename(path.dirname(target)));
    }
  }
  if (invalid.length > 0) {
    return {
      code: 'operate-journals',
      status: 'fail',
      message: `${invalid.length} operating transaction journal(s) failed validation`,
      fix: 'Export diagnostics and inspect the transaction backups before attempting recovery.',
    };
  }
  if (pending.length > 0) {
    return {
      code: 'operate-journals',
      status: 'warn',
      message: `${pending.length} operating transaction journal(s) require recovery`,
      fix: 'Run `planr operate cycles recover <cycleId> --yes` to roll back incomplete transactions safely.',
    };
  }
  return {
    code: 'operate-journals',
    status: 'pass',
    message: 'Operating transaction journals are terminal and schema-valid',
  };
}

/**
 * Additive Protocol v1.3 (FR10 / E-010) check: detect the on-disk storage
 * layout (SPEC-002 v1.2 vs the v1.3 `.state/` view) and name any inconsistency
 * — an interrupted migration that left the v1.3 view alongside SPEC-002 residue,
 * or a project still on the legacy layout — with the automatic-migration repair.
 */
async function diagnoseStorageLayout(
  projectRoot: string,
  localRoot: string | undefined,
): Promise<OperatingDoctorDiagnostic> {
  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  const layout = await detectOperatingStorageLayout(projectRoot, { localRoot });
  // SPEC-002 internals that must not coexist with the v1.3 `.state/` view: the
  // root events log, the per-digest-prefix records tree, and the checkpoint dir.
  const residue = [
    path.join(paths.root, 'events.jsonl'),
    path.join(paths.root, 'records'),
    path.join(paths.root, 'checkpoints'),
  ].filter((target) => existsSync(target));
  if (layout === 'v1.3' && residue.length > 0) {
    return {
      code: 'operate-layout',
      status: 'warn',
      message: `Operating storage is on the v1.3 \`.state/\` layout but ${residue.length} SPEC-002 residue path(s) remain from an interrupted migration`,
      fix: 'Run `planr operate migrate apply --yes` to clear the residual SPEC-002 layout.',
    };
  }
  if (layout === 'v1.2') {
    return {
      code: 'operate-layout',
      status: 'warn',
      message:
        'Operating storage is on the legacy SPEC-002 layout and has not migrated to the v1.3 `.state/` layout',
      fix: 'Run `planr operate migrate apply --yes` to migrate the storage layout to v1.3.',
    };
  }
  return {
    code: 'operate-layout',
    status: 'pass',
    message:
      layout === 'v1.3'
        ? 'Operating storage is on the v1.3 `.state/` layout with no SPEC-002 residue'
        : 'No Operating Board storage layout is present yet',
  };
}

/**
 * Additive Protocol v1.3 (FR10 / E-010) check: verify every line of the
 * append-only `.state/records.jsonl` is parseable and carries consistent
 * content-address digests. The record digest is a pure function of
 * `(recordType, createdAt, correlationId, contentDigest)` and `contentDigest`
 * is the canonical digest of the content, so both are recomputed exactly as the
 * write path and `readRecord` do. A v1.2 (unmigrated) project keeps records in
 * the SPEC-002 tree and has no `.state/records.jsonl` yet — that is a pass.
 */
async function diagnoseRecordsLog(
  projectRoot: string,
  localRoot: string | undefined,
): Promise<OperatingDoctorDiagnostic> {
  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  const raw = await readFile(paths.records, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (raw === null) {
    return {
      code: 'operate-records',
      status: 'pass',
      message: 'No v1.3 `.state/records.jsonl` log is present yet',
    };
  }
  let counted = 0;
  for (const [index, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue;
    counted += 1;
    let entry: {
      digest?: unknown;
      contentDigest?: unknown;
      recordType?: unknown;
      createdAt?: unknown;
      correlationId?: unknown;
      content?: unknown;
    };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      return {
        code: 'operate-records',
        status: 'fail',
        message: `Operating \`.state/records.jsonl\` line ${index + 1} is not valid JSON`,
        fix: 'Run `planr operate integrity status`; do not edit .state/records.jsonl by hand.',
      };
    }
    if (
      typeof entry.digest !== 'string' ||
      !entry.digest.startsWith('sha256:') ||
      typeof entry.contentDigest !== 'string' ||
      !entry.contentDigest.startsWith('sha256:')
    ) {
      return {
        code: 'operate-records',
        status: 'fail',
        message: `Operating \`.state/records.jsonl\` line ${index + 1} is missing its content-address digests`,
        fix: 'Run `planr operate integrity status`; do not edit .state/records.jsonl by hand.',
      };
    }
    const consistent =
      entry.content !== undefined &&
      entry.contentDigest === canonicalDigest(entry.content) &&
      entry.digest ===
        canonicalDigest({
          recordType: entry.recordType,
          createdAt: entry.createdAt,
          correlationId: entry.correlationId,
          contentDigest: entry.contentDigest,
        });
    if (!consistent) {
      return {
        code: 'operate-records',
        status: 'fail',
        message: `Operating \`.state/records.jsonl\` line ${index + 1} digest does not match its content`,
        fix: 'Run `planr operate integrity status`, then recover the affected cycle from the verified event chain.',
      };
    }
  }
  return {
    code: 'operate-records',
    status: 'pass',
    message: `${counted} operating records.jsonl ${
      counted === 1 ? 'entry is' : 'entries are'
    } parseable with consistent content-address digests`,
  };
}

/**
 * Additive Protocol v1.3 (FR10 / E-010) check: the persisted per-project
 * dispatch-mode overrides (machine-local `preferences.json`) must reference only
 * known registry role IDs and `pack`/`mission` modes. Reuses the same strict
 * validation the write path enforces; an invalid map fails closed with the
 * repair rather than throwing out of the doctor run.
 */
async function diagnoseDispatchModes(
  projectRoot: string,
  localRoot: string | undefined,
): Promise<OperatingDoctorDiagnostic> {
  try {
    const overrides = await readOperatingDispatchModeOverrides(projectRoot, { localRoot });
    const count = Object.keys(overrides).length;
    return {
      code: 'operate-dispatch-mode',
      status: 'pass',
      message:
        count === 0
          ? 'No per-project dispatch-mode overrides are configured'
          : `${count} per-project dispatch-mode override(s) reference known roles and valid pack/mission modes`,
    };
  } catch (error) {
    return {
      code: 'operate-dispatch-mode',
      status: 'fail',
      message: `Operating dispatch-mode overrides are invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
      fix: 'Run `planr operate config edit --dispatch-mode-override <roleId>=<pack|mission>` to restore valid overrides.',
    };
  }
}

/**
 * FR11: detect machine-local adapter sessions that are bound to a superseded
 * board generation (their `boardIdentity` no longer matches the committed
 * event-chain genesis) or to a cycle that is no longer present in committed
 * state. These are exactly the sessions that used to dead-end a re-inited board
 * with a misleading `E_OPERATE_ADVISOR_ISOLATION`; they now supersede cleanly,
 * and this diagnostic names the scoped purge so an operator can clear them
 * before the next dispatch. Reads only machine-local session files and never
 * mutates state.
 */
async function diagnoseAdapterSessions(
  projectRoot: string,
  localRoot: string | undefined,
): Promise<OperatingDoctorDiagnostic> {
  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  let boardIdentity = '';
  let committedCycleIds = new Set<string>();
  try {
    const store = new OperatingEventStore(projectRoot, { localRoot });
    const { events } = await store.replay();
    const genesis = events.find((event) => event.previousEventHash === null) ?? events[0];
    boardIdentity = genesis?.eventHash ?? '';
    const state = await store.state();
    committedCycleIds = new Set(state.cycles.map((cycle) => cycle.id));
  } catch {
    // A broken/absent event chain is diagnosed by the event-replay checks;
    // adapter-session staleness is only meaningful against a readable board.
    return {
      code: 'operate-adapter-sessions',
      status: 'pass',
      message: 'No committed board identity is available to validate adapter sessions against yet',
    };
  }
  const entries = (await readdir(paths.advisors, { withFileTypes: true }).catch(() => [])).filter(
    (entry) => entry.isFile() && entry.name.endsWith('.json'),
  );
  const stale: string[] = [];
  for (const entry of entries) {
    const raw = await readFile(path.join(paths.advisors, entry.name), 'utf8').catch(() => null);
    if (raw === null) continue;
    let session: { implementation?: string; boardIdentity?: string; cycleId?: string };
    try {
      session = JSON.parse(raw) as typeof session;
    } catch {
      continue;
    }
    if (session.implementation !== 'openplanr-operate-adapter') continue;
    const boundToBoard = (session.boardIdentity ?? '') === boardIdentity;
    const boundToCommittedCycle =
      typeof session.cycleId === 'string' && committedCycleIds.has(session.cycleId);
    if (!boundToBoard || !boundToCommittedCycle) stale.push(entry.name);
  }
  if (stale.length > 0) {
    return {
      code: 'operate-adapter-sessions',
      status: 'warn',
      message: `${stale.length} machine-local adapter session(s) are bound to a superseded board generation or a cycle absent from committed state`,
      fix: 'Run `planr operate cache purge --yes` to clear the stale adapter sessions before the next dispatch.',
    };
  }
  return {
    code: 'operate-adapter-sessions',
    status: 'pass',
    message:
      'Machine-local adapter sessions are bound to the current board identity and its cycles',
  };
}

/**
 * FR11: detect incremental evidence baselines whose captured `workspaceDigest`
 * no longer matches the committed workspace manifest — a baseline collected
 * against a superseded workspace (for example, a prior board generation). Such a
 * baseline is already rejected on read (recollect deep), so this is a `warn`,
 * not a `fail`; it names the scoped purge that drops the orphaned baselines.
 */
async function diagnoseIncrementalBaselines(
  projectRoot: string,
  localRoot: string | undefined,
): Promise<OperatingDoctorDiagnostic> {
  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  const committed = await readFile(paths.workspace, 'utf8')
    .then((raw) => JSON.parse(raw) as { workspaceDigest?: string })
    .catch(() => null);
  if (!committed?.workspaceDigest) {
    return {
      code: 'operate-incremental-baseline',
      status: 'pass',
      message: 'No committed workspace digest is available to validate incremental baselines yet',
    };
  }
  const directory = path.join(paths.evidence, 'incremental');
  const entries = (await readdir(directory, { withFileTypes: true }).catch(() => [])).filter(
    (entry) => entry.isFile() && entry.name.endsWith('.json'),
  );
  const stale: string[] = [];
  for (const entry of entries) {
    const raw = await readFile(path.join(directory, entry.name), 'utf8').catch(() => null);
    if (raw === null) continue;
    let record: { implementation?: string; workspaceDigest?: string };
    try {
      record = JSON.parse(raw) as typeof record;
    } catch {
      continue;
    }
    if (record.implementation !== 'openplanr-operate-incremental-evidence') continue;
    if ((record.workspaceDigest ?? '') !== committed.workspaceDigest) stale.push(entry.name);
  }
  if (stale.length > 0) {
    return {
      code: 'operate-incremental-baseline',
      status: 'warn',
      message: `${stale.length} incremental evidence baseline(s) no longer match the committed workspace digest and will be recollected deep`,
      fix: 'Run `planr operate cache purge --yes` to drop the stale incremental baselines.',
    };
  }
  return {
    code: 'operate-incremental-baseline',
    status: 'pass',
    message: 'Incremental evidence baselines match the committed workspace digest',
  };
}

export async function diagnoseOperatingBoard(input: {
  projectRoot: string;
  localRoot?: string;
  pipelineVersion?: string;
}): Promise<OperatingDoctorDiagnostic[]> {
  const diagnostics = [await diagnoseProtocol(input.pipelineVersion)];
  const paths = resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot });
  if (!existsSync(paths.root)) return diagnostics;
  if (!operatingPipelineAvailable()) {
    diagnostics.push({
      code: 'operate-integrity',
      status: 'warn',
      message: 'Operating state exists but cannot be validated without Protocol v1.2',
      fix: 'Install the full OpenPlanr package before running or repairing Operating Board state.',
    });
    return diagnostics;
  }
  const sessions = await guidedSessionStatus({
    projectRoot: input.projectRoot,
    localRoot: input.localRoot,
  });
  diagnostics.push({
    code: 'operate-guided-sessions',
    status: sessions.expired > 0 ? 'warn' : 'pass',
    message:
      sessions.expired > 0
        ? `${sessions.expired} expired guided interaction session(s) require explicit cleanup`
        : `${sessions.active} active guided interaction session(s); no expired sessions detected`,
    ...(sessions.expired > 0
      ? { fix: 'Run `planr operate cache purge --yes` after reviewing the cache status.' }
      : {}),
  });
  diagnostics.push(
    ...(await diagnoseEventState(input.projectRoot, input.localRoot)),
    await diagnoseLocks(input.projectRoot, input.localRoot),
    await diagnoseJournals(input.projectRoot, input.localRoot),
    // Additive Protocol v1.3 (FR10 / E-010) diagnostics layered on the
    // SPEC-003 surface: storage-layout version, records-log integrity, and
    // persisted dispatch-mode override validity.
    await diagnoseStorageLayout(input.projectRoot, input.localRoot),
    await diagnoseRecordsLog(input.projectRoot, input.localRoot),
    await diagnoseDispatchModes(input.projectRoot, input.localRoot),
    // FR11: the two staleness detectors for the machine-local caches FR4 binds
    // to board identity — stale adapter sessions and stale incremental baselines.
    await diagnoseAdapterSessions(input.projectRoot, input.localRoot),
    await diagnoseIncrementalBaselines(input.projectRoot, input.localRoot),
  );
  return diagnostics;
}
