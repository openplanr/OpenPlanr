export type VersionDimension = 'source' | 'module' | 'host-profile' | 'skill' | 'asset';
export type SkillChangeKind = 'none' | 'editorial' | 'compatible' | 'behavior' | 'breaking';
export type VersionBump = 'none' | 'patch' | 'minor' | 'major' | 'regression';

export declare const VERSION_DIMENSIONS: readonly VersionDimension[];
export declare const CHANGE_KINDS: readonly SkillChangeKind[];
export declare function classifyVersionBump(
  previousVersion: string,
  nextVersion: string,
): VersionBump;
export declare function requiredVersionBump(
  dimension: VersionDimension,
  changeKind: SkillChangeKind,
): Exclude<VersionBump, 'regression'>;
export declare function assessVersionChange(input: {
  dimension: VersionDimension;
  changeKind: SkillChangeKind;
  previousVersion: string;
  nextVersion: string;
}): Readonly<Record<string, unknown>>;
export declare function assessVersionSet(
  changes: readonly Record<string, unknown>[],
): Readonly<Record<string, unknown>>;
export declare function analyzeSkillGraphImpact(input: {
  repoRoot: string;
  changes: readonly Record<string, unknown>[];
}): Readonly<Record<string, unknown>>;
export declare function planSkillGraphRollback(
  input: Record<string, unknown>,
): Readonly<Record<string, unknown>>;
export declare function createLearningProposal(
  input: Record<string, unknown>,
): Readonly<Record<string, unknown>>;
export declare function assessLearningPromotion(
  input: Record<string, unknown>,
): Readonly<Record<string, unknown>>;
