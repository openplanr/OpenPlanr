import { z } from 'zod';
import type { OpenPlanrConfig } from '../../models/types.js';
import { type OperatingDispatchIsolation } from './mission-dispatch.js';
import { type OperatingAdvisorBrief, type OperatingCharter, type OperatingDataGap, type OperatingEvidenceReadiness, type OperatingProviderManifest, type OperatingRoleId, type OperatingRoleResult, type OperatingSensitivity, type OperatingState } from './types.js';
declare const advisorOutputSchema: z.ZodObject<{
    outcome: z.ZodEnum<{
        quiet: "quiet";
        proposals: "proposals";
    }>;
    proposals: z.ZodArray<z.ZodObject<{
        proposalKey: z.ZodString;
        type: z.ZodEnum<{
            finding: "finding";
            decision: "decision";
            "data-gap": "data-gap";
            merge: "merge";
            sequence: "sequence";
        }>;
        title: z.ZodString;
        problem: z.ZodString;
        proposal: z.ZodString;
        impact: z.ZodNumber;
        confidence: z.ZodNumber;
        ease: z.ZodNumber;
        severity: z.ZodEnum<{
            critical: "critical";
            high: "high";
            medium: "medium";
            low: "low";
        }>;
        evidenceRefs: z.ZodArray<z.ZodString>;
        dependsOnProposalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
        conflictsWithProposalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
        sequenceProposalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
    gaps: z.ZodArray<z.ZodString>;
    conflicts: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type OperatingAdvisorResponse = z.infer<typeof advisorOutputSchema>;
declare const missionAdvisorOutputSchema: z.ZodObject<{
    outcome: z.ZodEnum<{
        quiet: "quiet";
        proposals: "proposals";
    }>;
    proposals: z.ZodArray<z.ZodObject<{
        proposalKey: z.ZodString;
        type: z.ZodEnum<{
            finding: "finding";
            decision: "decision";
            "data-gap": "data-gap";
            merge: "merge";
            sequence: "sequence";
        }>;
        title: z.ZodString;
        problem: z.ZodString;
        proposal: z.ZodString;
        impact: z.ZodNumber;
        confidence: z.ZodNumber;
        ease: z.ZodNumber;
        severity: z.ZodEnum<{
            critical: "critical";
            high: "high";
            medium: "medium";
            low: "low";
        }>;
        citations: z.ZodArray<z.ZodObject<{
            citationKey: z.ZodOptional<z.ZodString>;
            repositoryPath: z.ZodOptional<z.ZodString>;
            lineRange: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            gitRevision: z.ZodOptional<z.ZodString>;
            planrArtifactId: z.ZodOptional<z.ZodString>;
            pinnedRevision: z.ZodString;
        }, z.core.$strict>>;
        dependsOnProposalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
        conflictsWithProposalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
        sequenceProposalKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
    gaps: z.ZodArray<z.ZodString>;
    conflicts: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type MissionAdvisorOutput = z.infer<typeof missionAdvisorOutputSchema>;
export interface AgentNativeAdvisorResponse {
    outcome: 'actions' | 'quiet' | 'partial';
    analysisMarkdown: string;
    claims: Array<{
        id: string;
        statement: string;
        epistemicStatus: 'observed' | 'inferred' | 'hypothesis' | 'owner-confirmed' | 'unknown';
        confidence: number;
        citations: Array<Record<string, unknown>>;
    }>;
    actions: Array<{
        actionKey: string;
        title: string;
        summary: string;
        lane: 'DEV' | 'OWNER' | 'AGENT';
        routeKind: 'quick-task' | 'spec' | 'epic' | 'decision' | 'agent-artifact' | 'experiment' | 'metric';
        horizon: 'immediate' | 'next' | 'later';
        confidence: number;
        impact?: number;
        ease?: number;
        critical?: boolean;
        citations: Array<Record<string, unknown>>;
    }>;
    gaps: Array<{
        id: string;
        question: string;
        impact: string;
        ownerRequired?: boolean;
    }>;
    conflicts: Array<{
        id: string;
        summary: string;
        actionKeys: string[];
    }>;
}
export declare function advisorResponseContractDetails(brief: OperatingAdvisorBrief): {
    expectedSchema: 'operating-advisor-response@1.2.0';
    example: unknown;
};
export declare function assertAdvisorOutputMatchesBrief(brief: OperatingAdvisorBrief, output: Pick<OperatingRoleResult, 'outcome' | 'proposals'>): void;
export interface OperatingProviderManifestInput {
    id: string;
    providerId: string;
    providerVersion: string;
    mode: 'structured' | 'native-isolated';
    toolIsolation: 'enforced' | 'not-applicable';
    endpoint: OperatingProviderManifest['endpoint'];
    permittedDataClasses: OperatingProviderManifest['permittedDataClasses'];
    retention: OperatingProviderManifest['retention'];
    incremental: boolean;
    deep: boolean;
    limits: OperatingProviderManifest['limits'];
    consentPolicyVersion: string;
    renewalTriggers: OperatingProviderManifest['consent']['renewalTriggers'];
    configurationDigest: `sha256:${string}`;
}
interface AdvisorOpenItem {
    id: string;
    status: string;
    summary: string;
    owner: string | null;
    evidenceRefs: string[];
    affectedRoles?: string[];
}
export interface AdvisorOperatingContext {
    snapshotDigest: `sha256:${string}`;
    charter: OperatingCharter;
    priorCycle: {
        id: string;
        state: string;
        health: string | null;
        findings: number;
        decisions: number;
        gaps: number;
        pendingOutcomes: number;
    } | null;
    openDecisions: AdvisorOpenItem[];
    openGaps: AdvisorOpenItem[];
    pendingOutcomes: AdvisorOpenItem[];
}
export interface AdvisorRoleContext {
    snapshotDigest: `sha256:${string}`;
    charter: Partial<OperatingCharter>;
    priorCycle: AdvisorOperatingContext['priorCycle'];
    openDecisions: AdvisorOpenItem[];
    openGaps: AdvisorOpenItem[];
    pendingOutcomes: AdvisorOpenItem[];
}
/** Build the immutable non-advisor context shared by all independent lenses. */
export declare function buildAdvisorOperatingContext(input: {
    charterPath: string;
    state: OperatingState;
    cycleId: string;
}): Promise<AdvisorOperatingContext>;
export interface OperatingMandate {
    kind: 'operating-mandate';
    schemaVersion: '1.0.0';
    protocolVersion: '1.3.0' | '1.4.0';
    roleId: OperatingRoleId;
    phase?: 'bootstrap' | 'advisor' | 'chair';
    lensQuestion: string;
    mandate: string;
    investigationMandate: {
        examine: string[];
        sufficientGrounding: string;
    };
    boundaries: {
        roots: string[];
        sensitivityCeiling: OperatingSensitivity;
        forbiddenPaths: string[];
    };
    runtimeBinding?: {
        runtime: string;
        runtimeBinding: 'required';
        crossRuntimeFallback: false;
        executionMode: 'native-agent' | 'sequential-native';
        assurance: 'runtime-governed';
        toolIsolation: 'enforced' | 'advisory' | 'none' | 'enforced-read-only';
    };
    procedure?: string;
    responseSchema: 'operating-advisor-response@1.3.0' | 'operating-advisor-response@1.4.0';
    citationRequirement: {
        everyClaimCited: true;
        citationShape: 'operating-citation@1.3.0';
        description: string;
    } | {
        materialClaimsCited: true;
        materialActionsCited: true;
        citationShape: 'operating-citation@1.4.0';
    };
    permissionPolicy?: {
        authority: 'runtime-session';
        planrGrantsPermissions: false;
        forbiddenEffects: string[];
    };
    mandateDigest: `sha256:${string}`;
}
/**
 * Build the Protocol v1.3 operating mandate for a role (FR1). The mandate's
 * boundaries are declared directly from the caller's granted workspace roots —
 * never an evidence-index-derived subset — so a gitignored `.planr/` tree is
 * fully readable when the caller declares it. The registry supplies the lens
 * question, investigation mandate, and sensitivity ceiling; this function only
 * threads the declared boundaries through.
 */
export declare function buildOperatingMandate(input: {
    roleId: OperatingRoleId;
    roots: readonly string[];
    forbiddenPaths?: readonly string[];
    runtime?: string;
    protocolVersion?: '1.3.0' | '1.4.0';
}): Promise<OperatingMandate>;
/**
 * FR1/FR2: derive a mandate's declared read roots directly from the project
 * working tree — every top-level directory the agent may traverse — for the
 * inline dispatch path. `.planr/` is ALWAYS declared, whether or not it exists
 * yet and REGARDLESS of git tracking, because the mission tool surface walks the
 * filesystem directly rather than a tracked-file inventory, so a gitignored `.planr/` tree
 * is fully readable (finding 2's tracked-file gap cannot reproduce here).
 * `.git`/`node_modules` are never declared, and every root is filtered to the
 * mandate's schema pattern. Mirrors the native adapter path's derivation so both
 * dispatch paths declare identical boundaries.
 */
export declare function deriveOperatingMandateRoots(projectRoot: string): Promise<string[]>;
export interface AdvisorAdapter {
    id: string;
    mode: 'structured' | 'native-isolated';
    toolIsolation: 'enforced' | 'advisory' | 'none' | 'not-applicable';
    capability: 'analysis-standard' | 'analysis-high';
    /**
     * Native adapters may explicitly opt into parallel role dispatch. Structured
     * provider adapters stay sequential so their rate/cost envelope remains
     * deterministic. Results are restored to registry order before reduction.
     */
    parallelDispatch?: boolean;
    /**
     * FR1/FR2: a lens is dispatched with a body-free operating MANDATE (the lens
     * question, declared read boundaries, and the citation requirement) and the
     * cycle's pinned revision — never a curated evidence body. It investigates with
     * the host's own read tools and returns the mandate-versioned citation-bearing response; the
     * CLI resolves and snapshots every citation fail-closed after it returns.
     */
    invoke(input: {
        roleId: OperatingRoleId;
        roleBrief: OperatingAdvisorBrief;
        mandate: OperatingMandate;
        pinnedRevision: string;
        context: AdvisorRoleContext;
        inputDigest: `sha256:${string}`;
    }): Promise<unknown>;
}
export interface AdvisorDispatchResult {
    results: OperatingRoleResult[];
    provenance: Array<{
        roleId: OperatingRoleId;
        runtime: string;
        adapterId: string;
        capability: 'analysis-standard' | 'analysis-high';
        dispatch: 'parallel' | 'sequential';
        /** Effective isolation classification (FR10): enforced-read-only-bounded or unsupported. */
        isolation: OperatingDispatchIsolation;
        /** Audit note explaining the classification (e.g. why a runtime is unsupported for operate). */
        reconciliation: string;
    }>;
    skipped: Array<{
        roleId: OperatingRoleId;
        gapId: string;
        reason: string;
    }>;
    failed: Array<{
        roleId: OperatingRoleId;
        message: string;
    }>;
    /**
     * Governed gaps opened while resolving the dispatched roles' citations
     * (unresolvable-citation and empty-grounding gaps). The engine records them
     * alongside the cycle's other gaps; empty on a fully-resolved dispatch.
     */
    gaps: OperatingDataGap[];
    blocked: boolean;
    modelCalls: number;
}
/**
 * The mandate's response contract is `operating-advisor-response@1.3.0`, whose
 * output facet mirrors the v1.2 brief's contract (allowed proposal types,
 * maxima), so a v1.3 response is validated against exactly the same invariants a
 * pack response is — reusing the pipeline's registry-derived brief as the single
 * source of truth.
 *
 * FR2: when the response's citations resolve to ZERO evidence IDs across every
 * proposal, the role commits `not_evaluated` — a schema-legal `quiet` result
 * (the frozen v1.2 role-result schema admits no `not_evaluated` outcome; the
 * not_evaluated state lives in the governed gap + the integrity surface) — and
 * the governed empty-grounding gap the citation gate opened is returned, with
 * `notEvaluated: true`, rather than a `quiet` that pretends the lens evaluated.
 */
export declare function createNativeMissionOperatingRoleResult(input: {
    mandate: OperatingMandate;
    cycleId: string;
    response: unknown;
    runtime: string;
    pinnedRevision?: string;
    /**
     * Injected citation resolver so the mandate response's citations flow into the
     * engine's already-live `gateRecordedProposalCitations` WITHOUT advisors.ts
     * importing engine.ts (which would create an import cycle). Given the
     * intermediate citation-bearing role result, it returns the gated result
     * (minted `evidenceRefs` merged in, unresolvable-citation proposals dropped),
     * the opened gaps, and the ids of roles whose citations resolved to zero
     * evidence (recorded not_evaluated).
     */
    resolveCitations: (roleResults: OperatingRoleResult[]) => Promise<{
        roleResults: OperatingRoleResult[];
        gaps: OperatingDataGap[];
        notEvaluatedRoleIds: string[];
    }>;
}): Promise<{
    result: OperatingRoleResult;
    gaps: OperatingDataGap[];
    notEvaluated: boolean;
}>;
export declare function assertAdvisorIsolation(adapter: AdvisorAdapter): void;
export declare function createOfflineAdvisorAdapter(fixture?: Partial<Record<OperatingRoleId, unknown>>): AdvisorAdapter;
export declare function createConfiguredStructuredAdapter(projectRoot: string, options?: {
    quiet?: boolean;
}): Promise<AdvisorAdapter>;
export declare function dispatchOperatingAdvisors(input: {
    cycleId: string;
    /** Working tree the mandate's declared read boundaries are derived from. */
    projectRoot: string;
    /** The cycle's frozen control-repository revision; passed to each lens so it cites resolvable content. */
    pinnedRevision: string;
    readiness: OperatingEvidenceReadiness;
    context: AdvisorOperatingContext;
    adapter: AdvisorAdapter;
    depth: 'standard' | 'deep' | 'review-only';
    runtime?: string;
    /**
     * Fresh agent-native harnesses request the Protocol v1.4 narrative response.
     * Legacy direct/offline cycles retain v1.3 so already-prepared adapters and
     * resumable cycles remain readable during the compatibility window.
     */
    protocolVersion?: '1.3.0' | '1.4.0';
    /**
     * The engine's fail-closed citation gate, injected so advisors.ts never imports
     * engine.ts (which would create a cycle). Every dispatched role's mandate
     * response flows through it: it resolves each cited locator against the cycle's
     * pinned revision, snapshots the cited bytes, mints the evidenceRefs, drops
     * unresolvable-citation proposals, and records a role that grounds zero evidence
     * as not_evaluated. This is the single, universal FR2 gate on this path.
     */
    resolveCitations: (roleResults: OperatingRoleResult[]) => Promise<{
        roleResults: OperatingRoleResult[];
        gaps: OperatingDataGap[];
        notEvaluatedRoleIds: string[];
    }>;
}): Promise<AdvisorDispatchResult>;
/**
 * Standard-cycle advisor failures are governed data gaps, not ephemeral
 * warnings. IDs are temporary and are remapped against canonical state by the
 * cycle engine before persistence.
 */
export declare function advisorFailureGaps(input: {
    cycleId: string;
    failed: AdvisorDispatchResult['failed'];
    readiness: OperatingEvidenceReadiness;
    owner: string;
    now: string;
}): Promise<OperatingDataGap[]>;
export declare function readProviderConsent(projectRoot: string, providerId: string): Promise<OperatingProviderManifest | null>;
/**
 * Build and, only after explicit authority, persist the credential-free policy
 * that controls a remote advisor call. Keys and endpoint secrets never enter
 * the manifest.
 */
export declare function ensureOperatingProviderConsent(input: {
    projectRoot: string;
    provider: OperatingProviderManifestInput;
    confirmed: boolean;
    persist?: boolean;
    now?: string;
}): Promise<{
    manifest: OperatingProviderManifest;
    changed: boolean;
}>;
export declare function configuredAdvisorProviderPolicy(input: {
    config: OpenPlanrConfig;
    adapterId: string;
    runtime: string;
}): OperatingProviderManifestInput;
export {};
//# sourceMappingURL=advisors.d.ts.map