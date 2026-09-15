import { canonicalDashboardHref } from '../../app/router.js';

/**
 * Pure Planning presentation selectors.
 *
 * The transport adapter owns parsing, binding, revision checks, and live-event
 * reconciliation. This module only projects already-validated, read-only graph
 * data for the Planning screens. It does not fetch, persist, reduce canonical
 * lifecycle state, or manufacture authority.
 */

export type PlanningArtifactType =
  | 'epic'
  | 'feature'
  | 'story'
  | 'task'
  | 'spec'
  | 'backlog'
  | 'quick'
  | 'sprint'
  | 'adr';

export type PlanningArtifactStatus =
  | 'done'
  | 'in-progress'
  | 'blocked'
  | 'outstanding'
  | 'addressed';

export type PlanningModelNode = Readonly<{
  id: string;
  type: PlanningArtifactType;
  title: string;
  status: PlanningArtifactStatus;
  frontmatter: Readonly<Record<string, unknown>>;
  githubIssue?: string | number;
  linearIssueIdentifier?: string;
  body?: string;
}>;

export type PlanningModelEdge = Readonly<{
  from: string;
  to: string;
  kind: 'contains' | 'depends_on';
}>;

export type PlanningModelGraph<Node extends PlanningModelNode = PlanningModelNode> = Readonly<{
  nodes: readonly Node[];
  edges: readonly PlanningModelEdge[];
}>;

export type PlanningFilter = Readonly<{
  typeFilter?: readonly PlanningArtifactType[];
  statusFilter?: PlanningArtifactStatus | null;
  search?: string;
}>;

export type PlanningSortKey = 'id' | 'title' | 'type' | 'status' | 'sprint';
export type PlanningSortDirection = 'asc' | 'desc';

const TYPES = Object.freeze([
  Object.freeze({ id: 'epic', label: 'Epic', plural: 'Epics' }),
  Object.freeze({ id: 'feature', label: 'Feature', plural: 'Features' }),
  Object.freeze({ id: 'story', label: 'Story', plural: 'Stories' }),
  Object.freeze({ id: 'task', label: 'Task', plural: 'Tasks' }),
  Object.freeze({ id: 'spec', label: 'Spec', plural: 'Specs' }),
  Object.freeze({ id: 'backlog', label: 'Backlog', plural: 'Backlog' }),
  Object.freeze({ id: 'quick', label: 'Quick', plural: 'Quick tasks' }),
  Object.freeze({ id: 'sprint', label: 'Sprint', plural: 'Sprints' }),
  Object.freeze({ id: 'adr', label: 'ADR', plural: 'ADRs' }),
] as const);

const TYPE_ORDER = new Map<string, number>(TYPES.map((type, index) => [type.id, index]));
const TYPE_LABEL = new Map<string, string>(TYPES.map((type) => [type.id, type.label]));
const TYPE_PLURAL = new Map<string, string>(TYPES.map((type) => [type.id, type.plural]));

const STATUSES = Object.freeze([
  Object.freeze({ id: 'outstanding', label: 'Outstanding' }),
  Object.freeze({ id: 'in-progress', label: 'In progress' }),
  Object.freeze({ id: 'blocked', label: 'Blocked' }),
  Object.freeze({ id: 'done', label: 'Done' }),
  Object.freeze({ id: 'addressed', label: 'Addressed' }),
] as const);

const STATUS_LABEL = new Map<string, string>(STATUSES.map((status) => [status.id, status.label]));
const STATUS_COLUMN_ORDER = Object.freeze([
  'outstanding',
  'in-progress',
  'blocked',
  'done',
] as const);
const STATUS_SORT_LABEL: Readonly<Record<PlanningArtifactStatus, string>> = Object.freeze({
  blocked: 'blocked',
  done: 'done',
  'in-progress': 'in progress',
  outstanding: 'outstanding',
  addressed: 'addressed',
});

function titleCase(value: string): string {
  const normalized = value.trim();
  return normalized ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` : 'Item';
}

function typeOrder(value: string): number {
  return TYPE_ORDER.get(value) ?? TYPES.length;
}

/** Product-facing artifact type label without exposing the wire enum. */
export function planningArtifactTypeLabel(value: string): string {
  return TYPE_LABEL.get(value) ?? titleCase(value);
}

function typePlural(value: string): string {
  return TYPE_PLURAL.get(value) ?? planningArtifactTypeLabel(value);
}

/** Product-facing artifact status label without exposing the wire enum. */
export function planningArtifactStatusLabel(value: string): string {
  return STATUS_LABEL.get(value) ?? (value || 'Unknown');
}

/** Human-facing local id; the canonical, possibly namespaced id remains untouched. */
export function planningDisplayId(node: PlanningModelNode | string | null | undefined): string {
  if (node == null) return '';
  if (typeof node === 'string') {
    const separator = node.lastIndexOf('/');
    return separator >= 0 ? node.slice(separator + 1) : node;
  }
  const authored = node.frontmatter.id;
  if (authored != null && authored !== '') return String(authored);
  const separator = node.id.lastIndexOf('/');
  return separator >= 0 ? node.id.slice(separator + 1) : node.id;
}

function sprintOf(node: PlanningModelNode): unknown {
  return node.frontmatter.sprintId ?? node.frontmatter.sprint ?? '';
}

/** Local type/status/search filtering. Source nodes and source order are never changed. */
export function filterPlanningNodes<Node extends PlanningModelNode>(
  nodes: readonly Node[],
  filter: PlanningFilter = Object.freeze({}),
): readonly Node[] {
  const types = filter.typeFilter ?? [];
  const status = filter.statusFilter ?? null;
  const search = typeof filter.search === 'string' ? filter.search.trim().toLowerCase() : '';
  return Object.freeze(
    nodes.filter((node) => {
      if (types.length > 0 && !types.includes(node.type)) return false;
      if (status !== null && node.status !== status) return false;
      if (search) {
        const haystack = `${node.id} ${planningDisplayId(node)} ${node.title}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    }),
  );
}

function planningSortValue(node: PlanningModelNode, key: PlanningSortKey): string {
  switch (key) {
    case 'id':
      return node.id;
    case 'title':
      return node.title;
    case 'type':
      return node.type;
    case 'status':
      return STATUS_SORT_LABEL[node.status] ?? node.status;
    case 'sprint':
      return String(sprintOf(node));
  }
}

/** Stable legacy-compatible list sorting. */
export function sortPlanningNodes<Node extends PlanningModelNode>(
  nodes: readonly Node[],
  sortKey: PlanningSortKey = 'id',
  direction: PlanningSortDirection = 'asc',
): readonly Node[] {
  const multiplier = direction === 'desc' ? -1 : 1;
  return Object.freeze(
    nodes
      .map((node, index) => ({ node, index }))
      .sort((left, right) => {
        const comparison = planningSortValue(left.node, sortKey).localeCompare(
          planningSortValue(right.node, sortKey),
          undefined,
          { numeric: true, sensitivity: 'base' },
        );
        return comparison !== 0 ? comparison * multiplier : left.index - right.index;
      })
      .map(({ node }) => node),
  );
}

export type PlanningStatusTally = Readonly<{
  outstanding: number;
  inProgress: number;
  blocked: number;
  done: number;
}>;

/** Count real artifact statuses; addressed folds into done exactly as the Board columns do. */
export function tallyPlanningStatuses(nodes: readonly PlanningModelNode[]): PlanningStatusTally {
  let outstanding = 0;
  let inProgress = 0;
  let blocked = 0;
  let done = 0;
  for (const node of nodes) {
    if (node.status === 'done' || node.status === 'addressed') done += 1;
    else if (node.status === 'in-progress') inProgress += 1;
    else if (node.status === 'blocked') blocked += 1;
    else outstanding += 1;
  }
  return Object.freeze({ outstanding, inProgress, blocked, done });
}

/** Exact spec scope used by the legacy Board and detail presentation. */
export function planningSpecOf(node: PlanningModelNode): string | null {
  const { frontmatter } = node;
  if (typeof frontmatter.specScope === 'string' && frontmatter.specScope) {
    return frontmatter.specScope;
  }
  if (typeof frontmatter.specId === 'string' && frontmatter.specId) {
    return frontmatter.specId;
  }
  const separator = node.id.indexOf('/');
  if (separator >= 0) {
    const scope = node.id.slice(0, separator);
    if (/^SPEC-/iu.test(scope)) return scope;
  }
  if (node.type === 'spec') {
    const own = frontmatter.id != null && frontmatter.id !== '' ? frontmatter.id : node.id;
    return own == null || own === '' ? null : String(own);
  }
  return null;
}

export function planningSpecsInGraph(nodes: readonly PlanningModelNode[]): readonly string[] {
  const specs = new Set<string>();
  for (const node of nodes) {
    const spec = planningSpecOf(node);
    if (spec) specs.add(spec);
  }
  return Object.freeze(
    [...specs].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }),
    ),
  );
}

function statusColumnOf(status: PlanningArtifactStatus): string {
  if (status === 'addressed') return 'done';
  return (STATUS_COLUMN_ORDER as readonly string[]).includes(status) ? status : 'outstanding';
}

export function planningGroupKey(node: PlanningModelNode, dimension: string): string {
  const { frontmatter } = node;
  switch (dimension) {
    case 'status':
      return statusColumnOf(node.status);
    case 'type':
      return node.type || 'unknown';
    case 'sprint':
      return String(sprintOf(node) || '');
    case 'feature':
      return frontmatter.featureId == null ? '' : String(frontmatter.featureId);
    case 'epic':
      return frontmatter.epicId == null ? '' : String(frontmatter.epicId);
    case 'spec':
      return planningSpecOf(node) ?? '';
    default:
      return frontmatter[dimension] == null ? '' : String(frontmatter[dimension]);
  }
}

function groupDimensionLabel(dimension: string): string {
  switch (dimension) {
    case 'status':
      return 'Status';
    case 'type':
      return 'Type';
    case 'sprint':
      return 'Sprint';
    case 'feature':
      return 'Feature';
    case 'epic':
      return 'Epic';
    case 'spec':
      return 'Spec';
    default:
      return titleCase(dimension || 'Group');
  }
}

export type PlanningGroupingDimension = Readonly<{ key: string; label: string }>;

/** Dimensions offered by the Board, derived only from fields present in the graph. */
export function planningGroupingDimensions(
  nodes: readonly PlanningModelNode[],
): readonly PlanningGroupingDimension[] {
  const dimensions: PlanningGroupingDimension[] = [];
  if (nodes.length > 0) {
    dimensions.push(Object.freeze({ key: 'status', label: 'Status' }));
    dimensions.push(Object.freeze({ key: 'type', label: 'Type' }));
  }
  const has = (dimension: string): boolean =>
    nodes.some((node) => planningGroupKey(node, dimension) !== '');
  if (has('sprint')) dimensions.push(Object.freeze({ key: 'sprint', label: 'Sprint' }));
  if (has('feature')) dimensions.push(Object.freeze({ key: 'feature', label: 'Feature' }));
  if (has('epic')) dimensions.push(Object.freeze({ key: 'epic', label: 'Epic' }));
  if (planningSpecsInGraph(nodes).length > 0) {
    dimensions.push(Object.freeze({ key: 'spec', label: 'Spec' }));
  }
  return Object.freeze(dimensions);
}

function groupBucketLabel(dimension: string, key: string): string {
  if (!key) return `No ${groupDimensionLabel(dimension).toLowerCase()}`;
  if (dimension === 'status') return planningArtifactStatusLabel(key);
  if (dimension === 'type') return typePlural(key);
  return key;
}

export type PlanningGroup<Node extends PlanningModelNode = PlanningModelNode> = Readonly<{
  key: string;
  label: string;
  nodes: readonly Node[];
}>;

/** Ordered Board buckets. Addressed work folds into Done exactly as in the legacy Board. */
export function groupPlanningNodes<Node extends PlanningModelNode>(
  nodes: readonly Node[],
  dimension: string,
): readonly PlanningGroup<Node>[] {
  if (dimension === 'status') {
    const buckets = new Map<string, Node[]>(STATUS_COLUMN_ORDER.map((key) => [key, []]));
    for (const node of nodes) buckets.get(statusColumnOf(node.status))?.push(node);
    return Object.freeze(
      STATUS_COLUMN_ORDER.map((key) =>
        Object.freeze({
          key,
          label: planningArtifactStatusLabel(key),
          nodes: Object.freeze(buckets.get(key) ?? []),
        }),
      ),
    );
  }

  const buckets = new Map<string, Node[]>();
  for (const node of nodes) {
    const key = planningGroupKey(node, dimension);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(node);
    else buckets.set(key, [node]);
  }

  let keys: string[];
  if (dimension === 'type') {
    keys = [...buckets.keys()].sort(
      (left, right) => typeOrder(left) - typeOrder(right) || left.localeCompare(right),
    );
  } else {
    keys = [...buckets.keys()]
      .filter((key) => key !== '')
      .sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }),
      );
    if (buckets.has('')) keys.push('');
  }

  return Object.freeze(
    keys.map((key) =>
      Object.freeze({
        key,
        label: groupBucketLabel(dimension, key),
        nodes: Object.freeze(buckets.get(key) ?? []),
      }),
    ),
  );
}

function normalizeSearch(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

function trigrams(value: unknown): readonly string[] {
  const normalized = normalizeSearch(value);
  if (!normalized) return Object.freeze([]);
  if (normalized.length < 3) return Object.freeze([normalized]);
  const result: string[] = [];
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    result.push(normalized.slice(index, index + 3));
  }
  return Object.freeze(result);
}

export type PlanningSearchIndex<Node extends PlanningModelNode = PlanningModelNode> = Readonly<{
  nodes: readonly Node[];
  byId: ReadonlyMap<string, Node>;
  postings: ReadonlyMap<string, ReadonlySet<string>>;
}>;

/** Local trigram index. It contains only access-safe node summaries already in the graph. */
export function buildPlanningSearchIndex<Node extends PlanningModelNode>(
  nodes: readonly Node[],
): PlanningSearchIndex<Node> {
  const byId = new Map<string, Node>();
  const mutablePostings = new Map<string, Set<string>>();
  for (const node of nodes) {
    byId.set(node.id, node);
    const grams = new Set([...trigrams(node.id), ...trigrams(node.title)]);
    for (const gram of grams) {
      const ids = mutablePostings.get(gram);
      if (ids) ids.add(node.id);
      else mutablePostings.set(gram, new Set([node.id]));
    }
  }
  const postings = new Map<string, ReadonlySet<string>>(
    [...mutablePostings].map(([gram, ids]) => [gram, new Set(ids)]),
  );
  return Object.freeze({ nodes: Object.freeze([...nodes]), byId, postings });
}

/** Legacy-compatible local search: score descending, id tie-break, at most 20 by default. */
export function queryPlanningSearchIndex<Node extends PlanningModelNode>(
  index: PlanningSearchIndex<Node>,
  term: string,
  maximumResults = 20,
): readonly Node[] {
  const normalized = normalizeSearch(term);
  if (!normalized || !Number.isSafeInteger(maximumResults) || maximumResults < 0) {
    return Object.freeze([]);
  }
  const grams = trigrams(normalized);
  const scores = new Map<string, number>();
  for (const gram of grams) {
    const ids = index.postings.get(gram);
    if (!ids) continue;
    for (const id of ids) scores.set(id, (scores.get(id) ?? 0) + 1);
  }
  for (const node of index.nodes) {
    const haystack = `${normalizeSearch(node.id)} ${normalizeSearch(node.title)}`;
    if (haystack.includes(normalized)) {
      scores.set(node.id, (scores.get(node.id) ?? 0) + grams.length + 1);
    }
  }
  return Object.freeze(
    [...scores]
      .sort(
        ([leftId, leftScore], [rightId, rightScore]) =>
          rightScore - leftScore || leftId.localeCompare(rightId),
      )
      .slice(0, maximumResults)
      .map(([id]) => index.byId.get(id))
      .filter((node): node is Node => node !== undefined),
  );
}

export function searchPlanningNodes<Node extends PlanningModelNode>(
  nodes: readonly Node[],
  term: string,
  maximumResults = 20,
): readonly Node[] {
  return queryPlanningSearchIndex(buildPlanningSearchIndex(nodes), term, maximumResults);
}

function isDone(status: PlanningArtifactStatus): boolean {
  return status === 'done' || status === 'addressed';
}

function timestampOf(node: PlanningModelNode): number {
  const raw = node.frontmatter.updated ?? node.frontmatter.created;
  if (raw == null || raw === '') return Number.NaN;
  if (typeof raw === 'number') return raw;
  const parsed = Date.parse(String(raw));
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

export type PlanningBurndownPoint = Readonly<{ day: number; remaining: number }>;
export type PlanningSprintSelection = Readonly<{
  sprintId: string;
  committed: number;
  completed: number;
  carryover: number;
  velocity: number;
  burndownPoints: readonly PlanningBurndownPoint[];
}>;

function planningBurndown(
  sprint: PlanningModelNode,
  members: readonly PlanningModelNode[],
): readonly PlanningBurndownPoint[] {
  const startValue = sprint.frontmatter.created;
  const startTimestamp =
    startValue == null || startValue === '' ? Number.NaN : Date.parse(String(startValue));
  const start = Number.isNaN(startTimestamp) ? 0 : startTimestamp;
  const dayMilliseconds = 86_400_000;
  const configuredLength = Number(sprint.frontmatter.lengthDays);
  const lengthDays = configuredLength > 0 ? Math.floor(configuredLength) : 0;
  let latest = start;
  for (const member of members) {
    const timestamp = timestampOf(member);
    if (!Number.isNaN(timestamp) && timestamp > latest) latest = timestamp;
  }
  const elapsedFromData =
    start > 0 ? Math.max(0, Math.floor((latest - start) / dayMilliseconds)) : 0;
  const totalDays = lengthDays > 0 ? lengthDays : Math.max(elapsedFromData, members.length, 1);
  const currentDay =
    lengthDays > 0 ? Math.min(elapsedFromData, lengthDays) : Math.max(elapsedFromData, 0);

  const completedDays: number[] = [];
  for (const member of members) {
    if (!isDone(member.status)) continue;
    const timestamp = timestampOf(member);
    let day =
      start > 0 && !Number.isNaN(timestamp)
        ? Math.floor((timestamp - start) / dayMilliseconds)
        : totalDays;
    day = Math.max(0, Math.min(totalDays, day));
    completedDays.push(day);
  }

  const points: PlanningBurndownPoint[] = [];
  for (let day = 0; day <= Math.max(currentDay, 0); day += 1) {
    const completed = completedDays.filter((completedDay) => completedDay <= day).length;
    points.push(Object.freeze({ day, remaining: Math.max(0, members.length - completed) }));
  }
  return Object.freeze(points);
}

/** Active sprint and burndown values, matching the existing dashboard projection exactly. */
export function selectPlanningSprint(graph: PlanningModelGraph): PlanningSprintSelection | null {
  const active = graph.nodes
    .filter((node) => node.type === 'sprint' && node.status !== 'done')
    .map((node, index) => ({ node, index }))
    .sort((left, right) => {
      const leftCreated = left.node.frontmatter.created ?? '';
      const rightCreated = right.node.frontmatter.created ?? '';
      const comparison = String(leftCreated).localeCompare(String(rightCreated));
      return comparison || left.index - right.index;
    })[0]?.node;
  if (!active) return null;

  const sprintId = active.id;
  const members = graph.nodes.filter(
    (node) => node.type !== 'sprint' && String(sprintOf(node)) === sprintId,
  );
  const committed = members.length;
  const completed = members.filter((member) => isDone(member.status)).length;
  const burndownPoints = planningBurndown(active, members);
  const configuredLength = Number(active.frontmatter.lengthDays);
  const lengthDays = configuredLength > 0 ? Math.floor(configuredLength) : 0;
  const lastDay = burndownPoints.at(-1)?.day ?? 0;
  const carryover =
    lengthDays > 0 && lastDay >= lengthDays ? Math.max(0, committed - completed) : 0;

  return Object.freeze({
    sprintId,
    committed,
    completed,
    carryover,
    velocity: completed,
    burndownPoints,
  });
}

export type PlanningSprintAssignee = Readonly<{
  name: string;
  committed: number;
  done: number;
  inProgress: number;
  blocked: number;
}>;

export type PlanningSprintWorkspace = Readonly<{
  id: string;
  name: string;
  rangeLabel: string;
  lengthDays: number;
  elapsedDays: number;
  committed: number;
  done: number;
  inProgress: number;
  blocked: number;
  carryover: number;
  completionPct: number;
  velocity: number;
  ideal: readonly PlanningBurndownPoint[];
  actual: readonly PlanningBurndownPoint[];
  assignees: readonly PlanningSprintAssignee[];
}>;

function assigneeOf(node: PlanningModelNode): string {
  const raw =
    node.frontmatter.agent != null && node.frontmatter.agent !== ''
      ? node.frontmatter.agent
      : node.frontmatter.owner != null && node.frontmatter.owner !== ''
        ? node.frontmatter.owner
        : 'unassigned';
  return String(raw);
}

/** Complete deterministic Sprint screen projection; the empty state has no clock dependency. */
export function selectPlanningSprintWorkspace(graph: PlanningModelGraph): PlanningSprintWorkspace {
  const summary = selectPlanningSprint(graph);
  if (!summary) {
    return Object.freeze({
      id: 'S-00',
      name: 'No active sprint',
      rangeLabel: 'no sprint in progress',
      lengthDays: 10,
      elapsedDays: 0,
      committed: 0,
      done: 0,
      inProgress: 0,
      blocked: 0,
      carryover: 0,
      completionPct: 0,
      velocity: 0,
      ideal: Object.freeze([
        Object.freeze({ day: 0, remaining: 0 }),
        Object.freeze({ day: 10, remaining: 0 }),
      ]),
      actual: Object.freeze([Object.freeze({ day: 0, remaining: 0 })]),
      assignees: Object.freeze([]),
    });
  }

  const sprint = graph.nodes.find((node) => node.type === 'sprint' && node.id === summary.sprintId);
  const members = graph.nodes.filter(
    (node) => node.type !== 'sprint' && String(sprintOf(node)) === summary.sprintId,
  );
  const elapsedDays = summary.burndownPoints.at(-1)?.day ?? 0;
  const configuredLength = Number(sprint?.frontmatter.lengthDays);
  const lengthDays =
    configuredLength > 0 ? Math.floor(configuredLength) : Math.max(elapsedDays, 10);
  const ideal: PlanningBurndownPoint[] = [];
  for (let day = 0; day <= lengthDays; day += 1) {
    ideal.push(
      Object.freeze({
        day,
        remaining: summary.committed * (1 - day / lengthDays),
      }),
    );
  }

  const byName = new Map<string, PlanningSprintAssignee>();
  for (const member of members) {
    const name = assigneeOf(member);
    const current = byName.get(name) ?? {
      name,
      committed: 0,
      done: 0,
      inProgress: 0,
      blocked: 0,
    };
    byName.set(
      name,
      Object.freeze({
        name,
        committed: current.committed + 1,
        done: current.done + (isDone(member.status) ? 1 : 0),
        inProgress: current.inProgress + (member.status === 'in-progress' ? 1 : 0),
        blocked: current.blocked + (member.status === 'blocked' ? 1 : 0),
      }),
    );
  }

  return Object.freeze({
    id: summary.sprintId,
    name: sprint?.title || 'Current sprint',
    rangeLabel:
      sprint?.frontmatter.range != null && sprint.frontmatter.range !== ''
        ? String(sprint.frontmatter.range)
        : `day ${elapsedDays} of ${lengthDays}`,
    lengthDays,
    elapsedDays,
    committed: summary.committed,
    done: summary.completed,
    inProgress: members.filter((member) => member.status === 'in-progress').length,
    blocked: members.filter((member) => member.status === 'blocked').length,
    carryover: summary.carryover,
    completionPct: summary.committed
      ? Math.round((summary.completed / summary.committed) * 100)
      : 0,
    velocity: summary.velocity,
    ideal: Object.freeze(ideal),
    actual: summary.burndownPoints,
    assignees: Object.freeze(
      [...byName.values()].sort(
        (left, right) => right.committed - left.committed || left.name.localeCompare(right.name),
      ),
    ),
  });
}

export type PlanningPatchLike<Node extends PlanningModelNode = PlanningModelNode> = Readonly<{
  updated: readonly Node[];
  added: readonly Node[];
  removed: readonly (Node | string)[];
}>;

export type PlanningPatchSignalLike<Node extends PlanningModelNode = PlanningModelNode> = Readonly<{
  patch: PlanningPatchLike<Node>;
}>;

export type PlanningActivityEntry = Readonly<{
  type: string;
  status: PlanningArtifactStatus;
  text: string;
  id: string;
  actor: string;
}>;

function activityStatus(value: unknown): PlanningArtifactStatus {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (
    normalized === 'done' ||
    normalized === 'in-progress' ||
    normalized === 'blocked' ||
    normalized === 'outstanding' ||
    normalized === 'addressed'
  ) {
    return normalized;
  }
  if (normalized === 'in_progress' || normalized === 'in progress') return 'in-progress';
  return 'outstanding';
}

/** One legacy-compatible activity row from a validated watcher patch. */
export function planningActivityEntry<Node extends PlanningModelNode>(
  source: PlanningPatchLike<Node> | PlanningPatchSignalLike<Node>,
): PlanningActivityEntry | null {
  const patch = 'patch' in source ? source.patch : source;
  const node = patch.updated[0] ?? patch.added[0] ?? null;
  if (node) {
    const added = patch.added.includes(node);
    const actor = node.frontmatter.agent ?? node.frontmatter.owner ?? '';
    return Object.freeze({
      type: node.type,
      status: activityStatus(node.status),
      id: node.id,
      text: `${node.id} → ${node.status || (added ? 'added' : 'updated')}`,
      actor: actor ? String(actor) : '.planr/ change',
    });
  }
  const removed = patch.removed[0];
  if (removed == null) return null;
  const id = typeof removed === 'string' ? removed : removed.id;
  return Object.freeze({
    type: typeof removed === 'string' ? '' : removed.type,
    status: 'outstanding',
    id,
    text: `${id} removed`,
    actor: '.planr/ change',
  });
}

/** Activity input is append-ordered; the presentation is newest-first without re-ranking. */
export function selectPlanningActivity<Node extends PlanningModelNode>(
  sources: readonly (PlanningPatchLike<Node> | PlanningPatchSignalLike<Node>)[],
): readonly PlanningActivityEntry[] {
  const entries: PlanningActivityEntry[] = [];
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const entry = planningActivityEntry(sources[index]);
    if (entry) entries.push(entry);
  }
  return Object.freeze(entries);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Canonical closed detail subject, or null when this exact opaque id is not routable. */
export function planningRouteSubjectId(nodeOrId: PlanningModelNode | string): string | null {
  const id = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id;
  if (!id || hasUnpairedSurrogate(id)) return null;
  let output = '';
  for (const byte of new TextEncoder().encode(id)) {
    const character = String.fromCharCode(byte);
    output += /^[A-Za-z0-9._-]$/u.test(character)
      ? character
      : `:${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return output;
}

/** Reverse the route-only escaping without changing the canonical graph identity. */
export function planningNodeIdFromRouteSubject(subjectId: string): string | null {
  const bytes: number[] = [];
  for (let index = 0; index < subjectId.length; index += 1) {
    const character = subjectId[index];
    if (character !== ':') {
      if (!/^[A-Za-z0-9._-]$/u.test(character)) return null;
      bytes.push(character.charCodeAt(0));
      continue;
    }
    const encodedByte = subjectId.slice(index + 1, index + 3);
    if (!/^[0-9A-F]{2}$/u.test(encodedByte)) return null;
    bytes.push(Number.parseInt(encodedByte, 16));
    index += 2;
  }
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    return decoded && planningRouteSubjectId(decoded) === subjectId ? decoded : null;
  } catch {
    return null;
  }
}

export function planningDetailHref(nodeOrId: PlanningModelNode | string): string | null {
  const subjectId = planningRouteSubjectId(nodeOrId);
  if (subjectId === null) return null;
  return canonicalDashboardHref(`#/detail/${encodeURIComponent(subjectId)}`);
}

export function planningChildrenOf<Node extends PlanningModelNode>(
  graph: PlanningModelGraph<Node>,
  parentId: string,
): readonly Node[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return Object.freeze(
    graph.edges
      .filter((edge) => edge.kind === 'contains' && edge.from === parentId)
      .map((edge) => byId.get(edge.to))
      .filter((node): node is Node => node !== undefined),
  );
}

export function planningSprintMembersOf<Node extends PlanningModelNode>(
  graph: PlanningModelGraph<Node>,
  sprint: Node,
): readonly Node[] {
  const localId = planningDisplayId(sprint);
  return Object.freeze(
    graph.nodes.filter((node) => {
      if (node.id === sprint.id) return false;
      const reference = String(sprintOf(node) || '');
      return reference === localId || reference === sprint.id;
    }),
  );
}

function parsePlanningSubtasks(body: string | undefined): readonly Readonly<{
  text: string;
  done: boolean;
}>[] {
  const subtasks: Readonly<{ text: string; done: boolean }>[] = [];
  for (const line of String(body ?? '').split('\n')) {
    const match = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/u);
    if (!match) continue;
    subtasks.push(Object.freeze({ text: match[2].trim(), done: match[1].toLowerCase() === 'x' }));
  }
  return Object.freeze(subtasks);
}

function parsePlanningCriteria(body: string | undefined): readonly string[] {
  const criteria: string[] = [];
  let inAcceptanceCriteria = false;
  for (const line of String(body ?? '').split('\n')) {
    const heading = line.match(/^#{2,6}\s+(.*)$/u);
    if (heading) {
      inAcceptanceCriteria = /acceptance criteria/iu.test(heading[1]);
      continue;
    }
    if (!inAcceptanceCriteria || /^\s*[-*+]\s+\[[ xX]\]/u.test(line)) continue;
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/u);
    if (bullet?.[1].trim()) criteria.push(bullet[1].trim());
  }
  return Object.freeze(criteria);
}

function stringifyPlanningMeta(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (value !== null && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export type PlanningDetailSelection = Readonly<{
  header: Readonly<{ id: string; title: string; type: string; status: string }>;
  meta: Readonly<Record<string, string>>;
  criteria: readonly string[];
  subtasks: readonly Readonly<{ text: string; done: boolean }>[];
  depIds: readonly string[];
  shipRef?: string;
  qaRef?: string;
}>;

const DETAIL_HEADER_FIELDS = new Set(['id', 'title', 'type', 'status', 'body']);

/** Exact detail display transform. Binding and node-hash checks happen in planning-api. */
export function selectPlanningDetail(node: PlanningModelNode): PlanningDetailSelection {
  const meta: Record<string, string> = {};
  for (const [key, value] of Object.entries(node.frontmatter)) {
    if (DETAIL_HEADER_FIELDS.has(key) || value == null) continue;
    meta[key] = stringifyPlanningMeta(value);
  }
  const dependencyValue = node.frontmatter.dependsOn;
  const depIds = Array.isArray(dependencyValue)
    ? dependencyValue.map((dependency) => String(dependency))
    : [];
  const shipRef = node.frontmatter.shipRef;
  const qaRef = node.frontmatter.qaRef;
  return Object.freeze({
    header: Object.freeze({
      id: node.id,
      title: node.title,
      type: node.type,
      status: node.status,
    }),
    meta: Object.freeze(meta),
    criteria: parsePlanningCriteria(node.body),
    subtasks: parsePlanningSubtasks(node.body),
    depIds: Object.freeze(depIds),
    ...(shipRef != null && shipRef !== '' ? { shipRef: String(shipRef) } : {}),
    ...(qaRef != null && qaRef !== '' ? { qaRef: String(qaRef) } : {}),
  });
}

export type AccessiblePlanningGraphRow = Readonly<{
  id: string;
  displayId: string;
  title: string;
  type: PlanningArtifactType;
  status: PlanningArtifactStatus;
  graphIndex: number;
  hierarchyLevel: number | null;
  containedBy: readonly string[];
  contains: readonly string[];
  dependsOn: readonly string[];
  requiredBy: readonly string[];
  detailHref: string | null;
}>;

/**
 * Stable nonvisual graph alternative. Rows keep canonical node order and each
 * relationship list keeps canonical edge order; no lifecycle state is inferred.
 */
export function selectAccessiblePlanningGraphRows(
  graph: PlanningModelGraph,
): readonly AccessiblePlanningGraphRow[] {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const dependencies = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const node of graph.nodes) {
    parents.set(node.id, []);
    children.set(node.id, []);
    dependencies.set(node.id, []);
    dependents.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (edge.kind === 'contains') {
      parents.get(edge.to)?.push(edge.from);
      children.get(edge.from)?.push(edge.to);
    } else {
      dependencies.get(edge.from)?.push(edge.to);
      dependents.get(edge.to)?.push(edge.from);
    }
  }

  const levels = new Map<string, number>();
  const queue: string[] = [];
  for (const node of graph.nodes) {
    if ((parents.get(node.id)?.length ?? 0) === 0) {
      levels.set(node.id, 1);
      queue.push(node.id);
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    const level = levels.get(id);
    if (level === undefined) continue;
    for (const child of children.get(id) ?? []) {
      const next = level + 1;
      const current = levels.get(child);
      if (current === undefined || next < current) {
        levels.set(child, next);
        queue.push(child);
      }
    }
  }

  return Object.freeze(
    graph.nodes.map((node, graphIndex) =>
      Object.freeze({
        id: node.id,
        displayId: planningDisplayId(node),
        title: node.title,
        type: node.type,
        status: node.status,
        graphIndex,
        hierarchyLevel: levels.get(node.id) ?? null,
        containedBy: Object.freeze([...(parents.get(node.id) ?? [])]),
        contains: Object.freeze([...(children.get(node.id) ?? [])]),
        dependsOn: Object.freeze([...(dependencies.get(node.id) ?? [])]),
        requiredBy: Object.freeze([...(dependents.get(node.id) ?? [])]),
        detailHref: planningDetailHref(node),
      }),
    ),
  );
}
