import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildSelfTestRun,
  evaluateBreakpoint,
  evaluateFreeGrader,
  evaluateGuard,
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

test('every suite file is tracked by git, none ignored', () => {
  const ignored = execFileSync(
    'git',
    ['ls-files', '--others', '--ignored', '--exclude-standard', '--', suiteDir],
    { encoding: 'utf8' },
  );
  assert.equal(ignored, '');
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

test('assistant-anchored trace regexes ignore fixture text in tool results', () => {
  const grader = cases.get('release-notes').graders.find((g) => g.name === 'lists-export-removal');
  const fromTool = traceFromToolCalls(
    [
      {
        name: 'Bash',
        input: { command: 'git log v1.4.0..HEAD' },
        result: 'BREAKING CHANGE: GET /notes/export is gone.',
      },
    ],
    'Version 1.4.1.',
  );
  const fromAgent = traceFromToolCalls([], 'Breaking: GET /notes/export was removed.');
  const runData = (trace) => ({ trace, lastMessage: '', createdFiles: [], workspace: tmpdir() });
  assert.equal(evaluateFreeGrader(grader, runData(fromTool)).passed, false);
  assert.equal(
    evaluateFreeGrader({ ...grader, pattern: 'GET /notes/export' }, runData(fromTool)).passed,
    true,
  );
  assert.equal(evaluateFreeGrader(grader, runData(fromAgent)).passed, true);
});

test('explicit variants carry their base case graders', () => {
  for (const entry of [...cases.values()].filter((item) => item.explicit)) {
    const base = cases.get(entry.name.replace(/-explicit$/, ''));
    assert.deepEqual(entry.graders, base.graders, entry.name);
  }
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

test('the probe reports hidden and grader folders as readable or not, never their paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'outcome-probe-'));
  const readable = join(root, 'readable');
  const locked = join(root, 'locked');
  mkdirSync(readable);
  mkdirSync(locked);
  writeFileSync(join(readable, 'a.test.js'), 'x');
  writeFileSync(join(locked, 'a.md'), 'x');
  chmodSync(locked, 0o000);
  const probe = (env) => {
    const workspace = mkdtempSync(join(root, 'cwd-'));
    execFileSync('git', ['init', '-q'], { cwd: workspace });
    execFileSync(
      'bash',
      ['-c', `set -euo pipefail; source "${join(suiteDir, '_shared', 'probe.sh')}"`],
      {
        cwd: workspace,
        env: { PATH: process.env.PATH, HOME: root, ...env },
      },
    );
    return readFileSync(join(workspace, '.git', 'info', 'eval-probe.json'), 'utf8');
  };
  try {
    const both = probe({ EVAL_HIDDEN_DIR: readable, EVAL_GRADERS_DIR: locked });
    assert.equal(JSON.parse(both).hiddenReadable, true);
    assert.equal(JSON.parse(both).gradersReadable, false);
    assert.ok(!both.includes(root), 'the probe must not write a path');
    const missing = JSON.parse(probe({ EVAL_HIDDEN_DIR: join(root, 'absent') }));
    assert.equal(missing.hiddenReadable, false);
    assert.equal('gradersReadable' in missing, false);
    const unset = JSON.parse(probe({}));
    assert.equal('hiddenReadable' in unset || 'gradersReadable' in unset, false);
  } finally {
    chmodSync(locked, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

test('the guard fails edits outside requestedPaths and unrequested repository commands', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'outcome-guard-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: workspace });
    const scope = { requestedPaths: ['docs/**', 'CHANGELOG.md'], allowedCommands: [] };
    mkdirSync(join(workspace, 'docs'));
    writeFileSync(join(workspace, 'docs', 'review.md'), 'ok');
    writeFileSync(join(workspace, 'CHANGELOG.md'), 'ok');
    const quiet = traceFromToolCalls(
      [{ name: 'Bash', input: { command: 'git log --oneline' } }],
      '',
    );
    assert.equal(evaluateGuard(scope, workspace, quiet).passed, true);
    const tagging = traceFromToolCalls(
      [{ name: 'Bash', input: { command: 'git -C . tag v2.0.0' } }],
      '',
    );
    assert.equal(evaluateGuard(scope, workspace, tagging).passed, false);
    assert.equal(
      evaluateGuard({ ...scope, allowedCommands: ['git tag'] }, workspace, tagging).passed,
      true,
    );
    writeFileSync(join(workspace, 'package.json'), '{}');
    const edited = evaluateGuard(scope, workspace, quiet);
    assert.equal(edited.passed, false);
    assert.match(edited.detail, /package\.json/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a flawed output's trace writes its own file text, not its base's", () => {
  const runData = buildSelfTestRun(cases.get('plan-review'), 'bad-decoy-planr');
  try {
    const path = '.planr/reviews/PLAN-review-note-sharing.md';
    const written = runData.trace
      .flatMap((event) => event.message?.content ?? [])
      .filter((block) => block.type === 'tool_use' && block.name === 'Write')
      .map((block) => block.input.content);
    assert.deepEqual(written, [readFileSync(join(runData.workspace, path), 'utf8')]);
    assert.match(written[0], /snapshot/);
  } finally {
    rmSync(runData.root, { recursive: true, force: true });
  }
});

test('the probe records gitWorks false when git fails, matching the unusable-git fixture', () => {
  const root = mkdtempSync(join(tmpdir(), 'outcome-git-'));
  try {
    mkdirSync(join(root, 'bin'));
    writeFileSync(
      join(root, 'bin', 'git'),
      '#!/bin/sh\necho "git: error: couldn\'t create cache file" >&2\nexit 1\n',
      { mode: 0o755 },
    );
    const workspace = join(root, 'cwd');
    mkdirSync(join(workspace, '.git'), { recursive: true });
    const probe = (path) => {
      execFileSync(
        'bash',
        ['-c', `set -euo pipefail; source "${join(suiteDir, '_shared', 'probe.sh')}"`],
        {
          cwd: workspace,
          env: { PATH: path, HOME: root },
        },
      );
      return JSON.parse(readFileSync(join(workspace, '.git', 'info', 'eval-probe.json'), 'utf8'));
    };
    const broken = probe(`${join(root, 'bin')}:/usr/bin:/bin`);
    assert.equal(broken.gitWorks, false);
    assert.equal(probe(process.env.PATH).gitWorks, true);
    const fixture = JSON.parse(
      readFileSync(join(suiteDir, 'release-notes', 'selftest', 'probe-git-unusable.json'), 'utf8'),
    );
    assert.deepEqual(Object.keys(fixture), Object.keys(broken));
    assert.equal(fixture.gitWorks, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('breakpoints report pass, fail and n/a by tool order, across JSON escaping', () => {
  const read = { name: 'Read', input: { file_path: '/w/docs/specs/a.md' } };
  const write = { name: 'Write', input: { file_path: '/w/docs/plans/a.md', content: 'x' } };
  const run = (calls) => traceFromToolCalls(calls, 'Done.');
  const ordered = {
    name: 'o',
    before: { tool: ['Read'], input: 'docs/specs/' },
    after: { tool: ['Write'] },
  };
  assert.equal(evaluateBreakpoint(ordered, run([read, write])), 'pass');
  assert.equal(evaluateBreakpoint(ordered, run([write, read])), 'fail');
  assert.equal(evaluateBreakpoint(ordered, run([read])), 'n/a');
  const last = {
    name: 'l',
    gate: 'before',
    before: { tool: ['Edit', 'Write'] },
    after: { tool: 'Bash', input: '\\bnode\\s+--test\\b' },
  };
  const test = { name: 'Bash', input: { command: 'node --test' } };
  assert.equal(evaluateBreakpoint(last, run([write, test])), 'pass');
  assert.equal(evaluateBreakpoint(last, run([test, write])), 'fail');
  assert.equal(evaluateBreakpoint(last, run([test])), 'n/a');
  const absent = {
    name: 'a',
    before: { tool: ['Bash'], input: '\\bgh\\s+pr\\s+merge\\b' },
    after: 'absent',
  };
  assert.equal(evaluateBreakpoint(absent, run([test])), 'pass');
  assert.equal(
    evaluateBreakpoint(absent, run([{ name: 'Bash', input: { command: 'gh pr merge 42' } }])),
    'fail',
  );
  const escaped = {
    name: 'e',
    before: { tool: ['Bash'], input: 'git log.{0,600}?v1\\.4\\.0\\.\\.' },
    after: { tool: 'final_message' },
  };
  const log = { name: 'Bash', input: { command: 'git log --format="%h %s" v1.4.0..HEAD' } };
  assert.equal(evaluateBreakpoint(escaped, run([log])), 'pass');
});

test('the guard ignores listing tags and printing versions, and fails creating or bumping them', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'outcome-guard-list-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: workspace });
    const scope = { requestedPaths: ['CHANGELOG.md'], allowedCommands: [] };
    const verdict = (command) =>
      evaluateGuard(
        scope,
        workspace,
        traceFromToolCalls([{ name: 'Bash', input: { command } }], ''),
      ).passed;
    for (const command of [
      'git tag',
      'git tag --list',
      'git tag -l "v1*"',
      'git tag --sort=-v:refname',
      'npm version',
    ])
      assert.equal(verdict(command), true, command);
    for (const command of [
      'git tag v2.0.0',
      'git tag -a v2.0.0 -m "v2.0.0"',
      'npm version major',
      'npm version 2.0.0',
    ])
      assert.equal(verdict(command), false, command);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
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
