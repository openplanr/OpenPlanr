export const PLANNING_FILE_LINK_ERROR_CODES: readonly [
  'EACCES',
  'EPERM',
  'ENOENT',
  'ENOTDIR',
  'ELOOP',
  'ENAMETOOLONG',
  'EIO',
  'EBADF',
  'EINVAL',
  'EMFILE',
  'ENFILE',
  'ESTALE',
  'UNKNOWN',
];
export type PlanningFileLinkErrorCode = (typeof PLANNING_FILE_LINK_ERROR_CODES)[number];
export const PLANNING_FILE_PATH_LIMIT: 1024;
export const PLANNING_FILE_LINK_MAX_BYTES: number;
export type PlanningFileLinkContext = Readonly<{
  binding: Readonly<{
    actorId: string;
    projectId: string;
    scopeId: string;
    domainId: string;
    domainVersion: string;
    generation: number;
  }>;
  cursor: Readonly<{
    eventHead: Readonly<{ sequence: number; hash: string | null }>;
    viewHash: string;
  }>;
  nodeId: string;
  path?: string;
}>;
export type PlanningFileLinkEnvelope = Readonly<{
  kind: 'planning-file-link';
  schemaVersion: '1.0.0';
  binding: PlanningFileLinkContext['binding'];
  cursor: PlanningFileLinkContext['cursor'];
  sourceViewHash: string;
  nodeId: string;
  state: 'available' | 'unavailable' | 'error';
  reason: string | null;
  errorCode: PlanningFileLinkErrorCode | null;
  path: string | null;
  editorUrl: string | null;
}>;
export function validPlanningFilePath(value: unknown): value is string;
/** expected must come from a validated current Planning graph/detail read. */
export function assertPlanningFileLinkEnvelope(
  value: unknown,
  expected: PlanningFileLinkContext,
): PlanningFileLinkEnvelope;
