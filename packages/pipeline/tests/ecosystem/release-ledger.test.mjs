import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  RELEASE_MANIFEST_CLAIM_EDGES,
  RELEASE_REPOSITORY_KEYS,
  assertEcosystemManifestProjection,
  assertPipelineCompatibilityDeclaration,
  assertReleaseCompatibilityClaim,
  assertReleaseLedger,
  assertReleaseLedgerReceipt,
  buildCompatibilityClaim,
  buildManifestClaimSet,
  buildReleaseLedger,
  buildReleaseLedgerReceipt,
  releaseClaimSetDigest,
  releaseLedgerAbsence,
  releaseLedgerIdentity,
  releaseLedgerRowsFromProofs,
  renderCompatibilityDisplay,
  renderLedgerVersionProjection,
} from '../../lib/ecosystem/release-ledger.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(root, 'conformance/fixtures/release-ledger', name), 'utf8'));

const valid = fixture('ledger-valid.json');
const ledger = valid['release-ledger'];
const manifest = valid['ecosystem-manifest'];
const claims = fixture('compatibility-claims-valid.json').claimSet;

const codeOf = (call) => {
  try {
    call();
    return null;
  } catch (error) {
    return error.code ?? 'E_UNTYPED';
  }
};

test('every ledger identity is derived by omitting both the id and the digest', () => {
  for (const [kind, record] of [
    ['release-ledger', ledger],
    ['release-ledger-receipt', valid['release-ledger-receipt']],
    ['release-compatibility-claim', claims[0]],
  ]) {
    const identity = releaseLedgerIdentity(record, kind);
    assert.equal(record[identity.digestField], identity.digest);
    assert.equal(record[identity.idField], identity.id);

    const omittingDigestOnly = { ...record };
    delete omittingDigestOnly[identity.digestField];
    assert.notEqual(
      sha256Jcs(omittingDigestOnly),
      identity.digest,
      `${kind} must not be digestible by omitting the digest field alone`,
    );
  }
});

test('a ledger carries exactly one clean, digest-bound row per frozen repository key', () => {
  assert.deepEqual(ledger.rows.map(({ repositoryKey }) => repositoryKey), [...RELEASE_REPOSITORY_KEYS]);
  for (const row of ledger.rows) {
    assert.equal(row.clean, true);
    assert.equal(row.terminalReceipt.state, 'closed');
    assert.equal(row.terminalReceipt.boundPayloadDigest, row.payloadDigest);
  }
  assert.equal(codeOf(() => assertReleaseLedger(ledger)), null);
});

test('a duplicate repository row and a foreign repository key are both refused', () => {
  const duplicate = structuredClone(ledger);
  duplicate.rows[1].repositoryKey = 'pipeline';
  assert.equal(codeOf(() => assertReleaseLedger(duplicate)), 'E_RELEASE_LEDGER_DUPLICATE_ROW');

  const foreign = structuredClone(ledger);
  foreign.rows[1].repositoryKey = 'docs';
  assert.equal(codeOf(() => assertReleaseLedger(foreign)), 'E_RELEASE_LEDGER_FOREIGN_REPOSITORY');
});

test('a claim is refused when its receipt is missing, non-terminal, or bound to another candidate', () => {
  const missing = structuredClone(ledger);
  delete missing.rows[0].terminalReceipt;
  assert.equal(codeOf(() => assertReleaseLedger(missing)), 'E_RELEASE_LEDGER_ROW_INVALID');

  const nonTerminal = structuredClone(ledger);
  nonTerminal.rows[0].terminalReceipt.state = 'in-progress';
  assert.equal(codeOf(() => assertReleaseLedger(nonTerminal)), 'E_RELEASE_LEDGER_RECEIPT_FOREIGN');

  const otherCandidate = structuredClone(ledger);
  otherCandidate.rows[0].terminalReceipt.boundPayloadDigest = ledger.rows[1].payloadDigest;
  assert.equal(codeOf(() => assertReleaseLedger(otherCandidate)), 'E_RELEASE_LEDGER_RECEIPT_FOREIGN');

  const claim = structuredClone(claims.find(({ producer }) => producer.repositoryKey === 'pipeline'));
  claim.producer.terminalReceiptDigest = ledger.rows[1].terminalReceipt.digest;
  assert.equal(
    codeOf(() => assertReleaseCompatibilityClaim(claim, { ledger })),
    'E_RELEASE_LEDGER_RECEIPT_FOREIGN',
  );
});

test('a ledger can never supply its own certifying receipt', () => {
  const receipt = valid['release-ledger-receipt'];
  const selfCertifying = structuredClone(ledger);
  selfCertifying.rows[0].terminalReceipt.digest = receipt.receiptDigest;
  const identity = releaseLedgerIdentity(selfCertifying, 'release-ledger');
  selfCertifying.ledgerId = identity.id;
  selfCertifying.ledgerDigest = identity.digest;
  assert.equal(
    codeOf(() => assertReleaseLedgerReceipt(receipt, { ledger: selfCertifying, claims })),
    'E_RELEASE_LEDGER_SELF_CERTIFIED',
  );
  assert.equal(receipt.authority, 'none');
});

test('a receipt binds the exact ledger and claim set it reports on', () => {
  const receipt = valid['release-ledger-receipt'];
  assert.equal(codeOf(() => assertReleaseLedgerReceipt(receipt, { ledger, claims })), null);
  assert.equal(receipt.claimSetDigest, releaseClaimSetDigest(claims));
  assert.equal(
    codeOf(() => assertReleaseLedgerReceipt(receipt, { ledger, claims: claims.slice(1) })),
    'E_RELEASE_LEDGER_CLAIM_UNBOUND',
  );
});

test('every rendered manifest range is the deterministic render of a bound claim', () => {
  const projection = assertEcosystemManifestProjection({ ledger, claims, manifest });
  assert.equal(projection.projected.length, RELEASE_MANIFEST_CLAIM_EDGES.length);
  assert.equal(projection.claimSetDigest, releaseClaimSetDigest(claims));
  for (const claim of claims) {
    const producer = ledger.rows.find(({ repositoryKey }) => repositoryKey === claim.producer.repositoryKey);
    assert.equal(
      claim.display,
      renderCompatibilityDisplay({ derivation: claim.derivation, declaredVersion: producer.declaredVersion }),
    );
    assert.equal(claim.producer.payloadDigest, producer.payloadDigest);
    assert.equal(claim.producer.terminalReceiptDigest, producer.terminalReceipt.digest);
  }
});

test('a manifest whose bytes the ledger does not bind is refused before any range is read', () => {
  assert.equal(
    codeOf(() => assertEcosystemManifestProjection({ ledger, claims, manifest: { ...manifest, generatedAt: '2020-01-01T00:00:00.000Z' } })),
    'E_RELEASE_LEDGER_MANIFEST_DRIFT',
  );
});

test('a repository never states its own compatibility with itself', () => {
  assert.equal(
    codeOf(() => buildCompatibilityClaim({ ledger, consumerKey: 'cli', producerKey: 'cli', derivation: 'caret-range-from-producer-declared-version' })),
    'E_RELEASE_LEDGER_CONTRACT_INVALID',
  );
});

test('a compatibility declaration resolves against payload bytes, never against its own text', () => {
  const pipeline = ledger.rows.find(({ repositoryKey }) => repositoryKey === 'pipeline');
  const resolved = assertPipelineCompatibilityDeclaration(`planr-pipeline@${pipeline.declaredVersion}`, {
    ledger,
    pipelinePayloadDigest: pipeline.payloadDigest,
  });
  assert.equal(resolved.payloadDigest, pipeline.payloadDigest);
  assert.equal(resolved.terminalReceiptDigest, pipeline.terminalReceipt.digest);
  assert.equal(
    codeOf(() => assertPipelineCompatibilityDeclaration('planr-pipeline@9.9.9', { ledger, pipelinePayloadDigest: pipeline.payloadDigest })),
    'E_RELEASE_LEDGER_CLAIM_DRIFT',
  );
  assert.equal(
    codeOf(() => assertPipelineCompatibilityDeclaration('planr-pipeline', { ledger, pipelinePayloadDigest: pipeline.payloadDigest })),
    'E_RELEASE_LEDGER_CONTRACT_INVALID',
  );
});

test('an unreadable or unsupplied input is a named absence, never a passing claim', () => {
  const absence = releaseLedgerAbsence({ input: 'payload.cli', reason: 'payload-proof-not-supplied', repositoryKey: 'cli' });
  assert.equal(absence.resolved, false);
  assert.equal(absence.repositoryKey, 'cli');
  assert.equal(codeOf(() => releaseLedgerAbsence({ input: 'payload.cli', reason: 'assume-compatible' })), 'E_RELEASE_LEDGER_INPUT_ABSENT');
  assert.equal(codeOf(() => releaseLedgerAbsence({ input: 'payload.docs', reason: 'input-missing', repositoryKey: 'docs' })), 'E_RELEASE_LEDGER_FOREIGN_REPOSITORY');

  const assembled = releaseLedgerRowsFromProofs({
    ecosystemProof: {
      candidateDigest: ledger.ledgerDigest,
      repositories: RELEASE_REPOSITORY_KEYS.map((key) => ({
        key,
        baseline: ledger.rows[0].baselineCommit,
        dirty: key === 'web',
        fileCount: 1,
        inventoryDigest: ledger.rows[0].sourceInventoryDigest,
        snapshotDigest: ledger.rows[0].sourceInventoryDigest,
      })),
    },
    packageProof: null,
  });
  assert.equal(assembled.rows.length, 0);
  assert.deepEqual(
    assembled.absences.map(({ repositoryKey, reason }) => [repositoryKey, reason]),
    [
      ['pipeline', 'payload-proof-not-supplied'],
      ['web', 'repository-dirty'],
      ['cli', 'payload-proof-not-supplied'],
      ['skills', 'payload-proof-not-supplied'],
      ['marketplace', 'payload-proof-not-supplied'],
    ],
  );
});

test('rows assembled from proofs carry the digests those proofs already computed', () => {
  const packageProof = {
    package: { name: 'planr-pipeline', version: '0.42.0' },
    archive: { digest: ledger.rows[0].payloadDigest },
    sourceDigest: ledger.rows[0].sourceInventoryDigest,
    exports: [{ subpath: '.', conditions: ['import'], target: 'lib/index.mjs', matches: ['lib/index.mjs'] }],
  };
  const assembled = releaseLedgerRowsFromProofs({
    ecosystemProof: {
      candidateDigest: ledger.ledgerDigest,
      repositories: [{
        key: 'pipeline',
        baseline: ledger.rows[0].baselineCommit,
        dirty: false,
        fileCount: 1,
        inventoryDigest: ledger.rows[0].sourceInventoryDigest,
        snapshotDigest: ledger.rows[0].sourceInventoryDigest,
      }],
    },
    packageProof,
    packages: { pipeline: { name: 'planr-pipeline', version: '0.42.0' } },
    terminalReceipts: { pipeline: ledger.rows[0].terminalReceipt },
  });
  assert.equal(assembled.rows.length, 1);
  assert.equal(assembled.rows[0].payloadDigest, packageProof.archive.digest);
  assert.equal(assembled.rows[0].exportSurfaceDigest, sha256Jcs(packageProof.exports));
  assert.equal(assembled.rows[0].sourceInventoryDigest, ledger.rows[0].sourceInventoryDigest);
});

test('a complete candidate assembles into a ledger whose claims project the manifest', () => {
  const assembled = releaseLedgerRowsFromProofs({
    ecosystemProof: {
      candidateDigest: ledger.ledgerDigest,
      repositories: ledger.rows.map((row) => ({
        key: row.repositoryKey,
        baseline: row.baselineCommit,
        dirty: false,
        fileCount: 1,
        inventoryDigest: row.sourceInventoryDigest,
        snapshotDigest: row.sourceInventoryDigest,
      })),
    },
    payloads: Object.fromEntries(ledger.rows.map((row) => [row.repositoryKey, {
      payloadDigest: row.payloadDigest,
      exportSurfaceDigest: row.exportSurfaceDigest,
    }])),
    packages: Object.fromEntries(ledger.rows.map((row) => [row.repositoryKey, {
      name: row.packageName,
      version: row.declaredVersion,
    }])),
    terminalReceipts: Object.fromEntries(ledger.rows.map((row) => [row.repositoryKey, row.terminalReceipt])),
  });

  assert.deepEqual(assembled.absences, []);
  const rebuilt = buildReleaseLedger({
    generatedAt: ledger.generatedAt,
    rows: [...assembled.rows],
    manifestBinding: { manifestDigest: sha256Jcs(manifest), manifestSchemaVersion: '1.1.0' },
  });
  assert.equal(rebuilt.ledgerDigest, ledger.ledgerDigest);
  const rebuiltClaims = buildManifestClaimSet(rebuilt);
  assert.deepEqual(assertEcosystemManifestProjection({ ledger: rebuilt, claims: rebuiltClaims, manifest }).projected.length, RELEASE_MANIFEST_CLAIM_EDGES.length);
});

test('a ledger, claim set, and receipt rebuild byte-identically from unchanged inputs', () => {
  const rebuilt = buildReleaseLedger({
    generatedAt: ledger.generatedAt,
    rows: ledger.rows,
    manifestBinding: ledger.manifestBinding,
  });
  assert.deepEqual(rebuilt, ledger);
  assert.deepEqual(buildManifestClaimSet(rebuilt), claims);
  assert.deepEqual(
    buildReleaseLedgerReceipt({ ledger: rebuilt, claims, issuedAt: valid['release-ledger-receipt'].issuedAt }),
    valid['release-ledger-receipt'],
  );
});

test('a version projection is rendered once and reused by every reader', () => {
  assert.equal(renderLedgerVersionProjection({ packageName: 'planr-pipeline', declaredVersion: '0.42.0' }), 'planr-pipeline v0.42.0');
  assert.equal(codeOf(() => renderLedgerVersionProjection({ packageName: 'planr-pipeline', declaredVersion: 'next' })), 'E_RELEASE_LEDGER_CONTRACT_INVALID');
});
