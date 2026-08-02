import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveOperatingPipelineRoot } from './protocol.js';
import { executeGitReadOnly } from './read-only-providers.js';
import { compareSensitivity } from './redaction.js';
import { OperateError } from './types.js';
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
]);
function isReadOnlyTool(tool) {
    return MISSION_READ_ONLY_TOOLS.includes(tool);
}
// ---------------------------------------------------------------------------
// Runtime enforceability (FR2)
// ---------------------------------------------------------------------------
let cachedRuntimeEnforcement = null;
let cachedRuntimeCapabilities = null;
async function loadRuntimeCapabilities() {
    cachedRuntimeCapabilities ??= (async () => {
        try {
            const root = resolveOperatingPipelineRoot({ requireMission: true });
            if (!root) {
                return () => ({ supported: false, toolIsolation: 'none', dispatch: 'none' });
            }
            const module = (await import(pathToFileURL(path.join(root, 'lib', 'pipeline', 'runtime.mjs')).href));
            const adapters = module.listRuntimeAdapters();
            return (runtime) => {
                if (!runtime || runtime === 'auto') {
                    return { supported: false, toolIsolation: 'none', dispatch: 'none' };
                }
                let id;
                try {
                    id = module.normalizeRuntime(runtime);
                }
                catch {
                    return { supported: false, toolIsolation: 'none', dispatch: 'none' };
                }
                const adapter = adapters.find((entry) => entry.id === id);
                const dispatch = adapter?.capabilities?.operatingAdvisorDispatch ?? 'none';
                return {
                    supported: adapter?.capabilities?.operatingBoard === true &&
                        ['native-agent', 'sequential-native', 'native-read-only'].includes(dispatch),
                    toolIsolation: adapter?.capabilities?.toolIsolation ?? 'none',
                    dispatch,
                };
            };
        }
        catch {
            return () => ({ supported: false, toolIsolation: 'none', dispatch: 'none' });
        }
    })();
    return cachedRuntimeCapabilities;
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
async function loadRuntimeEnforcement() {
    cachedRuntimeEnforcement ??= (async () => {
        try {
            const root = resolveOperatingPipelineRoot({ requireMission: true });
            if (!root)
                return () => false;
            const module = (await import(pathToFileURL(path.join(root, 'lib', 'pipeline', 'runtime.mjs')).href));
            const adapters = module.listRuntimeAdapters();
            return (runtime) => {
                if (!runtime || runtime === 'auto')
                    return false;
                let id;
                try {
                    id = module.normalizeRuntime(runtime);
                }
                catch {
                    return false;
                }
                const adapter = adapters.find((entry) => entry.id === id);
                return adapter?.capabilities?.toolIsolation === 'enforced';
            };
        }
        catch {
            return () => false;
        }
    })();
    return cachedRuntimeEnforcement;
}
/**
 * Whether the given runtime natively enforces the mission read-only boundary.
 * `claude-code` enforces; `codex` and `cursor` are advisory and do not.
 */
export async function operatingRuntimeEnforcesBoundedReadOnly(runtime) {
    return (await loadRuntimeEnforcement())(runtime);
}
/** Whether the selected runtime has a generated, runtime-native Operate workflow. */
export async function operatingRuntimeSupportsNativeOperate(runtime) {
    return (await loadRuntimeCapabilities())(runtime).supported;
}
/**
 * Classify one role's dispatch isolation (FR10). Governance moved to OUTPUT
 * verification, so the runtime is no longer gated on a native-vs-structured
 * split before it may think — it is classified purely on whether it can carry a
 * mandate and return a schema-valid cited response. A runtime that natively
 * enforces the bounded read-only tool grant is `enforced-read-only-bounded`.
 * A compatible native-agent workflow running under the selected runtime's own
 * session permissions is `runtime-governed`. Only an adapter that cannot run
 * either workflow is unsupported. The specific reason is recorded in
 * `reconciliation` so it appears in dispatch provenance.
 */
export function resolveOperatingDispatchIsolation(input) {
    if (input.runtimeEnforcesBoundedReadOnly && input.adapterNativeCapable) {
        return {
            roleId: input.roleId,
            isolation: 'enforced-read-only-bounded',
            native: true,
            reconciliation: 'runtime natively enforces tool isolation and can carry a mandate; a bounded read-only mission lens is dispatched',
        };
    }
    if (input.runtimeWorkflowCapable && input.adapterNativeCapable) {
        return {
            roleId: input.roleId,
            isolation: 'runtime-governed',
            native: true,
            reconciliation: 'the selected runtime executes the generated native-agent workflow under its current session permissions; citation and schema validation govern persistence',
        };
    }
    return {
        roleId: input.roleId,
        isolation: 'unsupported',
        native: false,
        reconciliation: input.runtimeEnforcesBoundedReadOnly
            ? 'adapter cannot host a bounded read-only mission lens, so this runtime is unsupported for operate; no silent structured-provider fallback exists'
            : 'runtime tool isolation is advisory or unverifiable, so it cannot carry a mandate and is unsupported for operate; no silent structured-provider fallback exists',
    };
}
/**
 * Classify a runtime for operate dispatch (FR10). A runtime that natively
 * enforces the bounded read-only boundary can carry a mandate and is
 * `enforced-read-only-bounded` (first-class). Compatible advisory runtimes are
 * `runtime-governed`; only missing/incompatible workflows are unsupported.
 */
export async function classifyOperatingRuntime(runtime) {
    const label = runtime && runtime !== 'auto' ? runtime : 'auto';
    const capabilities = (await loadRuntimeCapabilities())(runtime);
    if (capabilities.supported) {
        const enforced = capabilities.toolIsolation === 'enforced';
        return {
            runtime: label,
            isolation: enforced ? 'enforced-read-only-bounded' : 'runtime-governed',
            mandateCapable: true,
            reason: enforced
                ? 'runs the generated native-agent workflow with enforced tool isolation'
                : `runs the generated native-agent workflow under the runtime session's permissions; tool isolation is ${capabilities.toolIsolation} and governed writes still require verified cited output`,
        };
    }
    return {
        runtime: label,
        isolation: 'unsupported',
        mandateCapable: false,
        reason: label === 'auto'
            ? 'no runtime is selected, so mandate-capable tool isolation cannot be verified'
            : 'the installed adapter does not expose a compatible native-agent or same-runtime sequential Operate workflow',
    };
}
let cachedRuntimeResolver = null;
/**
 * Resolve the active runtime id for a project WITHOUT probing installed binaries
 * (spawn-free) so `operate doctor` can classify it. Reads the runtime the
 * project/user already selected from the pipeline's reclassified registry. Fails
 * closed to `undefined` when no runtime is selected or the registry cannot be
 * resolved, so an unresolved runtime is classified `unsupported`, never assumed
 * mandate-capable.
 */
export async function resolveActiveOperatingRuntime(projectRoot) {
    cachedRuntimeResolver ??= (async () => {
        try {
            const root = resolveOperatingPipelineRoot({ requireMission: true });
            if (!root)
                return () => undefined;
            const module = (await import(pathToFileURL(path.join(root, 'lib', 'pipeline', 'runtime.mjs')).href));
            const resolve = module.resolveRuntimeAdapter;
            if (typeof resolve !== 'function')
                return () => undefined;
            return (target) => {
                try {
                    return resolve({ projectRoot: target, installed: [] })?.adapter?.id;
                }
                catch {
                    return undefined;
                }
            };
        }
        catch {
            return () => undefined;
        }
    })();
    return (await cachedRuntimeResolver)(projectRoot);
}
// ---------------------------------------------------------------------------
// Read-boundary declaration (FR2)
// ---------------------------------------------------------------------------
/**
 * Declare a role's mission read roots directly from the granted workspace roots
 * minus the explicitly forbidden paths — the coarse boundary the mandate model
 * dispatches against. There is no evidence index to narrow (the mandate carries
 * none): every granted root is declared whole, and the sensitivity ceiling is
 * enforced not by dropping a root here but by the bounded reader's read-time
 * `assertBelowCeiling` and, at record time, by the citation resolver refusing an
 * above-ceiling citation. A root that exactly matches, or is nested under, a
 * forbidden path is dropped. The result is deduplicated and sorted so the
 * declared boundary is deterministic.
 */
export function narrowMissionRootsToCeiling(input) {
    const forbidden = input.forbiddenPaths ?? [];
    const isForbidden = (root) => forbidden.some((path) => root === path || root.startsWith(`${path}/`));
    return [...new Set(input.declaredRoots.filter((root) => !isForbidden(root)))].sort();
}
const MAX_MISSION_READ_BYTES = 256 * 1024;
const MAX_MISSION_WALK_ENTRIES = 5_000;
function refuseCapability(tool) {
    throw new OperateError('E_OPERATE_PROVIDER_READ_ONLY', `Mission tool "${tool}" is not in the bounded read-only grant; write, execute, ` +
        'network, and environment access are refused.', { tool, allowed: [...MISSION_READ_ONLY_TOOLS] });
}
function resolvedRoots(boundary) {
    return boundary.roots.map((root) => path.resolve(root));
}
function isContained(roots, absolute) {
    return roots.some((root) => absolute === root || absolute.startsWith(`${root}${path.sep}`));
}
function resolveWithinRoots(boundary, requestPath) {
    if (typeof requestPath !== 'string' || requestPath.length === 0) {
        throw new OperateError('E_OPERATE_PATH_ESCAPE', 'Mission read requires a non-empty path.');
    }
    const roots = resolvedRoots(boundary);
    const candidates = path.isAbsolute(requestPath)
        ? [path.resolve(requestPath)]
        : roots.map((root) => path.resolve(root, requestPath));
    for (const candidate of candidates) {
        if (isContained(roots, candidate))
            return candidate;
    }
    throw new OperateError('E_OPERATE_PATH_ESCAPE', `Mission read target "${requestPath}" resolves outside the declared read roots.`, { roots: [...boundary.roots] });
}
/**
 * Defeat symlink escapes: after path-based containment, resolve the real target
 * and re-check it against the real roots. Both sides are realpath-resolved so a
 * platform-level symlink on the temp namespace (e.g. macOS `/var`→`/private/var`)
 * does not produce a false escape.
 */
async function assertNoSymlinkEscape(boundary, absolute) {
    let real;
    try {
        real = await realpath(absolute);
    }
    catch {
        // Target does not exist yet; the caller's read/stat surfaces the real error.
        return;
    }
    const realRoots = await Promise.all(resolvedRoots(boundary).map((root) => realpath(root).catch(() => root)));
    if (!isContained(realRoots, real)) {
        throw new OperateError('E_OPERATE_PATH_ESCAPE', `Mission read target "${absolute}" escapes the declared read roots through a symlink.`);
    }
}
function classify(boundary, absolute) {
    return (boundary.sensitivityByPath?.get(absolute) ?? boundary.defaultSensitivity ?? boundary.ceiling);
}
function assertBelowCeiling(boundary, absolute) {
    const sensitivity = classify(boundary, absolute);
    if (compareSensitivity(sensitivity, boundary.ceiling) > 0) {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', `Mission read of "${absolute}" is ${sensitivity}, above the ${boundary.ceiling} ceiling.`, { sensitivity, ceiling: boundary.ceiling });
    }
}
async function readBoundedFile(boundary, requestPath) {
    const absolute = resolveWithinRoots(boundary, requestPath);
    await assertNoSymlinkEscape(boundary, absolute);
    assertBelowCeiling(boundary, absolute);
    const info = await stat(absolute);
    if (!info.isFile()) {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', `Mission read target "${absolute}" is not a file.`);
    }
    if (info.size > MAX_MISSION_READ_BYTES) {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', `Mission read target "${absolute}" exceeds the ${MAX_MISSION_READ_BYTES}-byte read bound.`);
    }
    return readFile(absolute, 'utf8');
}
async function* walkRoot(root) {
    let visited = 0;
    const stack = [root];
    while (stack.length > 0) {
        const current = stack.pop();
        const entries = await readdir(current, { withFileTypes: true }).catch(() => null);
        if (!entries)
            continue;
        for (const entry of entries) {
            if (entry.name === '.git' || entry.name === 'node_modules')
                continue;
            const child = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(child);
            }
            else if (entry.isFile()) {
                visited += 1;
                if (visited > MAX_MISSION_WALK_ENTRIES)
                    return;
                yield child;
            }
        }
    }
}
/**
 * Render a filesystem path with forward-slash separators so a glob pattern —
 * always authored with `/` — matches identically on every platform. `path.join`
 * yields `\` separators on Windows, which the pattern's `/` can never match, so
 * a recursive `.ts` glob would otherwise return nothing on Windows. Normalizing
 * only the candidate fed to the matcher (never the stored/returned path) keeps
 * the emitted matches in native form for the caller's own containment checks. On
 * POSIX `path.sep` is `/`, so this is a no-op.
 */
function toGlobMatchPath(target) {
    return target.split(path.sep).join('/');
}
function simplePatternToRegExp(pattern) {
    let out = '';
    let index = 0;
    while (index < pattern.length) {
        const char = pattern[index];
        if (char === '*') {
            if (pattern[index + 1] === '*') {
                out += '.*';
                index += 2;
            }
            else {
                out += '[^/]*';
                index += 1;
            }
        }
        else {
            out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            index += 1;
        }
    }
    return new RegExp(`${out}$`);
}
async function globWithinRoots(boundary, pattern, root) {
    const roots = root ? [resolveWithinRoots(boundary, root)] : resolvedRoots(boundary);
    const matcher = simplePatternToRegExp(pattern || '**/*');
    const matches = [];
    for (const searchRoot of roots) {
        for await (const file of walkRoot(searchRoot)) {
            if (!matcher.test(toGlobMatchPath(file)))
                continue;
            try {
                assertBelowCeiling(boundary, file);
            }
            catch {
                continue;
            }
            matches.push(file);
        }
    }
    return [...new Set(matches)].sort();
}
async function contentSearchWithinRoots(boundary, query, root) {
    if (typeof query !== 'string' || query.length === 0) {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'Mission content-search requires a query.');
    }
    const roots = root ? [resolveWithinRoots(boundary, root)] : resolvedRoots(boundary);
    const hits = [];
    for (const searchRoot of roots) {
        for await (const file of walkRoot(searchRoot)) {
            try {
                assertBelowCeiling(boundary, file);
            }
            catch {
                continue;
            }
            const info = await stat(file).catch(() => null);
            if (!info?.isFile() || info.size > MAX_MISSION_READ_BYTES)
                continue;
            const content = await readFile(file, 'utf8').catch(() => null);
            if (content === null)
                continue;
            content.split(/\r?\n/).forEach((text, index) => {
                if (text.includes(query))
                    hits.push({ path: file, line: index + 1, text: text.slice(0, 512) });
            });
        }
    }
    return hits;
}
function assertGitArgsBounded(args) {
    for (const argument of args) {
        if (typeof argument !== 'string') {
            throw new OperateError('E_OPERATE_PROVIDER_READ_ONLY', 'Mission git arguments must be strings.');
        }
        if (argument.startsWith('--output') || argument === '-o' || argument.includes('../..')) {
            throw new OperateError('E_OPERATE_PROVIDER_READ_ONLY', 'Mission git arguments cannot redirect output.');
        }
    }
}
async function runBoundedGit(boundary, subcommand, request) {
    const repositoryRoot = boundary.repositoryRoot
        ? path.resolve(boundary.repositoryRoot)
        : resolvedRoots(boundary)[0];
    if (!repositoryRoot) {
        throw new OperateError('E_OPERATE_PROVIDER_READ_ONLY', 'Mission git tools require a repository root.');
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
export async function invokeMissionTool(boundary, request) {
    const tool = String(request.tool ?? '');
    if (!isReadOnlyTool(tool))
        refuseCapability(tool);
    switch (tool) {
        case 'file-read': {
            const requestPath = String(request.path ?? '');
            return {
                tool: 'file-read',
                path: requestPath,
                content: await readBoundedFile(boundary, requestPath),
            };
        }
        case 'glob': {
            const pattern = request.pattern ?? '**/*';
            const root = request.root;
            return { tool: 'glob', matches: await globWithinRoots(boundary, pattern, root) };
        }
        case 'content-search': {
            const query = String(request.query ?? '');
            const root = request.root;
            return {
                tool: 'content-search',
                matches: await contentSearchWithinRoots(boundary, query, root),
            };
        }
        case 'git-log':
        case 'git-show':
        case 'git-diff':
        case 'git-blame': {
            const subcommand = tool.slice('git-'.length);
            const typed = request;
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
export function createMissionToolset(boundary) {
    const toolset = {};
    for (const tool of MISSION_READ_ONLY_TOOLS) {
        toolset[tool] = (request) => invokeMissionTool(boundary, { ...request, tool });
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
export async function runMissionDispatchFanOut(input) {
    if (input.parallel) {
        return Promise.all(input.items.map((item) => input.run(item)));
    }
    const results = [];
    for (const item of input.items) {
        results.push(await input.run(item));
    }
    return results;
}
//# sourceMappingURL=mission-dispatch.js.map