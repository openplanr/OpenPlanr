import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { OperateLegacyReplayProof } from './storage-layout.js';

const VERIFIER_VERSION = '1.0.0';
const STORE_FORMAT = 'openplanr-operate-store';
const STORE_VERSION = 3;
const PROTOCOL_VERSION = '2.0.0';
const CUSTODY_FORMAT = 'openplanr-operate-custody';
const CUSTODY_VERSION = 2;
const GENERATION_PATTERN = /^gen_[a-f0-9]{32}$/u;
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9._-]+$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

type JsonRecord = Record<string, unknown>;
type ScopeBinding = {
  cycleId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
};

function incompatible(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'OPERATE_STORE_INCOMPATIBLE' });
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
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw incompatible('Legacy Operate custody contains non-JSON data.');
  return encoded;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function hashValue(value: unknown): string {
  return sha256(Buffer.from(canonical(value), 'utf8'));
}

function safeGeneration(value: unknown): string {
  const generation = typeof value === 'string' ? value.trim() : '';
  if (!GENERATION_PATTERN.test(generation)) {
    throw incompatible('The legacy Operate generation pointer is invalid.');
  }
  return generation;
}

function safeHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw incompatible(`The legacy Operate ${label} digest is invalid.`);
  }
  return value;
}

function safeBindings(value: unknown): ScopeBinding[] {
  if (!Array.isArray(value)) throw incompatible('Legacy Operate scope bindings are invalid.');
  const seen = new Set<string>();
  const bindings = value.map((candidate) => {
    if (
      !isRecord(candidate) ||
      ['cycleId', 'scopeId', 'domainId', 'domainVersion'].some(
        (field) => typeof candidate[field] !== 'string' || candidate[field] === '',
      ) ||
      seen.has(String(candidate.cycleId))
    ) {
      throw incompatible('A legacy Operate scope binding is invalid or duplicated.');
    }
    seen.add(String(candidate.cycleId));
    return {
      cycleId: String(candidate.cycleId),
      scopeId: String(candidate.scopeId),
      domainId: String(candidate.domainId),
      domainVersion: String(candidate.domainVersion),
    };
  });
  return bindings.sort((left, right) => left.cycleId.localeCompare(right.cycleId));
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

function assertStringMap(value: unknown, label: string): void {
  if (!isRecord(value)) throw incompatible(`Legacy Operate ${label} is invalid.`);
  for (const [key, entry] of Object.entries(value)) {
    if (!key || typeof entry !== 'string' || !entry) {
      throw incompatible(`A legacy Operate ${label} entry is invalid.`);
    }
  }
}

function assertPreferences(value: unknown, bindings: ScopeBinding[]): void {
  if (!isRecord(value)) throw incompatible('Legacy Operate preferences are invalid.');
  for (const field of [
    'selectedScopeId',
    'selectedDomainId',
    'selectedDomainVersion',
    'lastCycleId',
  ]) {
    if (value[field] !== null && typeof value[field] !== 'string') {
      throw incompatible(`Legacy Operate preference ${field} is invalid.`);
    }
  }
  for (const field of ['reviewOwners', 'assignmentArtifactIds', 'cycleIntelligencePlanIds']) {
    assertStringMap(value[field], field);
  }
  if (!isRecord(value.cycleModes) || !isRecord(value.cycleDeliveryRoutes)) {
    throw incompatible('Legacy Operate cycle preferences are invalid.');
  }
  for (const [cycleId, mode] of Object.entries(value.cycleModes)) {
    if (!cycleId || !['assignment', 'lifecycle'].includes(String(mode))) {
      throw incompatible('A legacy Operate cycle mode is invalid.');
    }
  }
  for (const [cycleId, route] of Object.entries(value.cycleDeliveryRoutes)) {
    if (
      !cycleId ||
      !['contained-execution', 'planning-work', 'human-external', 'observe-only'].includes(
        String(route),
      )
    ) {
      throw incompatible('A legacy Operate delivery route is invalid.');
    }
  }
  if (!isRecord(value.cycleRoleAssignments) || !isRecord(value.actorMemberships)) {
    throw incompatible('Legacy Operate role assignments are invalid.');
  }
  for (const assignments of Object.values(value.cycleRoleAssignments)) {
    assertStringMap(assignments, 'role assignment');
  }
  for (const [actorId, membership] of Object.entries(value.actorMemberships)) {
    if (
      !actorId ||
      !isRecord(membership) ||
      membership.actorId !== actorId ||
      membership.role !== 'owner' ||
      ['scopeId', 'domainId', 'domainVersion'].some(
        (field) => typeof membership[field] !== 'string' || membership[field] === '',
      )
    ) {
      throw incompatible('A legacy Operate actor membership is invalid.');
    }
  }
  const selected =
    typeof value.lastCycleId === 'string'
      ? bindings.find((entry) => entry.cycleId === value.lastCycleId)
      : null;
  if (
    value.lastCycleId !== null &&
    (!selected ||
      selected.scopeId !== value.selectedScopeId ||
      selected.domainId !== value.selectedDomainId ||
      selected.domainVersion !== value.selectedDomainVersion)
  ) {
    throw incompatible('Legacy Operate selected preferences do not match cycle custody.');
  }
}

function replayIndexProjection(state: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(state).filter(
      ([key]) => key === 'eventHead' || key === 'eventReplayIndex' || /ReplayIndex$/u.test(key),
    ),
  );
}

async function readJsonRecord(target: string, label: string): Promise<JsonRecord> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(target, 'utf8'));
  } catch {
    throw incompatible(`The legacy Operate ${label} is unavailable or invalid JSON.`);
  }
  if (!isRecord(value)) throw incompatible(`The legacy Operate ${label} is not an object.`);
  return value;
}

async function digestTree(root: string): Promise<{ hash: string; fileCount: number }> {
  const records: Array<{ path: string; hash: string; size: number }> = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
        throw incompatible(`Legacy Operate custody contains an unsupported entry: ${relative}`);
      }
      if (metadata.isDirectory()) await walk(absolute);
      else {
        const bytes = await readFile(absolute);
        records.push({
          path: relative,
          hash: createHash('sha256').update(bytes).digest('hex'),
          size: bytes.byteLength,
        });
      }
    }
  };
  await walk(root);
  return Object.freeze({ hash: sha256(JSON.stringify(records)), fileCount: records.length });
}

function proofPayload(proof: Omit<OperateLegacyReplayProof, 'receiptHash'>): string {
  return JSON.stringify({
    kind: proof.kind,
    schemaVersion: proof.schemaVersion,
    protocolVersion: proof.protocolVersion,
    source: proof.source,
    projectFingerprint: proof.projectFingerprint,
    tree: proof.tree,
    replay: proof.replay,
    verifier: proof.verifier,
    verifiedAt: proof.verifiedAt,
  });
}

async function readProjectIdentity(canonicalProject: string): Promise<string> {
  const configPath = path.join(canonicalProject, '.planr', 'config.json');
  let config: unknown = null;
  try {
    const metadata = await lstat(configPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw incompatible('Legacy Operate project identity configuration has unsafe custody.');
    }
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    if (isRecord(parsed)) {
      config = { projectName: parsed.projectName ?? null, createdAt: parsed.createdAt ?? null };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return hashValue({ kind: 'openplanr-project-identity', resolved: canonicalProject, config });
}

async function readManifest(
  root: string,
  generation: string,
  projectIdentity: string,
  custodyNonce?: string,
): Promise<JsonRecord> {
  const manifest = await readJsonRecord(
    path.join(root, 'generations', generation, 'manifest.json'),
    `generation ${generation} manifest`,
  );
  if (
    manifest.format !== STORE_FORMAT ||
    manifest.storeVersion !== STORE_VERSION ||
    manifest.protocolVersion !== PROTOCOL_VERSION ||
    manifest.projectIdentity !== projectIdentity ||
    manifest.generation !== generation ||
    (custodyNonce !== undefined && manifest.custodyNonce !== custodyNonce) ||
    typeof manifest.custodyNonce !== 'string' ||
    !/^[a-f0-9]{32}$/u.test(manifest.custodyNonce) ||
    !isRecord(manifest.baseState) ||
    !isRecord(manifest.state) ||
    !Array.isArray(manifest.artifacts) ||
    !Number.isSafeInteger(manifest.eventCount) ||
    Number(manifest.eventCount) < 0 ||
    typeof manifest.createdAt !== 'string'
  ) {
    throw incompatible(`The legacy Operate generation ${generation} manifest is incompatible.`);
  }
  safeHash(manifest.eventsHash, 'Event ledger');
  safeHash(manifest.replayIndexHash, 'replay index');
  safeHash(manifest.integrityHash, 'manifest integrity');
  if (
    (manifest.parentGeneration === null) !== (manifest.parentIntegrityHash === null) ||
    (manifest.parentGeneration !== null &&
      !GENERATION_PATTERN.test(String(manifest.parentGeneration))) ||
    (manifest.parentIntegrityHash !== null &&
      !HASH_PATTERN.test(String(manifest.parentIntegrityHash)))
  ) {
    throw incompatible(`The legacy Operate generation ${generation} parent custody is invalid.`);
  }
  const bindings = safeBindings(manifest.bindings);
  if (canonical(bindings) !== canonical(bindingsFromState(manifest.baseState))) {
    throw incompatible(`The legacy Operate generation ${generation} bindings are inconsistent.`);
  }
  assertPreferences(manifest.preferences, bindings);
  const { integrityHash: _integrityHash, ...projection } = manifest;
  if (hashValue(projection) !== manifest.integrityHash) {
    throw incompatible(`The legacy Operate generation ${generation} manifest digest is invalid.`);
  }
  return { ...manifest, bindings };
}

async function verifyJournal(
  root: string,
  projectIdentity: string,
): Promise<{ records: JsonRecord[]; manifests: Map<string, JsonRecord> }> {
  const journalText = await readFile(path.join(root, 'HEADS.jsonl'), 'utf8').catch(() => {
    throw incompatible('The legacy Operate head journal is unavailable.');
  });
  if (!journalText.endsWith('\n'))
    throw incompatible('The legacy Operate head journal is truncated.');
  const records: JsonRecord[] = [];
  const manifests = new Map<string, JsonRecord>();
  let custodyNonce: string | null = null;
  let previousRecordHash: string | null = null;
  for (const [index, line] of journalText.split('\n').filter(Boolean).entries()) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      throw incompatible('The legacy Operate head journal contains invalid JSON.');
    }
    if (
      !isRecord(record) ||
      record.format !== 'openplanr-operate-head-journal' ||
      record.journalVersion !== 1 ||
      record.sequence !== index + 1 ||
      record.projectIdentity !== projectIdentity ||
      typeof record.custodyNonce !== 'string' ||
      !/^[a-f0-9]{32}$/u.test(record.custodyNonce) ||
      (custodyNonce !== null && record.custodyNonce !== custodyNonce) ||
      record.previousRecordHash !== previousRecordHash ||
      typeof record.createdAt !== 'string'
    ) {
      throw incompatible('The legacy Operate head journal is inconsistent or foreign.');
    }
    const generation = safeGeneration(record.generation);
    safeHash(record.integrityHash, 'journal integrity');
    safeHash(record.recordHash, 'journal record');
    const bindings = safeBindings(record.bindings);
    const { recordHash: _recordHash, ...projection } = record;
    if (hashValue(projection) !== record.recordHash) {
      throw incompatible('A legacy Operate head journal record digest is invalid.');
    }
    const manifest = await readManifest(root, generation, projectIdentity, record.custodyNonce);
    if (
      manifest.integrityHash !== record.integrityHash ||
      canonical(manifest.bindings) !== canonical(bindings)
    ) {
      throw incompatible('A legacy Operate journal record does not anchor its manifest.');
    }
    records.push({ ...record, generation, bindings });
    manifests.set(generation, manifest);
    custodyNonce = record.custodyNonce;
    previousRecordHash = String(record.recordHash);
  }
  if (records.length === 0) throw incompatible('The legacy Operate head journal is empty.');
  return { records, manifests };
}

/**
 * Reads the frozen Operate Store v3 custody format without importing the current
 * Store, reducers, Protocol helpers, Git, network, or sibling workspaces. This
 * proves exact durable bytes and indexes; it makes no claim that superseded
 * result contracts can be reinterpreted by the current runtime.
 */
export async function runPinnedLegacyReplayVerifier(
  projectDir: string,
): Promise<OperateLegacyReplayProof> {
  try {
    const canonicalProject = await realpath(path.resolve(projectDir));
    const legacyRoot = path.join(canonicalProject, '.planr', 'operate-v2');
    const metadata = await lstat(legacyRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw incompatible('The legacy version 2 Operate Store is not one real directory.');
    }
    const tree = await digestTree(legacyRoot);
    const currentGeneration = safeGeneration(
      await readFile(path.join(legacyRoot, 'CURRENT'), 'utf8').catch(() => {
        throw incompatible('The legacy Operate current pointer is unavailable.');
      }),
    );
    const projectIdentity = await readProjectIdentity(canonicalProject);
    const { records, manifests } = await verifyJournal(legacyRoot, projectIdentity);
    const head = records.at(-1);
    const manifest = manifests.get(currentGeneration);
    const custody = await readJsonRecord(path.join(legacyRoot, 'CUSTODY.json'), 'custody anchor');
    if (
      !head ||
      !manifest ||
      custody.format !== CUSTODY_FORMAT ||
      custody.custodyVersion !== CUSTODY_VERSION ||
      custody.projectIdentity !== projectIdentity ||
      custody.custodyNonce !== head.custodyNonce ||
      custody.headGeneration !== currentGeneration ||
      custody.headGeneration !== head.generation ||
      custody.headIntegrityHash !== manifest.integrityHash ||
      custody.headIntegrityHash !== head.integrityHash ||
      custody.journalSequence !== head.sequence ||
      custody.journalRecordHash !== head.recordHash ||
      canonical(safeBindings(custody.bindings)) !== canonical(manifest.bindings) ||
      typeof custody.updatedAt !== 'string'
    ) {
      throw incompatible(
        'The legacy Operate current pointer, journal, and custody anchor diverge.',
      );
    }

    const generationRoot = path.join(legacyRoot, 'generations', currentGeneration);
    const eventBytes = await readFile(path.join(generationRoot, 'events.jsonl')).catch(() => {
      throw incompatible('The legacy Operate Event ledger is unavailable.');
    });
    if (sha256(eventBytes) !== manifest.eventsHash) {
      throw incompatible('The legacy Operate Event ledger digest is invalid.');
    }
    const eventLines = eventBytes.toString('utf8').split('\n').filter(Boolean);
    if (eventLines.length !== manifest.eventCount) {
      throw incompatible('The legacy Operate Event ledger count is invalid.');
    }
    for (const line of eventLines) {
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        throw incompatible('The legacy Operate Event ledger contains invalid JSON.');
      }
      if (!isRecord(event)) throw incompatible('A legacy Operate Event is not an object.');
    }
    if (
      hashValue(replayIndexProjection(manifest.state as JsonRecord)) !== manifest.replayIndexHash
    ) {
      throw incompatible('The legacy Operate replay index digest is invalid.');
    }

    const artifactHashes: Array<{ artifactId: string; rawHash: string }> = [];
    const artifactIds = new Set<string>();
    for (const candidate of manifest.artifacts as unknown[]) {
      if (
        !isRecord(candidate) ||
        typeof candidate.artifactId !== 'string' ||
        !ARTIFACT_ID_PATTERN.test(candidate.artifactId) ||
        candidate.file !== `${candidate.artifactId}.bin` ||
        !Number.isSafeInteger(candidate.sizeBytes) ||
        Number(candidate.sizeBytes) < 0 ||
        artifactIds.has(candidate.artifactId)
      ) {
        throw incompatible('Legacy Operate Artifact custody metadata is invalid.');
      }
      artifactIds.add(candidate.artifactId);
      const rawHash = safeHash(candidate.rawHash, 'Artifact');
      const bytes = await readFile(
        path.join(generationRoot, 'artifacts', String(candidate.file)),
      ).catch(() => {
        throw incompatible(`Legacy Operate Artifact ${candidate.artifactId} is unavailable.`);
      });
      if (bytes.byteLength !== candidate.sizeBytes || sha256(bytes) !== rawHash) {
        throw incompatible(`Legacy Operate Artifact ${candidate.artifactId} bytes are invalid.`);
      }
      artifactHashes.push({ artifactId: candidate.artifactId, rawHash });
    }
    artifactHashes.sort((left, right) => left.artifactId.localeCompare(right.artifactId));

    const eventHead = (manifest.state as JsonRecord).eventHead;
    if (
      !isRecord(eventHead) ||
      !Number.isSafeInteger(eventHead.sequence) ||
      Number(eventHead.sequence) < 0 ||
      (Number(eventHead.sequence) === 0
        ? eventHead.hash !== null
        : typeof eventHead.hash !== 'string' || !HASH_PATTERN.test(eventHead.hash))
    ) {
      throw incompatible('The legacy Operate state has an invalid Event head.');
    }
    const unsigned: Omit<OperateLegacyReplayProof, 'receiptHash'> = Object.freeze({
      kind: 'operate-legacy-replay-proof',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      source: 'operate-v2',
      projectFingerprint: sha256(`openplanr-operate-project\0${canonicalProject}`),
      tree,
      replay: Object.freeze({
        currentGeneration,
        stateCanonicalHash: hashValue(manifest.state),
        eventHead: Object.freeze({
          sequence: Number(eventHead.sequence),
          hash: eventHead.hash as string | null,
        }),
        artifactHashes: Object.freeze(artifactHashes),
      }),
      verifier: Object.freeze({
        implementation: 'bundled-compatibility-reader',
        verifierVersion: VERIFIER_VERSION,
      }),
      verifiedAt: new Date().toISOString(),
    });
    return Object.freeze({ ...unsigned, receiptHash: sha256(proofPayload(unsigned)) });
  } catch (cause) {
    if ((cause as { code?: string }).code === 'OPERATE_STORE_INCOMPATIBLE') throw cause;
    throw incompatible(
      `Bundled legacy Operate custody verification failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}
