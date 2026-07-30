import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertAdvisorOutputMatchesBrief,
  buildAdvisorOperatingContext,
  createNativeOperatingRoleResult,
  createOperatingAdvisorPack,
  type OperatingAdvisorPack,
} from './advisors.js';
import { canonicalDigest, canonicalize, sha256Digest } from './canonical.js';
import { operatingProjectKey } from './config.js';
import { buildChairEvidence } from './engine.js';
import { OperatingEventStore } from './event-store.js';
import { OperatingEvidenceCache } from './evidence-cache.js';
import { purgeStaleEvidenceClassifications } from './evidence-classifications.js';
import { listEvidenceDiagnostics } from './evidence-diagnostics.js';
import { evaluateEvidenceReadiness } from './evidence-readiness.js';
import { guidedSessionStatus, purgeGuidedSessions } from './interaction/session-service.js';
import { assertCommittedOperatingView, recoverOperatingTransactions } from './journal.js';
import { withOperatingLock } from './lock-service.js';
import { assertOperatingArtifact, loadOperatingProtocol } from './protocol.js';
import { containsSecret, redactSensitiveText } from './redaction.js';
import {
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  OperateError,
  type OperatingAdvisorBrief,
  type OperatingEvidence,
  type OperatingRecoveryRecord,
  type OperatingRoleId,
  type OperatingRoleResult,
  type OperatingSensitivity,
} from './types.js';
import { resolveContainedPath, resolveOperatingPaths } from './workspace.js';

interface PrivateAdvisorSession {
  implementation: 'openplanr-operate-adapter';
  cycleId: string;
  evidenceDigest: string;
  runtime?: string;
  lease: string;
  idempotencyKey: string;
  state: 'prepared' | 'recording' | 'finalized' | 'cancelled';
  expiresAt: string;
  roles: string[];
  recordedRoles: string[];
  roleInputDigests: Record<string, `sha256:${string}`>;
  roleBriefs: Record<string, OperatingAdvisorBrief>;
  rolePacks: Record<string, OperatingAdvisorPack>;
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
    const diagnostics = await listEvidenceDiagnostics({
      projectRoot: input.projectRoot,
      localRoot: input.localRoot,
    });
    const classifications = await purgeStaleEvidenceClassifications({
      projectRoot: input.projectRoot,
      localRoot: input.localRoot,
    });
    return {
      evidence: await cache.status(),
      sessions: await guidedSessionStatus({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
      }),
      diagnostics: {
        candidates: diagnostics.length,
        classified: diagnostics.filter((entry) => entry.classification).length,
        staleClassifications: classifications.stale,
      },
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
  const classifications = await purgeStaleEvidenceClassifications({
    projectRoot: input.projectRoot,
    localRoot: input.localRoot,
    purge: true,
  });
  return {
    removed: removed.length + sessions.removed + classifications.purged,
    evidence: { removed: removed.length, entries: removed },
    sessions,
    classifications,
  };
}

function integrityKeyPath(projectRoot: string, localRoot?: string): string {
  return path.join(resolveOperatingPaths(projectRoot, { localRoot }).localRoot, 'integrity.key');
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
          checkpoint: '.planr/operate/checkpoints/current.json',
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
            path: '.planr/operate/checkpoints/current.json',
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

async function readAdapterSession(
  projectRoot: string,
  cycleId: string,
  localRoot?: string,
): Promise<PrivateAdvisorSession> {
  const session = JSON.parse(
    await readFile(adapterSessionPath(projectRoot, cycleId, localRoot), 'utf8'),
  ) as PrivateAdvisorSession;
  if (
    session.implementation !== 'openplanr-operate-adapter' ||
    Date.parse(session.expiresAt) <= Date.now()
  ) {
    throw new OperateError('E_OPERATE_ADVISOR_FAILED', 'Adapter session is invalid or expired.');
  }
  return session;
}

function assertAdapterBinding(
  session: PrivateAdvisorSession,
  lease: string,
  idempotencyKey: string,
): void {
  if (session.lease !== lease || session.idempotencyKey !== idempotencyKey) {
    throw new OperateError(
      'E_OPERATE_ADVISOR_ISOLATION',
      'Adapter lease or idempotency binding does not match the prepared session.',
    );
  }
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
}): Promise<unknown> {
  if (!input.cycleId || !input.idempotencyKey) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'Adapter calls require --cycle-id and --idempotency-key.',
    );
  }
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
    const cycle = state.cycles.find((record) => record.id === input.cycleId);
    if (!cycle || !['advising', 'blocked'].includes(cycle.state)) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        'Adapter prepare requires an advising or blocked cycle.',
      );
    }
    const existing = await readFile(target, 'utf8')
      .then((raw) => JSON.parse(raw) as PrivateAdvisorSession)
      .catch(() => null);
    if (existing?.idempotencyKey === input.idempotencyKey) return existing;
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
    const roleEvidence =
      roles[0] === 'chair'
        ? buildChairEvidence(
            baseEvidence,
            await readPersistedOperatingRoleResults(store, input.cycleId),
            new Date().toISOString(),
          )
        : baseEvidence;
    const readiness = await evaluateEvidenceReadiness({
      cycleId: input.cycleId,
      evidence: roleEvidence,
      enabledRoles: roles,
      now: new Date(),
    });
    const unready = readiness.roles.filter((role) => !role.modelCallAllowed);
    if (unready.length > 0) {
      throw new OperateError(
        'E_OPERATE_EVIDENCE_NOT_READY',
        `Native advisor preparation is blocked for: ${unready
          .map((role) => role.roleId)
          .sort()
          .join(', ')}.`,
      );
    }
    const context = await buildAdvisorOperatingContext({
      charterPath: resolveOperatingPaths(input.projectRoot, {
        localRoot: input.localRoot,
      }).charter,
      state,
      cycleId: input.cycleId,
    });
    const rolePacks = Object.fromEntries(
      await Promise.all(
        readiness.roles.map(async (role) => [
          role.roleId,
          await createOperatingAdvisorPack({
            cycleId: input.cycleId as string,
            role,
            evidence: roleEvidence,
            context,
          }),
        ]),
      ),
    ) as Record<string, OperatingAdvisorPack>;
    const roleBriefs = Object.fromEntries(
      Object.entries(rolePacks).map(([role, pack]) => [role, pack.roleBrief]),
    );
    const session: PrivateAdvisorSession = {
      implementation: 'openplanr-operate-adapter',
      cycleId: input.cycleId,
      evidenceDigest: input.evidenceDigest,
      runtime: await readFile(
        path.join(
          resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot }).localRoot,
          'preferences.json',
        ),
        'utf8',
      )
        .then((raw) => String((JSON.parse(raw) as { runtime?: unknown }).runtime ?? 'auto'))
        .catch(() => 'auto'),
      lease: randomBytes(32).toString('base64url'),
      idempotencyKey: input.idempotencyKey,
      state: 'prepared',
      expiresAt: new Date(Date.now() + 15 * 60 * 1_000).toISOString(),
      roles,
      recordedRoles: [],
      roleBriefs,
      rolePacks,
      roleInputDigests: Object.fromEntries(
        roles.map((role) => [role, rolePacks[role].inputDigest]),
      ),
    };
    await atomicPrivateWrite(target, session);
    return session;
  }
  if (!input.lease) {
    throw new OperateError('E_OPERATE_ADVISOR_ISOLATION', 'Adapter lease is required.');
  }
  const session = await readAdapterSession(input.projectRoot, input.cycleId, input.localRoot);
  assertAdapterBinding(session, input.lease, input.idempotencyKey);
  if (input.action === 'resume') return session;
  if (input.action === 'cancel') {
    const cancelled = { ...session, state: 'cancelled' as const };
    await atomicPrivateWrite(target, cancelled);
    return cancelled;
  }
  if (input.action === 'record') {
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
    const submitted = JSON.parse(input.stdin) as unknown;
    const submittedRecord =
      submitted && typeof submitted === 'object' ? (submitted as Record<string, unknown>) : {};
    const result =
      submittedRecord.kind === 'operating-role-result'
        ? (submitted as OperatingRoleResult)
        : await createNativeOperatingRoleResult({
            pack: session.rolePacks[input.role],
            response: submitted,
            runtime: session.runtime ?? 'native-runtime',
          });
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
    const updated: PrivateAdvisorSession = {
      ...session,
      state: 'recording',
      recordedRoles: [...new Set([...session.recordedRoles, input.role])].sort(),
    };
    await atomicPrivateWrite(target, updated);
    return { recorded: input.role, result, session: updated };
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
        const event = await store.append({
          type: 'advisory.recorded',
          cycleId: input.cycleId as string,
          entityId: `${input.cycleId}-${result.roleId}`,
          correlationId: session.idempotencyKey,
          evidenceRefs: result.proposals.flatMap((proposal) => proposal.evidenceRefs),
          payload: { recordDigest: record.digest },
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
  return { session: finalized, results };
}
