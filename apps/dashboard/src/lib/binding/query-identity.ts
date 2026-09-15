import { parseDashboardRoute, serializeDashboardRoute } from '../../app/router.js';
import { DashboardValidationError, exactRecord, exactString } from '../api/validation.js';

const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

export type DashboardEventHead = Readonly<{ sequence: number; hash: string | null }>;
export type DashboardQueryIdentity = Readonly<{
  productArea: 'planning' | 'operate';
  route: string;
  actorId: string;
  projectId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  cycleId: string | null;
  subjectId: string | null;
  eventHead: DashboardEventHead | null;
  viewHash: string | null;
  generation: number;
}>;
export type DashboardQueryKey = readonly ['dashboard-projection', DashboardQueryIdentity];

const IDENTITY_KEYS = [
  'productArea',
  'route',
  'actorId',
  'projectId',
  'scopeId',
  'domainId',
  'domainVersion',
  'cycleId',
  'subjectId',
  'eventHead',
  'viewHash',
  'generation',
] as const;

function nullableIdentity(value: unknown, path: string): string | null {
  return value === null ? null : exactString(value, path, IDENTITY);
}

function eventHead(value: unknown): DashboardEventHead | null {
  if (value === null) return null;
  const record = exactRecord(value, ['sequence', 'hash'], '$.eventHead');
  if (!Number.isSafeInteger(record.sequence) || (record.sequence as number) < 0) {
    throw new DashboardValidationError(
      '$.eventHead.sequence',
      'expected a non-negative safe integer',
    );
  }
  const hash = record.hash === null ? null : exactString(record.hash, '$.eventHead.hash', SHA256);
  if (((record.sequence as number) === 0) !== (hash === null)) {
    throw new DashboardValidationError('$.eventHead', 'sequence and hash are inconsistent');
  }
  return Object.freeze({ sequence: record.sequence as number, hash });
}

export function createDashboardQueryIdentity(value: unknown): DashboardQueryIdentity {
  const record = exactRecord(value, IDENTITY_KEYS, '$');
  if (record.productArea !== 'planning' && record.productArea !== 'operate') {
    throw new DashboardValidationError('$.productArea', 'expected planning or operate');
  }
  if (!Number.isSafeInteger(record.generation) || (record.generation as number) < 0) {
    throw new DashboardValidationError('$.generation', 'expected a non-negative safe integer');
  }
  const route = exactString(record.route, '$.route', /^#.{1,512}$/u);
  const parsedRoute = parseDashboardRoute(route);
  if (parsedRoute.kind === 'not-found' || serializeDashboardRoute(parsedRoute) !== route) {
    throw new DashboardValidationError('$.route', 'must be a canonical closed dashboard route');
  }
  if (parsedRoute.product !== record.productArea) {
    throw new DashboardValidationError('$.route', 'does not belong to the selected product area');
  }
  const cycleId = nullableIdentity(record.cycleId, '$.cycleId');
  const subjectId = nullableIdentity(record.subjectId, '$.subjectId');
  if (parsedRoute.subjectId !== subjectId) {
    throw new DashboardValidationError('$.subjectId', 'does not equal the canonical route subject');
  }
  if (parsedRoute.kind === 'operate.review' && parsedRoute.cycleId !== cycleId) {
    throw new DashboardValidationError(
      '$.cycleId',
      'does not equal the canonical Review route Cycle',
    );
  }
  return Object.freeze({
    productArea: record.productArea,
    route,
    actorId: exactString(record.actorId, '$.actorId', IDENTITY),
    projectId: exactString(record.projectId, '$.projectId', SHA256),
    scopeId: exactString(record.scopeId, '$.scopeId', IDENTITY),
    domainId: exactString(record.domainId, '$.domainId', IDENTITY),
    domainVersion: exactString(record.domainVersion, '$.domainVersion', IDENTITY),
    cycleId,
    subjectId,
    eventHead: eventHead(record.eventHead),
    viewHash: record.viewHash === null ? null : exactString(record.viewHash, '$.viewHash', SHA256),
    generation: record.generation as number,
  });
}

export function dashboardQueryKey(value: unknown): DashboardQueryKey {
  return Object.freeze(['dashboard-projection', createDashboardQueryIdentity(value)] as const);
}

export function isCurrentDashboardQuery(
  query: DashboardQueryIdentity,
  current: DashboardQueryIdentity,
): boolean {
  return IDENTITY_KEYS.every((field) => {
    if (field === 'eventHead') {
      return (
        query.eventHead?.sequence === current.eventHead?.sequence &&
        query.eventHead?.hash === current.eventHead?.hash
      );
    }
    return query[field] === current[field];
  });
}
