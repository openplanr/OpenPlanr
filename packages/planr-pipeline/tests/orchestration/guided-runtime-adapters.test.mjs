import assert from 'node:assert/strict';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertGuidedCliResult,
  createGuidedAnswerEnvelope,
  encodeGuidedAnswerStdin,
  guidedAnswerPreviewDigest,
  reduceGuidedAnswerEnvelope,
  resolveGuidedInteraction,
  selectGuidedAction,
} from '../../lib/pipeline/index.mjs';
import {
  renderGuidedAdapterAssets,
  runGuidedAdapterGenerator,
} from '../../scripts/generate-guided-adapters.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtureRoot = new URL(
  '../../conformance/fixtures/guided-runtime-parity/',
  import.meta.url,
);
const temporaryRoots = [];

function json(name) {
  return JSON.parse(readFileSync(new URL(name, fixtureRoot), 'utf8'));
}

function tempRoot() {
  const path = mkdtempSync(join(tmpdir(), 'planr-guided-adapter-'));
  temporaryRoots.push(path);
  return path;
}

afterEach(() => {
  while (temporaryRoots.length) rmSync(temporaryRoots.pop(), { recursive: true, force: true });
});

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

  const cursor = resolveGuidedInteraction({
    registry,
    runtime: 'cursor',
    runtimeReport: {
      nativeQuestions: true,
      structuredChat: true,
      attachedTerminal: true,
    },
  });
  assert.equal(cursor.declared, 'chat');
  assert.equal(cursor.mode, 'chat', 'native cannot exceed the adapter ceiling');
});

test('equal typed answers reduce to byte-equivalent previews across runtime transports', () => {
  const questionnaire = json('questionnaire.json');
  const answers = json('answers.json');
  const envelopes = ['native', 'chat', 'terminal'].map((interaction) =>
    createGuidedAnswerEnvelope({
      questionnaire,
      answers,
      runtime: interaction === 'native' ? 'codex' : interaction === 'chat' ? 'cursor' : 'claude-code',
      runtimeVersion: 'fixture',
      interaction,
      submittedAt: `2026-07-29T09:00:0${interaction.length}.000Z`,
    }));
  const previews = envelopes.map(reduceGuidedAnswerEnvelope);
  assert.deepEqual(previews[1], previews[0]);
  assert.deepEqual(previews[2], previews[0]);
  assert.equal(guidedAnswerPreviewDigest(envelopes[1]), guidedAnswerPreviewDigest(envelopes[0]));
  assert.equal(guidedAnswerPreviewDigest(envelopes[2]), guidedAnswerPreviewDigest(envelopes[0]));
  for (const envelope of envelopes) {
    const stdin = encodeGuidedAnswerStdin(envelope);
    assert.deepEqual(JSON.parse(stdin), envelope);
  }
});

test('adapters consume schema-valid CLI artifacts and echo only an explicitly selected action', () => {
  const questionnaire = json('questionnaire.json');
  const action = json('action.json');
  const result = assertGuidedCliResult({
    ok: false,
    action: 'input_required',
    questionnaire,
    actions: [action],
  });
  const selected = selectGuidedAction({
    actions: result.actions,
    actionId: action.id,
    confirmationDigest: action.confirmationDigest,
  });
  assert.deepEqual(selected, {
    actionId: action.id,
    command: action.command,
    confirmationDigest: action.confirmationDigest,
    effect: 'project-write',
    providerUse: false,
  });
  assert.throws(
    () => selectGuidedAction({
      actions: result.actions,
      actionId: action.id,
      confirmationDigest: `sha256:${'f'.repeat(64)}`,
    }),
    (error) => error.code === 'E_GUIDED_ADAPTER_CONFIRMATION_MISMATCH',
  );
  assert.throws(
    () => assertGuidedCliResult({
      questionnaire: { ...questionnaire, questions: [] },
      actions: [],
    }),
    (error) => error.code === 'E_GUIDED_ADAPTER_INPUT_INVALID',
  );
});

test('bounded stdin rejects oversized submissions instead of falling back to shell flags', () => {
  const envelope = createGuidedAnswerEnvelope({
    questionnaire: json('questionnaire.json'),
    answers: json('answers.json'),
    runtime: 'codex',
    runtimeVersion: 'fixture',
    interaction: 'native',
    submittedAt: '2026-07-29T09:00:00.000Z',
  });
  assert.throws(
    () => encodeGuidedAnswerStdin(envelope, { maxBytes: 16 }),
    (error) => error.code === 'E_GUIDED_ADAPTER_STDIN_TOO_LARGE',
  );
});

test('generated adapter docs and runtime-asset digests are current', () => {
  assert.deepEqual(
    runGuidedAdapterGenerator({ argv: ['--check'], projectRoot: root }),
    { ok: true, mode: 'check', staleTargets: [] },
  );
  const rendered = renderGuidedAdapterAssets({ projectRoot: root });
  assert.match(rendered['docs/runtime-guided-interactions.md'], /Native presentation is selected only/u);
  for (const path of [
    'adapters/codex/skills/planr-operate/SKILL.md',
    'adapters/cursor/rules/openplanr-operate.mdc',
    'commands/operate.md',
  ]) {
    const content = readFileSync(join(root, path), 'utf8');
    assert.match(content, /Start guided setup with exactly `planr operate init --json`/u);
    assert.doesNotMatch(content, /planr operate init --guided/u);
    assert.match(content, /answers\.copyFields/u);
    assert.match(content, /required.*valueType.*constraints|constraints.*required.*valueType/su);
    assert.match(content, /Never launch a bare\s+`--stdin` action/u);
    assert.match(content, /closes EOF in the\s+same invocation/u);
    assert.match(content, /higher-sensitivity\s+answers/u);
    assert.match(content, /Independent advisor inference may\s+run in parallel/u);
    assert.match(content, /adapter lifecycle mutations are serial/u);
    assert.match(content, /wait for its returned handoff/u);
    assert.match(content, /replay it byte-for-byte/u);
  }
});

test('generated adapter checks are stable on CRLF worktrees', () => {
  const projectRoot = tempRoot();
  const paths = [
    'registry/adapters.json',
    'conformance/fixtures/guided-runtime-parity/questionnaire.json',
    'conformance/fixtures/guided-runtime-parity/generated-assets.json',
    'docs/runtime-guided-interactions.md',
    'adapters/claude-code/README.md',
    'adapters/codex/skills/planr-operate/SKILL.md',
    'adapters/codex/project-guidance.md',
    'adapters/cursor/rules/openplanr-operate.mdc',
    'commands/operate.md',
  ];
  for (const path of paths) {
    const target = join(projectRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    const bytes = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    writeFileSync(target, bytes.replace(/\r\n/gu, '\n').replace(/\n/gu, '\r\n'), 'utf8');
  }
  assert.deepEqual(
    runGuidedAdapterGenerator({ argv: ['--check'], projectRoot }),
    { ok: true, mode: 'check', staleTargets: [] },
  );
});

test('static conformance rejects copied questions and implicit authority in adapter assets', () => {
  const projectRoot = tempRoot();
  const paths = [
    'registry/adapters.json',
    'conformance/fixtures/guided-runtime-parity/questionnaire.json',
    'adapters/claude-code/README.md',
    'adapters/codex/skills/planr-operate/SKILL.md',
    'adapters/codex/project-guidance.md',
    'adapters/cursor/rules/openplanr-operate.mdc',
    'commands/operate.md',
  ];
  for (const path of paths) {
    const target = join(projectRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(new URL(`../../${path}`, import.meta.url), target);
  }
  const codexSkill = join(projectRoot, 'adapters/codex/skills/planr-operate/SKILL.md');
  writeFileSync(
    codexSkill,
    `${readFileSync(codexSkill, 'utf8')}\nWho owns final operating decisions?\n`,
  );
  assert.throws(
    () => renderGuidedAdapterAssets({ projectRoot }),
    (error) =>
      error.code === 'E_GUIDED_ADAPTER_STATIC_SCAN'
      && error.details.failures.some((failure) => failure.startsWith('copied CLI question')),
  );
});
