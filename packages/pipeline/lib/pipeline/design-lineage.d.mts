import type {
  DesignImplementationHandoff,
  DesignPlanningLineage,
} from '../protocol/design-handoff-contracts.mjs';

export type PlanningStory = { id: string; acceptanceCriteria: Array<{ id: string }> };
export type PlanningTask = {
  id: string;
  storyId: string;
  acceptanceRefs: string[];
  testRequirements: string;
};
export type PlanningArtifact = { path: string; bytes: string | Uint8Array };
export type DesignLineageInput = {
  handoff: DesignImplementationHandoff;
  specId: string;
  mappings: DesignPlanningLineage['mappings'];
  stories?: PlanningStory[];
  tasks?: PlanningTask[];
  artifacts?: PlanningArtifact[];
};

export declare function composeDesignPlanningLineage(
  input: DesignLineageInput,
): Readonly<DesignPlanningLineage>;
export declare function designPlanningLineagePath(root: string): string;
export declare function recoverDesignPlanningWrite(
  root: string,
  fs?: Record<string, unknown>,
): boolean;
export declare function writeDesignPlanningArtifacts(
  root: string,
  input: DesignLineageInput,
  options?: { replace?: boolean; fs?: Record<string, unknown> },
): Readonly<{ lineage: DesignPlanningLineage; written: string[]; repeated: boolean }>;
export declare function readDesignPlanningLineage(
  root: string,
  options?: { allowMissing?: boolean },
): DesignPlanningLineage | null;
export declare function resolveDesignPlanningLineage(input?: {
  root: string;
  lineage: DesignPlanningLineage | null;
  taskIds?: string[];
  readFile?: typeof import('node:fs').readFileSync;
}): Readonly<Record<string, unknown>>;
