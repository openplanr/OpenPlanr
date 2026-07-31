import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveOperatingPipelineRoot } from './protocol.js';
import { executeGitReadOnly } from './read-only-providers.js';
import { compareSensitivity } from './redaction.js';
import {
  OperateError,
  type OperatingEvidenceIndexItem,
  type OperatingRoleId,
  type OperatingSensitivity,
} from './types.js';

/**
 * Bounded, read-only native mission dispatch (FR2 / E-002).
 *
 * This module owns the two enforcement guarantees the pack path never needed:
 *
 *  1. A native advisory lens receives EXACTLY the Protocol v1.3 read-only tool
 *     grant — glob, file read, content search, and read-only git history —
 *     confined to its declared, sensitivity-ceiling-narrowed roots. No write,
 *     execute, network, or environment capability exists on the surface at all,
 *     so a mission agent physically cannot mutate, shell out, egress, or read
 *     ambient process state.
 *  2. The sensitivity ceiling is enforced at READ time: even inside a granted
 *     root, a file above the role's ceiling is refused. This preserves the
 *     pack-era filter-before-handoff guarantee under agent-driven reads.
 *
 * It also owns the per-role dispatch-mode resolution (FR4 / E-004): the derived
 * registry default (`mission`), the per-project `dispatchModeOverrides`, and the
 * FR2-vs-FR4 reconciliation that routes non-enforcing runtimes to the structured
 * provider path. The new mission honeytoken suite exercises every refusal here;
 * the SPEC-002 empty-tool suite continues to govern the pack path unchanged.
 */

export type OperatingDispatchMode = 'pack' | 'mission';

/**
 * The effective isolation a role's dispatch resolves to. Mirrors the isolation
 * vocabulary the pipeline's v1.3 adapter handoff emits so OpenPlanr and the
 * published contract cannot drift:
 *  - `enforced-empty-tools`         — the v1.2 pack path (empty-tool brief);
 *  - `enforced-read-only-bounded`   — a native mission lens with the bounded
 *                                     read-only grant, on a runtime that
 *                                     natively enforces tool isolation;
 *  - `fail-closed-structured-provider` — mission requested but the runtime
 *                                     cannot enforce the boundary, so the role
 *                                     falls back to the structured provider.
 */
export type OperatingDispatchIsolation =
  | 'enforced-empty-tools'
  | 'enforced-read-only-bounded'
  | 'fail-closed-structured-provider';

export interface OperatingDispatchModeResolution {
  roleId: OperatingRoleId;
  /** The configured mode: registry default, overridden by dispatchModeOverrides. */
  mode: OperatingDispatchMode;
  /** The effective isolation after the FR2/FR4 reconciliation. */
  isolation: OperatingDispatchIsolation;
  /** True only when a native, bounded read-only lens is actually dispatched. */
  native: boolean;
  /** Audit note explaining why this isolation was chosen (recorded in provenance). */
  reconciliation: string;
}

/**
 * The bounded read-only capability set for a mission-mode lens. Kept in lockstep
 * with the pipeline's `MISSION_READ_ONLY_TOOLS`: no write, execute, network, or
 * environment tool is present, so a grant assembled from it can never authorize
 * a mutating or escaping action.
 */
export const MISSION_READ_ONLY_TOOLS = Object.freeze([
  'file-read',
  'glob',
  'content-search',
  'git-log',
  'git-show',
  'git-diff',
  'git-blame',
] as const);

export type MissionReadOnlyTool = (typeof MISSION_READ_ONLY_TOOLS)[number];

function isReadOnlyTool(tool: string): tool is MissionReadOnlyTool {
  return (MISSION_READ_ONLY_TOOLS as readonly string[]).includes(tool);
}

// ---------------------------------------------------------------------------
// Dispatch-mode resolution (FR4 / E-004) + runtime enforceability (FR2)
// ---------------------------------------------------------------------------

/**
 * The registry default dispatch mode for a role. The v1.3 role registry carries
 * a `dispatchMode` field; while it is still published without one every role
 * defaults to `mission`, and only a role explicitly marked `pack` opts out —
 * exactly the pipeline's own `role?.dispatchMode ?? 'mission'` convention.
 */
export function operatingRegistryDispatchMode(role: {
  dispatchMode?: unknown;
}): OperatingDispatchMode {
  return role?.dispatchMode === 'pack' ? 'pack' : 'mission';
}

let cachedRuntimeEnforcement: Promise<(runtime: string | undefined) => boolean> | null = null;

interface PipelineRuntimeModule {
  listRuntimeAdapters: () => Array<{ id: string; capabilities?: { toolIsolation?: string } }>;
  normalizeRuntime: (runtime: string) => string;
}

/**
 * Load the pipeline's runtime registry and derive, per runtime, whether it
 * natively enforces the bounded read-only boundary. The classification is the
 * published `capabilities.toolIsolation === 'enforced'` bit — the same one the
 * pipeline's adapter handoff uses — so it stays a single source of truth rather
 * than a field the registry schema cannot carry.
 *
 * Fails CLOSED: if the mission-capable pipeline root or its runtime module
 * cannot be resolved, nothing is treated as enforcing, so a runtime whose
 * isolation cannot be verified never receives a native lens (DoD).
 */
async function loadRuntimeEnforcement(): Promise<(runtime: string | undefined) => boolean> {
  cachedRuntimeEnforcement ??= (async () => {
    try {
      const root = resolveOperatingPipelineRoot({ requireMission: true });
      if (!root) return () => false;
      const module = (await import(
        pathToFileURL(path.join(root, 'lib', 'pipeline', 'runtime.mjs')).href
      )) as unknown as PipelineRuntimeModule;
      const adapters = module.listRuntimeAdapters();
      return (runtime) => {
        if (!runtime || runtime === 'auto') return false;
        let id: string;
        try {
          id = module.normalizeRuntime(runtime);
        } catch {
          return false;
        }
        const adapter = adapters.find((entry) => entry.id === id);
        return adapter?.capabilities?.toolIsolation === 'enforced';
      };
    } catch {
      return () => false;
    }
  })();
  return cachedRuntimeEnforcement;
}

/**
 * Whether the given runtime natively enforces the mission read-only boundary.
 * `claude-code` enforces; `codex` and `cursor` are advisory and do not.
 */
export async function operatingRuntimeEnforcesBoundedReadOnly(
  runtime: string | undefined,
): Promise<boolean> {
  return (await loadRuntimeEnforcement())(runtime);
}

/**
 * Resolve one role's effective dispatch isolation.
 *
 * FR4 states Codex SHOULD dispatch natively, but FR2's fail-closed rule
 * overrides it: a runtime whose tool isolation is only advisory (`codex`,
 * `cursor`) cannot guarantee the bounded read-only boundary, so it routes to the
 * structured provider path until its isolation is enforceable. Only a runtime
 * that natively enforces tool isolation (`toolIsolation === 'enforced'`, i.e.
 * `claude-code`) hosting a native-isolated adapter receives a native mission
 * lens; every other combination fails closed here. This is the exact FR2/FR4
 * reconciliation the spec calls out, recorded in the returned `reconciliation`
 * so it appears in the dispatch provenance.
 */
export function resolveOperatingDispatchMode(input: {
  roleId: OperatingRoleId;
  registryDefault: OperatingDispatchMode;
  override?: OperatingDispatchMode;
  runtimeEnforcesBoundedReadOnly: boolean;
  adapterNativeCapable: boolean;
}): OperatingDispatchModeResolution {
  const mode = input.override ?? input.registryDefault;
  if (mode === 'pack') {
    return {
      roleId: input.roleId,
      mode,
      isolation: 'enforced-empty-tools',
      native: false,
      reconciliation:
        input.override === 'pack'
          ? 'dispatchModeOverrides rolled this role back to the v1.2 empty-tool pack path'
          : 'registry default selects the v1.2 empty-tool pack path',
    };
  }
  if (input.runtimeEnforcesBoundedReadOnly && input.adapterNativeCapable) {
    return {
      roleId: input.roleId,
      mode,
      isolation: 'enforced-read-only-bounded',
      native: true,
      reconciliation:
        'runtime natively enforces tool isolation; a bounded read-only mission lens is dispatched',
    };
  }
  return {
    roleId: input.roleId,
    mode,
    isolation: 'fail-closed-structured-provider',
    native: false,
    reconciliation: input.runtimeEnforcesBoundedReadOnly
      ? 'adapter cannot host a bounded native lens; falling back to the structured provider path'
      : 'runtime tool isolation is advisory or unverifiable (FR2 fail-closed overrides FR4); routing to the structured provider path',
  };
}

// ---------------------------------------------------------------------------
// Sensitivity-ceiling root narrowing (FR2)
// ---------------------------------------------------------------------------

/**
 * The top-level path segment a declared read root is derived from. Mission roots
 * are single top-level directory segments (see `deriveOperatingDeclaredRoots`).
 */
function topSegment(relativePath: string): string | null {
  const [top] = relativePath.split('/');
  return top && top.length > 0 ? top : null;
}

/**
 * Narrow a role's declared read roots by DENY-LISTING any root that contains an
 * evidence item above the role's sensitivity ceiling, so no above-ceiling file
 * is readable even inside a granted root. Pass the FULL (pre-ceiling-filter)
 * evidence index: the narrowing needs to see the above-ceiling items the packet
 * index itself excludes. Combined with the read-time ceiling check on the
 * bounded reader, this is the belt-and-suspenders that preserves the pack-era
 * filter-before-handoff guarantee under agent-driven reads.
 */
export function narrowMissionRootsToCeiling(input: {
  declaredRoots: readonly string[];
  evidenceIndex: readonly OperatingEvidenceIndexItem[];
  ceiling: OperatingSensitivity;
}): string[] {
  const denied = new Set<string>();
  for (const item of input.evidenceIndex) {
    if (!item.path) continue;
    if (compareSensitivity(item.sensitivity, input.ceiling) <= 0) continue;
    const top = topSegment(item.path);
    if (top) denied.add(top);
  }
  return input.declaredRoots.filter((root) => !denied.has(root)).sort();
}

// ---------------------------------------------------------------------------
// Bounded read-only tool surface (FR2)
// ---------------------------------------------------------------------------

export interface MissionReadBoundary {
  /**
   * Absolute, resolved read roots (already sensitivity-ceiling-narrowed). A read
   * target must resolve inside one of these or it is refused as a root escape.
   */
  roots: readonly string[];
  /** The role's sensitivity ceiling, enforced at read time. */
  ceiling: OperatingSensitivity;
  /**
   * The sensitivity of a resolved absolute path. In production this is built
   * from the ceiling-filtered evidence index; an in-root path with no explicit
   * classification falls back to `defaultSensitivity`.
   */
  sensitivityByPath?: ReadonlyMap<string, OperatingSensitivity>;
  /**
   * Sensitivity assumed for an in-root path with no explicit classification.
   * Defaults to the ceiling itself (readable) because the ceiling-filtered index
   * and root narrowing already exclude above-ceiling material; individual
   * above-ceiling files are still refused by the read-time check below.
   */
  defaultSensitivity?: OperatingSensitivity;
  /** Repository root for read-only git tools. Defaults to the first read root. */
  repositoryRoot?: string;
}

export type MissionToolRequest =
  | { tool: 'file-read'; path: string }
  | { tool: 'glob'; pattern?: string; root?: string }
  | { tool: 'content-search'; query: string; root?: string }
  | { tool: 'git-log' | 'git-show' | 'git-diff' | 'git-blame'; args?: string[]; path?: string }
  | { tool: string; [key: string]: unknown };

export type MissionToolResult =
  | { tool: 'file-read'; path: string; content: string }
  | { tool: 'glob'; matches: string[] }
  | { tool: 'content-search'; matches: Array<{ path: string; line: number; text: string }> }
  | { tool: 'git-log' | 'git-show' | 'git-diff' | 'git-blame'; output: string };

const MAX_MISSION_READ_BYTES = 256 * 1024;
const MAX_MISSION_WALK_ENTRIES = 5_000;

function refuseCapability(tool: string): never {
  throw new OperateError(
    'E_OPERATE_PROVIDER_READ_ONLY',
    `Mission tool "${tool}" is not in the bounded read-only grant; write, execute, ` +
      'network, and environment access are refused.',
    { tool, allowed: [...MISSION_READ_ONLY_TOOLS] },
  );
}

function resolvedRoots(boundary: MissionReadBoundary): string[] {
  return boundary.roots.map((root) => path.resolve(root));
}

function isContained(roots: readonly string[], absolute: string): boolean {
  return roots.some((root) => absolute === root || absolute.startsWith(`${root}${path.sep}`));
}

function resolveWithinRoots(boundary: MissionReadBoundary, requestPath: string): string {
  if (typeof requestPath !== 'string' || requestPath.length === 0) {
    throw new OperateError('E_OPERATE_PATH_ESCAPE', 'Mission read requires a non-empty path.');
  }
  const roots = resolvedRoots(boundary);
  const candidates = path.isAbsolute(requestPath)
    ? [path.resolve(requestPath)]
    : roots.map((root) => path.resolve(root, requestPath));
  for (const candidate of candidates) {
    if (isContained(roots, candidate)) return candidate;
  }
  throw new OperateError(
    'E_OPERATE_PATH_ESCAPE',
    `Mission read target "${requestPath}" resolves outside the declared read roots.`,
    { roots: [...boundary.roots] },
  );
}

/**
 * Defeat symlink escapes: after path-based containment, resolve the real target
 * and re-check it against the real roots. Both sides are realpath-resolved so a
 * platform-level symlink on the temp namespace (e.g. macOS `/var`→`/private/var`)
 * does not produce a false escape.
 */
async function assertNoSymlinkEscape(
  boundary: MissionReadBoundary,
  absolute: string,
): Promise<void> {
  let real: string;
  try {
    real = await realpath(absolute);
  } catch {
    // Target does not exist yet; the caller's read/stat surfaces the real error.
    return;
  }
  const realRoots = await Promise.all(
    resolvedRoots(boundary).map((root) => realpath(root).catch(() => root)),
  );
  if (!isContained(realRoots, real)) {
    throw new OperateError(
      'E_OPERATE_PATH_ESCAPE',
      `Mission read target "${absolute}" escapes the declared read roots through a symlink.`,
    );
  }
}

function classify(boundary: MissionReadBoundary, absolute: string): OperatingSensitivity {
  return (
    boundary.sensitivityByPath?.get(absolute) ?? boundary.defaultSensitivity ?? boundary.ceiling
  );
}

function assertBelowCeiling(boundary: MissionReadBoundary, absolute: string): void {
  const sensitivity = classify(boundary, absolute);
  if (compareSensitivity(sensitivity, boundary.ceiling) > 0) {
    throw new OperateError(
      'E_OPERATE_EVIDENCE_REJECTED',
      `Mission read of "${absolute}" is ${sensitivity}, above the ${boundary.ceiling} ceiling.`,
      { sensitivity, ceiling: boundary.ceiling },
    );
  }
}

async function readBoundedFile(
  boundary: MissionReadBoundary,
  requestPath: string,
): Promise<string> {
  const absolute = resolveWithinRoots(boundary, requestPath);
  await assertNoSymlinkEscape(boundary, absolute);
  assertBelowCeiling(boundary, absolute);
  const info = await stat(absolute);
  if (!info.isFile()) {
    throw new OperateError(
      'E_OPERATE_EVIDENCE_REJECTED',
      `Mission read target "${absolute}" is not a file.`,
    );
  }
  if (info.size > MAX_MISSION_READ_BYTES) {
    throw new OperateError(
      'E_OPERATE_EVIDENCE_REJECTED',
      `Mission read target "${absolute}" exceeds the ${MAX_MISSION_READ_BYTES}-byte read bound.`,
    );
  }
  return readFile(absolute, 'utf8');
}

async function* walkRoot(root: string): AsyncGenerator<string> {
  let visited = 0;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => null);
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (entry.isFile()) {
        visited += 1;
        if (visited > MAX_MISSION_WALK_ENTRIES) return;
        yield child;
      }
    }
  }
}

function simplePatternToRegExp(pattern: string): RegExp {
  let out = '';
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index] as string;
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        out += '.*';
        index += 2;
      } else {
        out += '[^/]*';
        index += 1;
      }
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      index += 1;
    }
  }
  return new RegExp(`${out}$`);
}

async function globWithinRoots(
  boundary: MissionReadBoundary,
  pattern: string,
  root?: string,
): Promise<string[]> {
  const roots = root ? [resolveWithinRoots(boundary, root)] : resolvedRoots(boundary);
  const matcher = simplePatternToRegExp(pattern || '**/*');
  const matches: string[] = [];
  for (const searchRoot of roots) {
    for await (const file of walkRoot(searchRoot)) {
      if (!matcher.test(file)) continue;
      try {
        assertBelowCeiling(boundary, file);
      } catch {
        continue;
      }
      matches.push(file);
    }
  }
  return [...new Set(matches)].sort();
}

async function contentSearchWithinRoots(
  boundary: MissionReadBoundary,
  query: string,
  root?: string,
): Promise<Array<{ path: string; line: number; text: string }>> {
  if (typeof query !== 'string' || query.length === 0) {
    throw new OperateError(
      'E_OPERATE_EVIDENCE_REJECTED',
      'Mission content-search requires a query.',
    );
  }
  const roots = root ? [resolveWithinRoots(boundary, root)] : resolvedRoots(boundary);
  const hits: Array<{ path: string; line: number; text: string }> = [];
  for (const searchRoot of roots) {
    for await (const file of walkRoot(searchRoot)) {
      try {
        assertBelowCeiling(boundary, file);
      } catch {
        continue;
      }
      const info = await stat(file).catch(() => null);
      if (!info?.isFile() || info.size > MAX_MISSION_READ_BYTES) continue;
      const content = await readFile(file, 'utf8').catch(() => null);
      if (content === null) continue;
      content.split(/\r?\n/).forEach((text, index) => {
        if (text.includes(query))
          hits.push({ path: file, line: index + 1, text: text.slice(0, 512) });
      });
    }
  }
  return hits;
}

function assertGitArgsBounded(args: readonly string[]): void {
  for (const argument of args) {
    if (typeof argument !== 'string') {
      throw new OperateError(
        'E_OPERATE_PROVIDER_READ_ONLY',
        'Mission git arguments must be strings.',
      );
    }
    if (argument.startsWith('--output') || argument === '-o' || argument.includes('../..')) {
      throw new OperateError(
        'E_OPERATE_PROVIDER_READ_ONLY',
        'Mission git arguments cannot redirect output.',
      );
    }
  }
}

async function runBoundedGit(
  boundary: MissionReadBoundary,
  subcommand: 'log' | 'show' | 'diff' | 'blame',
  request: { args?: string[]; path?: string },
): Promise<string> {
  const repositoryRoot = boundary.repositoryRoot
    ? path.resolve(boundary.repositoryRoot)
    : resolvedRoots(boundary)[0];
  if (!repositoryRoot) {
    throw new OperateError(
      'E_OPERATE_PROVIDER_READ_ONLY',
      'Mission git tools require a repository root.',
    );
  }
  const extra = request.args ?? [];
  assertGitArgsBounded(extra);
  const args = [subcommand, ...extra];
  if (request.path) {
    // Any path argument stays confined to the declared roots.
    const confined = resolveWithinRoots(boundary, request.path);
    args.push('--', path.relative(repositoryRoot, confined) || '.');
  }
  // `executeGitReadOnly` re-asserts the read-only git allowlist (no mutation,
  // no repository/config overrides) as a second, independent gate.
  return executeGitReadOnly(repositoryRoot, args);
}

/**
 * The single audited entry point for a mission lens's tool use. Every request is
 * checked against the bounded read-only grant BEFORE any filesystem or git
 * access: a tool outside the grant (write, execute, network, environment, or any
 * unknown surface) is refused, a target outside the declared roots is refused as
 * a path escape, and a target above the sensitivity ceiling is refused at read
 * time. There is deliberately no write/execute/network/environment tool to
 * invoke — those channels do not exist on this surface at all.
 */
export async function invokeMissionTool(
  boundary: MissionReadBoundary,
  request: MissionToolRequest,
): Promise<MissionToolResult> {
  const tool = String((request as { tool?: unknown }).tool ?? '');
  if (!isReadOnlyTool(tool)) refuseCapability(tool);
  switch (tool) {
    case 'file-read': {
      const requestPath = String((request as { path?: unknown }).path ?? '');
      return {
        tool: 'file-read',
        path: requestPath,
        content: await readBoundedFile(boundary, requestPath),
      };
    }
    case 'glob': {
      const pattern = (request as { pattern?: string }).pattern ?? '**/*';
      const root = (request as { root?: string }).root;
      return { tool: 'glob', matches: await globWithinRoots(boundary, pattern, root) };
    }
    case 'content-search': {
      const query = String((request as { query?: unknown }).query ?? '');
      const root = (request as { root?: string }).root;
      return {
        tool: 'content-search',
        matches: await contentSearchWithinRoots(boundary, query, root),
      };
    }
    case 'git-log':
    case 'git-show':
    case 'git-diff':
    case 'git-blame': {
      const subcommand = tool.slice('git-'.length) as 'log' | 'show' | 'diff' | 'blame';
      const typed = request as { args?: string[]; path?: string };
      return { tool, output: await runBoundedGit(boundary, subcommand, typed) };
    }
    default:
      return refuseCapability(tool);
  }
}

/**
 * The concrete callable tool surface handed to an in-process native harness:
 * exactly the read-only tools, each bound to this boundary. There is no write,
 * execute, network, or environment callable on the returned object, so a harness
 * that walks it can never reach a mutating or escaping capability.
 */
export function createMissionToolset(
  boundary: MissionReadBoundary,
): Record<
  MissionReadOnlyTool,
  (request: Omit<MissionToolRequest, 'tool'>) => Promise<MissionToolResult>
> {
  const toolset = {} as Record<
    MissionReadOnlyTool,
    (request: Omit<MissionToolRequest, 'tool'>) => Promise<MissionToolResult>
  >;
  for (const tool of MISSION_READ_ONLY_TOOLS) {
    toolset[tool] = (request) =>
      invokeMissionTool(boundary, { ...(request as object), tool } as MissionToolRequest);
  }
  return toolset;
}

// ---------------------------------------------------------------------------
// Fan-out orchestration (FR2 parallel/sequential, FR4 determinism)
// ---------------------------------------------------------------------------

/**
 * Fan a per-item dispatch out in parallel where the adapter reports
 * `parallelDispatch: true`, sequentially otherwise. Results are always returned
 * in the SAME order as `items`, so the caller can restore registry order and the
 * reduced events are byte-identical across parallel and sequential dispatch.
 */
export async function runMissionDispatchFanOut<Item, Result>(input: {
  items: readonly Item[];
  parallel: boolean;
  run: (item: Item) => Promise<Result>;
}): Promise<Result[]> {
  if (input.parallel) {
    return Promise.all(input.items.map((item) => input.run(item)));
  }
  const results: Result[] = [];
  for (const item of input.items) {
    results.push(await input.run(item));
  }
  return results;
}
