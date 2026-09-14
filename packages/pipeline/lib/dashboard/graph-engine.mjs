/**
 * Graph data engine — delegate-or-fallback orchestrator (SPEC-016 / US-002, T-002).
 *
 * Mirrors the /planr-pipeline:status A.1/A.2 contract so the dashboard and the CLI can
 * never drift ("one engine, one truth", BR2):
 *
 *   A.1 delegate — when the planr CLI is installed AND new enough, shell out to
 *       `planr graph --json` (preferred) or `planr status --json`, parse stdout,
 *       validate against schemas/v1.0.0/graph.schema.json, and return it.
 *   A.2 fallback — otherwise, call the native frontmatter reader (graph-reader.mjs),
 *       which produces an equivalent, schema-valid graph from disk.
 *
 * Exports `buildGraph(planrDir)` and `getNode(planrDir, id)` for the dashboard server.
 * Zero third-party dependencies — `node:child_process` for the shell-out is stdlib.
 */

import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate } from '../design/schema-loader.mjs';
import { readGraph, readNode } from './graph-reader.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Lowest planr CLI version that emits the graph/status --json the dashboard consumes. */
export const CLI_GRAPH_MIN_VERSION = '1.7.2';

// ── Version-floor check (same semantics as commands/status.md A.1) ──────────

/** Parse the first `N.N.N`-shaped token out of a `planr --version` string. */
function parseSemver(raw) {
  const m = String(raw ?? '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** @returns true when `a` (semver triple) is >= `b`. */
function gte(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

/**
 * Detect the planr CLI: returns its parsed version triple when present and
 * new enough (>= CLI_GRAPH_MIN_VERSION), else null.
 * @param {(cmd: string, args: string[]) => { status: number|null, stdout: string }} [run]
 */
export function detectCli(run = defaultRun) {
  let res;
  try {
    res = run('planr', ['--version']);
  } catch {
    return null;
  }
  if (!res || res.status !== 0) return null;
  const v = parseSemver(res.stdout);
  if (!v) return null;
  const floor = parseSemver(CLI_GRAPH_MIN_VERSION);
  return gte(v, floor) ? v : null;
}

/** Default shell-out: synchronous, captures stdout, never throws on non-zero exit. */
function defaultRun(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf-8',
    timeout: 10_000,
    windowsHide: true,
    cwd: options.cwd,
  });
  if (res.error) return { status: null, stdout: '' };
  return { status: res.status, stdout: res.stdout ?? '' };
}

// ── CLI delegate ────────────────────────────────────────────────────────────

/**
 * Try the CLI delegate path. Returns a schema-valid Graph on success, or null
 * when the CLI is unavailable / too old / emits something the schema rejects
 * (the caller then falls back to the native reader).
 * @param {string} planrDir
 * @param {(cmd: string, args: string[]) => { status: number|null, stdout: string }} [run]
 */
export function tryDelegate(planrDir, run = defaultRun) {
  const version = detectCli(run);
  if (!version) return null;

  // Prefer `planr graph --json`; fall back to `planr status --json`.
  for (const args of [['graph', '--json'], ['status', '--json']]) {
    let res;
    try {
      // The dashboard may be launched by an installed OpenPlanr command whose
      // process cwd is not the project being displayed. Bind the delegated CLI
      // read to the project that owns this exact .planr directory. Test doubles
      // with the historical two-argument signature safely ignore this option.
      res = run('planr', args, { cwd: dirname(planrDir) });
    } catch {
      continue;
    }
    if (!res || res.status !== 0 || !res.stdout || !res.stdout.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(res.stdout);
    } catch {
      continue;
    }
    const graph = normalizeDelegateOutput(parsed);
    if (!graph) continue;
    try {
      return assertPlanningGraph(graph);
    } catch {
      // A delegate is an optional read path. Invalid output is never exposed;
      // the caller falls back to the independently validated native reader.
    }
  }
  return null;
}

/**
 * Coerce a CLI JSON payload into the { nodes, edges } shape. The CLI may wrap the
 * graph (e.g. `{ graph: { nodes, edges } }`); accept either shape, reject anything
 * without both arrays so the schema validator stays the single gate.
 */
function normalizeDelegateOutput(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const candidate =
    Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)
      ? parsed
      : parsed.graph && Array.isArray(parsed.graph.nodes) && Array.isArray(parsed.graph.edges)
        ? parsed.graph
        : null;
  if (!candidate) return null;
  return { nodes: candidate.nodes, edges: candidate.edges };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the project graph for a `.planr/` directory: delegate to the CLI when
 * available and sufficiently versioned, otherwise read natively. The returned
 * object always validates against schemas/v1.0.0/graph.schema.json.
 * @param {string} planrDir absolute path to a `.planr/` directory
 * @param {{ run?: Function, preferNative?: boolean }} [opts]
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function buildGraph(planrDir, opts = {}) {
  const run = opts.run ?? defaultRun;
  if (opts.preferNative !== true) {
    const delegated = tryDelegate(planrDir, run);
    if (delegated) return delegated;
  }
  return assertPlanningGraph(readGraph(planrDir));
}

/**
 * Resolve a single node (with body) for the detail view. Uses the native reader,
 * which carries the markdown body the inspector needs; the CLI graph payload does
 * not include bodies.
 * @param {string} planrDir absolute path to a `.planr/` directory
 * @param {string} id artifact id (e.g. "T-002")
 * @returns {object|null}
 */
export function getNode(planrDir, id) {
  const node = readNode(planrDir, id);
  if (node === null) return null;
  return assertPlanningNode(node, id);
}

const MAX_GRAPH_BYTES = 16 * 1024 * 1024;
const MAX_GRAPH_DEPTH = 96;
const MAX_GRAPH_VALUES = 250_000;
const MAX_NODE_ID_LENGTH = 256;

function clonePlainJson(value, path = '$') {
  const seen = new WeakSet();
  let count = 0;

  const clone = (entry, currentPath, depth) => {
    count += 1;
    if (depth > MAX_GRAPH_DEPTH || count > MAX_GRAPH_VALUES) {
      throw new TypeError(`Planning graph is too complex at ${currentPath}.`);
    }
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return entry;
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw new TypeError(`Planning graph has a non-finite number at ${currentPath}.`);
      return entry;
    }
    if (typeof entry !== 'object') {
      throw new TypeError(`Planning graph has a non-JSON value at ${currentPath}.`);
    }
    if (seen.has(entry)) throw new TypeError(`Planning graph repeats an object at ${currentPath}.`);
    seen.add(entry);
    try {
      const prototype = Object.getPrototypeOf(entry);
      const expected = Array.isArray(entry) ? Array.prototype : Object.prototype;
      if (prototype !== expected && prototype !== null) {
        throw new TypeError(`Planning graph has a non-plain object at ${currentPath}.`);
      }
      const descriptors = Object.getOwnPropertyDescriptors(entry);
      if (Reflect.ownKeys(descriptors).some((key) => (
        typeof key !== 'string'
        || descriptors[key]?.get !== undefined
        || descriptors[key]?.set !== undefined
      ))) {
        throw new TypeError(`Planning graph has an accessor or symbol at ${currentPath}.`);
      }
      if (Array.isArray(entry)) {
        const keys = Object.keys(descriptors);
        if (keys.some((key) => key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key))) {
          throw new TypeError(`Planning graph has an invalid array property at ${currentPath}.`);
        }
        const out = [];
        for (let index = 0; index < entry.length; index += 1) {
          if (!Object.hasOwn(descriptors, String(index))) {
            throw new TypeError(`Planning graph has a sparse array at ${currentPath}.`);
          }
          out.push(clone(descriptors[String(index)].value, `${currentPath}[${index}]`, depth + 1));
        }
        return out;
      }
      const out = {};
      for (const [key, descriptor] of Object.entries(descriptors)) {
        out[key] = clone(descriptor.value, `${currentPath}.${key}`, depth + 1);
      }
      return out;
    } finally {
      seen.delete(entry);
    }
  };

  const result = clone(value, path, 0);
  const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  if (bytes > MAX_GRAPH_BYTES) throw new TypeError('Planning graph exceeds the public response limit.');
  return result;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function validNodeId(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_NODE_ID_LENGTH) return false;
  if (value === '.' || value === '..' || value.includes('\\')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
      index += 1;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return false;
    }
  }
  return ![...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

/**
 * Owner-boundary graph assertion. JSON Schema remains the canonical structural
 * contract; these semantic checks close identities, edge ownership, duplicate
 * collapse, unsafe injected objects, and accidental detail-body leakage.
 */
export function assertPlanningGraph(value, { allowBody = false } = {}) {
  const graph = clonePlainJson(value);
  const errors = validate(graph, 'graph');
  if (errors.length > 0) throw new TypeError('Invalid Planning graph contract.');

  const ids = new Set();
  for (const node of graph.nodes) {
    if (!validNodeId(node.id) || ids.has(node.id)) {
      throw new TypeError('Invalid or duplicate Planning node identity.');
    }
    if (!allowBody && Object.hasOwn(node, 'body')) {
      throw new TypeError('Planning graph snapshots cannot include artifact bodies.');
    }
    ids.add(node.id);
  }

  const edges = new Set();
  for (const edge of graph.edges) {
    const key = `${edge.kind}\0${edge.from}\0${edge.to}`;
    if (!ids.has(edge.from) || !ids.has(edge.to) || edges.has(key)) {
      throw new TypeError('Invalid, orphaned, or duplicate Planning edge.');
    }
    edges.add(key);
  }
  return deepFreeze(graph);
}

/** Validate one exact detail node, including its intentionally public Markdown body. */
export function assertPlanningNode(value, expectedId = undefined) {
  const node = clonePlainJson(value, '$.node');
  const graph = assertPlanningGraph({ nodes: [node], edges: [] }, { allowBody: true });
  const accepted = graph.nodes[0];
  if (expectedId !== undefined && accepted.id !== expectedId) {
    throw new TypeError('Planning detail identity does not match the requested subject.');
  }
  return accepted;
}

/**
 * Classify a project's planning model from its graph node types, so the dashboard
 * can label/shape its surfaces correctly:
 *   - "agile" — has epic/feature nodes (the EPIC > FEAT > US > T hierarchy);
 *   - "spec"  — has spec nodes and NO epic/feature nodes (spec-driven model);
 *   - "mixed" — both an epic/feature AND a spec are present;
 *   - "empty" — neither.
 * @param {{ nodes?: object[] }} graph
 * @returns {"agile" | "spec" | "mixed" | "empty"}
 */
export function detectMode(graph) {
  const nodes = (graph && Array.isArray(graph.nodes)) ? graph.nodes : [];
  let hasAgile = false;
  let hasSpec = false;
  for (const n of nodes) {
    if (n.type === 'epic' || n.type === 'feature') hasAgile = true;
    else if (n.type === 'spec') hasSpec = true;
    if (hasAgile && hasSpec) return 'mixed';
  }
  if (hasAgile) return 'agile';
  if (hasSpec) return 'spec';
  return 'empty';
}
