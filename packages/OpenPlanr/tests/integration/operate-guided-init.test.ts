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
import { operatingInitializationAnswersFromResearch } from '../../src/services/operate/context-research.js';
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

async function gitHead(root: string): Promise<string> {
  return (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
}

/** The exact Protocol v1.4 epistemic-status vocabulary FR11 requires every inferred answer to carry. */
const EPISTEMIC_LABELS = [
  'observed',
  'inferred',
  'hypothesis',
  'owner-confirmed',
  'unknown',
] as const;
type EpistemicLabel = (typeof EPISTEMIC_LABELS)[number];

/**
 * One runtime-authored Protocol v1.4 context claim. A non-`unknown` claim cites a
 * resolvable git revision so the workspace-validated record keeps it; an `unknown`
 * claim carries no citation and is recorded as a gap rather than a blocker.
 */
function contextClaim(
  id: string,
  field: string,
  value: string,
  epistemicStatus: EpistemicLabel,
  head: string,
): Record<string, unknown> {
  return {
    id: `CTX-${id}`,
    field,
    value,
    epistemicStatus,
    confidence: 3,
    citations: epistemicStatus === 'unknown' ? [] : [{ kind: 'git', revision: head }],
  };
}

/**
 * The standard bootstrap research a guided session infers before questioning: one
 * cited, epistemically labelled claim for each surface FR11 enumerates (stage,
 * purpose, pricing surfaces, users, goals, metrics — plus a business-model
 * hypothesis) and one `unknown` gap that must never block the session.
 */
function bootstrapClaims(head: string): Record<string, unknown>[] {
  return [
    contextClaim(
      'purpose',
      'purpose',
      'Turn evidence into cited operating decisions.',
      'observed',
      head,
    ),
    contextClaim('stage', 'stage', 'growth', 'inferred', head),
    contextClaim(
      'pricing',
      'pricing',
      'Subscription tiers on the pricing page.',
      'hypothesis',
      head,
    ),
    contextClaim('users', 'ideal-customer', 'Technical founders.', 'inferred', head),
    contextClaim('goal', 'goal', 'Reach a cited operating brief quickly.', 'observed', head),
    contextClaim('metric', 'metric', 'Time to first brief under five minutes.', 'inferred', head),
    contextClaim('bm', 'business-model', 'Subscription SaaS.', 'hypothesis', head),
    contextClaim('gap', 'metric', 'Current activation baseline is unmeasured.', 'unknown', head),
  ];
}

/**
 * Drive the research-first bootstrap end-to-end: prepare workspace research, then
 * record the runtime-authored claims through the same public actions the runtime
 * uses. Returns the prepared research handoff and the validated review result so a
 * test can assert on both the mandate and the accepted claims.
 */
async function researchWorkspace(
  root: string,
  claims: Record<string, unknown>[],
): Promise<{
  refresh: Awaited<ReturnType<typeof executeOperateAction>>;
  review: Awaited<ReturnType<typeof executeOperateAction>>;
}> {
  const refresh = await executeOperateAction({
    action: 'context.refresh',
    projectRoot: root,
    interactive: false,
    options: { runtime: 'codex', json: true },
  });
  const review = await executeOperateAction({
    action: 'context.review',
    projectRoot: root,
    interactive: false,
    options: { json: true },
    stdin: JSON.stringify(claims),
  });
  return { refresh, review };
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

// FR11 — the research-first, compact initialization anti-regression boundary.
// These lock in that guided init inspects the workspace and consumes epistemically
// labelled research before questioning, treats "find it from the project" as
// continued research rather than a blocker, and presents one compact review — so a
// nearby change cannot quietly regress it into a long deterministic questionnaire.
describe('FR11 research-first, compact initialization', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // DoD #1 — Workspace research runs before the first question is presented.
  it('inspects the workspace and consumes labelled research before any charter question is presented', async () => {
    const projectRoot = await gitProject();
    clearRuntimeMarkers();
    const head = await gitHead(projectRoot);

    // The bootstrap research step precedes questioning: preparing it hands the
    // runtime a mandate that inspects the workspace and a research-BEFORE-asking
    // instruction that requires an epistemic label on every claim.
    const { refresh } = await researchWorkspace(projectRoot, bootstrapClaims(head));
    expect(refresh.ok).toBe(true);
    const prepared = refresh.data as {
      instruction: string;
      mandate: { focus: string[]; outputSchema: string };
    };
    expect(prepared.instruction).toContain('Research before asking');
    expect(prepared.instruction).toContain(
      'observed, inferred, hypothesis, owner-confirmed, or unknown',
    );
    expect(prepared.mandate.focus).toEqual(
      expect.arrayContaining([
        'product-context',
        'architecture',
        'delivery-state',
        'risks',
        'goals',
        'metrics',
      ]),
    );

    // With the foundation authority answers supplied, a session that has already
    // researched presents NONE of the charter questions — research ran first and
    // answered them, so the first surface the owner sees is the review, not a
    // purpose/stage/goals/metrics prompt.
    const init = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: {
        json: true,
        runtime: 'codex',
        decisionOwner: 'Asem',
        preview: true,
      },
    });
    const asked = init.questionnaire?.questions.map((question) => question.questionId) ?? [];
    for (const charterQuestion of [
      'purpose',
      'product-stage',
      'business-model',
      'ideal-customer',
      'goals',
      'success-metrics',
    ]) {
      expect(asked).not.toContain(charterQuestion);
    }
    expect(init.state).toBe('preview-ready');
  });

  // DoD #2 — Every inferred answer carries a citation and an epistemic label.
  it('records a citation and an epistemic label on every inferred answer', async () => {
    const projectRoot = await gitProject();
    clearRuntimeMarkers();
    const head = await gitHead(projectRoot);

    const { review } = await researchWorkspace(projectRoot, bootstrapClaims(head));
    const accepted = (review.data as { claims: Array<Record<string, unknown>> }).claims;
    // The enumerated surfaces are the INFERRED answers; the sidecar may also hold
    // an `unknown` gap on the same field, which DoD #3 covers separately.
    const byField = new Map(
      accepted
        .filter((claim) => claim.epistemicStatus !== 'unknown')
        .map((claim) => [claim.field as string, claim]),
    );

    // The six inference surfaces FR11 enumerates each land as a validated claim
    // carrying at least one citation and one of the exact epistemic labels.
    for (const field of ['stage', 'purpose', 'pricing', 'ideal-customer', 'goal', 'metric']) {
      const claim = byField.get(field);
      expect(claim, `expected an inferred answer for ${field}`).toBeDefined();
      const citations = claim?.citations as unknown[] | undefined;
      expect(citations?.length ?? 0).toBeGreaterThan(0);
      expect(EPISTEMIC_LABELS).toContain(claim?.epistemicStatus as string);
    }

    // The same committed context is readable back with its labels and citations
    // intact — the epistemic status is never dropped on the way to the sidecar.
    const shown = await executeOperateAction({
      action: 'context.show',
      projectRoot,
      interactive: false,
      options: { json: true },
    });
    const persisted = (shown.data as { claims: Array<Record<string, unknown>> }).claims;
    for (const claim of persisted) {
      expect(EPISTEMIC_LABELS).toContain(claim.epistemicStatus as string);
    }

    // And the labelled research flows into the initialization answer set: the
    // inferred purpose/stage/users/goals/metrics become the charter defaults the
    // compact review presents, so the owner is never asked to retype them.
    const seeded = await operatingInitializationAnswersFromResearch(projectRoot);
    expect(seeded?.charter).toMatchObject({
      purpose: 'Turn evidence into cited operating decisions.',
      stage: 'growth',
      idealCustomer: 'Technical founders.',
      businessModel: 'Subscription SaaS.',
      goals: ['Reach a cited operating brief quickly.'],
      successMetrics: ['Time to first brief under five minutes.'],
    });
  });

  // DoD #3 — "Find it from the project" resumes research instead of blocking.
  it('treats "find it from the project" as continued research, not a blocker, and turns unknowns into gaps', async () => {
    const projectRoot = await gitProject();
    clearRuntimeMarkers();
    const head = await gitHead(projectRoot);

    // Foundation authority answers are supplied, so the only thing standing
    // between the owner and the review is the product charter. Before any research
    // exists, the charter question is genuinely required — the session blocks on
    // "purpose" and asks for it.
    const foundation = {
      json: true,
      runtime: 'codex',
      profile: 'saas',
      decisionOwner: 'Asem',
      planningEngine: 'openplanr',
      sensitivityCeiling: 'internal',
    };
    const blocked = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: foundation,
    });
    expect(blocked.code).toBe('E_OPERATE_INPUT_REQUIRED');
    expect(blocked.questionnaire?.stage).toBe('product-charter');
    expect(blocked.questionnaire?.questions.map((question) => question.questionId)).toContain(
      'purpose',
    );

    // "Find it from the project": the owner defers the charter to research instead
    // of typing it. Research runs, and the same init now reaches the write-free
    // review — the deferred answers were found, so nothing blocks.
    await researchWorkspace(projectRoot, bootstrapClaims(head));
    const resumed = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { ...foundation, preview: true },
    });
    expect(resumed.code).not.toBe('E_OPERATE_INPUT_REQUIRED');
    expect(resumed.state).toBe('preview-ready');
    expect(resumed.questionnaire).toBeUndefined();

    // The unknown research surface became a recorded gap, never a blocking
    // question: it is carried as a known unknown, and the session still reached
    // the review.
    const seeded = await operatingInitializationAnswersFromResearch(projectRoot);
    expect(seeded?.charter?.knownUnknowns).toContain('Current activation baseline is unmeasured.');
  });

  // DoD #4 — The full answer set renders as one compact review, not serial prompts.
  it('presents the researched answer set as one compact review rather than serial per-question prompts', async () => {
    const projectRoot = await gitProject();
    clearRuntimeMarkers();
    const head = await gitHead(projectRoot);
    await researchWorkspace(projectRoot, bootstrapClaims(head));

    // Research answered profile, planning engine, sensitivity, and the whole
    // charter, leaving only the one genuine authority question the runtime cannot
    // supply. That single question is presented on its own — not a serial march
    // through every unanswered field.
    const authorityOnly = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true, runtime: 'codex' },
    });
    expect(authorityOnly.code).toBe('E_OPERATE_INPUT_REQUIRED');
    expect(authorityOnly.questionnaire?.questions.map((question) => question.questionId)).toEqual([
      'decision-owner',
    ]);

    // Once the authority answer is present, one invocation renders the entire
    // answer set as a single write-free review carrying the assembled config —
    // one review surface, one apply action, no further questionnaire.
    const compact = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true, runtime: 'codex', decisionOwner: 'Asem', preview: true },
    });
    expect(compact.state).toBe('preview-ready');
    expect(compact.questionnaire).toBeUndefined();
    const preview = compact.preview as { config: Record<string, unknown>; changedPaths: string[] };
    expect(preview).toMatchObject({
      config: { profile: 'saas', decisionOwner: 'Asem', planningEngine: 'openplanr' },
    });
    // The researched charter is materialized once by the single review.
    expect(preview.changedPaths).toContain('.planr/operate/charter.md');
    expect(compact.actions).toHaveLength(1);
  });
});
