import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { isatty } from 'node:tty';
import { fileURLToPath } from 'node:url';

import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';
import { PipelineError } from './errors.mjs';
import {
  assertLandingConfirmation,
  assertLandingEvent,
  assertLandingOperationRegistry,
  assertLandingPhaseReceipt,
  assertLandingPlan,
  assertLandingReceipt,
  reduceLandingEvents,
} from './landing-contract.mjs';
import { assertCurrentShipClosureForLanding } from './ship-closure.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HASH = /^sha256:[a-f0-9]{64}$/u;
const RUN_ID = /^lrun_[a-f0-9]{32}$/u;
const OPERATION_ID = /^lop_[a-f0-9]{32}$/u;
const EFFECT_BY_OPERATION = Object.freeze({
  canary: 'staging-deploy',
  commit: 'commit',
  compensate: 'rollback-or-compensation',
  deploy: 'production-deploy',
  merge: 'merge',
  package: 'commit',
  publish: 'publish',
  'pull-request': 'push-or-pr',
  rollback: 'rollback-or-compensation',
  verify: 'staging-deploy',
});
const SENSITIVITY_BY_EFFECT = Object.freeze({
  destructive: 'restricted',
  'external-effect': 'confidential',
  'project-write': 'internal',
  'provider-call': 'confidential',
});
const WORKFLOW_COMMANDS = Object.freeze([
  Object.freeze({
    id: 'prepare',
    invocation: 'planr land prepare',
    access: 'read-only',
    effect: 'none',
    agentCallable: true,
    machineJson: true,
    requiresTty: false,
    terminal: 'ownerActionRequired',
  }),
  Object.freeze({
    id: 'show',
    invocation: 'planr land show',
    access: 'read-only',
    effect: 'none',
    agentCallable: true,
    machineJson: true,
    requiresTty: false,
    terminal: 'ownerActionRequired',
  }),
  Object.freeze({
    id: 'status',
    invocation: 'planr land status',
    access: 'read-only',
    effect: 'none',
    agentCallable: true,
    machineJson: true,
    requiresTty: false,
    terminal: 'read-only',
  }),
  Object.freeze({
    id: 'advance',
    invocation: 'planr land advance',
    access: 'owner-interactive',
    effect: 'runtime-dispatch',
    agentCallable: false,
    machineJson: false,
    requiresTty: true,
    terminal: 'receipt-or-recovery',
  }),
]);
const HOST_ASSETS = Object.freeze([
  Object.freeze({ runtime: 'claude-code', path: 'skills/planr-land/SKILL.md' }),
  Object.freeze({ runtime: 'codex', path: 'adapters/codex/skills/planr-land/SKILL.md' }),
  Object.freeze({ runtime: 'cursor', path: 'adapters/cursor/rules/openplanr-land.mdc' }),
]);
const LANDING_PLAN_CONTEXTS = new WeakMap();
const TRUSTED_RUNTIME_HOSTS = new WeakMap();
const OWNER_CAPABILITIES = new WeakMap();
const ADVANCE_INTENTS = new WeakMap();
const CUSTODY_COMMIT_TOKENS = new WeakMap();
const DISPATCH_RESULT_TOKENS = new WeakMap();
let activeOwnerPrompt = false;

export const LANDING_WORKFLOW_CATALOG_PATH = 'registry/landing-workflows.json';
export const LANDING_OPERATION_REGISTRY_PATH = 'registry/landing-operations.json';
export const LANDING_WORKFLOW_MANIFEST_PATH =
  'conformance/fixtures/landing-workflow/generated-assets.json';
export const LANDING_WORKFLOW_ID = 'planr-land';
export const LANDING_WORKFLOW_ASSET_PATHS = Object.freeze([
  'lib/pipeline/landing.mjs',
  'lib/pipeline/landing.d.mts',
  'schemas/v1.2.0/landing-workflow-catalog.schema.json',
  LANDING_WORKFLOW_CATALOG_PATH,
]);

function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}

function clone(value) {
  return structuredClone(value);
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}
function bytesDigest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
function canonicalDate(value, label) {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    fail('E_LANDING_TIME_INVALID', `${label} must be one canonical UTC timestamp.`);
  }
  return value;
}
function exactKeys(value, keys, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
  ) {
    fail(
      'E_LANDING_INPUT_INVALID',
      `${label} must contain exactly ${[...keys].sort().join(', ')}.`,
    );
  }
}
function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(join(packageRoot, path), 'utf8'));
  } catch {
    fail('E_LANDING_PACKAGE_INVALID', `The packaged ${label} is unreadable.`);
  }
}

export function assertLandingWorkflowCatalog(value) {
  try {
    assertProtocolArtifact('landing-workflow-catalog', value, { protocolVersion: '1.2.0' });
  } catch (cause) {
    fail(
      'E_LANDING_WORKFLOW_CATALOG_INVALID',
      'The landing workflow catalog is schema-invalid.',
      '',
      {
        cause: cause?.code ?? cause?.message ?? 'unknown',
      },
    );
  }
  const { catalogHash, ...body } = value;
  if (
    catalogHash !== sha256Jcs(body) ||
    value.authority !== 'none' ||
    value.workflow?.workflowId !== LANDING_WORKFLOW_ID ||
    value.workflow?.authorityBoundary !== 'portable-json-is-not-effect-authority' ||
    sha256Jcs(value.workflow.commands) !== sha256Jcs(WORKFLOW_COMMANDS) ||
    sha256Jcs(value.workflow.hostAssets) !== sha256Jcs(HOST_ASSETS)
  ) {
    fail(
      'E_LANDING_WORKFLOW_CATALOG_INVALID',
      'The landing workflow catalog changed its closed command, authority, or host-asset contract.',
    );
  }
  return freeze(clone(value));
}

export function readLandingWorkflowCatalog() {
  return assertLandingWorkflowCatalog(
    readJson(LANDING_WORKFLOW_CATALOG_PATH, 'landing workflow catalog'),
  );
}

export function readLandingOperationRegistry() {
  return assertLandingOperationRegistry(
    readJson(LANDING_OPERATION_REGISTRY_PATH, 'landing operation registry'),
  );
}

export function assertLandingWorkflowManifest(value, { verifyFiles = false } = {}) {
  exactKeys(
    value,
    ['assets', 'generator', 'kind', 'protocolVersion', 'schemaVersion', 'workflowCatalogDigest'],
    'landing workflow manifest',
  );
  if (
    value.kind !== 'landing-workflow-assets' ||
    value.schemaVersion !== '1.0.0' ||
    value.protocolVersion !== '1.2.0' ||
    value.generator !== 'scripts/generate-landing-workflow-assets.mjs' ||
    !HASH.test(value.workflowCatalogDigest ?? '') ||
    !Array.isArray(value.assets) ||
    JSON.stringify(value.assets.map(({ path }) => path)) !==
      JSON.stringify(LANDING_WORKFLOW_ASSET_PATHS)
  ) {
    fail(
      'E_LANDING_WORKFLOW_MANIFEST_INVALID',
      'The landing workflow manifest has non-canonical identity or membership.',
    );
  }
  for (const [index, asset] of value.assets.entries()) {
    exactKeys(asset, ['digest', 'path'], `landing workflow manifest asset ${index}`);
    if (asset.path !== LANDING_WORKFLOW_ASSET_PATHS[index] || !HASH.test(asset.digest ?? '')) {
      fail(
        'E_LANDING_WORKFLOW_MANIFEST_INVALID',
        'The landing workflow manifest has invalid asset custody.',
      );
    }
  }
  if (verifyFiles) {
    const catalogBytes = readFileSync(join(packageRoot, LANDING_WORKFLOW_CATALOG_PATH));
    if (
      bytesDigest(catalogBytes) !== value.workflowCatalogDigest ||
      value.assets.some(
        ({ path, digest }) => bytesDigest(readFileSync(join(packageRoot, path))) !== digest,
      )
    ) {
      fail(
        'E_LANDING_WORKFLOW_MANIFEST_INVALID',
        'The landing workflow manifest does not match packaged bytes.',
      );
    }
  }
  return freeze(clone(value));
}

export function readLandingWorkflowManifest({ verifyFiles = true } = {}) {
  return assertLandingWorkflowManifest(
    readJson(LANDING_WORKFLOW_MANIFEST_PATH, 'landing workflow manifest'),
    { verifyFiles },
  );
}

function refreshedContext(closureInspection) {
  const current = assertCurrentShipClosureForLanding(closureInspection);
  return {
    closureInspection: current,
    shipReceipt: current.receipt,
    shipProjection: current.shipProjection,
  };
}

function shipClosureRef(inspection) {
  return {
    contractId: 'ship-closure',
    schemaVersion: inspection.receipt.schemaVersion,
    protocolVersion: '1.1.0',
    recordType: 'receipt',
    runId: inspection.runId,
    terminalStatus: 'passed',
    receiptHash: inspection.receiptHash,
    recordDigest: inspection.recordDigest,
  };
}

function projectedRepositories(inspection) {
  const candidate = inspection.receipt.candidateRevisions.at(-1);
  return candidate.repositories.map((repository) => ({
    ...clone(repository),
    projectionDigest: sha256Jcs({
      contractId: 'ship-compatibility-projection',
      schemaVersion: inspection.receipt.schemaVersion,
      receiptHash: inspection.receiptHash,
      recordDigest: inspection.recordDigest,
      repository,
    }),
  }));
}

function bindPlan(plan, { closureInspection, operationRegistry, baseRecords }) {
  const current = refreshedContext(closureInspection);
  const registry = operationRegistry ?? readLandingOperationRegistry();
  const records = clone(baseRecords ?? []);
  const normalized = assertLandingPlan(plan, {
    shipReceipt: current.shipReceipt,
    shipProjection: current.shipProjection,
    operationRegistry: registry,
    baseRecords: records,
    activeSuccessor: current.closureInspection.activeSuccessor,
  });
  LANDING_PLAN_CONTEXTS.set(normalized, {
    closureInspection: current.closureInspection,
    operationRegistry: freeze(clone(registry)),
    baseRecords: freeze(records),
  });
  return normalized;
}

export function bindLandingPlan({
  plan,
  closureInspection,
  operationRegistry,
  baseRecords = [],
} = {}) {
  return bindPlan(plan, { closureInspection, operationRegistry, baseRecords });
}

function planContext(plan) {
  const context = plan && typeof plan === 'object' ? LANDING_PLAN_CONTEXTS.get(plan) : undefined;
  if (!context) {
    fail(
      'E_LANDING_PLAN_CONTEXT_REQUIRED',
      'Landing requires an exact plan bound to the current process-owned SHIP inspection and base records.',
    );
  }
  const current = refreshedContext(context.closureInspection);
  const normalized = assertLandingPlan(plan, {
    shipReceipt: current.shipReceipt,
    shipProjection: current.shipProjection,
    operationRegistry: context.operationRegistry,
    baseRecords: context.baseRecords,
    activeSuccessor: current.closureInspection.activeSuccessor,
  });
  return { ...context, ...current, plan: normalized };
}

export function prepareLanding({
  closureInspection,
  currentTargetHash,
  operations,
  preconditions = [],
  baseRecords = [],
  operationRegistry = readLandingOperationRegistry(),
  createdAt,
  expiresAt,
} = {}) {
  if (
    !HASH.test(currentTargetHash ?? '') ||
    !Array.isArray(operations) ||
    operations.length === 0 ||
    !Array.isArray(preconditions)
  ) {
    fail(
      'E_LANDING_INPUT_INVALID',
      'Landing preparation requires one target hash and a non-empty operation DAG.',
    );
  }
  canonicalDate(createdAt, 'createdAt');
  canonicalDate(expiresAt, 'expiresAt');
  const lifetime = Date.parse(expiresAt) - Date.parse(createdAt);
  if (lifetime <= 0 || lifetime > 24 * 60 * 60 * 1000) {
    fail(
      'E_LANDING_TIME_INVALID',
      'A landing plan must expire after creation and within 24 hours.',
    );
  }
  const current = refreshedContext(closureInspection);
  if (operations[0]?.targetBeforeHash !== currentTargetHash) {
    fail(
      'E_LANDING_TARGET_STALE',
      'The first landing phase must bind the exact current target state.',
    );
  }
  const core = {
    shipClosure: shipClosureRef(current.closureInspection),
    feature: current.closureInspection.feature,
    candidateDigest: current.closureInspection.candidateDigest,
    candidateInventoryDigest: current.closureInspection.candidateInventoryDigest,
    repositories: projectedRepositories(current.closureInspection),
    currentTargetHash,
    operations: clone(operations),
    preconditions: clone(preconditions),
    createdAt,
    expiresAt,
  };
  const planId = `land_${sha256Jcs(core).slice('sha256:'.length, 'sha256:'.length + 32)}`;
  const body = {
    kind: 'landing-plan',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    planId,
    authority: 'none',
    ...core,
  };
  const plan = { ...body, planHash: sha256Jcs(body) };
  return bindPlan(plan, {
    closureInspection: current.closureInspection,
    operationRegistry,
    baseRecords,
  });
}

function reducedStatus(plan, events) {
  if (!Array.isArray(events)) fail('E_LANDING_INPUT_INVALID', 'Landing Events must be an array.');
  if (events.length === 0) {
    return {
      state: 'planned',
      targetStateHash: plan.currentTargetHash,
      currentOperationId: null,
      currentRequestHash: null,
      currentConfirmationHash: null,
      completedOperationIds: [],
      eventHead: { sequence: 0, hash: null },
    };
  }
  const state = reduceLandingEvents(events);
  if (state.planHash !== plan.planHash)
    fail('E_LANDING_BINDING_MISMATCH', 'Landing Event journal belongs to another plan.');
  return state;
}

function isRecoveryOperation(operation) {
  return ['rollback', 'compensate'].includes(operation.kind);
}

function readyOperations(plan, state) {
  const completed = new Set(state.completedOperationIds);
  if (state.state === 'recovery_required') {
    return plan.operations.filter(
      (operation) =>
        isRecoveryOperation(operation) &&
        operation.dependsOn.includes(state.currentOperationId) &&
        operation.dependsOn.every(
          (dependency) => completed.has(dependency) || dependency === state.currentOperationId,
        ),
    );
  }
  if (!['planned', 'awaiting-confirmation'].includes(state.state)) return [];
  return plan.operations.filter(
    (operation) =>
      !isRecoveryOperation(operation) &&
      !completed.has(operation.operationId) &&
      operation.dependsOn.every((dependency) => completed.has(dependency)),
  );
}

export function landingStatus({ plan, events = [] } = {}) {
  const context = planContext(plan);
  const state = reducedStatus(context.plan, events);
  const readyOperationIds = readyOperations(context.plan, state)
    .slice(0, 1)
    .map(({ operationId }) => operationId);
  const nextAction =
    ['planned', 'awaiting-confirmation'].includes(state.state) && readyOperationIds.length > 0
      ? 'ownerActionRequired'
      : state.state === 'recovery_required'
        ? 'ownerRecoveryRequired'
        : ['completed', 'blocked', 'uncertain'].includes(state.state)
          ? 'none'
          : 'reconcile';
  return freeze({
    ok: true,
    operation: 'landing.status',
    authority: 'none',
    planId: context.plan.planId,
    planHash: context.plan.planHash,
    receiptHash: context.plan.shipClosure.receiptHash,
    state: state.state,
    targetStateHash: state.targetStateHash,
    currentOperationId: state.currentOperationId,
    completedOperationIds: clone(state.completedOperationIds),
    readyOperationIds,
    journalHead: clone(state.eventHead),
    nextAction,
  });
}

export function showLanding({ plan, events = [] } = {}) {
  const context = planContext(plan);
  const status = landingStatus({ plan, events });
  return freeze({
    ok: true,
    operation: 'landing.show',
    authority: 'none',
    planId: context.plan.planId,
    planHash: context.plan.planHash,
    shipReceiptHash: context.plan.shipClosure.receiptHash,
    candidateDigest: context.plan.candidateDigest,
    candidateInventoryDigest: context.plan.candidateInventoryDigest,
    currentTargetHash: status.targetStateHash,
    operations: context.plan.operations.map((operation) => ({
      operationId: operation.operationId,
      kind: operation.kind,
      repositoryKey: operation.repositoryKey,
      dependsOn: clone(operation.dependsOn),
      effectClass: operation.effectClass,
      recoveryClass: operation.recoveryClass,
      targetBeforeHash: operation.targetBeforeHash,
      inputDigest: operation.inputDigest,
      preconditionHashes: clone(operation.preconditionHashes),
      containmentPolicyHash: operation.containment?.policyHash ?? null,
    })),
    state: status.state,
    readyOperationIds: status.readyOperationIds,
    effects: [],
    authorityRequired:
      status.nextAction === 'ownerActionRequired' || status.nextAction === 'ownerRecoveryRequired',
    nextAction: status.nextAction,
  });
}

function operationFor(plan, operationId) {
  if (!OPERATION_ID.test(operationId ?? ''))
    fail('E_LANDING_OPERATION_INVALID', 'Landing requires one exact operation ID.');
  const operation = plan.operations.find((entry) => entry.operationId === operationId);
  if (!operation)
    fail('E_LANDING_OPERATION_INVALID', `Landing plan does not contain ${operationId}.`);
  return operation;
}

function neutralDocket(plan, operation, currentTargetHash, expiresAt) {
  if (operation.targetBeforeHash !== currentTargetHash) {
    fail(
      'E_LANDING_TARGET_STALE',
      'Landing owner confirmation requires the exact current target state.',
    );
  }
  const selected = plan.preconditions.filter(({ proofHash }) =>
    operation.preconditionHashes.includes(proofHash),
  );
  const providerPreconditionHashes = selected
    .filter(({ kind }) => kind === 'provider-available')
    .map(({ proofHash }) => proofHash)
    .sort();
  const canaryHashes = selected
    .filter(({ kind }) => kind === 'canary-ready')
    .map(({ proofHash }) => proofHash)
    .sort();
  if (canaryHashes.length > 1)
    fail('E_LANDING_BINDING_MISMATCH', 'One phase cannot bind multiple canary policies.');
  return freeze({
    sourceReceiptHash: plan.shipClosure.receiptHash,
    candidateDigest: plan.candidateDigest,
    targetHash: operation.targetBeforeHash,
    currentTargetHash,
    operationIds: [operation.operationId],
    effectSet: [EFFECT_BY_OPERATION[operation.kind]],
    inputDigest: operation.inputDigest,
    providerPreconditionHashes,
    sensitivity: SENSITIVITY_BY_EFFECT[operation.effectClass],
    consequences: [
      `Execute ${operation.kind} with ${operation.effectClass} effects and ${operation.recoveryClass} recovery.`,
    ],
    recoveryClass: operation.recoveryClass,
    canaryPolicyHash: canaryHashes[0] ?? null,
    containmentPolicyHash: operation.containment?.policyHash ?? null,
    expiresAt,
    changedStateDiffHash: sha256Jcs({
      targetBeforeHash: operation.targetBeforeHash,
      inputDigest: operation.inputDigest,
      preconditionHashes: [...operation.preconditionHashes].sort(),
    }),
    authorityBoundary: 'portable-confirmation-is-not-effect-authority',
    choices: ['confirm', 'cancel'],
    defaultChoice: null,
    cancelEffect: 'none',
  });
}

export function previewLandingDocket({ plan, operationId, currentTargetHash, expiresAt } = {}) {
  const context = planContext(plan);
  canonicalDate(expiresAt, 'expiresAt');
  const operation = operationFor(context.plan, operationId);
  return neutralDocket(context.plan, operation, currentTargetHash, expiresAt);
}

function createLandingTrustedRuntimeHost(value = {}) {
  exactKeys(
    value,
    ['commitIntent', 'commitOutcome', 'confirm', 'dispatch', 'reconcile', 'snapshot'],
    'trusted landing runtime host',
  );
  if (Object.values(value).some((entry) => typeof entry !== 'function')) {
    fail(
      'E_LANDING_OWNER_HOST_INVALID',
      'Trusted landing runtime host requires six exact custody functions.',
    );
  }
  const host = Object.freeze({
    kind: 'landing-trusted-runtime-host',
    schemaVersion: '1.0.0',
    hostId: `lrth_${randomUUID().replaceAll('-', '')}`,
  });
  TRUSTED_RUNTIME_HOSTS.set(host, Object.freeze({ ...value }));
  return host;
}

function hasLiveOwnerTerminal() {
  const inputFd = process.stdin?.fd;
  const outputFd = process.stderr?.fd;
  return (
    Number.isInteger(inputFd) && Number.isInteger(outputFd) && isatty(inputFd) && isatty(outputFd)
  );
}

function requireLiveOwnerTerminal() {
  if (!hasLiveOwnerTerminal()) {
    fail(
      'E_LANDING_OWNER_INTERACTIVE_REQUIRED',
      'Landing authority requires a live same-process owner terminal; JSON, --yes, hooks, and callbacks cannot authorize effects.',
      'Run planr land advance from an interactive terminal and answer the no-default owner prompt.',
    );
  }
}

function hasControlCharacters(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

async function confirmLandingFromOwnerTerminal(request) {
  requireLiveOwnerTerminal();
  if (activeOwnerPrompt) {
    fail(
      'E_LANDING_OWNER_INTERACTION_BUSY',
      'Another landing owner decision is already active in this terminal session.',
      'Finish or cancel the active owner prompt before advancing another landing operation.',
    );
  }
  activeOwnerPrompt = true;
  let terminal;
  try {
    terminal = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });
    process.stderr.write(`\nOPENPLANR_LANDING_DOCKET ${JSON.stringify(request)}\n`);
    let ownerActorId = '';
    while (
      ownerActorId.length < 1 ||
      ownerActorId.length > 128 ||
      hasControlCharacters(ownerActorId)
    ) {
      ownerActorId = (await terminal.question('OPENPLANR_LANDING_OWNER_ID> ')).trim();
    }
    let choice = '';
    while (!['confirm', 'cancel'].includes(choice)) {
      choice = (await terminal.question('OPENPLANR_LANDING_CHOICE [confirm/cancel; no default]> '))
        .trim()
        .toLowerCase();
    }
    return { choice, ownerActorId };
  } catch (cause) {
    fail(
      'E_LANDING_OWNER_INTERACTIVE_REQUIRED',
      'The live owner terminal closed before an explicit landing decision was recorded.',
      'Run planr land advance again from an interactive terminal.',
      { cause: cause?.code ?? cause?.message ?? 'unknown' },
    );
  } finally {
    terminal?.close();
    activeOwnerPrompt = false;
  }
}

export function createLandingOwnerRuntimeHost(value = {}) {
  requireLiveOwnerTerminal();
  exactKeys(
    value,
    ['commitIntent', 'commitOutcome', 'dispatch', 'reconcile', 'snapshot'],
    'owner landing runtime host callbacks',
  );
  if (Object.values(value).some((entry) => typeof entry !== 'function')) {
    fail(
      'E_LANDING_OWNER_HOST_INVALID',
      'Owner landing runtime host requires five exact custody functions.',
    );
  }
  return createLandingTrustedRuntimeHost({
    ...value,
    confirm: confirmLandingFromOwnerTerminal,
  });
}

async function issueLandingOwnerConfirmation({
  host,
  plan,
  operationId,
  currentTargetHash,
  issuedAt,
  expiresAt,
} = {}) {
  const runtimeHost =
    host && typeof host === 'object' ? TRUSTED_RUNTIME_HOSTS.get(host) : undefined;
  if (runtimeHost === undefined) {
    fail(
      'E_LANDING_OWNER_HOST_REQUIRED',
      'Landing confirmation requires the original trusted owner interaction host.',
    );
  }
  canonicalDate(issuedAt, 'issuedAt');
  canonicalDate(expiresAt, 'expiresAt');
  const lifetime = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (lifetime <= 0 || lifetime > 15 * 60 * 1000) {
    fail(
      'E_LANDING_CONFIRMATION_EXPIRED',
      'Landing confirmation must expire after issue and within 15 minutes.',
    );
  }
  const context = planContext(plan);
  const operation = operationFor(context.plan, operationId);
  const docket = neutralDocket(context.plan, operation, currentTargetHash, expiresAt);
  const response = await runtimeHost.confirm(
    freeze({
      kind: 'landing-owner-docket',
      schemaVersion: '1.0.0',
      planId: context.plan.planId,
      planHash: context.plan.planHash,
      operationId,
      docket,
    }),
  );
  exactKeys(response, ['choice', 'ownerActorId'], 'landing owner response');
  if (
    !['confirm', 'cancel'].includes(response.choice) ||
    typeof response.ownerActorId !== 'string' ||
    response.ownerActorId.length < 1 ||
    response.ownerActorId.length > 128
  ) {
    fail(
      'E_LANDING_OWNER_RESPONSE_INVALID',
      'Landing owner response must be an exact confirm or cancel choice and owner identity.',
    );
  }
  if (response.choice === 'cancel') {
    return freeze({
      ok: true,
      status: 'cancelled',
      effect: 'none',
      authority: 'none',
      planHash: context.plan.planHash,
      operationId,
      confirmation: null,
      capability: null,
    });
  }

  const capabilityCore = {
    kind: 'landing-owner-capability',
    schemaVersion: '1.0.0',
    capabilityId: `locp_${randomUUID().replaceAll('-', '')}`,
    planHash: context.plan.planHash,
    operationId,
    currentTargetHash,
    issuedAt,
    expiresAt,
  };
  const capability = Object.freeze({
    ...capabilityCore,
    capabilityHash: sha256Jcs(capabilityCore),
  });
  const opaqueCapabilityHash = capability.capabilityHash;
  const confirmationBody = {
    kind: 'landing-confirmation',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    confirmationId: `lcnf_${capability.capabilityId.slice('locp_'.length)}`,
    authority: 'none',
    ownerActorId: response.ownerActorId,
    planId: context.plan.planId,
    planHash: context.plan.planHash,
    shipReceiptHash: context.plan.shipClosure.receiptHash,
    phaseId: operation.kind,
    operationIds: [operation.operationId],
    effectSet: [EFFECT_BY_OPERATION[operation.kind]],
    currentTargetHash,
    docket,
    docketHash: sha256Jcs(docket),
    choice: 'confirm',
    issuedAt,
    expiresAt,
    opaqueCapabilityHash,
  };
  const confirmation = assertLandingConfirmation(
    {
      ...confirmationBody,
      confirmationHash: sha256Jcs(confirmationBody),
    },
    {
      plan: context.plan,
      shipReceipt: context.shipReceipt,
      shipProjection: context.shipProjection,
      operationRegistry: context.operationRegistry,
      baseRecords: context.baseRecords,
      activeSuccessor: context.closureInspection.activeSuccessor,
    },
  );
  OWNER_CAPABILITIES.set(capability, {
    plan,
    confirmation,
    operationId,
    currentTargetHash,
    consumed: false,
  });
  return freeze({
    ok: true,
    status: 'confirmed',
    effect: 'none',
    authority: 'opaque-same-process',
    planHash: context.plan.planHash,
    operationId,
    confirmation,
    capability,
  });
}

function createLandingEvent({
  runId,
  sequence,
  type,
  fromState,
  toState,
  actor,
  planHash,
  requestHash,
  operationId = null,
  confirmationHash = null,
  targetStateHash,
  trafficStateHash = null,
  residualStateHash = null,
  previousEventHash = null,
  timestamp,
} = {}) {
  if (
    !RUN_ID.test(runId ?? '') ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    !HASH.test(planHash ?? '') ||
    !HASH.test(requestHash ?? '') ||
    !HASH.test(targetStateHash ?? '') ||
    (previousEventHash !== null && !HASH.test(previousEventHash))
  ) {
    fail(
      'E_LANDING_EVENT_INVALID',
      'Landing Event requires exact run, sequence, plan, request, target, and predecessor custody.',
    );
  }
  canonicalDate(timestamp, 'timestamp');
  const eventId = `levt_${sha256Jcs({ runId, sequence, type, requestHash, operationId }).slice('sha256:'.length, 'sha256:'.length + 32)}`;
  const body = {
    kind: 'landing-event',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    eventId,
    sequence,
    runId,
    type,
    fromState,
    toState,
    actor: clone(actor),
    planHash,
    requestHash,
    operationId,
    confirmationHash,
    targetStateHash,
    trafficStateHash,
    residualStateHash,
    previousEventHash,
    timestamp,
  };
  return assertLandingEvent({ ...body, eventHash: sha256Jcs(body) });
}

function prepareLandingAdvanceIntent({
  plan,
  operationId,
  confirmation,
  capability,
  runId,
  events = [],
  now,
  trafficStateHash = null,
  residualStateHash = null,
} = {}) {
  const owner =
    capability && typeof capability === 'object' ? OWNER_CAPABILITIES.get(capability) : undefined;
  if (
    !owner ||
    owner.plan !== plan ||
    owner.confirmation !== confirmation ||
    owner.operationId !== operationId ||
    owner.consumed
  ) {
    fail(
      'E_LANDING_OWNER_CAPABILITY_REQUIRED',
      'Landing advance requires one unused original owner capability and confirmation.',
    );
  }
  canonicalDate(now, 'now');
  if (
    Date.parse(now) < Date.parse(confirmation.issuedAt) ||
    Date.parse(now) >= Date.parse(confirmation.expiresAt)
  ) {
    fail('E_LANDING_CONFIRMATION_EXPIRED', 'Landing owner confirmation is not current.');
  }
  const context = planContext(plan);
  const operation = operationFor(context.plan, operationId);
  const proof = assertLandingConfirmation(confirmation, {
    plan: context.plan,
    shipReceipt: context.shipReceipt,
    shipProjection: context.shipProjection,
    operationRegistry: context.operationRegistry,
    baseRecords: context.baseRecords,
    activeSuccessor: context.closureInspection.activeSuccessor,
  });
  const state = reducedStatus(context.plan, events);
  const recovery = ['rollback', 'compensate'].includes(operation.kind);
  if (
    (!recovery && !['planned', 'awaiting-confirmation'].includes(state.state)) ||
    (recovery && state.state !== 'recovery_required') ||
    operation.dependsOn.some(
      (dependency) => !state.completedOperationIds.includes(dependency) && !recovery,
    )
  ) {
    fail(
      'E_LANDING_TRANSITION_INVALID',
      'Landing operation is not ready in the current journal state.',
    );
  }
  if (
    state.targetStateHash !== owner.currentTargetHash ||
    operation.targetBeforeHash !== owner.currentTargetHash
  ) {
    fail('E_LANDING_TARGET_STALE', 'Landing target changed after owner confirmation.');
  }
  if (recovery && (!HASH.test(trafficStateHash ?? '') || !HASH.test(residualStateHash ?? ''))) {
    fail(
      'E_LANDING_RECOVERY_INVALID',
      'Recovery advance requires exact traffic and residual state custody.',
    );
  }
  if (!recovery && (trafficStateHash !== null || residualStateHash !== null)) {
    fail('E_LANDING_RECOVERY_INVALID', 'Ordinary landing advance cannot claim recovery state.');
  }
  const requestHash = sha256Jcs({
    planHash: context.plan.planHash,
    operation,
    confirmationHash: proof.confirmationHash,
  });
  const eventsToPersist = [];
  let previousEventHash = state.eventHead.hash;
  let sequence = state.eventHead.sequence;
  if (events.length === 0) {
    const created = createLandingEvent({
      runId,
      sequence: 1,
      type: 'plan.created',
      fromState: 'planned',
      toState: 'awaiting-confirmation',
      actor: { kind: 'engine', id: 'planr-pipeline' },
      planHash: context.plan.planHash,
      requestHash: sha256Jcs({ planHash: context.plan.planHash, type: 'plan.created' }),
      targetStateHash: context.plan.currentTargetHash,
      timestamp: now,
    });
    eventsToPersist.push(created);
    previousEventHash = created.eventHash;
    sequence = 1;
  }
  const intent = createLandingEvent({
    runId,
    sequence: sequence + 1,
    type: recovery ? 'recovery.confirmed' : 'phase.intent-recorded',
    fromState: recovery ? 'recovery_required' : 'awaiting-confirmation',
    toState: 'intent-recorded',
    actor: recovery
      ? { kind: 'human', id: proof.ownerActorId }
      : { kind: 'engine', id: 'planr-pipeline' },
    planHash: context.plan.planHash,
    requestHash,
    operationId,
    confirmationHash: proof.confirmationHash,
    targetStateHash: state.targetStateHash,
    trafficStateHash,
    residualStateHash,
    previousEventHash,
    timestamp: now,
  });
  eventsToPersist.push(intent);
  const attemptIdentity = `latm_${sha256Jcs({
    planHash: context.plan.planHash,
    runId,
    operationId,
    requestHash,
    targetBeforeHash: state.targetStateHash,
    intentEventHash: intent.eventHash,
  }).slice('sha256:'.length, 'sha256:'.length + 32)}`;
  const advance = {
    ok: true,
    kind: 'landing-advance-intent',
    schemaVersion: '1.0.0',
    runId,
    planHash: context.plan.planHash,
    operationId,
    requestHash,
    currentTargetHash: state.targetStateHash,
    priorJournalHeadHash: state.eventHead.hash,
    eventsToPersist,
    intentEventHash: intent.eventHash,
    attemptIdentity,
    ownerCapabilityConsumed: false,
    effectAuthorized: false,
  };
  freeze(advance);
  ADVANCE_INTENTS.set(advance, { capability, confirmation, plan, operation, owner });
  return advance;
}

function assertIdentifier(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    fail('E_LANDING_CUSTODY_INVALID', `${label} must be one closed identifier.`);
  }
  return value;
}

function runtimeHostFor(host) {
  const runtime = host && typeof host === 'object' ? TRUSTED_RUNTIME_HOSTS.get(host) : undefined;
  if (runtime === undefined) {
    fail(
      'E_LANDING_OWNER_HOST_REQUIRED',
      'Landing advance requires the original package-internal trusted runtime host.',
    );
  }
  return runtime;
}

async function captureTrustedLandingSnapshot({ host, plan }) {
  const runtime = runtimeHostFor(host);
  const context = planContext(plan);
  const value = await runtime.snapshot(
    freeze({
      kind: 'landing-custody-snapshot-request',
      schemaVersion: '1.0.0',
      planId: context.plan.planId,
      planHash: context.plan.planHash,
    }),
  );
  exactKeys(
    value,
    [
      'candidateDigest',
      'confirmations',
      'events',
      'evidenceContextsByOperation',
      'evidenceRecordsByOperation',
      'journalHead',
      'landingReceipt',
      'pendingIntent',
      'phaseReceiptHeadHash',
      'phaseReceipts',
      'repositoryHeads',
      'startedAt',
      'targetStateHash',
    ],
    'trusted landing custody snapshot',
  );
  if (
    !HASH.test(value.targetStateHash ?? '') ||
    value.candidateDigest !== context.plan.candidateDigest ||
    (value.phaseReceiptHeadHash !== null && !HASH.test(value.phaseReceiptHeadHash ?? '')) ||
    (value.startedAt !== null && canonicalDate(value.startedAt, 'startedAt') !== value.startedAt) ||
    !Array.isArray(value.repositoryHeads) ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.phaseReceipts) ||
    !Array.isArray(value.confirmations) ||
    !value.evidenceRecordsByOperation ||
    typeof value.evidenceRecordsByOperation !== 'object' ||
    Array.isArray(value.evidenceRecordsByOperation) ||
    !value.evidenceContextsByOperation ||
    typeof value.evidenceContextsByOperation !== 'object' ||
    Array.isArray(value.evidenceContextsByOperation)
  ) {
    fail(
      'E_LANDING_CUSTODY_INVALID',
      'Trusted landing custody snapshot has invalid target, candidate, receipt, or journal custody.',
    );
  }
  const expectedHeads = context.plan.repositories.map(({ repositoryKey, head }) => ({
    repositoryKey,
    head,
  }));
  if (sha256Jcs(value.repositoryHeads) !== sha256Jcs(expectedHeads)) {
    fail(
      'E_LANDING_CANDIDATE_MISMATCH',
      'Trusted landing custody recapture changed repository membership or HEADs.',
    );
  }
  exactKeys(value.journalHead, ['hash', 'sequence'], 'trusted landing journal head');
  const state = reducedStatus(context.plan, value.events);
  if (
    value.journalHead.sequence !== state.eventHead.sequence ||
    value.journalHead.hash !== state.eventHead.hash ||
    (value.pendingIntent === null && value.targetStateHash !== state.targetStateHash) ||
    value.phaseReceipts.length !== value.confirmations.length ||
    value.phaseReceiptHeadHash !== (value.phaseReceipts.at(-1)?.receiptHash ?? null)
  ) {
    fail(
      'E_LANDING_CONCURRENT_MODIFICATION',
      'Trusted landing snapshot disagrees with the durable journal or current target head.',
    );
  }
  let pendingIntent = null;
  if (value.pendingIntent !== null) {
    exactKeys(
      value.pendingIntent,
      [
        'attemptIdentity',
        'commitId',
        'committedAt',
        'confirmation',
        'dispatcherId',
        'intentEventHash',
        'journalHead',
        'kind',
        'operationId',
        'pendingIntentHash',
        'planHash',
        'requestHash',
        'runId',
        'schemaVersion',
        'targetBeforeHash',
      ],
      'durable landing pending intent',
    );
    const { pendingIntentHash, ...pendingIntentBody } = value.pendingIntent;
    if (
      value.pendingIntent.kind !== 'landing-pending-intent' ||
      value.pendingIntent.schemaVersion !== '1.0.0' ||
      value.pendingIntent.pendingIntentHash !== sha256Jcs(pendingIntentBody)
    ) {
      fail(
        'E_LANDING_CUSTODY_INVALID',
        'Durable pending intent changed its closed identity or self-binding hash.',
      );
    }
    assertIdentifier(value.pendingIntent.commitId, 'pending intent commitId');
    assertIdentifier(value.pendingIntent.dispatcherId, 'pending intent dispatcherId');
    canonicalDate(value.pendingIntent.committedAt, 'pending intent committedAt');
    exactKeys(value.pendingIntent.journalHead, ['hash', 'sequence'], 'pending intent journal head');
    const operation = context.plan.operations.find(
      ({ operationId }) => operationId === value.pendingIntent.operationId,
    );
    const intent = value.events.at(-1);
    const confirmation = assertLandingConfirmation(value.pendingIntent.confirmation, {
      plan: context.plan,
      shipReceipt: context.shipReceipt,
      shipProjection: context.shipProjection,
      operationRegistry: context.operationRegistry,
      baseRecords: context.baseRecords,
      activeSuccessor: context.closureInspection.activeSuccessor,
    });
    const expectedRequestHash =
      operation === undefined
        ? null
        : sha256Jcs({
            planHash: context.plan.planHash,
            operation,
            confirmationHash: confirmation.confirmationHash,
          });
    if (
      state.state !== 'intent-recorded' ||
      operation === undefined ||
      !['phase.intent-recorded', 'recovery.confirmed'].includes(intent?.type) ||
      intent.operationId !== operation.operationId ||
      intent.requestHash !== expectedRequestHash ||
      intent.confirmationHash !== confirmation.confirmationHash ||
      value.pendingIntent.planHash !== context.plan.planHash ||
      value.pendingIntent.runId !== state.runId ||
      value.pendingIntent.requestHash !== expectedRequestHash ||
      value.pendingIntent.targetBeforeHash !== state.targetStateHash ||
      value.pendingIntent.intentEventHash !== intent.eventHash ||
      value.pendingIntent.attemptIdentity !==
        `latm_${sha256Jcs({
          planHash: context.plan.planHash,
          runId: state.runId,
          operationId: operation.operationId,
          requestHash: expectedRequestHash,
          targetBeforeHash: state.targetStateHash,
          intentEventHash: intent.eventHash,
        }).slice('sha256:'.length, 'sha256:'.length + 32)}` ||
      value.pendingIntent.journalHead.hash !== state.eventHead.hash ||
      value.pendingIntent.journalHead.sequence !== state.eventHead.sequence ||
      Date.parse(value.pendingIntent.committedAt) < Date.parse(confirmation.issuedAt) ||
      Date.parse(value.pendingIntent.committedAt) >= Date.parse(confirmation.expiresAt)
    ) {
      fail(
        'E_LANDING_CUSTODY_INVALID',
        'Durable pending intent changed its plan, operation, confirmation, target, commit, or journal identity.',
      );
    }
    pendingIntent = freeze({ ...clone(value.pendingIntent), confirmation });
  } else if (state.state === 'intent-recorded') {
    fail(
      'E_LANDING_CUSTODY_INVALID',
      'An intent-recorded landing run requires its durable commit identity for reconcile-only resumption.',
    );
  }
  const terminalState = ['completed', 'blocked', 'uncertain', 'recovery_required'].includes(
    state.state,
  );
  let landingReceipt = null;
  if (value.landingReceipt !== null) {
    landingReceipt = assertLandingReceipt(value.landingReceipt, {
      plan: context.plan,
      shipReceipt: context.shipReceipt,
      shipProjection: context.shipProjection,
      operationRegistry: context.operationRegistry,
      baseRecords: context.baseRecords,
      phaseReceipts: value.phaseReceipts,
      confirmations: value.confirmations,
      evidenceRecordsByOperation: value.evidenceRecordsByOperation,
      evidenceContextsByOperation: value.evidenceContextsByOperation,
      events: value.events,
      activeSuccessor: context.closureInspection.activeSuccessor,
    });
  }
  if (terminalState !== (landingReceipt !== null)) {
    fail(
      'E_LANDING_CUSTODY_INVALID',
      'Terminal landing journal and exact stored landing receipt custody disagree.',
    );
  }
  return freeze({ ...clone(value), landingReceipt, pendingIntent, state });
}

async function commitLandingIntent({ host, advance, snapshot }) {
  const runtime = runtimeHostFor(host);
  const pending = advance && typeof advance === 'object' ? ADVANCE_INTENTS.get(advance) : undefined;
  if (!pending || pending.owner.consumed) {
    fail(
      'E_LANDING_ADVANCE_INTENT_REQUIRED',
      'Landing dispatch requires one original unconsumed advance intent.',
    );
  }
  const acknowledgement = await runtime.commitIntent(
    freeze({
      kind: 'landing-intent-cas',
      schemaVersion: '1.0.0',
      planHash: advance.planHash,
      runId: advance.runId,
      operationId: advance.operationId,
      requestHash: advance.requestHash,
      targetBeforeHash: advance.currentTargetHash,
      intentEventHash: advance.intentEventHash,
      attemptIdentity: advance.attemptIdentity,
      expectedJournalHead: clone(snapshot.journalHead),
      targetStateHash: snapshot.targetStateHash,
      confirmation: clone(pending.confirmation),
      events: clone(advance.eventsToPersist),
    }),
  );
  exactKeys(
    acknowledgement,
    ['commitId', 'committedAt', 'dispatcherId', 'journalHead'],
    'landing intent custody acknowledgement',
  );
  assertIdentifier(acknowledgement.commitId, 'commitId');
  assertIdentifier(acknowledgement.dispatcherId, 'dispatcherId');
  canonicalDate(acknowledgement.committedAt, 'committedAt');
  exactKeys(acknowledgement.journalHead, ['hash', 'sequence'], 'committed landing journal head');
  const intent = advance.eventsToPersist.at(-1);
  if (
    acknowledgement.journalHead.hash !== intent.eventHash ||
    acknowledgement.journalHead.sequence !== intent.sequence ||
    Date.parse(acknowledgement.committedAt) < Date.parse(pending.confirmation.issuedAt) ||
    Date.parse(acknowledgement.committedAt) >= Date.parse(pending.confirmation.expiresAt)
  ) {
    fail(
      'E_LANDING_INTENT_NOT_PERSISTED',
      'Landing dispatch requires an exact durable CAS intent and one elected dispatcher.',
    );
  }
  pending.owner.consumed = true;
  const token = Object.freeze({
    kind: 'landing-custody-commit-token',
    schemaVersion: '1.0.0',
    tokenId: `lcct_${randomUUID().replaceAll('-', '')}`,
  });
  CUSTODY_COMMIT_TOKENS.set(token, {
    host,
    pending,
    advance,
    acknowledgement: freeze(clone(acknowledgement)),
    consumed: false,
  });
  return token;
}

function restoreLandingCustodyCommit({ host, plan, operationId, snapshot }) {
  const durable = snapshot.pendingIntent;
  if (
    snapshot.state.state !== 'intent-recorded' ||
    durable === null ||
    durable.operationId !== operationId
  ) {
    fail(
      'E_LANDING_TRANSITION_INVALID',
      'Reconcile-only resumption requires the exact durable pending operation.',
    );
  }
  const operation = operationFor(planContext(plan).plan, operationId);
  const intent = snapshot.events.at(-1);
  const advance = freeze({
    ok: true,
    kind: 'landing-advance-intent',
    schemaVersion: '1.0.0',
    runId: snapshot.state.runId,
    planHash: plan.planHash,
    operationId,
    requestHash: durable.requestHash,
    currentTargetHash: durable.targetBeforeHash,
    priorJournalHeadHash: intent.previousEventHash,
    eventsToPersist: [clone(intent)],
    intentEventHash: intent.eventHash,
    attemptIdentity: durable.attemptIdentity,
    ownerCapabilityConsumed: true,
    effectAuthorized: false,
  });
  const pending = {
    capability: null,
    confirmation: durable.confirmation,
    plan,
    operation,
    owner: null,
    resumed: true,
  };
  const acknowledgement = freeze({
    commitId: durable.commitId,
    committedAt: durable.committedAt,
    dispatcherId: durable.dispatcherId,
    journalHead: clone(durable.journalHead),
  });
  const token = Object.freeze({
    kind: 'landing-custody-commit-token',
    schemaVersion: '1.0.0',
    tokenId: `lcct_${randomUUID().replaceAll('-', '')}`,
  });
  CUSTODY_COMMIT_TOKENS.set(token, {
    host,
    pending,
    advance,
    acknowledgement,
    consumed: true,
    resumed: true,
  });
  return { acknowledgement, advance, operation, token };
}

function consumeLandingCustodyCommit({
  token,
  plan,
  operationId,
  requestHash,
  targetStateHash,
  now,
}) {
  const binding = token && typeof token === 'object' ? CUSTODY_COMMIT_TOKENS.get(token) : undefined;
  if (
    !binding ||
    binding.consumed ||
    binding.pending.plan !== plan ||
    binding.pending.operation.operationId !== operationId ||
    binding.advance.requestHash !== requestHash ||
    binding.advance.currentTargetHash !== targetStateHash
  ) {
    fail(
      'E_LANDING_DISPATCH_CAPABILITY_REQUIRED',
      'Effect dispatch requires the exact unused opaque durable-custody token.',
    );
  }
  canonicalDate(now, 'now');
  if (
    Date.parse(now) < Date.parse(binding.acknowledgement.committedAt) ||
    Date.parse(now) >= Date.parse(binding.pending.confirmation.expiresAt)
  ) {
    fail(
      'E_LANDING_DISPATCH_CAPABILITY_EXPIRED',
      'Landing custody token is not current at the effect boundary.',
    );
  }
  planContext(plan);
  binding.consumed = true;
  return binding;
}

function receiptContext(plan) {
  const context = planContext(plan);
  return {
    plan: context.plan,
    shipReceipt: context.shipReceipt,
    shipProjection: context.shipProjection,
    operationRegistry: context.operationRegistry,
    baseRecords: context.baseRecords,
    activeSuccessor: context.closureInspection.activeSuccessor,
  };
}

function createLandingPhaseReceipt({
  body,
  plan,
  confirmation,
  evidenceRecords = [],
  evidenceContexts = {},
  events = [],
} = {}) {
  exactKeys(
    body,
    [
      'attemptIdentity',
      'authority',
      'canary',
      'completedAt',
      'confirmation',
      'containment',
      'effectClass',
      'evidenceHashes',
      'kind',
      'operateBinding',
      'operationId',
      'operationRegistrationHash',
      'phaseId',
      'planHash',
      'planId',
      'previousReceiptHash',
      'protocolVersion',
      'receiptId',
      'recovery',
      'requestHash',
      'runId',
      'schemaVersion',
      'startedAt',
      'status',
      'targetAfterHash',
      'targetBeforeHash',
    ],
    'landing phase receipt body',
  );
  const receipt = { ...clone(body), receiptHash: sha256Jcs(body) };
  return assertLandingPhaseReceipt(receipt, {
    ...receiptContext(plan),
    confirmation,
    evidenceRecords,
    evidenceContexts,
    events,
  });
}

function createLandingReceipt({
  body,
  plan,
  phaseReceipts = [],
  confirmations = [],
  evidenceRecordsByOperation = {},
  evidenceContextsByOperation = {},
  events = [],
} = {}) {
  exactKeys(
    body,
    [
      'authority',
      'candidateDigest',
      'candidateInventoryDigest',
      'completedAt',
      'journalHeadHash',
      'kind',
      'phaseReceipts',
      'planHash',
      'planId',
      'protocolVersion',
      'receiptId',
      'recovery',
      'residualStateHash',
      'runId',
      'schemaVersion',
      'shipClosure',
      'startedAt',
      'status',
      'targetHash',
      'trafficStateHash',
    ],
    'landing receipt body',
  );
  const receipt = { ...clone(body), receiptHash: sha256Jcs(body) };
  return assertLandingReceipt(receipt, {
    ...receiptContext(plan),
    phaseReceipts,
    confirmations,
    evidenceRecordsByOperation,
    evidenceContextsByOperation,
    events,
  });
}

function recordForRef(context, ref, label) {
  const matches = context.baseRecords.filter(
    (entry) => entry.kind === ref?.contractId && sha256Jcs(entry) === ref?.recordDigest,
  );
  if (matches.length !== 1)
    fail('E_LANDING_BASE_RECORD_MISMATCH', `${label} is not exact base-record custody.`);
  return matches[0];
}

function recoverySourceBinding(context, state, operation) {
  const source = context.plan.operations.find(
    ({ operationId }) => operationId === state.currentOperationId,
  );
  if (
    source === undefined ||
    source.recoveryClass === 'irreversible' ||
    !isRecoveryOperation(operation) ||
    !operation.dependsOn.includes(source.operationId)
  ) {
    fail(
      'E_LANDING_RECOVERY_INVALID',
      'Recovery requires a fresh operation bound to the exact non-irreversible failed phase.',
    );
  }
  const rollbackRef = operation.operateBindings.find(
    ({ contractId }) => contractId === 'operating-rollback-plan',
  );
  const rollbackPlan = recordForRef(context, rollbackRef, 'Landing recovery plan');
  const original = context.plan.operations.filter(
    (candidate) =>
      operation.dependsOn.includes(candidate.operationId) &&
      candidate.operateBindings.some(
        ({ contractId, recordId }) =>
          contractId === 'operating-governed-operation' && recordId === rollbackPlan.operationId,
      ),
  );
  if (
    original.length !== 1 ||
    original[0].recoveryClass === 'irreversible' ||
    !['eligible', 'required'].includes(rollbackPlan.eligibility)
  ) {
    fail(
      'E_LANDING_RECOVERY_INVALID',
      'Recovery changed the exact eligible rollback plan or its original operation.',
    );
  }
  return { source, original: original[0], rollbackPlan };
}

function rollbackPlanForFailedOperation(context, failedOperation) {
  const candidates = [
    failedOperation,
    ...context.plan.operations.filter(({ operationId }) =>
      failedOperation.dependsOn.includes(operationId),
    ),
  ];
  const governedIds = new Set(
    candidates.flatMap(({ operateBindings }) =>
      operateBindings
        .filter(({ contractId }) => contractId === 'operating-governed-operation')
        .map(({ recordId }) => recordId),
    ),
  );
  const plans = context.baseRecords.filter(
    (entry) =>
      entry.kind === 'operating-rollback-plan' &&
      governedIds.has(entry.operationId) &&
      ['eligible', 'required'].includes(entry.eligibility),
  );
  if (failedOperation.recoveryClass === 'irreversible' || plans.length !== 1) {
    fail(
      'E_LANDING_RECOVERY_INVALID',
      'Recovery-required state must bind one exact eligible rollback plan for the failed operation.',
    );
  }
  return plans[0];
}

function containmentPolicyFor(context, operation) {
  if (operation.containment !== null) return operation.containment;
  const dependencies = context.plan.operations.filter((candidate) =>
    operation.dependsOn.includes(candidate.operationId),
  );
  if (
    operation.kind !== 'canary' ||
    operation.dependsOn.length !== 1 ||
    dependencies.length !== 1 ||
    dependencies[0].kind !== 'deploy' ||
    dependencies[0].containment === null
  ) {
    fail(
      'E_LANDING_CONTAINMENT_REQUIRED',
      'Failed canary recovery requires one exact dependency deploy containment policy.',
    );
  }
  return dependencies[0].containment;
}

function assertRecoveryResultPolicy(context, operation, result) {
  const policy = containmentPolicyFor(context, operation);
  if (
    result.containment === null ||
    result.recovery === null ||
    result.containment.policyHash !== policy.policyHash ||
    result.containment.stopPromotion !== policy.stopPromotion ||
    result.containment.stopNewTraffic !== policy.stopNewTraffic ||
    result.containment.failedTargetIsolated !== policy.isolateFailedTarget ||
    result.containment.lastKnownGoodRetained !== policy.retainLastKnownGood ||
    result.containment.trafficStateHash !== policy.trafficStateHash ||
    result.containment.residualStateHash !== policy.residualStateHash ||
    result.recovery.trafficStateHash !== policy.trafficStateHash ||
    result.recovery.residualStateHash !== policy.residualStateHash ||
    result.recovery.expiresAt !== policy.expiresAt ||
    sha256Jcs(result.recovery.consequences) !== sha256Jcs(policy.consequences) ||
    sha256Jcs(result.recovery.choices) !== sha256Jcs(policy.recoveryChoices) ||
    result.recovery.defaultChoice !== null ||
    result.recovery.authority !== 'none'
  ) {
    fail(
      'E_LANDING_CONTAINMENT_REQUIRED',
      'Recovery result changed the exact frozen containment policy.',
    );
  }
}

function assertLandingDispatchResult({
  token,
  result,
  dispatchedAt,
  reconciliationDisposition = 'completed',
}) {
  const binding = token && typeof token === 'object' ? CUSTODY_COMMIT_TOKENS.get(token) : undefined;
  if (!binding?.consumed)
    fail(
      'E_LANDING_DISPATCH_RESULT_REQUIRED',
      'Landing result requires one consumed opaque dispatch token.',
    );
  exactKeys(
    result,
    [
      'canary',
      'completedAt',
      'containment',
      'evidenceContexts',
      'evidenceRecords',
      'recovery',
      'status',
      'targetAfterHash',
    ],
    'trusted landing dispatch result',
  );
  canonicalDate(result.completedAt, 'completedAt');
  if (
    !['succeeded', 'failed', 'blocked', 'uncertain', 'recovery_required'].includes(result.status) ||
    Date.parse(result.completedAt) < Date.parse(dispatchedAt) ||
    (result.targetAfterHash !== null && !HASH.test(result.targetAfterHash ?? '')) ||
    !Array.isArray(result.evidenceRecords) ||
    !result.evidenceContexts ||
    typeof result.evidenceContexts !== 'object' ||
    Array.isArray(result.evidenceContexts)
  ) {
    fail(
      'E_LANDING_DISPATCH_RESULT_INVALID',
      'Trusted landing dispatch result has invalid status, target, time, or evidence custody.',
    );
  }
  const operation = binding.pending.operation;
  if (!['completed', 'not-started', 'unknown'].includes(reconciliationDisposition)) {
    fail('E_LANDING_DISPATCH_RESULT_INVALID', 'Landing reconciliation disposition is not closed.');
  }
  if (
    reconciliationDisposition !== 'completed' &&
    (result.status !== (reconciliationDisposition === 'not-started' ? 'blocked' : 'uncertain') ||
      result.targetAfterHash !== null ||
      result.evidenceRecords.length !== 0 ||
      Object.keys(result.evidenceContexts).length !== 0 ||
      result.canary !== null ||
      result.containment !== null ||
      result.recovery !== null)
  ) {
    fail(
      'E_LANDING_DISPATCH_RESULT_INVALID',
      'A no-effect reconciliation disposition may only produce its exact empty blocked or uncertain outcome.',
    );
  }
  if (result.status === 'succeeded' && result.targetAfterHash === null) {
    fail(
      'E_LANDING_DISPATCH_RESULT_INVALID',
      'Successful dispatch requires the exact resulting target hash.',
    );
  }
  if (
    reconciliationDisposition === 'completed' &&
    ['deploy', 'canary'].includes(operation.kind) &&
    result.status !== 'succeeded'
  ) {
    if (result.status !== 'recovery_required') {
      fail(
        'E_LANDING_CONTAINMENT_REQUIRED',
        'A non-passing deploy or canary must contain and enter recovery_required.',
      );
    }
    assertRecoveryResultPolicy(receiptContext(binding.pending.plan), operation, result);
  } else if (result.status === 'recovery_required') {
    fail(
      'E_LANDING_RECOVERY_INVALID',
      'Only a contained deploy or canary may enter recovery_required.',
    );
  } else if (result.containment !== null || result.recovery !== null) {
    fail(
      'E_LANDING_RECOVERY_INVALID',
      'Ordinary or successful dispatch cannot claim containment or recovery custody.',
    );
  }
  if (reconciliationDisposition === 'completed' && ['canary', 'verify'].includes(operation.kind)) {
    if (
      result.canary === null ||
      (result.status === 'succeeded' && result.canary.status !== 'passed') ||
      (result.status !== 'succeeded' && result.canary.status === 'passed')
    ) {
      fail(
        'E_LANDING_FALSE_PASS',
        'Canary dispatch status must come from one exact evidence evaluation.',
      );
    }
  } else if (reconciliationDisposition === 'completed' && result.canary !== null) {
    fail('E_LANDING_FALSE_PASS', 'A non-canary operation cannot claim canary evidence.');
  }
  const resultToken = Object.freeze({
    kind: 'landing-dispatch-result-token',
    schemaVersion: '1.0.0',
    tokenId: `ldrt_${randomUUID().replaceAll('-', '')}`,
  });
  DISPATCH_RESULT_TOKENS.set(resultToken, {
    binding,
    result: freeze(clone(result)),
    reconciliationDisposition,
  });
  return resultToken;
}

function createOutcomeEvents({ resultToken, snapshot }) {
  const resultBinding =
    resultToken && typeof resultToken === 'object'
      ? DISPATCH_RESULT_TOKENS.get(resultToken)
      : undefined;
  if (resultBinding === undefined)
    fail(
      'E_LANDING_DISPATCH_RESULT_REQUIRED',
      'Landing Events require the original opaque dispatch result.',
    );
  const { binding, result } = resultBinding;
  const { advance, pending, acknowledgement } = binding;
  const confirmationHash = pending.confirmation.confirmationHash;
  const events = [];
  let sequence = snapshot.journalHead.sequence;
  let previousEventHash = snapshot.journalHead.hash;
  const append = (fields) => {
    const event = createLandingEvent({
      runId: advance.runId,
      sequence: ++sequence,
      planHash: advance.planHash,
      requestHash: advance.requestHash,
      operationId: Object.hasOwn(fields, 'operationId') ? fields.operationId : advance.operationId,
      confirmationHash:
        fields.confirmationHash === undefined ? confirmationHash : fields.confirmationHash,
      targetStateHash: fields.targetStateHash,
      trafficStateHash: fields.trafficStateHash ?? null,
      residualStateHash: fields.residualStateHash ?? null,
      previousEventHash,
      timestamp: fields.timestamp,
      type: fields.type,
      fromState: fields.fromState,
      toState: fields.toState,
      actor: fields.actor,
    });
    previousEventHash = event.eventHash;
    events.push(event);
    return event;
  };
  append({
    type: 'phase.dispatching',
    fromState: 'intent-recorded',
    toState: 'dispatching',
    actor: { kind: 'runtime', id: acknowledgement.dispatcherId },
    targetStateHash: advance.currentTargetHash,
    timestamp: acknowledgement.committedAt,
  });
  const targetAfterHash = result.targetAfterHash ?? advance.currentTargetHash;
  const recoveryOperation = isRecoveryOperation(pending.operation);
  if (result.status === 'recovery_required') {
    append({
      type: 'containment.applied',
      fromState: 'dispatching',
      toState: 'recovery_required',
      actor: { kind: 'runtime', id: acknowledgement.dispatcherId },
      targetStateHash: targetAfterHash,
      trafficStateHash: result.containment.trafficStateHash,
      residualStateHash: result.containment.residualStateHash,
      timestamp: result.completedAt,
    });
    append({
      type: 'recovery.required',
      fromState: 'recovery_required',
      toState: 'recovery_required',
      actor: { kind: 'runtime', id: acknowledgement.dispatcherId },
      confirmationHash: null,
      targetStateHash: targetAfterHash,
      trafficStateHash: result.recovery.trafficStateHash,
      residualStateHash: result.recovery.residualStateHash,
      timestamp: result.completedAt,
    });
  } else {
    const type =
      result.status === 'succeeded'
        ? recoveryOperation
          ? 'recovery.succeeded'
          : 'phase.succeeded'
        : result.status === 'failed'
          ? recoveryOperation
            ? 'recovery.failed'
            : 'phase.failed'
          : result.status === 'blocked'
            ? 'phase.blocked'
            : 'phase.uncertain';
    const toState =
      result.status === 'succeeded'
        ? 'awaiting-confirmation'
        : ['failed', 'blocked'].includes(result.status)
          ? 'blocked'
          : 'uncertain';
    const recoveryIntent = advance.eventsToPersist.at(-1);
    append({
      type,
      fromState: 'dispatching',
      toState,
      actor: { kind: 'runtime', id: acknowledgement.dispatcherId },
      targetStateHash: targetAfterHash,
      trafficStateHash: recoveryOperation ? recoveryIntent.trafficStateHash : null,
      residualStateHash: recoveryOperation ? recoveryIntent.residualStateHash : null,
      timestamp: result.completedAt,
    });
    if (result.status === 'succeeded') {
      const completed = new Set([...snapshot.state.completedOperationIds, advance.operationId]);
      const ordinaryComplete = pending.plan.operations
        .filter((operation) => !isRecoveryOperation(operation))
        .every(({ operationId }) => completed.has(operationId));
      if (ordinaryComplete || recoveryOperation) {
        append({
          type: recoveryOperation ? 'landing.blocked' : 'landing.completed',
          fromState: 'awaiting-confirmation',
          toState: recoveryOperation ? 'blocked' : 'completed',
          actor: { kind: 'engine', id: 'planr-pipeline' },
          operationId: null,
          confirmationHash: null,
          targetStateHash: targetAfterHash,
          timestamp: result.completedAt,
        });
      }
    }
  }
  return freeze(events);
}

function primaryOperateBinding(operation) {
  const kind = ['canary', 'verify'].includes(operation.kind)
    ? 'operating-action-verification-plan'
    : isRecoveryOperation(operation)
      ? 'operating-rollback-plan'
      : 'operating-governed-operation';
  return clone(operation.operateBindings.find(({ contractId }) => contractId === kind) ?? null);
}

function deriveLandingPhaseFromResult({ resultToken, snapshot, events }) {
  const resultBinding =
    resultToken && typeof resultToken === 'object'
      ? DISPATCH_RESULT_TOKENS.get(resultToken)
      : undefined;
  if (resultBinding === undefined)
    fail(
      'E_LANDING_DISPATCH_RESULT_REQUIRED',
      'Landing receipt requires the original opaque dispatch result.',
    );
  const { binding, result } = resultBinding;
  const { pending, advance, acknowledgement } = binding;
  const intent = advance.eventsToPersist.at(-1);
  const receiptSeed = sha256Jcs({
    requestHash: advance.requestHash,
    outcomeEventHash: events.at(-1).eventHash,
  });
  const body = {
    kind: 'landing-phase-receipt',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    receiptId: `lprc_${receiptSeed.slice('sha256:'.length, 'sha256:'.length + 32)}`,
    runId: advance.runId,
    planId: pending.plan.planId,
    planHash: pending.plan.planHash,
    phaseId: pending.operation.kind,
    operationId: pending.operation.operationId,
    operationRegistrationHash: pending.operation.registrationHash,
    status: result.status,
    effectClass: pending.operation.effectClass,
    authority: 'consumed-runtime-capability',
    requestHash: advance.requestHash,
    attemptIdentity: advance.attemptIdentity,
    confirmation: {
      confirmationId: pending.confirmation.confirmationId,
      confirmationHash: pending.confirmation.confirmationHash,
      opaqueCapabilityHash: pending.confirmation.opaqueCapabilityHash,
      consumedAt: acknowledgement.committedAt,
    },
    targetBeforeHash: advance.currentTargetHash,
    targetAfterHash: result.targetAfterHash,
    evidenceHashes: result.evidenceRecords.map(sha256Jcs).sort(),
    canary: clone(result.canary),
    containment: clone(result.containment),
    recovery: clone(result.recovery),
    operateBinding: primaryOperateBinding(pending.operation),
    previousReceiptHash: snapshot.phaseReceiptHeadHash,
    startedAt: intent.timestamp,
    completedAt: result.completedAt,
  };
  return createLandingPhaseReceipt({
    body,
    plan: pending.plan,
    confirmation: pending.confirmation,
    evidenceRecords: result.evidenceRecords,
    evidenceContexts: result.evidenceContexts,
    events: [...snapshot.events, ...events],
  });
}

function deriveTerminalLandingReceipt({ resultToken, snapshot, events, phaseReceipt }) {
  const resultBinding =
    resultToken && typeof resultToken === 'object'
      ? DISPATCH_RESULT_TOKENS.get(resultToken)
      : undefined;
  if (resultBinding === undefined)
    fail(
      'E_LANDING_DISPATCH_RESULT_REQUIRED',
      'Landing receipt requires the original opaque dispatch result.',
    );
  const { binding, result } = resultBinding;
  const { pending, advance } = binding;
  const journal = reduceLandingEvents([...snapshot.events, ...events]);
  if (!['completed', 'blocked', 'uncertain', 'recovery_required'].includes(journal.state))
    return null;
  const phaseReceipts = [...snapshot.phaseReceipts, phaseReceipt];
  const confirmations = [...snapshot.confirmations, pending.confirmation];
  const evidenceRecordsByOperation = {
    ...clone(snapshot.evidenceRecordsByOperation),
    [advance.operationId]: clone(result.evidenceRecords),
  };
  const evidenceContextsByOperation = {
    ...clone(snapshot.evidenceContextsByOperation),
    [advance.operationId]: clone(result.evidenceContexts),
  };
  let recoveryPlanHash = null;
  let recoveryResultHash = null;
  let recoveryChoices = [];
  let trafficStateHash = null;
  let residualStateHash = null;
  if (journal.state === 'recovery_required') {
    const rollbackPlan = rollbackPlanForFailedOperation(
      receiptContext(pending.plan),
      pending.operation,
    );
    recoveryPlanHash = rollbackPlan.planHash;
    recoveryChoices = clone(result.recovery.choices);
    trafficStateHash = result.recovery.trafficStateHash;
    residualStateHash = result.recovery.residualStateHash;
  } else if (isRecoveryOperation(pending.operation)) {
    const planRef = pending.operation.operateBindings.find(
      ({ contractId }) => contractId === 'operating-rollback-plan',
    );
    const resultRef = pending.operation.operateBindings.find(
      ({ contractId }) => contractId === 'operating-rollback-result',
    );
    recoveryPlanHash = recordForRef(
      receiptContext(pending.plan),
      planRef,
      'Terminal recovery plan',
    ).planHash;
    recoveryResultHash = recordForRef(
      receiptContext(pending.plan),
      resultRef,
      'Terminal recovery result',
    ).resultHash;
    const recoveryIntent = advance.eventsToPersist.at(-1);
    trafficStateHash = recoveryIntent.trafficStateHash;
    residualStateHash = recoveryIntent.residualStateHash;
  }
  const status = journal.state === 'completed' ? 'landed' : journal.state;
  const body = {
    kind: 'landing-receipt',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    receiptId: `lrcp_${sha256Jcs({
      planHash: pending.plan.planHash,
      journalHeadHash: journal.eventHead.hash,
    }).slice('sha256:'.length, 'sha256:'.length + 32)}`,
    runId: advance.runId,
    authority: 'none',
    shipClosure: clone(pending.plan.shipClosure),
    planId: pending.plan.planId,
    planHash: pending.plan.planHash,
    candidateDigest: pending.plan.candidateDigest,
    candidateInventoryDigest: pending.plan.candidateInventoryDigest,
    status,
    phaseReceipts: phaseReceipts.map((entry) => ({
      receiptId: entry.receiptId,
      receiptHash: entry.receiptHash,
      operationId: entry.operationId,
      status: entry.status,
    })),
    journalHeadHash: journal.eventHead.hash,
    targetHash: journal.targetStateHash,
    trafficStateHash,
    residualStateHash,
    recovery: {
      required: journal.state === 'recovery_required',
      authority: 'none',
      planHash: recoveryPlanHash,
      resultHash: recoveryResultHash,
      choices: recoveryChoices,
      defaultChoice: null,
    },
    startedAt: snapshot.startedAt ?? pending.confirmation.issuedAt,
    completedAt: result.completedAt,
  };
  return createLandingReceipt({
    body,
    plan: pending.plan,
    phaseReceipts,
    confirmations,
    evidenceRecordsByOperation,
    evidenceContextsByOperation,
    events: [...snapshot.events, ...events],
  });
}

async function commitLandingOutcome({
  host,
  token,
  resultToken,
  events,
  phaseReceipt,
  landingReceipt,
}) {
  const runtime = runtimeHostFor(host);
  const binding = CUSTODY_COMMIT_TOKENS.get(token);
  const dispatched =
    resultToken && typeof resultToken === 'object'
      ? DISPATCH_RESULT_TOKENS.get(resultToken)
      : undefined;
  if (!binding?.consumed || dispatched?.binding !== binding) {
    fail(
      'E_LANDING_DISPATCH_RESULT_REQUIRED',
      'Landing outcome commit requires the consumed opaque custody and result tokens.',
    );
  }
  let acknowledgement;
  try {
    acknowledgement = await runtime.commitOutcome(
      freeze({
        kind: 'landing-outcome-cas',
        schemaVersion: '1.0.0',
        custodyCommitToken: token,
        commitId: binding.acknowledgement.commitId,
        dispatcherId: binding.acknowledgement.dispatcherId,
        expectedJournalHead: clone(binding.acknowledgement.journalHead),
        events: clone(events),
        phaseReceipt: clone(phaseReceipt),
        confirmation: clone(binding.pending.confirmation),
        evidenceRecords: clone(dispatched.result.evidenceRecords),
        evidenceContexts: clone(dispatched.result.evidenceContexts),
        landingReceipt: landingReceipt === null ? null : clone(landingReceipt),
      }),
    );
  } catch {
    fail(
      'E_LANDING_OUTCOME_NOT_PERSISTED',
      'Landing effect completed but its outcome CAS was not durably acknowledged; reconciliation is required and redispatch is forbidden.',
    );
  }
  exactKeys(
    acknowledgement,
    ['commitId', 'committedAt', 'journalHead', 'landingReceiptHash', 'phaseReceiptHash'],
    'landing outcome custody acknowledgement',
  );
  canonicalDate(acknowledgement.committedAt, 'outcome committedAt');
  exactKeys(acknowledgement.journalHead, ['hash', 'sequence'], 'landing outcome journal head');
  if (
    acknowledgement.commitId !== binding.acknowledgement.commitId ||
    acknowledgement.journalHead.hash !== events.at(-1).eventHash ||
    acknowledgement.journalHead.sequence !== events.at(-1).sequence ||
    acknowledgement.phaseReceiptHash !== phaseReceipt.receiptHash ||
    acknowledgement.landingReceiptHash !== (landingReceipt?.receiptHash ?? null)
  ) {
    fail(
      'E_LANDING_OUTCOME_NOT_PERSISTED',
      'Landing outcome acknowledgement changed the exact CAS journal or receipt custody.',
    );
  }
  return freeze(clone(acknowledgement));
}

function replayStoredLanding({ plan, snapshot, expectedAttemptIdentity = null }) {
  const phaseReceipt = snapshot.phaseReceipts.at(-1) ?? null;
  if (
    snapshot.landingReceipt === null ||
    phaseReceipt === null ||
    (expectedAttemptIdentity !== null && phaseReceipt.attemptIdentity !== expectedAttemptIdentity)
  ) {
    fail(
      'E_LANDING_OUTCOME_NOT_PERSISTED',
      'Landing has no exact stored terminal receipt for this committed attempt.',
    );
  }
  return freeze({
    ok: true,
    operation: 'landing.advance',
    authority: 'none',
    effectAuthorized: false,
    replayed: true,
    dispatcherId: snapshot.pendingIntent?.dispatcherId ?? null,
    planId: plan.planId,
    planHash: plan.planHash,
    operationId: phaseReceipt.operationId,
    requestHash: phaseReceipt.requestHash,
    state: snapshot.state.state,
    journalHead: clone(snapshot.state.eventHead),
    phaseReceipt,
    landingReceipt: snapshot.landingReceipt,
    custodyAcknowledgement: null,
    nextAction: snapshot.state.state === 'recovery_required' ? 'ownerRecoveryRequired' : 'none',
  });
}

function landingRuntimeRequest({
  kind,
  token,
  acknowledgement,
  plan,
  operation,
  requestHash,
  targetStateHash,
  reason,
}) {
  const request = {
    kind,
    schemaVersion: '1.0.0',
    custodyCommitToken: token,
    commitId: acknowledgement.commitId,
    dispatcherId: acknowledgement.dispatcherId,
    planHash: plan.planHash,
    operation: clone(operation),
    requestHash,
    currentTargetHash: targetStateHash,
  };
  if (reason !== undefined) request.reason = reason;
  return freeze(request);
}

function normalizeLandingReconciliation(value) {
  if (value && typeof value === 'object' && Object.hasOwn(value, 'disposition')) {
    exactKeys(
      value,
      ['completedAt', 'disposition', 'targetAfterHash'],
      'closed landing reconciliation',
    );
    canonicalDate(value.completedAt, 'reconciliation completedAt');
    if (!['not-started', 'unknown'].includes(value.disposition) || value.targetAfterHash !== null) {
      fail(
        'E_LANDING_DISPATCH_RESULT_INVALID',
        'Closed landing reconciliation must be not-started or unknown with no claimed target.',
      );
    }
    return {
      reconciliationDisposition: value.disposition,
      result: freeze({
        status: value.disposition === 'not-started' ? 'blocked' : 'uncertain',
        targetAfterHash: null,
        completedAt: value.completedAt,
        evidenceRecords: [],
        evidenceContexts: {},
        canary: null,
        containment: null,
        recovery: null,
      }),
    };
  }
  return { reconciliationDisposition: 'completed', result: value };
}

async function settleLandingResult({
  host,
  plan,
  operationId,
  token,
  acknowledgement,
  snapshot,
  result,
  reconciliationDisposition = 'completed',
}) {
  const binding = CUSTODY_COMMIT_TOKENS.get(token);
  const resultToken = assertLandingDispatchResult({
    token,
    result,
    dispatchedAt: acknowledgement.committedAt,
    reconciliationDisposition,
  });
  const outcomeEvents = createOutcomeEvents({ resultToken, snapshot });
  const phaseReceipt = deriveLandingPhaseFromResult({
    resultToken,
    snapshot,
    events: outcomeEvents,
  });
  const landingReceipt = deriveTerminalLandingReceipt({
    resultToken,
    snapshot,
    events: outcomeEvents,
    phaseReceipt,
  });
  let custodyAcknowledgement;
  try {
    custodyAcknowledgement = await commitLandingOutcome({
      host,
      token,
      resultToken,
      events: outcomeEvents,
      phaseReceipt,
      landingReceipt,
    });
  } catch (cause) {
    if (cause?.code === 'E_LANDING_OUTCOME_NOT_PERSISTED') {
      const recaptured = await captureTrustedLandingSnapshot({ host, plan });
      if (recaptured.landingReceipt !== null) {
        return replayStoredLanding({
          plan,
          snapshot: recaptured,
          expectedAttemptIdentity: binding.advance.attemptIdentity,
        });
      }
    }
    throw cause;
  }
  const journal = reduceLandingEvents([...snapshot.events, ...outcomeEvents]);
  return freeze({
    ok: true,
    operation: 'landing.advance',
    authority: 'none',
    effectAuthorized: false,
    dispatcherId: acknowledgement.dispatcherId,
    planId: plan.planId,
    planHash: plan.planHash,
    operationId,
    requestHash: binding.advance.requestHash,
    state: journal.state,
    journalHead: clone(journal.eventHead),
    phaseReceipt,
    landingReceipt,
    custodyAcknowledgement,
    nextAction:
      journal.state === 'recovery_required'
        ? 'ownerRecoveryRequired'
        : ['completed', 'blocked', 'uncertain'].includes(journal.state)
          ? 'none'
          : 'ownerActionRequired',
  });
}

async function resumeLanding({ host, plan, operationId, snapshot }) {
  const restored = restoreLandingCustodyCommit({ host, plan, operationId, snapshot });
  const runtime = runtimeHostFor(host);
  const request = landingRuntimeRequest({
    kind: 'landing-reconcile-request',
    token: restored.token,
    acknowledgement: restored.acknowledgement,
    plan,
    operation: restored.operation,
    requestHash: restored.advance.requestHash,
    targetStateHash: snapshot.targetStateHash,
    reason: 'durable-intent-resume',
  });
  let result;
  try {
    result = await runtime.reconcile(request);
  } catch {
    fail(
      'E_LANDING_RECONCILIATION_PENDING',
      'Landing reconciliation is unavailable; the durable intent remains resumable and effect redispatch is forbidden.',
    );
  }
  const reconciled = normalizeLandingReconciliation(result);
  return settleLandingResult({
    host,
    plan,
    operationId,
    token: restored.token,
    acknowledgement: restored.acknowledgement,
    snapshot,
    result: reconciled.result,
    reconciliationDisposition: reconciled.reconciliationDisposition,
  });
}

export async function advanceLanding({ host, plan, operationId, now } = {}) {
  runtimeHostFor(host);
  canonicalDate(now, 'now');
  const context = planContext(plan);
  const snapshot = await captureTrustedLandingSnapshot({ host, plan });
  if (['completed', 'blocked', 'uncertain'].includes(snapshot.state.state)) {
    return replayStoredLanding({ plan, snapshot });
  }
  if (snapshot.state.state === 'intent-recorded') {
    return resumeLanding({ host, plan, operationId, snapshot });
  }
  const status = landingStatus({ plan, events: snapshot.events });
  if (status.readyOperationIds.length !== 1 || status.readyOperationIds[0] !== operationId) {
    fail(
      'E_LANDING_TRANSITION_INVALID',
      'Landing advance must select the one canonical topological operation.',
    );
  }
  const operation = operationFor(context.plan, operationId);
  const recovery = isRecoveryOperation(operation);
  let recoveryState = { trafficStateHash: null, residualStateHash: null };
  if (recovery) {
    recoverySourceBinding(context, snapshot.state, operation);
    const recoveryEvent = [...snapshot.events]
      .reverse()
      .find(({ type }) => type === 'recovery.required');
    if (recoveryEvent === undefined)
      fail(
        'E_LANDING_RECOVERY_INVALID',
        'Recovery requires the exact durable recovery-required Event.',
      );
    recoveryState = {
      trafficStateHash: recoveryEvent.trafficStateHash,
      residualStateHash: recoveryEvent.residualStateHash,
    };
  }
  const expiresAt = new Date(
    Math.min(Date.parse(context.plan.expiresAt), Date.parse(now) + 15 * 60 * 1000),
  ).toISOString();
  const owner = await issueLandingOwnerConfirmation({
    host,
    plan,
    operationId,
    currentTargetHash: snapshot.targetStateHash,
    issuedAt: now,
    expiresAt,
  });
  if (owner.status === 'cancelled') return owner;
  const runId = snapshot.state.runId ?? `lrun_${randomUUID().replaceAll('-', '')}`;
  const advance = prepareLandingAdvanceIntent({
    plan,
    operationId,
    confirmation: owner.confirmation,
    capability: owner.capability,
    runId,
    events: snapshot.events,
    now,
    trafficStateHash: recoveryState.trafficStateHash,
    residualStateHash: recoveryState.residualStateHash,
  });
  const token = await commitLandingIntent({ host, advance, snapshot });
  const committed = CUSTODY_COMMIT_TOKENS.get(token);
  const recaptured = await captureTrustedLandingSnapshot({ host, plan });
  const expectedEvents = [...snapshot.events, ...advance.eventsToPersist];
  if (
    sha256Jcs(recaptured.events) !== sha256Jcs(expectedEvents) ||
    recaptured.journalHead.hash !== advance.intentEventHash ||
    recaptured.targetStateHash !== snapshot.targetStateHash
  ) {
    fail(
      'E_LANDING_CONCURRENT_MODIFICATION',
      'Landing target or durable journal changed after intent commit and before dispatch.',
    );
  }
  planContext(plan);
  consumeLandingCustodyCommit({
    token,
    plan,
    operationId,
    requestHash: advance.requestHash,
    targetStateHash: recaptured.targetStateHash,
    now: committed.acknowledgement.committedAt,
  });
  const runtime = runtimeHostFor(host);
  const dispatchRequest = landingRuntimeRequest({
    kind: 'landing-dispatch-request',
    token,
    acknowledgement: committed.acknowledgement,
    plan,
    operation,
    requestHash: advance.requestHash,
    targetStateHash: recaptured.targetStateHash,
  });
  let result;
  let reconciliationDisposition = 'completed';
  try {
    result = await runtime.dispatch(dispatchRequest);
  } catch {
    let reconciliation;
    try {
      reconciliation = await runtime.reconcile(
        landingRuntimeRequest({
          kind: 'landing-reconcile-request',
          token,
          acknowledgement: committed.acknowledgement,
          plan,
          operation,
          requestHash: advance.requestHash,
          targetStateHash: recaptured.targetStateHash,
          reason: 'dispatch-acknowledgement-lost',
        }),
      );
    } catch {
      fail(
        'E_LANDING_RECONCILIATION_PENDING',
        'Landing reconciliation is unavailable; the durable intent remains resumable and effect redispatch is forbidden.',
      );
    }
    const reconciled = normalizeLandingReconciliation(reconciliation);
    result = reconciled.result;
    reconciliationDisposition = reconciled.reconciliationDisposition;
  }
  return settleLandingResult({
    host,
    plan,
    operationId,
    token,
    acknowledgement: committed.acknowledgement,
    snapshot: recaptured,
    result,
    reconciliationDisposition,
  });
}
