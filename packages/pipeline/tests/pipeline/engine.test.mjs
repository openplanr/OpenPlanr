import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { prepareShipContext } from '../../lib/pipeline/engine.mjs';
import {
  completePlan,
  nextShipBatch,
  preparePlan,
  prepareShip,
} from '../../lib/pipeline/index.mjs';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-engine-'));
  mkdirSync(join(root, '.planr'), { recursive: true });
  mkdirSync(join(root, 'input', 'tech'), { recursive: true });
  writeFileSync(
    join(root, '.planr', 'config.json'),
    JSON.stringify({ idPrefix: { spec: 'SPEC' } }),
  );
  writeFileSync(
    join(root, 'input', 'tech', 'stack.md'),
    'BuildCommand: "node --version"\nTestCommand: "node --version"\n',
  );
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: root });
  return root;
}

function decompose(root, slug = 'auth') {
  const prepared = preparePlan({ projectRoot: root, feature: slug, scaffold: true });
  writeFileSync(
    join(prepared.specDir, 'stories', 'US-001-login.md'),
    declaredArtifact({
      id: 'US-001',
      title: 'Log in',
      specId: 'SPEC-001',
      slug: 'login',
      schemaVersion: '1.0.0',
      status: 'pending',
      created: '2026-07-12',
      updated: '2026-07-12',
    }),
  );
  writeFileSync(
    join(prepared.specDir, 'tasks', 'T-001-api.md'),
    declaredArtifact(
      {
        id: 'T-001',
        title: 'Implement login API',
        storyId: 'US-001',
        specId: 'SPEC-001',
        slug: 'login-api',
        schemaVersion: '1.0.0',
        type: 'Tech',
        agent: 'backend-agent',
        status: 'pending',
        created: '2026-07-12',
        updated: '2026-07-12',
        dependsOn: [],
      },
      '## Preserve\n\n- `README.md`\n\n## Definition of done\n\n- [ ] API shipped\n',
    ),
  );
  writeFileSync(
    join(prepared.specDir, 'tasks', 'T-002-ui.md'),
    declaredArtifact(
      {
        id: 'T-002',
        title: 'Connect login UI',
        storyId: 'US-001',
        specId: 'SPEC-001',
        slug: 'login-ui',
        schemaVersion: '1.0.0',
        type: 'UI',
        agent: 'frontend-agent',
        status: 'pending',
        created: '2026-07-12',
        updated: '2026-07-12',
        dependsOn: ['T-001'],
      },
      '## Definition of done\n\n- [ ] UI shipped\n',
    ),
  );
  return prepared;
}

function defaultModeFeature(root, stories, { canonical = false } = {}) {
  writeFileSync(join(root, '.planr', 'config.json'), '{}');
  mkdirSync(join(root, 'input', 'specs'), { recursive: true });
  writeFileSync(
    join(root, 'input', 'specs', 'spec-auth.md'),
    canonical
      ? declaredArtifact(
          {
            id: 'FEAT-001',
            title: 'Authentication',
            slug: 'auth',
            schemaVersion: '1.0.0',
            status: 'decomposed',
            priority: 'P1',
            created: '2026-08-30',
            updated: '2026-08-30',
            ui_files: [],
            tech_dependencies: [],
          },
          '# Authentication\n',
        )
      : '# Auth\n',
  );
  for (const [storyIndex, story] of stories.entries()) {
    const storyDir = `us-${storyIndex + 1}`;
    const base = join(root, 'output', 'feats', 'feat-auth', storyDir);
    mkdirSync(join(base, 'tasks'), { recursive: true });
    writeFileSync(
      join(base, `${storyDir}.md`),
      canonical
        ? declaredArtifact({
            id: story.id,
            title: `Story ${story.id}`,
            featureSlug: 'auth',
            slug: `story-${storyIndex + 1}`,
            schemaVersion: '1.0.0',
            status: 'pending',
            created: '2026-08-30',
            updated: '2026-08-30',
          })
        : `---\nid: "${story.id}"\nstatus: "pending"\n---\n`,
    );
    for (const [taskIndex, task] of story.tasks.entries()) {
      writeFileSync(
        join(base, 'tasks', `task-${taskIndex + 1}.md`),
        canonical
          ? declaredArtifact(
              {
                id: task.id,
                title: `Task ${task.id}`,
                storyId: story.id,
                featureSlug: 'auth',
                slug: `task-${taskIndex + 1}`,
                schemaVersion: '1.0.0',
                type: 'Tech',
                agent: 'backend-agent',
                status: task.status ?? 'pending',
                created: '2026-08-30',
                updated: '2026-08-30',
                dependsOn: task.dependsOn ?? [],
              },
              `## Technical Spec\n\n- Implement ${story.id} ${task.id}.\n`,
            )
          : `---\nid: "${task.id}"\nstoryId: "${story.id}"\nstatus: "${task.status ?? 'pending'}"\ndependsOn: [${(task.dependsOn ?? []).join(', ')}]\n---\n\n## Technical Spec\n\n- Implement ${story.id} ${task.id}.\n`,
      );
    }
  }
}

function declaredArtifact(frontmatter, body = '') {
  const lines = Object.entries(frontmatter).map(
    ([key, value]) => `${key}: ${JSON.stringify(value)}`,
  );
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

function decomposeDeclared(root, { spec = {}, story = {}, task = {} } = {}) {
  const prepared = preparePlan({ projectRoot: root, feature: 'auth', scaffold: true });
  if (Object.keys(spec).length > 0) {
    const specPath = join(prepared.specDir, 'SPEC-001-auth.md');
    let markdown = readFileSync(specPath, 'utf8');
    for (const [key, value] of Object.entries(spec)) {
      markdown = markdown.replace(
        new RegExp(`^${key}:.*$`, 'mu'),
        `${key}: ${JSON.stringify(value)}`,
      );
    }
    writeFileSync(specPath, markdown);
  }
  writeFileSync(
    join(prepared.specDir, 'stories', 'US-001-login.md'),
    declaredArtifact(
      {
        id: 'US-001',
        title: 'Log in',
        specId: 'SPEC-001',
        slug: 'login',
        schemaVersion: '1.0.0',
        status: 'pending',
        created: '2026-08-30',
        updated: '2026-08-30',
        ...story,
      },
      '## Acceptance Criteria\n\n- Given valid credentials, when submitted, then access is granted.\n',
    ),
  );
  writeFileSync(
    join(prepared.specDir, 'tasks', 'T-001-login.md'),
    declaredArtifact(
      {
        id: 'T-001',
        title: 'Implement login',
        storyId: 'US-001',
        specId: 'SPEC-001',
        slug: 'login',
        schemaVersion: '1.0.0',
        type: 'Tech',
        agent: 'backend-agent',
        status: 'pending',
        created: '2026-08-30',
        updated: '2026-08-30',
        rationale: 'The login story needs the application service and its tests.',
        dependsOn: [],
        preserve: [],
        ...task,
      },
      '## Objective\n\nImplement login.\n\n## Definition of Done\n\n- Login tests pass.\n',
    ),
  );
  return prepared;
}

function decomposeV17(root) {
  const prepared = preparePlan({ projectRoot: root, feature: 'auth', scaffold: true });
  writeFileSync(
    join(prepared.specDir, 'SPEC-001-auth.md'),
    declaredArtifact(
      {
        id: 'SPEC-001',
        title: 'Authentication',
        slug: 'auth',
        schemaVersion: '1.7.0',
        status: 'decomposed',
        priority: 'P1',
        created: '2026-09-02',
        updated: '2026-09-02',
        ui_files: [],
        tech_dependencies: [],
      },
      '# Authentication\n',
    ),
  );
  writeFileSync(
    join(prepared.specDir, 'stories', 'US-023-login.md'),
    [
      '---',
      'id: "US-023"',
      'title: "Log in"',
      'specId: "SPEC-001"',
      'slug: "login"',
      'schemaVersion: "1.7.0"',
      'status: "pending"',
      'created: "2026-09-02"',
      'updated: "2026-09-02"',
      'acceptanceCriteria:',
      '  - id: "AC-001"',
      '    statement: "A valid user can sign in."',
      '---',
      '',
      '## Acceptance Criteria',
      '',
      '- AC-001: A valid user can sign in.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(prepared.specDir, 'tasks', 'T-023-login.md'),
    declaredArtifact(
      {
        id: 'T-023',
        title: 'Implement login',
        storyId: 'US-023',
        specId: 'SPEC-001',
        slug: 'login',
        schemaVersion: '1.7.0',
        type: 'Tech',
        agent: 'backend-agent',
        status: 'pending',
        created: '2026-09-02',
        updated: '2026-09-02',
        rationale: 'The login story requires a tested authentication boundary.',
        dependsOn: [],
        preserve: [],
        reviewRisks: ['security'],
        browserSurfaces: ['authentication', 'session'],
        acceptanceRefs: ['AC-001'],
      },
      '## Test Requirements\n\n- AC-001: Verify a valid user can sign in.\n',
    ),
  );
  return prepared;
}

test('preparePlan scaffolds once without inventing a separate SHIP gate', () => {
  const root = project();
  const first = preparePlan({ projectRoot: root, feature: 'Auth', scaffold: true });
  const second = preparePlan({ projectRoot: root, feature: 'auth', scaffold: true });
  assert.equal(first.scaffolded, true);
  assert.equal(second.scaffolded, false);
  assert.equal(first.requiresHumanReviewBeforeShip, false);
  assert.equal(first.requiresSeparateShipInvocation, false);
  assert.equal(first.specDir, second.specDir);
  const scaffold = readFileSync(join(first.specDir, 'SPEC-001-auth.md'), 'utf8');
  for (const heading of [
    '## Context & Goal',
    '## Audience',
    '## Outcome & Measurement',
    '## Functional Requirements',
    '## Business Rules',
    '## Constraints',
    '## Evidence Expectations',
    '## Failure Modes',
    '## Rollback',
    '## Scope Boundaries',
    '## Acceptance Criteria',
    '## Declared Risk Specialists',
    '## Notes for Decomposition',
  ])
    assert.ok(scaffold.includes(heading), `scaffold must contain ${heading}`);
});

test('preparePlan scaffolds the packaged host-neutral stack template', () => {
  const root = project();
  rmSync(join(root, 'input', 'tech', 'stack.md'));
  const prepared = preparePlan({ projectRoot: root, feature: 'Auth', createStackTemplate: true });
  const stack = readFileSync(join(root, 'input', 'tech', 'stack.md'), 'utf8');
  assert.equal(prepared.stackTemplateCreated, true);
  assert.match(stack, /ActiveStackFiles:/u);
  assert.match(stack, /backend\/nestjs\.md/u);
  assert.doesNotMatch(stack, /\.claude\/stacks|3-iteration correction|correction loop/iu);
});

test('completePlan requires stories and tasks then appends provenance', () => {
  const root = project();
  decompose(root);
  const result = completePlan({
    projectRoot: root,
    feature: 'auth',
    runtime: 'codex',
    runId: 'run-1',
  });
  assert.equal(result.stories, 1);
  assert.equal(result.tasks, 2);
  assert.match(
    readFileSync(join(root, '.planr', 'provenance.jsonl'), 'utf8'),
    /"operation":"decomposed"/,
  );
});

test('completePlan validates declared Protocol v1 story and task frontmatter', () => {
  const root = project();
  decomposeDeclared(root);
  const result = completePlan({
    projectRoot: root,
    feature: 'auth',
    runtime: 'codex',
    runId: 'run-schema',
  });
  assert.equal(result.stories, 1);
  assert.equal(result.tasks, 1);
  assert.match(
    readFileSync(join(root, '.planr', 'provenance.jsonl'), 'utf8'),
    /"operation":"decomposed"/,
  );
});

test('Protocol 1.7 Plan artifacts validate and canonical task guidance reaches Ship', () => {
  const root = project();
  decomposeV17(root);

  const completed = completePlan({ projectRoot: root, feature: 'auth', runtime: 'codex' });
  const prepared = prepareShipContext({ projectRoot: root, feature: 'auth' });

  assert.equal(completed.stories, 1);
  assert.equal(completed.tasks, 1);
  assert.deepEqual(prepared.unresolvedTasks[0].reviewRisks, ['security']);
  assert.deepEqual(prepared.unresolvedTasks[0].browserSurfaces, ['authentication', 'session']);
  assert.deepEqual(prepared.unresolvedTasks[0].acceptanceRefs, ['AC-001']);
});

test('Ship translates legacy snake-case task guidance at read time', () => {
  const root = project();
  const prepared = decompose(root);
  const taskPath = join(prepared.specDir, 'tasks', 'T-001-api.md');
  const task = readFileSync(taskPath, 'utf8').replace(
    'dependsOn: []',
    'dependsOn: []\nreview_risks: ["migration"]\nbrowser_surfaces: ["network"]\nacceptance_refs: ["AC-001"]',
  );
  writeFileSync(taskPath, task);

  const ship = prepareShipContext({ projectRoot: root, feature: 'auth' });

  assert.deepEqual(ship.unresolvedTasks[0].reviewRisks, ['migration']);
  assert.deepEqual(ship.unresolvedTasks[0].browserSurfaces, ['network']);
  assert.deepEqual(ship.unresolvedTasks[0].acceptanceRefs, ['AC-001']);
});

test('completePlan validates and records the exact default-mode spec with us-N story discovery', () => {
  const root = project();
  defaultModeFeature(root, [{ id: 'US-001', tasks: [{ id: 'T-001' }] }], { canonical: true });

  const result = completePlan({
    projectRoot: root,
    feature: 'auth',
    runtime: 'codex',
    runId: 'run-default',
  });
  assert.equal(result.mode, 'default');
  assert.equal(result.stories, 1);
  assert.equal(result.tasks, 1);
  const event = JSON.parse(readFileSync(join(root, '.planr', 'provenance.jsonl'), 'utf8'));
  assert.equal(event.artifact_id, 'FEAT-001');
  assert.equal(event.artifact_path, 'input/specs/spec-auth.md');
});

test('completePlan keeps a truly schema-less default plan readable', () => {
  const root = project();
  defaultModeFeature(root, [{ id: 'US-001', tasks: [{ id: 'T-001' }] }]);

  const result = completePlan({ projectRoot: root, feature: 'auth', runId: 'run-legacy-default' });
  assert.equal(result.stories, 1);
  assert.equal(result.tasks, 1);
  assert.match(
    readFileSync(join(root, '.planr', 'provenance.jsonl'), 'utf8'),
    /input\/specs\/spec-auth\.md/u,
  );
});

test('a Protocol v1 parent requires Protocol v1 child frontmatter', () => {
  const root = project();
  const prepared = decomposeDeclared(root);
  const storyPath = join(prepared.specDir, 'stories', 'US-001-login.md');
  writeFileSync(storyPath, readFileSync(storyPath, 'utf8').replace(/^schemaVersion:.*\n/mu, ''));

  assert.throws(
    () => completePlan({ projectRoot: root, feature: 'auth' }),
    (error) =>
      error.code === 'E_PLAN_ARTIFACT_SCHEMA' &&
      error.details?.artifactKind === 'story' &&
      error.details?.errors?.[0]?.path === '$.schemaVersion',
  );
});

test('completePlan reports the exact invalid declared artifact before writing provenance', () => {
  const cases = [
    {
      changes: { spec: { priority: 'P9' } },
      kind: 'spec',
      path: 'SPEC-001-auth.md',
      errorPath: '$.priority',
    },
    {
      changes: { story: { status: 'hibernating' } },
      kind: 'story',
      path: 'stories/US-001-login.md',
      errorPath: '$.status',
    },
    {
      changes: { task: { type: 'UI', agent: 'backend-agent' } },
      kind: 'task',
      path: 'tasks/T-001-login.md',
      errorPath: '$',
    },
  ];

  for (const fixture of cases) {
    const root = project();
    decomposeDeclared(root, fixture.changes);
    assert.throws(
      () => completePlan({ projectRoot: root, feature: 'auth' }),
      (error) => {
        assert.equal(error.code, 'E_PLAN_ARTIFACT_SCHEMA');
        assert.equal(error.details?.artifactKind, fixture.kind);
        assert.match(
          error.details?.artifactPath ?? '',
          new RegExp(`${fixture.path.replaceAll('/', '\\/')}$`, 'u'),
        );
        assert.equal(error.details?.errors?.[0]?.path, fixture.errorPath);
        return true;
      },
    );
    assert.equal(existsSync(join(root, '.planr', 'provenance.jsonl')), false);
  }
});

test('prepareShip calculates the ready DAG batch without an approval flag', () => {
  const root = project();
  decompose(root);
  const prepared = prepareShip({ projectRoot: root, feature: 'auth' });
  const legacy = prepareShip({ projectRoot: root, feature: 'auth', humanReviewConfirmed: false });
  const batch = nextShipBatch(prepared.tasks);
  assert.deepEqual(
    batch.ready.map((task) => task.id),
    ['T-001'],
  );
  assert.equal(batch.deadlocked, false);
  assert.deepEqual(legacy.initialReadyTaskIds, prepared.initialReadyTaskIds);
  assert.equal(prepared.unresolvedTasks[0].preserveSource, 'legacy');
  assert.equal(Object.hasOwn(prepared.unresolvedTasks[0], 'preserveEnforcement'), false);
});

test('ordinary context diagnoses malformed release configuration while release preparation stays strict', () => {
  const root = project();
  decompose(root);
  const configPath = join(root, '.planr', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.shipClosure = { gates: 'invalid release-only gates' };
  writeFileSync(configPath, JSON.stringify(config));

  const context = prepareShipContext({ projectRoot: root, feature: 'auth' });
  assert.deepEqual(context.repositoryDescriptors, [{ repositoryKey: 'project', path: '.' }]);
  assert.equal(context.diagnostics[0].code, 'E_SHIP_GATE_INVALID');
  assert.throws(
    () => prepareShip({ projectRoot: root, feature: 'auth' }),
    (error) => error.code === 'E_SHIP_GATE_INVALID',
  );
});

test('a story-scoped default task selector never guesses between duplicate IDs', () => {
  const root = project();
  defaultModeFeature(root, [
    { id: 'US-001', tasks: [{ id: 'T-001' }] },
    { id: 'US-002', tasks: [{ id: 'T-001' }] },
  ]);

  assert.throws(
    () => prepareShip({ projectRoot: root, feature: 'auth', taskId: 'T-001' }),
    (error) => {
      assert.equal(error.code, 'E_TASK_AMBIGUOUS');
      assert.match(error.message, /US-001\/T-001 at us-1\/tasks\/task-1\.md/u);
      assert.match(error.message, /US-002\/T-001 at us-2\/tasks\/task-1\.md/u);
      assert.match(error.fix ?? '', /--task US-001\/T-001/u);
      assert.deepEqual(error.details?.candidates, [
        { storyId: 'US-001', path: 'us-1/tasks/task-1.md', selector: 'US-001/T-001' },
        { storyId: 'US-002', path: 'us-2/tasks/task-1.md', selector: 'US-002/T-001' },
      ]);
      return true;
    },
  );
});

test('an unknown task reports the searched root and every available selector', () => {
  const root = project();
  defaultModeFeature(root, [
    { id: 'US-001', tasks: [{ id: 'T-001' }] },
    { id: 'US-002', tasks: [{ id: 'T-002' }] },
  ]);

  assert.throws(
    () => prepareShip({ projectRoot: root, feature: 'auth', taskId: 'T-999' }),
    (error) => {
      assert.equal(error.code, 'E_TASK_UNKNOWN');
      assert.equal(error.details?.searchedRoot, 'output/feats/feat-auth');
      assert.deepEqual(
        error.details?.candidates.map(({ selector }) => selector),
        ['US-001/T-001', 'US-002/T-002'],
      );
      assert.match(error.message, /Searched output\/feats\/feat-auth/u);
      assert.match(error.message, /US-001\/T-001 at us-1\/tasks\/task-1\.md/u);
      return true;
    },
  );
});

test('default task readiness resolves duplicate IDs inside each parent story', () => {
  const root = project();
  defaultModeFeature(root, [
    {
      id: 'US-001',
      tasks: [
        { id: 'T-001', status: 'done' },
        { id: 'T-002', dependsOn: ['T-001'] },
      ],
    },
    {
      id: 'US-002',
      tasks: [{ id: 'T-001' }, { id: 'T-002', dependsOn: ['T-001'] }],
    },
  ]);

  const prepared = prepareShip({ projectRoot: root, feature: 'auth' });
  assert.deepEqual(prepared.initialReadyTaskIds, ['T-002', 'T-001']);
  assert.deepEqual(prepared.initialReadyTaskSelectors, ['US-001/T-002', 'US-002/T-001']);
  assert.deepEqual(
    prepared.unresolvedTasks.map(({ selector, dependencySelectors }) => ({
      selector,
      dependencySelectors,
    })),
    [
      { selector: 'US-001/T-002', dependencySelectors: [] },
      { selector: 'US-002/T-001', dependencySelectors: [] },
      { selector: 'US-002/T-002', dependencySelectors: ['US-002/T-001'] },
    ],
  );
  assert.deepEqual(
    nextShipBatch(prepared.tasks).ready.map(({ selector }) => selector),
    ['US-001/T-002', 'US-002/T-001'],
  );
});

test('a qualified default task selector chooses one usable story-scoped task', () => {
  const root = project();
  defaultModeFeature(root, [
    { id: 'US-001', tasks: [{ id: 'T-001', status: 'done' }] },
    { id: 'US-002', tasks: [{ id: 'T-001' }, { id: 'T-002', dependsOn: ['T-001'] }] },
  ]);

  const selected = prepareShip({ projectRoot: root, feature: 'auth', taskId: 'US-002/T-001' });
  assert.equal(selected.selectedTaskId, 'US-002/T-001');
  assert.equal(selected.selectedTaskSelector, 'US-002/T-001');
  assert.deepEqual(
    selected.unresolvedTasks.map(({ id, selector }) => ({ id, selector })),
    [{ id: 'T-001', selector: 'US-002/T-001' }],
  );
  assert.equal(selected.tasks[0].path.endsWith('/us-2/tasks/task-1.md'), true);

  assert.throws(
    () => prepareShip({ projectRoot: root, feature: 'auth', taskId: 'US-002/T-002' }),
    (error) => error.code === 'E_TASK_DEPENDENCY' && /US-002\/T-001/u.test(error.message),
  );
});
