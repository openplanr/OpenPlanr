import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { assertOperatePathCustody, assertOperateTreeCustody } from './path-custody.js';

const STORE_FORMAT = 'openplanr-operate-store';
const STORE_VERSION = 3;
const CUSTODY_FORMAT = 'openplanr-operate-custody';
const CUSTODY_VERSION = 2;
const LOCK_FORMAT = 'openplanr-operate-lock';
const PROTOCOL_VERSION = '2.0.0';
const CURRENT_FILENAME = 'CURRENT';
const CUSTODY_FILENAME = 'CUSTODY.json';
const GENERATIONS_DIRECTORY = 'generations';
const LOCK_FILENAME = 'LOCK';
const RECOVERY_LOCK_FILENAME = 'RECOVERY';
const HEAD_JOURNAL_FILENAME = 'HEADS.jsonl';
const STALE_LOCKS_DIRECTORY = 'stale-locks';
const LOCK_TTL_MS = 120_000;
const READ_STABILITY_TIMEOUT_MS = 5_000;
const READ_STABILITY_MAX_ATTEMPTS = 64;
const READ_STABILITY_POLL_MS = 10;
const READ_STABILITY_MAX_POLL_MS = 50;
const GENERATION_PATTERN = /^gen_[a-f0-9]{32}$/u;
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9._-]+$/u;

type JsonRecord = Record<string, unknown>;
type DeliveryRoute = 'contained-execution' | 'planning-work' | 'human-external' | 'observe-only';

export type OperateIntegrityBoundary = {
  model: 'project-local-integrity';
  detects: readonly [
    'accidental-corruption',
    'partial-or-incoherent-rewrite',
    'journal-truncation',
    'foreign-project-copy',
  ];
  authenticity: 'not-provided';
  outsideBoundary: readonly ['fully-coordinated-same-user-offline-rewrite'];
  futureRequirement: 'externally-anchored-or-signed-custody';
};

/**
 * Honest threat boundary for the credential-free project-local store. The
 * application cross-checks these files for coherence, but a process with the
 * same write authority can replace every anchor consistently.
 */
export const OPERATE_INTEGRITY_BOUNDARY: OperateIntegrityBoundary = Object.freeze({
  model: 'project-local-integrity',
  detects: Object.freeze([
    'accidental-corruption',
    'partial-or-incoherent-rewrite',
    'journal-truncation',
    'foreign-project-copy',
  ] as const),
  authenticity: 'not-provided',
  outsideBoundary: Object.freeze(['fully-coordinated-same-user-offline-rewrite'] as const),
  futureRequirement: 'externally-anchored-or-signed-custody',
});

export type OperatePreferences = {
  selectedScopeId: string | null;
  selectedDomainId: string | null;
  selectedDomainVersion: string | null;
  lastCycleId: string | null;
  reviewOwners: Record<string, string>;
  cycleModes: Record<string, 'assignment' | 'lifecycle'>;
  cycleDeliveryRoutes: Record<string, DeliveryRoute>;
  assignmentArtifactIds: Record<string, string>;
  cycleRoleAssignments: Record<string, Record<string, string>>;
  cycleIntelligencePlanIds: Record<string, string>;
  actorMemberships: Record<
    string,
    {
      actorId: string;
      scopeId: string;
      domainId: string;
      domainVersion: string;
      role: 'owner';
    }
  >;
};

export type OperateStoredRuntime = {
  generation: string | null;
  baseState: JsonRecord;
  state: JsonRecord;
  events: JsonRecord[];
  artifacts: Map<string, Uint8Array>;
  preferences: OperatePreferences;
};

/** Replay functions must be finite, deterministic, pure, and free of external I/O. */
export type OperateReplay = (input: {
  baseState: JsonRecord;
  events: JsonRecord[];
  artifacts: Map<string, Uint8Array>;
}) => Promise<JsonRecord>;

export type OperateReplayProofCustody = Readonly<{
  currentGeneration: string;
  stateCanonicalHash: string;
  eventHead: Readonly<{ sequence: number; hash: string | null }>;
  artifactHashes: readonly Readonly<{ artifactId: string; rawHash: string }>[];
}>;

export type OperateRecoveryInspection = {
  status: 'empty' | 'healthy' | 'repairable' | 'corrupt' | 'incompatible' | 'locked';
  currentGeneration: string | null;
  recoverableGeneration: string | null;
  generationCount: number;
  reason: string;
  allowedRecovery:
    | 'none'
    | 'restore-generation'
    | 'clear-stale-lock'
    | 'upgrade-required'
    | 'inspect-project';
  lock: {
    status: 'absent' | 'live' | 'stale' | 'invalid';
    ownerPid: number | null;
    nonce: string | null;
    expiresAt: string | null;
    reason: string;
  };
  integrityBoundary: OperateIntegrityBoundary;
};

type OperateRecoveryInspectionCore = Omit<OperateRecoveryInspection, 'integrityBoundary'>;

type ScopeBinding = {
  cycleId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
};

type ArtifactManifestEntry = {
  artifactId: string;
  rawHash: string;
  sizeBytes: number;
  file: string;
};

type StoreManifest = {
  format: typeof STORE_FORMAT;
  storeVersion: typeof STORE_VERSION;
  protocolVersion: typeof PROTOCOL_VERSION;
  projectIdentity: string;
  custodyNonce: string;
  generation: string;
  parentGeneration: string | null;
  parentIntegrityHash: string | null;
  createdAt: string;
  eventCount: number;
  eventsHash: string;
  replayIndexHash: string;
  bindings: ScopeBinding[];
  baseState: JsonRecord;
  state: JsonRecord;
  preferences: OperatePreferences;
  artifacts: ArtifactManifestEntry[];
  integrityHash: string;
};

type CustodyAnchor = {
  format: typeof CUSTODY_FORMAT;
  custodyVersion: typeof CUSTODY_VERSION;
  projectIdentity: string;
  custodyNonce: string;
  headGeneration: string;
  headIntegrityHash: string;
  bindings: ScopeBinding[];
  journalSequence: number;
  journalRecordHash: string;
  updatedAt: string;
};

type HeadJournalRecord = {
  format: 'openplanr-operate-head-journal';
  journalVersion: 1;
  sequence: number;
  projectIdentity: string;
  custodyNonce: string;
  generation: string;
  integrityHash: string;
  bindings: ScopeBinding[];
  previousRecordHash: string | null;
  createdAt: string;
  recordHash: string;
};

type LockRecord = {
  format: typeof LOCK_FORMAT;
  projectIdentity: string;
  nonce: string;
  pid: number;
  createdAt: string;
  expiresAt: string;
};

type LockInspection = OperateRecoveryInspectionCore['lock'];

export class OperateStoreError extends Error {
  constructor(
    readonly code:
      | 'OPERATE_STORE_CORRUPT'
      | 'OPERATE_STORE_INCOMPATIBLE'
      | 'OPERATE_STORE_CONFLICT',
    message: string,
    readonly context: Record<string, string | number | boolean | null> = {},
  ) {
    super(message);
    this.name = code;
  }
}

function emptyPreferences(): OperatePreferences {
  return {
    selectedScopeId: null,
    selectedDomainId: null,
    selectedDomainVersion: null,
    lastCycleId: null,
    reviewOwners: {},
    cycleModes: {},
    cycleDeliveryRoutes: {},
    assignmentArtifactIds: {},
    cycleRoleAssignments: {},
    cycleIntelligencePlanIds: {},
    actorMemberships: {},
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry)).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashBytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function hashValue(value: unknown): string {
  return hashBytes(Buffer.from(canonical(value), 'utf8'));
}

function safeGeneration(value: string): string {
  const generation = value.trim();
  if (!GENERATION_PATTERN.test(generation)) {
    throw new OperateStoreError(
      'OPERATE_STORE_CORRUPT',
      'The durable Operate generation pointer is invalid.',
    );
  }
  return generation;
}

function stringMap(value: unknown, label: string): Record<string, string> {
  if (!isRecord(value)) {
    throw new OperateStoreError('OPERATE_STORE_CORRUPT', `The durable ${label} map is invalid.`);
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key || typeof entry !== 'string' || !entry) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        `The durable ${label} binding is invalid.`,
      );
    }
    result[key] = entry;
  }
  return result;
}

function safePreferences(value: unknown): OperatePreferences {
  if (!isRecord(value)) {
    throw new OperateStoreError(
      'OPERATE_STORE_CORRUPT',
      'The durable Operate preferences are invalid.',
    );
  }
  const nullableString = (field: string): string | null => {
    const entry = value[field];
    if (entry === null || typeof entry === 'string') return entry;
    throw new OperateStoreError(
      'OPERATE_STORE_CORRUPT',
      `The durable Operate preference ${field} is invalid.`,
    );
  };
  const cycleModes: Record<string, 'assignment' | 'lifecycle'> = {};
  if (!isRecord(value.cycleModes)) {
    throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'Cycle modes are invalid.');
  }
  for (const [cycleId, mode] of Object.entries(value.cycleModes)) {
    if (!cycleId || !['assignment', 'lifecycle'].includes(String(mode))) {
      throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'A cycle mode is invalid.');
    }
    cycleModes[cycleId] = mode as 'assignment' | 'lifecycle';
  }
  const cycleDeliveryRoutes: Record<string, DeliveryRoute> = {};
  if (!isRecord(value.cycleDeliveryRoutes)) {
    throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'Delivery routes are invalid.');
  }
  for (const [cycleId, route] of Object.entries(value.cycleDeliveryRoutes)) {
    if (
      !cycleId ||
      !['contained-execution', 'planning-work', 'human-external', 'observe-only'].includes(
        String(route),
      )
    ) {
      throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'A delivery route is invalid.');
    }
    cycleDeliveryRoutes[cycleId] = route as DeliveryRoute;
  }
  if (!isRecord(value.cycleRoleAssignments)) {
    throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'Cycle role assignments are invalid.');
  }
  const cycleRoleAssignments: Record<string, Record<string, string>> = {};
  for (const [cycleId, assignments] of Object.entries(value.cycleRoleAssignments)) {
    cycleRoleAssignments[cycleId] = stringMap(assignments, 'role Assignment');
  }
  if (!isRecord(value.actorMemberships)) {
    throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'Actor memberships are invalid.');
  }
  const actorMemberships: OperatePreferences['actorMemberships'] = {};
  for (const [actorId, membership] of Object.entries(value.actorMemberships)) {
    if (
      !actorId ||
      !isRecord(membership) ||
      membership.actorId !== actorId ||
      membership.role !== 'owner' ||
      ['scopeId', 'domainId', 'domainVersion'].some(
        (field) => typeof membership[field] !== 'string' || !membership[field],
      )
    ) {
      throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'An actor membership is invalid.');
    }
    actorMemberships[actorId] = {
      actorId,
      scopeId: String(membership.scopeId),
      domainId: String(membership.domainId),
      domainVersion: String(membership.domainVersion),
      role: 'owner',
    };
  }
  return {
    selectedScopeId: nullableString('selectedScopeId'),
    selectedDomainId: nullableString('selectedDomainId'),
    selectedDomainVersion: nullableString('selectedDomainVersion'),
    lastCycleId: nullableString('lastCycleId'),
    reviewOwners: stringMap(value.reviewOwners, 'review owner'),
    cycleModes,
    cycleDeliveryRoutes,
    assignmentArtifactIds: stringMap(value.assignmentArtifactIds, 'Assignment Artifact'),
    cycleRoleAssignments,
    cycleIntelligencePlanIds: stringMap(value.cycleIntelligencePlanIds, 'cycle intelligence plan'),
    actorMemberships,
  };
}

function safeBindings(value: unknown): ScopeBinding[] {
  if (!Array.isArray(value)) {
    throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'Scope bindings are invalid.');
  }
  const result = value.map((entry) => {
    if (
      !isRecord(entry) ||
      ['cycleId', 'scopeId', 'domainId', 'domainVersion'].some(
        (field) => typeof entry[field] !== 'string' || !entry[field],
      )
    ) {
      throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'A scope binding is invalid.');
    }
    return {
      cycleId: String(entry.cycleId),
      scopeId: String(entry.scopeId),
      domainId: String(entry.domainId),
      domainVersion: String(entry.domainVersion),
    };
  });
  return result.sort((left, right) => left.cycleId.localeCompare(right.cycleId));
}

function bindingsFromState(state: JsonRecord): ScopeBinding[] {
  const cycles = Array.isArray(state.cycles) ? state.cycles : [];
  return safeBindings(
    cycles.map((cycle) => {
      if (!isRecord(cycle)) return cycle;
      return {
        cycleId: cycle.cycleId,
        scopeId: cycle.scopeId,
        domainId: cycle.domainId,
        domainVersion: cycle.domainVersion,
      };
    }),
  );
}

function replayIndexProjection(state: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(state).filter(
      ([key]) => key === 'eventHead' || key === 'eventReplayIndex' || /ReplayIndex$/u.test(key),
    ),
  );
}

function manifestProjection(manifest: Omit<StoreManifest, 'integrityHash'> | StoreManifest) {
  const { integrityHash: _integrityHash, ...projection } = manifest as StoreManifest;
  return projection;
}

function journalProjection(record: Omit<HeadJournalRecord, 'recordHash'> | HeadJournalRecord) {
  const { recordHash: _recordHash, ...projection } = record as HeadJournalRecord;
  return projection;
}

function parseJournalLine(line: string): HeadJournalRecord {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'The head journal is invalid JSON.');
  }
  if (
    !isRecord(value) ||
    value.format !== 'openplanr-operate-head-journal' ||
    value.journalVersion !== 1 ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    typeof value.projectIdentity !== 'string' ||
    typeof value.custodyNonce !== 'string' ||
    typeof value.generation !== 'string' ||
    typeof value.integrityHash !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.recordHash !== 'string' ||
    (value.previousRecordHash !== null && typeof value.previousRecordHash !== 'string')
  ) {
    throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'The head journal record is incomplete.');
  }
  const record: HeadJournalRecord = {
    format: 'openplanr-operate-head-journal',
    journalVersion: 1,
    sequence: Number(value.sequence),
    projectIdentity: value.projectIdentity,
    custodyNonce: value.custodyNonce,
    generation: safeGeneration(value.generation),
    integrityHash: value.integrityHash,
    bindings: safeBindings(value.bindings),
    previousRecordHash: value.previousRecordHash,
    createdAt: value.createdAt,
    recordHash: value.recordHash,
  };
  if (hashValue(journalProjection(record)) !== record.recordHash) {
    throw new OperateStoreError(
      'OPERATE_STORE_CORRUPT',
      'The head journal record hash is invalid.',
    );
  }
  return record;
}

function parseManifest(text: string, generation: string): StoreManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'The manifest is not valid JSON.', {
      generation,
    });
  }
  if (!isRecord(value) || value.format !== STORE_FORMAT) {
    throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'The manifest format is invalid.', {
      generation,
    });
  }
  if (value.storeVersion !== STORE_VERSION || value.protocolVersion !== PROTOCOL_VERSION) {
    throw new OperateStoreError(
      'OPERATE_STORE_INCOMPATIBLE',
      'The durable state uses an incompatible store or protocol version.',
      { generation },
    );
  }
  if (
    value.generation !== generation ||
    !isRecord(value.baseState) ||
    !isRecord(value.state) ||
    !Array.isArray(value.artifacts) ||
    !Number.isSafeInteger(value.eventCount) ||
    typeof value.projectIdentity !== 'string' ||
    typeof value.custodyNonce !== 'string' ||
    typeof value.eventsHash !== 'string' ||
    typeof value.replayIndexHash !== 'string' ||
    typeof value.integrityHash !== 'string'
  ) {
    throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'The manifest is incomplete.', {
      generation,
    });
  }
  const manifest = {
    ...value,
    format: STORE_FORMAT,
    storeVersion: STORE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    generation,
    parentGeneration:
      value.parentGeneration === null || typeof value.parentGeneration === 'string'
        ? value.parentGeneration
        : null,
    parentIntegrityHash:
      value.parentIntegrityHash === null || typeof value.parentIntegrityHash === 'string'
        ? value.parentIntegrityHash
        : null,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    eventCount: Number(value.eventCount),
    bindings: safeBindings(value.bindings),
    preferences: safePreferences(value.preferences),
    artifacts: value.artifacts as ArtifactManifestEntry[],
  } as StoreManifest;
  if (hashValue(manifestProjection(manifest)) !== manifest.integrityHash) {
    throw new OperateStoreError(
      'OPERATE_STORE_CORRUPT',
      'The manifest custody digest does not match its durable content.',
      { generation },
    );
  }
  return manifest;
}

function parseCustody(text: string): CustodyAnchor {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'The custody anchor is invalid JSON.');
  }
  if (
    !isRecord(value) ||
    value.format !== CUSTODY_FORMAT ||
    value.custodyVersion !== CUSTODY_VERSION ||
    typeof value.projectIdentity !== 'string' ||
    typeof value.custodyNonce !== 'string' ||
    typeof value.headGeneration !== 'string' ||
    typeof value.headIntegrityHash !== 'string' ||
    !Number.isSafeInteger(value.journalSequence) ||
    Number(value.journalSequence) < 1 ||
    typeof value.journalRecordHash !== 'string'
  ) {
    throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'The custody anchor is incomplete.');
  }
  return {
    format: CUSTODY_FORMAT,
    custodyVersion: CUSTODY_VERSION,
    projectIdentity: value.projectIdentity,
    custodyNonce: value.custodyNonce,
    headGeneration: safeGeneration(value.headGeneration),
    headIntegrityHash: value.headIntegrityHash,
    bindings: safeBindings(value.bindings),
    journalSequence: Number(value.journalSequence),
    journalRecordHash: value.journalRecordHash,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
  };
}

function custodyFromHead(head: HeadJournalRecord): CustodyAnchor {
  return {
    format: CUSTODY_FORMAT,
    custodyVersion: CUSTODY_VERSION,
    projectIdentity: head.projectIdentity,
    custodyNonce: head.custodyNonce,
    headGeneration: head.generation,
    headIntegrityHash: head.integrityHash,
    bindings: head.bindings,
    journalSequence: head.sequence,
    journalRecordHash: head.recordHash,
    updatedAt: head.createdAt,
  };
}

function pidAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Generation-addressed, project-bound application integrity custody. */
export class OperateStore {
  readonly root: string;
  private readonly projectDir: string;

  constructor(projectDir: string, options: { root?: string } = {}) {
    this.projectDir = path.resolve(projectDir);
    this.root = options.root
      ? path.resolve(options.root)
      : path.join(this.projectDir, '.planr', 'operate', 'state');
    const planrRoot = path.join(this.projectDir, '.planr');
    if (this.root !== planrRoot && !this.root.startsWith(`${planrRoot}${path.sep}`)) {
      throw new OperateStoreError(
        'OPERATE_STORE_INCOMPATIBLE',
        'Operate storage roots must remain inside the project-local .planr boundary.',
      );
    }
  }

  private async assertStorageCustody(requireDirectory = false): Promise<void> {
    const options = {
      code: 'OPERATE_STORE_INCOMPATIBLE',
      message:
        'Operate storage custody cannot traverse symbolic links or leave project-local .planr.',
      requireDirectory,
    } as const;
    await assertOperatePathCustody(this.projectDir, this.root, options);
    await assertOperateTreeCustody(this.projectDir, this.root, options);
  }

  async load(replay: OperateReplay): Promise<OperateStoredRuntime | null> {
    await this.assertStorageCustody();
    const startedAt = performance.now();
    const projectIdentity = await this.projectIdentity();
    let quietFailure: string | null = null;
    let attempts = 0;
    for (;;) {
      attempts += 1;
      await this.assertStorageCustody();
      const current = await this.currentGeneration();
      try {
        const runtime = await this.loadCurrentGeneration(current, replay);
        if ((await this.currentGeneration()) === current) return runtime;
        quietFailure = null;
      } catch (error) {
        if (!(error instanceof OperateStoreError) || error.code !== 'OPERATE_STORE_CORRUPT') {
          throw error;
        }
        const [afterCurrent, afterLock] = await Promise.all([
          this.currentGeneration().catch(() => null),
          this.inspectLock(projectIdentity),
        ]);
        if (afterLock.status !== 'live' && afterCurrent === current) {
          const fingerprint = `${current ?? 'null'}\0${error.code}\0${error.message}`;
          if (quietFailure === fingerprint) throw error;
          quietFailure = fingerprint;
        } else {
          quietFailure = null;
        }
      }

      const elapsedMs = performance.now() - startedAt;
      if (elapsedMs >= READ_STABILITY_TIMEOUT_MS || attempts >= READ_STABILITY_MAX_ATTEMPTS) {
        const lock = await this.inspectLock(projectIdentity);
        throw new OperateStoreError(
          'OPERATE_STORE_CONFLICT',
          'The durable Operate Store changed throughout the bounded read window.',
          {
            expectedGeneration: current,
            currentGeneration: await this.currentGeneration(),
            ownerPid: lock.ownerPid,
            expiresAt: lock.expiresAt,
            attempts,
            elapsedMs: Math.floor(elapsedMs),
          },
        );
      }
      const pollMs = Math.min(READ_STABILITY_POLL_MS * attempts, READ_STABILITY_MAX_POLL_MS);
      await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
    }
  }

  private async loadCurrentGeneration(
    current: string | null,
    replay: OperateReplay,
  ): Promise<OperateStoredRuntime | null> {
    const journal = await this.readHeadJournal();
    if (current === null) {
      if ((await this.generationNames()).length === 0 && journal.length === 0) return null;
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'Durable generations exist without an anchored current pointer.',
      );
    }
    const custody = await this.readCustody();
    const head = journal.at(-1);
    if (
      !custody ||
      !head ||
      custody.headGeneration !== current ||
      head.generation !== current ||
      head.integrityHash !== custody.headIntegrityHash ||
      head.recordHash !== custody.journalRecordHash ||
      head.sequence !== custody.journalSequence
    ) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'The current pointer, custody anchor, and project-local head journal diverge.',
      );
    }
    return await this.loadGeneration(current, replay, custody);
  }

  /**
   * Verify that a pre-change replay receipt still names this exact current,
   * project-bound Store. This deliberately validates only durable custody and
   * byte hashes; it never imports or interprets superseded result contracts.
   */
  async verifyReplayProofCustody(proof: OperateReplayProofCustody): Promise<true> {
    await this.assertStorageCustody(true);
    const journal = await this.readHeadJournal();
    const current = await this.currentGeneration();
    const custody = await this.readCustody();
    const head = journal.at(-1);
    if (
      current === null ||
      !custody ||
      !head ||
      custody.headGeneration !== current ||
      head.generation !== current ||
      head.integrityHash !== custody.headIntegrityHash ||
      head.recordHash !== custody.journalRecordHash ||
      head.sequence !== custody.journalSequence
    ) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'Legacy replay proof custody has no exact anchored current generation.',
      );
    }
    const selected = safeGeneration(current);
    const identity = await this.projectIdentity();
    if (custody.projectIdentity !== identity) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'Legacy replay proof custody belongs to a foreign canonical project.',
      );
    }
    await this.assertAnchored(selected, custody);
    const manifest = await this.readManifest(selected);
    if (
      manifest.projectIdentity !== identity ||
      manifest.custodyNonce !== custody.custodyNonce ||
      canonical(manifest.bindings) !== canonical(bindingsFromState(manifest.baseState))
    ) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'Legacy replay proof generation custody is invalid.',
        { generation: selected },
      );
    }
    this.assertPreferenceBinding(manifest.preferences, manifest.bindings);
    const directory = path.join(this.root, GENERATIONS_DIRECTORY, selected);
    const eventBytes = await readFile(path.join(directory, 'events.jsonl')).catch(() => {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'Legacy replay proof Event bytes are unavailable.',
        { generation: selected },
      );
    });
    if (hashBytes(eventBytes) !== manifest.eventsHash) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'Legacy replay proof Event bytes failed custody verification.',
        { generation: selected },
      );
    }
    const eventLines = eventBytes.toString('utf8').split('\n').filter(Boolean);
    if (eventLines.length !== manifest.eventCount) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'Legacy replay proof Event count is invalid.',
        { generation: selected },
      );
    }
    for (const line of eventLines) {
      try {
        if (!isRecord(JSON.parse(line) as unknown)) throw new Error('not an object');
      } catch {
        throw new OperateStoreError(
          'OPERATE_STORE_CORRUPT',
          'Legacy replay proof Event ledger contains an invalid record.',
          { generation: selected },
        );
      }
    }
    if (hashValue(replayIndexProjection(manifest.state)) !== manifest.replayIndexHash) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'Legacy replay proof indexes failed custody verification.',
        { generation: selected },
      );
    }
    const artifactHashes: Array<{ artifactId: string; rawHash: string }> = [];
    const seen = new Set<string>();
    for (const entry of manifest.artifacts) {
      if (
        !isRecord(entry) ||
        typeof entry.artifactId !== 'string' ||
        !ARTIFACT_ID_PATTERN.test(entry.artifactId) ||
        entry.file !== `${entry.artifactId}.bin` ||
        typeof entry.rawHash !== 'string' ||
        typeof entry.sizeBytes !== 'number' ||
        seen.has(entry.artifactId)
      ) {
        throw new OperateStoreError(
          'OPERATE_STORE_CORRUPT',
          'Legacy replay proof Artifact custody metadata is invalid.',
          { generation: selected },
        );
      }
      seen.add(entry.artifactId);
      const bytes = await readFile(path.join(directory, 'artifacts', entry.file)).catch(() => {
        throw new OperateStoreError(
          'OPERATE_STORE_CORRUPT',
          'A legacy replay proof Artifact is unavailable.',
          { generation: selected, artifactId: entry.artifactId },
        );
      });
      if (bytes.length !== entry.sizeBytes || hashBytes(bytes) !== entry.rawHash) {
        throw new OperateStoreError(
          'OPERATE_STORE_CORRUPT',
          'Legacy replay proof Artifact bytes failed custody verification.',
          { generation: selected, artifactId: entry.artifactId },
        );
      }
      artifactHashes.push({ artifactId: entry.artifactId, rawHash: entry.rawHash });
    }
    artifactHashes.sort((left, right) => left.artifactId.localeCompare(right.artifactId));
    const eventHead = manifest.state.eventHead;
    if (
      !isRecord(eventHead) ||
      !Number.isSafeInteger(eventHead.sequence) ||
      Number(eventHead.sequence) < 0 ||
      (Number(eventHead.sequence) === 0
        ? eventHead.hash !== null
        : typeof eventHead.hash !== 'string')
    ) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'Legacy replay proof state has an invalid Event head.',
        { generation: selected },
      );
    }
    const actual: OperateReplayProofCustody = {
      currentGeneration: selected,
      stateCanonicalHash: hashValue(manifest.state),
      eventHead: { sequence: Number(eventHead.sequence), hash: eventHead.hash as string | null },
      artifactHashes,
    };
    if (canonical(actual) !== canonical(proof)) {
      throw new OperateStoreError(
        'OPERATE_STORE_INCOMPATIBLE',
        'The legacy replay proof is stale or does not match current Store custody.',
        { generation: selected },
      );
    }
    return true;
  }

  async commit(
    runtime: Omit<OperateStoredRuntime, 'generation'>,
    expectedGeneration: string | null,
  ): Promise<OperateStoredRuntime> {
    await this.assertStorageCustody();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.assertStorageCustody(true);
    const lock = await this.acquireLock();
    try {
      const current = await this.currentGeneration();
      if (current !== expectedGeneration) {
        throw new OperateStoreError(
          'OPERATE_STORE_CONFLICT',
          'Durable state changed before this transaction committed.',
          { expectedGeneration, currentGeneration: current },
        );
      }
      const projectIdentity = await this.projectIdentity();
      const priorCustody = await this.readCustody();
      const journal = await this.readHeadJournal();
      const priorHead = journal.at(-1) ?? null;
      if (expectedGeneration === null && (priorCustody !== null || priorHead !== null)) {
        throw new OperateStoreError(
          'OPERATE_STORE_CONFLICT',
          'Existing custody cannot be replaced by a fresh transaction.',
        );
      }
      if (priorCustody && priorCustody.projectIdentity !== projectIdentity) {
        throw new OperateStoreError(
          'OPERATE_STORE_CORRUPT',
          'Durable custody belongs to another canonical project identity.',
        );
      }
      if (
        (priorCustody === null) !== (priorHead === null) ||
        (priorHead &&
          (priorHead.generation !== expectedGeneration ||
            priorCustody?.journalSequence !== priorHead.sequence ||
            priorCustody.journalRecordHash !== priorHead.recordHash ||
            priorCustody.headIntegrityHash !== priorHead.integrityHash))
      ) {
        throw new OperateStoreError(
          'OPERATE_STORE_CORRUPT',
          'The project-local head journal does not match current durable custody.',
        );
      }
      const generation = `gen_${randomUUID().replaceAll('-', '')}`;
      const custodyNonce = priorCustody?.custodyNonce ?? randomUUID().replaceAll('-', '');
      const generationsRoot = path.join(this.root, GENERATIONS_DIRECTORY);
      const staging = path.join(this.root, `.txn-${randomUUID()}`);
      const artifactsDirectory = path.join(staging, 'artifacts');
      await mkdir(artifactsDirectory, { recursive: true });
      const artifactEntries: ArtifactManifestEntry[] = [];
      for (const [artifactId, value] of [...runtime.artifacts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
          throw new OperateStoreError(
            'OPERATE_STORE_CORRUPT',
            'An Artifact identity cannot be stored safely.',
          );
        }
        const bytes = Buffer.from(value);
        const file = `${artifactId}.bin`;
        await writeFile(path.join(artifactsDirectory, file), bytes, { flag: 'wx' });
        artifactEntries.push({
          artifactId,
          rawHash: hashBytes(bytes),
          sizeBytes: bytes.length,
          file,
        });
      }
      const eventsText = runtime.events.map((event) => JSON.stringify(event)).join('\n');
      const eventBytes = Buffer.from(eventsText ? `${eventsText}\n` : '', 'utf8');
      await writeFile(path.join(staging, 'events.jsonl'), eventBytes, { flag: 'wx' });
      const bindings = bindingsFromState(runtime.baseState);
      this.assertPreferenceBinding(runtime.preferences, bindings);
      const projection: Omit<StoreManifest, 'integrityHash'> = {
        format: STORE_FORMAT,
        storeVersion: STORE_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        projectIdentity,
        custodyNonce,
        generation,
        parentGeneration: expectedGeneration,
        parentIntegrityHash: priorCustody?.headIntegrityHash ?? null,
        createdAt: new Date().toISOString(),
        eventCount: runtime.events.length,
        eventsHash: hashBytes(eventBytes),
        replayIndexHash: hashValue(replayIndexProjection(runtime.state)),
        bindings,
        baseState: runtime.baseState,
        state: runtime.state,
        preferences: safePreferences(runtime.preferences),
        artifacts: artifactEntries,
      };
      const manifest: StoreManifest = {
        ...projection,
        integrityHash: hashValue(projection),
      };
      await writeFile(
        path.join(staging, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { flag: 'wx' },
      );
      await mkdir(generationsRoot, { recursive: true });
      await rename(staging, path.join(generationsRoot, generation));
      const journalProjection: Omit<HeadJournalRecord, 'recordHash'> = {
        format: 'openplanr-operate-head-journal',
        journalVersion: 1,
        sequence: (priorHead?.sequence ?? 0) + 1,
        projectIdentity,
        custodyNonce,
        generation,
        integrityHash: manifest.integrityHash,
        bindings,
        previousRecordHash: priorHead?.recordHash ?? null,
        createdAt: manifest.createdAt,
      };
      const journalRecord: HeadJournalRecord = {
        ...journalProjection,
        recordHash: hashValue(journalProjection),
      };
      await this.appendHeadJournal(journalRecord);
      const custody: CustodyAnchor = {
        format: CUSTODY_FORMAT,
        custodyVersion: CUSTODY_VERSION,
        projectIdentity,
        custodyNonce,
        headGeneration: generation,
        headIntegrityHash: manifest.integrityHash,
        bindings,
        journalSequence: journalRecord.sequence,
        journalRecordHash: journalRecord.recordHash,
        updatedAt: manifest.createdAt,
      };
      await this.atomicWrite(
        path.join(this.root, CUSTODY_FILENAME),
        `${JSON.stringify(custody, null, 2)}\n`,
      );
      await this.atomicWrite(path.join(this.root, CURRENT_FILENAME), `${generation}\n`);
      return { ...runtime, generation };
    } finally {
      await this.releaseLock(lock);
    }
  }

  async inspect(replay: OperateReplay): Promise<OperateRecoveryInspection> {
    await this.assertStorageCustody();
    return {
      ...(await this.inspectProjectLocal(replay)),
      integrityBoundary: OPERATE_INTEGRITY_BOUNDARY,
    };
  }

  private async inspectProjectLocal(replay: OperateReplay): Promise<OperateRecoveryInspectionCore> {
    const projectIdentity = await this.projectIdentity();
    const lock = await this.inspectLock(projectIdentity);
    const generations = await this.generationNames();
    if (lock.status === 'live') {
      return {
        status: 'locked',
        currentGeneration: await this.currentGeneration().catch(() => null),
        recoverableGeneration: null,
        generationCount: generations.length,
        reason: lock.reason,
        allowedRecovery: 'none',
        lock,
      };
    }
    if (lock.status === 'stale' || lock.status === 'invalid') {
      return {
        status: 'repairable',
        currentGeneration: await this.currentGeneration().catch(() => null),
        recoverableGeneration: null,
        generationCount: generations.length,
        reason: lock.reason,
        allowedRecovery: 'clear-stale-lock',
        lock,
      };
    }
    let current: string | null = null;
    try {
      const journal = await this.readHeadJournal();
      const head = journal.at(-1) ?? null;
      try {
        current = await this.currentGeneration();
      } catch (pointerError) {
        const custody = await this.readCustody();
        if (!custody || !head || custody.journalRecordHash !== head.recordHash) throw pointerError;
        await this.loadGeneration(custody.headGeneration, replay, custody);
        return {
          status: 'repairable',
          currentGeneration: null,
          recoverableGeneration: custody.headGeneration,
          generationCount: generations.length,
          reason: 'The current pointer is invalid, but the custody head verifies exactly.',
          allowedRecovery: 'restore-generation',
          lock,
        };
      }
      if (current === null && generations.length === 0) {
        if (journal.length > 0) {
          throw new OperateStoreError(
            'OPERATE_STORE_CORRUPT',
            'The project-local head journal names missing durable generations.',
          );
        }
        return {
          status: 'empty',
          currentGeneration: null,
          recoverableGeneration: null,
          generationCount: 0,
          reason: 'No durable Operate state exists yet.',
          allowedRecovery: 'none',
          lock,
        };
      }
      const custody = await this.readCustody();
      if (!custody || !head) {
        throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'Custody journal is missing.');
      }
      const interruptedAppend =
        custody.projectIdentity === head.projectIdentity &&
        custody.custodyNonce === head.custodyNonce &&
        custody.journalSequence + 1 === head.sequence &&
        custody.journalRecordHash === head.previousRecordHash;
      if (interruptedAppend) {
        await this.loadGeneration(head.generation, replay, custodyFromHead(head));
        return {
          status: 'repairable',
          currentGeneration: current,
          recoverableGeneration: head.generation,
          generationCount: generations.length,
          reason:
            'A committed journal head is waiting for interrupted pointer/custody finalization.',
          allowedRecovery: 'restore-generation',
          lock,
        };
      }
      if (
        custody.journalSequence !== head.sequence ||
        custody.journalRecordHash !== head.recordHash ||
        custody.headGeneration !== head.generation ||
        custody.headIntegrityHash !== head.integrityHash
      ) {
        throw new OperateStoreError(
          'OPERATE_STORE_CORRUPT',
          'The replaceable custody files diverge from the project-local head journal.',
        );
      }
      if (current === head.generation) {
        await this.loadGeneration(current, replay, custody);
        return {
          status: 'healthy',
          currentGeneration: current,
          recoverableGeneration: null,
          generationCount: generations.length,
          reason: 'Current custody, Event replay, and raw bytes verify exactly.',
          allowedRecovery: 'none',
          lock,
        };
      }
      await this.loadGeneration(head.generation, replay, custody);
      return {
        status: 'repairable',
        currentGeneration: current,
        recoverableGeneration: head.generation,
        generationCount: generations.length,
        reason: 'The pointer is interrupted, but the custody head verifies exactly.',
        allowedRecovery: 'restore-generation',
        lock,
      };
    } catch (error) {
      if (error instanceof OperateStoreError && error.code === 'OPERATE_STORE_INCOMPATIBLE') {
        return {
          status: 'incompatible',
          currentGeneration: current,
          recoverableGeneration: null,
          generationCount: generations.length,
          reason: error.message,
          allowedRecovery: 'upgrade-required',
          lock,
        };
      }
      return {
        status: 'corrupt',
        currentGeneration: current,
        recoverableGeneration: null,
        generationCount: generations.length,
        reason: error instanceof Error ? error.message : 'Custody verification failed.',
        allowedRecovery: 'inspect-project',
        lock,
      };
    }
  }

  async clearStaleLock(): Promise<true> {
    await this.assertStorageCustody(true);
    const identity = await this.projectIdentity();
    const recovery = await this.acquireRecoveryLock(identity);
    try {
      const inspection = await this.inspectLock(identity);
      if (!['stale', 'invalid'].includes(inspection.status)) {
        throw new OperateStoreError(
          'OPERATE_STORE_CONFLICT',
          inspection.status === 'live'
            ? 'A live owner still holds the lock.'
            : 'No stale lock exists.',
        );
      }
      await this.archiveStaleLock(inspection);
      return true;
    } finally {
      await this.releaseNamedLock(RECOVERY_LOCK_FILENAME, recovery);
    }
  }

  async restore(generation: string, replay: OperateReplay): Promise<OperateStoredRuntime> {
    const selected = safeGeneration(generation);
    await this.assertStorageCustody();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.assertStorageCustody(true);
    const lock = await this.acquireLock();
    try {
      const custody = await this.readCustody();
      if (!custody) {
        throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'Custody anchor is unavailable.');
      }
      const journal = await this.readHeadJournal();
      const head = journal.at(-1);
      if (!head) {
        throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'Head journal custody is invalid.');
      }
      const interruptedAppend =
        selected === head.generation &&
        custody.projectIdentity === head.projectIdentity &&
        custody.custodyNonce === head.custodyNonce &&
        custody.journalSequence + 1 === head.sequence &&
        custody.journalRecordHash === head.previousRecordHash;
      if (head.recordHash !== custody.journalRecordHash && !interruptedAppend) {
        throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'Head journal custody is invalid.');
      }
      const effectiveCustody = interruptedAppend ? custodyFromHead(head) : custody;
      const recovered = await this.loadGeneration(selected, replay, effectiveCustody);
      const manifest = await this.readManifest(selected);
      let nextCustody = effectiveCustody;
      if (selected !== head.generation) {
        const createdAt = new Date().toISOString();
        const projection: Omit<HeadJournalRecord, 'recordHash'> = {
          format: 'openplanr-operate-head-journal',
          journalVersion: 1,
          sequence: head.sequence + 1,
          projectIdentity: custody.projectIdentity,
          custodyNonce: custody.custodyNonce,
          generation: selected,
          integrityHash: manifest.integrityHash,
          bindings: manifest.bindings,
          previousRecordHash: head.recordHash,
          createdAt,
        };
        const record = { ...projection, recordHash: hashValue(projection) };
        await this.appendHeadJournal(record);
        nextCustody = {
          ...custody,
          headGeneration: selected,
          headIntegrityHash: manifest.integrityHash,
          bindings: manifest.bindings,
          journalSequence: record.sequence,
          journalRecordHash: record.recordHash,
          updatedAt: createdAt,
        };
      }
      await this.atomicWrite(
        path.join(this.root, CUSTODY_FILENAME),
        `${JSON.stringify(nextCustody, null, 2)}\n`,
      );
      await this.atomicWrite(path.join(this.root, CURRENT_FILENAME), `${selected}\n`);
      return recovered;
    } finally {
      await this.releaseLock(lock);
    }
  }

  private async loadGeneration(
    generation: string,
    replay: OperateReplay,
    custody: CustodyAnchor,
  ): Promise<OperateStoredRuntime> {
    const selected = safeGeneration(generation);
    const identity = await this.projectIdentity();
    if (custody.projectIdentity !== identity) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'Custody belongs to a foreign canonical project identity.',
      );
    }
    await this.assertAnchored(selected, custody);
    const manifest = await this.readManifest(selected);
    if (
      manifest.projectIdentity !== identity ||
      manifest.custodyNonce !== custody.custodyNonce ||
      canonical(manifest.bindings) !== canonical(bindingsFromState(manifest.baseState))
    ) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'Generation project/scope/domain custody is invalid.',
        { generation: selected },
      );
    }
    this.assertPreferenceBinding(manifest.preferences, manifest.bindings);
    const directory = path.join(this.root, GENERATIONS_DIRECTORY, selected);
    const eventBytes = await readFile(path.join(directory, 'events.jsonl')).catch(() => {
      throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'The Event ledger is unavailable.', {
        generation: selected,
      });
    });
    if (hashBytes(eventBytes) !== manifest.eventsHash) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'The exact Event JSONL bytes failed custody verification.',
        { generation: selected },
      );
    }
    const events: JsonRecord[] = [];
    for (const line of eventBytes.toString('utf8').split('\n').filter(Boolean)) {
      try {
        const event = JSON.parse(line) as unknown;
        if (!isRecord(event)) throw new Error('not an object');
        events.push(event);
      } catch {
        throw new OperateStoreError(
          'OPERATE_STORE_CORRUPT',
          'The Event ledger contains an invalid record.',
          { generation: selected },
        );
      }
    }
    if (events.length !== manifest.eventCount) {
      throw new OperateStoreError('OPERATE_STORE_CORRUPT', 'The Event count is invalid.', {
        generation: selected,
      });
    }
    if (hashValue(replayIndexProjection(manifest.state)) !== manifest.replayIndexHash) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'Replay indexes failed explicit custody verification.',
        { generation: selected },
      );
    }
    const artifacts = new Map<string, Uint8Array>();
    const seen = new Set<string>();
    for (const entry of manifest.artifacts) {
      if (
        !isRecord(entry) ||
        typeof entry.artifactId !== 'string' ||
        !ARTIFACT_ID_PATTERN.test(entry.artifactId) ||
        entry.file !== `${entry.artifactId}.bin` ||
        typeof entry.rawHash !== 'string' ||
        typeof entry.sizeBytes !== 'number' ||
        seen.has(entry.artifactId)
      ) {
        throw new OperateStoreError(
          'OPERATE_STORE_CORRUPT',
          'Artifact custody metadata is invalid.',
          { generation: selected },
        );
      }
      seen.add(entry.artifactId);
      const bytes = await readFile(path.join(directory, 'artifacts', String(entry.file))).catch(
        () => {
          throw new OperateStoreError(
            'OPERATE_STORE_CORRUPT',
            'A durable Artifact is unavailable.',
            { generation: selected, artifactId: entry.artifactId },
          );
        },
      );
      if (bytes.length !== entry.sizeBytes || hashBytes(bytes) !== entry.rawHash) {
        throw new OperateStoreError(
          'OPERATE_STORE_CORRUPT',
          'Artifact raw bytes failed custody verification.',
          { generation: selected, artifactId: entry.artifactId },
        );
      }
      artifacts.set(entry.artifactId, bytes);
    }
    const replayed = await replay({ baseState: manifest.baseState, events, artifacts });
    if (canonical(replayed) !== canonical(manifest.state)) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'The durable projection does not match exact Event replay.',
        { generation: selected },
      );
    }
    return {
      generation: selected,
      baseState: manifest.baseState,
      state: replayed,
      events,
      artifacts,
      preferences: manifest.preferences,
    };
  }

  private async assertAnchored(generation: string, custody: CustodyAnchor): Promise<void> {
    let cursor: string | null = custody.headGeneration;
    let expectedHash: string | null = custody.headIntegrityHash;
    const visited = new Set<string>();
    while (cursor !== null && expectedHash !== null && !visited.has(cursor)) {
      visited.add(cursor);
      const manifest = await this.readManifest(cursor);
      if (manifest.integrityHash !== expectedHash) break;
      if (cursor === generation) return;
      cursor = manifest.parentGeneration;
      expectedHash = manifest.parentIntegrityHash;
    }
    throw new OperateStoreError(
      'OPERATE_STORE_CORRUPT',
      'The selected generation is not anchored by this project custody chain.',
      { generation },
    );
  }

  private async readManifest(generation: string): Promise<StoreManifest> {
    try {
      return parseManifest(
        await readFile(
          path.join(this.root, GENERATIONS_DIRECTORY, generation, 'manifest.json'),
          'utf8',
        ),
        generation,
      );
    } catch (error) {
      if (error instanceof OperateStoreError) throw error;
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'The selected generation manifest is unavailable.',
        { generation },
      );
    }
  }

  private assertPreferenceBinding(preferences: OperatePreferences, bindings: ScopeBinding[]): void {
    const selected = preferences.lastCycleId
      ? bindings.find((entry) => entry.cycleId === preferences.lastCycleId)
      : null;
    if (
      preferences.lastCycleId !== null &&
      (!selected ||
        selected.scopeId !== preferences.selectedScopeId ||
        selected.domainId !== preferences.selectedDomainId ||
        selected.domainVersion !== preferences.selectedDomainVersion)
    ) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'Selected scope/domain/version preferences do not match canonical cycle custody.',
      );
    }
  }

  private async projectIdentity(): Promise<string> {
    const resolved = await realpath(this.projectDir).catch(() => this.projectDir);
    const configPath = path.join(this.projectDir, '.planr', 'config.json');
    await assertOperatePathCustody(this.projectDir, configPath, {
      code: 'OPERATE_STORE_INCOMPATIBLE',
      message:
        'Operate project identity cannot read configuration through symbolic links or outside project-local .planr.',
      requireFile: true,
    });
    let config: unknown = null;
    try {
      const parsed = JSON.parse(await readFile(configPath, 'utf8')) as JsonRecord;
      config = { projectName: parsed.projectName ?? null, createdAt: parsed.createdAt ?? null };
    } catch {
      config = null;
    }
    return hashValue({ kind: 'openplanr-project-identity', resolved, config });
  }

  private async readCustody(): Promise<CustodyAnchor | null> {
    try {
      return parseCustody(await readFile(path.join(this.root, CUSTODY_FILENAME), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async readHeadJournal(): Promise<HeadJournalRecord[]> {
    let text: string;
    try {
      text = await readFile(path.join(this.root, HEAD_JOURNAL_FILENAME), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    if (!text.endsWith('\n')) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'The project-local head journal was truncated.',
      );
    }
    const records = text
      .split('\n')
      .filter(Boolean)
      .map((line) => parseJournalLine(line));
    const identity = await this.projectIdentity();
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const previous = records[index - 1] ?? null;
      if (
        record.sequence !== index + 1 ||
        record.previousRecordHash !== (previous?.recordHash ?? null) ||
        record.projectIdentity !== identity ||
        (previous && record.custodyNonce !== previous.custodyNonce)
      ) {
        throw new OperateStoreError(
          'OPERATE_STORE_CORRUPT',
          'The project-local head journal is internally inconsistent, reordered, or bound to another project.',
        );
      }
      const manifest = await this.readManifest(record.generation);
      if (
        manifest.projectIdentity !== identity ||
        manifest.custodyNonce !== record.custodyNonce ||
        manifest.integrityHash !== record.integrityHash ||
        canonical(manifest.bindings) !== canonical(record.bindings)
      ) {
        throw new OperateStoreError(
          'OPERATE_STORE_CORRUPT',
          'A journal head does not match the exact generation manifest it anchors.',
        );
      }
    }
    return records;
  }

  private async appendHeadJournal(record: HeadJournalRecord): Promise<void> {
    const current = await this.readHeadJournal();
    const previous = current.at(-1) ?? null;
    if (
      record.sequence !== (previous?.sequence ?? 0) + 1 ||
      record.previousRecordHash !== (previous?.recordHash ?? null) ||
      record.recordHash !== hashValue(journalProjection(record))
    ) {
      throw new OperateStoreError(
        'OPERATE_STORE_CONFLICT',
        'The head journal append does not extend the exact current anchor.',
      );
    }
    const handle = await open(path.join(this.root, HEAD_JOURNAL_FILENAME), 'a');
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    const verified = await this.readHeadJournal();
    if (verified.at(-1)?.recordHash !== record.recordHash) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'The appended head journal record could not be verified.',
      );
    }
  }

  private async currentGeneration(): Promise<string | null> {
    try {
      return safeGeneration(await readFile(path.join(this.root, CURRENT_FILENAME), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async generationNames(): Promise<string[]> {
    try {
      return (await readdir(path.join(this.root, GENERATIONS_DIRECTORY)))
        .filter((entry) => GENERATION_PATTERN.test(entry))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private async inspectLock(projectIdentity: string): Promise<LockInspection> {
    return await this.inspectNamedLock(LOCK_FILENAME, projectIdentity);
  }

  private async inspectNamedLock(
    filename: typeof LOCK_FILENAME | typeof RECOVERY_LOCK_FILENAME,
    projectIdentity: string,
  ): Promise<LockInspection> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path.join(this.root, filename), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          status: 'absent',
          ownerPid: null,
          nonce: null,
          expiresAt: null,
          reason: `No durable ${filename === LOCK_FILENAME ? 'writer' : 'recovery'} lock exists.`,
        };
      }
      return {
        status: 'invalid',
        ownerPid: null,
        nonce: null,
        expiresAt: null,
        reason: `The ${filename === LOCK_FILENAME ? 'writer' : 'recovery'} lock is unreadable and may be recovered explicitly.`,
      };
    }
    if (
      !isRecord(value) ||
      value.format !== LOCK_FORMAT ||
      typeof value.nonce !== 'string' ||
      !/^[a-f0-9]{32}$/u.test(value.nonce) ||
      !Number.isSafeInteger(value.pid) ||
      Number(value.pid) < 1 ||
      typeof value.createdAt !== 'string' ||
      typeof value.expiresAt !== 'string' ||
      Number.isNaN(Date.parse(value.createdAt)) ||
      Number.isNaN(Date.parse(value.expiresAt)) ||
      Date.parse(value.expiresAt) <= Date.parse(value.createdAt) ||
      value.projectIdentity !== projectIdentity
    ) {
      return {
        status: 'invalid',
        ownerPid:
          typeof (value as JsonRecord)?.pid === 'number' ? Number((value as JsonRecord).pid) : null,
        nonce:
          typeof (value as JsonRecord)?.nonce === 'string'
            ? String((value as JsonRecord).nonce)
            : null,
        expiresAt:
          typeof (value as JsonRecord)?.expiresAt === 'string'
            ? String((value as JsonRecord).expiresAt)
            : null,
        reason: `The ${filename === LOCK_FILENAME ? 'writer' : 'recovery'} lock is foreign or malformed.`,
      };
    }
    const ownerPid = Number(value.pid);
    const stale = Date.parse(value.expiresAt) <= Date.now() || !pidAlive(ownerPid);
    return {
      status: stale ? 'stale' : 'live',
      ownerPid,
      nonce: value.nonce,
      expiresAt: value.expiresAt,
      reason: stale
        ? `A stale or orphaned ${filename === LOCK_FILENAME ? 'writer' : 'recovery'} lock can be archived safely.`
        : `Operate ${filename === LOCK_FILENAME ? 'writer' : 'recovery'} process ${ownerPid} holds a live lock until ${value.expiresAt}.`,
    };
  }

  private async acquireLock(): Promise<LockRecord> {
    const projectIdentity = await this.projectIdentity();
    await mkdir(this.root, { recursive: true });
    const recovery = await this.acquireRecoveryLock(projectIdentity);
    try {
      const inspection = await this.inspectLock(projectIdentity);
      if (['stale', 'invalid'].includes(inspection.status)) {
        await this.archiveStaleLock(inspection);
      } else if (inspection.status === 'live') {
        throw new OperateStoreError('OPERATE_STORE_CONFLICT', inspection.reason, {
          ownerPid: inspection.ownerPid,
          expiresAt: inspection.expiresAt,
        });
      }
      const createdAt = new Date().toISOString();
      const lock: LockRecord = {
        format: LOCK_FORMAT,
        projectIdentity,
        nonce: randomUUID().replaceAll('-', ''),
        pid: process.pid,
        createdAt,
        expiresAt: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
      };
      const handle = await open(path.join(this.root, LOCK_FILENAME), 'wx').catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new OperateStoreError(
            'OPERATE_STORE_CONFLICT',
            'The writer lock changed during recovery mutex custody.',
          );
        }
        throw error;
      });
      try {
        await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      return lock;
    } finally {
      await this.releaseNamedLock(RECOVERY_LOCK_FILENAME, recovery);
    }
  }

  private async acquireRecoveryLock(projectIdentity: string): Promise<LockRecord> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const createdAt = new Date().toISOString();
      const record: LockRecord = {
        format: LOCK_FORMAT,
        projectIdentity,
        nonce: randomUUID().replaceAll('-', ''),
        pid: process.pid,
        createdAt,
        expiresAt: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
      };
      try {
        const handle = await open(path.join(this.root, RECOVERY_LOCK_FILENAME), 'wx');
        try {
          await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        return record;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const inspection = await this.inspectNamedLock(RECOVERY_LOCK_FILENAME, projectIdentity);
        if (!['stale', 'invalid'].includes(inspection.status)) {
          throw new OperateStoreError(
            'OPERATE_STORE_CONFLICT',
            'Another process owns durable stale-lock recovery.',
            { ownerPid: inspection.ownerPid, expiresAt: inspection.expiresAt },
          );
        }
        await this.archiveNamedStaleLock(RECOVERY_LOCK_FILENAME, inspection);
      }
    }
    throw new OperateStoreError(
      'OPERATE_STORE_CONFLICT',
      'The recovery lock changed during deterministic orphan recovery.',
    );
  }

  private async archiveStaleLock(inspection: LockInspection): Promise<void> {
    await this.archiveNamedStaleLock(LOCK_FILENAME, inspection);
  }

  private async archiveNamedStaleLock(
    filename: typeof LOCK_FILENAME | typeof RECOVERY_LOCK_FILENAME,
    inspection: LockInspection,
  ): Promise<void> {
    const lockPath = path.join(this.root, filename);
    const directory = path.join(this.root, STALE_LOCKS_DIRECTORY);
    await mkdir(directory, { recursive: true });
    const before = await readFile(lockPath).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new OperateStoreError(
          'OPERATE_STORE_CONFLICT',
          'The stale lock was already recovered by another process.',
        );
      }
      throw error;
    });
    const target = path.join(
      directory,
      `${filename.toLowerCase()}-${inspection.nonce ?? 'invalid'}-${randomUUID()}.json`,
    );
    try {
      await rename(lockPath, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new OperateStoreError(
          'OPERATE_STORE_CONFLICT',
          'The stale lock was already recovered by another process.',
        );
      }
      throw error;
    }
    const archived = await readFile(target);
    if (!archived.equals(before)) {
      throw new OperateStoreError(
        'OPERATE_STORE_CORRUPT',
        'The quarantined lock changed during atomic recovery.',
      );
    }
    if (inspection.nonce !== null) {
      const parsed = JSON.parse(archived.toString('utf8')) as JsonRecord;
      if (parsed.nonce !== inspection.nonce || parsed.pid !== inspection.ownerPid) {
        throw new OperateStoreError(
          'OPERATE_STORE_CONFLICT',
          'The quarantined lock owner does not match the inspected stale owner.',
        );
      }
    }
  }

  private async releaseLock(lock: LockRecord): Promise<void> {
    await this.releaseNamedLock(LOCK_FILENAME, lock);
  }

  private async releaseNamedLock(
    filename: typeof LOCK_FILENAME | typeof RECOVERY_LOCK_FILENAME,
    lock: LockRecord,
  ): Promise<void> {
    try {
      const current = JSON.parse(
        await readFile(path.join(this.root, filename), 'utf8'),
      ) as JsonRecord;
      if (
        current.nonce === lock.nonce &&
        current.pid === lock.pid &&
        current.projectIdentity === lock.projectIdentity
      ) {
        await unlink(path.join(this.root, filename));
      } else {
        throw new OperateStoreError(
          'OPERATE_STORE_CONFLICT',
          'Lock ownership changed before deterministic release.',
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async atomicWrite(target: string, content: string): Promise<void> {
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { flag: 'wx' });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

export function createOperateStore(projectDir: string): OperateStore {
  return new OperateStore(projectDir);
}

export function createEmptyOperatePreferences(): OperatePreferences {
  return emptyPreferences();
}
