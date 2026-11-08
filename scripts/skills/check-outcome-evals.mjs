#!/usr/bin/env node
/**
 * Static contamination check and offline grader self-test for the Claude plugin outcome evals.
 * Usage: node scripts/skills/check-outcome-evals.mjs [--static] [--self-test] [--write-expect] [--case <name>]
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, matchesGlob, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const suiteDir = join(repoRoot, 'evaluation', 'claude-plugin-outcome-evals');

const SELF_TEST_VARIANTS = ['good-planr', 'good-plain', 'bad-planr', 'bad-plain'];
const PROMPT_SETTINGS = {
  max_turns: 60,
  timeout_seconds: 900,
  allowed_tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Skill', 'Agent', 'Bash'],
  plugins: ['../../../dist/plugins/claude/openplanr'],
};
const GRADER_KEYS = {
  regex: ['type', 'target', 'pattern', 'flags', 'match', 'weight', 'arm'],
  tool_order: ['type', 'before', 'after', 'weight', 'arm'],
  tool_used: ['type', 'tool', 'input_match', 'min', 'max', 'weight', 'arm'],
  file_exists: ['type', 'path', 'exists', 'weight', 'arm'],
  llm: ['type', 'criteria', 'focus', 'weight', 'arm'],
  baseline: ['type', 'baseline_file', 'criteria', 'weight', 'arm'],
};
const GROUP_TAG = 'grant-bash-edit-write';
const GUARD_CASES = new Set(['bug-investigate-fix', 'ship-accepted-change']);
const FREE_TYPES = new Set(['regex', 'tool_order', 'tool_used', 'file_exists']);
const JUDGE_KINDS = new Set(['outcome', 'format']);

/** Splits a Markdown file into parsed YAML front matter and its body. */
export function parseFrontMatter(text, label) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`${label} has no YAML front matter`);
  const data = yaml.load(match[1]) ?? {};
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${label} front matter is not a mapping`);
  }
  return { data, body: match[2] };
}

/** Grader as the CLI reads it: front matter plus the body as pattern or criteria. */
export function loadGrader(path) {
  const { data, body } = parseFrontMatter(readFileSync(path, 'utf8'), path);
  const grader = { name: basename(path, '.md'), ...data };
  if (grader.type === 'regex' && grader.pattern === undefined) grader.pattern = body.trim();
  if ((grader.type === 'llm' || grader.type === 'baseline') && grader.criteria === undefined) {
    grader.criteria = body.trim();
  }
  return grader;
}

/** Role used by the outcome runner: indicator (with-only), format (`format-` name) or outcome. */
export function graderRole(grader) {
  if (grader.arm === 'with-only') return 'indicator';
  return grader.name.startsWith('format-') ? 'format' : 'outcome';
}

function loadJudge(caseDir, cases) {
  const judge = yaml.load(readFileSync(join(caseDir, 'judge.yaml'), 'utf8'));
  if (judge?.inherit) {
    const base = cases.get(judge.inherit);
    if (!base) throw new Error(`${caseDir}/judge.yaml inherits unknown case ${judge.inherit}`);
    return { ...base.judge, inheritedFrom: judge.inherit };
  }
  return judge;
}

/** Loads every case folder under the suite. Folders starting with `_` are shared helpers. */
export function loadSuite(root = suiteDir) {
  const names = readdirSync(root)
    .filter((name) => !name.startsWith('_') && statSync(join(root, name)).isDirectory())
    .filter((name) => existsSync(join(root, name, 'case.yaml')))
    .sort(
      (a, b) =>
        Number(a.endsWith('-explicit')) - Number(b.endsWith('-explicit')) || a.localeCompare(b),
    );
  const cases = new Map();
  for (const name of names) {
    const dir = join(root, name);
    const prompt = parseFrontMatter(
      readFileSync(join(dir, 'prompt.md'), 'utf8'),
      `${name}/prompt.md`,
    );
    const graders = readdirSync(join(dir, 'graders'))
      .filter((file) => file.endsWith('.md'))
      .sort()
      .map((file) => loadGrader(join(dir, 'graders', file)));
    const entry = {
      name,
      dir,
      caseYaml: yaml.load(readFileSync(join(dir, 'case.yaml'), 'utf8')),
      prompt,
      graders,
      hidden: existsSync(join(dir, 'hidden')) ? join(dir, 'hidden') : null,
      explicit: name.endsWith('-explicit'),
    };
    cases.set(name, entry);
    entry.judge = loadJudge(dir, cases);
    entry.selfTestDir = join(root, entry.judge.inheritedFrom ?? name, 'selftest');
  }
  return cases;
}

/** Names that must never reach a workspace, prompt, judge or scored grader. */
export function forbiddenNames(root = repoRoot) {
  const registry = JSON.parse(readFileSync(join(root, 'skills', 'registry.json'), 'utf8'));
  const skillIds = registry.skills.map((skill) => skill.skillId);
  const agentNames = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === 'AGENT.md') {
        const name = readFileSync(path, 'utf8').match(/^name:\s*(\S+)/m)?.[1];
        if (name) agentNames.push(name);
      }
    }
  };
  walk(join(root, 'agents'));
  const bareHyphenated = skillIds
    .map((id) => id.replace(/^planr-/, ''))
    .filter((name) => name.includes('-'));
  return { skillIds, agentNames, bareHyphenated };
}

export function contaminationPattern(names) {
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokens = [...names.skillIds, ...names.agentNames, ...names.bareHyphenated].map(
    escapeRegExp,
  );
  return new RegExp(`planr|(?<![\\w-])(?:${tokens.join('|')})(?![\\w-])`, 'i');
}

function listFiles(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '.git') files.push(...listFiles(path, base));
    } else files.push(relative(base, path));
  }
  return files.sort();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

/** Runs a case scaffold in a fresh temporary workspace and returns its path. */
export function scaffoldCase(entry) {
  const root = mkdtempSync(join(tmpdir(), 'outcome-eval-'));
  const workspace = join(root, 'cwd');
  const home = join(root, 'home');
  mkdirSync(workspace);
  mkdirSync(home);
  const result = run('bash', [join(entry.dir, entry.caseYaml.context.scaffold_script)], {
    cwd: workspace,
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: tmpdir(), TERM: 'dumb' },
  });
  if (result.status !== 0) {
    throw new Error(
      `${entry.name}: scaffold exited ${result.status}: ${result.stderr.slice(0, 2000)}`,
    );
  }
  return { root, workspace };
}

function workspaceVisibleText(workspace) {
  const texts = listFiles(workspace).map((file) => [
    file,
    readFileSync(join(workspace, file), 'utf8'),
  ]);
  const gitText = (args) => run('git', args, { cwd: workspace }).stdout;
  texts.push(['git log', gitText(['log', '--all', '--format=%an %ae%n%B'])]);
  texts.push(['git refs', gitText(['for-each-ref', '--format=%(refname) %(contents)'])]);
  texts.push(['git config', gitText(['config', '--local', '--list'])]);
  const probe = join(workspace, '.git', 'info', 'eval-probe.json');
  if (existsSync(probe)) texts.push(['.git/info/eval-probe.json', readFileSync(probe, 'utf8')]);
  return texts;
}

function promptBody(entry) {
  const body = entry.prompt.body.trim();
  return entry.explicit ? body.replace(/^\/planr:[a-z-]+\s+/, '') : body;
}

/** Static checks over everything a run, its judge or a scored grader can see. */
export function staticFindings(
  cases,
  { root = suiteDir, names = forbiddenNames(), scaffold = true } = {},
) {
  const pattern = contaminationPattern(names);
  const findings = [];
  const flag = (where, text) => {
    const hit = text.match(pattern);
    if (hit) findings.push(`${where}: contains "${hit[0]}"`);
  };

  for (const file of readdirSync(join(root, '_shared'))) {
    if (file !== 'probe.sh')
      flag(`_shared/${file}`, readFileSync(join(root, '_shared', file), 'utf8'));
  }

  for (const entry of cases.values()) {
    const { name, dir } = entry;
    if (entry.caseYaml.schema_version !== '1.1')
      findings.push(`${name}/case.yaml: schema_version must be "1.1"`);
    if (entry.caseYaml.name !== name)
      findings.push(`${name}/case.yaml: name must match the folder`);
    if (entry.caseYaml.context?.scaffold_script !== 'scaffold.sh') {
      findings.push(`${name}/case.yaml: context.scaffold_script must be scaffold.sh`);
    }
    for (const [key, value] of Object.entries(PROMPT_SETTINGS)) {
      if (JSON.stringify(entry.prompt.data[key]) !== JSON.stringify(value)) {
        findings.push(`${name}/prompt.md: ${key} must be ${JSON.stringify(value)}`);
      }
    }
    const tags = entry.prompt.data.tags ?? [];
    if (!tags.includes(GROUP_TAG))
      findings.push(`${name}/prompt.md: tags must include ${GROUP_TAG}`);
    if (tags.includes('guard') !== GUARD_CASES.has(name)) {
      findings.push(
        `${name}/prompt.md: the guard tag belongs on ${[...GUARD_CASES].join(' and ')} only`,
      );
    }
    const body = promptBody(entry);
    if (entry.explicit && body === entry.prompt.body.trim()) {
      findings.push(`${name}/prompt.md: an explicit variant must start with a /planr: invocation`);
    }
    if (!entry.explicit && /^\s*\//.test(body))
      findings.push(`${name}/prompt.md: prompt starts with a slash command`);
    flag(`${name}/prompt.md body`, body);

    const scaffoldText = readFileSync(join(dir, 'scaffold.sh'), 'utf8');
    // A variant's scaffold names its base case folder, which never reaches the workspace.
    const caseFolderRefs = new RegExp(`\\.\\./(?:${[...cases.keys()].join('|')})/`, 'g');
    flag(`${name}/scaffold.sh`, scaffoldText.replace(caseFolderRefs, '../'));
    if (/\b(?:hidden|graders|selftest)\/|judge\.yaml/.test(scaffoldText)) {
      findings.push(`${name}/scaffold.sh: refers to hidden, grader, self-test or judge files`);
    }
    if (!entry.explicit && !scaffoldText.includes('_shared/probe.sh')) {
      findings.push(`${name}/scaffold.sh: does not end with the shared probe`);
    }

    findings.push(...judgeFindings(entry));
    if (!entry.judge.inheritedFrom)
      flag(`${name}/judge.yaml`, readFileSync(join(dir, 'judge.yaml'), 'utf8'));

    for (const grader of entry.graders) {
      findings.push(...graderFindings(name, grader));
      const { input_match: inputMatch, ...rest } = grader;
      flag(`${name}/graders/${grader.name}.md`, JSON.stringify(rest));
      if (inputMatch !== undefined && grader.arm !== 'with-only')
        flag(`${name}/graders/${grader.name}.md input_match`, inputMatch);
    }

    for (const folder of ['hidden', 'tools']) {
      const path = join(dir, folder);
      if (!existsSync(path)) continue;
      for (const file of listFiles(path))
        flag(`${name}/${folder}/${file}`, readFileSync(join(path, file), 'utf8'));
    }
    if (entry.hidden) findings.push(...hiddenFindings(entry));

    if (scaffold && !entry.explicit) {
      const { root, workspace } = scaffoldCase(entry);
      try {
        for (const [file, text] of workspaceVisibleText(workspace))
          flag(`${name} workspace ${file}`, text);
        for (const file of listFiles(workspace)) {
          if (/(^|\/)(AGENTS|CLAUDE)\.md$/i.test(file))
            findings.push(`${name} workspace: ships ${file}`);
        }
        if (run('git', ['status', '--porcelain'], { cwd: workspace }).stdout.trim() !== '') {
          findings.push(`${name} workspace: scaffold leaves uncommitted changes`);
        }
        if (entry.hidden) {
          const hiddenTexts = new Set(
            listFiles(entry.hidden).map((file) => readFileSync(join(entry.hidden, file), 'utf8')),
          );
          for (const file of listFiles(workspace)) {
            if (hiddenTexts.has(readFileSync(join(workspace, file), 'utf8'))) {
              findings.push(`${name} workspace: ${file} is a copy of a hidden file`);
            }
          }
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  }
  return findings;
}

function graderFindings(caseName, grader) {
  const where = `${caseName}/graders/${grader.name}.md`;
  const allowed = GRADER_KEYS[grader.type];
  if (!allowed) return [`${where}: unknown type ${grader.type}`];
  const findings = [];
  for (const key of Object.keys(grader)) {
    if (key !== 'name' && !allowed.includes(key))
      findings.push(`${where}: key ${key} is not valid for ${grader.type}`);
  }
  if (!FREE_TYPES.has(grader.type))
    findings.push(`${where}: ${grader.type} graders belong in judge.yaml`);
  if (grader.arm !== 'both' && grader.arm !== 'with-only')
    findings.push(`${where}: arm must be both or with-only`);
  if (grader.type === 'tool_used' && grader.tool === 'Skill' && grader.arm !== 'with-only') {
    findings.push(`${where}: a Skill indicator must be with-only`);
  }
  if (grader.type === 'regex' && grader.target === 'trace' && /\[\^"\]\*/.test(grader.pattern)) {
    findings.push(`${where}: trace regex uses [^"]*, which stops at JSON escaping; use .{0,600}?`);
  }
  for (const source of [grader.pattern, grader.input_match].filter(
    (value) => value !== undefined,
  )) {
    try {
      new RegExp(source, grader.flags ?? '');
    } catch (error) {
      findings.push(`${where}: invalid regex: ${error.message}`);
    }
  }
  return findings;
}

function judgeFindings(entry) {
  const where = `${entry.name}/judge.yaml`;
  const { judge } = entry;
  const findings = [];
  if (judge?.schema !== 1) findings.push(`${where}: schema must be 1`);
  if (!Array.isArray(judge?.criteria) || judge.criteria.length === 0)
    return [...findings, `${where}: no criteria`];
  if (typeof judge.facts !== 'string' || judge.facts.trim() === '')
    findings.push(`${where}: facts are missing`);
  const ids = new Set();
  for (const criterion of judge.criteria) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(criterion.id ?? ''))
      findings.push(`${where}: bad criterion id ${criterion.id}`);
    if (ids.has(criterion.id)) findings.push(`${where}: duplicate criterion id ${criterion.id}`);
    ids.add(criterion.id);
    if (!JUDGE_KINDS.has(criterion.kind))
      findings.push(`${where}: ${criterion.id} kind must be outcome or format`);
    if (typeof criterion.criterion !== 'string' || criterion.criterion.trim() === '') {
      findings.push(`${where}: ${criterion.id} has no criterion text`);
    }
    if (criterion.mode !== undefined && criterion.mode !== 'sampled-requirements') {
      findings.push(`${where}: ${criterion.id} has unknown mode ${criterion.mode}`);
    }
  }
  return findings;
}

function hiddenFindings(entry) {
  const where = `${entry.name}/hidden/scope.json`;
  if (!existsSync(join(entry.hidden, 'scope.json'))) return [`${where}: missing`];
  const scope = JSON.parse(readFileSync(join(entry.hidden, 'scope.json'), 'utf8'));
  const findings = [];
  if (scope.testCommand !== 'node --test')
    findings.push(`${where}: testCommand must be "node --test"`);
  if (scope.testDir !== 'test/hidden') findings.push(`${where}: testDir must be "test/hidden"`);
  if (!Array.isArray(scope.allowedPaths) || scope.allowedPaths.length === 0)
    findings.push(`${where}: allowedPaths is empty`);
  if (!listFiles(entry.hidden).some((file) => file.endsWith('.test.js')))
    findings.push(`${entry.name}/hidden: no test files`);
  return findings;
}

/** Stream-json trace with the given tool calls and a final assistant message. */
export function traceFromToolCalls(toolCalls, lastMessage) {
  const events = [{ type: 'system', subtype: 'init', tools: [], plugins: [] }];
  toolCalls.forEach((call, index) => {
    const id = `toolu_${String(index + 1).padStart(3, '0')}`;
    events.push({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id, name: call.name, input: call.input }],
      },
    });
    events.push({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: id, content: call.result ?? 'ok' }],
      },
    });
  });
  events.push({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: lastMessage }] },
  });
  events.push({
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: toolCalls.length + 1,
    result: lastMessage,
  });
  return events;
}

function toolCallsIn(trace) {
  return trace.flatMap((event) =>
    event.type === 'assistant' && Array.isArray(event.message?.content)
      ? event.message.content.filter((block) => block.type === 'tool_use')
      : [],
  );
}

function regexTarget(target, runData) {
  if (target === 'last_message') return runData.lastMessage;
  if (target === 'trace') return runData.trace.map((event) => JSON.stringify(event)).join('\n');
  if (target === 'files') return runData.createdFiles.join('\n');
  if (target === 'mock_calls')
    return (runData.mockCalls ?? []).map((call) => JSON.stringify(call)).join('\n');
  if (target?.source === 'file') {
    const path = join(runData.workspace, target.path);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  }
  throw new Error(`unknown regex target ${JSON.stringify(target)}`);
}

/** Scores one free grader the way Claude Code 2.1.319 does; returns { passed, detail }. */
export function evaluateFreeGrader(grader, runData) {
  if (grader.type === 'regex') {
    const text = regexTarget(grader.target ?? 'last_message', runData);
    if (text === null) return { passed: false, detail: `${grader.target.path} does not exist` };
    const flags = grader.flags ?? '';
    const match = grader.match ?? 'contains';
    if (match === 'contains')
      return { passed: new RegExp(grader.pattern, flags).test(text), detail: match };
    if (match === 'not_contains')
      return { passed: !new RegExp(grader.pattern, flags).test(text), detail: match };
    const expected = Number(match.slice('count:'.length));
    const found =
      text.match(new RegExp(grader.pattern, flags.includes('g') ? flags : `${flags}g`))?.length ??
      0;
    return { passed: found === expected, detail: `found ${found}, expected ${expected}` };
  }
  if (grader.type === 'tool_used') {
    const matcher = grader.input_match === undefined ? null : new RegExp(grader.input_match);
    const count = toolCallsIn(runData.trace).filter(
      (call) =>
        call.name === grader.tool && (matcher === null || matcher.test(JSON.stringify(call.input))),
    ).length;
    const min = grader.min ?? 1;
    const passed = count >= min && (grader.max === undefined || count <= grader.max);
    return { passed, detail: `${count} matching ${grader.tool} calls` };
  }
  if (grader.type === 'file_exists') {
    const present = runData.createdFiles.some((file) => matchesGlob(file, grader.path));
    return { passed: present === (grader.exists ?? true), detail: present ? 'present' : 'absent' };
  }
  if (grader.type === 'tool_order') {
    const spec = (value) => (typeof value === 'string' ? { tool: value } : value);
    const calls = toolCallsIn(runData.trace);
    const find = ({ tool, input_match: inputMatch }) =>
      calls.findIndex(
        (call) =>
          call.name === tool &&
          (!inputMatch || new RegExp(inputMatch).test(JSON.stringify(call.input))),
      );
    const before = find(spec(grader.before));
    const after = find(spec(grader.after));
    return {
      passed: before !== -1 && after !== -1 && before < after,
      detail: `before ${before}, after ${after}`,
    };
  }
  throw new Error(`${grader.name}: ${grader.type} is not a free grader`);
}

/** Copies hidden tests into the workspace and runs the contract's test command. */
export function runHiddenTests(hiddenDir, workspace) {
  const scope = JSON.parse(readFileSync(join(hiddenDir, 'scope.json'), 'utf8'));
  const target = join(workspace, scope.testDir);
  mkdirSync(target, { recursive: true });
  for (const file of listFiles(hiddenDir).filter((name) => name !== 'scope.json')) {
    cpSync(join(hiddenDir, file), join(target, file));
  }
  const [command, ...args] = scope.testCommand.split(' ');
  const result = run(command, args, {
    cwd: workspace,
    env: { ...process.env, NODE_TEST_CONTEXT: undefined },
  });
  return { passed: result.status === 0, output: `${result.stdout}${result.stderr}`, scope };
}

/** Changed paths (tracked and untracked, hidden tests excluded) outside `allowedPaths`. */
export function outOfScopePaths(workspace, scope) {
  const status = run('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: workspace,
  }).stdout;
  return status
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^.* -> /, ''))
    .filter((path) => !path.startsWith(`${scope.testDir}/`))
    .filter((path) => !scope.allowedPaths.some((glob) => matchesGlob(path, glob)));
}

/** Expected verdict for a self-test variant: outcome follows good/bad, format and indicators follow planr/plain. */
export function expectedVerdict(variant, role) {
  if (role === 'outcome') return variant.startsWith('good-');
  return variant.endsWith('-planr');
}

function buildSelfTestRun(entry, variant) {
  const dir = join(entry.selfTestDir, variant);
  const { root, workspace } = scaffoldCase(entry);
  if (existsSync(join(dir, 'files'))) cpSync(join(dir, 'files'), workspace, { recursive: true });
  if (existsSync(join(dir, 'delete.txt'))) {
    for (const path of readFileSync(join(dir, 'delete.txt'), 'utf8').split('\n').filter(Boolean)) {
      rmSync(join(workspace, path), { force: true });
    }
  }
  const lastMessage = readFileSync(join(dir, 'last-message.md'), 'utf8').trim();
  const { toolCalls } = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
  const createdFiles = run('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: workspace,
  })
    .stdout.split('\n')
    .filter(Boolean);
  return {
    root,
    workspace,
    lastMessage,
    trace: traceFromToolCalls(toolCalls, lastMessage),
    createdFiles,
  };
}

/** Runs every free grader and hidden test against the four self-test outputs of a case. */
export function selfTestCase(entry) {
  const results = [];
  for (const variant of SELF_TEST_VARIANTS) {
    if (!existsSync(join(entry.selfTestDir, variant))) {
      results.push({
        variant,
        check: 'fixture',
        expected: true,
        actual: false,
        detail: 'missing self-test output',
      });
      continue;
    }
    const runData = buildSelfTestRun(entry, variant);
    try {
      for (const grader of entry.graders) {
        const role = graderRole(grader);
        const { passed, detail } = evaluateFreeGrader(grader, runData);
        results.push({
          variant,
          check: `${role}:${grader.name}`,
          expected: expectedVerdict(variant, role),
          actual: passed,
          detail,
        });
      }
      if (entry.hidden) {
        const hidden = runHiddenTests(entry.hidden, runData.workspace);
        const expected = expectedVerdict(variant, 'outcome');
        results.push({
          variant,
          check: 'outcome:hidden-tests',
          expected,
          actual: hidden.passed,
          detail: hidden.passed ? 'pass' : hidden.output.slice(-1500),
        });
        const outside = outOfScopePaths(runData.workspace, hidden.scope);
        results.push({
          variant,
          check: 'reported:diff-scope',
          expected: true,
          actual: outside.length === 0,
          detail: outside.join(', ') || 'in scope',
          reportedOnly: true,
        });
      }
    } finally {
      rmSync(runData.root, { recursive: true, force: true });
    }
  }
  return results;
}

/**
 * Judge criteria with the verdict each self-test output should get in the pilot judge check.
 * A bad output may mark single outcome criteria as passing in `run.json` `judge`, but most must fail.
 */
export function judgeExpectations(entry) {
  const overrides = Object.fromEntries(
    SELF_TEST_VARIANTS.map((variant) => {
      const path = join(entry.selfTestDir, variant, 'run.json');
      return [
        variant,
        existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')).judge ?? {}) : {},
      ];
    }),
  );
  return entry.judge.criteria.map((criterion) => ({
    id: criterion.id,
    kind: criterion.kind,
    expected: Object.fromEntries(
      SELF_TEST_VARIANTS.map((variant) => [
        variant,
        overrides[variant][criterion.id] ?? expectedVerdict(variant, criterion.kind),
      ]),
    ),
  }));
}

/** Problems with judge expectations: unknown ids, overrides outside bad outcomes, bad outputs that pass most outcomes. */
export function judgeExpectationFindings(entry) {
  const findings = [];
  const criteria = judgeExpectations(entry);
  const ids = new Set(criteria.map((criterion) => criterion.id));
  for (const variant of SELF_TEST_VARIANTS) {
    const path = join(entry.selfTestDir, variant, 'run.json');
    if (!existsSync(path)) continue;
    for (const [id, value] of Object.entries(JSON.parse(readFileSync(path, 'utf8')).judge ?? {})) {
      const criterion = criteria.find((item) => item.id === id);
      if (!ids.has(id)) findings.push(`${variant}: judge override for unknown criterion ${id}`);
      else if (!variant.startsWith('bad-') || criterion.kind !== 'outcome' || value !== true) {
        findings.push(
          `${variant}: judge override ${id} is allowed only as a passing outcome on a bad output`,
        );
      }
    }
    if (variant.startsWith('bad-')) {
      const outcomes = criteria.filter((criterion) => criterion.kind === 'outcome');
      const passing = outcomes.filter((criterion) => criterion.expected[variant]).length;
      if (outcomes.length > 0 && passing * 2 >= outcomes.length) {
        findings.push(
          `${variant}: expected to pass ${passing} of ${outcomes.length} outcome criteria; a bad output must fail most`,
        );
      }
    }
  }
  return findings;
}

/** The `expect.json` content a self-test output must carry: hidden-test, free-grader and judge verdicts. */
export function derivedExpectations(entry, variant) {
  const expect = {};
  if (entry.hidden) expect.hidden = expectedVerdict(variant, 'outcome');
  expect.graders = Object.fromEntries(
    entry.graders.map((grader) => [grader.name, expectedVerdict(variant, graderRole(grader))]),
  );
  expect.judge = Object.fromEntries(
    judgeExpectations(entry).map((criterion) => [criterion.id, criterion.expected[variant]]),
  );
  return expect;
}

/** Base cases whose `selftest/<variant>/expect.json` is missing or differs from the derived expectations. */
export function expectFileFindings(entry, { write = false } = {}) {
  if (entry.judge.inheritedFrom) return [];
  const findings = [];
  for (const variant of SELF_TEST_VARIANTS) {
    const path = join(entry.selfTestDir, variant, 'expect.json');
    const text = `${JSON.stringify(derivedExpectations(entry, variant), null, 2)}\n`;
    if (write) writeFileSync(path, text);
    else if (!existsSync(path) || readFileSync(path, 'utf8') !== text) {
      findings.push(`${variant}/expect.json is missing or stale (run with --write-expect)`);
    }
  }
  return findings;
}

/** Confirms the untouched fixture fails its hidden tests. */
export function hiddenFailsOnFixture(entry) {
  const { root, workspace } = scaffoldCase(entry);
  try {
    return !runHiddenTests(entry.hidden, workspace).passed;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function main(argv) {
  const want = (flag) => argv.includes(flag);
  const caseFilter = argv.includes('--case') ? argv[argv.indexOf('--case') + 1] : null;
  const all = loadSuite();
  const cases = new Map([...all].filter(([name]) => caseFilter === null || name === caseFilter));
  if (cases.size === 0) throw new Error(`no case matches ${caseFilter}`);
  const doStatic = want('--static') || !want('--self-test');
  const doSelfTest = want('--self-test') || !want('--static');
  let failed = false;

  if (doStatic) {
    const findings = staticFindings(cases);
    for (const finding of findings) process.stdout.write(`static: ${finding}\n`);
    process.stdout.write(
      `static check: ${findings.length === 0 ? 'clean' : `${findings.length} finding(s)`} over ${cases.size} cases\n`,
    );
    failed ||= findings.length > 0;
  }

  if (doSelfTest) {
    for (const entry of cases.values()) {
      if (entry.hidden && !hiddenFailsOnFixture(entry)) {
        process.stdout.write(
          `self-test ${entry.name}: hidden tests pass on the untouched fixture\n`,
        );
        failed = true;
      }
      const results = selfTestCase(entry);
      const wrong = results.filter(
        (result) => !result.reportedOnly && result.expected !== result.actual,
      );
      for (const result of wrong) {
        process.stdout.write(
          `self-test ${entry.name} ${result.variant} ${result.check}: expected ${result.expected ? 'pass' : 'fail'}, got ${result.actual ? 'pass' : 'fail'} (${result.detail})\n`,
        );
      }
      const judgeProblems = [
        ...judgeExpectationFindings(entry),
        ...expectFileFindings(entry, { write: want('--write-expect') }),
      ];
      for (const problem of judgeProblems)
        process.stdout.write(`self-test ${entry.name} ${problem}\n`);
      const scored = results.filter((result) => !result.reportedOnly).length;
      const judged = judgeExpectations(entry);
      process.stdout.write(
        `self-test ${entry.name}: ${scored - wrong.length}/${scored} free checks as expected; ${judged.length} judge criteria left for the pilot (${judged.filter((c) => c.kind === 'format').length} format)\n`,
      );
      failed ||= wrong.length > 0 || judgeProblems.length > 0;
    }
  }
  return failed ? 1 : 0;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
