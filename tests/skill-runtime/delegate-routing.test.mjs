import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { matchSkillRequest } from '../../packages/skill-runtime/src/matching/index.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const registry = JSON.parse(read('skills/registry.json'));

const route = (input) => matchSkillRequest({ registry, input })?.skillId;

test('only an explicit second-agent implementation request selects planr-delegate', () => {
  for (const request of [
    'Delegate implementation to another coding agent',
    'Ask a second coding agent to implement while I orchestrate',
    'Use planr-delegate for this task',
    'Have Codex implement this task',
    'Use Codex to implement this',
    'Have Claude Code implement the requested change',
    'Ask another coding agent to implement this task',
    'Ask another coding agent to implement the task and review the diff',
    'Please use Codex to implement the fix, then review the resulting patch',
  ]) {
    assert.equal(route(request), 'planr-delegate', request);
  }
  for (const request of [
    'Ship this change',
    'Build the requested local code change from this task',
    'Implement this task in the active agent',
    'This API delegates authentication to Clerk; fix its redirect bug',
    'Use a native backend role to implement this task',
    'Ask another agent to review this code',
    'Review this code using Codex',
    'Implement this plan with parallel coding agents',
    'Use native parallel agents to implement this task',
    'Fix the delegate runner in the active agent',
  ]) {
    assert.notEqual(route(request), 'planr-delegate', request);
  }
  assert.equal(route('Ship this change'), 'planr-ship');
  assert.equal(route('Implement this plan with parallel coding agents'), 'planr-ship');
  assert.equal(route('Use native parallel agents to implement this task'), 'planr-ship');
  assert.equal(route('Fix the delegate runner in the active agent'), 'planr-ship');
  assert.equal(route('Build the requested local code change from this task'), 'planr-ship');
});

test('Claude and Codex installed routers and Ship expose only the opt-in handoff', () => {
  const sourceRouter = read('skills/planr-openplanr/SKILL.md');
  const sourceShip = read('skills/planr-ship/SKILL.md');
  assert.match(sourceRouter, /Ask another coding agent to implement[^\n]*`planr-delegate`/u);
  assert.match(sourceRouter, /Plain implementation stays with\s+host-native `planr-ship`/u);
  assert.match(
    sourceShip,
    /If the user explicitly asks another coding agent to implement,[\s\S]*hand off to `planr-delegate`/u,
  );
  assert.match(sourceShip, /plain Ship never launches its helper/u);
  for (const host of ['claude', 'openai']) {
    const base = `dist/plugins/${host}/openplanr/skills`;
    const router = read(`${base}/openplanr/SKILL.md`);
    const ship = read(`${base}/ship/SKILL.md`);
    const delegate = read(`${base}/delegate/SKILL.md`);
    assert.match(router, /Ask another coding agent to implement[^\n]*`planr-delegate`/u);
    assert.match(ship, /plain Ship never launches its helper/u);
    assert.match(delegate, /git worktree add -b planr-delegate\/<slug>/u);
    assert.match(delegate, /required ignored planning files by path/u);
    assert.match(delegate, /"Do not commit\."/u);
    assert.match(delegate, /Every changed path must be in scope\. Run the gates\s+yourself/u);
    assert.match(delegate, /`result\.selected\.identity`/u);
    assert.match(delegate, /saved profile runs only through/u);
    const references = readdirSync(resolve(root, base, 'delegate/references'));
    for (const path of ['SKILL.md', ...references.map((name) => `references/${name}`)])
      assert.doesNotMatch(
        read(`${base}/delegate/${path}`),
        /CODEX_HOME|CLAUDE_CONFIG_DIR|auth status|login status|agent status|keychain|config\.toml/u,
      );
    assert.match(delegate, /openplanr delegate probe --json/u);
    assert.match(delegate, /local-model ones included/u);
    assert.match(delegate, /`result\.profiles`/u);
    assert.match(delegate, /`kind`/u);
    assert.match(delegate, /`selectedModel`/u);
    assert.match(delegate, /`destination\.class`/u);
    assert.match(delegate, /never fall back to a cloud model/u);
    assert.doesNotMatch(
      read(`${base}/artifact/references/company-review.md`),
      /environment-token/u,
    );
    assert.doesNotMatch(read(`${base}/browser-qa/SKILL.md`), /credentials cannot be\s+inferred/u);
    const cli = read(`${base}/delegate/references/openplanr-cli.md`);
    assert.match(cli, /context inventory once before `dispatch`/u);
    assert.doesNotMatch(cli, /npx -y|npx openplanr/u);
  }
});

test('neither Ship nor delegate ships a runner script; delegate runs through the CLI', () => {
  const ship = JSON.parse(read('skills/planr-ship/openplanr.skill.json'));
  const delegate = JSON.parse(read('skills/planr-delegate/openplanr.skill.json'));
  assert.equal(ship.execution, 'host-agent');
  assert.equal(
    ship.resources.some(({ path }) => path.includes('delegate') || path.includes('runner.mjs')),
    false,
  );
  assert.deepEqual(
    delegate.resources.filter(({ path }) => !/\.(?:md|yaml)$/u.test(path)),
    [],
  );
});
