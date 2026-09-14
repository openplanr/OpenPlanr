import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  assertShipClosure,
  buildShipClosureManifestRow,
  buildShipClosureRunEvidence,
  prepareShip,
  type ShipClosureRecord,
  verifyShipCompatibilityProjection,
} from 'planr-pipeline';
import { buildOperatingDeliveryEvidenceV1 } from 'planr-pipeline/operate/planning-bridge-v2';
import {
  sha256Jcs,
  validateProtocolArtifact as validatePipelineProtocolArtifact,
} from 'planr-pipeline/protocol';
import YAML from 'yaml';
import { loadConfig } from '../config-service.js';
import { getSpecsRootDir } from '../spec-service.js';
import type { JsonRecord, OperateComposition } from './composition.js';
import { readSpecOperatingOrigin } from './spec-operating-origin-service.js';
import type { OperateStoredRuntime } from './store.js';

type DeliveryInput = {
  specId: string;
  planRun: JsonRecord;
  shipRun: JsonRecord;
  tasks: JsonRecord[];
  changedSurfaces: string[];
  qa: JsonRecord;
  limitations?: string[];
  artifacts: Array<{ artifactId: string; path: string; hash: string; classification: string }>;
  classification: 'public' | 'internal' | 'confidential' | 'restricted';
  summary: string;
  deliveryStatus: 'succeeded' | 'blocked' | 'failed' | 'rolled-back';
  rollback?: JsonRecord | null;
  createdAt: string;
};

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function hashBytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function exactSpecDirectory(projectRoot: string, specId: string): Promise<string> {
  if (!/^SPEC-\d{3,}$/u.test(specId))
    fail('E_OPERATE_PLANNING_INVALID', 'The delivery SPEC identity is invalid.');
  const config = await loadConfig(projectRoot);
  const specsRoot = getSpecsRootDir(projectRoot, config);
  const entries = (await readdir(specsRoot, { withFileTypes: true })).filter(
    (entry) =>
      entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith(`${specId}-`),
  );
  if (entries.length !== 1)
    fail('E_OPERATE_ORIGIN_INVALID', 'Delivery evidence requires one exact parent SPEC directory.');
  const specDir = path.join(specsRoot, entries[0].name);
  const canonicalSpecsRoot = await realpath(specsRoot);
  const canonicalSpecDir = await realpath(specDir);
  const relative = path.relative(canonicalSpecsRoot, canonicalSpecDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(
      'E_OPERATE_ORIGIN_INVALID',
      'The parent SPEC directory escapes its configured planning root.',
    );
  }
  return specDir;
}

async function validateArtifactCustody(
  specDir: string,
  input: DeliveryInput,
): Promise<{
  artifacts: JsonRecord[];
  bodies: Map<string, string>;
  bodiesById: Map<string, string>;
}> {
  const canonicalSpecDir = await realpath(specDir);
  const logicalSpecDir = path.resolve(specDir);
  const results: JsonRecord[] = [];
  const bodies = new Map<string, string>();
  const bodiesById = new Map<string, string>();
  const artifactIds = new Set<string>();
  const artifactPaths = new Set<string>();
  const canonicalTargets = new Set<string>();
  for (const artifact of input.artifacts) {
    const target = path.resolve(specDir, artifact.path);
    if (artifactIds.has(artifact.artifactId) || artifactPaths.has(target)) {
      fail(
        'E_OPERATE_PLANNING_CUSTODY',
        'Delivery Artifact custody contains a duplicate identity.',
      );
    }
    artifactIds.add(artifact.artifactId);
    artifactPaths.add(target);
    const relative = path.relative(logicalSpecDir, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      fail('E_OPERATE_PLANNING_PATH', 'A delivery Artifact path escapes its parent SPEC.');
    }
    const stat = await lstat(target).catch(() =>
      fail('E_OPERATE_PLANNING_CUSTODY', 'A delivery Artifact is missing.'),
    );
    const canonicalTarget = await realpath(target);
    const canonicalRelative = path.relative(canonicalSpecDir, canonicalTarget);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      !canonicalRelative ||
      canonicalRelative.startsWith('..') ||
      path.isAbsolute(canonicalRelative)
    ) {
      fail(
        'E_OPERATE_PLANNING_PATH',
        'A delivery Artifact must be a regular file below its parent SPEC.',
      );
    }
    const canonicalExpected = path.resolve(canonicalSpecDir, relative);
    if (canonicalTarget !== canonicalExpected || canonicalTargets.has(canonicalTarget)) {
      fail(
        'E_OPERATE_PLANNING_PATH',
        'A delivery Artifact path must name one unique canonical regular file.',
      );
    }
    canonicalTargets.add(canonicalTarget);
    const bytes = await readFile(target);
    if (hashBytes(bytes) !== artifact.hash) {
      fail(
        'E_OPERATE_PLANNING_CUSTODY',
        'A delivery Artifact body does not match its declared immutable hash.',
      );
    }
    results.push({
      artifactId: artifact.artifactId,
      hash: artifact.hash,
      classification: artifact.classification,
    });
    bodies.set(artifact.path, bytes.toString('utf8'));
    bodiesById.set(artifact.artifactId, bytes.toString('utf8'));
  }
  return { artifacts: results, bodies, bodiesById };
}

function exactCorrelation(origin: JsonRecord): JsonRecord {
  const transaction = origin.transaction as JsonRecord;
  return {
    correlation_id: origin.correlationId,
    proposal_id: origin.proposalId,
    proposal_hash: origin.proposalHash,
    transaction_id: transaction.transactionId,
    receipt_hash: transaction.receiptHash,
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return sha256Jcs(left as never) === sha256Jcs(right as never);
}

async function validateRunReceipts(
  projectRoot: string,
  specDir: string,
  origin: JsonRecord,
  input: DeliveryInput,
): Promise<{ events: JsonRecord[]; shipEvent: JsonRecord }> {
  const provenancePath = path.join(projectRoot, '.planr', 'provenance.jsonl');
  let events: JsonRecord[];
  try {
    events = (await readFile(provenancePath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonRecord);
  } catch {
    fail('E_OPERATE_PLANNING_CUSTODY', 'Delivery requires durable PLAN and SHIP provenance.');
  }
  const correlation = exactCorrelation(origin);
  const originSpec = origin.spec as JsonRecord;
  const expectedArtifactPath = path
    .relative(
      projectRoot,
      path.join(specDir, `${String(originSpec.specId)}-${String(originSpec.slug)}.md`),
    )
    .replaceAll(path.sep, '/');
  for (const event of events) {
    if (validatePipelineProtocolArtifact('provenance-event', event).length > 0) {
      fail('E_OPERATE_PLANNING_CUSTODY', 'The provenance ledger violates its public contract.');
    }
  }
  let shipEvent: JsonRecord | null = null;
  for (const [operation, run] of [
    ['decomposed', input.planRun],
    ['shipped', input.shipRun],
  ] as const) {
    const matches = events.filter(
      (event) =>
        event.operation === operation &&
        event.artifact_id === input.specId &&
        event.artifact_path === expectedArtifactPath &&
        sameJson(event.correlation, correlation) &&
        event.run_id === run.runId &&
        (event.producer as JsonRecord)?.product === 'planr-pipeline' &&
        (event.producer as JsonRecord)?.phase ===
          (operation === 'decomposed' ? 'po' : 'delivery') &&
        (event.producer as JsonRecord)?.runtime === run.runtime &&
        (event.producer as JsonRecord)?.version === run.packageVersion,
    );
    if (matches.length !== 1) {
      fail('E_OPERATE_PLANNING_CUSTODY', 'Delivery lacks one exact origin-bound run receipt.');
    }
    if (
      matches[0].event_id !== run.provenanceEventId ||
      sha256Jcs(matches[0] as never) !== run.provenanceEventHash
    ) {
      fail(
        'E_OPERATE_PLANNING_CUSTODY',
        'PLAN run receipt does not bind its durable provenance Event.',
      );
    }
    if (operation === 'shipped') shipEvent = matches[0];
  }
  if (!shipEvent) fail('E_OPERATE_PLANNING_CUSTODY', 'Delivery lacks a certified SHIP run.');
  return { events, shipEvent };
}

function parseClosedJson(body: string, label: string): JsonRecord {
  try {
    const value = JSON.parse(body) as JsonRecord;
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('not object');
    return value;
  } catch {
    fail('E_OPERATE_PLANNING_CUSTODY', `${label} custody is malformed.`);
  }
}

const SHIP_CLOSURE_RUN_ID = /^ship_[a-f0-9]{32}$/u;

function shipClosureReceiptPath(runId: unknown): string | null {
  return typeof runId === 'string' && SHIP_CLOSURE_RUN_ID.test(runId)
    ? `.ship/receipts/${runId}.json`
    : null;
}

export async function requireCurrentReceiptCustody(
  specDir: string,
  runId: unknown,
  bodies: Map<string, string>,
  currentClosureRequired = false,
): Promise<string | null> {
  const relative = shipClosureReceiptPath(runId);
  if (relative === null) {
    if (currentClosureRequired) {
      fail(
        'E_OPERATE_PLANNING_CUSTODY',
        'Current SHIP provenance names a run that cannot resolve a closure receipt.',
      );
    }
    return null;
  }
  const target = path.join(specDir, ...relative.split('/'));
  let exists = false;
  try {
    await lstat(target);
    exists = true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
      fail('E_OPERATE_PLANNING_CUSTODY', 'The SHIP closure receipt cannot be inspected.');
    }
  }
  if (!exists && currentClosureRequired) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'Current SHIP provenance cannot deliver before its terminal closure receipt exists.',
    );
  }
  if (!exists) return null;
  if (!bodies.has(relative)) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'A current SHIP closure receipt is authoritative and must be included in delivery Artifact custody.',
    );
  }
  return relative;
}

function requireProjectionArtifact(
  input: DeliveryInput,
  bodies: Map<string, string>,
  artifactPath: string,
  label: string,
): { artifact: DeliveryInput['artifacts'][number]; body: string } {
  const matches = input.artifacts.filter((artifact) => artifact.path === artifactPath);
  const body = bodies.get(artifactPath);
  if (
    matches.length !== 1 ||
    body === undefined ||
    hashBytes(Buffer.from(body)) !== matches[0].hash
  ) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      `Delivery requires one exact immutable ${label} projection.`,
    );
  }
  return { artifact: matches[0], body };
}

function validateShipClosureCompatibilityProjections(
  projectRoot: string,
  specDir: string,
  input: DeliveryInput,
  bodies: Map<string, string>,
  receipt: ShipClosureRecord,
  runEvidence: JsonRecord,
): { deliveryStatus: 'succeeded' | 'blocked'; qaStatus: 'passed' | 'failed' } {
  const terminal = receipt.terminal;
  if (terminal === null) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'SHIP compatibility projections require a terminal receipt.',
    );
  }
  const manifestProjection = requireProjectionArtifact(
    input,
    bodies,
    '.run-manifest.jsonl',
    'SHIP manifest',
  );
  let rows: JsonRecord[];
  try {
    rows = manifestProjection.body
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonRecord);
  } catch {
    fail('E_OPERATE_PLANNING_CUSTODY', 'The accepted SHIP manifest is malformed.');
  }
  for (const row of rows) {
    if (validatePipelineProtocolArtifact('run-manifest', row).length > 0) {
      fail(
        'E_OPERATE_PLANNING_CUSTODY',
        'The accepted SHIP manifest violates its public contract.',
      );
    }
  }

  const stage = `ship.closure:${String(receipt.runId)}`;
  const matchingRows = rows.flatMap((row, index) =>
    row.stage === stage ? [{ row, line: index + 1 }] : [],
  );
  const expectedRow = buildShipClosureManifestRow(receipt, projectRoot, specDir) as JsonRecord;
  if (matchingRows.length !== 1 || !sameJson(matchingRows[0].row, expectedRow)) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'The accepted SHIP manifest closure row conflicts with the terminal receipt.',
    );
  }

  const markerProjection = requireProjectionArtifact(
    input,
    bodies,
    '.pipeline-shipped',
    'SHIP marker',
  );
  let marker: JsonRecord;
  try {
    marker = YAML.parse(markerProjection.body) as JsonRecord;
  } catch {
    fail('E_OPERATE_PLANNING_CUSTODY', 'The accepted SHIP marker is malformed.');
  }
  if (
    !marker ||
    Array.isArray(marker) ||
    typeof marker !== 'object' ||
    validatePipelineProtocolArtifact('pipeline-shipped', marker).length > 0
  ) {
    fail('E_OPERATE_PLANNING_CUSTODY', 'The accepted SHIP marker violates its public contract.');
  }

  const line = matchingRows[0].line;
  const qaProjection = requireProjectionArtifact(input, bodies, 'qa-report.md', 'QA report');
  let projectionVerified = false;
  try {
    const prepared = prepareShip({
      projectRoot,
      feature: receipt.feature,
      humanReviewConfirmed: true,
    }) as { root?: unknown };
    projectionVerified =
      typeof prepared.root === 'string' &&
      path.resolve(prepared.root) === path.resolve(specDir) &&
      verifyShipCompatibilityProjection(receipt, { projectRoot, prepared });
  } catch {
    projectionVerified = false;
  }
  if (
    !projectionVerified ||
    marker.pipeline_version !== input.shipRun.packageVersion ||
    marker.run_id !== receipt.runId ||
    marker.manifest_hash !== manifestProjection.artifact.hash ||
    marker.manifest_start_line !== line ||
    marker.manifest_end_line !== line ||
    marker.closure_receipt_hash !== receipt.receiptHash ||
    marker.candidate_hash !== terminal.candidateDigest ||
    marker.gate_evidence_hash !== terminal.gateEvidenceDigest ||
    !sameJson(marker.operating_origin, receipt.operatingOriginCorrelation)
  ) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'The accepted SHIP compatibility projection conflicts with terminal receipt custody.',
    );
  }

  const expectedRunEvidence = buildShipClosureRunEvidence(
    receipt,
    marker,
    markerProjection.body,
  ) as JsonRecord;
  if (
    input.shipRun.manifestHash !== manifestProjection.artifact.hash ||
    !sameJson(runEvidence, expectedRunEvidence)
  ) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'SHIP provenance does not bind the exact receipt-derived compatibility projections.',
    );
  }

  if (input.qa.reportHash !== qaProjection.artifact.hash) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'The accepted QA report conflicts with the terminal SHIP receipt.',
    );
  }
  if (marker.delivery_status === 'succeeded' && marker.qa_gate_status === 'passed') {
    return { deliveryStatus: 'succeeded', qaStatus: 'passed' };
  }
  if (marker.delivery_status === 'blocked' && marker.qa_gate_status === 'failed') {
    return { deliveryStatus: 'blocked', qaStatus: 'failed' };
  }
  fail(
    'E_OPERATE_PLANNING_CUSTODY',
    'The accepted SHIP marker contains an incoherent aggregate delivery status.',
  );
}

function validateRollbackCustody(
  origin: JsonRecord,
  input: DeliveryInput,
  bodiesById: Map<string, string>,
  provenanceEvents: JsonRecord[],
  shipEvent: JsonRecord,
): void {
  const rollback = input.rollback ?? null;
  if ((input.deliveryStatus === 'rolled-back') !== (rollback !== null)) {
    fail('E_OPERATE_PLANNING_CUSTODY', 'Rolled-back delivery requires explicit rollback custody.');
  }
  if (rollback === null) return;
  const artifactBody = (id: unknown, hash: unknown, label: string) => {
    const body = bodiesById.get(String(id));
    if (!body || hashBytes(Buffer.from(body)) !== hash) {
      fail('E_OPERATE_PLANNING_CUSTODY', `${label} does not bind an immutable delivery Artifact.`);
    }
    return parseClosedJson(body, label);
  };
  const plan = artifactBody(
    rollback.rollbackPlanArtifactId,
    rollback.rollbackPlanHash,
    'Rollback plan',
  );
  const result = artifactBody(
    rollback.rollbackResultArtifactId,
    rollback.rollbackResultHash,
    'Rollback result',
  );
  const receipt = artifactBody(
    rollback.rollbackReceiptArtifactId,
    rollback.rollbackReceiptHash,
    'Rollback receipt',
  );
  const rollbackEvents = provenanceEvents.filter(
    (event) =>
      event.operation === 'rolled-back' &&
      event.event_id === rollback.rollbackProvenanceEventId &&
      event.run_id === rollback.rollbackRunId &&
      event.artifact_id === input.specId &&
      sameJson(event.correlation, exactCorrelation(origin)) &&
      (event.producer as JsonRecord)?.runtime === input.shipRun.runtime &&
      (event.producer as JsonRecord)?.version === input.shipRun.packageVersion,
  );
  const exact =
    rollback.status === 'succeeded' &&
    rollback.originalShipRunId === input.shipRun.runId &&
    plan.rollbackPlanId === rollback.rollbackPlanId &&
    plan.originalShipRunId === rollback.originalShipRunId &&
    plan.rollbackRunId === rollback.rollbackRunId &&
    plan.expectedTargetHash === rollback.targetBeforeHash &&
    plan.baselineHash === rollback.targetAfterHash &&
    result.rollbackResultId === rollback.rollbackResultId &&
    result.rollbackPlanId === rollback.rollbackPlanId &&
    result.originalShipRunId === rollback.originalShipRunId &&
    result.rollbackRunId === rollback.rollbackRunId &&
    result.targetBeforeHash === rollback.targetBeforeHash &&
    result.targetAfterHash === rollback.targetAfterHash &&
    result.status === 'succeeded' &&
    result.completedAt === rollback.completedAt &&
    receipt.rollbackReceiptId === rollback.rollbackReceiptId &&
    receipt.rollbackPlanId === rollback.rollbackPlanId &&
    receipt.rollbackResultId === rollback.rollbackResultId &&
    receipt.rollbackRunId === rollback.rollbackRunId &&
    receipt.rollbackResultHash === rollback.rollbackResultHash &&
    receipt.rollbackProvenanceEventId === rollback.rollbackProvenanceEventId &&
    rollbackEvents.length === 1 &&
    provenanceEvents.indexOf(rollbackEvents[0]) > provenanceEvents.indexOf(shipEvent) &&
    Date.parse(String(rollbackEvents[0]?.timestamp)) >= Date.parse(String(shipEvent.timestamp)) &&
    rollbackEvents[0].timestamp === rollback.completedAt &&
    (rollbackEvents[0].producer as JsonRecord)?.product === 'planr-pipeline' &&
    (rollbackEvents[0].producer as JsonRecord)?.phase === 'delivery' &&
    rollbackEvents[0].artifact_path === shipEvent.artifact_path &&
    sameJson(rollbackEvents[0].rollback_evidence, {
      original_ship_run_id: rollback.originalShipRunId,
      rollback_plan_artifact_id: rollback.rollbackPlanArtifactId,
      rollback_plan_hash: rollback.rollbackPlanHash,
      rollback_result_artifact_id: rollback.rollbackResultArtifactId,
      rollback_result_hash: rollback.rollbackResultHash,
      rollback_receipt_artifact_id: rollback.rollbackReceiptArtifactId,
      target_before_hash: rollback.targetBeforeHash,
      target_after_hash: rollback.targetAfterHash,
      completed_at: rollback.completedAt,
    }) &&
    receipt.provenanceEventHash === sha256Jcs(rollbackEvents[0] as never) &&
    receipt.status === 'succeeded';
  if (!exact) {
    fail('E_OPERATE_PLANNING_CUSTODY', 'Rollback plan, result, and receipt correlations diverge.');
  }
}

export function validateShipClosureDeliveryEvidence(
  projectRoot: string,
  specDir: string,
  origin: JsonRecord,
  input: DeliveryInput,
  bodies: Map<string, string>,
  bodiesById: Map<string, string>,
  provenanceEvents: JsonRecord[],
  shipEvent: JsonRecord,
  receiptPath: string,
): void {
  const receiptArtifact = input.artifacts.find((artifact) => artifact.path === receiptPath);
  const body = bodies.get(receiptPath);
  if (
    !receiptArtifact ||
    body === undefined ||
    hashBytes(Buffer.from(body)) !== receiptArtifact.hash
  ) {
    fail('E_OPERATE_PLANNING_CUSTODY', 'Delivery lacks exact SHIP closure receipt custody.');
  }
  const parsedReceipt = parseClosedJson(body, 'SHIP closure receipt');
  let receipt: ShipClosureRecord;
  try {
    receipt = assertShipClosure(parsedReceipt);
  } catch {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'The accepted SHIP closure receipt violates its public or semantic contract.',
    );
  }
  const terminal = receipt.terminal as unknown as JsonRecord;
  const approvedScope = receipt.approvedScope as unknown as JsonRecord;
  const originSpec = origin.spec as JsonRecord;
  const logicalFeatureRoot = path.relative(projectRoot, specDir).replaceAll(path.sep, '/');
  const runEvidence = shipEvent.run_evidence as JsonRecord | undefined;
  if (
    receipt.recordType !== 'receipt' ||
    (receipt.state !== 'passed' && receipt.state !== 'blocked') ||
    terminal?.status !== receipt.state ||
    receipt.runId !== input.shipRun.runId ||
    receipt.runtime !== input.shipRun.runtime ||
    receipt.mode !== 'spec-driven' ||
    receipt.feature !== originSpec.slug ||
    approvedScope?.featureRoot !== logicalFeatureRoot ||
    !sameJson(receipt.operatingOriginCorrelation, exactCorrelation(origin)) ||
    !runEvidence ||
    runEvidence.closure_receipt_hash !== receipt.receiptHash ||
    runEvidence.candidate_hash !== terminal.candidateDigest ||
    runEvidence.gate_evidence_hash !== terminal.gateEvidenceDigest ||
    runEvidence.manifest_hash !== input.shipRun.manifestHash
  ) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'The accepted SHIP closure receipt lost its exact run, candidate, gate, or SPEC binding.',
    );
  }
  const projection = validateShipClosureCompatibilityProjections(
    projectRoot,
    specDir,
    input,
    bodies,
    receipt,
    runEvidence,
  );

  const receiptTasks = receipt.tasks as JsonRecord[];
  const taskIds = input.tasks.map((task) => String(task.taskId));
  const approvedTaskIds = approvedScope.taskIds as unknown[];
  if (
    new Set(taskIds).size !== taskIds.length ||
    JSON.stringify([...taskIds].sort()) !==
      JSON.stringify(receiptTasks.map((task) => String(task.id)).sort()) ||
    JSON.stringify([...taskIds].sort()) !== JSON.stringify(approvedTaskIds.map(String).sort())
  ) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'Delivery tasks must exactly equal the approved terminal SHIP task set.',
    );
  }
  for (const task of input.tasks) {
    const closed = receiptTasks.find((candidate) => candidate.id === task.taskId);
    const expectedStatus =
      closed?.status === 'completed'
        ? 'done'
        : closed?.status === 'pending'
          ? 'skipped'
          : closed?.status;
    if (!closed || task.status !== expectedStatus || task.artifactHash !== receiptArtifact.hash) {
      fail(
        'E_OPERATE_PLANNING_CUSTODY',
        'Delivery task status does not match the immutable SHIP closure receipt.',
      );
    }
  }

  const candidates = receipt.candidateRevisions as JsonRecord[];
  const inventory = (candidates.at(-1)?.inventory ?? []) as JsonRecord[];
  const deliverySurface = (repositoryKey: unknown, value: unknown): string | null => {
    if (typeof repositoryKey !== 'string' || typeof value !== 'string') return null;
    return repositoryKey === 'project' ? value : `${repositoryKey}:${value}`;
  };
  const receiptSurfaces = [
    ...new Set(
      inventory.flatMap((entry) => {
        const surface = deliverySurface(entry.repositoryKey, entry.path);
        const original = deliverySurface(entry.repositoryKey, entry.originalPath);
        return [surface, original].filter((value): value is string => value !== null);
      }),
    ),
  ].sort();
  const declaredSurfaces = [...new Set(input.changedSurfaces)].sort();
  if (
    declaredSurfaces.length !== input.changedSurfaces.length ||
    JSON.stringify(declaredSurfaces) !== JSON.stringify(receiptSurfaces)
  ) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'Delivery surfaces do not match the terminal SHIP candidate inventory.',
    );
  }

  const rank = { public: 0, internal: 1, confidential: 2, restricted: 3 } as const;
  if (
    input.artifacts.some(
      (artifact) =>
        !(artifact.classification in rank) ||
        rank[artifact.classification as keyof typeof rank] > rank[input.classification],
    )
  ) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'Delivery classification cannot narrow any accepted Artifact classification.',
    );
  }
  const certifiedStatus = projection.deliveryStatus;
  const expectedQa = projection.qaStatus;
  const claimedOriginalStatus =
    input.deliveryStatus === 'rolled-back' ? 'succeeded' : input.deliveryStatus;
  if (
    input.planRun.status !== 'succeeded' ||
    input.shipRun.status !== certifiedStatus ||
    claimedOriginalStatus !== certifiedStatus ||
    input.qa.status !== expectedQa
  ) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'Delivery status and QA must be derived from the aggregate SHIP compatibility projection.',
    );
  }
  validateRollbackCustody(origin, input, bodiesById, provenanceEvents, shipEvent);
}

function validateLegacyPipelineEvidence(
  origin: JsonRecord,
  input: DeliveryInput,
  bodies: Map<string, string>,
  bodiesById: Map<string, string>,
  provenanceEvents: JsonRecord[],
  shipEvent: JsonRecord,
): void {
  if (input.planRun.status !== 'succeeded') {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'Delivery requires one successfully completed PLAN receipt.',
    );
  }
  const manifest = bodies.get('.run-manifest.jsonl');
  const manifestArtifact = input.artifacts.find(
    (artifact) => artifact.path === '.run-manifest.jsonl',
  );
  if (
    manifest === undefined ||
    !manifestArtifact ||
    input.shipRun.manifestHash !== manifestArtifact.hash
  ) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'Delivery run references must bind the exact accepted pipeline manifest.',
    );
  }
  let rows: JsonRecord[];
  try {
    rows = manifest
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonRecord);
  } catch {
    fail('E_OPERATE_PLANNING_CUSTODY', 'The accepted pipeline manifest is malformed.');
  }
  const marker = bodies.get('.pipeline-shipped');
  let markerValue: JsonRecord | null = null;
  if (!marker) {
    fail('E_OPERATE_PLANNING_CUSTODY', 'Delivery requires the exact accepted SHIP marker.');
  }
  try {
    markerValue = YAML.parse(marker) as JsonRecord;
  } catch {
    fail('E_OPERATE_PLANNING_CUSTODY', 'The accepted SHIP marker is malformed.');
  }
  if (
    markerValue === null ||
    validatePipelineProtocolArtifact('pipeline-shipped', markerValue).length > 0
  ) {
    fail('E_OPERATE_PLANNING_CUSTODY', 'The accepted SHIP marker violates its public contract.');
  }
  const startLine = Number(markerValue?.manifest_start_line);
  const endLine = Number(markerValue?.manifest_end_line);
  let latestBootstrapIndex = -1;
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index]?.stage === 'ship.bootstrap') latestBootstrapIndex = index;
  }
  const expectedStartLine = latestBootstrapIndex === -1 ? 1 : latestBootstrapIndex + 1;
  if (
    markerValue?.run_id !== input.shipRun.runId ||
    markerValue?.manifest_hash !== manifestArtifact.hash ||
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine !== expectedStartLine ||
    endLine < startLine ||
    endLine !== rows.length
  ) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'SHIP marker does not certify one exact manifest run slice.',
    );
  }
  rows = rows.slice(startLine - 1, endLine);
  const surfaces = new Set<string>();
  const taskRows = new Map<string, JsonRecord[]>();
  for (const row of rows) {
    if (validatePipelineProtocolArtifact('run-manifest', row).length > 0) {
      fail(
        'E_OPERATE_PLANNING_CUSTODY',
        'The accepted pipeline manifest row violates its public contract.',
      );
    }
    const deliveryTask = typeof row.stage === 'string' && row.stage.startsWith('ship.task:');
    if (
      (deliveryTask && !sameJson(row.operating_origin, exactCorrelation(origin))) ||
      (row.operating_origin !== undefined &&
        !sameJson(row.operating_origin, exactCorrelation(origin)))
    ) {
      fail('E_OPERATE_PLANNING_CUSTODY', 'Delivery manifest lost its parent operating origin.');
    }
    if (deliveryTask) {
      const taskId = String(row.stage).slice('ship.task:'.length);
      const history = taskRows.get(taskId) ?? [];
      history.push(row);
      taskRows.set(taskId, history);
    }
    for (const field of ['files_written', 'files_modified'] as const) {
      if (!Array.isArray(row[field])) {
        fail('E_OPERATE_PLANNING_CUSTODY', 'The accepted pipeline manifest is incomplete.');
      }
      for (const surface of row[field] as unknown[]) {
        if (typeof surface !== 'string') {
          fail('E_OPERATE_PLANNING_CUSTODY', 'The accepted pipeline manifest is malformed.');
        }
        surfaces.add(surface);
      }
    }
  }
  const taskIds = input.tasks.map((task) => String(task.taskId));
  if (
    new Set(taskIds).size !== taskIds.length ||
    JSON.stringify([...taskIds].sort()) !== JSON.stringify([...taskRows.keys()].sort())
  ) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'Delivery tasks must exactly equal the complete unique SHIP manifest task set.',
    );
  }
  const declaredSurfaces = [...new Set(input.changedSurfaces)].sort();
  if (
    declaredSurfaces.length !== input.changedSurfaces.length ||
    JSON.stringify(declaredSurfaces) !== JSON.stringify([...surfaces].sort())
  ) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'Delivery surfaces do not match the exact accepted pipeline manifest.',
    );
  }
  for (const task of input.tasks) {
    const history = taskRows.get(String(task.taskId));
    const row = history?.at(-1);
    const expectedExit =
      task.status === 'done' ? 'success' : task.status === 'skipped' ? 'skipped' : 'failure';
    if (row?.exit_status !== expectedExit || task.artifactHash !== manifestArtifact.hash) {
      fail(
        'E_OPERATE_PLANNING_CUSTODY',
        'Delivery task status does not match its manifest record.',
      );
    }
  }
  const rank = { public: 0, internal: 1, confidential: 2, restricted: 3 } as const;
  if (
    input.artifacts.some(
      (artifact) =>
        !(artifact.classification in rank) ||
        rank[artifact.classification as keyof typeof rank] > rank[input.classification],
    )
  ) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'Delivery classification cannot narrow any accepted Artifact classification.',
    );
  }
  const qaReport = input.artifacts.find((artifact) => artifact.path === 'qa-report.md');
  if (
    (input.qa.reportHash === null && qaReport) ||
    (input.qa.reportHash !== null && (!qaReport || qaReport.hash !== input.qa.reportHash))
  ) {
    fail('E_OPERATE_PLANNING_CUSTODY', 'Delivery QA does not bind its exact accepted report.');
  }
  const markerArtifact = input.artifacts.find((artifact) => artifact.path === '.pipeline-shipped');
  const runEvidence = shipEvent.run_evidence as JsonRecord | undefined;
  const finalAttempts = [...taskRows.values()].map((history) => history.at(-1));
  const finalFailures = finalAttempts.filter((row) => row?.exit_status === 'failure').length;
  const finalExecuted = finalAttempts.filter((row) => row?.exit_status !== 'skipped').length;
  if (
    !markerArtifact ||
    !runEvidence ||
    runEvidence.manifest_hash !== manifestArtifact.hash ||
    runEvidence.manifest_start_line !== startLine ||
    runEvidence.manifest_end_line !== endLine ||
    runEvidence.marker_hash !== markerArtifact.hash ||
    markerValue.runtime !== input.shipRun.runtime ||
    markerValue.pipeline_version !== input.shipRun.packageVersion ||
    markerValue.tasks_executed !== finalExecuted ||
    markerValue.tasks_failed !== finalFailures ||
    markerValue.qa_gate_status !== input.qa.status ||
    markerValue.delivery_status !==
      (input.deliveryStatus === 'rolled-back' ? 'succeeded' : input.deliveryStatus) ||
    input.shipRun.status !== markerValue.delivery_status ||
    !sameJson(markerValue.operating_origin, exactCorrelation(origin))
  ) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'The accepted SHIP marker lost its exact run or origin binding.',
    );
  }
  if (input.deliveryStatus === 'succeeded') {
    if (
      input.planRun.status !== 'succeeded' ||
      input.shipRun.status !== 'succeeded' ||
      input.qa.status !== 'passed' ||
      !marker ||
      markerValue?.qa_gate_status !== input.qa.status
    ) {
      fail(
        'E_OPERATE_PLANNING_CUSTODY',
        'Successful delivery requires the exact accepted SHIP marker and run status.',
      );
    }
  } else if (
    (input.deliveryStatus === 'blocked' || input.deliveryStatus === 'failed') &&
    input.shipRun.status !== input.deliveryStatus
  ) {
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'Non-success delivery status must match the exact accepted SHIP run status.',
    );
  }
  if (input.deliveryStatus === 'rolled-back') {
    if (input.shipRun.status !== 'succeeded' || input.qa.status !== 'passed' || !marker) {
      fail(
        'E_OPERATE_PLANNING_CUSTODY',
        'Rolled-back delivery requires one certified successful original SHIP run.',
      );
    }
  }
  validateRollbackCustody(origin, input, bodiesById, provenanceEvents, shipEvent);
}

function validatePipelineEvidence(
  projectRoot: string,
  specDir: string,
  origin: JsonRecord,
  input: DeliveryInput,
  bodies: Map<string, string>,
  bodiesById: Map<string, string>,
  provenanceEvents: JsonRecord[],
  shipEvent: JsonRecord,
  receiptPath: string | null,
): void {
  if (receiptPath !== null) {
    validateShipClosureDeliveryEvidence(
      projectRoot,
      specDir,
      origin,
      input,
      bodies,
      bodiesById,
      provenanceEvents,
      shipEvent,
      receiptPath,
    );
    return;
  }
  validateLegacyPipelineEvidence(origin, input, bodies, bodiesById, provenanceEvents, shipEvent);
}

export async function ingestPlanningDeliveryEvidence(input: {
  projectDir: string;
  runtime: OperateStoredRuntime;
  composition: OperateComposition;
  evidence: DeliveryInput;
}): Promise<JsonRecord & { runtime: OperateStoredRuntime }> {
  const root = input.projectDir;
  const specDir = await exactSpecDirectory(root, input.evidence.specId);
  const origin = await readSpecOperatingOrigin(specDir);
  if ((origin.spec as JsonRecord).specId !== input.evidence.specId) {
    fail(
      'E_OPERATE_ORIGIN_INVALID',
      'Delivery evidence SPEC identity differs from its closed origin.',
    );
  }
  const custody = await validateArtifactCustody(specDir, input.evidence);
  const runReceipts = await validateRunReceipts(root, specDir, origin, input.evidence);
  const runEvidence = runReceipts.shipEvent.run_evidence as JsonRecord | undefined;
  const receiptPath = await requireCurrentReceiptCustody(
    specDir,
    input.evidence.shipRun.runId,
    custody.bodies,
    typeof runEvidence?.closure_receipt_hash === 'string',
  );
  validatePipelineEvidence(
    root,
    specDir,
    origin,
    input.evidence,
    custody.bodies,
    custody.bodiesById,
    runReceipts.events,
    runReceipts.shipEvent,
    receiptPath,
  );
  const deliveryEvidence = buildOperatingDeliveryEvidenceV1({
    origin: origin as never,
    planRun: input.evidence.planRun as never,
    shipRun: input.evidence.shipRun as never,
    tasks: input.evidence.tasks as never,
    changedSurfaces: input.evidence.changedSurfaces,
    qa: input.evidence.qa as never,
    limitations: input.evidence.limitations ?? [],
    artifacts: custody.artifacts as never,
    classification: input.evidence.classification,
    summary: input.evidence.summary,
    deliveryStatus: input.evidence.deliveryStatus,
    rollback: (input.evidence.rollback ?? null) as never,
    createdAt: input.evidence.createdAt,
  }) as unknown as JsonRecord;
  const verification = origin.verification as JsonRecord;
  const sourceEvents = input.runtime.events.filter(
    (event) =>
      event.type === 'verification.plan-recorded' &&
      event.entityId === verification.verificationPlanId,
  );
  if (sourceEvents.length !== 1)
    fail(
      'E_OPERATE_PLANNING_CUSTODY',
      'Delivery evidence lacks one exact original verification-plan Event.',
    );
  const eventId = `evt_${sha256Jcs({ contract: 'planning-delivery-ingestion', deliveryEvidenceId: deliveryEvidence.deliveryEvidenceId } as never).slice(7, 39)}`;
  const result = input.composition.ingestPlanningDelivery(
    {
      origin,
      deliveryEvidence,
      verificationPlanEvent: sourceEvents[0],
      expectedEventHead: input.runtime.state.eventHead,
    },
    {
      eventId,
      timestamp: input.evidence.createdAt,
      correlationId: String(origin.correlationId),
    },
    input.runtime.state,
    input.runtime.artifacts,
  ) as JsonRecord;
  return {
    ...result,
    runtime: {
      ...input.runtime,
      state: result.state as JsonRecord,
      events: [...input.runtime.events, ...((result.events as JsonRecord[]) ?? [])],
    },
  };
}
