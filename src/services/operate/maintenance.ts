import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type AgentNativeAdvisorResponse,
  advisorResponseContractDetails,
  assertAdvisorOutputMatchesBrief,
  buildOperatingMandate,
  createNativeMissionOperatingRoleResult,
  type OperatingMandate,
} from './advisors.js';
import { canonicalDigest, canonicalize, sha256Digest } from './canonical.js';
import { operatingProjectKey, readOperatingAdapterLeaseDurationMs } from './config.js';
import { gateRecordedProposalCitations } from './engine.js';
import { OperatingEventStore } from './event-store.js';
import { OperatingEvidenceCache } from './evidence-cache.js';
import { guidedSessionStatus, purgeGuidedSessions } from './interaction/session-service.js';
import { assertCommittedOperatingView, recoverOperatingTransactions } from './journal.js';
import { withOperatingLock } from './lock-service.js';
import { assertOperatingArtifact, loadOperatingProtocol } from './protocol.js';
import { containsSecret, redactSensitiveText } from './redaction.js';
import {
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

async function adapterHandoff(session: PrivateAdvisorSession): Promise<OperatingAdapterHandoff> {
  const recorded = new Set(session.recordedRoles);
  const state: OperatingAdapterHandoff['state'] =
    session.state === 'cancelled'
      ? 'cancelled'
      : session.state === 'finalized'
        ? 'continue-required'
        : session.roles.some((role) => !recorded.has(role))
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
      status: recorded.has(role) ? 'recorded' : 'pending',
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
  return {
    removed:
      removed.length +
      sessions.removed +
      board.removedAdvisorSessions +
      board.removedIncrementalBaselines,
    evidence: { removed: removed.length, entries: removed },
    sessions,
    adapterSessions: { removed: board.removedAdvisorSessions },
    incrementalBaselines: { removed: board.removedIncrementalBaselines },
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
  action: 'prepare' | 'record' | 'resume' | 'finalize' | 'cancel';
  cycleId?: string;
  evidenceDigest?: string;
  lease?: string;
  idempotencyKey?: string;
  role?: string;
  stdin?: string;
  localRoot?: string;
  /**
   * Injectable clock (FR10 / T-008). Defaults to wall-clock. Tests supply a
   * deterministic clock to prove the lease refreshes forward on `record` and that
   * expiry is still enforced once the refreshed window lapses.
   */
  now?: () => Date;
}): Promise<unknown> {
  if (!input.cycleId || !input.idempotencyKey) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'Adapter calls require --cycle-id and --idempotency-key.',
    );
  }
  const nowMs = (input.now?.() ?? new Date()).getTime();
  // The lease window is a machine-local preference (default 15 minutes). Resolved
  // once so both the fresh `prepare` expiry and the per-`record` refresh use the
  // same configured duration.
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
            leaseStatus: adapterLeaseStatus(normalized, nowMs),
            handoff: await adapterHandoff(normalized),
          };
        }
        if (!sessionExpired(normalized) && ['prepared', 'recording'].includes(normalized.state)) {
          throw new OperateError(
            'E_OPERATE_ADVISOR_ISOLATION',
            `Cycle ${input.cycleId} already has an active adapter session with another binding.`,
            { recoveryCommand: retryRunCommand(normalized) },
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
            const built = await Promise.all(
              (roles as OperatingRoleId[]).map(
                async (roleId) =>
                  [roleId, await buildOperatingMandate({ roleId, roots, runtime })] as const,
              ),
            );
            return Object.fromEntries(built) as Record<string, OperatingMandate>;
          })();
    // Every requested role dispatches; the bound role set is exactly `roles`.
    const dispatchedRoles = roles;
    const roleBriefs: Record<string, OperatingAdvisorBrief> = Object.fromEntries(
      Object.keys(roleMandates).map((role) => [role, protocol.createOperatingAdvisorBrief(role)]),
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
      roleMandates,
      roleInputDigests,
    };
    await atomicPrivateWrite(target, session);
    return {
      ...session,
      mandates: roleMandates,
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
        session: adapterSessionSummary(session),
        leaseStatus: adapterLeaseStatus(session, nowMs),
        handoff: await adapterHandoff(session),
      };
    }
    const cancelled = { ...session, state: 'cancelled' as const };
    await atomicPrivateWrite(target, cancelled);
    return {
      session: adapterSessionSummary(cancelled),
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
    const currentHandoff = await adapterHandoff(session);
    const authorizedRecord = currentHandoff.next.find((action) =>
      ['adapter.record', 'harness.record'].includes(action.action),
    );
    if (!authorizedRecord || authorizedRecord.role !== input.role) {
      throw new OperateError(
        'E_OPERATE_ADVISOR_ISOLATION',
        `Role ${input.role} is not the current serialized adapter record action.`,
        {
          expectedRole: authorizedRecord?.role ?? null,
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
      for (const field of submittedText) {
        if (typeof field.value === 'string' && containsSecret(field.value)) {
          throw new OperateError(
            'E_OPERATE_SECRET_DETECTED',
            `Native advisor response contains a secret at ${field.location}; nothing was persisted.`,
            { roleId: input.role, field: field.location },
          );
        }
      }
      const mandate = session.roleMandates[input.role];
      try {
        const gated = await createNativeMissionOperatingRoleResult({
          mandate,
          cycleId: input.cycleId as string,
          response: submitted,
          runtime: session.runtime,
          pinnedRevision: session.pinnedRevision,
          resolveCitations: async (roleResults) => {
            const [workspace, sensitivityCeiling, config] = await Promise.all([
              refreshOperatingWorkspaceManifest(input.projectRoot, {
                localRoot: input.localRoot,
              }),
              readAdapterSensitivityCeiling(input.projectRoot, input.localRoot),
              readOperatingConfig(input.projectRoot, { localRoot: input.localRoot }).catch(
                () => null,
              ),
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
    // This rejects rather than redacts: the result is bound by resultDigest, so
    // rewriting the content in place would invalidate the binding that proves
    // the runtime returned exactly this. A runtime that emits a secret must
    // produce a clean result, not have one silently edited underneath it.
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
    for (const field of generatedText) {
      if (typeof field.value === 'string' && containsSecret(field.value)) {
        throw new OperateError(
          'E_OPERATE_SECRET_DETECTED',
          `Recorded advisor output contains a secret at ${field.location}; nothing was persisted.`,
          { roleId: input.role, field: field.location },
        );
      }
    }
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
    if (session.protocolVersion === '1.4.0') {
      await atomicPrivateWrite(
        path.join(path.dirname(target), `${input.cycleId}.${input.role}.response.json`),
        submitted,
      );
    }
    // A successful record refreshes the lease forward from now (FR10 / T-008):
    // an advisor making steady progress across a multi-role dispatch keeps its
    // session alive without a separate keep-alive call, while a session that goes
    // idle past the refreshed window still lapses and is rejected on the next call.
    const updated: PrivateAdvisorSession = {
      ...session,
      state: 'recording',
      recordedRoles: [...new Set([...session.recordedRoles, input.role])].sort(),
      expiresAt: new Date(nowMs + leaseDurationMs).toISOString(),
    };
    await atomicPrivateWrite(target, updated);
    return {
      recorded: input.role,
      result,
      ...(recordGaps.length > 0 ? { citationGaps: recordGaps } : {}),
      ...(recordNotEvaluated ? { notEvaluated: true } : {}),
      session: adapterSessionSummary(updated),
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
      session: adapterSessionSummary(session),
      results: summaries,
      leaseStatus: adapterLeaseStatus(session, nowMs),
      handoff: await adapterHandoff(session),
    };
  }
  const missingRoles = session.roles.filter((role) => !session.recordedRoles.includes(role));
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
  return {
    session: adapterSessionSummary(finalized),
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
