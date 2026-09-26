import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { projectedSkillName } from '../../../../scripts/skills/host-invocations.mjs';

import {
  assertGuidedCliResult,
  createGuidedAnswerEnvelope,
  encodeGuidedAnswerStdin,
  guidedAnswerPreviewDigest,
  reduceGuidedAnswerEnvelope,
  resolveGuidedInteraction,
  selectGuidedAction,
} from '../../lib/pipeline/index.mjs';

const pipelineRoot = fileURLToPath(new URL('../../', import.meta.url));
const workspaceRoot = resolve(pipelineRoot, '..', '..');
const fixtureRoot = new URL('../../conformance/fixtures/guided-runtime-parity/', import.meta.url);

function json(name) {
  return JSON.parse(readFileSync(new URL(name, fixtureRoot), 'utf8'));
}

function directories(path) {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort();
}

test('native, chat, terminal, and none modes follow deterministic capability downgrade', () => {
  const registry = json(new URL('../../../registry/adapters.json', fixtureRoot));
  for (const fixtureName of ['native.json', 'chat.json', 'terminal.json', 'none.json']) {
    const fixture = json(fixtureName);
    const resolved = resolveGuidedInteraction({
      registry,
      runtime: fixture.runtime,
      runtimeReport: fixture.runtimeReport,
    });
    assert.equal(resolved.mode, fixture.expectedMode, fixtureName);
    assert.equal(resolved.fallback, fixture.expectedFallback, fixtureName);
    assert.deepEqual(resolved.attempted, ['native', 'chat', 'terminal', 'none']);
  }
});

test('equal typed answers reduce to byte-equivalent previews across transports', () => {
  const questionnaire = json('questionnaire.json');
  const answers = json('answers.json');
  const envelopes = ['native', 'chat', 'terminal'].map((interaction) =>
    createGuidedAnswerEnvelope({
      questionnaire,
      answers,
      runtime:
        interaction === 'native' ? 'codex' : interaction === 'chat' ? 'cursor' : 'claude-code',
      runtimeVersion: 'fixture',
      interaction,
      submittedAt: `2026-07-29T09:00:0${interaction.length}.000Z`,
    }),
  );
  const previews = envelopes.map(reduceGuidedAnswerEnvelope);
  assert.deepEqual(previews[1], previews[0]);
  assert.deepEqual(previews[2], previews[0]);
  assert.equal(guidedAnswerPreviewDigest(envelopes[1]), guidedAnswerPreviewDigest(envelopes[0]));
  for (const envelope of envelopes) {
    assert.deepEqual(JSON.parse(encodeGuidedAnswerStdin(envelope)), envelope);
  }
});

test('guided actions require their exact confirmation digest', () => {
  const action = json('action.json');
  const result = assertGuidedCliResult({
    ok: false,
    action: 'input_required',
    questionnaire: json('questionnaire.json'),
    actions: [action],
  });
  assert.deepEqual(
    selectGuidedAction({
      actions: result.actions,
      actionId: action.id,
      confirmationDigest: action.confirmationDigest,
    }),
    {
      actionId: action.id,
      command: action.command,
      confirmationDigest: action.confirmationDigest,
      effect: 'project-write',
      providerUse: false,
    },
  );
  assert.throws(
    () =>
      selectGuidedAction({
        actions: result.actions,
        actionId: action.id,
        confirmationDigest: `sha256:${'f'.repeat(64)}`,
      }),
    (error) => error.code === 'E_GUIDED_ADAPTER_CONFIRMATION_MISMATCH',
  );
});

test('generated host packages expose every canonical skill and nine Claude agents', () => {
  const canonical = JSON.parse(readFileSync(join(workspaceRoot, 'skills/registry.json'), 'utf8'))
    .skills.map(({ skillId }) => skillId)
    .sort();
  assert.equal(new Set(canonical).size, canonical.length);
  const check = spawnSync(process.execPath, ['scripts/skills/check-host-parity.mjs'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.deepEqual(JSON.parse(check.stdout), {
    ok: true,
    protocolVersion: '1.8.0',
    skills: canonical.length,
    claudeAgents: 9,
    hosts: ['openai', 'claude', 'cursor'],
    aliases: 0,
    generatedCommands: 0,
  });

  const catalog = JSON.parse(
    readFileSync(join(workspaceRoot, 'adapters/manifests/canonical-skills.json'), 'utf8'),
  );
  const expected = [...catalog.skillIds].sort();
  assert.deepEqual(expected, canonical);
  for (const host of ['openai', 'claude']) {
    const pluginRoot = join(workspaceRoot, 'dist', 'plugins', host, 'openplanr');
    assert.deepEqual(
      directories(join(pluginRoot, 'skills')),
      expected.map(projectedSkillName).sort(),
    );
    assert.equal(existsSync(join(pluginRoot, 'commands')), false);
    assert.equal(existsSync(join(pluginRoot, 'codex-skills')), false);
  }
});
