#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEvaluationContract, validateProtocolArtifact } from 'planr-pipeline/protocol';
import {
  assertEvaluationAggregateReport,
  assertEvaluationBudget,
  assertEvaluationCorpus,
  assertEvaluationFixture,
  assertEvaluationGatePolicy,
  assertEvaluationGraderIndependence,
  assertEvaluationGraderRegistration,
  assertEvaluationGraderRegistry,
  assertEvaluationHostProfile,
  assertEvaluationHostProfileRegistry,
  assertEvaluationObservation,
  assertEvaluationRunResult,
  assertEvaluationScenario,
  assertEvaluationWaiver,
  assertEvaluationWaiverApplicable,
  assertSkillCertificationReceipt,
  EVALUATION_METRICS,
  EVALUATION_UNWAIVABLE_METRICS,
} from '../lib/pipeline/evaluation-contract.mjs';
import {
  deriveEvaluationIdentity,
  EVALUATION_EVIDENCE_INPUTS,
  evaluationEvidenceReuse,
} from '../lib/pipeline/evaluation-identity.mjs';
import { assertEvaluationAggregatePublishable } from '../lib/pipeline/evaluation-redaction.mjs';

const VERSION = '1.4.0';
const NOW = '2026-08-25T09:16:00.000Z';
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const fixtureRoot = join(root, 'conformance', 'fixtures', 'skill-evaluation');
let checks = 0;

function pass(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function fixture(name) {
  return JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8'));
}

function resolve(container, segments) {
  let target = container;
  for (const segment of segments)
    target = target?.[Array.isArray(target) ? Number(segment) : segment];
  return target;
}

/** Applies the declared operations of one named refusal case. */
function mutate(base, operations) {
  const clone = structuredClone(base);
  for (const { op, path, value } of operations) {
    const segments = path.split('/').filter(Boolean);
    if (op === 'append') {
      const target = resolve(clone, segments);
      assert.ok(Array.isArray(target), `append expects an array at ${path}`);
      target.push(structuredClone(value));
      continue;
    }
    const key = segments.pop();
    const target = resolve(clone, segments);
    assert.ok(target && typeof target === 'object', `${op} expects a container at ${path}`);
    if (op === 'remove') delete target[Array.isArray(target) ? Number(key) : key];
    else target[Array.isArray(target) ? Number(key) : key] = structuredClone(value);
  }
  return clone;
}

/** The refusal code a validator raises for a candidate, or null when it accepts. */
function refusalCode(validate, candidate) {
  try {
    validate(candidate);
    return null;
  } catch (error) {
    return error.code ?? 'E_UNTYPED';
  }
}

function throws(call) {
  try {
    call();
    return false;
  } catch {
    return true;
  }
}

const valid = fixture('contracts-valid.json');
const invalid = fixture('contracts-invalid.json');
const redaction = fixture('aggregate-redaction.json');

const scenario = valid['evaluation-scenario'];
const corpus = valid['evaluation-corpus'];
const grader = valid['evaluation-grader-registration'];
const aggregateReport = valid['evaluation-aggregate-report'];
const receipt = valid['skill-certification-receipt'];
const waiver = valid['evaluation-waiver'];

// The corpus binds its members by digest, so every corpus check recomputes the member
// digest from the scenario record's own bytes rather than trusting what the corpus recorded.
const sourceDigests = {
  [corpus.members[0].sourcePath]: deriveEvaluationIdentity(scenario, 'evaluation-scenario').digest,
};

const validators = {
  'evaluation-scenario': (record) => assertEvaluationScenario(record),
  'evaluation-corpus': (record) => assertEvaluationCorpus(record, { sourceDigests }),
  'evaluation-fixture': (record) => assertEvaluationFixture(record),
  'evaluation-host-profile': (record) => assertEvaluationHostProfile(record),
  'evaluation-host-profile-registry': (record) => assertEvaluationHostProfileRegistry(record),
  'evaluation-grader-registration': (record) => assertEvaluationGraderRegistration(record),
  'evaluation-grader-registry': (record) => assertEvaluationGraderRegistry(record),
  'evaluation-budget': (record) => assertEvaluationBudget(record),
  'evaluation-gate-policy': (record) => assertEvaluationGatePolicy(record),
  'evaluation-observation': (record) => assertEvaluationObservation(record),
  'evaluation-run-result': (record) => assertEvaluationRunResult(record),
  'evaluation-aggregate-report': (record) => assertEvaluationAggregateReport(record),
  'evaluation-waiver': (record) => assertEvaluationWaiver(record),
  'skill-certification-receipt': (record) =>
    assertSkillCertificationReceipt(record, { aggregateReport, now: NOW }),
};

let refusedShapes = 0;
let custodyRefusals = 0;

for (const [kind, record] of Object.entries(valid)) {
  pass(typeof validators[kind] === 'function', `${kind} has a published validator`);

  const resolved = loadEvaluationContract(kind, { protocolVersion: VERSION });
  pass(
    resolved.kind === kind &&
      resolved.protocolVersion === VERSION &&
      resolved.path === `schemas/v${VERSION}/${kind}.schema.json` &&
      resolved.schema.$id === `https://openplanr.dev/schemas/v${VERSION}/${kind}.schema.json`,
    `${kind} resolves at the explicit contract version`,
  );
  pass(
    throws(() => loadEvaluationContract(kind)),
    `${kind} refuses an implicit contract version`,
  );
  pass(
    throws(() => loadEvaluationContract(kind, { protocolVersion: '1.3.0' })),
    `${kind} refuses an unsupported contract version`,
  );

  pass(
    validateProtocolArtifact(kind, record, { protocolVersion: VERSION }).length === 0,
    `the reference ${kind} satisfies its published schema`,
  );
  pass(
    refusalCode(validators[kind], record) === null,
    `the reference ${kind} satisfies its published validator`,
  );

  const identity = deriveEvaluationIdentity(record, kind);
  pass(
    record[identity.idField] === identity.id && record[identity.digestField] === identity.digest,
    `the reference ${kind} carries an identity derived from its own bytes`,
  );

  const cases = invalid[kind] ?? [];
  pass(cases.length > 0, `${kind} declares at least one refused shape`);

  for (const refusal of cases) {
    const candidate = mutate(record, refusal.operations);
    pass(
      refusalCode(validators[kind], candidate) === refusal.code,
      `${kind} refuses ${refusal.name} with ${refusal.code}`,
    );

    // Each case declares the layer that owns its refusal. A schema-visible shape must be
    // refused by the published schema as well, so a reader validating JSON alone is never
    // told a refused record is acceptable. A custody case is a binding the schema cannot
    // see — a digest that no longer matches its source, canonical member order, waiver
    // horizon — and is owned by the validator alone.
    const schemaRefused =
      validateProtocolArtifact(kind, candidate, { protocolVersion: VERSION }).length > 0;
    if (refusal.refusedBy === 'schema') {
      pass(schemaRefused, `${kind} refuses at the schema: ${refusal.name}`);
      refusedShapes += 1;
    } else {
      pass(
        refusal.refusedBy === 'contract',
        `${kind} declares the layer that owns: ${refusal.name}`,
      );
      custodyRefusals += 1;
    }
  }
}

// The packaged registries are what a run actually binds, so they are checked as shipped.
for (const [file, kind, validate] of [
  [
    'registry/evaluation-graders.json',
    'evaluation-grader-registry',
    assertEvaluationGraderRegistry,
  ],
  [
    'registry/evaluation-host-profiles.json',
    'evaluation-host-profile-registry',
    assertEvaluationHostProfileRegistry,
  ],
]) {
  const record = JSON.parse(readFileSync(join(root, file), 'utf8'));
  pass(
    validateProtocolArtifact(kind, record, { protocolVersion: VERSION }).length === 0,
    `${file} satisfies its published schema`,
  );
  const refusal = refusalCode(validate, record);
  pass(refusal === null, `${file} satisfies its published validator (refused with ${refusal})`);
}

// Validation is the deterministic path, so its modules may reach nothing that could make a
// network call, spawn a process, read an ambient credential, or contact a model.
for (const module of [
  'evaluation-contract.mjs',
  'evaluation-identity.mjs',
  'evaluation-redaction.mjs',
]) {
  const source = readFileSync(join(root, 'lib', 'pipeline', module), 'utf8');
  const specifiers = [...source.matchAll(/from\s+'([^']+)'/gu)].map(([, specifier]) => specifier);
  pass(
    specifiers.every((specifier) => specifier === 'node:crypto' || specifier.startsWith('.')),
    `${module} imports nothing beyond hashing and local contract modules`,
  );
  for (const reach of [
    'fetch(',
    'process.env',
    'child_process',
    'node:http',
    'node:net',
    'XMLHttpRequest',
  ]) {
    pass(!source.includes(reach), `${module} makes no ${reach} reach`);
  }
}

// A deterministic grader is the whole basis for a reproducible verdict, so it may declare
// no model call, no network, and no credential use.
for (const registration of valid['evaluation-grader-registry'].graders) {
  pass(
    registration.graderType !== 'live-model-judgement' &&
      registration.determinism.deterministic &&
      !registration.determinism.modelCall &&
      !registration.determinism.network &&
      !registration.determinism.credentialUse &&
      registration.consent === null &&
      registration.credentialReference === null &&
      registration.telemetry === false,
    `the built-in grader ${registration.graderName} makes no model, network, or credential call`,
  );
  pass(
    registration.unavailableBehavior === 'typed-absence',
    `the built-in grader ${registration.graderName} reports absence as absence`,
  );
  pass(
    !registration.blocksContractValidation,
    `the built-in grader ${registration.graderName} is not a precondition for validating contracts`,
  );
}

const subject = {
  skillId: receipt.subject.skillId,
  skillSourceDigest: receipt.subject.skillSourceDigest,
};
pass(
  refusalCode((entry) => assertEvaluationGraderIndependence(entry, subject), grader) === null,
  'a grader outside the skill under evaluation may grade it',
);
pass(
  refusalCode(
    (entry) =>
      assertEvaluationGraderIndependence(entry, {
        ...subject,
        skillSourceDigest: grader.provenance.sourceDigest,
      }),
    grader,
  ) === 'E_EVALUATION_GRADER_NOT_INDEPENDENT',
  'a grader sharing the source bytes of the skill under evaluation may not grade it',
);
pass(
  refusalCode(
    (entry) =>
      assertEvaluationGraderIndependence(entry, { ...subject, skillId: grader.graderName }),
    grader,
  ) === 'E_EVALUATION_GRADER_NOT_INDEPENDENT',
  'a grader sharing the identity of the skill under evaluation may not grade it',
);

const observation = valid['evaluation-observation'];
pass(
  refusalCode(
    (record) =>
      assertEvaluationObservation(record, { subject: { registration: grader, skill: subject } }),
    observation,
  ) === null,
  'an observation bound to the grader that produced it is accepted',
);
pass(
  refusalCode(
    (record) =>
      assertEvaluationObservation(record, {
        subject: {
          registration: grader,
          skill: { ...subject, skillSourceDigest: grader.provenance.sourceDigest },
        },
      }),
    observation,
  ) === 'E_EVALUATION_GRADER_NOT_INDEPENDENT',
  'an observation produced by a grader that is part of the skill is refused',
);

pass(
  refusalCode(
    (record) =>
      assertEvaluationWaiverApplicable(record, {
        now: NOW,
        gatePolicyDigest: waiver.gatePolicyDigest,
        scenarioDigest: scenario.scenarioDigest,
      }),
    waiver,
  ) === null,
  'a live, in-policy, in-scope waiver applies',
);
pass(
  refusalCode(
    (record) => assertEvaluationWaiverApplicable(record, { now: '2026-10-01T00:00:00.000Z' }),
    waiver,
  ) === 'E_EVALUATION_WAIVER_REFUSED',
  'an expired waiver never applies',
);
pass(
  refusalCode(
    (record) => assertEvaluationWaiverApplicable(record, { now: '2026-07-01T00:00:00.000Z' }),
    waiver,
  ) === 'E_EVALUATION_WAIVER_REFUSED',
  'a waiver never applies before it is issued',
);
pass(
  refusalCode(
    (record) =>
      assertEvaluationWaiverApplicable(record, {
        now: NOW,
        gatePolicyDigest: aggregateReport.reportDigest,
      }),
    waiver,
  ) === 'E_EVALUATION_WAIVER_REFUSED',
  'a waiver issued under a different gate policy never applies',
);
pass(
  refusalCode(
    (record) =>
      assertEvaluationWaiverApplicable(record, {
        now: NOW,
        scenarioDigest: aggregateReport.scenarios[1].scenarioDigest,
      }),
    waiver,
  ) === 'E_EVALUATION_WAIVER_REFUSED',
  'a scenario waiver never carries to a scenario whose bytes differ',
);

for (const metric of EVALUATION_UNWAIVABLE_METRICS) {
  const gate = receipt.gateEvaluation.find((entry) => entry.metric === metric);
  pass(
    gate.waivable === false && gate.status !== 'waived',
    `the ${metric} gate is evaluated as unwaivable`,
  );
  pass(
    valid['evaluation-gate-policy'].gates[metric].waivable === false,
    `the ${metric} gate is stated as unwaivable in policy`,
  );
}
pass(
  receipt.gateEvaluation.length === EVALUATION_METRICS.length,
  'every mandatory gate is evaluated in the receipt',
);
pass(
  receipt.recordType === 'readiness' && ['release-ready', 'blocked'].includes(receipt.result),
  'a certification receipt reports readiness and nothing else',
);

const evidenceInputs = {
  budgetDigest: valid['evaluation-budget'].budgetDigest,
  fixtureSetDigest: valid['evaluation-fixture'].fixtureDigest,
  graderRegistrationDigest: grader.registrationDigest,
  hostProfileDigest: valid['evaluation-host-profile'].profileDigest,
  packageDigest: observation.packageDigest,
  scenarioDigest: scenario.scenarioDigest,
  sourceDigest: valid['evaluation-run-result'].sourceDigest,
};
const prior = [{ scenarioId: scenario.scenarioId, inputs: evidenceInputs }];
const unchanged = evaluationEvidenceReuse(prior, [
  { scenarioId: scenario.scenarioId, inputs: { ...evidenceInputs } },
]);
pass(
  unchanged.reusable.length === 1 &&
    unchanged.invalidated.length === 0 &&
    unchanged.unevaluated.length === 0,
  'evidence carries forward only where every bound input digest is identical',
);
const changed = evaluationEvidenceReuse(prior, [
  {
    scenarioId: scenario.scenarioId,
    inputs: { ...evidenceInputs, packageDigest: aggregateReport.reportDigest },
  },
]);
pass(
  changed.reusable.length === 0 &&
    changed.invalidated.length === 1 &&
    changed.invalidated[0].reason === 'input-digest-changed' &&
    changed.invalidated[0].changedInputs.join() === 'packageDigest',
  'a changed package digest invalidates exactly the evidence bound to it',
);
const dropped = evaluationEvidenceReuse(prior, []);
pass(
  dropped.invalidated.length === 1 && dropped.invalidated[0].reason === 'scenario-absent',
  'evidence for a scenario that no longer exists is invalidated, never inferred',
);
pass(
  EVALUATION_EVIDENCE_INPUTS.length === Object.keys(evidenceInputs).length,
  'every declared evidence input is bound by digest',
);

let redactionRefusals = 0;
pass(
  refusalCode(assertEvaluationAggregatePublishable, redaction.publishableReport) === null,
  'a fully redacted aggregate report is publishable',
);
pass(
  refusalCode(assertEvaluationAggregatePublishable, redaction.unsafeReport) ===
    'E_EVALUATION_PUBLISH_UNSAFE',
  'an aggregate report carrying raw prompt, path, and credential material is refused',
);
for (const injection of redaction.injections) {
  const candidate = mutate(redaction.publishableReport, injection.operations);
  pass(
    refusalCode(assertEvaluationAggregatePublishable, candidate) === 'E_EVALUATION_PUBLISH_UNSAFE',
    `the publish gate refuses ${injection.class}: ${injection.name}`,
  );
  redactionRefusals += 1;
}
pass(
  refusalCode(assertEvaluationAggregatePublishable, valid['evaluation-run-result']) ===
    'E_EVALUATION_PUBLISH_UNSAFE',
  'a local run result is never publishable',
);

// Certification evidence is fixture-only, so no fixture may carry live credential material.
for (const name of ['contracts-valid.json', 'contracts-invalid.json', 'aggregate-redaction.json']) {
  const serialized = readFileSync(join(fixtureRoot, name), 'utf8');
  for (const forbidden of ['BEGIN RSA', 'BEGIN PRIVATE KEY', 'AKIA', 'ghp_', 'xoxb-']) {
    pass(!serialized.includes(forbidden), `${name} carries no ${forbidden} credential material`);
  }
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    protocolVersion: VERSION,
    suite: 'skill-evaluation',
    contracts: Object.keys(valid).length,
    refusedShapes,
    custodyRefusals,
    redactionRefusals,
    checks,
  })}\n`,
);
