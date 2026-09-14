import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONTEXT_ENVELOPE_SCHEMA_VERSION,
  GOVERNANCE_FIELDS,
  assertContextEnvelope,
  buildContextEnvelope,
  renderContextEnvelope,
} from '../../lib/pipeline/context-envelope.mjs';

const objective = {
  summary: 'Add a landing command to the CLI.',
  userValue: 'An owner can land reviewed work without hand-running four repositories.',
};

const minimal = {
  objective,
  requirements: ['The command refuses to run against a non-disposable target.'],
  acceptanceCriteria: ['Landing a disposable target reports the target and exits zero.'],
  boundaries: {
    repositories: [{ name: 'OpenPlanr', role: 'user-facing CLI and local runtime services' }],
    doNotChange: ['.planr/operate/'],
  },
};

test('a minimal envelope validates and fills its optional collections', () => {
  const envelope = buildContextEnvelope(minimal);
  assert.equal(envelope.schemaVersion, CONTEXT_ENVELOPE_SCHEMA_VERSION);
  assert.deepEqual(envelope.decisions, []);
  assert.deepEqual(envelope.risks, []);
  assert.deepEqual(envelope.externalActions, []);
});

test('the same input always builds the same envelope', () => {
  // A retry must reuse the current workspace and plan, so the envelope cannot depend
  // on run identity, ordering, or a clock.
  assert.deepEqual(buildContextEnvelope(minimal), buildContextEnvelope(minimal));
});

test('every governance field is refused at the top level', () => {
  for (const field of GOVERNANCE_FIELDS) {
    assert.throws(
      () => assertContextEnvelope({ ...buildContextEnvelope(minimal), [field]: 'anything' }),
      (error) => error.code === 'E_CONTEXT_ENVELOPE_INVALID',
      `${field} must be refused`,
    );
  }
});

test('a governance field nested inside allowed structure is still refused', () => {
  assert.throws(
    () =>
      buildContextEnvelope({
        ...minimal,
        decisions: [{ decision: 'Use the existing adapter.', rationale: 'It already ships.' }],
        boundaries: { ...minimal.boundaries, repositories: [{ name: 'OpenPlanr', role: 'CLI' }] },
        architecture: ['Reuse the connector runtime.'],
        risks: ['The target may not be disposable.'],
        startingPoints: ['src/services/'],
        externalActions: ['publishing to npm'],
        // a caller sneaking supervision in one level down
        objective: { ...objective, retries: 3 },
      }),
    /directs how the coding runtime works|exactly summary and userValue/,
  );
});

test('the error names the offending field and offers the alternative', () => {
  try {
    assertContextEnvelope({ ...buildContextEnvelope(minimal), reviewers: ['qa'] });
    assert.fail('expected a refusal');
  } catch (error) {
    assert.match(error.message, /reviewers/);
    assert.match(error.fix ?? '', /requirements or acceptanceCriteria/);
  }
});

test('unknown non-governance fields are refused too', () => {
  assert.throws(
    () => assertContextEnvelope({ ...buildContextEnvelope(minimal), sprintNumber: 4 }),
    /unknown fields: sprintNumber/,
  );
});

test('requirements and acceptance criteria may not be empty', () => {
  assert.throws(() => buildContextEnvelope({ ...minimal, requirements: [] }), /requirements needs at least 1/);
  assert.throws(() => buildContextEnvelope({ ...minimal, acceptanceCriteria: [] }), /acceptanceCriteria needs at least 1/);
});

test('the rendered context is host-neutral and prescribes no workflow', () => {
  const rendered = renderContextEnvelope(
    buildContextEnvelope({
      ...minimal,
      decisions: [{ decision: 'Land through the existing CLI.', rationale: 'No new surface.' }],
      externalActions: ['publishing a package'],
    }),
  );
  for (const vendor of ['Claude', 'Codex', 'Cursor', 'GPT', 'Anthropic', 'OpenAI']) {
    assert.ok(!rendered.includes(vendor), `rendered context must not name ${vendor}`);
  }
  for (const directive of ['subagent', 'retry', 'correction pass', 'reviewer', 'dispatch']) {
    assert.ok(!rendered.toLowerCase().includes(directive), `rendered context must not prescribe ${directive}`);
  }
  assert.match(rendered, /Use the specification, active task details, repository context, and conventions above/);
  assert.match(rendered, /Explicit external effects/);
  assert.match(rendered, /publishing a package/);
  assert.doesNotMatch(rendered, /stopping point|confirm before|approval|authorization/iu);
});

test('real external actions survive the simplification', () => {
  const envelope = buildContextEnvelope({ ...minimal, externalActions: ['deploying to production'] });
  assert.deepEqual(envelope.externalActions, ['deploying to production']);
});

test('a dependency graph is context, but a prescribed order is not', () => {
  const withGraph = buildContextEnvelope({
    ...minimal,
    dependencies: [
      { task: 'T-002', requires: ['T-001'], reason: 'consumes the contracts T-001 defines' },
      { task: 'T-003', requires: ['T-001', 'T-002'] },
    ],
  });
  assert.equal(withGraph.dependencies.length, 2);

  // The same information shaped as a schedule is still refused.
  assert.throws(
    () => assertContextEnvelope({ ...withGraph, implementationOrder: ['T-001', 'T-002', 'T-003'] }),
    /directs how the coding runtime works/,
  );
});

test('a cyclic graph is a planning defect and fails before a runtime sees it', () => {
  assert.throws(
    () =>
      buildContextEnvelope({
        ...minimal,
        dependencies: [
          { task: 'T-001', requires: ['T-002'] },
          { task: 'T-002', requires: ['T-001'] },
        ],
      }),
    /contain a cycle: T-001 -> T-002 -> T-001|contain a cycle/,
  );
});

test('a task may not be declared twice in the graph', () => {
  assert.throws(
    () =>
      buildContextEnvelope({
        ...minimal,
        dependencies: [
          { task: 'T-002', requires: ['T-001'] },
          { task: 'T-002', requires: ['T-003'] },
        ],
      }),
    /declares T-002 twice/,
  );
});

test('the rendered graph names dependency facts without scheduling work', () => {
  const rendered = renderContextEnvelope(
    buildContextEnvelope({
      ...minimal,
      dependencies: [
        { task: 'T-002', requires: ['T-001'] },
        { task: 'T-003', requires: ['T-002'] },
      ],
    }),
  );
  assert.match(rendered, /No declared predecessors: T-001/u);
  assert.match(rendered, /T-002 needs T-001/u);
  assert.doesNotMatch(rendered, /take(?:n)? in any order|choose the schedule|how much runs at once/iu);
  for (const scheduling of ['first', 'then ', 'step 1', 'in this order']) {
    assert.ok(!rendered.toLowerCase().includes(scheduling), `must not schedule (${scheduling})`);
  }
});
