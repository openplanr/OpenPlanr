/**
 * Native frontmatter reader for the dashboard project graph (SPEC-016 / US-002, T-002).
 *
 * This is the FALLBACK path of the delegate-or-fallback data engine (the A.2 side of
 * the /planr-pipeline:status pattern). It walks `.planr/` with `node:fs`, parses each
 * artifact's YAML frontmatter with a minimal stdlib-only parser, infers the node `type`
 * from the path + id prefix, classifies the node `status` with the same rules as
 * `commands/status.md` A.2, builds `contains` edges from parent-id frontmatter fields
 * and `depends_on` edges from `dependsOn` arrays, and validates the result against
 * `schemas/v1.0.0/graph.schema.json` before returning.
 *
 * Zero third-party dependencies — Node stdlib only (the plugin's zero-runtime-dep posture).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateJson } from '../../conformance/json-schema-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

/** Lazy-load + cache the Graph schema once. */
let graphSchemaCache = null;
function graphSchema() {
  if (!graphSchemaCache) {
    graphSchemaCache = JSON.parse(
      readFileSync(join(repoRoot, 'schemas', 'v1.0.0', 'graph.schema.json'), 'utf-8'),
    );
  }
  return graphSchemaCache;
}

// ── Minimal YAML frontmatter parser (stdlib only) ─────────────────────────
//
// Supports the flat scalar / list shape planr artifacts actually use:
//   key: "quoted string" | unquoted scalar | true/false | 123
//   key: [a, b, c]                          (inline flow array)
//   key:                                    (block array follows)
//     - item
//     - item
// Nested maps are NOT expected in artifact frontmatter and are skipped safely.

function stripQuotes(raw) {
  const s = raw.trim();
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function coerceScalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  const quoted = s[0] === '"' || s[0] === "'";
  const inner = stripQuotes(s);
  if (quoted) return inner;
  if (inner === 'true') return true;
  if (inner === 'false') return false;
  if (inner === 'null' || inner === '~') return null;
  if (/^-?\d+$/.test(inner)) return Number.parseInt(inner, 10);
  if (/^-?\d+\.\d+$/.test(inner)) return Number.parseFloat(inner);
  return inner;
}

function parseInlineArray(raw) {
  const inner = raw.trim().slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map((part) => coerceScalar(part));
}

/**
 * Split a file's text into { frontmatter, body }. Frontmatter is the block between
 * the first two `---` fences. Returns null frontmatter when no fence is present.
 */
export function splitFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n') && normalized !== '---') {
    return { raw: '', body: normalized, hasFrontmatter: false };
  }
  const rest = normalized.slice(4);
  const end = rest.indexOf('\n---');
  if (end === -1) {
    return { raw: '', body: normalized, hasFrontmatter: false };
  }
  const raw = rest.slice(0, end);
  // body starts after the closing fence line
  const afterFence = rest.slice(end + 4);
  const body = afterFence.startsWith('\n') ? afterFence.slice(1) : afterFence;
  return { raw, body, hasFrontmatter: true };
}

/** Parse a frontmatter block (the text between the `---` fences) into a flat object. */
export function parseFrontmatter(raw) {
  const out = {};
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    // Only top-level keys (no leading indent) — nested maps are ignored.
    if (/^\s/.test(line)) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (key === '') continue;
    let value = line.slice(colon + 1).trim();
    // strip trailing inline comment on unquoted scalars
    if (value && value[0] !== '"' && value[0] !== "'" && value[0] !== '[') {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    if (value === '') {
      // Possible block array on following indented `- ` lines.
      const items = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        items.push(coerceScalar(lines[j].replace(/^\s*-\s+/, '')));
        j++;
      }
      if (items.length > 0) {
        out[key] = items;
        i = j - 1;
      } else {
        out[key] = '';
      }
      continue;
    }

    if (value[0] === '[') {
      out[key] = parseInlineArray(value);
      continue;
    }

    out[key] = coerceScalar(value);
  }
  return out;
}

// ── Type inference ────────────────────────────────────────────────────────

const ID_PREFIX_TYPE = {
  EPIC: 'epic',
  FEAT: 'feature',
  US: 'story',
  T: 'task',
  TASK: 'task',
  SPEC: 'spec',
  ADR: 'adr',
};

/**
 * Infer the node type from the artifact's `.planr/`-relative directory and its id.
 * Path takes precedence (it is the canonical layout); the id prefix breaks ties.
 */
export function inferType(relDir, id) {
  const segs = relDir.split('/').filter(Boolean);
  const top = segs[0] || '';
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
    case 'specs': {
      // .planr/specs/SPEC-NNN-slug/{SPEC-*.md | stories/* | tasks/*}
      if (segs.includes('stories')) return 'story';
      if (segs.includes('tasks')) return 'task';
      return 'spec';
    }
    default:
      break;
  }
  const prefix = (id || '').split('-')[0].toUpperCase();
  if (ID_PREFIX_TYPE[prefix]) return ID_PREFIX_TYPE[prefix];
  return 'spec';
}

// ── Status classification (mirrors commands/status.md A.2) ──────────────────

const DONE_STATES = new Set(['done', 'closed', 'completed', 'shipped', 'released']);
const ADDRESSED_STATES = new Set(['promoted', 'superseded']);

/**
 * Classify a node into one of the five graph statuses, mirroring /status A.2.
 * - blocked / in-progress are honoured verbatim from the raw status when present
 *   (these come from ship markers + checkbox counts in the agile model);
 * - done = done|closed|completed|shipped|released;
 * - addressed = promoted|superseded (resolved, not done, not outstanding);
 * - everything else = outstanding.
 */
export function classifyStatus(rawStatus) {
  const s = String(rawStatus ?? '').trim().toLowerCase();
  if (s === 'blocked') return 'blocked';
  if (s === 'in-progress' || s === 'in_progress' || s === 'in progress') return 'in-progress';
  if (DONE_STATES.has(s)) return 'done';
  if (ADDRESSED_STATES.has(s)) return 'addressed';
  return 'outstanding';
}

// ── Filesystem walk ─────────────────────────────────────────────────────────
//
// The walk is restricted to canonical artifact locations so loose markdown
// (ESTIMATION.md, memory.md, checklists/, design-system/, designs/, diagrams/,
// each spec's qa-report.md / clarifications.md / design/) is never ingested as a
// bogus node. Two shapes are recognized:
//   1. Flat agile dirs at `.planr/` root (epics/ features/ stories/ tasks/
//      backlog/ quick/ sprints/ adrs/) — recurse for default-mode `us-*/` nesting.
//   2. Per-spec dirs `.planr/specs/SPEC-*/` — ONLY the spec body `SPEC-*.md`,
//      plus `stories/US-*.md` and `tasks/T-*.md`.

/** The flat agile artifact dirs that live directly under `.planr/`. */
const AGILE_DIRS = ['epics', 'features', 'stories', 'tasks', 'backlog', 'quick', 'sprints', 'adrs'];

/** True when a filename is an artifact `.md` node (not gherkin/error-report/dotfile). */
function isArtifactFile(name) {
  if (name.startsWith('.')) return false;
  if (name.endsWith('-error-report.md')) return false;
  if (name.endsWith('-gherkin.feature')) return false;
  return name.endsWith('.md');
}

/** Recursively collect artifact `.md` paths under a flat agile dir (handles `us-NNN/` nesting). */
function walkAgileDir(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name.startsWith('.')) continue;
      walkAgileDir(full, acc);
    } else if (ent.isFile() && isArtifactFile(ent.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Collect the canonical `.md` artifacts from a single `.planr/specs/SPEC-NNN` dir. */
function collectSpecDir(specDir, acc) {
  let entries;
  try {
    entries = readdirSync(specDir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    const full = join(specDir, ent.name);
    if (ent.isFile()) {
      // Only the spec body — never qa-report.md / clarifications.md / dotfiles.
      if (/^SPEC-\d+.*\.md$/.test(ent.name)) acc.push(full);
    } else if (ent.isDirectory() && (ent.name === 'stories' || ent.name === 'tasks')) {
      // ONLY stories/US-*.md and tasks/T-*.md — exclude design/, dotfiles, etc.
      const prefix = ent.name === 'stories' ? 'US-' : 'T-';
      let inner;
      try {
        inner = readdirSync(full, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of inner) {
        if (f.isFile() && f.name.startsWith(prefix) && isArtifactFile(f.name)) {
          acc.push(join(full, f.name));
        }
      }
    }
  }
  return acc;
}

/**
 * Collect every canonical artifact path under a `.planr/` directory: the flat
 * agile dirs, then each `specs/SPEC-NNN` dir's body + stories + tasks. Loose
 * top-level files and non-canonical subtrees are ignored by construction.
 */
function collectArtifacts(planrDir) {
  const acc = [];
  for (const d of AGILE_DIRS) {
    walkAgileDir(join(planrDir, d), acc);
  }
  const specsRoot = join(planrDir, 'specs');
  let specEntries;
  try {
    specEntries = readdirSync(specsRoot, { withFileTypes: true });
  } catch {
    specEntries = [];
  }
  for (const ent of specEntries) {
    if (ent.isDirectory() && /^SPEC-\d+/.test(ent.name)) {
      collectSpecDir(join(specsRoot, ent.name), acc);
    }
  }
  return acc;
}

/** Derive the `SPEC-NNN` scope from a `.planr/`-relative dir, or null when not under specs/. */
function specScopeOf(relDir) {
  const segs = relDir.split('/').filter(Boolean);
  if (segs[0] !== 'specs') return null;
  const m = /^(SPEC-\d+)/.exec(segs[1] || '');
  return m ? m[1] : null;
}

// ── Edge construction ───────────────────────────────────────────────────────

// Frontmatter fields that point at a parent (the `from` side of a `contains` edge).
const PARENT_FIELDS = ['epicId', 'featureId', 'storyId', 'specId'];

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a node object from a single artifact file.
 * @param {string} absPath absolute file path
 * @param {string} planrDir absolute path to the `.planr/` directory
 * @param {boolean} includeBody include the markdown body on the node
 */
function buildNode(absPath, planrDir, includeBody) {
  let text;
  try {
    text = readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }
  const { raw, body, hasFrontmatter } = splitFrontmatter(text);
  const fm = hasFrontmatter ? parseFrontmatter(raw) : {};

  // `.planr/`-relative dir, normalized via path.relative so a relative or a
  // trailing-slashed planrDir still yields a clean POSIX-style relative path.
  const relDir = relative(planrDir, dirname(absPath))
    .split(sep)
    .join('/')
    .replace(/^\//, '');

  let localId = fm.id != null ? String(fm.id) : '';
  if (localId === '') {
    // Derive an id from the filename when frontmatter omits it (best effort).
    localId = basename(absPath, '.md');
  }

  const type = inferType(relDir, localId);

  // Namespace ids by spec scope so per-spec story/task ids (every spec restarts
  // at US-001 / T-001) stay globally unique. The spec BODY keeps its bare id
  // (already unique); stories/tasks become `${SPEC-NNN}/${localId}`. Agile
  // top-level artifacts keep their bare (globally-unique) id.
  const scope = specScopeOf(relDir);
  let id = localId;
  if (scope && type !== 'spec') {
    id = `${scope}/${localId}`;
  }

  // Keep the LOCAL id in frontmatter (the frontend displays that). frontmatter
  // is additionalProperties:true, so stashing the scope here is schema-safe and
  // lets edge resolution namespace without adding new top-level node fields.
  fm.id = localId;
  if (scope) fm.specScope = scope;

  const title = fm.title != null && String(fm.title).trim() !== '' ? String(fm.title) : localId;
  const status = classifyStatus(fm.status);

  const node = { id, type, title, status, frontmatter: fm };

  if (fm.githubIssue !== undefined && fm.githubIssue !== '') {
    node.githubIssue = fm.githubIssue;
  }
  if (fm.linearIssueIdentifier !== undefined && fm.linearIssueIdentifier !== '') {
    node.linearIssueIdentifier = String(fm.linearIssueIdentifier);
  }
  if (includeBody) node.body = body;

  return node;
}

/**
 * Read `.planr/` natively and return a schema-valid Graph object.
 * @param {string} planrDir absolute path to a `.planr/` directory
 * @param {{ includeBody?: boolean, validate?: boolean }} [opts]
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function readGraph(planrDir, opts = {}) {
  const includeBody = opts.includeBody === true;
  const shouldValidate = opts.validate !== false;

  const empty = { nodes: [], edges: [] };
  if (!planrDir || !existsSync(planrDir)) {
    return empty;
  }

  let stat;
  try {
    stat = statSync(planrDir);
  } catch {
    return empty;
  }
  if (!stat.isDirectory()) return empty;

  const files = collectArtifacts(planrDir);
  const nodes = [];
  const idSet = new Set();
  for (const file of files) {
    const node = buildNode(file, planrDir, includeBody);
    if (!node || !node.id) continue;
    // Namespacing makes story/task ids globally unique, so the old silent
    // "first wins" collapse is gone. Guard only against a genuine exact-duplicate
    // global id (the schema requires unique ids; a true dup is a data error).
    if (idSet.has(node.id)) continue;
    idSet.add(node.id);
    nodes.push(node);
  }

  const edges = [];
  const edgeSet = new Set();
  const addEdge = (from, to, kind) => {
    if (!from || !to) return;
    const key = `${kind} ${from} ${to}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ from, to, kind });
  };

  // Resolve a parent/dependency reference to its global node id using the same
  // namespacing: under a spec scope, `specId` ("SPEC-NNN") points at the spec
  // body (bare id) while local refs (US-003, T-001) namespace to `${scope}/...`.
  const resolveRef = (rawRef, scope, field) => {
    const ref = String(rawRef);
    if (!scope) return ref; // agile top-level: bare ids
    if (field === 'specId' || /^SPEC-\d+/.test(ref)) return ref; // spec body is bare
    return `${scope}/${ref}`;
  };

  for (const node of nodes) {
    const fm = node.frontmatter || {};
    const scope = fm.specScope || null;
    // contains: parent -> this node (only when the resolved parent id exists)
    for (const field of PARENT_FIELDS) {
      const parent = fm[field];
      if (parent == null || parent === '') continue;
      const parentId = resolveRef(parent, scope, field);
      if (idSet.has(parentId)) addEdge(parentId, node.id, 'contains');
    }
    // depends_on: this node -> each prerequisite (only when the target exists)
    const deps = fm.dependsOn;
    if (Array.isArray(deps)) {
      for (const dep of deps) {
        if (dep == null || dep === '') continue;
        const depId = resolveRef(dep, scope, 'dependsOn');
        if (idSet.has(depId)) addEdge(node.id, depId, 'depends_on');
      }
    }
  }

  const graph = { nodes, edges };

  if (shouldValidate) {
    const errs = validateJson(graph, graphSchema());
    if (errs.length > 0) {
      const first = errs.slice(0, 3).map((e) => `${e.path}: ${e.rule} — ${e.detail}`).join('; ');
      throw new Error(`graph-reader produced a graph that fails graph.schema.json: ${first}`);
    }
  }

  return graph;
}

/**
 * Read a single node by id from `.planr/`, with its markdown body included.
 * @param {string} planrDir absolute path to a `.planr/` directory
 * @param {string} id the artifact id (e.g. "T-002")
 * @returns {object|null} the node, or null when not found
 */
export function readNode(planrDir, id) {
  if (!id) return null;
  const graph = readGraph(planrDir, { includeBody: true, validate: false });
  return graph.nodes.find((n) => n.id === id) ?? null;
}
