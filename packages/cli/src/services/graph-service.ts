import { type Dirent, existsSync, readdirSync, readFileSync, type Stats, statSync } from 'node:fs';
import path from 'node:path';
import type { ArtifactFrontmatter, OpenPlanrConfig } from '../models/types.js';
import { parseMarkdown } from '../utils/markdown.js';
import {
  createPlanningReadModel,
  createReferenceResolver,
  type PlanningDiagnostic,
  type PlanningReadModel,
} from './graph-read-model.js';

export type GraphNodeType =
  | 'epic'
  | 'feature'
  | 'story'
  | 'task'
  | 'spec'
  | 'backlog'
  | 'quick'
  | 'sprint'
  | 'adr';

export type GraphStatus = 'done' | 'in-progress' | 'blocked' | 'outstanding' | 'addressed';
export type GraphEdgeKind = 'contains' | 'depends_on';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  title: string;
  status: GraphStatus;
  frontmatter: ArtifactFrontmatter;
  githubIssue?: string | number;
  linearIssueIdentifier?: string;
  body?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface ProjectGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ReadGraphOptions {
  includeBody?: boolean;
}

const AGILE_DIRS = ['epics', 'features', 'stories', 'tasks', 'backlog', 'quick', 'sprints', 'adrs'];
/** `sprints/SPRINT-NNN/` holds refinement notes, not artifacts. */
const SPRINT_NOTES_DIR = /^SPRINT-\d+/u;
const PARENT_FIELDS = ['epicId', 'featureId', 'storyId', 'specId'] as const;
const DONE_STATES = new Set(['done', 'closed', 'completed', 'shipped', 'released']);
const ADDRESSED_STATES = new Set(['promoted', 'superseded']);

const ID_PREFIX_TYPE: Record<string, GraphNodeType> = {
  EPIC: 'epic',
  FEAT: 'feature',
  US: 'story',
  T: 'task',
  TASK: 'task',
  SPEC: 'spec',
  ADR: 'adr',
};

function isArtifactFile(name: string): boolean {
  if (name.startsWith('.')) return false;
  if (name.endsWith('-error-report.md')) return false;
  if (name.endsWith('-gherkin.feature')) return false;
  return name.endsWith('.md');
}

function walkAgileDir(dir: string, acc: string[]): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && !SPRINT_NOTES_DIR.test(entry.name))
        walkAgileDir(fullPath, acc);
    } else if (entry.isFile() && isArtifactFile(entry.name)) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function collectSpecDir(specDir: string, acc: string[]): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(specDir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const entry of entries) {
    const fullPath = path.join(specDir, entry.name);
    if (entry.isFile()) {
      if (isArtifactFile(entry.name)) acc.push(fullPath);
    } else if (entry.isDirectory() && (entry.name === 'stories' || entry.name === 'tasks')) {
      let inner: Dirent[];
      try {
        inner = readdirSync(fullPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const file of inner) {
        if (file.isFile() && isArtifactFile(file.name)) {
          acc.push(path.join(fullPath, file.name));
        }
      }
    }
  }
  return acc;
}

function collectArtifacts(planrDir: string): string[] {
  const acc: string[] = [];
  for (const dir of AGILE_DIRS) {
    walkAgileDir(path.join(planrDir, dir), acc);
  }

  const specsRoot = path.join(planrDir, 'specs');
  let specEntries: Dirent[] = [];
  try {
    specEntries = readdirSync(specsRoot, { withFileTypes: true });
  } catch {
    specEntries = [];
  }

  for (const entry of specEntries) {
    if (entry.isDirectory() && /^SPEC-\d+/.test(entry.name)) {
      collectSpecDir(path.join(specsRoot, entry.name), acc);
    }
  }
  return acc;
}

function inferType(relativeDir: string, id: string): GraphNodeType {
  const segments = relativeDir.split('/').filter(Boolean);
  const top = segments[0] || '';

  switch (top) {
    case 'epics':
      return 'epic';
    case 'features':
      return 'feature';
    case 'stories':
      return 'story';
    case 'tasks':
      return 'task';
    case 'backlog':
      return 'backlog';
    case 'quick':
      return 'quick';
    case 'sprints':
      return 'sprint';
    case 'adrs':
      return 'adr';
    case 'specs':
      if (segments.includes('stories')) return 'story';
      if (segments.includes('tasks')) return 'task';
      return 'spec';
    default:
      break;
  }

  const prefix = (id || '').split('-')[0].toUpperCase();
  return ID_PREFIX_TYPE[prefix] ?? 'spec';
}

function specScopeOf(relativeDir: string): string | null {
  const segments = relativeDir.split('/').filter(Boolean);
  if (segments[0] !== 'specs') return null;
  const match = /^(SPEC-\d+)/.exec(segments[1] || '');
  return match ? match[1] : null;
}

export function classifyGraphStatus(rawStatus: unknown): GraphStatus {
  const status = String(rawStatus ?? '')
    .trim()
    .toLowerCase();
  if (status === 'blocked') return 'blocked';
  if (
    status === 'active' ||
    status === 'in-progress' ||
    status === 'in_progress' ||
    status === 'in progress'
  ) {
    return 'in-progress';
  }
  if (DONE_STATES.has(status)) return 'done';
  if (ADDRESSED_STATES.has(status)) return 'addressed';
  return 'outstanding';
}

function legacyAdrMetadata(filename: string, body: string): Record<string, string> {
  const id = /^(ADR-\d+)(?:-|\.md$)/u.exec(filename)?.[1];
  if (!id) return {};
  const metadata: Record<string, string> = { id };
  const heading = /^#[ \t]+(ADR-\d+):[ \t]*(.+)$/mu.exec(body);
  if (heading?.[1] === id) metadata.title = heading[2].trim();
  for (const [label, field] of [
    ['Status', 'status'],
    ['Date', 'date'],
  ]) {
    const value = new RegExp(`^-[ \\t]+${label}:[ \\t]*(.*)$`, 'mu').exec(body)?.[1].trim();
    if (value) metadata[field] = value;
  }
  return metadata;
}

function buildNode(absPath: string, planrDir: string, includeBody: boolean): GraphNode | null {
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }

  const normalized = raw.replace(/^\uFEFF/u, '');
  const parsed = parseMarkdown(normalized);
  const frontmatter = { ...(parsed.data || {}) } as ArtifactFrontmatter;
  const relativeDir = path
    .relative(planrDir, path.dirname(absPath))
    .split(path.sep)
    .join('/')
    .replace(/^\//, '');
  // Empty frontmatter still owns metadata, so detect the consumed fence rather than its keys.
  if (parsed.content === normalized && relativeDir.split('/')[0] === 'adrs') {
    Object.assign(frontmatter, legacyAdrMetadata(path.basename(absPath), parsed.content));
  }

  const localId =
    frontmatter.id != null && String(frontmatter.id).trim() !== ''
      ? String(frontmatter.id)
      : path.basename(absPath, '.md');
  const type = inferType(relativeDir, localId);
  const scope = specScopeOf(relativeDir);
  const prefix = scope ? (type === 'story' ? 'US-' : type === 'task' ? 'T-' : 'SPEC-') : '';
  const filename = path.basename(absPath);
  const hasArtifactFilename =
    filename.startsWith(prefix) && /^[A-Z][A-Z0-9]*-\d+(?:-[^/]*)?\.md$/u.test(filename);
  const hasArtifactId =
    typeof frontmatter.id === 'string' &&
    frontmatter.id.startsWith(prefix) &&
    /^[A-Z][A-Z0-9]*-\d+$/u.test(frontmatter.id);
  if (!hasArtifactFilename && !hasArtifactId) return null;
  const id = scope && type !== 'spec' ? `${scope}/${localId}` : localId;
  const authoredTitle = frontmatter.title ?? frontmatter.name;
  const title =
    authoredTitle != null && String(authoredTitle).trim() !== '' ? String(authoredTitle) : localId;

  frontmatter.id = localId;
  if (scope) frontmatter.specScope = scope;

  const node: GraphNode = {
    id,
    type,
    title,
    status: classifyGraphStatus(frontmatter.status),
    frontmatter,
  };

  if (frontmatter.githubIssue !== undefined && frontmatter.githubIssue !== '') {
    node.githubIssue = frontmatter.githubIssue as string | number;
  }
  if (frontmatter.linearIssueIdentifier !== undefined && frontmatter.linearIssueIdentifier !== '') {
    node.linearIssueIdentifier = String(frontmatter.linearIssueIdentifier);
  }
  if (includeBody) node.body = parsed.content;

  return node;
}

interface SourcedNode {
  node: GraphNode;
  sourcePath: string;
}

/** True when the file name starts with the id's last segment, followed by `-` or `.`. */
function namedAfterId(entry: SourcedNode): boolean {
  const localId = entry.node.id.split('/').at(-1) ?? entry.node.id;
  const name = path.posix.basename(entry.sourcePath);
  return name.startsWith(localId) && /^[-.]/u.test(name.slice(localId.length));
}

/** Duplicate precedence: the id-named file wins, then the lexically smallest path. */
function precedesDuplicate(candidate: SourcedNode, current: SourcedNode): boolean {
  const named = namedAfterId(candidate);
  if (named !== namedAfterId(current)) return named;
  return candidate.sourcePath < current.sourcePath;
}

function readGraphData(
  planrDir: string,
  opts: ReadGraphOptions = {},
  sourcePaths = new Map<string, string>(),
  diagnostics: PlanningDiagnostic[] = [],
): ProjectGraph {
  if (!planrDir || !existsSync(planrDir)) return { nodes: [], edges: [] };

  let stat: Stats;
  try {
    stat = statSync(planrDir);
  } catch {
    return { nodes: [], edges: [] };
  }
  if (!stat.isDirectory()) return { nodes: [], edges: [] };

  const entries: SourcedNode[] = [];
  for (const file of collectArtifacts(planrDir)) {
    const node = buildNode(file, planrDir, opts.includeBody === true);
    if (!node?.id) continue;
    entries.push({ node, sourcePath: path.relative(planrDir, file).split(path.sep).join('/') });
  }
  const winners = new Map<string, SourcedNode>();
  for (const entry of entries) {
    const current = winners.get(entry.node.id);
    if (!current || precedesDuplicate(entry, current)) winners.set(entry.node.id, entry);
  }
  const nodes: GraphNode[] = [];
  const idSet = new Set<string>();
  for (const entry of entries) {
    // A duplicate id is a data error; the winner follows one stated rule so the result
    // never depends on directory listing order, and every other copy is reported.
    if (winners.get(entry.node.id) !== entry) {
      diagnostics.push({
        nodeId: entry.node.id,
        sourcePath: entry.sourcePath,
        field: 'id',
        reason: 'duplicate-identity',
        classification: 'source-data',
      });
      continue;
    }
    sourcePaths.set(entry.node.id, entry.sourcePath);
    nodes.push(entry.node);
    idSet.add(entry.node.id);
  }

  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();
  const addEdge = (from: string, to: string, kind: GraphEdgeKind) => {
    if (!from || !to) return;
    const key = `${kind}\0${from}\0${to}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ from, to, kind });
  };

  const resolveRef = createReferenceResolver({ nodes, edges: [] });
  for (const node of nodes) {
    const scope =
      typeof node.frontmatter.specScope === 'string' ? node.frontmatter.specScope : null;
    for (const field of PARENT_FIELDS) {
      const parent = node.frontmatter[field];
      if (parent == null || parent === '') continue;
      const parentId = resolveRef(parent, scope, field).targetId;
      if (parentId && idSet.has(parentId)) addEdge(parentId, node.id, 'contains');
    }

    const dependsOn = node.frontmatter.dependsOn;
    if (Array.isArray(dependsOn)) {
      for (const dep of dependsOn) {
        if (dep == null || dep === '') continue;
        const depId = resolveRef(dep, scope, 'dependsOn').targetId;
        if (depId && idSet.has(depId)) addEdge(node.id, depId, 'depends_on');
      }
    }
  }

  return { nodes, edges };
}

export function readGraph(planrDir: string, opts: ReadGraphOptions = {}): ProjectGraph {
  return readGraphData(planrDir, opts);
}

export function readPlanningModel(planrDir: string): PlanningReadModel {
  const sourcePaths = new Map<string, string>();
  const diagnostics: PlanningDiagnostic[] = [];
  const graph = readGraphData(planrDir, {}, sourcePaths, diagnostics);
  return createPlanningReadModel(graph, sourcePaths, diagnostics);
}

export function readProjectGraph(
  projectDir: string,
  config: OpenPlanrConfig,
  opts: ReadGraphOptions = {},
): ProjectGraph {
  return readGraph(path.join(projectDir, config.outputPaths.agile), opts);
}

export interface DuplicateIdentity {
  id: string;
  keptPath: string;
  skippedPath: string;
}

/** The project graph plus every duplicate id the reader skipped, with both source paths. */
export function readProjectGraphReport(
  projectDir: string,
  config: OpenPlanrConfig,
  opts: ReadGraphOptions = {},
): { graph: ProjectGraph; duplicates: DuplicateIdentity[] } {
  const sourcePaths = new Map<string, string>();
  const diagnostics: PlanningDiagnostic[] = [];
  const planrDir = path.join(projectDir, config.outputPaths.agile);
  const graph = readGraphData(planrDir, opts, sourcePaths, diagnostics);
  const duplicates = diagnostics
    .filter((diagnostic) => diagnostic.reason === 'duplicate-identity')
    .map((diagnostic) => {
      const keptPath = sourcePaths.get(diagnostic.nodeId);
      if (keptPath === undefined)
        throw new Error(`Duplicate id ${diagnostic.nodeId} has no kept source path.`);
      return { id: diagnostic.nodeId, keptPath, skippedPath: diagnostic.sourcePath };
    });
  return { graph, duplicates };
}
