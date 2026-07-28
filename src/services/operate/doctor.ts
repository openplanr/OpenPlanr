import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDigest } from './canonical.js';
import { operatingProjectKey } from './config.js';
import { OperatingEventStore } from './event-store.js';
import { readJournal } from './journal.js';
import { readOperatingLock } from './lock-service.js';
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
  diagnostics.push(
    ...(await diagnoseEventState(input.projectRoot, input.localRoot)),
    await diagnoseLocks(input.projectRoot, input.localRoot),
    await diagnoseJournals(input.projectRoot, input.localRoot),
  );
  return diagnostics;
}
