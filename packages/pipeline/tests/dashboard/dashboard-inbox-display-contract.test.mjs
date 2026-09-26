import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  selectOperateExperienceDisplaySurface,
  selectOperateInboxItemDisplaySurface,
} from '../../lib/dashboard/operate-experience-reader.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

import {
  assertOperateExperienceDisplaySurfaceV1,
  assertOperateExperiencePreviewV1,
  validateOperateExperienceDisplaySurfaceV1,
  validateOperateExperiencePreviewV1,
} from '../../schemas/v1.2.0/operate-experience-display-surface.mjs';
import { collectFilePaths } from '../helpers/files.mjs';
import { pairedOpenPlanrTools } from '../helpers/paired-openplanr.mjs';
import { resolveWorkspaceDependencyRoot } from '../helpers/workspace-dependency.mjs';
import { rehashExperienceView } from './experience-view-test-support.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const { vite } = pairedOpenPlanrTools();
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;
const HASH_D = `sha256:${'d'.repeat(64)}`;
const projectId = HASH_B;
const generation = 17;
const cycleId = 'cyc_00000001';

const fixture = JSON.parse(
  readFileSync(
    join(root, 'conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json'),
    'utf8',
  ),
)['operate-experience-view'];

function reviewAction({
  reviewId = 'rev_00000001',
  decisionId = 'dec_00000001',
  label = 'Approve the exact reviewed Decision',
} = {}) {
  return {
    tool: 'operate.review.submit',
    arguments: {
      reviewId,
      cycleId,
      actor: {
        actorId: fixture.actorId,
        kind: 'human',
        runtime: 'openplanr',
      },
      scope: {
        scopeId: fixture.scopeId,
        domainId: fixture.domainId,
        domainVersion: fixture.domainVersion,
      },
      disposition: 'approved',
      workDispositions: [
        {
          entityType: 'operating-decision',
          entityId: decisionId,
          disposition: 'approved',
        },
      ],
    },
    label,
    effect: 'project-write',
  };
}

function party({
  partyId = 'party-owner',
  actorId = fixture.actorId,
  state = 'required',
  redacted = false,
} = {}) {
  return {
    partyId,
    actorKind: 'human',
    actorId,
    requiredCapability: { id: 'operate-review', version: '1.0.0' },
    state,
    redacted,
  };
}

function actionableDecision({
  decisionId = 'dec_00000001',
  reviewId = 'rev_00000001',
  action = reviewAction({ reviewId, decisionId }),
  title = 'Approve the exact Decision',
} = {}) {
  return {
    item: {
      itemId: `decision:${decisionId}`,
      kind: 'decision',
      subjectId: decisionId,
      ownerActorId: fixture.actorId,
      state: 'proposed',
      title,
      consequence: 'The operating Cycle remains blocked until this review is resolved.',
      expiresAt: '2026-08-12T08:00:00Z',
      blocking: true,
      evidence: [],
      requiredParties: [party()],
      redactions: [],
      actionLocator: {
        subjectId: reviewId,
        actionDigest: sha256Jcs(action),
      },
      navigationLocator: null,
      unavailableReason: null,
    },
    boundAction: { subjectId: reviewId, action },
  };
}

function unavailableApproval() {
  return {
    itemId: 'approval:aprq_00000001',
    kind: 'approval',
    subjectId: 'act_00000001',
    ownerActorId: fixture.actorId,
    state: 'waiting',
    title: 'Approval requires another named party',
    consequence: 'The exact governed Action remains blocked.',
    expiresAt: '2026-08-12T08:00:00Z',
    blocking: true,
    evidence: [],
    requiredParties: [
      party({
        partyId: 'party-restricted',
        actorId: null,
        state: 'redacted',
        redacted: true,
      }),
    ],
    redactions: [{ classification: 'confidential', count: 1, reason: 'identity-redacted' }],
    actionLocator: null,
    navigationLocator: null,
    unavailableReason: {
      code: 'OPERATE_APPROVAL_PARTY_UNAVAILABLE',
      message: 'This actor is not an eligible remaining approval party.',
    },
  };
}

function unavailableVerification() {
  return {
    itemId: 'verification:asg_00000001',
    kind: 'verification',
    subjectId: 'asg_00000001',
    ownerActorId: fixture.actorId,
    state: 'available',
    title: 'Verification evidence is required',
    consequence: 'The expected outcome remains unverified.',
    expiresAt: null,
    blocking: false,
    evidence: [],
    requiredParties: [],
    redactions: [],
    actionLocator: null,
    navigationLocator: null,
    unavailableReason: {
      code: 'OPERATE_VERIFICATION_SUBMISSION_UNAVAILABLE',
      message: 'No exact owner-issued verification submission is available.',
    },
  };
}

function canonicalView({ twoDecisions = false, unicode = false } = {}) {
  const first = actionableDecision({
    title: unicode ? 'Review café Δ — safely 🚀' : undefined,
  });
  const second = actionableDecision({
    decisionId: 'dec_00000002',
    reviewId: 'rev_00000002',
  });
  const view = structuredClone(fixture);
  view.inbox = (
    twoDecisions
      ? [first.item, second.item, unavailableApproval(), unavailableVerification()]
      : [first.item, unavailableApproval(), unavailableVerification()]
  ).sort(
    (left, right) =>
      Number(right.blocking) - Number(left.blocking) || left.itemId.localeCompare(right.itemId),
  );
  view.allowedActions = twoDecisions
    ? [first.boundAction, second.boundAction]
    : [first.boundAction];
  delete view.viewHash;
  view.viewHash = sha256Jcs(view);
  return view;
}

function itemBySubject(inbox, subjectId) {
  const item = inbox.find((candidate) => candidate.subjectId === subjectId);
  assert.ok(item, `missing Inbox subject ${subjectId}`);
  return item;
}

function displayBinding(view, overrides = {}) {
  return {
    actorId: view.actorId,
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    generatedAt: view.generatedAt,
    eventHead: structuredClone(view.eventHead),
    viewHash: view.viewHash,
    surface: 'inbox',
    projectId,
    generation,
    subjectId: null,
    ...overrides,
  };
}

function selectInbox(view = canonicalView(), overrides = {}) {
  const binding = displayBinding(view, overrides);
  return {
    binding,
    display: selectOperateExperienceDisplaySurface(view, {
      surface: 'inbox',
      binding,
      subjectId: binding.subjectId,
    }),
  };
}

function rehashView(view) {
  return rehashExperienceView(view);
}

function previewBinding(preview, overrides = {}) {
  return {
    actorId: preview.actorId,
    scopeId: preview.scopeId,
    domainId: preview.domainId,
    domainVersion: preview.domainVersion,
    eventHead: structuredClone(preview.eventHead),
    viewHash: preview.sourceViewHash,
    sourceViewHash: preview.sourceViewHash,
    subjectId: preview.subject.id,
    actionDigest: preview.actionDigest,
    ...overrides,
  };
}

function reviewPreview(view = canonicalView()) {
  const allowedAction = structuredClone(view.allowedActions[0].action);
  const base = {
    kind: 'operate-experience-preview',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    previewId: 'xprv_00000001',
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    actorId: view.actorId,
    subject: {
      kind: 'review',
      id: view.allowedActions[0].subjectId,
      revision: null,
      hash: HASH_C,
    },
    eventHead: structuredClone(view.eventHead),
    sourceViewHash: view.viewHash,
    actionDigest: sha256Jcs(allowedAction),
    allowedAction,
    authority: 'allowed',
    consequence: 'Project change: approve the exact Decision review.',
    reasonCodes: [],
    transition: {
      kind: 'review',
      targets: [
        {
          kind: 'operating-decision',
          id: 'dec_00000001',
          revision: 1,
          hash: HASH_D,
          disposition: 'approved',
        },
      ],
      reversible: false,
      nextState: 'approved',
      threshold: null,
    },
    issuedAt: '2026-08-11T08:00:00Z',
    expiresAt: '2026-08-11T08:02:00Z',
  };
  return { ...base, previewHash: sha256Jcs(base) };
}

function approvalPreview({ satisfied }) {
  const view = canonicalView();
  const allowedAction = {
    tool: 'operate.action.approve',
    arguments: {
      action: {
        actionId: 'act_00000001',
        revision: 1,
        actionHash: HASH_A,
      },
      decision: 'approved',
    },
    label: 'Record the exact Action approval',
    effect: 'project-write',
  };
  const recorded = satisfied ? 2 : 1;
  const base = {
    kind: 'operate-experience-preview',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    previewId: satisfied ? 'xprv_threshold_satisfied' : 'xprv_parties_remain',
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    actorId: view.actorId,
    subject: {
      kind: 'action',
      id: 'act_00000001',
      revision: 1,
      hash: HASH_A,
    },
    eventHead: structuredClone(view.eventHead),
    sourceViewHash: view.viewHash,
    actionDigest: sha256Jcs(allowedAction),
    allowedAction,
    authority: 'allowed',
    consequence: 'Record this exact approval without executing the Action.',
    reasonCodes: [],
    transition: {
      kind: 'approval',
      targets: [
        {
          kind: 'operating-action',
          id: 'act_00000001',
          revision: 1,
          hash: HASH_A,
          disposition: 'approved',
        },
      ],
      reversible: false,
      nextState: satisfied ? 'threshold-satisfied' : 'recorded-parties-remain',
      threshold: {
        required: 2,
        recorded,
        remaining: 2 - recorded,
        parties: [
          party({ state: 'recorded' }),
          party({
            partyId: 'party-restricted',
            actorId: null,
            state: satisfied ? 'recorded' : 'redacted',
            redacted: true,
          }),
        ],
      },
    },
    issuedAt: '2026-08-11T08:00:00Z',
    expiresAt: '2026-08-11T08:02:00Z',
  };
  return { ...base, previewHash: sha256Jcs(base) };
}

function assertDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function packInstalledConsumer(temporaryRoot) {
  const packed = run(
    'npm',
    [
      'pack',
      '--ignore-scripts',
      '--json',
      '--cache',
      join(temporaryRoot, 'npm-cache'),
      '--pack-destination',
      temporaryRoot,
    ],
    { cwd: root },
  );
  const [{ filename }] = JSON.parse(packed.stdout);
  const consumer = join(temporaryRoot, 'consumer');
  const installedPackage = join(consumer, 'node_modules', 'planr-pipeline');
  mkdirSync(installedPackage, { recursive: true });
  run('tar', [
    '-xzf',
    join(temporaryRoot, filename),
    '-C',
    installedPackage,
    '--strip-components=1',
  ]);
  mkdirSync(join(consumer, 'node_modules', '@noble'), { recursive: true });
  cpSync(
    resolveWorkspaceDependencyRoot('@noble/hashes'),
    join(consumer, 'node_modules', '@noble', 'hashes'),
    { recursive: true },
  );
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ type: 'module' }));
  return { consumer, installedPackage };
}

test('owner issues one standalone exact-bound Inbox display without Today or full-view fallback', () => {
  const view = canonicalView({ unicode: true });
  const { display, binding } = selectInbox(view);
  assert.equal(display.kind, 'operate-experience-display-surface');
  assert.equal(display.payload.surface, 'inbox');
  assert.deepEqual(Object.keys(display.payload.data).sort(), ['inbox', 'requestBinding']);
  assert.deepEqual(display.payload.data.inbox, view.inbox);
  assert.deepEqual([...new Set(display.payload.data.inbox.map(({ kind }) => kind))].sort(), [
    'approval',
    'decision',
    'verification',
  ]);
  assert.deepEqual(display.payload.data.requestBinding, {
    projectId,
    generation,
    subjectId: null,
  });
  assert.equal(display.integrity.sourceViewHash, view.viewHash);
  const decision = itemBySubject(display.payload.data.inbox, 'dec_00000001');
  assert.equal(decision.title, 'Review café Δ — safely 🚀');
  assert.equal(decision.actionLocator.actionDigest, sha256Jcs(view.allowedActions[0].action));
  assert.equal(JSON.stringify(display).includes('allowedActions'), false);
  assert.equal(JSON.stringify(display).includes('workDispositions'), false);
  assert.equal(JSON.stringify(display).includes('party-restricted'), true);
  assert.equal(JSON.stringify(display).includes('restricted-actor-private'), false);
  assert.equal(assertOperateExperienceDisplaySurfaceV1(display, binding), display);
  assert.deepEqual(validateOperateExperienceDisplaySurfaceV1(display, binding), []);
  assertDeepFrozen(display);

  const todayBinding = { ...binding, surface: 'today' };
  delete todayBinding.projectId;
  delete todayBinding.generation;
  const today = selectOperateExperienceDisplaySurface(view, {
    surface: 'today',
    binding: todayBinding,
  });
  assert.throws(() => assertOperateExperienceDisplaySurfaceV1(today, binding));
  assert.throws(() => assertOperateExperienceDisplaySurfaceV1(view, binding));
});

test('owner selects one exact subject-bound Inbox item without exposing its siblings', () => {
  const view = canonicalView({ twoDecisions: true });
  const subjectId = 'verification:asg_00000001';
  const binding = displayBinding(view, { subjectId });
  const display = selectOperateInboxItemDisplaySurface(view, { binding, subjectId });
  assert.equal(display.kind, 'operate-experience-display-surface');
  assert.equal(display.payload.surface, 'inbox');
  assert.deepEqual(display.payload.data.inbox, [
    view.inbox.find((item) => item.itemId === subjectId),
  ]);
  assert.deepEqual(display.payload.data.requestBinding, {
    projectId,
    generation,
    subjectId,
  });
  assert.equal(assertOperateExperienceDisplaySurfaceV1(display, binding), display);

  for (const hostileSubjectId of [null, '', 'verification:asg_foreign_0001']) {
    const refused = selectOperateInboxItemDisplaySurface(view, {
      binding: displayBinding(view, { subjectId: hostileSubjectId }),
      subjectId: hostileSubjectId,
    });
    assert.equal(refused.ok, false);
    assert.equal(
      refused.error.reasonCode,
      hostileSubjectId === null || hostileSubjectId === ''
        ? 'OPERATE_SUBJECT_REQUIRED'
        : 'OPERATE_SUBJECT_NOT_FOUND',
    );
  }

  const substitutedBinding = displayBinding(view, {
    subjectId: 'approval:aprq_00000001',
  });
  const substituted = selectOperateInboxItemDisplaySurface(view, {
    binding: substitutedBinding,
    subjectId,
  });
  assert.equal(substituted.ok, false);
  assert.equal(substituted.error.reasonCode, 'OPERATE_BINDING_MISMATCH');
});

test('Inbox assertion rejects every binding, generation, order, evidence, locator, and XOR substitution', () => {
  const view = canonicalView({ twoDecisions: true });
  const { display, binding } = selectInbox(view);
  for (const hostile of [
    { actorId: 'owner-foreign' },
    { scopeId: 'scope-foreign' },
    { domainId: 'software' },
    { domainVersion: '9.9.9' },
    { generatedAt: '2026-08-11T08:00:01Z' },
    { eventHead: { sequence: 2, hash: HASH_B } },
    { viewHash: HASH_B },
    { surface: 'today' },
    { projectId: 'foreign-project' },
    { generation: generation + 1 },
    { subjectId: 'verification:asg_00000001' },
  ]) {
    assert.throws(() =>
      assertOperateExperienceDisplaySurfaceV1(display, {
        ...binding,
        ...hostile,
      }),
    );
  }
  for (const field of [
    'actorId',
    'projectId',
    'scopeId',
    'domainId',
    'domainVersion',
    'generation',
    'subjectId',
    'eventHead',
    'viewHash',
    'surface',
  ]) {
    const missing = { ...binding };
    delete missing[field];
    assert.throws(() => assertOperateExperienceDisplaySurfaceV1(display, missing), field);
  }

  const mutations = [
    (candidate) => candidate.inbox.reverse(),
    (candidate) => {
      const first = itemBySubject(candidate.inbox, 'dec_00000001');
      const second = itemBySubject(candidate.inbox, 'dec_00000002');
      const firstDigest = first.actionLocator.actionDigest;
      first.actionLocator.actionDigest = second.actionLocator.actionDigest;
      second.actionLocator.actionDigest = firstDigest;
    },
    (candidate) => {
      const item = itemBySubject(candidate.inbox, 'dec_00000001');
      item.actionLocator.subjectId = item.subjectId;
    },
    (candidate) => {
      itemBySubject(candidate.inbox, 'dec_00000001').evidence.push({
        evidenceRefId: 'evr_foreign0001',
        classification: 'public',
        accessState: 'available',
        relation: 'support',
      });
    },
    (candidate) => {
      itemBySubject(candidate.inbox, 'act_00000001').requiredParties[0].actorId =
        'restricted-actor-private';
    },
    (candidate) => {
      itemBySubject(candidate.inbox, 'dec_00000001').unavailableReason = {
        code: 'OPERATE_ACTION_UNAVAILABLE',
        message: 'Conflicting reason.',
      };
    },
    (candidate) => {
      itemBySubject(candidate.inbox, 'dec_00000001').actionLocator = null;
    },
    (candidate) => {
      itemBySubject(candidate.inbox, 'act_00000001').actionLocator = structuredClone(
        itemBySubject(candidate.inbox, 'dec_00000001').actionLocator,
      );
    },
    (candidate) => {
      itemBySubject(candidate.inbox, 'act_00000001').unavailableReason = null;
    },
  ];
  for (const mutate of mutations) {
    const hostile = structuredClone(display);
    mutate(hostile.payload.data);
    assert.throws(() => assertOperateExperienceDisplaySurfaceV1(hostile, binding));
  }

  const wrongTool = structuredClone(view);
  wrongTool.allowedActions[0] = {
    subjectId: 'cycle-foreign',
    action: {
      tool: 'operate.cycle.get',
      arguments: { cycleId: 'cycle-foreign' },
      label: 'Colliding label that must not establish Review custody',
      effect: 'read-only',
    },
  };
  itemBySubject(wrongTool.inbox, 'dec_00000001').actionLocator = {
    subjectId: 'cycle-foreign',
    actionDigest: sha256Jcs(wrongTool.allowedActions[0].action),
  };
  rehashView(wrongTool);
  const refused = selectInbox(wrongTool).display;
  assert.equal(refused.ok, false);
  assert.equal(JSON.stringify(refused).includes('workDispositions'), false);
});

test('browser-safe preview assertion binds action digest and hash-covers every transition claim', () => {
  const preview = reviewPreview();
  const expected = previewBinding(preview);
  const verified = assertOperateExperiencePreviewV1(preview, expected);
  assert.deepEqual(verified, preview);
  assert.notEqual(verified, preview);
  assertDeepFrozen(verified);
  assert.deepEqual(validateOperateExperiencePreviewV1(preview, expected), []);
  assert.equal(preview.actionDigest, sha256Jcs(preview.allowedAction));
  assert.equal(preview.sourceViewHash, expected.viewHash);
  assert.equal(JSON.stringify(preview.transition).includes('executed'), false);

  const transitionMutations = [
    (candidate) => {
      candidate.transition.targets[0].kind = 'operating-action';
    },
    (candidate) => {
      candidate.transition.targets[0].id = 'dec_00000002';
    },
    (candidate) => {
      candidate.transition.targets[0].revision = 2;
    },
    (candidate) => {
      candidate.transition.targets[0].hash = HASH_B;
    },
    (candidate) => {
      candidate.transition.targets[0].disposition = 'rejected';
    },
    (candidate) => {
      candidate.transition.reversible = true;
    },
    (candidate) => {
      candidate.transition.nextState = 'rejected';
    },
  ];
  for (const mutate of transitionMutations) {
    const hostile = structuredClone(preview);
    mutate(hostile);
    assert.throws(() => assertOperateExperiencePreviewV1(hostile, expected));
  }

  const digestSubstitution = structuredClone(preview);
  digestSubstitution.actionDigest = HASH_B;
  delete digestSubstitution.previewHash;
  digestSubstitution.previewHash = sha256Jcs(digestSubstitution);
  assert.throws(() =>
    assertOperateExperiencePreviewV1(digestSubstitution, previewBinding(digestSubstitution)),
  );

  for (const hostileExpected of [
    { actorId: 'owner-foreign' },
    { eventHead: { sequence: 2, hash: HASH_B } },
    { sourceViewHash: HASH_B, viewHash: HASH_B },
    { subjectId: 'rev_00000002' },
    { actionDigest: HASH_B },
  ]) {
    assert.throws(() =>
      assertOperateExperiencePreviewV1(preview, {
        ...expected,
        ...hostileExpected,
      }),
    );
  }
});

test('approval preview distinguishes recorded parties remaining from threshold satisfied without claiming execution', () => {
  const partiesRemain = approvalPreview({ satisfied: false });
  const thresholdSatisfied = approvalPreview({ satisfied: true });
  for (const preview of [partiesRemain, thresholdSatisfied]) {
    assert.deepEqual(assertOperateExperiencePreviewV1(preview, previewBinding(preview)), preview);
    assert.equal(preview.transition.threshold.required, 2);
    assert.equal(
      preview.transition.threshold.remaining,
      preview.transition.threshold.required - preview.transition.threshold.recorded,
    );
    assert.equal(JSON.stringify(preview).includes('restricted-actor-private'), false);
    assert.equal(JSON.stringify(preview.transition).includes('executed'), false);
  }
  assert.equal(partiesRemain.transition.nextState, 'recorded-parties-remain');
  assert.equal(partiesRemain.transition.threshold.remaining, 1);
  assert.equal(thresholdSatisfied.transition.nextState, 'threshold-satisfied');
  assert.equal(thresholdSatisfied.transition.threshold.remaining, 0);

  const hostile = structuredClone(partiesRemain);
  hostile.transition.threshold.remaining = 0;
  delete hostile.previewHash;
  hostile.previewHash = sha256Jcs(hostile);
  assert.throws(() => assertOperateExperiencePreviewV1(hostile, previewBinding(hostile)));
});

test('display and preview assertions reject accessors, proxies, and unsupported members as whole envelopes', () => {
  const { display, binding } = selectInbox();
  const accessor = structuredClone(display);
  Object.defineProperty(itemBySubject(accessor.payload.data.inbox, 'dec_00000001'), 'title', {
    enumerable: true,
    get() {
      return 'private getter';
    },
  });
  assert.throws(() => assertOperateExperienceDisplaySurfaceV1(accessor, binding));
  assert.throws(() => assertOperateExperienceDisplaySurfaceV1(new Proxy(display, {}), binding));
  const foreign = structuredClone(display);
  foreign.payload.data.privateAuthority = { grant: 'must-not-pass' };
  assert.throws(() => assertOperateExperienceDisplaySurfaceV1(foreign, binding));

  const preview = reviewPreview();
  const previewAccessor = structuredClone(preview);
  Object.defineProperty(previewAccessor.transition.targets[0], 'id', {
    enumerable: true,
    get() {
      return 'private target';
    },
  });
  assert.throws(() => assertOperateExperiencePreviewV1(previewAccessor, previewBinding(preview)));
  assert.throws(() =>
    assertOperateExperiencePreviewV1(new Proxy(preview, {}), previewBinding(preview)),
  );
});

test('Inbox display and preview verifier have source, packed, public-import, and browser-bundle parity', {
  timeout: 120_000,
  skip: vite ? false : 'paired OpenPlanr Vite is required for the browser-bundle proof',
}, async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-inbox-display-pack-'));
  try {
    const { consumer, installedPackage } = packInstalledConsumer(temporaryRoot);
    const installed = await import(
      pathToFileURL(join(installedPackage, 'schemas/v1.2.0/operate-experience-display-surface.mjs'))
        .href
    );
    for (const name of [
      'assertOperateExperienceDisplaySurfaceV1',
      'validateOperateExperienceDisplaySurfaceV1',
      'assertOperateExperiencePreviewV1',
      'validateOperateExperiencePreviewV1',
    ]) {
      assert.equal(typeof installed[name], 'function', name);
    }
    const { display, binding } = selectInbox();
    const preview = reviewPreview();
    assert.equal(
      installed.assertOperateExperienceDisplaySurfaceV1(display, binding).integrity.contentHash,
      display.integrity.contentHash,
    );
    assert.equal(
      installed.assertOperateExperiencePreviewV1(preview, previewBinding(preview)).previewHash,
      preview.previewHash,
    );
    run(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "import('planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs').then((m) => { if (typeof m.assertOperateExperiencePreviewV1 !== 'function') process.exit(2); });",
      ],
      { cwd: consumer },
    );

    const entry = join(consumer, 'entry.js');
    const config = join(consumer, 'vite.config.mjs');
    const output = join(consumer, 'dist');
    writeFileSync(
      entry,
      [
        "import { assertOperateExperienceDisplaySurfaceV1, assertOperateExperiencePreviewV1 } from 'planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs';",
        `const display = ${JSON.stringify(display)};`,
        `const binding = ${JSON.stringify(binding)};`,
        `const preview = ${JSON.stringify(preview)};`,
        `const previewBinding = ${JSON.stringify(previewBinding(preview))};`,
        'globalThis.__inboxDisplay = assertOperateExperienceDisplaySurfaceV1(display, binding);',
        'globalThis.__inboxPreview = assertOperateExperiencePreviewV1(preview, previewBinding);',
        '',
      ].join('\n'),
    );
    writeFileSync(
      config,
      `export default ${JSON.stringify({
        root: consumer,
        build: {
          outDir: output,
          emptyOutDir: true,
          rollupOptions: { input: entry },
        },
      })};\n`,
    );
    run(process.execPath, [vite, 'build', '--config', config], { cwd: consumer });
    const files = collectFilePaths(output);
    const bundle = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    assert.doesNotMatch(bundle, /node:(?:crypto|fs|path|url)/u);
    assert.doesNotMatch(bundle, /protocol\/loader|protocol\/contracts/u);
    assert.match(bundle, /sha-256-jcs/u);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
