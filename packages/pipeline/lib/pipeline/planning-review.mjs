import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

import { sha256Jcs } from '../protocol/jcs.mjs';
import { PipelineError } from './errors.mjs';
import { capturePlanningIdentity } from './planning-review-identity.mjs';
import {
  assertPlanningReview,
  createPlanningReview,
  planningReviewerRoster,
  reducePlanningReview,
  validatePlanningReviewEvent,
} from './planning-review-reducer.mjs';
import {
  assertPathCustody,
  assertRegularCustodyFile,
  atomicWrite,
  withLock,
} from './ship-closure-persistence.mjs';

const OWNER_DECISION_CAPABILITIES = new WeakMap();

function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}

function paths(featureRoot, projectRoot) {
  const root = join(featureRoot, '.plan-review');
  return {
    custodyRoot: projectRoot,
    featureRoot,
    root,
    activeDir: join(root, 'active'),
    receiptDir: join(root, 'receipts'),
    lockDir: join(root, 'locks'),
    featureLock: join(root, 'locks', 'feature.lock'),
  };
}

function ensureDirectory(path) {
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('E_PLAN_REVIEW_STORAGE_UNSAFE', 'Planning review custody contains an unsafe filesystem node.');
    return;
  }
  mkdirSync(path, { recursive: false, mode: 0o700 });
}

function ensureDirs(value) {
  assertPathCustody(value.custodyRoot, value.featureRoot, { expectedKind: 'directory' });
  ensureDirectory(value.root);
  ensureDirectory(value.activeDir);
  ensureDirectory(value.receiptDir);
  ensureDirectory(value.lockDir);
}

function activePath(value, runId) {
  return join(value.activeDir, `${runId}.json`);
}

function receiptPath(value, receiptHash) {
  if (!/^sha256:[a-f0-9]{64}$/.test(receiptHash ?? '')) fail('E_PLAN_REVIEW_RECEIPT_HASH_INVALID', 'Planning review receipt hash must be exact SHA-256 custody.');
  return join(value.receiptDir, `${receiptHash.slice(7)}.json`);
}

function readRecord(path, expectedType = undefined) {
  assertRegularCustodyFile(path);
  let value;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { fail('E_PLAN_REVIEW_STORAGE_INVALID', 'Planning review custody contains invalid JSON.'); }
  assertPlanningReview(value);
  if (expectedType && value.recordType !== expectedType) fail('E_PLAN_REVIEW_STORAGE_INVALID', `Expected ${expectedType} planning review custody.`);
  return value;
}

function receiptFiles(value) {
  if (!existsSync(value.receiptDir)) return [];
  return readdirSync(value.receiptDir).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).sort();
}

function receipts(value) {
  return receiptFiles(value).map((name) => {
    const record = readRecord(join(value.receiptDir, name), 'receipt');
    if (`${record.receiptHash.slice(7)}.json` !== name) fail('E_PLAN_REVIEW_STORAGE_INVALID', 'Planning review receipt filename does not match its immutable content hash.');
    return record;
  });
}

function activeFiles(value) {
  if (!existsSync(value.activeDir)) return [];
  return readdirSync(value.activeDir).filter((name) => /^prr_[a-f0-9]{32}\.json$/.test(name)).sort();
}

function writeJson(path, value) {
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeReceipt(path, receipt) {
  const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
  if (existsSync(path)) {
    assertRegularCustodyFile(path);
    if (readFileSync(path, 'utf8') !== bytes) fail('E_PLAN_REVIEW_RECEIPT_IMMUTABLE', 'Content-addressed planning review receipt already exists with divergent bytes.');
    return;
  }
  atomicWrite(path, bytes);
}

function summary(record, { replayed = false } = {}) {
  return {
    ok: true,
    runId: record.runId,
    generation: record.generation,
    state: record.state,
    recordType: record.recordType,
    feature: structuredClone(record.feature),
    planDigest: record.candidateRevisions.at(-1).planDigest,
    professionalSpecificationDigest: record.candidateRevisions.at(-1).professionalSpecificationDigest,
    candidateRevision: record.candidateRevisions.at(-1).revision,
    reviewerRoster: structuredClone(record.reviewerRoster),
    rosterDigest: record.rosterDigest,
    latestFindings: structuredClone(record.reviews.at(-1)?.findings ?? []),
    reviewOutcome: record.reviewOutcome,
    ownerDecision: structuredClone(record.ownerDecision),
    terminal: structuredClone(record.terminal),
    receiptHash: record.receiptHash,
    replayed,
  };
}

export function issuePlanningReviewOwnerDecisionCapability({
  runId,
  expectedGeneration,
  ownerId,
  decision,
  reason,
  candidateRevision,
  planDigest,
} = {}) {
  if (!/^prr_[a-f0-9]{32}$/.test(runId ?? '')) fail('E_PLAN_REVIEW_OWNER_AUTHORITY_INVALID', 'Owner decision capability requires one exact planning-review run ID.');
  const event = validatePlanningReviewEvent({
    type: 'owner.decided', expectedGeneration, ownerId, decision, reason, candidateRevision, planDigest,
  });
  const descriptor = {
    kind: 'planning-review-owner-capability',
    schemaVersion: '1.0.0',
    runId,
    expectedGeneration,
    candidateRevision,
    planDigest,
    ownerId,
    decision,
    decisionDigest: sha256Jcs(event),
  };
  const capability = Object.freeze({ ...descriptor, capabilityDigest: sha256Jcs(descriptor) });
  OWNER_DECISION_CAPABILITIES.set(capability, { event, consumed: false });
  return capability;
}

function ownerDecisionCapability(value) {
  const binding = value && typeof value === 'object' ? OWNER_DECISION_CAPABILITIES.get(value) : undefined;
  if (!binding) {
    fail(
      'E_PLAN_REVIEW_OWNER_AUTHORITY_REQUIRED',
      'Planning-review disposition requires an engine-issued interactive owner capability.',
      'Use the owner-facing decide-plan-review command; owner decisions are not accepted through advance event files.',
    );
  }
  return binding;
}

export function preparePlanningReview({ projectRoot, featureRoot, mode, slug } = {}) {
  const plan = capturePlanningIdentity({ featureRoot, mode, slug });
  const value = paths(featureRoot, projectRoot);
  const result = {
    ok: true,
    phase: 'plan-review.prepared',
    mode,
    slug,
    featureId: plan.feature.featureId,
    planDigest: plan.planDigest,
    professionalSpecificationDigest: plan.professionalSpecification.digest,
    reviewerRoster: planningReviewerRoster(plan.professionalSpecification.declaredSpecialists),
    activeRunIds: existsSync(value.activeDir) ? activeFiles(value).map((name) => name.slice(0, -5)) : [],
    terminal: existsSync(value.receiptDir) ? receipts(value).map((record) => summary(record)) : [],
  };
  Object.defineProperties(result, {
    projectRoot: { value: projectRoot, enumerable: false },
    featureRoot: { value: featureRoot, enumerable: false },
    plan: { value: plan, enumerable: false },
  });
  return result;
}

export function prepareStoredPlanningReviewOwnerDecision({ prepared, runId } = {}) {
  const value = paths(prepared.featureRoot, prepared.projectRoot);
  const loaded = load(value, runId);
  const record = loaded.record;
  if (record.recordType === 'receipt') return { ...summary(record, { replayed: true }), allowedDecisions: [] };
  if (!['awaiting_owner', 'correction_required'].includes(record.state)) {
    fail('E_PLAN_REVIEW_TRANSITION_INVALID', 'Owner decision is unavailable until the consolidated review reaches an owner disposition boundary.');
  }
  const allowedDecisions = record.state === 'awaiting_owner' && record.reviewOutcome === 'pass-candidate'
    ? ['approved', 'blocked']
    : ['blocked'];
  return { ...summary(record), allowedDecisions };
}

export function startStoredPlanningReview({ prepared, runtime = 'unknown', runId = `prr_${randomUUID().replaceAll('-', '')}`, now = new Date().toISOString() } = {}) {
  if (!/^prr_[a-f0-9]{32}$/.test(runId)) fail('E_PLAN_REVIEW_RUN_ID_INVALID', 'Planning review runId must use prr_<32 lowercase hex>.');
  if (!['claude-code', 'codex', 'cursor', 'unknown'].includes(runtime)) fail('E_RUNTIME_INVALID', `Unsupported planning review runtime ${runtime}.`);
  const value = paths(prepared.featureRoot, prepared.projectRoot);
  ensureDirs(value);
  const roster = planningReviewerRoster(prepared.plan.professionalSpecification.declaredSpecialists);
  const requested = createPlanningReview({ runId, feature: prepared.plan.feature, plan: prepared.plan, reviewerRoster: roster, runtime, now });
  return withLock(value.featureLock, () => {
    const exactReceipt = receipts(value).find(({ candidateRevisions }) => candidateRevisions.at(-1).planDigest === prepared.plan.planDigest);
    if (exactReceipt) return summary(exactReceipt, { replayed: true });
    const target = activePath(value, runId);
    if (existsSync(target)) {
      const prior = readRecord(target, 'active');
      const identity = (record) => ({ feature: record.feature, runtime: record.runtime, reviewerRoster: record.reviewerRoster, candidateRevisions: record.candidateRevisions });
      if (sha256Jcs(identity(prior)) === sha256Jcs(identity(requested))) return summary(prior, { replayed: true });
      fail('E_PLAN_REVIEW_RUN_ID_CONFLICT', `Planning review run ${runId} already exists with different custody.`);
    }
    const other = activeFiles(value);
    if (other.length) fail('E_PLAN_REVIEW_ACTIVE', `Feature already has active planning review ${other[0].slice(0, -5)}.`);
    writeJson(target, requested);
    return summary(requested);
  });
}

function load(value, runId) {
  const active = activePath(value, runId);
  if (existsSync(active)) return { record: readRecord(active, 'active'), active };
  const receipt = receipts(value).find((entry) => entry.runId === runId);
  if (receipt) return { record: receipt, active: null, receipt: receiptPath(value, receipt.receiptHash) };
  fail('E_PLAN_REVIEW_RUN_NOT_FOUND', `Planning review run ${runId} was not found.`);
}

export function advanceStoredPlanningReview({ prepared, runId, event, now = new Date().toISOString() } = {}) {
  const value = paths(prepared.featureRoot, prepared.projectRoot);
  const normalized = validatePlanningReviewEvent(event);
  if (normalized.type === 'owner.decided') {
    fail(
      'E_PLAN_REVIEW_OWNER_BOUNDARY_REQUIRED',
      'owner.decided is not accepted through the general planning-review event boundary.',
      'Use the owner-facing decide-plan-review command with an interactive confirmation.',
    );
  }
  ensureDirs(value);
  const inputDigest = sha256Jcs(normalized);
  return withLock(value.featureLock, () => {
    const loaded = load(value, runId);
    const prior = loaded.record.events.find(({ eventId }) => eventId === normalized.eventId);
    if (prior) {
      if (prior.inputDigest !== inputDigest) fail('E_PLAN_REVIEW_EVENT_REPLAY_DIVERGED', `Event ${normalized.eventId} replayed with divergent bytes.`);
      return summary(loaded.record, { replayed: true });
    }
    if (loaded.record.recordType === 'receipt') fail('E_PLAN_REVIEW_TERMINAL', 'Terminal planning review receipts are immutable.');
    const next = reducePlanningReview(loaded.record, normalized, {
      now,
      inputDigest,
      ...(normalized.type === 'correction.registered' ? { candidate: prepared.plan } : {}),
    });
    if (next.recordType === 'receipt') {
      const destination = receiptPath(value, next.receiptHash);
      writeReceipt(destination, next);
      try { unlinkSync(loaded.active); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    } else writeJson(loaded.active, next);
    return summary(next);
  });
}

export function decideStoredPlanningReview({ prepared, runId, capability, now = new Date().toISOString() } = {}) {
  const binding = ownerDecisionCapability(capability);
  if (capability.runId !== runId) fail('E_PLAN_REVIEW_OWNER_AUTHORITY_FOREIGN', 'Owner decision capability belongs to a different planning-review run.');
  const value = paths(prepared.featureRoot, prepared.projectRoot);
  ensureDirs(value);
  return withLock(value.featureLock, () => {
    const loaded = load(value, runId);
    const inputDigest = sha256Jcs(binding.event);
    if (loaded.record.recordType === 'receipt') {
      const decision = loaded.record.ownerDecision;
      const exact = decision?.ownerId === binding.event.ownerId
        && decision?.decision === binding.event.decision
        && decision?.reason === binding.event.reason
        && decision?.candidateRevision === binding.event.candidateRevision
        && decision?.planDigest === binding.event.planDigest
        && loaded.record.events.some(({ eventId, inputDigest: digest }) => eventId === binding.event.eventId && digest === inputDigest);
      if (!exact) fail('E_PLAN_REVIEW_OWNER_AUTHORITY_FOREIGN', 'Owner decision capability does not match the immutable terminal receipt.');
      return summary(loaded.record, { replayed: true });
    }
    if (binding.consumed) fail('E_PLAN_REVIEW_OWNER_AUTHORITY_REPLAYED', 'Owner decision capability was already consumed by a different terminal result.');
    const candidate = loaded.record.candidateRevisions.at(-1);
    if (binding.event.expectedGeneration !== loaded.record.generation
      || binding.event.candidateRevision !== candidate.revision
      || binding.event.planDigest !== candidate.planDigest) {
      fail('E_PLAN_REVIEW_OWNER_AUTHORITY_FOREIGN', 'Owner decision capability does not bind the current generation and exact plan candidate.');
    }
    const next = reducePlanningReview(loaded.record, binding.event, { now, inputDigest });
    const destination = receiptPath(value, next.receiptHash);
    writeReceipt(destination, next);
    try { unlinkSync(loaded.active); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    binding.consumed = true;
    return summary(next);
  });
}

export function readPlanningReviewReceipt({ prepared, receiptHash, requirePassed = true } = {}) {
  const value = paths(prepared.featureRoot, prepared.projectRoot);
  if (!existsSync(value.receiptDir)) fail('E_PLAN_REVIEW_RECEIPT_NOT_FOUND', 'No planning review receipt custody exists for this feature.');
  const path = receiptPath(value, receiptHash);
  if (!existsSync(path)) fail('E_PLAN_REVIEW_RECEIPT_NOT_FOUND', `No planning review receipt matches ${receiptHash}.`);
  const receipt = readRecord(path, 'receipt');
  if (receipt.receiptHash !== receiptHash) fail('E_PLAN_REVIEW_RECEIPT_INVALID', 'Planning review receipt hash and file custody disagree.');
  if (requirePassed && receipt.state !== 'passed') fail('E_PLAN_REVIEW_NOT_APPROVED', 'SHIP requires a terminal PASS planning review receipt.');
  if (receipt.feature.mode !== prepared.mode || receipt.feature.slug !== prepared.slug || receipt.candidateRevisions.at(-1).planDigest !== prepared.plan.planDigest) {
    fail('E_PLAN_REVIEW_STALE', 'Planning review receipt does not match the exact current specification and task graph.');
  }
  return receipt;
}
