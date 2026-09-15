import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { DashboardValidationError } from '../../lib/api/validation.js';
import type {
  DashboardEventHead,
  DashboardQueryIdentity,
} from '../../lib/binding/query-identity.js';
import { planningNodeIdFromRouteSubject } from './planning-model.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const PATCH_ID = /^ppatch_[1-9][0-9]*_[a-f0-9]{16}$/u;
const REASON = /^PLANNING_[A-Z0-9_]{1,119}$/u;
const NODE_TYPES = new Set([
  'epic',
  'feature',
  'story',
  'task',
  'spec',
  'backlog',
  'quick',
  'sprint',
  'adr',
]);
const NODE_STATUSES = new Set(['done', 'in-progress', 'blocked', 'outstanding', 'addressed']);
const EDGE_KINDS = new Set(['contains', 'depends_on']);
const MODES = new Set(['agile', 'spec', 'mixed', 'empty']);
const MAX_WIRE_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 96;
const MAX_VALUES = 250_000;

export type PlanningNodeType =
  | 'epic'
  | 'feature'
  | 'story'
  | 'task'
  | 'spec'
  | 'backlog'
  | 'quick'
  | 'sprint'
  | 'adr';
export type PlanningNodeStatus = 'done' | 'in-progress' | 'blocked' | 'outstanding' | 'addressed';
export type PlanningNode = Readonly<{
  id: string;
  type: PlanningNodeType;
  title: string;
  status: PlanningNodeStatus;
  frontmatter: Readonly<Record<string, unknown>>;
  githubIssue?: string | number;
  linearIssueIdentifier?: string;
  body?: string;
}>;
export type PlanningEdge = Readonly<{
  from: string;
  to: string;
  kind: 'contains' | 'depends_on';
}>;
export type PlanningGraph = Readonly<{
  nodes: readonly PlanningNode[];
  edges: readonly PlanningEdge[];
}>;
export type PlanningMode = 'agile' | 'spec' | 'mixed' | 'empty';
export type PlanningBinding = Readonly<{
  actorId: string;
  projectId: string;
  scopeId: 'planning';
  domainId: 'planning';
  domainVersion: '1.0.0';
  generation: number;
}>;
/** `viewHash` is the only graph-revision commitment; `eventHead` is only the SSE cursor. */
export type PlanningCursor = Readonly<{
  eventHead: DashboardEventHead;
  viewHash: string;
}>;
export type PlanningGraphEnvelope = Readonly<{
  kind: 'planning-graph-snapshot';
  schemaVersion: '1.0.0';
  binding: PlanningBinding;
  cursor: PlanningCursor;
  mode: PlanningMode;
  graph: PlanningGraph;
}>;
export type PlanningDetailEnvelope = Readonly<{
  kind: 'planning-detail';
  schemaVersion: '1.0.0';
  binding: PlanningBinding;
  cursor: PlanningCursor;
  subjectId: string;
  node: PlanningNode & Readonly<{ body?: string }>;
  nodeHash: string;
}>;
export type PlanningPatch = Readonly<{
  updated: readonly PlanningNode[];
  added: readonly PlanningNode[];
  removed: readonly string[];
  edges: Readonly<{
    added: readonly PlanningEdge[];
    removed: readonly PlanningEdge[];
  }>;
}>;
export type PlanningPatchSignal = Readonly<{
  patchId: string;
  patchHash: string;
  from: PlanningCursor;
  to: PlanningCursor;
  patch: PlanningPatch;
}>;
type PlanningSnapshotEvent = Readonly<{
  kind: 'planning-live-event';
  schemaVersion: '1.0.0';
  event: 'snapshot';
  binding: PlanningBinding;
  cursor: PlanningCursor;
  payload: Readonly<{ mode: PlanningMode; graph: PlanningGraph }>;
}>;
type PlanningPatchEvent = Readonly<{
  kind: 'planning-live-event';
  schemaVersion: '1.0.0';
  event: 'patch';
  binding: PlanningBinding;
  cursor: PlanningCursor;
  payload: PlanningPatchSignal;
}>;
type PlanningReadyEvent = Readonly<{
  kind: 'planning-live-event';
  schemaVersion: '1.0.0';
  event: 'ready';
  binding: PlanningBinding;
  cursor: PlanningCursor;
  payload: Readonly<{ readOnly: true; reasonCodes: readonly [] }>;
}>;
type PlanningStaleEvent = Readonly<{
  kind: 'planning-live-event';
  schemaVersion: '1.0.0';
  event: 'stale';
  binding: PlanningBinding;
  cursor: PlanningCursor;
  payload: Readonly<{ readOnly: true; reasonCodes: readonly string[]; recovery: string }>;
}>;
export type PlanningLiveEvent =
  | PlanningSnapshotEvent
  | PlanningPatchEvent
  | PlanningReadyEvent
  | PlanningStaleEvent;

type JsonRecord = Record<string, unknown>;

function invalid(path: string, detail: string): never {
  throw new DashboardValidationError(path, detail);
}

function exactRecord(value: unknown, keys: readonly string[], path: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid(path, 'expected an object');
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalid(path, 'expected a plain object');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).some(
        (key) =>
          typeof key !== 'string' ||
          descriptors[key]?.get !== undefined ||
          descriptors[key]?.set !== undefined,
      )
    ) {
      return invalid(path, 'contains an accessor or symbol field');
    }
    const actual = Object.keys(descriptors).sort();
    const expected = [...keys].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      return invalid(path, 'contains missing or unknown fields');
    }
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
    );
  } catch (error) {
    if (error instanceof DashboardValidationError) throw error;
    return invalid(path, 'could not be inspected safely');
  }
}

function oneOfRecord(
  value: unknown,
  variants: readonly (readonly string[])[],
  path: string,
): JsonRecord {
  for (const keys of variants) {
    try {
      return exactRecord(value, keys, path);
    } catch (error) {
      if (!(error instanceof DashboardValidationError)) throw error;
    }
  }
  return invalid(path, 'contains missing or unknown fields');
}

function plainJson(value: unknown, path: string): unknown {
  const seen = new WeakSet<object>();
  let count = 0;
  const visit = (entry: unknown, currentPath: string, depth: number): unknown => {
    count += 1;
    if (depth > MAX_DEPTH || count > MAX_VALUES) {
      return invalid(currentPath, 'contains an over-complex value');
    }
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return entry;
    if (typeof entry === 'number') {
      return Number.isFinite(entry) ? entry : invalid(currentPath, 'contains a non-finite number');
    }
    if (typeof entry !== 'object') return invalid(currentPath, 'contains a non-JSON value');
    if (seen.has(entry)) return invalid(currentPath, 'contains a repeated or cyclic object');
    seen.add(entry);
    try {
      const prototype = Object.getPrototypeOf(entry);
      const expectedPrototype = Array.isArray(entry) ? Array.prototype : Object.prototype;
      if (prototype !== expectedPrototype && prototype !== null) {
        return invalid(currentPath, 'contains a non-plain object');
      }
      const descriptors = Object.getOwnPropertyDescriptors(entry);
      if (
        Reflect.ownKeys(descriptors).some(
          (key) =>
            typeof key !== 'string' ||
            descriptors[key]?.get !== undefined ||
            descriptors[key]?.set !== undefined,
        )
      ) {
        return invalid(currentPath, 'contains an accessor or symbol field');
      }
      if (Array.isArray(entry)) {
        const descriptorKeys = Object.keys(descriptors);
        if (descriptorKeys.some((key) => key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key))) {
          return invalid(currentPath, 'contains an invalid array field');
        }
        const output: unknown[] = [];
        for (let index = 0; index < entry.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor) return invalid(currentPath, 'contains a sparse array');
          output.push(visit(descriptor.value, `${currentPath}[${index}]`, depth + 1));
        }
        return output;
      }
      return Object.fromEntries(
        Object.entries(descriptors).map(([key, descriptor]) => [
          key,
          visit(descriptor.value, `${currentPath}.${key}`, depth + 1),
        ]),
      );
    } catch (error) {
      if (error instanceof DashboardValidationError) throw error;
      return invalid(currentPath, 'could not be inspected safely');
    } finally {
      seen.delete(entry);
    }
  };
  return visit(value, path, 0);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function exactString(value: unknown, path: string, pattern: RegExp): string {
  return typeof value === 'string' && pattern.test(value)
    ? value
    : invalid(path, 'contains an invalid string');
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

function subject(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 256 ||
    value === '.' ||
    value === '..' ||
    value.includes('\\') ||
    hasUnpairedSurrogate(value) ||
    [...value].some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 31 || point === 127;
    })
  ) {
    return invalid(path, 'contains an invalid subject identity');
  }
  return value;
}

function eventHead(value: unknown, path: string): DashboardEventHead {
  const record = exactRecord(value, ['sequence', 'hash'], path);
  if (!Number.isSafeInteger(record.sequence) || (record.sequence as number) < 0) {
    return invalid(`${path}.sequence`, 'expected a non-negative safe integer');
  }
  const sequence = record.sequence as number;
  const hash = record.hash === null ? null : exactString(record.hash, `${path}.hash`, HASH);
  if ((sequence === 0) !== (hash === null)) return invalid(path, 'has an inconsistent head');
  return Object.freeze({ sequence, hash });
}

function cursor(value: unknown, path: string): PlanningCursor {
  const record = exactRecord(value, ['eventHead', 'viewHash'], path);
  return Object.freeze({
    eventHead: eventHead(record.eventHead, `${path}.eventHead`),
    viewHash: exactString(record.viewHash, `${path}.viewHash`, HASH),
  });
}

function binding(value: unknown, path = '$.binding'): PlanningBinding {
  const record = exactRecord(
    value,
    ['actorId', 'projectId', 'scopeId', 'domainId', 'domainVersion', 'generation'],
    path,
  );
  if (!Number.isSafeInteger(record.generation) || (record.generation as number) < 0) {
    return invalid(`${path}.generation`, 'expected a non-negative safe integer');
  }
  if (
    record.scopeId !== 'planning' ||
    record.domainId !== 'planning' ||
    record.domainVersion !== '1.0.0'
  ) {
    return invalid(path, 'does not belong to the Planning read domain');
  }
  return Object.freeze({
    actorId: exactString(record.actorId, `${path}.actorId`, ID),
    projectId: exactString(record.projectId, `${path}.projectId`, HASH),
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    generation: record.generation as number,
  });
}

function sameHead(left: DashboardEventHead, right: DashboardEventHead): boolean {
  return left.sequence === right.sequence && left.hash === right.hash;
}

function sameCursor(left: PlanningCursor, right: PlanningCursor): boolean {
  return sameHead(left.eventHead, right.eventHead) && left.viewHash === right.viewHash;
}

function sameBinding(left: PlanningBinding, identity: DashboardQueryIdentity): boolean {
  return (
    identity.productArea === 'planning' &&
    left.actorId === identity.actorId &&
    left.projectId === identity.projectId &&
    left.scopeId === identity.scopeId &&
    left.domainId === identity.domainId &&
    left.domainVersion === identity.domainVersion &&
    left.generation === identity.generation
  );
}

function requireBinding(value: unknown, identity: DashboardQueryIdentity): PlanningBinding {
  const accepted = binding(value);
  if (!sameBinding(accepted, identity))
    return invalid('$.binding', 'is foreign to the active read');
  return accepted;
}

function node(value: unknown, path: string, allowBody: boolean): PlanningNode {
  const required = ['id', 'type', 'title', 'status', 'frontmatter'] as const;
  const optional = ['githubIssue', 'linearIssueIdentifier', ...(allowBody ? ['body'] : [])];
  const record = oneOfRecord(
    value,
    Array.from({ length: 1 << optional.length }, (_, mask) => [
      ...required,
      ...optional.filter((_, index) => (mask & (1 << index)) !== 0),
    ]),
    path,
  );
  const type = record.type;
  const status = record.status;
  if (typeof type !== 'string' || !NODE_TYPES.has(type)) {
    return invalid(`${path}.type`, 'contains an unsupported artifact type');
  }
  if (typeof status !== 'string' || !NODE_STATUSES.has(status)) {
    return invalid(`${path}.status`, 'contains an unsupported status');
  }
  if (typeof record.title !== 'string') return invalid(`${path}.title`, 'expected a string');
  const safeFrontmatter = plainJson(record.frontmatter, `${path}.frontmatter`);
  if (
    safeFrontmatter === null ||
    typeof safeFrontmatter !== 'object' ||
    Array.isArray(safeFrontmatter)
  ) {
    return invalid(`${path}.frontmatter`, 'expected a plain object');
  }
  const output: Record<string, unknown> = {
    id: subject(record.id, `${path}.id`),
    type,
    title: record.title,
    status,
    frontmatter: safeFrontmatter,
  };
  if (Object.hasOwn(record, 'githubIssue')) {
    if (
      !(
        typeof record.githubIssue === 'string' ||
        (Number.isSafeInteger(record.githubIssue) && (record.githubIssue as number) >= 0)
      )
    ) {
      return invalid(`${path}.githubIssue`, 'expected a string or non-negative integer');
    }
    output.githubIssue = record.githubIssue;
  }
  if (Object.hasOwn(record, 'linearIssueIdentifier')) {
    if (typeof record.linearIssueIdentifier !== 'string') {
      return invalid(`${path}.linearIssueIdentifier`, 'expected a string');
    }
    output.linearIssueIdentifier = record.linearIssueIdentifier;
  }
  if (Object.hasOwn(record, 'body')) {
    if (!allowBody || typeof record.body !== 'string') {
      return invalid(`${path}.body`, 'is not permitted on a graph node');
    }
    output.body = record.body;
  }
  return deepFreeze(output) as PlanningNode;
}

function edge(value: unknown, path: string): PlanningEdge {
  const record = exactRecord(value, ['from', 'to', 'kind'], path);
  if (typeof record.kind !== 'string' || !EDGE_KINDS.has(record.kind)) {
    return invalid(`${path}.kind`, 'contains an unsupported edge kind');
  }
  return Object.freeze({
    from: subject(record.from, `${path}.from`),
    to: subject(record.to, `${path}.to`),
    kind: record.kind as PlanningEdge['kind'],
  });
}

function graph(value: unknown, path: string): PlanningGraph {
  const record = exactRecord(value, ['nodes', 'edges'], path);
  if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) {
    return invalid(path, 'expected node and edge arrays');
  }
  const nodes = record.nodes.map((entry, index) => node(entry, `${path}.nodes[${index}]`, false));
  const ids = new Set<string>();
  for (const entry of nodes) {
    if (ids.has(entry.id)) return invalid(`${path}.nodes`, 'contains duplicate node identities');
    ids.add(entry.id);
  }
  const edges = record.edges.map((entry, index) => edge(entry, `${path}.edges[${index}]`));
  const edgeIds = new Set<string>();
  for (const entry of edges) {
    const key = `${entry.kind}\0${entry.from}\0${entry.to}`;
    if (!ids.has(entry.from) || !ids.has(entry.to)) {
      return invalid(`${path}.edges`, 'contains an edge outside this graph');
    }
    if (edgeIds.has(key)) return invalid(`${path}.edges`, 'contains duplicate edges');
    edgeIds.add(key);
  }
  return Object.freeze({ nodes: Object.freeze(nodes), edges: Object.freeze(edges) });
}

function modeForGraph(value: PlanningGraph): PlanningMode {
  let agile = false;
  let spec = false;
  for (const entry of value.nodes) {
    if (entry.type === 'epic' || entry.type === 'feature') agile = true;
    if (entry.type === 'spec') spec = true;
  }
  return agile && spec ? 'mixed' : agile ? 'agile' : spec ? 'spec' : 'empty';
}

function planningMode(value: unknown, path: string): PlanningMode {
  return typeof value === 'string' && MODES.has(value)
    ? (value as PlanningMode)
    : invalid(path, 'contains an unsupported Planning mode');
}

function patch(value: unknown, path: string): PlanningPatch {
  const record = exactRecord(value, ['updated', 'added', 'removed', 'edges'], path);
  const edgeRecord = exactRecord(record.edges, ['added', 'removed'], `${path}.edges`);
  if (
    !Array.isArray(record.updated) ||
    !Array.isArray(record.added) ||
    !Array.isArray(record.removed) ||
    !Array.isArray(edgeRecord.added) ||
    !Array.isArray(edgeRecord.removed)
  ) {
    return invalid(path, 'contains invalid patch arrays');
  }
  const updated = record.updated.map((entry, index) =>
    node(entry, `${path}.updated[${index}]`, false),
  );
  const added = record.added.map((entry, index) => node(entry, `${path}.added[${index}]`, false));
  const removed = record.removed.map((entry, index) => subject(entry, `${path}.removed[${index}]`));
  const addedEdges = edgeRecord.added.map((entry, index) =>
    edge(entry, `${path}.edges.added[${index}]`),
  );
  const removedEdges = edgeRecord.removed.map((entry, index) =>
    edge(entry, `${path}.edges.removed[${index}]`),
  );
  const nodeIds = [...updated, ...added].map((entry) => entry.id);
  if (
    new Set(nodeIds).size !== nodeIds.length ||
    new Set(removed).size !== removed.length ||
    nodeIds.some((id) => removed.includes(id))
  ) {
    return invalid(path, 'contains conflicting node operations');
  }
  const edgeKey = (entry: PlanningEdge) => `${entry.kind}\0${entry.from}\0${entry.to}`;
  const addIds = addedEdges.map(edgeKey);
  const removeIds = removedEdges.map(edgeKey);
  if (
    new Set(addIds).size !== addIds.length ||
    new Set(removeIds).size !== removeIds.length ||
    addIds.some((id) => removeIds.includes(id))
  ) {
    return invalid(`${path}.edges`, 'contains conflicting edge operations');
  }
  return Object.freeze({
    updated: Object.freeze(updated),
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    edges: Object.freeze({
      added: Object.freeze(addedEdges),
      removed: Object.freeze(removedEdges),
    }),
  });
}

function parseWireJson(text: string): unknown {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_WIRE_BYTES) {
    return invalid('$', 'response exceeds the Planning wire limit');
  }
  try {
    let index = 0;
    let values = 0;
    const whitespace = () => {
      while (/\s/u.test(text[index] ?? '')) index += 1;
    };
    const stringToken = (): string => {
      if (text[index] !== '"') return invalid('$', 'contains an invalid JSON string');
      const start = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === '\\') index += 2;
        else if (text[index] === '"') {
          index += 1;
          return JSON.parse(text.slice(start, index)) as string;
        } else index += 1;
      }
      return invalid('$', 'contains an unterminated JSON string');
    };
    const visit = (depth: number): void => {
      values += 1;
      if (depth > MAX_DEPTH || values > MAX_VALUES) {
        invalid('$', 'response exceeds the Planning complexity limit');
      }
      whitespace();
      if (text[index] === '{') {
        index += 1;
        whitespace();
        const keys = new Set<string>();
        if (text[index] === '}') {
          index += 1;
          return;
        }
        while (index < text.length) {
          whitespace();
          const key = stringToken();
          if (keys.has(key)) invalid('$', 'response contains duplicate object members');
          keys.add(key);
          whitespace();
          if (text[index] !== ':') invalid('$', 'contains an invalid JSON object');
          index += 1;
          visit(depth + 1);
          whitespace();
          if (text[index] === '}') {
            index += 1;
            return;
          }
          if (text[index] !== ',') invalid('$', 'contains an invalid JSON object');
          index += 1;
        }
      } else if (text[index] === '[') {
        index += 1;
        whitespace();
        if (text[index] === ']') {
          index += 1;
          return;
        }
        while (index < text.length) {
          visit(depth + 1);
          whitespace();
          if (text[index] === ']') {
            index += 1;
            return;
          }
          if (text[index] !== ',') invalid('$', 'contains an invalid JSON array');
          index += 1;
        }
      } else if (text[index] === '"') {
        stringToken();
        return;
      } else {
        const token = text
          .slice(index)
          .match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u)?.[0];
        if (!token) invalid('$', 'contains an invalid JSON value');
        index += token.length;
        return;
      }
      invalid('$', 'contains an unterminated JSON value');
    };
    visit(0);
    whitespace();
    if (index !== text.length) return invalid('$', 'contains trailing JSON bytes');
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof DashboardValidationError) throw error;
    return invalid('$', 'contains invalid JSON');
  }
}

export function parsePlanningGraphEnvelope(
  value: unknown,
  identity: DashboardQueryIdentity,
): PlanningGraphEnvelope {
  const record = exactRecord(
    value,
    ['kind', 'schemaVersion', 'binding', 'cursor', 'mode', 'graph'],
    '$',
  );
  if (record.kind !== 'planning-graph-snapshot' || record.schemaVersion !== '1.0.0') {
    return invalid('$', 'has an unsupported Planning graph contract');
  }
  const acceptedBinding = requireBinding(record.binding, identity);
  const acceptedCursor = cursor(record.cursor, '$.cursor');
  const acceptedGraph = graph(record.graph, '$.graph');
  const acceptedMode = planningMode(record.mode, '$.mode');
  if (
    sha256Jcs(acceptedGraph as never) !== acceptedCursor.viewHash ||
    modeForGraph(acceptedGraph) !== acceptedMode
  ) {
    return invalid('$', 'graph, mode, and cursor commitment disagree');
  }
  return Object.freeze({
    kind: 'planning-graph-snapshot',
    schemaVersion: '1.0.0',
    binding: acceptedBinding,
    cursor: acceptedCursor,
    mode: acceptedMode,
    graph: acceptedGraph,
  });
}

export function parsePlanningGraphJson(
  text: string,
  identity: DashboardQueryIdentity,
): PlanningGraphEnvelope {
  return parsePlanningGraphEnvelope(parseWireJson(text), identity);
}

function equalNodeSummary(detail: PlanningNode, summary: PlanningNode): boolean {
  const { body: _body, ...withoutBody } = detail;
  return sha256Jcs(withoutBody as never) === sha256Jcs(summary as never);
}

export function parsePlanningDetailEnvelope(
  value: unknown,
  identity: DashboardQueryIdentity,
  snapshot: PlanningGraphEnvelope,
): PlanningDetailEnvelope {
  const record = exactRecord(
    value,
    ['kind', 'schemaVersion', 'binding', 'cursor', 'subjectId', 'node', 'nodeHash'],
    '$',
  );
  if (record.kind !== 'planning-detail' || record.schemaVersion !== '1.0.0') {
    return invalid('$', 'has an unsupported Planning detail contract');
  }
  const acceptedBinding = requireBinding(record.binding, identity);
  const acceptedCursor = cursor(record.cursor, '$.cursor');
  const subjectId = subject(record.subjectId, '$.subjectId');
  const expectedNodeId =
    identity.subjectId === null ? null : planningNodeIdFromRouteSubject(identity.subjectId);
  const acceptedNode = node(record.node, '$.node', true);
  const nodeHash = exactString(record.nodeHash, '$.nodeHash', HASH);
  const summary = snapshot.graph.nodes.find((entry) => entry.id === subjectId);
  if (
    expectedNodeId !== subjectId ||
    acceptedNode.id !== subjectId ||
    !sameBinding(snapshot.binding, identity) ||
    !sameCursor(snapshot.cursor, acceptedCursor) ||
    !summary ||
    !equalNodeSummary(acceptedNode, summary) ||
    sha256Jcs(acceptedNode as never) !== nodeHash
  ) {
    return invalid('$', 'detail identity, graph revision, and body commitment disagree');
  }
  return Object.freeze({
    kind: 'planning-detail',
    schemaVersion: '1.0.0',
    binding: acceptedBinding,
    cursor: acceptedCursor,
    subjectId,
    node: acceptedNode,
    nodeHash,
  });
}

export function parsePlanningDetailJson(
  text: string,
  identity: DashboardQueryIdentity,
  snapshot: PlanningGraphEnvelope,
): PlanningDetailEnvelope {
  return parsePlanningDetailEnvelope(parseWireJson(text), identity, snapshot);
}

function patchSignal(value: unknown, expectedCursor: PlanningCursor): PlanningPatchSignal {
  const record = exactRecord(value, ['patchId', 'patchHash', 'from', 'to', 'patch'], '$.payload');
  const from = cursor(record.from, '$.payload.from');
  const to = cursor(record.to, '$.payload.to');
  const acceptedPatch = patch(record.patch, '$.payload.patch');
  const patchHash = exactString(record.patchHash, '$.payload.patchHash', HASH);
  const patchId = exactString(record.patchId, '$.payload.patchId', PATCH_ID);
  const patchDigest = sha256Jcs(acceptedPatch as never);
  const expectedHeadHash = sha256Jcs({
    kind: 'planning-live-head',
    previous: from.eventHead,
    sequence: to.eventHead.sequence,
    patchHash: patchDigest,
    viewHash: to.viewHash,
  } as never);
  if (
    !sameCursor(to, expectedCursor) ||
    to.eventHead.sequence !== from.eventHead.sequence + 1 ||
    to.viewHash === from.viewHash ||
    to.eventHead.hash !== expectedHeadHash ||
    sha256Jcs({ from, to, patch: acceptedPatch } as never) !== patchHash ||
    patchId !== `ppatch_${to.eventHead.sequence}_${patchHash.slice(7, 23)}`
  ) {
    return invalid('$.payload', 'patch cursor and commitment disagree');
  }
  return Object.freeze({ patchId, patchHash, from, to, patch: acceptedPatch });
}

export function parsePlanningLiveEvent(
  value: string | unknown,
  identity: DashboardQueryIdentity,
): PlanningLiveEvent {
  const source = typeof value === 'string' ? parseWireJson(value) : value;
  const record = exactRecord(
    source,
    ['kind', 'schemaVersion', 'event', 'binding', 'cursor', 'payload'],
    '$',
  );
  if (record.kind !== 'planning-live-event' || record.schemaVersion !== '1.0.0') {
    return invalid('$', 'has an unsupported Planning live contract');
  }
  const acceptedBinding = requireBinding(record.binding, identity);
  const acceptedCursor = cursor(record.cursor, '$.cursor');
  const base = {
    kind: 'planning-live-event' as const,
    schemaVersion: '1.0.0' as const,
    binding: acceptedBinding,
    cursor: acceptedCursor,
  };
  if (record.event === 'snapshot') {
    const payload = exactRecord(record.payload, ['mode', 'graph'], '$.payload');
    const acceptedGraph = graph(payload.graph, '$.payload.graph');
    const acceptedMode = planningMode(payload.mode, '$.payload.mode');
    if (
      sha256Jcs(acceptedGraph as never) !== acceptedCursor.viewHash ||
      modeForGraph(acceptedGraph) !== acceptedMode
    ) {
      return invalid('$.payload', 'snapshot graph and cursor commitment disagree');
    }
    return Object.freeze({
      ...base,
      event: 'snapshot',
      payload: Object.freeze({ mode: acceptedMode, graph: acceptedGraph }),
    });
  }
  if (record.event === 'patch') {
    return Object.freeze({
      ...base,
      event: 'patch',
      payload: patchSignal(record.payload, acceptedCursor),
    });
  }
  if (record.event === 'ready') {
    const payload = exactRecord(record.payload, ['readOnly', 'reasonCodes'], '$.payload');
    if (
      payload.readOnly !== true ||
      !Array.isArray(payload.reasonCodes) ||
      payload.reasonCodes.length
    ) {
      return invalid('$.payload', 'contains an invalid ready state');
    }
    return Object.freeze({
      ...base,
      event: 'ready',
      payload: Object.freeze({
        readOnly: true as const,
        reasonCodes: Object.freeze([]) as readonly [],
      }),
    });
  }
  if (record.event === 'stale') {
    const payload = exactRecord(
      record.payload,
      ['readOnly', 'reasonCodes', 'recovery'],
      '$.payload',
    );
    if (
      payload.readOnly !== true ||
      !Array.isArray(payload.reasonCodes) ||
      payload.reasonCodes.length < 1 ||
      payload.reasonCodes.length > 8 ||
      payload.reasonCodes.some((entry) => typeof entry !== 'string' || !REASON.test(entry)) ||
      typeof payload.recovery !== 'string' ||
      payload.recovery.length < 1 ||
      payload.recovery.length > 240
    ) {
      return invalid('$.payload', 'contains an invalid stale state');
    }
    return Object.freeze({
      ...base,
      event: 'stale',
      payload: Object.freeze({
        readOnly: true as const,
        reasonCodes: Object.freeze([...payload.reasonCodes] as string[]),
        recovery: payload.recovery,
      }),
    });
  }
  return invalid('$.event', 'contains an unsupported Planning event');
}

function applyPatch(current: PlanningGraph, signal: PlanningPatchSignal): PlanningGraph {
  const removed = new Set(signal.patch.removed);
  const updates = new Map(signal.patch.updated.map((entry) => [entry.id, entry]));
  const nodes = current.nodes
    .filter((entry) => !removed.has(entry.id))
    .map((entry) => updates.get(entry.id) ?? entry);
  const ids = new Set(nodes.map((entry) => entry.id));
  for (const entry of signal.patch.updated) {
    if (!ids.has(entry.id)) return invalid('$.payload.patch.updated', 'targets a missing node');
  }
  for (const entry of signal.patch.added) {
    if (ids.has(entry.id)) return invalid('$.payload.patch.added', 'duplicates an existing node');
    ids.add(entry.id);
    nodes.push(entry);
  }
  const key = (entry: PlanningEdge) => `${entry.kind}\0${entry.from}\0${entry.to}`;
  const removedEdges = new Set(signal.patch.edges.removed.map(key));
  const edges = current.edges.filter((entry) => !removedEdges.has(key(entry)));
  const existingEdges = new Set(edges.map(key));
  for (const entry of signal.patch.edges.removed) {
    if (!current.edges.some((candidate) => key(candidate) === key(entry))) {
      return invalid('$.payload.patch.edges.removed', 'targets a missing edge');
    }
  }
  for (const entry of signal.patch.edges.added) {
    if (existingEdges.has(key(entry))) {
      return invalid('$.payload.patch.edges.added', 'duplicates an existing edge');
    }
    existingEdges.add(key(entry));
    edges.push(entry);
  }
  return graph({ nodes, edges }, '$.nextGraph');
}

export type PlanningSseRefetchReason =
  | 'invalid-event'
  | 'gap'
  | 'reordered'
  | 'divergent-duplicate'
  | 'cursor-mismatch'
  | 'restart-regression'
  | 'state-mismatch'
  | 'stale';

export function createPlanningSseReconciler(
  options: Readonly<{
    identity: DashboardQueryIdentity;
    initial?: PlanningGraphEnvelope;
    isCurrent: (identity: DashboardQueryIdentity) => boolean;
    onSnapshot: (snapshot: PlanningGraphEnvelope) => void;
    onPatch: (snapshot: PlanningGraphEnvelope, signal: PlanningPatchSignal) => void;
    onReady?: (event: PlanningReadyEvent) => void;
    onStale?: (event: PlanningStaleEvent) => void;
    onRefetch: (reason: PlanningSseRefetchReason) => void;
  }>,
) {
  const identity = options.identity;
  let current = options.initial ? parsePlanningGraphEnvelope(options.initial, identity) : null;
  let disposed = false;
  let refetchPending = false;
  let pendingRefetchReason: PlanningSseRefetchReason | null = null;
  let snapshotSignature: string | null = current ? JSON.stringify(current) : null;
  const acceptedPatchSignatures = new Map<string, string>();

  if (current && !sameBinding(current.binding, identity)) {
    invalid('$.initial.binding', 'is foreign to this reconciler');
  }

  const isInactive = () => disposed || !options.isCurrent(identity);
  const requestRefetch = (reason: PlanningSseRefetchReason) => {
    if (isInactive()) {
      return Object.freeze({ kind: 'rejected' as const, reason: 'inactive' as const });
    }
    if (!refetchPending) {
      refetchPending = true;
      pendingRefetchReason = reason;
      options.onRefetch(reason);
    }
    return Object.freeze({
      kind: 'refetch' as const,
      reason: pendingRefetchReason ?? reason,
    });
  };
  const ingest = (event: PlanningLiveEvent) => {
    if (isInactive()) {
      return Object.freeze({ kind: 'rejected' as const, reason: 'inactive' as const });
    }
    if (refetchPending) {
      return Object.freeze({
        kind: 'refetch' as const,
        reason: pendingRefetchReason ?? ('invalid-event' as const),
      });
    }
    if (!sameBinding(event.binding, identity)) {
      return Object.freeze({ kind: 'rejected' as const, reason: 'foreign-binding' as const });
    }
    if (event.event === 'snapshot') {
      const candidate: PlanningGraphEnvelope = Object.freeze({
        kind: 'planning-graph-snapshot',
        schemaVersion: '1.0.0',
        binding: event.binding,
        cursor: event.cursor,
        mode: event.payload.mode,
        graph: event.payload.graph,
      });
      if (current) {
        if (candidate.cursor.eventHead.sequence < current.cursor.eventHead.sequence) {
          return requestRefetch('restart-regression');
        }
        if (candidate.cursor.eventHead.sequence > current.cursor.eventHead.sequence) {
          return requestRefetch('gap');
        }
        if (!sameCursor(candidate.cursor, current.cursor)) {
          return requestRefetch('divergent-duplicate');
        }
        const signature = JSON.stringify(candidate);
        if (snapshotSignature === signature) return Object.freeze({ kind: 'duplicate' as const });
        return requestRefetch('divergent-duplicate');
      }
      current = candidate;
      snapshotSignature = JSON.stringify(candidate);
      acceptedPatchSignatures.clear();
      refetchPending = false;
      pendingRefetchReason = null;
      options.onSnapshot(candidate);
      return Object.freeze({ kind: 'accepted' as const, event: 'snapshot' as const });
    }
    if (!current) return requestRefetch('cursor-mismatch');
    if (event.event === 'ready') {
      if (!sameCursor(event.cursor, current.cursor)) return requestRefetch('cursor-mismatch');
      options.onReady?.(event);
      return Object.freeze({ kind: 'accepted' as const, event: 'ready' as const });
    }
    if (event.event === 'stale') {
      options.onStale?.(event);
      return requestRefetch('stale');
    }
    const signal = event.payload;
    const key = `${signal.to.eventHead.sequence}:${signal.to.eventHead.hash}:${signal.to.viewHash}`;
    const signature = JSON.stringify(signal);
    if (sameCursor(signal.to, current.cursor)) {
      return acceptedPatchSignatures.get(key) === signature
        ? Object.freeze({ kind: 'duplicate' as const })
        : requestRefetch('divergent-duplicate');
    }
    if (signal.to.eventHead.sequence <= current.cursor.eventHead.sequence) {
      return requestRefetch('reordered');
    }
    if (signal.to.eventHead.sequence !== current.cursor.eventHead.sequence + 1) {
      return requestRefetch('gap');
    }
    if (!sameCursor(signal.from, current.cursor)) return requestRefetch('reordered');
    try {
      const nextGraph = applyPatch(current.graph, signal);
      if (sha256Jcs(nextGraph as never) !== signal.to.viewHash) {
        return requestRefetch('state-mismatch');
      }
      const next: PlanningGraphEnvelope = Object.freeze({
        ...current,
        cursor: signal.to,
        mode: modeForGraph(nextGraph),
        graph: nextGraph,
      });
      acceptedPatchSignatures.set(key, signature);
      current = next;
      snapshotSignature = null;
      options.onPatch(next, signal);
      return Object.freeze({ kind: 'accepted' as const, event: 'patch' as const });
    } catch {
      return requestRefetch('state-mismatch');
    }
  };

  return Object.freeze({
    ingest,
    ingestJson: (data: string) => {
      if (isInactive()) {
        return Object.freeze({ kind: 'rejected' as const, reason: 'inactive' as const });
      }
      try {
        return ingest(parsePlanningLiveEvent(data, identity));
      } catch {
        return requestRefetch('invalid-event');
      }
    },
    ingestSseFrame: (data: string, eventName?: string) => {
      if (isInactive()) {
        return Object.freeze({ kind: 'rejected' as const, reason: 'inactive' as const });
      }
      try {
        const event = parsePlanningLiveEvent(data, identity);
        if (eventName && eventName !== event.event) return requestRefetch('invalid-event');
        return ingest(event);
      } catch {
        return requestRefetch('invalid-event');
      }
    },
    getSnapshot: () => current,
    markReconciled: (next: PlanningGraphEnvelope) => {
      const accepted = parsePlanningGraphEnvelope(next, identity);
      current = accepted;
      snapshotSignature = JSON.stringify(accepted);
      acceptedPatchSignatures.clear();
      refetchPending = false;
      pendingRefetchReason = null;
      return true;
    },
    dispose: () => {
      disposed = true;
    },
  });
}

function planningUrl(origin: string, path: string, identity: DashboardQueryIdentity): URL {
  const base = new URL(origin);
  if (
    base.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(base.hostname) ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  ) {
    return invalid('$.origin', 'expected an exact loopback HTTP origin');
  }
  if (
    identity.productArea !== 'planning' ||
    identity.scopeId !== 'planning' ||
    identity.domainId !== 'planning' ||
    identity.domainVersion !== '1.0.0'
  ) {
    return invalid('$.identity', 'does not belong to the Planning read domain');
  }
  const url = new URL(path, base);
  url.searchParams.set('projectId', identity.projectId);
  url.searchParams.set('scopeId', identity.scopeId);
  url.searchParams.set('domainId', identity.domainId);
  url.searchParams.set('domainVersion', identity.domainVersion);
  url.searchParams.set('generation', String(identity.generation));
  return url;
}

async function readResponse(response: Response, contentType: string): Promise<string> {
  if (!response.ok || !response.headers.get('content-type')?.startsWith(contentType)) {
    return invalid('$', 'Planning response is unavailable');
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_WIRE_BYTES) {
    return invalid('$', 'Planning response exceeds its wire limit');
  }
  return text;
}

export async function fetchPlanningGraph(
  options: Readonly<{
    origin: string;
    identity: DashboardQueryIdentity;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  }>,
): Promise<PlanningGraphEnvelope> {
  const url = planningUrl(options.origin, '/api/planning/graph', options.identity);
  const response = await (options.fetcher ?? fetch)(url, {
    headers: { accept: 'application/json', 'x-openplanr-actor': options.identity.actorId },
    cache: 'no-store',
    signal: options.signal,
  });
  return parsePlanningGraphJson(await readResponse(response, 'application/json'), options.identity);
}

export async function fetchPlanningDetail(
  options: Readonly<{
    origin: string;
    identity: DashboardQueryIdentity;
    snapshot: PlanningGraphEnvelope;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  }>,
): Promise<PlanningDetailEnvelope> {
  if (!options.identity.subjectId) return invalid('$.identity.subjectId', 'is required');
  const nodeId = planningNodeIdFromRouteSubject(options.identity.subjectId);
  if (!nodeId) return invalid('$.identity.subjectId', 'is not a canonical Planning subject');
  const url = planningUrl(
    options.origin,
    `/api/planning/detail/${encodeURIComponent(nodeId)}`,
    options.identity,
  );
  const response = await (options.fetcher ?? fetch)(url, {
    headers: { accept: 'application/json', 'x-openplanr-actor': options.identity.actorId },
    cache: 'no-store',
    signal: options.signal,
  });
  return parsePlanningDetailJson(
    await readResponse(response, 'application/json'),
    options.identity,
    options.snapshot,
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function encodePlanningCheckpoint(value: PlanningCursor): string {
  const accepted = cursor(value, '$.cursor');
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(accepted)));
}

type PlanningSseReconciler = ReturnType<typeof createPlanningSseReconciler>;

export function connectPlanningSse(
  options: Readonly<{
    origin: string;
    identity: DashboardQueryIdentity;
    reconciler: PlanningSseReconciler;
    lastEventId?: string;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  }>,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  else options.signal?.addEventListener('abort', abort, { once: true });
  const url = planningUrl(options.origin, '/api/planning/events', options.identity);
  const headers: Record<string, string> = {
    accept: 'text/event-stream',
    'x-openplanr-actor': options.identity.actorId,
  };
  if (options.lastEventId) headers['last-event-id'] = options.lastEventId;
  const completion = (async () => {
    const response = await (options.fetcher ?? fetch)(url, { headers, signal: controller.signal });
    if (
      !response.ok ||
      !response.headers.get('content-type')?.startsWith('text/event-stream') ||
      !response.body
    ) {
      return invalid('$', 'Planning live response is unavailable');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!controller.signal.aborted) {
        const result = await reader.read();
        buffer += decoder.decode(result.value, { stream: !result.done });
        buffer = buffer.replaceAll('\r\n', '\n').replace(/\r(?!$)/gu, '\n');
        if (result.done && buffer.endsWith('\r')) buffer = `${buffer.slice(0, -1)}\n`;
        if (new TextEncoder().encode(buffer).byteLength > MAX_WIRE_BYTES) {
          return invalid('$', 'Planning live frame exceeds its wire limit');
        }
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const lines = frame.split('\n');
          const eventName = lines
            .find((line) => line.startsWith('event:'))
            ?.slice(6)
            .trim();
          const data = lines
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (data) {
            options.reconciler.ingestSseFrame(data, eventName);
          }
          boundary = buffer.indexOf('\n\n');
        }
        if (result.done) {
          if (buffer.trim()) return invalid('$', 'Planning live response ended mid-frame');
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  })()
    .catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof DashboardValidationError) throw error;
      throw new DashboardValidationError('$', 'Planning live response failed safely');
    })
    .finally(() => options.signal?.removeEventListener('abort', abort));
  return Object.freeze({
    completion,
    close: () => {
      controller.abort();
      options.reconciler.dispose();
      options.signal?.removeEventListener('abort', abort);
    },
  });
}
