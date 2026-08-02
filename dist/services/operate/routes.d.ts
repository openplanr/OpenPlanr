import { type OperatingArtifactGeneratorAdapter, type StoredOperatingArtifactGeneration } from './artifact-route-generation.js';
import { type OperatingConfig, type OperatingEventHead, type OperatingFinding, type OperatingRoutePlan, type OperatingWorkspaceManifest } from './types.js';
/**
 * A single member of a grouped-finding epic. Only the fields needed to render
 * the epic markdown are carried; the shared v1.3 route-plan schema stays
 * single-`findingId` (the anchor) — this list is an OpenPlanr-local planning
 * detail recorded in the epic document, never a protocol-schema field.
 */
export interface EpicFindingMember {
    id: string;
    title: string;
    problem: string;
    proposal: string;
    evidenceRefs: string[];
}
/**
 * A consolidation-level grouping of 2+ related accepted findings that routes to
 * one `create-epic` action. `anchorId` is the lexicographically-first member id
 * (carried as the route action's single `findingId`); `members` (sorted by id)
 * is embedded verbatim in the generated epic markdown so finding → epic → spec
 * provenance stays traceable without a new protocol sidecar.
 */
export interface EpicFindingGroup {
    anchorId: string;
    memberIds: string[];
    members: EpicFindingMember[];
    category: string;
    theme: string;
    evidenceRefs: string[];
}
interface GroupableFinding {
    id: string;
    status?: unknown;
    category?: unknown;
    title?: unknown;
    problem?: unknown;
    proposal?: unknown;
    fingerprint?: unknown;
    sensitivity?: unknown;
    evidenceRefs?: unknown;
}
/**
 * Group related accepted findings into epic candidates. Two accepted findings
 * are related when they share a non-empty normalized `category`, share the same
 * evidence-derived `fingerprint` lineage, or are semantically equivalent per
 * `consolidation.ts` (which subsumes the Chair merge-proposal source, since a
 * merged finding keeps that shared category/fingerprint). Only components of 2+
 * members become epic groups; every group is deterministic (union-find over
 * id-sorted findings), so the FR7 report suggestion and the FR8 engine route
 * elect exactly the same theme.
 */
export declare function groupRelatedAcceptedFindings(findings: GroupableFinding[]): EpicFindingGroup[];
export declare function nextOperatingSpecOrdinal(projectRoot: string): Promise<number>;
export declare function nextOperatingEpicOrdinal(projectRoot: string): Promise<number>;
export declare function createOperatingRoutePlan(input: {
    projectRoot: string;
    cycleId: string;
    finding: OperatingFinding;
    config: OperatingConfig;
    workspace: OperatingWorkspaceManifest;
    eventHead: OperatingEventHead;
    evidenceDigest: `sha256:${string}`;
    providerDigest: `sha256:${string}`;
    sequence: number;
    specId?: string;
    epicId?: string;
    localRoot?: string;
    now?: string;
}): Promise<OperatingRoutePlan>;
/**
 * Re-evaluate a cycle's accepted findings for epic election and PROPOSE + accept
 * one governed `create-epic` route per themed 2+-member group that does not yet
 * have one. This is the operator-reachable producer of FR8 epic routes: it runs
 * right after a finding transitions to `accepted` through `governOperatingFinding`,
 * so accepting a related group yields a `create-epic` route through the same
 * journal-backed proposal path the engine uses for freshly-proposed findings —
 * reusing T-006's `groupRelatedAcceptedFindings`/`resolveEpicGroupForAnchor`/
 * `actionKind` so FR7's rendered suggestion and FR8's route always name the same
 * theme.
 *
 * Election never writes the epic markdown and never applies the route (accept ≠
 * apply): it only proposes the route and accepts it — mirroring exactly how
 * governance accepts a finding's individual route — leaving the digest-bound,
 * human-gated `routes apply` as the separate acting step. It is idempotent: a
 * group whose anchor already heads a committed `create-epic` route is skipped, so
 * re-electing (accepting further members of the same theme) never duplicates the
 * epic route. Membership growth before apply fails CLOSED rather than silently
 * writing a different epic: `resolveEpicGroupForAnchor` re-derives the member
 * list from the then-current accepted findings, so a route proposed for {A,B}
 * whose group has grown to {A,B,C} no longer matches its digest-bound preview
 * and `applyOperatingRoute` rejects it with `E_OPERATE_ROUTE_DRIFT` — the same
 * guard every other route kind carries. An individually-routed finding is never
 * re-routed individually — only the group-level epic route is added.
 */
export declare function electAcceptedFindingEpicRoutes(input: {
    projectRoot: string;
    localRoot?: string;
    cycleId: string;
    now?: string;
}): Promise<OperatingRoutePlan[]>;
export declare function readOperatingRoute(projectRoot: string, routeId: string): Promise<OperatingRoutePlan>;
export declare function applyOperatingRoute(input: {
    projectRoot: string;
    route: OperatingRoutePlan;
    config: OperatingConfig;
    confirmationDigest: string;
    localRoot?: string;
    artifactGenerator?: OperatingArtifactGeneratorAdapter;
    faultInjector?: (boundary: 'artifact-attempt-failed' | 'artifact-generated' | 'bytes-committed' | 'spec-linked' | 'outcome-registered' | 'artifact-created') => void | Promise<void>;
}): Promise<{
    transactionId?: string;
    eventHead: OperatingEventHead;
    state: 'awaiting-artifact-review' | 'awaiting-plan' | 'applied';
    invocation?: string;
    previewDigest?: `sha256:${string}`;
    artifact?: {
        destination: string;
        content: string;
        outputDigest: `sha256:${string}`;
        attempts: StoredOperatingArtifactGeneration['attempts'];
    };
    shipInvoked: false;
}>;
export declare function rollbackOperatingRoute(input: {
    projectRoot: string;
    route: OperatingRoutePlan;
    transactionId: string;
    recoveryId: string;
    localRoot?: string;
}): Promise<OperatingEventHead>;
export declare function routeDestinationDigest(projectRoot: string, route: OperatingRoutePlan): Promise<`sha256:${string}`>;
export {};
//# sourceMappingURL=routes.d.ts.map