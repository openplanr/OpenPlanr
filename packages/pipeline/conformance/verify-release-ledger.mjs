#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadReleaseLedgerContract, validateProtocolArtifact } from 'planr-pipeline/protocol';
import {
  assertEcosystemManifestProjection,
  assertPipelineCompatibilityDeclaration,
  assertReleaseCompatibilityClaim,
  assertReleaseLedger,
  assertReleaseLedgerReceipt,
  RELEASE_MANIFEST_CLAIM_EDGES,
  RELEASE_REPOSITORY_KEYS,
  releaseClaimSetDigest,
  releaseLedgerAbsence,
  releaseLedgerIdentity,
  renderCompatibilityDisplay,
} from '../lib/ecosystem/release-ledger.mjs';

const VERSION = '1.3.0';
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const fixtureRoot = join(root, 'conformance', 'fixtures', 'release-ledger');
let checks = 0;

function pass(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function fixture(name) {
  return JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8'));
}

function locate(container, segments) {
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
      const target = locate(clone, segments);
      assert.ok(Array.isArray(target), `append expects an array at ${path}`);
      target.push(structuredClone(value));
      continue;
    }
    const key = segments.pop();
    const target = locate(clone, segments);
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

const valid = fixture('ledger-valid.json');
const invalid = fixture('ledger-invalid.json');
const claimsValid = fixture('compatibility-claims-valid.json');
const claimsInvalid = fixture('compatibility-claims-invalid.json');

const ledger = valid['release-ledger'];
const receipt = valid['release-ledger-receipt'];
const manifest = valid['ecosystem-manifest'];
const claims = claimsValid.claimSet;

const validators = {
  'release-ledger': (record) => assertReleaseLedger(record),
  'release-compatibility-claim': (record) => assertReleaseCompatibilityClaim(record, { ledger }),
  'release-ledger-receipt': (record) => assertReleaseLedgerReceipt(record, { ledger, claims }),
};
const records = {
  'release-ledger': ledger,
  'release-compatibility-claim': claimsValid['release-compatibility-claim'],
  'release-ledger-receipt': receipt,
};
const refusals = { ...invalid, ...claimsInvalid };

let refusedShapes = 0;
let custodyRefusals = 0;

for (const [kind, record] of Object.entries(records)) {
  const resolved = loadReleaseLedgerContract(kind, { protocolVersion: VERSION });
  pass(
    resolved.kind === kind &&
      resolved.protocolVersion === VERSION &&
      resolved.path === `schemas/v${VERSION}/${kind}.schema.json` &&
      resolved.schema.$id === `https://openplanr.dev/schemas/v${VERSION}/${kind}.schema.json`,
    `${kind} resolves at the explicit contract version`,
  );
  pass(
    throws(() => loadReleaseLedgerContract(kind)),
    `${kind} refuses an implicit contract version`,
  );
  pass(
    throws(() => loadReleaseLedgerContract(kind, { protocolVersion: '1.2.0' })),
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

  const identity = releaseLedgerIdentity(record, kind);
  pass(
    record[identity.idField] === identity.id && record[identity.digestField] === identity.digest,
    `the reference ${kind} derives both identity fields by omitting both`,
  );

  const cases = refusals[kind] ?? [];
  pass(cases.length > 0, `${kind} declares at least one refused shape`);
  for (const refusal of cases) {
    const candidate = mutate(record, refusal.operations);
    pass(
      refusalCode(validators[kind], candidate) === refusal.code,
      `${kind} refuses ${refusal.name} with ${refusal.code}`,
    );
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

// The published claim set is exactly the edges the manifest renders, and every
// rendered range equals the deterministic render of its bound rows.
pass(
  claims.length === RELEASE_MANIFEST_CLAIM_EDGES.length,
  'every manifest compatibility edge carries a bound claim',
);
for (const claim of claims) {
  pass(
    refusalCode((record) => assertReleaseCompatibilityClaim(record, { ledger }), claim) === null,
    `claim ${claim.claimId} binds the ledger it names`,
  );
  const producerRow = ledger.rows.find(
    ({ repositoryKey }) => repositoryKey === claim.producer.repositoryKey,
  );
  pass(
    claim.producer.payloadDigest === producerRow.payloadDigest &&
      claim.producer.terminalReceiptDigest === producerRow.terminalReceipt.digest &&
      claim.display ===
        renderCompatibilityDisplay({
          derivation: claim.derivation,
          declaredVersion: producerRow.declaredVersion,
        }),
    `claim ${claim.claimId} resolves to an exact payload digest and terminal receipt digest`,
  );
}

const projection = assertEcosystemManifestProjection({ ledger, claims, manifest });
pass(
  projection.claimSetDigest === releaseClaimSetDigest(claims),
  'the manifest projection binds the exact claim set',
);
pass(
  projection.projected.length === RELEASE_MANIFEST_CLAIM_EDGES.length,
  'the manifest projection covers every published edge',
);
pass(
  refusalCode((record) => assertEcosystemManifestProjection({ ledger, claims, manifest: record }), {
    ...manifest,
    components: {
      ...manifest.components,
      cli: { ...manifest.components.cli, pipelineRange: '^9.9.9' },
    },
  }) === 'E_RELEASE_LEDGER_MANIFEST_DRIFT',
  'a hand-edited manifest range is a typed drift refusal, never a re-render',
);

// A verification receipt carries no authority and can never be the receipt that
// certified a repository's bytes.
const selfCertifying = structuredClone(ledger);
selfCertifying.rows[0].terminalReceipt.digest = receipt.receiptDigest;
const selfIdentity = releaseLedgerIdentity(selfCertifying, 'release-ledger');
selfCertifying.ledgerId = selfIdentity.id;
selfCertifying.ledgerDigest = selfIdentity.digest;
pass(
  refusalCode(
    (record) => assertReleaseLedgerReceipt(record, { ledger: selfCertifying, claims }),
    receipt,
  ) === 'E_RELEASE_LEDGER_SELF_CERTIFIED',
  'a ledger can never supply its own certifying receipt',
);
pass(
  receipt.authority === 'none' && receipt.recordType === 'verification',
  'a ledger receipt records a verification outcome and no authority',
);

// The skills compatibility declaration is a label resolved against bound bytes.
const pipelineRow = ledger.rows.find(({ repositoryKey }) => repositoryKey === 'pipeline');
pass(
  assertPipelineCompatibilityDeclaration(`planr-pipeline@${pipelineRow.declaredVersion}`, {
    ledger,
    pipelinePayloadDigest: pipelineRow.payloadDigest,
  }).payloadDigest === pipelineRow.payloadDigest,
  'a compatibility declaration that corresponds to the bound payload bytes resolves',
);
pass(
  refusalCode(
    (record) =>
      assertPipelineCompatibilityDeclaration(record, {
        ledger,
        pipelinePayloadDigest: pipelineRow.payloadDigest,
      }),
    'planr-pipeline@9.9.9',
  ) === 'E_RELEASE_LEDGER_CLAIM_DRIFT',
  'a compatibility declaration that disagrees with the bound payload bytes is refused',
);
pass(
  refusalCode(
    (record) =>
      assertPipelineCompatibilityDeclaration(record, {
        ledger,
        pipelinePayloadDigest: receipt.receiptDigest,
      }),
    `planr-pipeline@${pipelineRow.declaredVersion}`,
  ) === 'E_RELEASE_LEDGER_CLAIM_UNBOUND',
  'a compatibility declaration resolved against foreign payload bytes is refused',
);

// An absent input is named. It never resolves to a permissive default or a passing claim.
const absence = releaseLedgerAbsence({
  input: 'payload.skills',
  reason: 'payload-proof-not-supplied',
  repositoryKey: 'skills',
});
pass(
  absence.resolved === false && absence.reason === 'payload-proof-not-supplied',
  'a missing ledger input is a typed absence with an explicit reason',
);
pass(
  throws(() => releaseLedgerAbsence({ input: 'payload.skills', reason: 'probably-fine' })),
  'an unnamed absence reason is refused',
);
pass(
  RELEASE_REPOSITORY_KEYS.length === ledger.rows.length,
  'the ledger carries one row per frozen release repository key',
);

// The emitted marketplace manifest is the artifact this contract closes over, so
// it is validated as emitted rather than through a synthetic stand-in.
const emittedManifestPath = resolve(root, '..', 'marketplace', 'ecosystem.json');
let emittedManifestChecked = false;
if (existsSync(emittedManifestPath)) {
  const emitted = JSON.parse(readFileSync(emittedManifestPath, 'utf8'));
  pass(
    validateProtocolArtifact('ecosystem-manifest', emitted, { protocolVersion: VERSION }).length ===
      0,
    'the emitted marketplace ecosystem manifest satisfies the manifest contract it is published under',
  );
  emittedManifestChecked = true;
}

// Derivation is the deterministic path, so it may reach nothing that could make a
// network call, spawn a process, write a file, or read ambient configuration.
const derivationSource = readFileSync(join(root, 'lib', 'ecosystem', 'release-ledger.mjs'), 'utf8');
for (const reach of [
  'fetch(',
  'process.env',
  'child_process',
  'node:fs',
  'node:http',
  'node:net',
  'spawnSync',
  'writeFileSync',
]) {
  pass(!derivationSource.includes(reach), `the derivation library makes no ${reach} reach`);
}

for (const name of [
  'ledger-valid.json',
  'ledger-invalid.json',
  'compatibility-claims-valid.json',
  'compatibility-claims-invalid.json',
]) {
  const serialized = readFileSync(join(fixtureRoot, name), 'utf8');
  for (const forbidden of ['BEGIN RSA', 'BEGIN PRIVATE KEY', 'AKIA', 'ghp_', 'xoxb-']) {
    pass(!serialized.includes(forbidden), `${name} carries no ${forbidden} credential material`);
  }
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    protocolVersion: VERSION,
    suite: 'release-ledger',
    contracts: Object.keys(records).length,
    claims: claims.length,
    refusedShapes,
    custodyRefusals,
    emittedManifestChecked,
    checks,
  })}\n`,
);
