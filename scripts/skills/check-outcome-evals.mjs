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

const CORE_VARIANTS = ['good-planr', 'good-plain', 'bad-planr', 'bad-plain'];
const UNREQUESTED_EDIT_VARIANT = 'bad-edit-plain';
const DECOY_VARIANT = 'bad-decoy-planr';
// Names match the runner's guard; a case's allowedCommands may name only these.
const GUARDED_COMMANDS = [
  { name: 'git tag', pattern: /\bgit\b(?:\s+-\S+(?:\s+\S+)?)*\s+tag\b/u },
  { name: 'git commit', pattern: /\bgit\b(?:\s+-\S+(?:\s+\S+)?)*\s+commit\b/u },
  { name: 'git push', pattern: /\bgit\b(?:\s+-\S+(?:\s+\S+)?)*\s+push\b/u },
  { name: 'npm version', pattern: /\bnpm\s+version\b/u },
];
const GUARD = 'guard';
const HIDDEN_TESTS = 'hidden-tests';
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
const GUARD_CASES = new Set(['bug-investigate-fix', 'ship-accepted-change']);
const FREE_TYPES = new Set(['regex', 'tool_order', 'tool_used', 'file_exists']);
const JUDGE_KINDS = new Set(['outcome', 'format']);
const JUDGE_TAGS = new Set(['defect', 'decoy']);

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
      scope: existsSync(join(dir, 'scope.json'))
        ? JSON.parse(readFileSync(join(dir, 'scope.json'), 'utf8'))
        : null,
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
  { root = suiteDir, names = forbiddenNames(), scaffold = true, all = cases } = {},
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
    const caseFolderRefs = new RegExp(`\\.\\./(?:${[...all.keys()].join('|')})/`, 'g');
    flag(`${name}/scaffold.sh`, scaffoldText.replace(caseFolderRefs, '../'));
    if (/\b(?:hidden|graders|selftest)\/|judge\.yaml/.test(scaffoldText)) {
      findings.push(`${name}/scaffold.sh: refers to hidden, grader, self-test or judge files`);
    }
    if (!entry.explicit && !scaffoldText.includes('_shared/probe.sh')) {
      findings.push(`${name}/scaffold.sh: does not end with the shared probe`);
    }

    findings.push(...judgeFindings(entry));
    findings.push(...scopeFindings(entry, all));
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
    if (criterion.tag !== undefined && !JUDGE_TAGS.has(criterion.tag))
      findings.push(`${where}: ${criterion.id} tag must be defect or decoy`);
    if (criterion.tag !== undefined && criterion.kind !== 'outcome')
      findings.push(`${where}: ${criterion.id} is tagged ${criterion.tag} but is not an outcome`);
  }
  return findings;
}

// scope.json is runner-only: never staged for a run or shown to the judge, so it is not scanned.
function scopeFindings(entry, cases) {
  const where = `${entry.name}/scope.json`;
  const { scope } = entry;
  if (!scope) return [`${where}: missing`];
  const findings = [];
  const strings = (value) =>
    Array.isArray(value) && value.every((item) => typeof item === 'string' && item !== '');
  if (!strings(scope.requestedPaths) || scope.requestedPaths.length === 0)
    findings.push(`${where}: requestedPaths must be a non-empty list of globs`);
  if (
    !strings(scope.allowedCommands) &&
    !(Array.isArray(scope.allowedCommands) && scope.allowedCommands.length === 0)
  )
    findings.push(`${where}: allowedCommands must be a list`);
  const known = new Set(GUARDED_COMMANDS.map((command) => command.name));
  for (const command of Array.isArray(scope.allowedCommands) ? scope.allowedCommands : []) {
    if (!known.has(command)) findings.push(`${where}: unknown allowed command ${command}`);
  }
  const extra = Object.keys(scope).filter(
    (key) => !['requestedPaths', 'allowedCommands'].includes(key),
  );
  if (extra.length) findings.push(`${where}: unknown keys ${extra.join(', ')}`);
  if (entry.judge.inheritedFrom) {
    const base = cases.get(entry.judge.inheritedFrom);
    if (JSON.stringify(base?.scope) !== JSON.stringify(scope))
      findings.push(`${where}: must equal its base case's scope.json`);
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

function changedPaths(workspace) {
  return run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: workspace })
    .stdout.split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^.* -> /, ''));
}

/**
 * The no-unrequested-changes guard: changed paths (hidden tests excluded) must match `requestedPaths`,
 * and Bash calls may run a guarded command only when `allowedCommands` names it.
 */
export function evaluateGuard(scope, workspace, trace) {
  const outside = changedPaths(workspace)
    .filter((path) => !path.startsWith('test/hidden/'))
    .filter((path) => !scope.requestedPaths.some((glob) => matchesGlob(path, glob)));
  const commands = toolCallsIn(trace)
    .filter((call) => call.name === 'Bash')
    .flatMap((call) =>
      GUARDED_COMMANDS.filter(({ pattern }) => pattern.test(String(call.input?.command ?? ''))),
    )
    .map(({ name }) => name)
    .filter((name) => !(scope.allowedCommands ?? []).includes(name));
  const unrequested = [...new Set(commands)];
  return {
    passed: outside.length === 0 && unrequested.length === 0,
    detail: [...outside, ...unrequested].join(', ') || 'only requested changes',
  };
}

function readRunSpec(entry, variant) {
  return JSON.parse(readFileSync(join(entry.selfTestDir, variant, 'run.json'), 'utf8'));
}

/** Self-test variants present for a case: the four core outputs first, then flawed ones. */
export function selfTestVariants(entry) {
  const present = existsSync(entry.selfTestDir)
    ? readdirSync(entry.selfTestDir).filter((name) =>
        statSync(join(entry.selfTestDir, name)).isDirectory(),
      )
    : [];
  const extra = present.filter((name) => !CORE_VARIANTS.includes(name)).sort();
  return [...CORE_VARIANTS, ...extra];
}

function decoyIds(entry) {
  return new Set(entry.judge.criteria.filter((c) => c.tag === 'decoy').map((c) => c.id));
}

/**
 * Expected verdict of one check on one variant. `id` is a grader name, judge criterion id, `guard`
 * or `hidden-tests`. Guard and decoy checks pass unless the variant lists them in `fails`; a flawed
 * variant (run.json `base`) is its base output with only its `fails` broken.
 */
export function expectedFor(entry, variant, id, role) {
  if (role === 'format' || role === 'indicator') return variant.endsWith('-planr');
  const spec = existsSync(join(entry.selfTestDir, variant, 'run.json'))
    ? readRunSpec(entry, variant)
    : {};
  const fails = spec.fails ?? [];
  if (id === GUARD || decoyIds(entry).has(id) || spec.base) return !fails.includes(id);
  if (variant.startsWith('good-')) return true;
  return spec.judge?.[id] ?? false;
}

const SYNTHETIC_CWD = '/tmp/e-x/home/cwd/';

// A Write written as "..." in run.json carries the final workspace file's text, as a real trace would.
function withWorkspaceContent(call, workspace) {
  const { file_path: filePath, content } = call.input ?? {};
  if (call.name !== 'Write' || content !== '...' || !filePath?.startsWith(SYNTHETIC_CWD))
    return call;
  const source = join(workspace, filePath.slice(SYNTHETIC_CWD.length));
  if (!existsSync(source)) return call;
  return { ...call, input: { ...call.input, content: readFileSync(source, 'utf8') } };
}

// Overlay files, deletions, tool calls and last message of a variant, starting from its base's.
function applyVariant(entry, variant, workspace) {
  const dir = join(entry.selfTestDir, variant);
  const spec = readRunSpec(entry, variant);
  const inherited = spec.base ? applyVariant(entry, spec.base, workspace) : null;
  if (existsSync(join(dir, 'files'))) cpSync(join(dir, 'files'), workspace, { recursive: true });
  if (existsSync(join(dir, 'delete.txt'))) {
    for (const path of readFileSync(join(dir, 'delete.txt'), 'utf8').split('\n').filter(Boolean)) {
      rmSync(join(workspace, path), { force: true });
    }
  }
  const ownMessage = join(dir, 'last-message.md');
  return {
    lastMessage: existsSync(ownMessage)
      ? readFileSync(ownMessage, 'utf8').trim()
      : (inherited?.lastMessage ?? ''),
    toolCalls: [...(inherited?.toolCalls ?? []), ...(spec.toolCalls ?? [])],
  };
}

/** Scaffolds a case, lays one self-test output over it and returns its run data; the caller removes `root`. */
export function buildSelfTestRun(entry, variant) {
  const { root, workspace } = scaffoldCase(entry);
  const applied = applyVariant(entry, variant, workspace);
  const { lastMessage } = applied;
  const toolCalls = applied.toolCalls.map((call) => withWorkspaceContent(call, workspace));
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

/** Runs every free grader, the guard and the hidden tests against each self-test output of a case. */
export function selfTestCase(entry) {
  const results = [];
  for (const variant of selfTestVariants(entry)) {
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
      if (entry.scope) {
        const { passed, detail } = evaluateGuard(entry.scope, runData.workspace, runData.trace);
        results.push({
          variant,
          check: `outcome:${GUARD}`,
          expected: expectedFor(entry, variant, GUARD, 'outcome'),
          actual: passed,
          detail,
        });
      }
      for (const grader of entry.graders) {
        const role = graderRole(grader);
        const { passed, detail } = evaluateFreeGrader(grader, runData);
        results.push({
          variant,
          check: `${role}:${grader.name}`,
          expected: expectedFor(entry, variant, grader.name, role),
          actual: passed,
          detail,
        });
      }
      if (entry.hidden) {
        const hidden = runHiddenTests(entry.hidden, runData.workspace);
        const expected = expectedFor(entry, variant, HIDDEN_TESTS, 'outcome');
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

/** Judge criteria with the verdict each self-test output should get in the pilot judge check. */
export function judgeExpectations(entry) {
  const variants = selfTestVariants(entry);
  return entry.judge.criteria.map((criterion) => ({
    id: criterion.id,
    kind: criterion.kind,
    ...(criterion.tag ? { tag: criterion.tag } : {}),
    expected: Object.fromEntries(
      variants.map((variant) => [
        variant,
        expectedFor(entry, variant, criterion.id, criterion.kind),
      ]),
    ),
  }));
}

/**
 * Problems with self-test variants: missing required outputs, unknown or misplaced `fails` and
 * `judge` overrides, bad outputs that pass most defect criteria, flawed outputs that break nothing.
 */
export function judgeExpectationFindings(entry) {
  if (entry.judge.inheritedFrom) return [];
  const findings = [];
  const variants = selfTestVariants(entry);
  const decoys = decoyIds(entry);
  const required = [UNREQUESTED_EDIT_VARIANT, ...(decoys.size ? [DECOY_VARIANT] : [])];
  for (const variant of required) {
    if (!variants.includes(variant)) findings.push(`${variant}: missing self-test output`);
  }
  const criteria = judgeExpectations(entry);
  const known = new Set([
    GUARD,
    HIDDEN_TESTS,
    ...entry.graders.map((grader) => grader.name),
    ...criteria.map((criterion) => criterion.id),
  ]);
  const harm = new Set([GUARD, ...decoys]);
  for (const variant of variants) {
    const path = join(entry.selfTestDir, variant, 'run.json');
    if (!existsSync(path)) continue;
    const spec = readRunSpec(entry, variant);
    const fails = spec.fails ?? [];
    for (const id of fails)
      if (!known.has(id)) findings.push(`${variant}: fails names unknown check ${id}`);
    if (spec.base !== undefined) {
      if (!CORE_VARIANTS.includes(spec.base) || !spec.base.startsWith('good-'))
        findings.push(`${variant}: base must be a good core output`);
      if (fails.length === 0) findings.push(`${variant}: a flawed output must list what it fails`);
      for (const id of fails.filter((item) => !harm.has(item)))
        findings.push(`${variant}: a flawed output may fail only the guard or decoys, not ${id}`);
      if (variant.startsWith('bad-edit-') && !fails.includes(GUARD))
        findings.push(`${variant}: an unrequested-edit output must fail the guard`);
      if (variant.startsWith('bad-decoy-') && !fails.some((id) => decoys.has(id)))
        findings.push(`${variant}: a decoy output must fail a decoy criterion`);
    } else if (variant.startsWith('good-') && fails.length) {
      findings.push(`${variant}: a good output fails nothing`);
    } else {
      for (const id of fails.filter((item) => !harm.has(item)))
        findings.push(`${variant}: fails may name only the guard or decoys, not ${id}`);
    }
    for (const [id, value] of Object.entries(spec.judge ?? {})) {
      const criterion = criteria.find((item) => item.id === id);
      if (!criterion) findings.push(`${variant}: judge override for unknown criterion ${id}`);
      else if (
        !CORE_VARIANTS.includes(variant) ||
        !variant.startsWith('bad-') ||
        criterion.kind !== 'outcome' ||
        criterion.tag === 'decoy' ||
        value !== true
      ) {
        findings.push(
          `${variant}: judge override ${id} is allowed only as a passing outcome on a bad output`,
        );
      }
    }
    if (CORE_VARIANTS.includes(variant) && variant.startsWith('bad-')) {
      const outcomes = criteria.filter((c) => c.kind === 'outcome' && c.tag !== 'decoy');
      const passing = outcomes.filter((criterion) => criterion.expected[variant]).length;
      if (outcomes.length > 0 && passing * 2 >= outcomes.length) {
        findings.push(
          `${variant}: expected to pass ${passing} of ${outcomes.length} non-decoy outcome criteria; a bad output must fail most`,
        );
      }
    }
  }
  return findings;
}

/** The `expect.json` content a self-test output must carry: hidden-test, guard, free-grader and judge verdicts. */
export function derivedExpectations(entry, variant) {
  const expect = {};
  if (entry.hidden) expect.hidden = expectedFor(entry, variant, HIDDEN_TESTS, 'outcome');
  if (entry.scope) expect.guard = expectedFor(entry, variant, GUARD, 'outcome');
  expect.graders = Object.fromEntries(
    entry.graders.map((grader) => [
      grader.name,
      expectedFor(entry, variant, grader.name, graderRole(grader)),
    ]),
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
  for (const variant of selfTestVariants(entry)) {
    if (!existsSync(join(entry.selfTestDir, variant))) continue;
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
    const findings = staticFindings(cases, { all });
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
