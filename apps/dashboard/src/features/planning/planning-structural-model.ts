import { validPlanningFilePath } from '@openplanr/protocol/dashboard/planning-file-link-contracts.mjs';
import {
  type PlanningModelGraph,
  type PlanningModelNode,
  planningDisplayId,
  planningSpecOf,
} from './planning-model.js';

export type StructuralReference = Readonly<{
  reference: string;
  node: PlanningModelNode | null;
  reason: string | null;
}>;
export type StructuralCriterion = Readonly<{
  id: string | null;
  text: string;
  sourceId?: string;
}>;
export type StructuralFile = Readonly<{ group: string; path: string | null; text: string }>;
export type StructuralEvidence = Readonly<{ label: string; value: string; href: string | null }>;
export type StructuralTraceEntry = Readonly<{
  node: PlanningModelNode;
  role: string;
  blockedBy: number;
}>;
export type StructuralDetailModel = Readonly<{
  sourcePath: string | null;
  criteria: readonly StructuralCriterion[];
  files: readonly StructuralFile[];
  evidence: readonly StructuralEvidence[];
  parents: readonly StructuralReference[];
  children: readonly StructuralReference[];
  dependencies: readonly StructuralReference[];
  dependents: readonly StructuralReference[];
  trace: readonly StructuralTraceEntry[];
  warnings: readonly string[];
}>;
export type StructuralIndex = Readonly<{
  byId: ReadonlyMap<string, PlanningModelNode>;
  resolve: (reference: string, source?: PlanningModelNode) => StructuralReference;
  parents: ReadonlyMap<string, readonly StructuralReference[]>;
  children: ReadonlyMap<string, readonly StructuralReference[]>;
  dependencies: ReadonlyMap<string, readonly StructuralReference[]>;
  dependents: ReadonlyMap<string, readonly StructuralReference[]>;
  origins: ReadonlyMap<string, readonly StructuralReference[]>;
}>;

function strings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  return Array.isArray(value) ? value.flatMap(strings) : [];
}

/** Build once per immutable graph revision; detail selection never scans the edge list. */
export function createStructuralIndex(graph: PlanningModelGraph): StructuralIndex {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const byLocal = new Map<string, PlanningModelNode[]>();
  const parents = new Map<string, StructuralReference[]>();
  const children = new Map<string, StructuralReference[]>();
  const dependencies = new Map<string, StructuralReference[]>();
  const dependents = new Map<string, StructuralReference[]>();
  const origins = new Map<string, StructuralReference[]>();
  for (const node of graph.nodes) {
    const local = planningDisplayId(node);
    byLocal.set(local, [...(byLocal.get(local) ?? []), node]);
  }
  const resolved = (reference: string, node: PlanningModelNode): StructuralReference =>
    Object.freeze({ reference, node, reason: null });
  const resolve = (reference: string, source?: PlanningModelNode): StructuralReference => {
    const scope = source ? planningSpecOf(source) : null;
    // An explicit qualified identity is exact. Local authored references prefer their scope.
    const scoped = scope && !reference.includes('/') ? byId.get(`${scope}/${reference}`) : null;
    const exact = scoped ?? byId.get(reference);
    if (exact) return resolved(reference, exact);
    const candidates = reference.includes('/') ? [] : (byLocal.get(reference) ?? []);
    if (candidates.length === 1) return resolved(reference, candidates[0]);
    return Object.freeze({
      reference,
      node: null,
      reason:
        candidates.length > 1
          ? 'Ambiguous reference in the current graph'
          : 'Missing from the current graph',
    });
  };
  const add = (map: Map<string, StructuralReference[]>, id: string, ref: StructuralReference) => {
    const rows = map.get(id) ?? [];
    if (!rows.some((row) => (row.node?.id ?? row.reference) === (ref.node?.id ?? ref.reference)))
      rows.push(ref);
    map.set(id, rows);
  };
  const relate = (
    from: PlanningModelNode,
    reference: string,
    kind: 'contains' | 'depends_on' | 'origin',
    canonical = false,
  ) => {
    const target = canonical ? byId.get(reference) : undefined;
    const ref = target ? resolved(reference, target) : resolve(reference, from);
    if (kind === 'origin') {
      add(origins, from.id, ref);
    } else if (kind === 'contains') {
      add(children, from.id, ref);
      if (ref.node) add(parents, ref.node.id, resolved(from.id, from));
    } else {
      add(dependencies, from.id, ref);
      if (ref.node) add(dependents, ref.node.id, resolved(from.id, from));
    }
  };
  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    if (from) relate(from, edge.to, edge.kind, true);
  }
  for (const node of graph.nodes) {
    for (const reference of strings(node.frontmatter.dependsOn))
      relate(node, reference, 'depends_on');
    for (const field of ['epicId', 'featureId', 'storyId', 'specId']) {
      for (const reference of strings(node.frontmatter[field])) {
        const ref = resolve(reference, node);
        add(parents, node.id, ref);
        if (ref.node) add(children, ref.node.id, resolved(node.id, node));
      }
    }
    for (const reference of strings(node.frontmatter.originId)) relate(node, reference, 'origin');
  }
  return Object.freeze({ byId, resolve, parents, children, dependencies, dependents, origins });
}

function criterion(text: string, sourceId?: string, authoredId?: string): StructuralCriterion {
  const clean = text.replace(/^\s*\[[ xX]\]\s*/u, '').trim();
  const match = clean.match(/^(?:\*\*)?(AC-[\w.-]+)(?:\*\*)?\s*[:.)-]?\s*(.*)$/u);
  return Object.freeze({
    id: authoredId ?? match?.[1] ?? null,
    text: match?.[2] || clean,
    ...(sourceId ? { sourceId } : {}),
  });
}

function ownCriteria(node: PlanningModelNode): StructuralCriterion[] {
  const rows: StructuralCriterion[] = [];
  const values = node.frontmatter.acceptanceCriteria;
  if (Array.isArray(values)) {
    for (const value of values) {
      if (typeof value === 'string') rows.push(criterion(value, node.id));
      else if (value && typeof value === 'object') {
        const entry = value as Record<string, unknown>;
        if (
          typeof entry.text === 'string' ||
          typeof entry.description === 'string' ||
          typeof entry.statement === 'string'
        )
          rows.push(
            criterion(
              String(entry.text ?? entry.description ?? entry.statement),
              node.id,
              typeof entry.id === 'string' ? entry.id : undefined,
            ),
          );
      }
    }
  }
  let inCriteria = false;
  let criteriaDepth = 0;
  for (const line of (node.body ?? '').split('\n')) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/u);
    if (heading) {
      if (/acceptance criteria/iu.test(heading[2])) {
        inCriteria = true;
        criteriaDepth = heading[1].length;
      } else if (inCriteria && heading[1].length <= criteriaDepth) inCriteria = false;
      else if (inCriteria && /^AC-/u.test(heading[2])) rows.push(criterion(heading[2], node.id));
      continue;
    }
    if (!inCriteria) continue;
    const bullet = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.*)$/u);
    if (bullet?.[1].trim()) rows.push(criterion(bullet[1], node.id));
  }
  return rows.filter(
    (row, index) =>
      rows.findIndex((other) => (other.id ?? other.text) === (row.id ?? row.text)) === index,
  );
}

/** Paths are inspectable repository-relative text, never an executable destination. */
export function structuralFilePath(value: string): string | null {
  const path = value.trim().replace(/^`|`$/gu, '');
  if (!validPlanningFilePath(path) || encodeURIComponent(path).length > 1024) return null;
  return path.includes('/') || /\.[\w-]+$/u.test(path) ? path : null;
}

function filesOf(node: PlanningModelNode): StructuralFile[] {
  const rows: StructuralFile[] = [];
  const add = (group: string, text: string) => {
    const clean = text.replace(/^\s*[-*+]\s+/u, '').trim();
    if (!clean) return;
    const tagged = clean.match(/^(Create|Modify|Preserve|Keep)\s*:?\s+(.+)$/iu);
    const label = tagged?.[1] ?? group;
    const normalized = /^keep$/iu.test(label)
      ? 'Preserve'
      : `${label[0]?.toUpperCase() ?? ''}${label.slice(1).toLowerCase()}`;
    const content = tagged?.[2] ?? clean;
    const quoted = content.match(/^`([^`]+)`/u)?.[1];
    rows.push(
      Object.freeze({
        group: normalized || 'Files',
        path: structuralFilePath(quoted ?? content),
        text: content,
      }),
    );
  };
  const values = node.frontmatter.files;
  if (Array.isArray(values)) {
    for (const value of values) {
      if (typeof value === 'string') add('Files', value);
      else if (value && typeof value === 'object') {
        const entry = value as Record<string, unknown>;
        const text = entry.path ?? entry.file ?? entry.text;
        if (typeof text === 'string') add(String(entry.action ?? entry.group ?? 'Files'), text);
      }
    }
  } else if (values && typeof values === 'object') {
    for (const [group, value] of Object.entries(values))
      for (const text of strings(value)) add(group, text);
  }
  let inFiles = false;
  let depth = 0;
  let group = 'Files';
  for (const line of (node.body ?? '').split('\n')) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/u);
    if (heading) {
      if (/^files(?:\s|$)/iu.test(heading[2])) {
        inFiles = true;
        depth = heading[1].length;
      } else if (inFiles && heading[1].length <= depth) inFiles = false;
      else if (inFiles) {
        const category = /^(Create|Modify|Preserve|Keep)(?:\s|$)/iu.exec(heading[2]);
        if (category) group = category[1];
      }
      continue;
    }
    if (!inFiles) continue;
    const groupLine = line.match(/^\s*\*\*(Create|Modify|Preserve|Keep):?\*\*:?\s*$/iu);
    if (groupLine) group = groupLine[1];
    else if (/^\s*[-*+]\s+/u.test(line)) add(group, line);
  }
  return rows.filter(
    (row, index) =>
      rows.findIndex((other) => other.group === row.group && other.text === row.text) === index,
  );
}

function evidenceOf(node: PlanningModelNode): StructuralEvidence[] {
  return ['shipRef', 'qaRef'].flatMap((label) =>
    strings(node.frontmatter[label]).map((value) => {
      let href: string | null = null;
      try {
        const url = new URL(value);
        if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password)
          href = url.href;
      } catch {
        /* Authored local references remain inspectable text. */
      }
      return Object.freeze({ label, value, href });
    }),
  );
}

/** A bounded structural read of authored relationships; no delivery progress is inferred. */
export function buildStructuralDetail(
  index: StructuralIndex,
  node: PlanningModelNode,
): StructuralDetailModel {
  const warnings = new Set<string>();
  const rows = (map: ReadonlyMap<string, readonly StructuralReference[]>) => map.get(node.id) ?? [];
  const scope = planningSpecOf(node);
  const parentRows = rows(index.parents);
  const inScope = (entry: PlanningModelNode, expected: string | null) =>
    entry.id === expected ||
    planningSpecOf(entry) === expected ||
    Boolean(expected && index.parents.get(entry.id)?.some((ref) => ref.node?.id === expected));
  const scopedParents = parentRows.filter((ref) => ref.node && inScope(ref.node, scope));
  const parents = scope && scopedParents.length ? scopedParents : parentRows;
  const trace: StructuralTraceEntry[] = [];
  const traced = new Set<string>();
  const addTrace = (entry: PlanningModelNode, role: string) => {
    if (!traced.has(entry.id)) {
      traced.add(entry.id);
      trace.push(
        Object.freeze({
          node: entry,
          role,
          blockedBy: ['done', 'addressed'].includes(entry.status)
            ? 0
            : (index.dependencies.get(entry.id) ?? []).filter(
                (ref) => ref.node && !['done', 'addressed'].includes(ref.node.status),
              ).length,
        }),
      );
    }
  };
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ascend = (entry: PlanningModelNode) => {
    if (visiting.has(entry.id)) {
      warnings.add('A cycle was found in artifact ancestry.');
      return;
    }
    if (visited.has(entry.id)) return;
    visiting.add(entry.id);
    const entryScope = planningSpecOf(entry);
    const candidates = index.parents.get(entry.id) ?? [];
    const matching = candidates.filter((ref) => ref.node && inScope(ref.node, entryScope));
    for (const ref of index.origins.get(entry.id) ?? []) {
      if (ref.node) addTrace(ref.node, 'Origin');
      else warnings.add(`${ref.reference}: ${ref.reason}`);
    }
    for (const ref of entry.type === 'spec'
      ? []
      : entryScope && matching.length
        ? matching
        : candidates) {
      if (ref.node) ascend(ref.node);
      else warnings.add(`${ref.reference}: ${ref.reason}`);
    }
    visiting.delete(entry.id);
    visited.add(entry.id);
    addTrace(
      entry.id === node.id ? node : entry,
      entry.id === node.id ? 'Current artifact' : entry.type === 'backlog' ? 'Origin' : 'Parent',
    );
  };
  ascend(node);
  const walked = new Set<string>();
  const downstream = (entry: PlanningModelNode, stack: Set<string>) => {
    if (stack.has(entry.id)) {
      warnings.add('A cycle was found in downstream relationships.');
      return;
    }
    if (walked.has(entry.id)) return;
    walked.add(entry.id);
    const nextStack = new Set([...stack, entry.id]);
    for (const [map, role] of [
      [index.children, 'Contains'],
      [index.dependents, 'Unblocks'],
    ] as const) {
      for (const ref of map.get(entry.id) ?? []) {
        if (!ref.node) {
          warnings.add(`${ref.reference}: ${ref.reason}`);
          continue;
        }
        if (nextStack.has(ref.node.id)) {
          warnings.add('A cycle was found in downstream relationships.');
          continue;
        }
        addTrace(ref.node, role);
        downstream(ref.node, nextStack);
      }
    }
  };
  downstream(node, new Set());
  const dependencies = rows(index.dependencies);
  // Dependencies are a separate direction from the trace; inspect cycles without adding them as progress.
  const checkDependencies = (entry: PlanningModelNode, stack: Set<string>, done: Set<string>) => {
    if (stack.has(entry.id)) {
      warnings.add('A cycle was found in dependency relationships.');
      return;
    }
    if (done.has(entry.id)) return;
    const next = new Set([...stack, entry.id]);
    for (const ref of index.dependencies.get(entry.id) ?? [])
      if (ref.node) checkDependencies(ref.node, next, done);
    done.add(entry.id);
  };
  checkDependencies(node, new Set(), new Set());
  for (const ref of [
    ...parents,
    ...rows(index.children),
    ...dependencies,
    ...rows(index.dependents),
  ])
    if (!ref.node) warnings.add(`${ref.reference}: ${ref.reason}`);
  const criteria = ownCriteria(node);
  const spec = scope ? index.resolve(scope, node).node : null;
  const storyCriteria = parents.flatMap((ref) =>
    ref.node?.type === 'story' ? ownCriteria(ref.node) : [],
  );
  const specCriteria = [...storyCriteria, ...(spec ? ownCriteria(spec) : [])];
  for (const ref of strings(node.frontmatter.acceptanceRefs)) {
    const inherited = specCriteria.find((entry) => entry.id === ref);
    if (inherited) criteria.push(inherited);
    else {
      criteria.push(
        Object.freeze({
          id: ref,
          text: 'Referenced criterion is unavailable in the current detail.',
          ...(spec ? { sourceId: spec.id } : {}),
        }),
      );
      warnings.add(`${ref}: acceptance criterion could not be resolved from the specification.`);
    }
  }
  const source = ['file', 'sourcePath', 'artifactPath']
    .flatMap((key) => strings(node.frontmatter[key]))
    .find((value) => structuralFilePath(value));
  return Object.freeze({
    sourcePath: source ? structuralFilePath(source) : null,
    criteria: Object.freeze(
      criteria.filter(
        (row, position) =>
          criteria.findIndex((other) => (other.id ?? other.text) === (row.id ?? row.text)) ===
          position,
      ),
    ),
    files: Object.freeze(filesOf(node)),
    evidence: Object.freeze(evidenceOf(node)),
    parents: Object.freeze(parents),
    children: Object.freeze(rows(index.children)),
    dependencies: Object.freeze(dependencies),
    dependents: Object.freeze(rows(index.dependents)),
    trace: Object.freeze(trace),
    warnings: Object.freeze([...warnings]),
  });
}

// Snapshot and verified node objects are immutable. Weak keys release old revisions,
// and prevent reopening an unchanged selection from parsing its source again.
// Bound projections within a retained graph so browsing many selections cannot
// retain every possible downstream trace.
const graphIndices = new WeakMap<PlanningModelGraph, StructuralIndex>();
const enrichedIndices = new WeakMap<
  PlanningModelGraph,
  WeakMap<PlanningModelNode, StructuralIndex>
>();
const projections = new WeakMap<StructuralIndex, Map<PlanningModelNode, StructuralDetailModel>>();

export function selectStructuralDetail(
  graph: PlanningModelGraph,
  node: PlanningModelNode,
  parent: PlanningModelNode | null = null,
): StructuralDetailModel {
  let index = parent ? enrichedIndices.get(graph)?.get(parent) : graphIndices.get(graph);
  if (!index) {
    index = createStructuralIndex(
      parent
        ? {
            ...graph,
            nodes: graph.nodes.map((entry) => (entry.id === parent.id ? parent : entry)),
          }
        : graph,
    );
    if (parent) {
      let parents = enrichedIndices.get(graph);
      if (!parents) {
        parents = new WeakMap();
        enrichedIndices.set(graph, parents);
      }
      parents.set(parent, index);
    } else graphIndices.set(graph, index);
  }
  let nodes = projections.get(index);
  if (!nodes) {
    nodes = new Map();
    projections.set(index, nodes);
  }
  let detail = nodes.get(node);
  if (!detail) {
    detail = buildStructuralDetail(index, node);
    nodes.set(node, detail);
    if (nodes.size > 100) nodes.delete(nodes.keys().next().value as PlanningModelNode);
  }
  return detail;
}
