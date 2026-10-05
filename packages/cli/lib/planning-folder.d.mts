export { PLANNING_FOLDER } from './names.mjs';

/** Why OpenPlanr refuses to write into a project's planning folder. */
export interface PlanningFolderConflict {
  readonly code: 'E_PLANNING_FOLDER_FOREIGN';
  readonly problem: string;
  readonly fix: string;
  readonly signs: readonly string[];
}

/** Another tool's files in `<projectRoot>/.planr` that lacks OpenPlanr's config.json; empty when OpenPlanr may write there. */
export declare function foreignPlanningFolderSigns(projectRoot: string): string[];
/** The refusal for writing into another tool's planning folder, or null when OpenPlanr may write there. */
export declare function planningFolderConflict(projectRoot: string): PlanningFolderConflict | null;
