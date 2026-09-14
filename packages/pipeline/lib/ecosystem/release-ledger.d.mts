export type ReleaseRepositoryKey = 'pipeline' | 'web' | 'cli' | 'skills' | 'marketplace';

export type ReleaseCompatibilityDerivation =
  | 'caret-range-from-producer-declared-version'
  | 'exact-producer-declared-version';

export type ReleaseLedgerAbsenceReason =
  | 'input-missing'
  | 'input-unreadable'
  | 'payload-proof-not-supplied'
  | 'terminal-receipt-absent'
  | 'repository-dirty'
  | 'repository-not-discovered';

export interface ReleaseTerminalReceiptBinding {
  digest: string;
  state: 'closed';
  boundPayloadDigest: string;
}

export interface ReleaseLedgerRow {
  repositoryKey: ReleaseRepositoryKey;
  packageName: string;
  declaredVersion: string;
  baselineCommit: string;
  clean: true;
  sourceInventoryDigest: string;
  payloadDigest: string;
  exportSurfaceDigest: string;
  terminalReceipt: ReleaseTerminalReceiptBinding;
}

export interface ReleaseLedger {
  kind: 'release-ledger';
  schemaVersion: '1.3.0';
  generatedAt: string;
  repositoryKeys: readonly ReleaseRepositoryKey[];
  rows: ReleaseLedgerRow[];
  manifestBinding: { manifestDigest: string; manifestSchemaVersion: '1.1.0' };
  ledgerId: string;
  ledgerDigest: string;
}

export interface ReleaseCompatibilityClaim {
  kind: 'release-compatibility-claim';
  schemaVersion: '1.3.0';
  ledgerDigest: string;
  consumer: { repositoryKey: ReleaseRepositoryKey; payloadDigest: string; terminalReceiptDigest: string };
  producer: {
    repositoryKey: ReleaseRepositoryKey;
    payloadDigest: string;
    terminalReceiptDigest: string;
    declaredVersion: string;
  };
  derivation: ReleaseCompatibilityDerivation;
  display: string;
  claimId: string;
  claimDigest: string;
}

export interface ReleaseLedgerRefusal {
  code: string;
  repositoryKey: ReleaseRepositoryKey | null;
  reason: string;
}

export interface ReleaseLedgerReceipt {
  kind: 'release-ledger-receipt';
  schemaVersion: '1.3.0';
  recordType: 'verification';
  authority: 'none';
  issuedAt: string;
  ledgerDigest: string;
  claimSetDigest: string;
  result: 'verified' | 'refused';
  refusals: ReleaseLedgerRefusal[];
  receiptId: string;
  receiptDigest: string;
}

export interface ReleaseLedgerAbsence {
  kind: 'release-ledger-absence';
  input: string;
  reason: ReleaseLedgerAbsenceReason;
  repositoryKey: ReleaseRepositoryKey | null;
  resolved: false;
}

export interface ReleaseLedgerIdentity {
  id: string;
  digest: string;
  idField: string;
  digestField: string;
}

export interface ReleaseManifestClaimEdge {
  path: string;
  consumer: ReleaseRepositoryKey;
  producer: ReleaseRepositoryKey;
  derivation: ReleaseCompatibilityDerivation;
}

export interface ReleaseManifestProjection {
  manifestDigest: string;
  ledgerDigest: string;
  claimSetDigest: string;
  projected: readonly { path: string; claimDigest: string; display: string }[];
}

export interface ResolvedPipelineCompatibility {
  declaredVersion: string;
  payloadDigest: string;
  terminalReceiptDigest: string;
}

export const RELEASE_REPOSITORY_KEYS: readonly ReleaseRepositoryKey[];
export const RELEASE_LEDGER_SCHEMA_VERSION: '1.3.0';
export const RELEASE_LEDGER_MANIFEST_SCHEMA_VERSION: '1.1.0';
export const RELEASE_LEDGER_DERIVATIONS: readonly ReleaseCompatibilityDerivation[];
export const RELEASE_LEDGER_ABSENCE_REASONS: readonly ReleaseLedgerAbsenceReason[];
export const RELEASE_LEDGER_IDENTITY_BINDINGS: Readonly<
  Record<string, Readonly<{ prefix: string; idField: string; digestField: string }>>
>;
export const RELEASE_MANIFEST_CLAIM_EDGES: readonly ReleaseManifestClaimEdge[];

export function releaseLedgerIdentity(value: unknown, kind: string): ReleaseLedgerIdentity;
export function assertReleaseLedgerIdentity<T>(value: T, kind: string): T;
export function renderCompatibilityDisplay(options: {
  derivation: ReleaseCompatibilityDerivation;
  declaredVersion: string;
}): string;
export function assertReleaseLedger(value: unknown): ReleaseLedger;
export function assertReleaseCompatibilityClaim(
  value: unknown,
  options: { ledger: ReleaseLedger },
): ReleaseCompatibilityClaim;
export function releaseClaimSetDigest(claims: readonly ReleaseCompatibilityClaim[]): string;
export function assertReleaseLedgerReceipt(
  value: unknown,
  options: { ledger: ReleaseLedger; claims: readonly ReleaseCompatibilityClaim[] },
): ReleaseLedgerReceipt;
export function assertEcosystemManifestProjection(options: {
  ledger: ReleaseLedger;
  claims: readonly ReleaseCompatibilityClaim[];
  manifest: unknown;
}): ReleaseManifestProjection;
export function assertPipelineCompatibilityDeclaration(
  declaration: unknown,
  options: { ledger: ReleaseLedger; pipelinePayloadDigest: string },
): ResolvedPipelineCompatibility;
export function releaseLedgerAbsence(options: {
  input: string;
  reason: ReleaseLedgerAbsenceReason;
  repositoryKey?: ReleaseRepositoryKey | null;
}): ReleaseLedgerAbsence;
export function releaseLedgerRow(row: {
  repositoryKey: ReleaseRepositoryKey;
  packageName: string;
  declaredVersion: string;
  baselineCommit: string;
  clean: boolean;
  sourceInventoryDigest: string;
  payloadDigest: string;
  exportSurfaceDigest: string;
  terminalReceipt: ReleaseTerminalReceiptBinding;
}): ReleaseLedgerRow;
export function buildReleaseLedger(options: {
  generatedAt: string;
  rows: readonly ReleaseLedgerRow[];
  manifestBinding: { manifestDigest: string; manifestSchemaVersion: '1.1.0' };
}): ReleaseLedger;
export function buildCompatibilityClaim(options: {
  ledger: ReleaseLedger;
  consumerKey: ReleaseRepositoryKey;
  producerKey: ReleaseRepositoryKey;
  derivation: ReleaseCompatibilityDerivation;
}): ReleaseCompatibilityClaim;
export function buildManifestClaimSet(ledger: ReleaseLedger): ReleaseCompatibilityClaim[];
export function buildReleaseLedgerReceipt(options: {
  ledger: ReleaseLedger;
  claims: readonly ReleaseCompatibilityClaim[];
  issuedAt: string;
  refusals?: readonly { code: string; repositoryKey?: ReleaseRepositoryKey | null; reason: string }[];
}): ReleaseLedgerReceipt;
export function renderLedgerVersionProjection(row: {
  packageName: string;
  declaredVersion: string;
}): string;
export function releaseLedgerRowsFromProofs(options: {
  ecosystemProof: unknown;
  packageProof?: unknown;
  payloads?: Record<string, { payloadDigest: string; exportSurfaceDigest: string } | null>;
  packages?: Record<string, { name: string; version: string } | null>;
  terminalReceipts?: Record<string, ReleaseTerminalReceiptBinding | null>;
}): { rows: readonly ReleaseLedgerRow[]; absences: readonly ReleaseLedgerAbsence[] };
