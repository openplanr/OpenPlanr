import assert from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  OPERATE_ROLE_MANDATES_V2,
  OPERATE_RUNTIME_CONTRACT_KINDS,
  assertOperateRoleOutputContract,
  loadOperateRoleMandate,
} from 'planr-pipeline/protocol';
import { evaluateOperateGuardV2 } from 'planr-pipeline/operate/runtime-v2';
import { OPERATE_CONTRACT_CATALOG_V2 } from '../../lib/protocol/generated/contract-catalog-v2.mjs';
import { runOperateContractGenerator } from '../../scripts/generate-operate-contracts.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(
  new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
  'utf8',
));
const temporaryRoots = [];
const clone = (value) => structuredClone(value);

after(() => {
  for (const path of temporaryRoots) rmSync(path, { recursive: true, force: true });
});

function temporaryProject() {
  const project = mkdtempSync(join(tmpdir(), 'planr-operate-contract-drift-'));
  temporaryRoots.push(project);
  const registry = fixtureRegistry();
  const targets = [
    'registry/operate-v2-contracts.json',
    registry.generation.catalogPath,
    ...registry.generation.verifiedTargets.map(({ path }) => path),
  ];
  for (const target of targets) {
    const destination = join(project, target);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(root, target), destination, { recursive: true });
  }
  return project;
}

function fixtureRegistry() {
  return JSON.parse(readFileSync(join(root, 'registry/operate-v2-contracts.json'), 'utf8'));
}

function runningAssignment(mandate) {
  const roleId = {
    advisor: 'strategy-finance',
    challenger: 'independent-challenge',
    chair: 'chair',
  }[mandate.id];
  const role = OPERATE_CONTRACT_CATALOG_V2.extensions.domains
    .find(({ domainId }) => domainId === 'business')
    .roles.find((candidate) => candidate.roleId === roleId);
  const assignment = clone(fixture('all-contracts-valid.json')['operating-assignment']);
  assignment.assignmentKind = mandate.id;
  assignment.roleId = role.roleId;
  assignment.roleVersion = role.roleVersion;
  assignment.analysisProfile = clone(role.analysisProfile);
  assignment.evidenceRequirements = clone(role.evidenceRequirements);
  assignment.resultRequirements = clone(role.resultRequirements);
  assignment.analysisRubric = clone(role.analysisRubric);
  assignment.mandate = clone(role.mandate);
  assignment.state = 'running';
  assignment.claim = { actorId: 'agent-001', actorKind: 'agent', runtime: 'runtime-001', claimId: 'claim-001' };
  assignment.attemptPolicy.attempt = 1;
  assignment.outputContract = { ...mandate.output, encoding: 'utf-8' };
  assignment.capabilityGrantId = 'grant-contract-drift-001';
  assignment.governedOperationId = null;
  assignment.inputArtifactIds = ['art_contract_bundle_001'];
  assignment.intelligenceContext = {
    intelligencePlanId: 'ipl_00000001', snapshotId: 'snp_00000001',
    scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0',
    sourceArtifactId: 'art_00000002', sourceArtifactIds: ['art_00000002'],
    evidenceRefIds: ['evr_00000001'],
    inputBundle: {
      bundleId: `ibd_contract_${mandate.id}_001`,
      bundleArtifactId: 'art_contract_bundle_001',
      bundleRawHash: `sha256:${'a'.repeat(64)}`,
      bundleCanonicalHash: `sha256:${'b'.repeat(64)}`,
      sourceArtifactIds: ['art_00000002'],
      issuedEvidence: [],
    },
    decisionOwnerActorId: 'owner-contract-drift-001',
  };
  return assignment;
}

function validRoleResult(mandate, assignment) {
  const contracts = fixture('all-contracts-valid.json');
  return {
    ...clone(contracts[mandate.output.schemaId]),
    assignmentId: assignment.assignmentId,
    roleId: assignment.roleId,
    roleVersion: assignment.roleVersion,
    analysisProfile: clone(assignment.analysisProfile),
  };
}

function issuedSubmission() {
  const submission = clone(fixture('all-contracts-valid.json')['operating-submission']);
  submission.state = 'issued';
  submission.rawHash = null;
  submission.canonicalHash = null;
  submission.sizeBytes = null;
  submission.artifactId = null;
  submission.acceptanceEventIds = [];
  submission.responseData = null;
  submission.resolvedAt = null;
  return submission;
}

test('every compiler-owned mandate advertises the exact schema/version/limits that submit receives', () => {
  const expected = fixture('generated-contract-catalog-valid.json');
  assert.deepEqual(OPERATE_ROLE_MANDATES_V2, expected.roles);

  for (const mandate of OPERATE_ROLE_MANDATES_V2) {
    const advertised = loadOperateRoleMandate(mandate.id, { roleVersion: mandate.version });
    assert.deepEqual(advertised, mandate, `${mandate.id}: exact mandate`);
    assert.deepEqual(
      assertOperateRoleOutputContract(mandate.id, advertised.output, { roleVersion: mandate.version }),
      { ...advertised.output, path: `schemas/v2.0.0/${advertised.output.schemaId}.schema.json` },
      `${mandate.id}: exact output template`,
    );

    const assignment = runningAssignment(advertised);
    const submission = issuedSubmission();
    const actor = { actorId: 'agent-001', kind: 'agent', runtime: 'runtime-001' };
    const permitted = evaluateOperateGuardV2('operate.assignment.submit', {
      capabilities: ['operate.assignment.submit'],
      actor,
      assignment,
      submission,
      submitRequest: {
        assignmentId: assignment.assignmentId,
        submissionId: submission.submissionId,
        actor,
        mediaType: advertised.output.mediaType,
        encoding: 'utf-8',
        contentBase64: Buffer.from(JSON.stringify(validRoleResult(advertised, assignment)), 'utf8').toString('base64'),
      },
    });
    assert.equal(permitted.allowed, true, `${mandate.id}: disclosed contract is submit-valid`);

    const tooLarge = Buffer.alloc(advertised.output.maxBytes + 1).toString('base64');
    const denied = evaluateOperateGuardV2('operate.assignment.submit', {
      capabilities: ['operate.assignment.submit'], actor, assignment, submission,
      submitRequest: {
        assignmentId: assignment.assignmentId,
        submissionId: submission.submissionId,
        actor,
        mediaType: advertised.output.mediaType,
        encoding: 'utf-8',
        contentBase64: tooLarge,
      },
    });
    assert.equal(denied.error?.code, 'RESULT_CONTRACT_INVALID', `${mandate.id}: exact maxBytes enforced`);
  }
});

test('role mandates reject missing, unknown, mixed, and altered output identities', () => {
  const invalid = fixture('generated-contract-catalog-invalid.json');
  assert.throws(
    () => loadOperateRoleMandate(invalid.missingRoleVersion.roleId),
    { code: 'E_SCHEMA_VERSION_REQUIRED' },
  );
  assert.throws(
    () => loadOperateRoleMandate(invalid.unknownRole.roleId, { roleVersion: invalid.unknownRole.roleVersion }),
    { code: 'E_SCHEMA_VERSION_UNSUPPORTED' },
  );
  for (const descriptor of [invalid.mixedOutputVersion, invalid.changedMaximum]) {
    assert.throws(
      () => assertOperateRoleOutputContract(descriptor.roleId, descriptor.output, {
        roleVersion: descriptor.roleVersion,
      }),
      { code: 'E_PROTOCOL_ARTIFACT_INVALID' },
    );
  }
});

test('protocol digest custody excludes package manifests and executable test harnesses', () => {
  const registry = fixtureRegistry();
  for (const { path, kind } of registry.generation.verifiedTargets) {
    assert.notEqual(path, 'package.json');
    assert.doesNotMatch(path, /(?:^|\/)(?:tests?|fixtures)(?:\/|$)/u, path);
    assert.doesNotMatch(path, /^conformance\//u, path);
    assert.notEqual(kind, 'conformance');
  }

  const inventory = JSON.parse(readFileSync(
    join(root, registry.generation.packageInventoryPath),
    'utf8',
  ));
  assert.ok(inventory.files.includes('package.json'));
  assert.ok(inventory.files.includes(registry.generation.catalogPath));
});

test('the contract check detects every durable commitment category independently', () => {
  const registry = fixtureRegistry();
  const representative = [
    registry.generation.catalogPath,
    ...Object.values(Object.groupBy(registry.generation.verifiedTargets, ({ kind }) => kind))
      .map(([target]) => target.path),
  ];
  for (const target of representative) {
    const project = temporaryProject();
    const file = join(project, target);
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n// drift\n`);
    assert.throws(
      () => runOperateContractGenerator({ argv: ['--check'], projectRoot: project }),
      (error) => error?.code === 'E_OPERATE_CONTRACT_DRIFT' && error?.details?.staleTargets?.includes(target),
      target,
    );
  }
});

test('the public declaration retains one cycle domainVersion and required artifact domainVersion', () => {
  const declaration = readFileSync(join(root, 'lib/protocol/index.d.ts'), 'utf8');
  const cycle = declaration.match(/export interface OperatingCycleV2 \{([\s\S]*?)\n\}/u)?.[1] ?? '';
  const artifact = declaration.match(/export interface OperatingArtifactV2 \{([\s\S]*?)\n\}/u)?.[1] ?? '';
  assert.equal((cycle.match(/^  domainVersion: string;$/gmu) ?? []).length, 1);
  assert.equal((artifact.match(/^  domainVersion: string;$/gmu) ?? []).length, 1);
});

test('Phase 3 persistent-work identities remain compiler-owned and complete', () => {
  const registry = fixtureRegistry();
  const persistentWork = [
    'operating-finding',
    'operating-decision',
    'operating-action',
    'operating-work-change-set',
    'operating-work-ledger',
  ];
  assert.equal(registry.contracts.length, OPERATE_RUNTIME_CONTRACT_KINDS.length);
  assert.deepEqual(registry.persistentWorkContractIds, persistentWork);
  assert.deepEqual(
    OPERATE_RUNTIME_CONTRACT_KINDS.filter((id) => persistentWork.includes(id)),
    persistentWork,
  );
  for (const id of persistentWork) {
    const contract = registry.contracts.find((candidate) => candidate.id === id);
    assert.equal(contract?.version, '2.0.0', id);
    assert.equal(contract?.schemaPath, `schemas/v2.0.0/${id}.schema.json`, id);
  }
});

test('Phase 6 governed extension registrations and public package entry points are compiler-owned and exact', () => {
  const registry = fixtureRegistry();
  assert.deepEqual(OPERATE_CONTRACT_CATALOG_V2.extensions.executors.map(({ executorId }) => executorId), [
    'open-reference-containment-executor',
    'open-reference-project-executor',
  ]);
  assert.equal(OPERATE_CONTRACT_CATALOG_V2.extensions.capabilityProviders.length, 1);
  assert.equal(OPERATE_CONTRACT_CATALOG_V2.extensions.policyProviders.length, 1);
  assert.deepEqual(
    registry.extensions.executors.map(({ executorId }) => executorId).sort(),
    OPERATE_CONTRACT_CATALOG_V2.extensions.executors.map(({ executorId }) => executorId).sort(),
  );
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const path of ['./operate/governed-extensions-v2', './operate/reference-governed-executors-v2']) {
    assert.match(packageManifest.exports[path].import, /^\.\/lib\/operate\/[a-z0-9-]+\.mjs$/u, path);
    assert.match(packageManifest.exports[path].types, /^\.\/lib\/operate\/[a-z0-9-]+\.d\.mts$/u, path);
  }
});
