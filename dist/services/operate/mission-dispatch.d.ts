import { type OperatingRoleId, type OperatingSensitivity } from './types.js';
/**
 * Bounded, read-only native mandate dispatch (FR2 / E-002).
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
 * It also owns per-role runtime isolation classification. The mandate
 * honeytoken suite exercises every refusal here.
 */
/**
 * The effective isolation a role's dispatch resolves to. Mirrors the two-value
 * classification the pipeline's v1.3 adapter handoff now publishes
 * (`enforced-read-only-bounded | unsupported`) so OpenPlanr and the published
 * contract cannot drift. Governance moved to OUTPUT verification (citations
 * resolve fail-closed; the CLI owns every write), so a runtime is no longer
 * gated on a native-vs-structured capability split before it may think — it is
 * classified purely on whether it can carry a mandate:
 *  - `enforced-read-only-bounded` — a runtime that natively enforces the bounded
 *                                   read-only tool grant and can carry a mandate;
 *                                   this is the only first-class operate dispatch;
 *  - `unsupported`                — a runtime whose isolation is advisory or
 *                                   unverifiable, or an adapter that cannot host a
 *                                   bounded native lens; operate declares it
 *                                   unsupported rather than silently degrading it
 *                                   to a lesser path.
 */
export type OperatingDispatchIsolation = 'enforced-read-only-bounded' | 'runtime-governed' | 'unsupported';
export interface OperatingDispatchResolution {
    roleId: OperatingRoleId;
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
export declare const MISSION_READ_ONLY_TOOLS: readonly ["file-read", "glob", "content-search", "git-log", "git-show", "git-diff", "git-blame"];
export type MissionReadOnlyTool = (typeof MISSION_READ_ONLY_TOOLS)[number];
/**
 * Whether the given runtime natively enforces the mission read-only boundary.
 * `claude-code` enforces; `codex` and `cursor` are advisory and do not.
 */
export declare function operatingRuntimeEnforcesBoundedReadOnly(runtime: string | undefined): Promise<boolean>;
/** Whether the selected runtime has a generated, runtime-native Operate workflow. */
export declare function operatingRuntimeSupportsNativeOperate(runtime: string | undefined): Promise<boolean>;
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
export declare function resolveOperatingDispatchIsolation(input: {
    roleId: OperatingRoleId;
    runtimeEnforcesBoundedReadOnly: boolean;
    adapterNativeCapable: boolean;
    runtimeWorkflowCapable?: boolean;
}): OperatingDispatchResolution;
/**
 * A runtime's operate classification (FR10): whether it can carry a mandate and
 * therefore dispatch operate lenses first-class, or is declared `unsupported`.
 * The `reason` is the exact remediation-grade explanation surfaced by
 * `operate doctor` when a runtime cannot carry a mandate.
 */
export interface OperatingRuntimeClassification {
    runtime: string;
    isolation: OperatingDispatchIsolation;
    mandateCapable: boolean;
    reason: string;
}
/**
 * Classify a runtime for operate dispatch (FR10). A runtime that natively
 * enforces the bounded read-only boundary can carry a mandate and is
 * `enforced-read-only-bounded` (first-class). Compatible advisory runtimes are
 * `runtime-governed`; only missing/incompatible workflows are unsupported.
 */
export declare function classifyOperatingRuntime(runtime: string | undefined): Promise<OperatingRuntimeClassification>;
/**
 * Resolve the active runtime id for a project WITHOUT probing installed binaries
 * (spawn-free) so `operate doctor` can classify it. Reads the runtime the
 * project/user already selected from the pipeline's reclassified registry. Fails
 * closed to `undefined` when no runtime is selected or the registry cannot be
 * resolved, so an unresolved runtime is classified `unsupported`, never assumed
 * mandate-capable.
 */
export declare function resolveActiveOperatingRuntime(projectRoot: string): Promise<string | undefined>;
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
export declare function narrowMissionRootsToCeiling(input: {
    declaredRoots: readonly string[];
    forbiddenPaths?: readonly string[];
}): string[];
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
export type MissionToolRequest = {
    tool: 'file-read';
    path: string;
} | {
    tool: 'glob';
    pattern?: string;
    root?: string;
} | {
    tool: 'content-search';
    query: string;
    root?: string;
} | {
    tool: 'git-log' | 'git-show' | 'git-diff' | 'git-blame';
    args?: string[];
    path?: string;
} | {
    tool: string;
    [key: string]: unknown;
};
export type MissionToolResult = {
    tool: 'file-read';
    path: string;
    content: string;
} | {
    tool: 'glob';
    matches: string[];
} | {
    tool: 'content-search';
    matches: Array<{
        path: string;
        line: number;
        text: string;
    }>;
} | {
    tool: 'git-log' | 'git-show' | 'git-diff' | 'git-blame';
    output: string;
};
/**
 * The single audited entry point for a mission lens's tool use. Every request is
 * checked against the bounded read-only grant BEFORE any filesystem or git
 * access: a tool outside the grant (write, execute, network, environment, or any
 * unknown surface) is refused, a target outside the declared roots is refused as
 * a path escape, and a target above the sensitivity ceiling is refused at read
 * time. There is deliberately no write/execute/network/environment tool to
 * invoke — those channels do not exist on this surface at all.
 */
export declare function invokeMissionTool(boundary: MissionReadBoundary, request: MissionToolRequest): Promise<MissionToolResult>;
/**
 * The concrete callable tool surface handed to an in-process native harness:
 * exactly the read-only tools, each bound to this boundary. There is no write,
 * execute, network, or environment callable on the returned object, so a harness
 * that walks it can never reach a mutating or escaping capability.
 */
export declare function createMissionToolset(boundary: MissionReadBoundary): Record<MissionReadOnlyTool, (request: Omit<MissionToolRequest, 'tool'>) => Promise<MissionToolResult>>;
/**
 * Fan a per-item dispatch out in parallel where the adapter reports
 * `parallelDispatch: true`, sequentially otherwise. Results are always returned
 * in the SAME order as `items`, so the caller can restore registry order and the
 * reduced events are byte-identical across parallel and sequential dispatch.
 */
export declare function runMissionDispatchFanOut<Item, Result>(input: {
    items: readonly Item[];
    parallel: boolean;
    run: (item: Item) => Promise<Result>;
}): Promise<Result[]>;
//# sourceMappingURL=mission-dispatch.d.ts.map