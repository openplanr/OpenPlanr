import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  LANDING_WORKFLOW_ASSET_PATHS,
  assertLandingWorkflowCatalog,
  assertLandingWorkflowManifest,
  readLandingWorkflowCatalog,
  readLandingWorkflowManifest,
} from '../../lib/pipeline/index.mjs';
import { validateProtocolArtifact } from '../../lib/protocol/loader.mjs';

const fixture = (name) => JSON.parse(readFileSync(
  new URL(`../../conformance/fixtures/${name}`, import.meta.url),
  'utf8',
));
const schema = (kind) => JSON.parse(readFileSync(
  new URL(`../../schemas/v1.2.0/${kind}.schema.json`, import.meta.url),
  'utf8',
));

const valid = fixture('landing-contracts-valid.json');
const invalid = fixture('landing-contracts-invalid.json');
const LANDING_CONTRACT_KINDS = Object.freeze([
  'landing-plan',
  'landing-confirmation',
  'landing-event',
  'landing-phase-receipt',
  'landing-receipt',
  'landing-operation-registry',
]);

function decodePointerToken(token) {
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

function applyDescriptor(base, descriptor) {
  const candidate = structuredClone(base);
  const tokens = descriptor.path.split('/').slice(1).map(decodePointerToken);
  assert.ok(tokens.length > 0, `${descriptor.name}: JSON pointer targets a field`);
  const key = tokens.pop();
  let parent = candidate;
  for (const token of tokens) {
    assert.ok(parent !== null && typeof parent === 'object' && token in parent, `${descriptor.name}: ${descriptor.path}`);
    parent = parent[token];
  }
  if (descriptor.operation === 'remove') {
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
  } else if (descriptor.operation === 'add' || descriptor.operation === 'replace') {
    parent[key] = structuredClone(descriptor.value);
  } else {
    assert.fail(`${descriptor.name}: unsupported fixture operation ${descriptor.operation}`);
  }
  return candidate;
}

const validate = (kind, value) => validateProtocolArtifact(kind, value, { protocolVersion: '1.2.0' });

test('Protocol 1.2 landing fixtures cover the exact closed contract family', () => {
  assert.deepEqual(Object.keys(valid).sort(), [...LANDING_CONTRACT_KINDS].sort());
  assert.deepEqual(Object.keys(invalid).sort(), [...LANDING_CONTRACT_KINDS].sort());
  for (const kind of LANDING_CONTRACT_KINDS) {
    assert.deepEqual(validate(kind, valid[kind]), [], kind);
    assert.equal(valid[kind].kind, kind);
    assert.equal(valid[kind].schemaVersion, '1.0.0');
    assert.equal(valid[kind].protocolVersion, '1.2.0');
    assert.equal(schema(kind).additionalProperties, false, `${kind}: closed root`);
  }
});

test('the distinct landing workflow catalog and deterministic-asset manifest are closed and byte-current', () => {
  const catalog = readLandingWorkflowCatalog();
  const manifest = readLandingWorkflowManifest();
  assert.deepEqual(validate('landing-workflow-catalog', catalog), []);
  assert.deepEqual(catalog.workflow.commands.map(({ id }) => id), ['prepare', 'show', 'status', 'advance']);
  assert.deepEqual(catalog.workflow.hostAssets.map(({ runtime }) => runtime), ['claude-code', 'codex', 'cursor']);
  assert.deepEqual(manifest.assets.map(({ path }) => path), LANDING_WORKFLOW_ASSET_PATHS);
  assert.equal(Object.isFrozen(assertLandingWorkflowCatalog(catalog)), true);
  assert.equal(Object.isFrozen(assertLandingWorkflowManifest(manifest, { verifyFiles: true })), true);

  const widened = structuredClone(catalog);
  widened.workflow.commands.push(structuredClone(widened.workflow.commands[0]));
  assert.throws(() => assertLandingWorkflowCatalog(widened), { code: 'E_LANDING_WORKFLOW_CATALOG_INVALID' });
  const substituted = structuredClone(manifest);
  substituted.assets[0].path = 'lib/pipeline/foreign-landing.mjs';
  assert.throws(() => assertLandingWorkflowManifest(substituted), { code: 'E_LANDING_WORKFLOW_MANIFEST_INVALID' });
});

test('every required root field fails closed and every unknown-field hostile is rejected', () => {
  for (const kind of LANDING_CONTRACT_KINDS) {
    for (const field of schema(kind).required) {
      const candidate = structuredClone(valid[kind]);
      delete candidate[field];
      assert.ok(validate(kind, candidate).length > 0, `${kind}:${field}`);
    }
    const unknown = invalid[kind].find(({ name }) => name === 'unknown field');
    assert.ok(unknown, `${kind}: unknown-field fixture`);
    assert.ok(validate(kind, applyDescriptor(valid[kind], unknown)).length > 0, `${kind}: closed unknown`);
  }
});

test('all schema-level hostile mutations are rejected', () => {
  for (const kind of LANDING_CONTRACT_KINDS) {
    for (const descriptor of invalid[kind].filter(({ expectedLayer }) => expectedLayer === 'schema')) {
      assert.ok(validate(kind, applyDescriptor(valid[kind], descriptor)).length > 0, `${kind}: ${descriptor.name}`);
    }
  }
});

test('landing consumes only explicit passing SHIP closure receipts across supported schema revisions', () => {
  for (const kind of ['landing-plan', 'landing-receipt']) {
    for (const schemaVersion of ['1.0.0', '1.1.0', '1.2.0']) {
      const candidate = structuredClone(valid[kind]);
      candidate.shipClosure.schemaVersion = schemaVersion;
      assert.deepEqual(validate(kind, candidate), [], `${kind}:ship-closure@${schemaVersion}`);
      assert.equal(candidate.shipClosure.protocolVersion, '1.1.0');
      assert.equal(candidate.shipClosure.recordType, 'receipt');
      assert.equal(candidate.shipClosure.terminalStatus, 'passed');
    }
  }
});

test('portable plans, confirmations, receipts, and registry rows grant no effect authority', () => {
  const plan = valid['landing-plan'];
  const confirmation = valid['landing-confirmation'];
  const receipt = valid['landing-receipt'];
  const registry = valid['landing-operation-registry'];
  assert.equal(plan.authority, 'none');
  assert.equal(confirmation.authority, 'none');
  assert.equal(receipt.authority, 'none');
  assert.equal(receipt.recovery.authority, 'none');
  assert.equal(registry.authority, 'none');
  assert.ok(registry.operations.every(({ portableAuthority, runtimeAdapterRequired }) => (
    portableAuthority === 'none' && runtimeAdapterRequired === true
  )));
  assert.equal(plan.operations[0].containment.authority, 'containment-only');
  assert.equal(confirmation.docket.authorityBoundary, 'portable-confirmation-is-not-effect-authority');
});

test('owner confirmation presents a neutral docket with no default or cancellation effect', () => {
  const confirmation = valid['landing-confirmation'];
  assert.deepEqual(confirmation.docket.choices, ['confirm', 'cancel']);
  assert.equal(confirmation.docket.defaultChoice, null);
  assert.equal(confirmation.docket.cancelEffect, 'none');
  assert.equal(confirmation.choice, 'confirm');
  assert.equal(confirmation.currentTargetHash, confirmation.docket.currentTargetHash);
  assert.deepEqual(confirmation.operationIds, confirmation.docket.operationIds);
  assert.deepEqual(confirmation.effectSet, confirmation.docket.effectSet);
});

test('a changed docket under one confirmation identity remains a custody conflict, not new authority', () => {
  const descriptor = invalid['landing-confirmation']
    .find(({ expectedLayer }) => expectedLayer === 'custody-conflict');
  assert.ok(descriptor, 'changed-docket fixture');
  const base = valid['landing-confirmation'];
  const divergent = applyDescriptor(base, descriptor);
  assert.deepEqual(validate(base.kind, divergent), [], 'both records remain structurally valid');
  assert.equal(divergent.confirmationId, base.confirmationId);
  assert.equal(divergent.confirmationHash, base.confirmationHash);
  assert.notEqual(divergent.docket.currentTargetHash, base.docket.currentTargetHash);
  assert.notDeepEqual(divergent, base);
});

test('structurally valid plan, registration, and receipt substitutions remain semantic binding conflicts', () => {
  for (const kind of ['landing-plan', 'landing-confirmation', 'landing-phase-receipt', 'landing-receipt']) {
    const descriptor = invalid[kind].find(({ expectedLayer }) => expectedLayer === 'binding-conflict');
    assert.ok(descriptor, `${kind}: binding-conflict fixture`);
    const divergent = applyDescriptor(valid[kind], descriptor);
    assert.deepEqual(validate(kind, divergent), [], `${kind}: structurally valid substitution`);
    assert.notDeepEqual(divergent, valid[kind]);
  }
});

test('deploy plans require preconfirmed containment before any dispatch', () => {
  const operation = valid['landing-plan'].operations[0];
  assert.equal(operation.kind, 'deploy');
  assert.equal(operation.containment.state, 'preconfirmed');
  assert.equal(operation.containment.stopPromotion, true);
  assert.equal(operation.containment.stopNewTraffic, true);
  assert.equal(operation.containment.isolateFailedTarget, true);
  assert.equal(operation.containment.authority, 'containment-only');

  const hostile = invalid['landing-plan'].find(({ name }) => name === 'deploy without preconfirmed containment');
  assert.ok(validate('landing-plan', applyDescriptor(valid['landing-plan'], hostile)).length > 0);
});

test('a failed canary closes the phase as recovery_required without granting rollback authority', () => {
  const phase = valid['landing-phase-receipt'];
  const receipt = valid['landing-receipt'];
  assert.equal(phase.canary.status, 'failed');
  assert.equal(phase.status, 'recovery_required');
  assert.equal(phase.containment.applied, true);
  assert.equal(phase.recovery.state, 'recovery_required');
  assert.equal(phase.recovery.authority, 'none');
  assert.equal(phase.recovery.defaultChoice, null);
  assert.deepEqual(phase.recovery.choices, ['rollback', 'forward-fix']);
  assert.equal(receipt.status, 'recovery_required');
  assert.equal(receipt.recovery.required, true);
  assert.equal(receipt.recovery.authority, 'none');
  assert.equal(receipt.recovery.defaultChoice, null);
});

test('operation registry versions are exact, data-only, and non-executable', () => {
  const registry = valid['landing-operation-registry'];
  assert.equal(registry.registryVersion, '1.0.0');
  assert.equal(registry.operations[0].operationVersion, '1.0.0');
  assert.deepEqual(registry.operations[0].inputContract, {
    schemaId: 'landing-plan', schemaVersion: '1.0.0', protocolVersion: '1.2.0',
  });
  assert.deepEqual(registry.operations[0].outputContract, {
    schemaId: 'landing-phase-receipt', schemaVersion: '1.0.0', protocolVersion: '1.2.0',
  });
  assert.doesNotMatch(JSON.stringify(registry), /modulePath|sourcePath|credential|capability/ui);
  for (const name of ['unsupported registry version', 'operation carries executable implementation']) {
    const hostile = invalid['landing-operation-registry'].find((entry) => entry.name === name);
    assert.ok(validate(registry.kind, applyDescriptor(registry, hostile)).length > 0, name);
  }
});
