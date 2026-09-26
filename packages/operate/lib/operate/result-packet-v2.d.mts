import type {
  OperatingAdvisorResultV2,
  OperatingChallengerReviewV2,
  OperatingDecisionLedgerV2,
  OperatingIntelligenceAssignmentV2,
} from '@openplanr/protocol';

export interface OperatingResultInputArtifactV2 {
  readonly artifactId: string;
  readonly schemaId: string;
  readonly value: Readonly<Record<string, unknown>>;
}

export type OperatingResultTemplateV2 =
  | OperatingAdvisorResultV2
  | OperatingChallengerReviewV2
  | OperatingDecisionLedgerV2;

export interface OperatingResultSchemaDependencyV2 {
  readonly kind: string;
  readonly fileName: string;
  readonly schema: Readonly<Record<string, unknown>>;
}

export function createOperatingResultTemplateV2(input: {
  assignment: OperatingIntelligenceAssignmentV2;
  inputArtifacts?: readonly OperatingResultInputArtifactV2[];
}): Readonly<OperatingResultTemplateV2>;

export function operatingResultSchemaDependenciesV2(
  schemaId:
    | 'operating-advisor-result'
    | 'operating-challenger-review'
    | 'operating-decision-ledger',
): readonly OperatingResultSchemaDependencyV2[];
