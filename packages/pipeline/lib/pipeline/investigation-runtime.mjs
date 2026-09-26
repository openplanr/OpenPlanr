import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { sha256Jcs } from '../protocol/jcs.mjs';
import { PipelineError } from './errors.mjs';
import {
  assertInvestigationApproval,
  assertInvestigationAuthority,
  assertInvestigationCommand,
  assertInvestigationRequest,
  investigationArtifactId,
  investigationEventIdentity,
} from './investigation-contracts.mjs';
import {
  captureInvestigationBaseline,
  diffInvestigationBaselines,
  scopeContains,
} from './investigation-identity.mjs';
import {
  assertInvestigationRecord,
  createInvestigationRecord,
  finalizeInvestigationRecord,
  reduceInvestigationRecord,
} from './investigation-reducer.mjs';
import {
  assertPathCustody,
  assertRegularCustodyFile,
  atomicWrite,
  withLock,
} from './ship-closure-persistence.mjs';

const MAX_OUTPUT_BYTES = 1_048_576;
const READ_ONLY_COMMAND_HOSTS = new WeakMap();
const FIX_AUTHORIZATION_PREVIEWS = new WeakMap();
const FIX_START_CAPABILITIES = new WeakMap();
const READ_ONLY_CAPABILITY = Object.freeze({
  filesystem: 'read-only',
  network: 'denied',
  processEffects: 'denied',
  scope: 'declared-inputs-only',
});
function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}
function digestBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
function clone(value) {
  return structuredClone(value);
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function paths(projectRoot, featureRoot) {
  const root = join(featureRoot, '.investigation');
  return {
    projectRoot,
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
    if (stat.isSymbolicLink() || !stat.isDirectory())
      fail(
        'E_INVESTIGATION_STORAGE_UNSAFE',
        'Investigation custody contains an unsafe filesystem node.',
      );
    return;
  }
  mkdirSync(path, { mode: 0o700 });
}

function ensureDirs(value) {
  try {
    assertPathCustody(value.projectRoot, value.featureRoot, { expectedKind: 'directory' });
  } catch {
    fail(
      'E_INVESTIGATION_STORAGE_UNSAFE',
      'Investigation feature custody escapes the trusted project root.',
    );
  }
  ensureDirectory(value.root);
  ensureDirectory(value.activeDir);
  ensureDirectory(value.receiptDir);
  ensureDirectory(value.lockDir);
}

function activePath(value, runId) {
  return join(value.activeDir, `${runId}.json`);
}
function receiptPath(value, receiptHash) {
  if (!/^sha256:[a-f0-9]{64}$/.test(receiptHash ?? ''))
    fail(
      'E_INVESTIGATION_RECEIPT_HASH_INVALID',
      'Investigation receipt hash must use exact SHA-256 custody.',
    );
  return join(value.receiptDir, `${receiptHash.slice(7)}.json`);
}
function writeJson(path, value) {
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}
function readRecord(path, type = undefined) {
  try {
    assertRegularCustodyFile(path);
  } catch {
    fail('E_INVESTIGATION_STORAGE_UNSAFE', 'Investigation custody is not one regular file.');
  }
  let record;
  try {
    record = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail('E_INVESTIGATION_STORAGE_INVALID', 'Investigation custody contains invalid JSON.');
  }
  assertInvestigationRecord(record);
  if (type && record.recordType !== type)
    fail('E_INVESTIGATION_STORAGE_INVALID', `Expected ${type} investigation custody.`);
  return record;
}
function receiptFiles(value) {
  return existsSync(value.receiptDir)
    ? readdirSync(value.receiptDir)
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .sort()
    : [];
}
function receipts(value) {
  return receiptFiles(value).map((name) => {
    const record = readRecord(join(value.receiptDir, name), 'receipt');
    if (`${record.receiptHash.slice(7)}.json` !== name)
      fail(
        'E_INVESTIGATION_STORAGE_INVALID',
        'Investigation receipt filename and content hash disagree.',
      );
    return record;
  });
}
function activeFiles(value) {
  return existsSync(value.activeDir)
    ? readdirSync(value.activeDir)
        .filter((name) => /^inv_[a-f0-9]{32}\.json$/.test(name))
        .sort()
    : [];
}
function load(value, runId) {
  const active = activePath(value, runId);
  if (existsSync(active)) return { record: readRecord(active, 'active'), active };
  const receipt = receipts(value).find((entry) => entry.runId === runId);
  if (receipt) return { record: receipt, active: null };
  fail('E_INVESTIGATION_RUN_NOT_FOUND', `Investigation run ${runId} was not found.`);
}
function writeReceipt(value, receipt) {
  const target = receiptPath(value, receipt.receiptHash);
  const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
  if (existsSync(target)) {
    try {
      assertRegularCustodyFile(target);
    } catch {
      fail('E_INVESTIGATION_STORAGE_UNSAFE', 'Investigation receipt custody is unsafe.');
    }
    if (readFileSync(target, 'utf8') !== bytes)
      fail(
        'E_INVESTIGATION_RECEIPT_IMMUTABLE',
        'Content-addressed investigation receipt already exists with divergent bytes.',
      );
  } else atomicWrite(target, bytes);
  return target;
}

function summary(record, { replayed = false } = {}) {
  return {
    ok: true,
    operation: `investigation.${record.recordType === 'receipt' ? 'terminal' : record.state}`,
    runId: record.runId,
    mode: record.mode,
    generation: record.generation,
    state: record.state,
    recordType: record.recordType,
    requestDigest: record.requestDigest,
    baselineDigest: record.currentBaselineDigest,
    diagnosisDigest: record.diagnosis?.diagnosisDigest ?? null,
    reproduction: clone(record.reproduction),
    observations: clone(record.observations),
    hypotheses: clone(record.hypotheses),
    experiments: clone(record.experiments),
    diagnosis: clone(record.diagnosis),
    changedPaths: clone(record.change?.changedPaths ?? []),
    verification: record.verification
      ? {
          regression: {
            commandId: record.verification.regression.commandId,
            evidenceDigest: record.verification.regression.evidenceDigest,
            matchedExpectation: record.verification.regression.matchedExpectation,
          },
          relevantSuite: {
            commandId: record.verification.relevantSuite.commandId,
            evidenceDigest: record.verification.relevantSuite.evidenceDigest,
            matchedExpectation: record.verification.relevantSuite.matchedExpectation,
          },
        }
      : null,
    receiptHash: record.receiptHash,
    replayed,
  };
}

export function createInvestigationReadOnlyCommandHost(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['execute']) ||
    typeof value.execute !== 'function'
  ) {
    fail(
      'E_INVESTIGATION_COMMAND_HOST_INVALID',
      'Investigation command host must provide exactly one trusted execute function.',
    );
  }
  const host = Object.freeze({
    kind: 'investigation-command-host',
    schemaVersion: '1.0.0',
    capability: READ_ONLY_CAPABILITY,
  });
  READ_ONLY_COMMAND_HOSTS.set(host, value.execute);
  return host;
}

function commandHostExecutor(commandHost) {
  const execute =
    commandHost && typeof commandHost === 'object'
      ? READ_ONLY_COMMAND_HOSTS.get(commandHost)
      : undefined;
  if (typeof execute !== 'function') {
    fail(
      'E_INVESTIGATION_COMMAND_HOST_REQUIRED',
      'Investigation commands require an engine-issued read-only host confinement capability.',
      'Run this operation through a host adapter that provides filesystem read-only, network-denied, process-effect-denied confinement.',
    );
  }
  return execute;
}

function assertCommandInputs(command, targetScope) {
  for (const path of command.inputPaths) {
    if (!scopeContains(targetScope, { repositoryKey: command.repositoryKey, path })) {
      fail(
        'E_INVESTIGATION_SCOPE_VIOLATION',
        `Command ${command.id} declares an input outside the investigation target scope.`,
      );
    }
  }
}

function executionEvidence(command, { repositoryRoots, commandHost, targetScope, clock }) {
  assertInvestigationCommand(command);
  const execute = commandHostExecutor(commandHost);
  if (command.effect !== 'read-only') {
    fail(
      'E_INVESTIGATION_COMMAND_EFFECT_UNAVAILABLE',
      `The read-only investigation host cannot execute ${command.effect} command ${command.id}.`,
    );
  }
  assertCommandInputs(command, targetScope);
  const cwd = repositoryRoots?.[command.repositoryKey];
  if (typeof cwd !== 'string')
    fail('E_INVESTIGATION_SCOPE_INVALID', `Command ${command.id} has no trusted repository root.`);
  const startedAt = clock();
  let result;
  try {
    result = execute(clone(command), {
      cwd,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      timeoutMs: 30_000,
      targetScope: clone(targetScope),
    });
  } catch {
    result = {
      exitCode: null,
      stdoutBytes: Buffer.alloc(0),
      stderrBytes: Buffer.alloc(0),
      unavailable: true,
    };
  }
  const stdout = Buffer.isBuffer(result?.stdoutBytes)
    ? result.stdoutBytes
    : Buffer.from(String(result?.stdoutBytes ?? ''));
  const stderr = Buffer.isBuffer(result?.stderrBytes)
    ? result.stderrBytes
    : Buffer.from(String(result?.stderrBytes ?? ''));
  const outputBytes = stdout.length + stderr.length;
  const truncated = outputBytes > MAX_OUTPUT_BYTES;
  const exitCode = Number.isSafeInteger(result?.exitCode) ? result.exitCode : null;
  const status = result?.unavailable ? 'unavailable' : truncated ? 'output-limit' : 'completed';
  const evidence = {
    commandId: command.id,
    commandDigest: sha256Jcs(command),
    startedAt,
    completedAt: clock(),
    status,
    exitCode,
    matchedExpectation: status === 'completed' && command.expectedExitCodes.includes(exitCode),
    outputBytes,
    outputDigest: sha256Jcs({ stdout: digestBytes(stdout), stderr: digestBytes(stderr) }),
    truncated,
    evidenceDigest: null,
  };
  evidence.evidenceDigest = sha256Jcs(evidence);
  return evidence;
}

function baseline(captureBaseline, repositoryRoots, scope) {
  return captureBaseline({ repositoryRoots, scope });
}
function assertUnchanged(before, after, code = 'E_INVESTIGATION_DIAGNOSIS_DRIFT') {
  if (before.digest !== after.digest)
    fail(code, 'A read-only investigation operation changed target bytes.');
}
function clockFrom(clock) {
  return typeof clock === 'function' ? clock : () => new Date().toISOString();
}

function validateFixRequestContext({
  projectRoot,
  featureRoot,
  repositoryRoots,
  request,
  now,
  captureBaseline,
} = {}) {
  assertInvestigationAuthority(request.authority);
  const diagnosisReceipt = readInvestigationReceipt({
    projectRoot,
    featureRoot,
    receiptHash: request.diagnosisReceiptHash,
  });
  if (diagnosisReceipt.mode !== 'diagnose' || diagnosisReceipt.state !== 'proven') {
    fail(
      'E_INVESTIGATION_CAUSE_UNPROVEN',
      'Fix mode requires one terminal proven diagnosis receipt.',
    );
  }
  if (
    request.authority.expiresAt !== null &&
    Date.parse(request.authority.expiresAt) <= Date.parse(now)
  ) {
    fail('E_INVESTIGATION_AUTHORITY_EXPIRED', 'Fix authority has expired.');
  }
  if (!same(request.authority.scope, diagnosisReceipt.diagnosis.affectedScope)) {
    fail(
      'E_INVESTIGATION_AUTHORITY_FOREIGN',
      'Fix authority scope must equal the proven affected scope.',
    );
  }
  if (request.authority.targetBaselineDigest !== diagnosisReceipt.terminal.finalBaselineDigest) {
    fail('E_INVESTIGATION_BASELINE_CHANGED', 'Fix authority does not bind the diagnosis baseline.');
  }
  if (sha256Jcs(request.regression) !== sha256Jcs(diagnosisReceipt.diagnosis.proposedRegression)) {
    fail('E_INVESTIGATION_WRONG_DIAGNOSIS', 'Fix regression does not match the proven diagnosis.');
  }
  const initial = baseline(captureBaseline, repositoryRoots, request.authority.scope);
  if (initial.digest !== request.authority.targetBaselineDigest) {
    fail(
      'E_INVESTIGATION_BASELINE_CHANGED',
      'Target bytes changed after diagnosis or authority issuance.',
    );
  }
  return { diagnosisReceipt, initial };
}

export function prepareStoredInvestigationFixAuthorization({
  projectRoot,
  featureRoot,
  repositoryRoots,
  request,
  clock,
  captureBaseline = captureInvestigationBaseline,
} = {}) {
  const normalized = clone(assertInvestigationRequest(request));
  if (normalized.mode !== 'fix') {
    fail(
      'E_INVESTIGATION_FIX_AUTHORITY_INVALID',
      'Only fix-mode requests use owner start authorization.',
    );
  }
  const now = clockFrom(clock)();
  validateFixRequestContext({
    projectRoot,
    featureRoot,
    repositoryRoots,
    request: normalized,
    now,
    captureBaseline,
  });
  const preview = Object.freeze({
    kind: 'investigation-fix-authorization-preview',
    schemaVersion: '1.0.0',
    requestDigest: sha256Jcs(normalized),
    diagnosisReceiptHash: normalized.diagnosisReceiptHash,
    targetBaselineDigest: normalized.authority.targetBaselineDigest,
    scopeDigest: sha256Jcs(normalized.authority.scope),
    actorId: normalized.authority.actorId,
    reason: normalized.authority.reason,
  });
  FIX_AUTHORIZATION_PREVIEWS.set(preview, {
    requestDigest: preview.requestDigest,
    diagnosisReceiptHash: preview.diagnosisReceiptHash,
    targetBaselineDigest: preview.targetBaselineDigest,
    scopeDigest: preview.scopeDigest,
    issued: false,
  });
  return preview;
}

export function issueInvestigationFixStartCapability(preview) {
  const previewBinding =
    preview && typeof preview === 'object' ? FIX_AUTHORIZATION_PREVIEWS.get(preview) : undefined;
  if (!previewBinding || previewBinding.issued) {
    fail(
      'E_INVESTIGATION_FIX_AUTHORITY_REQUIRED',
      'Fix start requires one fresh engine-issued owner authorization preview.',
    );
  }
  previewBinding.issued = true;
  const capability = Object.freeze({
    kind: 'investigation-fix-start-capability',
    schemaVersion: '1.0.0',
    requestDigest: previewBinding.requestDigest,
    diagnosisReceiptHash: previewBinding.diagnosisReceiptHash,
    targetBaselineDigest: previewBinding.targetBaselineDigest,
    scopeDigest: previewBinding.scopeDigest,
  });
  FIX_START_CAPABILITIES.set(capability, {
    ...previewBinding,
    consumed: false,
    runId: null,
  });
  return capability;
}

function fixStartCapability(capability, request) {
  const binding =
    capability && typeof capability === 'object'
      ? FIX_START_CAPABILITIES.get(capability)
      : undefined;
  if (
    !binding ||
    binding.requestDigest !== sha256Jcs(request) ||
    binding.diagnosisReceiptHash !== request.diagnosisReceiptHash ||
    binding.targetBaselineDigest !== request.authority.targetBaselineDigest ||
    binding.scopeDigest !== sha256Jcs(request.authority.scope)
  ) {
    fail(
      'E_INVESTIGATION_FIX_AUTHORITY_REQUIRED',
      'New fix-mode investigation start requires the exact one-shot owner-issued capability.',
      'Run investigate start in an interactive owner terminal and confirm the exact request digest.',
    );
  }
  return binding;
}

export function readInvestigationReceipt({ projectRoot, featureRoot, receiptHash } = {}) {
  const value = paths(projectRoot, featureRoot);
  if (!existsSync(value.receiptDir))
    fail(
      'E_INVESTIGATION_RECEIPT_NOT_FOUND',
      'No investigation receipt custody exists for this feature.',
    );
  const target = receiptPath(value, receiptHash);
  if (!existsSync(target))
    fail('E_INVESTIGATION_RECEIPT_NOT_FOUND', `No investigation receipt matches ${receiptHash}.`);
  const receipt = readRecord(target, 'receipt');
  if (receipt.receiptHash !== receiptHash)
    fail('E_INVESTIGATION_RECEIPT_INVALID', 'Investigation receipt hash and custody disagree.');
  return clone(receipt);
}

export function startStoredInvestigation({
  projectRoot,
  featureRoot,
  repositoryRoots,
  request,
  runId = `inv_${randomUUID().replaceAll('-', '')}`,
  clock,
  commandHost,
  fixCapability = null,
  captureBaseline = captureInvestigationBaseline,
} = {}) {
  const normalized = clone(assertInvestigationRequest(request));
  if (!/^inv_[a-f0-9]{32}$/.test(runId))
    fail('E_INVESTIGATION_RUN_ID_INVALID', 'Investigation runId must use inv_<32 lowercase hex>.');
  if (normalized.mode === 'diagnose') commandHostExecutor(commandHost);
  const capabilityBinding =
    normalized.mode === 'fix' ? fixStartCapability(fixCapability, normalized) : null;
  const value = paths(projectRoot, featureRoot);
  ensureDirs(value);
  const now = clockFrom(clock);
  return withLock(value.featureLock, () => {
    const existingActive = activePath(value, runId);
    const existing = existsSync(existingActive)
      ? readRecord(existingActive, 'active')
      : receipts(value).find((entry) => entry.runId === runId);
    if (existing) {
      if (existing.requestDigest !== sha256Jcs(normalized))
        fail(
          'E_INVESTIGATION_RUN_ID_CONFLICT',
          `Investigation run ${runId} already binds a different request.`,
        );
      if (
        capabilityBinding !== null &&
        (!capabilityBinding.consumed || capabilityBinding.runId !== runId)
      ) {
        fail(
          'E_INVESTIGATION_FIX_AUTHORITY_REPLAYED',
          'Fix start capability was consumed by a different run.',
        );
      }
      return summary(existing, { replayed: true });
    }
    if (capabilityBinding?.consumed) {
      fail('E_INVESTIGATION_FIX_AUTHORITY_REPLAYED', 'Fix start capability was already consumed.');
    }
    const other = activeFiles(value);
    if (other.length)
      fail(
        'E_INVESTIGATION_ACTIVE',
        `Feature already has active investigation ${other[0].slice(0, -5)}.`,
      );
    let initial;
    let reproduction = null;
    let diagnosisReceipt = null;
    if (normalized.mode === 'diagnose') {
      initial = baseline(captureBaseline, repositoryRoots, normalized.targetScope);
      const evidence = executionEvidence(normalized.reproduction, {
        repositoryRoots,
        commandHost,
        targetScope: normalized.targetScope,
        clock: now,
      });
      const after = baseline(captureBaseline, repositoryRoots, normalized.targetScope);
      assertUnchanged(initial, after);
      reproduction = { command: clone(normalized.reproduction), ...evidence };
    } else {
      ({ diagnosisReceipt, initial } = validateFixRequestContext({
        projectRoot,
        featureRoot,
        repositoryRoots,
        request: normalized,
        now: now(),
        captureBaseline,
      }));
    }
    const record = createInvestigationRecord({
      runId,
      request: normalized,
      baseline: initial,
      reproduction,
      diagnosisReceipt,
      now: now(),
    });
    writeJson(activePath(value, runId), record);
    if (capabilityBinding !== null) {
      capabilityBinding.consumed = true;
      capabilityBinding.runId = runId;
    }
    return summary(record);
  });
}

function normalizeAdvanceEvent(event) {
  const { canonical, eventId, inputDigest } = investigationEventIdentity(event);
  if (
    !Number.isSafeInteger(canonical.expectedGeneration) ||
    canonical.expectedGeneration < 0 ||
    typeof canonical.type !== 'string'
  )
    fail(
      'E_INVESTIGATION_EVENT_INVALID',
      'Investigation event requires a non-negative expectedGeneration and closed type.',
    );
  const allowed = new Set([
    'observation.recorded',
    'hypotheses.registered',
    'experiment.ran',
    'diagnosis.concluded',
    'change.recorded',
  ]);
  if (!allowed.has(canonical.type))
    fail('E_INVESTIGATION_EVENT_INVALID', `Unsupported advance event ${canonical.type}.`);
  if (canonical.type === 'experiment.ran' && Object.hasOwn(canonical.experiment ?? {}, 'evidence'))
    fail('E_INVESTIGATION_EVIDENCE_CALLER_AUTHORED', 'Experiment evidence is engine-owned.');
  if (
    canonical.type === 'change.recorded' &&
    !same(Object.keys(canonical).sort(), ['expectedGeneration', 'summary', 'type'].sort())
  )
    fail(
      'E_INVESTIGATION_EVENT_INVALID',
      'Change registration accepts only expectedGeneration and a safe summary.',
    );
  return { canonical, eventId, inputDigest };
}

function preflightExperiment(record, experiment) {
  if (
    !experiment ||
    typeof experiment !== 'object' ||
    Array.isArray(experiment) ||
    Object.hasOwn(experiment, 'evidence')
  )
    fail('E_INVESTIGATION_EVENT_INVALID', 'Experiment submission shape is invalid.');
  assertInvestigationCommand(experiment.command, {
    label: 'experiment.command',
    allowedEffects: [experiment.kind],
  });
  const identity = {
    name: experiment.name,
    kind: experiment.kind,
    command: experiment.command,
    hypothesisIds: experiment.hypothesisIds,
    predictions: experiment.predictions,
  };
  const id = investigationArtifactId('exp', identity);
  if (id !== experiment.id)
    fail('E_INVESTIGATION_EXPERIMENT_INVALID', 'Experiment ID does not bind its exact design.');
  if (experiment.kind !== 'read-only') {
    if (experiment.approval === null || experiment.approval === undefined)
      fail(
        'E_INVESTIGATION_APPROVAL_REQUIRED',
        `${experiment.kind} experiment requires an independent approval artifact.`,
      );
    assertInvestigationApproval(experiment.approval, {
      experimentId: id,
      experimentKind: experiment.kind,
      baselineDigest: record.initialBaseline.digest,
    });
  }
}

export function advanceStoredInvestigation({
  projectRoot,
  featureRoot,
  repositoryRoots,
  runId,
  event,
  clock,
  commandHost,
  captureBaseline = captureInvestigationBaseline,
} = {}) {
  const value = paths(projectRoot, featureRoot);
  ensureDirs(value);
  const identity = normalizeAdvanceEvent(event);
  const now = clockFrom(clock);
  return withLock(value.featureLock, () => {
    const loaded = load(value, runId);
    const prior = loaded.record.events.find(({ eventId }) => eventId === identity.eventId);
    if (prior) {
      if (prior.inputDigest !== identity.inputDigest)
        fail(
          'E_INVESTIGATION_EVENT_REPLAY_DIVERGED',
          `Event ${identity.eventId} replayed with divergent bytes.`,
        );
      return summary(loaded.record, { replayed: true });
    }
    if (loaded.record.recordType === 'receipt')
      fail('E_INVESTIGATION_TERMINAL', 'Terminal investigation receipts are immutable.');
    if (identity.canonical.expectedGeneration !== loaded.record.generation)
      fail(
        'E_INVESTIGATION_GENERATION_CONFLICT',
        `Expected generation ${identity.canonical.expectedGeneration}, current generation is ${loaded.record.generation}.`,
      );
    let internal = { ...clone(identity.canonical), eventId: identity.eventId };
    if (identity.canonical.type === 'experiment.ran') {
      preflightExperiment(loaded.record, identity.canonical.experiment);
      const before = baseline(captureBaseline, repositoryRoots, loaded.record.targetScope);
      if (before.digest !== loaded.record.currentBaselineDigest)
        fail('E_INVESTIGATION_DIAGNOSIS_DRIFT', 'Diagnosis target changed before the experiment.');
      const evidence = executionEvidence(identity.canonical.experiment.command, {
        repositoryRoots,
        commandHost,
        targetScope: loaded.record.targetScope,
        clock: now,
      });
      const after = baseline(captureBaseline, repositoryRoots, loaded.record.targetScope);
      assertUnchanged(before, after);
      internal.experiment = { ...clone(identity.canonical.experiment), evidence };
    } else if (identity.canonical.type === 'change.recorded') {
      if (loaded.record.mode !== 'fix')
        fail('E_INVESTIGATION_TRANSITION_INVALID', 'Only fix mode records changed bytes.');
      const after = baseline(captureBaseline, repositoryRoots, loaded.record.targetScope);
      const changedPaths = diffInvestigationBaselines(loaded.record.initialBaseline, after);
      internal = {
        type: 'change.recorded',
        expectedGeneration: identity.canonical.expectedGeneration,
        eventId: identity.eventId,
        change: {
          summary: identity.canonical.summary,
          fromBaselineDigest: loaded.record.initialBaseline.digest,
          toBaselineDigest: after.digest,
          changedPaths,
        },
      };
    }
    const next = reduceInvestigationRecord(loaded.record, internal, {
      now: now(),
      inputDigest: identity.inputDigest,
    });
    writeJson(loaded.active, next);
    return summary(next);
  });
}

export function verifyStoredInvestigation({
  projectRoot,
  featureRoot,
  repositoryRoots,
  runId,
  clock,
  commandHost,
  captureBaseline = captureInvestigationBaseline,
} = {}) {
  const value = paths(projectRoot, featureRoot);
  ensureDirs(value);
  const now = clockFrom(clock);
  return withLock(value.featureLock, () => {
    const loaded = load(value, runId);
    if (loaded.record.mode !== 'fix')
      fail('E_INVESTIGATION_TRANSITION_INVALID', 'Verification is available only in fix mode.');
    if (loaded.record.verification !== null || loaded.record.recordType === 'receipt')
      return summary(loaded.record, { replayed: true });
    if (loaded.record.state !== 'changed')
      fail(
        'E_INVESTIGATION_TRANSITION_INVALID',
        'Verification requires one registered fix candidate.',
      );
    const request = loaded.record;
    const before = baseline(captureBaseline, repositoryRoots, request.targetScope);
    if (before.digest !== request.change.toBaselineDigest)
      fail('E_INVESTIGATION_BASELINE_CHANGED', 'Fix candidate changed before verification.');
    const regression = executionEvidence(request.verificationCommands.regression, {
      repositoryRoots,
      commandHost,
      targetScope: request.targetScope,
      clock: now,
    });
    const relevantSuite = executionEvidence(request.verificationCommands.relevantSuite, {
      repositoryRoots,
      commandHost,
      targetScope: request.targetScope,
      clock: now,
    });
    const after = baseline(captureBaseline, repositoryRoots, request.targetScope);
    assertUnchanged(before, after, 'E_INVESTIGATION_VERIFICATION_DRIFT');
    const canonical = {
      type: 'verification.recorded',
      expectedGeneration: request.generation,
      candidateDigest: request.change.toBaselineDigest,
      regressionCommandDigest: regression.commandDigest,
      relevantSuiteCommandDigest: relevantSuite.commandDigest,
    };
    const eventId = investigationArtifactId('ive', canonical);
    const next = reduceInvestigationRecord(
      request,
      {
        type: 'verification.recorded',
        expectedGeneration: request.generation,
        eventId,
        verification: {
          candidateDigest: request.change.toBaselineDigest,
          regression,
          relevantSuite,
        },
      },
      { now: now(), inputDigest: sha256Jcs(canonical) },
    );
    writeJson(loaded.active, next);
    return summary(next);
  });
}

export function finalizeStoredInvestigation({
  projectRoot,
  featureRoot,
  repositoryRoots,
  runId,
  clock,
  captureBaseline = captureInvestigationBaseline,
} = {}) {
  const value = paths(projectRoot, featureRoot);
  ensureDirs(value);
  const now = clockFrom(clock);
  return withLock(value.featureLock, () => {
    const loaded = load(value, runId);
    if (loaded.record.recordType === 'receipt') return summary(loaded.record, { replayed: true });
    const current = baseline(captureBaseline, repositoryRoots, loaded.record.targetScope);
    const receipt = finalizeInvestigationRecord(loaded.record, { baseline: current, now: now() });
    writeReceipt(value, receipt);
    try {
      unlinkSync(loaded.active);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return summary(receipt);
  });
}
