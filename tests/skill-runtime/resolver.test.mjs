import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  sha256Hex,
  verifyDocumentDigest,
  withDocumentDigest,
} from '../../packages/protocol/src/canonical-json.mjs';
import { validateProtocolArtifact } from '../../packages/protocol/src/contracts.mjs';
import {
  checkpointSession,
  createSkillSession,
  recoverSession,
} from '../../packages/skill-runtime/src/lifecycle/index.mjs';
import {
  bindInteractionAnswers,
  resolveCapabilities,
  resolveInteraction,
} from '../../packages/skill-runtime/src/resolver/index.mjs';

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const profiles = readJson(
  new URL('../../packages/protocol/registries/skill-host-profiles.json', import.meta.url),
);
const legacyProfiles = readJson(
  new URL(
    '../../packages/skill-runtime/fixtures/resolver/legacy-pipeline-profile-registry.json',
    import.meta.url,
  ),
);
const capabilities = readJson(
  new URL('../../packages/skill-runtime/fixtures/resolver/capability-matrix.json', import.meta.url),
);
const questions = readJson(
  new URL(
    '../../packages/skill-runtime/fixtures/resolver/question-fallbacks.json',
    import.meta.url,
  ),
);
const exactProfile = (id, version) => {
  const matches = profiles.profiles.filter(
    ({ hostProfileId, hostProfileVersion }) =>
      hostProfileId === id && hostProfileVersion === version,
  );
  assert.equal(matches.length, 1, `${id}@${version} must resolve exactly once`);
  return matches[0];
};
const codexProfile = exactProfile('codex-default', '1.0.0');
const cursorProfile = exactProfile('cursor-default', '1.0.0');
const pipelineProfile = exactProfile('pipeline-default', '1.1.0');
const digest = (character) => `sha256:${character.repeat(64)}`;
const session = Object.freeze({
  sessionId: 'GIS-resolver-session-0001',
  questionnaireDigest: digest('a'),
  questionnaireVersion: '1.0.0',
  command: 'planr-plan',
  projectIdentity: digest('b'),
  projectHead: digest('c'),
  configHead: digest('d'),
});

test('Protocol 1.7 publishes a validated, ordered capability profile for every supported host', () => {
  assert.deepEqual(
    profiles.profiles.map(
      ({ hostProfileId, hostProfileVersion }) => `${hostProfileId}@${hostProfileVersion}`,
    ),
    [
      'claude-code-default@1.0.0',
      'codex-default@1.0.0',
      'cursor-default@1.0.0',
      'pipeline-default@1.0.0',
      'pipeline-default@1.1.0',
    ],
  );
  assert.equal(profiles.schemaVersion, '1.1.0');
  assert.equal(profiles.documentVersion, '1.1.0');
  assert.deepEqual(
    validateProtocolArtifact('skill-host-profile-registry', profiles, { protocolVersion: '1.7.0' }),
    [],
  );
  assert.deepEqual(
    codexProfile.interactionBindings.map(({ surface }) => surface),
    ['native', 'chat', 'terminal', 'headless'],
  );
  assert.deepEqual(
    cursorProfile.interactionBindings.map(({ surface }) => surface),
    ['chat', 'terminal', 'headless'],
  );
});

test('legacy pipeline profile bytes remain readable while 1.1.0 adds capabilities distinctly', () => {
  assert.equal(verifyDocumentDigest(legacyProfiles), true);
  assert.deepEqual(
    validateProtocolArtifact('skill-host-profile-registry', legacyProfiles, {
      protocolVersion: '1.6.0',
    }),
    [],
  );
  const legacy = exactProfile('pipeline-default', '1.0.0');
  assert.deepEqual(legacy, legacyProfiles.profiles[0]);
  assert.equal('runtimeCapabilities' in legacy, false);
  assert.equal('interactionBindings' in legacy, false);
  assert.equal(
    `sha256:${sha256Hex(readFileSync(new URL('../../packages/protocol/host-profiles/pipeline.md', import.meta.url)))}`,
    legacy.source.digest,
  );

  assert.equal(pipelineProfile.hostProfileVersion, '1.1.0');
  assert.notEqual(pipelineProfile.source.path, legacy.source.path);
  assert.deepEqual(pipelineProfile.runtimeCapabilities, ['attached-terminal']);
  assert.deepEqual(
    pipelineProfile.interactionBindings.map(({ surface }) => surface),
    ['terminal', 'headless'],
  );

  const widenedLegacy = withDocumentDigest({
    ...legacyProfiles,
    profiles: [{ ...legacyProfiles.profiles[0], runtimeCapabilities: [] }],
  });
  assert.ok(
    validateProtocolArtifact('skill-host-profile-registry', widenedLegacy, {
      protocolVersion: '1.6.0',
    }).length > 0,
    'schemaVersion 1.0.0 must retain the closed legacy profile shape',
  );
});

test('Protocol rejects a host profile that maps a surface to another surface capability', () => {
  const { documentDigest: _documentDigest, ...unsigned } = profiles;
  const forged = structuredClone(unsigned);
  forged.profiles[0].interactionBindings[0].capabilityId = 'attached-terminal';
  const errors = validateProtocolArtifact(
    'skill-host-profile-registry',
    withDocumentDigest(forged),
    { protocolVersion: '1.7.0' },
  );
  assert.ok(errors.length > 0);
});

test('Protocol rejects undeclared binding capabilities, duplicate surfaces, and non-final headless fallbacks', () => {
  const { documentDigest: _documentDigest, ...unsigned } = profiles;
  const mutations = [
    (registry) => {
      registry.profiles[0].runtimeCapabilities = registry.profiles[0].runtimeCapabilities.filter(
        (capabilityId) => capabilityId !== 'native-questions',
      );
    },
    (registry) => {
      registry.profiles[0].interactionBindings = [
        registry.profiles[0].interactionBindings[0],
        registry.profiles[0].interactionBindings[0],
      ];
    },
    (registry) => {
      registry.profiles[0].interactionBindings = [
        registry.profiles[0].interactionBindings.at(-1),
        registry.profiles[0].interactionBindings[0],
      ];
    },
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(unsigned);
    mutate(forged);
    assert.ok(
      validateProtocolArtifact('skill-host-profile-registry', withDocumentDigest(forged), {
        protocolVersion: '1.7.0',
      }).length > 0,
    );
  }
});

test('capability resolution applies the profile ceiling before runtime availability', () => {
  const cursor = cursorProfile;
  const result = resolveCapabilities({
    hostProfile: cursor,
    runtimeCapabilities: {
      'native-questions': { state: 'available', source: 'invented-runtime-claim' },
    },
    required: ['native-questions'],
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.required[0].declared, false);
  assert.match(result.required[0].source, /^host-profile:/u);
  assert.equal(Object.isFrozen(result), true);
});

test('native composer questions bind typed answers to the internal session', () => {
  const resolution = resolveInteraction({
    hostProfile: codexProfile,
    runtimeCapabilities: capabilities['codex-native'],
    questions: [questions.materialChoice],
    session,
  });
  assert.equal(resolution.status, 'completed');
  assert.equal(resolution.phase, 'awaiting-input');
  assert.equal(resolution.surface, 'native');
  assert.equal(resolution.sessionId, session.sessionId);

  const bound = bindInteractionAnswers({
    resolution,
    answers: { 'release-channel': 'stable' },
    submittedAt: '2026-08-31T00:00:00Z',
  });
  assert.equal(bound.status, 'completed');
  assert.equal(bound.sessionId, session.sessionId);
  assert.equal(bound.envelope.adapter.interaction, 'native');
  assert.deepEqual(
    validateProtocolArtifact('guided-answer-envelope', bound.envelope, {
      protocolVersion: '1.2.0',
    }),
    [],
  );
});

test('a recovered lifecycle session carries its question batch through answer binding', () => {
  const created = createSkillSession({
    skillId: 'planr-plan',
    questions: [questions.materialChoice],
    now: '2026-08-31T00:00:00Z',
    createSessionId: () => 'GIS-resolver-lifecycle-0001',
  });
  const checkpoint = checkpointSession({
    session: created,
    context: { repository: 'openplanr', task: 'SPEC-002/T-004' },
    now: '2026-08-31T00:00:01Z',
  });
  const recovered = recoverSession({
    checkpoint: checkpoint.checkpoint,
    skillId: 'planr-plan',
    context: { repository: 'openplanr', task: 'SPEC-002/T-004' },
    questions: [questions.materialChoice],
  });
  const resolution = resolveInteraction({
    hostProfile: codexProfile,
    runtimeCapabilities: capabilities['codex-native'],
    session: recovered.session,
    questionnaire: {
      sessionId: recovered.session.sessionId,
      digest: digest('e'),
      questionnaireVersion: '1.0.0',
      command: 'planr-plan',
      projectIdentity: digest('f'),
      projectHead: digest('1'),
      configHead: digest('2'),
    },
  });

  assert.equal(resolution.phase, 'awaiting-input');
  assert.equal(resolution.sessionId, recovered.session.sessionId);
  assert.deepEqual(resolution.questions, recovered.session.questions);

  const bound = bindInteractionAnswers({
    resolution,
    answers: { 'release-channel': 'stable' },
    submittedAt: '2026-08-31T00:00:02Z',
  });
  assert.equal(bound.status, 'completed');
  assert.equal(bound.envelope.sessionId, recovered.session.sessionId);
  assert.equal(bound.envelope.questionnaireDigest, digest('e'));
  assert.deepEqual(
    validateProtocolArtifact('guided-answer-envelope', bound.envelope, {
      protocolVersion: '1.2.0',
    }),
    [],
  );
});

test('a schema-shaped lifecycle session with a tampered digest-bound field is rejected', () => {
  const created = createSkillSession({
    skillId: 'planr-plan',
    questions: [questions.materialChoice],
    now: '2026-08-31T00:00:00Z',
    createSessionId: () => 'GIS-resolver-lifecycle-0002',
  });
  const tampered = { ...created, skillId: 'planr-ship' };
  assert.throws(
    () =>
      resolveInteraction({
        hostProfile: codexProfile,
        runtimeCapabilities: capabilities['codex-native'],
        session: tampered,
        questionnaire: {
          digest: digest('e'),
          questionnaireVersion: '1.0.0',
          command: 'planr-plan',
          projectIdentity: digest('f'),
          projectHead: digest('1'),
          configHead: digest('2'),
        },
      }),
    (error) =>
      error.code === 'E_SKILL_INTERACTION_SESSION_INVALID' && error.details.digestValid === false,
  );
});

test('interaction resolution falls back deterministically to chat and then terminal', () => {
  const codex = codexProfile;
  const chat = resolveInteraction({
    hostProfile: codex,
    runtimeCapabilities: capabilities['codex-chat-fallback'],
    questions: [questions.materialChoice],
    session,
  });
  assert.equal(chat.surface, 'chat');
  assert.deepEqual(
    chat.attempts.map(({ surface, status }) => [surface, status]),
    [
      ['native', 'unavailable'],
      ['chat', 'completed'],
    ],
  );

  const terminal = resolveInteraction({
    hostProfile: codex,
    runtimeCapabilities: capabilities['codex-terminal-fallback'],
    questions: [questions.materialChoice],
    session,
  });
  assert.equal(terminal.surface, 'terminal');
  assert.deepEqual(
    terminal.attempts.map(({ surface }) => surface),
    ['native', 'chat', 'terminal'],
  );
});

test('Claude Code, Cursor, and pipeline profiles select only their verified host surfaces', () => {
  const journeys = [
    ['claude-code-default', '1.0.0', 'claude-native', 'native'],
    ['cursor-default', '1.0.0', 'cursor-chat', 'chat'],
    ['pipeline-default', '1.1.0', 'pipeline-terminal', 'terminal'],
  ];
  for (const [profileId, profileVersion, capabilityFixture, expectedSurface] of journeys) {
    const result = resolveInteraction({
      hostProfile: exactProfile(profileId, profileVersion),
      runtimeCapabilities: capabilities[capabilityFixture],
      questions: [questions.materialChoice],
      session,
    });
    assert.equal(result.status, 'completed', `${profileId}@${profileVersion}`);
    assert.equal(result.surface, expectedSurface, `${profileId}@${profileVersion}`);
    assert.equal(result.attempts.at(-1).surface, expectedSurface, `${profileId}@${profileVersion}`);
    assert.equal(result.attempts.at(-1).status, 'completed', `${profileId}@${profileVersion}`);
  }
});

test('headless mode uses a declared safe default and blocks a required material answer', () => {
  const codex = codexProfile;
  const completed = resolveInteraction({
    hostProfile: codex,
    runtimeCapabilities: capabilities['codex-headless'],
    questions: [questions.safeDefault],
    session,
    headlessQuestionPolicy: {
      'include-drafts': { materiality: 'non-material', defaultSafety: 'safe' },
    },
  });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.phase, 'answered');
  assert.equal(completed.surface, 'headless');
  assert.equal(completed.answers[0].value, false);

  const blocked = resolveInteraction({
    hostProfile: codex,
    runtimeCapabilities: capabilities['codex-headless'],
    questions: [questions.materialChoice],
    session,
  });
  assert.equal(blocked.status, 'blocked');
  assert.deepEqual(blocked.unresolvedRequired, ['release-channel']);
  assert.equal(blocked.answers.length, 0);
});

test('headless execution never applies an undeclared or material production default', () => {
  const productionDeploy = {
    ...questions.safeDefault,
    questionId: 'deploy-production',
    label: 'Deploy to production?',
    explanation: 'This would trigger a production deployment.',
    defaultValue: true,
    defaultReason: 'The stored project preference is production.',
  };
  const undeclared = resolveInteraction({
    hostProfile: codexProfile,
    runtimeCapabilities: capabilities['codex-headless'],
    questions: [productionDeploy],
    session,
  });
  assert.equal(undeclared.status, 'blocked');
  assert.deepEqual(undeclared.unresolvedRequired, ['deploy-production']);

  const material = resolveInteraction({
    hostProfile: codexProfile,
    runtimeCapabilities: capabilities['codex-headless'],
    questions: [productionDeploy],
    session,
    headlessQuestionPolicy: {
      'deploy-production': { materiality: 'material', defaultSafety: 'unsafe' },
    },
  });
  assert.equal(material.status, 'blocked');
  assert.deepEqual(material.unresolvedRequired, ['deploy-production']);
  assert.equal(material.answers.length, 0);
});

test('exact repository context skips the question and reports its source', () => {
  const unclassified = resolveInteraction({
    hostProfile: codexProfile,
    runtimeCapabilities: capabilities['codex-headless'],
    questions: [questions.repositoryName],
    repositoryContext: {
      'project-name': { value: 'openplanr', source: 'package.json#/name', confidence: 'exact' },
    },
    session,
  });
  assert.equal(unclassified.status, 'blocked');

  const result = resolveInteraction({
    hostProfile: codexProfile,
    runtimeCapabilities: capabilities['codex-headless'],
    questions: [questions.repositoryName],
    repositoryContext: {
      'project-name': {
        value: 'openplanr',
        source: 'package.json#/name',
        confidence: 'exact',
        safe: true,
      },
    },
    session,
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.phase, 'answered');
  assert.deepEqual(result.inference, [
    { questionId: 'project-name', source: 'package.json#/name' },
  ]);
});

test('visibleWhen excludes inactive questions and requires only the active branch', () => {
  const previewReason = {
    ...questions.repositoryName,
    questionId: 'preview-reason',
    label: 'Why should this use preview?',
    visibleWhen: [{ questionId: 'release-channel', operator: 'equals', value: 'preview' }],
  };
  const inferredStable = resolveInteraction({
    hostProfile: codexProfile,
    runtimeCapabilities: capabilities['codex-headless'],
    questions: [questions.materialChoice, previewReason],
    repositoryContext: {
      'release-channel': {
        value: 'stable',
        source: 'release.json#/channel',
        confidence: 'exact',
        safe: true,
      },
    },
    session,
  });
  assert.equal(inferredStable.status, 'completed');
  assert.deepEqual(
    inferredStable.answers.map(({ questionId }) => questionId),
    ['release-channel'],
  );

  const pending = resolveInteraction({
    hostProfile: codexProfile,
    runtimeCapabilities: capabilities['codex-native'],
    questions: [questions.materialChoice, previewReason],
    session,
  });
  assert.deepEqual(
    pending.questions.map(({ questionId }) => questionId),
    ['release-channel', 'preview-reason'],
  );

  const headlessPending = resolveInteraction({
    hostProfile: codexProfile,
    runtimeCapabilities: capabilities['codex-headless'],
    questions: [questions.materialChoice, previewReason],
    session,
  });
  assert.equal(headlessPending.status, 'blocked');
  assert.deepEqual(
    headlessPending.questions.map(({ questionId }) => questionId),
    ['release-channel'],
  );
  assert.deepEqual(headlessPending.unresolvedRequired, ['release-channel']);

  const stable = bindInteractionAnswers({
    resolution: pending,
    answers: { 'release-channel': 'stable' },
    submittedAt: '2026-08-31T00:00:00Z',
  });
  assert.equal(stable.status, 'completed');
  assert.deepEqual(
    stable.answers.map(({ questionId }) => questionId),
    ['release-channel'],
  );

  const inferredConditional = resolveInteraction({
    hostProfile: codexProfile,
    runtimeCapabilities: capabilities['codex-native'],
    questions: [questions.materialChoice, previewReason],
    repositoryContext: {
      'preview-reason': {
        value: 'Early feedback.',
        source: 'release.json#/reason',
        confidence: 'exact',
        safe: true,
      },
    },
    session,
  });
  const stableWithHiddenInference = bindInteractionAnswers({
    resolution: inferredConditional,
    answers: { 'release-channel': 'stable' },
    submittedAt: '2026-08-31T00:00:00Z',
  });
  assert.equal(stableWithHiddenInference.status, 'completed');
  assert.deepEqual(
    stableWithHiddenInference.answers.map(({ questionId }) => questionId),
    ['release-channel'],
  );

  const previewMissingReason = bindInteractionAnswers({
    resolution: pending,
    answers: { 'release-channel': 'preview' },
  });
  assert.equal(previewMissingReason.status, 'blocked');
  assert.deepEqual(previewMissingReason.missing, ['preview-reason']);

  const draftReason = {
    ...questions.repositoryName,
    questionId: 'draft-reason',
    label: 'Why should drafts be included?',
    visibleWhen: [{ questionId: 'include-drafts', operator: 'equals', value: false }],
  };
  const reverseOrdered = resolveInteraction({
    hostProfile: codexProfile,
    runtimeCapabilities: capabilities['codex-headless'],
    questions: [draftReason, questions.safeDefault],
    session,
    headlessQuestionPolicy: {
      'include-drafts': { materiality: 'non-material', defaultSafety: 'safe' },
    },
  });
  assert.equal(reverseOrdered.status, 'blocked');
  assert.deepEqual(reverseOrdered.unresolvedRequired, ['draft-reason']);
  assert.deepEqual(
    reverseOrdered.answers.map(({ questionId }) => questionId),
    ['include-drafts'],
  );

  const hiddenDraftReason = {
    ...draftReason,
    visibleWhen: [{ questionId: 'include-drafts', operator: 'equals', value: true }],
  };
  const inferredHiddenBranch = resolveInteraction({
    hostProfile: codexProfile,
    runtimeCapabilities: capabilities['codex-headless'],
    questions: [hiddenDraftReason, questions.safeDefault],
    repositoryContext: {
      'draft-reason': {
        value: 'For early review.',
        source: 'release.json#/draftReason',
        confidence: 'exact',
        safe: true,
      },
    },
    session,
    headlessQuestionPolicy: {
      'include-drafts': { materiality: 'non-material', defaultSafety: 'safe' },
    },
  });
  assert.equal(inferredHiddenBranch.status, 'completed');
  assert.deepEqual(
    inferredHiddenBranch.answers.map(({ questionId }) => questionId),
    ['include-drafts'],
  );
  assert.deepEqual(inferredHiddenBranch.inferredAnswers, []);
});

test('an informational-only batch completes without selecting or fabricating an input surface', () => {
  const { validation: _validation, ...informationBase } = questions.repositoryName;
  const information = {
    ...informationBase,
    questionId: 'runtime-note',
    type: 'informational',
    label: 'Runtime note',
    explanation: 'This host will use its local project context.',
    required: false,
    persistence: 'none',
    valueSemantics: 'none',
  };
  const result = resolveInteraction({
    hostProfile: codexProfile,
    runtimeCapabilities: capabilities['codex-headless'],
    questions: [information],
    session,
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.phase, 'answered');
  assert.equal(result.surface, 'headless');
  assert.deepEqual(result.answers, []);
  assert.deepEqual(result.questions, []);
  assert.deepEqual(result.informational, [information]);
  assert.deepEqual(result.attempts, []);
  assert.equal(result.diagnostic.code, 'I_SKILL_INFORMATION_PRESENTED');
});

test('denied capability and cancellation return typed outcomes without fabricated execution', () => {
  const codex = codexProfile;
  const interactiveOnly = {
    ...codex,
    interactionBindings: codex.interactionBindings.filter(({ surface }) => surface !== 'headless'),
  };
  const denied = resolveInteraction({
    hostProfile: interactiveOnly,
    runtimeCapabilities: capabilities['codex-denied'],
    questions: [questions.materialChoice],
    session,
  });
  assert.equal(denied.status, 'denied');
  assert.equal(denied.surface, null);
  assert.equal(denied.answers.length, 0);

  const pending = resolveInteraction({
    hostProfile: codex,
    runtimeCapabilities: capabilities['codex-native'],
    questions: [questions.materialChoice],
    session,
  });
  const cancelled = bindInteractionAnswers({ resolution: pending, cancelled: true });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal('envelope' in cancelled, false);
});

test('stale answer IDs return a repairable typed result instead of throwing', () => {
  const resolution = resolveInteraction({
    hostProfile: codexProfile,
    runtimeCapabilities: capabilities['codex-native'],
    questions: [questions.materialChoice],
    session,
  });
  const stale = bindInteractionAnswers({
    resolution,
    answers: { 'retired-release-channel': 'stable' },
  });

  assert.equal(stale.status, 'blocked');
  assert.equal(stale.phase, 'unanswered');
  assert.deepEqual(stale.unknown, ['retired-release-channel']);
  assert.equal(stale.diagnostic.code, 'E_SKILL_INTERACTION_ANSWER_STALE');
  assert.match(stale.diagnostic.repair, /Refresh the question surface/u);
  assert.equal('envelope' in stale, false);
});

test('interaction batches stay bounded to three validated Protocol questions', () => {
  assert.throws(
    () =>
      resolveInteraction({
        hostProfile: codexProfile,
        runtimeCapabilities: capabilities['codex-native'],
        questions: [
          questions.repositoryName,
          questions.safeDefault,
          questions.materialChoice,
          questions.repositoryName,
        ],
        session,
      }),
    /one to three guided questions/u,
  );
});

test('host interaction bindings cannot swap capabilities between surfaces', () => {
  const codex = codexProfile;
  const hostileBindings = [
    { surface: 'native', protocolInteraction: 'native', capabilityId: 'attached-terminal' },
    { surface: 'chat', protocolInteraction: 'chat', capabilityId: 'native-questions' },
    { surface: 'terminal', protocolInteraction: 'terminal', capabilityId: 'structured-chat' },
    { surface: 'headless', protocolInteraction: 'none', capabilityId: 'attached-terminal' },
  ];

  for (const binding of hostileBindings) {
    const hostile = { ...codex, interactionBindings: [binding] };
    assert.throws(
      () =>
        resolveInteraction({
          hostProfile: hostile,
          runtimeCapabilities: capabilities['codex-native'],
          questions: [questions.materialChoice],
          session,
        }),
      (error) =>
        error.code === 'E_SKILL_INTERACTION_BINDINGS_INVALID' &&
        /invalid or duplicate interaction binding/u.test(error.message),
    );
  }
});

test('runtime binding validation enforces declared capabilities, unique surfaces, and final headless fallback', () => {
  const hostileProfiles = [
    {
      ...codexProfile,
      runtimeCapabilities: codexProfile.runtimeCapabilities.filter(
        (capabilityId) => capabilityId !== 'native-questions',
      ),
    },
    {
      ...codexProfile,
      interactionBindings: [
        codexProfile.interactionBindings[0],
        codexProfile.interactionBindings[0],
      ],
    },
    {
      ...codexProfile,
      interactionBindings: [
        codexProfile.interactionBindings.at(-1),
        codexProfile.interactionBindings[0],
      ],
    },
  ];
  for (const hostileProfile of hostileProfiles) {
    assert.throws(
      () =>
        resolveInteraction({
          hostProfile: hostileProfile,
          runtimeCapabilities: capabilities['codex-native'],
          questions: [questions.materialChoice],
          session,
        }),
      (error) => error.code === 'E_SKILL_INTERACTION_BINDINGS_INVALID',
    );
  }
});
