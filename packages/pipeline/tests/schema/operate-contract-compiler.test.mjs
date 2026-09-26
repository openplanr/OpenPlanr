import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  OPERATE_CONTRACT_COMPILER_VERSION,
  OperateContractCompileError,
  compileOperateContractRegistry,
  renderOperateContractCatalogModule,
} from '../../lib/operate/contracts/compiler.mjs';
import { runOperateContractGenerator } from '../../scripts/generate-operate-contracts.mjs';
import {
  OPERATE_RUNTIME_CONTRACT_KINDS,
  loadOperateRuntimeContract,
} from '../../lib/protocol/loader.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const registryPath = join(root, 'registry/operate-v2-contracts.json');
const source = () => JSON.parse(readFileSync(registryPath, 'utf8'));
const temporaryRoots = [];

after(() => {
  for (const path of temporaryRoots) rmSync(path, { recursive: true, force: true });
});

function clone(value) {
  return structuredClone(value);
}

function temporaryProject(registry) {
  const project = mkdtempSync(join(tmpdir(), 'planr-operate-contracts-'));
  temporaryRoots.push(project);
  mkdirSync(join(project, 'registry'), { recursive: true });
  const isolatedRegistry = clone(registry);
  // This isolated fixture exercises only generator output. The canonical
  // source workspace owns the independently verified surface files.
  isolatedRegistry.generation.verifiedTargets = [];
  writeFileSync(
    join(project, 'registry/operate-v2-contracts.json'),
    `${JSON.stringify(isolatedRegistry, null, 2)}\n`,
  );
  return project;
}

test('the canonical registry compiles to a frozen deterministic explicit-v2 catalog', () => {
  const first = compileOperateContractRegistry(source());
  const second = compileOperateContractRegistry(source());

  assert.equal(first.compilerVersion, OPERATE_CONTRACT_COMPILER_VERSION);
  assert.equal(first.protocol.version, '2.0.0');
  assert.equal(first.protocol.versionPolicy, 'exact');
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.runtimeContracts.map(({ id }) => id),
    [
      'operating-cycle',
      'operating-cycle-input-binding',
      'operating-assignment',
      'operating-review',
      'operating-submission',
      'operating-artifact',
      'operating-event',
      'operating-runtime-state',
      'operating-checkpoint',
      'operate-allowed-action',
      'operate-api-envelope',
      'operate-tool-call',
      'operate-domain-registration',
      'agent-runtime-manifest',
      'operating-finding',
      'operating-decision',
      'operating-action',
      'operating-work-change-set',
      'operating-work-ledger',
      'operating-evidence-candidate',
      'operating-evidence-ref',
      'operating-evidence-resolution',
      'operate-evidence-provider-registration',
      'operate-evidence-resolver-registration',
      'operating-evidence-edge',
      'operating-evidence-graph',
      'operating-model-state',
      'operating-snapshot',
      'operating-objective',
      'operating-metric',
      'operating-metric-observation',
      'operating-risk',
      'operating-assumption',
      'operating-claim',
      'operating-domain-projection',
      'business-operating-snapshot-projection',
      'software-operating-snapshot-projection',
      'operating-delta',
      'operating-intelligence-plan',
      'operating-decision-ledger',
      'operating-action-verification-plan',
      'operating-outcome',
      'operating-learning',
      'operating-scenario',
      'operating-event-trigger',
      'operate-snapshot-provider-registration',
      'operate-metric-provider-registration',
      'operate-verification-provider-registration',
      'operating-action-policy',
      'operating-policy-evaluation',
      'operating-approval-requirement',
      'operating-approval-record',
      'operating-capability-availability',
      'operating-capability-grant',
      'operating-governed-operation',
      'operating-execution-result',
      'operating-rollback-plan',
      'operating-rollback-result',
      'operate-capability-provider-registration',
      'operate-policy-provider-registration',
      'operate-executor-registration',
      'operating-advisor-result',
      'operating-challenger-review',
      'operating-context-capture',
      'operating-intelligence-input-bundle',
      'operating-review-read',
      'operating-review-receipt',
      'operating-trace-matrix',
      'operating-executive-board',
      'operate-live-evidence-provider-registration',
      'operate-live-evidence-provider-registry',
      'operating-live-evidence-consent-record',
      'operating-connector-checkpoint',
      'operating-live-evidence-ingestion',
      'operating-measurement-plan',
      'operating-measurement-schedule',
      'operating-measurement-schedule-receipt',
      'operating-evidence-observation',
      'operating-outcome-evaluation',
      'operating-learning-receipt',
    ],
  );
  assert.equal(
    first.schemaRegistry['operating-artifact']['2.0.0'],
    'schemas/v2.0.0/operating-artifact.schema.json',
  );
  assert.deepEqual(first.operatingIntelligence.projectionIdentities, [
    'business-operating-snapshot-projection@1.0.0',
    'software-operating-snapshot-projection@1.0.0',
  ]);
  assert.deepEqual(
    first.governedExecution.effectClasses,
    [
      'read-only',
      'machine-local-write',
      'project-write',
      'provider-call',
      'external-effect',
      'destructive',
    ],
    'effect risk remains ordered from lowest to highest',
  );
  assert.deepEqual(
    first.evidence.sourceContracts.map(({ id }) => id),
    [
      'capacity-throughput',
      'channel-economics',
      'ci-test-evidence',
      'competitor-positioning',
      'context-manifest',
      'demand-market',
      'finance-metrics',
      'incident-history',
      'objective-metrics',
      'operations-customer-health',
      'planning-acceptance',
      'prior-decisions',
      'product-activation',
      'repository-architecture',
      'retention-discovery',
      'support-incidents',
    ],
  );
  for (const domain of first.extensions.domains) {
    for (const role of domain.roles) {
      if (role.roleKind === 'advisor') {
        assert.ok(role.evidenceRequirements.length > 0, `${domain.domainId}/${role.roleId}`);
        for (const requirement of role.evidenceRequirements) {
          assert.ok(requirement.acceptedSourceContracts.length > 0, requirement.requirementId);
        }
      } else {
        assert.deepEqual(role.evidenceRequirements, [], `${domain.domainId}/${role.roleId}`);
      }
    }
  }
  assert.match(renderOperateContractCatalogModule(source()), /OPERATE_CONTRACT_CATALOG_V2/u);
});

test('the catalog is source-order independent', () => {
  const shuffled = source();
  for (const field of [
    'contracts',
    'roles',
    'guards',
    'transitions',
    'operations',
    'actions',
    'dependencyPolicies',
    'errors',
  ])
    shuffled[field].reverse();

  assert.deepEqual(
    compileOperateContractRegistry(shuffled),
    compileOperateContractRegistry(source()),
  );
});

test('the compiler rejects malformed, duplicate, unknown, unsafe, vendor, and consumer declarations', () => {
  const cases = [
    [
      'unknown declaration',
      (registry) => {
        registry.undeclared = {};
      },
      'E_OPERATE_CONTRACT_UNKNOWN_DECLARATION',
    ],
    [
      'duplicate contract version',
      (registry) => {
        registry.contracts.push(clone(registry.contracts[0]));
      },
      'E_OPERATE_CONTRACT_DUPLICATE',
    ],
    [
      'unknown contract reference',
      (registry) => {
        registry.roles[0].output.schemaId = 'unknown-contract';
      },
      'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
    ],
    [
      'unknown guard reference',
      (registry) => {
        registry.operations[0].guard = 'unknown-guard';
      },
      'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
    ],
    [
      'unsafe schema path',
      (registry) => {
        registry.contracts[0].schemaPath = '../outside.schema.json';
      },
      'E_OPERATE_CONTRACT_UNSAFE',
    ],
    [
      'unowned dashboard declaration surface',
      (registry) => {
        registry.generation.verifiedTargets.find(({ kind }) => kind === 'declaration').path =
          'lib/dashboard/unrelated-consumer-contract.d.mts';
      },
      'E_OPERATE_CONTRACT_UNSAFE',
    ],
    [
      'unowned registry verification surface',
      (registry) => {
        registry.generation.verifiedTargets.find(({ kind }) => kind === 'registry').path =
          'registry/foreign.json';
      },
      'E_OPERATE_CONTRACT_UNSAFE',
    ],
    [
      'vendor declaration',
      (registry) => {
        registry.contracts[0].docsSection = 'codex-runtime';
      },
      'E_OPERATE_CONTRACT_NON_PORTABLE',
    ],
    [
      'consumer declaration',
      (registry) => {
        registry.roles[0].docsSection = 'adatalabs-output';
      },
      'E_OPERATE_CONTRACT_NON_PORTABLE',
    ],
    [
      'implicit version policy',
      (registry) => {
        registry.protocol.versionPolicy = 'compatible';
      },
      'E_OPERATE_CONTRACT_MALFORMED',
    ],
    [
      'implicit public projection version',
      (registry) => {
        registry.contracts.find(
          ({ id }) => id === 'business-operating-snapshot-projection',
        ).version = '2.0.0';
      },
      'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
    ],
    [
      'implicit API domain-contract mapping',
      (registry) => {
        registry.extensions.domains[0] = {
          ...registry.extensions.domains[0],
          domainId: 'business',
          domainContract: {
            apiDomainId: 'business',
            id: 'derived-business-domain',
            version: '1.0.0',
          },
        };
      },
      'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
    ],
    [
      'dynamic provider declaration',
      (registry) => {
        registry.extensions.snapshotProviders = [
          {
            ...JSON.parse(
              readFileSync(
                join(root, 'conformance/fixtures/operating-runtime-v2/all-contracts-valid.json'),
                'utf8',
              ),
            )['operate-snapshot-provider-registration'],
            implementation: { kind: 'module', path: './provider.mjs' },
          },
        ];
      },
      'E_OPERATE_CONTRACT_UNKNOWN_DECLARATION',
    ],
    [
      'destructive executor declaration',
      (registry) => {
        registry.extensions.executors[0].effectCeiling = 'destructive';
      },
      'E_OPERATE_CONTRACT_UNSAFE',
    ],
    [
      'dynamic executor declaration',
      (registry) => {
        registry.extensions.executors[0].implementation = { kind: 'module', id: 'unsafe-executor' };
      },
      'E_OPERATE_CONTRACT_UNSAFE',
    ],
    [
      'unknown evidence source contract',
      (registry) => {
        const advisor = registry.extensions.domains[0].roles.find(
          ({ roleKind }) => roleKind === 'advisor',
        );
        advisor.evidenceRequirements[0].acceptedSourceContracts = [
          { id: 'caller-asserted', version: '1.0.0' },
        ];
      },
      'E_OPERATE_CONTRACT_MALFORMED',
    ],
    [
      'advisor without evidence requirements',
      (registry) => {
        const advisor = registry.extensions.domains[0].roles.find(
          ({ roleKind }) => roleKind === 'advisor',
        );
        advisor.evidenceRequirements = [];
      },
      'E_OPERATE_CONTRACT_MALFORMED',
    ],
  ];

  for (const [label, mutate, code] of cases) {
    const registry = source();
    mutate(registry);
    assert.throws(
      () => compileOperateContractRegistry(registry),
      (error) => error instanceof OperateContractCompileError && error.code === code,
      label,
    );
  }
});

test('the generator writes only on --write and --check reports exact drift without repair', () => {
  const project = temporaryProject(source());
  const target = join(project, 'lib/protocol/generated/contract-catalog-v2.mjs');

  assert.throws(
    () => runOperateContractGenerator({ argv: ['--check'], projectRoot: project }),
    (error) => error?.code === 'E_OPERATE_CONTRACT_DRIFT',
  );
  assert.equal(existsSync(target), false, 'check mode is read-only when the target is missing');

  assert.deepEqual(runOperateContractGenerator({ argv: ['--write'], projectRoot: project }), {
    ok: true,
    mode: 'write',
    written: [
      'lib/protocol/generated/contract-catalog-v2.mjs',
      'lib/protocol/generated/contract-package-inventory-v2.json',
    ],
    staleTargets: [
      'lib/protocol/generated/contract-catalog-v2.mjs',
      'lib/protocol/generated/contract-package-inventory-v2.json',
    ],
  });
  const generated = readFileSync(target, 'utf8');
  assert.deepEqual(runOperateContractGenerator({ argv: ['--check'], projectRoot: project }), {
    ok: true,
    mode: 'check',
    staleTargets: [],
  });

  writeFileSync(target, `${generated}// hand edit\n`);
  assert.throws(
    () => runOperateContractGenerator({ argv: ['--check'], projectRoot: project }),
    (error) =>
      error?.code === 'E_OPERATE_CONTRACT_DRIFT' &&
      error?.details?.staleTargets?.includes('lib/protocol/generated/contract-catalog-v2.mjs'),
  );
  assert.match(readFileSync(target, 'utf8'), /hand edit/u, 'check mode must not repair drift');
});

test('the compiler is pure and the runtime loader remains an exact-v2 boundary', () => {
  const compilerSource = readFileSync(join(root, 'lib/operate/contracts/compiler.mjs'), 'utf8');
  const compilerImports = compilerSource.match(/^import .+$/gmu) ?? [];
  assert.deepEqual(
    compilerImports,
    [],
    'the registry is the sole hand-authored role and rubric source',
  );
  assert.doesNotMatch(compilerSource, /node:fs|node:child_process|fetch\(|spawn\(|exec\(/u);

  assert.equal(OPERATE_RUNTIME_CONTRACT_KINDS.length, source().contracts.length);
  assert.equal(
    loadOperateRuntimeContract('operating-artifact', { protocolVersion: '2.0.0' }).kind,
    'operating-artifact',
  );
  assert.throws(() => loadOperateRuntimeContract('operating-artifact'), {
    code: 'E_SCHEMA_VERSION_REQUIRED',
  });
  assert.throws(
    () => loadOperateRuntimeContract('operating-artifact', { protocolVersion: '1.4.0' }),
    {
      code: 'E_SCHEMA_VERSION_UNSUPPORTED',
    },
  );
});
