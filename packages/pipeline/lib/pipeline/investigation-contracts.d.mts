export type InvestigationMode = 'diagnose' | 'fix';
export type InvestigationEffect = 'read-only' | 'destructive' | 'live' | 'network';
export type InvestigationScope = ReadonlyArray<{ repositoryKey: string; path: string }>;
export interface InvestigationCommandV1 {
  id: string;
  repositoryKey: string;
  argv: string[];
  inputPaths: string[];
  expectedExitCodes: number[];
  effect: InvestigationEffect;
}
export interface InvestigationFeatureV1 {
  mode: 'spec-driven' | 'default';
  featureId: string;
  slug: string;
}
export interface InvestigationFixAuthorityV1 {
  kind: 'investigation-fix-authority';
  schemaVersion: '1.0.0';
  authorityId: string;
  actorId: string;
  reason: string;
  diagnosisReceiptHash: string;
  targetBaselineDigest: string;
  scope: InvestigationScope;
  issuedAt: string;
  expiresAt: string | null;
  digest: string;
}
export type InvestigationRequestV1 =
  | {
      kind: 'investigation-request';
      schemaVersion: '1.0.0';
      protocolVersion: '1.1.0';
      mode: 'diagnose';
      feature: InvestigationFeatureV1;
      question: string;
      targetScope: InvestigationScope;
      reproduction: InvestigationCommandV1;
    }
  | {
      kind: 'investigation-request';
      schemaVersion: '1.0.0';
      protocolVersion: '1.1.0';
      mode: 'fix';
      feature: InvestigationFeatureV1;
      diagnosisReceiptHash: string;
      authority: InvestigationFixAuthorityV1;
      regression: InvestigationCommandV1;
      relevantSuite: InvestigationCommandV1;
    };
export declare const INVESTIGATION_PROTOCOL_VERSION: '1.1.0';
export declare const INVESTIGATION_SCHEMA_VERSION: '1.0.0';
export declare const INVESTIGATION_MODES: readonly InvestigationMode[];
export declare const INVESTIGATION_EFFECTS: readonly InvestigationEffect[];
export declare function assertInvestigationPortable<T>(value: T, path?: string): T;
export declare function assertInvestigationScope(
  value: unknown,
  label?: string,
): InvestigationScope;
export declare function assertInvestigationCommand(
  value: unknown,
  options?: { label?: string; allowedEffects?: readonly InvestigationEffect[] },
): InvestigationCommandV1;
export declare function assertInvestigationAuthority(value: unknown): InvestigationFixAuthorityV1;
export declare function assertInvestigationRequest(value: unknown): InvestigationRequestV1;
export declare function assertInvestigationApproval(
  value: unknown,
  binding?: {
    experimentId?: string;
    experimentKind?: InvestigationEffect;
    baselineDigest?: string;
  },
): unknown;
export declare function investigationArtifactId(prefix: string, value: unknown): string;
export declare function investigationEventIdentity(value: unknown): {
  canonical: Record<string, unknown>;
  eventId: string;
  inputDigest: string;
};
export declare function assertInvestigationExecutionEvidence<T>(value: T): T;
export declare function assertInvestigationReceipt<T>(value: T): T;
