export interface PlanningIssue {
  path: string;
  rule: string;
  detail: string;
}
export declare function normalizePlanningTask<T extends Record<string, unknown>>(
  value: T,
): T & {
  reviewRisks: string[];
  browserSurfaces: string[];
  acceptanceRefs: string[];
};
export declare function validatePlanningAcceptanceCoverage(
  stories: ReadonlyArray<Record<string, unknown>>,
  tasks: ReadonlyArray<Record<string, unknown>>,
): PlanningIssue[];
