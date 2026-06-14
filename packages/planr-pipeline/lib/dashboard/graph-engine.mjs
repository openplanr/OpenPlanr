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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateJson } from '../../conformance/json-schema-validate.mjs';
import { readGraph, readNode } from './graph-reader.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

/** Lowest planr CLI version that emits the graph/status --json the dashboard consumes. */
export const CLI_GRAPH_MIN_VERSION = '1.7.2';

let graphSchemaCache = null;
function graphSchema() {
  if (!graphSchemaCache) {
    graphSchemaCache = JSON.parse(
      readFileSync(join(repoRoot, 'schemas', 'v1.0.0', 'graph.schema.json'), 'utf-8'),
    );
  }
  return graphSchemaCache;
}

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
function defaultRun(cmd, args) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf-8',
    timeout: 10_000,
    windowsHide: true,
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
      res = run('planr', args);
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
    const errs = validateJson(graph, graphSchema());
    if (errs.length === 0) return graph;
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
  return readGraph(planrDir);
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
  return readNode(planrDir, id);
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
