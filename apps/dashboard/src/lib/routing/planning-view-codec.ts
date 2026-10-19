const ARTIFACT_ID = /^(?:SPEC|FEAT|E|F|EPIC|US|T|BL|Q|QT|SPRINT|ADR)-[0-9]{3,}$/u;
const SCOPED_ID = /^SPEC-[0-9]{3,}\/(?:T|US)-[0-9]{3,}$/u;

export function isCanonicalPlanningId(value: string): boolean {
  return value.length <= 256 && (ARTIFACT_ID.test(value) || SCOPED_ID.test(value));
}

/** Scoped slashes are accepted only as one exact, once-encoded Planning segment. */
export function parsePlanningSubject(segment: string): string | null {
  try {
    const value = decodeURIComponent(segment);
    if (encodeURIComponent(value) !== segment) return null;
    if (isCanonicalPlanningId(value)) return value;
    // Released links escaped the scoped separator before URL encoding it.
    const canonical = value.replace(':2F', '/');
    return canonical.length <= 256 && SCOPED_ID.test(canonical) ? canonical : null;
  } catch {
    return null;
  }
}

export function serializePlanningSubject(value: string): string {
  if (!isCanonicalPlanningId(value))
    throw new Error('Planning routes require a canonical artifact identity.');
  return encodeURIComponent(value);
}

export type PlanningViewRoute = 'list' | 'graph' | 'board' | 'activity';
export type PlanningView = Readonly<{
  schemaVersion: '1.0.0';
  route: PlanningViewRoute;
  filters: Readonly<{
    type: readonly string[];
    status: readonly string[];
    priority: readonly string[];
    label: readonly string[];
    query: string;
    createdWithinDays: number | null;
    updatedWithinDays: number | null;
  }>;
  groupBy: 'none' | 'spec' | 'type' | 'status' | 'label';
  sort: Readonly<{
    field: 'id' | 'title' | 'status' | 'priority' | 'updated';
    direction: 'asc' | 'desc';
  }>;
  density: 'compact' | 'comfortable';
  focusId: string | null;
}>;

const MAX_VIEW_BYTES = 4096;
const TYPES = ['epic', 'feature', 'story', 'task', 'spec', 'backlog', 'quick', 'sprint', 'adr'];
const STATUSES = ['outstanding', 'in-progress', 'blocked', 'done', 'addressed'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3', 'critical', 'high', 'medium', 'low'];
const ROUTES = ['list', 'graph', 'board', 'activity'];

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function closed(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function text(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length <= max &&
    [...value].every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code > 31 && code !== 127;
    })
  );
}

function array(value: unknown, choices?: readonly string[]): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    new Set(value).size === value.length &&
    value.every(
      (entry) => text(entry, 80) && entry.length > 0 && (!choices || choices.includes(entry)),
    )
  );
}

function days(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 365)
  );
}

function choice(value: unknown, choices: readonly string[]): value is string {
  return typeof value === 'string' && choices.includes(value);
}

function validFocus(value: unknown): boolean {
  return value === null || (typeof value === 'string' && isCanonicalPlanningId(value));
}

function validViewOptions(value: Record<string, unknown>): boolean {
  return (
    value.schemaVersion === '1.0.0' &&
    choice(value.route, ROUTES) &&
    choice(value.groupBy, ['none', 'spec', 'type', 'status', 'label']) &&
    choice(value.density, ['compact', 'comfortable']) &&
    validFocus(value.focusId)
  );
}

/** The URL boundary accepts presentation only; unknown fields are rejected at every level. */
export function validatePlanningView(value: unknown): PlanningView | null {
  if (
    !object(value) ||
    !closed(value, ['schemaVersion', 'route', 'filters', 'groupBy', 'sort', 'density', 'focusId'])
  )
    return null;
  if (!validViewOptions(value)) return null;
  const filters = value.filters;
  if (
    !object(filters) ||
    !closed(filters, [
      'type',
      'status',
      'priority',
      'label',
      'query',
      'createdWithinDays',
      'updatedWithinDays',
    ])
  )
    return null;
  if (
    !array(filters.type, TYPES) ||
    !array(filters.status, STATUSES) ||
    !array(filters.priority, PRIORITIES) ||
    !array(filters.label)
  )
    return null;
  if (
    !text(filters.query, 200) ||
    !days(filters.createdWithinDays) ||
    !days(filters.updatedWithinDays)
  )
    return null;
  const sort = value.sort;
  if (!object(sort) || !closed(sort, ['field', 'direction'])) return null;
  if (
    !choice(sort.field, ['id', 'title', 'status', 'priority', 'updated']) ||
    !choice(sort.direction, ['asc', 'desc'])
  )
    return null;
  return Object.freeze({
    schemaVersion: '1.0.0',
    route: value.route,
    filters: Object.freeze({
      type: Object.freeze([...filters.type]),
      status: Object.freeze([...filters.status]),
      priority: Object.freeze([...filters.priority]),
      label: Object.freeze([...filters.label]),
      query: filters.query,
      createdWithinDays: filters.createdWithinDays,
      updatedWithinDays: filters.updatedWithinDays,
    }),
    groupBy: value.groupBy,
    sort: Object.freeze({ field: sort.field, direction: sort.direction }),
    density: value.density,
    focusId: value.focusId,
  }) as PlanningView;
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

export function serializePlanningViewToken(value: PlanningView): string {
  const view = validatePlanningView(value);
  if (!view) throw new Error('Invalid presentation view.');
  const bytes = new TextEncoder().encode(JSON.stringify(view));
  if (bytes.length > MAX_VIEW_BYTES) throw new Error('Presentation view exceeds 4 KiB.');
  return encodeBytes(bytes);
}

export function parsePlanningViewToken(token: string): PlanningView | null {
  if (
    !token ||
    token.length > Math.ceil((MAX_VIEW_BYTES * 4) / 3) ||
    !/^[A-Za-z0-9_-]+$/u.test(token)
  )
    return null;
  try {
    const binary = atob(token.replace(/-/gu, '+').replace(/_/gu, '/'));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.length > MAX_VIEW_BYTES || encodeBytes(bytes) !== token) return null;
    return validatePlanningView(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
  } catch {
    return null;
  }
}

export function serializePlanningViewHref(value: PlanningView): string {
  return `#/${value.route}?v=${serializePlanningViewToken(value)}`;
}
