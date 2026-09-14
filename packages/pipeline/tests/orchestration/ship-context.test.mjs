import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { assertContextEnvelope } from '../../lib/pipeline/context-envelope.mjs';
import { materializeLegacyPlanningFixture } from '../helpers/legacy-planning-fixture.mjs';

import {
  buildPlanContext,
  buildShipContext,
  renderPlanContext,
  renderShipContext,
} from '../../lib/pipeline/ship-context.mjs';

// SHIP requires the project root to be a Git top-level, so the fixture is staged into
// a disposable repository. Both context builders then read byte-identical input.
const projectRoot = materializeLegacyPlanningFixture();
execFileSync('git', ['init', '-q'], { cwd: projectRoot });
execFileSync('git', ['add', '-A'], { cwd: projectRoot });
execFileSync(
  'git',
  ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-qm', 'fixture'],
  { cwd: projectRoot },
);
after(() => rmSync(projectRoot, { recursive: true, force: true }));

const request = { projectRoot, feature: 'legacy-plan' };

test('a planned feature builds a valid envelope from its own artifacts', () => {
  const envelope = assertContextEnvelope(buildShipContext(request));
  assert.match(envelope.objective.summary, /Legacy Plan/u);
  assert.ok(envelope.requirements.some((entry) => entry.startsWith('FR-')), 'requirements come from the spec');
  assert.ok(envelope.acceptanceCriteria.length > 1, 'acceptance criteria come from the spec');
});

test('ordinary context does not initialize release gates or require a stack definition', () => {
  const contextRoot = materializeLegacyPlanningFixture();
  const configPath = join(contextRoot, '.planr', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.shipClosure = { gates: 'release-only configuration is intentionally invalid here' };
  writeFileSync(configPath, JSON.stringify(config));
  rmSync(join(contextRoot, 'input', 'tech', 'stack.md'));
  execFileSync('git', ['init', '-q'], { cwd: contextRoot });
  execFileSync('git', ['add', '-A'], { cwd: contextRoot });
  execFileSync(
    'git',
    ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-qm', 'fixture'],
    { cwd: contextRoot },
  );

  try {
    const envelope = assertContextEnvelope(buildShipContext({ projectRoot: contextRoot, feature: 'legacy-plan' }));
    assert.doesNotMatch(envelope.architecture.join('\n'), /Technical stack/u);
    assert.match(envelope.objective.summary, /Legacy Plan/u);
  } finally {
    rmSync(contextRoot, { recursive: true, force: true });
  }
});

test('the coding context carries the active task, parent acceptance, stack, design, and database inputs', () => {
  const envelope = buildShipContext(request);
  const requirements = envelope.requirements.join('\n');
  const acceptance = envelope.acceptanceCriteria.join('\n');
  const architecture = envelope.architecture.join('\n');
  const startingPoints = envelope.startingPoints.join('\n');

  assert.match(requirements, /T-002 objective: Expose the active task's concrete implementation context/u);
  assert.match(requirements, /T-002 rationale: The runtime needs the selected task's concrete requirements/u);
  assert.match(requirements, /T-002 create: `src\/context-reader\.mjs`/u);
  assert.match(requirements, /T-002 modify: `src\/index\.mjs`/u);
  assert.match(requirements, /T-002 implementation: Read the task objective, file lists, and parent acceptance context/u);
  assert.match(acceptance, /T-002: The context names both files assigned to this task/u);
  assert.match(acceptance, /US-001: The coding runtime receives each active task's objective/u);
  assert.match(acceptance, /Scenario Carry the selected task into Ship/u);
  assert.match(requirements, /US-001: As a release owner, I want an older plan to remain readable/u);
  assert.doesNotMatch(requirements, /US-001: Compatibility background/u);

  assert.match(architecture, /Technical stack \(input\/tech\/stack\.md\)/u);
  assert.match(architecture, /Installed stack conventions \(backend\/nestjs\.md\)/u);
  assert.match(architecture, /Project stack override \(backend\/nestjs\.md, takes precedence\)/u);
  assert.match(architecture, /pure injectable services/u);
  assert.match(architecture, /Design context .*design\/design-spec\.md/u);
  assert.match(architecture, /neutral surface token/u);
  assert.match(architecture, /Database schema \(output\/db\/schema\.json\)/u);
  assert.match(architecture, /context_items/u);

  assert.match(startingPoints, /Task T-002 \(Tech\): .*\/tasks\/T-002-minimal\.md/u);
  assert.match(startingPoints, /Parent story US-001:/u);
  assert.match(startingPoints, /Project stack override: \.codex\/stacks\/backend\/nestjs\.md/u);
  assert.match(startingPoints, /Installed stack conventions: planr-pipeline\/stacks\/backend\/nestjs\.md/u);
  assert.doesNotMatch(startingPoints, /\/Users\/|\/home\//u);
  assert.deepEqual(envelope.externalActions, [], 'external effects are not inferred from generic spec sections');
  for (const collection of [envelope.requirements, envelope.acceptanceCriteria, envelope.architecture, envelope.startingPoints]) {
    assert.ok(collection.length <= 200, 'context collections remain bounded');
    assert.ok(collection.every((entry) => entry.length <= 4_000), 'each context entry remains bounded');
  }
});

test('stack context loads only the selected runtime host override', () => {
  const contextRoot = materializeLegacyPlanningFixture();
  const claudeStack = join(contextRoot, '.claude', 'stacks', 'backend');
  const cursorStack = join(contextRoot, '.cursor', 'stacks', 'backend');
  mkdirSync(claudeStack, { recursive: true });
  mkdirSync(cursorStack, { recursive: true });
  writeFileSync(join(claudeStack, 'nestjs.md'), '# Claude conventions\n\n- Use Claude-only service boundaries.\n');
  writeFileSync(join(cursorStack, 'nestjs.md'), '# Cursor conventions\n\n- Use Cursor-only service boundaries.\n');
  execFileSync('git', ['init', '-q'], { cwd: contextRoot });
  execFileSync('git', ['add', '-A'], { cwd: contextRoot });
  execFileSync(
    'git',
    ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-qm', 'fixture'],
    { cwd: contextRoot },
  );

  try {
    const options = { projectRoot: contextRoot, feature: 'legacy-plan' };
    const codex = buildShipContext({ ...options, runtime: 'codex' }).architecture.join('\n');
    const claude = buildShipContext({ ...options, runtime: 'claude-code' }).architecture.join('\n');
    const cursor = buildShipContext({ ...options, runtime: 'cursor' }).architecture.join('\n');

    assert.match(codex, /pure injectable services/u);
    assert.doesNotMatch(codex, /Claude-only|Cursor-only/u);
    assert.match(claude, /Claude-only service boundaries/u);
    assert.doesNotMatch(claude, /pure injectable services|Cursor-only/u);
    assert.match(cursor, /Cursor-only service boundaries/u);
    assert.doesNotMatch(cursor, /pure injectable services|Claude-only/u);
  } finally {
    rmSync(contextRoot, { recursive: true, force: true });
  }
});

test('repository ownership and preserve boundaries survive the mapping', () => {
  const { boundaries } = buildShipContext(request);
  assert.ok(boundaries.repositories.length > 0, 'ownership boundaries reach the runtime');
  assert.ok(
    boundaries.doNotChange.some((entry) => entry.includes('.planr/operate')),
    'protected Operate state must be named as unchangeable',
  );
  assert.ok(
    boundaries.doNotChange.some((entry) => entry.startsWith('openplanr:')),
    'a boundary in another repository survives the mapping',
  );
  assert.ok(
    boundaries.doNotChange.includes('project: config/legacy-preserve.json'),
    'a body-only legacy Preserve entry remains readable',
  );
});

test('the context is stable across builds', () => {
  // A retry reuses the current workspace and plan, so nothing may vary per run.
  assert.deepEqual(buildShipContext(request), buildShipContext(request));
});

test('the rendered context carries no execution supervision', () => {
  // Constraints quoted from the reviewed spec may mention closure rules — that is product
  // content the runtime should know. What must never appear is Planr's own scaffolding
  // being handed over as instructions to follow.
  const rendered = renderShipContext(request);
  for (const machinery of ['sealed candidate', 'reviewerIds', 'finalize-ship', '--run-id', 'advance-ship', 'evidenceDigest']) {
    assert.ok(!rendered.toLowerCase().includes(machinery.toLowerCase()), `must not carry ${machinery}`);
  }
  assert.match(rendered, /Use the specification, active task details, repository context, and conventions above/u);
  assert.ok(!/^\s*\d+\.\s+Run `planr pipeline/mu.test(rendered), 'must not script CLI steps');
  assert.doesNotMatch(rendered, /approval|authorization|stopping point/iu);
});

test('an unknown feature fails with a usable message', () => {
  assert.throws(
    () => buildPlanContext({ ...request, feature: 'no-such-feature-exists' }),
    (error) => typeof error.code === 'string' && error.code.startsWith('E_'),
  );
});

test('the recorded dependency graph reaches the runtime intact', () => {
  const { dependencies } = buildShipContext(request);
  const byTask = new Map(dependencies.map(({ task, requires }) => [task, requires]));
  assert.deepEqual(byTask.get('T-002'), ['T-001']);
  assert.deepEqual(byTask.get('T-003'), ['T-001', 'T-002']);
  assert.ok(!byTask.has('T-001'), 'an unblocked task carries no dependency row');
});

test('PLAN and SHIP derive the same feature context', () => {
  const plan = buildPlanContext(request);
  const ship = buildShipContext(request);
  assert.deepEqual(plan.dependencies, ship.dependencies, 'dependency graph must survive the gate');
  assert.deepEqual(plan.boundaries.doNotChange, ship.boundaries.doNotChange, 'preserve boundaries must survive');
  assert.deepEqual(plan.acceptanceCriteria, ship.acceptanceCriteria);
  assert.deepEqual(plan.requirements, ship.requirements);
  assert.equal(plan.objective.summary, ship.objective.summary);
});

test('PLAN reads authored tasks directly, before any SHIP boundary', () => {
  const plan = buildPlanContext(request);
  assert.ok(plan.startingPoints.some((entry) => /Tasks in scope: T-001/u.test(entry)));
  assert.match(renderPlanContext(request), /## Dependencies/u);
});

test('the plan context carries dependencies without schedule boilerplate', () => {
  const rendered = renderPlanContext(request);
  assert.match(rendered, /## Dependencies/u);
  assert.doesNotMatch(rendered, /choose the schedule|how much runs at once|stopping point/iu);
  for (const machinery of ['sealed candidate', 'reviewerIds', 'finalize-ship', 'advance-ship']) {
    assert.ok(!rendered.toLowerCase().includes(machinery.toLowerCase()), `must not carry ${machinery}`);
  }
});

test('a wrapped acceptance criterion survives intact', () => {
  // Criteria are routinely wrapped across lines and the assertion lives in the trailing
  // clause; truncating at the newline silently ships half a requirement.
  const { acceptanceCriteria } = buildPlanContext(request);
  for (const entry of acceptanceCriteria) {
    assert.ok(!/,$/u.test(entry), `criterion must not end mid-clause: ${entry}`);
  }
  assert.ok(
    acceptanceCriteria.some((entry) => /then/u.test(entry)),
    'a Given/When/Then criterion keeps its Then clause',
  );
});

test('a qualified default selector loads only the matching duplicate task context', () => {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-default-context-'));
  mkdirSync(join(root, '.planr'), { recursive: true });
  mkdirSync(join(root, 'input', 'specs'), { recursive: true });
  writeFileSync(join(root, '.planr', 'config.json'), '{}');
  writeFileSync(join(root, 'input', 'specs', 'spec-auth.md'), [
    '# Auth', '', '## Context & Goal', '', 'Implement auth.', '',
    '## Acceptance Criteria', '', '- The selected task is delivered.',
  ].join('\n'));
  for (const [index, storyId] of ['US-001', 'US-002'].entries()) {
    const storyDir = `us-${index + 1}`;
    const storyRoot = join(root, 'output', 'feats', 'feat-auth', storyDir);
    mkdirSync(join(storyRoot, 'tasks'), { recursive: true });
    writeFileSync(join(storyRoot, `${storyDir}.md`), `---\nid: "${storyId}"\nstatus: "pending"\n---\n`);
    writeFileSync(join(storyRoot, 'tasks', 'task-1.md'), [
      '---', 'id: "T-001"', `storyId: "${storyId}"`, 'status: "pending"',
      'dependsOn: []', '---', '', '## Technical Spec', '', `- Implement ${storyId} marker.`,
    ].join('\n'));
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync(
    'git',
    ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-qm', 'fixture'],
    { cwd: root },
  );

  try {
    const plan = buildPlanContext({ projectRoot: root, feature: 'auth' });
    assert.match(plan.startingPoints.join('\n'), /Tasks in scope: US-001\/T-001, US-002\/T-001/u);
    assert.match(plan.requirements.join('\n'), /US-001\/T-001 implementation: Implement US-001 marker/u);
    assert.match(plan.requirements.join('\n'), /US-002\/T-001 implementation: Implement US-002 marker/u);

    const envelope = buildShipContext({ projectRoot: root, feature: 'auth', taskId: 'US-002/T-001' });
    const requirements = envelope.requirements.join('\n');
    assert.match(requirements, /US-002\/T-001 implementation: Implement US-002 marker/u);
    assert.doesNotMatch(requirements, /US-001\/T-001|Implement US-001 marker/u);
    assert.match(envelope.startingPoints.join('\n'), /Tasks in scope: US-002\/T-001/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
