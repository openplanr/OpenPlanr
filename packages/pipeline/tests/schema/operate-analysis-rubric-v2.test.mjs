import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  OperateContractCompileError,
  compileOperateContractRegistry,
} from '../../lib/operate/contracts/compiler.mjs';
import { renderOperateContractAssets } from '../../scripts/generate-operate-contracts.mjs';
import { OPERATE_CONTRACT_CATALOG_V2 } from '../../lib/protocol/generated/contract-catalog-v2.mjs';
import { planOperatingIntelligenceBoardV2 } from '../../lib/operate/intelligence-router-v2.mjs';
import { deriveOperatingRuntimeDeltaV2 } from '../../lib/operate/runtime-foundation.mjs';
import { createOperateExtensionRegistryV2 } from 'planr-pipeline/operate/extensions-v2';
import { validateProtocolArtifact } from '../../lib/protocol/contracts.mjs';
import { checkpoint } from '../orchestration/operate-operating-intelligence-state-v2.test-support.mjs';

const RUBRIC_CLAUSES = [
  'requiredQuestions',
  'requiredEvidence',
  'failureModes',
  'artifactQualityBar',
  'outOfScope',
];
const root = fileURLToPath(new URL('../..', import.meta.url));
const registry = () =>
  JSON.parse(readFileSync(join(root, 'registry/operate-v2-contracts.json'), 'utf8'));
const fixture = (name) => {
  const registration = JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
  registration.policyRequirements = [];
  return registration;
};
const business = () => fixture('business-domain-valid.json');
const software = () => fixture('software-domain-valid.json');
const clone = (value) => structuredClone(value);
const businessDomain = (mutate) => {
  const source = registry();
  mutate(source.extensions.domains.find(({ domainId }) => domainId === 'business'));
  return source;
};

test('every catalog role carries a five-clause rubric bound to its role version', () => {
  for (const domain of OPERATE_CONTRACT_CATALOG_V2.extensions.domains) {
    for (const role of domain.roles) {
      const binding = `${domain.domainId}/${role.roleId}@${role.roleVersion}`;
      assert.equal(typeof role.analysisRubric, 'object', binding);
      assert.deepEqual(
        Object.keys(role.analysisRubric).sort(),
        [...RUBRIC_CLAUSES].sort(),
        binding,
      );
      for (const clause of RUBRIC_CLAUSES) {
        assert.ok(role.analysisRubric[clause].length >= 1, `${binding}.${clause}`);
        for (const text of role.analysisRubric[clause])
          assert.equal(typeof text, 'string', `${binding}.${clause}`);
      }
    }
  }
});

test('Challenger and Chair registries own one exact always-on question-coverage requirement', () => {
  for (const domain of OPERATE_CONTRACT_CATALOG_V2.extensions.domains) {
    for (const role of domain.roles.filter(({ roleKind }) => roleKind !== 'advisor')) {
      const mappings = role.resultRequirements.filter(
        ({ target }) => target === 'question-coverage',
      );
      assert.equal(mappings.length, 1, `${domain.domainId}/${role.roleId}`);
      assert.deepEqual(mappings[0].appliesToOutcomes, ['always']);
      assert.equal(mappings[0].minimumItems, role.analysisProfile.questionIds.length);
      assert.equal(mappings[0].maximumItems, role.analysisProfile.questionIds.length);
    }
  }

  for (const [label, mutate] of [
    [
      'missing mapping',
      (role) => {
        role.resultRequirements = role.resultRequirements.filter(
          ({ target }) => target !== 'question-coverage',
        );
      },
    ],
    [
      'wrong question count',
      (role) => {
        role.resultRequirements.find(({ target }) => target === 'question-coverage').minimumItems -=
          1;
      },
    ],
  ]) {
    assert.throws(
      () =>
        compileOperateContractRegistry(
          businessDomain((domain) => {
            mutate(domain.roles.find(({ roleKind }) => roleKind === 'challenger'));
          }),
        ),
      (error) =>
        error instanceof OperateContractCompileError && /question-coverage/u.test(error.message),
      label,
    );
  }
});

test('a role without a rubric compiles no catalog and registers no domain', () => {
  assert.throws(
    () =>
      compileOperateContractRegistry(
        businessDomain((domain) => {
          delete domain.roles.find(({ roleKind }) => roleKind === 'advisor').analysisRubric;
        }),
      ),
    (error) =>
      error instanceof OperateContractCompileError && error.code === 'E_OPERATE_CONTRACT_MALFORMED',
  );

  const seatless = business();
  delete seatless.roles.find(({ roleKind }) => roleKind === 'advisor').analysisRubric;
  assert.throws(
    () => createOperateExtensionRegistryV2({ domains: [seatless, software()] }),
    (error) => /analysisRubric/u.test(error.message),
  );
});

test('the compiler refuses an empty, duplicated, or unknown rubric clause', () => {
  const cases = [
    [
      'an empty clause',
      (seat) => {
        seat.analysisRubric.requiredQuestions = [];
      },
    ],
    [
      'a repeated clause entry',
      (seat) => {
        seat.analysisRubric.failureModes = [
          seat.analysisRubric.failureModes[0],
          seat.analysisRubric.failureModes[0],
        ];
      },
    ],
    [
      'a missing clause',
      (seat) => {
        delete seat.analysisRubric.outOfScope;
      },
    ],
    [
      'an unknown clause',
      (seat) => {
        seat.analysisRubric.preferredTone = ['Concise.'];
      },
    ],
  ];

  for (const [label, mutate] of cases) {
    assert.throws(
      () =>
        compileOperateContractRegistry(
          businessDomain((domain) => {
            mutate(domain.roles.find(({ roleKind }) => roleKind === 'advisor'));
          }),
        ),
      (error) => error instanceof OperateContractCompileError,
      label,
    );
  }
});

test('the registry is the sole rubric source and any edit changes generated assets', (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'operate-rubric-binding-'));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  mkdirSync(join(projectRoot, 'registry'));
  const edited = businessDomain((domain) => {
    const seat = domain.roles.find(({ roleId }) => roleId === 'strategy-finance');
    seat.analysisRubric.failureModes = [
      ...seat.analysisRubric.failureModes,
      'Treating an unpriced delay as a cost-free option.',
    ];
  });
  writeFileSync(
    join(projectRoot, 'registry/operate-v2-contracts.json'),
    JSON.stringify(edited, null, 2),
  );
  const rendered = renderOperateContractAssets({ projectRoot });
  assert.notEqual(
    rendered.assets[edited.generation.catalogPath],
    readFileSync(join(root, edited.generation.catalogPath), 'utf8'),
  );

  const compiled = compileOperateContractRegistry(registry());
  const businessRoles = compiled.extensions.domains.find(
    ({ domainId }) => domainId === 'business',
  ).roles;
  const ceo = businessRoles.find(({ roleId }) => roleId === 'strategy-finance');
  const cpo = businessRoles.find(({ roleId }) => roleId === 'product-activation');
  assert.notDeepEqual(ceo.analysisRubric, cpo.analysisRubric);
  assert.ok(
    cpo.analysisRubric.requiredQuestions.some((question) => /acceptance criteria/iu.test(question)),
  );
  assert.ok(ceo.analysisRubric.outOfScope.every((entry) => !/product-owner/iu.test(entry)));
});

test('rubric text may name the effects a seat is forbidden, and still cannot smuggle a path', () => {
  const named = business();
  named.roles.find(({ roleKind }) => roleKind === 'chair').analysisRubric.outOfScope = [
    'Approving, executing, publishing, deploying, or spending.',
    'Contacting customers.',
    'Granting a capability or changing policy.',
  ];
  assert.ok(createOperateExtensionRegistryV2({ domains: [named, software()] }));

  const smuggled = business();
  smuggled.roles.find(
    ({ roleId }) => roleId === 'strategy-finance',
  ).analysisRubric.requiredEvidence = ['../../etc/operating-objectives.json'];
  assert.throws(() => createOperateExtensionRegistryV2({ domains: [smuggled, software()] }), {
    code: 'E_EXTENSION_REGISTRATION_INVALID',
  });
});

test('an issued assignment carries the rubric of the role version it bound', () => {
  const base = checkpoint();
  const derived = deriveOperatingRuntimeDeltaV2(
    {
      cycleId: base.result.state.cycles[0].cycleId,
      snapshotId: base.result.snapshot.snapshotId,
      stateId: base.result.operatingState.stateId,
    },
    {
      deltaId: 'dlt_rubric_001',
      eventId: 'evt_rubric_delta_001',
      timestamp: '2026-08-09T12:01:00.000Z',
      correlationId: 'corr_rubric_delta_001',
    },
    { initialState: base.result.state },
  );
  const domainDescriptor = JSON.parse(
    readFileSync(
      new URL(
        '../../conformance/fixtures/operating-runtime-v2/business-domain-valid.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const board = planOperatingIntelligenceBoardV2({
    cycleId: base.result.state.cycles[0].cycleId,
    delta: derived.delta,
    snapshot: base.result.snapshot,
    operatingState: base.result.operatingState,
    evidenceRefs: base.result.state.evidenceRefs,
    evidenceArtifacts: base.result.state.artifacts,
    focus: ['all'],
    domainDescriptor,
    decisionOwnerActorId: 'owner-rubric-001',
    createdAt: '2026-08-09T12:02:00.000Z',
  });
  const seats = new Map(domainDescriptor.roles.map((role) => [role.roleId, role]));
  const bound = new Map(
    board.plan.selectedRoles.map(({ roleId, roleVersion }) => [roleId, roleVersion]),
  );

  assert.equal(board.assignments.length, domainDescriptor.roles.length);
  for (const assignment of board.assignments) {
    const seat = seats.get(assignment.roleId);
    assert.equal(bound.get(assignment.roleId), seat.roleVersion, assignment.roleId);
    assert.deepEqual(assignment.analysisRubric, seat.analysisRubric, assignment.roleId);
    assert.deepEqual(
      validateProtocolArtifact('operating-assignment', assignment, { protocolVersion: '2.0.0' }),
      [],
      assignment.roleId,
    );
  }
});
