import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { join, relative } from 'node:path';

import { sha256Jcs } from '../protocol/jcs.mjs';
import {
  assertBrowserQaGateRecord,
  assertBrowserQaRecordedEventAuthority,
} from './browser-qa.mjs';
import { PipelineError } from './errors.mjs';
import { projectPipelineOperatingOriginCorrelation } from './operate-origin.mjs';
import { assertShipRiskClassification, classifyShipRisk } from './ship-risk.mjs';
import {
  assertPreserve,
  captureCandidate,
  containedPath,
  filesystemIdentity,
  normalizeRepositories,
  normalizeRepositoryPath,
  repositoryMap,
  taskRepositoryPath,
} from './ship-closure-identity.mjs';
import {
  assertRegularCustodyFile,
  assertPathCustody,
  closurePaths,
  ensureClosureDirs,
  withLock,
  writeJson,
} from './ship-closure-persistence.mjs';
import { projectShipCompatibility, verifyShipCompatibilityProjection } from './ship-closure-projections.mjs';
import {
  assertClosure,
  assertShipReceiptLineage,
  blockingFindings,
  currentCandidate,
  phaseEvidence,
  recordShipGateEvidence,
  reduceShipClosure,
  terminalizeShipClosure,
  validateEvent,
} from './ship-closure-reducer.mjs';

const REVIEW_PHASE_STATE = Object.freeze({
  initial: 'reviewing_initial',
  targeted: 'reviewing_targeted',
  final: 'ready_for_final',
});
const LANDING_INSPECTIONS = new WeakMap();

function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}

function digestBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function posix(value) {
  return value.split('\\').join('/');
}

function exactKeys(value, expected, subject) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('E_SHIP_GATE_INVALID', `${subject} must be a closed JSON object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail('E_SHIP_GATE_INVALID', `${subject} fields must be exactly: ${wanted.join(', ')}.`);
}

function addFrozenBrowserGate(gates, repositories, riskClassification) {
  if (!riskClassification?.browserQa.required) return gates;
  if (gates.some(({ id }) => id === 'browser-qa')) fail('E_SHIP_GATE_INVALID', 'The classifier-owned browser-qa gate ID is already declared.');
  const finalIndex = gates.findIndex(({ finalRelevantSuite }) => finalRelevantSuite);
  if (finalIndex < 0 || !repositories.some(({ repositoryKey }) => repositoryKey === 'project')) {
    fail('E_SHIP_GATE_INVALID', 'Mandatory browser QA requires the project repository and one final relevant suite.');
  }
  const next = clone(gates);
  const previousDependencies = [...next[finalIndex].dependsOn];
  next[finalIndex] = { ...next[finalIndex], dependsOn: ['browser-qa'] };
  next.push({
    id: 'browser-qa', repositoryKey: 'project', argv: ['@planr/browser-qa'],
    inputs: [{ repositoryKey: 'project', path: '.' }], dependsOn: previousDependencies,
    finalRelevantSuite: false, gateType: 'browser-qa',
  });
  return normalizeGates(next, repositories);
}

function readClosure(path, { prepared = undefined, expectedRunId = undefined, expectedRecordType = undefined } = {}) {
  let value;
  try {
    assertRegularCustodyFile(path);
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail('E_SHIP_CLOSURE_INVALID', `Could not read closure ${path}: ${error.message}`);
  }
  const closure = assertClosure(value);
  const filenameRunId = path.split(/[\\/]/).at(-1)?.replace(/\.json$/, '');
  const runId = expectedRunId ?? filenameRunId;
  if (closure.runId !== runId) fail('E_SHIP_STORAGE_CONTEXT_INVALID', `Closure ${path} contains run ${closure.runId}, expected ${runId}.`);
  if (expectedRecordType && closure.recordType !== expectedRecordType) fail('E_SHIP_STORAGE_CONTEXT_INVALID', `Closure ${path} has record type ${closure.recordType}, expected ${expectedRecordType}.`);
  if (prepared) {
    const expectedFeatureRoot = posix(relative(prepared.projectRoot, prepared.root));
    if (closure.feature !== prepared.slug || closure.mode !== prepared.mode || closure.approvedScope.featureRoot !== expectedFeatureRoot) {
      fail('E_SHIP_STORAGE_CONTEXT_INVALID', `Closure ${path} does not belong to prepared feature ${prepared.slug}.`);
    }
    if (closure.recordType === 'active' && prepared.closureRepositories) {
      const trustedRoots = new Map(prepared.closureRepositories.map(({ repositoryKey, root }) => [repositoryKey, root]));
      if (closure.repositories.length !== trustedRoots.size
        || closure.repositories.some(({ repositoryKey, root }) => trustedRoots.get(repositoryKey) !== root)) {
        fail('E_SHIP_STORAGE_CONTEXT_INVALID', `Active closure ${path} substituted repository root custody.`);
      }
    }
  }
  return closure;
}

function activeRuns(featureRoot) {
  const dir = join(featureRoot, '.ship', 'active');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort().flatMap((name) => {
    const activePath = join(dir, name);
    const receiptPath = join(featureRoot, '.ship', 'receipts', name);
    if (!existsSync(receiptPath)) return [name];
    const runId = name.replace(/\.json$/, '');
    const active = readClosure(activePath, { expectedRunId: runId, expectedRecordType: 'active' });
    const receipt = readClosure(receiptPath, { expectedRunId: runId, expectedRecordType: 'receipt' });
    if (!receiptExtendsActive(receipt, active)) fail('E_SHIP_CLOSURE_DIVERGED', `Active and terminal custody diverge for ${name}.`);
    unlinkSync(activePath);
    return [];
  });
}

function terminalReceipts(prepared) {
  const dir = join(prepared.root, '.ship', 'receipts');
  if (!existsSync(dir)) return [];
  const receipts = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => readClosure(join(dir, name), {
      prepared,
      expectedRunId: name.replace(/\.json$/, ''),
      expectedRecordType: 'receipt',
    }));
  return assertShipReceiptLineage(receipts);
}

function startCustodyIdentity(state) {
  return {
    runId: state.runId,
    feature: state.feature,
    mode: state.mode,
    runtime: state.runtime,
    approvedScope: state.approvedScope,
    tasks: state.tasks.map(({ id, storyId, path, dependsOn, preserve }) => ({ id, storyId, path, dependsOn, preserve })),
    repositories: state.repositories.map(({ root: _root, ...repository }) => repository),
    reviewerRoster: state.reviewerRoster,
    rosterDigest: state.rosterDigest,
    gates: state.gates,
    gateSetDigest: state.gateSetDigest,
    startedFromReceiptHash: state.startedFromReceiptHash,
    reopenReason: state.reopenReason,
    planningReview: state.planningReview ?? null,
    riskClassification: state.riskClassification ?? null,
    operatingOriginCorrelation: state.operatingOriginCorrelation,
  };
}

function sameStartCustody(existing, requested) {
  return sha256Jcs(startCustodyIdentity(existing)) === sha256Jcs(startCustodyIdentity(requested));
}

function assertReopenGateInputExpansion(priorGates, successorGates) {
  if (successorGates.length !== priorGates.length) {
    fail('E_SHIP_REOPEN_CUSTODY_INVALID', 'Reopen must preserve the exact prior gate set; only bounded input expansion is allowed.');
  }
  for (let index = 0; index < priorGates.length; index += 1) {
    const { inputs: priorInputs, ...priorAuthority } = priorGates[index];
    const { inputs: successorInputs, ...successorAuthority } = successorGates[index];
    if (sha256Jcs(successorAuthority) !== sha256Jcs(priorAuthority)) {
      fail('E_SHIP_REOPEN_CUSTODY_INVALID', `Reopen changed frozen authority for gate ${priorGates[index].id}; only bounded input expansion is allowed.`);
    }
    const successorInputKeys = new Set(successorInputs.map((input) => sha256Jcs(input)));
    if (priorInputs.some((input) => !successorInputKeys.has(sha256Jcs(input)))) {
      fail('E_SHIP_REOPEN_CUSTODY_INVALID', `Reopen narrowed bounded inputs for gate ${priorGates[index].id}.`);
    }
  }
}

function receiptExtendsActive(receipt, active) {
  if (receipt.recordType !== 'receipt' || active.recordType !== 'active' || receipt.runId !== active.runId) return false;
  const fields = [
    'kind', 'schemaVersion', 'protocolVersion', 'runId', 'feature', 'mode', 'runtime', 'createdAt',
    'approvedScope', 'tasks', 'reviewerRoster', 'rosterDigest', 'gates', 'gateSetDigest',
    'candidateRevisions', 'reviews', 'gateEvidence', 'correctionImpact', 'startedFromReceiptHash', 'reopenReason', 'planningReview', 'riskClassification', 'browserQaRecords', 'operatingOriginCorrelation',
  ];
  if (fields.some((field) => sha256Jcs(receipt[field] ?? null) !== sha256Jcs(active[field] ?? null))) return false;
  if (receipt.generation <= active.generation || receipt.events.length <= active.events.length) return false;
  return sha256Jcs(receipt.events.slice(0, active.events.length)) === sha256Jcs(active.events);
}

function parseArgvChain(command, field) {
  const chains = [];
  let argv = [];
  let token = '';
  let quote = null;
  const pushToken = () => { if (token) { argv.push(token); token = ''; } };
  const pushCommand = () => {
    pushToken();
    if (!argv.length) fail('E_SHIP_GATE_INVALID', `${field} contains an empty command segment.`);
    chains.push(argv);
    argv = [];
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && index + 1 < command.length) token += command[++index];
      else token += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '&' && command[index + 1] === '&') { pushCommand(); index += 1; continue; }
    if (/\s/.test(char)) { pushToken(); continue; }
    if (';|<>`'.includes(char) || (char === '$' && command[index + 1] === '(')) {
      fail('E_SHIP_GATE_INVALID', `${field} contains shell-only syntax; frozen gates execute argv without a shell.`);
    }
    token += char;
  }
  if (quote) fail('E_SHIP_GATE_INVALID', `${field} contains an unterminated quote.`);
  pushCommand();
  return chains;
}

function stackCommands(projectRoot) {
  const path = containedPath(projectRoot, 'input/tech/stack.md');
  if (!existsSync(path)) fail('E_SHIP_STACK_MISSING', 'New SHIP closure requires input/tech/stack.md as the authoritative gate source.');
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) fail('E_SHIP_STACK_UNSAFE', 'input/tech/stack.md must be a regular repository-owned file with no symlink traversal.');
  const text = readFileSync(path, 'utf8');
  const read = (field) => {
    const raw = text.match(new RegExp(`^${field}:\\s*(.*)$`, 'm'))?.[1]?.trim();
    if (raw === undefined) return undefined;
    if (raw.startsWith('"')) {
      try { return JSON.parse(raw); } catch { fail('E_SHIP_GATE_INVALID', `${field} is not a valid quoted command.`); }
    }
    return raw;
  };
  const fields = [
    ['lint', 'LintCommand', false],
    ['typecheck', 'TypeCheckCommand', false],
    ['build', 'BuildCommand', true],
    ['test', 'TestCommand', true],
  ];
  const records = [];
  for (const [name, field, required] of fields) {
    const command = read(field);
    if (required && (!command || command === 'TODO')) fail('E_SHIP_GATE_INVALID', `${field} must be defined for a new closure run.`);
    if (!command) continue;
    parseArgvChain(command, field).forEach((argv, index) => records.push({ name, index: index + 1, argv }));
  }
  return records;
}

function defaultGates(repositories) {
  const commands = repositories.flatMap((repository) => stackCommands(repository.root).map((command) => ({ ...command, repositoryKey: repository.repositoryKey })));
  const finalRelevantIndex = commands.findLastIndex(({ repositoryKey, name }) => repositoryKey === 'project' && name === 'test');
  let previous = null;
  return commands.map((command, index) => {
    const id = `${command.repositoryKey === 'project' ? '' : `${command.repositoryKey}-`}${command.name}-${command.index}`;
    const gate = {
      id,
      repositoryKey: command.repositoryKey,
      argv: command.argv,
      // The logical repository root binds every tracked/untracked candidate
      // surface while excluding engine-owned closure projections.
      inputs: [{ repositoryKey: command.repositoryKey, path: '.' }],
      dependsOn: previous === null ? [] : [previous],
      finalRelevantSuite: index === finalRelevantIndex,
    };
    previous = id;
    return gate;
  });
}

function normalizeGates(gates, repositories) {
  const map = repositoryMap(repositories);
  if (!Array.isArray(gates) || gates.length === 0 || gates.length > 32) fail('E_SHIP_GATE_INVALID', 'Frozen gate set must contain 1-32 records.');
  const normalized = gates.map((gate) => {
    const fields = ['id', 'repositoryKey', 'argv', 'inputs', 'dependsOn', 'finalRelevantSuite'];
    if (Object.hasOwn(gate ?? {}, 'gateType')) fields.push('gateType');
    exactKeys(gate, fields, `gate ${gate?.id ?? '<unknown>'}`);
    if (!/^[a-z][a-z0-9-]{0,127}$/.test(gate.id) || !map.has(gate.repositoryKey)) fail('E_SHIP_GATE_INVALID', `Invalid gate identity ${gate.id}.`);
    if (!Array.isArray(gate.argv) || gate.argv.length === 0 || gate.argv.length > 128
      || gate.argv.some((part) => typeof part !== 'string' || !part || part.length > 4096)) fail('E_SHIP_GATE_INVALID', `Gate ${gate.id} requires a bounded non-shell argv.`);
    if (!Array.isArray(gate.inputs) || gate.inputs.length === 0 || gate.inputs.length > 512) fail('E_SHIP_GATE_INVALID', `Gate ${gate.id} requires 1-512 bounded inputs.`);
    if (!Array.isArray(gate.dependsOn) || gate.dependsOn.length > 32
      || gate.dependsOn.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 128)
      || typeof gate.finalRelevantSuite !== 'boolean'
      || (gate.gateType !== undefined && !['command', 'browser-qa'].includes(gate.gateType))) fail('E_SHIP_GATE_INVALID', `Gate ${gate.id} has invalid dependencies or final-suite authority.`);
    if (gate.gateType === 'browser-qa' && (gate.id !== 'browser-qa' || JSON.stringify(gate.argv) !== JSON.stringify(['@planr/browser-qa']))) {
      fail('E_SHIP_GATE_INVALID', 'The browser QA gate has fixed classifier-owned identity and argv custody.');
    }
    const inputs = gate.inputs.map((input) => normalizeRepositoryPath(input, `gate ${gate.id} input`, { allowRoot: true }));
    if (inputs.some(({ path }) => path.length > 1024)) fail('E_SHIP_GATE_INVALID', `Gate ${gate.id} input paths exceed the protocol bound.`);
    if (inputs.some(({ repositoryKey }) => !map.has(repositoryKey))) fail('E_SHIP_GATE_INVALID', `Gate ${gate.id} inputs must belong to declared repositories.`);
    return { ...clone(gate), inputs };
  });
  if (new Set(normalized.map(({ id }) => id)).size !== normalized.length) fail('E_SHIP_GATE_INVALID', 'Gate IDs must be unique.');
  if (normalized.filter(({ finalRelevantSuite }) => finalRelevantSuite).length !== 1) {
    fail('E_SHIP_GATE_INVALID', 'Exactly one frozen gate must be the mandatory final relevant suite.');
  }
  for (const gate of normalized) {
    if (gate.dependsOn.some((id) => id === gate.id || !normalized.some((candidate) => candidate.id === id))) fail('E_SHIP_GATE_INVALID', `Gate ${gate.id} has an invalid dependency.`);
  }
  // Deterministically prove acyclicity.
  const completed = new Set();
  while (completed.size < normalized.length) {
    const ready = normalized.filter((gate) => !completed.has(gate.id) && gate.dependsOn.every((id) => completed.has(id)));
    if (!ready.length) fail('E_SHIP_GATE_INVALID', 'Gate dependency graph is cyclic.');
    ready.forEach(({ id }) => completed.add(id));
  }
  return normalized;
}

export function resolveShipClosureConfiguration({ projectRoot, repositories: suppliedRepositories, gates: suppliedGates } = {}) {
  const repositories = normalizeRepositories(projectRoot, suppliedRepositories);
  const gates = normalizeGates(suppliedGates ?? defaultGates(repositories), repositories);
  return { repositories, gates };
}

function structuredPreserve(task, repositories) {
  if (task.structuredPreserveDeclared !== true) {
    fail(
      'E_SHIP_PRESERVE_LEGACY',
      `Task ${task.id} has no machine-enforceable Preserve declaration.`,
      'Add task frontmatter `preserve:` entries with repositoryKey/path pairs; use an explicit empty array when no boundary is required.',
      { taskId: task.id, legacyBodyEntries: task.legacyPreserve ?? [] },
    );
  }
  if (!Array.isArray(task.structuredPreserve)) fail('E_SHIP_PRESERVE_INVALID', `Task ${task.id} frontmatter preserve must be an array.`);
  const map = repositoryMap(repositories);
  return (task.structuredPreserve ?? []).map((entry) => {
    const path = normalizeRepositoryPath(entry, `task ${task.id} Preserve`);
    const repository = map.get(path.repositoryKey);
    if (!repository) fail('E_SHIP_REPOSITORY_INVALID', `Task ${task.id} references unknown repository ${path.repositoryKey}.`);
    return { ...path, identity: filesystemIdentity(repository.root, path.path) };
  });
}

export function shipClosureSummary(state, { replayed = false } = {}) {
  const completed = new Set(state.tasks.filter(({ status }) => status === 'completed').map(({ id }) => id));
  const readyTaskIds = state.state === 'implementing'
    ? state.tasks.filter(({ status, dependsOn }) => status === 'pending' && dependsOn.every((id) => completed.has(id))).map(({ id }) => id)
    : [];
  return {
    ok: true,
    runId: state.runId,
    generation: state.generation,
    state: state.state,
    recordType: state.recordType,
    candidateRevision: currentCandidate(state)?.revision ?? 0,
    candidateDigest: currentCandidate(state)?.digest ?? null,
    readyTaskIds,
    approvedScope: clone(state.approvedScope),
    tasks: state.tasks.map(({ id, storyId, status, dependsOn, blockedReason }) => ({ id, storyId, status, dependsOn: clone(dependsOn), blockedReason })),
    repositories: state.repositories.map(({ repositoryKey, head, baselineDigest }) => ({ repositoryKey, head, baselineDigest })),
    reviewerRoster: clone(state.reviewerRoster),
    gates: clone(state.gates),
    candidate: clone(currentCandidate(state)),
    gateEvidence: clone(state.gateEvidence),
    latestFindings: clone(state.reviews.at(-1)?.findings ?? []),
    correctionImpact: clone(state.correctionImpact),
    terminal: clone(state.terminal),
    rosterDigest: state.rosterDigest,
    gateSetDigest: state.gateSetDigest,
    receiptHash: state.receiptHash,
    planningReview: clone(state.planningReview ?? null),
    riskClassification: clone(state.riskClassification ?? null),
    browserQaRecords: clone(state.browserQaRecords ?? []),
    replayed,
  };
}

export function createShipClosure({
  projectRoot,
  prepared,
  runtime = 'unknown',
  runId = `ship_${randomUUID().replaceAll('-', '')}`,
  repositories: suppliedRepositories,
  reviewerRoster = ['qa-agent'],
  gates: suppliedGates,
  now = new Date().toISOString(),
  startedFromReceiptHash = null,
  reopenReason = null,
  planningReview = null,
  riskClassification = null,
  operatingOriginCorrelation = undefined,
} = {}) {
  if (!/^ship_[a-f0-9]{32}$/.test(runId)) fail('E_SHIP_RUN_ID_INVALID', 'runId must use ship_<32 lowercase hex>.');
  if (!['claude-code', 'cursor', 'codex', 'unknown'].includes(runtime)) fail('E_RUNTIME_INVALID', `Unsupported SHIP runtime ${runtime}.`);
  if (!Array.isArray(reviewerRoster) || reviewerRoster.length === 0 || reviewerRoster[0] !== 'qa-agent' || new Set(reviewerRoster).size !== reviewerRoster.length) {
    fail('E_SHIP_REVIEWER_INVALID', 'The frozen reviewer roster must start with exactly one qa-agent; optional declared specialists may follow once each.');
  }
  if (reviewerRoster.some((id) => !/^[a-z][a-z0-9-]*$/.test(id))) fail('E_SHIP_REVIEWER_INVALID', 'Reviewer IDs must be lowercase slugs.');
  if (riskClassification !== null) assertShipRiskClassification(riskClassification);
  const resolved = resolveShipClosureConfiguration({ projectRoot, repositories: suppliedRepositories, gates: suppliedGates });
  const repositories = resolved.repositories;
  const gates = addFrozenBrowserGate(resolved.gates, repositories, riskClassification);
  const taskIds = new Set(prepared.tasks.map(({ id }) => id));
  for (const task of prepared.tasks) {
    if (task.dependsOn.some((id) => !taskIds.has(id) || id === task.id)) fail('E_SHIP_TASK_DEPENDENCY', `Task ${task.id} has an invalid dependency.`);
  }
  const resolvedTasks = new Set();
  while (resolvedTasks.size < prepared.tasks.length) {
    const ready = prepared.tasks.filter(({ id, dependsOn }) => !resolvedTasks.has(id) && dependsOn.every((dependency) => resolvedTasks.has(dependency)));
    if (!ready.length) fail('E_SHIP_TASK_DEPENDENCY', 'The approved task graph is cyclic.');
    ready.forEach(({ id }) => resolvedTasks.add(id));
  }
  const tasks = prepared.tasks.map((task) => ({
    id: task.id,
    storyId: task.storyId ?? null,
    path: taskRepositoryPath(task, repositories),
    // A fresh, explicitly reviewed run may repair a legacy blocked task; the
    // old status is evidence, not terminal authority for the new run.
    status: startedFromReceiptHash === null && task.status === 'done' ? 'completed' : 'pending',
    dependsOn: clone(task.dependsOn),
    agent: null,
    filesWritten: [],
    filesModified: [],
    blockedReason: null,
    preserve: structuredPreserve(task, repositories),
  }));
  const approvedScopeIdentity = {
    featureRoot: posix(relative(projectRoot, prepared.root)),
    tasks: tasks.map(({ id, storyId, path, dependsOn, preserve }) => ({ id, storyId, path, dependsOn, preserve: preserve.map(({ identity, ...entry }) => entry) })),
  };
  const state = {
    kind: 'ship-closure',
    schemaVersion: riskClassification !== null ? '1.2.0' : planningReview === null ? '1.0.0' : '1.1.0',
    protocolVersion: '1.1.0',
    recordType: 'active',
    runId,
    generation: 0,
    state: 'implementing',
    feature: prepared.slug,
    mode: prepared.mode,
    runtime,
    createdAt: now,
    updatedAt: now,
    approvedScope: {
      featureRoot: approvedScopeIdentity.featureRoot,
      taskIds: tasks.map(({ id }) => id),
      digest: sha256Jcs(approvedScopeIdentity),
    },
    tasks,
    repositories,
    reviewerRoster: clone(reviewerRoster),
    rosterDigest: sha256Jcs(reviewerRoster),
    gates,
    gateSetDigest: sha256Jcs(gates),
    candidateRevisions: [],
    reviews: [],
    gateEvidence: [],
    events: [],
    correctionImpact: null,
    terminal: null,
    receiptHash: null,
    startedFromReceiptHash,
    reopenReason,
    ...(planningReview === null ? {} : { planningReview: clone(planningReview) }),
    ...(riskClassification === null ? {} : {
      riskClassification: clone(riskClassification),
      browserQaRecords: [],
    }),
    operatingOriginCorrelation: operatingOriginCorrelation ?? projectPipelineOperatingOriginCorrelation(prepared.operatingOrigin ?? null),
  };
  assertClosure(state);
  const paths = closurePaths(prepared.root, runId, prepared.projectRoot ?? projectRoot);
  ensureClosureDirs(paths);
  try {
    return withLock(paths.featureLock, () => withLock(paths.lock, () => {
    if (existsSync(paths.receipt)) {
      const prior = readClosure(paths.receipt, { prepared, expectedRunId: runId, expectedRecordType: 'receipt' });
      if (sameStartCustody(prior, state)) return shipClosureSummary(prior, { replayed: true });
      fail('E_SHIP_RUN_ID_CONFLICT', `Terminal run ${runId} has different start custody.`);
    }
    if (existsSync(paths.active)) {
      const prior = readClosure(paths.active, { prepared, expectedRunId: runId, expectedRecordType: 'active' });
      if (sameStartCustody(prior, state)) return shipClosureSummary(prior, { replayed: true });
      fail('E_SHIP_RUN_ID_CONFLICT', `Run ${runId} already exists with different custody.`);
    }
    const other = activeRuns(prepared.root);
    if (other.length) fail('E_SHIP_ACTIVE', `Feature ${prepared.slug} already has active SHIP run ${other[0].replace(/\.json$/, '')}.`);
    const receipts = terminalReceipts(prepared);
    if (startedFromReceiptHash === null) {
      const requestedTasks = new Set(state.approvedScope.taskIds);
      const overlap = receipts.find((receipt) => receipt.approvedScope.taskIds.some((id) => requestedTasks.has(id)));
      if (overlap) fail('E_SHIP_REOPEN_REQUIRED', `Task scope overlaps terminal receipt ${overlap.receiptHash}; use the owner-only reopen command.`);
    } else {
      const prior = receipts.find(({ receiptHash }) => receiptHash === startedFromReceiptHash);
      if (!prior) fail('E_SHIP_RECEIPT_NOT_FOUND', `No terminal receipt matches ${startedFromReceiptHash}.`);
      if (JSON.stringify(state.repositories.map(({ repositoryKey }) => repositoryKey)) !== JSON.stringify(prior.repositories.map(({ repositoryKey }) => repositoryKey))) {
        fail('E_SHIP_REOPEN_SCOPE_INVALID', 'Reopen must preserve the exact prior repository membership.');
      }
      if (state.approvedScope.digest !== prior.approvedScope.digest) fail('E_SHIP_REOPEN_SCOPE_INVALID', 'Reopen must preserve the exact prior approved task DAG and structured Preserve boundary.');
      assertReopenGateInputExpansion(prior.gates, state.gates);
      const successor = receipts.find(({ startedFromReceiptHash: parentHash }) => parentHash === startedFromReceiptHash);
      if (successor) fail('E_SHIP_REOPENED', `Receipt ${startedFromReceiptHash} already has successor ${successor.runId}.`);
    }
    writeJson(paths.active, state);
    return shipClosureSummary(state);
    }));
  } catch (error) {
    if (error?.code === 'E_SHIP_LOCKED') {
      fail('E_SHIP_ACTIVE', `Feature ${prepared.slug} already has a SHIP start or active run in progress.`);
    }
    throw error;
  }
}

function loadRun(prepared, runId) {
  const paths = closurePaths(prepared.root, runId, prepared.projectRoot);
  if (prepared.projectRoot) {
    assertPathCustody(prepared.projectRoot, prepared.root, { expectedKind: 'directory' });
    assertPathCustody(prepared.projectRoot, paths.shipRoot, { expectedKind: 'directory' });
    assertPathCustody(prepared.projectRoot, paths.activeDir, { expectedKind: 'directory' });
    assertPathCustody(prepared.projectRoot, paths.receiptDir, { expectedKind: 'directory' });
  }
  if (existsSync(paths.receipt)) {
    const receipt = readClosure(paths.receipt, { prepared, expectedRunId: runId, expectedRecordType: 'receipt' });
    if (existsSync(paths.active)) {
      const active = readClosure(paths.active, { prepared, expectedRunId: runId, expectedRecordType: 'active' });
      if (!receiptExtendsActive(receipt, active)) fail('E_SHIP_CLOSURE_DIVERGED', `Active and terminal custody diverge for ${runId}.`);
      unlinkSync(paths.active);
    }
    return { paths, state: receipt };
  }
  if (existsSync(paths.active)) return { paths, state: readClosure(paths.active, { prepared, expectedRunId: runId, expectedRecordType: 'active' }) };
  fail('E_SHIP_RUN_NOT_FOUND', `SHIP run ${runId} was not found for ${prepared.slug}.`);
}

export function advanceStoredShipClosure({
  prepared,
  runId,
  event,
  now = new Date().toISOString(),
  browserQaEventAuthority = null,
} = {}) {
  const paths = closurePaths(prepared.root, runId, prepared.projectRoot);
  if (event?.type === 'browser-qa.recorded') {
    assertBrowserQaRecordedEventAuthority(browserQaEventAuthority, event);
  }
  ensureClosureDirs(paths);
  const normalizedEvent = validateEvent(event);
  const inputDigest = sha256Jcs(normalizedEvent);
  return withLock(paths.lock, () => {
    const { state } = loadRun(prepared, runId);
    const prior = state.events.find(({ eventId }) => eventId === normalizedEvent.eventId);
    if (prior) {
      if (prior.inputDigest !== inputDigest) fail('E_SHIP_EVENT_REPLAY_DIVERGED', `Event ${normalizedEvent.eventId} was replayed with different bytes.`);
      return shipClosureSummary(state, { replayed: true });
    }
    if (state.recordType === 'receipt') fail('E_SHIP_TERMINAL', `SHIP run ${runId} is terminal.`);
    assertPreserve(state);
    const runtime = { inputDigest, now, browserQaEventAuthority };
    if (event.type === 'review.opened' && state.state === 'implementing') {
      runtime.candidate = captureCandidate(state, now);
      if (state.riskClassification) {
        const paths = [...new Map(state.tasks.flatMap(({ filesWritten, filesModified }) => [...filesWritten, ...filesModified])
          .map((entry) => [`${entry.repositoryKey}\0${entry.path}`, entry])).values()];
        const frozen = state.riskClassification.input;
        runtime.riskClassification = classifyShipRisk({
          subjectDigest: runtime.candidate.digest,
          changedPaths: paths,
          browserSurfaces: frozen.browserSurfaces,
          contractChanges: frozen.contractChanges,
          migrationChanges: frozen.migrationChanges,
          permissionEffects: frozen.permissionEffects,
          dataWrites: frozen.dataWrites,
          performanceBudgets: frozen.performanceBudgets,
          explicitRisks: frozen.explicitRisks,
        });
      }
    }
    if (event.type === 'correction.registered') {
      runtime.candidate = captureCandidate(state, now);
      if (state.riskClassification) {
        const paths = [...new Map([
          ...state.tasks.flatMap(({ filesWritten, filesModified }) => [...filesWritten, ...filesModified]),
          ...(event.impact?.paths ?? []),
        ].map((entry) => [`${entry.repositoryKey}\0${entry.path}`, entry])).values()];
        const frozen = state.riskClassification.input;
        runtime.riskClassification = classifyShipRisk({
          subjectDigest: runtime.candidate.digest, changedPaths: paths,
          browserSurfaces: frozen.browserSurfaces, contractChanges: frozen.contractChanges,
          migrationChanges: frozen.migrationChanges, permissionEffects: frozen.permissionEffects,
          dataWrites: frozen.dataWrites, performanceBudgets: frozen.performanceBudgets,
          explicitRisks: frozen.explicitRisks,
        });
      }
    }
    const next = reduceShipClosure(state, normalizedEvent, runtime);
    if (next.recordType === 'receipt') {
      writeJson(paths.receipt, next);
      try { unlinkSync(paths.active); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    } else {
      writeJson(paths.active, next);
    }
    return shipClosureSummary(next);
  });
}

function gateInputDigest(state, gate, results) {
  const candidate = currentCandidate(state);
  if (!candidate) fail('E_SHIP_CANDIDATE_INVALID', `Gate ${gate.id} requires a sealed candidate.`);
  const repositories = repositoryMap(state.repositories);
  const inputs = gate.inputs.map(({ repositoryKey, path }) => {
    const repository = repositories.get(repositoryKey);
    return { repositoryKey, path, identity: filesystemIdentity(repository.root, path) };
  });
  const dependencies = gate.dependsOn.map((gateId) => {
    const evidence = results.get(gateId);
    if (!evidence) fail('E_SHIP_GATE_INVALID', `Gate ${gate.id} has no evidence for dependency ${gateId}.`);
    return {
      gateId,
      status: evidence.status,
      inputDigest: evidence.inputDigest,
      exitCode: evidence.exitCode,
      stdoutDigest: evidence.stdoutDigest,
      stderrDigest: evidence.stderrDigest,
    };
  });
  // A gate may legitimately consume another declared repository through a
  // repository-root capability rather than a caller-authored path argument.
  // Bind the complete sealed candidate as the conservative safety net: gate
  // evidence is reusable only while every repository in candidate custody is
  // byte-identical, even when the gate's narrower inputs are unchanged.
  return sha256Jcs({
    gateId: gate.id,
    argv: gate.argv,
    candidateDigest: candidate.digest,
    inputs,
    dependencies,
    browserQaRecordDigest: gate.gateType === 'browser-qa'
      ? state.browserQaRecords?.find(({ candidateDigest }) => candidateDigest === candidate.digest)?.recordDigest ?? null
      : null,
  });
}

const SHIP_REPOSITORY_ROOT_ENV_PREFIX = 'PLANR_SHIP_REPOSITORY_';

function gateReadableRepositoryKeys(state, gate) {
  const gates = new Map(state.gates.map((entry) => [entry.id, entry]));
  const visited = new Set();
  const repositoryKeys = new Set();
  const visit = (current) => {
    if (visited.has(current.id)) return;
    visited.add(current.id);
    repositoryKeys.add(current.repositoryKey);
    current.inputs.forEach(({ repositoryKey }) => repositoryKeys.add(repositoryKey));
    current.dependsOn.forEach((id) => visit(gates.get(id)));
  };
  visit(gate);
  return repositoryKeys;
}

function gateEnvironment(state, gate) {
  // Never inherit spoofed repository capabilities. Active closure loading has
  // already checked these roots against the project configuration. A gate gets
  // only roots named by its own inputs/cwd or by its transitive gate dependency
  // closure, which keeps cross-repository reads explicit and bounded.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => (
    !key.startsWith(SHIP_REPOSITORY_ROOT_ENV_PREFIX)
    && key !== 'PLANR_SHIP_CANDIDATE_DIGEST'
    && key !== 'PLANR_SHIP_GATE_ID'
  )));
  const readable = gateReadableRepositoryKeys(state, gate);
  for (const repository of state.repositories.filter(({ repositoryKey }) => readable.has(repositoryKey))) {
    const key = `${SHIP_REPOSITORY_ROOT_ENV_PREFIX}${repository.repositoryKey.toUpperCase().replaceAll('-', '_')}_ROOT`;
    env[key] = repository.root;
  }
  env.PLANR_SHIP_CANDIDATE_DIGEST = currentCandidate(state).digest;
  env.PLANR_SHIP_GATE_ID = gate.id;
  return env;
}

function gateOrder(gates) {
  const ordered = [];
  const done = new Set();
  while (ordered.length < gates.length) {
    const ready = gates.filter((gate) => !done.has(gate.id) && gate.dependsOn.every((id) => done.has(id))).sort((a, b) => a.id.localeCompare(b.id));
    if (!ready.length) fail('E_SHIP_GATE_INVALID', 'Gate dependency graph is cyclic.');
    for (const gate of ready) { ordered.push(gate); done.add(gate.id); }
  }
  return ordered;
}

function executeGate(state, gate, phase, results, now) {
  const inputDigest = gateInputDigest(state, gate, results);
  const candidate = currentCandidate(state);
  const dependencyFailed = gate.dependsOn.some((id) => !['passed', 'reused'].includes(results.get(id)?.status));
  if (dependencyFailed && !(phase === 'final' && gate.finalRelevantSuite)) {
    return {
      gateId: gate.id, phase, candidateDigest: candidate.digest, inputDigest, status: 'skipped',
      startedAt: now, endedAt: now, exitCode: null, stdoutDigest: digestBytes(Buffer.alloc(0)),
      stderrDigest: digestBytes(Buffer.alloc(0)), stdoutExcerpt: '', stderrExcerpt: '', reusedFromPhase: null,
    };
  }
  const reusable = phase !== 'final' || !gate.finalRelevantSuite
    ? [...state.gateEvidence].reverse().find((entry) => entry.gateId === gate.id && entry.inputDigest === inputDigest && ['passed', 'reused'].includes(entry.status))
    : null;
  if (reusable) {
    return {
      ...clone(reusable), phase, candidateDigest: candidate.digest, status: 'reused',
      startedAt: now, endedAt: now, reusedFromPhase: reusable.phase,
    };
  }
  if (gate.gateType === 'browser-qa') {
    const record = state.browserQaRecords?.find(({ candidateDigest }) => candidateDigest === candidate.digest) ?? null;
    const passed = record?.status === 'passed' && record?.custodyVersion === '1.0.0';
    const stdout = Buffer.from(JSON.stringify({ status: record?.status ?? 'unavailable', recordDigest: record?.recordDigest ?? null }), 'utf8');
    const stderr = passed ? Buffer.alloc(0) : Buffer.from('Mandatory browser QA did not produce a passing bound record.', 'utf8');
    return {
      gateId: gate.id, phase, candidateDigest: candidate.digest, inputDigest,
      status: passed ? 'passed' : 'failed', startedAt: now, endedAt: now,
      exitCode: passed ? 0 : 1, stdoutDigest: digestBytes(stdout), stderrDigest: digestBytes(stderr),
      stdoutExcerpt: stdout.toString('utf8'), stderrExcerpt: stderr.toString('utf8'), reusedFromPhase: null,
    };
  }
  const repository = repositoryMap(state.repositories).get(gate.repositoryKey);
  const startedAt = new Date().toISOString();
  const result = spawnSync(gate.argv[0], gate.argv.slice(1), {
    cwd: repository.root,
    env: gateEnvironment(state, gate),
    encoding: 'buffer',
    shell: false,
    timeout: 15 * 60 * 1000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const endedAt = new Date().toISOString();
  const stdout = Buffer.from(result.stdout ?? '');
  const stderr = Buffer.from(result.stderr ?? result.error?.message ?? '');
  const sanitizeExcerpt = (bytes) => {
    let text = bytes.toString('utf8');
    for (const repository of state.repositories) text = text.replaceAll(repository.root, `<repo:${repository.repositoryKey}>`);
    return text.slice(0, 4096);
  };
  return {
    gateId: gate.id,
    phase,
    candidateDigest: candidate.digest,
    inputDigest,
    status: !result.error && result.status === 0 ? 'passed' : 'failed',
    startedAt,
    endedAt,
    exitCode: result.status,
    stdoutDigest: digestBytes(stdout),
    stderrDigest: digestBytes(stderr),
    stdoutExcerpt: sanitizeExcerpt(stdout),
    stderrExcerpt: sanitizeExcerpt(stderr),
    reusedFromPhase: null,
  };
}

export function runStoredShipGates({ prepared, runId, phase, expectedGeneration, now = new Date().toISOString() } = {}) {
  if (!['initial', 'targeted', 'final'].includes(phase)) fail('E_SHIP_GATE_PHASE_INVALID', `Invalid gate phase ${phase}.`);
  const paths = closurePaths(prepared.root, runId, prepared.projectRoot);
  ensureClosureDirs(paths);
  return withLock(paths.lock, () => {
    const { state } = loadRun(prepared, runId);
    if (state.recordType === 'receipt') fail('E_SHIP_TERMINAL', `SHIP run ${runId} is terminal.`);
    if (expectedGeneration !== undefined && Number(expectedGeneration) !== state.generation) {
      fail('E_SHIP_GENERATION_CONFLICT', `Expected generation ${expectedGeneration}, current generation is ${state.generation}.`);
    }
    if (state.state !== REVIEW_PHASE_STATE[phase]) fail('E_SHIP_STATE_TRANSITION_INVALID', `${phase} gates are not valid from ${state.state}.`);
    assertPreserve(state);
    const candidate = currentCandidate(state);
    if (!candidate) fail('E_SHIP_CANDIDATE_INVALID', 'Gates require a sealed candidate.');
    const current = captureCandidate({ ...state, candidateRevisions: state.candidateRevisions.slice(0, -1) }, candidate.sealedAt);
    if (current.digest !== candidate.digest) fail('E_SHIP_CANDIDATE_STALE', 'Repository bytes no longer match the sealed candidate.');
    const already = phaseEvidence(state, phase);
    if (already.length === state.gates.length) return { ...shipClosureSummary(state, { replayed: true }), phase, evidence: clone(already) };
    const evidence = [];
    const results = new Map();
    for (const gate of gateOrder(state.gates)) {
      const entry = executeGate(state, gate, phase, results, now);
      evidence.push(entry);
      results.set(gate.id, entry);
    }
    const after = captureCandidate({ ...state, candidateRevisions: state.candidateRevisions.slice(0, -1) }, candidate.sealedAt);
    if (after.digest !== candidate.digest) fail('E_SHIP_CANDIDATE_STALE', 'Gate execution changed candidate bytes; seal a new authorized candidate before continuing.');
    const next = recordShipGateEvidence(state, { phase, evidence, expectedGeneration, now });
    writeJson(paths.active, next);
    return { ...shipClosureSummary(next), phase, evidence };
  });
}

export function finalizeStoredShipClosure({ projectRoot, prepared, runId, repositories: suppliedRepositories, now = new Date().toISOString() } = {}) {
  const paths = closurePaths(prepared.root, runId, prepared.projectRoot ?? projectRoot);
  ensureClosureDirs(paths);
  let receipt;
  let replayed = false;
  withLock(paths.lock, () => {
    if (existsSync(paths.receipt)) {
      ({ state: receipt } = loadRun(prepared, runId));
      const superseded = terminalReceipts(prepared).some(({ startedFromReceiptHash }) => startedFromReceiptHash === receipt.receiptHash);
      if (!superseded) {
        const live = normalizeRepositories(projectRoot, suppliedRepositories);
        if (JSON.stringify(live.map(({ repositoryKey }) => repositoryKey)) !== JSON.stringify(receipt.repositories.map(({ repositoryKey }) => repositoryKey))) {
          fail('E_SHIP_REPOSITORY_INVALID', 'Current repository configuration does not match terminal receipt custody.');
        }
        const byKey = new Map(live.map((repository) => [repository.repositoryKey, repository]));
        const rehydrated = receipt.repositories.map((repository) => ({ ...repository, root: byKey.get(repository.repositoryKey).root }));
        const candidate = currentCandidate(receipt);
        const current = captureCandidate({ ...receipt, repositories: rehydrated, candidateRevisions: receipt.candidateRevisions.slice(0, -1) }, candidate.sealedAt);
        if (current.digest !== candidate.digest) fail('E_SHIP_CANDIDATE_STALE', 'Terminal receipt no longer matches the current repository bytes.');
      }
      replayed = true;
      return;
    }
    if (!existsSync(paths.active)) fail('E_SHIP_RUN_NOT_FOUND', `SHIP run ${runId} was not found.`);
    const active = readClosure(paths.active, { prepared, expectedRunId: runId, expectedRecordType: 'active' });
    assertPreserve(active);
    const candidate = currentCandidate(active);
    if (candidate) {
      const current = captureCandidate({ ...active, candidateRevisions: active.candidateRevisions.slice(0, -1) }, candidate.sealedAt);
      if (current.digest !== candidate.digest) fail('E_SHIP_CANDIDATE_STALE', 'Repository bytes no longer match the sealed candidate.');
    }
    const suppliedCandidate = candidate === null ? captureCandidate(active, now) : null;
    receipt = terminalizeShipClosure(active, { now, candidate: suppliedCandidate });
    writeJson(paths.receipt, receipt);
    try { unlinkSync(paths.active); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  });
  const projections = projectShipCompatibility(receipt, { projectRoot, prepared });
  return { ...shipClosureSummary(receipt, { replayed }), receiptPath: paths.receipt, projections };
}

function receiptByHash(prepared, receiptHash) {
  return terminalReceipts(prepared).find((receipt) => receipt.receiptHash === receiptHash) ?? null;
}

export function reopenStoredShipClosure({
  projectRoot,
  prepared,
  receiptHash,
  reason,
  ownerConfirmed = false,
  runtime = 'unknown',
  runId,
  repositories,
  gates,
  now = new Date().toISOString(),
} = {}) {
  if (!ownerConfirmed) fail('E_SHIP_OWNER_REQUIRED', 'Only an explicit owner action may reopen terminal SHIP custody.');
  if (!/^sha256:[a-f0-9]{64}$/.test(receiptHash ?? '')) fail('E_SHIP_RECEIPT_HASH_INVALID', 'reopen-ship requires an exact receipt hash.');
  if (typeof reason !== 'string' || !reason.trim()) fail('E_SHIP_REOPEN_REASON_REQUIRED', 'reopen-ship requires a non-empty reason.');
  ensureClosureDirs(closurePaths(prepared.root, 'ship_00000000000000000000000000000000', prepared.projectRoot ?? projectRoot));
  const prior = receiptByHash(prepared, receiptHash);
  if (!prior) fail('E_SHIP_RECEIPT_NOT_FOUND', `No terminal receipt matches ${receiptHash}.`);
  const currentTasks = new Map(prepared.tasks.map((task) => [task.id, task]));
  const reopenedTasks = prior.tasks.map((priorTask) => {
    const current = currentTasks.get(priorTask.id);
    if (!current) fail('E_SHIP_REOPEN_SCOPE_INVALID', `Prior task ${priorTask.id} is no longer available.`);
    if (current.storyId !== priorTask.storyId || current.structuredPreserveDeclared !== true) {
      fail('E_SHIP_REOPEN_SCOPE_INVALID', `Prior task ${priorTask.id} changed story or structured Preserve custody.`);
    }
    const currentPreserve = current.structuredPreserve.map((entry) => normalizeRepositoryPath(entry, `task ${priorTask.id} Preserve`));
    const priorPreserve = priorTask.preserve.map(({ identity: _identity, ...entry }) => entry);
    if (sha256Jcs(currentPreserve) !== sha256Jcs(priorPreserve)) fail('E_SHIP_REOPEN_SCOPE_INVALID', `Prior task ${priorTask.id} changed its structured Preserve declaration.`);
    return {
      ...current,
      storyId: priorTask.storyId,
      dependsOn: clone(priorTask.dependsOn),
      structuredPreserve: clone(priorPreserve),
      structuredPreserveDeclared: true,
    };
  });
  const reopenedPrepared = { ...prepared, tasks: reopenedTasks };
  const successorRunId = runId ?? `ship_${sha256Jcs({ receiptHash, reason: reason.trim() }).slice('sha256:'.length, 'sha256:'.length + 32)}`;
  return createShipClosure({
    projectRoot,
    prepared: reopenedPrepared,
    runtime,
    runId: successorRunId,
    repositories,
    reviewerRoster: prior.reviewerRoster,
    gates: gates ?? prior.gates,
    now,
    startedFromReceiptHash: receiptHash,
    reopenReason: reason.trim(),
    planningReview: prior.planningReview ?? null,
    riskClassification: prior.riskClassification ?? null,
    operatingOriginCorrelation: prior.operatingOriginCorrelation,
  });
}

export function readShipClosure({ prepared, runId } = {}) {
  const { state } = loadRun(prepared, runId);
  return clone(state);
}

/**
 * Resolve one exact terminal PASS receipt for landing without creating or
 * repairing any SHIP state. The returned object is process-bound so callers
 * cannot replace the verified receipt or its filesystem projection context
 * with portable JSON.
 */
export function inspectStoredShipClosureForLanding({
  projectRoot,
  prepared,
  receiptHash,
} = {}) {
  if (!/^sha256:[a-f0-9]{64}$/.test(receiptHash ?? '')) {
    fail('E_SHIP_LANDING_RECEIPT_HASH_INVALID', 'Landing requires one exact terminal SHIP receipt hash.');
  }
  const summaries = listShipClosureSummaries({
    featureRoot: prepared.root,
    projectRoot,
    feature: prepared.slug,
    mode: prepared.mode,
    closureRepositories: prepared.closureRepositories,
  });
  const receipts = terminalReceipts(prepared);
  const receipt = receipts.find((entry) => entry.receiptHash === receiptHash);
  if (!receipt) {
    fail('E_SHIP_LANDING_RECEIPT_NOT_FOUND', `No terminal SHIP receipt matches ${receiptHash}.`);
  }
  if (receipt.recordType !== 'receipt' || receipt.state !== 'passed'
    || receipt.terminal?.status !== 'passed' || receipt.protocolVersion !== '1.1.0') {
    fail('E_SHIP_LANDING_RECEIPT_NOT_PASS', 'Landing requires an immutable terminal PASS SHIP receipt.');
  }

  const terminalSuccessors = receipts.filter(({ startedFromReceiptHash }) => (
    startedFromReceiptHash === receiptHash
  ));
  const activeRecords = summaries.active.map(({ runId }) => readShipClosure({ prepared, runId }));
  const activeSuccessors = activeRecords.filter(({ startedFromReceiptHash }) => (
    startedFromReceiptHash === receiptHash
  ));
  if (terminalSuccessors.length || activeSuccessors.length) {
    fail(
      'E_SHIP_LANDING_RECEIPT_SUPERSEDED',
      'Landing refuses a PASS receipt that has an owner-reopened successor.',
      '',
      {
        receiptHash,
        successorRunIds: [...terminalSuccessors, ...activeSuccessors].map(({ runId }) => runId).sort(),
      },
    );
  }

  const superseded = new Set(
    receipts.map(({ startedFromReceiptHash }) => startedFromReceiptHash).filter(Boolean),
  );
  const leaves = receipts.filter(({ receiptHash: hash }) => !superseded.has(hash));
  const projectionOwner = [...leaves]
    .sort((left, right) => (
      left.terminal.at.localeCompare(right.terminal.at) || left.runId.localeCompare(right.runId)
    ))
    .at(-1);
  if (projectionOwner?.receiptHash !== receiptHash) {
    fail(
      'E_SHIP_LANDING_RECEIPT_SUPERSEDED',
      'Landing requires the current terminal projection-owner receipt.',
      '',
      { receiptHash, projectionOwnerReceiptHash: projectionOwner?.receiptHash ?? null },
    );
  }
  if (activeRecords.length) {
    fail(
      'E_SHIP_LANDING_ACTIVE',
      'Landing cannot start while the feature has an active SHIP run.',
      '',
      { activeRunIds: activeRecords.map(({ runId }) => runId).sort() },
    );
  }

  const terminalTasks = new Map();
  for (const leaf of leaves) {
    for (const task of leaf.tasks) {
      if (terminalTasks.has(task.id)) {
        fail('E_SHIP_STORAGE_CONTEXT_INVALID', `Terminal leaf receipts overlap task ${task.id}.`);
      }
      terminalTasks.set(task.id, task.status);
    }
  }
  const currentTaskIds = (prepared.tasks ?? []).map(({ id }) => id).sort();
  if (currentTaskIds.length === 0
    || currentTaskIds.some((taskId) => terminalTasks.get(taskId) !== 'completed')
    || [...terminalTasks.keys()].some((taskId) => !currentTaskIds.includes(taskId))) {
    fail(
      'E_SHIP_LANDING_SCOPE_INCOMPLETE',
      'Landing requires terminal PASS custody for the exact current task set.',
      '',
      { currentTaskIds, terminalTaskIds: [...terminalTasks.keys()].sort() },
    );
  }

  const shipProjection = {
    projectRoot,
    prepared: {
      root: prepared.root,
      closureRepositories: prepared.closureRepositories,
    },
  };
  let projectionVerified = false;
  try {
    projectionVerified = verifyShipCompatibilityProjection(receipt, shipProjection);
  } catch (cause) {
    fail(
      'E_SHIP_LANDING_PROJECTION_INVALID',
      'Landing could not verify current SHIP projection custody.',
      '',
      { cause: cause?.code ?? cause?.message ?? 'unknown' },
    );
  }
  if (!projectionVerified) {
    fail(
      'E_SHIP_LANDING_PROJECTION_STALE',
      'Landing requires byte-current repository, candidate, and compatibility projection custody.',
    );
  }

  const candidate = receipt.candidateRevisions.at(-1);
  const inspection = {
    ok: true,
    kind: 'ship-closure-landing-inspection',
    schemaVersion: '1.0.0',
    feature: receipt.feature,
    mode: receipt.mode,
    runId: receipt.runId,
    receiptHash: receipt.receiptHash,
    recordDigest: sha256Jcs(receipt),
    projectionVerified: true,
    activeSuccessor: false,
    activeRunIds: [],
    terminalSuccessorRunIds: [],
    candidateDigest: candidate.digest,
    candidateInventoryDigest: sha256Jcs(candidate.inventory),
    repositoryKeys: candidate.repositories.map(({ repositoryKey }) => repositoryKey),
    taskIds: currentTaskIds,
    receipt: deepFreeze(clone(receipt)),
  };
  Object.defineProperty(inspection, 'shipProjection', {
    value: deepFreeze(clone(shipProjection)),
    enumerable: false,
  });
  deepFreeze(inspection);
  LANDING_INSPECTIONS.set(inspection, { projectRoot, prepared, receiptHash });
  return inspection;
}

/** Re-run the read-only receipt, successor, candidate, and projection proof. */
export function assertCurrentShipClosureForLanding(inspection) {
  const binding = inspection && typeof inspection === 'object'
    ? LANDING_INSPECTIONS.get(inspection)
    : undefined;
  if (!binding) {
    fail(
      'E_SHIP_LANDING_INSPECTION_REQUIRED',
      'Landing requires the original process-bound public SHIP closure inspection.',
    );
  }
  return inspectStoredShipClosureForLanding(binding);
}

export function listShipClosureSummaries({ featureRoot, projectRoot, feature, mode, closureRepositories } = {}) {
  const shipRoot = join(featureRoot, '.ship');
  const assertDirectory = (path) => {
    let stat;
    try { stat = lstatSync(path); } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('E_SHIP_STORAGE_UNSAFE', `SHIP preview storage component is unsafe: ${path}`);
    return true;
  };
  if (projectRoot) assertPathCustody(projectRoot, featureRoot, { expectedKind: 'directory' });
  if (!assertDirectory(featureRoot) || !assertDirectory(shipRoot)) return { active: [], terminal: [] };
  const readKind = (kind) => {
    const dir = join(shipRoot, kind);
    if (!assertDirectory(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => {
        const record = readClosure(join(dir, name), {
          prepared: projectRoot ? {
            root: featureRoot,
            projectRoot,
            slug: feature,
            mode,
            closureRepositories,
          } : undefined,
          expectedRunId: name.replace(/\.json$/, ''),
          expectedRecordType: kind === 'active' ? 'active' : 'receipt',
        });
        const expectedFeatureRoot = projectRoot ? posix(relative(projectRoot, featureRoot)) : null;
        if ((feature && record.feature !== feature) || (mode && record.mode !== mode)
          || (expectedFeatureRoot && record.approvedScope.featureRoot !== expectedFeatureRoot)) {
          fail('E_SHIP_STORAGE_CONTEXT_INVALID', `Closure ${name} does not belong to the requested feature context.`);
        }
        return record;
      });
  };
  const receipts = readKind('receipts');
  assertShipReceiptLineage(receipts);
  const supersededReceiptHashes = new Set(receipts.map(({ startedFromReceiptHash }) => startedFromReceiptHash).filter(Boolean));
  const projectionOwner = receipts
    .filter(({ receiptHash }) => !supersededReceiptHashes.has(receiptHash))
    .sort((left, right) => left.terminal.at.localeCompare(right.terminal.at) || left.runId.localeCompare(right.runId))
    .at(-1);
  const projectionVerified = projectRoot && projectionOwner ? verifyShipCompatibilityProjection(projectionOwner, {
      projectRoot,
      prepared: { root: featureRoot, closureRepositories },
    }) : false;
  const receiptByRun = new Map(receipts.map((receipt) => [receipt.runId, receipt]));
  const active = readKind('active').flatMap((record) => {
    const receipt = receiptByRun.get(record.runId);
    if (!receipt) return [shipClosureSummary(record)];
    if (!receiptExtendsActive(receipt, record)) fail('E_SHIP_CLOSURE_DIVERGED', `Active and terminal custody diverge for ${record.runId}.`);
    return [];
  });
  return { active, terminal: receipts.map((receipt) => ({ ...shipClosureSummary(receipt), projectionVerified })) };
}

export function assertShipClosure(value) {
  return assertClosure(value);
}

export { reduceShipClosure } from './ship-closure-reducer.mjs';
