import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBoundedInitAnswers } from '../../src/cli/commands/operate.js';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
} from '../../src/services/operate/config.js';
import { executeOperateAction } from '../../src/services/operate/index.js';
import type {
  GuidedAnswerEnvelope,
  GuidedQuestionnaire,
  GuidedQuestionValue,
} from '../../src/services/operate/types.js';

function buildAnswerEnvelope(
  questionnaire: GuidedQuestionnaire,
  values: Record<string, GuidedQuestionValue>,
): GuidedAnswerEnvelope {
  const descriptors = new Map(
    questionnaire.submission.envelope.dynamicFields.answers.items.map((item) => [
      item.questionId,
      item,
    ]),
  );
  const answers = Object.entries(values).map(([questionId, value]) => {
    const descriptor = descriptors.get(questionId);
    if (!descriptor) throw new Error(`Missing answer descriptor for ${questionId}.`);
    return Object.assign(
      Object.fromEntries(
        questionnaire.submission.envelope.dynamicFields.answers.copyFields.map((field) => [
          field,
          descriptor[field],
        ]),
      ),
      { value },
    ) as GuidedAnswerEnvelope['answers'][number];
  });
  return {
    ...questionnaire.submission.envelope.fixedFields,
    questionnaireDigest: questionnaire.digest,
    answers,
    submittedAt: new Date(Date.parse(questionnaire.createdAt) + 1).toISOString(),
  };
}

const RUNTIME_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CURSOR_TRACE_ID',
  'CURSOR_AGENT',
  'CODEX_SANDBOX',
  'CODEX_HOME',
];

/** Neutralize any ambient coding-runtime markers so detection is deterministic. */
function clearRuntimeMarkers(): void {
  for (const marker of RUNTIME_MARKERS) vi.stubEnv(marker, '');
}

const execFileAsync = promisify(execFile);

async function gitProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-guided-init-'));
  await execFileAsync('git', ['init', '--quiet'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], { cwd: root });
  await writeFile(join(root, 'README.md'), '# Fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });
  return root;
}

describe('guided Operating Board initialization', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // FR6 / DoD #4 — the JSON init path probes the real host runtime from launcher
  // env markers and stamps a truthful adapter block instead of unknown/none.
  it('detects the host runtime from env markers instead of stamping unknown/none', async () => {
    const projectRoot = await gitProject();
    clearRuntimeMarkers();
    vi.stubEnv('CLAUDECODE', '1');

    const result = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true },
    });

    expect(result.code).toBe('E_OPERATE_INPUT_REQUIRED');
    expect(result.questionnaire?.adapter).toEqual({
      runtime: 'claude',
      version: 'detected',
      interaction: 'native',
    });
    // Detect-don't-ask: a clearly detected runtime is a non-required suggestion.
    const runtimeQuestion = result.questionnaire?.questions.find(
      (question) => question.questionId === 'runtime',
    );
    if (runtimeQuestion) {
      expect(runtimeQuestion).toMatchObject({
        required: false,
        valueSemantics: 'suggestion',
        suggestedValue: 'claude',
      });
    }
  });

  it('stamps an honest headless adapter block when no runtime is detectable', async () => {
    const projectRoot = await gitProject();
    clearRuntimeMarkers();

    const result = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true },
    });

    expect(result.code).toBe('E_OPERATE_INPUT_REQUIRED');
    expect(result.questionnaire?.adapter).toEqual({
      runtime: 'unknown',
      version: 'detected',
      interaction: 'none',
    });
    // With no detected runtime the question is ambiguous and therefore required.
    const runtimeQuestion = result.questionnaire?.questions.find(
      (question) => question.questionId === 'runtime',
    );
    expect(runtimeQuestion).toMatchObject({ required: true });
  });

  it('returns Protocol input_required instead of invalid config when JSON input is missing', async () => {
    const projectRoot = await gitProject();
    const result = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true },
    });

    expect(result).toMatchObject({
      ok: true,
      flow: 'handoff',
      action: 'input_required',
      code: 'E_OPERATE_INPUT_REQUIRED',
      protocolVersion: '1.2.0',
      questionnaire: {
        kind: 'guided-questionnaire',
        schemaVersion: '1.1.0',
        command: 'operate.init',
        stage: 'foundation',
        step: 1,
        totalSteps: 3,
        submission: {
          kind: 'guided-answer-submission',
          transport: {
            kind: 'stdin-json',
            maxBytes: 65536,
          },
        },
      },
    });
    expect(result.questionnaire?.questions.map((question) => question.questionId)).toContain(
      'decision-owner',
    );
    await expect(
      readFile(join(projectRoot, '.planr', 'operate', 'config.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // FR8 / E-008 — a digest-confirmable recovery action is directly executable:
  // it hands the runner the exact confirm argv, so no token is re-synthesized.
  it('hands the runner a directly executable confirmArgv on a digest-confirmable action', async () => {
    const projectRoot = await gitProject();
    const result = await executeOperateAction({
      action: 'run',
      projectRoot,
      interactive: false,
      options: { json: true, preview: true, runtime: 'codex' },
    });

    expect(result).toMatchObject({ ok: false, code: 'E_OPERATE_NOT_INITIALIZED' });
    const initAction = result.actions?.find((action) => action.command === 'planr operate init');
    expect(initAction?.confirmationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(initAction?.confirmArgv).toEqual([
      'planr',
      'operate',
      'init',
      '--confirm',
      initAction?.confirmationDigest,
      '--yes',
    ]);
  });

  it('names a machine-local state-root write denial without exposing its path', async () => {
    const projectRoot = await gitProject();
    const unavailableRoot = join(projectRoot, 'state-root-is-a-file');
    await writeFile(unavailableRoot, 'not a directory\n');

    const result = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true, localRoot: unavailableRoot },
    });

    expect(result).toMatchObject({
      ok: false,
      action: 'init',
      code: 'E_OPERATE_STATE_UNAVAILABLE',
      exitCode: 3,
      message: expect.stringContaining('Grant the active runtime sandbox write access'),
      data: {
        stateClass: 'machine-local',
        requiredPermission: 'write',
        platformCode: 'ENOTDIR',
        recoveryCommand: 'planr operate init --json',
      },
      nextActions: ['planr operate init --json'],
    });
    expect(JSON.stringify(result)).not.toContain(unavailableRoot);
  });

  it('returns only unanswered canonical questions for partial machine input', async () => {
    const projectRoot = await gitProject();
    const result = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true, decisionOwner: 'Asem' },
    });

    expect(result.code).toBe('E_OPERATE_INPUT_REQUIRED');
    expect(result.questionnaire?.questions.map((question) => question.questionId)).not.toContain(
      'decision-owner',
    );
    expect(result.questionnaire?.questions.map((question) => question.questionId)).toEqual(
      expect.arrayContaining(['profile', 'planning-engine']),
    );
  });

  it('suggests the decision owner from the git user on the JSON init path', async () => {
    const projectRoot = await gitProject();
    clearRuntimeMarkers();

    const result = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true },
    });

    const owner = result.questionnaire?.questions.find(
      (question) => question.questionId === 'decision-owner',
    );
    expect(owner).toMatchObject({
      valueSemantics: 'suggestion',
      suggestedValue: 'OpenPlanr Test',
    });
  });

  it('accepts --answers-file as a bounded stdin-parity alias with the same 64 KiB cap', async () => {
    const projectRoot = await gitProject();
    clearRuntimeMarkers();

    const start = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true },
    });
    const questionnaire = start.questionnaire as GuidedQuestionnaire;
    const raw = JSON.stringify(
      buildAnswerEnvelope(questionnaire, {
        profile: 'saas',
        'decision-owner': 'Asem',
        'planning-engine': 'openplanr',
        runtime: 'codex',
        'sensitivity-ceiling': 'internal',
      }),
    );
    // Write the answers document outside the project root so it never dirties the
    // working tree the session fingerprint is bound to.
    const scratch = await mkdtemp(join(tmpdir(), 'openplanr-answers-file-'));
    const answersFile = join(scratch, 'answers.json');
    await writeFile(answersFile, `${raw}\n`);

    // --answers-file yields exactly the bounded UTF-8 string --stdin would.
    await expect(readBoundedInitAnswers({ answersFile })).resolves.toBe(raw);

    // Submitting the file-derived document advances the session through the same
    // strict parser and digest binding as --stdin.
    const advanced = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true, resume: questionnaire.sessionId },
      stdin: await readBoundedInitAnswers({ answersFile }),
    });
    expect(advanced).toMatchObject({
      ok: true,
      flow: 'handoff',
      questionnaire: { stage: 'product-charter' },
    });

    // Same 64 KiB bound as --stdin.
    const oversizeFile = join(scratch, 'oversize.json');
    await writeFile(oversizeFile, 'x'.repeat(65 * 1024));
    await expect(readBoundedInitAnswers({ answersFile: oversizeFile })).rejects.toMatchObject({
      name: 'E_OPERATE_INPUT_TOO_LARGE',
    });
  });

  it('re-answers a persisted answer before apply without restarting the session', async () => {
    const projectRoot = await gitProject();
    clearRuntimeMarkers();

    const start = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true },
    });
    const foundation = start.questionnaire as GuidedQuestionnaire;
    const advanced = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true, resume: foundation.sessionId },
      stdin: JSON.stringify(
        buildAnswerEnvelope(foundation, {
          profile: 'saas',
          'decision-owner': 'Asem',
          'planning-engine': 'openplanr',
          runtime: 'codex',
          'sensitivity-ceiling': 'internal',
        }),
      ),
    });
    const charter = advanced.questionnaire as GuidedQuestionnaire;
    expect(charter.stage).toBe('product-charter');

    // Revise a previously accepted foundation answer (decision-owner) against the
    // current questionnaire — a differing value for an already-persisted answer.
    const revision = {
      ...charter.submission.envelope.fixedFields,
      questionnaireDigest: charter.digest,
      answers: [
        {
          questionId: 'decision-owner',
          questionVersion: '1.0.0' as const,
          sensitivity: 'internal' as const,
          value: 'Revised Owner',
        },
      ],
      submittedAt: new Date(Date.parse(charter.createdAt) + 2).toISOString(),
    };
    const revised = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true, resume: foundation.sessionId },
      stdin: JSON.stringify(revision),
    });
    // Accepted (never a replay conflict) and surfaced as the transient revising
    // state — no restart, no new session.
    expect(revised).toMatchObject({
      ok: true,
      code: 'E_OPERATE_INPUT_REQUIRED',
      state: 'revising',
    });

    // Completing the charter reaches the write-free preview with the REVISED value.
    const complete = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true, resume: foundation.sessionId },
      stdin: JSON.stringify(
        buildAnswerEnvelope(revised.questionnaire as GuidedQuestionnaire, {
          purpose: 'Turn evidence into cited operating decisions.',
          'product-stage': 'growth',
          'business-model': 'Subscription SaaS',
          'ideal-customer': 'Technical founders',
          goals: ['Reach a cited brief quickly'],
          'success-metrics': ['First useful brief within five minutes'],
          guardrails: ['No external effects without explicit confirmation'],
        }),
      ),
    });
    expect(complete).toMatchObject({
      ok: true,
      state: 'preview-ready',
      preview: { config: { decisionOwner: 'Revised Owner' } },
    });
  });

  it('suggests the profile named by an existing .planr/operate-profile.json', async () => {
    const projectRoot = await gitProject();
    clearRuntimeMarkers();
    await mkdir(join(projectRoot, '.planr'), { recursive: true });
    await writeFile(
      join(projectRoot, '.planr', 'operate-profile.json'),
      `${JSON.stringify({ id: 'engineering', title: 'Engineering', description: 'Delivery focus.' })}\n`,
    );

    const result = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true },
    });

    const profile = result.questionnaire?.questions.find(
      (question) => question.questionId === 'profile',
    );
    expect(profile).toMatchObject({
      valueSemantics: 'suggestion',
      suggestedValue: 'engineering',
    });
    expect(profile?.suggestionReason).toContain('operate-profile.json');
  });

  it('preserves fully specified flag automation and produces a write-free preview', async () => {
    const projectRoot = await gitProject();
    const result = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: {
        json: true,
        preview: true,
        profile: 'engineering',
        decisionOwner: 'Asem',
        planningEngine: 'openplanr',
        runtime: 'codex',
        cadence: 'manual',
        timezone: 'UTC',
        sensitivityCeiling: 'internal',
        purpose: 'Help product teams make cited operating decisions.',
        productStage: 'growth',
        businessModel: 'Subscription SaaS',
        idealCustomer: 'Technical founders',
        goal: ['Reach a trustworthy operating brief quickly'],
        successMetric: ['Time to first brief under five minutes'],
        guardrail: ['No external effects without explicit approval'],
        knownUnknown: ['Provider availability'],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      action: 'init',
      preview: {
        config: {
          profile: 'engineering',
          decisionOwner: 'Asem',
          planningEngine: 'openplanr',
        },
      },
    });
    await expect(
      readFile(join(projectRoot, '.planr', 'operate', 'config.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves supported machine-local preferences across a re-init preview', async () => {
    const projectRoot = await gitProject();
    const localRoot = await mkdtemp(join(tmpdir(), 'openplanr-guided-init-preview-delta-'));
    clearRuntimeMarkers();

    const charter = {
      purpose: 'Prove the init preview names changed preferences.',
      stage: 'growth',
      businessModel: 'subscription SaaS',
      idealCustomer: 'technical product teams',
      goals: ['Show the field-level preference delta before confirming.'],
      successMetrics: ['Time to a cited operating brief'],
      guardrails: ['Humans approve every mutation.'],
      knownUnknowns: ['Current activation baseline'],
    };

    // Seed a custom adapter lease and cadence marker alongside base preferences.
    const seedPreview = await prepareOperatingInitialization({
      projectRoot,
      localRoot,
      profile: 'engineering',
      decisionOwner: 'Product owner',
      planningEngine: 'openplanr',
      runtime: 'codex',
      cadence: 'manual',
      timezone: 'UTC',
      sensitivityCeiling: 'internal',
      enabledProviders: ['repository', 'git'],
      charter,
      adapterLeaseDurationMs: 5 * 60 * 1000,
      lastRunAt: '2026-07-30T12:00:00.000Z',
    });
    await applyOperatingInitialization({
      projectRoot,
      localRoot,
      preview: seedPreview,
      confirmationDigest: seedPreview.previewDigest,
    });

    // Base answers the re-init previews rebuild — identical to the seed base so
    // only the machine-local policy fields can differ.
    const initFlags = {
      json: true,
      localRoot,
      profile: 'engineering',
      decisionOwner: 'Product owner',
      planningEngine: 'openplanr',
      runtime: 'codex',
      cadence: 'manual',
      timezone: 'UTC',
      sensitivityCeiling: 'internal',
      charter,
    };

    // A re-init preview carries both supported fields forward.
    const carryForward = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { ...initFlags, preview: true },
    });
    expect(carryForward.preview).toMatchObject({
      changedPreferenceKeys: [],
      localPreferencesChanged: false,
    });
  });
});
