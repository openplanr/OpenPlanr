import { sha256Jcs } from '../protocol/jcs.mjs';
import { RELEASE_REPOSITORY_KEYS, releaseProofDigests } from './release-package-proof.mjs';

export { RELEASE_REPOSITORY_KEYS };

export const RELEASE_LEDGER_SCHEMA_VERSION = '1.3.0';
export const RELEASE_LEDGER_MANIFEST_SCHEMA_VERSION = '1.1.0';

export const RELEASE_LEDGER_DERIVATIONS = Object.freeze([
  'caret-range-from-producer-declared-version',
  'exact-producer-declared-version',
]);

/** Every reason a ledger input can be absent. An absence is named, never inferred. */
export const RELEASE_LEDGER_ABSENCE_REASONS = Object.freeze([
  'input-missing',
  'input-unreadable',
  'payload-proof-not-supplied',
  'terminal-receipt-absent',
  'repository-dirty',
  'repository-not-discovered',
]);

/** Self-digest field pair per ledger contract kind; both fields are omitted before hashing. */
export const RELEASE_LEDGER_IDENTITY_BINDINGS = Object.freeze({
  'release-ledger': Object.freeze({ prefix: 'rlg', idField: 'ledgerId', digestField: 'ledgerDigest' }),
  'release-compatibility-claim': Object.freeze({ prefix: 'rcc', idField: 'claimId', digestField: 'claimDigest' }),
  'release-ledger-receipt': Object.freeze({ prefix: 'rlr', idField: 'receiptId', digestField: 'receiptDigest' }),
});

/**
 * The closed set of compatibility edges the published ecosystem manifest renders.
 * Each edge names the manifest field, the two ledger rows it binds, and the
 * derivation used, so a rendered range is checkable rather than authored.
 */
export const RELEASE_MANIFEST_CLAIM_EDGES = Object.freeze([
  Object.freeze({ path: 'components.cli.pipelineRange', consumer: 'cli', producer: 'pipeline', derivation: 'caret-range-from-producer-declared-version' }),
  Object.freeze({ path: 'components.pipeline.cliRange', consumer: 'pipeline', producer: 'cli', derivation: 'caret-range-from-producer-declared-version' }),
  Object.freeze({ path: 'components.skills.cliRange', consumer: 'skills', producer: 'cli', derivation: 'caret-range-from-producer-declared-version' }),
  Object.freeze({ path: 'adapters[].pipelineRange', consumer: 'marketplace', producer: 'pipeline', derivation: 'caret-range-from-producer-declared-version' }),
]);

const MANIFEST_COMPONENT_KEYS = Object.freeze(['cli', 'pipeline', 'skills', 'marketplace']);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const PACKAGE_NAME = /^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/u;
const PIPELINE_COMPATIBILITY = /^planr-pipeline@([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)$/u;

const ROW_FIELDS = Object.freeze([
  'repositoryKey',
  'packageName',
  'declaredVersion',
  'baselineCommit',
  'clean',
  'sourceInventoryDigest',
  'payloadDigest',
  'exportSurfaceDigest',
  'terminalReceipt',
]);

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function plainObject(value, label, code = 'E_RELEASE_LEDGER_CONTRACT_INVALID') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, `${label} must be one JSON object.`);
  }
  return value;
}

function exact(value, fields, label, code = 'E_RELEASE_LEDGER_CONTRACT_INVALID') {
  plainObject(value, label, code);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(code, `${label} has missing or unknown fields.`, { expected, actual });
  }
  return value;
}

function digest(value, label, code = 'E_RELEASE_LEDGER_CONTRACT_INVALID') {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    fail(code, `${label} must be an exact SHA-256 digest.`);
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail('E_RELEASE_LEDGER_CONTRACT_INVALID', `${label} must be one canonical RFC 3339 timestamp.`);
  }
  return value;
}

function bindingFor(kind) {
  if (!Object.prototype.hasOwnProperty.call(RELEASE_LEDGER_IDENTITY_BINDINGS, kind)) {
    fail('E_RELEASE_LEDGER_CONTRACT_INVALID', `Contract kind "${String(kind)}" has no release-ledger identity binding.`);
  }
  return RELEASE_LEDGER_IDENTITY_BINDINGS[kind];
}

/** Identity and digest a record of this kind must carry, derived from its own canonical bytes. */
export function releaseLedgerIdentity(value, kind) {
  const binding = bindingFor(kind);
  plainObject(value, `${kind} record`);
  const payload = { ...value };
  delete payload[binding.idField];
  delete payload[binding.digestField];
  const selfDigest = sha256Jcs(payload);
  return Object.freeze({
    id: `${binding.prefix}_${selfDigest.slice(7, 39)}`,
    digest: selfDigest,
    idField: binding.idField,
    digestField: binding.digestField,
  });
}

export function assertReleaseLedgerIdentity(value, kind) {
  const derived = releaseLedgerIdentity(value, kind);
  if (value[derived.digestField] !== derived.digest) {
    fail('E_RELEASE_LEDGER_DIGEST_MISMATCH', `${kind}.${derived.digestField} does not bind this record's canonical bytes.`, {
      expected: derived.digest,
      actual: value[derived.digestField] ?? null,
    });
  }
  if (value[derived.idField] !== derived.id) {
    fail('E_RELEASE_LEDGER_IDENTITY_FOREIGN', `${kind}.${derived.idField} is a foreign identity for these bytes.`, {
      expected: derived.id,
      actual: value[derived.idField] ?? null,
    });
  }
  return value;
}

/** The only rendering a compatibility claim may display for a bound producer row. */
export function renderCompatibilityDisplay({ derivation, declaredVersion }) {
  if (!RELEASE_LEDGER_DERIVATIONS.includes(derivation)) {
    fail('E_RELEASE_LEDGER_CONTRACT_INVALID', `Derivation "${String(derivation)}" is not a published compatibility derivation.`);
  }
  if (typeof declaredVersion !== 'string' || !VERSION.test(declaredVersion)) {
    fail('E_RELEASE_LEDGER_CONTRACT_INVALID', 'A compatibility rendering requires the producer row declared version.');
  }
  return derivation === 'caret-range-from-producer-declared-version' ? `^${declaredVersion}` : declaredVersion;
}

function assertRow(value, label) {
  exact(value, ROW_FIELDS, label, 'E_RELEASE_LEDGER_ROW_INVALID');
  if (!RELEASE_REPOSITORY_KEYS.includes(value.repositoryKey)) {
    fail('E_RELEASE_LEDGER_FOREIGN_REPOSITORY', `${label}.repositoryKey is not a frozen release repository key.`, {
      expected: [...RELEASE_REPOSITORY_KEYS],
      actual: value.repositoryKey ?? null,
    });
  }
  if (typeof value.packageName !== 'string' || !PACKAGE_NAME.test(value.packageName)) {
    fail('E_RELEASE_LEDGER_ROW_INVALID', `${label}.packageName is not a package identity.`);
  }
  if (typeof value.declaredVersion !== 'string' || !VERSION.test(value.declaredVersion)) {
    fail('E_RELEASE_LEDGER_ROW_INVALID', `${label}.declaredVersion is not a version label.`);
  }
  if (typeof value.baselineCommit !== 'string' || !COMMIT.test(value.baselineCommit)) {
    fail('E_RELEASE_LEDGER_ROW_INVALID', `${label}.baselineCommit is not a full commit identity.`);
  }
  if (value.clean !== true) {
    fail('E_RELEASE_LEDGER_ROW_INVALID', `${label}.clean must record a clean baseline; a dirty tree is a typed absence, never a row.`);
  }
  for (const field of ['sourceInventoryDigest', 'payloadDigest', 'exportSurfaceDigest']) {
    digest(value[field], `${label}.${field}`, 'E_RELEASE_LEDGER_ROW_INVALID');
  }
  exact(value.terminalReceipt, ['digest', 'state', 'boundPayloadDigest'], `${label}.terminalReceipt`, 'E_RELEASE_LEDGER_ROW_INVALID');
  digest(value.terminalReceipt.digest, `${label}.terminalReceipt.digest`, 'E_RELEASE_LEDGER_ROW_INVALID');
  digest(value.terminalReceipt.boundPayloadDigest, `${label}.terminalReceipt.boundPayloadDigest`, 'E_RELEASE_LEDGER_ROW_INVALID');
  if (value.terminalReceipt.state !== 'closed') {
    fail('E_RELEASE_LEDGER_RECEIPT_FOREIGN', `${label}.terminalReceipt is not terminal.`, { state: value.terminalReceipt.state ?? null });
  }
  if (value.terminalReceipt.boundPayloadDigest !== value.payloadDigest) {
    fail('E_RELEASE_LEDGER_RECEIPT_FOREIGN', `${label}.terminalReceipt certifies a different payload than this row.`, {
      expected: value.payloadDigest,
      actual: value.terminalReceipt.boundPayloadDigest,
    });
  }
  return value;
}

export function assertReleaseLedger(value) {
  exact(value, ['kind', 'schemaVersion', 'generatedAt', 'repositoryKeys', 'rows', 'manifestBinding', 'ledgerId', 'ledgerDigest'], 'release ledger');
  if (value.kind !== 'release-ledger' || value.schemaVersion !== RELEASE_LEDGER_SCHEMA_VERSION) {
    fail('E_RELEASE_LEDGER_CONTRACT_INVALID', 'Release ledger identity is unsupported.');
  }
  timestamp(value.generatedAt, 'release ledger generatedAt');
  if (JSON.stringify(value.repositoryKeys) !== JSON.stringify([...RELEASE_REPOSITORY_KEYS])) {
    fail('E_RELEASE_LEDGER_FOREIGN_REPOSITORY', 'Release ledger does not declare the frozen repository key order.');
  }
  if (!Array.isArray(value.rows) || value.rows.length !== RELEASE_REPOSITORY_KEYS.length) {
    fail('E_RELEASE_LEDGER_CONTRACT_INVALID', 'Release ledger must carry exactly one row per frozen repository key.');
  }
  const seen = new Set();
  value.rows.forEach((row, index) => {
    assertRow(row, `release ledger rows[${index}]`);
    if (seen.has(row.repositoryKey)) {
      fail('E_RELEASE_LEDGER_DUPLICATE_ROW', `Release ledger repeats repository ${row.repositoryKey}.`);
    }
    seen.add(row.repositoryKey);
    if (row.repositoryKey !== RELEASE_REPOSITORY_KEYS[index]) {
      fail('E_RELEASE_LEDGER_CONTRACT_INVALID', 'Release ledger rows must use the frozen repository key order.');
    }
  });
  exact(value.manifestBinding, ['manifestDigest', 'manifestSchemaVersion'], 'release ledger manifestBinding');
  digest(value.manifestBinding.manifestDigest, 'release ledger manifestBinding.manifestDigest');
  if (value.manifestBinding.manifestSchemaVersion !== RELEASE_LEDGER_MANIFEST_SCHEMA_VERSION) {
    fail('E_RELEASE_LEDGER_MANIFEST_DRIFT', 'Release ledger binds a manifest revision this contract does not close over.');
  }
  return assertReleaseLedgerIdentity(value, 'release-ledger');
}

function ledgerRow(ledger, repositoryKey, label) {
  const row = ledger.rows.find((entry) => entry.repositoryKey === repositoryKey);
  if (!row) {
    fail('E_RELEASE_LEDGER_CLAIM_UNBOUND', `${label} names repository ${repositoryKey}, which the bound ledger has no row for.`);
  }
  return row;
}

function assertSideBinding(side, ledger, label) {
  const row = ledgerRow(ledger, side.repositoryKey, label);
  if (side.payloadDigest !== row.payloadDigest) {
    fail('E_RELEASE_LEDGER_CLAIM_UNBOUND', `${label} does not bind the ledger payload digest for ${side.repositoryKey}.`, {
      expected: row.payloadDigest,
      actual: side.payloadDigest,
    });
  }
  if (side.terminalReceiptDigest !== row.terminalReceipt.digest) {
    fail('E_RELEASE_LEDGER_RECEIPT_FOREIGN', `${label} binds a receipt that did not certify the ${side.repositoryKey} payload.`, {
      expected: row.terminalReceipt.digest,
      actual: side.terminalReceiptDigest,
    });
  }
  return row;
}

export function assertReleaseCompatibilityClaim(value, { ledger } = {}) {
  exact(value, ['kind', 'schemaVersion', 'ledgerDigest', 'consumer', 'producer', 'derivation', 'display', 'claimId', 'claimDigest'], 'compatibility claim');
  if (value.kind !== 'release-compatibility-claim' || value.schemaVersion !== RELEASE_LEDGER_SCHEMA_VERSION) {
    fail('E_RELEASE_LEDGER_CONTRACT_INVALID', 'Compatibility claim identity is unsupported.');
  }
  digest(value.ledgerDigest, 'compatibility claim ledgerDigest');
  exact(value.consumer, ['repositoryKey', 'payloadDigest', 'terminalReceiptDigest'], 'compatibility claim consumer');
  exact(value.producer, ['repositoryKey', 'payloadDigest', 'terminalReceiptDigest', 'declaredVersion'], 'compatibility claim producer');
  for (const side of ['consumer', 'producer']) {
    if (!RELEASE_REPOSITORY_KEYS.includes(value[side].repositoryKey)) {
      fail('E_RELEASE_LEDGER_FOREIGN_REPOSITORY', `compatibility claim ${side}.repositoryKey is not a frozen release repository key.`);
    }
    digest(value[side].payloadDigest, `compatibility claim ${side}.payloadDigest`);
    digest(value[side].terminalReceiptDigest, `compatibility claim ${side}.terminalReceiptDigest`);
  }
  if (value.consumer.repositoryKey === value.producer.repositoryKey) {
    fail('E_RELEASE_LEDGER_CONTRACT_INVALID', 'A repository cannot state its own compatibility with itself.');
  }

  const bound = plainObject(ledger, 'bound ledger', 'E_RELEASE_LEDGER_INPUT_ABSENT');
  assertReleaseLedger(bound);
  if (value.ledgerDigest !== bound.ledgerDigest) {
    fail('E_RELEASE_LEDGER_CLAIM_UNBOUND', 'Compatibility claim is bound to a different ledger.', {
      expected: bound.ledgerDigest,
      actual: value.ledgerDigest,
    });
  }
  assertSideBinding(value.consumer, bound, 'compatibility claim consumer');
  const producerRow = assertSideBinding(value.producer, bound, 'compatibility claim producer');
  if (value.producer.declaredVersion !== producerRow.declaredVersion) {
    fail('E_RELEASE_LEDGER_CLAIM_DRIFT', 'Compatibility claim carries a version label the bound producer row does not.', {
      expected: producerRow.declaredVersion,
      actual: value.producer.declaredVersion,
    });
  }
  const rendered = renderCompatibilityDisplay({
    derivation: value.derivation,
    declaredVersion: producerRow.declaredVersion,
  });
  if (value.display !== rendered) {
    fail('E_RELEASE_LEDGER_CLAIM_DRIFT', 'Compatibility claim display does not equal the deterministic render of its bound rows.', {
      expected: rendered,
      actual: value.display,
    });
  }
  // Identity is asserted last so an edited version label or rendered range is
  // reported as the drift it is, rather than as an unrecomputed digest.
  return assertReleaseLedgerIdentity(value, 'release-compatibility-claim');
}

/** Canonical digest over an ordered claim set; ordering is part of the identity. */
export function releaseClaimSetDigest(claims) {
  if (!Array.isArray(claims)) {
    fail('E_RELEASE_LEDGER_CONTRACT_INVALID', 'A claim set must be an array of compatibility claims.');
  }
  return sha256Jcs(claims.map((claim) => claim.claimDigest ?? null));
}

export function assertReleaseLedgerReceipt(value, { ledger, claims } = {}) {
  exact(value, ['kind', 'schemaVersion', 'recordType', 'authority', 'issuedAt', 'ledgerDigest', 'claimSetDigest', 'result', 'refusals', 'receiptId', 'receiptDigest'], 'ledger receipt');
  if (
    value.kind !== 'release-ledger-receipt'
    || value.schemaVersion !== RELEASE_LEDGER_SCHEMA_VERSION
    || value.recordType !== 'verification'
    || value.authority !== 'none'
  ) {
    fail('E_RELEASE_LEDGER_CONTRACT_INVALID', 'Ledger receipt identity is unsupported.');
  }
  timestamp(value.issuedAt, 'ledger receipt issuedAt');
  digest(value.ledgerDigest, 'ledger receipt ledgerDigest');
  digest(value.claimSetDigest, 'ledger receipt claimSetDigest');
  if (!['verified', 'refused'].includes(value.result)) {
    fail('E_RELEASE_LEDGER_CONTRACT_INVALID', 'Ledger receipt result is unsupported.');
  }
  if (!Array.isArray(value.refusals) || (value.result === 'verified') !== (value.refusals.length === 0)) {
    fail('E_RELEASE_LEDGER_CONTRACT_INVALID', 'Ledger receipt refusals do not match its stated result.');
  }
  value.refusals.forEach((refusal, index) => {
    exact(refusal, ['code', 'repositoryKey', 'reason'], `ledger receipt refusals[${index}]`);
    if (typeof refusal.code !== 'string' || !refusal.code.startsWith('E_RELEASE_LEDGER_')) {
      fail('E_RELEASE_LEDGER_CONTRACT_INVALID', `ledger receipt refusals[${index}].code is outside the ledger error family.`);
    }
    if (refusal.repositoryKey !== null && !RELEASE_REPOSITORY_KEYS.includes(refusal.repositoryKey)) {
      fail('E_RELEASE_LEDGER_FOREIGN_REPOSITORY', `ledger receipt refusals[${index}].repositoryKey is not a frozen release repository key.`);
    }
    if (typeof refusal.reason !== 'string' || refusal.reason.length === 0) {
      fail('E_RELEASE_LEDGER_CONTRACT_INVALID', `ledger receipt refusals[${index}].reason must name the refusal.`);
    }
  });
  const bound = plainObject(ledger, 'bound ledger', 'E_RELEASE_LEDGER_INPUT_ABSENT');
  assertReleaseLedger(bound);
  // A verification outcome carries no authority, so it is refused before any
  // other binding is considered when a row cites it as the receipt that
  // certified that repository's bytes.
  const selfCertified = bound.rows.find((row) => row.terminalReceipt.digest === value.receiptDigest);
  if (selfCertified) {
    fail('E_RELEASE_LEDGER_SELF_CERTIFIED', `Repository ${selfCertified.repositoryKey} cites this verification receipt as its terminal receipt.`);
  }
  if (value.ledgerDigest !== bound.ledgerDigest) {
    fail('E_RELEASE_LEDGER_CLAIM_UNBOUND', 'Ledger receipt is bound to a different ledger.');
  }
  if (value.claimSetDigest !== releaseClaimSetDigest(claims ?? [])) {
    fail('E_RELEASE_LEDGER_CLAIM_UNBOUND', 'Ledger receipt does not bind the exact claim set it reports on.');
  }
  return assertReleaseLedgerIdentity(value, 'release-ledger-receipt');
}

function manifestValue(manifest, path) {
  return path.split('.').reduce((value, part) => value?.[part], manifest);
}

/**
 * Verify that every rendered compatibility statement in the published manifest is
 * the deterministic render of a digest-bound claim, and that every version field
 * is the label carried by its ledger row.
 */
export function assertEcosystemManifestProjection({ ledger, claims, manifest } = {}) {
  const bound = plainObject(ledger, 'bound ledger', 'E_RELEASE_LEDGER_INPUT_ABSENT');
  assertReleaseLedger(bound);
  plainObject(manifest, 'ecosystem manifest', 'E_RELEASE_LEDGER_INPUT_ABSENT');
  if (!Array.isArray(claims)) {
    fail('E_RELEASE_LEDGER_INPUT_ABSENT', 'A manifest projection requires the claim set it is derived from.');
  }
  if (sha256Jcs(manifest) !== bound.manifestBinding.manifestDigest) {
    fail('E_RELEASE_LEDGER_MANIFEST_DRIFT', 'The ecosystem manifest bytes are not the bytes this ledger binds.');
  }

  const projected = [];
  for (const edge of RELEASE_MANIFEST_CLAIM_EDGES) {
    const claim = claims.find((entry) => (
      entry?.consumer?.repositoryKey === edge.consumer
      && entry?.producer?.repositoryKey === edge.producer
      && entry?.derivation === edge.derivation
    ));
    if (!claim) {
      fail('E_RELEASE_LEDGER_CLAIM_UNBOUND', `The manifest renders ${edge.path} with no digest-bound claim behind it.`);
    }
    assertReleaseCompatibilityClaim(claim, { ledger: bound });
    const rendered = edge.path.endsWith('[].pipelineRange')
      ? (manifest.adapters ?? []).map((adapter) => adapter?.pipelineRange)
      : [manifestValue(manifest, edge.path)];
    if (rendered.length === 0) {
      fail('E_RELEASE_LEDGER_MANIFEST_DRIFT', `The manifest renders nothing at ${edge.path}.`);
    }
    for (const value of rendered) {
      if (value !== claim.display) {
        fail('E_RELEASE_LEDGER_MANIFEST_DRIFT', `The manifest renders ${edge.path} as text the bound claim does not derive.`, {
          expected: claim.display,
          actual: value ?? null,
        });
      }
    }
    projected.push({ path: edge.path, claimDigest: claim.claimDigest, display: claim.display });
  }

  for (const key of MANIFEST_COMPONENT_KEYS) {
    const row = ledgerRow(bound, key, `ecosystem manifest components.${key}`);
    if (manifest.components?.[key]?.version !== row.declaredVersion) {
      fail('E_RELEASE_LEDGER_MANIFEST_DRIFT', `The manifest states a ${key} version the bound ledger row does not carry.`, {
        expected: row.declaredVersion,
        actual: manifest.components?.[key]?.version ?? null,
      });
    }
  }
  return Object.freeze({
    manifestDigest: bound.manifestBinding.manifestDigest,
    ledgerDigest: bound.ledgerDigest,
    claimSetDigest: releaseClaimSetDigest(claims),
    projected: Object.freeze(projected),
  });
}

/**
 * Resolve a declared `planr-pipeline@<version>` compatibility string against the
 * exact pipeline payload bytes the ledger binds. The string is a label; the
 * digest is the identity.
 */
export function assertPipelineCompatibilityDeclaration(declaration, { ledger, pipelinePayloadDigest } = {}) {
  const bound = plainObject(ledger, 'bound ledger', 'E_RELEASE_LEDGER_INPUT_ABSENT');
  assertReleaseLedger(bound);
  digest(pipelinePayloadDigest, 'pipeline payload digest', 'E_RELEASE_LEDGER_INPUT_ABSENT');
  const match = PIPELINE_COMPATIBILITY.exec(typeof declaration === 'string' ? declaration : '');
  if (!match) {
    fail('E_RELEASE_LEDGER_CONTRACT_INVALID', 'A compatibility declaration must read planr-pipeline@<version>.', {
      actual: declaration ?? null,
    });
  }
  const row = ledgerRow(bound, 'pipeline', 'pipeline compatibility declaration');
  if (row.payloadDigest !== pipelinePayloadDigest) {
    fail('E_RELEASE_LEDGER_CLAIM_UNBOUND', 'The ledger pipeline row does not bind the payload bytes this declaration is resolved against.', {
      expected: row.payloadDigest,
      actual: pipelinePayloadDigest,
    });
  }
  if (match[1] !== row.declaredVersion) {
    fail('E_RELEASE_LEDGER_CLAIM_DRIFT', 'The declared pipeline compatibility does not correspond to the bound payload bytes.', {
      expected: row.declaredVersion,
      actual: match[1],
    });
  }
  return Object.freeze({
    declaredVersion: row.declaredVersion,
    payloadDigest: row.payloadDigest,
    terminalReceiptDigest: row.terminalReceipt.digest,
  });
}

/** A named, non-degrading absence. An absent input never resolves to a passing claim. */
export function releaseLedgerAbsence({ input, reason, repositoryKey = null }) {
  if (typeof input !== 'string' || input.length === 0) {
    fail('E_RELEASE_LEDGER_INPUT_ABSENT', 'A typed absence must name the input it is about.');
  }
  if (!RELEASE_LEDGER_ABSENCE_REASONS.includes(reason)) {
    fail('E_RELEASE_LEDGER_INPUT_ABSENT', `Absence reason "${String(reason)}" is not a published ledger absence reason.`);
  }
  if (repositoryKey !== null && !RELEASE_REPOSITORY_KEYS.includes(repositoryKey)) {
    fail('E_RELEASE_LEDGER_FOREIGN_REPOSITORY', 'A typed absence may only name a frozen release repository key.');
  }
  return Object.freeze({ kind: 'release-ledger-absence', input, reason, repositoryKey, resolved: false });
}

/**
 * Assemble one ledger row from digests already proven elsewhere. Nothing here
 * re-derives a hash over package or repository bytes.
 */
export function releaseLedgerRow({
  repositoryKey,
  packageName,
  declaredVersion,
  baselineCommit,
  clean,
  sourceInventoryDigest,
  payloadDigest,
  exportSurfaceDigest,
  terminalReceipt,
}) {
  return assertRow({
    repositoryKey,
    packageName,
    declaredVersion,
    baselineCommit,
    clean,
    sourceInventoryDigest,
    payloadDigest,
    exportSurfaceDigest,
    terminalReceipt: terminalReceipt && { ...terminalReceipt },
  }, `release ledger row ${String(repositoryKey)}`);
}

export function buildReleaseLedger({ generatedAt, rows, manifestBinding }) {
  const ordered = RELEASE_REPOSITORY_KEYS.map((key) => {
    const row = (rows ?? []).find((entry) => entry?.repositoryKey === key);
    if (!row) {
      fail('E_RELEASE_LEDGER_INPUT_ABSENT', `Release ledger has no row for repository ${key}.`);
    }
    return row;
  });
  const record = {
    kind: 'release-ledger',
    schemaVersion: RELEASE_LEDGER_SCHEMA_VERSION,
    generatedAt: timestamp(generatedAt, 'release ledger generatedAt'),
    repositoryKeys: [...RELEASE_REPOSITORY_KEYS],
    rows: ordered,
    manifestBinding: { ...manifestBinding },
  };
  const identity = releaseLedgerIdentity(record, 'release-ledger');
  return assertReleaseLedger({ ...record, ledgerId: identity.id, ledgerDigest: identity.digest });
}

export function buildCompatibilityClaim({ ledger, consumerKey, producerKey, derivation }) {
  const bound = plainObject(ledger, 'bound ledger', 'E_RELEASE_LEDGER_INPUT_ABSENT');
  assertReleaseLedger(bound);
  const consumer = ledgerRow(bound, consumerKey, 'compatibility claim consumer');
  const producer = ledgerRow(bound, producerKey, 'compatibility claim producer');
  const record = {
    kind: 'release-compatibility-claim',
    schemaVersion: RELEASE_LEDGER_SCHEMA_VERSION,
    ledgerDigest: bound.ledgerDigest,
    consumer: {
      repositoryKey: consumer.repositoryKey,
      payloadDigest: consumer.payloadDigest,
      terminalReceiptDigest: consumer.terminalReceipt.digest,
    },
    producer: {
      repositoryKey: producer.repositoryKey,
      payloadDigest: producer.payloadDigest,
      terminalReceiptDigest: producer.terminalReceipt.digest,
      declaredVersion: producer.declaredVersion,
    },
    derivation,
    display: renderCompatibilityDisplay({ derivation, declaredVersion: producer.declaredVersion }),
  };
  const identity = releaseLedgerIdentity(record, 'release-compatibility-claim');
  return assertReleaseCompatibilityClaim(
    { ...record, claimId: identity.id, claimDigest: identity.digest },
    { ledger: bound },
  );
}

/** Every claim the published manifest renders, in the frozen edge order. */
export function buildManifestClaimSet(ledger) {
  return RELEASE_MANIFEST_CLAIM_EDGES.map((edge) => buildCompatibilityClaim({
    ledger,
    consumerKey: edge.consumer,
    producerKey: edge.producer,
    derivation: edge.derivation,
  }));
}

export function buildReleaseLedgerReceipt({ ledger, claims, issuedAt, refusals = [] }) {
  const record = {
    kind: 'release-ledger-receipt',
    schemaVersion: RELEASE_LEDGER_SCHEMA_VERSION,
    recordType: 'verification',
    authority: 'none',
    issuedAt: timestamp(issuedAt, 'ledger receipt issuedAt'),
    ledgerDigest: ledger?.ledgerDigest,
    claimSetDigest: releaseClaimSetDigest(claims ?? []),
    result: refusals.length === 0 ? 'verified' : 'refused',
    refusals: refusals.map(({ code, repositoryKey = null, reason }) => ({ code, repositoryKey, reason })),
  };
  const identity = releaseLedgerIdentity(record, 'release-ledger-receipt');
  return assertReleaseLedgerReceipt(
    { ...record, receiptId: identity.id, receiptDigest: identity.digest },
    { ledger, claims },
  );
}

/**
 * Project the ledger row for one repository into the exact text the release docs
 * are allowed to state. Doctor compares docs against this, never a hand-written
 * baseline string.
 */
export function renderLedgerVersionProjection({ packageName, declaredVersion }) {
  if (typeof packageName !== 'string' || !PACKAGE_NAME.test(packageName)) {
    fail('E_RELEASE_LEDGER_CONTRACT_INVALID', 'A version projection requires the row package name.');
  }
  if (typeof declaredVersion !== 'string' || !VERSION.test(declaredVersion)) {
    fail('E_RELEASE_LEDGER_CONTRACT_INVALID', 'A version projection requires the row declared version.');
  }
  return `${packageName} v${declaredVersion}`;
}

/**
 * Ledger rows assembled from the proofs `verify-release-package` already produced.
 * Repository inventory and cleanliness come from the coordinated candidate proof,
 * packed payload identity from the package payload proof, and the export surface
 * from the proven export target list. `payloads` carries the same two digests for
 * repositories the pipeline package proof does not cover. Anything not supplied
 * is a typed absence.
 */
export function releaseLedgerRowsFromProofs({
  ecosystemProof,
  packageProof,
  payloads = {},
  packages = {},
  terminalReceipts = {},
}) {
  plainObject(ecosystemProof, 'coordinated candidate proof', 'E_RELEASE_LEDGER_INPUT_ABSENT');
  const surface = releaseProofDigests({ ecosystemProof, packageProof: packageProof ?? null });
  const rows = [];
  const absences = [];
  for (const repositoryKey of RELEASE_REPOSITORY_KEYS) {
    const inventory = surface.repositories.find((entry) => entry.key === repositoryKey);
    if (!inventory?.present) {
      absences.push(releaseLedgerAbsence({ input: `candidate.${repositoryKey}`, reason: 'repository-not-discovered', repositoryKey }));
      continue;
    }
    if (inventory.dirty) {
      absences.push(releaseLedgerAbsence({ input: `candidate.${repositoryKey}`, reason: 'repository-dirty', repositoryKey }));
      continue;
    }
    const payload = surface.payload?.repositoryKey === repositoryKey
      ? surface.payload
      : payloads[repositoryKey] ?? null;
    if (!payload?.payloadDigest || !payload?.exportSurfaceDigest) {
      absences.push(releaseLedgerAbsence({ input: `payload.${repositoryKey}`, reason: 'payload-proof-not-supplied', repositoryKey }));
      continue;
    }
    const receipt = terminalReceipts[repositoryKey] ?? null;
    if (!receipt) {
      absences.push(releaseLedgerAbsence({ input: `receipt.${repositoryKey}`, reason: 'terminal-receipt-absent', repositoryKey }));
      continue;
    }
    const declared = packages[repositoryKey] ?? null;
    if (!declared?.name || !declared?.version) {
      absences.push(releaseLedgerAbsence({ input: `package.${repositoryKey}`, reason: 'input-missing', repositoryKey }));
      continue;
    }
    rows.push(releaseLedgerRow({
      repositoryKey,
      packageName: declared.name,
      declaredVersion: declared.version,
      baselineCommit: inventory.baseline,
      clean: !inventory.dirty,
      sourceInventoryDigest: inventory.inventoryDigest,
      payloadDigest: payload.payloadDigest,
      exportSurfaceDigest: payload.exportSurfaceDigest,
      terminalReceipt: receipt,
    }));
  }
  return Object.freeze({ rows: Object.freeze(rows), absences: Object.freeze(absences) });
}
