import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertLoopbackSurface,
  countPermissionPrompts,
  createCliDriver,
  createDisposableCliRoot,
  createDisposableStore,
  createLoopbackBrowserAdapter,
  EVALUATION_BROWSER_EVIDENCE_CLASSES,
  installPackedMember,
  routeTrigger,
  runBrowserJourney,
  runCliJourney,
  runPackedInstallJourney,
  runRecoveryJourney,
  startLoopbackSurface,
} from '../../lib/evaluation/journeys.mjs';
import { readProfessionalSkillsCatalog } from '../../lib/pipeline/professional-skills.mjs';

const root = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const catalog = readProfessionalSkillsCatalog({ projectRoot: root });
const surface = assertLoopbackSurface(
  JSON.parse(
    readFileSync(join(root, 'conformance/fixtures/skill-evaluation/loopback-surface.json'), 'utf8'),
  ),
);
const browserQa = catalog.skills.find((row) => row.skillId === 'planr-browser-qa');
const NOW = '2026-08-25T09:16:00.000Z';

function disposable(prefix) {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

test('a declared trigger phrase invokes and a declared exclusion declines', () => {
  const invoke = routeTrigger({
    promptText: browserQa.triggerPolicy.include[0],
    triggerPolicy: browserQa.triggerPolicy,
  });
  assert.equal(invoke.outcome, 'invoke');
  const decline = routeTrigger({
    promptText: browserQa.triggerPolicy.exclude[0],
    triggerPolicy: browserQa.triggerPolicy,
  });
  assert.equal(decline.outcome, 'decline');
});

test('half a trigger phrase asks rather than guesses', () => {
  const clarify = routeTrigger({
    promptText: 'verify routes, forms.',
    triggerPolicy: browserQa.triggerPolicy,
  });
  assert.equal(clarify.outcome, 'clarify');
});

test('a denied capability outranks every routing signal', () => {
  const refused = routeTrigger({
    promptText: `${browserQa.triggerPolicy.include[0]}, then publish the result.`,
    triggerPolicy: browserQa.triggerPolicy,
    declaredPermissions: [{ capability: 'publish', decision: 'denied' }],
  });
  assert.equal(refused.outcome, 'refuse');
  assert.deepEqual([...refused.refusedCapabilities], ['publish']);
});

test('a granted capability does not turn a declared trigger into a refusal', () => {
  const invoked = routeTrigger({
    promptText: `${browserQa.triggerPolicy.include[0]}, then publish the result.`,
    triggerPolicy: browserQa.triggerPolicy,
    declaredPermissions: [{ capability: 'publish', decision: 'granted' }],
  });
  assert.equal(invoked.outcome, 'invoke');
});

test('a prompting host counts one prompt per effectful grant', () => {
  const prompted = { permissionModel: { mode: 'prompted' } };
  const preauthorized = { permissionModel: { mode: 'preauthorized' } };
  const permissions = [
    { capability: 'file-read', decision: 'granted' },
    { capability: 'file-write', decision: 'granted' },
    { capability: 'command-execute', decision: 'granted' },
    { capability: 'network', decision: 'denied' },
  ];
  assert.equal(countPermissionPrompts(prompted, permissions), 2);
  assert.equal(countPermissionPrompts(preauthorized, permissions), 0);
});

test('a real CLI journey answers typed in both human and strict output', () => {
  const cliRoot = createDisposableCliRoot();
  try {
    const driver = createCliDriver({
      executable: join(root, 'bin/planr-pipeline.mjs'),
      cwd: cliRoot.root,
    });
    const journey = runCliJourney({
      driver,
      argv: ['prepare-browser-qa', 'evaluation-subject', '--run-id', 'evaluation'],
    });
    assert.equal(journey.completed, true);
    assert.equal(journey.terminalReason, 'CLI_TYPED_UNAVAILABLE');
    assert.equal(journey.typedUnavailable, 1);
    assert.equal(journey.outputs[0].record.code, 'E_BROWSER_QA_TRUSTED_HOST_REQUIRED');
    assert.equal(journey.outputs[0].record.ok, false);
  } finally {
    cliRoot.dispose();
  }
});

test('an untyped CLI answer is a typed absence, never a pass', () => {
  const driver = {
    invoke: () => ({
      argvDigest: 'sha256:0',
      mode: 'json',
      envelope: null,
      status: 0,
      latencyMs: 1,
      outputDigest: 'sha256:0',
      outputTokens: 1,
    }),
  };
  const journey = runCliJourney({ driver, argv: ['status'] });
  assert.equal(journey.completed, false);
  assert.equal(journey.absence.code, 'fixture-unavailable');
  assert.equal(journey.absence.treatedAsPass, false);
});

test('output modes that disagree are a failure rather than a pass', () => {
  const responses = [
    { envelope: { ok: false, code: 'E_ONE' }, latencyMs: 1, outputTokens: 1 },
    { envelope: { ok: false, code: 'E_TWO' }, latencyMs: 1, outputTokens: 1 },
  ];
  let call = 0;
  const driver = { invoke: () => responses[call++] };
  const journey = runCliJourney({ driver, argv: ['status'] });
  assert.equal(journey.completed, false);
  assert.equal(journey.terminalReason, 'CLI_OUTPUT_MODES_DISAGREE');
});

test('a loopback browser journey records every declared evidence class', async () => {
  const journey = await runBrowserJourney({
    surface,
    adapter: createLoopbackBrowserAdapter(),
    declaredViewports: surface.viewports,
  });
  assert.equal(journey.completed, true);
  assert.equal(journey.terminalReason, 'BROWSER_EVIDENCE_RECORDED');
  const evidence = journey.outputs[0].record;
  assert.equal(evidence.routes.length, surface.routes.length);
  assert.equal(evidence.forms, surface.forms.length);
  assert.equal(evidence.viewports, surface.viewports.length);
  assert.equal(evidence.accessibleDocuments, surface.routes.length);
  assert.equal(evidence.consoleChannel, 'no-console-channel');
  assert.ok(evidence.networkRequests >= surface.routes.length);
});

test('the loopback adapter attests exactly the declared evidence classes', () => {
  assert.deepEqual(
    [...createLoopbackBrowserAdapter().attests],
    [...EVALUATION_BROWSER_EVIDENCE_CLASSES],
  );
});

test('a document carrying script leaves its console channel unattested', async () => {
  const scripted = {
    ...surface,
    routes: [
      {
        ...surface.routes[0],
        document: surface.routes[0].document.replace(
          '</body>',
          '<script>console.log(1)</script></body>',
        ),
      },
    ],
  };
  const journey = await runBrowserJourney({
    surface: scripted,
    adapter: createLoopbackBrowserAdapter(),
    declaredViewports: surface.viewports,
  });
  assert.equal(journey.completed, false);
  assert.equal(journey.terminalReason, 'BROWSER_EVIDENCE_UNATTESTED');
  assert.equal(journey.absence.code, 'host-unavailable');
});

test('no trusted adapter keeps the browser journey blocking', async () => {
  const journey = await runBrowserJourney({
    surface,
    adapter: null,
    declaredViewports: surface.viewports,
  });
  assert.equal(journey.completed, false);
  assert.equal(journey.terminalReason, 'BROWSER_TRUSTED_HOST_REQUIRED');
  assert.equal(journey.absence.treatedAsPass, false);
});

test('the loopback surface never leaves the loopback interface', async () => {
  const session = await startLoopbackSurface(surface);
  try {
    assert.match(session.origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
    const response = await fetch(`${session.origin}/absent`);
    assert.equal(response.status, 404);
    assert.deepEqual(session.requests.at(-1), { method: 'GET', path: '/absent' });
  } finally {
    await session.close();
  }
});

test('a packed journey exercises the installed bytes rather than the working tree', () => {
  const archive = { 'skills/planr-spec/SKILL.md': 'installed bytes\n' };
  const installRoot = disposable('planr-packed-exercise');
  try {
    const journey = runPackedInstallJourney({
      archive,
      declaredMembers: Object.keys(archive),
      exercisePath: 'skills/planr-spec/SKILL.md',
      installRoot,
    });
    assert.equal(journey.completed, true);
    assert.equal(
      readFileSync(join(installRoot, 'skills/planr-spec/SKILL.md'), 'utf8'),
      archive['skills/planr-spec/SKILL.md'],
    );
  } finally {
    rmSync(installRoot, { recursive: true, force: true });
  }
});

test('a symlink already sitting on a member path is refused rather than followed', (context) => {
  const installRoot = disposable('planr-packed-symlink');
  const outside = disposable('planr-packed-outside');
  try {
    writeFileSync(join(outside, 'target.md'), 'foreign bytes\n');
    try {
      symlinkSync(join(outside, 'target.md'), join(installRoot, 'SKILL.md'));
    } catch {
      // Creating a symlink is a privileged operation on some hosts; the refusal
      // itself is proved by the sibling-discovery case below.
      context.skip('this host does not permit creating a symlink');
      return;
    }
    assert.throws(() => installPackedMember(installRoot, 'SKILL.md', 'installed bytes\n'), {
      code: 'E_EVALUATION_PACKED_MEMBER_REFUSED',
    });
    assert.equal(readFileSync(join(outside, 'target.md'), 'utf8'), 'foreign bytes\n');
  } finally {
    rmSync(installRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('sibling checkout discovery is refused', () => {
  const installRoot = disposable('planr-packed-sibling');
  try {
    for (const path of [
      '../sibling/SKILL.md',
      'skills/../../sibling/SKILL.md',
      '/etc/planr/SKILL.md',
    ]) {
      assert.throws(
        () => installPackedMember(installRoot, path, 'bytes\n'),
        { code: 'E_EVALUATION_PACKED_MEMBER_REFUSED' },
        path,
      );
    }
  } finally {
    rmSync(installRoot, { recursive: true, force: true });
  }
});

test('exact replay is idempotent and a changed payload under one identity is a typed conflict', () => {
  const storeRoot = disposable('planr-recovery-store');
  try {
    const store = createDisposableStore({ root: storeRoot, clock: () => NOW });
    assert.equal(store.append('one', { a: 1 }).applied, true);
    assert.equal(store.append('one', { a: 1 }).applied, false);
    assert.throws(() => store.append('one', { a: 2 }), { code: 'E_EVALUATION_JOURNEY_CONFLICT' });
    assert.equal(createDisposableStore({ root: storeRoot, clock: () => NOW }).reopen(), 1);
    assert.equal(store.rollbackTo(0), 0);
  } finally {
    rmSync(storeRoot, { recursive: true, force: true });
  }
});

test('the recovery journey proves stale, conflict, restart, replay, and rollback in one pass', () => {
  const journey = runRecoveryJourney({
    scenario: {
      scenarioId: `esc_${'a'.repeat(64)}`,
      scenarioDigest: `sha256:${'b'.repeat(64)}`,
      hostProfileRef: { hostProfileDigest: `sha256:${'c'.repeat(64)}` },
      budgetRef: { budgetDigest: `sha256:${'d'.repeat(64)}` },
    },
    clock: () => NOW,
  });
  assert.equal(journey.completed, true);
  assert.equal(journey.terminalReason, 'RECOVERY_SEQUENCE_PROVEN');
  assert.equal(journey.outputs[0].record.conflictCode, 'E_EVALUATION_JOURNEY_CONFLICT');
});
