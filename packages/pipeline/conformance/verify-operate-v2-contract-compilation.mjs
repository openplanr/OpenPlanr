#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OPERATE_ROLE_MANDATES_V2,
  OPERATE_OPERATING_INTELLIGENCE_CONTRACT_KINDS_V2,
  OPERATE_OPERATING_PROJECTION_IDENTITIES_V2,
  OPERATE_OPERATING_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2,
  OPERATE_GOVERNED_EXECUTION_CONTRACT_KINDS_V2,
  OPERATE_GOVERNED_EFFECT_CLASSES_V2,
  OPERATE_EXPERIENCE_CONTRACT_KINDS_V2,
  OPERATING_DELIVERY_ROUTES_V1,
  OPERATE_RUNTIME_CONTRACT_KINDS,
  listProtocolSchemas,
  loadOperateRuntimeContract,
  loadOperateExperienceContract,
  validateOperateExperienceArtifactV2,
  validateProtocolArtifact,
} from 'planr-pipeline/protocol';
import {
  OPERATE_GUARD_TABLE_V2,
  OPERATING_ASSIGNMENT_TRANSITIONS_V2,
  OPERATING_REVIEW_TRANSITIONS_V2,
} from 'planr-pipeline/operate/runtime-v2';
import {
  compileOperateContractRegistry,
  renderOperateContractCatalogModule,
} from '../lib/operate/contracts/compiler.mjs';
import { runOperateContractGenerator } from '../scripts/generate-operate-contracts.mjs';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const registryPath = 'registry/operate-v2-contracts.json';
const fixtureRoot = 'conformance/fixtures/operating-runtime-v2';
const temporaryRoots = [];
let checks = 0;

function pass(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function json(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function fixture(name) {
  return json(join(fixtureRoot, name));
}

function clone(value) {
  return structuredClone(value);
}

function invalidFromDescriptor(base, descriptor) {
  const value = clone(base);
  if (descriptor.patch) Object.assign(value, descriptor.patch);
  if (descriptor.patchError) Object.assign(value.error, descriptor.patchError);
  return value;
}

function transitionEdges(table, entityId) {
  return Object.entries(table)
    .flatMap(([from, targets]) =>
      targets.map((to) => ({
        entityId,
        from,
        to,
      })),
    )
    .sort((left, right) => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`));
}

function temporaryProject(registry) {
  const project = mkdtempSync(join(tmpdir(), 'planr-operate-v2-compilation-'));
  temporaryRoots.push(project);
  const targets = new Set([
    registryPath,
    'scripts/generate-operate-contracts.mjs',
    'lib/operate/contracts/compiler.mjs',
    registry.generation.catalogPath,
    ...registry.generation.verifiedTargets.map(({ path }) => path),
  ]);
  for (const target of targets) {
    const destination = join(project, target);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(root, target), destination, { recursive: true });
  }
  return project;
}

try {
  const registry = json(registryPath);
  const sourceVerificationTargets = [
    registryPath,
    'scripts/generate-operate-contracts.mjs',
    'lib/operate/contracts/compiler.mjs',
    registry.generation.catalogPath,
    ...registry.generation.verifiedTargets.map(({ path }) => path),
  ];
  const sourceTargetsAvailable = sourceVerificationTargets.every((path) =>
    existsSync(join(root, path)),
  );
  const first = compileOperateContractRegistry(registry);
  const second = compileOperateContractRegistry(clone(registry));
  assert.deepEqual(first, second, 'canonical registry compilation must be deterministic');
  checks += 1;

  const generated = renderOperateContractCatalogModule(registry);
  assert.equal(
    readFileSync(join(root, registry.generation.catalogPath), 'utf8'),
    generated,
    'generated catalog bytes must equal the canonical compiler output',
  );
  checks += 1;
  if (sourceTargetsAvailable) {
    assert.deepEqual(
      runOperateContractGenerator({ argv: ['--check'], projectRoot: root }),
      { ok: true, mode: 'check', staleTargets: [] },
      'source contract check must begin clean',
    );
    checks += 1;
  }

  const catalogKinds = first.runtimeContracts.map(({ id }) => id);
  assert.deepEqual(
    OPERATE_RUNTIME_CONTRACT_KINDS,
    catalogKinds,
    'public loader kinds must be compiler-owned in runtime order',
  );
  checks += 1;
  assert.equal(
    catalogKinds.length,
    registry.contracts.length,
    'Operate must expose every exact registry-owned v2 contract identity once',
  );
  assert.deepEqual(
    first.evidence,
    {
      contractIds: [
        'operate-evidence-provider-registration',
        'operate-evidence-resolver-registration',
        'operating-evidence-candidate',
        'operating-evidence-edge',
        'operating-evidence-graph',
        'operating-evidence-ref',
        'operating-evidence-resolution',
      ],
      edgeRelations: ['contradictedBy', 'supportedBy'],
      kinds: ['filesystem', 'git', 'operate-artifact', 'planr'],
      resolverErrorCodes: [
        'ANCESTRY_MISMATCH',
        'ARTIFACT_HASH_MISMATCH',
        'ARTIFACT_NOT_FOUND',
        'CAPABILITY_DENIED',
        'CONSENT_REQUIRED',
        'EVIDENCE_LOCATOR_INVALID',
        'EVIDENCE_PROVIDER_UNAVAILABLE',
        'EVIDENCE_RESOLVER_UNAVAILABLE',
        'EVIDENCE_RESOLVER_UNREGISTERED',
        'EVIDENCE_RESOLVER_VERSION_UNSUPPORTED',
        'EVIDENCE_SOURCE_SCOPE_MISMATCH',
        'LINE_RANGE_INVALID',
        'OBJECT_TYPE_MISMATCH',
        'PATH_NOT_FOUND',
        'REVISION_NOT_FOUND',
        'SECRET_DETECTED',
        'SENSITIVITY_BLOCKED',
        'SOURCE_NOT_FOUND',
        'SOURCE_STALE',
        'SOURCE_UNTRACKED',
        'UNSUPPORTED_EVIDENCE_KIND',
      ],
      sourceContracts: [
        { id: 'capacity-throughput', version: '1.0.0' },
        { id: 'channel-economics', version: '1.0.0' },
        { id: 'ci-test-evidence', version: '1.0.0' },
        { id: 'competitor-positioning', version: '1.0.0' },
        { id: 'context-manifest', version: '1.0.0' },
        { id: 'demand-market', version: '1.0.0' },
        { id: 'finance-metrics', version: '1.0.0' },
        { id: 'incident-history', version: '1.0.0' },
        { id: 'objective-metrics', version: '1.0.0' },
        { id: 'operations-customer-health', version: '1.0.0' },
        { id: 'planning-acceptance', version: '1.0.0' },
        { id: 'prior-decisions', version: '1.0.0' },
        { id: 'product-activation', version: '1.0.0' },
        { id: 'repository-architecture', version: '1.0.0' },
        { id: 'retention-discovery', version: '1.0.0' },
        { id: 'support-incidents', version: '1.0.0' },
      ],
    },
    'Phase 4 evidence vocabulary must be compiler-owned and exact',
  );
  checks += 1;
  assert.deepEqual(
    OPERATE_OPERATING_INTELLIGENCE_CONTRACT_KINDS_V2,
    first.operatingIntelligence.contractIds,
    'Phase 5 operating-intelligence contract identities must be compiler-owned and exact',
  );
  assert.deepEqual(
    OPERATE_OPERATING_PROJECTION_IDENTITIES_V2,
    [
      'business-operating-snapshot-projection@1.0.0',
      'software-operating-snapshot-projection@1.0.0',
    ],
    'Phase 5 public projection identities must retain their exact versioned names',
  );
  assert.deepEqual(
    OPERATE_OPERATING_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2,
    first.operatingIntelligence.providerRegistrationContractIds,
    'Phase 5 provider registration identities must be explicit declarations only',
  );
  checks += 3;
  assert.deepEqual(
    OPERATE_GOVERNED_EXECUTION_CONTRACT_KINDS_V2,
    first.governedExecution.contractIds,
    'Phase 6 governed-execution identities must be compiler-owned and exact',
  );
  assert.deepEqual(
    OPERATE_GOVERNED_EFFECT_CLASSES_V2,
    first.governedExecution.effectClasses,
    'Phase 6 effect classifications must be compiler-owned and confer no authority',
  );
  checks += 2;
  assert.deepEqual(
    OPERATE_EXPERIENCE_CONTRACT_KINDS_V2,
    first.experience.contracts.map(({ id }) => id),
    'product-experience contract identities must be compiler-owned and exact',
  );
  assert.deepEqual(
    OPERATING_DELIVERY_ROUTES_V1,
    first.experience.deliveryRoutes,
    'Operate-to-Planning delivery routes must be closed and compiler-owned',
  );
  checks += 2;
  pass(
    first.generation.verifiedTargets.every(
      ({ path }) =>
        path !== 'package.json' &&
        !path.startsWith('tests/') &&
        !path.startsWith('conformance/fixtures/') &&
        !path.startsWith('conformance/verify-'),
    ),
    'executable tests, fixtures, package metadata, and conformance harnesses stay outside protocol digest custody',
  );
  checks += 1;
  const registeredSchemas = listProtocolSchemas()
    .filter(({ protocolVersion }) => protocolVersion === first.protocol.version)
    .map(({ kind }) => kind)
    .sort();
  assert.deepEqual(
    registeredSchemas,
    [...catalogKinds].sort(),
    'loader schema registry must agree with the canonical catalog',
  );
  checks += 1;

  const valid = {
    ...fixture('all-contracts-valid.json'),
    ...fixture('live-evidence-contracts-valid.json'),
  };
  const invalid = {
    ...fixture('all-contracts-invalid.json'),
    ...Object.fromEntries(
      Object.entries(fixture('live-evidence-contracts-invalid.json')).map(([kind, vectors]) => {
        const vector = vectors.find(
          ({ expectedLayer, operation, path }) =>
            expectedLayer === 'schema' && operation === 'add' && /^\/[^/]+$/u.test(path),
        );
        assert.ok(vector, `${kind}: one top-level hostile schema vector is required`);
        return [kind, { patch: { [vector.path.slice(1)]: vector.value } }];
      }),
    ),
  };
  assert.deepEqual(
    Object.keys(valid).sort(),
    [...catalogKinds].sort(),
    'valid fixture must cover every contract',
  );
  assert.deepEqual(
    Object.keys(invalid).sort(),
    [...catalogKinds].sort(),
    'invalid fixture must cover every contract',
  );
  checks += 2;
  for (const kind of catalogKinds) {
    const contract = loadOperateRuntimeContract(kind, { protocolVersion: first.protocol.version });
    pass(
      contract.path === first.contracts.find(({ id }) => id === kind).schemaPath,
      `${kind}: loader path must equal catalog path`,
    );
    pass(
      validateProtocolArtifact(kind, valid[kind], { protocolVersion: first.protocol.version })
        .length === 0,
      `${kind}: emitted valid fixture must validate`,
    );
    pass(
      validateProtocolArtifact(kind, invalidFromDescriptor(valid[kind], invalid[kind]), {
        protocolVersion: first.protocol.version,
      }).length > 0,
      `${kind}: emitted invalid fixture must fail validation`,
    );
  }

  const validExperience = fixture('experience-bridge-valid.json');
  const invalidExperience = fixture('experience-bridge-invalid.json');
  assert.deepEqual(
    Object.keys(validExperience).sort(),
    [...OPERATE_EXPERIENCE_CONTRACT_KINDS_V2].sort(),
    'experience fixture must cover every public experience contract',
  );
  checks += 1;
  for (const contract of first.experience.contracts) {
    const loaded = loadOperateExperienceContract(contract.id, {
      protocolVersion: first.protocol.version,
    });
    pass(
      loaded.path === contract.schemaPath,
      `${contract.id}: experience loader path must equal catalog path`,
    );
    pass(
      validateOperateExperienceArtifactV2(contract.id, validExperience[contract.id]).length === 0,
      `${contract.id}: valid experience fixture must validate`,
    );
    pass(
      validateOperateExperienceArtifactV2(contract.id, invalidExperience[contract.id]).length > 0,
      `${contract.id}: invalid experience fixture must fail validation`,
    );
  }

  assert.deepEqual(
    OPERATE_ROLE_MANDATES_V2,
    first.roles.map(({ id, version, output, limits }) => ({ id, version, output, limits })),
    'public role mandates must equal the compiler output',
  );
  checks += 1;
  const assignmentEdges = first.transitions
    .filter(({ entityId }) => entityId === 'operating-assignment')
    .map(({ entityId, from, to }) => ({ entityId, from, to }));
  const reviewEdges = first.transitions
    .filter(({ entityId }) => entityId === 'operating-review')
    .map(({ entityId, from, to }) => ({ entityId, from, to }));
  assert.deepEqual(
    assignmentEdges,
    transitionEdges(OPERATING_ASSIGNMENT_TRANSITIONS_V2, 'operating-assignment'),
  );
  assert.deepEqual(
    reviewEdges,
    transitionEdges(OPERATING_REVIEW_TRANSITIONS_V2, 'operating-review'),
  );
  checks += 2;
  assert.deepEqual(
    Object.keys(OPERATE_GUARD_TABLE_V2).sort(),
    first.operations.map(({ id }) => id).sort(),
    'every implemented public operation must have exactly one compiled guard row',
  );
  assert.deepEqual(
    Object.values(OPERATE_GUARD_TABLE_V2)
      .map(({ operation, label }) => ({ operationId: operation, label }))
      .sort((left, right) => left.operationId.localeCompare(right.operationId)),
    first.actions,
    'implemented public action labels must be compiler-owned',
  );
  checks += 2;
  for (const operation of first.operations) {
    pass(
      !/(?:finalize|prepare)/u.test(operation.id),
      `${operation.id}: prohibited lifecycle commands must not be public`,
    );
  }

  const documentation = readFileSync(join(root, registry.generation.documentationPath), 'utf8');
  for (const contract of first.contracts) {
    pass(
      documentation.includes(`\`${contract.id}\``),
      `${contract.id}: documentation must name the contract`,
    );
  }
  for (const contract of first.experience.contracts) {
    pass(
      documentation.includes(`\`${contract.id}\``),
      `${contract.id}: documentation must name the experience contract`,
    );
  }
  // Derived from package.json, never repeated: a second list of subpaths is a second authority,
  // and the two drift silently. The protocol document's export table is checked against the same
  // source below for the same reason.
  const declaredExports = json('package.json').exports;
  const operateSubpaths = Object.keys(declaredExports)
    .filter((subpath) => subpath.startsWith('./operate/'))
    .sort();
  pass(operateSubpaths.length > 0, 'package.json must declare operate subpath exports');
  for (const subpath of operateSubpaths) {
    const target = declaredExports[subpath];
    pass(
      typeof target?.import === 'string' && typeof target?.types === 'string',
      `${subpath}: package export must declare runtime and types`,
    );
    pass(
      existsSync(join(root, target.import)) && existsSync(join(root, target.types)),
      `${subpath}: declared export targets must exist`,
    );
    pass(
      documentation.includes(`\`planr-pipeline${subpath.slice(1)}\``),
      `${subpath}: protocol documentation must list the declared export`,
    );
  }
  const documentedSubpaths = [
    ...documentation.matchAll(/`planr-pipeline(\/operate\/[a-z0-9-]+)`/gu),
  ].map(([, path]) => `.${path}`);
  for (const subpath of new Set(documentedSubpaths)) {
    pass(
      operateSubpaths.includes(subpath),
      `${subpath}: protocol documentation lists an export package.json does not declare`,
    );
  }

  const driftTargets = [
    registry.generation.catalogPath,
    ...first.generation.verifiedTargets.map(({ path }) => path),
  ];
  if (sourceTargetsAvailable) {
    for (const target of driftTargets) {
      const project = temporaryProject(registry);
      const path = join(project, target);
      writeFileSync(
        path,
        `${readFileSync(path, 'utf8')}\n/* deliberate contract drift */\n`,
        'utf8',
      );
      assert.throws(
        () => runOperateContractGenerator({ argv: ['--check'], projectRoot: project }),
        (error) =>
          error?.code === 'E_OPERATE_CONTRACT_DRIFT' &&
          error?.details?.staleTargets?.includes(target),
        `${target}: deliberate drift must fail check mode`,
      );
      checks += 1;
    }
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      protocolVersion: first.protocol.version,
      contracts: catalogKinds.length,
      sourceTargetsVerified: sourceTargetsAvailable,
      verifiedSurfaces: sourceTargetsAvailable ? driftTargets.length : 0,
      checks,
    })}\n`,
  );
} finally {
  for (const path of temporaryRoots) rmSync(path, { recursive: true, force: true });
}
