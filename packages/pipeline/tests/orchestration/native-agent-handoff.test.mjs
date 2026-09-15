import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { composeRuntimePrompt, runtimeHandoff } from '../../lib/pipeline/runtime.mjs';
import { materializePlanrFixture } from '../helpers/planr-fixture.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const bin = join(root, 'bin/planr-pipeline.mjs');
const FEATURE = 'live-evidence-outcomes-and-governed-landing';
const projectRoot = materializePlanrFixture('native-agent-handoff');
execFileSync('git', ['init', '-q'], { cwd: projectRoot });
execFileSync('git', ['add', '-A'], { cwd: projectRoot });
execFileSync(
  'git',
  ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-qm', 'fixture'],
  { cwd: projectRoot },
);
after(() => rmSync(projectRoot, { recursive: true, force: true }));

function ship(extra = [], cwd = projectRoot) {
  // A handoff deliberately exits 2; only a missing payload is a failure here.
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [bin, 'ship', FEATURE, '--no-launch', '--json', ...extra], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    stdout = error.stdout ?? '';
    if (!stdout.trim()) throw error;
  }
  return JSON.parse(stdout.trim());
}

test('normal pipeline help keeps release machine details behind the protocol documentation', () => {
  const help = execFileSync(process.execPath, [bin, 'help'], { encoding: 'utf8' });
  assert.match(help, /Advanced release and machine commands remain available/u);
  assert.doesNotMatch(help, /finalize-ship|receipt|evidence|--run-id/iu);
});

test('SHIP composes the canonical host entrypoint with the generated working context', () => {
  const result = ship(['--runtime', 'codex']);
  assert.equal(result.executionMode, 'handoff');
  assert.ok(result.context, 'the handoff carries working context');
  assert.match(result.command, /Invoke \$planr-ship live-evidence-outcomes-and-governed-landing with the working context below/u);
  assert.match(result.context, /## Acceptance criteria/u);
  const adapter = { id: 'codex', entrypoints: { ship: '$planr-ship' }, capabilities: {} };
  const prompt = composeRuntimePrompt(adapter, 'ship', FEATURE, result.context);
  assert.ok(prompt.startsWith(`$planr-ship ${FEATURE}\n\n# Working context`));
  assert.match(prompt, /## Implementation/u);
  // Graph content varies with how much of the feature is still unresolved; that the
  // dependency graph survives the mapping is asserted against a fixed fixture in
  // ship-context.test.mjs. What this test owns is the dispatch itself.
  assert.ok(
    !result.context.includes('planr-pipeline:ship'),
    'the generated context remains work data; the host entrypoint owns skill guidance',
  );
  assert.ok(!/--run-id|advance-ship|finalize-ship/u.test(result.context), 'no lifecycle CLI is imposed');
});

test('the runtime receives concise implementation guidance without workflow governance', () => {
  const { context } = ship();
  // Constraints quoted from the reviewed spec may name subagents or reviewers — often to
  // say the agent owns them. What matters is Planr's own closing instruction, and that
  // nothing anywhere scripts a procedure for the runtime to follow.
  const ownVoice = context.slice(context.indexOf('## Implementation'));
  assert.match(ownVoice, /Use the specification, active task details, repository context, and conventions above/u);
  assert.match(ownVoice, /return changed files, checks run, and any material remaining issue/u);
  for (const directive of ['subagent', 'reviewer', 'correction pass', 'retry']) {
    assert.ok(!ownVoice.toLowerCase().includes(directive), `Planr must not prescribe ${directive}`);
  }
  assert.ok(!/^\s*\d+\.\s+(Run|Execute|Invoke|Dispatch)\b/mu.test(context), 'no numbered procedure');
  assert.ok(!/^\s*(First|Then|Next|Finally),/mu.test(context), 'no imposed sequence');
  assert.ok(!/approval|authorization|stopping point/iu.test(ownVoice), 'no generic governance boilerplate');
});

test('re-running SHIP reproduces the same context from the current workspace', () => {
  // A retry must not depend on run identity or reconstruct finished work.
  const first = ship();
  const second = ship();
  assert.equal(first.context, second.context);
  assert.ok(!/ship_[a-z0-9]/u.test(first.context), 'no run identity leaks into the context');
});

test('ordinary SHIP requires no closure bookkeeping to start', () => {
  const result = ship();
  for (const key of ['runId', 'candidate', 'receiptHash', 'reviewerIds', 'generation']) {
    assert.ok(!(key in result), `${key} must not be required to hand over ordinary work`);
  }
});

test('ordinary CLI SHIP skips release gate initialization', () => {
  const contextRoot = materializePlanrFixture('native-agent-handoff');
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
    const result = ship([], contextRoot);
    assert.ok(result.context, 'ordinary SHIP still hands off planning context');
    assert.doesNotMatch(result.context, /Technical stack/u);
    assert.match(result.context, /Context diagnostic E_SHIP_GATE_INVALID/u);
    assert.match(result.context, /using the current project only/u);
  } finally {
    rmSync(contextRoot, { recursive: true, force: true });
  }
});

test('ordinary SHIP surfaces a stale runtime lock as a diagnostic', () => {
  const contextRoot = materializePlanrFixture('native-agent-handoff');
  writeFileSync(join(contextRoot, '.planr', 'runtime-lock.json'), JSON.stringify({
    protocolVersion: '1.0.0',
    components: { pipeline: '0.1.0' },
    adapters: [],
  }));

  try {
    const result = ship(['--runtime', 'codex'], contextRoot);
    assert.equal(result.executionMode, 'handoff');
    assert.equal(result.diagnostics[0].code, 'E_LOCK_INCOMPATIBLE');
    assert.match(result.diagnostics[0].fix, /planr runtime update codex/u);
  } finally {
    rmSync(contextRoot, { recursive: true, force: true });
  }
});

test('ordinary SHIP hands the canonical skill diagnostic context when planning artifacts are absent', () => {
  const contextRoot = mkdtempSync(join(tmpdir(), 'planr-missing-context-'));
  mkdirSync(join(contextRoot, '.planr'), { recursive: true });
  writeFileSync(join(contextRoot, '.planr', 'config.json'), JSON.stringify({ defaultAgent: 'codex' }));

  try {
    const result = ship(['--runtime', 'codex'], contextRoot);
    assert.equal(result.executionMode, 'handoff');
    assert.match(result.command, /Invoke \$planr-ship live-evidence-outcomes-and-governed-landing/u);
    assert.match(result.context, /Context diagnostic E_(?:SPEC_MISSING|R1_MISSING_STORIES|TASKS_MISSING)/u);
    assert.match(result.context, /No Planr specification document was available/u);
  } finally {
    rmSync(contextRoot, { recursive: true, force: true });
  }
});

test('release-candidate SHIP still routes to the closure workflow', () => {
  const result = ship(['--release-candidate']);
  assert.ok(!result.context, 'the release path does not replace its workflow with context');
  assert.match(result.command, /planr-pipeline:ship/u);
});

test('a handoff without context keeps the phase entrypoint', () => {
  const adapter = { id: 'cursor', entrypoints: { ship: '/planr-pipeline:ship' }, capabilities: {} };
  assert.match(runtimeHandoff(adapter, 'ship', 'demo').command, /Open Cursor and invoke .*demo/u);
  assert.equal(runtimeHandoff(adapter, 'ship', 'demo').context, undefined);
});
