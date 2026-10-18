import type { GraphNode, ProjectGraph } from './graph-service.js';

export interface PlanningReference {
  nodeId: string;
  sourcePath: string;
  field: string;
  authoredRef: string;
  targetId: string | null;
  reason: 'missing' | 'ambiguous' | null;
  candidates: string[];
}

export interface PlanningDiagnostic {
  nodeId: string;
  sourcePath: string;
  field: string;
  reason: string;
  classification: 'source-data';
}

export interface PlanningReadModel {
  graph: ProjectGraph;
  references: PlanningReference[];
  diagnostics: PlanningDiagnostic[];
}

const PARENT_FIELDS = ['epicId', 'featureId', 'storyId', 'specId'];
const REASONS = new Set([
  'missing-reference',
  'ambiguous-reference',
  'invalid-date',
  'missing-date',
  'closed-before-start',
  'end-before-start',
  'dependency-cycle',
  'containment-cycle',
  'duplicate-identity',
]);

export function createReferenceResolver(graph: ProjectGraph) {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const localIds = new Map<string, string[]>();
  for (const node of graph.nodes) {
    const localId = node.id.split('/').at(-1) ?? node.id;
    const candidates = localIds.get(localId) ?? [];
    candidates.push(node.id);
    localIds.set(localId, candidates);
  }
  return (rawRef: unknown, scope: string | null, field: string) => {
    const ref = String(rawRef);
    const scoped = scope && field !== 'specId' && !ref.includes('/') && !/^SPEC-\d+/.test(ref);
    const target = scoped ? `${scope}/${ref}` : ref;
    // Local references never escape their spec to an unrelated unique match.
    const candidates = ids.has(target)
      ? [target]
      : scoped || ref.includes('/')
        ? []
        : [...(localIds.get(ref) ?? [])].sort();
    return {
      authoredRef: ref,
      targetId: candidates.length === 1 ? candidates[0] : null,
      reason:
        candidates.length === 1
          ? null
          : candidates.length
            ? ('ambiguous' as const)
            : ('missing' as const),
      candidates,
    };
  };
}

function calendarTime(value: unknown): number | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)
  )
    return null;
  const day = Date.parse(value.slice(0, 10));
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value.slice(0, 10))
    return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function createPlanningReadModel(
  graph: ProjectGraph,
  sourcePaths: Map<string, string>,
  diagnostics: PlanningDiagnostic[] = [],
): PlanningReadModel {
  const references: PlanningReference[] = [];
  const resolve = createReferenceResolver(graph);
  const warn = (nodeId: string, field: string, reason: string) => {
    diagnostics.push({
      nodeId,
      sourcePath: sourcePaths.get(nodeId) ?? '',
      field,
      reason,
      classification: 'source-data',
    });
  };
  for (const node of graph.nodes) {
    references.push(...collectReferences(node, resolve, sourcePaths.get(node.id) ?? '', warn));
    if (node.type === 'sprint') checkSprintDates(node, warn);
  }
  warnCycles(graph, 'depends_on', warn);
  warnCycles(graph, 'contains', warn);
  return assertPlanningReadModel({ graph, references, diagnostics });
}

type Warn = (nodeId: string, field: string, reason: string) => void;

function collectReferences(
  node: GraphNode,
  resolve: ReturnType<typeof createReferenceResolver>,
  sourcePath: string,
  warn: Warn,
): PlanningReference[] {
  const references: PlanningReference[] = [];
  const fm = node.frontmatter;
  const scope = typeof fm.specScope === 'string' ? fm.specScope : null;
  for (const field of [
    ...PARENT_FIELDS,
    'dependsOn',
    ...(node.type === 'sprint' ? ['taskIds'] : []),
  ]) {
    const value = fm[field];
    const refs = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
    for (const ref of refs) {
      const resolved = resolve(ref, scope, field);
      references.push({
        nodeId: node.id,
        sourcePath,
        field,
        ...resolved,
      });
      if (resolved.reason) warn(node.id, field, `${resolved.reason}-reference`);
    }
  }
  return references;
}

function checkSprintDates(node: GraphNode, warn: Warn) {
  const fm = node.frontmatter;
  const dates = new Map<string, number>();
  for (const field of ['startDate', 'endDate', 'closedAt', 'releaseCut']) {
    const value = fm[field];
    if (value == null || value === '') {
      if (
        field === 'startDate' ||
        field === 'endDate' ||
        (field === 'closedAt' && node.status === 'done')
      )
        warn(node.id, field, 'missing-date');
      continue;
    }
    const time = calendarTime(value);
    if (time === null) warn(node.id, field, 'invalid-date');
    else dates.set(field, time);
  }
  const start = dates.get('startDate');
  if (start === undefined) return;
  for (const [field, reason] of [
    ['endDate', 'end-before-start'],
    ['closedAt', 'closed-before-start'],
  ]) {
    const time = dates.get(field);
    if (time !== undefined && time < start) warn(node.id, field, reason);
  }
}

function warnCycles(graph: ProjectGraph, kind: 'depends_on' | 'contains', warn: Warn) {
  const adjacency = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== kind) continue;
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
    const sources = reverse.get(edge.to) ?? [];
    sources.push(edge.from);
    reverse.set(edge.to, sources);
  }
  // Iterative component traversal keeps deep and overlapping cycles safe and complete.
  const visited = new Set<string>();
  const order: string[] = [];
  for (const node of graph.nodes) {
    if (visited.has(node.id)) continue;
    const stack = [{ id: node.id, index: 0 }];
    visited.add(node.id);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const targets = adjacency.get(frame.id) ?? [];
      if (frame.index === targets.length) {
        order.push(frame.id);
        stack.pop();
        continue;
      }
      const target = targets[frame.index++];
      if (visited.has(target)) continue;
      visited.add(target);
      stack.push({ id: target, index: 0 });
    }
  }
  visited.clear();
  for (const id of order.reverse()) {
    if (visited.has(id)) continue;
    const component: string[] = [];
    const pending = [id];
    visited.add(id);
    while (pending.length) {
      const current = pending.pop();
      if (current === undefined) break;
      component.push(current);
      for (const target of reverse.get(current) ?? []) {
        if (visited.has(target)) continue;
        visited.add(target);
        pending.push(target);
      }
    }
    if (component.length === 1 && !adjacency.get(id)?.includes(id)) continue;
    for (const member of component) {
      warn(
        member,
        kind === 'contains' ? 'parent' : 'dependsOn',
        kind === 'contains' ? 'containment-cycle' : 'dependency-cycle',
      );
    }
  }
}

export function assertPlanningReadModel(model: PlanningReadModel): PlanningReadModel {
  const exactKeys = (value: object, keys: string[]) =>
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
  if (
    !model ||
    !model.graph ||
    !exactKeys(model.graph, ['nodes', 'edges']) ||
    !Array.isArray(model.graph.nodes) ||
    !Array.isArray(model.graph.edges)
  ) {
    throw new TypeError('Invalid Planning read model contract.');
  }
  const validNodes = model.graph.nodes.every(
    (node) =>
      node &&
      typeof node.id === 'string' &&
      node.id.length > 0 &&
      typeof node.title === 'string' &&
      ['epic', 'feature', 'story', 'task', 'spec', 'backlog', 'quick', 'sprint', 'adr'].includes(
        node.type,
      ) &&
      ['done', 'in-progress', 'blocked', 'outstanding', 'addressed'].includes(node.status) &&
      node.frontmatter &&
      typeof node.frontmatter === 'object' &&
      !Array.isArray(node.frontmatter) &&
      Object.keys(node).every((key) =>
        [
          'id',
          'type',
          'title',
          'status',
          'frontmatter',
          'githubIssue',
          'linearIssueIdentifier',
        ].includes(key),
      ),
  );
  if (!validNodes) throw new TypeError('Invalid Planning read model contract.');
  const nodes = new Map(model.graph.nodes.map((node) => [node.id, node]));
  const ids = new Set(nodes.keys());
  const resolve = createReferenceResolver(model.graph);
  const validReference = (entry: PlanningReference) => {
    const node = nodes.get(entry.nodeId);
    if (!node) return false;
    const fields = [...PARENT_FIELDS, 'dependsOn', ...(node.type === 'sprint' ? ['taskIds'] : [])];
    if (!fields.includes(entry.field)) return false;
    const authored = node.frontmatter[entry.field];
    const values = Array.isArray(authored) ? authored : [authored];
    if (!values.some((value) => value != null && String(value) === entry.authoredRef)) return false;
    const scope =
      typeof node.frontmatter.specScope === 'string' ? node.frontmatter.specScope : null;
    const expected = resolve(entry.authoredRef, scope, entry.field);
    return (
      entry.targetId === expected.targetId &&
      entry.reason === expected.reason &&
      JSON.stringify(entry.candidates) === JSON.stringify(expected.candidates)
    );
  };
  const source = (entry: PlanningDiagnostic | PlanningReference) =>
    ids.has(entry.nodeId) &&
    typeof entry.sourcePath === 'string' &&
    entry.sourcePath.length > 0 &&
    !entry.sourcePath.startsWith('/') &&
    !entry.sourcePath.includes('\\') &&
    !entry.sourcePath.split('/').some((part) => part === '.' || part === '..' || part === '') &&
    !/^[A-Za-z]:/.test(entry.sourcePath) &&
    typeof entry.field === 'string';
  if (
    !exactKeys(model, ['graph', 'references', 'diagnostics']) ||
    ids.size !== model.graph.nodes.length ||
    model.graph.edges.some(
      (edge) =>
        !exactKeys(edge, ['from', 'to', 'kind']) ||
        !ids.has(edge.from) ||
        !ids.has(edge.to) ||
        !['contains', 'depends_on'].includes(edge.kind),
    ) ||
    !Array.isArray(model.references) ||
    !Array.isArray(model.diagnostics) ||
    model.references.some(
      (entry) =>
        !source(entry) ||
        !exactKeys(entry, [
          'nodeId',
          'sourcePath',
          'field',
          'authoredRef',
          'targetId',
          'reason',
          'candidates',
        ]) ||
        typeof entry.authoredRef !== 'string' ||
        !validReference(entry) ||
        !Array.isArray(entry.candidates) ||
        entry.candidates.some((id) => !ids.has(id)) ||
        new Set(entry.candidates).size !== entry.candidates.length ||
        (entry.reason === null
          ? entry.candidates.length !== 1 || entry.targetId !== entry.candidates[0]
          : entry.targetId !== null ||
            (entry.reason === 'missing'
              ? entry.candidates.length !== 0
              : entry.reason !== 'ambiguous' || entry.candidates.length < 2)),
    ) ||
    model.diagnostics.some(
      (entry) =>
        !source(entry) ||
        !exactKeys(entry, ['nodeId', 'sourcePath', 'field', 'reason', 'classification']) ||
        !REASONS.has(entry.reason) ||
        entry.classification !== 'source-data',
    )
  ) {
    throw new TypeError('Invalid Planning read model contract.');
  }
  return model;
}
