export { PLANNING_FOLDER } from './names.mjs';

/** Why OpenPlanr refuses to write into a project's planning folder. */
export interface PlanningFolderConflict {
  readonly code: 'E_PLANNING_FOLDER_FOREIGN';
  readonly problem: string;
  readonly fix: string;
  readonly signs: readonly string[];
}

/** Signs that `<projectRoot>/.planr`, which lacks OpenPlanr's config.json, is a folder OpenPlanr didn't create; empty when OpenPlanr may write there. */
export declare function foreignPlanningFolderSigns(projectRoot: string): string[];
/** The refusal for writing into a planning folder OpenPlanr didn't create, or null when OpenPlanr may write there. */
export declare function planningFolderConflict(projectRoot: string): PlanningFolderConflict | null;
