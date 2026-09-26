import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  assertOperateIntelligencePlanContractV2,
  assertOperateRuntimeBindingsV2,
  assertProtocolArtifact,
  listProtocolSchemas,
  loadOperateExperienceContract,
  loadOperateExtensionContract,
  loadOperateRuntimeContract,
  OPERATE_EVIDENCE_CONTRACT_KINDS_V2,
  OPERATE_EXPERIENCE_CONTRACT_KINDS_V2,
  OPERATE_EXTENSION_CONTRACT_KINDS_V2,
  OPERATE_OPERATING_INTELLIGENCE_CONTRACT_KINDS_V2,
  OPERATE_OPERATING_PROJECTION_IDENTITIES_V2,
  OPERATE_PUBLIC_DOMAIN_CONTRACT_BINDINGS_V2,
  OPERATE_ROLE_MANDATES_V2,
  OPERATE_RUNTIME_CONTRACT_KINDS,
  OPERATE_RUNTIME_PROTOCOL_VERSION,
  readOperatingRuntimeStateV2,
  validateProtocolArtifact,
} from 'planr-pipeline/protocol';
import { validateJson } from '../../conformance/json-schema-validate.mjs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const clone = (value) => structuredClone(value);
const digest = (character) => `sha256:${character.repeat(64)}`;
const liveEvidenceValid = fixture('live-evidence-contracts-valid.json');
const valid = {
  ...fixture('all-contracts-valid.json'),
  ...liveEvidenceValid,
};
const businessRoles = fixture('business-domain-valid.json').roles;

function registeredIntelligenceRole(roleKind) {
  const roleId = {
    advisor: 'strategy-finance',
    challenger: 'independent-challenge',
    chair: 'chair',
  }[roleKind];
  return businessRoles.find((role) => role.roleId === roleId);
}

function intelligenceAssignment(base, assignmentKind, outputContract) {
  const role = registeredIntelligenceRole(assignmentKind);
  const bundleArtifactId = `art_bundle_${assignmentKind}_schema_001`;
  return {
    ...clone(base),
    assignmentKind,
    roleId: role.roleId,
    roleVersion: role.roleVersion,
    analysisRubric: clone(role.analysisRubric),
    analysisProfile: clone(role.analysisProfile),
    evidenceRequirements: clone(role.evidenceRequirements),
    resultRequirements: clone(role.resultRequirements),
    mandate: clone(role.mandate),
    governedOperationId: null,
    inputArtifactIds: [bundleArtifactId],
    intelligenceContext: {
      intelligencePlanId: 'ipl_00000001',
      snapshotId: 'snp_00000001',
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
      sourceArtifactId: 'art_00000001',
      sourceArtifactIds: ['art_00000001'],
      evidenceRefIds: [],
      inputBundle: {
        bundleId: `ibd_${assignmentKind}_schema_001`,
        bundleArtifactId,
        bundleRawHash: digest('a'),
        bundleCanonicalHash: digest('b'),
        sourceArtifactIds: ['art_00000001'],
        issuedEvidence: [],
      },
      decisionOwnerActorId: 'owner-intelligence-contract-001',
    },
    outputContract: clone(outputContract),
  };
}

function setPath(value, path, next) {
  const parts = path.split('.');
  const leaf = parts.pop();
  const parent = parts.reduce((current, part) => current[part], value);
  parent[leaf] = next;
}

function invalidFromDescriptor(base, descriptor) {
  const value = clone(base);
  if (descriptor.patch) Object.assign(value, descriptor.patch);
  if (descriptor.patchError) Object.assign(value.error, descriptor.patchError);
  return value;
}

test('Protocol 2.0 schema inventory is the exact union of the runtime kernel and experience contracts', () => {
  const files = readdirSync(new URL('../../schemas/v2.0.0', import.meta.url))
    .filter((name) => name.endsWith('.schema.json'))
    .sort();
  const registered = listProtocolSchemas()
    .filter(({ protocolVersion }) => protocolVersion === '2.0.0')
    .map(({ path }) => path.split('/').at(-1))
    .sort();
  const experienceFiles = OPERATE_EXPERIENCE_CONTRACT_KINDS_V2.map((kind) =>
    loadOperateExperienceContract(kind, { protocolVersion: '2.0.0' }).path.split('/').at(-1),
  ).sort();

  assert.equal(OPERATE_RUNTIME_PROTOCOL_VERSION, '2.0.0');
  assert.equal(OPERATE_RUNTIME_CONTRACT_KINDS.length, registered.length);
  assert.equal(new Set(OPERATE_RUNTIME_CONTRACT_KINDS).size, OPERATE_RUNTIME_CONTRACT_KINDS.length);
  assert.equal(OPERATE_EXPERIENCE_CONTRACT_KINDS_V2.length, 9);
  const publicSchemaFiles = new Set([...registered, ...experienceFiles]);
  assert.equal(publicSchemaFiles.size, registered.length + experienceFiles.length);
  assert.deepEqual([...registered, ...experienceFiles].sort(), files);
  assert.equal(files.length, publicSchemaFiles.size);
  for (const kind of OPERATE_RUNTIME_CONTRACT_KINDS) {
    const contract = loadOperateRuntimeContract(kind, { protocolVersion: '2.0.0' });
    assert.equal(contract.protocolVersion, '2.0.0');
    assert.equal(contract.schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(contract.schema['x-openplanr-contract'].id, kind);
  }
  for (const kind of OPERATE_EXPERIENCE_CONTRACT_KINDS_V2) {
    const contract = loadOperateExperienceContract(kind, { protocolVersion: '2.0.0' });
    assert.equal(contract.protocolVersion, '2.0.0');
    assert.equal(contract.schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(contract.schema['x-openplanr-contract'].id, kind);
  }
  assert.deepEqual(
    OPERATE_ROLE_MANDATES_V2.map(({ id }) => id),
    ['advisor', 'chair', 'challenger'],
  );
  assert.deepEqual(OPERATE_EXTENSION_CONTRACT_KINDS_V2, [
    'agent-runtime-manifest',
    'operate-capability-provider-registration',
    'operate-domain-registration',
    'operate-evidence-provider-registration',
    'operate-evidence-resolver-registration',
    'operate-executor-registration',
    'operate-live-evidence-provider-registration',
    'operate-live-evidence-provider-registry',
    'operate-metric-provider-registration',
    'operate-policy-provider-registration',
    'operate-snapshot-provider-registration',
    'operate-verification-provider-registration',
  ]);
  for (const kind of OPERATE_EXTENSION_CONTRACT_KINDS_V2) {
    assert.equal(loadOperateExtensionContract(kind, { protocolVersion: '2.0.0' }).kind, kind);
  }
  assert.deepEqual(OPERATE_EVIDENCE_CONTRACT_KINDS_V2, [
    'operate-evidence-provider-registration',
    'operate-evidence-resolver-registration',
    'operating-evidence-candidate',
    'operating-evidence-edge',
    'operating-evidence-graph',
    'operating-evidence-ref',
    'operating-evidence-resolution',
  ]);
  assert.equal(OPERATE_OPERATING_INTELLIGENCE_CONTRACT_KINDS_V2.length, 25);
  assert.deepEqual(OPERATE_OPERATING_PROJECTION_IDENTITIES_V2, [
    'business-operating-snapshot-projection@1.0.0',
    'software-operating-snapshot-projection@1.0.0',
  ]);
  assert.deepEqual(OPERATE_PUBLIC_DOMAIN_CONTRACT_BINDINGS_V2, {
    business: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
    software: { apiDomainId: 'software', id: 'software-domain', version: '1.0.0' },
  });
});

test('every current runtime schema has valid and invalid conformance examples', () => {
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
  assert.deepEqual(Object.keys(valid).sort(), [...OPERATE_RUNTIME_CONTRACT_KINDS].sort());
  assert.deepEqual(Object.keys(invalid).sort(), [...OPERATE_RUNTIME_CONTRACT_KINDS].sort());

  for (const kind of OPERATE_RUNTIME_CONTRACT_KINDS) {
    assert.deepEqual(
      validateProtocolArtifact(kind, valid[kind], { protocolVersion: '2.0.0' }),
      [],
      `${kind} valid fixture`,
    );
    assert.ok(
      validateProtocolArtifact(kind, invalidFromDescriptor(valid[kind], invalid[kind]), {
        protocolVersion: '2.0.0',
      }).length > 0,
      `${kind} invalid fixture`,
    );
  }
});

test('owner Review gap summaries retain closed role and evidence identities', () => {
  const gaps = [
    {
      absenceId: 'abs_role_review_gap_001',
      kind: 'role',
      roleId: 'Growth Market / EU',
      roleKind: 'advisor',
      roleVersion: '2.0.0',
      sourceAssignmentId: 'asg_review_gap_role_001',
      reason: 'The issued growth Advisor did not produce a validated result.',
      recoveryDisposition: 'Continue with qualified analysis.',
    },
    {
      absenceId: 'abs_evidence_review_gap_001',
      kind: 'evidence',
      requirementId: 'channel-economics',
      sourceContracts: [{ id: 'channel-economics', version: '1.0.0' }],
      reason: 'No authorized channel-economics evidence was available.',
      recoveryDisposition: 'Request authorized evidence.',
    },
  ];
  const sourceLedger = clone(valid['operating-decision-ledger']);
  sourceLedger.advisorAbsenceGaps = [
    {
      ...gaps[0],
      absenceCode: 'result-unavailable',
      sourceEventId: null,
    },
  ];
  sourceLedger.evidenceGaps = [
    {
      ...gaps[1],
      evidenceKinds: ['operate-artifact'],
      absenceCode: 'not-available',
      sourceEvidenceRefIds: [],
      sourceEventIds: [],
    },
  ];
  assert.deepEqual(
    validateProtocolArtifact('operating-decision-ledger', sourceLedger, {
      protocolVersion: '2.0.0',
    }),
    [],
    'the exact source absence bytes are valid before Review projection',
  );
  const read = { ...clone(valid['operating-review-read']), gaps };
  assert.deepEqual(
    validateProtocolArtifact('operating-review-read', read, {
      protocolVersion: '2.0.0',
    }),
    [],
  );

  const receipt = {
    ...clone(valid['operating-review-receipt']),
    gaps,
    summary: { ...valid['operating-review-receipt'].summary, gapCount: gaps.length },
  };
  assert.deepEqual(
    validateProtocolArtifact('operating-review-receipt', receipt, {
      protocolVersion: '2.0.0',
    }),
    [],
  );

  const missingRoleIdentity = clone(read);
  delete missingRoleIdentity.gaps[0].sourceAssignmentId;
  assert.ok(
    validateProtocolArtifact('operating-review-read', missingRoleIdentity, {
      protocolVersion: '2.0.0',
    }).length,
    'role gaps require their source Assignment identity, including explicit null',
  );

  const missingEvidenceContract = clone(read);
  missingEvidenceContract.gaps[1].sourceContracts = [];
  assert.ok(
    validateProtocolArtifact('operating-review-read', missingEvidenceContract, {
      protocolVersion: '2.0.0',
    }).length,
    'evidence gaps require at least one durable requested source contract',
  );

  const privatePath = clone(receipt);
  privatePath.gaps[1].privatePath = '.planr/operate/state/private.json';
  assert.ok(
    validateProtocolArtifact('operating-review-receipt', privatePath, {
      protocolVersion: '2.0.0',
    }).length,
    'Review gaps remain closed and cannot expose private runtime paths',
  );
});

test('Assignment preserves certified Phase 5 grants while governed work requires exact cgr identities', () => {
  const assignment = clone(valid['operating-assignment']);
  delete assignment.roleVersion;
  Object.assign(assignment, {
    assignmentKind: 'context-capture',
    roleId: 'context-evidence',
    mandate: null,
    analysisRubric: null,
    intelligenceContext: null,
    governedOperationId: null,
    outputContract: {
      schemaId: 'operating-context-capture',
      schemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 262144,
    },
  });
  for (const capabilityGrantId of [
    'grant-001',
    'grant-asg_00000001',
    `ceiling_${'a'.repeat(24)}`,
  ]) {
    assert.deepEqual(
      validateProtocolArtifact(
        'operating-assignment',
        {
          ...assignment,
          capabilityGrantId,
        },
        { protocolVersion: '2.0.0' },
      ),
      [],
      capabilityGrantId,
    );
  }

  const governed = {
    ...assignment,
    assignmentKind: 'execution',
    roleId: 'executor',
    capabilityGrantId: 'cgr_00000001',
    governedOperationId: 'op_00000001',
  };
  assert.deepEqual(
    validateProtocolArtifact('operating-assignment', governed, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  assert.ok(
    validateProtocolArtifact(
      'operating-assignment',
      {
        ...governed,
        capabilityGrantId: 'grant-asg_00000001',
      },
      { protocolVersion: '2.0.0' },
    ).length,
    'execution work cannot reuse a Phase 5 grant identity',
  );

  for (const capabilityGrantId of [
    'cgr_short',
    'cgr-00000001',
    'ceiling_not-a-24-hex-token',
    'grant-_hidden',
    'grant-asg/escape',
    '../grant-asg_00000001',
  ]) {
    assert.ok(
      validateProtocolArtifact(
        'operating-assignment',
        {
          ...assignment,
          capabilityGrantId,
        },
        { protocolVersion: '2.0.0' },
      ).length,
      capabilityGrantId,
    );
  }
});

test('context capture is a truthful non-intelligence Assignment with one exact result contract', () => {
  const assignment = clone(valid['operating-assignment']);
  delete assignment.roleVersion;
  Object.assign(assignment, {
    assignmentKind: 'context-capture',
    roleId: 'context-evidence',
    mandate: null,
    analysisRubric: null,
    intelligenceContext: null,
    governedOperationId: null,
    outputContract: {
      schemaId: 'operating-context-capture',
      schemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 262144,
    },
  });
  assert.deepEqual(
    validateProtocolArtifact('operating-assignment', assignment, {
      protocolVersion: '2.0.0',
    }),
    [],
  );

  for (const patch of [
    { roleVersion: '2.0.0' },
    { mandate: clone(valid['operating-assignment'].mandate) },
    { intelligenceContext: {} },
    { outputContract: { ...assignment.outputContract, schemaId: 'operating-advisor-result' } },
  ]) {
    assert.ok(
      validateProtocolArtifact(
        'operating-assignment',
        {
          ...assignment,
          ...patch,
        },
        { protocolVersion: '2.0.0' },
      ).length > 0,
      JSON.stringify(patch),
    );
  }

  const evidenceCapture = clone(valid['operating-context-capture']);
  assert.deepEqual(
    validateProtocolArtifact('operating-context-capture', evidenceCapture, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  const manifestCapture = {
    ...evidenceCapture,
    contextKind: 'cycle-manifest',
    evidenceCandidates: [clone(valid['operating-evidence-candidate'])],
    evidenceClaimLinks: [
      {
        sourceArtifactId: 'art_00000001',
        localClaimId: 'claim-001',
        relation: 'supportedBy',
        confidence: 0.8,
      },
    ],
  };
  delete manifestCapture.focus;
  delete manifestCapture.trigger;
  assert.deepEqual(
    validateProtocolArtifact('operating-context-capture', manifestCapture, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  assert.ok(
    validateProtocolArtifact(
      'operating-context-capture',
      {
        ...manifestCapture,
        focus: ['forbidden-cross-variant-field'],
      },
      { protocolVersion: '2.0.0' },
    ).length > 0,
  );
});

test('each intelligence role kind accepts only its own exact output contract', () => {
  const base = clone(valid['operating-assignment']);
  const outputContracts = {
    advisor: {
      schemaId: 'operating-advisor-result',
      schemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 262144,
    },
    challenger: {
      schemaId: 'operating-challenger-review',
      schemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 262144,
    },
    chair: {
      schemaId: 'operating-decision-ledger',
      schemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 262144,
    },
  };
  for (const assignmentKind of ['advisor', 'challenger', 'chair']) {
    const assignment = intelligenceAssignment(
      base,
      assignmentKind,
      outputContracts[assignmentKind],
    );
    assert.deepEqual(
      validateProtocolArtifact('operating-assignment', assignment, {
        protocolVersion: '2.0.0',
      }),
      [],
      `${assignmentKind} baseline`,
    );
    for (const foreignKind of ['advisor', 'challenger', 'chair'].filter(
      (kind) => kind !== assignmentKind,
    )) {
      assert.ok(
        validateProtocolArtifact(
          'operating-assignment',
          {
            ...assignment,
            outputContract: clone(outputContracts[foreignKind]),
          },
          { protocolVersion: '2.0.0' },
        ).length > 0,
        `${assignmentKind} cannot advertise ${foreignKind}`,
      );
    }
  }
  for (const [assignmentKind, schemaId] of [
    ['advisor', 'advisor-result'],
    ['challenger', 'challenger-review'],
  ]) {
    assert.ok(
      validateProtocolArtifact(
        'operating-assignment',
        {
          ...intelligenceAssignment(base, assignmentKind, outputContracts[assignmentKind]),
          outputContract: {
            ...base.outputContract,
            schemaId,
            schemaVersion: '1.0.0',
          },
        },
        { protocolVersion: '2.0.0' },
      ).length > 0,
      `${schemaId}@1.0.0 is not an issuable intelligence contract`,
    );
  }
});

test('bounded Action verification fixtures retain typed measurement and reject Assignment coercion', () => {
  const verification = fixture('action-verification-valid.json');
  for (const [kind, record] of [
    ['operating-action', verification.action],
    ['operating-action-verification-plan', verification.verificationPlan],
    ['operating-outcome', verification.outcome],
    ['operating-learning', verification.learning],
  ]) {
    assert.deepEqual(
      validateProtocolArtifact(kind, record, { protocolVersion: '2.0.0' }),
      [],
      kind,
    );
  }
  assert.ok(
    validateProtocolArtifact(
      'operating-action',
      fixture('action-verification-invalid.json').action,
      {
        protocolVersion: '2.0.0',
      },
    ).length > 0,
    'an Action cannot carry an Assignment identity',
  );
  for (const forbiddenField of [
    'assignmentId',
    'operationId',
    'capability',
    'approval',
    'policy',
  ]) {
    assert.equal(Object.hasOwn(verification.action, forbiddenField), false, forbiddenField);
  }
});

test('a Chair Action hypothesis requires explicit dependencies and a verification method', () => {
  const ledger = fixture('decision-ledger-valid.json');
  assert.deepEqual(
    validateProtocolArtifact('operating-decision-ledger', ledger, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  for (const field of ['dependsOnActionHypothesisIds', 'verificationMethod']) {
    const missing = clone(ledger);
    delete missing.decisions[0].actionHypotheses[0][field];
    assert.ok(
      validateProtocolArtifact('operating-decision-ledger', missing, {
        protocolVersion: '2.0.0',
      }).length > 0,
      field,
    );
  }
});

test('Risk and Assumption revision lineage is schema-required, including a nullable initial predecessor', () => {
  for (const [kind, fields] of [
    ['operating-risk', ['revisionId', 'revision', 'predecessorRevisionId']],
    ['operating-assumption', ['revisionId', 'revision', 'predecessorRevisionId']],
  ]) {
    for (const field of fields) {
      const missing = clone(valid[kind]);
      delete missing[field];
      assert.ok(
        validateProtocolArtifact(kind, missing, { protocolVersion: '2.0.0' }).length > 0,
        `${kind}.${field} is required`,
      );
    }
    assert.deepEqual(
      validateProtocolArtifact(
        kind,
        { ...clone(valid[kind]), predecessorRevisionId: null },
        {
          protocolVersion: '2.0.0',
        },
      ),
      [],
      `${kind} revision one permits its explicit null predecessor`,
    );
  }
});

test('evidence registry declarations validate as exact public extension contracts', () => {
  const evidenceRegistry = fixture('evidence-registry-valid.json');
  for (const registration of evidenceRegistry.providers) {
    assert.deepEqual(
      validateProtocolArtifact('operate-evidence-provider-registration', registration, {
        protocolVersion: '2.0.0',
      }),
      [],
    );
  }
  for (const registration of evidenceRegistry.resolvers) {
    assert.deepEqual(
      validateProtocolArtifact('operate-evidence-resolver-registration', registration, {
        protocolVersion: '2.0.0',
      }),
      [],
    );
  }
});

test('public domain fixtures retain explicit API bindings and reject mismatched public projections', () => {
  assert.deepEqual(
    validateProtocolArtifact('operate-domain-registration', fixture('business-domain-valid.json'), {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  assert.deepEqual(
    validateProtocolArtifact('operate-domain-registration', fixture('software-domain-valid.json'), {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  assert.ok(
    validateProtocolArtifact(
      'operate-domain-registration',
      fixture('operating-domain-invalid.json'),
      {
        protocolVersion: '2.0.0',
      },
    ).length > 0,
  );
});

test('the public plan helper accepts only an exact Protocol 2.0 intelligence plan', () => {
  const plan = fixture('intelligence-plan-valid.json');
  assert.equal(assertOperateIntelligencePlanContractV2(plan), plan);
  assert.throws(
    () => assertOperateIntelligencePlanContractV2(fixture('intelligence-plan-invalid.json')),
    {
      code: 'E_PROTOCOL_ARTIFACT_INVALID',
    },
  );
  const topologyBypass = clone(plan);
  topologyBypass.selectedRoles.find(({ roleId }) => roleId === 'chair').dependsOnRoleIds = [
    'advisor',
  ];
  assert.deepEqual(
    validateProtocolArtifact('operating-intelligence-plan', topologyBypass, {
      protocolVersion: '2.0.0',
    }),
    [],
    'the structural schema deliberately leaves topology to the semantic protocol helper',
  );
  assert.throws(() => assertOperateIntelligencePlanContractV2(topologyBypass), {
    code: 'E_PROTOCOL_ARTIFACT_INVALID',
  });
});

test('Planr and Operate Artifact resolver fixtures retain explicit v2 candidate and accepted Artifact identities', () => {
  const planr = fixture('evidence-planr-valid.json');
  const artifact = fixture('evidence-artifact-valid.json');
  assert.deepEqual(
    validateProtocolArtifact('operating-evidence-candidate', planr.candidate, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  assert.deepEqual(
    validateProtocolArtifact('operating-evidence-candidate', artifact.candidate, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  assert.deepEqual(
    validateProtocolArtifact('operating-artifact', artifact.acceptedArtifact.artifact, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
});

test('schema-valued additionalProperties rejects non-string contract versions', () => {
  assert.deepEqual(
    validateJson(
      { advisor: '1.0.0' },
      { type: 'object', additionalProperties: { type: 'string' } },
    ),
    [],
  );
  assert.deepEqual(
    validateJson({ advisor: 2 }, { type: 'object', additionalProperties: { type: 'string' } }),
    [{ path: '$.advisor', rule: 'type', detail: 'expected string, got integer' }],
  );

  assert.ok(
    validateProtocolArtifact(
      'operating-cycle',
      {
        ...valid['operating-cycle'],
        contractVersions: { 'advisor-result': 2 },
      },
      { protocolVersion: '2.0.0' },
    ).some(({ path }) => path === '$.contractVersions.advisor-result'),
  );
  assert.ok(
    validateProtocolArtifact(
      'operating-event',
      {
        ...valid['operating-event'],
        payload: { ...valid['operating-event'].payload, contractVersions: { 'advisor-result': 2 } },
      },
      { protocolVersion: '2.0.0' },
    ).length,
  );
});

test('public value budgets are exact and every named deferred value fails through the package loader', () => {
  const publicSubset = fixture('phase1-public-subset-valid.json');
  assert.equal(publicSubset.cycleStates.length, 8);
  assert.equal(publicSubset.assignmentKinds.length, 3);
  assert.equal(publicSubset.assignmentStates.length, 9);
  assert.equal(publicSubset.triggers.length, 1);
  assert.equal(publicSubset.toolNames.length, 6);
  assert.equal(publicSubset.effects.length, 3);
  assert.equal(publicSubset.errorCodes.length, 14);

  for (const state of publicSubset.cycleStates) {
    assert.deepEqual(
      validateProtocolArtifact(
        'operating-cycle',
        {
          ...valid['operating-cycle'],
          state,
        },
        { protocolVersion: '2.0.0' },
      ),
      [],
    );
  }
  for (const assignmentKind of publicSubset.assignmentKinds) {
    const outputSchemaId = {
      advisor: 'operating-advisor-result',
      challenger: 'operating-challenger-review',
      chair: 'operating-decision-ledger',
    }[assignmentKind];
    const outputContract = {
      ...valid['operating-assignment'].outputContract,
      schemaId: outputSchemaId,
      schemaVersion: '2.0.0',
      maxBytes: 262144,
    };
    assert.deepEqual(
      validateProtocolArtifact(
        'operating-assignment',
        intelligenceAssignment(valid['operating-assignment'], assignmentKind, outputContract),
        { protocolVersion: '2.0.0' },
      ),
      [],
    );
  }

  for (const state of fixture('deferred-cycle-states-invalid.json').states) {
    const errors = validateProtocolArtifact(
      'operating-cycle',
      {
        ...valid['operating-cycle'],
        state,
      },
      { protocolVersion: '2.0.0' },
    );
    if (['challenging', 'approved', 'executing', 'verifying'].includes(state))
      assert.deepEqual(errors, [], state);
    else assert.ok(errors.length, state);
  }
  for (const assignmentKind of fixture('deferred-assignment-kinds-invalid.json').assignmentKinds) {
    assert.ok(
      validateProtocolArtifact(
        'operating-assignment',
        {
          ...valid['operating-assignment'],
          assignmentKind,
        },
        { protocolVersion: '2.0.0' },
      ).length,
      assignmentKind,
    );
  }
  for (const kind of fixture('deferred-triggers-invalid.json').triggers) {
    const rejected = clone(valid['operate-tool-call']);
    rejected.request.trigger.kind = kind;
    assert.ok(
      validateProtocolArtifact('operate-tool-call', rejected, {
        protocolVersion: '2.0.0',
      }).length,
      kind,
    );
  }
});

test('all current actions require complete typed arguments and their compiled effect', () => {
  const argumentsByTool = {
    'operate.cycle.start': {
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      focus: ['strategy'],
      trigger: { kind: 'manual' },
      mode: 'standard',
      ownerActorId: 'owner-cycle-start-001',
      deliveryRoute: 'observe-only',
    },
    'operate.cycle.get': { cycleId: 'CYCLE-003' },
    'operate.cycle.resume': { cycleId: 'opaque-cycle-id' },
    'operate.assignment.claim': {
      assignmentId: 'asg_00000001',
      actor: { actorId: 'agent-001', kind: 'agent', runtime: 'codex' },
    },
    'operate.assignment.submit': {
      assignmentId: 'asg_00000001',
      submissionId: 'sub_00000001',
      mediaType: 'application/json',
      encoding: 'utf-8',
      contentBase64: 'e30=',
      actor: { actorId: 'agent-001', kind: 'agent', runtime: 'codex' },
    },
    'operate.artifact.get': {
      artifactId: 'art_00000001',
      representation: 'metadata',
      actor: { actorId: 'agent-001', kind: 'agent', runtime: 'codex' },
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      assignmentId: 'asg_00000001',
    },
    'operate.review.get': {
      reviewId: 'rev_00000001',
      cycleId: 'cyc_00000001',
      actor: { actorId: 'owner-001', kind: 'human', runtime: 'openplanr' },
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
    },
    'operate.review.submit': {
      reviewId: 'rev_00000001',
      cycleId: 'cyc_00000001',
      actor: { actorId: 'owner-001', kind: 'human', runtime: 'openplanr' },
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      disposition: 'approved',
      workDispositions: [],
    },
    'operate.action.approve': {
      action: { actionId: 'act_00000001', revision: 1, actionHash: digest('1') },
      decision: 'approved',
    },
    'operate.action.execute': {
      action: { actionId: 'act_00000001', revision: 1, actionHash: digest('1') },
    },
    'operate.action.rollback': {
      action: { actionId: 'act_00000001', revision: 1, actionHash: digest('1') },
      originalOperationId: 'op_00000001',
      rollbackPlanId: 'rbp_00000001',
    },
  };
  const effects = {
    'operate.cycle.start': 'project-write',
    'operate.cycle.get': 'read-only',
    'operate.cycle.resume': 'project-write',
    'operate.assignment.claim': 'machine-local-write',
    'operate.assignment.submit': 'machine-local-write',
    'operate.artifact.get': 'read-only',
    'operate.review.get': 'read-only',
    'operate.review.submit': 'project-write',
    'operate.action.approve': 'project-write',
    'operate.action.execute': 'project-write',
    'operate.action.rollback': 'project-write',
  };

  for (const [tool, argumentsValue] of Object.entries(argumentsByTool)) {
    const action = { tool, arguments: argumentsValue, label: tool, effect: effects[tool] };
    assert.deepEqual(
      validateProtocolArtifact('operate-allowed-action', action, {
        protocolVersion: '2.0.0',
      }),
      [],
      tool,
    );
    const incomplete = clone(action);
    delete incomplete.arguments[Object.keys(incomplete.arguments)[0]];
    assert.ok(
      validateProtocolArtifact('operate-allowed-action', incomplete, {
        protocolVersion: '2.0.0',
      }).length,
      `${tool} rejects incomplete arguments`,
    );
  }
  assert.ok(
    validateProtocolArtifact(
      'operate-allowed-action',
      {
        ...valid['operate-allowed-action'],
        effect: 'external-effect',
      },
      { protocolVersion: '2.0.0' },
    ).length,
  );
  assert.ok(
    validateProtocolArtifact(
      'operate-allowed-action',
      {
        ...valid['operate-allowed-action'],
        arguments: {
          assignmentId: 'asg_00000001',
          actor: {
            actorId: 'agent-001',
            kind: 'agent',
            runtime: 'codex',
            sessionId: 'internal-only',
          },
        },
      },
      { protocolVersion: '2.0.0' },
    ).length,
    'public claim action rejects a session binding',
  );
});

test('event schema maintains strict type-specific payloads and request-bound intelligence facts', () => {
  const base = valid['operating-event'];
  const assignment = {
    ...valid['operating-assignment'],
    state: 'pending',
    availableAt: null,
    completedAt: null,
    claim: null,
  };
  const intelligencePayload = (record) => ({
    snapshotId: 'snp_event_binding_001',
    stateId: 'oms_event_binding_001',
    record,
  });
  const payloads = {
    'cycle.input-bound': base.payload,
    'assignment.created': assignment,
    'assignment.available': {
      assignmentId: assignment.assignmentId,
      releaseId: `rel_${'a'.repeat(24)}`,
      dependencyProofs: [],
      dependencyEventIds: [],
    },
    'assignment.claimed': {
      assignmentId: assignment.assignmentId,
      actorId: 'agent-001',
      actorKind: 'agent',
      runtime: 'codex',
      claimId: 'claim-001',
      submissionId: 'sub_00000001',
    },
    'assignment.started': { assignmentId: assignment.assignmentId, attempt: 1 },
    'assignment.submitted': {
      assignmentId: assignment.assignmentId,
      submissionId: 'sub_00000001',
      rawHash: digest('a'),
      canonicalHash: null,
      sizeBytes: 21,
      mediaType: 'application/json',
      encoding: 'utf-8',
    },
    'artifact.created': valid['operating-artifact'],
    'assignment.validated': {
      assignmentId: assignment.assignmentId,
      submissionId: 'sub_00000001',
      artifactId: 'art_00000002',
      validatorVersion: '1.0.0',
    },
    'assignment.rejected': {
      assignmentId: assignment.assignmentId,
      submissionId: 'sub_00000001',
      violations: [{ path: '$.answer', code: 'required', message: 'answer is required' }],
      attempt: 1,
      attemptsRemaining: 2,
    },
    'assignment.abandoned': {
      assignmentId: assignment.assignmentId,
      reasonCode: 'legacy-absent',
      reason: 'No legacy role result exists.',
      recoveryDisposition: 'continue-partial',
    },
    'assignment.failed': {
      assignmentId: assignment.assignmentId,
      errorCode: 'runtime-failed',
      reason: 'Runtime stopped.',
      recoveryStatus: 'terminal',
    },
    'review.created': valid['operating-review'],
    'review.submitted': {
      reviewId: valid['operating-review'].reviewId,
      disposition: 'approved',
      workDispositions: [],
      receiptProjection: {
        read: valid['operating-review-read'],
        appliedChoiceId: valid['operating-review-read'].dispositionChoices[0].choiceId,
        appliedChoiceHash: valid['operating-review-read'].dispositionChoices[0].choiceHash,
      },
    },
    'work-change-set.materialized': {
      artifactId: valid['operating-artifact'].artifactId,
      canonicalHash: 'sha256:0be4b65b3bb3744246ed7161df68be525cce4d33d47978901ab08dd9a649041f',
      changeSet: valid['operating-work-change-set'],
      findings: [],
      decisions: [],
      actions: [],
    },
    'evidence.resolved': {
      resolution: valid['operating-evidence-resolution'],
      evidenceRef: valid['operating-evidence-ref'],
      evidenceArtifact: valid['operating-artifact'],
      edges: [valid['operating-evidence-edge']],
      requestHash: digest('c'),
      outcomeHash: digest('d'),
    },
    'evidence.rejected': {
      resolution: {
        ...valid['operating-evidence-resolution'],
        outcome: 'rejected',
        sourceContract: null,
        evidenceRefId: null,
        evidenceArtifactId: null,
        error: {
          code: 'SOURCE_NOT_FOUND',
          retryable: false,
          context: { evidenceKind: 'filesystem', sourceRootId: 'workspace-root' },
        },
      },
      requestHash: digest('c'),
      outcomeHash: digest('d'),
    },
    'metric.observed': intelligencePayload(valid['operating-metric-observation']),
    'claim.recorded': intelligencePayload(valid['operating-claim']),
    'risk.recorded': intelligencePayload(valid['operating-risk']),
    'finding.recorded': intelligencePayload(valid['operating-finding']),
    'assumption.recorded': intelligencePayload(valid['operating-assumption']),
    'decision.revised': intelligencePayload(valid['operating-decision']),
    'delta.derived': intelligencePayload(fixture('operating-delta-valid.json')),
    'scenario.recorded': intelligencePayload(
      fixture('operating-trigger-scenario-valid.json').scenario,
    ),
    'trigger.recorded': intelligencePayload(
      fixture('operating-trigger-scenario-valid.json').trigger,
    ),
  };

  const requestBoundIntelligenceTypes = new Set([
    'metric.observed',
    'claim.recorded',
    'risk.recorded',
    'finding.recorded',
    'assumption.recorded',
    'decision.revised',
    'delta.derived',
    'scenario.recorded',
    'trigger.recorded',
  ]);
  assert.equal(Object.keys(payloads).length, 25);
  let sequence = 0;
  for (const [type, payload] of Object.entries(payloads)) {
    sequence += 1;
    const event = {
      ...base,
      eventId: `evt-${sequence}`,
      sequence,
      type,
      payload,
      ...(requestBoundIntelligenceTypes.has(type) ? { requestHash: digest('e') } : {}),
    };
    assert.deepEqual(
      validateProtocolArtifact('operating-event', event, {
        protocolVersion: '2.0.0',
      }),
      [],
      type,
    );
    assert.ok(
      validateProtocolArtifact(
        'operating-event',
        {
          ...event,
          payload: { ...payload, unexpected: true },
        },
        { protocolVersion: '2.0.0' },
      ).length,
      `${type} payload is closed`,
    );
  }

  assert.ok(
    validateProtocolArtifact(
      'operating-event',
      {
        ...base,
        eventId: 'evt-intelligence-no-request-hash',
        sequence: 90,
        type: 'metric.observed',
        payload: intelligencePayload(valid['operating-metric-observation']),
      },
      { protocolVersion: '2.0.0' },
    ).length,
    'intelligence facts require a canonical request fingerprint',
  );

  assert.ok(
    validateProtocolArtifact(
      'operating-event',
      {
        ...base,
        eventId: 'evt-legacy-availability',
        sequence: 99,
        type: 'assignment.available',
        payload: {
          assignmentId: assignment.assignmentId,
          satisfiedDependencyIds: [],
          dependencyEventIds: [],
        },
      },
      { protocolVersion: '2.0.0' },
    ).length,
    'legacy availability proof is not a v2 event payload',
  );

  const created = {
    ...base,
    eventId: 'evt-created',
    sequence: 12,
    type: 'assignment.created',
    payload: assignment,
  };
  for (const [label, payload] of [
    [
      'available-state bypass',
      { ...assignment, state: 'available', availableAt: '2026-08-08T08:00:01Z' },
    ],
    ['availability timestamp bypass', { ...assignment, availableAt: '2026-08-08T08:00:01Z' }],
    [
      'claim-state bypass',
      {
        ...assignment,
        claim: { actorId: 'agent-001', actorKind: 'agent', runtime: 'codex', claimId: 'claim-001' },
      },
    ],
  ]) {
    assert.ok(
      validateProtocolArtifact(
        'operating-event',
        {
          ...created,
          payload,
        },
        { protocolVersion: '2.0.0' },
      ).length,
      label,
    );
  }
});

test('raw bytes, canonical metadata, runtime replay state, and checkpoint stay exact', () => {
  const bytes = fixture('exact-bytes-valid.json');
  const decoded = Buffer.from(bytes.contentBase64, 'base64');
  assert.equal(decoded.toString('utf8'), bytes.text);
  assert.equal(decoded.byteLength, bytes.sizeBytes);
  assert.equal(`sha256:${createHash('sha256').update(decoded).digest('hex')}`, bytes.rawHash);

  assert.doesNotThrow(() =>
    readOperatingRuntimeStateV2(valid['operating-runtime-state'], {
      protocolVersion: '2.0.0',
    }),
  );
  assert.deepEqual(
    validateProtocolArtifact('operating-checkpoint', valid['operating-checkpoint'], {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  const badCanonical = {
    ...valid['operating-artifact'],
    canonicalHash: `sha256:${'A'.repeat(64)}`,
  };
  assert.ok(
    validateProtocolArtifact('operating-artifact', badCanonical, {
      protocolVersion: '2.0.0',
    }).length,
  );
  const missingDomainVersion = clone(valid['operating-artifact']);
  delete missingDomainVersion.domainVersion;
  assert.ok(
    validateProtocolArtifact('operating-artifact', missingDomainVersion, {
      protocolVersion: '2.0.0',
    }).length,
    'Artifact must retain its explicit domain contract version',
  );
});

test('v2 readers require explicit, matching identities with no default', () => {
  assert.throws(() => loadOperateRuntimeContract('operating-cycle'), {
    code: 'E_SCHEMA_VERSION_REQUIRED',
  });
  assert.throws(() => readOperatingRuntimeStateV2(valid['operating-runtime-state']), {
    code: 'E_SCHEMA_VERSION_REQUIRED',
  });
  assert.throws(
    () =>
      readOperatingRuntimeStateV2(
        {
          ...valid['operating-runtime-state'],
          protocolVersion: '1.4.0',
        },
        { protocolVersion: '2.0.0' },
      ),
    { code: 'E_PROTOCOL_ARTIFACT_INVALID' },
  );
  assert.throws(
    () =>
      validateProtocolArtifact('operating-cycle', {
        ...valid['operating-cycle'],
        protocolVersion: undefined,
      }),
    { code: 'E_SCHEMA_VERSION_REQUIRED' },
  );

  const versionBoundaries = fixture('version-boundaries-invalid.json');
  for (const [name, descriptor] of Object.entries(versionBoundaries)) {
    const candidate = clone(valid['operating-cycle']);
    if (descriptor.delete) delete candidate[descriptor.delete];
    if (descriptor.patch) Object.assign(candidate, descriptor.patch);
    assert.ok(
      validateProtocolArtifact('operating-cycle', candidate, {
        protocolVersion: '2.0.0',
      }).length,
      name,
    );
  }
});

test('aggregate missing fields and every durable binding field fail closed', () => {
  const toolSchema = loadOperateRuntimeContract('operate-tool-call', {
    protocolVersion: '2.0.0',
  }).schema;
  const missing = fixture('aggregate-missing-fields-invalid.json');
  const errors = validateJson(missing.request, toolSchema.$defs.cycleStartArguments);
  assert.equal(errors.filter(({ rule }) => rule === 'required').length, 7);

  const baseline = {
    cycle: clone(valid['operating-cycle']),
    inputBinding: clone(valid['operating-cycle-input-binding']),
    assignment: clone(valid['operating-assignment']),
    submission: clone(valid['operating-submission']),
    runtimeBinding: clone(valid['operating-cycle-input-binding'].runtimeBinding),
    runtimeState: {
      ...clone(valid['operating-runtime-state']),
      cycles: [clone(valid['operating-cycle'])],
      inputBindings: [clone(valid['operating-cycle-input-binding'])],
      assignments: [clone(valid['operating-assignment'])],
      submissions: [clone(valid['operating-submission'])],
      artifacts: [clone(valid['operating-artifact'])],
      submissionReplayIndex: [
        {
          submissionId: valid['operating-submission'].submissionId,
          assignmentId: valid['operating-submission'].assignmentId,
          rawHash: valid['operating-submission'].rawHash,
          canonicalHash: valid['operating-submission'].canonicalHash,
          sizeBytes: valid['operating-submission'].sizeBytes,
          artifactId: valid['operating-submission'].artifactId,
          acceptanceEventIds: valid['operating-submission'].acceptanceEventIds,
          responseData: valid['operating-submission'].responseData,
        },
      ],
    },
    checkpoint: clone(valid['operating-checkpoint']),
  };
  assert.equal(assertOperateRuntimeBindingsV2(baseline).cycle.cycleId, baseline.cycle.cycleId);

  for (const [field, descriptor] of Object.entries(fixture('binding-field-tamper-invalid.json'))) {
    const tampered = clone(baseline);
    setPath(tampered, descriptor.target, descriptor.value);
    assert.throws(
      () => assertOperateRuntimeBindingsV2(tampered),
      (error) =>
        error?.code === 'E_OPERATE_BINDING_MISMATCH' &&
        error?.details?.field === field &&
        error?.details?.actual === descriptor.value,
      field,
    );
  }
});

test('metadata retrieval never materializes bytes and operation/body mismatches fail', () => {
  const metadataEnvelope = {
    ok: true,
    operation: 'operate.artifact.get',
    data: { metadata: valid['operating-artifact'], representation: 'metadata' },
    allowedActions: [],
  };
  assert.deepEqual(
    validateProtocolArtifact('operate-api-envelope', metadataEnvelope, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  assert.ok(
    validateProtocolArtifact(
      'operate-api-envelope',
      {
        ...metadataEnvelope,
        data: { ...metadataEnvelope.data, contentBase64: 'e30=' },
      },
      { protocolVersion: '2.0.0' },
    ).length,
  );

  const cycleEnvelope = {
    ok: true,
    operation: 'operate.cycle.get',
    data: {
      cycle: valid['operating-cycle'],
      progress: {
        total: 1,
        pending: 0,
        available: 1,
        active: 0,
        submitted: 0,
        validated: 0,
        rejected: 0,
        terminal: 0,
      },
      availableAssignments: [valid['operating-assignment']],
      acceptedArtifactIds: [],
      persistentWork: {
        ledger: valid['operating-work-ledger'],
        cycleLinks: [],
      },
      actions: [],
    },
    allowedActions: [],
  };
  assert.deepEqual(
    validateProtocolArtifact('operate-api-envelope', cycleEnvelope, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  assert.ok(
    validateProtocolArtifact(
      'operate-api-envelope',
      {
        ...cycleEnvelope,
        data: {
          ...cycleEnvelope.data,
          legacyReviewReference: {
            legacyCycleId: 'CYCLE-001',
            reviewState: 'reviewable',
            artifactIds: [],
          },
        },
      },
      { protocolVersion: '2.0.0' },
    ).length,
    'v2 cycle views reject legacy routes',
  );

  const acceptedEnvelope = {
    ok: true,
    operation: 'operate.assignment.submit',
    data: {
      accepted: true,
      artifactId: 'art_00000002',
      rawHash: digest('a'),
      sizeBytes: 21,
      assignmentState: 'validated',
    },
    allowedActions: [],
  };
  assert.deepEqual(
    validateProtocolArtifact('operate-api-envelope', acceptedEnvelope, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  assert.ok(
    validateProtocolArtifact(
      'operate-api-envelope',
      {
        ...acceptedEnvelope,
        data: {
          ...acceptedEnvelope.data,
          compatibilityReadyAssignmentIds: [],
        },
      },
      { protocolVersion: '2.0.0' },
    ).length,
    'v2 submission responses reject compatibility-shaped fields',
  );

  const mixed = clone(valid['operate-tool-call']);
  mixed.operation = 'operate.cycle.get';
  assert.ok(
    validateProtocolArtifact('operate-tool-call', mixed, {
      protocolVersion: '2.0.0',
    }).length,
  );
  assert.throws(
    () =>
      assertProtocolArtifact('operate-tool-call', mixed, {
        protocolVersion: '2.0.0',
      }),
    { code: 'E_PROTOCOL_ARTIFACT_INVALID' },
  );

  const responseCall = {
    kind: 'operate-tool-call',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    direction: 'response',
    operation: 'operate.cycle.get',
    response: {
      ok: false,
      operation: 'operate.cycle.get',
      error: {
        code: 'CYCLE_NOT_FOUND',
        message: 'Cycle not found.',
        retryable: false,
        context: {},
      },
      allowedActions: [],
    },
  };
  assert.deepEqual(
    validateProtocolArtifact('operate-tool-call', responseCall, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  responseCall.response.operation = 'operate.cycle.resume';
  assert.ok(
    validateProtocolArtifact('operate-tool-call', responseCall, {
      protocolVersion: '2.0.0',
    }).length,
    'nested response operation must equal the outer operation',
  );
});

test('failure envelopes accept only safe, typed diagnostic context', () => {
  const envelope = {
    ok: false,
    operation: 'operate.assignment.submit',
    error: {
      code: 'RESULT_CONTRACT_INVALID',
      message: 'The submission exceeds the Assignment byte limit.',
      retryable: true,
      context: { assignmentId: 'asg_00000001', submissionId: 'sub_00000001', maxBytes: 65536 },
    },
    allowedActions: [],
  };
  assert.deepEqual(
    validateProtocolArtifact('operate-api-envelope', envelope, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  assert.ok(
    validateProtocolArtifact(
      'operate-api-envelope',
      {
        ...envelope,
        error: {
          ...envelope.error,
          context: { ...envelope.error.context, rawSubmission: 'secret bytes' },
        },
      },
      { protocolVersion: '2.0.0' },
    ).length,
    'error context rejects unapproved fields',
  );
  assert.ok(
    validateProtocolArtifact(
      'operate-api-envelope',
      {
        ...envelope,
        operation: 'operate.review.get',
        error: {
          code: 'REVIEW_NOT_AUTHORIZED',
          message: 'Review access is denied.',
          retryable: false,
          context: { reviewId: 'rev_00000001', ownerActorId: 'private-review-owner' },
        },
      },
      { protocolVersion: '2.0.0' },
    ).length,
    'Review refusals reject private owner identity context',
  );
});

test('allowed actions and tool calls reject every declared placeholder form', () => {
  const placeholders = fixture('placeholders-invalid.json');
  const cases = [];
  const cycleStart = {
    scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
    focus: ['strategy'],
    trigger: { kind: 'manual' },
    mode: 'standard',
    ownerActorId: 'owner-cycle-start-001',
    deliveryRoute: 'observe-only',
  };
  for (const descriptor of placeholders.cycleStart) {
    cases.push({ tool: 'operate.cycle.start', arguments: cycleStart, ...descriptor });
  }
  for (const descriptor of placeholders.cycleIdentity) {
    cases.push({ tool: descriptor.tool, arguments: { cycleId: 'cyc_00000001' }, ...descriptor });
  }
  const assignmentClaim = {
    assignmentId: 'asg_00000001',
    actor: { actorId: 'agent-001', kind: 'agent', runtime: 'codex' },
  };
  for (const descriptor of placeholders.assignmentClaim) {
    cases.push({ tool: 'operate.assignment.claim', arguments: assignmentClaim, ...descriptor });
  }
  const assignmentSubmit = {
    assignmentId: 'asg_00000001',
    submissionId: 'sub_00000001',
    mediaType: 'application/json',
    encoding: 'utf-8',
    contentBase64: 'e30=',
  };
  for (const descriptor of placeholders.assignmentSubmit) {
    cases.push({ tool: 'operate.assignment.submit', arguments: assignmentSubmit, ...descriptor });
  }

  for (const { tool, arguments: baseArguments, field, value } of cases) {
    const argumentsValue = clone(baseArguments);
    setPath(argumentsValue, field, value);
    const action = { tool, arguments: argumentsValue, label: tool, effect: 'read-only' };
    assert.ok(
      validateProtocolArtifact('operate-allowed-action', action, {
        protocolVersion: '2.0.0',
      }).length,
      `${tool}:${field}`,
    );
    const call = {
      kind: 'operate-tool-call',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      direction: 'request',
      operation: tool,
      request: argumentsValue,
    };
    assert.ok(
      validateProtocolArtifact('operate-tool-call', call, {
        protocolVersion: '2.0.0',
      }).length,
      `${tool}:${field}:tool-call`,
    );
  }

  for (const label of placeholders.labels) {
    assert.ok(
      validateProtocolArtifact(
        'operate-allowed-action',
        {
          ...valid['operate-allowed-action'],
          label,
        },
        { protocolVersion: '2.0.0' },
      ).length,
      `action-label:${label}`,
    );
  }
});
