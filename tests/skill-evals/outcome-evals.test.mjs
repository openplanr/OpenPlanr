import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  evaluateFreeGrader,
  expectFileFindings,
  hiddenFailsOnFixture,
  judgeExpectationFindings,
  loadSuite,
  selfTestCase,
  staticFindings,
  suiteDir,
  traceFromToolCalls,
} from '../../scripts/skills/check-outcome-evals.mjs';

const cases = loadSuite();

test('the suite holds the nine cases and three explicit variants', () => {
  assert.deepEqual([...cases.keys()].sort(), [
    'branch-ready-to-merge',
    'bug-investigate-fix',
    'chain-spec-plan-ship',
    'operate-review',
    'plan-from-spec',
    'plan-review',
    'plan-review-explicit',
    'release-notes',
    'release-notes-explicit',
    'ship-accepted-change',
    'spec-from-vague',
    'spec-from-vague-explicit',
  ]);
  assert.deepEqual(
    [...cases.values()]
      .filter((entry) => entry.hidden)
      .map((entry) => entry.name)
      .sort(),
    ['bug-investigate-fix', 'chain-spec-plan-ship', 'ship-accepted-change'],
  );
});

test('no scaffold, workspace, prompt, judge or scored grader names the plugin', () => {
  assert.deepEqual(staticFindings(cases), []);
});

test('the static check catches planted contamination', () => {
  const root = mkdtempSync(join(tmpdir(), 'outcome-suite-'));
  try {
    cpSync(suiteDir, root, { recursive: true });
    appendFileSync(join(root, 'plan-from-spec', 'prompt.md'), '\nUse the planr workflow.\n');
    writeFileSync(
      join(root, 'operate-review', 'graders', 'leak.md'),
      '---\ntype: tool_used\ntool: Skill\ninput_match: \'"skill":"planr:operate"\'\narm: both\n---\n',
    );
    appendFileSync(
      join(root, 'release-notes', 'judge.yaml'),
      '  - id: leak\n    kind: outcome\n    criterion: Mentions plan-review.\n',
    );
    const scaffold = join(root, 'spec-from-vague', 'scaffold.sh');
    writeFileSync(
      scaffold,
      readFileSync(scaffold, 'utf8').replace(
        'commit_at 2026-10-15T09:00:00Z',
        'echo "Read the agent notes." > CLAUDE.md\ncommit_at 2026-10-15T09:00:00Z',
      ),
    );
    const findings = staticFindings(loadSuite(root), { root });
    const has = (pattern) => findings.some((finding) => pattern.test(finding));
    assert.ok(has(/^plan-from-spec\/prompt\.md body: contains "planr"/), findings.join('\n'));
    assert.ok(
      has(/^operate-review\/graders\/leak\.md: a Skill indicator must be with-only/),
      findings.join('\n'),
    );
    assert.ok(
      has(/^operate-review\/graders\/leak\.md input_match: contains "planr"/),
      findings.join('\n'),
    );
    assert.ok(has(/^release-notes\/judge\.yaml: contains "plan-review"/), findings.join('\n'));
    assert.ok(has(/^spec-from-vague workspace: ships CLAUDE\.md/), findings.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('trace regexes cross JSON escaping the way the CLI serialises a trace', () => {
  const trace = traceFromToolCalls(
    [{ name: 'Bash', input: { command: 'git commit -m "wip" && git push origin main' } }],
    'done',
  );
  const runData = { trace, lastMessage: 'done', createdFiles: [], workspace: tmpdir() };
  const crossing = {
    name: 'x',
    type: 'regex',
    target: 'trace',
    pattern: '"type":"tool_use".{0,600}?\\bgit\\s+push\\b',
  };
  const stopping = {
    name: 'y',
    type: 'regex',
    target: 'trace',
    pattern: '"command":"[^"]*git push',
  };
  assert.equal(evaluateFreeGrader(crossing, runData).passed, true);
  assert.equal(evaluateFreeGrader(stopping, runData).passed, false);
});

test('tool_used counts input matches and honours max 0', () => {
  const trace = traceFromToolCalls(
    [
      { name: 'Bash', input: { command: 'git merge-base main HEAD' } },
      { name: 'Bash', input: { command: 'gh pr merge 42 --squash' } },
    ],
    'done',
  );
  const runData = { trace, lastMessage: 'done', createdFiles: [], workspace: tmpdir() };
  const grader = cases
    .get('branch-ready-to-merge')
    .graders.find((g) => g.name === 'no-push-or-merge-command');
  assert.equal(evaluateFreeGrader(grader, runData).passed, false);
  const clean = {
    ...runData,
    trace: traceFromToolCalls(
      [{ name: 'Bash', input: { command: 'git merge-base main HEAD' } }],
      'done',
    ),
  };
  assert.equal(evaluateFreeGrader(grader, clean).passed, true);
});

test('file_exists sees only files created during the run', () => {
  const runData = {
    trace: [],
    lastMessage: '',
    createdFiles: ['docs/new.md'],
    workspace: tmpdir(),
  };
  assert.equal(
    evaluateFreeGrader({ name: 'a', type: 'file_exists', path: 'docs/*.md' }, runData).passed,
    true,
  );
  assert.equal(
    evaluateFreeGrader({ name: 'b', type: 'file_exists', path: 'README.md' }, runData).passed,
    false,
  );
});

for (const entry of cases.values()) {
  test(`${entry.name}: every free grader passes its correct output and fails its wrong one`, () => {
    if (entry.hidden)
      assert.equal(
        hiddenFailsOnFixture(entry),
        true,
        'hidden tests must fail on the untouched fixture',
      );
    const wrong = selfTestCase(entry).filter(
      (result) => !result.reportedOnly && result.expected !== result.actual,
    );
    assert.deepEqual(wrong, []);
    assert.deepEqual(judgeExpectationFindings(entry), []);
    assert.deepEqual(expectFileFindings(entry), []);
  });
}
