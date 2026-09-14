export interface ContextEnvelopeObjective { summary: string; userValue: string }
export interface ContextEnvelopeDecision { decision: string; rationale?: string }
export interface ContextEnvelopeRepository { name: string; role: string }
export interface ContextEnvelopeBoundaries {
  repositories: ReadonlyArray<ContextEnvelopeRepository>;
  doNotChange: ReadonlyArray<string>;
}
export interface ContextEnvelopeDependency { task: string; requires: ReadonlyArray<string>; reason?: string }
export interface ContextEnvelopeV1 {
  schemaVersion: '1.0.0';
  objective: ContextEnvelopeObjective;
  requirements: ReadonlyArray<string>;
  acceptanceCriteria: ReadonlyArray<string>;
  decisions: ReadonlyArray<ContextEnvelopeDecision>;
  architecture: ReadonlyArray<string>;
  boundaries: ContextEnvelopeBoundaries;
  dependencies: ReadonlyArray<ContextEnvelopeDependency>;
  risks: ReadonlyArray<string>;
  startingPoints: ReadonlyArray<string>;
  externalActions: ReadonlyArray<string>;
}
export type ContextEnvelopeInput = Partial<Omit<ContextEnvelopeV1, 'schemaVersion' | 'boundaries'>> & {
  objective: ContextEnvelopeObjective;
  boundaries?: Partial<ContextEnvelopeBoundaries>;
};
export declare const CONTEXT_ENVELOPE_SCHEMA_VERSION: '1.0.0';
export declare const GOVERNANCE_FIELDS: readonly string[];
export declare function assertContextEnvelope(envelope: unknown): ContextEnvelopeV1;
export declare function buildContextEnvelope(input?: ContextEnvelopeInput): Readonly<ContextEnvelopeV1>;
export declare function renderContextEnvelope(envelope: ContextEnvelopeV1): string;
