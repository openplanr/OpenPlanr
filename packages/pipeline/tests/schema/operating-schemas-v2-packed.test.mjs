import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

test('packed package is an isolated Operate 2.0 contract consumer', { timeout: 120_000 }, () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-operate-v2-pack-'));
  try {
    const cache = join(temporaryRoot, 'npm-cache');
    const packed = run(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', temporaryRoot],
      {
        cwd: root,
        env: { ...process.env, NPM_CONFIG_CACHE: cache },
      },
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
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ type: 'module' }));

    const verification = String.raw`
      import assert from 'node:assert/strict';
      import { createRequire } from 'node:module';
      import { readdirSync, readFileSync } from 'node:fs';
      import { dirname, resolve } from 'node:path';
      import { fileURLToPath } from 'node:url';
      import {
        OPERATE_RUNTIME_CONTRACT_KINDS,
        assertDashboardBootstrapV1,
        findOperateCoreProhibitionV2,
        loadOperateRuntimeContract,
        readOperatingRollbackPlanV2,
        validateDashboardBootstrapV1,
        validateProtocolArtifact,
      } from 'planr-pipeline/protocol';
      import {
        OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
        selectOperateExecutorV2,
      } from 'planr-pipeline/operate/governed-extensions-v2';
      import {
        OPEN_REFERENCE_CONTAINMENT_EXECUTOR_HOST_V2,
        createSyntheticNoNetworkTargetV2,
      } from 'planr-pipeline/operate/reference-governed-executors-v2';
      import {
        OPERATING_GOVERNED_EXECUTION_TERMINAL_STATES_V2,
        createOperatingGovernedExecutionRuntimeV2,
      } from 'planr-pipeline/operate/governed-execution-v2';
      import {
        OPERATING_GOVERNED_RECOVERY_CLASSIFICATIONS_V2,
        createOperatingGovernedRecoveryRuntimeV2,
      } from 'planr-pipeline/operate/governed-recovery-v2';

      const require = createRequire(import.meta.url);
      const loaderPath = fileURLToPath(import.meta.resolve('planr-pipeline/protocol'));
      const packageRoot = resolve(dirname(loaderPath), '..', '..');
      assert.ok(packageRoot.includes('node_modules/planr-pipeline'));
      assert.equal(new Set(OPERATE_RUNTIME_CONTRACT_KINDS).size, OPERATE_RUNTIME_CONTRACT_KINDS.length);
      assert.equal(findOperateCoreProhibitionV2('release-public'), 'publication');
      assert.equal(findOperateCoreProhibitionV2(['money', 'transfer']), 'funds-transfer');
      assert.equal(findOperateCoreProhibitionV2(['ship']), null);
      assert.equal(findOperateCoreProhibitionV2(['message']), null);
      assert.equal(findOperateCoreProhibitionV2(['email']), null);
      const bootstrap = {
        kind: 'dashboard-bootstrap', schemaVersion: '1.0.0', protocolVersion: '1.2.0',
        ui: {
          buildId: 'dashboard-packed-test', expectedBuildId: 'dashboard-packed-test',
          assetManifestHash: 'sha256:' + 'a'.repeat(64),
        },
        server: { packageVersion: '0.42.0' },
        capabilities: {
          planningGraph: { schemaVersion: '1.0.0' },
          operateExperience: { protocolVersion: '2.0.0', schemaVersion: '1.0.0' },
          operateCommands: { protocolVersion: '2.0.0', transportVersion: '1.0.0', available: false },
          diagnostics: { schemaVersion: '1.0.0', available: true },
        },
        project: {
          projectId: 'sha256:' + 'b'.repeat(64), name: 'Packed project', branch: 'main',
          products: ['operate', 'planning'],
        },
        queryRoots: {
          planning: {
            actorId: 'human-owner', projectId: 'sha256:' + 'b'.repeat(64),
            scopeId: 'planning', domainId: 'planning', domainVersion: '1.0.0', generation: 0,
          },
          operate: {
            actorId: 'human-owner', projectId: 'sha256:' + 'b'.repeat(64),
            scopeId: 'business', domainId: 'business', domainVersion: '2.0.0', generation: 0,
          },
        },
        origin: 'http://localhost:7473', compatibility: { status: 'compatible', reasonCodes: [] },
      };
      assert.deepEqual(validateDashboardBootstrapV1(bootstrap), []);
      assert.equal(assertDashboardBootstrapV1(bootstrap), bootstrap);
      const bootstrapMismatch = structuredClone(bootstrap);
      bootstrapMismatch.ui.expectedBuildId = 'dashboard-foreign';
      assert.ok(validateDashboardBootstrapV1(bootstrapMismatch).length > 0);

      for (const kind of OPERATE_RUNTIME_CONTRACT_KINDS) {
        const contract = loadOperateRuntimeContract(kind, { protocolVersion: '2.0.0' });
        assert.equal(contract.protocolVersion, '2.0.0');
        const schemaPath = require.resolve(
          'planr-pipeline/schemas/v2.0.0/' + contract.path.split('/').at(-1),
        );
        assert.equal(JSON.parse(readFileSync(schemaPath, 'utf8')).$schema,
          'https://json-schema.org/draft/2020-12/schema');
      }

      const fixtureRoot = resolve(packageRoot, 'conformance', 'fixtures', 'operating-runtime-v2');
      const fixtureNames = readdirSync(fixtureRoot).filter((name) => name.endsWith('.json'));
      assert.deepEqual(fixtureNames.sort(), [
        'action-verification-invalid.json',
        'action-verification-valid.json',
        'aggregate-missing-fields-invalid.json',
        'all-contracts-invalid.json',
        'all-contracts-valid.json',
        'authorization-invalid.json',
        'authorization-valid.json',
        'binding-field-tamper-invalid.json',
        'business-domain-valid.json',
        'carry-forward-invalid.json',
        'carry-forward-valid.json',
        'decision-ledger-invalid.json',
        'decision-ledger-valid.json',
        'deferred-assignment-kinds-invalid.json',
        'deferred-cycle-states-invalid.json',
        'deferred-triggers-invalid.json',
        'evidence-artifact-invalid.json',
        'evidence-artifact-valid.json',
        'evidence-contracts-invalid.json',
        'evidence-contracts-valid.json',
        'evidence-filesystem-invalid.json',
        'evidence-filesystem-valid.json',
        'evidence-git-invalid.json',
        'evidence-git-valid.json',
        'evidence-graph-invalid.json',
        'evidence-graph-valid.json',
        'evidence-planr-invalid.json',
        'evidence-planr-valid.json',
        'evidence-registry-invalid.json',
        'evidence-registry-valid.json',
        'evidence-resolution-invalid.json',
        'evidence-resolution-valid.json',
        'exact-bytes-valid.json',
        'execution-verification-invalid.json',
        'execution-verification-valid.json',
        'experience-bridge-invalid.json',
        'experience-bridge-valid.json',
        'extensions-invalid.json',
        'extensions-valid.json',
        'generated-contract-catalog-invalid.json',
        'generated-contract-catalog-valid.json',
        'governed-execution-contracts-invalid.json',
        'governed-execution-contracts-valid.json',
        'governed-extensions-invalid.json',
        'governed-extensions-valid.json',
        'governed-operation-invalid.json',
        'governed-operation-valid.json',
        'governed-rollback-invalid.json',
        'governed-rollback-valid.json',
        'intelligence-plan-invalid.json',
        'intelligence-plan-valid.json',
        'live-evidence-contracts-invalid.json',
        'live-evidence-contracts-valid.json',
        'operating-delta-invalid.json',
        'operating-delta-valid.json',
        'operating-domain-invalid.json',
        'operating-intelligence-contracts-invalid.json',
        'operating-intelligence-contracts-valid.json',
        'operating-intelligence-state-invalid.json',
        'operating-intelligence-state-valid.json',
        'operating-snapshot-invalid.json',
        'operating-snapshot-valid.json',
        'operating-state-invalid.json',
        'operating-state-valid.json',
        'operating-trigger-scenario-invalid.json',
        'operating-trigger-scenario-valid.json',
        'persistent-work-cross-cycle.json',
        'persistent-work-invalid.json',
        'persistent-work-valid.json',
        'phase1-public-subset-valid.json',
        'placeholders-invalid.json',
        'policy-approval-invalid.json',
        'policy-approval-valid.json',
        'scheduler-invalid.json',
        'scheduler-valid.json',
        'software-domain-valid.json',
        'version-boundaries-invalid.json',
      ]);
      for (const name of fixtureNames) JSON.parse(readFileSync(resolve(fixtureRoot, name), 'utf8'));

      const readFixture = (name) => JSON.parse(readFileSync(resolve(fixtureRoot, name), 'utf8'));
      const governed = readFixture('governed-extensions-valid.json');
      const containedSelection = selectOperateExecutorV2(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2, {
        protocolVersion: governed.protocolVersion,
        runtimeVersion: governed.runtimeVersion,
        now: governed.observedAt,
        ...governed.containmentExecutorSelection,
      });
      assert.equal(containedSelection.status, 'available');
      assert.equal(OPEN_REFERENCE_CONTAINMENT_EXECUTOR_HOST_V2.executorId,
        containedSelection.registration.executorId);
      const referenceDeclaration = readFileSync(resolve(
        packageRoot, 'lib', 'operate', 'reference-governed-executors-v2.d.mts',
      ), 'utf8');
      assert.doesNotMatch(referenceDeclaration, /operation: OperatingGovernedOperationV2;/u);
      assert.match(referenceDeclaration,
        /execute\(input: ReferenceExecutorInvocationV2\): Readonly<ContainedEffectReceiptV2>;/u);
      assert.match(referenceDeclaration,
        /reconcile\(input: ReferenceExecutorReconcileInvocationV2\): Readonly</u);
      assert.deepEqual(createSyntheticNoNetworkTargetV2({
        target: { kind: 'synthetic-target', id: 'packed-target', revision: 'rev-0001' },
        initialValue: { packed: true },
      }).read().value, { packed: true });
      assert.equal(OPERATING_GOVERNED_EXECUTION_TERMINAL_STATES_V2.includes('succeeded'), true);
      assert.equal(typeof createOperatingGovernedExecutionRuntimeV2, 'function');
      const governedExecutionDeclaration = readFileSync(resolve(
        packageRoot, 'lib', 'operate', 'governed-execution-v2.d.mts',
      ), 'utf8');
      assert.match(governedExecutionDeclaration, /createOperatingGovernedExecutionRuntimeV2/u);
      assert.match(governedExecutionDeclaration, /executeOperatingGovernedActionV2/u);
      assert.deepEqual(OPERATING_GOVERNED_RECOVERY_CLASSIFICATIONS_V2,
        ['applied', 'not-applied', 'partial', 'unknown']);
      assert.equal(typeof createOperatingGovernedRecoveryRuntimeV2, 'function');
      const governedRecoveryDeclaration = readFileSync(resolve(
        packageRoot, 'lib', 'operate', 'governed-recovery-v2.d.mts',
      ), 'utf8');
      assert.match(governedRecoveryDeclaration, /createOperatingGovernedRecoveryRuntimeV2/u);
      assert.match(governedRecoveryDeclaration, /rollbackOperatingGovernedActionV2/u);
      const governedRollback = readFixture('governed-rollback-valid.json');
      assert.equal(readOperatingRollbackPlanV2(governedRollback.rollbackPlan, {
        protocolVersion: '2.0.0',
      }).rollbackPlanId, governedRollback.rollbackPlan.rollbackPlanId);

      const valid = readFixture('all-contracts-valid.json');
      const persistentWork = readFixture('persistent-work-valid.json');
      for (const [kind, key] of [
        ['operating-finding', 'finding'],
        ['operating-decision', 'decision'],
        ['operating-action', 'action'],
        ['operating-work-change-set', 'changeSet'],
        ['operating-work-ledger', 'ledger'],
      ]) {
        assert.deepEqual(validateProtocolArtifact(kind, persistentWork[key], {
          protocolVersion: '2.0.0',
        }), [], kind + ': persistent-work fixture validates');
      }
      const persistentWorkInvalid = readFixture('persistent-work-invalid.json');
      for (const [kind, key] of [
        ['operating-finding', 'finding'],
        ['operating-decision', 'decision'],
        ['operating-action', 'action'],
        ['operating-work-change-set', 'changeSet'],
        ['operating-work-ledger', 'ledger'],
      ]) {
        const candidate = structuredClone(persistentWork[key]);
        Object.assign(candidate, persistentWorkInvalid[key].patch);
        assert.ok(validateProtocolArtifact(kind, candidate, {
          protocolVersion: '2.0.0',
        }).length, kind + ': persistent-work invalid fixture rejects');
      }
      const evidenceContracts = readFixture('evidence-contracts-valid.json');
      for (const kind of [
        'operating-evidence-candidate',
        'operating-evidence-ref',
        'operating-evidence-resolution',
        'operate-evidence-provider-registration',
        'operate-evidence-resolver-registration',
        'operating-evidence-edge',
        'operating-evidence-graph',
      ]) {
        assert.deepEqual(validateProtocolArtifact(kind, evidenceContracts[kind], {
          protocolVersion: '2.0.0',
        }), [], kind + ': evidence fixture validates');
      }
      for (const state of readFixture('deferred-cycle-states-invalid.json').states) {
        const errors = validateProtocolArtifact('operating-cycle', {
          ...valid['operating-cycle'], state,
        }, { protocolVersion: '2.0.0' });
        if (['challenging', 'approved', 'executing', 'verifying'].includes(state)) {
          assert.deepEqual(errors, [], state);
        } else {
          assert.ok(errors.length, state);
        }
      }
      for (const assignmentKind of readFixture('deferred-assignment-kinds-invalid.json').assignmentKinds) {
        assert.ok(validateProtocolArtifact('operating-assignment', {
          ...valid['operating-assignment'], assignmentKind,
        }, { protocolVersion: '2.0.0' }).length);
      }
      for (const kind of readFixture('deferred-triggers-invalid.json').triggers) {
        const call = structuredClone(valid['operate-tool-call']);
        call.request.trigger.kind = kind;
        assert.ok(validateProtocolArtifact('operate-tool-call', call, {
          protocolVersion: '2.0.0',
        }).length);
      }

      for (const value of ['scope-{{domainId}}', 'prefix-<scope-id>']) {
        const argumentsValue = structuredClone(valid['operate-tool-call'].request);
        argumentsValue.scope.scopeId = value;
        assert.ok(validateProtocolArtifact('operate-allowed-action', {
          tool: 'operate.cycle.start', arguments: argumentsValue,
          label: 'Start cycle', effect: 'project-write',
        }, { protocolVersion: '2.0.0' }).length, value + ':allowed-action');
        assert.ok(validateProtocolArtifact('operate-tool-call', {
          ...structuredClone(valid['operate-tool-call']), request: argumentsValue,
        }, { protocolVersion: '2.0.0' }).length, value + ':tool-call');
      }

      for (const label of ['Run <next-action> now', 'Resume {{cycleId}}']) {
        assert.ok(validateProtocolArtifact('operate-allowed-action', {
          ...structuredClone(valid['operate-allowed-action']), label,
        }, { protocolVersion: '2.0.0' }).length, label + ':action-label');
      }
    `;
    const verificationPath = join(consumer, 'verify.mjs');
    writeFileSync(verificationPath, verification);
    run(process.execPath, [verificationPath], { cwd: consumer });

    assert.ok(
      readFileSync(join(installedPackage, 'package.json'), 'utf8').includes('planr-pipeline'),
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
