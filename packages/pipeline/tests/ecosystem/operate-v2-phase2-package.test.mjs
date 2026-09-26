import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { OPERATE_RUNTIME_CONTRACT_KINDS } from '../../lib/protocol/loader.mjs';
import {
  checkOperateRuntimePurity,
  packOperateV2DevelopmentSnapshot,
} from '../../scripts/check-operate-runtime-purity.mjs';
import { resolveWorkspaceDependencyRoot } from '../helpers/workspace-dependency.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-operate-v2-phase2-package-'));
const npmCache = join(temporaryRoot, 'npm-cache');

after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

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

function runNpm(args, options = {}) {
  const npmCli = process.env.npm_execpath;
  const env = {
    ...process.env,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_cache: npmCache,
  };
  return npmCli
    ? run(process.execPath, [npmCli, ...args], { ...options, env: { ...env, ...options.env } })
    : run('npm', args, { ...options, env: { ...env, ...options.env } });
}

test('Phase 2 packed consumer uses only declared v2 exports for Assignment, Review, retry, and extension boundaries', {
  timeout: 180_000,
}, () => {
  const packageDestination = join(temporaryRoot, 'package');
  const packed = packOperateV2DevelopmentSnapshot(packageDestination, { sourceRoot: root });
  assert.equal(packed.ok, true);
  assert.match(packed.sha256, /^[a-f0-9]{64}$/);
  assert.equal(packed.sourcePurity.ok, true);
  assert.equal(packed.tarballPurity.ok, true);

  const packedFiles = new Set(packed.files.map(({ path }) => path));
  for (const required of [
    'conformance/verify-operate-v2-contract-compilation.mjs',
    'lib/operate/runtime-foundation.mjs',
    'lib/operate/scheduler-v2.mjs',
    'lib/operate/extensions-v2.mjs',
  ])
    assert.equal(packedFiles.has(required), true, `missing Phase 2 package surface ${required}`);
  for (const path of packedFiles) {
    assert.doesNotMatch(path, /^(?:\.planr\/|tests\/|node_modules\/|\.env(?:\.|\/|$))/);
    assert.doesNotMatch(path, /operate-2\.0\/(?:phases|audits|decisions)/i);
    assert.doesNotMatch(path, /(?:compatibility-v1_4|records-migration|operating-provider-kit)/);
  }

  const installRoot = join(temporaryRoot, 'consumer');
  const dependencyRoot = join(temporaryRoot, 'dependencies');
  mkdirSync(installRoot, { recursive: true });
  mkdirSync(dependencyRoot, { recursive: true });
  const localDependencies = {};
  for (const dependency of ['@noble/hashes', 'entities', 'esbuild', 'pako', 'parse5']) {
    const dependencyRootPath = resolveWorkspaceDependencyRoot(dependency);
    const [dependencyPack] = JSON.parse(
      runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', dependencyRoot], {
        cwd: dependencyRootPath,
      }).stdout,
    );
    localDependencies[dependency] = `file:${join(dependencyRoot, dependencyPack.filename)}`;
  }
  writeFileSync(
    join(installRoot, 'package.json'),
    JSON.stringify({
      name: 'operate-v2-phase2-consumer',
      private: true,
      type: 'module',
      dependencies: localDependencies,
    }),
  );
  runNpm(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--omit=dev',
      '--omit=optional',
      '--no-package-lock',
      '--offline',
      packed.tarballPath,
    ],
    { cwd: installRoot },
  );

  const installedPackage = join(installRoot, 'node_modules', 'planr-pipeline');
  assert.equal(existsSync(join(installedPackage, 'lib/operate/scheduler-v2.mjs')), true);
  assert.equal(existsSync(join(installedPackage, 'lib/operate/extensions-v2.mjs')), true);
  assert.equal(checkOperateRuntimePurity(installedPackage).ok, true);

  const consumer = String.raw`
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import {
      OPERATE_RUNTIME_CONTRACT_KINDS,
      loadOperateRuntimeContract,
    } from 'planr-pipeline/protocol';
    import {
      acceptOperatingAssignmentSubmissionV2,
      createEmptyOperatingRuntimeStateV2,
      deriveOperateAllowedActionsV2,
      readOperatingReviewV2,
    } from 'planr-pipeline/operate/runtime-v2';
    import { deriveOperatingAssignmentReleaseIntentsV2 } from 'planr-pipeline/operate/scheduler-v2';
    import {
      OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
      selectAgentRuntimeManifestV2,
    } from 'planr-pipeline/operate/extensions-v2';

    const TIME = '2026-08-08T12:00:00.000Z';
    const require = createRequire(import.meta.url);
    assert.equal(new Set(OPERATE_RUNTIME_CONTRACT_KINDS).size, OPERATE_RUNTIME_CONTRACT_KINDS.length);
    for (const kind of OPERATE_RUNTIME_CONTRACT_KINDS) {
      const contract = loadOperateRuntimeContract(kind, { protocolVersion: '2.0.0' });
      require.resolve('planr-pipeline/schemas/v2.0.0/' + contract.path.split('/').at(-1));
    }

    const assignment = ({ assignmentId, state, dependsOn, dependencyPolicy, roleId }) => ({
      kind: 'operating-assignment', schemaVersion: '1.0.0', protocolVersion: '2.0.0',
      assignmentId, cycleId: 'cyc_00000001', assignmentKind: 'context-capture', roleId,
      analysisRubric: null, mandate: null, intelligenceContext: null,
      objective: 'Produce one bounded result.', state, dependsOn, dependencyPolicy,
      inputAbsences: [],
      inputArtifactIds: [], outputContract: {
        schemaId: 'operating-context-capture', schemaVersion: '2.0.0', mediaType: 'application/json', encoding: 'utf-8', maxBytes: 1024,
      },
      capabilityGrantId: null,
      attemptPolicy: { maxAttempts: 2, attempt: state === 'running' ? 1 : 0, timeoutMs: 300000 },
      claim: state === 'running'
        ? { actorId: 'agent-001', actorKind: 'agent', runtime: 'portable', claimId: 'claim-' + assignmentId }
        : null,
      terminalOutcome: null,
      createdAt: TIME,
      availableAt: state === 'pending' ? null : TIME,
      completedAt: null,
    });
    const cycle = {
      kind: 'operating-cycle', schemaVersion: '1.0.0', protocolVersion: '2.0.0',
      cycleId: 'cyc_00000001', scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0',
      state: 'advising', inputBindingId: 'inb_00000001', contractVersions: { 'operating-context-capture': '2.0.0' },
      trigger: { kind: 'manual' }, focus: ['strategy'], health: 'normal', activeReviewId: null,
      createdAt: TIME, updatedAt: TIME,
    };
    const source = assignment({
      assignmentId: 'asg_00000001', state: 'running', dependsOn: [], dependencyPolicy: { kind: 'none' }, roleId: 'context-source',
    });
    const dependent = assignment({
      assignmentId: 'asg_00000002', state: 'pending', dependsOn: [source.assignmentId], dependencyPolicy: { kind: 'all-required' }, roleId: 'context-dependent',
    });
    assert.deepEqual(deriveOperatingAssignmentReleaseIntentsV2({ assignments: [source, dependent] }), []);
    const issued = {
      kind: 'operating-submission', schemaVersion: '1.0.0', protocolVersion: '2.0.0',
      submissionId: 'sub_00000001', assignmentId: source.assignmentId, cycleId: source.cycleId,
      state: 'issued', rawHash: null, canonicalHash: null, sizeBytes: null, artifactId: null,
      acceptanceEventIds: [], responseData: null, issuedAt: TIME, resolvedAt: null,
    };
    const initial = {
      ...createEmptyOperatingRuntimeStateV2(TIME), cycles: [cycle], assignments: [source, dependent], submissions: [issued],
    };
    const request = {
      assignmentId: source.assignmentId, submissionId: issued.submissionId,
      actor: { actorId: 'agent-001', kind: 'agent', runtime: 'portable' },
      mediaType: 'application/json', encoding: 'utf-8',
      contentBase64: Buffer.from(JSON.stringify({
        kind: 'operating-context-capture',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        contextKind: 'cycle-evidence',
        scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
        focus: ['strategy'],
        trigger: { kind: 'manual' },
      }), 'utf8').toString('base64'),
    };
    const draft = {
      artifactId: 'art_00000001', artifactType: 'cycle-evidence', inputArtifactIds: [], timestamp: TIME,
      validatorVersion: '1.0.0', correlationId: 'corr-phase2-consumer',
      eventIds: { submitted: 'evt-submit-001', artifactCreated: 'evt-artifact-001', validated: 'evt-validated-001' },
    };
    const accepted = acceptOperatingAssignmentSubmissionV2(request, draft, { initialState: initial });
    assert.equal(new TextDecoder().decode(accepted.stagedRawBytes), '{"kind":"operating-context-capture","schemaVersion":"1.0.0","protocolVersion":"2.0.0","contextKind":"cycle-evidence","scope":{"scopeId":"scope-acme","domainId":"business","domainVersion":"1.0.0"},"focus":["strategy"],"trigger":{"kind":"manual"}}');
    assert.equal(accepted.events.length, 4);
    assert.equal(accepted.events.at(-1).type, 'assignment.available');
    assert.equal(accepted.events.at(-1).payload.assignmentId, dependent.assignmentId);
    assert.equal(accepted.state.assignments.find((item) => item.assignmentId === dependent.assignmentId).state, 'available');
    const retry = acceptOperatingAssignmentSubmissionV2(request, draft, { initialState: accepted.state });
    assert.equal(retry.replayed, true);
    assert.equal(retry.events.length, 0);
    assert.deepEqual(retry.response, accepted.response);

    const review = {
      kind: 'operating-review', schemaVersion: '1.0.0', protocolVersion: '2.0.0',
      reviewId: 'rev_00000001', cycleId: cycle.cycleId, ownerActorId: 'owner-001',
      state: 'pending', disposition: null, workDispositions: [], createdAt: TIME, updatedAt: TIME,
    };
    const reviewCycle = { ...cycle, state: 'awaiting_review', activeReviewId: review.reviewId };
    const ownerReadRequest = {
      reviewId: review.reviewId,
      cycleId: reviewCycle.cycleId,
      actor: { actorId: 'owner-001', kind: 'human', runtime: 'portable' },
      scope: {
        scopeId: reviewCycle.scopeId,
        domainId: reviewCycle.domainId,
        domainVersion: reviewCycle.domainVersion,
      },
    };
    const advisorActions = deriveOperateAllowedActionsV2({
      actor: { actorId: 'advisor-001', kind: 'agent', runtime: 'portable' },
      capabilities: ['operate.review.get', { id: 'operate-review-submit', version: '2.0.0' }], cycle: reviewCycle, review,
    });
    assert.deepEqual(advisorActions, []);
    const ownerActions = deriveOperateAllowedActionsV2({
      actor: ownerReadRequest.actor,
      capabilities: ['operate.review.get', { id: 'operate-review-submit', version: '2.0.0' }],
      cycle: reviewCycle,
      review,
      scope: ownerReadRequest.scope,
      reviewReadRequest: ownerReadRequest,
    });
    assert.deepEqual(ownerActions.map((action) => action.tool), ['operate.review.get']);
    const reviewRead = readOperatingReviewV2(ownerReadRequest, {
      initialState: { ...accepted.state, cycles: [reviewCycle], reviews: [review] },
      capabilities: ['operate.review.get'],
      readAt: TIME,
    });
    assert.deepEqual(reviewRead.data.dispositionChoices.map(({ submitArguments }) => (
      submitArguments.disposition
    )), ['approved', 'changes_requested', 'rejected', 'cancelled']);
    assert.deepEqual(reviewRead.allowedActions.map(({ arguments: args }) => args),
      reviewRead.data.dispositionChoices.map(({ submitArguments }) => submitArguments));

    assert.equal(OPEN_REFERENCE_OPERATE_EXTENSIONS_V2.domains.length, 2);
    assert.equal(selectAgentRuntimeManifestV2(
      OPEN_REFERENCE_OPERATE_EXTENSIONS_V2, 'reference-agent-runtime', { runtimeVersion: '1.0.0' },
    ).status, 'available');
  `;
  const consumerPath = join(installRoot, 'verify-phase2.mjs');
  writeFileSync(consumerPath, consumer);
  run(process.execPath, [consumerPath], { cwd: installRoot });

  const compilation = run(
    process.execPath,
    [join(installedPackage, 'conformance', 'verify-operate-v2-contract-compilation.mjs')],
    { cwd: installRoot },
  );
  const report = JSON.parse(compilation.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.contracts, OPERATE_RUNTIME_CONTRACT_KINDS.length);
});
