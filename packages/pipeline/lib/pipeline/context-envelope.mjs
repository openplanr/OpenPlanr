import { PipelineError } from './errors.mjs';

export const CONTEXT_ENVELOPE_SCHEMA_VERSION = '1.0.0';

const ENVELOPE_FIELDS = Object.freeze([
  'schemaVersion',
  'objective',
  'requirements',
  'acceptanceCriteria',
  'decisions',
  'architecture',
  'boundaries',
  'dependencies',
  'risks',
  'startingPoints',
  'externalActions',
]);

const OPTIONAL_FIELDS = Object.freeze([
  'decisions',
  'dependencies',
  'architecture',
  'risks',
  'startingPoints',
  'externalActions',
]);

/**
 * Keys that would turn context into instruction.
 *
 * An envelope describes the work; it never describes how a runtime should think,
 * sequence, staff, retry, or decide it is finished. Rejecting these structurally is
 * cheaper than reviewing prose for them, and it keeps a well-meaning caller from
 * reintroducing supervision one field at a time.
 */
export const GOVERNANCE_FIELDS = Object.freeze([
  'agent', 'agents', 'subagents', 'roster', 'personas', 'reviewers', 'reviewer',
  'model', 'models', 'effort', 'reasoning', 'thinking',
  'tools', 'toolChoice', 'dispatch', 'dispatchStyle', 'concurrency', 'waves',
  'sequence', 'order', 'implementationOrder', 'steps', 'procedure', 'workflow',
  'retries', 'retry', 'corrections', 'correctionBudget', 'passes', 'attempts',
  'gates', 'gate', 'lifecycle', 'stateMachine', 'terminalState',
  'proof', 'evidence', 'receipts', 'digest', 'digests', 'fingerprint', 'fingerprints',
  'testStrategy', 'testCommand', 'reviewStrategy', 'stoppingPoint', 'completion',
]);

const GOVERNANCE_LOOKUP = new Set(GOVERNANCE_FIELDS.map((key) => key.toLowerCase()));

function fail(message, fix = '', details = undefined) {
  throw new PipelineError('E_CONTEXT_ENVELOPE_INVALID', message, fix, details);
}

function text(value, label, max = 4_000) {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > max) {
    fail(`${label} must be trimmed text between 1 and ${max} characters.`);
  }
  return value;
}

function textList(value, label, { min = 0, max = 200 } = {}) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  if (value.length < min) fail(`${label} needs at least ${min} entr${min === 1 ? 'y' : 'ies'}.`);
  if (value.length > max) fail(`${label} allows at most ${max} entries.`);
  value.forEach((entry, index) => text(entry, `${label}[${index}]`));
  return Object.freeze([...value]);
}

/** Rejects governance keys at any depth, including inside arrays. */
function assertNoGovernance(value, path = 'envelope') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGovernance(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (GOVERNANCE_LOOKUP.has(key.toLowerCase())) {
      fail(
        `${path}.${key} directs how the coding runtime works; a context envelope carries only what the work is.`,
        'Move the requirement into requirements or acceptanceCriteria, or drop it and let the runtime choose.',
        { field: key, path },
      );
    }
    assertNoGovernance(nested, `${path}.${key}`);
  }
}

function assertObjective(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('objective must be one object.');
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['summary', 'userValue'])) {
    fail('objective must carry exactly summary and userValue.');
  }
  text(value.summary, 'objective.summary', 400);
  text(value.userValue, 'objective.userValue');
  return value;
}

function assertDecisions(value) {
  if (!Array.isArray(value)) fail('decisions must be an array.');
  if (value.length > 100) fail('decisions allows at most 100 entries.');
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`decisions[${index}] must be one object.`);
    const keys = Object.keys(entry).sort();
    const allowed = ['decision', 'rationale'];
    if (keys.some((key) => !allowed.includes(key))) fail(`decisions[${index}] has unknown fields.`);
    text(entry.decision, `decisions[${index}].decision`);
    if (entry.rationale !== undefined) text(entry.rationale, `decisions[${index}].rationale`);
  });
  return value;
}

/**
 * Validates the dependency graph.
 *
 * This is a partial order derived from the work — what genuinely blocks what — not a
 * schedule. The runtime still chooses how wide to fan out and in which order to take
 * whatever is unblocked. A graph that is cyclic or references a task that does not
 * exist is a planning defect, so it fails here rather than confusing a runtime later.
 */
function assertDependencies(value) {
  if (!Array.isArray(value)) fail('dependencies must be an array.');
  if (value.length > 500) fail('dependencies allows at most 500 entries.');
  const requiredBy = new Map();
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`dependencies[${index}] must be one object.`);
    const keys = Object.keys(entry).sort();
    const allowed = ['reason', 'requires', 'task'];
    if (keys.some((key) => !allowed.includes(key))) fail(`dependencies[${index}] has unknown fields.`);
    text(entry.task, `dependencies[${index}].task`, 120);
    textList(entry.requires, `dependencies[${index}].requires`, { min: 1, max: 100 });
    if (entry.reason !== undefined) text(entry.reason, `dependencies[${index}].reason`);
    if (requiredBy.has(entry.task)) fail(`dependencies declares ${entry.task} twice.`);
    requiredBy.set(entry.task, entry.requires);
  });

  const state = new Map();
  const walk = (task, trail) => {
    if (state.get(task) === 'done') return;
    if (state.get(task) === 'open') {
      fail(
        `dependencies contain a cycle: ${[...trail, task].join(' -> ')}.`,
        'Break the cycle in the planning artifacts; a coding runtime cannot satisfy it in any order.',
      );
    }
    state.set(task, 'open');
    for (const required of requiredBy.get(task) ?? []) walk(required, [...trail, task]);
    state.set(task, 'done');
  };
  for (const task of requiredBy.keys()) walk(task, []);
  return value;
}

function assertBoundaries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('boundaries must be one object.');
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['doNotChange', 'repositories'])) {
    fail('boundaries must carry exactly repositories and doNotChange.');
  }
  if (!Array.isArray(value.repositories)) fail('boundaries.repositories must be an array.');
  value.repositories.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`boundaries.repositories[${index}] must be one object.`);
    const repoKeys = Object.keys(entry).sort();
    if (JSON.stringify(repoKeys) !== JSON.stringify(['name', 'role'])) {
      fail(`boundaries.repositories[${index}] must carry exactly name and role.`);
    }
    text(entry.name, `boundaries.repositories[${index}].name`, 200);
    text(entry.role, `boundaries.repositories[${index}].role`);
  });
  textList(value.doNotChange, 'boundaries.doNotChange');
  return value;
}

/** Validates an envelope and returns it unchanged. Throws on the first problem. */
export function assertContextEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) fail('A context envelope must be one object.');

  const present = Object.keys(envelope);
  const unknown = present.filter((key) => !ENVELOPE_FIELDS.includes(key));
  if (unknown.length) {
    const governance = unknown.filter((key) => GOVERNANCE_LOOKUP.has(key.toLowerCase()));
    if (governance.length) assertNoGovernance(envelope);
    fail(`A context envelope has unknown fields: ${unknown.join(', ')}.`);
  }
  const missing = ENVELOPE_FIELDS.filter((key) => !OPTIONAL_FIELDS.includes(key) && !present.includes(key));
  if (missing.length) fail(`A context envelope is missing: ${missing.join(', ')}.`);

  assertNoGovernance(envelope);

  if (envelope.schemaVersion !== CONTEXT_ENVELOPE_SCHEMA_VERSION) {
    fail(`schemaVersion must be ${CONTEXT_ENVELOPE_SCHEMA_VERSION}.`);
  }
  assertObjective(envelope.objective);
  textList(envelope.requirements, 'requirements', { min: 1 });
  textList(envelope.acceptanceCriteria, 'acceptanceCriteria', { min: 1 });
  assertDecisions(envelope.decisions ?? []);
  textList(envelope.architecture ?? [], 'architecture');
  assertBoundaries(envelope.boundaries);
  assertDependencies(envelope.dependencies ?? []);
  textList(envelope.risks ?? [], 'risks');
  textList(envelope.startingPoints ?? [], 'startingPoints');
  textList(envelope.externalActions ?? [], 'externalActions');
  return envelope;
}

/** Builds a validated envelope, filling the optional collections. */
export function buildContextEnvelope(input = {}) {
  const envelope = {
    schemaVersion: CONTEXT_ENVELOPE_SCHEMA_VERSION,
    objective: input.objective,
    requirements: input.requirements ?? [],
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    decisions: input.decisions ?? [],
    architecture: input.architecture ?? [],
    boundaries: {
      repositories: input.boundaries?.repositories ?? [],
      doNotChange: input.boundaries?.doNotChange ?? [],
    },
    dependencies: input.dependencies ?? [],
    risks: input.risks ?? [],
    startingPoints: input.startingPoints ?? [],
    externalActions: input.externalActions ?? [],
  };
  return Object.freeze(assertContextEnvelope(envelope));
}

const SECTIONS = Object.freeze([
  ['requirements', 'Requirements'],
  ['acceptanceCriteria', 'Acceptance criteria'],
  ['architecture', 'Architecture context'],
  ['risks', 'Known risks'],
  ['startingPoints', 'Useful starting points'],
]);

/**
 * Renders the envelope as host-neutral Markdown.
 *
 * Identical for every runtime: naming a vendor here is how vendor-specific instruction
 * creeps back in.
 */
export function renderContextEnvelope(envelope) {
  assertContextEnvelope(envelope);
  const lines = ['# Working context', '', `## Objective`, '', envelope.objective.summary, '', `**User value.** ${envelope.objective.userValue}`, ''];

  for (const [field, heading] of SECTIONS) {
    const entries = envelope[field] ?? [];
    if (!entries.length) continue;
    lines.push(`## ${heading}`, '');
    entries.forEach((entry) => lines.push(`- ${entry}`));
    lines.push('');
  }

  const decisions = envelope.decisions ?? [];
  if (decisions.length) {
    lines.push('## Decisions already made', '');
    decisions.forEach((entry) => {
      lines.push(entry.rationale ? `- ${entry.decision} — ${entry.rationale}` : `- ${entry.decision}`);
    });
    lines.push('');
  }

  const dependencies = envelope.dependencies ?? [];
  if (dependencies.length) {
    const blocked = new Set(dependencies.map((entry) => entry.task));
    const mentioned = new Set([...blocked, ...dependencies.flatMap((entry) => entry.requires)]);
    const unblocked = [...mentioned].filter((task) => !blocked.has(task)).sort();
    lines.push('## Dependencies', '');
    if (unblocked.length) {
      lines.push(`No declared predecessors: ${unblocked.join(', ')}.`, '');
    }
    dependencies.forEach((entry) => {
      const because = entry.reason ? ` — ${entry.reason}` : '';
      lines.push(`- ${entry.task} needs ${entry.requires.join(', ')}${because}`);
    });
    lines.push('');
  }

  const { repositories, doNotChange } = envelope.boundaries;
  if (repositories.length) {
    lines.push('## Repositories', '');
    repositories.forEach((repo) => lines.push(`- \`${repo.name}\` — ${repo.role}`));
    lines.push('');
  }
  if (doNotChange.length) {
    lines.push('## Must remain unchanged', '');
    doNotChange.forEach((entry) => lines.push(`- ${entry}`));
    lines.push('');
  }

  const externalActions = envelope.externalActions ?? [];
  if (externalActions.length) {
    lines.push('## Explicit external effects', '');
    externalActions.forEach((entry) => lines.push(`- ${entry}`));
    lines.push('');
  }

  lines.push(
    '## Implementation',
    '',
    'Use the specification, active task details, repository context, and conventions above.',
    'Implement the requested outcome and return changed files, checks run, and any material remaining issue.',
    '',
  );
  return lines.join('\n');
}
