import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { canonicalDigest } from './canonical.js';
import { operatingProjectKey } from './config.js';
import { OperatingEventStore } from './event-store.js';
import { withOperatingLock } from './lock-service.js';
import { persistOperatingProjections } from './projection-persistence.js';
import { validateOperatingArtifact } from './protocol.js';
import type { OperatingState } from './types.js';
import { assertOperatingProject } from './workspace.js';

const MAX_MARKER_BYTES = 256 * 1024;
const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
const MAX_QA_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_PROVENANCE_BYTES = 10 * 1024 * 1024;
const MAX_MANIFEST_RECORDS = 20_000;
const MAX_PROVENANCE_RECORDS = 50_000;
const SHIPMENT_CLOCK_TOLERANCE_MS = 15 * 60 * 1000;

interface PipelineShippedMarker {
  shipped_at: string;
  pipeline_version: string;
  runtime: string;
  mode: 'default' | 'spec-driven';
  feature: string;
  tasks_executed: number;
  tasks_failed: number;
  qa_gate_status: 'passed' | 'failed' | 'skipped';
  agents_invoked: string[];
  error_reports: string[];
}

interface RunManifestRecord {
  stage: string;
  agent: string | null;
  started_at: string;
  ended_at: string;
  exit_status: 'success' | 'failure' | 'skipped';
  cost_hint?: string | null;
}

interface ProvenanceEvent {
  timestamp: string;
  artifact_id: string;
  artifact_path: string;
  operation: string;
  producer: {
    product: string;
    version: string;
    runtime: string;
    phase: string;
  };
  run_id: string;
}

interface ShipmentProof {
  specId: string;
  cycleId: string;
  proofDigest: `sha256:${string}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function readContainedFile(
  containmentRoot: string,
  target: string,
  maximumBytes: number,
): Promise<string | null> {
  try {
    const fileInfo = await lstat(target);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || fileInfo.size > maximumBytes) {
      return null;
    }
    const [canonicalRoot, canonicalTarget] = await Promise.all([
      realpath(containmentRoot),
      realpath(target),
    ]);
    if (!isWithin(canonicalRoot, canonicalTarget)) return null;
    const canonicalInfo = await stat(canonicalTarget);
    if (!canonicalInfo.isFile() || canonicalInfo.size > maximumBytes) return null;
    const content = await readFile(canonicalTarget, 'utf8');
    return Buffer.byteLength(content, 'utf8') <= maximumBytes ? content : null;
  } catch {
    return null;
  }
}

async function protocolValid(kind: string, value: unknown): Promise<boolean> {
  try {
    return (await validateOperatingArtifact(kind, value)).length === 0;
  } catch {
    return false;
  }
}

async function parseMarker(raw: string): Promise<PipelineShippedMarker | null> {
  const document = YAML.parseDocument(raw, { uniqueKeys: true });
  if (document.errors.length > 0) return null;
  const value = document.toJS({ maxAliasCount: 0 }) as unknown;
  if (!isPlainObject(value) || !(await protocolValid('pipeline-shipped', value))) {
    return null;
  }
  return value as unknown as PipelineShippedMarker;
}

async function parseJsonLines<T>(
  raw: string,
  kind: string,
  maximumRecords: number,
): Promise<T[] | null> {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0 || lines.length > maximumRecords) return null;
  const records: T[] = [];
  for (const line of lines) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      return null;
    }
    if (!isPlainObject(record) || !(await protocolValid(kind, record))) return null;
    records.push(record as T);
  }
  return records;
}

function qaReportPassed(raw: string): boolean {
  return (
    /^#\s+QA Report\b/im.test(raw) &&
    /^\|\s*Failed\s*\|\s*0\s*\|\s*$/im.test(raw) &&
    /^\|\s*Build status\s*\|\s*pass\s*\|\s*$/im.test(raw) &&
    /^\|\s*Test status\s*\|\s*pass\s*\|\s*$/im.test(raw) &&
    /^##\s+Overall Verdict\s*$/im.test(raw) &&
    /^\[\s*PASS\b/im.test(raw)
  );
}

function clockAgrees(left: string, right: string): boolean {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    Math.abs(leftTime - rightTime) <= SHIPMENT_CLOCK_TOLERANCE_MS
  );
}

function validateManifestPartition(
  records: RunManifestRecord[],
  marker: PipelineShippedMarker,
): RunManifestRecord[] | null {
  let bootstrap = -1;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index]?.stage === 'ship.bootstrap') {
      bootstrap = index;
      break;
    }
  }
  if (bootstrap < 0) return null;
  const partition = records.slice(bootstrap);
  const latestByStage = new Map<string, RunManifestRecord>();
  for (const record of partition) latestByStage.set(record.stage, record);

  const requiredSuccessful = ['ship.bootstrap', 'ship.phase1', 'qa-gate', 'marker-write'];
  if (requiredSuccessful.some((stage) => latestByStage.get(stage)?.exit_status !== 'success')) {
    return null;
  }
  for (const stage of ['devops-bundle', 'doc-gen-bundle', 'snapshot']) {
    const status = latestByStage.get(stage)?.exit_status;
    if (status !== 'success' && status !== 'skipped') return null;
  }

  const tasks = [...latestByStage.entries()]
    .filter(([stage]) => stage.startsWith('ship.task:'))
    .map(([, record]) => record);
  const failures = tasks.filter((record) => record.exit_status === 'failure').length;
  if (
    tasks.length === 0 ||
    tasks.length !== marker.tasks_executed ||
    failures !== marker.tasks_failed ||
    tasks.some((record) => record.exit_status === 'failure')
  ) {
    return null;
  }

  const runtimeRecord = latestByStage.get('ship.runtime-detected');
  if (runtimeRecord?.cost_hint && runtimeRecord.cost_hint !== `runtime=${marker.runtime}`) {
    return null;
  }
  const markerTime = Date.parse(marker.shipped_at);
  if (
    !Number.isFinite(markerTime) ||
    !partition.every((record) => {
      const startedAt = Date.parse(record.started_at);
      const endedAt = Date.parse(record.ended_at);
      return (
        Number.isFinite(startedAt) &&
        Number.isFinite(endedAt) &&
        startedAt <= endedAt &&
        endedAt <= markerTime + SHIPMENT_CLOCK_TOLERANCE_MS
      );
    }) ||
    !clockAgrees(latestByStage.get('marker-write')?.ended_at ?? '', marker.shipped_at)
  ) {
    return null;
  }
  return partition;
}

function expectedSpecDirectoryName(specId: string, name: string): boolean {
  return name.startsWith(`${specId}-`) && name.length > specId.length + 1;
}

async function resolveLinkedSpecDirectory(
  projectRoot: string,
  specId: string,
): Promise<string | null> {
  const specsRoot = path.join(projectRoot, '.planr', 'specs');
  const matches = (await readdir(specsRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && expectedSpecDirectoryName(specId, entry.name))
    .map((entry) => path.join(specsRoot, entry.name));
  if (matches.length !== 1) return null;
  try {
    const [canonicalProject, canonicalSpec] = await Promise.all([
      realpath(projectRoot),
      realpath(matches[0] as string),
    ]);
    return isWithin(canonicalProject, canonicalSpec) ? canonicalSpec : null;
  } catch {
    return null;
  }
}

async function inspectShipmentProof(input: {
  projectRoot: string;
  specId: string;
  cycleId: string;
}): Promise<ShipmentProof | null> {
  const specDirectory = await resolveLinkedSpecDirectory(input.projectRoot, input.specId);
  if (!specDirectory) return null;
  const directoryName = path.basename(specDirectory);
  const slug = directoryName.slice(`${input.specId}-`.length);
  const specPath = path.join(specDirectory, `${directoryName}.md`);
  const [spec, markerRaw, manifestRaw, qaReport, provenanceRaw] = await Promise.all([
    readContainedFile(specDirectory, specPath, 5 * 1024 * 1024),
    readContainedFile(
      specDirectory,
      path.join(specDirectory, '.pipeline-shipped'),
      MAX_MARKER_BYTES,
    ),
    readContainedFile(
      specDirectory,
      path.join(specDirectory, '.run-manifest.jsonl'),
      MAX_MANIFEST_BYTES,
    ),
    readContainedFile(specDirectory, path.join(specDirectory, 'qa-report.md'), MAX_QA_REPORT_BYTES),
    readContainedFile(
      input.projectRoot,
      path.join(input.projectRoot, '.planr', 'provenance.jsonl'),
      MAX_PROVENANCE_BYTES,
    ),
  ]);
  if (!spec || !markerRaw || !manifestRaw || !qaReport || !provenanceRaw) return null;
  if (
    !new RegExp(
      `^id:\\s*["']?${input.specId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*$`,
      'm',
    ).test(spec)
  ) {
    return null;
  }

  const marker = await parseMarker(markerRaw);
  if (
    !marker ||
    marker.mode !== 'spec-driven' ||
    marker.feature !== slug ||
    marker.tasks_executed < 1 ||
    marker.tasks_failed !== 0 ||
    marker.qa_gate_status !== 'passed' ||
    marker.error_reports.length !== 0 ||
    !marker.agents_invoked.includes('qa-agent') ||
    !qaReportPassed(qaReport)
  ) {
    return null;
  }

  const manifest = await parseJsonLines<RunManifestRecord>(
    manifestRaw,
    'run-manifest',
    MAX_MANIFEST_RECORDS,
  );
  if (!manifest) return null;
  const manifestPartition = validateManifestPartition(manifest, marker);
  if (!manifestPartition) return null;

  const provenance = await parseJsonLines<ProvenanceEvent>(
    provenanceRaw,
    'provenance-event',
    MAX_PROVENANCE_RECORDS,
  );
  if (!provenance) return null;
  const expectedArtifactPath = path.relative(input.projectRoot, specPath).split(path.sep).join('/');
  let shipmentEvent: ProvenanceEvent | undefined;
  for (let index = provenance.length - 1; index >= 0; index -= 1) {
    const event = provenance[index];
    if (
      event &&
      event.artifact_id === input.specId &&
      event.artifact_path === expectedArtifactPath &&
      event.operation === 'shipped' &&
      event.producer.product === 'planr-pipeline' &&
      event.producer.version === marker.pipeline_version &&
      event.producer.runtime === marker.runtime &&
      event.producer.phase === 'delivery' &&
      event.run_id.length > 0 &&
      clockAgrees(event.timestamp, marker.shipped_at)
    ) {
      shipmentEvent = event;
      break;
    }
  }
  if (!shipmentEvent) return null;

  return {
    specId: input.specId,
    cycleId: input.cycleId,
    proofDigest: canonicalDigest({
      marker,
      manifestPartition,
      qaReportDigest: canonicalDigest(qaReport),
      provenance: shipmentEvent,
      specDigest: canonicalDigest(spec),
    }),
  };
}

/**
 * Discovers pipeline shipment proof for operating-linked specs without
 * modifying pipeline artifacts. Only a complete, mutually consistent proof
 * emits `ship.observed`; incomplete or contradictory evidence is ignored.
 */
export async function reconcileOperatingShipObservations(input: {
  projectRoot: string;
  localRoot?: string;
}): Promise<{ observed: number; state: OperatingState }> {
  const projectRoot = await assertOperatingProject(input.projectRoot);
  const store = new OperatingEventStore(projectRoot, { localRoot: input.localRoot });
  const initial = await store.replay();
  const initialState = await store.state();
  const alreadyObserved = new Set(
    initial.events.filter((event) => event.type === 'ship.observed').map((event) => event.entityId),
  );
  const proofs: ShipmentProof[] = [];
  for (const link of initialState.specLinks) {
    if (
      link.state === 'shipped' ||
      alreadyObserved.has(link.specId) ||
      typeof link.cycleId !== 'string'
    ) {
      continue;
    }
    const proof = await inspectShipmentProof({
      projectRoot,
      specId: link.specId,
      cycleId: link.cycleId,
    });
    if (proof) proofs.push(proof);
  }
  if (proofs.length === 0) return { observed: 0, state: initialState };

  return withOperatingLock(
    projectRoot,
    {
      projectKey: operatingProjectKey(projectRoot),
      expectedEventHead: initial.eventHead,
      currentEventHead: initial.eventHead,
      localRoot: input.localRoot,
    },
    async (lock) => {
      let head = initial.eventHead;
      let observed = 0;
      for (const proof of proofs.sort((left, right) => left.specId.localeCompare(right.specId))) {
        const replay = await store.replay();
        if (
          replay.events.some(
            (event) => event.type === 'ship.observed' && event.entityId === proof.specId,
          )
        ) {
          continue;
        }
        const revalidated = await inspectShipmentProof({
          projectRoot,
          specId: proof.specId,
          cycleId: proof.cycleId,
        });
        if (!revalidated || revalidated.proofDigest !== proof.proofDigest) continue;
        const event = await store.append({
          type: 'ship.observed',
          cycleId: proof.cycleId,
          entityId: proof.specId,
          payload: { specId: proof.specId },
          correlationId: proof.proofDigest,
          expectedHead: head.hash,
        });
        const next = { sequence: event.sequence, hash: event.eventHash };
        await lock.advanceEventHead(head, next);
        head = next;
        observed += 1;
      }
      const state = await store.state();
      if (observed > 0) {
        await store.writeCheckpoint(state);
        await persistOperatingProjections({
          projectRoot,
          localRoot: input.localRoot,
          state,
          revalidateEventHead: async () => (await store.replay()).eventHead,
        });
      }
      return { observed, state };
    },
  );
}
