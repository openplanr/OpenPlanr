export type ShipSpecialistId = 'security' | 'performance' | 'migration' | 'api-contract' | 'data-integrity';
export type BrowserSurface = 'ui' | 'authentication' | 'session' | 'navigation' | 'network';
export interface ShipRiskInput {
  subjectDigest: `sha256:${string}`;
  changedPaths: Array<{ repositoryKey: string; path: string }>;
  browserSurfaces: BrowserSurface[];
  contractChanges: boolean;
  migrationChanges: boolean;
  permissionEffects: boolean;
  dataWrites: boolean;
  performanceBudgets: boolean;
  explicitRisks: ShipSpecialistId[];
}
export interface ShipRiskClassification {
  kind: 'ship-risk-classification'; schemaVersion: '1.0.0'; protocolVersion: '1.1.0';
  input: ShipRiskInput; inputDigest: `sha256:${string}`; selectedSpecialists: ShipSpecialistId[];
  reviewerRoster: Array<'qa-agent' | ShipSpecialistId>;
  browserQa: { required: boolean; triggers: BrowserSurface[]; requirementDigest: `sha256:${string}` };
  classificationDigest: `sha256:${string}`;
}
export declare const SHIP_SPECIALIST_IDS: readonly ShipSpecialistId[];
export declare const BROWSER_SURFACES: readonly BrowserSurface[];
export declare function shipReviewSpecialistRegistry(): unknown;
export declare function classifyShipRisk(input: ShipRiskInput): Readonly<ShipRiskClassification>;
export declare function assertShipRiskClassification(value: unknown): ShipRiskClassification;
export declare function assertSpecialistReviewResult(value: unknown, options: { classification: ShipRiskClassification; candidateDigest: `sha256:${string}` }): unknown;
